-- 取り消し: 依頼の補足（20261007190000_airreach_request_note.sql）。書かれた補足は消える。4つの引数の airreach_request_create は残る
drop function if exists public.airreach_request_create(uuid, text, text, jsonb, text);
alter table public.client_requests drop constraint if exists client_requests_note_check;
alter table public.client_requests drop column if exists note;
