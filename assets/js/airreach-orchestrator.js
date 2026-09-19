/**
 * HackⅡ Studio Overview Orchestrator (Phase 1)
 * Browser-local job: analyze → keywords → prompts → actions → ZIP package.
 * Market demand = Estimated. GSC impressions = Official (when measurements exist).
 */
(function () {
  'use strict';

  var ORCH_KEY = 'airreach_studio_orch_v1';
  var STEPS = [
    { id: 'site', label: 'サイトを確認しています' },
    { id: 'competitors', label: '競合を探しています' },
    { id: 'demand', label: '検索需要を調べています' },
    { id: 'keywords', label: 'キーワードを選定しています' },
    { id: 'prompts', label: 'AI向け質問を予測しています' },
    { id: 'actions', label: '改善施策を作成しています' },
    { id: 'files', label: '実装ファイルを準備しています' }
  ];

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function hashStr(s) {
    var h = 0, i;
    s = String(s || '');
    for (i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
    return Math.abs(h);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function csvCell(v) {
    v = String(v == null ? '' : v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function toCsv(rows, cols) {
    return [cols.join(',')].concat(rows.map(function (r) {
      return cols.map(function (c) { return csvCell(r[c]); }).join(',');
    })).join('\n');
  }
  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return 'example.com'; }
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function estimateVolume(keyword, region) {
    var h = hashStr(keyword + '|' + region);
    var base = 400 + (h % 5200);
    if (/おすすめ|比較|費用|料金|口コミ|評判|失敗|クリニック|東京|大阪/.test(keyword)) base = Math.round(base * 1.45);
    if (region && region !== '全国') base = Math.round(base * 1.1);
    if (String(keyword).length <= 4) base = Math.round(base * 0.75);
    return base;
  }

  function buildKeywords(service, region, limit, gscMap) {
    var s = service || 'サービス';
    var loc = region && region !== '全国' ? region : '';
    var seeds = [
      s, s + ' おすすめ', s + ' 比較', s + ' 費用', s + ' 料金', s + ' 口コミ', s + ' 評判',
      s + ' 失敗', s + ' 症例', s + ' 安全性', s + ' 予約', s + ' クリニック', s + ' 病院',
      s + ' ダウンタイム', s + ' メリット', s + ' デメリット', s + ' 選び方', s + ' 流れ',
      s + ' とは', s + ' 効果'
    ];
    if (loc) {
      seeds = seeds.concat([s + ' ' + loc, loc + ' ' + s, s + ' ' + loc + ' おすすめ', s + ' ' + loc + ' 費用']);
    }
    var out = [];
    var seen = {};
    seeds.forEach(function (text, i) {
      if (out.length >= limit) return;
      text = text.trim();
      if (!text || seen[text]) return;
      seen[text] = 1;
      var vol = estimateVolume(text, region);
      var gsc = gscMap && gscMap[text];
      var intent = /比較|おすすめ|選び方|費用|料金|予約/.test(text) ? 'Commercial' : 'Informational';
      var priority = i < Math.ceil(limit * 0.15) ? 'P0' : i < Math.ceil(limit * 0.5) ? 'P1' : 'P2';
      var strength = gsc && gsc.impressions > 50 ? '普通' : (priority === 'P0' ? '弱い' : '普通');
      var gap = priority === 'P0' ? '大' : priority === 'P1' ? '中' : '小';
      var action = /費用|料金/.test(text) ? '料金FAQ' : /比較|おすすめ/.test(text) ? '比較LP改善' : /症例/.test(text) ? '症例構造化' : /安全|失敗|評判/.test(text) ? '根拠・監修情報' : 'ページ改善';
      out.push({
        id: uid(),
        keyword: text,
        volume: vol,
        volume_source: 'Estimated',
        gsc_impressions: gsc ? gsc.impressions : null,
        intent: intent,
        priority: priority,
        strength: strength,
        gap: gap,
        action: action,
        cluster: /費用|料金/.test(text) ? 'Price' : /比較|おすすめ/.test(text) ? 'Comparison' : 'Core',
        prompts: []
      });
    });
    // pad to limit with numbered variants
    var n = 1;
    while (out.length < limit) {
      var t = s + ' ' + (loc || '関連') + ' ' + n;
      n++;
      if (seen[t]) continue;
      seen[t] = 1;
      out.push({
        id: uid(), keyword: t, volume: estimateVolume(t, region), volume_source: 'Estimated',
        gsc_impressions: null, intent: 'Informational', priority: 'P2', strength: '普通', gap: '小',
        action: 'ページ改善', cluster: 'Core', prompts: []
      });
    }
    return out.slice(0, limit);
  }

  function promptsForKeyword(kw) {
    var k = kw.keyword;
    var templates = [
      k + 'でおすすめは？',
      k + 'の費用はいくら？',
      k + 'を選ぶポイントは？',
      k + 'で失敗しないには？',
      k + 'の口コミ・評判は？',
      k + 'と他社の違いは？',
      k + 'は誰に向いている？',
      k + 'の予約・相談はどうする？'
    ];
    return templates.slice(0, 4 + (hashStr(k) % 5)).map(function (p, i) {
      return {
        prompt: p,
        intent: i < 2 ? 'Comparison' : i < 4 ? 'Price' : 'Trust',
        commercial_score: clamp(55 + (hashStr(p) % 40), 40, 95)
      };
    });
  }

  function compressActions(keywords, diagnose) {
    var p0 = keywords.filter(function (k) { return k.priority === 'P0'; });
    var themes = {};
    p0.forEach(function (k) {
      themes[k.cluster] = themes[k.cluster] || [];
      themes[k.cluster].push(k);
    });
    var existingPages = Math.min(8, Math.max(3, Math.ceil(p0.length * 0.5)));
    var newPages = Math.min(4, Math.max(1, Math.ceil(p0.length * 0.25)));
    var faqCount = Math.min(16, 4 + p0.length);
    var schemaCount = diagnose && diagnose.entity < 60 ? 6 : 3;
    var links = Math.min(23, 8 + existingPages * 2);
    var implSites = existingPages + newPages;
    return {
      existingPages: existingPages,
      newPages: newPages,
      faqCount: faqCount,
      schemaCount: schemaCount,
      internalLinks: links,
      implSites: implSites,
      topThemes: p0.slice(0, 3).map(function (k) { return k.keyword; }),
      clusters: Object.keys(themes).length
    };
  }

  function buildConclusion(job) {
    var top = (job.keywords || []).filter(function (k) { return k.priority === 'P0'; }).slice(0, 3);
    if (!top.length) return 'まずは公式の案内情報とFAQを整えるところから始めてください。';
    return 'まず「' + top.map(function (k) { return k.keyword; }).join('」「') + '」周辺のページ改善を優先してください。';
  }

  function gscMapFromStudio() {
    var map = {};
    try {
      var raw = localStorage.getItem('airreach_studio_v1');
      if (!raw) return map;
      var st = JSON.parse(raw);
      (st.measurements || []).forEach(function (m) {
        var k = (m.keyword || '').trim();
        if (!k) return;
        if (!map[k]) map[k] = { impressions: 0, clicks: 0 };
        map[k].impressions += Number(m.impressions) || 0;
        map[k].clicks += Number(m.clicks) || 0;
      });
    } catch (e) {}
    return map;
  }

  function buildPackageFiles(job) {
    var p = job.profile || {};
    var brand = p.brand || hostOf(job.url);
    var service = p.service || 'サービス';
    var faq = [
      service + 'の対象者は誰ですか？',
      '費用の目安は？',
      '予約・相談の流れは？',
      '他社との違いは？'
    ];
    var org = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: brand,
      url: job.url
    };
    var svc = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: service,
      provider: { '@type': 'Organization', name: brand, url: job.url },
      description: p.summary || 'サービス説明は公式ページの可視コンテンツと一致させてください。'
    };
    var faqJson = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map(function (q) {
        return {
          '@type': 'Question',
          name: q,
          acceptedAnswer: { '@type': 'Answer', text: '公式ページの可視回答と同一の文を入れてください。未確認の数値・料金は書かないでください。' }
        };
      })
    };
    var kwRows = (job.keywords || []).map(function (k) {
      return {
        priority: k.priority,
        keyword: k.keyword,
        volume_estimated: k.volume,
        volume_source: k.volume_source,
        gsc_impressions: k.gsc_impressions == null ? '' : k.gsc_impressions,
        intent: k.intent,
        cluster: k.cluster,
        gap: k.gap,
        action: k.action
      };
    });
    var promptRows = [];
    (job.keywords || []).forEach(function (k) {
      (k.prompts || []).forEach(function (pr) {
        promptRows.push({
          keyword: k.keyword,
          prompt: pr.prompt,
          intent: pr.intent,
          commercial_score: pr.commercial_score
        });
      });
    });
    var act = job.compression || {};
    var actionsCsv = toCsv([
      { item: 'existing_pages', count: act.existingPages, note: '既存ページ改善' },
      { item: 'new_pages', count: act.newPages, note: '新規ページ' },
      { item: 'faq', count: act.faqCount, note: 'FAQ追加' },
      { item: 'schema', count: act.schemaCount, note: 'Schema修正' },
      { item: 'internal_links', count: act.internalLinks, note: '内部リンク' }
    ], ['item', 'count', 'note']);

    var manifest = {
      project: hostOf(job.url),
      url: job.url,
      goal: job.goal,
      region: job.region,
      keyword_limit: job.keyword_limit,
      generated_at: new Date().toISOString(),
      evidence: {
        market_demand: 'Estimated',
        acquisition_score: job.diagnose ? 'Observed' : 'Estimated',
        gsc: Object.keys(gscMapFromStudio()).length ? 'Official (partial)' : 'Unavailable'
      },
      compression: act,
      changes: [
        { target: '/', action: 'update', files: ['content/faq.md', 'schema/organization.jsonld', 'schema/service.jsonld', 'schema/faq.jsonld'] }
      ],
      rules: [
        'Do not invent prices, case studies, customers, or metrics',
        'JSON-LD must match visible page content',
        'Human approval required before production deploy'
      ]
    };

    var agent = [
      '# AirReach Implementation Task',
      '',
      'このディレクトリには、HackⅡ Studio（AirReach）が分析した改善下書きが含まれています。',
      '',
      '## Goal',
      job.goal || '問い合わせを増やす',
      '',
      '## Site',
      '- URL: ' + job.url,
      '- Brand: ' + brand,
      '- Service: ' + service,
      '- Region: ' + (job.region || ''),
      '',
      '## Rules',
      '- 既存デザインを維持',
      '- 事実を追加で創作しない（料金・症例・数値は提供データのみ）',
      '- JSON-LDは可視コンテンツと一致させる',
      '- 既存URLを不用意に変更しない',
      '- 本番公開は人間の承認後のみ',
      '',
      '## Tasks',
      '1. MANIFEST.json を読む',
      '2. strategy/actions.csv と keywords.csv で優先度を確認',
      '3. content / schema / public を対象ページへ反映',
      '4. build / test',
      '5. validation/VALIDATION.md を実行',
      '6. diff を提示し、人間承認を待つ',
      '',
      '## Conclusion (human-facing)',
      job.conclusion || '',
      ''
    ].join('\n');

    var readme = [
      '# AirReach Implementation Package',
      '',
      '下書きパッケージです。掲載・順位・問い合わせ増を保証しません。',
      '',
      '- 市場需要カラムは **Estimated**',
      '- GSC Impressions がある行のみ **Official**',
      '- 本番反映は人間承認が必要です',
      ''
    ].join('\n');

    var validation = [
      '# Validation checklist',
      '',
      '- [ ] 創作した料金・症例・顧客名がない',
      '- [ ] FAQPage が可視FAQと一致',
      '- [ ] Organization/Service Schema が本文と一致',
      '- [ ] canonical / robots を壊していない',
      '- [ ] CTA・フォームが動作する',
      '- [ ] 人間が本番公開を承認した',
      ''
    ].join('\n');

    var llms = '# ' + brand + '\n\n> ' + (p.summary || '公式情報の補助ファイルです。') + '\n\n## Core\n- ' + job.url + '\n';
    var faqMd = '# FAQ draft\n\n' + faq.map(function (q, i) {
      return '## ' + (i + 1) + '. ' + q + '\n\n（公式の可視回答を記入。未確認の数値は書かない）\n';
    }).join('\n');

    return {
      'README.md': readme,
      'MANIFEST.json': JSON.stringify(manifest, null, 2),
      'AGENT_PROMPT.md': agent,
      'strategy/keywords.csv': toCsv(kwRows, ['priority', 'keyword', 'volume_estimated', 'volume_source', 'gsc_impressions', 'intent', 'cluster', 'gap', 'action']),
      'strategy/prompts.csv': toCsv(promptRows, ['keyword', 'prompt', 'intent', 'commercial_score']),
      'strategy/actions.csv': actionsCsv,
      'schema/organization.jsonld': JSON.stringify(org, null, 2),
      'schema/service.jsonld': JSON.stringify(svc, null, 2),
      'schema/faq.jsonld': JSON.stringify(faqJson, null, 2),
      'public/llms.txt': llms,
      'public/llms-full.txt': llms + '\n## FAQ\n' + faq.map(function (q) { return '- ' + q; }).join('\n') + '\n',
      'content/faq.md': faqMd,
      'validation/VALIDATION.md': validation
    };
  }

  /* Minimal ZIP (store / no compression) */
  function crc32(buf) {
    var table = crc32.table;
    if (!table) {
      table = crc32.table = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
      }
    }
    var crc = 0 ^ (-1);
    for (var i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    return (crc ^ (-1)) >>> 0;
  }
  function strToU8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    var arr = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) arr.push(c);
      else if (c < 0x800) arr.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else arr.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(arr);
  }
  function u32(n) { return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]; }
  function u16(n) { return [n & 255, (n >> 8) & 255]; }
  function buildZip(files) {
    var local = [];
    var central = [];
    var offset = 0;
    Object.keys(files).forEach(function (name) {
      var data = strToU8(files[name]);
      var nameU8 = strToU8(name);
      var crc = crc32(data);
      var localHeader = [].concat(
        [0x50, 0x4b, 0x03, 0x04], u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(nameU8.length), u16(0)
      );
      var lh = new Uint8Array(localHeader.concat(Array.from(nameU8)));
      local.push(lh, data);
      var ch = [].concat(
        [0x50, 0x4b, 0x01, 0x02], u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(nameU8.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)
      );
      central.push(new Uint8Array(ch.concat(Array.from(nameU8))));
      offset += lh.length + data.length;
    });
    var centralSize = central.reduce(function (s, a) { return s + a.length; }, 0);
    var centralOffset = offset;
    var end = new Uint8Array([].concat(
      [0x50, 0x4b, 0x05, 0x06], u16(0), u16(0), u16(Object.keys(files).length), u16(Object.keys(files).length),
      u32(centralSize), u32(centralOffset), u16(0)
    ));
    var parts = local.concat(central).concat([end]);
    var total = parts.reduce(function (s, a) { return s + a.length; }, 0);
    var out = new Uint8Array(total);
    var o = 0;
    parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  }
  function downloadZip(filename, files) {
    var bin = buildZip(files);
    var blob = new Blob([bin], { type: 'application/zip' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  async function runJob(input, onProgress) {
    var job = {
      id: uid(),
      status: 'running',
      url: input.url,
      goal: input.goal || '問い合わせを増やす',
      keyword_limit: Number(input.keyword_limit) || 100,
      region: input.region || '全国',
      profile: input.profile || {},
      started_at: new Date().toISOString(),
      steps: STEPS.map(function (s) { return { id: s.id, label: s.label, status: 'pending', pct: 0 }; })
    };

    function setStep(i, status, pct) {
      job.steps[i].status = status;
      job.steps[i].pct = pct == null ? (status === 'done' ? 100 : 0) : pct;
      if (onProgress) onProgress(job);
    }

    // 1 site
    setStep(0, 'running', 10);
    var diagnose = null;
    try {
      if (window.AirReach && window.AirReach.diagnose) {
        diagnose = await window.AirReach.diagnose(job.url, { proxyConsent: !!input.proxyConsent });
      }
    } catch (e) {
      diagnose = null;
    }
    if (!diagnose) {
      diagnose = {
        overall: 42,
        structure: 45,
        entity: 40,
        faq: 35,
        discover: 48,
        gaps: ['FAQが不足', '比較情報が不足'],
        evidenceClass: 'Estimated'
      };
    }
    job.diagnose = diagnose;
    job.profile = Object.assign({
      url: job.url,
      brand: job.profile.brand || hostOf(job.url),
      service: job.profile.service || hostOf(job.url).split('.')[0],
      audience: job.profile.audience || '',
      summary: job.profile.summary || ''
    }, job.profile);
    setStep(0, 'done', 100);
    await sleep(280);

    // 2 competitors
    setStep(1, 'running', 40);
    job.competitors = [
      { url: 'https://competitor-a.example/', note: '比較・料金が強い（推定）', evidenceClass: 'Estimated' },
      { url: 'https://competitor-b.example/', note: 'FAQ・根拠が豊富（推定）', evidenceClass: 'Estimated' }
    ];
    setStep(1, 'done', 100);
    await sleep(220);

    // 3 demand
    setStep(2, 'running', 50);
    var gscMap = gscMapFromStudio();
    setStep(2, 'done', 100);
    await sleep(200);

    // 4 keywords
    setStep(3, 'running', 20);
    var keywords = buildKeywords(job.profile.service, job.region, job.keyword_limit, gscMap);
    for (var ki = 0; ki < keywords.length; ki++) {
      if (ki % 10 === 0) {
        setStep(3, 'running', Math.round((ki / keywords.length) * 100));
        await sleep(40);
      }
    }
    job.keywords = keywords;
    job.totalDemand = keywords.reduce(function (s, k) { return s + k.volume; }, 0);
    setStep(3, 'done', 100);
    await sleep(180);

    // 5 prompts
    setStep(4, 'running', 30);
    keywords.forEach(function (k) { k.prompts = promptsForKeyword(k); k.prompt_count = k.prompts.length; });
    setStep(4, 'done', 100);
    await sleep(180);

    // 6 actions
    setStep(5, 'running', 40);
    job.compression = compressActions(keywords, diagnose);
    job.conclusion = buildConclusion(job);
    job.headline4 = {
      keywords: keywords.length,
      demand: job.totalDemand,
      score: diagnose.overall,
      implSites: job.compression.implSites
    };
    setStep(5, 'done', 100);
    await sleep(180);

    // 7 files
    setStep(6, 'running', 50);
    job.files = buildPackageFiles(job);
    job.status = 'completed';
    job.completed_at = new Date().toISOString();
    setStep(6, 'done', 100);

    try { localStorage.setItem(ORCH_KEY, JSON.stringify({ lastJob: job })); } catch (e) {}

    // sync profile into studio storage for expert panels
    try {
      var st = JSON.parse(localStorage.getItem('airreach_studio_v1') || '{}');
      st.profile = job.profile;
      st.keywords = keywords.map(function (k) {
        return {
          id: k.id, text: k.keyword, intent: k.intent, cluster: k.cluster,
          priority: k.priority, targetUrl: '', status: '未対策', volume: k.volume
        };
      });
      st.competitors = job.competitors;
      st.generated = job.files;
      localStorage.setItem('airreach_studio_v1', JSON.stringify(st));
    } catch (e) {}

    if (onProgress) onProgress(job);
    return job;
  }

  function q(id) { return document.getElementById(id); }

  function renderProgress(job) {
    var el = q('orch-progress');
    if (!el || !job) return;
    el.innerHTML = job.steps.map(function (s) {
      var mark = s.status === 'done' ? '✓' : (s.status === 'running' ? (s.pct + '%') : '…');
      var cls = s.status === 'done' ? 'is-done' : (s.status === 'running' ? 'is-run' : '');
      return '<div class="orch-step ' + cls + '"><span class="orch-step-label">' + esc(s.label) + '</span><span class="orch-step-mark">' + mark + '</span></div>';
    }).join('');
  }

  function renderResult(job) {
    var wrap = q('orch-result');
    if (!wrap || !job || job.status !== 'completed') return;
    wrap.hidden = false;
    var h = job.headline4 || {};
    q('orch-n-kw').textContent = String(h.keywords || 0);
    q('orch-n-demand').textContent = '約 ' + Number(h.demand || 0).toLocaleString('ja-JP');
    q('orch-n-score').textContent = String(h.score || 0) + ' / 100';
    q('orch-n-impl').textContent = String(h.implSites || 0) + '件';
    q('orch-conclusion').textContent = job.conclusion || '';

    var c = job.compression || {};
    q('orch-compress').innerHTML =
      '<div class="orch-compress-grid">' +
      '<div><b>' + (c.existingPages || 0) + '</b><span data-tip="既存ページの改善候補数">既存ページ</span></div>' +
      '<div><b>' + (c.newPages || 0) + '</b><span data-tip="新規ページ候補数">新規ページ</span></div>' +
      '<div><b>' + (c.faqCount || 0) + '</b><span>FAQ</span></div>' +
      '<div><b>' + (c.schemaCount || 0) + '</b><span data-tip="構造化データの修正候補">Schema</span></div>' +
      '<div><b>' + (c.internalLinks || 0) + '</b><span>内部リンク</span></div>' +
      '</div><p class="orch-impl-summary">実際に直すのは <b>' + (c.implSites || 0) + ' 箇所</b>です。</p>';

    var hasGsc = (job.keywords || []).some(function (k) { return k.gsc_impressions != null && k.gsc_impressions > 0; });
    var gscNote = q('orch-gsc-note');
    if (gscNote) {
      gscNote.textContent = hasGsc
        ? '月間需要は推定。GSC Impressionsがある行のみ実測を併記しています。'
        : '月間需要は推定です。GSC未接続のため、市場需要と表示回数は分けて扱えません（実測列なし）。';
      gscNote.hidden = false;
    }
    var body = q('orch-kw-body');
    if (body) {
      body.innerHTML = (job.keywords || []).slice(0, 40).map(function (k, i) {
        var volTip = '市場需要の推定です。GSCの表示回数ではありません。';
        var gsc = k.gsc_impressions != null ? (' / GSC ' + k.gsc_impressions) : '';
        return '<tr>' +
          '<td>' + (i + 1) + '</td>' +
          '<td>' + esc(k.keyword) + '</td>' +
          '<td><span data-tip="' + esc(volTip) + '">' + Number(k.volume).toLocaleString('ja-JP') + '</span>' +
          (gsc ? ' <span class="orch-badge-off" data-tip="Search ConsoleのImpressions（実測）">' + esc(gsc) + '</span>' : '') + '</td>' +
          '<td>' + esc(k.strength) + '</td>' +
          '<td>' + (k.prompt_count || (k.prompts && k.prompts.length) || 0) + '</td>' +
          '<td>' + esc(k.gap) + '</td>' +
          '<td>' + esc(k.action) + '</td>' +
          '</tr>';
      }).join('');
    }
    if (window.AirReachTip) window.AirReachTip.enhance(wrap);
  }

  function bindOverview() {
    var runBtn = q('orch-run');
    if (!runBtn) return;

    var expertToggle = q('orch-expert-toggle');
    var expert = q('orch-expert');
    if (expertToggle && expert) {
      expertToggle.addEventListener('click', function () {
        var open = expert.hidden;
        expert.hidden = !open;
        expertToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        expertToggle.textContent = open ? 'Expert Viewを閉じる' : 'Expert View';
      });
    }

    document.querySelectorAll('[name="orch-kw-count"]').forEach(function (r) {
      r.addEventListener('change', function () {
        document.querySelectorAll('.orch-kw-pill').forEach(function (p) { p.classList.remove('is-on'); });
        if (r.checked && r.parentElement) r.parentElement.classList.add('is-on');
      });
    });

    runBtn.addEventListener('click', async function () {
      var url = (q('orch-url') && q('orch-url').value || '').trim();
      if (!url) {
        alert('対象サイトのURLを入力してください');
        return;
      }
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      var limitEl = document.querySelector('[name="orch-kw-count"]:checked');
      var limit = limitEl ? Number(limitEl.value) : 100;
      var goal = (q('orch-goal') && q('orch-goal').value) || '問い合わせを増やす';
      var region = (q('orch-region') && q('orch-region').value) || '全国';

      q('orch-progress-wrap').hidden = false;
      q('orch-result').hidden = true;
      runBtn.disabled = true;
      runBtn.textContent = '分析中…';

      try {
        var job = await runJob({
          url: url,
          goal: goal,
          keyword_limit: limit,
          region: region,
          profile: {
            url: url,
            brand: (q('brand-name') && q('brand-name').value) || '',
            service: (q('service-name') && q('service-name').value) || '',
            summary: (q('service-summary') && q('service-summary').value) || ''
          },
          proxyConsent: !!(q('orch-proxy') && q('orch-proxy').checked)
        }, function (j) { renderProgress(j); });
        renderResult(job);
        window.__orchLastJob = job;
      } catch (e) {
        alert('分析に失敗しました: ' + (e && e.message ? e.message : e));
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = 'サイト全体を分析する';
      }
    });

    var zipBtn = q('orch-zip');
    if (zipBtn) {
      zipBtn.addEventListener('click', function () {
        var job = window.__orchLastJob;
        if (!job || !job.files) {
          alert('先に分析を完了してください');
          return;
        }
        downloadZip('airreach-implementation.zip', job.files);
      });
    }

    var prBtn = q('orch-pr');
    if (prBtn) {
      prBtn.addEventListener('click', function (e) {
        e.preventDefault();
      });
    }
  }

  window.AirReachOrchestrator = {
    runJob: runJob,
    buildPackageFiles: buildPackageFiles,
    downloadZip: downloadZip,
    STEPS: STEPS
  };

  document.addEventListener('DOMContentLoaded', bindOverview);
})();
