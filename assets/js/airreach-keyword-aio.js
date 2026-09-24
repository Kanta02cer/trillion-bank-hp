/**
 * AirReach Keyword AIO — URL → suggest → per-keyword measure
 * Evidence: Jev = Estimated; LLM providers = Observed when keyed.
 * Does not guarantee citation / ranking / inclusion.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'tb_airreach_keyword_aio_v1';
  var BASELINE_KEY = 'tb_airreach_keyword_aio_baseline_v1';
  var state = {
    keywords: [],
    filter: 'all',
    lastSuggest: null,
    lastMeasure: null
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function pct(n) {
    if (n == null || !isFinite(n)) return '—';
    return Math.round(n * 100) + '%';
  }
  function setStatus(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'aka-status' + (kind ? ' is-' + kind : '');
  }
  function selectedEngines() {
    var out = [];
    document.querySelectorAll('[data-aka-engine]:checked').forEach(function (x) {
      out.push(x.value);
    });
    return out.length ? out : ['jev'];
  }
  function formPayload() {
    return {
      url: ($('aka-url') && $('aka-url').value.trim()) || '',
      brand: ($('aka-brand') && $('aka-brand').value.trim()) || '',
      ceoName: ($('aka-ceo') && $('aka-ceo').value.trim()) || '',
      serviceName: ($('aka-service') && $('aka-service').value.trim()) || '',
      category: ($('aka-category') && $('aka-category').value.trim()) || '',
      region: ($('aka-region') && $('aka-region').value.trim()) || '',
      mediaUrl: ($('aka-media') && $('aka-media').value.trim()) || '',
      max: 16
    };
  }
  function saveLocal() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        form: formPayload(),
        keywords: state.keywords,
        lastMeasure: state.lastMeasure
      }));
    } catch (e) {}
  }
  function loadLocal() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      var f = data.form || {};
      if ($('aka-url') && f.url) $('aka-url').value = f.url;
      if ($('aka-brand') && f.brand) $('aka-brand').value = f.brand;
      if ($('aka-ceo') && f.ceoName) $('aka-ceo').value = f.ceoName;
      if ($('aka-service') && f.serviceName) $('aka-service').value = f.serviceName;
      if ($('aka-category') && f.category) $('aka-category').value = f.category;
      if ($('aka-region') && f.region) $('aka-region').value = f.region;
      if ($('aka-media') && f.mediaUrl) $('aka-media').value = f.mediaUrl;
      if (Array.isArray(data.keywords)) state.keywords = data.keywords;
      if (data.lastMeasure) state.lastMeasure = data.lastMeasure;
    } catch (e) {}
  }
  function loadBaseline() {
    try {
      var raw = localStorage.getItem(BASELINE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function renderKeywords() {
    var box = $('aka-kw-list');
    if (!box) return;
    var list = state.keywords.filter(function (k) {
      if (state.filter === 'all') return true;
      return k.intent === state.filter;
    });
    if (!list.length) {
      box.innerHTML = '<p class="aka-note">該当するキーワードがありません。</p>';
      return;
    }
    box.innerHTML = list.map(function (k, idx) {
      var id = 'aka-kw-' + idx + '-' + encodeURIComponent(k.keyword || '').slice(0, 24);
      return (
        '<label class="aka-kw">' +
          '<input type="checkbox" data-aka-kw value="' + esc(k.keyword) + '"' +
            (k.selected !== false ? ' checked' : '') +
            ' data-prompt="' + esc(k.prompt || k.keyword) + '"' +
            ' data-intent="' + esc(k.intent || 'generic') + '"' +
            ' data-entity="' + esc(k.entityType || '') + '">' +
          '<span>' +
            '<span class="aka-pill ' + esc(k.intent || 'generic') + '">' +
              (k.intent === 'branded' ? '指名' : '一般') +
            '</span>' +
            (k.priority === 'P0' ? '<span class="aka-pill p0">P0</span>' : '') +
            '<strong>' + esc(k.keyword) + '</strong>' +
            '<div class="meta">' + esc(k.prompt || '') +
              (k.why ? ' · ' + esc(k.why) : '') +
            '</div>' +
          '</span>' +
        '</label>'
      );
    }).join('');
    box.querySelectorAll('[data-aka-kw]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var kw = cb.getAttribute('value');
        state.keywords.forEach(function (k) {
          if (k.keyword === kw) k.selected = cb.checked;
        });
        saveLocal();
      });
    });
  }

  function selectedPrompts() {
    var media = ($('aka-media') && $('aka-media').value.trim()) || '';
    var out = [];
    document.querySelectorAll('[data-aka-kw]:checked').forEach(function (cb) {
      out.push({
        keyword: cb.getAttribute('value'),
        prompt: cb.getAttribute('data-prompt') || cb.getAttribute('value'),
        intent: cb.getAttribute('data-intent') || 'generic',
        entityType: cb.getAttribute('data-entity') || '',
        mediaUrl: media || null
      });
    });
    return out.slice(0, 16);
  }

  function deltaHtml(cur, base) {
    if (cur == null || base == null || !isFinite(cur) || !isFinite(base)) {
      return '<span class="aka-delta-flat">—</span>';
    }
    var d = Math.round(cur - base);
    if (d > 0) return '<span class="aka-delta-up">+' + d + '</span>';
    if (d < 0) return '<span class="aka-delta-down">' + d + '</span>';
    return '<span class="aka-delta-flat">0</span>';
  }

  function renderResults(payload) {
    var body = $('aka-result-body');
    var sum = $('aka-summary');
    if (!body) return;
    var rows = (payload && payload.perKeyword) || [];
    var baseline = loadBaseline();
    var baseMap = {};
    if (baseline && Array.isArray(baseline.perKeyword)) {
      baseline.perKeyword.forEach(function (b) {
        baseMap[b.keyword + '||' + (b.prompt || '')] = b;
      });
    }

    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7">結果なし</td></tr>';
      if (sum) sum.hidden = true;
      return;
    }

    var branded = rows.filter(function (r) { return r.intent === 'branded'; });
    var generic = rows.filter(function (r) { return r.intent !== 'branded'; });
    function avgScore(arr) {
      var scored = arr.filter(function (r) { return r.score != null; });
      if (!scored.length) return null;
      return Math.round(scored.reduce(function (a, r) { return a + r.score; }, 0) / scored.length);
    }
    if (sum) {
      sum.hidden = false;
      sum.innerHTML =
        '<div class="aka-chip"><p class="lbl">計測キーワード</p><p class="val">' + rows.length + '</p></div>' +
        '<div class="aka-chip"><p class="lbl">指名 平均スコア</p><p class="val">' + (avgScore(branded) == null ? '—' : avgScore(branded)) + '</p></div>' +
        '<div class="aka-chip"><p class="lbl">一般 平均スコア</p><p class="val">' + (avgScore(generic) == null ? '—' : avgScore(generic)) + '</p></div>' +
        '<div class="aka-chip"><p class="lbl">エンジン</p><p class="val">' + esc(((payload.engines) || []).join(', ') || '—') + '</p></div>';
    }

    body.innerHTML = rows.map(function (r) {
      var key = r.keyword + '||' + (r.prompt || '');
      var b = baseMap[key];
      return (
        '<tr>' +
          '<td><span class="aka-pill ' + esc(r.intent || 'generic') + '">' +
            (r.intent === 'branded' ? '指名' : '一般') + '</span></td>' +
          '<td><strong>' + esc(r.keyword) + '</strong><div class="meta" style="font-size:.78rem;color:#64748b">' +
            esc(r.prompt || '') + '</div></td>' +
          '<td>' + (r.score == null ? '—' : r.score) + '</td>' +
          '<td>' + pct(r.mentionRate) + '</td>' +
          '<td>' + pct(r.citationRate) + '</td>' +
          '<td>' + pct(r.mediaCitationRate) + '</td>' +
          '<td>' + deltaHtml(r.score, b && b.score) + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  async function runSuggest() {
    var st = $('aka-suggest-status');
    var btn = $('aka-suggest');
    var payload = formPayload();
    if (!payload.url && !payload.brand) {
      setStatus(st, 'URLか会社名を入力してください', 'warn');
      return;
    }
    if (btn) btn.disabled = true;
    setStatus(st, '提案中…');
    try {
      if (!window.AirReachAPI || !window.AirReachAPI.apiFetch) {
        throw new Error('AirReachAPI が読み込まれていません');
      }
      var data = await window.AirReachAPI.apiFetch('/api/keyword-suggest/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        think: {
          title: 'キーワード提案',
          model: 'Jev',
          judgments: [
            { id: 'fetch', label: 'ページ取得', thinking: '公式URLの本文を読み取ります' },
            { id: 'branded', label: '指名検索', thinking: '会社・代表・サービスの調べられそうな言葉' },
            { id: 'generic', label: '一般検索', thinking: 'カテゴリ起点の探索クエリ' }
          ],
          log: 'URLからユーザー意図キーワードを提案'
        }
      });
      state.lastSuggest = data;
      state.keywords = (data.keywords || []).map(function (k) {
        return Object.assign({}, k, { selected: k.priority === 'P0' || k.intent === 'branded' });
      });
      if (data.entities) {
        if ($('aka-brand') && data.entities.brand && !$('aka-brand').value) {
          $('aka-brand').value = data.entities.brand;
        }
        if ($('aka-service') && data.entities.serviceName && !$('aka-service').value) {
          $('aka-service').value = data.entities.serviceName;
        }
        if ($('aka-category') && data.entities.category && !$('aka-category').value) {
          $('aka-category').value = data.entities.category;
        }
      }
      renderKeywords();
      saveLocal();
      var nB = state.keywords.filter(function (k) { return k.intent === 'branded'; }).length;
      var nG = state.keywords.filter(function (k) { return k.intent !== 'branded'; }).length;
      setStatus(st, '提案完了: 指名 ' + nB + ' / 一般 ' + nG + '（保証ではない）', 'good');
    } catch (err) {
      setStatus(st, (err && err.message) || '提案に失敗しました', 'warn');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function runMeasure() {
    var st = $('aka-measure-status');
    var btn = $('aka-measure');
    var prompts = selectedPrompts();
    var brand = ($('aka-brand') && $('aka-brand').value.trim()) || '';
    var url = ($('aka-url') && $('aka-url').value.trim()) || '';
    if (!brand) {
      setStatus(st, '会社名・ブランドを入力してください', 'warn');
      return;
    }
    if (!prompts.length) {
      setStatus(st, '計測するキーワードを選択してください', 'warn');
      return;
    }
    var engines = selectedEngines();
    if (btn) btn.disabled = true;
    setStatus(st, '計測中… (' + engines.join(', ') + ')');
    try {
      if (!window.AirReachAPI || !window.AirReachAPI.apiFetch) {
        throw new Error('AirReachAPI が読み込まれていません');
      }
      var thinkJudgments = [{ id: 'connect', label: 'API接続', thinking: 'キーワード別AIO計測' }];
      engines.forEach(function (e) {
        thinkJudgments.push({
          id: e,
          label: e,
          thinking: e === 'jev' ? '本文からの推定' : 'LLM実測'
        });
      });
      var data = await window.AirReachAPI.apiFetch('/api/hack2-measure/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand: brand,
          url: url || undefined,
          mediaUrl: ($('aka-media') && $('aka-media').value.trim()) || undefined,
          prompts: prompts,
          engines: engines
        }),
        think: {
          title: 'キーワード別AIO計測',
          model: engines.join('+'),
          judgments: thinkJudgments,
          log: prompts.length + ' キーワードを計測'
        }
      });
      state.lastMeasure = data;
      renderResults(data);
      saveLocal();
      setStatus(st, '計測完了 · scoreVersion=' + (data.scoreVersion || 'keyword-aio') + '（掲載保証なし）', 'good');
    } catch (err) {
      setStatus(st, (err && err.message) || '計測に失敗しました', 'warn');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function saveBaseline() {
    if (!state.lastMeasure) {
      setStatus($('aka-measure-status'), '先に計測してください', 'warn');
      return;
    }
    try {
      localStorage.setItem(BASELINE_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        perKeyword: state.lastMeasure.perKeyword || []
      }));
      setStatus($('aka-measure-status'), '基準を保存しました。再計測で差分を表示します。', 'good');
      renderResults(state.lastMeasure);
    } catch (e) {
      setStatus($('aka-measure-status'), '基準の保存に失敗しました', 'warn');
    }
  }

  function exportJson() {
    var blob = new Blob([JSON.stringify({
      form: formPayload(),
      keywords: state.keywords,
      lastSuggest: state.lastSuggest,
      lastMeasure: state.lastMeasure,
      exportedAt: new Date().toISOString()
    }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'airreach-keyword-aio-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function setSelectByIntent(intent, on) {
    state.keywords.forEach(function (k) {
      if (!intent || k.intent === intent) k.selected = !!on;
    });
    renderKeywords();
    saveLocal();
  }

  function bind() {
    if ($('aka-suggest')) $('aka-suggest').onclick = runSuggest;
    if ($('aka-measure')) $('aka-measure').onclick = runMeasure;
    if ($('aka-save-baseline')) $('aka-save-baseline').onclick = saveBaseline;
    if ($('aka-export')) $('aka-export').onclick = exportJson;
    if ($('aka-select-branded')) $('aka-select-branded').onclick = function () { setSelectByIntent('branded', true); };
    if ($('aka-select-generic')) $('aka-select-generic').onclick = function () { setSelectByIntent('generic', true); };
    if ($('aka-select-clear')) $('aka-select-clear').onclick = function () { setSelectByIntent(null, false); };
    document.querySelectorAll('.aka-tab').forEach(function (tab) {
      tab.onclick = function () {
        document.querySelectorAll('.aka-tab').forEach(function (t) { t.classList.remove('is-on'); });
        tab.classList.add('is-on');
        state.filter = tab.getAttribute('data-tab') || 'all';
        renderKeywords();
      };
    });
  }

  function init() {
    loadLocal();
    bind();
    renderKeywords();
    if (state.lastMeasure) renderResults(state.lastMeasure);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
