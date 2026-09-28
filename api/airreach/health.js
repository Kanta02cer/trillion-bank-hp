/**
 * GET /api/airreach/health — 疎通確認。DB には触れず、環境変数の情報も返さない。
 * 環境変数や鍵の種別の切り分けは Vercel のログと Supabase の API ログで行う（docs/airreach-vercel-api.md）。
 */
import { sendJson, withApi } from './_lib/http.js';

export default withApi(async function handler(req, res) {
  sendJson(res, 200, { ok: true, service: 'airreach-api', version: 'v1' });
  return 200;
}, { methods: ['GET'] });
