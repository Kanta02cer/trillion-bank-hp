/**
 * ページごとの構造化データ：手順（HowTo）・製品と価格（Product / Offer）・サービスの価格（Service の offers）。
 *   job.confirm.pages = [{ id, type: 'howto' | 'product' | 'service_price', url, name, steps: [文], items: [{ name, price, from }],
 *                          state: '' | 'approved' | 'rejected', at, checked: { at, ok, missing: [], rule } }]
 *   決まり：
 *     - ページに見える形で書いてある内容だけを入れる。ページを読み、手順の文・品名と価格が見える本文にあると確かめたものだけを承認できる
 *     - 人が承認したものだけを ZIP に入れる。承認のあとで直したら、承認は取り消す
 *     - 税込・在庫・評価など、ページから確かめていない項目は足さない
 *   分かるのは「ページに書いてあるか」まで。入れたあとに AI の答えが変わるかは、前後の計測で確かめる
 */
(function (root) {
  'use strict';
  var RULE = 'page-schema/2026.10.13';
  var TYPES = { howto: '手順', product: '製品・価格', service_price: 'サービスの価格' };
  var LD_TYPE = { howto: 'HowTo', product: 'Product', service_price: 'Service' };
  // 料金ではない金額（会社の規模・実績など）は候補にしない
  var NOT_PRICE = /資本金|売上|年商|累計|取引額|賞金|保証金|調達|時価|年収|月収|給与|時給|日給/;

  function dec(t) { return String(t || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&yen;/g, '¥').replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(Number(n)); }); }
  function nfkc(t) { t = String(t || ''); return t.normalize ? t.normalize('NFKC') : t; }
  function strip(h) { return dec(String(h || '').replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/[\s　]+/g, ' ').trim(); }
  /** ページの見える文字（照合の部品があれば、隠す指定の要素を除いたものを使う） */
  function visible(html) { var V = root.AirReachVerify; return V && V.visibleText ? V.visibleText(html) : strip(html); }
  /** 比べるための形：全角と半角・空白・桁区切りの違いを無視する */
  function nrm(t) { return nfkc(dec(t)).replace(/\\/g, '¥').replace(/[\s　]+/g, '').replace(/,/g, '').toLowerCase(); }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } }
  function httpUrl(u) { try { var x = new URL(u); return /^https?:$/.test(x.protocol); } catch (e) { return false; } }

  /** 「4,400円」「¥4,400」「3万円」→ 4400・30000。読めなければ null */
  function parsePrice(s) {
    var t = nfkc(s).replace(/[\s,]/g, '').replace(/\\/g, '¥');
    var m = /([0-9]+(?:\.[0-9]+)?)(万)?/.exec(t);
    if (!m) return null;
    var n = Number(m[1]) * (m[2] ? 10000 : 1);
    return n > 0 && n === Math.round(n) ? n : null;
  }
  function isFrom(s) { return /(〜|~|から|より|以上)\s*$/.test(nfkc(s).trim()); }

  /** 候補を探す前に、表示されない部分（script・style・コメントなど）を外す */
  function shown(html) { return String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' '); }
  /** ページの手順の候補：番号つきのリスト（ol）と、「STEP 1」「手順1」の見出しの並び。件数の多い順 */
  function extractSteps(html) {
    html = shown(html);
    var out = [], m, re = /<ol\b([^>]*)>([\s\S]*?)<\/ol>/gi;
    function titleBefore(idx) {
      var head = html.slice(0, idx), t = '', hm, hre = /<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
      while ((hm = hre.exec(head))) t = strip(hm[2]);
      return t.slice(0, 80);
    }
    function inNav(idx) { var head = html.slice(0, idx).toLowerCase(), a = head.lastIndexOf('<nav'); return a >= 0 && head.indexOf('</nav', a) < 0; }
    while ((m = re.exec(html))) {
      if (/breadcrumb|pankuzu|パンくず|topicpath/i.test(m[1]) || inNav(m.index)) continue;
      var items = [], lm, lre = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      while ((lm = lre.exec(m[2]))) { var tx = strip(lm[1]); if (tx.length >= 2 && tx.length <= 200) items.push(tx); }
      if (items.length >= 2) out.push({ title: titleBefore(m.index), steps: items, from: 'ol' });
    }
    var hs = [], first = -1, hm2, hre2 = /<h([2-5])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
    while ((hm2 = hre2.exec(html))) {
      var ht = strip(hm2[2]), sm = /^(?:STEP|ステップ|手順)\s*[.:：]?\s*[0-9０-９]+\s*[.:：、)）]?\s*(.+)$/i.exec(ht);
      if (sm && sm[1].length >= 2) { if (first < 0) first = hm2.index; hs.push(sm[1].slice(0, 200)); }
    }
    if (hs.length >= 2) out.push({ title: titleBefore(first), steps: hs, from: 'heading' });
    return out.sort(function (a, b) { return b.steps.length - a.steps.length; });
  }

  /** ページの価格の候補：表の行・リスト・定義リスト・段落の「品名 … 1,234円」。料金ではない金額は除く */
  function extractPrices(html) {
    html = shown(html);
    var out = [], seen = {};
    var PRICE = /(?:¥\s*([0-9][0-9,]*)|([0-9][0-9,]*(?:\.[0-9]+)?万?)\s*円)\s*(〜|~|から|より)?/;
    function push(nameRaw, priceRaw, fromMark, quote) {
      var name = nfkc(nameRaw).replace(/[\s:：・…|｜\-—–]+$/, '').replace(/^[\s・●■◆▶︎\-—–]+/, '').trim();
      var price = parsePrice(priceRaw);
      if (!name || name.length > 40 || price == null || NOT_PRICE.test(name) || NOT_PRICE.test(quote)) return;
      var key = name + '|' + price;
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ name: name, price: price, from: !!fromMark, quote: quote.slice(0, 120) });
    }
    function scan(text) {
      var t = nfkc(text).replace(/\\/g, '¥'), m = PRICE.exec(t);
      if (m) push(t.slice(0, m.index), m[1] || m[2], m[3], t);
    }
    var m1, dre = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
    while ((m1 = dre.exec(html))) {
      var dd = nfkc(strip(m1[2])).replace(/\\/g, '¥'), pm = PRICE.exec(dd);
      if (pm) push(strip(m1[1]), pm[1] || pm[2], pm[3], strip(m1[1]) + ' ' + dd);
    }
    var m2, rre = /<(tr|li|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    while ((m2 = rre.exec(html)) && out.length < 40) scan(strip(m2[2]));
    return out.slice(0, 40);
  }

  /** 入力欄の文字 → 手順（1行に1つ） */
  function parseSteps(text) { return String(text || '').split(/\r?\n/).map(function (l) { return l.replace(/^\s*(?:[0-9０-９]+[.．、)）]|[・\-*])\s*/, '').trim(); }).filter(Boolean); }
  /** 入力欄の文字 → 品名と価格（1行に「品名 | 価格」。価格のあとに「〜」を付けると「〜から」の価格） */
  function parseItems(text) {
    return String(text || '').split(/\r?\n/).map(function (l) {
      var p = l.split(/[|｜]/);
      if (p.length < 2) return l.trim() ? { name: l.trim(), price: null, from: false } : null;
      var pr = p[p.length - 1], name = p.slice(0, -1).join('|').trim();
      return { name: name, price: parsePrice(pr), from: isFrom(pr) };
    }).filter(Boolean);
  }
  function stepsText(e) { return (e.steps || []).join('\n'); }
  function itemsText(e) { return (e.items || []).map(function (i) { return i.name + ' | ' + (i.price == null ? '' : i.price) + (i.from ? '〜' : ''); }).join('\n'); }

  /** 形の確認 → 直すところの一覧（空なら問題なし） */
  function validate(e, ctx) {
    var errs = [];
    ctx = ctx || {};
    if (!e || !TYPES[e.type]) return ['種類が正しくありません'];
    if (!httpUrl(e.url)) errs.push('ページの URL を http(s) で入れてください');
    else if (ctx.url && hostOf(e.url) !== hostOf(ctx.url)) errs.push('対象のサイト（' + hostOf(ctx.url) + '）のページだけを入れられます');
    if (e.type === 'service_price' && ctx.industry === 'restaurant') errs.push('飲食店はサービスのデータを作らないため、サービスの価格は入れられません');
    if (e.type !== 'service_price' && String(e.name || '').trim().length < 2) errs.push(e.type === 'howto' ? '手順の名前を2文字以上で入れてください' : '名前を2文字以上で入れてください');
    if (e.type === 'howto') {
      if ((e.steps || []).length < 2) errs.push('手順は2つ以上必要です');
      if ((e.steps || []).some(function (s) { return String(s).trim().length < 2; })) errs.push('1文字以下の手順があります');
    } else {
      if (!(e.items || []).length) errs.push('品名と価格を1つ以上入れてください');
      (e.items || []).forEach(function (i) {
        if (!String(i.name || '').trim()) errs.push('品名の無い行があります');
        else if (!(i.price > 0) || i.price !== Math.round(i.price)) errs.push('「' + i.name + '」の価格を数字で入れてください（例：カット | 4400）');
      });
    }
    return errs;
  }

  function priceNear(text, from, price) {
    var seg = text.slice(from, from + 90), p = String(price), alt = price % 10000 === 0 ? String(price / 10000) + '万円' : null;
    var re = new RegExp('(^|[^0-9.])(?:¥' + p + '(?![0-9])|' + p + '円' + (alt ? '|' + alt.replace('.', '\\.') : '') + ')');
    return re.test(seg);
  }
  /**
   * ページの見える本文と照らす → { ok, missing: [足りないものの説明], rule }
   *   手順：すべての手順の文が見える本文にある。製品・価格：品名があり、その近くに同じ価格がある
   */
  function match(e, html) {
    var text = nrm(visible(html)), missing = [];
    if (!text) return { ok: false, missing: ['ページの本文を読めませんでした（画面を作るしくみのサイトでは、本文が読めないことがあります）'], rule: RULE };
    if (e.type === 'howto') {
      (e.steps || []).forEach(function (s, i) { if (text.indexOf(nrm(s)) < 0) missing.push('手順' + (i + 1) + '「' + String(s).slice(0, 30) + '」がページに見つかりません'); });
    } else {
      (e.items || []).forEach(function (it) {
        var n = nrm(it.name), idx = text.indexOf(n), found = false, any = idx >= 0;
        while (idx >= 0 && !found) { found = priceNear(text, idx + n.length, it.price); idx = text.indexOf(n, idx + 1); }
        if (!any) missing.push('「' + it.name + '」がページに見つかりません');
        else if (!found) missing.push('「' + it.name + '」の近くに ' + it.price + '円 が見つかりません');
      });
    }
    return { ok: !missing.length, missing: missing, rule: RULE };
  }

  function offerOf(it, url, withName) {
    var o = { '@type': 'Offer' };
    if (withName) o.name = it.name;
    if (it.from) o.priceSpecification = { '@type': 'PriceSpecification', minPrice: it.price, priceCurrency: 'JPY' };
    else o.price = it.price;
    o.priceCurrency = 'JPY';
    o.url = url;
    return o;
  }
  /** 構造化データ（JSON-LD）を作る。ページから確かめた項目だけを入れる */
  function build(e, ctx) {
    ctx = ctx || {};
    if (e.type === 'howto') {
      return { '@context': 'https://schema.org', '@type': 'HowTo', name: String(e.name).trim(), url: e.url,
        step: (e.steps || []).map(function (s, i) { return { '@type': 'HowToStep', position: i + 1, text: String(s).trim() }; }) };
    }
    if (e.type === 'product') {
      var prods = (e.items || []).map(function (it) {
        var p = { '@type': 'Product', name: it.name };
        if (ctx.brand) p.brand = { '@type': 'Brand', name: ctx.brand };
        p.offers = offerOf(it, e.url, false);
        return p;
      });
      if (prods.length === 1) return Object.assign({ '@context': 'https://schema.org' }, prods[0]);
      return { '@context': 'https://schema.org', '@type': 'ItemList', name: String(e.name).trim(), url: e.url,
        itemListElement: prods.map(function (p, i) { return { '@type': 'ListItem', position: i + 1, item: p }; }) };
    }
    return null;
  }
  function isApproved(e, ctx) { return !!e && e.state === 'approved' && !!e.checked && e.checked.ok === true && !validate(e, ctx).length; }

  /**
   * ZIP に入れるもの → { files: { パス: JSON }, list: [MANIFEST に書く一覧], offers: [service.jsonld に足す価格], counts }
   *   承認したものだけを入れる。「使わない」は数えない。それ以外は承認待ち
   */
  function files(pages, ctx) {
    var out = { files: {}, list: [], offers: [], counts: { total: 0, approved: 0, pending: 0, rejected: 0 } };
    (pages || []).forEach(function (e) {
      if (!e || !TYPES[e.type]) return;
      out.counts.total += 1;
      if (e.state === 'rejected') { out.counts.rejected += 1; return; }
      if (!isApproved(e, ctx)) { out.counts.pending += 1; return; }
      out.counts.approved += 1;
      var path;
      if (e.type === 'service_price') {
        path = 'schema/service.jsonld';
        (e.items || []).forEach(function (it) { out.offers.push(offerOf(it, e.url, true)); });
      } else {
        path = 'schema/pages/' + (e.type === 'howto' ? 'howto' : 'product') + '-' + String(e.id).replace(/[^a-z0-9]/gi, '') + '.jsonld';
        out.files[path] = JSON.stringify(build(e, ctx), null, 2);
      }
      out.list.push({ id: e.id, type: e.type, schema_type: LD_TYPE[e.type], url: e.url, path: path, name: e.type === 'service_price' ? (ctx && ctx.service) || '' : String(e.name).trim(),
        count: e.type === 'howto' ? (e.steps || []).length : (e.items || []).length, approved_at: e.at || '', checked_at: e.checked.at || '', rule: e.checked.rule || RULE });
    });
    return out;
  }

  function ldNodes(html) {
    var out = [], m, re = /<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
    function walk(x) { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { out.push(x); if (x['@graph']) walk(x['@graph']); if (x.itemListElement) walk(x.itemListElement); if (x.item) walk(x.item); } }
    while ((m = re.exec(String(html || '')))) { try { walk(JSON.parse(m[1])); } catch (e) {} }
    return out;
  }
  function hasType(n, t) { var x = n && n['@type']; return Array.isArray(x) ? x.indexOf(t) >= 0 : x === t; }
  /**
   * 公開したページに入ったか → { state: 'ok' | 'review' | 'ng', notes: [] }
   *   見える本文に内容があり、同じ型の構造化データがページにあれば ok。本文に無ければ ng。データが見つからなければ ng
   */
  function judge(e, html) {
    var mt = match(e, html), notes = mt.missing.slice();
    if (!mt.ok) return { state: 'ng', notes: notes, rule: RULE };
    var nodes = ldNodes(html), type = LD_TYPE[e.type], same = nodes.filter(function (n) { return hasType(n, type); });
    if (!same.length) return { state: 'ng', notes: [type + ' の構造化データがページに見つかりません'], rule: RULE };
    if (e.type === 'howto') {
      var hit = same.filter(function (n) { return nrm(n.name) === nrm(e.name) && Array.isArray(n.step) && n.step.length === (e.steps || []).length; });
      if (!hit.length) return { state: 'review', notes: ['HowTo はありますが、名前か手順の数が承認した内容と違います'], rule: RULE };
    } else if (e.type === 'product') {
      var names = same.map(function (n) { return nrm(n.name); });
      var lack = (e.items || []).filter(function (it) { return names.indexOf(nrm(it.name)) < 0; });
      if (lack.length) return { state: 'review', notes: ['Product はありますが、「' + lack[0].name + '」が見つかりません'], rule: RULE };
    } else {
      if (!same.some(function (n) { return n.offers; })) return { state: 'review', notes: ['Service はありますが、価格（offers）が入っていません'], rule: RULE };
    }
    return { state: 'ok', notes: [], rule: RULE };
  }

  /** 公開ページの取得口で読む（ブラウザから）。私的なアドレスは取得口が断る */
  function fetchDoc(url) {
    return fetch('/api/airreach/fetch?url=' + encodeURIComponent(url), { headers: { Accept: 'text/html,text/plain,*/*' } })
      .then(function (r) { return r.text().then(function (t) { return { url: url, status: r.status, body: t, finalUrl: r.headers.get('X-AirReach-Final-URL') || url }; }); });
  }

  root.AirReachPageSchema = {
    RULE: RULE, TYPES: TYPES, LD_TYPE: LD_TYPE,
    extractSteps: extractSteps, extractPrices: extractPrices, parsePrice: parsePrice, parseSteps: parseSteps, parseItems: parseItems,
    stepsText: stepsText, itemsText: itemsText, validate: validate, match: match, build: build, isApproved: isApproved, files: files, judge: judge,
    fetchDoc: fetchDoc, _nrm: nrm, _hostOf: hostOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
