/**
 * AirReach の社内ログイン（/airreach/app/ でのログイン）を、Studio・商談モードから使う。
 *   AirReachStaffAuth.token() → ログイン中ならトークン（期限が近ければ更新したもの）、していなければ null
 * 同じブラウザでダッシュボードにログインしていれば、Studio・商談モードの AI 計測はキーなしで使える。
 * supabase-js は必要になったときだけ読み込む。トークンは画面にも記録にも出さない。
 */
(function () {
  'use strict';
  var SB_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
  var clientP = null;
  function loadScript(src) {
    return new Promise(function (ok, ng) {
      if (window.supabase && window.supabase.createClient) return ok();
      var s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = function () { ok(); }; s.onerror = function () { ng(new Error('ログインの部品を読み込めませんでした')); };
      document.head.appendChild(s);
    });
  }
  function client() {
    if (clientP) return clientP;
    clientP = fetch('/api/airreach/app-config', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (cfg) {
      if (!cfg || !cfg.ok || !cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('ログインの設定を読めませんでした');
      return loadScript(SB_JS).then(function () {
        // ダッシュボードと同じ設定・同じ保存場所（sb-<project>-auth-token）を使う。URL のトークンはここでは読まない
        return window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
      });
    });
    clientP.catch(function () { clientP = null; });
    return clientP;
  }
  function token() {
    return client().then(function (sb) { return sb.auth.getSession(); })
      .then(function (res) { var s = res && res.data && res.data.session; return s && s.access_token ? s.access_token : null; })
      .catch(function () { return null; });
  }
  // 計測 API に付けるヘッダー。ログインしていればトークン、社内キーがあればそれも付ける（どちらかが通ればよい）
  function headers(extra) {
    var h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    var key = '';
    try { key = localStorage.getItem('airreach_studio_key_v1') || ''; } catch (e) {}
    if (key) h['X-AirReach-Key'] = key;
    return token().then(function (t) { if (t) h.Authorization = 'Bearer ' + t; return h; });
  }
  window.AirReachStaffAuth = { token: token, headers: headers, client: client, loginUrl: '/airreach/app/' };
})();
