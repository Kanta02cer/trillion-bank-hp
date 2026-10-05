-- AI計測の定期実行（measurement_schedules / measurement_jobs / airreach_schedule_*）のテスト
--   ローカル Postgres で実行する。本番 DB では実行しない
--   前提: phase1 / seed / phase2 / 20261003 / 20261005 の migration を適用済み
\set QUIET on
begin;
insert into public.staff_members (email, role) values ('s@tb.test', 'staff');
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'A店'), ('00000000-0000-0000-0000-0000000000a2', 'B店');
insert into public.client_members (client_id, email) values ('00000000-0000-0000-0000-0000000000a1', 'm@a.test');

create or replace function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('email', p_email, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_name; end if; raise notice 'PASS: %', p_name; end $$;
create or replace function pg_temp.denied(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then raise notice 'PASS: % (%)', p_name, sqlerrm; return; end;
  raise exception 'FAIL: % (通ってしまった)', p_name;
end $$;
grant execute on function pg_temp.as_user(text), pg_temp.ok(text, boolean), pg_temp.denied(text, text) to authenticated, service_role;
-- 「今すぐ1回」の1件の取り出し：20261006 以降は単価を受け取る3引数、それより前（取り消し後）は2引数
create or replace function pg_temp.claim_job(p_job uuid, p_cost jsonb) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  if exists (select 1 from pg_proc where proname = 'airreach_schedule_claim_job' and pronargs = 3) then
    execute 'select public.airreach_schedule_claim_job($1, now(), $2)' into v using p_job, p_cost;
  else
    execute 'select public.airreach_schedule_claim_job($1, now())' into v using p_job;
  end if;
  return v;
end $$;
grant execute on function pg_temp.claim_job(uuid, jsonb) to service_role;

-- 2026-10-05（月）10:00 日本時間 = 01:00 UTC
\set NOW '''2026-10-05 01:00:00+00'''
\set COST '''{"perplexity":0.006,"gemini":0.035}'''

-- ---- 社内：設定を作る ----
set local role authenticated;
select pg_temp.as_user('s@tb.test');
insert into public.measurement_schedules (client_id, enabled, brand, site_url, engines, prompts, weekdays, hour_jst, repeats, max_runs_per_month, monthly_answer_cap, monthly_cost_cap_usd)
values ('00000000-0000-0000-0000-0000000000a1', true, 'A店', 'https://a.example/', array['perplexity', 'gemini'], '[{"prompt":"q1"},{"prompt":"q2"},{"prompt":"q3"}]', array[1]::smallint[], 10, 1, 4, 200, 5);
insert into public.measurement_schedules (client_id, enabled, brand, engines, prompts, weekdays, hour_jst)
values ('00000000-0000-0000-0000-0000000000a2', false, 'B店', array['perplexity'], '[{"prompt":"q"}]', array[1]::smallint[], 10);
select pg_temp.ok('社内は設定を読める', (select count(*) from public.measurement_schedules) = 2);
select pg_temp.denied('質問は10問まで', $q$update public.measurement_schedules set prompts = (select jsonb_agg(jsonb_build_object('prompt', 'q' || g)) from generate_series(1, 11) g) where brand = 'A店'$q$);
select pg_temp.denied('知らない AI は登録できない', $q$update public.measurement_schedules set engines = array['bard'] where brand = 'A店'$q$);
select pg_temp.denied('社内は定期実行の取り出しを呼べない（計測サーバーだけ）', $q$select public.airreach_schedule_claim(now(), '{}', 3)$q$);
select pg_temp.denied('社内は実行の記録を直接書けない', $q$insert into public.measurement_jobs (schedule_id, client_id, slot) select id, client_id, now() from public.measurement_schedules limit 1$q$);

-- ---- お客様：読めない ----
select pg_temp.as_user('m@a.test');
select pg_temp.ok('お客様は設定を読めない', (select count(*) from public.measurement_schedules) = 0);
select pg_temp.ok('お客様は実行の記録を読めない', (select count(*) from public.measurement_jobs) = 0);
select pg_temp.denied('お客様は今すぐ実行を呼べない', $q$select public.airreach_schedule_request_now((select id from public.measurement_schedules limit 1), '{}')$q$);
reset role;

-- ---- 計測サーバー：予定の時刻に取り出す ----
set local role service_role;
create temp table got as select * from public.airreach_schedule_claim(:NOW, :COST, 3) x;
select pg_temp.ok('有効な設定（月曜10時）だけ1件取り出す・無効な設定は作らない', (select count(*) from got) = 1 and (select x ->> 'brand' from got) = 'A店');
select pg_temp.ok('取り出した中身に質問3問・AI 2つ', (select jsonb_array_length(x -> 'prompts') = 3 and jsonb_array_length(x -> 'engines') = 2 from got));
select pg_temp.ok('同じ時刻にもう一度呼んでも二重に作らない・取り出さない', (select count(*) from public.airreach_schedule_claim(:NOW, :COST, 3)) = 0);
select pg_temp.ok('同じ時間帯の別の分（10:05・実行中の印が有効）でも二重に作らない・取り出さない', (select count(*) from public.airreach_schedule_claim('2026-10-05 01:05:00+00', :COST, 3)) = 0);
reset role;
select pg_temp.ok('実行は1件だけ', (select count(*) from public.measurement_jobs) = 1);
select pg_temp.ok('実行は running・予定6回答・費用の見込み 0.123ドル', (select status = 'running' and answers_planned = 6 and est_cost_usd = 0.123 from public.measurement_jobs where client_id = '00000000-0000-0000-0000-0000000000a1'));

-- ---- 失敗 → 15分後に再試行（回数の上限まで）----
set local role service_role;
select public.airreach_schedule_finish((select (x ->> 'job_id')::uuid from got), 'failed', null, 0, 6, 0, 0, '時間切れ', '2026-10-05 01:06:00+00');
select pg_temp.ok('失敗の直後は取り直さない', (select count(*) from public.airreach_schedule_claim('2026-10-05 01:10:00+00', :COST, 3)) = 0);
select pg_temp.ok('15分たてば取り直す（2回目）', (select (x ->> 'attempts')::int = 2 from public.airreach_schedule_claim('2026-10-05 01:25:00+00', :COST, 3) x));
reset role;
select pg_temp.ok('失敗の理由が残る→再試行で消える', (select last_error is null and attempts = 2 from public.measurement_jobs));

-- ---- 成功の記録：計測の記録を作ってつなぐ ----
set local role service_role;
select pg_temp.ok('結果を記録できる', (select (public.airreach_schedule_finish((select (x ->> 'job_id')::uuid from got), 'partial', '{"by":[],"answers":[],"query_set_version":"qs1"}', 5, 1, 0, 0.1, 'q3 の Gemini が失敗', '2026-10-05 01:30:00+00') ->> 'ok')::boolean));
select pg_temp.ok('終わった実行はもう一度記録できない', not (select (public.airreach_schedule_finish((select (x ->> 'job_id')::uuid from got), 'succeeded', '{}', 6, 0, 0, 0, null, '2026-10-05 01:31:00+00') ->> 'ok')::boolean));
reset role;
select pg_temp.ok('計測の記録は source=schedule・日本時間の日付・job とつながる', (select r.source = 'schedule' and r.measured_on = '2026-10-05' and r.run_label = 'schedule-2026-10-05T10:00' from public.measurement_runs r join public.measurement_jobs j on j.run_id = r.id));
select pg_temp.as_user('m@a.test');
set local role authenticated;
select pg_temp.ok('お客様は自社の計測の記録（定期計測の分）を読める', (select count(*) from public.measurement_runs where source = 'schedule') = 1);
reset role;

-- ---- 上限：月の回答数・費用・回数 ----
update public.measurement_schedules set monthly_answer_cap = 8 where brand = 'A店';
set local role service_role;
select pg_temp.ok('回答数の上限を超える回は取り出さない', (select count(*) from public.airreach_schedule_claim('2026-10-12 01:00:00+00', :COST, 3)) = 0);
reset role;
select pg_temp.ok('見送りの理由が残る（回答数）', (select skip_reason like '月の回答数の上限%' and status = 'skipped' from public.measurement_jobs where slot = '2026-10-12 01:00:00+00'));
update public.measurement_schedules set monthly_answer_cap = 200, monthly_cost_cap_usd = 0.2 where brand = 'A店';
set local role service_role;
select pg_temp.ok('費用の上限を超える回は取り出さない', (select count(*) from public.airreach_schedule_claim('2026-10-19 01:00:00+00', :COST, 3)) = 0);
reset role;
select pg_temp.ok('見送りの理由が残る（費用）', (select skip_reason like '月の費用の上限%' from public.measurement_jobs where slot = '2026-10-19 01:00:00+00'));
update public.measurement_schedules set monthly_cost_cap_usd = 5, max_runs_per_month = 1 where brand = 'A店';
set local role service_role;
select pg_temp.ok('回数の上限（月1回）を超える回は取り出さない', (select count(*) from public.airreach_schedule_claim('2026-10-26 01:00:00+00', :COST, 3)) = 0);
select pg_temp.ok('翌月は数え直す（11/2 月曜は取り出す）', (select count(*) from public.airreach_schedule_claim('2026-11-02 01:00:00+00', :COST, 3)) = 1);
reset role;

-- ---- 今すぐ実行（社内）----
update public.measurement_jobs set status = 'succeeded', locked_until = null, finished_at = now() where status = 'running';
update public.measurement_schedules set max_runs_per_month = 4 where brand = 'A店';
set local role authenticated;
select pg_temp.as_user('s@tb.test');
create temp table rn as select public.airreach_schedule_request_now((select id from public.measurement_schedules where brand = 'A店'), :COST) r;
grant select on rn to service_role;
select pg_temp.ok('今すぐ実行を受け付ける', (select (r ->> 'ok')::boolean from rn));
select pg_temp.ok('待っている回があれば、もう一度押しても作らない', not (select (public.airreach_schedule_request_now((select id from public.measurement_schedules where brand = 'A店'), :COST) ->> 'ok')::boolean));
reset role;
set local role service_role;
select pg_temp.ok('計測サーバーがその1件を取り出す', (select pg_temp.claim_job((select (r ->> 'job_id')::uuid from rn), :COST) ->> 'brand') = 'A店');
select pg_temp.ok('同じ job は2回取り出せない', pg_temp.claim_job((select (r ->> 'job_id')::uuid from rn), :COST) is null);
reset role;
select pg_temp.ok('今すぐ実行は trigger=manual・頼んだ人が残る', (select trigger = 'manual' and requested_by = 's@tb.test' from public.measurement_jobs where id = (select (r ->> 'job_id')::uuid from rn)));

-- ---- 曜日・時刻が違えば作らない ----
update public.measurement_jobs set status = 'succeeded', locked_until = null, finished_at = now() where status in ('running', 'queued');
set local role service_role;
select pg_temp.ok('曜日が違えば作らない（火曜10時）', (select count(*) from public.airreach_schedule_claim('2026-11-03 01:00:00+00', :COST, 3)) = 0);
select pg_temp.ok('時刻が違えば作らない（月曜11時）', (select count(*) from public.airreach_schedule_claim('2026-11-09 02:00:00+00', :COST, 3)) = 0);
reset role;
select pg_temp.ok('火曜・11時の実行は作られていない', (select count(*) from public.measurement_jobs where slot in ('2026-11-03 01:00:00+00', '2026-11-09 02:00:00+00')) = 0);
-- ---- 実行中の印が切れた回（サーバーが途中で止まった）は取り直す ----
update public.measurement_jobs set status = 'running', locked_until = '2026-11-09 00:00:00+00' where slot = '2026-11-02 01:00:00+00';
set local role service_role;
select pg_temp.ok('実行中のまま印が切れた回は取り直す', (select count(*) from public.airreach_schedule_claim('2026-11-09 03:00:00+00', :COST, 3)) = 1);
reset role;

rollback;
\echo ALL PASS
