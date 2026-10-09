-- 取り消し: 20261010120000_airreach_save_google_traffic.sql（関数を消すだけ。保存済みの数字は残る）
drop function if exists public.airreach_save_google_traffic(uuid, date, text, jsonb, text);
