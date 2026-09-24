import { setCors, getOrigin, parseCookies, frontendStudioUrl, cookieAttrs } from './_lib.js';

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  const { code, state, error } = req.query || {};
  if (error) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Google OAuth error: ' + String(error));
    return;
  }
  const cookies = parseCookies(req.headers.cookie || '');
  if (!code || !state || state !== cookies.airreach_google_state) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Invalid OAuth state');
    return;
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${getOrigin(req)}/api/google/callback/`;
  if (!clientId || !clientSecret) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Google OAuth is not configured');
    return;
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(code),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(tokens));
    return;
  }

  const secure = cookieAttrs();
  const cookieHeaders = [
    `airreach_google_access=${encodeURIComponent(tokens.access_token || '')}; ${secure}; Max-Age=${Number(tokens.expires_in || 3600)}`,
    `airreach_google_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  ];
  if (tokens.refresh_token) {
    cookieHeaders.push(
      `airreach_google_refresh=${encodeURIComponent(tokens.refresh_token)}; ${secure}; Max-Age=2592000`
    );
  }
  res.setHeader('Set-Cookie', cookieHeaders);

  // Hash handoff so GitHub Pages Studio can call Vercel APIs with Bearer
  const hash = new URLSearchParams({
    access_token: tokens.access_token || '',
    expires_in: String(tokens.expires_in || 3600),
    token_type: 'Bearer'
  });
  if (tokens.refresh_token) hash.set('refresh_token', tokens.refresh_token);

  const dest = frontendStudioUrl().replace(/\/?$/, '/') + '?google=connected#' + hash.toString();
  res.writeHead(302, { Location: dest });
  res.end();
}
