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
// 入力画面 1 → 診断中 → 3 調べる言葉（自動候補の先頭を選ぶ。候補が無ければ入力）
async function startDiagnosis(page, url = SITE_URL) {
  await page.goto(`${BASE}/airreach/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#gate-url', { timeout: 15000 });
  await page.fill('#gate-url', url);
  await page.selectOption('#gate-outcome-select', 'inquiry');
  await page.check('#gate-proxy');
  await page.click('#gate-next-1');
}
async function waitKeywordStep(page) {
  await page.waitForSelector('.ar-gate-step[data-step="3"].is-on #gate-kw-input', { timeout: 30000 });
}
// 結果画面 → 詳細データを開く
async function openDetails(page) {
  await page.click('#ar-cta-main');
  await page.waitForSelector('#actions:not(.is-hidden)', { timeout: 10000 });
  await page.click('#ar-cta-details');
  await page.waitForSelector('#expert-view:not(.is-hidden)', { timeout: 10000 });
}
// キーワード比較の行
const kwcRows = (page) => page.$$eval('#ar-kwc-body tr', (trs) => trs.map((tr) => {
  const t = (l) => (tr.querySelector(`td[data-label="${l}"]`) || {}).textContent || '';
  return { text: t('キーワード'), type: t('種別'), data: t('検索データ'), kind: t('データ種別'), main: t('メイン'), primary: tr.classList.contains('is-primary') };
}));
async function runDiagnosis(page, shot) {
  await startDiagnosis(page);
  await waitKeywordStep(page);
  if (shot) await page.screenshot({ path: path.join(OUT, shot), fullPage: true });
  if (await page.$('#gate-kw-cands .ar-kw-cand')) await page.click('#gate-kw-cands .ar-kw-cand');
  else { await page.fill('#gate-kw-input', 'テスト 言葉'); await page.click('#gate-kw-add'); }
  await page.click('#gate-kw-next');
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
  await runDiagnosis(pageA, 'a-desktop-keywords.png');
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

  // ---- K: 入力画面 3「調べる言葉」 ---------------------------------------------------------------
  const ctxK = await browser.newContext({ viewport: { width: 390, height: 844 } });
  track(ctxK, 'K');
  const errorsK = [];
  const pageK = await ctxK.newPage();
  pageK.on('pageerror', (e) => errorsK.push(String(e)));
  await startDiagnosis(pageK);
  await waitKeywordStep(pageK);
  const kText = (sel) => pageK.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
  const chips = () => pageK.$$eval('#gate-kw-chips .ar-kw-chip', (els) => els.map((e) => ({
    text: e.querySelector('.ar-kw-text').textContent, src: e.querySelector('.ar-kw-src').textContent, main: e.querySelector('.ar-kw-main').textContent,
  })));
  const gateErrText = () => pageK.textContent('#gate-err');
  expect('K: keyword step shown after site fetch', /調べる言葉/.test(await pageK.textContent('#gate-kw-title')) && /AI検索やGoogle検索/.test(await pageK.textContent('.ar-gate-step[data-step="3"] .ar-gate-lead')));
  expect('K: no keyword adopted automatically (0 chips, next disabled)', (await chips()).length === 0 && await pageK.$eval('#gate-kw-next', (b) => b.disabled));
  await pageK.screenshot({ path: path.join(OUT, 'k-mobile-keywords-empty.png'), fullPage: true });
  const candTexts = await kText('#gate-kw-cands .ar-kw-cand');
  expect('K: every auto candidate is labelled 自動候補 (≤3)', candTexts.length <= 3 && candTexts.every((t) => /自動候補$/.test(t)), JSON.stringify(candTexts));
  const stepText = await pageK.textContent('.ar-gate-step[data-step="3"]');
  expect('K: no wording that implies Google measurements for candidates', !/検索数\s*[:：]?\s*\d|回\s*\/\s*月|Google実測|実測/.test(stepText), stepText.slice(0, 200));
  // 自由入力だけ（候補は使わない）。前後空白除去・全角空白の正規化
  await pageK.fill('#gate-kw-input', '  町田　焼肉  デート ');
  await pageK.press('#gate-kw-input', 'Enter');
  let c = await chips();
  expect('K: free input added, trimmed, becomes main (●)', c.length === 1 && c[0].text === '町田 焼肉 デート' && c[0].main === '●' && c[0].src === '入力', JSON.stringify(c));
  expect('K: input cleared after add', (await pageK.inputValue('#gate-kw-input')) === '');
  await pageK.fill('#gate-kw-input', '   ');
  await pageK.click('#gate-kw-add');
  expect('K: blank input rejected', /入力してください/.test(await gateErrText()) && (await chips()).length === 1);
  await pageK.fill('#gate-kw-input', '町田 焼肉 デート');
  await pageK.click('#gate-kw-add');
  expect('K: duplicate rejected', /すでに追加/.test(await gateErrText()) && (await chips()).length === 1);
  await pageK.evaluate(() => { const i = document.getElementById('gate-kw-input'); i.removeAttribute('maxlength'); i.value = 'あ'.repeat(101); });
  await pageK.click('#gate-kw-add');
  expect('K: 101 chars rejected', /100文字以内/.test(await gateErrText()) && (await chips()).length === 1);
  await pageK.evaluate(() => { document.getElementById('gate-kw-input').setAttribute('maxlength', '100'); });
  expect('K: input has maxlength=100', (await pageK.getAttribute('#gate-kw-input', 'maxlength')) === '100');
  // 自動候補を1つ採用 → 追加済み表示
  if (candTexts.length) {
    await pageK.click('#gate-kw-cands .ar-kw-cand');
    c = await chips();
    expect('K: candidate adopted as 自動候補 chip, main unchanged', c.length === 2 && c[1].src === '自動候補' && c[0].main === '●' && c[1].main === '○', JSON.stringify(c));
    expect('K: adopted candidate disabled', await pageK.$eval('#gate-kw-cands .ar-kw-cand', (b) => b.disabled));
  }
  // 5件まで
  for (let i = 1; (await chips()).length < 5; i++) { await pageK.fill('#gate-kw-input', `ことば ${'x'.repeat(40)} ${i}`); await pageK.click('#gate-kw-add'); }
  expect('K: 5 chips, add disabled at max', (await chips()).length === 5 && await pageK.$eval('#gate-kw-add', (b) => b.disabled) && /5 \/ 5/.test(await pageK.textContent('#gate-kw-count')));
  const overflowK = await pageK.evaluate(() => {
    const W = document.documentElement.clientWidth; let max = 0;
    document.querySelectorAll('#ar-gate *').forEach((el) => {
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return;
      const r = el.getBoundingClientRect(); if (r.width > 0) max = Math.max(max, r.right - W);
    });
    return Math.round(max) + Math.max(0, document.documentElement.scrollWidth - W);
  });
  expect('K: mobile 390px keyword step has no horizontal overflow', overflowK <= 1, `overflow=${overflowK}px`);
  await pageK.screenshot({ path: path.join(OUT, 'k-mobile-keywords.png'), fullPage: true });
  // メイン変更・削除
  await pageK.click('#gate-kw-chips .ar-kw-chip:nth-child(3) .ar-kw-main');
  c = await chips();
  expect('K: primary switched (exactly one ●)', c[2].main === '●' && c.filter((x) => x.main === '●').length === 1, JSON.stringify(c.map((x) => x.main)));
  const newMain = c[2].text;
  await pageK.click('#gate-kw-chips .ar-kw-chip:nth-child(3) .ar-kw-del');
  c = await chips();
  expect('K: deleting the main promotes another (one ●)', c.length === 4 && !c.some((x) => x.text === newMain) && c.filter((x) => x.main === '●').length === 1, JSON.stringify(c.map((x) => x.main)));
  await pageK.click('#gate-kw-chips .ar-kw-chip:nth-child(1) .ar-kw-main');
  const mainText = (await chips())[0].text;
  const allTexts = (await chips()).map((x) => x.text);
  await pageK.click('#gate-kw-next');
  await pageK.waitForURL(/\/airreach\/[a-z]+\/\?scan=/, { timeout: 30000 });
  await pageK.waitForSelector('#ar-dash.is-on', { timeout: 30000 });
  expect('K: result header uses the main keyword', (await pageK.textContent('#ar-industry-line')).includes(`「${mainText}」`), await pageK.textContent('#ar-industry-line'));
  expect('K: summary shows main + source + count', (await pageK.textContent('#sum-keyword')).startsWith(mainText) && /ほか3語/.test(await pageK.textContent('#sum-keyword')), await pageK.textContent('#sum-keyword'));
  const scanK = await pageK.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('airreach_scan_v1:')); return JSON.parse(localStorage.getItem(k)); });
  expect('K: saved scan keeps all 4 keywords with main', scanK.keyword === mainText && JSON.stringify(scanK.keywords.map((k) => k.text)) === JSON.stringify(allTexts) && scanK.keywords.filter((k) => k.primary).length === 1, JSON.stringify(scanK.keywords));
  // 結果: 見出しはメインの言葉。回数は出さない（参考予測の数字も出さない）
  const sumRows = await pageK.textContent('#ar-sum-rows');
  expect('K: headline has no invented monthly count', !/約\s*[\d,]+\s*回|[\d,]+\s*回\s*\/\s*月/.test(sumRows), sumRows.slice(0, 200));
  await openDetails(pageK);
  const rowsK = await kwcRows(pageK);
  expect('K: キーワード比較 lists the 4 chosen keywords in order', JSON.stringify(rowsK.map((r) => r.text)) === JSON.stringify(allTexts), JSON.stringify(rowsK.map((r) => r.text)));
  expect('K: exactly one メイン row, it is the main keyword', rowsK.filter((r) => r.primary).length === 1 && rowsK.find((r) => r.primary).text === mainText && /メイン/.test(rowsK.find((r) => r.primary).main));
  expect('K: 種別 shows ユーザー入力 / 自動候補', rowsK.every((r) => ['ユーザー入力', '自動候補'].includes(r.type)), JSON.stringify(rowsK.map((r) => r.type)));
  expect('K: without GSC (OAuth not connected) every 検索データ is 未計測 with no number', rowsK.every((r) => r.data === '未計測' && r.kind === '—'), JSON.stringify(rowsK.map((r) => [r.data, r.kind])));
  expect('K: column is 検索データ (never 月間需要 / 月間検索数 / 検索ボリューム)', /検索データ/.test(await pageK.textContent('#ar-kwc-table thead')) && !/月間需要|月間検索数|検索ボリューム/.test(await pageK.textContent('#ar-kwc-wrap')));
  // 旧 estimateSearchVolume（言葉の文字列から計算した回数）が、計算式モーダル・画面のどこにも出ない
  const methodK = await pageK.evaluate(() => (document.getElementById('ar-expert-method') || {}).textContent || '');
  expect('K: formula modal has 検索データ section without hash / V / 回/月', /2\. 検索データ/.test(methodK) && !/hash|V\s*=|V×|回\s*\/\s*月|推定需要|月間検索需要|related|commercial/.test(methodK), methodK.slice(0, 300));
  const bodyK = await pageK.evaluate(() => document.body.innerText + ' ' + document.body.textContent);
  expect('K: no hash-derived wording anywhere on the result page', !/hash\(|推定需要|月間検索需要|月間需要|V = \d/.test(bodyK));
  expect('K: comparison never says 参考予測', !/参考予測/.test(await pageK.textContent('#ar-kwc-wrap')));
  const overflowR = await pageK.evaluate(() => {
    const W = document.documentElement.clientWidth; let max = 0;
    // 非表示のツールチップ（.ar-tip-bubble）は B と同じく除外し、見える要素だけで判定する
    document.querySelectorAll('#ar-kwc-wrap *').forEach((el) => {
      if (el.closest('.ar-tip-bubble')) return;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return;
      const r = el.getBoundingClientRect(); if (r.width > 0) max = Math.max(max, r.right - W);
    });
    return Math.round(max);
  });
  expect('K: mobile 390px comparison has no horizontal overflow', overflowR <= 1, `overflow=${overflowR}px`);
  await (await pageK.$('#ar-kwc-wrap')).screenshot({ path: path.join(OUT, 'k-mobile-compare.png') });
  expect('K: no page errors', errorsK.length === 0, errorsK.join(' | ').slice(0, 300));
  // 取得失敗 → 推定のまま進む → 候補なし・自由入力だけで診断できる
  // 別コンテキスト（保存済みの入力が残っていると入力画面が出ずに前回の結果へ進むため）
  const ctxKF = await browser.newContext({ viewport: { width: 390, height: 844 } });
  track(ctxKF, 'KF');
  const pageKF = await ctxKF.newPage();
  await startDiagnosis(pageKF, 'http://rebind.test:9/');
  await pageKF.waitForSelector('#gate-fail-actions:not([hidden])', { timeout: 30000 });
  await pageKF.click('#gate-continue');
  await waitKeywordStep(pageKF);
  expect('K: fetch failed → no auto candidates, note shown', (await pageKF.$$('#gate-kw-cands .ar-kw-cand')).length === 0 && !(await pageKF.$eval('#gate-kw-noauto', (e) => e.hidden)));
  const stepKF = await pageKF.textContent('.ar-gate-step[data-step="3"]');
  expect('K: fetch failed → no fixed fallback word (近く 焼肉 etc.)', !/近く 焼肉|近く おすすめ|近く クリニック|業務 効率化/.test(stepKF + (await pageKF.inputValue('#gate-kw-input'))));
  await pageKF.fill('#gate-kw-input', '自由入力 だけ');
  await pageKF.click('#gate-kw-add');
  await pageKF.screenshot({ path: path.join(OUT, 'k-mobile-keywords-fetchfail.png'), fullPage: true });
  await pageKF.click('#gate-kw-next');
  await pageKF.waitForSelector('#ar-dash.is-on', { timeout: 30000 });
  expect('K: free input only → result shown with that keyword', (await pageKF.textContent('#ar-industry-line')).includes('「自由入力 だけ」'), await pageKF.textContent('#ar-industry-line'));
  await ctxK.close(); await ctxKF.close();

  // ---- G: Google 実測（Search Console の取り込み）は、診断したサイトと同じサイトのデータだけ使う ----
  // 取り込みは baseline.gscSites（GSC プロパティごと）に入る。サイトの記録が無い以前の取り込みは使わない
  const SITE_PROP = SITE_URL;            // URL プレフィックス プロパティ（http://rebind.test:54322/）
  const gscRows = [{ query: '町田 焼肉 予約', impressions: 1240, clicks: 38, position: 8.44 }];
  const siteEntry = (property, host) => ({ property, scope: 'url_prefix', host, periodDays: 28, keywords: gscRows, updatedAt: '2026-09-30T00:00:00.000Z' });
  const baselineSame = { evidenceClass: 'Official', source: 'GSC CSV', periodDays: 28, keywords: gscRows, gscSites: [siteEntry(SITE_PROP, new URL(SITE_URL).host)] };
  const baselineOther = { evidenceClass: 'Official', source: 'GSC CSV', periodDays: 28, keywords: gscRows, gscSites: [siteEntry('https://other.example/', 'other.example')] };
  const baselineLegacy = { evidenceClass: 'Official', source: 'GSC CSV', periodDays: 28, keywords: gscRows }; // サイト情報なし（以前の形式）
  const baselineLegacyHost = { ...baselineLegacy, host: new URL(SITE_URL).host };                            // 検証していない host 欄だけ
  async function runWithBaseline(label, baselineObj) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    track(ctx, label);
    if (baselineObj) await ctx.addInitScript((b) => { try { localStorage.setItem('airreach_official_baseline_v1', JSON.stringify(b)); } catch (e) {} }, baselineObj);
    const pg = await ctx.newPage();
    const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
    await startDiagnosis(pg);
    await waitKeywordStep(pg);
    for (const t of ['町田 焼肉 予約', '町田 個室 焼肉']) { await pg.fill('#gate-kw-input', t); await pg.click('#gate-kw-add'); }
    await pg.click('#gate-kw-next');
    await pg.waitForSelector('#ar-dash.is-on', { timeout: 30000 });
    return { ctx, pg, errs };
  }
  // pos: 期待する平均順位（表示回数で重み付けした平均を小数1桁で）
  async function expectGoogleMeasured(label, g, pos = '8.4') {
    const sumG = await g.pg.textContent('#ar-sum-rows');
    expect(`${label}: headline uses Google実測 for the main keyword (表示回数, not 検索数)`, /「町田 焼肉 予約」での表示回数/.test(sumG) && /1,240/.test(sumG) && /Google実測/.test(sumG) && /クリック 38/.test(sumG) && sumG.includes(`平均順位 ${pos}`) && /検索回数そのものではありません/.test(sumG), sumG.slice(0, 300));
    await openDetails(g.pg);
    const rowsG = await kwcRows(g.pg);
    expect(`${label}: row shows 表示回数 / クリック / 平均順位（直近28日） as Google実測`, /表示回数 1,240/.test(rowsG[0].data) && /クリック 38/.test(rowsG[0].data) && rowsG[0].data.includes(`平均順位 ${pos}`) && /直近28日/.test(rowsG[0].data) && rowsG[0].kind === 'Google実測' && rowsG[0].primary, JSON.stringify(rowsG[0]));
    expect(`${label}: impressions are not called 月間検索数 / 検索ボリューム`, !/月間検索数|検索ボリューム|月間需要/.test(await g.pg.textContent('#ar-kwc-wrap')));
    expect(`${label}: unmatched row stays 未計測`, rowsG[1].data === '未計測' && rowsG[1].kind === '—', JSON.stringify(rowsG[1]));
    expect(`${label}: count shows Google実測 1語`, /Google実測 1語/.test(await g.pg.textContent('#ar-kwc-count')));
    expect(`${label}: no page errors`, g.errs.length === 0, g.errs.join(' | ').slice(0, 300));
  }
  let g = await runWithBaseline('G', baselineSame);
  await expectGoogleMeasured('G same site', g);
  await (await g.pg.$('#ar-kwc-wrap')).screenshot({ path: path.join(OUT, 'g-desktop-compare.png') });
  await (await g.pg.$('#ar-sum-rows')).screenshot({ path: path.join(OUT, 'g-desktop-headline.png') });
  await g.ctx.close();
  for (const [name, b] of [['other site', baselineOther], ['no site info (legacy)', baselineLegacy], ['legacy unverified host field', baselineLegacyHost], ['OAuth not connected (no baseline)', null]]) {
    g = await runWithBaseline('G2', b);
    const sum2 = await g.pg.textContent('#ar-sum-rows');
    await openDetails(g.pg);
    const rowsG = await kwcRows(g.pg);
    expect(`G: ${name} → not used as Google実測, keywords still work`, !/Google実測/.test(sum2) && !/1,240/.test(sum2) && rowsG.length === 2 && rowsG.every((r) => r.data === '未計測'), JSON.stringify(rowsG.map((r) => r.data)));
    expect(`G: ${name} → no page errors`, g.errs.length === 0, g.errs.join(' | ').slice(0, 300));
    await g.ctx.close();
  }

  // G3: 実際の取り込み経路で site 情報が保存され、同じサイトの診断にだけ使われる
  // (a) /api/google/gsc 同期の経路（Studio → AirReachOrchestrator.importGscRows(rows, { property })）
  const ctxS = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  track(ctxS, 'S');
  const pageS = await ctxS.newPage();
  const errorsS = []; pageS.on('pageerror', (e) => errorsS.push(String(e)));
  await pageS.goto(`${BASE}/airreach/studio/`, { waitUntil: 'load' });
  await pageS.waitForFunction(() => window.AirReachOrchestrator && window.AirReachStudio && window.AirReachKeywordList, null, { timeout: 15000 });
  const apiRows = [ // /api/google/gsc の応答と同じ形（keyword / url / impressions / clicks / position）
    { date: '2026-09-01', keyword: '町田 焼肉 予約', url: `${SITE_URL}menu`, impressions: 1000, clicks: 30, position: 8, source: 'gsc' },
    { date: '2026-09-02', keyword: '町田 焼肉 予約', url: SITE_URL, impressions: 240, clicks: 8, position: 10.5, source: 'gsc' },
    { date: '2026-09-02', keyword: '町田 焼肉 予約', url: 'https://other.example/', impressions: 999, clicks: 99, position: 1, source: 'gsc' },
  ];
  const baseS = await pageS.evaluate(({ rows, prop }) => {
    window.AirReachOrchestrator.importGscRows(rows, { property: prop });
    const m = window.AirReachStudio.getState().measurements.slice(-3).map((x) => x.gscProperty);
    return { props: m, baseline: JSON.parse(localStorage.getItem('airreach_official_baseline_v1') || 'null') };
  }, { rows: apiRows, prop: SITE_PROP });
  expect('G3 sync: each imported row records the GSC siteUrl', baseS.props.every((p) => p === SITE_PROP), JSON.stringify(baseS.props));
  const siteS = (baseS.baseline && baseS.baseline.gscSites || []).find((x) => x.property === SITE_PROP);
  expect('G3 sync: baseline.gscSites has the property, normalized host and only same-site rows', !!siteS && siteS.scope === 'url_prefix' && siteS.host === new URL(SITE_URL).host &&
    siteS.keywords.length === 1 && siteS.keywords[0].impressions === 1240 && siteS.keywords[0].clicks === 38, JSON.stringify(siteS));
  const unsited = await pageS.evaluate(() => {
    window.AirReachOrchestrator.importGscRows([{ keyword: 'サイト不明の言葉', impressions: 10, clicks: 1, position: 2 }], { property: '' });
    const b = JSON.parse(localStorage.getItem('airreach_official_baseline_v1') || 'null');
    return (b.gscSites || []).some((x) => x.keywords.some((k) => k.query === 'サイト不明の言葉'));
  });
  expect('G3 sync: rows imported without a site are not added to gscSites', unsited === false);
  // Studio「② 探している人」: 値なしは未計測。Keyword Planner の月間検索数だけを合計（GSC 表示回数・Planner 以外の volume は含めない）
  const cardNone = await pageS.evaluate(() => { const el = document.getElementById('orch-n-demand'); return el.textContent + ' | ' + el.parentElement.textContent; });
  expect('Studio card: no data → 未計測 (no 推定 label)', /^未計測/.test(cardNone) && !/推定/.test(cardNone), cardNone);
  const cardOf = (keywords) => pageS.evaluate((kw) => {
    window.AirReachOrchestrator.renderResult({ status: 'completed', keywords: kw, headline4: { keywords: kw.length, demand: 99999, score: 50 }, artifacts: {}, pages: [] });
    const el = document.getElementById('orch-n-demand'); return el.textContent + ' | ' + el.parentElement.querySelector('.unit').textContent;
  }, keywords).catch((e) => 'ERR ' + e.message);
  const cardPlanner = await cardOf([
    { keyword: 'a', volume: 1900, volume_source: 'Official' },
    { keyword: 'b', volume: 5000, volume_source: 'Unavailable' },
    { keyword: 'c', volume: null, volume_source: 'Unavailable', gsc_impressions: 999 },
  ]);
  expect('Studio card: Keyword Planner only → 月間検索数 1,900 / Keyword Planner (1/3語)', /^1,900 \|/.test(cardPlanner) && /月間検索数/.test(cardPlanner) && /Keyword Planner/.test(cardPlanner) && /1 \/ 3/.test(cardPlanner) && !/99,999|5,000|999|推定/.test(cardPlanner), cardPlanner);
  const cardGscOnly = await cardOf([{ keyword: 'c', volume: null, volume_source: 'Unavailable', gsc_impressions: 999 }]);
  expect('Studio card: GSC impressions only → still 未計測', /^未計測/.test(cardGscOnly) && !/999|推定/.test(cardGscOnly), cardGscOnly);
  expect('G3 sync: no page errors on Studio', errorsS.length === 0, errorsS.join(' | ').slice(0, 300));
  // 同じブラウザで無料診断 → Studio で取り込んだ実測がそのまま使われる（別サイトの行は混ざらない）
  const pageS2 = await ctxS.newPage();
  await startDiagnosis(pageS2);
  await waitKeywordStep(pageS2);
  for (const t of ['町田 焼肉 予約', '町田 個室 焼肉']) { await pageS2.fill('#gate-kw-input', t); await pageS2.click('#gate-kw-add'); }
  await pageS2.click('#gate-kw-next');
  await pageS2.waitForSelector('#ar-dash.is-on', { timeout: 30000 });
  // 同じサイトの2行（順位 8 × 1000回、10.5 × 240回）の重み付き平均 = 8.48 → 8.5。別サイトの行（順位 1）は混ざらない
  await expectGoogleMeasured('G3 sync → diagnosis', { pg: pageS2, errs: [] }, '8.5');
  await ctxS.close();

  // (b) 実数ベースライン画面の CSV 取り込み（GSCプロパティを指定したときだけ記録）
  const csv = 'クエリ,クリック数,表示回数,CTR,掲載順位\n町田 焼肉 予約,38,1240,3.06%,8.44\n';
  const importCsv = async (prop) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pg = await ctx.newPage();
    const errs = []; pg.on('pageerror', (e) => errs.push(String(e)));
    await pg.goto(`${BASE}/airreach/platform/`, { waitUntil: 'load' });
    await pg.waitForFunction(() => window.AirReachKeywordList, null, { timeout: 15000 });
    await pg.fill('#arp-gsc-site', prop);
    await pg.setInputFiles('#arp-gsc-file', { name: 'gsc.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await pg.waitForFunction(() => /取込完了|読めませんでした/.test((document.getElementById('arp-import-status') || {}).textContent || ''), null, { timeout: 8000 });
    const out = await pg.evaluate(() => ({ status: document.getElementById('arp-import-status').textContent, b: JSON.parse(localStorage.getItem('airreach_official_baseline_v1') || 'null') }));
    await ctx.close();
    return { ...out, errs };
  };
  let imp = await importCsv(SITE_PROP);
  const csvSite = (imp.b && imp.b.gscSites || [])[0];
  expect('G3 CSV: property given → gscSites entry saved with property / host', !!csvSite && csvSite.property === SITE_PROP && csvSite.host === new URL(SITE_URL).host && csvSite.keywords[0].impressions === 1240 && /の実測として記録/.test(imp.status), JSON.stringify(csvSite) + ' ' + imp.status);
  imp = await importCsv('');
  expect('G3 CSV: no property → baseline saved but no gscSites (not used as Google実測)', !!imp.b && (imp.b.gscSites || []).length === 0 && /GSCプロパティ未指定/.test(imp.status), imp.status);
  imp = await importCsv('sc-domain:');
  expect('G3 CSV: unreadable property → not recorded', (imp.b.gscSites || []).length === 0 && /読めなかった/.test(imp.status), imp.status);
  expect('G3 CSV: no page errors on platform', imp.errs.length === 0, imp.errs.join(' | ').slice(0, 300));

  // G4: 以前の保存（文字列から計算した「探している人 約◯回」）が営業の案件画面に出ない
  const ctxL = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageL = await ctxL.newPage();
  await pageL.goto(`${BASE}/airreach/result/`, { waitUntil: 'domcontentloaded' });
  await pageL.evaluate(() => localStorage.setItem('airreach_scan_v1:oldhash00001', JSON.stringify({
    id: 'oldhash00001', url: 'https://old.example/', industryId: 'restaurant', keyword: '町田 焼肉', displayName: '以前の保存',
    reportLite: { headline: [
      { id: 'demand', label: '「町田 焼肉」で探している人', value: '約 12,345', unit: '回 / 月', badge: 'Estimated' },
      { id: 'now', label: 'ホームページの情報整備', value: '52', unit: '/ 100', badge: 'Observed' },
    ] },
  })));
  await pageL.goto(`${BASE}/airreach/sales/deal/?scan=oldhash00001`, { waitUntil: 'load' });
  await pageL.waitForFunction(() => (document.getElementById('ard-kpis') || {}).textContent, null, { timeout: 8000 }).catch(() => {});
  const kpis = await pageL.textContent('#ard-kpis');
  expect('G4: old saved hash headline → 未計測 on the deal page (no 約◯回)', !/約\s*[\d,]+\s*回|12,345/.test(kpis) && /未計測/.test(kpis) && /52/.test(kpis), kpis);
  const proposal = await pageL.evaluate(() => window.AirReachSalesKit.buildProposalHtml(window.AirReachScanStore.loadScan('oldhash00001')));
  expect('G4: old saved hash headline → 未計測 in the proposal draft (Estimated badge gone)', !/約\s*[\d,]+\s*回|12,345/.test(proposal) && /未計測/.test(proposal) && !/Estimated/.test(proposal));
  // 正当な値（Google実測・お客様入力・サイトの実測）は消さない
  const kept = await pageL.evaluate(() => window.AirReachScanStore.sanitizeHeadlines([
    { id: 'demand', value: '1,240', badge: 'Official' }, { id: 'demand', value: '2,300', badge: 'User Input' },
    { id: 'demand', value: '3 / 5', badge: 'Observed' }, { id: 'now', value: '52', badge: 'Estimated' }, { id: 'demand', value: '約 9,999', badge: 'Estimated' },
  ]).map((h) => h.value + ':' + h.badge));
  expect('G4: sanitizer keeps Official / User Input / Observed and non-demand rows', JSON.stringify(kept) === JSON.stringify(['1,240:Official', '2,300:User Input', '3 / 5:Observed', '52:Estimated', '未計測:Unmeasured']), JSON.stringify(kept));
  await ctxL.close();

  // ---- D: 調べる言葉（keyword + keywords）の保存と復元 --------------------------------------------
  // A の保存データを元に、旧形式（keyword だけ）と新形式（keywords あり）の scan を端末に置いて開き直す
  const scanA = await pageA.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('airreach_scan_v1:'));
    return k ? JSON.parse(localStorage.getItem(k)) : null;
  });
  expect('D: A scan has keyword and keywords in sync', !!scanA && Array.isArray(scanA.keywords) &&
    (scanA.keyword ? scanA.keywords.filter((k) => k.primary).map((k) => k.text).join() === scanA.keyword : scanA.keywords.length === 0),
    JSON.stringify(scanA && { keyword: scanA.keyword, keywords: scanA.keywords }));
  expect('D: A scan keywords are auto-generated only', !!scanA && scanA.keywords.every((k) => k.source === 'auto'), JSON.stringify(scanA && scanA.keywords));
  const ctxD = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  track(ctxD, 'D');
  const errorsD = [];
  const pageD = await ctxD.newPage();
  pageD.on('pageerror', (e) => errorsD.push(String(e)));
  await pageD.goto(`${BASE}/airreach/result/`, { waitUntil: 'domcontentloaded' });
  const plant = (scan) => pageD.evaluate((s) => { localStorage.setItem('airreach_scan_v1:' + s.id, JSON.stringify(s)); }, scan);
  const base = { ...scanA, industryId: 'other' };
  delete base.shareToken; delete base.syncState; delete base.syncedAt;
  const readScan = (id) => pageD.evaluate((i) => JSON.parse(localStorage.getItem('airreach_scan_v1:' + i)), id);
  const openSnapshot = async (id) => {
    await pageD.goto(`${BASE}/airreach/other/?scan=${id}&snapshot=1#result`, { waitUntil: 'domcontentloaded' });
    await pageD.waitForSelector('#ar-dash.is-on', { timeout: 30000 });
  };
  // D1: 旧形式（keywords なし）→ legacy の1語として復元し、次の保存で keywords が付く
  const legacy = { ...base, id: 'kwlegacy0001', keyword: '町田 焼肉' };
  delete legacy.keywords;
  await plant(legacy);
  await openSnapshot(legacy.id);
  expect('D1: legacy scan → #ar-keyword is the old keyword', (await pageD.inputValue('#ar-keyword')) === '町田 焼肉');
  expect('D1: legacy scan → header shows the old keyword', /町田 焼肉/.test(await pageD.textContent('#ar-industry-line')));
  const legacySaved = await readScan(legacy.id);
  expect('D1: legacy scan re-saved with keywords [{legacy, primary}]', legacySaved.keyword === '町田 焼肉' &&
    JSON.stringify(legacySaved.keywords) === JSON.stringify([{ text: '町田 焼肉', source: 'legacy', primary: true }]), JSON.stringify(legacySaved.keywords));
  // D2: 新形式（3語、メインは2語目）→ メインが keyword になり、一覧・出どころは保たれる
  const kws = [
    { text: '町田 焼肉', source: 'auto', primary: false },
    { text: '町田 焼肉 個室', source: 'user', primary: true },
    { text: '町田 焼肉 ランチ', source: 'gsc', primary: false },
  ];
  const fresh = { ...base, id: 'kwnewfmt0001', keyword: '町田 焼肉 個室', keywords: kws };
  await plant(fresh);
  await openSnapshot(fresh.id);
  expect('D2: new scan → #ar-keyword is the primary', (await pageD.inputValue('#ar-keyword')) === '町田 焼肉 個室');
  const freshSaved = await readScan(fresh.id);
  expect('D2: new scan keywords preserved after re-save', freshSaved.keyword === '町田 焼肉 個室' && JSON.stringify(freshSaved.keywords) === JSON.stringify(kws), JSON.stringify(freshSaved.keywords));
  const survey = await pageD.evaluate(() => JSON.parse(localStorage.getItem('airreach_onboard_survey_v1') || 'null'));
  expect('D2: survey restored with the same keywords', survey && survey.keyword === '町田 焼肉 個室' && JSON.stringify(survey.keywords) === JSON.stringify(kws), JSON.stringify(survey && survey.keywords));
  // D4: 以前の版の保存（reportLite に「探している人 約12,345回」Estimated）を開いても、結果画面に約◯回が出ない
  const oldHash = { ...base, id: 'kwoldhash001', keyword: '町田 焼肉', reportLite: { modeLabel: '新しいお客さん向け', headline: [
    { id: 'demand', label: '「町田 焼肉」で探している人', value: '約 12,345', unit: '回 / 月', badge: 'Estimated' },
    { id: 'now', label: 'ホームページの情報整備', value: '52', unit: '/ 100', badge: 'Observed' },
  ] } };
  delete oldHash.keywords;
  await plant(oldHash);
  for (const [mode, url] of [['snapshot', `${BASE}/airreach/other/?scan=${oldHash.id}&snapshot=1#result`], ['live re-diagnosis', `${BASE}/airreach/other/?scan=${oldHash.id}#result`]]) {
    await pageD.goto(url, { waitUntil: 'domcontentloaded' });
    await pageD.waitForSelector('#ar-dash.is-on', { timeout: 30000 });
    await pageD.waitForFunction(() => (document.getElementById('ar-sum-rows') || {}).textContent, null, { timeout: 15000 });
    const sumOld = await pageD.textContent('#ar-sum-rows');
    const pageOld = await pageD.evaluate(() => document.body.textContent);
    expect(`D4: old saved scan (${mode}) → no hash 約◯回 on the results screen`, !/約\s*[\d,]+\s*回|12,345/.test(sumOld) && !/12,345/.test(pageOld), sumOld.slice(0, 200));
    expect(`D4: old saved scan (${mode}) → keyword still restored as legacy`, (await pageD.inputValue('#ar-keyword')) === '町田 焼肉');
  }
  // D3: 共有（サーバ保存 → 別セッションで復元）。新形式は一覧ごと、旧形式は legacy の1語
  const pushD = (scan) => pageD.evaluate((s) => window.AirReachScanSync.push(s), scan);
  const sharedNew = await pushD({ ...fresh, id: 'kwsharenew01' });
  const sharedOld = await pushD({ ...legacy, id: 'kwshareold01' });
  expect('D3: push with keywords → saved (201)', sharedNew && sharedNew.ok === true && !!sharedNew.shareToken, JSON.stringify(sharedNew).slice(0, 200));
  expect('D3: push legacy scan → saved (201)', sharedOld && sharedOld.ok === true && !!sharedOld.shareToken, JSON.stringify(sharedOld).slice(0, 200));
  st = await mock('/__mock/state');
  const ctxE = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  track(ctxE, 'E');
  const pageE = await ctxE.newPage();
  const errorsE = [];
  pageE.on('pageerror', (e) => errorsE.push(String(e)));
  const openShared = async (tok) => {
    await pageE.goto(`${BASE}/airreach/other/?share=${tok}`, { waitUntil: 'domcontentloaded' });
    await pageE.waitForSelector('#ar-shared-note:not([hidden])', { timeout: 20000 });
    return pageE.evaluate((t) => window.AirReachScanSync.fetchShared(t).then((r) => window.AirReachScanSync.toScan(r.data)), tok);
  };
  const restoredNew = await openShared(sharedNew.shareToken);
  expect('D3: shared new scan → keywords restored', restoredNew.keyword === '町田 焼肉 個室' && JSON.stringify(restoredNew.keywords) === JSON.stringify(kws), JSON.stringify(restoredNew.keywords));
  expect('D3: shared new scan → #ar-keyword is the primary', (await pageE.inputValue('#ar-keyword')) === '町田 焼肉 個室');
  const rowsE = await kwcRows(pageE);
  expect('D3: shared new scan → comparison has 3 rows, main = primary', rowsE.length === 3 && rowsE.filter((r) => r.primary).map((r) => r.text).join() === '町田 焼肉 個室' && rowsE[2].type === 'Google実測', JSON.stringify(rowsE.map((r) => [r.text, r.type])));
  const restoredOld = await openShared(sharedOld.shareToken);
  expect('D3: shared legacy scan → [{legacy, primary}]', restoredOld.keyword === '町田 焼肉' &&
    JSON.stringify(restoredOld.keywords) === JSON.stringify([{ text: '町田 焼肉', source: 'legacy', primary: true }]), JSON.stringify(restoredOld.keywords));
  expect('D3: shared legacy scan → #ar-keyword is the old keyword', (await pageE.inputValue('#ar-keyword')) === '町田 焼肉');
  expect('D3: shared legacy scan → no hash 約◯回 in the headline', !/約\s*[\d,]+\s*回|12,345/.test(await pageE.textContent('#ar-sum-rows')));
  const lsE = await pageE.evaluate(() => JSON.stringify(localStorage));
  expect('D3: shared viewer still persists no scan', !/airreach_scan_v1:/.test(lsE));
  expect('D: no page errors', errorsD.length === 0 && errorsE.length === 0, errorsD.concat(errorsE).join(' | ').slice(0, 300));
  await ctxD.close(); await ctxE.close();

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
  const targetHost = new URL(SITE_URL).host;
  const direct = allRequests.filter((r) => { try { return new URL(r.url).host === targetHost; } catch { return false; } });
  expect('network: browser never fetches the target site directly (all via /api/airreach/fetch/)', direct.length === 0, JSON.stringify(direct.slice(0, 3).map((r) => r.url)));
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
