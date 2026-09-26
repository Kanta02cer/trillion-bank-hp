/**
 * Recruitment Visibility Score v0
 * Four separate panels. No single blended "求人AIO点".
 * composite.status stays not_projected until calibrated v1.
 */
(function (root) {
  'use strict';

  var SCORE_VERSION = 'recruitment-visibility-v0';
  var STORE_KEY = 'airreach_recruit_visibility_score_v0';

  function panelNotMeasured(id, label) {
    return {
      id: id,
      label: label,
      status: 'not_measured',
      value: null,
      display: '未計測',
      evidenceClass: null,
      note: '0 と未計測は別です'
    };
  }

  function clampPct(n) {
    if (n == null || !isFinite(n)) return null;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  /**
   * @param {object} input
   * @param {object} [input.jobValidation] — from /api/job-posting-validate/
   * @param {object} [input.infoScores] — { salary, location, work, style, apply, ai } 0-100
   * @param {object} [input.aiRun] — latest HackⅡ recruit run { all:{mentionPct,citationPct,n} }
   * @param {object} [input.application] — { flags, funnel }
   * @param {object} [input.evidence] — { claimCount, evidenceCount }
   * @param {object} [input.indexing] — { eventCount, lastAt, lastType }
   */
  function build(input) {
    input = input || {};
    var panels = {};

    // 1) Google JobPosting readiness
    if (input.jobValidation && input.jobValidation.requiredTotal != null) {
      var reqOk = Number(input.jobValidation.requiredOk || 0);
      var reqTotal = Number(input.jobValidation.requiredTotal || 0);
      var allOk = Number(input.jobValidation.okCount || 0);
      var allTotal = Number(input.jobValidation.totalCount || 0);
      var readinessPct = reqTotal > 0 ? (reqOk / reqTotal) * 100 : null;
      panels.jobPostingReadiness = {
        id: 'jobPostingReadiness',
        label: 'Google求人掲載準備度',
        status: 'measured',
        value: clampPct(readinessPct),
        display: (input.jobValidation.readinessLabel || (reqOk + ' / ' + reqTotal + ' 必須')),
        evidenceClass: input.jobValidation.evidenceClass || 'Observed',
        requiredOk: reqOk,
        requiredTotal: reqTotal,
        optionalOk: allOk,
        optionalTotal: allTotal,
        scoreVersion: input.jobValidation.scoreVersion || 'jobposting-readiness-v0',
        note: '掲載・順位は保証しません'
      };
    } else {
      panels.jobPostingReadiness = panelNotMeasured('jobPostingReadiness', 'Google求人掲載準備度');
    }

    // 2) Info sufficiency (from JobPosting field coverage groups)
    if (input.infoScores && typeof input.infoScores === 'object') {
      var keys = Object.keys(input.infoScores);
      if (keys.length) {
        var vals = keys.map(function (k) { return Number(input.infoScores[k]) || 0; });
        var avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
        var min = Math.min.apply(null, vals);
        panels.infoSufficiency = {
          id: 'infoSufficiency',
          label: '採用情報充足度',
          status: 'measured',
          value: clampPct(avg),
          display: '平均 ' + clampPct(avg) + ' · 最低 ' + clampPct(min),
          evidenceClass: 'Observed',
          breakdown: input.infoScores,
          note: 'JobPosting上の項目充足。AI選出確率ではない'
        };
      } else {
        panels.infoSufficiency = panelNotMeasured('infoSufficiency', '採用情報充足度');
      }
    } else {
      panels.infoSufficiency = panelNotMeasured('infoSufficiency', '採用情報充足度');
    }

    // 3) AI observed
    if (input.aiRun && input.aiRun.all && input.aiRun.all.n > 0) {
      panels.aiObserved = {
        id: 'aiObserved',
        label: 'AI検索実測',
        status: 'measured',
        value: clampPct(input.aiRun.all.mentionPct),
        display: '言及 ' + clampPct(input.aiRun.all.mentionPct) + '% · 引用 ' + clampPct(input.aiRun.all.citationPct) + '%',
        evidenceClass: 'Observed',
        branded: input.aiRun.branded || null,
        generic: input.aiRun.generic || null,
        sampleSize: input.aiRun.all.n,
        note: 'HackⅡ Observed。準備度と混ぜない'
      };
    } else {
      panels.aiObserved = panelNotMeasured('aiObserved', 'AI検索実測');
    }

    // 4) Application flow
    var flags = (input.application && input.application.flags) || {};
    var funnel = (input.application && input.application.funnel) || null;
    var flagKeys = ['hasJobView', 'hasApplyCta', 'hasApplyStart', 'hasApplyComplete', 'hasJobIdParam'];
    var flagOk = flagKeys.filter(function (k) { return !!flags[k]; }).length;
    if (flagOk > 0 || funnel) {
      var cvr = funnel && funnel.overallCvr != null ? funnel.overallCvr : null;
      panels.applicationFlow = {
        id: 'applicationFlow',
        label: '応募導線',
        status: 'measured',
        value: clampPct((flagOk / flagKeys.length) * 100),
        display: flagOk + ' / ' + flagKeys.length + ' 計測' +
          (cvr == null ? '' : (' · 閲覧→完了 ' + (Math.round(cvr * 1000) / 10) + '%')),
        evidenceClass: funnel && funnel.evidenceClass
          ? funnel.evidenceClass
          : (flagOk > 0 ? 'Planned' : null),
        instrumentation: { ok: flagOk, total: flagKeys.length },
        overallCvr: cvr,
        note: '計測整備と実CVRは別意味'
      };
    } else {
      panels.applicationFlow = panelNotMeasured('applicationFlow', '応募導線');
    }

    var measuredCount = Object.keys(panels).filter(function (k) {
      return panels[k].status === 'measured';
    }).length;

    var score = {
      scoreVersion: SCORE_VERSION,
      computedAt: new Date().toISOString(),
      composite: {
        status: 'not_projected',
        value: null,
        reason: 'cross_panel_calibration_pending',
        message: '総合点はまだ算出しません。評価対象が異なる4パネルを分離表示します。'
      },
      panels: panels,
      supporting: {
        evidenceGraph: input.evidence || { claimCount: 0, evidenceCount: 0 },
        indexing: input.indexing || { eventCount: 0, lastAt: null, lastType: null }
      },
      meta: {
        measuredPanels: measuredCount,
        totalPanels: 4,
        disclaimer: 'Recruitment Visibility Score v0 は準備度・充足度・実測・応募導線の容器です。Google求人掲載・順位・AI引用を保証しません。'
      }
    };

    return score;
  }

  function save(score) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(score)); } catch (e) {}
    return score;
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); }
    catch (e) { return null; }
  }

  function toExportJson(score) {
    return JSON.stringify(score || load() || build({}), null, 2);
  }

  root.AirReachRecruitScore = {
    SCORE_VERSION: SCORE_VERSION,
    STORE_KEY: STORE_KEY,
    build: build,
    save: save,
    load: load,
    toExportJson: toExportJson
  };
})(typeof window !== 'undefined' ? window : globalThis);
