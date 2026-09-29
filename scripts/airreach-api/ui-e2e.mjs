/**
 * AirReach フロント × API の同一 origin E2E（Playwright）。
 *   SITE_DIR=<ビルド済み _site> node scripts/airreach-api/ui-e2e.mjs
 * ローカルハーネスが _site と /api/airreach/ を同じ origin で配信し、モック Supabase とモック対象サイトを使う。
 * 確認: 診断 → fetch API 使用 → 保存 201 → 共有リンク発行 → 別セッションで共有結果を復元 → 二重保存なし →
 *       無効トークン / API 障害時の表示 → desktop / mobile のスクリーンショット → workers.dev / allorigins への通信 0 件。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = process.env.SITE_DIR;
if (!SITE_DIR || !fs.existsSync(path.join(SITE_DIR, 'airreach', 'index.html'))) { console.error('SITE_DIR must point to a built _site containing airreach/index.html'); process.exit(2); }
const MOCK_PORT = 54321, TARGET_PORT = 54322, API_PORT = 3900;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const BASE = `http://127.0.0.1:${API_PORT}`;
const SERVICE_KEY = 'test-service-key';
const OUT = path.join(DIR, 'out', 'ui');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const record = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || !detail ? '' : '  — ' + detail}`); };
const expect = (name, cond, detail = '') => record(name, !!cond, detail);
async function mock(p, body) { const r = await fetch(MOCK + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); }
async function waitFor(url, ms) { const until = Date.now() + ms; while (Date.now() < until) { try { const r = await fetch(url); if (r.status < 500) return true; } catch {} await sleep(300); } return false; }

const children = [];
function start(name, file, env) {
  const c = spawn(process.execPath, [path.join(DIR, file)], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  c.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  children.push(c); return c;
}
start('mock', 'mock-supabase.mjs', { MOCK_PORT: String(MOCK_PORT), MOCK_SERVICE_KEY: SERVICE_KEY });
start('target', 'mock-target.mjs', { TARGET_PORT: String(TARGET_PORT) });
start('api', 'local-server.mjs', {
  PORT: String(API_PORT), SITE_DIR,
  SUPABASE_URL: MOCK, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  AIRREACH_SUPABASE_TIMEOUT_MS: '1500', AIRREACH_FETCH_TIMEOUT_MS: '4000',
  AIRREACH_FETCH_ALLOW_LOOPBACK_FOR_TESTS: '1',
  AIRREACH_TEST_RESOLVE_MAP: JSON.stringify({ 'rebind.test': '127.0.0.1' }),
});

const allRequests = [];
const SITE_URL = `http://rebind.test:${TARGET_PORT}/`;
let browser;
async function shutdown(code) {
  try { await mock('/__mock/reset', {}); } catch {}
  try { if (browser) await browser.close(); } catch {}
  for (const c of children) { try { c.kill('SIGTERM'); } catch {} }
  await sleep(300);
  process.exit(code);
}
function track(context, label) {
  context.on('request', (req) => allRequests.push({ label, url: req.url(), method: req.method() }));
  context.on('response', (res) => { const r = allRequests.find((x) => x.url === res.url() && x.status === undefined); if (r) r.status = res.status(); });
}
// 結果画面は段階表示（1 いま → 2 改善内容 → 3 詳細データ）。ツール群は 3 の中にあるので順に開く
async function openTools(page) {
  await page.click('#ar-cta-main');
  await page.waitForSelector('#actions:not(.is-hidden)', { timeout: 10000 });
  await page.click('#ar-cta-details');
  await page.waitForSelector('#expert-view:not(.is-hidden)', { timeout: 10000 });
  await page.click('#ar-more-tools > summary');
}
async function runDiagnosis(page) {
  await page.goto(`${BASE}/airreach/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#gate-url', { timeout: 15000 });
  await page.fill('#gate-url', SITE_URL);
  await page.selectOption('#gate-outcome-select', 'inquiry');
  await page.check('#gate-proxy');
  await page.click('#gate-next-1');
  await page.waitForURL(/\/airreach\/[a-z]+\/\?scan=/, { timeout: 30000 });
  await page.waitForSelector('#ar-dash.is-on', { timeout: 30000 });
  await page.waitForFunction(() => { const g = document.getElementById('ar-gauge'); return g && g.textContent && g.textContent.trim().length > 0; }, null, { timeout: 15000 }).catch(() => {});
}

try {
  expect('mock supabase up', await waitFor(`${MOCK}/__mock/state`, 10000));
  expect('mock target up', await waitFor(`http://127.0.0.1:${TARGET_PORT}/`, 10000));
  expect('harness up (site + api)', await waitFor(`${BASE}/api/airreach/health/`, 20000));
  const home = await fetch(`${BASE}/airreach/`); expect('built site served at /airreach/', home.status === 200 && /ar-gate/.test(await home.text()));

  browser = await chromium.launch();

  // ---- A: 診断者のセッション --------------------------------------------------------------
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  track(ctxA, 'A');
  const errorsA = [];
  const pageA = await ctxA.newPage();
  pageA.on('pageerror', (e) => errorsA.push(String(e)));
  await runDiagnosis(pageA);
  expect('A: result page reached (?scan=)', /\?scan=/.test(pageA.url()), pageA.url());
  const scanUrl = pageA.url();
  const fetchCalls = allRequests.filter((r) => r.label === 'A' && r.url.includes('/api/airreach/fetch/'));
  expect('A: page/llms/robots fetched via /api/airreach/fetch/ (3 calls, 200/404)', fetchCalls.length >= 3 && fetchCalls.every((r) => [200, 404, 410].includes(r.status)), JSON.stringify(fetchCalls.map((r) => r.status)));
  const posts = allRequests.filter((r) => r.label === 'A' && r.method === 'POST' && r.url.includes('/api/airreach/scans/'));
  expect('A: POST /api/airreach/scans/ → 201 exactly once', posts.length === 1 && posts[0].status === 201, JSON.stringify(posts.map((p) => p.status)));
  let st = await mock('/__mock/state');
  expect('A: mock stored 1 scan, no table access', st.scans.length === 1 && st.forbiddenPaths.length === 0);
  const gauge = await pageA.textContent('#ar-gauge').catch(() => '');
  expect('A: gauge shows a score', /\d/.test(gauge || ''), gauge);
  await openTools(pageA);
  await pageA.waitForSelector('#ar-cta-share:not([hidden])', { timeout: 8000 });
  const shareHref = await pageA.getAttribute('#ar-cta-share', 'href');
  expect('A: share link visible with ?share=<43-char token>', /\/airreach\/result\/\?share=[A-Za-z0-9_-]{43}$/.test(shareHref || ''), String(shareHref));
  const token = (shareHref || '').split('share=')[1] || '';
  await pageA.click('#ar-cta-share');
  await pageA.waitForFunction(() => /コピーしました/.test((document.getElementById('ar-share-note') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  const clip = await pageA.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  expect('A: clicking copies the share URL', clip === shareHref, clip.slice(0, 40));
  const lsA = await pageA.evaluate(() => JSON.stringify(localStorage));
  expect('A: owner keeps token in its own scan record', lsA.includes(token));
  await pageA.screenshot({ path: path.join(OUT, 'a-desktop-result.png'), fullPage: true });
  // 同じ scan を開き直しても再送しない（409 も発生しない）
  await pageA.goto(scanUrl, { waitUntil: 'domcontentloaded' });
  await pageA.waitForSelector('#ar-dash.is-on', { timeout: 30000 });
  await sleep(1500);
  st = await mock('/__mock/state');
  const posts2 = allRequests.filter((r) => r.label === 'A' && r.method === 'POST' && r.url.includes('/api/airreach/scans/'));
  expect('A: reopening own result does not POST again (no duplicate)', posts2.length === 1 && st.calls.filter((c) => c === 'insert').length === 1, `posts=${posts2.length} inserts=${st.calls.filter((c) => c === 'insert').length}`);
  expect('A: no page errors', errorsA.length === 0, errorsA.join(' | ').slice(0, 300));

  // ---- B: 共有リンクを受け取った別セッション（ストレージ空） ----------------------------------
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  track(ctxB, 'B');
  const errorsB = [];
  const pageB = await ctxB.newPage();
  pageB.on('pageerror', (e) => errorsB.push(String(e)));
  await pageB.goto(shareHref, { waitUntil: 'domcontentloaded' });
  await pageB.waitForURL(/\/airreach\/[a-z]+\/\?share=/, { timeout: 20000 });
  await pageB.waitForSelector('#ar-dash.is-on', { timeout: 30000 });
  await pageB.waitForSelector('#ar-shared-note:not([hidden])', { timeout: 10000 });
  const sharedNote = await pageB.textContent('#ar-shared-note');
  expect('B: shared view renders with shared note', /共有された診断結果/.test(sharedNote || ''), sharedNote);
  const gaugeB = await pageB.textContent('#ar-gauge').catch(() => '');
  expect('B: gauge shows the same score as A', gaugeB.trim() === gauge.trim(), `${gaugeB} vs ${gauge}`);
  const checkRows = await pageB.$$eval('#ar-detail-checks li', (els) => els.length).catch(() => 0);
  expect('B: detail checks rendered from raw_result', checkRows >= 10, String(checkRows));
  const fetchB = allRequests.filter((r) => r.label === 'B' && r.url.includes('/api/airreach/fetch/'));
  expect('B: shared view does not re-fetch the target site', fetchB.length === 0, String(fetchB.length));
  const getB = allRequests.filter((r) => r.label === 'B' && r.url.includes('/api/airreach/shared-scans/'));
  expect('B: shared-scans API called (result page + industry page)', getB.length >= 1 && getB.every((r) => r.status === 200), JSON.stringify(getB.map((r) => r.status)));
  const lsB = await pageB.evaluate(() => JSON.stringify(localStorage));
  expect('B: viewer does not persist the token or the scan', !lsB.includes(token) && !/airreach_scan_v1:/.test(lsB) && !/airreach_diagnose_handoff/.test(lsB), lsB.slice(0, 120));
  const shareHiddenB = await pageB.$eval('#ar-cta-share', (el) => el.hidden).catch(() => true);
  expect('B: share entry hidden for viewer', shareHiddenB === true);
  expect('B: no page errors', errorsB.length === 0, errorsB.join(' | ').slice(0, 300));
  await pageB.screenshot({ path: path.join(OUT, 'b-desktop-shared.png'), fullPage: true });
  const mobile = await ctxB.newPage(); await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(shareHref, { waitUntil: 'domcontentloaded' });
  await mobile.waitForSelector('#ar-dash.is-on', { timeout: 30000 });
  await mobile.waitForSelector('#ar-shared-note:not([hidden])', { timeout: 10000 });
  // 非表示のツールチップ（.ar-tip-bubble, visibility:hidden）は #46 以前からレイアウト幅に含まれるため除外し、見える要素だけで判定する
  const overflow = await mobile.evaluate(() => {
    const W = document.documentElement.clientWidth; let max = 0;
    document.querySelectorAll('body *').forEach((el) => {
      if (el.closest('.ar-tip-bubble')) return;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return;
      const r = el.getBoundingClientRect(); if (r.width > 0) max = Math.max(max, r.right - W);
    });
    return Math.round(max);
  });
  expect('B: mobile 390px has no horizontal overflow of visible content', overflow <= 1, `overflow=${overflow}px`);
  await mobile.screenshot({ path: path.join(OUT, 'b-mobile-shared.png'), fullPage: true });

  // ---- 無効・失効トークン --------------------------------------------------------------------
  const pageErr = await ctxB.newPage();
  await pageErr.goto(`${BASE}/airreach/result/?share=abc`, { waitUntil: 'domcontentloaded' });
  await sleep(800);
  expect('result page: malformed token → safe message', /無効か、期限切れ/.test(await pageErr.textContent('#ar-share-msg')));
  const wrong = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  await pageErr.goto(`${BASE}/airreach/result/?share=${wrong}`, { waitUntil: 'domcontentloaded' });
  await pageErr.waitForFunction(() => /無効か、期限切れ|読み込めません/.test((document.getElementById('ar-share-msg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  expect('result page: unknown token → 404 message', /無効か、期限切れ/.test(await pageErr.textContent('#ar-share-msg')));
  await pageErr.goto(`${BASE}/airreach/other/?share=${wrong}`, { waitUntil: 'domcontentloaded' });
  await pageErr.waitForFunction(() => /無効か、期限切れ/.test((document.getElementById('gate-err') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  expect('industry page: unknown token → gate with safe error', /無効か、期限切れ/.test(await pageErr.textContent('#gate-err')));
  await mock('/__mock/revoke', { id: st.scans[0] });
  await pageErr.goto(shareHref, { waitUntil: 'domcontentloaded' });
  await pageErr.waitForFunction(() => /無効か、期限切れ/.test((document.getElementById('ar-share-msg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
  expect('result page: revoked token → 404 message', /無効か、期限切れ/.test(await pageErr.textContent('#ar-share-msg')));

  // ---- API 障害時でも通常診断は表示される --------------------------------------------------------
  await mock('/__mock/mode', { mode: 'error500' });
  const ctxC = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  track(ctxC, 'C');
  const pageC = await ctxC.newPage();
  const t0 = Date.now();
  await runDiagnosis(pageC);
  expect('C: diagnosis result still shown when save API fails', /\?scan=/.test(pageC.url()) && /\d/.test((await pageC.textContent('#ar-gauge')) || ''), pageC.url());
  const postsC = allRequests.filter((r) => r.label === 'C' && r.method === 'POST' && r.url.includes('/api/airreach/scans/'));
  expect('C: save attempted and failed with 503 (not blocking)', postsC.length >= 1 && postsC.every((p) => p.status === 503), JSON.stringify(postsC.map((p) => p.status)));
  await openTools(pageC);
  await sleep(1500);
  const shareHiddenC = await pageC.$eval('#ar-cta-share', (el) => el.hidden).catch(() => true);
  const noteC = await pageC.textContent('#ar-share-note').catch(() => '');
  expect('C: share entry hidden and safe note shown', shareHiddenC === true && /一時的に接続できない|保存できなかった/.test(noteC || ''), noteC);
  expect('C: total time bounded (< 25s)', Date.now() - t0 < 25000, `${Date.now() - t0}ms`);
  await mock('/__mock/mode', { mode: 'ok' });

  // ---- ネットワーク: Cloudflare / allorigins への通信 0 件 -------------------------------------------
  const external = allRequests.filter((r) => /workers\.dev|allorigins/i.test(r.url));
  expect('network: zero requests to workers.dev / allorigins', external.length === 0, JSON.stringify(external.slice(0, 3)));
  const apiHosts = new Set(allRequests.filter((r) => r.url.includes('/api/airreach/')).map((r) => new URL(r.url).host));
  expect('network: all /api/airreach/ calls are same-origin', apiHosts.size === 1 && apiHosts.has(`127.0.0.1:${API_PORT}`), [...apiHosts].join(','));
  fs.writeFileSync(path.join(OUT, 'requests.json'), JSON.stringify(allRequests.map((r) => ({ ...r, url: r.url.replace(/share=[A-Za-z0-9_-]{43}/, 'share=[redacted]') })), null, 2));
} catch (err) {
  record('unexpected exception', false, String(err && err.stack || err).slice(0, 800));
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed  (screenshots: ${path.relative(process.cwd(), OUT)})`);
if (failed.length) console.log('FAILED:\n' + failed.map((f) => ' - ' + f.name).join('\n'));
await shutdown(failed.length ? 1 : 0);
