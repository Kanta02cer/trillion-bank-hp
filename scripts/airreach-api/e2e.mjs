/**
 * AirReach API（Vercel Functions 版）のローカル E2E。
 *   node scripts/airreach-api/e2e.mjs
 * 起動するもの: モック Supabase（RPC 2 本のみ）、モック対象サイト、ローカルハーネス。
 * 本物の Supabase / Cloudflare には接続しない。終了時にモックのデータを消して子プロセスを止める。
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { buildScanPayload } from './fixture.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..', '..');
const MOCK_PORT = 54321, TARGET_PORT = 54322, API_PORT = 3900;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const TARGET = `http://127.0.0.1:${TARGET_PORT}`;
const API = `http://127.0.0.1:${API_PORT}`;
const SERVICE_KEY = 'test-service-key';
const SAME_ORIGIN = API;
const ALLOWED_ORIGIN = 'http://127.0.0.1:4000';
const BAD_ORIGIN = 'https://evil.example';

const results = [];
let serverOutput = '';
const issuedTokens = [];
const record = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || !detail ? '' : '  — ' + detail}`); };
const expect = (name, cond, detail = '') => record(name, !!cond, detail);

async function sha256Hex(s) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Buffer.from(d).toString('hex'); }
async function api(p, { method = 'GET', origin = null, body, headers = {}, raw = false } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  let payload;
  if (body !== undefined) { payload = raw ? body : JSON.stringify(body); if (!h['Content-Type']) h['Content-Type'] = 'application/json'; }
  const res = await fetch(API + p, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, headers: res.headers, text, json };
}
async function mock(p, body) { const r = await fetch(MOCK + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json(); }
async function waitFor(url, ms) { const until = Date.now() + ms; while (Date.now() < until) { try { const r = await fetch(url); if (r.status < 500) return true; } catch {} await sleep(300); } return false; }

const children = [];
function start(name, file, envExtra, capture = false) {
  const child = spawn(process.execPath, [path.join(DIR, file)], { env: { ...process.env, ...envExtra }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => { if (capture) serverOutput += d; });
  child.stderr.on('data', (d) => { if (capture) serverOutput += d; else process.stderr.write(`[${name}] ${d}`); });
  children.push(child);
  return child;
}
let mockProc = start('mock', 'mock-supabase.mjs', { MOCK_PORT: String(MOCK_PORT), MOCK_SERVICE_KEY: SERVICE_KEY });
start('target', 'mock-target.mjs', { TARGET_PORT: String(TARGET_PORT) });
start('api', 'local-server.mjs', {
  PORT: String(API_PORT),
  SUPABASE_URL: MOCK,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  AIRREACH_SUPABASE_TIMEOUT_MS: '1500',
  AIRREACH_FETCH_TIMEOUT_MS: '1500',
  AIRREACH_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
  AIRREACH_FETCH_ALLOW_LOOPBACK_FOR_TESTS: '1',
}, true);

async function stopMock() { if (!mockProc) return; mockProc.kill('SIGTERM'); await new Promise((r) => mockProc.once('exit', r)); mockProc = null; }
async function shutdown(code) {
  try { await mock('/__mock/reset', {}); } catch {}
  for (const c of children) { try { c.kill('SIGTERM'); } catch {} }
  await sleep(300);
  process.exit(code);
}

try {
  expect('mock supabase is up', await waitFor(`${MOCK}/__mock/state`, 10000));
  expect('mock target is up', await waitFor(`${TARGET}/`, 10000));
  expect('local api harness is up', await waitFor(`${API}/api/airreach/health`, 20000), serverOutput.slice(-500));

  // ---- health ------------------------------------------------------------------
  let r = await api('/api/airreach/health');
  expect('GET /api/airreach/health → 200 (ok only, no env info)', r.status === 200 && r.json?.ok === true && r.json?.config === undefined && r.json?.runtime === undefined, `status=${r.status} ${r.text.slice(0, 120)}`);
  expect('health: no-store + nosniff', r.headers.get('cache-control') === 'no-store' && r.headers.get('x-content-type-options') === 'nosniff');
  r = await api('/api/airreach/health/');
  expect('trailing slash accepted', r.status === 200);

  // ---- origin policy / CORS / OPTIONS ---------------------------------------------
  r = await api('/api/airreach/scans', { method: 'OPTIONS', origin: ALLOWED_ORIGIN, headers: { 'Access-Control-Request-Method': 'POST' } });
  expect('OPTIONS allowed origin → 204 + ACAO', r.status === 204 && r.headers.get('access-control-allow-origin') === ALLOWED_ORIGIN && /POST/.test(r.headers.get('access-control-allow-methods') || ''), `status=${r.status}`);
  r = await api('/api/airreach/scans', { method: 'OPTIONS', origin: BAD_ORIGIN });
  expect('OPTIONS disallowed origin → 403', r.status === 403, `status=${r.status}`);
  r = await api('/api/airreach/scans', { method: 'OPTIONS', origin: SAME_ORIGIN });
  expect('OPTIONS same-origin → 204 without CORS headers', r.status === 204 && !r.headers.get('access-control-allow-origin'), `status=${r.status}`);
  r = await api('/api/airreach/scans', { method: 'POST', origin: BAD_ORIGIN, body: buildScanPayload() });
  expect('POST disallowed origin → 403 (not processed)', r.status === 403 && r.json?.error?.code === 'origin_not_allowed', `status=${r.status}`);
  let st = await mock('/__mock/state');
  expect('403 request never reached Supabase', st.calls.length === 0);

  // ---- POST /api/airreach/scans -------------------------------------------------------
  const payload = buildScanPayload();
  r = await api('/api/airreach/scans', { method: 'POST', origin: SAME_ORIGIN, body: payload });
  expect('POST same-origin valid → 201', r.status === 201 && r.json?.ok === true, `status=${r.status} ${r.text.slice(0, 200)}`);
  expect('201 same-origin: no CORS header needed', !r.headers.get('access-control-allow-origin'));
  const token = r.json?.shareToken || '';
  if (token) issuedTokens.push(token);
  expect('201 returns scanId', r.json?.scanId === payload.scan.id);
  expect('201 returns 43-char base64url shareToken', /^[A-Za-z0-9_-]{43}$/.test(token), `${token.length} chars`);
  expect('201 returns sharePath', r.json?.sharePath === `/airreach/result/?share=${token}`);
  const hash = await sha256Hex(token);
  st = await mock('/__mock/state');
  expect('mock stored 1 scan with SHA-256 (not the token)', st.scans.length === 1 && st.hashes[0] === hash && !JSON.stringify(st.lastInsertArgs).includes(token));
  expect('mock never received a table request', st.forbiddenPaths.length === 0, JSON.stringify(st.forbiddenPaths));
  await mkdir(path.join(DIR, 'out'), { recursive: true });
  await writeFile(path.join(DIR, 'out', 'last-insert-args.json'), JSON.stringify(st.lastInsertArgs, null, 2));

  r = await api('/api/airreach/scans', { method: 'POST', body: payload });
  expect('POST same scanId (no Origin) → 409', r.status === 409 && r.json?.error?.code === 'conflict', `status=${r.status}`);
  expect('409 body has no shareToken', !r.text.includes('shareToken') && !r.text.includes(token));
  st = await mock('/__mock/state');
  expect('duplicate did not add a scan', st.scans.length === 1);

  const p2 = buildScanPayload();
  r = await api('/api/airreach/scans/', { method: 'POST', origin: ALLOWED_ORIGIN, body: p2 });
  expect('POST allowlisted cross-origin (trailing slash) → 201 + ACAO', r.status === 201 && r.headers.get('access-control-allow-origin') === ALLOWED_ORIGIN, `status=${r.status}`);
  if (r.json?.shareToken) issuedTokens.push(r.json.shareToken);

  // ---- 400 / 422 / 413 --------------------------------------------------------------
  r = await api('/api/airreach/scans', { method: 'POST', body: '{"scan": ', raw: true });
  expect('POST invalid JSON → 400', r.status === 400 && r.json?.error?.code === 'bad_request', `status=${r.status}`);
  r = await api('/api/airreach/scans', { method: 'POST', body: JSON.stringify(payload), raw: true, headers: { 'Content-Type': 'text/plain' } });
  expect('POST wrong Content-Type → 400', r.status === 400, `status=${r.status}`);
  r = await api('/api/airreach/scans', { method: 'POST', body: { scan: payload.scan } });
  expect('POST missing result → 400', r.status === 400, `status=${r.status}`);
  const cases = [
    ['bad scanId', (p) => { p.scan.id = 'BAD-ID'; }],
    ['overall mismatch (+1)', (p) => { p.result.overall = (p.result.overall ?? 0) + 1; }],
    ['factor score mismatch', (p) => { p.result.factors.entity.score = 100; p.result.entity = 100; }],
    ['unknown ruleVersion', (p) => { p.result.ruleVersion = 'airreach-common-v9'; }],
    ['unknown displayVersion', (p) => { p.result.displayVersion = 'band-v9'; }],
    ['17 checks', (p) => { p.result.checks.pop(); }],
    ['unknown check with points', (p) => { p.result.checks[14].points = 4; }],
    ['ok check with wrong points', (p) => { p.result.checks[0].points = 1; }],
    ['private URL', (p) => { p.scan.url = 'http://192.168.1.10/'; }],
    ['missing robots evidence', (p) => { delete p.result.evidence.robots; }],
    ['state mismatch', (p) => { p.result.state = 'verified'; }],
    ['oversized keyword', (p) => { p.scan.keyword = 'x'.repeat(101); }],
  ];
  const insertsBefore = (await mock('/__mock/state')).calls.filter((c) => c === 'insert').length;
  for (const [name, mutate] of cases) {
    const p = buildScanPayload(); mutate(p);
    r = await api('/api/airreach/scans', { method: 'POST', body: p });
    expect(`POST ${name} → 422`, r.status === 422 && r.json?.error?.code === 'validation_failed' && r.json?.error?.details?.length > 0, `status=${r.status} ${r.text.slice(0, 160)}`);
  }
  st = await mock('/__mock/state');
  expect('422 cases never reached Supabase', st.calls.filter((c) => c === 'insert').length === insertsBefore);
  const big = buildScanPayload(); big.result.review.summary = 'x'.repeat(300 * 1024);
  r = await api('/api/airreach/scans', { method: 'POST', body: big });
  expect('POST 300KB → 413', r.status === 413 && r.json?.error?.code === 'payload_too_large', `status=${r.status}`);
  r = await api('/api/airreach/scans');
  expect('GET /api/airreach/scans → 405', r.status === 405, `status=${r.status}`);

  // ---- GET /api/airreach/shared-scans/:token -------------------------------------------
  r = await api(`/api/airreach/shared-scans/?shareToken=${encodeURIComponent(token)}`);
  expect('GET valid shareToken (query form) → 200', r.status === 200 && r.json?.ok === true, `status=${r.status} ${r.text.slice(0, 160)}`);
  expect('shared: scan.id / factors 4 / checks 18 / sources 3', r.json?.scan?.id === payload.scan.id && r.json?.factors?.length === 4 && r.json?.checks?.length === 18 && r.json?.sources?.length === 3);
  expect('shared: raw_result whitelisted', r.json?.result?.overall === payload.result.overall && r.json?.result?.referral === undefined && r.json?.result?.modelPlaceholders === undefined);
  expect('shared: no hash column or value in response', !r.text.includes('share_token_hash') && !r.text.includes(hash));
  expect('shared: no-store', r.headers.get('cache-control') === 'no-store');
  r = await api(`/api/airreach/shared-scans/${token}/`);
  expect('shared: path form via rewrite emulation → 200', r.status === 200);
  const wrongToken = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  r = await api(`/api/airreach/shared-scans/?shareToken=${wrongToken}`);
  expect('GET wrong shareToken → 404', r.status === 404 && r.json?.error?.code === 'not_found', `status=${r.status}`);
  r = await api('/api/airreach/shared-scans/?shareToken=abc');
  expect('GET malformed token → 404', r.status === 404, `status=${r.status}`);
  r = await api(`/api/airreach/shared-scans/?shareToken=${payload.scan.id}`);
  expect('GET scanId as token → 404', r.status === 404, `status=${r.status}`);
  await mock('/__mock/revoke', { id: payload.scan.id });
  r = await api(`/api/airreach/shared-scans/?shareToken=${encodeURIComponent(token)}`);
  expect('GET revoked shareToken → 404', r.status === 404, `status=${r.status}`);
  r = await api(`/api/airreach/shared-scans/?shareToken=${encodeURIComponent(token)}`, { method: 'POST', body: {} });
  expect('POST shared-scans → 405', r.status === 405, `status=${r.status}`);

  // ---- fetch ---------------------------------------------------------------------------
  const fx = (u, opts = {}) => api(`/api/airreach/fetch?url=${encodeURIComponent(u)}`, opts);
  r = await fx(`${TARGET}/`);
  expect('fetch normal → 200 html', r.status === 200 && /<title>Mock Site<\/title>/.test(r.text) && /text\/html/.test(r.headers.get('content-type') || ''), `status=${r.status}`);
  expect('fetch: X-AirReach-Final-URL + exposed', r.headers.get('x-airreach-final-url') === `${TARGET}/` && /X-AirReach-Final-URL/i.test(r.headers.get('access-control-expose-headers') || ''));
  expect('fetch: cache private max-age=60', r.headers.get('cache-control') === 'private, max-age=60');
  r = await fx(`${TARGET}/llms.txt`);
  expect('fetch llms.txt → 200 text', r.status === 200 && /Mock Site/.test(r.text));
  r = await fx(`${TARGET}/robots.txt`);
  expect('fetch robots.txt → 200', r.status === 200 && /GPTBot/.test(r.text));
  r = await fx(`${TARGET}/echo-ua`);
  expect('fetch sends AirReach User-Agent', r.status === 200 && /TrillionBank-AirReach\/1\.0/.test(r.text));
  r = await fx(`${TARGET}/redirect`);
  expect('fetch redirect → 200 with final URL /', r.status === 200 && r.headers.get('x-airreach-final-url') === `${TARGET}/`, `status=${r.status} final=${r.headers.get('x-airreach-final-url')}`);
  r = await fx(`${TARGET}/redirect-chain/3`);
  expect('fetch 3 redirects → 200', r.status === 200, `status=${r.status}`);
  r = await fx(`${TARGET}/redirect-chain/5`);
  expect('fetch 5 redirects → 502 too many', r.status === 502 && r.json?.error?.code === 'upstream_error', `status=${r.status}`);
  r = await fx(`${TARGET}/redirect-loop`);
  expect('fetch redirect loop → 502', r.status === 502, `status=${r.status}`);
  r = await fx(`${TARGET}/redirect-private`);
  expect('fetch redirect to 169.254.169.254 → 400', r.status === 400, `status=${r.status}`);
  r = await fx(`${TARGET}/redirect-localhost`);
  expect('fetch redirect to localhost → 400', r.status === 400, `status=${r.status}`);
  r = await fx(`${TARGET}/no-location`);
  expect('fetch redirect without Location → 502', r.status === 502, `status=${r.status}`);
  let t0 = Date.now();
  r = await fx(`${TARGET}/slow`);
  expect('fetch slow → 504 within timeout', r.status === 504 && Date.now() - t0 < 5000, `status=${r.status} ms=${Date.now() - t0}`);
  r = await fx(`${TARGET}/big`);
  expect('fetch 2MB (Content-Length) → 502', r.status === 502, `status=${r.status}`);
  r = await fx(`${TARGET}/big-chunked`);
  expect('fetch 2MB (chunked) → 502', r.status === 502, `status=${r.status}`);
  r = await fx(`${TARGET}/missing`);
  expect('fetch 404 → 404 passthrough, empty body', r.status === 404 && r.text === '' && r.headers.get('x-airreach-final-url') === `${TARGET}/missing`, `status=${r.status}`);
  r = await fx(`${TARGET}/gone`);
  expect('fetch 410 → 410 passthrough', r.status === 410 && r.text === '', `status=${r.status}`);
  r = await fx(`${TARGET}/error`);
  expect('fetch upstream 500 → 502', r.status === 502, `status=${r.status}`);
  r = await fx(`${TARGET}/pdf`);
  expect('fetch application/pdf → 502 unsupported', r.status === 502, `status=${r.status}`);
  r = await fx(`${TARGET}/json`);
  expect('fetch application/json → 200 (allowed type)', r.status === 200, `status=${r.status}`);
  r = await fx(`${TARGET}/?token=secret123&x=1`, {});
  expect('fetch strips secret query before request', r.status === 200 && r.headers.get('x-airreach-final-url') === `${TARGET}/?x=1`, `final=${r.headers.get('x-airreach-final-url')}`);
  r = await api('/api/airreach/fetch');
  expect('fetch without url → 400', r.status === 400, `status=${r.status}`);
  r = await fx(`${TARGET}/`, { method: 'HEAD' });
  expect('fetch HEAD → 200 no body', r.status === 200 && r.text === '', `status=${r.status}`);
  r = await fx(`${TARGET}/`, { method: 'POST', body: {} });
  expect('fetch POST → 405', r.status === 405, `status=${r.status}`);
  r = await fx(`${TARGET}/`, { origin: BAD_ORIGIN });
  expect('fetch from disallowed origin → 403', r.status === 403, `status=${r.status}`);
  for (const bad of ['http://localhost:54322/', 'http://metadata.google.internal/', 'http://10.0.0.1/', 'http://169.254.169.254/latest/', 'http://[::1]/', 'http://192.168.1.1/', 'http://0.0.0.0/', 'http://foo.local/', 'http://intranet/', 'ftp://example.com/', 'http://100.64.0.1/']) {
    r = await fx(bad);
    expect(`fetch SSRF ${bad} → 400`, r.status === 400 && r.json?.error?.code === 'bad_request', `status=${r.status}`);
  }
  try {
    r = await fx('https://example.com/');
    expect('fetch external https://example.com/ → 200', r.status === 200 && /Example Domain/.test(r.text), `status=${r.status}`);
  } catch (e) { record('fetch external https://example.com/ (skipped: offline)', true); }
  r = await fx('http://localtest.me/');
  expect('fetch hostname resolving to 127.0.0.1 (DNS check) → 400', r.status === 400, `status=${r.status} ${r.text.slice(0, 120)}`);

  // ---- URL guard without the test flag (production behaviour) ------------------------------
  const guard = spawn(process.execPath, ['--input-type=module', '-e', `
    import { sanitizeHttpUrl } from ${JSON.stringify(path.join(ROOT, 'api/airreach/_lib/url.js'))};
    const bad = ['http://127.0.0.1:54322/', 'http://127.1/', 'http://0x7f000001/', 'http://localhost/', 'http://[::1]/', 'http://10.1.2.3/'];
    let rejected = 0; for (const b of bad) { try { sanitizeHttpUrl(b); } catch { rejected += 1; } }
    console.log(JSON.stringify({ rejected, total: bad.length }));
  `], { env: { ...process.env, AIRREACH_FETCH_ALLOW_LOOPBACK_FOR_TESTS: '' } });
  let guardOut = ''; guard.stdout.on('data', (d) => { guardOut += d; });
  await new Promise((res) => guard.on('exit', res));
  const g = (() => { try { return JSON.parse(guardOut.trim().split('\n').pop()); } catch { return null; } })();
  expect('URL guard without test flag rejects loopback forms', g && g.rejected === g.total, guardOut.slice(0, 200));

  // ---- Supabase failure modes -----------------------------------------------------------
  await mock('/__mock/mode', { mode: 'error500' });
  r = await api('/api/airreach/scans', { method: 'POST', body: buildScanPayload() });
  expect('Supabase 500 → 503 dependency_unavailable', r.status === 503 && r.json?.error?.code === 'dependency_unavailable', `status=${r.status}`);
  expect('503 does not leak upstream body', !r.text.includes('upstream error') && !r.text.includes('<html>'));
  await mock('/__mock/mode', { mode: 'hang' });
  t0 = Date.now();
  r = await api('/api/airreach/scans', { method: 'POST', body: buildScanPayload() });
  expect('Supabase hang → 503 within timeout', r.status === 503 && Date.now() - t0 < 6000, `status=${r.status} ms=${Date.now() - t0}`);
  await mock('/__mock/mode', { mode: 'ok' });
  await stopMock();
  r = await api('/api/airreach/scans', { method: 'POST', body: buildScanPayload() });
  expect('Supabase down → 503', r.status === 503 && r.json?.error?.code === 'dependency_unavailable', `status=${r.status}`);
  r = await api(`/api/airreach/shared-scans/?shareToken=${encodeURIComponent(token)}`);
  expect('GET while Supabase down → 503', r.status === 503, `status=${r.status}`);
  mockProc = start('mock', 'mock-supabase.mjs', { MOCK_PORT: String(MOCK_PORT), MOCK_SERVICE_KEY: SERVICE_KEY });
  expect('mock restarted', await waitFor(`${MOCK}/__mock/state`, 10000));
  r = await api('/api/airreach/scans', { method: 'POST', body: buildScanPayload() });
  expect('recovers after Supabase is back → 201', r.status === 201, `status=${r.status}`);
  if (r.json?.shareToken) issuedTokens.push(r.json.shareToken);

  // ---- leakage ----------------------------------------------------------------------------
  st = await mock('/__mock/state');
  expect('no table access across the whole run', st.forbiddenPaths.length === 0, JSON.stringify(st.forbiddenPaths));
  await sleep(300);
  expect('api logs never contain the service key', !serverOutput.includes(SERVICE_KEY));
  expect('api logs never contain an issued shareToken', issuedTokens.every((t) => !serverOutput.includes(t)));
  expect('api logs never contain the token hash', !serverOutput.includes(hash));
  expect('api logs never contain payload text', !serverOutput.includes('Example Site') && !serverOutput.includes(payload.scan.keyword));
  expect('api logs never contain shared-scans token (path or query)', !/shared-scans\/[A-Za-z0-9_-]{43}/.test(serverOutput) && !/shareToken=/.test(serverOutput));
  expect('api logs never contain target URL query', !serverOutput.includes('secret123'));

  await mock('/__mock/reset', {});
  st = await mock('/__mock/state');
  expect('test data removed from mock', st.scans.length === 0 && st.sites.length === 0);
} catch (err) {
  record('unexpected exception', false, String(err && err.stack || err));
}

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log('FAILED:'); for (const f of failed) console.log(' -', f.name, f.detail); console.log('\n[api output tail]\n' + serverOutput.slice(-1500)); }
await shutdown(failed.length ? 1 : 0);
