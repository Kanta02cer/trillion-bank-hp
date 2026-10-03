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
        sb.auth.onAuthStateChange(function () { route(); });
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
    var N = window.AirReachNav, cl = ctx.client, n = 0;
    if (!N) return '';
    var head = cl ? '<a class="arc-side-back" href="#/">← 顧客一覧</a>' : '';
    return '<nav class="arc-side" aria-label="' + (cl ? '顧客の画面' : 'ダッシュボードの画面') + '">' + head +
      N.groups(!!cl).map(function (g) {
        return '<div class="arc-side-g">' + esc(g.group) + '</div>' + g.items.map(function (it) {
          n += 1;
          var on = it.where === 'dash' && ctx.sec === it.sec;
          var url = N.href(it, cl);
          if (it.where === 'dash') url = url.replace('/airreach/app/', ''); // 同じページの中は # だけで移る
          var badge = it.sec === 'reports' && ctx.reportBadge ? '<span class="arc-side-b">' + esc(ctx.reportBadge) + '</span>' : '';
          return '<a class="arc-side-i' + (on ? ' is-on' : '') + (it.where === 'studio' ? ' is-studio' : '') + '" href="' + esc(url) + '"' + (on ? ' aria-current="page"' : '') + '><span class="arc-side-n">' + n + '</span><span class="arc-side-l">' + esc(it.label) + (it.desc ? '<small>' + esc(it.desc) + '</small>' : '') + '</span>' + badge + '</a>';
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
      (staff ? '<nav class="arc-tools" aria-label="社内ツール"><a href="/airreach/sales/">営業キット</a><a href="/airreach/" target="_blank" rel="noopener">無料診断</a></nav>' : '') +
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
            '<span class="arc-client-r">' + st + (last ? '<small>最終診断 ' + esc(day(last.createdAt)) + '</small>' : '') + '</span></a>';
        }).join('') + '</div>';
      } else {
        list = '<ul class="arc-list">' + (rows.length ? rows.map(function (c) {
          return '<li><a href="#/c/' + c.id + '">' + esc(c.name) + '</a><span class="arc-sub">' + esc(INDUSTRY[c.industry_id] || '') + (c.status !== 'active' ? ' · ' + esc(c.status) : '') + '</span></li>';
        }).join('') : '<li class="arc-empty">' + (me.is_staff ? 'まだ顧客がありません。' : '閲覧できる顧客がありません。担当者にお問い合わせください。') + '</li>') + '</ul>';
      }
      var add = me.is_staff ?
        '<h2 class="arc-h2" style="margin-top:18px">顧客を追加する</h2><p class="arc-note" style="margin:0 0 6px">サイトの URL も入れると、追加したあとそのまま Studio でサイトを調べ、足りない情報の判定と AI での見え方の計測（Perplexity・ChatGPT）まで自動で行います。お客様によく聞かれる質問を入れておくと、AI に聞く質問の先頭に入ります。</p>' +
        '<form id="arc-add-client" class="arc-row"><input class="arc-input" id="arc-client-name" placeholder="顧客名（会社・店舗）" required>' +
        '<input class="arc-input" id="arc-client-url" type="text" inputmode="url" autocomplete="url" placeholder="サイトの URL（例: https://example.jp/）">' +
        '<textarea class="arc-input arc-client-qs" id="arc-client-qs" rows="3" placeholder="お客様によく聞かれる質問（任意・1行に1つ）&#10;例：個室はありますか？&#10;例：子ども連れでも大丈夫ですか？"></textarea>' +
        '<select class="arc-input" id="arc-client-ind">' + Object.keys(INDUSTRY).map(function (k) { return '<option value="' + k + '">' + INDUSTRY[k] + '</option>'; }).join('') + '</select>' +
        '<button class="arc-btn" type="submit">顧客を追加</button></form>' : '';
      shell(me.is_staff ? '顧客一覧' : 'レポート', '<section class="arc-card">' + list + add + '</section>', '', { sec: 'list' });
      if (me.is_staff) $('#arc-add-client').addEventListener('submit', function (e) {
        e.preventDefault();
        var name = $('#arc-client-name').value.trim(), ind = $('#arc-client-ind').value, rawUrl = $('#arc-client-url').value.trim();
        // お客様によく聞かれる質問は、Studio の「AI での見え方を測る」の質問の先頭に入る（Studio が開いたときに受け取る）
        var qs = $('#arc-client-qs').value.split(/\n+/).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 8);
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
        (reps.length ? reps.map(function (r) { return '<li><a href="/airreach/app/report/?id=' + r.id + '">' + esc(ymJa(r.period_month)) + ' のレポート</a>' + (r.published_at ? '<span class="arc-sub">公開 ' + esc(day(r.published_at)) + '</span>' : '') + '</li>'; }).join('') : '<li class="arc-empty">公開済みのレポートはまだありません。</li>') +
        '</ul></section>';
      // 見られる顧客が1社だけなら「戻る」は出さない（一覧に戻っても、この画面に戻されるため）
      shell(c.name, body, (me.client_ids || []).length > 1 ? '#/' : '', { client: { id: c.id, name: c.name } });
    });
  }
  /**
   * 今月の進め方：毎月の作業を順番に並べ、どこまで済んだかと「次にやること」を出す（社内向けホーム）。
   * 済み／まだ は登録された材料から判定する（手で付けるチェックは持たない）
   */
  function monthSteps(c, sites, live, repNow, actions) {
    var studio = studioHref(c, sites), base = '#/c/' + c.id + '/', mon = thisMonth();
    var cur = live.site.current, tr = live.traffic;
    var planned = actions.filter(function (a) { return a.status !== 'done'; });
    var madeThisMonth = actions.some(function (a) { return String(a.created_at || '').slice(0, 7) === mon; });
    var rs = repNow ? repNow.status : '';
    var md = function (d) { return String(d).slice(5, 10).replace('-', '/'); };
    var steps = [
      { title: 'サイトを調べる', what: 'URL を確かめて「分析する」を押すだけ', get: '整い具合の点数と、直すべきところ', time: '約1分',
        ok: !!(cur && cur.inMonth), note: cur && cur.inMonth ? md(day(cur.createdAt)) + ' 診断' : '', btn: '分析する', href: studio + '#start' },
      { title: '直すことを決めて、材料を渡す', what: '直す材料（よくある質問・お店の情報の下書き）を作り、お客様か制作会社に渡す', get: '渡した内容が「施策の予定」として残る', time: '約10分',
        ok: madeThisMonth || planned.length > 0 || live.actions.length > 0, note: planned.length ? '予定 ' + planned.length + '件' : '', btn: '直す材料を作る', href: studio + '#generator' },
      { title: 'AI での見え方を測る', what: '質問を確かめて「計測する」を押す', get: 'AI の回答に名前・サイトが出た割合、競合との比較', time: '約2分',
        ok: !!live.ai, note: live.ai ? md(live.ai.measuredOn) + ' 計測' : '', btn: '計測する', href: studio + '#hack2' },
      { title: '検索と訪問の数字を入れる', what: 'Google と連携していれば月を選ぶだけ', get: '検索のクリック、訪問、問い合わせの数', time: '約3分',
        ok: !!(tr.gsc && tr.ga4), note: tr.gsc || tr.ga4 ? (tr.gsc ? 'Search Console ✓' : 'Search Console まだ') + '・' + (tr.ga4 ? 'GA4 ✓' : 'GA4 まだ') : '', btn: '取り込む', href: base + 'traffic' },
      { title: 'やったことを記録する', what: '直したことを「実施済み」にして、公開したページの URL を入れる', get: 'レポートの「今月実施したこと」になる', time: '約3分',
        ok: live.actions.length > 0, note: live.actions.length ? live.actions.length + '件' : '', btn: '記録する', href: base + 'actions' },
      { title: '月次レポートを作って、確認を依頼する', what: '結論と次の施策を書いて、確認を依頼する', get: '承認されるとお客様に公開できる', time: '約15分',
        ok: rs === 'in_review' || rs === 'approved' || rs === 'published', note: repNow ? (REPORT_STATUS[rs] || [rs])[0] : '',
        btn: !repNow ? 'レポートを作る' : rs === 'draft' ? '続きを書く' : '開く', href: repNow ? '#/r/' + repNow.id : base + 'reports' },
      { title: 'お客様に公開する', what: '承認されたレポートを公開する（お客様の画面と PDF に出る）', get: 'お客様が今月の結果を見られる', time: '約1分',
        ok: rs === 'published', note: '', btn: rs === 'approved' ? '公開する' : '開く', href: repNow ? '#/r/' + repNow.id : base + 'reports' }
    ];
    var doneN = steps.filter(function (s) { return s.ok; }).length;
    var nextI = -1; steps.some(function (s, i) { if (!s.ok) { nextI = i; return true; } return false; });
    var next = nextI >= 0 ? steps[nextI] : null;
    var lead = next
      ? '<div class="arc-next"><div><div class="arc-next-k">次にやること</div><div class="arc-next-t">' + (nextI + 1) + '. ' + esc(next.title) + '</div>' +
        '<div class="arc-next-d">' + esc(next.what) + '（' + esc(next.time) + '）</div></div>' +
        '<a class="arc-btn arc-next-b" href="' + esc(next.href) + '">' + esc(next.btn) + ' →</a></div>'
      : '<div class="arc-next is-done"><div><div class="arc-next-k">今月の作業</div><div class="arc-next-t">✓ すべて済みました</div><div class="arc-next-d">来月の初めに、また「サイトを調べる」から始めます。</div></div></div>';
    var list = '<ol class="arc-msteps">' + steps.map(function (s, i) {
      var st = s.ok ? 'is-ok' : i === nextI ? 'is-next' : '';
      return '<li class="arc-mstep ' + st + '"><span class="arc-mstep-n" aria-hidden="true">' + (s.ok ? '✓' : i + 1) + '</span>' +
        '<div class="arc-mstep-b"><b>' + esc(s.title) + '</b><span>' + esc(s.what) + '</span></div>' +
        '<div class="arc-mstep-s"><span class="arc-mstep-st">' + (s.ok ? '✓ 済み' : i === nextI ? '次はここ' : 'まだ') + (s.note ? '<small>' + esc(s.note) + '</small>' : '') + '</span>' +
        '<a class="arc-btn-sm" href="' + esc(s.href) + '">' + esc(s.ok ? '見る' : s.btn) + '</a></div></li>';
    }).join('') + '</ol>';
    return '<section class="arc-card"><div class="arv-home-head"><div><h2 class="arc-h2">' + esc(ymJa(mon + '-01')) + 'の進め方</h2>' +
      '<p class="arc-note" style="margin:2px 0 0">上から順に進めると月次レポートが出せます。✓ は登録された材料から自動で付きます。</p></div>' +
      '<span class="arc-progress"><small>進み具合</small><b>' + doneN + ' / ' + steps.length + '</b></span></div>' + lead + list + '</section>';
  }

  /** ダッシュボード：AI での見え方（最新の計測の内訳。一般/指名・言及の順位） */
  function dashAi(run, live, studio) {
    var md = function (d) { return String(d).slice(5, 10).replace('-', '/'); };
    var bd = run && run.summary && run.summary.breakdown;
    var head = '<div class="arv-home-head"><h2 class="arc-h2">AI での見え方</h2><span class="arc-sub">' + (run ? esc(md(run.measured_on)) + ' の計測' + (bd && bd.types ? '・' + esc((bd.types.general.answers || 0) + (bd.types.branded.answers || 0)) + '回答' : '') : '') + '</span></div>';
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

  // 材料のカードは折りたたむ（開いた状態は再描画しても保つ）
  var openFolds = {};
  var curSec = 'home';
  // 顧客の画面の各節。いまの節だけを見せる（ほかも DOM に置き、フォームの結び付けはそのまま使う）
  function fold(key, title, count) {
    return '<section class="arc-card arc-sec" data-sec="' + key + '"' + (curSec === key ? '' : ' hidden') + '><div class="arv-home-head">' + (secLead(key) ? '<p class="arc-lead">' + esc(secLead(key)) + '</p>' : '<h2 class="arc-h2">' + esc(title) + '</h2>') + '<span class="arc-sub">' + esc(count) + '</span></div><div class="arc-fold-b">';
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
  function googleSyncForm(clientId, sites) {
    var p = googleProps(clientId), host = sites[0] && sites[0].host;
    var feats = ((document.cookie.match(/(?:^|;\s*)airreach_google_scopes=([^;]*)/) || [])[1] || '').split('.').filter(Boolean);
    var hasGsc = feats.indexOf('gsc') >= 0, hasGa4 = feats.indexOf('ga4') >= 0;
    var connect = '/api/google/auth/?back=app&client=' + encodeURIComponent(clientId);
    var studioG = (window.AirReachNav ? window.AirReachNav.studioBase({ id: clientId, site: sites && sites[0] && sites[0].url }) : '/airreach/studio/') + '#google';
    var ret = googleRet; googleRet = '';
    var RET = { connected: ['ok', 'Google とつながりました。月を選んで「Google から取得」を押してください。'], gsc_missing: ['warn', 'Search Console の閲覧が許可されませんでした。もう一度つなぎ、Search Console にチェックを入れてください。'],
      ga4_missing: ['warn', 'GA4 の閲覧が許可されませんでした（Search Console だけつながりました）。GA4 も使うときは、もう一度つないでチェックを入れてください。'], scope_missing: ['warn', '閲覧の許可がありませんでした。もう一度つないで、チェックを入れてください。'] };
    var state = feats.length
      ? '<span class="arc-chip is-ok">Google とつながっています</span> <span class="arc-sub">Search Console ' + (hasGsc ? '✓' : '—') + '・GA4 ' + (hasGa4 ? '✓' : '—') + '</span> <a class="arc-btn-sm" href="' + esc(connect) + '">つなぎ直す</a>'
      : '<span class="arc-chip is-warn">まだ Google とつながっていません</span> <a class="arc-btn" href="' + esc(connect) + '">Google とつなぐ</a>';
    return '<div class="arc-gbox"><div class="arc-gbox-h"><b>Google から取り込む（おすすめ）</b>' + state + '</div>' +
      (RET[ret] ? '<p class="arc-gmsg is-' + RET[ret][0] + '">' + esc(RET[ret][1]) + '</p>' : '') +
      '<form id="arc-google-sync" class="arc-row"><input class="arc-input" type="month" id="arc-g-month" value="' + thisMonth() + '" required>' +
      '<input class="arc-input" id="arc-g-gsc" placeholder="Search Console のサイト（例: sc-domain:example.jp）" value="' + esc(p.gsc != null ? p.gsc : (host ? 'sc-domain:' + host : '')) + '">' +
      '<input class="arc-input" id="arc-g-ga4" inputmode="numeric" placeholder="GA4 プロパティID（数字）" value="' + esc(p.ga4 || '') + '">' +
      '<button class="arc-btn" type="submit"' + (feats.length ? '' : ' disabled') + '>Google から取得</button></form>' +
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
  function googlePost(path, body) {
    return fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.ok) return j;
          var e = j.error && typeof j.error === 'object' ? (j.error.message || '') : (j.error || '');
          if (r.status === 401) e = 'Google に接続していません（または接続が切れています）。左のメニューの「Google とつなぐ」で「接続」してください';
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
        // ダッシュボード：今月の数字 → AI での見え方・今月の進み具合 → 直すこと・AI が参照したサイト → 推移
        var studioH = studioHref(c, sites);
        // サイトが登録されていないと、分析しても診断がこの顧客に紐づかない（ホームに何も出ない）
        if (!sites.length) overview += '<section class="arc-card arc-nosite"><b>この顧客にはサイトが登録されていません</b><p class="arc-note" style="margin:4px 0 8px">診断はサイトごとに保存されるため、サイトを登録するまでここには出ません。Studio で「サイトを調べる」を行うと、調べたサイトを自動で登録します。</p>' +
          '<a class="arc-btn" href="#/c/' + c.id + '/sites">サイトを登録する</a></section>';
        overview += '<section class="arc-card"><div class="arv-home-head"><h2 class="arc-h2">' + esc(ymJa(month)) + 'の数字</h2><span class="arc-sub">登録された材料からその場で集計</span></div>' +
          C.tiles(live) + '</section>' +
          '<div class="arc-dash-2">' + dashAi(runs[0], live, studioH) + monthSteps(c, sites, live, repNow, actions) + '</div>' +
          '<div class="arc-dash-2">' + dashTodos(R.todoList(live), live, studioH) + dashSources(runs[0], studioH) + '</div>' +
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
        return '<tr><td>' + esc(day(s.createdAt)) + '</td><td>' + esc(s.url) + '</td><td>' + (s.overallScore == null ? '—' : esc(s.overallScore) + '点') + '</td><td>' + esc((s.gaps || []).length) + '件</td></tr>';
      }).join('');
      var repRows = reports.map(function (r) {
        return '<tr><td>' + esc(ym(r.period_month)) + '</td><td>' + statusChip(r.status) + '</td><td><a href="#/r/' + r.id + '">編集</a> · <a href="/airreach/app/report/?id=' + r.id + '">表示・PDF</a></td></tr>';
      }).join('');

      var fromStudio = studioActionsFor(id), fromMeasure = studioMeasureFor(id);
      navClient = { href: studioHref(c, sites), name: c.name };
      var hid = function (k) { return curSec === k ? '' : ' hidden'; };
      var repBadge = repNow ? (REPORT_STATUS[repNow.status] || [repNow.status])[0] : '';
      shell(curSec === 'home' ? c.name : SEC_LABEL[curSec], '<div data-sec="home"' + hid('home') + '>' + (fromMeasure ? studioMeasureCard(fromMeasure) : '') + (fromStudio ? studioActionsCard(fromStudio) : '') + overview + '</div>' +
        '<section class="arc-card arc-sec" data-sec="reports"' + hid('reports') + '><div class="arv-home-head"><p class="arc-lead">' + esc(secLead('reports')) + '</p></div>' +
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
        
        '<details class="arc-dev"><summary>社内向け：計測スクリプトの結果（summary.json）を取り込む</summary>' + '<form id="arc-add-run" class="arc-row"><input class="arc-input" type="date" id="arc-run-date" required><input class="arc-input" type="file" id="arc-run-file" accept=".json,application/json" required><button class="arc-btn" type="submit">summary.json を取り込む</button></form>' +
        '<p class="arc-note">社内の計測スクリプトが出力する summary.json（runs/&lt;実行名&gt;/summary.json）を選びます。</p></details>' +
        '<table class="arc-table"><thead><tr><th>計測日</th><th>質問の版</th><th>主な質問の引用率・言及率</th><th></th></tr></thead><tbody>' + (runRows || '<tr><td colspan="4" class="arc-empty">まだありません</td></tr>') + '</tbody></table></div></section>' +

        fold('traffic', SEC_LABEL.traffic, traffic.length + '件') +
        googleSyncForm(id, sites) +
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

        fold('actions', SEC_LABEL.actions, actions.length + '件') +
        '<form id="arc-add-action" class="arc-row"><input class="arc-input" type="date" id="arc-act-date"><input class="arc-input" id="arc-act-title" placeholder="やったこと（例: よくある質問を5問追加）" required>' +
        '<input class="arc-input" id="arc-act-url" placeholder="証拠のURL（公開ページ）"><select class="arc-input" id="arc-act-status"><option value="done">実施済み</option><option value="planned">予定</option></select>' +
        '<button class="arc-btn" type="submit">追加</button></form>' +
        '<table class="arc-table"><tbody>' + (actRows || '<tr><td class="arc-empty">まだありません</td></tr>') + '</tbody></table></div></section>' +

        fold('members', SEC_LABEL.members, members.length + '人') +
        '<ul class="arc-list">' + (members.map(function (m) { return '<li>' + esc(m.email) + ' <button class="arc-btn-sm" data-resend-member="' + esc(m.email) + '">ログインメールを再送</button> <button class="arc-btn-sm" data-del-member="' + esc(m.email) + '">削除</button></li>'; }).join('') || '<li class="arc-empty">まだいません</li>') + '</ul>' +
        '<form id="arc-add-member" class="arc-row"><input class="arc-input" type="email" id="arc-member-email" placeholder="client@example.jp" required><button class="arc-btn" type="submit">招待（ログイン用のメールを送る）</button></form>' +
        '<p class="arc-note">招待すると、お客様に「AirReach ログイン用リンク」のメール（送信元 no-reply@trillion-bank.com）が届きます。リンクの有効期限は1時間です。切れたら「ログインメールを再送」を押してください。お客様に見えるのは、自社の公開済みのレポートだけです。</p>' +
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
