export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const token = await getAccessToken(req);
  if (!token) return res.status(401).json({ error: 'Google connection required' });

  const { siteUrl, inspectionUrl, languageCode = 'ja-JP' } = req.body || {};
  if (!siteUrl || !inspectionUrl) {
    return res.status(400).json({ error: 'siteUrl and inspectionUrl are required' });
  }

  let parsed;
  try { parsed = new URL(inspectionUrl); } catch (_) {
    return res.status(400).json({ error: 'inspectionUrl must be a valid absolute URL' });
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return res.status(400).json({ error: 'Only http/https URLs are supported' });
  }

  const r = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inspectionUrl: parsed.href, siteUrl, languageCode })
  });
  const data = await r.json();
  if (!r.ok) return res.status(r.status).json(data);

  const result = data.inspectionResult || {};
  const idx = result.indexStatusResult || {};
  const rich = result.richResultsResult || {};
  const mobile = result.mobileUsabilityResult || {};
  const amp = result.ampResult || {};

  return res.status(200).json({
    source: 'google_url_inspection',
    evidenceClass: 'official',
    inspectedUrl: parsed.href,
    siteUrl,
    verdict: idx.verdict || 'UNKNOWN',
    coverageState: idx.coverageState || '',
    robotsTxtState: idx.robotsTxtState || '',
    indexingState: idx.indexingState || '',
    lastCrawlTime: idx.lastCrawlTime || null,
    pageFetchState: idx.pageFetchState || '',
    googleCanonical: idx.googleCanonical || '',
    userCanonical: idx.userCanonical || '',
    crawledAs: idx.crawledAs || '',
    referringUrls: idx.referringUrls || [],
    sitemap: idx.sitemap || [],
    richResults: rich,
    mobileUsability: mobile,
    amp,
    raw: data
  });
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
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await r.json();
  return r.ok ? data.access_token : null;
}

function parseCookies(raw) {
  return raw.split(';').reduce((acc, pair) => {
    const i = pair.indexOf('=');
    if (i > -1) acc[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
    return acc;
  }, {});
}
