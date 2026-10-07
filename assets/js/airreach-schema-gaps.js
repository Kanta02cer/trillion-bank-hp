/**
 * 構造化データの不足判定（業種ごと）。
 *   サイトに書かれた構造化データ（JSON-LD）の「種類」と「項目」を、業種で必要な項目と比べる。
 *   ページの本文から読めた事実（airreach-keyword.js の facts）があれば、
 *   「ページには書いてあるが、構造化データに無い」項目も示す（その値で直せる）。
 *
 *   役割の違い:
 *   - 診断の「足りない情報」（gaps・点数の項目）… 会社情報・FAQ などの構造化データの「種類」があるか
 *   - 「お客さんが知りたい情報」（Studio）……… 予約・料金など、お客さんが知りたいことが「ページの文章」に書いてあるか
 *   - この判定（構造化データの不足）………………… 見つかった構造化データの中に、業種で必要な「項目」がそろっているか
 */
(function (root) {
  'use strict';
  var LOCAL = ['LocalBusiness', 'Store', 'ProfessionalService', 'HomeAndConstructionBusiness', 'AutomotiveBusiness', 'LodgingBusiness', 'SportsActivityLocation', 'EntertainmentBusiness'];
  var SPEC = {
    restaurant: { label: '飲食店', main: 'Restaurant', types: ['Restaurant', 'FoodEstablishment', 'CafeOrCoffeeShop', 'BarOrPub', 'Bakery', 'FastFoodRestaurant', 'IceCreamShop', 'Winery'].concat(LOCAL),
      required: ['name', 'address', 'telephone', 'openingHours', 'url'], recommended: ['servesCuisine', 'priceRange', 'image', 'acceptsReservations'] },
    clinic: { label: '美容・クリニック', main: 'MedicalClinic（美容室・サロンは BeautySalon など）', types: ['MedicalClinic', 'Dentist', 'Physician', 'MedicalBusiness', 'MedicalOrganization', 'BeautySalon', 'HairSalon', 'NailSalon', 'DaySpa', 'HealthAndBeautyBusiness'].concat(LOCAL),
      required: ['name', 'address', 'telephone', 'openingHours', 'url'], recommended: ['priceRange', 'image', 'description'] },
    b2b: { label: '会社向けサービス', main: 'Organization', types: ['Organization', 'Corporation', 'ProfessionalService', 'OnlineBusiness'].concat(LOCAL),
      required: ['name', 'url', 'logo'], recommended: ['address', 'telephone', 'description', 'sameAs'] },
    media: { label: 'メディア', main: 'Organization（運営者）', types: ['Organization', 'NewsMediaOrganization', 'Corporation', 'Person'],
      required: ['name', 'url', 'logo'], recommended: ['sameAs', 'description'] },
    other: { label: 'その他', main: 'LocalBusiness（店舗が無ければ Organization）', types: ['Organization', 'Corporation'].concat(LOCAL, ['Restaurant', 'FoodEstablishment', 'MedicalClinic', 'BeautySalon', 'HairSalon', 'HealthAndBeautyBusiness']),
      required: ['name', 'url', 'address', 'telephone'], recommended: ['openingHours', 'image', 'description', 'priceRange'] }
  };
  var LABEL = { name: '名前', url: 'サイトの URL', address: '住所', telephone: '電話番号', openingHours: '営業時間', servesCuisine: '料理の種類', priceRange: '価格帯', image: '写真', acceptsReservations: '予約できるか', logo: 'ロゴ', description: '説明', sameAs: 'SNS などのリンク' };
  // ページの本文から読めた事実のうち、構造化データの項目に当たるもの
  var FACT_OF = { telephone: 'phone', address: 'address', openingHours: 'hours', priceRange: 'price' };

  function has(fields, k) {
    if (!fields) return false;
    if (k === 'openingHours') return !!(fields.openingHours || fields.openingHoursSpecification);
    return !!fields[k];
  }

  /**
   * @param {{blocks: Array<{types:string[], fields:object}>}|null} ld 診断で読んだ構造化データ（無ければ null）
   * @param {string} industry restaurant / clinic / b2b / media / other
   * @param {object} [facts] ページの本文から読めた事実（{ phone: { value, quote, url }, ... }）
   */
  function check(ld, industry, facts) {
    var spec = SPEC[industry] || SPEC.other;
    // facts を渡さない（null）＝ページの本文は確かめていない（月次レポートなど）。{} ＝確かめたが見つからなかった
    var pageChecked = facts != null;
    facts = facts || {};
    var blocks = (ld && Array.isArray(ld.blocks)) ? ld.blocks : [];
    var found = [];
    blocks.forEach(function (b) { (b.types || []).forEach(function (t) { if (found.indexOf(t) < 0) found.push(String(t)); }); });
    // 業種に合う種類のうち、項目がいちばん多いもの
    var matches = blocks.filter(function (b) { return (b.types || []).some(function (t) { return spec.types.indexOf(String(t)) >= 0; }); });
    var byFields = function (a, b) { return Object.keys(b.fields || {}).length - Object.keys(a.fields || {}).length; };
    var main = matches.sort(byFields)[0] || null;
    // 業種に合う種類が無くても、会社の情報（Organization）があれば、その項目で判定して「種類が合っていない」と示す
    var fallback = !main ? blocks.filter(function (b) { return (b.types || []).some(function (t) { return ['Organization', 'Corporation', 'LocalBusiness'].indexOf(String(t)) >= 0; }); }).sort(byFields)[0] || null : null;
    if (fallback) main = fallback;
    var mainType = main ? (main.types || []).join(' / ') : '';
    // 飲食店なのに Organization だけ、のように「種類が業種に合っていない」ことも示す
    var typeNote = '';
    if (fallback) typeNote = '種類が ' + mainType + ' です。' + spec.label + 'は ' + spec.main + ' にすると、業種に合った項目（営業時間など）が伝わりやすくなります（判定は ' + mainType + ' の項目で行いました）。';
    else if (!main) typeNote = blocks.length ? '業種（' + spec.label + '）に合う種類の構造化データがありません。見つかった種類：' + found.join('、') + '。' + spec.main + ' の構造化データを足してください。'
      : 'トップページに構造化データがありません。' + spec.main + ' の構造化データを足してください。';
    else if (!fallback && industry === 'restaurant' && !(main.types || []).some(function (t) { return ['Restaurant', 'FoodEstablishment', 'CafeOrCoffeeShop', 'BarOrPub', 'Bakery', 'FastFoodRestaurant', 'IceCreamShop', 'Winery'].indexOf(String(t)) >= 0; }))
      typeNote = '種類が ' + mainType + ' です。飲食店は Restaurant（またはカフェなどの種類）にすると、営業時間や料理の種類が伝わりやすくなります。';
    var items = [];
    function add(k, level) {
      var ok = main ? has(main.fields, k) : false;
      var fk = pageChecked ? FACT_OF[k] : null, fact = fk ? facts[fk] : null;
      var st = ok ? 'ok' : (fact ? 'on_page_only' : 'missing');
      var fix = '';
      if (st === 'on_page_only') fix = 'ページに書いてある「' + fact.value + '」を、構造化データの ' + k + ' に入れる';
      else if (st === 'missing') fix = fk ? 'ページにも見つかりませんでした。実際の' + LABEL[k] + 'を確かめて、ページと構造化データの両方に書く'
        : '構造化データに ' + k + '（' + LABEL[k] + '）を入れる' + (FACT_OF[k] ? '（ページに書いてある値と同じにする）' : '');
      items.push({ key: k, label: LABEL[k] || k, level: level, status: st, schemaValue: ok ? String((main.fields[k] || main.fields.openingHoursSpecification || '')).slice(0, 120) : '',
        pageValue: fact ? fact.value : '', pageQuote: fact ? fact.quote : '', pageUrl: fact ? fact.url : '', pageChecked: !!fk, fix: fix });
    }
    spec.required.forEach(function (k) { add(k, 'required'); });
    spec.recommended.forEach(function (k) { add(k, 'recommended'); });
    var req = items.filter(function (x) { return x.level === 'required'; });
    return {
      industry: SPEC[industry] ? industry : 'other', industryLabel: spec.label, expectedType: spec.main, foundTypes: found, mainType: mainType, typeNote: typeNote,
      items: items,
      summary: { required: req.length, requiredOk: req.filter(function (x) { return x.status === 'ok'; }).length,
        missing: items.filter(function (x) { return x.status !== 'ok'; }).length, onPageOnly: items.filter(function (x) { return x.status === 'on_page_only'; }).length },
      basis: '業種（' + spec.label + '）で必要な項目と、サイトの構造化データ（JSON-LD）に書かれた項目を比べました。' + (Object.keys(facts).length ? 'ページの本文から読めた値があれば、それも示しています。' : (pageChecked ? '' : 'ページの本文は、ここでは確かめていません。'))
    };
  }

  /** 直す材料の一覧用（Markdown） */
  function markdown(r) {
    var ST = { ok: 'あり', on_page_only: '**無い**（ページには書いてある）', missing: '**無い**' };
    var lines = ['# 構造化データの不足（確認用）', '', r.basis, '',
      '- 業種：' + r.industryLabel + '　入れるとよい種類：' + r.expectedType,
      '- 見つかった種類：' + (r.foundTypes.length ? r.foundTypes.join('、') : 'なし') + (r.mainType ? '（判定に使った種類：' + r.mainType + '）' : ''),
      '- 必要な項目のうち、そろっているもの：' + r.summary.requiredOk + ' / ' + r.summary.required];
    if (r.typeNote) lines.push('', '> ' + r.typeNote);
    lines.push('', '| 項目 | 必要度 | 構造化データ | 判定の根拠 | 直し方 |', '|---|---|---|---|---|');
    r.items.forEach(function (x) {
      var basis = x.status === 'ok' ? '構造化データに「' + x.schemaValue.replace(/\|/g, '｜') + '」' : (x.pageQuote ? 'ページの記載「' + x.pageQuote.replace(/\|/g, '｜') + '」' + (x.pageUrl ? ' ' + x.pageUrl : '') : (x.pageChecked ? '構造化データにもページにも見つからない' : '構造化データに無い'));
      lines.push('| ' + x.label + '（' + x.key + '） | ' + (x.level === 'required' ? '必要' : 'あるとよい') + ' | ' + ST[x.status] + ' | ' + basis + ' | ' + (x.fix || '—').replace(/\|/g, '｜') + ' |');
    });
    lines.push('', '直した構造化データは、ページに実際に書いてある内容と同じにしてください（ページに無い値を構造化データだけに書かない）。');
    return lines.join('\n') + '\n';
  }

  var api = { check: check, markdown: markdown, SPEC: SPEC, LABEL: LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AirReachSchemaGaps = api;
})(typeof window !== 'undefined' ? window : this);
