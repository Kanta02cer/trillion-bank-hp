-- お客様の Google のつながりの保管と、語句ごとの取り込み（20261017120000_airreach_google_connections）のテスト。
-- ローカル Postgres で実行する。本番 DB では実行しない
\set QUIET on
begin;
insert into public.clients (id, name, status) values ('00000000-0000-0000-0000-0000000000c0', '契約中', 'active'), ('00000000-0000-0000-0000-0000000000c1', '終了', 'ended'), ('00000000-0000-0000-0000-0000000000c2', '別の会社', 'active');
insert into public.client_sites (client_id, url, host) values ('00000000-0000-0000-0000-0000000000c0', 'https://www.sample-salon.example/', 'sample-salon.example'), ('00000000-0000-0000-0000-0000000000c1', 'https://ended.example/', 'ended.example'), ('00000000-0000-0000-0000-0000000000c2', 'https://other-shop.example/', 'other-shop.example');
insert into public.client_members (client_id, email) values ('00000000-0000-0000-0000-0000000000c0', 'owner@c0.test'), ('00000000-0000-0000-0000-0000000000c2', 'owner@c2.test');
create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_name; end if; raise notice 'PASS: %', p_name; end $$;
create or replace function pg_temp.denied(p_name text, p_sql text) returns void language plpgsql as $$
begin begin execute p_sql; exception when others then raise notice 'PASS: % (%)', p_name, sqlerrm; return; end; raise exception 'FAIL: % (通ってしまった)', p_name; end $$;
create or replace function pg_temp.as_user(p_email text) returns void language sql as $$ select set_config('request.jwt.claims', jsonb_build_object('email', p_email, 'role', 'authenticated')::text, true) $$;
grant execute on function pg_temp.ok(text, boolean), pg_temp.denied(text, text), pg_temp.as_user(text) to authenticated, service_role;

-- 1) つながりの保存（サーバー）
set local role service_role;
select pg_temp.ok('サーバー：暗号化したトークンでつながりを保存できる', (public.airreach_save_google_connection('00000000-0000-0000-0000-0000000000c0', 'v1.aaaaaaaaaaaaaaaaaaaaaaaa.bbbb.cccc', array['gsc','ga4'], 'owner@gmail.test') ->> 'ok')::boolean);
select pg_temp.denied('暗号化していないトークン（v1. で始まらない）は入れない', $q$select public.airreach_save_google_connection('00000000-0000-0000-0000-0000000000c0', '1//plain-refresh-token-xxxxxxxx', array['gsc'], 'x@test')$q$);
select pg_temp.ok('契約が終わった顧客には保存しない', (public.airreach_save_google_connection('00000000-0000-0000-0000-0000000000c1', 'v1.aaaaaaaaaaaaaaaaaaaaaaaa.bbbb.cccc', array['gsc'], 'x@test') ->> 'reason') = 'not_contracted');

-- 2) サイトの選択
select pg_temp.ok('登録したサイトの Search Console（所有者）を選べる', (public.airreach_set_gsc_property('00000000-0000-0000-0000-0000000000c0', 'sc-domain:sample-salon.example', 'siteOwner', 'owner@c0.test') ->> 'ok')::boolean);
select pg_temp.ok('別のサイトは選べない（site_mismatch）', (public.airreach_set_gsc_property('00000000-0000-0000-0000-0000000000c0', 'sc-domain:other-shop.example', 'siteOwner', 'owner@c0.test') ->> 'reason') = 'site_mismatch');
select pg_temp.ok('権限がない（未確認ユーザー）サイトは選べない', (public.airreach_set_gsc_property('00000000-0000-0000-0000-0000000000c0', 'https://www.sample-salon.example/', 'siteUnverifiedUser', 'owner@c0.test') ->> 'reason') = 'no_permission');
select pg_temp.ok('つながっていない顧客はサイトを選べない', (public.airreach_set_gsc_property('00000000-0000-0000-0000-0000000000c2', 'sc-domain:other-shop.example', 'siteOwner', 'owner@c2.test') ->> 'reason') = 'not_connected');

-- 3) 語句ごとの保存
select pg_temp.ok('語句 × ページを保存できる', (public.airreach_save_gsc_queries('00000000-0000-0000-0000-0000000000c0', '2026-09-01', 'sc-domain:sample-salon.example',
  '[{"query":"大宮 美容室","page":"https://www.sample-salon.example/","clicks":12,"impressions":340,"ctr":0.035,"position":4.2},{"query":"大宮 ヘッドスパ","page":"https://www.sample-salon.example/spa/","clicks":3,"impressions":90,"ctr":0.033,"position":7.9}]') ->> 'rows')::int = 2);
select pg_temp.ok('同じ月は入れ替え（前の行は残らない）', (public.airreach_save_gsc_queries('00000000-0000-0000-0000-0000000000c0', '2026-09-01', 'sc-domain:sample-salon.example',
  '[{"query":"大宮 美容室","page":"https://www.sample-salon.example/","clicks":15,"impressions":400,"ctr":0.0375,"position":3.9}]') ->> 'rows')::int = 1);
reset role;
select pg_temp.ok('入れ替え後は1行・新しい数字', (select count(*) = 1 and min(clicks) = 15 from public.gsc_query_snapshots where client_id = '00000000-0000-0000-0000-0000000000c0' and period_month = '2026-09-01'));
set local role service_role;
select pg_temp.ok('別のサイトの語句は保存しない', (public.airreach_save_gsc_queries('00000000-0000-0000-0000-0000000000c0', '2026-09-01', 'sc-domain:other-shop.example', '[{"query":"x","page":"https://other-shop.example/","clicks":1,"impressions":1}]') ->> 'reason') = 'site_mismatch');
select pg_temp.denied('5,001 行以上は入れない', $q$select public.airreach_save_gsc_queries('00000000-0000-0000-0000-0000000000c0', '2026-08-01', 'sc-domain:sample-salon.example', (select jsonb_agg(jsonb_build_object('query', 'q' || i, 'page', 'https://www.sample-salon.example/', 'clicks', 1, 'impressions', 1)) from generate_series(1, 5001) i))$q$);
select pg_temp.denied('月の初日でない日付は入れない', $q$select public.airreach_save_gsc_queries('00000000-0000-0000-0000-0000000000c0', '2026-08-15', 'sc-domain:sample-salon.example', '[]')$q$);
select pg_temp.ok('取り込みの対象：サイトを選んだ契約中のつながりだけ', (select count(*) = 1 and bool_and(client_id = '00000000-0000-0000-0000-0000000000c0') from public.airreach_google_sync_targets()));
select public.airreach_mark_google_sync('00000000-0000-0000-0000-0000000000c0', 'ok', null);
reset role;
select pg_temp.ok('取り込みの結果が残る', (select last_sync_status = 'ok' and last_sync_at is not null from public.google_connections where client_id = '00000000-0000-0000-0000-0000000000c0'));

-- 4) 画面（ログインした人）からの見え方
set local role authenticated;
select pg_temp.as_user('owner@c0.test');
select pg_temp.denied('お客様はトークンの表を直接読めない', $q$select refresh_token_enc from public.google_connections$q$);
select pg_temp.ok('お客様は状態を見られる（トークンは返らない）', (select (s ->> 'connected')::boolean and (s ->> 'owner_verified')::boolean and s ->> 'gsc_property' = 'sc-domain:sample-salon.example' and not (s ? 'refresh_token_enc') from public.airreach_google_connection_status('00000000-0000-0000-0000-0000000000c0') s));
select pg_temp.ok('お客様は自社の語句のデータを読める', (select count(*) = 1 from public.gsc_query_snapshots));
select pg_temp.denied('お客様は語句のデータを書けない', $q$insert into public.gsc_query_snapshots (client_id, period_month, query, page, property) values ('00000000-0000-0000-0000-0000000000c0', '2026-07-01', 'x', 'y', 'z')$q$);
select pg_temp.denied('お客様は保存の関数を呼べない', $q$select public.airreach_save_gsc_queries('00000000-0000-0000-0000-0000000000c0', '2026-07-01', 'sc-domain:sample-salon.example', '[]')$q$);
select pg_temp.as_user('owner@c2.test');
select pg_temp.ok('別の会社の人は状態を見られない', (public.airreach_google_connection_status('00000000-0000-0000-0000-0000000000c0') ->> 'reason') = 'forbidden');
select pg_temp.ok('別の会社の人には語句のデータが見えない', (select count(*) = 0 from public.gsc_query_snapshots));
reset role;
set local role anon;
select pg_temp.denied('ログインしていない人は状態の関数を呼べない', $q$select public.airreach_google_connection_status('00000000-0000-0000-0000-0000000000c0')$q$);
reset role;

-- 5) 別のアカウントでつなぎ直すと、選んだサイトは選び直し
set local role service_role;
select public.airreach_save_google_connection('00000000-0000-0000-0000-0000000000c0', 'v1.dddddddddddddddddddddddd.eeee.ffff', array['gsc'], 'another@gmail.test');
reset role;
select pg_temp.ok('別のアカウントでつなぎ直すとサイトの選択が消える', (select gsc_property is null and gsc_permission is null from public.google_connections where client_id = '00000000-0000-0000-0000-0000000000c0'));

-- 6) Google のデータを消すと、つながりと語句のデータも消える
select public.airreach_purge_google_data('00000000-0000-0000-0000-0000000000c0', 'user_request', 'test@tb.test');
select pg_temp.ok('データを消すと、つながりが消える', (select count(*) = 0 from public.google_connections where client_id = '00000000-0000-0000-0000-0000000000c0'));
select pg_temp.ok('データを消すと、語句のデータも消える', (select count(*) = 0 from public.gsc_query_snapshots where client_id = '00000000-0000-0000-0000-0000000000c0'));
rollback;
