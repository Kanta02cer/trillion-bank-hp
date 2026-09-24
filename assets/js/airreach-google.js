/**
 * Google OAuth token handoff for AirReach Studio (GSC / GA4).
 * Tokens live in sessionStorage after OAuth hash redirect (GitHub Pages ↔ Vercel).
 */
(function (root) {
  'use strict';

  var ACCESS_KEY = 'tb_google_access_token';
  var REFRESH_KEY = 'tb_google_refresh_token';
  var EXPIRES_KEY = 'tb_google_expires_at';

  function getAccess() {
    try { return sessionStorage.getItem(ACCESS_KEY) || ''; } catch (e) { return ''; }
  }
  function getRefresh() {
    try { return sessionStorage.getItem(REFRESH_KEY) || ''; } catch (e) { return ''; }
  }
  function getExpiresAt() {
    try { return Number(sessionStorage.getItem(EXPIRES_KEY) || 0); } catch (e) { return 0; }
  }
  function setTokens(access, refresh, expiresIn) {
    try {
      if (access) sessionStorage.setItem(ACCESS_KEY, access);
      if (refresh) sessionStorage.setItem(REFRESH_KEY, refresh);
      var exp = Date.now() + (Math.max(60, Number(expiresIn) || 3600) - 60) * 1000;
      sessionStorage.setItem(EXPIRES_KEY, String(exp));
    } catch (e) {}
  }
  function clearTokens() {
    try {
      sessionStorage.removeItem(ACCESS_KEY);
      sessionStorage.removeItem(REFRESH_KEY);
      sessionStorage.removeItem(EXPIRES_KEY);
    } catch (e) {}
  }
  function isConnected() {
    return !!(getAccess() || getRefresh());
  }

  function consumeHashTokens() {
    try {
      var hash = (root.location && root.location.hash) || '';
      if (!hash || hash.indexOf('access_token=') === -1) return false;
      var params = new URLSearchParams(hash.replace(/^#/, ''));
      var access = params.get('access_token');
      var refresh = params.get('refresh_token');
      var expiresIn = params.get('expires_in');
      if (!access) return false;
      setTokens(access, refresh, expiresIn);
      if (root.history && root.history.replaceState) {
        root.history.replaceState(null, '', root.location.pathname + root.location.search);
      } else {
        root.location.hash = '';
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  async function ensureAccessToken() {
    var access = getAccess();
    var exp = getExpiresAt();
    if (access && exp && Date.now() < exp) return access;
    var refresh = getRefresh();
    if (!refresh) return access || '';
    if (!root.AirReachAPI || !root.AirReachAPI.apiFetch) return access || '';
    try {
      var data = await root.AirReachAPI.apiFetch('/api/google/refresh/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ refresh_token: refresh })
      });
      if (data && data.access_token) {
        setTokens(data.access_token, data.refresh_token || refresh, data.expires_in);
        return data.access_token;
      }
    } catch (e) {}
    return access || '';
  }

  async function authHeaders() {
    var access = await ensureAccessToken();
    var headers = {};
    if (access) headers.Authorization = 'Bearer ' + access;
    var refresh = getRefresh();
    if (refresh) headers['X-Google-Refresh-Token'] = refresh;
    return headers;
  }

  async function apiPost(path, body) {
    if (!root.AirReachAPI || !root.AirReachAPI.apiFetch) {
      throw new Error('AirReachAPI が読み込まれていません');
    }
    var headers = Object.assign(
      { 'Content-Type': 'application/json' },
      await authHeaders()
    );
    return root.AirReachAPI.apiFetch(path, {
      method: 'POST',
      headers: headers,
      credentials: 'include',
      body: JSON.stringify(body || {})
    });
  }

  function defaultRangeDays(days) {
    var end = new Date();
    var start = new Date();
    start.setDate(end.getDate() - (days || 28));
    function fmt(d) {
      return d.toISOString().slice(0, 10);
    }
    return { startDate: fmt(start), endDate: fmt(end) };
  }

  root.AirReachGoogle = {
    consumeHashTokens: consumeHashTokens,
    isConnected: isConnected,
    clearTokens: clearTokens,
    setTokens: setTokens,
    getAccess: getAccess,
    authHeaders: authHeaders,
    ensureAccessToken: ensureAccessToken,
    apiPost: apiPost,
    defaultRangeDays: defaultRangeDays
  };
})(typeof window !== 'undefined' ? window : this);
