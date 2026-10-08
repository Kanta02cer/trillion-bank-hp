-- 計測の時期の関数（20261009140000_airreach_measure_timing）のテスト。ローカル Postgres で実行する。本番 DB では実行しない
\set QUIET on
begin;
insert into public.partner_orgs (id, name) values ('00000000-0000-0000-0000-0000000000f1', '共同会社1');
insert into public.staff_members (email, role, org_id, can_approve) values ('tb@tb.test', 'staff', null, false), ('p1@p1.test', 'staff', '00000000-0000-0000-0000-0000000000f1', false);
insert into public.clients (id, name, org_id) values ('00000000-0000-0000-0000-0000000000a0', 'TBの顧客', null), ('00000000-0000-0000-0000-0000000000a1', 'もう1社', null);
insert into public.client_members (client_id, email) values ('00000000-0000-0000-0000-0000000000a0', 'owner@c0.test'), ('00000000-0000-0000-0000-0000000000a1', 'owner@c1.test');
insert into public.studio_workspaces (client_id, data, version) values ('00000000-0000-0000-0000-0000000000a0',
  '{"studio":{"prompts":[{"text":"秘密の質問"}]},"orch":{"lastJob":{"confirm":{"entity":{"company":"株式会社サンプル","service":"美容室","at":"2026-09-01T00:00:00Z"}},"zipped":{"at":"2026-09-10T00:00:00Z","version":1,"faq":[{"q":"x"}]},"verified":{"ok":true,"at":"2026-09-28T01:00:00Z"},"files":{"faq.html":"<p>中身</p>"}}}}', 1);
insert into public.measurement_runs (client_id, measured_on, summary, created_at) values
  ('00000000-0000-0000-0000-0000000000a0', '2026-09-20', '{"answers":[{"engine":"google_aio","status":"ok"}]}', '2026-09-20T01:00:00Z'),
  ('00000000-0000-0000-0000-0000000000a0', '2026-10-01', '{"by":[]}', '2026-10-01T01:00:00Z');
create or replace function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('email', p_email, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_name; end if; raise notice 'PASS: %', p_name; end $$;
create or replace function pg_temp.denied(p_name text, p_sql text) returns void language plpgsql as $$
begin begin execute p_sql; exception when others then raise notice 'PASS: % (%)', p_name, sqlerrm; return; end; raise exception 'FAIL: % (通ってしまった)', p_name; end $$;
grant execute on function pg_temp.ok(text, boolean), pg_temp.denied(text, text), pg_temp.as_user(text) to authenticated;
set local role authenticated;

select pg_temp.as_user('owner@c0.test');
select pg_temp.ok('お客様：自分の顧客の日付が読める', (select (j ->> 'entity_at') = '2026-09-01T00:00:00Z' and (j ->> 'zipped_at') = '2026-09-10T00:00:00Z' and (j ->> 'verified_at') = '2026-09-28T01:00:00Z' and (j ->> 'verified_ok')::boolean from (select public.airreach_measure_timing('00000000-0000-0000-0000-0000000000a0') j) x));
select pg_temp.ok('前回の計測は「回答の記録がある計測」だけ（要約だけの古い記録は数えない）', (select (public.airreach_measure_timing('00000000-0000-0000-0000-0000000000a0') ->> 'last_run_at')::timestamptz = '2026-09-20T01:00:00Z'));
select pg_temp.ok('返すのは日付と ok だけ（会社名・質問・ZIP の中身は返さない）', (select not (j::text ~ '株式会社サンプル|秘密の質問|中身|faq') and (select count(*) from jsonb_object_keys(j)) = 5 from (select public.airreach_measure_timing('00000000-0000-0000-0000-0000000000a0') j) x));
select pg_temp.denied('お客様：ほかの顧客は読めない', $q$select public.airreach_measure_timing('00000000-0000-0000-0000-0000000000a1')$q$);
select pg_temp.as_user('p1@p1.test');
select pg_temp.denied('共同会社の人：担当でない顧客は読めない', $q$select public.airreach_measure_timing('00000000-0000-0000-0000-0000000000a0')$q$);
select pg_temp.as_user('tb@tb.test');
select pg_temp.ok('社内の人：読める', (select public.airreach_measure_timing('00000000-0000-0000-0000-0000000000a0') ->> 'entity_at') is not null);
select pg_temp.ok('Studio の作業が無い顧客：日付はすべて空', (select j ->> 'entity_at' is null and j ->> 'last_run_at' is null and not (j ->> 'verified_ok')::boolean from (select public.airreach_measure_timing('00000000-0000-0000-0000-0000000000a1') j) x));
select pg_temp.as_user('nobody@x.test');
select pg_temp.denied('登録していない人は読めない', $q$select public.airreach_measure_timing('00000000-0000-0000-0000-0000000000a0')$q$);
reset role;
select pg_temp.ok('anon は呼べない', not has_function_privilege('anon', 'public.airreach_measure_timing(uuid)', 'execute'));
select 'ALL PASSED' as result;
rollback;
