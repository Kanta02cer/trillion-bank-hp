import { randomBytes } from 'node:crypto';
import { OAUTH_SCOPES, EMAIL_SCOPES } from './_lib/scopes.js';
import { cookieNames } from './_lib/token.js';
import { googleAccess, denyAccess } from './_lib/access.js';

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  // 切断（POST ?disconnect=1）：Google 側の許可を取り消し、このブラウザの接続（Cookie）を消す
  if (req.method === 'POST' && (req.query || {}).disconnect === '1') {
    const ck = parseCookies(req.headers.cookie || '');
    const N = cookieNames((req.query || {}).client); // ?client=<uuid> ならその顧客のつながりだけを切る
    const tok = ck[N.refresh] || ck[N.access];
    if (tok) { try { await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tok }) }); } catch (e) {} }
    const gone = (n, http) => `${n}=; Path=/; ${http ? 'HttpOnly; ' : ''}Secure; SameSite=Lax; Max-Age=0`;
    res.setHeader('Set-Cookie', [gone(N.access, true), gone(N.refresh, true), gone(N.scopes, false), gone(N.email, false)]);
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200; res.end(JSON.stringify({ ok: true, revoked: !!tok }));
    return;
  }
  // 接続の開始は POST だけ（ログインのトークンを付けて呼ぶ）。URL を開いただけでは Google の同意画面へ進まない
  if (req.method !== 'POST') return res.status(405).json({ error: 'Google への接続は、AirReach の画面の「接続」から始めてください。', code: 'post_required' });
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  // 担当者が分析・改善提案・月次レポート作成・サポートに必要な範囲で Google のデータを見ることへの同意（画面のチェック）
  if (body.consent !== true) return res.status(400).json({ error: '接続する前に、Google のデータの閲覧についての同意にチェックしてください。', code: 'consent_required' });
  // 戻り先：ダッシュボードの「検索と訪問の数字を入れる」から始めたときは、そこへ戻す（back: 'app', client: <uuid>）。
  // 値は決まった形だけ受け付け、Cookie に入れて callback で使う（任意の URL へは戻さない）
  const backClient = body.back === 'app' && /^[0-9a-f-]{36}$/i.test(String(body.client || '')) ? String(body.client).toLowerCase() : '';
  // 社内スタッフか、契約中の顧客のメンバーだけが始められる（顧客の画面からなら、その顧客について確かめる）
  const access = await googleAccess(req, backClient || null);
  if (!access.ok) return denyAccess(res, access);

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${getOrigin(req)}/api/google/callback`;
  if (!clientId) return res.status(500).json({ error: 'GOOGLE_CLIENT_ID is not configured' });

  const state = randomState();
  const back = backClient ? `app:${backClient}` : '';
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
    // Search Console・GA4 の読み取りと、接続したアカウントのメールアドレス（_lib/scopes.js）
    scope: OAUTH_SCOPES.concat(EMAIL_SCOPES).join(' ')
  });
  // 画面はこの URL へ移動する（Cookie の state は callback で確かめる）
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
}

function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  return `${proto}://${host}`;
}
function randomState() {
  return randomBytes(24).toString('base64url');
}

function parseCookies(raw) {
  return String(raw || '').split(';').reduce((acc, pair) => {
    const idx = pair.indexOf('=');
    if (idx > -1) { try { acc[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim()); } catch (e) {} }
    return acc;
  }, {});
}
