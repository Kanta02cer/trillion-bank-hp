/**
 * 案件の5段階（AI パッチ）：対象を決める → 導入前を測る → パッチを作る → 入れたか確かめる → 効果を比べる。
 *   今ある保存データだけから、各段階の状態と「次にやること」を1つ決める（新しい DB は使わない）。
 *   材料：Studio の作業（studio_workspaces.data：studio・orch.lastJob）と、AI 計測の記録（measurement_runs）
 */
(function (root) {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(iso) { var t = Date.parse(iso); if (isNaN(t)) return ''; var d = new Date(t + 9 * 3600000); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); }
  function manifestOf(job) { try { return JSON.parse(((job && job.files) || {})['MANIFEST.json'] || '{}'); } catch (e) { return {}; } }
  // 回答の記録がある計測（一覧では軽くするため要約 summary.ai3 だけを読むので、ai3 があれば回答ありとみなす）
  function hasAnswers(r) { var s = r && r.summary; return !!(s && ((Array.isArray(s.answers) && s.answers.length) || (s.ai3 && typeof s.ai3 === 'object'))); }
  function runTime(r) { return Date.parse(r.created_at || r.measured_on || '') || 0; }
  /** 計測1回の AI による概要の X/N（一般の質問）。保存した要約（summary.ai3）があればそれを、無ければ回答から数える */
  function aioOf(run) {
    var s = run && run.summary || {};
    var g = s.ai3 && (s.ai3.general || s.ai3) && (s.ai3.general || s.ai3).aio;
    if (g && g.status === 'measured') return { x: g.mentioned, n: g.denominator, rate: g.rate };
    if (root.AirReachAI3 && Array.isArray(s.answers)) {
      var t = root.AirReachAI3.summarize(s.answers, { segment: 'all' }).aio;
      if (t && t.status === 'measured') return { x: t.t.mentioned, n: t.t.denominator, rate: t.t.rate };
    }
    return null;
  }

  /**
   * 計測の時期（自動の定期計測は使わず、担当者が測る。時期だけ知らせる）
   *   ① 会社・サービスを確定したら、すぐ（導入前の計測）
   *   ② パッチを入れたと確かめた日から14日後（効果を測る。Google がページを読み直す時間）
   *   ③ それ以外は、前回の計測から30日後（毎月の計測）
   *   期日から3日過ぎたら「遅れ」。お客様には遅れは出さず「近日中に」と書く
   *   d: { entityAt, verifiedAt, verifiedOk, lastRunAt }（DB の airreach_measure_timing と同じ材料） / now: Date
   *   戻り値：{ kind: baseline|effect|monthly, due: Date, state: later|soon|due|late, days }（会社・サービスが未確定なら null）
   */
  var DAY = 86400000, EFFECT_DAYS = 14, MONTHLY_DAYS = 30, LATE_DAYS = 3;
  function jstDay0(t) { var d = new Date(t + 9 * 3600000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
  function timing(d, now) {
    d = d || {}; now = now || new Date();
    var ent = Date.parse(d.entityAt || ''), ver = Date.parse(d.verifiedAt || ''), last = Date.parse(d.lastRunAt || '');
    if (isNaN(ent)) return null;
    var kind, due;
    if (d.verifiedOk && !isNaN(ver) && !(last > ver)) { kind = 'effect'; due = ver + EFFECT_DAYS * DAY; }
    else if (isNaN(last)) { kind = 'baseline'; due = ent; }
    else { kind = 'monthly'; due = last + MONTHLY_DAYS * DAY; }
    // 日付（日本時間の日）で数える。期日の当日〜3日後は「時期」、それより後は「遅れ」
    var days = Math.round((jstDay0(due) - jstDay0(now.getTime())) / DAY);
    var state = days < -LATE_DAYS ? 'late' : days <= 0 ? 'due' : days <= 7 ? 'soon' : 'later';
    return { kind: kind, due: new Date(due), state: state, days: days, base: kind === 'effect' ? new Date(ver) : kind === 'monthly' ? new Date(last) : new Date(ent) };
  }
  var KIND_LABEL = { baseline: '導入前の計測', effect: '効果を測る計測', monthly: '毎月の計測' };
  var KIND_WHY = { baseline: '会社・サービスを確定したので、導入前を測ります', effect: 'パッチを入れたと確かめてから14日後（Google がページを読み直す時間）', monthly: '前回の計測から30日' };
  /** 担当者向けの短い言葉（一覧の印など） */
  function timingChip(t) {
    if (!t) return null;
    if (t.state === 'late') return { text: '計測が' + (-t.days) + '日遅れ', cls: 'is-bad' };
    if (t.state === 'due') return { text: '計測の時期（' + KIND_LABEL[t.kind] + '）', cls: 'is-warn' };
    return { text: '計測 ' + day(t.due.toISOString()) + (t.state === 'soon' ? '（' + t.days + '日後）' : ''), cls: '' };
  }
  /** 担当者向けの1行（顧客のホーム・計測の予定の画面） */
  function timingLine(t) {
    if (!t) return '会社・サービスを確定すると、計測の時期が決まります。';
    var when = t.kind === 'baseline' ? 'すぐ' : day(t.due.toISOString());
    return KIND_LABEL[t.kind] + '：' + when + '（' + KIND_WHY[t.kind] + (t.kind === 'monthly' ? '・前回 ' + day(t.base.toISOString()) : t.kind === 'effect' ? '・確かめた日 ' + day(t.base.toISOString()) : '') + '）' +
      (t.state === 'late' ? ' · ' + (-t.days) + '日遅れ' : t.state === 'due' && t.kind !== 'baseline' ? ' · 時期です' : '');
  }
  /** お客様向けの1行（遅れは出さない） */
  function timingCustomer(t) {
    if (!t) return '';
    var why = { baseline: 'いまの状態（導入前）を測ります。', effect: 'ページに入れた改善の効果を測ります。', monthly: '毎月の計測です。' }[t.kind];
    return (t.state === 'due' || t.state === 'late' ? '次の計測は、近日中に行います。' : '次の計測は ' + day(t.due.toISOString()) + ' ごろの予定です。') + why;
  }

  /**
   * opts: { workspace: studio_workspaces の data, runs: measurement_runs（新しい順でも古い順でもよい）, studioHref, runsHref }
   * 戻り値：{ steps: [{ key, label, state: done|current|todo, detail }], next: { title, why, href, button } }
   */
  function compute(opts) {
    opts = opts || {};
    var ws = opts.workspace || {}, job = ws.orch && ws.orch.lastJob, mf = manifestOf(job);
    var cf = job && job.confirm, ent = cf && cf.entity && cf.entity.at ? cf.entity : null;
    var runs = (opts.runs || []).filter(hasAnswers).slice().sort(function (a, b) { return runTime(a) - runTime(b); });
    var zipped = job && job.zipped && !job.zipped.draft ? job.zipped : null;
    var after = zipped ? runs.filter(function (r) { return runTime(r) > Date.parse(zipped.at); }) : [];
    var before = zipped ? runs.filter(function (r) { return runTime(r) <= Date.parse(zipped.at); }) : runs;
    var base = before.length ? before[before.length - 1] : null;
    var fc = mf.faq_counts || {};
    var S = opts.studioHref != null ? opts.studioHref : '/airreach/studio/'; // Studio の中から使うときは ''（#panel だけ）
    var steps = [
      { key: 'target', label: '対象を決める', done: !!ent,
        detail: ent ? '確定 ' + day(ent.at) + '：' + ent.company + '・' + ent.service : (job ? '会社・サービスが未確定' : 'まだサイトを調べていない') },
      { key: 'baseline', label: '導入前を測る', done: !!base,
        detail: base ? (function () { var a = aioOf(base); return day(base.created_at || base.measured_on) + (a && a.n ? '：AI による概要 ' + a.x + ' / ' + a.n + '回' : '：計測あり'); })() : 'まだ測っていない' },
      { key: 'patch', label: 'パッチを作る', done: !!zipped,
        detail: zipped ? 'ZIP v' + (zipped.version || '?') + '（' + day(zipped.at) + '）' : (fc.pending_approval ? '承認待ち ' + fc.pending_approval + '問' : (job ? 'まだ ZIP を作っていない' : '—')) },
      { key: 'verify', label: '入れたか確かめる', done: !!(job && job.verified && job.verified.ok && zipped),
        detail: job && job.verified ? (job.verified.ok ? '入っている（' + day(job.verified.at) + '）' : '入っていないところがある（' + day(job.verified.at) + '）') : (zipped ? 'サイトに入ったら確かめる' : '—') },
      { key: 'compare', label: '効果を比べる', done: after.length > 0 && !!base,
        detail: after.length && base ? '導入後の計測 ' + after.length + '回' : (zipped ? '導入後にまだ測っていない' : '—') }
    ];
    // いまの段階＝最初の未完了。④を確かめる前に導入後の計測をしていれば、④は済んだものとみなす（手で確かめた場合）
    if (!steps[3].done && steps[4].done) steps[3].done = true;
    var cur = -1;
    steps.forEach(function (s, i) { s.state = s.done ? 'done' : (cur < 0 ? (cur = i, 'current') : 'todo'); });
    var NEXT = [
      { title: job ? '会社・サービスを確定する' : 'サイトを調べる', why: job ? '確定した名前とサービスを、計測とパッチで使います。' : 'サイトを読んで、会社・サービス・質問の候補を作ります。', href: S + (job ? '#generator' : '#start'), button: job ? '確定に進む' : 'サイトを調べる' },
      { title: '導入前の計測をする', why: 'あとで比べる「導入前」になります。確定した質問を AI に聞きます。', href: S + '#hack2', button: '計測に進む' },
      { title: fc.pending_approval ? 'よくある質問 ' + fc.pending_approval + '問を承認して、パッチを作る' : 'パッチ（ZIP）を作る', why: '承認した答えだけがパッチに入ります。', href: S + '#generator', button: fc.pending_approval ? '承認に進む' : 'パッチを作る' },
      { title: job && job.verified && !job.verified.ok ? 'サイトに入っていないところを直して、もう一度確かめる' : 'パッチがサイトに入ったか確かめる', why: '公開ページを読んで、承認した質問と答え・構造化データ・llms.txt が ZIP と同じかを見ます。入ったら、Google が読んだあとに測ります。', href: S + '#verify', button: '確かめる' },
      { title: '導入後の計測をして、比べる', why: '導入前と同じ質問・地域・AI で測り、「AI 計測の記録」で2回を選んで比べます。', href: opts.runsHref || '#', button: '比べる' }
    ];
    var next = cur >= 0 ? NEXT[cur] : { title: '次の改善を始める', why: '効果を確かめました。課題を見直して、次のパッチを作ります。', href: S + '#generator', button: '次の改善へ' };
    var lastRun = runs.length ? runs[runs.length - 1] : null;
    var tm = timing({ entityAt: ent && ent.at, verifiedAt: job && job.verified && job.verified.at, verifiedOk: !!(job && job.verified && job.verified.ok), lastRunAt: lastRun ? (lastRun.created_at || lastRun.measured_on) : null }, opts.now);
    // 効果・毎月の計測の時期が来ていれば、次にやることを計測にする（導入前の計測は②の段階としてすでに出ている）
    if (tm && tm.kind !== 'baseline' && (tm.state === 'due' || tm.state === 'late')) {
      next = { title: (tm.kind === 'effect' ? '効果を測る' : '毎月の計測をする') + (tm.state === 'late' ? '（' + (-tm.days) + '日遅れ）' : ''), why: timingLine(tm) + '。導入前と同じ質問・地域・AI で測ります。', href: S + '#hack2', button: '計測に進む', timing: true };
    }
    return { steps: steps, current: cur, next: next, timing: tm };
  }

  /** ダッシュボードの顧客のホームに出す枠 */
  function cardHtml(res) {
    var steps = res.steps.map(function (s, i) {
      var mark = s.state === 'done' ? '✓' : String(i + 1);
      return '<li class="acs-step is-' + s.state + '"' + (s.state === 'current' ? ' aria-current="step"' : '') + '><span class="acs-dot" aria-hidden="true">' + esc(mark) + '</span><span><b>' + esc(s.label) + '</b><small>' + esc(s.detail) + '</small></span></li>';
    }).join('');
    return '<section class="arc-card acs" aria-label="この案件の進み具合">' +
      '<div class="acs-next"><div><div class="acs-eyebrow">次にやること</div><div class="acs-title">' + esc(res.next.title) + '</div><p class="acs-why">' + esc(res.next.why) + '</p></div>' +
      '<a class="arc-btn acs-go" href="' + esc(res.next.href) + '">' + esc(res.next.button) + ' →</a></div>' +
      '<ol class="acs-steps">' + steps + '</ol>' + (res.timing !== undefined ? '<p class="acs-timing' + (res.timing && res.timing.state === 'late' ? ' is-late' : '') + '">計測の予定　' + esc(timingLine(res.timing)) + '</p>' : '') + '</section>';
  }

  var api = { compute: compute, cardHtml: cardHtml, aioOf: aioOf, timing: timing, timingChip: timingChip, timingLine: timingLine, timingCustomer: timingCustomer, KIND_LABEL: KIND_LABEL };
  root.AirReachCaseSteps = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
