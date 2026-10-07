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
  var PROVIDER_LABEL = { openai: 'ChatGPT', chatgpt_search: 'ChatGPT（検索あり）', gemini: 'Gemini', claude: 'Claude', perplexity: 'Perplexity', google_aio: 'Google AI による概要', google_ai_mode: 'Google AI モード' };
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
  // 共同会社の人（自社の顧客だけを見られる）なら、その会社 { id, name }。社内・お客様・共同会社の migration の前は null
  function partnerOrg() { return me && me.is_staff && me.is_internal === false ? (me.org || { name: '共同会社' }) : null; }
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
  // 日時は日本時間の日付で出す（assets/js/airreach-report.js の jstDay）
  function day(v) { return window.AirReachReport && window.AirReachReport.jstDay ? window.AirReachReport.jstDay(v) : String(v || '').slice(0, 10); }
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
        // ログインの状態が本当に変わったときだけ画面を作り直す。トークンの自動更新・同じ人の再ログインでは作り直さない（入力中の文章を消さない）
        sb.auth.onAuthStateChange(function (ev, session) {
          if (ev === 'TOKEN_REFRESHED' || ev === 'INITIAL_SESSION' || ev === 'USER_UPDATED') return;
          if (ev === 'SIGNED_IN' && me && session && session.user && session.user.email === me.email) return;
          var g = leaveGuard; leaveGuard = null; dirtyCheck = null;
          Promise.resolve(g ? g() : null).then(function () { route(); });
        });
        return route();
      })
      .catch(function (e) { root.innerHTML = '<div class="arc-card"><p>' + esc(e.message) + '</p></div>'; });
  }

  function renderLogin() {
    root.innerHTML =
      '<div class="arc-card arc-login">' +
      '<div class="arc-login-co">株式会社Trillion Bank</div>' +
      '<h1 class="arc-h1">AirReach ログイン</h1>' +
      '<p class="arc-lead">登録されたメールアドレスを入力してください。ログイン用のリンクをお送りします。</p>' +
      '<form id="arc-login-form"><label class="arc-label" for="arc-email">メールアドレス</label>' +
      '<input id="arc-email" class="arc-input" type="email" autocomplete="email" required>' +
      '<button class="arc-btn" type="submit">ログインリンクを送る</button></form>' +
      '<p id="arc-msg" class="arc-msg" hidden aria-live="polite"></p></div>' +
      '<p class="arc-login-foot">© 株式会社Trillion Bank · <a href="/trillionbank/privacy/">プライバシーポリシー</a></p>';
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
  // 見出しは共通メニューの名前に合わせる
  if (window.AirReachNav) Object.keys(SEC_LABEL).forEach(function (k) { var it = window.AirReachNav.item(k); if (it && k !== 'home') SEC_LABEL[k] = it.label; });
  function secLead(k) { var it = window.AirReachNav && window.AirReachNav.item(k); return it && it.lead ? it.lead : ''; }
  // 左のメニューは Studio と共通（assets/js/airreach-nav.js）。ダッシュボードの節は同じページの中で、Studio の画面は Studio を開く
  function sideHtml(ctx) {
    var N = window.AirReachNav, cl = ctx.client;
    if (!N) return '';
    var head = cl ? '<a class="arc-side-back" href="#/">← 顧客一覧</a>' : '';
    var curLabel = '';
    var items = N.groups(!!cl).map(function (g) {
      return '<div class="arc-side-g">' + esc(g.group) + '</div>' + g.items.map(function (it) {
        var on = it.where === 'dash' && ctx.sec === it.sec;
        if (on) curLabel = it.label;
        var url = N.href(it, cl);
        if (it.where === 'dash') url = url.replace('/airreach/app/', ''); // 同じページの中は # だけで移る
        var n = N.num ? N.num(it, !!cl) : '';
        var badge = it.sec === 'reports' && ctx.reportBadge ? '<span class="arc-side-b">' + esc(ctx.reportBadge) + '</span>' : '';
        return '<a class="arc-side-i' + (on ? ' is-on' : '') + (it.where === 'studio' ? ' is-studio' : '') + '" href="' + esc(url) + '"' + (on ? ' aria-current="page"' : '') + '><span class="arc-side-n' + (n ? '' : ' is-blank') + '" aria-hidden="' + (n ? 'false' : 'true') + '">' + esc(n || '・') + '</span><span class="arc-side-l">' + esc(it.label) + (it.desc ? '<small>' + esc(it.desc) + '</small>' : '') + '</span>' + badge + '</a>';
      }).join('');
    }).join('');
    // スマートフォン：顧客名と、いまの画面を常に出し、メニューは押すと縦に開く（横スクロールで現在地が隠れない）
    var mob = '<div class="arc-side-m"><span class="arc-side-m-t">' + (cl ? '<small>' + esc(cl.name) + '</small>' : '') + '<b>' + esc(ctx.mobileTitle || curLabel || (ctx.sec === 'list' ? '顧客一覧' : ctx.sec === 'review' ? '確認待ちのレポート' : '')) + '</b></span>' +
      '<button type="button" class="arc-btn-sm arc-side-m-b" aria-expanded="false" aria-controls="arc-side-list">メニュー</button></div>';
    return '<nav class="arc-side" aria-label="' + (cl ? '顧客の画面' : 'ダッシュボードの画面') + '">' + mob + '<div class="arc-side-list" id="arc-side-list">' + head + items + '</div></nav>';
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
      (staff ? '<nav class="arc-tools" aria-label="社内ツール"><a href="/airreach/sales/">営業キット</a><a href="/airreach/" target="_blank" rel="noopener">無料診断</a></nav>' : '') +
      '<span class="arc-who">' + esc(me.email) + (staff ? (partnerOrg() ? ' · <b class="arc-org">' + esc(partnerOrg().name) + '</b>' : ' · 社内') : '') + ' <button type="button" class="arc-btn-sm" id="arc-logout">ログアウト</button></span></header>' +
      '<div class="arc-shell' + (side ? '' : ' is-full') + '">' + side +
      '<div class="arc-main"><div class="arc-top"><div>' + (back ? '<a class="arc-back" href="' + back + '">← 戻る</a>' : '') +
      (ctx.kicker ? '<div class="arc-kicker">' + esc(ctx.kicker) + '</div>' : '') +
      '<h1 class="arc-h1">' + esc(title) + '</h1></div>' + (ctx.action || '') + '</div>' +
      '<p id="arc-msg" class="arc-msg" hidden aria-live="polite"></p><div id="arc-undo" class="arc-undo" hidden role="status"></div>' + bodyHtml + '</div></div>';
    $('#arc-logout').addEventListener('click', function () { sb.auth.signOut().then(function () { location.hash = ''; route(); }); });
    if (staff) bindPicker();
    // 7工程の帯は、狭い画面でも「いまここ」が見える位置まで寄せる
    Array.prototype.forEach.call(root.querySelectorAll('.arc-flow'), function (n) { var a = n.querySelector('[aria-current="step"]'); if (a && n.scrollWidth > n.clientWidth) n.scrollLeft = Math.max(0, a.offsetLeft - 16); });
    var mb = root.querySelector('.arc-side-m-b');
    if (mb) mb.addEventListener('click', function () {
      var open = mb.getAttribute('aria-expanded') !== 'true';
      mb.setAttribute('aria-expanded', String(open)); mb.textContent = open ? '閉じる' : 'メニュー';
      root.querySelector('.arc-side').classList.toggle('is-open', open);
      if (open) { var cur = root.querySelector('.arc-side-i.is-on') || root.querySelector('.arc-side-i'); if (cur) cur.focus(); }
    });
  }

  function route() {
    navClient = null; // 顧客の一覧などに戻ったら、Studio の入口は顧客なしに戻す
    leaveGuard = null; dirtyCheck = null;
    if (editorAutosave) { editorAutosave.stop(); editorAutosave = null; }
    return sb.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      if (!session) { renderLogin(); return; }
      return sb.rpc('airreach_me').then(function (r) {
        me = q(r) || {};
        // 社内の人の端末に印を付ける（無料診断の結果に「担当者向けのツール」（直す材料を作る など）を出すため）
        if (me.is_staff) { try { localStorage.setItem('airreach_staff_device_v1', '1'); } catch (e) {} }
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
  var leaveGuard = null, dirtyCheck = null, editorAutosave = null;
  window.addEventListener('hashchange', function () {
    if (!sb) return;
    var g = leaveGuard; leaveGuard = null; dirtyCheck = null;
    Promise.resolve(g ? g() : null).then(function () { window.scrollTo(0, 0); route(); });
  });
  window.addEventListener('beforeunload', function (e) { if (dirtyCheck && dirtyCheck()) { e.preventDefault(); e.returnValue = ''; } });

  // ---- 顧客一覧 --------------------------------------------------------------
  var listFilter = 'all', listQuery = '';
  function clientList() {
    var mon = thisMonth() + '-01';
    return sb.from('clients').select('*').order('name').then(function (r) {
      var rows = q(r) || [];
      if (!me.is_staff || !rows.length || !window.AirReachCharts) return [rows, null];
      // 社内: 顧客ごとに、今月の作業の状態（レポート・差し戻し・AI 計測・Google の数字・依頼）と最新の診断を集める
      var soft = function (p) { return p.then(function (x) { return x.error ? [] : (x.data || []); }, function () { return []; }); };
      return Promise.all([
        sb.from('reports').select('id,client_id,period_month,status').eq('period_month', mon),
        Promise.all(rows.map(function (c) { return sb.rpc('airreach_client_scans', { p_client_id: c.id, p_limit: 24 }).then(function (x) { return x.data || []; }, function () { return []; }); })),
        soft(sb.from('client_requests').select('client_id').eq('status', 'pending')),
        soft(sb.from('measurement_runs').select('client_id,measured_on').gte('measured_on', mon)),
        soft(sb.from('traffic_snapshots').select('client_id,source').eq('period_month', mon))
      ]).then(function (rs) {
        var reps = q(rs[0]) || [];
        var drafts = reps.filter(function (x) { return x.status === 'draft'; }).map(function (x) { return x.id; });
        return (drafts.length && approvalOn() ? soft(sb.from('report_events').select('report_id,action,created_at').in('report_id', drafts).order('created_at', { ascending: true })) : Promise.resolve([]))
          .then(function (ev) { return [rows, { reports: reps, scans: rs[1], requests: rs[2], runs: rs[3], traffic: rs[4], events: ev }]; });
      });
    }).then(function (pair) {
      var rows = pair[0], extra = pair[1], C = window.AirReachCharts, S = window.AirReachStaff;
      var list, filters = '';
      if (extra) {
        var today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
        var items = rows.filter(function (c) { return c.status !== 'ended'; }).map(function (c, i) {
          var idx = rows.indexOf(c);
          var scans = (extra.scans[idx] || []).slice().sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });
          var rep = extra.reports.filter(function (x) { return x.client_id === c.id; })[0];
          var ev = rep ? extra.events.filter(function (e) { return e.report_id === rep.id; }) : [];
          var f = S.triage({ client: c, me: me.email, month: mon, today: today, report: rep, lastEvent: ev.length ? ev[ev.length - 1].action : null,
            runsThisMonth: extra.runs.filter(function (x) { return x.client_id === c.id; }).length,
            trafficThisMonth: extra.traffic.filter(function (x) { return x.client_id === c.id; }).map(function (x) { return x.source; }),
            pendingRequests: extra.requests.filter(function (x) { return x.client_id === c.id; }).length });
          return { c: c, scans: scans, rep: rep, f: f, hasCols: Object.prototype.hasOwnProperty.call(c, 'report_due_day') };
        });
        items.sort(function (a, b) { return a.f.rank - b.f.rank || ((a.f.due ? a.f.due.daysLeft : 999) - (b.f.due ? b.f.due.daysLeft : 999)) || String(a.c.name).localeCompare(String(b.c.name), 'ja'); });
        var FIL = [['all', 'すべて', function () { return true; }], ['mine', '自分の担当', function (f) { return f.mine; }], ['due', '期限が近い・超過', function (f) { return f.dueSoon || f.overdue; }],
          ['ai', 'AI 未計測', function (f) { return f.aiMissing; }], ['google', 'Google 未取得', function (f) { return f.googleMissing; }], ['returned', '差し戻し', function (f) { return f.returned; }], ['req', '依頼あり', function (f) { return f.requests > 0; }]];
        filters = '<div class="arc-filter"><label class="arc-filter-q"><span>顧客を探す</span><input class="arc-input" type="search" id="arc-list-q" placeholder="顧客名" value="' + esc(listQuery) + '"></label>' +
          '<div class="arc-filter-b" role="group" aria-label="絞り込み">' + FIL.map(function (x) {
            var n = items.filter(function (it) { return x[2](it.f); }).length;
            return '<button type="button" class="arc-fchip" data-filter="' + x[0] + '" aria-pressed="' + (listFilter === x[0]) + '">' + esc(x[1]) + ' <b>' + n + '</b></button>';
          }).join('') + '</div></div>';
        var chip = function (cls, t) { return '<span class="arc-chip ' + cls + '">' + esc(t) + '</span>'; };
        list = '<div class="arc-clients">' + items.map(function (it) {
          var c = it.c, f = it.f, last = it.scans[it.scans.length - 1], sc = last ? last.overallScore : null, b = C.band(sc);
          var st = it.rep ? statusChip(it.rep.status, '今月: ') : chip('is-ng', '今月: 未作成');
          var tags = [
            f.overdue ? chip('is-ng', '期限 ' + f.due.label) : f.due ? chip(f.dueSoon ? 'is-warn' : '', '期限 ' + f.due.label) : chip('is-muted', it.hasCols ? '期限 未設定' : '期限 未設定（DB 更新待ち）'),
            c.owner_email ? chip(f.mine ? 'is-ok' : '', '担当 ' + (f.mine ? 'あなた' : c.owner_email.split('@')[0])) : chip('is-muted', '担当 未設定'),
            f.returned ? chip('is-ng', '差し戻し') : '', f.requests ? chip('is-warn', '依頼 ' + f.requests + '件') : '',
            f.aiMissing ? chip('is-muted', 'AI 未計測') : '', f.googleMissing ? chip('is-muted', 'Google 未取得') : ''].join('');
          var keys = ['all'].concat(FIL.slice(1).filter(function (x) { return x[2](f); }).map(function (x) { return x[0]; }));
          return '<a class="arc-client" href="#/c/' + c.id + '" data-keys="' + keys.join(' ') + '" data-name="' + esc(String(c.name).toLowerCase()) + '"><span class="arc-client-n">' + esc(c.name) + '<small>' + esc(INDUSTRY[c.industry_id] || '') + (c.status !== 'active' ? ' · ' + esc(c.status) : '') + '</small></span>' +
            '<span class="arc-client-t">' + st + tags + '</span>' +
            '<span class="arc-client-s"><span class="arc-client-sv">' + (sc == null ? '<span class="arv-na">診断なし</span>' : '<b>' + esc(sc) + '</b><small>点</small> <span class="arv-band" style="border-color:' + b.color + ';color:' + b.color + '">' + esc(b.label) + '</span>') + '</span>' + (last ? '<small>最終診断 ' + esc(day(last.createdAt)) + '</small>' : '') + '</span></a>';
        }).join('') + '<p class="arc-empty" id="arc-list-none" hidden>条件に合う顧客はありません。</p></div>';
      } else {
        list = '<ul class="arc-list">' + (rows.length ? rows.map(function (c) {
          return '<li><a href="#/c/' + c.id + '">' + esc(c.name) + '</a><span class="arc-sub">' + esc(INDUSTRY[c.industry_id] || '') + (c.status !== 'active' ? ' · ' + esc(c.status) : '') + '</span></li>';
        }).join('') : '<li class="arc-empty">' + (me.is_staff ? 'まだ顧客がありません。' : '閲覧できる顧客がありません。担当者にお問い合わせください。') + '</li>') + '</ul>';
      }
      var add = me.is_staff ?
        '<h2 class="arc-h2">顧客を追加する</h2><p class="arc-note" style="margin:0 0 6px">サイトの URL も入れると、追加したあとそのまま Studio でサイトを調べ、お客さんが知りたい情報が書いてあるかの確認と AI での見え方の計測（Perplexity・ChatGPT）まで自動で行います。お客様によく聞かれる質問を入れておくと、AI に聞く質問の先頭に入ります。</p>' +
        (partnerOrg() ? '<p class="arc-note arc-org-note">追加した顧客は「' + esc(partnerOrg().name) + '」の顧客になります。Trillion Bank のほかの顧客や、ほかの共同会社からは見えません。</p>' : '') +
        '<form id="arc-add-client" class="arc-row"><input class="arc-input" id="arc-client-name" placeholder="顧客名（会社・店舗）" required>' +
        '<input class="arc-input" id="arc-client-url" type="text" inputmode="url" autocomplete="url" placeholder="サイトの URL（例: https://example.jp/）">' +
        '<textarea class="arc-input arc-client-qs" id="arc-client-qs" rows="3" placeholder="お客様によく聞かれる質問（任意・1行に1つ）&#10;例：個室はありますか？&#10;例：子ども連れでも大丈夫ですか？"></textarea>' +
        '<select class="arc-input" id="arc-client-ind">' + Object.keys(INDUSTRY).map(function (k) { return '<option value="' + k + '">' + INDUSTRY[k] + '</option>'; }).join('') + '</select>' +
        '<button class="arc-btn" type="submit">顧客を追加</button></form>' : '';
      // 社内だけ：代理店・見込み顧客に見せるデモ（架空データ・ログイン不要）の入口
      var demo = me.is_staff ? '<details class="arc-card arc-demo"><summary class="arc-h3">代理店・見込み顧客に見せるデモ（ログイン不要・架空のお店のデータ）</summary>' +
        '<p class="arc-note" style="margin:0 0 10px">お客様向けの画面（ホーム・推移・直すこと・月次レポート・競合との比較・PDF）を、架空の美容室「サンプル美容室 Hana」で操作できます。本番のお客様のデータには一切つながりません。</p>' +
        '<div class="arc-row"><a class="arc-btn" href="/airreach/demo/" target="_blank" rel="noopener">デモを開く</a><button type="button" class="arc-btn-sm" id="arc-demo-copy">URL をコピー</button><code class="arc-demo-url">https://trillion-bank.jp/airreach/demo/</code></div></details>' : '';
      shell(me.is_staff ? '顧客一覧' : 'レポート', '<section class="arc-card">' + filters + list + '</section>' + (me.is_staff ? '<section class="arc-card">' + add + '</section>' : '') + demo, '', { sec: 'list' });
      // 絞り込み（名前・条件）。表示を切り替えるだけで、データは読み直さない
      function applyFilter() {
        var shown = 0, qv = listQuery.trim().toLowerCase();
        Array.prototype.forEach.call(root.querySelectorAll('.arc-client'), function (a) {
          var ok = (' ' + a.getAttribute('data-keys') + ' ').indexOf(' ' + listFilter + ' ') >= 0 && (!qv || a.getAttribute('data-name').indexOf(qv) >= 0);
          a.hidden = !ok; if (ok) shown++;
        });
        var none = $('#arc-list-none'); if (none) none.hidden = shown > 0;
        Array.prototype.forEach.call(root.querySelectorAll('[data-filter]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-filter') === listFilter)); });
      }
      if ($('#arc-list-q')) {
        $('#arc-list-q').addEventListener('input', function (e) { listQuery = e.target.value; applyFilter(); });
        Array.prototype.forEach.call(root.querySelectorAll('[data-filter]'), function (b) { b.addEventListener('click', function () { listFilter = b.getAttribute('data-filter'); applyFilter(); }); });
        applyFilter();
      }
      if (me.is_staff && $('#arc-demo-copy')) $('#arc-demo-copy').addEventListener('click', function () {
        var b = $('#arc-demo-copy'), u = 'https://trillion-bank.jp/airreach/demo/';
        (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(u) : Promise.reject()).then(function () { b.textContent = 'コピーしました'; setTimeout(function () { b.textContent = 'URL をコピー'; }, 1500); }, function () { b.textContent = 'コピーできませんでした（URL を選んでコピーしてください）'; });
      });
      if (me.is_staff) $('#arc-add-client').addEventListener('submit', function (e) {
        e.preventDefault();
        var name = $('#arc-client-name').value.trim(), ind = $('#arc-client-ind').value, rawUrl = $('#arc-client-url').value.trim();
        // お客様によく聞かれる質問は、Studio の「AI での見え方を測る」の質問の先頭に入る（Studio が開いたときに受け取る）
        var qs = $('#arc-client-qs').value.split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 10);
        var site = null;
        if (rawUrl) {
          try { var u0 = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : 'https://' + rawUrl); site = { url: u0.origin + '/', host: u0.hostname.replace(/^www\./, '').toLowerCase() }; }
          catch (e2) { return fail(new Error('サイトの URL の形が正しくありません（例: https://example.jp/）')); }
        }
        sb.from('clients').insert({ name: name, industry_id: ind, created_by: me.email }).select('id,name,industry_id').single()
          .then(function (res) {
            var c = q(res);
            if (qs.length) { try { localStorage.setItem('airreach_customer_qs_v1:' + c.id, JSON.stringify(qs)); } catch (e3) {} }
            if (!site) return clientList();
            // サイトを登録して、Studio でそのまま調べ始める（分析 → 足りない情報 → AI での見え方）
            return sb.from('client_sites').insert({ client_id: c.id, url: site.url, host: site.host }).then(function (r2) {
              q(r2);
              var h = studioHref(c, [site]);
              location.href = h + (h.indexOf('?') >= 0 ? '&' : '?') + 'auto=1#start';
            });
          }).catch(fail);
      });
    });
  }

  // ---- 顧客（メンバー向け）: 公開済みレポートの一覧 ----------------------------
  function clientMember(id) {
    return Promise.all([
      sb.from('clients').select('id,name').eq('id', id).maybeSingle(),
      sb.from('reports').select('id,period_month,published_at,conclusions,next_actions,client_decisions,compiled').eq('client_id', id).eq('status', 'published').order('period_month', { ascending: false }),
      sb.from('client_sites').select('url').eq('client_id', id)
    ]).then(function (rs) {
      var c = q(rs[0]); var reps = q(rs[1]) || [], sites = rs[2].data || [];
      if (!c) throw new Error('この顧客は表示できません');
      var C = window.AirReachCharts, top = reps[0], body = '';
      if (top && C) {
        // 最新の公開レポート：結論 → 数字（小さく・内訳は開く）→ ご判断いただきたいこと → 次にやること → 依頼の入口
        body += clientLatest(top) + clientNumbers(top) + decisionCard(top) + nextCard(top, true) + reqEntry();
      } else body += reqEntry();
      body += '<section class="arc-card"><h2 class="arc-h2">これまでのレポート</h2><ul class="arc-list arc-replist">' +
        (reps.length ? reps.map(function (r) { return '<li><a href="/airreach/app/report/?id=' + r.id + '">' + esc(ymJa(r.period_month)) + ' のレポート</a>' + (r.published_at ? '<span class="arc-sub">公開 ' + esc(day(r.published_at)) + '</span>' : '') + '</li>'; }).join('') : '<li class="arc-empty">公開済みのレポートはまだありません。</li>') +
        '</ul></section>' +
        (top && C ? '<details class="arc-card arc-more-card"><summary class="arc-h2">推移と直すこと（詳しく）</summary>' +
          '<section class="arc-sub-sec"><h3 class="arc-h3">推移（直近6か月）</h3>' + C.trends(top.compiled || {}) + '</section>' +
          todoCard(window.AirReachReport ? window.AirReachReport.todoList(top.compiled || {}) : [], top.compiled || {}, 'client') + '</details>' : '') +
        '<div id="arc-rq"></div>';
      // 見られる顧客が1社だけなら「戻る」は出さない（一覧に戻っても、この画面に戻されるため）
      shell(c.name, body, (me.client_ids || []).length > 1 ? '#/' : '', { client: { id: c.id, name: c.name } });
      var pr = mountRequests(c.id, sites, false, c.name);
      // 依頼の入口：確認待ちの件数を出し、押すと下の依頼の欄へ移る
      var go = root.querySelector('[data-go-rq]');
      if (go) go.addEventListener('click', function () { var t = $('#arq') || $('#arc-rq'); if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'start' }); var h = t.querySelector('h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } } });
      if (pr && pr.then) pr.then(function (x) {
        var n = root.querySelector('[data-rq-count]');
        if (!x) { var e = root.querySelector('.arc-rqentry'); if (e) e.hidden = true; return; }
        if (n) n.textContent = x.pending ? 'ご依頼 ' + x.pending + '件が確認待ち' : '足したい・外したいものがあれば依頼できます';
        if (n) n.className = x.pending ? 'is-wait' : '';
      });
    });
  }
  // お客様のホームの部品は assets/js/airreach-client-home.js（代理店向けデモと共通）
  function clientLatest(r) { return window.AirReachClientHome.latest(r); }
  function clientNumbers(r) { return window.AirReachClientHome.numbers(r); }
  function decisionCard(r) { return window.AirReachClientHome.decision(r); }
  function reqEntry() {
    return '<section class="arc-card arc-rqentry"><button type="button" class="arc-rqentry-b" data-go-rq><span><b>AI で比べる競合・調べる言葉・質問</b><small data-rq-count>読み込んでいます…</small></span><span aria-hidden="true">下へ ↓</span></button></section>';
  }
  // 競合・キーワード・質問の依頼（assets/js/airreach-requests.js）。DB が未適用なら顧客には何も出さない
  function mountRequests(clientId, sites, staff, clientName) {
    var box = $('#arc-rq');
    if (!box || !window.AirReachRequests) return null;
    return window.AirReachRequests.mount(box, { sb: sb, clientId: clientId, staff: staff, brand: clientName || '', email: me && me.email, selfHosts: (sites || []).map(function (s) { return s.url; }), onMsg: msg });
  }
  /**
   * 今月の進め方：毎月の7工程を左のメニューと同じ名前で並べ、どこまで済んだかと「次にやること」（理由つき）を出す（社内向けホーム）。
   * 済み／まだ は登録された材料から判定する（手で付けるチェックは持たない）。
   * 「直す材料を作る」は、今月登録した施策の予定で判定する（前月から残った予定は持ち越しとして数えるだけ。お客様へ渡したかは記録が無いので判定しない）
   */
  function monthPlan(c, sites, live, repNow, actions, lastEvent) {
    var studio = studioHref(c, sites), base = '#/c/' + c.id + '/', mon = thisMonth();
    var cur = live.site.current, tr = live.traffic;
    var mat = window.AirReachStaff.materialsStep(actions, mon);
    var rs = repNow ? repNow.status : '';
    var md = function (d) { return String(d).slice(5, 10).replace('-', '/'); };
    var returned = rs === 'draft' && lastEvent === 'returned';
    var steps = [
      { title: 'サイトを調べる', what: 'URL を確かめて「分析する」を押すだけ', time: '約1分',
        why: cur ? '今月の診断がありません（最新は ' + md(day(cur.createdAt)) + '）' : 'まだ診断していません',
        ok: !!(cur && cur.inMonth), note: cur && cur.inMonth ? md(day(cur.createdAt)) + ' 診断' : '', btn: '分析する', href: studio + '#start' },
      { title: '直す材料を作る', what: 'よくある質問・お店の情報の下書きを作り、施策の予定として登録する', time: '約10分',
        why: '今月の施策の予定がまだ登録されていません' + (mat.carry ? '（前月からの持ち越し ' + mat.carry + '件は数えません）' : ''),
        ok: mat.ok, okLabel: mat.doneLabel, note: mat.note, btn: '直す材料を作る', href: studio + '#generator' },
      { title: 'AI での見え方を測る', what: '質問を確かめて「計測する」を押す', time: '約2分',
        why: '今月の AI 計測がありません', ok: !!live.ai, note: live.ai ? md(live.ai.measuredOn) + ' 計測' : '', btn: '計測する', href: studio + '#hack2' },
      { title: '検索と訪問の数字を入れる', what: 'Google と連携していれば月を選ぶだけ', time: '約3分',
        why: !tr.gsc && !tr.ga4 ? '今月の Search Console・GA4 の数字がありません' : !tr.gsc ? '今月の Search Console の数字がありません' : '今月の GA4 の数字がありません',
        ok: !!(tr.gsc && tr.ga4), partial: !!(tr.gsc || tr.ga4) && !(tr.gsc && tr.ga4), note: tr.gsc || tr.ga4 ? (tr.gsc ? 'Search Console ✓' : 'Search Console まだ') + '・' + (tr.ga4 ? 'GA4 ✓' : 'GA4 まだ') : '', btn: '取り込む', href: base + 'traffic' },
      { title: 'やったことを記録する', what: '直したことを「実施済み」にして、公開したページの URL を入れる', time: '約3分',
        why: '今月「実施済み」にした施策がありません', ok: live.actions.length > 0, note: live.actions.length ? live.actions.length + '件' : '', btn: '記録する', href: base + 'actions' },
      { title: '月次レポートを作る', what: '結論と次の施策を書いて、確認を依頼する', time: '約15分',
        why: !repNow ? '今月のレポートがまだありません' : returned ? '差し戻されています。直して、もう一度確認を依頼してください' : '下書きのままです（確認を依頼していません）',
        ok: rs === 'in_review' || rs === 'approved' || rs === 'published', note: repNow ? (REPORT_STATUS[rs] || [rs])[0] + (returned ? '・差し戻し' : '') : '',
        btn: !repNow ? 'レポートを作る' : rs === 'draft' ? '続きを書く' : '開く', href: repNow ? '#/r/' + repNow.id : base + 'reports' },
      { title: 'お客様に公開する', what: '承認されたレポートを公開する（お客様の画面と PDF に出る）', time: '約1分',
        why: rs === 'approved' ? '承認済みです。公開するとお客様が見られます' : rs === 'in_review' ? '承認を待っています' : '承認されたら公開します',
        ok: rs === 'published', note: '', btn: rs === 'approved' ? '公開する' : '開く', href: repNow ? '#/r/' + repNow.id : base + 'reports' }
    ];
    var doneN = steps.filter(function (s) { return s.ok; }).length;
    var nextI = -1; steps.some(function (s, i) { if (!s.ok) { nextI = i; return true; } return false; });
    return { steps: steps, doneN: doneN, nextI: nextI, next: nextI >= 0 ? steps[nextI] : null, returned: returned, mon: mon };
  }
  /**
   * 作業画面の上に出す「今月の7工程」の帯：済み（✓）・次・途中・いまここ を並べ、どの工程にも1回で移れる
   * cur: いま開いている工程の番号（0 始まり）
   */
  function flowStrip(plan, cur) {
    if (!plan) return '';
    return '<nav class="arc-flow" aria-label="今月の7工程"><ol>' + plan.steps.map(function (s, i) {
      var here = i === cur;
      var st = here ? 'いまここ' : s.ok ? '✓' : i === plan.nextI ? '次' : s.partial ? '途中' : '';
      var cls = here ? ' is-here' : s.ok ? ' is-ok' : i === plan.nextI ? ' is-next' : s.partial ? ' is-part' : '';
      return '<li><a class="arc-flow-i' + cls + '" href="' + esc(s.href) + '"' + (here ? ' aria-current="step"' : '') + '><span class="arc-flow-k">' + (i + 1) + (st ? (here ? ' · ' : ' ') + st : '') + '</span><span class="arc-flow-l">' + esc(s.title) + '</span></a></li>';
    }).join('') + '</ol><span class="arc-flow-p">' + plan.doneN + ' / ' + plan.steps.length + ' 済み</span></nav>';
  }
  function monthSteps(plan) {
    var steps = plan.steps, nextI = plan.nextI;
    var list = '<ol class="arc-msteps">' + steps.map(function (s, i) {
      var st = s.ok ? 'is-ok' : i === nextI ? 'is-next' : '';
      return '<li class="arc-mstep ' + st + '"><span class="arc-mstep-n" aria-hidden="true">' + (s.ok ? '✓' : i + 1) + '</span>' +
        '<div class="arc-mstep-b"><b>' + (i + 1) + '. ' + esc(s.title) + '</b><span>' + esc(s.what) + '</span></div>' +
        '<div class="arc-mstep-s"><span class="arc-mstep-st">' + (s.ok ? '✓ ' + esc(s.okLabel || '済み') : i === nextI ? '次はここ' : 'まだ') + (s.note ? '<small>' + esc(s.note) + '</small>' : '') + '</span>' +
        '<a class="arc-btn-sm" href="' + esc(s.href) + '">' + esc(s.ok ? '見る' : s.btn) + '</a></div></li>';
    }).join('') + '</ol>';
    return '<section class="arc-card" id="arc-steps"><div class="arv-home-head"><div><h2 class="arc-h2">' + esc(ymJa(plan.mon + '-01')) + 'の7工程</h2>' +
      '<p class="arc-note" style="margin:2px 0 0">左のメニューの番号と同じです。✓ は登録された材料から自動で付きます。</p></div>' +
      '<span class="arc-progress"><small>進み具合</small><b>' + plan.doneN + ' / ' + steps.length + '</b></span></div>' + list + '</section>';
  }
  /**
   * ホームの最上部：顧客名・対象月・次にやる作業（理由）・期限・未完了の工程・確認待ちの依頼・レポートの状態。
   * 担当・期限は顧客の設定（未設定は「未設定」と出す。架空の担当・期限は作らない）
   */
  function todayCard(c, plan, repNow, pendingReq, me2) {
    var S = window.AirReachStaff, next = plan.next, nextI = plan.nextI;
    var hasCols = Object.prototype.hasOwnProperty.call(c, 'report_due_day');
    var due = hasCols ? S.dueOf(c.report_due_day, plan.mon + '-01', new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)) : null;
    var dueTxt = due ? due.label : (hasCols ? '未設定' : '未設定（DB の更新待ち）');
    var owner = hasCols ? (c.owner_email ? (c.owner_email === me2 ? 'あなた' : c.owner_email.split('@')[0]) : '未設定') : '未設定（DB の更新待ち）';
    var main = next
      ? '<div class="arc-today-next"><div class="arc-next-k">次にやること（' + (nextI + 1) + ' / 7）</div><div class="arc-next-t">' + (nextI + 1) + '. ' + esc(next.title) + '</div>' +
        '<div class="arc-next-d">' + esc(next.why) + '</div></div><a class="arc-btn arc-next-b" href="' + esc(next.href) + '">' + esc(next.btn) + ' →</a>'
      : '<div class="arc-today-next"><div class="arc-next-k">今月の作業</div><div class="arc-next-t">✓ 7工程すべて済みました</div><div class="arc-next-d">来月の初めに、また「サイトを調べる」から始めます。</div></div>';
    var cell = function (k, v, extra) { return '<div class="arc-today-c"><span>' + k + '</span><b>' + v + '</b>' + (extra || '') + '</div>'; };
    return '<section class="arc-card arc-today" aria-labelledby="arc-today-h"><div class="arc-today-h" id="arc-today-h">' + esc(ymJa(plan.mon + '-01')) + 'の作業 · ' + esc(c.name) + '</div>' +
      '<div class="arc-today-main' + (next ? '' : ' is-done') + '">' + main + '</div>' +
      '<div class="arc-today-grid">' +
        cell('報告の期限', esc(dueTxt), due && due.daysLeft <= 3 ? '' : '') +
        cell('担当', esc(owner)) +
        cell('残りの工程', (7 - plan.doneN) + ' <small>/ 7</small>', '<a href="#arc-steps">7工程を見る</a>') +
        cell('お客様からの依頼', pendingReq == null ? '—' : pendingReq + '<small>件 確認待ち</small>', pendingReq ? '<a href="#arq">依頼を見る</a>' : '') +
        cell('今月のレポート', repNow ? statusChip(repNow.status) + (plan.returned ? ' <span class="arc-chip is-ng">差し戻し</span>' : '') : '<span class="arc-chip is-ng">未作成</span>', repNow ? '<a href="#/r/' + repNow.id + '">開く</a>' : '') +
      '</div></section>';
  }
  /** ホームの数字（小さく1行）。AI 別などの内訳は「詳しく見る」で開く */
  function compactNumbers(live, month) {
    var S = window.AirReachStaff, cur = live.site.current, ai = live.ai, tr = live.traffic || {};
    var item = function (k, v, sub) { return '<div class="arc-num"><span>' + k + '</span><b>' + v + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; };
    var traffic = function (rec, key, unit) {
      if (!rec || rec[key] == null) return item(key === 'clicks' ? '検索からのクリック' : '問い合わせ・予約', '<span class="arv-na">未計測</span>');
      var P = S.periodOf(rec, month);
      return item(key === 'clicks' ? '検索からのクリック' : '問い合わせ・予約', esc(rec[key]) + '<small>' + unit + '</small>', esc(P ? P.short : ''));
    };
    return '<div class="arc-nums">' +
      item('情報整備', cur && cur.overall != null ? esc(cur.overall) + '<small>点</small>' : '<span class="arv-na">未計測</span>', cur ? esc(day(cur.createdAt)) + ' の診断' + (cur.inMonth ? '' : '（今月はまだ）') : '') +
      item('AI 計測', ai ? esc(ai.runs || 1) + '<small>回</small>' : '<span class="arv-na">未計測</span>', ai ? '最新 ' + esc(String(ai.measuredOn || '').slice(5).replace('-', '/')) + '・' + esc(ai.providers.length) + '種類' : '') +
      traffic(tr.gsc, 'clicks', '回') + traffic(tr.ga4, 'conversions', '件') + '</div>';
  }

  /** ダッシュボード：AI での見え方（最新の計測の内訳。一般/指名・言及の順位） */
  function dashAi(run, live, studio) {
    var md = function (d) { return String(d).slice(5, 10).replace('-', '/'); };
    var bd = run && run.summary && run.summary.breakdown;
    var head = '<div class="arv-home-head"><h2 class="arc-h2">AI での見え方</h2><span class="arc-sub">' + (run ? '最新1回（' + esc(md(run.measured_on)) + '）の計測' + (bd && bd.types ? '・' + esc((bd.types.general.answers || 0) + (bd.types.branded.answers || 0)) + '回答' : '') : '') + '</span></div>';
    var more = '<a class="arc-dash-more" href="' + esc(studio + '#hack2') + '">' + (run ? '質問ごとの結果を見る →' : 'AI で測る →') + '</a>';
    if (!run) return '<section class="arc-card arc-dash-c">' + head + '<p class="arc-empty">まだ計測していません。質問を AI に聞くと、お客様の名前やサイトが回答に出るかが分かります。</p>' + more + '</section>';
    var body = '';
    var pctv = function (v) { return v == null ? '—' : esc(v) + '%'; };
    if (bd && bd.types) {
      var t = function (label, x, hint) {
        return '<div class="arc-dash-type"><div class="arc-dash-type-h"><b>' + label + '</b><small>' + esc(x.answers || 0) + '回答・' + hint + '</small></div>' +
          '<div class="arc-dash-kv"><span>名前が出た</span><b>' + pctv(x.mentionRate) + '</b></div>' +
          '<div class="arc-dash-kv"><span>自社サイトが出典</span><b>' + pctv(x.citeRate) + '</b></div></div>';
      };
      body += '<div class="arc-dash-types">' + t('一般質問', bd.types.general, '名前を入れずに聞いた') + t('指名質問', bd.types.branded, '名前を入れて聞いた') + '</div>';
      if (bd.ranks && bd.ranks.length) {
        body += '<table class="arc-dash-rank"><thead><tr><th>名前</th><th>1番目に出た</th><th>回答に出た</th></tr></thead><tbody>' + bd.ranks.slice(0, 4).map(function (r) {
          var all = r.first + r.second + r.thirdPlus + r.none;
          return '<tr' + (r.self ? ' class="is-self"' : '') + '><td>' + esc(r.name) + (r.self ? ' <small>自社</small>' : '') + '</td><td>' + esc(r.first) + '回</td><td>' + esc(r.first + r.second + r.thirdPlus) + ' / ' + esc(all) + '</td></tr>';
        }).join('') + '</tbody></table>';
      }
    } else if (live && live.ai) {
      body += '<div class="arc-dash-types">' + live.ai.providers.map(function (p) {
        return '<div class="arc-dash-type"><div class="arc-dash-type-h"><b>' + esc(PROVIDER_LABEL[p.provider] || p.provider) + '</b><small>' + esc(p.answers || 0) + '回答</small></div>' +
          '<div class="arc-dash-kv"><span>名前が出た</span><b>' + pctv(p.mentionRate) + '</b></div>' +
          '<div class="arc-dash-kv"><span>自社サイトが出典</span><b>' + pctv(p.citeRate) + '</b></div></div>';
      }).join('') + '</div>';
    } else body += '<p class="arc-empty">この計測の結果を読めませんでした。</p>';
    return '<section class="arc-card arc-dash-c">' + head + body + more + '</section>';
  }
  /** ダッシュボード：AI が参照したサイト（引用元の分類と上位） */
  function dashSources(run, studio) {
    var bd = run && run.summary && run.summary.breakdown;
    var CAT = { self: ['自社', '#2563eb'], comp: ['競合', '#f59e0b'], sns: ['SNS', '#8b5cf6'], portal: ['口コミ・予約・まとめ', '#14b8a6'], other: ['その他', '#94a3b8'] };
    var head = '<div class="arv-home-head"><h2 class="arc-h2">AI が参照したサイト</h2><span class="arc-sub">回答の出典になったサイト</span></div>';
    if (!bd || !bd.categories || !bd.domains || !bd.domains.length) return '<section class="arc-card arc-dash-c">' + head + '<p class="arc-empty">出典が分かる計測がまだありません（Perplexity で測ると出典まで分かります）。</p></section>';
    var keys = Object.keys(CAT).filter(function (k) { return bd.categories[k] && bd.categories[k].count; });
    var bar = '<div class="arc-dash-stack" aria-hidden="true">' + keys.map(function (k) { return '<i style="width:' + (bd.categories[k].share || 0) + '%;background:' + CAT[k][1] + '"></i>'; }).join('') + '</div>' +
      '<ul class="arc-dash-legend">' + keys.map(function (k) { return '<li><span class="arv-key" style="background:' + CAT[k][1] + '"></span>' + CAT[k][0] + ' <b>' + esc(bd.categories[k].share) + '%</b></li>'; }).join('') + '</ul>';
    var top = '<ol class="arc-dash-dom">' + bd.domains.slice(0, 5).map(function (d) {
      return '<li><span>' + esc(d.host) + '</span><small style="color:' + (CAT[d.cat] || CAT.other)[1] + '">' + esc((CAT[d.cat] || CAT.other)[0]) + '</small><b>' + esc(d.answers) + '回答</b></li>';
    }).join('') + '</ol>';
    return '<section class="arc-card arc-dash-c">' + head + bar + top + '<a class="arc-dash-more" href="' + esc(studio + '#hack2') + '">すべての出典を見る →</a></section>';
  }
  /** ダッシュボード：直すこと（上位3件） */
  function dashTodos(items, compiled, studio) {
    var C = window.AirReachCharts, cur = compiled && compiled.site && compiled.site.current;
    var head = '<div class="arv-home-head"><h2 class="arc-h2">直すこと' + (items && items.length ? '<small class="arc-sub"> 全' + items.length + '件</small>' : '') + '</h2>' + (cur ? '<span class="arc-sub">' + esc(day(cur.createdAt)) + ' の診断から・優先度の高い順</span>' : '') + '</div>';
    if (!C || !cur) return '<section class="arc-card arc-dash-c">' + head + '<p class="arc-empty">まだ診断していません。サイトを調べると、直すべきところが優先度の順に出ます。</p><a class="arc-dash-more" href="' + esc(studio + '#start') + '">サイトを調べる →</a></section>';
    return '<section class="arc-card arc-dash-c">' + head + C.todos(items.slice(0, 3), { audience: 'staff', studioHref: studio + '#generator' }) +
      (items.length > 3 ? '<a class="arc-dash-more" href="' + esc(studio + '#gaps') + '">残り ' + (items.length - 3) + '件を見る →</a>' : '') + '</section>';
  }

  function todoCard(items, compiled, audience, studioHref) {
    var C = window.AirReachCharts, cur = compiled && compiled.site && compiled.site.current;
    if (!C || !cur) return '';
    return '<section class="arc-card"><div class="arv-home-head"><h2 class="arc-h2">直すこと' + (items.length ? '（' + items.length + '件）' : '') + '</h2>' +
      '<span class="arc-sub">' + esc(day(cur.createdAt)) + ' の診断で見つかった不足・優先度の高い順</span></div>' +
      (audience === 'client' && items.length > 5
        ? C.todos(items.slice(0, 5), { audience: audience }) + '<details class="arc-more"><summary>残り ' + (items.length - 5) + '件をすべて表示</summary>' + C.todos(items.slice(5), { audience: audience, start: 5 }) + '</details>'
        : C.todos(items, { audience: audience, studioHref: studioHref })) + '</section>';
  }
  // お客様のホーム: 最新の公開レポートの「次にやる3施策」と「ご判断いただきたいこと」
  function nextCard(r, noDecisions) {
    var next = r.next_actions || [], dec = noDecisions ? [] : (r.client_decisions || []);
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
    var cl = { id: c.id, name: c.name || '', site: sites && sites[0] ? sites[0].url : '', industry: c.industry_id || c.industry || '' };
    return window.AirReachStaff ? window.AirReachStaff.studioLink(cl) : window.AirReachNav.studioBase(cl);
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
    return '<section class="arc-card arc-studio-in"><h2 class="arc-h2">まだ保存していない AI計測があります（' + esc(d.measuredOn) + '）</h2>' +
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
    return '<section class="arc-card arc-studio-in"><h2 class="arc-h2">「直す材料を作る」の下書きから、施策の候補が ' + d.items.length + '件あります</h2>' +
      '<p class="arc-note">' + esc(localTime(d.createdAt)) + ' に ' + esc(d.url || '') + ' の下書きを作成。登録すると「実施した施策」に<b>予定</b>として入り、実施したら日付と証拠のURLを入れて「実施済み」にします。</p>' +
      '<ul class="arc-list">' + d.items.map(function (it, i) {
        return '<li><label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" data-studio-item="' + i + '" checked><span>' + esc(it.title) + (it.file ? '<span class="arc-sub">（' + esc(it.file) + '）</span>' : '') + '</span></label></li>';
      }).join('') + '</ul>' +
      '<div class="arc-row"><button type="button" class="arc-btn" id="arc-studio-add">選んだものを予定として登録</button><button type="button" class="arc-btn arc-btn-line" id="arc-studio-discard">登録しない</button></div></section>';
  }

  // ---- 担当と報告の期限（顧客一覧の「自分の担当」「期限が近い」に使う）--------------------------
  function ownerDueBlock(c, staffList) {
    var hasCols = Object.prototype.hasOwnProperty.call(c, 'report_due_day');
    if (!hasCols) return '<section class="arc-card" id="arc-owner" style="margin-top:16px"><h2 class="arc-h2">担当と報告の期限</h2><p class="arc-note">担当と毎月の報告期限を保存するには、DB の更新（migration 20261007180000）が必要です。それまでは顧客一覧で「未設定」と表示します。</p></section>';
    var opts = '<option value="">未設定</option>' + staffList.map(function (x) { return '<option value="' + esc(x.email) + '"' + (c.owner_email === x.email ? ' selected' : '') + '>' + esc(x.name || x.email) + '</option>'; }).join('');
    return '<section class="arc-card" id="arc-owner" style="margin-top:16px"><h2 class="arc-h2">担当と報告の期限</h2>' +
      '<form id="arc-owner-form" class="arc-row arc-labeled"><label class="arc-field"><span>担当（社内）</span><select class="arc-input" id="arc-owner-sel">' + opts + '</select></label>' +
      '<label class="arc-field"><span>毎月の報告期限（日・任意）</span><input class="arc-input" type="number" min="1" max="31" id="arc-due-day" value="' + esc(c.report_due_day || '') + '" placeholder="例: 10"></label>' +
      '<button class="arc-btn" type="submit">保存</button></form>' +
      '<p class="arc-note">期限は毎月この日です（月末を超える日は月末）。顧客一覧の「期限が近い・超過」と、ホームの「報告の期限」に使います。空にすると未設定に戻ります。</p></section>';
  }
  function bindOwnerDue(c) {
    var f = $('#arc-owner-form');
    if (!f) return;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var dd = $('#arc-due-day').value.trim(), n = dd === '' ? null : Number(dd);
      if (n != null && !(n >= 1 && n <= 31 && Math.floor(n) === n)) { msg('報告期限は 1〜31 の日にちで入れてください', 'error'); return; }
      sb.from('clients').update({ owner_email: $('#arc-owner-sel').value || null, report_due_day: n }).eq('id', c.id).then(function (r) { q(r); openFolds.members = true; return clientStaff(c.id, curSec); })
        .then(function () { msg('担当と報告の期限を保存しました', 'ok'); }).catch(fail);
    });
  }

  // ---- 契約の状態と Google データの削除（Google OAuth の審査対応）-------------------------------
  //   契約終了にすると、終了から 90 日以内（80 日後の毎日の処理）に、この顧客の Google 由来のデータを DB から消す。
  //   削除依頼は、管理者が顧客名を打ち込んで一括で消す（airreach_delete_google_data）。消した記録は google_data_deletions に残る
  var GDEL_DAYS = 80;
  function jstDate(iso) { var t = Date.parse(iso || ''); return isNaN(t) ? '' : new Date(t + 9 * 3600000).toISOString().slice(0, 10); }
  function googleDataBlock(c) {
    var st = c.status || 'active';
    var opt = function (v, label) { return '<option value="' + v + '"' + (st === v ? ' selected' : '') + '>' + label + '</option>'; };
    var plan = c.ended_at ? '契約終了日：' + jstDate(c.ended_at) + '。この顧客の Google 由来のデータは ' + jstDate(new Date(Date.parse(c.ended_at) + GDEL_DAYS * 86400000).toISOString()) + ' ごろ（終了から90日以内）に自動で消します。'
      : '契約終了にすると、終了から90日以内に、この顧客の Google 由来のデータ（検索・訪問の数字、Studio の作業、AI 計測の記録、定期計測の設定、月次レポートの検索・訪問の数字）を自動で消します。';
    return '<section class="arc-card" id="arc-gdata" style="margin-top:16px"><h2 class="arc-h2">契約の状態と Google データの削除</h2>' +
      '<form id="arc-client-status" class="arc-row"><label for="arc-status-sel">契約の状態</label> <select class="arc-input" id="arc-status-sel">' + opt('active', '契約中') + opt('paused', '一時停止（契約は続いている）') + opt('ended', '契約終了') + '</select>' +
      '<button class="arc-btn" type="submit">変更する</button></form>' +
      '<p class="arc-note">' + esc(plan) + (c.google_purged_at ? ' 最後に Google 由来のデータを消した日：' + esc(jstDate(c.google_purged_at)) + '。' : '') + '</p>' +
      (me && me.is_admin
        ? '<h3 class="arc-h3">削除依頼による一括削除（管理者）</h3>' +
          '<p class="arc-note">この顧客の Google 由来のデータを、いますぐ DB からまとめて消します（検索・訪問の数字、Studio の作業、AI 計測の記録、定期計測の設定。月次レポートは残し、その中の検索・訪問の数字だけを消します）。元に戻せません。消した記録（日時・実行した人・件数・メモ）は残ります。担当者が結論などの文章に数字を書いていた場合は、レポートの編集画面で直してください。</p>' +
          '<form id="arc-gdel-form" class="arc-row"><input class="arc-input" id="arc-gdel-note" maxlength="500" placeholder="メモ（受付日・受付番号など。Google のデータは書かない）">' +
          '<input class="arc-input" id="arc-gdel-name" placeholder="確認のため顧客名「' + esc(c.name) + '」を入力" autocomplete="off">' +
          '<button class="arc-btn" type="submit">Google データを一括で削除する</button></form>'
        : '<p class="arc-note">削除依頼による一括削除は、管理者だけが行えます。</p>') +
      '<h3 class="arc-h3">削除の記録</h3><div id="arc-gdel-log"><p class="arc-note">読み込んでいます…</p></div></section>';
  }
  var GDEL_REASON = { contract_end: '契約終了（自動）', user_request: '削除依頼' };
  var GDEL_TABLE = { traffic_snapshots: '検索・訪問の数字', studio_workspaces: 'Studio の作業', measurement_runs: 'AI 計測の記録', measurement_schedules: '定期計測の設定', measurement_jobs: '定期計測の実行記録', reports_cleaned: '数字を消したレポート' };
  function bindGoogleData(c) {
    var log = $('#arc-gdel-log');
    if (log) sb.from('google_data_deletions').select('executed_at,reason,executed_by,counts,request_note').eq('client_id', c.id).order('executed_at', { ascending: false }).limit(20).then(function (r) {
      if (r.error) { log.innerHTML = '<p class="arc-note">削除の記録を読めませんでした（DB の更新が未適用の可能性があります）。</p>'; return; }
      var rows = r.data || [];
      log.innerHTML = rows.length ? '<div class="arc-table-wrap"><table class="arc-table"><thead><tr><th>日時</th><th>理由</th><th>実行した人</th><th>消した件数</th><th>メモ</th></tr></thead><tbody>' + rows.map(function (x) {
        var cnt = Object.keys(x.counts || {}).filter(function (k) { return x.counts[k]; }).map(function (k) { return (GDEL_TABLE[k] || k) + ' ' + x.counts[k]; }).join('・') || '0件';
        return '<tr><td>' + esc(jstDate(x.executed_at)) + '</td><td>' + esc(GDEL_REASON[x.reason] || x.reason) + '</td><td>' + esc(x.executed_by) + '</td><td>' + esc(cnt) + '</td><td>' + esc(x.request_note || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="arc-note">まだありません。</p>';
    });
    var sf = $('#arc-client-status');
    if (sf) sf.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('#arc-status-sel').value;
      if (v === c.status) { msg('契約の状態は変わっていません'); return; }
      if (v === 'ended' && !confirm('「' + c.name + '」を契約終了にします。終了から90日以内に、この顧客の Google 由来のデータを自動で消します。よろしいですか？')) return;
      sb.from('clients').update({ status: v }).eq('id', c.id).then(function (r) { q(r); pickCache = null; openFolds.members = true; return clientStaff(c.id, 'members'); })
        .then(function () { msg(v === 'ended' ? '契約終了にしました。終了から90日以内に Google 由来のデータを消します。' : '契約の状態を変えました', 'ok'); }).catch(fail);
    });
    var df = $('#arc-gdel-form');
    if (df) df.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('#arc-gdel-name').value.trim();
      if (name !== String(c.name).trim()) { msg('確認のため、顧客名「' + c.name + '」をそのまま入力してください', 'error'); return; }
      if (!confirm('「' + c.name + '」の Google 由来のデータを、いますぐ DB から消します。元に戻せません。よろしいですか？')) return;
      sb.rpc('airreach_delete_google_data', { p_client_id: c.id, p_confirm_name: name, p_note: $('#arc-gdel-note').value.trim() || null }).then(function (r) {
        var res = q(r) || {};
        // このブラウザに残っている分（Studio の作業・Google の設定）も消し、この顧客の Google とのつながりも切る
        if (window.AirReachGoogleGuard) window.AirReachGoogleGuard.purgeLocal({ clientId: c.id, ack: new Date().toISOString() });
        return fetch('/api/google/auth/?disconnect=1&client=' + encodeURIComponent(c.id), { method: 'POST', credentials: 'same-origin' }).catch(function () {}).then(function () {
          gscListCache = null; ga4ListCache = null; openFolds.members = true;
          var cnt = res.counts || {};
          return clientStaff(c.id, 'members').then(function () {
            msg('Google 由来のデータを消しました（' + Object.keys(cnt).filter(function (k) { return cnt[k]; }).map(function (k) { return (GDEL_TABLE[k] || k) + ' ' + cnt[k]; }).join('・') + '）。このブラウザの分と、この顧客の Google とのつながりも消しました。ほかのパソコンに残っている分は、そのパソコンで Studio を開いたときに消えます。', 'ok');
          });
        });
      }).catch(fail);
    });
  }

  // 材料のカードは折りたたむ（開いた状態は再描画しても保つ）
  var openFolds = {};
  var curSec = 'home';
  // 顧客の画面の各節。いまの節だけを見せる（ほかも DOM に置き、フォームの結び付けはそのまま使う）
  function fold(key, title, count, pre) {
    return '<section class="arc-card arc-sec" data-sec="' + key + '"' + (curSec === key ? '' : ' hidden') + '>' + (pre || '') + '<div class="arv-home-head">' + (secLead(key) ? '<p class="arc-lead">' + esc(secLead(key)) + '</p>' : '<h2 class="arc-h2">' + esc(title) + '</h2>') + '<span class="arc-sub">' + esc(count) + '</span></div><div class="arc-fold-b">';
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
  // Google とつないで戻ってきたとき（?google=connected など）。一度だけ知らせ、アドレスからは消す
  var googleRet = (location.search.match(/[?&]google=([a-z_]+)/) || [])[1] || '';
  if (googleRet) { try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {} }
  // Google のつながりは顧客ごと（api/google/_lib/token.js と同じ Cookie 名）
  function gKey(clientId) { return String(clientId || '').toLowerCase().replace(/-/g, ''); }
  function gCookie(clientId, kind) { try { return decodeURIComponent((document.cookie.match(new RegExp('(?:^|;\\s*)airreach_g_' + gKey(clientId) + '_' + kind + '=([^;]*)')) || [])[1] || ''); } catch (e) { return ''; } }
  var gClient = '';
  function googleEmail(clientId) { return gCookie(clientId || gClient, 'e'); }
  function googleSyncForm(clientId, sites, traffic) {
    var p = googleProps(clientId), host = sites[0] && sites[0].host;
    gClient = clientId;
    var feats = gCookie(clientId, 's').split('.').filter(Boolean);
    var hasGsc = feats.indexOf('gsc') >= 0, hasGa4 = feats.indexOf('ga4') >= 0;
    // つなぐ前に、担当者が Google のデータを閲覧することへの同意を取る（チェックしないとつなげない。api/google/auth.js も確かめる）
    var consent = '<label class="arc-g-consent" style="flex-basis:100%"><input type="checkbox" id="arc-g-consent"> <span>AirReach の担当者が、分析・改善提案・月次レポート作成・サポートのために必要な範囲で、この接続で取得する Google のデータ（Search Console・Google アナリティクス）を閲覧することに同意します。</span></label>' +
      '<p class="arc-note" style="flex-basis:100%;margin:0">担当者がお客様の代わりにつなぐときは、お客様からこの同意をもらってからつないでください。</p>';
    var studioG = (window.AirReachNav ? window.AirReachNav.studioBase({ id: clientId, site: sites && sites[0] && sites[0].url }) : '/airreach/studio/') + '#google';
    var ret = googleRet; googleRet = '';
    var RET = { connected: ['ok', 'Google とつながりました。月を選んで「Google から取得」を押してください。'], gsc_missing: ['warn', 'Search Console の閲覧が許可されませんでした。もう一度つなぎ、Search Console にチェックを入れてください。'],
      ga4_missing: ['warn', 'GA4 の閲覧が許可されませんでした（Search Console だけつながりました）。GA4 も使うときは、もう一度つないでチェックを入れてください。'], scope_missing: ['warn', '閲覧の許可がありませんでした。もう一度つないで、チェックを入れてください。'] };
    var email = googleEmail(clientId);
    // この顧客の数字を前回取ったときの Google アカウント（保存した数字に記録してある）
    var lastBy = ((traffic || []).filter(function (t) { return /_api$/.test(t.source) && t.metrics && t.metrics.google_email; })[0] || {}).metrics;
    var lastEmail = lastBy ? lastBy.google_email : '';
    var state = feats.length
      ? '<span class="arc-chip is-ok">Google とつながっています</span> <span class="arc-sub">' + (email ? '<b>' + esc(email) + '</b>・' : '') + 'Search Console ' + (hasGsc ? '✓' : '—') + '・GA4 ' + (hasGa4 ? '✓' : '—') + '</span> <button type="button" class="arc-btn-sm" data-g-connect>別のアカウントでつなぎ直す</button> <button type="button" class="arc-btn-sm" id="arc-g-disconnect">切断する</button>' +
        (lastEmail && email && lastEmail !== email ? '<p class="arc-gmsg is-warn" style="flex-basis:100%">この顧客の数字は前回 <b>' + esc(lastEmail) + '</b> で取りました。今は <b>' + esc(email) + '</b> でつながっています。別の会社のアカウントでないか確かめてから取得してください。</p>' : '') +
        (!email ? '<p class="arc-note" style="flex-basis:100%;margin:0">どの Google アカウントでつないだかを表示するには、一度「別のアカウントでつなぎ直す」からつなぎ直してください。</p>' : '') +
        '<p class="arc-note" style="flex-basis:100%;margin:0">このつながりは、この顧客だけのものです（このブラウザに30日残ります）。ほかの顧客は、それぞれの画面でつなぎます。</p>'
      : '<span class="arc-chip is-warn">この顧客はまだ Google とつながっていません</span> <button type="button" class="arc-btn" data-g-connect>Google とつなぐ</button><p class="arc-note" style="flex-basis:100%;margin:0">つなぐと、この顧客だけのつながりになります（ほかの顧客には使いません）。お客様のサイトを見られる Google アカウントでつないでください。</p>';
    return '<div class="arc-gbox"><div class="arc-gbox-h"><b>Google から取り込む（おすすめ）</b>' + state + consent + '<p class="arc-gmsg is-warn" id="arc-g-connect-msg" style="flex-basis:100%" hidden></p></div>' +
      (RET[ret] ? '<p class="arc-gmsg is-' + RET[ret][0] + '">' + esc(RET[ret][1]) + '</p>' : '') +
      '<form id="arc-google-sync" class="arc-row"><input class="arc-input" type="month" id="arc-g-month" value="' + thisMonth() + '" required>' +
      '<input class="arc-input" id="arc-g-gsc" placeholder="Search Console のサイト（例: sc-domain:example.jp）" value="' + esc(p.gsc != null ? p.gsc : (host ? 'sc-domain:' + host : '')) + '">' +
      '<input class="arc-input" id="arc-g-ga4" inputmode="numeric" placeholder="GA4 プロパティID（数字・必須）" value="' + esc(p.ga4 || '') + '">' +
      '<button class="arc-btn" type="submit"' + (feats.length ? '' : ' disabled') + '>Google から取得</button>' +
      '<label class="arc-g-other" id="arc-g-other-wrap" hidden><input type="checkbox" id="arc-g-other"> このお客様のサイトではないと分かったうえで取得する</label></form>' +
      '<p class="arc-note">つないだ Google アカウントが閲覧できるサイトだけ取得できます（お客様のサイトは閲覧権限をもらってください）。Search Console はサイト全体の表示・クリック、GA4 は ' + esc(host || '対象サイト') + ' のセッション・AI 経由のセッション（ChatGPT・Perplexity・Gemini などから）・問い合わせを取得します。当月は昨日までの数字です。' +
      '言葉ごとの取り込み（CSV・Keyword Planner）は <a href="' + esc(studioG) + '">Studio の取り込み画面</a>で行えます。</p></div>';
  }
  function monthRange(ymStr) {
    var y = Number(ymStr.slice(0, 4)), mo = Number(ymStr.slice(5, 7));
    var start = ymStr + '-01', last = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    var yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    var end = last < yest ? last : yest;
    return end < start ? null : { start: start, end: end };
  }
  // Google 連携の API は、ログインのトークンで「社内スタッフか契約中のお客様か」を確かめる（api/google/_lib/access.js）
  function googleHeaders(extra) {
    var h = Object.assign({}, extra || {});
    return (sb ? sb.auth.getSession() : Promise.resolve(null)).then(function (r) { var t = r && r.data && r.data.session && r.data.session.access_token; if (t) h.Authorization = 'Bearer ' + t; return h; }, function () { return h; });
  }
  function googleGet(path) { return googleHeaders().then(function (h) { return fetch(path, { credentials: 'same-origin', headers: h }); }); }
  function googlePost(path, body) {
    return googleHeaders({ 'Content-Type': 'application/json' }).then(function (h) { return fetch(path, { method: 'POST', credentials: 'same-origin', headers: h, body: JSON.stringify(body) }); })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.ok) return j;
          var e = j.error && typeof j.error === 'object' ? (j.error.message || '') : (j.error || '');
          if (/^(login_required|not_contracted|contract_ended|consent_required|access_check_failed|auth_not_configured)$/.test(String(j.code || ''))) e = j.error || e;
          else if (r.status === 401) e = 'この顧客は Google とつながっていません（または切れています）。上の「Google とつなぐ」で、この顧客のサイトを見られるアカウントでつないでください';
          else if (r.status === 403 && path.indexOf('gsc') >= 0) e = 'この Search Console のサイトを、つないだ Google アカウントでは見られません。上の一覧から「このお客様のサイト」を選ぶか、お客様に Search Console の「設定 → ユーザーと権限」でこのアカウントを追加してもらってください';
          throw new Error(e || ('HTTP ' + r.status));
        });
      });
  }
  // つないだ Google アカウントが見られる Search Console のプロパティを読み、選べるようにする。
  // 顧客のサイトに合うもの（sc-domain: か https://〜/ か）を先に選ぶ。無ければ、権限をもらう方法を書く
  var gscListCache = null;
  function gscCandidates(host) { return host ? ['sc-domain:' + host, 'https://' + host + '/', 'https://www.' + host + '/', 'http://' + host + '/', 'http://www.' + host + '/'] : []; }
  function fillGscProperties(clientId, sites) {
    var input = $('#arc-g-gsc'); if (!input || gCookie(clientId, 's').split('.').indexOf('gsc') < 0) return;
    var host = sites[0] && sites[0].host;
    var load = gscListCache && gscListCache.id === clientId ? Promise.resolve(gscListCache.list) : googleGet('/api/google/gsc/?client=' + encodeURIComponent(clientId)).then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); }).then(function (j) { gscListCache = { id: clientId, list: j.sites || [] }; return gscListCache.list; });
    load.then(function (list) {
      var note = $('#arc-g-gsc-note'); if (note) note.remove();
      var urls = list.map(function (x) { return x.siteUrl; });
      var sel = document.createElement('select'); sel.className = 'arc-input'; sel.id = 'arc-g-gsc-sel'; sel.setAttribute('aria-label', 'Search Console のサイト');
      var cands = gscCandidates(host);
      var saved = input.value.trim(), pick = urls.indexOf(saved) >= 0 ? saved : (cands.filter(function (c) { return urls.indexOf(c) >= 0; })[0] || '');
      sel.innerHTML = '<option value="">（Search Console は取らない）</option>' + urls.map(function (u) { return '<option value="' + esc(u) + '"' + (u === pick ? ' selected' : '') + '>' + esc(u) + (cands.indexOf(u) >= 0 ? '（このお客様のサイト）' : '') + '</option>'; }).join('');
      input.hidden = true; input.value = pick; input.insertAdjacentElement('afterend', sel);
      sel.addEventListener('change', function () { input.value = sel.value; });
      if (!pick) {
        var p = document.createElement('p'); p.id = 'arc-g-gsc-note'; p.className = 'arc-gmsg is-warn';
        p.textContent = urls.length
          ? 'つないだ Google アカウントで見られる Search Console のサイトに、' + (host || 'このお客様のサイト') + ' がありません（見られるサイト：' + urls.slice(0, 5).join('、') + (urls.length > 5 ? ' ほか' : '') + '）。お客様に、Search Console の「設定 → ユーザーと権限」で、つないだ Google アカウントを追加してもらってください。追加されたら、ここを開き直すと選べます。'
          : 'つないだ Google アカウントで見られる Search Console のサイトがありません。お客様に、Search Console の「設定 → ユーザーと権限」で、つないだ Google アカウントを追加してもらってください。';
        var box = input.closest('.arc-gbox'); if (box) box.insertBefore(p, input.closest('form'));
      }
    }).catch(function () { /* 一覧を読めないときは、今まで通り手で入れる */ });
  }
  // つないだアカウントで見られる GA4 プロパティを読み、選べるようにする。お客様のサイトのデータストリームを持つものを先に選ぶ
  var ga4ListCache = null;
  function fillGa4Properties(clientId, sites) {
    var input = $('#arc-g-ga4'); if (!input || gCookie(clientId, 's').split('.').indexOf('ga4') < 0) return;
    var host = sites[0] && sites[0].host;
    var load = ga4ListCache && ga4ListCache.id === clientId ? Promise.resolve(ga4ListCache.list) : googleGet('/api/google/ga4/?client=' + encodeURIComponent(clientId))
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); })
      .then(function (j) { ga4ListCache = { id: clientId, list: j.properties || [] }; return ga4ListCache.list; });
    load.then(function (list) {
      var hostOfUri = function (u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } };
      var mine = function (p) { return !!host && (p.uris || []).some(function (u) { return hostOfUri(u) === host; }); };
      var saved = input.value.trim(), ids = list.map(function (p) { return p.id; });
      var pick = ids.indexOf(saved) >= 0 ? saved : ((list.filter(mine)[0] || {}).id || '');
      var sel = document.createElement('select'); sel.className = 'arc-input'; sel.id = 'arc-g-ga4-sel'; sel.setAttribute('aria-label', 'GA4 のプロパティ');
      sel.innerHTML = '<option value="">（GA4 を選ぶ：必須）</option>' + list.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === pick ? ' selected' : '') + '>' + esc(p.name || p.id) + '（' + esc(p.id) + '）' + (mine(p) ? '（このお客様のサイト）' : '') + '</option>'; }).join('');
      input.hidden = true; input.value = pick; input.insertAdjacentElement('afterend', sel);
      sel.addEventListener('change', function () { input.value = sel.value; });
      if (!pick) {
        var p = document.createElement('p'); p.className = 'arc-gmsg is-warn';
        p.textContent = list.length
          ? 'つないだ Google アカウントで見られる GA4 に、' + (host || 'このお客様のサイト') + ' のものが見つかりませんでした。一覧から選ぶか、お客様に GA4 の「管理 → プロパティのアクセス管理」で、つないだ Google アカウントを「閲覧者」として追加してもらってください。'
          : 'つないだ Google アカウントで見られる GA4 がありません。お客様に GA4 の「管理 → プロパティのアクセス管理」で、つないだ Google アカウントを「閲覧者」として追加してもらってください。';
        var box = input.closest('.arc-gbox'); if (box) box.insertBefore(p, input.closest('form'));
      }
    }).catch(function () {
      // 一覧を読めないとき（Analytics Admin API が使えない等）は手で入れる。どこにあるかを案内する
      var p = document.createElement('p'); p.className = 'arc-note';
      p.textContent = 'GA4 のプロパティID は、GA4 の「管理 → プロパティの設定」に出ている数字です（「G-」で始まる測定ID ではありません）。';
      var box = input.closest('.arc-gbox'); if (box) box.insertBefore(p, input.closest('form'));
    });
  }
  function bindGoogleSync(clientId, sites) {
    var form = $('#arc-google-sync'); if (!form) return;
    fillGscProperties(clientId, sites);
    fillGa4Properties(clientId, sites);
    Array.prototype.forEach.call(document.querySelectorAll('[data-g-connect]'), function (b) {
      b.addEventListener('click', function () {
        var cm = $('#arc-g-connect-msg'), say = function (t) { if (cm) { cm.hidden = false; cm.textContent = t; } };
        if (!($('#arc-g-consent') || {}).checked) { say('つなぐ前に、Google のデータの閲覧についての同意にチェックしてください。'); var cb = $('#arc-g-consent'); if (cb) cb.focus(); return; }
        b.disabled = true;
        googlePost('/api/google/auth/', { consent: true, back: 'app', client: clientId }).then(function (j) {
          if (!j || !/^https:\/\/accounts\.google\.com\//.test(String(j.url || ''))) throw new Error('Google の接続画面を開けませんでした');
          location.href = j.url;
        }).catch(function (e) { b.disabled = false; say((e && e.message) || String(e)); });
      });
    });
    var dc = $('#arc-g-disconnect');
    if (dc) dc.addEventListener('click', function () {
      dc.disabled = true;
      fetch('/api/google/auth/?disconnect=1&client=' + encodeURIComponent(clientId), { method: 'POST', credentials: 'same-origin' }).then(function () {
        gscListCache = null; ga4ListCache = null; openFolds.traffic = true;
        return clientStaff(clientId, 'traffic').then(function () { msg('この顧客の Google とのつながりを切りました。もう一度つなぐまで、この顧客は Google から取得できません（ほかの顧客のつながりはそのままです）。', 'ok'); });
      }).catch(function () { dc.disabled = false; msg('切断できませんでした。少し待ってからもう一度押してください。', 'error'); });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var month = $('#arc-g-month').value, gsc = $('#arc-g-gsc').value.trim(), ga4 = $('#arc-g-ga4').value.trim().replace(/^properties\//, '');
      var range = monthRange(month);
      if (!range) { msg('この月はまだ数値がありません', 'error'); return; }
      if (!gsc && !ga4) { msg('Search Console のサイトか GA4 プロパティIDを入れてください', 'error'); return; }
      if (ga4 && !/^\d{1,20}$/.test(ga4)) { msg('GA4 プロパティIDは数字だけです（「G-」で始まる測定IDではありません）', 'error'); return; }
      if (ga4 && !sites[0]) { msg('GA4 を取得するには、先に「対象サイト」を登録してください', 'error'); return; }
      // 選んだ Search Console のサイトが、この顧客のサイトか（違う会社の数字が入るのを防ぐ）
      var host0 = sites[0] && sites[0].host;
      if (gsc && host0 && gscCandidates(host0).indexOf(gsc) < 0 && !($('#arc-g-other') || {}).checked) {
        var w = $('#arc-g-other-wrap'); if (w) w.hidden = false;
        msg('選んだ Search Console のサイト（' + gsc + '）は、このお客様のサイト（' + host0 + '）ではありません。違う会社の数字が入るのを防ぐため、取得しませんでした。お客様のサイトを選ぶか、分かったうえで取るときは下のチェックを入れてください。', 'error');
        return;
      }
      saveGoogleProps(clientId, { gsc: gsc, ga4: ga4 });
      msg('Google から取得しています…');
      var period = month + '-01', jobs = [], got = [];
      if (gsc) jobs.push(googlePost('/api/google/gsc/', { clientId: clientId, siteUrl: gsc, startDate: range.start, endDate: range.end, totalsOnly: true }).then(function (d) {
        var t = d.totals; if (!t) throw new Error('Search Console の合計を取得できませんでした');
        got.push('Search Console（' + t.days + '日間 クリック ' + t.clicks + ' / 表示 ' + t.impressions + '）');
        return sb.from('traffic_snapshots').upsert({ client_id: clientId, period_month: period, source: 'gsc_api',
          metrics: { clicks: t.clicks, impressions: t.impressions, ctr: t.ctr, position: t.position, days: t.days, start_date: t.startDate, end_date: t.endDate, property: gsc, google_email: googleEmail(clientId) || null, fetched_at: new Date().toISOString() },
          created_by: me.email }, { onConflict: 'client_id,period_month,source' }).then(q);
      }));
      if (ga4) jobs.push(googlePost('/api/google/ga4/', { clientId: clientId, propertyId: ga4, siteUrl: sites[0].url, startDate: range.start, endDate: range.end, summaryOnly: true }).then(function (d) {
        var g = d.summary; if (!g) throw new Error('GA4 の合計を取得できませんでした');
        got.push('GA4（セッション ' + g.sessions + ' / AI経由 ' + g.aiSessions + ' / キーイベント ' + g.keyEvents + '）');
        return sb.from('traffic_snapshots').upsert({ client_id: clientId, period_month: period, source: 'ga4_api',
          metrics: { sessions: g.sessions, ai_sessions: g.aiSessions, conversions: g.keyEvents, target_page_views: null, ai_sources: g.aiSources,
            property_id: ga4, host: d.host, start_date: range.start, end_date: range.end, google_email: googleEmail(clientId) || null, fetched_at: new Date().toISOString() },
          created_by: me.email }, { onConflict: 'client_id,period_month,source' }).then(q);
      }));
      Promise.allSettled(jobs).then(function (rs) {
        var errs = rs.filter(function (r) { return r.status === 'rejected'; }).map(function (r) { return (r.reason && r.reason.message) || String(r.reason); });
        openFolds.traffic = true;
        return clientStaff(clientId, 'traffic').then(function () {
          if (errs.length) msg((got.length ? '保存: ' + got.join('、') + '。' : '') + '失敗: ' + errs.join(' / '), 'error');
          else if (!ga4) msg('保存しました: ' + got.join('、') + '。GA4 がまだです（必須）。GA4 のプロパティを選んで、もう一度「Google から取得」を押してください。', 'error');
          else msg('保存しました: ' + got.join('、'), 'ok');
        });
      }).catch(fail);
    });
  }

  // ---- AI計測の定期実行（社内だけ）-------------------------------------------------------
  // 設定（measurement_schedules）と実行の記録（measurement_jobs）。自動で動くのは、設定を「有効」にし、
  // さらに計測サーバーの AIRREACH_SCHEDULE_ENABLED を true にしたときだけ（既定は止めてある）
  var SCHED_ENGINES = [['perplexity', 'Perplexity'], ['gemini', 'Gemini'], ['google_aio', 'Google AI による概要'], ['google_ai_mode', 'Google AI モード'], ['chatgpt_search', 'ChatGPT（検索あり）'], ['claude', 'Claude（検索あり）'], ['chatgpt', 'ChatGPT（検索なし）']];
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  var JOB_STATUS = { queued: ['待ち', 'is-warn'], running: ['実行中', 'is-warn'], succeeded: ['成功', 'is-ok'], partial: ['一部成功', 'is-warn'], failed: ['失敗', 'is-bad'], skipped: ['見送り', ''] };
  function schedPrompts(text) { return String(text || '').split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 10).map(function (t) { return { prompt: t, keyword: t }; }); }
  function loadSchedule(c, sites) {
    var box = $('#arc-schedule'); if (!box) return;
    // 定期計測は費用がかかるため、設定は Trillion Bank の社内だけ（DB も社内だけに許している）
    if (partnerOrg()) { box.innerHTML = '<p class="arc-note">定期計測の設定は、Trillion Bank の社内だけが行えます。計測は Studio の「AI での見え方を測る」から1回ずつ行えます。</p>'; return; }
    Promise.all([
      sb.from('measurement_schedules').select('*').eq('client_id', c.id).maybeSingle(),
      sb.from('measurement_jobs').select('id,slot,trigger,status,attempts,answers_planned,answers_done,errors,not_shown,est_cost_usd,skip_reason,last_error,run_id,finished_at').eq('client_id', c.id).order('slot', { ascending: false }).limit(20)
    ]).then(function (rs) {
      if (rs[0].error && /measurement_schedules|relation|schema cache/i.test(String(rs[0].error.message || ''))) {
        box.innerHTML = '<p class="arc-note">定期計測の表がまだデータベースにありません（migration 20261005120000 の適用待ち）。</p>'; return;
      }
      renderSchedule(box, c, sites, q(rs[0]), q(rs[1]) || []);
    }).catch(function (e) { box.innerHTML = '<p class="arc-note">定期計測の設定を読めませんでした：' + esc(e.message || e) + '</p>'; });
  }
  function renderSchedule(box, c, sites, sc, jobs) {
    var s = sc || { enabled: false, brand: c.name, site_url: (sites[0] && sites[0].url) || '', engines: ['perplexity', 'gemini', 'google_aio', 'google_ai_mode'], prompts: [], weekdays: [1], hour_jst: 9, repeats: 1, max_runs_per_month: 4, monthly_answer_cap: 200, monthly_cost_cap_usd: 5 };
    var per = (s.prompts || []).length * (s.engines || []).length * (s.repeats || 1);
    var jobRows = jobs.map(function (j) {
      var st = JOB_STATUS[j.status] || [j.status, ''];
      return '<tr><td>' + esc(jst(j.slot).slice(0, 16)) + (j.trigger === 'manual' ? ' <span class="arc-sub">手動</span>' : '') + '</td><td><span class="arc-chip ' + st[1] + '">' + esc(st[0]) + '</span>' + (j.attempts > 1 ? ' <span class="arc-sub">' + j.attempts + '回目</span>' : '') + '</td>' +
        '<td>' + esc(j.answers_done) + ' / ' + esc(j.answers_planned) + (j.errors ? ' · エラー ' + esc(j.errors) : '') + (j.not_shown ? ' · AI の回答なし ' + esc(j.not_shown) : '') + '</td><td>' + esc(Number(j.est_cost_usd || 0).toFixed(3)) + 'ドル</td>' +
        '<td>' + esc(j.skip_reason || j.last_error || '') + '</td></tr>';
    }).join('');
    box.innerHTML = '<section class="arc-card arc-sched"><div class="arv-home-head"><h2 class="arc-h2">定期計測 <span class="arc-chip ' + (s.enabled ? 'is-ok' : '') + '">' + (s.enabled ? '有効' : '止めています') + '</span></h2></div>' +
      '<p class="arc-note">決めた曜日・時刻に、同じ質問を同じ AI に聞いて記録します。<b>自動で動くのは、ここで「有効」にし、さらに計測サーバー側の設定（AIRREACH_SCHEDULE_ENABLED）を入れたときだけ</b>です（いまは計測の条件と費用の上限が決まるまで止めています）。「今すぐ1回測る」はいつでも使えます。</p>' +
      '<form id="arc-sched-form" class="arc-sched-form">' +
      '<label class="arc-sched-chk"><input type="checkbox" id="arc-sched-enabled"' + (s.enabled ? ' checked' : '') + '> 有効にする</label>' +
      '<fieldset><legend>聞く AI</legend>' + SCHED_ENGINES.map(function (e) { return '<label><input type="checkbox" name="arc-sched-eng" value="' + e[0] + '"' + ((s.engines || []).indexOf(e[0]) >= 0 ? ' checked' : '') + '> ' + esc(e[1]) + '</label>'; }).join('') + '</fieldset>' +
      '<label class="arc-sched-full">質問（1行に1問・10問まで） <button type="button" class="arc-btn-sm" id="arc-sched-from-studio">Studio の「毎月測る質問」を読み込む</button><textarea class="arc-input" id="arc-sched-prompts" rows="6">' + esc((s.prompts || []).map(function (p) { return p.prompt; }).join('\n')) + '</textarea></label>' +
      '<fieldset><legend>曜日</legend>' + WD.map(function (w, i) { return '<label><input type="checkbox" name="arc-sched-wd" value="' + i + '"' + ((s.weekdays || []).indexOf(i) >= 0 ? ' checked' : '') + '> ' + w + '</label>'; }).join('') + '</fieldset>' +
      '<div class="arc-row"><label>時刻（日本時間）<select class="arc-input" id="arc-sched-hour">' + Array.from({ length: 24 }, function (_, h) { return '<option value="' + h + '"' + (h === s.hour_jst ? ' selected' : '') + '>' + h + '時</option>'; }).join('') + '</select></label>' +
      '<label>1回に同じ質問を聞く回数<select class="arc-input" id="arc-sched-repeats">' + [1, 2, 3].map(function (n) { return '<option' + (n === s.repeats ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="arc-row"><label>月の実行回数の上限<input class="arc-input" type="number" min="1" max="31" id="arc-sched-runs" value="' + esc(s.max_runs_per_month) + '"></label>' +
      '<label>月の回答数の上限<input class="arc-input" type="number" min="1" max="5000" id="arc-sched-answers" value="' + esc(s.monthly_answer_cap) + '"></label>' +
      '<label>月の費用の上限（ドル・見込み）<input class="arc-input" type="number" min="0" max="500" step="0.5" id="arc-sched-cost" value="' + esc(s.monthly_cost_cap_usd) + '"></label></div>' +
      '<p class="arc-note" id="arc-sched-calc">1回の実行で ' + per + ' 回答（質問 ' + (s.prompts || []).length + ' × AI ' + (s.engines || []).length + ' × ' + (s.repeats || 1) + '回）。月 ' + s.max_runs_per_month + ' 回なら最大 ' + per * s.max_runs_per_month + ' 回答。上限を超える回は実行せず「見送り」として理由を残します。</p>' +
      '<div class="arc-row"><button class="arc-btn" type="submit">設定を保存</button>' + (sc ? '<button class="arc-btn-sm" type="button" id="arc-sched-now">今すぐ1回測る</button>' : '') + '</div></form>' +
      '<h3 class="arc-h3">実行の記録（直近20回）</h3><div class="arc-table-wrap"><table class="arc-table"><thead><tr><th>予定の時刻</th><th>結果</th><th>回答</th><th>費用の見込み</th><th>見送り・失敗の理由</th></tr></thead><tbody>' +
      (jobRows || '<tr><td colspan="5" class="arc-empty">まだありません</td></tr>') + '</tbody></table></div></section>';
    $('#arc-sched-from-studio').addEventListener('click', function () {
      sb.from('studio_workspaces').select('data').eq('client_id', c.id).maybeSingle().then(function (r) {
        var d = q(r), list = d && d.data && d.data.studio && d.data.studio.prompts;
        // 外部の AI に送るのは、Studio で確定した質問だけ。Search Console 由来の質問は読み込まない（airreach-google-guard.js）
        var G = window.AirReachGoogleGuard;
        if (!G) { msg('質問を確かめる部品を読み込めなかったため、読み込んでいません。ページを開き直してください。', 'error'); return; }
        var pick = G.sendablePrompts(list || [], G.ctxOf(d.data.studio, d.data.orch && d.data.orch.lastJob));
        var on = pick.send.slice(0, 10).map(function (x) { return x.text; });
        var skipped = (pick.unconfirmed ? '未確定の ' + pick.unconfirmed + '問' : '') + (pick.unconfirmed && pick.google ? '・' : '') + (pick.google ? 'Search Console 由来の ' + pick.google + '問' : '');
        if (!on.length) { msg('Studio に確定した「毎月測る質問」がありません。Studio の「AI での見え方を測る」で質問を確かめて「確定」してください。' + (skipped ? '（' + skipped + 'は読み込みません）' : ''), 'error'); return; }
        $('#arc-sched-prompts').value = on.join('\n'); msg('Studio の確定した質問を ' + on.length + ' 問読み込みました。' + (skipped ? skipped + 'は読み込んでいません。' : '') + '「設定を保存」で保存します。', 'ok');
      }).catch(fail);
    });
    $('#arc-sched-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var engs = Array.prototype.map.call(document.querySelectorAll('input[name="arc-sched-eng"]:checked'), function (x) { return x.value; });
      var wds = Array.prototype.map.call(document.querySelectorAll('input[name="arc-sched-wd"]:checked'), function (x) { return Number(x.value); });
      var ps = schedPrompts($('#arc-sched-prompts').value);
      if (!engs.length || !wds.length) { msg('AI と曜日を1つ以上選んでください。', 'error'); return; }
      if ($('#arc-sched-enabled').checked && !ps.length) { msg('有効にするには、質問を1問以上入れてください。', 'error'); return; }
      var row = { client_id: c.id, enabled: $('#arc-sched-enabled').checked, brand: s.brand || c.name, site_url: s.site_url || (sites[0] && sites[0].url) || null, engines: engs, prompts: ps, weekdays: wds,
        hour_jst: Number($('#arc-sched-hour').value), repeats: Number($('#arc-sched-repeats').value), max_runs_per_month: Number($('#arc-sched-runs').value), monthly_answer_cap: Number($('#arc-sched-answers').value),
        monthly_cost_cap_usd: Number($('#arc-sched-cost').value), updated_by: me.email, updated_at: new Date().toISOString() };
      if (!sc) row.created_by = me.email;
      sb.from('measurement_schedules').upsert(row, { onConflict: 'client_id' }).then(function (r) { if (r.error) throw r.error; msg('定期計測の設定を保存しました。', 'ok'); loadSchedule(c, sites); }).catch(fail);
    });
    var now = $('#arc-sched-now');
    if (now) now.addEventListener('click', function () {
      now.disabled = true; now.textContent = '測っています…（数分かかります）';
      sb.auth.getSession().then(function (r) {
        var tok = r && r.data && r.data.session && r.data.session.access_token;
        return fetch('/api/airreach/schedule-run/', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ action: 'run_now', scheduleId: sc.id }) });
      }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); }).then(function (x) {
        if (!x.ok || !x.d.ok) throw new Error((x.d && x.d.error) || '計測できませんでした');
        var o = x.d.result || {};
        msg('測りました：回答 ' + o.answers + (o.not_shown ? '・AI の回答なし ' + o.not_shown : '') + (o.errors ? '・エラー ' + o.errors : '') + '（費用の見込み ' + Number(o.cost_usd || 0).toFixed(3) + 'ドル）。', o.errors ? 'error' : 'ok');
        loadSchedule(c, sites);
      }).catch(function (e2) { now.disabled = false; now.textContent = '今すぐ1回測る'; fail(e2); });
    });
  }

  function clientStaff(id, sec) {
    curSec = sec || 'home';
    return Promise.all([
      sb.from('clients').select('*').eq('id', id).maybeSingle(),
      sb.from('client_sites').select('*').eq('client_id', id).order('created_at'),
      sb.from('client_members').select('*').eq('client_id', id).order('email'),
      sb.from('measurement_runs').select('id,measured_on,run_label,query_set_version,summary,created_at').eq('client_id', id).order('measured_on', { ascending: false }).order('created_at', { ascending: false }),
      sb.from('traffic_snapshots').select('*').eq('client_id', id).order('period_month', { ascending: false }),
      sb.from('action_items').select('*').eq('client_id', id).order('done_on', { ascending: false }),
      sb.from('reports').select('id,period_month,status,published_at,updated_at').eq('client_id', id).order('period_month', { ascending: false }),
      sb.rpc('airreach_client_scans', { p_client_id: id }),
      // お客様からの確認待ちの依頼の件数（DB が未適用なら null）
      sb.from('client_requests').select('id').eq('client_id', id).eq('status', 'pending').then(function (x) { return x.error ? null : (x.data || []).length; }, function () { return null; }),
      sb.from('staff_members').select('email,name').then(function (x) { return x.error ? [] : (x.data || []); }, function () { return []; })
    ]).then(function (rs) {
      var c = q(rs[0]); if (!c) throw new Error('顧客が見つかりません');
      var sites = q(rs[1]) || [], members = q(rs[2]) || [], runs = q(rs[3]) || [], traffic = q(rs[4]) || [], actions = q(rs[5]) || [], reports = q(rs[6]) || [], scans = q(rs[7]) || [], pendingReq = rs[8];
      var repThis = reports.filter(function (x) { return x.period_month === thisMonth() + '-01'; })[0];
      // 今月のレポートが差し戻されたか（最後の出来事）
      return (repThis && approvalOn() ? sb.from('report_events').select('action,created_at').eq('report_id', repThis.id).order('created_at', { ascending: true }).then(function (x) { var ev = x.data || []; return ev.length ? ev[ev.length - 1].action : null; }, function () { return null; }) : Promise.resolve(null))
        .then(function (lastEvent) { return [c, sites, members, runs, traffic, actions, reports, scans, pendingReq, lastEvent, rs[9]]; });
    }).then(function (pk) {
      var c = pk[0], sites = pk[1], members = pk[2], runs = pk[3], traffic = pk[4], actions = pk[5], reports = pk[6], scans = pk[7], pendingReq = pk[8], lastEvent = pk[9], staffList = pk[10];
      var R = window.AirReachReport, C = window.AirReachCharts;

      // 今月の状況（材料からその場で集計。レポートの下書きとは別に、いつでも最新）
      var month = thisMonth() + '-01', live = null;
      try { live = R.compileReport({ client: c, periodMonth: month, scans: scans, runs: runs, traffic: traffic, actions: actions }); } catch (e) { live = null; }
      var repNow = reports.filter(function (x) { return x.period_month === month; })[0];
      var overview = '', plan = null;
      if (live && C) {
        // ホーム：今日の作業（次にやること・期限・依頼・レポート）→ 数字（小さく）→ 7工程・直すこと → 依頼 → AI の詳しい結果 → 推移
        var studioH = studioHref(c, sites);
        plan = monthPlan(c, sites, live, repNow, actions, lastEvent);
        overview += todayCard(c, plan, repNow, pendingReq, me.email);
        // サイトが登録されていないと、分析しても診断がこの顧客に紐づかない（ホームに何も出ない）
        if (!sites.length) overview += '<section class="arc-card arc-nosite"><b>この顧客にはサイトが登録されていません</b><p class="arc-note" style="margin:4px 0 8px">診断はサイトごとに保存されるため、サイトを登録するまでここには出ません。Studio で「サイトを調べる」を行うと、調べたサイトを自動で登録します。</p>' +
          '<a class="arc-btn" href="#/c/' + c.id + '/sites">サイトを登録する</a></section>';
        overview += '<section class="arc-card arc-numcard"><div class="arv-home-head"><h2 class="arc-h2">' + esc(ymJa(month)) + 'の数字</h2><span class="arc-sub">登録された材料からその場で集計</span></div>' +
          compactNumbers(live, month) +
          '<details class="arc-more" data-fold="nums"' + (openFolds.nums ? ' open' : '') + '><summary>数字の内訳を開く（AI 別の割合・分子と分母・対象期間）</summary>' + C.tiles(live) + '</details></section>' +
          '<div class="arc-dash-2">' + monthSteps(plan) + dashTodos(R.todoList(live), live, studioH) + '</div>' +
          '<div id="arc-rq"></div>' +
          '<details class="arc-card arc-more-card" data-fold="aidetail"' + (openFolds.aidetail ? ' open' : '') + '><summary class="arc-h2">AI での見え方と参照したサイト（詳しく）</summary><div class="arc-dash-2">' + dashAi(runs[0], live, studioH) + dashSources(runs[0], studioH) + '</div></details>' +
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
        var P = window.AirReachStaff ? window.AirReachStaff.periodOf(m, t.period_month) : null;
        var per = P ? '<small class="arc-period' + (P.status === 'partial' ? ' is-partial' : P.status === 'unknown' ? ' is-unknown' : '') + '">' + esc(P.label) + (P.fetchedAt ? '・取得 ' + esc(window.AirReachStaff.jstStamp(P.fetchedAt)) : '') + '</small>' : '';
        return '<tr><td>' + esc(ym(t.period_month)) + '</td><td>' + esc(SOURCE_LABEL[t.source] || t.source) + '</td><td>' + v + per + '</td><td><button class="arc-btn-sm" data-del-traffic="' + t.id + '">削除</button></td></tr>';
      }).join('');
      var actRows = actions.map(function (a) {
        var doneForm = a.status === 'done' ? '' :
          '<div class="arc-row arc-done-form"><input class="arc-input" type="date" data-act-date="' + a.id + '" value="' + new Date().toISOString().slice(0, 10) + '">' +
          '<input class="arc-input" data-act-url="' + a.id + '" placeholder="証拠のURL（公開ページ）"><button type="button" class="arc-btn-sm" data-done-action="' + a.id + '">実施済みにする</button></div>';
        return '<tr><td>' + esc(a.done_on || '') + '</td><td>' + esc(a.title) + (a.evidence_url ? ' <a href="' + esc(a.evidence_url) + '" target="_blank" rel="noopener noreferrer">証拠 ↗</a>' : '') + doneForm + '</td><td>' + (a.status === 'done' ? '実施済み' : '<span class="arc-chip is-warn">予定</span>') + '</td><td><button class="arc-btn-sm" data-del-action="' + a.id + '">削除</button></td></tr>';
      }).join('');
      var scanRows = scans.slice(0, 12).map(function (s) {
        return '<tr><td>' + esc(day(s.createdAt)) + '</td><td>' + esc(s.url) + '</td><td>' + (s.overallScore == null ? '—' : esc(s.overallScore) + '点') + '</td><td>' + esc((s.gaps || []).length) + '件</td></tr>';
      }).join('');
      var repRows = reports.map(function (r) {
        return '<tr><td>' + esc(ym(r.period_month)) + '</td><td>' + statusChip(r.status) + '</td><td><a href="#/r/' + r.id + '">編集</a> · <a href="/airreach/app/report/?id=' + r.id + '">表示・PDF</a></td></tr>';
      }).join('');

      var fromStudio = studioActionsFor(id), fromMeasure = studioMeasureFor(id);
      navClient = { href: studioHref(c, sites), name: c.name };
      var hid = function (k) { return curSec === k ? '' : ' hidden'; };
      var repBadge = repNow ? (REPORT_STATUS[repNow.status] || [repNow.status])[0] : '';
      shell(curSec === 'home' ? c.name : SEC_LABEL[curSec], '<div data-sec="home"' + hid('home') + '>' + (fromMeasure ? studioMeasureCard(fromMeasure) : '') + (fromStudio ? studioActionsCard(fromStudio) : '') + overview + (overview ? '' : '<div id="arc-rq"></div>') + '</div>' +
        '<section class="arc-card arc-sec" data-sec="reports"' + hid('reports') + '>' + flowStrip(plan, 5) + '<div class="arv-home-head"><p class="arc-lead">' + esc(secLead('reports')) + '</p></div>' +
        '<form id="arc-make-report" class="arc-row"><input class="arc-input" type="month" id="arc-report-month" value="' + thisMonth() + '" required>' +
        '<button class="arc-btn" type="submit">この月の下書きを作る</button></form>' +
        '<p class="arc-note">結論・次の3施策・判断事項は、下書きを作ったあとに編集画面で書きます。</p>' +
        '<table class="arc-table"><tbody>' + (repRows || '<tr><td class="arc-empty">まだありません</td></tr>') + '</tbody></table></section>' +

        fold('sites', SEC_LABEL.sites, sites.length + 'サイト・診断' + scans.length + '件') +
        '<ul class="arc-list">' + (sites.map(function (s) { return '<li>' + esc(s.url) + ' <button class="arc-btn-sm" data-del-site="' + s.id + '">削除</button></li>'; }).join('') || '<li class="arc-empty">まだありません</li>') + '</ul>' +
        '<form id="arc-add-site" class="arc-row"><input class="arc-input" id="arc-site-url" placeholder="https://example.jp/" required><button class="arc-btn" type="submit">サイトを追加</button></form>' +
        '<p class="arc-note">診断は、左のメニューの <a href="' + esc(studioHref(c, sites) + '#start') + '">「サイトを調べる」</a>（または <a href="/airreach/" target="_blank" rel="noopener">無料診断</a>）で行います。同じサイト（www. の有無は同一）の診断がここに並びます。</p>' +
        '<table class="arc-table"><thead><tr><th>日付</th><th>URL</th><th>点数</th><th>不足</th></tr></thead><tbody>' + (scanRows || '<tr><td colspan="4" class="arc-empty">まだありません</td></tr>') + '</tbody></table></div></section>' +

        fold('runs', SEC_LABEL.runs, runs.length + '回') +
        '<div id="arc-schedule" class="arc-schedule"><p class="arc-note">定期計測の設定を読み込んでいます…</p></div>' +
        '<details class="arc-dev"><summary>社内向け：計測スクリプトの結果（summary.json）を取り込む</summary>' + '<form id="arc-add-run" class="arc-row"><input class="arc-input" type="date" id="arc-run-date" required><input class="arc-input" type="file" id="arc-run-file" accept=".json,application/json" required><button class="arc-btn" type="submit">summary.json を取り込む</button></form>' +
        '<p class="arc-note">社内の計測スクリプトが出力する summary.json（runs/&lt;実行名&gt;/summary.json）を選びます。</p></details>' +
        '<table class="arc-table"><thead><tr><th>計測日</th><th>質問の版</th><th>主な質問の引用率・言及率</th><th></th></tr></thead><tbody>' + (runRows || '<tr><td colspan="4" class="arc-empty">まだありません</td></tr>') + '</tbody></table></div></section>' +

        fold('traffic', SEC_LABEL.traffic, traffic.length + '件', flowStrip(plan, 3)) +
        googleSyncForm(id, sites, traffic) +
        '<details class="arc-dev"><summary>Google とつながない場合：CSV で取り込む・手で入力する</summary>' +
        '<form id="arc-add-gsc" class="arc-row"><input class="arc-input" type="month" id="arc-gsc-month" value="' + thisMonth() + '" required><input class="arc-input" type="file" id="arc-gsc-file" accept=".csv,text/csv" required><button class="arc-btn" type="submit">Search Console の CSV を取り込む</button></form>' +
        '<p class="arc-note">Search Console の「検索パフォーマンス」→「エクスポート」→ CSV の、日付の表（グラフ.csv / Chart.csv）を選びます。</p>' +
        '<form id="arc-add-ga4" class="arc-row"><input class="arc-input" type="month" id="arc-ga4-month" value="' + thisMonth() + '" required>' +
        '<input class="arc-input" type="number" min="0" id="arc-ga4-sessions" placeholder="セッション">' +
        '<input class="arc-input" type="number" min="0" id="arc-ga4-ai" placeholder="AI経由セッション">' +
        '<input class="arc-input" type="number" min="0" id="arc-ga4-pv" placeholder="対象ページ閲覧">' +
        '<input class="arc-input" type="number" min="0" id="arc-ga4-cv" placeholder="問い合わせ・予約">' +
        '<button class="arc-btn" type="submit">GA4 の数値を保存</button></form>' +
        '</details>' +
        '<table class="arc-table"><thead><tr><th>月</th><th>取得元</th><th>数値</th><th></th></tr></thead><tbody>' + (trRows || '<tr><td colspan="4" class="arc-empty">まだありません</td></tr>') + '</tbody></table></div></section>' +

        fold('actions', SEC_LABEL.actions, actions.length + '件', flowStrip(plan, 4)) +
        '<form id="arc-add-action" class="arc-row"><input class="arc-input" type="date" id="arc-act-date"><input class="arc-input" id="arc-act-title" placeholder="やったこと（例: よくある質問を5問追加）" required>' +
        '<input class="arc-input" id="arc-act-url" placeholder="証拠のURL（公開ページ）"><select class="arc-input" id="arc-act-status"><option value="done">実施済み</option><option value="planned">予定</option></select>' +
        '<button class="arc-btn" type="submit">追加</button></form>' +
        '<table class="arc-table"><tbody>' + (actRows || '<tr><td class="arc-empty">まだありません</td></tr>') + '</tbody></table></div></section>' +

        fold('members', SEC_LABEL.members, members.length + '人') +
        '<ul class="arc-list">' + (members.map(function (m) { return '<li>' + esc(m.email) + ' <button class="arc-btn-sm" data-resend-member="' + esc(m.email) + '">ログインメールを再送</button> <button class="arc-btn-sm" data-del-member="' + esc(m.email) + '">削除</button></li>'; }).join('') || '<li class="arc-empty">まだいません</li>') + '</ul>' +
        '<form id="arc-add-member" class="arc-row"><input class="arc-input" type="email" id="arc-member-email" placeholder="client@example.jp" required><button class="arc-btn" type="submit">招待（ログイン用のメールを送る）</button></form>' +
        '<p class="arc-note">招待すると、お客様に「AirReach ログイン用リンク」のメール（送信元 no-reply@trillion-bank.com）が届きます。リンクの有効期限は1時間です。切れたら「ログインメールを再送」を押してください。お客様に見えるのは、自社の公開済みのレポートだけです。</p>' +
        ownerDueBlock(c, staffList) +
        googleDataBlock(c) +
        '</div></section>',
        '', { client: { id: c.id, name: c.name, site: sites[0] && sites[0].url, industry: c.industry_id }, sec: curSec, reportBadge: repBadge, kicker: curSec === 'home' ? '' : c.name,
          action: '' });

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
      loadSchedule(c, sites);
      bindGoogleData(c);
      bindOwnerDue(c);
      if (curSec === 'home') mountRequests(c.id, sites, true, c.name);
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
      var byId = function (list, k, v) { return list.filter(function (x) { return String(x[k]) === String(v); })[0]; };
      root.querySelectorAll('[data-del-site]').forEach(function (b) { b.addEventListener('click', function () {
        var row = byId(sites, 'id', b.getAttribute('data-del-site'));
        guardedDelete({ client: c, what: 'サイト', detail: row.url, date: '登録 ' + day(row.created_at), table: 'client_sites', match: [['id', row.id]], row: row, sec: 'sites',
          note: 'サイトを外すと、このサイトの診断がこの顧客の画面・月次レポートに出なくなります（診断そのものは消えません）。60秒以内なら取り消せます。' });
      }); });
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
      root.querySelectorAll('[data-del-member]').forEach(function (b) { b.addEventListener('click', function () {
        var row = byId(members, 'email', b.getAttribute('data-del-member'));
        guardedDelete({ client: c, what: '閲覧メンバー', detail: row.email, date: '招待 ' + day(row.created_at), table: 'client_members', match: [['client_id', id], ['email', row.email]], row: row, sec: 'members',
          note: '削除すると、この人はこの顧客のレポートを見られなくなります。60秒以内なら取り消せます（招待のメールは送り直しません）。' });
      }); });
      root.querySelectorAll('[data-del-run]').forEach(function (b) { b.addEventListener('click', function () {
        var row = byId(runs, 'id', b.getAttribute('data-del-run'));
        guardedDelete({ client: c, what: 'AI 計測', detail: '質問の版 ' + (row.query_set_version || '—') + '・' + (row.run_label || ''), date: '計測 ' + row.measured_on, table: 'measurement_runs', match: [['id', row.id]], row: row, sec: 'runs',
          note: '削除すると、この計測が月次レポートの AI の数字から外れます。60秒以内なら取り消せます（定期計測の実行記録とのつながりは戻りません）。' });
      }); });
      root.querySelectorAll('[data-del-traffic]').forEach(function (b) { b.addEventListener('click', function () {
        var row = byId(traffic, 'id', b.getAttribute('data-del-traffic'));
        guardedDelete({ client: c, what: '検索・訪問の数字', detail: (SOURCE_LABEL[row.source] || row.source), date: ymJa(row.period_month) + '分', table: 'traffic_snapshots', match: [['id', row.id]], row: row, sec: 'traffic' });
      }); });
      root.querySelectorAll('[data-done-action]').forEach(function (b) {
        b.addEventListener('click', function () {
          var aid = b.getAttribute('data-done-action'), d = $('[data-act-date="' + aid + '"]').value, u = $('[data-act-url="' + aid + '"]').value.trim();
          if (!d) { msg('実施日を入れてください', 'error'); return; }
          openFolds.actions = true;
          done(sb.from('action_items').update({ status: 'done', done_on: d, evidence_url: u || null }).eq('id', aid));
        });
      });
      root.querySelectorAll('[data-del-action]').forEach(function (b) { b.addEventListener('click', function () {
        var row = byId(actions, 'id', b.getAttribute('data-del-action'));
        guardedDelete({ client: c, what: '施策', detail: row.title, date: row.status === 'done' ? '実施 ' + (row.done_on || '') : '予定（登録 ' + day(row.created_at) + '）', table: 'action_items', match: [['id', row.id]], row: row, sec: 'actions' });
      }); });

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

  // ---- 削除の確認と取り消し ---------------------------------------------------------
  // 画面の中の確認（ブラウザの確認ダイアログは使わない）。キャンセル・Esc・外側のクリックでは何もしない
  function confirmBox(o) {
    return new Promise(function (resolve) {
      var d = document.createElement('dialog');
      d.className = 'arc-dialog';
      d.setAttribute('aria-labelledby', 'arc-dialog-t');
      d.innerHTML = '<form method="dialog"><h2 class="arc-h2" id="arc-dialog-t">' + esc(o.title) + '</h2>' +
        '<dl class="arc-dialog-dl">' + o.rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>' +
        '<p class="arc-note">' + esc(o.note) + '</p>' +
        '<div class="arc-row arc-dialog-b"><button class="arc-btn arc-btn-line" value="cancel" autofocus>やめる</button><button class="arc-btn arc-btn-danger" value="ok">' + esc(o.ok || '削除する') + '</button></div></form>';
      document.body.appendChild(d);
      d.addEventListener('close', function () { var ok = d.returnValue === 'ok'; d.remove(); resolve(ok); });
      d.addEventListener('click', function (e) { if (e.target === d) d.close('cancel'); });
      if (d.showModal) d.showModal(); else { d.setAttribute('open', ''); }
    });
  }
  var UNDO_MS = 60000, undoTimer = null;
  // 消した行をそのまま入れ直すと元に戻る（同じ ID）。取り消せるのはこの画面で60秒以内
  function showUndo(text, restore) {
    var box = $('#arc-undo');
    if (!box) return;
    if (undoTimer) clearTimeout(undoTimer);
    box.hidden = false;
    box.innerHTML = '<span>' + esc(text) + '（60秒以内なら取り消せます。画面を移ると取り消せません）</span><button type="button" class="arc-btn-sm" id="arc-undo-b">取り消す</button>';
    $('#arc-undo-b').addEventListener('click', function () {
      clearTimeout(undoTimer); box.hidden = true;
      restore().then(function () { msg('削除を取り消しました', 'ok'); }).catch(fail);
    });
    undoTimer = setTimeout(function () { box.hidden = true; }, UNDO_MS);
  }
  /**
   * 削除：確認 → 削除 → 画面を作り直し → 取り消しの案内。o = { client, what, detail, date, table, match: [[列, 値]], row（入れ直す行）, note, sec }
   */
  function guardedDelete(o) {
    return confirmBox({ title: o.what + 'を削除しますか？', rows: [['顧客', o.client.name], ['対象', o.detail], ['日付', o.date || '—']],
      note: o.note || '削除すると、月次レポートの集計から外れます。削除のあと60秒以内なら、この画面で取り消せます。' }).then(function (ok) {
      if (!ok) { msg('削除しませんでした'); return; }
      var qd = sb.from(o.table).delete();
      o.match.forEach(function (m) { qd = qd.eq(m[0], m[1]); });
      return qd.then(function (res) { q(res); openFolds[o.sec] = true; return clientStaff(o.client.id, curSec); }).then(function () {
        msg(o.what + 'を削除しました：' + o.detail, 'ok');
        showUndo(o.what + 'を削除しました', function () {
          return sb.from(o.table).insert(o.row).then(function (r2) { q(r2); openFolds[o.sec] = true; return clientStaff(o.client.id, curSec); });
        });
      });
    }).catch(fail);
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
  //   - 数字の鮮度：下書きの数字（作成時の集計）と、いまの材料で集計し直した結果を比べ、新しいデータがあれば知らせる。
  //     下書きなら「数字を最新化」（文章はそのまま）。確認中・承認済み・公開済みは、いまの手順（下書きに戻す→確認・承認をやり直す）で
  //   - 自動保存：下書きの文章は入力のたびに端末へ控えを残し、少し待って保存する（状態だけは送らない）。保存中・失敗も常に表示する
  //   - 画面の移動・顧客の切り替え・再読み込みの前に保存を試み、未保存なら離脱を確認する。保存は常にこのレポートの ID に対して行う
  var DRAFT_KEY = 'airreach_report_draft_v1:';
  function draftBackup(rid) {
    return {
      read: function () { try { return JSON.parse(localStorage.getItem(DRAFT_KEY + rid) || 'null'); } catch (e) { return null; } },
      write: function (payload) { try { localStorage.setItem(DRAFT_KEY + rid, JSON.stringify({ payload: payload, at: new Date().toISOString() })); } catch (e) {} },
      clear: function () { try { localStorage.removeItem(DRAFT_KEY + rid); } catch (e) {} }
    };
  }
  function reportEditor(rid) {
    var S = window.AirReachStaff, R = window.AirReachReport;
    return sb.from('reports').select('*, clients(name,industry_id)').eq('id', rid).maybeSingle().then(function (res) {
      var r = q(res); if (!r) throw new Error('レポートが見つかりません');
      var soft = function (p) { return p.then(function (x) { return x.error ? [] : (x.data || []); }, function () { return []; }); };
      return Promise.all([
        approvalOn() ? sb.from('report_events').select('action,actor,note,created_at').eq('report_id', rid).order('created_at', { ascending: true }) : Promise.resolve({ data: [] }),
        approvalOn() ? sb.from('staff_members').select('email,name,can_approve') : Promise.resolve({ data: [] }),
        // 数字の鮮度を比べるための、いまの材料
        soft(sb.from('client_sites').select('*').eq('client_id', r.client_id).order('created_at')),
        sb.rpc('airreach_client_scans', { p_client_id: r.client_id }).then(function (x) { return x.data || []; }, function () { return []; }),
        soft(sb.from('measurement_runs').select('id,measured_on,run_label,query_set_version,summary,created_at').eq('client_id', r.client_id)),
        soft(sb.from('traffic_snapshots').select('*').eq('client_id', r.client_id)),
        soft(sb.from('action_items').select('*').eq('client_id', r.client_id))
      ]).then(function (x) { return [r, q(x[0]) || [], q(x[1]) || [], x[2], x[3], x[4], x[5], x[6]]; });
    }).then(function (pack) {
      var r = pack[0], events = pack[1], staff = pack[2], sites = pack[3];
      var flow = approvalOn();
      var editable = !flow || r.status === 'draft';
      var cname = (r.clients && r.clients.name) || '';
      var client = { id: r.client_id, name: cname, industry_id: r.clients && r.clients.industry_id };
      var live = null;
      try { live = R.compileReport({ client: client, periodMonth: r.period_month, scans: pack[4], runs: pack[5], traffic: pack[6], actions: pack[7] }); } catch (e) { live = null; }
      var fresh = live ? S.freshness(r.compiled || {}, live) : null;
      function who(email) { var s2 = staff.filter(function (x) { return x.email === email; })[0]; return s2 && s2.name ? s2.name : (email || ''); }
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
        (r.status === 'in_review' && me.can_approve && me.email !== r.submitted_by ? '<label class="arc-field" for="arc-review-note"><span>差し戻す理由（差し戻すときは必須・担当者に表示）</span><textarea class="arc-input arc-ta" id="arc-review-note" rows="2" maxlength="1000"></textarea></label>' : '') +
        (events.length ? '<details class="arc-history"><summary>履歴（' + events.length + '件）</summary><ul class="arc-list">' + events.map(function (e) {
          return '<li>' + esc(jst(e.created_at)) + '　' + esc(ACT[e.action] || e.action) + '　' + esc(who(e.actor) || '管理者') + (e.note && e.action === 'returned' ? '：' + esc(e.note) : '') + '</li>';
        }).join('') + '</ul></details>' : '') +
        '</section>';
      var cmp = r.compiled || {};
      var concl = (r.conclusions || []).concat(['', '', '']).slice(0, 3);
      var next = (r.next_actions || []).concat([{}, {}, {}]).slice(0, 3);
      var decisions = (r.client_decisions || []).join('\n');
      var studioH = studioHref(client, sites);
      navClient = { href: studioH, name: cname };

      // 数字の鮮度
      var srcLine = function (c2) {
        var cur = c2.site && c2.site.current, ai = c2.ai, tr = c2.traffic || {};
        var pg = tr.gsc ? S.periodOf(tr.gsc, c2.periodMonth) : null, pa = tr.ga4 ? S.periodOf(tr.ga4, c2.periodMonth) : null;
        return [cur ? '診断 ' + day(cur.createdAt) : '診断なし', ai ? 'AI 計測 ' + (ai.runs || 1) + '回（最新 ' + String(ai.measuredOn || '').slice(5).replace('-', '/') + '）' : 'AI 未計測',
          pg ? 'Search Console ' + pg.short : 'Search Console 未計測', pa ? 'GA4 ' + pa.short : 'GA4 未計測'].join('・');
      };
      var freshCard = !fresh ? '' : '<section class="arc-card arc-fresh' + (fresh.stale ? ' is-stale' : '') + '" id="arc-fresh"><div class="arc-fresh-h"><b>' +
        (fresh.stale ? '新しいデータがあります' : '数字は最新の材料と同じです') + '</b><span class="arc-sub">この下書きの数字は ' + esc(fresh.compiledAtLabel || '（日時の記録なし）') + ' に集計</span></div>' +
        '<p class="arc-note">集計に使った材料：' + esc(srcLine(cmp)) + '</p>' +
        (fresh.stale ? '<ul class="arc-fresh-l">' + fresh.changes.map(function (x) { return '<li><span>' + esc(x.label) + '</span>' + esc(x.from) + ' → <b>' + esc(x.to) + '</b></li>'; }).join('') + '</ul>' +
          (editable ? '<div class="arc-row"><button type="button" class="arc-btn" id="arc-refresh">数字を最新化する（結論・施策・判断事項はそのまま）</button></div>'
            : '<p class="arc-note">このレポートは「' + esc((REPORT_STATUS[r.status] || [r.status])[0]) + '」のため、数字は変えません。最新化するには、下の「下書きに戻して直す」（承認済み）・「依頼を取り下げる」（確認中）・「非公開に戻す」（公開済み）で下書きに戻してください。確認と承認はやり直しになります。</p>') : '') +
        '</section>';

      var reqConcl = function (i) { return i === 0 ? '（必須）' : '（任意）'; };
      shell(ymJa(r.period_month) + ' のレポート',
        '<div class="arc-editbar" id="arc-editbar"><span class="arc-editbar-t"><b>' + esc(cname) + '</b> · ' + esc(ymJa(r.period_month)) + ' ' + statusChip(r.status) + '</span>' +
          (editable ? '<span class="arc-save-state" id="arc-save-state" role="status" aria-live="polite">保存済み</span><button type="button" class="arc-btn-sm" id="arc-save-now">今すぐ保存</button>' : '<span class="arc-sub">' + (flow ? '下書きではないため編集できません' : '') + '</span>') +
          (flow && r.status === 'draft' ? '<button type="button" class="arc-btn" id="arc-submit">確認を依頼する</button>' : '') + '</div>' +
        '<div id="arc-restore"></div>' + freshCard +
        (window.AirReachCharts && cmp.site ? '<section class="arc-card"><h2 class="arc-h2">今月の数字（お客様にもこの形で見えます）</h2>' + window.AirReachCharts.tiles(cmp) + '</section>' : '') +
        '<section class="arc-card"><h2 class="arc-h2">自動で集めた事実</h2><ul class="arc-list">' +
        ((cmp.facts || []).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') || '<li class="arc-empty">材料がありません</li>') + '</ul>' +
        ((cmp.missing || []).length ? '<p class="arc-note">未計測: ' + esc(cmp.missing.join('、')) + '（レポートには「未計測」と表示されます）</p>' : '') + '</section>' +
        '<p class="arc-hint">結論・次の施策・判断事項は、<b>お客様がそのまま読む欄</b>です。専門用語（構造化データ、llms.txt、robots.txt など）は避け、「検索やAIが読み取れる形で店舗情報を埋め込む」のように言い換えてください。</p>' +
        '<form id="arc-report-form"><section class="arc-card"><h2 class="arc-h2">今月の結論</h2><p class="arc-req">1〜3件。<b>最低1件は必須</b>（確認を依頼する条件）。</p>' +
        concl.map(function (t, i) { return '<label class="arc-field" for="arc-concl-' + i + '"><span>結論 ' + (i + 1) + reqConcl(i) + '</span><textarea class="arc-input arc-ta" id="arc-concl-' + i + '" data-concl="' + i + '" rows="2">' + esc(t) + '</textarea></label>'; }).join('') + '</section>' +
        (window.AirReachCharts && cmp.site && cmp.site.current ? '<section class="arc-card"><h2 class="arc-h2">施策の候補（診断の不足・優先度の高い順）</h2>' + window.AirReachCharts.todos(R.todoList(cmp), { audience: 'staff', limit: 6, pick: true, studioHref: studioH + '#generator' }) + '</section>' : '') +
        '<section class="arc-card"><h2 class="arc-h2">次にやる施策</h2><p class="arc-req">1〜3件。<b>最低1件は必須</b>（確認を依頼する条件）。施策名を入れた行だけが保存されます。担当と期限は任意です。</p>' +
        next.map(function (a, i) {
          return '<fieldset class="arc-next-row"><legend>施策 ' + (i + 1) + reqConcl(i) + '</legend>' +
            '<label class="arc-field arc-f-title" for="arc-next-title-' + i + '"><span>施策名</span><input class="arc-input" id="arc-next-title-' + i + '" data-next-title="' + i + '" value="' + esc(a.title || '') + '"></label>' +
            '<label class="arc-field" for="arc-next-owner-' + i + '"><span>担当（任意）</span><input class="arc-input" id="arc-next-owner-' + i + '" data-next-owner="' + i + '" placeholder="例: 制作会社" value="' + esc(a.owner || '') + '"></label>' +
            '<label class="arc-field" for="arc-next-due-' + i + '"><span>期限（任意）</span><input class="arc-input" type="date" id="arc-next-due-' + i + '" data-next-due="' + i + '" value="' + esc(a.due || '') + '"></label></fieldset>';
        }).join('') + '</section>' +
        '<section class="arc-card"><label class="arc-field" for="arc-decisions"><span class="arc-h2">お客様に判断いただきたいこと（任意・1行に1件）</span><textarea class="arc-input arc-ta" id="arc-decisions" rows="3">' + esc(decisions) + '</textarea></label></section>' +
        approvalCard +
        '<div class="arc-row">' +
        (!flow ? (editable ? '<button class="arc-btn" type="submit">保存</button>' : '') + (r.status === 'published' ? '<button class="arc-btn arc-btn-line" type="button" id="arc-unpublish">非公開に戻す</button>' : '<button class="arc-btn arc-btn-line" type="button" id="arc-publish">公開する（お客様が見られる）</button>') :
          r.status === 'draft' ? '' :
          r.status === 'in_review' ? (me.can_approve && me.email !== r.submitted_by ? '<button class="arc-btn" type="button" id="arc-approve">承認する</button><button class="arc-btn arc-btn-line" type="button" id="arc-return">差し戻す</button>' :
            (me.email === r.submitted_by ? '<button class="arc-btn arc-btn-line" type="button" id="arc-withdraw">依頼を取り下げる</button>' : '<span class="arc-sub">承認待ちです</span>')) :
          r.status === 'approved' ? '<button class="arc-btn" type="button" id="arc-publish">公開する（お客様が見られる）</button><button class="arc-btn arc-btn-line" type="button" id="arc-return">下書きに戻して直す</button>' :
          '<button class="arc-btn arc-btn-line" type="button" id="arc-unpublish">非公開に戻す</button>') +
        '<a class="arc-btn arc-btn-line" href="/airreach/app/report/?id=' + r.id + '">表示・PDF</a></div></form>',
        '', { client: { id: r.client_id, name: cname, site: sites[0] && sites[0].url, industry: r.clients && r.clients.industry_id }, sec: 'reports', kicker: '月次レポート · ' + cname, mobileTitle: ymJa(r.period_month) + ' のレポート' });

      var fieldsSel = '#arc-report-form [data-concl], #arc-report-form [data-next-title], #arc-report-form [data-next-owner], #arc-report-form [data-next-due], #arc-decisions';
      if (!editable) {
        Array.prototype.forEach.call(root.querySelectorAll(fieldsSel + ', [data-pick-todo]'), function (el) { el.disabled = true; });
      }
      // 画面を移ったあと（入力欄が無いとき）は、最後に読んだ内容を使う（ほかの画面の欄は読まない）
      var form0 = $('#arc-report-form'), lastCollected = null;
      function collect() {
        if (!form0 || !document.body.contains(form0)) return lastCollected;
        lastCollected = collect0();
        return lastCollected;
      }
      function collect0() {
        var c3 = [0, 1, 2].map(function (i) { return $('[data-concl="' + i + '"]').value.trim(); }).filter(Boolean);
        var n3 = [0, 1, 2].map(function (i) {
          return { title: $('[data-next-title="' + i + '"]').value.trim(), owner: $('[data-next-owner="' + i + '"]').value.trim(), due: $('[data-next-due="' + i + '"]').value };
        }).filter(function (a) { return a.title; });
        var d = $('#arc-decisions').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
        return { conclusions: c3, next_actions: n3, client_decisions: d };
      }
      function fill(p) {
        [0, 1, 2].forEach(function (i) {
          $('[data-concl="' + i + '"]').value = (p.conclusions || [])[i] || '';
          var a = (p.next_actions || [])[i] || {};
          $('[data-next-title="' + i + '"]').value = a.title || ''; $('[data-next-owner="' + i + '"]').value = a.owner || ''; $('[data-next-due="' + i + '"]').value = a.due || '';
        });
        $('#arc-decisions').value = (p.client_decisions || []).join('\n');
      }
      // このレポートの中身だけを保存する（状態は変えない）。下書きでなくなっていたら保存しない
      function saveContent(payload, extra) {
        var qu = sb.from('reports').update(Object.assign({}, payload, { updated_by: me.email }, extra || {})).eq('id', r.id);
        // 確認・承認の流れがあるときは、下書きのときだけ中身を保存する（確認中・承認済み・公開済みを書き換えない）
        if (flow) qu = qu.eq('status', 'draft');
        return qu.select('id').then(function (res) {
          var rows = q(res);
          if (flow && Array.isArray(rows) && !rows.length) throw new Error('このレポートは下書きではなくなったため、保存できませんでした（入力はこの端末に残っています）');
        });
      }
      var backup = draftBackup(r.id), as = null;
      if (editable) {
        var stEl = $('#arc-save-state');
        var setState = function (st, info) {
          var t = st === 'dirty' ? '未保存の変更があります' : st === 'saving' ? '保存中…' : st === 'saved' ? '保存済み' + (info.at ? '（' + localTime(info.at.toISOString()).slice(11) + '）' : '') :
            st === 'error' ? '保存できませんでした（入力はこの端末に残っています）' : '保存済み';
          stEl.textContent = t; stEl.className = 'arc-save-state is-' + st;
        };
        as = new S.Autosave({ delay: 1500, collect: collect, save: function (p) { return saveContent(p); }, onState: function (st, info) { if (document.body.contains(stEl)) setState(st, info); }, backup: backup });
        if (editorAutosave) editorAutosave.stop();
        editorAutosave = as;
        as.markSaved(collect());
        Array.prototype.forEach.call(root.querySelectorAll(fieldsSel), function (el) { el.addEventListener('input', function () { as.changed(); }); el.addEventListener('change', function () { as.changed(); }); });
        $('#arc-save-now').addEventListener('click', function () { as.flush().catch(fail); });
        // この端末に、保存されていない入力が残っていれば知らせる（再読み込み・通信の失敗のあと）
        var bk = backup.read();
        if (bk && bk.payload && JSON.stringify(bk.payload) !== JSON.stringify(collect())) {
          $('#arc-restore').innerHTML = '<section class="arc-card arc-restore" role="alert"><b>この端末に、保存されていない入力があります（' + esc(localTime(bk.at)) + '）</b>' +
            '<p class="arc-note">' + (Date.parse(r.updated_at) > Date.parse(bk.at) ? 'ただし、そのあとにサーバーの内容が更新されています（' + esc(localTime(r.updated_at)) + '）。中身を見比べてから選んでください。' : '前回、保存する前に画面を閉じたか、保存に失敗した入力です。') + '</p>' +
            '<div class="arc-row"><button type="button" class="arc-btn" id="arc-restore-yes">その入力を戻す</button><button type="button" class="arc-btn arc-btn-line" id="arc-restore-no">破棄する（いまの内容を使う）</button></div></section>';
          $('#arc-restore-yes').addEventListener('click', function () { fill(bk.payload); $('#arc-restore').innerHTML = ''; as.changed(); msg('端末に残っていた入力を戻しました。自動で保存します', 'ok'); });
          $('#arc-restore-no').addEventListener('click', function () { backup.clear(); $('#arc-restore').innerHTML = ''; });
        }
        // 画面を移る・顧客を切り替える・再読み込みする前に、保存を済ませる
        leaveGuard = function () { var a2 = as; return (a2.dirty() ? a2.flush().catch(function () { /* 端末の控えは残る */ }) : Promise.resolve()).then(function () { a2.stop(); }); };
        dirtyCheck = function () { return as.dirty(); };
      }
      // 候補の「次の施策に入れる」: 空いている最初の欄に直し方を入れる
      Array.prototype.forEach.call(root.querySelectorAll('[data-pick-todo]'), function (b) {
        b.addEventListener('click', function () {
          var slot = [0, 1, 2].map(function (i) { return $('[data-next-title="' + i + '"]'); }).filter(function (el) { return !el.value.trim(); })[0];
          if (!slot) { msg('次の施策は3件まで埋まっています。入れ替える場合は欄を空にしてください。', 'error'); return; }
          slot.value = b.getAttribute('data-pick-todo');
          slot.focus();
          b.disabled = true; b.textContent = '入れました';
          if (as) as.changed();
        });
      });
      // ボタンの連打を防ぐ（処理が終わるまで押せない）
      function once(btn, fn) {
        if (!btn) return;
        btn.addEventListener('click', function () {
          if (btn.disabled) return;
          btn.disabled = true;
          Promise.resolve().then(fn).catch(fail).then(function () { if (document.body.contains(btn)) btn.disabled = false; });
        });
      }
      var form = $('#arc-report-form');
      form.addEventListener('submit', function (e) { e.preventDefault(); if (as) as.flush().then(function () { msg('保存しました', 'ok'); }).catch(fail); else saveContent(collect()).then(function () { msg('保存しました', 'ok'); }).catch(fail); });
      // 状態だけを変える（中身は送らない）。決まりは DB のトリガが守る
      function setStatus(extra, done) {
        return sb.from('reports').update(Object.assign({ updated_by: me.email }, extra)).eq('id', r.id).then(function (res) { q(res); })
          .then(function () { return reportEditor(rid); }).then(function () { msg(done, 'ok'); });
      }
      once($('#arc-refresh'), function () {
        // 先に文章を保存してから、数字（compiled）だけを入れ替える
        return (as ? as.flush() : Promise.resolve()).then(function () {
          var qu = sb.from('reports').update({ compiled: live, updated_by: me.email }).eq('id', r.id);
          return (flow ? qu.eq('status', 'draft') : qu).select('id');
        }).then(function (res) {
          var rows = q(res);
          if (flow && Array.isArray(rows) && !rows.length) throw new Error('下書きではないため、数字を最新化できませんでした');
          return reportEditor(rid);
        }).then(function () { msg('数字を最新化しました（' + fresh.changes.map(function (x) { return x.label; }).join('・') + '）。結論・施策・判断事項はそのままです', 'ok'); });
      });
      once($('#arc-publish'), function () {
        if (flow) return setStatus({ status: 'published' }, '公開しました');
        var c = collect();
        if (!c.conclusions.length) { msg('公開する前に、結論を1つ以上書いてください', 'error'); return; }
        return saveContent(c, { status: 'published', published_at: new Date().toISOString() }).then(function () { backup.clear(); return reportEditor(rid); }).then(function () { msg('公開しました', 'ok'); });
      });
      once($('#arc-submit'), function () {
        var c = collect();
        if (!c.conclusions.length) { msg('確認を依頼する前に、結論を1つ以上書いてください', 'error'); $('[data-concl="0"]').focus(); return; }
        if (!c.next_actions.length) { msg('確認を依頼する前に、次にやる施策を1つ以上書いてください', 'error'); $('[data-next-title="0"]').focus(); return; }
        // いちばん新しい入力を保存してから、確認を依頼する
        return as.flush().then(function () { return saveContent(collect(), { status: 'in_review', review_note: null }); })
          .then(function () { backup.clear(); as.stop(); leaveGuard = null; dirtyCheck = null; return reportEditor(rid); })
          .then(function () { msg('確認を依頼しました（承認されるまで、お客様には見えません）', 'ok'); });
      });
      once($('#arc-approve'), function () { return setStatus({ status: 'approved' }, '承認しました。「公開する」でお客様に見えるようになります'); });
      once($('#arc-return'), function () {
        var note = $('#arc-review-note') ? $('#arc-review-note').value.trim() : '';
        if (r.status === 'in_review' && !note) { msg('差し戻す理由を書いてください', 'error'); return; }
        return setStatus({ status: 'draft', review_note: note || null }, r.status === 'in_review' ? '差し戻しました' : '下書きに戻しました（直したら、もう一度確認と承認が必要です）');
      });
      once($('#arc-withdraw'), function () { return setStatus({ status: 'draft', review_note: null }, '依頼を取り下げました'); });
      once($('#arc-unpublish'), function () {
        if (flow) return setStatus({ status: 'draft', review_note: null }, '非公開に戻しました（もう一度公開するには、確認と承認が必要です）');
        return saveContent(collect(), { status: 'draft', published_at: null }).then(function () { return reportEditor(rid); }).then(function () { msg('非公開に戻しました', 'ok'); });
      });
    });
  }

  boot();
})();
