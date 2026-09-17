/**
 * AirReach diagnose → Growth Simulator handoff.
 * Persists readiness score + suggested uplifts; Platform applies Official GSC/GA4 when present.
 */
(function () {
  'use strict';

  var HANDOFF_KEY = 'airreach_diagnose_handoff_v1';
  var BASELINE_KEY = 'airreach_official_baseline_v1';

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  /** Map readiness score → suggested traffic / CVR uplift % (Inferred, not a guarantee). */
  function liftsFromScore(overall, target) {
    overall = Number(overall);
    if (!isFinite(overall)) overall = 50;
    target = Number(target);
    if (!isFinite(target)) target = 78;
    var gap = clamp((target - overall) / 100, 0, 0.55);
    var visitPct = Math.round(clamp((0.06 + gap * 0.32) * 100, 5, 28));
    var cvrPct = Math.round(clamp((0.04 + gap * 0.22) * 100, 3, 18));
    return {
      evidenceClass: 'Inferred',
      currentScore: overall,
      targetScore: target,
      trafficUpliftPct: visitPct,
      cvrUpliftPct: cvrPct,
      note: '準備度スコア差からの仮定レンジです。成果・掲載・問い合わせ増を保証しません。'
    };
  }

  function saveDiagnoseHandoff(result, url) {
    var overall = result && result.overall != null ? result.overall : 50;
    var lifts = liftsFromScore(overall, 78);
    var payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      url: url || (result && result.page && result.page.baseHref) || '',
      host: '',
      overall: overall,
      scores: {
        structure: result && result.structure,
        entity: result && result.entity,
        faq: result && result.faq,
        discover: result && result.discover
      },
      gaps: (result && result.gaps) || [],
      actionsNow: (result && result.actions && result.actions.now) || [],
      lifts: lifts,
      evidenceClass: 'Observed（公開ページ準備度）+ Inferred（改善率提案）'
    };
    try {
      payload.host = payload.url ? new URL(payload.url).hostname : '';
    } catch (e) {}
    try {
      localStorage.setItem(HANDOFF_KEY, JSON.stringify(payload));
    } catch (e) {}
    return payload;
  }

  function loadDiagnoseHandoff() {
    try {
      return JSON.parse(localStorage.getItem(HANDOFF_KEY) || 'null');
    } catch (e) {
      return null;
    }
  }

  function loadOfficialBaseline() {
    try {
      return JSON.parse(localStorage.getItem(BASELINE_KEY) || 'null');
    } catch (e) {
      return null;
    }
  }

  /**
   * Build simulator inputs: Official baseline wins for traffic/CV when present;
   * diagnose handoff supplies uplift %; remaining fields stay defaults / user_input.
   */
  function buildSimulatorSeed(defaults) {
    defaults = defaults || {};
    var handoff = loadDiagnoseHandoff();
    var baseline = loadOfficialBaseline();
    var seed = {
      monthlyVisitors: defaults.monthlyVisitors != null ? defaults.monthlyVisitors : 5000,
      monthlyInquiries: defaults.monthlyInquiries != null ? defaults.monthlyInquiries : 50,
      monthlyLine: defaults.monthlyLine != null ? defaults.monthlyLine : 20,
      monthlyFee: defaults.monthlyFee != null ? defaults.monthlyFee : 200000,
      closeRatePct: defaults.closeRatePct != null ? defaults.closeRatePct : 20,
      avgDeal: defaults.avgDeal != null ? defaults.avgDeal : 500000,
      grossMarginPct: defaults.grossMarginPct != null ? defaults.grossMarginPct : 50,
      trafficUpliftPct: defaults.trafficUpliftPct != null ? defaults.trafficUpliftPct : 15,
      cvrUpliftPct: defaults.cvrUpliftPct != null ? defaults.cvrUpliftPct : 10,
      sources: {
        visitors: 'User Input',
        inquiries: 'User Input',
        uplift: 'User Input'
      },
      handoff: handoff,
      baseline: baseline,
      autoReady: false
    };

    if (handoff && handoff.lifts) {
      seed.trafficUpliftPct = handoff.lifts.trafficUpliftPct;
      seed.cvrUpliftPct = handoff.lifts.cvrUpliftPct;
      seed.sources.uplift = 'Inferred（診断スコア）';
      seed.overall = handoff.overall;
      seed.url = handoff.url;
    }

    if (baseline) {
      if (baseline.ga4 && baseline.ga4.monthlySessions > 0) {
        seed.monthlyVisitors = baseline.ga4.monthlySessions;
        seed.sources.visitors = 'Official（GA4 sessions）';
        seed.autoReady = true;
      } else if (baseline.monthlyClicks > 0) {
        seed.monthlyVisitors = baseline.monthlyClicks;
        seed.sources.visitors = 'Official（GSC clicks）';
        seed.autoReady = true;
      }
      if (baseline.ga4 && baseline.ga4.monthlyKeyEvents > 0) {
        seed.monthlyInquiries = baseline.ga4.monthlyKeyEvents;
        seed.sources.inquiries = 'Official（GA4 key events）';
        seed.autoReady = true;
      }
    }

    return seed;
  }

  function platformUrl(seed) {
    seed = seed || buildSimulatorSeed();
    var params = new URLSearchParams();
    params.set('from', 'diagnose');
    if (seed.overall != null) params.set('score', String(seed.overall));
    if (seed.url) params.set('url', seed.url);
    if (seed.autoReady) params.set('auto', '1');
    return '/airreach/platform/#simulator?' + params.toString();
  }

  window.AirReachHandoff = {
    HANDOFF_KEY: HANDOFF_KEY,
    BASELINE_KEY: BASELINE_KEY,
    liftsFromScore: liftsFromScore,
    saveDiagnoseHandoff: saveDiagnoseHandoff,
    loadDiagnoseHandoff: loadDiagnoseHandoff,
    loadOfficialBaseline: loadOfficialBaseline,
    buildSimulatorSeed: buildSimulatorSeed,
    platformUrl: platformUrl
  };
})();
