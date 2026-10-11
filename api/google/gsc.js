import { getAccessToken, requestClientId } from './_lib/token.js';
import { googleAccess, denyAccess } from './_lib/access.js';
import { saveTraffic, periodOf, jwtEmail, googleEmailOf } from './_lib/save.js';
function setCors(req, res) {
  const origin = req.headers.origin || '';
  let allow = 'https://trillion-bank.jp';
  try {
    const host = origin ? new URL(origin).hostname : '';
    if (
      host === 'trillion-bank.jp' ||
      host === 'www.trillion-bank.jp' ||
      host === 'trillion-bank-hp.vercel.app' ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      (host && (host.endsWith('.vercel.app') || host.endsWith('.github.io')))
    ) {
      allow = origin;
    }
  } catch (e) {}
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  // Google 連携は、社内スタッフか契約中の顧客のメンバーだけ（ログインのトークンで確かめる。_lib/access.js）
  const access = await googleAccess(req, requestClientId(req) || null);
  if (!access.ok) return denyAccess(res, access);
  // GET: つないだ Google アカウントが見られる Search Console のプロパティの一覧（画面で選べるようにする）
  if (req.method === 'GET') {
    const tk = await getAccessToken(req, requestClientId(req));
    if (!tk) return res.status(401).json({ error: 'Google connection required' });
    const r0 = await fetch('https://searchconsole.googleapis.com/webmasters/v3/sites', { headers: { Authorization: `Bearer ${tk}` } });
    const d0 = await r0.json().catch(() => ({}));
    if (!r0.ok) return res.status(r0.status).json(d0);
    const sites = (d0.siteEntry || [])
      .filter((x) => x && x.siteUrl && x.permissionLevel !== 'siteUnverifiedUser')
      .map((x) => ({ siteUrl: x.siteUrl, permissionLevel: x.permissionLevel }));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ sites });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const token = await getAccessToken(req, requestClientId(req));
  if (!token) return res.status(401).json({ error: 'Google connection required' });
  const { siteUrl, startDate, endDate, rowLimit = 25000 } = req.body || {};
  if (!siteUrl || !startDate || !endDate) return res.status(400).json({ error: 'siteUrl, startDate, endDate are required' });

  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  // totalsOnly: 月次レポート用。サイト全体の合計だけを返す（語句ごとの行は取らない）
  const totalsOnly = !!(req.body && req.body.totalsOnly);
  let rows = [];
  if (!totalsOnly) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ['date', 'query', 'page'],
        rowLimit: Math.min(Number(rowLimit) || 25000, 25000),
        dataState: 'final'
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    rows = (data.rows || []).map(row => ({
      date: row.keys?.[0] || '',
      keyword: row.keys?.[1] || '',
      url: row.keys?.[2] || '',
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position: row.position || 0,
      source: 'gsc'
    }));
  }
  // サイト全体の合計は日付だけで取り直す。検索語句つきの行は Google が伏せた語句（匿名クエリ）の分が落ち、
  // 合計が実際より小さくなる（2026-10-01 実測: 表示 24,091 に対し語句つきの合計は 14,958）
  let totals = null;
  const t = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ startDate, endDate, dimensions: ['date'], rowLimit: 1000, dataState: 'final' })
  });
  if (!t.ok && totalsOnly) {
    const te = await t.json().catch(() => ({}));
    return res.status(t.status).json(te);
  }
  if (t.ok) {
    const td = await t.json();
    const days = (td.rows || []).map(row => row.keys?.[0] || '').filter(Boolean).sort();
    // 日数は開始日から「データのある最後の日」まで（直近の確定前の日を分母に入れない）
    const last = days.length ? days[days.length - 1] : endDate;
    const span = Math.round((Date.parse(last < endDate ? last : endDate) - Date.parse(startDate)) / 86400000) + 1;
    const impressions = (td.rows || []).reduce((s, row) => s + (row.impressions || 0), 0);
    const clicks = (td.rows || []).reduce((s, row) => s + (row.clicks || 0), 0);
    // 平均掲載順位は表示回数で重み付け（Search Console の画面の平均と同じ考え方）
    const posW = (td.rows || []).reduce((s, row) => s + (row.position || 0) * (row.impressions || 0), 0);
    totals = {
      impressions,
      clicks,
      ctr: impressions ? clicks / impressions : 0,
      position: impressions ? Math.round((posW / impressions) * 10) / 10 : 0,
      days: span > 0 ? span : 0,
      startDate,
      endDate: last < endDate ? last : endDate
    };
  }
  // save: お客様が自分で取り込むとき。サーバーが読んだ合計だけを、サーバーが保存する（画面から数字は受け取らない。_lib/save.js）
  if (req.body && req.body.save === true) {
    if (!totalsOnly || !totals) return res.status(400).json({ code: 'bad_request', error: '保存は月の合計の取り込みだけです。' });
    const clientId = requestClientId(req);
    const saved = await saveTraffic({ clientId, period: periodOf(startDate), source: 'gsc_api', savedBy: jwtEmail(req),
      metrics: { clicks: totals.clicks, impressions: totals.impressions, ctr: totals.ctr, position: totals.position, days: totals.days, start_date: totals.startDate, end_date: totals.endDate,
        property: siteUrl, google_email: googleEmailOf(req, clientId), fetched_at: new Date().toISOString(), saved_via: 'server' } });
    if (!saved.ok) return res.status(saved.status).json({ code: saved.code, error: saved.error });
    return res.status(200).json({ rows: [], count: 0, siteUrl, totals, saved: true });
  }
  // siteUrl: どの Search Console プロパティのデータか（クライアントは各行に記録し、同じサイトの診断にだけ使う）
  return res.status(200).json({ rows, count: rows.length, siteUrl, totals });
}

