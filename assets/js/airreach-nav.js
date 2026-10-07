/**
 * AirReach の左のメニュー（ダッシュボードと Studio で共通）。
 *   ダッシュボード（/airreach/app/）と Studio（/airreach/studio/）は別のページだが、
 *   顧客を選んだときは同じ並びのメニューを出し、1つの道具として行き来できるようにする。
 *   where: 'dash' はダッシュボードの節（#/c/<id>/<sec>）、'studio' は Studio の画面（#<panel>）
 */
(function () {
  'use strict';
  // label は「何をする所か」が分かる動詞の形、desc はその下に出す一言（分かること・できること）、
  // lead は画面の上に出す説明。ダッシュボードの節の見出しと Studio の画面の見出しもここに合わせる
  var ITEMS = {
    home: { label: 'ホーム', desc: '今月の数字と、次にやること', where: 'dash', sec: 'home' },
    start: { label: 'サイトを調べる', desc: '点数・直すところ・まず対策する言葉', where: 'studio', panel: 'start', also: ['result'],
      lead: 'お客様のサイトを読み、AI と検索に伝わっているか、何が足りないかを調べます（約1分）。結果は「これまでの診断」と月次レポートの点数に使われます。' },
    result: { label: '調べた結果を見る', desc: '点数・直すところ・まず対策する言葉', where: 'studio', panel: 'result',
      lead: '「サイトを調べる」の結果です。点数と、直すところ、まず対策する言葉が分かります。' },
    keywords: { label: '対策する言葉を決める', desc: 'お客さんが探す言葉と優先度', where: 'studio', panel: 'keywords',
      lead: 'お客さんが AI や検索で探す言葉と、どれから対策するかが分かります。「サイトを調べる」で自動で作られ、足したり消したりできます。' },
    gaps: { label: '足りない情報を探す', desc: '予約・料金など、書いていないこと', where: 'studio', panel: 'gaps' },
    generator: { label: '直す材料を作る', desc: 'よくある質問・お店の情報の下書き', where: 'studio', panel: 'generator',
      lead: 'お客様や制作会社にそのまま渡せる「直すための下書き」（よくある質問・お店の情報・AI 向けの案内ファイル）を作ります。自動で公開はしません。' },
    actions: { label: 'やったことを記録する', desc: '直した日と公開したページ', where: 'dash', sec: 'actions',
      lead: '今月お客様のサイトで直したことを残します。月次レポートの「今月実施したこと」になります。' },
    hack2: { label: 'AI での見え方を測る', desc: 'AI の回答に名前が出るか・これまでの記録', where: 'studio', panel: 'hack2' },
    runs: { label: 'これまでの AI 計測', desc: '測った日ごとの結果', where: 'dash', sec: 'runs',
      lead: '「AI での見え方を測る」で測った結果が、自動でここに入ります。月次レポートの AI の数字に使われます。' },
    traffic: { label: '検索と訪問の数字を入れる', desc: 'Google とつなぐ・Search Console・GA4', where: 'dash', sec: 'traffic',
      lead: 'Google 検索での表示・クリック（Search Console）と、サイトへの訪問・問い合わせ（GA4）を月ごとに入れます。Google とつなぐと、月を選ぶだけで取り込めます。月次レポートの数字になります。' },
    google: { label: 'Google とつなぐ', desc: '検索と訪問の数字を自動で取り込む', where: 'studio', panel: 'google',
      lead: 'Search Console と GA4 をつなぐと、検索と訪問の数字を月ごとに自動で取り込めます（読み取りだけ）。CSV・JSON の取り込みもここです。' },
    competitors: { label: '競合と比べる', desc: '競合を登録して AI の回答で比べる', where: 'studio', panel: 'competitors',
      lead: '競合の名前と URL を登録します。AI の回答でどちらの名前が出やすいかは、「AI での見え方を測る」で測ると分かります。' },
    timeseries: { label: '変化を見る', desc: '言葉ごと・月ごとの数字の動き', where: 'studio', panel: 'timeseries',
      lead: '言葉ごとの表示・クリックと、AI 計測の結果が、月ごとにどう変わったかが分かります。' },
    reports: { label: '月次レポートを作る・公開する', desc: '結論を書く・確認を依頼・承認・公開', where: 'dash', sec: 'reports',
      lead: '今月のレポートを作り、確認・承認を経てお客様に届けます。数字は集めた材料から自動で入ります。' },
    sites: { label: 'これまでの診断', desc: '過去の点数と結果', where: 'dash', sec: 'sites',
      lead: 'これまでに調べた日と点数です。月次レポートの点数はここから使われます。' },
    members: { label: 'お客様を招待する', desc: 'レポートを見られる人', where: 'dash', sec: 'members',
      lead: 'お客様のうち、だれが月次レポートを見られるかを決めます。招待するとログイン用のメールが届きます。' },
    list: { label: '顧客一覧', desc: '顧客ごとの点数と今月のレポート', where: 'dash', sec: 'list' },
    review: { label: '確認待ちのレポート', desc: '承認を待っているレポート', where: 'dash', sec: 'review' }
  };
  Object.keys(ITEMS).forEach(function (k) { ITEMS[k].key = k; });
  // 番号（7工程の番号）。番号の無い項目は空
  function pick(keys) { return keys.map(function (k) { return ITEMS[k]; }); }
  // 毎月の作業は、ホームの「7工程」と同じ名前・同じ番号で上から並べる（6・7 は月次レポートの画面の中で、確認の依頼と公開をする）。
  // 細かい画面（言葉・足りない情報・競合・変化・これまでの診断）は「詳しく見る」にまとめる。
  // 調べた結果（result）は「サイトを調べる」、AI計測の記録（runs）は「AI での見え方を測る」、Google 連携（google）は「検索と訪問の数字を入れる」の中で扱う（メニューには出さない。URL では開ける）
  var STEP_NO = { start: '1', generator: '2', hack2: '3', traffic: '4', actions: '5', reports: '6・7' };
  var CLIENT_GROUPS = [
    { group: 'はじめに', items: pick(['home']) },
    { group: '毎月の作業（ホームの7工程と同じ番号）', items: pick(['start', 'generator', 'hack2', 'traffic', 'actions', 'reports']) },
    { group: '詳しく見る', items: pick(['keywords', 'gaps', 'competitors', 'timeseries', 'sites']) },
    { group: '設定', items: pick(['members']) }
  ];
  // 顧客を選んでいないとき: ダッシュボードの全体の画面と、Studio（顧客なしの作業）
  var GLOBAL_GROUPS = [
    { group: '全体', items: pick(['list', 'review']) },
    { group: 'Studio（顧客を選ばずに）', items: pick(['start', 'keywords', 'gaps', 'generator', 'competitors', 'hack2', 'google', 'timeseries']) }
  ];
  function groups(hasClient) { return hasClient ? CLIENT_GROUPS : GLOBAL_GROUPS; }
  function num(item, hasClient) { return hasClient ? (STEP_NO[item.key] || '') : ''; }

  // Studio を顧客の作業として開く URL（ダッシュボードの studioHref と同じ形）
  function studioBase(client) {
    if (!client || !client.id) return '/airreach/studio/?client=none';
    var p = new URLSearchParams();
    p.set('client', client.id);
    p.set('client_name', client.name || '');
    if (client.site) p.set('url', client.site);
    if (client.industry) p.set('industry', client.industry);
    return '/airreach/studio/?' + p.toString();
  }
  function href(item, client) {
    if (item.where === 'studio') return studioBase(client) + '#' + item.panel;
    if (item.sec === 'list') return '/airreach/app/#/';
    if (item.sec === 'review') return '/airreach/app/#/review';
    return '/airreach/app/#/c/' + client.id + (item.sec === 'home' ? '' : '/' + item.sec);
  }
  function item(key) { return ITEMS[key] || null; }
  window.AirReachNav = { groups: groups, href: href, studioBase: studioBase, item: item, num: num };
})();
