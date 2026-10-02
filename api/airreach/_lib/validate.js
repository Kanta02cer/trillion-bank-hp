/**
 * ops/airreach-api/src/validate.ts から機械的に移植（TypeScript transpile で型注釈を除去）。ロジックは同一。
 */
/**
 * POST /v1/scans の本文検証。
 *  - 構造の不備（JSON でない / scan・result が無い）→ 400
 *  - 内容の不備（形式・範囲・件数・採点不一致）→ 422
 * 受け取った JSON をそのまま Supabase へ送らず、検証済みの値だけで組み立て直す（ホワイトリスト方式）。
 * 点数は既存 airreach-diagnose.js の計算をそのまま再計算して一致を確認するだけで、変更しない。
 */
import { ApiError } from './errors.js';
import { DISPLAY_VERSIONS, FACTOR_IDS, RULES } from './rules.js';
import { UrlIssue, normalizeSiteUrl, sanitizeHttpUrl } from './url.js';
import { ldOut, robotsOut, scopeOut } from './evidence-extra.js';
export const SCAN_ID_RE = /^[a-z0-9]{8,32}$/;
const INDUSTRY_RE = /^[a-z0-9_]{1,32}$/;
const OUTCOME_RE = /^[a-z_]{1,32}$/;
const DISPLAY_RE = /^[a-z0-9-]{1,64}$/;
const ANCHOR_RE = /^[A-Za-z0-9_\-:.]{0,200}$/;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
class Issues {
    list = [];
    add(path, msg) {
        if (this.list.length < 20)
            this.list.push(`${path}: ${msg}`);
    }
    get any() {
        return this.list.length > 0;
    }
}
function isObj(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}
function cleanStr(issues, path, v, max, opts = {}) {
    if (v === undefined || v === null || v === '') {
        if (opts.required)
            issues.add(path, 'is required');
        return null;
    }
    if (typeof v !== 'string') {
        issues.add(path, 'must be a string');
        return null;
    }
    const s = v.replace(CONTROL_RE, '').trim();
    if (s.length > max) {
        issues.add(path, `exceeds ${max} chars`);
        return null;
    }
    if (!s && opts.required) {
        issues.add(path, 'is required');
        return null;
    }
    return s || null;
}
function strArray(issues, path, v, maxItems, maxLen) {
    if (v === undefined || v === null)
        return [];
    if (!Array.isArray(v)) {
        issues.add(path, 'must be an array');
        return [];
    }
    if (v.length > maxItems) {
        issues.add(path, `exceeds ${maxItems} items`);
        return [];
    }
    const out = [];
    v.forEach((item, i) => {
        const s = cleanStr(issues, `${path}[${i}]`, item, maxLen);
        if (s)
            out.push(s);
    });
    return out;
}
function intOrNull(issues, path, v, min, max) {
    if (v === null || v === undefined)
        return null;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
        issues.add(path, `must be an integer between ${min} and ${max} or null`);
        return null;
    }
    return v;
}
function intReq(issues, path, v, min, max) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
        issues.add(path, `must be an integer between ${min} and ${max}`);
        return min;
    }
    return v;
}
function boolOrNull(issues, path, v) {
    if (v === null || v === undefined)
        return null;
    if (typeof v !== 'boolean') {
        issues.add(path, 'must be a boolean or null');
        return null;
    }
    return v;
}
function enumOf(issues, path, v, allowed, opts = {}) {
    if (v === null || v === undefined || v === '') {
        if (!opts.nullable)
            issues.add(path, `must be one of ${allowed.join('|')}`);
        return null;
    }
    if (typeof v !== 'string' || !allowed.includes(v)) {
        issues.add(path, `must be one of ${allowed.join('|')}`);
        return null;
    }
    return v;
}
function isoDateOrNull(issues, path, v) {
    if (v === null || v === undefined || v === '')
        return null;
    if (typeof v !== 'string' || v.length > 40) {
        issues.add(path, 'must be an ISO 8601 date string');
        return null;
    }
    const t = Date.parse(v);
    if (!Number.isFinite(t)) {
        issues.add(path, 'must be an ISO 8601 date string');
        return null;
    }
    const year = new Date(t).getUTCFullYear();
    if (year < 2020 || year > 2100) {
        issues.add(path, 'is out of range');
        return null;
    }
    return new Date(t).toISOString();
}
function urlOrNull(issues, path, v) {
    if (v === null || v === undefined || v === '')
        return null;
    try {
        return sanitizeHttpUrl(v);
    }
    catch (e) {
        issues.add(path, e instanceof UrlIssue ? e.message : 'is not a valid URL');
        return null;
    }
}
function evidence(issues, path, v) {
    const o = isObj(v) ? v : {};
    if (!isObj(v))
        issues.add(path, 'must be an object');
    const anchorRaw = cleanStr(issues, `${path}.anchor`, o.anchor, 200) || '';
    if (!ANCHOR_RE.test(anchorRaw))
        issues.add(`${path}.anchor`, 'has invalid characters');
    return {
        url: urlOrNull(issues, `${path}.url`, o.url),
        finalUrl: urlOrNull(issues, `${path}.finalUrl`, o.finalUrl),
        anchor: ANCHOR_RE.test(anchorRaw) ? anchorRaw : '',
        fetchedAt: isoDateOrNull(issues, `${path}.fetchedAt`, o.fetchedAt),
        via: enumOf(issues, `${path}.via`, o.via, ['direct', 'first_party_proxy', 'third_party_proxy'], { nullable: true }),
        verified: boolOrNull(issues, `${path}.verified`, o.verified) ?? false,
    };
}
function source(issues, path, kind, v) {
    const o = isObj(v) ? v : {};
    if (!isObj(v))
        issues.add(path, 'must be an object');
    const ev = evidence(issues, path, o);
    // diagnose.js: page には state/status が無い（解析できた = ok）。llms/robots は state/status/error を持つ。
    let state;
    if (kind === 'page') {
        state = enumOf(issues, `${path}.state`, o.state, ['ok', 'missing', 'failed'], { nullable: true }) || 'ok';
    }
    else {
        state = enumOf(issues, `${path}.state`, o.state, ['ok', 'missing', 'failed']) || 'failed';
    }
    return {
        kind,
        ...ev,
        state,
        status: intOrNull(issues, `${path}.status`, o.status, 100, 599),
        error: cleanStr(issues, `${path}.error`, o.error, 300),
    };
}
function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
}
/** analyze() と同じ計算。Worker はこれで送られてきた点数の整合性だけを確認する。 */
function recompute(rules, checks, adjustments) {
    const factors = {};
    for (const f of rules.factors) {
        let pts = 0;
        let max = 0;
        let known = 0;
        let total = 0;
        for (const c of checks) {
            if (c.factor !== f.id)
                continue;
            total += 1;
            if (!c.known)
                continue;
            known += 1;
            pts += c.points || 0;
            max += c.max;
        }
        for (const a of adjustments)
            if (a.factor === f.id && known > 0)
                pts += a.points;
        const score = known > 0 && max > 0 ? clamp(Math.round((Math.max(0, pts) / max) * 100), 0, 100) : null;
        factors[f.id] = { score, state: known === 0 ? 'unknown' : known < total ? 'partial' : 'verified', known, total };
    }
    let overall = null;
    const requiredMissing = rules.factors.some((f) => f.required && factors[f.id].score == null);
    if (!requiredMissing) {
        let sum = 0;
        let wsum = 0;
        for (const f of rules.factors) {
            const s = factors[f.id].score;
            if (s == null)
                continue;
            sum += s * f.weight;
            wsum += f.weight;
        }
        overall = wsum > 0 ? Math.round(sum / wsum) : null;
    }
    const anyUnknown = checks.some((c) => !c.known);
    return { factors, overall, state: anyUnknown ? 'partial' : 'verified' };
}
// 調べる言葉の一覧（任意）。keyword（メイン）と同じ言葉が primary。保存先は raw_result.keywords（列は増やさない）
const KEYWORD_SOURCES = ['auto', 'user', 'gsc', 'legacy'];
const KEYWORDS_MAX = 5;
function keywordList(issues, path, v, mainKeyword) {
    if (v === undefined || v === null)
        return null;
    if (!Array.isArray(v)) {
        issues.add(path, 'must be an array or null');
        return null;
    }
    if (v.length > KEYWORDS_MAX) {
        issues.add(path, `exceeds ${KEYWORDS_MAX} items`);
        return null;
    }
    const out = [];
    const seen = new Set();
    v.forEach((raw, i) => {
        const p = `${path}[${i}]`;
        if (!isObj(raw)) {
            issues.add(p, 'must be an object');
            return;
        }
        const text = cleanStr(issues, `${p}.text`, raw.text, 100, { required: true });
        const source = enumOf(issues, `${p}.source`, raw.source, KEYWORD_SOURCES);
        if (typeof raw.primary !== 'boolean')
            issues.add(`${p}.primary`, 'must be a boolean');
        if (text && seen.has(text))
            issues.add(`${p}.text`, 'is duplicated');
        if (text)
            seen.add(text);
        if (text && source && typeof raw.primary === 'boolean')
            out.push({ text, source, primary: raw.primary });
    });
    const primaries = out.filter((k) => k.primary);
    if (primaries.length > 1)
        issues.add(path, 'must have at most one primary');
    else if (out.length && (primaries.length !== 1 || primaries[0].text !== (mainKeyword || '')))
        issues.add(path, 'primary must equal scan.keyword');
    return out.length ? out : null;
}
export function validateScanRequest(body) {
    if (!isObj(body))
        throw ApiError.badRequest('Body must be a JSON object');
    if (!isObj(body.scan))
        throw ApiError.badRequest('Missing "scan" object');
    if (!isObj(body.result))
        throw ApiError.badRequest('Missing "result" object');
    const scanIn = body.scan;
    const resultIn = body.result;
    const issues = new Issues();
    // ---- scan ---------------------------------------------------------------
    const id = typeof scanIn.id === 'string' && SCAN_ID_RE.test(scanIn.id) ? scanIn.id : null;
    if (!id)
        issues.add('scan.id', 'must match ^[a-z0-9]{8,32}$');
    let url = null;
    let normalizedUrl = '';
    let host = '';
    try {
        url = sanitizeHttpUrl(scanIn.url);
        const n = normalizeSiteUrl(url);
        normalizedUrl = n.normalizedUrl;
        host = n.host;
    }
    catch (e) {
        issues.add('scan.url', e instanceof UrlIssue ? e.message : 'is not a valid URL');
    }
    const industryId = cleanStr(issues, 'scan.industryId', scanIn.industryId, 32, { required: true }) || '';
    if (industryId && !INDUSTRY_RE.test(industryId))
        issues.add('scan.industryId', 'has invalid characters');
    const outcomeGoal = cleanStr(issues, 'scan.outcomeGoal', scanIn.outcomeGoal, 32);
    if (outcomeGoal && !OUTCOME_RE.test(outcomeGoal))
        issues.add('scan.outcomeGoal', 'has invalid characters');
    const scan = {
        id: id || '',
        url: url || '',
        normalizedUrl,
        host,
        industryId,
        goal: enumOf(issues, 'scan.goal', scanIn.goal, ['acquisition', 'visibility'], { nullable: true }),
        outcomeGoal: outcomeGoal && OUTCOME_RE.test(outcomeGoal) ? outcomeGoal : null,
        keyword: cleanStr(issues, 'scan.keyword', scanIn.keyword, 100),
        keywords: null,
        siteTitle: cleanStr(issues, 'scan.siteTitle', scanIn.siteTitle, 300),
        displayName: cleanStr(issues, 'scan.displayName', scanIn.displayName, 300),
        source: enumOf(issues, 'scan.source', scanIn.source, ['airreach_free', 'sales_mode', 'expert'], { nullable: true }) || 'airreach_free',
        savedAt: isoDateOrNull(issues, 'scan.savedAt', scanIn.savedAt),
    };
    scan.keywords = keywordList(issues, 'scan.keywords', scanIn.keywords, scan.keyword);
    // ---- result: versions ---------------------------------------------------
    const ruleVersion = typeof resultIn.ruleVersion === 'string' ? resultIn.ruleVersion : '';
    const rules = RULES[ruleVersion];
    if (!rules)
        issues.add('result.ruleVersion', 'is not a known rule version');
    const displayVersion = typeof resultIn.displayVersion === 'string' && DISPLAY_RE.test(resultIn.displayVersion) ? resultIn.displayVersion : '';
    if (!displayVersion)
        issues.add('result.displayVersion', 'must match ^[a-z0-9-]{1,64}$');
    else if (!DISPLAY_VERSIONS.has(displayVersion))
        issues.add('result.displayVersion', 'is not a known display version');
    // 版が分からなければ以降の件数検証ができないので、ここで打ち切る
    if (!rules)
        throw ApiError.validation(issues.list);
    // ---- result: checks -----------------------------------------------------
    const checks = [];
    if (!Array.isArray(resultIn.checks)) {
        issues.add('result.checks', 'must be an array');
    }
    else if (resultIn.checks.length !== rules.checks.length) {
        issues.add('result.checks', `must have exactly ${rules.checks.length} items`);
    }
    else {
        resultIn.checks.forEach((raw, i) => {
            const path = `result.checks[${i}]`;
            const rule = rules.checks[i];
            const o = isObj(raw) ? raw : {};
            if (!isObj(raw))
                issues.add(path, 'must be an object');
            const factor = enumOf(issues, `${path}.factor`, o.factor, FACTOR_IDS) || rule.factor;
            if (factor !== rule.factor)
                issues.add(`${path}.factor`, `must be ${rule.factor}`);
            const max = intReq(issues, `${path}.max`, o.max, 0, 100);
            if (max !== rule.max)
                issues.add(`${path}.max`, `must be ${rule.max}`);
            const state = enumOf(issues, `${path}.state`, o.state, ['ok', 'ng', 'unknown']) || 'unknown';
            let points = null;
            if (state === 'unknown') {
                if (o.points !== null && o.points !== undefined)
                    issues.add(`${path}.points`, 'must be null when state is unknown');
            }
            else {
                points = intOrNull(issues, `${path}.points`, o.points, 0, rule.max);
                if (points === null)
                    issues.add(`${path}.points`, 'is required when state is ok or ng');
                else if (state === 'ok' && points !== rule.max)
                    issues.add(`${path}.points`, `must be ${rule.max} when state is ok`);
                else if (state === 'ng' && points > rule.partialMax)
                    issues.add(`${path}.points`, `must be at most ${rule.partialMax} when state is ng`);
            }
            checks.push({
                factor: rule.factor,
                label: cleanStr(issues, `${path}.label`, o.label, 120, { required: true }) || '',
                tip: cleanStr(issues, `${path}.tip`, o.tip, 300) || '',
                state,
                ok: state === 'ok',
                known: state !== 'unknown',
                points,
                max: rule.max,
                evidence: evidence(issues, `${path}.evidence`, o.evidence),
            });
        });
    }
    // ---- result: adjustments ------------------------------------------------
    const adjustments = [];
    if (resultIn.adjustments !== undefined && resultIn.adjustments !== null) {
        if (!Array.isArray(resultIn.adjustments))
            issues.add('result.adjustments', 'must be an array');
        else if (resultIn.adjustments.length > rules.maxAdjustments)
            issues.add('result.adjustments', `exceeds ${rules.maxAdjustments} items`);
        else
            resultIn.adjustments.forEach((raw, i) => {
                const path = `result.adjustments[${i}]`;
                const o = isObj(raw) ? raw : {};
                if (!isObj(raw))
                    issues.add(path, 'must be an object');
                adjustments.push({
                    factor: enumOf(issues, `${path}.factor`, o.factor, FACTOR_IDS) || 'discover',
                    label: cleanStr(issues, `${path}.label`, o.label, 120, { required: true }) || '',
                    points: intReq(issues, `${path}.points`, o.points, -10, 0),
                });
            });
    }
    // ---- result: factors ----------------------------------------------------
    const factorsIn = isObj(resultIn.factors) ? resultIn.factors : null;
    if (!factorsIn)
        issues.add('result.factors', 'must be an object');
    const factors = {};
    for (const f of rules.factors) {
        const path = `result.factors.${f.id}`;
        const o = factorsIn && isObj(factorsIn[f.id]) ? factorsIn[f.id] : null;
        if (!o)
            issues.add(path, 'is required');
        const src = o || {};
        const weight = typeof src.weight === 'number' ? src.weight : NaN;
        if (Math.abs(weight - f.weight) > 1e-9)
            issues.add(`${path}.weight`, `must be ${f.weight}`);
        const required = boolOrNull(issues, `${path}.required`, src.required);
        if (required !== f.required)
            issues.add(`${path}.required`, `must be ${f.required}`);
        factors[f.id] = {
            id: f.id,
            label: cleanStr(issues, `${path}.label`, src.label, 60) || f.id,
            weight: f.weight,
            required: f.required,
            score: intOrNull(issues, `${path}.score`, src.score, 0, 100),
            state: enumOf(issues, `${path}.state`, src.state, ['verified', 'partial', 'unknown']) || 'unknown',
            knownChecks: intReq(issues, `${path}.knownChecks`, src.knownChecks, 0, rules.checks.length),
            totalChecks: intReq(issues, `${path}.totalChecks`, src.totalChecks, 0, rules.checks.length),
        };
        const flat = intOrNull(issues, `result.${f.id}`, resultIn[f.id], 0, 100);
        if (flat !== factors[f.id].score)
            issues.add(`result.${f.id}`, `must equal result.factors.${f.id}.score`);
    }
    if (factorsIn) {
        for (const k of Object.keys(factorsIn)) {
            if (!FACTOR_IDS.includes(k))
                issues.add(`result.factors.${k}`, 'is not a known factor');
        }
    }
    const overall = intOrNull(issues, 'result.overall', resultIn.overall, 0, 100);
    const state = enumOf(issues, 'result.state', resultIn.state, ['verified', 'partial']) || 'partial';
    // ---- result: 採点の整合性（送られてきた点数を再計算と突き合わせる） ----------
    if (checks.length === rules.checks.length) {
        const rc = recompute(rules, checks, adjustments);
        for (const f of rules.factors) {
            const got = factors[f.id];
            const exp = rc.factors[f.id];
            if (got.score !== exp.score)
                issues.add(`result.factors.${f.id}.score`, `does not match checks (expected ${exp.score ?? 'null'})`);
            if (got.state !== exp.state)
                issues.add(`result.factors.${f.id}.state`, `does not match checks (expected ${exp.state})`);
            if (got.knownChecks !== exp.known || got.totalChecks !== exp.total)
                issues.add(`result.factors.${f.id}`, 'knownChecks/totalChecks do not match checks');
        }
        if (overall !== rc.overall)
            issues.add('result.overall', `does not match factor scores (expected ${rc.overall ?? 'null'})`);
        if (state !== rc.state)
            issues.add('result.state', `does not match checks (expected ${rc.state})`);
    }
    // ---- result: evidence sources ------------------------------------------
    const evIn = isObj(resultIn.evidence) ? resultIn.evidence : null;
    if (!evIn)
        issues.add('result.evidence', 'must be an object with page/llms/robots');
    const evSrc = evIn || {};
    for (const k of ['page', 'llms', 'robots'])
        if (!(k in evSrc))
            issues.add(`result.evidence.${k}`, 'is required');
    const evidenceOut = {
        page: source(issues, 'result.evidence.page', 'page', evSrc.page),
        llms: source(issues, 'result.evidence.llms', 'llms', evSrc.llms),
        robots: source(issues, 'result.evidence.robots', 'robots', evSrc.robots),
    };
    if (evIn) {
        for (const k of Object.keys(evIn))
            if (!['page', 'llms', 'robots'].includes(k))
                issues.add(`result.evidence.${k}`, 'is not a known source');
    }
    // ---- result: page / review / lists --------------------------------------
    const pageIn = isObj(resultIn.page) ? resultIn.page : {};
    if (!isObj(resultIn.page))
        issues.add('result.page', 'must be an object');
    const page = {
        title: cleanStr(issues, 'result.page.title', pageIn.title, 300) || '',
        h1: cleanStr(issues, 'result.page.h1', pageIn.h1, 300) || '',
        types: strArray(issues, 'result.page.types', pageIn.types, 50, 80),
        faqCount: intOrNull(issues, 'result.page.faqCount', pageIn.faqCount, 0, 1000) ?? 0,
        faqAnchor: (() => {
            const a = cleanStr(issues, 'result.page.faqAnchor', pageIn.faqAnchor, 200) || '';
            if (!ANCHOR_RE.test(a))
                issues.add('result.page.faqAnchor', 'has invalid characters');
            return ANCHOR_RE.test(a) ? a : '';
        })(),
        hasLlms: boolOrNull(issues, 'result.page.hasLlms', pageIn.hasLlms),
        hasRobots: boolOrNull(issues, 'result.page.hasRobots', pageIn.hasRobots),
        baseHref: urlOrNull(issues, 'result.page.baseHref', pageIn.baseHref),
        finalUrl: urlOrNull(issues, 'result.page.finalUrl', pageIn.finalUrl),
        // 構造化データの中身（任意・崩れていれば捨てる）
        ld: ldOut(pageIn.ld),
    };
    const reviewIn = isObj(resultIn.review) ? resultIn.review : {};
    const review = {
        summary: cleanStr(issues, 'result.review.summary', reviewIn.summary, 1000) || '',
        strengths: strArray(issues, 'result.review.strengths', reviewIn.strengths, 10, 200),
        gaps: strArray(issues, 'result.review.gaps', reviewIn.gaps, 10, 200),
        unknowns: strArray(issues, 'result.review.unknowns', reviewIn.unknowns, 10, 200),
        conversionHint: cleanStr(issues, 'result.review.conversionHint', reviewIn.conversionHint, 1000) || '',
        disclaimer: cleanStr(issues, 'result.review.disclaimer', reviewIn.disclaimer, 1000) || '',
    };
    const actionsIn = isObj(resultIn.actions) ? resultIn.actions : {};
    const actions = {
        now: strArray(issues, 'result.actions.now', actionsIn.now, 10, 300),
        weeks: strArray(issues, 'result.actions.weeks', actionsIn.weeks, 10, 300),
        partner: strArray(issues, 'result.actions.partner', actionsIn.partner, 10, 300),
    };
    const result = {
        ruleVersion,
        displayVersion,
        state,
        fetchedAt: isoDateOrNull(issues, 'result.fetchedAt', resultIn.fetchedAt),
        overall,
        structure: factors.structure.score,
        entity: factors.entity.score,
        faq: factors.faq.score,
        discover: factors.discover.score,
        factors,
        strengths: strArray(issues, 'result.strengths', resultIn.strengths, 40, 200),
        gaps: strArray(issues, 'result.gaps', resultIn.gaps, 40, 200),
        unknowns: strArray(issues, 'result.unknowns', resultIn.unknowns, 40, 200),
        checks,
        adjustments,
        actions,
        evidence: evidenceOut,
        review,
        page,
        // 診断の範囲と AI ボットの許可・拒否（任意・崩れていれば捨てる）
        scope: scopeOut(resultIn.scope),
        robots: robotsOut(resultIn.robots),
    };
    if (issues.any)
        throw ApiError.validation(issues.list);
    return { scan, result };
}
