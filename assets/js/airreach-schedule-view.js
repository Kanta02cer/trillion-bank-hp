/**
 * AirReach 計測の予定（社内だけ）：測る AI の一覧・1回答あたりの費用の見込み・AI ごとの状態。
 *   単価は計測サーバーの既定の表（api/airreach/schedule-run.js の DEFAULT_COST_PER_ANSWER）と同じ（目安）。
 *   自動の定期計測は使わない（10/8 決定）。計測の時期は airreach-case-steps.js の timing
 */
(function (root) {
  'use strict';
  // 変えるときは api/airreach/schedule-run.js の DEFAULT_COST_PER_ANSWER と両方
  var COST = { chatgpt: 0.0003, chatgpt_search: 0.015, claude: 0.02, perplexity: 0.006, gemini: 0.035, google_aio: 0.03, google_ai_mode: 0.015 };
  var ENGINES = [['google_aio', 'Google の AI による概要'], ['google_ai_mode', 'Google の AI モード'], ['chatgpt_search', 'ChatGPT（検索あり）'], ['perplexity', 'Perplexity'], ['gemini', 'Gemini'], ['claude', 'Claude（検索あり）'], ['chatgpt', 'ChatGPT（検索なし）']];

  /**
   * AI ごとの状態：いちばん新しい計測の回答から。取れた回答があれば「使える」、支払い・上限で取れなければその理由
   *   answers: summary.answers（engine・status・error）
   */
  function engineStatus(answers) {
    var by = {};
    (answers || []).forEach(function (a) {
      var e = a && (a.engine || (a.conditions && a.conditions.engine)); if (!e) return;
      var x = by[e] || (by[e] = { ok: 0, err: 0, billing: 0, quota: 0 });
      if (a.status === 'ok' || a.status === 'not_shown') x.ok++;
      else if (a.status === 'error') {
        x.err++;
        var m = String(a.error || '') + ' ' + String(a.error_type || '');
        if (/quota_billing|billing/i.test(m)) x.billing++; else if (/quota_zero|quota_daily|rate limit|quota/i.test(m)) x.quota++;
      }
    });
    var out = {};
    Object.keys(by).forEach(function (e) {
      var x = by[e];
      out[e] = x.ok ? ['使える', 'is-ok'] : x.billing ? ['支払いの設定待ち', 'is-warn'] : x.quota ? ['回数の上限に当たった', 'is-warn'] : x.err ? ['取れなかった', 'is-warn'] : ['まだ測っていない', ''];
    });
    return out;
  }
  var api = { COST: COST, ENGINES: ENGINES, engineStatus: engineStatus };
  if (root) root.AirReachScheduleView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
