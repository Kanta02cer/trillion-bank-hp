/**
 * AirReach Studio — お客様ごとの計測の条件（契約）。
 *   月の計測回数（月1回・月2回）、1つの質問を聞く回数（1回・3回）、測る AI を、Studio の作業データ（state.measurePlan）に保存する。
 *   保存した条件は、計測の欄の初期値（AI の選択・回数）と、担当者・お客様の画面の「次の計測」の時期（airreach-case-steps.js）に使う。
 *   自動では測らない（10/9 の決定どおり、担当者が Studio で測る）。
 *   画面：#hack2-plan に描く。Studio の renderHack2 から refresh() が呼ばれる。
 */
(function () {
  'use strict';
  var ENGINE_LABEL = { google_aio: 'Google の AI による概要', chatgpt_search: 'ChatGPT（検索あり）', google_ai_mode: 'Google の AI モード', gemini: 'Gemini', perplexity: 'Perplexity', claude: 'Claude（検索あり）', chatgpt: 'ChatGPT（検索なし）' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function S() { return window.AirReachStudio; }
  function CS() { return window.AirReachCaseSteps; }
  function norm(p) { return CS() && CS().measurePlan ? CS().measurePlan(p) : { perMonth: 1, repeats: 1, engines: [], intervalDays: 30, set: false }; }
  function q(id) { return document.getElementById(id); }
  function md(iso) { var d = new Date(iso); return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate(); }

  // 計測の欄でいま選んでいる AI・回数
  function current() {
    var engines = Array.prototype.slice.call(document.querySelectorAll('[data-hack2-engine]')).filter(function (x) { return x.checked && ENGINE_LABEL[x.value]; }).map(function (x) { return x.value; });
    var r = q('hack2-repeats');
    return { engines: engines, repeats: r ? Number(r.value) : 1 };
  }
  function sameSel(plan, cur) {
    if (!plan.set) return true;
    var a = plan.engines.slice().sort().join(','), b = cur.engines.slice().sort().join(',');
    return (!plan.engines.length || a === b) && plan.repeats === cur.repeats;
  }
  // 保存した条件を、計測の欄の初期値にする（お客様・条件が変わったときだけ。担当者がその場で変えた選択は消さない）
  function applyToForm(st, plan, box) {
    if (!plan.set) return;
    var sig = JSON.stringify([st.profile && st.profile.url, plan.perMonth, plan.repeats, plan.engines]);
    if (box.getAttribute('data-applied') === sig) return;
    box.setAttribute('data-applied', sig);
    if (plan.engines.length) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-hack2-engine]'), function (x) { if (ENGINE_LABEL[x.value]) x.checked = plan.engines.indexOf(x.value) >= 0; });
    }
    var r = q('hack2-repeats');
    if (r) r.value = String(plan.repeats);
  }

  function render() {
    var box = q('hack2-plan'), st = S() && S().getState ? S().getState() : null;
    if (!box || !st) return;
    var raw = st.measurePlan || null, plan = norm(raw);
    applyToForm(st, plan, box);
    var cur = current();
    var summary = plan.set
      ? '月' + plan.perMonth + '回（前回から' + plan.intervalDays + '日）・1つの質問を' + plan.repeats + '回・AI：' + (plan.engines.length ? plan.engines.map(function (e) { return ENGINE_LABEL[e]; }).join('、') : '計測の欄の初期値') +
        (raw && raw.setAt ? '（' + md(raw.setAt) + ' 設定）' : '')
      : 'まだ決めていません（今までどおり、月1回・前回から30日で知らせます）';
    var warn = plan.set && !sameSel(plan, cur) ? '<p class="ars-gnote" style="color:#a3361f;margin:6px 0 0">いまの選び方（AI・回数）が、このお客様の条件と違います。条件と違う計測は、前回と比べられないことがあります。</p>' : '';
    box.innerHTML =
      '<div class="ars-row" style="flex-wrap:wrap;gap:10px;align-items:center">' +
        '<strong>このお客様の計測の条件（契約）</strong><span class="ars-gnote" style="margin:0">' + esc(summary) + '</span>' +
      '</div>' +
      '<div class="ars-row" style="flex-wrap:wrap;gap:12px;align-items:center;margin-top:6px">' +
        '<label>計測の回数 <select class="ars-input" id="hack2-plan-month" style="width:auto"><option value="1"' + (plan.perMonth === 1 ? ' selected' : '') + '>月1回（前回から30日）</option><option value="2"' + (plan.perMonth === 2 ? ' selected' : '') + '>月2回（前回から15日）</option></select></label>' +
        '<button type="button" class="ars-btn" id="hack2-plan-save">いまの AI と回数も含めて、この条件で保存</button>' +
      '</div>' +
      '<p class="ars-gnote" style="margin:6px 0 0">保存すると、次からこのお客様を開いたときに、AI の選択と「同じ検索語を聞く回数」がこの条件になり、担当者とお客様の画面の「次の計測」の時期もこの回数で出ます。自動では測りません。1つの質問の回数は1回か3回で保存します。</p>' + warn;
    q('hack2-plan-save').onclick = function () {
      var c = current(), m = Number(q('hack2-plan-month').value) === 2 ? 2 : 1;
      if (!c.engines.length) { var w = document.createElement('p'); w.className = 'ars-gnote'; w.style.color = '#a3361f'; w.textContent = '測る AI を1つ以上選んでから保存してください。'; box.appendChild(w); return; }
      st.measurePlan = { perMonth: m, repeats: c.repeats === 3 ? 3 : 1, engines: c.engines, setAt: new Date().toISOString() };
      box.removeAttribute('data-applied');
      S().save();
    };
  }

  // 計測の欄の選択を変えたら、条件と違うかを出し直す
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t && (t.hasAttribute && t.hasAttribute('data-hack2-engine') || t.id === 'hack2-repeats')) { try { render(); } catch (err) { /* 画面の部品が無いときは何もしない */ } }
  });

  window.AirReachMeasurePlan = { refresh: function () { try { render(); } catch (e) { /* 画面の部品が無いときは何もしない */ } } };
})();
