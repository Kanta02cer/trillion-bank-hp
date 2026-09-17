export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const token = await getAccessToken(req);
  if (!token) return res.status(401).json({ error: 'Google connection required' });
  const { propertyId, startDate, endDate } = req.body || {};
  if (!propertyId || !startDate || !endDate) return res.status(400).json({ error: 'propertyId, startDate, endDate are required' });

  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'date' }, { name: 'landingPagePlusQueryString' }],
      metrics: [{ name: 'sessions' }, { name: 'keyEvents' }],
      limit: '100000'
    })
  });
  const data = await r.json();
  if (!r.ok) return res.status(r.status).json(data);
  const rows = (data.rows || []).map(row => ({
    date: normalizeDate(row.dimensionValues?.[0]?.value || ''),
    url: row.dimensionValues?.[1]?.value || '',
    sessions: Number(row.metricValues?.[0]?.value || 0),
    keyEvents: Number(row.metricValues?.[1]?.value || 0),
    source: 'ga4'
  }));
  return res.status(200).json({ rows, count: rows.length });
}

function normalizeDate(v) {
  return /^\d{8}$/.test(v) ? `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}` : v;
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
