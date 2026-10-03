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

  // 指名質問＝質問の文に自社の名前が入っている質問（空白と大文字・小文字は無視）。それ以外は一般質問
  function norm(t) { return String(t || '').toLowerCase().replace(/[\s\u3000・･]+/g, ''); }
  function isBranded(prompt, brand) {
    var b = norm(brand);
    if (!b) return false;
    var p = norm(prompt);
    if (p.indexOf(b) >= 0) return true;
    // 「株式会社」「店」などを外した名前でも探す（例: 株式会社ライフスタジオ → ライフスタジオ）
    var core = b.replace(/^(株式会社|有限会社|合同会社)|(株式会社|有限会社|合同会社)$/g, '').replace(/(本店|店)$/, '');
    return core.length >= 2 && p.indexOf(core) >= 0;
  }
  // 質問の種類ごとのまとめ（言及割合・言及の順位・引用割合・引用された URL の上位）
  function typeSummary(rows, ctx) {
    var n = rows.length, mention = 0, citeN = 0, cite = 0, r1 = 0, r2 = 0, r3 = 0, none = 0, withOrder = 0, urls = {}, withSrc = 0;
    rows.forEach(function (r) {
      if (r.mentioned) mention += 1;
      if (r.cited === 0 || r.cited === 1) { citeN += 1; if (r.cited === 1) cite += 1; }
      if (Array.isArray(r.order)) { withOrder += 1; if (r.self_rank === 1) r1 += 1; else if (r.self_rank === 2) r2 += 1; else if (r.self_rank >= 3) r3 += 1; else none += 1; }
      var list = (r.citations && r.citations.length ? r.citations : (r.urls_in_answer || [])).slice(0, 20), seen = {};
      if (list.length) withSrc += 1;
      list.forEach(function (u) { var k = String(u).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''); if (seen[k]) return; seen[k] = 1; urls[k] = urls[k] || { url: u, n: 0, cat: classify(hostOf(u), ctx) }; urls[k].n += 1; });
    });
    var top = Object.keys(urls).map(function (k) { return { url: k, href: urls[k].url, cat: urls[k].cat, answers: urls[k].n, share: pct(urls[k].n, withSrc) }; })
      .sort(function (a, b) { return b.answers - a.answers; }).slice(0, 3);
    return { answers: n, mentionRate: pct(mention, n), mention: mention, citeRate: pct(cite, citeN), cite: cite, citeJudged: citeN,
      ranks: { first: r1, second: r2, thirdPlus: r3, none: none, counted: withOrder }, topUrls: top, answersWithSource: withSrc };
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
      var q = byQ[k] || (byQ[k] = { prompt: k, n: 0, selfMention: 0, selfCiteN: 0, selfCite: 0, compMention: 0, compCiteN: 0, compCite: 0, ranks: [], engines: {}, answers: [] });
      q.n += 1;
      q.engines[r.engine] = 1;
      if (r.mentioned) q.selfMention += 1;
      if (r.cited === 0 || r.cited === 1) { q.selfCiteN += 1; if (r.cited === 1) q.selfCite += 1; }
      if ((r.competitors || []).some(function (c) { return c.mentioned; })) q.compMention += 1;
      // 競合が出典: 競合の URL を登録していて、出典で判定できた回答だけで数える
      var cj = (r.competitors || []).filter(function (c) { return c.cited === 0 || c.cited === 1; });
      if (cj.length) { q.compCiteN += 1; if (cj.some(function (c) { return c.cited === 1; })) q.compCite += 1; }
      q.answers.push({ engine: r.engine, mentioned: r.mentioned, cited: r.cited, rank: r.self_rank || null, order: r.order || null,
        comps: (r.competitors || []).filter(function (c) { return c.mentioned; }).map(function (c) { return c.name; }), text: r.answer_excerpt || '' });
      if (r.self_rank) q.ranks.push(r.self_rank);
    });
    var questions = Object.keys(byQ).map(function (k) {
      var q = byQ[k];
      return { prompt: q.prompt, answers: q.n, engines: Object.keys(q.engines), selfMention: q.selfMention, selfMentionRate: pct(q.selfMention, q.n),
        selfCite: q.selfCite, selfCiteJudged: q.selfCiteN, selfCiteRate: pct(q.selfCite, q.selfCiteN), compMention: q.compMention, compMentionRate: pct(q.compMention, q.n),
        compCite: q.compCite, compCiteJudged: q.compCiteN, compCiteRate: pct(q.compCite, q.compCiteN), detail: q.answers,
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

    var types = { general: typeSummary(rows.filter(function (r) { return !isBranded(r.prompt || r.keyword, brand); }), ctx),
      branded: typeSummary(rows.filter(function (r) { return isBranded(r.prompt || r.keyword, brand); }), ctx) };
    return { types: types, answers: rows.length, answersWithOrder: withOrder.length, answersWithSource: answersWithSource, questions: questions, ranks: ranks, domains: domains, categories: cats, totalCites: totalCites };
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
    var CAT2 = CAT;
    function typeCard(key, title, note) {
      var t = s.types[key];
      if (!t.answers) return '<div class="ars-card aib-type"><h3>' + title + '</h3><p class="ars-gnote">' + note + '</p><p class="ars-gnote">この計測には、この種類の質問がありません。</p></div>';
      var rk = t.ranks;
      return '<div class="ars-card aib-type"><h3>' + title + ' <small>' + t.answers + '回答</small></h3><p class="ars-gnote">' + note + '</p>' +
        '<div class="aib-kpis"><div><span>名前が出た割合</span><b>' + (t.mentionRate == null ? '—' : esc(t.mentionRate) + '%') + '</b><small>' + rate(t.mention, t.answers) + '</small></div>' +
        '<div><span>自社が出典の割合</span><b>' + (t.citeRate == null ? '—' : esc(t.citeRate) + '%') + '</b><small>' + (t.citeJudged ? rate(t.cite, t.citeJudged) : '出典が返る回答なし') + '</small></div></div>' +
        '<div class="aib-mini"><span>言及の順位</span>' + (rk.counted ? '<ul><li>1位 <b>' + rk.first + '</b>件</li><li>2位 <b>' + rk.second + '</b>件</li><li>3位以下 <b>' + rk.thirdPlus + '</b>件</li><li>言及なし <b>' + rk.none + '</b>件</li></ul>' : '<small>順位の記録なし（再計測で出ます）</small>') + '</div>' +
        '<div class="aib-mini"><span>引用された URL（上位3）</span>' + (t.topUrls.length ? '<ol>' + t.topUrls.map(function (u) {
          return '<li><a href="' + esc(u.href) + '" target="_blank" rel="noopener noreferrer">' + esc(u.url.length > 60 ? u.url.slice(0, 60) + '…' : u.url) + '</a> <span class="aib-chip is-' + u.cat + '">' + esc(CAT2[u.cat]) + '</span> ' + (u.share == null ? '' : esc(u.share) + '%') + '</li>';
        }).join('') + '</ol>' : '<small>出典の URL なし</small>') + '</div></div>';
    }
    h += '<div class="aib-types">' + typeCard('general', '一般質問', '店名・社名を含まない質問（例：大宮でおすすめのフォトスタジオは？）') + typeCard('branded', '指名質問', '店名・社名を含む質問（例：〇〇の料金プランを教えて）') + '</div>';
    // 1. 質問ごと
    h += '<section class="ars-card aib-sec"><h3>質問ごとの結果 <small>（最新の計測' + (when ? '・' + esc(when) : '') + '・' + s.answers + '回答）</small></h3>' +
      '<p class="ars-gnote">自社の名前が出にくい質問から並べています。「出典」は出典の一覧が返る AI の回答だけで数えます（競合は「競合と比べる」で URL を登録した会社）。質問を押すと、AI ごとの回答が読めます。</p>' +
      '<div class="ars-table-wrap"><table class="ars-table aib-q"><thead><tr><th>質問（押すと回答）</th><th>AI</th><th>自社の名前</th><th>自社が出典</th><th>競合の名前</th><th>競合が出典</th><th>自社の順位（最高）</th></tr></thead><tbody>' +
      s.questions.map(function (q) {
        var det = '<details class="aib-ans"><summary>' + esc(q.prompt) + '</summary>' + q.detail.map(function (a) {
          return '<div class="aib-ans-i"><div class="aib-ans-h"><b>' + esc(a.engine) + '</b>' +
            '<span>' + (a.mentioned ? '自社の名前あり' : '自社の名前なし') + (a.cited === 1 ? '・自社が出典' : a.cited === 0 ? '・自社は出典でない' : '') + (a.rank ? '・' + a.rank + '位' : '') + '</span>' +
            (a.comps.length ? '<span>競合: ' + esc(a.comps.join('、')) + '</span>' : '') +
            (a.order && a.order.length ? '<span>名前が出た順: ' + esc(a.order.join(' → ')) + '</span>' : '') + '</div>' +
            '<p>' + (a.text ? esc(a.text) + (a.text.length >= 400 ? '…' : '') : '<span class="ars-muted">回答の記録なし</span>') + '</p></div>';
        }).join('') + '<p class="ars-gnote">回答は冒頭の400文字まで保存しています。</p></details>';
        return '<tr><td>' + det + '</td><td>' + esc(q.engines.join('・')) + '</td>' +
          '<td>' + bar(q.selfMentionRate, '#2563eb') + rate(q.selfMention, q.answers) + '</td>' +
          '<td>' + (q.selfCiteJudged ? bar(q.selfCiteRate, '#047857') + rate(q.selfCite, q.selfCiteJudged) : '<span class="ars-muted">判定なし</span>') + '</td>' +
          '<td>' + bar(q.compMentionRate, '#c2410c') + rate(q.compMention, q.answers) + '</td>' +
          '<td>' + (q.compCiteJudged ? bar(q.compCiteRate, '#9a3412') + rate(q.compCite, q.compCiteJudged) : '<span class="ars-muted">判定なし</span>') + '</td>' +
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
        '<p class="ars-gnote">' + s.answersWithOrder + '回答で数えました。競合は「競合と比べる」の画面で登録した名前で数えます。</p>';
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
        '<p class="ars-gnote">' + s.answersWithSource + ' / ' + s.answers + ' 回答から集計。自社＝対象サイト、競合＝「競合と比べる」で登録した URL のサイト、SNS＝Instagram・Facebook・X など。</p>';
    }
    h += '</section></div>';
    el.innerHTML = h;
  }

  window.AirReachAIBreakdown = { isBranded: isBranded, summarize: summarize, render: render, latestRows: latestRows, classify: classify, CAT: CAT };
})();
