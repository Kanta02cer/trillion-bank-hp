/**
 * AirReach — client-side AI search readiness diagnosis (no API keys).
 * Scores public HTML / llms.txt / robots signals only.
 * Does NOT claim live ChatGPT / Gemini / Claude / AI Overviews citation rates.
 */
(function () {
  'use strict';

  var MAX_BYTES = 900000;

  // First-party Cloudflare Worker (ops/airreach-fetch). Prefer this over third-party proxies.
  var FIRST_PARTY_PROXY = 'https://trillion-bank-airreach-fetch.trillion-bank.workers.dev/';

  var PROXY_BUILDERS = [
    function (u) { return FIRST_PARTY_PROXY + '?url=' + encodeURIComponent(u); },
    function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); }
  ];

  function normalizeUrl(input) {
    var raw = String(input || '').trim();
    if (!raw) throw new Error('URLを入力してください。');
    if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
    var url;
    try { url = new URL(raw); } catch (e) { throw new Error('URLの形式を確認してください。'); }
    if (!/^https?:$/i.test(url.protocol)) throw new Error('httpまたはhttpsのURLのみ対応しています。');
    // Strip credentials and common sensitive query fragments before any network use
    url.username = '';
    url.password = '';
    var drop = ['token', 'access_token', 'auth', 'key', 'api_key', 'apikey', 'session', 'sig', 'signature', 'password', 'passwd'];
    drop.forEach(function (k) { url.searchParams.delete(k); });
    // Also drop params that look like secrets
    Array.from(url.searchParams.keys()).forEach(function (k) {
      if (/token|secret|auth|key|session|sig/i.test(k)) url.searchParams.delete(k);
    });
    return url;
  }

  function fetchText(url, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 15000);
    var opts = { signal: ctrl ? ctrl.signal : undefined, credentials: 'omit', mode: 'cors' };
    return fetch(url, opts).then(function (res) {
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

  function fetchWithFallbacks(targetUrl, allowProxy, allowThirdPartyProxy) {
    return fetchText(targetUrl, 10000).catch(function (directErr) {
      if (!allowProxy) {
        throw new Error('このサイトはブラウザから直接取得できません。取得代行（外部プロキシ）への同意にチェックするか、フォームからURLを送ってください。');
      }
      var chain = Promise.reject(directErr);
      var builders = allowThirdPartyProxy === false ? PROXY_BUILDERS.slice(0, 1) : PROXY_BUILDERS;
      builders.forEach(function (build) {
        chain = chain.catch(function () { return fetchText(build(targetUrl), 16000); });
      });
      return chain.catch(function () {
        throw new Error('ページを取得できませんでした。サイト側の制限か、プロキシ不通の可能性があります。フォームからご相談ください。');
      });
    });
  }

  function absUrl(base, path) {
    try { return new URL(path, base).href; } catch (e) { return null; }
  }

  function parseHtml(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var text = (doc.body && doc.body.innerText ? doc.body.innerText : '').replace(/\s+/g, ' ').trim();
    var title = (doc.querySelector('title') || {}).textContent || '';
    var h1 = Array.prototype.map.call(doc.querySelectorAll('h1'), function (n) { return n.textContent.trim(); }).filter(Boolean);
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
    return {
      title: title.trim(),
      h1: h1,
      metaDesc: metaDesc.trim(),
      canonical: canonical,
      robotsMeta: robotsMeta,
      ogTitle: ogTitle,
      types: types,
      faqCount: faqCount,
      visibleFaq: visibleFaq,
      hasContact: hasContact,
      textLen: text.length,
      htmlLen: html.length
    };
  }

  function scoreBlock(pts, max) {
    return Math.max(0, Math.min(100, Math.round((pts / max) * 100)));
  }

  function analyze(page, llmsText, robotsText, baseHref) {
    var structurePts = 0, structureMax = 12;
    if (page.title) structurePts += 2;
    if (page.h1.length === 1) structurePts += 3;
    else if (page.h1.length > 1) structurePts += 1;
    if (page.metaDesc && page.metaDesc.length >= 40) structurePts += 2;
    if (page.canonical) structurePts += 2;
    if (page.ogTitle) structurePts += 1;
    if (page.textLen > 800) structurePts += 2;

    var entityPts = 0, entityMax = 10;
    if (page.types.Organization || page.types.LocalBusiness) entityPts += 4;
    if (page.types.WebSite || page.types.WebPage) entityPts += 2;
    if (page.types.Service || page.types.Product) entityPts += 2;
    if (page.types.BreadcrumbList) entityPts += 1;
    if (page.hasContact) entityPts += 1;

    var faqPts = 0, faqMax = 8;
    if (page.types.FAQPage) faqPts += 3;
    if (page.faqCount >= 3) faqPts += 3;
    else if (page.faqCount > 0) faqPts += 1;
    if (page.visibleFaq) faqPts += 2;

    var discPts = 0, discMax = 10;
    if (llmsText && llmsText.length > 80) discPts += 4;
    if (robotsText) {
      discPts += 2;
      if (/GPTBot|ClaudeBot|PerplexityBot|Google-Extended|OAI-SearchBot/i.test(robotsText)) discPts += 2;
      if (/Disallow:\s*\/\s*$/m.test(robotsText) && !/Allow:/i.test(robotsText)) discPts -= 2;
    }
    if (page.robotsMeta.indexOf('noindex') >= 0) discPts -= 3;
    if (/sitemap/i.test(robotsText || '')) discPts += 2;

    var structure = scoreBlock(structurePts, structureMax);
    var entity = scoreBlock(entityPts, entityMax);
    var faq = scoreBlock(faqPts, faqMax);
    var discover = scoreBlock(Math.max(0, discPts), discMax);
    var overall = Math.round(structure * 0.3 + entity * 0.25 + faq * 0.2 + discover * 0.25);

    var strengths = [];
    var gaps = [];
    if (page.h1.length === 1) strengths.push('H1が1つに整理されている');
    else gaps.push('H1が無い、または複数あり主題が散っている');
    if (page.types.Organization || page.types.LocalBusiness) strengths.push('Organization系の構造化データがある');
    else gaps.push('Organization（またはLocalBusiness）の構造化データが見つからない');
    if (page.types.FAQPage && page.faqCount > 0) strengths.push('FAQPageが検出された（' + page.faqCount + '問）');
    else gaps.push('可視FAQと一致するFAQPageが弱い／無い');
    if (llmsText && llmsText.length > 80) strengths.push('llms.txt（または同等テキスト）を取得できた');
    else gaps.push('llms.txtが見つからない、または内容が薄い');
    if (page.hasContact) strengths.push('問い合わせ・相談の導線らしき文言がある');
    else gaps.push('問い合わせ導線が本文から見つけにくい');
    if (page.canonical) strengths.push('canonicalが設定されている');
    else gaps.push('canonicalが無い');

    var actions = { now: [], weeks: [], partner: [] };
    if (!page.types.Organization) actions.now.push('会社名・公式URL・ロゴを含むOrganization schemaを追加する');
    if (!(page.types.FAQPage && page.faqCount >= 3)) actions.now.push('購入前に聞かれる質問を可視FAQにし、同じ内容のFAQPageを置く');
    if (!page.metaDesc || page.metaDesc.length < 40) actions.now.push('meta descriptionを40文字以上で、サービスの対象を明確に書く');
    if (!llmsText || llmsText.length < 80) actions.weeks.push('llms.txtで主要ページ（会社・サービス・FAQ・ポリシー）への案内を置く');
    if (page.h1.length !== 1) actions.weeks.push('トップと主要LPのH1を「何のサービスか」が一瞬で分かる文言に揃える');
    actions.weeks.push('重要カテゴリ質問で競合が出る場合の公式比較軸・対象外をページ化する');
    actions.partner.push('ChatGPT / Gemini / Perplexity / AI Overviewsでの言及・引用・推薦を同条件で測定する（HackⅡ）');
    actions.partner.push('競合Win/Lossと引用URLから、優先施策を週次で更新する伴走に切り替える');
    actions.partner.push('一次情報の改修と再計測をセットにした伴走モニター枠で実装まで任せる');

    var host = '';
    try { host = new URL(baseHref).hostname; } catch (e) { host = baseHref; }
    var tone;
    if (overall >= 75) tone = '公開ページの土台は比較的整っています。次は実AI回答での出現を同条件測定し、負けている質問から直す段階です。';
    else if (overall >= 50) tone = '基本要素は一部ありますが、AIが引用・比較しやすい「定義・FAQ・エンティティ」がまだ弱い可能性があります。';
    else tone = '現状は、AI検索で候補に入りにくい公開情報設計の可能性が高いです。まず公式の定義とFAQ、組織情報を厚くするのが先です。';

    return {
      overall: overall,
      structure: structure,
      entity: entity,
      faq: faq,
      discover: discover,
      strengths: strengths,
      gaps: gaps,
      actions: actions,
      review: {
        summary: host + ' の公開ページ準備度は ' + overall + ' / 100 です。' + tone,
        strengths: strengths.slice(0, 4),
        gaps: gaps.slice(0, 5),
        conversionHint: '表示だけでなく問い合わせにつなげるには、「誰向けか／何ができるか／何をしないか／次の相談先」が同一ページで完結しているかが重要です。',
        disclaimer: 'このレビューは公開HTML等の準備度に基づく自動生成です。実際のAI回答での引用・推薦・出現率はHackⅡの測定が必要です。掲載や問い合わせ増を保証するものではありません。'
      },
      page: {
        title: page.title,
        h1: page.h1[0] || '',
        types: Object.keys(page.types).sort(),
        faqCount: page.faqCount,
        hasLlms: !!(llmsText && llmsText.length > 80),
        hasRobots: !!robotsText,
        baseHref: baseHref
      },
      modelPlaceholders: [
        { name: 'Google AI Overviews', status: '要HackⅡ測定', note: '実回答の引用率は本ツールでは取得しません' },
        { name: 'Gemini', status: '要HackⅡ測定', note: '準備度シグナルのみ反映' },
        { name: 'ChatGPT', status: '要HackⅡ測定', note: '準備度シグナルのみ反映' },
        { name: 'Claude', status: '要HackⅡ測定', note: '準備度シグナルのみ反映' },
        { name: 'Perplexity他', status: '要HackⅡ測定', note: '準備度シグナルのみ反映' }
      ]
    };
  }

  function diagnose(inputUrl, options) {
    options = options || {};
    var allowProxy = !!options.allowProxy;
    var allowThirdPartyProxy = options.allowThirdPartyProxy !== false;
    var url = normalizeUrl(inputUrl);
    var base = url.origin + '/';
    return Promise.all([
      fetchWithFallbacks(url.href, allowProxy, allowThirdPartyProxy),
      fetchWithFallbacks(absUrl(base, '/llms.txt'), allowProxy, allowThirdPartyProxy).catch(function () { return ''; }),
      fetchWithFallbacks(absUrl(base, '/robots.txt'), allowProxy, allowThirdPartyProxy).catch(function () { return ''; })
    ]).then(function (parts) {
      var html = parts[0];
      if (!html || html.length < 40) throw new Error('ページ内容を取得できませんでした。');
      return analyze(parseHtml(html), parts[1] || '', parts[2] || '', url.href);
    });
  }

  window.AirReach = { diagnose: diagnose, normalizeUrl: normalizeUrl };
})();
