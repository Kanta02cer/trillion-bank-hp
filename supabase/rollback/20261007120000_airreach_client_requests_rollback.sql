-- 取り消し: お客様からの依頼（20261007120000_airreach_client_requests.sql）
--   承認して Studio の作業に反映した内容（競合・キーワード・質問）はそのまま残る
drop function if exists public.airreach_request_decide(uuid, boolean, text);
drop function if exists public.airreach_request_cancel(uuid);
drop function if exists public.airreach_request_create(uuid, text, text, jsonb);
drop function if exists public.airreach_client_settings(uuid);
drop function if exists public.airreach_request_payload(text, jsonb);
drop table if exists public.client_requests;
