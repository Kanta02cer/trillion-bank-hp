-- 案件の課題（20261009120000_airreach_client_issues）のテスト。ローカル Postgres で実行する。本番 DB では実行しない
\set QUIET on
begin;
insert into public.partner_orgs (id, name) values ('00000000-0000-0000-0000-0000000000f1', '共同会社1'), ('00000000-0000-0000-0000-0000000000f2', '共同会社2');
insert into public.staff_members (email, role, org_id, can_approve) values
  ('tb@tb.test', 'staff', null, false), ('p1@p1.test', 'staff', '00000000-0000-0000-0000-0000000000f1', false), ('p2@p2.test', 'staff', '00000000-0000-0000-0000-0000000000f2', false);
insert into public.clients (id, name, org_id) values
  ('00000000-0000-0000-0000-0000000000a0', 'TBの顧客', null),
  ('00000000-0000-0000-0000-0000000000a1', 'P1の顧客', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-0000000000a2', 'P2の顧客', '00000000-0000-0000-0000-0000000000f2');
insert into public.client_members (client_id, email) values ('00000000-0000-0000-0000-0000000000a1', 'owner@c1.test');
insert into public.client_issues (client_id, title, status) select id, '課題 ' || name, 'open' from public.clients;
create or replace function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('email', p_email, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_name; end if; raise notice 'PASS: %', p_name; end $$;
create or replace function pg_temp.denied(p_name text, p_sql text) returns void language plpgsql as $$
begin begin execute p_sql; exception when others then raise notice 'PASS: % (%)', p_name, sqlerrm; return; end; raise exception 'FAIL: % (通ってしまった)', p_name; end $$;
create or replace function pg_temp.n(p_sql text) returns int language plpgsql as $$
declare c int; begin execute p_sql; get diagnostics c = row_count; return c; end $$;
grant execute on function pg_temp.ok(text, boolean), pg_temp.denied(text, text), pg_temp.n(text), pg_temp.as_user(text) to authenticated;
set local role authenticated;

select pg_temp.as_user('tb@tb.test');
select pg_temp.ok('社内（TB）の人：すべての顧客の課題が見える（共同会社の顧客も。ほかの表と同じ）', (select count(*) from public.client_issues) = 3);
select pg_temp.ok('社内の人：TB の顧客に課題を書ける', pg_temp.n($q$insert into public.client_issues (client_id, title, symptom, cause, fix, check_how, kind, status, evidence) values ('00000000-0000-0000-0000-0000000000a0', '縮毛矯正の質問で名前が出ない', '2問で近くのお店だけ', 'ページに料金が無い', '料金と流れを書く', 'この2問で出るか', 'site', 'waiting_client', '{"aio":{"x":2,"n":9}}')$q$) = 1);
select pg_temp.ok('書いた人と直した人は DB が入れる（画面の値は使わない）', (select created_by = 'tb@tb.test' and updated_by = 'tb@tb.test' from public.client_issues where title = '縮毛矯正の質問で名前が出ない'));
select pg_temp.denied('1文字の題は書けない', $q$insert into public.client_issues (client_id, title) values ('00000000-0000-0000-0000-0000000000a0', 'x')$q$);
select pg_temp.denied('決まっていない状態は書けない', $q$insert into public.client_issues (client_id, title, status) values ('00000000-0000-0000-0000-0000000000a0', '課題', 'closed')$q$);
select pg_temp.denied('長すぎる根拠（8000バイト超）は書けない', $q$insert into public.client_issues (client_id, title, evidence) values ('00000000-0000-0000-0000-0000000000a0', '課題', jsonb_build_object('x', repeat('あ', 3000)))$q$);
select pg_temp.ok('状態を変えると、直した人と日時が入り、作った人は変わらない', pg_temp.n($q$update public.client_issues set status = 'in_progress', created_by = 'evil@x.test' where title = '縮毛矯正の質問で名前が出ない'$q$) = 1 and (select created_by = 'tb@tb.test' from public.client_issues where title = '縮毛矯正の質問で名前が出ない'));
select pg_temp.ok('課題を別の顧客に移せない（client_id は変わらない）', pg_temp.n($q$update public.client_issues set client_id = '00000000-0000-0000-0000-0000000000a1' where title = '縮毛矯正の質問で名前が出ない'$q$) = 1 and (select client_id = '00000000-0000-0000-0000-0000000000a0' from public.client_issues where title = '縮毛矯正の質問で名前が出ない'));

select pg_temp.as_user('p1@p1.test');
select pg_temp.ok('共同会社の人：自社の顧客の課題だけ見える', (select count(*) from public.client_issues) = 1 and (select bool_and(client_id = '00000000-0000-0000-0000-0000000000a1') from public.client_issues));
select pg_temp.ok('共同会社の人：自社の顧客に課題を書ける', pg_temp.n($q$insert into public.client_issues (client_id, title) values ('00000000-0000-0000-0000-0000000000a1', 'P1が書いた課題')$q$) = 1);
select pg_temp.denied('共同会社の人：他社（TB・P2）の顧客には書けない', $q$insert into public.client_issues (client_id, title) values ('00000000-0000-0000-0000-0000000000a0', '書けない課題')$q$);
select pg_temp.ok('共同会社の人：他社の課題は直せない・消せない（0件）', pg_temp.n($q$update public.client_issues set status = 'done' where client_id <> '00000000-0000-0000-0000-0000000000a1'$q$) = 0 and pg_temp.n($q$delete from public.client_issues where client_id <> '00000000-0000-0000-0000-0000000000a1'$q$) = 0);

select pg_temp.as_user('owner@c1.test');
select pg_temp.ok('お客様：課題は見えない（いまは担当者だけ）', (select count(*) from public.client_issues) = 0);
select pg_temp.denied('お客様：課題を書けない', $q$insert into public.client_issues (client_id, title) values ('00000000-0000-0000-0000-0000000000a1', 'お客様の課題')$q$);

select pg_temp.as_user('nobody@x.test');
select pg_temp.ok('登録していない人：何も見えない', (select count(*) from public.client_issues) = 0);

reset role;
delete from public.clients where id = '00000000-0000-0000-0000-0000000000a2';
select pg_temp.ok('顧客を消すと、その顧客の課題も消える', (select count(*) from public.client_issues where client_id = '00000000-0000-0000-0000-0000000000a2') = 0);
select pg_temp.ok('RLS が有効・anon に権限が無い', (select relrowsecurity from pg_class where oid = 'public.client_issues'::regclass) and not has_table_privilege('anon', 'public.client_issues', 'select'));
rollback;
\echo ALL PASS
