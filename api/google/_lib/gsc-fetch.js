/**
 * Search Console から読む部品（gsc.js と、毎月の自動取り込み sync.js で共通）。
 */
const base = (siteUrl) => `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

async function query(token, siteUrl, body, fetchImpl) {
  const r = await fetchImpl(base(siteUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

/**
 * サイト全体の合計。日付だけで取る。検索語句つきの行は Google が伏せた語句（匿名クエリ）の分が落ち、
 * 合計が実際より小さくなる（2026-10-01 実測: 表示 24,091 に対し語句つきの合計は 14,958）
 * 戻り値 { ok, status, data, totals }
 */
export async function fetchTotals(token, siteUrl, startDate, endDate, fetchImpl = globalThis.fetch) {
  const t = await query(token, siteUrl, { startDate, endDate, dimensions: ['date'], rowLimit: 1000, dataState: 'final' }, fetchImpl);
  if (!t.ok) return t;
  const rows = t.data.rows || [];
  const days = rows.map(row => row.keys?.[0] || '').filter(Boolean).sort();
  // 日数は開始日から「データのある最後の日」まで（直近の確定前の日を分母に入れない）
  const last = days.length ? days[days.length - 1] : endDate;
  const end = last < endDate ? last : endDate;
  const span = Math.round((Date.parse(end) - Date.parse(startDate)) / 86400000) + 1;
  const impressions = rows.reduce((s, row) => s + (row.impressions || 0), 0);
  const clicks = rows.reduce((s, row) => s + (row.clicks || 0), 0);
  // 平均掲載順位は表示回数で重み付け（Search Console の画面の平均と同じ考え方）
  const posW = rows.reduce((s, row) => s + (row.position || 0) * (row.impressions || 0), 0);
  return { ...t, totals: {
    impressions,
    clicks,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions ? Math.round((posW / impressions) * 10) / 10 : 0,
    days: span > 0 ? span : 0,
    startDate,
    endDate: end
  } };
}

/**
 * 月の「検索語句 × ページ」。表示回数の多い順に maxRows まで（DB は 1 回 5,000 行まで）
 * 戻り値 { ok, status, data, rows }
 */
export async function fetchQueryRows(token, siteUrl, startDate, endDate, maxRows = 5000, fetchImpl = globalThis.fetch) {
  const q = await query(token, siteUrl, { startDate, endDate, dimensions: ['query', 'page'], rowLimit: Math.min(maxRows, 5000), dataState: 'final' }, fetchImpl);
  if (!q.ok) return { ...q, rows: [] };
  const rows = (q.data.rows || []).map(row => ({
    query: row.keys?.[0] || '',
    page: row.keys?.[1] || '',
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    ctr: row.ctr || 0,
    position: Math.round((row.position || 0) * 10) / 10
  })).filter(r => r.query && r.page).sort((a, b) => b.impressions - a.impressions).slice(0, maxRows);
  return { ...q, rows };
}

/** つないだアカウントが、そのサイトにどの権限を持っているか（siteOwner / siteFullUser / siteRestrictedUser / siteUnverifiedUser） */
export async function fetchPermission(token, siteUrl, fetchImpl = globalThis.fetch) {
  const r = await fetchImpl('https://searchconsole.googleapis.com/webmasters/v3/sites', { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return null;
  const hit = (d.siteEntry || []).find(x => x && x.siteUrl === siteUrl);
  return hit ? hit.permissionLevel || null : null;
}

/** 月（YYYY-MM-01）の初日と末日 */
export function monthRange(period) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${period.slice(0, 7)}-01`, end: `${period.slice(0, 7)}-${String(last).padStart(2, '0')}` };
}
