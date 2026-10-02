-- 20261002120000_airreach_report_evidence を取り消す: airreach_client_scans() を Phase 2（20260930120000）の定義に戻す
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
        )
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
