/**
 * 今月の7工程（サイトを調べる → … → お客様に公開する）の判定と、作業画面の上に出す帯。
 *   ダッシュボード（airreach-console.js）と Studio（airreach-studio-clients.js）で同じ判定を使う
 */
(function (root) {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(v) { return root.AirReachReport && root.AirReachReport.jstDay ? root.AirReachReport.jstDay(v) : String(v || '').slice(0, 10); }
  function thisMonth() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  var REPORT_STATUS = { draft: ['下書き', ''], in_review: ['確認待ち', 'is-warn'], approved: ['承認済み・未公開', 'is-warn'], published: ['公開', 'is-ok'] };
  function studioHref(c, sites) {
    var cl = { id: c.id, name: c.name || '', site: sites && sites[0] ? sites[0].url : '', industry: c.industry_id || c.industry || '' };
    return root.AirReachStaff ? root.AirReachStaff.studioLink(cl) : root.AirReachNav.studioBase(cl);
  }

  // p: { client, sites, live（compileReport の結果）, repNow（今月のレポート）, actions, lastEvent（今月のレポートの最後の出来事）, appBase（ダッシュボードの URL。ダッシュボードの中では ''） }
  function monthPlan(p) {
    var c = p.client, sites = p.sites, live = p.live, repNow = p.repNow, actions = p.actions, lastEvent = p.lastEvent, app = p.appBase || '';
    var studio = studioHref(c, sites), base = app + '#/c/' + c.id + '/', mon = thisMonth();
    var cur = live.site.current, tr = live.traffic;
    var mat = window.AirReachStaff.materialsStep(actions, mon);
    var rs = repNow ? repNow.status : '';
    var md = function (d) { return String(d).slice(5, 10).replace('-', '/'); };
    var returned = rs === 'draft' && lastEvent === 'returned';
    var steps = [
      { title: 'サイトを調べる', what: 'URL を確かめて「分析する」を押すだけ', time: '約1分',
        why: cur ? '今月の診断がありません（最新は ' + md(day(cur.createdAt)) + '）' : 'まだ診断していません',
        ok: !!(cur && cur.inMonth), note: cur && cur.inMonth ? md(day(cur.createdAt)) + ' 診断' : '', btn: '分析する', href: studio + '#start' },
      { title: 'パッチを作る', what: 'よくある質問を承認して ZIP を作り、施策の予定として登録する', time: '約10分',
        why: '今月の施策の予定がまだ登録されていません' + (mat.carry ? '（前月からの持ち越し ' + mat.carry + '件は数えません）' : ''),
        ok: mat.ok, okLabel: mat.doneLabel, note: mat.note, btn: 'パッチを作る', href: studio + '#generator' },
      { title: 'AI での見え方を測る', what: '質問を確かめて「計測する」を押す', time: '約2分',
        why: '今月の AI 計測がありません', ok: !!live.ai, note: live.ai ? md(live.ai.measuredOn) + ' 計測' : '', btn: '計測する', href: studio + '#hack2' },
      { title: '検索と訪問の数字を入れる', what: 'Google と連携していれば月を選ぶだけ', time: '約3分',
        why: !tr.gsc && !tr.ga4 ? '今月の Search Console・GA4 の数字がありません' : !tr.gsc ? '今月の Search Console の数字がありません' : '今月の GA4 の数字がありません',
        ok: !!(tr.gsc && tr.ga4), partial: !!(tr.gsc || tr.ga4) && !(tr.gsc && tr.ga4), note: tr.gsc || tr.ga4 ? (tr.gsc ? 'Search Console ✓' : 'Search Console まだ') + '・' + (tr.ga4 ? 'GA4 ✓' : 'GA4 まだ') : '', btn: '取り込む', href: base + 'traffic' },
      { title: 'やったことを記録する', what: '直したことを「実施済み」にして、公開したページの URL を入れる', time: '約3分',
        why: '今月「実施済み」にした施策がありません', ok: live.actions.length > 0, note: live.actions.length ? live.actions.length + '件' : '', btn: '記録する', href: base + 'actions' },
      { title: '月次レポートを作る', what: '結論と次の施策を書いて、確認を依頼する', time: '約15分',
        why: !repNow ? '今月のレポートがまだありません' : returned ? '差し戻されています。直して、もう一度確認を依頼してください' : '下書きのままです（確認を依頼していません）',
        ok: rs === 'in_review' || rs === 'approved' || rs === 'published', note: repNow ? (REPORT_STATUS[rs] || [rs])[0] + (returned ? '・差し戻し' : '') : '',
        btn: !repNow ? 'レポートを作る' : rs === 'draft' ? '続きを書く' : '開く', href: repNow ? app + '#/r/' + repNow.id : base + 'reports' },
      { title: 'お客様に公開する', what: '承認されたレポートを公開する（お客様の画面と PDF に出る）', time: '約1分',
        why: rs === 'approved' ? '承認済みです。公開するとお客様が見られます' : rs === 'in_review' ? '承認を待っています' : '承認されたら公開します',
        ok: rs === 'published', note: '', btn: rs === 'approved' ? '公開する' : '開く', href: repNow ? app + '#/r/' + repNow.id : base + 'reports' }
    ];
    var doneN = steps.filter(function (s) { return s.ok; }).length;
    var nextI = -1; steps.some(function (s, i) { if (!s.ok) { nextI = i; return true; } return false; });
    return { steps: steps, doneN: doneN, nextI: nextI, next: nextI >= 0 ? steps[nextI] : null, returned: returned, mon: mon };
  }
  /**
   * 作業画面の上に出す「今月の7工程」の帯：済み（✓）・次・途中・いまここ を並べ、どの工程にも1回で移れる
   * cur: いま開いている工程の番号（0 始まり）
   */
  function flowStrip(plan, cur) {
    if (!plan) return '';
    return '<nav class="arc-flow" aria-label="今月の7工程"><ol>' + plan.steps.map(function (s, i) {
      var here = i === cur;
      var st = here ? 'いまここ' : s.ok ? '✓' : i === plan.nextI ? '次' : s.partial ? '途中' : '';
      var cls = here ? ' is-here' : s.ok ? ' is-ok' : i === plan.nextI ? ' is-next' : s.partial ? ' is-part' : '';
      return '<li><a class="arc-flow-i' + cls + '" href="' + esc(s.href) + '"' + (here ? ' aria-current="step"' : '') + '><span class="arc-flow-k">' + (i + 1) + (st ? (here ? ' · ' : ' ') + st : '') + '</span><span class="arc-flow-l">' + esc(s.title) + '</span></a></li>';
    }).join('') + '</ol><span class="arc-flow-p">' + plan.doneN + ' / ' + plan.steps.length + ' 済み</span></nav>';
  }
  var api = { build: monthPlan, strip: flowStrip, thisMonth: thisMonth };
  root.AirReachMonthPlan = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
