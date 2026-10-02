/**
 * AirReach の左のメニュー（ダッシュボードと Studio で共通）。
 *   ダッシュボード（/airreach/app/）と Studio（/airreach/studio/）は別のページだが、
 *   顧客を選んだときは同じ並びのメニューを出し、1つの道具として行き来できるようにする。
 *   where: 'dash' はダッシュボードの節（#/c/<id>/<sec>）、'studio' は Studio の画面（#<panel>）
 */
(function () {
  'use strict';
  var CLIENT_GROUPS = [
    { group: '概要', items: [{ key: 'home', label: 'ホーム', where: 'dash', sec: 'home' }] },
    { group: '分析・作る', items: [
      { key: 'start', label: '対象サイト・分析', where: 'studio', panel: 'start' },
      { key: 'result', label: '分析結果', where: 'studio', panel: 'result' },
      { key: 'keywords', label: 'キーワード', where: 'studio', panel: 'keywords' },
      { key: 'gaps', label: '足りない情報', where: 'studio', panel: 'gaps' },
      { key: 'generator', label: '直す材料', where: 'studio', panel: 'generator' },
      { key: 'competitors', label: '競合', where: 'studio', panel: 'competitors' }
    ] },
    { group: '測る', items: [
      { key: 'hack2', label: 'AI計測を実行', where: 'studio', panel: 'hack2' },
      { key: 'runs', label: 'AI計測の記録', where: 'dash', sec: 'runs' },
      { key: 'traffic', label: '検索と訪問', where: 'dash', sec: 'traffic' },
      { key: 'google', label: 'Google 連携', where: 'studio', panel: 'google' },
      { key: 'timeseries', label: '推移', where: 'studio', panel: 'timeseries' }
    ] },
    { group: '記録と報告', items: [
      { key: 'sites', label: '診断の履歴', where: 'dash', sec: 'sites' },
      { key: 'actions', label: '施策', where: 'dash', sec: 'actions' },
      { key: 'reports', label: '月次レポート', where: 'dash', sec: 'reports' }
    ] },
    { group: '設定', items: [{ key: 'members', label: '顧客側のメンバー', where: 'dash', sec: 'members' }] }
  ];
  // 顧客を選んでいないとき: ダッシュボードの全体の画面と、Studio（顧客なしの作業）
  var GLOBAL_GROUPS = [
    { group: '全体', items: [
      { key: 'list', label: '顧客一覧', where: 'dash', sec: 'list' },
      { key: 'review', label: '確認待ちのレポート', where: 'dash', sec: 'review' }
    ] },
    { group: 'Studio（顧客を選ばずに）', items: [
      { key: 'start', label: '対象サイト・分析', where: 'studio', panel: 'start' },
      { key: 'result', label: '分析結果', where: 'studio', panel: 'result' },
      { key: 'keywords', label: 'キーワード', where: 'studio', panel: 'keywords' },
      { key: 'gaps', label: '足りない情報', where: 'studio', panel: 'gaps' },
      { key: 'generator', label: '直す材料', where: 'studio', panel: 'generator' },
      { key: 'competitors', label: '競合', where: 'studio', panel: 'competitors' },
      { key: 'hack2', label: 'AI計測を実行', where: 'studio', panel: 'hack2' },
      { key: 'google', label: 'Google 連携', where: 'studio', panel: 'google' },
      { key: 'timeseries', label: '推移', where: 'studio', panel: 'timeseries' }
    ] }
  ];
  function groups(hasClient) { return hasClient ? CLIENT_GROUPS : GLOBAL_GROUPS; }

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
  window.AirReachNav = { groups: groups, href: href, studioBase: studioBase };
})();
