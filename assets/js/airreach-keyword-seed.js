/**
 * AirReach — キーワードの材料（会社名・サービス・地域・条件・扱っているもの）をページから取り出す。
 *
 * 方針
 *  - 題名は「｜」「-」などで区切り、区切りごとに「会社名」「キャッチコピー」「サービス」を見分ける。
 *  - キャッチコピー（「、」を含む・「〜がある」「〜になる」で終わる文など）は語にしない。
 *  - 一番大きな見出し（h1）はキャッチコピーであることが多いので、サービス名の材料にしない。
 *  - 地域は構造化データの住所・題名の「〇〇の」・説明文の「A・B・Cの4店舗」から取る。
 *  - メニュー・小見出しは「扱っているもの」に見えるものだけ残し、案内・会社情報・記事の見出しは落とす。
 *  - 取り出した材料には、どこから取ったか（source）を付ける。落としたものは理由（reason）付きで返す。
 *
 * ブラウザでは window.AirReachKeywordSeed、Node では module.exports。外部への通信はしない。
 */
(function (root) {
  'use strict';

  var PREFS = ['北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島', '茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川',
    '新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知', '三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山',
    '鳥取', '島根', '岡山', '広島', '山口', '徳島', '香川', '愛媛', '高知', '福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄'];
  var WARDS = ['千代田', '中央', '港', '新宿', '文京', '台東', '墨田', '江東', '品川', '目黒', '大田', '世田谷', '渋谷', '中野', '杉並',
    '豊島', '北', '荒川', '板橋', '練馬', '足立', '葛飾', '江戸川'];
  // 題名・説明文によく出る地名（駅・街）。住所が無いときの手がかり。ここに無い地名は「〇〇駅」「〇〇市」の形でだけ拾う
  var PLACES = ['新宿', '渋谷', '池袋', '品川', '銀座', '六本木', '恵比寿', '表参道', '原宿', '新橋', '浜松町', '有楽町', '上野', '秋葉原',
    '東京駅', '丸の内', '日本橋', '赤坂', '青山', '自由が丘', '吉祥寺', '中目黒', '代官山', '五反田', '大崎', '田町', '神田', '御茶ノ水',
    '横浜', '川崎', '大宮', '浦和', '千葉', '船橋', '柏', '町田', '立川', '八王子', '梅田', '難波', '心斎橋', '天王寺', '三宮', '栄', '名古屋',
    '博多', '天神', '札幌', '仙台', '京都', '神戸', '福岡', '広島', '那覇', '23区', '都内', '関東', '関西'];

  // 区切りの文字。「・」「×」は区切りの中でさらに分ける
  var SEG_SPLIT = /\s*[|｜│¦]\s*|\s+[-–—]\s+|\s*[【】]\s*|\s+[:：]\s+/;
  var NOISE_WORDS = /(公式サイト|公式ホームページ|オフィシャルサイト|オフィシャル|ホームページ|公式ページ|official\s*site|【?公式】?|^HP$|^TOP$|トップページ)/gi;
  // 法人の種類（会社名の語からは外す。「株式会社〇〇」と「〇〇」の両方で調べられるが、調べる言葉は短い方）
  var CORP = /(株式会社|有限会社|合同会社|一般社団法人|一般財団法人|医療法人(?:社団)?|社会福祉法人|学校法人|（株）|\(株\)|Co\.,?\s*Ltd\.?|Inc\.?|LLC|Corp\.?)/gi;

  // キャッチコピー・文の形（語にしない）
  function isCatchphrase(s) {
    s = String(s || '').trim();
    if (!s) return false;
    if (/[、。！？!?]/.test(s)) return true;
    if (/(ある|なる|する|しよう|します|ます|です|ません|たい|ない|れる|られる|こう|よう|へ|を|が|は|に|から|まで|ために|なら)$/.test(s)) return true;
    if (/(を実装|を叶え|を支え|をつくる|を届け|を伝え|に寄り添|を変え|を目指)/.test(s)) return true;
    if (s.length > 22) return true;
    return false;
  }

  // サービス・業態らしい語尾（題名や説明文からサービス名を拾う手がかり）
  var SERVICE_TAIL = /(専門店|サロン|クリニック|医院|歯科|整骨院|整体|鍼灸|病院|塾|予備校|スクール|教室|ジム|スタジオ|会社|事務所|代行|支援|コンサルティング|コンサル|サービス|システム|ツール|アプリ|マンション|賃貸|不動産|ホテル|旅館|民泊|レストラン|カフェ|指導|受験|対策|講座|パーマ|脱毛|リフト|ホワイトニング|矯正|メディア|ニュースサイト|ニュース|マガジン|ショップ|ストア|通販|工務店|リフォーム|保険|葬儀|写真館|美容室|ネイル|エステ|マッサージ|PR|DX|マーケティング|デザイン|制作|開発)$/;
  // 条件（「〇〇付き」「即日」など。サービスと組み合わせる）
  var CONDITION_RE = /(付き|付|OK|ＯＫ|可能|可|対応|無料|0円|０円|なし|無し|不要|即日|当日|個室|駅近|駅徒歩|徒歩\d+分|オンライン|女性|男性|メンズ|レディース|法人|学割|24時間|土日|夜間|初回|短期|長期|ペット)/;

  // メニュー・小見出しのうち、扱っているものではないもの
  var TOPIC_NOISE = /(授業システム|料金システム|予約システム|探す|さがす|検索$|条件$|キャンペーン|ニュース$|メッセージ|挨拶|沿革|案内|流れ|ブログ|フォーム|相談|強み|理由|トップ$|^情報$|情報トップ|最新情報|新着|お知らせ|ニュースリリース|プレスリリース|方法$|方針|編集|者$|紹介$|実績$|参考書|募集|資料|事例|セミナー|イベント|ナレッジ|^運用$|^導入$|^BtoB$|^BtoC$|^とは$|とは$|メソッド|企業情報|会社情報|会社概要|事業内容|IR|サステナビリティ|SDGs|ESG|採用|求人|アクセス|地図|よくある質問|FAQ|お問い合わせ|問い合わせ|プライバシー|個人情報|利用規約|免責|サイトマップ|運営会社|運営者|ご利用|利用にあたって|コンセプト|特徴|選ばれる|お客様の声|スタッフ|講師|ギャラリー|一覧$|すべて|もっと|詳しく|ランキング|姉妹|関連|カテゴリ|タグ|アーカイブ|ログイン|会員|マイページ|カート|English|YouTube|Instagram|LINE|^で|へ$|^\d|メニュー|コラム|予定表|出勤|ポリシー|撤廃|廃止|徹底|宣言|こだわり|^当(社|院|店|クリニック|サロン|医院)|^弊社|機器$|設備$|院長|ドクター|医師紹介|症例$|料金表|^料金$|^価格$|モニター募集)/i;
  // 会社向けの事業の手がかり（地域で探す言葉を作らない・会社向けの付け足す言葉にする）
  var B2B_RE = /(BtoB|法人向け|企業の|企業向け|導入支援|DX|コンサルティング|マーケティング支援|PR会社|システム開発)/i;
  // 記事やお知らせの見出し（「〜の提供開始」「〜を強化」など）
  var HEADLINE_RE = /(提供開始|を開始|を強化|を発表|を発売|を公開|を開催|を受賞|を締結|に参画|お知らせ|について$|のご案内|のお知らせ)/;

  function clean(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/[​﻿]/g, '').trim();
  }
  function norm(s) { return clean(s).toLowerCase().replace(/[\s　・･]/g, ''); }
  function stripNoise(s) {
    return clean(String(s || '').replace(NOISE_WORDS, ' ').replace(/^[\s\-–—|｜:：・]+|[\s\-–—|｜:：・]+$/g, ''));
  }
  // 「エクラブロウ ÉCLAT BROW」「SCデジタル（SC Digital Co., Ltd.）」「グローバルニュースアジア -Global News Asia-」は日本語の名前だけにする
  function jaName(s) {
    s = clean(s);
    if (!/[぀-ヿ一-鿿]/.test(s)) return s;
    s = s.replace(/[（(][^）)]*[A-Za-z][^）)]*[）)]/g, ' ');
    s = s.replace(/\s*-[A-Za-z][^-]*-\s*/g, ' ').replace(/\s+-\s*[A-Za-z][A-Za-z0-9 .&'’,]*-?\s*$/, '');
    s = s.replace(/\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.\s&'’,]*$/, '');
    return clean(s);
  }
  function corpless(s) { return clean(String(s || '').replace(CORP, ' ')); }
  function hostKey(url) {
    try { return new URL(url).hostname.replace(/^www\./, '').split('.')[0].toLowerCase(); } catch (e) { return ''; }
  }
  function asciiKey(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, ''); }

  function isPlace(s) {
    s = clean(s).replace(/(都|府|県|駅|区|市)$/, '');
    return PREFS.indexOf(s) >= 0 || WARDS.indexOf(s) >= 0 || PLACES.indexOf(s) >= 0;
  }
  // 名前の後ろのかっこ書き（「〇〇クリニック(渋谷)」「〇〇（新宿院）」）。中身が地名なら地域として返し、名前から外す
  function splitParen(s) {
    s = clean(s);
    var m = s.match(/^(.*?)\s*[（(［\[]\s*([^）)］\]]{1,12})\s*[）)］\]]\s*$/);
    if (!m || !clean(m[1])) return { name: s, place: '' };
    var inner = clean(m[2]).replace(/(院|店|校|本店|本院)$/, '');
    return isPlace(inner) ? { name: clean(m[1]), place: inner } : { name: s, place: '' };
  }
  function placeName(s) {
    s = clean(s);
    if (/^(東京都|大阪府|京都府|北海道)$/.test(s)) return s.replace(/(都|府)$/, '');
    if (/(県|都|府)$/.test(s) && PREFS.indexOf(s.replace(/(県|都|府)$/, '')) >= 0) return s.replace(/(県|都|府)$/, '');
    if (/区$/.test(s) && WARDS.indexOf(s.replace(/区$/, '')) >= 0) return s;
    return s.replace(/駅$/, '');
  }

  /**
   * @param {object} input {
   *   title, ogTitle, ogSiteName, metaDesc, topics: string[],
   *   ldName, ldOrgNames: string[], ldAddress: string[],
   *   url, industry, hint: { brand, service, region }
   * }
   */
  function analyze(input) {
    input = input || {};
    var hint = input.hint || {};
    var rejected = [];
    function reject(text, reason) { if (clean(text)) rejected.push({ text: clean(text), reason: reason }); }
    var hk = hostKey(input.url);

    // ---- 題名を区切る ----
    var title = clean(input.title || input.ogTitle || '');
    var segs = title.split(SEG_SPLIT).map(stripNoise).filter(Boolean);

    // ---- 会社名 ----
    var brand = { value: '', source: '' };
    var named = [].concat(input.ldOrgNames || [], input.ldName ? [input.ldName] : [], input.ogSiteName ? [input.ogSiteName] : []).map(clean).filter(Boolean);
    function hasCorp(s) { CORP.lastIndex = 0; var r = CORP.test(s); CORP.lastIndex = 0; return r; }
    // 区切りが会社名か（構造化データ・サイト名と同じ、サイトのアドレスと同じ英字、法人の種類、ドメインの形）
    function segIsBrand(seg) {
      var a = asciiKey(seg), n = norm(corpless(jaName(seg)));
      if (!n) return false;
      if (named.some(function (x) {
        var y = norm(corpless(jaName(x))), ay = asciiKey(x);
        // 区切りが会社名を含む（会社名が区切りを含む、は会社名の中の別の語を拾うので見ない）
        return (y && (y === n || n.indexOf(y) >= 0)) || (ay.length >= 4 && a.indexOf(ay) >= 0);
      })) return true;
      if (hk.length >= 4 && a.length >= 4 && (a.indexOf(hk) >= 0 || hk.indexOf(a) >= 0)) return true;
      if (hasCorp(seg)) return true;
      if (/\.(com|jp|net|co\.jp)$/i.test(seg)) return true;
      return false;
    }
    // 題名の中の英字の名前で、サイトのアドレスと同じもの（「…×個別指導 MEDUCATE」の MEDUCATE）
    var latinBrand = '';
    (title.match(/[A-Za-z][A-Za-z0-9&.'’\- ]{2,}/g) || []).some(function (w) {
      var a = asciiKey(w);
      if (a.length >= 4 && hk.length >= 4 && (hk.indexOf(a) >= 0 || a.indexOf(hk) >= 0)) { latinBrand = clean(w); return true; }
      return false;
    });
    if (clean(hint.brand)) brand = { value: corpless(jaName(hint.brand)), source: 'input' };
    else {
      var bseg = segs.filter(function (s) { return !isCatchphrase(jaName(s)) && segIsBrand(s); });
      var last = segs.length > 1 ? segs[segs.length - 1] : '';
      if (bseg.length) brand = { value: corpless(jaName(bseg[0])), source: 'title' };
      // 題名の最後の区切りが会社名のことが多い（「〇〇の△△｜会社名」）。キャッチコピーやサービス名に見えるものは使わない
      else if (last && !isCatchphrase(last) && !SERVICE_TAIL.test(last) && !CONDITION_RE.test(last) && last.length <= 20) brand = { value: corpless(jaName(last)), source: 'title' };
      else if (latinBrand) brand = { value: latinBrand, source: 'title' };
      else if (named.length) brand = { value: corpless(jaName(named[0])), source: 'structured' };
    }
    // 「〇〇クリニック(渋谷)」のかっこ書きの地名は、会社名から外して地域にする
    var brandPlace = '';
    if (brand.value) { var bp = splitParen(brand.value); if (bp.place) { brand.value = bp.name; brandPlace = bp.place; } }
    var brandKey = norm(brand.value);

    // ---- サービス・地域・条件（題名） ----
    var services = [], regions = [], conditions = [];
    function addService(v, src) {
      v = clean(v).replace(/^[・\s]+|[・\s]+$/g, '');
      if (!v || v.length < 2) return;
      if (isCatchphrase(v)) { reject(v, 'キャッチコピー・文の形'); return; }
      if (brandKey && (norm(v) === brandKey || norm(v).indexOf(brandKey) >= 0)) return;
      if (/^[A-Za-z0-9 .&'’-]+$/.test(v) && !/^(PR|DX|AI|SEO|MEO|CRM|SaaS|IT)$/i.test(v)) { reject(v, '英字だけの語'); return; }
      if (services.some(function (x) { return norm(x.value) === norm(v); })) return;
      services.push({ value: v, source: src });
    }
    function addRegion(v, src) {
      v = placeName(v);
      if (!v || regions.some(function (x) { return x.value === v; })) return;
      regions.push({ value: v, source: src });
    }
    function addCondition(v, src) {
      v = clean(v).replace(/(OK|ＯＫ)$/, '').replace(/[!！]+$/, '');
      if (/駅徒歩\s*\d+\s*分|駅から徒歩/.test(v)) v = '駅近';
      if (/^敷金・?礼金(0円|０円|なし|無し|不要)$/.test(v)) v = '敷金礼金なし';
      if (/^(完全個室|全室個室)$/.test(v)) v = '個室';
      if (/^(可|可能|対応|OK)$/.test(v) || v.length < 2) return;
      if (conditions.some(function (x) { return norm(x.value) === norm(v); })) return;
      conditions.push({ value: v, source: src });
    }
    if (brandPlace) addRegion(brandPlace, brand.source === 'input' ? 'input' : 'title');

    // 区切り1つを「地域の」「条件」「サービス」に分ける
    function readSegment(seg, src) {
      var s = seg;
      // 「東京で豊胸手術・美容整形でお悩みなら」「〇〇をお探しなら」は、悩み・探し物の部分（東京で豊胸手術・美容整形）を使う
      var ask = s.match(/^(.{2,30}?)(?:で|を|が|に)?(?:お悩み|お探し|探し|ご検討|検討|迷い|迷って(?:いる)?)(?:の方|中)?(?:なら|は)$/);
      if (ask) { reject(s, 'キャッチコピー・文の形（悩み・探し物の部分だけ使う）'); s = ask[1]; }
      // 「〇〇を目指すなら△△」「〇〇なら△△」は後ろを使う
      var nara = s.match(/^.{2,20}?なら(.{2,})$/);
      if (nara) { reject(s.replace(nara[1], '').trim(), 'キャッチコピー・文の形'); s = nara[1]; }
      // 区切りの中の会社名（英字の名前・日本語の名前）を外す
      [brand.value, latinBrand].forEach(function (b) {
        if (b) s = clean(s.replace(new RegExp('\\s*' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'ig'), ' '));
      });
      // 会社名を外した残りの「(渋谷)」、「美容整形（新宿）」のかっこ書きの地名は地域にする
      var bare = s.match(/^[（(［\[]\s*([^）)］\]]+?)\s*[）)］\]]$/);
      if (bare) s = clean(bare[1]);
      var sp = splitParen(s);
      if (sp.place) { addRegion(sp.place, src); s = sp.name; }
      if (!s) return;
      // 「東京の〇〇」「新宿で〇〇」
      var rm = s.match(/^([^\sのでに]{2,8}?)(?:の|で)(.{2,})$/);
      if (rm && isPlace(rm[1])) { addRegion(rm[1], src); s = rm[2]; }
      if (isCatchphrase(s)) { reject(s, 'キャッチコピー・文の形'); return; }
      // 「・」「×」「＆」「/」で分け、条件とサービスを見分ける。「家具・家電付き」は1つの条件にまとめる
      var parts = s.split(/\s*[・×＆&\/／]\s*/).map(clean).filter(Boolean);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        var nx = parts[i + 1];
        if (nx && CONDITION_RE.test(nx) && !CONDITION_RE.test(p) && p.length <= 4 && !SERVICE_TAIL.test(p) && /付き?$/.test(nx)) {
          addCondition(p + nx, src); i++; continue;
        }
        if (isPlace(p)) { addRegion(p, src); continue; }
        if (CONDITION_RE.test(p) && !SERVICE_TAIL.test(p)) { addCondition(p, src); continue; }
        addService(p, src);
      }
    }
    // 入力のサービス名に会社名が入っているとき（前の分析で「〇〇クリニック(渋谷)」が入ったままなど）は、題名と同じく会社名を外して読む
    if (clean(hint.service)) {
      if (brandKey && norm(hint.service).indexOf(brandKey) >= 0) readSegment(clean(hint.service), 'input');
      else services.push({ value: clean(hint.service), source: 'input' });
    }
    segs.forEach(function (seg) {
      // 会社名だけの区切り（「株式会社〇〇」「VECTOR INC.」「〇〇.com」）は読まない。会社名と他の言葉が混ざった区切りは、会社名を外して読む
      var n = norm(corpless(jaName(seg)));
      if (brandKey && (n === brandKey || (segIsBrand(seg) && !SERVICE_TAIL.test(seg) && n.length <= brandKey.length + 4))) {
        var segPlace = splitParen(seg).place;
        if (segPlace) addRegion(segPlace, 'title');
        return;
      }
      if (/^[A-Za-z0-9 .,&'’\-]+$/.test(seg) && segIsBrand(seg)) return;
      readSegment(seg, 'title');
    });

    // ---- 説明文 ----
    var desc = clean(input.metaDesc || '');
    if (desc) {
      // 「浜松町・柏・〇〇の4店舗」
      var stores = desc.match(/([^\s。、]{2,40}?)の\s*[0-9０-９]+\s*(?:店舗|院|校|教室|拠点)/);
      if (stores) stores[1].split(/[・、,，]/).forEach(function (x) { x = clean(x).replace(/^(イオンモール|ららぽーと)/, ''); if (x && x.length <= 8) addRegion(x, 'description'); });
      // 「東京で〇〇をお探しなら」
      var sm = desc.match(/([^\s。、]{2,8})で([^\s。、]{2,16}?)を(?:お探し|探し)/);
      if (sm) { if (isPlace(sm[1])) addRegion(sm[1], 'description'); addService(sm[2], 'description'); }
      // 「〇〇専門店」「〇〇事業」「〇〇会社」
      var re = /([^\s。、「」『』・（）()]{2,14}?)(専門店|事業|専門塾|塾|予備校|サロン|クリニック|会社)(?=[\s。、」』・（）()]|です|の|を|と|で|$)/g, mm;
      while ((mm = re.exec(desc))) {
        var word = mm[1] + (mm[2] === '事業' ? '' : mm[2]);
        word = word.replace(/^(独自|主軸|総合|あらゆる|当社|弊社|私たち)/, '');
        // 「を掲げる美容クリニック」のような文の切れ端は、最後のひらがなより後ろ（美容クリニック）だけ使う
        var tailWord = word.match(/[ぁ-ゖ]([ァ-ヿ一-鿿][ァ-ヿ一-鿿A-Za-z]{2,})$/);
        if (tailWord && /^(を|は|が|の|と|で|に|る|た|な)$/.test(word.charAt(word.length - tailWord[1].length - 1))) word = tailWord[1];
        // 文の切れ端（「〜領域に軸足をおいた」など、助詞や動詞を含むもの）は使わない
        if (word.length < 2 || isCatchphrase(word) || /^(を|の|と|が)/.test(word) || /(に|を|が|で|た|おいた|して|する|ける|れる)/.test(word.replace(/^[^ぁ-ん]*/, ''))) continue;
        addService(word.replace(/^「|」$/g, ''), 'description');
      }
      // 「渋谷駅から徒歩30秒」「新宿駅徒歩3分」：駅の地名と、駅近の条件
      var walk = desc.match(/([ァ-ヿ一-鿿]{2,6})駅(?:から|より)?\s*徒歩\s*[0-9０-９]+\s*(?:秒|分)/);
      if (walk && isPlace(walk[1])) { addRegion(walk[1], 'description'); addCondition('駅近', 'description'); }
      // 条件（説明文の「家具・家電付き」「即日入居」など）
      (desc.match(/[^\s。、「」・]{1,6}・[^\s。、「」・]{1,6}付き|即日入居|敷金・礼金0円|敷金礼金0円|全室個室|完全個室|駅徒歩\d+分以内|法人契約|オンライン対応|無料体験|無料カウンセリング/g) || []).forEach(function (c) {
        addCondition(c.replace(/・/g, '').replace(/^敷金礼金0円$/, '敷金礼金なし'), 'description');
      });
    }

    // ---- 構造化データの住所 ----
    (input.ldAddress || []).forEach(function (a) {
      a = clean(a);
      var w = a.match(/(千代田|中央|港|新宿|文京|台東|墨田|江東|品川|目黒|大田|世田谷|渋谷|中野|杉並|豊島|北|荒川|板橋|練馬|足立|葛飾|江戸川)区/);
      if (w) addRegion(w[1] + '区', 'structured');
      var c = a.match(/([^\s\d都道府県]{2,4}市)/);
      if (c) addRegion(c[1], 'structured');
    });
    // 本文によく出る地名（「新宿」「渋谷」のようにエリアごとのページがある会社）。2回以上出るものだけ、多い順に
    var body = String(input.text || '').slice(0, 30000);
    var localKind = !/^(b2b|media)$/.test(input.industry || '') && !/(ニュース|メディア|マガジン)/.test(title + ' ' + desc) && !B2B_RE.test([title, desc].concat(input.topics || []).join(' '));
    if (body && localKind) {
      PLACES.filter(function (p) { return p.length >= 2 && !/^(関東|関西|都内|23区|東京駅)$/.test(p); }).map(function (p) {
        var n = body.split(p).length - 1;
        return { p: p, n: n };
      }).filter(function (x) {
        // すでにある地域を含む・含まれるもの（「広島」と「広島庚午」）は足さない
        return x.n >= 2 && !regions.some(function (r) { return r.value.indexOf(x.p) >= 0 || x.p.indexOf(r.value) >= 0; });
      }).sort(function (a, b) { return b.n - a.n; }).slice(0, 5).forEach(function (x) {
        addRegion(x.p, 'body');
      });
    }
    if (clean(hint.region)) regions.unshift({ value: clean(hint.region), source: 'input' });

    // ---- 扱っているもの（メニュー・小見出し） ----
    var topics = [];
    var topicItems = [];
    // 「運用 / コンサルティング」のように1つの見出しに並んだものは分ける
    (input.topics || []).forEach(function (t) {
      String(t).split(/\s+[\/／]\s+/).forEach(function (x) { topicItems.push(x); });
    });
    topicItems.forEach(function (t) {
      var v = clean(String(t).replace(/^[A-Za-z][A-Za-z ]{1,20}(?=[぀-ヿ一-鿿])/, ''));
      if (!v) return;
      if (/[+＋=＝#＃@＠]/.test(v)) { reject(v, '記号を含む'); return; }
      if (brandKey && norm(v).indexOf(brandKey) >= 0) { reject(v, '会社名を含む見出し'); return; }
      if (HEADLINE_RE.test(v)) { reject(v, '記事・お知らせの見出し'); return; }
      if (TOPIC_NOISE.test(v)) { reject(v, '案内・会社情報のメニュー'); return; }
      if (isCatchphrase(v) || v.length > 16 || /(による|とともに|に基づ|のための|として|を使った|で選ぶ|が選ぶ|の万全|超効率)/.test(v)) { reject(v, '文の形・長すぎる'); return; }
      if (/^[A-Za-z0-9 .&'’-]+$/.test(v)) { reject(v, '英字だけの語'); return; }
      if (topics.some(function (x) { return norm(x.value) === norm(v); }) || services.some(function (x) { return norm(x.value) === norm(v); })) return;
      if (isPlace(v)) { topics.push({ value: v, source: 'menu', place: true }); return; }
      topics.push({ value: v, source: 'menu' });
    });

    // サービスが題名・説明文から取れなかったときは、メニューのうちサービスらしいもの（「〜デザイン」「〜受験」など）を上げる
    if (!services.length) {
      topics.filter(function (t) { return !t.place && SERVICE_TAIL.test(t.value); }).slice(0, 2).forEach(function (t) {
        services.push({ value: t.value, source: 'menu' });
      });
      topics = topics.filter(function (t) { return !services.some(function (s) { return s.value === t.value; }); });
    }

    var industry = input.industry || 'other';
    var mediaLike = industry === 'media' || /(ニュース|メディア|マガジン|新聞|通信)$/.test(services.map(function (s) { return s.value; }).join(' ')) ||
      /(メディア|ニュースサイト)/.test(desc);
    // 業種が「その他」でも、会社向けの事業（BtoB・法人向け・導入支援・DX など）なら会社向けの言葉を付ける
    var effIndustry = industry;
    var svcText = services.map(function (s) { return s.value; }).join(' ');
    if (industry === 'media' && svcText && !/(ニュース|メディア|マガジン|新聞|通信|記事)/.test(svcText) && /(会社|PR|マーケティング|コンサル|支援|代行|開発|制作)/.test(svcText)) { effIndustry = 'b2b'; mediaLike = false; }
    if (industry === 'other' && !mediaLike && B2B_RE.test([title, desc].concat(topicItems).join(' '))) effIndustry = 'b2b';

    // 地域の並び：入力 → 題名 → 説明文 → 本文 → 住所（本社の住所は、店舗や物件のある場所と違うことがあるので最後）
    var RORDER = { input: 0, title: 1, description: 2, body: 3, structured: 4 };
    regions = regions.map(function (r, i) { return { r: r, i: i }; }).sort(function (a, b) {
      return ((RORDER[a.r.source] || 9) - (RORDER[b.r.source] || 9)) || (a.i - b.i);
    }).map(function (x) { return x.r; });

    return {
      brand: brand,
      services: services.slice(0, 6),
      regions: regions.slice(0, 6),
      conditions: conditions.slice(0, 6),
      topics: topics.slice(0, 10),
      mediaLike: mediaLike,
      industry: effIndustry,
      rejected: rejected,
      version: 'seed-v1'
    };
  }

  // 業種ごとに、サービス名に付ける言葉（多くしない。探す人が実際に使う形だけ）
  var MODS = {
    b2b: ['おすすめ', '比較', '費用', '事例'],
    clinic: ['おすすめ', '口コミ', '料金', '予約'],
    realestate: ['おすすめ', '比較', '料金', '口コミ'],
    media: [],
    other: ['おすすめ', '口コミ', '料金', '比較']
  };

  // 調べる言葉として使えるか（使えないときは理由を返す）
  function checkKeyword(text) {
    var t = clean(text);
    if (!t) return '空';
    if (/[、。！？!?「」『』]/.test(t)) return '文の記号を含む';
    if (t.length > 30) return '長すぎる';
    if (/(とは|一覧|情報|トップ|案内)\s+(おすすめ|口コミ|料金|比較|予約|とは)$/.test(t)) return '付け足す言葉が合わない';
    var words = t.split(' ');
    var seen = {};
    for (var i = 0; i < words.length; i++) { if (seen[words[i]]) return '同じ言葉の繰り返し'; seen[words[i]] = 1; }
    return '';
  }

  /**
   * 材料から調べる言葉を作る。group は 指名・サービス・地域・条件・扱っているもの。
   * @returns {Array<{text, group, source}>}
   */
  function keywords(seed, industry, limit) {
    seed = seed || {};
    industry = industry || 'other';
    // 業種が「その他」か「メディア」のときは、ページから見た業種（会社向けなど）を使う
    if ((industry === 'other' || industry === 'media') && seed.industry) industry = seed.industry;
    limit = limit || 40;
    var out = [], seen = {}, rejected = [];
    function push(text, group, source) {
      text = clean(text);
      var why = checkKeyword(text);
      if (why) { rejected.push({ text: text, reason: why }); return; }
      var k = norm(text);
      if (seen[k]) return;
      seen[k] = 1;
      out.push({ text: text, group: group, source: source || '' });
    }
    var media = industry === 'media' || (seed.mediaLike && industry !== 'b2b');
    var mods = media ? [] : (MODS[industry] || MODS.other);
    var brand = seed.brand && seed.brand.value;
    var svc = (seed.services || []).map(function (s) { return s.value; });
    var main = svc[0] || '';
    var regs = (seed.regions || []).map(function (r) { return r.value; });
    var conds = (seed.conditions || []).map(function (c) { return c.value; });

    // 指名（会社名）
    if (brand) {
      push(brand, '指名', seed.brand.source);
      if (media) push(brand + ' とは', '指名', seed.brand.source);
      else { push(brand + ' 口コミ', '指名', seed.brand.source); push(brand + ' 評判', '指名', seed.brand.source); }
      if (main && norm(main).indexOf(norm(brand)) < 0) push(brand + ' ' + main, '指名', 'title');
    }
    // サービス × 付け足す言葉
    svc.slice(0, 3).forEach(function (s, i) {
      push(s, 'サービス', (seed.services[i] || {}).source);
      mods.slice(0, i === 0 ? mods.length : 2).forEach(function (m) { push(s + ' ' + m, 'サービス', (seed.services[i] || {}).source); });
    });
    // サービス × 地域
    if (main) regs.forEach(function (r) { push(main + ' ' + r, '地域', 'region'); });
    if (svc[1]) regs.slice(0, 2).forEach(function (r) { push(svc[1] + ' ' + r, '地域', 'region'); });
    // サービス × 条件
    if (main) conds.forEach(function (c) { push(main + ' ' + c, '条件', 'condition'); });
    // 扱っているもの（メディアの国・分野は「〇〇 ニュース」、それ以外はそのもの単体と「料金」「口コミ」）
    (seed.topics || []).forEach(function (t) {
      if (media) {
        if (!/(ニュース|記事|レポート)/.test(t.value) && t.value.length <= 10) push(t.value + ' ニュース', '扱っているもの', 'menu');
        else push(t.value, '扱っているもの', 'menu');
      } else {
        push(t.value, '扱っているもの', 'menu');
        if (!t.place && mods[0] && industry !== 'b2b') push(t.value + ' ' + (mods[2] || mods[0]), '扱っているもの', 'menu');
      }
    });
    var res = out.slice(0, limit);
    res.rejected = rejected;
    return res;
  }

  var api = { analyze: analyze, keywords: keywords, checkKeyword: checkKeyword, isCatchphrase: isCatchphrase, version: 'seed-v1' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AirReachKeywordSeed = api;
})(typeof window !== 'undefined' ? window : null);
