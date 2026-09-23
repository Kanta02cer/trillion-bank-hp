(function () {
  'use strict';

  var INFO_KEYS = [
    { id: 'salary', label: '給与', from: ['baseSalary'] },
    { id: 'location', label: '勤務地', from: ['jobLocation', 'jobLocationType'] },
    { id: 'work', label: '仕事内容', from: ['description', 'responsibilities'] },
    { id: 'style', label: '働き方', from: ['employmentType', 'workHours', 'jobLocationType'] },
    { id: 'apply', label: '応募方法', from: ['directApply', 'url'] },
    { id: 'ai', label: 'AIが参考にできる情報', from: ['hiringOrganization', 'identifier', 'qualifications'] }
  ];

  function q(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function setStatus(msg, kind) {
    var el = q('arr-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'arr-status' + (kind ? ' is-' + kind : '');
  }

  function checkScore(checks, ids) {
    var list = (checks || []).filter(function (c) { return ids.indexOf(c.id) >= 0; });
    if (!list.length) return 0;
    var ok = list.filter(function (c) { return c.status === 'ok'; }).length;
    return Math.round((ok / list.length) * 100);
  }

  function renderBars(checks) {
    var el = q('arr-bars');
    if (!el) return;
    var rows = INFO_KEYS.map(function (k) {
      var score = checkScore(checks, k.from);
      return { label: k.label, score: score, id: k.id };
    }).sort(function (a, b) { return a.score - b.score; });

    el.innerHTML = rows.map(function (r) {
      return '<div class="arr-bar" data-id="' + esc(r.id) + '">' +
        '<button type="button">' + esc(r.label) + '</button>' +
        '<div class="track"><div class="fill" style="width:' + r.score + '%"></div></div>' +
        '<span class="score">' + r.score + '</span></div>';
    }).join('');

    el.querySelectorAll('.arr-bar button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.parentElement.getAttribute('data-id');
        var tip = {
          salary: '雇用主が実際に提示している給与のみ baseSalary に入れます（推定不可）。',
          location: '勤務地を正確に書くか、フルリモートなら TELECOMMUTE + 応募可能地域を設定します。',
          work: '業務・資格・時間・経験を description と本文で一致させます。',
          style: '雇用形態・勤務時間・リモート方針を明示します。',
          apply: '1回の導線で応募できる URL / directApply を整えます。',
          ai: '企業名・求人ID・資格など、AIが会社理解に使える公式情報を厚くします。'
        };
        q('arr-next').textContent = tip[id] || '不足項目を公式の事実に基づいて補ってください。';
      });
    });

    if (rows.length) {
      var lowest = rows[0];
      var firstActions = {
        salary: '給与を正式に提示できる場合のみ Schema に反映する',
        location: '勤務地またはリモート求人情報を正確に設定する',
        work: '仕事内容の説明を本文と一致させて厚くする',
        style: '働き方（雇用形態・時間・リモート）を明示する',
        apply: '応募方法を簡単にする',
        ai: '会社・求人の公式根拠情報を増やす'
      };
      q('arr-next').innerHTML = '<strong>' + esc(firstActions[lowest.id] || '不足項目を補う') + '</strong>';
    }
  }

  function renderResults(data) {
    var box = q('arr-results');
    if (!box) return;
    box.hidden = false;
    var checks = data.checks || [];
    q('arr-job-ready').textContent = data.readinessLabel || (data.okCount + ' / ' + data.totalCount);
    q('arr-info-ready').textContent = Math.min.apply(null, INFO_KEYS.map(function (k) {
      return checkScore(checks, k.from);
    })) + '〜' + Math.max.apply(null, INFO_KEYS.map(function (k) {
      return checkScore(checks, k.from);
    })) + '（項目別）';

    renderBars(checks);

    var notes = (data.notes || []).map(function (n) {
      return '<li>' + esc(n.message || n) + '</li>';
    }).join('');

    var rows = checks.map(function (c) {
      return '<tr><td>' + esc(c.label) + '</td><td><span class="arr-pill ' + esc(c.status) + '">' +
        esc(c.status) + '</span></td><td>' + esc(c.detail || '') + '</td></tr>';
    }).join('');

    var draft = (data.fixDraft && data.fixDraft.jsonld)
      ? JSON.stringify(data.fixDraft.jsonld, null, 2)
      : '';
    var suggestions = ((data.fixDraft && data.fixDraft.suggestions) || []).map(function (s) {
      return '<li><strong>' + esc(s.id) + '</strong> — ' + esc(s.action) + '</li>';
    }).join('');

    box.innerHTML =
      '<p class="arr-note">' + esc(data.disclaimer || '') + '</p>' +
      (notes ? '<ul>' + notes + '</ul>' : '') +
      '<table class="arr-check-table"><thead><tr><th>項目</th><th>状態</th><th>詳細</th></tr></thead><tbody>' +
      rows + '</tbody></table>' +
      (suggestions ? '<h3>修正の提案（要・人の承認）</h3><ul>' + suggestions + '</ul>' : '') +
      (draft ? '<h3>修正ドラフト JSON-LD（事実フィールドのコピー）</h3><textarea class="arr-code" readonly>' +
        esc(draft) + '</textarea>' : '');
  }

  async function run() {
    var raw = (q('arr-jsonld') && q('arr-jsonld').value || '').trim();
    if (!raw) {
      setStatus('JSON-LD を貼り付けてください', 'warn');
      return;
    }
    var parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) {
      setStatus('JSON として解析できません: ' + e.message, 'warn');
      return;
    }

    var btn = q('arr-run');
    if (btn) btn.disabled = true;
    setStatus('検証中…');

    try {
      if (!window.AirReachAPI || !window.AirReachAPI.apiFetch) {
        throw new Error('AirReachAPI が読み込まれていません');
      }
      var data = await window.AirReachAPI.apiFetch('/api/job-posting-validate/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: (q('arr-url') && q('arr-url').value) || undefined,
          jsonld: parsed,
          pageTextHints: {
            remoteMentioned: !!(q('arr-remote-hint') && q('arr-remote-hint').checked),
            salaryIsEstimate: !!(q('arr-salary-estimate') && q('arr-salary-estimate').checked)
          }
        })
      });
      renderResults(data);
      setStatus('検証完了（Observed · jobposting-readiness-v0）', 'good');
    } catch (e) {
      setStatus(String(e && e.message ? e.message : e), 'warn');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var btn = q('arr-run');
    if (btn) btn.addEventListener('click', run);
  });
})();
