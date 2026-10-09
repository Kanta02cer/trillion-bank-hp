/**
 * お客様のホーム：お客様が自分で Google（Search Console・Google アナリティクス）とつなぎ、検索と予約の数字を取り込む。
 *   - つながりはこのブラウザだけ（Google のトークンは Cookie。api/google/_lib/token.js）。表示に使うのは、秘密でない Cookie
 *     （airreach_g_<顧客>_s＝許可された機能・_e＝つないだアカウント）だけ
 *   - 取り込みは、計測サーバーが Google から読んだ数字をサーバーが保存する（save: true。画面から数字は送らない。api/google/_lib/save.js）。
 *     保存できるのは、この顧客に登録したサイトと同じ Search Console のサイト・GA4 の対象ホストだけ（DB の airreach_save_google_traffic）
 *   - 担当者の取り込み（ダッシュボードの「検索と訪問の数字を入れる」）はそのまま
 */
(function (root) {
  'use strict';
  var PROPS_KEY = 'airreach_google_props_v1'; // 担当者の画面と同じ（顧客ごとに、選んだサイトをこのブラウザに覚える）
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function gKey(id) { return String(id || '').toLowerCase().replace(/-/g, ''); }
  function cookie(id, kind) { try { return decodeURIComponent((document.cookie.match(new RegExp('(?:^|;\\s*)airreach_g_' + gKey(id) + '_' + kind + '=([^;]*)')) || [])[1] || ''); } catch (e) { return ''; } }
  function props(id) { try { return (JSON.parse(localStorage.getItem(PROPS_KEY) || '{}') || {})[id] || {}; } catch (e) { return {}; } }
  function saveProps(id, v) { try { var all = JSON.parse(localStorage.getItem(PROPS_KEY) || '{}') || {}; all[id] = v; localStorage.setItem(PROPS_KEY, JSON.stringify(all)); } catch (e) {} }
  function hostOf(u) { try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } }
  /** Search Console で、この顧客のサイトと同じとみなす形（DB の判定と同じ） */
  function gscCandidates(host) { return host ? ['sc-domain:' + host, 'https://' + host + '/', 'https://www.' + host + '/', 'http://' + host + '/', 'http://www.' + host + '/'] : []; }
  function jstDay(d) { return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10); }
  /** 取り込む月：先月（全部）と今月（昨日まで。今日が1日なら今月は無し） */
  function months(now) {
    now = now || new Date();
    var today = jstDay(now), y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    var yest = jstDay(new Date(now.getTime() - 86400000));
    var pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var pStart = py + '-' + pad(pm) + '-01', pEnd = new Date(Date.UTC(py, pm, 0)).toISOString().slice(0, 10);
    var out = [{ label: py + '年' + pm + '月', start: pStart, end: pEnd }];
    var cStart = y + '-' + pad(m) + '-01';
    if (yest >= cStart) out.push({ label: y + '年' + m + '月', start: cStart, end: yest, partial: true });
    return out;
  }
  var TROUBLE = '<details class="agc-trouble"><summary>うまくいかないとき</summary><dl>' +
    '<dt>お店のサイトが一覧に出てこない</dt><dd>つないだアカウントが、そのサイトの Search Console に登録されていません。サイトを作った会社やご担当に、このアカウントを Search Console の「設定 → ユーザーと権限」に追加してもらうか、登録しているアカウントでつなぎ直してください。</dd>' +
    '<dt>Google アナリティクスが選べない</dt><dd>このアカウントに GA4 を見る権限がないか、GA4 を使っていません。検索の数字だけでも取り込めます（予約・問い合わせは「未計測」のままです）。</dd>' +
    '<dt>許可のチェックを外してしまった</dt><dd>外した方の数字は取り込めません。もう一度つなぎ、2つとも許可してください。</dd>' +
    '<dt>「つながりが切れました」と出た</dt><dd>Google 側で許可を取り消した・パスワードを変えた・しばらく使っていない、などで切れることがあります。もう一度つなげば続きから取り込めます。</dd>' +
    '<dt>Google の画面で「このアプリは確認されていません」と出た</dt><dd>進まずに、担当者へご連絡ください。</dd>' +
    '<dt>自分でつながなくてもよい</dt><dd>Search Console と GA4 で、担当者のアカウントに閲覧の権限を付けていただければ、担当者が取り込みます。</dd></dl></details>';

  /**
   * box に描く。o: { sb, client: { id, name }, sites: [{ url, host }], ret: '?google= の値', onMsg(text, kind) }
   */
  function mount(box, o) {
    if (!box || !o || !o.client) return;
    var cid = o.client.id, site = (o.sites || [])[0] || null, host = site ? (site.host || hostOf(site.url)) : '';
    function say(t, k) { if (o.onMsg) o.onMsg(t, k); }
    function headers(extra) {
      var h = Object.assign({}, extra || {});
      return o.sb.auth.getSession().then(function (r) { var tk = r && r.data && r.data.session && r.data.session.access_token; if (tk) h.Authorization = 'Bearer ' + tk; return h; }, function () { return h; });
    }
    function getJson(path) { return headers().then(function (h) { return fetch(path, { credentials: 'same-origin', headers: h }); }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw Object.assign(new Error(j.error || ('HTTP ' + r.status)), { status: r.status, code: j.code }); return j; }); }); }
    function post(path, body) { return headers({ 'Content-Type': 'application/json' }).then(function (h) { return fetch(path, { method: 'POST', credentials: 'same-origin', headers: h, body: JSON.stringify(body) }); }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || j.error || ('HTTP ' + r.status)), { status: r.status, code: j.code }); return j; }); }); }

    var feats = cookie(cid, 's').split('.').filter(Boolean), email = cookie(cid, 'e'), p = props(cid);
    var ret = o.ret || '';
    // この顧客の取り込んだ数字（お客様も読める）
    o.sb.from('traffic_snapshots').select('period_month,source,metrics,created_at').eq('client_id', cid).in('source', ['gsc_api', 'ga4_api']).order('period_month', { ascending: false }).limit(12)
      .then(function (r) { return r.error ? [] : (r.data || []); }, function () { return []; }).then(function (snaps) {
        if (!feats.length) drawStart(snaps);
        else if (ret === 'connected' || ret === 'ga4_missing' || !(p.gsc || p.ga4)) drawSelect();
        else drawConnected(snaps);
      });

    // ---- まだつないでいない ----
    function drawStart() {
      var RET = { gsc_missing: 'Search Console の閲覧が許可されませんでした。もう一度つなぎ、Search Console にチェックを入れてください。', scope_missing: '閲覧の許可がありませんでした。もう一度つなぎ、2つともチェックを入れてください。', denied: 'Google の画面で許可されませんでした。' };
      box.innerHTML = '<section class="arc-card agc agc-start" aria-labelledby="agc-h">' +
        (RET[ret] ? '<p class="agc-msg is-warn" role="status">' + esc(RET[ret]) + '</p>' : '') +
        '<div class="agc-row"><div class="agc-main"><span class="agc-chip is-wait">まだつないでいません</span>' +
        '<h2 class="arc-h2" id="agc-h">Google とつなぐと、検索と予約の数字も毎月のレポートに入ります</h2>' +
        '<p>お店のサイトが Google 検索で何回表示され、何回クリックされたか（Search Console）と、サイトからの予約・問い合わせの数（Google アナリティクス）を、AirReach が読み取ります。</p>' +
        '<ul><li>読み取るだけです。サイトや Google の設定を変えることはありません</li><li>つなぐのは、お店のサイトを Search Console・Google アナリティクスで見られる Google アカウントです</li><li>いつでも、この画面から切断できます</li></ul></div>' +
        '<div class="agc-side"><button type="button" class="arc-btn agc-big" data-agc-open aria-expanded="false" aria-controls="agc-steps">Google とつなぐ</button><small>約2分。担当者が代わりにつなぐこともできます</small></div></div>' +
        '<div id="agc-steps" class="agc-steps" hidden>' +
        '<ol><li><b>Google のアカウントを選ぶ</b><span>お店のサイトを Search Console と Google アナリティクスで見ているアカウントを選びます。</span></li>' +
        '<li><b>Google の画面で、読み取りを許可する</b><span>「Search Console のデータの表示」「Google アナリティクスのデータの表示」の2つです。書き換えの許可は求めません。</span></li>' +
        '<li><b>AirReach に戻って、お店のサイトを選ぶ</b><span>' + (host ? 'お店のサイト（' + esc(host) + '）を選びます。' : 'お店のサイトを選びます。') + '</span></li></ol>' +
        '<div class="agc-grid"><div><b>AirReach が読み取るもの</b><ul><li>Google 検索での表示回数・クリック数</li><li>サイトの訪問数と、予約・問い合わせの数</li><li>つないだアカウントのメールアドレス（どのアカウントか表示するため）</li></ul></div>' +
        '<div><b>しないこと</b><ul><li>サイトや Google の設定の変更</li><li>検索された言葉を、AI に聞く質問づくりに使うこと</li><li>ご契約が終わったあと、90日を超えて数字を持っておくこと</li></ul></div></div>' +
        '<label class="agc-consent"><input type="checkbox" id="agc-consent"> <span>AirReach の担当者が、分析・月次レポートの作成・サポートのために必要な範囲で、この接続で取得する Google のデータ（Search Console・Google アナリティクス）を閲覧することに同意します。</span></label>' +
        (!host ? '<p class="agc-msg is-warn">お店のサイトがまだ登録されていません。担当者にご連絡ください。</p>' : '') +
        '<div class="agc-actions"><button type="button" class="arc-btn agc-big" data-agc-go' + (host ? '' : ' disabled') + '>Google の画面へ進む</button><button type="button" class="arc-btn-sm" data-agc-close>今はやめておく</button></div>' +
        '<p class="agc-note">Google の画面で「このアプリは確認されていません」と出た場合は、進まずに担当者へご連絡ください。</p></div>' + TROUBLE + '</section>';
      var open = box.querySelector('[data-agc-open]'), steps = box.querySelector('#agc-steps');
      open.addEventListener('click', function () { steps.hidden = false; open.setAttribute('aria-expanded', 'true'); var c = box.querySelector('#agc-consent'); if (c) c.focus(); });
      box.querySelector('[data-agc-close]').addEventListener('click', function () { steps.hidden = true; open.setAttribute('aria-expanded', 'false'); open.focus(); });
      box.querySelector('[data-agc-go]').addEventListener('click', function (e) {
        var b = e.currentTarget;
        if (!box.querySelector('#agc-consent').checked) { say('つなぐ前に、同意のチェックを入れてください。', 'error'); box.querySelector('#agc-consent').focus(); return; }
        b.disabled = true;
        post('/api/google/auth/', { consent: true, back: 'app', client: cid }).then(function (j) {
          if (!j || !/^https:\/\/accounts\.google\.com\//.test(String(j.url || ''))) throw new Error('Google の画面を開けませんでした');
          root.location.href = j.url;
        }).catch(function (err) { b.disabled = false; say(err.message || String(err), 'error'); });
      });
    }

    // ---- Google から戻ったあと：サイトを選ぶ ----
    function drawSelect() {
      var hasGsc = feats.indexOf('gsc') >= 0, hasGa4 = feats.indexOf('ga4') >= 0;
      box.innerHTML = '<section class="arc-card agc"><p class="agc-msg is-ok">Google とつながりました' + (email ? '（アカウント：' + esc(email) + '）' : '') + '</p><p class="agc-note">サイトの一覧を読み込んでいます…</p></section>';
      Promise.all([
        hasGsc ? getJson('/api/google/gsc/?client=' + encodeURIComponent(cid)).then(function (j) { return j.sites || []; }, function () { return null; }) : Promise.resolve(null),
        hasGa4 ? getJson('/api/google/ga4/?client=' + encodeURIComponent(cid)).then(function (j) { return j.properties || []; }, function () { return null; }) : Promise.resolve(null)
      ]).then(function (rs) {
        var gscList = rs[0], gaList = rs[1], cands = gscCandidates(host);
        var mineGa = function (pp) { return !!host && (pp.uris || []).some(function (u) { return hostOf(u) === host; }); };
        var gscPick = gscList ? ((gscList.filter(function (x) { return x.siteUrl === p.gsc && cands.indexOf(x.siteUrl) >= 0; })[0] || gscList.filter(function (x) { return cands.indexOf(x.siteUrl) >= 0; })[0] || {}).siteUrl || '') : '';
        var gaPick = gaList ? ((gaList.filter(function (x) { return x.id === p.ga4; })[0] || gaList.filter(mineGa)[0] || {}).id || '') : '';
        var gscH = !hasGsc ? '<p class="agc-msg is-warn">Search Console の読み取りが許可されていません。もう一度つなぎ、チェックを入れてください。</p>'
          : gscList == null ? '<p class="agc-msg is-warn">Search Console の一覧を読めませんでした。少し待ってから開き直してください。</p>'
          : (gscList.length ? gscList.map(function (x) {
              var ok = cands.indexOf(x.siteUrl) >= 0;
              return '<label class="agc-opt' + (ok ? '' : ' is-off') + '"><input type="radio" name="agc-gsc" value="' + esc(x.siteUrl) + '"' + (x.siteUrl === gscPick ? ' checked' : '') + (ok ? '' : ' disabled') + '><span>' + esc(x.siteUrl) + (ok ? '' : '<small>（登録のサイトと違うため選べません）</small>') + '</span>' + (ok ? '<em>登録のサイトと同じ</em>' : '') + '</label>';
            }).join('') : '') + (gscPick ? '' : '<p class="agc-msg is-warn">このアカウントで見られる Search Console に、お店のサイト（' + esc(host) + '）がありません。下の「うまくいかないとき」をご覧ください。</p>');
        var gaH = !hasGa4 ? '<p class="agc-note">Google アナリティクスの読み取りは許可されていません（検索の数字だけ取り込みます）。</p>'
          : gaList == null ? '<p class="agc-note">Google アナリティクスの一覧を読めませんでした（検索の数字だけ取り込めます）。</p>'
          : gaList.map(function (x) { return '<label class="agc-opt"><input type="radio" name="agc-ga" value="' + esc(x.id) + '"' + (x.id === gaPick ? ' checked' : '') + '><span>' + esc(x.name || x.id) + '<small>（プロパティ ' + esc(x.id) + '）</small></span>' + (mineGa(x) ? '<em>お店のサイト</em>' : '') + '</label>'; }).join('') +
            '<label class="agc-opt"><input type="radio" name="agc-ga" value=""' + (gaPick ? '' : ' checked') + '><span>使っていない・あとで選ぶ</span></label>' +
            '<p class="agc-note">予約・問い合わせの数は、Google アナリティクスで「キーイベント」に設定したものを数えます。お店のサイト（' + esc(host) + '）の分だけを数えます。</p>';
        box.innerHTML = '<section class="arc-card agc" aria-labelledby="agc-sel-h"><p class="agc-msg is-ok" role="status">Google とつながりました' + (email ? '（アカウント：' + esc(email) + '）' : '') + '</p>' +
          '<h2 class="arc-h2" id="agc-sel-h">お店のサイトを選んでください</h2><p class="agc-note">このアカウントで見られるものだけが並びます。登録しているサイト（' + esc(host) + '）と同じものに印を付けています。</p>' +
          '<fieldset class="agc-set"><legend>検索の数字（Search Console）</legend>' + gscH + '</fieldset>' +
          '<fieldset class="agc-set"><legend>訪問と予約・問い合わせの数字（Google アナリティクス）</legend>' + gaH + '</fieldset>' +
          '<p class="agc-note">取り込む期間：' + months().map(function (m) { return esc(m.label) + (m.partial ? '（途中まで）' : ''); }).join('・') + '</p>' +
          '<div class="agc-actions"><button type="button" class="arc-btn agc-big" data-agc-import>このサイトで取り込む</button><button type="button" class="arc-btn-sm" data-agc-other>別のアカウントでつなぎ直す</button></div>' + TROUBLE + '</section>';
        box.querySelector('[data-agc-import]').addEventListener('click', function (e) {
          var g = (box.querySelector('input[name="agc-gsc"]:checked') || {}).value || '', a = (box.querySelector('input[name="agc-ga"]:checked') || {}).value || '';
          if (!g && !a) { say('取り込むサイトを選んでください。', 'error'); return; }
          saveProps(cid, { gsc: g, ga4: a });
          runImport(e.currentTarget, g, a);
        });
        box.querySelector('[data-agc-other]').addEventListener('click', disconnectThenStart);
      });
    }

    // ---- 取り込む（サーバーが Google から読み、サーバーが保存する） ----
    function runImport(btn, gsc, ga4) {
      if (btn) { btn.disabled = true; btn.textContent = '取り込んでいます…'; }
      var jobs = [], done = [], errs = [];
      months().forEach(function (m) {
        if (gsc) jobs.push(post('/api/google/gsc/', { clientId: cid, siteUrl: gsc, startDate: m.start, endDate: m.end, totalsOnly: true, save: true }).then(function () { done.push(m.label + ' の検索'); }, function (e) { errs.push(m.label + ' の検索：' + (e.message || e)); }));
        if (ga4) jobs.push(post('/api/google/ga4/', { clientId: cid, propertyId: ga4, siteUrl: site.url, startDate: m.start, endDate: m.end, summaryOnly: true, save: true }).then(function () { done.push(m.label + ' の訪問・予約'); }, function (e) { errs.push(m.label + ' の訪問・予約：' + (e.message || e)); }));
      });
      return Promise.all(jobs).then(function () {
        if (errs.length) say((done.length ? '取り込みました：' + done.join('・') + '。' : '') + '取り込めなかったもの：' + errs.join(' ／ '), 'error');
        else say('取り込みました：' + done.join('・'), 'ok');
        ret = ''; p = props(cid);
        mount(box, Object.assign({}, o, { ret: '' }));
      });
    }
    function disconnectThenStart() {
      fetch('/api/google/auth/?disconnect=1&client=' + encodeURIComponent(cid), { method: 'POST', credentials: 'same-origin' }).catch(function () {}).then(function () {
        feats = []; email = '';
        mount(box, Object.assign({}, o, { ret: '' }));
      });
    }

    // ---- つないだあと ----
    function drawConnected(snaps) {
      var byM = {}; (snaps || []).forEach(function (s) { (byM[s.period_month] = byM[s.period_month] || {})[s.source] = s; });
      var ms = Object.keys(byM).sort().reverse().slice(0, 2);
      var last = (snaps || []).map(function (s) { return (s.metrics && s.metrics.fetched_at) || s.created_at; }).filter(Boolean).sort().pop();
      var dt = function (iso) { var t = Date.parse(iso); if (isNaN(t)) return ''; var d = new Date(t + 9 * 3600000); return d.getUTCFullYear() + '/' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2); };
      var cell = function (s, k, unit) { return s && s.metrics && s.metrics[k] != null ? '<b>' + esc(s.metrics[k]) + '</b><small> ' + unit + '</small>' : '<span class="agc-na">未計測</span>'; };
      var rows = ms.map(function (m) {
        var g = byM[m].gsc_api, a = byM[m].ga4_api, part = (g && g.metrics && g.metrics.end_date && g.metrics.end_date.slice(0, 7) + '-01' === m && Number(g.metrics.end_date.slice(8)) < 28) ? '（' + esc(g.metrics.start_date.slice(5).replace('-', '/')) + '〜' + esc(g.metrics.end_date.slice(5).replace('-', '/')) + '・途中まで）' : '';
        return '<tr><th scope="row">' + esc(Number(m.slice(0, 4))) + '年' + esc(Number(m.slice(5, 7))) + '月' + part + '</th><td>' + cell(g, 'clicks', '回') + '</td><td>' + cell(a, 'conversions', '件') + '</td></tr>';
      }).join('');
      box.innerHTML = '<section class="arc-card agc" aria-labelledby="agc-c-h"><div class="agc-head"><h2 class="arc-h2" id="agc-c-h">Google とのつながり</h2><span class="agc-chip is-ok">つないでいます</span></div>' +
        '<dl class="agc-dl"><dt>アカウント</dt><dd>' + esc(email || '（表示できません）') + '</dd><dt>検索の数字</dt><dd>' + esc(p.gsc || '選んでいません') + '</dd><dt>訪問・予約の数字</dt><dd>' + esc(p.ga4 ? 'GA4 プロパティ ' + p.ga4 : '選んでいません') + '</dd><dt>最後に取り込んだ日時</dt><dd>' + esc(last ? dt(last) : 'まだ取り込んでいません') + '</dd></dl>' +
        (rows ? '<div class="arc-table-wrap"><table class="arc-table agc-table"><thead><tr><th>月</th><th>検索からのクリック</th><th>予約・問い合わせ</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '') +
        '<div class="agc-actions"><button type="button" class="arc-btn agc-big" data-agc-reimport>今の数字を取り込み直す</button><button type="button" class="arc-btn-sm" data-agc-change>選んだサイトを変える</button><button type="button" class="arc-btn-sm agc-danger" data-agc-disconnect>切断する</button></div>' +
        '<p class="agc-note">このブラウザで Google とつないでいます。別のパソコンやスマホで取り込むときは、そこでもう一度つなぎます。毎月のレポートの前に、担当者が取り込みをお願いすることがあります。</p>' +
        '<p class="agc-note"><b>取り込んだ数字の扱い：</b>月次レポートの「検索からのクリック」「予約・問い合わせ」に使います。切断すると、これからの取り込みは止まります（取り込み済みの数字の削除はご依頼ください）。ご契約が終わったら、90日以内に削除します。</p>' + TROUBLE + '</section>';
      box.querySelector('[data-agc-reimport]').addEventListener('click', function (e) { runImport(e.currentTarget, p.gsc, p.ga4); });
      box.querySelector('[data-agc-change]').addEventListener('click', drawSelect);
      var dc = box.querySelector('[data-agc-disconnect]');
      dc.addEventListener('click', function () {
        // 押し間違いを防ぐ：1回目で確認の文言に変え、もう一度押したら切断
        if (dc.getAttribute('data-armed') !== '1') { dc.setAttribute('data-armed', '1'); dc.textContent = 'もう一度押すと切断します'; return; }
        dc.disabled = true;
        fetch('/api/google/auth/?disconnect=1&client=' + encodeURIComponent(cid), { method: 'POST', credentials: 'same-origin' }).then(function () {
          say('Google とのつながりを切りました。取り込み済みの数字は残っています（削除はご依頼ください）。', 'ok');
          feats = []; email = '';
          mount(box, Object.assign({}, o, { ret: '' }));
        }).catch(function () { dc.disabled = false; say('切断できませんでした。少し待ってからもう一度押してください。', 'error'); });
      });
    }
  }

  var api = { mount: mount, months: months, gscCandidates: gscCandidates };
  root.AirReachGoogleCustomer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
