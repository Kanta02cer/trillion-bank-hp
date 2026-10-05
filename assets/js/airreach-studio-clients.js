/**
 * AirReach Studio の「顧客ごとの作業場所」と「顧客の切り替え」。
 *
 * - Studio の作業（分析・キーワード・AI計測・直す材料）は、これまで端末に1つだけ保存していたため、
 *   顧客を変えると前の顧客の内容が混ざっていた。顧客ごとに保存し、開くときに入れ替える。
 *   ※ ほかのスクリプトより先に（defer なしで）読み込むこと。入れ替えは、ほかが保存場所を読む前に済ませる
 * - 画面上部に「顧客：○○ ▾」。ダッシュボードの顧客から選ぶと、その顧客の作業として開き直す
 * - 顧客の作業のときは、最新の診断・AI計測・今月のレポートの状態を上に出す
 * 顧客の一覧と状態は、ダッシュボードのログイン（AirReachStaffAuth）で読む。保存場所はこの端末のブラウザだけ。
 */
(function () {
  'use strict';
  var WORK_KEYS = ['airreach_studio_v1', 'airreach_studio_orch_v1'];
  var CUR_KEY = 'airreach_studio_ws_current_v1';
  var WS_PREFIX = 'airreach_studio_ws_v1:';
  var CLIENT_KEY = 'airreach_studio_client_v1';
  var NONE = 'none';

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  // 開く顧客: URL の ?client= → このタブで開いていた顧客 → 顧客なし
  function targetClient() {
    var c = null;
    try {
      var p = new URLSearchParams(location.search), id = p.get('client') || '';
      if (id === NONE) { try { sessionStorage.removeItem(CLIENT_KEY); } catch (e2) {} return null; }
      if (/^[0-9a-f-]{36}$/.test(id)) c = { id: id, name: p.get('client_name') || '', url: p.get('url') || '' };
    } catch (e) {}
    if (!c) { try { c = JSON.parse(sessionStorage.getItem(CLIENT_KEY) || 'null'); } catch (e) { c = null; } }
    return c && c.id ? c : null;
  }

  // 作業場所の入れ替え（いま入っている作業を元の顧客の場所へ戻し、開く顧客の作業を取り出す）
  var swapError = '';
  function swapTo(id) {
    var cur = get(CUR_KEY) || NONE;
    if (cur === id) return;
    var stash = {};
    WORK_KEYS.forEach(function (k) { stash[k] = get(k); });
    if (!set(WS_PREFIX + cur, JSON.stringify(stash))) { swapError = 'この端末の保存場所がいっぱいのため、顧客を切り替えられませんでした。使っていない顧客の作業を消してください。'; return; }
    var next = null;
    try { next = JSON.parse(get(WS_PREFIX + id) || 'null'); } catch (e) { next = null; }
    WORK_KEYS.forEach(function (k) { set(k, next && next[k] != null ? next[k] : null); });
    set(WS_PREFIX + id, null);
    set(CUR_KEY, id);
  }
  var client = targetClient();
  swapTo(client ? client.id : NONE);
  // 共有されている作業の読み込みは、開き直した直後（Studio が保存場所を読む前）に書き込む。
  // 開き直す前に書くと、閉じるときに Studio が手元の古い作業を保存して上書きしてしまうため
  var ADOPT_KEY = 'airreach_studio_adopt_v1';
  (function applyPending() {
    var p = null;
    try { p = JSON.parse(sessionStorage.getItem(ADOPT_KEY) || 'null'); sessionStorage.removeItem(ADOPT_KEY); } catch (e) { p = null; }
    if (!p || !client || p.clientId !== client.id) return;
    WORK_KEYS.forEach(function (k, i) { set(k, p.strs[i]); });
    set('airreach_studio_sync_v1:' + client.id, JSON.stringify({ version: p.version, sig: p.sig }));
    try { sessionStorage.setItem('airreach_studio_adopted_v1', client.id + ':' + p.version + (p.backup ? ':b' : '')); } catch (e) {}
  })();

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function studioUrl(c, site) {
    var p = new URLSearchParams();
    p.set('client', c.id); p.set('client_name', c.name || '');
    if (site) p.set('url', site);
    if (c.industry_id) p.set('industry', c.industry_id);
    return '/airreach/studio/?' + p.toString();
  }
  // 日時は日本時間の日付に（世界標準時のまま切ると 0〜9 時が前の日になる）。日付だけはそのまま
  function ymd(s) { var t = String(s || ''); if (!/[T ]\d{2}:\d{2}/.test(t)) return t.slice(0, 10); var ms = Date.parse(t); if (isNaN(ms)) return t.slice(0, 10); return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10); }

  function sb() { return window.AirReachStaffAuth ? window.AirReachStaffAuth.client() : Promise.reject(new Error('no auth')); }

  // ---- 顧客の切り替え（画面上部）---------------------------------------------------
  function renderPicker() {
    var bar = document.querySelector('.ars-appbar');
    if (!bar || document.getElementById('ars-client-pick')) return;
    var d = document.createElement('details');
    d.className = 'ars-client-pick'; d.id = 'ars-client-pick';
    d.innerHTML = '<summary><span class="ars-client-pick-l">顧客</span><b>' + esc(client ? (client.name || '（名前なし）') : '選んでいません') + '</b> ▾</summary><div class="ars-client-pick-menu" role="menu"><p class="ars-client-pick-note">読み込んでいます…</p></div>';
    var ctx = document.getElementById('ars-context');
    bar.insertBefore(d, ctx ? ctx : bar.children[1] || null);
    var loaded = false;
    d.addEventListener('toggle', function () {
      if (!d.open || loaded) return;
      loaded = true;
      var menu = d.querySelector('.ars-client-pick-menu');
      sb().then(function (s) {
        return s.auth.getSession().then(function (r) {
          if (!(r && r.data && r.data.session)) throw new Error('login');
          return Promise.all([s.from('clients').select('id,name,industry_id,status').order('name'), s.from('client_sites').select('client_id,url')]);
        });
      }).then(function (rs) {
        var cs = (rs[0].data || []).filter(function (c) { return c.status !== 'ended'; }), sites = rs[1].data || [];
        if (rs[0].error) throw rs[0].error;
        var siteOf = function (id) { var x = sites.filter(function (s) { return s.client_id === id; })[0]; return x ? x.url : ''; };
        menu.innerHTML = '<input class="ars-input ars-client-pick-q" type="search" placeholder="顧客を探す" aria-label="顧客を探す">' +
          '<ul>' + cs.map(function (c) {
            return '<li><a role="menuitem" href="' + esc(studioUrl(c, siteOf(c.id))) + '"' + (client && client.id === c.id ? ' aria-current="true"' : '') + '>' + esc(c.name) + '<small>' + esc(siteOf(c.id).replace(/^https?:\/\//, '').replace(/\/$/, '')) + '</small></a></li>';
          }).join('') + '</ul>' +
          (client ? '<a class="ars-client-pick-none" href="/airreach/studio/?client=none">顧客を選ばずに使う</a>' : '') +
          (cs.length ? '' : '<p class="ars-client-pick-note">顧客がまだありません。ダッシュボードで追加してください。</p>');
        var qi = menu.querySelector('.ars-client-pick-q');
        qi.addEventListener('input', function () { var v = qi.value.trim().toLowerCase(); menu.querySelectorAll('li').forEach(function (li) { li.hidden = !!v && li.textContent.toLowerCase().indexOf(v) < 0; }); });
        qi.focus();
      }).catch(function () {
        loaded = false;
        menu.innerHTML = '<p class="ars-client-pick-note">顧客を選ぶには、<a href="/airreach/app/" target="_blank" rel="noopener">ダッシュボード</a>に社内の人としてログインしてください。ログインしたら、もう一度押してください。</p>';
      });
    });
    document.addEventListener('click', function (e) { if (d.open && !d.contains(e.target)) d.open = false; });
  }

  // ---- 顧客の状態（最新の診断・AI計測・今月のレポート）--------------------------------
  var STATUS_JA = { draft: '下書き', in_review: '確認待ち', approved: '承認済み・未公開', published: '公開' };
  function renderSummary() {
    if (!client) return;
    var launch = document.querySelector('.ars-orch-launch');
    if (!launch) return;
    var el = document.createElement('section');
    el.className = 'ars-card ars-client-sum'; el.id = 'ars-client-sum';
    el.innerHTML = '<div class="ars-client-sum-h"><h2>' + esc(client.name || '顧客') + '</h2><a href="/airreach/app/#/c/' + esc(client.id) + '">ダッシュボードで開く →</a></div><p class="ars-note">読み込んでいます…</p>';
    launch.parentNode.insertBefore(el, launch);
    var month = new Date().toISOString().slice(0, 7) + '-01';
    sb().then(function (s) {
      return Promise.all([
        s.rpc('airreach_client_scans', { p_client_id: client.id, p_limit: 1 }),
        s.from('measurement_runs').select('measured_on,source').eq('client_id', client.id).order('measured_on', { ascending: false }).order('created_at', { ascending: false }).limit(1),
        s.from('reports').select('status').eq('client_id', client.id).eq('period_month', month).maybeSingle(),
        s.from('client_sites').select('url').eq('client_id', client.id)
      ]);
    }).then(function (rs) {
      if (rs[0].error) throw rs[0].error;
      var sc = (rs[0].data || [])[0], run = (rs[1].data || [])[0], rep = rs[2] && rs[2].data;
      var siteUrl = client.url || (((rs[3] && rs[3].data) || [])[0] || {}).url || '';
      fillUrl(siteUrl);
      offerLegacy(siteUrl);
      var cell = function (label, value, sub) { return '<div class="ars-client-sum-c"><span>' + esc(label) + '</span><b>' + value + '</b><small>' + esc(sub || '') + '</small></div>'; };
      el.querySelector('.ars-note').outerHTML = '<div class="ars-client-sum-g">' +
        cell('最新の診断', sc && sc.overallScore != null ? esc(sc.overallScore) + '点' : '—', sc ? ymd(sc.createdAt) + ' に診断' : 'まだ診断していません') +
        cell('最新の AI計測', run ? esc(ymd(run.measured_on)) : '—', run ? (run.source === 'manual' ? 'Studio で計測' : '社内の計測') : 'まだ計測していません') +
        cell('今月のレポート', rep ? esc(STATUS_JA[rep.status] || rep.status) : '未作成', '') +
        '</div>' + (swapError ? '<p class="ars-note is-err">' + esc(swapError) + '</p>' : '');
    }).catch(function () {
      var n = el.querySelector('.ars-note');
      if (n) n.innerHTML = '顧客の診断・計測・レポートの状態は、<a href="/airreach/app/" target="_blank" rel="noopener">ダッシュボード</a>にログインすると表示されます。';
    });
  }

  // 顧客の作業で名前が空なら、顧客名を入れておく（AI計測に使う。違えば直せる）
  function prefillBrand() {
    if (!client || !client.name) return;
    setTimeout(function () {
      var b = document.getElementById('orch-brand');
      if (b && !b.value.trim()) { b.value = client.name; b.dispatchEvent(new Event('input', { bubbles: true })); }
    }, 300);
  }
  // URL を受け取らずに開いたとき（ダッシュボードのレポート画面からなど）は、顧客のサイトを入れておく
  function fillUrl(url) {
    if (!url) return;
    if (!client.url) { client.url = url; try { sessionStorage.setItem(CLIENT_KEY, JSON.stringify(client)); } catch (e) {} }
    var u = document.getElementById('orch-url');
    if (u && !u.value.trim()) { u.value = url; u.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  function hostOf(u) { try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } }
  // 顧客ごとの保存を始める前に、顧客を選ばずに同じサイトで作業していた場合は、その作業を使えるようにする
  function offerLegacy(siteUrl) {
    var host = hostOf(siteUrl);
    if (!host) return;
    var cur = {};
    try { cur = JSON.parse(get('airreach_studio_v1') || '{}') || {}; } catch (e) {}
    if ((cur.keywords || []).length || Object.keys(cur.generated || {}).length || (cur.hack2 || []).length) return; // この顧客の作業がもうある
    var none = null, prev = {};
    try { none = JSON.parse(get(WS_PREFIX + NONE) || 'null'); prev = JSON.parse((none && none.airreach_studio_v1) || '{}') || {}; } catch (e) { return; }
    if (!none || hostOf((prev.profile && prev.profile.url) || '') !== host) return;
    if (!((prev.keywords || []).length || Object.keys(prev.generated || {}).length || (prev.hack2 || []).length)) return;
    var el = document.getElementById('ars-client-sum');
    if (!el) return;
    var box = document.createElement('div');
    box.className = 'ars-client-legacy';
    box.innerHTML = '<p>顧客を選ばずに作った <b>' + esc(host) + '</b> の作業（キーワード ' + (prev.keywords || []).length + '件' + ((prev.hack2 || []).length ? '・AI計測あり' : '') + '）があります。この顧客の作業として使いますか？</p>' +
      '<button type="button" class="ars-btn ars-btn-primary" id="ars-legacy-use">この顧客の作業として使う</button>';
    el.appendChild(box);
    document.getElementById('ars-legacy-use').onclick = function () {
      WORK_KEYS.forEach(function (k) { set(k, none[k] != null ? none[k] : null); });
      location.reload();
    };
  }
  // ---- 左のメニューをダッシュボードと共通の並びにする（assets/js/airreach-nav.js）--------------
  // Studio の画面のボタンはそのまま使い（押したときの動きは変えない）、ダッシュボードの節はリンクで並べる
  function rebuildSide() {
    var N = window.AirReachNav, side = document.querySelector('.ars-side');
    if (!N || !side) return;
    var btns = {};
    Array.prototype.forEach.call(side.querySelectorAll('button[data-panel]'), function (b) { btns[b.getAttribute('data-panel')] = b; });
    var navClient = client ? { id: client.id, name: client.name, site: client.url } : null;
    var frag = document.createDocumentFragment(), n = 0;
    if (client) {
      var back = document.createElement('a');
      back.className = 'ars-side-back'; back.href = '/airreach/app/#/'; back.textContent = '← 顧客一覧';
      frag.appendChild(back);
    }
    N.groups(!!client).forEach(function (g) {
      var gd = document.createElement('div'); gd.className = 'group'; gd.textContent = g.group; frag.appendChild(gd);
      g.items.forEach(function (it) {
        n += 1;
        var el;
        if (it.where === 'studio' && btns[it.panel]) {
          el = btns[it.panel];
          if (it.also) el.setAttribute('data-also', it.also.join(' ')); // 中で一緒に扱う画面（そのときもこの項目を選んだ状態にする）
          el.innerHTML = '<span class="n">' + n + '</span><span class="ars-side-l">' + esc(it.label) + (it.desc ? '<small>' + esc(it.desc) + '</small>' : '') + '</span>';
          delete btns[it.panel];
        } else {
          el = document.createElement('a');
          el.className = 'ars-side-link';
          el.href = N.href(it, navClient);
          el.innerHTML = '<span class="n">' + n + '</span><span class="ars-side-l">' + esc(it.label) + (it.desc ? '<small>' + esc(it.desc) + '</small>' : '') + '</span>';
        }
        frag.appendChild(el);
      });
    });
    // メニューに出さない Studio の画面（ほかの画面の中で扱うもの）は、隠したまま残す（URL の #… やボタンから開ける）
    Object.keys(btns).forEach(function (k) { var b = btns[k]; b.hidden = true; frag.appendChild(b); });
    side.innerHTML = '';
    side.appendChild(frag);
    // 各画面の見出しをメニューの名前に、説明（lead）があれば見出しの下に出す
    N.groups(!!client).forEach(function (g) { g.items.forEach(function (it) {
      if (it.where !== 'studio') return;
      var view = document.querySelector('[data-panel-view="' + it.panel + '"] .ars-title-row');
      if (!view) return;
      var h = view.querySelector('h2'); if (h) h.textContent = it.label;
      if (it.lead) { var sub = view.querySelector('.ars-sub'); if (!sub) { sub = document.createElement('p'); sub.className = 'ars-sub'; if (h) h.insertAdjacentElement('afterend', sub); } sub.textContent = it.lead; }
    }); });
  }
  // ---- 顧客の作業を共有する（DB の studio_workspaces。統合②）-----------------------------
  // 開いたら DB の版を読み、このブラウザの作業と比べる。作業が変わったら数秒後に保存する。
  // 保存は版を確かめて行い、ほかの人が先に保存していたら上書きせず「最新を読み込む」を出す。
  var SYNC_PREFIX = 'airreach_studio_sync_v1:';
  var BACKUP_PREFIX = 'airreach_studio_backup_v1:';
  var MAX_BYTES = 3800000;
  var sync = { on: false, version: 0, sig: '', saving: false, timer: 0, conflict: null, email: '' };
  function localStrings() { return WORK_KEYS.map(get); }
  function sigOf(strs) { var t = strs.map(function (x) { return x == null ? '' : x; }).join('\u0001'), h = 5381; for (var i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return t.length + ':' + h; }
  function hasWork(strs) { var st = {}; try { st = JSON.parse(strs[0] || '{}') || {}; } catch (e) {} return !!((st.keywords || []).length || Object.keys(st.generated || {}).length || (st.hack2 || []).length || (st.profile && st.profile.url)); }
  function payload(strs) {
    var data = { studio: null, orch: null };
    try { data.studio = JSON.parse(strs[0] || 'null'); } catch (e) {}
    try { data.orch = JSON.parse(strs[1] || 'null'); } catch (e) {}
    // 大きすぎるときは分析の途中経過（orch）を外す（作業の本体は studio に入っている）
    if (JSON.stringify(data).length > MAX_BYTES) data.orch = null;
    return data;
  }
  function readMeta() { try { return JSON.parse(get(SYNC_PREFIX + client.id) || 'null') || { version: 0, sig: '' }; } catch (e) { return { version: 0, sig: '' }; } }
  function writeMeta(v, sig) { sync.version = v; sync.sig = sig; set(SYNC_PREFIX + client.id, JSON.stringify({ version: v, sig: sig })); }
  function hhmm(iso) { var d = iso ? new Date(iso) : new Date(); return isNaN(d) ? '' : ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function syncStatus(text, kind, action) {
    var box = document.getElementById('ars-sync');
    if (!box) {
      // どの画面（競合・キーワードなど）を開いていても見えるように、作業エリアのいちばん上に出す
      var host = document.getElementById('ars-main'); if (!host) return;
      box = document.createElement('div'); box.id = 'ars-sync'; box.className = 'ars-sync'; box.setAttribute('aria-live', 'polite'); host.insertBefore(box, host.firstChild);
    }
    box.className = 'ars-sync' + (kind ? ' is-' + kind : '');
    box.innerHTML = '<span>' + esc(text) + '</span>' + (action || '');
  }
  // DB の作業をこのブラウザに入れて開き直す（Studio はページを開いたときに読むため）
  function adopt(server, backupLocal) {
    if (backupLocal) set(BACKUP_PREFIX + client.id, JSON.stringify({ at: new Date().toISOString(), work: localStrings() }));
    var d = server.data || {};
    var strs = [d.studio == null ? null : JSON.stringify(d.studio), d.orch == null ? null : JSON.stringify(d.orch)];
    sync.on = false; // 開き直すまで保存しない
    try { sessionStorage.setItem(ADOPT_KEY, JSON.stringify({ clientId: client.id, strs: strs, version: server.version, sig: sigOf(strs), backup: !!backupLocal })); } catch (e) { syncStatus('最新の作業を読み込めませんでした（作業が大きすぎます）', 'warn'); return; }
    location.reload();
  }
  function upload() {
    sync.timer = 0;
    if (!sync.on || sync.saving || sync.conflict) return;
    var strs = localStrings(), sig = sigOf(strs);
    if (sig === sync.sig) return;
    sync.saving = true;
    syncStatus('保存しています…');
    sb().then(function (s) { return s.rpc('airreach_studio_save', { p_client_id: client.id, p_data: payload(strs), p_base_version: sync.version }); })
      .then(function (r) {
        sync.saving = false;
        if (r.error) throw r.error;
        var res = r.data || {};
        if (res.ok) { writeMeta(res.version, sig); syncStatus('共有しています（' + hhmm() + ' に保存・社内の全員が見られます）', 'ok'); return; }
        if (res.conflict) {
          sync.conflict = res;
          syncStatus((res.updated_by ? res.updated_by.split('@')[0] + ' さん' : '別の人') + 'が ' + hhmm(res.updated_at) + ' にこの顧客の作業を更新しました。このパソコンの変更はまだ共有していません。',
            'warn', ' <button type="button" class="ars-btn ars-btn-secondary" id="ars-sync-load">最新を読み込む（このパソコンの変更は控えに残す）</button>');
          var bt = document.getElementById('ars-sync-load');
          if (bt) bt.onclick = function () { fetchServer().then(function (sv) { if (sv) adopt(sv, true); }); };
        }
      }).catch(function (e) {
        sync.saving = false;
        var m = String((e && e.message) || e);
        syncStatus(/size_check|too large/i.test(m) ? '作業が大きすぎて共有できませんでした（このパソコンには保存されています）' : '共有できませんでした（このパソコンには保存されています）。あとで自動でもう一度試します', 'warn');
      });
  }
  function fetchServer() {
    return sb().then(function (s) { return s.from('studio_workspaces').select('data,version,updated_by,updated_at').eq('client_id', client.id).maybeSingle(); })
      .then(function (r) { if (r.error) throw r.error; return r.data || null; });
  }
  function startSync() {
    if (!client) return;
    sb().then(function (s) { return s.auth.getSession(); }).then(function (r) {
      var session = r && r.data && r.data.session;
      if (!session) {
        // ログインしていないと、共有された作業（ほかのパソコンで入れた競合など）を読めない。目立つ形でログインへ案内する
        syncStatus('ログインしていないため、ほかのパソコンで入れた作業（競合・キーワードなど）が表示されていません。ここでの作業もこのパソコンだけに保存されます。', 'warn',
          ' <a class="ars-btn ars-btn-primary" href="/airreach/app/#/c/' + encodeURIComponent(client.id) + '">ログインする</a><small class="ars-sync-hint">ログインしたら、ダッシュボードからこの顧客の Studio を開き直してください。</small>');
        return;
      }
      sync.email = (session.user && session.user.email) || '';
      return fetchServer().then(function (server) {
        var meta = readMeta(), strs = localStrings(), sig = sigOf(strs);
        sync.version = meta.version || 0; sync.sig = meta.sig || '';
        var changedHere = sig !== sync.sig && hasWork(strs);
        if (server && server.version > sync.version) {
          // ほかのパソコン・ほかの人が保存した新しい作業がある
          var justAdopted = false;
          try { justAdopted = sessionStorage.getItem('airreach_studio_adopted_v1') === client.id + ':' + server.version; } catch (e) {}
          if (!justAdopted) { adopt(server, changedHere); return; }
        }
        if (!server && !hasWork(strs)) { sync.version = 0; sync.sig = sig; }
        var note = '';
        try { var a = sessionStorage.getItem('airreach_studio_adopted_v1') || ''; if (a.indexOf(client.id) === 0) { note = /:b$/.test(a) ? '共有されている最新の作業を読み込みました（このパソコンで共有していなかった変更は控えに残しています）' : '共有されている最新の作業を読み込みました'; sessionStorage.removeItem('airreach_studio_adopted_v1'); } } catch (e) {}
        sync.on = true;
        syncStatus(note || (server ? '共有しています（' + hhmm(server.updated_at) + ' に ' + (server.updated_by ? server.updated_by.split('@')[0] + ' さんが' : '') + '保存・社内の全員が見られます）' : '共有の準備ができました。作業すると自動で保存します'), 'ok');
        upload();
        // 作業が変わったら、変わり終えて 2.5 秒たってから保存する（変わり続けている間は待つ）
        var seen = sigOf(localStrings());
        setInterval(function () {
          var now = sigOf(localStrings());
          if (now !== seen) { seen = now; clearTimeout(sync.timer); sync.timer = setTimeout(upload, 2500); }
          else if (now !== sync.sig && !sync.timer && !sync.saving) { sync.timer = setTimeout(upload, 2500); }
        }, 2000);
        window.addEventListener('pagehide', function () { if (sigOf(localStrings()) !== sync.sig) upload(); });
        // 開いている間に、ほかのパソコン・ほかの人が保存した新しい作業が無いかを確かめる。
        // このパソコンに共有していない変更が無く、画面に戻ってきたときは自動で読み込む。それ以外はボタンを出す
        var checking = false;
        function checkNewer(fromReturn) {
          if (checking || !sync.on || sync.saving || sync.conflict) return;
          checking = true;
          sb().then(function (s) { return s.from('studio_workspaces').select('version,updated_by,updated_at').eq('client_id', client.id).maybeSingle(); })
            .then(function (r) {
              checking = false;
              var sv = r && r.data;
              if (!sv || sv.version <= sync.version) return;
              var clean = sigOf(localStrings()) === sync.sig;
              if (clean && fromReturn) { fetchServer().then(function (full) { if (full) adopt(full, false); }); return; }
              syncStatus((sv.updated_by ? sv.updated_by.split('@')[0] + ' さん' : '別の人') + 'が ' + hhmm(sv.updated_at) + ' に新しい作業を保存しました。', 'warn',
                ' <button type="button" class="ars-btn ars-btn-secondary" id="ars-sync-newer">最新を読み込む' + (clean ? '' : '（このパソコンの変更は控えに残す）') + '</button>');
              var bt = document.getElementById('ars-sync-newer');
              if (bt) bt.onclick = function () { fetchServer().then(function (full) { if (full) adopt(full, !clean); }); };
            }, function () { checking = false; });
        }
        setInterval(function () { if (!document.hidden) checkNewer(false); }, 30000);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) checkNewer(true); });
        window.addEventListener('focus', function () { checkNewer(true); });
      });
    }).catch(function () { syncStatus('共有の状態を確かめられませんでした（このパソコンには保存されています）', 'warn'); });
  }

  // ---- これまでの AI 計測（顧客の measurement_runs）を「AI での見え方を測る」の下に出す ----------------
  var PROV = { openai: 'ChatGPT', chatgpt: 'ChatGPT', chatgpt_search: 'ChatGPT（検索あり）', perplexity: 'Perplexity', claude: 'Claude', gemini: 'Gemini', google_aio: 'Google AI による概要', google_ai_mode: 'Google AI モード', jev: '推定' };
  function pct(v) { return v == null || v === '' || isNaN(Number(v)) ? '—' : (Math.round(Number(v) * 10) / 10) + '%'; }
  function renderRunHistory() {
    var box = document.getElementById('hack2-history');
    if (!box || !client) return;
    box.hidden = false;
    var dash = '/airreach/app/#/c/' + encodeURIComponent(client.id) + '/runs';
    var head = '<div class="ars-hist-h"><h3>これまでの記録</h3><a href="' + esc(dash) + '">削除・取り込みはダッシュボードで →</a></div>';
    box.innerHTML = head + '<p class="ars-note">読み込んでいます…</p>';
    sb().then(function (s) {
      return s.auth.getSession().then(function (r) {
        if (!(r && r.data && r.data.session)) return null;
        return s.from('measurement_runs').select('measured_on,query_set_version,source,summary,created_at').eq('client_id', client.id).order('measured_on', { ascending: false }).order('created_at', { ascending: false }).limit(24);
      });
    }).then(function (r) {
      if (r === null) { box.innerHTML = head + '<p class="ars-note">ログインすると、この顧客のこれまでの計測が表示されます。</p>'; return; }
      if (r.error) throw r.error;
      var rows = [];
      (r.data || []).forEach(function (run) {
        var by = (run.summary && Array.isArray(run.summary.by)) ? run.summary.by.filter(function (b) { return !b.group || b.group === 'main' || b.group === 'all'; }) : [];
        if (!by.length) rows.push('<tr><td>' + esc(run.measured_on) + '</td><td colspan="4" class="ars-muted">集計を読めません</td></tr>');
        by.forEach(function (b, i) {
          var cite = b.either && b.either.rate != null ? b.either.rate : b.rate;
          rows.push('<tr><td>' + (i ? '' : esc(String(run.measured_on).slice(5).replace('-', '/'))) + '</td><td>' + esc(PROV[String(b.provider || '').toLowerCase()] || b.provider || '') + '</td><td>' + pct(b.service_mention_rate) + '</td><td>' + pct(cite) + '</td><td>' + pct(b.sov) + '</td></tr>');
        });
      });
      box.innerHTML = head + (rows.length
        ? '<div class="ars-table-wrap"><table class="ars-table"><thead><tr><th>計測日</th><th>AI</th><th>名前が出た</th><th>自社サイトが出典</th><th>競合と比べた割合</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div><p class="ars-note">計測すると自動でここに入り、月次レポートの AI の数字に使われます。</p>'
        : '<p class="ars-note">まだ記録がありません。上の「計測実行」で測ると、ここに入ります。</p>');
    }).catch(function () { box.innerHTML = head + '<p class="ars-note">記録を読み込めませんでした。少し待ってから開き直してください。</p>'; });
  }

  // ---- Studio の AI計測を、顧客の「AI計測の記録」に自動で残す --------------------------------
  var SAVED_RUNS = 'airreach_studio_saved_runs_v1';
  function onMeasured(summary) {
    if (!client || !summary) return Promise.resolve(false);
    var key = summary.run_id || '';
    var saved = []; try { saved = JSON.parse(get(SAVED_RUNS) || '[]'); } catch (e) {}
    if (key && saved.indexOf(key) >= 0) return Promise.resolve(true);
    return sb().then(function (s) {
      return s.auth.getSession().then(function (r) {
        var session = r && r.data && r.data.session;
        if (!session) return false;
        return s.from('measurement_runs').insert({ client_id: client.id, measured_on: new Date().toISOString().slice(0, 10), run_label: key || 'studio', query_set_version: summary.query_set_version || null, source: 'manual', summary: summary, created_by: (session.user && session.user.email) || null })
          .then(function (res) {
            if (res.error) throw res.error;
            if (key) { saved.push(key); set(SAVED_RUNS, JSON.stringify(saved.slice(-200))); }
            var st = document.getElementById('hack2-status');
            if (st) st.textContent += ' ／ 下の「これまでの記録」に保存しました（月次レポートに使えます）';
            renderRunHistory();
            return true;
          });
      });
    }).catch(function (e) {
      var st = document.getElementById('hack2-status');
      if (st) st.textContent += ' ／ 顧客の記録への保存に失敗しました: ' + String((e && e.message) || e);
      return false;
    });
  }
  function savedRun(key) { try { return (JSON.parse(get(SAVED_RUNS) || '[]') || []).indexOf(key) >= 0; } catch (e) { return false; } }

  function init() { rebuildSide(); renderPicker(); renderSummary(); prefillBrand(); startSync(); renderRunHistory(); setTimeout(function () { takeCustomerQuestions(); autoStart(); setTimeout(autoGscSync, 1500); }, 600); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  // ---- 分析したサイトを、この顧客のサイトとして登録する ------------------------------------------
  // ダッシュボードは「顧客に登録されたサイト」と同じサイトの診断だけを、その顧客の診断として出す。
  // サイトが1つも登録されていない顧客なら、分析したサイトを自動で登録する。別のサイトが登録済みなら、登録するかを選べるようにする
  // 戻り値: Promise<{ state: 'added'|'already'|'other'|'nologin'|'none', host }>
  function ensureSite(url) {
    var host = hostOf(url);
    if (!client || !host) return Promise.resolve({ state: 'none', host: host });
    var origin = ''; try { origin = new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url).origin + '/'; } catch (e) { origin = url; }
    return sb().then(function (s) {
      return s.auth.getSession().then(function (r) {
        if (!(r && r.data && r.data.session)) return { state: 'nologin', host: host };
        return s.from('client_sites').select('host').eq('client_id', client.id).then(function (x) {
          if (x.error) throw x.error;
          var hosts = (x.data || []).map(function (h) { return h.host; });
          if (hosts.indexOf(host) >= 0) return { state: 'already', host: host };
          if (hosts.length) return { state: 'other', host: host, hosts: hosts, add: function () { return s.from('client_sites').insert({ client_id: client.id, url: origin, host: host }).then(function (y) { if (y.error) throw y.error; return true; }); } };
          return s.from('client_sites').insert({ client_id: client.id, url: origin, host: host }).then(function (y) { if (y.error) throw y.error; return { state: 'added', host: host }; });
        });
      });
    });
  }

  // 今月この顧客を AI で測ったか（日本時間の月）。ログインしていなければ null
  function measuredThisMonth() {
    if (!client) return Promise.resolve(null);
    var jst = new Date(Date.now() + 9 * 3600000), first = jst.toISOString().slice(0, 8) + '01';
    return sb().then(function (s) {
      return s.auth.getSession().then(function (r) {
        if (!(r && r.data && r.data.session)) return null;
        return s.from('measurement_runs').select('id').eq('client_id', client.id).gte('measured_on', first).limit(1).then(function (x) { if (x.error) throw x.error; return (x.data || []).length > 0; });
      });
    }).catch(function () { return null; });
  }
  // ---- Search Console の実際の検索語を、キーワードに自動で反映する（キーワード選びの第3段階）---------------
  // 顧客ごとの Google のつながり（ダッシュボードでつないだもの）と、ダッシュボードで取得したサイト（traffic_snapshots の property）を使う。
  // 直近28日（昨日まで）。前回から7日たったか、月が変わったか、サイトが変わったときだけ取り直す
  function gKey() { return client ? String(client.id).toLowerCase().replace(/-/g, '') : ''; }
  function gConnected() { var m = document.cookie.match(new RegExp('(?:^|;\\s*)airreach_g_' + gKey() + '_s=([^;]*)')); return !!m && decodeURIComponent(m[1]).split('.').indexOf('gsc') >= 0; }
  function gscNote(text, kind) {
    var body = document.getElementById('keyword-body'); if (!body) return;
    var el = document.getElementById('kw-gsc-note');
    if (!el) { el = document.createElement('p'); el.id = 'kw-gsc-note'; body.parentNode.insertBefore(el, body); }
    el.className = 'ars-note' + (kind ? ' ' + kind : ''); el.textContent = text;
  }
  function ymdJst(ms) { return new Date(ms + 9 * 3600000).toISOString().slice(0, 10); }
  function autoGscSync(force) {
    if (!client || !window.AirReachStudio || !window.AirReachOrchestrator) return Promise.resolve(null);
    if (!gConnected()) { gscNote('この顧客は Google とつながっていないため、Search Console の実際の検索語は入っていません。ダッシュボードの「検索と訪問の数字を入れる」でつなぐと、ここに自動で入ります。'); return Promise.resolve(null); }
    return sb().then(function (s) {
      return s.from('traffic_snapshots').select('metrics,period_month').eq('client_id', client.id).eq('source', 'gsc_api').order('period_month', { ascending: false }).limit(1);
    }).then(function (r) {
      var prop = r && r.data && r.data[0] && r.data[0].metrics && r.data[0].metrics.property;
      if (!prop) { gscNote('Search Console のサイトがまだ決まっていません。ダッシュボードの「検索と訪問の数字を入れる」で一度「Google から取得」をすると、ここに実際の検索語が自動で入ります。'); return null; }
      var st = window.AirReachStudio.getState(), last = st.gscAuto || {};
      var now = Date.now(), end = ymdJst(now - 86400000), start = ymdJst(now - 28 * 86400000);
      var fresh = last.property === prop && last.at && (now - Date.parse(last.at) < 7 * 86400000) && String(last.at).slice(0, 7) === new Date(now).toISOString().slice(0, 7);
      if (fresh && !force) { gscNote('Search Console の実際の検索語（' + last.start.slice(5).replace('-', '/') + '〜' + last.end.slice(5).replace('-', '/') + '・' + last.count + '語）を反映しています。7日ごとに自動で新しくします。', 'good'); return null; }
      gscNote('Search Console から実際の検索語を読み込んでいます…');
      return fetch('/api/google/gsc/', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: client.id, siteUrl: prop, startDate: start, endDate: end }) })
        .then(function (res) { return res.json().catch(function () { return {}; }).then(function (d) { if (!res.ok) throw new Error(res.status === 401 ? 'Google とのつながりが切れています。ダッシュボードでつなぎ直してください' : res.status === 403 ? 'この Search Console のサイトを見る権限がありません' : (d.error && d.error.message) || ('HTTP ' + res.status)); return d; }); })
        .then(function (d) {
          var rows = d.rows || [];
          if (window.AirReachStudio.beginGscSync) window.AirReachStudio.beginGscSync(d.siteUrl || prop, start, end, d.totals);
          if (rows.length) window.AirReachOrchestrator.importGscRows(rows, { property: d.siteUrl || prop });
          // 分析の結果（キーワードの一覧）に、表示回数・クリックと、一覧に無い実際の検索語を足す
          var job = window.__orchLastJob; if (!job) { try { job = (JSON.parse(localStorage.getItem('airreach_studio_orch_v1') || 'null') || {}).lastJob; } catch (e) { job = null; } }
          var hasJob = !!(job && job.keywords && job.keywords.length);
          if (job && job.keywords && window.AirReachOrchestrator.reattachGscToJob) {
            job = window.AirReachOrchestrator.reattachGscToJob(job); window.__orchLastJob = job;
            var res2 = document.getElementById('orch-result'); if (res2 && !res2.hidden && window.AirReachOrchestrator.renderResult) window.AirReachOrchestrator.renderResult(job);
          }
          var queries = {}; rows.forEach(function (x) { if (x.keyword) queries[x.keyword] = 1; });
          var n = Object.keys(queries).length;
          st = window.AirReachStudio.getState();
          st.gscAuto = { at: new Date().toISOString(), property: prop, start: start, end: end, count: n };
          window.AirReachStudio.save();
          var span = start.slice(5).replace('-', '/') + '〜' + end.slice(5).replace('-', '/');
          gscNote(!n ? 'Search Console では、この期間に表示された検索語がありませんでした（' + start + '〜' + end + '）。'
            : hasJob ? 'Search Console の実際の検索語（' + span + '・' + n + '語）を反映しました。表示の多い検索語は「必須」になり、一覧に無かったものは足しています。7日ごとに自動で新しくします。'
            : 'Search Console の実際の検索語（' + span + '・' + n + '語）を読み込みました。「サイトを調べる」を行うと、キーワードの一覧に入ります。', n ? 'good' : '');
          return n;
        });
    }).catch(function (e) { gscNote('Search Console の検索語を読み込めませんでした（' + String((e && e.message) || e) + '）。', 'warn'); return null; });
  }

  // ダッシュボードで顧客をサイトつきで追加したとき（?auto=1）は、開いたらそのまま「サイトを調べる」を始める。
  // 分析が終わると、足りない情報の判定と AI での見え方の計測も続けて自動で行う（airreach-studio.js）
  // 顧客の追加時に入れた「お客様によく聞かれる質問」を受け取り、作業（state.customerQuestions）と測る質問の先頭に入れる
  function takeCustomerQuestions() {
    if (!client || !window.AirReachStudio) return;
    var key = 'airreach_customer_qs_v1:' + client.id, qs = [];
    try { qs = JSON.parse(localStorage.getItem(key) || '[]') || []; } catch (e) { qs = []; }
    if (!qs.length) return;
    var st = window.AirReachStudio.getState();
    var have = (st.customerQuestions || []).slice();
    qs.forEach(function (x) { if (have.indexOf(x) < 0) have.push(x); });
    st.customerQuestions = have;
    if (st.prompts && st.prompts.length) {
      var texts = st.prompts.map(function (p) { return String(p.text || '').replace(/\s/g, ''); });
      var brand = (st.profile && st.profile.brand) || client.name || '';
      var cp = window.AirReachStudio.customerPrompt || function (x) { return x; };
      var add = qs.map(function (x) { return cp(x, brand); }).filter(function (x) { return texts.indexOf(x.replace(/\s/g, '')) < 0; }).map(function (x) { return { id: 'c' + Math.random().toString(36).slice(2, 9), text: x, on: true, src: 'customer' }; });
      st.prompts = add.concat(st.prompts);
      var n = 0; st.prompts.forEach(function (p) { if (p.on !== false) { n += 1; if (n > 10) p.on = false; } });
    }
    window.AirReachStudio.save();
    try { localStorage.removeItem(key); } catch (e) {}
  }
  function autoStart() {
    var u = new URL(location.href);
    if (u.searchParams.get('auto') !== '1') return;
    u.searchParams.delete('auto');
    try { history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) {}
    if (!client) return;
    var key = 'airreach_auto_started_v1:' + client.id;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch (e) {}
    var tries = 0;
    (function go() {
      var run = document.getElementById('orch-run'), url = document.getElementById('orch-url'), ok = document.getElementById('orch-proxy');
      if (!run || !url || !url.value || !window.AirReachStudio) { if (++tries < 40) setTimeout(go, 250); return; }
      if (ok) ok.checked = true; // 社内の人が顧客のサイトとして登録して始めた分析（取得サーバーを使うことがある）
      run.click();
    })();
  }

  window.AirReachStudioClients = { current: function () { return client; }, swapError: function () { return swapError; }, onMeasured: onMeasured, savedRun: savedRun, ensureSite: ensureSite, measuredThisMonth: measuredThisMonth, autoGscSync: autoGscSync };
})();
