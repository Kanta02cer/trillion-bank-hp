/**
 * AirReach industry detection + KPI dictionary.
 * Shared engine; Sales View only changes labels / primary conversion.
 */
(function () {
  'use strict';

  var INDUSTRIES = {
    restaurant: {
      id: 'restaurant',
      label: '飲食店',
      primary_conversion: 'reservation',
      secondary_conversion: ['phone', 'line', 'route_search'],
      display_label: '予約',
      display_label_plural: '予約',
      hero_generic: 'このエリアで探している人に、どれくらい選ばれている？',
      hero_branded: 'お店の名前で調べられたとき、どんな情報が見えている？',
      demand_label: '探している人',
      demand_meaning: 'この地域・ジャンルのお店を探している検索の目安',
      now_label: '今の選ばれやすさ',
      now_meaning: '検索・お店情報・口コミ・サイト情報などから見た現在地',
      after_label: '改善後の参考',
      after_meaning: '不足している情報を整えた場合の参考レンジ',
      outcome_label: '予約',
      outcome_meaning: '現在の訪問数や予約率をもとにした参考値',
      impact_current_label: 'いまの予約',
      default_mode: 'generic_search',
      actions: [
        { slot: 'NOW', title: 'お店情報を揃える', action: '営業時間・場所・メニュー・特徴などを、検索やAIが理解しやすい形にする', cta: '作成する' },
        { slot: '2W', title: 'よく聞かれる質問を追加する', action: '予約・価格・席・アクセス・利用シーンなどへの答えを公式に置く', cta: '作成する' },
        { slot: 'PARTNER', title: 'HackⅡ Teamsに相談する', action: '近隣店との違いの打ち出しと継続改善を、コンサルティングとして任せる', cta: '相談する' }
      ],
      cta_generic: 'まず何を直すか見る',
      cta_branded: 'まず何を直すか見る'
    },
    clinic: {
      id: 'clinic',
      label: '美容・クリニック',
      primary_conversion: 'reservation',
      secondary_conversion: ['inquiry', 'phone'],
      display_label: '予約・相談',
      display_label_plural: '予約・相談',
      hero_generic: 'この治療・施術を探している人に、どれくらい選ばれている？',
      hero_branded: 'クリニック名で調べられたとき、どんな情報が見えている？',
      demand_label: '探している人',
      demand_meaning: 'この施術・地域で検索されている目安',
      now_label: '今の選ばれやすさ',
      now_meaning: '検索・公式情報・症例・FAQなどから見た現在地',
      after_label: '改善後の参考',
      after_meaning: '不足情報を整えた場合の参考レンジ',
      outcome_label: '予約・相談',
      outcome_meaning: '現在の訪問数や相談率をもとにした参考値',
      impact_current_label: 'いまの予約・相談',
      default_mode: 'generic_search',
      actions: [
        { slot: 'NOW', title: 'よくある質問を追加する', action: '料金・ダウンタイム・適応・予約方法を公式FAQにまとめる', cta: '作成する' },
        { slot: '2W', title: '比較されやすいページを整える', action: '施術の違い・向いている人を1ページで説明する', cta: '作成する' },
        { slot: 'PARTNER', title: 'HackⅡ Teamsに相談する', action: '競合との差の測り方と優先順位を、コンサルティングとして一緒に決める', cta: '相談する' }
      ],
      cta_generic: 'まず何を直すか見る',
      cta_branded: 'まず何を直すか見る'
    },
    b2b: {
      id: 'b2b',
      label: 'BtoB企業',
      primary_conversion: 'inquiry',
      secondary_conversion: ['meeting', 'download'],
      display_label: '問い合わせ',
      display_label_plural: '問い合わせ',
      hero_generic: 'この課題を探している人に、どれくらい選ばれている？',
      hero_branded: '会社名・サービス名で調べられたとき、どんな情報が見えている？',
      demand_label: '探している人',
      demand_meaning: 'この課題・サービスで検索されている目安',
      now_label: '今の選ばれやすさ',
      now_meaning: '検索・公式定義・事例・FAQなどから見た現在地',
      after_label: '改善後の参考',
      after_meaning: '不足情報を整えた場合の参考レンジ',
      outcome_label: '問い合わせ',
      outcome_meaning: '現在の訪問数や問い合わせ率をもとにした参考値',
      impact_current_label: 'いまの問い合わせ',
      default_mode: 'generic_search',
      actions: [
        { slot: 'NOW', title: 'サービス定義を冒頭で明確にする', action: '誰向けか・何ができるか・何をしないかを1画面で書く', cta: '作成する' },
        { slot: '2W', title: '比較・選び方ページを追加する', action: '導入前に比較される軸を公式ページで先回りする', cta: '作成する' },
        { slot: 'PARTNER', title: 'HackⅡ Teamsに相談する', action: '競合との差と問い合わせ増を、伴走コンサルで追う', cta: '相談する' }
      ],
      cta_generic: 'まず何を直すか見る',
      cta_branded: 'まず何を直すか見る'
    },
    media: {
      id: 'media',
      label: 'メディア',
      primary_conversion: 'citation',
      secondary_conversion: ['mention', 'referral'],
      display_label: '記事参照',
      display_label_plural: '記事参照',
      hero_generic: '話題のテーマで、御社の情報はどれくらい使われている？',
      hero_branded: 'AIは今、この情報から御社・商品を説明しています。',
      demand_label: '指名検索需要',
      demand_meaning: '会社名・サービス名などで検索されている目安',
      now_label: '情報反映度',
      now_meaning: '公式サイトや第三者記事がどの程度整理されているか',
      after_label: '現在の第三者記事参照',
      after_meaning: '指定した記事がAI回答で参照された割合の目安',
      outcome_label: '指定記事の参照改善レンジ',
      outcome_meaning: '参照候補に入りやすい設計をした場合の参考レンジ（保証なし）',
      impact_current_label: 'いまの参照',
      default_mode: 'branded_search',
      actions: [
        { slot: 'NOW', title: '会社と記事の関係を明確にする', action: '指定記事と公式情報の相互参照・要点一致を整える', cta: '作成する' },
        { slot: '2W', title: 'よく聞かれるブランド質問に答える', action: '「とは／評判／料金／サービス内容」への公式回答を揃える', cta: '作成する' },
        { slot: 'PARTNER', title: 'HackⅡ Teamsに相談する', action: '指定記事の参照状況の設計と継続計測を、伴走で進める', cta: '相談する' }
      ],
      cta_generic: 'どの記事が使われているか見る',
      cta_branded: 'どの記事が使われているか見る'
    },
    other: {
      id: 'other',
      label: 'その他',
      primary_conversion: 'inquiry',
      secondary_conversion: ['phone'],
      display_label: '問い合わせ',
      display_label_plural: '問い合わせ',
      hero_generic: '探している人に、どれくらい選ばれている？',
      hero_branded: '会社名・商品名で調べられたとき、どんな情報が見えている？',
      demand_label: '探している人',
      demand_meaning: '関連する検索の目安',
      now_label: '今の選ばれやすさ',
      now_meaning: '検索・サイト情報などから見た現在地',
      after_label: '改善後の参考',
      after_meaning: '情報を整えた場合の参考レンジ',
      outcome_label: '問い合わせ',
      outcome_meaning: '現在の訪問数や問い合わせ率をもとにした参考値',
      impact_current_label: 'いまの問い合わせ',
      default_mode: 'generic_search',
      actions: [
        { slot: 'NOW', title: 'よく聞かれる質問を追加する', action: '購入・相談前の疑問を公式FAQにまとめる', cta: '作成する' },
        { slot: '2W', title: '比較されやすいページを整える', action: '選ぶ基準と向いている人を1ページで書く', cta: '作成する' },
        { slot: 'PARTNER', title: 'HackⅡ Teamsに相談する', action: '測定と改善の優先順位を、コンサルティングとして一緒に進める', cta: '相談する' }
      ],
      cta_generic: 'まず何を直すか見る',
      cta_branded: 'まず何を直すか見る'
    }
  };

  // Aliases for future expansion (same engine)
  INDUSTRIES.store = Object.assign({}, INDUSTRIES.other, { id: 'store', label: '店舗型サービス', display_label: '予約・問い合わせ', outcome_label: '予約・問い合わせ', impact_current_label: 'いまの予約・問い合わせ' });
  INDUSTRIES.saas = Object.assign({}, INDUSTRIES.b2b, { id: 'saas', label: 'SaaS' });
  INDUSTRIES.ecommerce = Object.assign({}, INDUSTRIES.other, { id: 'ecommerce', label: 'EC', primary_conversion: 'purchase', display_label: '購入', outcome_label: '購入', impact_current_label: 'いまの購入' });
  INDUSTRIES.hr = Object.assign({}, INDUSTRIES.b2b, { id: 'hr', label: '人材', display_label: '応募・問い合わせ', outcome_label: '応募・問い合わせ' });
  INDUSTRIES.realestate = Object.assign({}, INDUSTRIES.other, { id: 'realestate', label: '不動産', display_label: '内見・問い合わせ', outcome_label: '内見・問い合わせ', impact_current_label: 'いまの内見・問い合わせ' });

  function scoreText(blob, patterns) {
    var s = 0;
    var hits = [];
    patterns.forEach(function (p) {
      if (p.test(blob)) { s += 1; hits.push(String(p).slice(1, 12)); }
    });
    return { score: s, hits: hits };
  }

  function detectIndustry(opts) {
    opts = opts || {};
    var url = String(opts.url || '');
    var keyword = String(opts.keyword || '');
    var diagnose = opts.diagnose || null;
    var page = (diagnose && diagnose.page) || {};
    var types = page.types || [];
    var typeSet = {};
    (Array.isArray(types) ? types : Object.keys(types || {})).forEach(function (t) { typeSet[t] = true; });

    var blob = [
      url, keyword, page.title || '', page.h1 || '',
      (diagnose && diagnose.gaps && diagnose.gaps.join(' ')) || '',
      (diagnose && diagnose.strengths && diagnose.strengths.join(' ')) || ''
    ].join(' ').toLowerCase();

    var scores = {
      restaurant: 0,
      clinic: 0,
      media: 0,
      b2b: 0,
      saas: 0,
      ecommerce: 0,
      realestate: 0,
      hr: 0,
      store: 0,
      other: 0
    };
    var reasons = [];

    if (typeSet.Restaurant || typeSet.FoodEstablishment || typeSet.CafeOrCoffeeShop) {
      scores.restaurant += 5; reasons.push('Restaurant系スキーマ');
    }
    if (typeSet.LocalBusiness && !typeSet.Restaurant) { scores.store += 2; scores.restaurant += 1; }
    if (typeSet.MedicalClinic || typeSet.Physician || typeSet.Hospital) {
      scores.clinic += 5; reasons.push('医療系スキーマ');
    }
    if (typeSet.NewsMediaOrganization || typeSet.NewsArticle || typeSet.Article) {
      scores.media += 3; reasons.push('記事・メディア系スキーマ');
    }
    if (typeSet.SoftwareApplication || typeSet.WebApplication) {
      scores.saas += 4; scores.b2b += 2; reasons.push('ソフトウェアスキーマ');
    }
    if (typeSet.Product || typeSet.Offer) { scores.ecommerce += 2; }

    var r = scoreText(blob, [/焼肉|居酒屋|レストラン|カフェ|飲食|食堂|寿司|ラーメン|メニュー|コース料理|テイクアウト|予約席|個室/]);
    scores.restaurant += r.score * 2;
    if (r.score) reasons.push('飲食語彙');

    var c = scoreText(blob, [/クリニック|美容|整形|歯科|皮膚科|施術|症例|カウンセリング|豊胸|脱毛/]);
    scores.clinic += c.score * 2;
    if (c.score) reasons.push('クリニック語彙');

    var m = scoreText(blob, [/ニュース|新聞|メディア|編集|記事|報道|press|magazine|週刊/]);
    scores.media += m.score * 2;
    if (m.score) reasons.push('メディア語彙');
    if (/news\.|nikkei|asahi|yomiuri|infoseek|excite/.test(blob)) { scores.media += 3; reasons.push('メディアドメイン傾向'); }

    var b = scoreText(blob, [/法人|btob|b2b|saas|導入事例|資料請求|api|dx|マーケティング支援|コンサル/]);
    scores.b2b += b.score * 2;
    scores.saas += (/saas|api|クラウド/.test(blob) ? 2 : 0);
    if (b.score) reasons.push('BtoB語彙');

    var e = scoreText(blob, [/通販|カート|購入|ショップ|ec\b|ストア/]);
    scores.ecommerce += e.score * 2;

    var re = scoreText(blob, [/不動産|マンション|賃貸|内見|物件/]);
    scores.realestate += re.score * 2;

    var h = scoreText(blob, [/人材|転職|求人|採用|エージェント/]);
    scores.hr += h.score * 2;

    // Prefer focus trio when close
    var ranked = Object.keys(scores).map(function (id) {
      return { id: id, score: scores[id] };
    }).sort(function (a, b) { return b.score - a.score; });

    var top = ranked[0];
    var second = ranked[1] || { score: 0 };
    var confidence = 35;
    if (top.score <= 0) {
      return {
        id: 'other',
        label: INDUSTRIES.other.label,
        confidence: 30,
        needsConfirm: true,
        reasons: ['明確な業種シグナルが弱い'],
        candidates: ['restaurant', 'b2b', 'media', 'other']
      };
    }
    confidence = Math.min(92, 40 + top.score * 8);
    if (top.score - second.score < 2) confidence = Math.min(confidence, 52);

    var id = top.id;
    // Collapse saas→b2b for Sales P0 focus unless clearly SaaS-only
    if (id === 'saas') id = 'b2b';
    if (id === 'store') id = 'restaurant'; // store UX close to restaurant for P0
    if (!INDUSTRIES[id]) id = 'other';

    return {
      id: id,
      label: INDUSTRIES[id].label,
      confidence: confidence,
      needsConfirm: confidence < 55,
      reasons: reasons.slice(0, 4),
      candidates: ['restaurant', 'b2b', 'media', 'clinic', 'other'],
      scores: scores
    };
  }

  function getIndustry(id) {
    return INDUSTRIES[id] || INDUSTRIES.other;
  }

  function listFocusIndustries() {
    return ['restaurant', 'b2b', 'media'].map(getIndustry);
  }

  window.AirReachIndustry = {
    INDUSTRIES: INDUSTRIES,
    detectIndustry: detectIndustry,
    getIndustry: getIndustry,
    listFocusIndustries: listFocusIndustries
  };
})();
