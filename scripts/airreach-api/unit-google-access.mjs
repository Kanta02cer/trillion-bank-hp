/**
 * Google OAuth の審査対応（サーバー側）の単体テスト。実際の Google・AI・Supabase には接続しない（fetch をモックする）。
 *   1. Google 連携は、社内スタッフか契約中の顧客のメンバーだけ（ログインしていない・契約していない人は Google に触れない）
 *   2. 計測 API は、確定した質問だけを外部の AI に送る。Search Console 由来・未確定の質問が1問でもあれば、どの AI にも送らない
 *   node scripts/airreach-api/unit-google-access.mjs
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = async (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const auth = (await imp('api/google/auth.js')).default;
const gsc = (await imp('api/google/gsc.js')).default;
const ga4 = (await imp('api/google/ga4.js')).default;
const inspect = (await imp('api/google/url-inspection.js')).default;
const M = await imp('api/hack2-measure.js');

const results = [];
const expect = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(detail).slice(0, 300)}`); };

process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'https://trillion-bank.jp/api/google/callback';
process.env.SUPABASE_URL = 'https://sb.test';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';
const STAFF = 'staff-token-0123456789abcdef', MEMBER = 'member-token-0123456789abcdef', OUTSIDER = 'outsider-token-0123456789abcdef';
const CLIENT = '59824617-70f0-4a9d-a52e-d6353910f3e5';

// 外への通信を全部記録する。Supabase の RPC（使ってよい人か）だけ答え、それ以外（Google・AI）は記録して失敗させる
let outbound = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u === 'https://sb.test/rest/v1/rpc/airreach_google_access') {
    const tok = String((init.headers || {}).Authorization || '').replace(/^Bearer /, '');
    const cid = JSON.parse(init.body || '{}').p_client_id;
    const data = tok === STAFF ? { allowed: true, role: 'staff' } : (tok === MEMBER && cid === CLIENT) ? { allowed: true, role: 'member' } : { allowed: false, reason: 'not_contracted' };
    return { ok: true, status: 200, json: async () => data };
  }
  outbound.push(u);
  return { ok: false, status: 599, json: async () => ({}), text: async () => '' };
};
function mkReq({ method = 'POST', query = {}, body, cookie = '', token } = {}) {
  return { method, query, body, headers: { host: 'trillion-bank.jp', cookie, 'x-forwarded-proto': 'https', ...(token ? { authorization: 'Bearer ' + token } : {}) } };
}
function mkRes() {
  const r = { statusCode: 200, headers: {}, body: undefined };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.send = (o) => { r.body = o; return r; };
  r.writeHead = (c, h = {}) => { r.statusCode = c; Object.entries(h).forEach(([k, v]) => r.setHeader(k, v)); return r; };
  r.end = (b) => { if (b !== undefined && r.body === undefined) { try { r.body = JSON.parse(b); } catch (e) { r.body = b; } } };
  return r;
}
const call = async (h, req) => { const res = mkRes(); await h(req, res); return res; };
const google = () => outbound.filter((u) => /google(apis)?\.com/.test(u));

// ---- 1. Google 連携を使ってよい人 -----------------------------------------------------
const ck = 'airreach_google_access=AT; airreach_google_refresh=RT';
const gscBody = { siteUrl: 'sc-domain:example.com', startDate: '2026-09-01', endDate: '2026-09-28' };
const ga4Body = { propertyId: '123456789', siteUrl: 'https://example.com/', startDate: '2026-09-01', endDate: '2026-09-28' };
for (const [name, h, body] of [['gsc', gsc, gscBody], ['ga4', ga4, ga4Body], ['url-inspection', inspect, { siteUrl: 'sc-domain:example.com', inspectionUrl: 'https://example.com/' }]]) {
  outbound = [];
  let r = await call(h, mkReq({ body, cookie: ck }));
  expect(`${name}: ログインしていない → 401（Google のトークンの Cookie があっても）`, r.statusCode === 401 && r.body.code === 'login_required', JSON.stringify(r.body));
  r = await call(h, mkReq({ body, cookie: ck, token: OUTSIDER }));
  expect(`${name}: 契約していない人 → 403`, r.statusCode === 403 && r.body.code === 'not_contracted', JSON.stringify(r.body));
  expect(`${name}: どちらも Google に問い合わせない`, google().length === 0, google().join(','));
  r = await call(h, mkReq({ method: 'GET', query: {}, cookie: ck }));
  expect(`${name}: 一覧（GET）もログインが要る`, r.statusCode === 401);
}
outbound = [];
const { cookieNames } = await imp('api/google/_lib/token.js');
let r = await call(gsc, mkReq({ body: { ...gscBody, clientId: CLIENT }, cookie: `${cookieNames(CLIENT).access}=AT`, token: MEMBER }));
expect('gsc: 契約中の顧客のメンバーは、自社の顧客 ID なら Google に問い合わせる', google().length > 0 && r.statusCode !== 401 && r.statusCode !== 403, r.statusCode);
outbound = [];
r = await call(gsc, mkReq({ body: { ...gscBody, clientId: '00000000-0000-0000-0000-000000000000' }, cookie: ck, token: MEMBER }));
expect('gsc: 契約中の顧客のメンバーでも、他社の顧客 ID では 403・Google に問い合わせない', r.statusCode === 403 && google().length === 0);
outbound = [];
r = await call(auth, mkReq({ body: { consent: true, back: 'app', client: CLIENT }, token: STAFF }));
const cookies = [].concat(r.headers['set-cookie'] || []);
expect('auth: 顧客の画面から始めると、戻り先（back）の Cookie が付く', r.statusCode === 200 && cookies.some((c) => c.startsWith(`airreach_google_back=app:${CLIENT};`)), cookies.join(' | '));
expect('auth: 開始では Google に通信しない（URL を返すだけ）', outbound.length === 0, outbound.join(','));
r = await call(auth, mkReq({ body: { consent: 'yes' }, token: STAFF }));
expect('auth: 同意は true のときだけ（"yes" などは不可）', r.statusCode === 400 && r.body.code === 'consent_required');
outbound = [];
r = await call(auth, mkReq({ query: { disconnect: '1' }, cookie: ck }));
expect('auth: 切断はログインなしでもできる（自分のブラウザの接続を消して Google の許可を取り消す）', r.statusCode === 200 && outbound.some((u) => u.startsWith('https://oauth2.googleapis.com/revoke')));

// ---- 2. 外部の AI に送る質問 ------------------------------------------------------------
const P = M.promptPolicyError;
expect('policy: 確定した質問だけなら通す', P([{ prompt: 'a', confirmed: true, origin: 'manual' }, { prompt: 'b', confirmed: true, origin: 'branded' }]) === null);
expect('policy: 確定していない質問があれば断る', (P([{ prompt: 'a', confirmed: true }, { prompt: 'b' }]) || {}).code === 'prompt_not_confirmed');
expect('policy: 文字列だけの質問（確定の印なし）は断る', (P(['渋谷 美容室']) || {}).code === 'prompt_not_confirmed');
expect('policy: Search Console 由来（origin: gsc）は確定でも断る', (P([{ prompt: 'a', confirmed: true, origin: 'gsc' }]) || {}).code === 'google_data_not_allowed');
expect('policy: google: true の質問は確定でも断る', (P([{ prompt: 'a', confirmed: true, google: true }]) || {}).code === 'google_data_not_allowed');

process.env.PERPLEXITY_API_KEY = 'test'; process.env.OPENAI_API_KEY = 'test'; process.env.ANTHROPIC_API_KEY = 'test';
process.env.GEMINI_API_KEY = 'test'; process.env.SERPAPI_API_KEY = 'test'; process.env.AI_GATEWAY_API_KEY = 'test'; process.env.TYPESAFE_API_KEY = 'test';
delete process.env.AIRREACH_STUDIO_KEY;
const ALL = ['jev', 'chatgpt', 'chatgpt_search', 'claude', 'perplexity', 'gemini', 'google_aio', 'google_ai_mode'];
const AI = /openai\.com|anthropic\.com|perplexity\.ai|generativelanguage|serpapi\.com|ai-gateway|typesafe\.ai/;
for (const [name, prompts, code] of [
  ['Search Console 由来の質問が1問まじる', [{ keyword: 'a', prompt: '確定した質問', confirmed: true, origin: 'manual' }, { keyword: '町田 焼肉 個室', prompt: '「町田 焼肉 個室」でおすすめのところを教えて', confirmed: true, origin: 'gsc' }], 'google_data_not_allowed'],
  ['未確定の質問が1問まじる', [{ keyword: 'a', prompt: '確定した質問', confirmed: true }, { keyword: 'b', prompt: '自動で作った候補', origin: 'keyword' }], 'prompt_not_confirmed'],
  ['以前の形（文字列だけ）', ['渋谷 美容室 おすすめ'], 'prompt_not_confirmed']
]) {
  outbound = [];
  const res = { headers: {}, statusCode: 0, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b || ''; } };
  await M.default({ method: 'POST', headers: {}, body: { brand: 'Hana', url: 'https://hana.example/', text: '本文', prompts, engines: ALL } }, res);
  const out = JSON.parse(res.body || '{}');
  expect(`measure API: ${name} → 400 ${code}`, res.statusCode === 400 && out.code === code, res.statusCode + ' ' + res.body);
  expect(`measure API: ${name} → どの外部 AI にも送らない（8種類すべて）`, !outbound.some((u) => AI.test(u)), outbound.join(','));
}

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
