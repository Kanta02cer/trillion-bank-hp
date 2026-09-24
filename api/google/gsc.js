import { setCors, getAccessToken } from './_lib.js';

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
  }
  return req.body;
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'POST required' }));
    return;
  }
  const token = await getAccessToken(req);
  if (!token) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Google connection required' }));
    return;
  }
  const body = readBody(req);
  const siteUrl = body.siteUrl || process.env.GOOGLE_GSC_SITE_URL || '';
  const startDate = body.startDate;
  const endDate = body.endDate;
  const rowLimit = body.rowLimit || 25000;
  if (!siteUrl || !startDate || !endDate) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'siteUrl, startDate, endDate are required' }));
    return;
  }

  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startDate,
      endDate,
      dimensions: ['date', 'query', 'page'],
      rowLimit: Math.min(Number(rowLimit) || 25000, 25000),
      dataState: 'final'
    })
  });
  const data = await r.json();
  if (!r.ok) {
    res.statusCode = r.status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(data));
    return;
  }
  const rows = (data.rows || []).map(function (row) {
    return {
      date: (row.keys && row.keys[0]) || '',
      keyword: (row.keys && row.keys[1]) || '',
      query: (row.keys && row.keys[1]) || '',
      url: (row.keys && row.keys[2]) || '',
      page: (row.keys && row.keys[2]) || '',
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position: row.position || 0,
      source: 'gsc',
      evidenceClass: 'Official'
    };
  });
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true,
    rows,
    count: rows.length,
    siteUrl,
    startDate,
    endDate,
    evidenceClass: 'Official'
  }));
}
