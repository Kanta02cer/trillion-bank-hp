-- ============================================================================
-- AirReach: 計測の時期の関数に、媒体の記事向けのレビュー用パッチ（studio_workspaces.data.review.pkg）を足す（2026-10-11）
--   お客様のホームの「次の計測」が、レビュー用パッチの公開・照合（今回の対象の記事が全部済み）も見るようにする。
--   判定は返さず、画面で担当者側と同じ関数（airreach-case-steps.js の reviewCurrent → airreach-review-package.js の state）で行う。
--   返すのは版・指紋・日時・承認の日時・今回の対象・記事ごとの URL と公開/照合の記録の最小の項目だけ
--   （会社名・媒体名の項目・会社説明・記事データ・CHANGESET・照合の詳細・承認した人は返さない。記事の key は ZIP のフォルダ名のまま）。
--   返す形は前の関数に 'review' を足しただけ（前の項目はそのまま）。
--   取り消し: supabase/rollback/20261011120000_airreach_measure_timing_review_rollback.sql（前の関数に戻す）
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
  rp jsonb;
begin
  if not (public.airreach_can_staff(p_client_id) or public.airreach_is_member(p_client_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select w.data -> 'orch' -> 'lastJob', w.data -> 'review' -> 'pkg' into j, rp from public.studio_workspaces w where w.client_id = p_client_id;
  if jsonb_typeof(rp) is distinct from 'object' then rp := null; end if;
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
    -- 媒体の記事向けのレビュー用パッチ（担当者の画面と同じ判定 reviewCurrent / state に渡す最小の項目）
    'review', case when rp is null then null else jsonb_build_object(
      'version', rp ->> 'version', 'manifest_sha256', rp ->> 'manifest_sha256', 'imported_at', rp ->> 'imported_at',
      'approved', case when jsonb_typeof(rp -> 'approved') = 'object'
                       then jsonb_build_object('at', rp -> 'approved' ->> 'at', 'version', rp -> 'approved' ->> 'version', 'manifest_sha256', rp -> 'approved' ->> 'manifest_sha256') end,
      'round', case when jsonb_typeof(rp -> 'round') = 'array' then rp -> 'round' else '[]'::jsonb end,
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'key', i ->> 'key', 'target_url', i ->> 'target_url', 'manifest_sha256', i ->> 'manifest_sha256',
          'published', case when jsonb_typeof(i -> 'published') = 'object'
                            then jsonb_build_object('at', i -> 'published' ->> 'at', 'url', i -> 'published' ->> 'url', 'version', i -> 'published' ->> 'version',
                                                    'manifest_sha256', i -> 'published' ->> 'manifest_sha256', 'item_manifest_sha256', i -> 'published' ->> 'item_manifest_sha256') end,
          'verified', case when jsonb_typeof(i -> 'verified') = 'object'
                           then jsonb_build_object('at', i -> 'verified' ->> 'at', 'url', i -> 'verified' ->> 'url', 'final_url', i -> 'verified' ->> 'final_url',
                                                   'ok', coalesce((i -> 'verified' ->> 'ok')::boolean, false), 'state', i -> 'verified' ->> 'state', 'rule', i -> 'verified' ->> 'rule',
                                                   'version', i -> 'verified' ->> 'version', 'manifest_sha256', i -> 'verified' ->> 'manifest_sha256',
                                                   'item_manifest_sha256', i -> 'verified' ->> 'item_manifest_sha256') end) order by o)
        from jsonb_array_elements(case when jsonb_typeof(rp -> 'items') = 'array' then rp -> 'items' else '[]'::jsonb end) with ordinality as e(i, o)), '[]'::jsonb)
    ) end,
    -- 回答の記録がある計測だけ（画面の hasAnswers と同じ：回答の配列か、要約 ai3 がある）
    'last_run_at', (select max(r.created_at) from public.measurement_runs r
                     where r.client_id = p_client_id
                       and ((jsonb_typeof(r.summary -> 'answers') = 'array' and jsonb_array_length(r.summary -> 'answers') > 0) or jsonb_typeof(r.summary -> 'ai3') = 'object'))
  );
end;
$$;
