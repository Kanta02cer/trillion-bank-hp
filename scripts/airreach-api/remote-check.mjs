/**
 * デプロイ済み AirReach API（Preview / Production）に対する実環境チェック。
 *   node scripts/airreach-api/remote-check.mjs https://<deployment-host>
 * 本物の Supabase に 1 件保存する（削除は Supabase 側で別途行う）。鍵は不要。
 * 出力に shareToken は出さない（末尾 6 文字だけ）。結果 JSON を scripts/airreach-api/out/remote-<ts>.json に保存する。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScanPayload } from './fixture.mjs';

const BASE = (process.argv[2] || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(BASE)) { console.error('usage: node remote-check.mjs https://host'); process.exit(2); }
const DIR = path.dirname(fileURLToPath(import.meta.url));
const results = [];
const record = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass || !detail ? '' : '  — ' + detail}`); };
const expect = (name, cond, detail = '') => record(name, !!cond, detail);

async function sha256Hex(s) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Buffer.from(d).toString('hex'); }
async function call(p, { method = 'GET', body, headers = {}, origin = null } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  let payload;
  if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await fetch(BASE + p, { method, headers: h, body: payload, redirect: 'manual' });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, headers: res.headers, text, json };
}

const summary = { base: BASE, startedAt: new Date().toISOString() };
try {
  // 1. health
  let r = await call('/api/airreach/health/');
  expect('1 GET /api/airreach/health/ → 200', r.status === 200 && r.json?.ok === true, `status=${r.status} ${r.text.slice(0, 120)}`);
  expect('health: no env / runtime details exposed', r.json?.config === undefined && r.json?.runtime === undefined, r.text.slice(0, 160));
  expect('health: no-store + nosniff', r.headers.get('cache-control') === 'no-store' && r.headers.get('x-content-type-options') === 'nosniff');
  r = await call('/api/airreach/health');
  expect('trailingSlash: /health → 308 to /health/', r.status === 308 && /\/api\/airreach\/health\/$/.test(r.headers.get('location') || ''), `status=${r.status} loc=${r.headers.get('location')}`);

  // 2. fetch
  const fx = (u, o = {}) => call(`/api/airreach/fetch/?url=${encodeURIComponent(u)}`, o);
  r = await fx('https://example.com/');
  expect('2 fetch https://example.com/ → 200', r.status === 200 && /Example Domain/.test(r.text), `status=${r.status} ${r.text.slice(0, 120)}`);
  expect('2 fetch: X-AirReach-Final-URL exposed', r.headers.get('x-airreach-final-url') === 'https://example.com/' && /X-AirReach-Final-URL/i.test(r.headers.get('access-control-expose-headers') || ''), `final=${r.headers.get('x-airreach-final-url')}`);
  r = await fx('https://trillion-bank.jp/airreach');
  expect('2 fetch redirect (/airreach → /airreach/) → final URL differs', r.status === 200 && r.headers.get('x-airreach-final-url') === 'https://trillion-bank.jp/airreach/', `status=${r.status} final=${r.headers.get('x-airreach-final-url')}`);
  r = await fx('https://trillion-bank.jp/robots.txt');
  expect('2 fetch robots.txt → 200 text', r.status === 200 && /User-agent/i.test(r.text), `status=${r.status}`);
  r = await fx('https://trillion-bank.jp/definitely-missing-page-airreach-check');
  expect('2 fetch 404 passthrough (empty body)', r.status === 404 && r.text === '', `status=${r.status} len=${r.text.length}`);
  for (const bad of [
    'http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://192.168.1.1/', 'http://metadata.google.internal/', 'http://localtest.me/',
    'http://[::ffff:127.0.0.1]/', 'http://[::ffff:10.0.0.1]/', 'http://[::ffff:192.168.1.1]/', 'http://[::1]/', 'http://[fe80::1]/', 'http://[fc00::1]/', 'http://[fd00::1]/', 'http://[ff02::1]/',
    'http://[::ffff:7f00:1]/', 'http://[::]/', 'http://[2001:db8::1]/', 'http://[64:ff9b::7f00:1]/', 'http://[2002:c0a8:101::1]/',
  ]) {
    r = await fx(bad);
    expect(`2 fetch SSRF ${bad} → 400`, r.status === 400 && r.json?.error?.code === 'bad_request', `status=${r.status} ${r.text.slice(0, 100)}`);
  }
  r = await call('/api/airreach/fetch/');
  expect('2 fetch without url → 400', r.status === 400, `status=${r.status}`);
  r = await fx('https://8.8.8.8/');
  expect('2 fetch public IPv4 literal https://8.8.8.8/ → not rejected by guard', r.status !== 400, `status=${r.status}`);
  r = await fx('https://[2606:4700:4700::1111]/');
  expect(`2 fetch public IPv6 literal → not rejected by guard (status ${r.status}; 502 means no IPv6 egress on the platform)`, r.status !== 400, `status=${r.status}`);
  r = await fx('https://ipv6.google.com/');
  expect(`2 fetch AAAA-only host ipv6.google.com → not rejected by guard (status ${r.status})`, r.status !== 400, `status=${r.status} ${r.text.slice(0, 80)}`);

  // 3. save
  const payload = buildScanPayload({ url: 'https://example.com/' });
  r = await call('/api/airreach/scans/', { method: 'POST', body: payload });
  expect('3 POST /api/airreach/scans/ → 201', r.status === 201 && r.json?.ok === true, `status=${r.status} ${r.text.slice(0, 200)}`);
  const token = r.json?.shareToken || '';
  expect('3 shareToken returned (43 chars base64url)', /^[A-Za-z0-9_-]{43}$/.test(token), `${token.length} chars`);
  expect('3 scanId returned', r.json?.scanId === payload.scan.id);
  summary.scanId = payload.scan.id;
  summary.shareTokenHash = token ? await sha256Hex(token) : null;
  summary.tokenTail = token ? token.slice(-6) : null;

  // 4. shared
  r = await call(`/api/airreach/shared-scans/?shareToken=${encodeURIComponent(token)}`);
  expect('4 GET shared-scans/?shareToken= → 200', r.status === 200 && r.json?.ok === true, `status=${r.status} ${r.text.slice(0, 160)}`);
  expect('4 factors 4 / checks 18 / sources 3', r.json?.factors?.length === 4 && r.json?.checks?.length === 18 && r.json?.sources?.length === 3);
  expect('4 scan.id matches and overall present', r.json?.scan?.id === payload.scan.id && r.json?.result?.overall === payload.result.overall);
  expect('4 share_token_hash not in response', !r.text.includes('share_token_hash') && !(summary.shareTokenHash && r.text.includes(summary.shareTokenHash)));
  expect('4 no-store', r.headers.get('cache-control') === 'no-store');

  // 5. duplicate
  r = await call('/api/airreach/scans/', { method: 'POST', body: payload });
  expect('5 same scanId → 409', r.status === 409 && r.json?.error?.code === 'conflict', `status=${r.status} ${r.text.slice(0, 120)}`);
  expect('5 409 has no shareToken', !r.text.includes('shareToken'));

  // 6. bad token
  const wrong = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  r = await call(`/api/airreach/shared-scans/?shareToken=${wrong}`);
  expect('6 wrong shareToken → 404', r.status === 404 && r.json?.error?.code === 'not_found', `status=${r.status}`);
  r = await call('/api/airreach/shared-scans/?shareToken=abc');
  expect('6 malformed token → 404', r.status === 404, `status=${r.status}`);
  r = await call(`/api/airreach/shared-scans/?shareToken=${payload.scan.id}`);
  expect('6 scanId as token → 404', r.status === 404, `status=${r.status}`);

  // extra: method / origin
  r = await call('/api/airreach/scans/');
  expect('GET /api/airreach/scans/ → 405', r.status === 405, `status=${r.status}`);
  r = await call('/api/airreach/scans/', { method: 'POST', body: buildScanPayload(), origin: 'https://evil.example' });
  expect('POST from disallowed Origin → 403', r.status === 403 && r.json?.error?.code === 'origin_not_allowed', `status=${r.status}`);
  r = await call('/api/airreach/scans/', { method: 'POST', body: { scan: {} } });
  expect('POST missing result → 400', r.status === 400, `status=${r.status}`);
} catch (err) {
  record('unexpected exception', false, String(err && err.stack || err));
}
summary.finishedAt = new Date().toISOString();
summary.results = results;
await mkdir(path.join(DIR, 'out'), { recursive: true });
const file = path.join(DIR, 'out', `remote-${Date.now()}.json`);
await writeFile(file, JSON.stringify(summary, null, 2));
const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed  (saved ${path.relative(process.cwd(), file)})`);
if (failed.length) { console.log('FAILED:'); for (const f of failed) console.log(' -', f.name, f.detail); }
process.exit(failed.length ? 1 : 0);
