// お客様が自分で取り込む Google の数字：サーバーが Google から読んだ数字だけを、サーバーが保存する（通信はすべて偽物）
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, got === undefined ? '' : JSON.stringify(got).slice(0, 400)); } };
process.env.SUPABASE_URL = 'https://fake-project.supabase.example';
process.env.SUPABASE_ANON_KEY = 'anon-test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test';
const S = await import(pathToFileURL(path.join(ROOT, 'api/google/_lib/save.js')).href);
const G = (await import(pathToFileURL(path.join(ROOT, 'api/google/gsc.js')).href)).default;
const C = '0f1e2d3c-4b5a-4968-8776-655443322110', KEY = C.replace(/-/g, '');
const jwt = 'x.' + Buffer.from(JSON.stringify({ email: 'Owner@Sample-Salon.example' })).toString('base64url') + '.y';
t('月の始まり（YYYY-MM-01）', S.periodOf('2026-10-09') === '2026-10-01' && S.periodOf('x') === '');
t('ログインのトークンのメール（小文字）', S.jwtEmail({ headers: { authorization: 'Bearer ' + jwt } }) === 'owner@sample-salon.example');
let calls = [];
const fakeFetch = (handlers) => async (u, o) => { u = String(u); calls.push({ u, o }); for (const [re, fn] of handlers) if (re.test(u)) return fn(u, o); return { ok: false, status: 404, json: async () => ({}) }; };
// saveTraffic：理由の言い分け・鍵が無いとき
globalThis.fetch = fakeFetch([[/airreach_save_google_traffic/, async () => ({ ok: true, status: 200, json: async () => ({ ok: false, reason: 'site_mismatch' }) })]]);
let r = await S.saveTraffic({ clientId: C, period: '2026-10-01', source: 'gsc_api', metrics: {}, savedBy: 'x' });
t('別のサイトは 409・理由を言う', !r.ok && r.status === 409 && /登録したサイトと違う/.test(r.error), r);
r = await S.saveTraffic({ clientId: C, period: '2026-10-01', source: 'gsc_api', metrics: {} }, { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: '' });
t('サーバーの鍵が無ければ保存しない（503）', !r.ok && r.status === 503, r);
// エンドポイント：お客様（member）が保存つきで取り込む。画面から送った数字（clicks: 9999）は使わない
calls = [];
globalThis.fetch = fakeFetch([
  [/airreach_google_access/, async () => ({ ok: true, status: 200, json: async () => ({ allowed: true, role: 'member' }) })],
  [/searchAnalytics\/query/, async () => ({ ok: true, status: 200, json: async () => ({ rows: [{ keys: ['2026-10-01'], clicks: 5, impressions: 100, position: 3 }, { keys: ['2026-10-02'], clicks: 7, impressions: 140, position: 4 }] }) })],
  [/airreach_save_google_traffic/, async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })]]);
const res = () => { const o = { code: 0, body: null, headers: {} }; o.status = (c) => { o.code = c; return o; }; o.json = (b) => { o.body = b; return o; }; o.setHeader = (k, v) => { o.headers[k] = v; }; o.end = () => o; o.writeHead = (c) => { o.code = c; return o; }; return o; };
const req = (body) => ({ method: 'POST', headers: { origin: 'https://trillion-bank.jp', authorization: 'Bearer ' + jwt, cookie: `airreach_g_${KEY}_a=goog-token; airreach_g_${KEY}_e=owner%40sample-salon.example` }, query: {}, body });
let o = res();
await G(req({ clientId: C, siteUrl: 'sc-domain:sample-salon.example', startDate: '2026-10-01', endDate: '2026-10-09', totalsOnly: true, save: true, clicks: 9999, metrics: { clicks: 9999 } }), o);
const saveCall = calls.find((c) => /airreach_save_google_traffic/.test(c.u));
const sent = saveCall ? JSON.parse(saveCall.o.body) : {};
t('保存つき：200・saved', o.code === 200 && o.body.saved === true, o);
t('サーバーが Google から読んだ合計を保存する（画面から送った 9999 は使わない）', sent.p_metrics && sent.p_metrics.clicks === 12 && sent.p_metrics.impressions === 240 && sent.p_metrics.property === 'sc-domain:sample-salon.example', sent.p_metrics);
t('保存の相手は顧客・月・種類・保存した人（ログインのメール）', sent.p_client_id === C && sent.p_period_month === '2026-10-01' && sent.p_source === 'gsc_api' && sent.p_saved_by === 'owner@sample-salon.example' && sent.p_metrics.google_email === 'owner@sample-salon.example');
t('保存はサーバーの鍵で、DB の決まった関数だけを呼ぶ', saveCall && saveCall.o.headers.Authorization === 'Bearer service-test' && /\/rest\/v1\/rpc\/airreach_save_google_traffic$/.test(saveCall.u));
t('応答に鍵を出さない', !JSON.stringify(o.body).includes('service-test'));
// 保存つきでも、語句ごとの取り込み（totalsOnly なし）は受け付けない
calls = []; o = res();
await G(req({ clientId: C, siteUrl: 'sc-domain:sample-salon.example', startDate: '2026-10-01', endDate: '2026-10-09', save: true }), o);
t('保存は月の合計だけ（語句ごとは 400・保存しない）', o.code === 400 && !calls.some((c) => /airreach_save_google_traffic/.test(c.u)), o);
// 保存つきでない担当者の取り込みは今までどおり（保存しない）
calls = []; o = res();
await G(req({ clientId: C, siteUrl: 'sc-domain:sample-salon.example', startDate: '2026-10-01', endDate: '2026-10-09', totalsOnly: true }), o);
t('保存なしの取り込みは今までどおり（DB に書かない）', o.code === 200 && o.body.totals && !calls.some((c) => /airreach_save_google_traffic/.test(c.u)), o);
// ログインしていない・契約していないと、Google にも DB にも行かない
calls = [];
globalThis.fetch = fakeFetch([[/airreach_google_access/, async () => ({ ok: true, status: 200, json: async () => ({ allowed: false, reason: 'not_contracted' }) })]]);
o = res();
// 確認の結果は5分覚えるので、別の人（別のトークン）で確かめる
const jwt2 = 'x.' + Buffer.from(JSON.stringify({ email: 'stranger@example.invalid' })).toString('base64url') + '.z';
const r2 = req({ clientId: C, siteUrl: 'sc-domain:sample-salon.example', startDate: '2026-10-01', endDate: '2026-10-09', totalsOnly: true, save: true }); r2.headers.authorization = 'Bearer ' + jwt2;
await G(r2, o);
t('契約していない人は 403・Google にも保存にも行かない', o.code === 403 && !calls.some((c) => /searchconsole|airreach_save/.test(c.u)), o);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
