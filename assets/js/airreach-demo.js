/**
 * AirReach 代理店向けデモ（/airreach/demo/）の画面の切り替え。
 *   お客様のホーム（本番の顧客ホームと同じ部品：タイル・推移・直すこと）と、月次レポート（本番の描画 airreach-report-view.js）を、
 *   架空データ（airreach-demo-data.js）だけで出す。ログイン・DB・AI・Google・メール・保存には一切つながない。
 *   画面は URL の # で切り替える（#/ ＝ホーム、#/report/2026-09 ＝その月のレポート）。
 */
(function () {
  'use strict';
  var D = window.AirReachDemoData, C = window.AirReachCharts, R = window.AirReachReport, V = window.AirReachReportView, H = window.AirReachClientHome;
  var home = document.getElementById('ard-home'), rep = document.getElementById('arr-root'), nav = document.getElementById('ard-report-nav');
  if (!D || !C || !R || !V || !H || !home || !rep) { if (home) home.innerHTML = '<p>デモを読み込めませんでした。ページを開き直してください。</p>'; return; }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ym(d) { var m = /^(\d{4})-(\d{2})/.exec(String(d || '')); return m ? m[1] + '年' + Number(m[2]) + '月' : ''; }
  function key(r) { return String(r.period_month).slice(0, 7); }
  function reportBy(k) { return D.reports.filter(function (r) { return key(r) === k; })[0] || null; }
  var latest = D.reports[0];

  function renderHome() {
    var top = latest, c = top.compiled, next = top.next_actions || [], dec = top.client_decisions || [];
    var items = R.todoList(c), cur = c.site.current;
    var done = D.actions.filter(function (a) { return a.status === 'done'; }), planned = D.actions.filter(function (a) { return a.status !== 'done'; });
    home.innerHTML =
      '<details class="ard-guide ard-noprint" open><summary>このデモの使い方（1分）</summary><ol>' +
      '<li>最初に「今月の結論」と、レポートを開くボタンがあります。その下の「今月の数字」で、ホームページの整い具合・AI の回答での見え方・検索からのクリック・問い合わせを見ます。</li>' +
      '<li>黄色の「ご判断いただきたいこと」は、お客様に決めていただきたいことです。「推移」で直近6か月の変化を、「直すこと」で次に直すとよいところと直し方を見ます。</li>' +
      '<li>「レポートを開く・PDF」で月次レポートを開き、過去の月に切り替えたり、PDF で保存（印刷）したりできます。</li>' +
      '</ol><p class="arc-note" style="margin:8px 0 0">表示はすべてデモ用の架空データです。入力・保存・ログインはありません。</p></details>' +
      '<div class="arc-top"><div><div class="arc-kicker">お客様向け画面（デモ）</div><h1 class="arc-h1">' + esc(D.client.name) + '</h1></div></div>' +
      // 本番のお客様のホームと同じ並び：結論 → 数字 → ご判断いただきたいこと → 次にやること（部品は airreach-client-home.js）
      H.latest(top, '#/report/' + key(top)) + H.numbers(top) + H.competitor(c, { href: '#/report/' + key(top), linkText: 'レポートで詳しく見る', note: ym(top.period_month) + 'のレポートの数字です。' }) + H.decision(top) +
      (next.length ? '<section class="arc-card"><h2 class="arc-h2">次にやること</h2><table class="arc-table"><thead><tr><th>施策</th><th style="width:22%">担当</th><th style="width:18%">期限</th></tr></thead><tbody>' + next.map(function (a) { return '<tr><td>' + esc(a.title) + '</td><td>' + esc(a.owner || '') + '</td><td>' + esc(a.due || '') + '</td></tr>'; }).join('') + '</tbody></table></section>' : '') +
      '<section class="arc-card"><h2 class="arc-h2">推移（直近6か月）</h2>' + C.trends(c) + '</section>' +
      '<section class="arc-card"><div class="arv-home-head"><h2 class="arc-h2">直すこと' + (items.length ? '（' + items.length + '件）' : '') + '</h2><span class="arc-sub">' + esc(R.jstDay(cur.createdAt)) + ' の診断で見つかった不足・優先度の高い順</span></div>' +
      (items.length > 5 ? C.todos(items.slice(0, 5), { audience: 'client' }) + '<details class="arc-more"><summary>残り ' + (items.length - 5) + '件をすべて表示</summary>' + C.todos(items.slice(5), { audience: 'client', start: 5 }) + '</details>' : C.todos(items, { audience: 'client' })) + '</section>' +
      '<section class="arc-card"><h2 class="arc-h2">施策</h2><ul class="ard-acts">' + planned.map(function (a) { return '<li><span class="arc-chip is-warn">予定</span>' + esc(a.title) + ' <small>' + esc(a.done_on.slice(5).replace('-', '/')) + 'まで</small></li>'; }).join('') + '</ul>' +
      '<details class="arc-more"><summary>実施済みの施策（' + done.length + '件）を表示</summary><ul class="ard-acts">' + done.slice().reverse().map(function (a) { return '<li><span class="arc-chip is-ok">実施済み</span>' + esc(a.title) + ' <small>' + esc(a.done_on.slice(5).replace('-', '/')) + '</small></li>'; }).join('') + '</ul></details></section>' +
      '<section class="arc-card"><h2 class="arc-h2">これまでのレポート</h2><ul class="arc-list">' + D.reports.map(function (r) {
        return '<li><a href="#/report/' + key(r) + '">' + esc(ym(r.period_month)) + ' のレポート</a><span class="arc-sub">公開 ' + esc(R.jstDay(r.published_at)) + '</span></li>';
      }).join('') + '</ul></section>';
  }

  function renderReport(r) {
    nav.innerHTML = '<a class="arc-btn-sm" href="#/">← ホームへ戻る</a><label for="ard-month">表示する月</label><select id="ard-month">' +
      D.reports.map(function (x) { return '<option value="' + key(x) + '"' + (x === r ? ' selected' : '') + '>' + esc(ym(x.period_month)) + '</option>'; }).join('') + '</select>';
    document.getElementById('ard-month').addEventListener('change', function (e) { location.hash = '#/report/' + e.target.value; });
    V.render(r);
    // レポートの見出しにも SAMPLE を出す（印刷・PDF にも残る）
    var head = rep.querySelector('.arr-head');
    if (head) head.insertAdjacentHTML('afterbegin', '<div class="ard-stamp">SAMPLE／デモ用の架空データ</div>');
    document.title = D.client.name + ' ' + ym(r.period_month) + ' 月次レポート（SAMPLE）- AirReach デモ';
  }

  function route() {
    var m = /^#\/report\/(\d{4}-\d{2})$/.exec(location.hash || '');
    var r = m ? reportBy(m[1]) : null;
    if (r) {
      home.hidden = true; nav.hidden = false; rep.hidden = false;
      renderReport(r);
    } else {
      if (location.hash && location.hash !== '#/' && history.replaceState) history.replaceState(null, '', '#/');
      rep.hidden = true; nav.hidden = true; home.hidden = false;
      renderHome();
      document.title = D.client.name + '（SAMPLE）- AirReach デモ';
    }
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  route();
})();
