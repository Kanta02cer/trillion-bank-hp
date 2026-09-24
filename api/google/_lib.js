/**
 * Shared helpers for Google OAuth + GSC/GA4 APIs.
 * Tokens may arrive via cookie (same-site Vercel) or Authorization Bearer
 * (GitHub Pages → Vercel split, after hash handoff to sessionStorage).
 */

export function setCors(req, res) {
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Google-Refresh-Token');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
}

export function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers.host}`;
}

export function frontendStudioUrl() {
  return (
    process.env.GOOGLE_FRONTEND_REDIRECT ||
    'https://trillion-bank.jp/airreach/studio/'
  ).replace(/\?.*$/, '').replace(/#.*$/, '');
}

export function parseCookies(raw) {
  return String(raw || '').split(';').reduce((acc, pair) => {
    const i = pair.indexOf('=');
    if (i > -1) {
      acc[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
    }
    return acc;
  }, {});
}

export function bearerFromReq(req) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

export async function refreshAccessToken(refreshToken) {
  if (!refreshToken) return null;
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return null;
  return {
    access_token: data.access_token || null,
    expires_in: data.expires_in || 3600,
    refresh_token: data.refresh_token || refreshToken
  };
}

export async function getAccessToken(req) {
  const bearer = bearerFromReq(req);
  if (bearer) return bearer;

  const cookies = parseCookies(req.headers.cookie || '');
  if (cookies.airreach_google_access) return cookies.airreach_google_access;

  const refresh =
    cookies.airreach_google_refresh ||
    req.headers['x-google-refresh-token'] ||
    '';
  if (!refresh) return null;

  const refreshed = await refreshAccessToken(refresh);
  return refreshed && refreshed.access_token ? refreshed.access_token : null;
}

export function cookieAttrs() {
  // Cross-site fetch from trillion-bank.jp → *.vercel.app needs None
  return 'Path=/; HttpOnly; Secure; SameSite=None';
}
