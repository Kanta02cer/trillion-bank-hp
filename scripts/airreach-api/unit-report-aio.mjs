// 月次レポートの主の AI の数字（compiled.aio・2026年10月から）。架空の計測だけ
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ctx = { console, URL, JSON, Math, Date, TextEncoder };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['airreach-ai3.js', 'airreach-compare.js', 'airreach-report.js', 'airreach-report-charts.js', 'airreach-client-home.js']) {
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8'), ctx, { filename: f }); } catch (e) { console.log('load', f, e.message); }
}
const R = ctx.AirReachReport, C = ctx.AirReachCharts;
let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, got === undefined ? '' : JSON.stringify(got).slice(0, 300)); } };
const cond = (x) => Object.assign({ engine: 'google_aio', search: true, location: 'JP', model: 'serpapi/x' }, x || {});
const Q = ['渋谷でおすすめの美容室は？', '渋谷で縮毛矯正が上手い美容室は？', '渋谷駅近くのカラーは？', '渋谷の個室美容室は？', '渋谷で安いカットは？'];
const ans = (pat, x) => Q.map((q, i) => ({ prompt: q, engine: 'google_aio', status: pat[i] === 's' ? 'not_shown' : pat[i] === 'e' ? 'error' : 'ok', mentioned: pat[i] === 'm' ? 1 : pat[i] === 'n' ? 0 : null, judge_version: 'judge/2026.10.08', brand: 'サンプル美容室 Hana', conditions: cond(x) }))
  .concat([{ prompt: 'サンプル美容室 Hana の評判は？', engine: 'google_aio', status: 'ok', mentioned: 1, judge_version: 'judge/2026.10.08', brand: 'サンプル美容室 Hana', conditions: cond(x) }]);
const run = (day, pat, x, ver) => ({ measured_on: day, created_at: day + 'T02:00:00Z', query_set_version: ver || 'v3', summary: { answers: ans(pat, x), by: [] } });
const client = { id: 'c1', name: 'サンプル美容室 Hana' };
let c = R.compileReport({ client, periodMonth: '2026-10-01', now: new Date('2026-10-28T00:00:00Z'), scans: [], runs: [run('2026-09-07', 'mnsne'), run('2026-10-28', 'mmsmn')], traffic: [], actions: [] });
t('今月：一般の質問で 3 / 5回（概要なしも分母・指名は除く）', c.aio && c.aio.now.x === 3 && c.aio.now.n === 5, c.aio);
t('先月：1 / 4回（失敗は分母に入れない）', c.aio.prev.x === 1 && c.aio.prev.n === 4);
t('同じ条件なので差を出す（25%→60% ＝ +35）', c.aio.comparable && c.aio.diff === 35, c.aio);
c = R.compileReport({ client, periodMonth: '2026-10-01', now: new Date('2026-10-28T00:00:00Z'), scans: [], runs: [run('2026-09-07', 'mnsne', { location: 'Tokyo,Japan' }), run('2026-10-28', 'mmsmn')], traffic: [], actions: [] });
t('地域が違えば差を出さない（理由を残す）', c.aio && !c.aio.comparable && c.aio.diff === null && /地域/.test(c.aio.reason), c.aio);
c = R.compileReport({ client, periodMonth: '2026-10-01', now: new Date('2026-10-28T00:00:00Z'), scans: [], runs: [run('2026-10-28', 'mmsmn')], traffic: [], actions: [] });
t('先月の計測が無ければ prev は null', c.aio && c.aio.prev === null);
c = R.compileReport({ client, periodMonth: '2026-10-01', now: new Date('2026-10-28T00:00:00Z'), scans: [], runs: [{ measured_on: '2026-10-28', summary: { by: [] } }], traffic: [], actions: [] });
t('回答の記録が無い計測だけなら aio は null（今までどおり）', c.aio === null);
c = R.compileReport({ client, periodMonth: '2026-10-01', now: new Date('2026-10-28T00:00:00Z'), scans: [], runs: [run('2026-09-07', 'mnsne'), run('2026-10-28', 'mmsmn')], traffic: [], actions: [] });
const h = C.aioHero(c);
t('レポート：X / N 回・出現率・先月・数え方の注記', /<b>3<\/b> \/ 5回/.test(h) && /出現率 60%/.test(h) && /先月 1 \/ 4回（出現率 \+35ポイント）/.test(h) && /2026年10月から/.test(h), h);
t('aio が無い古いレポートでは何も出さない', C.aioHero({}) === '' && C.aioHero({ aio: null }) === '');
{ const o = (ps) => ps.map((r) => Object.assign({}, r, { summary: { answers: r.summary.answers.map((a) => { const b = Object.assign({}, a); delete b.judge_version; return b; }), by: [] } }));
  const cc = R.compileReport({ client, periodMonth: '2026-10-01', now: new Date('2026-10-28T00:00:00Z'), scans: [], runs: o([run('2026-09-07', 'mnsne'), run('2026-10-28', 'mmsmn')]), traffic: [], actions: [] });
  t('判定の版が記録されていない月どうしは差を出さない（理由を残す）', cc.aio && !cc.aio.comparable && cc.aio.diff === null && /判定の版/.test(cc.aio.reason), cc.aio); }
// ---- 2対象（10/9）：補助の ChatGPT も同じ数え方で月次に。AI による概要とは合算しない ----
{ const cg = (pat) => Q.map((q, i) => ({ prompt: q, engine: 'chatgpt_search', status: pat[i] === 'e' ? 'error' : 'ok', mentioned: pat[i] === 'm' ? 1 : 0, judge_version: 'judge/2026.10.08', brand: 'サンプル美容室 Hana', conditions: { engine: 'chatgpt_search', search: true, location: 'JP', model: 'openai/x' } }));
  const rr = (day, a, b) => ({ measured_on: day, created_at: day + 'T02:00:00Z', query_set_version: 'v3', summary: { answers: ans(a).concat(cg(b)), by: [] } });
  const cc = R.compileReport({ client, periodMonth: '2026-10-01', now: new Date('2026-10-28T00:00:00Z'), scans: [], runs: [rr('2026-09-07', 'mnsne', 'nnnnn'), rr('2026-10-28', 'mmsmn', 'mnnne')], traffic: [], actions: [] });
  t('ChatGPT（補助）：今月 1/4（失敗は分母に入れない）・先月 0/5・同じ条件で +25', cc.chatgpt && cc.chatgpt.now.x === 1 && cc.chatgpt.now.n === 4 && cc.chatgpt.prev.x === 0 && cc.chatgpt.prev.n === 5 && cc.chatgpt.diff === 25 && cc.aio.now.x === 3, cc.chatgpt);
  const hh = C.aioHero(cc);
  t('月次の数字：AI による概要（主）のあとに ChatGPT（補助・検索付き API での観測）・合算しない', hh.indexOf('AI による概要') < hh.indexOf('ChatGPT の回答に名前が出た回数') && /検索付き API での観測（補助）/.test(hh) && /合算しません/.test(hh), hh.slice(0, 300)); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
