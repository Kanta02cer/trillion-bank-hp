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
    var think = opts.think || null;
    var Think = root.AirReachThink;
    if (think && Think) {
      Think.begin({
        title: think.title || 'API接続中',
        model: think.model || 'Jev',
        judgments: think.judgments || [],
        log: think.log || ('接続: ' + apiUrl(path))
      });
    }
    var headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    var fetchOpts = Object.assign({}, opts, { headers: headers });
    delete fetchOpts.think;
    try {
      if (Think && think) Think.log('リクエスト送信…');
      var res = await fetch(apiUrl(path), fetchOpts);
      var data = null;
      var text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
      if (!res.ok) {
        var msg = (data && (data.error || data.message)) || ('HTTP ' + res.status);
        if (Think && think) Think.fail(msg);
        var err = new Error(msg);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      if (Think && think) {
        var seen = {};
        if (data && Array.isArray(data.judgments)) {
          data.judgments.forEach(function (j) {
            var id = j.id || j.label;
            seen[id] = true;
            var detail = j.thinking || j.label || '完了';
            if (j.missing === true) detail = '不足: ' + (j.why || detail);
            else if (j.present === true) detail = '充足';
            else if (j.mentioned != null) detail = (j.mentioned ? '言及あり' : '言及なし') + (j.cited != null ? (j.cited ? ' / 引用あり' : ' / 引用なし') : '');
            Think.set(id, 'done', detail);
          });
        }
        if (Array.isArray(think.judgments)) {
          think.judgments.forEach(function (j) {
            var id = j.id || j.label;
            if (!seen[id]) Think.set(id, 'done', '応答受信');
          });
        }
        if (data && Array.isArray(data.items)) {
          data.items.forEach(function (item) {
            var id = item.id || item.label;
            if (!id) return;
            seen[id] = true;
            Think.set(id, item.missing ? 'done' : 'done', item.present ? '充足' : ('不足: ' + (item.why || item.action || '')));
          });
        }
        if (data && Array.isArray(data.rows) && data.engineStatus) {
          Object.keys(data.engineStatus).forEach(function (k) {
            var s = data.engineStatus[k];
            Think.set(k, s && s.ok ? 'done' : 'error', s && s.ok ? ('OK ' + (s.count || 0) + '件') : ((s && s.error) || '失敗'));
          });
        }
        if (data && Array.isArray(data.missing)) {
          Think.log('不足 ' + data.missing.length + ' 件');
        }
        if (data && data.model) Think.log('model: ' + data.model);
        Think.end(think.doneTitle || '判断完了');
      }
      return data;
    } catch (e) {
      if (Think && think && !e.status) Think.fail(e && e.message ? e.message : e);
      throw e;
    }
  }

  root.AirReachAPI = {
    DEFAULT_VERCEL_API: DEFAULT_VERCEL_API,
    apiBase: apiBase,
    apiUrl: apiUrl,
    apiFetch: apiFetch
  };
})(typeof window !== 'undefined' ? window : globalThis);
