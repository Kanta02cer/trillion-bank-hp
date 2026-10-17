/**
 * お客様の Google のつながりをサーバーに保管する（DB の google_connections。20261017120000_airreach_google_connections.sql）。
 *   呼ぶのはサーバーだけ（service_role の鍵はヘッダーにだけ載せ、応答・記録に出さない）。
 *   トークンは _lib/crypto.js で暗号化してから渡す。DB 側も暗号化していないものは受け付けない。
 */
import { encryptToken, decryptToken, canStoreTokens } from './crypto.js';

function cfg(env) {
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  return url && key ? { url, key } : null;
}

export async function rpc(name, args, env = process.env, fetchImpl = globalThis.fetch) {
  const c = cfg(env);
  if (!c) return { ok: false, reason: 'not_configured' };
  try {
    const r = await fetchImpl(`${c.url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: c.key, Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(10000)
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, reason: 'rpc_failed', status: r.status };
    if (d && typeof d === 'object' && !Array.isArray(d) && 'ok' in d) return d;
    return { ok: true, data: d };
  } catch (e) {
    return { ok: false, reason: 'rpc_failed' };
  }
}

/** Google の同意から戻ったとき。鍵か DB の設定が無ければ保管しない（{ ok:false, reason:'not_configured' }） */
export async function storeConnection({ clientId, refreshToken, features, googleEmail }, env = process.env, fetchImpl) {
  if (!canStoreTokens(env) || !cfg(env)) return { ok: false, reason: 'not_configured' };
  if (!clientId || !refreshToken) return { ok: false, reason: 'bad_request' };
  const enc = encryptToken(refreshToken, env);
  return rpc('airreach_save_google_connection', { p_client_id: clientId, p_token_enc: enc, p_scopes: features || [], p_google_email: googleEmail || null }, env, fetchImpl);
}

export function setGscProperty({ clientId, property, permission, setBy }, env = process.env, fetchImpl) {
  return rpc('airreach_set_gsc_property', { p_client_id: clientId, p_property: property, p_permission: permission || null, p_set_by: setBy || null }, env, fetchImpl);
}

export function saveGscQueries({ clientId, period, property, rows }, env = process.env, fetchImpl) {
  return rpc('airreach_save_gsc_queries', { p_client_id: clientId, p_period_month: period, p_property: property, p_rows: rows }, env, fetchImpl);
}

export function markSync(clientId, status, error, env = process.env, fetchImpl) {
  return rpc('airreach_mark_google_sync', { p_client_id: clientId, p_status: status, p_error: error || null }, env, fetchImpl);
}

export function deleteConnection(clientId, env = process.env, fetchImpl) {
  return rpc('airreach_delete_google_connection', { p_client_id: clientId }, env, fetchImpl);
}

export async function syncTargets(env = process.env, fetchImpl) {
  const r = await rpc('airreach_google_sync_targets', {}, env, fetchImpl);
  return r.ok && Array.isArray(r.data) ? r.data : [];
}

/** 保管したトークンの行（サーバーだけ。トークンは暗号化されたまま） */
export async function loadConnection(clientId, env = process.env, fetchImpl = globalThis.fetch) {
  const c = cfg(env);
  if (!c || !/^[0-9a-f-]{36}$/i.test(String(clientId || ''))) return null;
  try {
    const r = await fetchImpl(`${c.url}/rest/v1/google_connections?client_id=eq.${encodeURIComponent(clientId)}&select=client_id,refresh_token_enc,gsc_property,scopes`, {
      headers: { apikey: c.key, Authorization: 'Bearer ' + c.key },
      signal: AbortSignal.timeout(8000)
    });
    const d = r.ok ? await r.json().catch(() => []) : [];
    return Array.isArray(d) && d[0] ? d[0] : null;
  } catch (e) { return null; }
}

/**
 * 保管したトークンから Google のアクセストークンを取る。
 * 戻り値 { token } か { error: 'not_connected' | 'token_revoked' | 'refresh_failed' }
 */
export async function accessTokenFromStored(row, env = process.env, fetchImpl = globalThis.fetch) {
  const refresh = row && decryptToken(row.refresh_token_enc, env);
  if (!refresh) return { error: 'not_connected' };
  try {
    const r = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID || '', client_secret: env.GOOGLE_CLIENT_SECRET || '', refresh_token: refresh, grant_type: 'refresh_token' }),
      signal: AbortSignal.timeout(10000)
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.access_token) return { token: d.access_token };
    // お客様が Google 側で許可を取り消した・パスワードを変えた など
    if (d && d.error === 'invalid_grant') return { error: 'token_revoked' };
    return { error: 'refresh_failed' };
  } catch (e) { return { error: 'refresh_failed' }; }
}
