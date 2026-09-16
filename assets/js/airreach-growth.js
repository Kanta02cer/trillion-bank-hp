/**
 * AirReach Growth layers (P1 Connected / P2 HackⅡ / P3 Action).
 * Live Google OAuth and live AI-answer APIs are NOT called here.
 * Measured values must be user-supplied or HackⅡ-connected; SAMPLE is always labeled.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'airreach_growth_snapshots_v1';

  function yen(n) { return Math.round(Number(n) || 0); }
  function round1(n) { return Math.round(Number(n) * 10) / 10; }

  function assumptionsFrom(result) {
    var a = (result && result.opportunity && result.opportunity.assumptions) || {};
    return {
      cvr: a.cvr != null ? a.cvr : 0.02,
      expectedCvValueYen: a.expectedCvValueYen != null ? a.expectedCvValueYen : 150000,
      grossMargin: a.grossMargin != null ? a.grossMargin : 0.7,
      reachableCtr: a.reachableCtr != null ? a.reachableCtr : 0.06
    };
  }

  /** P1: replace model estimates with user-supplied GSC/GA4-like measurements */
  function applySearchMeasured(theme, measured, result) {
    var a = assumptionsFrom(result);
    var impressions = Math.max(0, Number(measured.impressions) || 0);
    var clicks = Math.max(0, Number(measured.clicks) || 0);
    var ctr = impressions > 0 ? clicks / impressions : (Number(measured.ctr) || 0);
    var position = Number(measured.position) || null;
    var sessions = measured.sessions != null ? Number(measured.sessions) : clicks;
    var conversions = measured.conversions != null ? Number(measured.conversions) : null;
    var cvr = conversions != null && sessions > 0 ? conversions / sessions : a.cvr;
    var revenue = measured.revenue != null ? Number(measured.revenue) : null;

    var reachableCtr = Math.max(ctr, a.reachableCtr);
    var missedClicks = Math.max(0, Math.round(impressions * reachableCtr - clicks));
    var cvOpp = missedClicks * cvr;
    var revenueOpp = revenue != null && conversions != null && conversions > 0
      ? (revenue / conversions) * cvOpp
      : cvOpp * a.expectedCvValueYen;
    var profitOpp = revenueOpp * a.grossMargin;
    var brandShare = measured.brandShare != null ? Number(measured.brandShare) : null;

    return Object.assign({}, theme, {
      googleVolumeEst: impressions || theme.googleVolumeEst,
      impressions: impressions,
      clicks: clicks,
      ctr: Math.round(ctr * 10000) / 10000,
      currentRank: position,
      brandShare: brandShare,
      clicksEst: missedClicks,
      cvEst: round1(cvOpp),
      revenueEst: yen(revenueOpp),
      profitEst: yen(profitOpp),
      ctrGap: Math.round((reachableCtr - ctr) * 10000) / 10000,
      dataKind: '実測（ユーザー入力）',
      measuredSource: measured.source || 'GSC/GA4入力',
      measuredNote: '表示回数・クリック等は入力値。機会は到達可能CTRとの差から再計算。'
    });
  }

  function recomputeOpportunity(themes) {
    var clicksBase = themes.reduce(function (s, t) { return s + (t.clicksEst || 0); }, 0);
    var cvBase = themes.reduce(function (s, t) { return s + (t.cvEst || 0); }, 0);
    var revenueBase = themes.reduce(function (s, t) { return s + (t.revenueEst || 0); }, 0);
    return {
      clicksBase: clicksBase,
      cvBase: round1(cvBase),
      cvLow: round1(cvBase * 0.55),
      cvHigh: round1(cvBase * 1.45),
      revenueBase: yen(revenueBase),
      revenueLow: yen(revenueBase * 0.55),
      revenueHigh: yen(revenueBase * 1.45),
      profitBase: yen(revenueBase * 0.7),
      profitLow: yen(revenueBase * 0.55 * 0.7),
      profitHigh: yen(revenueBase * 1.45 * 0.7),
      dataKind: themes.some(function (t) { return t.dataKind && t.dataKind.indexOf('実測') === 0; })
        ? '実測混合（入力値で再計算）'
        : 'モデル予測'
    };
  }

  /** P2: SAMPLE / projection until HackⅡ is connected — never claim live rates */
  function buildHack2Layer(theme, result, options) {
    options = options || {};
    var sample = !!options.sample;
    var readiness = (result && result.scores && result.scores.ai) || 50;
    var baseVis = Math.max(5, Math.min(55, Math.round(readiness * 0.45)));
    var brand = Math.max(3, Math.round(baseVis * 0.7));
    var cite = Math.max(2, Math.round(baseVis * 0.45));
    var rec = Math.max(1, Math.round(baseVis * 0.35));
    var competitorRec = Math.min(72, rec + 18 + (theme.priority ? Math.round(theme.priority / 10) : 10));
    var thirdPartyCiteComp = Math.min(45, cite + 20);
    var thirdPartyCiteSelf = Math.max(1, Math.round(cite * 0.35));

    return {
      theme: theme.name,
      dataKind: sample ? 'SAMPLE（デモ）' : '未計測',
      disclaimer: sample
        ? 'SAMPLE表示です。実AI回答の測定ではありません。HackⅡ接続後に置換します。'
        : '無料診断では取得しません。HackⅡで同条件測定後に表示します。',
      metrics: sample ? {
        aiVisibility: baseVis,
        brandMentionRate: brand,
        citationRate: cite,
        recommendationRate: rec,
        top1Rate: Math.max(0, Math.round(rec * 0.4)),
        shareOfVoice: Math.round(baseVis * 0.9),
        citationShare: Math.round(cite * 0.8),
        averagePosition: Math.max(1.5, round1(8 - readiness / 20)),
        sentiment: '中立寄り',
        factAccuracy: '未検証',
        hallucination: '未検証',
        queryFanout: theme.prompts ? theme.prompts.length : 3,
        responseVolatility: '中'
      } : null,
      whyLosing: sample ? {
        competitorName: '競合A（SAMPLE）',
        competitorRec: competitorRec,
        selfRec: rec,
        gaps: [
          { label: '第三者比較サイト', competitor: thirdPartyCiteComp + '%', self: thirdPartyCiteSelf + '%' },
          { label: '公式料金情報', competitor: 'あり', self: readiness >= 70 ? '一部あり' : '不明瞭' },
          { label: '一次データ / 事例', competitor: '14件（SAMPLE）', self: readiness >= 60 ? '数件' : '薄い' }
        ]
      } : null,
      connectCta: '/trillionbank/business/hack2/'
    };
  }

  /** P3: weekly focus list */
  function buildWeeklyTasks(result) {
    var themes = (result && result.themes) || [];
    var tasks = themes.slice(0, 3).map(function (t, i) {
      return {
        rank: i + 1,
        title: t.action || (t.name + ' を改善'),
        theme: t.name,
        cvEst: t.cvEst,
        revenueEst: t.revenueEst,
        profitEst: t.profitEst != null ? t.profitEst : yen((t.revenueEst || 0) * 0.7),
        effort: t.effort || '中',
        confidence: t.confidence || 70,
        priority: t.priority || 0,
        dataKind: t.dataKind || 'モデル予測'
      };
    });
    if ((result.scores || {}).entity < 60) {
      tasks.push({
        rank: tasks.length + 1,
        title: 'Organization / Product 情報を補強',
        theme: 'エンティティ',
        cvEst: null,
        revenueEst: null,
        profitEst: null,
        effort: '低',
        confidence: 80,
        priority: 60,
        aiExpectation: 'High',
        dataKind: 'モデル予測'
      });
    }
    return tasks.slice(0, 3);
  }

  /** P3: content / tech brief from a theme — draft only, no auto-publish */
  function buildActionBrief(theme, result) {
    var name = theme.name || '対象テーマ';
    var host = (result && result.plainSummary && result.plainSummary.host) || '';
    var h1 = name.replace(/\s+(比較|おすすめ|料金|とは)$/, '');
    var intent = theme.intent || 'informational';
    var faqs = [
      name + 'とは何ですか？',
      name + 'の選び方のポイントは？',
      '料金や導入の目安は？',
      'どんな企業に向いていますか？',
      '向いていないケースは？'
    ];
    var h2 = intent === 'comparison'
      ? ['比較の結論', '評価軸', '料金の違い', '向いている人 / 向いていない人', 'よくある質問']
      : intent === 'commercial'
        ? ['できること', '対象と対象外', '料金の目安', '導入の流れ', 'よくある質問']
        : ['定義', 'なぜ今重要か', '進め方', '注意点', 'よくある質問'];

    return {
      theme: name,
      opportunityYen: theme.revenueEst || 0,
      cvEst: theme.cvEst || 0,
      effort: theme.effort || '中',
      confidence: theme.confidence || 70,
      dataKind: theme.dataKind || 'モデル予測',
      actionLabel: theme.action || 'ページを改善',
      title: name + '｜比較・選び方・料金の判断材料',
      metaDescription: name + 'の定義、比較軸、料金の見方、向いている対象を整理。判断材料として一次情報とFAQを掲載。',
      h1: h1 + 'を選ぶ前に確認したいこと',
      h2: h2,
      faq: faqs,
      comparisonTable: intent === 'comparison'
        ? ['評価軸', '自社', '競合A', '競合B', '備考']
        : ['項目', '内容', '根拠URL'],
      requiredPrimary: ['公式の対象 / 非対象', '料金または見積もりの考え方', '導入フロー', '更新日'],
      requiredThirdParty: ['比較・解説メディアでの言及有無', '業界レポートや公的統計（あれば）'],
      jsonLd: ['Organization', 'WebPage', intent === 'comparison' ? 'FAQPage' : 'FAQPage', 'BreadcrumbList'],
      internalLinks: ['料金またはプランページ', '事例または導入の考え方', 'お問い合わせ / 商談'],
      cta: 'このテーマの判断材料を揃えたうえで相談する',
      updatePages: host ? ['https://' + host + '/'] : ['既存のサービス説明ページ'],
      newPages: intent === 'comparison' ? [name + ' 比較ランディング'] : [],
      githubNote: 'GitHub接続時は差分確認 → PR作成まで。自動マージ / 自動公開はしません。',
      disclaimer: '自動生成の下書きです。公開前に人が承認してください。効果を保証しません。'
    };
  }

  function saveSnapshot(result, url) {
    var all = [];
    try { all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (e) { all = []; }
    var snap = {
      at: new Date().toISOString(),
      url: url,
      host: result.plainSummary && result.plainSummary.host,
      overall: result.overall,
      opportunity: result.opportunity,
      topTheme: result.plainSummary && result.plainSummary.topTheme,
      themes: (result.themes || []).slice(0, 5).map(function (t) {
        return {
          name: t.name,
          priority: t.priority,
          clicksEst: t.clicksEst,
          cvEst: t.cvEst,
          revenueEst: t.revenueEst,
          dataKind: t.dataKind,
          currentRank: t.currentRank,
          ctr: t.ctr,
          recommendationRate: t.hack2 && t.hack2.metrics && t.hack2.metrics.recommendationRate
        };
      })
    };
    all.unshift(snap);
    all = all.slice(0, 12);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)); } catch (e) { /* ignore */ }
    return snap;
  }

  function listSnapshots(host) {
    var all = [];
    try { all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (e) { all = []; }
    if (!host) return all;
    return all.filter(function (s) { return s.host === host; });
  }

  function compareSnapshots(prev, curr) {
    if (!prev || !curr) return null;
    var pOpp = (prev.opportunity && prev.opportunity.revenueBase) || 0;
    var cOpp = (curr.opportunity && curr.opportunity.revenueBase) || 0;
    var pCv = (prev.opportunity && prev.opportunity.cvBase) || 0;
    var cCv = (curr.opportunity && curr.opportunity.cvBase) || 0;
    return {
      dataKind: '再測定差分（端末内スナップショット）',
      overallBefore: prev.overall,
      overallAfter: curr.overall,
      revenueDelta: cOpp - pOpp,
      cvDelta: round1(cCv - pCv),
      prevAt: prev.at,
      currAt: curr.at,
      note: 'ブラウザ内に保存した診断結果同士の差分です。GSC/HackⅡの公式時系列ではありません。'
    };
  }

  function attachHack2ToThemes(result, sample) {
    var themes = (result.themes || []).map(function (t) {
      return Object.assign({}, t, { hack2: buildHack2Layer(t, result, { sample: sample }) });
    });
    return Object.assign({}, result, { themes: themes, hack2Sample: !!sample });
  }

  window.AirReachGrowth = {
    applySearchMeasured: applySearchMeasured,
    recomputeOpportunity: recomputeOpportunity,
    buildHack2Layer: buildHack2Layer,
    buildWeeklyTasks: buildWeeklyTasks,
    buildActionBrief: buildActionBrief,
    saveSnapshot: saveSnapshot,
    listSnapshots: listSnapshots,
    compareSnapshots: compareSnapshots,
    attachHack2ToThemes: attachHack2ToThemes
  };
})();
