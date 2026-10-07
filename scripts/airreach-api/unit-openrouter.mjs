// OpenRouter での計測（ChatGPT の検索・Claude・Gemini）。本物の OpenRouter には送らない（偽の fetch）
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
const expect = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(detail).slice(0, 300)}`); };
const M = await import(pathToFileURL(path.join(ROOT, 'api/hack2-measure.js')).href);

// 送る中身
const b = M.openRouterBody('gemini', '渋谷でおすすめの美容室は？');
expect('Gemini は google/gemini-2.5-flash', b.model === 'google/gemini-2.5-flash');
expect('ChatGPT（検索あり）は openai/gpt-5-mini・Claude は anthropic/claude-haiku-4.5', M.openRouterModel('chatgpt_search') === 'openai/gpt-5-mini' && M.openRouterModel('claude') === 'anthropic/claude-haiku-4.5');
expect('各社の本来の検索を1回だけ（plugins web・engine native）', JSON.stringify(b.plugins) === JSON.stringify([{ id: 'web', engine: 'native', max_results: 5 }]));
expect('質問はそのまま user に入れる', b.messages[1].role === 'user' && b.messages[1].content === '渋谷でおすすめの美容室は？');
expect('対象は ChatGPT（検索あり）・Claude・Gemini だけ（Perplexity・Google の AI は今までどおり）', JSON.stringify(M.OPENROUTER_ENGINES) === JSON.stringify(['chatgpt_search', 'claude', 'gemini']) && M.openRouterModel('perplexity') === null && M.openRouterModel('google_aio') === null);

// 返ってきた答えと出典
let sent = null;
const ok = async (url, init) => { sent = { url, init }; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'サンプル美容室 Hana がおすすめです', annotations: [
  { type: 'url_citation', url_citation: { url: 'https://hana-salon.example/menu', title: 'メニュー' } },
  { type: 'url_citation', url_citation: { url: 'https://beauty.hotpepper.jp/x', title: 'x' } },
  { type: 'url_citation', url_citation: { url: 'https://hana-salon.example/menu', title: '重複' } }] } }] }) }; };
const r = await M.callViaOpenRouter('claude', 'sk-test', '質問', ok);
expect('OpenRouter の chat/completions に送る', sent.url === 'https://openrouter.ai/api/v1/chat/completions' && sent.init.method === 'POST');
expect('キーは Authorization ヘッダーだけに入れる（本文に入れない）', sent.init.headers.Authorization === 'Bearer sk-test' && !String(sent.init.body).includes('sk-test'));
expect('出典は annotations の url_citation から（重複なし）', JSON.stringify(r.citations) === JSON.stringify(['https://hana-salon.example/menu', 'https://beauty.hotpepper.jp/x']) && r.searched === true && r.fields.includes('annotations'), JSON.stringify(r));
const j = M.judgeAnswer({ answer: r.answer, citations: r.citations, brand: 'サンプル美容室 Hana', host: 'hana-salon.example', competitors: [], searched: r.searched });
expect('判定：名前が出た・自社のサイトが出典（出典の一覧で判定）', j.mentioned === 1 && j.cited === 1 && j.cite_source === 'ai_sources', JSON.stringify(j));
const none = await M.callViaOpenRouter('gemini', 'k', 'q', async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '答え' } }] }) }));
expect('出典の項目が無い答え → citations は null（0% にしない）', none.citations === null);

// 失敗のとき（画面にサービス名や費用の事情を出さない）
const fail = (status) => async () => ({ ok: false, status, json: async () => ({ error: { message: 'Insufficient credits OpenRouter' } }) });
const msg = async (status) => { try { await M.callViaOpenRouter('chatgpt_search', 'k', 'q', fail(status)); return ''; } catch (e) { return e.message; } };
const m429 = await msg(429), m402 = await msg(402), m401 = await msg(401);
expect('429：回数の上限（自動で待って聞き直す目印つき）', /回数の上限/.test(m429) && /\[rate limit; retry after \d+s\]/.test(m429), m429);
expect('402：「社内の設定が必要です」（残高・クレジット・OpenRouter の名前を出さない）', /社内の設定が必要です/.test(m402) && !/OpenRouter|credit|クレジット|残高/i.test(m402), m402);
expect('401：キーが使えない（社内の設定が必要です）', /API キーが使えません/.test(m401) && !/OpenRouter/i.test(m401), m401);

// キーがあるときだけ OpenRouter に回す（measureEngines 経由）
const realFetch = globalThis.fetch;
let calls = [];
globalThis.fetch = async (url, init) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Hana', annotations: [] } }] }) }; };
process.env.OPENROUTER_API_KEY = 'sk-test';
delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
let out = await M.measureEngines({ brand: 'Hana', prompts: [{ prompt: '渋谷の美容室は？' }], engines: ['gemini', 'claude', 'chatgpt_search'], competitors: [], pageUrl: 'https://hana-salon.example/' });
expect('キーがあれば 3つとも OpenRouter で測る（Gemini の直接のキーが無くても）', calls.length === 3 && calls.every((u) => u === 'https://openrouter.ai/api/v1/chat/completions') && out.rows.length === 3, JSON.stringify(calls));
expect('記録の条件：via=openrouter・モデル名・検索あり', out.rows.every((x) => x.conditions && x.conditions.via === 'openrouter' && x.conditions.search === true && /\//.test(x.model)), JSON.stringify(out.rows.map((x) => x.conditions)));
expect('記録の source に OpenRouter の名前を出さない', out.rows.every((x) => !/openrouter/i.test(String(x.source))), JSON.stringify(out.rows.map((x) => x.source)));
calls = [];
delete process.env.OPENROUTER_API_KEY;
out = await M.measureEngines({ brand: 'Hana', prompts: [{ prompt: 'q' }], engines: ['gemini'], competitors: [] });
expect('キーが無ければ今までどおり（Gemini は直接のキーが無いと設定待ちの案内）', calls.length === 0 && out.engineStatus && out.engineStatus.gemini && out.engineStatus.gemini.ok === false, JSON.stringify(out.engineStatus));
globalThis.fetch = realFetch;

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
