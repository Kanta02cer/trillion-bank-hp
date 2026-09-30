-- 20260930120000_airreach_phase2_auth_reports の取り消し（本番で問題が出たときだけ使う）。
-- Phase 1（rule_versions・sites・scans ほか、RPC 2本）には触らない。
-- ⚠️ 顧客・レポート等 Phase 2 の行はすべて消える。実行前に必要な行を書き出しておくこと。
begin;

drop function if exists public.airreach_client_scans(uuid, integer);
drop function if exists public.airreach_me();

drop table if exists public.reports;
drop table if exists public.action_items;
drop table if exists public.traffic_snapshots;
drop table if exists public.measurement_runs;
drop table if exists public.client_sites;
drop table if exists public.client_members;
drop table if exists public.clients;
drop table if exists public.staff_members;

drop function if exists public.airreach_touch_updated_at();
drop function if exists public.airreach_is_member(uuid);
drop function if exists public.airreach_is_admin();
drop function if exists public.airreach_is_staff();
drop function if exists public.airreach_jwt_email();

-- migration 履歴（Supabase の apply_migration で記録された行）も消す
delete from supabase_migrations.schema_migrations where version = '20260930120000' or name = 'airreach_phase2_auth_reports';

commit;
