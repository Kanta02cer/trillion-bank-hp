/**
 * 2対象（Google の AI による概要・検索ありの ChatGPT）の主表示の集計と描画（依頼書 R04・R09・T06・T07・T12、2対象の方針 two-engine/1）。
 *   AI による概要が主、ChatGPT（検索付き API での観測）は補助。合算しない。AI モード・Gemini・Perplexity などの過去の記録は消さず、
 *   主表示の外に「ほかの AI の記録（履歴）」として件数だけ出す（HISTORY）。
 *   反復観測：同じ検索語を同じ計測の中で何回も聞くときは、予定の1回ごとに観測 ID（obs_id）を付ける。取り直し（再試行）や後続の取得で
 *   同じ obs_id の行が複数あっても1回として数える（dedupeObs：取れた行のうち新しいもの、取れた行が無ければ新しい失敗の行）。
 *   1回の計測（run）の回答の行だけを、同じ条件（AI・検索の有無・地域・モデル）ごとに数える。条件や質問の版が違う結果は混ぜない。
 *
 *   結果の分け方（1行＝1回の試行）
 *     error      取得失敗（通信・時間切れ・回数の上限など）。分母に入れない。0件の成功にしない
 *     not_shown  正常に取れたが AI の概要（回答）が出なかった。AIO は分母に入れる（言及は0）。AI モード・ChatGPT は回答が無いので分母に入れない
 *     mentioned  回答があり、名前が出た
 *     no_mention 回答があり、名前が出なかった
 *     review     名前は出たが「確認できません」のような否定・同名の別の会社の疑いがある（要確認。言及に数えない・分母には入れる）
 *
 *   出現率（言及率）
 *     AIO      ＝ 名前が出た概要の数 ÷ 正常に取れた検索の数（概要なしを含む）
 *     AI モード・ChatGPT ＝ 名前が出た回答の数 ÷ 回答が取れた数
 *     分母0は null（N/A）。0% にしない
 *   出典は、公式サイトが正式な出典（AI が返した出典の一覧）／対象の記事が正式な出典／回答の本文に公式サイトの URL、を別々に数える
 */
(function (root) {
  'use strict';
  var MAIN = [
    { key: 'aio', label: 'AI による概要', short: 'AI による概要', sub: 'Google 検索の AI による概要（主）', notShownInDenominator: true },
    { key: 'chatgpt_search', label: 'ChatGPT', short: 'ChatGPT', sub: '検索付き API での観測（補助）', notShownInDenominator: false }
  ];
  // 主表示に出さない（過去の記録として残す）AI
  var HISTORY = { aimode: 'AI モード', gemini: 'Gemini', perplexity: 'Perplexity', claude: 'Claude', chatgpt_nosearch: 'ChatGPT（検索なし）' };
  /**
   * 観測 ID で重ならないようにする。obs_id の無い行（これまでの記録）はそのまま1行1回。
   *   同じ obs_id の行が複数ある（再試行・後続の取得）ときは、取れた行（失敗でない）のうち新しいもの、無ければ新しい失敗の行を1つだけ残す
   */
  function dedupeObs(rows) {
    var by = {}, out = [], extra = 0;
    (rows || []).forEach(function (r) {
      if (!r || !r.obs_id) { out.push(r); return; }
      var k = String(r.obs_id), cur = by[k];
      if (!cur) { by[k] = r; out.push(r); return; }
      extra += 1;
      var okN = r.status !== 'error', okC = cur.status !== 'error', newer = (Number(r.attempt) || 0) > (Number(cur.attempt) || 0) || ((Number(r.attempt) || 0) === (Number(cur.attempt) || 0) && String(r.measured_at || '') > String(cur.measured_at || ''));
      if ((okN && !okC) || (okN === okC && newer)) { out[out.indexOf(cur)] = r; by[k] = r; }
    });
    out.superseded = extra;
    return out;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pct(n, d) { return d ? Math.round(n / d * 1000) / 10 : null; }
  // URL をそろえる。記事を見分ける問い合わせ（article.php?id=111 の id など）は残し、追跡用（utm_* など）だけ外す。
  // 以前は ? 以降をすべて外していたため、id=111 と id=222 を同じ記事として数えていた
  var TRACK = /^(utm_[a-z_]+|fbclid|gclid|gbraid|wbraid|yclid|msclkid|mc_cid|mc_eid|_ga|_gl|srsltid|ref|ref_src|igshid)$/i;
  function normUrl(u) {
    var s0 = String(u || '').trim().replace(/#.*$/, ''), q = '', i = s0.indexOf('?');
    if (i >= 0) { q = s0.slice(i + 1); s0 = s0.slice(0, i); }
    var base = s0.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
    var keep = q.split('&').filter(function (kv) { var k = kv.split('=')[0]; return k && !TRACK.test(decodeURIComponent(k)); }).sort();
    return base + (keep.length ? '?' + keep.join('&') : '');
  }

  /** 行がどの主表示の AI か（ChatGPT は検索ありだけを主表示にする。検索なしは別の履歴） */
  function engineOf(r) {
    var c = r.conditions || {}, e = String(c.engine || r.engine_key || r.engine || '').toLowerCase();
    if (e === 'google_aio' || /ai overviews/.test(e)) return 'aio';
    if (e === 'google_ai_mode' || /ai mode/.test(e)) return 'aimode';
    if (e === 'chatgpt_search') return c.search === false ? 'chatgpt_nosearch' : 'chatgpt_search';
    if (e === 'chatgpt' || e === 'openai' || /^chatgpt/.test(e)) return c.search === true && c.engine === 'chatgpt_search' ? 'chatgpt_search' : 'chatgpt_nosearch';
    return e || 'other';
  }
  /** 同じ条件かを見る鍵：AI・検索の有無・地域・モデル・判定の版（と、渡されれば質問の版） */
  function conditionKey(r, version) {
    var c = r.conditions || {};
    return [engineOf(r), c.search === false ? 'nosearch' : 'search', c.location || 'JP', c.model || r.model || '', r.judge_version || '', version || ''].join('|');
  }

  // 「〇〇は確認できません」「〇〇という会社は見つかりません」のような否定は、名前が出ても言及に数えない
  var DENY = /(確認できません|確認できませんでした|見つかりません|見つかりませんでした|存在しない|存在しません|情報がありません|情報は見当たりません|わかりません|分かりません|特定できません|把握していません)/;
  function nearName(text, brand) {
    if (!brand) return '';
    var t = String(text || ''), b = String(brand).replace(/\s+/g, ''), flat = t.replace(/\s+/g, '');
    var i = flat.indexOf(b);
    return i < 0 ? '' : flat.slice(Math.max(0, i - 10), i + b.length + 40);
  }
  // 指名質問＝質問の文に自社の名前が入っている質問（airreach-ai-breakdown.js と同じ決め方）。保存した branded があればそれを使う
  function normName(t) { return String(t || '').toLowerCase().replace(/[\s\u3000・･]+/g, ''); }
  function isBranded(r, brand) {
    if (r.branded === true || r.branded === false) return r.branded;
    var b = normName(brand);
    if (!b) return false;
    var p = normName(r.prompt || r.keyword);
    if (p.indexOf(b) >= 0) return true;
    var core = b.replace(/^(株式会社|有限会社|合同会社)|(株式会社|有限会社|合同会社)$/g, '').replace(/(本店|店)$/, '');
    return core.length >= 2 && p.indexOf(core) >= 0;
  }
  /** 質問の種類で絞る：general（一般の質問）・branded（指名の質問）・all */
  function bySegment(rows, seg, brand) {
    if (!seg || seg === 'all') return rows || [];
    return (rows || []).filter(function (r) { return seg === 'branded' ? isBranded(r, brand) : !isBranded(r, brand); });
  }

  /** 1回の試行の結果 */
  function outcome(r, brand) {
    if (r.status === 'error') return 'error';
    if (r.status === 'not_shown') return 'not_shown';
    if (r.mentioned === 1 || r.mentioned === true) {
      if (DENY.test(nearName(r.answer_text || r.answer || r.answer_excerpt || '', brand))) return 'review';
      if (r.same_name_suspect) return 'review';
      return 'mentioned';
    }
    if (r.mentioned === 0 || r.mentioned === false) return 'no_mention';
    return 'error';
  }

  var ERR_LABEL = { rate_limit: '回数の上限', timeout: '時間切れ', network: '通信の失敗', auth: '設定・権限', search_not_run: '検索が実行されなかった', other: 'その他の失敗' };
  function errKind(r) {
    if (r.error_type) return r.error_type;
    var e = String(r.error || '');
    return /rate limit|回数の上限|429/i.test(e) ? 'rate_limit' : /timeout|timed out|aborted|時間/i.test(e) ? 'timeout' : /fetch|network|通信/i.test(e) ? 'network' : 'other';
  }
  /** 1つの AI・1つの条件の集計 */
  function tally(rows, def, opts) {
    opts = opts || {};
    var dd = dedupeObs(rows), superseded = dd.superseded || 0; rows = dd;
    var articles = (opts.articleUrls || []).map(normUrl).filter(Boolean);
    var t = { attempts: rows.length, errors: 0, notShown: 0, mentioned: 0, noMention: 0, review: 0, official: 0, officialJudged: 0, article: 0, bodyUrl: 0, errorKinds: {} };
    rows.forEach(function (r) {
      var o = outcome(r, opts.brand);
      if (o === 'error') { t.errors += 1; var k = errKind(r); t.errorKinds[k] = (t.errorKinds[k] || 0) + 1; return; }
      if (o === 'not_shown') { t.notShown += 1; return; }
      if (o === 'mentioned') t.mentioned += 1; else if (o === 'no_mention') t.noMention += 1; else t.review += 1;
      // 公式サイトの正式な出典は、AI が返した出典の一覧で判定できた回答だけ（本文の URL で埋めない）
      if (r.cited_by_sources === 0 || r.cited_by_sources === 1) { t.officialJudged += 1; if (r.cited_by_sources === 1) t.official += 1; }
      else if (r.cite_source === 'ai_sources' && (r.cited === 0 || r.cited === 1)) { t.officialJudged += 1; if (r.cited === 1) t.official += 1; }
      if (articles.length && (r.citations || []).some(function (u) { return articles.indexOf(normUrl(u)) >= 0; })) t.article += 1;
      if (r.self_url_in_text === 1 || r.self_url_in_text === true) t.bodyUrl += 1;
    });
    t.ok = t.attempts - t.errors;
    t.shown = t.mentioned + t.noMention + t.review;
    t.denominator = def.notShownInDenominator ? t.ok : t.shown;
    t.rate = pct(t.mentioned, t.denominator);
    t.okRate = pct(t.ok, t.attempts);
    t.shownRate = def.notShownInDenominator ? pct(t.shown, t.ok) : null;
    t.officialRate = pct(t.official, t.officialJudged);
    t.small = t.denominator > 0 && t.denominator < 5;
    t.superseded = superseded; // 取り直し・後続の取得で重ねなかった行の数
    var trials = {}; rows.forEach(function (r) { trials[String(r.prompt || '') + '|' + (r.trial || 1)] = 1; });
    t.trials = Object.keys(trials).length;
    return t;
  }

  /**
   * 主表示の集計。rows は計測の回答の行（1回の計測でも、複数回の計測でもよい）。
   *   AI ごとに、条件（conditionKey）でまとめ、いちばん新しい条件の結果を主表示にする。ほかの条件の結果は others に件数だけ残す（混ぜない）
   *   opts: { brand, articleUrls, version }
   */
  function summarize(rows, opts) {
    opts = opts || {};
    rows = bySegment(rows, opts.segment, opts.brand);
    var out = {}, hist = {};
    (rows || []).forEach(function (r) { var e = engineOf(r); if (HISTORY[e]) hist[e] = (hist[e] || 0) + 1; });
    out.history = hist;
    MAIN.forEach(function (def) {
      // 取り直し・後続の取得を、条件でまとめる前に1回にする（失敗の行と取り直しの行で記録した条件が違っても重ねない）
      var all = (rows || []).filter(function (r) { return engineOf(r) === def.key; }), mine = dedupeObs(all), sup = mine.superseded || 0;
      if (!mine.length) { out[def.key] = { def: def, status: 'unmeasured', groups: 0 }; return; }
      var groups = {};
      mine.forEach(function (r) { var k = conditionKey(r, r.query_set_version || opts.version); (groups[k] = groups[k] || []).push(r); });
      var keys = Object.keys(groups).sort(function (a, b) {
        var la = groups[a].reduce(function (m, r) { return r.measured_at > m ? r.measured_at : m; }, ''), lb = groups[b].reduce(function (m, r) { return r.measured_at > m ? r.measured_at : m; }, '');
        return la < lb ? 1 : -1;
      });
      var rs = groups[keys[0]], c = rs[0].conditions || {};
      var tt = tally(rs, def, opts); tt.superseded += sup;
      out[def.key] = { def: def, status: 'measured', t: tt, rows: rs,
        cond: { model: c.model || rs[0].model || '', search: c.search !== false, location: c.location || 'JP', locationUsed: c.location_used || null, version: rs[0].query_set_version || opts.version || '',
          from: rs.reduce(function (m, r) { return !m || r.measured_at < m ? r.measured_at : m; }, ''), to: rs.reduce(function (m, r) { return r.measured_at > m ? r.measured_at : m; }, '') },
        others: keys.length - 1 };
    });
    return out;
  }

  var OUT_LABEL = { mentioned: ['名前あり', 'is-ok'], no_mention: ['回答あり・名前なし', ''], not_shown: ['概要なし', 'is-muted'], error: ['取得失敗', 'is-ng'], review: ['要確認', 'is-warn'] };
  // 画面にはモデル名だけを出す（取得に使う外部サービスの名前は出さない。Google の AI はモデル名を出さない）
  function modelLabel(m) { m = String(m || ''); if (!m || /^serpapi\//i.test(m)) return ''; return m.replace(/^[a-z]+\//, ''); }
  function day(iso) { var t = Date.parse(iso); if (isNaN(t)) return ''; var d = new Date(t + 9 * 3600000); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2); }

  /** 描画（Studio・ダッシュボードで共通）。主表示は AIO。タブで AI モード・ChatGPT に切り替える */
  function render(box, rows, opts) {
    if (!box) return;
    opts = opts || {};
    // 質問の種類：既定は一般の質問（指名の質問は名前が出て当たり前なので、主の数字に混ぜない）。一般が0問ならすべて
    // 質問の種類の回数は、主表示の2つの AI の回答だけで数える（ほかの AI の履歴は入れない）
    var mainRows = (rows || []).filter(function (r) { var e = engineOf(r); return MAIN.some(function (d) { return d.key === e; }); });
    var nGen = bySegment(mainRows, 'general', opts.brand).length, nBr = bySegment(mainRows, 'branded', opts.brand).length;
    var seg = opts.segment || (nGen ? 'general' : 'all');
    opts = Object.assign({}, opts, { segment: seg });
    var S = summarize(rows, opts), cur = opts.current || 'aio';
    var segs = '<div class="ai3-seg" role="group" aria-label="質問の種類">' + [['general', '一般の質問', nGen], ['branded', '指名の質問', nBr], ['all', 'すべて', nGen + nBr]].map(function (x) {
      return '<button type="button" class="ai3-segb' + (x[0] === seg ? ' is-on' : '') + '" aria-pressed="' + (x[0] === seg) + '" data-ai3-seg="' + x[0] + '"' + (x[2] ? '' : ' disabled') + '>' + esc(x[1]) + '<small>' + esc(x[2]) + '回</small></button>';
    }).join('') + '</div>';
    var tabs = '<div class="ai3-tabs" role="tablist" aria-label="2つの AI（AI による概要が主・ChatGPT は補助）">' + MAIN.map(function (d) {
      var s = S[d.key], v = s.status === 'measured' ? (s.t.denominator ? s.t.mentioned + '/' + s.t.denominator : 'N/A') : '未計測';
      return '<button type="button" role="tab" class="ai3-tab' + (d.key === cur ? ' is-on' : '') + '" aria-selected="' + (d.key === cur) + '" data-ai3="' + d.key + '"><b>' + esc(d.short) + '</b><small>' + esc(v) + '</small></button>';
    }).join('') + '</div>';
    var s = S[cur], d = s.def, body;
    if (s.status !== 'measured') body = '<p class="ai3-na">' + esc(d.label) + ' はまだ計測していません（未計測）。</p>';
    else {
      var t = s.t;
      body = '<div class="ai3-main"><div class="ai3-big"><span>' + esc(d.label) + 'で名前が出た回数<small class="ai3-sub">' + esc(d.sub || '') + '</small></span><b>' + (t.denominator ? esc(t.mentioned) + '<small> / ' + esc(t.denominator) + (d.notShownInDenominator ? '回（正常に取れた検索）' : '回（取れた回答）') + '</small>' : 'N/A<small>（分母が0）</small>') + '</b>' +
        '<em>' + (t.rate == null ? '出現率 N/A' : '出現率 ' + esc(t.rate) + '%') + '</em></div>' +
        '<dl class="ai3-status"><div><dt>正常取得</dt><dd>' + esc(t.ok) + ' / ' + esc(t.attempts) + '回</dd></div>' +
        (d.notShownInDenominator ? '<div><dt>概要が出た</dt><dd>' + esc(t.shown) + ' / ' + esc(t.ok) + '回</dd></div><div><dt>概要なし</dt><dd>' + esc(t.notShown) + '回</dd></div>' : (t.notShown ? '<div><dt>回答なし</dt><dd>' + esc(t.notShown) + '回</dd></div>' : '')) +
        '<div><dt>取得失敗</dt><dd>' + esc(t.errors) + '回</dd></div>' + (t.review ? '<div><dt>要確認</dt><dd>' + esc(t.review) + '回（言及に数えない）</dd></div>' : '') + '</dl>' +
        (t.small ? '<p class="ai3-warn">分母が ' + esc(t.denominator) + ' 回と少ないため、出現率は大きく動きます。</p>' : '') +
        (t.errors ? '<p class="ai3-warn">取得失敗 ' + esc(t.errors) + '回は分母に入れていません（0回の成功ではありません）。</p>' : '') +
        (t.superseded ? '<p class="ai3-warn">取り直し・後続の取得の ' + esc(t.superseded) + '件は、同じ観測として1回に数えています（二重に数えていません）。</p>' : '') +
        '<dl class="ai3-cite"><div><dt>公式サイトが正式な出典</dt><dd>' + (t.officialJudged ? esc(t.official) + ' / ' + esc(t.officialJudged) + '回' : 'N/A') + '</dd></div>' +
        (opts.articleUrls && opts.articleUrls.length ? '<div><dt>対象の記事が正式な出典</dt><dd>' + esc(t.article) + '回</dd></div>' : '') +
        '<div><dt>回答の本文に公式サイトの URL</dt><dd>' + esc(t.bodyUrl) + '回</dd></div></dl>' +
        '<p class="ai3-cond">' + esc(seg === 'general' ? '一般の質問（名前を入れていない質問）だけ' : seg === 'branded' ? '指名の質問（名前を入れた質問）だけ' : '一般と指名の質問をすべて') + ' · 条件：' + esc(s.cond.location === 'JP' ? '日本（市区町村の指定なし）' : s.cond.location) + (s.cond.locationUsed ? '（実際の地域：' + esc(s.cond.locationUsed) + '）' : '') +
          (modelLabel(s.cond.model) ? ' · ' + esc(modelLabel(s.cond.model)) : '') + ' · ' + (s.cond.search ? '検索あり' : '検索なし') + (s.cond.version ? ' · 質問の版 ' + esc(s.cond.version) : '') + ' · ' + esc(day(s.cond.from)) + (s.cond.to && s.cond.to !== s.cond.from ? '〜' + esc(day(s.cond.to)) : '') + '</p>' +
        (s.others ? '<p class="ai3-warn">条件の違う計測が ' + esc(s.others) + ' 組あります。混ぜずに、いちばん新しい条件の結果だけを出しています。</p>' : '') + '</div>' +
        '<details class="ai3-ev"><summary>質問ごとの根拠（' + esc(t.attempts) + '回）</summary><div class="ai3-evw"><table><thead><tr><th>質問</th><th>日時</th><th>結果</th><th>出典</th><th>回答</th></tr></thead><tbody>' +
        s.rows.map(function (r) {
          var o = outcome(r, opts.brand), L = OUT_LABEL[o];
          var srcs = (r.citations || []).slice(0, 5).map(function (u) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(normUrl(u).slice(0, 40)) + '</a>'; }).join('<br>');
          var txt = String(r.answer_text || r.answer || r.answer_excerpt || '');
          return '<tr><td>' + esc(r.prompt || '') + '</td><td>' + esc(day(r.measured_at)) + '</td><td><span class="ai3-o ' + L[1] + '">' + esc(L[0]) + '</span>' + (o === 'error' ? '<small>' + esc(ERR_LABEL[errKind(r)] || ERR_LABEL.other) + '</small>' : '') + '</td><td>' + (srcs || '<span class="ai3-mut">—</span>') + '</td><td>' +
            (txt ? '<details><summary>原文を見る</summary><p>' + esc(txt.slice(0, 1500)) + '</p></details>' : '<span class="ai3-mut">—</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div></details>';
    }
    var hk = Object.keys(S.history || {});
    var histH = hk.length ? '<p class="ai3-hist">ほかの AI の記録（' + hk.map(function (k) { return esc(HISTORY[k]) + ' ' + esc(S.history[k]) + '回'; }).join('・') + '）は履歴として残しています。主表示と合算には入れていません。</p>' : '';
    box.innerHTML = '<section class="ai3" aria-label="AI による概要と ChatGPT での名前の出方">' + segs + tabs + body + histH + '<p class="ai3-note">AI による概要と ChatGPT は合算しません。一般の人が使う画面とは結果が違うことがあります。掲載や順位を保証するものではありません。</p></section>';
    Array.prototype.forEach.call(box.querySelectorAll('[data-ai3]'), function (b) { b.addEventListener('click', function () { render(box, rows, Object.assign({}, opts, { current: b.getAttribute('data-ai3') })); }); });
    Array.prototype.forEach.call(box.querySelectorAll('[data-ai3-seg]'), function (b) { b.addEventListener('click', function () { render(box, rows, Object.assign({}, opts, { segment: b.getAttribute('data-ai3-seg') })); }); });
  }

  var api = { MAIN: MAIN, HISTORY: HISTORY, dedupeObs: dedupeObs, normUrl: normUrl, isBranded: isBranded, bySegment: bySegment, engineOf: engineOf, conditionKey: conditionKey, outcome: outcome, tally: tally, summarize: summarize, render: render };
  root.AirReachAI3 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
