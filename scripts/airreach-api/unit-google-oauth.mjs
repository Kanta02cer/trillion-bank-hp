/**
 * Google OAuth（Search Console のみ）と GSC 同期の単体テスト。
 * api/google/*.js のハンドラを直接呼び、Google への通信は fetch をモックする（実際の Google には接続しない）。
 *   node scripts/airreach-api/unit-google-oauth.mjs
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = async (f) => (await import(pathToFileURL(path.join(ROOT, 'api/google', f)).href)).default;
const scopes = await import(pathToFileURL(path.join(ROOT, 'api/google/_lib/scopes.js')).href);
const auth = await load('auth.js');
const callback = await load('callback.js');
const gsc = await load('gsc.js');
const ga4 = await load('ga4.js');

const results = [];
const expect = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(detail).slice(0, 300)}`); };

const GSC = 'https://www.googleapis.com/auth/webmasters.readonly';
const GA4 = 'https://www.googleapis.com/auth/analytics.readonly';
const REDIRECT = 'https://trillion-bank.jp/api/google/callback';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI = REDIRECT;

// Vercel の req / res 相当
function mkReq({ method = 'GET', query = {}, body, cookie = '', host = 'trillion-bank.jp', origin } = {}) {
  return { method, query, body, headers: { host, cookie, 'x-forwarded-proto': 'https', ...(origin ? { origin } : {}) } };
}
function mkRes() {
  const r = { statusCode: 200, headers: {}, body: undefined, ended: false };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.body = o; r.ended = true; return r; };
  r.send = (o) => { r.body = o; r.ended = true; return r; };
  r.writeHead = (c, h = {}) => { r.statusCode = c; Object.entries(h).forEach(([k, v]) => r.setHeader(k, v)); return r; };
  r.end = () => { r.ended = true; };
  return r;
}
let calls = [];
function mockFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const { status = 200, json = {} } = handler(String(url), init) || {};
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
}
const cookiesOf = (res) => [].concat(res.headers['set-cookie'] || []);

// ---- スコープ定義 ----
expect('scopes: OAuth requests Search Console only', JSON.stringify(scopes.OAUTH_SCOPES) === JSON.stringify([GSC]));
expect('scopes: GA4 disabled while analytics scope is not requested', scopes.isGa4Enabled() === false);
expect('scopes: hasScope parses space-separated scope', scopes.hasScope(`openid ${GSC}`, GSC) && !scopes.hasScope(GA4, GSC) && !scopes.hasScope('', GSC));

// ---- /api/google/auth ----
mockFetch(() => { throw new Error('auth must not call fetch'); });
let res = mkRes();
await auth(mkReq(), res);
const loc = new URL(res.headers.location || 'about:blank');
const q = loc.searchParams;
expect('auth: 302 to accounts.google.com', res.statusCode === 302 && loc.host === 'accounts.google.com', res.headers.location);
expect('auth: scope is exactly webmasters.readonly', q.get('scope') === GSC, q.get('scope'));
expect('auth: analytics.readonly is not requested', !String(q.get('scope')).includes('analytics'));
expect('auth: redirect_uri = https://trillion-bank.jp/api/google/callback (from env, unchanged)', q.get('redirect_uri') === REDIRECT);
expect('auth: client_id from env, offline + consent', q.get('client_id') === process.env.GOOGLE_CLIENT_ID && q.get('access_type') === 'offline' && q.get('prompt') === 'consent' && q.get('response_type') === 'code');
const stateCookie = cookiesOf(res).find((c) => c.startsWith('airreach_google_state='));
const state = q.get('state');
expect('auth: state cookie matches state param (HttpOnly, Secure)', !!stateCookie && stateCookie.startsWith(`airreach_google_state=${state};`) && /HttpOnly/.test(stateCookie) && /Secure/.test(stateCookie));
delete process.env.GOOGLE_REDIRECT_URI;
res = mkRes(); await auth(mkReq(), res);
expect('auth: without GOOGLE_REDIRECT_URI falls back to https://<host>/api/google/callback', new URL(res.headers.location).searchParams.get('redirect_uri') === REDIRECT);
process.env.GOOGLE_REDIRECT_URI = REDIRECT;
const cid = process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_ID;
res = mkRes(); await auth(mkReq(), res);
expect('auth: missing client id → 500, no redirect', res.statusCode === 500 && !res.headers.location);
process.env.GOOGLE_CLIENT_ID = cid;

// ---- /api/google/callback ----
res = mkRes();
await callback(mkReq({ query: { code: 'c', state: 'x' }, cookie: 'airreach_google_state=y' }), res);
expect('callback: state mismatch → 400', res.statusCode === 400);
const tokenOk = (scope) => mockFetch((url, init) => {
  if (url === 'https://oauth2.googleapis.com/token') {
    const b = new URLSearchParams(init.body);
    if (b.get('redirect_uri') !== REDIRECT || b.get('grant_type') !== 'authorization_code') return { status: 400, json: { error: 'bad' } };
    return { json: { access_token: 'AT', refresh_token: 'RT', expires_in: 3599, scope, token_type: 'Bearer' } };
  }
  return { status: 404 };
});
tokenOk(GSC);
res = mkRes();
await callback(mkReq({ query: { code: 'c', state: 's1' }, cookie: 'airreach_google_state=s1' }), res);
let ck = cookiesOf(res);
expect('callback: token exchange uses the same redirect_uri', calls.length === 1 && new URLSearchParams(calls[0].init.body).get('redirect_uri') === REDIRECT);
expect('callback: GSC granted → access + refresh cookies (HttpOnly, Secure)', ck.some((c) => /^airreach_google_access=AT;.*HttpOnly.*Secure/.test(c)) && ck.some((c) => /^airreach_google_refresh=RT;/.test(c)));
expect('callback: → /airreach/studio/?google=connected#google', res.statusCode === 302 && res.headers.location === '/airreach/studio/?google=connected#google', res.headers.location);
expect('callback: state cookie cleared', ck.some((c) => /^airreach_google_state=;.*Max-Age=0/.test(c)));
tokenOk(`${GSC} ${GA4}`);
res = mkRes();
await callback(mkReq({ query: { code: 'c', state: 's2' }, cookie: 'airreach_google_state=s2' }), res);
expect('callback: extra previously-granted scopes are fine (still connected)', res.headers.location === '/airreach/studio/?google=connected#google');
tokenOk('openid email');
res = mkRes();
await callback(mkReq({ query: { code: 'c', state: 's3' }, cookie: 'airreach_google_state=s3' }), res);
ck = cookiesOf(res);
expect('callback: Search Console scope not granted → not connected, no tokens stored', res.headers.location === '/airreach/studio/?google=scope_missing#google' && !ck.some((c) => /^airreach_google_(access|refresh)=/.test(c)), JSON.stringify(ck));
mockFetch(() => ({ status: 400, json: { error: 'invalid_grant' } }));
res = mkRes();
await callback(mkReq({ query: { code: 'c', state: 's4' }, cookie: 'airreach_google_state=s4' }), res);
expect('callback: token error → 400, no cookies', res.statusCode === 400 && !cookiesOf(res).some((c) => /airreach_google_access=/.test(c)));

// ---- /api/google/gsc ----
const gscApi = 'https://searchconsole.googleapis.com/webmasters/v3/sites/';
const body = { siteUrl: 'sc-domain:example.com', startDate: '2026-09-01', endDate: '2026-09-28' };
mockFetch(() => ({ status: 500 }));
res = mkRes(); await gsc(mkReq({ method: 'GET' }), res);
expect('gsc: GET → 405', res.statusCode === 405);
res = mkRes(); await gsc(mkReq({ method: 'POST', body }), res);
expect('gsc: no Google connection → 401 (no Google call)', res.statusCode === 401 && calls.length === 0);
res = mkRes(); await gsc(mkReq({ method: 'POST', body: { siteUrl: 'x' }, cookie: 'airreach_google_access=AT' }), res);
expect('gsc: missing dates → 400', res.statusCode === 400);
mockFetch((url, init) => {
  if (url.startsWith(gscApi)) {
    return { json: { rows: [
      { keys: ['2026-09-01', '町田 焼肉 予約', 'https://example.com/menu'], clicks: 38, impressions: 1240, ctr: 0.0306, position: 8.44 },
      { keys: ['2026-09-02', '町田 個室', 'https://www.example.com/'], clicks: 2, impressions: 90, ctr: 0.022, position: 12.1 },
    ] } };
  }
  return { status: 404 };
});
res = mkRes(); await gsc(mkReq({ method: 'POST', body, cookie: 'airreach_google_access=AT' }), res);
const sent = calls[0] || { init: {} };
expect('gsc: calls searchAnalytics/query for the encoded siteUrl with Bearer token', sent.url === `${gscApi}${encodeURIComponent(body.siteUrl)}/searchAnalytics/query` && sent.init.headers.Authorization === 'Bearer AT', sent.url);
const sentBody = JSON.parse(sent.init.body || '{}');
expect('gsc: request = date/query/page, final data, dates passed through', JSON.stringify(sentBody.dimensions) === JSON.stringify(['date', 'query', 'page']) && sentBody.dataState === 'final' && sentBody.startDate === body.startDate && sentBody.endDate === body.endDate);
expect('gsc: 200 with mapped rows (keyword / url / impressions / clicks / position) and siteUrl', res.statusCode === 200 && res.body.count === 2 && res.body.siteUrl === body.siteUrl &&
  JSON.stringify(res.body.rows[0]) === JSON.stringify({ date: '2026-09-01', keyword: '町田 焼肉 予約', url: 'https://example.com/menu', clicks: 38, impressions: 1240, ctr: 0.0306, position: 8.44, source: 'gsc' }), JSON.stringify(res.body).slice(0, 300));
// アクセストークン切れ → refresh
mockFetch((url, init) => {
  if (url === 'https://oauth2.googleapis.com/token') return new URLSearchParams(init.body).get('refresh_token') === 'RT' ? { json: { access_token: 'AT2' } } : { status: 400 };
  if (url.startsWith(gscApi)) return init.headers.Authorization === 'Bearer AT2' ? { json: { rows: [] } } : { status: 401, json: { error: 'x' } };
  return { status: 404 };
});
res = mkRes(); await gsc(mkReq({ method: 'POST', body, cookie: 'airreach_google_refresh=RT' }), res);
expect('gsc: refresh token → new access token → 200', res.statusCode === 200 && res.body.count === 0 && calls[0].url === 'https://oauth2.googleapis.com/token');
// Google 側のエラー（権限なし等）はそのまま返す
mockFetch(() => ({ status: 403, json: { error: { code: 403, message: 'User does not have sufficient permission for site' } } }));
res = mkRes(); await gsc(mkReq({ method: 'POST', body, cookie: 'airreach_google_access=AT' }), res);
expect('gsc: Google 403 is passed through (no fake rows)', res.statusCode === 403 && !res.body.rows);

// ---- /api/google/ga4（準備中）----
mockFetch(() => { throw new Error('ga4 must not call Google while disabled'); });
res = mkRes(); await ga4(mkReq({ method: 'POST', body: { propertyId: '1', startDate: 'a', endDate: 'b' }, cookie: 'airreach_google_access=AT' }), res);
expect('ga4: disabled → 503 ga4_not_enabled, message 準備中, Google not called', res.statusCode === 503 && res.body.code === 'ga4_not_enabled' && /準備中/.test(res.body.error) && calls.length === 0, JSON.stringify(res.body));
res = mkRes(); await ga4(mkReq({ method: 'GET' }), res);
expect('ga4: GET still 405', res.statusCode === 405);

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
