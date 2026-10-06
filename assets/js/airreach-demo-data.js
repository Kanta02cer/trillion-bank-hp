/**
 * AirReach 代理店向けデモ（/airreach/demo/）の架空データ。
 *   すべてデモ専用の架空の値。実在の顧客・計測・成果ではない。本番の DB・API には一切つながない。
 *   材料（診断・AI計測の回答・検索と訪問・施策）だけをここに置き、数字は本番と同じ集計（airreach-report.js の compileReport）で作る。
 *   そのため、ホーム・推移・レポートの数字・割合・前月との差は必ず一致する。
 */
(function (root) {
  'use strict';
  var CLIENT = { id: 'demo-hana', name: 'サンプル美容室 Hana', industry_id: 'clinic' };
  var SITE = 'https://hana-salon.example/';
  var HOST = 'hana-salon.example';
  var MONTHS = ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'];
  var PUBLISHED = ['2026-07-01', '2026-08-01', '2026-09-01']; // お客様に公開済みの月次レポート（見本）

  // ---- 診断（点数の項目）。項目の満たし方から点数を計算する（本番の重みと同じ） ----
  var FACTOR_OF = {
    'ページタイトルがある': 'structure', 'H1が1つ': 'structure', '説明文（meta）が十分': 'structure', 'canonicalがある': 'structure', 'og:titleがある': 'structure', '本文量がある': 'structure',
    '会社情報（Organization等）': 'entity', 'WebSite / WebPage': 'entity', 'Service / Product': 'entity', 'BreadcrumbList': 'entity', '問い合わせ導線': 'entity',
    'FAQPageがある': 'faq', 'FAQが3問以上': 'faq', '画面上のFAQらしき領域': 'faq',
    'llms.txtがある': 'discover', 'robots.txtがある': 'discover', '主要AIボットの記載': 'discover', 'sitemap案内': 'discover'
  };
  var WEIGHT = { structure: 0.30, entity: 0.25, faq: 0.20, discover: 0.25 };
  // 月ごとに満たしていない項目（直していくと減る）
  var FAILING = {
    '2026-04': ['説明文（meta）が十分', 'og:titleがある', '会社情報（Organization等）', 'Service / Product', 'BreadcrumbList', 'FAQPageがある', 'FAQが3問以上', '画面上のFAQらしき領域', 'llms.txtがある', '主要AIボットの記載'],
    '2026-05': ['og:titleがある', '会社情報（Organization等）', 'Service / Product', 'BreadcrumbList', 'FAQPageがある', 'FAQが3問以上', '画面上のFAQらしき領域', 'llms.txtがある', '主要AIボットの記載'],
    '2026-06': ['og:titleがある', 'Service / Product', 'BreadcrumbList', 'FAQPageがある', 'FAQが3問以上', '画面上のFAQらしき領域', 'llms.txtがある', '主要AIボットの記載'],
    '2026-07': ['Service / Product', 'BreadcrumbList', 'FAQPageがある', 'llms.txtがある', '主要AIボットの記載'],
    '2026-08': ['Service / Product', 'BreadcrumbList', 'llms.txtがある', '主要AIボットの記載'],
    '2026-09': ['BreadcrumbList', 'llms.txtがある', '主要AIボットの記載']
  };
  function scanFor(m, i) {
    var fail = FAILING[m.slice(0, 7)];
    var per = {}, got = {};
    var checks = Object.keys(FACTOR_OF).map(function (label) {
      var f = FACTOR_OF[label], ok = fail.indexOf(label) < 0;
      per[f] = (per[f] || 0) + 10; got[f] = (got[f] || 0) + (ok ? 10 : 0);
      return { label: label, factor: f, state: ok ? 'ok' : 'ng', points: ok ? 10 : 0, max: 10 };
    });
    var factors = {}, overall = 0;
    Object.keys(per).forEach(function (f) { factors[f] = Math.round(got[f] / per[f] * 100); overall += factors[f] * WEIGHT[f]; });
    var day = m.slice(0, 8) + '05T01:00:00Z';
    var has = function (label) { return fail.indexOf(label) < 0; };
    var hasOrg = has('会社情報（Organization等）');
    // 構造化データの種類は、その月の項目の満たし方と合わせる
    var types = ['WebSite'].concat(hasOrg ? ['HairSalon'] : [], has('Service / Product') ? ['Service'] : [], has('BreadcrumbList') ? ['BreadcrumbList'] : [], has('FAQPageがある') ? ['FAQPage'] : []);
    var blocks = [{ types: ['WebSite'], fields: { name: CLIENT.name, url: SITE } }];
    if (hasOrg) blocks.unshift({ types: ['HairSalon'], fields: { name: CLIENT.name, url: SITE, address: '150-0000 東京都 渋谷区（架空）', telephone: '03-0000-0000（架空）' } });
    if (has('Service / Product')) blocks.push({ types: ['Service'], fields: { name: 'カット・カラー（架空のメニュー）', url: SITE + 'menu/' } });
    if (has('FAQPageがある')) blocks.push({ types: ['FAQPage'], fields: { questions: '予約はできますか？ ／ 料金の目安は？ ／ 駐車場はありますか？ ほか（8問・架空）' } });
    return {
      id: 'demo-scan-' + i, createdAt: day, fetchedAt: day, url: SITE, host: HOST, ruleVersion: 'demo', overallScore: Math.round(overall), factors: factors, gaps: fail.slice(), checks: checks,
      scope: { diagnosedAt: day, page: { url: SITE, finalUrl: SITE, status: 200 }, subpages: [{ url: SITE + 'menu/', role: 'price', ok: true, status: 200 }, { url: SITE + 'access/', role: 'access', ok: true, status: 200 }] },
      types: types, ld: { blocks: blocks, scripts: blocks.length, errors: 0 },
      robots: { state: 'ok', url: SITE + 'robots.txt', bots: [{ name: 'GPTBot', org: 'OpenAI', verdict: 'unspecified', via: 'none', lines: [] }, { name: 'Googlebot', org: 'Google', verdict: 'allowed', via: '*', lines: [] }] },
      evidence: { llms: { state: 'missing' } }, pageInfo: { hasLlms: false, finalUrl: SITE }
    };
  }

  // ---- AI 計測（固定10問 × 3つの AI）。回答ごとの記録から、AI ごと・一般／指名ごとの数を数える ----
  var PROMPTS = ['サンプル美容室 Hana はどんなお店ですか？', 'サンプル美容室 Hana の料金を教えて', '渋谷でおすすめの美容室は？', '渋谷 美容室 カット 上手い', '渋谷で予約しやすい美容室は？',
    '渋谷 美容室 髪質改善', '渋谷 美容室 メンズ', '渋谷 美容室 子連れ', '渋谷 美容室 駐車場', '渋谷 美容室 夜遅くまで'];
  var BRANDED = 2;
  // 架空の競合（1社はサイトの URL を登録・もう1社は未登録＝出典は判定しない）
  var COMPETITORS = [{ name: 'サロン・ルミエール（架空）', url: 'https://salon-lumiere.example/' }, { name: 'ヘアサロン ソラ（架空）', url: '' }];
  var ENGINES = [['Perplexity', 'perplexity', 'perplexity/sonar'], ['Google AI Overviews', 'google_aio', 'serpapi/google_ai_overview'], ['Google AI Mode', 'google_ai_mode', 'serpapi/google_ai_mode']];
  // 月ごと・AI ごとの見本：一般質問8問のうち、社名が出た数・自社が出典になった数・判定できない数・表示なしの数
  var PLAN = {
    '2026-06': { perplexity: [1, 0, 3, 0], google_aio: [1, 0, 0, 3], google_ai_mode: [1, 1, 0, 0] },
    '2026-07': { perplexity: [2, 1, 3, 0], google_aio: [1, 1, 0, 3], google_ai_mode: [2, 1, 0, 0] },
    '2026-08': { perplexity: [2, 1, 2, 0], google_aio: [2, 1, 0, 2], google_ai_mode: [2, 2, 0, 0] },
    '2026-09': { perplexity: [3, 2, 2, 0], google_aio: [3, 2, 0, 2], google_ai_mode: [3, 3, 0, 1] }
  };
  function runFor(m) {
    var plan = PLAN[m.slice(0, 7)];
    if (!plan) return null;
    var at = m.slice(0, 8) + '18T01:00:00Z';
    var answers = [];
    ENGINES.forEach(function (e) {
      var p = plan[e[1]], mention = p[0], cite = p[1], undetermined = p[2], notShown = p[3];
      PROMPTS.forEach(function (q, i) {
        var branded = i < BRANDED, k = i - BRANDED; // k: 一般質問の番号（0〜7）
        var a = { prompt: q, engine: e[1], status: 'ok', branded: branded, measured_at: at, model: e[2], conditions: { engine: e[1], model: e[2], via: e[1] === 'perplexity' ? 'ai-gateway' : 'direct', search: true, location: 'JP' } };
        if (!branded && k >= 8 - notShown) { a.status = 'not_shown'; a.mentioned = null; a.cited = null; a.cite_source = 'not_shown'; a.citations = []; a.urls_in_answer = []; a.answer = ''; a.competitors = COMPETITORS.map(function (c) { return { name: c.name, mentioned: null, cited: null }; }); a.order = []; a.self_rank = null; answers.push(a); return; }
        var men = branded ? 1 : (k < mention ? 1 : 0);
        var src = e[1] === 'perplexity' ? 'answer_text' : 'ai_sources';
        var cited;
        if (branded) cited = 1;
        else if (e[1] === 'perplexity' && k >= 8 - notShown - undetermined) { cited = null; src = 'none'; }
        else cited = k < cite ? 1 : 0;
        var other = 'https://salon-guide.example/shibuya/';
        a.mentioned = men; a.cited = cited; a.cite_source = src;
        a.citations = src === 'ai_sources' ? (cited ? [SITE, other] : [other, 'https://beauty-portal.example/']) : [];
        a.urls_in_answer = src === 'answer_text' ? (cited ? [SITE] : [other]) : [];
        a.cited_by_sources = src === 'ai_sources' ? cited : null;
        a.self_url_in_text = src === 'answer_text' ? cited : null;
        // 競合：指名質問では出ない。一般質問ではルミエールが多めに、ソラが少し出る（月を追っても大きくは変えない）
        var lum = !branded && k < 5 ? 1 : 0, sora = !branded && (k === 2 || k === 3) ? 1 : 0;
        var lumCited = src === 'ai_sources' ? (lum && k < 3 ? 1 : 0) : (src === 'answer_text' ? (lum && k < 2 ? 1 : 0) : null);
        a.competitors = [{ name: COMPETITORS[0].name, mentioned: lum, cited: lumCited }, { name: COMPETITORS[1].name, mentioned: sora, cited: null }];
        var order = [];
        if (lum && !(men && k % 2 === 1)) order.push(COMPETITORS[0].name);
        if (men) order.push(CLIENT.name);
        if (lum && men && k % 2 === 1) order.push(COMPETITORS[0].name);
        if (sora) order.push(COMPETITORS[1].name);
        a.order = order; a.self_rank = men ? order.indexOf(CLIENT.name) + 1 : null;
        a.answer = '【デモ用の架空の回答】' + (men ? CLIENT.name + ' は、' : '') + '「' + q + '」への回答の見本です。実際の AI の回答ではありません。';
        answers.push(a);
      });
    });
    // 本番の要約と同じ数え方：表示なし・エラーは分母に入れない
    var by = ENGINES.map(function (e) {
      var rows = answers.filter(function (a) { return a.engine === e[1]; }), ok = rows.filter(function (a) { return a.status === 'ok'; });
      var judged = ok.filter(function (a) { return a.cited === 0 || a.cited === 1; }), cited = judged.filter(function (a) { return a.cited === 1; }).length, men = ok.filter(function (a) { return a.mentioned; }).length;
      return { provider: e[1], model: e[2], group: 'main', label: 'デモ', denominator: ok.length, judged: judged.length, either: { rate: judged.length ? Math.round(cited / judged.length * 1000) / 10 : null, numerator: cited, denominator: judged.length },
        cited_by_sources: ok.filter(function (a) { return a.cite_source === 'ai_sources'; }).length, mention_count: men, service_mention_rate: ok.length ? Math.round(men / ok.length * 1000) / 10 : null, sov: null,
        not_shown_count: rows.length - ok.length, error_count: 0 };
    });
    function type(br) {
      var rows = answers.filter(function (a) { return a.branded === br; }), ok = rows.filter(function (a) { return a.status === 'ok'; }), j = ok.filter(function (a) { return a.cited === 0 || a.cited === 1; });
      return { answers: ok.length, mention: ok.filter(function (a) { return a.mentioned; }).length, cite: j.filter(function (a) { return a.cited === 1; }).length, citeJudged: j.length, notShown: rows.length - ok.length, errors: 0 };
    }
    var dom = {};
    answers.forEach(function (a) { (a.citations || []).forEach(function (u) { var h = u.replace(/^https?:\/\//, '').split('/')[0]; dom[h] = dom[h] || {}; dom[h][a.engine] = (dom[h][a.engine] || 0) + 1; }); });
    return { measured_on: m.slice(0, 8) + '18', created_at: at, source: 'manual',
      summary: { source: 'studio', run_id: 'demo-' + m, query_set_version: 'demo-v1', by: by, breakdown: { types: { general: type(false), branded: type(true) } },
        cited_domains: Object.keys(dom).map(function (h) { return [h, dom[h]]; }), target_citations: answers.filter(function (a) { return (a.citations || []).indexOf(SITE) >= 0; }).slice(0, 6).map(function (a) { return { provider: a.engine, query: a.prompt, url: SITE, match_type: 'self_host' }; }),
        answers: answers } };
  }

  // ---- 検索と訪問（Search Console・GA4 の形の架空の値）----
  var GSC = { '2026-04': [120, 3800, 14.2], '2026-05': [131, 4010, 13.6], '2026-06': [148, 4350, 12.9], '2026-07': [166, 4720, 12.1], '2026-08': [184, 5030, 11.4], '2026-09': [203, 5410, 10.8] };
  var GA4 = { '2026-04': [610, 2, 9], '2026-05': [640, 3, 10], '2026-06': [688, 4, 11], '2026-07': [722, 6, 12], '2026-08': [760, 7, 14], '2026-09': [801, 9, 15] };
  function trafficFor(m) {
    var k = m.slice(0, 7), g = GSC[k], a = GA4[k], end = m.slice(0, 8) + '28';
    return [{ period_month: m, source: 'gsc_api', metrics: { clicks: g[0], impressions: g[1], position: g[2], start_date: m, end_date: end, days: 28, property: 'sc-domain:' + HOST } },
      { period_month: m, source: 'ga4_api', metrics: { sessions: a[0], ai_sessions: a[1], conversions: a[2], start_date: m, end_date: end, host: HOST } }];
  }

  // ---- 施策（実施済み・予定）----
  var ACTIONS = [
    { title: 'トップページの紹介文（meta description）を書き直す', status: 'done', done_on: '2026-05-12', evidence_url: SITE },
    { title: 'お店の情報を、検索や AI が読み取れる形（構造化データ）でトップページに入れる', status: 'done', done_on: '2026-06-10', evidence_url: SITE },
    { title: 'SNS で共有されたときの題名（og:title）を入れる', status: 'done', done_on: '2026-07-08', evidence_url: SITE },
    { title: 'よくある質問のページを作る（料金・予約・駐車場など8問）', status: 'done', done_on: '2026-07-22', evidence_url: SITE + 'faq/' },
    { title: 'よくある質問を、検索や AI が読み取れる形でも入れる', status: 'done', done_on: '2026-08-19', evidence_url: SITE + 'faq/' },
    { title: 'メニューと料金のページを、検索や AI が読み取れる形（Service）でも書く', status: 'done', done_on: '2026-09-09', evidence_url: SITE + 'menu/' },
    { title: 'AI 向けの案内ファイル（llms.txt）を置く', status: 'planned', done_on: '2026-10-15' },
    { title: 'ページの階層（パンくずリスト）を入れる', status: 'planned', done_on: '2026-10-31' }
  ];

  var scans = MONTHS.map(scanFor), runs = MONTHS.map(runFor).filter(Boolean), traffic = [].concat.apply([], MONTHS.map(trafficFor));
  var R = root.AirReachReport;
  function compile(m) {
    var end = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0, 12));
    return R.compileReport({ client: CLIENT, periodMonth: m, now: end, scans: scans, runs: runs, traffic: traffic, actions: ACTIONS });
  }
  // 結論は、その月の数字から作る（数字と食い違わないように）。成果や因果関係は断定しない
  function conclusionsOf(c) {
    var s = c.site || {}, cur = s.current, prev = s.previous, out = [];
    if (cur && prev) out.push('ホームページの情報整備の点数は ' + prev.overall + '点 → ' + cur.overall + '点 になりました（前月の診断と同じ基準）。');
    var ai = c.ai, aio = ai && ai.providers.filter(function (p) { return p.provider === 'google_ai_mode'; })[0];
    if (aio && aio.citeRate != null) out.push('Google の AI モードで、公式サイトが出典になった回答は ' + aio.citeCount + ' ÷ ' + aio.judged + '（' + aio.citeRate + '%）でした。');
    var g = c.traffic && c.traffic.gsc, gp = c.traffic && c.traffic.gscPrev;
    if (g && gp) out.push('検索からのクリックは ' + gp.clicks + '回 → ' + g.clicks + '回 でした（増減の理由は施策だけとは限りません）。');
    return out;
  }
  var NEXT = {
    '2026-07': [{ title: 'よくある質問を、検索や AI が読み取れる形でも入れる', owner: '制作会社', due: '8/20' }, { title: 'メニューと料金のページを構造化データで書く', owner: '制作会社', due: '9/10' }, { title: 'AI 向けの案内ファイルを置く', owner: '制作会社', due: '10/15' }],
    '2026-08': [{ title: 'メニューと料金のページを構造化データで書く', owner: '制作会社', due: '9/10' }, { title: 'AI 向けの案内ファイルを置く', owner: '制作会社', due: '10/15' }, { title: 'ページの階層（パンくずリスト）を入れる', owner: '制作会社', due: '10/31' }],
    '2026-09': [{ title: 'AI 向けの案内ファイル（llms.txt）を置く', owner: '制作会社', due: '10/15' }, { title: 'ページの階層（パンくずリスト）を入れる', owner: '制作会社', due: '10/31' }, { title: 'よくある質問に「キッズスペース」を足す', owner: 'お店', due: '10/31' }]
  };
  var DECISIONS = { '2026-07': ['よくある質問に載せる料金の書き方（税込の表記）'], '2026-08': ['メンズカットのメニューを、よくある質問に載せるか'], '2026-09': ['キッズスペースの有無を、よくある質問に書いてよいか'] };
  var reports = PUBLISHED.map(function (m) {
    var c = compile(m);
    return { id: 'demo-' + m.slice(0, 7), period_month: m, status: 'published', published_at: m.slice(0, 7) === '2026-09' ? '2026-10-02T01:00:00Z' : (m.slice(0, 5) + String(+m.slice(5, 7) + 1).padStart(2, '0') + '-02T01:00:00Z'),
      compiled: c, conclusions: conclusionsOf(c), next_actions: NEXT[m.slice(0, 7)], client_decisions: DECISIONS[m.slice(0, 7)] };
  }).reverse(); // 新しい順

  root.AirReachDemoData = { client: CLIENT, site: SITE, reports: reports, actions: ACTIONS, sample: 'SAMPLE／デモ用の架空データ' };
})(typeof window !== 'undefined' ? window : this);
