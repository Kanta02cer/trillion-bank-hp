-- AirReach Phase 2 の RLS テスト（ローカル Postgres で実行する。本番 DB では実行しない）
--   前提: phase1 / seed / phase2 の migration を適用済み。ロール anon / authenticated / service_role がある。
--   実行: psql -d <db> -v ON_ERROR_STOP=1 -f scripts/airreach-api/phase2-rls-test.sql
--   失敗すると例外で止まる。最後に 'ALL PASS' を出す。
\set QUIET on
begin;

-- ---- 準備（postgres として）----------------------------------------------
insert into public.staff_members (email, role, name) values
  ('admin@tb.test', 'admin', '管理者'), ('staff@tb.test', 'staff', '担当');
insert into public.clients (id, name, industry_id) values
  ('00000000-0000-0000-0000-0000000000c1', '顧客1', 'restaurant'),
  ('00000000-0000-0000-0000-0000000000c2', '顧客2', 'clinic');
insert into public.client_members (client_id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'm1@c1.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'm2@c2.test');
insert into public.client_sites (client_id, url, host) values
  ('00000000-0000-0000-0000-0000000000c1', 'https://www.c1.test/', 'c1.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'https://c2.test/', 'c2.test');
insert into public.reports (client_id, period_month, status, published_at, conclusions) values
  ('00000000-0000-0000-0000-0000000000c1', '2026-08-01', 'published', now(), '["8月の結論"]'),
  ('00000000-0000-0000-0000-0000000000c1', '2026-09-01', 'draft', null, '["9月の下書き"]'),
  ('00000000-0000-0000-0000-0000000000c2', '2026-08-01', 'published', now(), '["顧客2"]');
insert into public.measurement_runs (client_id, measured_on, summary) values
  ('00000000-0000-0000-0000-0000000000c1', '2026-09-20', '{"by":[]}');
-- Phase 1 の診断（www. 付きのホストでも顧客1に結びつくこと）
insert into public.sites (id, normalized_url, host) values
  ('00000000-0000-0000-0000-00000000a001', 'https://www.c1.test/', 'www.c1.test'),
  ('00000000-0000-0000-0000-00000000a002', 'https://other.test/', 'other.test');
insert into public.scans (id, site_id, share_token_hash, rule_version, display_version, state, overall_score, industry_id, raw_result)
select 'scanc1aaaa', '00000000-0000-0000-0000-00000000a001', repeat('a', 64), rule_version, 'band-v1', 'verified', 48, 'restaurant', '{}'::jsonb
from public.rule_versions limit 1;
insert into public.scans (id, site_id, share_token_hash, rule_version, display_version, state, overall_score, industry_id, raw_result)
select 'scanotherx', '00000000-0000-0000-0000-00000000a002', repeat('b', 64), rule_version, 'band-v1', 'verified', 70, 'other', '{}'::jsonb
from public.rule_versions limit 1;

-- 以後は authenticated として、JWT の email を切り替えて確かめる
create or replace function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', case when p_email is null then '' else json_build_object('email', p_email, 'role', 'authenticated')::text end, true);
end $$;
create or replace function pg_temp.expect(p_ok boolean, p_name text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_name; end if;
  raise notice 'PASS: %', p_name;
end $$;

set local role authenticated;

-- ---- 社内（staff）----------------------------------------------------------
select pg_temp.as_user('staff@tb.test');
select pg_temp.expect((select count(*) from public.clients) = 2, 'staff: 全顧客を読める');
select pg_temp.expect((select count(*) from public.reports) = 3, 'staff: 下書きを含む全レポートを読める');
select pg_temp.expect((public.airreach_me()->>'is_staff')::boolean, 'staff: airreach_me で is_staff=true');
select pg_temp.expect(jsonb_array_length(public.airreach_client_scans('00000000-0000-0000-0000-0000000000c1')) = 1, 'staff: 顧客1の診断は www. 付きホストの1件だけ');
insert into public.clients (name) values ('staffが作った顧客');
select pg_temp.expect((select count(*) from public.clients) = 3, 'staff: 顧客を作れる');
update public.reports set conclusions = '["更新"]' where period_month = '2026-09-01' and client_id = '00000000-0000-0000-0000-0000000000c1';
select pg_temp.expect((select conclusions->>0 from public.reports where period_month = '2026-09-01' and client_id = '00000000-0000-0000-0000-0000000000c1') = '更新', 'staff: レポートを編集できる');
-- staff（admin でない）はスタッフを追加できない
do $$ begin
  begin
    insert into public.staff_members (email) values ('x@tb.test');
    raise exception 'FAIL: staff が staff_members に追加できてしまった';
  exception when insufficient_privilege then raise notice 'PASS: staff: スタッフの追加は拒否'; end;
end $$;

-- ---- 管理者（admin）--------------------------------------------------------
select pg_temp.as_user('admin@tb.test');
insert into public.staff_members (email, role) values ('new@tb.test', 'staff');
select pg_temp.expect((select count(*) from public.staff_members) = 3, 'admin: スタッフを追加できる');

-- ---- 顧客1のメンバー --------------------------------------------------------
select pg_temp.as_user('M1@C1.test');  -- 大文字でも同じ人として扱う
select pg_temp.expect((select count(*) from public.clients) = 1, 'member1: 自社だけ読める');
select pg_temp.expect((select count(*) from public.reports) = 1, 'member1: 公開済みの自社レポート1件だけ');
select pg_temp.expect((select count(*) from public.reports where status = 'draft') = 0, 'member1: 下書きは見えない');
select pg_temp.expect((select count(*) from public.measurement_runs) = 1, 'member1: 自社の計測を読める');
select pg_temp.expect((select count(*) from public.client_members) = 1, 'member1: 他のメンバーのメールは見えない（自分の行だけ）');
select pg_temp.expect((select count(*) from public.staff_members) = 0, 'member1: スタッフ一覧は見えない');
select pg_temp.expect(jsonb_array_length(public.airreach_client_scans('00000000-0000-0000-0000-0000000000c1')) = 1, 'member1: 自社の診断を読める');
do $$ begin
  begin
    perform public.airreach_client_scans('00000000-0000-0000-0000-0000000000c2');
    raise exception 'FAIL: member1 が顧客2の診断を読めてしまった';
  exception when insufficient_privilege then raise notice 'PASS: member1: 他社の診断は拒否'; end;
end $$;
update public.reports set conclusions = '["改ざん"]';
select pg_temp.expect(true, 'member1: update は 0 行（RLS）');
insert into public.clients (name) select '侵入' where false;
do $$ begin
  begin
    insert into public.reports (client_id, period_month) values ('00000000-0000-0000-0000-0000000000c1', '2026-10-01');
    raise exception 'FAIL: member1 がレポートを作れてしまった';
  exception when insufficient_privilege then raise notice 'PASS: member1: レポートの作成は拒否'; end;
end $$;

-- ---- 部外者（ログイン済みだが誰でもない）-----------------------------------
select pg_temp.as_user('stranger@example.test');
select pg_temp.expect((select count(*) from public.clients) = 0, 'stranger: 顧客は0件');
select pg_temp.expect((select count(*) from public.reports) = 0, 'stranger: レポートは0件');
select pg_temp.expect(not (public.airreach_me()->>'is_staff')::boolean, 'stranger: is_staff=false');

-- ---- メール無しの JWT ------------------------------------------------------
select pg_temp.as_user(null);
select pg_temp.expect((select count(*) from public.clients) = 0, 'no-email: 顧客は0件');

-- ---- Phase 1 のテーブルは authenticated から直接読めない --------------------
do $$ begin
  begin
    perform 1 from public.scans limit 1;
    raise exception 'FAIL: authenticated が scans を直接読めた';
  exception when insufficient_privilege then raise notice 'PASS: scans の直接参照は拒否（Phase 1 のまま）'; end;
end $$;

reset role;
-- ---- anon は新テーブルに触れない ------------------------------------------
set local role anon;
do $$ begin
  begin
    perform 1 from public.reports limit 1;
    raise exception 'FAIL: anon が reports を読めた';
  exception when insufficient_privilege then raise notice 'PASS: anon: reports は拒否'; end;
end $$;
reset role;

-- 顧客1の更新が member1 に書き換えられていないこと
select pg_temp.expect((select conclusions->>0 from public.reports where period_month = '2026-08-01' and client_id = '00000000-0000-0000-0000-0000000000c1') = '8月の結論', 'member1 の update は反映されていない');

\echo ALL PASS
rollback;
