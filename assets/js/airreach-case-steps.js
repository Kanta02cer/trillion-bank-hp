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
  function hasAnswers(r) { return !!(r && r.summary && Array.isArray(r.summary.answers) && r.summary.answers.length); }
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
      { key: 'verify', label: '入れたか確かめる', done: !!(job && job.verified), manual: true,
        detail: job && job.verified ? '確かめた ' + day(job.verified.at) : (zipped ? 'サイトに入ったら確かめる' : '—') },
      { key: 'compare', label: '効果を比べる', done: after.length > 0 && !!base,
        detail: after.length && base ? '導入後の計測 ' + after.length + '回' : (zipped ? '導入後にまだ測っていない' : '—') }
    ];
    // いまの段階＝最初の未完了。「入れたか確かめる」は手で確かめる段階なので、導入後の計測があれば済んだものとみなす
    if (!steps[3].done && steps[4].done) steps[3].done = true;
    var cur = -1;
    steps.forEach(function (s, i) { s.state = s.done ? 'done' : (cur < 0 ? (cur = i, 'current') : 'todo'); });
    var NEXT = [
      { title: job ? '会社・サービスを確定する' : 'サイトを調べる', why: job ? '確定した名前とサービスを、計測とパッチで使います。' : 'サイトを読んで、会社・サービス・質問の候補を作ります。', href: S + (job ? '#generator' : '#start'), button: job ? '確定に進む' : 'サイトを調べる' },
      { title: '導入前の計測をする', why: 'あとで比べる「導入前」になります。確定した質問を AI に聞きます。', href: S + '#hack2', button: '計測に進む' },
      { title: fc.pending_approval ? 'よくある質問 ' + fc.pending_approval + '問を承認して、パッチを作る' : 'パッチ（ZIP）を作る', why: '承認した答えだけがパッチに入ります。', href: S + '#generator', button: fc.pending_approval ? '承認に進む' : 'パッチを作る' },
      { title: 'パッチがサイトに入ったか確かめる', why: 'ページに承認した質問と答えが出ているか、手順書の「確かめる」で見ます。入ったら、Google が読んだあとに測ります。', href: S + '#generator', button: '手順を見る' },
      { title: '導入後の計測をして、比べる', why: '導入前と同じ質問・地域・AI で測り、「AI 計測の記録」で2回を選んで比べます。', href: opts.runsHref || '#', button: '比べる' }
    ];
    var next = cur >= 0 ? NEXT[cur] : { title: '次の改善を始める', why: '効果を確かめました。課題を見直して、次のパッチを作ります。', href: S + '#generator', button: '次の改善へ' };
    return { steps: steps, current: cur, next: next };
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
      '<ol class="acs-steps">' + steps + '</ol></section>';
  }

  var api = { compute: compute, cardHtml: cardHtml, aioOf: aioOf };
  root.AirReachCaseSteps = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
