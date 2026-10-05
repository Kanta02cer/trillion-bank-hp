// 月次の AI 集計（airreach-report.js の compileReport → ai）：月内のすべての計測の合計・分子と分母・判定できない／表示なし／エラーの区別・最新1回との区別・根拠
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
const expect = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(detail).slice(0, 400)}`); };
const ctx = { window: {}, console }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/airreach-report.js'), 'utf8'), ctx);
const R = ctx.window.AirReachReport;

// Studio・定期計測の summary の形
const sm = (ver, rows, types, answers) => ({ source: 'studio', run_id: 'r', query_set_version: ver, by: rows.map((x) => Object.assign({ group: 'main', label: 'Studio' }, x)), breakdown: { types }, answers: answers || [] });
const prov = (provider, answers, judged, cited, mention, notShown = 0, errors = 0, sov = null) => ({ provider, model: 'm', denominator: answers, judged, either: { rate: judged ? Math.round(cited / judged * 1000) / 10 : null, numerator: cited, denominator: judged }, mention_count: mention, service_mention_rate: answers ? Math.round(mention / answers * 1000) / 10 : null, not_shown_count: notShown, error_count: errors, sov });
const ty = (answers, mention, cite, citeJudged, notShown = 0, errors = 0) => ({ answers, mention, cite, citeJudged, notShown, errors });
const ans = (prompt, engine, o) => Object.assign({ prompt, engine, status: 'ok', mentioned: 1, cited: 1, cite_source: 'ai_sources', citations: ['https://hana.example/'], answer: '回答 ' + prompt, measured_at: '2026-10-05T01:00:00Z', model: 'sonar', conditions: { engine, search: true } }, o);

const runs = [
  // 9月（前月）: 同じ質問の版 v1
  { measured_on: '2026-09-15', created_at: '2026-09-15T01:00:00Z', summary: sm('v1', [prov('perplexity', 10, 8, 2, 4)], { general: ty(8, 2, 1, 6), branded: ty(2, 2, 1, 2) }) },
  // 10月1回目: 判定できた8件中4件・表示なし0・エラー0
  { measured_on: '2026-10-05', created_at: '2026-10-05T01:00:00Z', summary: sm('v1', [prov('perplexity', 10, 8, 4, 6, 0, 0, 30), prov('google_aio', 7, 7, 1, 2, 3, 0)], { general: ty(14, 6, 3, 13, 3, 0), branded: ty(3, 2, 2, 2) },
    [ans('渋谷 美容室', 'perplexity'), ans('渋谷 美容室', 'google_aio', { status: 'not_shown', mentioned: null, cited: null, cite_source: 'not_shown', citations: [] })]) },
  // 10月2回目（最新）: 判定できた6件中3件・エラー2
  { measured_on: '2026-10-19', created_at: '2026-10-19T01:00:00Z', summary: sm('v1', [prov('perplexity', 8, 6, 3, 5, 0, 2, 40), prov('google_aio', 10, 9, 0, 1, 0, 0)], { general: ty(15, 5, 2, 13, 0, 2), branded: ty(3, 1, 1, 2) },
    [ans('渋谷 カット', 'perplexity', { status: 'error', error: '回数の上限', mentioned: null, cited: null, cite_source: 'error', citations: [] }), ans('渋谷 カット', 'google_aio', { cited: 0, cite_source: 'answer_text', citations: [], urls_in_answer: ['https://x.example/'] })]) }
];
const c = R.compileReport({ client: { name: 'Hana' }, periodMonth: '2026-10-01', now: new Date('2026-10-31T00:00:00Z'), scans: [], runs, traffic: [], actions: [] });
const ai = c.ai;
const pp = ai.providers.find((p) => p.provider === 'perplexity');
const aio = ai.providers.find((p) => p.provider === 'google_aio');
expect('月次：10月の2回の計測を合計（最新1回だけではない）', ai.basis === 'monthly' && ai.runs === 2 && ai.firstOn === '2026-10-05' && ai.lastOn === '2026-10-19', JSON.stringify({ b: ai.basis, r: ai.runs }));
expect('月次：Perplexity の引用＝分子7 ÷ 分母14＝50%（回答18・判定できない4・エラー2）', pp.citeCount === 7 && pp.judged === 14 && pp.citeRate === 50 && pp.answers === 18 && pp.undetermined === 4 && pp.errors === 2 && pp.runs === 2, JSON.stringify(pp));
expect('月次：言及＝11 ÷ 18 ＝ 61.1%', pp.mentionCount === 11 && pp.mentionRate === 61.1, JSON.stringify(pp));
expect('月次：AI による概要の表示なし3は件数で（分母に入れない）', aio.notShown === 3 && aio.answers === 17 && aio.judged === 16 && aio.citeCount === 1 && aio.citeRate === 6.3, JSON.stringify(aio));
expect('月次：前月（9月・同じ版）と比べた引用率の差 25% → 50% ＝ +25', pp.prevCiteRate === 25 && pp.citeDelta === 25 && ai.comparable === true, JSON.stringify(pp));
expect('最新1回は別に残す（10/19・Perplexity 50%・SOV 40）', ai.latest.measuredOn === '2026-10-19' && ai.latest.providers.find((p) => p.provider === 'perplexity').citeRate === 50 && pp.sov === 40, JSON.stringify(ai.latest));
expect('一般／指名を月で合計（一般：引用 5/26・表示なし3・エラー2）', ai.types.general.cite === 5 && ai.types.general.citeJudged === 26 && ai.types.general.citeRate === 19.2 && ai.types.general.notShown === 3 && ai.types.general.errors === 2 && ai.types.general.undetermined === 3 && ai.types.branded.citeRate === 75, JSON.stringify(ai.types));
expect('根拠：月内の回答の記録（質問・AI・状態・判定方法・出典・計測日時）', ai.evidence.length === 4 && ai.evidence.some((e) => e.status === 'not_shown') && ai.evidence.some((e) => e.status === 'error' && e.error === '回数の上限') && ai.evidence.some((e) => e.citeSource === 'answer_text' && e.urlsInAnswer[0] === 'https://x.example/') && ai.evidence[0].measuredAt === '2026-10-05T01:00:00Z', JSON.stringify(ai.evidence.map((e) => e.status + ':' + e.citeSource)));
expect('推移の引用率も月の合計（9月25・10月50）', c.history.slice(4).map((h) => h.cite.perplexity).join() === '25,50', JSON.stringify(c.history.slice(4).map((h) => h.cite)));

// 質問の版が月の中で変わったら、前月と比べない
const runs2 = runs.concat([{ measured_on: '2026-10-25', created_at: '2026-10-25T01:00:00Z', summary: sm('v2', [prov('perplexity', 10, 10, 10, 10)], null) }]);
const c2 = R.compileReport({ client: { name: 'Hana' }, periodMonth: '2026-10-01', now: new Date('2026-10-31T00:00:00Z'), scans: [], runs: runs2, traffic: [], actions: [] });
expect('月内で質問の版が2つ → 前月との差は出さない', c2.ai.comparable === false && c2.ai.providers.find((p) => p.provider === 'perplexity').citeDelta === null && c2.ai.versions.length === 2, JSON.stringify(c2.ai.versions));
// 分母の無い計測スクリプトの summary（率と回答の数から戻す）
const script = { measured_on: '2026-10-10', summary: { query_set_version: 'v1', by: [{ provider: 'openai', model: 'gpt', group: 'main', denominator: 40, either: { rate: 12.5, numerator: 5 }, service_mention_rate: 30 }] } };
const c3 = R.compileReport({ client: { name: 'Hana' }, periodMonth: '2026-10-01', now: new Date('2026-10-31T00:00:00Z'), scans: [], runs: [script], traffic: [], actions: [] });
const o3 = c3.ai.providers[0];
expect('計測スクリプトの summary：分母＝回答40・分子5・言及12', o3.judged === 40 && o3.citeCount === 5 && o3.citeRate === 12.5 && o3.mentionCount === 12, JSON.stringify(o3));
// 引用を判定しない AI（ChatGPT 検索なし）は分母0・率は null（0% にしない）
const c4 = R.compileReport({ client: { name: 'Hana' }, periodMonth: '2026-10-01', now: new Date('2026-10-31T00:00:00Z'), scans: [], traffic: [], actions: [],
  runs: [{ measured_on: '2026-10-10', summary: sm('v1', [prov('openai', 10, 0, 0, 3)], null) }] });
expect('出典を判定できた回答が0 → 引用率は null（0% にしない）・判定できない10', c4.ai.providers[0].citeRate === null && c4.ai.providers[0].undetermined === 10, JSON.stringify(c4.ai.providers[0]));

// 判定方法を変える前の Studio の計測（not_shown_count・answers が無い）は、同じ月に新しい計測があれば合計に入れない
{
  const oldStudio = { measured_on: '2026-10-03', created_at: '2026-10-03T06:00:00Z', summary: { source: 'studio', query_set_version: 'v1', by: [{ provider: 'google_aio', group: 'main', model: 'serp', denominator: 5, judged: 5, either: { rate: 0, numerator: 0 }, service_mention_rate: 0 }] } };
  const script = { measured_on: '2026-10-04', summary: { query_set_version: 'v1', by: [{ provider: 'openai', model: 'gpt', group: 'main', denominator: 10, either: { rate: 10, numerator: 1 }, service_mention_rate: 20 }] } };
  const cA = R.compileReport({ client: { name: 'Hana' }, periodMonth: '2026-10-01', now: new Date('2026-10-31T00:00:00Z'), scans: [], traffic: [], actions: [], runs: [oldStudio, script].concat(runs.slice(1)) });
  const aioA = cA.ai.providers.find((p) => p.provider === 'google_aio');
  expect('古い Studio の計測は除く（AI による概要の分母は新しい計測の16だけ）・計測スクリプトは残す・除いた数', cA.ai.excludedOld === 1 && aioA.judged === 16 && cA.ai.providers.some((p) => p.provider === 'openai') && cA.ai.runs === 3, JSON.stringify({ ex: cA.ai.excludedOld, j: aioA.judged, runs: cA.ai.runs }));
  const cB = R.compileReport({ client: { name: 'Hana' }, periodMonth: '2026-10-01', now: new Date('2026-10-31T00:00:00Z'), scans: [], traffic: [], actions: [], runs: [oldStudio] });
  expect('新しい計測が無い月は、古い計測をそのまま使う（何も出ないよりよい）', cB.ai.excludedOld === 0 && cB.ai.providers[0].judged === 5);
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
