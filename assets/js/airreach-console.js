/**
 * AirReach 管理画面（/airreach/app/）— ログイン・顧客管理・月次レポート。
 *
 * - ログインは Supabase Auth のメールリンク。ブラウザは authenticated ロールで Supabase を直接読む。
 *   見てよい行・書いてよい行は DB の RLS で決まる（migration 20260930120000）。この画面の表示制御は補助。
 * - 社内（staff）: 全顧客の材料を登録し、月次レポートの下書きを作って公開する。
 * - 顧客（member）: 自社の公開済みレポートを見る。
 * - レポートの組み立ては assets/js/airreach-report.js（純粋関数）。
 */
(function () {
  'use strict';

  var root = document.getElementById('arc-root');
  if (!root) return;
  var sb = null;       // Supabase client
  var me = null;       // { email, is_staff, is_admin, client_ids }
  var INDUSTRY = { restaurant: '飲食店', clinic: '美容・クリニック', b2b: '会社向けサービス', media: 'メディア・広報', other: 'その他' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function $(sel, el) { return (el || root).querySelector(sel); }
  function msg(text, kind) {
    var el = document.getElementById('arc-msg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'arc-msg' + (kind ? ' is-' + kind : '');
    el.hidden = !text;
  }
  function fail(e) { msg((e && e.message) || String(e), 'error'); }
  function ym(d) { return String(d || '').slice(0, 7); }
  function thisMonth() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function hostOf(u) {
    try { return new URL(/^https?:\/\//.test(u) ? u : 'https://' + u).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; }
  }
  function q(res) { if (res.error) throw new Error(res.error.message || String(res.error)); return res.data; }
  function readFile(input) {
    return new Promise(function (resolve, reject) {
      var f = input.files && input.files[0];
      if (!f) { reject(new Error('ファイルを選んでください')); return; }
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = function () { reject(new Error('ファイルを読めませんでした')); };
      r.readAsText(f);
    });
  }

  // ---- 起動・ログイン --------------------------------------------------------
  function boot() {
    fetch('/api/airreach/app-config', { credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        if (res.status !== 200 || !res.body.ok) throw new Error('ログインの設定がまだありません（管理者に連絡してください）');
        var factory = window.AirReachSupabaseFactory || (window.supabase && window.supabase.createClient);
        if (!factory) throw new Error('ログインの部品を読み込めませんでした');
        sb = factory(res.body.supabaseUrl, res.body.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
        sb.auth.onAuthStateChange(function () { route(); });
        return route();
      })
      .catch(function (e) { root.innerHTML = '<div class="arc-card"><p>' + esc(e.message) + '</p></div>'; });
  }

  function renderLogin() {
    root.innerHTML =
      '<div class="arc-card arc-login">' +
      '<h1 class="arc-h1">AirReach ログイン</h1>' +
      '<p class="arc-lead">登録されたメールアドレスを入力してください。ログイン用のリンクをお送りします。</p>' +
      '<form id="arc-login-form"><label class="arc-label" for="arc-email">メールアドレス</label>' +
      '<input id="arc-email" class="arc-input" type="email" autocomplete="email" required>' +
      '<button class="arc-btn" type="submit">ログインリンクを送る</button></form>' +
      '<p id="arc-msg" class="arc-msg" hidden aria-live="polite"></p></div>';
    $('#arc-login-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('#arc-email').value.trim().toLowerCase();
      if (!email) return;
      msg('送信しています…');
      sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + '/airreach/app/' } }).then(function (res) {
        if (res.error) throw res.error;
        msg('メールを送りました。届いたリンクを、このブラウザで開いてください。', 'ok');
      }).catch(fail);
    });
  }

  function shell(title, bodyHtml, back) {
    root.innerHTML =
      '<div class="arc-top"><div>' + (back ? '<a class="arc-back" href="' + back + '">← 戻る</a>' : '') +
      '<h1 class="arc-h1">' + esc(title) + '</h1></div>' +
      '<div class="arc-who">' + esc(me.email) + (me.is_staff ? ' · 社内' : '') +
      ' <button type="button" class="arc-btn-sm" id="arc-logout">ログアウト</button></div></div>' +
      '<p id="arc-msg" class="arc-msg" hidden aria-live="polite"></p>' + bodyHtml;
    $('#arc-logout').addEventListener('click', function () { sb.auth.signOut().then(function () { location.hash = ''; route(); }); });
  }

  function route() {
    return sb.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      if (!session) { renderLogin(); return; }
      return sb.rpc('airreach_me').then(function (r) {
        me = q(r) || {};
        var h = location.hash || '';
        var m;
        if ((m = /^#\/c\/([0-9a-f-]{36})$/.exec(h))) return me.is_staff ? clientStaff(m[1]) : clientMember(m[1]);
        if ((m = /^#\/r\/([0-9a-f-]{36})$/.exec(h)) && me.is_staff) return reportEditor(m[1]);
        return clientList();
      });
    }).catch(fail);
  }
  window.addEventListener('hashchange', function () { if (sb) route(); });

  // ---- 顧客一覧 --------------------------------------------------------------
  function clientList() {
    return sb.from('clients').select('id,name,industry_id,status').order('name').then(function (r) {
      var rows = q(r) || [];
      var list = rows.length ? rows.map(function (c) {
        return '<li><a href="#/c/' + c.id + '">' + esc(c.name) + '</a><span class="arc-sub">' + esc(INDUSTRY[c.industry_id] || '') + (c.status !== 'active' ? ' · ' + esc(c.status) : '') + '</span></li>';
      }).join('') : '<li class="arc-empty">' + (me.is_staff ? 'まだ顧客がありません。' : '閲覧できる顧客がありません。担当者にお問い合わせください。') + '</li>';
      var add = me.is_staff ?
        '<form id="arc-add-client" class="arc-row"><input class="arc-input" id="arc-client-name" placeholder="顧客名（会社・店舗）" required>' +
        '<select class="arc-input" id="arc-client-ind">' + Object.keys(INDUSTRY).map(function (k) { return '<option value="' + k + '">' + INDUSTRY[k] + '</option>'; }).join('') + '</select>' +
        '<button class="arc-btn" type="submit">顧客を追加</button></form>' : '';
      shell(me.is_staff ? '顧客' : 'レポート', '<section class="arc-card"><ul class="arc-list">' + list + '</ul>' + add + '</section>');
      if (me.is_staff) $('#arc-add-client').addEventListener('submit', function (e) {
        e.preventDefault();
        sb.from('clients').insert({ name: $('#arc-client-name').value.trim(), industry_id: $('#arc-client-ind').value, created_by: me.email })
          .then(function (res) { q(res); return clientList(); }).catch(fail);
      });
    });
  }

  // ---- 顧客（メンバー向け）: 公開済みレポートの一覧 ----------------------------
  function clientMember(id) {
    return Promise.all([
      sb.from('clients').select('id,name').eq('id', id).maybeSingle(),
      sb.from('reports').select('id,period_month,published_at').eq('client_id', id).eq('status', 'published').order('period_month', { ascending: false })
    ]).then(function (rs) {
      var c = q(rs[0]); var reps = q(rs[1]) || [];
      if (!c) throw new Error('この顧客は表示できません');
      shell(c.name, '<section class="arc-card"><h2 class="arc-h2">月次レポート</h2><ul class="arc-list">' +
        (reps.length ? reps.map(function (r) { return '<li><a href="/airreach/app/report/?id=' + r.id + '">' + esc(ym(r.period_month)) + ' のレポート</a></li>'; }).join('') : '<li class="arc-empty">公開済みのレポートはまだありません。</li>') +
        '</ul></section>', '#/');
    });
  }

  // ---- 顧客（社内向け）: 材料の登録とレポート作成 ------------------------------
  function clientStaff(id) {
    return Promise.all([
      sb.from('clients').select('*').eq('id', id).maybeSingle(),
      sb.from('client_sites').select('*').eq('client_id', id).order('created_at'),
      sb.from('client_members').select('*').eq('client_id', id).order('email'),
      sb.from('measurement_runs').select('id,measured_on,run_label,query_set_version,summary').eq('client_id', id).order('measured_on', { ascending: false }),
      sb.from('traffic_snapshots').select('*').eq('client_id', id).order('period_month', { ascending: false }),
      sb.from('action_items').select('*').eq('client_id', id).order('done_on', { ascending: false }),
      sb.from('reports').select('id,period_month,status,published_at,updated_at').eq('client_id', id).order('period_month', { ascending: false }),
      sb.rpc('airreach_client_scans', { p_client_id: id })
    ]).then(function (rs) {
      var c = q(rs[0]); if (!c) throw new Error('顧客が見つかりません');
      var sites = q(rs[1]) || [], members = q(rs[2]) || [], runs = q(rs[3]) || [], traffic = q(rs[4]) || [], actions = q(rs[5]) || [], reports = q(rs[6]) || [], scans = q(rs[7]) || [];
      var R = window.AirReachReport;

      var runRows = runs.map(function (r) {
        var k = '';
        try { k = R.parseMeasurementSummary(r.summary).rows.filter(function (x) { return x.group === 'main'; }).map(function (x) { return esc(x.provider) + ' 引用' + esc(x.citeRate) + '% / 言及' + esc(x.mentionRate) + '%'; }).join('、'); } catch (e) { k = '（集計を読めません）'; }
        return '<tr><td>' + esc(r.measured_on) + '</td><td>' + esc(r.query_set_version || '') + '</td><td>' + k + '</td><td><button class="arc-btn-sm" data-del-run="' + r.id + '">削除</button></td></tr>';
      }).join('');
      var trRows = traffic.map(function (t) {
        var m = t.metrics || {};
        var v = /^gsc/.test(t.source) ? 'クリック ' + esc(m.clicks) + ' / 表示 ' + esc(m.impressions) : 'セッション ' + esc(m.sessions) + ' / AI経由 ' + esc(m.ai_sessions) + ' / CV ' + esc(m.conversions);
        return '<tr><td>' + esc(ym(t.period_month)) + '</td><td>' + esc(t.source) + '</td><td>' + v + '</td><td><button class="arc-btn-sm" data-del-traffic="' + t.id + '">削除</button></td></tr>';
      }).join('');
      var actRows = actions.map(function (a) {
        return '<tr><td>' + esc(a.done_on || '') + '</td><td>' + esc(a.title) + (a.evidence_url ? ' <a href="' + esc(a.evidence_url) + '" target="_blank" rel="noopener noreferrer">証拠 ↗</a>' : '') + '</td><td>' + (a.status === 'done' ? '実施済み' : '予定') + '</td><td><button class="arc-btn-sm" data-del-action="' + a.id + '">削除</button></td></tr>';
      }).join('');
      var scanRows = scans.slice(0, 12).map(function (s) {
        return '<tr><td>' + esc(String(s.createdAt).slice(0, 10)) + '</td><td>' + esc(s.url) + '</td><td>' + (s.overallScore == null ? '—' : esc(s.overallScore) + '点') + '</td><td>' + esc((s.gaps || []).length) + '件</td></tr>';
      }).join('');
      var repRows = reports.map(function (r) {
        return '<tr><td>' + esc(ym(r.period_month)) + '</td><td>' + (r.status === 'published' ? '<span class="arc-chip is-ok">公開</span>' : '<span class="arc-chip">下書き</span>') + '</td><td><a href="#/r/' + r.id + '">編集</a> · <a href="/airreach/app/report/?id=' + r.id + '">表示・PDF</a></td></tr>';
      }).join('');

      shell(c.name,
        '<section class="arc-card"><h2 class="arc-h2">月次レポート</h2>' +
        '<form id="arc-make-report" class="arc-row"><input class="arc-input" type="month" id="arc-report-month" value="' + thisMonth() + '" required>' +
        '<button class="arc-btn" type="submit">この月の下書きを作る</button></form>' +
        '<p class="arc-note">下の材料（診断・AI計測・流入・施策）から、数字と変化を自動で集めます。結論・次の3施策・判断事項は、作成後に編集画面で書きます。</p>' +
        '<table class="arc-table"><tbody>' + (repRows || '<tr><td class="arc-empty">まだありません</td></tr>') + '</tbody></table></section>' +

        '<section class="arc-card"><h2 class="arc-h2">対象サイト・診断履歴</h2>' +
        '<ul class="arc-list">' + (sites.map(function (s) { return '<li>' + esc(s.url) + ' <button class="arc-btn-sm" data-del-site="' + s.id + '">削除</button></li>'; }).join('') || '<li class="arc-empty">まだありません</li>') + '</ul>' +
        '<form id="arc-add-site" class="arc-row"><input class="arc-input" id="arc-site-url" placeholder="https://example.jp/" required><button class="arc-btn" type="submit">サイトを追加</button></form>' +
        '<p class="arc-note">診断は <a href="/airreach/" target="_blank" rel="noopener">無料診断</a> で行います。同じサイト（www. の有無は同一）の診断がここに並びます。</p>' +
        '<table class="arc-table"><thead><tr><th>日付</th><th>URL</th><th>点数</th><th>不足</th></tr></thead><tbody>' + (scanRows || '<tr><td colspan="4" class="arc-empty">まだありません</td></tr>') + '</tbody></table></section>' +

        '<section class="arc-card"><h2 class="arc-h2">AI回答の計測</h2>' +
        '<form id="arc-add-run" class="arc-row"><input class="arc-input" type="date" id="arc-run-date" required><input class="arc-input" type="file" id="arc-run-file" accept=".json,application/json" required><button class="arc-btn" type="submit">summary.json を取り込む</button></form>' +
        '<p class="arc-note">社内の計測スクリプトが出力する summary.json（runs/&lt;実行名&gt;/summary.json）を選びます。</p>' +
        '<table class="arc-table"><thead><tr><th>計測日</th><th>質問の版</th><th>主な質問の引用率・言及率</th><th></th></tr></thead><tbody>' + (runRows || '<tr><td colspan="4" class="arc-empty">まだありません</td></tr>') + '</tbody></table></section>' +

        '<section class="arc-card"><h2 class="arc-h2">検索・アクセスの数値（月ごと）</h2>' +
        '<form id="arc-add-gsc" class="arc-row"><input class="arc-input" type="month" id="arc-gsc-month" value="' + thisMonth() + '" required><input class="arc-input" type="file" id="arc-gsc-file" accept=".csv,text/csv" required><button class="arc-btn" type="submit">Search Console の CSV を取り込む</button></form>' +
        '<p class="arc-note">Search Console の「検索パフォーマンス」→「エクスポート」→ CSV の、日付の表（グラフ.csv / Chart.csv）を選びます。</p>' +
        '<form id="arc-add-ga4" class="arc-row"><input class="arc-input" type="month" id="arc-ga4-month" value="' + thisMonth() + '" required>' +
        '<input class="arc-input" type="number" min="0" id="arc-ga4-sessions" placeholder="セッション">' +
        '<input class="arc-input" type="number" min="0" id="arc-ga4-ai" placeholder="AI経由セッション">' +
        '<input class="arc-input" type="number" min="0" id="arc-ga4-pv" placeholder="対象ページ閲覧">' +
        '<input class="arc-input" type="number" min="0" id="arc-ga4-cv" placeholder="問い合わせ・予約">' +
        '<button class="arc-btn" type="submit">GA4 の数値を保存</button></form>' +
        '<table class="arc-table"><thead><tr><th>月</th><th>取得元</th><th>数値</th><th></th></tr></thead><tbody>' + (trRows || '<tr><td colspan="4" class="arc-empty">まだありません</td></tr>') + '</tbody></table></section>' +

        '<section class="arc-card"><h2 class="arc-h2">実施した施策</h2>' +
        '<form id="arc-add-action" class="arc-row"><input class="arc-input" type="date" id="arc-act-date"><input class="arc-input" id="arc-act-title" placeholder="やったこと（例: よくある質問を5問追加）" required>' +
        '<input class="arc-input" id="arc-act-url" placeholder="証拠のURL（公開ページ）"><select class="arc-input" id="arc-act-status"><option value="done">実施済み</option><option value="planned">予定</option></select>' +
        '<button class="arc-btn" type="submit">追加</button></form>' +
        '<table class="arc-table"><tbody>' + (actRows || '<tr><td class="arc-empty">まだありません</td></tr>') + '</tbody></table></section>' +

        '<section class="arc-card"><h2 class="arc-h2">顧客側のメンバー</h2>' +
        '<ul class="arc-list">' + (members.map(function (m) { return '<li>' + esc(m.email) + ' <button class="arc-btn-sm" data-del-member="' + esc(m.email) + '">削除</button></li>'; }).join('') || '<li class="arc-empty">まだいません</li>') + '</ul>' +
        '<form id="arc-add-member" class="arc-row"><input class="arc-input" type="email" id="arc-member-email" placeholder="client@example.jp" required><button class="arc-btn" type="submit">招待</button></form>' +
        '<p class="arc-note">登録したメールアドレスで /airreach/app/ にログインすると、この顧客の「公開済み」レポートだけが見えます。招待メールは送られないので、URL をお伝えください。</p></section>',
        '#/');

      function done(p) { return p.then(function (res) { q(res); return clientStaff(id); }).catch(fail); }
      $('#arc-add-site').addEventListener('submit', function (e) {
        e.preventDefault();
        var url = $('#arc-site-url').value.trim(), host = hostOf(url);
        if (!host) { msg('URL を確認してください', 'error'); return; }
        done(sb.from('client_sites').insert({ client_id: id, url: url, host: host }));
      });
      $('#arc-add-member').addEventListener('submit', function (e) {
        e.preventDefault();
        done(sb.from('client_members').insert({ client_id: id, email: $('#arc-member-email').value.trim().toLowerCase() }));
      });
      $('#arc-add-action').addEventListener('submit', function (e) {
        e.preventDefault();
        done(sb.from('action_items').insert({ client_id: id, title: $('#arc-act-title').value.trim(), done_on: $('#arc-act-date').value || null,
          evidence_url: $('#arc-act-url').value.trim() || null, status: $('#arc-act-status').value, created_by: me.email }));
      });
      $('#arc-add-run').addEventListener('submit', function (e) {
        e.preventDefault();
        readFile($('#arc-run-file')).then(function (text) {
          var json = JSON.parse(text);
          var parsed = R.parseMeasurementSummary(json);
          return done(sb.from('measurement_runs').insert({ client_id: id, measured_on: $('#arc-run-date').value, run_label: parsed.runId,
            query_set_version: parsed.querySetVersion, source: 'script', summary: json, created_by: me.email }));
        }).catch(fail);
      });
      $('#arc-add-gsc').addEventListener('submit', function (e) {
        e.preventDefault();
        var month = $('#arc-gsc-month').value + '-01';
        readFile($('#arc-gsc-file')).then(function (text) {
          var g = R.parseGscCsv(text, month);
          return done(sb.from('traffic_snapshots').upsert({ client_id: id, period_month: month, source: 'gsc_csv',
            metrics: { clicks: g.clicks, impressions: g.impressions, ctr: g.ctr, position: g.position }, created_by: me.email }, { onConflict: 'client_id,period_month,source' }));
        }).catch(fail);
      });
      $('#arc-add-ga4').addEventListener('submit', function (e) {
        e.preventDefault();
        function n(sel) { var v = $(sel).value; return v === '' ? null : Number(v); }
        done(sb.from('traffic_snapshots').upsert({ client_id: id, period_month: $('#arc-ga4-month').value + '-01', source: 'ga4_manual',
          metrics: { sessions: n('#arc-ga4-sessions'), ai_sessions: n('#arc-ga4-ai'), target_page_views: n('#arc-ga4-pv'), conversions: n('#arc-ga4-cv') }, created_by: me.email },
          { onConflict: 'client_id,period_month,source' }));
      });
      root.querySelectorAll('[data-del-site]').forEach(function (b) { b.addEventListener('click', function () { done(sb.from('client_sites').delete().eq('id', b.getAttribute('data-del-site'))); }); });
      root.querySelectorAll('[data-del-member]').forEach(function (b) { b.addEventListener('click', function () { done(sb.from('client_members').delete().eq('client_id', id).eq('email', b.getAttribute('data-del-member'))); }); });
      root.querySelectorAll('[data-del-run]').forEach(function (b) { b.addEventListener('click', function () { done(sb.from('measurement_runs').delete().eq('id', b.getAttribute('data-del-run'))); }); });
      root.querySelectorAll('[data-del-traffic]').forEach(function (b) { b.addEventListener('click', function () { done(sb.from('traffic_snapshots').delete().eq('id', b.getAttribute('data-del-traffic'))); }); });
      root.querySelectorAll('[data-del-action]').forEach(function (b) { b.addEventListener('click', function () { done(sb.from('action_items').delete().eq('id', b.getAttribute('data-del-action'))); }); });

      $('#arc-make-report').addEventListener('submit', function (e) {
        e.preventDefault();
        var month = $('#arc-report-month').value + '-01';
        var existing = reports.filter(function (r) { return r.period_month === month; })[0];
        if (existing && existing.status === 'published') { msg('この月のレポートは公開済みです。作り直すには、編集画面で「非公開に戻す」を先に行ってください。', 'error'); return; }
        var compiled;
        try { compiled = R.compileReport({ client: c, periodMonth: month, scans: scans, runs: runs, traffic: traffic, actions: actions }); } catch (err) { fail(err); return; }
        var row = { client_id: id, period_month: month, compiled: compiled, status: 'draft', updated_by: me.email };
        if (!existing) row.created_by = me.email;
        sb.from('reports').upsert(row, { onConflict: 'client_id,period_month' }).select('id').single()
          .then(function (res) { var d = q(res); location.hash = '#/r/' + d.id; }).catch(fail);
      });
    });
  }

  // ---- レポート編集（社内）---------------------------------------------------
  function reportEditor(rid) {
    return sb.from('reports').select('*, clients(name)').eq('id', rid).maybeSingle().then(function (res) {
      var r = q(res); if (!r) throw new Error('レポートが見つかりません');
      var cmp = r.compiled || {};
      var concl = (r.conclusions || []).concat(['', '', '']).slice(0, 3);
      var next = (r.next_actions || []).concat([{}, {}, {}]).slice(0, 3);
      var decisions = (r.client_decisions || []).join('\n');
      shell((r.clients && r.clients.name ? r.clients.name + ' · ' : '') + ym(r.period_month) + ' のレポート',
        '<section class="arc-card"><h2 class="arc-h2">自動で集めた事実</h2><ul class="arc-list">' +
        ((cmp.facts || []).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') || '<li class="arc-empty">材料がありません</li>') + '</ul>' +
        ((cmp.missing || []).length ? '<p class="arc-note">未計測: ' + esc(cmp.missing.join('、')) + '（レポートには「未計測」と表示されます）</p>' : '') + '</section>' +
        '<form id="arc-report-form"><section class="arc-card"><h2 class="arc-h2">今月の結論（3点）</h2>' +
        concl.map(function (t, i) { return '<textarea class="arc-input arc-ta" data-concl="' + i + '" rows="2" placeholder="結論 ' + (i + 1) + '">' + esc(t) + '</textarea>'; }).join('') + '</section>' +
        '<section class="arc-card"><h2 class="arc-h2">次にやる3施策</h2>' +
        next.map(function (a, i) {
          return '<div class="arc-row"><input class="arc-input" data-next-title="' + i + '" placeholder="施策 ' + (i + 1) + '" value="' + esc(a.title || '') + '">' +
            '<input class="arc-input" data-next-owner="' + i + '" placeholder="担当" value="' + esc(a.owner || '') + '">' +
            '<input class="arc-input" type="date" data-next-due="' + i + '" value="' + esc(a.due || '') + '"></div>';
        }).join('') + '</section>' +
        '<section class="arc-card"><h2 class="arc-h2">お客様に判断いただきたいこと</h2><textarea class="arc-input arc-ta" id="arc-decisions" rows="3" placeholder="1行に1件">' + esc(decisions) + '</textarea></section>' +
        '<div class="arc-row"><button class="arc-btn" type="submit">保存</button>' +
        (r.status === 'published' ? '<button class="arc-btn arc-btn-line" type="button" id="arc-unpublish">非公開に戻す</button>' : '<button class="arc-btn arc-btn-line" type="button" id="arc-publish">公開する（お客様が見られる）</button>') +
        '<a class="arc-btn arc-btn-line" href="/airreach/app/report/?id=' + r.id + '">表示・PDF</a></div></form>',
        '#/c/' + r.client_id);

      function collect() {
        var c3 = [0, 1, 2].map(function (i) { return $('[data-concl="' + i + '"]').value.trim(); }).filter(Boolean);
        var n3 = [0, 1, 2].map(function (i) {
          return { title: $('[data-next-title="' + i + '"]').value.trim(), owner: $('[data-next-owner="' + i + '"]').value.trim(), due: $('[data-next-due="' + i + '"]').value };
        }).filter(function (a) { return a.title; });
        var d = $('#arc-decisions').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        return { conclusions: c3, next_actions: n3, client_decisions: d, updated_by: me.email };
      }
      function save(extra) {
        return sb.from('reports').update(Object.assign(collect(), extra || {})).eq('id', r.id).then(function (res) { q(res); });
      }
      $('#arc-report-form').addEventListener('submit', function (e) { e.preventDefault(); save().then(function () { msg('保存しました', 'ok'); }).catch(fail); });
      var pub = $('#arc-publish');
      if (pub) pub.addEventListener('click', function () {
        var c = collect();
        if (!c.conclusions.length) { msg('公開する前に、結論を1つ以上書いてください', 'error'); return; }
        save({ status: 'published', published_at: new Date().toISOString() }).then(function () { return reportEditor(rid); }).then(function () { msg('公開しました', 'ok'); }).catch(fail);
      });
      var unpub = $('#arc-unpublish');
      if (unpub) unpub.addEventListener('click', function () {
        save({ status: 'draft', published_at: null }).then(function () { return reportEditor(rid); }).then(function () { msg('非公開に戻しました', 'ok'); }).catch(fail);
      });
    });
  }

  boot();
})();
