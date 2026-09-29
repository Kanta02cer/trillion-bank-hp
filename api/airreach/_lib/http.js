/**
 * Vercel Node.js Functions（(req, res) 形式）向けの共通処理。
 *  - Origin 方針: same-origin は常に許可。別オリジンは AIRREACH_ALLOWED_ORIGINS にあるときだけ CORS 付きで許可。
 *    それ以外の別オリジンは 403。Origin ヘッダなし（非ブラウザ）は通す。Origin は認証ではない。
 *  - 本文: Vercel が req.body を解釈済みのことがあるため、文字列 / オブジェクト両方を受ける。
 *  - ログ: JSON 1 行。鍵・トークン・本文は載せない。
 */
import { ApiError } from './errors.js';
import { env } from './env.js';

const SERVICE = 'airreach-api';

export function requestOrigin(req) {
  // Vercel は x-forwarded-proto を常に付ける。無い環境（ローカル）はソケットから判定する
  const fallbackProto = req.socket && req.socket.encrypted ? 'https' : 'http';
  const proto = String(req.headers['x-forwarded-proto'] || fallbackProto).split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

/** 戻り値: { corsOrigin } corsOrigin が非 null のときだけ CORS ヘッダを付ける。 */
export function applyOriginPolicy(req, res, { methods }) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  if (!origin) return { corsOrigin: null };
  if (origin === requestOrigin(req)) return { corsOrigin: null };
  const allowed = env().allowedOrigins;
  if (!allowed.includes(origin)) throw ApiError.originNotAllowed();
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', methods.join(', '));
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
  return { corsOrigin: origin };
}

export function baseHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function sendError(res, err) {
  const apiErr = err instanceof ApiError ? err : ApiError.internal(err instanceof Error ? err.message.slice(0, 120) : 'unknown');
  sendJson(res, apiErr.status, { ok: false, error: { code: apiErr.code, message: apiErr.message, details: apiErr.details } });
  return apiErr;
}

/** JSON 本文を上限付きで取り出す。Content-Type 不正 / JSON 不正は 400、上限超過は 413。 */
export function readJsonBody(req, maxBytes) {
  const contentType = String(req.headers['content-type'] || '');
  if (!/^application\/json\s*(;.*)?$/i.test(contentType)) throw ApiError.badRequest('Content-Type must be application/json');
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw ApiError.payloadTooLarge();

  let body = req.body;
  if (body === undefined || body === null || body === '') throw ApiError.badRequest('Request body is required');
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > maxBytes) throw ApiError.payloadTooLarge();
    try { body = JSON.parse(body); } catch { throw ApiError.badRequest('Body must be valid JSON'); }
  } else if (Buffer.byteLength(JSON.stringify(body), 'utf8') > maxBytes) {
    throw ApiError.payloadTooLarge();
  }
  return body;
}

export function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '');
  return (xf.split(',')[0] || '').trim() || req.socket?.remoteAddress || 'unknown';
}

/** 共有トークンや URL クエリはログに残さない。 */
export function redactedPath(req) {
  const p = String(req.url || '').split('?')[0];
  return p.replace(/(\/shared-scans\/)[^/]+/, '$1[redacted]');
}

export function log(fields) {
  try { console.log(JSON.stringify({ service: SERVICE, at: new Date().toISOString(), ...fields })); } catch { /* ignore */ }
}

/**
 * ハンドラを包む: 共通ヘッダ、Origin 方針、OPTIONS、メソッド制限、例外→JSON エラー、ログ。
 * handler(req, res, ctx) は成功時に自分で応答を書き、ステータスを返す。
 */
export function withApi(handler, { methods }) {
  return async function vercelHandler(req, res) {
    const started = Date.now();
    baseHeaders(res);
    let status = 0;
    try {
      const { corsOrigin } = applyOriginPolicy(req, res, { methods: [...methods, 'OPTIONS'] });
      if (req.method === 'OPTIONS') {
        res.statusCode = corsOrigin ? 204 : 204;
        res.end();
        status = 204;
        return;
      }
      if (!methods.includes(req.method)) {
        res.setHeader('Allow', methods.join(', '));
        throw ApiError.methodNotAllowed();
      }
      status = (await handler(req, res, { corsOrigin })) || res.statusCode || 200;
      log({ event: 'request', method: req.method, path: redactedPath(req), status, ms: Date.now() - started });
    } catch (err) {
      const apiErr = sendError(res, err);
      status = apiErr.status;
      log({ event: status >= 500 ? 'error' : 'rejected', method: req.method, path: redactedPath(req), status, code: apiErr.code, hint: apiErr.logHint, ms: Date.now() - started });
    }
  };
}
