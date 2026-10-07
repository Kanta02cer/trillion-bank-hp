// Gemini のモデル：既定のモデルと、使えなくなったときに案内されたモデルで1回だけ聞き直すこと（ネットワークは偽物）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const M = await import(path.join(ROOT, 'api/hack2-measure.js'));
let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, JSON.stringify(got)); } };
const MSG = 'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features and improvements.';
t('既定のモデルは gemini-2.5-flash ではない', M.GEMINI_DEFAULT_MODEL !== 'gemini-2.5-flash', M.GEMINI_DEFAULT_MODEL);
t('案内されたモデル名を読む', M.geminiSuggestedModel(MSG) === 'gemini-3.8-flash', M.geminiSuggestedModel(MSG));
t('案内が無ければ null', M.geminiSuggestedModel('quota exceeded') === null);
const calls = [];
const real = globalThis.fetch;
globalThis.fetch = async (url) => {
  const m = /models\/([^:]+):/.exec(String(url)); calls.push(m && decodeURIComponent(m[1]));
  if (calls.length === 1) return new Response(JSON.stringify({ error: { message: MSG } }), { status: 404 });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'サンプル社が対応しています' }] } }] }), { status: 200 });
};
const out = await M.callGemini('k', 'q', 'gemini-2.5-flash');
t('使えないモデル→案内されたモデルで1回だけ聞き直す', JSON.stringify(calls) === JSON.stringify(['gemini-2.5-flash', 'gemini-3.8-flash']), calls);
t('使ったモデルを返す', out.model_used === 'gemini-3.8-flash' && /サンプル社/.test(out.answer), out);
calls.length = 0;
globalThis.fetch = async (url) => { calls.push(String(url)); return new Response(JSON.stringify({ error: { message: MSG } }), { status: 404 }); };
let err = '';
await M.callGemini('k', 'q', 'gemini-2.5-flash').catch((e) => { err = e.message; });
t('案内されたモデルも使えなければ、聞き直しは1回で止めて失敗にする', calls.length === 2 && /no longer available/.test(err), { n: calls.length, err });
// 時間切れ：Gemini が答えないときは持ち時間内に日本語の失敗で返す（他の AI を待たせない）
t('Gemini の持ち時間は他の AI より短い', M.ENGINE_BUDGET_MS.gemini > 0 && M.ENGINE_BUDGET_MS.gemini <= 90000 && M.GEMINI_TIMEOUT_MS <= 45000, { b: M.ENGINE_BUDGET_MS, t: M.GEMINI_TIMEOUT_MS });
globalThis.fetch = async (url, init) => new Promise((res, rej) => { init.signal.addEventListener('abort', () => rej(init.signal.reason)); });
const origTimeout = AbortSignal.timeout;
AbortSignal.timeout = () => origTimeout.call(AbortSignal, 50);
err = '';
const t1 = Date.now();
const keep = setTimeout(() => {}, 5000); // AbortSignal.timeout のタイマーはプロセスを生かさないので、待つ間だけ生かす
await M.callGemini('k', 'q', 'gemini-x').catch((e) => { err = e.message; });
AbortSignal.timeout = origTimeout;
clearTimeout(keep);
t('答えないときは時間切れの失敗（日本語・[timeout]）で早く返す', /時間切れ/.test(err) && /\[timeout\]/.test(err), { err, ms: Date.now() - t1 });
// 429 の中身：無料枠0・1日の上限は聞き直さない（[rate limit] を付けない）。1分あたりだけ待って聞き直す
const Q = (v, msg, delay) => ({ error: { code: 429, message: msg || 'Quota exceeded', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: v }].concat(delay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: delay }] : []) } });
const z = M.geminiQuotaError(Q([{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '0' }], 'You exceeded your current quota... limit: 0'));
t('429：無料枠の回数0は支払いの設定が必要と伝え、聞き直さない', /0回/.test(z) && /\[quota_zero\]/.test(z) && !/rate limit/.test(z) && M.rateLimitWait(new Error(z)) === null, z);
const dd = M.geminiQuotaError(Q([{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }]));
t('429：1日の上限は明日と伝え、聞き直さない', /1日/.test(dd) && M.rateLimitWait(new Error(dd)) === null, dd);
const mm = M.geminiQuotaError(Q([{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '10' }], 'x', '12s'));
t('429：1分あたりは待ち時間つきで聞き直す・どの上限かを書く', /12秒/.test(mm) && /PerMinute/.test(mm) && M.rateLimitWait(new Error(mm)) === 13000, mm);
const raw = M.geminiQuotaError({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Resource has been exhausted (e.g. check quota).' } });
t('429：詳細が無いときは Google の状態と本文を添え、待って聞き直す', /RESOURCE_EXHAUSTED/.test(raw) && /Resource has been exhausted/.test(raw) && M.rateLimitWait(new Error(raw)) === 31000, raw);
globalThis.fetch = real;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
