---
# Liquid で _data/airreach_display.yml を埋め込む。区分・状態の定義はここに書かない。
---
/**
 * AirReach display contract — single read point for score bands / states / wording.
 * Source of truth: _data/airreach_display.yml (embedded at build time).
 * Load before airreach-diagnose.js / airreach-sales.js.
 */
(function () {
  'use strict';

  var CONTRACT = {{ site.data.airreach_display | jsonify }};

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

  /** "赤 0-39 低い / 黄 40-69 普通 / 緑 70-100 高い" style legend items. */
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
