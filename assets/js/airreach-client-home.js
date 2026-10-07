/**
 * お客様のホームの部品（本番のお客様の画面 airreach-console.js と、代理店向けデモ airreach-demo.js で共通）
 *   最新レポートの結論とレポートを開くボタン／数字4つ（1行ずつ・内訳は開く）／ご判断いただきたいこと（黄色の枠）
 *   r は公開済みのレポート（period_month・published_at・conclusions・client_decisions・compiled）
 */
(function (root) {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(v) { return root.AirReachReport && root.AirReachReport.jstDay ? root.AirReachReport.jstDay(v) : String(v || '').slice(0, 10); }
  function ymJa(d) { var s = String(d || ''); return s.slice(0, 4) + '年' + Number(s.slice(5, 7)) + '月'; }

  /** お客様のホームの最上部：最新レポートの結論と、レポートを開くボタン */
  // href: レポートを開く先（本番は /airreach/app/report/?id=…、デモは #/report/YYYY-MM）
  function clientLatest(r, href) {
    var concl = r.conclusions || [];
    return '<section class="arc-card arc-latest"><div class="arc-latest-k">最新のレポート · ' + esc(ymJa(r.period_month)) + (r.published_at ? ' · 公開 ' + esc(day(r.published_at)) : '') + '</div>' +
      (concl.length ? '<h2 class="arc-h2">今月の結論</h2><ol class="arc-latest-c">' + concl.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol>' : '<h2 class="arc-h2">' + esc(ymJa(r.period_month)) + 'のレポートを公開しました</h2>') +
      '<a class="arc-btn arc-latest-b" href="' + esc(href || ('/airreach/app/report/?id=' + r.id)) + '">' + esc(ymJa(r.period_month).replace(/^\d+年/, '')) + 'のレポートを開く・PDF</a></section>';
  }
  /** お客様のホームの数字：4つを1行ずつ小さく。棒や AI ごとの内訳は「開く」の中 */
  function clientNumbers(r) {
    var c = r.compiled || {}, site = c.site || {}, cur = site.current, ai = c.ai, tr = c.traffic || {}, S = window.AirReachStaff;
    var na = '<span class="arv-na">未計測</span>';
    var delta = function (d, unit) { return d == null || d === 0 ? '' : '<em class="' + (d > 0 ? 'is-up' : 'is-down') + '">' + (d > 0 ? '▲' : '▼') + esc(Math.abs(d)) + esc(unit) + '</em>'; };
    var row = function (k, v, sub) { return '<div class="arc-cnum"><span class="arc-cnum-k">' + k + '</span><span class="arc-cnum-v">' + v + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; };
    var judged = 0, cited = 0;
    ((ai && ai.providers) || []).forEach(function (p) { if (p.judged > 0 && p.citeCount != null) { judged += p.judged; cited += p.citeCount; } });
    var rate = judged ? Math.round(cited / judged * 1000) / 10 : null;
    // 検索と訪問の数字は、対象期間（全期間・途中集計・期間不明）を必ず添える
    var traffic = function (k, rec, key, unit) {
      if (!rec || rec[key] == null) return row(k, na);
      var P = S ? S.periodOf(rec, r.period_month) : null;
      return row(k, '<b>' + esc(rec[key]) + '</b><small>' + unit + '</small>', P ? '<span class="arc-period' + (P.status === 'partial' ? ' is-partial' : P.status === 'unknown' ? ' is-unknown' : '') + '">' + esc(P.label) + '</span>' : '');
    };
    return '<section class="arc-card arc-cnums-card"><h2 class="arc-h2">' + esc(ymJa(r.period_month)) + 'の数字</h2><div class="arc-cnums">' +
      row('ホームページの情報整備', cur && cur.overall != null ? '<b>' + esc(cur.overall) + '</b><small>点</small>' + delta(site.overallDelta, '点') : na) +
      row('AI の回答でサイトが出典になった', rate != null ? '<b>' + esc(rate) + '</b><small>%</small>' : na, rate != null ? esc(cited) + '/' + esc(judged) + '回答・出典を判定できた回答の合計' : '') +
      traffic('検索からのクリック', tr.gsc, 'clicks', '回') +
      traffic('問い合わせ・予約', tr.ga4, 'conversions', '件') + '</div>' +
      '<p class="arc-note">測っていない数字は「未計測」と書きます（0 ではありません）。</p>' +
      (window.AirReachCharts ? '<details class="arc-more"><summary>数字の内訳を開く（AI ごと・前月との比較・対象期間）</summary>' + window.AirReachCharts.tiles(c) + '</details>' : '') + '</section>';
  }
  function decisionCard(r) {
    var dec = r.client_decisions || [];
    return dec.length ? '<section class="arc-card arc-decide"><h2 class="arc-h2">ご判断いただきたいこと</h2><ul class="arr-ul">' + dec.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
      '<p class="arc-note">お返事は、担当者へのご連絡でお願いします。</p></section>' : '';
  }
  /**
   * 競合との比較（小さく）：ひと言の結論と、名前が出た回数の取り合いの帯。詳しくは月次レポート
   *   compiled: compileReport の結果（担当者は今月の材料からその場で集計、お客様は公開済みのレポート）
   *   opt: { href, linkText, note, staff, registerHref }。競合が未登録なら、担当者には登録の案内、お客様には何も出さない
   */
  function competitorCard(compiled, opt) {
    opt = opt || {};
    var C = root.AirReachCharts, k = compiled && compiled.ai && compiled.ai.competitors;
    var sum = C && C.compSummary ? C.compSummary(k) : null;
    if (!sum) {
      if (!opt.staff) return '';
      return '<section class="arc-card arc-compcard is-empty"><h2 class="arc-h2">競合との比較</h2><p class="arc-note">' +
        (compiled && compiled.ai ? 'まだ競合と比べた計測がありません。' : '今月の AI 計測がまだありません。') +
        '競合を登録して AI で測ると、AI の回答に自社と競合のどちらの名前が出たかを比べられます。</p>' +
        (opt.registerHref ? '<a class="arc-btn-sm" href="' + esc(opt.registerHref) + '">競合を登録する</a>' : '') + '</section>';
    }
    return '<section class="arc-card arc-compcard"><div class="arv-home-head"><h2 class="arc-h2">競合との比較（AI の回答）</h2>' +
      (opt.href ? '<a class="arc-btn-sm" href="' + esc(opt.href) + '">' + esc(opt.linkText || '詳しく見る') + ' →</a>' : '') + '</div>' +
      '<p class="arr-comp-lead">' + sum.lead + '</p>' + sum.share +
      (opt.note ? '<p class="arc-note">' + esc(opt.note) + '</p>' : '') + '</section>';
  }
  var api = { latest: clientLatest, numbers: clientNumbers, decision: decisionCard, competitor: competitorCard };
  root.AirReachClientHome = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
