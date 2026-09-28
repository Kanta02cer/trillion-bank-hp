/**
 * URL の無害化と SSRF ガード（ops/airreach-fetch / ops/airreach-api と同じ規則を強化したもの）。
 *  - http/https のみ、認証情報とトークンらしきクエリを除去
 *  - IP リテラルはホワイトリスト方式:
 *      IPv4: 予約・プライベート範囲（RFC 1918 / 6598 / 5737 / 2544 / ループバック / リンクローカル / マルチキャスト等）を拒否
 *      IPv6: グローバルユニキャスト 2000::/3 だけを許可し、その中の Teredo / 6to4 / ベンチマーク / ORCHID / 文書用を拒否。
 *            IPv4-mapped（::ffff:a.b.c.d と ::ffff:7f00:1 の 16 進形の両方）は埋め込み IPv4 を IPv4 の規則で判定
 *  - 内部ホスト名（localhost、.local 等）と単一ラベル名を拒否
 *  - Vercel（Node）では加えて DNS 解決先も同じ規則で確認する（assertResolvesPublic）
 * 外部パッケージには依存しない。
 */
import dns from 'node:dns/promises';

const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localhost', '.lan', '.home', '.corp', '.localdomain', '.intranet', '.private', '.arpa'];
const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata.google.com', 'metadata', 'kubernetes.default', 'kubernetes.default.svc']);
const DROP_PARAMS = ['token', 'access_token', 'auth', 'key', 'api_key', 'apikey', 'session', 'sig', 'signature', 'password', 'passwd'];
const SECRET_PARAM_RE = /token|secret|auth|key|session|sig|password|passwd/i;

export class UrlIssue extends Error {}

/** テスト専用: 127.0.0.1 だけを許可する。Vercel の環境変数には絶対に設定しない。 */
function allowLoopbackForTests() {
  return process.env.AIRREACH_FETCH_ALLOW_LOOPBACK_FOR_TESTS === '1';
}

export function sanitizeHttpUrl(input, { maxLength = 2048, keepHash = false } = {}) {
  if (typeof input !== 'string') throw new UrlIssue('must be a string');
  let raw = input.trim();
  if (!raw) throw new UrlIssue('is empty');
  if (raw.length > maxLength) throw new UrlIssue(`exceeds ${maxLength} chars`);
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let url;
  try { url = new URL(raw); } catch { throw new UrlIssue('is not a valid URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UrlIssue('must be http or https');
  url.username = '';
  url.password = '';
  if (!keepHash) url.hash = '';
  for (const k of DROP_PARAMS) url.searchParams.delete(k);
  for (const k of Array.from(url.searchParams.keys())) if (SECRET_PARAM_RE.test(k)) url.searchParams.delete(k);
  assertPublicHostname(url);
  const out = url.toString();
  if (out.length > maxLength) throw new UrlIssue(`exceeds ${maxLength} chars`);
  return out;
}

/** sites.normalized_url: 小文字ホスト、fragment 除去、末尾スラッシュ正規化（ルートは "/" を残す）。 */
export function normalizeSiteUrl(sanitizedHref) {
  const url = new URL(sanitizedHref);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const path = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '');
  const defaultPort = (url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80');
  const port = url.port && !defaultPort ? `:${url.port}` : '';
  return { normalizedUrl: `${url.protocol}//${host}${port}${path}${url.search || ''}`, host };
}

export function assertPublicHostname(url) {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new UrlIssue('hostname is missing');
  if (isIpLiteral(host)) {
    const ip = host.replace(/^\[|\]$/g, '');
    if (ip === '127.0.0.1' && allowLoopbackForTests()) return;
    if (isPrivateOrReservedIp(ip)) throw new UrlIssue('private, reserved or non-global IP is not allowed');
    return;
  }
  if (BLOCKED_HOSTS.has(host)) throw new UrlIssue('hostname is not allowed');
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) throw new UrlIssue('hostname is not allowed');
  if (host.indexOf('.') < 0) throw new UrlIssue('hostname must be fully qualified');
}

/** DNS 解決先がプライベート / 予約 / 非グローバルなら拒否（DNS リバインディング対策の一段目）。 */
export async function assertResolvesPublic(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (host === '127.0.0.1' && allowLoopbackForTests()) return;
  if (isIpLiteral(host)) return; // リテラルは assertPublicHostname で判定済み
  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UrlIssue('hostname could not be resolved');
  }
  if (!records.length) throw new UrlIssue('hostname could not be resolved');
  for (const r of records) {
    if (isPrivateOrReservedIp(String(r.address))) throw new UrlIssue('hostname resolves to a private, reserved or non-global address');
  }
}

export function isIpLiteral(host) {
  const h = host.replace(/^\[|\]$/g, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  if (h.includes(':')) return true;
  return false;
}

/**
 * true = 拒否（プライベート / 予約 / 非グローバル / 解釈不能）。false = 公開アドレス。
 * IPv4 と IPv6（16 進形・IPv4 埋め込み形・ゾーン ID 付き）を受け付ける。
 */
export function isPrivateOrReservedIp(ip) {
  const s = String(ip || '').trim().replace(/^\[|\]$/g, '');
  if (s.includes(':')) {
    const groups = parseIpv6(s);
    if (!groups) return true;
    return !isGlobalUnicastIpv6(groups);
  }
  const v4 = parseIpv4(s);
  if (!v4) return true;
  return !isPublicIpv4(v4);
}

// ---------------------------------------------------------------------------
// IPv4
// ---------------------------------------------------------------------------
export function parseIpv4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1, 5).map((n) => Number(n));
  if (o.some((n) => n > 255)) return null;
  return o;
}

/** 公開（グローバル）IPv4 か。IANA 特殊用途レジストリの範囲を拒否する。 */
export function isPublicIpv4([a, b, c]) {
  if (a === 0) return false;                                  // 0.0.0.0/8 "this network"
  if (a === 10) return false;                                 // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return false;         // 100.64.0.0/10 CGNAT
  if (a === 127) return false;                                // loopback
  if (a === 169 && b === 254) return false;                   // link-local
  if (a === 172 && b >= 16 && b <= 31) return false;          // RFC 1918
  if (a === 192 && b === 0 && c === 0) return false;          // 192.0.0.0/24 IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return false;          // 192.0.2.0/24 TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return false;        // 6to4 relay anycast (deprecated)
  if (a === 192 && b === 168) return false;                   // RFC 1918
  if (a === 198 && (b === 18 || b === 19)) return false;      // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return false;       // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false;        // TEST-NET-3
  if (a >= 224) return false;                                 // multicast, reserved, broadcast
  return true;
}

// ---------------------------------------------------------------------------
// IPv6
// ---------------------------------------------------------------------------
/** 8 個の 16 bit グループに展開する。IPv4 埋め込み（::ffff:1.2.3.4）、"::" 圧縮、ゾーン ID（%）に対応。不正なら null。 */
export function parseIpv6(input) {
  let s = String(input).toLowerCase().replace(/^\[|\]$/g, '');
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (!s || !/^[0-9a-f:.]+$/.test(s)) return null;

  // 末尾の IPv4 ドット形式を 2 グループの 16 進に置き換える
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (lastColon < 0) return null;
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  } else if (s.includes('.')) {
    return null;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = [...head, ...rest];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  if (halves.length === 1) {
    if (groups.length !== 8) return null;
    return groups.map((g) => parseInt(g, 16));
  }
  if (groups.length > 7) return null;
  const zeros = new Array(8 - groups.length).fill(0);
  return [...head.map((g) => parseInt(g, 16)), ...zeros, ...rest.map((g) => parseInt(g, 16))];
}

/** グローバルユニキャスト（2000::/3）かつ特殊用途でない IPv6 だけ true。IPv4-mapped は埋め込み IPv4 で判定。 */
export function isGlobalUnicastIpv6(g) {
  const allZeroTo = (n) => g.slice(0, n).every((x) => x === 0);
  // IPv4-mapped ::ffff:a.b.c.d（16 進形 ::ffff:7f00:1 も同じ）→ 埋め込み IPv4 の規則
  if (allZeroTo(5) && g[5] === 0xffff) return isPublicIpv4([g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff]);
  // ::（未指定）、::1（ループバック）、IPv4-compatible（非推奨）はすべて拒否
  if (allZeroTo(6)) return false;
  // グローバルユニキャスト 2000::/3 以外（fc00::/7 ULA、fe80::/10 リンクローカル、fec0::/10、ff00::/8 マルチキャスト、
  // 100::/64 discard、64:ff9b::/96 NAT64 など）は拒否
  if ((g[0] & 0xe000) !== 0x2000) return false;
  // 2000::/3 内の特殊用途
  if (g[0] === 0x2001 && g[1] === 0x0000) return false;                 // Teredo 2001::/32
  if (g[0] === 0x2001 && g[1] === 0x0002 && g[2] === 0) return false;   // benchmarking 2001:2::/48
  if (g[0] === 0x2001 && (g[1] & 0xfff0) === 0x0010) return false;      // ORCHID 2001:10::/28
  if (g[0] === 0x2001 && (g[1] & 0xfff0) === 0x0020) return false;      // ORCHIDv2 2001:20::/28
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false;                 // documentation 2001:db8::/32
  if (g[0] === 0x2002) return false;                                    // 6to4 2002::/16（非推奨、埋め込み IPv4 に到達）
  if (g[0] === 0x3fff) return false;                                    // documentation 3fff::/20 (RFC 9637)
  return true;
}
