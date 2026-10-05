// AI計測の引用判定：「社名への言及」「AIが返した出典」「本文のURL」を分けて記録し、判定できない回答を 0 にしないこと
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
const expect = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(detail).slice(0, 300)}`); };

const M = await import(pathToFileURL(path.join(ROOT, 'api/hack2-measure.js')).href);
const { judgeAnswer, parsePerplexityDirect, parseClaudeSearch, parseSearchResponses } = M;
const host = 'hana-salon.example';
const comps = [{ name: 'サロンA', url: 'https://salon-a.example/' }];

let j = judgeAnswer({ answer: 'サンプル美容室 Hana がおすすめです', citations: ['https://www.hana-salon.example/menu', 'https://beauty.hotpepper.jp/x'], brand: 'サンプル美容室 Hana', host, competitors: comps, searched: true });
expect('出典の一覧に自社 → cited=1・出典で判定', j.status === 'ok' && j.mentioned === 1 && j.cited === 1 && j.cite_source === 'ai_sources' && j.cited_by_sources === 1, JSON.stringify(j));
j = judgeAnswer({ answer: 'サンプル美容室 Hana は人気（https://hana-salon.example/）', citations: ['https://beauty.hotpepper.jp/x'], brand: 'サンプル美容室 Hana', host, competitors: comps });
expect('出典の一覧に自社が無い → cited=0（本文の自社URLは別の項目に1として残す）', j.cited === 0 && j.cited_by_sources === 0 && j.self_url_in_text === 1 && j.cite_source === 'ai_sources', JSON.stringify(j));
j = judgeAnswer({ answer: 'サロンA が人気です', citations: null, brand: 'サンプル美容室 Hana', host, competitors: comps });
expect('出典なし・本文にURLなし → cited=null（0 にしない）・社名の言及は 0', j.cited === null && j.cite_source === 'none' && j.mentioned === 0 && j.competitors[0].mentioned === 1, JSON.stringify(j));
j = judgeAnswer({ answer: '詳しくは https://salon-a.example/ と https://beauty.hotpepper.jp/ へ', citations: [], brand: 'Hana', host, competitors: comps });
expect('空の出典一覧は「渡されていない」→本文で判定（他サイトURLだけなら 0）', j.cited === 0 && j.cite_source === 'answer_text' && j.cited_by_sources === null && j.sources_available === false, JSON.stringify(j));
j = judgeAnswer({ answer: '公式サイト hana-salon.example を見てください', citations: null, brand: 'Hana', host, competitors: comps });
expect('本文にドメインだけ → 本文判定で 1', j.cited === 1 && j.cite_source === 'answer_text', JSON.stringify(j));
j = judgeAnswer({ answer: '', citations: [], shown: false, brand: 'Hana', host, competitors: comps });
expect('AI による概要が出なかった → not_shown・言及も引用も null', j.status === 'not_shown' && j.mentioned === null && j.cited === null && j.competitors[0].mentioned === null, JSON.stringify(j));
j = judgeAnswer({ answer: 'Hana', citations: ['https://hana-salon.example/'], brand: 'Hana', host: '', competitors: [] });
expect('サイトの URL が無い顧客 → 引用は判定しない（null）', j.cited === null && j.mentioned === 1, JSON.stringify(j));

let p = parsePerplexityDirect({ choices: [{ message: { content: '答え[1]' } }], citations: ['https://a.example/', 'https://b.example/'], search_results: [{ url: 'https://b.example/' }, { url: 'https://c.example/' }] });
expect('Perplexity（直接）: citations と search_results を重複なくまとめる', p.citations.join() === 'https://a.example/,https://b.example/,https://c.example/' && p.answer === '答え[1]' && p.fields.includes('citations'), JSON.stringify(p));
p = parsePerplexityDirect({ choices: [{ message: { content: 'x' } }] });
expect('Perplexity（直接）: 出典の項目が無ければ null', p.citations === null, JSON.stringify(p));

let c = parseClaudeSearch({ content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://x.example/' }] },
  { type: 'text', text: '答え', citations: [{ type: 'web_search_result_location', url: 'https://hana-salon.example/a' }] }, { type: 'text', text: '続き' }] });
expect('Claude（検索）: 本文に付いた出典だけを出典にする・検索した', c.answer === '答え続き' && c.citations.join() === 'https://hana-salon.example/a' && c.searched === true, JSON.stringify(c));
c = parseClaudeSearch({ content: [{ type: 'text', text: '検索せずに回答' }] });
expect('Claude: 出典が無ければ null・検索なし', c.citations === null && c.searched === false, JSON.stringify(c));

let r = parseSearchResponses({ output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: 'A', annotations: [{ type: 'url_citation', url: 'https://hana-salon.example/' }, { type: 'url_citation', url: 'https://hana-salon.example/' }] }] }] });
expect('ChatGPT・Claude（Responses の検索）: url_citation を重複なく', r.citations.length === 1 && r.searched === true && r.answer === 'A', JSON.stringify(r));
r = parseSearchResponses({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'A', annotations: [] }] }] });
expect('Responses: 出典が無ければ null（0 にしない）', r.citations === null && r.searched === false, JSON.stringify(r));

// 計測 API 全体：Perplexity の直接キーで、1問は出典つき・1問は失敗 → 失敗した質問だけ「エラー」の行になる
const realFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://api.perplexity.ai/')) {
    calls += 1;
    const body = JSON.parse(init.body);
    if (/失敗/.test(body.messages[0].content)) return new Response(JSON.stringify({ error: { message: 'server error' } }), { status: 500 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'サンプル美容室 Hana がおすすめ' } }], citations: ['https://hana-salon.example/'] }), { status: 200 });
  }
  throw new Error('unexpected fetch ' + u);
};
const env0 = { ...process.env };
process.env.PERPLEXITY_API_KEY = 'test';
delete process.env.AI_GATEWAY_API_KEY;
delete process.env.AIRREACH_STUDIO_KEY;
delete process.env.SUPABASE_URL;
// 計測 API に送るのは確定した質問だけ（confirmed: true。api/hack2-measure.js の promptPolicyError）
const confirmed = (t) => ({ keyword: t, prompt: t, confirmed: true, origin: 'manual' });
const res = { headers: {}, statusCode: 0, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b || ''; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = JSON.stringify(o); } };
await M.default({ method: 'POST', headers: {}, body: { brand: 'サンプル美容室 Hana', url: 'https://hana-salon.example/', text: '本文', prompts: ['渋谷 美容室 おすすめ', '失敗する質問'].map(confirmed), engines: ['perplexity'] } }, res);
const out = JSON.parse(res.body || '{}');
const ok = (out.rows || []).find((x) => x.prompt === '渋谷 美容室 おすすめ');
const bad = (out.rows || []).find((x) => x.prompt === '失敗する質問');
expect('API: 成功した質問は出典で判定（直接の Perplexity を AI Gateway より優先）', ok && ok.cited === 1 && ok.cite_source === 'ai_sources' && ok.conditions && ok.conditions.via === 'direct' && ok.measured_at, JSON.stringify(ok));
expect('API: 失敗した質問は status=error・言及も引用も null（ほかの質問は残る）', bad && bad.status === 'error' && bad.cited === null && bad.mentioned === null && /server error/.test(bad.error), JSON.stringify(bad));
expect('API: 計測の状態に回答数とエラー数', out.engineStatus && out.engineStatus.perplexity.answered === 1 && out.engineStatus.perplexity.errors === 1 && out.engineStatus.perplexity.ok === true, JSON.stringify(out.engineStatus));
// 10問を1回で受けられる（切り捨てない）。11問目以降は受けない
{
  const res2 = { headers: {}, statusCode: 0, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b || ''; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = JSON.stringify(o); } };
  const ten = Array.from({ length: 11 }, (_, i) => confirmed('美容室 質問' + (i + 1)));
  await M.default({ method: 'POST', headers: {}, body: { brand: 'Hana', url: 'https://hana-salon.example/', text: '本文', prompts: ten, engines: ['perplexity'] } }, res2);
  const o2 = JSON.parse(res2.body || '{}');
  expect('API: 1回で10問まで受ける（11問目は受けない）', (o2.rows || []).length === 10 && o2.rows.every((r) => r.status === 'ok') && !o2.rows.some((r) => r.prompt === '美容室 質問11'), (o2.rows || []).length);
}
globalThis.fetch = realFetch;
Object.keys(process.env).forEach((k) => { if (!(k in env0)) delete process.env[k]; });
Object.assign(process.env, env0);

// 画面の集計（airreach-ai-breakdown.js）：表示なし・エラーは分母に入れず件数で出す
{
  const vm = await import('node:vm'); const fs = await import('node:fs');
  const ctx = { window: {}, console, URL }; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/airreach-ai-breakdown.js'), 'utf8'), ctx);
  const B = ctx.window.AirReachAIBreakdown;
  const row = (o) => Object.assign({ engine: 'Perplexity', prompt: '渋谷 美容室', run_id: 'studio-1', evidenceClass: 'Observed', status: 'ok', mentioned: 0, cited: null, citations: [], urls_in_answer: [] }, o);
  const rows = [row({ mentioned: 1, cited: 1, cite_source: 'ai_sources', citations: ['https://hana-salon.example/'] }), row({ cited: 0, cite_source: 'ai_sources', citations: ['https://x.example/'] }),
    row({ cited: null, cite_source: 'none' }), row({ engine: 'Google AI Overviews', status: 'not_shown', mentioned: null }), row({ engine: 'Gemini', status: 'error', error: 'timeout', mentioned: null })];
  const sm = B.summarize(rows, { brand: 'Hana', selfUrl: 'https://hana-salon.example/' });
  const g = sm.types.general;
  expect('集計: 回答3（表示なし1・エラー1は別）・言及 1/3・引用 1/2（判定できた回答だけ）', g.answers === 3 && g.mention === 1 && g.cite === 1 && g.citeJudged === 2 && g.notShown === 1 && g.errors === 1 && g.citedBySources === 2, JSON.stringify(g));
  const q = sm.questions[0];
  expect('集計: 言及の順位・引用元は回答があった3件だけで数える', sm.answers === 3 && sm.notShown === 1 && sm.errors === 1 && sm.ranks[0].none + sm.ranks[0].first + sm.ranks[0].second + sm.ranks[0].thirdPlus === 0, JSON.stringify({ a: sm.answers, r: sm.ranks }));
  expect('集計: 質問ごとの回答の記録に、表示なし・エラーも理由つきで残る', q.detail.length === 5 && q.detail.some((a) => a.status === 'not_shown') && q.detail.some((a) => a.status === 'error' && a.error === 'timeout') && q.answers === 3, JSON.stringify(q.detail.map((a) => a.status)));
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
