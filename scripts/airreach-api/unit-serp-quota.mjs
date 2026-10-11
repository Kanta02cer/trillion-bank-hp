// SerpApi の契約と残り回数の確認（action: quota）：鍵・メール・アカウント ID を返さない・検索をしない・社内の人だけ。ネットワークなし
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, got === undefined ? '' : JSON.stringify(got)); } };
const M = await import(pathToFileURL(path.join(ROOT, 'api/hack2-measure.js')).href);
const { serpQuota, serpQuotaView } = M;
const handler = M.default;
const KEY = 'test-key-0123456789abcdef';
const ACCOUNT = { account_id: 'acc-999', api_key: KEY, account_email: 'someone@example.com', plan_id: 'sample', plan_name: 'Sample Plan', plan_monthly_price: 75.0,
  searches_per_month: 5000, plan_searches_left: 4890, extra_credits: 0, total_searches_left: 4890, this_month_usage: 110, this_hour_searches: 2, account_rate_limit_per_hour: 1000 };
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const NOW = () => '2026-10-11T00:00:00.000Z';

// 見せる項目
const v = serpQuotaView(ACCOUNT, NOW());
t('プラン名・月額・月の回数・残り・今月の使用を返す', v.plan_name === 'Sample Plan' && v.plan_monthly_price === 75 && v.searches_per_month === 5000 && v.total_searches_left === 4890 && v.plan_searches_left === 4890 && v.this_month_usage === 110 && v.extra_credits === 0, v);
t('鍵・メール・アカウント ID を返さない', !/test-key|example\.com|acc-999/.test(JSON.stringify(v)) && !('api_key' in v) && !('account_email' in v) && !('account_id' in v), v);
t('決まった項目だけ（知らない項目を素通ししない）', Object.keys(v).sort().join() === 'checked_at,configured,extra_credits,ok,plan_monthly_price,plan_name,plan_searches_left,searches_per_month,this_month_usage,total_searches_left', Object.keys(v));
const odd = serpQuotaView({ plan_name: 123, total_searches_left: '4890', searches_per_month: NaN }, NOW());
t('形の違う値は null（数字に読み替えない＝未確認を0や推測にしない）', odd.plan_name === null && odd.total_searches_left === null && odd.searches_per_month === null, odd);
t('空の応答でも落ちない', serpQuotaView(null, NOW()).total_searches_left === null);

// 取りに行く先
const calls = [];
const okFetch = async (u) => { calls.push(String(u)); return resp(200, ACCOUNT); };
const q = await serpQuota(KEY, okFetch, NOW);
t('Account API を1回だけ呼ぶ（検索の API は呼ばない＝回数を使わない）', calls.length === 1 && calls[0].startsWith('https://serpapi.com/account.json?') && !calls[0].includes('search.json'), calls.map((c) => c.split('?')[0]));
t('取れたら ok・残りを返す', q.ok === true && q.configured === true && q.total_searches_left === 4890 && q.checked_at === NOW(), q);
t('応答に鍵を入れない（成功）', !JSON.stringify(q).includes(KEY));
let n = 0;
const none = await serpQuota('', async () => { n++; return resp(200, ACCOUNT); }, NOW);
t('鍵が無ければ通信しない・未設定と返す', n === 0 && none.configured === false && none.ok === false, none);
const bad = await serpQuota(KEY, async () => resp(401, { error: 'Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key ' + KEY }), NOW);
t('鍵が無効：失敗として返す・SerpApi の本文は返さない・鍵を入れない', bad.ok === false && bad.status === 401 && bad.total_searches_left === undefined && !JSON.stringify(bad).includes(KEY), bad);
const err200 = await serpQuota(KEY, async () => resp(200, { error: 'something' }), NOW);
t('200 でも error があれば失敗（残りを0や満額と見なさない）', err200.ok === false && !('total_searches_left' in err200), err200);
const down = await serpQuota(KEY, async () => { throw new Error('boom ' + KEY); }, NOW);
t('通信の失敗：失敗として返す・例外の文を返さない', down.ok === false && !JSON.stringify(down).includes(KEY) && !/boom/.test(JSON.stringify(down)), down);

// 入口：社内の人だけ・ブランドや質問が無くても使える・AI に聞かない
function call(body, headers = {}) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, val) { this.headers[k] = val; }, end(x) { resolve({ status: this.statusCode, body: x ? JSON.parse(x) : null }); } };
    handler({ method: 'POST', headers, body }, res);
  });
}
const saved = { f: globalThis.fetch, k1: process.env.SERPAPI_API_KEY, k2: process.env.SERPAPI_KEY, sk: process.env.AIRREACH_STUDIO_KEY, su: process.env.SUPABASE_URL };
const seen = [];
globalThis.fetch = async (u) => { seen.push(String(u)); return resp(200, ACCOUNT); };
process.env.SERPAPI_API_KEY = KEY; delete process.env.SERPAPI_KEY; process.env.AIRREACH_STUDIO_KEY = 'studio-secret-xyz'; delete process.env.SUPABASE_URL;
const no = await call({ action: 'quota' }, {});
t('ログインも社内キーも無ければ断る・SerpApi に行かない', no.status === 401 && no.body.code === 'staff_login_required' && seen.length === 0, { no, seen: seen.length });
const yes = await call({ action: 'quota' }, { 'x-airreach-key': 'studio-secret-xyz' });
t('社内の人：残りを返す（brand・質問は要らない）', yes.status === 200 && yes.body.action === 'quota' && yes.body.serpapi.total_searches_left === 4890, yes);
t('入口でも Account API だけ・1回だけ', seen.length === 1 && seen[0].startsWith('https://serpapi.com/account.json?'), seen.map((c) => c.split('?')[0]));
t('入口の応答に鍵・メール・アカウント ID が無い', !/test-key|example\.com|acc-999|studio-secret/.test(JSON.stringify(yes.body)), yes.body);
const origin = await call({ action: 'quota' }, { 'x-airreach-key': 'studio-secret-xyz', origin: 'https://evil.example' });
t('許可していないサイトからは断る', origin.status === 403 && seen.length === 1, origin);
const normal = await call({}, { 'x-airreach-key': 'studio-secret-xyz' });
t('action が無い要求は今までどおり（brand が必要）', normal.status === 400 && /brand/.test(normal.body.error) && seen.length === 1, normal);
globalThis.fetch = saved.f;
for (const [k, val] of [['SERPAPI_API_KEY', saved.k1], ['SERPAPI_KEY', saved.k2], ['AIRREACH_STUDIO_KEY', saved.sk], ['SUPABASE_URL', saved.su]]) { if (val === undefined) delete process.env[k]; else process.env[k] = val; }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
