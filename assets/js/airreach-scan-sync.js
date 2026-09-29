/**
 * AirReach scan sync — 診断結果を same-origin の API（/api/airreach/）へ保存し、共有リンクを扱う。
 *
 *  - 保存は診断完了時に 1 回だけ（同じ scan は再送しない。サーバ側でも scan id 重複は 409）。
 *  - 保存に失敗しても診断結果の表示は止めない（端末内の保存はそのまま）。
 *  - shareToken は保存成功時の応答にしか現れない。診断した本人の端末では scan 記録に保持し
 *    （共有リンクの再表示に必要）、共有リンクを開く側では永続保存しない。
 *  - console には状態コードだけ。トークン・本文・鍵は出さない。
 *  - API は相対 URL のみ。Cloudflare / 第三者サービスへの通信は無い。
 */
(function () {
  'use strict';

  var API_BASE = '/api/airreach';
  var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  var inflight = {};

  function nowIso() { try { return new Date().toISOString(); } catch (e) { return ''; } }

  /** 保存失敗を利用者向けの短い文にする（状態コード以外の情報は出さない）。 */
  function messageFor(status) {
    if (status === 0) return '通信できなかったため、この端末だけに保存しました。';
    if (status === 409) return 'この診断はすでに保存されています。';
    if (status === 400 || status === 413 || status === 422) return '保存できる形式ではなかったため、この端末だけに保存しました。';
    if (status === 403) return 'このページからは保存できません。';
    if (status === 429) return '短時間に保存が集中しています。しばらくしてからやり直してください。';
    if (status >= 500) return '保存先に一時的に接続できないため、この端末だけに保存しました。';
    return '保存できなかったため、この端末だけに保存しました。';
  }

  function sharedErrorMessage(status) {
    if (status === 404) return 'この共有リンクは無効か、期限切れです。';
    if (status === 429) return 'アクセスが集中しています。しばらくしてから開いてください。';
    if (status === 0 || status >= 500) return '共有結果を一時的に読み込めません。時間をおいて再度お試しください。';
    return '共有結果を読み込めませんでした。';
  }

  function parseJson(res) {
    return res.text().then(function (text) {
      var json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
      return { status: res.status, json: json };
    });
  }

  function persist(id, patch) {
    if (!window.AirReachScanStore) return;
    var cur = AirReachScanStore.loadScan(id);
    if (!cur) return;
    AirReachScanStore.saveScan(Object.assign({}, cur, patch));
  }

  function buildPayload(scan) {
    return {
      scan: {
        id: scan.id,
        url: scan.url,
        industryId: scan.industryId,
        goal: scan.goal || null,
        outcomeGoal: scan.outcomeGoal || null,
        keyword: scan.keyword || null,
        siteTitle: scan.siteTitle || null,
        displayName: scan.displayName || null,
        source: scan.source || 'airreach_free',
        savedAt: scan.savedAt || null
      },
      result: scan.previewDiagnose
    };
  }

  /**
   * 診断結果をサーバへ保存する。戻り値は必ず resolve（reject しない）。
   *  { ok: true, shareToken, scanId } | { ok: false, status, code, message, skipped? }
   */
  function push(scan, opts) {
    opts = opts || {};
    if (!scan || !scan.id) return Promise.resolve({ ok: false, skipped: 'no_scan' });
    if (!scan.previewDiagnose || !scan.previewDiagnose.checks) return Promise.resolve({ ok: false, skipped: 'no_result' });
    if (scan.shareToken) return Promise.resolve({ ok: true, skipped: 'already', shareToken: scan.shareToken, scanId: scan.id });
    if (scan.syncState === 'conflict') return Promise.resolve({ ok: false, skipped: 'conflict', status: 409, message: messageFor(409) });
    if (inflight[scan.id]) return inflight[scan.id];

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, opts.timeoutMs || 8000);
    var body;
    try { body = JSON.stringify(buildPayload(scan)); } catch (e) { return Promise.resolve({ ok: false, status: 0, code: 'serialize', message: messageFor(-1) }); }

    var p = fetch(API_BASE + '/scans/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body,
      credentials: 'same-origin',
      keepalive: true,
      signal: ctrl ? ctrl.signal : undefined
    }).then(parseJson).then(function (r) {
      clearTimeout(timer);
      if (r.status === 201 && r.json && r.json.ok && TOKEN_RE.test(r.json.shareToken || '')) {
        persist(scan.id, { shareToken: r.json.shareToken, syncedAt: nowIso(), syncState: 'saved', syncError: null });
        return { ok: true, status: 201, shareToken: r.json.shareToken, scanId: r.json.scanId || scan.id };
      }
      var code = (r.json && r.json.error && r.json.error.code) ? String(r.json.error.code) : null;
      if (r.status === 409) persist(scan.id, { syncedAt: nowIso(), syncState: 'conflict', syncError: 'conflict' });
      else persist(scan.id, { syncState: 'failed', syncError: code || ('http_' + r.status) });
      try { console.warn('AirReach: 診断結果の保存に失敗しました (' + r.status + (code ? ' ' + code : '') + ')'); } catch (e) {}
      return { ok: false, status: r.status, code: code, message: messageFor(r.status) };
    }).catch(function () {
      clearTimeout(timer);
      persist(scan.id, { syncState: 'failed', syncError: 'network' });
      try { console.warn('AirReach: 診断結果の保存に失敗しました (通信エラー)'); } catch (e) {}
      return { ok: false, status: 0, code: 'network', message: messageFor(0) };
    }).then(function (out) {
      delete inflight[scan.id];
      return out;
    });
    inflight[scan.id] = p;
    return p;
  }

  function isTokenFormat(token) { return typeof token === 'string' && TOKEN_RE.test(token); }

  function shareUrl(token) {
    return location.origin + '/airreach/result/?share=' + encodeURIComponent(token);
  }

  /** 共有トークンで保存済みの診断を読む。戻り値は必ず resolve。 */
  function fetchShared(token, opts) {
    opts = opts || {};
    if (!isTokenFormat(token)) return Promise.resolve({ ok: false, status: 404, message: sharedErrorMessage(404) });
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, opts.timeoutMs || 10000);
    return fetch(API_BASE + '/shared-scans/?shareToken=' + encodeURIComponent(token), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    }).then(parseJson).then(function (r) {
      clearTimeout(timer);
      if (r.status === 200 && r.json && r.json.ok && r.json.scan && r.json.result && Array.isArray(r.json.result.checks)) {
        return { ok: true, status: 200, data: r.json };
      }
      return { ok: false, status: r.status, message: sharedErrorMessage(r.status) };
    }).catch(function () {
      clearTimeout(timer);
      return { ok: false, status: 0, message: sharedErrorMessage(0) };
    });
  }

  /** 共有 API の応答を、画面が扱う scan 相当の形にする（永続保存はしない）。 */
  function toScan(data) {
    var s = (data && data.scan) || {};
    return {
      id: s.id || '',
      url: s.url || '',
      industryId: s.industryId || 'other',
      goal: s.goal || 'acquisition',
      outcomeGoal: s.outcomeGoal || '',
      keyword: s.keyword || '',
      siteTitle: s.siteTitle || '',
      displayName: s.siteTitle || s.url || '',
      scoreOverall: s.overallScore != null ? s.overallScore : null,
      diagnoseState: s.state || 'verified',
      ruleVersion: s.ruleVersion || null,
      displayVersion: s.displayVersion || null,
      createdAt: s.createdAt || null,
      previewDiagnose: data.result,
      shared: true
    };
  }

  window.AirReachScanSync = {
    API_BASE: API_BASE,
    push: push,
    fetchShared: fetchShared,
    toScan: toScan,
    shareUrl: shareUrl,
    isTokenFormat: isTokenFormat,
    messageFor: messageFor,
    sharedErrorMessage: sharedErrorMessage
  };
})();
