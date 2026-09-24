import { setCors, getAccessToken } from './_lib.js';

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
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
