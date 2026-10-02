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

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function studioUrl(c, site) {
    var p = new URLSearchParams();
    p.set('client', c.id); p.set('client_name', c.name || '');
    if (site) p.set('url', site);
    if (c.industry_id) p.set('industry', c.industry_id);
    return '/airreach/studio/?' + p.toString();
  }
  function ymd(s) { return String(s || '').slice(0, 10); }

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
        s.from('reports').select('status').eq('client_id', client.id).eq('period_month', month).maybeSingle()
      ]);
    }).then(function (rs) {
      if (rs[0].error) throw rs[0].error;
      var sc = (rs[0].data || [])[0], run = (rs[1].data || [])[0], rep = rs[2] && rs[2].data;
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
  function init() { renderPicker(); renderSummary(); prefillBrand(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.AirReachStudioClients = { current: function () { return client; }, swapError: function () { return swapError; } };
})();
