/**
 * サーバー側の環境変数（Vercel Environment Variables）。
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は server-side 専用。NEXT_PUBLIC_ 等の公開 prefix は付けない。
 */
export function env() {
  const e = process.env;
  const num = (v, def, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min ? Math.min(n, max) : def;
  };
  return {
    supabaseUrl: (e.SUPABASE_URL || '').trim().replace(/\/+$/, ''),
    supabaseServiceRoleKey: (e.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
    /** カンマ区切り。未設定なら CORS ヘッダを一切出さない（本番は same-origin 前提） */
    allowedOrigins: (e.AIRREACH_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    maxBodyBytes: num(e.AIRREACH_MAX_BODY_BYTES, 262_144, 1_024, 1_048_576),
    supabaseTimeoutMs: num(e.AIRREACH_SUPABASE_TIMEOUT_MS, 8_000, 500, 30_000),
    fetchTimeoutMs: num(e.AIRREACH_FETCH_TIMEOUT_MS, 9_000, 500, 60_000),
    fetchMaxBytes: num(e.AIRREACH_FETCH_MAX_BYTES, 900_000, 10_000, 5_000_000),
  };
}
