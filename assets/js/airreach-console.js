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
  var PROVIDER_LABEL = { openai: 'ChatGPT', gemini: 'Gemini', claude: 'Claude', perplexity: 'Perplexity' };
  var SOURCE_LABEL = { gsc_csv: 'Search Console（CSV）', gsc_api: 'Search Console（連携）', ga4_manual: 'GA4（手入力）', ga4_api: 'GA4（連携）' };
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
  // レポートの状態。承認フロー（DB の migration 20261002130000）が入っているかは airreach_me の can_approve の有無で見る
  var REPORT_STATUS = { draft: ['下書き', ''], in_review: ['確認待ち', 'is-warn'], approved: ['承認済み・未公開', 'is-warn'], published: ['公開', 'is-ok'] };
  function approvalOn() { return !!me && Object.prototype.hasOwnProperty.call(me, 'can_approve'); }
  function statusChip(st, prefix) { var x = REPORT_STATUS[st] || [st, '']; return '<span class="arc-chip ' + x[1] + '">' + esc((prefix || '') + x[0]) + '</span>'; }
  function jst(iso) { if (!iso) return ''; var t = Date.parse(iso); if (isNaN(t)) return ''; var d = new Date(t + 9 * 3600 * 1000); function z(n) { return (n < 10 ? '0' : '') + n; } return d.getUTCFullYear() + '-' + z(d.getUTCMonth() + 1) + '-' + z(d.getUTCDate()) + ' ' + z(d.getUTCHours()) + ':' + z(d.getUTCMinutes()); }
  // お客様へのログイン用メール。implicit フロー（supabase-js の既定）なので、送った人のブラウザに縛られず、お客様のブラウザで開ける
  function sendLoginMail(email) {
    return sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + '/airreach/app/', shouldCreateUser: true } }).then(function (res) {
      if (res && res.error) {
        var m = String(res.error.message || res.error);
        if (/rate limit|security purposes|seconds/i.test(m)) throw new Error('メールの送信が続いたため、少し待ってから「ログインメールを再送」を押してください（' + m + '）');
        throw new Error('登録はできましたが、メールを送れませんでした。「ログインメールを再送」を押してください（' + m + '）');
      }
    });
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

  // 顧客の画面・その顧客のレポートを見ているときは、上部の Studio の入口をその顧客の作業として開く
  var navClient = null;
  // ---- 画面の枠（Studio と同じ: 上の帯・左の段階・右の作業）-------------------------
  // ctx: { client: { id, name, site }, sec: 'list'|'review'|'home'|'sites'|'runs'|'traffic'|'actions'|'reports'|'members' }
  var SECTIONS = [
    { group: '概要', items: [['home', 'ホーム']] },
    { group: '材料', items: [['sites', '診断'], ['runs', 'AI計測'], ['traffic', '検索と訪問'], ['actions', '施策']] },
    { group: 'レポート', items: [['reports', '月次レポート']] },
    { group: '設定', items: [['members', '顧客側のメンバー']] }
  ];
  var SEC_LABEL = {}; SECTIONS.forEach(function (g) { g.items.forEach(function (it) { SEC_LABEL[it[0]] = it[1]; }); });
  function sideHtml(ctx) {
    var cl = ctx.client, n = 0;
    function item(href, label, on, badge) {
      n += 1;
      return '<a class="arc-side-i' + (on ? ' is-on' : '') + '" href="' + href + '"' + (on ? ' aria-current="page"' : '') + '><span class="arc-side-n">' + n + '</span><span class="arc-side-l">' + esc(label) + '</span>' + (badge || '') + '</a>';
    }
    if (!cl) {
      return '<nav class="arc-side" aria-label="ダッシュボードの画面"><div class="arc-side-g">全体</div>' +
        item('#/', '顧客一覧', ctx.sec === 'list') + item('#/review', '確認待ちのレポート', ctx.sec === 'review') +
        '<p class="arc-side-note">顧客を選ぶと、ホーム・診断・AI計測・検索と訪問・施策・月次レポート・メンバーの画面がここに並びます。</p></nav>';
    }
    return '<nav class="arc-side" aria-label="顧客の画面"><a class="arc-side-back" href="#/">← 顧客一覧</a>' +
      SECTIONS.map(function (g) {
        return '<div class="arc-side-g">' + g.group + '</div>' + g.items.map(function (it) {
          return item('#/c/' + cl.id + (it[0] === 'home' ? '' : '/' + it[0]), it[1], ctx.sec === it[0], it[0] === 'reports' && ctx.reportBadge ? '<span class="arc-side-b">' + esc(ctx.reportBadge) + '</span>' : '');
        }).join('');
      }).join('') + '</nav>';
  }
  var pickCache = null;
  function pickerHtml(cl) {
    return '<details class="arc-pick" id="arc-pick"><summary><span class="arc-pick-l">顧客</span><b>' + esc(cl ? cl.name : '選んでいません') + '</b> ▾</summary>' +
      '<div class="arc-pick-menu" role="menu"><p class="arc-note">読み込んでいます…</p></div></details>';
  }
  function bindPicker() {
    var d = document.getElementById('arc-pick');
    if (!d) return;
    d.addEventListener('toggle', function () {
      if (!d.open) return;
      var menu = d.querySelector('.arc-pick-menu');
      (pickCache ? Promise.resolve(pickCache) : sb.from('clients').select('id,name,status').order('name').then(function (r) { pickCache = q(r) || []; return pickCache; }))
        .then(function (rows) {
          menu.innerHTML = '<input class="arc-input arc-pick-q" type="search" placeholder="顧客を探す" aria-label="顧客を探す"><ul>' +
            rows.filter(function (c) { return c.status !== 'ended'; }).map(function (c) { return '<li><a role="menuitem" href="#/c/' + c.id + '">' + esc(c.name) + '</a></li>'; }).join('') + '</ul>';
          var qi = menu.querySelector('.arc-pick-q');
          qi.addEventListener('input', function () { var v = qi.value.trim().toLowerCase(); Array.prototype.forEach.call(menu.querySelectorAll('li'), function (li) { li.hidden = !!v && li.textContent.toLowerCase().indexOf(v) < 0; }); });
          qi.focus();
          Array.prototype.forEach.call(menu.querySelectorAll('a'), function (a) { a.addEventListener('click', function () { d.open = false; }); });
        }).catch(fail);
    });
    document.addEventListener('click', function (e) { if (d.open && !d.contains(e.target)) d.open = false; });
  }
  // 顧客の画面・その顧客のレポートを見ているときは、上部の Studio の入口をその顧客の作業として開く
  var navClient = null;
  function shell(title, bodyHtml, back, ctx) {
    ctx = ctx || {};
    var staff = !!me.is_staff, cl = ctx.client || null;
    var site = cl && cl.site ? String(cl.site).replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
    var side = staff ? sideHtml(ctx) : '';
    root.innerHTML =
      '<header class="arc-bar"><a class="arc-brand" href="#/">AirReach</a>' +
      (staff ? pickerHtml(cl) : (cl ? '<span class="arc-bar-client">' + esc(cl.name) + '</span>' : '')) +
      (site ? '<span class="arc-bar-site">' + esc(site) + '</span>' : '') +
      '<span class="arc-bar-sp"></span>' +
      // 社内の人には、ほかの社内ツールへの入口を常に出す（お客様には出さない）
      (staff ? '<nav class="arc-tools" aria-label="社内ツール"><a href="' + esc(navClient ? navClient.href : '/airreach/studio/') + '"' + (navClient ? ' title="' + esc((navClient.name || '') + ' を Studio で開く') + '"' : '') + '>' + (navClient ? 'Studio（この顧客）' : 'Studio') + '</a><a href="/airreach/sales/">営業キット</a><a href="/airreach/" target="_blank" rel="noopener">無料診断</a></nav>' : '') +
      '<span class="arc-who">' + esc(me.email) + (staff ? ' · 社内' : '') + ' <button type="button" class="arc-btn-sm" id="arc-logout">ログアウト</button></span></header>' +
      '<div class="arc-shell' + (side ? '' : ' is-full') + '">' + side +
      '<div class="arc-main"><div class="arc-top"><div>' + (back ? '<a class="arc-back" href="' + back + '">← 戻る</a>' : '') +
      (ctx.kicker ? '<div class="arc-kicker">' + esc(ctx.kicker) + '</div>' : '') +
      '<h1 class="arc-h1">' + esc(title) + '</h1></div>' + (ctx.action || '') + '</div>' +
      '<p id="arc-msg" class="arc-msg" hidden aria-live="polite"></p>' + bodyHtml + '</div></div>';
    $('#arc-logout').addEventListener('click', function () { sb.auth.signOut().then(function () { location.hash = ''; route(); }); });
    if (staff) bindPicker();
  }

  function route() {
    navClient = null; // 顧客の一覧などに戻ったら、Studio の入口は顧客なしに戻す
    return sb.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      if (!session) { renderLogin(); return; }
      return sb.rpc('airreach_me').then(function (r) {
        me = q(r) || {};
        var h = location.hash || '';
        var m;
        if ((m = /^#\/c\/([0-9a-f-]{36})(?:\/([a-z]+))?$/.exec(h))) return me.is_staff ? clientStaff(m[1], SEC_LABEL[m[2]] ? m[2] : 'home') : clientMember(m[1]);
        if (h === '#/review' && me.is_staff) return reviewList();
        if ((m = /^#\/r\/([0-9a-f-]{36})$/.exec(h)) && me.is_staff) return reportEditor(m[1]);
        // お客様で、見られる顧客が1社だけなら一覧を飛ばしてその顧客のホームを開く
        if (!me.is_staff && (me.client_ids || []).length === 1) { location.replace('#/c/' + me.client_ids[0]); return; }
        return clientList();
      });
    }).catch(fail);
  }
  // 画面を切り替えたら先頭から見せる（前の画面のスクロール位置のままだと、見出しと戻るがヘッダーの上に隠れる）
  window.addEventListener('hashchange', function () { if (sb) { window.scrollTo(0, 0); route(); } });

  // ---- 顧客一覧 --------------------------------------------------------------
  function clientList() {
    return sb.from('clients').select('id,name,industry_id,status').order('name').then(function (r) {
      var rows = q(r) || [];
      if (!me.is_staff || !rows.length || !window.AirReachCharts) return [rows, null];
      // 社内: 顧客ごとに最新の診断と今月のレポートの状態を集める
      return Promise.all([
        sb.from('reports').select('client_id,period_month,status').eq('period_month', thisMonth() + '-01'),
        Promise.all(rows.map(function (c) { return sb.rpc('airreach_client_scans', { p_client_id: c.id, p_limit: 24 }).then(function (x) { return x.data || []; }, function () { return []; }); }))
      ]).then(function (rs) { return [rows, { reports: q(rs[0]) || [], scans: rs[1] }]; });
    }).then(function (pair) {
      var rows = pair[0], extra = pair[1], C = window.AirReachCharts;
      var list;
      if (extra) {
        list = '<div class="arc-clients">' + rows.map(function (c, i) {
          var scans = (extra.scans[i] || []).slice().sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });
          var last = scans[scans.length - 1], sc = last ? last.overallScore : null, b = C.band(sc);
          var rep = extra.reports.filter(function (x) { return x.client_id === c.id; })[0];
          var st = rep ? statusChip(rep.status, '今月: ') : '<span class="arc-chip is-ng">今月: 未作成</span>';
          return '<a class="arc-client" href="#/c/' + c.id + '"><span class="arc-client-n">' + esc(c.name) + '<small>' + esc(INDUSTRY[c.industry_id] || '') + (c.status !== 'active' ? ' · ' + esc(c.status) : '') + '</small></span>' +
            '<span class="arc-client-s">' + (sc == null ? '<span class="arv-na">—</span>' : '<b>' + esc(sc) + '</b><small>点</small> <span class="arv-band" style="border-color:' + b.color + ';color:' + b.color + '">' + esc(b.label) + '</span>') + '</span>' +
            '<span class="arc-client-g">' + C.sparkline(scans.slice(-6).map(function (x) { return x.overallScore; }), c.name + ' の点数の推移') + '</span>' +
            '<span class="arc-client-r">' + st + (last ? '<small>最終診断 ' + esc(String(last.createdAt).slice(0, 10)) + '</small>' : '') + '</span></a>';
        }).join('') + '</div>';
      } else {
        list = '<ul class="arc-list">' + (rows.length ? rows.map(function (c) {
          return '<li><a href="#/c/' + c.id + '">' + esc(c.name) + '</a><span class="arc-sub">' + esc(INDUSTRY[c.industry_id] || '') + (c.status !== 'active' ? ' · ' + esc(c.status) : '') + '</span></li>';
        }).join('') : '<li class="arc-empty">' + (me.is_staff ? 'まだ顧客がありません。' : '閲覧できる顧客がありません。担当者にお問い合わせください。') + '</li>') + '</ul>';
      }
      var add = me.is_staff ?
        '<form id="arc-add-client" class="arc-row"><input class="arc-input" id="arc-client-name" placeholder="顧客名（会社・店舗）" required>' +
        '<select class="arc-input" id="arc-client-ind">' + Object.keys(INDUSTRY).map(function (k) { return '<option value="' + k + '">' + INDUSTRY[k] + '</option>'; }).join('') + '</select>' +
        '<button class="arc-btn" type="submit">顧客を追加</button></form>' : '';
      shell(me.is_staff ? '顧客一覧' : 'レポート', '<section class="arc-card">' + list + add + '</section>', '', { sec: 'list' });
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
      sb.from('reports').select('id,period_month,published_at,conclusions,next_actions,client_decisions,compiled').eq('client_id', id).eq('status', 'published').order('period_month', { ascending: false })
    ]).then(function (rs) {
      var c = q(rs[0]); var reps = q(rs[1]) || [];
      if (!c) throw new Error('この顧客は表示できません');
      var C = window.AirReachCharts, top = reps[0], body = '';
      if (top && C) {
        // 最新の公開レポートの数字と推移を、そのままホームに出す
        body += '<section class="arc-card"><div class="arv-home-head"><h2 class="arc-h2">' + esc(ymJa(top.period_month)) + 'の数字</h2>' +
          '<a class="arc-btn" href="/airreach/app/report/?id=' + top.id + '">レポートを開く・PDF</a></div>' +
          C.tiles(top.compiled || {}) +
          ((top.conclusions || []).length ? '<h3 class="arc-h3">今月の結論</h3><ol class="arr-ol arr-concl">' + top.conclusions.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ol>' : '') +
          '</section>' +
          nextCard(top) +
          '<section class="arc-card"><h2 class="arc-h2">推移（直近6か月）</h2>' + C.trends(top.compiled || {}) + '</section>' +
          todoCard(window.AirReachReport ? window.AirReachReport.todoList(top.compiled || {}) : [], top.compiled || {}, 'client');
      }
      body += '<section class="arc-card"><h2 class="arc-h2">これまでのレポート</h2><ul class="arc-list">' +
        (reps.length ? reps.map(function (r) { return '<li><a href="/airreach/app/report/?id=' + r.id + '">' + esc(ymJa(r.period_month)) + ' のレポート</a>' + (r.published_at ? '<span class="arc-sub">公開 ' + esc(String(r.published_at).slice(0, 10)) + '</span>' : '') + '</li>'; }).join('') : '<li class="arc-empty">公開済みのレポートはまだありません。</li>') +
        '</ul></section>';
      // 見られる顧客が1社だけなら「戻る」は出さない（一覧に戻っても、この画面に戻されるため）
      shell(c.name, body, (me.client_ids || []).length > 1 ? '#/' : '', { client: { id: c.id, name: c.name } });
    });
  }
  function todoCard(items, compiled, audience, studioHref) {
    var C = window.AirReachCharts, cur = compiled && compiled.site && compiled.site.current;
    if (!C || !cur) return '';
    return '<section class="arc-card"><div class="arv-home-head"><h2 class="arc-h2">直すこと' + (items.length ? '（' + items.length + '件）' : '') + '</h2>' +
      '<span class="arc-sub">' + esc(String(cur.createdAt || '').slice(0, 10)) + ' の診断で見つかった不足・優先度の高い順</span></div>' +
      (audience === 'client' && items.length > 5
        ? C.todos(items.slice(0, 5), { audience: audience }) + '<details class="arc-more"><summary>残り ' + (items.length - 5) + '件をすべて表示</summary>' + C.todos(items.slice(5), { audience: audience, start: 5 }) + '</details>'
        : C.todos(items, { audience: audience, studioHref: studioHref })) + '</section>';
  }
  // お客様のホーム: 最新の公開レポートの「次にやる3施策」と「ご判断いただきたいこと」
  function nextCard(r) {
    var next = r.next_actions || [], dec = r.client_decisions || [];
    if (!next.length && !dec.length) return '';
    return '<section class="arc-card"><h2 class="arc-h2">次にやること</h2>' +
      (next.length ? '<table class="arc-table"><thead><tr><th>施策</th><th style="width:22%">担当</th><th style="width:18%">期限</th></tr></thead><tbody>' +
        next.map(function (a) { return '<tr><td>' + esc(a.title) + '</td><td>' + esc(a.owner || '') + '</td><td>' + esc(a.due || '') + '</td></tr>'; }).join('') + '</tbody></table>' : '') +
      (dec.length ? '<h3 class="arc-h3">ご判断いただきたいこと</h3><ul class="arr-ul">' + dec.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '') +
      '</section>';
  }

  // ---- Studio との受け渡し --------------------------------------------------------
  // ダッシュボード → Studio: 顧客・URL・業種を URL パラメータで渡す（Studio 側は airreach-orchestrator.js の prefillLaunch）
  function studioHref(c, sites) {
    var p = new URLSearchParams();
    p.set('client', c.id);
    p.set('client_name', c.name || '');
    if (sites && sites[0]) p.set('url', sites[0].url);
    if (c.industry_id) p.set('industry', c.industry_id);
    return '/airreach/studio/?' + p.toString();
  }
  // Studio → ダッシュボード: Studio が sessionStorage に置いた施策の候補を受け取る
  var STUDIO_ACTIONS_KEY = 'airreach_studio_actions_v1';
  function studioActionsFor(clientId) {
    try {
      var d = JSON.parse(sessionStorage.getItem(STUDIO_ACTIONS_KEY) || 'null');
      return d && d.clientId === clientId && Array.isArray(d.items) && d.items.length ? d : null;
    } catch (e) { return null; }
  }
  // Studio の AI 計測（競合と比べた SOV を含む）を、この顧客の「AI回答の計測」として保存する
  var STUDIO_MEASURE_KEY = 'airreach_studio_measure_v1';
  function studioMeasureFor(clientId) {
    try {
      var d = JSON.parse(sessionStorage.getItem(STUDIO_MEASURE_KEY) || 'null');
      return d && d.clientId === clientId && d.summary && Array.isArray(d.summary.by) && d.summary.by.length ? d : null;
    } catch (e) { return null; }
  }
  function studioMeasureCard(d) {
    var rows = d.summary.by.map(function (b) {
      return '<tr><td>' + esc(PROVIDER_LABEL[b.provider] || b.provider) + '</td><td>' + (b.either && b.either.rate != null ? esc(b.either.rate) + '%' : '—') + '</td><td>' + (b.service_mention_rate != null ? esc(b.service_mention_rate) + '%' : '—') + '</td><td>' + (b.sov != null ? esc(b.sov) + '%' : '—') + '</td></tr>';
    }).join('');
    var comps = (d.summary.competitors || []).length ? '競合: ' + esc(d.summary.competitors.join('、')) : '競合なし（SOV は出ません）';
    return '<section class="arc-card arc-studio-in"><h2 class="arc-h2">Studio の AI計測があります（' + esc(d.measuredOn) + '）</h2>' +
      '<p class="arc-note">' + comps + '。保存すると「AI回答の計測」に入り、月次レポートの引用率・言及率・競合と比べた割合（SOV）に使われます。質問の版: ' + esc(d.summary.query_set_version || '') + '</p>' +
      '<table class="arc-table"><thead><tr><th>AI</th><th>引用率</th><th>言及率</th><th>SOV</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="arc-row"><input class="arc-input" type="date" id="arc-measure-date" value="' + esc(d.measuredOn) + '"><button type="button" class="arc-btn" id="arc-measure-add">AI計測として保存</button><button type="button" class="arc-btn arc-btn-line" id="arc-measure-discard">保存しない</button></div></section>';
  }
  function localTime(iso) {
    var t = new Date(iso); if (isNaN(t)) return '';
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return t.getFullYear() + '-' + p2(t.getMonth() + 1) + '-' + p2(t.getDate()) + ' ' + p2(t.getHours()) + ':' + p2(t.getMinutes());
  }
  function studioActionsCard(d) {
    return '<section class="arc-card arc-studio-in"><h2 class="arc-h2">Studio で作った下書きから、施策の候補が ' + d.items.length + '件あります</h2>' +
      '<p class="arc-note">' + esc(localTime(d.createdAt)) + ' に ' + esc(d.url || '') + ' の下書きを作成。登録すると「実施した施策」に<b>予定</b>として入り、実施したら日付と証拠のURLを入れて「実施済み」にします。</p>' +
      '<ul class="arc-list">' + d.items.map(function (it, i) {
        return '<li><label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" data-studio-item="' + i + '" checked><span>' + esc(it.title) + (it.file ? '<span class="arc-sub">（' + esc(it.file) + '）</span>' : '') + '</span></label></li>';
      }).join('') + '</ul>' +
      '<div class="arc-row"><button type="button" class="arc-btn" id="arc-studio-add">選んだものを予定として登録</button><button type="button" class="arc-btn arc-btn-line" id="arc-studio-discard">登録しない</button></div></section>';
  }

  // 材料のカードは折りたたむ（開いた状態は再描画しても保つ）
  var openFolds = {};
  var curSec = 'home';
  // 顧客の画面の各節。いまの節だけを見せる（ほかも DOM に置き、フォームの結び付けはそのまま使う）
  function fold(key, title, count) {
    return '<section class="arc-card arc-sec" data-sec="' + key + '"' + (curSec === key ? '' : ' hidden') + '><div class="arv-home-head"><h2 class="arc-h2">' + esc(title) + '</h2><span class="arc-sub">' + esc(count) + '</span></div><div class="arc-fold-b">';
  }

  function ymJa(d) { var s = String(d || ''); return s.slice(0, 4) + '年' + Number(s.slice(5, 7)) + '月'; }

  // ---- 顧客（社内向け）: 材料の登録とレポート作成 ------------------------------
  // ---- Google（Search Console・GA4）から月の数値を取得して保存する ----
  // 取得には、この端末で Studio の「接続」を済ませておく必要がある（Google のトークンは trillion-bank.jp の Cookie にある）。
  // どの GSC サイト・GA4 プロパティを使うかは顧客ごとにこの端末に覚える（DB は変えない）
  var GOOGLE_PROPS_KEY = 'airreach_google_props_v1';
  function googleProps(clientId) {
    try { return (JSON.parse(localStorage.getItem(GOOGLE_PROPS_KEY) || '{}') || {})[clientId] || {}; } catch (e) { return {}; }
  }
  function saveGoogleProps(clientId, v) {
    try { var all = JSON.parse(localStorage.getItem(GOOGLE_PROPS_KEY) || '{}') || {}; all[clientId] = v; localStorage.setItem(GOOGLE_PROPS_KEY, JSON.stringify(all)); } catch (e) {}
  }
  function googleSyncForm(clientId, sites) {
    var p = googleProps(clientId), host = sites[0] && sites[0].host;
    return '<form id="arc-google-sync" class="arc-row"><input class="arc-input" type="month" id="arc-g-month" value="' + thisMonth() + '" required>' +
      '<input class="arc-input" id="arc-g-gsc" placeholder="Search Console のサイト（例: sc-domain:example.jp）" value="' + esc(p.gsc != null ? p.gsc : (host ? 'sc-domain:' + host : '')) + '">' +
      '<input class="arc-input" id="arc-g-ga4" inputmode="numeric" placeholder="GA4 プロパティID（数字）" value="' + esc(p.ga4 || '') + '">' +
      '<button class="arc-btn" type="submit">Google から取得</button></form>' +
      '<p class="arc-note">先に <a href="/airreach/studio/#google" target="_blank" rel="noopener">Studio の Google 画面</a>で「接続」してください。接続した Google アカウントが閲覧できるサイトだけ取得できます（顧客サイトは閲覧権限をもらう）。' +
      'Search Console はサイト全体の表示・クリック、GA4 は ' + esc(host || '対象サイト') + ' のセッション・AI経由セッション（ChatGPT・Perplexity・Gemini 等からの流入）・キーイベントを取得します。対象ページ閲覧は手入力の値を使います。当月は昨日までの数値です。</p>';
  }
  function monthRange(ymStr) {
    var y = Number(ymStr.slice(0, 4)), mo = Number(ymStr.slice(5, 7));
    var start = ymStr + '-01', last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    var yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    var end = last < yest ? last : yest;
    return end < start ? null : { start: start, end: end };
  }
  function googlePost(path, body) {
    return fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.ok) return j;
          var e = j.error && typeof j.error === 'object' ? (j.error.message || '') : (j.error || '');
          if (r.status === 401) e = 'Google に接続していません（または接続が切れています）。Studio の Google 画面で「接続」してください';
          else if (r.status === 403 && path.indexOf('gsc') >= 0) e = 'この Search Console のサイトを見る権限がありません。サイトの種類（sc-domain: か https://〜/ か）と、閲覧権限を確認してください';
          throw new Error(e || ('HTTP ' + r.status));
        });
      });
  }
  function bindGoogleSync(clientId, sites) {
    var form = $('#arc-google-sync'); if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var month = $('#arc-g-month').value, gsc = $('#arc-g-gsc').value.trim(), ga4 = $('#arc-g-ga4').value.trim().replace(/^properties\//, '');
      var range = monthRange(month);
      if (!range) { msg('この月はまだ数値がありません', 'error'); return; }
      if (!gsc && !ga4) { msg('Search Console のサイトか GA4 プロパティIDを入れてください', 'error'); return; }
      if (ga4 && !/^\d{1,20}$/.test(ga4)) { msg('GA4 プロパティIDは数字だけです（「G-」で始まる測定IDではありません）', 'error'); return; }
      if (ga4 && !sites[0]) { msg('GA4 を取得するには、先に「対象サイト」を登録してください', 'error'); return; }
      saveGoogleProps(clientId, { gsc: gsc, ga4: ga4 });
      msg('Google から取得しています…');
      var period = month + '-01', jobs = [], got = [];
      if (gsc) jobs.push(googlePost('/api/google/gsc/', { siteUrl: gsc, startDate: range.start, endDate: range.end, totalsOnly: true }).then(function (d) {
        var t = d.totals; if (!t) throw new Error('Search Console の合計を取得できませんでした');
        got.push('Search Console（' + t.days + '日間 クリック ' + t.clicks + ' / 表示 ' + t.impressions + '）');
        return sb.from('traffic_snapshots').upsert({ client_id: clientId, period_month: period, source: 'gsc_api',
          metrics: { clicks: t.clicks, impressions: t.impressions, ctr: t.ctr, position: t.position, days: t.days, start_date: t.startDate, end_date: t.endDate, property: gsc },
          created_by: me.email }, { onConflict: 'client_id,period_month,source' }).then(q);
      }));
      if (ga4) jobs.push(googlePost('/api/google/ga4/', { propertyId: ga4, siteUrl: sites[0].url, startDate: range.start, endDate: range.end, summaryOnly: true }).then(function (d) {
        var g = d.summary; if (!g) throw new Error('GA4 の合計を取得できませんでした');
        got.push('GA4（セッション ' + g.sessions + ' / AI経由 ' + g.aiSessions + ' / キーイベント ' + g.keyEvents + '）');
        return sb.from('traffic_snapshots').upsert({ client_id: clientId, period_month: period, source: 'ga4_api',
          metrics: { sessions: g.sessions, ai_sessions: g.aiSessions, conversions: g.keyEvents, target_page_views: null, ai_sources: g.aiSources,
            property_id: ga4, host: d.host, start_date: range.start, end_date: range.end },
          created_by: me.email }, { onConflict: 'client_id,period_month,source' }).then(q);
      }));
      Promise.allSettled(jobs).then(function (rs) {
        var errs = rs.filter(function (r) { return r.status === 'rejected'; }).map(function (r) { return (r.reason && r.reason.message) || String(r.reason); });
        openFolds.traffic = true;
        return clientStaff(clientId).then(function () {
          if (errs.length) msg((got.length ? '保存: ' + got.join('、') + '。' : '') + '失敗: ' + errs.join(' / '), 'error');
          else msg('保存しました: ' + got.join('、'), 'ok');
        });
      }).catch(fail);
    });
  }

  function clientStaff(id, sec) {
    curSec = sec || 'home';
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
      var R = window.AirReachReport, C = window.AirReachCharts;

      // 今月の状況（材料からその場で集計。レポートの下書きとは別に、いつでも最新）
      var month = thisMonth() + '-01', live = null;
      try { live = R.compileReport({ client: c, periodMonth: month, scans: scans, runs: runs, traffic: traffic, actions: actions }); } catch (e) { live = null; }
      var repNow = reports.filter(function (x) { return x.period_month === month; })[0];
      var overview = '';
      if (live && C) {
        overview = '<section class="arc-card"><div class="arv-home-head"><h2 class="arc-h2">' + esc(ymJa(month)) + 'の状況</h2><span class="arc-sub">登録された材料からその場で集計</span></div>' +
          C.readiness([
            { label: '診断', ok: !!(live.site.current && live.site.current.inMonth), note: live.site.current ? (live.site.current.inMonth ? String(live.site.current.createdAt).slice(5, 10).replace('-', '/') + ' 診断' : '今月は未診断') : '未登録' },
            { label: 'AI計測', ok: !!live.ai, note: live.ai ? String(live.ai.measuredOn).slice(5).replace('-', '/') + ' 計測' : '今月は未計測' },
            { label: 'Search Console', ok: !!live.traffic.gsc },
            { label: 'GA4', ok: !!live.traffic.ga4 },
            { label: '施策', ok: live.actions.length > 0, note: live.actions.length ? live.actions.length + '件' : '今月は0件' },
            { label: 'レポート', ok: !!(repNow && repNow.status === 'published'), note: repNow ? (REPORT_STATUS[repNow.status] || [repNow.status])[0] : '未作成' }
          ]) +
          C.tiles(live) + '</section>' +
          todoCard(R.todoList(live), live, 'staff', studioHref(c, sites)) +
          '<section class="arc-card"><h2 class="arc-h2">推移（直近6か月）</h2>' + C.trends(live) + '</section>';
      }

      var runRows = runs.map(function (r) {
        var k = '';
        try { k = R.parseMeasurementSummary(r.summary).rows.filter(function (x) { return x.group === 'main'; }).map(function (x) { return esc(PROVIDER_LABEL[x.provider] || x.provider) + ' 引用' + (x.citeRate == null ? '—' : esc(x.citeRate) + '%') + ' / 言及' + esc(x.mentionRate) + '%' + (x.sov != null ? ' / SOV' + esc(x.sov) + '%' : ''); }).join('、'); } catch (e) { k = '（集計を読めません）'; }
        return '<tr><td>' + esc(r.measured_on) + '</td><td>' + esc(r.query_set_version || '') + '</td><td>' + k + '</td><td><button class="arc-btn-sm" data-del-run="' + r.id + '">削除</button></td></tr>';
      }).join('');
      var trRows = traffic.map(function (t) {
        var m = t.metrics || {};
        var v = /^gsc/.test(t.source) ? 'クリック ' + esc(m.clicks) + ' / 表示 ' + esc(m.impressions) : 'セッション ' + esc(m.sessions) + ' / AI経由 ' + esc(m.ai_sessions) + ' / CV ' + esc(m.conversions);
        return '<tr><td>' + esc(ym(t.period_month)) + '</td><td>' + esc(SOURCE_LABEL[t.source] || t.source) + '</td><td>' + v + '</td><td><button class="arc-btn-sm" data-del-traffic="' + t.id + '">削除</button></td></tr>';
      }).join('');
      var actRows = actions.map(function (a) {
        var doneForm = a.status === 'done' ? '' :
          '<div class="arc-row arc-done-form"><input class="arc-input" type="date" data-act-date="' + a.id + '" value="' + new Date().toISOString().slice(0, 10) + '">' +
          '<input class="arc-input" data-act-url="' + a.id + '" placeholder="証拠のURL（公開ページ）"><button type="button" class="arc-btn-sm" data-done-action="' + a.id + '">実施済みにする</button></div>';
        return '<tr><td>' + esc(a.done_on || '') + '</td><td>' + esc(a.title) + (a.evidence_url ? ' <a href="' + esc(a.evidence_url) + '" target="_blank" rel="noopener noreferrer">証拠 ↗</a>' : '') + doneForm + '</td><td>' + (a.status === 'done' ? '実施済み' : '<span class="arc-chip is-warn">予定</span>') + '</td><td><button class="arc-btn-sm" data-del-action="' + a.id + '">削除</button></td></tr>';
      }).join('');
      var scanRows = scans.slice(0, 12).map(function (s) {
        return '<tr><td>' + esc(String(s.createdAt).slice(0, 10)) + '</td><td>' + esc(s.url) + '</td><td>' + (s.overallScore == null ? '—' : esc(s.overallScore) + '点') + '</td><td>' + esc((s.gaps || []).length) + '件</td></tr>';
      }).join('');
      var repRows = reports.map(function (r) {
        return '<tr><td>' + esc(ym(r.period_month)) + '</td><td>' + statusChip(r.status) + '</td><td><a href="#/r/' + r.id + '">編集</a> · <a href="/airreach/app/report/?id=' + r.id + '">表示・PDF</a></td></tr>';
      }).join('');

      var fromStudio = studioActionsFor(id), fromMeasure = studioMeasureFor(id);
      navClient = { href: studioHref(c, sites), name: c.name };
      var hid = function (k) { return curSec === k ? '' : ' hidden'; };
      var repBadge = repNow ? (REPORT_STATUS[repNow.status] || [repNow.status])[0] : '';
      shell(curSec === 'home' ? c.name : SEC_LABEL[curSec], '<div data-sec="home"' + hid('home') + '>' + (fromMeasure ? studioMeasureCard(fromMeasure) : '') + (fromStudio ? studioActionsCard(fromStudio) : '') + overview + '</div>' +
        '<section class="arc-card arc-sec" data-sec="reports"' + hid('reports') + '><div class="arv-home-head"><h2 class="arc-h2">月次レポート</h2></div>' +
        '<form id="arc-make-report" class="arc-row"><input class="arc-input" type="month" id="arc-report-month" value="' + thisMonth() + '" required>' +
        '<button class="arc-btn" type="submit">この月の下書きを作る</button></form>' +
        '<p class="arc-note">下の材料（診断・AI計測・流入・施策）から、数字と変化を自動で集めます。結論・次の3施策・判断事項は、作成後に編集画面で書きます。</p>' +
        '<table class="arc-table"><tbody>' + (repRows || '<tr><td class="arc-empty">まだありません</td></tr>') + '</tbody></table></section>' +

        fold('sites', '対象サイト・診断履歴', sites.length + 'サイト・診断' + scans.length + '件') +
        '<ul class="arc-list">' + (sites.map(function (s) { return '<li>' + esc(s.url) + ' <button class="arc-btn-sm" data-del-site="' + s.id + '">削除</button></li>'; }).join('') || '<li class="arc-empty">まだありません</li>') + '</ul>' +
        '<form id="arc-add-site" class="arc-row"><input class="arc-input" id="arc-site-url" placeholder="https://example.jp/" required><button class="arc-btn" type="submit">サイトを追加</button></form>' +
        '<p class="arc-note">診断は <a href="/airreach/" target="_blank" rel="noopener">無料診断</a> で行います。同じサイト（www. の有無は同一）の診断がここに並びます。</p>' +
        '<table class="arc-table"><thead><tr><th>日付</th><th>URL</th><th>点数</th><th>不足</th></tr></thead><tbody>' + (scanRows || '<tr><td colspan="4" class="arc-empty">まだありません</td></tr>') + '</tbody></table></div></section>' +

        fold('runs', 'AI回答の計測', runs.length + '回') +
        '<form id="arc-add-run" class="arc-row"><input class="arc-input" type="date" id="arc-run-date" required><input class="arc-input" type="file" id="arc-run-file" accept=".json,application/json" required><button class="arc-btn" type="submit">summary.json を取り込む</button></form>' +
        '<p class="arc-note">社内の計測スクリプトが出力する summary.json（runs/&lt;実行名&gt;/summary.json）を選びます。</p>' +
        '<table class="arc-table"><thead><tr><th>計測日</th><th>質問の版</th><th>主な質問の引用率・言及率</th><th></th></tr></thead><tbody>' + (runRows || '<tr><td colspan="4" class="arc-empty">まだありません</td></tr>') + '</tbody></table></div></section>' +

        fold('traffic', '検索・アクセスの数値（月ごと）', traffic.length + '件') +
        '<form id="arc-add-gsc" class="arc-row"><input class="arc-input" type="month" id="arc-gsc-month" value="' + thisMonth() + '" required><input class="arc-input" type="file" id="arc-gsc-file" accept=".csv,text/csv" required><button class="arc-btn" type="submit">Search Console の CSV を取り込む</button></form>' +
        '<p class="arc-note">Search Console の「検索パフォーマンス」→「エクスポート」→ CSV の、日付の表（グラフ.csv / Chart.csv）を選びます。</p>' +
        '<form id="arc-add-ga4" class="arc-row"><input class="arc-input" type="month" id="arc-ga4-month" value="' + thisMonth() + '" required>' +
        '<input class="arc-input" type="number" min="0" id="arc-ga4-sessions" placeholder="セッション">' +
        '<input class="arc-input" type="number" min="0" id="arc-ga4-ai" placeholder="AI経由セッション">' +
        '<input class="arc-input" type="number" min="0" id="arc-ga4-pv" placeholder="対象ページ閲覧">' +
        '<input class="arc-input" type="number" min="0" id="arc-ga4-cv" placeholder="問い合わせ・予約">' +
        '<button class="arc-btn" type="submit">GA4 の数値を保存</button></form>' +
        googleSyncForm(id, sites) +
        '<table class="arc-table"><thead><tr><th>月</th><th>取得元</th><th>数値</th><th></th></tr></thead><tbody>' + (trRows || '<tr><td colspan="4" class="arc-empty">まだありません</td></tr>') + '</tbody></table></div></section>' +

        fold('actions', '実施した施策', actions.length + '件') +
        '<form id="arc-add-action" class="arc-row"><input class="arc-input" type="date" id="arc-act-date"><input class="arc-input" id="arc-act-title" placeholder="やったこと（例: よくある質問を5問追加）" required>' +
        '<input class="arc-input" id="arc-act-url" placeholder="証拠のURL（公開ページ）"><select class="arc-input" id="arc-act-status"><option value="done">実施済み</option><option value="planned">予定</option></select>' +
        '<button class="arc-btn" type="submit">追加</button></form>' +
        '<table class="arc-table"><tbody>' + (actRows || '<tr><td class="arc-empty">まだありません</td></tr>') + '</tbody></table></div></section>' +

        fold('members', '顧客側のメンバー', members.length + '人') +
        '<ul class="arc-list">' + (members.map(function (m) { return '<li>' + esc(m.email) + ' <button class="arc-btn-sm" data-resend-member="' + esc(m.email) + '">ログインメールを再送</button> <button class="arc-btn-sm" data-del-member="' + esc(m.email) + '">削除</button></li>'; }).join('') || '<li class="arc-empty">まだいません</li>') + '</ul>' +
        '<form id="arc-add-member" class="arc-row"><input class="arc-input" type="email" id="arc-member-email" placeholder="client@example.jp" required><button class="arc-btn" type="submit">招待（ログイン用のメールを送る）</button></form>' +
        '<p class="arc-note">招待すると、お客様に「AirReach ログイン用リンク」のメール（送信元 no-reply@trillion-bank.com）が届きます。リンクの有効期限は1時間です。切れたら「ログインメールを再送」を押してください。お客様に見えるのは、自社の公開済みのレポートだけです。</p>' +
        '</div></section>',
        '', { client: { id: c.id, name: c.name, site: sites[0] && sites[0].url }, sec: curSec, reportBadge: repBadge, kicker: curSec === 'home' ? '' : c.name,
          action: curSec === 'home' ? '<a class="arc-btn" href="' + esc(studioHref(c, sites)) + '">Studio で分析・計測する</a>' : '' });

      Array.prototype.forEach.call(root.querySelectorAll('details[data-fold]'), function (d) {
        d.addEventListener('toggle', function () { openFolds[d.getAttribute('data-fold')] = d.open; });
      });
      function done(p) { return p.then(function (res) { q(res); return clientStaff(id, curSec); }).catch(fail); }
      if (fromMeasure) {
        $('#arc-measure-add').addEventListener('click', function () {
          var sm = fromMeasure.summary;
          sb.from('measurement_runs').insert({ client_id: id, measured_on: $('#arc-measure-date').value || fromMeasure.measuredOn, run_label: sm.run_id,
            query_set_version: sm.query_set_version || null, source: 'manual', summary: sm, created_by: me.email }).then(function (res) {
            q(res); sessionStorage.removeItem(STUDIO_MEASURE_KEY); openFolds.runs = true;
            return clientStaff(id, curSec).then(function () { msg('AI計測を保存しました', 'ok'); });
          }).catch(fail);
        });
        $('#arc-measure-discard').addEventListener('click', function () { sessionStorage.removeItem(STUDIO_MEASURE_KEY); clientStaff(id, curSec); });
      }
      if (fromStudio) {
        $('#arc-studio-add').addEventListener('click', function () {
          var rows = fromStudio.items.filter(function (it, i) { var cb = $('[data-studio-item="' + i + '"]'); return cb && cb.checked; })
            .map(function (it) { return { client_id: id, title: it.title.slice(0, 300), status: 'planned', category: 'studio', notes: it.file ? 'Studio の下書き: ' + it.file : null, created_by: me.email }; });
          if (!rows.length) { msg('登録するものを選んでください', 'error'); return; }
          sb.from('action_items').insert(rows).then(function (res) {
            q(res); sessionStorage.removeItem(STUDIO_ACTIONS_KEY); openFolds.actions = true;
            return clientStaff(id, curSec).then(function () { msg(rows.length + '件を予定として登録しました', 'ok'); });
          }).catch(fail);
        });
        $('#arc-studio-discard').addEventListener('click', function () { sessionStorage.removeItem(STUDIO_ACTIONS_KEY); clientStaff(id, curSec); });
      }
      $('#arc-add-site').addEventListener('submit', function (e) {
        e.preventDefault();
        var url = $('#arc-site-url').value.trim(), host = hostOf(url);
        if (!host) { msg('URL を確認してください', 'error'); return; }
        done(sb.from('client_sites').insert({ client_id: id, url: url, host: host }));
      });
      $('#arc-add-member').addEventListener('submit', function (e) {
        e.preventDefault();
        var em = $('#arc-member-email').value.trim().toLowerCase();
        openFolds.members = true;
        // 登録してから送る（登録済みのメールだけがアカウントを作れるフックがあるため、順番が大事）
        sb.from('client_members').insert({ client_id: id, email: em }).then(function (res) {
          // すでに登録済みなら、登録はそのままでメールだけ送り直す
          if (res && res.error && /duplicate|23505|already exists/i.test(String(res.error.message || res.error.code || ''))) return sendLoginMail(em);
          q(res); return sendLoginMail(em);
        })
          .then(function () { return clientStaff(id, curSec); })
          .then(function () { msg(em + ' を登録し、ログイン用のメールを送りました', 'ok'); })
          .catch(function (err) { clientStaff(id, curSec).then(function () { fail(err); }); });
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
      bindGoogleSync(id, sites);
      root.querySelectorAll('[data-del-site]').forEach(function (b) { b.addEventListener('click', function () { done(sb.from('client_sites').delete().eq('id', b.getAttribute('data-del-site'))); }); });
      root.querySelectorAll('[data-resend-member]').forEach(function (b) {
        b.addEventListener('click', function () {
          var em = b.getAttribute('data-resend-member');
          b.disabled = true;
          sendLoginMail(em).then(function () {
            msg(em + ' にログイン用のメールを送りました', 'ok');
            // 同じアドレスへの送信は1分に1回まで（Supabase の制限）。1分たったら押せるように戻す
            b.textContent = '送りました（1分後に再送できます）';
            setTimeout(function () { b.disabled = false; b.textContent = 'ログインメールを再送'; }, 60000);
          }).catch(function (err) { b.disabled = false; fail(err); });
        });
      });
      root.querySelectorAll('[data-del-member]').forEach(function (b) { b.addEventListener('click', function () { done(sb.from('client_members').delete().eq('client_id', id).eq('email', b.getAttribute('data-del-member'))); }); });
      root.querySelectorAll('[data-del-run]').forEach(function (b) { b.addEventListener('click', function () { done(sb.from('measurement_runs').delete().eq('id', b.getAttribute('data-del-run'))); }); });
      root.querySelectorAll('[data-del-traffic]').forEach(function (b) { b.addEventListener('click', function () { done(sb.from('traffic_snapshots').delete().eq('id', b.getAttribute('data-del-traffic'))); }); });
      root.querySelectorAll('[data-done-action]').forEach(function (b) {
        b.addEventListener('click', function () {
          var aid = b.getAttribute('data-done-action'), d = $('[data-act-date="' + aid + '"]').value, u = $('[data-act-url="' + aid + '"]').value.trim();
          if (!d) { msg('実施日を入れてください', 'error'); return; }
          openFolds.actions = true;
          done(sb.from('action_items').update({ status: 'done', done_on: d, evidence_url: u || null }).eq('id', aid));
        });
      });
            root.querySelectorAll('[data-del-action]').forEach(function (b) { b.addEventListener('click', function () { done(sb.from('action_items').delete().eq('id', b.getAttribute('data-del-action'))); }); });

      $('#arc-make-report').addEventListener('submit', function (e) {
        e.preventDefault();
        var month = $('#arc-report-month').value + '-01';
        var existing = reports.filter(function (r) { return r.period_month === month; })[0];
        if (existing && existing.status !== 'draft') { msg('この月のレポートは「' + (REPORT_STATUS[existing.status] || [existing.status])[0] + '」です。作り直すには、編集画面で先に下書きに戻してください（確認と承認をやり直します）。', 'error'); return; }
        var compiled;
        try { compiled = R.compileReport({ client: c, periodMonth: month, scans: scans, runs: runs, traffic: traffic, actions: actions }); } catch (err) { fail(err); return; }
        var row = { client_id: id, period_month: month, compiled: compiled, status: 'draft', updated_by: me.email };
        if (!existing) row.created_by = me.email;
        sb.from('reports').upsert(row, { onConflict: 'client_id,period_month' }).select('id').single()
          .then(function (res) { var d = q(res); location.hash = '#/r/' + d.id; }).catch(fail);
      });
    });
  }

  // ---- 確認待ちのレポート（社内・全顧客）--------------------------------------------
  function reviewList() {
    var sts = approvalOn() ? ['in_review', 'approved'] : ['draft'];
    return sb.from('reports').select('id,client_id,period_month,status,submitted_by,submitted_at,clients(name)').in('status', sts).order('period_month', { ascending: false }).then(function (res) {
      var rows = q(res) || [];
      var body = '<section class="arc-card"><p class="arc-note">' + (approvalOn() ? '確認を依頼されたレポートと、承認済みでまだ公開していないレポートです。' : '下書きのレポートです。') + '</p>' +
        '<table class="arc-table"><thead><tr><th>顧客</th><th>月</th><th>状態</th><th>依頼</th><th></th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (r) {
          return '<tr><td>' + esc((r.clients && r.clients.name) || '') + '</td><td>' + esc(ymJa(r.period_month)) + '</td><td>' + statusChip(r.status) + '</td><td>' + esc(r.submitted_by ? r.submitted_by.split('@')[0] + '（' + jst(r.submitted_at) + '）' : '') + '</td><td><a href="#/r/' + r.id + '">開く</a></td></tr>';
        }).join('') : '<tr><td colspan="5" class="arc-empty">ありません</td></tr>') + '</tbody></table></section>';
      shell('確認待ちのレポート', body, '', { sec: 'review' });
    });
  }

  // ---- レポート編集（社内）---------------------------------------------------
  function reportEditor(rid) {
    return sb.from('reports').select('*, clients(name)').eq('id', rid).maybeSingle().then(function (res) {
      var r = q(res); if (!r) throw new Error('レポートが見つかりません');
      if (!approvalOn()) return [r, [], []];
      return Promise.all([
        sb.from('report_events').select('action,actor,note,created_at').eq('report_id', rid).order('created_at', { ascending: true }),
        sb.from('staff_members').select('email,name,can_approve')
      ]).then(function (x) { return [r, q(x[0]) || [], q(x[1]) || []]; });
    }).then(function (pack) {
      var r = pack[0], events = pack[1], staff = pack[2];
      var flow = approvalOn();
      var editable = !flow || r.status === 'draft';
      function who(email) { var s = staff.filter(function (x) { return x.email === email; })[0]; return s && s.name ? s.name : (email || ''); }
      var approvers = staff.filter(function (x) { return x.can_approve; }).map(function (x) { return x.name || x.email; });
      var ACT = { created: '作成', submitted: '確認を依頼', withdrawn: '依頼を取り下げ', returned: '差し戻し', approved: '承認', published: '公開', unpublished: '非公開に戻す' };
      var lastReturn = events.filter(function (e) { return e.action === 'returned'; }).slice(-1)[0];
      var approvalCard = !flow ? '' : '<section class="arc-card arc-approval"><h2 class="arc-h2">確認と承認 ' + statusChip(r.status) + '</h2>' +
        '<ol class="arc-steps">' +
          '<li class="' + (r.status === 'draft' ? 'is-now' : 'is-done') + '">担当が作成・確認</li>' +
          '<li class="' + (r.status === 'in_review' ? 'is-now' : (r.status === 'approved' || r.status === 'published' ? 'is-done' : '')) + '">承認者が承認' + (approvers.length ? '<small>（' + esc(approvers.join('・')) + '）</small>' : '<small>（承認者が未設定）</small>') + '</li>' +
          '<li class="' + (r.status === 'approved' ? 'is-now' : (r.status === 'published' ? 'is-done' : '')) + '">公開（お客様の画面・PDF）</li>' +
        '</ol>' +
        (r.submitted_by ? '<p class="arc-sub">依頼：' + esc(who(r.submitted_by)) + '（' + esc(jst(r.submitted_at)) + '）</p>' : '') +
        (r.approved_by ? '<p class="arc-sub">承認：' + esc(who(r.approved_by)) + '（' + esc(jst(r.approved_at)) + '）</p>' : '') +
        (r.status === 'draft' && lastReturn ? '<p class="arc-note">差し戻し（' + esc(who(lastReturn.actor)) + '・' + esc(jst(lastReturn.created_at)) + '）：' + esc(lastReturn.note || '理由の記入なし') + '</p>' : '') +
        (r.status === 'in_review' && me.can_approve && me.email !== r.submitted_by ? '<textarea class="arc-input arc-ta" id="arc-review-note" rows="2" maxlength="1000" placeholder="差し戻すときの理由（担当者に表示されます）"></textarea>' : '') +
        (events.length ? '<details class="arc-history"><summary>履歴（' + events.length + '件）</summary><ul class="arc-list">' + events.map(function (e) {
          return '<li>' + esc(jst(e.created_at)) + '　' + esc(ACT[e.action] || e.action) + '　' + esc(who(e.actor) || '管理者') + (e.note && e.action === 'returned' ? '：' + esc(e.note) : '') + '</li>';
        }).join('') + '</ul></details>' : '') +
        '</section>';
      var cmp = r.compiled || {};
      var concl = (r.conclusions || []).concat(['', '', '']).slice(0, 3);
      var next = (r.next_actions || []).concat([{}, {}, {}]).slice(0, 3);
      var decisions = (r.client_decisions || []).join('\n');
      navClient = { href: studioHref({ id: r.client_id, name: (r.clients && r.clients.name) || '' }, null), name: (r.clients && r.clients.name) || '' };
      shell(ymJa(r.period_month) + ' のレポート',
        (window.AirReachCharts && cmp.site ? '<section class="arc-card"><h2 class="arc-h2">今月の数字（お客様にもこの形で見えます）</h2>' + window.AirReachCharts.tiles(cmp) + '</section>' : '') +
        '<section class="arc-card"><h2 class="arc-h2">自動で集めた事実</h2><ul class="arc-list">' +
        ((cmp.facts || []).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') || '<li class="arc-empty">材料がありません</li>') + '</ul>' +
        ((cmp.missing || []).length ? '<p class="arc-note">未計測: ' + esc(cmp.missing.join('、')) + '（レポートには「未計測」と表示されます）</p>' : '') + '</section>' +
        '<p class="arc-hint">結論・次の3施策・判断事項は、<b>お客様がそのまま読む欄</b>です。専門用語（構造化データ、llms.txt、robots.txt など）は避け、「検索やAIが読み取れる形で店舗情報を埋め込む」のように言い換えてください。</p>' +
        '<form id="arc-report-form"><section class="arc-card"><h2 class="arc-h2">今月の結論（3点）</h2>' +
        concl.map(function (t, i) { return '<textarea class="arc-input arc-ta" data-concl="' + i + '" rows="2" placeholder="結論 ' + (i + 1) + '">' + esc(t) + '</textarea>'; }).join('') + '</section>' +
        (window.AirReachCharts && cmp.site && cmp.site.current ? '<section class="arc-card"><h2 class="arc-h2">施策の候補（診断の不足・優先度の高い順）</h2>' + window.AirReachCharts.todos(window.AirReachReport.todoList(cmp), { audience: 'staff', limit: 6, pick: true }) + '</section>' : '') +
        '<section class="arc-card"><h2 class="arc-h2">次にやる3施策</h2>' +
        next.map(function (a, i) {
          return '<div class="arc-row"><input class="arc-input" data-next-title="' + i + '" placeholder="施策 ' + (i + 1) + '" value="' + esc(a.title || '') + '">' +
            '<input class="arc-input" data-next-owner="' + i + '" placeholder="担当" value="' + esc(a.owner || '') + '">' +
            '<input class="arc-input" type="date" data-next-due="' + i + '" value="' + esc(a.due || '') + '"></div>';
        }).join('') + '</section>' +
        '<section class="arc-card"><h2 class="arc-h2">お客様に判断いただきたいこと</h2><textarea class="arc-input arc-ta" id="arc-decisions" rows="3" placeholder="1行に1件">' + esc(decisions) + '</textarea></section>' +
        approvalCard +
        '<div class="arc-row">' + (editable ? '<button class="arc-btn" type="submit">保存</button>' : '') +
        (!flow ? (r.status === 'published' ? '<button class="arc-btn arc-btn-line" type="button" id="arc-unpublish">非公開に戻す</button>' : '<button class="arc-btn arc-btn-line" type="button" id="arc-publish">公開する（お客様が見られる）</button>') :
          r.status === 'draft' ? '<button class="arc-btn arc-btn-line" type="button" id="arc-submit">確認を依頼する</button>' :
          r.status === 'in_review' ? (me.can_approve && me.email !== r.submitted_by ? '<button class="arc-btn" type="button" id="arc-approve">承認する</button><button class="arc-btn arc-btn-line" type="button" id="arc-return">差し戻す</button>' :
            (me.email === r.submitted_by ? '<button class="arc-btn arc-btn-line" type="button" id="arc-withdraw">依頼を取り下げる</button>' : '<span class="arc-sub">承認待ちです</span>')) :
          r.status === 'approved' ? '<button class="arc-btn" type="button" id="arc-publish">公開する（お客様が見られる）</button><button class="arc-btn arc-btn-line" type="button" id="arc-return">下書きに戻して直す</button>' :
          '<button class="arc-btn arc-btn-line" type="button" id="arc-unpublish">非公開に戻す</button>') +
        '<a class="arc-btn arc-btn-line" href="/airreach/app/report/?id=' + r.id + '">表示・PDF</a></div></form>',
        '', { client: { id: r.client_id, name: (r.clients && r.clients.name) || '' }, sec: 'reports', kicker: '月次レポート' });

      if (!editable) {
        Array.prototype.forEach.call(root.querySelectorAll('#arc-report-form [data-concl], #arc-report-form [data-next-title], #arc-report-form [data-next-owner], #arc-report-form [data-next-due], #arc-decisions, [data-pick-todo]'), function (el) { el.disabled = true; });
      }
      // 候補の「次の3施策に入れる」: 空いている最初の欄に直し方を入れる
      Array.prototype.forEach.call(root.querySelectorAll('[data-pick-todo]'), function (b) {
        b.addEventListener('click', function () {
          var slot = [0, 1, 2].map(function (i) { return $('[data-next-title="' + i + '"]'); }).filter(function (el) { return !el.value.trim(); })[0];
          if (!slot) { msg('次の3施策は埋まっています。入れ替える場合は欄を空にしてください。', 'error'); return; }
          slot.value = b.getAttribute('data-pick-todo');
          slot.focus();
          b.disabled = true; b.textContent = '入れました';
        });
      });

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
      // 状態だけを変える（中身は送らない）。決まりは DB のトリガが守る
      function setStatus(extra, done) {
        return sb.from('reports').update(Object.assign({ updated_by: me.email }, extra)).eq('id', r.id).then(function (res) { q(res); })
          .then(function () { return reportEditor(rid); }).then(function () { msg(done, 'ok'); }).catch(fail);
      }
      var pub = $('#arc-publish');
      if (pub) pub.addEventListener('click', function () {
        if (flow) { setStatus({ status: 'published' }, '公開しました'); return; }
        var c = collect();
        if (!c.conclusions.length) { msg('公開する前に、結論を1つ以上書いてください', 'error'); return; }
        save({ status: 'published', published_at: new Date().toISOString() }).then(function () { return reportEditor(rid); }).then(function () { msg('公開しました', 'ok'); }).catch(fail);
      });
      var sub = $('#arc-submit');
      if (sub) sub.addEventListener('click', function () {
        var c = collect();
        if (!c.conclusions.length) { msg('確認を依頼する前に、結論を1つ以上書いてください', 'error'); return; }
        if (!c.next_actions.length) { msg('確認を依頼する前に、次にやる施策を1つ以上書いてください', 'error'); return; }
        save({ status: 'in_review', review_note: null }).then(function () { return reportEditor(rid); }).then(function () { msg('確認を依頼しました（承認されるまで、お客様には見えません）', 'ok'); }).catch(fail);
      });
      var apv = $('#arc-approve');
      if (apv) apv.addEventListener('click', function () { setStatus({ status: 'approved' }, '承認しました。「公開する」でお客様に見えるようになります'); });
      var ret = $('#arc-return');
      if (ret) ret.addEventListener('click', function () {
        var note = $('#arc-review-note') ? $('#arc-review-note').value.trim() : '';
        if (r.status === 'in_review' && !note) { msg('差し戻す理由を書いてください', 'error'); return; }
        setStatus({ status: 'draft', review_note: note || null }, r.status === 'in_review' ? '差し戻しました' : '下書きに戻しました（直したら、もう一度確認と承認が必要です）');
      });
      var wd = $('#arc-withdraw');
      if (wd) wd.addEventListener('click', function () { setStatus({ status: 'draft', review_note: null }, '依頼を取り下げました'); });
      var unpub = $('#arc-unpublish');
      if (unpub) unpub.addEventListener('click', function () {
        if (flow) { setStatus({ status: 'draft', review_note: null }, '非公開に戻しました（もう一度公開するには、確認と承認が必要です）'); return; }
        save({ status: 'draft', published_at: null }).then(function () { return reportEditor(rid); }).then(function () { msg('非公開に戻しました', 'ok'); }).catch(fail);
      });
    });
  }

  boot();
})();
