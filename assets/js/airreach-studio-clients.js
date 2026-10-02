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
        s.from('measurement_runs').select('measured_on,source').eq('client_id', client.id).order('measured_on', { ascending: false }).limit(1),
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
          el.innerHTML = '<span class="n">' + n + '</span>' + esc(it.label);
          delete btns[it.panel];
        } else {
          el = document.createElement('a');
          el.className = 'ars-side-link';
          el.href = N.href(it, navClient);
          el.innerHTML = '<span class="n">' + n + '</span>' + esc(it.label);
        }
        frag.appendChild(el);
      });
    });
    // 共通の並びに無い Studio の画面が残っていれば、最後に置く（消さない）
    Object.keys(btns).forEach(function (k) { n += 1; var b = btns[k]; var sp = b.querySelector('.n'); if (sp) sp.textContent = n; frag.appendChild(b); });
    side.innerHTML = '';
    side.appendChild(frag);
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
      var host = document.getElementById('ars-client-sum'); if (!host) return;
      box = document.createElement('div'); box.id = 'ars-sync'; box.className = 'ars-sync'; box.setAttribute('aria-live', 'polite'); host.appendChild(box);
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
      if (!session) { syncStatus('このパソコンだけに保存しています。ダッシュボードにログインすると、社内で共有されます。', 'warn'); return; }
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
      });
    }).catch(function () { syncStatus('共有の状態を確かめられませんでした（このパソコンには保存されています）', 'warn'); });
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
            if (st) st.textContent += ' ／ 顧客の「AI計測の記録」に保存しました（月次レポートに使えます）';
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

  function init() { rebuildSide(); renderPicker(); renderSummary(); prefillBrand(); startSync(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.AirReachStudioClients = { current: function () { return client; }, swapError: function () { return swapError; }, onMeasured: onMeasured, savedRun: savedRun };
})();
