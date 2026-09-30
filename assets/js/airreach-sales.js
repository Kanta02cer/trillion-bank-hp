/**
 * AirReach Tools Sales View — industry-aware 4-number engine.
 * Modes (internal): generic_search | branded_search
 * User labels: 新しいお客さん向け | 名前で調べられたとき
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

  // Band / wording come only from the display contract (_data/airreach_display.yml via airreach-display.js).
  function display() { return window.AirReachDisplay || null; }
  function band(score) {
    var d = display();
    if (d) return d.band(score);
    return { key: 'unknown', label: '未確認', tone: 'muted', meaning: '' };
  }
  function scoreMeaning(score) {
    var d = display();
    if (d) return d.scoreMeaning(score);
    return '未確認';
  }

  // 廃止: 言葉の文字列から計算した値で、検索データではない。互換のため関数だけ残し、画面・計算・共有には使わない。
  function estimateSearchVolume(keyword, mode) {
    var k = String(keyword || '').trim();
    if (!k) {
      return { value: null, evidenceClass: 'Estimated', label: 'お客さんの言葉が未入力', note: 'お客さんが使いそうな言葉を入れると、探している人の目安が出ます。' };
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
      label: '探している人の目安（月）',
      note: '公開の需要推定モデル（キーワード特徴から算出）。公式Search Console実数ではありません。',
      relatedQuestions: Math.max(40, Math.round(base * 0.08)),
      commercialQuestions: Math.max(8, Math.round(base * 0.012))
    };
  }

  function acquisitionScoreFromDiagnose(result) {
    if (!result) {
      return { score: 40, evidenceClass: 'Estimated', note: 'URL診断前の仮値' };
    }
    if (result.overall == null) {
      // Diagnosed, but a required item could not be fetched: no overall score (never 0, never a guess).
      return {
        score: null,
        evidenceClass: 'Observed',
        note: '未取得の項目があるため総合点なし',
        state: result.state || 'partial',
        parts: {
          structure: result.structure,
          entity: result.entity,
          faq: result.faq,
          discover: result.discover
        }
      };
    }
    return {
      score: result.overall,
      evidenceClass: 'Observed',
      note: '公開ページ準備度（URL診断）',
      state: result.state || 'verified',
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
    // Never show a range above the 100-point scale (high scores used to produce 98〜102).
    low = Math.min(low, 100);
    high = Math.min(Math.max(high, low), 100);
    var multLow = Math.round((low / Math.max(s, 1)) * 10) / 10;
    var multHigh = Math.round((high / Math.max(s, 1)) * 10) / 10;
    return {
      current: s,
      low: low,
      high: high,
      multiplierLow: multLow,
      multiplierHigh: multHigh,
      evidenceClass: 'Inferred',
      label: '直したあとの目安',
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
    // 引用元の内訳・引用率は AI の回答を実際に聞かないと分からない。ここでは作らない（未計測）
    var sources = [];
    var currentCite = null, citeLow = null, citeHigh = null;

    return {
      score: score,
      evidenceClass: diagnose ? 'Observed' : 'Estimated',
      sources: sources,
      thirdPartyTrust: null,
      officialReflect: null,
      mediaUrl: mediaUrl || '',
      citationCurrent: currentCite,
      citationLow: citeLow,
      citationHigh: citeHigh,
      citationEvidenceClass: 'Unmeasured',
      citationNote: 'AIの回答での引用元と引用率は、この無料診断では測っていません。AirReach Consulting で質問ごとに計測します。必ず引用されることを保証しません。'
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
    if (/Service|Product/i.test(g)) {
      return {
        title: 'サービスの対象・対象外を明記する',
        action: 'どんな人向けの何のサービスかを冒頭で1文で書き、同じ内容を Service の構造化データにも入れる',
        effect: '次に起きること：何のサービスかが取り違えなく伝わる可能性'
      };
    }
    if (/Breadcrumb|パンくず/i.test(g)) {
      return {
        title: 'ページの階層（パンくず）を示す',
        action: '「トップ ＞ サービス ＞ 料金」のような現在地の表示を各ページに置き、BreadcrumbList の構造化データも入れる',
        effect: '次に起きること：サイトのどこに何があるかが伝わりやすくなる可能性'
      };
    }
    if (/og:title|共有/i.test(g)) {
      return {
        title: 'SNS共有用のタイトルを設定する',
        action: 'ページを共有したときに表示されるタイトル（og:title）を、ページの主題が分かる文言で設定する',
        effect: '次に起きること：共有されたときに何のページか伝わる可能性'
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

  /**
   * Evidence link for an action: the page actually fetched during diagnosis.
   * Uses a verified anchor only when the fetched HTML really had that id (never guesses "#faq").
   */
  function evidenceLinkFor(diagnose, kind) {
    var page = (diagnose && diagnose.page) || {};
    var base = page.finalUrl || page.baseHref || '';
    if (!base) return null;
    var anchor = '';
    if (kind === 'faq' && page.faqAnchor) anchor = '#' + page.faqAnchor;
    return {
      label: anchor ? '確認した箇所を開く' : '確認したページを開く',
      href: base + anchor,
      note: anchor
        ? '診断時に取得したページの、該当する見出し（id="' + page.faqAnchor + '"）へ移動します。'
        : '診断時に取得したページを開きます。該当箇所が見つからなかったため、ページ先頭へ移動します。'
    };
  }

  /**
   * Plain-language guide for an action: why it matters, what to do, and an example.
   * Copy is about ホームページの情報整備 only (no AI / ranking / outcome claims).
   */
  function actionGuide(kind, industryId) {
    var shop = industryId === 'restaurant' ? 'お店' : industryId === 'clinic' ? '医院' : '会社';
    var guides = {
      faq: {
        why: '来店・相談の前に気になる条件を、お客様がホームページ上で確認できるようにします。',
        steps: ['よく聞かれる質問を3つ選ぶ', shop + 'の実際の対応内容を、そのまま短く書く', 'ホームページの分かりやすい場所に「よくある質問」として載せる'],
        example: industryId === 'restaurant'
          ? '例：「予約は必要ですか？」「子連れでも大丈夫ですか？」「アレルギー対応はできますか？」に、営業時間や席の案内と一緒に答える。'
          : industryId === 'clinic'
            ? '例：「初診に必要なものは？」「料金の目安は？」「予約の方法は？」に、診療時間と一緒に答える。'
            : '例：「料金の目安は？」「導入までの流れは？」「対応エリアは？」に、問い合わせ方法と一緒に答える。'
      },
      entity: {
        why: '誰の・何のサービスかが、検索エンジンにも人にも取り違えなく伝わるようにします。',
        steps: ['正式名称・所在地・電話番号・営業時間を1か所にまとめる', 'サービス名と、どんな人向けかを1文で書く', '同じ内容を構造化データ（Organization / Service）にも入れる'],
        example: '例：ページ下部に「' + shop + '名・住所・電話・営業時間」をまとめた欄を置き、トップの冒頭に「〇〇向けの△△サービスです」と1文添える。'
      },
      contact: {
        why: '興味を持った人が、次に何をすればいいか迷わないようにします。',
        steps: ['予約・問い合わせ・資料請求のうち、いちばん取りたい行動を1つ決める', 'そのボタンをページの上部と下部に置く', 'ボタンの近くに、対応時間と返信の目安を書く'],
        example: '例：「予約する」ボタンをトップ上部と各ページ末尾に置き、「当日予約は電話で。メールは翌営業日までに返信」と添える。'
      },
      page: {
        why: 'ページの主題と案内が整うと、探している人が目的の情報にたどり着きやすくなります。',
        steps: ['トップページの見出し（H1）を「何の' + shop + 'か」が分かる1文にする', 'ページの説明文（meta description）を40文字以上で書く', '重要ページ（サービス・料金・アクセス・よくある質問）へのリンクをまとめる'],
        example: '例：見出しを「渋谷駅3分・個室ありの焼肉店」のように具体化し、説明文に対象・場所・特徴を入れる。'
      }
    };
    return guides[kind] || guides.page;
  }

  function actionKind(text) {
    var t = String(text || '');
    if (/FAQ|質問/.test(t)) return 'faq';
    if (/Organization|LocalBusiness|会社|お店の基本情報|組織|サービスの対象|Service/.test(t)) return 'entity';
    if (/問い合わせ|相談|導線|次の一歩/.test(t)) return 'contact';
    return 'page';
  }

  /**
   * Up to 3 対策. AirReach Consulting / Teams is intentionally NOT an action here: it is a separate
   * service and goes into the report's `referral` block, rendered in its own frame.
   */
  function top3Actions(industry, mode, diagnose, brand) {
    var profile = industry || (window.AirReachIndustry && window.AirReachIndustry.getIndustry('other'));
    var industryId = (profile && profile.id) || 'other';
    var defaults = ((profile && profile.actions) ? profile.actions : []).filter(function (d) { return d.slot !== 'PARTNER'; });
    var actions = [];

    function push(item) {
      if (actions.length >= 3) return;
      // Two gaps often map to the same plain action; show each action once.
      if (actions.some(function (a) { return a.title === item.title; })) return;
      var kind = actionKind(item.title + ' ' + item.action);
      actions.push({
        slot: actions.length === 0 ? 'NOW' : '2W',
        priority: actions.length === 0 ? 'high' : 'mid',
        title: item.title,
        action: item.action,
        effect: item.effect || '次に起きること：来店・相談の前に知りたい情報が、見つけやすくなる可能性',
        kind: kind,
        guide: actionGuide(kind, industryId),
        evidence: evidenceLinkFor(diagnose, kind)
      });
    }

    // 個別課題：診断ギャップ（取得できて「なし」だった項目）から最大2件を平易な対策に翻訳
    if (diagnose && diagnose.gaps && diagnose.gaps.length) {
      diagnose.gaps.slice(0, 4).forEach(function (gap) { if (actions.length < 2) push(gapToPlainAction(gap, industryId)); });
    }
    // 足りない分は業種デフォルトで埋める
    defaults.forEach(function (d) {
      if (actions.some(function (a) { return a.title === d.title; })) return;
      push({ title: d.title, action: d.action });
    });
    while (actions.length < 3) {
      var fallbacks = [
        { title: 'よく聞かれる質問を追加する', action: '購入・予約・相談の前に聞かれることを公式に置く', effect: '次に起きること：迷いが減り、行動につながりやすくなる可能性' },
        { title: '会社・お店の基本情報を揃える', action: '正式名称・所在地・連絡先・営業時間を、同じ内容で公式ページに載せる' },
        { title: 'サイトの案内情報を整える', action: '重要ページへの案内と、ページの主題（見出し）を分かりやすくそろえる' }
      ];
      var next = fallbacks.filter(function (f) { return !actions.some(function (a) { return a.title === f.title; }); })[0];
      if (!next) break;
      push(next);
    }

    return actions.slice(0, 3);
  }

  /** AirReach Consulting referral: separate frame, never mixed into 対策 or evidence links. */
  function buildReferral(profile, diagnose) {
    var partner = ((profile && profile.actions) || []).filter(function (d) { return d.slot === 'PARTNER'; })[0] || null;
    var base = (diagnose && diagnose.referral) || {};
    return {
      kicker: base.kicker || '別のサービスの案内',
      title: base.title || 'AI回答で紹介されるか・引用元・他店との比較を調べたい場合',
      body: base.body || 'この診断はホームページの情報整備を見るもので、AI回答の中身は測っていません。実際のAI回答での言及・引用・比較を同条件で測る場合は、別サービスのAirReach Consultingで行います。',
      partnerNote: partner ? partner.action : '',
      cta: base.cta || 'AirReach Consultingについて相談する',
      href: base.href || '/trillionbank/meeting/?type=company&from=airreach-referral',
      note: base.note || '対策の手順や根拠リンクとは別枠の案内です。診断の点数には影響しません。'
    };
  }




  function buildExpertInsight(diagnose, actions) {
    var d = diagnose || {};
    var checks = d.checks || [];
    // Three states: ok / ng / unknown. Older stored results only have `ok`; treat those as known.
    function stateOf(c) { return c.state || (c.ok ? 'ok' : 'ng'); }
    var good = checks.filter(function (c) { return stateOf(c) === 'ok'; });
    var bad = checks.filter(function (c) { return stateOf(c) === 'ng'; });
    var unknown = checks.filter(function (c) { return stateOf(c) === 'unknown'; });
    var factorNames = {
      structure: 'ページ構造',
      entity: '会社・サービス情報',
      faq: 'よくある質問',
      discover: '見つけやすさ'
    };
    var byFactor = {};
    checks.forEach(function (c) {
      byFactor[c.factor] = byFactor[c.factor] || { id: c.factor, label: factorNames[c.factor] || c.factor, good: [], bad: [], unknown: [], score: d[c.factor], band: band(d[c.factor]) };
      var s = stateOf(c);
      if (s === 'ok') byFactor[c.factor].good.push(c);
      else if (s === 'ng') byFactor[c.factor].bad.push(c);
      else byFactor[c.factor].unknown.push(c);
    });
    var nextNow = (d.actions && d.actions.now) || [];
    var nextWeeks = (d.actions && d.actions.weeks) || [];
    var salesActions = (actions || []).slice(0, 3).map(function (a) {
      return {
        title: a.title || a.n || '対策',
        action: a.action || '',
        tip: a.effect || '優先して直す項目です。',
        evidence: a.evidence || null
      };
    });
    var diagnosed = !!(d.checks && d.checks.length);
    return {
      summary: (d.review && d.review.summary) || (d.overall != null ? ('準備度 ' + d.overall + ' / 100') : (diagnosed ? '未取得の項目があるため総合点なし' : '診断前の仮評価')),
      evidenceClass: diagnosed ? 'Observed' : 'Estimated',
      evidenceTip: '公開HTML等から観測した準備度です。AI回答の掲載率・予約増を保証しません。',
      state: d.state || (diagnosed ? 'verified' : null),
      band: band(d.overall),
      good: good,
      bad: bad,
      unknown: unknown,
      byFactor: Object.keys(byFactor).map(function (k) { return byFactor[k]; }),
      nextNow: nextNow,
      nextWeeks: nextWeeks,
      nextSales: salesActions,
      formula: '総合 = ページ構造×0.30 + 会社情報×0.25 + FAQ×0.20 + 見つけやすさ×0.25',
      overall: d.overall
    };
  }

  function buildFactorBreakdown(diagnose) {
    var d = diagnose || {};
    var parts = [
      {
        id: 'structure',
        label: 'ページ構造',
        tip: 'タイトル・H1・説明文など、ページの基本骨格です。主題が伝わるかを見ます。',
        score: d.structure,
        weight: 0.30,
        missingWhen: function (diag) {
          var out = [];
          if (!diag || !diag.page) return ['診断前のため未確認'];
          var p = diag.page;
          if (!p.h1) out.push('主見出し（H1）が無い');
          if (!(p.title)) out.push('ページタイトル（title）が無い');
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
          if (!/Organization|LocalBusiness/.test(types)) out.push('会社・お店の構造化データ（Organization / LocalBusiness）が無い');
          if (!/Service|Product/.test(types)) out.push('サービス・商品の構造化データ（Service / Product）が無い');
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
          var fc = diag.page.faqCount || 0;
          if (fc === 0) out.push('FAQ（よくある質問）が無い');
          else if (fc < 3) out.push('FAQが3問未満（いま ' + fc + ' 問）');
          var types = (diag.page.types || []).join(' ');
          if (!/FAQPage/.test(types)) out.push('FAQの構造化データ（FAQPage）が無い');
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
          var page = diag.page || {};
          // hasLlms / hasRobots: true = あり, false = なし, null = 取得できず（未確認）
          if (page.hasLlms === null) out.push('llms.txtは未確認（取得できませんでした）');
          else if (!page.hasLlms) out.push('llms.txt が無いか、80文字以下');
          if (page.hasRobots === null) out.push('robots.txtは未確認（取得できませんでした）');
          else if (!page.hasRobots) out.push('robots.txt が無い');
          return out;
        }
      }
    ];

    // Band comes from the display contract only (no thresholds in this file).
    function level(score) {
      var b = band(score);
      return { key: b.key, label: b.label, tone: b.tone, color: b.color, meaning: b.meaning };
    }

    var factorStates = d.factors || {};
    var factors = parts.map(function (p) {
      var score = p.score == null ? null : Number(p.score);
      var lv = level(score);
      var fstate = factorStates[p.id] && factorStates[p.id].state ? factorStates[p.id].state : (score == null ? 'unknown' : 'verified');
      var missing = p.missingWhen(d);
      // 同じ内容の重複を出さない（例:「FAQが少ない／無い」と「FAQが3問以上」を満たしていない）
      var TOPICS = [/H1|主見出し/, /タイトル|title/, /meta|説明文/, /FAQPage/, /3問|FAQが少ない/, /llms/, /robots/, /Organization|会社情報/, /Service|Product|サービス定義/];
      function topicOf(t) { for (var i = 0; i < TOPICS.length; i++) if (TOPICS[i].test(t)) return i; return -1; }
      function covered(t) { var k = topicOf(t); return k >= 0 && missing.some(function (m) { return topicOf(m) === k; }); }
      // also pull matching gaps text
      (d.gaps || []).forEach(function (g) {
        var t = String(g || '');
        if (covered(t)) return;
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
        state: fstate,
        missing: missing.slice(0, 3),
        formula: p.label + ' × ' + p.weight
      };
    });

    var overall = d.overall != null ? Number(d.overall) : null;
    var weak = factors.filter(function (f) { return f.score != null && f.level.key !== 'high'; })
      .sort(function (a, b) { return (a.score || 0) - (b.score || 0); });
    var diagnosed = !!(d.checks && d.checks.length);
    var disp = display();

    return {
      overall: overall,
      band: band(overall),
      state: d.state || (diagnosed ? 'verified' : null),
      ruleVersion: d.ruleVersion || null,
      displayVersion: d.displayVersion || (disp ? disp.version : null),
      scopeSentence: disp ? disp.scopeSentence() : '',
      legend: disp ? disp.legend() : [],
      formula: '総合 = ページ構造×0.30 + 会社情報×0.25 + FAQ×0.20 + 見つけやすさ×0.25',
      formulaTip: '公開HTMLの準備度です。AI回答の掲載率や予約増を保証しません。',
      factors: factors,
      weakFactors: weak,
      gaps: (d.gaps || []).slice(0, 5),
      unknowns: (d.unknowns || []).slice(0, 5),
      strengths: (d.strengths || []).slice(0, 4),
      evidenceClass: diagnosed ? 'Observed' : 'Estimated'
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
      var recon = 0, reconW = 0;
      weights.forEach(function (row) {
        var raw = parts[row.key];
        if (raw == null || !isFinite(Number(raw))) {
          // Not fetched: shown as 未確認, excluded from the sum (never counted as 0).
          readinessRows.push({
            label: row.label,
            formula: 'score(' + row.key + ') × ' + row.weight,
            value: '未確認（取得できず・計算から除外）',
            note: row.maxPts,
            evidence: acq.evidenceClass || 'Observed'
          });
          return;
        }
        var v = Number(raw);
        var contrib = Math.round(v * row.weight * 10) / 10;
        recon += v * row.weight;
        reconW += row.weight;
        readinessRows.push({
          label: row.label,
          formula: 'score(' + row.key + ') × ' + row.weight,
          value: v + ' × ' + row.weight + ' = ' + contrib,
          note: row.maxPts,
          evidence: acq.evidenceClass || 'Observed'
        });
      });
      var overallShown = acq.score == null ? '未確認（必須項目が未取得）' : String(acq.score);
      var reconShown = reconW > 0 ? Math.round(recon / reconW) : null;
      readinessRows.push({
        label: '総合準備度（overall）',
        formula: '0.30·S + 0.25·E + 0.20·F + 0.25·D（未確認の要素は重みを再配分）',
        value: (reconShown == null ? '—' : reconShown + ' / 100') + '（表示値 ' + overallShown + '）',
        note: '公開HTMLの観測に基づく。AI実回答の引用率ではない。判定ルール ' + ((diagnose && diagnose.ruleVersion) || '—') + ' / 表示区分 ' + ((diagnose && diagnose.displayVersion) || '—'),
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

    var volUser = volume.evidenceClass === 'User Input' && volume.value != null;
    sections.push({
      id: 'volume',
      title: '2. 検索データ',
      summary: '検索回数は推定しません。Google Search Console の実測（表示回数・クリック・平均順位）は、診断したサイトと同じサイトのデータだけを使います。',
      rows: [
        {
          label: '検索回数',
          formula: '推定しない（入力した数、または正式な検索回数データがあるときだけ使う）',
          value: volUser ? ('入力値 ' + cnt(volume.value)) : '未計測',
          note: '',
          evidence: volUser ? 'User Input' : 'Unmeasured'
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
          formula: 'ユーザー入力（または GA4）。未入力なら試算しない',
          value: 'I₀ = ' + cnt(inq.currentInquiries) + '（source: ' + (inq.inquiriesSource || '—') + '）',
          note: '訪問者はユーザー入力（または GA4）のときだけ使う。',
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
          value: inq.addLow == null ? '未計算（いまの件数が未入力）' : ('ΔI = +' + cnt(inq.addLow) + '〜+' + cnt(inq.addHigh) + ' → 改善後 ' + cnt(inq.afterLow) + '〜' + cnt(inq.afterHigh)),
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
          value: lost.missedInquiries == null ? '未計算（いまの件数が未入力）' : '問い合わせ ≈ ' + cnt(lost.missedInquiries)
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
      { label: 'お客さんの言葉入力', formula: '+6', value: confOpts.hasKeyword ? '+6' : '0', on: !!confOpts.hasKeyword },
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
      || { id: 'other', label: 'その他', display_label: '問い合わせ', demand_label: 'この言葉で探している人', now_label: 'ホームページの情報整備', after_label: '直したあとの目安', outcome_label: '問い合わせ', demand_meaning: '', now_meaning: '', after_meaning: '', outcome_meaning: '', hero_generic: '診断結果', hero_branded: '診断結果', cta_generic: 'まず何を直すか見る', cta_branded: 'まず何を直すか見る', impact_current_label: 'いま' };

    var baseline = (window.AirReachHandoff && window.AirReachHandoff.loadOfficialBaseline)
      ? window.AirReachHandoff.loadOfficialBaseline()
      : null;

    if (baseline && baseline.ga4 && baseline.ga4.monthlySessions > 0 && !inputs.monthlyVisitors) {
      inputs.monthlyVisitors = baseline.ga4.monthlySessions;
    }
    if (baseline && baseline.ga4 && baseline.ga4.monthlyKeyEvents > 0 && !inputs.monthlyInquiries) {
      inputs.monthlyInquiries = baseline.ga4.monthlyKeyEvents;
    }

    // 検索回数は推定しない（言葉の文字列から計算した値は使わない）。使うのは店の方が入力した数だけ
    var volume = {
      value: null,
      evidenceClass: 'Unmeasured',
      label: '検索データなし',
      note: '検索回数は推定しません。Search Console の実測か、入力した数だけを使います。'
    };
    if (opts.volumeOverride != null && isFinite(Number(opts.volumeOverride)) && String(opts.volumeOverride).trim() !== '') {
      volume = {
        value: Number(opts.volumeOverride),
        evidenceClass: 'User Input',
        label: '入力した検索回数',
        note: 'ユーザー入力値'
      };
    }

    var acq = acquisitionScoreFromDiagnose(diagnose);
    var improve = improvementRange(acq.score);
    var rank = rankFromScore(acq.score);
    var inq = inquiryForecast(inputs, acq.score, volume.value);
    var close = clamp(num(inputs.closeRatePct, 20) / 100, 0, 1);
    var deal = Math.max(0, num(inputs.avgDeal, 0));
    // いまの件数が入力も GA4 も無いとき、検索回数の推定から件数を作らない（以前は文字列から計算した回数 ×0.15% を「いま」にしていた）
    var inqMeasured = inq.inquiriesSource !== 'Estimated' && inq.currentInquiries > 0;
    if (!inqMeasured) {
      inq.addLow = inq.addHigh = inq.afterLow = inq.afterHigh = null;
      inq.currentInquiries = null;
      inq.cpa = null;
      inq.notComputed = true;
    }
    // 訪問数は入力（または GA4）があるときだけ出す。検索回数から補完しない
    if (!(inputs.monthlyVisitors > 0) && volume.evidenceClass !== 'User Input') inq.currentVisitors = null;
    var lost = inqMeasured ? opportunityLoss(inq.currentInquiries, acq.score, close, deal)
      : { evidenceClass: 'Unmeasured', missedInquiries: null, missedDeals: null, missedRevenue: null, note: 'いまの件数が分からないため、取りこぼしの件数は試算していません。' };
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
    var referral = buildReferral(profile, diagnose);
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
          label: keyword ? ('「' + keyword + '」で探している人') : profile.demand_label,
          value: volume.value != null ? ('約 ' + cnt(volume.value)) : '—',
          unit: '回 / 月',
          badge: volume.evidenceClass,
          meaning: profile.demand_meaning,
          sub: keyword ? ('「' + keyword + '」') : '調べられるときの名前を入力'
        },
        {
          id: 'now',
          label: profile.now_label,
          value: bScore == null ? '—' : String(bScore),
          unit: bScore == null ? '' : '/ 100',
          badge: brand ? brand.evidenceClass : 'Observed',
          band: band(bScore),
          meaning: profile.now_meaning + ' · ' + scoreMeaning(bScore),
          sub: bScore == null ? (acq.note || '未確認') : scoreMeaning(bScore)
        },
        {
          // AI の回答はこの無料診断では測っていない。計算で作った割合は出さない
          id: 'cite_now',
          label: 'AIの回答で記事が引用されている割合',
          value: '未計測',
          unit: '',
          badge: 'Unmeasured',
          meaning: 'この無料診断はホームページの情報整備だけを見ています。AIの回答での引用は、質問ごとに実際に聞いて数える必要があります',
          sub: 'AirReach Consulting で質問ごとに計測できます'
        },
        {
          id: 'cite_after',
          label: profile.outcome_label,
          value: '—',
          unit: '',
          badge: 'Unmeasured',
          meaning: '計測する前なので、整えたあとの目安も出していません',
          sub: '計測後に、改善前と比べて表示します'
        }
      ];
      heroTitle = profile.hero_branded;
    } else {
      headline4 = [
        {
          id: 'demand',
          label: keyword ? ('「' + keyword + '」で探している人') : profile.demand_label,
          value: volume.value != null ? ('約 ' + cnt(volume.value)) : '—',
          unit: '回 / 月',
          badge: volume.evidenceClass,
          meaning: profile.demand_meaning,
          sub: keyword ? ('「' + keyword + '」') : 'お客さんが使いそうな言葉を入力'
        },
        {
          id: 'now',
          label: profile.now_label,
          value: acq.score == null ? '—' : String(acq.score),
          unit: acq.score == null ? '' : '/ 100',
          badge: acq.evidenceClass === 'Observed' ? 'Observed' : 'Estimated',
          band: band(acq.score),
          meaning: profile.now_meaning + ' · ' + scoreMeaning(acq.score),
          sub: acq.score == null ? (acq.note || '未確認') : scoreMeaning(acq.score)
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
        inqMeasured ? {
          id: 'outcome',
          label: profile.outcome_label,
          value: '+' + inq.addLow + '〜' + inq.addHigh,
          unit: '件 / 月',
          badge: 'Inferred',
          meaning: profile.outcome_meaning,
          sub: '現在 ' + cnt(inq.currentInquiries) + ' → ' + cnt(inq.afterLow) + '〜' + cnt(inq.afterHigh) + ' 件'
        } : {
          id: 'outcome',
          label: profile.outcome_label,
          value: '—',
          unit: '',
          badge: 'Unmeasured',
          meaning: 'いまの' + (profile.display_label || '件数') + 'の数が分からないため、増える件数は試算していません',
          sub: '月の件数を入力するか GA4 を接続すると試算します'
        }
      ];
    }

    // 飲食店: 「探している人 ◯回/月」（文字列から作った推定値）の代わりに、
    // 調べそうな言葉のうち、サイトに答えが書いてある数を出す（HTMLから判定した実測）。入力された検索数があればそちらを使う。
    var kwAuto = diagnose && diagnose.page && diagnose.page.keywordAuto;
    var kwSet = kwAuto ? ((kwAuto.industries && kwAuto.industries[industryId] && kwAuto.industries[industryId].candidates) || (industryId === 'restaurant' ? kwAuto.candidates : null)) : null;
    var hasVolumeInput = opts.volumeOverride != null && String(opts.volumeOverride).trim() !== '' && isFinite(Number(opts.volumeOverride));
    if (!hasVolumeInput && headline4 && headline4[0] && headline4[0].id === 'demand' && !(kwSet && kwSet.length)) {
      // 言葉を作れなかったとき: 文字列から作った推定回数は出さない
      // 調べる言葉（メイン）があるときはその言葉で見出しを作る。回数は出さない
      headline4[0] = keyword ? {
        id: 'demand', label: '「' + keyword + '」で探している人', value: '—', unit: '', badge: 'Unmeasured',
        meaning: '検索回数は Search Console を接続したときだけ出します。文字列からの推定は出しません',
        sub: 'Search Console 未接続のため未計測'
      } : {
        id: 'demand', label: 'お客さんが調べそうな言葉', value: '—', unit: '', badge: 'Unmeasured',
        meaning: 'サイトから住所・業種・名前を読み取れなかったため、言葉を作れませんでした。検索回数は Search Console を接続したときだけ出します',
        sub: '調べる言葉を入力すると判定できます'
      };
    }
    if (kwSet && kwSet.length && !hasVolumeInput && headline4 && headline4[0] && headline4[0].id === 'demand') {
      var judged = kwSet.filter(function (c) { return c.answered !== null; });
      var answered = judged.filter(function (c) { return c.answered; });
      var unreadable = kwSet.some(function (c) { return c.reason === 'unreadable'; });
      headline4[0] = {
        id: 'demand',
        label: 'お客さんが調べそうな言葉',
        value: judged.length ? (answered.length + ' / ' + judged.length) : '—',
        unit: judged.length ? '個にサイトが答えている' : '',
        badge: 'Observed',
        meaning: '調べそうな言葉ごとに、その答え（' + (industryId === 'restaurant' ? 'ランチ・個室・予約' : industryId === 'clinic' ? '予約・料金・診療時間' : (industryId === 'b2b' ? '料金・導入事例・資料請求' : industryId === 'media' ? '運営会社・問い合わせ・広告掲載' : '料金・予約・営業時間')) + ' など）がサイトに書いてあるかの数。検索回数ではありません',
        sub: unreadable ? 'ページの本文を JavaScript で表示しているため読み取れず、一部を判定していません' : '全' + kwSet.length + '語（一覧は詳細データ）',
        keywordSet: kwSet
      };
    }

    // キーワード比較（詳細データ）の「検索データ」: Google 実測（診断したサイトと同じサイトの Search Console）・
    // 正式な月間検索数（将来）・入力値だけ。文字列から作った回数は使わない。GSC が無くても動く
    var kwLib = window.AirReachKeywordList;
    var kwNorm = kwLib ? kwLib.normalize(keyword, opts.keywords) : { keyword: keyword, keywords: [] };
    var keywordComparison = kwLib
      ? kwLib.compare(kwNorm.keywords, { gsc: kwLib.gscFromBaseline(baseline, opts.url), volumeInput: hasVolumeInput ? Number(opts.volumeOverride) : null })
      : [];
    var primaryRow = keywordComparison.filter(function (r) { return r.primary; })[0];
    var primaryGsc = primaryRow && primaryRow.searchData && primaryRow.searchData.gsc;
    if (primaryGsc && primaryGsc.impressions != null && headline4 && headline4[0] && headline4[0].id === 'demand') {
      // メインの言葉に実測があれば、見出しは実測を優先（検索回数ではなく、このサイトが表示された回数）
      var gd = primaryGsc;
      headline4[0] = {
        id: 'demand',
        label: '「' + keyword + '」での表示回数',
        value: cnt(gd.impressions),
        unit: '回 / 直近' + gd.periodDays + '日',
        badge: 'Official',
        meaning: 'Google Search Console の実測（直近' + gd.periodDays + '日）。クリック ' + (gd.clicks != null ? cnt(gd.clicks) : '—') +
          ' · 平均順位 ' + (gd.position != null ? gd.position.toFixed(1) : '—') + '。この言葉で検索されたときに、このサイトが検索結果に表示された回数です（検索回数そのものではありません）',
        sub: 'クリック ' + (gd.clicks != null ? cnt(gd.clicks) : '—') + (gd.position != null ? ' · 平均順位 ' + gd.position.toFixed(1) : '')
      };
    }

    var primaryCta = mode === 'branded_search' || industryId === 'media'
      ? (profile.cta_branded || 'どの記事が使われているか見る')
      : (profile.cta_generic || 'まず何を直すか見る');
    var ctaHash = industryId === 'media' ? '#brand-panel' : '#actions';

    return {
      mode: mode,
      modeLabel: mode === 'branded_search' ? '名前で調べられたとき' : '新しいお客さん向け',
      industryId: industryId,
      industryLabel: profile.label,
      industryDetect: industryDetect,
      keyword: keyword,
      keywords: kwNorm.keywords,
      keywordComparison: keywordComparison,
      url: opts.url || '',
      measuredAt: new Date().toISOString(),
      heroTitle: heroTitle,
      scoreOverall: acq.score,
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
      referral: referral,
      displayLabel: profile.display_label,
      impactCurrentLabel: profile.impact_current_label || ('いまの' + profile.display_label),
      cta: { label: primaryCta, hash: ctaHash },
      disclaimer: '表示は参考シミュレーションです。検索順位・AI掲載・予約・問い合わせ・売上を保証しません。',
      steps: ['いま', '直したあと', 'やること']
    };
  }

  function badgeLabel(b) {
    var s = String(b || '');
    if (s.indexOf('Unmeasured') >= 0 || s.indexOf('未計測') >= 0) return '未計測';
    if (s.indexOf('Official') >= 0 || s.indexOf('Google実測') >= 0) return 'Google実測';
    if (s.indexOf('Observed') >= 0 || s.indexOf('AirReach Tools実測') >= 0 || s.indexOf('AirReach Consulting実測') >= 0) return 'AirReach Tools実測';
    if (s.indexOf('実測') >= 0) return 'AirReach Tools実測';
    if (s.indexOf('User') >= 0 || s.indexOf('入力') >= 0 || s.indexOf('お客様') >= 0) return 'お客様入力';
    if (s.indexOf('Estimated') >= 0 || s.indexOf('推定') >= 0 || s.indexOf('Inferred') >= 0 || s.indexOf('予測') >= 0 || s.indexOf('参考') >= 0) return '参考予測';
    if (s.indexOf('診断') >= 0) return '参考予測';
    if (s.indexOf('Unmeasured') >= 0 || s.indexOf('未計測') >= 0) return '未計測';
    return s || '参考予測';
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
    scoreMeaning: scoreMeaning,
    band: band
  };
})();
