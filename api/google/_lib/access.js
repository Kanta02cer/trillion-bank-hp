/**
 * Google 連携を使ってよい人か（AirReach の社内スタッフか、契約中の顧客のメンバー）。
 *   ブラウザは AirReach のログイン（Supabase Auth）のトークンを Authorization: Bearer で付ける。
 *   判定は DB の RPC airreach_google_access(p_client_id)（supabase/migrations/20261007150000_airreach_google_data_governance.sql）。
 *   ログインしていない・契約していない人は、OAuth を始められず、Search Console / GA4 も読めない。
 * トークンは記録・応答に出さない。結果は 5 分だけ覚える（同じ画面で何度も呼ぶため）。
 */
const cache = new Map();

export function bearerToken(req) {
  const h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const m = /^Bearer\s+([A-Za-z0-9._-]{20,4096})$/.exec(h.trim());
  return m ? m[1] : '';
}

/**
 * 戻り値: { ok: true, role } か { ok: false, status, code, error }
 *   clientId: 顧客の画面から使うときの顧客 ID（形が正しいものだけ。無ければ null）
 */
export async function googleAccess(req, clientId, env = process.env, fetchImpl = globalThis.fetch) {
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, code: 'login_required', error: 'Google 連携を使うには、AirReach に社内の人か契約中のお客様としてログインしてください。' };
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anon = String(env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !anon) return { ok: false, status: 503, code: 'auth_not_configured', error: 'ログインの確認ができないため、Google 連携を止めています。' };
  const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(clientId || '')) ? String(clientId).toLowerCase() : null;
  const key = token + '|' + (id || '');
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.result;
  let result;
  try {
    const r = await fetchImpl(url + '/rest/v1/rpc/airreach_google_access', {
      method: 'POST',
      headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_client_id: id }),
      signal: AbortSignal.timeout(5000)
    });
    const data = r.ok ? await r.json().catch(() => null) : null;
    if (data && data.allowed === true) result = { ok: true, role: data.role || '' };
    else if (r.status === 401 || (data && data.reason === 'login_required')) result = { ok: false, status: 401, code: 'login_required', error: 'ログインが切れています。AirReach にログインし直してください。' };
    else if (data && data.reason === 'contract_ended') result = { ok: false, status: 403, code: 'contract_ended', error: 'この顧客は契約が終わっているため、Google から新しく取得しません。' };
    else if (data && data.reason === 'not_contracted') result = { ok: false, status: 403, code: 'not_contracted', error: 'Google 連携は、AirReach の社内の人と、契約中のお客様だけが使えます。' };
    else result = { ok: false, status: 503, code: 'access_check_failed', error: 'ログインの確認ができなかったため、Google 連携を止めています。少し待ってからもう一度お試しください。' };
  } catch (e) {
    result = { ok: false, status: 503, code: 'access_check_failed', error: 'ログインの確認ができなかったため、Google 連携を止めています。少し待ってからもう一度お試しください。' };
  }
  // 失敗（503）は覚えない（一時的な障害で 5 分止めない）
  if (result.ok || result.status !== 503) {
    if (cache.size > 500) cache.clear();
    cache.set(key, { result, until: Date.now() + 5 * 60 * 1000 });
  }
  return result;
}

/** 断るときの応答（handler から使う） */
export function denyAccess(res, a) {
  return res.status(a.status).json({ error: a.error, code: a.code });
}
