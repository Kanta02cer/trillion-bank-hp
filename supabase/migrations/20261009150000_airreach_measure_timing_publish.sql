-- ============================================================================
-- AirReach: 計測の時期の日付に、公開の記録と照合の版を足す（2026-10-09）
--   ZIP を作った日時を公開の代わりにしない（airreach-case-steps.js の publishState）。お客様のホームの「次の計測」も、
--   いまの版の公開を見える形で確かめたときだけ「効果を測る」時期にするため、公開と照合の記録の最小の項目（publish_job）を返す。
--   判定は返さず、画面で担当者側と同じ関数（airreach-case-steps.js の publishState：版・ZIP の日時・MANIFEST の指紋・URL・判定の版）で行う。
--   返すのは日時・版・指紋・公開と照合の URL・状態だけ（FAQ・質問・会社名・ページの中身は返さない）
--   返す形は前の関数に項目を足しただけ（前の項目はそのまま）。
--   取り消し: supabase/rollback/20261009150000_airreach_measure_timing_publish_rollback.sql（前の関数に戻す）
-- ============================================================================
create or replace function public.airreach_measure_timing(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  j jsonb;
begin
  if not (public.airreach_can_staff(p_client_id) or public.airreach_is_member(p_client_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select w.data -> 'orch' -> 'lastJob' into j from public.studio_workspaces w where w.client_id = p_client_id;
  return jsonb_build_object(
    'entity_at', j -> 'confirm' -> 'entity' ->> 'at',
    'zipped_at', case when coalesce((j -> 'zipped' ->> 'draft')::boolean, false) then null else j -> 'zipped' ->> 'at' end,
    'verified_at', j -> 'verified' ->> 'at',
    'verified_ok', coalesce((j -> 'verified' ->> 'ok')::boolean, false),
    -- 公開と照合の記録（担当者の画面と同じ判定 airreach-case-steps.js の publishState に渡す最小の項目。中身・質問・会社名は入れない）
    'publish_job', jsonb_build_object(
      'zipped', case when j -> 'zipped' is null or coalesce((j -> 'zipped' ->> 'draft')::boolean, false) then null
                     else jsonb_build_object('at', j -> 'zipped' ->> 'at', 'version', j -> 'zipped' ->> 'version', 'draft', false, 'manifest_sha256', j -> 'zipped' ->> 'manifest_sha256') end,
      'published', case when j -> 'published' is null then null
                        else jsonb_build_object('at', j -> 'published' ->> 'at', 'url', j -> 'published' ->> 'url', 'version', j -> 'published' ->> 'version',
                                                'zipped_at', j -> 'published' ->> 'zipped_at', 'manifest_sha256', j -> 'published' ->> 'manifest_sha256') end,
      'verified', case when j -> 'verified' is null then null
                       else jsonb_build_object('at', j -> 'verified' ->> 'at', 'ok', coalesce((j -> 'verified' ->> 'ok')::boolean, false), 'state', j -> 'verified' ->> 'state',
                                               'rule', j -> 'verified' ->> 'rule', 'version', j -> 'verified' ->> 'version', 'zipped_at', j -> 'verified' ->> 'zipped_at',
                                               'zip_manifest_sha256', j -> 'verified' ->> 'zip_manifest_sha256', 'url', j -> 'verified' ->> 'url', 'final_url', j -> 'verified' ->> 'final_url') end
    ),
    -- 回答の記録がある計測だけ（画面の hasAnswers と同じ：回答の配列か、要約 ai3 がある）
    'last_run_at', (select max(r.created_at) from public.measurement_runs r
                     where r.client_id = p_client_id
                       and ((jsonb_typeof(r.summary -> 'answers') = 'array' and jsonb_array_length(r.summary -> 'answers') > 0) or jsonb_typeof(r.summary -> 'ai3') = 'object'))
  );
end;
$$;
