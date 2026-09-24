import { setCors, refreshAccessToken, parseCookies } from './_lib.js';

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
  const body = readBody(req);
  const cookies = parseCookies(req.headers.cookie || '');
  const refresh =
    body.refresh_token ||
    req.headers['x-google-refresh-token'] ||
    cookies.airreach_google_refresh ||
    '';
  const refreshed = await refreshAccessToken(refresh);
  if (!refreshed || !refreshed.access_token) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Refresh failed. Reconnect Google.' }));
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    access_token: refreshed.access_token,
    expires_in: refreshed.expires_in,
    refresh_token: refreshed.refresh_token
  }));
}
