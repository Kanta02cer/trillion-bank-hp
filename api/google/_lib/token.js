/**
 * Google のアクセストークンを Cookie から取り出す（期限切れなら refresh_token で取り直す）。
 * clientId を渡すと、その顧客だけのつながり（ダッシュボードの顧客の画面からつないだもの）を使う。
 *   顧客ごと: airreach_g_<uuidの32桁>_a（アクセス）/ _r（リフレッシュ）/ _s（許可された機能）/ _e（アカウントのメール）
 *   共通（Studio の取り込み画面からつないだもの）: airreach_google_access / airreach_google_refresh
 */
export function clientKey(clientId) {
  const id = String(clientId || '').toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id.replace(/-/g, '') : '';
}
export function cookieNames(clientId) {
  const k = clientKey(clientId);
  if (!k) return { access: 'airreach_google_access', refresh: 'airreach_google_refresh', scopes: 'airreach_google_scopes', email: 'airreach_google_email' };
  return { access: `airreach_g_${k}_a`, refresh: `airreach_g_${k}_r`, scopes: `airreach_g_${k}_s`, email: `airreach_g_${k}_e` };
}
export function parseCookies(raw) {
  return String(raw || '').split(';').reduce((acc, pair) => {
    const i = pair.indexOf('=');
    if (i > -1) { try { acc[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim()); } catch (e) {} }
    return acc;
  }, {});
}
export async function getAccessToken(req, clientId) {
  const n = cookieNames(clientId);
  const cookies = parseCookies(req.headers.cookie || '');
  if (cookies[n.access]) return cookies[n.access];
  if (!cookies[n.refresh]) return null;
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
    refresh_token: cookies[n.refresh],
    grant_type: 'refresh_token'
  });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await r.json().catch(() => ({}));
  return r.ok ? data.access_token : null;
}
/** リクエストの顧客 ID（POST の body.clientId か、GET の ?client=） */
export function requestClientId(req) {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  return clientKey(b.clientId || (req.query || {}).client) ? String(b.clientId || (req.query || {}).client) : '';
}
