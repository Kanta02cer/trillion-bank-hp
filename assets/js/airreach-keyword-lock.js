/**
 * AirReach Studio — 調べる言葉を決めて固定する（お客様に確認してから）。
 *   決め方（2026-10-15 合意）：① ホームページから候補を自動で出す → ② 担当者が10語ほどに絞る
 *   （会社名1〜2・サービス2〜3・地域3・条件3〜4）→ ③ お客様に確認して固定。変えるのは3か月に1回まで・理由を残す。
 *   言葉と AI への質問は1対1：固定した言葉ごとに質問を1つ持ち、毎月その質問だけを測る（state.prompts に「固定」の印で入れる）。
 *   分析をやり直しても固定した言葉は変わらない（state.keywords は候補の一覧で、固定は state.kwLock に別に持つ）。
 *   Search Console の検索語から作った言葉は、外部の AI に送る質問にしない（airreach-google-guard.js の決まりのまま）。
 *
 * ブラウザでは window.AirReachKeywordLock、Node では module.exports（試験用。画面の部品は使わない）。
 */
(function (root) {
  'use strict';

  var LIMIT = 10;          // 毎月測る質問の上限（airreach-studio.js の PROMPT_LIMIT と同じ）
  var CHANGE_DAYS = 90;    // 言葉を変えられる間隔（3か月）
  // 言葉の種類ごとの目安（下限・上限）。「扱っているもの」はサービスとして数える
  var TARGET = { '指名': [1, 2], 'サービス': [2, 3], '地域': [3, 3], '条件': [3, 4] };
  var GROUPS = ['指名', 'サービス', '地域', '条件', 'その他'];

  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function key(s) { return clean(s).replace(/\s/g, '').toLowerCase(); }
  function dayMs(n) { return n * 86400000; }
  function ymd(t) { var d = new Date(t + 9 * 3600000); function z(n) { return (n < 10 ? '0' : '') + n; } return d.getUTCFullYear() + '-' + z(d.getUTCMonth() + 1) + '-' + z(d.getUTCDate()); }

  /** 言葉の種類（ページから取り出したときの種類があればそれ。無ければ会社名を含むかで「指名」、それ以外は「その他」） */
  function groupOf(kw, brand) {
    var g = kw && kw.seed_group;
    if (g === '扱っているもの') return 'サービス';
    if (TARGET[g]) return g;
    var t = key(kw && (kw.text || kw.keyword));
    if (brand && t && t.indexOf(key(brand)) >= 0) return '指名';
    return 'その他';
  }

  /** 種類ごとの数と、目安から外れているもの（警告。固定は止めない） */
  function balance(items) {
    var n = {};
    GROUPS.forEach(function (g) { n[g] = 0; });
    (items || []).forEach(function (x) { n[TARGET[x.group] || x.group === 'その他' ? x.group : 'その他'] += 1; });
    var warn = [];
    Object.keys(TARGET).forEach(function (g) {
      var t = TARGET[g];
      if (n[g] < t[0]) warn.push(g + 'の言葉が' + n[g] + '語です（目安 ' + t[0] + (t[1] !== t[0] ? '〜' + t[1] : '') + '語）');
      else if (n[g] > t[1]) warn.push(g + 'の言葉が' + n[g] + '語です（目安 ' + t[0] + (t[1] !== t[0] ? '〜' + t[1] : '') + '語まで）');
    });
    return { counts: n, warnings: warn };
  }

  /** 固定できるか（できないときは理由の一覧） */
  function validate(items) {
    var err = [];
    items = items || [];
    if (!items.length) err.push('言葉を1つ以上選んでください');
    if (items.length > LIMIT) err.push('言葉は ' + LIMIT + ' 語までです（いま ' + items.length + ' 語）');
    var seenK = {}, seenP = {};
    items.forEach(function (x) {
      var k = key(x.keyword), p = key(x.prompt);
      if (!k) err.push('空の言葉があります');
      else if (seenK[k]) err.push('同じ言葉が2回あります：' + clean(x.keyword));
      if (!p) err.push('「' + clean(x.keyword) + '」の質問が空です');
      else if (seenP[p]) err.push('同じ質問が2回あります：' + clean(x.prompt));
      if (x.google) err.push('「' + clean(x.keyword) + '」は Search Console の検索語から作った言葉のため、AI に送る質問にできません');
      seenK[k] = 1; seenP[p] = 1;
    });
    return err;
  }

  function active(state) { return !!(state && state.kwLock && Array.isArray(state.kwLock.items) && state.kwLock.items.length); }

  /** 最後に固定・変更した日時（ミリ秒） */
  function lastChangeAt(lock) {
    var t = Date.parse((lock && lock.lockedAt) || '');
    ((lock && lock.history) || []).forEach(function (h) { var x = Date.parse(h.at || ''); if (!isNaN(x) && (isNaN(t) || x > t)) t = x; });
    return isNaN(t) ? null : t;
  }
  /** 言葉を変えられるか（前の固定・変更から 90 日たったか） */
  function changeAllowed(lock, now) {
    var last = lastChangeAt(lock);
    if (last == null) return { ok: true, days: null, nextOn: '' };
    var t = now == null ? Date.now() : (typeof now === 'number' ? now : Date.parse(now));
    var days = Math.floor((t - last) / dayMs(1));
    return { ok: days >= CHANGE_DAYS, days: days, nextOn: ymd(last + dayMs(CHANGE_DAYS)) };
  }

  /**
   * 言葉を固定する・変える。
   * @param state Studio の作業データ
   * @param items [{ keyword, prompt, group, google? }]
   * @param opt { now, clientConfirmedOn:'YYYY-MM-DD'（お客様に確認した日・必須）, reason（変更の理由・変更のとき必須）, exception（3か月たつ前に変える） }
   * @returns { ok, errors[], warnings[] }
   */
  function apply(state, items, opt) {
    opt = opt || {};
    var now = opt.now == null ? Date.now() : (typeof opt.now === 'number' ? opt.now : Date.parse(opt.now));
    items = (items || []).map(function (x, i) {
      return { id: x.id || ('kw' + now.toString(36) + i), keyword: clean(x.keyword), prompt: clean(x.prompt).slice(0, 200), group: TARGET[x.group] || x.group === 'その他' ? x.group : 'その他', google: !!x.google };
    });
    var errors = validate(items);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(opt.clientConfirmedOn || ''))) errors.push('お客様に確認した日を入れてください');
    var prev = active(state) ? state.kwLock : null;
    var reason = clean(opt.reason);
    if (prev) {
      if (!reason) errors.push('変える理由を書いてください');
      var ca = changeAllowed(prev, now);
      if (!ca.ok && !opt.exception) errors.push('言葉を変えられるのは3か月に1回までです（次に変えられる日：' + ca.nextOn + '）。事業の内容が変わった・言葉に誤りがあるなどで今変えるときは「例外として変える」を選んでください');
      if (!ca.ok && opt.exception && !reason) errors.push('例外として変える理由を書いてください');
    }
    if (errors.length) return { ok: false, errors: errors, warnings: balance(items).warnings };
    items.forEach(function (x) { delete x.google; });
    var at = new Date(now).toISOString();
    var before = prev ? prev.items.map(function (x) { return x.keyword; }) : [];
    var after = items.map(function (x) { return x.keyword; });
    var changedPrompts = prev ? items.filter(function (x) { var o = prev.items.filter(function (y) { return key(y.keyword) === key(x.keyword); })[0]; return o && key(o.prompt) !== key(x.prompt); }).map(function (x) { return x.keyword; }) : [];
    var addedK = after.filter(function (k) { return before.map(key).indexOf(key(k)) < 0; });
    var removedK = before.filter(function (k) { return after.map(key).indexOf(key(k)) < 0; });
    var regrouped = prev ? items.some(function (x) { var o = prev.items.filter(function (y) { return key(y.keyword) === key(x.keyword); })[0]; return o && o.group !== x.group; }) : false;
    if (prev && !addedK.length && !removedK.length && !changedPrompts.length && !regrouped) return { ok: false, errors: ['言葉も質問も変わっていません'], warnings: [] };
    var hist = (prev && prev.history ? prev.history.slice() : []).concat([{
      at: at, kind: prev ? 'change' : 'lock', clientConfirmedOn: opt.clientConfirmedOn, reason: reason, exception: !!(prev && opt.exception && !changeAllowed(prev, now).ok),
      added: addedK,
      removed: removedK,
      promptChanged: changedPrompts
    }]);
    state.kwLock = { version: 1, lockedAt: prev ? prev.lockedAt : at, changedAt: at, clientConfirmedOn: opt.clientConfirmedOn, items: items, history: hist.slice(-24) };
    syncPrompts(state);
    return { ok: true, errors: [], warnings: balance(items).warnings };
  }

  /**
   * 固定した言葉の質問を、毎月測る質問（state.prompts）にする。1つの言葉に1つの質問。
   * ほかの質問（お客様の質問・手で足した質問など）は消さずに「候補」に回す（毎月は測らない）。
   */
  function syncPrompts(state) {
    if (!active(state)) return false;
    var locked = state.kwLock.items.map(function (x) {
      return { id: 'lock-' + x.id, text: x.prompt, kw: x.keyword, on: true, src: 'locked', confirmed: true, locked: true };
    });
    var lk = locked.map(function (x) { return key(x.text); });
    var rest = (state.prompts || []).filter(function (p) { return !p.locked && lk.indexOf(key(p.text)) < 0; }).map(function (p) { return Object.assign({}, p, { on: false }); });
    state.prompts = locked.concat(rest);
    return true;
  }

  // ---- 画面（Studio のキーワードの欄の上：#kw-lock）----------------------------------------
  var ui = { editing: false, picks: null };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function S() { return root && root.AirReachStudio; }
  function today() { return ymd(Date.now()); }
  function promptOf(text) {
    var st = S();
    if (st && st.promptFor) { try { return st.promptFor(text); } catch (e) { /* 作れないときは下の形 */ } }
    return '「' + text + '」について教えて';
  }
  function isGoogleKw(k) {
    var G = root && root.AirReachGoogleGuard;
    if (String(k.seed_source || '').toUpperCase() === 'GSC') return true;
    return !!(G && G.isGscKeyword && G.isGscKeyword(k));
  }

  // 選ぶ候補：いま固定している言葉 ＋ キーワードの一覧
  function candidates(state) {
    var brand = (state.profile && state.profile.brand) || '';
    var out = [], seen = {};
    (active(state) ? state.kwLock.items : []).forEach(function (x) {
      seen[key(x.keyword)] = 1;
      out.push({ keyword: x.keyword, prompt: x.prompt, group: x.group, locked: true, google: false });
    });
    (state.keywords || []).forEach(function (k) {
      var t = clean(k.text || k.keyword);
      if (!t || seen[key(t)]) return;
      seen[key(t)] = 1;
      out.push({ keyword: t, prompt: '', group: groupOf(k, brand), locked: false, google: isGoogleKw(k) });
    });
    return out;
  }

  function render() {
    var box = root && root.document && root.document.getElementById('kw-lock');
    var st = S() && S().getState ? S().getState() : null;
    if (!box || !st) return;
    var on = active(st);
    if (on && !ui.editing) { box.innerHTML = lockedHtml(st); bindLocked(box, st); return; }
    var cands = candidates(st);
    if (!ui.picks || ui.picksFor !== (st.profile && st.profile.url)) {
      ui.picksFor = st.profile && st.profile.url;
      ui.picks = {};
      cands.forEach(function (c) { if (c.locked) ui.picks[key(c.keyword)] = { on: true, prompt: c.prompt, group: c.group }; });
    }
    box.innerHTML = editHtml(st, cands, on);
    bindEdit(box, st, cands, on);
  }

  function lockedHtml(st) {
    var L = st.kwLock, ca = changeAllowed(L), b = balance(L.items);
    var hist = (L.history || []).slice().reverse().map(function (h) {
      return '<li>' + esc(ymd(Date.parse(h.at))) + '　' + (h.kind === 'lock' ? '固定' : '変更' + (h.exception ? '（例外）' : '')) + '（お客様の確認 ' + esc(h.clientConfirmedOn || '—') + '）' +
        (h.added && h.added.length && h.kind !== 'lock' ? '　足した：' + esc(h.added.join('、')) : '') + (h.removed && h.removed.length ? '　外した：' + esc(h.removed.join('、')) : '') +
        (h.promptChanged && h.promptChanged.length ? '　質問を直した：' + esc(h.promptChanged.join('、')) : '') + (h.reason ? '　理由：' + esc(h.reason) : '') + '</li>';
    }).join('');
    return '<div class="ars-row" style="flex-wrap:wrap;gap:10px;align-items:center"><strong>固定した言葉（' + L.items.length + '語）</strong>' +
      '<span class="ars-gnote" style="margin:0">お客様の確認 ' + esc(L.clientConfirmedOn) + '・次に変えられる日 ' + esc(ca.nextOn || '—') + '</span>' +
      '<button type="button" class="ars-btn ars-btn-secondary" id="kw-lock-edit">言葉を変える</button></div>' +
      '<table class="ars-table" style="margin-top:8px"><thead><tr><th>種類</th><th>言葉</th><th>毎月 AI に聞く質問</th></tr></thead><tbody>' +
      L.items.map(function (x) { return '<tr><td>' + esc(x.group) + '</td><td>' + esc(x.keyword) + '</td><td>' + esc(x.prompt) + '</td></tr>'; }).join('') + '</tbody></table>' +
      (b.warnings.length ? '<p class="ars-gnote" style="color:#8a5a00">目安との違い：' + esc(b.warnings.join('／')) + '</p>' : '') +
      '<p class="ars-gnote">分析をやり直しても、この言葉と質問は変わりません。毎月この質問だけを測るので、前の月と比べられます。</p>' +
      (hist ? '<details><summary>固定と変更の記録</summary><ul class="ars-gnote">' + hist + '</ul></details>' : '');
  }
  function bindLocked(box, st) {
    var b = box.querySelector('#kw-lock-edit');
    if (b) b.onclick = function () { ui.editing = true; ui.picks = null; render(); };
  }

  function editHtml(st, cands, on) {
    var picked = cands.filter(function (c) { return ui.picks[key(c.keyword)] && ui.picks[key(c.keyword)].on; });
    var b = balance(picked.map(function (c) { return { group: ui.picks[key(c.keyword)].group || c.group }; }));
    var ca = on ? changeAllowed(st.kwLock) : { ok: true };
    var rows = cands.map(function (c, i) {
      var p = ui.picks[key(c.keyword)] || {};
      var prompt = p.prompt || c.prompt || promptOf(c.keyword);
      return '<tr' + (c.google ? ' style="opacity:.6"' : '') + '><td><input type="checkbox" data-kwl-on="' + i + '"' + (p.on ? ' checked' : '') + (c.google ? ' disabled title="Search Console の検索語から作った言葉は、AI に送る質問にできません"' : '') + ' aria-label="この言葉を選ぶ"></td>' +
        '<td><select class="ars-select" data-kwl-group="' + i + '" style="width:auto">' + GROUPS.map(function (g) { return '<option' + ((p.group || c.group) === g ? ' selected' : '') + '>' + g + '</option>'; }).join('') + '</select></td>' +
        '<td>' + esc(c.keyword) + (c.locked ? ' <span class="ars-ptag is-ok">固定中</span>' : '') + (c.google ? ' <span class="ars-ptag is-google">Search Console 由来</span>' : '') + '</td>' +
        '<td><input class="ars-input" data-kwl-prompt="' + i + '" value="' + esc(prompt) + '" aria-label="この言葉で AI に聞く質問"></td></tr>';
    }).join('');
    return '<div class="ars-row" style="flex-wrap:wrap;gap:10px;align-items:center"><strong>' + (on ? '固定した言葉を変える' : '調べる言葉を決める（お客様に確認して固定）') + '</strong>' +
      '<span class="ars-gnote" style="margin:0">選んだ言葉 ' + picked.length + ' / ' + LIMIT + '語・' + Object.keys(TARGET).map(function (g) { return g + ' ' + b.counts[g] + '（目安 ' + TARGET[g][0] + (TARGET[g][1] !== TARGET[g][0] ? '〜' + TARGET[g][1] : '') + '）'; }).join('・') + '</span></div>' +
      '<p class="ars-gnote">候補から10語ほどを選び、言葉ごとに AI に聞く質問を1つ決めます。お客様に確認してから固定してください。固定すると、毎月この質問だけを測ります（言葉を変えられるのは3か月に1回まで）。</p>' +
      (cands.length ? '<div style="overflow-x:auto"><table class="ars-table"><thead><tr><th></th><th>種類</th><th>言葉</th><th>毎月 AI に聞く質問</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="ars-gnote">候補の言葉がまだありません。先に分析をするか、下でキーワードを追加してください。</p>') +
      (b.warnings.length && picked.length ? '<p class="ars-gnote" style="color:#8a5a00">目安との違い：' + esc(b.warnings.join('／')) + '（固定はできます）</p>' : '') +
      '<div class="ars-row" style="flex-wrap:wrap;gap:12px;align-items:center;margin-top:8px">' +
      '<label>お客様に確認した日 <input type="date" class="ars-input" id="kw-lock-date" style="width:auto" value="' + esc(ui.date || today()) + '"></label>' +
      (on ? '<label style="flex:1;min-width:240px">変える理由 <input class="ars-input" id="kw-lock-reason" value="' + esc(ui.reason || '') + '" placeholder="例：お客様が新しいサービスを始めたため"></label>' : '') +
      (on && !ca.ok ? '<label><input type="checkbox" id="kw-lock-exc"' + (ui.exception ? ' checked' : '') + '> 例外として変える（次に変えられる日 ' + esc(ca.nextOn) + ' より前）</label>' : '') +
      '<button type="button" class="ars-btn ars-btn-primary" id="kw-lock-save">' + (on ? 'この言葉に変える' : 'この言葉で固定する') + '</button>' +
      (on ? '<button type="button" class="ars-btn ars-btn-secondary" id="kw-lock-cancel">やめる</button>' : '') + '</div><div id="kw-lock-msg"></div>';
  }
  function bindEdit(box, st, cands, on) {
    function pick(i) { var k = key(cands[i].keyword); return ui.picks[k] || (ui.picks[k] = { on: false, prompt: '', group: cands[i].group }); }
    function keepInputs() {
      var d = box.querySelector('#kw-lock-date'), r = box.querySelector('#kw-lock-reason'), e = box.querySelector('#kw-lock-exc');
      if (d) ui.date = d.value; if (r) ui.reason = r.value; if (e) ui.exception = e.checked;
    }
    Array.prototype.forEach.call(box.querySelectorAll('[data-kwl-on]'), function (x) { x.onchange = function () { keepInputs(); var p = pick(+x.dataset.kwlOn); p.on = x.checked; render(); }; });
    Array.prototype.forEach.call(box.querySelectorAll('[data-kwl-group]'), function (x) { x.onchange = function () { keepInputs(); pick(+x.dataset.kwlGroup).group = x.value; render(); }; });
    Array.prototype.forEach.call(box.querySelectorAll('[data-kwl-prompt]'), function (x) { x.onchange = function () { pick(+x.dataset.kwlPrompt).prompt = x.value; }; });
    var c = box.querySelector('#kw-lock-cancel');
    if (c) c.onclick = function () { ui.editing = false; ui.picks = null; ui.reason = ''; ui.exception = false; render(); };
    box.querySelector('#kw-lock-save').onclick = function () {
      keepInputs();
      var items = cands.map(function (cnd, i) {
        var p = ui.picks[key(cnd.keyword)];
        if (!p || !p.on) return null;
        var inp = box.querySelector('[data-kwl-prompt="' + i + '"]');
        return { keyword: cnd.keyword, prompt: (inp && inp.value) || p.prompt || promptOf(cnd.keyword), group: p.group || cnd.group, google: cnd.google };
      }).filter(Boolean);
      var res = apply(st, items, { clientConfirmedOn: ui.date, reason: ui.reason, exception: ui.exception });
      var msg = box.querySelector('#kw-lock-msg');
      if (!res.ok) { msg.innerHTML = '<p class="ars-gnote" style="color:#a3361f">' + res.errors.map(esc).join('<br>') + '</p>'; return; }
      ui.editing = false; ui.picks = null; ui.reason = ''; ui.exception = false;
      S().save();
    };
  }

  var api = {
    LIMIT: LIMIT, CHANGE_DAYS: CHANGE_DAYS, TARGET: TARGET,
    groupOf: groupOf, balance: balance, validate: validate, active: active, changeAllowed: changeAllowed, apply: apply, syncPrompts: syncPrompts,
    refresh: function () { try { render(); } catch (e) { /* 画面の部品が無いときは何もしない */ } }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AirReachKeywordLock = api;
})(typeof window !== 'undefined' ? window : null);
