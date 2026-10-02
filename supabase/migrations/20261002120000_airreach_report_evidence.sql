-- ============================================================================
-- AirReach: 月次レポートに診断の根拠を載せるため、airreach_client_scans() の返す項目を増やす（2026-10-02）
--   追加: fetchedAt（診断日時）／adjustments（減点）／checks（項目ごとの○×・点数・満点・根拠のURL）／
--         scope（点数に使ったページ・下層ページ・llms.txt・robots.txt の取得結果）／
--         robots（AI ボットごとの許可・拒否。robots.txt の中身の全文は返さない）／
--         ld（構造化データの種類と主な項目）／types／evidence（llms.txt・robots.txt の取得状態）／pageInfo（FAQ数・llms.txt・robots.txt の有無）
--   テーブル・権限・RLS は変えない。関数の戻り値に項目を足すだけ（既存の項目と順序は同じ）。
--   scope・robots・ld は、保存 API（api/airreach/_lib/evidence-extra.js）がこの変更と同時に保存を始める。それ以前の診断は null。
--   取り消し: supabase/rollback/20261002120000_airreach_report_evidence_rollback.sql
-- ============================================================================
create or replace function public.airreach_client_scans(p_client_id uuid, p_limit integer default 60)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (public.airreach_is_staff() or public.airreach_is_member(p_client_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x order by x->>'createdAt' desc)
    from (
      select jsonb_build_object(
        'id',            s.id,
        'createdAt',     s.created_at,
        'fetchedAt',     s.fetched_at,
        'url',           si.normalized_url,
        'host',          si.host,
        'overallScore',  s.overall_score,
        'state',         s.state,
        'industryId',    s.industry_id,
        'keyword',       s.keyword,
        'ruleVersion',   s.rule_version,
        'displayVersion', s.display_version,
        'factors', (
          select coalesce(jsonb_object_agg(f.factor_id, f.score), '{}'::jsonb)
          from public.scan_factor_scores f where f.scan_id = s.id
        ),
        'gaps', (
          select coalesce(jsonb_agg(c.label order by c.sort_order), '[]'::jsonb)
          from public.scan_checks c where c.scan_id = s.id and c.state = 'ng'
        ),
        'unknownChecks', (
          select count(*) from public.scan_checks c where c.scan_id = s.id and c.state = 'unknown'
        ),
        'checks', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'factor', c.factor_id, 'label', c.label, 'state', c.state, 'points', c.points, 'max', c.max_points,
            'evidenceUrl', coalesce(c.evidence_final_url, c.evidence_url), 'fetchedAt', c.evidence_fetched_at
          ) order by c.sort_order), '[]'::jsonb)
          from public.scan_checks c where c.scan_id = s.id
        ),
        'adjustments', s.raw_result -> 'adjustments',
        'scope',      s.raw_result -> 'scope',
        'robots',     (s.raw_result -> 'robots') - 'lines',
        'ld',         (s.raw_result -> 'page' -> 'ld') - 'raw',
        'types',      s.raw_result -> 'page' -> 'types',
        'evidence',   jsonb_build_object(
                        'llms',   (s.raw_result -> 'evidence' -> 'llms')   - 'error',
                        'robots', (s.raw_result -> 'evidence' -> 'robots') - 'error'),
        'pageInfo',   jsonb_build_object('faqCount', s.page -> 'faqCount', 'hasLlms', s.page -> 'hasLlms', 'hasRobots', s.page -> 'hasRobots', 'finalUrl', s.page -> 'finalUrl')
      ) as x
      from public.scans s
      join public.sites si on si.id = s.site_id
      join public.client_sites cs
        on cs.client_id = p_client_id
       and cs.host = regexp_replace(lower(si.host), '^www\.', '')
      order by s.created_at desc
      limit greatest(1, least(coalesce(p_limit, 60), 200))
    ) q
  ), '[]'::jsonb);
end;
$$;
