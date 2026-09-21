/**
 * API base for GitHub Pages (static) + Vercel (dynamic) split.
 * Same-origin on *.vercel.app / localhost; absolute Vercel host elsewhere.
 */
(function (root) {
  'use strict';

  var DEFAULT_VERCEL_API = 'https://trillion-bank-hp.vercel.app';

  function hostname() {
    try { return (root.location && root.location.hostname) || ''; } catch (e) { return ''; }
  }

  function apiBase() {
    if (root.__TB_API_BASE) {
      return String(root.__TB_API_BASE).replace(/\/$/, '');
    }
    try {
      var meta = root.document && root.document.querySelector('meta[name="tb-api-base"]');
      if (meta && meta.content) return String(meta.content).replace(/\/$/, '');
    } catch (e) {}
    var h = hostname();
    // Same-origin only when the page itself is served from Vercel / local.
    // trillion-bank.jp (GitHub Pages) and github.io must use the Vercel API host.
    if (h === 'localhost' || h === '127.0.0.1' || /\.vercel\.app$/i.test(h)) {
      return '';
    }
    return DEFAULT_VERCEL_API;
  }

  function apiUrl(path) {
    var p = String(path || '');
    if (!p) return apiBase() || '/';
    if (p.charAt(0) !== '/') p = '/' + p;
    // Vercel trailingSlash:true — avoid 308 on /api/foo
    if (p.indexOf('?') === -1 && p.charAt(p.length - 1) !== '/') p += '/';
    return apiBase() + p;
  }

  async function apiFetch(path, opts) {
    opts = opts || {};
    var headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    var res = await fetch(apiUrl(path), Object.assign({}, opts, { headers: headers }));
    var data = null;
    var text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
    if (!res.ok) {
      var msg = (data && (data.error || data.message)) || ('HTTP ' + res.status);
      var err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  root.AirReachAPI = {
    DEFAULT_VERCEL_API: DEFAULT_VERCEL_API,
    apiBase: apiBase,
    apiUrl: apiUrl,
    apiFetch: apiFetch
  };
})(typeof window !== 'undefined' ? window : globalThis);
