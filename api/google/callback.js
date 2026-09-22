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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  const { code, state } = req.query || {};
  const cookies = parseCookies(req.headers.cookie || '');
  if (!code || !state || state !== cookies.airreach_google_state) {
    return res.status(400).send('Invalid OAuth state');
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${getOrigin(req)}/api/google/callback`;
  if (!clientId || !clientSecret) return res.status(500).send('Google OAuth is not configured');

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
  if (!tokenRes.ok) return res.status(400).json(tokens);

  const secure = 'Path=/; HttpOnly; Secure; SameSite=Lax';
  const cookieHeaders = [
    `airreach_google_access=${encodeURIComponent(tokens.access_token || '')}; ${secure}; Max-Age=${Number(tokens.expires_in || 3600)}`,
    `airreach_google_state=; ${secure}; Max-Age=0`
  ];
  if (tokens.refresh_token) {
    cookieHeaders.push(`airreach_google_refresh=${encodeURIComponent(tokens.refresh_token)}; ${secure}; Max-Age=2592000`);
  }
  res.setHeader('Set-Cookie', cookieHeaders);
  res.writeHead(302, { Location: '/airreach/studio/?google=connected' });
  res.end();
}

function parseCookies(raw) {
  return raw.split(';').reduce((acc, pair) => {
    const idx = pair.indexOf('=');
    if (idx > -1) acc[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    return acc;
  }, {});
}
function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers.host}`;
}
