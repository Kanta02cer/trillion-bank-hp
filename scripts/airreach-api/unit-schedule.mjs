// 定期計測の実行（api/airreach/schedule-run.js）と記録の形（_lib/run-summary.js）
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
const expect = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(detail).slice(0, 300)}`); };
const S = await import(pathToFileURL(path.join(ROOT, 'api/airreach/schedule-run.js')).href);
const RS = await import(pathToFileURL(path.join(ROOT, 'api/airreach/_lib/run-summary.js')).href);

const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', SUPABASE_ANON_KEY: 'anon' };
const calls = [];
const fakeFetch = async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body || '{}'), auth: init.headers.Authorization }); return new Response(JSON.stringify({ ok: true, run_id: 'run-1' }), { status: 200 }); };
const row = (engine, eid, prompt, o) => Object.assign({ engine, prompt, keyword: prompt, evidenceClass: 'Observed', status: 'ok', mentioned: 1, cited: 1, cite_source: 'ai_sources', citations: ['https://hana-salon.example/'], urls_in_answer: [], competitors: [], conditions: { engine: eid }, measured_at: '2026-10-05T01:00:00Z' }, o);
const asked = [];
const measure = async ({ prompts, engines }) => {
  asked.push(prompts.length);
  const rows = [];
  engines.forEach((e) => prompts.forEach((p) => {
    if (e === 'gemini') return; // Gemini はキーが無い想定（AI 全体が失敗）
    if (e === 'google_aio' && p.prompt === 'q2') rows.push(row('Google AI Overviews', e, p.prompt, { status: 'not_shown', mentioned: null, cited: null, cite_source: 'not_shown', citations: [] }));
    else rows.push(row(e === 'perplexity' ? 'Perplexity' : 'Google AI Overviews', e, p.prompt));
  }));
  return { rows, engineStatus: { perplexity: { ok: true }, google_aio: { ok: true }, gemini: { ok: false, error: 'Gemini の API キー（GEMINI_API_KEY）がまだ設定されていません' } } };
};
const job = { job_id: 'job-1', brand: 'サンプル美容室 Hana', site_url: 'https://hana-salon.example/', engines: ['perplexity', 'gemini', 'google_aio'], prompts: Array.from({ length: 7 }, (_, i) => ({ prompt: 'q' + (i + 1) })), competitors: [], repeats: 2 };
const out = await S.runJob(job, { env, fetchImpl: fakeFetch, measure, now: () => new Date('2026-10-05T01:00:00Z') });
expect('質問7問 × 2回 → 5問・2問に分けて4回聞く', asked.join() === '5,2,5,2', asked.join());
expect('結果：回答 26・表示なし 2・エラー 14（Gemini の 7問×2回）→ 一部成功', out.status === 'partial' && out.answers === 26 && out.not_shown === 2 && out.errors === 14, JSON.stringify(out));
expect('費用の見込み：エラーは数えない（Perplexity 14×0.006 ＋ AI による概要 14×0.03）', Math.abs(out.cost_usd - (14 * 0.006 + 14 * 0.03)) < 1e-9, out.cost_usd);
const fin = calls.find((c) => c.url.endsWith('/rpc/airreach_schedule_finish'));
expect('記録は service_role の finish RPC だけで書く', fin && fin.auth === 'Bearer svc' && calls.every((c) => /\/rest\/v1\/rpc\/airreach_schedule_/.test(c.url)), JSON.stringify(calls.map((c) => c.url)));
const sm = fin.body.p_summary;
expect('記録：AI ごとの分母は回答のあった数（表示なし・エラーを除く）', sm.by.find((b) => b.provider === 'google_aio').denominator === 12 && sm.by.find((b) => b.provider === 'google_aio').not_shown_count === 2 && sm.by.find((b) => b.provider === 'gemini').error_count === 14, JSON.stringify(sm.by));
expect('記録：回答ごとの根拠（42行・何回目か・エラーの理由）', sm.answers.length === 42 && sm.answers.some((a) => a.repeat === 2) && sm.answers.some((a) => a.status === 'error' && /GEMINI_API_KEY/.test(a.error)), sm.answers.length);
expect('記録：Studio と同じ質問の版（並びに左右されない）', sm.query_set_version === RS.promptVersion([...job.prompts].reverse()), sm.query_set_version);

// すべて失敗 → failed・記録は作らない
calls.length = 0;
const out2 = await S.runJob(Object.assign({}, job, { engines: ['gemini'], repeats: 1 }), { env, fetchImpl: fakeFetch, measure, now: () => new Date('2026-10-05T01:00:00Z') });
const fin2 = calls.find((c) => c.url.endsWith('/rpc/airreach_schedule_finish'));
expect('すべてエラー → failed・計測の記録（summary）は渡さない・理由は残す', out2.status === 'failed' && fin2.body.p_summary === null && /GEMINI_API_KEY/.test(fin2.body.p_error), JSON.stringify(fin2.body).slice(0, 200));

// 費用の見込みは環境変数で上書きできる（変な値は無視）
expect('費用の表：上書き・負の値と知らない AI は無視', S.costTable({ AIRREACH_COST_PER_ANSWER: '{"perplexity":0.01,"gemini":-1,"x":3}' }).perplexity === 0.01 && S.costTable({ AIRREACH_COST_PER_ANSWER: '{"gemini":-1}' }).gemini === 0.035 && !('x' in S.costTable({ AIRREACH_COST_PER_ANSWER: '{"x":3}' })));

// 呼び出しの入口：cron の鍵が合っても、AIRREACH_SCHEDULE_ENABLED が true でなければ何もしない
const resMock = () => ({ headers: {}, statusCode: 0, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b || ''; } });
const env0 = { ...process.env };
process.env.CRON_SECRET = 'cron-secret-123';
delete process.env.AIRREACH_SCHEDULE_ENABLED;
let r = resMock();
await S.default({ method: 'GET', headers: { authorization: 'Bearer cron-secret-123' } }, r);
expect('cron：止めている間は何もしない（disabled）', r.statusCode === 200 && JSON.parse(r.body).disabled === true, r.body);
r = resMock();
await S.default({ method: 'GET', headers: { authorization: 'Bearer wrong-secret-xx' } }, r);
expect('cron：鍵が違えば断る（401）', r.statusCode === 401, r.statusCode);
r = resMock();
await S.default({ method: 'POST', headers: {}, body: { action: 'run_now', scheduleId: '00000000-0000-0000-0000-000000000001' } }, r);
expect('今すぐ実行：ログインしていなければ断る（401）', r.statusCode === 401, r.statusCode);
Object.keys(process.env).forEach((k) => { if (!(k in env0)) delete process.env[k]; });
Object.assign(process.env, env0);

// 定期計測の記録を、画面の集計（airreach-ai-breakdown.js）と同じ数え方にしていること
{
  const ctx = { window: {}, console, URL }; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/airreach-ai-breakdown.js'), 'utf8'), ctx);
  const B = ctx.window.AirReachAIBreakdown;
  const rows = [row('Perplexity', 'perplexity', '渋谷 美容室'), row('Perplexity', 'perplexity', 'サンプル美容室 Hana の料金', { cited: 0, citations: ['https://x.example/'] }),
    row('Perplexity', 'perplexity', '渋谷 カット', { cited: null, cite_source: 'none', citations: [], mentioned: 0 }), row('Google AI Overviews', 'google_aio', '渋谷 美容室', { status: 'not_shown', mentioned: null, cited: null }),
    row('Gemini', 'gemini', '渋谷 カット', { status: 'error', mentioned: null, cited: null })].map((x) => Object.assign(x, { run_id: 'r' }));
  const a = B.summarize(rows, { brand: 'サンプル美容室 Hana', selfUrl: 'https://hana-salon.example/' }).types;
  const b = RS.buildRunSummary(rows, { brand: 'サンプル美容室 Hana', siteUrl: 'https://hana-salon.example/' }).breakdown.types;
  const keys = ['answers', 'mention', 'cite', 'citeJudged', 'notShown', 'errors', 'citedBySources'];
  expect('一般／指名の集計が画面（Studio）と一致', ['general', 'branded'].every((t) => keys.every((k) => a[t][k] === b[t][k])), JSON.stringify({ studio: a.general, server: b.general }));
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
