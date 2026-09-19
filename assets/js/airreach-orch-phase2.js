/**
 * HackⅡ Studio Phase 2 — draft GitHub PR, Keyword Planner CSV, HackⅡ JSON, publish checklist.
 * No auto-merge and no production deploy from the browser.
 */
(function () {
  'use strict';

  var GH_KEY = 'airreach_studio_gh_v1';
  var LAST_PR_KEY = 'airreach_studio_last_pr_v1';

  function q(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function normKw(s) {
    return String(s || '').toLowerCase().replace(/[\s　]+/g, '').trim();
  }
  function setStatus(el, msg, ok) {
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || '';
    el.className = (el.id === 'orch-phase2-status' ? 'orch-phase2-status' : 'orch-gsc-status') +
      (ok === true ? ' is-ok' : (ok === false ? ' is-warn' : ''));
  }
  function b64utf8(str) {
    var bytes = typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(str)
      : unescape(encodeURIComponent(str)).split('').map(function (c) { return c.charCodeAt(0); });
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function parseCsv(text) {
    if (window.AirReachOrchestrator && window.AirReachOrchestrator.parseCsv) {
      return window.AirReachOrchestrator.parseCsv(text);
    }
    var rows = [], row = [], cur = '', quote = false, i, ch, nx;
    text = String(text || '').replace(/^\uFEFF/, '');
    for (i = 0; i < text.length; i++) {
      ch = text[i]; nx = text[i + 1];
      if (ch === '"' && quote && nx === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { quote = !quote; continue; }
      if ((ch === ',' || ch === '\t') && !quote) { row.push(cur); cur = ''; continue; }
      if ((ch === '\n' || ch === '\r') && !quote) {
        if (ch === '\r' && nx === '\n') i++;
        row.push(cur);
        if (row.some(function (x) { return x !== ''; })) rows.push(row);
        row = []; cur = ''; continue;
      }
      cur += ch;
    }
    row.push(cur);
    if (row.some(function (x) { return x !== ''; })) rows.push(row);
    if (!rows.length) return [];
    var head = rows.shift().map(function (x) { return String(x).trim(); });
    return rows.map(function (r) {
      var o = {};
      head.forEach(function (h, j) { o[h] = r[j] || ''; });
      return o;
    });
  }

  function loadGhPrefs() {
    try { return JSON.parse(sessionStorage.getItem(GH_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveGhPrefs(p) {
    try {
      sessionStorage.setItem(GH_KEY, JSON.stringify({
        repo: p.repo || '',
        base: p.base || 'main',
        path: p.path || 'airreach-implementation',
        token: p.token || ''
      }));
    } catch (e) {}
  }

  function plannerVolume(row) {
    var keys = Object.keys(row || {});
    var volKey = null, kwKey = null, ki;
    for (ki = 0; ki < keys.length; ki++) {
      if (!volKey && /avg\.?\s*monthly\s*searches|平均月間検索|検索ボリューム|volume|searches/i.test(keys[ki])) volKey = keys[ki];
      if (!kwKey && (/^(keyword|クエリ|キーワード|query)$/i.test(keys[ki]) || /keyword|キーワード|query/i.test(keys[ki]))) kwKey = keys[ki];
    }
    var kw = kwKey ? row[kwKey] : (row.Keyword || row.keyword || row.query || '');
    var raw = volKey ? row[volKey] : (row['Avg. monthly searches'] || row['Average monthly searches'] || row.volume || '');
    var n = Number(String(raw).replace(/[,，\s]/g, '').replace(/〜|~/g, ''));
    if (!isFinite(n) || n < 0) {
      // Planner sometimes exports ranges like "100-1000"
      var m = String(raw).match(/(\d[\d,]*)\s*[-–〜~]\s*(\d[\d,]*)/);
      if (m) n = Math.round((Number(m[1].replace(/,/g, '')) + Number(m[2].replace(/,/g, ''))) / 2);
    }
    if (!String(kw).trim() || !isFinite(n)) return null;
    return { keyword: String(kw).trim(), volume: Math.round(n) };
  }

  function applyPlannerCsv(text) {
    var Orch = window.AirReachOrchestrator;
    var job = window.__orchLastJob;
    if (!Orch || !job || job.status !== 'completed') throw new Error('先に分析を完了してください');
    var rows = parseCsv(text);
    var map = {};
    var n = 0;
    rows.forEach(function (r) {
      var p = plannerVolume(r);
      if (!p) return;
      map[normKw(p.keyword)] = p;
      n++;
    });
    if (!n) throw new Error('Keyword / 平均月間検索の列が見つかりません');
    var hit = 0;
    (job.keywords || []).forEach(function (k) {
      var p = map[normKw(k.keyword)];
      if (!p) {
        // soft contains
        Object.keys(map).some(function (gk) {
          if (gk === normKw(k.keyword) || normKw(k.keyword).indexOf(gk) !== -1 || gk.indexOf(normKw(k.keyword)) !== -1) {
            p = map[gk];
            return true;
          }
          return false;
        });
      }
      if (!p) return;
      k.volume_estimated_prev = k.volume_estimated_prev != null ? k.volume_estimated_prev : k.volume;
      k.volume = p.volume;
      k.volume_source = 'Official';
      k.planner_keyword = p.keyword;
      hit++;
    });
    // seed missing official keywords
    Object.keys(map).forEach(function (gk) {
      if ((job.keywords || []).some(function (k) { return normKw(k.keyword) === gk; })) return;
      if ((job.keywords || []).length >= (job.keyword_limit || 100)) return;
      var p = map[gk];
      job.keywords.push({
        id: 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        keyword: p.keyword,
        volume: p.volume,
        volume_source: 'Official',
        gsc_impressions: null,
        intent: /比較|おすすめ|費用|料金/.test(p.keyword) ? 'Commercial' : 'Informational',
        priority: p.volume >= 1000 ? 'P0' : p.volume >= 200 ? 'P1' : 'P2',
        strength: '普通',
        gap: '中',
        action: 'ページ改善',
        cluster: 'Core',
        seed_source: 'KeywordPlanner',
        prompts: [],
        prompt_count: 0
      });
      hit++;
    });
    job.totalDemand = (job.keywords || []).reduce(function (s, k) { return s + (Number(k.volume) || 0); }, 0);
    job.headline4 = job.headline4 || {};
    job.headline4.keywords = (job.keywords || []).length;
    job.headline4.demand = job.totalDemand;
    job.conclusion = (job.conclusion || '') + (job.conclusion && job.conclusion.indexOf('Keyword Planner') === -1
      ? ' Keyword Planner公式ボリュームを反映済みです。'
      : '');
    if (Orch.refreshJobArtifacts) Orch.refreshJobArtifacts(job);
    else {
      job.files = Orch.buildPackageFiles(job);
      try { localStorage.setItem('airreach_studio_orch_v1', JSON.stringify({ lastJob: job })); } catch (e) {}
    }
    if (Orch.renderResult) Orch.renderResult(job);
    window.__orchLastJob = job;
    return { imported: n, applied: hit };
  }

  function applyHack2Json(text) {
    var Orch = window.AirReachOrchestrator;
    var job = window.__orchLastJob;
    if (!Orch || !job || job.status !== 'completed') throw new Error('先に分析を完了してください');
    var data = JSON.parse(text);
    var rows = Array.isArray(data) ? data : (data.rows || data.measurements || data.results || []);
    if (!Array.isArray(rows) || !rows.length) throw new Error('配列JSON（または rows）が必要です');

    // also push into studio state
    try {
      if (window.AirReachStudio && window.AirReachStudio.getState) {
        var st = window.AirReachStudio.getState();
        rows.forEach(function (r) {
          st.hack2 = st.hack2 || [];
          st.hack2.push(r);
          st.measurements.push({
            date: r.measurement_date || r.date || '',
            keyword: r.keyword || r.prompt || '',
            url: r.url || '',
            impressions: 0, clicks: 0, position: 0, sessions: 0, keyEvents: 0,
            aiMention: r.mentioned != null ? r.mentioned : r.aiMention,
            aiCitation: r.cited != null ? r.cited : r.aiCitation
          });
        });
        if (window.AirReachStudio.save) window.AirReachStudio.save();
      }
    } catch (e) {}

    var map = {};
    rows.forEach(function (r) {
      var k = normKw(r.keyword || r.prompt || '');
      if (!k) return;
      if (!map[k]) map[k] = { mention: 0, citation: 0, n: 0, raw: r.keyword || r.prompt };
      map[k].n += 1;
      if (r.mentioned || r.aiMention) map[k].mention += 1;
      if (r.cited || r.aiCitation) map[k].citation += 1;
    });

    var hit = 0;
    (job.keywords || []).forEach(function (k) {
      var m = map[normKw(k.keyword)];
      if (!m) {
        Object.keys(map).some(function (gk) {
          if (normKw(k.keyword).indexOf(gk) !== -1 || gk.indexOf(normKw(k.keyword)) !== -1) {
            m = map[gk];
            return true;
          }
          return false;
        });
      }
      if (!m) return;
      k.ai_mention_rate = Math.round((m.mention / Math.max(1, m.n)) * 100);
      k.ai_citation_rate = Math.round((m.citation / Math.max(1, m.n)) * 100);
      k.hack2_runs = m.n;
      if (k.ai_mention_rate === 0 && k.priority === 'P2') k.priority = 'P1';
      hit++;
    });

    job.hack2_imported = rows.length;
    if (Orch.refreshJobArtifacts) Orch.refreshJobArtifacts(job);
    else {
      job.files = Orch.buildPackageFiles(job);
      try { localStorage.setItem('airreach_studio_orch_v1', JSON.stringify({ lastJob: job })); } catch (e) {}
    }
    if (Orch.renderResult) Orch.renderResult(job);
    window.__orchLastJob = job;
    return { imported: rows.length, applied: hit };
  }

  async function gh(path, token, opts) {
    opts = opts || {};
    var r = await fetch('https://api.github.com' + path, {
      method: opts.method || 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    var data = null;
    var text = await r.text();
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
    if (!r.ok) {
      var msg = (data && (data.message || data.error)) || ('GitHub API ' + r.status);
      throw new Error(msg);
    }
    return data;
  }

  async function createDraftPr(job, cfg) {
    if (!job || !job.files) throw new Error('先に分析を完了してください');
    var parts = String(cfg.repo || '').split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('owner/repo 形式で入力してください');
    var owner = parts[0];
    var repo = parts[1];
    var base = cfg.base || 'main';
    var branch = cfg.branch || ('airreach/' + Date.now().toString(36));
    var prefix = String(cfg.path || (window.AirReachPackageSchema && window.AirReachPackageSchema.PACKAGE_ROOT) || 'airreach-implementation').replace(/^\/+|\/+$/g, '');
    var token = cfg.token;
    if (!token) throw new Error('Personal Access Tokenが必要です');
    if (!cfg.approved) throw new Error('人間レビュー同意が必要です');

    var ref = await gh('/repos/' + owner + '/' + repo + '/git/ref/heads/' + encodeURIComponent(base), token);
    var baseSha = ref && ref.object && ref.object.sha;
    if (!baseSha) throw new Error('ベースブランチを取得できませんでした');
    var baseCommit = await gh('/repos/' + owner + '/' + repo + '/git/commits/' + baseSha, token);
    var baseTree = baseCommit.tree && baseCommit.tree.sha;

    var files = {};
    Object.keys(job.files || {}).forEach(function (k) {
      if (k === '_validation') return;
      files[k] = job.files[k];
    });
    if (window.AirReachPackageSchema && window.AirReachPackageSchema.validatePackageFiles) {
      var chk = window.AirReachPackageSchema.validatePackageFiles(files);
      if (!chk.ok) throw new Error('パッケージ構造が設計図と不一致: ' + (chk.errors || chk.missing || []).join('; '));
    }
    var tree = [];
    var names = Object.keys(files);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var content = String(files[name] == null ? '' : files[name]);
      var blob = await gh('/repos/' + owner + '/' + repo + '/git/blobs', token, {
        method: 'POST',
        body: { content: b64utf8(content), encoding: 'base64' }
      });
      tree.push({
        path: prefix + '/' + name,
        mode: '100644',
        type: 'blob',
        sha: blob.sha
      });
    }

    var newTree = await gh('/repos/' + owner + '/' + repo + '/git/trees', token, {
      method: 'POST',
      body: { base_tree: baseTree, tree: tree }
    });
    var commit = await gh('/repos/' + owner + '/' + repo + '/git/commits', token, {
      method: 'POST',
      body: {
        message: 'chore(airreach): draft implementation package from HackⅡ Studio\n\nDraft only. Do not merge without human review.',
        tree: newTree.sha,
        parents: [baseSha]
      }
    });

    try {
      await gh('/repos/' + owner + '/' + repo + '/git/refs', token, {
        method: 'POST',
        body: { ref: 'refs/heads/' + branch, sha: commit.sha }
      });
    } catch (e) {
      // branch may exist — update
      await gh('/repos/' + owner + '/' + repo + '/git/refs/heads/' + encodeURIComponent(branch), token, {
        method: 'PATCH',
        body: { sha: commit.sha, force: false }
      });
    }

    var prBody = [
      '## Summary',
      '- HackⅡ Studio が生成した実装パッケージ下書きです。',
      '- 市場需要の推定と GSC / Keyword Planner / HackⅡ 実測を混同しないでください。',
      '- **自動マージ・本番Deployは行いません。** 人間レビュー後にマージしてください。',
      '',
      '## Checklist',
      '- [ ] 料金・事例・顧客名・数値の捏造がない',
      '- [ ] FAQ / JSON-LD が公開文面と一致',
      '- [ ] ステークホルダー承認',
      '',
      'Target site: ' + (job.url || ''),
      'Goal: ' + (job.goal || '')
    ].join('\n');

    var pr;
    try {
      pr = await gh('/repos/' + owner + '/' + repo + '/pulls', token, {
        method: 'POST',
        body: {
          title: 'draft: AirReach / HackⅡ Studio implementation package',
          head: branch,
          base: base,
          body: prBody,
          draft: true
        }
      });
    } catch (e) {
      // org may disallow draft — create ready-for-review but still no auto-merge
      pr = await gh('/repos/' + owner + '/' + repo + '/pulls', token, {
        method: 'POST',
        body: {
          title: '[NEEDS HUMAN REVIEW] AirReach implementation package',
          head: branch,
          base: base,
          body: prBody + '\n\n> Draft PRs are disabled on this repo; treat this as review-only.'
        }
      });
    }

    var meta = {
      html_url: pr.html_url,
      number: pr.number,
      created_at: new Date().toISOString(),
      repo: owner + '/' + repo,
      branch: branch
    };
    try { sessionStorage.setItem(LAST_PR_KEY, JSON.stringify(meta)); } catch (e) {}
    job.deployment_run = {
      type: 'github_draft_pr',
      status: 'awaiting_human_review',
      pr_url: meta.html_url,
      pr_number: meta.number,
      auto_deploy: false
    };
    if (window.AirReachOrchestrator && window.AirReachOrchestrator.refreshJobArtifacts) {
      window.AirReachOrchestrator.refreshJobArtifacts(job);
    }
    return meta;
  }

  function fillPrForm() {
    var prefs = loadGhPrefs();
    if (q('orch-gh-repo') && prefs.repo) q('orch-gh-repo').value = prefs.repo;
    if (q('orch-gh-base') && prefs.base) q('orch-gh-base').value = prefs.base;
    if (q('orch-gh-path') && prefs.path) q('orch-gh-path').value = prefs.path;
    if (q('orch-gh-token') && prefs.token) q('orch-gh-token').value = prefs.token;
    if (q('orch-gh-branch')) {
      q('orch-gh-branch').value = 'airreach/' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Date.now().toString(36).slice(-4);
    }
  }

  function syncDeployChecklist() {
    var ul = q('orch-deploy-check');
    var items = (window.AirReachPackageSchema && window.AirReachPackageSchema.VALIDATION_ITEMS) || null;
    if (!ul || !items) return;
    ul.innerHTML = items.map(function (item) {
      return '<li><label><input type="checkbox"> ' + String(item).replace(/[&<>]/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c];
      }) + '</label></li>';
    }).join('');
  }

  function bind() {
    syncDeployChecklist();
    var prBtn = q('orch-pr');
    var prDialog = q('orch-pr-dialog');
    var deployBtn = q('orch-deploy');
    var deployDialog = q('orch-deploy-dialog');
    var dataStatus = q('orch-phase2-data-status');
    var packStatus = q('orch-phase2-status');

    if (prBtn && prDialog) {
      prBtn.disabled = false;
      prBtn.addEventListener('click', function () {
        if (!window.__orchLastJob || !window.__orchLastJob.files) {
          alert('先に分析を完了してください');
          return;
        }
        fillPrForm();
        setStatus(q('orch-gh-msg'), '', null);
        if (prDialog.showModal) prDialog.showModal();
        else prDialog.setAttribute('open', 'open');
      });
    }

    var form = q('orch-pr-form');
    if (form) {
      form.addEventListener('submit', async function (e) {
        var submitter = e.submitter || document.activeElement;
        var val = submitter && submitter.value;
        if (val === 'cancel') return;
        e.preventDefault();
        var cfg = {
          repo: (q('orch-gh-repo') && q('orch-gh-repo').value || '').trim(),
          base: (q('orch-gh-base') && q('orch-gh-base').value || 'main').trim(),
          branch: (q('orch-gh-branch') && q('orch-gh-branch').value || '').trim(),
          path: (q('orch-gh-path') && q('orch-gh-path').value || 'airreach-implementation').trim(),
          token: (q('orch-gh-token') && q('orch-gh-token').value || '').trim(),
          approved: !!(q('orch-gh-approve') && q('orch-gh-approve').checked)
        };
        saveGhPrefs(cfg);
        var msg = q('orch-gh-msg');
        setStatus(msg, 'GitHub APIに送信中…', null);
        var submit = q('orch-gh-submit');
        if (submit) submit.disabled = true;
        try {
          var meta = await createDraftPr(window.__orchLastJob, cfg);
          setStatus(msg, '下書きPRを作成しました: ' + meta.html_url, true);
          setStatus(packStatus, '下書きPR #' + meta.number + ' を作成済み（マージは人間承認）', true);
          if (q('orch-deploy-pr-link')) {
            q('orch-deploy-pr-link').href = meta.html_url;
            q('orch-deploy-pr-link').hidden = false;
            q('orch-deploy-pr-link').textContent = '下書きPR #' + meta.number + ' を開く';
          }
        } catch (err) {
          setStatus(msg, '失敗: ' + (err && err.message ? err.message : err), false);
        } finally {
          if (submit) submit.disabled = false;
        }
      });
    }

    if (deployBtn && deployDialog) {
      deployBtn.addEventListener('click', function () {
        try {
          var last = JSON.parse(sessionStorage.getItem(LAST_PR_KEY) || 'null');
          var link = q('orch-deploy-pr-link');
          if (link) {
            if (last && last.html_url) {
              link.href = last.html_url;
              link.hidden = false;
              link.textContent = '下書きPR #' + last.number + ' を開く';
            } else if (window.__orchLastJob && window.__orchLastJob.deployment_run && window.__orchLastJob.deployment_run.pr_url) {
              link.href = window.__orchLastJob.deployment_run.pr_url;
              link.hidden = false;
            } else {
              link.hidden = true;
            }
          }
        } catch (e) {}
        if (deployDialog.showModal) deployDialog.showModal();
        else deployDialog.setAttribute('open', 'open');
      });
    }
    if (q('orch-deploy-close') && deployDialog) {
      q('orch-deploy-close').addEventListener('click', function () {
        if (deployDialog.close) deployDialog.close();
        else deployDialog.removeAttribute('open');
      });
    }

    var planner = q('orch-planner-csv');
    if (planner) {
      planner.addEventListener('change', function () {
        var f = planner.files && planner.files[0];
        if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          try {
            var r = applyPlannerCsv(rd.result);
            setStatus(dataStatus, 'Keyword Planner取込: ' + r.imported + ' 行 / 反映 ' + r.applied + '（公式ボリューム）', true);
          } catch (err) {
            setStatus(dataStatus, 'Planner CSV失敗: ' + (err && err.message ? err.message : err), false);
          }
        };
        rd.readAsText(f, 'utf-8');
      });
    }

    var hack2 = q('orch-hack2-file');
    if (hack2) {
      hack2.addEventListener('change', function () {
        var f = hack2.files && hack2.files[0];
        if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          try {
            var r = applyHack2Json(rd.result);
            setStatus(dataStatus, 'HackⅡ取込: ' + r.imported + ' 件 / キーワード反映 ' + r.applied + '（言及・引用は実測）', true);
          } catch (err) {
            setStatus(dataStatus, 'HackⅡ JSON失敗: ' + (err && err.message ? err.message : err), false);
          }
        };
        rd.readAsText(f, 'utf-8');
      });
    }

    // Optional: wire Expert Google sync to /api/google/* when available
    var syncGsc = q('sync-gsc');
    var syncMsg = q('sync-message');
    if (syncGsc && !syncGsc._phase2) {
      syncGsc._phase2 = true;
      syncGsc.addEventListener('click', async function () {
        var site = (q('gsc-site') && q('gsc-site').value || '').trim();
        var start = q('sync-start') && q('sync-start').value;
        var end = q('sync-end') && q('sync-end').value;
        if (!site || !start || !end) {
          if (syncMsg) {
            syncMsg.className = 'ars-note warn';
            syncMsg.textContent = 'GSCサイトURLと期間を入力するか、CSVフォールバックを使ってください。';
          }
          return;
        }
        if (syncMsg) {
          syncMsg.className = 'ars-note';
          syncMsg.textContent = '/api/google/gsc に接続中…';
        }
        try {
          var res = await fetch('/api/google/gsc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ siteUrl: site, startDate: start, endDate: end })
          });
          var data = await res.json().catch(function () { return {}; });
          if (!res.ok) throw new Error(data.error || data.message || ('HTTP ' + res.status));
          if (window.AirReachOrchestrator && window.AirReachOrchestrator.importGscRows) {
            window.AirReachOrchestrator.importGscRows(data.rows || []);
            if (window.__orchLastJob && window.AirReachOrchestrator.reattachGscToJob) {
              window.__orchLastJob = window.AirReachOrchestrator.reattachGscToJob(window.__orchLastJob);
              if (window.AirReachOrchestrator.renderResult) window.AirReachOrchestrator.renderResult(window.__orchLastJob);
            }
          }
          if (syncMsg) {
            syncMsg.className = 'ars-note good';
            syncMsg.textContent = 'GSC同期完了: ' + (data.count || (data.rows && data.rows.length) || 0) + ' 行';
          }
        } catch (err) {
          if (syncMsg) {
            syncMsg.className = 'ars-note warn';
            syncMsg.textContent = 'API未接続または失敗のためCSVフォールバックを利用してください（' + (err && err.message ? err.message : err) + '）';
          }
        }
      });
    }
  }

  window.AirReachOrchPhase2 = {
    applyPlannerCsv: applyPlannerCsv,
    applyHack2Json: applyHack2Json,
    createDraftPr: createDraftPr
  };

  document.addEventListener('DOMContentLoaded', bind);
})();
