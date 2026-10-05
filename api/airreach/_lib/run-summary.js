/**
 * AI計測の行（hack2-measure の rows）から、計測の記録（measurement_runs.summary）を作る。定期計測で使う。
 *   Studio の measureSummary と同じ形・同じ数え方（月次レポートとホームが同じように読める）:
 *   - by: AI ごとの言及率・引用率（分子・分母）・表示なし／エラーの件数
 *   - breakdown.types: 一般質問／指名質問ごとの言及・引用（分子・分母）
 *   - answers: 回答ごとの根拠（質問・AI・状態・判定方法・出典・本文の一部・計測日時・条件）
 *   表示なし（not_shown）とエラー（error）は割合の分母に入れない
 */
export const PROVIDER_ID = {
  ChatGPT: 'openai', 'ChatGPT（検索あり）': 'chatgpt_search', Claude: 'claude', Perplexity: 'perplexity', Gemini: 'gemini',
  'Google AI Overviews': 'google_aio', 'Google AI Mode': 'google_ai_mode'
};
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const answered = (r) => r.status !== 'not_shown' && r.status !== 'error';

/** Studio と同じ質問の版（質問の並びに左右されない） */
export function promptVersion(prompts) {
  const t = (prompts || []).map((p) => p.prompt).sort().join('\n');
  let h = 0;
  for (let i = 0; i < t.length; i += 1) h = (h * 31 + t.charCodeAt(i)) | 0;
  return 'studio-' + (h >>> 0).toString(16);
}

function norm(t) { return String(t || '').toLowerCase().replace(/[\s　・･]+/g, ''); }
/** 指名質問＝質問の文に自社の名前が入っている（airreach-ai-breakdown.js の isBranded と同じ） */
export function isBranded(prompt, brand) {
  const b = norm(brand);
  if (!b) return false;
  const p = norm(prompt);
  if (p.indexOf(b) >= 0) return true;
  const core = b.replace(/^(株式会社|有限会社|合同会社)|(株式会社|有限会社|合同会社)$/g, '').replace(/(本店|店)$/, '');
  return core.length >= 2 && p.indexOf(core) >= 0;
}

function typeStats(rows) {
  const ok = rows.filter(answered);
  const judged = ok.filter((r) => r.cited === 0 || r.cited === 1);
  const mention = ok.filter((r) => r.mentioned).length;
  const cite = judged.filter((r) => r.cited === 1).length;
  return {
    answers: ok.length, mention, mentionRate: pct(mention, ok.length), cite, citeJudged: judged.length, citeRate: pct(cite, judged.length),
    notShown: rows.filter((r) => r.status === 'not_shown').length, errors: rows.filter((r) => r.status === 'error').length,
    citedBySources: ok.filter((r) => r.cite_source === 'ai_sources').length
  };
}

export function buildRunSummary(rows, { brand = '', siteUrl = '', competitors = [], prompts = [], runId, source = 'schedule', now = new Date() } = {}) {
  const observed = (rows || []).filter((r) => String(r.evidenceClass || '') !== 'Estimated');
  let selfHost = '';
  try { selfHost = new URL(siteUrl).hostname.replace(/^www\./, ''); } catch (e) { /* URL なし */ }
  const by = {};
  observed.forEach((r) => {
    const e = r.engine || 'AI';
    const b = by[e] || (by[e] = { engine: e, model: r.model || '', n: 0, self: 0, cited: 0, judged: 0, comp: {}, notShown: 0, errors: 0, bySources: 0 });
    if (r.status === 'not_shown') { b.notShown += 1; return; }
    if (r.status === 'error') { b.errors += 1; return; }
    b.n += 1;
    if (r.cite_source === 'ai_sources') b.bySources += 1;
    b.self += r.mentioned ? 1 : 0;
    if (r.cited === 0 || r.cited === 1) { b.judged += 1; b.cited += r.cited; }
    (r.competitors || []).forEach((c) => { b.comp[c.name] = (b.comp[c.name] || 0) + (c.mentioned ? 1 : 0); });
  });
  const dom = {};
  const targetCitations = [];
  observed.filter(answered).forEach((r) => {
    const pid = PROVIDER_ID[r.engine] || String(r.engine || '').toLowerCase();
    const seen = {};
    (r.citations || []).forEach((u) => {
      let h = '';
      try { h = new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return; }
      if (!seen[h]) { seen[h] = 1; dom[h] = dom[h] || {}; dom[h][pid] = (dom[h][pid] || 0) + 1; }
      if (selfHost && (h === selfHost || h.endsWith('.' + selfHost))) targetCitations.push({ provider: pid, query: r.prompt || r.keyword || '', url: u, match_type: 'self_host' });
    });
  });
  const total = (x) => Object.keys(x[1]).reduce((s, k) => s + x[1][k], 0);
  const cited = Object.keys(dom).map((h) => [h, dom[h]]).sort((a, b) => total(b) - total(a));
  return {
    source,
    run_id: runId || source + '-' + now.toISOString(),
    generated_at: now.toISOString(),
    query_set_version: promptVersion(prompts),
    competitors: (competitors || []).map((c) => c.name).filter(Boolean),
    by: Object.keys(by).map((k) => {
      const b = by[k];
      const compSum = Object.keys(b.comp).reduce((s, x) => s + b.comp[x], 0);
      const cr = {};
      Object.keys(b.comp).forEach((x) => { cr[x] = pct(b.comp[x], b.n); });
      return {
        provider: PROVIDER_ID[b.engine] || String(b.engine).toLowerCase(), model: b.model, group: 'main', label: source === 'schedule' ? '定期計測' : 'Studio',
        denominator: b.n, judged: b.judged, either: { rate: pct(b.cited, b.judged), numerator: b.cited, denominator: b.judged }, cited_by_sources: b.bySources,
        service_mention_rate: pct(b.self, b.n), sov: b.self + compSum ? pct(b.self, b.self + compSum) : null, competitor_mention_rates: cr,
        not_shown_count: b.notShown, error_count: b.errors
      };
    }),
    breakdown: {
      types: {
        general: typeStats(observed.filter((r) => !isBranded(r.prompt || r.keyword, brand))),
        branded: typeStats(observed.filter((r) => isBranded(r.prompt || r.keyword, brand)))
      }
    },
    cited_domains: cited,
    target_citations: targetCitations,
    answers: observed.map((r) => ({
      prompt: r.prompt || r.keyword || '', engine: PROVIDER_ID[r.engine] || String(r.engine || '').toLowerCase(), status: r.status || 'ok',
      error: r.error ? String(r.error).slice(0, 200) : undefined, mentioned: r.mentioned, cited: r.cited, cite_source: r.cite_source || 'none',
      cited_by_sources: r.cited_by_sources == null ? null : r.cited_by_sources, self_url_in_text: r.self_url_in_text == null ? null : r.self_url_in_text,
      citations: (r.citations || []).slice(0, 10), urls_in_answer: (r.urls_in_answer || []).slice(0, 10), answer: String(r.answer_text || r.answer_excerpt || '').slice(0, 1500),
      measured_at: r.measured_at || '', model: r.model || '', conditions: r.conditions || null, repeat: r.repeat || 1, branded: isBranded(r.prompt || r.keyword, brand)
    }))
  };
}
