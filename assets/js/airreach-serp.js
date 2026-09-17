/**
 * AirReach SERP / AI Overview preview + opportunity-loss panel.
 * Free mode simulates appearance from measured page signals (labeled 推定).
 * Does NOT claim live Google AI Overviews or ChatGPT citation rates.
 */
(function () {
  'use strict';

  function yen(n) { return Math.round(Number(n) || 0); }
  function round1(n) { return Math.round(Number(n) * 10) / 10; }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function assumptions(result) {
    var a = (result.opportunity && result.opportunity.assumptions) || {};
    return {
      cvr: a.cvr != null ? a.cvr : 0.02,
      expectedCvValueYen: a.expectedCvValueYen != null ? a.expectedCvValueYen : 150000,
      grossMargin: a.grossMargin != null ? a.grossMargin : 0.7,
      reachableCtr: a.reachableCtr != null ? a.reachableCtr : 0.06
    };
  }

  function pickQueries(result) {
    var list = [];
    var seen = {};
    function add(q, source) {
      q = String(q || '').trim();
      if (!q || seen[q]) return;
      seen[q] = 1;
      list.push({ query: q, source: source });
    }
    ((result.os && result.os.decisionCoverage && result.os.decisionCoverage.topGaps) || []).forEach(function (g) {
      add(g.query, 'decision-gap');
    });
    ((result.os && result.os.decisionCoverage && result.os.decisionCoverage.queries) || []).forEach(function (g) {
      if (g.intent === 'decision') add(g.query, 'decision');
    });
    (result.themes || []).slice(0, 8).forEach(function (t) { add(t.name, 'theme'); });
    if (!list.length) add((result.plainSummary && result.plainSummary.host) || 'サービス', 'host');
    return list.slice(0, 12);
  }

  function findTheme(result, query) {
    var themes = result.themes || [];
    var best = null, score = 0;
    themes.forEach(function (t) {
      var a = String(t.name || '').toLowerCase();
      var b = String(query || '').toLowerCase();
      var s = 0;
      if (a === b) s = 100;
      else if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) s = 80;
      else {
        b.split(/\s+/).forEach(function (tok) {
          if (tok.length > 1 && a.indexOf(tok) >= 0) s += 15;
        });
      }
      if (s > score) { score = s; best = t; }
    });
    return best;
  }

  /** Likelihood the page could be eligible for AI Overview / AI Mode citation — estimated */
  function estimateAioEligibility(result) {
    var scores = result.scores || {};
    var foundation = (result.os && result.os.foundation && result.os.foundation.score) || scores.search || 50;
    var answer = scores.answer != null ? scores.answer : 40;
    var entity = scores.entity != null ? scores.entity : 40;
    var citationMissing = (result.os && result.os.citationGap && result.os.citationGap.missingCount) || 0;
    var raw = foundation * 0.35 + answer * 0.35 + entity * 0.2 - citationMissing * 4;
    var pct = clamp(Math.round(raw), 5, 92);
    var status = pct >= 70 ? 'appear_likely' : pct >= 45 ? 'borderline' : 'unlikely';
    return {
      dataKind: 'モデル予測（公開ページ実測から推計）',
      eligibilityPct: pct,
      status: status,
      label: status === 'appear_likely' ? 'AI Overviewに載りうる準備' : status === 'borderline' ? '境界（材料不足）' : '載りにくい',
      note: 'Google AI Overviews / AI Mode の実インプレッションではありません。Search Consoleの生成AIレポートまたはHackⅡ接続後に実測へ置換します。'
    };
  }

  function estimateChatAiVisibility(result) {
    var ai = result.scores && result.scores.ai != null ? result.scores.ai : result.overall || 50;
    var hand = result.aiMeasured;
    if (hand && hand.sampleSize) {
      return {
        dataKind: '実測（手計測）',
        mentionRate: hand.mentionRate,
        citationRate: hand.citationRate,
        recommendationRate: hand.recommendationRate,
        sampleSize: hand.sampleSize,
        label: '手計測 n=' + hand.sampleSize
      };
    }
    return {
      dataKind: 'モデル予測',
      mentionRate: clamp(Math.round(ai * 0.45), 3, 60),
      citationRate: clamp(Math.round(ai * 0.28), 1, 45),
      recommendationRate: clamp(Math.round(ai * 0.22), 1, 40),
      sampleSize: 0,
      label: '未実測（予測）'
    };
  }

  function buildOpportunityLoss(result, query) {
    var a = assumptions(result);
    var theme = findTheme(result, query);
    var impressions, clicks, ctr, position, dataKind;

    if (theme && theme.impressions != null) {
      impressions = theme.impressions;
      clicks = theme.clicks || 0;
      ctr = theme.ctr != null ? theme.ctr : (impressions ? clicks / impressions : 0);
      position = theme.currentRank;
      dataKind = theme.dataKind || '実測';
    } else if (result.searchMeasured) {
      // distribute site totals lightly for preview when no query match
      impressions = Math.round((result.searchMeasured.totalImpressions || 0) / Math.max(1, (result.themes || []).length || 5));
      clicks = Math.round((result.searchMeasured.totalClicks || 0) / Math.max(1, (result.themes || []).length || 5));
      ctr = impressions ? clicks / impressions : 0;
      position = null;
      dataKind = '実測（GSC按分）';
    } else if (theme) {
      impressions = theme.googleVolumeEst || 0;
      clicks = Math.round(impressions * Math.max(0.002, ((result.scores && result.scores.answer) || 40) / 100 * 0.04));
      ctr = impressions ? clicks / impressions : 0;
      position = null;
      dataKind = 'モデル予測';
    } else {
      impressions = 1200;
      clicks = 18;
      ctr = 0.015;
      position = null;
      dataKind = 'モデル予測';
    }

    var reachable = Math.max(ctr, a.reachableCtr);
    var missedClicks = Math.max(0, Math.round(impressions * reachable - clicks));
    var cvLoss = missedClicks * a.cvr;
    var revenueLoss = cvLoss * a.expectedCvValueYen;
    var profitLoss = revenueLoss * a.grossMargin;

    // AI Overview / AI Mode opportunity (estimated share of missed demand)
    var aio = estimateAioEligibility(result);
    var aioMissShare = aio.status === 'unlikely' ? 0.35 : aio.status === 'borderline' ? 0.22 : 0.12;
    var aioMissedClicks = Math.round(missedClicks * aioMissShare);
    var aioCv = aioMissedClicks * a.cvr;
    var aioRevenue = aioCv * a.expectedCvValueYen;

    return {
      query: query,
      dataKind: dataKind,
      impressions: impressions,
      clicks: clicks,
      ctr: Math.round(ctr * 10000) / 10000,
      position: position,
      missedClicks: missedClicks,
      cvLoss: round1(cvLoss),
      revenueLoss: yen(revenueLoss),
      profitLoss: yen(profitLoss),
      revenueLow: yen(revenueLoss * 0.55),
      revenueHigh: yen(revenueLoss * 1.45),
      aio: {
        dataKind: 'モデル予測',
        missedClicks: aioMissedClicks,
        cvLoss: round1(aioCv),
        revenueLoss: yen(aioRevenue),
        eligibilityPct: aio.eligibilityPct,
        status: aio.status,
        label: aio.label,
        note: aio.note
      },
      assumptions: a,
      formula: '機会損失クリック ≒ 表示 × max(実測/想定CTR, 到達可能CTR) − クリック。機会損失CV ≒ 損失クリック × CVR。機会損失売上 ≒ 損失CV × 期待価値。'
    };
  }

  function buildSerpPreview(result, query) {
    query = query || (pickQueries(result)[0] && pickQueries(result)[0].query) || '';
    var page = result.page || {};
    var host = (result.plainSummary && result.plainSummary.host) || '';
    var title = page.title || (result.plainSummary && result.plainSummary.topTheme) || host;
    var snippet = (result.review && result.review.conversionHint) ||
      ((result.os && result.os.understanding && result.os.understanding.summary) || '').slice(0, 160);
    var url = page.baseHref || ('https://' + host + '/');
    var aio = estimateAioEligibility(result);
    var chat = estimateChatAiVisibility(result);
    var loss = buildOpportunityLoss(result, query);
    var theme = findTheme(result, query);
    var covered = false;
    ((result.os && result.os.decisionCoverage && result.os.decisionCoverage.queries) || []).forEach(function (q) {
      if (q.query === query) covered = !!q.covered;
    });

    var aioBullets = [];
    if (result.os && result.os.understanding) {
      (result.os.understanding.fields || []).slice(0, 4).forEach(function (f) {
        aioBullets.push(f.label + ': ' + f.value);
      });
    }
    if (!aioBullets.length) {
      aioBullets = ['定義が不明瞭', '比較情報が不足', '一次情報が弱い'];
    }

    var appearInAio = aio.status !== 'unlikely' && covered;
    var organicRankHint = loss.position != null
      ? ('平均掲載順位 ' + loss.position + '（' + (String(loss.dataKind).indexOf('実測') >= 0 ? '実測' : '推定') + '）')
      : (aio.status === 'appear_likely' ? '有機結果に出やすい準備' : '有機結果でもクリックされにくい可能性');

    return {
      query: query,
      queries: pickQueries(result),
      dataKind: 'プレビュー（非公式UI）',
      disclaimer: 'Google検索・AI Overviewの公式画面ではありません。見え方は公開ページ実測に基づくプレビューです。実AI OverviewインプレッションはSearch Console生成AIレポート、ChatGPT等はHackⅡ/手計測で確認します。',
      organic: {
        title: title.slice(0, 70),
        url: url,
        displayUrl: host + ' ›',
        snippet: String(snippet).slice(0, 180),
        rankHint: organicRankHint,
        inResults: true
      },
      aiOverview: {
        dataKind: aio.dataKind,
        status: aio.status,
        label: aio.label,
        eligibilityPct: aio.eligibilityPct,
        shown: appearInAio || aio.status === 'appear_likely',
        headline: query + ' についてのAIによる概要（プレビュー）',
        bullets: aioBullets,
        cited: appearInAio,
        citeHost: host,
        note: aio.note
      },
      chatAi: chat,
      loss: loss,
      theme: theme ? theme.name : null
    };
  }

  function attachSerp(result, query) {
    result.serp = buildSerpPreview(result, query);
    // Reflect headline opportunity loss into opportunity if not GSC-measured sitewide yet
    if (result.serp && result.serp.loss && !result.searchMeasured) {
      var L = result.serp.loss;
      result.opportunityLoss = {
        dataKind: L.dataKind,
        query: L.query,
        revenueLoss: L.revenueLoss,
        profitLoss: L.profitLoss,
        cvLoss: L.cvLoss,
        missedClicks: L.missedClicks,
        aioRevenueLoss: L.aio.revenueLoss,
        formula: L.formula
      };
    } else if (result.opportunity) {
      result.opportunityLoss = {
        dataKind: result.opportunity.dataKind || 'モデル予測',
        query: (result.serp && result.serp.query) || '',
        revenueLoss: result.opportunity.revenueBase || 0,
        profitLoss: result.opportunity.profitBase || 0,
        cvLoss: result.opportunity.cvBase || 0,
        missedClicks: result.opportunity.clicksBase || 0,
        aioRevenueLoss: result.serp ? result.serp.loss.aio.revenueLoss : 0,
        formula: result.opportunity.formula || ''
      };
    }
    return result;
  }

  window.AirReachSerp = {
    buildSerpPreview: buildSerpPreview,
    buildOpportunityLoss: buildOpportunityLoss,
    attachSerp: attachSerp,
    pickQueries: pickQueries
  };
})();
