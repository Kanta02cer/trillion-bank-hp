/**
 * 案件の5段階（AI パッチ）：対象を決める → 導入前を測る → パッチを作る → 公開して確かめる → 効果を比べる。
 *   2026-10-09 の見直し：ZIP を作った日時を公開の代わりにしない。④は「公開の記録（実際に公開した日時・版）」と
 *   「公開照合（見える形で入っていた・同じ版）」の両方がそろって済み。再計測しただけでは④を済みにしない。
 *   導入前・導入後は公開した日時で分ける。パッチの版（版・作った日時・MANIFEST の指紋）が変わったら、前の公開・確認は使わない。
 *   Google の収録（URL 検査などで確かめた）は、5段階とは別の状態として出す。
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

  var VERIFY_RULE = /^verify\/2026\.10\.09/; // 公開照合の判定の版（これより前の確認は、全文・見える本文で照合していない）
  /** 記録（公開・確認・収録）が、いまのパッチ（ZIP）と同じ版か */
  function sameVersion(rec, zipped) {
    if (!rec || !zipped) return false;
    if (String(rec.version || '') !== String(zipped.version || '')) return false;
    if (rec.zipped_at && zipped.at && rec.zipped_at !== zipped.at) return false;
    var a = rec.zip_manifest_sha256 || rec.manifest_sha256 || '', b = zipped.manifest_sha256 || '';
    return !(a && b && a !== b);
  }
  /**
   * 公開と照合の状態（いまのパッチについて）
   *   戻り値：{ zipped, published: {ok, at, why}, verified: {ok, state, why}, indexed: {ok, at, how}, done }
   */
  function publishState(job, now) {
    var z = job && job.zipped && !job.zipped.draft ? job.zipped : null, nowT = (now || new Date()).getTime();
    var out = { zipped: z, published: { ok: false, why: '' }, verified: { ok: false, state: '', why: '' }, indexed: { ok: false }, done: false };
    if (!z) return out;
    var pb = job.published, vf = job.verified, ix = job.indexed;
    if (!pb || !pb.at) out.published.why = '公開した日時が未記録';
    else if (!sameVersion(pb, z)) out.published.why = '公開の記録は別の版（v' + (pb.version || '?') + '）';
    else if (Date.parse(pb.at) < Date.parse(z.at)) out.published.why = '公開した日時が ZIP を作る前になっている';
    else if (Date.parse(pb.at) > nowT) out.published.why = '公開した日時が未来になっている';
    else { out.published = { ok: true, at: pb.at, url: pb.url || '' }; }
    if (!vf || !vf.at) out.verified.why = 'まだ確かめていない';
    else if (!sameVersion(vf, z)) out.verified.why = '確かめた記録は別の版（v' + (vf.version || '?') + '）。いまの版で確かめ直す';
    else if (!VERIFY_RULE.test(String(vf.rule || ''))) out.verified.why = '前の判定方法での記録。もう一度確かめる';
    else if (vf.state === 'review') { out.verified.state = 'review'; out.verified.why = '要確認（見える形で入ったかを確かめきれていない）'; }
    else if (!vf.ok || vf.state !== 'ok') { out.verified.state = 'ng'; out.verified.why = '入っていない・違うところがある'; }
    else if (out.published.ok && Date.parse(vf.at) < Date.parse(pb.at)) out.verified.why = '確かめたのが公開より前。公開のあとに確かめ直す';
    else out.verified = { ok: true, state: 'ok', at: vf.at, why: '' };
    if (ix && ix.at && sameVersion(ix, z)) out.indexed = { ok: true, at: ix.at, how: ix.how || '' };
    out.done = out.published.ok && out.verified.ok;
    return out;
  }

  /**
   * 計測の時期（自動の定期計測は使わず、担当者が測る。時期だけ知らせる）
   *   ① 会社・サービスを確定したら、すぐ（導入前の計測）
   *   ② パッチの公開を確かめた日から14日後（効果を測る。運用の目安。Google の再クロール・収録・AI による概要への表示を保証するものではない）
   *   ③ それ以外は、前回の計測から30日後（毎月の計測）
   *   期日から3日過ぎたら「遅れ」。お客様には遅れは出さず「近日中に」と書く
   *   d: { entityAt, verifiedAt, verifiedOk, publishedAt, lastRunAt }（DB の airreach_measure_timing と同じ材料） / now: Date
   *     verifiedOk は「いまの版の公開を、見える形で確かめた」こと。基準日は公開と確認の遅い方
   *   戻り値：{ kind: baseline|effect|monthly, due: Date, state: later|soon|due|late, days }（会社・サービスが未確定なら null）
   */
  var DAY = 86400000, EFFECT_DAYS = 14, MONTHLY_DAYS = 30, LATE_DAYS = 3;
  function jstDay0(t) { var d = new Date(t + 9 * 3600000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
  function timing(d, now) {
    d = d || {}; now = now || new Date();
    var ent = Date.parse(d.entityAt || ''), ver = Date.parse(d.verifiedAt || ''), pubT = Date.parse(d.publishedAt || ''), last = Date.parse(d.lastRunAt || '');
    if (!isNaN(pubT) && (isNaN(ver) || pubT > ver)) ver = pubT;
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
  var KIND_WHY = { baseline: '会社・サービスを確定したので、導入前を測ります', effect: 'パッチの公開を確かめてから14日後。運用の目安で、Google の再クロール・収録・AI による概要への表示を保証するものではありません', monthly: '前回の計測から30日' };
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
    var ps = publishState(job, opts.now);
    // 導入前・導入後は「公開した日時」で分ける（ZIP を作った日時では分けない）。公開の記録が無いうちは、すべて導入前の候補
    var pubT = ps.published.ok ? Date.parse(ps.published.at) : null;
    var after = pubT != null ? runs.filter(function (r) { return runTime(r) > pubT; }) : [];
    var before = pubT != null ? runs.filter(function (r) { return runTime(r) <= pubT; }) : runs;
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
      { key: 'verify', label: '公開して確かめる', done: ps.done,
        detail: !zipped ? '—' : ps.done ? '公開 ' + day(ps.published.at) + '・確かめた ' + day(ps.verified.at) + '（見える形で入っている）'
          : (ps.published.ok ? '公開 ' + day(ps.published.at) + '・' + ps.verified.why : ps.published.why + (job && job.verified && job.verified.at ? '・' + ps.verified.why : '')) },
      { key: 'compare', label: '効果を比べる', done: ps.done && after.length > 0 && !!base,
        detail: ps.done ? (after.length && base ? '公開後の計測 ' + after.length + '回' : !base ? '公開前の計測がない（時系列の比較だけ）' : '公開後にまだ測っていない') : (zipped && runs.length > 1 ? '公開を確かめるまでは、計測どうしは時系列の比較' : '—') }
    ];
    // ⑤は④（公開と照合）が済んでから。再計測しただけで④を済みにしない
    var cur = -1;
    steps.forEach(function (s, i) { s.state = s.done ? 'done' : (cur < 0 ? (cur = i, 'current') : 'todo'); });
    var NEXT = [
      { title: job ? '会社・サービスを確定する' : 'サイトを調べる', why: job ? '確定した名前とサービスを、計測とパッチで使います。' : 'サイトを読んで、会社・サービス・質問の候補を作ります。', href: S + (job ? '#generator' : '#start'), button: job ? '確定に進む' : 'サイトを調べる' },
      { title: '導入前の計測をする', why: 'あとで比べる「導入前」になります。確定した質問を AI に聞きます。', href: S + '#hack2', button: '計測に進む' },
      { title: fc.pending_approval ? 'よくある質問 ' + fc.pending_approval + '問を承認して、パッチを作る' : 'パッチ（ZIP）を作る', why: '承認した答えだけがパッチに入ります。', href: S + '#generator', button: fc.pending_approval ? '承認に進む' : 'パッチを作る' },
      { title: !ps.published.ok ? 'サイトに公開したら、公開した日時を記録して確かめる' : ps.verified.state === 'ng' ? 'サイトに入っていないところを直して、もう一度確かめる' : ps.verified.state === 'review' ? '見える形で入ったかを確かめる（要確認）' : 'パッチが見える形で入ったか確かめる',
        why: '公開した日時と版を記録し、公開ページを描画して、承認した質問と答えの全文・構造化データ・採用したファイルが ZIP と同じかを見ます。' + (ps.published.why && ps.published.ok === false && zipped ? '（' + ps.published.why + '）' : ''), href: S + '#verify', button: '確かめる' },
      { title: '公開後の計測をして、比べる', why: '公開前と同じ質問・地域・AI・判定の版で測り、「AI 計測の記録」で2回を選んで比べます。', href: opts.runsHref || '#', button: '比べる' }
    ];
    var next = cur >= 0 ? NEXT[cur] : { title: '次の改善を始める', why: '効果を確かめました。課題を見直して、次のパッチを作ります。', href: S + '#generator', button: '次の改善へ' };
    var lastRun = runs.length ? runs[runs.length - 1] : null;
    var tm = timing({ entityAt: ent && ent.at, verifiedAt: ps.verified.ok ? ps.verified.at : null, verifiedOk: ps.done, publishedAt: ps.published.ok ? ps.published.at : null, lastRunAt: lastRun ? (lastRun.created_at || lastRun.measured_on) : null }, opts.now);
    // 効果・毎月の計測の時期が来ていれば、次にやることを計測にする（導入前の計測は②の段階としてすでに出ている）
    if (tm && tm.kind !== 'baseline' && (tm.state === 'due' || tm.state === 'late')) {
      next = { title: (tm.kind === 'effect' ? '効果を測る' : '毎月の計測をする') + (tm.state === 'late' ? '（' + (-tm.days) + '日遅れ）' : ''), why: timingLine(tm) + '。導入前と同じ質問・地域・AI で測ります。', href: S + '#hack2', button: '計測に進む', timing: true };
    }
    return { steps: steps, current: cur, next: next, timing: tm, publish: ps };
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
      '<ol class="acs-steps">' + steps + '</ol>' +
      (res.publish && res.publish.zipped ? '<p class="acs-index">Google の収録（5段階とは別）　' + (res.publish.indexed.ok ? '確かめた ' + esc(day(res.publish.indexed.at)) + (res.publish.indexed.how ? '（' + esc(res.publish.indexed.how) + '）' : '') : '未確認') + '</p>' : '') + (res.timing !== undefined ? '<p class="acs-timing' + (res.timing && res.timing.state === 'late' ? ' is-late' : '') + '">計測の予定　' + esc(timingLine(res.timing)) + '</p>' : '') + '</section>';
  }

  var api = { compute: compute, cardHtml: cardHtml, aioOf: aioOf, publishState: publishState, sameVersion: sameVersion, timing: timing, timingChip: timingChip, timingLine: timingLine, timingCustomer: timingCustomer, KIND_LABEL: KIND_LABEL };
  root.AirReachCaseSteps = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
