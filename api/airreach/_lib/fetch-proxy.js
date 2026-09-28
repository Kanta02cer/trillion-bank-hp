/**
 * 公開ページ取得（ops/airreach-fetch/src/index.ts からの移植。Cloudflare 固有の cf オプションを除去）。
 *  - http/https のみ、認証情報とトークンらしきクエリを除去
 *  - プライベート IP / localhost / 内部ホスト拒否（リテラルと DNS 解決先の両方）
 *  - リダイレクトは最大 3 回、各ホップで再検査
 *  - タイムアウト、本文サイズ上限（ストリームで打ち切り）
 *  - 404 / 410 は「取得できて無い」としてそのまま返す
 *  - 生 HTML は保存しない（呼び出し元へ返すだけ）
 */
import { ApiError } from './errors.js';
import { UrlIssue, assertPublicHostname, assertResolvesPublic, sanitizeHttpUrl } from './url.js';

export const USER_AGENT = 'TrillionBank-AirReach/1.0 (+https://trillion-bank.jp/airreach/; readiness-check)';
const MAX_REDIRECTS = 3;
const ALLOWED_CONTENT_TYPE_RE = /^(text\/html|application\/xhtml\+xml|text\/plain|text\/markdown|application\/json)/i;

export function sanitizeTargetUrl(input) {
  try {
    return new URL(sanitizeHttpUrl(input, { keepHash: false }));
  } catch (e) {
    throw ApiError.badRequest(e instanceof UrlIssue ? `URL ${e.message}` : 'URL is invalid');
  }
}

/**
 * @returns {Promise<{status:number, body:string, contentType:string, finalUrl:string}>}
 */
export async function fetchPublicDocument(start, { timeoutMs, maxBytes }) {
  let current = start;
  const deadline = Date.now() + timeoutMs;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    try {
      assertPublicHostname(current);
      await assertResolvesPublic(current.hostname);
    } catch (e) {
      throw ApiError.badRequest(e instanceof UrlIssue ? `URL ${e.message}` : 'URL is invalid');
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw ApiError.upstream(504, 'Upstream timeout', 'fetch_timeout');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    let response;
    try {
      response = await fetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
          'User-Agent': USER_AGENT,
          'Accept-Language': 'ja,en;q=0.8',
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
      if (/abort/i.test(msg)) throw ApiError.upstream(504, 'Upstream timeout', 'fetch_timeout');
      throw ApiError.upstream(502, 'Fetch failed', `fetch_error ${msg.slice(0, 80)}`);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      clearTimeout(timer);
      try { await response.body?.cancel(); } catch { /* ignore */ }
      const location = response.headers.get('location');
      if (!location) throw ApiError.upstream(502, 'Redirect without Location', 'redirect_no_location');
      let next;
      try { next = new URL(location, current); } catch { throw ApiError.upstream(502, 'Redirect target is invalid', 'redirect_invalid'); }
      current = sanitizeTargetUrl(next.toString());
      continue;
    }

    if (response.status === 404 || response.status === 410) {
      clearTimeout(timer);
      try { await response.body?.cancel(); } catch { /* ignore */ }
      return { status: response.status, body: '', contentType: 'text/plain; charset=utf-8', finalUrl: current.toString() };
    }

    if (!response.ok) {
      clearTimeout(timer);
      try { await response.body?.cancel(); } catch { /* ignore */ }
      throw ApiError.upstream(502, `Upstream HTTP ${response.status}`, `upstream_${response.status}`);
    }

    const rawType = response.headers.get('content-type') || 'text/html; charset=utf-8';
    const mediaType = rawType.split(';')[0].trim();
    if (mediaType && !ALLOWED_CONTENT_TYPE_RE.test(mediaType)) {
      clearTimeout(timer);
      try { await response.body?.cancel(); } catch { /* ignore */ }
      throw ApiError.upstream(502, `Unsupported content type: ${mediaType.slice(0, 60)}`, 'unsupported_content_type');
    }
    const lengthHeader = response.headers.get('content-length');
    if (lengthHeader && Number(lengthHeader) > maxBytes) {
      clearTimeout(timer);
      try { await response.body?.cancel(); } catch { /* ignore */ }
      throw ApiError.upstream(502, 'Response too large', 'too_large_header');
    }

    let body;
    try {
      body = await readBodyLimited(response, maxBytes);
    } catch (err) {
      const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
      if (/too large/i.test(msg)) throw ApiError.upstream(502, 'Response too large', 'too_large_stream');
      if (/abort/i.test(msg)) throw ApiError.upstream(504, 'Upstream timeout', 'fetch_timeout_body');
      throw ApiError.upstream(502, 'Fetch failed', `body_error ${msg.slice(0, 80)}`);
    } finally {
      clearTimeout(timer);
    }
    return { status: response.status, body, contentType: rawType, finalUrl: current.toString() };
  }
  throw ApiError.upstream(502, 'Too many redirects', 'too_many_redirects');
}

async function readBodyLimited(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Response too large');
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
}
