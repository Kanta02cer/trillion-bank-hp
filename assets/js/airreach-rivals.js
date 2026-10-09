/**
 * 競合との比較（画面の再設計）：いちばん新しい計測の回答から、
 *   ① ひと言の結論と順位 ② お店ごとの名前が出た質問の数 ③ 質問ごとにどのお店が出たか ④ なぜ相手が出るのか（出典の種類）
 *   を作る。AI ごと（AI による概要・AI モード・ChatGPT）に分け、合算しない。一般の質問だけで数える（指名の質問は除く）
 *   出典の種類：そのお店の公式サイト ／ 口コミ・予約・まとめ ／ SNS ／ そのほか（airreach-ai-breakdown.js と同じ一覧）
 */
(function (root) {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hostOf(u) { try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } }
  function under(h, base) { return !!base && !!h && (h === base || h.slice(-base.length - 1) === '.' + base); }
  function normName(t) { return String(t || '').toLowerCase().replace(/[\s　・･]+/g, ''); }
  // 2対象（AI による概要が主・ChatGPT は補助）。AI モードなどの過去の記録は消さないが、比較のタブには出さない
  var ENGINES = [['aio', 'AI による概要'], ['chatgpt_search', 'ChatGPT']];
  var SRC = [['official', 'お店の公式サイト'], ['portal', '口コミ・予約・まとめ'], ['sns', 'SNS'], ['other', 'そのほか']];

  function latestRun(runs) {
    var rs = (runs || []).filter(function (r) { return r && r.summary && Array.isArray(r.summary.answers) && r.summary.answers.length; })
      .sort(function (a, b) { return (Date.parse(b.created_at || b.measured_on) || 0) - (Date.parse(a.created_at || a.measured_on) || 0); });
    return rs[0] || null;
  }
  function srcType(host, ownHost) {
    var B = root.AirReachAIBreakdown || {};
    if (under(host, ownHost)) return 'official';
    if ((B.PORTAL || []).some(function (s) { return under(host, s); })) return 'portal';
    if ((B.SNS || []).some(function (s) { return under(host, s); })) return 'sns';
    return 'other';
  }

  /**
   * opts: { runs, brand, selfUrl, competitors: [{ name, url }], engine: 'aio'|'chatgpt_search' }
   */
  function compute(opts) {
    opts = opts || {};
    var run = latestRun(opts.runs), A = root.AirReachAI3;
    var out = { run: run, engine: opts.engine || 'aio', shops: [], questions: [], ok: false, reason: '' };
    if (!run || !A) { out.reason = run ? '' : 'まだ計測がありません'; return out; }
    var comps = (opts.competitors || []).filter(function (c) { return c && c.name; });
    if (!comps.length) { out.reason = '比べるお店が登録されていません'; return out; }
    var rows = A.bySegment(run.summary.answers, 'general', opts.brand).filter(function (r) { return A.engineOf(r) === out.engine; });
    if (!rows.length) { out.reason = 'この AI の一般の質問の回答がありません'; return out; }
    var selfHost = hostOf(opts.selfUrl);
    var shops = [{ name: opts.brand || '自分', self: true, host: selfHost }].concat(comps.map(function (c) { return { name: c.name, self: false, host: hostOf(c.url) }; }));
    shops.forEach(function (s) { s.mentioned = 0; s.src = { official: 0, portal: 0, sns: 0, other: 0 }; s.srcTotal = 0; });
    var shown = 0;
    rows.forEach(function (r) {
      var o = A.outcome(r, opts.brand);
      var q = { prompt: r.prompt || '', status: o, marks: [] };
      if (o === 'error') { q.marks = shops.map(function () { return 'e'; }); out.questions.push(q); return; }
      if (o === 'not_shown') { q.marks = shops.map(function () { return 's'; }); out.questions.push(q); shown += 1; return; } // AIO は概要なしも分母
      shown += 1;
      var cl = (r.citations || []).map(hostOf).filter(Boolean).filter(function (h, i, a) { return a.indexOf(h) === i; });
      shops.forEach(function (s, i) {
        var hit;
        if (s.self) hit = o === 'mentioned';
        else { var c = (r.competitors || []).filter(function (x) { return normName(x.name) === normName(s.name); })[0]; hit = !!(c && c.mentioned); }
        q.marks.push(hit ? 'm' : 'n');
        if (!hit) return;
        s.mentioned += 1;
        cl.forEach(function (h) { s.src[srcType(h, s.host)] += 1; s.srcTotal += 1; });
      });
      q.onlyRivals = q.marks[0] === 'n' && q.marks.slice(1).some(function (m) { return m === 'm'; });
      out.questions.push(q);
    });
    if (out.engine !== 'aio') shown = out.questions.filter(function (q) { return q.status !== 'error' && q.status !== 'not_shown'; }).length;
    out.denominator = shown;
    var sorted = shops.slice().sort(function (a, b) { return (b.mentioned - a.mentioned) || (a.self ? -1 : b.self ? 1 : 0); });
    var me = shops[0], above = shops.filter(function (s) { return !s.self && s.mentioned > me.mentioned; }).length;
    out.shops = sorted; out.rank = above + 1; out.total = shops.length;
    var top = sorted.filter(function (s) { return !s.self; })[0];
    out.gap = top && top.mentioned > me.mentioned ? top.mentioned - me.mentioned : 0;
    out.topRival = top;
    out.onlyRivals = out.questions.filter(function (q) { return q.onlyRivals; }).map(function (q) { return q.prompt; });
    out.selfOfficial = me.src.official; out.selfSrcTotal = me.srcTotal;
    out.ok = true;
    return out;
  }

  function conclusion(r) {
    var me = r.shops.filter(function (s) { return s.self; })[0];
    var head = r.total + '店のうち ' + r.rank + '位';
    if (r.gap && r.topRival) head += '。' + r.topRival.name + 'は、こちらより ' + r.gap + '問多く名前が出ています';
    else if (r.rank === 1) head += '。いちばん多く名前が出ています';
    return { head: head, sub: r.onlyRivals.length ? '相手だけが出た質問が ' + r.onlyRivals.length + '問あります（下の表の黄色）。' : '相手だけが出た質問はありません。', me: me };
  }

  function html(r, opts) {
    opts = opts || {};
    var tabs = '<div class="rvl-tabs" role="tablist" aria-label="AI">' + ENGINES.map(function (e) {
      return '<button type="button" role="tab" class="rvl-tab' + (e[0] === r.engine ? ' is-on' : '') + '" aria-selected="' + (e[0] === r.engine) + '" data-rv-engine="' + e[0] + '">' + esc(e[1]) + '</button>';
    }).join('') + '</div>';
    if (!r.ok) return tabs + '<p class="arc-note">' + esc(r.reason || '比べられません') + (r.reason === '比べるお店が登録されていません' ? '。Studio の「競合」で、近くの同業のお店を登録してから測ってください。' : '') + '</p>';
    var c = conclusion(r), max = Math.max(1, r.denominator);
    var when = r.run ? String(r.run.measured_on || r.run.created_at || '').slice(0, 10) : '';
    var bars = r.shops.map(function (s) {
      return '<div class="rvl-bar' + (s.self ? ' is-self' : '') + '"><span>' + esc(s.name) + (s.self ? '（自分）' : '') + '</span><div class="rvl-track"><div style="width:' + Math.round(s.mentioned / max * 100) + '%"></div></div><b>' + esc(s.mentioned) + '問</b></div>';
    }).join('');
    var MARK = { m: '●', n: '○', s: '－', e: '×' };
    var qrows = r.questions.map(function (q) {
      return '<tr' + (q.onlyRivals ? ' class="is-only"' : '') + '><td>' + esc(q.prompt) + (q.onlyRivals ? '<small>相手だけが出た</small>' : '') + '</td>' + q.marks.map(function (m, i) {
        return '<td class="rvl-m is-' + m + (i === 0 ? ' is-self' : '') + '">' + MARK[m] + '</td>';
      }).join('') + '</tr>';
    }).join('');
    // 質問ごとの表の列は、登録した順（自分が先頭）
    var cols = [opts.brand || '自分'].concat((opts.competitors || []).filter(function (x) { return x && x.name; }).map(function (x) { return x.name; }));
    var srcRows = r.shops.filter(function (s) { return s.mentioned; }).map(function (s) {
      var segs = SRC.map(function (k) { var w = s.srcTotal ? Math.round(s.src[k[0]] / s.srcTotal * 100) : 0; return w ? '<div class="rvl-seg is-' + k[0] + '" style="width:' + w + '%" title="' + esc(k[1]) + ' ' + s.src[k[0]] + '件"></div>' : ''; }).join('');
      return '<div class="rvl-bar' + (s.self ? ' is-self' : '') + '"><span>' + esc(s.name) + (s.self ? '（自分）' : '') + '</span><div class="rvl-track rvl-stack">' + (segs || '') + '</div><b>出典 ' + s.srcTotal + '件</b></div>';
    }).join('');
    var meNote = c.me && c.me.mentioned ? (c.me.src.official === 0 && c.me.srcTotal ? '<p class="rvl-warn">自分の名前が出た回答では、<b>公式サイトが一度も出典になっていません</b>（ほかのサイトの掲載から出ています）。</p>' : '') : '';
    return tabs +
      '<section class="rvl-head"><div class="rvl-eyebrow">ひと言でいうと</div><div class="rvl-title">' + esc(c.head) + '</div><p>' + esc(c.sub) + '</p>' +
      '<div class="rvl-kpi"><div><small>自分の順位</small><b>' + r.rank + '<span> 位 / ' + r.total + '店</span></b></div><div><small>1位との差</small><b>' + r.gap + '<span> 問</span></b></div></div></section>' +
      '<section class="rvl-sec"><h3>名前が出た質問の数（' + r.denominator + '問中）</h3>' + bars + '<p class="arc-note">' + esc(when) + ' の計測・一般の質問だけ。' + (r.engine === 'aio' ? 'AI による概要が出なかった質問も分母に入れています。' : '') + '回数が少ないので、1問の違いで順位が入れ替わります。</p></section>' +
      '<section class="rvl-sec"><h3>質問ごとに、どのお店が出たか</h3><p class="arc-note">● 名前が出た ／ ○ 出なかった ／ － 概要なし ／ × 取れなかった</p><div class="arc-table-wrap"><table class="rvl-table"><thead><tr><th>質問</th>' + cols.map(function (n, i) { return '<th' + (i === 0 ? ' class="is-self"' : '') + '>' + esc(n) + '</th>'; }).join('') + '</tr></thead><tbody>' + qrows + '</tbody></table></div></section>' +
      '<section class="rvl-sec"><div class="rvl-eyebrow">なぜ相手が出るのか</div><h3>AI がどこを見て名前を出したか（出典の種類）</h3>' +
      '<div class="rvl-legend">' + SRC.map(function (k) { return '<span><i class="rvl-seg is-' + k[0] + '"></i>' + esc(k[1]) + '</span>'; }).join('') + '</div>' +
      (srcRows || '<p class="arc-note">名前が出た回答に出典がありません。</p>') + meNote +
      '<p class="arc-note">名前が出た回答で、AI が出典にしたページを種類ごとに数えました。「お店の公式サイト」は、そのお店に登録した URL のサイトです（URL を登録していない競合は公式サイトを判定できません）。</p></section>';
  }

  /** ダッシュボードの画面に組み込む。ctx: { runs, brand, selfUrl, competitors } */
  function mount(box, ctx, engine) {
    if (!box) return;
    var r = compute(Object.assign({}, ctx, { engine: engine || 'aio' }));
    box.innerHTML = html(r, ctx) + '<div data-rv-why></div>';
    // なぜ相手が出るのか（出典ページの中身・AI の紹介のされ方・直すこと。airreach-rivals-why.js）
    if (root.AirReachRivalsWhy) { try { root.AirReachRivalsWhy.mount(box.querySelector('[data-rv-why]'), r, Object.assign({}, ctx, { engine: r.engine })); } catch (e) {} }
    Array.prototype.forEach.call(box.querySelectorAll('[data-rv-engine]'), function (b) { b.addEventListener('click', function () { mount(box, ctx, b.getAttribute('data-rv-engine')); }); });
  }

  var api = { compute: compute, html: html, mount: mount, conclusion: conclusion };
  root.AirReachRivals = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
