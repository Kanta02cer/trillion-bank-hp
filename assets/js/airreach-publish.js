/**
 * ④ 公開して確かめる：実際に公開した日時と、Google の収録を確かめた記録（Studio の分析 job に残す。新しい表は使わない）。
 *   job.published = { at（公開した日時）, url, version, zipped_at, manifest_sha256, recorded_at }
 *   job.indexed   = { at（収録を確かめた日）, how, url, version, zipped_at, manifest_sha256, recorded_at }
 *   どちらも、記録したときのパッチの版（版・作った日時・MANIFEST の指紋）を一緒に残す。版が変わったら、案件の段階
 *   （airreach-case-steps.js）は前の記録を使わない。ZIP を作った日時を公開の日時の代わりにはしない。
 */
(function (root) {
  'use strict';
  var KEY = 'airreach_studio_orch_v1';
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function jobNow() { try { return root.__orchLastJob || (JSON.parse(localStorage.getItem(KEY) || 'null') || {}).lastJob || null; } catch (e) { return null; } }
  function save(job) {
    root.__orchLastJob = job;
    try { localStorage.setItem(KEY, JSON.stringify({ lastJob: job })); } catch (e) {}
    try { if (root.AirReachStudioSteps) root.AirReachStudioSteps.refresh(); } catch (e) {}
  }
  function day(iso) { var t = Date.parse(iso); if (isNaN(t)) return ''; var d = new Date(t + 9 * 3600000); return d.getUTCFullYear() + '/' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2); }
  // datetime-local（日本時間）⇄ ISO
  function toLocal(iso) { var t = Date.parse(iso); if (isNaN(t)) return ''; return new Date(t + 9 * 3600000).toISOString().slice(0, 16); }
  function fromLocal(v) { if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v || '')) return null; var t = Date.parse(v + ':00+09:00'); return isNaN(t) ? null : new Date(t).toISOString(); }
  function stamp(job) { var z = job.zipped; return { version: z.version || '', zipped_at: z.at, manifest_sha256: z.manifest_sha256 || '' }; }
  /**
   * 公開を記録する。戻り値 { ok, error }。正式な ZIP が無い・日時が ZIP より前・未来なら記録しない
   */
  function recordPublish(job, atIso, url, now) {
    var z = job && job.zipped && !job.zipped.draft ? job.zipped : null;
    if (!z) return { ok: false, error: '正式なパッチ（ZIP）を作ってから記録してください' };
    var t = Date.parse(atIso || ''), n = (now || new Date()).getTime();
    if (isNaN(t)) return { ok: false, error: '公開した日時を入れてください' };
    if (t < Date.parse(z.at)) return { ok: false, error: '公開した日時が、パッチ（ZIP）を作った日時より前です' };
    if (t > n + 60000) return { ok: false, error: '公開した日時が未来です' };
    if (!/^https?:\/\//i.test(url || '')) return { ok: false, error: '公開したページの URL（https:// から）を入れてください' };
    job.published = Object.assign({ at: new Date(t).toISOString(), url: url, recorded_at: new Date(n).toISOString() }, stamp(job));
    return { ok: true };
  }
  /** Google の収録を確かめた記録（5段階とは別） */
  function recordIndexed(job, atIso, how, now) {
    var z = job && job.zipped && !job.zipped.draft ? job.zipped : null;
    if (!z) return { ok: false, error: '正式なパッチ（ZIP）を作ってから記録してください' };
    var t = Date.parse(atIso || ''), n = (now || new Date()).getTime();
    if (isNaN(t) || t > n + 60000) return { ok: false, error: '確かめた日時を入れてください（未来は不可）' };
    if (!job.published || Date.parse(job.published.at) > t) return { ok: false, error: '公開の記録のあとに確かめた日時を入れてください' };
    job.indexed = Object.assign({ at: new Date(t).toISOString(), how: how || '', url: job.published.url || '', recorded_at: new Date(n).toISOString() }, stamp(job));
    return { ok: true };
  }

  function mount() {
    var box = document.getElementById('publish-box'), ibox = document.getElementById('indexed-box');
    if (!box) return;
    function state() {
      var job = jobNow(), K = root.AirReachCaseSteps;
      return { job: job, ps: K && job ? K.publishState(job) : null };
    }
    function draw() {
      // 描き直しても、入力中の値は残す
      var keep = {}; ['publish-at', 'publish-url', 'indexed-at', 'indexed-how'].forEach(function (id) { var el = document.getElementById(id); if (el && el.value) keep[id] = el.value; });
      var x = state(), job = x.job, ps = x.ps, z = job && job.zipped && !job.zipped.draft ? job.zipped : null;
      if (!z) { box.innerHTML = '<p class="ars-gnote">正式なパッチ（ZIP）を作ったら、ここで公開した日時を記録します。</p>'; if (ibox) ibox.innerHTML = ''; return; }
      var pb = job.published, pOk = ps && ps.published.ok;
      box.innerHTML = '<div class="apb"><h3 class="apb-h">1. 公開を記録する</h3>' +
        '<p class="apb-st ' + (pOk ? 'is-ok' : 'is-wait') + '">' + (pOk ? '公開 ' + esc(day(pb.at)) + ' · パッチ v' + esc(pb.version) + ' · ' + esc(pb.url) : esc((ps && ps.published.why) || '公開した日時が未記録')) + '</p>' +
        '<div class="apb-f"><label>公開した日時（日本時間）<input class="ars-input" type="datetime-local" id="publish-at" value="' + esc(pb && pb.at ? toLocal(pb.at) : '') + '"></label>' +
        '<label>公開したページの URL<input class="ars-input" id="publish-url" inputmode="url" placeholder="https://example.jp/faq/" value="' + esc((pb && pb.url) || '') + '"></label>' +
        '<button type="button" class="ars-btn" id="publish-save">' + (pOk ? '記録を直す' : '公開を記録する') + '</button></div>' +
        '<p class="ars-gnote">お客様のサイトで実際に公開した日時です（ZIP を作った日時ではありません）。パッチ v' + esc(z.version) + ' の公開として記録します。版が変わったら、記録し直します。</p>' +
        '<h3 class="apb-h">2. 見える形で入ったか確かめる</h3></div>';
      if (ibox) {
        var ix = ps && ps.indexed;
        ibox.innerHTML = '<div class="apb"><h3 class="apb-h">Google の収録（5段階とは別に記録）</h3>' +
          '<p class="apb-st ' + (ix && ix.ok ? 'is-ok' : 'is-wait') + '">' + (ix && ix.ok ? '確かめた ' + esc(day(ix.at)) + (ix.how ? '（' + esc(ix.how) + '）' : '') : '未確認') + '</p>' +
          '<div class="apb-f"><label>確かめた日時<input class="ars-input" type="datetime-local" id="indexed-at"></label>' +
          '<label>確かめ方<select class="ars-input" id="indexed-how"><option>Search Console の URL 検査</option><option>Search Console のレポート</option><option>その他</option></select></label>' +
          '<button type="button" class="ars-btn" id="indexed-save">収録を記録する</button></div>' +
          '<p class="ars-gnote">Google がページを読み直して収録したかは、公開・照合とは別の状態です。AI による概要に出るかは、さらに別（同じ条件で再計測して確かめます）。</p></div>';
      }
      Object.keys(keep).forEach(function (id) { var el = document.getElementById(id); if (el) el.value = keep[id]; });
      bind();
    }
    function say(el, t, bad) { var p = document.createElement('p'); p.className = 'ars-note' + (bad ? ' is-err' : ''); p.setAttribute('role', 'status'); p.textContent = t; el.appendChild(p); }
    function bind() {
      var b = document.getElementById('publish-save');
      if (b) b.addEventListener('click', function () {
        var job = jobNow(); if (!job) return;
        var r = recordPublish(job, fromLocal(document.getElementById('publish-at').value), document.getElementById('publish-url').value.trim());
        if (!r.ok) { say(box, r.error, true); return; }
        save(job); draw(); say(box, '公開を記録しました。続けて「確かめる」で、見える形で入ったかを確かめてください。');
        var vu = document.getElementById('verify-url'); if (vu && !vu.value) vu.value = job.published.url;
      });
      var c = document.getElementById('indexed-save');
      if (c) c.addEventListener('click', function () {
        var job = jobNow(); if (!job) return;
        var r = recordIndexed(job, fromLocal(document.getElementById('indexed-at').value), document.getElementById('indexed-how').value);
        if (!r.ok) { say(ibox, r.error, true); return; }
        save(job); draw(); say(ibox, 'Google の収録を記録しました。');
      });
    }
    draw();
    // 確かめた結果が出たら（#verify-result が変わったら）・④ の画面を開いたら、状態を描き直す
    var res = document.getElementById('verify-result');
    if (res && typeof MutationObserver !== 'undefined') new MutationObserver(function () { draw(); }).observe(res, { childList: true });
    document.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('.ars-side button[data-panel="verify"]')) setTimeout(draw, 30); });
  }
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount(); }

  var api = { recordPublish: recordPublish, recordIndexed: recordIndexed, fromLocal: fromLocal };
  root.AirReachPublish = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
