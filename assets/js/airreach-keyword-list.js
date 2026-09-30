/**
 * AirReach Tools keyword list — 「調べる言葉」の複数保持（最大5語、うち1語がメイン）。
 *
 * データの形（scan / survey に追加する。既存の keyword は消さない）:
 *   keyword:  string                     … メインの言葉（従来どおり。旧コードはこれだけを読む）
 *   keywords: [{ text, source, primary }]
 *     source: 'auto'（サイトから自動で作った候補）| 'user'（店の方が入力）| 'gsc'（Google Search Console の実測）
 *             | 'legacy'（keywords を持たない旧データの keyword。出どころ不明）
 *     primary: true はちょうど1語（空のときは0語）。keyword と常に同じ言葉
 *
 * 旧データ { keyword: '町田 焼肉' } は読み込み時に
 *   { keyword: '町田 焼肉', keywords: [{ text: '町田 焼肉', source: 'legacy', primary: true }] } として扱う。
 * keyword と keywords が食い違うときは keyword を正とする（keyword だけを書き換える旧コードがあるため）。
 * 画面・保存・通信はしない純粋関数だけ。
 */
(function (root) {
  'use strict';

  var MAX = 5;
  var MAX_LEN = 100;
  var SOURCES = ['auto', 'user', 'gsc', 'legacy'];
  var CONTROL = /[\u0000-\u001F\u007F]/g;

  function cleanText(t) {
    if (typeof t !== 'string') return '';
    return t.replace(CONTROL, ' ').replace(/[\s　]+/g, ' ').trim().slice(0, MAX_LEN);
  }
  function cleanSource(s) { return SOURCES.indexOf(s) >= 0 ? s : 'legacy'; }

  /**
   * @param {string} keyword メインの言葉（空なら keywords の primary / 先頭を使う）
   * @param {Array} keywords 保存済みの一覧（無い・壊れていてもよい）
   * @returns {{keyword: string, keywords: Array<{text, source, primary}>}}
   */
  function normalize(keyword, keywords) {
    var list = [], seen = {}, flagged = '';
    (Array.isArray(keywords) ? keywords : []).forEach(function (k) {
      if (!k || typeof k !== 'object') return;
      var text = cleanText(k.text);
      if (!text || seen[text]) return;
      seen[text] = true;
      list.push({ text: text, source: cleanSource(k.source) });
      if (k.primary === true && !flagged) flagged = text;
    });
    var main = cleanText(keyword) || flagged || (list[0] && list[0].text) || '';
    if (main && !seen[main]) list.unshift({ text: main, source: 'legacy' });
    if (main) {
      // メインは上限で落とさない: 先頭5語に入っていなければ5語目と入れ替える
      var idx = -1;
      list.forEach(function (k, i) { if (k.text === main) idx = i; });
      if (idx >= MAX) list.splice(MAX - 1, 0, list.splice(idx, 1)[0]);
    }
    list = list.slice(0, MAX).map(function (k) {
      return { text: k.text, source: k.source, primary: k.text === main };
    });
    return { keyword: main, keywords: list };
  }

  /** scan / survey 風のオブジェクトを受け取り、keyword / keywords をそろえた浅いコピーを返す */
  function withKeywords(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    var n = normalize(obj.keyword, obj.keywords);
    var out = {};
    Object.keys(obj).forEach(function (k) { out[k] = obj[k]; });
    out.keyword = n.keyword;
    out.keywords = n.keywords;
    return out;
  }

  /** 1語だけの一覧（自動候補 / 入力）を作る。空なら [] */
  function single(text, source) {
    return normalize('', [{ text: text, source: source, primary: true }]).keywords;
  }

  /** 語を足す。すでにあれば何もしない。上限なら足さない。makePrimary でメインにする */
  function add(keywords, text, source, makePrimary) {
    var cur = normalize('', keywords);
    var t = cleanText(text);
    if (!t) return cur;
    var exists = cur.keywords.some(function (k) { return k.text === t; });
    if (!exists && cur.keywords.length >= MAX) return cur;
    var list = exists ? cur.keywords : cur.keywords.concat([{ text: t, source: cleanSource(source), primary: false }]);
    return normalize(makePrimary || !cur.keyword ? t : cur.keyword, list);
  }

  /** 語を消す。メインを消したら残りの先頭がメインになる */
  function remove(keywords, text) {
    var t = cleanText(text);
    var list = normalize('', keywords).keywords.filter(function (k) { return k.text !== t; });
    return normalize('', list);
  }

  /** メインを付け替える（一覧に無い語は無視） */
  function setPrimary(keywords, text) {
    var cur = normalize('', keywords);
    var t = cleanText(text);
    if (!cur.keywords.some(function (k) { return k.text === t; })) return cur;
    return normalize(t, cur.keywords);
  }

  // ---- キーワード比較（詳細データ）の「検索データ」----
  // 使うのは次の3種類だけ。言葉の文字列から計算した回数（旧 estimateSearchVolume）は使わない。
  //   gsc:    Google Search Console の実測（表示回数・クリック・平均順位）。診断したサイトと同じサイトのデータだけ
  //   volume: 正式な月間検索数（Keyword Planner など。いまは取り込み元が無いので将来用）
  //   input:  店の方が入力した数（メインの言葉だけ）
  // GSC の表示回数は検索回数ではないので、月間検索数・検索ボリューム・月間需要としては扱わない。

  /** 検索語の照合用キー（全角英数・大文字小文字・空白の違いを吸収） */
  function matchKey(t) {
    var s = cleanText(t);
    try { s = s.normalize('NFKC'); } catch (e) {}
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * ホスト名の正規化。API の normalizeSiteUrl と同じ（小文字・末尾の点を除く・既定ポートは付けない）。
   * www の有無は区別する（別のホスト）。
   */
  function siteHost(u) {
    try {
      var url = new URL(String(u));
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      var host = url.hostname.toLowerCase().replace(/\.$/, '');
      return host ? host + (url.port ? ':' + url.port : '') : '';
    } catch (e) { return ''; }
  }

  /**
   * Search Console のプロパティ（siteUrl）を読む。
   *   'sc-domain:example.com'      → { scope: 'domain', host: 'example.com' }（ドメイン プロパティ）
   *   'https://www.example.com/'   → { scope: 'url_prefix', host: 'www.example.com' }（URL プレフィックス）
   *   'example.com'（スキーム無し）→ https:// を補って URL プレフィックスとして読む
   * 読めなければ null。
   */
  function gscProperty(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    var m = /^sc-domain:(.+)$/i.exec(s);
    if (m) {
      var d = m[1].trim().toLowerCase().replace(/\.$/, '');
      if (!/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(d) || /^www\./.test(d)) return null;
      return { property: 'sc-domain:' + d, scope: 'domain', host: d };
    }
    var url = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s;
    var h = siteHost(url);
    if (!h || h.indexOf('.') < 0) return null;
    return { property: s, scope: 'url_prefix', host: h };
  }

  /**
   * このプロパティのデータを、このホストのサイトのデータとして使ってよいか。
   *   ドメイン プロパティ: 同じドメインか、その www（例: example.com / www.example.com）。ほかのサブドメインは使わない
   *   URL プレフィックス: ホストが完全に一致するときだけ（www の有無も一致）
   */
  function propertyCoversHost(prop, host) {
    if (!prop || !host) return false;
    if (prop.scope === 'domain') return host === prop.host || host === 'www.' + prop.host;
    return host === prop.host;
  }

  /** GSC の行（query / impressions / clicks / position）を検索語ごとに合計する。順位は表示回数で重み付け平均 */
  function aggregateGsc(rows) {
    var by = {}, order = [];
    (rows || []).forEach(function (r) {
      if (!r) return;
      var q = cleanText(r.query != null ? String(r.query) : (r.keyword != null ? String(r.keyword) : ''));
      if (!q) return;
      var k = matchKey(q);
      if (!by[k]) { by[k] = { query: q, impressions: 0, clicks: 0, posSum: 0, posW: 0 }; order.push(k); }
      var imp = Number(r.impressions) || 0, pos = Number(r.position) || 0;
      by[k].impressions += imp;
      by[k].clicks += Number(r.clicks) || 0;
      if (pos > 0) { by[k].posSum += pos * Math.max(imp, 1); by[k].posW += Math.max(imp, 1); }
    });
    return order.map(function (k) {
      var x = by[k];
      return { query: x.query, impressions: x.impressions, clicks: x.clicks, position: x.posW ? x.posSum / x.posW : 0 };
    });
  }

  /**
   * 取り込んだ GSC の行を、プロパティごとのまとまり（baseline.gscSites の要素）にする。
   * 行に page（URL）があれば、そのプロパティのサイトのページかを確かめ、違う行は捨てる。
   * @param {Array} rows 各行 { query|keyword, page|url, impressions, clicks, position, gscProperty }
   *                     gscProperty が無い行（どのサイトのデータか分からない）は使わない
   * @returns {Array<{property, scope, host, periodDays, keywords, updatedAt}>}
   */
  function gscSitesFromRows(rows, periodDays, now) {
    var groups = {}, order = [];
    (rows || []).forEach(function (r) {
      var prop = r && gscProperty(r.gscProperty);
      if (!prop) return;
      var page = r.page || r.url || '';
      if (page) {
        var ph = siteHost(page);
        if (!ph || !propertyCoversHost(prop, ph)) return;
      }
      if (!groups[prop.property]) { groups[prop.property] = { prop: prop, rows: [] }; order.push(prop.property); }
      groups[prop.property].rows.push(r);
    });
    return order.map(function (key) {
      var g = groups[key];
      return {
        property: g.prop.property, scope: g.prop.scope, host: g.prop.host,
        periodDays: periodDays || 28,
        keywords: aggregateGsc(g.rows).filter(function (k) { return k.impressions > 0 || k.clicks > 0; }),
        updatedAt: now || new Date().toISOString()
      };
    }).filter(function (x) { return x.keywords.length; });
  }

  /** 既存の gscSites に新しい取り込みを足す（同じプロパティは置き換え、ほかは残す） */
  function mergeGscSites(prev, next) {
    var out = [], seen = {};
    (next || []).concat(prev || []).forEach(function (x) {
      if (!x || !x.property || seen[x.property]) return;
      seen[x.property] = true;
      out.push(x);
    });
    return out;
  }

  /**
   * 端末の Search Console 取り込み（airreach_official_baseline_v1）から、診断したサイトの実測だけを取り出す。
   * baseline.gscSites（プロパティごと）だけを見る。プロパティの記録が無い以前の取り込みは使わない。
   * @returns {{rows, periodDays, property, source} | null}
   */
  function gscFromBaseline(baseline, siteUrl) {
    var host = siteHost(siteUrl);
    if (!host || !baseline || !Array.isArray(baseline.gscSites)) return null;
    for (var i = 0; i < baseline.gscSites.length; i++) {
      var site = baseline.gscSites[i];
      var prop = site && gscProperty(site.property);
      if (!prop || !Array.isArray(site.keywords) || !site.keywords.length) continue;
      // 保存された scope / host と、property から読み直した値が食い違うものは使わない
      if ((site.scope && site.scope !== prop.scope) || (site.host && site.host !== prop.host)) continue;
      if (propertyCoversHost(prop, host)) {
        return { rows: site.keywords, periodDays: site.periodDays || 28, property: prop.property, source: 'Search Console' };
      }
    }
    return null;
  }

  // null / 空文字は 0 ではなく「値なし」
  function finiteOrNull(v) {
    if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return null;
    var x = Number(v);
    return isFinite(x) ? x : null;
  }

  // 正式な月間検索数として扱う取り込み元（将来用）。ここに無い source の数は使わない
  var VOLUME_SOURCES = { keyword_planner: 'Keyword Planner' };

  /**
   * @param {Array} keywords 調べる言葉の一覧（normalize 済みでなくてよい）
   * @param {object} opts {
   *   gsc: gscFromBaseline() の戻り値 | null,
   *   volumes: [{ keyword, value, source: 'keyword_planner' }] | null（正式な月間検索数。将来用）,
   *   volumeInput: 店の方が入力したメインの数 | null
   * }
   * @returns {Array<{text, source, primary, searchData: {gsc, volume, input}}>}
   *   gsc:    { impressions, clicks, position, periodDays, property } | null
   *   volume: { value, source, sourceLabel } | null
   *   input:  { value } | null（メインの言葉だけ）
   */
  function compare(keywords, opts) {
    opts = opts || {};
    var gscByKey = {};
    if (opts.gsc && Array.isArray(opts.gsc.rows)) {
      opts.gsc.rows.forEach(function (r) {
        var k = r && matchKey(r.query);
        if (k && !gscByKey[k]) gscByKey[k] = r;
      });
    }
    var volByKey = {};
    (Array.isArray(opts.volumes) ? opts.volumes : []).forEach(function (v) {
      var k = v && matchKey(v.keyword), val = v && finiteOrNull(v.value);
      if (k && val != null && val >= 0 && VOLUME_SOURCES[v.source] && !volByKey[k]) {
        volByKey[k] = { value: val, source: v.source, sourceLabel: VOLUME_SOURCES[v.source] };
      }
    });
    var input = finiteOrNull(opts.volumeInput);
    return normalize('', keywords).keywords.map(function (k) {
      var key = matchKey(k.text);
      var g = gscByKey[key];
      return {
        text: k.text, source: k.source, primary: k.primary,
        searchData: {
          gsc: g ? {
            impressions: finiteOrNull(g.impressions),
            clicks: finiteOrNull(g.clicks),
            position: g.position > 0 ? finiteOrNull(g.position) : null,
            periodDays: opts.gsc.periodDays || 28,
            property: opts.gsc.property || ''
          } : null,
          volume: volByKey[key] || null,
          input: k.primary && input != null && input >= 0 ? { value: input } : null
        }
      };
    });
  }

  var api = {
    MAX: MAX, MAX_LEN: MAX_LEN, SOURCES: SOURCES.slice(),
    normalize: normalize, withKeywords: withKeywords, single: single,
    add: add, remove: remove, setPrimary: setPrimary, cleanText: cleanText,
    matchKey: matchKey, siteHost: siteHost, gscProperty: gscProperty, propertyCoversHost: propertyCoversHost,
    aggregateGsc: aggregateGsc, gscSitesFromRows: gscSitesFromRows, mergeGscSites: mergeGscSites,
    gscFromBaseline: gscFromBaseline, compare: compare
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AirReachKeywordList = api;
})(typeof window !== 'undefined' ? window : null);
