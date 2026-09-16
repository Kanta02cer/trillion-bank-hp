/**
 * AIO Agent (AirReach) — free Growth Report from public page signals.
 * Estimates are labeled. Does NOT claim live AI citation rates.
 */
(function () {
  'use strict';

  var MAX_BYTES = 900000;
  var FIRST_PARTY_PROXY = 'https://trillion-bank-airreach-fetch.trillion-bank.workers.dev/';
  var PROXY_BUILDERS = [
    function (u) { return FIRST_PARTY_PROXY + '?url=' + encodeURIComponent(u); },
    function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); }
  ];

  // Transparent default assumptions for free (unconnected) estimates
  var ASSUMPTIONS = {
    cvr: 0.02,
    expectedCvValueYen: 150000,
    grossMargin: 0.7,
    reachableCtr: 0.06,
    relevance: 0.7,
    labelNote: '未接続時の仮置き。GSC/GA4接続後に実測へ置換します。'
  };

  function normalizeUrl(input) {
    var raw = String(input || '').trim();
    if (!raw) throw new Error('URLを入力してください。');
    if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
    var url;
    try { url = new URL(raw); } catch (e) { throw new Error('URLの形式を確認してください。'); }
    if (!/^https?:$/i.test(url.protocol)) throw new Error('httpまたはhttpsのURLのみ対応しています。');
    url.username = '';
    url.password = '';
    ['token','access_token','auth','key','api_key','apikey','session','sig','signature','password','passwd'].forEach(function (k) {
      url.searchParams.delete(k);
    });
    Array.from(url.searchParams.keys()).forEach(function (k) {
      if (/token|secret|auth|key|session|sig/i.test(k)) url.searchParams.delete(k);
    });
    return url;
  }

  function fetchText(url, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 15000);
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, credentials: 'omit', mode: 'cors' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var len = res.headers && res.headers.get ? res.headers.get('content-length') : null;
      if (len && parseInt(len, 10) > MAX_BYTES) throw new Error('応答が大きすぎます');
      return res.text().then(function (text) {
        clearTimeout(timer);
        if (text && text.length > MAX_BYTES) throw new Error('応答が大きすぎます');
        return text;
      });
    }).catch(function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  function fetchWithFallbacks(targetUrl, allowProxy) {
    return fetchText(targetUrl, 10000).catch(function (directErr) {
      if (!allowProxy) {
        throw new Error('このサイトは直接取得できません。下の同意にチェックするか、お問い合わせからURLをお送りください。');
      }
      var chain = Promise.reject(directErr);
      PROXY_BUILDERS.forEach(function (build) {
        chain = chain.catch(function () { return fetchText(build(targetUrl), 16000); });
      });
      return chain.catch(function () {
        throw new Error('ページを取得できませんでした。お問い合わせからURLをお送りください。');
      });
    });
  }

  function absUrl(base, path) {
    try { return new URL(path, base).href; } catch (e) { return null; }
  }

  function scoreBlock(pts, max) {
    return Math.max(0, Math.min(100, Math.round((pts / max) * 100)));
  }

  function yen(n) {
    return Math.round(n);
  }

  function parseHtml(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var text = (doc.body && doc.body.innerText ? doc.body.innerText : '').replace(/\s+/g, ' ').trim();
    var title = (doc.querySelector('title') || {}).textContent || '';
    var h1 = Array.prototype.map.call(doc.querySelectorAll('h1'), function (n) { return n.textContent.trim(); }).filter(Boolean);
    var h2 = Array.prototype.map.call(doc.querySelectorAll('h2'), function (n) { return n.textContent.trim(); }).filter(Boolean).slice(0, 20);
    var metaDesc = (doc.querySelector('meta[name="description"]') || {}).content || '';
    var canonical = (doc.querySelector('link[rel="canonical"]') || {}).href || '';
    var robotsMeta = ((doc.querySelector('meta[name="robots"]') || {}).content || '').toLowerCase();
    var ogTitle = (doc.querySelector('meta[property="og:title"]') || {}).content || '';
    var ldNodes = Array.prototype.slice.call(doc.querySelectorAll('script[type="application/ld+json"]'));
    var types = {};
    var faqCount = 0;
    ldNodes.forEach(function (node) {
      try {
        var data = JSON.parse(node.textContent);
        var items = Array.isArray(data) ? data : [data];
        items.forEach(function walk(it) {
          if (!it || typeof it !== 'object') return;
          var t = it['@type'];
          if (Array.isArray(t)) t.forEach(function (x) { types[x] = true; });
          else if (typeof t === 'string') types[t] = true;
          if (t === 'FAQPage' || (Array.isArray(t) && t.indexOf('FAQPage') >= 0)) {
            var ents = it.mainEntity || [];
            faqCount += Array.isArray(ents) ? ents.length : 0;
          }
          if (Array.isArray(it['@graph'])) it['@graph'].forEach(walk);
        });
      } catch (e) { /* ignore */ }
    });
    var visibleFaq = doc.querySelectorAll('[itemtype*="FAQPage"], .faq, #faq, [aria-labelledby*="faq"]').length;
    var hasContact = /お問い合わせ|contact|inquiry|相談|予約/i.test(text) || !!doc.querySelector('a[href*="contact"], a[href*="meeting"], form');
    var hasPrice = /料金|価格|円|プラン|費用|見積/i.test(text);
    var hasCompare = /比較|おすすめ|選び方|違い|メリット|デメリット/i.test(text);
    var hasUpdate = /更新日|最終更新|as of|確認日/i.test(text) || !!doc.querySelector('time');
    var hasAuthor = /著者|執筆|監修|author/i.test(text);
    var hasCase = /事例|実績|導入|ケース/i.test(text);
    return {
      title: title.trim(),
      h1: h1,
      h2: h2,
      metaDesc: metaDesc.trim(),
      canonical: canonical,
      robotsMeta: robotsMeta,
      ogTitle: ogTitle,
      types: types,
      faqCount: faqCount,
      visibleFaq: visibleFaq,
      hasContact: hasContact,
      hasPrice: hasPrice,
      hasCompare: hasCompare,
      hasUpdate: hasUpdate,
      hasAuthor: hasAuthor,
      hasCase: hasCase,
      textLen: text.length,
      text: text,
      htmlLen: html.length
    };
  }

  function brandSeed(host, page) {
    var fromTitle = String(page.title || '').split(/[|\-—・｜]/)[0].trim()
      .replace(/^株式会社/, '')
      .replace(/株式会社$/, '')
      .trim();
    if (fromTitle && fromTitle.length <= 18 && !/課題|挑む|ミッション|わたしたち|私たち|判断材料/.test(fromTitle)) {
      return fromTitle;
    }
    try {
      var h = new URL('https://' + String(host || '').replace(/^https?:\/\//, '')).hostname.replace(/^www\./, '');
      var part = h.split('.')[0];
      if (part === 'trillion-bank') return 'Trillion Bank';
      if (part) return part.replace(/-/g, ' ');
    } catch (e) { /* ignore */ }
    return 'サービス';
  }

  function extractThemes(page, host) {
    var seeds = [];
    var brand = brandSeed(host, page);
    function usable(s) {
      s = String(s || '').replace(/\s+/g, ' ').trim();
      if (!s || s.length < 2 || s.length > 28) return '';
      if (/^[A-Za-z0-9._-]+$/.test(s) && s.indexOf(' ') < 0 && s.length < 4) return '';
      if (/課題に挑む|ミッション|わたしたち|私たち|ようこそ|トップページ|判断材料|重要なのは/.test(s)) return '';
      if (/[。．！？]/.test(s) || (s.length > 18 && /\s/.test(s) && !/比較|おすすめ|料金|とは/.test(s))) return '';
      return s;
    }
    function add(s, intent, weight) {
      s = usable(s);
      if (!s) return;
      seeds.push({ raw: s, intent: intent || 'informational', weight: weight || 1 });
    }
    page.h1.forEach(function (t) { add(t, 'commercial', 3); });
    add(page.title.split(/[|\-—・｜]/)[0], 'commercial', 2);
    page.h2.forEach(function (t) {
      var intent = /比較|おすすめ|料金|選び方/.test(t) ? 'comparison' : 'informational';
      add(t, intent, 2);
    });
    if (page.hasCompare) add(brand + ' 比較', 'comparison', 4);
    if (page.hasPrice) add(brand + ' 料金', 'commercial', 3);
    add(brand + ' おすすめ', 'comparison', 3);
    add(brand + ' とは', 'informational', 2);
    add('AI検索 測定', 'commercial', 2);

    // Dedupe by normalized key
    var map = {};
    seeds.forEach(function (s) {
      var key = s.raw.toLowerCase();
      if (!map[key] || map[key].weight < s.weight) map[key] = s;
    });
    var list = Object.keys(map).map(function (k) { return map[k]; });
    list.sort(function (a, b) { return b.weight - a.weight; });
    return list.slice(0, 10);
  }

  function estimateThemeMetrics(theme, scores, index) {
    var intentBoost = theme.intent === 'comparison' ? 1.4 : theme.intent === 'commercial' ? 1.2 : 1.0;
    var baseVol = Math.round((180 + theme.weight * 220 + (10 - index) * 90) * intentBoost);
    // Soften by page readiness: weaker pages still have demand, but lower reachable share
    var coverage = Math.max(0.15, Math.min(0.85, scores.search / 100));
    var currentCtr = Math.max(0.002, (scores.answer / 100) * 0.04);
    var demand = baseVol;
    var reachableClicks = demand * ASSUMPTIONS.reachableCtr * ASSUMPTIONS.relevance * coverage;
    var currentClicks = demand * currentCtr * 0.5;
    var addClicks = Math.max(0, Math.round(reachableClicks - currentClicks));
    var cvBase = addClicks * ASSUMPTIONS.cvr;
    var revenueBase = cvBase * ASSUMPTIONS.expectedCvValueYen;
    var gap = Math.round((1 - coverage) * 40 + (theme.intent === 'comparison' && scores.answer < 70 ? 25 : 10));
    var opportunityScore = Math.min(99, Math.round(
      (demand / 40) * 0.25 +
      (addClicks / 8) * 0.3 +
      gap * 0.25 +
      theme.weight * 8
    ));
    var aiDemand = theme.intent === 'comparison' || theme.intent === 'commercial' ? '高' : '中';
    var effort = theme.intent === 'informational' ? '低' : theme.intent === 'comparison' ? '中' : '中';
    var confidence = Math.min(92, 58 + theme.weight * 6 + Math.round(scores.ai / 10));
    return {
      name: theme.raw,
      intent: theme.intent,
      googleVolumeEst: demand,
      aiDemandLabel: aiDemand,
      opportunityScore: opportunityScore,
      clicksEst: addClicks,
      cvEst: Math.round(cvBase * 10) / 10,
      revenueEst: yen(revenueBase),
      profitEst: yen(revenueBase * ASSUMPTIONS.grossMargin),
      priority: opportunityScore,
      effort: effort,
      confidence: confidence,
      prompts: [
        theme.raw + ' とは',
        theme.raw + ' おすすめ',
        theme.raw + ' 比較'
      ],
      action: theme.intent === 'comparison'
        ? '比較・料金・選ばれる理由を1ページにまとめる'
        : theme.intent === 'commercial'
          ? '対象・料金・次の相談先を明確にする'
          : '定義とよくある質問を厚くする',
      dataKind: 'モデル予測'
    };
  }

  function analyze(page, llmsText, robotsText, baseHref) {
    // Google search readiness (structure / indexability) — llms.txt is auxiliary only
    var searchPts = 0, searchMax = 14;
    if (page.title) searchPts += 2;
    if (page.h1.length === 1) searchPts += 3;
    else if (page.h1.length > 1) searchPts += 1;
    if (page.metaDesc && page.metaDesc.length >= 40) searchPts += 2;
    if (page.canonical) searchPts += 2;
    if (page.ogTitle) searchPts += 1;
    if (page.textLen > 800) searchPts += 2;
    if (robotsText && /sitemap/i.test(robotsText)) searchPts += 1;
    if (page.robotsMeta.indexOf('noindex') >= 0) searchPts -= 3;

    var entityPts = 0, entityMax = 10;
    if (page.types.Organization || page.types.LocalBusiness) entityPts += 4;
    if (page.types.WebSite || page.types.WebPage) entityPts += 2;
    if (page.types.Service || page.types.Product) entityPts += 2;
    if (page.types.BreadcrumbList) entityPts += 1;
    if (page.hasContact) entityPts += 1;

    var answerPts = 0, answerMax = 12;
    if (page.types.FAQPage) answerPts += 3;
    if (page.faqCount >= 3) answerPts += 3;
    else if (page.faqCount > 0) answerPts += 1;
    if (page.visibleFaq) answerPts += 2;
    if (page.hasCompare) answerPts += 2;
    if (page.hasPrice) answerPts += 2;

    var trustPts = 0, trustMax = 8;
    if (page.hasUpdate) trustPts += 2;
    if (page.hasAuthor) trustPts += 2;
    if (page.hasCase) trustPts += 2;
    if (page.textLen > 1500) trustPts += 2;

    var cvPts = 0, cvMax = 8;
    if (page.hasContact) cvPts += 4;
    if (page.hasPrice) cvPts += 2;
    if (/無料|資料|デモ|相談|予約|申し込み/i.test(page.text)) cvPts += 2;

    var discPts = 0, discMax = 8;
    if (robotsText) {
      discPts += 2;
      if (/GPTBot|ClaudeBot|PerplexityBot|Google-Extended|OAI-SearchBot/i.test(robotsText)) discPts += 2;
      if (/Disallow:\s*\/\s*$/m.test(robotsText) && !/Allow:/i.test(robotsText)) discPts -= 2;
    }
    if (llmsText && llmsText.length > 80) discPts += 2; // auxiliary
    if (page.robotsMeta.indexOf('noindex') >= 0) discPts -= 3;
    if (/sitemap/i.test(robotsText || '')) discPts += 2;

    var search = scoreBlock(Math.max(0, searchPts), searchMax);
    var entity = scoreBlock(entityPts, entityMax);
    var answer = scoreBlock(answerPts, answerMax);
    var trust = scoreBlock(trustPts, trustMax);
    var cv = scoreBlock(cvPts, cvMax);
    var discover = scoreBlock(Math.max(0, discPts), discMax);
    var ai = Math.round(answer * 0.35 + entity * 0.25 + trust * 0.2 + discover * 0.2);
    var overall = Math.round(ai * 0.35 + search * 0.25 + entity * 0.15 + answer * 0.15 + cv * 0.1);

    var scores = { ai: ai, search: search, entity: entity, answer: answer, trust: trust, cv: cv, discover: discover };

    var strengths = [];
    var gaps = [];
    if (page.h1.length === 1) strengths.push('ページの主題が1つにまとまっている');
    else gaps.push('ページの主題がはっきりしない（見出しが無い、または多すぎる）');
    if (page.types.Organization || page.types.LocalBusiness) strengths.push('会社情報が機械にも読める形で載っている');
    else gaps.push('会社名・公式サイトなどの会社情報が不足している');
    if (page.types.FAQPage && page.faqCount > 0) strengths.push('よくある質問が ' + page.faqCount + ' 問ある');
    else gaps.push('よくある質問が少ない、または無い');
    if (page.hasCompare) strengths.push('比較や選び方の情報がある');
    else gaps.push('比較・選び方の情報が弱い');
    if (page.hasContact) strengths.push('問い合わせや相談の入り口がある');
    else gaps.push('問い合わせの入り口が見つけにくい');
    if (page.canonical) strengths.push('正式なページURLが明示されている');
    else gaps.push('正式なページURLの指定が無い');

    var actions = { now: [], weeks: [], partner: [] };
    if (!page.types.Organization) actions.now.push('会社名・公式URL・ロゴをページに明示する');
    if (!(page.types.FAQPage && page.faqCount >= 3)) actions.now.push('購入前に聞かれやすい質問を「よくある質問」にまとめる');
    if (!page.hasCompare) actions.now.push('比較・料金・選ばれる理由を1ページにまとめる');
    if (!page.metaDesc || page.metaDesc.length < 40) actions.now.push('検索結果の説明文で「誰向けの何のサービスか」を書く');
    if (page.h1.length !== 1) actions.weeks.push('主要ページの見出しを「何のサービスか」が一瞬で分かる文言に揃える');
    actions.weeks.push('競合と比較されやすいテーマの公式比較軸と対象外をページ化する');
    if (!llmsText || llmsText.length < 80) actions.weeks.push('（補助）AI向け案内ファイルで主要ページへの案内を置く');
    actions.partner.push('ChatGPTやGeminiなどで、自社がどう出てくるかを同じ条件で測る（HackⅡ）');
    actions.partner.push('Search Console連携で「推定」を実測に置き換える');
    actions.partner.push('直す作業と再計測まで一緒に進める');

    var host = '';
    try { host = new URL(baseHref).hostname; } catch (e) { host = baseHref; }

    var themes = extractThemes(page, host).map(function (t, i) {
      return estimateThemeMetrics(t, scores, i);
    });
    themes.sort(function (a, b) { return b.priority - a.priority; });

    var clicksBase = themes.reduce(function (s, t) { return s + t.clicksEst; }, 0);
    var cvBase = themes.reduce(function (s, t) { return s + t.cvEst; }, 0);
    var revenueBase = themes.reduce(function (s, t) { return s + t.revenueEst; }, 0);
    var cvLow = Math.round(cvBase * 0.55 * 10) / 10;
    var cvHigh = Math.round(cvBase * 1.45 * 10) / 10;
    var revenueLow = yen(revenueBase * 0.55);
    var revenueHigh = yen(revenueBase * 1.45);
    var profitBase = yen(revenueBase * ASSUMPTIONS.grossMargin);
    var profitLow = yen(revenueLow * ASSUMPTIONS.grossMargin);
    var profitHigh = yen(revenueHigh * ASSUMPTIONS.grossMargin);

    var topTheme = themes[0] ? themes[0].name : '主要サービス';
    var topFix = gaps.length ? gaps[0] : '実際のAI回答での出方を測り、弱いテーマから直す';
    var biggestProblem = scores.cv < 50
      ? '興味は呼べても、問い合わせにつながりにくい可能性があります。'
      : scores.answer < 55
        ? '検索やAIで比較されたとき、答えになる情報が足りない可能性があります。'
        : '検索結果やAI回答に出ても、クリック・推薦につながり切っていない可能性があります。';

    var verdict;
    var nextStep;
    if (overall >= 75) {
      verdict = '土台は整っています。次は実際の出方と取りこぼしを測る段階です。';
      nextStep = themes[0] ? themes[0].action : 'ChatGPTやGeminiでの実際の出方を測る';
    } else if (overall >= 50) {
      verdict = '基本はあるが、会社情報やFAQが弱い可能性があります。';
      nextStep = themes[0] ? themes[0].action : '会社情報とよくある質問を厚くする';
    } else {
      verdict = '見つけてもらいにくい状態の可能性が高いです。定義とFAQから整えましょう。';
      nextStep = 'サービスの定義とよくある質問を先に整える';
    }

    return {
      overall: overall,
      structure: search,
      entity: entity,
      faq: answer,
      discover: discover,
      scores: scores,
      strengths: strengths,
      gaps: gaps,
      actions: actions,
      themes: themes,
      opportunity: {
        clicksBase: clicksBase,
        cvBase: Math.round(cvBase * 10) / 10,
        cvLow: cvLow,
        cvHigh: cvHigh,
        revenueBase: yen(revenueBase),
        revenueLow: revenueLow,
        revenueHigh: revenueHigh,
        profitBase: profitBase,
        profitLow: profitLow,
        profitHigh: profitHigh,
        dataKind: 'モデル予測',
        assumptions: {
          cvr: ASSUMPTIONS.cvr,
          expectedCvValueYen: ASSUMPTIONS.expectedCvValueYen,
          grossMargin: ASSUMPTIONS.grossMargin,
          reachableCtr: ASSUMPTIONS.reachableCtr,
          relevance: ASSUMPTIONS.relevance,
          note: ASSUMPTIONS.labelNote
        },
        formula: '追加クリック ≒ 推定需要 × 到達可能CTR × 関連度 × カバー率 − 現状クリック。追加CV ≒ 追加クリック × CVR。売上機会 ≒ 追加CV × 問い合わせ1件の期待価値。'
      },
      plainSummary: {
        host: host,
        verdict: verdict,
        nextStep: nextStep,
        topFix: topFix,
        topTheme: topTheme,
        biggestProblem: biggestProblem
      },
      review: {
        summary: host + ' の成長機会レポート（推定）です。' + verdict,
        conversionHint: '問い合わせにつなげるには、「誰向けか／何ができるか／何をしないか／次の相談先」が同じページで揃っているかが大切です。',
        disclaimer: '準備度・証拠項目は公開ページの実測です。金額・CVはモデル予測（またはGSC入力実測）です。掲載・順位・流入・問い合わせ・売上を保証しません。AI回答の出方はHackⅡで測ります。'
      },
      page: {
        title: page.title,
        h1: page.h1[0] || '',
        types: Object.keys(page.types).sort(),
        faqCount: page.faqCount,
        hasLlms: !!(llmsText && llmsText.length > 80),
        hasRobots: !!robotsText,
        baseHref: baseHref
      }
    };
  }

  function emitProgress(cb, step, status, detail) {
    if (typeof cb === 'function') {
      try { cb({ step: step, status: status, detail: detail || '', at: Date.now() }); } catch (e) { /* ignore */ }
    }
  }

  function buildEvidence(page, llmsText, robotsText) {
    var types = Object.keys(page.types || {}).sort();
    return {
      dataKind: '実測（公開ページ）',
      measuredAt: new Date().toISOString(),
      items: [
        { key: 'title', label: 'title', value: page.title ? 'あり' : 'なし', ok: !!page.title, raw: page.title || '' },
        { key: 'h1', label: 'H1数', value: String(page.h1.length), ok: page.h1.length === 1, raw: page.h1.join(' / ') },
        { key: 'meta', label: 'meta description', value: page.metaDesc ? (page.metaDesc.length + '字') : 'なし', ok: !!(page.metaDesc && page.metaDesc.length >= 40) },
        { key: 'canonical', label: 'canonical', value: page.canonical ? 'あり' : 'なし', ok: !!page.canonical },
        { key: 'schema', label: '構造化データ型', value: types.length ? types.join(', ') : 'なし', ok: types.length > 0 },
        { key: 'org', label: 'Organization/LocalBusiness', value: (page.types.Organization || page.types.LocalBusiness) ? 'あり' : 'なし', ok: !!(page.types.Organization || page.types.LocalBusiness) },
        { key: 'faq', label: 'FAQ（JSON-LD）', value: page.faqCount + '問', ok: page.faqCount >= 3 },
        { key: 'compare', label: '比較・選び方表現', value: page.hasCompare ? 'あり' : 'なし', ok: !!page.hasCompare },
        { key: 'price', label: '料金表現', value: page.hasPrice ? 'あり' : 'なし', ok: !!page.hasPrice },
        { key: 'contact', label: '問い合わせ導線', value: page.hasContact ? 'あり' : 'なし', ok: !!page.hasContact },
        { key: 'robots', label: 'robots.txt', value: robotsText ? '取得済み' : '未取得', ok: !!robotsText },
        { key: 'llms', label: 'llms.txt（補助）', value: (llmsText && llmsText.length > 80) ? 'あり' : 'なし/薄い', ok: !!(llmsText && llmsText.length > 80) },
        { key: 'body', label: '本文量', value: page.textLen + '字', ok: page.textLen > 800 }
      ]
    };
  }

  function buildMeasurementProgress(result, opts) {
    opts = opts || {};
    var evidenceOk = (result.evidence && result.evidence.items)
      ? result.evidence.items.filter(function (i) { return i.ok; }).length
      : 0;
    var evidenceTotal = (result.evidence && result.evidence.items) ? result.evidence.items.length : 0;
    var searchMeasured = !!(opts.searchMeasured || result.searchMeasured || (result.themes || []).some(function (t) {
      return t.dataKind && String(t.dataKind).indexOf('実測') === 0;
    }));
    var hack2Measured = !!(opts.hack2Measured || (result.aiMeasured && result.aiMeasured.sampleSize > 0));
    var hack2Sample = !hack2Measured && !!(opts.hack2Sample || result.hack2Sample);
    return {
      layers: [
        {
          id: 'page',
          label: '公開ページ',
          status: 'done',
          dataKind: '実測',
          summary: evidenceOk + '/' + evidenceTotal + ' 項目クリア · 準備度 ' + (result.overall || 0) + '点',
          next: null
        },
        {
          id: 'search',
          label: '検索実測（GSC/GA4）',
          status: searchMeasured ? 'partial' : 'todo',
          dataKind: searchMeasured ? '実測（入力）' : '未計測',
          summary: searchMeasured
            ? '表示・クリック等で機会を再計算済み'
            : '表示回数・CTR・CVを入れると推定を置換',
          next: '数値を入力するか、正式連携を相談'
        },
        {
          id: 'ai',
          label: 'AI回答実測（HackⅡ）',
          status: hack2Measured ? 'done' : (hack2Sample ? 'sample' : 'todo'),
          dataKind: hack2Measured ? 'HackⅡ実測' : (hack2Sample ? 'SAMPLE' : '未計測'),
          summary: hack2Measured
            ? 'モデル別の推薦・引用を計測済み'
            : (hack2Sample ? 'SAMPLE表示中（実測ではない）' : 'ChatGPT等の出方はまだ未計測'),
          next: 'HackⅡで同条件測定'
        },
        {
          id: 'action',
          label: '施策→再測定',
          status: 'ready',
          dataKind: '下書き可',
          summary: '優先テーマからブリーフ作成・差分保存が可能',
          next: '承認後に実装（自動公開なし）'
        }
      ],
      completionPct: Math.round(
        (100 + (searchMeasured ? 50 : 0) + (hack2Measured ? 50 : (hack2Sample ? 15 : 0))) / 2
      )
    };
  }

  function diagnose(inputUrl, options) {
    options = options || {};
    var allowProxy = !!options.allowProxy;
    var onProgress = options.onProgress;
    var url = normalizeUrl(inputUrl);
    var base = url.origin + '/';

    emitProgress(onProgress, 'fetch_page', 'running', '公開HTMLを取得しています');
    return fetchWithFallbacks(url.href, allowProxy).then(function (html) {
      if (!html || html.length < 40) throw new Error('ページ内容を取得できませんでした。');
      emitProgress(onProgress, 'fetch_page', 'done', 'HTML ' + html.length.toLocaleString('ja-JP') + ' bytes');
      emitProgress(onProgress, 'fetch_meta', 'running', 'robots.txt / llms.txt を確認しています');
      return Promise.all([
        Promise.resolve(html),
        fetchWithFallbacks(absUrl(base, '/llms.txt'), allowProxy).catch(function () { return ''; }),
        fetchWithFallbacks(absUrl(base, '/robots.txt'), allowProxy).catch(function () { return ''; })
      ]);
    }).then(function (parts) {
      var html = parts[0];
      var llmsText = parts[1] || '';
      var robotsText = parts[2] || '';
      emitProgress(onProgress, 'fetch_meta', 'done',
        'robots ' + (robotsText ? '取得' : 'なし') + ' / llms ' + (llmsText && llmsText.length > 80 ? 'あり' : 'なし'));
      emitProgress(onProgress, 'parse', 'running', '見出し・構造化データ・FAQを集計しています');
      var page = parseHtml(html);
      emitProgress(onProgress, 'parse', 'done',
        'H1 ' + page.h1.length + ' / FAQ ' + page.faqCount + '問 / schema ' + Object.keys(page.types).length + '種');
      emitProgress(onProgress, 'score', 'running', '準備度スコアを算出しています');
      var result = analyze(page, llmsText, robotsText, url.href);
      result.evidence = buildEvidence(page, llmsText, robotsText);
      result.measurementProgress = buildMeasurementProgress(result, {});
      emitProgress(onProgress, 'score', 'done', '総合 ' + result.overall + '点（公開ページ実測）');
      emitProgress(onProgress, 'themes', 'running', '対策テーマを選定しています');
      emitProgress(onProgress, 'themes', 'done', 'テーマ ' + ((result.themes && result.themes.length) || 0) + '件');
      emitProgress(onProgress, 'report', 'done', 'レポート準備完了');
      return result;
    });
  }

  window.AirReach = {
    diagnose: diagnose,
    normalizeUrl: normalizeUrl,
    ASSUMPTIONS: ASSUMPTIONS,
    buildMeasurementProgress: buildMeasurementProgress
  };
})();
