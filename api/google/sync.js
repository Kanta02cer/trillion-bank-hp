/**
 * お客様の Search Console の数字を、サーバーに保管したつながりで自動で取り込む（毎日 1 回）。
 *   Vercel の cron が GET で Authorization: Bearer <CRON_SECRET> を付けて呼ぶ。
 *   AIRREACH_GOOGLE_SYNC_ENABLED が 'true' でなければ何もしない（既定は止めておく）。
 *   取り込むもの（顧客ごと）: 先月と今月（昨日まで）の
 *     - サイト全体の合計（traffic_snapshots・source gsc_api。月次レポートが使う）
 *     - 検索語句 × ページ（gsc_query_snapshots）
 *   保存の前に DB が「選んだサイトがその顧客に登録したサイトと同じか」「契約中か」を確かめる。
 *   Search Console はお金のかからない API（呼び出し回数の上限だけ）。
 */
import { syncTargets, accessTokenFromStored, saveGscQueries, markSync } from './_lib/connections.js';
import { fetchTotals, fetchQueryRows, monthRange } from './_lib/gsc-fetch.js';
import { saveTraffic } from './_lib/save.js';

const MAX_CLIENTS = 20;
const TIME_BUDGET_MS = 240000;

function bearer(req) {
  const h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const m = /^Bearer\s+(.+)$/.exec(h.trim());
  return m ? m[1] : '';
}

/** 取り込む月（JST）: 先月と今月。今月は昨日まで（月の 1 日は先月だけ） */
export function syncPeriods(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 3600000);
  const y = jst.getUTCFullYear(), m = jst.getUTCMonth();
  const pad = (n) => String(n).padStart(2, '0');
  const cur = `${y}-${pad(m + 1)}-01`;
  const prevD = new Date(Date.UTC(y, m - 1, 1));
  const prev = `${prevD.getUTCFullYear()}-${pad(prevD.getUTCMonth() + 1)}-01`;
  const out = [{ period: prev, ...monthRange(prev) }];
  const yest = new Date(Date.UTC(y, m, jst.getUTCDate() - 1));
  if (yest.getUTCMonth() === m) out.push({ period: cur, start: cur, end: `${y}-${pad(m + 1)}-${pad(yest.getUTCDate())}` });
  return out;
}

export async function syncOne(target, periods, env = process.env, fetchImpl = globalThis.fetch) {
  const got = await accessTokenFromStored(target, env, fetchImpl);
  if (!got.token) {
    const status = got.error === 'token_revoked' ? 'token_revoked' : 'error';
    await markSync(target.client_id, status, got.error, env, fetchImpl);
    return { client_id: target.client_id, status };
  }
  const property = target.gsc_property;
  const saved = [];
  for (const p of periods) {
    const t = await fetchTotals(got.token, property, p.start, p.end, fetchImpl);
    if (!t.ok) {
      // 権限が外れた（403）・サイトが消えた（404）など
      await markSync(target.client_id, 'error', `google_${t.status}`, env, fetchImpl);
      return { client_id: target.client_id, status: 'error', error: `google_${t.status}` };
    }
    const tt = t.totals;
    const s = await saveTraffic({ clientId: target.client_id, period: p.period, source: 'gsc_api', savedBy: 'auto:google-sync',
      metrics: { clicks: tt.clicks, impressions: tt.impressions, ctr: tt.ctr, position: tt.position, days: tt.days, start_date: tt.startDate, end_date: tt.endDate,
        property, fetched_at: new Date().toISOString(), saved_via: 'auto' } }, env, fetchImpl);
    if (!s.ok) {
      const status = s.code === 'site_mismatch' ? 'site_mismatch' : 'error';
      await markSync(target.client_id, status, s.code, env, fetchImpl);
      return { client_id: target.client_id, status };
    }
    const q = await fetchQueryRows(got.token, property, p.start, p.end, 5000, fetchImpl);
    const qs = q.ok ? await saveGscQueries({ clientId: target.client_id, period: p.period, property, rows: q.rows }, env, fetchImpl) : { ok: false };
    saved.push({ period: p.period, clicks: tt.clicks, impressions: tt.impressions, queries: qs.ok ? qs.rows : null });
  }
  await markSync(target.client_id, 'ok', null, env, fetchImpl);
  return { client_id: target.client_id, status: 'ok', saved };
}

export default async function handler(req, res) {
  const send = (code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
  if (req.method !== 'GET' && req.method !== 'POST') return send(405, { error: 'Method not allowed' });
  const secret = String(process.env.CRON_SECRET || '');
  if (!secret || bearer(req) !== secret) return send(401, { error: 'unauthorized' });
  if (String(process.env.AIRREACH_GOOGLE_SYNC_ENABLED || '') !== 'true') {
    return send(200, { ok: true, disabled: true, message: '自動の取り込みは止めています（AIRREACH_GOOGLE_SYNC_ENABLED が true ではありません）' });
  }
  const started = Date.now();
  const periods = syncPeriods();
  const targets = (await syncTargets()).slice(0, MAX_CLIENTS);
  const ran = [];
  for (const t of targets) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    try { ran.push(await syncOne(t, periods)); }
    catch (e) { ran.push({ client_id: t.client_id, status: 'error' }); try { await markSync(t.client_id, 'error', 'exception'); } catch (e2) {} }
  }
  // 応答に顧客の数字は載せない（件数と状態だけ）
  return send(200, { ok: true, periods: periods.map(p => p.period), ran: ran.map(r => ({ client_id: r.client_id, status: r.status })) });
}
