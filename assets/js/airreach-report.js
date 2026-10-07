/**
 * AirReach 月次レポート — 材料（診断・AI計測・流入・施策）から下書きを組み立てる。
 * 画面（airreach-console.js）とは切り離し、Node でも単体テストできる純粋関数だけを置く。
 *
 * 方針
 *   - 数字は材料にあるものだけを使う。無いものは null（画面では「—」や「未計測」）。推定で埋めない。
 *   - 自動で作るのは「事実の変化」まで（点数 48→55、引用率 0%→20% など）。結論・次の施策は担当者が書く。
 */
(function (root) {
  'use strict';

  // 診断のチェック名 → 不足のときの言い方（airreach-diagnose.js の CHECK_CRITERIA の ng と同じ。変えるときは両方）
  var GAP_TEXT = {
    'ページタイトルがある': 'ページタイトル（title）が無い',
    'H1が1つ': '主見出し（H1）が0個か、2個以上ある',
    '説明文（meta）が十分': '説明文（meta description）が無いか、40文字未満',
    'canonicalがある': '正規URL（canonical）の指定が無い',
    'og:titleがある': '共有用タイトル（og:title）が無い',
    '本文量がある': '本文が800文字以下',
    '会社情報（Organization等）': '会社・お店の構造化データ（Organization / LocalBusiness）が無い',
    'WebSite / WebPage': 'サイト種別の構造化データ（WebSite / WebPage）が無い',
    'Service / Product': 'サービス・商品の構造化データ（Service / Product）が無い',
    'BreadcrumbList': 'ページ階層の構造化データ（BreadcrumbList）が無い',
    '問い合わせ導線': '問い合わせ・予約・相談の案内が無い',
    'FAQPageがある': 'FAQの構造化データ（FAQPage）が無い',
    'FAQが3問以上': 'FAQが3問未満',
    '画面上のFAQらしき領域': '画面にFAQのまとまりが無い',
    'llms.txtがある': 'llms.txt が無いか、80文字以下',
    'robots.txtがある': 'robots.txt が無い',
    '主要AIボットの記載': 'robots.txt にAIボット（GPTBot など）の記載が無い',
    'sitemap案内': 'robots.txt にサイトマップの案内が無い'
  };
  function gapText(label) { return GAP_TEXT[label] || label; }

  // 不足ごとの「直すこと」。配点は airreach-diagnose.js の check() と同じ（変えるときは両方）。
  // studio: 直す材料（/airreach/studio/）で下書きを作れるもの
  var FACTOR_LABEL = { structure: 'ページの骨格', entity: '会社・お店の情報', faq: 'よくある質問', discover: '見つけやすさ' };
  var FIX_INFO = {
    'ページタイトルがある': { factor: 'structure', points: 2, why: '検索結果やAIが、ページの主題を読む最初の手がかりになります。', how: '店名・会社名と、何のページかが分かるタイトル（title）を設定する。' },
    'H1が1つ': { factor: 'structure', points: 3, why: '主題が一目で分かる見出しが1つだけあると、内容を取り違えられにくくなります。', how: 'ページの主見出し（H1）を1つにし、店名・サービス名を入れる。' },
    '説明文（meta）が十分': { factor: 'structure', points: 2, why: '検索結果に出る説明文で、誰向けの何のページかが伝わります。', how: '40文字以上の説明文（meta description）を書く。対象・内容・場所を入れる。' },
    'canonicalがある': { factor: 'structure', points: 2, why: '同じ内容のURLが複数あるとき、正しいURLを示せます。', how: '正規URL（canonical）をページごとに指定する。' },
    'og:titleがある': { factor: 'structure', points: 1, why: 'SNSやチャットで共有されたときの見出しになります。', how: '共有用タイトル（og:title）を設定する。' },
    '本文量がある': { factor: 'structure', points: 2, why: '案内の文章が少ないと、AIや検索が内容を判断する材料が足りません。', how: 'サービス内容・料金の目安・対象・場所など、来店前・相談前に知りたいことを本文に書き足す。' },
    '会社情報（Organization等）': { factor: 'entity', points: 4, why: '誰のサイトか（正式名称・所在地・連絡先）を機械が読めると、取り違えられにくくなります。', how: '会社・お店の構造化データ（Organization / LocalBusiness）を入れる。', studio: true },
    'WebSite / WebPage': { factor: 'entity', points: 2, why: 'サイトとページの種類を機械が読めるようになります。', how: 'サイト種別の構造化データ（WebSite / WebPage）を入れる。' },
    'Service / Product': { factor: 'entity', points: 2, why: '何を提供しているかを機械が読めるようになります。', how: 'サービス・商品の構造化データ（Service / Product）を入れる。', studio: true },
    'BreadcrumbList': { factor: 'entity', points: 1, why: 'ページの階層（どこの何のページか）が伝わります。', how: 'ページ階層の構造化データ（BreadcrumbList）を入れる。' },
    '問い合わせ導線': { factor: 'entity', points: 1, why: '興味を持った人が、次に何をすればよいか分かります。', how: '予約・問い合わせ・相談の案内（ボタンやリンク）を目立つ位置に置く。' },
    'FAQPageがある': { factor: 'faq', points: 3, why: 'よくある質問と答えを機械が読める形にすると、AIの回答の材料になりやすくなります。', how: '画面のFAQと同じ内容で、FAQの構造化データ（FAQPage）を入れる。', studio: true },
    'FAQが3問以上': { factor: 'faq', points: 3, why: '決める前に聞かれることに、公式の答えが用意されている状態になります。', how: '予約・料金・駐車場・支払い方法など、よく聞かれる質問を3問以上書く。', studio: true },
    '画面上のFAQらしき領域': { factor: 'faq', points: 2, why: '人が読めるFAQがあると、機械向けのデータと内容をそろえられます。', how: 'ページに「よくある質問」の見出しとQ&Aのまとまりを置く。' },
    'llms.txtがある': { factor: 'discover', points: 4, why: 'AI向けに、サイトの概要と重要なページを案内するファイルです。', how: 'サイトの一番上の階層に llms.txt（81文字以上）を置く。', studio: true },
    'robots.txtがある': { factor: 'discover', points: 2, why: '検索やAIのクローラーに、読んでよい範囲を伝えるファイルです。', how: 'サイトの一番上の階層に robots.txt を置く。' },
    '主要AIボットの記載': { factor: 'discover', points: 2, why: 'AIのクローラーへの方針（読んでよいか）が明示されます。', how: 'robots.txt に GPTBot などAIボットへの方針を書く。' },
    'sitemap案内': { factor: 'discover', points: 2, why: 'クローラーがページの一覧を見つけやすくなります。', how: 'robots.txt に Sitemap: の行でサイトマップのURLを書く。' }
  };
  // お客様向けの言い方（専門用語を使わない）。社内の画面は FIX_INFO / GAP_TEXT の正確な用語のまま。
  // t: 足りないこと / how: 直し方 / why: 直すと何がよいか。効果を約束する言い方はしない
  var PLAIN = {
    'ページタイトルがある': { ok: 'ページの題名が入った', t: '検索結果に出るページの題名が無い', how: 'ページの題名に、店名・会社名と何のページかを入れる', why: '検索やAIが、何のページかを最初に判断する手がかりになります。' },
    'H1が1つ': { ok: 'ページの一番大きな見出しが1つにそろった', t: 'ページの一番大きな見出しが無いか、2つ以上ある', how: 'ページの一番大きな見出しを1つにし、店名・サービス名を入れる', why: '何のページかが一目で伝わり、内容を取り違えられにくくなります。' },
    '説明文（meta）が十分': { ok: '検索結果に出る紹介文が入った', t: '検索結果に出る紹介文が無いか、短い', how: '検索結果に出る紹介文（40文字以上）に、誰向けの何のお店・サービスかと場所を書く', why: '検索結果を見た人に、どんなお店・サービスかが伝わります。' },
    'canonicalがある': { ok: 'ページの正式なURLが指定された', t: 'ページの正式なURLが指定されていない', how: '同じページが複数のURLで開ける場合に、正式なURLを指定する（制作会社に依頼）', why: '検索やAIが、どのURLを正式なページとして扱うか迷わなくなります。' },
    'og:titleがある': { ok: 'SNSやLINEで共有されたときの題名が入った', t: 'SNSやLINEで共有されたときの題名が無い', how: 'SNSやLINEで共有されたときに表示される題名を設定する', why: '共有されたときに、何のページかが伝わります。' },
    '本文量がある': { ok: 'ページの説明の文章が十分になった', t: 'ページの説明の文章が少ない', how: 'メニュー・料金の目安・場所・予約方法など、来店や相談の前に知りたいことを書き足す', why: '文章が少ないと、検索やAIがお店の内容を判断できません。' },
    '会社情報（Organization等）': { ok: 'お店・会社の基本情報が、検索やAIが読み取れる形になった', t: 'お店・会社の基本情報が、検索やAIが読み取れる形になっていない', how: '店名・住所・電話番号・営業時間などを、検索やAIが読み取れる形式でサイトに埋め込む', why: '誰のサイトかを正しく認識され、ほかのお店・会社と取り違えられにくくなります。' },
    'WebSite / WebPage': { ok: 'サイト名やページの種類が、検索やAIが読み取れる形になった', t: 'サイト名やページの種類が、検索やAIが読み取れる形になっていない', how: 'サイト名やページの種類を、検索やAIが読み取れる形式で埋め込む', why: 'サイトとページの関係が伝わりやすくなります。' },
    'Service / Product': { ok: '提供しているサービス・商品が、検索やAIが読み取れる形になった', t: '提供しているサービス・商品が、検索やAIが読み取れる形になっていない', how: 'サービス・商品の名前と内容を、検索やAIが読み取れる形式で埋め込む', why: '何を提供しているお店・会社かが伝わりやすくなります。' },
    'BreadcrumbList': { ok: 'サイトの中でのページの位置が、読み取れる形になった', t: 'サイトの中でのページの位置が、読み取れる形になっていない', how: 'ページの位置（トップ ＞ メニュー など）を、検索やAIが読み取れる形式で埋め込む', why: 'どこの何のページかが伝わります。' },
    '問い合わせ導線': { ok: '予約・問い合わせの案内が入った', t: '予約・問い合わせの案内が見当たらない', how: '予約・問い合わせのボタンやリンクを、目立つ位置に置く', why: '興味を持った人が、次に何をすればよいか分かります。' },
    'FAQPageがある': { ok: 'よくある質問が、検索やAIが読み取れる形になった', t: 'よくある質問が、検索やAIが読み取れる形になっていない', how: 'ページに載せている「よくある質問」と同じ内容を、検索やAIが読み取れる形式でも埋め込む', why: 'AIが回答するときに参考にできる、お店の公式の答えになります。' },
    'FAQが3問以上': { ok: 'よくある質問が3問以上になった', t: 'よくある質問が3問より少ない', how: '予約・料金・駐車場・支払い方法など、よく聞かれる質問と答えを3問以上書く', why: '来店や相談の前に知りたいことに、お店が公式に答えている状態になります。' },
    '画面上のFAQらしき領域': { ok: 'ページに「よくある質問」のまとまりができた', t: 'ページに「よくある質問」のまとまりが無い', how: 'ページに「よくある質問」の見出しを作り、質問と答えをまとめて載せる', why: 'お客様が自分で答えを見つけやすくなります。' },
    'llms.txtがある': { ok: 'AI向けのサイト案内のファイルが置かれた', t: 'AI向けのサイト案内のファイルが無い', how: 'サイトの概要と主なページを書いた、AI向けの案内ファイルを置く（制作会社に依頼）', why: 'AIがサイトの内容を把握するための補助になります。' },
    'robots.txtがある': { ok: '検索やAIの巡回ロボット向けの案内ファイルが置かれた', t: '検索やAIの巡回ロボット向けの案内ファイルが無い', how: 'サイトのどこを読んでよいかを伝える案内ファイルを置く（制作会社に依頼）', why: '検索やAIの巡回ロボットに、読んでよい範囲を伝えられます。' },
    '主要AIボットの記載': { ok: 'AIの巡回ロボットへの方針が書かれた', t: 'AIの巡回ロボットへの方針が書かれていない', how: '巡回ロボット向けの案内ファイルに、ChatGPT などのAIのロボットを受け入れるかどうかを書く（制作会社に依頼）', why: 'AIの巡回ロボットが、サイトを読んでよいか判断できます。' },
    'sitemap案内': { ok: 'サイトのページ一覧の場所が案内された', t: 'サイトのページ一覧の場所が案内されていない', how: '巡回ロボット向けの案内ファイルに、ページ一覧（サイトマップ）の場所を書く（制作会社に依頼）', why: '検索やAIが、サイトのページを見つけやすくなります。' }
  };
  /** お客様向けの「直ったこと」（前月から解消した不足）。肯定の言い方にする */
  function plainResolved(labelOrText) {
    var k = PLAIN[labelOrText] ? labelOrText : TEXT_TO_KEY[labelOrText];
    return k && PLAIN[k] && PLAIN[k].ok ? PLAIN[k].ok : labelOrText;
  }
  /** お客様向けの「足りないこと」。チェック名でも、社内向けの言い方でも受け付ける */
  function plainGap(labelOrText) {
    var k = PLAIN[labelOrText] ? labelOrText : TEXT_TO_KEY[labelOrText];
    return k && PLAIN[k] ? PLAIN[k].t : labelOrText;
  }

  var TEXT_TO_KEY = {};
  Object.keys(GAP_TEXT).forEach(function (k) { TEXT_TO_KEY[GAP_TEXT[k]] = k; });

  /**
   * 最新の診断の不足を「直すこと」にして、配点の大きい順に並べる。
   * @returns {Array<{key,text,factor,factorLabel,points,why,how,studio}>}
   */
  // 各項目の判定基準（お客様向けの言い方）。ラベルと配点は airreach-diagnose.js と同じ（unit-report で一致を確かめる）
  var CRITERIA = {
    'ページタイトルがある': 'ページの題名（title）が入っているか',
    'H1が1つ': 'ページの一番大きな見出し（H1）がちょうど1つか',
    '説明文（meta）が十分': '検索結果に出る紹介文（meta description）が40文字以上あるか',
    'canonicalがある': 'ページの正式なURL（canonical）が指定されているか',
    'og:titleがある': 'SNSやLINEで共有されたときの題名（og:title）があるか',
    '本文量がある': 'ページの本文が800文字を超えるか',
    '会社情報（Organization等）': '会社・お店の情報が、検索やAIが読み取れる形（構造化データの Organization / LocalBusiness）で書かれているか',
    'WebSite / WebPage': 'サイトとページの種類が、構造化データ（WebSite / WebPage）で書かれているか',
    'Service / Product': 'サービス・商品が、構造化データ（Service / Product）で書かれているか',
    'BreadcrumbList': 'ページの階層が、構造化データ（BreadcrumbList）で書かれているか',
    '問い合わせ導線': '問い合わせ・予約・相談の案内がページにあるか',
    'FAQPageがある': 'よくある質問が、構造化データ（FAQPage）で書かれているか',
    'FAQが3問以上': 'よくある質問が3問以上あるか',
    '画面上のFAQらしき領域': '画面に「よくある質問」のまとまりがあるか',
    'llms.txtがある': 'AI向けの案内ファイル（llms.txt）があり、81文字以上書かれているか',
    'robots.txtがある': '検索やAIのロボット向けの案内ファイル（robots.txt）があるか',
    '主要AIボットの記載': 'robots.txt に、AIのロボット（GPTBot など）への指定が書かれているか',
    'sitemap案内': 'robots.txt に、サイトの地図（sitemap）の場所が書かれているか'
  };
  // 総合点の重み（airreach-diagnose.js の FACTORS と同じ）
  var FACTOR_WEIGHT = { structure: 0.30, entity: 0.25, faq: 0.20, discover: 0.25 };
  var LD_CHECKS = { '会社情報（Organization等）': 1, 'WebSite / WebPage': 1, 'Service / Product': 1, 'BreadcrumbList': 1, 'FAQPageがある': 1 };
  var VERDICT_JA = { allowed: '許可', partial: '一部のページだけ拒否', blocked: '拒否', unspecified: '指定なし（許可と同じ）' };
  var ROLE_JA = { menu: 'メニュー・料金', access: 'アクセス・店舗情報', reserve: '予約', faq: 'よくある質問' };

  // llms.txt の状態: ファイルが無い／あるが短い／ある／確認できなかった
  function llmsStatus(s) {
    var st = s && s.evidence && s.evidence.llms && s.evidence.llms.state;
    var has = s && s.pageInfo ? s.pageInfo.hasLlms : null;
    if (st === 'missing') return { key: 'missing', text: 'ファイルがありません' };
    if (st === 'ok' && has === false) return { key: 'short', text: 'ファイルはありますが、80文字以下のため内容が足りないと判定しました' };
    if (st === 'ok' || has === true) return { key: 'ok', text: 'ファイルがあり、81文字以上書かれています' };
    return { key: 'unknown', text: '取得できなかったため、判定していません（0点ではありません）' };
  }

  // 項目ごとの「なぜこの結果か」。判定に使った事実を、分かる範囲で添える
  function checkReason(c, s) {
    if (c.state === 'unknown') return '読み取れなかったため、判定していません（0点ではなく、点数の計算から外しています）';
    var ok = c.state === 'ok';
    var types = (s.types || []).filter(Boolean);
    if (c.label === 'llms.txtがある') return llmsStatus(s).text;
    if (c.label === 'robots.txtがある') return ok ? 'ファイルがあります' : 'ファイルがありません';
    if (LD_CHECKS[c.label]) return (ok ? '該当する構造化データがありました' : '該当する構造化データがありません') + '（トップページで見つかった種類：' + (types.length ? types.join('、') : 'なし') + '）';
    if (c.label === 'FAQが3問以上') { var n = s.pageInfo && s.pageInfo.faqCount; return (n != null ? 'トップページで見つかったよくある質問：' + n + '問' : (ok ? '3問以上ありました' : '3問未満でした')); }
    if (c.label === '主要AIボットの記載' && s.robots && (s.robots.bots || []).length) {
      var own = s.robots.bots.filter(function (b) { return b.via === 'own'; }).map(function (b) { return b.name; });
      return own.length ? 'robots.txt に個別の指定があるAIのロボット：' + own.join('、') : 'robots.txt に、AIのロボットへの個別の指定がありません';
    }
    return ok ? '満たしています' : ((PLAIN[c.label] || {}).t || '満たしていません');
  }

  // 総合点の内訳: 分類ごとの点数 × 重み。判定できた分類だけで重みを配り直す（airreach-diagnose.js と同じ計算）
  function scoreBreakdown(factors, overall) {
    var keys = ['structure', 'entity', 'faq', 'discover'];
    var wsum = 0;
    keys.forEach(function (k) { if (factors && factors[k] != null) wsum += FACTOR_WEIGHT[k]; });
    var rows = keys.map(function (k) {
      var sc = factors ? factors[k] : null;
      var w = sc == null || !wsum ? null : FACTOR_WEIGHT[k] / wsum;
      return { factor: k, label: FACTOR_LABEL[k], score: sc == null ? null : sc, weight: FACTOR_WEIGHT[k], share: w == null ? null : Math.round(w * 1000) / 10,
        contribution: w == null ? null : Math.round(sc * w * 10) / 10 };
    });
    var total = rows.reduce(function (a, r) { return a + (r.contribution || 0); }, 0);
    return { rows: rows, total: Math.round(total * 10) / 10, overall: overall == null ? null : overall, redistributed: wsum > 0 && wsum < 0.999 };
  }

  // 診断の範囲（点数に使ったページ・読んだ下層ページ・案内ファイル）
  function scopeOf(s) {
    var sc = s.scope || null;
    var top = (sc && sc.page && (sc.page.finalUrl || sc.page.url)) || (s.pageInfo && s.pageInfo.finalUrl) || s.url || '';
    var subs = sc && Array.isArray(sc.subpages) ? sc.subpages.map(function (p) { return { url: p.url, role: ROLE_JA[p.role] || '', ok: !!p.ok, status: p.status == null ? null : p.status }; }) : null;
    return {
      diagnosedAt: (sc && sc.diagnosedAt) || s.fetchedAt || s.createdAt || null,
      scored: 'トップページ（' + top + '）と、案内ファイル（llms.txt・robots.txt）',
      topUrl: top,
      subpages: subs,
      pagesRead: subs ? 1 + subs.filter(function (p) { return p.ok; }).length : null,
      note: subs ? '下層ページは「お客さんの質問に答えが書いてあるか」を見るためだけに読み、点数には使っていません。' : '下層ページの記録はありません（この診断では保存していません）。'
    };
  }

  function siteDetail(s) {
    if (!s) return null;
    var checks = (s.checks || []).map(function (c) {
      var pl = PLAIN[c.label] || {};
      return { label: c.label, text: c.state === 'ok' ? (pl.ok || c.label) : (pl.t || gapText(c.label)), factor: c.factor, factorLabel: FACTOR_LABEL[c.factor] || '', state: c.state,
        points: c.points == null ? null : c.points, max: c.max == null ? null : c.max, rule: CRITERIA[c.label] || '', reason: checkReason(c, s), evidenceUrl: c.evidenceUrl || '' };
    });
    var bots = s.robots && Array.isArray(s.robots.bots) ? s.robots.bots.map(function (b) { return { name: b.name, org: b.org || '', verdict: b.verdict, verdictText: VERDICT_JA[b.verdict] || '—', via: b.via, lines: (b.lines || []).slice(0, 6).map(function (l) { return l && typeof l === 'object' ? (l.n ? l.n + '行目：' : '') + (l.text || '') : String(l || ''); }).filter(Boolean) }; }) : null;
    var ld = s.ld && Array.isArray(s.ld.blocks) ? { blocks: s.ld.blocks.slice(0, 12), scripts: s.ld.scripts || 0, errors: s.ld.errors || 0 } : null;
    return {
      fetchedAt: s.fetchedAt || null,
      checks: checks,
      adjustments: (s.adjustments || []).map(function (a) { return { factor: a.factor, factorLabel: FACTOR_LABEL[a.factor] || '', label: a.label, points: a.points }; }),
      breakdown: scoreBreakdown(s.factors || {}, s.overallScore),
      scope: scopeOf(s),
      types: (s.types || []).slice(0, 30),
      ld: ld,
      robots: s.robots ? { state: s.robots.state || null, url: s.robots.url || '', bots: bots } : null,
      llms: llmsStatus(s)
    };
  }

  function todoList(compiled) {
    var cur = compiled && compiled.site && compiled.site.current;
    if (!cur) return [];
    var keys = Array.isArray(cur.gapKeys) ? cur.gapKeys : (cur.gaps || []).map(function (t) { return TEXT_TO_KEY[t] || t; });
    var order = ['entity', 'faq', 'discover', 'structure'];
    return keys.map(function (k) {
      var f = FIX_INFO[k] || {};
      var pl = PLAIN[k] || {};
      var ck = (cur.detail && cur.detail.checks || []).filter(function (c) { return c.label === k; })[0] || null;
      var fs = cur.factors ? cur.factors[f.factor] : null;
      var basis = ck ? '診断で「' + (ck.factorLabel || FACTOR_LABEL[f.factor] || '') + '」の「' + (ck.rule || gapText(k)) + '」が満たされていなかった（' + (ck.points == null ? 0 : ck.points) + '／' + ck.max + '点）ため。' +
        (fs != null ? '「' + (FACTOR_LABEL[f.factor] || '') + '」は' + fs + '点です。' : '') : '';
      return { key: k, text: gapText(k), factor: f.factor || '', factorLabel: FACTOR_LABEL[f.factor] || '', points: f.points || 0, why: f.why || '', how: f.how || '', studio: !!f.studio,
        plainText: pl.t || gapText(k), plainHow: pl.how || f.how || '', plainWhy: pl.why || f.why || '', basis: basis };
    }).sort(function (a, b) { return (b.points - a.points) || (order.indexOf(a.factor) - order.indexOf(b.factor)); });
  }

  function monthStart(d) {
    var s = String(d || '').slice(0, 7);
    return /^\d{4}-\d{2}$/.test(s) ? s + '-01' : '';
  }
  function prevMonth(m) {
    var y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
    mo -= 1; if (mo === 0) { mo = 12; y -= 1; }
    return y + '-' + (mo < 10 ? '0' : '') + mo + '-01';
  }
  function monthEnd(m) {
    var y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
    var next = mo === 12 ? (y + 1) + '-01-01' : y + '-' + (mo + 1 < 10 ? '0' : '') + (mo + 1) + '-01';
    return next;
  }
  // 日時（2026-10-02T15:53:00Z など）は日本時間の日付に直す。日付だけ（2026-10-03）はそのまま。
  // 世界標準時のまま先頭10文字を取ると、日本時間の 0〜9 時の診断が前の日（月初なら前の月）になっていた
  function jstDay(v) {
    var t = String(v || '');
    if (!/[T ]\d{2}:\d{2}/.test(t)) return t.slice(0, 10);
    var ms = Date.parse(t);
    if (isNaN(ms)) return t.slice(0, 10);
    var d = new Date(ms + 9 * 3600 * 1000);
    function z(n) { return (n < 10 ? '0' : '') + n; }
    return d.getUTCFullYear() + '-' + z(d.getUTCMonth() + 1) + '-' + z(d.getUTCDate());
  }
  function inMonth(dateStr, m) {
    var d = jstDay(dateStr);
    return d >= m && d < monthEnd(m);
  }
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(String(v).replace(/[,%\s]/g, ''));
    return isFinite(n) ? n : null;
  }
  function round1(n) { return n == null ? null : Math.round(n * 10) / 10; }
  function delta(cur, prev) { return cur == null || prev == null ? null : round1(cur - prev); }

  // ---- 計測スクリプトの summary.json ----------------------------------------
  /**
   * @returns {{runId,generatedAt,querySetVersion,matcherVersion,rows:Array}} rows: provider×group の KPI
   */
  function parseMeasurementSummary(json) {
    var d = typeof json === 'string' ? JSON.parse(json) : json;
    if (!d || !Array.isArray(d.by)) throw new Error('summary.json の形式ではありません（by が無い）');
    var rows = d.by.map(function (b) {
      var either = b.either && b.either.rate != null ? b.either.rate : b.rate;
      return {
        provider: String(b.provider || ''),
        model: String(b.model || ''),
        group: String(b.group || ''),
        label: String(b.label || ''),
        answers: num(b.denominator != null ? b.denominator : b.total),
        citeRate: num(either),
        citeCount: num(b.either && b.either.numerator != null ? b.either.numerator : b.numerator),
        mentionRate: num(b.service_mention_rate),
        mediaDomainRate: num(b.media_domain_rate),
        searchRate: num(b.search_execution_rate),
        // 競合と比べた名前の出やすさ（SOV・%）と、競合ごとの名前が出た割合。無い summary では null
        sov: num(b.sov),
        competitorMentionRates: b.competitor_mention_rates && typeof b.competitor_mention_rates === 'object' ? b.competitor_mention_rates : null,
        errors: num(b.error_count) || 0,
        // 引用の分母（出典の有無を判定できた回答の数）。無い summary（古い計測スクリプト）は null
        judged: num(b.judged != null ? b.judged : (b.either && b.either.denominator)),
        notShown: num(b.not_shown_count) || 0,
        mentionCount: b.mention_count != null ? num(b.mention_count) : null
      };
    }).filter(function (r) { return r.provider && r.group; });
    if (!rows.length) throw new Error('summary.json に集計行がありません');
    // AI が参照したサイト（cited_domains: [[host, {provider: 回数}]]）と、対象のURLが引用された記録（media_citations）
    var citedDomains = (Array.isArray(d.cited_domains) ? d.cited_domains : []).map(function (x) {
      var host = Array.isArray(x) ? x[0] : (x && x.host), counts = Array.isArray(x) ? x[1] : (x && x.counts);
      counts = counts && typeof counts === 'object' ? counts : {};
      var total = Object.keys(counts).reduce(function (t, k) { return t + (num(counts[k]) || 0); }, 0);
      return { host: String(host || ''), counts: counts, total: total };
    }).filter(function (x) { return x.host && x.host !== '(unresolved)' && x.total > 0; });
    var targetCitations = (Array.isArray(d.media_citations) ? d.media_citations : (Array.isArray(d.target_citations) ? d.target_citations : [])).map(function (x) {
      return { provider: String(x.provider || ''), query: String(x.query || ''), url: String(x.url || ''), matchType: String(x.match_type || '') };
    }).filter(function (x) { return /^https?:\/\//.test(x.url); });
    return {
      citedDomains: citedDomains,
      targetCitations: targetCitations,
      // 一般質問／指名質問ごとの数（Studio・定期計測の summary）と、回答ごとの根拠
      types: d.breakdown && d.breakdown.types && typeof d.breakdown.types === 'object' ? d.breakdown.types : null,
      answers: Array.isArray(d.answers) ? d.answers : [],
      runId: String(d.run_id || ''),
      generatedAt: String(d.generated_at || ''),
      querySetVersion: String(d.query_set_version || ''),
      matcherVersion: String(d.matcher_version || ''),
      rows: rows
    };
  }

  // ---- GSC の CSV（日本語・英語の書き出しどちらも）----------------------------
  function splitCsvLine(line) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (q) {
        if (ch === '"' && line.charAt(i + 1) === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }
  var GSC_COLS = {
    date: /^(date|日付)$/i,
    clicks: /^(clicks|クリック数)$/i,
    impressions: /^(impressions|表示回数)$/i,
    ctr: /^(ctr)$/i,
    position: /^(position|掲載順位|平均掲載順位)$/i
  };
  /**
   * GSC の「日付」CSV（Chart.csv / グラフ.csv）または「クエリ」「ページ」の CSV を合計する。
   * 日付列があれば periodMonth の行だけを合計する。
   * @returns {{clicks,impressions,ctr,position,rows}}
   */
  function parseGscCsv(text, periodMonth) {
    var lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) throw new Error('CSV にデータ行がありません');
    var head = splitCsvLine(lines[0]).map(function (h) { return h.trim(); });
    var idx = {};
    Object.keys(GSC_COLS).forEach(function (k) {
      for (var i = 0; i < head.length; i++) if (GSC_COLS[k].test(head[i])) { idx[k] = i; break; }
    });
    if (idx.clicks == null || idx.impressions == null) throw new Error('Search Console の CSV ではありません（クリック数・表示回数の列が無い）');
    var clicks = 0, imps = 0, posWeighted = 0, rows = 0;
    lines.slice(1).forEach(function (l) {
      var c = splitCsvLine(l);
      if (idx.date != null && periodMonth && !inMonth(c[idx.date], periodMonth)) return;
      var ck = num(c[idx.clicks]) || 0, im = num(c[idx.impressions]) || 0;
      clicks += ck; imps += im; rows++;
      if (idx.position != null && num(c[idx.position]) != null) posWeighted += num(c[idx.position]) * im;
    });
    if (!rows) throw new Error('対象の月（' + (periodMonth || '').slice(0, 7) + '）の行がありません');
    return {
      clicks: clicks,
      impressions: imps,
      ctr: imps ? round1(clicks / imps * 100) : null,
      position: imps && idx.position != null ? round1(posWeighted / imps) : null,
      rows: rows
    };
  }

  // ---- レポートの下書き ------------------------------------------------------
  // 同じ日に何度も測ったときは、保存した時刻（created_at）が新しいものを使う（日付だけだと同じ日のどれが選ばれるか決まらない）
  function latest(list, dateKey, pred) {
    return (list || []).filter(pred).sort(function (a, b) {
      return String(b[dateKey]).localeCompare(String(a[dateKey])) || String(b.created_at || '').localeCompare(String(a.created_at || ''));
    })[0] || null;
  }

  function aiKpis(run) {
    if (!run || !run.summary) return null;
    var parsed;
    try { parsed = parseMeasurementSummary(run.summary); } catch (e) { return null; }
    var main = parsed.rows.filter(function (r) { return r.group === 'main'; });
    var use = main.length ? main : parsed.rows.filter(function (r) { return r.group === 'all'; });
    return {
      measuredOn: run.measured_on,
      source: run.source || '',
      citedDomains: parsed.citedDomains.slice(0, 10),
      targetCitations: parsed.targetCitations,
      querySetVersion: parsed.querySetVersion || run.query_set_version || '',
      providers: use.map(function (r) {
        return { provider: r.provider, model: r.model, answers: r.answers, citeRate: r.citeRate, mentionRate: r.mentionRate, sov: r.sov, competitorMentionRates: r.competitorMentionRates, errors: r.errors };
      })
    };
  }

  /**
   * 月の AI 計測をまとめて数える（その月のすべての計測の合計）。
   *   引用率 ＝ 自社サイトが引用された回答の数 ÷ 引用の有無を判定できた回答の数（分子・分母も返す）
   *   言及率 ＝ 社名が出た回答の数 ÷ 回答の数。AI の回答が表示されなかった質問・エラーは分母に入れず、件数で返す
   *   判定できない回答（出典が取れず本文にも URL が無い）＝ 回答の数 − 判定できた数
   */
  /**
   * 競合との比較（その月のすべての計測・すべての AI の合計）。回答の記録に競合の結果がある回答（表示なし・エラーを除く）だけで数える。
   *   名前が出た割合 ＝ 名前が出た回答 ÷ 回答／1番目に名前が出た回答 ＝ 回答の中で最初に名前が出た数／
   *   出典になった割合 ＝ 出典になった回答 ÷ 出典の有無を判定できた回答（競合はサイトの URL を登録した会社だけ判定できる）
   *   名前が出た割合の合計に占める自社の割合（SOV）も返す
   */
  function competitorStats(evidence, client) {
    var rows = (evidence || []).filter(function (e) { return e.status === 'ok' && Array.isArray(e.competitors) && e.competitors.length; });
    if (!rows.length) return null;
    var names = [];
    rows.forEach(function (e) { e.competitors.forEach(function (c) { if (c.name && names.indexOf(c.name) < 0) names.push(c.name); }); });
    var self = { name: (client && client.name) || '自社', self: true, answers: rows.length, mention: 0, first: 0, cite: 0, citeJudged: 0 };
    var comp = names.map(function (n) { return { name: n, self: false, answers: rows.length, mention: 0, first: 0, cite: 0, citeJudged: 0 }; });
    rows.forEach(function (e) {
      if (e.mentioned) self.mention += 1;
      if (e.selfRank === 1) self.first += 1;
      if (e.cited === 0 || e.cited === 1) { self.citeJudged += 1; self.cite += e.cited; }
      var firstName = e.order && e.order.length ? e.order[0] : '';
      comp.forEach(function (c) {
        var x = e.competitors.filter(function (y) { return y.name === c.name; })[0];
        if (!x) return;
        if (x.mentioned) c.mention += 1;
        if (firstName === c.name) c.first += 1;
        if (x.cited === 0 || x.cited === 1) { c.citeJudged += 1; c.cite += x.cited; }
      });
    });
    var all = [self].concat(comp).map(function (r) {
      return Object.assign(r, { mentionRate: r.answers ? round1(r.mention / r.answers * 100) : null, firstRate: r.answers ? round1(r.first / r.answers * 100) : null, citeRate: r.citeJudged ? round1(r.cite / r.citeJudged * 100) : null });
    });
    var mentions = all.reduce(function (s, r) { return s + r.mention; }, 0);
    return { answers: rows.length, names: names, rows: all, sov: mentions ? round1(self.mention / mentions * 100) : null, mentionsTotal: mentions };
  }

  function monthlyAi(runs, month, client) {
    var list0 = (runs || []).filter(function (r) { return r && r.summary && inMonth(r.measured_on, month); });
    // 判定方法を変える前（2026-10-05 より前）の Studio の計測は、AI による概要が出なかった質問を「引用なし」として数えていた。
    //   同じ月に新しい判定の計測があれば、古い Studio の計測は合計に入れない（計測スクリプトの summary はそのまま使う）
    var isNew = function (r) { var s = r.summary || {}; return Array.isArray(s.answers) || (Array.isArray(s.by) && s.by.some(function (b) { return b && 'not_shown_count' in b; })); };
    var isOldStudio = function (r) { var s = r.summary || {}; return s.source === 'studio' && !isNew(r); };
    var hasNew = list0.some(isNew);
    var excludedOld = hasNew ? list0.filter(isOldStudio).length : 0;
    var list = (hasNew ? list0.filter(function (r) { return !isOldStudio(r); }) : list0)
      .sort(function (a, b) { var x = String(a.measured_on) + String(a.created_at || ''), y = String(b.measured_on) + String(b.created_at || ''); return x < y ? -1 : x > y ? 1 : 0; });
    var by = {}, order = [], versions = {}, used = 0, evidence = [], doms = {}, hasTypes = false;
    var zero = function () { return { answers: 0, mention: 0, cite: 0, citeJudged: 0, notShown: 0, errors: 0 }; };
    var types = { general: zero(), branded: zero() };
    var first = '', last = '';
    list.forEach(function (run) {
      var p;
      try { p = parseMeasurementSummary(run.summary); } catch (e) { return; }
      var main = p.rows.filter(function (r) { return r.group === 'main'; });
      var rows = main.length ? main : p.rows.filter(function (r) { return r.group === 'all'; });
      if (!rows.length) return;
      used += 1;
      if (!first) first = run.measured_on;
      last = run.measured_on;
      versions[p.querySetVersion || run.query_set_version || ''] = 1;
      rows.forEach(function (r) {
        var a = by[r.provider];
        if (!a) { a = by[r.provider] = { provider: r.provider, model: r.model, runs: 0, answers: 0, mention: 0, mentionKnown: true, judged: 0, cited: 0, notShown: 0, errors: 0 }; order.push(r.provider); }
        a.runs += 1;
        a.model = r.model || a.model;
        a.answers += r.answers || 0;
        var mc = r.mentionCount != null ? r.mentionCount : (r.mentionRate != null && r.answers != null ? Math.round(r.mentionRate * r.answers / 100) : null);
        if (mc == null) a.mentionKnown = false; else a.mention += mc;
        // 分母が記録されていない summary（計測スクリプト）は、率と回答の数から戻す。
        //   計測スクリプトはすべての回答を判定するので、分母＝回答の数・分子＝率×回答の数（率を正とする）。率が無い（判定できない）計測は数えない
        var j = r.judged, cc = r.citeCount;
        if (j == null && r.citeRate != null) { j = r.answers; cc = Math.round(r.citeRate * (r.answers || 0) / 100); }
        if (j != null && cc == null && r.citeRate != null) cc = Math.round(r.citeRate * j / 100);
        if (j != null) { a.judged += j; a.cited += cc || 0; }
        a.notShown += r.notShown || 0;
        a.errors += r.errors || 0;
      });
      if (p.types) {
        hasTypes = true;
        ['general', 'branded'].forEach(function (k) { var t = p.types[k]; if (!t) return; Object.keys(types[k]).forEach(function (f) { types[k][f] += num(t[f]) || 0; }); });
      }
      p.citedDomains.forEach(function (d) { var x = doms[d.host] || (doms[d.host] = { host: d.host, counts: {}, total: 0 }); Object.keys(d.counts).forEach(function (k) { x.counts[k] = (x.counts[k] || 0) + (num(d.counts[k]) || 0); }); x.total += d.total; });
      p.answers.forEach(function (x) {
        if (!x || typeof x !== 'object') return;
        evidence.push({ measuredOn: run.measured_on, measuredAt: String(x.measured_at || ''), prompt: String(x.prompt || ''), engine: String(x.engine || ''), status: String(x.status || 'ok'), error: x.error ? String(x.error).slice(0, 160) : '',
          mentioned: x.mentioned == null ? null : num(x.mentioned), cited: x.cited == null ? null : num(x.cited), citeSource: String(x.cite_source || ''), citations: (x.citations || []).slice(0, 8).map(String), urlsInAnswer: (x.urls_in_answer || []).slice(0, 5).map(String),
          answer: String(x.answer || '').slice(0, 400), model: String(x.model || ''), search: !!(x.conditions && x.conditions.search), branded: !!x.branded, repeat: x.repeat || 1,
          competitors: Array.isArray(x.competitors) ? x.competitors.map(function (c) { return { name: String(c.name || ''), mentioned: c.mentioned == null ? null : num(c.mentioned), cited: c.cited == null ? null : num(c.cited) }; }) : null,
          order: Array.isArray(x.order) ? x.order.map(String) : null, selfRank: x.self_rank == null ? null : num(x.self_rank) });
      });
    });
    if (!used) return null;
    var competitors = competitorStats(evidence, client);
    var t2 = function (t) { return Object.assign({}, t, { mentionRate: t.answers ? round1(t.mention / t.answers * 100) : null, citeRate: t.citeJudged ? round1(t.cite / t.citeJudged * 100) : null, undetermined: Math.max(0, t.answers - t.citeJudged) }); };
    return {
      runs: used, firstOn: first, lastOn: last, versions: Object.keys(versions), excludedOld: excludedOld,
      providers: order.map(function (k) {
        var a = by[k];
        return { provider: a.provider, model: a.model, runs: a.runs, answers: a.answers, mentionCount: a.mentionKnown ? a.mention : null, mentionRate: a.mentionKnown && a.answers ? round1(a.mention / a.answers * 100) : null,
          judged: a.judged, citeCount: a.cited, citeRate: a.judged ? round1(a.cited / a.judged * 100) : null, undetermined: Math.max(0, a.answers - a.judged), notShown: a.notShown, errors: a.errors };
      }),
      types: hasTypes ? { general: t2(types.general), branded: t2(types.branded) } : null,
      citedDomains: Object.keys(doms).map(function (h) { return doms[h]; }).sort(function (a, b) { return b.total - a.total; }).slice(0, 10),
      competitors: competitors,
      evidence: evidence
    };
  }

  function periodRec(t) { return { start_date: t.start_date || null, end_date: t.end_date || null, days: t.days != null ? t.days : null, fetched_at: t.fetched_at || null }; }
  function trafficFor(list, month) {
    // 連携（*_api）の値を優先し、連携で取れない項目（対象ページ閲覧など）は CSV・手入力の値で埋める
    var byKind = {};
    (list || []).filter(function (t) { return t.period_month === month; }).forEach(function (t) {
      var kind = /^gsc/.test(t.source) ? 'gsc' : 'ga4';
      byKind[kind] = byKind[kind] || {};
      byKind[kind][/_api$/.test(t.source) ? 'api' : 'manual'] = t;
    });
    var out = {};
    Object.keys(byKind).forEach(function (kind) {
      var api = byKind[kind].api, manual = byKind[kind].manual, m = {};
      [manual, api].forEach(function (t) {
        if (!t) return;
        Object.keys(t.metrics || {}).forEach(function (k) { if (t.metrics[k] != null) m[k] = t.metrics[k]; });
      });
      out[kind] = Object.assign({ source: (api || manual).source }, m);
    });
    return out;
  }

  /**
   * @param {object} p { client, periodMonth:'YYYY-MM-01', scans:[], runs:[], traffic:[], actions:[], now? }
   */
  function compileReport(p) {
    var m = monthStart(p.periodMonth);
    if (!m) throw new Error('対象月が不正です');
    var pm = prevMonth(m);
    var end = monthEnd(m);

    // 診断: 当月（なければ月末までで最新）と、前月の最新
    var scanNow = latest(p.scans, 'createdAt', function (s) { return jstDay(s.createdAt) < end; });
    var scanPrev = latest(p.scans, 'createdAt', function (s) { return inMonth(s.createdAt, pm); });
    var gapsNow = scanNow ? (scanNow.gaps || []).map(gapText) : [];
    var gapsPrev = scanPrev ? (scanPrev.gaps || []).map(gapText) : [];
    var site = {
      current: scanNow ? { id: scanNow.id, createdAt: scanNow.createdAt, url: scanNow.url, ruleVersion: scanNow.ruleVersion || null, overall: scanNow.overallScore, factors: scanNow.factors || {}, gaps: gapsNow, gapKeys: (scanNow.gaps || []).slice(), unknownChecks: scanNow.unknownChecks || 0, inMonth: inMonth(scanNow.createdAt, m), detail: siteDetail(scanNow) } : null,
      previous: scanPrev ? { id: scanPrev.id, createdAt: scanPrev.createdAt, overall: scanPrev.overallScore, gaps: gapsPrev } : null,
      overallDelta: scanNow && scanPrev ? delta(scanNow.overallScore, scanPrev.overallScore) : null,
      resolved: scanPrev ? gapsPrev.filter(function (g) { return gapsNow.indexOf(g) < 0; }) : [],
      added: scanPrev ? gapsNow.filter(function (g) { return gapsPrev.indexOf(g) < 0; }) : []
    };

    // AI 計測: 今月のすべての計測の合計（月次）を主に使う。最新1回の結果は ai.latest に別に残す
    var runNow = latest(p.runs, 'measured_on', function (r) { return inMonth(r.measured_on, m); });
    var aiNow = aiKpis(runNow);
    var aiPrev = aiKpis(latest(p.runs, 'measured_on', function (r) { return inMonth(r.measured_on, pm); }));
    var monNow = monthlyAi(p.runs, m, p.client), monPrev = monthlyAi(p.runs, pm, p.client);
    var ai = null;
    if (monNow && aiNow) {
      // 前月と比べられるのは、両方の月が同じ質問の版だけで測られているとき
      var comparableMonth = !!(monPrev && monNow.versions.length === 1 && monPrev.versions.length === 1 && monNow.versions[0] === monPrev.versions[0]);
      ai = {
        basis: 'monthly',
        measuredOn: aiNow.measuredOn, querySetVersion: aiNow.querySetVersion, source: aiNow.source,
        runs: monNow.runs, firstOn: monNow.firstOn, lastOn: monNow.lastOn, versions: monNow.versions, excludedOld: monNow.excludedOld,
        citedDomains: monNow.citedDomains.length ? monNow.citedDomains : aiNow.citedDomains, targetCitations: aiNow.targetCitations,
        comparable: comparableMonth,
        types: monNow.types,
        competitors: monNow.competitors ? Object.assign({}, monNow.competitors, { prevSov: monPrev && monPrev.competitors ? monPrev.competitors.sov : null }) : null,
        evidence: monNow.evidence.slice(-200),
        evidenceTotal: monNow.evidence.length,
        latest: { measuredOn: aiNow.measuredOn, querySetVersion: aiNow.querySetVersion, providers: aiNow.providers },
        providers: monNow.providers.map(function (r) {
          var prev = monPrev ? monPrev.providers.filter(function (x) { return x.provider === r.provider; })[0] : null;
          var lt = aiNow.providers.filter(function (x) { return x.provider === r.provider; })[0] || {};
          // SOV（競合と比べた名前の出やすさ）は最新1回の値。前月の最新1回と、同じ質問の版のときだけ比べる
          var ltPrev = aiPrev ? aiPrev.providers.filter(function (x) { return x.provider === r.provider; })[0] : null;
          var sovComparable = !!(ltPrev && aiPrev.querySetVersion === aiNow.querySetVersion);
          var comparable = comparableMonth && !!prev;
          return Object.assign({}, r, {
            sov: lt.sov != null ? lt.sov : null, competitorMentionRates: lt.competitorMentionRates || null,
            prevCiteRate: prev ? prev.citeRate : null, prevMentionRate: prev ? prev.mentionRate : null, prevSov: ltPrev ? ltPrev.sov : null,
            citeDelta: comparable ? delta(r.citeRate, prev.citeRate) : null,
            mentionDelta: comparable ? delta(r.mentionRate, prev.mentionRate) : null,
            sovDelta: sovComparable ? delta(lt.sov, ltPrev.sov) : null
          });
        })
      };
    }

    // 流入
    var tNow = trafficFor(p.traffic, m), tPrev = trafficFor(p.traffic, pm);
    var traffic = { gsc: tNow.gsc || null, gscPrev: tPrev.gsc || null, ga4: tNow.ga4 || null, ga4Prev: tPrev.ga4 || null };

    // 施策（当月に実施したもの）
    var actions = (p.actions || []).filter(function (a) { return a.status === 'done' && inMonth(a.done_on, m); })
      .sort(function (a, b) { return String(a.done_on).localeCompare(String(b.done_on)); })
      .map(function (a) { return { title: a.title, doneOn: a.done_on, evidenceUrl: a.evidence_url || '', category: a.category || '' }; });

    // 事実の変化（結論の下書きに使う候補）
    var facts = [];
    if (site.current && site.current.overall != null) {
      facts.push(site.previous && site.previous.overall != null
        ? 'ホームページの情報整備：' + site.previous.overall + '点 → ' + site.current.overall + '点（' + (site.overallDelta >= 0 ? '+' : '') + site.overallDelta + '）'
        : 'ホームページの情報整備：' + site.current.overall + '点（前月の診断なし）');
    }
    if (site.resolved.length) facts.push('前月から解消した不足：' + site.resolved.length + '件');
    if (ai) ai.providers.forEach(function (r) {
      if (r.citeRate == null) return;
      facts.push('AIの引用率（' + ({ openai: 'ChatGPT', gemini: 'Gemini', claude: 'Claude', perplexity: 'Perplexity' }[r.provider] || r.provider) + '）：' + (r.citeDelta != null ? (r.prevCiteRate + '% → ') : '') + r.citeRate + '%' + (r.citeDelta != null ? '（' + (r.citeDelta >= 0 ? '+' : '') + r.citeDelta + 'pt）' : (ai.comparable ? '' : '（前月と質問の版が違う、または前月の計測なし）')));
    });
    if (ai) ai.providers.forEach(function (r) {
      if (r.sov == null) return;
      facts.push('競合と比べた名前の出やすさ・SOV（' + ({ openai: 'ChatGPT', gemini: 'Gemini', claude: 'Claude', perplexity: 'Perplexity' }[r.provider] || r.provider) + '）：' + (r.sovDelta != null ? (r.prevSov + '% → ') : '') + r.sov + '%' + (r.sovDelta != null ? '（' + (r.sovDelta >= 0 ? '+' : '') + r.sovDelta + 'pt）' : ''));
    });
    if (traffic.gsc && traffic.gsc.clicks != null) {
      facts.push('検索からのクリック：' + (traffic.gscPrev && traffic.gscPrev.clicks != null ? traffic.gscPrev.clicks + ' → ' : '') + traffic.gsc.clicks);
    }
    if (actions.length) facts.push('今月実施した施策：' + actions.length + '件');

    // 推移（対象月までの6か月）。グラフ用。各月の最新の材料だけを使い、無い月は null のまま（線をつながない）
    var history = [];
    for (var k = 5; k >= 0; k--) {
      var mm = m;
      for (var j = 0; j < k; j++) mm = prevMonth(mm);
      var sc = latest(p.scans, 'createdAt', function (s) { return inMonth(s.createdAt, mm); });
      // AI の引用率は、その月のすべての計測の合計（レポートのタイルと同じ数え方）
      var ak = monthlyAi(p.runs, mm);
      var tr = trafficFor(p.traffic, mm);
      var cite = {};
      if (ak) ak.providers.forEach(function (r) { cite[r.provider] = r.citeRate; });
      history.push({
        month: mm,
        score: sc ? num(sc.overallScore) : null,
        querySetVersion: ak ? (ak.versions.length === 1 ? ak.versions[0] : ak.versions.join(',')) : null,
        cite: cite,
        clicks: tr.gsc ? num(tr.gsc.clicks) : null,
        conversions: tr.ga4 ? num(tr.ga4.conversions) : null,
        // 対象期間（取得した日付の範囲）。途中集計・期間の記録なしを区別するため。記録がなければ null（推測しない）
        clicksPeriod: tr.gsc ? periodRec(tr.gsc) : null,
        conversionsPeriod: tr.ga4 ? periodRec(tr.ga4) : null
      });
    }

    // 初回（前の月までの材料が何も無い）。初回は前月との比較と推移を出さず「基準値」として見せる
    var first = history.slice(0, 5).every(function (h) { return h.score == null && !Object.keys(h.cite).length && h.clicks == null && h.conversions == null; });

    // 足りない材料（レポートに「未計測」と出すもの）
    var missing = [];
    if (!site.current) missing.push('ホームページの診断');
    else if (!site.current.inMonth) missing.push('当月の診断（' + jstDay(site.current.createdAt) + ' の診断を使用）');
    if (!ai) missing.push('AI回答の計測');
    if (!traffic.gsc) missing.push('Search Console の数値');
    if (!traffic.ga4) missing.push('GA4 の数値');

    return {
      version: 'report-v1',
      periodMonth: m,
      previousMonth: pm,
      client: p.client ? { id: p.client.id, name: p.client.name, industryId: p.client.industry_id || '' } : null,
      generatedAt: (p.now || new Date()).toISOString ? (p.now || new Date()).toISOString() : String(p.now),
      site: site,
      ai: ai,
      traffic: traffic,
      actions: actions,
      facts: facts,
      history: history,
      first: first,
      missing: missing
    };
  }

  // 数字の出どころ（レポートの各数字が、どこから・いつ・どの条件で取ったものか）
  // 日本時間の「YYYY-MM-DD HH:mm」
  function jstTime(iso) {
    var t = Date.parse(iso || '');
    if (isNaN(t)) return String(iso || '').slice(0, 10);
    var d = new Date(t + 9 * 3600 * 1000);
    function z(n) { return (n < 10 ? '0' : '') + n; }
    return d.getUTCFullYear() + '-' + z(d.getUTCMonth() + 1) + '-' + z(d.getUTCDate()) + ' ' + z(d.getUTCHours()) + ':' + z(d.getUTCMinutes());
  }
  var PROV_JA = { openai: 'ChatGPT', chatgpt_search: 'ChatGPT（検索あり）', gemini: 'Gemini', claude: 'Claude', perplexity: 'Perplexity', google_aio: 'Google の AI による概要', google_ai_mode: 'Google の AI モード' };
  var SRC_JA = { gsc_api: 'Google Search Console（連携で取得）', gsc_csv: 'Google Search Console（CSV を取り込み）', ga4_api: 'Google アナリティクス（連携で取得）', ga4_manual: 'Google アナリティクス（担当者が入力）' };
  function evidenceList(c) {
    var out = [];
    var cur = c && c.site && c.site.current;
    out.push({ kinds: cur ? ['measured', 'judged'] : ['unknown'], label: 'ホームページの情報整備（点数・直すこと）', source: cur ? 'AirReach の無料診断' : '診断の記録なし',
      detail: cur ? (jstTime(cur.detail && cur.detail.scope && cur.detail.scope.diagnosedAt || cur.createdAt) + ' に ' + (cur.url || '') + ' のトップページと案内ファイル（llms.txt・robots.txt）を診断' + (cur.detail && cur.detail.scope && cur.detail.scope.pagesRead != null ? '・答えの確認に読んだページ ' + cur.detail.scope.pagesRead + 'ページ' : '') + (cur.ruleVersion ? '・判定基準 ' + cur.ruleVersion : '') + (cur.inMonth ? '' : '（当月の診断が無いため、この日の結果）')) : '' });
    var ai = c && c.ai;
    out.push({ kinds: ai ? ['reference'] : ['unknown'], label: 'AI回答の計測（出典になった割合・名前が出た割合・競合と比べた割合）', source: ai ? (ai.source === 'manual' ? 'AirReach Studio での計測' : '社内の計測（同じ質問を AI に複数回聞いて集計）') : '計測の記録なし',
      detail: ai ? ((ai.basis === 'monthly' ? '今月の計測 ' + ai.runs + '回（' + ai.firstOn + (ai.runs > 1 ? '〜' + ai.lastOn : '') + '）の合計・最新の計測 ' + ai.measuredOn : '計測日 ' + ai.measuredOn) + '・質問の版 ' + ((ai.versions && ai.versions.length ? ai.versions : [ai.querySetVersion || '—']).join('、')) + '・' + ai.providers.map(function (p) { return (PROV_JA[p.provider] || p.provider) + (p.model && !/^serpapi\//i.test(p.model) ? '（' + p.model + '）' : '') + (p.answers != null ? ' ' + p.answers + '回答' : ''); }).join('、')) : '' });
    var tr = (c && c.traffic) || {};
    var g = tr.gsc, a = tr.ga4;
    out.push({ kinds: [g ? (g.source === 'ga4_manual' ? 'manual' : 'measured') : 'unknown'], label: '検索からのクリック・表示回数・平均の順位', source: g ? (SRC_JA[g.source] || g.source) : '未取得',
      detail: g ? (((g.start_date && g.end_date) ? g.start_date + '〜' + g.end_date + (g.days ? '（' + g.days + '日間）' : '') : '対象月') + (g.property ? '・' + g.property : '') + (g.source === 'gsc_api' ? '・サイト全体の合計' : '')) : '' });
    out.push({ kinds: [a ? (a.source === 'ga4_manual' ? 'manual' : 'measured') : 'unknown'], label: '訪問回数・AIのサービスから来た訪問・問い合わせ', source: a ? (SRC_JA[a.source] || a.source) : '未取得',
      detail: a ? (((a.start_date && a.end_date) ? a.start_date + '〜' + a.end_date : '対象月') + (a.host ? '・' + a.host : '') + (a.source === 'ga4_api' ? '・問い合わせは GA4 のキーイベントの合計・AI 経由は参照元が AI サービス（ChatGPT・Perplexity・Gemini など）の訪問' : '')) : '' });
    out.push({ kinds: ['manual'], label: '今月実施したこと', source: 'AirReach の施策台帳', detail: '担当者が登録した実施日と、公開ページの URL（証拠）' });
    return out;
  }

  var api = { jstDay: jstDay, jstTime: jstTime, criteria: CRITERIA, factorWeight: FACTOR_WEIGHT, evidenceList: evidenceList, gapText: gapText, plainGap: plainGap, plainResolved: plainResolved, todoList: todoList, parseMeasurementSummary: parseMeasurementSummary, parseGscCsv: parseGscCsv, compileReport: compileReport, monthStart: monthStart, prevMonth: prevMonth, version: 'report-v1' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AirReachReport = api;
})(typeof window !== 'undefined' ? window : null);
