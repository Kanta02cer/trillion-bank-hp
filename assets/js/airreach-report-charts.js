/**
 * AirReach 月次レポートの見える化（主要指標のタイル・推移・内訳・AI比較）。
 * レポート表示（airreach-report-view.js）と顧客のホーム（airreach-console.js）で共用する。
 * 図は SVG をその場で組み立てる（外部ライブラリなし・印刷/PDF でもそのまま出る）。
 *
 * 描き方の決まり
 *   - 値は材料にあるものだけ。無い月は点を打たず、線もつながない（0 と区別する）
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
    perplexity: { label: 'Perplexity', color: '#4a3aa7' }
  };
  var INK = '#0f172a', MUTED = '#64748b', GRID = '#e2e8f0', PREV = '#b8c0cc', BAR = '#2a78d6';
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
  function tiles(c) {
    c = c || {};
    var site = c.site || {}, cur = site.current, prev = site.previous, ai = c.ai, tr = c.traffic || {};
    var sc = cur ? cur.overall : null, b = band(sc);
    var t1 = '<div class="arv-tile"><div class="arv-tile-h">ホームページの情報整備</div>' +
      '<div class="arv-big">' + (sc == null ? '<span class="arv-na">未計測</span>' : esc(sc) + '<small>/100点</small>') +
      (sc == null ? '' : ' <span class="arv-band" style="border-color:' + b.color + ';color:' + b.color + '">' + esc(b.label) + '</span>') + '</div>' +
      scoreBar(sc) + deltaHtml(site.overallDelta, '点') + '</div>';

    var t2 = '<div class="arv-tile"><div class="arv-tile-h">AIの回答で引用された割合</div>';
    if (ai && ai.providers && ai.providers.length) {
      t2 += '<div class="arv-ai">' + ai.providers.map(function (p) {
        var s = series(p.provider);
        return '<div class="arv-ai-row"><span class="arv-key" style="background:' + s.color + '"></span><span class="arv-ai-name">' + esc(s.label) + '</span>' +
          '<span class="arv-ai-val">' + (p.citeRate == null ? '—' : esc(p.citeRate) + '%') + '</span>' + deltaHtml(p.citeDelta, 'pt') + '</div>';
      }).join('') + '</div>';
    } else t2 += '<div class="arv-big"><span class="arv-na">未計測</span></div>';
    t2 += '<div class="arv-tile-f">AIに同じ質問をして、公式サイトが出典に入った回答の割合</div></div>';

    var clicks = tr.gsc ? tr.gsc.clicks : null, clicksPrev = tr.gscPrev ? tr.gscPrev.clicks : null;
    var t3 = '<div class="arv-tile"><div class="arv-tile-h">検索からのクリック</div>' +
      '<div class="arv-big">' + (clicks == null ? '<span class="arv-na">未計測</span>' : esc(clicks) + '<small>回</small>') + '</div>' +
      deltaHtml(diff(clicks, clicksPrev), '回') + '<div class="arv-tile-f">Google 検索の結果からサイトに来た回数（Search Console）</div></div>';

    var cv = tr.ga4 ? tr.ga4.conversions : null, cvPrev = tr.ga4Prev ? tr.ga4Prev.conversions : null;
    var t4 = '<div class="arv-tile"><div class="arv-tile-h">問い合わせ・予約</div>' +
      '<div class="arv-big">' + (cv == null ? '<span class="arv-na">未計測</span>' : esc(cv) + '<small>件</small>') + '</div>' +
      deltaHtml(diff(cv, cvPrev), '件') + '<div class="arv-tile-f">サイト経由の問い合わせ・予約の件数（GA4）</div></div>';

    return '<div class="arv-tiles">' + t1 + t2 + t3 + t4 + '</div>';
  }

  // ---- 推移（折れ線・棒）--------------------------------------------------------
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

  var CW = 300, CH = 190, PAD = { l: 34, r: 88, t: 14, b: 26 };
  function frame(months, yMax, unit) {
    var iw = CW - PAD.l - PAD.r, ih = CH - PAD.t - PAD.b, out = '';
    var ticks = [0, yMax / 2, yMax];
    ticks.forEach(function (v) {
      var y = PAD.t + ih - v / yMax * ih;
      out += '<line x1="' + PAD.l + '" x2="' + (PAD.l + iw) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + GRID + '" stroke-width="1"/>' +
        '<text x="' + (PAD.l - 5) + '" y="' + (y + 3).toFixed(1) + '" font-size="11" text-anchor="end" fill="' + MUTED + '">' + fmt(v) + esc(unit) + '</text>';
    });
    months.forEach(function (m, i) {
      out += '<text x="' + xAt(i, months.length).toFixed(1) + '" y="' + (CH - 7) + '" font-size="11" text-anchor="middle" fill="' + MUTED + '">' + esc(ymShort(m)) + '</text>';
    });
    return out;
  }
  function fmt(v) { return Math.round(v * 10) / 10; }
  function xAt(i, n) { var iw = CW - PAD.l - PAD.r; return PAD.l + (n === 1 ? iw / 2 : i / (n - 1) * iw); }
  function yAt(v, yMax) { var ih = CH - PAD.t - PAD.b; return PAD.t + ih - Math.max(0, Math.min(yMax, v)) / yMax * ih; }
  function niceMax(v, floor) {
    var m = Math.max(floor || 1, v || 0);
    var p = Math.pow(10, Math.floor(Math.log10(m))), n = m / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }
  function svg(label, body) {
    return '<svg class="arv-chart" viewBox="0 0 ' + CW + ' ' + CH + '" role="img" aria-label="' + esc(label) + '">' + body + '</svg>';
  }
  /** 折れ線1本分。null の月で線を切る。最後の点に系列名と値を直接書く */
  function line(values, n, yMax, color, name, unit) {
    var segs = [], seg = [], out = '', last = -1;
    values.forEach(function (v, i) {
      if (v == null) { if (seg.length) segs.push(seg); seg = []; return; }
      seg.push([xAt(i, n), yAt(v, yMax), v, i]); last = i;
    });
    if (seg.length) segs.push(seg);
    segs.forEach(function (s) {
      if (s.length > 1) out += '<polyline fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="' + s.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '"/>';
      s.forEach(function (p) {
        out += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4" fill="' + color + '" stroke="#fff" stroke-width="2"><title>' + esc(name) + ' ' + esc(p[2]) + esc(unit) + '</title></circle>';
      });
    });
    if (last >= 0) {
      out += '<text x="' + (xAt(last, n) + 8).toFixed(1) + '" y="' + (yAt(values[last], yMax) + 3).toFixed(1) + '" font-size="11" fill="' + INK + '">' +
        (name ? esc(name) + ' ' : '') + esc(values[last]) + esc(unit) + '</text>';
    }
    return out;
  }

  function scoreTrend(h) {
    var months = h.map(function (x) { return x.month; }), n = months.length, body = '';
    bands().forEach(function (b) {   // 区分の範囲を背景に薄く敷く（右端に区分名）
      var y1 = yAt(Number(b.max) + (Number(b.max) === 100 ? 0 : 1), 100), y2 = yAt(Number(b.min), 100);
      body += '<rect x="' + PAD.l + '" y="' + y1.toFixed(1) + '" width="' + (CW - PAD.l - PAD.r) + '" height="' + (y2 - y1).toFixed(1) + '" fill="' + b.color + '" opacity=".07"/>' +
        '<text x="' + (PAD.l + 4) + '" y="' + (y1 + 11).toFixed(1) + '" font-size="9.5" fill="' + MUTED + '">' + esc(b.label) + '</text>';
    });
    body += frame(months, 100, '');
    var vals = h.map(function (x) { return x.score; });
    body += line(vals, n, 100, INK, '', '点');
    return svg('情報整備の点数の推移', body);
  }

  function citeTrend(h, providers) {
    var months = h.map(function (x) { return x.month; }), n = months.length;
    var max = 0;
    h.forEach(function (x) { providers.forEach(function (p) { var v = x.cite && x.cite[p]; if (v != null && v > max) max = v; }); });
    var yMax = niceMax(max, 20), body = frame(months, yMax, '%');
    providers.forEach(function (p) {
      var s = series(p);
      body += line(h.map(function (x) { return x.cite && x.cite[p] != null ? x.cite[p] : null; }), n, yMax, s.color, s.label, '%');
    });
    return svg('AIの回答で引用された割合の推移', body);
  }

  function barTrend(h, key, unit, label) {
    var months = h.map(function (x) { return x.month; }), n = months.length;
    var max = 0; h.forEach(function (x) { if (x[key] != null && x[key] > max) max = x[key]; });
    var yMax = niceMax(max, 10), body = frame(months, yMax, ''), iw = CW - PAD.l - PAD.r;
    var bw = Math.min(26, iw / n * 0.55);
    h.forEach(function (x, i) {
      var v = x[key];
      if (v == null) {
        body += '<text x="' + xAt(i, n).toFixed(1) + '" y="' + (yAt(0, yMax) - 4).toFixed(1) + '" font-size="10" text-anchor="middle" fill="' + MUTED + '">—</text>';
        return;
      }
      var y = yAt(v, yMax), y0 = yAt(0, yMax), hgt = Math.max(1, y0 - y), x0 = xAt(i, n) - bw / 2, r = Math.min(4, hgt);
      // 上端だけ角を丸め、基線側は四角のまま
      body += '<path d="M' + x0.toFixed(1) + ',' + y0.toFixed(1) + 'V' + (y + r).toFixed(1) + 'Q' + x0.toFixed(1) + ',' + y.toFixed(1) + ' ' + (x0 + r).toFixed(1) + ',' + y.toFixed(1) +
        'H' + (x0 + bw - r).toFixed(1) + 'Q' + (x0 + bw).toFixed(1) + ',' + y.toFixed(1) + ' ' + (x0 + bw).toFixed(1) + ',' + (y + r).toFixed(1) + 'V' + y0.toFixed(1) + 'Z" fill="' + BAR + '"' +
        (i === n - 1 ? '' : ' opacity=".55"') + '><title>' + esc(ymShort(x.month)) + ' ' + esc(v) + esc(unit) + '</title></path>';
      if (i === n - 1 || i === 0) body += '<text x="' + xAt(i, n).toFixed(1) + '" y="' + (y - 4).toFixed(1) + '" font-size="11" text-anchor="middle" fill="' + INK + '">' + esc(v) + '</text>';
    });
    return svg(label, body);
  }

  /** 推移の図（点数・AIの引用率・検索クリック）を横に並べる。目盛りは図ごとに1本 */
  function trends(c) {
    var h = historyOf(c);
    var providers = [];
    h.forEach(function (x) { Object.keys(x.cite || {}).forEach(function (p) { if (providers.indexOf(p) < 0) providers.push(p); }); });
    var anyScore = h.some(function (x) { return x.score != null; });
    var anyCite = h.some(function (x) { return providers.some(function (p) { return x.cite[p] != null; }); });
    var anyClick = h.some(function (x) { return x.clicks != null; });
    var legend = providers.map(function (p) { var s = series(p); return '<span class="arv-leg"><span class="arv-key" style="background:' + s.color + '"></span>' + esc(s.label) + '</span>'; }).join('');
    function box(title, sub, inner, has) {
      return '<figure class="arv-fig"><figcaption><b>' + esc(title) + '</b>' + (sub ? '<span>' + sub + '</span>' : '') + '</figcaption>' +
        (has ? inner : '<p class="arv-empty">この期間の計測はありません</p>') + '</figure>';
    }
    return '<div class="arv-trends">' +
      box('情報整備の点数', '0〜100点', scoreTrend(h), anyScore) +
      box('AIに引用された割合', legend, citeTrend(h, providers), anyCite) +
      box('検索からのクリック', '回／月', barTrend(h, 'clicks', '回', '検索からのクリックの推移'), anyClick) +
      '</div>';
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
      return '<li class="' + (it.ok ? 'is-ok' : 'is-ng') + '"><span class="arv-ready-i" aria-hidden="true">' + (it.ok ? '✓' : '—') + '</span>' +
        '<span><b>' + esc(it.label) + '</b><small>' + esc(it.note || (it.ok ? 'あり' : '未登録')) + '</small></span></li>';
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
        ? '<a class="arv-todo-studio" href="/airreach/studio/" target="_blank" rel="noopener">直す材料で下書きを作る ↗</a>'
        : '<span class="arv-todo-studio">Trillion Bank で下書きを用意できます</span>') : '';
      return '<li class="arv-todo is-' + pr.key + '"><span class="arv-todo-no">' + (i + 1) + '</span><div class="arv-todo-b">' +
        '<div class="arv-todo-h"><b>' + esc(t.text) + '</b><span class="arv-prio is-' + pr.key + '">' + pr.label + '</span>' + (t.factorLabel ? '<span class="arv-todo-f">' + esc(t.factorLabel) + '</span>' : '') + '</div>' +
        (t.how ? '<div class="arv-todo-how"><span>直し方</span>' + esc(t.how) + '</div>' : '') +
        (t.why ? '<div class="arv-todo-why">' + esc(t.why) + '</div>' : '') +
        '<div class="arv-todo-foot">' + studio + (opts.pick ? '<button type="button" class="arc-btn-sm" data-pick-todo="' + esc(t.how || t.text) + '">次の3施策に入れる</button>' : '') + '</div>' +
        '</div></li>';
    }).join('') + '</ol>' + (opts.limit && items.length > opts.limit ? '<p class="arv-todo-more">ほか ' + (items.length - opts.limit) + '件</p>' : '');
  }

  window.AirReachCharts = { tiles: tiles, trends: trends, factors: factors, aiCompare: aiCompare, sparkline: sparkline, readiness: readiness, todos: todos, band: band, series: series };
})();
