-- 顧客の担当と報告期限（20261007180000）のテスト。ローカル Postgres で実行する。本番 DB では実行しない
\set QUIET on
begin;
insert into public.staff_members (email, role) values ('s@tb.test', 'staff'), ('t@tb.test', 'staff');
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'A店');
insert into public.client_members (client_id, email) values ('00000000-0000-0000-0000-0000000000a1', 'm@a.test');
create or replace function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('email', p_email, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_name; end if; raise notice 'PASS: %', p_name; end $$;
create or replace function pg_temp.denied(p_name text, p_sql text) returns void language plpgsql as $$
begin begin execute p_sql; exception when others then raise notice 'PASS: % (%)', p_name, sqlerrm; return; end; raise exception 'FAIL: % (通ってしまった)', p_name; end $$;
grant execute on function pg_temp.as_user(text), pg_temp.ok(text, boolean), pg_temp.denied(text, text) to authenticated;
select pg_temp.ok('既存の顧客は未設定（null）のまま', (select owner_email is null and report_due_day is null from public.clients where id = '00000000-0000-0000-0000-0000000000a1'));
set local role authenticated;
select pg_temp.as_user('s@tb.test');
update public.clients set owner_email = 's@tb.test', report_due_day = 10 where id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.ok('社内は担当と期限を設定できる', (select owner_email = 's@tb.test' and report_due_day = 10 from public.clients where id = '00000000-0000-0000-0000-0000000000a1'));
select pg_temp.denied('期限は 1〜31 だけ', $q$update public.clients set report_due_day = 32 where id = '00000000-0000-0000-0000-0000000000a1'$q$);
select pg_temp.denied('担当は社内メンバーだけ', $q$update public.clients set owner_email = 'nobody@example.test' where id = '00000000-0000-0000-0000-0000000000a1'$q$);
select pg_temp.as_user('m@a.test');
update public.clients set owner_email = null, report_due_day = 1 where id = '00000000-0000-0000-0000-0000000000a1';
reset role;
select pg_temp.ok('お客様は書き換えられない（RLS で0行）', (select owner_email = 's@tb.test' and report_due_day = 10 from public.clients where id = '00000000-0000-0000-0000-0000000000a1'));
delete from public.staff_members where email = 's@tb.test';
select pg_temp.ok('担当の社内メンバーが消えたら未設定に戻る', (select owner_email is null and report_due_day = 10 from public.clients where id = '00000000-0000-0000-0000-0000000000a1'));
rollback;
\echo ALL PASS
