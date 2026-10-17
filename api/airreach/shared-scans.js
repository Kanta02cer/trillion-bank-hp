/**
 * GET /api/airreach/shared-scans/?shareToken=<token> — 共有トークンで保存済み診断を返す。
 *
 *  - Vercel の静的出力構成（framework null / outputDirectory "."）では api 配下の [param].js 動的セグメントが
 *    ルーティングされなかった（Preview で 404 を確認）ため、クエリ形式を正とする。
 *    パス形式 /api/airreach/shared-scans/:shareToken/ は vercel.json の rewrite でこの関数へ写す（docs 参照）。
 *  - トークン形式外・未登録・失効はすべて 404（存在の有無を漏らさない）
 *  - トークンは SHA-256 にしてから RPC airreach_get_shared_scan へ渡す。応答にハッシュは含まれない
 */
import { env } from './_lib/env.js';
import { ApiError } from './_lib/errors.js';
import { sendJson, withApi } from './_lib/http.js';
import { isShareTokenFormat, sha256Hex } from './_lib/share-token.js';
import { SupabaseRpc } from './_lib/supabase.js';

export default withApi(async function handler(req, res) {
  let token = '';
  try {
    token = decodeURIComponent(String((req.query && req.query.shareToken) || ''));
  } catch {
    throw ApiError.notFound('Shared scan not found');
  }
  if (!isShareTokenFormat(token)) throw ApiError.notFound('Shared scan not found');

  const supabase = new SupabaseRpc(env());
  const data = await supabase.getSharedScan(await sha256Hex(token));
  if (!data) throw ApiError.notFound('Shared scan not found');

  sendJson(res, 200, { ok: true, ...data });
  return 200;
}, { methods: ['GET'] });
