/**
 * ダッシュボード（/airreach/app/）の Google 連携・Google データの削除の E2E（Playwright・偽の Supabase）。
 *   SITE_DIR=<ビルド済み _site> node scripts/airreach-api/google-console-e2e.mjs
 * 確認: 閲覧の同意にチェックしないと Google 接続を始めない → チェックすると、ログインのトークンと同意を付けて POST する →
 *       管理者は顧客名を確かめて Google データを一括で削除できる（このブラウザの分も消す・削除の記録が出る）→ 管理者でないと削除の欄が出ない。
 * 本物の Supabase・Google には接続しない（scripts/airreach-api/fake-supabase.js を差し込む）。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = process.env.SITE_DIR;
if (!SITE || !fs.existsSync(path.join(SITE, 'airreach/app/index.html'))) { console.error('SITE_DIR（ビルド済みの _site）を指定してください'); process.exit(2); }
const FAKE = fs.readFileSync(path.join(ROOT, 'scripts/airreach-api/fake-supabase.js'), 'utf8');

const results = [];
const expect = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(detail).slice(0, 400)}`); };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(SITE, p);
  if (p.endsWith('/')) f = path.join(f, 'index.html');
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}`;

const CID = '59824617-70f0-4a9d-a52e-d6353910f3e5';
const DB = {
  staff_members: [], client_members: [], action_items: [], reports: [], scans: [],
  clients: [{ id: CID, name: '目印商店', status: 'active', created_at: '2026-09-01T00:00:00Z' }],
  client_sites: [{ id: 's1', client_id: CID, url: 'https://mejirushi.example/', host: 'mejirushi.example', created_at: '2026-09-01T00:00:00Z' }],
  traffic_snapshots: [{ id: 't1', client_id: CID, period_month: '2026-09-01', source: 'gsc_api', metrics: { clicks: 10, impressions: 100, property: 'sc-domain:mejirushi.example', google_email: 'x@example.test' } }],
  measurement_runs: [{ id: 'r1', client_id: CID, measured_on: '2026-09-15', source: 'manual', summary: { by: [] }, created_at: '2026-09-15T00:00:00Z' }],
  studio_workspaces: [{ client_id: CID, data: {}, version: 1 }]
};

const browser = await chromium.launch();
async function open(email, sec) {
  const ctx = await browser.newContext();
  const auth = [];
  // 遮断した外部への移動（エラーページ）でも動くため、保存場所に触れられないときは何もしない
  await ctx.addInitScript(([db, em, cid]) => {
    try { sessionStorage.getItem('x'); } catch (e) { return; }
    if (!sessionStorage.getItem('e2e_seeded')) {
      localStorage.clear();
      localStorage.setItem('airreach_fake_db_v1', JSON.stringify(db));
      localStorage.setItem('airreach_google_props_v1', JSON.stringify({ [cid]: { gsc: 'sc-domain:mejirushi.example' } }));
      localStorage.setItem('airreach_studio_ws_v1:' + cid, JSON.stringify({ airreach_studio_v1: '{"measurements":[{"keyword":"q","impressions":5}]}' }));
      sessionStorage.setItem('fake_email', em);
      sessionStorage.setItem('e2e_seeded', '1');
    }
  }, [DB, email, CID]);
  await ctx.addInitScript('try { sessionStorage.getItem("x"); ' + FAKE + ' } catch (e) {}');
  await ctx.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin !== BASE) return route.abort();
    if (u.pathname.startsWith('/api/airreach/app-config')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, supabaseUrl: 'https://fake.test', supabaseAnonKey: 'fake' }) });
    if (u.pathname.startsWith('/api/google/auth')) {
      auth.push({ method: req.method(), query: u.search, body: req.postData() || '', authz: req.headers()['authorization'] || '' });
      if (u.searchParams.get('disconnect') === '1') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"revoked":false}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, url: 'https://accounts.google.com/o/oauth2/v2/auth?state=x' }) });
    }
    if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"code":"login_required"}' });
    return route.continue();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE}/airreach/app/#/c/${CID}/${sec}`, { waitUntil: 'load' });
  return { ctx, page, auth, errors };
}

// ---- 1. Google 接続：閲覧の同意 ----------------------------------------------------------
{
  const t = await open('staff@tb.test', 'traffic');
  await t.page.waitForSelector('[data-g-connect]');
  const consentText = await t.page.textContent('.arc-g-consent');
  expect('1. 接続の欄に閲覧の同意文がある', /担当者が、分析・改善提案・月次レポート作成・サポートのために必要な範囲で/.test(consentText || ''), consentText);
  await t.page.click('[data-g-connect]');
  await t.page.waitForTimeout(300);
  expect('1. 同意にチェックしないと接続を始めない（API を呼ばない）', t.auth.length === 0, JSON.stringify(t.auth));
  expect('1. チェックするよう知らせる', /同意にチェック/.test(await t.page.textContent('#arc-g-connect-msg') || ''));
  await t.page.check('#arc-g-consent');
  await Promise.all([t.page.waitForEvent('requestfailed', { predicate: (r) => r.url().startsWith('https://accounts.google.com/') }).catch(() => null), t.page.click('[data-g-connect]')]);
  await t.page.waitForTimeout(300);
  const a = t.auth[0] || {};
  let body = {}; try { body = JSON.parse(a.body); } catch (e) {}
  expect('1. チェックすると、同意・顧客・ログインのトークンを付けて POST で始める', a.method === 'POST' && body.consent === true && body.client === CID && body.back === 'app' && /^Bearer fake-access-token-/.test(a.authz), JSON.stringify(a));
  expect('1. 画面のエラーなし', t.errors.length === 0, t.errors.join(' | '));
  await t.ctx.close();
}

// ---- 2. 削除依頼：管理者だけ・顧客名の確認つき ----------------------------------------------
{
  const t = await open('staff@tb.test', 'members');
  await t.page.waitForSelector('#arc-gdata');
  expect('2. 管理者でないスタッフには一括削除の欄を出さない', (await t.page.$('#arc-gdel-form')) === null && /管理者だけ/.test(await t.page.textContent('#arc-gdata')));
  await t.ctx.close();
}
{
  const t = await open('admin@tb.test', 'members');
  await t.page.waitForSelector('#arc-gdel-form');
  await t.page.fill('#arc-gdel-name', '別の顧客');
  await t.page.click('#arc-gdel-form button[type=submit]');
  await t.page.waitForTimeout(300);
  let db = await t.page.evaluate(() => JSON.parse(localStorage.getItem('airreach_fake_db_v1')));
  expect('2. 顧客名が違うと消さない', db.traffic_snapshots.length === 1 && !(db.google_data_deletions || []).length);
  await t.page.fill('#arc-gdel-note', '削除依頼 受付 2026-10-06');
  await t.page.fill('#arc-gdel-name', '目印商店');
  await t.page.click('#arc-gdel-form button[type=submit]');
  await t.page.waitForFunction(() => /消しました/.test((document.getElementById('arc-msg') || document.body).textContent || ''), null, { timeout: 5000 }).catch(() => null);
  db = await t.page.evaluate(() => JSON.parse(localStorage.getItem('airreach_fake_db_v1')));
  expect('2. 管理者が顧客名を確かめると、検索・訪問の数字・Studio の作業・AI 計測の記録を消す', db.traffic_snapshots.length === 0 && db.studio_workspaces.length === 0 && db.measurement_runs.length === 0, JSON.stringify(db.traffic_snapshots));
  const local = await t.page.evaluate((cid) => ({ props: JSON.parse(localStorage.getItem('airreach_google_props_v1') || '{}')[cid], ws: localStorage.getItem('airreach_studio_ws_v1:' + cid), ack: localStorage.getItem('airreach_google_purge_ack_v1:' + cid) }), CID);
  expect('2. このブラウザの分（Google の設定・Studio の作業の控え）も消す', !local.props && local.ws === null && !!local.ack, JSON.stringify(local));
  expect('2. この顧客の Google とのつながりも切る', t.auth.some((x) => /disconnect=1/.test(x.query) && x.query.indexOf(CID) >= 0), JSON.stringify(t.auth));
  await t.page.waitForSelector('#arc-gdel-log table');
  const logText = await t.page.textContent('#arc-gdel-log');
  expect('2. 削除の記録（理由・実行した人・件数・メモ）が出る', /削除依頼/.test(logText) && /admin@tb\.test/.test(logText) && /検索・訪問の数字 1/.test(logText) && /受付 2026-10-06/.test(logText), logText);
  expect('2. 画面のエラーなし', t.errors.length === 0, t.errors.join(' | '));
  await t.ctx.close();
}

// ---- 3. 契約の状態 ----------------------------------------------------------------------
{
  const t = await open('staff@tb.test', 'members');
  await t.page.waitForSelector('#arc-client-status');
  await t.page.selectOption('#arc-status-sel', 'ended');
  await t.page.click('#arc-client-status button[type=submit]');
  await t.page.waitForTimeout(500);
  const db = await t.page.evaluate(() => JSON.parse(localStorage.getItem('airreach_fake_db_v1')));
  expect('3. 契約終了にできる（確認のあと）', db.clients[0].status === 'ended', db.clients[0].status);
  expect('3. 画面のエラーなし', t.errors.length === 0, t.errors.join(' | '));
  await t.ctx.close();
}

await browser.close();
server.close();
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
