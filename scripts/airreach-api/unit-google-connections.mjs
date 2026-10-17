/**
 * お客様の Google のつながりのサーバー保管・語句の保存・毎日の自動取り込みの単体テスト。
 * Google と Supabase への通信は fetch をモックする（実際には接続しない）。
 *   node scripts/airreach-api/unit-google-connections.mjs
 */
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (f) => import(pathToFileURL(path.join(ROOT, 'api/google', f)).href);

process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'https://trillion-bank.jp/api/google/callback';
process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test-key';
process.env.GOOGLE_TOKEN_KEY = randomBytes(32).toString('base64');
process.env.CRON_SECRET = 'cron-secret-test';

const crypto = await imp('_lib/crypto.js');
const conn = await imp('_lib/connections.js');
const callback = (await imp('callback.js')).default;
const gscMod = await imp('gsc.js');
const gsc = gscMod.default;
const syncMod = await imp('sync.js');
const auth = (await imp('auth.js')).default;

const results = [];
const expect = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(detail).slice(0, 300)}`); };

const CID = '11111111-2222-3333-4444-555555555555';
const SITE = 'sc-domain:sample-salon.example';
const STAFF = 'staff-token-0123456789abcdef';
let calls = [];
let db = { conn: null, queries: {}, traffic: {}, revoked: false };
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? (typeof init.body === 'string' ? (init.body.startsWith('{') || init.body.startsWith('[') ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body))) : Object.fromEntries(init.body)) : null;
  calls.push({ u, body, headers: init.headers || {} });
  if (u === 'https://oauth2.googleapis.com/token') {
    if (body.grant_type === 'authorization_code') return json(200, { access_token: 'acc-1', refresh_token: 'refresh-PLAIN-1', expires_in: 3600, scope: 'https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly', id_token: 'x.' + Buffer.from(JSON.stringify({ email: 'owner@gmail.test' })).toString('base64url') + '.y' });
    if (body.grant_type === 'refresh_token') return db.revoked ? json(400, { error: 'invalid_grant' }) : (body.refresh_token === 'refresh-PLAIN-1' ? json(200, { access_token: 'acc-stored' }) : json(400, { error: 'invalid_client' }));
  }
  if (u === 'https://oauth2.googleapis.com/revoke') return json(200, {});
  if (u.endsWith('/rest/v1/rpc/airreach_google_access')) return json(200, { allowed: true, role: 'staff' });
  if (u.endsWith('/rest/v1/rpc/airreach_save_google_connection')) { db.conn = { client_id: body.p_client_id, refresh_token_enc: body.p_token_enc, scopes: body.p_scopes, gsc_property: null }; return json(200, { ok: true }); }
  if (u.endsWith('/rest/v1/rpc/airreach_set_gsc_property')) { if (!db.conn) return json(200, { ok: false, reason: 'not_connected' }); if (body.p_property !== SITE) return json(200, { ok: false, reason: 'site_mismatch' }); db.conn.gsc_property = body.p_property; db.conn.perm = body.p_permission; return json(200, { ok: true }); }
  if (u.endsWith('/rest/v1/rpc/airreach_save_gsc_queries')) { db.queries[body.p_period_month] = body.p_rows; return json(200, { ok: true, rows: body.p_rows.length }); }
  if (u.endsWith('/rest/v1/rpc/airreach_save_google_traffic')) { db.traffic[body.p_period_month] = body.p_metrics; return json(200, { ok: true }); }
  if (u.endsWith('/rest/v1/rpc/airreach_mark_google_sync')) { db.mark = { status: body.p_status, error: body.p_error }; return json(200, null); }
  if (u.endsWith('/rest/v1/rpc/airreach_delete_google_connection')) { db.conn = null; return json(200, { ok: true, deleted: 1 }); }
  if (u.endsWith('/rest/v1/rpc/airreach_google_sync_targets')) return json(200, db.conn && db.conn.gsc_property ? [db.conn] : []);
  if (u.includes('/rest/v1/google_connections?')) return json(200, db.conn ? [db.conn] : []);
  if (u === 'https://searchconsole.googleapis.com/webmasters/v3/sites') return json(200, { siteEntry: [{ siteUrl: SITE, permissionLevel: 'siteOwner' }] });
  if (u.includes('/searchAnalytics/query')) {
    if (body.dimensions.join() === 'date') return json(200, { rows: [{ keys: [body.startDate], clicks: 10, impressions: 200, position: 5 }, { keys: [body.startDate.slice(0, 8) + '02'], clicks: 5, impressions: 100, position: 8 }] });
    return json(200, { rows: [{ keys: ['大宮 美容室', 'https://sample-salon.example/'], clicks: 7, impressions: 120, ctr: 0.058, position: 3.24 }, { keys: ['大宮 ヘッドスパ', 'https://sample-salon.example/spa/'], clicks: 1, impressions: 300, ctr: 0.003, position: 9.1 }] });
  }
  return json(404, { error: 'unexpected ' + u });
};

function mkReq({ method = 'GET', query = {}, body, cookie = '', token = STAFF } = {}) {
  return { method, query, body, headers: { host: 'trillion-bank.jp', cookie, 'x-forwarded-proto': 'https', ...(token ? { authorization: 'Bearer ' + token } : {}) } };
}
function mkRes() {
  const r = { statusCode: 200, headers: {}, body: undefined };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.writeHead = (c, h) => { r.statusCode = c; Object.entries(h || {}).forEach(([k, v]) => r.setHeader(k, v)); };
  r.end = (b) => { if (b !== undefined) { try { r.body = JSON.parse(b); } catch (e) { r.body = b; } } };
  return r;
}

// 1) 暗号化
const enc = crypto.encryptToken('refresh-PLAIN-1');
expect('暗号化：v1. で始まり、平文を含まない', /^v1\./.test(enc) && !enc.includes('refresh-PLAIN-1'));
expect('暗号化：同じ鍵で元に戻る', crypto.decryptToken(enc) === 'refresh-PLAIN-1');
expect('暗号化：毎回ちがう文字列（iv）', crypto.encryptToken('refresh-PLAIN-1') !== enc);
const tampered = enc.slice(0, -2) + (enc.endsWith('A') ? 'BB' : 'AA');
expect('暗号化：書き換えられたものは戻せない', crypto.decryptToken(tampered) === null);
expect('暗号化：別の鍵では戻せない', crypto.decryptToken(enc, { GOOGLE_TOKEN_KEY: randomBytes(32).toString('base64') }) === null);
expect('鍵が無ければ保管しない', crypto.encryptToken('x', {}) === null && crypto.canStoreTokens({}) === false);
expect('鍵の長さが違えば保管しない', crypto.canStoreTokens({ GOOGLE_TOKEN_KEY: randomBytes(16).toString('base64') }) === false);

// 2) Google の同意から戻ったとき（顧客の画面から）
calls = [];
let res = mkRes();
await callback(mkReq({ query: { code: 'c', state: 's' }, cookie: `airreach_google_state=s; airreach_google_back=app:${CID}`, token: '' }), res);
const saveCall = calls.find(c => c.u.endsWith('airreach_save_google_connection'));
expect('callback：顧客の画面からの接続はサーバーに保管する', res.statusCode === 302 && !!saveCall);
expect('callback：保管するのは暗号化した文字列だけ（平文のトークンは送らない）', saveCall && /^v1\./.test(saveCall.body.p_token_enc) && !JSON.stringify(saveCall.body).includes('refresh-PLAIN-1'));
expect('callback：Supabase へは service_role の鍵で呼ぶ', saveCall && saveCall.headers.Authorization === 'Bearer service-test-key');
calls = [];
await callback(mkReq({ query: { code: 'c', state: 's' }, cookie: 'airreach_google_state=s', token: '' }), mkRes());
expect('callback：Studio の取り込み画面（顧客の指定なし）からの接続は保管しない', !calls.some(c => c.u.endsWith('airreach_save_google_connection')));

// 3) お客様が取り込む（合計の保存 → サイトの記録 → 語句の保存）。このブラウザに Cookie は無く、保管したつながりで読む
calls = []; res = mkRes();
await gsc(mkReq({ method: 'POST', body: { clientId: CID, siteUrl: SITE, startDate: '2026-09-01', endDate: '2026-09-30', totalsOnly: true, save: true } }), res);
expect('取り込み：Cookie が無くても、保管したつながりで読める', res.statusCode === 200 && res.body.saved === true, JSON.stringify(res.body));
expect('取り込み：合計は日付ごとの合計（15 クリック・300 表示）', res.body.totals && res.body.totals.clicks === 15 && res.body.totals.impressions === 300);
expect('取り込み：選んだサイトと権限（所有者）を記録する', db.conn.gsc_property === SITE && db.conn.perm === 'siteOwner');
expect('取り込み：その月の語句 × ページを保存する（表示の多い順）', res.body.queries && res.body.queries.ok && db.queries['2026-09-01'][0].query === '大宮 ヘッドスパ', JSON.stringify(res.body.queries));
expect('取り込み：掲載順位は小数1桁', db.queries['2026-09-01'][1].position === 3.2);
calls = []; res = mkRes();
await gsc(mkReq({ method: 'POST', body: { clientId: CID, siteUrl: 'sc-domain:other.example', startDate: '2026-09-01', endDate: '2026-09-30', totalsOnly: true, save: true } }), res);
expect('取り込み：別のサイトでは語句を保存しない（サイトの記録で止まる）', !(res.body.queries && res.body.queries.ok) && !calls.some(c => c.u.endsWith('airreach_save_gsc_queries')));

// 4) 毎日の自動取り込み
const ps = syncMod.syncPeriods(new Date('2026-10-17T03:00:00Z'));
expect('取り込む月：10/17 なら 9月（全体）と 10/1〜10/16', ps.length === 2 && ps[0].start === '2026-09-01' && ps[0].end === '2026-09-30' && ps[1].start === '2026-10-01' && ps[1].end === '2026-10-16');
const p1 = syncMod.syncPeriods(new Date('2026-10-31T16:00:00Z'));
expect('取り込む月：JST の 11/1 なら 10月だけ', p1.length === 1 && p1[0].period === '2026-10-01');
const pj = syncMod.syncPeriods(new Date('2027-01-05T00:00:00Z'));
expect('取り込む月：1月は前の年の12月', pj[0].period === '2026-12-01' && pj[0].end === '2026-12-31');
const sync = syncMod.default;
res = mkRes(); await sync(mkReq({ token: 'wrong' }), res);
expect('自動取り込み：CRON_SECRET が違えば 401', res.statusCode === 401);
res = mkRes(); await sync(mkReq({ token: 'cron-secret-test' }), res);
expect('自動取り込み：既定は止めている（AIRREACH_GOOGLE_SYNC_ENABLED）', res.statusCode === 200 && res.body.disabled === true);
process.env.AIRREACH_GOOGLE_SYNC_ENABLED = 'true';
db.traffic = {}; db.queries = {};
res = mkRes(); await sync(mkReq({ token: 'cron-secret-test' }), res);
expect('自動取り込み：サイトを選んだ顧客を取り込む', res.body.ok && res.body.ran.length === 1 && res.body.ran[0].status === 'ok', JSON.stringify(res.body));
expect('自動取り込み：先月と今月の合計を保存（保存した人は auto）', Object.keys(db.traffic).length >= 1 && Object.values(db.traffic).every(m => m.saved_via === 'auto' && m.property === SITE));
expect('自動取り込み：語句も保存', Object.keys(db.queries).length === Object.keys(db.traffic).length);
expect('自動取り込み：応答に顧客の数字を載せない', !JSON.stringify(res.body).includes('impressions') && !JSON.stringify(res.body).includes('大宮'));
expect('自動取り込み：結果を記録（ok）', db.mark && db.mark.status === 'ok');
db.revoked = true;
res = mkRes(); await sync(mkReq({ token: 'cron-secret-test' }), res);
expect('自動取り込み：Google 側で取り消されたら token_revoked と記録', res.body.ran[0].status === 'token_revoked' && db.mark.status === 'token_revoked');
db.revoked = false;

// 5) 切断：サーバーの保管も消す（ログインして、その顧客を扱える人だけ）
res = mkRes();
await auth(mkReq({ method: 'POST', query: { disconnect: '1', client: CID }, token: '' }), res);
expect('切断：ログインなしでは、サーバーの保管は消さない', res.body.serverDeleted === false && db.conn !== null);
calls = []; res = mkRes();
await auth(mkReq({ method: 'POST', query: { disconnect: '1', client: CID } }), res);
expect('切断：ログインした人なら、サーバーの保管を消す', res.body.serverDeleted === true && db.conn === null);
expect('切断：保管していたトークンの Google 側の許可も取り消す', calls.some(c => c.u === 'https://oauth2.googleapis.com/revoke' && c.body.token === 'refresh-PLAIN-1'));

// 6) 鍵が無いときは、これまでどおり（保管しない・取り込みは成功）
delete process.env.GOOGLE_TOKEN_KEY;
calls = [];
await callback(mkReq({ query: { code: 'c', state: 's' }, cookie: `airreach_google_state=s; airreach_google_back=app:${CID}`, token: '' }), mkRes());
expect('鍵なし：callback は保管しない', !calls.some(c => c.u.endsWith('airreach_save_google_connection')));
res = mkRes();
await gsc(mkReq({ method: 'POST', cookie: `airreach_g_${CID.replace(/-/g, '')}_a=acc-cookie`, body: { clientId: CID, siteUrl: SITE, startDate: '2026-09-01', endDate: '2026-09-30', totalsOnly: true, save: true } }), res);
expect('鍵なし：合計の取り込みは今までどおり成功し、語句は not_configured', res.body.saved === true && res.body.queries.reason === 'not_configured');

const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
