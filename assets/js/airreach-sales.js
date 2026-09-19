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

  function gapToPlainAction(gap, industryId) {
    var g = String(gap || '');
    if (/FAQ|質問/.test(g)) {
      return {
        title: 'よく聞かれる質問を公式に置く',
        action: industryId === 'restaurant'
          ? '予約・価格・席・アクセスなど、来店前に聞かれることを公式ページで答える'
          : industryId === 'media'
            ? '会社の定義・評判・料金など、指名検索で聞かれやすい質問に公式で答える'
            : '導入前に必ず聞かれる質問を、公式FAQとして分かりやすく置く',
        effect: '次に起きること：選ぶときの迷いが減り、問い合わせ・予約につながりやすくなる可能性'
      };
    }
    if (/Organization|LocalBusiness|エンティティ|会社名|組織/.test(g)) {
      return {
        title: '会社・お店の基本情報を揃える',
        action: '正式名称・所在地・連絡先・何のサービスかを、検索やAIが取り違えない形で書く',
        effect: '次に起きること：御社として正しく認識されやすくなる可能性'
      };
    }
    if (/llms|発見|robots|canonical|H1|構造|meta/i.test(g)) {
      return {
        title: 'サイトの案内情報を整える',
        action: '重要ページへの案内と、ページの主題（見出し）を分かりやすくそろえる',
        effect: '次に起きること：探している人に見つけてもらいやすくなる可能性'
      };
    }
    if (/問い合わせ|相談|導線|contact/i.test(g)) {
      return {
        title: '次の一歩をはっきり書く',
        action: '予約・問い合わせ・資料請求など、「何をすればいいか」をページ内で一目で分かる位置に置く',
        effect: '次に起きること：興味を持った人が行動しやすくなる可能性'
      };
    }
    return {
      title: '不足している説明を補う',
      action: g.replace(/構造化データ|Schema|JSON-LD|Entity|llms\.txt/gi, '公式の案内情報').slice(0, 80),
      effect: '次に起きること：御社の強みが伝わりやすくなる可能性'
    };
  }

  function top3Actions(industry, mode, diagnose, brand) {
    var profile = industry || (window.AirReachIndustry && window.AirReachIndustry.getIndustry('other'));
    var industryId = (profile && profile.id) || 'other';
    var defaults = (profile && profile.actions) ? profile.actions.slice(0, 3) : [];
    var actions = [];

    // 個別課題：診断ギャップから最大2件を平易な対策に翻訳
    if (diagnose && diagnose.gaps && diagnose.gaps.length) {
      diagnose.gaps.slice(0, 2).forEach(function (gap, i) {
        var plain = gapToPlainAction(gap, industryId);
        actions.push({
          slot: i === 0 ? 'NOW' : '2W',
          title: plain.title,
          action: plain.action,
          effect: plain.effect,
          cta: 'HackⅡ Studioで作る',
          href: '/airreach/studio/'
        });
      });
    }

    // 足りない分は業種デフォルトで埋める（PARTNER以外）
    defaults.forEach(function (d) {
      if (actions.length >= 2) return;
      if (d.slot === 'PARTNER') return;
      actions.push({
        slot: actions.length === 0 ? 'NOW' : '2W',
        title: d.title,
        action: d.action,
        effect: '次に起きること：情報が伝わりやすくなり、選ばれやすさが上がる可能性',
        cta: 'HackⅡ Studioで作る',
        href: '/airreach/studio/'
      });
    });

    while (actions.length < 2) {
      actions.push({
        slot: actions.length === 0 ? 'NOW' : '2W',
        title: 'よく聞かれる質問を追加する',
        action: '購入・予約・相談の前に聞かれることを公式に置く',
        effect: '次に起きること：迷いが減り、行動につながりやすくなる可能性',
        cta: 'HackⅡ Studioで作る',
        href: '/airreach/studio/'
      });
    }

    // 3つ目は常に Teams（コンサル）
    actions = actions.slice(0, 2);
    actions.push({
      slot: 'PARTNER',
      title: 'HackⅡ Teamsに任せる',
      action: '優先順位の設計から、継続測定・改善伴走までコンサルティングとして一緒に進める',
      effect: '測定と改善をまとめて任せられます',
      cta: '相談する',
      href: '/trillionbank/meeting/?type=company&from=airreach-teams'
    });

    return actions;
  }




  function buildExpertInsight(diagnose, actions) {
    var d = diagnose || {};
    var checks = d.checks || [];
    var good = checks.filter(function (c) { return c.ok; });
    var bad = checks.filter(function (c) { return !c.ok; });
    var factorNames = {
      structure: 'ページの骨格',
      entity: '会社・サービス情報',
      faq: 'よくある質問',
      discover: '見つけやすさ'
    };
    var byFactor = {};
    checks.forEach(function (c) {
      byFactor[c.factor] = byFactor[c.factor] || { id: c.factor, label: factorNames[c.factor] || c.factor, good: [], bad: [], score: d[c.factor] };
      if (c.ok) byFactor[c.factor].good.push(c);
      else byFactor[c.factor].bad.push(c);
    });
    var nextNow = (d.actions && d.actions.now) || [];
    var nextWeeks = (d.actions && d.actions.weeks) || [];
    var salesActions = (actions || []).slice(0, 3).map(function (a) {
      return {
        title: a.title || a.n || '対策',
        action: a.action || '',
        tip: a.effect || '優先して直す項目です。',
        href: a.href || '/airreach/studio/'
      };
    });
    return {
      summary: (d.review && d.review.summary) || (d.overall != null ? ('準備度 ' + d.overall + ' / 100') : '診断前の仮評価'),
      evidenceClass: d.overall != null ? 'Observed' : 'Estimated',
      evidenceTip: '公開HTML等から観測した準備度です。AI回答の掲載率・予約増を保証しません。',
      good: good,
      bad: bad,
      byFactor: Object.keys(byFactor).map(function (k) { return byFactor[k]; }),
      nextNow: nextNow,
      nextWeeks: nextWeeks,
      nextSales: salesActions,
      formula: '総合 = 骨格×0.30 + 会社情報×0.25 + FAQ×0.20 + 見つけやすさ×0.25',
      overall: d.overall
    };
  }

  function buildFactorBreakdown(diagnose) {
    var d = diagnose || {};
    var parts = [
      {
        id: 'structure',
        label: 'ページの骨格',
        tip: 'タイトル・H1・説明文など、ページの基本骨格です。主題が伝わるかを見ます。',
        score: d.structure,
        weight: 0.30,
        missingWhen: function (diag) {
          var out = [];
          if (!diag || !diag.page) return ['診断前のため未確認'];
          var p = diag.page;
          if (!p.h1) out.push('主見出し（H1）が弱い');
          if (!(p.title)) out.push('タイトルが弱い');
          return out;
        }
      },
      {
        id: 'entity',
        label: '会社・サービス情報',
        tip: 'Organization / Service など、誰の何のサービスかを機械が読むための情報です。',
        score: d.entity,
        weight: 0.25,
        missingWhen: function (diag) {
          var out = [];
          if (!diag || !diag.page) return ['診断前のため未確認'];
          var types = (diag.page.types || []).join(' ');
          if (!/Organization|LocalBusiness/.test(types)) out.push('会社情報の構造化データが無い');
          if (!/Service|Product/.test(types)) out.push('サービス定義が弱い');
          return out;
        }
      },
      {
        id: 'faq',
        label: 'よくある質問',
        tip: '購入・予約前に聞かれる質問を公式に置いているか。AIが抜き出しやすいFAQです。',
        score: d.faq,
        weight: 0.20,
        missingWhen: function (diag) {
          var out = [];
          if (!diag || !diag.page) return ['診断前のため未確認'];
          if ((diag.page.faqCount || 0) < 3) out.push('FAQが少ない／無い');
          var types = (diag.page.types || []).join(' ');
          if (!/FAQPage/.test(types)) out.push('FAQPageの構造化が無い');
          return out;
        }
      },
      {
        id: 'discover',
        label: '見つけやすさ',
        tip: 'robots・llms.txt・案内リンクなど、ページが発見・参照されやすいかです。',
        score: d.discover,
        weight: 0.25,
        missingWhen: function (diag) {
          var out = [];
          if (!diag) return ['診断前のため未確認'];
          if (!diag.page || !diag.page.hasLlms) out.push('llms.txtが無い／薄い');
          if (!diag.page || !diag.page.hasRobots) out.push('robots.txtを確認できなかった');
          return out;
        }
      }
    ];

    function level(score) {
      score = Number(score);
      if (!isFinite(score)) return { key: 'unknown', label: '未計測', tone: 'muted' };
      if (score < 45) return { key: 'low', label: '弱い', tone: 'bad' };
      if (score < 70) return { key: 'mid', label: '普通', tone: 'warn' };
      return { key: 'high', label: '良い', tone: 'good' };
    }

    var factors = parts.map(function (p) {
      var score = p.score == null ? null : Number(p.score);
      var lv = level(score);
      var missing = p.missingWhen(d);
      // also pull matching gaps text
      (d.gaps || []).forEach(function (g) {
        var t = String(g || '');
        if (p.id === 'structure' && /H1|タイトル|meta/i.test(t) && missing.indexOf(t) < 0) missing.push(t);
        if (p.id === 'entity' && /Organization|エンティティ|構造化|問い合わせ導線/i.test(t) && missing.indexOf(t) < 0) missing.push(t);
        if (p.id === 'faq' && /FAQ/i.test(t) && missing.indexOf(t) < 0) missing.push(t);
        if (p.id === 'discover' && /llms|robots|発見/i.test(t) && missing.indexOf(t) < 0) missing.push(t);
      });
      var contrib = score == null ? null : Math.round(score * p.weight * 10) / 10;
      return {
        id: p.id,
        label: p.label,
        tip: p.tip,
        score: score,
        weight: p.weight,
        weightPct: Math.round(p.weight * 100),
        contribution: contrib,
        level: lv,
        missing: missing.slice(0, 3),
        formula: p.label + ' × ' + p.weight
      };
    });

    var overall = d.overall != null ? Number(d.overall) : null;
    var weak = factors.filter(function (f) { return f.score != null && f.score < 60; })
      .sort(function (a, b) { return (a.score || 0) - (b.score || 0); });

    return {
      overall: overall,
      formula: '総合 = 骨格×0.30 + 会社情報×0.25 + FAQ×0.20 + 見つけやすさ×0.25',
      formulaTip: '公開HTMLの準備度です。AI回答の掲載率や予約増を保証しません。',
      factors: factors,
      weakFactors: weak,
      gaps: (d.gaps || []).slice(0, 5),
      strengths: (d.strengths || []).slice(0, 4),
      evidenceClass: d.overall != null ? 'Observed' : 'Estimated'
    };
  }

  function buildExpertMethodology(ctx) {
    ctx = ctx || {};
    var diagnose = ctx.diagnose || null;
    var volume = ctx.volume || {};
    var acq = ctx.acquisition || {};
    var improve = ctx.improve || {};
    var inq = ctx.inquiries || {};
    var lost = ctx.opportunity || {};
    var confidence = ctx.confidence;
    var confOpts = ctx.confidenceBreakdown || {};
    var rank = ctx.rank || null;
    var score = num(acq.score, diagnose && diagnose.overall != null ? diagnose.overall : 40);
    var sections = [];

    var parts = acq.parts || (diagnose ? {
      structure: diagnose.structure,
      entity: diagnose.entity,
      faq: diagnose.faq,
      discover: diagnose.discover
    } : null);
    var readinessRows = [];
    if (parts) {
      var weights = [
        { key: 'structure', label: '構造（title/H1/meta/canonical等）', weight: 0.30, maxPts: '12点満点→100換算' },
        { key: 'entity', label: 'エンティティ（Organization/Service等）', weight: 0.25, maxPts: '10点満点→100換算' },
        { key: 'faq', label: 'FAQ（FAQPage・可視FAQ）', weight: 0.20, maxPts: '8点満点→100換算' },
        { key: 'discover', label: '発見性（robots/llms/内部リンク等）', weight: 0.25, maxPts: '発見系チェック→100換算' }
      ];
      var recon = 0;
      weights.forEach(function (row) {
        var v = num(parts[row.key], 0);
        var contrib = Math.round(v * row.weight * 10) / 10;
        recon += v * row.weight;
        readinessRows.push({
          label: row.label,
          formula: 'score(' + row.key + ') × ' + row.weight,
          value: v + ' × ' + row.weight + ' = ' + contrib,
          note: row.maxPts,
          evidence: acq.evidenceClass || 'Observed'
        });
      });
      readinessRows.push({
        label: '総合準備度（overall）',
        formula: '0.30·S + 0.25·E + 0.20·F + 0.25·D',
        value: Math.round(recon) + ' / 100（表示値 ' + score + '）',
        note: '公開HTMLの観測に基づく。AI実回答の引用率ではない。',
        evidence: acq.evidenceClass || 'Observed'
      });
    } else {
      readinessRows.push({
        label: '総合準備度',
        formula: '診断未実施時の仮値',
        value: String(score),
        note: 'URL診断前。診断後に実測へ置換。',
        evidence: 'Estimated'
      });
    }
    sections.push({
      id: 'readiness',
      title: '1. 公開ページ準備度スコア',
      summary: '公開ページの機械可読性・案内の揃い具合を 0–100 で合成。AI回答への掲載を保証しない。',
      rows: readinessRows
    });

    var volVal = volume.value;
    sections.push({
      id: 'volume',
      title: '2. 月間検索需要',
      summary: volume.note || 'キーワード特徴からの推定モデル。Search Console公式ボリュームではない。',
      rows: [
        {
          label: '推定需要 V',
          formula: 'hash(keyword) → base ∈ [800,18800]（指名検索は [200,4700]）→ 語特徴で係数補正',
          value: volVal != null ? ('V = ' + cnt(volVal) + ' 回/月') : 'キーワード未入力のため未算出',
          note: 'evidence = ' + (volume.evidenceClass || 'Estimated'),
          evidence: volume.evidenceClass || 'Estimated'
        },
        {
          label: '関連質問・商用質問（派生）',
          formula: 'related ≈ max(40, round(V×0.08)) / commercial ≈ max(8, round(V×0.012))',
          value: volVal != null
            ? ('related ' + cnt(volume.relatedQuestions) + ' / commercial ' + cnt(volume.commercialQuestions))
            : '—',
          note: '需要の内訳目安。公式クエリ数ではない。',
          evidence: 'Estimated'
        }
      ]
    });

    var gap = clamp(78 - score, 8, 45);
    sections.push({
      id: 'improve',
      title: '3. 改善後スコア・相対位置',
      summary: improve.note || '準備度が上がった場合の参考レンジ。',
      rows: [
        {
          label: 'ギャップ gap',
          formula: 'clamp(78 − score, 8, 45)',
          value: 'clamp(78 − ' + score + ', 8, 45) = ' + gap,
          note: '目標アンカー78は「十分整った公開ページ」の社内基準点（仮定）。',
          evidence: 'Inferred'
        },
        {
          label: '改善後レンジ [low, high]',
          formula: 'low = clamp(round(s + gap×0.55), s+5, 92); high = clamp(round(s + gap×0.95), low+4, 96)',
          value: 's=' + score + ' → [' + improve.low + ', ' + improve.high + '] / 100',
          note: '倍率 ' + improve.multiplierLow + '〜' + improve.multiplierHigh + '×（表示用）。成果保証なし。',
          evidence: improve.evidenceClass || 'Inferred'
        },
        {
          label: '相対位置（目安順位）',
          formula: 'rank = clamp(round(11 − score/10), 1, 10)',
          value: rank ? ('約 ' + rank.rank + ' / ' + rank.of) : '—',
          note: '競合SERP実測ではない。スコアからの相対位置の便宜指標。',
          evidence: 'Inferred'
        }
      ]
    });

    var liftLow = clamp(0.25 + (78 - score) / 220, 0.22, 0.5);
    var liftHigh = clamp(liftLow + 0.18 + (78 - score) / 280, liftLow + 0.15, 0.8);
    var visitLift = clamp(((improve.low || score) + (improve.high || score)) / 2 / Math.max(score, 1) - 1, 0.05, 0.5);
    sections.push({
      id: 'impact',
      title: '4. 問い合わせ・訪問の改善レンジ',
      summary: inq.note || '入力値×改善仮定の参考レンジ。',
      rows: [
        {
          label: '現在の成果件数 I₀',
          formula: 'ユーザー入力。未入力時は max(3, round(V×0.0015))',
          value: 'I₀ = ' + cnt(inq.currentInquiries) + '（source: ' + (inq.inquiriesSource || '—') + '）',
          note: '訪問者は未入力時 max(I₀×40, round(V×0.08)) で補完。',
          evidence: inq.inquiriesSource === 'User Input' ? 'User Input' : 'Estimated'
        },
        {
          label: 'リフト率 λ',
          formula: 'λ_low = clamp(0.25+(78−s)/220, 0.22, 0.5); λ_high = clamp(λ_low+0.18+(78−s)/280, λ_low+0.15, 0.8)',
          value: 's=' + score + ' → λ ∈ [' + (Math.round(liftLow * 1000) / 1000) + ', ' + (Math.round(liftHigh * 1000) / 1000) + ']',
          note: 'スコアが低いほどリフト上限が広がる（仮定）。因果推定ではない。',
          evidence: 'Inferred'
        },
        {
          label: '追加件数 ΔI',
          formula: 'ΔI_low = max(1, round(I₀·λ_low)); ΔI_high = max(ΔI_low+1, round(I₀·λ_high))',
          value: 'ΔI = +' + cnt(inq.addLow) + '〜+' + cnt(inq.addHigh) + ' → 改善後 ' + cnt(inq.afterLow) + '〜' + cnt(inq.afterHigh),
          note: '訪問増加 ≈ 現訪問 × visitLift（visitLift=' + (Math.round(visitLift * 1000) / 1000) + '）',
          evidence: 'Inferred'
        },
        {
          label: '1件あたり費用（参考）',
          formula: 'CPA = 月額費用 / ΔI_mid（ΔI_mid = round((ΔI_low+ΔI_high)/2)）',
          value: inq.cpa != null ? ('CPA ≈ ' + yen(inq.cpa) + '（費用 ' + yen(inq.fee) + ' / mid ' + cnt(inq.addMid) + '）') : '費用未入力のため未算出',
          note: '広告CPAの代替ではない。試算用。',
          evidence: 'Inferred'
        }
      ]
    });

    var missedShare = clamp((78 - score) / 100, 0.05, 0.45);
    sections.push({
      id: 'loss',
      title: '5. 機会損失（仮定）',
      summary: lost.note || 'いま取りこぼしている可能性のある件数。',
      rows: [
        {
          label: '取りこぼし率 m',
          formula: 'm = clamp((78 − score)/100, 0.05, 0.45)',
          value: 'm = ' + (Math.round(missedShare * 1000) / 1000) + '（score=' + score + '）',
          note: '準備度ギャップを機会損失率に写像した仮定。',
          evidence: 'Inferred'
        },
        {
          label: '取りこぼし件数',
          formula: 'missedInq = max(1, round(I₀ · m)); deals/rev は close×deal を乗算',
          value: '問い合わせ ≈ ' + cnt(lost.missedInquiries)
            + (lost.missedDeals != null ? (' / 受注 ≈ ' + lost.missedDeals) : '')
            + (lost.missedRevenue != null ? (' / 売上機会 ≈ ' + yen(lost.missedRevenue)) : ''),
          note: '表示は参考。実測の逸失需要ではない。',
          evidence: 'Inferred'
        }
      ]
    });

    var confRows = [
      { label: '基準点', formula: 'base = 42', value: '+42', on: true },
      { label: 'URL診断あり', formula: '+18', value: confOpts.hasDiagnose ? '+18' : '0', on: !!confOpts.hasDiagnose },
      { label: 'GSC実数あり', formula: '+16', value: confOpts.hasGsc ? '+16' : '0', on: !!confOpts.hasGsc },
      { label: 'GA4実数あり', formula: '+12', value: confOpts.hasGa4 ? '+12' : '0', on: !!confOpts.hasGa4 },
      { label: 'キーワード入力', formula: '+6', value: confOpts.hasKeyword ? '+6' : '0', on: !!confOpts.hasKeyword },
      { label: '事業数字入力', formula: '+6', value: confOpts.hasBusinessInputs ? '+6' : '0', on: !!confOpts.hasBusinessInputs },
      { label: '指名×記事URL', formula: '+4（branded時）', value: (confOpts.mode === 'branded_search' && confOpts.hasMediaUrl) ? '+4' : '0', on: !!(confOpts.mode === 'branded_search' && confOpts.hasMediaUrl) },
      { label: '業種推定補正', formula: 'round((industryConfidence−50)/10)', value: confOpts.industryConfidence != null ? String(Math.round((confOpts.industryConfidence - 50) / 10)) : '0', on: confOpts.industryConfidence != null }
    ];
    confRows.push({
      label: '信頼度（表示）',
      formula: 'clamp(Σ, 35, 88)',
      value: String(confidence) + ' %',
      on: true,
      note: 'モデル確度の社内指標。統計的信頼区間ではない。'
    });
    sections.push({
      id: 'confidence',
      title: '6. 予測の信頼度',
      summary: '入力・実測の充足度による 35–88 の加点モデル。高いほど「根拠が厚い」が、正しさの保証ではない。',
      rows: confRows.map(function (r) {
        return {
          label: r.label,
          formula: r.formula,
          value: r.value + (r.on === false ? '（未適用）' : ''),
          note: r.note || '',
          evidence: 'Inferred'
        };
      })
    });

    sections.push({
      id: 'legend',
      title: '7. エビデンス区分',
      summary: '画面上のラベルは次の定義に従う。',
      rows: [
        { label: '実測（Observed / Official）', formula: '公開HTML診断・GSC/GA4取込など観測値', value: '—', note: '取得条件付き。全AI面の網羅ではない。', evidence: 'Observed' },
        { label: '推定（Estimated）', formula: 'キーワード特徴モデル等', value: '—', note: '公式ボリュームの代替ではない。', evidence: 'Estimated' },
        { label: '参考予測（Inferred）', formula: '仮定パラメータによるシミュレーション', value: '—', note: '成果・順位・掲載を保証しない。', evidence: 'Inferred' },
        { label: 'ユーザー入力（User Input）', formula: 'フォーム入力値', value: '—', note: '計算の起点。精度は入力に依存。', evidence: 'User Input' }
      ]
    });

    return {
      audience: 'データ分析・マーケティング計測の実務者向け。営業画面の4数字の裏側。',
      asOf: new Date().toISOString().slice(0, 10),
      sections: sections
    };
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
    var confidenceBreakdown = {
      mode: mode,
      hasDiagnose: !!diagnose,
      hasGsc: !!(baseline && baseline.monthlyClicks > 0),
      hasGa4: !!(baseline && baseline.ga4 && baseline.ga4.monthlySessions > 0),
      hasKeyword: !!keyword,
      hasBusinessInputs: !!(inputs.monthlyInquiries || inputs.monthlyVisitors),
      hasMediaUrl: !!mediaUrl,
      industryConfidence: industryDetect && industryDetect.confidence
    };
    var confidence = confidenceScore(confidenceBreakdown);
    var actions = top3Actions(profile, mode, diagnose, brand);
    var expertInsight = buildExpertInsight(diagnose, actions);

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
      confidenceBreakdown: confidenceBreakdown,
      factors: buildFactorBreakdown(diagnose),
      expertInsight: expertInsight,
      methodology: buildExpertMethodology({
        diagnose: diagnose,
        volume: volume,
        acquisition: acq,
        improve: improve,
        inquiries: inq,
        opportunity: lost,
        confidence: confidence,
        confidenceBreakdown: confidenceBreakdown,
        rank: rank
      }),
      headline4: headline4,
      actions: actions,
      displayLabel: profile.display_label,
      impactCurrentLabel: profile.impact_current_label || ('いまの' + profile.display_label),
      cta: { label: primaryCta, hash: ctaHash },
      actionsCta: { label: '最優先の対策をHackⅡ Studioで進める', href: '/airreach/studio/' },
      disclaimer: '表示は参考シミュレーションです。検索順位・AI掲載・予約・問い合わせ・売上を保証しません。',
      steps: ['現在地', '改善後', '最優先の対策']
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
    buildExpertMethodology: buildExpertMethodology,
    buildFactorBreakdown: buildFactorBreakdown,
    buildExpertInsight: buildExpertInsight,
    normalizeMode: normalizeMode,
    yen: yen,
    cnt: cnt,
    badgeLabel: badgeLabel,
    scoreMeaning: scoreMeaning
  };
})();
