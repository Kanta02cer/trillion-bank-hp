/**
 * POST /api/airreach/scans — 診断結果を保存し、共有トークンを 1 回だけ返す。
 *
 *  ブラウザ → この関数 → Supabase RPC airreach_insert_scan（AirReach Project）
 *
 *  - 受信 JSON を検証し、検証済みの値だけで RPC 引数を組み立てる（_lib/validate.js, _lib/mapper.js）
 *  - share_token はここで生成し、DB には SHA-256 だけを渡す（_lib/share-token.js）
 *  - Supabase へはテーブルではなく RPC だけ（_lib/supabase.js）
 *  - Rate Limit は Vercel Firewall で設定する（docs/airreach-vercel-api.md）。コード内には持たない
 */
import { env } from './_lib/env.js';
import { readJsonBody, sendJson, withApi } from './_lib/http.js';
import { buildInsertArgs } from './_lib/mapper.js';
import { generateShareToken, sha256Hex } from './_lib/share-token.js';
import { SupabaseRpc } from './_lib/supabase.js';
import { validateScanRequest } from './_lib/validate.js';

export default withApi(async function handler(req, res) {
  const cfg = env();
  const body = readJsonBody(req, cfg.maxBodyBytes);
  const validated = validateScanRequest(body);

  const shareToken = generateShareToken();
  const shareTokenHash = await sha256Hex(shareToken);

  const supabase = new SupabaseRpc(cfg);
  const scanId = await supabase.insertScan(buildInsertArgs(validated, shareTokenHash));

  sendJson(res, 201, {
    ok: true,
    scanId,
    shareToken,
    sharePath: `/airreach/result/?share=${shareToken}`,
    savedAt: new Date().toISOString(),
  });
  return 201;
}, { methods: ['POST'] });
