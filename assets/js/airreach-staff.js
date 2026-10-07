/**
 * 担当者ダッシュボードの判断（画面に依存しない部分）。
 *   - 流入の対象期間（全期間・途中集計・期間の記録なし）と、前月と比べてよいか
 *   - レポートの下書きの数字が、いまの材料より古いか（何が変わったか）
 *   - 月次の工程「直す材料を作る」の判定（今月の登録・前月からの持ち越し）
 *   - 顧客一覧の絞り込みに使う印（担当・期限・AI未計測・Google未取得・差し戻し・依頼）
 *   - 入力の自動保存（保存中・保存済み・失敗、連打・順序・失敗時の保持）
 *   - Studio を顧客の作業として開くリンク
 * テスト: scripts/airreach-api/unit-staff.mjs
 */
(function (root) {
  'use strict';
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function lastDay(month) { var y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)); return ymd(new Date(Date.UTC(y, m, 0))); }
  function md(s) { var m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Number(m[1]) + '/' + Number(m[2]) : ''; }
  function jstStamp(iso) {
    var t = Date.parse(iso || ''); if (isNaN(t)) return '';
    var d = new Date(t + 9 * 3600000);
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }

  // ---- 流入の対象期間 -------------------------------------------------------------
  /**
   * 取得した数字（compileReport の traffic.gsc / ga4。metrics の start_date・end_date・days・fetched_at を持つことがある）の対象期間。
   *   full: その月の1日〜末日／partial: 1日〜月の途中（途中集計）／other: それ以外の期間／unknown: 期間の記録なし（CSV・手入力・古い取得）
   * 期間が記録されていないものは推測で補わない
   */
  function periodOf(rec, periodMonth) {
    if (!rec) return null;
    var month = String(periodMonth || '').slice(0, 10);
    var start = rec.start_date || rec.startDate || '', end = rec.end_date || rec.endDate || '';
    var fetchedAt = rec.fetched_at || rec.fetchedAt || '';
    if (!start || !end || !/^\d{4}-\d{2}-01$/.test(month)) {
      return { status: 'unknown', start: null, end: null, days: null, fetchedAt: fetchedAt || null, label: '期間の記録なし', short: '期間不明' };
    }
    var last = lastDay(month);
    var days = rec.days != null ? Number(rec.days) : Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
    var status = start === month && end === last ? 'full' : (start === month && end < last ? 'partial' : 'other');
    var range = md(start) + '〜' + md(end);
    var label = status === 'full' ? range + '（全期間）' : status === 'partial' ? range + '（途中集計・' + days + '日間）' : range + '（' + days + '日間）';
    return { status: status, start: start, end: end, days: days, monthDays: Number(last.slice(8, 10)), fetchedAt: fetchedAt || null, label: label,
      short: status === 'partial' ? '途中集計 〜' + md(end) : status === 'full' ? '全期間' : range };
  }
  /**
   * 今月と前月を比べてよいか。両方が全期間（または同じ日数）のときだけ増減を出す。
   *   compare: 増減を出す／reference: 前月の値は参考として出すが、増減（悪化・改善）は断定しない／none: 比べるものが無い
   */
  function compare(cur, prev, curP, prevP) {
    if (cur == null || prev == null || !curP || !prevP) return { mode: 'none', delta: null, reason: prev == null ? '前月の数字がありません' : '' };
    if (curP.status === 'full' && prevP.status === 'full') return { mode: 'compare', delta: cur - prev, reason: '' };
    if (curP.status !== 'unknown' && prevP.status !== 'unknown' && curP.days === prevP.days && curP.status === prevP.status) return { mode: 'compare', delta: cur - prev, reason: '同じ日数で比較' };
    if (curP.status === 'partial') return { mode: 'reference', delta: null, reason: '今月は' + md(curP.end) + 'までの途中集計のため、前月全体とは比べていません' };
    if (curP.status === 'unknown' || prevP.status === 'unknown') return { mode: 'reference', delta: null, reason: '対象期間の記録がないため、増減は判断していません' };
    return { mode: 'reference', delta: null, reason: '対象期間がそろっていないため、増減は判断していません' };
  }

  // ---- レポートの数字の鮮度 -----------------------------------------------------------
  function sig(c) {
    c = c || {};
    var cur = c.site && c.site.current, ai = c.ai, tr = c.traffic || {};
    return {
      score: cur ? cur.overall : null, scanAt: cur ? String(cur.createdAt || '').slice(0, 19) : null,
      aiRuns: ai ? (ai.runs != null ? ai.runs : 1) : 0, aiLast: ai ? (ai.lastOn || (ai.latest && ai.latest.measuredOn) || ai.measuredOn || null) : null,
      clicks: tr.gsc ? (tr.gsc.clicks != null ? tr.gsc.clicks : null) : null, clicksEnd: tr.gsc ? (tr.gsc.end_date || null) : null,
      conv: tr.ga4 ? (tr.ga4.conversions != null ? tr.ga4.conversions : null) : null, convEnd: tr.ga4 ? (tr.ga4.end_date || null) : null,
      actions: (c.actions || []).length
    };
  }
  /** 保存した集計（下書き）と、いまの材料で集計し直した結果の違い。stale=true なら「新しいデータがあります」 */
  function freshness(saved, live) {
    var a = sig(saved), b = sig(live), ch = [];
    var na = function (v, unit) { return v == null ? '未計測' : v + (unit || ''); };
    if (a.score !== b.score || a.scanAt !== b.scanAt) ch.push({ key: 'site', label: '情報整備の点数', from: na(a.score, '点'), to: na(b.score, '点') + (b.scanAt ? '（' + md(b.scanAt) + 'の診断）' : '') });
    if (a.aiRuns !== b.aiRuns || a.aiLast !== b.aiLast) ch.push({ key: 'ai', label: 'AI での見え方', from: a.aiRuns ? a.aiRuns + '回の計測' : '未計測', to: b.aiRuns ? b.aiRuns + '回の計測' + (b.aiLast ? '（最新 ' + md(b.aiLast) + '）' : '') : '未計測' });
    if (a.clicks !== b.clicks || a.clicksEnd !== b.clicksEnd) ch.push({ key: 'gsc', label: '検索からのクリック', from: na(a.clicks, '回'), to: na(b.clicks, '回') + (b.clicksEnd ? '（〜' + md(b.clicksEnd) + '）' : '') });
    if (a.conv !== b.conv || a.convEnd !== b.convEnd) ch.push({ key: 'ga4', label: '問い合わせ・予約', from: na(a.conv, '件'), to: na(b.conv, '件') + (b.convEnd ? '（〜' + md(b.convEnd) + '）' : '') });
    if (a.actions !== b.actions) ch.push({ key: 'actions', label: '今月実施した施策', from: a.actions + '件', to: b.actions + '件' });
    return { stale: ch.length > 0, changes: ch, compiledAt: (saved && saved.generatedAt) || null, compiledAtLabel: jstStamp(saved && saved.generatedAt) };
  }

  // ---- 月次の工程「直す材料を作る」 ----------------------------------------------------
  /**
   * 今月登録した施策（予定・実施済み）があれば「予定登録済み」。前月から残った予定は持ち越しとして数えるだけで、今月の完了にはしない。
   * お客様・制作会社へ渡したかどうかは記録が無いので、判定しない
   */
  function materialsStep(actions, month) {
    var mon = String(month || '').slice(0, 7);
    var mine = (actions || []).filter(function (a) { return String(a.created_at || '').slice(0, 7) === mon; });
    var carry = (actions || []).filter(function (a) { return a.status !== 'done' && String(a.created_at || '').slice(0, 7) < mon; });
    var notes = [];
    if (mine.length) notes.push('今月の登録 ' + mine.length + '件');
    if (carry.length) notes.push('前月からの持ち越し ' + carry.length + '件');
    return { ok: mine.length > 0, thisMonth: mine.length, carry: carry.length, note: notes.join('・'), doneLabel: '予定登録済み' };
  }

  // ---- 顧客一覧の印 -----------------------------------------------------------------
  /** 毎月の報告期限（日）から、その月の期限日と残り日数。未設定なら null（架空の期限は作らない） */
  function dueOf(dueDay, month, today) {
    var d = Number(dueDay);
    if (!d || d < 1 || d > 31) return null;
    var last = lastDay(String(month).slice(0, 7) + '-01');
    var day = Math.min(d, Number(last.slice(8, 10)));
    var date = String(month).slice(0, 7) + '-' + pad(day);
    var left = Math.round((Date.parse(date) - Date.parse(String(today).slice(0, 10))) / 86400000);
    return { date: date, daysLeft: left, label: md(date) + (left < 0 ? '（' + (-left) + '日超過）' : left === 0 ? '（今日）' : '（あと' + left + '日）') };
  }
  /**
   * 顧客ごとの印。x = { client, me, month, today, report, lastEvent, runsThisMonth, trafficThisMonth: [source], pendingRequests }
   */
  function triage(x) {
    var c = x.client || {}, rep = x.report || null, published = rep && rep.status === 'published';
    var due = dueOf(c.report_due_day, x.month, x.today);
    var src = x.trafficThisMonth || [];
    var f = {
      mine: !!(c.owner_email && x.me && c.owner_email === x.me),
      ownerSet: !!c.owner_email,
      dueSet: !!due,
      dueSoon: !!(due && !published && due.daysLeft <= 3),
      overdue: !!(due && !published && due.daysLeft < 0),
      aiMissing: !(x.runsThisMonth > 0),
      googleMissing: !(src.some(function (s) { return /^gsc/.test(s); }) && src.some(function (s) { return /^ga4/.test(s); })),
      returned: !!(rep && rep.status === 'draft' && x.lastEvent === 'returned'),
      requests: x.pendingRequests || 0,
      due: due
    };
    // 並べる順：期限超過 → 期限が近い → 差し戻し → 依頼 → そのほか
    f.rank = (f.overdue ? 0 : f.dueSoon ? 1 : f.returned ? 2 : f.requests ? 3 : 4);
    return f;
  }

  // ---- 自動保存 -------------------------------------------------------------------
  /**
   * opts: { save(payload) → Promise, collect() → payload, delay: ミリ秒, onState(state, info), backup: { write(payload), clear() } }
   * - 入力のたびに backup.write（端末に残す）→ delay 後に保存。保存中に入力が続いたら、終わってからもう一度保存（順番が入れ替わらない）
   * - 失敗しても入力と端末の控えは残す。state: 'idle'|'dirty'|'saving'|'saved'|'error'
   * - flush(): 待たずにすぐ保存（確認依頼・画面の移動の前）。進行中の保存も待つ
   */
  function Autosave(opts) {
    var self = this, timer = null, inflight = null, again = false, lastSaved = null;
    self.state = 'idle';
    function set(st, info) { self.state = st; if (opts.onState) opts.onState(st, info || {}); }
    function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
    function run() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (inflight) { again = true; return inflight; }
      var payload = opts.collect();
      if (lastSaved && same(payload, lastSaved) && self.state !== 'error') { set('saved', { at: self.savedAt }); return Promise.resolve(); }
      set('saving');
      inflight = Promise.resolve().then(function () { return opts.save(payload); }).then(function () {
        lastSaved = payload; self.savedAt = new Date();
        inflight = null;
        if (again) { again = false; return run(); }
        if (opts.backup && same(opts.collect(), payload)) opts.backup.clear();
        set('saved', { at: self.savedAt });
      }, function (e) {
        inflight = null; again = false;
        set('error', { error: e });
        throw e;
      });
      return inflight;
    }
    self.changed = function () {
      if (opts.backup) { try { opts.backup.write(opts.collect()); } catch (e) { /* 端末に残せなくても保存は続ける */ } }
      set('dirty');
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { run().catch(function () {}); }, opts.delay == null ? 1500 : opts.delay);
    };
    self.flush = function () { return run(); };
    self.dirty = function () { return self.state === 'dirty' || self.state === 'saving' || self.state === 'error' || !!timer; };
    self.markSaved = function (payload) { lastSaved = payload; };
    self.stop = function () { if (timer) clearTimeout(timer); timer = null; };
  }

  // ---- Studio へのリンク ------------------------------------------------------------
  /** 顧客を必ず URL で渡す（このタブで前に開いていた別の顧客に頼らない）。顧客が分からなければ顧客なしで開く */
  function studioLink(client, panel) {
    var base;
    if (root.AirReachNav && root.AirReachNav.studioBase) base = root.AirReachNav.studioBase(client);
    else if (!client || !client.id) base = '/airreach/studio/?client=none';
    else {
      var p = new URLSearchParams();
      p.set('client', client.id); p.set('client_name', client.name || '');
      if (client.site) p.set('url', client.site);
      if (client.industry) p.set('industry', client.industry);
      base = '/airreach/studio/?' + p.toString();
    }
    return base + (panel ? '#' + panel : '');
  }

  var api = { periodOf: periodOf, compare: compare, freshness: freshness, materialsStep: materialsStep, dueOf: dueOf, triage: triage, Autosave: Autosave, studioLink: studioLink, md: md, jstStamp: jstStamp, lastDay: lastDay };
  root.AirReachStaff = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
