/**
 * GET /api/airreach/app-config — ログイン画面（/airreach/app/）が Supabase Auth に接続するための公開設定。
 * 返すのは Supabase の URL と anon key（公開前提の鍵）だけ。service_role key は返さない。
 * どの行を読み書きできるかは Supabase の RLS（migration 20260930120000）で決まる。
 */
import { sendJson, withApi } from './_lib/http.js';
import { env } from './_lib/env.js';

export default withApi(async function handler(req, res) {
  const cfg = env();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    sendJson(res, 503, { ok: false, error: 'app_not_configured' });
    return 503;
  }
  res.setHeader('Cache-Control', 'no-store');
  sendJson(res, 200, { ok: true, supabaseUrl: cfg.supabaseUrl, supabaseAnonKey: cfg.supabaseAnonKey });
  return 200;
}, { methods: ['GET'] });
