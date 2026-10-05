/**
 * Google のユーザーデータ（Search Console・GA4 から取得したもの）の扱いを1か所で決める。
 *   方針（Google OAuth の審査・Limited Use 対応、2026-10）:
 *   1. Search Console の検索語句・表示回数・クリックなどは、AI計測の質問の生成・選択・並び順・優先順位に使わない。
 *      GSC の分析・画面の表示・改善の分析・月次レポートだけに使う
 *   2. 外部の AI に送れる質問は、お客様または担当者がはっきり設定・確定したもの（confirmed: true）だけ。
 *      Search Console 由来の質問（google: true）は確定できず、送れない
 *   3. 顧客の Google データを消したとき（契約終了・削除依頼）は、このブラウザに残っている分も消せるようにする
 * 画面・通信はしない（localStorage の読み書きだけ）。Studio・ダッシュボード・単体テストから使う。
 */
(function (root) {
  'use strict';

  // 空白・鉤括弧を除いて比べる（「町田 焼肉」と「町田焼肉」は同じ言葉）
  function norm(t) { return String(t == null ? '' : t).replace(/[\s　「」『』]+/g, ''); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /** Search Console 由来のキーワードか（分析で GSC から足した語・調べる言葉の出どころが gsc） */
  function isGscKeyword(k) {
    if (!k) return false;
    return k.seed_source === 'GSC' || k.source === 'gsc' || k.cluster === 'GSC';
  }
  /** Search Console / GA4 から取り込んだ行か（Studio の measurements。AI計測の行は除く） */
  function isGoogleRow(m) {
    if (!m) return false;
    if (m.source === 'gsc' || m.source === 'ga4' || m.gscProperty || m.ga4Property || m.host && (num(m.sessions) || num(m.keyEvents))) return true;
    return num(m.impressions) > 0 || num(m.clicks) > 0 || num(m.position) > 0 || num(m.sessions) > 0 || num(m.keyEvents) > 0;
  }

  /**
   * この作業にある Search Console の検索語句（比べるための形）。
   *   state: Studio の state（measurements・keywords）/ job: 分析の結果（keywords の seed_source）
   */
  function gscQuerySet(state, job) {
    var set = {};
    var add = function (t) { var k = norm(t); if (k.length >= 2) set[k] = 1; };
    ((state && state.measurements) || []).forEach(function (m) { if (isGoogleRow(m) && !num(m.sessions) && !num(m.keyEvents)) add(m.keyword || m.query); });
    ((state && state.keywords) || []).forEach(function (k) { if (isGscKeyword(k)) add(k.text || k.keyword); });
    ((job && job.keywords) || []).forEach(function (k) { if (isGscKeyword(k)) add(k.keyword || k.text); });
    return set;
  }
  function ctxOf(state, job) {
    return { gsc: gscQuerySet(state, job), brand: norm(state && state.profile && state.profile.brand) };
  }

  /**
   * 質問を作るときに使ってよいキーワード（Search Console 由来を除き、Search Console の数字を使わない順に並べる）。
   *   - 出どころが GSC の語は使わない
   *   - 出どころが分からない古いデータは、Search Console の検索語句と同じなら使わない
   *   - 並び順: Keyword Planner の月間検索数（あれば）→ 言葉の文字コード順（毎回同じ順）。表示回数・クリック・優先度（GSC で上がる）は使わない
   */
  function promptKeywords(keywords, ctx) {
    var gsc = (ctx && ctx.gsc) || {};
    var out = (keywords || []).filter(function (k) {
      var t = String((k && (k.text || k.keyword)) || '').trim();
      if (!t || isGscKeyword(k)) return false;
      var known = k.seed_source && k.seed_source !== 'GSC';
      return known || !gsc[norm(t)];
    });
    return out.map(function (k, i) { return { k: k, i: i }; }).sort(function (a, b) {
      var va = a.k.volume == null ? -1 : num(a.k.volume), vb = b.k.volume == null ? -1 : num(b.k.volume);
      if (vb !== va) return vb - va;
      var ta = String(a.k.text || a.k.keyword || ''), tb = String(b.k.text || b.k.keyword || '');
      return ta < tb ? -1 : ta > tb ? 1 : a.i - b.i;
    }).map(function (x) { return x.k; });
  }

  /**
   * Search Console 由来の質問か。
   *   - google: true が付いた質問（一度そう判定したら、文を直しても外れない）
   *   - キーワードから作った質問で、元の語が GSC 由来（kwSeed）か、GSC の検索語句と同じ
   *   - 出どころの分からない古い質問（src が keyword・空）で、文に GSC の検索語句が入っている（社名だけの語は除く）
   *   お客様の質問・指名質問・担当者が入力した質問は、文に同じ言葉があっても GSC 由来としない
   */
  function isGoogleDerivedPrompt(p, ctx) {
    if (!p) return false;
    if (p.google === true || p.src === 'gsc') return true;
    var src = p.src || '';
    if (src === 'manual' || src === 'customer' || src === 'branded') return false;
    var gsc = (ctx && ctx.gsc) || {};
    if (p.kw != null) {
      if (p.kwSeed === 'GSC') return true;
      if (p.kwSeed && p.kwSeed !== 'GSC') return false;
      return !!gsc[norm(p.kw)];
    }
    var text = norm(p.text || p.prompt), brand = (ctx && ctx.brand) || '';
    if (!text) return false;
    if (gsc[text]) return true;
    return Object.keys(gsc).some(function (q) { return text.indexOf(q) >= 0 && !(brand && brand.indexOf(q) >= 0); });
  }

  /** 質問の一覧に印を付ける（GSC 由来は google: true にして確定を外す）。変わったら true */
  function markPrompts(prompts, ctx) {
    var changed = false;
    (prompts || []).forEach(function (p) {
      if (p && p.google !== true && isGoogleDerivedPrompt(p, ctx)) { p.google = true; changed = true; }
      if (p && p.google === true && p.confirmed) { p.confirmed = false; changed = true; }
    });
    return changed;
  }
  function canConfirm(p, ctx) { return !!p && String(p.text || '').trim() !== '' && !isGoogleDerivedPrompt(p, ctx); }

  /**
   * 外部の AI に送ってよい質問だけを選ぶ（毎月測る・確定済み・GSC 由来でない）。
   *   戻り値: { send: [質問], google: GSC 由来で外した数, unconfirmed: 確定していないので外した数 }
   */
  function sendablePrompts(prompts, ctx) {
    var out = { send: [], google: 0, unconfirmed: 0 };
    (prompts || []).forEach(function (p) {
      if (!p || p.on === false || !String(p.text || '').trim()) return;
      if (isGoogleDerivedPrompt(p, ctx)) { out.google += 1; return; }
      if (p.confirmed !== true) { out.unconfirmed += 1; return; }
      out.send.push(p);
    });
    return out;
  }
  /** 計測 API に送る形（サーバーも confirmed と出どころを確かめる） */
  function toApiPrompt(p) {
    var t = String(p.text || p.prompt || '').trim();
    return { keyword: t, prompt: t, confirmed: p.confirmed === true, origin: p.src || 'manual' };
  }

  // ---- このブラウザに残っている Google データを消す ----------------------------------------
  var KEYS = {
    studio: 'airreach_studio_v1',
    orch: 'airreach_studio_orch_v1',
    baseline: 'airreach_official_baseline_v1',
    current: 'airreach_studio_ws_current_v1',
    props: 'airreach_google_props_v1',
    ackPrefix: 'airreach_google_purge_ack_v1:'
  };
  var CLIENT_PREFIXES = ['airreach_studio_ws_v1:', 'airreach_studio_sync_v1:', 'airreach_studio_backup_v1:'];

  /** Studio の作業（state）から Google のデータを除く。AI計測・生成した文書などはそのまま */
  function stripStudioState(st) {
    if (!st || typeof st !== 'object') return st;
    var ctx = ctxOf(st, null);
    if (Array.isArray(st.measurements)) st.measurements = st.measurements.filter(function (m) { return !isGoogleRow(m); });
    if (Array.isArray(st.keywords)) {
      st.keywords = st.keywords.filter(function (k) { return !isGscKeyword(k) && !(!k.seed_source && ctx.gsc[norm(k.text || k.keyword)]); });
      st.keywords.forEach(function (k) { delete k.gsc_impressions; delete k.gsc_clicks; delete k.gsc_position; });
    }
    if (Array.isArray(st.prompts)) st.prompts = st.prompts.filter(function (p) { return !isGoogleDerivedPrompt(p, ctx); });
    delete st.gscAuto; delete st.gscTotals; delete st.ga4Sites; delete st.gscSites;
    st.google = {};
    return st;
  }
  function stripWorkJson(s) {
    if (s == null) return s;
    try { var st = JSON.parse(s); return st ? JSON.stringify(stripStudioState(st)) : s; } catch (e) { return null; }
  }

  /**
   * このブラウザの Google データを消す。
   *   opts.clientId: その顧客の作業だけを消す（顧客のデータを消したとき）。作業はまるごと消す（DB でも作業ごと消すため）
   *   opts.clientId なし: すべての作業から Google のデータだけを除き、端末の基準値・控え・Google の設定を消す
   *   storage: 単体テスト用（省略時は localStorage）
   * 戻り値: 消した・直した保存場所の数
   */
  function purgeLocal(opts, storage) {
    opts = opts || {};
    var ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!ls) return 0;
    var n = 0;
    var keys = [];
    try { for (var i = 0; i < ls.length; i++) keys.push(ls.key(i)); } catch (e) { return 0; }
    var drop = function (k) { try { if (ls.getItem(k) != null) { ls.removeItem(k); n += 1; } } catch (e) {} };
    var id = opts.clientId ? String(opts.clientId).toLowerCase() : '';
    if (id) {
      CLIENT_PREFIXES.forEach(function (p) { drop(p + id); });
      var cur = ''; try { cur = ls.getItem(KEYS.current) || ''; } catch (e) {}
      if (cur === id) { drop(KEYS.studio); drop(KEYS.orch); drop(KEYS.baseline); }
      try {
        var props = JSON.parse(ls.getItem(KEYS.props) || 'null');
        if (props && props[id]) { delete props[id]; ls.setItem(KEYS.props, JSON.stringify(props)); n += 1; }
      } catch (e) {}
      if (opts.ack) { try { ls.setItem(KEYS.ackPrefix + id, String(opts.ack)); } catch (e) {} }
      return n;
    }
    keys.forEach(function (k) {
      if (k === KEYS.studio) {
        var v = stripWorkJson(ls.getItem(k));
        if (v == null) drop(k); else { ls.setItem(k, v); n += 1; }
      } else if (k === KEYS.orch || k === KEYS.baseline || k === KEYS.props || k.indexOf('airreach_studio_backup_v1:') === 0) {
        drop(k);
      } else if (k.indexOf('airreach_studio_ws_v1:') === 0) {
        try {
          var stash = JSON.parse(ls.getItem(k) || 'null') || {};
          stash[KEYS.studio] = stripWorkJson(stash[KEYS.studio]);
          stash[KEYS.orch] = null;
          ls.setItem(k, JSON.stringify(stash)); n += 1;
        } catch (e) { drop(k); }
      }
    });
    return n;
  }
  /** 顧客の Google データを DB で消した日時（clients.google_purged_at）より前の作業が、このブラウザに残っているか */
  function needsPurge(clientId, purgedAt, storage) {
    if (!clientId || !purgedAt) return false;
    var ls = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!ls) return false;
    var ack = '';
    try { ack = ls.getItem(KEYS.ackPrefix + String(clientId).toLowerCase()) || ''; } catch (e) {}
    return !ack || Date.parse(ack) < Date.parse(purgedAt);
  }

  var api = {
    norm: norm, isGscKeyword: isGscKeyword, isGoogleRow: isGoogleRow, gscQuerySet: gscQuerySet, ctxOf: ctxOf,
    promptKeywords: promptKeywords, isGoogleDerivedPrompt: isGoogleDerivedPrompt, markPrompts: markPrompts,
    canConfirm: canConfirm, sendablePrompts: sendablePrompts, toApiPrompt: toApiPrompt,
    stripStudioState: stripStudioState, purgeLocal: purgeLocal, needsPurge: needsPurge, KEYS: KEYS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AirReachGoogleGuard = api;
})(typeof window !== 'undefined' ? window : null);
