-- ============================================================================
-- AirReach: お客様が自分で Google（Search Console・GA4）とつないで取り込んだ数字を保存する（2026-10-10）
--   お客様（顧客のメンバー）は traffic_snapshots に直接書けない（RLS は担当者だけ）。数字を画面から送れると、作った数字を入れられてしまう。
--   そこで、計測サーバー（api/google/gsc.js・ga4.js）が Google から自分で読んだ数字だけを、この関数で保存する。
--     - 呼べるのは service_role（サーバー）だけ。ログインした人・anon は呼べない
--     - 契約中の顧客だけ（終わった顧客には保存しない）
--     - 選んだ Search Console のサイト・GA4 の対象ホストが、その顧客に登録したサイトと同じときだけ（別の会社の数字を入れない）
--     - 保存した人（p_saved_by）を created_by に残す
--   取り消し: supabase/rollback/20261010120000_airreach_save_google_traffic_rollback.sql
-- ============================================================================
create or replace function public.airreach_save_google_traffic(p_client_id uuid, p_period_month date, p_source text, p_metrics jsonb, p_saved_by text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hosts text[];
  v_prop text := lower(coalesce(p_metrics ->> 'property', ''));
  v_host text := regexp_replace(lower(coalesce(p_metrics ->> 'host', '')), '^www\.', '');
  v_ok boolean := false;
begin
  if p_source not in ('gsc_api', 'ga4_api') then raise exception 'bad source' using errcode = '22023'; end if;
  if p_period_month is null or p_period_month <> date_trunc('month', p_period_month)::date then raise exception 'bad period' using errcode = '22023'; end if;
  if p_metrics is null or jsonb_typeof(p_metrics) <> 'object' or octet_length(p_metrics::text) > 20000 then raise exception 'bad metrics' using errcode = '22023'; end if;
  if not exists (select 1 from public.clients c where c.id = p_client_id and c.status <> 'ended') then
    return jsonb_build_object('ok', false, 'reason', 'not_contracted');
  end if;
  -- 顧客に登録したサイトのホスト（www. を除く）
  select array_agg(distinct regexp_replace(lower(s.url), '^https?://(www\.)?([^/:?#]+).*$', '\2')) into v_hosts
    from public.client_sites s where s.client_id = p_client_id;
  if v_hosts is null then return jsonb_build_object('ok', false, 'reason', 'no_site'); end if;
  if p_source = 'gsc_api' then
    select bool_or(v_prop in ('sc-domain:' || h, 'https://' || h || '/', 'https://www.' || h || '/', 'http://' || h || '/', 'http://www.' || h || '/')) into v_ok from unnest(v_hosts) h;
  else
    v_ok := v_host <> '' and v_host = any (v_hosts);
  end if;
  if not coalesce(v_ok, false) then return jsonb_build_object('ok', false, 'reason', 'site_mismatch'); end if;
  insert into public.traffic_snapshots (client_id, period_month, source, metrics, created_by)
  values (p_client_id, p_period_month, p_source, p_metrics, left(nullif(btrim(coalesce(p_saved_by, '')), ''), 200))
  on conflict (client_id, period_month, source) do update set metrics = excluded.metrics, created_by = excluded.created_by;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.airreach_save_google_traffic(uuid, date, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.airreach_save_google_traffic(uuid, date, text, jsonb, text) to service_role;
