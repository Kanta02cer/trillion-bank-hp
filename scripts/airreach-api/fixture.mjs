/**
 * airreach-diagnose.js の diagnose() 戻り値と同じ形の、自己整合したテスト payload を作る。
 * 点数は analyze() と同じ式で計算するので、Worker の再計算検証を通る。
 */
const FACTORS = [
  { id: 'structure', label: 'ページの骨格', weight: 0.3, required: true },
  { id: 'entity', label: '会社・サービス情報', weight: 0.25, required: true },
  { id: 'faq', label: 'よくある質問', weight: 0.2, required: true },
  { id: 'discover', label: '見つけやすさ', weight: 0.25, required: false },
];
const CHECK_DEFS = [
  ['structure', 'ページタイトルがある', 2, 0],
  ['structure', 'H1が1つ', 3, 1],
  ['structure', '説明文（meta）が十分', 2, 0],
  ['structure', 'canonicalがある', 2, 0],
  ['structure', 'og:titleがある', 1, 0],
  ['structure', '本文量がある', 2, 0],
  ['entity', '会社情報（Organization等）', 4, 0],
  ['entity', 'WebSite / WebPage', 2, 0],
  ['entity', 'Service / Product', 2, 0],
  ['entity', 'BreadcrumbList', 1, 0],
  ['entity', '問い合わせ導線', 1, 0],
  ['faq', 'FAQPageがある', 3, 0],
  ['faq', 'FAQが3問以上', 3, 1],
  ['faq', '画面上のFAQらしき領域', 2, 0],
  ['discover', 'llms.txtがある', 4, 0],
  ['discover', 'robots.txtがある', 2, 0],
  ['discover', '主要AIボットの記載', 2, 0],
  ['discover', 'sitemap案内', 2, 0],
];

function uid() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {object} opts
 * @param {string[]} [opts.states] 18 個の 'ok'|'ng'|'ng1'|'unknown'（ng1 = 部分点 1）
 * @param {string} [opts.url]
 * @param {string} [opts.scanId]
 */
export function buildScanPayload(opts = {}) {
  const url = opts.url || 'https://example.com/';
  const scanId = opts.scanId || uid();
  const states =
    opts.states ||
    ['ok', 'ng1', 'ok', 'ok', 'ng', 'ok', 'ok', 'ng', 'ok', 'ng', 'ok', 'ng', 'ng1', 'ok', 'unknown', 'ok', 'ng', 'ok'];
  const fetchedAt = '2026-09-28T03:00:00.000Z';
  const pageEv = { url, finalUrl: url, anchor: '', fetchedAt, via: 'first_party_proxy', verified: true };
  const llmsFailed = states[14] === 'unknown';
  const llmsEv = llmsFailed
    ? { url: url + 'llms.txt', finalUrl: null, anchor: '', fetchedAt, via: null, verified: false, state: 'failed', status: null, error: 'timeout' }
    : { url: url + 'llms.txt', finalUrl: url + 'llms.txt', anchor: '', fetchedAt, via: 'first_party_proxy', verified: true, state: states[14] === 'ok' ? 'ok' : 'missing', status: states[14] === 'ok' ? 200 : 404, error: null };
  const robotsEv = { url: url + 'robots.txt', finalUrl: url + 'robots.txt', anchor: '', fetchedAt, via: 'direct', verified: true, state: 'ok', status: 200, error: null };

  const checks = CHECK_DEFS.map(([factor, label, max, partial], i) => {
    const s = states[i];
    const state = s === 'ng1' ? 'ng' : s;
    const known = state !== 'unknown';
    const points = !known ? null : state === 'ok' ? max : s === 'ng1' ? partial : 0;
    const ev = factor === 'discover' ? (i === 14 ? llmsEv : robotsEv) : pageEv;
    return { factor, label, tip: 'テスト用の説明。', state, ok: state === 'ok', known, points, max, evidence: { url: ev.url, finalUrl: ev.finalUrl, anchor: ev.anchor, fetchedAt, via: ev.via, verified: ev.verified } };
  });
  const adjustments = [];

  const factors = {};
  for (const f of FACTORS) {
    let pts = 0, max = 0, known = 0, total = 0;
    for (const c of checks) {
      if (c.factor !== f.id) continue;
      total += 1;
      if (!c.known) continue;
      known += 1;
      pts += c.points || 0;
      max += c.max;
    }
    for (const a of adjustments) if (a.factor === f.id && known > 0) pts += a.points;
    const score = known > 0 ? Math.max(0, Math.min(100, Math.round((Math.max(0, pts) / max) * 100))) : null;
    factors[f.id] = { id: f.id, label: f.label, weight: f.weight, required: f.required, score, state: known === 0 ? 'unknown' : known < total ? 'partial' : 'verified', knownChecks: known, totalChecks: total };
  }
  let overall = null;
  if (!FACTORS.some((f) => f.required && factors[f.id].score == null)) {
    let sum = 0, wsum = 0;
    for (const f of FACTORS) {
      const s = factors[f.id].score;
      if (s == null) continue;
      sum += s * f.weight;
      wsum += f.weight;
    }
    overall = wsum > 0 ? Math.round(sum / wsum) : null;
  }
  const state = checks.some((c) => !c.known) ? 'partial' : 'verified';
  const strengths = checks.filter((c) => c.state === 'ok').map((c) => c.label);
  const gaps = checks.filter((c) => c.state === 'ng').map((c) => '「' + c.label + '」を満たしていない');
  const unknowns = checks.filter((c) => c.state === 'unknown').map((c) => c.label + '（未確認）');

  const result = {
    ruleVersion: 'airreach-common-v1',
    displayVersion: 'band-v1',
    state,
    fetchedAt,
    overall,
    structure: factors.structure.score,
    entity: factors.entity.score,
    faq: factors.faq.score,
    discover: factors.discover.score,
    factors,
    strengths,
    gaps,
    unknowns,
    checks,
    adjustments,
    actions: { now: ['購入前に聞かれる質問を可視FAQにし、同じ内容のFAQPageを置く'], weeks: ['サービスの対象・対象外・比較の軸を公式ページに書く'], partner: [] },
    referral: { kicker: '別のサービスの案内', title: 'x', body: 'y', cta: 'z', href: '/trillionbank/meeting/', note: 'n' },
    evidence: { page: pageEv, llms: llmsEv, robots: robotsEv },
    review: { summary: 'example.com のホームページ情報整備は ' + overall + ' / 100 です。', strengths: strengths.slice(0, 4), gaps: gaps.slice(0, 5), unknowns: unknowns.slice(0, 4), conversionHint: 'hint', disclaimer: 'disc' },
    page: { title: 'Example Site', h1: 'Example', types: ['WebSite', 'Organization'], faqCount: 1, faqAnchor: '', hasLlms: llmsFailed ? null : states[14] === 'ok', hasRobots: true, baseHref: url, finalUrl: url },
    modelPlaceholders: [{ name: 'Gemini', status: '要HackⅡ測定', note: 'x' }],
  };
  const scan = {
    id: scanId,
    url,
    industryId: 'other',
    goal: 'acquisition',
    outcomeGoal: 'inquiry',
    keyword: 'Example',
    siteTitle: 'Example Site',
    displayName: 'Example Site',
    source: 'airreach_free',
    savedAt: '2026-09-28T03:00:02.000Z',
  };
  return { scan, result };
}
