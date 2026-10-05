-- 取り消し: 定期計測の上限・停止の確かめ方（20261006120000_airreach_schedule_guards.sql）
--   20261005120000 の RPC（取り出し・今すぐ1回・その1件の取り出し）に戻し、足した関数2つを消す。表と行は変えない
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
  u record;
  v_planned integer;
  v_cost numeric;
  v_reason text;
begin
  -- 1) 予定の時刻になった有効な設定ごとに、この時刻の実行を1件だけ作る（同じ時刻の2回目は作らない）
  for s in
    select * from public.measurement_schedules m
    where m.enabled
      and extract(isodow from v_local)::int % 7 = any (m.weekdays)
      and extract(hour from v_local)::int = m.hour_jst
      and jsonb_array_length(m.prompts) > 0
  loop
    v_planned := jsonb_array_length(s.prompts) * cardinality(s.engines) * s.repeats;
    v_cost := (select coalesce(sum(coalesce((p_cost_per_answer ->> e)::numeric, 0)), 0) from unnest(s.engines) e) * jsonb_array_length(s.prompts) * s.repeats;
    select * into u from public.airreach_schedule_usage(s.id, v_month);
    v_reason := case
      when u.runs + 1 > s.max_runs_per_month then '月の実行回数の上限（' || s.max_runs_per_month || '回）'
      when u.answers + v_planned > s.monthly_answer_cap then '月の回答数の上限（' || s.monthly_answer_cap || '回答。今月 ' || u.answers || '・今回 ' || v_planned || '）'
      when u.cost + v_cost > s.monthly_cost_cap_usd then '月の費用の上限（' || s.monthly_cost_cap_usd || 'ドル。今月の見込み ' || round(u.cost, 2) || '・今回 ' || round(v_cost, 2) || '）'
      else null end;
    insert into public.measurement_jobs (schedule_id, client_id, slot, trigger, status, answers_planned, est_cost_usd, skip_reason, finished_at)
    values (s.id, s.client_id, v_slot, 'schedule', case when v_reason is null then 'queued' else 'skipped' end, v_planned, case when v_reason is null then v_cost else 0 end, v_reason, case when v_reason is null then null else p_now end)
    on conflict (schedule_id, slot) do nothing;
  end loop;

  -- 2) 待っている実行と、失敗して15分たった実行（回数の残りがあるもの）を取り出す。ほかの計測サーバーが取ったものは飛ばす
  for j in
    select jb.id from public.measurement_jobs jb
    join public.measurement_schedules m on m.id = jb.schedule_id
    where (jb.status = 'queued'
        or (jb.status = 'failed' and jb.attempts < m.max_attempts and jb.finished_at < p_now - interval '15 minutes')
        or (jb.status = 'running' and jb.locked_until < p_now and jb.attempts < m.max_attempts))
      and jb.slot >= v_month
    order by jb.slot
    limit greatest(1, least(coalesce(p_limit, 3), 10))
    for update of jb skip locked
  loop
    update public.measurement_jobs set status = 'running', attempts = attempts + 1, started_at = p_now, locked_until = p_now + interval '10 minutes', last_error = null
      where id = j.id;
    return next (
      select jsonb_build_object('job_id', jb.id, 'slot', jb.slot, 'attempts', jb.attempts, 'client_id', m.client_id, 'brand', m.brand, 'site_url', m.site_url,
        'engines', to_jsonb(m.engines), 'prompts', m.prompts, 'competitors', m.competitors, 'repeats', m.repeats)
      from public.measurement_jobs jb join public.measurement_schedules m on m.id = jb.schedule_id where jb.id = j.id);
  end loop;
  return;
end;
$$;

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
  u record;
  v_planned integer;
  v_cost numeric;
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
  v_planned := jsonb_array_length(s.prompts) * cardinality(s.engines) * s.repeats;
  v_cost := (select coalesce(sum(coalesce((p_cost_per_answer ->> e)::numeric, 0)), 0) from unnest(s.engines) e) * jsonb_array_length(s.prompts) * s.repeats;
  select * into u from public.airreach_schedule_usage(s.id, v_month);
  if u.answers + v_planned > s.monthly_answer_cap then
    return jsonb_build_object('ok', false, 'reason', '月の回答数の上限（' || s.monthly_answer_cap || '回答）を超えます。今月 ' || u.answers || '・今回 ' || v_planned);
  end if;
  if u.cost + v_cost > s.monthly_cost_cap_usd then
    return jsonb_build_object('ok', false, 'reason', '月の費用の上限（' || s.monthly_cost_cap_usd || 'ドル）を超えます。今月の見込み ' || round(u.cost, 2) || '・今回 ' || round(v_cost, 2));
  end if;
  insert into public.measurement_jobs (schedule_id, client_id, slot, trigger, status, answers_planned, est_cost_usd, requested_by)
  values (s.id, s.client_id, date_trunc('minute', v_now), 'manual', 'queued', v_planned, v_cost, nullif(v_email, ''))
  on conflict (schedule_id, slot) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', '同じ時刻の計測がすでにあります。1分あけてください');
  end if;
  return jsonb_build_object('ok', true, 'job_id', v_id, 'answers_planned', v_planned, 'est_cost_usd', v_cost);
end;
$$;

create or replace function public.airreach_schedule_claim_job(p_job_id uuid, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  update public.measurement_jobs set status = 'running', attempts = attempts + 1, started_at = p_now, locked_until = p_now + interval '10 minutes'
    where id = p_job_id and status = 'queued';
  if not found then return null; end if;
  select jsonb_build_object('job_id', jb.id, 'slot', jb.slot, 'attempts', jb.attempts, 'client_id', m.client_id, 'brand', m.brand, 'site_url', m.site_url,
      'engines', to_jsonb(m.engines), 'prompts', m.prompts, 'competitors', m.competitors, 'repeats', m.repeats)
    into v
    from public.measurement_jobs jb join public.measurement_schedules m on m.id = jb.schedule_id where jb.id = p_job_id;
  return v;
end;
$$;

drop function if exists public.airreach_schedule_limit_check(uuid, timestamptz, jsonb, uuid);
drop function if exists public.airreach_schedule_usage(uuid, timestamptz, uuid);
revoke all on function public.airreach_schedule_claim(timestamptz, jsonb, integer), public.airreach_schedule_request_now(uuid, jsonb), public.airreach_schedule_claim_job(uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.airreach_schedule_claim(timestamptz, jsonb, integer), public.airreach_schedule_claim_job(uuid, timestamptz) to service_role;
grant execute on function public.airreach_schedule_request_now(uuid, jsonb) to authenticated;
