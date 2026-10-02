/**
 * AirReach Tools — client-side AI search readiness diagnosis (no API keys).
 * Scores public HTML / llms.txt / robots signals only.
 * Pages are always fetched via the same-origin fetch API (/api/airreach/fetch/); the browser never contacts the target site.
 * No Cloudflare / third-party proxy.
 * Does NOT claim live ChatGPT / Gemini / Claude / AI Overviews citation rates.
 *
 * Result contract (v2):
 *  - every check has state 'ok' | 'ng' | 'unknown'. 'unknown' = could not fetch, never scored as 0.
 *  - every check carries evidence { url, finalUrl, anchor, fetchedAt, via } pointing at the page actually read.
 *  - factor scores are computed over known checks only; a factor with no known check is null.
 *  - overall is null when a required factor is null. state: 'verified' | 'partial'.
 *  - ruleVersion identifies the scoring formula; displayVersion identifies the band table
 *    (see _data/airreach_display.yml). Both are stored with the result so old scans stay comparable.
 */
(function () {
  'use strict';

  var MAX_BYTES = 900000;
  var RULE_VERSION = 'airreach-common-v1';

  // First-party fetch API (same-origin Vercel Function: api/airreach/fetch.js). No third-party proxy.
  var FIRST_PARTY_PROXY = '/api/airreach/fetch/';
  var FINAL_URL_HEADER = 'X-AirReach-Final-URL';

  var PROXY_BUILDERS = [
    { via: 'first_party_proxy', build: function (u) { return FIRST_PARTY_PROXY + '?url=' + encodeURIComponent(u); } }
  ];

  // Factor definitions. required=true: overall cannot be computed without it.
  var FACTORS = [
    { id: 'structure', label: 'ページの骨格', weight: 0.30, required: true },
    { id: 'entity', label: '会社・サービス情報', weight: 0.25, required: true },
    { id: 'faq', label: 'よくある質問', weight: 0.20, required: true },
    { id: 'discover', label: '見つけやすさ', weight: 0.25, required: false }
  ];

  function nowIso() {
    try { return new Date().toISOString(); } catch (e) { return ''; }
  }

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

  /**
   * Fetch one URL. Resolves { text, status, finalUrl } for any HTTP response
   * (404 included, so "fetched but absent" stays distinguishable from "could not fetch").
   * Rejects only on network / timeout / size errors.
   */
  function fetchText(url, timeoutMs, via, requestedUrl) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 15000);
    // same-origin API only. Never sends cookies / credentials to the target site (the browser never contacts it).
    var opts = { signal: ctrl ? ctrl.signal : undefined, credentials: 'same-origin', cache: 'no-store' };
    return fetch(url, opts).then(function (res) {
      var len = res.headers && res.headers.get ? res.headers.get('content-length') : null;
      if (len && parseInt(len, 10) > MAX_BYTES) throw new Error('応答が大きすぎます');
      var finalUrl = requestedUrl;
      var h = res.headers && res.headers.get ? res.headers.get(FINAL_URL_HEADER) : null;
      if (h) finalUrl = h;
      // 5xx and non-404/410 4xx are failures (a 400/403 body is not the page). 404/410 stay "fetched but absent".
      if (res.status >= 500 || (res.status >= 400 && res.status !== 404 && res.status !== 410)) throw new Error('HTTP ' + res.status);
      return res.text().then(function (text) {
        clearTimeout(timer);
        if (text && text.length > MAX_BYTES) throw new Error('応答が大きすぎます');
        return { text: text || '', status: res.status, finalUrl: finalUrl, via: via };
      });
    }).catch(function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  /**
   * Target pages (HTML / llms.txt / robots.txt) are always fetched through the same-origin API.
   * The browser never fetches the target site directly (no CORS attempts, no third-party proxy).
   */
  function fetchWithFallbacks(targetUrl, allowProxy) {
    if (!allowProxy) {
      return Promise.reject(new Error('サイト情報の取得（取得代行）への同意が必要です。同意にチェックして診断してください。'));
    }
    var p = PROXY_BUILDERS[0];
    return fetchText(p.build(targetUrl), 16000, p.via, targetUrl).catch(function () {
      throw new Error('ページを取得できませんでした。サイト側の制限か、取得代行の一時的な不通の可能性があります。フォームからご相談ください。');
    });
  }

  /**
   * Fetch a resource and classify it. Never rejects.
   *  state 'ok'      : 2xx/3xx with body
   *  state 'missing' : fetched, but 404/410 or empty body (=> checks become 'ng')
   *  state 'failed'  : could not fetch (=> checks become 'unknown')
   */
  function fetchResource(targetUrl, allowProxy) {
    var fetchedAt = nowIso();
    if (!targetUrl) {
      return Promise.resolve({ state: 'failed', text: '', status: null, url: targetUrl, finalUrl: null, via: null, fetchedAt: fetchedAt, error: 'URLを組み立てられませんでした' });
    }
    return fetchWithFallbacks(targetUrl, allowProxy).then(function (res) {
      var missing = res.status === 404 || res.status === 410 || !res.text;
      return {
        state: missing ? 'missing' : 'ok',
        text: missing ? '' : res.text,
        status: res.status,
        url: targetUrl,
        finalUrl: res.finalUrl || targetUrl,
        via: res.via,
        fetchedAt: fetchedAt,
        error: null
      };
    }).catch(function (err) {
      return { state: 'failed', text: '', status: null, url: targetUrl, finalUrl: null, via: null, fetchedAt: fetchedAt, error: err && err.message ? err.message : String(err) };
    });
  }

  function absUrl(base, path) {
    try { return new URL(path, base).href; } catch (e) { return null; }
  }

  function buildKeywordAuto(kwSrc) {
    if (typeof window === 'undefined' || !window.AirReachKeyword) return null;
    try {
      var k = window.AirReachKeyword.derive(kwSrc);
      // 調べそうな言葉の一覧（飲食店の付け足す言葉）。サイトに答えが書いてあるかの判定つき
      k.candidates = window.AirReachKeyword.candidates(k, kwSrc, 'restaurant', 20);
      k.shopName = window.AirReachKeyword.shopName(kwSrc);
      // 業種ごとの「調べた言葉」と一覧（診断時点では業種が未確定のため全業種分）
      if (window.AirReachKeyword.deriveAll) k.industries = window.AirReachKeyword.deriveAll(kwSrc, 20);
      k.pagesRead = (kwSrc.pages || []).map(function (p) { return p.url; });
      return k;
    } catch (e) { return null; }
  }

  // 下層ページ: 役割ごとに1枚（メニュー・アクセス/店舗情報・予約・よくある質問）、最大4枚。同じサイト内だけ
  var SUBPAGE_ROLES = [
    { key: 'menu', re: /メニュー|お品書き|料理|料金|価格|プラン|menu|price|plan/i },
    { key: 'access', re: /アクセス|地図|所在地|店舗情報|店舗案内|会社概要|医院案内|クリニック案内|access|map|shop|store|about|company/i },
    { key: 'reserve', re: /予約|\breserv(?:e|ation|ations)\b|booking/i },
    { key: 'faq', re: /よくある質問|よくあるご質問|ご質問|faq|q&a/i }
  ];
  function pickSubpages(links, baseUrl, max) {
    var base;
    try { base = new URL(baseUrl); } catch (e) { return []; }
    var chosen = [], seen = {};
    seen[base.href.replace(/#.*$/, '')] = 1;
    SUBPAGE_ROLES.forEach(function (role) {
      if (chosen.length >= (max || 4)) return;
      for (var i = 0; i < links.length; i++) {
        var l = links[i];
        if (!l.href || /^(#|mailto:|tel:|javascript:)/i.test(l.href)) continue;
        var u;
        try { u = new URL(l.href, base); } catch (e) { continue; }
        if (u.host !== base.host || !/^https?:$/.test(u.protocol)) continue;
        if (/\.(pdf|jpe?g|png|gif|webp|zip|docx?|xlsx?)$/i.test(u.pathname)) continue;
        var key = u.href.replace(/#.*$/, '');
        if (seen[key]) continue;
        if (role.re.test(l.text) || role.re.test(decodeURIComponent(u.pathname))) {
          seen[key] = 1;
          chosen.push({ role: role.key, url: key });
          return;
        }
      }
    });
    return chosen;
  }

  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(function (resolve) { setTimeout(function () { resolve({ state: 'failed', text: '', error: 'timeout' }); }, ms); })]);
  }

  function pageText(html) {
    try {
      var d = new DOMParser().parseFromString(html, 'text/html');
      if (!d.body) return '';
      Array.prototype.forEach.call(d.body.querySelectorAll('script,style,noscript,template'), function (n) { n.remove(); });
      return (d.body.textContent || '').replace(/\s+/g, ' ').trim();
    } catch (e) { return ''; }
  }

  function parseHtml(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    // 本文は script / style を除いて数える（DOMParser の innerText は script の中身も含むため）
    var cleanText = '';
    if (doc.body) {
      var bodyClone = doc.body.cloneNode(true);
      Array.prototype.forEach.call(bodyClone.querySelectorAll('script,style,noscript,template'), function (n) { n.remove(); });
      cleanText = (bodyClone.textContent || '').replace(/\s+/g, ' ').trim();
    }
    var text = cleanText;
    // 本文を JavaScript で後から表示するサイトは、取得した HTML に本文がほぼ無い
    var unreadable = cleanText.replace(/\s+/g, '').length < 300 && html.length > 20000;
    var links = Array.prototype.slice.call(doc.querySelectorAll('a[href]'), 0, 400).map(function (a) {
      return { href: a.getAttribute('href') || '', text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) };
    });
    var title = (doc.querySelector('title') || {}).textContent || '';
    var h1 = Array.prototype.map.call(doc.querySelectorAll('h1'), function (n) { return n.textContent.trim(); }).filter(Boolean);
    var metaDesc = (doc.querySelector('meta[name="description"]') || {}).content || '';
    var canonical = (doc.querySelector('link[rel="canonical"]') || {}).href || '';
    var robotsMeta = ((doc.querySelector('meta[name="robots"]') || {}).content || '').toLowerCase();
    var ogTitle = (doc.querySelector('meta[property="og:title"]') || {}).content || '';
    var ldNodes = Array.prototype.slice.call(doc.querySelectorAll('script[type="application/ld+json"]'));
    var types = {};
    var faqCount = 0;
    var ldAddress = [];
    var ldCuisine = [];
    var ldName = '';
    ldNodes.forEach(function (node) {
      try {
        var data = JSON.parse(node.textContent);
        var items = Array.isArray(data) ? data : [data];
        items.forEach(function walk(it) {
          if (!it || typeof it !== 'object') return;
          var t = it['@type'];
          if (Array.isArray(t)) t.forEach(function (x) { types[x] = true; });
          else if (typeof t === 'string') types[t] = true;
          var tList = Array.isArray(t) ? t : [t];
          if (!ldName && it.name && tList.some(function (x) { return /Restaurant|FoodEstablishment|LocalBusiness|CafeOrCoffeeShop|BarOrPub|Bakery|IceCreamShop|Store/.test(String(x || '')); })) ldName = String(it.name);
          var ad = it.address;
          if (ad && typeof ad === 'object' && !Array.isArray(ad)) {
            ['addressRegion', 'addressLocality', 'streetAddress'].forEach(function (k) { if (ad[k]) ldAddress.push(String(ad[k])); });
          } else if (typeof ad === 'string') ldAddress.push(ad);
          if (it.servesCuisine) ldCuisine = ldCuisine.concat(Array.isArray(it.servesCuisine) ? it.servesCuisine.map(String) : [String(it.servesCuisine)]);
          if (t === 'FAQPage' || (Array.isArray(t) && t.indexOf('FAQPage') >= 0)) {
            var ents = it.mainEntity || [];
            faqCount += Array.isArray(ents) ? ents.length : 0;
          }
          if (Array.isArray(it['@graph'])) it['@graph'].forEach(walk);
        });
      } catch (e) { /* ignore */ }
    });
    var faqNodes = doc.querySelectorAll('[itemtype*="FAQPage"], .faq, #faq, [aria-labelledby*="faq"]');
    var visibleFaq = faqNodes.length;
    // Only report an anchor that really exists in the fetched HTML. Never guess "#faq".
    var faqAnchor = '';
    for (var i = 0; i < faqNodes.length; i++) {
      var node = faqNodes[i];
      var idEl = node.id ? node : node.closest('[id]');
      if (idEl && idEl.id) { faqAnchor = idEl.id; break; }
    }
    var ids = Array.prototype.slice.call(doc.querySelectorAll('[id]'), 0, 300).map(function (n) { return n.id; }).filter(Boolean);
    // 「調べた言葉」の自動候補（地域＋業態）。script/style を除いた本文から作る
    var ogSiteName = (doc.querySelector('meta[property="og:site_name"]') || {}).content || '';
    // 「調べた言葉」の材料。下層ページを読んだあとに diagnose() で keywordAuto を作る
    var kwSrc = {
      title: title.trim(), ogTitle: ogTitle, metaDesc: metaDesc.trim(), text: cleanText,
      ldAddress: ldAddress, ldCuisine: ldCuisine, types: Object.keys(types), ldName: ldName, ogSiteName: ogSiteName, pages: []
    };
    var keywordAuto = buildKeywordAuto(kwSrc);
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
      faqAnchor: faqAnchor,
      ids: ids,
      hasContact: hasContact,
      textLen: text.length,
      htmlLen: html.length,
      unreadable: unreadable,
      links: links,
      kwSrc: kwSrc,
      keywordAuto: keywordAuto
    };
  }

  function scoreBlock(pts, max) {
    if (!max) return null;
    return Math.max(0, Math.min(100, Math.round((pts / max) * 100)));
  }

  function evidenceFrom(res, anchor) {
    if (!res || res.state === 'failed') {
      return { url: res ? res.url : null, finalUrl: null, anchor: '', fetchedAt: res ? res.fetchedAt : null, via: null, verified: false };
    }
    return { url: res.url, finalUrl: res.finalUrl, anchor: anchor || '', fetchedAt: res.fetchedAt, via: res.via, verified: true };
  }

  /**
   * Build one check. `known` false => state 'unknown' and no points.
   */
  function check(factor, label, tip, known, ok, pointsIfOk, max, evidence, partialPoints) {
    var state = !known ? 'unknown' : (ok ? 'ok' : 'ng');
    var points = null;
    if (known) points = ok ? pointsIfOk : (partialPoints || 0);
    return { factor: factor, label: label, tip: tip, state: state, ok: state === 'ok', known: known, points: points, max: max, evidence: evidence };
  }

  // 各チェックの判定基準（画面の文言用）。ラベル・配点は変えない
  var CHECK_CRITERIA = {
    'ページタイトルがある': { ok: 'ページタイトル（title）がある', ng: 'ページタイトル（title）が無い' },
    'H1が1つ': { ok: '主見出し（H1）がちょうど1つ', ng: '主見出し（H1）が0個か、2個以上ある' },
    '説明文（meta）が十分': { ok: '説明文（meta description）が40文字以上', ng: '説明文（meta description）が無いか、40文字未満' },
    'canonicalがある': { ok: '正規URL（canonical）の指定がある', ng: '正規URL（canonical）の指定が無い' },
    'og:titleがある': { ok: '共有用タイトル（og:title）がある', ng: '共有用タイトル（og:title）が無い' },
    '本文量がある': { ok: '本文が800文字を超える', ng: '本文が800文字以下' },
    '会社情報（Organization等）': { ok: '会社・お店の構造化データ（Organization / LocalBusiness）がある', ng: '会社・お店の構造化データ（Organization / LocalBusiness）が無い' },
    'WebSite / WebPage': { ok: 'サイト種別の構造化データ（WebSite / WebPage）がある', ng: 'サイト種別の構造化データ（WebSite / WebPage）が無い' },
    'Service / Product': { ok: 'サービス・商品の構造化データ（Service / Product）がある', ng: 'サービス・商品の構造化データ（Service / Product）が無い' },
    'BreadcrumbList': { ok: 'ページ階層の構造化データ（BreadcrumbList）がある', ng: 'ページ階層の構造化データ（BreadcrumbList）が無い' },
    '問い合わせ導線': { ok: '問い合わせ・予約・相談の案内がある', ng: '問い合わせ・予約・相談の案内が無い' },
    'FAQPageがある': { ok: 'FAQの構造化データ（FAQPage）がある', ng: 'FAQの構造化データ（FAQPage）が無い' },
    'FAQが3問以上': { ok: 'FAQが3問以上ある', ng: 'FAQが3問未満' },
    '画面上のFAQらしき領域': { ok: '画面にFAQのまとまりがある', ng: '画面にFAQのまとまりが無い' },
    'llms.txtがある': { ok: 'llms.txt が81文字以上ある', ng: 'llms.txt が無いか、80文字以下' },
    'robots.txtがある': { ok: 'robots.txt がある', ng: 'robots.txt が無い' },
    '主要AIボットの記載': { ok: 'robots.txt にAIボット（GPTBot など）の記載がある', ng: 'robots.txt にAIボット（GPTBot など）の記載が無い' },
    'sitemap案内': { ok: 'robots.txt にサイトマップの案内がある', ng: 'robots.txt にサイトマップの案内が無い' }
  };
  function criteriaText(label, ok) {
    var c = CHECK_CRITERIA[label];
    return c ? (ok ? c.ok : c.ng) : (ok ? label : '「' + label + '」を満たしていない');
  }

  function analyze(page, pageRes, llmsRes, robotsRes, baseHref) {
    var pageEv = evidenceFrom(pageRes);
    var faqEv = evidenceFrom(pageRes, page.faqAnchor);
    var llmsKnown = llmsRes.state !== 'failed';
    var robotsKnown = robotsRes.state !== 'failed';
    var llmsEv = evidenceFrom(llmsRes);
    var robotsEv = evidenceFrom(robotsRes);
    var llmsText = llmsRes.state === 'ok' ? llmsRes.text : '';
    var robotsText = robotsRes.state === 'ok' ? robotsRes.text : '';
    var aiBotRe = /GPTBot|ClaudeBot|PerplexityBot|Google-Extended|OAI-SearchBot/i;

    var checks = [
      // structure (max 12)
      check('structure', 'ページタイトルがある', '検索結果やAIが主題を読む最初の手がかりです。', true, !!page.title, 2, 2, pageEv),
      check('structure', 'H1が1つ', '主題が一目で分かる見出しが1つあるか。', !page.unreadable, page.h1.length === 1, 3, 3, pageEv, page.h1.length > 1 ? 1 : 0),
      check('structure', '説明文（meta）が十分', 'サービスの対象が短い説明で伝わるか。', true, !!(page.metaDesc && page.metaDesc.length >= 40), 2, 2, pageEv),
      check('structure', 'canonicalがある', '正規URLが明示されているか。', true, !!page.canonical, 2, 2, pageEv),
      check('structure', 'og:titleがある', 'SNS・共有時のタイトルが定義されているか。', true, !!page.ogTitle, 1, 1, pageEv),
      check('structure', '本文量がある', '案内の厚みの目安です。', !page.unreadable, page.textLen > 800, 2, 2, pageEv),
      // entity (max 10)
      check('entity', '会社情報（Organization等）', '誰のサイトかを機械が読めるか。', true, !!(page.types.Organization || page.types.LocalBusiness), 4, 4, pageEv),
      check('entity', 'WebSite / WebPage', 'サイト種別の構造化があるか。', true, !!(page.types.WebSite || page.types.WebPage), 2, 2, pageEv),
      check('entity', 'Service / Product', '何のサービスかを定義しているか。', true, !!(page.types.Service || page.types.Product), 2, 2, pageEv),
      check('entity', 'BreadcrumbList', 'ページ階層の構造化があるか。', true, !!page.types.BreadcrumbList, 1, 1, pageEv),
      check('entity', '問い合わせ導線', '相談・予約・問い合わせの文言があるか。', !page.unreadable, !!page.hasContact, 1, 1, pageEv),
      // faq (max 8)
      check('faq', 'FAQPageがある', 'FAQの構造化データがあるか。', true, !!page.types.FAQPage, 3, 3, faqEv),
      check('faq', 'FAQが3問以上', '購入前の疑問に答えられる量があるか。', true, page.faqCount >= 3, 3, 3, faqEv, page.faqCount > 0 ? 1 : 0),
      check('faq', '画面上のFAQらしき領域', '人が読めるFAQブロックがあるか。', !page.unreadable, !!page.visibleFaq, 2, 2, faqEv),
      // discover (max 10)
      check('discover', 'llms.txtがある', 'AI向けの案内ファイルがあるか。', llmsKnown, !!(llmsText && llmsText.length > 80), 4, 4, llmsEv),
      check('discover', 'robots.txtがある', 'クローラ向けの案内があるか。', robotsKnown, !!robotsText, 2, 2, robotsEv),
      check('discover', '主要AIボットの記載', 'AIボット向けの方針が書かれているか。', robotsKnown, !!(robotsText && aiBotRe.test(robotsText)), 2, 2, robotsEv),
      check('discover', 'sitemap案内', 'サイトマップへの案内があるか。', robotsKnown, !!(robotsText && /sitemap/i.test(robotsText)), 2, 2, robotsEv)
    ];

    // Penalties (applied only when the source was actually read)
    var adjustments = [];
    if (robotsKnown && robotsText && /Disallow:\s*\/\s*$/m.test(robotsText) && !/Allow:/i.test(robotsText)) {
      adjustments.push({ factor: 'discover', label: 'robots.txtが全体をDisallow', points: -2, evidence: robotsEv });
    }
    if (page.robotsMeta.indexOf('noindex') >= 0) {
      adjustments.push({ factor: 'discover', label: 'meta robotsにnoindex', points: -3, evidence: pageEv });
    }

    // Factor scores over known checks only
    var factors = {};
    FACTORS.forEach(function (f) {
      var pts = 0, max = 0, knownCount = 0, total = 0;
      checks.forEach(function (c) {
        if (c.factor !== f.id) return;
        total += 1;
        if (!c.known) return;
        knownCount += 1;
        pts += c.points || 0;
        max += c.max;
      });
      adjustments.forEach(function (a) { if (a.factor === f.id && knownCount > 0) pts += a.points; });
      var score = knownCount > 0 ? scoreBlock(Math.max(0, pts), max) : null;
      factors[f.id] = {
        id: f.id,
        label: f.label,
        weight: f.weight,
        required: f.required,
        score: score,
        state: knownCount === 0 ? 'unknown' : (knownCount < total ? 'partial' : 'verified'),
        knownChecks: knownCount,
        totalChecks: total
      };
    });

    // Overall: null when a required factor is unknown; renormalize weights over known factors otherwise
    var overall = null;
    var requiredMissing = FACTORS.some(function (f) { return f.required && factors[f.id].score == null; });
    if (!requiredMissing) {
      var sum = 0, wsum = 0;
      FACTORS.forEach(function (f) {
        var s = factors[f.id].score;
        if (s == null) return;
        sum += s * f.weight;
        wsum += f.weight;
      });
      overall = wsum > 0 ? Math.round(sum / wsum) : null;
    }
    var anyUnknown = checks.some(function (c) { return !c.known; });
    var resultState = anyUnknown ? 'partial' : 'verified';

    var strengths = [];
    var gaps = [];
    var unknowns = [];
    checks.forEach(function (c) {
      if (c.state === 'ok') strengths.push(c.label);
      else if (c.state === 'ng') gaps.push(criteriaText(c.label, false));
      else unknowns.push(c.label + '（未確認）');
    });

    var actions = { now: [], weeks: [], partner: [] };
    if (!page.types.Organization) actions.now.push('会社名・公式URL・ロゴを含むOrganization schemaを追加する');
    if (!(page.types.FAQPage && page.faqCount >= 3)) actions.now.push('購入前に聞かれる質問を可視FAQにし、同じ内容のFAQPageを置く');
    if (!page.metaDesc || page.metaDesc.length < 40) actions.now.push('meta descriptionを40文字以上で、サービスの対象を明確に書く');
    if (llmsKnown && (!llmsText || llmsText.length < 80)) actions.weeks.push('llms.txtで主要ページ（会社・サービス・FAQ・ポリシー）への案内を置く');
    if (page.h1.length !== 1) actions.weeks.push('トップと主要LPのH1を「何のサービスか」が一瞬で分かる文言に揃える');
    actions.weeks.push('サービスの対象・対象外・比較の軸を公式ページに書く');
    // AirReach Consulting (a separate measurement service) is never listed as a 対策. It lives in `referral` and is shown in its own frame.
    var referral = {
      kicker: '別のサービスの案内',
      title: 'AI上での紹介・引用まで調べたい？',
      body: 'この診断はホームページの情報整備を見るものです。AI回答での言及・引用・他社との比較まで調べたい場合は、別サービスのAirReach Consultingをご利用ください。',
      cta: 'AirReach Consultingについて相談する',
      href: '/trillionbank/meeting/?type=company&from=airreach-referral',
      note: '対策とは別枠の案内です。診断の点数には影響しません。'
    };

    var host = '';
    try { host = new URL(baseHref).hostname; } catch (e) { host = baseHref; }
    var display = window.AirReachDisplay || null;
    var bandKey = display ? display.band(overall).key : null;
    var tone;
    if (overall == null) tone = '未取得の項目があるため、総合点は出していません。取得できた項目だけを表示しています。';
    else if (!display) tone = '項目ごとの点数と不足を確認してください。';
    else if (bandKey === 'high') tone = 'ホームページの情報整備はひととおり揃っています。残っている不足項目を個別に確認してください。';
    else if (bandKey === 'mid') tone = '基本的な情報は載っていますが、定義・よくある質問・会社情報に足りない項目があります。';
    else tone = 'ホームページの情報整備は「要対策」の区分です。まず会社・お店の情報、よくある質問、サービスの説明を補うのが先です。';
    var summary = overall == null
      ? host + ' のホームページ情報整備は未確認です。' + tone
      : host + ' のホームページ情報整備は ' + overall + ' / 100 です。' + tone;

    return {
      ruleVersion: RULE_VERSION,
      displayVersion: display ? display.version : null,
      state: resultState,
      fetchedAt: pageRes.fetchedAt || nowIso(),
      overall: overall,
      structure: factors.structure.score,
      entity: factors.entity.score,
      faq: factors.faq.score,
      discover: factors.discover.score,
      factors: factors,
      strengths: strengths,
      gaps: gaps,
      unknowns: unknowns,
      checks: checks,
      adjustments: adjustments,
      actions: actions,
      referral: referral,
      evidence: {
        page: evidenceFrom(pageRes),
        llms: Object.assign(evidenceFrom(llmsRes), { state: llmsRes.state, status: llmsRes.status, error: llmsRes.error }),
        robots: Object.assign(evidenceFrom(robotsRes), { state: robotsRes.state, status: robotsRes.status, error: robotsRes.error })
      },
      review: {
        summary: summary,
        strengths: strengths.slice(0, 4),
        gaps: gaps.slice(0, 5),
        unknowns: unknowns.slice(0, 4),
        conversionHint: '表示だけでなく問い合わせにつなげるには、「誰向けか／何ができるか／何をしないか／次の相談先」が同一ページで完結しているかが重要です。',
        disclaimer: 'このレビューは公開HTML等の情報整備に基づく自動生成です。AI回答での引用・紹介・順位・予約数は測っておらず、掲載や問い合わせ増を保証するものではありません。'
      },
      page: {
        title: page.title,
        h1: page.h1[0] || '',
        types: Object.keys(page.types).sort(),
        faqCount: page.faqCount,
        faqAnchor: page.faqAnchor,
        hasLlms: llmsKnown ? !!(llmsText && llmsText.length > 80) : null,
        hasRobots: robotsKnown ? !!robotsText : null,
        baseHref: baseHref,
        finalUrl: pageRes.finalUrl || baseHref,
        keywordAuto: page.keywordAuto || null,
        unreadable: !!page.unreadable
      },
      modelPlaceholders: [
        { name: 'Google AI Overviews', status: '要AirReach Consulting測定', note: '実回答の引用率は本ツールでは取得しません' },
        { name: 'Gemini', status: '要AirReach Consulting測定', note: '準備度シグナルのみ反映' },
        { name: 'ChatGPT', status: '要AirReach Consulting測定', note: '準備度シグナルのみ反映' },
        { name: 'Claude', status: '要AirReach Consulting測定', note: '準備度シグナルのみ反映' },
        { name: 'Perplexity他', status: '要AirReach Consulting測定', note: '準備度シグナルのみ反映' }
      ]
    };
  }

  function diagnose(inputUrl, options) {
    options = options || {};
    var allowProxy = !!options.allowProxy;
    var url = normalizeUrl(inputUrl);
    var base = url.origin + '/';
    return Promise.all([
      fetchResource(url.href, allowProxy),
      fetchResource(absUrl(base, '/llms.txt'), allowProxy),
      fetchResource(absUrl(base, '/robots.txt'), allowProxy)
    ]).then(function (parts) {
      var pageRes = parts[0];
      if (pageRes.state === 'failed') throw new Error(pageRes.error || 'ページを取得できませんでした。');
      if (pageRes.state === 'missing') throw new Error('ページが見つかりませんでした（HTTP ' + (pageRes.status || '—') + '）。URLを確認してください。');
      if (!pageRes.text || pageRes.text.length < 40) throw new Error('ページ内容を取得できませんでした。');
      var parsed = parseHtml(pageRes.text);
      var subs = options.subpages === false ? [] : pickSubpages(parsed.links || [], pageRes.finalUrl || url.href, 4);
      // 下層ページは「調べた言葉」と「答えが書いてあるか」にだけ使う（点数の計算には使わない）
      return Promise.all(subs.map(function (sp) {
        return withTimeout(fetchResource(sp.url, allowProxy), 6000).then(function (r) {
          return r && r.state === 'ok' && r.text ? { url: sp.url, role: sp.role, text: pageText(r.text).slice(0, 15000) } : null;
        }).catch(function () { return null; });
      })).then(function (pages) {
        parsed.kwSrc.pages = pages.filter(function (x) { return x && x.text; });
        parsed.keywordAuto = buildKeywordAuto(parsed.kwSrc);
        return analyze(parsed, pageRes, parts[1], parts[2], url.href);
      });
    });
  }

  window.AirReach = { checkCriteria: criteriaText, diagnose: diagnose, normalizeUrl: normalizeUrl, RULE_VERSION: RULE_VERSION, FACTORS: FACTORS };
})();
