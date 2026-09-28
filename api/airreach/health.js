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
  sendJson(res, 200, {
    ok: true,
    service: 'airreach-api',
    version: 'v1',
    runtime: `node ${process.versions.node}`,
    config: {
      supabaseUrl: !!cfg.supabaseUrl,
      supabaseServiceRoleKey: !!cfg.supabaseServiceRoleKey,
      supabaseHost,
      allowedOrigins: cfg.allowedOrigins.length,
    },
  });
  return 200;
}, { methods: ['GET'] });
