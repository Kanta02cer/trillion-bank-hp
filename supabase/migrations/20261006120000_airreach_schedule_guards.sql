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
  s record;
  j record;
  c record;
  v_n integer := 0;
begin
  -- 1) 予定の時刻になった有効な設定ごとに、この時刻の実行を1件だけ作る（同じ時刻の2回目は作らない）。上限を超えるなら「見送り」
  for s in
    select * from public.measurement_schedules m
    where m.enabled
      and extract(isodow from v_local)::int % 7 = any (m.weekdays)
      and extract(hour from v_local)::int = m.hour_jst
      and jsonb_array_length(m.prompts) > 0
  loop
    select * into c from public.airreach_schedule_limit_check(s.id, v_month, p_cost_per_answer, null);
    insert into public.measurement_jobs (schedule_id, client_id, slot, trigger, status, answers_planned, est_cost_usd, skip_reason, finished_at)
    values (s.id, s.client_id, v_slot, 'schedule', case when c.reason is null then 'queued' else 'skipped' end, c.planned, case when c.reason is null then c.cost else 0 end, c.reason, case when c.reason is null then null else p_now end)
    on conflict (schedule_id, slot) do nothing;
  end loop;

  -- 2) 待っている回・失敗して15分たった回・実行中の印が切れた回を取り出す。
  --    自動で取り出すのは「定期」の回だけ（「今すぐ1回測る」の回は自動では取り直さない）。
  --    始める直前に、いまの設定（止めていないか・上限）と月の使用量で確かめ直す。止めた・上限を超える回は「見送り」にして理由を残す
  for j in
    select jb.id, jb.slot, m.enabled, m.id as sid from public.measurement_jobs jb
    join public.measurement_schedules m on m.id = jb.schedule_id
    where jb.trigger = 'schedule'
      and (jb.status = 'queued'
        or (jb.status = 'failed' and jb.attempts < m.max_attempts and jb.finished_at < p_now - interval '15 minutes')
        or (jb.status = 'running' and jb.locked_until < p_now and jb.attempts < m.max_attempts))
      and jb.slot >= v_month
    order by jb.slot
    for update of jb skip locked
  loop
    exit when v_n >= greatest(1, least(coalesce(p_limit, 3), 10));
    if not j.enabled then
      update public.measurement_jobs set status = 'skipped', skip_reason = '定期計測を止めたため実行しません', finished_at = p_now, locked_until = null where id = j.id;
      continue;
    end if;
    select * into c from public.airreach_schedule_limit_check(j.sid, date_trunc('month', j.slot at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo', p_cost_per_answer, j.id);
    if c.reason is not null then
      update public.measurement_jobs set status = 'skipped', skip_reason = '始める前に上限を確かめ直したため見送り：' || c.reason, finished_at = p_now, locked_until = null where id = j.id;
      continue;
    end if;
    update public.measurement_jobs set status = 'running', attempts = attempts + 1, started_at = p_now, locked_until = p_now + interval '10 minutes', last_error = null,
        answers_planned = c.planned, est_cost_usd = c.cost
      where id = j.id;
    v_n := v_n + 1;
    return next (
      select jsonb_build_object('job_id', jb.id, 'slot', jb.slot, 'attempts', jb.attempts, 'client_id', m.client_id, 'brand', m.brand, 'site_url', m.site_url,
        'engines', to_jsonb(m.engines), 'prompts', m.prompts, 'competitors', m.competitors, 'repeats', m.repeats)
      from public.measurement_jobs jb join public.measurement_schedules m on m.id = jb.schedule_id where jb.id = j.id);
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
  select * into s from public.measurement_schedules where id = p_schedule_id;
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

-- 今すぐ1回測るの回を、計測サーバーが取り出す（その1件だけ）。取り出す直前にも上限を確かめる（受け付けから取り出しまでの間に設定が変わることがある）
create or replace function public.airreach_schedule_claim_job(p_job_id uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jb public.measurement_jobs;
  c record;
  v jsonb;
begin
  select * into jb from public.measurement_jobs where id = p_job_id and status = 'queued' for update skip locked;
  if not found then return null; end if;
  -- 費用の見込みは受け付けたときの値（今回の予定）を使う。回数・回答数・費用は自分の分を除いた使用量で確かめる
  select * into c from public.airreach_schedule_limit_check(jb.schedule_id, date_trunc('month', jb.slot at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo',
    (select jsonb_object_agg(e, case when jsonb_array_length(m.prompts) * cardinality(m.engines) * m.repeats > 0 then jb.est_cost_usd / (jsonb_array_length(m.prompts) * cardinality(m.engines) * m.repeats) else 0 end)
       from public.measurement_schedules m, unnest(m.engines) e where m.id = jb.schedule_id), jb.id);
  if c.reason is not null then
    update public.measurement_jobs set status = 'skipped', skip_reason = '始める前に上限を確かめ直したため見送り：' || c.reason, finished_at = p_now where id = p_job_id;
    return null;
  end if;
  update public.measurement_jobs set status = 'running', attempts = attempts + 1, started_at = p_now, locked_until = p_now + interval '10 minutes'
    where id = p_job_id;
  select jsonb_build_object('job_id', jb2.id, 'slot', jb2.slot, 'attempts', jb2.attempts, 'client_id', m.client_id, 'brand', m.brand, 'site_url', m.site_url,
      'engines', to_jsonb(m.engines), 'prompts', m.prompts, 'competitors', m.competitors, 'repeats', m.repeats)
    into v
    from public.measurement_jobs jb2 join public.measurement_schedules m on m.id = jb2.schedule_id where jb2.id = p_job_id;
  return v;
end;
$$;

revoke all on function public.airreach_schedule_usage(uuid, timestamptz, uuid), public.airreach_schedule_limit_check(uuid, timestamptz, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function public.airreach_schedule_claim(timestamptz, jsonb, integer), public.airreach_schedule_request_now(uuid, jsonb), public.airreach_schedule_claim_job(uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.airreach_schedule_claim(timestamptz, jsonb, integer), public.airreach_schedule_claim_job(uuid, timestamptz) to service_role;
grant execute on function public.airreach_schedule_request_now(uuid, jsonb) to authenticated;
