/**
 * AirReach Tools keyword — 「調べた言葉」（地域＋業態）をサイトの公開情報から自動で作る。
 *
 * 定義: その店を探すお客様が検索しそうな「地域＋業態」（例: 神楽坂 焼肉）。
 * 作れないときは空文字（未設定）を返し、業種ごとの固定語では埋めない。
 *
 * 地域: 構造化データの住所 > タイトル・説明文の市区町村（本文の住所と一致したときだけ）> 本文の住所
 * 業態: タイトル・説明文 > 構造化データ（servesCuisine / @type）> 本文で3回以上出る業態語
 * 店の方が入力した言葉は呼び出し側で最優先にする（ここでは扱わない）。
 */
(function (root) {
  'use strict';

  var PREFS = ['北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島', '茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川',
    '新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知', '三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山',
    '鳥取', '島根', '岡山', '広島', '山口', '徳島', '香川', '愛媛', '高知', '福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'];
  var PREF_ALT = PREFS.join('|');
  function prefSuffix(p) { return p === '北海道' ? '' : p === '東京' ? '都' : (p === '京都' || p === '大阪') ? '府' : '県'; }
  var PREF_FULL = new RegExp('(北海道|東京都|京都府|大阪府|' + PREFS.filter(function (p) {
    return ['北海道', '東京', '京都', '大阪'].indexOf(p) < 0;
  }).map(function (p) { return p + '県'; }).join('|') + ')');
  var PREF_LOOSE = new RegExp('(' + PREF_ALT + ')(?:都|道|府|県)?\\s*(?=[^\\s\\d]{1,5}?(?:市|区|町|村|郡))', 'g');
  var PREF_STRIP = new RegExp('(' + PREF_ALT + ')(都|府|県)?', 'g');
  var CITY = /(?:[^\s\d]{1,4}郡)?([^\s\d、。・◆■（）()「」,，]{1,5}?(?:市|区|町|村))/;
  var HEAD_CITY = /(?:^|[^一-龥ぁ-んァ-ヶ々ー])([一-龥ぁ-んァ-ヶ々ー]{1,4}(?:市|区|町|村))(?![A-Za-z])/g;
  var TOWN = /^([^\s\d０-９\-−－ー丁番、,（(]{2,5}?)(?=[\d０-９一二三四五六七八九十]|丁目|$)/;
  var POSTAL = /〒\s*\d{3}[-−－]?\d{4}\s*([^\s][^\n]{4,40})/g;

  // 業態語（長い語を先に）と表記ゆれの正規化
  var GENRES = ['立ち食いそば', '焼き鳥', '焼鳥', '焼肉', 'ラーメン', 'らーめん', 'つけ麺', 'うどん', 'そば', '蕎麦', '寿司', '鮨', 'すし',
    '天ぷら', 'とんかつ', '居酒屋', '中華料理', '中華', '韓国料理', 'インド料理', 'カレー', 'タイ料理', 'イタリアン', 'ビストロ',
    'bistro', 'Bistro', 'フレンチ', 'ピザ', 'パスタ', 'ステーキ', 'ハンバーグ', '洋食', '和食', '割烹', '懐石', '定食', 'お好み焼き',
    'しゃぶしゃぶ', 'すき焼き', 'もつ鍋', 'ワインバー', 'バー', 'カフェ', 'cafe', 'Cafe', 'CAFE', '喫茶店', '喫茶', '珈琲',
    'コーヒー', 'ベーカリー', 'パン', 'ケーキ', 'スイーツ', 'アイスクリーム', 'アイス', 'ジェラート', '和菓子'];
  var GENRE_NORM = {
    '鮨': '寿司', 'すし': '寿司', '蕎麦': 'そば', 'らーめん': 'ラーメン', '焼鳥': '焼き鳥', '喫茶': '喫茶店', '珈琲': 'カフェ',
    'コーヒー': 'カフェ', 'cafe': 'カフェ', 'Cafe': 'カフェ', 'CAFE': 'カフェ', 'ベーカリー': 'パン', '中華料理': '中華',
    'bistro': 'ビストロ', 'Bistro': 'ビストロ'
  };
  var SCHEMA_GENRE = { CafeOrCoffeeShop: 'カフェ', BarOrPub: 'バー', Bakery: 'パン', IceCreamShop: 'アイス' };

  function norm(g) { return GENRE_NORM[g] || g; }

  /** 文字列の中で最初に出てくる業態語（辞書順ではなく出現位置で選ぶ） */
  function genreIn(s) {
    s = String(s || '');
    var best = null;
    GENRES.forEach(function (g) {
      var i = s.indexOf(g);
      if (i < 0) return;
      if (!best || i < best.i || (i === best.i && g.length > best.g.length)) best = { i: i, g: g };
    });
    return best ? norm(best.g) : '';
  }

  function genreByFreq(text) {
    var counts = {};
    GENRES.forEach(function (g) {
      var n = String(text || '').split(g).length - 1;
      if (n) counts[norm(g)] = (counts[norm(g)] || 0) + n;
    });
    var top = '', max = 0;
    Object.keys(counts).forEach(function (k) { if (counts[k] > max) { max = counts[k]; top = k; } });
    return max >= 3 ? { genre: top, count: max } : { genre: '', count: max };
  }

  /** 住所文字列 → { pref, city, town } */
  function parseAddress(s) {
    s = String(s || '').replace(/〒?\s*\d{3}[-−－]?\d{4}/g, ' ').trim();
    var pm = PREF_FULL.exec(s);
    var pref = pm ? pm[1] : '';
    var rest = pm ? s.slice(pm.index + pm[1].length) : s;
    var cm = CITY.exec(rest);
    if (!cm) return { pref: pref, city: '', town: '' };
    var city = cm[1];
    var after = rest.slice(cm.index + cm[0].length);
    // 野々市市・四日市市のように「市」で終わる市名
    if (city.slice(-1) === '市' && /^[市区町村]/.test(after)) { city += after.charAt(0); after = after.slice(1); }
    var tm = TOWN.exec(after.trim());
    return { pref: pref, city: city, town: tm ? tm[1] : '' };
  }

  function withPrefSuffix(a) {
    return a.replace(new RegExp('^(' + PREF_ALT + ')(?![都道府県])'), function (m, p) { return p + prefSuffix(p); });
  }

  /** 本文から住所らしい部分を拾い、市区町村まで読めたものだけ返す */
  function bodyAddresses(text) {
    var raw = [], m;
    POSTAL.lastIndex = 0;
    while ((m = POSTAL.exec(text))) raw.push(m[1]);
    PREF_LOOSE.lastIndex = 0;
    while ((m = PREF_LOOSE.exec(text))) { raw.push(text.slice(m.index, m.index + 40)); if (raw.length > 60) break; }
    var out = [];
    raw.forEach(function (a) {
      var p = parseAddress(withPrefSuffix(a.trim()));
      if (p.city) out.push(p);
    });
    return out;
  }

  /** 検索で使われやすい地域名: 見出しにも出る町名 > 市区町村（市・区を外す）> 都道府県 */
  function searchArea(addr, head) {
    if (addr.town && head.indexOf(addr.town) >= 0) return { value: addr.town, level: 'town' };
    if (addr.city) {
      var c = addr.city;
      var base = (/[市区]$/.test(c) && c.length > 2) ? c.slice(0, -1) : c;
      return { value: base, level: 'city' };
    }
    if (addr.pref) return { value: addr.pref.replace(/(都|府|県)$/, ''), level: 'pref' };
    return { value: '', level: '' };
  }

  /**
   * @param {object} src { title, ogTitle, metaDesc, text, ldAddress: string[], ldCuisine: string[], types: string[] }
   * @returns {{keyword:string, area:object, genre:object, multiStore:boolean, sourceLabel:string}}
   */
  function derive(src) {
    src = src || {};
    var head = [src.title, src.ogTitle, src.metaDesc].filter(Boolean).join(' ');
    var text = String(src.text || '').slice(0, 20000);
    var ldAddr = (src.ldAddress || []).filter(Boolean);
    var addr = { pref: '', city: '', town: '' }, areaSource = '', multiStore = false;

    // ---- 地域 ----
    if (ldAddr.length) {
      addr = parseAddress(ldAddr.join(''));
      if (addr.city || addr.pref) areaSource = 'structured';
    }
    if (!areaSource) {
      var addrs = bodyAddresses(text);
      var cands = [], hm;
      var headNoPref = head.replace(PREF_STRIP, ' ');
      HEAD_CITY.lastIndex = 0;
      while ((hm = HEAD_CITY.exec(headNoPref))) { if (!/地区$/.test(hm[1])) cands.push(hm[1]); }
      var confirmed = null;
      cands.some(function (c) { return addrs.some(function (p) { if (p.city === c) { confirmed = p; return true; } return false; }); });
      if (confirmed) { addr = confirmed; areaSource = 'title'; }
      else if (cands.length && !addrs.length) { addr = { pref: '', city: cands[0], town: '' }; areaSource = 'title'; }
      else if (addrs.length) {
        addr = addrs[0]; areaSource = 'body';
        var cities = {};
        addrs.forEach(function (p) { cities[p.city] = true; });
        multiStore = Object.keys(cities).length >= 3;
      }
    }
    var area = searchArea(addr, head);

    // ---- 業態 ----
    var genre = genreIn(head), genreSource = genre ? 'title' : '';
    if (!genre) {
      genre = genreIn((src.ldCuisine || []).join(' '));
      if (!genre) (src.types || []).some(function (t) { if (SCHEMA_GENRE[t]) { genre = SCHEMA_GENRE[t]; return true; } return false; });
      if (genre) genreSource = 'structured';
    }
    if (!genre) {
      var f = genreByFreq(text);
      if (f.genre) { genre = f.genre; genreSource = 'body'; }
    }

    var keyword = area.value && genre ? area.value + ' ' + genre : '';
    var LABEL = { structured: '構造化データ', title: 'タイトル', body: '本文' };
    var sourceLabel = keyword ? ('地域は' + (areaSource === 'structured' ? '構造化データの住所' : areaSource === 'title' ? 'タイトル' : '本文の住所') +
      '、業態は' + LABEL[genreSource] + 'から') : '';
    return {
      keyword: keyword,
      area: { value: area.value, level: area.level, source: areaSource, pref: addr.pref, city: addr.city, town: addr.town },
      genre: { value: genre, source: genreSource },
      multiStore: multiStore,
      sourceLabel: sourceLabel
    };
  }

  var api = { derive: derive, parseAddress: parseAddress, genreIn: genreIn, version: 'keyword-v1' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AirReachKeyword = api;
})(typeof window !== 'undefined' ? window : null);
