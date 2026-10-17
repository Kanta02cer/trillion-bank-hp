-- 20261017120000_airreach_google_connections の取り消し。保管していたつながり（暗号化したトークン）と語句のデータも消える
drop trigger if exists airreach_purge_google_connection on public.clients;
drop function if exists public.airreach_purge_google_connection_on_purge();
drop function if exists public.airreach_google_sync_targets();
drop function if exists public.airreach_google_connection_status(uuid);
drop function if exists public.airreach_delete_google_connection(uuid);
drop function if exists public.airreach_mark_google_sync(uuid, text, text);
drop function if exists public.airreach_save_gsc_queries(uuid, date, text, jsonb);
drop function if exists public.airreach_set_gsc_property(uuid, text, text, text);
drop function if exists public.airreach_save_google_connection(uuid, text, text[], text);
drop function if exists public.airreach_gsc_property_matches(uuid, text);
drop table if exists public.gsc_query_snapshots;
drop table if exists public.google_connections;
