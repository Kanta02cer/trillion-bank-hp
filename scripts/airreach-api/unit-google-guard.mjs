/**
 * Google のユーザーデータの扱い（assets/js/airreach-google-guard.js）と、GitHub に出すパッケージ（airreach-orchestrator.js の googleFreeJob）の単体テスト。
 *   - Search Console の検索語句・数字を、AI計測の質問の生成・選択・並び順に使わない
 *   - 外部の AI に送るのは確定した質問だけ。Search Console 由来の質問は確定できず、送れない
 *   - 顧客の Google データを消したとき、このブラウザに残っている分も消せる
 *   - GitHub に出すパッケージに Search Console の検索語句・表示回数・クリックが入らない
 *   node scripts/airreach-api/unit-google-guard.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const G = createRequire(import.meta.url)(path.join(ROOT, 'assets/js/airreach-google-guard.js'));
const results = [];
const expect = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(detail).slice(0, 300)}`); };

// 架空の作業（Search Console の検索語句は「町田 焼肉 個室」「町田 焼肉 ランチ」「焼肉 デート」）
const GSC_Q = ['町田 焼肉 個室', '町田 焼肉 ランチ', '焼肉 デート'];
const state = () => ({
  profile: { brand: '炭火焼肉ハナ' },
  measurements: [
    { date: '2026-09-01', keyword: '町田 焼肉 個室', url: 'https://hana.example/', impressions: 900, clicks: 40, position: 3.1, gscProperty: 'sc-domain:hana.example' },
    { date: '2026-09-01', keyword: '町田 焼肉 ランチ', url: 'https://hana.example/lunch', impressions: 300, clicks: 9, position: 6 },
    { date: '2026-09-01', keyword: '炭火焼肉ハナ', impressions: 50, clicks: 20, position: 1 },
    { date: '2026-09-02', keyword: 'AI計測の行', impressions: 0, clicks: 0, position: 0, sessions: 0, keyEvents: 0, aiMention: 1, aiCitation: 0 },
    { date: '2026-09-02', url: '/lunch', host: 'hana.example', sessions: 120, keyEvents: 3 }
  ],
  keywords: [
    { text: '焼肉 デート', seed_source: 'GSC', gsc_impressions: 1200, priority: 'P0' },
    { text: '町田 焼肉', seed_source: 'Site', gsc_impressions: 5000, priority: 'P0', volume: null },
    { text: '町田 焼肉 個室', priority: 'P0' },                          // 出どころ不明の古いデータ（GSC の語と同じ）
    { text: '町田 焼肉 食べ放題', seed_source: 'Site', priority: 'P2', volume: 880 },
    { text: '町田 和牛', seed_source: 'Generated', priority: 'P2' }
  ],
  gscAuto: { property: 'sc-domain:hana.example' },
  gscTotals: { 'sc-domain:hana.example': { impressions: 24091, clicks: 700, days: 28 } },
  google: { gscSite: 'sc-domain:hana.example', gaProperty: '123456789' },
  hack2: [{ run_id: 'r1', prompt: 'x' }],
  generated: { 'llms.txt': 'x' }
});
const job = { keywords: [{ keyword: '町田 焼肉 ランチ', seed_source: 'GSC' }] };

// ---- 質問を作るときに使うキーワード -------------------------------------------------
const st = state(), ctx = G.ctxOf(st, job);
expect('GSC の検索語句を集める（Search Console の行・GSC のキーワード・分析の結果。GA4・AI の行は除く）',
  GSC_Q.every((q) => ctx.gsc[G.norm(q)]) && !ctx.gsc[G.norm('AI計測の行')], Object.keys(ctx.gsc).join(','));
const kws = G.promptKeywords(st.keywords, ctx).map((k) => k.text);
expect('出どころが GSC の語は質問に使わない', kws.indexOf('焼肉 デート') < 0, kws);
expect('出どころ不明で GSC の検索語句と同じ語は使わない', kws.indexOf('町田 焼肉 個室') < 0, kws);
expect('サイト・自動生成の語は使う', kws.indexOf('町田 焼肉') >= 0 && kws.indexOf('町田 和牛') >= 0 && kws.indexOf('町田 焼肉 食べ放題') >= 0, kws);
expect('並び順に表示回数・優先度（GSC で上がる）を使わない：Keyword Planner の検索数 → 文字コード順', JSON.stringify(kws) === JSON.stringify(['町田 焼肉 食べ放題', '町田 和牛', '町田 焼肉']), kws);
const kws2 = G.promptKeywords(st.keywords.map((k) => Object.assign({}, k, { gsc_impressions: 999999 - (k.gsc_impressions || 0), priority: 'P0' })), ctx).map((k) => k.text);
expect('GSC の数字を変えても、選ばれる語と順番は変わらない', JSON.stringify(kws2) === JSON.stringify(kws), kws2);

// ---- Search Console 由来の質問か ------------------------------------------------------
const D = (p) => G.isGoogleDerivedPrompt(p, ctx);
expect('google: true は由来あり（文を直しても外れない）', D({ text: 'まったく別の文', google: true }));
expect('src: gsc は由来あり', D({ text: 'x', src: 'gsc' }));
expect('GSC の語から作った質問（kwSeed: GSC）は由来あり', D({ text: '焼肉 デートでおすすめは？', src: 'keyword', kw: '焼肉 デート', kwSeed: 'GSC' }));
expect('サイトの語から作った質問は由来なし', !D({ text: '町田 焼肉でおすすめは？', src: 'keyword', kw: '町田 焼肉', kwSeed: 'Site' }));
expect('出どころ不明の古い質問で、文に GSC の検索語句が入っている → 由来あり', D({ text: '「町田 焼肉 個室」でおすすめのところを教えて', src: 'keyword' }));
expect('出どころ不明の古い質問で、GSC の検索語句が入っていない → 由来なし', !D({ text: '町田で和牛が食べられるお店は？', src: '' }));
expect('担当者が入力した質問は、同じ言葉があっても由来なし（はっきり設定した質問）', !D({ text: '町田 焼肉 個室のお店を教えて', src: 'manual' }));
expect('指名質問・お客様の質問は由来なし', !D({ text: '炭火焼肉ハナの評判を教えて', src: 'branded' }) && !D({ text: '町田 焼肉 ランチは？', src: 'customer' }));
expect('社名だけの検索語句（炭火焼肉ハナ）では、古い質問を由来ありにしない', !D({ text: '炭火焼肉ハナはどんなお店？', src: '' }));

// ---- 送れる質問 -------------------------------------------------------------------
const prompts = [
  { text: '町田 焼肉 個室のお店を教えて', src: 'manual', confirmed: true, on: true },            // 送れる
  { text: '炭火焼肉ハナの評判を教えて', src: 'branded', confirmed: false, on: true },             // 未確定
  { text: '「町田 焼肉 ランチ」でおすすめのところを教えて', src: 'keyword', confirmed: true, on: true }, // GSC 由来（古いデータで確定済みでも送らない）
  { text: '焼肉 デートでおすすめは？', src: 'keyword', kw: '焼肉 デート', kwSeed: 'GSC', on: true },    // GSC 由来
  { text: '町田 和牛のお店は？', src: 'keyword', kw: '町田 和牛', kwSeed: 'Generated', confirmed: true, on: false } // 毎月測らない
];
const pick = G.sendablePrompts(prompts, ctx);
expect('送れるのは「毎月測る・確定・GSC 由来でない」質問だけ', pick.send.length === 1 && pick.send[0].text === '町田 焼肉 個室のお店を教えて', JSON.stringify(pick.send));
expect('外した数（GSC 由来 2・未確定 1）', pick.google === 2 && pick.unconfirmed === 1, JSON.stringify(pick));
const marked = JSON.parse(JSON.stringify(prompts));
G.markPrompts(marked, ctx);
expect('GSC 由来の質問に印を付け、確定を外す', marked[2].google === true && marked[2].confirmed === false && marked[3].google === true && !marked[0].google);
expect('GSC 由来の質問は確定できない', !G.canConfirm(marked[2], ctx) && !G.canConfirm(marked[3], ctx) && G.canConfirm(marked[1], ctx));
marked[2].text = '町田でランチが食べられる焼肉店は？'; marked[2].src = 'manual';
expect('印の付いた質問は、文を直しても送れない', G.sendablePrompts([Object.assign({}, marked[2], { confirmed: true })], ctx).send.length === 0);
expect('API に送る形は confirmed と出どころを持つ', JSON.stringify(G.toApiPrompt(prompts[0])) === JSON.stringify({ keyword: prompts[0].text, prompt: prompts[0].text, confirmed: true, origin: 'manual' }));

// ---- このブラウザの Google データを消す --------------------------------------------------
function mem(init) {
  const m = new Map(Object.entries(init));
  return { get length() { return m.size; }, key: (i) => Array.from(m.keys())[i] || null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
const C1 = '59824617-70f0-4a9d-a52e-d6353910f3e5', C2 = 'd35725c9-9afd-4b18-b865-2077dfb9522f';
const work = JSON.stringify(state());
let ls = mem({
  airreach_studio_v1: work, airreach_studio_orch_v1: '{"lastJob":{}}', airreach_official_baseline_v1: '{"gscSites":[1]}', airreach_studio_ws_current_v1: C1,
  ['airreach_studio_ws_v1:' + C2]: JSON.stringify({ airreach_studio_v1: work, airreach_studio_orch_v1: '{}' }), ['airreach_studio_sync_v1:' + C2]: '{"version":3}',
  ['airreach_studio_backup_v1:' + C2]: '{}', airreach_google_props_v1: JSON.stringify({ [C1]: { gsc: 'sc-domain:hana.example' }, [C2]: { ga4: '1' } }), airreach_studio_key_v1: 'k'
});
G.purgeLocal({ clientId: C2, ack: '2026-10-07T00:00:00Z' }, ls);
expect('顧客を指定：その顧客の作業・控え・共有の版・Google の設定を消す',
  ls.getItem('airreach_studio_ws_v1:' + C2) === null && ls.getItem('airreach_studio_sync_v1:' + C2) === null && ls.getItem('airreach_studio_backup_v1:' + C2) === null && !JSON.parse(ls.getItem('airreach_google_props_v1'))[C2]);
expect('顧客を指定：ほかの顧客（いま開いている C1）の作業は残す', ls.getItem('airreach_studio_v1') === work && !!JSON.parse(ls.getItem('airreach_google_props_v1'))[C1]);
expect('消した日時を覚え、同じ削除で二度消さない', !G.needsPurge(C2, '2026-10-06T00:00:00Z', ls) && G.needsPurge(C2, '2026-10-07T00:00:00Z', ls) && G.needsPurge(C1, '2026-10-01T00:00:00Z', ls));
G.purgeLocal({ clientId: C1 }, ls);
expect('いま開いている顧客を指定：開いている作業と端末の基準値も消す', ls.getItem('airreach_studio_v1') === null && ls.getItem('airreach_studio_orch_v1') === null && ls.getItem('airreach_official_baseline_v1') === null);

ls = mem({ airreach_studio_v1: work, airreach_studio_orch_v1: '{"lastJob":{}}', airreach_official_baseline_v1: '{"gscSites":[1],"ga4Sites":[1]}',
  ['airreach_studio_ws_v1:' + C2]: JSON.stringify({ airreach_studio_v1: work, airreach_studio_orch_v1: '{}' }), ['airreach_studio_backup_v1:' + C2]: '{}', airreach_google_props_v1: '{}', airreach_studio_key_v1: 'k' });
G.purgeLocal({}, ls);
const after = JSON.parse(ls.getItem('airreach_studio_v1'));
const allText = Array.from(ls._m.values()).join('\n');
expect('全体：Google の行・GSC のキーワード・GSC の数字・設定を除く', after.measurements.length === 1 && after.measurements[0].keyword === 'AI計測の行'
  && after.keywords.every((k) => k.seed_source !== 'GSC' && k.gsc_impressions === undefined) && !after.gscAuto && !after.gscTotals && JSON.stringify(after.google) === '{}', JSON.stringify(after).slice(0, 300));
expect('全体：AI計測・作った文書・サイトのキーワードは残す', after.hack2.length === 1 && after.generated['llms.txt'] === 'x' && after.keywords.some((k) => k.text === '町田 焼肉'));
expect('全体：分析の控え・端末の基準値・Google の設定・作業の控えを消す', ls.getItem('airreach_studio_orch_v1') === null && ls.getItem('airreach_official_baseline_v1') === null && ls.getItem('airreach_google_props_v1') === null && ls.getItem('airreach_studio_backup_v1:' + C2) === null);
expect('全体：ほかの顧客の控えからも Google のデータを除く', JSON.parse(JSON.parse(ls.getItem('airreach_studio_ws_v1:' + C2)).airreach_studio_v1).measurements.length === 1);
expect('全体：消したあと、どこにも Search Console の検索語句と数字が残らない', !GSC_Q.some((q) => allText.indexOf(q) >= 0) && allText.indexOf('24091') < 0 && allText.indexOf('sc-domain:hana.example') < 0, GSC_Q.filter((q) => allText.indexOf(q) >= 0));
expect('全体：Google と関係ない保存（社内キー）は残す', ls.getItem('airreach_studio_key_v1') === 'k');

// ---- GitHub に出すパッケージ ------------------------------------------------------------
{
  const store = {};
  const ctx2 = { window: {}, console, URL, Date, JSON, Math, setTimeout, clearTimeout,
    document: { addEventListener() {}, readyState: 'loading', getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } } };
  ctx2.window = ctx2; vm.createContext(ctx2);
  for (const f of ['airreach-google-guard.js', 'airreach-package-schema.js', 'airreach-orchestrator.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8'), ctx2);
  store.airreach_studio_v1 = work;
  const O = ctx2.AirReachOrchestrator;
  const j = { url: 'https://hana.example/', industry: 'restaurant', profile: { brand: '炭火焼肉ハナ', url: 'https://hana.example/' }, keywords: [
    { keyword: '焼肉 デート', seed_source: 'GSC', cluster: 'GSC', gsc_impressions: 1200, gsc_clicks: 30, gsc_position: 4.2, priority: 'P0', why: '自社GSCで表示あり（1,200）', prompts: ['焼肉 デートでおすすめは？'] },
    { keyword: '町田 焼肉 ランチ', seed_source: 'Site', gsc_impressions: 300, gsc_clicks: 9, gsc_page: 'https://hana.example/lunch', action: 'GSC のページを直す', action_detail: '表示 300', action_auto: true, priority: 'P1', strength: '普通' },
    { keyword: '町田 和牛', seed_source: 'Generated', priority: 'P2', volume: null }
  ] };
  const free = O.googleFreeJob(j);
  expect('GitHub 用：GSC 由来の語を除く', free.keywords.length === 2 && !free.keywords.some((k) => k.keyword === '焼肉 デート'));
  expect('GitHub 用：GSC の数字・ページ・それで決めたやることと優先度を戻す', free.keywords.every((k) => k.gsc_impressions === undefined && k.gsc_clicks === undefined && k.gsc_page === undefined && !k.action_auto)
    && free.keywords.find((k) => k.keyword === '町田 焼肉 ランチ').priority === 'P2', JSON.stringify(free.keywords));
  expect('GitHub 用：元の分析結果（画面）は変えない', j.keywords.length === 3 && j.keywords[0].gsc_impressions === 1200);
  const files = O.buildPackageFiles(free, { noGoogle: true });
  const text = Object.keys(files).map((k) => String(files[k])).join('\n');
  expect('GitHub 用：パッケージに GSC の検索語句・表示回数が入らない', text.indexOf('焼肉 デート') < 0 && text.indexOf('1200') < 0 && text.indexOf('自社GSC') < 0 && text.indexOf('24091') < 0, text.slice(0, 200));
  expect('GitHub 用：パッケージの説明に「Google のデータは含めない」と書く', /Not included \(Google user data is not exported\)/.test(text));
}

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
