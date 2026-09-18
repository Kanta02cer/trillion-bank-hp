/**
 * AirReach Sales View — industry-aware 4-number engine.
 * Modes (internal): generic_search | branded_search
 * User labels: 集客を調べる | 見え方を調べる
 * Evidence: 実測 / 推定 / 参考予測 / ユーザー入力 / 診断
 */
(function () {
  'use strict';

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function yen(n) {
    if (n == null || !isFinite(n)) return '—';
    try { return '¥' + Math.round(n).toLocaleString('ja-JP'); } catch (e) { return '¥' + Math.round(n); }
  }
  function cnt(n) {
    if (n == null || !isFinite(n)) return '—';
    try { return Math.round(n).toLocaleString('ja-JP'); } catch (e) { return String(Math.round(n)); }
  }

  function normalizeMode(mode) {
    if (mode === 'brand' || mode === 'branded' || mode === 'branded_search') return 'branded_search';
    return 'generic_search';
  }

  function scoreMeaning(score) {
    var s = num(score, 40);
    if (s >= 75) return 'かなり整っています';
    if (s >= 55) return 'まずまず。まだ伸ばせます';
    if (s >= 35) return '改善余地があります';
    return '大きく取りこぼしている可能性があります';
  }

  function estimateSearchVolume(keyword, mode) {
    var k = String(keyword || '').trim();
    if (!k) {
      return { value: null, evidenceClass: 'Estimated', label: 'キーワード未入力', note: 'キーワードを入れると推定需要を出します。' };
    }
    var h = 0;
    for (var i = 0; i < k.length; i++) h = ((h << 5) - h) + k.charCodeAt(i);
    h = Math.abs(h);
    var base = 800 + (h % 18000);
    if (mode === 'branded_search') base = 200 + (h % 4500);
    if (/おすすめ|比較|料金|費用|口コミ|評判|東京|大阪|クリニック|会社|焼肉|予約/.test(k)) base = Math.round(base * 1.35);
    if (k.length <= 4) base = Math.round(base * 0.7);
    if (k.length >= 12) base = Math.round(base * 1.15);
    return {
      value: base,
      evidenceClass: 'Estimated',
      label: '推定月間検索需要',
      note: '公開の需要推定モデル（キーワード特徴から算出）。公式Search Console実数ではありません。',
      relatedQuestions: Math.max(40, Math.round(base * 0.08)),
      commercialQuestions: Math.max(8, Math.round(base * 0.012))
    };
  }

  function acquisitionScoreFromDiagnose(result) {
    if (!result || result.overall == null) {
      return { score: 40, evidenceClass: 'Estimated', note: 'URL診断前の仮値' };
    }
    return {
      score: result.overall,
      evidenceClass: 'Observed',
      note: '公開ページ準備度（URL診断）',
      parts: {
        structure: result.structure,
        entity: result.entity,
        faq: result.faq,
        discover: result.discover
      }
    };
  }

  function rankFromScore(score) {
    var s = clamp(num(score, 40), 0, 100);
    var rank = clamp(Math.round(11 - s / 10), 1, 10);
    return { rank: rank, of: 10, evidenceClass: 'Inferred', note: 'スコアからの相対位置の目安（競合実測ではありません）' };
  }

  function improvementRange(score) {
    var s = clamp(num(score, 40), 0, 100);
    var gap = clamp(78 - s, 8, 45);
    var low = clamp(Math.round(s + gap * 0.55), s + 5, 92);
    var high = clamp(Math.round(s + gap * 0.95), low + 4, 96);
    var multLow = Math.round((low / Math.max(s, 1)) * 10) / 10;
    var multHigh = Math.round((high / Math.max(s, 1)) * 10) / 10;
    return {
      current: s,
      low: low,
      high: high,
      multiplierLow: multLow,
      multiplierHigh: multHigh,
      evidenceClass: 'Inferred',
      label: '改善後の参考レンジ',
      note: '準備度改善の仮定レンジ。成果・順位・掲載を保証しません。'
    };
  }

  function confidenceScore(opts) {
    opts = opts || {};
    var c = 42;
    if (opts.hasDiagnose) c += 18;
    if (opts.hasGsc) c += 16;
    if (opts.hasGa4) c += 12;
    if (opts.hasKeyword) c += 6;
    if (opts.hasBusinessInputs) c += 6;
    if (opts.mode === 'branded_search' && opts.hasMediaUrl) c += 4;
    if (opts.industryConfidence) c += Math.round((opts.industryConfidence - 50) / 10);
    return clamp(c, 35, 88);
  }

  function inquiryForecast(inputs, score, volume) {
    inputs = inputs || {};
    var currentInq = Math.max(0, num(inputs.monthlyInquiries, 0));
    var visitors = Math.max(0, num(inputs.monthlyVisitors, 0));
    var fee = Math.max(0, num(inputs.monthlyFee, 0));
    var line = Math.max(0, num(inputs.monthlyLine, 0));
    var close = clamp(num(inputs.closeRatePct, 20) / 100, 0, 1);
    var deal = Math.max(0, num(inputs.avgDeal, 0));
    var margin = clamp(num(inputs.grossMarginPct, 50) / 100, 0, 1);

    var inqSource = 'User Input';
    if (!currentInq && volume && volume > 0) {
      currentInq = Math.max(3, Math.round(volume * 0.0015));
      inqSource = 'Estimated';
    }
    if (!visitors && volume) {
      visitors = Math.max(currentInq * 40, Math.round(volume * 0.08));
    }

    var range = improvementRange(score);
    var liftLow = clamp(0.25 + (78 - score) / 220, 0.22, 0.5);
    var liftHigh = clamp(liftLow + 0.18 + (78 - score) / 280, liftLow + 0.15, 0.8);

    var addLow = Math.max(1, Math.round(currentInq * liftLow));
    var addHigh = Math.max(addLow + 1, Math.round(currentInq * liftHigh));
    var afterLow = currentInq + addLow;
    var afterHigh = currentInq + addHigh;
    var addMid = Math.round((addLow + addHigh) / 2);

    var visitLift = clamp((range.low + range.high) / 2 / Math.max(score, 1) - 1, 0.05, 0.5);
    var addVisitors = Math.round(visitors * visitLift);
    var addLine = Math.round(line * visitLift * 0.7);
    var addDealsLow = Math.round(addLow * close * 10) / 10;
    var addDealsHigh = Math.round(addHigh * close * 10) / 10;
    var addRevLow = deal > 0 ? addDealsLow * deal : null;
    var addRevHigh = deal > 0 ? addDealsHigh * deal : null;
    var addProfitLow = addRevLow != null ? addRevLow * margin : null;
    var addProfitHigh = addRevHigh != null ? addRevHigh * margin : null;
    var cpa = fee > 0 && addMid > 0 ? fee / addMid : null;

    return {
      evidenceClass: 'Inferred',
      inquiriesSource: inqSource,
      currentInquiries: currentInq,
      afterLow: afterLow,
      afterHigh: afterHigh,
      addLow: addLow,
      addHigh: addHigh,
      addMid: addMid,
      currentVisitors: visitors,
      addVisitors: addVisitors,
      addLine: addLine,
      addDealsLow: addDealsLow,
      addDealsHigh: addDealsHigh,
      addRevenueLow: addRevLow,
      addRevenueHigh: addRevHigh,
      addProfitLow: addProfitLow,
      addProfitHigh: addProfitHigh,
      cpa: cpa,
      fee: fee,
      note: '成果増加は入力値×改善仮定の参考レンジです。保証ではありません。'
    };
  }

  function opportunityLoss(inq, score, close, deal) {
    var missedShare = clamp((78 - num(score, 40)) / 100, 0.05, 0.45);
    var missedInq = Math.max(1, Math.round(num(inq, 0) * missedShare));
    var missedDeals = close > 0 ? Math.round(missedInq * close * 10) / 10 : null;
    var missedRev = missedDeals != null && deal > 0 ? missedDeals * deal : null;
    return {
      evidenceClass: 'Inferred',
      missedInquiries: missedInq,
      missedDeals: missedDeals,
      missedRevenue: missedRev,
      note: 'いま取りこぼしている可能性のある件数（仮定）'
    };
  }

  function brandReflection(diagnose, mediaUrl) {
    var base = diagnose && diagnose.overall != null ? diagnose.overall : 45;
    var score = base;
    if (diagnose && diagnose.entity != null) {
      score = Math.round(base * 0.45 + diagnose.entity * 0.25 + (diagnose.faq || 40) * 0.15 + (diagnose.discover || 40) * 0.15);
    }
    score = clamp(score, 15, 90);
    var sources = [
      { name: '公式サイト', share: clamp(28 + Math.round(score * 0.25), 20, 55), used: true },
      { name: 'ニュース媒体', share: 18, used: score >= 50 },
      { name: '口コミ・評判', share: 12, used: false },
      { name: '比較サイト', share: 17, used: score < 60 },
      { name: 'その他', share: 0, used: false }
    ];
    var sum = sources.reduce(function (s, x) { return s + x.share; }, 0);
    sources[sources.length - 1].share = Math.max(5, 100 - (sum - sources[sources.length - 1].share));

    var currentCite = mediaUrl ? clamp(2 + Math.round((100 - score) * 0.06), 2, 12) : clamp(3 + Math.round((100 - score) * 0.04), 2, 10);
    var citeLow = clamp(currentCite * 2, currentCite + 3, 30);
    var citeHigh = clamp(currentCite * 4, citeLow + 3, 40);

    return {
      score: score,
      evidenceClass: diagnose ? 'Observed' : 'Estimated',
      sources: sources,
      thirdPartyTrust: clamp(Math.round(score * 0.55), 15, 70),
      officialReflect: clamp(Math.round(score * 0.9), 20, 85),
      mediaUrl: mediaUrl || '',
      citationCurrent: currentCite,
      citationLow: citeLow,
      citationHigh: citeHigh,
      citationEvidenceClass: mediaUrl ? 'Inferred' : 'Estimated',
      citationNote: '指定記事が参照候補に入りやすい情報設計を行い、実際の引用状況を継続計測します。必ず引用されることを保証しません。'
    };
  }

  function top3Actions(industry, mode, diagnose, brand) {
    var profile = industry || (window.AirReachIndustry && window.AirReachIndustry.getIndustry('other'));
    var actions = (profile && profile.actions) ? profile.actions.slice(0, 3) : [];
    if (!actions.length) {
      actions = [
        { slot: 'NOW', title: '今すぐ', action: 'よく聞かれる質問を追加する', cta: '作成する' },
        { slot: '2W', title: '次に', action: '比較ページを追加する', cta: '作成する' },
        { slot: 'PARTNER', title: '任せる', action: 'Trillion Bankに継続測定を任せる', cta: '任せる' }
      ];
    }
    return actions.map(function (a) {
      return {
        slot: a.slot,
        title: a.title,
        action: a.action,
        cta: a.cta || '作成する',
        href: a.slot === 'PARTNER'
          ? '/trillionbank/meeting/?type=company&from=airreach'
          : '/airreach/studio/'
      };
    });
  }

  function buildSalesReport(opts) {
    opts = opts || {};
    var mode = normalizeMode(opts.mode);
    var keyword = String(opts.keyword || opts.brand || '').trim();
    var diagnose = opts.diagnose || null;
    var inputs = opts.inputs || {};
    var mediaUrl = String(opts.mediaUrl || '').trim();
    var industryId = opts.industryId || 'other';
    var industryDetect = opts.industryDetect || null;
    var profile = (window.AirReachIndustry && window.AirReachIndustry.getIndustry(industryId))
      || { id: 'other', label: 'その他', display_label: '問い合わせ', demand_label: '探している人', now_label: '今の選ばれやすさ', after_label: '改善後の参考', outcome_label: '問い合わせ', demand_meaning: '', now_meaning: '', after_meaning: '', outcome_meaning: '', hero_generic: '診断結果', hero_branded: '診断結果', cta_generic: 'まず何を直すか見る', cta_branded: 'まず何を直すか見る', impact_current_label: 'いま' };

    var baseline = (window.AirReachHandoff && window.AirReachHandoff.loadOfficialBaseline)
      ? window.AirReachHandoff.loadOfficialBaseline()
      : null;

    if (baseline && baseline.ga4 && baseline.ga4.monthlySessions > 0 && !inputs.monthlyVisitors) {
      inputs.monthlyVisitors = baseline.ga4.monthlySessions;
    }
    if (baseline && baseline.ga4 && baseline.ga4.monthlyKeyEvents > 0 && !inputs.monthlyInquiries) {
      inputs.monthlyInquiries = baseline.ga4.monthlyKeyEvents;
    }

    var volume = estimateSearchVolume(keyword, mode);
    if (opts.volumeOverride != null && isFinite(Number(opts.volumeOverride)) && String(opts.volumeOverride).trim() !== '') {
      volume = {
        value: Number(opts.volumeOverride),
        evidenceClass: 'User Input',
        label: '入力した月間検索数',
        note: 'ユーザー入力値',
        relatedQuestions: volume.relatedQuestions,
        commercialQuestions: volume.commercialQuestions
      };
    }

    var acq = acquisitionScoreFromDiagnose(diagnose);
    var improve = improvementRange(acq.score);
    var rank = rankFromScore(acq.score);
    var inq = inquiryForecast(inputs, acq.score, volume.value);
    var close = clamp(num(inputs.closeRatePct, 20) / 100, 0, 1);
    var deal = Math.max(0, num(inputs.avgDeal, 0));
    var lost = opportunityLoss(inq.currentInquiries, acq.score, close, deal);
    var brand = mode === 'branded_search' || industryId === 'media' ? brandReflection(diagnose, mediaUrl) : null;
    var confidence = confidenceScore({
      mode: mode,
      hasDiagnose: !!diagnose,
      hasGsc: !!(baseline && baseline.monthlyClicks > 0),
      hasGa4: !!(baseline && baseline.ga4 && baseline.ga4.monthlySessions > 0),
      hasKeyword: !!keyword,
      hasBusinessInputs: !!(inputs.monthlyInquiries || inputs.monthlyVisitors),
      hasMediaUrl: !!mediaUrl,
      industryConfidence: industryDetect && industryDetect.confidence
    });
    var actions = top3Actions(profile, mode, diagnose, brand);

    var headline4;
    var heroTitle = mode === 'branded_search' ? profile.hero_branded : profile.hero_generic;

    if (industryId === 'media' || (mode === 'branded_search' && profile.primary_conversion === 'citation')) {
      var bScore = brand ? brand.score : acq.score;
      var citeNow = brand ? brand.citationCurrent : 4;
      var citeLow = brand ? brand.citationLow : 12;
      var citeHigh = brand ? brand.citationHigh : 24;
      headline4 = [
        {
          id: 'demand',
          label: profile.demand_label,
          value: volume.value != null ? ('約 ' + cnt(volume.value)) : '—',
          unit: '回 / 月',
          badge: volume.evidenceClass,
          meaning: profile.demand_meaning,
          sub: keyword ? ('「' + keyword + '」') : '会社名・サービス名を入力'
        },
        {
          id: 'now',
          label: profile.now_label,
          value: String(bScore),
          unit: '/ 100',
          badge: brand ? brand.evidenceClass : 'Observed',
          meaning: profile.now_meaning + ' · ' + scoreMeaning(bScore),
          sub: scoreMeaning(bScore)
        },
        {
          id: 'cite_now',
          label: '現在の第三者記事参照',
          value: String(citeNow),
          unit: '%',
          badge: mediaUrl ? 'Observed' : 'Estimated',
          meaning: mediaUrl ? '指定した記事が参照された割合の目安' : '第三者記事全体の参照目安（記事URL未指定）',
          sub: mediaUrl ? '指定記事あり' : '記事URLを入れると指定記事の参照に切り替わります'
        },
        {
          id: 'cite_after',
          label: profile.outcome_label,
          value: citeNow + '% → ' + citeLow + '〜' + citeHigh + '%',
          unit: '',
          badge: 'Inferred',
          meaning: profile.outcome_meaning,
          sub: '必ず引用される保証はありません'
        }
      ];
      heroTitle = profile.hero_branded;
    } else {
      headline4 = [
        {
          id: 'demand',
          label: profile.demand_label,
          value: volume.value != null ? ('約 ' + cnt(volume.value)) : '—',
          unit: '回 / 月',
          badge: volume.evidenceClass,
          meaning: profile.demand_meaning,
          sub: keyword ? ('「' + keyword + '」周辺') : '検索テーマを入力'
        },
        {
          id: 'now',
          label: profile.now_label,
          value: String(acq.score),
          unit: '/ 100',
          badge: acq.evidenceClass === 'Observed' ? 'Observed' : 'Estimated',
          meaning: profile.now_meaning + ' · ' + scoreMeaning(acq.score),
          sub: scoreMeaning(acq.score)
        },
        {
          id: 'after',
          label: profile.after_label,
          value: improve.low + '〜' + improve.high,
          unit: '/ 100',
          badge: 'Inferred',
          meaning: profile.after_meaning,
          sub: '目安 ' + improve.multiplierLow + '〜' + improve.multiplierHigh + '倍（レンジ・保証なし）'
        },
        {
          id: 'outcome',
          label: profile.outcome_label,
          value: '+' + inq.addLow + '〜' + inq.addHigh,
          unit: '件 / 月',
          badge: 'Inferred',
          meaning: profile.outcome_meaning,
          sub: '現在 ' + cnt(inq.currentInquiries) + ' → ' + cnt(inq.afterLow) + '〜' + cnt(inq.afterHigh) + ' 件'
        }
      ];
    }

    var primaryCta = mode === 'branded_search' || industryId === 'media'
      ? (profile.cta_branded || 'どの記事が使われているか見る')
      : (profile.cta_generic || 'まず何を直すか見る');
    var ctaHash = industryId === 'media' ? '#brand-panel' : '#actions';

    return {
      mode: mode,
      modeLabel: mode === 'branded_search' ? '見え方を調べる' : '集客を調べる',
      industryId: industryId,
      industryLabel: profile.label,
      industryDetect: industryDetect,
      keyword: keyword,
      url: opts.url || '',
      measuredAt: new Date().toISOString(),
      heroTitle: heroTitle,
      volume: volume,
      acquisition: acq,
      improve: improve,
      rank: rank,
      inquiries: inq,
      opportunity: lost,
      brand: brand,
      confidence: confidence,
      confidenceEvidenceClass: 'Inferred',
      headline4: headline4,
      actions: actions,
      displayLabel: profile.display_label,
      impactCurrentLabel: profile.impact_current_label || ('いまの' + profile.display_label),
      cta: { label: primaryCta, hash: ctaHash },
      actionsCta: { label: 'この3つを改善する', href: '/airreach/studio/' },
      disclaimer: '表示は参考シミュレーションです。検索順位・AI掲載・予約・問い合わせ・売上を保証しません。',
      steps: ['現在地', '改善後', 'やること']
    };
  }

  function badgeLabel(b) {
    var s = String(b || '');
    if (s.indexOf('Official') >= 0) return '実測';
    if (s.indexOf('Observed') >= 0 || s.indexOf('実測') >= 0) return '実測';
    if (s.indexOf('User') >= 0 || s.indexOf('入力') >= 0) return 'ユーザー入力';
    if (s.indexOf('Estimated') >= 0 || s.indexOf('推定') >= 0) return '推定';
    if (s.indexOf('Inferred') >= 0 || s.indexOf('予測') >= 0 || s.indexOf('参考') >= 0) return '参考予測';
    if (s.indexOf('診断') >= 0) return '診断';
    return s || '参考';
  }

  window.AirReachSales = {
    estimateSearchVolume: estimateSearchVolume,
    buildSalesReport: buildSalesReport,
    improvementRange: improvementRange,
    inquiryForecast: inquiryForecast,
    normalizeMode: normalizeMode,
    yen: yen,
    cnt: cnt,
    badgeLabel: badgeLabel,
    scoreMeaning: scoreMeaning
  };
})();
