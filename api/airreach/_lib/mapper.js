/**
 * ops/airreach-api/src/mapper.ts から機械的に移植（TypeScript transpile で型注釈を除去）。ロジックは同一。
 */
export function buildInsertArgs(v, shareTokenHash) {
    const { scan, result } = v;
    const displayName = scan.siteTitle || result.page.title || result.page.h1 || scan.displayName || null;
    const p_site = {
        normalized_url: scan.normalizedUrl,
        host: scan.host,
        display_name: displayName ? displayName.slice(0, 300) : null,
        industry_id: scan.industryId,
    };
    const p_scan = {
        id: scan.id,
        share_token_hash: shareTokenHash,
        rule_version: result.ruleVersion,
        display_version: result.displayVersion,
        state: result.state,
        overall_score: result.overall,
        industry_id: scan.industryId,
        goal: scan.goal,
        outcome_goal: scan.outcomeGoal,
        keyword: scan.keyword,
        site_title: scan.siteTitle,
        source: scan.source,
        page: {
            title: result.page.title,
            h1: result.page.h1,
            types: result.page.types,
            faqCount: result.page.faqCount,
            faqAnchor: result.page.faqAnchor,
            hasLlms: result.page.hasLlms,
            hasRobots: result.page.hasRobots,
            baseHref: result.page.baseHref,
            finalUrl: result.page.finalUrl,
        },
        summary: result.review.summary || null,
        raw_result: rawResult(v),
        fetched_at: result.fetchedAt,
        client_saved_at: scan.savedAt,
    };
    const p_factors = ['structure', 'entity', 'faq', 'discover'].map((id) => {
        const f = result.factors[id];
        return {
            factor_id: id,
            score: f.score,
            weight: f.weight,
            required: f.required,
            state: f.state,
            known_checks: f.knownChecks,
            total_checks: f.totalChecks,
        };
    });
    const p_checks = result.checks.map((c, i) => ({
        sort_order: i + 1,
        factor_id: c.factor,
        label: c.label,
        state: c.state,
        points: c.points,
        max_points: c.max,
        evidence_url: c.evidence.url,
        evidence_final_url: c.evidence.finalUrl,
        evidence_anchor: c.evidence.anchor || null,
        evidence_via: c.evidence.via,
        evidence_fetched_at: c.evidence.fetchedAt,
        evidence_verified: c.evidence.verified,
    }));
    const p_sources = ['page', 'llms', 'robots'].map((kind) => {
        const s = result.evidence[kind];
        return {
            kind,
            requested_url: s.url,
            final_url: s.finalUrl,
            http_status: s.status,
            fetch_state: s.state,
            via: s.via,
            fetched_at: s.fetchedAt,
            error: s.error,
        };
    });
    return { p_site, p_scan, p_factors, p_checks, p_sources };
}
/**
 * 共有表示（フロントの previewDiagnose）が読む形。diagnose() の戻り値と同じキー構成で、
 * 検証済みの値だけを含む。referral / modelPlaceholders は静的文言なので保存しない。
 */
function rawResult(v) {
    const r = v.result;
    return {
        ruleVersion: r.ruleVersion,
        displayVersion: r.displayVersion,
        state: r.state,
        fetchedAt: r.fetchedAt,
        overall: r.overall,
        structure: r.structure,
        entity: r.entity,
        faq: r.faq,
        discover: r.discover,
        factors: r.factors,
        strengths: r.strengths,
        gaps: r.gaps,
        unknowns: r.unknowns,
        checks: r.checks,
        adjustments: r.adjustments,
        actions: r.actions,
        evidence: r.evidence,
        review: r.review,
        page: r.page,
        ...(r.scope ? { scope: r.scope } : {}),
        ...(r.robots ? { robots: r.robots } : {}),
        // 調べる言葉の一覧（scan 側の値。列を増やさず raw_result に残し、共有表示で復元する）。無ければ入れない
        ...(v.scan.keywords ? { keywords: v.scan.keywords } : {}),
    };
}
