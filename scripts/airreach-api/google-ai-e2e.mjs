/**
 * Search Console のデータが外部の AI に送られないことの E2E（Playwright・実際の Studio の画面）。
 *   SITE_DIR=<ビルド済み _site> node scripts/airreach-api/google-ai-e2e.mjs
 * ブラウザに Search Console の検索語句（目印の語）を含む作業を入れ、AI計測（手動・自動・作り直し）を動かす。
 * 計測 API（/api/hack2-measure/）への送信をすべて記録し、目印の語・未確定の質問が1件も入らないことを確かめる。
 * 本物の API・AI・Supabase・Google には接続しない（同じ origin 以外への通信は止めて記録する）。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const SITE = process.env.SITE_DIR;
if (!SITE || !fs.existsSync(path.join(SITE, 'airreach/studio/index.html'))) { console.error('SITE_DIR（ビルド済みの _site）を指定してください'); process.exit(2); }

const results = [];
const expect = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(detail).slice(0, 400)}`); };

// ---- 静的配信（Vercel の cleanUrls / trailingSlash 相当）----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(SITE, p);
  if (p.endsWith('/')) f = path.join(f, 'index.html');
  else if (!path.extname(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---- 目印の語（Search Console の検索語句）。これが計測 API への送信に1つでも入れば失敗 ----
const MARK = ['ジーエスシー検索語アルファ', 'ジーエスシー検索語ベータ', 'ジーエスシー検索語ガンマ'];
const CLIENT = '59824617-70f0-4a9d-a52e-d6353910f3e5';
function seed({ prompts }) {
  const studio = {
    profile: { brand: '目印商店', url: 'https://mejirushi.example/', service: '雑貨' },
    competitors: [], hack2: [], generated: {}, faqSuggestions: [], gaps: [], google: { gscSite: 'sc-domain:mejirushi.example' },
    measurements: [
      { date: '2026-09-01', keyword: MARK[0], url: 'https://mejirushi.example/a', impressions: 900, clicks: 40, position: 3, gscProperty: 'sc-domain:mejirushi.example' },
      { date: '2026-09-01', keyword: MARK[1], url: 'https://mejirushi.example/b', impressions: 300, clicks: 9, position: 6 }
    ],
    keywords: [
      { id: 'k1', text: MARK[2], seed_source: 'GSC', gsc_impressions: 1200, priority: 'P0' },
      { id: 'k2', text: MARK[0], priority: 'P0', gsc_impressions: 900 },          // 出どころ不明の古いデータ
      { id: 'k3', text: '雑貨 ギフト', seed_source: 'Site', priority: 'P2', gsc_impressions: 0 },
      { id: 'k4', text: '雑貨 通販', seed_source: 'Generated', priority: 'P2' }
    ],
    prompts
  };
  const orch = { lastJob: { url: 'https://mejirushi.example/', keywords: [{ keyword: MARK[1], seed_source: 'GSC', gsc_impressions: 300 }, { keyword: '雑貨 ギフト', seed_source: 'Site' }] } };
  return { studio: JSON.stringify(studio), orch: JSON.stringify(orch) };
}
// 以前の作業（変更前に作られた質問）: 出どころ・確定の印が無い。Search Console の語から作ったものを含む
const LEGACY = [
  { id: 'p1', text: '「' + MARK[0] + '」でおすすめのところを教えて', on: true, src: 'keyword' },
  { id: 'p2', text: MARK[2] + 'について教えて', on: true, src: 'keyword' },
  { id: 'p3', text: '目印商店の評判を教えて', on: true, src: 'branded' }
];

const browser = await chromium.launch();
async function openStudio(prompts, { client = false } = {}) {
  const ctx = await browser.newContext();
  const sent = [], external = [], google = [];
  const s = seed({ prompts });
  await ctx.addInitScript(([st, orch, cid]) => {
    try {
      if (!sessionStorage.getItem('e2e_seeded')) {
        localStorage.clear();
        localStorage.setItem('airreach_studio_v1', st);
        localStorage.setItem('airreach_studio_orch_v1', orch);
        if (cid) localStorage.setItem('airreach_studio_ws_current_v1', cid);
        sessionStorage.setItem('e2e_seeded', '1');
      }
    } catch (e) {}
  }, [s.studio, s.orch, client ? CLIENT : '']);
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    // 計測 API は Vercel の API ホスト（meta tb-api-base）にも送られる。どのホスト宛てでも記録する
    if (u.pathname.startsWith('/api/hack2-measure')) {
      const cors = { 'Access-Control-Allow-Origin': BASE, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-AirReach-Key', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      sent.push(route.request().postData() || '');
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, rows: [], engineStatus: {} }) });
    }
    if (u.origin !== BASE) { external.push(u.host); return route.abort(); }
    if (u.pathname.startsWith('/api/google/')) { google.push(u.pathname); return route.fulfill({ status: 401, contentType: 'application/json', body: '{"code":"login_required"}' }); }
    if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' });
    return route.continue();
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '/airreach/studio/' + (client ? `?client=${CLIENT}&client_name=${encodeURIComponent('目印商店')}` : '') + '#hack2', { waitUntil: 'load' });
  await page.waitForSelector('#hack2-prompts', { state: 'attached' });
  await page.waitForTimeout(400);
  return { ctx, page, sent, external, google, errors };
}
const leaked = (bodies) => bodies.filter((b) => MARK.some((m) => b.indexOf(m) >= 0));
const promptsOf = (bodies) => bodies.flatMap((b) => { try { return JSON.parse(b).prompts || []; } catch (e) { return []; } });

// ---- 1. 以前の作業のまま「計測実行」を押す（確定した質問が無い）→ 何も送らない ----
{
  const t = await openStudio(LEGACY);
  await t.page.click('#run-hack2-measure');
  await t.page.waitForTimeout(800);
  const status = await t.page.textContent('#hack2-status');
  expect('1. 確定した質問が無い → 計測 API に何も送らない', t.sent.length === 0, t.sent.join('\n'));
  expect('1. 「確定してください」と、送れない数（Search Console 由来）を出す', /確定/.test(status || '') && /Search Console 由来/.test(status || ''), status);
  const html = await t.page.innerHTML('#hack2-prompts');
  expect('1. 古い Search Console 由来の質問に「送れません」の印', (html.match(/Search Console 由来・送れません/g) || []).length === 2, (html.match(/Search Console 由来・送れません/g) || []).length);
  expect('1. 画面のエラーなし', t.errors.length === 0, t.errors.join(' | '));
  await t.ctx.close();
}

// ---- 2. 「チェックした質問を確定する」→ 計測 → 送るのは確定できた質問（指名質問）だけ ----
{
  const t = await openStudio(LEGACY);
  await t.page.click('#prompt-confirm-all');
  await t.page.waitForTimeout(200);
  await t.page.click('#run-hack2-measure');
  await t.page.waitForTimeout(1200);
  const ps = promptsOf(t.sent);
  expect('2. 計測 API に送った', t.sent.length >= 1, t.sent.length);
  expect('2. Search Console の検索語句が1つも入らない', leaked(t.sent).length === 0, leaked(t.sent).join('\n'));
  expect('2. 送ったのは確定した指名質問だけ', ps.length === 1 && ps[0].prompt === '目印商店の評判を教えて' && ps[0].confirmed === true, JSON.stringify(ps));
  await t.ctx.close();
}

// ---- 3. 「キーワードから作り直す」→ 候補に Search Console の語が入らない → 確定して計測 ----
{
  const t = await openStudio([]);
  await t.page.click('#prompt-reset');
  await t.page.waitForTimeout(300);
  const st = await t.page.evaluate(() => JSON.parse(localStorage.getItem('airreach_studio_v1')).prompts);
  expect('3. 作り直した候補に Search Console の検索語句が入らない', st.length > 0 && !st.some((p) => MARK_IN(p.text)), JSON.stringify(st.map((p) => p.text)));
  expect('3. 作り直した候補はすべて未確定', st.every((p) => p.confirmed === false), JSON.stringify(st.map((p) => p.confirmed)));
  await t.page.click('#run-hack2-measure');
  await t.page.waitForTimeout(600);
  expect('3. 確定する前は送らない', t.sent.length === 0, t.sent.join('\n'));
  await t.page.click('#prompt-confirm-all');
  await t.page.click('#run-hack2-measure');
  await t.page.waitForTimeout(1200);
  const ps = promptsOf(t.sent);
  expect('3. 確定したあとは送る・Search Console の検索語句は入らない', t.sent.length >= 1 && leaked(t.sent).length === 0 && ps.every((p) => p.confirmed === true), leaked(t.sent).join('\n'));
  expect('3. サイト・自動生成の語から作った質問は送れる', ps.some((p) => /雑貨 ギフト|雑貨 通販/.test(p.prompt)), JSON.stringify(ps.map((p) => p.prompt)));
  await t.ctx.close();
}
function MARK_IN(text) { return MARK.some((m) => String(text || '').indexOf(m) >= 0); }

// ---- 4. 自分で入力した質問はそのまま確定。古い Search Console 由来の質問は（確定済みに書き換えても）送らない ----
{
  const tampered = LEGACY.map((p) => Object.assign({}, p, { confirmed: true }));
  const t = await openStudio(tampered);
  await t.page.fill('#prompt-new', '雑貨のギフトを買えるお店を教えて');
  await t.page.click('#prompt-add');
  await t.page.click('#run-hack2-measure');
  await t.page.waitForTimeout(1200);
  const ps = promptsOf(t.sent);
  expect('4. Search Console の語から作った古い質問は、確定の印があっても送らない', leaked(t.sent).length === 0, leaked(t.sent).join('\n'));
  expect('4. 入力して追加した質問は送る', ps.some((p) => p.prompt === '雑貨のギフトを買えるお店を教えて' && p.origin === 'manual'), JSON.stringify(ps));
  await t.ctx.close();
}

// ---- 5. 分析のあとの自動計測（顧客の作業）：確定した質問が無ければ自動では送らない ----
async function autoRun(prompts) {
  const t = await openStudio(prompts, { client: true });
  await t.page.evaluate(() => {
    const SC = window.AirReachStudioClients;
    if (SC) { SC.measuredThisMonth = () => Promise.resolve(false); SC.current = SC.current || (() => ({ id: 'x' })); }
    // 分析を始めた → 結果が出た（Studio の initApp が見ている流れ）
    const run = document.getElementById('orch-run'); if (run) run.dispatchEvent(new Event('click'));
    const res = document.getElementById('orch-result'); if (res) { res.hidden = true; setTimeout(() => { res.hidden = false; }, 50); }
  });
  await t.page.waitForTimeout(3200);
  return t;
}
{
  const t = await autoRun(LEGACY);
  const note = await t.page.evaluate(() => (document.getElementById('orch-auto-measure') || {}).textContent || '');
  expect('5. 自動計測：確定した質問が無い → 何も送らない', t.sent.length === 0, t.sent.join('\n'));
  expect('5. 自動計測：測らなかった理由を出す', /確定/.test(note), note);
  await t.ctx.close();
}
{
  const t = await autoRun(LEGACY.concat([{ id: 'p9', text: '雑貨のギフトを買えるお店を教えて', on: true, src: 'manual', confirmed: true }]));
  const ps = promptsOf(t.sent);
  expect('5. 自動計測：確定した質問だけを送る（Search Console の検索語句は入らない）', t.sent.length >= 1 && leaked(t.sent).length === 0 && ps.length === 1 && ps[0].prompt === '雑貨のギフトを買えるお店を教えて', JSON.stringify(ps));
  expect('5. 外部（AI のサービスなど）へのブラウザからの直接の通信は無い', !t.external.some((h) => /openai|anthropic|perplexity|generativelanguage|serpapi|typesafe|gateway/.test(h)), t.external.join(','));
  await t.ctx.close();
}

await browser.close();
server.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
