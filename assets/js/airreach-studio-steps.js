/**
 * Studio の上の帯：案件の5段階と「次にやること」（判定は airreach-case-steps.js と同じ）。
 *   材料はこの端末の Studio の作業（分析・確定・承認・ZIP）と、この端末の AI 計測の記録。
 *   次にやることのボタンは、Studio の中の画面に移る（④⑤はダッシュボードへ）
 */
(function () {
  'use strict';
  function q(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function read(key, store) { try { return JSON.parse((store || localStorage).getItem(key) || 'null'); } catch (e) { return null; } }
  function client() { return read('airreach_studio_client_v1', sessionStorage) || null; }
  function dashHref(sec) { var c = client(); return c && c.id ? '/airreach/app/#/c/' + encodeURIComponent(c.id) + (sec ? '/' + sec : '') : '/airreach/app/'; }
  /** この端末の計測の記録を、1回の計測（run_id）ずつにまとめる */
  function localRuns() {
    var st = read('airreach_studio_v1') || {}, by = {};
    (st.hack2 || []).forEach(function (r) {
      if (!r || !r.run_id || /jev/i.test(String(r.engine || ''))) return;
      var t = String(r.run_id).replace(/^studio-/, '');
      (by[r.run_id] = by[r.run_id] || { id: r.run_id, created_at: t, summary: { answers: [] } }).summary.answers.push(r);
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }
  function refresh() {
    var box = q('ars-case-banner');
    if (!box || !window.AirReachCaseSteps) return;
    var job = window.__orchLastJob || (read('airreach_studio_orch_v1') || {}).lastJob || null;
    var res = window.AirReachCaseSteps.compute({ workspace: { orch: { lastJob: job } }, runs: localRuns(), studioHref: '', runsHref: dashHref('runs') });
    var steps = res.steps.map(function (s, i) {
      return '<li class="acs-step is-' + s.state + '"' + (s.state === 'current' ? ' aria-current="step"' : '') + '><span class="acs-dot" aria-hidden="true">' + (s.state === 'done' ? '✓' : i + 1) + '</span><span><b>' + esc(s.label) + '</b><small>' + esc(s.detail) + '</small></span></li>';
    }).join('');
    var href = res.next.href || '';
    var panel = /^#([a-z0-9]+)$/.exec(href);
    box.innerHTML = '<section class="acs acs-studio" aria-label="この案件の進み具合"><div class="acs-next"><div><div class="acs-eyebrow">次にやること</div><div class="acs-title">' + esc(res.next.title) + '</div><p class="acs-why">' + esc(res.next.why) + '</p></div>' +
      (panel ? '<button type="button" class="ars-btn ars-btn-primary acs-go" data-acs-panel="' + esc(panel[1]) + '">' + esc(res.next.button) + ' →</button>'
        : '<a class="ars-btn ars-btn-primary acs-go" href="' + esc(href) + '">' + esc(res.next.button) + ' →</a>') +
      '</div><ol class="acs-steps">' + steps + '</ol></section>';
    var go = box.querySelector('[data-acs-panel]');
    if (go) go.addEventListener('click', function () {
      var b = document.querySelector('.ars-side button[data-panel="' + go.getAttribute('data-acs-panel') + '"]');
      if (b) { b.hidden = false; b.click(); }
    });
    var side = q('ars-side-dashboard');
    if (side) side.setAttribute('href', dashHref(''));
  }
  window.AirReachStudioSteps = { refresh: refresh, _localRuns: localRuns };
  function start() {
    refresh();
    // 計測・分析・確定は Studio の中で起きるので、保存（localStorage）の変化と画面の切り替えで描き直す
    window.addEventListener('storage', refresh);
    document.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('.ars-side button')) setTimeout(refresh, 50); });
    setTimeout(refresh, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
