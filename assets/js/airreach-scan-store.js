/**
 * AirReach scan store — P0 bridge until Client DB.
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

  function saveScan(partial) {
    var scan = partial || {};
    scan.id = scan.id || uid();
    scan.version = 1;
    scan.savedAt = nowIso();
    scan.evidenceClass = scan.evidenceClass || 'User Input';
    if (!scan.status) scan.status = 'diagnosed';
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
      status: scan.status || 'diagnosed'
    });
    writeIndex(idx);
    return scan;
  }

  function loadScan(id) {
    if (!id) return null;
    try { return JSON.parse(localStorage.getItem(PREFIX + id) || 'null'); }
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
    listScans: listScans,
    markStatus: markStatus,
    resultPath: resultPath,
    presentPath: presentPath,
    dealPath: dealPath,
    uid: uid
  };
})();
