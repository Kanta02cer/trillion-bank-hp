-- ============================================================================
-- AirReach: AI計測の定期実行（2026-10-05）
--   顧客ごとに「どの AI に・どの質問を・何曜日の何時に・何回ずつ」測るかを設定し、実行の記録を残す。
--
--   - 設定（measurement_schedules）は社内（staff_members）だけが読み書きする。お客様は読めない
--   - 実行の記録（measurement_jobs）は社内が読むだけ。書き込みは計測サーバー（service_role）の RPC だけ
--   - 二重実行の防止: 同じ設定・同じ時刻の実行は1件だけ（unique）。実行中の印（locked_until）がある間は取り直さない
--   - 上限: 月の実行回数・月の回答数・月の費用の見込み（ドル）を超える実行は「見送り」として理由を残す
--   - 再試行: 失敗した実行は、15分あけて max_attempts 回まで取り直す
--   - 既定は「無効」（enabled=false）。さらに計測サーバー側の AIRREACH_SCHEDULE_ENABLED が true でない限り自動では動かない
--   取り消し: supabase/rollback/20261005120000_airreach_measurement_schedules_rollback.sql
-- ============================================================================

-- 定期計測で作った計測の記録は source='schedule'
alter table public.measurement_runs drop constraint if exists measurement_runs_source_check;
alter table public.measurement_runs add constraint measurement_runs_source_check check (source in ('script', 'manual', 'schedule'));

create table if not exists public.measurement_schedules (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null unique references public.clients (id) on delete cascade,
  enabled              boolean not null default false,
  brand                text not null,
  site_url             text,
  engines              text[] not null default array['perplexity'],
  prompts              jsonb not null default '[]'::jsonb,
  competitors          jsonb not null default '[]'::jsonb,
  weekdays             smallint[] not null default array[1]::smallint[],
  hour_jst             smallint not null default 9,
  repeats              smallint not null default 1,
  max_runs_per_month   smallint not null default 4,
  monthly_answer_cap   integer not null default 200,
  monthly_cost_cap_usd numeric(8, 2) not null default 5,
  max_attempts         smallint not null default 3,
  created_by           text,
  updated_by           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint measurement_schedules_brand_check    check (length(btrim(brand)) between 1 and 120),
  constraint measurement_schedules_engines_check  check (cardinality(engines) between 1 and 8 and engines <@ array['chatgpt', 'chatgpt_search', 'claude', 'perplexity', 'gemini', 'google_aio', 'google_ai_mode']),
  constraint measurement_schedules_prompts_check  check (jsonb_typeof(prompts) = 'array' and jsonb_array_length(prompts) between 0 and 10),
  constraint measurement_schedules_weekdays_check check (cardinality(weekdays) between 1 and 7 and weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  constraint measurement_schedules_hour_check     check (hour_jst between 0 and 23),
  constraint measurement_schedules_repeats_check  check (repeats between 1 and 3),
  constraint measurement_schedules_runs_check     check (max_runs_per_month between 1 and 31),
  constraint measurement_schedules_answers_check  check (monthly_answer_cap between 1 and 5000),
  constraint measurement_schedules_cost_check     check (monthly_cost_cap_usd >= 0 and monthly_cost_cap_usd <= 500),
  constraint measurement_schedules_attempts_check check (max_attempts between 1 and 5)
);
comment on table public.measurement_schedules is 'AI計測の定期実行の設定（顧客ごとに1件）。社内だけが読み書き。既定は無効';

create table if not exists public.measurement_jobs (
  id              uuid primary key default gen_random_uuid(),
  schedule_id     uuid not null references public.measurement_schedules (id) on delete cascade,
  client_id       uuid not null references public.clients (id) on delete cascade,
  slot            timestamptz not null,
  trigger         text not null default 'schedule',
  status          text not null default 'queued',
  attempts        smallint not null default 0,
  answers_planned integer not null default 0,
  answers_done    integer not null default 0,
  errors          integer not null default 0,
  not_shown       integer not null default 0,
  est_cost_usd    numeric(10, 4) not null default 0,
  skip_reason     text,
  last_error      text,
  run_id          uuid references public.measurement_runs (id) on delete set null,
  requested_by    text,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  constraint measurement_jobs_once unique (schedule_id, slot),
  constraint measurement_jobs_status_check  check (status in ('queued', 'running', 'succeeded', 'partial', 'failed', 'skipped')),
  constraint measurement_jobs_trigger_check check (trigger in ('schedule', 'manual'))
);
comment on table public.measurement_jobs is 'AI計測の定期実行の記録（1回の実行ごと）。社内は読むだけ。書き込みは計測サーバーの RPC だけ';
create index if not exists measurement_jobs_client_idx on public.measurement_jobs (client_id, slot desc);
create index if not exists measurement_jobs_status_idx on public.measurement_jobs (status, slot);

alter table public.measurement_schedules enable row level security;
alter table public.measurement_jobs enable row level security;
drop policy if exists measurement_schedules_staff on public.measurement_schedules;
create policy measurement_schedules_staff on public.measurement_schedules for all to authenticated
  using (public.airreach_is_staff()) with check (public.airreach_is_staff());
drop policy if exists measurement_jobs_select on public.measurement_jobs;
create policy measurement_jobs_select on public.measurement_jobs for select to authenticated
  using (public.airreach_is_staff());
revoke all on table public.measurement_schedules, public.measurement_jobs from anon, authenticated, service_role;
grant select, insert, update, delete on table public.measurement_schedules to authenticated;
grant select on table public.measurement_jobs to authenticated;

-- 月の使用量（日本時間の月）。実行中・成功・一部成功の実行と、失敗でも回答があった分を数える
create or replace function public.airreach_schedule_usage(p_schedule_id uuid, p_month_start timestamptz)
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
  where j.schedule_id = p_schedule_id and j.slot >= p_month_start;
$$;

-- 予定の時刻になった設定の実行を作り、取り出す（計測サーバーだけ）。
--   p_now: いまの時刻 / p_cost_per_answer: AI ごとの1回答あたりの費用の見込み（{"perplexity":0.006,...}）
--   戻り値: 実行する job の一覧（設定の中身つき）。上限を超えるものは skipped にして返さない
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

-- 今すぐ1回測る（社内の人が画面から）。上限は定期実行と同じに確かめる。実行中の回があれば作らない
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

-- 実行の結果を記録する（計測サーバーだけ）。回答があれば計測の記録（measurement_runs）を作ってつなぐ
create or replace function public.airreach_schedule_finish(p_job_id uuid, p_status text, p_summary jsonb, p_answers_done integer, p_errors integer, p_not_shown integer, p_cost numeric, p_error text, p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  jb public.measurement_jobs;
  v_run uuid;
begin
  if p_status not in ('succeeded', 'partial', 'failed') then
    raise exception 'bad status' using errcode = '22023';
  end if;
  select * into jb from public.measurement_jobs where id = p_job_id for update;
  if not found then raise exception 'job not found' using errcode = '22023'; end if;
  if jb.status <> 'running' then
    return jsonb_build_object('ok', false, 'reason', 'not running', 'status', jb.status);
  end if;
  if p_summary is not null and jsonb_typeof(p_summary) = 'object' and p_status in ('succeeded', 'partial') then
    insert into public.measurement_runs (client_id, measured_on, run_label, query_set_version, source, summary, created_by)
    values (jb.client_id, (p_now at time zone 'Asia/Tokyo')::date, 'schedule-' || to_char(jb.slot at time zone 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI'), p_summary ->> 'query_set_version', 'schedule', p_summary,
            case when jb.trigger = 'manual' then coalesce(jb.requested_by, 'schedule') else 'schedule' end)
    returning id into v_run;
  end if;
  update public.measurement_jobs set status = p_status, answers_done = greatest(0, coalesce(p_answers_done, 0)), errors = greatest(0, coalesce(p_errors, 0)),
      not_shown = greatest(0, coalesce(p_not_shown, 0)), est_cost_usd = coalesce(p_cost, est_cost_usd), last_error = left(p_error, 500), run_id = coalesce(v_run, run_id),
      finished_at = p_now, locked_until = null
    where id = p_job_id;
  return jsonb_build_object('ok', true, 'run_id', v_run);
end;
$$;

-- 今すぐ実行で作った job を、計測サーバーが取り出す（その1件だけ）
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

revoke all on function public.airreach_schedule_usage(uuid, timestamptz), public.airreach_schedule_claim(timestamptz, jsonb, integer),
  public.airreach_schedule_request_now(uuid, jsonb), public.airreach_schedule_finish(uuid, text, jsonb, integer, integer, integer, numeric, text, timestamptz),
  public.airreach_schedule_claim_job(uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.airreach_schedule_claim(timestamptz, jsonb, integer), public.airreach_schedule_finish(uuid, text, jsonb, integer, integer, integer, numeric, text, timestamptz),
  public.airreach_schedule_claim_job(uuid, timestamptz) to service_role;
grant execute on function public.airreach_schedule_request_now(uuid, jsonb) to authenticated;
