export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const token = await getAccessToken(req);
  if (!token) return res.status(401).json({ error: 'Google connection required' });
  const { siteUrl, startDate, endDate, rowLimit = 25000 } = req.body || {};
  if (!siteUrl || !startDate || !endDate) return res.status(400).json({ error: 'siteUrl, startDate, endDate are required' });

  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
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
  const rows = (data.rows || []).map(row => ({
    date: row.keys?.[0] || '',
    keyword: row.keys?.[1] || '',
    url: row.keys?.[2] || '',
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    ctr: row.ctr || 0,
    position: row.position || 0,
    source: 'gsc'
  }));
  return res.status(200).json({ rows, count: rows.length });
}

async function getAccessToken(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  if (cookies.airreach_google_access) return cookies.airreach_google_access;
  if (!cookies.airreach_google_refresh) return null;
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    refresh_token: cookies.airreach_google_refresh,
    grant_type: 'refresh_token'
  });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await r.json();
  return r.ok ? data.access_token : null;
}
function parseCookies(raw) {
  return raw.split(';').reduce((acc, pair) => {
    const i = pair.indexOf('='); if (i > -1) acc[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim()); return acc;
  }, {});
}
