/**
 * AirReach Tools display contract — single read point for score bands / states / wording.
 * Source of truth: _data/airreach_display.yml (embedded at build time).
 * Load before airreach-diagnose.js / airreach-sales.js.
 */
(function () {
  'use strict';

  var CONTRACT = {"last_reviewed":"2026-09-29","display_version":"band-v1","approval":{"status":"approved","note":"AirReach Tools v1 の正式仕様として承認。区分 0-39 要対策 / 40-69 要改善 / 70-100 良好、および airreach-common-v1 の4項目の配点・検出条件。","approved_on":"2026-09-29","label_change":"2026-09-29 区分 mid のラベルを「普通」→「要改善」、low「低い」→「要対策」、high「高い」→「良好」に変更（増山 承認）。境界値・配点は変更なし。"},"score":{"scope":"ホームページの情報整備","scope_sentence":"点数と色は「ホームページの情報整備」の区分です。","not_meaning":["AIに紹介される確率","検索順位","予約数","他店との比較"],"not_meaning_sentence":"AI掲載率・検索順位・予約数・他店との比較ではありません。","unit":"/ 100点"},"bands":[{"key":"low","label":"要対策","min":0,"max":39,"tone":"bad","color":"#dc2626","meaning":"来店・相談の前に知りたい情報が、ホームページで見つけにくい"},{"key":"mid","label":"要改善","min":40,"max":69,"tone":"warn","color":"#d97706","meaning":"基本的な情報は載っているが、足りない項目がある"},{"key":"high","label":"良好","min":70,"max":100,"tone":"good","color":"#16a34a","meaning":"知りたい情報が、ひととおり載っている"}],"unknown":{"key":"unknown","label":"未確認","tone":"muted","color":"#64748b","meaning":"取得できなかったため判定していません。0点ではありません。"},"states":{"verified":{"label":"確認済み","show_score":true,"show_color":true,"link":"evidence","note":"数値・色・位置を表示。根拠リンクは取得時の最終URL（検証済みアンカーがあればそこへ）。"},"partial":{"label":"一部未取得","show_score":true,"show_color":true,"link":"evidence_only","note":"取得できた項目だけ表示。根拠のあるURLだけリンク。必須項目が欠けたときは総合点を出さない。"},"failed":{"label":"取得失敗","show_score":false,"show_color":false,"link":"none","note":"数値と色を表示しない。理由と再試行を示す。リンクを推測しない。"},"no_site":{"label":"ホームページなし","show_score":false,"show_color":false,"link":"none","note":"対象外。リンクを作らず、0点にしない。"}},"check_states":{"ok":{"label":"あり","mark":"✓"},"ng":{"label":"なし","mark":"×"},"unknown":{"label":"未確認","mark":"?"}}};

  var BANDS = Array.isArray(CONTRACT.bands) ? CONTRACT.bands.slice() : [];
  BANDS.sort(function (a, b) { return Number(a.min) - Number(b.min); });

  var UNKNOWN = Object.assign({ key: 'unknown', label: '未確認', tone: 'muted', color: '#64748b', meaning: '' }, CONTRACT.unknown || {});

  function toScore(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /** Band for a 0-100 score. null / NaN -> unknown (never treated as 0). */
  function band(score) {
    var s = toScore(score);
    if (s == null) return Object.assign({}, UNKNOWN);
    var clamped = Math.max(0, Math.min(100, Math.round(s)));
    for (var i = 0; i < BANDS.length; i++) {
      var b = BANDS[i];
      if (clamped >= Number(b.min) && clamped <= Number(b.max)) return Object.assign({}, b);
    }
    return Object.assign({}, UNKNOWN);
  }

  function bandLabel(score) { return band(score).label; }
  function bandTone(score) { return band(score).tone; }
  function scoreMeaning(score) {
    var b = band(score);
    return b.label + '（' + (b.meaning || '') + '）';
  }

  function state(key) {
    var states = CONTRACT.states || {};
    return Object.assign({ key: key }, states[key] || states.failed || {});
  }

  function checkState(key) {
    var cs = CONTRACT.check_states || {};
    return Object.assign({ key: key }, cs[key] || cs.unknown || { label: '未確認', mark: '?' });
  }

  /** Text for legends: what the score means and does not mean. */
  function scopeSentence() {
    var s = CONTRACT.score || {};
    return [s.scope_sentence, s.not_meaning_sentence].filter(Boolean).join('');
  }

  /** "赤 0-39 低い / 黄 40-69 要改善 / 緑 70-100 高い" style legend items. */
  function legend() {
    return BANDS.map(function (b) {
      return { key: b.key, label: b.label, range: b.min + '〜' + b.max, tone: b.tone, color: b.color, meaning: b.meaning };
    });
  }

  window.AirReachDisplay = {
    contract: CONTRACT,
    version: CONTRACT.display_version || 'band-v0',
    approval: CONTRACT.approval || { status: 'provisional' },
    bands: BANDS,
    unknown: UNKNOWN,
    band: band,
    bandLabel: bandLabel,
    bandTone: bandTone,
    scoreMeaning: scoreMeaning,
    state: state,
    checkState: checkState,
    scopeSentence: scopeSentence,
    legend: legend,
    unit: (CONTRACT.score && CONTRACT.score.unit) || '/ 100点'
  };
})();
