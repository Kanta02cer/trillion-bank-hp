/**
 * AirReach Tools scan store — P0 bridge until Client DB.
 * Persists diagnosis snapshots by scanId in localStorage.
 */
(function () {
  'use strict';

  var INDEX_KEY = 'airreach_scan_index_v1';
  var PREFIX = 'airreach_scan_v1:';

  function nowIso() {
    try { return new Date().toISOString(); } catch (e) { return ''; }
  }

  function uid() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    } catch (e) {}
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function readIndex() {
    try {
      var list = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function writeIndex(list) {
    try { localStorage.setItem(INDEX_KEY, JSON.stringify(list.slice(0, 50))); } catch (e) {}
  }

  // 調べる言葉: keyword（メイン）と keywords（最大5語）をそろえる。旧データは keyword から keywords を作る
  // 呼び出し元のオブジェクトをそのまま書き換える（従来の saveScan と同じ振る舞い）
  function withKeywords(scan) {
    if (!window.AirReachKeywordList || !scan || typeof scan !== 'object') return scan;
    var n = window.AirReachKeywordList.normalize(scan.keyword, scan.keywords);
    scan.keyword = n.keyword;
    scan.keywords = n.keywords;
    return scan;
  }

  // 以前の版が保存した「探している人 約◯回」（言葉の文字列から計算した回数。badge: Estimated）は検索データではないので、
  // 表示するときに「未計測」に置き換える。保存データは書き換えない。
  // Google実測（Official）・お客様入力（User Input）・サイトの実測（Observed）・未計測（Unmeasured）はそのまま。
  var LEGACY_ESTIMATE_BADGES = { 'Estimated': 1, '推定': 1, '参考予測': 1 };
  function isLegacyDemandEstimate(h) {
    return !!h && h.id === 'demand' && !!LEGACY_ESTIMATE_BADGES[String(h.badge || '')];
  }
  function sanitizeHeadline(h) {
    if (!isLegacyDemandEstimate(h)) return h;
    var out = {};
    Object.keys(h).forEach(function (k) { out[k] = h[k]; });
    out.value = '未計測';
    out.unit = '';
    out.badge = 'Unmeasured';
    out.meaning = '検索回数は推定しません。以前の保存にあった推定の回数は表示しません';
    out.sub = '未計測';
    delete out.keywordSet;
    return out;
  }
  function sanitizeHeadlines(list) {
    return Array.isArray(list) ? list.map(sanitizeHeadline) : [];
  }

  function saveScan(partial) {
    var scan = withKeywords(partial || {});
    scan.id = scan.id || uid();
    scan.version = 1;
    scan.savedAt = nowIso();
    scan.evidenceClass = scan.evidenceClass || 'User Input';
    if (!scan.status) scan.status = 'diagnosed';
    // Version stamps so old scans stay comparable when scoring or band boundaries change.
    if (scan.ruleVersion === undefined) scan.ruleVersion = null;
    if (scan.displayVersion === undefined) scan.displayVersion = (window.AirReachDisplay && window.AirReachDisplay.version) || null;
    if (!scan.diagnoseState) scan.diagnoseState = scan.scoreOverall != null ? 'verified' : 'not_diagnosed';
    try { localStorage.setItem(PREFIX + scan.id, JSON.stringify(scan)); } catch (e) {}
    var idx = readIndex().filter(function (x) { return x && x.id !== scan.id; });
    idx.unshift({
      id: scan.id,
      savedAt: scan.savedAt,
      displayName: scan.displayName || scan.siteTitle || scan.url || '診断',
      url: scan.url || '',
      industryId: scan.industryId || '',
      outcomeGoal: scan.outcomeGoal || '',
      scoreOverall: scan.scoreOverall != null ? scan.scoreOverall : null,
      diagnoseState: scan.diagnoseState,
      ruleVersion: scan.ruleVersion,
      displayVersion: scan.displayVersion,
      status: scan.status || 'diagnosed'
    });
    writeIndex(idx);
    return scan;
  }

  function loadScan(id) {
    if (!id) return null;
    try { return withKeywords(JSON.parse(localStorage.getItem(PREFIX + id) || 'null')); }
    catch (e) { return null; }
  }

  function listScans() {
    return readIndex().map(function (row) {
      var full = loadScan(row.id);
      return Object.assign({}, row, full || {}, { scan: full });
    });
  }

  function markStatus(id, status) {
    var scan = loadScan(id);
    if (!scan) return null;
    scan.status = status || 'diagnosed';
    scan.statusAt = nowIso();
    return saveScan(scan);
  }

  function resultPath(scanId) {
    return '/airreach/result/?scan=' + encodeURIComponent(scanId);
  }
  function presentPath(scanId) {
    return '/airreach/sales/present/?scan=' + encodeURIComponent(scanId);
  }
  function dealPath(scanId) {
    return '/airreach/sales/deal/?scan=' + encodeURIComponent(scanId);
  }

  window.AirReachScanStore = {
    INDEX_KEY: INDEX_KEY,
    saveScan: saveScan,
    loadScan: loadScan,
    isLegacyDemandEstimate: isLegacyDemandEstimate,
    sanitizeHeadline: sanitizeHeadline,
    sanitizeHeadlines: sanitizeHeadlines,
    listScans: listScans,
    markStatus: markStatus,
    resultPath: resultPath,
    presentPath: presentPath,
    dealPath: dealPath,
    uid: uid
  };
})();
