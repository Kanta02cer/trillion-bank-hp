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
{ const onlyG = C.aioHero({ aio: null, chatgpt: { now: { x: 1, n: 4, rate: 25, measuredOn: '2026-10-07' }, prev: null } });
  t('AI による概要を測っていない月：2つの枠（AI による概要は未計測・ChatGPT は 1/4）', /AI による概要[\s\S]*未計測/.test(onlyG) && /ChatGPT の回答に名前が出た回数[\s\S]*1<\/b> \/ 4回/.test(onlyG), onlyG); }
{ const H = ctx.AirReachClientHome; const nh = H.numbers({ period_month: '2026-10-01', compiled: { site: {}, ai: { providers: [{ provider: 'perplexity', judged: 8, citeCount: 3 }, { provider: 'openai', judged: 6, citeCount: 2 }] }, traffic: {}, chatgpt: { now: { x: 1, n: 4 }, prev: null }, aio: null } });
  t('お客様のホーム：複数の AI を合わせた出典の割合を出さない・2つの枠', !/出典になった/.test(nh) && /AI による概要に名前が出た[\s\S]*未計測/.test(nh) && /ChatGPT の回答に名前が出た（補助）[\s\S]*1<\/b>/.test(nh), nh.slice(0, 600)); }
// ---- 測ったのに数えられる検索が1件も無い（すべて取得に失敗）ときは「測定不能」。0 / 0回とは書かない ----
{ const cc = R.compileReport({ client, periodMonth: '2026-10-01', now: new Date('2026-10-28T00:00:00Z'), scans: [], runs: [run('2026-09-07', 'mnsne'), run('2026-10-28', 'eeeee')], traffic: [], actions: [] });
  t('すべて失敗：測定不能（理由）・比べない', cc.aio && cc.aio.now.n === 0 && /^測定不能（有効な回答が0件：取得に失敗 5回）$/.test(cc.aio.now.unmeasurable) && !cc.aio.comparable && cc.aio.diff === null && /測定不能/.test(cc.aio.reason), cc.aio);
  const hh = C.aioHero(cc);
  t('レポート：0 / 0回を出さない', /測定不能（有効な回答が0件：取得に失敗 5回）/.test(hh) && !/<b>0<\/b> \/ 0回/.test(hh), hh.slice(0, 400));
  const nh = ctx.AirReachClientHome.numbers({ period_month: '2026-10-01', compiled: { site: {}, traffic: {}, aio: cc.aio, chatgpt: null } });
  t('お客様のホーム：測定不能（理由）', /測定不能（有効な回答が0件/.test(nh) && !/0<\/b><small> \/ 0回/.test(nh), nh.slice(0, 400)); }
// ---- 計測ごとの結果（月2回）：初回は改善前の基準、2回目からは1つ前と同じ条件のときだけ差。違う条件・測定不能は理由 ----
{ const rr = (day, t, pat, x) => Object.assign(run(day, pat, x), { id: 'r-' + day + t, created_at: day + 'T0' + t + ':00:00Z' });
  // 9/7 初回 → 10/7（同じ条件）→ 10/21（地域が違う）→ 10/28（すべて失敗）
  const runs = [rr('2026-09-07', 2, 'mnsne'), rr('2026-10-07', 2, 'mmsnn'), rr('2026-10-21', 2, 'mmmnn', { location: 'Tokyo,Japan' }), rr('2026-10-28', 3, 'eeeee', { location: 'Tokyo,Japan' })];
  const cs = R.compileReport({ client, periodMonth: '2026-09-01', now: new Date('2026-09-30T00:00:00Z'), scans: [], runs, traffic: [], actions: [] });
  t('初回：改善前の基準（前回なし）', cs.runs && cs.runs.length === 1 && cs.runs[0].first === true && cs.runs[0].engines[0].x === 1 && cs.runs[0].engines[0].n === 4 && cs.runs[0].engines[0].comparable === undefined, cs.runs);
  const co = R.compileReport({ client, periodMonth: '2026-10-01', now: new Date('2026-10-30T00:00:00Z'), scans: [], runs, traffic: [], actions: [] });
  const [a, b, c2] = co.runs || [];
  t('月の中の計測を1回ずつ（3回）', co.runs && co.runs.length === 3 && !a.first && a.prevOn === '2026-09-07' && b.prevOn === '2026-10-07', co.runs);
  // AI による概要は、概要が出なかった検索も分母に入れる（2/5 ＝ 40%、前回 1/4 ＝ 25% → +15）
  t('同じ条件：前回と差を出す（1/4 → 2/5 ＝ +15）', a.engines[0].comparable === true && a.engines[0].x === 2 && a.engines[0].n === 5 && a.engines[0].diff === 15 && a.engines[0].prev.x === 1 && a.engines[0].prev.n === 4, a.engines[0]);
  t('地域が違う：差を出さず理由', b.engines[0].comparable === false && b.engines[0].diff === null && /地域/.test(b.engines[0].reason), b.engines[0]);
  t('すべて失敗：測定不能（理由）・比べない', c2.engines[0].unmeasurable === '測定不能（有効な回答が0件：取得に失敗 5回）' && c2.engines[0].comparable === false && c2.engines[0].rate === null, c2.engines[0]);
  t('ChatGPT を測っていない回は未計測', a.engines[1] && a.engines[1].measured === false, a.engines[1]);
  const old = R.compileReport({ client, periodMonth: '2026-10-01', now: new Date('2026-10-30T00:00:00Z'), scans: [], runs: [{ id: 'old', measured_on: '2026-08-20', created_at: '2026-08-20T01:00:00Z', summary: { by: [] } }].concat(runs.slice(1, 2)), traffic: [], actions: [] });
  t('前に古い形の計測があれば初回にしない', old.runs && old.runs[0].first === false, old.runs);
  t('回答の記録が無い計測だけなら runs は null', R.compileReport({ client, periodMonth: '2026-10-01', scans: [], runs: [{ measured_on: '2026-10-28', summary: { by: [] } }], traffic: [], actions: [] }).runs === null); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
