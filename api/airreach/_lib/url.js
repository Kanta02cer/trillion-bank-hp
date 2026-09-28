/**
 * URL の無害化と SSRF ガード（ops/airreach-fetch / ops/airreach-api と同じ規則）。
 *  - http/https のみ、認証情報とトークンらしきクエリを除去
 *  - プライベート / 予約アドレスと内部ホスト名は拒否
 *  - Vercel（Node）では加えて DNS 解決先も確認できる（assertResolvesPublic）
 */
import dns from 'node:dns/promises';

const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localhost', '.lan', '.home', '.corp'];
const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal', 'metadata.google.com', 'kubernetes.default', 'kubernetes.default.svc']);
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
  if (host === '127.0.0.1' && allowLoopbackForTests()) return;
  if (BLOCKED_HOSTS.has(host)) throw new UrlIssue('hostname is not allowed');
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) throw new UrlIssue('hostname is not allowed');
  if (host === '0.0.0.0' || host === '::' || host === '::1' || host === '[::1]') throw new UrlIssue('IP address is not allowed');
  if (host.indexOf('.') < 0 && !host.includes(':')) throw new UrlIssue('hostname must be fully qualified');
  if (isIpLiteral(host) && isPrivateOrReservedIp(host)) throw new UrlIssue('private or reserved IP is not allowed');
}

/** DNS 解決先がプライベート / 予約アドレスなら拒否（DNS リバインディング対策の一段目）。 */
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
    if (isPrivateOrReservedIp(String(r.address))) throw new UrlIssue('hostname resolves to a private or reserved address');
  }
}

export function isIpLiteral(host) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes(':')) return true;
  return false;
}

export function isPrivateOrReservedIp(ip) {
  if (ip.includes(':')) {
    const n = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (n === '::' || n === '::1') return true;
    if (n.startsWith('fc') || n.startsWith('fd') || n.startsWith('fe80')) return true;
    const mapped = n.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isPrivateOrReservedIp(mapped[1]);
    return false;
  }
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}
