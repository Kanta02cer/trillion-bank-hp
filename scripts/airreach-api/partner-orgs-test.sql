-- 共同会社（20261008120000_airreach_partner_orgs）のテスト。ローカル Postgres で実行する。本番 DB では実行しない
--   共同会社 P1・P2 と Trillion Bank（TB）の顧客を1件ずつ置き、P1 の人に P2・TB の行が1件も見えない／変えられないことを、表と関数ごとに確かめる
\set QUIET on
begin;
insert into public.partner_orgs (id, name) values ('00000000-0000-0000-0000-0000000000f1', '共同会社1'), ('00000000-0000-0000-0000-0000000000f2', '共同会社2');
insert into public.staff_members (email, role, org_id, can_approve) values
  ('tb@tb.test', 'staff', null, false), ('adm@tb.test', 'admin', null, false),
  ('p1@p1.test', 'staff', '00000000-0000-0000-0000-0000000000f1', false), ('p1ap@p1.test', 'staff', '00000000-0000-0000-0000-0000000000f1', true),
  ('p2@p2.test', 'staff', '00000000-0000-0000-0000-0000000000f2', false);
insert into public.clients (id, name, org_id) values
  ('00000000-0000-0000-0000-0000000000a0', 'TBの顧客', null),
  ('00000000-0000-0000-0000-0000000000a1', 'P1の顧客', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-0000000000a2', 'P2の顧客', '00000000-0000-0000-0000-0000000000f2');
insert into public.client_members (client_id, email) select id, 'm-' || right(id::text, 2) || '@c.test' from public.clients;
insert into public.client_sites (client_id, url, host) select id, 'https://' || right(id::text, 2) || '.test/', right(id::text, 2) || '.test' from public.clients;
insert into public.measurement_runs (client_id, measured_on, summary) select id, '2026-09-20', '{"by":[]}' from public.clients;
insert into public.traffic_snapshots (client_id, period_month, source, metrics) select id, '2026-09-01', 'gsc_api', '{"clicks": 1}' from public.clients;
insert into public.action_items (client_id, title, status) select id, '施策', 'planned' from public.clients;
insert into public.reports (client_id, period_month, status, published_at, conclusions) select id, '2026-08-01', 'published', now(), '["結論"]' from public.clients;
insert into public.reports (client_id, period_month, status, conclusions) select id, '2026-09-01', 'draft', '["下書き"]' from public.clients;
insert into public.studio_workspaces (client_id, data, version) select id, '{"studio":{"keywords":[],"prompts":[],"competitors":[]}}', 1 from public.clients;
insert into public.client_requests (client_id, kind, action, payload, requested_by) select id, 'keyword', 'add', '{"text":"x"}', 'm@c.test' from public.clients;
create or replace function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('email', p_email, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_name; end if; raise notice 'PASS: %', p_name; end $$;
create or replace function pg_temp.denied(p_name text, p_sql text) returns void language plpgsql as $$
begin begin execute p_sql; exception when others then raise notice 'PASS: % (%)', p_name, sqlerrm; return; end; raise exception 'FAIL: % (通ってしまった)', p_name; end $$;
-- 見えるのは自社の顧客の行だけか：表ごとに、見えた client_id がすべて許された集合に入り、かつ自社の行が見えること
create or replace function pg_temp.only(p_name text, p_allowed uuid[]) returns void language plpgsql as $$
declare t text; n_bad int; n_own int;
begin
  foreach t in array array['client_members','client_sites','measurement_runs','traffic_snapshots','action_items','reports','studio_workspaces','client_requests'] loop
    execute format('select count(*) filter (where not (client_id = any($1))), count(*) filter (where client_id = any($1)) from public.%I', t) into n_bad, n_own using p_allowed;
    if n_bad > 0 or n_own = 0 then raise exception 'FAIL: % / % （他社の行 % 件・自社の行 % 件）', p_name, t, n_bad, n_own; end if;
  end loop;
  execute 'select count(*) filter (where not (id = any($1))) from public.clients' into n_bad using p_allowed;
  if n_bad > 0 then raise exception 'FAIL: % / clients （他社 % 件）', p_name, n_bad; end if;
  raise notice 'PASS: % （顧客・8つの表）', p_name;
end $$;
create or replace function pg_temp.n(p_sql text) returns int language plpgsql as $$
declare v int; begin execute 'with u as (' || p_sql || ' returning 1) select count(*) from u' into v; return v; end $$;
create or replace function pg_temp.v(p_sql text) returns text language plpgsql as $$
declare v text; begin execute p_sql into v; return v; end $$;
grant execute on function pg_temp.as_user(text), pg_temp.ok(text, boolean), pg_temp.denied(text, text), pg_temp.only(text, uuid[]), pg_temp.n(text), pg_temp.v(text) to authenticated;
\set T '''00000000-0000-0000-0000-0000000000a0'''
\set A '''00000000-0000-0000-0000-0000000000a1'''
\set B '''00000000-0000-0000-0000-0000000000a2'''
set local role authenticated;

-- ---- 見える範囲 ----
select pg_temp.as_user('p1@p1.test');
select pg_temp.only('共同会社1の人：自社の顧客の行だけが見える', array[:A]::uuid[]);
select pg_temp.ok('共同会社1の人：レポートの出来事も自社の顧客の分だけ', (select bool_and(r.client_id = :A) from public.report_events e join public.reports r on r.id = e.report_id) is not false);
select pg_temp.ok('共同会社1の人：人の一覧は自社の人だけ', (select array_agg(email order by email) from public.staff_members) = array['p1@p1.test', 'p1ap@p1.test']);
select pg_temp.ok('共同会社1の人：共同会社の一覧は自社だけ', (select array_agg(name) from public.partner_orgs) = array['共同会社1']);
select pg_temp.ok('me：社内向けの画面は使える・社内ではない・管理者ではない・所属が出る',
  (select (m ->> 'is_staff')::boolean and not (m ->> 'is_internal')::boolean and not (m ->> 'is_admin')::boolean and m -> 'org' ->> 'name' = '共同会社1' from public.airreach_me() m));
select pg_temp.as_user('p2@p2.test');
select pg_temp.only('共同会社2の人：自社の顧客の行だけが見える', array[:B]::uuid[]);
select pg_temp.as_user('tb@tb.test');
select pg_temp.ok('TB の社内：全顧客が見える', (select count(*) from public.clients) = 3 and (select count(*) from public.reports) = 6 and (select count(*) from public.staff_members) = 5);
select pg_temp.ok('TB の社内：me は社内', (select (m ->> 'is_internal')::boolean and m -> 'org' = 'null'::jsonb from public.airreach_me() m));
select pg_temp.as_user('m-a1@c.test');
select pg_temp.ok('お客様：今までどおり自社の顧客と公開レポートだけ', (select count(*) from public.clients) = 1 and (select count(*) from public.reports) = 1);

-- ---- 関数 ----
select pg_temp.as_user('p1@p1.test');
select pg_temp.ok('関数：自社の顧客の設定は読める', public.airreach_client_settings(:A) is not null);
select pg_temp.denied('関数：TB の顧客の設定は読めない', $q$select public.airreach_client_settings('00000000-0000-0000-0000-0000000000a0')$q$);
select pg_temp.denied('関数：P2 の顧客の設定は読めない', $q$select public.airreach_client_settings('00000000-0000-0000-0000-0000000000a2')$q$);
select pg_temp.denied('関数：P2 の顧客の診断は読めない', $q$select public.airreach_client_scans('00000000-0000-0000-0000-0000000000a2')$q$);
select pg_temp.ok('関数：自社の顧客の診断は読める', public.airreach_client_scans(:A) is not null);
select pg_temp.ok('関数：自社の顧客の Studio を保存できる', (public.airreach_studio_save(:A, '{"studio":{"keywords":[1]}}', 1) ->> 'version')::int = 2);
select pg_temp.denied('関数：TB の顧客の Studio は保存できない', $q$select public.airreach_studio_save('00000000-0000-0000-0000-0000000000a0', '{"studio":{}}', 1)$q$);
select pg_temp.ok('関数：自社の顧客の依頼を作れる', (public.airreach_request_create(:A, 'keyword', 'add', '{"text":"p1"}') ->> 'ok')::boolean);
select pg_temp.denied('関数：P2 の顧客の依頼は作れない（4引数）', $q$select public.airreach_request_create('00000000-0000-0000-0000-0000000000a2', 'keyword', 'add', '{"text":"y"}')$q$);
select pg_temp.denied('関数：P2 の顧客の依頼は作れない（補足つき）', $q$select public.airreach_request_create('00000000-0000-0000-0000-0000000000a2', 'keyword', 'add', '{"text":"y"}', 'n')$q$);
select pg_temp.denied('関数：TB の顧客の依頼は決められない', $q$select public.airreach_request_decide((select id from public.client_requests limit 1 offset 0), true, null) from (select 1) x where false union all select public.airreach_request_decide('00000000-0000-0000-0000-000000000000', true, null)$q$);
reset role;
create temp table tb_req as select id from public.client_requests where client_id = '00000000-0000-0000-0000-0000000000a0';
create temp table p2_req as select id from public.client_requests where client_id = '00000000-0000-0000-0000-0000000000a2';
grant select on tb_req, p2_req to authenticated;
set local role authenticated;
select pg_temp.as_user('p1@p1.test');
select pg_temp.denied('関数：TB の顧客の依頼は承認できない', $q$select public.airreach_request_decide((select id from tb_req), true, null)$q$);
select pg_temp.denied('関数：P2 の顧客の依頼は取り消せない', $q$select public.airreach_request_cancel((select id from p2_req))$q$);
select pg_temp.ok('関数：自社の顧客の依頼は承認できる', (public.airreach_request_decide((select id from public.client_requests where client_id = :A and payload ->> 'text' = 'x'), true, null) ->> 'ok')::boolean);
select pg_temp.ok('Google 連携：自社の顧客は許可', (public.airreach_google_access(:A) ->> 'allowed')::boolean);
select pg_temp.ok('Google 連携：TB の顧客は許可しない', not (public.airreach_google_access(:T) ->> 'allowed')::boolean);
select pg_temp.ok('Google 連携：顧客を指定しない連携の操作は許可', (public.airreach_google_access(null) ->> 'allowed')::boolean);
select pg_temp.denied('Google のデータの削除は TB の管理者だけ', $q$select public.airreach_delete_google_data('00000000-0000-0000-0000-0000000000a1', 'P1の顧客')$q$);

-- ---- 書き込み ----
select pg_temp.ok('書き込み：TB の顧客の施策は書き換わらない（0件）', pg_temp.n($q$update public.action_items set title = '改ざん' where client_id = '00000000-0000-0000-0000-0000000000a0'$q$) = 0);
select pg_temp.ok('書き込み：P2 の顧客のレポートは書き換わらない（0件）', pg_temp.n($q$update public.reports set conclusions = '["改ざん"]' where client_id = '00000000-0000-0000-0000-0000000000a2'$q$) = 0);
select pg_temp.denied('書き込み：TB の顧客に施策を足せない', $q$insert into public.action_items (client_id, title, status) values ('00000000-0000-0000-0000-0000000000a0', 'x', 'planned')$q$);
select pg_temp.denied('書き込み：P2 の顧客にお客様を招待できない', $q$insert into public.client_members (client_id, email) values ('00000000-0000-0000-0000-0000000000a2', 'evil@x.test')$q$);
select pg_temp.ok('書き込み：自社の顧客にお客様を招待できる', pg_temp.n($q$insert into public.client_members (client_id, email) values ('00000000-0000-0000-0000-0000000000a1', 'new@a1.test')$q$) = 1);
select pg_temp.ok('書き込み：自社の顧客の施策を足せる', pg_temp.n($q$insert into public.action_items (client_id, title, status) values ('00000000-0000-0000-0000-0000000000a1', '新しい施策', 'planned')$q$) = 1);
-- 顧客を作る：所属は自社に固定（ほかの会社や TB を指定しても自社になる）
select pg_temp.ok('顧客を作る：所属を指定しなくても自社の顧客になる', pg_temp.v($q$insert into public.clients (name) values ('P1の新しい顧客') returning org_id$q$) = '00000000-0000-0000-0000-0000000000f1');
select pg_temp.ok('顧客を作る：P2 を指定しても自社になる', pg_temp.v($q$insert into public.clients (name, org_id) values ('P1の新しい顧客2', '00000000-0000-0000-0000-0000000000f2') returning org_id$q$) = '00000000-0000-0000-0000-0000000000f1');
select pg_temp.denied('顧客の所属を P2 に移せない', $q$update public.clients set org_id = '00000000-0000-0000-0000-0000000000f2' where id = '00000000-0000-0000-0000-0000000000a1'$q$);
select pg_temp.denied('顧客の担当に TB の人は設定できない', $q$update public.clients set owner_email = 'tb@tb.test' where id = '00000000-0000-0000-0000-0000000000a1'$q$);
select pg_temp.ok('顧客の担当に自社の人は設定できる', pg_temp.n($q$update public.clients set owner_email = 'p1ap@p1.test' where id = '00000000-0000-0000-0000-0000000000a1'$q$) = 1);
select pg_temp.ok('顧客の削除は社内だけ（共同会社は0件）', pg_temp.n($q$delete from public.clients where id = '00000000-0000-0000-0000-0000000000a1'$q$) = 0);
select pg_temp.denied('人を追加できない（TB の管理者だけ）', $q$insert into public.staff_members (email, role, org_id) values ('x@p1.test', 'staff', '00000000-0000-0000-0000-0000000000f1')$q$);
select pg_temp.ok('自分を社内の人に書き換えられない（0件）', pg_temp.n($q$update public.staff_members set org_id = null where email = 'p1@p1.test'$q$) = 0);
select pg_temp.denied('共同会社を作れない', $q$insert into public.partner_orgs (name) values ('勝手な会社')$q$);

-- ---- 承認：共同会社の中で承認・公開できる（自社の顧客だけ）----
select pg_temp.ok('確認を依頼できる', pg_temp.n($q$update public.reports set status = 'in_review' where client_id = '00000000-0000-0000-0000-0000000000a1' and period_month = '2026-09-01'$q$) = 1);
select pg_temp.as_user('p1ap@p1.test');
select pg_temp.ok('共同会社の承認者が承認できる', pg_temp.n($q$update public.reports set status = 'approved' where client_id = '00000000-0000-0000-0000-0000000000a1' and period_month = '2026-09-01'$q$) = 1);
select pg_temp.ok('共同会社の承認者が公開できる', pg_temp.n($q$update public.reports set status = 'published' where client_id = '00000000-0000-0000-0000-0000000000a1' and period_month = '2026-09-01'$q$) = 1);
select pg_temp.ok('共同会社の承認者でも、TB の顧客のレポートは承認できない（0件）', pg_temp.n($q$update public.reports set status = 'in_review' where client_id = '00000000-0000-0000-0000-0000000000a0'$q$) = 0);

-- ---- TB の社内は今までどおり ----
select pg_temp.as_user('adm@tb.test');
select pg_temp.ok('TB の管理者は共同会社の人を追加できる', pg_temp.n($q$insert into public.staff_members (email, role, org_id) values ('p1b@p1.test', 'staff', '00000000-0000-0000-0000-0000000000f1')$q$) = 1);
select pg_temp.ok('TB の管理者は顧客を共同会社に割り当てられる', pg_temp.n($q$update public.clients set org_id = '00000000-0000-0000-0000-0000000000f2' where id = '00000000-0000-0000-0000-0000000000a0'$q$) = 1);
select pg_temp.as_user('p2@p2.test');
select pg_temp.ok('割り当てられた顧客は、その共同会社に見える', (select count(*) from public.clients where id = :T) = 1);
select pg_temp.as_user('p1@p1.test');
select pg_temp.ok('ほかの共同会社に割り当てた顧客は見えない', (select count(*) from public.clients where id = :T) = 0);

-- ---- 開通前の確認（2026-10-07 追加）：ID の直書き・割り当ての解除・人の解除 ----
reset role;
create temp table tb_rep as select id from public.reports where client_id = '00000000-0000-0000-0000-0000000000a0' and status = 'published' limit 1;
create temp table p2_rep as select id from public.reports where client_id = '00000000-0000-0000-0000-0000000000a2' limit 1;
grant select on tb_rep, p2_rep to authenticated;
set local role authenticated;
select pg_temp.as_user('p1@p1.test');
select pg_temp.ok('ID の直書き：TB の顧客の公開レポートを ID で開いても0件（PDF・印刷も作れない）', (select count(*) from public.reports where id = (select id from tb_rep)) = 0);
select pg_temp.ok('ID の直書き：P2 の顧客のレポートを ID で開いても0件', (select count(*) from public.reports where id = (select id from p2_rep)) = 0);
select pg_temp.ok('ID の直書き：TB の顧客の診断・計測・Studio を ID で読んでも0件', (select count(*) from public.measurement_runs where client_id = '00000000-0000-0000-0000-0000000000a0') = 0 and (select count(*) from public.studio_workspaces where client_id = '00000000-0000-0000-0000-0000000000a0') = 0 and (select count(*) from public.traffic_snapshots where client_id = '00000000-0000-0000-0000-0000000000a0') = 0);
select pg_temp.ok('ID の直書き：TB の顧客の依頼・お客様・サイトも0件', (select count(*) from public.client_requests where client_id = '00000000-0000-0000-0000-0000000000a0') = 0 and (select count(*) from public.client_members where client_id = '00000000-0000-0000-0000-0000000000a0') = 0 and (select count(*) from public.client_sites where client_id = '00000000-0000-0000-0000-0000000000a0') = 0);
-- 割り当てを外す（TB の管理者が顧客を TB に戻す）→ 共同会社の人からは見えなくなる
select pg_temp.as_user('adm@tb.test');
select pg_temp.ok('割り当ての解除：TB の管理者が P1 の顧客を TB に戻せる', pg_temp.n($q$update public.clients set org_id = null, owner_email = null where id = '00000000-0000-0000-0000-0000000000a1'$q$) = 1);
select pg_temp.as_user('p1@p1.test');
select pg_temp.ok('割り当ての解除後：共同会社の人には顧客もレポートも計測も見えない', (select count(*) from public.clients where id = :A) = 0 and (select count(*) from public.reports where client_id = :A) = 0 and (select count(*) from public.measurement_runs where client_id = :A) = 0);
select pg_temp.denied('割り当ての解除後：Studio にも保存できない', $q$select public.airreach_studio_save('00000000-0000-0000-0000-0000000000a1', '{"studio":{}}', 99)$q$);
-- 人の解除（TB の管理者が共同会社の人を消す）→ 社内向けの画面もデータも使えない
select pg_temp.as_user('adm@tb.test');
select pg_temp.ok('人の解除：TB の管理者が共同会社の人を消せる', pg_temp.n($q$delete from public.staff_members where email = 'p2@p2.test'$q$) = 1);
select pg_temp.as_user('p2@p2.test');
select pg_temp.ok('人の解除後：社内向けの画面を使えない（me.is_staff=false）', (select not (m ->> 'is_staff')::boolean from public.airreach_me() m));
select pg_temp.ok('人の解除後：自社の顧客だったものも0件', (select count(*) from public.clients) = 0 and (select count(*) from public.reports) = 0 and (select count(*) from public.studio_workspaces) = 0);
select pg_temp.denied('人の解除後：依頼の関数も使えない', $q$select public.airreach_client_settings('00000000-0000-0000-0000-0000000000a2')$q$);
rollback;
\echo ALL PASS
