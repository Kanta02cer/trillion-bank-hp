/**
 * ④ 入れたか確かめる：公開ページと llms.txt を読み、採用したパッチ（ZIP を作ったときの中身）と同じものが、見える形で入っているかを判定する。
 *   取得は公開ページの取得口（/api/airreach/fetch。私的なアドレスは断る）を使う。ページは保存しない（証跡として HTML の SHA-256 だけ残す）。
 *
 *   判定の考え方（2026-10-09 の見直し）
 *     - よくある質問は、承認した質問と答えの「全文」が、見える本文にあるか。先頭だけの一致・非表示の要素の中の文は合格にしない
 *     - 「見える」は、ページを描画した結果（rendered：スクリプトは動かさずに描画した文字）で確かめる。描画で確かめられないとき
 *       （ブラウザの外・スタイルを読めなかった）は、HTML にあっても「要確認」にして合格にしない
 *     - 構造化データは、質問ごとに acceptedAnswer の全文まで照合する。会社・お店の名前が違う（主体の不一致）は不合格
 *     - 採用したものだけを照合する（パッチに無い FAQ・会社の情報・llms.txt は求めない）。記事（Article・NewsArticle）を採用したパッチは、
 *       見出し・著者・発行者まで照合する
 *     - 分かるのは「サイトに入ったか」まで。Google が読んだか（収録）・AI の答えが変わったかは別
 *   state: ok（入っている）／review（要確認）／ng（入っていない・違う）／warn（確かめてほしいが合否には影響しない）／skip（対象外）
 */
(function (root) {
  'use strict';
  function dec(t) { return String(t || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(Number(n)); }); }
  function norm(t) { return dec(t).replace(/<[^>]+>/g, ' ').replace(/[\s　]+/g, '').toLowerCase(); }
  var VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
  /** 開始タグが、描画しなくても分かる「隠す」指定か（hidden・aria-hidden・style の display:none / visibility:hidden・template） */
  function hiddenTag(name, attrs) {
    if (/^(template|script|style|noscript|head|title)$/i.test(name)) return true;
    if (/(^|\s)hidden(\s|=|$)/i.test(attrs)) return true;
    if (/aria-hidden\s*=\s*["']?true/i.test(attrs)) return true;
    var st = /style\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
    if (st && /(display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden)/i.test(st[2] || st[3] || '')) return true;
    return false;
  }
  /**
   * HTML を文字にする。隠す指定の要素の中の文字は visible に入れず hidden に分ける（描画しない静的な判定。CSS のクラスで隠したものは分からない）
   */
  function splitText(html) {
    var re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)([^>]*)>|([^<]+)/g, m, vis = [], hid = [], stack = [], hiddenDepth = 0;
    html = String(html || '');
    while ((m = re.exec(html))) {
      if (m[4] != null) { (hiddenDepth ? hid : vis).push(m[4]); continue; }
      if (!m[2]) continue;
      var name = m[2].toLowerCase(), close = m[1] === '/', attrs = m[3] || '';
      if (VOID.test(name) || /\/\s*$/.test(attrs)) { if (!close) (hiddenDepth ? hid : vis).push(' '); continue; }
      if (!close) {
        var h = hiddenTag(name, attrs);
        stack.push({ name: name, hidden: h });
        if (h) hiddenDepth += 1;
        // script・style の中身はタグとして読まずに飛ばす
        if (/^(script|style)$/i.test(name)) { var end = html.toLowerCase().indexOf('</' + name, re.lastIndex); if (end < 0) end = html.length; re.lastIndex = end; }
        (hiddenDepth ? hid : vis).push(' ');
      } else {
        for (var k = stack.length - 1; k >= 0; k--) {
          if (stack[k].name === name) { for (var z = stack.length - 1; z >= k; z--) { if (stack[z].hidden) hiddenDepth -= 1; } stack.length = k; break; }
        }
        (hiddenDepth ? hid : vis).push(' ');
      }
    }
    return { visible: dec(vis.join('')), hidden: dec(hid.join('')) };
  }
  /** ページの見える文字（静的に分かる範囲。script・style・隠す指定の要素を除く） */
  function visibleText(html) { return splitText(html).visible; }
  /** ページの JSON-LD を全部読む（@graph の中も平らにする）。読めないブロックは数だけ数える */
  function jsonLd(html) {
    var out = [], broken = 0, re = /<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi, m;
    while ((m = re.exec(String(html || '')))) {
      try {
        var j = JSON.parse(m[1].trim());
        (Array.isArray(j) ? j : [j]).forEach(function (x) { if (x && Array.isArray(x['@graph'])) x['@graph'].forEach(function (g) { out.push(g); }); else if (x) out.push(x); });
      } catch (e) { broken += 1; }
    }
    return { items: out, broken: broken };
  }
  function types(x) { var t = x && x['@type']; return (Array.isArray(t) ? t : [t]).filter(Boolean).map(String); }
  var ORG = /^(Organization|Corporation|NewsMediaOrganization|LocalBusiness|Restaurant|Store|HairSalon|BeautySalon|DaySpa|MedicalClinic|Dentist|Physician|LegalService|ProfessionalService|HomeAndConstructionBusiness|GeneralContractor|AutomotiveBusiness|FoodEstablishment|CafeOrCoffeeShop|BarOrPub|Hotel|LodgingBusiness)$/;
  var ARTICLE = /^(Article|NewsArticle|BlogPosting|Report)$/;
  function parse(s) { try { return JSON.parse(s || ''); } catch (e) { return null; } }
  function nameOf(x) { if (!x) return ''; if (typeof x === 'string') return x; if (Array.isArray(x)) return x.map(nameOf).join('・'); return String(x.name || ''); }
  function flat(j) { var out = []; (Array.isArray(j) ? j : [j]).forEach(function (x) { if (x && Array.isArray(x['@graph'])) x['@graph'].forEach(function (g) { out.push(g); }); else if (x) out.push(x); }); return out; }

  /**
   * 採用したパッチの中身：正式な ZIP を作ったときの記録（job.zipped）を優先し、無ければいまの承認の内容。
   *   { faq: [{q,a}], org: 名前 or null, llms: 文 or null, articles: [{type, headline, author, publisher}] }
   */
  function adopted(job) {
    var files = (job && job.files) || {}, snap = job && job.zipped && !job.zipped.draft ? job.zipped : null;
    var faq = parse(files['schema/faq.jsonld']), org = parse(files['schema/organization.jsonld']);
    var articles = [];
    Object.keys(files).filter(function (k) { return /^schema\/.+\.jsonld$/.test(k); }).forEach(function (k) {
      flat(parse(files[k])).forEach(function (x) { var ty = types(x).filter(function (t) { return ARTICLE.test(t); })[0]; if (ty) articles.push({ type: ty, headline: String(x.headline || x.name || ''), author: nameOf(x.author), publisher: nameOf(x.publisher) }); });
    });
    if (snap) {
      return { faq: Array.isArray(snap.faq) ? snap.faq.slice() : [], org: snap.org_name ? snap.org_name : null, llms: snap.llms ? snap.llms : null,
        articles: Array.isArray(snap.articles) ? snap.articles.slice() : articles, version: snap.version || '', zipped: true };
    }
    return { faq: faq && Array.isArray(faq.mainEntity) ? faq.mainEntity.map(function (x) { return { q: String(x.name || ''), a: String((x.acceptedAnswer && x.acceptedAnswer.text) || '') }; }) : [],
      org: org && org.name ? String(org.name) : null, llms: files['public/llms.txt'] || null, articles: articles, version: '', zipped: false };
  }

  /**
   * job：Studio の分析。page：{ url, status, html }。llms：{ url, status, text }（無ければ null）。
   * rendered：{ text, complete, method }（ページを描画して読んだ見える文字。無ければ null＝描画で確かめていない）
   * extras：[{ url, status, html }]（会社の情報をトップページなど別のページに入れたときの、そのページ。無ければ []）
   * 戻り値：{ checks: [{ key, label, state, detail }], state: ok|review|ng, ok }
   */
  function judge(job, page, llms, rendered, extras) {
    var want = adopted(job), checks = [];
    if (!page || page.status !== 200 || !page.html) {
      checks.push({ key: 'page', label: 'ページを読めた', state: 'ng', detail: page && page.status ? 'ページを読めませんでした（' + page.status + '）。URL を確かめてください' : 'ページを読めませんでした' });
      return { checks: checks, state: 'ng', ok: false };
    }
    var parts = splitText(page.html), staticText = norm(parts.visible), hiddenText = norm(parts.hidden), ld = jsonLd(page.html);
    var seen = rendered && rendered.complete && typeof rendered.text === 'string' ? norm(rendered.text) : null;
    // 1. 承認した FAQ の全文が見える本文にあるか
    if (!want.faq.length) checks.push({ key: 'faq_text', label: '承認したよくある質問がページに見える', state: 'skip', detail: '採用したパッチに、承認したよくある質問がありません' });
    else {
      var res = want.faq.map(function (x) {
        var q = norm(x.q), a = norm(x.a);
        var inStatic = staticText.indexOf(q) >= 0 && staticText.indexOf(a) >= 0, inHidden = !inStatic && (hiddenText.indexOf(a) >= 0 || hiddenText.indexOf(q) >= 0);
        var pre = a.slice(0, Math.max(6, Math.min(40, Math.floor(a.length / 2))));
        // 質問はあり、答えの前の方だけ一致する＝答えの文が承認と違う（後半を変えた・書き足した など）
        var head = !inStatic && staticText.indexOf(q) >= 0 && a.length > 6 && staticText.indexOf(pre) >= 0;
        if (seen != null) {
          if (seen.indexOf(q) >= 0 && seen.indexOf(a) >= 0) return { x: x, s: 'ok' };
          return { x: x, s: 'ng', why: (inStatic || inHidden) ? '画面には見えていません（隠れている）' : head ? '答えの後半が承認と違います' : 'ページにありません' };
        }
        if (inStatic) return { x: x, s: 'review', why: 'HTML にはありますが、画面に見えるかは描画で確かめられていません' };
        return { x: x, s: 'ng', why: inHidden ? '隠れた要素の中にだけあります' : head ? '答えの後半が承認と違います' : 'ページにありません' };
      });
      var nOk = res.filter(function (r) { return r.s === 'ok'; }).length, bad = res.filter(function (r) { return r.s === 'ng'; }), rev = res.filter(function (r) { return r.s === 'review'; });
      checks.push({ key: 'faq_text', label: '承認したよくある質問がページに見える（質問と答えの全文）', state: bad.length ? 'ng' : rev.length ? 'review' : 'ok',
        detail: (seen != null ? '見える ' + nOk : '描画で確かめた 0') + ' / ' + want.faq.length + '問' +
          (bad.length ? '。' + bad.map(function (r) { return '「' + r.x.q + '」' + r.why; }).join('・') : '') +
          (rev.length ? '。' + (rev.length === want.faq.length ? '' : rev.length + '問は') + 'HTML にはありますが、画面に見えるかは確かめられていません（Studio の「確かめる」で描画して確かめます）' : '') });
    }
    // 2. よくある質問の構造化データ：質問ごとに acceptedAnswer の全文まで
    var faqPages = ld.items.filter(function (x) { return types(x).indexOf('FAQPage') >= 0; });
    if (!want.faq.length) checks.push({ key: 'faq_ld', label: 'よくある質問の構造化データ', state: 'skip', detail: '採用したパッチに入れていません' });
    else if (!faqPages.length) checks.push({ key: 'faq_ld', label: 'よくある質問の構造化データ', state: 'ng', detail: 'ページに FAQPage のデータがありません' });
    else {
      var qa = {}; faqPages.forEach(function (fp) { (Array.isArray(fp.mainEntity) ? fp.mainEntity : [fp.mainEntity]).forEach(function (q) { if (q) qa[norm(q.name)] = norm(q.acceptedAnswer && (Array.isArray(q.acceptedAnswer) ? q.acceptedAnswer[0] && q.acceptedAnswer[0].text : q.acceptedAnswer.text)); }); });
      var lack = want.faq.filter(function (x) { return !(norm(x.q) in qa); });
      var diff = want.faq.filter(function (x) { return (norm(x.q) in qa) && qa[norm(x.q)] !== norm(x.a); });
      checks.push({ key: 'faq_ld', label: 'よくある質問の構造化データ（質問と acceptedAnswer の全文）', state: lack.length || diff.length ? 'ng' : (faqPages.length > 1 ? 'warn' : 'ok'),
        detail: lack.length || diff.length ? (lack.length ? lack.length + '問がデータにありません' : '') + (lack.length && diff.length ? '・' : '') + (diff.length ? diff.length + '問は答えが承認と違います（' + diff.map(function (x) { return '「' + x.q + '」'; }).join('・') + '）' : '')
          : (faqPages.length > 1 ? 'FAQPage が ' + faqPages.length + 'つあります（1つにまとめてください）' : '採用したパッチと同じ ' + want.faq.length + '問') });
    }
    // 3. 会社・お店の情報のデータ：採用したときだけ。名前が違う（主体の不一致）は不合格。
    //    このページに無いときは、別に確かめたページ（extras：トップページなど）で探す。どこでも確かめられなければ「要確認」（合格にしない）
    var isOrg = function (x) { return types(x).some(function (t) { return ORG.test(t); }); };
    var orgs = ld.items.filter(isOrg), orgFrom = page.url || '';
    var ex = (extras || []).filter(Boolean), exOk = ex.filter(function (e) { return e.status === 200 && e.html; });
    if (!orgs.length) exOk.some(function (e) { var o = jsonLd(e.html).items.filter(isOrg); if (o.length) { orgs = o; orgFrom = e.url || ''; } return o.length > 0; });
    var exBad = ex.filter(function (e) { return !(e.status === 200 && e.html); });
    var match = function (o) { return want.org && (norm(o.name) === norm(want.org) || [].concat(o.alternateName || []).some(function (a) { return norm(a) === norm(want.org); })); };
    if (!want.org) checks.push({ key: 'org', label: '会社・お店の情報のデータ', state: 'skip', detail: '採用したパッチに入れていません' });
    else if (!orgs.length) checks.push({ key: 'org', label: '会社・お店の情報のデータ', state: 'review',
      detail: (exBad.length ? '会社の情報を入れたページを読めませんでした（' + exBad.map(function (e) { return e.url + (e.status ? '・' + e.status : ''); }).join('、') + '）。' : ex.length ? '確かめたページのどれにもありません。' : 'このページにはありません。') +
        '入れたページ（トップページなど）の URL を「会社の情報を入れたページ」に入れて確かめるまで、要確認です' });
    else if (!orgs.some(match)) checks.push({ key: 'org', label: '会社・お店の情報のデータ', state: 'ng', detail: '名前が採用したパッチと違います（ページ：' + orgs.map(function (o) { return o.name || '（なし）'; }).join('・') + '／パッチ：' + want.org + '）。別の会社・お店として読まれます' });
    else if (orgs.length > 1) checks.push({ key: 'org', label: '会社・お店の情報のデータ', state: 'warn', detail: orgs.length + 'つあります。テーマやプラグインと二重になっていないか確かめてください（手順書の 2-2）' });
    else checks.push({ key: 'org', label: '会社・お店の情報のデータ', state: 'ok', detail: '名前：' + orgs[0].name + (orgFrom && orgFrom !== page.url ? '（' + orgFrom + ' で確かめた）' : '') });
    // 4. 記事（Article・NewsArticle など）：採用したときだけ。見出し・著者・発行者
    if (want.articles.length) {
      var pageArts = ld.items.filter(function (x) { return types(x).some(function (t) { return ARTICLE.test(t); }); });
      var probs = [];
      want.articles.forEach(function (w) {
        var hit = pageArts.filter(function (x) { return norm(x.headline || x.name) === norm(w.headline); })[0];
        if (!hit) { probs.push('「' + w.headline + '」の記事のデータがありません'); return; }
        if (types(hit).indexOf(w.type) < 0) probs.push('「' + w.headline + '」の種類が違います（' + types(hit).join('・') + '／パッチ：' + w.type + '）');
        if (w.author && norm(nameOf(hit.author)) !== norm(w.author)) probs.push('「' + w.headline + '」の著者が違います');
        if (w.publisher && norm(nameOf(hit.publisher)) !== norm(w.publisher)) probs.push('「' + w.headline + '」の発行者が違います（主体の不一致）');
      });
      checks.push({ key: 'article', label: '記事のデータ（見出し・著者・発行者）', state: probs.length ? 'ng' : 'ok', detail: probs.length ? probs.join('・') : '採用したパッチと同じ ' + want.articles.length + '件' });
    }
    if (ld.broken) checks.push({ key: 'ld_broken', label: '読めない構造化データ', state: 'ng', detail: ld.broken + 'つのデータが JSON として読めません（貼るときに崩れた可能性）' });
    // 5. AI 向けの案内ファイル：採用したときだけ
    if (!want.llms) checks.push({ key: 'llms', label: 'AI 向けの案内ファイル（llms.txt）', state: 'skip', detail: '採用したパッチに入れていません' });
    else if (!llms || llms.status !== 200) checks.push({ key: 'llms', label: 'AI 向けの案内ファイル（llms.txt）', state: 'ng', detail: '開けませんでした' + (llms && llms.status ? '（' + llms.status + '）' : '') + '。サイトの一番上に置いてください' });
    else checks.push({ key: 'llms', label: 'AI 向けの案内ファイル（llms.txt）', state: norm(llms.text) === norm(want.llms) ? 'ok' : 'warn', detail: norm(llms.text) === norm(want.llms) ? 'パッチと同じ' : '開けますが、パッチと中身が違います' });
    var st = checks.some(function (c) { return c.state === 'ng'; }) ? 'ng' : checks.some(function (c) { return c.state === 'review'; }) ? 'review' : 'ok';
    return { checks: checks, state: st, ok: st === 'ok' };
  }

  /**
   * ページを描画して、見える文字を読む（ブラウザの中だけ）。スクリプトは動かさない（sandbox）。
   *   スタイルを読めなかったときは complete=false（見えるかを確かめきれない＝要確認）
   */
  function renderVisible(html, baseUrl) {
    if (typeof document === 'undefined' || !document.body) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var f = document.createElement('iframe'), done = false;
      f.setAttribute('sandbox', 'allow-same-origin');
      f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
      f.style.cssText = 'position:fixed;left:-20000px;top:0;width:1280px;height:2000px;border:0;visibility:visible';
      var base = '<base href="' + String(baseUrl || '').replace(/"/g, '&quot;') + '">';
      var src = String(html || '');
      src = /<head[^>]*>/i.test(src) ? src.replace(/<head([^>]*)>/i, '<head$1>' + base) : base + src;
      function finish(v) { if (done) return; done = true; try { f.remove(); } catch (e) {} resolve(v); }
      var timer = setTimeout(function () { read(true); }, 10000);
      function read(timedOut) {
        try {
          var d = f.contentDocument, links = Array.prototype.slice.call(d.querySelectorAll('link[rel~="stylesheet"]'));
          var failed = links.filter(function (l) { return !l.sheet; }).length;
          finish({ text: (d.body && d.body.innerText) || '', complete: !timedOut && failed === 0, method: 'iframe-sandbox-noscript', stylesheets: links.length, failedStylesheets: failed });
        } catch (e) { finish(null); }
      }
      f.addEventListener('load', function () { clearTimeout(timer); setTimeout(function () { read(false); }, 300); });
      f.srcdoc = src;
      document.body.appendChild(f);
    });
  }
  function sha256(text) {
    var c = root.crypto;
    if (!c || !c.subtle || typeof TextEncoder === 'undefined') return Promise.resolve('');
    return c.subtle.digest('SHA-256', new TextEncoder().encode(String(text || ''))).then(function (buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); });
  }

  /** 公開ページの取得口で読む（ブラウザから）。戻り値 { url, status, html|text, finalUrl } */
  function fetchDoc(url) {
    return fetch('/api/airreach/fetch?url=' + encodeURIComponent(url), { headers: { Accept: 'text/html,text/plain,*/*' } })
      .then(function (r) { return r.text().then(function (t) { return { url: url, status: r.status, body: t, finalUrl: r.headers.get('X-AirReach-Final-URL') || url }; }); });
  }
  /**
   * ページと llms.txt を読み、描画して判定し、分析（job.verified）に残す。
   *   証跡：確かめた日時・URL（最後の URL）・採用したパッチの版と記録日時・ページの HTML の SHA-256・描画で確かめたか
   *   パッチの版や ZIP が変わったら、前の確認は使わない（airreach-case-steps.js が版と日時で見分ける）
   */
  function run(job, pageUrl, opts) {
    opts = opts || {};
    var origin = ''; try { origin = new URL(pageUrl).origin; } catch (e) {}
    // 会社の情報を別のページ（トップページなど）に入れたときは、そのページも読む
    var orgUrl = opts.orgUrl && opts.orgUrl !== pageUrl ? opts.orgUrl : '';
    return Promise.all([fetchDoc(pageUrl), origin ? fetchDoc(origin + '/llms.txt').catch(function () { return null; }) : Promise.resolve(null),
      orgUrl ? fetchDoc(orgUrl).catch(function () { return { url: orgUrl, status: 0, body: '' }; }) : Promise.resolve(null)]).then(function (rs) {
      var html = rs[0].status === 200 ? rs[0].body : '';
      var extras = rs[2] ? [{ url: orgUrl, status: rs[2].status, html: rs[2].status === 200 ? rs[2].body : '', finalUrl: rs[2].finalUrl || orgUrl }] : [];
      return Promise.all([html ? renderVisible(html, rs[0].finalUrl || pageUrl) : Promise.resolve(null), sha256(html), extras.length ? sha256(extras[0].html) : Promise.resolve('')]).then(function (x) {
        var res = judge(job, { url: pageUrl, status: rs[0].status, html: rs[0].body }, rs[1] ? { url: rs[1].url, status: rs[1].status, text: rs[1].body } : null, x[0], extras);
        var mf = parse((job.files || {})['MANIFEST.json']) || {}, z = job.zipped && !job.zipped.draft ? job.zipped : null;
        job.verified = { at: new Date().toISOString(), url: pageUrl, final_url: rs[0].finalUrl || pageUrl, ok: res.ok, state: res.state,
          version: z ? (z.version || '') : (mf.package_version || ''), zipped_at: z ? z.at : null, zip_manifest_sha256: z ? (z.manifest_sha256 || '') : '',
          html_sha256: x[1], rendered: x[0] ? { method: x[0].method, complete: !!x[0].complete, stylesheets: x[0].stylesheets, failed: x[0].failedStylesheets } : null,
          extra_pages: extras.map(function (e) { return { url: e.url, final_url: e.finalUrl, status: e.status, html_sha256: x[2] }; }),
          rule: 'verify/2026.10.09', checks: res.checks };
        return res;
      });
    });
  }

  // ---- 媒体の記事向けのレビュー用パッチ（airreach-review-package.js）の照合 ----------------------
  //   通常のパッチ（judge）とは別。媒体のサイトの llms.txt・ページ直下の会社の情報は求めない。見るのは
  //   ① 会社説明の全文（見出し・段落ごと）が見える形であるか ② この記事の記事データが1つだけで、about に会社名があるか
  function strictKey(u) {
    var s = String(u || '').trim().replace(/#.*$/, ''), m = /^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?$/i.exec(s);
    return m ? m[2].toLowerCase() + (m[3] || '').replace(/\/+$/, '') + (m[4] || '') : s.toLowerCase();
  }
  function idOf(x) { var v = x && (x.url || x.mainEntityOfPage || x['@id']); if (v && typeof v === 'object') v = v['@id'] || v.url; return v ? String(v) : ''; }
  function aboutNames(x) {
    var ab = x && x.about; ab = Array.isArray(ab) ? ab : ab ? [ab] : [];
    return ab.filter(function (a) { return a && types(a).some(function (t) { return ORG.test(t) || /Organization|Corporation/.test(t); }); }).map(function (a) { return String(a.name || ''); });
  }
  /**
   * item：取り込んだ記事（target_url・company・content_blocks・article{type,headline}・changeset）
   * page：{ url, status, html }。rendered：描画して読んだ見える文字（無ければ null＝要確認）
   */
  function judgeArticle(item, page, rendered) {
    var checks = [];
    if (!page || page.status !== 200) {
      checks.push({ key: 'page', label: 'ページを開けるか', state: 'ng', detail: '開けませんでした（' + ((page && page.status) || '通信できない') + '）' });
      return { checks: checks, state: 'ng', ok: false };
    }
    var html = page.html || '', st = splitText(html), statVis = norm(st.visible), hid = norm(st.hidden);
    var drawn = rendered && rendered.text != null ? norm(rendered.text) : null, full = !!(rendered && rendered.complete);
    // 1. 会社説明の全文：描画したなら描画で見えた文字、描画していなければ HTML の見える部分（その場合は要確認止まり）
    var miss = [], hidden = [];
    (item.content_blocks || []).forEach(function (b) {
      var k = norm(b), seen = drawn != null ? drawn.indexOf(k) >= 0 : statVis.indexOf(k) >= 0;
      if (seen) return;
      if (hid.indexOf(k) >= 0 || statVis.indexOf(k) >= 0) hidden.push(b); else miss.push(b);
    });
    if (miss.length || hidden.length) checks.push({ key: 'content', label: '会社説明（全文）', state: 'ng', detail: (miss.length ? miss.length + 'か所がページに無いか、文が違います：「' + miss[0].slice(0, 40) + '…」' : '') + (hidden.length ? (miss.length ? '・' : '') + hidden.length + 'か所が見えない（非表示の）ところにあります' : '') });
    else if (!full) checks.push({ key: 'content', label: '会社説明（全文）', state: 'review', detail: 'HTML にはありますが、描画して見えるかを確かめきれていません' });
    else checks.push({ key: 'content', label: '会社説明（全文）', state: 'ok', detail: (item.content_blocks || []).length + 'か所すべて、見える形であります' });
    // 2. この記事の記事データ（URL が同じもの。URL が書かれていないものは見出しが同じなら同じ記事とみなす）
    var ld = jsonLd(html), want = item.article || {}, target = strictKey(item.target_url);
    var arts = ld.items.filter(function (x) { return types(x).some(function (t) { return ARTICLE.test(t); }); });
    var mine = arts.filter(function (x) { var id = idOf(x); return id ? strictKey(id) === target : norm(x.headline || x.name) === norm(want.headline); });
    var op = item.changeset && item.changeset.structured_data && item.changeset.structured_data.operation;
    if (!mine.length) checks.push({ key: 'article', label: '記事データ（Article・NewsArticle）', state: 'ng', detail: 'この記事の記事データがありません' });
    else if (mine.length > 1) checks.push({ key: 'article', label: '記事データ（Article・NewsArticle）', state: 'ng', detail: 'この記事の記事データが ' + mine.length + 'つあります（' + mine.map(function (x) { return types(x).join('・'); }).join('／') + '）。元のものと二重になっていないか確かめ、1つにまとめてください' });
    else {
      var a = mine[0], probs = [];
      // 新設（add_if_no_article）は、元の記事データを更新した場合も合格にする（種類は記事の種類なら可）。置き換えは同じ種類
      if (op !== 'add_if_no_article' && types(a).indexOf(want.type) < 0) probs.push('種類が違います（' + types(a).join('・') + '／パッチ：' + want.type + '）');
      if (want.headline && norm(a.headline || a.name) !== norm(want.headline)) probs.push('見出しが違います');
      var names = aboutNames(a);
      if (names.map(norm).indexOf(norm(item.company)) < 0) probs.push(names.length ? 'about の会社が違います（' + names.join('・') + '／パッチ：' + item.company + '）' : 'about に会社（' + item.company + '）がありません');
      checks.push({ key: 'article', label: '記事データ（Article・NewsArticle）', state: probs.length ? 'ng' : 'ok', detail: probs.length ? probs.join('・') : types(a).join('・') + '・about に ' + item.company + (op === 'add_if_no_article' ? '（新設・既存の更新のどちらでも可）' : '') });
    }
    if (ld.broken) checks.push({ key: 'ld_broken', label: '読めない構造化データ', state: 'ng', detail: ld.broken + 'つのデータが JSON として読めません' });
    checks.push({ key: 'not_required', label: '媒体の記事では求めないもの', state: 'skip', detail: 'llms.txt・ページ直下の会社の情報（媒体のサイトのため）' });
    var s2 = checks.some(function (c) { return c.state === 'ng'; }) ? 'ng' : checks.some(function (c) { return c.state === 'review'; }) ? 'review' : 'ok';
    return { checks: checks, state: s2, ok: s2 === 'ok' };
  }
  /** 媒体の記事を読み、描画して照合する。戻り値 { res, meta{ at, url, final_url, html_sha256, rendered } } */
  function runArticle(item, pageUrl) {
    return fetchDoc(pageUrl).then(function (d) {
      var html = d.status === 200 ? d.body : '';
      return Promise.all([html ? renderVisible(html, d.finalUrl || pageUrl) : Promise.resolve(null), sha256(html)]).then(function (x) {
        var res = judgeArticle(item, { url: pageUrl, status: d.status, html: d.body }, x[0]);
        return { res: res, meta: { at: new Date().toISOString(), url: pageUrl, final_url: d.finalUrl || pageUrl, html_sha256: x[1],
          rendered: x[0] ? { method: x[0].method, complete: !!x[0].complete, stylesheets: x[0].stylesheets, failed: x[0].failedStylesheets } : null } };
      });
    });
  }

  // ---- Studio の「④ 入れたか確かめる」の画面 -------------------------------------------------
  var LABEL = { ok: '入っている', warn: '確かめてください', review: '要確認', ng: '入っていない・違う', skip: '対象外' };
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function jobNow() { try { return root.__orchLastJob || (JSON.parse(localStorage.getItem('airreach_studio_orch_v1') || 'null') || {}).lastJob || null; } catch (e) { return null; } }
  function day(iso) { var t = Date.parse(iso); if (isNaN(t)) return ''; var d = new Date(t + 9 * 3600000); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2); }
  function resultHtml(v) {
    if (!v) return '';
    var st = v.state || (v.ok ? 'ok' : 'ng');
    return '<div class="avf-res is-' + esc(st) + '"><b>' + ({ ok: 'パッチはサイトに見える形で入っています', review: '要確認：入っているかを確かめきれていません', ng: 'まだ入っていない・違うところがあります' }[st] || '') + '</b><small>' + esc(day(v.at)) + ' · ' + esc(v.url) + (v.version ? ' · パッチ v' + esc(v.version) : '') +
      (v.rendered ? (v.rendered.complete ? ' · 描画して確かめた' : ' · 描画できたがスタイルを読めなかった（要確認）') : ' · 描画では確かめていない') + (v.html_sha256 ? ' · ページの指紋 ' + esc(v.html_sha256.slice(0, 12)) : '') + '</small></div>' +
      '<ul class="avf-list">' + (v.checks || []).map(function (c) {
        return '<li class="is-' + esc(c.state) + '"><span class="avf-mark" aria-hidden="true">' + ({ ok: '✓', warn: '!', review: '?', ng: '×', skip: '−' }[c.state] || '') + '</span><span><b>' + esc(c.label) + '</b><small>' + esc(LABEL[c.state] || '') + '：' + esc(c.detail) + '</small></span></li>';
      }).join('') + '</ul>' + '<p class="avf-note">分かるのは「サイトに見える形で入ったか」までです。Google が読み直したか（収録）・AI の答えが変わったかは、別に確かめます。</p>';
  }
  function mountStudio() {
    var btn = document.getElementById('verify-run'), input = document.getElementById('verify-url'), out = document.getElementById('verify-result'), note = document.getElementById('verify-zip-note');
    if (!btn || !input || !out) return;
    function show() {
      var job = jobNow();
      if (note) note.textContent = !job ? '先に「サイトを調べる」と「③ パッチを作る」を行ってください。' : (job.zipped && !job.zipped.draft ? 'パッチ v' + (job.zipped.version || '') + '（' + day(job.zipped.at) + ' に作成）と比べます。' : 'まだ正式なパッチ（ZIP）を作っていません。いまの承認の内容と比べます。');
      if (job && !input.value) input.value = (job.verified && job.verified.url) || job.url || '';
      var orgIn = document.getElementById('verify-org-url');
      if (orgIn && !orgIn.value && job && job.verified && job.verified.extra_pages && job.verified.extra_pages[0]) orgIn.value = job.verified.extra_pages[0].url;
      out.innerHTML = resultHtml(job && job.verified);
    }
    btn.addEventListener('click', function () {
      var job = jobNow(), url = input.value.trim(), orgIn = document.getElementById('verify-org-url'), orgUrl = orgIn ? orgIn.value.trim() : '';
      if (orgUrl && !/^https?:\/\//i.test(orgUrl)) { out.innerHTML = '<p class="ars-note is-err">会社の情報を入れたページも、https:// から始まる URL を入れてください。</p>'; return; }
      if (!job) { out.innerHTML = '<p class="ars-note is-err">先に「サイトを調べる」を行ってください。</p>'; return; }
      if (!/^https?:\/\//i.test(url)) { out.innerHTML = '<p class="ars-note is-err">https:// から始まる URL を入れてください。</p>'; return; }
      btn.disabled = true; btn.textContent = '確かめています…';
      run(job, url, { orgUrl: orgUrl }).then(function () {
        root.__orchLastJob = job;
        try { localStorage.setItem('airreach_studio_orch_v1', JSON.stringify({ lastJob: job })); } catch (e) {}
        try { if (root.AirReachStudioSteps) root.AirReachStudioSteps.refresh(); } catch (e) {}
        show();
      }).catch(function (e) { out.innerHTML = '<p class="ars-note is-err">確かめられませんでした：' + esc((e && e.message) || e) + '</p>'; })
        .then(function () { btn.disabled = false; btn.textContent = '確かめる'; });
    });
    show();
    document.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('.ars-side button[data-panel="verify"]')) setTimeout(show, 30); });
  }
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountStudio); else mountStudio(); }

  var api = { judge: judge, run: run, judgeArticle: judgeArticle, runArticle: runArticle, strictKey: strictKey, adopted: adopted, jsonLd: jsonLd, visibleText: visibleText, splitText: splitText, renderVisible: renderVisible, resultHtml: resultHtml };
  root.AirReachVerify = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
