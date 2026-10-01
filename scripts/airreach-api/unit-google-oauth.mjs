/**
 * Google OAuth（Search Console・GA4 の読み取り）と GSC / GA4 同期の単体テスト。
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
expect('scopes: OAuth requests Search Console + GA4 (read-only) only', JSON.stringify(scopes.OAUTH_SCOPES) === JSON.stringify([GSC, GA4]));
expect('scopes: no write scopes (only *.readonly)', scopes.OAUTH_SCOPES.every((x) => /\.readonly$/.test(x)) && !scopes.OAUTH_SCOPES.some((x) => /analytics(\.edit|\.manage|$)|webmasters$/.test(x)));
expect('scopes: GA4 enabled', scopes.isGa4Enabled() === true);
expect('scopes: hasScope parses space-separated scope', scopes.hasScope(`openid ${GSC}`, GSC) && !scopes.hasScope(GA4, GSC) && !scopes.hasScope('', GSC));

// ---- /api/google/auth ----
mockFetch(() => { throw new Error('auth must not call fetch'); });
let res = mkRes();
await auth(mkReq(), res);
const loc = new URL(res.headers.location || 'about:blank');
const q = loc.searchParams;
expect('auth: 302 to accounts.google.com', res.statusCode === 302 && loc.host === 'accounts.google.com', res.headers.location);
expect('auth: scope is exactly webmasters.readonly + analytics.readonly', q.get('scope') === `${GSC} ${GA4}`, q.get('scope'));
expect('auth: no analytics write / edit scopes', !/analytics\.(edit|manage)|auth\/analytics(\s|$)/.test(q.get('scope')));
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
const scopesCookie = (ck) => (ck.find((c) => c.startsWith('airreach_google_scopes=')) || '');
tokenOk(`${GSC} ${GA4}`);
res = mkRes();
await callback(mkReq({ query: { code: 'c', state: 's1' }, cookie: 'airreach_google_state=s1' }), res);
let ck = cookiesOf(res);
expect('callback: token exchange uses the same redirect_uri', calls.length === 1 && new URLSearchParams(calls[0].init.body).get('redirect_uri') === REDIRECT);
expect('callback: both granted → access + refresh cookies (HttpOnly, Secure)', ck.some((c) => /^airreach_google_access=AT;.*HttpOnly.*Secure/.test(c)) && ck.some((c) => /^airreach_google_refresh=RT;/.test(c)));
expect('callback: both granted → /airreach/studio/?google=connected#google', res.statusCode === 302 && res.headers.location === '/airreach/studio/?google=connected#google', res.headers.location);
expect('callback: scopes cookie = gsc.ga4 (readable, not a token)', /^airreach_google_scopes=gsc\.ga4;/.test(scopesCookie(ck)) && !/HttpOnly/.test(scopesCookie(ck)) && /Secure/.test(scopesCookie(ck)), scopesCookie(ck));
expect('callback: state cookie cleared', ck.some((c) => /^airreach_google_state=;.*Max-Age=0/.test(c)));
tokenOk(GSC);
res = mkRes();
await callback(mkReq({ query: { code: 'c', state: 's2' }, cookie: 'airreach_google_state=s2' }), res);
ck = cookiesOf(res);
expect('callback: GA4 denied → not reported as connected (?google=ga4_missing)', res.headers.location === '/airreach/studio/?google=ga4_missing#google', res.headers.location);
expect('callback: GA4 denied → GSC still usable (tokens stored), scopes cookie = gsc', ck.some((c) => /^airreach_google_access=AT;/.test(c)) && /^airreach_google_scopes=gsc;/.test(scopesCookie(ck)), scopesCookie(ck));
tokenOk(GA4);
res = mkRes();
await callback(mkReq({ query: { code: 'c', state: 's3' }, cookie: 'airreach_google_state=s3' }), res);
ck = cookiesOf(res);
expect('callback: GSC denied → ?google=gsc_missing, scopes cookie = ga4', res.headers.location === '/airreach/studio/?google=gsc_missing#google' && /^airreach_google_scopes=ga4;/.test(scopesCookie(ck)), res.headers.location + ' ' + scopesCookie(ck));
tokenOk('openid email');
res = mkRes();
await callback(mkReq({ query: { code: 'c', state: 's4' }, cookie: 'airreach_google_state=s4' }), res);
ck = cookiesOf(res);
expect('callback: both denied → not connected, no tokens stored, scopes cookie cleared', res.headers.location === '/airreach/studio/?google=scope_missing#google' && !ck.some((c) => /^airreach_google_(access|refresh)=/.test(c)) && /^airreach_google_scopes=;.*Max-Age=0/.test(scopesCookie(ck)), JSON.stringify(ck));
tokenOk(`openid ${GSC} ${GA4} email`);
res = mkRes();
await callback(mkReq({ query: { code: 'c', state: 's5' }, cookie: 'airreach_google_state=s5' }), res);
expect('callback: extra previously-granted scopes are fine (still connected)', res.headers.location === '/airreach/studio/?google=connected#google');
mockFetch(() => ({ status: 400, json: { error: 'invalid_grant' } }));
res = mkRes();
await callback(mkReq({ query: { code: 'c', state: 's6' }, cookie: 'airreach_google_state=s6' }), res);
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
    // サイト全体の合計（日付だけ）。伏せられた語句の分を含むので、語句つきの行の合計より大きい。データは 9/26 まで
    if (JSON.parse(init.body || '{}').dimensions.length === 1) {
      return { json: { rows: [
        { keys: ['2026-09-01'], clicks: 50, impressions: 2000, position: 10 },
        { keys: ['2026-09-26'], clicks: 10, impressions: 500, position: 20 },
      ] } };
    }
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
const totReq = JSON.parse((calls[1] || { init: {} }).init.body || '{}');
expect('gsc: site totals requested with date only (keeps anonymized queries)', JSON.stringify(totReq.dimensions) === JSON.stringify(['date']) && totReq.startDate === body.startDate && totReq.dataState === 'final', JSON.stringify(totReq));
expect('gsc: totals = whole site (not the sum of query rows), days up to the last day with data',
  JSON.stringify(res.body.totals) === JSON.stringify({ impressions: 2500, clicks: 60, ctr: 0.024, position: 12, days: 26, startDate: '2026-09-01', endDate: '2026-09-26' }), JSON.stringify(res.body.totals));
calls = [];
res = mkRes(); await gsc(mkReq({ method: 'POST', body: { ...body, totalsOnly: true }, cookie: 'airreach_google_access=AT' }), res);
expect('gsc: totalsOnly → one Google call (date only), no query rows, totals returned',
  calls.length === 1 && JSON.parse(calls[0].init.body).dimensions.length === 1 && res.body.count === 0 && res.body.totals && res.body.totals.clicks === 60, JSON.stringify(res.body).slice(0, 200));
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

// ---- /api/google/ga4 ----
const ga4Api = 'https://analyticsdata.googleapis.com/v1beta/properties/';
const gbody = { propertyId: '123456789', siteUrl: 'https://example.com/', startDate: '2026-09-01', endDate: '2026-09-28' };
mockFetch(() => ({ status: 500 }));
res = mkRes(); await ga4(mkReq({ method: 'GET' }), res);
expect('ga4: GET → 405', res.statusCode === 405);
res = mkRes(); await ga4(mkReq({ method: 'POST', body: gbody }), res);
expect('ga4: no Google connection → 401 not_connected (no Google call)', res.statusCode === 401 && res.body.code === 'not_connected' && calls.length === 0);
const ga4Bad = async (b) => { res = mkRes(); await ga4(mkReq({ method: 'POST', body: b, cookie: 'airreach_google_access=AT' }), res); return res; };
await ga4Bad({ startDate: gbody.startDate, endDate: gbody.endDate, siteUrl: gbody.siteUrl });
expect('ga4: propertyId missing → 400 (no Google call)', res.statusCode === 400 && calls.length === 0);
await ga4Bad({ propertyId: gbody.propertyId, startDate: gbody.startDate, endDate: gbody.endDate });
expect('ga4: siteUrl missing → 400 (which site the GA4 belongs to is required)', res.statusCode === 400 && /siteUrl/.test(res.body.error) && calls.length === 0);
await ga4Bad({ ...gbody, siteUrl: 'not a site' });
expect('ga4: invalid siteUrl → 400 invalid_site_url', res.statusCode === 400 && res.body.code === 'invalid_site_url');
await ga4Bad({ ...gbody, propertyId: 'G-ABCDE12345' });
expect('ga4: Measurement ID (G-…) rejected with guidance → 400 measurement_id', res.statusCode === 400 && res.body.code === 'measurement_id' && /プロパティID/.test(res.body.error) && calls.length === 0, JSON.stringify(res.body));
await ga4Bad({ ...gbody, propertyId: 'abc123' });
expect('ga4: non-numeric property id → 400 invalid_property_id', res.statusCode === 400 && res.body.code === 'invalid_property_id');
await ga4Bad({ ...gbody, startDate: '2026/09/01' });
expect('ga4: bad date format → 400', res.statusCode === 400);
mockFetch((url, init) => {
  if (url.startsWith(ga4Api)) {
    return { json: { rows: [
      { dimensionValues: [{ value: '20260901' }, { value: '/menu?x=1' }, { value: 'example.com' }], metricValues: [{ value: '120' }, { value: '7' }] },
      { dimensionValues: [{ value: '20260902' }, { value: '/' }, { value: 'EXAMPLE.com.' }], metricValues: [{ value: '80' }, { value: '3' }] },
      { dimensionValues: [{ value: '20260902' }, { value: '/' }, { value: 'www.example.com' }], metricValues: [{ value: '999' }, { value: '99' }] },
      { dimensionValues: [{ value: '20260902' }, { value: '/' }, { value: 'other.example' }], metricValues: [{ value: '555' }, { value: '55' }] },
      { dimensionValues: [{ value: '20260902' }, { value: '/' }, { value: '(not set)' }], metricValues: [{ value: '4' }, { value: '0' }] },
    ] } };
  }
  return { status: 404 };
});
res = mkRes(); await ga4(mkReq({ method: 'POST', body: { ...gbody, propertyId: 'properties/123456789' }, cookie: 'airreach_google_access=AT' }), res);
const gsent = calls[0] || { init: {} };
expect('ga4: calls properties/{numeric id}:runReport with Bearer token (properties/ prefix accepted)', gsent.url === `${ga4Api}123456789:runReport` && gsent.init.headers.Authorization === 'Bearer AT', gsent.url);
const gsentBody = JSON.parse(gsent.init.body || '{}');
expect('ga4: request = date + landingPagePlusQueryString + hostName / sessions + keyEvents', JSON.stringify(gsentBody.dimensions) === JSON.stringify([{ name: 'date' }, { name: 'landingPagePlusQueryString' }, { name: 'hostName' }]) &&
  JSON.stringify(gsentBody.metrics) === JSON.stringify([{ name: 'sessions' }, { name: 'keyEvents' }]) && JSON.stringify(gsentBody.dateRanges) === JSON.stringify([{ startDate: gbody.startDate, endDate: gbody.endDate }]));
expect('ga4: only rows for the target host (www / other domain / (not set) dropped)', res.statusCode === 200 && res.body.count === 2 && res.body.rows.every((r) => r.host === 'example.com') && res.body.host === 'example.com', JSON.stringify(res.body).slice(0, 300));
expect('ga4: excluded rows / hosts reported', res.body.excluded.rows === 3 && ['www.example.com', 'other.example', '(not set)'].every((h) => res.body.excluded.hosts.includes(h)), JSON.stringify(res.body.excluded));
expect('ga4: 200 rows with sessions', res.body.rows.map((r) => r.sessions).join() === '120,80');
expect('ga4: rows with keyEvents', res.body.rows.map((r) => r.keyEvents).join() === '7,3');
expect('ga4: date normalized (YYYY-MM-DD), host normalized, url = landing page, source ga4', JSON.stringify(res.body.rows[0]) === JSON.stringify({ date: '2026-09-01', host: 'example.com', url: '/menu?x=1', sessions: 120, keyEvents: 7, source: 'ga4' }), JSON.stringify(res.body.rows[0]));
res = mkRes(); await ga4(mkReq({ method: 'POST', body: { ...gbody, siteUrl: 'https://www.example.com/' }, cookie: 'airreach_google_access=AT' }), res);
expect('ga4: www site → only the www row (not mixed with apex)', res.body.count === 1 && res.body.rows[0].sessions === 999 && res.body.host === 'www.example.com');
res = mkRes(); await ga4(mkReq({ method: 'POST', body: { ...gbody, siteUrl: 'https://nothing.example/' }, cookie: 'airreach_google_access=AT' }), res);
expect('ga4: site not in the property → 0 rows (no fallback to other hosts)', res.statusCode === 200 && res.body.count === 0 && res.body.excluded.rows === 5);
// refresh
mockFetch((url, init) => {
  if (url === 'https://oauth2.googleapis.com/token') return new URLSearchParams(init.body).get('refresh_token') === 'RT' ? { json: { access_token: 'AT2' } } : { status: 400 };
  if (url.startsWith(ga4Api)) return init.headers.Authorization === 'Bearer AT2' ? { json: { rows: [] } } : { status: 401, json: { error: { message: 'x' } } };
  return { status: 404 };
});
res = mkRes(); await ga4(mkReq({ method: 'POST', body: gbody, cookie: 'airreach_google_refresh=RT' }), res);
expect('ga4: refresh token → new access token → 200', res.statusCode === 200 && res.body.count === 0);
// Google のエラー
const ga4Err = async (status, error) => { mockFetch(() => ({ status, json: { error } })); res = mkRes(); await ga4(mkReq({ method: 'POST', body: gbody, cookie: 'airreach_google_access=AT' }), res); return res; };
await ga4Err(401, { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' });
expect('ga4: Google 401 → 401 unauthorized (reconnect)', res.statusCode === 401 && res.body.code === 'unauthorized' && !res.body.rows);
await ga4Err(403, { code: 403, message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] });
expect('ga4: Google 403 (GSC-only token) → 403 scope_insufficient with reconnect guidance', res.statusCode === 403 && res.body.code === 'scope_insufficient' && /接続/.test(res.body.error) && !res.body.rows, JSON.stringify(res.body));
await ga4Err(403, { code: 403, message: 'User does not have sufficient permissions for this property.', status: 'PERMISSION_DENIED' });
expect('ga4: Google 403 (no property access) → 403 forbidden (no fake rows)', res.statusCode === 403 && res.body.code === 'forbidden' && !res.body.rows, JSON.stringify(res.body));
await ga4Err(400, { code: 400, message: 'Invalid property ID', status: 'INVALID_ARGUMENT' });
expect('ga4: other Google errors passed through with message', res.statusCode === 400 && res.body.code === 'google_error' && /Invalid property/.test(res.body.error));

const failed = results.filter((p) => !p).length;

// ---- /api/google/ga4 summaryOnly（月次レポート用の合計と AI 経由） ----
mockFetch((url, init) => {
  if (url.startsWith(ga4Api)) {
    const b = JSON.parse(init.body || '{}');
    if (b.dimensions.map((d) => d.name).join(',') !== 'hostName,sessionSource') return { status: 400, json: { error: { message: 'unexpected dims' } } };
    return { json: { rows: [
      { dimensionValues: [{ value: 'example.com' }, { value: 'google' }], metricValues: [{ value: '100' }, { value: '5' }] },
      { dimensionValues: [{ value: 'example.com' }, { value: 'chatgpt.com' }], metricValues: [{ value: '7' }, { value: '1' }] },
      { dimensionValues: [{ value: 'EXAMPLE.com.' }, { value: 'perplexity.ai' }], metricValues: [{ value: '3' }, { value: '0' }] },
      { dimensionValues: [{ value: 'example.com' }, { value: 'notchatgpt.com.evil' }], metricValues: [{ value: '2' }, { value: '0' }] },
      { dimensionValues: [{ value: 'example.com' }, { value: 'openai' }], metricValues: [{ value: '4' }, { value: '0' }] },
      { dimensionValues: [{ value: 'example.com' }, { value: 'copilot.com' }], metricValues: [{ value: '1' }, { value: '0' }] },
      { dimensionValues: [{ value: 'example.com' }, { value: 'openai-news.example' }], metricValues: [{ value: '6' }, { value: '0' }] },
      { dimensionValues: [{ value: 'other.example' }, { value: 'chatgpt.com' }], metricValues: [{ value: '999' }, { value: '9' }] },
    ] } };
  }
  return { status: 404 };
});
res = mkRes(); await ga4(mkReq({ method: 'POST', body: { ...gbody, summaryOnly: true }, cookie: 'airreach_google_access=AT' }), res);
expect('ga4 summaryOnly: totals for the target host only, AI sessions from AI referrers',
  res.statusCode === 200 && res.body.summary.sessions === 123 && res.body.summary.keyEvents === 6 && res.body.summary.aiSessions === 15 &&
  JSON.stringify(res.body.summary.aiSources) === JSON.stringify({ 'chatgpt.com': 7, 'perplexity.ai': 3, openai: 4, 'copilot.com': 1 }) && calls.length === 1, JSON.stringify(res.body));
mockFetch((url) => url.startsWith(ga4Api) ? { status: 403, json: { error: { message: 'no access' } } } : { status: 404 });
res = mkRes(); await ga4(mkReq({ method: 'POST', body: { ...gbody, summaryOnly: true }, cookie: 'airreach_google_access=AT' }), res);
expect('ga4 summaryOnly: no access → 403 forbidden (no numbers)', res.statusCode === 403 && res.body.code === 'forbidden' && !res.body.summary, JSON.stringify(res.body));
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
