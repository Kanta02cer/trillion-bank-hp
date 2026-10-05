-- 定期計測の上限・停止の確かめ方（20261006120000_airreach_schedule_guards）の回帰テスト
--   ローカル Postgres で実行する。本番 DB では実行しない。前提: 20261005 と 20261006 の migration を適用済み
\set QUIET on
begin;
insert into public.staff_members (email, role) values ('g@tb.test', 'staff');
insert into public.clients (id, name) values
  ('00000000-0000-0000-0000-0000000000d1', '手動・回数'), ('00000000-0000-0000-0000-0000000000d2', '止めた顧客'),
  ('00000000-0000-0000-0000-0000000000d3', '費用を下げた'), ('00000000-0000-0000-0000-0000000000d4', '自分の予約'),
  ('00000000-0000-0000-0000-0000000000d5', '回答数を下げた');
create or replace function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('email', p_email, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_name; end if; raise notice 'PASS: %', p_name; end $$;
grant execute on function pg_temp.as_user(text), pg_temp.ok(text, boolean) to authenticated, service_role;
\set COST '''{"perplexity":0.006}'''
-- 1問 × Perplexity × 1回 ＝ 1回答・0.006ドル
insert into public.measurement_schedules (client_id, brand, enabled, engines, prompts, weekdays, hour_jst, max_runs_per_month, monthly_answer_cap, monthly_cost_cap_usd)
select id, name, true, array['perplexity'], '[{"prompt":"q"}]', array[1]::smallint[], 10, 4, 100, 5 from public.clients where id::text like '00000000-0000-0000-0000-0000000000d%';

-- ---- 1) 今すぐ1回測る：月の実行回数の上限を確かめる ----
update public.measurement_schedules set max_runs_per_month = 1, enabled = false where brand = '手動・回数';
insert into public.measurement_jobs (schedule_id, client_id, slot, trigger, status, attempts, answers_planned, answers_done, est_cost_usd, finished_at)
select id, client_id, date_trunc('minute', now()) - interval '2 minutes', 'schedule', 'succeeded', 1, 1, 1, 0.006, now() - interval '1 minute' from public.measurement_schedules where brand = '手動・回数';
set local role authenticated;
select pg_temp.as_user('g@tb.test');
select pg_temp.ok('1) 今月すでに上限（月1回）なら、今すぐ1回測るは受け付けない・理由は回数', (select not (r ->> 'ok')::boolean and r ->> 'reason' like '月の実行回数の上限%' from (select public.airreach_schedule_request_now((select id from public.measurement_schedules where brand = '手動・回数'), :COST) r) x));
reset role;
update public.measurement_schedules set max_runs_per_month = 2 where brand = '手動・回数';
set local role authenticated;
select pg_temp.as_user('g@tb.test');
select pg_temp.ok('1) 上限に余りがあれば受け付ける（設定が止まっていても、社内の試験として使える）', (select (r ->> 'ok')::boolean from (select public.airreach_schedule_request_now((select id from public.measurement_schedules where brand = '手動・回数'), :COST) r) x));
reset role;

-- 以降は 2026-10-05（月）10:00 日本時間 ＝ 01:00 UTC を「いま」とする
\set NOW '''2026-10-05 01:00:00+00'''
-- ---- 2) 止めた顧客：失敗した回を取り直さない ----
update public.measurement_schedules set enabled = false where brand = '止めた顧客';
insert into public.measurement_jobs (schedule_id, client_id, slot, trigger, status, attempts, answers_planned, est_cost_usd, finished_at)
select id, client_id, '2026-10-05 00:00:00+00', 'schedule', 'failed', 1, 1, 0, '2026-10-05 00:30:00+00' from public.measurement_schedules where brand = '止めた顧客';
-- 待っている回（止める前に作られた回）も
insert into public.measurement_jobs (schedule_id, client_id, slot, trigger, status, answers_planned, est_cost_usd)
select id, client_id, '2026-10-04 23:00:00+00', 'schedule', 'queued', 1, 0.006 from public.measurement_schedules where brand = '止めた顧客';
-- ---- 3) 費用の上限を下げた：取り直す前に確かめる ----
update public.measurement_schedules set monthly_cost_cap_usd = 0, weekdays = array[3]::smallint[] where brand = '費用を下げた';
insert into public.measurement_jobs (schedule_id, client_id, slot, trigger, status, attempts, answers_planned, est_cost_usd, finished_at)
select id, client_id, '2026-10-05 00:00:00+00', 'schedule', 'failed', 1, 1, 0, '2026-10-05 00:30:00+00' from public.measurement_schedules where brand = '費用を下げた';
-- ---- 回答数の上限を下げた（今月の成功で使い切り）----
update public.measurement_schedules set monthly_answer_cap = 1, weekdays = array[3]::smallint[] where brand = '回答数を下げた';
insert into public.measurement_jobs (schedule_id, client_id, slot, trigger, status, attempts, answers_planned, answers_done, est_cost_usd, finished_at)
select id, client_id, '2026-10-02 00:00:00+00', 'schedule', 'succeeded', 1, 1, 1, 0.006, '2026-10-02 00:10:00+00' from public.measurement_schedules where brand = '回答数を下げた';
insert into public.measurement_jobs (schedule_id, client_id, slot, trigger, status, attempts, answers_planned, est_cost_usd, finished_at)
select id, client_id, '2026-10-05 00:00:00+00', 'schedule', 'failed', 1, 1, 0, '2026-10-05 00:30:00+00' from public.measurement_schedules where brand = '回答数を下げた';
-- ---- 自分の予約を二重に数えない：上限ちょうど（月1回・1回答・0.006ドル）で、実行中のまま止まった回を取り直す ----
update public.measurement_schedules set max_runs_per_month = 1, monthly_answer_cap = 1, monthly_cost_cap_usd = 0.006, weekdays = array[3]::smallint[] where brand = '自分の予約';
insert into public.measurement_jobs (schedule_id, client_id, slot, trigger, status, attempts, answers_planned, est_cost_usd, started_at, locked_until)
select id, client_id, '2026-10-05 00:00:00+00', 'schedule', 'running', 1, 1, 0.006, '2026-10-05 00:00:00+00', '2026-10-05 00:10:00+00' from public.measurement_schedules where brand = '自分の予約';
-- 月曜10時の新しい回は作らないように、ほかの設定は水曜にしてある（止めた顧客は enabled=false なので作られない）
update public.measurement_schedules set weekdays = array[3]::smallint[] where brand = '手動・回数';

set local role service_role;
create temp table got as select * from public.airreach_schedule_claim(:NOW, :COST, 10) x;
reset role;
select pg_temp.ok('取り出すのは「自分の予約」の1件だけ', (select count(*) from got) = 1 and (select x ->> 'brand' from got) = '自分の予約');
select pg_temp.ok('2) 止めた顧客の失敗した回は取り直さず「見送り」・理由', (select status = 'skipped' and skip_reason like '定期計測を止めた%' and attempts = 1 from public.measurement_jobs j join public.measurement_schedules m on m.id = j.schedule_id where m.brand = '止めた顧客' and j.slot = '2026-10-05 00:00:00+00'));
select pg_temp.ok('2) 止める前に作られて待っている回も「見送り」', (select status = 'skipped' from public.measurement_jobs j join public.measurement_schedules m on m.id = j.schedule_id where m.brand = '止めた顧客' and j.slot = '2026-10-04 23:00:00+00'));
select pg_temp.ok('3) 費用の上限を0に下げたら取り直さず「見送り」・理由は費用', (select status = 'skipped' and skip_reason like '始める前に上限を確かめ直したため見送り：月の費用の上限%' from public.measurement_jobs j join public.measurement_schedules m on m.id = j.schedule_id where m.brand = '費用を下げた'));
select pg_temp.ok('3) 回答数の上限を使い切っていたら取り直さない・理由は回答数', (select status = 'skipped' and skip_reason like '%月の回答数の上限%' from public.measurement_jobs j join public.measurement_schedules m on m.id = j.schedule_id where m.brand = '回答数を下げた' and j.status <> 'succeeded'));
select pg_temp.ok('自分の予約を二重に数えない：上限ちょうどでも取り直す（2回目）・予定と費用はいまの設定', (select status = 'running' and attempts = 2 and answers_planned = 1 and est_cost_usd = 0.006 from public.measurement_jobs j join public.measurement_schedules m on m.id = j.schedule_id where m.brand = '自分の予約'));
set local role service_role;
select pg_temp.ok('同じ回は2回取り出さない（実行中の印が有効）', (select count(*) from public.airreach_schedule_claim('2026-10-05 01:05:00+00', :COST, 10)) = 0);
reset role;

-- ---- 「今すぐ1回測る」の回は、失敗しても自動では取り直さない ----
update public.measurement_jobs set status = 'failed', finished_at = '2026-10-05 00:00:00+00', locked_until = null where trigger = 'manual';
set local role service_role;
select pg_temp.ok('今すぐ1回測るの回は自動で取り直さない', (select count(*) from public.airreach_schedule_claim('2026-10-05 01:20:00+00', :COST, 10) x where x ->> 'brand' = '手動・回数') = 0);
reset role;
select pg_temp.ok('今すぐ1回測るの回は失敗のまま（見送りにもしない）', (select bool_and(status = 'failed') from public.measurement_jobs where trigger = 'manual'));

-- ---- 月が変わったら、前の月の失敗した回は取り直さない ----
update public.measurement_schedules set enabled = true, monthly_cost_cap_usd = 5, monthly_answer_cap = 100, max_runs_per_month = 4 where brand = '費用を下げた';
update public.measurement_jobs set status = 'failed', skip_reason = null, finished_at = '2026-10-31 14:00:00+00' where client_id = '00000000-0000-0000-0000-0000000000d3';
set local role service_role;
select pg_temp.ok('月が変わったら（11/1）、10月の失敗した回は取り直さない', (select count(*) from public.airreach_schedule_claim('2026-11-01 01:00:00+00', :COST, 10) x where x ->> 'brand' = '費用を下げた') = 0);
reset role;

-- ---- 今すぐ1回測る：受け付けたあと取り出すまでに上限を下げたら、取り出さない ----
update public.measurement_schedules set max_runs_per_month = 4, monthly_cost_cap_usd = 5, monthly_answer_cap = 100 where brand = '手動・回数';
update public.measurement_jobs set status = 'succeeded', finished_at = now() where trigger = 'manual';
delete from public.measurement_jobs where client_id = '00000000-0000-0000-0000-0000000000d1';
set local role authenticated;
select pg_temp.as_user('g@tb.test');
create temp table rn as select public.airreach_schedule_request_now((select id from public.measurement_schedules where brand = '手動・回数'), :COST) r;
grant select on rn to service_role;
reset role;
select pg_temp.ok('今すぐ1回測るを受け付けた', (select (r ->> 'ok')::boolean from rn));
update public.measurement_schedules set monthly_cost_cap_usd = 0 where brand = '手動・回数';
set local role service_role;
select pg_temp.ok('取り出す前に費用の上限を0に下げたら取り出さない', public.airreach_schedule_claim_job((select (r ->> 'job_id')::uuid from rn), now()) is null);
reset role;
select pg_temp.ok('その回は「見送り」・理由は費用', (select status = 'skipped' and skip_reason like '%月の費用の上限%' from public.measurement_jobs where id = (select (r ->> 'job_id')::uuid from rn)));

-- ---- 権限：上限の確かめ・使用量の関数は直接呼べない ----
set local role authenticated;
select pg_temp.as_user('g@tb.test');
do $$ begin
  begin perform public.airreach_schedule_limit_check(gen_random_uuid(), now(), '{}', null); raise exception 'FAIL: 社内が上限の確かめを直接呼べた';
  exception when insufficient_privilege then raise notice 'PASS: 上限の確かめ・使用量の関数は直接呼べない'; end;
end $$;
reset role;

rollback;
\echo ALL PASS
