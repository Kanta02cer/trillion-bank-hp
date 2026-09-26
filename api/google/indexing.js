/**
 * Google Indexing API for JobPosting / livestream pages.
 * POST /api/google/indexing/
 * body: {
 *   url: string,
 *   type: 'URL_UPDATED' | 'URL_DELETED',
 *   lifecycle?: 'published' | 'updated' | 'closed' | 'removed',
 *   confirm: true,   // human approval required
 *   dryRun?: boolean
 * }
 * GET  /api/google/indexing/?url=...  → metadata (if configured)
 * GET  /api/google/indexing/          → { configured: boolean }
 *
 * Credentials (Vercel env only — never commit):
 *   GOOGLE_INDEXING_CLIENT_EMAIL
 *   GOOGLE_INDEXING_PRIVATE_KEY   (PEM, \n escaped OK)
 *
 * Does NOT guarantee crawl, index, or Job search inclusion.
 */
import crypto from 'crypto';

const SCOPE = 'https://www.googleapis.com/auth/indexing';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PUBLISH_URL = 'https://indexing.googleapis.com/v3/urlNotifications:publish';
const META_URL = 'https://indexing.googleapis.com/v3/urlNotifications/metadata';

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'GET') {
    const url = (req.query && req.query.url) || null;
    if (!url) {
      return json(res, 200, {
        configured: isConfigured(),
        evidenceClass: 'Planned',
        note: 'Indexing API は JobPosting / ライブ配信向け。掲載・順位は保証しません。サービスアカウントを Search Console 所有者に追加する必要があります。'
      });
    }
    if (!isConfigured()) {
      return json(res, 503, { error: 'GOOGLE_INDEXING_* is not configured', configured: false });
    }
    try {
      const token = await getServiceAccessToken();
      const meta = await fetchMetadata(token, String(url));
      return json(res, 200, {
        evidenceClass: 'Official',
        source: 'Google Indexing API metadata',
        configured: true,
        ...meta
      });
    } catch (e) {
      return json(res, 502, { error: String(e && e.message ? e.message : e), configured: true });
    }
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const targetUrl = String(body.url || '').trim();
  const type = String(body.type || '').trim().toUpperCase();
  const lifecycle = String(body.lifecycle || '').trim() || null;
  const dryRun = !!body.dryRun;
  const confirm = body.confirm === true;

  if (!targetUrl) return json(res, 400, { error: 'url is required' });
  if (type !== 'URL_UPDATED' && type !== 'URL_DELETED') {
    return json(res, 400, { error: 'type must be URL_UPDATED or URL_DELETED' });
  }
  if (!confirm && !dryRun) {
    return json(res, 400, {
      error: 'confirm:true is required (human approval). Use dryRun:true to preview without notifying Google.'
    });
  }

  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return json(res, 400, { error: 'url must be a valid absolute URL' });
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    return json(res, 400, { error: 'Only http/https URLs are supported' });
  }

  const event = {
    url: parsed.href,
    type,
    lifecycle,
    requestedAt: new Date().toISOString(),
    dryRun,
    evidenceClass: dryRun ? 'Planned' : 'Official'
  };

  if (dryRun || !isConfigured()) {
    return json(res, 200, {
      ok: true,
      notified: false,
      configured: isConfigured(),
      mode: dryRun ? 'dry_run' : 'not_configured',
      event,
      disclaimer: 'Google への通知は行っていません。Indexing API 通知はクロール・インデックス・求人掲載を保証しません。',
      next: !isConfigured()
        ? 'Vercel に GOOGLE_INDEXING_CLIENT_EMAIL / GOOGLE_INDEXING_PRIVATE_KEY を設定し、サービスアカウントを Search Console 所有者に追加してください。'
        : 'confirm:true で本番通知できます。'
    });
  }

  try {
    const token = await getServiceAccessToken();
    const published = await publishNotification(token, parsed.href, type);
    return json(res, 200, {
      ok: true,
      notified: true,
      configured: true,
      mode: 'live',
      event: Object.assign({}, event, {
        notifiedAt: new Date().toISOString(),
        googleResponse: published
      }),
      disclaimer: '通知を受け付けました。クロール・インデックス・Google求人検索への掲載は保証されません。'
    });
  } catch (e) {
    return json(res, 502, {
      ok: false,
      notified: false,
      configured: true,
      error: String(e && e.message ? e.message : e),
      event
    });
  }
}

function isConfigured() {
  return !!(process.env.GOOGLE_INDEXING_CLIENT_EMAIL && process.env.GOOGLE_INDEXING_PRIVATE_KEY);
}

function getPrivateKey() {
  let key = process.env.GOOGLE_INDEXING_PRIVATE_KEY || '';
  key = key.replace(/\\n/g, '\n').trim();
  if (!key.includes('BEGIN')) {
    throw new Error('GOOGLE_INDEXING_PRIVATE_KEY looks invalid');
  }
  return key;
}

async function getServiceAccessToken() {
  const email = process.env.GOOGLE_INDEXING_CLIENT_EMAIL;
  if (!email) throw new Error('GOOGLE_INDEXING_CLIENT_EMAIL is not configured');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  };
  const unsigned = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claim));
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  sign.end();
  const signature = sign.sign(getPrivateKey());
  const jwt = unsigned + '.' + base64url(signature);

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: jwt
  });
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) {
    throw new Error('token exchange failed: ' + (data.error_description || data.error || r.status));
  }
  return data.access_token;
}

async function publishNotification(token, url, type) {
  const r = await fetch(PUBLISH_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url, type })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data.error && data.error.message ? data.error.message : ('Indexing API HTTP ' + r.status));
  }
  return data;
}

async function fetchMetadata(token, url) {
  const r = await fetch(META_URL + '?url=' + encodeURIComponent(url), {
    headers: { Authorization: 'Bearer ' + token }
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data.error && data.error.message ? data.error.message : ('metadata HTTP ' + r.status));
  }
  return {
    url,
    latestUpdate: data.latestUpdate || null,
    latestRemove: data.latestRemove || null,
    raw: data
  };
}

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

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
  res.setHeader('Vary', 'Origin');
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}
