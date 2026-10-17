/**
 * 計測の前後比較と、営業用の PDF（依頼書 R10・T13）。
 *   保存した2回の計測（measurement_runs の summary）だけから作る。画面と PDF は同じデータから作り、データの指紋（SHA-256）を両方に出す。
 *   AI ごとに、条件（AI・検索の有無・地域・モデル）・質問の版・質問の顔ぶれが同じときだけ差を出す。違えば「比べられない」と理由を出す。
 *   主に見るのは AI による概要（AIO）、補助は検索ありの ChatGPT。合算しない。集計は airreach-ai3.js と同じ（2対象・観測 ID で重ねない）
 *
 *   2026-10-09 の見直し
 *     - 比べるのは、質問・主体（対象の名前）・判定の版・取得（AI・検索・モデル）・地域が同じ観測だけ。記録が無い（条件不明）・違うときは理由を出して保留
 *     - 「施策の前後」は、パッチの公開を確かめた記録（opts.publish）の前と後に1回ずつあるときだけ。それ以外は「時系列の比較」（施策の効果には使わない）
 *     - 画面と PDF は、同じ比較の結果（cmp）と同じ指紋から作る
 */
(function (root) {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function A3() { return root.AirReachAI3; }
  function rowsOf(run) {
    var s = (run && run.summary) || {};
    return Array.isArray(s.answers) ? s.answers.map(function (a) { return Object.assign({ query_set_version: run.query_set_version || s.query_set_version || '' }, a); }) : [];
  }
  function promptSet(rows) { var o = {}; rows.forEach(function (r) { o[String(r.prompt || '').replace(/\s+/g, '')] = 1; }); return Object.keys(o).sort(); }
  function valSet(rows, f) { var o = {}, miss = 0; rows.forEach(function (r) { var v = f(r); if (v == null || v === '') miss += 1; else o[String(v)] = 1; }); return { vals: Object.keys(o).sort(), missing: miss }; }
  function normBrand(t) { return String(t || '').toLowerCase().replace(/[\s\u3000・･]+/g, ''); }
  /**
   * 施策の前後か、時系列の比較か。publish：{ at（公開した日時）, ok（いまの版の公開を見える形で確かめた）, version }
   */
  function kindOf(before, after, publish) {
    var tb = Date.parse(before.created_at || before.measured_on || ''), ta = Date.parse(after.created_at || after.measured_on || '');
    if (!publish || !publish.at) return { kind: 'timeline', why: 'パッチを公開した記録がありません' };
    if (!publish.ok) return { kind: 'timeline', why: 'パッチの公開を見える形で確かめていません' };
    var tp = Date.parse(publish.at);
    if (tb >= tp && ta >= tp) return { kind: 'timeline', why: '2回とも公開（' + publish.at.slice(0, 10) + '）より後の計測です' };
    if (tb < tp && ta < tp) return { kind: 'timeline', why: '2回とも公開（' + publish.at.slice(0, 10) + '）より前の計測です' };
    return { kind: 'effect', why: '', at: publish.at, version: publish.version || '' };
  }

  /** 2回の計測を比べる。before・after は { id, measured_on, created_at, query_set_version, summary } */
  function compare(before, after, opts) {
    opts = opts || {};
    var A = A3();
    if (!A) throw new Error('AI の集計の部品（airreach-ai3.js）を読み込めませんでした');
    // 比べるのは一般の質問（指名の質問は別集計）。opts.segment で変えられる
    var seg = opts.segment || 'general';
    var rb = A.bySegment(rowsOf(before), seg, opts.brand), ra = A.bySegment(rowsOf(after), seg, opts.brand);
    var sb = A.summarize(rb, { brand: opts.brand || '', segment: 'all' }), sa = A.summarize(ra, { brand: opts.brand || '', segment: 'all' });
    var out = { segment: seg, before: meta(before, rb), after: meta(after, ra), engines: [], kind: kindOf(before, after, opts.publish), rule: 'compare/2026.10.09' };
    A.MAIN.forEach(function (def) {
      var b = sb[def.key], a = sa[def.key], reasons = [];
      if (!rowsOf(before).length || !rowsOf(after).length) reasons.push('回答ごとの記録が無い計測です（古い形式）');
      else if (!rb.length || !ra.length) reasons.push(seg === 'general' ? '一般の質問がありません' : '指名の質問がありません');
      else {
        if (b.status !== 'measured') reasons.push('前の計測でこの AI を測っていません');
        if (a.status !== 'measured') reasons.push('後の計測でこの AI を測っていません');
      }
      if (!reasons.length) {
        var kb = A.conditionKey(Object.assign({}, b.rows[0], { judge_version: '' })), ka = A.conditionKey(Object.assign({}, a.rows[0], { judge_version: '' }));
        if (kb !== ka) {
          var cb = b.cond, ca = a.cond;
          if (cb.location !== ca.location) reasons.push('地域が違います（' + cb.location + ' → ' + ca.location + '）');
          if (cb.model !== ca.model) reasons.push('モデルが違います');
          if (cb.search !== ca.search) reasons.push('検索の有無が違います');
          if (!reasons.length) reasons.push('計測の条件が違います');
        }
        if ((before.query_set_version || '') !== (after.query_set_version || '')) reasons.push('質問の版が違います（' + (before.query_set_version || '—') + ' → ' + (after.query_set_version || '—') + '）');
        var pb = promptSet(b.rows), pa = promptSet(a.rows);
        if (pb.join('|') !== pa.join('|')) reasons.push('聞いた質問が違います（' + pb.length + '問 → ' + pa.length + '問）');
        if (b.others || a.others) reasons.push('1回の計測の中に条件の違う結果が混ざっています');
        // 条件の記録が無い観測は比べない（条件不明）
        if (b.rows.some(function (r) { return !r.conditions; }) || a.rows.some(function (r) { return !r.conditions; })) reasons.push('計測の条件が記録されていない回答があります（条件不明）');
        // 判定の版（名前が出たかの決め方）がそろっているか
        var jb = valSet(b.rows, function (r) { return r.judge_version; }), ja = valSet(a.rows, function (r) { return r.judge_version; });
        if (jb.missing || ja.missing) reasons.push('判定の版が記録されていない回答があります（条件不明）');
        else if (jb.vals.join('|') !== ja.vals.join('|')) reasons.push('判定の版が違います（' + jb.vals.join('・') + ' → ' + ja.vals.join('・') + '）');
        // 主体（だれの名前を探したか）がそろっているか
        var bb = valSet(b.rows, function (r) { return r.brand ? normBrand(r.brand) : ''; }), ba = valSet(a.rows, function (r) { return r.brand ? normBrand(r.brand) : ''; });
        if (bb.missing || ba.missing) reasons.push('どの名前（主体）で判定したかが記録されていない回答があります（条件不明）');
        else if (bb.vals.join('|') !== ba.vals.join('|')) reasons.push('判定した名前（主体）が違います');
      }
      var tb = b.status === 'measured' ? b.t : null, ta = a.status === 'measured' ? a.t : null;
      var ok = !reasons.length && tb.denominator > 0 && ta.denominator > 0;
      if (!reasons.length && !ok) reasons.push('分母が0の計測があります（取得失敗だけ・回答なし）');
      // 質問ごとの根拠：前後それぞれの結果（名前あり・なし・概要なし・失敗・要確認）
      var perQ = {};
      [['b', b], ['a', a]].forEach(function (x) {
        if (x[1].status !== 'measured') return;
        x[1].rows.forEach(function (r) { var k = String(r.prompt || ''); perQ[k] = perQ[k] || { prompt: k, b: '', a: '' }; perQ[k][x[0]] = A.outcome(r, opts.brand || ''); });
      });
      out.engines.push({ key: def.key, label: def.label, main: def.key === 'aio', comparable: ok, reasons: reasons, questions: Object.keys(perQ).map(function (k) { return perQ[k]; }),
        before: tb ? pick(tb) : null, after: ta ? pick(ta) : null,
        diff: ok ? Math.round((ta.rate - tb.rate) * 10) / 10 : null,
        small: !!(tb && ta && (tb.small || ta.small)), cond: a.status === 'measured' ? a.cond : (b.status === 'measured' ? b.cond : null) });
    });
    return out;
  }
  function pick(t) { return { mentioned: t.mentioned, denominator: t.denominator, rate: t.rate, attempts: t.attempts, errors: t.errors, notShown: t.notShown, official: t.official, officialJudged: t.officialJudged }; }
  function meta(run, rows) { return { id: run.id, measured_on: run.measured_on || '', created_at: run.created_at || '', version: run.query_set_version || '', answers: rows.length }; }

  /** 画面と PDF の材料（2回の計測の保存データと、公開の記録）の指紋。同じデータなら同じ値 */
  function fingerprint(before, after, publish) {
    var text = JSON.stringify([{ id: before.id, v: before.query_set_version || '', s: before.summary || null }, { id: after.id, v: after.query_set_version || '', s: after.summary || null }, publish ? { at: publish.at || '', ok: !!publish.ok, v: publish.version || '' } : null]);
    var c = root.crypto;
    if (!c || !c.subtle) return Promise.resolve('');
    return c.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }

  var OUT = { mentioned: '名前あり', no_mention: '名前なし', not_shown: '概要なし', error: '取得失敗', review: '要確認', '': '—' };
  function xn(t) { return t ? (t.denominator ? t.mentioned + ' / ' + t.denominator + '回' : 'N/A') : '未計測'; }
  function rate(t) { return t && t.rate != null ? t.rate + '%' : '—'; }
  function diffText(e) { return e.comparable ? (e.diff > 0 ? '+' : e.diff < 0 ? '−' : '±') + Math.abs(e.diff) + 'ポイント' : '比較を保留'; }

  /** 比べた結果の本文（画面と PDF で共通） */
  function bodyHtml(cmp, info) {
    info = info || {};
    var main = cmp.engines.filter(function (e) { return e.main; })[0], rest = cmp.engines.filter(function (e) { return !e.main; });
    function block(e, big) {
      return '<div class="acm-e' + (big ? ' is-main' : '') + (e.comparable ? '' : ' is-na') + '"><h3>' + esc(e.label) + (big ? '<span>主に見る指標</span>' : '') + '</h3>' +
        '<div class="acm-row"><div><small>前（' + esc(cmp.before.measured_on) + '）</small><b>' + esc(xn(e.before)) + '</b><em>' + esc(rate(e.before)) + '</em></div>' +
        '<div class="acm-arrow" aria-hidden="true">→</div>' +
        '<div><small>後（' + esc(cmp.after.measured_on) + '）</small><b>' + esc(xn(e.after)) + '</b><em>' + esc(rate(e.after)) + '</em></div>' +
        '<div class="acm-diff"><small>出現率の差</small><b>' + esc(diffText(e)) + '</b></div></div>' +
        (e.comparable ? '' : '<p class="acm-why"><b>比較を保留</b>理由：' + esc(e.reasons.join('／')) + '</p>') +
        (e.comparable && e.small ? '<p class="acm-why">分母が5回未満の計測があるため、差は大きく動きます。</p>' : '') +
        (e.key === 'aio' && e.before && e.after ? '<p class="acm-sub">分母は正常に取れた検索の数（AI の概要が出なかった検索も含む）。取得失敗は分母に入れていません（前 ' + esc(e.before.errors) + '回・後 ' + esc(e.after.errors) + '回）。</p>' : '') + '</div>';
    }
    var c = main.cond || {};
    // 質問ごとの根拠（主の AIO）と、優先して直すこと3点（サイトの診断から。AI の計測とは別の材料）
    var qs = (main.questions || []);
    var evid = qs.length ? '<div class="acm-ev"><h3>質問ごとの結果（' + esc(main.label) + '）</h3><table><thead><tr><th>質問</th><th>前</th><th>後</th></tr></thead><tbody>' +
      qs.map(function (x) { return '<tr><td>' + esc(x.prompt) + '</td><td>' + esc(OUT[x.b] || x.b) + '</td><td>' + esc(OUT[x.a] || x.a) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '';
    var imp = (info.improvements || []).slice(0, 3);
    var impH = imp.length ? '<div class="acm-imp"><h3>優先して直すこと（' + imp.length + '点）</h3><ol>' + imp.map(function (x) { return '<li><b>' + esc(x.title) + '</b>' + (x.how ? '<span>' + esc(x.how) + '</span>' : '') + '</li>'; }).join('') + '</ol><p class="acm-note">' + esc(info.improvementsSource || 'サイトの診断から') + '（AI の計測の結果とは別の材料です）</p></div>' : '';
    var K = cmp.kind || { kind: 'timeline', why: '' };
    var kindH = K.kind === 'effect' ? '<p class="acm-kind is-effect"><b>施策の前後</b>パッチ' + (K.version ? ' v' + esc(K.version) : '') + ' の公開（' + esc(String(K.at || '').slice(0, 10)) + '）の前と後の計測です。</p>'
      : '<p class="acm-kind is-timeline"><b>時系列の比較</b>施策の効果としては扱いません（' + esc(K.why || '公開と結び付いていません') + '）。</p>';
    return '<div class="acm-body">' + kindH + block(main, true) + rest.map(function (e) { return block(e, false); }).join('') + evid + impH +
      '<p class="acm-cond">' + esc(cmp.segment === 'branded' ? '指名の質問（名前を入れた質問）だけ' : cmp.segment === 'all' ? '一般と指名の質問をすべて' : '一般の質問（名前を入れていない質問）だけ。指名の質問は含めていません') + ' · 条件：' + esc(c.location === 'JP' || !c.location ? '日本（市区町村の指定なし）' : c.location) + ' · 質問の版 ' + esc(cmp.after.version || '—') +
      ' · 計測 ' + esc(cmp.before.measured_on) + '（' + esc(cmp.before.answers) + '件）→ ' + esc(cmp.after.measured_on) + '（' + esc(cmp.after.answers) + '件）</p>' +
      '<p class="acm-note">同じ条件・同じ質問の計測どうしだけを比べています。AI による概要（主）と ChatGPT（検索付き API での観測・補助）は合算しません。ほかの AI の記録は比べず、履歴として残しています。AI の答えは日や時間で変わり、一般の人が使う画面とは結果が違うことがあります。掲載や順位を保証するものではありません。' +
      (info.fp ? ' データの指紋：' + esc(info.fp.slice(0, 16)) : '') + '</p></div>';
  }

  /** 画面に出す */
  function render(box, before, after, opts) {
    if (!box) return Promise.resolve(null);
    var cmp = compare(before, after, opts);
    return fingerprint(before, after, opts && opts.publish).then(function (fp) {
      box.innerHTML = '<section class="acm" aria-label="前後の比較"><div class="acm-h"><h2>前後の比較</h2><button type="button" class="arc-btn" data-acm-print>営業用 PDF を作る</button></div>' + bodyHtml(cmp, Object.assign({}, opts || {}, { fp: fp })) + '</section>';
      var b = box.querySelector('[data-acm-print]');
      if (b) b.addEventListener('click', function () { openPrint(cmp, Object.assign({ fp: fp }, opts || {})); });
      return { cmp: cmp, fp: fp };
    });
  }

  var PRINT_CSS = 'body{font-family:"Hiragino Sans","Noto Sans JP",system-ui,sans-serif;color:#0f172a;margin:0;padding:32px 40px;background:#fff}h1{font-size:22px;margin:0 0 4px}.sub{color:#64748b;font-size:12px;margin:0 0 20px}' +
    '.acm-e{border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:0 0 12px;break-inside:avoid}.acm-e.is-main{border:2px solid #2563eb}.acm-e h3{margin:0 0 8px;font-size:15px}.acm-e h3 span{margin-left:8px;font-size:11px;color:#2563eb;font-weight:600}' +
    '.acm-row{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:flex-end}.acm-row small{display:block;color:#64748b;font-size:11px}.acm-row b{font-size:20px;font-variant-numeric:tabular-nums}.acm-row em{display:block;font-style:normal;color:#334155;font-variant-numeric:tabular-nums}.acm-arrow{color:#94a3b8;font-size:20px}' +
    '.acm-kind{margin:0 0 12px;padding:10px 14px;border-radius:10px;font-size:13px}.acm-kind b{margin-right:8px}.acm-kind.is-effect{background:#eff6ff;border:1px solid #bfdbfe}.acm-kind.is-timeline{background:#fffbeb;border:1px solid #fde68a}.acm-why b{margin-right:6px;color:#9a3412}' +
    '.acm-diff b{font-size:16px}.acm-ev h3,.acm-imp h3{font-size:14px;margin:16px 0 6px}.acm-ev table{width:100%;border-collapse:collapse;font-size:12px}.acm-ev th,.acm-ev td{border-bottom:1px solid #e2e8f0;padding:5px 6px;text-align:left}.acm-imp ol{margin:0;padding-left:20px;font-size:13px}.acm-imp li{margin:0 0 6px}.acm-imp span{display:block;color:#334155;font-size:12px}.acm-why,.acm-sub{margin:8px 0 0;font-size:12px;color:#334155}.acm-cond,.acm-note{font-size:11px;color:#64748b;margin:10px 0 0}.bar{margin:0 0 16px}.bar button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #2563eb;background:#2563eb;color:#fff;cursor:pointer}' +
    '@media print{.bar{display:none}body{padding:0}}';
  /** 営業用の PDF：新しいタブに同じ本文を出し、印刷（PDF 保存）する */
  function printHtml(cmp, info) {
    info = info || {};
    return '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>' + esc((info.clientName || 'AI 検索') + ' 前後の比較') + '</title><style>' + PRINT_CSS + '</style></head><body>' +
      '<div class="bar"><button onclick="window.print()">印刷 / PDF で保存</button></div>' +
      '<h1>' + esc(info.clientName || '') + ' AI 検索での見え方 前後の比較</h1>' +
      '<p class="sub">' + esc(info.site || '') + (info.site ? ' · ' : '') + '作成 ' + esc(new Date().toISOString().slice(0, 10)) + ' · 保存した計測 ' + esc(cmp.before.measured_on) + ' と ' + esc(cmp.after.measured_on) + ' から作成</p>' +
      bodyHtml(cmp, info) + '</body></html>';
  }
  function openPrint(cmp, info) {
    var w = root.open('', '_blank');
    if (!w) { if (root.alert) root.alert('新しいタブを開けませんでした。ポップアップを許可してください。'); return null; }
    w.document.open(); w.document.write(printHtml(cmp, info)); w.document.close();
    return w;
  }

  var api = { compare: compare, fingerprint: fingerprint, bodyHtml: bodyHtml, printHtml: printHtml, render: render, openPrint: openPrint };
  root.AirReachCompare = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
