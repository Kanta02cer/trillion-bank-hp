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
  var PROVIDER = { openai: 'ChatGPT（OpenAI）', gemini: 'Gemini', claude: 'Claude', perplexity: 'Perplexity' };
  function prov(p) { return PROVIDER[p] || p; }

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

  function render(r) {
    var c = r.compiled || {};
    var site = c.site || {}, cur = site.current || null, prev = site.previous || null;
    var ai = c.ai || null, tr = c.traffic || {};
    var kpi = [];
    kpi.push('<tr><th>ホームページの情報整備</th><td>' + v(prev && prev.overall, '点') + '</td><td>' + v(cur && cur.overall, '点') + '</td><td>' + d(site.overallDelta, '点') + '</td></tr>');
    if (ai) ai.providers.forEach(function (p) {
      kpi.push('<tr><th>AIの引用率（' + esc(prov(p.provider)) + '）</th><td>' + v(p.prevCiteRate, '%') + '</td><td>' + v(p.citeRate, '%') + '</td><td>' + d(p.citeDelta, 'pt') + '</td></tr>');
      kpi.push('<tr><th>AIの言及率（' + esc(prov(p.provider)) + '）</th><td>' + v(p.prevMentionRate, '%') + '</td><td>' + v(p.mentionRate, '%') + '</td><td>' + d(p.mentionDelta, 'pt') + '</td></tr>');
    });
    else kpi.push('<tr><th>AIの引用率・言及率</th><td colspan="3"><span class="arr-na">未計測</span></td></tr>');
    kpi.push('<tr><th>検索からのクリック</th><td>' + v(tr.gscPrev && tr.gscPrev.clicks) + '</td><td>' + v(tr.gsc && tr.gsc.clicks) + '</td><td>' + d(diff(tr.gsc && tr.gsc.clicks, tr.gscPrev && tr.gscPrev.clicks)) + '</td></tr>');
    kpi.push('<tr><th>問い合わせ・予約（GA4）</th><td>' + v(tr.ga4Prev && tr.ga4Prev.conversions) + '</td><td>' + v(tr.ga4 && tr.ga4.conversions) + '</td><td>' + d(diff(tr.ga4 && tr.ga4.conversions, tr.ga4Prev && tr.ga4Prev.conversions)) + '</td></tr>');

    var concl = (r.conclusions || []);
    var next = (r.next_actions || []);
    var dec = (r.client_decisions || []);
    var acts = c.actions || [];

    var C = window.AirReachCharts;
    root.innerHTML =
      '<div class="arr-tools"><button type="button" class="arr-btn" id="arr-print">PDFで保存（印刷）</button>' +
      (r.status !== 'published' ? '<span class="arr-draft">下書き（お客様には見えません）</span>' : '') + '</div>' +
      '<article class="arr-page">' +
      '<header class="arr-head"><div class="arr-kicker">AirReach 月次レポート</div>' +
      '<h1 class="arr-title">' + esc(c.client ? c.client.name : '') + '　' + esc(ym(r.period_month)) + '</h1>' +
      '<div class="arr-meta">' + (r.published_at ? '公開 ' + esc(String(r.published_at).slice(0, 10)) : '作成 ' + esc(String(c.generatedAt || '').slice(0, 10))) + ' · 株式会社Trillion Bank</div></header>' +
      '<section><h2 class="arr-h2">今月の数字</h2>' + C.tiles(c) + '</section>' +
      '<section><h2 class="arr-h2">今月の結論</h2><ol class="arr-ol arr-concl">' + (concl.length ? concl.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') : '<li class="arr-na">（未記入）</li>') + '</ol></section>' +
      '<div class="arr-cols">' +
      '<section><h2 class="arr-h2">今月実施したこと</h2><ul class="arr-ul">' + (acts.length ? acts.map(function (a) {
        return '<li><span class="arr-date">' + esc(String(a.doneOn || '').slice(5).replace('-', '/')) + '</span>' + esc(a.title) + (a.evidenceUrl ? ' <a href="' + esc(a.evidenceUrl) + '">' + esc(a.evidenceUrl) + '</a>' : '') + '</li>';
      }).join('') : '<li class="arr-na">記録なし</li>') + '</ul></section>' +
      '<section><h2 class="arr-h2">ご判断いただきたいこと</h2><ul class="arr-ul">' + (dec.length ? dec.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') : '<li class="arr-na">なし</li>') + '</ul></section>' +
      '</div>' +
      '<section><h2 class="arr-h2">次にやる3施策</h2><table class="arr-table"><thead><tr><th>施策</th><th style="width:22%">担当</th><th style="width:18%">期限</th></tr></thead><tbody>' +
      (next.length ? next.map(function (a) { return '<tr><td>' + esc(a.title) + '</td><td>' + esc(a.owner || '') + '</td><td>' + esc(a.due || '') + '</td></tr>'; }).join('') : '<tr><td colspan="3" class="arr-na">（未記入）</td></tr>') + '</tbody></table></section>' +
      '</article>' +

      '<article class="arr-page arr-break">' +
      '<section><h2 class="arr-h2">推移（直近6か月）</h2>' + C.trends(c) +
      '<p class="arr-note">計測していない月は点を打たず、線もつないでいません（0 ではありません）。</p></section>' +
      '<section><h2 class="arr-h2">ホームページの情報整備の内訳</h2>' +
      (cur ? '<p class="arr-sub">' + esc(String(cur.createdAt).slice(0, 10)) + ' に ' + esc(cur.url || '') + ' を診断' + (cur.inMonth ? '' : '<span class="arr-na">（当月の診断が無いため、この日の結果を使用）</span>') + '</p>' +
        C.factors(c) +
        '<div class="arr-cols"><div><h3 class="arr-h3">前月から解消した不足</h3><ul class="arr-ul arr-ok">' + ((site.resolved || []).map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') || '<li class="arr-na">なし</li>') + '</ul></div>' +
        '<div><h3 class="arr-h3">残っている不足</h3><ul class="arr-ul arr-ng">' + ((cur.gaps || []).map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') || '<li class="arr-na">なし</li>') + '</ul></div></div>'
        : '<p class="arr-na">診断の記録がありません。</p>') + '</section>' +
      '<section><h2 class="arr-h2">AI回答の計測</h2>' +
      (ai ? '<p class="arr-sub">計測日 ' + esc(ai.measuredOn) + '・質問の版 ' + esc(ai.querySetVersion || '—') + (ai.comparable ? '' : '（前月と条件が異なる、または前月の計測なしのため、差は出していません）') + '</p>' +
        C.aiCompare(c) +
        '<table class="arr-table"><thead><tr><th>AI</th><th>回答数</th><th>引用率</th><th>言及率</th><th>エラー</th></tr></thead><tbody>' +
        ai.providers.map(function (p) { return '<tr><td>' + esc(prov(p.provider)) + ' <small class="arr-na">' + esc(p.model) + '</small></td><td>' + v(p.answers) + '</td><td>' + v(p.citeRate, '%') + '</td><td>' + v(p.mentionRate, '%') + '</td><td>' + v(p.errors) + '</td></tr>'; }).join('') +
        '</tbody></table><p class="arr-note">引用率＝公式サイトのページが回答の出典に含まれた回答の割合。言及率＝社名・サービス名が回答本文に出た割合。無料枠のモデルで計測しており、一般向けの最新の ChatGPT・Gemini とは結果が異なることがあります。</p>'
        : '<p class="arr-na">今月は計測していません。</p>') + '</section>' +
      '<section><h2 class="arr-h2">数値の一覧（前月との比較）</h2><table class="arr-table"><thead><tr><th></th><th>' + esc(ym(c.previousMonth)) + '</th><th>' + esc(ym(r.period_month)) + '</th><th>差</th></tr></thead><tbody>' + kpi.join('') +
      '<tr><th>検索の表示回数</th><td>' + v(tr.gscPrev && tr.gscPrev.impressions) + '</td><td>' + v(tr.gsc && tr.gsc.impressions) + '</td><td>' + d(diff(tr.gsc && tr.gsc.impressions, tr.gscPrev && tr.gscPrev.impressions)) + '</td></tr>' +
      '<tr><th>平均掲載順位</th><td>' + v(tr.gscPrev && tr.gscPrev.position) + '</td><td>' + v(tr.gsc && tr.gsc.position) + '</td><td>' + d(diff(tr.gsc && tr.gsc.position, tr.gscPrev && tr.gscPrev.position), '', true) + '</td></tr>' +
      '<tr><th>セッション（GA4）</th><td>' + v(tr.ga4Prev && tr.ga4Prev.sessions) + '</td><td>' + v(tr.ga4 && tr.ga4.sessions) + '</td><td>' + d(diff(tr.ga4 && tr.ga4.sessions, tr.ga4Prev && tr.ga4Prev.sessions)) + '</td></tr>' +
      '<tr><th>AI経由のセッション</th><td>' + v(tr.ga4Prev && tr.ga4Prev.ai_sessions) + '</td><td>' + v(tr.ga4 && tr.ga4.ai_sessions) + '</td><td>' + d(diff(tr.ga4 && tr.ga4.ai_sessions, tr.ga4Prev && tr.ga4Prev.ai_sessions)) + '</td></tr>' +
      '</tbody></table><p class="arr-note">平均掲載順位は数字が小さいほど上位です。</p></section>' +
      ((c.missing || []).length ? '<p class="arr-note">未計測の項目: ' + esc(c.missing.join('、')) + '</p>' : '') +
      '<p class="arr-note">本レポートの数値は計測・入力された範囲のものです。検索順位・AIでの掲載・問い合わせ・売上を保証するものではありません。施策と数値の変化の因果関係は断定していません。</p>' +
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
})();
