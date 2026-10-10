/**
 * お客様が自分で Google とつないで取り込むとき、計測サーバーが Google から読んだ数字を、サーバーだけが保存する。
 *   画面からは数字を送らない（作った数字を入れられないように）。保存は DB の airreach_save_google_traffic（service_role だけが呼べる）。
 *   その関数が、契約中か・選んだサイトがその顧客に登録したサイトと同じかを確かめる
 *   （supabase/migrations/20261010120000_airreach_save_google_traffic.sql）。service_role の鍵はヘッダーにだけ載せ、応答・記録に出さない。
 */
import { cookieNames, parseCookies } from './token.js';

const REASON = {
  site_mismatch: '選んだサイトが、この顧客に登録したサイトと違うため保存しませんでした。お店のサイトを選んでください。',
  not_contracted: 'この顧客は契約中でないため、保存しませんでした。',
  no_site: 'この顧客のサイトが登録されていないため、保存しませんでした。担当者にご連絡ください。'
};

/** 取り込む月（YYYY-MM-01）。startDate（YYYY-MM-DD）から。形が違えば '' */
export function periodOf(startDate) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(startDate || ''));
  return m ? `${m[1]}-${m[2]}-01` : '';
}

/** ログインのトークン（Supabase の JWT）のメールアドレス。トークンの正しさは googleAccess（DB）が先に確かめている */
export function jwtEmail(req) {
  try {
    const h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
    const part = (/^Bearer\s+([A-Za-z0-9._-]+)$/.exec(h.trim()) || [])[1].split('.')[1];
    const j = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return j && typeof j.email === 'string' ? j.email.toLowerCase().slice(0, 200) : '';
  } catch (e) { return ''; }
}

/** この顧客の Google のつながりのアカウント（Cookie。表示と記録のため） */
export function googleEmailOf(req, clientId) {
  const ck = parseCookies(req.headers && req.headers.cookie);
  return String(ck[cookieNames(clientId).email] || '').slice(0, 200) || null;
}

/**
 * 保存する。戻り値 { ok: true } か { ok: false, status, code, error }
 */
export async function saveTraffic({ clientId, period, source, metrics, savedBy }, env = process.env, fetchImpl = globalThis.fetch) {
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return { ok: false, status: 503, code: 'save_not_configured', error: '保存の設定がないため、取り込んだ数字を保存できませんでした。担当者にご連絡ください。' };
  if (!/^[0-9a-f-]{36}$/i.test(String(clientId || '')) || !period) return { ok: false, status: 400, code: 'bad_request', error: '顧客と月を指定してください。' };
  try {
    const r = await fetchImpl(url + '/rest/v1/rpc/airreach_save_google_traffic', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_client_id: clientId, p_period_month: period, p_source: source, p_metrics: metrics, p_saved_by: savedBy || null }),
      signal: AbortSignal.timeout(8000)
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, status: 502, code: 'save_failed', error: '取り込んだ数字を保存できませんでした。少し待ってからもう一度お試しください。' };
    if (d && d.ok === true) return { ok: true };
    const reason = (d && d.reason) || 'save_failed';
    return { ok: false, status: reason === 'site_mismatch' ? 409 : 403, code: reason, error: REASON[reason] || '取り込んだ数字を保存できませんでした。' };
  } catch (e) {
    return { ok: false, status: 502, code: 'save_failed', error: '取り込んだ数字を保存できませんでした。少し待ってからもう一度お試しください。' };
  }
}
