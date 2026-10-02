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

  // 業種ごとの「業態」の言葉。地域と組み合わせて調べる言葉を作る（会社向け・メディアは名前で作る）
  var LEX = {
    restaurant: GENRES,
    clinic: ['美容皮膚科', '美容外科', '美容整形', '美容クリニック', '形成外科', '皮膚科', '矯正歯科', '小児歯科', '審美歯科', '歯医者', '歯科',
      '医療脱毛', '脱毛', 'ホワイトニング', '心療内科', '内科', '小児科', '眼科', '耳鼻咽喉科', '耳鼻科', '婦人科', '整形外科', '泌尿器科',
      '整骨院', '接骨院', '整体', '鍼灸', 'クリニック'],
    other: ['パーソナルジム', 'フィットネス', 'ジム', 'ピラティス', 'ヨガ', 'ヘアサロン', '美容室', '美容院', '理容室', 'ネイルサロン', 'ネイル',
      'まつげエクステ', 'エステ', 'リラクゼーション', 'マッサージ', '旅館', 'ホテル', '民泊', 'ゲストハウス', '写真館', 'フォトスタジオ',
      '学習塾', '英会話', 'スクール', '不動産', '工務店', 'リフォーム', '葬儀', '保育園', 'ペットサロン', '動物病院', 'クリーニング', '車検', '整備工場']
  };
  var GENERIC_GENRE = { 'クリニック': true, '美容クリニック': true, 'スクール': true };
  var LEX_NORM = { '美容院': '美容室', '歯医者': '歯科', '耳鼻科': '耳鼻咽喉科', 'ネイル': 'ネイルサロン', 'フィットネス': 'ジム' };
  // 地域＋業態で作らない業種（名前で調べる言葉だけを作る）
  var BRAND_ONLY = { b2b: true, media: true };

  function norm(g) { return GENRE_NORM[g] || LEX_NORM[g] || g; }

  // 語の一部として出てきたものは業態にしない（サーバー・ジャパン・アドバイス・「駅のそば」など）
  var KATA = /[ァ-ヶー]/;
  function isWordHit(s, i, g) {
    var prev = s.charAt(i - 1), next = s.charAt(i + g.length);
    if (KATA.test(g.charAt(0)) && KATA.test(prev)) return false;
    if (KATA.test(g.charAt(g.length - 1)) && KATA.test(next)) return false;
    if (g === 'そば' && (prev === 'の' || next === 'に' || next === 'で' || next === 'か')) return false;
    if (/^[A-Za-z]/.test(g) && (/[A-Za-z]/.test(next) || /[a-z]/.test(prev))) return false; // YScafe は拾い、MyBistroApp は拾わない
    return true;
  }
  function wordIndex(s, g) {
    var i = s.indexOf(g);
    while (i >= 0 && !isWordHit(s, i, g)) i = s.indexOf(g, i + 1);
    return i;
  }
  function wordCount(s, g) {
    var n = 0, i = s.indexOf(g);
    while (i >= 0) { if (isWordHit(s, i, g)) n++; i = s.indexOf(g, i + g.length); }
    return n;
  }

  /** 文字列の中で最初に出てくる業態語（辞書順ではなく出現位置で選ぶ） */
  function genreIn(s, lex) {
    s = String(s || '');
    lex = lex || GENRES;
    var best = null;
    var bestSpecific = null;
    lex.forEach(function (g) {
      var i = wordIndex(s, g);
      if (i < 0) return;
      if (!best || i < best.i || (i === best.i && g.length > best.g.length)) best = { i: i, g: g };
      if (!GENERIC_GENRE[g] && (!bestSpecific || i < bestSpecific.i || (i === bestSpecific.i && g.length > bestSpecific.g.length))) bestSpecific = { i: i, g: g };
    });
    // 「クリニック」「スクール」のような一般語は、具体的な言葉が無いときだけ使う
    if (best && GENERIC_GENRE[best.g] && bestSpecific) best = bestSpecific;
    return best ? norm(best.g) : '';
  }

  function genreByFreq(text, lex) {
    var counts = {};
    (lex || GENRES).forEach(function (g) {
      var n = wordCount(String(text || ''), g);
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
    // 「長野市川中島町」の「長野」は県ではなく市名の一部。後ろが「市」なら県の接尾辞を足さない
    return a.replace(new RegExp('^(' + PREF_ALT + ')(?![都道府県市])'), function (m, p) { return p + prefSuffix(p); });
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
  function derive(src, industry) {
    src = src || {};
    industry = industry || 'restaurant';
    var lex = LEX[industry] || GENRES;
    if (BRAND_ONLY[industry]) {
      var nm = shopName(src);
      return {
        keyword: nm, industry: industry,
        area: { value: '', level: '', source: '', pref: '', city: '', town: '' },
        genre: { value: '', source: '' }, multiStore: false,
        sourceLabel: nm ? '名前をサイト名・タイトルから' : ''
      };
    }
    var head = [src.title, src.ogTitle, src.metaDesc].filter(Boolean).join(' ');
    var text = [String(src.text || '').slice(0, 20000)].concat((src.pages || []).map(function (p) { return String(p.text || '').slice(0, 8000); })).join(' ');
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
    var genre = genreIn(head, lex), genreSource = genre ? 'title' : '';
    if (!genre && industry === 'restaurant') {
      genre = genreIn((src.ldCuisine || []).join(' '), lex);
      if (!genre) (src.types || []).some(function (t) { if (SCHEMA_GENRE[t]) { genre = SCHEMA_GENRE[t]; return true; } return false; });
      if (genre) genreSource = 'structured';
    }
    if (!genre) {
      var f = genreByFreq(text, lex);
      if (f.genre) { genre = f.genre; genreSource = 'body'; }
    }

    var keyword = area.value && genre ? area.value + ' ' + genre : '';
    var LABEL = { structured: '構造化データ', title: 'タイトル', body: '本文' };
    var sourceLabel = keyword ? ('地域は' + (areaSource === 'structured' ? '構造化データの住所' : areaSource === 'title' ? 'タイトル' : '本文の住所') +
      '、' + (industry === 'restaurant' ? '業態' : industry === 'clinic' ? '診療・施術' : '業種') + 'は' + LABEL[genreSource] + 'から') : '';
    return {
      keyword: keyword,
      industry: industry,
      area: { value: area.value, level: area.level, source: areaSource, pref: addr.pref, city: addr.city, town: addr.town },
      genre: { value: genre, source: genreSource },
      multiStore: multiStore,
      sourceLabel: sourceLabel
    };
  }


  // ---- 調べそうな言葉の一覧（Studio の buildKeywords と同じ組み立て: 業態×付け足す言葉、地域、店名） ----
  // 付け足す言葉は業種ごと。check はサイトの本文に「答え」が書いてあるかの判定（null は判定しない）。
  var MODIFIERS = {
    restaurant: [
      { word: 'おすすめ', check: null },
      { word: '人気', check: null },
      { word: 'ランチ', check: /ランチ|昼の部|昼営業/ },
      { word: 'ディナー', check: /ディナー|夜の部|夜営業/ },
      { word: '個室', check: /個室|半個室/ },
      { word: '予約', check: /予約|\breserv(?:e|ation|ations)\b/i },
      { word: '子連れ', check: /子連れ|お子様|キッズ|子ども|お子さま/ },
      { word: '駐車場', check: /駐車場|パーキング|駐車\s*\d+\s*台/ },
      { word: 'テイクアウト', check: /テイクアウト|持ち帰り/ },
      { word: '宴会', check: /宴会|貸切|貸し切り|コース/ },
      { word: '安い', check: /\d[\d,]*\s*円|[¥￥]\s*\d/ },
      { word: '口コミ', check: null }
    ]
  };
  MODIFIERS.clinic = [
    { word: 'おすすめ', check: null },
    { word: '口コミ', check: null },
    { word: '予約', check: /予約|web予約|ネット予約/i },
    { word: '料金', check: /料金|価格|\d[\d,]*\s*円|[¥￥]\s*\d/ },
    { word: 'カウンセリング', check: /カウンセリング|相談/ },
    { word: '土日', check: /土曜|日曜|土日|祝日/ },
    { word: '夜', check: /夜間|1[89]:\d\d|2[01]:\d\d|1[89]時|20時/ },
    { word: '駐車場', check: /駐車場|パーキング/ },
    { word: '女性医師', check: /女性医師|女医/ },
    { word: '当日', check: /当日/ }
  ];
  MODIFIERS.other = [
    { word: 'おすすめ', check: null },
    { word: '口コミ', check: null },
    { word: '料金', check: /料金|価格|\d[\d,]*\s*円|[¥￥]\s*\d/ },
    { word: '予約', check: /予約|\breserv(?:e|ation|ations)\b/i },
    { word: '体験', check: /体験|お試し|無料カウンセリング/ },
    { word: '初めて', check: /初めて|はじめて|初心者/ },
    { word: '駐車場', check: /駐車場|パーキング/ },
    { word: '営業時間', check: /営業時間|定休日|受付時間/ }
  ];
  var BRAND_MODIFIERS = {
    restaurant: [
      { word: '', check: null },
      { word: '予約', check: /予約|\breserv(?:e|ation|ations)\b/i },
      { word: 'メニュー', check: /メニュー|お品書き|\d[\d,]*\s*円/ },
      { word: '営業時間', check: /営業時間|定休日|open/i },
      { word: 'アクセス', check: /徒歩\s*\d+\s*分|アクセス|駅から|最寄/ }
    ],
    clinic: [
      { word: '', check: null },
      { word: '予約', check: /予約|web予約|ネット予約/i },
      { word: '料金', check: /料金|価格|\d[\d,]*\s*円/ },
      { word: '口コミ', check: null },
      { word: 'アクセス', check: /徒歩\s*\d+\s*分|アクセス|駅から|最寄/ }
    ],
    other: [
      { word: '', check: null },
      { word: '料金', check: /料金|価格|\d[\d,]*\s*円/ },
      { word: '予約', check: /予約|\breserv(?:e|ation|ations)\b/i },
      { word: '口コミ', check: null },
      { word: 'アクセス', check: /徒歩\s*\d+\s*分|アクセス|駅から|最寄/ }
    ],
    b2b: [
      { word: '', check: null },
      { word: '料金', check: /料金|価格|プラン|\d[\d,]*\s*円/ },
      { word: '導入事例', check: /導入事例|事例|お客様の声/ },
      { word: '資料請求', check: /資料請求|資料ダウンロード|ホワイトペーパー/ },
      { word: '評判', check: null },
      { word: '比較', check: null },
      { word: '問い合わせ', check: /お問い合わせ|問い合わせ|contact/i }
    ],
    media: [
      { word: '', check: null },
      { word: 'とは', check: null },
      { word: '評判', check: null },
      { word: '運営会社', check: /運営会社|会社概要|運営者/ },
      { word: '問い合わせ', check: /お問い合わせ|問い合わせ|contact/i },
      { word: '広告掲載', check: /広告掲載|媒体資料|掲載のご案内/ }
    ]
  };
  var BRAND_NOISE = /[【\[（(]?\s*(公式ホームページ|公式サイト|公式ページ|オフィシャルサイト|公式|オフィシャル|official|ホームページ|HP|TOP|トップ|ホーム|home)\s*[】\]）)]?/gi;

  /** 店名: 構造化データの name > og:site_name > タイトルの区切り記号の前（「公式」「HP」などは除く） */
  function shopName(src) {
    var cands = [src.ldName, src.ogSiteName, String(src.title || '').split(/\s*[|｜\-–—:：]\s*/)[0]];
    for (var i = 0; i < cands.length; i++) {
      var n = String(cands[i] || '').replace(BRAND_NOISE, ' ').replace(/\s+/g, ' ').trim();
      var n2 = n.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim(); // 「Sansan（営業AXサービス）」→「Sansan」
      if (n2.length >= 2) n = n2;
      var q = /「([^」]{2,20})」/.exec(n); // 「IT総合情報ポータル「ITmedia」」→「ITmedia」
      if (q) n = q[1];
      n = n.replace(/^(株式会社|有限会社|合同会社|一般社団法人|医療法人社団|医療法人)\s*|\s*(株式会社|有限会社|合同会社)$/g, '').trim();
      if (n.length >= 2 && n.length <= 30 && !/^(ホーム|home|top|トップ)$/i.test(n)) return n;
    }
    return '';
  }

  function snippet(text, rx) {
    var m = rx.exec(text);
    if (!m) return '';
    var a = Math.max(0, m.index - 14), b = Math.min(text.length, m.index + m[0].length + 14);
    return (a > 0 ? '…' : '') + text.slice(a, b).replace(/\s+/g, ' ') + (b < text.length ? '…' : '');
  }

  /**
   * @param {object} base derive() の戻り値
   * @param {object} src derive() と同じ入力（ldName / ogSiteName を足す）
   * @returns {Array<{text,group,modifier,answered,evidence}>} answered: true / false / null（判定しない）
   */
  function candidates(base, src, industry, limit) {
    industry = industry || 'restaurant';
    limit = limit || 20;
    var mods = MODIFIERS[industry] || [];
    var bmods = BRAND_MODIFIERS[industry] || [];
    var text = [src.title, src.ogTitle, src.metaDesc, src.text].filter(Boolean).join(' ').slice(0, 30000);
    var pages = (src.pages || []).filter(function (p) { return p && p.text; });
    // 本文を JavaScript で後から表示するサイトは、取得した HTML に本文が無い。見つからない＝書いていない、とは言えない
    var allText = String(src.text || '') + pages.map(function (p) { return p.text; }).join('');
    var unreadable = allText.replace(/\s+/g, '').length < 300;
    var out = [], seen = {};
    function push(t, group, mod) {
      t = String(t || '').replace(/\s+/g, ' ').trim();
      if (!t || seen[t] || out.length >= limit) return;
      seen[t] = 1;
      var answered = null, evidence = '', reason = '', evidenceUrl = '';
      if (mod && mod.check) {
        evidence = snippet(text, mod.check);
        for (var pi = 0; !evidence && pi < pages.length; pi++) {
          evidence = snippet(pages[pi].text, mod.check);
          if (evidence) evidenceUrl = pages[pi].url || '';
        }
        answered = evidence ? true : (unreadable ? null : false);
        if (!evidence && unreadable) reason = 'unreadable';
      }
      out.push({ text: t, group: group, modifier: mod ? mod.word : '', answered: answered, evidence: evidence, evidenceUrl: evidenceUrl, reason: reason });
    }
    if (base && base.keyword && !BRAND_ONLY[industry]) {
      push(base.keyword, 'base', null);
      mods.forEach(function (m) { push(base.keyword + ' ' + m.word, 'condition', m); });
    }
    var name = shopName(src);
    if (name) bmods.forEach(function (m) { push(name + (m.word ? ' ' + m.word : ''), 'brand', m); });
    return out;
  }

  /** 全業種分をまとめて作る（診断時は業種がまだ決まっていないため） */
  function deriveAll(src, limit) {
    var out = {};
    ['restaurant', 'clinic', 'other', 'b2b', 'media'].forEach(function (ind) {
      var b = derive(src, ind);
      b.candidates = candidates(b, src, ind, limit || 20);
      b.shopName = shopName(src);
      out[ind] = b;
    });
    return out;
  }

  var api = { derive: derive, deriveAll: deriveAll, candidates: candidates, shopName: shopName, parseAddress: parseAddress, genreIn: genreIn, version: 'keyword-v2' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AirReachKeyword = api;
})(typeof window !== 'undefined' ? window : null);
