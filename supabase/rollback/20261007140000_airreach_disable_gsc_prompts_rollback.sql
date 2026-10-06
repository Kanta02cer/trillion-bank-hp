-- 20261007140000_airreach_disable_gsc_prompts の取り消し（本番で問題が出たときだけ使う）。
-- 無効化した質問を、gscDisabled に残した元の状態（毎月測る・確定・google の印）に戻し、関数を消す。
-- ⚠️ 戻しても、画面（airreach-google-guard.js）は Search Console 由来の質問を引き続き「送れない」と判定する。
--    外部の AI に送るのは確定した質問だけ（サーバーの promptPolicyError も同じ）なので、戻しただけでは送られない。
-- 出力は件数だけ（質問文は出さない）。
begin;

select public.airreach_restore_gsc_prompts();

drop function if exists public.airreach_restore_gsc_prompts();
drop function if exists public.airreach_disable_gsc_prompts();
drop function if exists public.airreach_is_gsc_prompt(jsonb, text[], text);
drop function if exists public.airreach_gsc_queries(jsonb);
drop function if exists public.airreach_gsc_num(jsonb);
drop function if exists public.airreach_gsc_norm(text);

commit;
