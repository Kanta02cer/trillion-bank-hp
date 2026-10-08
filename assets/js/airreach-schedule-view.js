/**
 * AirReach 定期計測と費用（社内だけ）：計算と表示の部品。
 *   - 費用の見込みは、計測サーバーの既定の単価（api/airreach/schedule-run.js の DEFAULT_COST_PER_ANSWER）と同じ表で計算する。
 *     サーバーで単価を上書きしている（AIRREACH_COST_PER_ANSWER）ときは、実際の上限の判定はサーバーの値で行われる（ここは目安）
 *   - 上限の考え方は airreach_schedule_limit_check（supabase/migrations/20261006120000_airreach_schedule_guards.sql）と同じ：
 *     月の実行回数・月の回答数・月の費用の見込みのどれかを超える回は実行せず「見送り」
 */
(function (root) {
  'use strict';
  // 変えるときは api/airreach/schedule-run.js の DEFAULT_COST_PER_ANSWER と両方
  var COST = { chatgpt: 0.0003, chatgpt_search: 0.015, claude: 0.02, perplexity: 0.006, gemini: 0.035, google_aio: 0.03, google_ai_mode: 0.015 };
  var ENGINES = [['google_aio', 'Google の AI による概要'], ['google_ai_mode', 'Google の AI モード'], ['chatgpt_search', 'ChatGPT（検索あり）'], ['perplexity', 'Perplexity'], ['gemini', 'Gemini'], ['claude', 'Claude（検索あり）'], ['chatgpt', 'ChatGPT（検索なし）']];
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function usd(n) { var v = Number(n) || 0; return (v < 1 ? v.toFixed(2) : v < 100 ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v))); }
  // 日本時間の年・月・日・曜日・時（Date は UTC で持つ）
  function jstParts(d) { var x = new Date(d.getTime() + 9 * 3600 * 1000); return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), wd: x.getUTCDay(), h: x.getUTCHours(), mi: x.getUTCMinutes() }; }
  function jstDate(y, m, d, h) { return new Date(Date.UTC(y, m, d, h - 9, 0, 0)); }

  /** 1回の実行の回答数と費用の見込み */
  function perRun(s) {
    var p = (s.prompts || []).length, r = Number(s.repeats) || 1, engs = s.engines || [];
    var cost = engs.reduce(function (a, e) { return a + (COST[e] || 0); }, 0) * p * r;
    return { answers: p * engs.length * r, cost: Math.round(cost * 10000) / 10000 };
  }
  /** その月（日本時間）に、曜日の設定で予定が入る回数 */
  function slotsInMonth(s, now) {
    var t = jstParts(now), days = new Date(Date.UTC(t.y, t.m + 1, 0)).getUTCDate(), n = 0;
    for (var d = 1; d <= days; d++) if ((s.weekdays || []).indexOf(new Date(Date.UTC(t.y, t.m, d)).getUTCDay()) >= 0) n++;
    return n;
  }
  /**
   * 月の見込み：予定の回数（曜日の数と月の実行回数の上限の小さい方）・回答数・費用。
   * 上限（回答数・費用）にかかると、何回目から止まるか（stopAt。かからなければ null）と、その理由
   */
  function monthPlan(s, now) {
    var one = perRun(s), slots = slotsInMonth(s, now || new Date()), runs = Math.min(slots, Number(s.max_runs_per_month) || 0);
    var stopAt = null, why = '';
    for (var k = 1; k <= runs; k++) {
      if (one.answers * k > (Number(s.monthly_answer_cap) || 0)) { stopAt = k; why = '回答数の上限 ' + s.monthly_answer_cap + '回答'; break; }
      if (one.cost * k > (Number(s.monthly_cost_cap_usd) || 0) + 1e-9) { stopAt = k; why = '費用の上限 ' + usd(s.monthly_cost_cap_usd) + 'ドル'; break; }
    }
    var done = stopAt ? stopAt - 1 : runs;
    return { perRun: one, slots: slots, runs: runs, wanted: { answers: one.answers * runs, cost: Math.round(one.cost * runs * 100) / 100 }, done: done,
      answers: one.answers * done, cost: Math.round(one.cost * done * 100) / 100, stopAt: stopAt, why: why, capByRuns: slots > runs };
  }
  /** 次の予定（日本時間の曜日と時刻）。止めている・曜日が無いときは null */
  function nextSlot(s, now) {
    if (!s || !s.enabled || !(s.weekdays || []).length) return null;
    now = now || new Date();
    var t = jstParts(now);
    for (var i = 0; i <= 7; i++) {
      var day = new Date(Date.UTC(t.y, t.m, t.d + i)), wd = day.getUTCDay();
      if ((s.weekdays || []).indexOf(wd) < 0) continue;
      var at = jstDate(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), Number(s.hour_jst) || 0);
      if (at > now) return at;
    }
    return null;
  }
  function slotLabel(d) { if (!d) return ''; var t = jstParts(d); return (t.m + 1) + '/' + t.d + '（' + WD[t.wd] + '）' + t.h + ':' + (t.mi < 10 ? '0' : '') + t.mi; }
  function monthStartOf(now) { var t = jstParts(now || new Date()); return jstDate(t.y, t.m, 1, 0); }
  /** 今月の使った分（サーバーの airreach_schedule_usage と同じ数え方） */
  function usage(jobs, now) {
    var ms = monthStartOf(now).getTime(), u = { runs: 0, answers: 0, cost: 0 };
    (jobs || []).forEach(function (j) {
      if (Date.parse(j.slot) < ms) return;
      if (['running', 'succeeded', 'partial'].indexOf(j.status) >= 0) u.runs++;
      if (['running', 'succeeded', 'partial', 'failed'].indexOf(j.status) >= 0) {
        u.answers += Number(j.status === 'running' ? j.answers_planned : j.answers_done) || 0;
        u.cost += Number(j.est_cost_usd) || 0;
      }
    });
    u.cost = Math.round(u.cost * 1000) / 1000;
    return u;
  }
  /**
   * AI ごとの状態：いちばん新しい計測の回答から。取れた回答があれば「使える」、支払い・上限で取れなければその理由
   *   answers: summary.answers（engine・status・error）
   */
  function engineStatus(answers) {
    var by = {};
    (answers || []).forEach(function (a) {
      var e = a && (a.engine || (a.conditions && a.conditions.engine)); if (!e) return;
      var x = by[e] || (by[e] = { ok: 0, err: 0, billing: 0, quota: 0 });
      if (a.status === 'ok' || a.status === 'not_shown') x.ok++;
      else if (a.status === 'error') {
        x.err++;
        var m = String(a.error || '') + ' ' + String(a.error_type || '');
        if (/quota_billing|billing/i.test(m)) x.billing++; else if (/quota_zero|quota_daily|rate limit|quota/i.test(m)) x.quota++;
      }
    });
    var out = {};
    Object.keys(by).forEach(function (e) {
      var x = by[e];
      out[e] = x.ok ? ['使える', 'is-ok'] : x.billing ? ['支払いの設定待ち', 'is-warn'] : x.quota ? ['回数の上限に当たった', 'is-warn'] : x.err ? ['取れなかった', 'is-warn'] : ['まだ測っていない', ''];
    });
    return out;
  }
  /** 今月これからの予定の分（今日より後の予定の日を、上限の内で足していく）。止めているときは0 */
  function remaining(s, jobs, now) {
    now = now || new Date();
    var u = usage(jobs, now), one = perRun(s), t = jstParts(now), days = new Date(Date.UTC(t.y, t.m + 1, 0)).getUTCDate(), add = { runs: 0, answers: 0, cost: 0 };
    if (!s || !s.enabled || !one.answers) return add;
    for (var d = t.d; d <= days; d++) {
      var day = new Date(Date.UTC(t.y, t.m, d));
      if ((s.weekdays || []).indexOf(day.getUTCDay()) < 0 || jstDate(t.y, t.m, d, Number(s.hour_jst) || 0) <= now) continue;
      if (u.runs + add.runs + 1 > (Number(s.max_runs_per_month) || 0)) break;
      if (u.answers + add.answers + one.answers > (Number(s.monthly_answer_cap) || 0)) break;
      if (u.cost + add.cost + one.cost > (Number(s.monthly_cost_cap_usd) || 0) + 1e-9) break;
      add.runs++; add.answers += one.answers; add.cost += one.cost;
    }
    add.cost = Math.round(add.cost * 1000) / 1000;
    return add;
  }
  /** 上の3つの数字：今月の費用の見込み・次の計測・前回 */
  function tilesHtml(o) {
    var cap = Number(o.cap) || 0, used = Number(o.used) || 0, pct = cap ? Math.min(100, Math.round(used / cap * 100)) : 0;
    var last = o.last, LS = { succeeded: '成功', partial: '一部成功', failed: '失敗', skipped: '見送り', running: '実行中', queued: '待ち' };
    return '<div class="asv-tiles">' +
      '<section class="asv-tile"><span class="asv-k">今月の費用の見込み</span><span class="asv-v"><b>' + esc(usd(used)) + '</b> / ' + esc(usd(cap)) + ' ドル</span>' +
        '<span class="asv-bar" role="img" aria-label="上限の ' + pct + '%"><i style="width:' + pct + '%"' + (pct >= 90 ? ' class="is-hi"' : '') + '></i></span>' + (o.planned != null ? '<small>月末までの予定を入れると 約 ' + esc(usd(o.planned)) + ' ドル</small>' : '') + '</section>' +
      '<section class="asv-tile"><span class="asv-k">次の計測</span><span class="asv-v"><b class="asv-m">' + (o.next ? esc(slotLabel(o.next)) : '止めています') + '</b></span>' + (o.nextSub ? '<small>' + esc(o.nextSub) + '</small>' : '') + '</section>' +
      '<section class="asv-tile"><span class="asv-k">前回</span><span class="asv-v"><b class="asv-m">' + (last ? esc(slotLabel(new Date(last.slot))) + ' · ' + esc(LS[last.status] || last.status) : 'まだありません') + '</b></span>' +
        (last ? '<small>' + (last.status === 'skipped' ? esc(last.skip_reason || '') : esc(last.answers_done) + ' / ' + esc(last.answers_planned) + '回答' + (last.errors ? ' · 取れなかった ' + esc(last.errors) + '回' : '')) + '</small>' : '') + '</section></div>';
  }
  /** 見込みの1行（設定の欄の下）。上限にかかるなら、何回目から止まるかを太字で */
  function planLine(s, now) {
    var p = monthPlan(s, now), np = (s.prompts || []).length, ne = (s.engines || []).length;
    if (!np || !ne) return '質問と AI を選ぶと、月の回答数と費用の見込みが出ます。';
    return '見込み：質問 ' + np + ' × AI ' + ne + (Number(s.repeats) > 1 ? ' × ' + s.repeats + '回' : '') + ' ＝ 1回 ' + p.perRun.answers + '回答・約 ' + usd(p.perRun.cost) + ' ドル。月の予定 ' + p.runs + '回' +
      (p.capByRuns ? '（曜日では ' + p.slots + '回・月の実行回数の上限 ' + s.max_runs_per_month + '回）' : '') + ' ＝ ' + p.wanted.answers + '回答・約 ' + usd(p.wanted.cost) + ' ドル' +
      (p.stopAt ? ' → <b class="asv-stop">' + esc(p.why) + 'を超えるので、月の ' + p.stopAt + '回目からは止まります</b>' : '（上限の内）');
  }
  var api = { COST: COST, ENGINES: ENGINES, WD: WD, perRun: perRun, slotsInMonth: slotsInMonth, monthPlan: monthPlan, nextSlot: nextSlot, slotLabel: slotLabel, usage: usage, remaining: remaining, engineStatus: engineStatus, tilesHtml: tilesHtml, planLine: planLine, usd: usd };
  if (root) root.AirReachScheduleView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
