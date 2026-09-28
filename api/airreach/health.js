/**
 * GET /api/airreach/health — 疎通確認。DB には触れない。
 * 環境変数は「設定されているか」と Supabase のホスト名だけを返す（値は返さない）。
 */
import { env } from './_lib/env.js';
import { sendJson, withApi } from './_lib/http.js';

export default withApi(async function handler(req, res) {
  const cfg = env();
  let supabaseHost = null;
  try { supabaseHost = cfg.supabaseUrl ? new URL(cfg.supabaseUrl).host : null; } catch { supabaseHost = 'invalid'; }
  const keyRole = classifyKey(cfg.supabaseServiceRoleKey);
  sendJson(res, 200, {
    ok: true,
    service: 'airreach-api',
    version: 'v1',
    runtime: `node ${process.versions.node}`,
    config: {
      supabaseUrl: !!cfg.supabaseUrl,
      supabaseServiceRoleKey: !!cfg.supabaseServiceRoleKey,
      supabaseHost,
      /** 鍵の種別だけ（値は返さない）。service_role / secret 以外だと RPC は permission denied になる */
      keyRole,
      allowedOrigins: cfg.allowedOrigins.length,
    },
  });
  return 200;
}, { methods: ['GET'] });

/**
 * 鍵の種別を判定する（値やハッシュは返さない）。
 *  - 新形式: sb_secret_… → 'secret'（service_role 相当）、sb_publishable_… → 'publishable'（anon 相当。誤設定）
 *  - 旧形式 JWT: payload の role クレームを読む → 'service_role' / 'anon' など
 */
function classifyKey(key) {
  if (!key) return null;
  if (key.startsWith('sb_secret_')) return 'secret';
  if (key.startsWith('sb_publishable_')) return 'publishable';
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      return typeof payload.role === 'string' ? payload.role : 'jwt';
    } catch { return 'jwt'; }
  }
  return 'unknown';
}
