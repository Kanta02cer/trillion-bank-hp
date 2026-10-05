/**
 * AirReach 月次レポートの表示と PDF 出力（/airreach/app/report/?id=）。
 * 1ページ目は SOP 08 の「1ページ目に置くもの」（結論3点・主要KPIの前月比較・実施したこと・次の3施策・判断事項）。
 * 2ページ目に詳細（診断の内訳・AI計測・流入・計測条件）。PDF はブラウザの印刷（PDFとして保存）で出す。
 * 読めるかどうかは RLS（社内は下書きも、顧客は公開済みだけ）。
 */
(function () {
  'use strict';

  var root = document.getElementById('arr-root');
  if (!root) return;
  var PROVIDER = { openai: 'ChatGPT（OpenAI）', chatgpt_search: 'ChatGPT（検索あり）', gemini: 'Gemini', claude: 'Claude', perplexity: 'Perplexity', google_aio: 'Google の AI による概要', google_ai_mode: 'Google の AI モード' };
  function prov(p) { return PROVIDER[p] || p; }
  // 前月から直った不足を、お客様向けの肯定の言い方にする（airreach-report.js の PLAIN）
  function resolved(g) { return window.AirReachReport && window.AirReachReport.plainResolved ? window.AirReachReport.plainResolved(g) : g; }

  function day(v) { return window.AirReachReport && window.AirReachReport.jstDay ? window.AirReachReport.jstDay(v) : String(v || '').slice(0, 10); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function v(x, unit) { return x == null || x === '' ? '<span class="arr-na">未計測</span>' : esc(x) + (unit || ''); }
  // lowerIsBetter: 平均掲載順位のように、数字が下がるほど良い指標
  function d(x, unit, lowerIsBetter) {
    if (x == null) return '<span class="arr-na">—</span>';
    var good = lowerIsBetter ? x < 0 : x > 0, bad = lowerIsBetter ? x > 0 : x < 0;
    return '<span class="' + (good ? 'arr-up' : bad ? 'arr-down' : '') + '">' + (x > 0 ? '+' : '') + esc(x) + (unit || '') + '</span>';
  }
  function diff(a, b) { return a == null || b == null ? null : Math.round((Number(a) - Number(b)) * 10) / 10; }
  function ym(s) { var t = String(s || ''); return t.slice(0, 4) + '年' + Number(t.slice(5, 7)) + '月'; }

  // 構造化データの不足（業種で必要な項目がそろっているか）。airreach-schema-gaps.js
  function schemaGapHtml(ld, industry) {
    var G = window.AirReachSchemaGaps;
    if (!G || !ld) return '';
    var r = G.check(ld, industry || 'other', null);
    var ST = { ok: '<span class="arr-ok">あり</span>', on_page_only: '<b class="arr-ng">無い</b>（ページには書いてある）', missing: '<b class="arr-ng">無い</b>' };
    return '<h3 class="arr-h3">構造化データの不足（' + esc(r.industryLabel) + 'で必要な項目）' + tag('judged') + '</h3>' +
      '<p class="arr-sub">必要な項目のうち、そろっているもの ' + esc(r.summary.requiredOk) + ' / ' + esc(r.summary.required) + (r.mainType ? '（判定に使った種類：' + esc(r.mainType) + '）' : '') + '</p>' +
      (r.typeNote ? '<p class="arr-note">' + esc(r.typeNote) + '</p>' : '') +
      '<table class="arr-table"><thead><tr><th>項目</th><th>必要度</th><th>構造化データ</th><th>直し方</th></tr></thead><tbody>' + r.items.map(function (x) {
        return '<tr><td>' + esc(x.label) + ' <small class="arr-na">' + esc(x.key) + '</small></td><td>' + (x.level === 'required' ? '必要' : 'あるとよい') + '</td><td>' + ST[x.status] + (x.schemaValue ? '<br><small class="arr-na">' + esc(x.schemaValue) + '</small>' : '') + '</td><td>' + (x.status === 'ok' ? '—' : esc(x.fix)) + '</td></tr>';
      }).join('') + '</tbody></table><p class="arr-note">' + esc(r.basis) + '「足りない情報」（点数の項目）は構造化データの種類があるか、この表は見つかった構造化データの中に業種で必要な項目がそろっているかを見ています。</p>';
  }
  // 一般質問（店名を含まない）と指名質問（店名を含む）の月の合計
  function typesHtml(ai) {
    var t = ai && ai.types;
    if (!t) return '';
    var row = function (label, x) {
      return '<tr><th>' + label + '</th><td>' + esc(x.answers) + '</td><td>' + (x.citeRate == null ? '<span class="arr-na">—</span>' : esc(x.citeRate) + '%') + ' <small class="arr-na">（' + esc(x.cite) + ' ÷ ' + esc(x.citeJudged) + '）</small></td><td>' + (x.mentionRate == null ? '<span class="arr-na">—</span>' : esc(x.mentionRate) + '%') + ' <small class="arr-na">（' + esc(x.mention) + ' ÷ ' + esc(x.answers) + '）</small></td><td>' +
        ([x.undetermined ? '判定できない ' + x.undetermined : '', x.notShown ? '表示なし ' + x.notShown : '', x.errors ? 'エラー ' + x.errors : ''].filter(Boolean).join('・') || '0') + '</td></tr>';
    };
    return '<h3 class="arr-h3">一般質問・指名質問ごと（すべての AI の合計）</h3><table class="arr-table"><thead><tr><th></th><th>回答の数</th><th>公式サイトが出典</th><th>店名・社名が出た</th><th>割合に入れなかった回答</th></tr></thead><tbody>' +
      row('一般質問<br><small class="arr-na">店名・社名を含まない</small>', t.general) + row('指名質問<br><small class="arr-na">店名・社名を含む</small>', t.branded) + '</tbody></table>';
  }
  // 最新1回の結果（月の合計とは別）
  function latestHtml(ai) {
    var lt = ai && ai.latest;
    if (!lt || ai.basis !== 'monthly' || ai.runs < 2) return '';
    return '<p class="arr-sub">最新の計測（' + esc(lt.measuredOn) + '）だけの結果：' + lt.providers.map(function (p) { return esc(prov(p.provider)) + ' ' + (p.citeRate == null ? '—' : esc(p.citeRate) + '%'); }).join('、') + '</p>';
  }
  // 回答ごとの根拠（質問・AI・計測日時・判定・出典）。印刷では開いた状態で出す
  function answerRecordsHtml(ai) {
    var ev = (ai && ai.evidence) || [];
    if (!ev.length) return '';
    var HOW = { ai_sources: 'AI が返した出典で判定', answer_text: '回答の本文の URL で判定', none: '出典が取れず判定できない', not_measured: '検索しない AI（引用は判定しない）', not_shown: 'AI の回答が表示されなかった', error: 'エラー' };
    var byQ = {}, order = [];
    ev.forEach(function (e) { if (!byQ[e.prompt]) { byQ[e.prompt] = []; order.push(e.prompt); } byQ[e.prompt].push(e); });
    return '<details class="arr-evi"><summary>回答の記録（根拠）を見る（' + esc(ev.length) + '件' + (ai.evidenceTotal > ev.length ? '・新しい順に' + ev.length + '件まで' : '') + '）</summary>' +
      order.map(function (q) {
        return '<div class="arr-evi-q"><h4>' + esc(q) + '</h4><table class="arr-table"><thead><tr><th>計測日時</th><th>AI</th><th>結果</th><th>出典・回答</th></tr></thead><tbody>' + byQ[q].map(function (e) {
          var res = e.status === 'not_shown' ? 'AI の回答なし' : e.status === 'error' ? 'エラー' + (e.error ? '<br><small class="arr-na">' + esc(e.error) + '</small>' : '') :
            (e.mentioned ? '名前あり' : '名前なし') + '・' + (e.cited === 1 ? '出典あり' : e.cited === 0 ? '出典なし' : '判定できない') + '<br><small class="arr-na">' + esc(HOW[e.citeSource] || '') + '</small>';
          var src = (e.citations || []).length ? '<ol class="arr-evi-src">' + e.citations.map(function (u) { return '<li>' + esc(String(u).replace(/^https?:\/\//, '').slice(0, 80)) + '</li>'; }).join('') + '</ol>' :
            ((e.urlsInAnswer || []).length ? '<small class="arr-na">本文の URL：' + esc(e.urlsInAnswer.map(function (u) { return String(u).replace(/^https?:\/\//, ''); }).join('、').slice(0, 160)) + '</small>' : '');
          return '<tr><td>' + esc(e.measuredAt ? (window.AirReachReport ? window.AirReachReport.jstTime(e.measuredAt) : e.measuredAt) : e.measuredOn) + '</td><td>' + esc(prov(e.engine)) + (e.model ? '<br><small class="arr-na">' + esc(e.model) + (e.search ? '・検索あり' : '') + '</small>' : '') + '</td><td>' + res + '</td><td>' + src +
            (e.answer ? '<div class="arr-evi-a">' + esc(e.answer) + (e.answer.length >= 400 ? '…' : '') + '</div>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      }).join('') + '</details>';
  }
  // AI が参照したページ（対象のURLが引用された記録と、参照されたサイトの上位）
  function citedHtml(ai) {
    var tc = (ai && ai.targetCitations) || [], cd = (ai && ai.citedDomains) || [];
    if (!tc.length && !cd.length) return '<p class="arr-note">AIが参照したページの記録はありません（出典の URL を返さない AI、または記録を取り込んでいない計測です）。</p>';
    var provs = [];
    cd.forEach(function (x) { Object.keys(x.counts || {}).forEach(function (k) { if (provs.indexOf(k) < 0) provs.push(k); }); });
    return '<h3 class="arr-h3">AIが参照したページ</h3>' +
      (tc.length ? '<table class="arr-table"><thead><tr><th>質問</th><th>AI</th><th>引用されたページ</th></tr></thead><tbody>' + tc.slice(0, 12).map(function (x) {
        return '<tr><td>' + esc(x.query) + '</td><td>' + esc(prov(x.provider)) + '</td><td class="arr-url"><a href="' + esc(x.url) + '">' + esc(x.url) + '</a></td></tr>';
      }).join('') + '</tbody></table>' + (tc.length > 12 ? '<p class="arr-note">ほか ' + (tc.length - 12) + ' 件</p>' : '') : '<p class="arr-sub">この計測では、対象のページが出典として引用された回答はありませんでした。</p>') +
      (cd.length ? '<p class="arr-sub">AI が出典として参照したサイト（回答の数・上位' + cd.length + '）</p><table class="arr-table"><thead><tr><th>サイト</th>' + provs.map(function (k) { return '<th>' + esc(prov(k)) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        cd.map(function (x) { return '<tr><td class="arr-url">' + esc(x.host) + '</td>' + provs.map(function (k) { return '<td>' + v(x.counts[k] || 0) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>' : '');
  }
  // 数字の出どころ
  function evidenceHtml(c) {
    var R = window.AirReachReport;
    if (!R || !R.evidenceList) return '';
    return '<section><h2 class="arr-h2">数字の出どころ</h2><table class="arr-table arr-ev"><thead><tr><th>数字</th><th>区分</th><th>取得元</th><th>条件</th></tr></thead><tbody>' +
      R.evidenceList(c).map(function (e) { return '<tr><th>' + esc(e.label) + '</th><td>' + (e.kinds || []).map(tag).join(' ') + '</td><td>' + esc(e.source) + '</td><td>' + esc(e.detail || '—') + '</td></tr>'; }).join('') +
      '</tbody></table></section>';
  }

  // 数字・記述の区分。レポートの中で、測ったもの・システムの判定・人が書いたもの・参考・未確認を混ぜない
  var KIND = {
    measured: ['実測値', 'Google Search Console・Google アナリティクス・診断で取得した事実（取得日時・HTTP の結果・見つかった記述）'],
    judged: ['システム判定', 'AirReach が決まった基準で判定した結果（○×・点数）'],
    manual: ['手動入力', '担当者が書いた・入力したもの（結論・施策・ご判断いただきたいこと・手入力の数値）'],
    reference: ['参考値', '条件つきの値（AI の計測は無料枠のモデルで、一般の人が使う ChatGPT・Gemini とは結果が異なることがあります）'],
    unknown: ['未確認', '取得できなかった・計測していないもの（0 ではありません）']
  };
  function tag(k) { var x = KIND[k]; return x ? '<span class="arr-kind is-' + k + '" title="' + esc(x[1]) + '">' + esc(x[0]) + '</span>' : ''; }
  function kindLegend() {
    return '<details class="arr-legend" open><summary>表示の区分</summary><dl>' + Object.keys(KIND).map(function (k) { return '<dt>' + tag(k) + '</dt><dd>' + esc(KIND[k][1]) + '</dd>'; }).join('') + '</dl></details>';
  }
  function trafficKind(t) { return !t ? 'unknown' : (t.source === 'ga4_manual' ? 'manual' : 'measured'); }

  // ---- 診断の根拠（範囲・内訳・項目ごとの結果・構造化データ・AIのロボット）-------------------
  var STATE_JA = { ok: '○', ng: '×', unknown: '—' };
  function siteEvidenceHtml(cur, industry) {
    var R = window.AirReachReport, dt = cur && cur.detail;
    if (!dt) return '<p class="arr-note">この診断には項目ごとの記録がありません。診断し直すと、項目ごとの結果と根拠を表示できます。</p>';
    var sc = dt.scope, bd = dt.breakdown;
    var h = '<h3 class="arr-h3">診断の範囲' + tag('measured') + '</h3><table class="arr-table arr-ev"><tbody>' +
      '<tr><th>診断日時</th><td>' + esc(R.jstTime(sc.diagnosedAt)) + '（日本時間）</td></tr>' +
      '<tr><th>対象URL</th><td class="arr-url">' + esc(sc.topUrl) + '</td></tr>' +
      '<tr><th>点数の対象</th><td>' + esc(sc.scored) + '</td></tr>' +
      '<tr><th>確認したページ数</th><td>' + (sc.pagesRead != null ? esc(sc.pagesRead) + 'ページ（トップページ＋下層ページ ' + esc(sc.pagesRead - 1) + '）' : '<span class="arr-na">記録なし</span>') + '</td></tr>' +
      (sc.subpages && sc.subpages.length ? '<tr><th>確認した下層ページ</th><td><ul class="arr-ul arr-urls">' + sc.subpages.map(function (p) {
        return '<li><span class="arr-url">' + esc(p.url) + '</span>' + (p.role ? '（' + esc(p.role) + '）' : '') + (p.ok ? '' : ' <span class="arr-na">読めず' + (p.status ? '・HTTP ' + esc(p.status) : '') + '</span>') + '</li>';
      }).join('') + '</ul></td></tr>' : '') +
      '</tbody></table><p class="arr-note">' + esc(sc.note) + '</p>';
    if (bd && bd.overall != null) {
      h += '<h3 class="arr-h3">総合点の内訳' + tag('judged') + '</h3><table class="arr-table"><thead><tr><th>分類</th><th>分類の点数</th><th>重み</th><th>総合点への寄与</th></tr></thead><tbody>' +
        bd.rows.map(function (r) { return '<tr><td>' + esc(r.label) + '</td><td>' + v(r.score, '点') + '</td><td>' + (r.share != null ? esc(r.share) + '%' : '<span class="arr-na">対象外</span>') + '</td><td>' + (r.contribution != null ? esc(r.contribution) + '点' : '—') + '</td></tr>'; }).join('') +
        '<tr><th>総合点</th><td></td><td></td><td><b>' + esc(bd.overall) + '点</b>（' + esc(bd.total) + ' を四捨五入）</td></tr></tbody></table>' +
        '<p class="arr-note">総合点＝各分類の点数 × 重み の合計。' + (bd.redistributed ? '判定できなかった分類があるため、残りの分類で重みを配り直しています。' : '重みは ページの骨格30%・会社・お店の情報25%・よくある質問20%・見つけやすさ25%。') + '</p>';
    }
    var groups = ['structure', 'entity', 'faq', 'discover'];
    h += '<h3 class="arr-h3">項目ごとの結果と根拠' + tag('judged') + '</h3><table class="arr-table arr-checks"><thead><tr><th>判定の基準</th><th>結果</th><th>点数</th><th>理由</th></tr></thead><tbody>' +
      groups.map(function (g) {
        var rows = dt.checks.filter(function (c) { return c.factor === g; });
        if (!rows.length) return '';
        var adj = dt.adjustments.filter(function (a) { return a.factor === g; });
        return '<tr class="arr-grp"><th colspan="4">' + esc(rows[0].factorLabel) + '</th></tr>' + rows.map(function (c) {
          return '<tr class="is-' + esc(c.state) + '"><td>' + esc(c.rule || c.label) + '</td><td class="arr-mark">' + (STATE_JA[c.state] || '—') + '</td><td>' + (c.points == null ? '<span class="arr-na">判定なし</span>' : esc(c.points) + '／' + esc(c.max)) + '</td><td>' + (c.state === 'unknown' ? tag('unknown') + ' ' : '') + esc(c.reason) + (c.evidenceUrl ? '<br><small class="arr-url arr-na">根拠：' + esc(c.evidenceUrl) + '</small>' : '') + '</td></tr>';
        }).join('') + adj.map(function (a) { return '<tr class="is-ng"><td>減点：' + esc(a.label) + '</td><td class="arr-mark">−</td><td>' + esc(a.points) + '</td><td>この分類の点数から差し引いています</td></tr>'; }).join('');
      }).join('') + '</tbody></table><p class="arr-note">○＝満たしている／×＝満たしていない／—＝読み取れず判定していない（0点ではなく、計算から外しています）。分類の点数は、判定できた項目の合計 ÷ 満点 × 100。</p>';
    // 構造化データ
    h += '<h3 class="arr-h3">構造化データ（検索やAIが読み取る、お店・会社の情報）' + tag('measured') + '</h3>';
    if (dt.ld && dt.ld.blocks.length) {
      var LAB = { name: '名前', url: 'URL', telephone: '電話', address: '住所', openingHours: '営業時間', openingHoursSpecification: '営業時間', priceRange: '価格帯', servesCuisine: '料理', acceptsReservations: '予約', logo: 'ロゴ', image: '画像', description: '説明', sameAs: '関連リンク', questions: 'よくある質問' };
      h += '<table class="arr-table"><thead><tr><th>種類</th><th>書かれていた主な項目</th></tr></thead><tbody>' + dt.ld.blocks.map(function (b) {
        var ks = Object.keys(b.fields || {});
        return '<tr><td>' + esc((b.types || []).join(' / ')) + '</td><td>' + (ks.length ? ks.map(function (k) { return '<b>' + esc(LAB[k] || k) + '</b>：' + esc(b.fields[k]); }).join('<br>') : '<span class="arr-na">主な項目なし</span>') + '</td></tr>';
      }).join('') + '</tbody></table>' + (dt.ld.errors ? '<p class="arr-note">形式の誤りで読めない記述が ' + esc(dt.ld.errors) + 'か所ありました。</p>' : '');
    } else if (dt.ld) h += '<p class="arr-sub">トップページに構造化データはありませんでした。</p>';
    else h += '<p class="arr-sub">見つかった種類：' + (dt.types.length ? esc(dt.types.join('、')) : 'なし') + '</p>';
    h += schemaGapHtml(dt.ld, industry);
    // AIのロボット
    h += '<h3 class="arr-h3">AIのロボットへの許可（robots.txt）' + tag('measured') + tag('judged') + '</h3>';
    if (dt.robots && dt.robots.bots && dt.robots.bots.length) {
      h += '<table class="arr-table"><thead><tr><th>ロボット</th><th>運営</th><th>判定</th><th>根拠の行</th></tr></thead><tbody>' + dt.robots.bots.map(function (b) {
        return '<tr class="is-' + (b.verdict === 'blocked' ? 'ng' : 'ok') + '"><td>' + esc(b.name) + '</td><td>' + esc(b.org) + '</td><td>' + esc(b.verdictText) + (b.via === 'star' ? '<br><small class="arr-na">全ロボット共通の指定</small>' : '') + '</td><td class="arr-url">' + (b.lines.length ? b.lines.map(esc).join('<br>') : '—') + '</td></tr>';
      }).join('') + '</tbody></table>';
    } else if (dt.robots && dt.robots.state === 'missing') h += '<p class="arr-sub">robots.txt がないため、すべてのロボットに許可している状態です。</p>';
    else h += '<p class="arr-sub"><span class="arr-na">この診断では記録していません。</span></p>';
    h += '<p class="arr-sub">llms.txt：' + esc(dt.llms.text) + '</p>';
    return h;
  }

  function render(r) {
    var c = r.compiled || {};
    var site = c.site || {}, cur = site.current || null, prev = site.previous || null;
    var ai = c.ai || null, tr = c.traffic || {};
    var kpi = [];
    kpi.push('<tr><th>ホームページの情報整備' + tag('judged') + '</th><td>' + v(prev && prev.overall, '点') + '</td><td>' + v(cur && cur.overall, '点') + '</td><td>' + d(site.overallDelta, '点') + '</td></tr>');
    if (ai) ai.providers.forEach(function (p) {
      kpi.push('<tr><th>AIの回答で公式サイトが出典になった割合（' + esc(prov(p.provider)) + '）' + tag('reference') + '</th><td>' + v(p.prevCiteRate, '%') + '</td><td>' + v(p.citeRate, '%') + '</td><td>' + d(p.citeDelta, 'ポイント') + '</td></tr>');
      kpi.push('<tr><th>AIの回答に店名・社名が出た割合（' + esc(prov(p.provider)) + '）' + tag('reference') + '</th><td>' + v(p.prevMentionRate, '%') + '</td><td>' + v(p.mentionRate, '%') + '</td><td>' + d(p.mentionDelta, 'ポイント') + '</td></tr>');
      if (p.sov != null || p.prevSov != null) kpi.push('<tr><th>競合と比べて、AIの回答に名前が出た割合（' + esc(prov(p.provider)) + '）' + tag('reference') + '</th><td>' + v(p.prevSov, '%') + '</td><td>' + v(p.sov, '%') + '</td><td>' + d(p.sovDelta, 'ポイント') + '</td></tr>');
    });
    else kpi.push('<tr><th>AIの引用率・言及率</th><td colspan="3"><span class="arr-na">未計測</span></td></tr>');
    kpi.push('<tr><th>検索からのクリック' + tag(trafficKind(tr.gsc)) + '</th><td>' + v(tr.gscPrev && tr.gscPrev.clicks) + '</td><td>' + v(tr.gsc && tr.gsc.clicks) + '</td><td>' + d(diff(tr.gsc && tr.gsc.clicks, tr.gscPrev && tr.gscPrev.clicks)) + '</td></tr>');
    kpi.push('<tr><th>サイト経由の問い合わせ・予約' + tag(trafficKind(tr.ga4)) + '</th><td>' + v(tr.ga4Prev && tr.ga4Prev.conversions) + '</td><td>' + v(tr.ga4 && tr.ga4.conversions) + '</td><td>' + d(diff(tr.ga4 && tr.ga4.conversions, tr.ga4Prev && tr.ga4Prev.conversions)) + '</td></tr>');

    var concl = (r.conclusions || []);
    var next = (r.next_actions || []);
    var dec = (r.client_decisions || []);
    var acts = c.actions || [];

    var C = window.AirReachCharts;
    root.innerHTML =
      '<div class="arr-tools"><button type="button" class="arr-btn" id="arr-print">PDFで保存（印刷）</button>' +
      (r.status !== 'published' ? '<span class="arr-draft">' + ({ draft: '下書き', in_review: '確認待ち', approved: '承認済み・未公開' }[r.status] || '下書き') + '（お客様には見えません）</span>' : '') + '</div>' +
      '<article class="arr-page">' +
      '<header class="arr-head"><div class="arr-kicker">AirReach 月次レポート</div>' +
      '<h1 class="arr-title">' + esc(c.client ? c.client.name : '') + '　' + esc(ym(r.period_month)) + '</h1>' +
      '<div class="arr-meta">' + (r.published_at ? '公開 ' + esc(day(r.published_at)) : '作成 ' + esc(day(c.generatedAt))) + ' · 株式会社Trillion Bank</div></header>' +
      kindLegend() + '<section><h2 class="arr-h2">今月の数字</h2>' + C.tiles(c) + '</section>' +
      '<section><h2 class="arr-h2">今月の結論' + tag('manual') + '</h2><ol class="arr-ol arr-concl">' + (concl.length ? concl.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') : '<li class="arr-na">（未記入）</li>') + '</ol></section>' +
      '<div class="arr-cols">' +
      '<section><h2 class="arr-h2">今月実施したこと' + tag('manual') + '</h2><ul class="arr-ul">' + (acts.length ? acts.map(function (a) {
        return '<li><span class="arr-date">' + esc(String(a.doneOn || '').slice(5).replace('-', '/')) + '</span>' + esc(a.title) + (a.evidenceUrl ? ' <a href="' + esc(a.evidenceUrl) + '">' + esc(a.evidenceUrl) + '</a>' : '') + '</li>';
      }).join('') : '<li class="arr-na">記録なし</li>') + '</ul></section>' +
      '<section><h2 class="arr-h2">ご判断いただきたいこと' + tag('manual') + '</h2><ul class="arr-ul">' + (dec.length ? dec.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') : '<li class="arr-na">なし</li>') + '</ul></section>' +
      '</div>' +
      '<section><h2 class="arr-h2">次にやる3施策' + tag('manual') + '</h2><table class="arr-table"><thead><tr><th>施策</th><th style="width:22%">担当</th><th style="width:18%">期限</th></tr></thead><tbody>' +
      (next.length ? next.map(function (a) { return '<tr><td>' + esc(a.title) + '</td><td>' + esc(a.owner || '') + '</td><td>' + esc(a.due || '') + '</td></tr>'; }).join('') : '<tr><td colspan="3" class="arr-na">（未記入）</td></tr>') + '</tbody></table></section>' +
      '</article>' +

      '<article class="arr-page arr-break">' +
      (c.first ? '<section><h2 class="arr-h2">初回の計測（基準値）</h2><p class="arr-sub">今回が最初の計測のため、前月との比較と推移はありません。この月の数字を基準にして、次回から変化を示します。</p></section>' :
      '<section><h2 class="arr-h2">推移（直近6か月）</h2>' + C.trends(c) +
      '<p class="arr-note">計測していない月は点を打たず、線もつないでいません（0 ではありません）。</p></section>') +
      '<section><h2 class="arr-h2">ホームページの情報整備の内訳' + tag('judged') + '</h2>' +
      (cur ? '<p class="arr-sub">' + esc(day(cur.createdAt)) + ' に ' + esc(cur.url || '') + ' を診断' + (cur.inMonth ? '' : '<span class="arr-na">（当月の診断が無いため、この日の結果を使用）</span>') + '</p>' +
        C.factors(c) + siteEvidenceHtml(cur, (c.client && c.client.industryId) || '') +
        (c.first ? '' : '<div class="arr-cols"><div><h3 class="arr-h3">前月から直ったこと</h3><ul class="arr-ul arr-ok">' + ((site.resolved || []).map(function (g) { return '<li>' + esc(resolved(g)) + '</li>'; }).join('') || '<li class="arr-na">なし</li>') + '</ul></div>' +
        '<div><h3 class="arr-h3">まだ足りないこと</h3><p class="arr-sub">' + ((cur.gaps || []).length ? (cur.gaps || []).length + '件（直し方は下の「直すこと」）' : 'なし') + '</p></div></div>') +
        (window.AirReachReport && (cur.gaps || []).length ? '<h3 class="arr-h3">直すこと（優先度の高い順）</h3>' + C.todos(window.AirReachReport.todoList(c), { audience: 'client', limit: 3, moreText: '（すべての項目は AirReach の画面で確認できます）' }) : '')
        : '<p class="arr-na">診断の記録がありません。</p>') + '</section>' +
      '<section><h2 class="arr-h2">AI回答の計測' + tag(ai ? 'reference' : 'unknown') + '</h2>' +
      (ai ? '<p class="arr-sub">' + (ai.basis === 'monthly' ? '今月の計測 ' + esc(ai.runs) + '回（' + esc(ai.firstOn) + (ai.runs > 1 ? '〜' + esc(ai.lastOn) : '') + '）の合計' + (ai.excludedOld ? '（判定方法を変える前の計測 ' + esc(ai.excludedOld) + '回は含めていません）' : '') : '計測日 ' + esc(ai.measuredOn)) + '・質問の版 ' + esc((ai.versions && ai.versions.length ? ai.versions : [ai.querySetVersion || '—']).join('、')) + (ai.comparable ? '' : '（前月と条件が異なる、または前月の計測なしのため、差は出していません）') + '</p>' +
        C.aiCompare(c) +
        '<table class="arr-table"><thead><tr><th>AI</th><th>回答の数</th><th>公式サイトが出典になった割合<br><small>出典になった回答 ÷ 判定できた回答</small></th><th>店名・社名が出た割合<br><small>名前が出た回答 ÷ 回答</small></th><th>割合に入れなかった回答</th></tr></thead><tbody>' +
        ai.providers.map(function (p) {
          var nd = function (n, dd) { return n != null && dd ? '<small class="arr-na">（' + esc(n) + ' ÷ ' + esc(dd) + '）</small>' : ''; };
          var aside = [p.undetermined ? '出典が取れず判定できない ' + p.undetermined : '', p.notShown ? 'AI の回答が表示されなかった ' + p.notShown : '', p.errors ? 'エラー ' + p.errors : ''].filter(Boolean).join('<br>');
          return '<tr><td>' + esc(prov(p.provider)) + ' <small class="arr-na">' + esc(p.model) + '</small></td><td>' + v(p.answers) + (p.runs > 1 ? '<small class="arr-na">（' + esc(p.runs) + '回の計測）</small>' : '') + '</td><td>' + v(p.citeRate, '%') + nd(p.citeCount, p.judged) + '</td><td>' + v(p.mentionRate, '%') + nd(p.mentionCount, p.answers) + '</td><td>' + (aside || '0') + '</td></tr>';
        }).join('') +
        '</tbody></table>' +
        typesHtml(ai) +
        latestHtml(ai) +
        '<p class="arr-note">「判定できない」は、AI が出典の一覧を返さず、回答の本文にも URL が無かった回答です（0% として数えません）。「AI の回答が表示されなかった」は、Google の検索結果に AI による概要が出なかった質問です。計測は API で行っており、一般の人が使う最新の ChatGPT・Gemini とは結果が異なることがあります。</p>' +
        citedHtml(ai) + answerRecordsHtml(ai)
        : '<p class="arr-na">今月は計測していません。</p>') + '</section>' +
      '<section' + (c.first ? ' class="arr-first"' : '') + '><h2 class="arr-h2">' + (c.first ? '数値の一覧（初回の基準値）' : '数値の一覧（前月との比較）') + '</h2><table class="arr-table"><thead><tr><th></th><th>' + esc(ym(c.previousMonth)) + '</th><th>' + esc(ym(r.period_month)) + '</th><th>差</th></tr></thead><tbody>' + kpi.join('') +
      '<tr><th>検索の表示回数' + tag(trafficKind(tr.gsc)) + '</th><td>' + v(tr.gscPrev && tr.gscPrev.impressions) + '</td><td>' + v(tr.gsc && tr.gsc.impressions) + '</td><td>' + d(diff(tr.gsc && tr.gsc.impressions, tr.gscPrev && tr.gscPrev.impressions)) + '</td></tr>' +
      '<tr><th>検索結果での平均の順位' + tag(trafficKind(tr.gsc)) + '</th><td>' + v(tr.gscPrev && tr.gscPrev.position) + '</td><td>' + v(tr.gsc && tr.gsc.position) + '</td><td>' + d(diff(tr.gsc && tr.gsc.position, tr.gscPrev && tr.gscPrev.position), '', true) + '</td></tr>' +
      '<tr><th>サイトへの訪問回数' + tag(trafficKind(tr.ga4)) + '</th><td>' + v(tr.ga4Prev && tr.ga4Prev.sessions) + '</td><td>' + v(tr.ga4 && tr.ga4.sessions) + '</td><td>' + d(diff(tr.ga4 && tr.ga4.sessions, tr.ga4Prev && tr.ga4Prev.sessions)) + '</td></tr>' +
      '<tr><th>AIのサービスから来た訪問回数' + tag(trafficKind(tr.ga4)) + '</th><td>' + v(tr.ga4Prev && tr.ga4Prev.ai_sessions) + '</td><td>' + v(tr.ga4 && tr.ga4.ai_sessions) + '</td><td>' + d(diff(tr.ga4 && tr.ga4.ai_sessions, tr.ga4Prev && tr.ga4Prev.ai_sessions)) + '</td></tr>' +
      '</tbody></table><p class="arr-note">順位は数字が小さいほど上位。検索の数字は Google Search Console、訪問・問い合わせは Google アナリティクスの値です。数値は計測・入力された範囲のもので、順位・AIでの掲載・問い合わせ・売上を保証するものではなく、施策と数値の変化の因果関係も断定していません。</p></section>' +
      evidenceHtml(c) +
      ((c.missing || []).length ? '<p class="arr-note">未計測の項目: ' + esc(c.missing.join('、')) + '</p>' : '') +
      '</article>';
    var pb = document.getElementById('arr-print');
    if (pb) pb.addEventListener('click', function () { window.print(); });
    document.title = (c.client ? c.client.name + ' ' : '') + ym(r.period_month) + ' 月次レポート - AirReach';
  }

  function boot() {
    var id = new URLSearchParams(location.search).get('id') || '';
    if (!/^[0-9a-f-]{36}$/.test(id)) { root.innerHTML = '<p>レポートの指定が正しくありません。</p>'; return; }
    fetch('/api/airreach/app-config', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (cfg) {
      if (!cfg.ok) throw new Error('ログインの設定がまだありません');
      var factory = window.AirReachSupabaseFactory || (window.supabase && window.supabase.createClient);
      var sb = factory(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
      return sb.auth.getSession().then(function (s) {
        if (!(s && s.data && s.data.session)) { root.innerHTML = '<p>表示するには <a href="/airreach/app/">ログイン</a> してください。</p>'; return; }
        return sb.from('reports').select('*').eq('id', id).maybeSingle().then(function (res) {
          if (res.error) throw new Error(res.error.message);
          if (!res.data) { root.innerHTML = '<p>このレポートは表示できません（公開前か、閲覧の権限がありません）。</p>'; return; }
          render(res.data);
        });
      });
    }).catch(function (e) { root.innerHTML = '<p>' + esc(e.message) + '</p>'; });
  }
  boot();
  // 印刷（PDF で保存）では、回答の記録を開いた状態で出す
  if (typeof window !== 'undefined') window.addEventListener('beforeprint', function () { document.querySelectorAll('details.arr-evi').forEach(function (d) { d.open = true; }); });
})();
