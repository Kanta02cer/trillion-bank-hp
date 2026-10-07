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
globalThis.fetch = real;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
