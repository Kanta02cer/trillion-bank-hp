import { getAccessToken, requestClientId } from './_lib/token.js';
import { googleAccess, denyAccess } from './_lib/access.js';
import { isGa4Enabled } from './_lib/scopes.js';
import { ga4Host, siteHost } from './_lib/host.js';
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
  // GET：つないだアカウントで見られる GA4 プロパティの一覧（画面で選べるようにする）。
  // 名前と、ウェブのデータストリームの URL（お客様のサイトに合うものを選ぶため）を返す。読み取りのみ（analytics.readonly）
  if (req.method === 'GET') {
    if (!isGa4Enabled()) return res.status(503).json({ error: 'GA4連携は準備中です', code: 'ga4_not_enabled' });
    const tk = await getAccessToken(req, requestClientId(req));
    if (!tk) return res.status(401).json({ error: 'Google connection required', code: 'not_connected' });
    const H = { Authorization: `Bearer ${tk}` };
    const r0 = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', { headers: H });
    const d0 = await r0.json().catch(() => ({}));
    if (!r0.ok) return res.status(r0.status).json({ error: (d0.error && d0.error.message) || 'GA4 のプロパティ一覧を読めませんでした', code: 'list_failed' });
    const props = [];
    (d0.accountSummaries || []).forEach((a) => (a.propertySummaries || []).forEach((p) => {
      const id = String(p.property || '').replace(/^properties\//, '');
      if (/^\d+$/.test(id)) props.push({ id, name: p.displayName || '', account: a.displayName || '', uris: [] });
    }));
    // ウェブのデータストリームの URL（多すぎると遅いので先頭30件まで）
    await Promise.all(props.slice(0, 30).map(async (p) => {
      try {
        const r1 = await fetch(`https://analyticsadmin.googleapis.com/v1beta/properties/${p.id}/dataStreams?pageSize=20`, { headers: H });
        const d1 = await r1.json().catch(() => ({}));
        if (r1.ok) p.uris = (d1.dataStreams || []).map((x) => x.webStreamData && x.webStreamData.defaultUri).filter(Boolean);
      } catch (e) {}
    }));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ properties: props });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  // GA4 連携は準備中。OAuth で analytics.readonly を要求していないので、Google へは問い合わせない（コードは再開用に残す）
  if (!isGa4Enabled()) return res.status(503).json({ error: 'GA4連携は準備中です。GA4 は CSV で取り込めます。', code: 'ga4_not_enabled' });
  const token = await getAccessToken(req, requestClientId(req));
  if (!token) return res.status(401).json({ error: 'Google connection required', code: 'not_connected' });
  const { propertyId, startDate, endDate, siteUrl } = req.body || {};
  if (!propertyId || !startDate || !endDate || !siteUrl) return res.status(400).json({ error: 'propertyId, siteUrl, startDate, endDate are required', code: 'bad_request' });
  // どのサイトの GA4 として使うか（このホストの行だけを返す。www の有無も区別する）
  const host = siteHost(/^[a-z][a-z0-9+.-]*:\/\//i.test(String(siteUrl)) ? siteUrl : `https://${siteUrl}`);
  if (!host || host.indexOf('.') < 0) return res.status(400).json({ code: 'invalid_site_url', error: '対象サイトの URL を https://example.com/ の形で入力してください。' });
  // プロパティIDは数字だけ（「properties/123」も受け付ける）。G- で始まる測定ID（Measurement ID）は別物
  const pid = String(propertyId).trim().replace(/^properties\//, '');
  if (/^G-/i.test(pid)) {
    return res.status(400).json({ code: 'measurement_id', error: '「G-」で始まる測定ID（Measurement ID）ではなく、数字だけのプロパティID（例: 123456789）を入力してください。' });
  }
  if (!/^\d{1,20}$/.test(pid)) return res.status(400).json({ code: 'invalid_property_id', error: 'プロパティIDは数字だけです（例: 123456789）。' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endDate))) {
    return res.status(400).json({ code: 'bad_request', error: 'startDate / endDate は YYYY-MM-DD で指定してください。' });
  }

  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(pid)}:runReport`;
  // summaryOnly: 月次レポート用。対象サイトの合計（セッション・キーイベント・AI経由）だけを返す
  if (req.body.summaryOnly) {
    const s = await fetchSummary(url, token, startDate, endDate, host);
    if (s.error) return res.status(s.status).json(s.error);
    // save: お客様が自分で取り込むとき。サーバーが読んだ合計だけを、サーバーが保存する（_lib/save.js）
    if (req.body.save === true) {
      const clientId = requestClientId(req), g = s.summary || {};
      const saved = await saveTraffic({ clientId, period: periodOf(startDate), source: 'ga4_api', savedBy: jwtEmail(req),
        metrics: { sessions: g.sessions, ai_sessions: g.aiSessions, conversions: g.keyEvents, target_page_views: null, ai_sources: g.aiSources,
          property_id: pid, host, start_date: startDate, end_date: endDate, google_email: googleEmailOf(req, clientId), fetched_at: new Date().toISOString(), saved_via: 'server' } });
      if (!saved.ok) return res.status(saved.status).json({ code: saved.code, error: saved.error });
      return res.status(200).json({ summary: s.summary, propertyId: pid, siteUrl: String(siteUrl), host, saved: true });
    }
    return res.status(200).json({ summary: s.summary, propertyId: pid, siteUrl: String(siteUrl), host });
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      // hostName: GA4 プロパティに複数のドメインがあっても、対象サイトの行だけを使うため
      dimensions: [{ name: 'date' }, { name: 'landingPagePlusQueryString' }, { name: 'hostName' }],
      metrics: [{ name: 'sessions' }, { name: 'keyEvents' }],
      limit: '100000'
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const ge = googleError(r.status, data);
    return res.status(ge.status).json(ge.body);
  }
  const all = (data.rows || []).map(row => ({
    date: normalizeDate(row.dimensionValues?.[0]?.value || ''),
    host: ga4Host(row.dimensionValues?.[2]?.value || ''),
    url: row.dimensionValues?.[1]?.value || '',
    sessions: Number(row.metricValues?.[0]?.value || 0),
    keyEvents: Number(row.metricValues?.[1]?.value || 0),
    source: 'ga4'
  }));
  // 対象ホストと一致しない行（別ドメイン・www 違い・ホスト不明）は含めない
  const rows = all.filter((r) => r.host === host);
  const excludedHosts = {};
  all.forEach((r) => { if (r.host !== host) { const k = r.host || '(not set)'; excludedHosts[k] = (excludedHosts[k] || 0) + 1; } });
  return res.status(200).json({
    rows, count: rows.length, propertyId: pid, siteUrl: String(siteUrl), host,
    excluded: { rows: all.length - rows.length, hosts: Object.keys(excludedHosts).sort((a, b) => excludedHosts[b] - excludedHosts[a]).slice(0, 10) }
  });
}

// Google の失敗を、画面に出せる日本語の理由に置き換える（数値は作らない）
function googleError(status, data) {
  // Google の応答を画面で扱える形にする（数値は作らない）
  const e = (data && data.error) || {};
  const scopeInsufficient = status === 403 && (/ACCESS_TOKEN_SCOPE_INSUFFICIENT/.test(JSON.stringify(e)) || /insufficient authentication scopes/i.test(e.message || ''));
  if (scopeInsufficient) {
    return { status: 403, body: { code: 'scope_insufficient', error: 'Google アナリティクスの権限がありません。Studio の「接続」からもう一度 Google に接続し、アナリティクス（読み取り）を許可してください。', google: e.message || '' } };
  }
  if (status === 403) {
    return { status: 403, body: { code: 'forbidden', error: 'このプロパティを見る権限がありません。接続した Google アカウントに、この GA4 プロパティの閲覧権限があるか確認してください。', google: e.message || '' } };
  }
  if (status === 401) {
    return { status: 401, body: { code: 'unauthorized', error: 'Google への接続が切れています。Studio の「接続」からもう一度接続してください。', google: e.message || '' } };
  }
  return { status, body: { code: 'google_error', error: e.message || ('GA4 API error ' + status), google: e.message || '' } };
}

// AI サービスからの流入とみなす参照元（GA4 の sessionSource）
// ドメイン（chatgpt.com 等）に加え、utm_source などで付く名前だけの値（openai・perplexity・gemini 等）も数える
// （2026-10-01 実データ: 都市伝説ラボ 9月の AI 経由 99 のうち 17 は名前だけの値だった）
const AI_SOURCE = /^(?:.*\.)?(chatgpt\.com|openai\.com|perplexity\.ai|gemini\.google\.com|bard\.google\.com|copilot\.microsoft\.com|copilot\.com|claude\.ai|deepseek\.com|grok\.com|you\.com|phind\.com|poe\.com|felo\.ai|genspark\.ai|doubao\.com|kimi\.com|meta\.ai)$|^(chatgpt|openai|perplexity|gemini|copilot|claude|deepseek|grok)$/i;
export function isAiSource(src) { return AI_SOURCE.test(String(src || '').trim()); }

// 対象ホストの合計。ページ別の行を足すのでなく、ホスト×参照元で取り直す
async function fetchSummary(url, token, startDate, endDate, host) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'hostName' }, { name: 'sessionSource' }],
      metrics: [{ name: 'sessions' }, { name: 'keyEvents' }],
      limit: '10000'
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const ge = googleError(r.status, data); return { status: ge.status, error: ge.body }; }
  const summary = { sessions: 0, keyEvents: 0, aiSessions: 0, aiSources: {} };
  (data.rows || []).forEach((row) => {
    if (ga4Host(row.dimensionValues?.[0]?.value || '') !== host) return;
    const src = row.dimensionValues?.[1]?.value || '';
    const ses = Number(row.metricValues?.[0]?.value || 0);
    summary.sessions += ses;
    summary.keyEvents += Number(row.metricValues?.[1]?.value || 0);
    if (isAiSource(src)) { summary.aiSessions += ses; summary.aiSources[src] = (summary.aiSources[src] || 0) + ses; }
  });
  return { summary };
}

function normalizeDate(v) {
  return /^\d{8}$/.test(v) ? `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}` : v;
}
