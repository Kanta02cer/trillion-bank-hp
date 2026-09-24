import { setCors, getAccessToken } from './_lib.js';

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
  }
  return req.body;
}

function normalizeDate(v) {
  return /^\d{8}$/.test(v) ? (v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8)) : v;
}

function normalizePropertyId(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.indexOf('properties/') === 0) return s.replace(/^properties\//, '');
  return s;
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
  const propertyId = normalizePropertyId(body.propertyId || process.env.GOOGLE_GA4_PROPERTY_ID || '');
  const startDate = body.startDate;
  const endDate = body.endDate;
  if (!propertyId || !startDate || !endDate) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      error: 'propertyId, startDate, endDate are required',
      hint: 'GA4 Data API uses numeric Property ID (not Measurement ID G-XXXX).'
    }));
    return;
  }

  const url = 'https://analyticsdata.googleapis.com/v1beta/properties/' + encodeURIComponent(propertyId) + ':runReport';
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: 'date' }, { name: 'landingPagePlusQueryString' }],
      metrics: [{ name: 'sessions' }, { name: 'keyEvents' }],
      limit: '100000'
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
      date: normalizeDate((row.dimensionValues && row.dimensionValues[0] && row.dimensionValues[0].value) || ''),
      url: (row.dimensionValues && row.dimensionValues[1] && row.dimensionValues[1].value) || '',
      landingPagePlusQueryString: (row.dimensionValues && row.dimensionValues[1] && row.dimensionValues[1].value) || '',
      sessions: Number((row.metricValues && row.metricValues[0] && row.metricValues[0].value) || 0),
      keyEvents: Number((row.metricValues && row.metricValues[1] && row.metricValues[1].value) || 0),
      source: 'ga4',
      evidenceClass: 'Official'
    };
  });
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true,
    rows,
    count: rows.length,
    propertyId,
    startDate,
    endDate,
    evidenceClass: 'Official'
  }));
}
