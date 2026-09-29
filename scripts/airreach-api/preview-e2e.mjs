/**
 * デプロイ済み環境（Vercel Preview / Production）でのブラウザ E2E。本物の Supabase に 1 件保存する（削除は別途）。
 *   node scripts/airreach-api/preview-e2e.mjs https://<deployment-host> [https://診断する公開サイト/]
 * 確認: 実診断 → /api/airreach/fetch/ 使用 → 保存 201 → 共有リンク発行 → 別セッションで復元 → 二重保存なし →
 *       無効トークン → desktop / mobile スクリーンショット → workers.dev / allorigins への通信 0 件。
 * 出力に shareToken は出さない（保存した scanId だけを出す）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = (process.argv[2] || '').replace(/\/+$/, '');
const SITE_URL = process.argv[3] || 'https://example.com/';
if (!/^https?:\/\//.test(BASE)) { console.error('usage: node preview-e2e.mjs https://host [site-url]'); process.exit(2); }
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'preview');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const record = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || !detail ? '' : '  — ' + detail}`); };
const expect = (name, cond, detail = '') => record(name, !!cond, detail);
const redact = (u) => String(u).replace(/share=[A-Za-z0-9_-]{43}/g, 'share=[redacted]');
const allRequests = [];
function track(ctx, label) {
  ctx.on('request', (req) => allRequests.push({ label, url: req.url(), method: req.method() }));
  ctx.on('response', (res) => { const r = allRequests.find((x) => x.url === res.url() && x.status === undefined); if (r) r.status = res.status(); });
}
async function openTools(page) {
  await page.click('#ar-cta-main'); await page.waitForSelector('#actions:not(.is-hidden)', { timeout: 10000 });
  await page.click('#ar-cta-details'); await page.waitForSelector('#expert-view:not(.is-hidden)', { timeout: 10000 });
  await page.click('#ar-more-tools > summary');
}
const summary = { base: BASE, siteUrl: SITE_URL, startedAt: new Date().toISOString(), scanId: null };
const browser = await chromium.launch();
try {
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  track(ctxA, 'A');
  const errorsA = [];
  const pageA = await ctxA.newPage();
  pageA.on('pageerror', (e) => errorsA.push(String(e)));
  await pageA.goto(`${BASE}/airreach/`, { waitUntil: 'domcontentloaded' });
  await pageA.waitForSelector('#gate-url', { timeout: 20000 });
  await pageA.fill('#gate-url', SITE_URL);
  await pageA.selectOption('#gate-outcome-select', 'inquiry');
  await pageA.check('#gate-proxy');
  await pageA.click('#gate-next-1');
  await pageA.waitForURL(/\/airreach\/[a-z]+\/\?scan=/, { timeout: 60000 });
  await pageA.waitForSelector('#ar-dash.is-on', { timeout: 60000 });
  await pageA.waitForFunction(() => /\d/.test((document.getElementById('ar-gauge') || {}).textContent || ''), null, { timeout: 30000 }).catch(() => {});
  const scanUrl = pageA.url();
  summary.scanId = (scanUrl.match(/[?&]scan=([a-z0-9]+)/) || [])[1] || null;
  expect('A: real diagnosis reached result page', /\?scan=/.test(scanUrl), redact(scanUrl));
  const fetchCalls = allRequests.filter((r) => r.label === 'A' && r.url.includes('/api/airreach/fetch/'));
  expect('A: target fetched via /api/airreach/fetch/ (same origin)', fetchCalls.length >= 1 && fetchCalls.every((r) => new URL(r.url).origin === BASE), JSON.stringify(fetchCalls.map((r) => r.status)));
  const posts = allRequests.filter((r) => r.label === 'A' && r.method === 'POST' && r.url.includes('/api/airreach/scans/'));
  expect('A: POST /api/airreach/scans/ → 201 once', posts.length === 1 && posts[0].status === 201, JSON.stringify(posts.map((p) => p.status)));
  const gauge = (await pageA.textContent('#ar-gauge').catch(() => '')) || '';
  expect('A: gauge shows a score', /\d/.test(gauge), gauge.trim());
  await openTools(pageA);
  await pageA.waitForSelector('#ar-cta-share:not([hidden])', { timeout: 15000 });
  const shareHref = await pageA.getAttribute('#ar-cta-share', 'href');
  expect('A: share link issued (?share=<43-char token>)', /\/airreach\/result\/\?share=[A-Za-z0-9_-]{43}$/.test(shareHref || ''), redact(shareHref));
  const token = (shareHref || '').split('share=')[1] || '';
  await pageA.click('#ar-cta-share');
  await pageA.waitForFunction(() => /コピーしました|共有リンク/.test((document.getElementById('ar-share-note') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  const noteA = (await pageA.textContent('#ar-share-note').catch(() => '')) || '';
  expect('A: copy feedback shown (or link displayed as fallback)', /コピーしました|共有リンク/.test(noteA), redact(noteA));
  await pageA.screenshot({ path: path.join(OUT, 'a-desktop-result.png'), fullPage: true });
  await pageA.goto(scanUrl, { waitUntil: 'domcontentloaded' });
  await pageA.waitForSelector('#ar-dash.is-on', { timeout: 60000 });
  await sleep(2000);
  const posts2 = allRequests.filter((r) => r.label === 'A' && r.method === 'POST' && r.url.includes('/api/airreach/scans/'));
  expect('A: reopening own result does not POST again', posts2.length === 1, String(posts2.length));
  expect('A: no page errors', errorsA.length === 0, errorsA.join(' | ').slice(0, 300));

  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  track(ctxB, 'B');
  const errorsB = [];
  const pageB = await ctxB.newPage();
  pageB.on('pageerror', (e) => errorsB.push(String(e)));
  await pageB.goto(shareHref, { waitUntil: 'domcontentloaded' });
  await pageB.waitForURL(/\/airreach\/[a-z]+\/\?share=/, { timeout: 30000 });
  await pageB.waitForSelector('#ar-dash.is-on', { timeout: 60000 });
  await pageB.waitForSelector('#ar-shared-note:not([hidden])', { timeout: 15000 });
  const noteB = (await pageB.textContent('#ar-shared-note')) || '';
  expect('B: shared view restored in a fresh session', /共有された診断結果/.test(noteB), noteB);
  const gaugeB = (await pageB.textContent('#ar-gauge').catch(() => '')) || '';
  expect('B: same score as A', gaugeB.trim() === gauge.trim(), `${gaugeB.trim()} vs ${gauge.trim()}`);
  const checks = await pageB.$$eval('#ar-detail-checks li', (els) => els.length).catch(() => 0);
  expect('B: detail checks rendered from stored result', checks >= 10, String(checks));
  expect('B: no re-fetch of the target site', allRequests.filter((r) => r.label === 'B' && r.url.includes('/api/airreach/fetch/')).length === 0);
  const gets = allRequests.filter((r) => r.label === 'B' && r.url.includes('/api/airreach/shared-scans/'));
  expect('B: shared-scans GET 200', gets.length >= 1 && gets.every((r) => r.status === 200), JSON.stringify(gets.map((r) => r.status)));
  const lsB = await pageB.evaluate(() => JSON.stringify(localStorage));
  expect('B: viewer persists neither token nor scan', !lsB.includes(token) && !/airreach_scan_v1:/.test(lsB) && !/airreach_diagnose_handoff/.test(lsB));
  expect('B: share entry hidden for viewer', (await pageB.$eval('#ar-cta-share', (el) => el.hidden).catch(() => true)) === true);
  expect('B: no page errors', errorsB.length === 0, errorsB.join(' | ').slice(0, 300));
  await pageB.screenshot({ path: path.join(OUT, 'b-desktop-shared.png'), fullPage: true });
  const mobile = await ctxB.newPage(); await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(shareHref, { waitUntil: 'domcontentloaded' });
  await mobile.waitForSelector('#ar-dash.is-on', { timeout: 60000 });
  await mobile.waitForSelector('#ar-shared-note:not([hidden])', { timeout: 15000 });
  const overflow = await mobile.evaluate(() => { const W = document.documentElement.clientWidth; let max = 0; document.querySelectorAll('body *').forEach((el) => { if (el.closest('.ar-tip-bubble')) return; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return; const r = el.getBoundingClientRect(); if (r.width > 0) max = Math.max(max, r.right - W); }); return Math.round(max); });
  expect('B: mobile 390px visible content fits', overflow <= 1, `overflow=${overflow}px`);
  await mobile.screenshot({ path: path.join(OUT, 'b-mobile-shared.png'), fullPage: true });

  const pageErr = await ctxB.newPage();
  const wrong = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  await pageErr.goto(`${BASE}/airreach/result/?share=${wrong}`, { waitUntil: 'domcontentloaded' });
  await pageErr.waitForFunction(() => /無効か、期限切れ|読み込めません/.test((document.getElementById('ar-share-msg') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
  expect('invalid token → safe message on result page', /無効か、期限切れ/.test(await pageErr.textContent('#ar-share-msg')));

  const targetHost = new URL(SITE_URL).host;
  const direct = allRequests.filter((r) => { try { return new URL(r.url).host === targetHost; } catch { return false; } });
  expect('network: browser never fetches the target site directly (all via /api/airreach/fetch/)', direct.length === 0, JSON.stringify(direct.slice(0, 3).map((r) => r.url)));
  const external = allRequests.filter((r) => /workers\.dev|allorigins/i.test(r.url));
  expect('network: zero requests to workers.dev / allorigins', external.length === 0, JSON.stringify(external.slice(0, 3).map((r) => r.url)));
  const apiHosts = new Set(allRequests.filter((r) => r.url.includes('/api/airreach/')).map((r) => new URL(r.url).origin));
  expect('network: all /api/airreach/ calls are same-origin', apiHosts.size === 1 && apiHosts.has(BASE), [...apiHosts].join(','));
  fs.writeFileSync(path.join(OUT, 'requests.json'), JSON.stringify(allRequests.map((r) => ({ ...r, url: redact(r.url) })), null, 2));
} catch (err) {
  record('unexpected exception', false, redact(String(err && err.stack || err)).slice(0, 600));
}
await browser.close();
summary.results = results;
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed  scanId=${summary.scanId}`);
if (failed.length) console.log('FAILED:\n' + failed.map((f) => ' - ' + f.name).join('\n'));
process.exit(failed.length ? 1 : 0);
