/**
 * AirReach OS layer — rule-based product intelligence from measured page signals.
 * Does NOT invent live ChatGPT/Gemini citation rates.
 */
(function () {
  'use strict';

  var QUERY_BANK = {
    aio: [
      'AIO とは', 'AIO SEO 違い', 'AEO とは', 'GEO とは', 'LLMO とは',
      'AI検索 対策', 'AI Overview 対策', 'ChatGPT 自社 表示', 'AI検索 効果測定',
      'AIO 会社 おすすめ', 'AEO 外注 費用', 'AI検索 自社対応 外注',
      'AI引用率 測り方', 'AI検索 SOV', '生成AI 引用元 分析'
    ],
    generic: [
      'サービス 概要', '料金 プラン', '導入事例', 'よくある質問',
      '他社 比較', '対象顧客', '導入の流れ', '問い合わせ',
      '会社概要', '強み 特徴', '向いていない人', 'サポート体制'
    ],
    local: [
      '営業時間', 'アクセス', '予約 方法', '料金 相場', '口コミ',
      'おすすめ メニュー', '個室 ある', '当日予約'
    ]
  };

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function has(text, re) { return re.test(text || ''); }

  function detectCategory(page) {
    var t = ((page.title || '') + ' ' + (page.text || '') + ' ' + (page.h1 || []).join(' ')).toLowerCase();
    if (/aio|aeo|geo|llmo|ai検索|chatgpt|gemini|hackⅡ|hack2|airreach/.test(t)) return 'aio';
    if (/予約|店舗|レストラン|カフェ|居酒屋|ランチ|ディナー/.test(t)) return 'local';
    return 'generic';
  }

  function extractCompanyName(page, host) {
    if (page.types && (page.types.Organization || page.types.LocalBusiness)) {
      // name often in title
    }
    var title = (page.title || '').split(/[|\-—・｜]/)[0].trim().replace(/^株式会社/, '');
    if (title && title.length <= 40) return title;
    try {
      return host.replace(/^www\./, '').split('.')[0];
    } catch (e) {
      return host || 'このサイト';
    }
  }

  function extractServices(page) {
    var services = [];
    (page.h2 || []).forEach(function (h) {
      if (/サービス|事業|プロダクト|Hack|AirReach|Pay per|Adctor/i.test(h) && h.length < 40) services.push(h);
    });
    if (page.hasPrice) services.push('料金・プラン情報あり');
    if (!services.length && page.h1 && page.h1[0]) services.push(page.h1[0].slice(0, 40));
    return services.slice(0, 5);
  }

  function buildUnderstandingMap(page, host) {
    var category = detectCategory(page);
    var company = extractCompanyName(page, host);
    var services = extractServices(page);
    var audience = has(page.text, /法人|マーケ|BtoB|企業|担当者|中小企業/) ? '法人・マーケティング担当者寄り'
      : has(page.text, /個人|予約|来店/) ? '個人・来店顧客寄り' : 'ページ上では特定しにくい';
    var strengths = [];
    if (page.hasCompare) strengths.push('比較・選び方');
    if (page.faqCount >= 3) strengths.push('FAQ');
    if (page.types.Organization || page.types.LocalBusiness) strengths.push('会社エンティティ');
    if (page.hasContact) strengths.push('問い合わせ導線');
    if (!strengths.length) strengths.push('明確な強み表現が少ない');

    var primaryWeak = !page.hasCase ? '導入実績・事例'
      : !page.hasPrice ? '価格情報'
        : !page.hasCompare ? '比較情報'
          : page.faqCount < 3 ? 'FAQ・一次回答'
            : '根拠・更新情報';

    var entityScore = 0;
    if (page.types.Organization || page.types.LocalBusiness) entityScore += 35;
    if (page.types.Service || page.types.Product) entityScore += 20;
    if (page.hasContact) entityScore += 15;
    if (page.ogTitle) entityScore += 10;
    if (page.canonical) entityScore += 10;
    if (page.textLen > 800) entityScore += 10;
    entityScore = clamp(entityScore, 0, 100);

    var fields = [
      { label: '会社', value: company, status: company ? 'ok' : 'weak' },
      { label: 'サービス', value: services.join(' / ') || '特定しにくい', status: services.length ? 'ok' : 'weak' },
      { label: 'カテゴリ', value: category === 'aio' ? 'AIO / SEO / GEO' : category === 'local' ? 'ローカル / 店舗' : '一般サービス', status: 'ok' },
      { label: '対象顧客', value: audience, status: /特定しにくい/.test(audience) ? 'warn' : 'ok' },
      { label: '強み', value: strengths.join('・'), status: strengths.length >= 2 ? 'ok' : 'warn' },
      { label: '一次情報', value: page.hasUpdate || page.hasAuthor ? '一部あり' : '弱い', status: page.hasUpdate || page.hasAuthor ? 'warn' : 'bad' },
      { label: '価格情報', value: page.hasPrice ? 'あり' : '不明 / 不足', status: page.hasPrice ? 'ok' : 'bad' },
      { label: '比較情報', value: page.hasCompare ? 'あり' : '不足', status: page.hasCompare ? 'ok' : 'bad' },
      { label: '導入実績', value: page.hasCase ? 'あり' : '不足', status: page.hasCase ? 'ok' : 'bad' },
      { label: 'Entity信頼度', value: entityScore + '%', status: entityScore >= 70 ? 'ok' : entityScore >= 45 ? 'warn' : 'bad' }
    ];

    return {
      dataKind: '実測（公開ページ解析）',
      category: category,
      company: company,
      primaryWeak: primaryWeak,
      entityScore: entityScore,
      fields: fields,
      summary: company + ' は「' + (services[0] || 'サービス') + '」として読めますが、「' + primaryWeak + '」が弱いため、AIが選び・引用しにくい可能性があります。'
    };
  }

  function buildPassageHighlights(page) {
    var chunks = [];
    function push(label, text, level, reason) {
      if (!text) return;
      chunks.push({ label: label, text: String(text).replace(/\s+/g, ' ').trim().slice(0, 160), level: level, reason: reason });
    }
    push('Title', page.title, page.title && page.title.length >= 12 ? 'good' : 'bad',
      page.title && page.title.length >= 12 ? '主題が読み取れる' : '主題が弱い');
    if (page.h1 && page.h1[0]) {
      push('H1', page.h1[0], page.h1.length === 1 ? 'good' : 'warn',
        page.h1.length === 1 ? '主題が1つ' : 'H1が複数または不明瞭');
    }
    if (page.metaDesc) {
      push('Meta', page.metaDesc, page.metaDesc.length >= 40 ? 'good' : 'warn', '検索・AIの要約材料');
    }
    push('FAQ', page.faqCount ? ('JSON-LD FAQ ' + page.faqCount + '問') : 'FAQなし',
      page.faqCount >= 3 ? 'good' : page.faqCount > 0 ? 'warn' : 'bad',
      page.faqCount >= 3 ? '質問に答えやすい' : '根拠付き回答が少ない');
    push('比較', page.hasCompare ? '比較・選び方の表現あり' : '比較情報が見当たらない',
      page.hasCompare ? 'good' : 'bad', '意思決定クエリで必要');
    push('料金', page.hasPrice ? '料金・費用の表現あり' : '料金情報が見当たらない',
      page.hasPrice ? 'good' : 'bad', '購買意図クエリで必要');
    push('実績', page.hasCase ? '事例・実績の表現あり' : '事例が見当たらない',
      page.hasCase ? 'good' : 'warn', '信頼・選定で必要');
    push('CTA', page.hasContact ? '問い合わせ導線あり' : '問い合わせ導線が弱い',
      page.hasContact ? 'good' : 'bad', '露出後のコンバージョン');
    return { dataKind: '実測（公開ページ）', items: chunks };
  }

  function buildSearchFoundation(page, robotsText, baseHref) {
    var checks = [];
    function add(id, label, ok, detail, severity) {
      checks.push({ id: id, label: label, ok: !!ok, detail: detail || '', severity: severity || (ok ? 'info' : 'high') });
    }
    var noindex = (page.robotsMeta || '').indexOf('noindex') >= 0;
    add('https', 'HTTPS', /^https:/i.test(baseHref || ''), baseHref || '', 'high');
    add('noindex', 'index可能（noindexなし）', !noindex, noindex ? 'meta robots に noindex' : 'noindexなし', 'high');
    add('canonical', 'canonical', !!page.canonical, page.canonical || '未設定', 'high');
    add('title', 'title', !!page.title, page.title ? 'あり' : 'なし', 'high');
    add('h1', 'H1が1つ', page.h1 && page.h1.length === 1, 'H1数 ' + ((page.h1 && page.h1.length) || 0), 'med');
    add('meta', 'meta description', !!(page.metaDesc && page.metaDesc.length >= 40), page.metaDesc ? page.metaDesc.length + '字' : '不足', 'med');
    add('robots', 'robots.txt取得', !!robotsText, robotsText ? '取得済み' : '未取得/空', 'med');
    var blocked = !!(robotsText && /Disallow:\s*\/\s*$/m.test(robotsText) && !/Allow:/i.test(robotsText));
    add('robots_block', '全体Disallowなし', !blocked, blocked ? 'ルートDisallowの可能性' : '問題なし', 'high');
    add('body', '本文量', page.textLen > 800, page.textLen + '字', 'med');
    add('schema', '構造化データ', Object.keys(page.types || {}).length > 0, Object.keys(page.types || {}).join(', ') || 'なし', 'med');

    var pass = checks.filter(function (c) { return c.ok; }).length;
    var score = Math.round((pass / checks.length) * 100);
    var blockers = checks.filter(function (c) { return !c.ok && c.severity === 'high'; });
    return {
      dataKind: '実測（公開シグナル）',
      score: score,
      pass: pass,
      total: checks.length,
      checks: checks,
      blockers: blockers,
      summary: blockers.length
        ? 'Search Foundation: ' + blockers.length + '件の高優先ブロッカー。AI引用の前に発見・登録を直す必要あり。'
        : 'Search Foundation: 重大ブロッカーは検出されず。次は理解・引用材料を厚くする段階。'
    };
  }

  function queryCovered(q, page) {
    var text = ((page.text || '') + ' ' + (page.title || '') + ' ' + (page.h1 || []).join(' ') + ' ' + (page.h2 || []).join(' ')).toLowerCase();
    var tokens = String(q).toLowerCase().split(/\s+/).filter(function (t) { return t.length > 1; });
    var hit = 0;
    tokens.forEach(function (t) { if (text.indexOf(t) >= 0) hit += 1; });
    var ratio = tokens.length ? hit / tokens.length : 0;
    var intent = /おすすめ|比較|費用|外注|料金|選び方|違い/.test(q) ? 'decision' : 'informational';
    var covered = ratio >= 0.55 || (intent === 'informational' && ratio >= 0.4);
    // Extra requirements for decision queries
    if (intent === 'decision') {
      if (/比較|おすすめ|違い/.test(q) && !page.hasCompare) covered = false;
      if (/費用|料金|外注/.test(q) && !page.hasPrice && page.faqCount < 3) covered = false;
    }
    return { query: q, intent: intent, covered: covered, ratio: Math.round(ratio * 100), gap: !covered };
  }

  function buildDecisionCoverage(page, understanding) {
    var cat = (understanding && understanding.category) || detectCategory(page);
    var bank = (QUERY_BANK[cat] || QUERY_BANK.generic).concat(QUERY_BANK.generic.slice(0, 6));
    // brand-flavored queries
    var brand = (understanding && understanding.company) || 'サービス';
    bank = bank.concat([
      brand + ' とは',
      brand + ' 料金',
      brand + ' 評判',
      brand + ' 比較',
      brand + ' 導入事例'
    ]);
    // unique
    var seen = {};
    var queries = [];
    bank.forEach(function (q) {
      var k = q.toLowerCase();
      if (seen[k]) return;
      seen[k] = 1;
      queries.push(queryCovered(q, page));
    });
    // pad toward 100 with variants for display denominator
    var target = 100;
    var coveredN = queries.filter(function (q) { return q.covered; }).length;
    var decisionGaps = queries.filter(function (q) { return q.intent === 'decision' && q.gap; });
    // Scale coverage to 100 decision queries concept: measured subset / projected
    var measured = queries.length;
    var projectedCovered = Math.round((coveredN / measured) * target);
    return {
      dataKind: '実測（ページ内カバー判定）+ クエリ設計',
      measuredQueries: measured,
      targetQueries: target,
      coveredMeasured: coveredN,
      coverageDisplay: projectedCovered + ' / ' + target,
      coveragePct: projectedCovered,
      decisionGaps: decisionGaps.slice(0, 12),
      topGaps: queries.filter(function (q) { return q.gap; }).slice(0, 10),
      queries: queries,
      summary: 'AI Decision Coverage ' + projectedCovered + ' / 100。購入・選定意図の質問 ' + decisionGaps.length + ' 件で回答情報が不足。'
    };
  }

  function buildCitationGap(page, understanding) {
    var gaps = [];
    function need(label, ok, why) {
      gaps.push({ label: label, present: !!ok, why: why, severity: ok ? 'ok' : 'gap' });
    }
    need('定義（〜とは）', has(page.text, /とは|定義|概要/), 'AIがカテゴリ説明で引用しやすい');
    need('比較表・選び方', page.hasCompare, '「おすすめ」「違い」系クエリの材料');
    need('料金・費用感', page.hasPrice, '外注/導入判断の材料');
    need('FAQ（3問以上）', page.faqCount >= 3, '質問応答・AI Overview向け');
    need('Organization/LocalBusiness', !!(page.types.Organization || page.types.LocalBusiness), 'エンティティ解決');
    need('一次情報（更新日/著者）', !!(page.hasUpdate || page.hasAuthor), '信頼・鮮度');
    need('事例・実績', !!page.hasCase, '選定理由の根拠');
    need('対象外・向かない人', has(page.text, /向かない|対象外|向いていない|しないこと/), '過度な一般論を避ける');
    need('明確なCTA', !!page.hasContact, '引用後のコンバージョン');
    need('canonical', !!page.canonical, '正規URLの固定');
    var missing = gaps.filter(function (g) { return g.severity === 'gap'; });
    return {
      dataKind: '実測（公開ページ）',
      gaps: gaps,
      missing: missing,
      missingCount: missing.length,
      summary: missing.length
        ? 'Citation Gap: 競合・選定クエリで必要になりやすい情報のうち ' + missing.length + ' 項目が不足。'
        : 'Citation Gap: 主要材料は揃っている。次は実AI回答での引用をHackⅡで確認。'
    };
  }

  function buildNextActions(page, foundation, coverage, citation, understanding) {
    var actions = [];
    function add(priority, title, why, effort, fixType) {
      actions.push({ priority: priority, title: title, why: why, effort: effort, fixType: fixType });
    }
    (foundation.blockers || []).forEach(function (b) {
      add(100, b.label + 'を解消する', b.detail, '低', b.id);
    });
    if (citation.missingCount) {
      var top = citation.missing[0];
      add(90, top.label + 'をページに追加する', top.why, '中', 'citation:' + top.label);
    }
    if (coverage.decisionGaps && coverage.decisionGaps.length) {
      add(85, '選定系クエリの回答を厚くする', coverage.decisionGaps[0].query + ' などが不足', '中', 'decision');
    }
    if (!page.types.Organization && !page.types.LocalBusiness) {
      add(80, 'Organization 構造化データを追加', 'Entity信頼度を上げる', '低', 'jsonld-org');
    }
    if (page.faqCount < 3) {
      add(78, 'FAQを3問以上追加', 'Decision Queryと引用に直結', '低', 'faq');
    }
    if (!page.hasCompare) {
      add(75, '比較・選ばれる理由セクションを追加', 'おすすめ系クエリ対策', '中', 'compare');
    }
    if (!page.hasContact) {
      add(70, '問い合わせCTAを同一ページに置く', 'Conversion Readiness', '低', 'cta');
    }
    // dedupe by title
    var seen = {};
    actions = actions.filter(function (a) {
      if (seen[a.title]) return false;
      seen[a.title] = 1;
      return true;
    });
    actions.sort(function (a, b) { return b.priority - a.priority; });
    return {
      dataKind: 'ルール判定（実測ギャップ起点）',
      items: actions.slice(0, 3),
      remainingCount: Math.max(0, actions.length - 3)
    };
  }

  function buildFreeFix(page, understanding, nextActions, host) {
    var top = (nextActions.items && nextActions.items[0]) || { fixType: 'faq', title: 'FAQを追加' };
    var brand = (understanding && understanding.company) || 'サービス';
    var fixType = top.fixType || 'faq';
    if (String(fixType).indexOf('citation:') === 0) {
      var label = fixType.split(':')[1] || '';
      if (/FAQ/.test(label)) fixType = 'faq';
      else if (/比較/.test(label)) fixType = 'compare';
      else if (/Organization|LocalBusiness|Entity/.test(label)) fixType = 'jsonld-org';
      else if (/CTA|問い合わせ/.test(label)) fixType = 'cta';
      else if (/定義/.test(label)) fixType = 'meta';
      else if (/料金/.test(label)) fixType = 'compare';
      else fixType = page.faqCount < 3 ? 'faq' : 'meta';
    }
    if (fixType === 'noindex' || fixType === 'robots_block' || fixType === 'canonical' || fixType === 'https') {
      fixType = 'meta';
    }
    var fix = { type: fixType, title: top.title, dataKind: '下書き（ルール生成）', disclaimer: '無料の1件修正案です。公開前に人が確認してください。効果は保証しません。' };

    if (fixType === 'jsonld-org' || (!page.types.Organization && fixType.indexOf('jsonld') >= 0)) {
      fix.kind = 'JSON-LD';
      fix.filename = 'organization.jsonld';
      fix.content = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        'name': brand,
        'url': host ? 'https://' + host.replace(/^https?:\/\//, '') : '',
        'description': (page.metaDesc || (brand + 'の公式サイト')).slice(0, 160)
      }, null, 2);
    } else if (fixType === 'faq' || page.faqCount < 3) {
      fix.kind = 'FAQ HTML + JSON-LD';
      fix.filename = 'faq-snippet.html';
      var faqs = [
        { q: brand + 'とは何ですか？', a: brand + 'は、公開情報をもとに顧客の意思決定を支援するサービスです。対象と非対象を明確にし、次の相談先を示します。' },
        { q: 'どのような企業に向いていますか？', a: 'AI検索や比較検討の材料を整えたいマーケティング・事業責任者向けです。' },
        { q: '料金や導入の進め方は？', a: 'まずは現状診断のうえ、範囲と進め方をご提案します。詳細はお問い合わせください。' }
      ];
      var html = faqs.map(function (f) {
        return '<details><summary>' + f.q + '</summary><p>' + f.a + '</p></details>';
      }).join('\n');
      var ld = {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqs.map(function (f) {
          return { '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } };
        })
      };
      fix.content = html + '\n\n<script type="application/ld+json">\n' + JSON.stringify(ld, null, 2) + '\n</script>\n';
    } else if (fixType === 'compare' || !page.hasCompare) {
      fix.kind = '比較セクション下書き';
      fix.filename = 'compare-section.html';
      fix.content = [
        '<section>',
        '  <h2>' + brand + 'の選び方と比較のポイント</h2>',
        '  <p>結論：計測できるか、改善までつながるか、対象外が明示されているかを先に確認します。</p>',
        '  <table>',
        '    <thead><tr><th>評価軸</th><th>' + brand + '</th><th>一般的なSEO支援</th><th>計測SaaSのみ</th></tr></thead>',
        '    <tbody>',
        '      <tr><td>AI回答の実測</td><td>HackⅡで対応（限定商用検証）</td><td>弱いことが多い</td><td>製品による</td></tr>',
        '      <tr><td>改善・実装</td><td>相談のうえ伴走</td><td>施策中心</td><td>計測中心</td></tr>',
        '      <tr><td>向いていない場合</td><td>成果保証だけが目的の場合</td><td>—</td><td>—</td></tr>',
        '    </tbody>',
        '  </table>',
        '</section>'
      ].join('\n');
    } else if (fixType === 'cta' || !page.hasContact) {
      fix.kind = 'CTAブロック';
      fix.filename = 'cta-block.html';
      fix.content = [
        '<section>',
        '  <h2>次の一歩</h2>',
        '  <p>AI検索での出方を確認し、直すべきページを一緒に整理します。</p>',
        '  <p><a href="/trillionbank/contact/#form">お問い合わせ</a> ／ <a href="/trillionbank/meeting/?type=company">商談を予約</a></p>',
        '</section>'
      ].join('\n');
    } else {
      fix.kind = 'Title / Meta / H1';
      fix.filename = 'meta-rewrite.txt';
      fix.content = [
        'Title: ' + brand + '｜AI検索の現在地を測り、選ばれない理由を直す',
        'Meta: ' + brand + 'の対象、できること、比較の観点、次の相談先を整理。掲載や成果は保証しません。',
        'H1: AIに選ばれているかを測り、選ばれない理由を1つ直す',
        '',
        'Answer-first: ' + brand + 'は、公開ページと測定データからAI検索上の現在地を可視化し、改善優先度を明確にします。'
      ].join('\n');
    }

    fix.upsell = {
      label: '残り施策も実装する',
      href: '/trillionbank/business/hack2/',
      note: 'HackⅡは測定と改善優先度の整理（限定商用検証・導入相談）。自動公開や成果保証はありません。'
    };
    return fix;
  }

  function buildConversionReadiness(page) {
    var pts = 0, max = 8;
    if (page.hasContact) pts += 4;
    if (page.hasPrice) pts += 2;
    if (has(page.text, /無料|資料|デモ|相談|予約|申し込み/)) pts += 2;
    var score = Math.round((pts / max) * 100);
    return {
      dataKind: '実測（公開ページ）',
      score: score,
      summary: score >= 70 ? '問い合わせ導線は一定ある' : 'AI露出後に進む導線が弱い可能性'
    };
  }

  function enrichResult(result, page, robotsText, baseHref) {
    var host = (result.plainSummary && result.plainSummary.host) || '';
    var understanding = buildUnderstandingMap(page, host);
    var highlights = buildPassageHighlights(page);
    var foundation = buildSearchFoundation(page, robotsText, baseHref);
    var coverage = buildDecisionCoverage(page, understanding);
    var citation = buildCitationGap(page, understanding);
    var conversion = buildConversionReadiness(page);
    var next3 = buildNextActions(page, foundation, coverage, citation, understanding);
    var freeFix = buildFreeFix(page, understanding, next3, host);

    var readiness = Math.round(
      (result.scores && result.scores.ai != null ? result.scores.ai : result.overall) * 0.35 +
      foundation.score * 0.25 +
      understanding.entityScore * 0.2 +
      conversion.score * 0.1 +
      Math.min(100, coverage.coveragePct) * 0.1
    );

    result.os = {
      positioning: {
        headline: 'AIに選ばれているかを測る。選ばれない理由を見つける。その場で1つ直す。',
        freeGoal: '分かったで終わらせず、1つ直せるところまで'
      },
      readiness: { score: readiness, dataKind: '実測合成（公開ページ）' },
      understanding: understanding,
      highlights: highlights,
      foundation: foundation,
      decisionCoverage: coverage,
      citationGap: citation,
      conversion: conversion,
      next3: next3,
      freeFix: freeFix
    };

    // Prefer OS next step in plain summary
    if (next3.items && next3.items[0]) {
      result.plainSummary = Object.assign({}, result.plainSummary || {}, {
        nextStep: next3.items[0].title,
        biggestProblem: foundation.blockers.length
          ? foundation.summary
          : (citation.summary || result.plainSummary.biggestProblem),
        verdict: understanding.summary
      });
    }
    return result;
  }

  window.AirReachOS = {
    enrichResult: enrichResult,
    buildUnderstandingMap: buildUnderstandingMap,
    buildFreeFix: buildFreeFix
  };
})();
