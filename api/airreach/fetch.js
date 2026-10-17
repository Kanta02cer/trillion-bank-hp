/**
 * GET /api/airreach/fetch?url=... — 診断対象の公開ページ / llms.txt / robots.txt を取得する。
 * ops/airreach-fetch（Cloudflare Worker）の置き換え。仕様は _lib/fetch-proxy.js を参照。
 *
 *  - 応答本文は取得した文書そのもの（保存はしない）
 *  - X-AirReach-Final-URL にリダイレクト後の URL を入れる
 *  - 404 / 410 はそのままの状態コードで空本文を返す（「無い」と「取れない」を区別するため）
 *  - エラーは 400（URL 不正・拒否ホスト）/ 502（上流エラー・種別・サイズ）/ 504（タイムアウト）
 */
import { env } from './_lib/env.js';
import { ApiError } from './_lib/errors.js';
import { withApi } from './_lib/http.js';
import { fetchPublicDocument, sanitizeTargetUrl } from './_lib/fetch-proxy.js';

export default withApi(async function handler(req, res) {
  const raw = req.query && req.query.url;
  if (!raw || typeof raw !== 'string') throw ApiError.badRequest('Missing url query parameter');
  const cfg = env();
  const target = sanitizeTargetUrl(raw);
  const upstream = await fetchPublicDocument(target, { timeoutMs: cfg.fetchTimeoutMs, maxBytes: cfg.fetchMaxBytes });

  res.statusCode = upstream.status;
  res.setHeader('Content-Type', upstream.contentType);
  res.setHeader('X-AirReach-Final-URL', upstream.finalUrl);
  res.setHeader('Access-Control-Expose-Headers', 'X-AirReach-Final-URL');
  res.setHeader('Cache-Control', 'private, max-age=60');
  if (req.method === 'HEAD') {
    res.end();
  } else {
    res.end(upstream.body);
  }
  return upstream.status;
}, { methods: ['GET', 'HEAD'] });
