-- ============================================================================
-- AirReach: 計測の時期の日付に、公開の記録と照合の版を足す（2026-10-09）
--   ZIP を作った日時を公開の代わりにしない（airreach-case-steps.js の publishState）。お客様のホームの「次の計測」も、
--   いまの版の公開を見える形で確かめたときだけ「効果を測る」時期にするため、次を返す（日付・版・判定の状態だけ。中身は返さない）：
--     published_at・published_version（公開の記録）／verified_state・verified_rule・verified_version（照合の結果と判定の版）／zipped_version
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
    'verified_state', j -> 'verified' ->> 'state',
    'verified_rule', j -> 'verified' ->> 'rule',
    'verified_version', j -> 'verified' ->> 'version',
    'zipped_version', case when coalesce((j -> 'zipped' ->> 'draft')::boolean, false) then null else j -> 'zipped' ->> 'version' end,
    'published_at', j -> 'published' ->> 'at',
    'published_version', j -> 'published' ->> 'version',
    -- 回答の記録がある計測だけ（画面の hasAnswers と同じ：回答の配列か、要約 ai3 がある）
    'last_run_at', (select max(r.created_at) from public.measurement_runs r
                     where r.client_id = p_client_id
                       and ((jsonb_typeof(r.summary -> 'answers') = 'array' and jsonb_array_length(r.summary -> 'answers') > 0) or jsonb_typeof(r.summary -> 'ai3') = 'object'))
  );
end;
$$;
