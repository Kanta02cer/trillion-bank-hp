/**
 * この案件の課題（client_issues）。担当者が課題を書き、保存したときの根拠の数字を自動で添える。
 *   1つの課題：何が起きているか（symptom）・なぜ（cause）・直すこと（fix）・どう確かめるか（check_how）・状態・種類（サイト／測り方）
 *   根拠の数字（evidence）：保存した時点のいちばん新しい計測の、AI による概要の X/N（一般の質問）と計測日。あとで計測が増えても、書いたときの数字が残る
 */
(function (root) {
  'use strict';
  var STATUS = { open: '未着手', waiting_client: 'お客様の判断待ち', in_progress: '対応中', watch: '様子を見る', done: '解決' };
  var KIND = { site: 'サイトの課題', measure: '測り方の課題' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(iso) { var t = Date.parse(iso); if (isNaN(t)) return ''; var d = new Date(t + 9 * 3600000); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); }
  function sorted(issues) {
    var order = { waiting_client: 0, in_progress: 1, open: 2, watch: 3, done: 4 };
    return (issues || []).slice().sort(function (a, b) { return (order[a.status] - order[b.status]) || (a.rank - b.rank) || String(a.created_at).localeCompare(String(b.created_at)); });
  }
  /** 保存するときに添える根拠の数字：いちばん新しい「回答の記録がある計測」の AI による概要 */
  function evidenceFrom(runs) {
    var rs = (runs || []).filter(function (r) { return r && r.summary && Array.isArray(r.summary.answers) && r.summary.answers.length; })
      .sort(function (a, b) { return (Date.parse(b.created_at || b.measured_on) || 0) - (Date.parse(a.created_at || a.measured_on) || 0); });
    var ev = { captured_at: new Date().toISOString() };
    if (rs.length && root.AirReachCaseSteps) {
      var a = root.AirReachCaseSteps.aioOf(rs[0]);
      if (a && a.n) ev.aio = { x: a.x, n: a.n, rate: a.rate, run_id: rs[0].id, measured_on: rs[0].measured_on || String(rs[0].created_at || '').slice(0, 10) };
    }
    return ev;
  }
  function evidenceText(ev) {
    if (!ev || !ev.aio) return '書いたときの計測の数字はありません';
    return '書いたときの数字：AI による概要 ' + ev.aio.x + ' / ' + ev.aio.n + '回（' + day(ev.aio.measured_on) + ' の計測）';
  }
  function chip(status) { return '<span class="ais-st is-' + esc(status) + '">' + esc(STATUS[status] || status) + '</span>'; }

  /** ホームに出す要約（解決していない課題を上から3つ） */
  function homeHtml(issues, clientId) {
    if (issues == null) return '';
    var open = sorted(issues).filter(function (x) { return x.status !== 'done'; });
    var href = '#/c/' + clientId + '/issues';
    var rows = open.slice(0, 3).map(function (x, i) {
      return '<a class="ais-row is-' + esc(x.status) + '" href="' + href + '"><b class="ais-no">' + (i + 1) + '</b><span><b>' + esc(x.title) + '</b>' + (x.cause ? '<small>' + esc(x.cause) + '</small>' : '') + '</span>' + chip(x.status) + '</a>';
    }).join('');
    return '<section class="arc-card ais-home"><div class="ais-head"><h2 class="arc-h2">この案件の課題（' + open.length + 'つ）</h2><a href="' + href + '">' + (open.length ? '課題をくわしく見る' : '課題を書く') + '</a></div>' +
      (rows || '<p class="arc-note">まだ課題を書いていません。計測と競合の結果を見て、名前が出ない理由を課題として残します。</p>') + '</section>';
  }

  function formHtml(x) {
    x = x || {};
    var opt = function (map, v) { return Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (k === v ? ' selected' : '') + '>' + esc(map[k]) + '</option>'; }).join(''); };
    return '<form class="ais-form" data-ais-form="' + esc(x.id || '') + '">' +
      '<label class="ais-wide">課題（ひと言）<input class="arc-input" name="title" required minlength="2" maxlength="120" value="' + esc(x.title || '') + '" placeholder="例：縮毛矯正の質問で、名前が出ない"></label>' +
      '<label>何が起きているか<textarea class="arc-input" name="symptom" rows="3" maxlength="600" placeholder="例：2問で、近くのお店だけが AI に紹介された">' + esc(x.symptom || '') + '</textarea></label>' +
      '<label>なぜ（根拠）<textarea class="arc-input" name="cause" rows="3" maxlength="600" placeholder="例：自分のページに料金と施術の流れが無い（相手の出典ページにはある）">' + esc(x.cause || '') + '</textarea></label>' +
      '<label>直すこと<textarea class="arc-input" name="fix" rows="3" maxlength="600" placeholder="例：縮毛矯正のページに料金と流れを書く">' + esc(x.fix || '') + '</textarea></label>' +
      '<label>どう確かめるか<textarea class="arc-input" name="check_how" rows="3" maxlength="400" placeholder="例：この2問で名前が出るか（次の計測）">' + esc(x.check_how || '') + '</textarea></label>' +
      '<label>状態<select class="arc-input" name="status">' + opt(STATUS, x.status || 'open') + '</select></label>' +
      '<label>種類<select class="arc-input" name="kind">' + opt(KIND, x.kind || 'site') + '</select></label>' +
      '<label>並び（大きい課題ほど小さい数）<input class="arc-input" type="number" name="rank" min="1" max="20" value="' + esc(x.rank || 1) + '"></label>' +
      '<div class="ais-form-act"><span class="arc-note">保存すると、いちばん新しい計測の数字を根拠として添えます。</span><button type="button" class="arc-btn-sm" data-ais-cancel>やめる</button><button type="submit" class="arc-btn">保存</button></div>' +
      '<p class="ais-err" hidden></p></form>';
  }

  function listHtml(issues) {
    if (issues == null) return '<p class="arc-note">課題を残す表が、まだデータベースにありません（社内で DB の適用待ち）。</p>';
    var xs = sorted(issues);
    var counts = Object.keys(STATUS).map(function (k) { var n = xs.filter(function (x) { return x.status === k; }).length; return n ? '<span class="ais-count">' + esc(STATUS[k]) + ' ' + n + '</span>' : ''; }).join('');
    var cards = xs.map(function (x, i) {
      return '<article class="ais-card is-' + esc(x.status) + '" data-ais-id="' + esc(x.id) + '">' +
        '<div class="ais-card-h"><h3>課題 ' + (i + 1) + '　' + esc(x.title) + '</h3><span class="ais-kind">' + esc(KIND[x.kind] || '') + '</span>' + chip(x.status) + '</div>' +
        '<div class="ais-grid">' +
        '<div><b>何が起きているか</b><p>' + esc(x.symptom || '—') + '</p></div>' +
        '<div><b>なぜ（根拠）</b><p>' + esc(x.cause || '—') + '</p></div>' +
        '<div><b>直すこと</b><p>' + esc(x.fix || '—') + '</p></div>' +
        '<div><b>どう確かめるか</b><p>' + esc(x.check_how || '—') + '</p></div></div>' +
        '<div class="ais-foot"><small>' + esc(evidenceText(x.evidence)) + (x.updated_at ? ' · 更新 ' + esc(day(x.updated_at)) + (x.updated_by ? ' ' + esc(String(x.updated_by).split('@')[0]) : '') : '') + '</small>' +
        '<label class="ais-quick">状態<select class="arc-input" data-ais-status="' + esc(x.id) + '">' + Object.keys(STATUS).map(function (k) { return '<option value="' + k + '"' + (k === x.status ? ' selected' : '') + '>' + esc(STATUS[k]) + '</option>'; }).join('') + '</select></label>' +
        '<button type="button" class="arc-btn-sm" data-ais-edit="' + esc(x.id) + '">直す</button><button type="button" class="arc-btn-sm" data-ais-del="' + esc(x.id) + '">消す</button></div></article>';
    }).join('');
    return '<div class="ais-top"><div class="ais-counts">' + (counts || '<span class="arc-note">まだ課題はありません</span>') + '</div><button type="button" class="arc-btn" data-ais-new>＋ 課題を書く</button></div>' +
      '<div data-ais-slot="new"></div>' + cards +
      '<p class="arc-note">課題は担当者だけが見られます（お客様には見えません）。名前が出なかった理由を、計測・競合の出典・サイトの診断を見て書きます。</p>';
  }

  /** ダッシュボードの「この案件の課題」に組み込む。ctx: { sb, clientId, issues, runs, onChange } */
  function mount(box, ctx) {
    if (!box) return;
    box.innerHTML = listHtml(ctx.issues);
    var byId = {}; (ctx.issues || []).forEach(function (x) { byId[x.id] = x; });
    function err(form, m) { var p = form.querySelector('.ais-err'); p.hidden = false; p.textContent = m; }
    function bindForm(form, id) {
      form.querySelector('[data-ais-cancel]').addEventListener('click', function () { mount(box, ctx); });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var f = form.elements, row = { title: f.title.value.trim(), symptom: f.symptom.value.trim(), cause: f.cause.value.trim(), fix: f.fix.value.trim(), check_how: f.check_how.value.trim(), status: f.status.value, kind: f.kind.value, rank: Math.max(1, Math.min(20, Number(f.rank.value) || 1)), evidence: evidenceFrom(ctx.runs) };
        if (row.title.length < 2) { err(form, '課題を2文字以上で書いてください'); return; }
        var btn = form.querySelector('[type="submit"]'); btn.disabled = true; btn.textContent = '保存しています…';
        var q = id ? ctx.sb.from('client_issues').update(row).eq('id', id) : ctx.sb.from('client_issues').insert(Object.assign({ client_id: ctx.clientId }, row));
        q.then(function (r) { if (r.error) throw r.error; if (ctx.onChange) ctx.onChange(); })
          .catch(function (e2) { btn.disabled = false; btn.textContent = '保存'; err(form, '保存できませんでした：' + ((e2 && e2.message) || e2)); });
      });
    }
    var nb = box.querySelector('[data-ais-new]');
    if (nb) nb.addEventListener('click', function () {
      var slot = box.querySelector('[data-ais-slot="new"]'); slot.innerHTML = formHtml({ rank: (ctx.issues || []).length + 1 });
      bindForm(slot.querySelector('form'), null); slot.querySelector('input[name="title"]').focus();
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-ais-edit]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-ais-edit'), card = box.querySelector('[data-ais-id="' + id + '"]');
        card.innerHTML = formHtml(byId[id]); bindForm(card.querySelector('form'), id);
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-ais-status]'), function (s) {
      s.addEventListener('change', function () {
        ctx.sb.from('client_issues').update({ status: s.value }).eq('id', s.getAttribute('data-ais-status'))
          .then(function (r) { if (r.error) throw r.error; if (ctx.onChange) ctx.onChange(); })
          .catch(function (e) { if (root.alert) root.alert('状態を変えられませんでした：' + ((e && e.message) || e)); });
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-ais-del]'), function (b) {
      b.addEventListener('click', function () {
        var x = byId[b.getAttribute('data-ais-del')];
        if (!root.confirm || !root.confirm('「' + x.title + '」を消します。元に戻せません。よろしいですか？')) return;
        ctx.sb.from('client_issues').delete().eq('id', x.id).then(function (r) { if (r.error) throw r.error; if (ctx.onChange) ctx.onChange(); })
          .catch(function (e) { if (root.alert) root.alert('消せませんでした：' + ((e && e.message) || e)); });
      });
    });
  }

  var api = { STATUS: STATUS, homeHtml: homeHtml, listHtml: listHtml, formHtml: formHtml, mount: mount, evidenceFrom: evidenceFrom, evidenceText: evidenceText, sorted: sorted };
  root.AirReachIssues = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
