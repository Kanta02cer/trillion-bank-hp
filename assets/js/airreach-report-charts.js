/**
 * AirReach 月次レポートの見える化（主要指標のタイル・推移・内訳・AI比較）。
 * レポート表示（airreach-report-view.js）と顧客のホーム（airreach-console.js）で共用する。
 * 図は HTML/SVG をその場で組み立てる（外部ライブラリなし・印刷/PDF でもそのまま出る）。
 *
 * 描き方の決まり
 *   - 値は材料にあるものだけ。無い月は「未計測」と書く（0 と区別する）
 *   - 推移は折れ線にしない。今月の値・前月との差・一文のまとめ・値を書いた月ごとの棒で見せる
 *   - 1つの図に目盛りは1本（2軸の図は作らない）
 *   - 色だけに頼らない：区分は文字ラベル、系列は凡例と線の端の名前、増減は ▲▼ を併記
 *   - 数字や文字は黒系の文字色。系列の色は線・棒・点だけに使う
 *   - 点数の区分（要対策／要改善／良好）の境界と色は airreach-display.js（_data/airreach_display.yml）から読む
 */
(function () {
  'use strict';

  var SERIES = {                       // 分類色（参照パレットの1・2番。白地で色覚差 ΔE 24.7 を検証済み）
    openai: { label: 'ChatGPT', color: '#2a78d6' },
    gemini: { label: 'Gemini', color: '#eb6834' },
    claude: { label: 'Claude', color: '#1baf7a' },
    perplexity: { label: 'Perplexity', color: '#4a3aa7' },
    google_aio: { label: 'Google AI による概要', color: '#c2410c' },
    google_ai_mode: { label: 'Google AI モード', color: '#0e7490' },
    chatgpt_search: { label: 'ChatGPT（検索あり）', color: '#15803d' }
  };
  var INK = '#0f172a', MUTED = '#64748b', PREV = '#b8c0cc';
  var FALLBACK_BANDS = [
    { key: 'low', label: '要対策', min: 0, max: 39, color: '#dc2626' },
    { key: 'mid', label: '要改善', min: 40, max: 69, color: '#d97706' },
    { key: 'high', label: '良好', min: 70, max: 100, color: '#16a34a' }
  ];
  function bands() {
    var D = window.AirReachDisplay;
    return D && D.bands && D.bands.length ? D.bands : FALLBACK_BANDS;
  }
  function band(score) {
    if (score == null) return { label: '未確認', color: MUTED, key: 'unknown' };
    var s = Math.max(0, Math.min(100, Math.round(score))), bs = bands();
    for (var i = 0; i < bs.length; i++) if (s >= Number(bs[i].min) && s <= Number(bs[i].max)) return bs[i];
    return { label: '未確認', color: MUTED, key: 'unknown' };
  }
  function series(p) { return SERIES[p] || { label: p, color: '#52514e' }; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function ymShort(m) { return Number(String(m).slice(5, 7)) + '月'; }
  function diff(a, b) { return a == null || b == null ? null : Math.round((Number(a) - Number(b)) * 10) / 10; }
  function deltaHtml(d, unit, goodUp) {
    if (d == null) return '<span class="arv-delta is-na">前月比 —</span>';
    var up = d > 0, same = d === 0;
    var good = same ? '' : ((up === (goodUp !== false)) ? ' is-good' : ' is-bad');
    return '<span class="arv-delta' + good + '">' + (same ? '±0' : (up ? '▲ +' : '▼ ') + esc(d)) + esc(unit || '') + '<small> 前月比</small></span>';
  }

  // ---- 主要指標のタイル --------------------------------------------------------
  function scoreBar(score) {
    // 0〜100 の横帯に区分の範囲を薄く敷き、現在値に印をつける
    var W = 220, H = 32, bs = bands(), out = '';
    bs.forEach(function (b) {
      var x = Number(b.min) / 100 * W, w = (Number(b.max) + 1 - Number(b.min)) / 100 * W;
      out += '<rect x="' + x.toFixed(1) + '" y="8" width="' + Math.max(0, w - 2).toFixed(1) + '" height="8" rx="2" fill="' + b.color + '" opacity=".22"/>';
    });
    if (score != null) {
      var cx = Math.max(0, Math.min(100, score)) / 100 * W;
      out += '<rect x="0" y="8" width="' + cx.toFixed(1) + '" height="8" rx="2" fill="' + band(score).color + '"/>' +
        '<line x1="' + cx.toFixed(1) + '" x2="' + cx.toFixed(1) + '" y1="4" y2="20" stroke="' + INK + '" stroke-width="2"/>';
    }
    bs.forEach(function (b) {
      out += '<text x="' + ((Number(b.min) + Number(b.max) + 1) / 200 * W).toFixed(1) + '" y="31" font-size="10" text-anchor="middle" fill="' + MUTED + '">' + esc(b.label) + '</text>';
    });
    return '<svg class="arv-scorebar" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="0〜100点の区分の中での位置">' + out + '</svg>';
  }

  /** 1ページ目の上に置く4枚のタイル（数字と前月比） */
  function md(d) { var m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(d || '')); return m ? Number(m[1]) + '/' + Number(m[2]) : ''; }
  function tiles(c) {
    c = c || {};
    var site = c.site || {}, cur = site.current, prev = site.previous, ai = c.ai, tr = c.traffic || {};
    var sc = cur ? cur.overall : null, b = band(sc);
    var t1 = '<div class="arv-tile"><div class="arv-tile-h">ホームページの情報整備</div>' +
      '<div class="arv-big">' + (sc == null ? '<span class="arv-na">未計測</span>' : esc(sc) + '<small>/100点</small>') +
      (sc == null ? '' : ' <span class="arv-band" style="border-color:' + b.color + ';color:' + b.color + '">' + esc(b.label) + '</span>') + '</div>' +
      scoreBar(sc) + deltaHtml(site.overallDelta, '点') + '</div>';

    var monthly = ai && ai.basis === 'monthly';
    var t2 = '<div class="arv-tile"><div class="arv-tile-h">AIの回答で引用された割合' + (monthly ? '<small class="arv-tile-basis">今月の合計</small>' : '') + '</div>';
    if (ai && ai.providers && ai.providers.length) {
      t2 += '<div class="arv-ai">' + ai.providers.map(function (p) {
        var s = series(p.provider);
        // 判定できないとき「—」だけだと理由が分からないので一言添える（ChatGPT は検索しないので出典を判定しない）
        var why = p.citeRate != null ? '' : (p.provider === 'openai' ? '検索しない AI のため出典は判定しません' : '出典を判定できた回答がありません');
        // 分子／分母（引用された回答の数／出典の有無を判定できた回答の数）と、割合に入れなかった回答の数
        var nd = p.judged != null && p.citeCount != null && p.judged > 0 ? p.citeCount + '/' + p.judged + '回答' : '';
        var aside = [p.undetermined ? '判定できない ' + p.undetermined : '', p.notShown ? 'AI の回答なし ' + p.notShown : '', p.errors ? 'エラー ' + p.errors : ''].filter(Boolean).join('・');
        return '<div class="arv-ai-row"><span class="arv-key" style="background:' + s.color + '"></span><span class="arv-ai-name">' + esc(s.label) + '</span>' +
          '<span class="arv-ai-val">' + (p.citeRate == null ? '—' : esc(p.citeRate) + '%') + '</span>' + (why ? '<small class="arv-ai-why">' + esc(why) + '</small>' : deltaHtml(p.citeDelta, 'ポイント')) +
          ((nd || aside) ? '<small class="arv-ai-nd">' + esc(nd) + (nd && aside ? '（' + esc(aside) + '）' : esc(aside)) + '</small>' : '') + '</div>';
      }).join('') + '</div>';
    } else t2 += '<div class="arv-big"><span class="arv-na">未計測</span></div>';
    t2 += '<div class="arv-tile-f">' + (monthly ? '今月の計測 ' + esc(ai.runs) + '回（' + esc(md(ai.firstOn)) + (ai.runs > 1 ? '〜' + esc(md(ai.lastOn)) : '') + '）の合計。引用された回答 ÷ 出典の有無を判定できた回答。最新の計測は ' + esc(md(ai.latest && ai.latest.measuredOn)) :
      'AIに同じ質問をして、公式サイトが出典に入った回答の割合') + '</div></div>';

    var clicks = tr.gsc ? tr.gsc.clicks : null, clicksPrev = tr.gscPrev ? tr.gscPrev.clicks : null;
    var t3 = '<div class="arv-tile"><div class="arv-tile-h">検索からのクリック</div>' +
      '<div class="arv-big">' + (clicks == null ? '<span class="arv-na">未計測</span>' : esc(clicks) + '<small>回</small>') + '</div>' +
      deltaHtml(diff(clicks, clicksPrev), '回') + '<div class="arv-tile-f">Google 検索の結果からサイトに来た回数（Search Console）</div></div>';

    var cv = tr.ga4 ? tr.ga4.conversions : null, cvPrev = tr.ga4Prev ? tr.ga4Prev.conversions : null;
    var t4 = '<div class="arv-tile"><div class="arv-tile-h">問い合わせ・予約</div>' +
      '<div class="arv-big">' + (cv == null ? '<span class="arv-na">未計測</span>' : esc(cv) + '<small>件</small>') + '</div>' +
      deltaHtml(diff(cv, cvPrev), '件') + '<div class="arv-tile-f">サイト経由の問い合わせ・予約の件数（Google アナリティクス）</div></div>';

    return '<div class="arv-tiles">' + t1 + t2 + t3 + t4 + '</div>';
  }

  // ---- 推移（数字と棒）--------------------------------------------------------
  /** 古いレポート（推移を持たない）でも、前月と当月の2点は描けるようにする */
  function historyOf(c) {
    if (c && Array.isArray(c.history) && c.history.length) return c.history;
    var site = (c && c.site) || {}, tr = (c && c.traffic) || {}, ai = c && c.ai;
    var citeNow = {}, citePrev = {};
    if (ai) ai.providers.forEach(function (p) { citeNow[p.provider] = p.citeRate; citePrev[p.provider] = p.prevCiteRate; });
    return [
      { month: c && c.previousMonth, score: site.previous ? site.previous.overall : null, cite: citePrev, clicks: tr.gscPrev ? tr.gscPrev.clicks : null, conversions: tr.ga4Prev ? tr.ga4Prev.conversions : null },
      { month: c && c.periodMonth, score: site.current ? site.current.overall : null, cite: citeNow, clicks: tr.gsc ? tr.gsc.clicks : null, conversions: tr.ga4 ? tr.ga4.conversions : null }
    ];
  }

  /** 前月から今月への変化の一文（数字で言う） */
  function trendSentence(vals, unit) {
    var idx = []; vals.forEach(function (v, i) { if (v != null) idx.push(i); });
    if (!idx.length) return 'この6か月は計測がありません';
    if (idx.length === 1) return '測ったのは1回だけです（比べる月がありません）';
    var a = idx[0], b = idx[idx.length - 1], d = diff(vals[b], vals[a]);
    var span = (b - a) + 'か月';
    if (d === 0) return span + 'で変わっていません';
    return span + 'で ' + (d > 0 ? '+' : '') + d + unit + (d > 0 ? ' 増えました' : ' 減りました');
  }
  /** 月ごとの棒。棒の上に値、測っていない月は「未計測」。今月（最後）だけ濃くする */
  function monthBars(months, vals, unit, max) {
    var mx = max || Math.max.apply(null, vals.filter(function (v) { return v != null; }).concat([1]));
    var n = months.length;
    return '<div class="arv-bars" role="list">' + months.map(function (m, i) {
      var v = vals[i], last = i === n - 1;
      if (v == null) return '<div class="arv-bar is-na" role="listitem"><span class="arv-bar-v">未計測</span><span class="arv-bar-fill" style="height:3px"></span><span class="arv-bar-m">' + esc(ymShort(m)) + '</span></div>';
      var h = Math.max(4, Math.round(56 * Math.max(0, v) / (mx || 1)));
      return '<div class="arv-bar' + (last ? ' is-now' : '') + '" role="listitem"><span class="arv-bar-v">' + esc(v) + esc(unit) + '</span><span class="arv-bar-fill" style="height:' + h + 'px"></span><span class="arv-bar-m">' + esc(ymShort(m)) + '</span></div>';
    }).join('') + '</div>';
  }
  /** 1指標のカード：今月の値・前月との差・一文のまとめ・月ごとの棒 */
  function trendCard(title, months, vals, unit, opts) {
    opts = opts || {};
    var n = vals.length, now = vals[n - 1], prev = vals[n - 2];
    var has = vals.some(function (v) { return v != null; });
    var head = '<div class="arv-tc-h"><b>' + esc(title) + '</b>' + (opts.tag || '') + '</div>';
    if (!has) return '<figure class="arv-tc">' + head + '<p class="arv-empty">この6か月は計測がありません</p></figure>';
    var big = now == null ? '<span class="arv-tc-now is-na">今月は未計測</span>'
      : '<span class="arv-tc-now">' + esc(now) + '<small>' + esc(unit) + '</small></span>' + deltaHtml(diff(now, prev), unit, opts.goodUp);
    return '<figure class="arv-tc">' + head +
      '<div class="arv-tc-big">' + big + '</div>' +
      '<p class="arv-tc-say">' + esc(trendSentence(vals, unit)) + '</p>' +
      monthBars(months, vals, unit, opts.max) + '</figure>';
  }

  /** 推移（点数・AIの引用率・検索クリック・問い合わせ）。折れ線は使わず、数字と棒で読めるようにする */
  function trends(c) {
    var h = historyOf(c);
    var months = h.map(function (x) { return x.month; });
    var providers = [];
    h.forEach(function (x) { Object.keys(x.cite || {}).forEach(function (p) { if (providers.indexOf(p) < 0) providers.push(p); }); });
    var pick = function (k) { return h.map(function (x) { return x[k] != null ? x[k] : null; }); };
    var cards = [trendCard('情報整備の点数', months, pick('score'), '点', { max: 100 })];
    if (providers.length) providers.forEach(function (p) {
      var s = series(p);
      cards.push(trendCard('AIに引用された割合', months, h.map(function (x) { return x.cite && x.cite[p] != null ? x.cite[p] : null; }), '%',
        { tag: '<span class="arv-leg"><span class="arv-key" style="background:' + s.color + '"></span>' + esc(s.label) + '</span>' }));
    });
    else cards.push(trendCard('AIに引用された割合', months, months.map(function () { return null; }), '%'));
    cards.push(trendCard('検索からのクリック', months, pick('clicks'), '回'));
    cards.push(trendCard('問い合わせ・予約', months, pick('conversions'), '件'));
    return '<div class="arv-trends">' + cards.join('') + '</div>' +
      '<p class="arv-trend-note">濃い棒が今月です。測っていない月は「未計測」と書きます（0 ではありません）。</p>';
  }

  // ---- 情報整備の内訳（4項目の横棒）-------------------------------------------
  var FACTOR = { structure: 'ページの骨格', entity: '会社・お店の情報', faq: 'よくある質問', discover: '見つけやすさ' };
  function factors(c) {
    var cur = c && c.site && c.site.current;
    if (!cur || !cur.factors) return '';
    var rows = Object.keys(FACTOR).map(function (k) {
      var v = cur.factors[k], b = band(v);
      return '<div class="arv-fac"><span class="arv-fac-n">' + FACTOR[k] + '</span>' +
        '<span class="arv-fac-bar"><span style="width:' + (v == null ? 0 : Math.max(2, Math.min(100, v))) + '%;background:' + b.color + '"></span></span>' +
        '<span class="arv-fac-v">' + (v == null ? '未確認' : esc(v) + '点') + ' <small style="color:' + b.color + '">' + esc(b.label) + '</small></span></div>';
    }).join('');
    return '<div class="arv-facs">' + rows + '</div>';
  }

  // ---- AI別の前月・当月の比較（横棒）-----------------------------------------
  function aiCompare(c) {
    var ai = c && c.ai;
    if (!ai || !ai.providers || !ai.providers.length) return '';
    return '<div class="arv-cmp">' + ai.providers.map(function (p) {
      var s = series(p.provider);
      function bar(v, color, lbl) {
        return '<div class="arv-cmp-row"><span class="arv-cmp-l">' + lbl + '</span><span class="arv-cmp-bar"><span style="width:' + (v == null ? 0 : Math.max(1, Math.min(100, v))) + '%;background:' + color + '"></span></span><span class="arv-cmp-v">' + (v == null ? '—' : esc(v) + '%') + '</span></div>';
      }
      return '<div class="arv-cmp-g"><div class="arv-cmp-h"><span class="arv-key" style="background:' + s.color + '"></span>' + esc(s.label) + '</div>' +
        bar(p.prevCiteRate, PREV, '前月') + bar(p.citeRate, s.color, '今月') + '</div>';
    }).join('') + '</div>';
  }

  // ---- 一覧用の小さな推移（点数・0〜100）--------------------------------------
  /** values: 古い順の点数（null 可）。区分の色で最後の点を塗る */
  function sparkline(values, label) {
    var W = 120, H = 34, P = 4, n = values.length, pts = [], out = '';
    if (!values.some(function (v) { return v != null; })) return '<span class="arv-na" style="font-size:.75rem">診断なし</span>';
    values.forEach(function (v, i) {
      if (v == null) return;
      var x = n === 1 ? W / 2 : P + i / (n - 1) * (W - P * 2), y = H - P - Math.max(0, Math.min(100, v)) / 100 * (H - P * 2);
      pts.push([x, y, v]);
    });
    bands().forEach(function (b) {
      var y1 = H - P - (Number(b.max) + (Number(b.max) === 100 ? 0 : 1)) / 100 * (H - P * 2), y2 = H - P - Number(b.min) / 100 * (H - P * 2);
      out += '<rect x="0" y="' + y1.toFixed(1) + '" width="' + W + '" height="' + (y2 - y1).toFixed(1) + '" fill="' + b.color + '" opacity=".08"/>';
    });
    if (pts.length > 1) out += '<polyline fill="none" stroke="' + INK + '" stroke-width="1.6" stroke-linejoin="round" points="' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '"/>';
    var last = pts[pts.length - 1];
    out += '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3.5" fill="' + band(last[2]).color + '" stroke="#fff" stroke-width="1.5"/>';
    return '<svg class="arv-spark" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label || '点数の推移') + '">' + out + '</svg>';
  }

  /** 材料のそろい具合（✓／未）。items: [{label, ok, note}] */
  function readiness(items) {
    return '<ul class="arv-ready">' + items.map(function (it) {
      // href があれば、その作業をする画面へのリンクにする（まだのものは「やる」を添える）
      var inner = '<span class="arv-ready-i" aria-hidden="true">' + (it.ok ? '✓' : '—') + '</span>' +
        '<span><b>' + esc(it.label) + '</b><small>' + esc(it.note || (it.ok ? 'あり' : '未登録')) + (it.href && !it.ok ? ' <span class="arv-ready-go">→ ' + esc(it.go || '開く') + '</span>' : '') + '</small></span>';
      return '<li class="' + (it.ok ? 'is-ok' : 'is-ng') + '">' + (it.href ? '<a class="arv-ready-a" href="' + esc(it.href) + '">' + inner + '</a>' : inner) + '</li>';
    }).join('') + '</ul>';
  }

  // ---- 直すこと（最新の診断の不足を、配点の大きい順に）-------------------------
  function priority(points) {
    return points >= 4 ? { key: 'high', label: '優先度 高' } : points >= 3 ? { key: 'mid', label: '優先度 中' } : { key: 'low', label: '優先度 低' };
  }
  /**
   * items: AirReachReport.todoList() の結果
   * opts: { audience: 'staff'|'client', limit, pick: true（「次の3施策に入れる」ボタン） }
   */
  function todos(items, opts) {
    opts = opts || {};
    if (!items || !items.length) return '<p class="arv-todo-none">✓ 診断で見つかった不足はありません。</p>';
    var list = opts.limit ? items.slice(0, opts.limit) : items;
    return '<ol class="arv-todos">' + list.map(function (t, i) {
      var pr = priority(t.points);
      var studio = t.studio ? (opts.audience === 'staff'
        ? '<a class="arv-todo-studio" href="' + esc(opts.studioHref || '/airreach/studio/') + '">直す材料で下書きを作る →</a>'
        : '<span class="arv-todo-studio">Trillion Bank で下書きを用意できます</span>') : '';
      // お客様には専門用語を使わない言い方を出し、制作会社に伝えるための正式な用語は小さく添える
      var client = opts.audience !== 'staff';
      var title = client ? (t.plainText || t.text) : t.text, how = client ? (t.plainHow || t.how) : t.how, why = client ? (t.plainWhy || t.why) : t.why;
      return '<li class="arv-todo is-' + pr.key + '"><span class="arv-todo-no">' + ((opts.start || 0) + i + 1) + '</span><div class="arv-todo-b">' +
        '<div class="arv-todo-h"><b>' + esc(title) + '</b><span class="arv-prio is-' + pr.key + '">' + pr.label + '</span>' + (t.factorLabel ? '<span class="arv-todo-f">' + esc(t.factorLabel) + '</span>' : '') + '</div>' +
        (how ? '<div class="arv-todo-how"><span>直し方</span>' + esc(how) + '</div>' : '') +
        (why ? '<div class="arv-todo-why">' + esc(why) + '</div>' : '') +
        (t.basis ? '<div class="arv-todo-basis"><span>この提案の理由</span>' + esc(t.basis) + '</div>' : '') +
        (client && t.plainText && t.plainText !== t.text ? '<div class="arv-todo-tech">制作会社の方へ：' + esc(t.text) + '</div>' : '') +
        '<div class="arv-todo-foot">' + studio + (opts.pick ? '<button type="button" class="arc-btn-sm" data-pick-todo="' + esc(t.plainHow || t.how || t.text) + '">次の3施策に入れる</button>' : '') + '</div>' +
        '</div></li>';
    }).join('') + '</ol>' + (opts.limit && items.length > opts.limit ? '<p class="arv-todo-more">ほか ' + (items.length - opts.limit) + '件' + esc(opts.moreText || '') + '</p>' : '');
  }

  window.AirReachCharts = { tiles: tiles, trends: trends, factors: factors, aiCompare: aiCompare, sparkline: sparkline, readiness: readiness, todos: todos, band: band, series: series };
})();
