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

  var INDEX_KEY = 'airreach_recruit_indexing_events_v1';
  var AI_KEY = 'airreach_recruit_ai_runs_v1';

  var LIFECYCLE_TYPE = {
    published: 'URL_UPDATED',
    updated: 'URL_UPDATED',
    closed: 'URL_UPDATED',
    removed: 'URL_DELETED'
  };

  function q(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function setStatus(id, msg, kind) {
    var el = q(id);
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'arr-status' + (kind ? ' is-' + kind : '');
  }

  function loadJson(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key) || 'null');
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }

  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
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

  async function runValidate() {
    var raw = (q('arr-jsonld') && q('arr-jsonld').value || '').trim();
    if (!raw) {
      setStatus('arr-status', 'JSON-LD を貼り付けてください', 'warn');
      return;
    }
    var parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) {
      setStatus('arr-status', 'JSON として解析できません: ' + e.message, 'warn');
      return;
    }

    var btn = q('arr-run');
    if (btn) btn.disabled = true;
    setStatus('arr-status', '検証中…');

    try {
      if (!window.AirReachAPI || !window.AirReachAPI.apiFetch) {
        throw new Error('AirReachAPI が読み込まれていません');
      }
      var jobUrl = (q('arr-url') && q('arr-url').value) || '';
      if (jobUrl && q('arr-index-url') && !q('arr-index-url').value) {
        q('arr-index-url').value = jobUrl;
      }
      var data = await window.AirReachAPI.apiFetch('/api/job-posting-validate/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: jobUrl || undefined,
          jsonld: parsed,
          pageTextHints: {
            remoteMentioned: !!(q('arr-remote-hint') && q('arr-remote-hint').checked),
            salaryIsEstimate: !!(q('arr-salary-estimate') && q('arr-salary-estimate').checked)
          }
        })
      });
      renderResults(data);
      setStatus('arr-status', '検証完了（Observed · jobposting-readiness-v0）', 'good');
    } catch (e) {
      setStatus('arr-status', String(e && e.message ? e.message : e), 'warn');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function renderIndexHistory() {
    var body = q('arr-index-history');
    if (!body) return;
    var events = loadJson(INDEX_KEY, []);
    if (!events.length) {
      body.innerHTML = '<tr><td colspan="5">まだありません</td></tr>';
      return;
    }
    body.innerHTML = events.slice(0, 30).map(function (e) {
      return '<tr><td>' + esc(e.at || '') + '</td><td>' + esc(e.lifecycle || '—') +
        '</td><td>' + esc(e.type || '') + '</td><td>' + esc(e.url || '') +
        '</td><td>' + esc(e.result || '') + '</td></tr>';
    }).join('');
  }

  function pushIndexEvent(row) {
    var events = loadJson(INDEX_KEY, []);
    events.unshift(row);
    saveJson(INDEX_KEY, events.slice(0, 100));
    renderIndexHistory();
  }

  async function refreshIndexConfig() {
    var el = q('arr-index-config');
    if (!el || !window.AirReachAPI) return;
    try {
      var data = await window.AirReachAPI.apiFetch('/api/google/indexing/', { method: 'GET' });
      el.textContent = data.configured
        ? 'Indexing API 設定：接続可能（サービスアカウント）。通知しても掲載・順位は保証されません。'
        : 'Indexing API 設定：未接続。プレビューは可能。本番通知には Vercel の GOOGLE_INDEXING_* が必要です。';
    } catch (e) {
      el.textContent = 'Indexing API 設定：確認できませんでした（' + (e.message || e) + '）';
    }
  }

  async function runIndexing(opts) {
    opts = opts || {};
    var dryRun = !!opts.dryRun;
    var url = ((q('arr-index-url') && q('arr-index-url').value) || (q('arr-url') && q('arr-url').value) || '').trim();
    var lifecycle = (q('arr-lifecycle') && q('arr-lifecycle').value) || 'updated';
    var type = LIFECYCLE_TYPE[lifecycle] || 'URL_UPDATED';
    var confirm = !!(q('arr-index-confirm') && q('arr-index-confirm').checked);

    if (!url) {
      setStatus('arr-index-status', '求人詳細URLを入力してください', 'warn');
      return;
    }
    if (!dryRun && !confirm) {
      setStatus('arr-index-status', '本番通知には承認チェックが必要です', 'warn');
      return;
    }

    setStatus('arr-index-status', dryRun ? 'プレビュー中…' : '通知中…');
    try {
      var data = await window.AirReachAPI.apiFetch('/api/google/indexing/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url,
          type: type,
          lifecycle: lifecycle,
          dryRun: dryRun,
          confirm: dryRun ? false : confirm
        })
      });
      var result = data.notified ? 'notified' : (data.mode || 'ok');
      pushIndexEvent({
        at: (data.event && data.event.notifiedAt) || (data.event && data.event.requestedAt) || new Date().toISOString(),
        lifecycle: lifecycle,
        type: type,
        url: url,
        result: result + (data.disclaimer ? ' · 保証なし' : '')
      });
      setStatus(
        'arr-index-status',
        (data.notified ? '通知受付' : 'プレビュー完了') + ' · ' + (data.disclaimer || ''),
        data.notified ? 'good' : 'warn'
      );
    } catch (e) {
      setStatus('arr-index-status', String(e && e.message ? e.message : e), 'warn');
    }
  }

  async function runIndexMeta() {
    var url = ((q('arr-index-url') && q('arr-index-url').value) || '').trim();
    if (!url) {
      setStatus('arr-index-status', 'URLを入力してください', 'warn');
      return;
    }
    setStatus('arr-index-status', 'メタデータ取得中…');
    try {
      var path = '/api/google/indexing/?url=' + encodeURIComponent(url);
      var data = await window.AirReachAPI.apiFetch(path, { method: 'GET' });
      setStatus(
        'arr-index-status',
        '最新更新: ' + JSON.stringify(data.latestUpdate || null) +
          ' / 削除: ' + JSON.stringify(data.latestRemove || null),
        'good'
      );
    } catch (e) {
      setStatus('arr-index-status', String(e && e.message ? e.message : e), 'warn');
    }
  }

  function buildPrompts() {
    var brand = ((q('arr-brand') && q('arr-brand').value) || '').trim();
    var role = ((q('arr-role') && q('arr-role').value) || '').trim() || '求人';
    var city = ((q('arr-city') && q('arr-city').value) || '').trim();
    if (!brand) {
      setStatus('arr-ai-status', '会社名を入力してください', 'warn');
      return;
    }
    var place = city ? (city + 'の') : '';
    var branded = [
      brand + 'の働き方は？',
      brand + 'の福利厚生は？',
      brand + 'は' + role + 'を募集していますか？',
      brand + 'の評判・社風は？'
    ];
    var generic = [
      place + role + 'におすすめの会社は？',
      '未経験でも働きやすい' + role + 'の会社は？',
      place + '学生インターンを募集している会社は？',
      'リモート勤務可能な' + role + 'の求人は？'
    ];
    q('arr-prompts-branded').value = branded.join('\n');
    q('arr-prompts-generic').value = generic.join('\n');
    setStatus('arr-ai-status', '指名 ' + branded.length + ' / 一般 ' + generic.length + ' 件を作成しました', 'good');
  }

  function lines(id) {
    return String((q(id) && q(id).value) || '')
      .split(/\n+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function updateAiMeter(summary) {
    var el = q('arr-ai-ready') || document.querySelector('.arr-meter[data-panel="ai"] .arr-meter-val');
    if (!el) return;
    if (!summary) {
      el.textContent = '未計測';
      return;
    }
    el.textContent = '言及 ' + summary.mentionPct + '% · 引用 ' + summary.citationPct + '%（Observed）';
  }

  async function runAiMeasure() {
    var brand = ((q('arr-brand') && q('arr-brand').value) || '').trim();
    if (!brand) {
      setStatus('arr-ai-status', '会社名を入力してください', 'warn');
      return;
    }
    var branded = lines('arr-prompts-branded');
    var generic = lines('arr-prompts-generic');
    if (!branded.length && !generic.length) buildPrompts();
    branded = lines('arr-prompts-branded');
    generic = lines('arr-prompts-generic');

    var prompts = [];
    branded.forEach(function (p) {
      prompts.push({ keyword: p, prompt: p, intent: 'branded' });
    });
    generic.forEach(function (p) {
      prompts.push({ keyword: p, prompt: p, intent: 'generic' });
    });
    if (!prompts.length) {
      setStatus('arr-ai-status', '質問が空です', 'warn');
      return;
    }

    var btn = q('arr-ai-run');
    if (btn) btn.disabled = true;
    setStatus('arr-ai-status', 'Jev実測中…（Observed）');

    try {
      var data = await window.AirReachAPI.apiFetch('/api/hack2-measure/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand: brand,
          url: ((q('arr-url') && q('arr-url').value) || undefined),
          prompts: prompts.slice(0, 8),
          engines: ['jev']
        })
      });
      var rows = data.rows || [];
      var intentOf = {};
      prompts.forEach(function (p) { intentOf[p.prompt] = p.intent; });

      function summarize(filterIntent) {
        var rs = rows.filter(function (r) {
          var intent = intentOf[r.prompt || r.keyword] || 'branded';
          return !filterIntent || intent === filterIntent;
        });
        if (!rs.length) return { n: 0, mentionPct: 0, citationPct: 0 };
        var m = rs.reduce(function (s, r) { return s + (Number(r.mentioned) || 0); }, 0);
        var c = rs.reduce(function (s, r) { return s + (Number(r.cited) || 0); }, 0);
        return {
          n: rs.length,
          mentionPct: Math.round((m / rs.length) * 100),
          citationPct: Math.round((c / rs.length) * 100)
        };
      }

      var all = summarize(null);
      var b = summarize('branded');
      var g = summarize('generic');
      updateAiMeter(all);

      var run = {
        at: new Date().toISOString(),
        brand: brand,
        all: all,
        branded: b,
        generic: g,
        rows: rows
      };
      var prev = loadJson(AI_KEY, []);
      prev.unshift(run);
      saveJson(AI_KEY, prev.slice(0, 20));

      var box = q('arr-ai-results');
      box.hidden = false;
      box.innerHTML =
        '<p class="arr-note">準備度とは別指標です。Jevはページ本文からの推定（Observed/Estimated混在の可能性）。ChatGPT等のライブ計測は Studio で実行できます。</p>' +
        '<table class="arr-check-table"><thead><tr><th>区分</th><th>件数</th><th>言及率</th><th>引用率</th></tr></thead><tbody>' +
        '<tr><td>全体</td><td>' + all.n + '</td><td>' + all.mentionPct + '%</td><td>' + all.citationPct + '%</td></tr>' +
        '<tr><td>指名</td><td>' + b.n + '</td><td>' + b.mentionPct + '%</td><td>' + b.citationPct + '%</td></tr>' +
        '<tr><td>一般</td><td>' + g.n + '</td><td>' + g.mentionPct + '%</td><td>' + g.citationPct + '%</td></tr>' +
        '</tbody></table>';

      setStatus('arr-ai-status', '実測完了 · ' + rows.length + ' 行（Observed）', 'good');
    } catch (e) {
      setStatus('arr-ai-status', String(e && e.message ? e.message : e), 'warn');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function restoreAiMeter() {
    var runs = loadJson(AI_KEY, []);
    if (runs[0] && runs[0].all) updateAiMeter(runs[0].all);
  }


  var CV_KEY = 'airreach_recruit_application_flow_v1';
  var CV_FLAGS_KEY = 'airreach_recruit_cv_flags_v1';

  function loadCvState() {
    return {
      funnel: loadJson(CV_KEY, null),
      flags: loadJson(CV_FLAGS_KEY, {})
    };
  }

  function updateCvMeter() {
    var el = q('arr-cv-ready');
    if (!el || !window.AirReachApplicationFlow) return;
    var st = loadCvState();
    var inst = window.AirReachApplicationFlow.instrumentationScore(st.flags);
    if (st.funnel && st.funnel.stages) {
      var cvr = st.funnel.overallCvr;
      var cvrLabel = cvr == null ? 'CVR —' : ('閲覧→完了 ' + Math.round(cvr * 1000) / 10 + '%');
      el.textContent = inst.label + ' · ' + cvrLabel;
    } else if (inst.ok > 0) {
      el.textContent = inst.label + '（実数未取込）';
    } else {
      el.textContent = '未計測';
    }
  }

  function renderCvResults(funnel) {
    var box = q('arr-cv-results');
    if (!box || !funnel) return;
    box.hidden = false;
    var max = Math.max.apply(null, funnel.stages.map(function (s) { return s.count; }).concat([1]));
    var bars = funnel.stages.map(function (s) {
      var w = Math.round((s.count / max) * 100);
      return '<div class="arr-funnel-row"><span>' + esc(s.label) + '</span>' +
        '<div class="track"><div class="fill" style="width:' + w + '%"></div></div>' +
        '<span class="score">' + esc(String(s.count)) + '</span></div>';
    }).join('');
    var rates = (funnel.stepRates || []).map(function (r) {
      var pct = r.rate == null ? '—' : (Math.round(r.rate * 1000) / 10 + '%');
      return '<tr><td>' + esc(r.fromLabel) + ' → ' + esc(r.toLabel) + '</td><td>' + pct + '</td></tr>';
    }).join('');
    var overall = funnel.overallCvr == null ? '—' : (Math.round(funnel.overallCvr * 1000) / 10 + '%');
    box.innerHTML =
      '<p class="arr-note">' + esc(funnel.evidenceClass) + ' · ' + esc(funnel.source) +
      ' · 全体CVR ' + overall + ' · ' + esc(funnel.note || '') + '</p>' +
      '<div class="arr-funnel">' + bars + '</div>' +
      '<table class="arr-check-table" style="margin-top:12px"><thead><tr><th>ステップ</th><th>転換率</th></tr></thead><tbody>' +
      rates + '</tbody></table>' +
      ((funnel.unmatched || []).length
        ? '<p class="arr-note">未マップイベント: ' + esc(funnel.unmatched.join(', ')) + '</p>'
        : '');
  }

  function saveFunnel(funnel) {
    saveJson(CV_KEY, funnel);
    renderCvResults(funnel);
    updateCvMeter();
  }

  function readFlagsFromUi() {
    var flags = {};
    document.querySelectorAll('[data-cv-flag]').forEach(function (el) {
      flags[el.getAttribute('data-cv-flag')] = !!el.checked;
    });
    return flags;
  }

  function restoreCvUi() {
    var st = loadCvState();
    document.querySelectorAll('[data-cv-flag]').forEach(function (el) {
      var k = el.getAttribute('data-cv-flag');
      el.checked = !!st.flags[k];
    });
    if (st.funnel) {
      renderCvResults(st.funnel);
      var map = {};
      (st.funnel.stages || []).forEach(function (s) { map[s.id] = s.count; });
      if (q('arr-cv-view')) q('arr-cv-view').value = map.job_view || '';
      if (q('arr-cv-cta')) q('arr-cv-cta').value = map.apply_cta_click || '';
      if (q('arr-cv-start')) q('arr-cv-start').value = map.apply_start || '';
      if (q('arr-cv-complete')) q('arr-cv-complete').value = map.apply_complete || '';
    }
    updateCvMeter();
  }

  function onCvFlagsChange() {
    var flags = readFlagsFromUi();
    saveJson(CV_FLAGS_KEY, flags);
    updateCvMeter();
    setStatus('arr-cv-status', '計測チェックを保存しました（Planned）', 'good');
  }

  function applyManualCounts() {
    if (!window.AirReachApplicationFlow) {
      setStatus('arr-cv-status', 'Application Flow モジュール未読込', 'warn');
      return;
    }
    var counts = {
      job_view: Number((q('arr-cv-view') && q('arr-cv-view').value) || 0),
      apply_cta_click: Number((q('arr-cv-cta') && q('arr-cv-cta').value) || 0),
      apply_start: Number((q('arr-cv-start') && q('arr-cv-start').value) || 0),
      apply_complete: Number((q('arr-cv-complete') && q('arr-cv-complete').value) || 0)
    };
    var funnel = window.AirReachApplicationFlow.buildFunnel(counts, {
      evidenceClass: 'Customer supplied',
      source: 'Manual entry'
    });
    saveFunnel(funnel);
    setStatus('arr-cv-status', '手入力を反映しました（Customer supplied）', 'good');
  }

  function onCvCsv(file) {
    if (!window.AirReachApplicationFlow) {
      setStatus('arr-cv-status', 'Application Flow モジュール未読込', 'warn');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var funnel = window.AirReachApplicationFlow.fromCsvText(reader.result, {
          evidenceClass: 'Official',
          source: 'GA4/ATS CSV'
        });
        if (!funnel.rowCount) throw new Error('マップできるイベント行がありません');
        var map = {};
        funnel.stages.forEach(function (s) { map[s.id] = s.count; });
        if (q('arr-cv-view')) q('arr-cv-view').value = map.job_view || 0;
        if (q('arr-cv-cta')) q('arr-cv-cta').value = map.apply_cta_click || 0;
        if (q('arr-cv-start')) q('arr-cv-start').value = map.apply_start || 0;
        if (q('arr-cv-complete')) q('arr-cv-complete').value = map.apply_complete || 0;
        saveFunnel(funnel);
        setStatus('arr-cv-status', 'CSV取込完了 · ' + funnel.rowCount + '行（Official）', 'good');
      } catch (e) {
        setStatus('arr-cv-status', String(e && e.message ? e.message : e), 'warn');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function showSnippet() {
    if (!window.AirReachApplicationFlow) return;
    var box = q('arr-cv-snippet-box');
    if (!box) return;
    box.hidden = false;
    box.value = window.AirReachApplicationFlow.snippetTemplate('JOB_ID');
    setStatus('arr-cv-status', '推奨イベント名のスニペットを表示しました（サイトへは自動埋め込みしません）', 'good');
  }

  function clearCv() {
    try {
      localStorage.removeItem(CV_KEY);
      localStorage.removeItem(CV_FLAGS_KEY);
    } catch (e) {}
    document.querySelectorAll('[data-cv-flag]').forEach(function (el) { el.checked = false; });
    ['arr-cv-view', 'arr-cv-cta', 'arr-cv-start', 'arr-cv-complete'].forEach(function (id) {
      if (q(id)) q(id).value = '';
    });
    if (q('arr-cv-results')) { q('arr-cv-results').hidden = true; q('arr-cv-results').innerHTML = ''; }
    if (q('arr-cv-snippet-box')) { q('arr-cv-snippet-box').hidden = true; q('arr-cv-snippet-box').value = ''; }
    updateCvMeter();
    setStatus('arr-cv-status', '応募導線データをクリアしました', 'good');
  }



  function renderEvidence() {
    var box = q('arr-eg-list');
    if (!box || !window.AirReachEvidenceGraph) return;
    var claims = window.AirReachEvidenceGraph.load();
    if (!claims.length) {
      box.innerHTML = '<p class="arr-note">まだ根拠がありません。働き方・福利厚生などの主張に、公式URLを紐づけてください。</p>';
      return;
    }
    box.innerHTML = claims.map(function (c) {
      var n = (c.evidence || []).length;
      var ev = (c.evidence || []).map(function (e) {
        return '<li><a href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.title || e.url) + '</a> · ' + esc(e.kind) + '</li>';
      }).join('');
      return '<article class="arr-meter" style="margin-bottom:10px"><h3>' + esc(c.claim) + '</h3>' +
        '<p class="arr-meter-hint">この主張について、AIが参照可能な根拠が ' + n + ' 件あります</p>' +
        '<ul>' + ev + '</ul>' +
        '<button type="button" class="arr-btn arr-btn-secondary" data-eg-del="' + esc(c.id) + '">削除</button></article>';
    }).join('');
    box.querySelectorAll('[data-eg-del]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        window.AirReachEvidenceGraph.removeClaim(btn.getAttribute('data-eg-del'));
        renderEvidence();
        setStatus('arr-eg-status', '削除しました', 'good');
      });
    });
  }

  function addEvidence() {
    if (!window.AirReachEvidenceGraph) {
      setStatus('arr-eg-status', 'Evidence Graph 未読込', 'warn');
      return;
    }
    var claim = ((q('arr-eg-claim') && q('arr-eg-claim').value) || '').trim();
    var url = ((q('arr-eg-url') && q('arr-eg-url').value) || '').trim();
    if (!claim || !url) {
      setStatus('arr-eg-status', '主張と根拠URLは必須です', 'warn');
      return;
    }
    window.AirReachEvidenceGraph.addClaim(claim, [{
      url: url,
      title: ((q('arr-eg-title-input') && q('arr-eg-title-input').value) || '').trim(),
      kind: (q('arr-eg-kind') && q('arr-eg-kind').value) || 'official'
    }]);
    if (q('arr-eg-url')) q('arr-eg-url').value = '';
    if (q('arr-eg-title-input')) q('arr-eg-title-input').value = '';
    renderEvidence();
    setStatus('arr-eg-status', '根拠を追加しました（引用保証ではありません）', 'good');
  }


  document.addEventListener('DOMContentLoaded', function () {
    if (q('arr-run')) q('arr-run').addEventListener('click', runValidate);
    if (q('arr-index-dry')) q('arr-index-dry').addEventListener('click', function () { runIndexing({ dryRun: true }); });
    if (q('arr-index-run')) q('arr-index-run').addEventListener('click', function () { runIndexing({ dryRun: false }); });
    if (q('arr-index-meta')) q('arr-index-meta').addEventListener('click', runIndexMeta);
    if (q('arr-prompt-build')) q('arr-prompt-build').addEventListener('click', buildPrompts);
    if (q('arr-ai-run')) q('arr-ai-run').addEventListener('click', runAiMeasure);
    if (q('arr-url') && q('arr-index-url')) {
      q('arr-url').addEventListener('change', function () {
        if (!q('arr-index-url').value) q('arr-index-url').value = q('arr-url').value;
      });
    }
    document.querySelectorAll('[data-cv-flag]').forEach(function (el) {
      el.addEventListener('change', onCvFlagsChange);
    });
    if (q('arr-cv-apply-manual')) q('arr-cv-apply-manual').addEventListener('click', applyManualCounts);
    if (q('arr-cv-snippet')) q('arr-cv-snippet').addEventListener('click', showSnippet);
    if (q('arr-cv-clear')) q('arr-cv-clear').addEventListener('click', clearCv);
    if (q('arr-cv-csv')) {
      q('arr-cv-csv').addEventListener('change', function () {
        var f = q('arr-cv-csv').files && q('arr-cv-csv').files[0];
        if (f) onCvCsv(f);
      });
    }
    renderIndexHistory();
    restoreAiMeter();
    restoreCvUi();
    if (q('arr-eg-add')) q('arr-eg-add').addEventListener('click', addEvidence);
    renderEvidence();
    refreshIndexConfig();
  });
})();
