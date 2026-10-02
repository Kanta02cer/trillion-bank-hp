/**
 * AI計測の結果を「質問ごと」「言及の順位」「引用元の分類」に分けて見せる（Studio の AI計測）。
 *   材料は Studio の計測結果（state.hack2 の行）。新しい計測はせず、いまある結果から集計する。
 *   - 言及の順位: 計測 API が回答の全文から数えた順番（self_rank / order）。古い計測には無い
 *   - 引用元: 出典の一覧（citations）。返らない AI は回答の本文に書かれた URL（urls_in_answer）
 */
(function () {
  'use strict';
  var SNS = ['instagram.com', 'facebook.com', 'x.com', 'twitter.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'line.me', 'lin.ee', 'threads.net', 'pinterest.com', 'ameblo.jp', 'note.com'];
  // 口コミ・予約・地図・まとめ（お店を探す人が見るサイト）
  var PORTAL = ['tabelog.com', 'hotpepper.jp', 'retty.me', 'gnavi.co.jp', 'ikyu.com', 'google.com', 'maps.app.goo.gl', 'goo.gl', 'navitime.co.jp', 'jalan.net', 'beauty.hotpepper.jp', 'minimodel.jp', 'iko-yo.net', 'epark.jp', 'rakuten.co.jp', 'yahoo.co.jp', 'ozmall.co.jp', 'mynavi.jp', 'prtimes.jp', 'wikipedia.org', 'tripadvisor.jp', 'tripadvisor.com'];
  var CAT = { self: '自社', comp: '競合', sns: 'SNS', portal: '口コミ・予約・まとめ', other: 'その他' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hostOf(u) { try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } }
  function under(h, base) { return !!base && (h === base || h.slice(-base.length - 1) === '.' + base); }
  function est(r) { return String(r.evidenceClass || '') === 'Estimated' || /jev/i.test(String(r.engine || r.model || '')); }
  function pct(n, d) { return d ? Math.round(n / d * 1000) / 10 : null; }

  function classify(host, ctx) {
    if (under(host, ctx.selfHost)) return 'self';
    if (ctx.compHosts.some(function (c) { return under(host, c); })) return 'comp';
    if (SNS.some(function (s) { return under(host, s); })) return 'sns';
    if (PORTAL.some(function (s) { return under(host, s); })) return 'portal';
    return 'other';
  }

  /** いちばん新しい計測（run_id）の、実際の AI の行だけ */
  function latestRows(state) {
    var rs = (state.hack2 || []).filter(function (r) { return r.run_id && !est(r); });
    if (!rs.length) return [];
    var last = rs.reduce(function (m, r) { return r.run_id > m ? r.run_id : m; }, '');
    return rs.filter(function (r) { return r.run_id === last; });
  }

  /** 集計（画面と、ダッシュボードに残す計測の要約の両方で使う） */
  function summarize(rows, opts) {
    opts = opts || {};
    var ctx = { selfHost: hostOf(opts.selfUrl || ''), compHosts: (opts.competitors || []).map(function (c) { return hostOf(c.url || ''); }).filter(Boolean) };
    var brand = opts.brand || '';
    // 質問ごと
    var byQ = {};
    rows.forEach(function (r) {
      var k = r.prompt || r.keyword || '';
      var q = byQ[k] || (byQ[k] = { prompt: k, n: 0, selfMention: 0, selfCiteN: 0, selfCite: 0, compMention: 0, ranks: [], engines: {} });
      q.n += 1;
      q.engines[r.engine] = 1;
      if (r.mentioned) q.selfMention += 1;
      if (r.cited === 0 || r.cited === 1) { q.selfCiteN += 1; if (r.cited === 1) q.selfCite += 1; }
      if ((r.competitors || []).some(function (c) { return c.mentioned; })) q.compMention += 1;
      if (r.self_rank) q.ranks.push(r.self_rank);
    });
    var questions = Object.keys(byQ).map(function (k) {
      var q = byQ[k];
      return { prompt: q.prompt, answers: q.n, engines: Object.keys(q.engines), selfMention: q.selfMention, selfMentionRate: pct(q.selfMention, q.n),
        selfCite: q.selfCite, selfCiteJudged: q.selfCiteN, selfCiteRate: pct(q.selfCite, q.selfCiteN), compMention: q.compMention, compMentionRate: pct(q.compMention, q.n),
        bestRank: q.ranks.length ? Math.min.apply(null, q.ranks) : null };
    }).sort(function (a, b) { return (a.selfMentionRate == null ? -1 : a.selfMentionRate) - (b.selfMentionRate == null ? -1 : b.selfMentionRate); });

    // 言及の順位（自社と、登録した競合それぞれ）
    var withOrder = rows.filter(function (r) { return Array.isArray(r.order); });
    var names = [brand].concat((opts.competitors || []).map(function (c) { return c.name; })).filter(Boolean);
    var ranks = names.map(function (nm, i) {
      var d = { name: nm, self: i === 0, first: 0, second: 0, thirdPlus: 0, none: 0 };
      withOrder.forEach(function (r) {
        var at = r.order.indexOf(nm);
        if (at < 0 && i === 0 && r.self_rank) at = r.self_rank - 1; // 自社は計測時の名前で数えた順位を使う
        if (at === 0) d.first += 1; else if (at === 1) d.second += 1; else if (at >= 2) d.thirdPlus += 1; else d.none += 1;
      });
      return d;
    });

    // 引用元の分類
    var dom = {}, answersWithSource = 0;
    rows.forEach(function (r) {
      var urls = (r.citations && r.citations.length ? r.citations : (r.urls_in_answer || [])).slice(0, 20);
      if (urls.length) answersWithSource += 1;
      var seen = {};
      urls.forEach(function (u) {
        var h = hostOf(u); if (!h) return;
        var d = dom[h] || (dom[h] = { host: h, cat: classify(h, ctx), count: 0, answers: 0, urls: {} });
        d.count += 1;
        d.urls[u] = (d.urls[u] || 0) + 1;
        if (!seen[h]) { seen[h] = 1; d.answers += 1; }
      });
    });
    var domains = Object.keys(dom).map(function (h) {
      var d = dom[h];
      return { host: h, cat: d.cat, count: d.count, answers: d.answers, share: pct(d.answers, rows.length),
        urls: Object.keys(d.urls).map(function (u) { return { url: u, count: d.urls[u] }; }).sort(function (a, b) { return b.count - a.count; }).slice(0, 20) };
    }).sort(function (a, b) { return b.count - a.count; });
    var cats = {};
    Object.keys(CAT).forEach(function (k) { cats[k] = { count: 0, domains: 0 }; });
    domains.forEach(function (d) { cats[d.cat].count += d.count; cats[d.cat].domains += 1; });
    var totalCites = domains.reduce(function (s, d) { return s + d.count; }, 0);
    Object.keys(cats).forEach(function (k) { cats[k].share = pct(cats[k].count, totalCites); });

    return { answers: rows.length, answersWithOrder: withOrder.length, answersWithSource: answersWithSource, questions: questions, ranks: ranks, domains: domains, categories: cats, totalCites: totalCites };
  }

  function bar(v, color) { return '<span class="aib-bar"><i style="width:' + Math.max(0, Math.min(100, v || 0)) + '%;background:' + color + '"></i></span>'; }
  function rate(n, d) { return d ? esc(n) + '/' + esc(d) : '—'; }

  function render(el, state) {
    if (!el) return;
    var rows = latestRows(state);
    if (!rows.length) { el.innerHTML = ''; return; }
    var p = state.profile || {};
    var s = summarize(rows, { brand: p.brand || '', selfUrl: p.url || '', competitors: (state.competitors || []).filter(function (c) { return c.name; }) });
    // 計測の時刻は日本時間で（run_id は 'studio-' + 世界標準時の ISO 文字列）
    var when = '';
    var ms = rows[0] && rows[0].run_id ? Date.parse(String(rows[0].run_id).replace(/^studio-/, '')) : NaN;
    if (!isNaN(ms)) when = new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
    var h = '<div class="aib">';
    // 1. 質問ごと
    h += '<section class="ars-card aib-sec"><h3>質問ごとの結果 <small>（最新の計測' + (when ? '・' + esc(when) : '') + '・' + s.answers + '回答）</small></h3>' +
      '<p class="ars-gnote">自社の名前が出にくい質問から並べています。「出典」は出典の一覧が返る AI の回答だけで数えます。</p>' +
      '<div class="ars-table-wrap"><table class="ars-table aib-q"><thead><tr><th>質問</th><th>AI</th><th>自社の名前</th><th>自社が出典</th><th>競合の名前</th><th>自社の順位（最高）</th></tr></thead><tbody>' +
      s.questions.map(function (q) {
        return '<tr><td>' + esc(q.prompt) + '</td><td>' + esc(q.engines.join('・')) + '</td>' +
          '<td>' + bar(q.selfMentionRate, '#2563eb') + rate(q.selfMention, q.answers) + '</td>' +
          '<td>' + (q.selfCiteJudged ? bar(q.selfCiteRate, '#047857') + rate(q.selfCite, q.selfCiteJudged) : '<span class="ars-muted">判定なし</span>') + '</td>' +
          '<td>' + bar(q.compMentionRate, '#c2410c') + rate(q.compMention, q.answers) + '</td>' +
          '<td>' + (q.bestRank ? esc(q.bestRank) + '位' : '<span class="ars-muted">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
    // 2. 言及の順位
    h += '<section class="ars-card aib-sec"><h3>言及の順位 <small>（回答の中で何番目に名前が出たか）</small></h3>';
    if (!s.answersWithOrder) h += '<p class="ars-gnote">この計測には順位の記録がありません。もう一度「計測実行」を押すと数えます。</p>';
    else {
      h += '<table class="ars-table aib-rank"><thead><tr><th></th><th>1位</th><th>2位</th><th>3位以降</th><th>名前が出ない</th></tr></thead><tbody>' +
        s.ranks.map(function (r) {
          var tot = r.first + r.second + r.thirdPlus + r.none || 1;
          return '<tr' + (r.self ? ' class="is-self"' : '') + '><th>' + (r.self ? '<span class="aib-chip is-self">自社</span>' : '') + esc(r.name) + '</th>' +
            ['first', 'second', 'thirdPlus', 'none'].map(function (k) { return '<td>' + bar(r[k] / tot * 100, k === 'none' ? '#cbd5e1' : (r.self ? '#2563eb' : '#c2410c')) + esc(r[k]) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table>' +
        '<p class="ars-gnote">' + s.answersWithOrder + '回答で数えました。競合は「競合」の画面で登録した名前で数えます。</p>';
    }
    h += '</section>';
    // 3. 引用元の分類
    h += '<section class="ars-card aib-sec"><h3>引用元の分類 <small>（AI が出典にしたサイト）</small></h3>';
    if (!s.domains.length) h += '<p class="ars-gnote">この計測では出典の URL が取れませんでした。出典の一覧が返るのは Claude（検索あり）です。Perplexity は回答の本文に URL があるときだけ数えます。ChatGPT（検索なし）は出典を返しません。</p>';
    else {
      h += '<div class="aib-cats">' + Object.keys(CAT).map(function (k) {
        var c = s.categories[k];
        return '<div class="aib-cat is-' + k + '"><span>' + esc(CAT[k]) + '</span><b>' + (c.share == null ? 0 : esc(c.share)) + '%</b><small>' + esc(c.count) + '件・' + esc(c.domains) + 'サイト</small></div>';
      }).join('') + '</div>' +
        '<div class="ars-table-wrap"><table class="ars-table aib-dom"><thead><tr><th>サイト</th><th>分類</th><th>引用</th><th>出典にした回答の割合</th></tr></thead><tbody>' +
        s.domains.slice(0, 40).map(function (d) {
          return '<tr><td><details><summary>' + esc(d.host) + '</summary><ul>' + d.urls.map(function (u) { return '<li><a href="' + esc(u.url) + '" target="_blank" rel="noopener noreferrer">' + esc(u.url.replace(/^https?:\/\/(www\.)?/, '')) + '</a> ' + esc(u.count) + '件</li>'; }).join('') + '</ul></details></td>' +
            '<td><span class="aib-chip is-' + d.cat + '">' + esc(CAT[d.cat]) + '</span></td><td>' + esc(d.count) + '</td><td>' + (d.share == null ? '—' : esc(d.share) + '%') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<p class="ars-gnote">' + s.answersWithSource + ' / ' + s.answers + ' 回答から集計。自社＝対象サイト、競合＝「競合」で登録した URL のサイト、SNS＝Instagram・Facebook・X など。</p>';
    }
    h += '</section></div>';
    el.innerHTML = h;
  }

  window.AirReachAIBreakdown = { summarize: summarize, render: render, latestRows: latestRows, classify: classify, CAT: CAT };
})();
