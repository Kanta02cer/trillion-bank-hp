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
    var baseline;
    try {
      baseline = JSON.parse(localStorage.getItem(BASELINE_KEY) || 'null');
      if (!baseline || baseline.evidenceClass !== 'Official' || !hasValidBaselineBinding(baseline)) return null;
      if (baseline.ga4 && baseline.ga4.evidenceClass !== 'Official') {
        baseline = JSON.parse(JSON.stringify(baseline));
        delete baseline.ga4;
      }
      return baseline;
    } catch (e) {
      return null;
    }
  }

  function propertyMatchesTarget(property, targetUrl) {
    var target;
    var propertyUrl;
    var domain;
    try { target = new URL(targetUrl); } catch (e) { return false; }
    property = String(property || '').trim();
    if (!property) return false;
    if (property.indexOf('sc-domain:') === 0) {
      domain = property.slice('sc-domain:'.length).toLowerCase().replace(/^www\./, '');
      return !!domain && (target.hostname.toLowerCase() === domain || target.hostname.toLowerCase().slice(-(domain.length + 1)) === '.' + domain);
    }
    try {
      propertyUrl = new URL(property);
      if (propertyUrl.origin !== target.origin) return false;
      if (!propertyUrl.pathname || propertyUrl.pathname === '/') return true;
      if (target.pathname === propertyUrl.pathname) return true;
      return propertyUrl.pathname.charAt(propertyUrl.pathname.length - 1) === '/'
        ? target.pathname.indexOf(propertyUrl.pathname) === 0
        : target.pathname.indexOf(propertyUrl.pathname + '/') === 0;
    } catch (e2) {
      return false;
    }
  }

  function baselineMatchesHandoff(baseline, handoff) {
    var binding;
    if (!baseline || !handoff || !handoff.url) return true;
    binding = baseline.property || baseline.targetUrl;
    return !!binding && propertyMatchesTarget(binding, handoff.url);
  }

  function hasValidBaselineBinding(baseline) {
    var binding = baseline && (baseline.property || baseline.targetUrl);
    var domain;
    if (!binding) return false;
    binding = String(binding).trim();
    if (binding.indexOf('sc-domain:') === 0) {
      domain = binding.slice('sc-domain:'.length).toLowerCase().replace(/^www\./, '');
      return /^[a-z0-9.-]+$/.test(domain) && domain.indexOf('.') > 0;
    }
    try {
      var parsed = new URL(binding);
      return /^https?:$/i.test(parsed.protocol) && !!parsed.hostname;
    } catch (e) {
      return false;
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
    if (baseline && baseline.evidenceClass !== 'Official') baseline = null;
    if (baseline && !hasValidBaselineBinding(baseline)) baseline = null;
    if (!baselineMatchesHandoff(baseline, handoff)) baseline = null;
    if (baseline && baseline.ga4 && baseline.ga4.evidenceClass !== 'Official') {
      try {
        baseline = JSON.parse(JSON.stringify(baseline));
        delete baseline.ga4;
      } catch (e) {
        baseline = null;
      }
    }
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


  function num(v, d) {
    var n = Number(v);
    return isFinite(n) ? n : d;
  }

  /**
   * Sales-facing impact simulation.
   * Primary outputs: addVisitors / addInquiries / addLine (Inferred).
   * Revenue/profit only when optional commercial inputs are set.
   */
  function simulateImpact(inputs, overall) {
    inputs = inputs || {};
    var lifts = liftsFromScore(overall != null ? overall : inputs.overall, inputs.targetScore || 78);
    var trafficPct = num(inputs.trafficUpliftPct, lifts.trafficUpliftPct);
    var cvrPct = num(inputs.cvrUpliftPct, lifts.cvrUpliftPct);
    var visitors = Math.max(0, num(inputs.monthlyVisitors, 0));
    var inquiries = Math.max(0, num(inputs.monthlyInquiries, 0));
    var line = Math.max(0, num(inputs.monthlyLine, 0));
    var fee = Math.max(0, num(inputs.monthlyFee, 0));
    var close = clamp(num(inputs.closeRatePct, 0) / 100, 0, 1);
    var avgDeal = Math.max(0, num(inputs.avgDeal, 0));
    var margin = clamp(num(inputs.grossMarginPct, 0) / 100, 0, 1);

    function one(mult) {
      var t = (trafficPct / 100) * mult;
      var c = (cvrPct / 100) * mult;
      var baseCvr = visitors > 0 ? inquiries / visitors : 0;
      var lineRate = visitors > 0 ? line / visitors : 0;
      var newVisitors = visitors * (1 + t);
      var newCvr = baseCvr * (1 + c);
      var newInquiries = visitors > 0 ? newVisitors * newCvr : inquiries * (1 + t * 0.5 + c);
      var newLine = visitors > 0 ? newVisitors * lineRate * (1 + c) : line * (1 + c);
      var addVisitors = Math.max(0, Math.round(newVisitors - visitors));
      var addInquiries = Math.max(0, Math.round(newInquiries - inquiries));
      var addLine = Math.max(0, Math.round(newLine - line));
      var addRevenue = close > 0 && avgDeal > 0 ? addInquiries * close * avgDeal : null;
      var addProfit = addRevenue != null && margin > 0 ? addRevenue * margin : null;
      var costPerExtraInquiry = fee > 0 && addInquiries > 0 ? fee / addInquiries : null;
      var roi = addProfit != null && fee > 0 ? (addProfit - fee) / fee : null;
      var addDeals = close > 0 ? addInquiries * close : null;
      return {
        addVisitors: addVisitors,
        addInquiries: addInquiries,
        addLine: addLine,
        addDeals: addDeals != null ? Math.round(addDeals * 10) / 10 : null,
        projectedVisitors: Math.round(newVisitors),
        projectedInquiries: Math.round(newInquiries),
        projectedLine: Math.round(newLine),
        addRevenue: addRevenue,
        addProfit: addProfit,
        costPerExtraInquiry: costPerExtraInquiry,
        roi: roi
      };
    }

    // Opportunity framing: gap vs target as "missed share" narrative (Inferred)
    var score = num(overall != null ? overall : inputs.overall, 50);
    var missedShare = clamp((78 - score) / 100, 0.05, 0.45);
    var missedInquiries = Math.round((visitors > 0 ? visitors * (inquiries / Math.max(visitors, 1)) : inquiries) * missedShare);
    if (missedInquiries < 1 && inquiries > 0) missedInquiries = 1;
    var missedDeals = close > 0 ? Math.round(missedInquiries * close * 10) / 10 : null;
    var opportunity = {
      evidenceClass: 'Inferred',
      missedVisitors: Math.round(visitors * missedShare * 0.7),
      missedInquiries: missedInquiries,
      missedDeals: missedDeals,
      note: 'いまの準備度だと取りこぼしている可能性のある集客レンジ（仮定）。実測ではありません。'
    };

    var before = {
      visitors: visitors,
      inquiries: inquiries,
      line: line,
      revenue: close > 0 && avgDeal > 0 ? inquiries * close * avgDeal : null,
      profit: close > 0 && avgDeal > 0 && margin > 0 ? inquiries * close * avgDeal * margin : null
    };
    var base = one(1);
    var after = {
      visitors: base.projectedVisitors,
      inquiries: base.projectedInquiries,
      line: base.projectedLine,
      revenue: base.addRevenue != null && before.revenue != null ? before.revenue + base.addRevenue : base.addRevenue,
      profit: base.addProfit != null && before.profit != null ? before.profit + base.addProfit : base.addProfit
    };

    var formulas = {
      visitors: '改善後の訪問 ≒ いまの訪問 ×（1 + 訪問の伸び率）',
      inquiries: '改善後の問い合わせ ≒ 改善後の訪問 ×（いまの問合せ率 ×（1 + 成約しやすさの伸び））',
      line: '改善後のLINE ≒ 改善後の訪問 ×（いまのLINE率 ×（1 + 成約しやすさの伸び））',
      revenue: '追加売上 ≒ 追加問い合わせ × 受注率 × 平均受注額',
      profit: '追加粗利 ≒ 追加売上 × 粗利率',
      fee: '問い合わせ1件あたり費用 ≒ 月額費用 ÷ 追加問い合わせ',
      lost: '取りこぼし問い合わせ ≒ いまの問い合わせ規模 × スコア差の仮定'
    };

    return {
      evidenceClass: 'Inferred（User Input × 仮定）',
      disclaimer: '成果・掲載・流入・問い合わせ・売上を保証しません。入力と仮定に基づく参考シミュレーションです。',
      lifts: lifts,
      opportunity: opportunity,
      before: before,
      after: after,
      formulas: formulas,
      inputs: {
        evidenceClass: 'User Input',
        monthlyVisitors: visitors,
        monthlyInquiries: inquiries,
        monthlyLine: line,
        monthlyFee: fee,
        closeRatePct: close * 100,
        avgDeal: avgDeal,
        grossMarginPct: margin * 100,
        trafficUpliftPct: trafficPct,
        cvrUpliftPct: cvrPct
      },
      scenarios: {
        low: one(0.6),
        base: base,
        high: one(1.4)
      }
    };
  }

  function saveImpactInputs(inputs) {
    try { localStorage.setItem('airreach_impact_inputs_v1', JSON.stringify(inputs || {})); } catch (e) {}
  }

  function loadImpactInputs() {
    try { return JSON.parse(localStorage.getItem('airreach_impact_inputs_v1') || 'null'); } catch (e) { return null; }
  }

  window.AirReachHandoff = {
    HANDOFF_KEY: HANDOFF_KEY,
    BASELINE_KEY: BASELINE_KEY,
    liftsFromScore: liftsFromScore,
    saveDiagnoseHandoff: saveDiagnoseHandoff,
    loadDiagnoseHandoff: loadDiagnoseHandoff,
    loadOfficialBaseline: loadOfficialBaseline,
    baselineMatchesHandoff: baselineMatchesHandoff,
    buildSimulatorSeed: buildSimulatorSeed,
    platformUrl: platformUrl,
    simulateImpact: simulateImpact,
    saveImpactInputs: saveImpactInputs,
    loadImpactInputs: loadImpactInputs
  };
})();
