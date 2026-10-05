-- ============================================================================
-- AirReach: 定期計測の上限・停止の確かめ方を直す（2026-10-06）
--   20261005120000_airreach_measurement_schedules.sql の RPC を置き換える（migration は追記のみのため新しいファイルで直す）
--
--   直す不具合（ローカルの一時 Postgres で再現）:
--   1) 「今すぐ1回測る」が月の実行回数の上限を確かめていなかった（回答数・費用だけ見ていた）
--   2) 顧客ごとの設定を止めても（enabled=false）、失敗した回を自動で取り直していた
--   3) 取り直す・待っている回を始めるとき、変えたあとの上限（費用・回答数・回数）を確かめていなかった
--
--   方針:
--   - 上限の確かめ方を1つの関数（airreach_schedule_limit_check）にまとめ、実行を始める直前に「いまの設定」と「月の使用量」で確かめる
--   - 取り直す回は、その回自身の予約（実行中の予定回答数・費用の見込み）を使用量から除いて数える（同じ回を二重に数えない）
--   - 自動の取り出し（定期実行・取り直し）は、設定が有効な顧客の「定期」の回だけ。止めた顧客の回は「見送り」にして理由を残す
--   - 社内が画面から押す「今すぐ1回測る」は、設定が止まっていても使える（試験のため）。ただし上限はすべて確かめる。失敗しても自動では取り直さない
--   追加の修正（PR #141 のレビューで再現）:
--   4) 「今すぐ1回測る」を受け付けたあとに質問・AI・回数を変えても、古い費用の見込み・予定回答数のまま実行していた
--      → 取り出す直前に、いまの条件（質問・AI・回数）とその時点の AI ごとの単価で計算し直し、上限の判定・job の予約値・実際に測る条件をそろえる
--         （airreach_schedule_claim_job は単価を受け取るように引数を1つ増やす）
--   5) 同じ顧客の「今すぐ1回」と定期実行が同時に始まると、別々の job なので両方が上限の空きありと判断し、月の上限を超えていた
--      → 上限の確かめと予約を、顧客ごとの設定（measurement_schedules の行）のロックで直列にする。
--         ロックの順番はどこでも「設定の行（id の小さい順）→ job の行」にそろえる（デッドロックを避ける）
--   取り消し: supabase/rollback/20261006120000_airreach_schedule_guards_rollback.sql（20261005 の RPC に戻す）
-- ============================================================================

-- 月の使用量。p_exclude_job の回は数えない（その回を取り直すとき、自分の予約を二重に数えないため）
create or replace function public.airreach_schedule_usage(p_schedule_id uuid, p_month_start timestamptz, p_exclude_job uuid)
returns table (runs integer, answers integer, cost numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) filter (where j.status in ('running', 'succeeded', 'partial'))::integer,
         coalesce(sum(case when j.status = 'running' then j.answers_planned else j.answers_done end) filter (where j.status in ('running', 'succeeded', 'partial', 'failed')), 0)::integer,
         coalesce(sum(j.est_cost_usd) filter (where j.status in ('running', 'succeeded', 'partial', 'failed')), 0)
  from public.measurement_jobs j
  where j.schedule_id = p_schedule_id and j.slot >= p_month_start and (p_exclude_job is null or j.id <> p_exclude_job);
$$;

-- 上限の確かめ（回数・回答数・費用の見込み）。いまの設定で今回の予定を計算し、超えるなら理由を返す（超えなければ reason は null）
--   p_month_start: 数える月の始まり（日本時間） / p_exclude_job: 取り直す回（自分の分を数えない）
create or replace function public.airreach_schedule_limit_check(p_schedule_id uuid, p_month_start timestamptz, p_cost_per_answer jsonb, p_exclude_job uuid)
returns table (reason text, planned integer, cost numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.measurement_schedules;
  u record;
  v_planned integer;
  v_cost numeric;
begin
  select * into s from public.measurement_schedules where id = p_schedule_id;
  if not found then
    return query select '設定が見つかりません'::text, 0, 0::numeric; return;
  end if;
  v_planned := jsonb_array_length(s.prompts) * cardinality(s.engines) * s.repeats;
  v_cost := (select coalesce(sum(coalesce((p_cost_per_answer ->> e)::numeric, 0)), 0) from unnest(s.engines) e) * jsonb_array_length(s.prompts) * s.repeats;
  select * into u from public.airreach_schedule_usage(s.id, p_month_start, p_exclude_job);
  return query select
    case
      when u.runs + 1 > s.max_runs_per_month then '月の実行回数の上限（' || s.max_runs_per_month || '回。今月 ' || u.runs || '回）'
      when u.answers + v_planned > s.monthly_answer_cap then '月の回答数の上限（' || s.monthly_answer_cap || '回答。今月 ' || u.answers || '・今回 ' || v_planned || '）'
      when u.cost + v_cost > s.monthly_cost_cap_usd then '月の費用の上限（' || s.monthly_cost_cap_usd || 'ドル。今月の見込み ' || round(u.cost, 2) || '・今回 ' || round(v_cost, 2) || '）'
      else null end,
    v_planned, v_cost;
end;
$$;

create or replace function public.airreach_schedule_claim(p_now timestamptz, p_cost_per_answer jsonb, p_limit integer default 3)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'Asia/Tokyo';
  v_slot  timestamptz := date_trunc('hour', v_local) at time zone 'Asia/Tokyo';
  v_month timestamptz := date_trunc('month', v_local) at time zone 'Asia/Tokyo';
  v_ids uuid[];
  s record;
  j record;
  jr record;
  c record;
  v_n integer := 0;
begin
  -- 0) この呼び出しで触る設定（予定の時刻になった設定と、取り出す候補の job の設定）を、id の小さい順にまとめてロックする。
  --    「今すぐ1回」や別の定期実行と、上限の確かめ・予約が同時に進まないようにする（ロックの順番：設定の行 → job の行）
  v_ids := array(
    select m.id from public.measurement_schedules m
     where m.enabled and extract(isodow from v_local)::int % 7 = any (m.weekdays) and extract(hour from v_local)::int = m.hour_jst and jsonb_array_length(m.prompts) > 0
    union
    select jb.schedule_id from public.measurement_jobs jb join public.measurement_schedules m on m.id = jb.schedule_id
     where jb.trigger = 'schedule' and jb.slot >= v_month
       and (jb.status = 'queued' or (jb.status = 'failed' and jb.attempts < m.max_attempts and jb.finished_at < p_now - interval '15 minutes')
            or (jb.status = 'running' and jb.locked_until < p_now and jb.attempts < m.max_attempts)));
  perform 1 from public.measurement_schedules where id = any (v_ids) order by id for update;

  -- 1) 予定の時刻になった有効な設定ごとに、この時刻の実行を1件だけ作る（同じ時刻の2回目は作らない）。上限を超えるなら「見送り」
  for s in
    select * from public.measurement_schedules m
    where m.id = any (v_ids) and m.enabled
      and extract(isodow from v_local)::int % 7 = any (m.weekdays)
      and extract(hour from v_local)::int = m.hour_jst
      and jsonb_array_length(m.prompts) > 0
    order by m.id
  loop
    select * into c from public.airreach_schedule_limit_check(s.id, v_month, p_cost_per_answer, null);
    insert into public.measurement_jobs (schedule_id, client_id, slot, trigger, status, answers_planned, est_cost_usd, skip_reason, finished_at)
    values (s.id, s.client_id, v_slot, 'schedule', case when c.reason is null then 'queued' else 'skipped' end, c.planned, case when c.reason is null then c.cost else 0 end, c.reason, case when c.reason is null then null else p_now end)
    on conflict (schedule_id, slot) do nothing;
  end loop;

  -- 2) 待っている回・失敗して15分たった回・実行中の印が切れた回を取り出す（自動で取り出すのは「定期」の回だけ）。
  --    設定の行はロック済み。job の行をロックしてから条件を確かめ直し、いまの設定（止めていないか・上限）と月の使用量で判定する。
  for j in
    select jb.id, jb.schedule_id from public.measurement_jobs jb
    join public.measurement_schedules m on m.id = jb.schedule_id
    where jb.schedule_id = any (v_ids) and jb.trigger = 'schedule'
      and (jb.status = 'queued'
        or (jb.status = 'failed' and jb.attempts < m.max_attempts and jb.finished_at < p_now - interval '15 minutes')
        or (jb.status = 'running' and jb.locked_until < p_now and jb.attempts < m.max_attempts))
      and jb.slot >= v_month
    order by jb.schedule_id, jb.slot
  loop
    exit when v_n >= greatest(1, least(coalesce(p_limit, 3), 10));
    select jb.id, jb.slot, m.enabled into jr from public.measurement_jobs jb join public.measurement_schedules m on m.id = jb.schedule_id
      where jb.id = j.id and jb.trigger = 'schedule'
        and (jb.status = 'queued'
          or (jb.status = 'failed' and jb.attempts < m.max_attempts and jb.finished_at < p_now - interval '15 minutes')
          or (jb.status = 'running' and jb.locked_until < p_now and jb.attempts < m.max_attempts))
      for update of jb skip locked;
    if not found then continue; end if;
    if not jr.enabled then
      update public.measurement_jobs set status = 'skipped', skip_reason = '定期計測を止めたため実行しません', finished_at = p_now, locked_until = null where id = jr.id;
      continue;
    end if;
    select * into c from public.airreach_schedule_limit_check(j.schedule_id, date_trunc('month', jr.slot at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo', p_cost_per_answer, jr.id);
    if c.reason is not null then
      update public.measurement_jobs set status = 'skipped', skip_reason = '始める前に上限を確かめ直したため見送り：' || c.reason, finished_at = p_now, locked_until = null where id = jr.id;
      continue;
    end if;
    update public.measurement_jobs set status = 'running', attempts = attempts + 1, started_at = p_now, locked_until = p_now + interval '10 minutes', last_error = null,
        answers_planned = c.planned, est_cost_usd = c.cost
      where id = jr.id;
    v_n := v_n + 1;
    return next (
      select jsonb_build_object('job_id', jb.id, 'slot', jb.slot, 'attempts', jb.attempts, 'client_id', m.client_id, 'brand', m.brand, 'site_url', m.site_url,
        'engines', to_jsonb(m.engines), 'prompts', m.prompts, 'competitors', m.competitors, 'repeats', m.repeats,
        'answers_planned', jb.answers_planned, 'est_cost_usd', jb.est_cost_usd)
      from public.measurement_jobs jb join public.measurement_schedules m on m.id = jb.schedule_id where jb.id = jr.id);
  end loop;
  return;
end;
$$;

-- 今すぐ1回測る（社内の人が画面から）。設定が止まっていても使える（試験のため）が、回数・回答数・費用の上限はすべて確かめる
create or replace function public.airreach_schedule_request_now(p_schedule_id uuid, p_cost_per_answer jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.airreach_jwt_email();
  v_now timestamptz := now();
  v_month timestamptz := date_trunc('month', v_now at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  s public.measurement_schedules;
  c record;
  v_id uuid;
begin
  if not public.airreach_is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- 設定の行をロックしてから確かめる（同じ顧客の定期実行・別の「今すぐ1回」と直列にする）
  select * into s from public.measurement_schedules where id = p_schedule_id for update;
  if not found then raise exception 'schedule not found' using errcode = '22023'; end if;
  if jsonb_array_length(s.prompts) = 0 then
    return jsonb_build_object('ok', false, 'reason', '計測する質問がありません');
  end if;
  if exists (select 1 from public.measurement_jobs where schedule_id = s.id and status in ('queued', 'running') and coalesce(locked_until, v_now + interval '1 minute') > v_now) then
    return jsonb_build_object('ok', false, 'reason', '実行中の計測があります。終わってからもう一度押してください');
  end if;
  select * into c from public.airreach_schedule_limit_check(s.id, v_month, p_cost_per_answer, null);
  if c.reason is not null then
    return jsonb_build_object('ok', false, 'reason', c.reason || 'を超えるため受け付けません');
  end if;
  insert into public.measurement_jobs (schedule_id, client_id, slot, trigger, status, answers_planned, est_cost_usd, requested_by)
  values (s.id, s.client_id, date_trunc('minute', v_now), 'manual', 'queued', c.planned, c.cost, nullif(v_email, ''))
  on conflict (schedule_id, slot) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', '同じ時刻の計測がすでにあります。1分あけてください');
  end if;
  return jsonb_build_object('ok', true, 'job_id', v_id, 'answers_planned', c.planned, 'est_cost_usd', c.cost);
end;
$$;

-- 今すぐ1回測るの回を、計測サーバーが取り出す（その1件だけ）。
--   取り出す直前に、いまの条件（質問・AI・回数）とその時点の AI ごとの単価で予定回答数と費用を計算し直し、上限を確かめる。
--   予約値（answers_planned・est_cost_usd）と、返す「実際に測る条件」は同じ設定の行から作る（設定の行はロック中なので途中で変わらない）
--   以前の2引数版（受け付けたときの費用を割り戻していた）は消す
drop function if exists public.airreach_schedule_claim_job(uuid, timestamptz);
create or replace function public.airreach_schedule_claim_job(p_job_id uuid, p_now timestamptz, p_cost_per_answer jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sid uuid;
  jb public.measurement_jobs;
  c record;
  v jsonb;
begin
  select schedule_id into v_sid from public.measurement_jobs where id = p_job_id;
  if v_sid is null then return null; end if;
  -- ロックの順番：設定の行 → job の行
  perform 1 from public.measurement_schedules where id = v_sid for update;
  select * into jb from public.measurement_jobs where id = p_job_id and status = 'queued' for update skip locked;
  if not found then return null; end if;
  select * into c from public.airreach_schedule_limit_check(jb.schedule_id, date_trunc('month', jb.slot at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo', coalesce(p_cost_per_answer, '{}'::jsonb), jb.id);
  if c.reason is not null then
    update public.measurement_jobs set status = 'skipped', skip_reason = '始める前に上限を確かめ直したため見送り：' || c.reason, finished_at = p_now, answers_planned = c.planned, est_cost_usd = 0 where id = p_job_id;
    return null;
  end if;
  update public.measurement_jobs set status = 'running', attempts = attempts + 1, started_at = p_now, locked_until = p_now + interval '10 minutes',
      answers_planned = c.planned, est_cost_usd = c.cost
    where id = p_job_id;
  select jsonb_build_object('job_id', jb2.id, 'slot', jb2.slot, 'attempts', jb2.attempts, 'client_id', m.client_id, 'brand', m.brand, 'site_url', m.site_url,
      'engines', to_jsonb(m.engines), 'prompts', m.prompts, 'competitors', m.competitors, 'repeats', m.repeats,
      'answers_planned', jb2.answers_planned, 'est_cost_usd', jb2.est_cost_usd)
    into v
    from public.measurement_jobs jb2 join public.measurement_schedules m on m.id = jb2.schedule_id where jb2.id = p_job_id;
  return v;
end;
$$;

revoke all on function public.airreach_schedule_usage(uuid, timestamptz, uuid), public.airreach_schedule_limit_check(uuid, timestamptz, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function public.airreach_schedule_claim(timestamptz, jsonb, integer), public.airreach_schedule_request_now(uuid, jsonb), public.airreach_schedule_claim_job(uuid, timestamptz, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.airreach_schedule_claim(timestamptz, jsonb, integer), public.airreach_schedule_claim_job(uuid, timestamptz, jsonb) to service_role;
grant execute on function public.airreach_schedule_request_now(uuid, jsonb) to authenticated;
