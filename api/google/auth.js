import { OAUTH_SCOPES } from './_lib/scopes.js';

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
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${getOrigin(req)}/api/google/callback`;
  if (!clientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID is not configured' });

  const state = randomState();
  // 戻り先：ダッシュボードの「検索と訪問の数字を入れる」から始めたときは、そこへ戻す（?back=app&client=<uuid>）。
  // 値は決まった形だけ受け付け、Cookie に入れて callback で使う（任意の URL へは戻さない）
  const q = req.query || {};
  const back = q.back === 'app' && /^[0-9a-f-]{36}$/i.test(String(q.client || '')) ? `app:${String(q.client).toLowerCase()}` : '';
  const cookies = [`airreach_google_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    `airreach_google_back=${back}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${back ? 600 : 0}`];
  res.setHeader('Set-Cookie', cookies);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    // いまは Search Console（webmasters.readonly）だけ。GA4 は準備中（_lib/scopes.js）
    scope: OAUTH_SCOPES.join(' ')
  });
  res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  res.end();
}

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  return `${proto}://${host}`;
}
function randomState() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}
