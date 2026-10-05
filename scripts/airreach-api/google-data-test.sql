-- Google のユーザーデータの扱い（20261007120000_airreach_google_data_governance）のテスト
--   ローカル Postgres で実行する。本番 DB では実行しない。
--   前提: supabase/migrations の 20261007120000 までを適用済み（pg_cron の 20261007130000 は不要）。
--   実行: psql -d <db> -v ON_ERROR_STOP=1 -f scripts/airreach-api/google-data-test.sql
\set QUIET on
begin;
insert into public.staff_members (email, role) values ('admin@tb.test', 'admin'), ('staff@tb.test', 'staff');
insert into public.clients (id, name, status) values
  ('00000000-0000-0000-0000-0000000000a1', '顧客A', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', '顧客B', 'active'),
  ('00000000-0000-0000-0000-0000000000a3', '顧客C（終了）', 'active'),
  ('00000000-0000-0000-0000-0000000000a4', '顧客D（最近終了）', 'active');
insert into public.client_members (client_id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'm@a.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'm@c.test');

-- 各顧客に Google 由来のデータを入れる（A・B・C・D）
insert into public.traffic_snapshots (client_id, period_month, source, metrics)
select id, '2026-09-01', 'gsc_api', '{"clicks": 10, "impressions": 100, "google_email": "x@example.test"}'::jsonb from public.clients;
insert into public.traffic_snapshots (client_id, period_month, source, metrics)
select id, '2026-09-01', 'ga4_api', '{"sessions": 50, "conversions": 2}'::jsonb from public.clients;
insert into public.studio_workspaces (client_id, data, updated_by)
select id, '{"studio": {"measurements": [{"keyword": "q", "impressions": 5}]}}'::jsonb, 'staff@tb.test' from public.clients;
insert into public.measurement_runs (client_id, measured_on, source, summary)
select id, '2026-09-15', 'manual', '{"by": []}'::jsonb from public.clients;
insert into public.reports (client_id, period_month, status, compiled, conclusions)
select id, '2026-09-01', 'draft',
  '{"version": "report-v1", "traffic": {"gsc": {"clicks": 10}}, "history": [{"month": "2026-09-01", "score": 70, "clicks": 10, "conversions": 2}],
    "facts": ["ホームページの情報整備：70点", "検索からのクリック：8 → 10"], "site": {"x": 1}}'::jsonb,
  '["結論の文"]'::jsonb
from public.clients;

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

-- ---- 契約終了日（トリガー）----------------------------------------------------
select pg_temp.ok('契約中は終了日なし', (select ended_at is null from public.clients where id = '00000000-0000-0000-0000-0000000000a3'));
update public.clients set status = 'ended' where id in ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a4');
select pg_temp.ok('ended にすると終了日が入る', (select ended_at is not null from public.clients where id = '00000000-0000-0000-0000-0000000000a3'));
update public.clients set ended_at = now() - interval '1000 days', google_purged_at = now() where id = '00000000-0000-0000-0000-0000000000a4';
select pg_temp.ok('終了日・削除日時は直接変えられない', (select ended_at > now() - interval '1 day' and google_purged_at is null from public.clients where id = '00000000-0000-0000-0000-0000000000a4'));
update public.clients set status = 'active' where id = '00000000-0000-0000-0000-0000000000a4';
select pg_temp.ok('契約中に戻すと終了日が消える', (select ended_at is null from public.clients where id = '00000000-0000-0000-0000-0000000000a4'));
update public.clients set status = 'ended' where id = '00000000-0000-0000-0000-0000000000a4';
-- テストのため、C を 85 日前・D を 10 日前に終了したことにする（トリガーを止めて直接入れる）
alter table public.clients disable trigger clients_google_guard;
update public.clients set ended_at = now() - interval '85 days' where id = '00000000-0000-0000-0000-0000000000a3';
update public.clients set ended_at = now() - interval '10 days' where id = '00000000-0000-0000-0000-0000000000a4';
alter table public.clients enable trigger clients_google_guard;

set local role authenticated;

-- ---- Google 連携を使ってよい人 --------------------------------------------------
select pg_temp.as_user('');
select pg_temp.ok('ログインしていない → 使えない', (public.airreach_google_access(null) ->> 'reason') = 'login_required');
select pg_temp.as_user('staff@tb.test');
select pg_temp.ok('社内スタッフ → 使える', (public.airreach_google_access(null) ->> 'allowed')::boolean);
select pg_temp.ok('社内スタッフは顧客の画面でも使える', (public.airreach_google_access('00000000-0000-0000-0000-0000000000a2') ->> 'allowed')::boolean);
select pg_temp.ok('契約が終わった顧客は、社内スタッフでも新しく取得しない', (public.airreach_google_access('00000000-0000-0000-0000-0000000000a3') ->> 'reason') = 'contract_ended');
select pg_temp.as_user('m@a.test');
select pg_temp.ok('契約中の顧客のメンバー → 自社なら使える', (public.airreach_google_access('00000000-0000-0000-0000-0000000000a1') ->> 'allowed')::boolean);
select pg_temp.ok('契約中の顧客のメンバー → 他社では使えない', not (public.airreach_google_access('00000000-0000-0000-0000-0000000000a2') ->> 'allowed')::boolean);
select pg_temp.ok('契約中の顧客のメンバー → 顧客を指定しない画面でも使える', (public.airreach_google_access(null) ->> 'allowed')::boolean);
select pg_temp.as_user('m@c.test');
select pg_temp.ok('契約が終わった顧客のメンバー → 使えない', (public.airreach_google_access('00000000-0000-0000-0000-0000000000a3') ->> 'reason') = 'contract_ended');
select pg_temp.ok('契約が終わった顧客のメンバー → 顧客を指定しなくても使えない', (public.airreach_google_access(null) ->> 'reason') = 'not_contracted');
select pg_temp.as_user('x@stranger.test');
select pg_temp.ok('関係ない人 → 使えない', (public.airreach_google_access(null) ->> 'reason') = 'not_contracted');

-- ---- 削除依頼（管理者だけ・顧客名の確認つき）--------------------------------------
select pg_temp.as_user('staff@tb.test');
select pg_temp.denied('管理者でないスタッフは消せない', $q$select public.airreach_delete_google_data('00000000-0000-0000-0000-0000000000a1', '顧客A', null)$q$);
select pg_temp.denied('画面から本体の関数は呼べない', $q$select public.airreach_purge_google_data('00000000-0000-0000-0000-0000000000a1', 'user_request', 'x', null)$q$);
select pg_temp.denied('画面から期限切れの削除は呼べない', $q$select public.airreach_purge_expired_google_data(80)$q$);
select pg_temp.denied('削除の記録に直接書けない', $q$insert into public.google_data_deletions (client_id, reason, executed_by) values ('00000000-0000-0000-0000-0000000000a1', 'user_request', 'x')$q$);
select pg_temp.as_user('m@a.test');
select pg_temp.denied('お客様は消せない', $q$select public.airreach_delete_google_data('00000000-0000-0000-0000-0000000000a1', '顧客A', null)$q$);
select pg_temp.as_user('admin@tb.test');
select pg_temp.denied('顧客名が違うと消さない', $q$select public.airreach_delete_google_data('00000000-0000-0000-0000-0000000000a1', '顧客B', null)$q$);
select pg_temp.ok('管理者が顧客名を確かめて消す', (public.airreach_delete_google_data('00000000-0000-0000-0000-0000000000a1', '顧客A', '削除依頼 2026-10-07') ->> 'ok')::boolean);
select pg_temp.ok('A の検索・訪問の数字が消えた', (select count(*) from public.traffic_snapshots where client_id = '00000000-0000-0000-0000-0000000000a1') = 0);
select pg_temp.ok('A の Studio の作業が消えた', (select count(*) from public.studio_workspaces where client_id = '00000000-0000-0000-0000-0000000000a1') = 0);
select pg_temp.ok('A の AI 計測の記録が消えた', (select count(*) from public.measurement_runs where client_id = '00000000-0000-0000-0000-0000000000a1') = 0);
select pg_temp.ok('A のレポートは残る', (select count(*) from public.reports where client_id = '00000000-0000-0000-0000-0000000000a1') = 1);
select pg_temp.ok('A のレポートから検索・訪問の数字が消えた',
  (select not (compiled ? 'traffic') and (compiled -> 'history' -> 0 -> 'clicks') = 'null'::jsonb and (compiled -> 'history' -> 0 -> 'conversions') = 'null'::jsonb
     and (compiled -> 'history' -> 0 ->> 'score') = '70' and jsonb_array_length(compiled -> 'facts') = 1 and (compiled -> 'facts' ->> 0) like 'ホームページ%'
     and compiled ? 'googleDataRemovedAt' and (compiled -> 'site') = '{"x": 1}'::jsonb
   from public.reports where client_id = '00000000-0000-0000-0000-0000000000a1'));
select pg_temp.ok('A のレポートの結論（担当者の文）は残る', (select conclusions = '["結論の文"]'::jsonb from public.reports where client_id = '00000000-0000-0000-0000-0000000000a1'));
select pg_temp.ok('A の削除日時が入った', (select google_purged_at is not null from public.clients where id = '00000000-0000-0000-0000-0000000000a1'));
select pg_temp.ok('B のデータはそのまま', (select count(*) from public.traffic_snapshots where client_id = '00000000-0000-0000-0000-0000000000a2') = 2
  and (select count(*) from public.studio_workspaces where client_id = '00000000-0000-0000-0000-0000000000a2') = 1
  and (select compiled ? 'traffic' from public.reports where client_id = '00000000-0000-0000-0000-0000000000a2'));
select pg_temp.ok('削除の記録が残る（件数・理由・実行した人）',
  (select reason = 'user_request' and executed_by = 'admin@tb.test' and client_name = '顧客A' and request_note = '削除依頼 2026-10-07'
     and (counts ->> 'traffic_snapshots')::int = 2 and (counts ->> 'studio_workspaces')::int = 1 and (counts ->> 'measurement_runs')::int = 1 and (counts ->> 'reports_cleaned')::int = 1
   from public.google_data_deletions where client_id = '00000000-0000-0000-0000-0000000000a1'));
select pg_temp.ok('削除の記録に Google のデータ本体は入らない',
  (select position('x@example.test' in t) = 0 and position('impressions' in t) = 0 from (select row_to_json(d)::text t from public.google_data_deletions d) x));
select pg_temp.ok('社内は削除の記録を読める', (select count(*) from public.google_data_deletions) = 1);
select pg_temp.as_user('m@a.test');
select pg_temp.ok('お客様は削除の記録を読めない', (select count(*) from public.google_data_deletions) = 0);

-- ---- 契約終了から 80 日たった顧客を消す（毎日の実行）--------------------------------
reset role;
set local role service_role;
reset role;
select pg_temp.denied('90 日以上は指定できない', $q$select public.airreach_purge_expired_google_data(90)$q$);
set local role service_role;
select pg_temp.ok('毎日の実行で 1 社（C）を消す', (public.airreach_purge_expired_google_data(80) ->> 'purged')::int = 1);
reset role;
select pg_temp.ok('C（85日前に終了）は消えた', (select count(*) from public.traffic_snapshots where client_id = '00000000-0000-0000-0000-0000000000a3') = 0
  and (select count(*) from public.studio_workspaces where client_id = '00000000-0000-0000-0000-0000000000a3') = 0
  and (select count(*) from public.measurement_runs where client_id = '00000000-0000-0000-0000-0000000000a3') = 0);
select pg_temp.ok('D（10日前に終了）はまだ消さない', (select count(*) from public.traffic_snapshots where client_id = '00000000-0000-0000-0000-0000000000a4') = 2);
select pg_temp.ok('C の記録は contract_end・system:retention', (select reason = 'contract_end' and executed_by = 'system:retention' from public.google_data_deletions where client_id = '00000000-0000-0000-0000-0000000000a3'));
set local role service_role;
select pg_temp.ok('もう一度実行しても同じ顧客を二重に消さない', (public.airreach_purge_expired_google_data(80) ->> 'purged')::int = 0);
reset role;
select pg_temp.ok('記録は 2 件のまま', (select count(*) from public.google_data_deletions) = 2);
rollback;
\echo ALL PASS
