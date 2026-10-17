/**
 * 公開ページ取得（ops/airreach-fetch/src/index.ts からの移植 + 接続先固定）。
 *
 *  DNS リバインディング（TOCTOU）対策:
 *    「DNS で検証」と「HTTP 接続」で別々に名前解決が走ると、1 回目は公開 IP、2 回目は内部 IP を返す攻撃が成立する。
 *    そこで fetch() は使わず、Node 標準の http / https の `lookup` オプションで
 *    **検証済みの IP をそのまま接続先に返す**。ホスト名は `host` に渡すため Host ヘッダ・TLS の SNI・
 *    証明書検証（rejectUnauthorized）はホスト名のまま。リダイレクトのホップごとに再解決・再検証・再固定する。
 *
 *  - http/https のみ、認証情報とトークンらしきクエリを除去
 *  - 解決結果に 1 つでもプライベート / 予約 / 非グローバル IP があれば拒否（IPv4 / IPv6）
 *  - リダイレクトは最大 3 回、Location 無しは 502
 *  - タイムアウト、本文サイズ上限（ストリームで打ち切り。gzip / deflate / br は伸長後のサイズで判定）
 *  - 404 / 410 は「取得できて無い」としてそのまま返す
 *  - 生 HTML は保存しない（呼び出し元へ返すだけ）
 *  外部パッケージには依存しない（Vercel の Node 24 で動く）。
 */
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { ApiError } from './errors.js';
import { UrlIssue, assertPublicHostname, isIpLiteral, isPrivateOrReservedIp, sanitizeHttpUrl } from './url.js';

export const USER_AGENT = 'TrillionBank-AirReach/1.0 (+https://trillion-bank.jp/airreach/; readiness-check)';
const MAX_REDIRECTS = 3;
const ALLOWED_CONTENT_TYPE_RE = /^(text\/html|application\/xhtml\+xml|text\/plain|text\/markdown|application\/json)/i;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function loopbackAllowedForTests() {
  return process.env.AIRREACH_FETCH_ALLOW_LOOPBACK_FOR_TESTS === '1';
}

export function sanitizeTargetUrl(input) {
  try {
    return new URL(sanitizeHttpUrl(input, { keepHash: false }));
  } catch (e) {
    throw ApiError.badRequest(e instanceof UrlIssue ? `URL ${e.message}` : 'URL is invalid');
  }
}

/**
 * 既定のリゾルバ。全レコードを返す（verbatim: OS の順序）。
 * テスト時（ループバック許可フラグが有効なときだけ）AIRREACH_TEST_RESOLVE_MAP でホスト名→IP を上書きできる。
 */
export async function defaultResolveHost(hostname) {
  if (loopbackAllowedForTests() && process.env.AIRREACH_TEST_RESOLVE_MAP) {
    try {
      const map = JSON.parse(process.env.AIRREACH_TEST_RESOLVE_MAP);
      if (Object.prototype.hasOwnProperty.call(map, hostname)) {
        return [].concat(map[hostname]).map((a) => ({ address: String(a), family: String(a).includes(':') ? 6 : 4 }));
      }
    } catch { /* fall through to real DNS */ }
  }
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  // 実 DNS の応答であることを示す（テスト時でも実 DNS がループバックを返したら拒否するため）
  return Object.assign(records, { realDns: true });
}

/**
 * ホスト名を解決し、全アドレスを検証したうえで接続に使う 1 つを返す（IPv4 優先）。
 * IP リテラルは検証してそのまま返す。
 * @returns {Promise<{address:string, family:4|6}>}
 */
export async function resolvePinnedAddress(hostname, resolveHost = defaultResolveHost) {
  const host = String(hostname).toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  const allowLoop = loopbackAllowedForTests();
  const rejectUnlessAllowed = (a, msg) => {
    if (a === '127.0.0.1' && allowLoop) return;
    if (isPrivateOrReservedIp(a)) throw new UrlIssue(msg);
  };
  if (isIpLiteral(host)) {
    rejectUnlessAllowed(host, 'private, reserved or non-global IP is not allowed');
    return { address: host, family: host.includes(':') ? 6 : 4 };
  }
  let records;
  try {
    records = await resolveHost(host);
  } catch {
    throw new UrlIssue('hostname could not be resolved');
  }
  if (!Array.isArray(records) || records.length === 0) throw new UrlIssue('hostname could not be resolved');
  for (const r of records) {
    const a = String(r.address);
    // テスト用のループバック許可は「リテラル 127.0.0.1」と「注入リゾルバ / テスト用マップ」だけ。実 DNS の応答には適用しない
    if (records.realDns || !allowLoop || a !== '127.0.0.1') {
      if (isPrivateOrReservedIp(a)) throw new UrlIssue('hostname resolves to a private, reserved or non-global address');
    }
  }
  const pick = records.find((r) => !String(r.address).includes(':')) || records[0];
  const address = String(pick.address);
  return { address, family: address.includes(':') ? 6 : 4 };
}

/**
 * @param {URL} start
 * @param {{timeoutMs:number, maxBytes:number, resolveHost?:Function}} opts
 * @returns {Promise<{status:number, body:string, contentType:string, finalUrl:string}>}
 */
export async function fetchPublicDocument(start, { timeoutMs, maxBytes, resolveHost = defaultResolveHost }) {
  let current = start;
  const deadline = Date.now() + timeoutMs;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let pinned;
    try {
      assertPublicHostname(current);
      pinned = await resolvePinnedAddress(current.hostname, resolveHost);
    } catch (e) {
      throw ApiError.badRequest(e instanceof UrlIssue ? `URL ${e.message}` : 'URL is invalid');
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) throw ApiError.upstream(504, 'Upstream timeout', 'fetch_timeout');

    let res;
    try {
      res = await requestPinned(current, pinned, remaining);
    } catch (err) {
      throw mapNetworkError(err);
    }

    const status = res.statusCode || 0;
    if (REDIRECT_STATUSES.has(status)) {
      const location = res.headers.location;
      res.resume();
      if (!location) throw ApiError.upstream(502, 'Redirect without Location', 'redirect_no_location');
      let next;
      try { next = new URL(String(location), current); } catch { throw ApiError.upstream(502, 'Redirect target is invalid', 'redirect_invalid'); }
      current = sanitizeTargetUrl(next.toString());
      continue; // 次のホップで再解決・再検証・再固定
    }

    if (status === 404 || status === 410) {
      res.resume();
      return { status, body: '', contentType: 'text/plain; charset=utf-8', finalUrl: current.toString() };
    }

    if (status < 200 || status >= 300) {
      res.resume();
      throw ApiError.upstream(502, `Upstream HTTP ${status}`, `upstream_${status}`);
    }

    const rawType = String(res.headers['content-type'] || 'text/html; charset=utf-8');
    const mediaType = rawType.split(';')[0].trim();
    if (mediaType && !ALLOWED_CONTENT_TYPE_RE.test(mediaType)) {
      res.destroy();
      throw ApiError.upstream(502, `Unsupported content type: ${mediaType.slice(0, 60)}`, 'unsupported_content_type');
    }
    const lengthHeader = res.headers['content-length'];
    if (lengthHeader && Number(lengthHeader) > maxBytes) {
      res.destroy();
      throw ApiError.upstream(502, 'Response too large', 'too_large_header');
    }

    let body;
    try {
      body = await readBodyLimited(res, maxBytes, deadline - Date.now());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/too large/i.test(msg)) throw ApiError.upstream(502, 'Response too large', 'too_large_stream');
      if (/timeout/i.test(msg)) throw ApiError.upstream(504, 'Upstream timeout', 'fetch_timeout_body');
      if (/encoding/i.test(msg)) throw ApiError.upstream(502, 'Unsupported content encoding', 'unsupported_encoding');
      throw ApiError.upstream(502, 'Fetch failed', `body_error ${msg.slice(0, 80)}`);
    }
    return { status, body, contentType: rawType, finalUrl: current.toString() };
  }
  throw ApiError.upstream(502, 'Too many redirects', 'too_many_redirects');
}

/** 検証済み IP に接続を固定した 1 回の GET。ホスト名は host / SNI / 証明書検証に使う。 */
function requestPinned(url, pinned, timeoutMs) {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:';
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const lookup = (_host, options, callback) => {
      const record = { address: pinned.address, family: pinned.family };
      if (options && options.all) return callback(null, [record]);
      return callback(null, record.address, record.family);
    };
    const options = {
      host: hostname,
      port: url.port ? Number(url.port) : isHttps ? 443 : 80,
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'User-Agent': USER_AGENT,
        'Accept-Language': 'ja,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'close',
      },
      lookup,
      agent: false,
      timeout: timeoutMs,
    };
    if (isHttps) {
      options.rejectUnauthorized = true;
      // IP リテラルには SNI を送らない。ホスト名なら SNI = ホスト名（証明書もこの名前で検証される）
      options.servername = isIpLiteral(hostname) ? '' : hostname;
    }
    const req = (isHttps ? https : http).request(options);
    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', fail);
    req.on('response', (res) => { settled = true; resolve(res); });
    req.end();
  });
}

/** 本文を上限付きで読む。Content-Encoding は伸長し、伸長後のサイズで上限を判定する。 */
function readBodyLimited(res, maxBytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    const encoding = String(res.headers['content-encoding'] || '').toLowerCase().trim();
    let stream = res;
    if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(zlib.createGunzip());
    else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
    else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());
    else if (encoding && encoding !== 'identity') {
      res.destroy();
      reject(new Error('Unsupported content encoding'));
      return;
    }
    const chunks = [];
    let total = 0;
    let done = false;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) { res.destroy(); reject(err); } else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('timeout')), Math.max(1, timeoutMs));
    stream.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) { finish(new Error('Response too large')); return; }
      chunks.push(chunk);
    });
    stream.on('end', () => finish(null, new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks))));
    stream.on('error', (err) => finish(err));
    res.on('error', (err) => finish(err));
    res.on('aborted', () => finish(new Error('Upstream aborted')));
  });
}

function mapNetworkError(err) {
  const code = err && err.code ? String(err.code) : '';
  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout/i.test(msg) || code === 'ETIMEDOUT' || err?.name === 'AbortError') return ApiError.upstream(504, 'Upstream timeout', 'fetch_timeout');
  if (/^ERR_TLS|CERT_|certificate|self[- ]signed|unable to verify|altname|hostname\/ip/i.test(code + ' ' + msg)) {
    return ApiError.upstream(502, 'TLS verification failed', `tls ${code || msg.slice(0, 60)}`);
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return ApiError.upstream(502, 'Hostname could not be resolved', 'dns_error');
  return ApiError.upstream(502, 'Fetch failed', `fetch_error ${code || msg.slice(0, 60)}`);
}
