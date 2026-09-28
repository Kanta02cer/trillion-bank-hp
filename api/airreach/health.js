/**
 * GET /api/airreach/health — 疎通確認。DB には触れない。
 */
import { sendJson, withApi } from './_lib/http.js';

export default withApi(async function handler(req, res) {
  sendJson(res, 200, { ok: true, service: 'airreach-api', version: 'v1', runtime: `node ${process.versions.node}` });
  return 200;
}, { methods: ['GET'] });
