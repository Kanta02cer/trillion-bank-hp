/**
 * ホストの正規化（api/airreach/_lib/url.js の normalizeSiteUrl・assets/js/airreach-keyword-list.js の siteHost と同じ規則）。
 * 小文字・末尾の点を除く・既定ポート（http:80 / https:443）は付けない。www の有無は区別する（別ホスト）。
 */
export function siteHost(u) {
  try {
    const url = new URL(String(u));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return host ? host + (url.port ? `:${url.port}` : '') : '';
  } catch (e) {
    return '';
  }
}

/** GA4 の hostName（「example.com」「example.com:443」など）を siteHost と同じ規則で正規化する */
export function ga4Host(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || s === '(not set)') return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return siteHost(s);
  return siteHost(`https://${s.replace(/\/.*$/, '')}`);
}
