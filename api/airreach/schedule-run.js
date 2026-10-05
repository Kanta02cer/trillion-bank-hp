/**
 * AI計測の定期実行（POST /api/airreach/schedule-run/）
 *   1) 定期実行（cron）: Authorization: Bearer <CRON_SECRET>。AIRREACH_SCHEDULE_ENABLED が 'true' でなければ何もしない（既定は止めておく）。
 *      予定の時刻になった設定の実行を DB の RPC で作り（同じ時刻は1件だけ・上限を超える回は見送り）、1件ずつ測って記録する
 *   2) 今すぐ1回測る（社内の人が画面から）: Authorization: Bearer <ログインのトークン>、{ action: 'run_now', scheduleId }。
 *      上限・二重実行は DB の RPC（airreach_schedule_request_now）が確かめる
 *   計測は Studio と同じ measureEngines。質問は5問ずつに分けて聞く。記録は measurement_runs（source='schedule'）
 *   service_role で呼べるのは定期実行の RPC 3本だけ（テーブルには触らない）。キーはログ・応答に出さない
 */
import { measureEngines, normalizeEngines, normalizePrompts, staffTokenOk } from '../hack2-measure.js';
import { buildRunSummary } from './_lib/run-summary.js';

// 1回答あたりの費用の見込み（ドル）。上限の判定に使う。実際の請求と違うときは AIRREACH_COST_PER_ANSWER（JSON）で上書きする
//   根拠: ChatGPT 検索なし 約0.0002（9/30 実測）／ChatGPT 検索あり 約0.015（9/30 実測・検索1回）／Claude 検索 1,000回10ドル＋Haiku のトークン／
//   Perplexity sonar のリクエスト料＋トークン／Gemini の Google 検索 1,000回35ドル（無料枠を超えた分）／SerpApi 有料プランの1検索あたり（AI による概要は最大2回）
export const DEFAULT_COST_PER_ANSWER = { chatgpt: 0.0003, chatgpt_search: 0.015, claude: 0.02, perplexity: 0.006, gemini: 0.035, google_aio: 0.03, google_ai_mode: 0.015 };
export function costTable(env = process.env) {
  let extra = {};
  try { extra = JSON.parse(env.AIRREACH_COST_PER_ANSWER || '{}') || {}; } catch (e) { extra = {}; }
  const out = { ...DEFAULT_COST_PER_ANSWER };
  Object.keys(extra).forEach((k) => { const v = Number(extra[k]); if (k in out && isFinite(v) && v >= 0) out[k] = v; });
  return out;
}
const CHUNK = 5;
const SVC_RPC = new Set(['airreach_schedule_claim', 'airreach_schedule_claim_job', 'airreach_schedule_finish']);

function cors(req, res) {
  const origin = req.headers.origin || '';
  let ok = '';
  try { const h = new URL(origin).hostname; if (h === 'trillion-bank.jp' || h === 'www.trillion-bank.jp' || h.endsWith('.vercel.app') || h === 'localhost' || h === '127.0.0.1') ok = origin; } catch (e) { /* なし */ }
  if (ok) res.setHeader('Access-Control-Allow-Origin', ok);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
}
function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
function bearer(req) {
  const m = /^Bearer\s+(\S{8,4096})$/.exec(String(req.headers.authorization || req.headers.Authorization || '').trim());
  return m ? m[1] : '';
}

/** service_role で定期実行の RPC を呼ぶ（3本だけ） */
export async function svcRpc(name, args, env = process.env, fetchImpl = globalThis.fetch) {
  if (!SVC_RPC.has(name)) throw new Error('rpc not allowed');
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!url || !key) throw new Error('Supabase の設定（SUPABASE_URL・SUPABASE_SERVICE_ROLE_KEY）がありません');
  const r = await fetchImpl(url + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error('DB ' + name + ' 失敗（' + r.status + '）' + String((data && (data.message || data.hint)) || '').slice(0, 160));
  return data;
}
async function userRpc(name, args, token, env = process.env, fetchImpl = globalThis.fetch) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const anon = String(env.SUPABASE_ANON_KEY || '');
  const r = await fetchImpl(url + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(String((data && data.message) || ('DB ' + name + ' 失敗（' + r.status + '）')).slice(0, 200));
  return data;
}

/** 1回の実行：質問を5問ずつ・決めた回数だけ聞き、記録を作って DB に返す */
export async function runJob(job, { env = process.env, fetchImpl = globalThis.fetch, measure = measureEngines, now = () => new Date() } = {}) {
  const prompts = normalizePrompts(job.prompts || []);
  const engines = normalizeEngines(job.engines || []).filter((e) => e !== 'jev');
  const competitors = (Array.isArray(job.competitors) ? job.competitors : []).filter((c) => c && c.name).slice(0, 5);
  const repeats = Math.max(1, Math.min(3, Number(job.repeats) || 1));
  const costs = costTable(env);
  const rows = [];
  for (let rep = 1; rep <= repeats; rep += 1) {
    for (let i = 0; i < prompts.length; i += CHUNK) {
      const chunk = prompts.slice(i, i + CHUNK);
      try {
        const out = await measure({ brand: job.brand, prompts: chunk, engines, competitors, pageUrl: job.site_url || null });
        out.rows.forEach((r) => rows.push(Object.assign(r, { repeat: rep })));
        // AI 全体が使えなかった（キーが無い等）ときは、その AI × 質問をエラーの行にする（黙って消さない）
        engines.forEach((e) => {
          const st = out.engineStatus[e];
          if (st && st.ok === false && !out.rows.some((r) => String(r.conditions && r.conditions.engine) === e)) {
            chunk.forEach((p) => rows.push({ engine: e, prompt: p.prompt, keyword: p.keyword, status: 'error', error: String(st.error || 'failed').slice(0, 200), mentioned: null, cited: null, cite_source: 'error', citations: [], urls_in_answer: [], competitors: [], repeat: rep, measured_at: now().toISOString(), conditions: { engine: e } }));
          }
        });
      } catch (err) {
        engines.forEach((e) => chunk.forEach((p) => rows.push({ engine: e, prompt: p.prompt, keyword: p.keyword, status: 'error', error: String((err && err.message) || err).slice(0, 200), mentioned: null, cited: null, cite_source: 'error', citations: [], urls_in_answer: [], competitors: [], repeat: rep, measured_at: now().toISOString(), conditions: { engine: e } })));
      }
    }
  }
  const okN = rows.filter((r) => r.status !== 'error' && r.status !== 'not_shown').length;
  const nsN = rows.filter((r) => r.status === 'not_shown').length;
  const errN = rows.filter((r) => r.status === 'error').length;
  const status = okN + nsN === 0 ? 'failed' : (errN ? 'partial' : 'succeeded');
  const engOf = (r) => String((r.conditions && r.conditions.engine) || '').toLowerCase();
  const cost = Math.round(rows.filter((r) => r.status !== 'error').reduce((s, r) => s + (costs[engOf(r)] || 0), 0) * 10000) / 10000;
  const summary = status === 'failed' ? null : buildRunSummary(rows, { brand: job.brand, siteUrl: job.site_url || '', competitors, prompts, runId: 'schedule-' + job.job_id, source: 'schedule', now: now() });
  const firstErr = (rows.find((r) => r.status === 'error') || {}).error || null;
  const fin = await svcRpc('airreach_schedule_finish', { p_job_id: job.job_id, p_status: status, p_summary: summary, p_answers_done: okN + nsN, p_errors: errN, p_not_shown: nsN, p_cost: cost, p_error: firstErr, p_now: now().toISOString() }, env, fetchImpl);
  return { job_id: job.job_id, status, answers: okN, not_shown: nsN, errors: errN, cost_usd: cost, run_id: fin && fin.run_id, error: firstErr };
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST' && req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  const token = bearer(req);
  const cronSecret = String(process.env.CRON_SECRET || '');
  try {
    // 1) 定期実行（Vercel の cron は GET で Authorization: Bearer <CRON_SECRET> を付けて呼ぶ）
    if (cronSecret && token === cronSecret) {
      if (String(process.env.AIRREACH_SCHEDULE_ENABLED || '') !== 'true') {
        return send(res, 200, { ok: true, disabled: true, message: '定期実行は止めています（AIRREACH_SCHEDULE_ENABLED が true ではありません）' });
      }
      const started = Date.now();
      const done = [];
      // 関数の制限時間に収めるため、1件ずつ取り出し、残り時間が少なければやめる（残りは次の回に取り出す）
      while (Date.now() - started < 120000 && done.length < 5) {
        const got = await svcRpc('airreach_schedule_claim', { p_now: new Date().toISOString(), p_cost_per_answer: costTable(), p_limit: 1 });
        const job = Array.isArray(got) ? got[0] : null;
        if (!job) break;
        done.push(await runJob(job));
      }
      return send(res, 200, { ok: true, ran: done });
    }
    // 2) 今すぐ1回測る（社内の人）
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; } }
    body = body || {};
    if (req.method === 'POST' && body.action === 'run_now' && token && (await staffTokenOk(req))) {
      const sid = String(body.scheduleId || '');
      if (!/^[0-9a-f-]{36}$/i.test(sid)) return send(res, 400, { error: 'scheduleId が正しくありません' });
      const reqd = await userRpc('airreach_schedule_request_now', { p_schedule_id: sid, p_cost_per_answer: costTable() }, token);
      if (!reqd || !reqd.ok) return send(res, 409, { ok: false, error: (reqd && reqd.reason) || '受け付けられませんでした' });
      // 取り出す直前に、いまの条件とこの単価で予定回答数・費用を計算し直して上限を確かめる（DB 側）
      const job = await svcRpc('airreach_schedule_claim_job', { p_job_id: reqd.job_id, p_now: new Date().toISOString(), p_cost_per_answer: costTable() });
      // 取り出す直前に上限を確かめ直して見送った（受け付けたあとに設定が変わった）か、ほかの計測サーバーが先に取り出した
      if (!job) return send(res, 409, { ok: false, error: '実行しませんでした。上限を確かめ直して見送ったか、ほかの計測サーバーが実行しています。下の「実行の記録」で理由を確かめてください' });
      const out = await runJob(job);
      return send(res, 200, { ok: true, result: out });
    }
    return send(res, 401, { error: 'AirReach のダッシュボードに社内の人としてログインしてから、もう一度押してください。', code: 'staff_login_required' });
  } catch (err) {
    return send(res, 500, { ok: false, error: String((err && err.message) || err).slice(0, 300) });
  }
}
