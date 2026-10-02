-- Studio の共有作業（studio_workspaces / airreach_studio_save）のテスト（ローカル Postgres で実行する。本番 DB では実行しない）
--   前提: phase1 / seed / phase2 / 20261003120000_airreach_studio_workspaces を適用済み。
--   実行: psql -d <db> -v ON_ERROR_STOP=1 -f scripts/airreach-api/studio-workspace-test.sql
\set QUIET on
begin;
insert into public.staff_members (email, role) values ('a@tb.test', 'staff'), ('b@tb.test', 'staff');
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000f1', 'ws');
insert into public.client_members (client_id, email) values ('00000000-0000-0000-0000-0000000000f1', 'm@c.test');

create or replace function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('email', p_email, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_name; end if; raise notice 'PASS: %', p_name; end $$;
create or replace function pg_temp.denied(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then raise notice 'PASS: % (%)', p_name, sqlerrm; return; end;
  raise exception 'FAIL: % (通ってしまった)', p_name;
end $$;
grant execute on function pg_temp.as_user(text), pg_temp.ok(text, boolean), pg_temp.denied(text, text) to authenticated;

set local role authenticated;
select pg_temp.as_user('a@tb.test');
select pg_temp.ok('初めての保存（版0）→ 版1', (public.airreach_studio_save('00000000-0000-0000-0000-0000000000f1', '{"studio":{"keywords":[1]}}', 0) ->> 'version')::int = 1);
select pg_temp.ok('社内は読める', (select count(*) from public.studio_workspaces) = 1);
select pg_temp.ok('最新の版からの保存 → 版2', (public.airreach_studio_save('00000000-0000-0000-0000-0000000000f1', '{"studio":{"keywords":[1,2]}}', 1) ->> 'version')::int = 2);
select pg_temp.as_user('b@tb.test');
select pg_temp.ok('古い版からの保存は断る（上書きしない）', (public.airreach_studio_save('00000000-0000-0000-0000-0000000000f1', '{"studio":{"keywords":[9]}}', 1) ->> 'conflict')::boolean);
select pg_temp.ok('断られたときは中身が変わっていない', (select data -> 'studio' -> 'keywords' from public.studio_workspaces) = '[1,2]'::jsonb);
select pg_temp.ok('断られたときに最新の版と保存した人が分かる', (select r ->> 'version' = '2' and r ->> 'updated_by' = 'a@tb.test' from (select public.airreach_studio_save('00000000-0000-0000-0000-0000000000f1', '{}', 0) r) x));
select pg_temp.ok('最新を読んでから保存 → 版3', (public.airreach_studio_save('00000000-0000-0000-0000-0000000000f1', '{"studio":{"keywords":[1,2,3]}}', 2) ->> 'version')::int = 3);
select pg_temp.ok('保存した人が残る', (select updated_by from public.studio_workspaces) = 'b@tb.test');
select pg_temp.denied('直接の書き込みはできない', $q$update public.studio_workspaces set data = '{}'$q$);
select pg_temp.denied('直接の追加はできない', $q$insert into public.studio_workspaces (client_id, data) values ('00000000-0000-0000-0000-0000000000f1', '{}')$q$);
select pg_temp.denied('オブジェクトでない保存は断る', $q$select public.airreach_studio_save('00000000-0000-0000-0000-0000000000f1', '[1]', 3)$q$);
select pg_temp.denied('存在しない顧客は断る', $q$select public.airreach_studio_save('00000000-0000-0000-0000-0000000000f9', '{}', 0)$q$);
select pg_temp.denied('4MB を超える保存は断る', $q$select public.airreach_studio_save('00000000-0000-0000-0000-0000000000f1', jsonb_build_object('x', repeat('a', 4100000)), 3)$q$);
select pg_temp.as_user('m@c.test');
select pg_temp.ok('お客様は読めない', (select count(*) from public.studio_workspaces) = 0);
select pg_temp.denied('お客様は保存できない', $q$select public.airreach_studio_save('00000000-0000-0000-0000-0000000000f1', '{}', 3)$q$);
select pg_temp.as_user('x@stranger.test');
select pg_temp.ok('関係ない人は読めない', (select count(*) from public.studio_workspaces) = 0);
reset role;
rollback;
\echo ALL PASS
