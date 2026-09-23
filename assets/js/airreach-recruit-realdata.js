/**
 * AirReach Recruit — Real data board.
 * Aggregates Official / Observed / Customer supplied sources already in the browser.
 * Never invents numbers. Distinguishes not_measured from 0.
 */
(function (root) {
  'use strict';

  var JOBISH = /採用|求人|recruit|career|job|jobs|hiring|hr|intern|エントリー|応募|募集|careers/i;

  function load(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || 'null');
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }

  function isJobish(text) {
    return JOBISH.test(String(text || ''));
  }

  function fmt(n) {
    var x = Number(n);
    if (!isFinite(x)) return '—';
    return Math.round(x).toLocaleString('ja-JP');
  }

  function pct(n) {
    if (n == null || !isFinite(n)) return '—';
    return (Math.round(n * 1000) / 10) + '%';
  }

  function collect(opts) {
    opts = opts || {};
    var jobFilter = opts.jobFilter !== false;

    var baseline = load('airreach_official_baseline_v1', null);
    var genai = load('airreach_generative_ai_v1', null);
    var studio = load('airreach_studio_v1', null);
    var aiRuns = load('airreach_recruit_ai_runs_v1', []);
    var funnel = load('airreach_recruit_application_flow_v1', null);
    var cvFlags = load('airreach_recruit_cv_flags_v1', {});
    var indexing = load('airreach_recruit_indexing_events_v1', []);
    var jobs = load('airreach_recruit_jobs_canonical_v1', []);
    var validation = load('airreach_recruit_last_validation_v1', null);
    var claims = load('airreach_recruit_evidence_graph_v1', []);

    // --- Search Official ---
    var search = { status: 'not_measured', evidenceClass: null };
    if (baseline && ((baseline.keywords && baseline.keywords.length) || baseline.totalImpressions > 0 || baseline.monthlyClicks > 0)) {
      var kws = baseline.keywords || [];
      var jobKws = kws.filter(function (k) { return isJobish(k.query || k.keyword || ''); });
      var useKws = jobFilter && jobKws.length ? jobKws : kws;
      var imp = useKws.reduce(function (s, r) { return s + (Number(r.impressions) || 0); }, 0);
      var clicks = useKws.reduce(function (s, r) { return s + (Number(r.clicks) || 0); }, 0);
      search = {
        status: 'measured',
        evidenceClass: 'Official',
        source: baseline.source || 'GSC CSV',
        periodDays: baseline.periodDays || null,
        importedAt: baseline.importedAt || null,
        totalImpressions: jobFilter && jobKws.length ? imp : (baseline.totalImpressions || imp),
        totalClicks: jobFilter && jobKws.length ? clicks : (baseline.totalClicks || clicks),
        monthlyImpressions: baseline.monthlyImpressions || null,
        monthlyClicks: baseline.monthlyClicks || null,
        avgCtr: (jobFilter && jobKws.length ? (imp > 0 ? clicks / imp : 0) : (baseline.avgCtr || 0)),
        keywordCount: useKws.length,
        jobKeywordCount: jobKws.length,
        filtered: !!(jobFilter && jobKws.length),
        topKeywords: useKws.slice(0, 10).map(function (r) {
          return {
            query: r.query || r.keyword || '',
            impressions: Number(r.impressions) || 0,
            clicks: Number(r.clicks) || 0,
            ctr: r.ctr != null ? r.ctr : (r.impressions ? r.clicks / r.impressions : 0),
            position: r.position || 0
          };
        }),
        ga4: baseline.ga4 || null
      };
    }

    // --- Generative AI Official ---
    var generativeAi = { status: 'not_measured', evidenceClass: null };
    if (genai && (genai.totalImpressions > 0 || (genai.pages && genai.pages.length))) {
      var pages = genai.pages || [];
      var jobPages = pages.filter(function (p) { return isJobish(p.page); });
      var usePages = jobFilter && jobPages.length ? jobPages : pages;
      var gImp = usePages.reduce(function (s, p) { return s + (Number(p.impressions) || 0); }, 0);
      generativeAi = {
        status: 'measured',
        evidenceClass: 'Official',
        source: genai.source || 'GSC Generative AI CSV',
        importedAt: genai.importedAt || null,
        totalImpressions: jobFilter && jobPages.length ? gImp : (genai.totalImpressions || gImp),
        pageCount: usePages.length,
        jobPageCount: jobPages.length,
        filtered: !!(jobFilter && jobPages.length),
        topPages: usePages.slice(0, 10).map(function (p) {
          return { page: p.page, impressions: Number(p.impressions) || 0 };
        })
      };
    }

    // --- HackⅡ Observed (recruit + studio) ---
    var aiObserved = { status: 'not_measured', evidenceClass: null };
    if (aiRuns[0] && aiRuns[0].all && aiRuns[0].all.n > 0) {
      aiObserved = {
        status: 'measured',
        evidenceClass: 'Observed',
        source: 'AirReach Recruit HackⅡ',
        at: aiRuns[0].at,
        brand: aiRuns[0].brand,
        all: aiRuns[0].all,
        branded: aiRuns[0].branded,
        generic: aiRuns[0].generic
      };
    } else if (studio && studio.hack2 && studio.hack2.length) {
      var rows = studio.hack2;
      var m = rows.reduce(function (s, r) { return s + (Number(r.mentioned) || Number(r.aiMention) || 0); }, 0);
      var c = rows.reduce(function (s, r) { return s + (Number(r.cited) || Number(r.aiCitation) || 0); }, 0);
      aiObserved = {
        status: 'measured',
        evidenceClass: 'Observed',
        source: 'HackⅡ Studio',
        all: {
          n: rows.length,
          mentionPct: Math.round((m / rows.length) * 100),
          citationPct: Math.round((c / rows.length) * 100)
        }
      };
    }

    // --- Application Official/Customer ---
    var application = { status: 'not_measured', evidenceClass: null };
    if (funnel && funnel.stages) {
      application = {
        status: 'measured',
        evidenceClass: funnel.evidenceClass || 'Customer supplied',
        source: funnel.source || 'Application Flow',
        importedAt: funnel.importedAt || null,
        stages: funnel.stages,
        stepRates: funnel.stepRates || [],
        overallCvr: funnel.overallCvr,
        instrumentationFlags: cvFlags
      };
    }

    // --- Jobs / indexing / evidence ---
    var inventory = {
      jobCount: (jobs || []).length,
      indexingEvents: (indexing || []).length,
      lastIndexing: indexing[0] || null,
      evidenceClaims: (claims || []).length,
      evidenceItems: (claims || []).reduce(function (n, c) { return n + ((c.evidence || []).length); }, 0),
      hasJobValidation: !!(validation && validation.requiredTotal != null)
    };

    var sources = [];
    function pushSrc(name, block) {
      sources.push({
        name: name,
        status: block.status,
        evidenceClass: block.evidenceClass,
        source: block.source || null
      });
    }
    pushSrc('通常検索 (GSC)', search);
    pushSrc('生成AI (GSC)', generativeAi);
    pushSrc('AI実測 (HackⅡ)', aiObserved);
    pushSrc('応募導線', application);

    var measured = sources.filter(function (s) { return s.status === 'measured'; }).length;

    return {
      collectedAt: new Date().toISOString(),
      jobFilter: jobFilter,
      summary: {
        measuredSources: measured,
        totalSources: sources.length,
        sources: sources
      },
      search: search,
      generativeAi: generativeAi,
      aiObserved: aiObserved,
      application: application,
      inventory: inventory,
      format: { fmt: fmt, pct: pct }
    };
  }

  root.AirReachRecruitRealData = {
    collect: collect,
    isJobish: isJobish,
    fmt: fmt,
    pct: pct
  };
})(typeof window !== 'undefined' ? window : globalThis);
