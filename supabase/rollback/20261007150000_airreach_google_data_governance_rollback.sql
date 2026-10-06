-- 20261007150000_airreach_google_data_governance の取り消し（本番で問題が出たときだけ使う）。
-- ⚠️ 削除の記録（google_data_deletions）も消える。監査のため、実行前に書き出しておくこと。
-- ⚠️ 消した Google 由来のデータは、取り消しても戻らない。
-- pg_cron を登録していたら、先に外す: select cron.unschedule('airreach-google-retention');
begin;

drop function if exists public.airreach_purge_expired_google_data(integer);
drop function if exists public.airreach_delete_google_data(uuid, text, text);
drop function if exists public.airreach_purge_google_data(uuid, text, text, text);
drop function if exists public.airreach_google_access(uuid);
drop table if exists public.google_data_deletions;
drop trigger if exists clients_google_guard on public.clients;
drop function if exists public.airreach_clients_google_guard();
alter table public.clients drop column if exists google_purged_at;
alter table public.clients drop column if exists ended_at;

commit;
