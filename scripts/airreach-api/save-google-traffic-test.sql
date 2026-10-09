-- お客様の Google の数字の保存（20261010120000_airreach_save_google_traffic）のテスト。ローカル Postgres で実行する。本番 DB では実行しない
\set QUIET on
begin;
insert into public.clients (id, name, status) values ('00000000-0000-0000-0000-0000000000a0', '契約中', 'active'), ('00000000-0000-0000-0000-0000000000a1', '終了', 'ended'), ('00000000-0000-0000-0000-0000000000a2', 'サイトなし', 'active');
insert into public.client_sites (client_id, url, host) values ('00000000-0000-0000-0000-0000000000a0', 'https://www.sample-salon.example/', 'sample-salon.example'), ('00000000-0000-0000-0000-0000000000a1', 'https://ended.example/', 'ended.example');
insert into public.client_members (client_id, email) values ('00000000-0000-0000-0000-0000000000a0', 'owner@c0.test');
create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_name; end if; raise notice 'PASS: %', p_name; end $$;
create or replace function pg_temp.denied(p_name text, p_sql text) returns void language plpgsql as $$
begin begin execute p_sql; exception when others then raise notice 'PASS: % (%)', p_name, sqlerrm; return; end; raise exception 'FAIL: % (通ってしまった)', p_name; end $$;
grant execute on function pg_temp.ok(text, boolean), pg_temp.denied(text, text) to authenticated, service_role;
set local role service_role;
select pg_temp.ok('サーバー：登録したサイトの Search Console（sc-domain）を保存できる', (public.airreach_save_google_traffic('00000000-0000-0000-0000-0000000000a0', '2026-10-01', 'gsc_api', '{"clicks":12,"impressions":340,"property":"sc-domain:sample-salon.example"}', 'owner@c0.test') ->> 'ok')::boolean);
reset role;
select pg_temp.ok('保存した人（お客様）が created_by に残る', (select created_by = 'owner@c0.test' and (metrics ->> 'clicks')::int = 12 from public.traffic_snapshots where source = 'gsc_api'));
set local role service_role;
select pg_temp.ok('https://www.〜/ の形も同じサイト', (public.airreach_save_google_traffic('00000000-0000-0000-0000-0000000000a0', '2026-09-01', 'gsc_api', '{"clicks":3,"property":"https://www.sample-salon.example/"}', 'owner@c0.test') ->> 'ok')::boolean);
select pg_temp.ok('やり直しの保存', (public.airreach_save_google_traffic('00000000-0000-0000-0000-0000000000a0', '2026-10-01', 'gsc_api', '{"clicks":15,"property":"sc-domain:sample-salon.example"}', 'owner@c0.test') ->> 'ok')::boolean);
select pg_temp.ok('別のサイトの Search Console は保存しない（site_mismatch）', (public.airreach_save_google_traffic('00000000-0000-0000-0000-0000000000a0', '2026-10-01', 'gsc_api', '{"clicks":999,"property":"sc-domain:other-shop.example"}', 'owner@c0.test') ->> 'reason') = 'site_mismatch');
reset role;
select pg_temp.ok('同じ月・同じ種類はやり直しで上書き（行は増えない）・別サイトの数字は入っていない', (select count(*) = 1 and bool_and((metrics ->> 'clicks')::int = 15) from public.traffic_snapshots where source = 'gsc_api' and period_month = '2026-10-01'));
set local role service_role;
select pg_temp.ok('GA4：対象ホストが登録したサイトなら保存', (public.airreach_save_google_traffic('00000000-0000-0000-0000-0000000000a0', '2026-10-01', 'ga4_api', '{"sessions":80,"conversions":4,"host":"www.sample-salon.example","property_id":"123"}', 'owner@c0.test') ->> 'ok')::boolean);
select pg_temp.ok('GA4：別のホストは保存しない', (public.airreach_save_google_traffic('00000000-0000-0000-0000-0000000000a0', '2026-10-01', 'ga4_api', '{"sessions":1,"host":"other-shop.example"}', 'owner@c0.test') ->> 'reason') = 'site_mismatch');
select pg_temp.ok('契約が終わった顧客には保存しない', (public.airreach_save_google_traffic('00000000-0000-0000-0000-0000000000a1', '2026-10-01', 'gsc_api', '{"property":"sc-domain:ended.example"}', 'x') ->> 'reason') = 'not_contracted');
select pg_temp.ok('サイトを登録していない顧客には保存しない', (public.airreach_save_google_traffic('00000000-0000-0000-0000-0000000000a2', '2026-10-01', 'gsc_api', '{"property":"sc-domain:x.example"}', 'x') ->> 'reason') = 'no_site');
select pg_temp.denied('決まっていない種類（CSV など）は入れない', $q$select public.airreach_save_google_traffic('00000000-0000-0000-0000-0000000000a0', '2026-10-01', 'gsc_csv', '{}', 'x')$q$);
select pg_temp.denied('月の初日でない日付は入れない', $q$select public.airreach_save_google_traffic('00000000-0000-0000-0000-0000000000a0', '2026-10-05', 'gsc_api', '{"property":"sc-domain:sample-salon.example"}', 'x')$q$);
select pg_temp.denied('大きすぎる数字の記録は入れない', $q$select public.airreach_save_google_traffic('00000000-0000-0000-0000-0000000000a0', '2026-10-01', 'gsc_api', jsonb_build_object('property', 'sc-domain:sample-salon.example', 'x', repeat('a', 30000)), 'x')$q$);
reset role;
select pg_temp.ok('ログインした人（お客様・担当者）は呼べない', not has_function_privilege('authenticated', 'public.airreach_save_google_traffic(uuid, date, text, jsonb, text)', 'execute'));
select pg_temp.ok('anon は呼べない', not has_function_privilege('anon', 'public.airreach_save_google_traffic(uuid, date, text, jsonb, text)', 'execute'));
select pg_temp.ok('サーバー（service_role）だけが呼べる', has_function_privilege('service_role', 'public.airreach_save_google_traffic(uuid, date, text, jsonb, text)', 'execute'));
select 'ALL PASSED' as result;
rollback;
