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
    var aiRow = function (k, x, note) {
      if (x === undefined) return row(k, '<span class="arv-na">この月のレポートでは出していません</span>');
      if (!x || !x.now) return row(k, na);
      return row(k, '<b>' + esc(x.now.x) + '</b><small> / ' + esc(x.now.n) + '回</small>', x.prev ? (x.comparable ? '先月 ' + esc(x.prev.x) + ' / ' + esc(x.prev.n) + '回' : '先月と条件がそろっていないため比べていません') : note);
    };
    // 検索と訪問の数字は、対象期間（全期間・途中集計・期間不明）を必ず添える
    var traffic = function (k, rec, key, unit) {
      if (!rec || rec[key] == null) return row(k, na);
      var P = S ? S.periodOf(rec, r.period_month) : null;
      return row(k, '<b>' + esc(rec[key]) + '</b><small>' + unit + '</small>', P ? '<span class="arc-period' + (P.status === 'partial' ? ' is-partial' : P.status === 'unknown' ? ' is-unknown' : '') + '">' + esc(P.label) + '</span>' : '');
    };
    return '<section class="arc-card arc-cnums-card"><h2 class="arc-h2">' + esc(ymJa(r.period_month)) + 'の数字</h2><div class="arc-cnums">' +
      row('ホームページの情報整備', cur && cur.overall != null ? '<b>' + esc(cur.overall) + '</b><small>点</small>' + delta(site.overallDelta, '点') : na) +
      // AI の数字は2対象を別々に（2026-10-09）：Google の AI による概要（主）と ChatGPT（検索付き API での観測・補助）。いつも2つの枠を出し、
      // 無い月は「未計測」（この形で集計する前のレポートは「この月のレポートでは出していません」）。複数の AI を合わせた割合は出さない
      aiRow('Google の AI による概要に名前が出た', c.aio, '名前を入れていない質問・概要が出なかった検索も回数に入れています') +
      aiRow('ChatGPT の回答に名前が出た（補助）', c.chatgpt, '検索付き API での観測・回答が取れた数が分母') +
      traffic('検索からのクリック', tr.gsc, 'clicks', '回') +
      traffic('問い合わせ・予約', tr.ga4, 'conversions', '件') + '</div>' +
      '<p class="arc-note">測っていない数字は「未計測」と書きます（0 ではありません）。</p>' +
      (window.AirReachCharts ? '<details class="arc-more"><summary>数字の内訳を開く（AI ごと・前月との比較・対象期間）</summary>' + window.AirReachCharts.tiles(c) + '</details>' : '') + '</section>';
  }
  /**
   * ご判断いただきたいこと。opt.reply（お客様の画面）のときは項目ごとに返事の欄を置き、mountDecisions で返事のボタンと状態を描く
   *   返事を受け取れない画面（代理店向けデモ・DB が未適用）では、今までどおり「担当者へのご連絡で」
   */
  function decisionCard(r, opt) {
    var dec = r.client_decisions || [], reply = !!(opt && opt.reply);
    return dec.length ? '<section class="arc-card arc-decide"' + (reply ? ' data-dec-report="' + esc(r.id) + '"' : '') + '><h2 class="arc-h2">ご判断いただきたいこと</h2><ul class="arr-ul' + (reply ? ' arc-dec-list' : '') + '">' +
      dec.map(function (t, i) { return '<li' + (reply ? ' data-dec-i="' + i + '"' : '') + '><span class="arc-dec-t">' + esc(t) + '</span>' + (reply ? '<div class="arc-dec-a" data-dec-a></div>' : '') + '</li>'; }).join('') + '</ul>' +
      '<p class="arc-note" data-dec-note>' + (reply ? 'それぞれ、下のボタンでお返事ください。担当者が確認してから進めます。' : 'お返事は、担当者へのご連絡でお願いします。') + '</p></section>' : '';
  }
  var ANSWER = { ok: 'このまま進めてよい', revise: '直して返す' };
  function md(iso) { var t = Date.parse(iso); if (isNaN(t)) return ''; var d = new Date(t + 9 * 3600 * 1000); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); }
  /**
   * ご判断への返事（お客様の画面）。sec = decisionCard(r, { reply: true }) の section
   *   o: { sb, report, email, onMsg(text, kind), onChange() }
   *   返事は airreach_decision_reply（supabase/migrations/20261009130000_airreach_decision_replies.sql）。返事の記録は client_requests（kind = 'decision'）
   */
  function mountDecisions(sec, o) {
    if (!sec || !o || !o.sb || !o.report) return Promise.resolve(null);
    var sb = o.sb, rep = o.report;
    function say(t, k) { if (o.onMsg) o.onMsg(t, k); }
    function load() {
      return sb.from('client_requests').select('*').eq('client_id', rep.client_id).eq('kind', 'decision').order('requested_at', { ascending: false }).limit(100)
        .then(function (x) { if (x.error) throw new Error(x.error.message); return (x.data || []).filter(function (r) { return r.payload && String(r.payload.report_id) === String(rep.id) && r.status !== 'cancelled'; }); });
    }
    function draw(rows) {
      Array.prototype.forEach.call(sec.querySelectorAll('[data-dec-i]'), function (li) {
        var i = Number(li.getAttribute('data-dec-i')), box = li.querySelector('[data-dec-a]');
        var last = rows.filter(function (r) { return Number(r.payload.index) === i; })[0] || null;
        var mine = last && last.requested_by && o.email && String(last.requested_by).toLowerCase() === String(o.email).toLowerCase();
        var buttons = '<div class="arc-dec-btns"><button type="button" class="arc-btn arc-dec-ok" data-dec-pick="ok">' + ANSWER.ok + '</button><button type="button" class="arc-btn-sm arc-dec-rv" data-dec-pick="revise">' + ANSWER.revise + '</button></div>';
        box.innerHTML = last ? '<div class="arc-dec-done ' + (last.status === 'approved' ? 'is-ok' : 'is-wait') + '"><b>お返事：' + esc(ANSWER[last.action] || last.action) + '</b>' +
            '<small>' + esc(md(last.requested_at)) + ' · ' + (last.status === 'approved' ? '担当者が確認しました' + (last.decided_at ? '（' + esc(md(last.decided_at)) + '）' : '') : '担当者の確認待ち') + '</small>' +
            (last.note ? '<span class="arc-dec-n">' + esc(last.note) + '</span>' : '') +
            '<span class="arc-dec-more">' + (last.status === 'pending' && mine ? '<button type="button" class="arc-btn-sm" data-dec-cancel="' + esc(last.id) + '">取り消す</button>' : '') +
            '<button type="button" class="arc-btn-sm" data-dec-change>返事を変える</button></span></div>' : buttons;
        box.setAttribute('data-buttons', buttons);
      });
      var left = Array.prototype.filter.call(sec.querySelectorAll('[data-dec-i]'), function (li) { return !!li.querySelector('[data-dec-pick]'); }).length;
      var n = sec.querySelector('[data-dec-note]');
      if (n) n.textContent = left ? 'それぞれ、下のボタンでお返事ください。担当者が確認してから進めます。' : 'お返事ありがとうございます。担当者が確認してから進めます。';
      bind();
    }
    function form(box, kind) {
      var rv = kind === 'revise';
      box.innerHTML = '<form class="arc-dec-form" data-dec-form="' + kind + '"><label class="arc-dec-l">' + (rv ? '直してほしい点（必ず書いてください）' : '補足（任意）') +
        '<textarea class="arc-input" name="note" rows="' + (rv ? 3 : 2) + '" maxlength="500"' + (rv ? ' required' : '') + ' placeholder="' + (rv ? '例：料金は 17,600円〜 です' : '例：来週から載せてください') + '"></textarea></label>' +
        '<div class="arc-dec-btns"><button type="submit" class="arc-btn">「' + ANSWER[kind] + '」と返事する</button><button type="button" class="arc-btn-sm" data-dec-back>やめる</button></div></form>';
      var f = box.querySelector('form'); f.note.focus();
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var note = f.note.value.trim();
        if (rv && !note) { say('直してほしい点を書いてください', 'error'); f.note.focus(); return; }
        var b = f.querySelector('[type=submit]'); b.disabled = true;
        sb.rpc('airreach_decision_reply', { p_report_id: rep.id, p_index: Number(box.closest('[data-dec-i]').getAttribute('data-dec-i')), p_answer: kind, p_note: note || null }).then(function (x) {
          if (x.error) throw new Error(x.error.message || String(x.error));
          if (x.data && x.data.ok === false) throw new Error(x.data.reason || 'できませんでした');
          say('お返事を送りました。担当者が確認してから進めます。', 'ok');
          return refresh().then(function () { if (o.onChange) o.onChange(); });
        }).catch(function (e2) {
          b.disabled = false;
          // DB がまだ返事に対応していないとき（migration 20261009130000 の適用前）
          say(/airreach_decision_reply|schema cache|does not exist|Could not find/i.test(e2.message || '') ? '画面からのお返事はまだお使いいただけません。担当者へご連絡ください。' : (e2.message || String(e2)), 'error');
        });
      });
      box.querySelector('[data-dec-back]').addEventListener('click', function () { refresh(); });
    }
    function bind() {
      Array.prototype.forEach.call(sec.querySelectorAll('[data-dec-pick]'), function (b) {
        b.addEventListener('click', function () { form(b.closest('[data-dec-a]'), b.getAttribute('data-dec-pick')); });
      });
      Array.prototype.forEach.call(sec.querySelectorAll('[data-dec-change]'), function (b) {
        b.addEventListener('click', function () { var box = b.closest('[data-dec-a]'); box.innerHTML = box.getAttribute('data-buttons'); bind(); });
      });
      Array.prototype.forEach.call(sec.querySelectorAll('[data-dec-cancel]'), function (b) {
        b.addEventListener('click', function () {
          b.disabled = true;
          sb.rpc('airreach_request_cancel', { p_id: b.getAttribute('data-dec-cancel') }).then(function (x) {
            if (x.error) throw new Error(x.error.message);
            say('お返事を取り消しました', 'ok');
            return refresh().then(function () { if (o.onChange) o.onChange(); });
          }).catch(function (e) { b.disabled = false; say(e.message || String(e), 'error'); });
        });
      });
    }
    function refresh() { return load().then(draw); }
    return refresh().then(function () { return true; }, function () {
      // 返事の記録を読めないときは、今までどおり「担当者へのご連絡で」（ボタンは出さない）
      Array.prototype.forEach.call(sec.querySelectorAll('[data-dec-a]'), function (x) { x.remove(); });
      var n = sec.querySelector('[data-dec-note]'); if (n) n.textContent = 'お返事は、担当者へのご連絡でお願いします。';
      return null;
    });
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
  var api = { latest: clientLatest, numbers: clientNumbers, decision: decisionCard, mountDecisions: mountDecisions, competitor: competitorCard };
  root.AirReachClientHome = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
