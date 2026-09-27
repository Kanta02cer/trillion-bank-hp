/**
 * AirReach — client-side AI search readiness diagnosis (no API keys).
 * Scores public HTML / llms.txt / robots signals only.
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

  // First-party Cloudflare Worker (ops/airreach-fetch). Prefer this over third-party proxies.
  var FIRST_PARTY_PROXY = 'https://trillion-bank-airreach-fetch.trillion-bank.workers.dev/';
  var FINAL_URL_HEADER = 'X-AirReach-Final-URL';

  var PROXY_BUILDERS = [
    { via: 'first_party_proxy', build: function (u) { return FIRST_PARTY_PROXY + '?url=' + encodeURIComponent(u); } },
    { via: 'third_party_proxy', build: function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); } }
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
    var opts = { signal: ctrl ? ctrl.signal : undefined, credentials: 'omit', mode: 'cors' };
    return fetch(url, opts).then(function (res) {
      var len = res.headers && res.headers.get ? res.headers.get('content-length') : null;
      if (len && parseInt(len, 10) > MAX_BYTES) throw new Error('応答が大きすぎます');
      var finalUrl = requestedUrl;
      if (via === 'direct') {
        finalUrl = res.url || requestedUrl;
      } else if (via === 'first_party_proxy') {
        // Needs Access-Control-Expose-Headers on the Worker; falls back to the requested URL.
        var h = res.headers && res.headers.get ? res.headers.get(FINAL_URL_HEADER) : null;
        if (h) finalUrl = h;
      }
      if (res.status >= 500) throw new Error('HTTP ' + res.status);
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

  function fetchWithFallbacks(targetUrl, allowProxy) {
    return fetchText(targetUrl, 10000, 'direct', targetUrl).catch(function (directErr) {
      if (!allowProxy) {
        throw new Error('このサイトはブラウザから直接取得できません。取得代行（外部プロキシ）への同意にチェックするか、フォームからURLを送ってください。');
      }
      var chain = Promise.reject(directErr);
      PROXY_BUILDERS.forEach(function (p) {
        chain = chain.catch(function () { return fetchText(p.build(targetUrl), 16000, p.via, targetUrl); });
      });
      return chain.catch(function () {
        throw new Error('ページを取得できませんでした。サイト側の制限か、プロキシ不通の可能性があります。フォームからご相談ください。');
      });
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
      htmlLen: html.length
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
      check('structure', 'H1が1つ', '主題が一目で分かる見出しが1つあるか。', true, page.h1.length === 1, 3, 3, pageEv, page.h1.length > 1 ? 1 : 0),
      check('structure', '説明文（meta）が十分', 'サービスの対象が短い説明で伝わるか。', true, !!(page.metaDesc && page.metaDesc.length >= 40), 2, 2, pageEv),
      check('structure', 'canonicalがある', '正規URLが明示されているか。', true, !!page.canonical, 2, 2, pageEv),
      check('structure', 'og:titleがある', 'SNS・共有時のタイトルが定義されているか。', true, !!page.ogTitle, 1, 1, pageEv),
      check('structure', '本文量がある', '案内の厚みの目安です。', true, page.textLen > 800, 2, 2, pageEv),
      // entity (max 10)
      check('entity', '会社情報（Organization等）', '誰のサイトかを機械が読めるか。', true, !!(page.types.Organization || page.types.LocalBusiness), 4, 4, pageEv),
      check('entity', 'WebSite / WebPage', 'サイト種別の構造化があるか。', true, !!(page.types.WebSite || page.types.WebPage), 2, 2, pageEv),
      check('entity', 'Service / Product', '何のサービスかを定義しているか。', true, !!(page.types.Service || page.types.Product), 2, 2, pageEv),
      check('entity', 'BreadcrumbList', 'ページ階層の構造化があるか。', true, !!page.types.BreadcrumbList, 1, 1, pageEv),
      check('entity', '問い合わせ導線', '相談・予約・問い合わせの文言があるか。', true, !!page.hasContact, 1, 1, pageEv),
      // faq (max 8)
      check('faq', 'FAQPageがある', 'FAQの構造化データがあるか。', true, !!page.types.FAQPage, 3, 3, faqEv),
      check('faq', 'FAQが3問以上', '購入前の疑問に答えられる量があるか。', true, page.faqCount >= 3, 3, 3, faqEv, page.faqCount > 0 ? 1 : 0),
      check('faq', '画面上のFAQらしき領域', '人が読めるFAQブロックがあるか。', true, !!page.visibleFaq, 2, 2, faqEv),
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
      else if (c.state === 'ng') gaps.push(c.label + 'がない／弱い');
      else unknowns.push(c.label + '（未確認）');
    });

    var actions = { now: [], weeks: [], partner: [] };
    if (!page.types.Organization) actions.now.push('会社名・公式URL・ロゴを含むOrganization schemaを追加する');
    if (!(page.types.FAQPage && page.faqCount >= 3)) actions.now.push('購入前に聞かれる質問を可視FAQにし、同じ内容のFAQPageを置く');
    if (!page.metaDesc || page.metaDesc.length < 40) actions.now.push('meta descriptionを40文字以上で、サービスの対象を明確に書く');
    if (llmsKnown && (!llmsText || llmsText.length < 80)) actions.weeks.push('llms.txtで主要ページ（会社・サービス・FAQ・ポリシー）への案内を置く');
    if (page.h1.length !== 1) actions.weeks.push('トップと主要LPのH1を「何のサービスか」が一瞬で分かる文言に揃える');
    actions.weeks.push('重要カテゴリ質問で競合が出る場合の公式比較軸・対象外をページ化する');
    actions.partner.push('ChatGPT / Gemini / Perplexity / AI Overviewsでの言及・引用・推薦を同条件で測定する（HackⅡ）');
    actions.partner.push('競合Win/Lossと引用URLから、優先施策を週次で更新する伴走に切り替える');
    actions.partner.push('一次情報の改修と再計測をセットにした伴走モニター枠で実装まで任せる');

    var host = '';
    try { host = new URL(baseHref).hostname; } catch (e) { host = baseHref; }
    var display = window.AirReachDisplay || null;
    var bandKey = display ? display.band(overall).key : null;
    var tone;
    if (overall == null) tone = '未取得の項目があるため、総合点は出していません。取得できた項目だけを表示しています。';
    else if (!display) tone = '項目ごとの点数と不足を確認してください。';
    else if (bandKey === 'high') tone = '公開ページの土台は比較的整っています。次は実AI回答での出現を同条件測定し、負けている質問から直す段階です。';
    else if (bandKey === 'mid') tone = '基本要素は一部ありますが、AIが引用・比較しやすい「定義・FAQ・エンティティ」がまだ弱い可能性があります。';
    else tone = '公開情報の整備がまだ薄い状態です。まず公式の定義とFAQ、組織情報を厚くするのが先です。';
    var summary = overall == null
      ? host + ' の公開ページ準備度は未確認です。' + tone
      : host + ' の公開ページ準備度は ' + overall + ' / 100 です。' + tone;

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
        disclaimer: 'このレビューは公開HTML等の準備度に基づく自動生成です。実際のAI回答での引用・推薦・出現率はHackⅡの測定が必要です。掲載や問い合わせ増を保証するものではありません。'
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
        finalUrl: pageRes.finalUrl || baseHref
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
      return analyze(parseHtml(pageRes.text), pageRes, parts[1], parts[2], url.href);
    });
  }

  window.AirReach = { diagnose: diagnose, normalizeUrl: normalizeUrl, RULE_VERSION: RULE_VERSION, FACTORS: FACTORS };
})();
