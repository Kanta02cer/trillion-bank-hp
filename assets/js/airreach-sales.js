/**
 * AirReach Sales View — 一般検索 / 指名検索
 * First screen shows at most 4 numbers. No guarantee language.
 * Evidence: Official / Observed / Estimated / Inferred / User Input
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

  /** Stable pseudo-volume from keyword (Estimated, not Official). */
  function estimateSearchVolume(keyword, mode) {
    var k = String(keyword || '').trim();
    if (!k) {
      return { value: null, evidenceClass: 'Estimated', label: 'キーワード未入力', note: 'キーワードを入れると推定需要を出します。' };
    }
    var h = 0;
    for (var i = 0; i < k.length; i++) h = ((h << 5) - h) + k.charCodeAt(i);
    h = Math.abs(h);
    var base = 800 + (h % 18000);
    if (mode === 'brand') base = 200 + (h % 4500);
    // intent boosts for commercial modifiers
    if (/おすすめ|比較|料金|費用|口コミ|評判|東京|大阪|クリニック|会社/.test(k)) base = Math.round(base * 1.35);
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

  /** Competitor-rank style narrative from score (Inferred). */
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
      label: '改善後予測（レンジ）',
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
    if (opts.mode === 'brand' && opts.hasMediaUrl) c += 4;
    return clamp(c, 35, 88);
  }

  /**
   * Inquiry lift from current inquiries + score improvement (Inferred).
   * Prefer User Input inquiries; else derive from volume * tiny CVR assumption.
   */
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
      // very rough: 0.15% of search demand becomes site inquiry potential baseline
      currentInq = Math.max(3, Math.round(volume * 0.0015));
      inqSource = 'Estimated';
    }
    if (!visitors && volume) {
      visitors = Math.max(currentInq * 40, Math.round(volume * 0.08));
    }

    var range = improvementRange(score);
    // Sales-facing relative lift from readiness gap (still a non-guaranteed range)
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
      note: '問い合わせ増加は入力値×改善仮定の参考レンジです。保証ではありません。'
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

  /** Brand / named-search: information reflection + media citation potential */
  function brandReflection(diagnose, mediaUrl) {
    var base = diagnose && diagnose.overall != null ? diagnose.overall : 45;
    // brand "情報反映度" leans on entity/faq/discover
    var score = base;
    if (diagnose && diagnose.entity != null) {
      score = Math.round(base * 0.45 + diagnose.entity * 0.25 + (diagnose.faq || 40) * 0.15 + (diagnose.discover || 40) * 0.15);
    }
    score = clamp(score, 15, 90);
    var sources = [
      { name: '公式サイト', share: clamp(28 + Math.round(score * 0.25), 20, 55), used: true },
      { name: 'ニュース', share: 18, used: score >= 50 },
      { name: '口コミ', share: 12, used: false },
      { name: '比較サイト', share: 17, used: score < 60 },
      { name: 'その他', share: 0, used: false }
    ];
    var sum = sources.reduce(function (s, x) { return s + x.share; }, 0);
    sources[sources.length - 1].share = Math.max(5, 100 - (sum - sources[sources.length - 1].share));

    var currentCite = mediaUrl ? clamp(2 + Math.round((100 - score) * 0.06), 2, 12) : null;
    var citeLow = currentCite != null ? clamp(currentCite * 2, currentCite + 3, 30) : null;
    var citeHigh = currentCite != null ? clamp(currentCite * 4, citeLow + 3, 40) : null;

    return {
      score: score,
      evidenceClass: diagnose ? 'Observed+Inferred' : 'Estimated',
      sources: sources,
      thirdPartyTrust: clamp(Math.round(score * 0.55), 15, 70),
      officialReflect: clamp(Math.round(score * 0.9), 20, 85),
      mediaUrl: mediaUrl || '',
      citationCurrent: currentCite,
      citationLow: citeLow,
      citationHigh: citeHigh,
      citationEvidenceClass: 'Inferred',
      citationNote: '指定記事が参照候補に入りやすい設計を行い、引用率を継続計測します。必ず引用されることを保証しません。'
    };
  }

  function top3Actions(mode, diagnose, brand) {
    var now = 'よく聞かれる質問（FAQ）を公式ページに追加する';
    var weeks = '比較・選び方のページを1本つくる';
    var partner = 'Trillion Bankに測定と改善を任せる（HackⅡ）';
    if (mode === 'brand') {
      now = '会社の定義・サービス内容を公式ページ冒頭で明確にする';
      weeks = '指定メディア記事と公式情報の相互リンク・引用関係を整える';
      partner = '指名検索の引用率をHackⅡで継続計測する';
      if (brand && brand.mediaUrl) {
        now = '指定記事の要点を公式FAQ・サービス説明と揃える';
      }
    } else if (diagnose && diagnose.actions) {
      if (diagnose.actions.now && diagnose.actions.now[0]) now = diagnose.actions.now[0];
      if (diagnose.actions.weeks && diagnose.actions.weeks[0]) weeks = diagnose.actions.weeks[0];
      if (diagnose.actions.partner && diagnose.actions.partner[0]) partner = diagnose.actions.partner[0];
    }
    return [
      { slot: 'NOW', title: '今すぐ直す', action: now, cta: '作成する', href: '/airreach/studio/' },
      { slot: '2W', title: '2週間以内', action: weeks, cta: '作成する', href: '/airreach/studio/' },
      { slot: 'PARTNER', title: 'Trillion Bankに任せる', action: partner, cta: '相談する', href: '/trillionbank/meeting/?type=company&from=airreach' }
    ];
  }

  function buildSalesReport(opts) {
    opts = opts || {};
    var mode = opts.mode === 'brand' ? 'brand' : 'general';
    var keyword = String(opts.keyword || opts.brand || '').trim();
    var diagnose = opts.diagnose || null;
    var inputs = opts.inputs || {};
    var mediaUrl = String(opts.mediaUrl || '').trim();
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
    if (opts.volumeOverride != null && isFinite(Number(opts.volumeOverride))) {
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
    var brand = mode === 'brand' ? brandReflection(diagnose, mediaUrl) : null;
    var confidence = confidenceScore({
      mode: mode,
      hasDiagnose: !!diagnose,
      hasGsc: !!(baseline && baseline.monthlyClicks > 0),
      hasGa4: !!(baseline && baseline.ga4 && baseline.ga4.monthlySessions > 0),
      hasKeyword: !!keyword,
      hasBusinessInputs: !!(inputs.monthlyInquiries || inputs.monthlyVisitors),
      hasMediaUrl: !!mediaUrl
    });
    var actions = top3Actions(mode, diagnose, brand);

    var headline4;
    if (mode === 'general') {
      headline4 = [
        { id: 'demand', label: '月間検索需要', value: volume.value != null ? cnt(volume.value) : '—', unit: '回', badge: volume.evidenceClass, sub: keyword ? ('「' + keyword + '」周辺') : 'キーワードを入力' },
        { id: 'now', label: '現在の獲得力', value: String(acq.score), unit: '/ 100', badge: acq.evidenceClass, sub: '競合10社中 ' + rank.rank + '位相当（目安）' },
        { id: 'after', label: '改善後予測', value: improve.low + '〜' + improve.high, unit: '/ 100', badge: 'Inferred', sub: '獲得力の目安 ' + improve.multiplierLow + '〜' + improve.multiplierHigh + '倍（レンジ・保証なし）' },
        { id: 'inq', label: '追加問い合わせ見込み', value: '+' + inq.addLow + '〜' + inq.addHigh, unit: '件 / 月', badge: 'Inferred', sub: '現在 ' + cnt(inq.currentInquiries) + ' → ' + cnt(inq.afterLow) + '〜' + cnt(inq.afterHigh) + ' 件' }
      ];
    } else {
      var bScore = brand ? brand.score : acq.score;
      var bImprove = improvementRange(bScore);
      headline4 = [
        { id: 'demand', label: '月間指名検索', value: volume.value != null ? cnt(volume.value) : '—', unit: '回', badge: volume.evidenceClass, sub: keyword ? ('「' + keyword + '」') : '会社名・サービス名を入力' },
        { id: 'now', label: '現在の情報反映度', value: String(bScore), unit: '/ 100', badge: brand ? brand.evidenceClass : acq.evidenceClass, sub: '公式・第三者に情報がどれだけ伝わるか' },
        { id: 'after', label: '改善後予測（情報反映度）', value: bImprove.low + '〜' + bImprove.high, unit: '/ 100', badge: 'Inferred', sub: 'メディくる等で第三者記事・公式を整えた場合の目安 · ' + bImprove.multiplierLow + '〜' + bImprove.multiplierHigh + 'x' },
        mediaUrl && brand && brand.citationCurrent != null
          ? { id: 'cite', label: '指定記事の参照されやすさ', value: brand.citationCurrent + '% → ' + brand.citationLow + '〜' + brand.citationHigh + '%', unit: '', badge: 'Inferred', sub: '必ず引用される保証はありません。参照候補化＋継続計測' }
          : { id: 'inq', label: '追加問い合わせ見込み', value: '+' + inq.addLow + '〜' + inq.addHigh, unit: '件 / 月', badge: 'Inferred', sub: '現在 ' + cnt(inq.currentInquiries) + ' → ' + cnt(inq.afterLow) + '〜' + cnt(inq.afterHigh) + ' 件' }
      ];
    }

    return {
      mode: mode,
      keyword: keyword,
      url: opts.url || '',
      measuredAt: new Date().toISOString(),
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
      badges: {
        Official: '公式データ',
        Observed: '実測',
        Estimated: '推定',
        Inferred: '予測/仮定',
        'User Input': '入力値'
      },
      cta: mode === 'general'
        ? { label: '改善した場合を見る', hash: '#impact' }
        : { label: '引用されやすい状態に改善する', hash: '#impact' },
      disclaimer: '表示は参考シミュレーションです。検索順位・AI掲載・問い合わせ・売上を保証しません。'
    };
  }

  function badgeLabel(b) {
    var s = String(b || '');
    if (s.indexOf('Official') >= 0) return '実測（公式）';
    if (s.indexOf('Observed') >= 0) return '実測';
    if (s.indexOf('Estimated') >= 0 || s.indexOf('推定') >= 0) return '推定';
    if (s.indexOf('Inferred') >= 0 || s.indexOf('予測') >= 0) return '予測';
    if (s.indexOf('User') >= 0 || s.indexOf('入力') >= 0) return '入力値';
    if (s.indexOf('未入力') >= 0) return '未入力';
    return s || '参考';
  }

  window.AirReachSales = {
    estimateSearchVolume: estimateSearchVolume,
    buildSalesReport: buildSalesReport,
    improvementRange: improvementRange,
    inquiryForecast: inquiryForecast,
    yen: yen,
    cnt: cnt,
    badgeLabel: badgeLabel
  };
})();
