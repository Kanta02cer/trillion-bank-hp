-- ============================================================================
-- AirReach: 計測の時期を知らせる（2026-10-09）
--   自動の定期計測は使わず、担当者が Studio で測る。いつ測るかは、次の決まりで画面が知らせる（assets/js/airreach-case-steps.js の timing）：
--     ① 会社・サービスを確定したら、すぐ（導入前の計測）
--     ② パッチを入れたと確かめた日から14日後（効果を測る。Google がページを読み直す時間）
--     ③ それ以外は、前回の計測から30日後（毎月の計測）。3日過ぎたら「遅れ」
--   お客様は Studio の作業（studio_workspaces）を読めないので、決まりに使う日付だけを返す関数を足す（読み取りだけ）。
--   返すのは日付と「入っていた」かどうかだけ（会社名・質問・ZIP の中身は返さない）。
--   取り消し: supabase/rollback/20261009140000_airreach_measure_timing_rollback.sql
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
    -- 回答の記録がある計測だけ（画面の hasAnswers と同じ：回答の配列か、要約 ai3 がある）
    'last_run_at', (select max(r.created_at) from public.measurement_runs r
                     where r.client_id = p_client_id
                       and ((jsonb_typeof(r.summary -> 'answers') = 'array' and jsonb_array_length(r.summary -> 'answers') > 0) or jsonb_typeof(r.summary -> 'ai3') = 'object'))
  );
end;
$$;
revoke all on function public.airreach_measure_timing(uuid) from public, anon, service_role;
grant execute on function public.airreach_measure_timing(uuid) to authenticated;
