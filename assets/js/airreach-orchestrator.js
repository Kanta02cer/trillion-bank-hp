/**
 * HackⅡ Studio Overview Orchestrator (Phase 1+)
 * Browser-local job: analyze → keywords → prompts → actions → ZIP package.
 * Market demand = Estimated. GSC impressions = Official (when CSV / measurements exist).
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

  var uiState = { filter: 'all', shown: 40 };

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function prioRank(p) {
    if (p === 'P0') return 0;
    if (p === 'P1') return 1;
    if (p === 'P2') return 2;
    return 9;
  }
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
  function normKw(s) {
    return String(s || '').toLowerCase().replace(/[\s　]+/g, '').trim();
  }
  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  function parseCsv(text) {
    var rows = [], row = [], cur = '', quote = false, i, ch, nx;
    text = String(text || '').replace(/^\uFEFF/, '');
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      nx = text[i + 1];
      if (ch === '"' && quote && nx === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { quote = !quote; continue; }
      if ((ch === ',' || ch === '\t') && !quote) { row.push(cur); cur = ''; continue; }
      if ((ch === '\n' || ch === '\r') && !quote) {
        if (ch === '\r' && nx === '\n') i++;
        row.push(cur);
        if (row.some(function (x) { return x !== ''; })) rows.push(row);
        row = [];
        cur = '';
        continue;
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

  function estimateVolume(keyword, region) {
    var h = hashStr(keyword + '|' + region);
    var base = 400 + (h % 5200);
    if (/おすすめ|比較|費用|料金|口コミ|評判|失敗|クリニック|東京|大阪/.test(keyword)) base = Math.round(base * 1.45);
    if (region && region !== '全国') base = Math.round(base * 1.1);
    if (String(keyword).length <= 4) base = Math.round(base * 0.75);
    return base;
  }

  function gscMapFromMeasurements(measurements) {
    var map = {};
    (measurements || []).forEach(function (m) {
      var k = normKw(m.keyword || m.query || '');
      if (!k) return;
      if (!map[k]) map[k] = { keyword: (m.keyword || m.query || '').trim(), impressions: 0, clicks: 0, positionSum: 0, positionWeight: 0 };
      map[k].impressions += Number(m.impressions) || 0;
      map[k].clicks += Number(m.clicks) || 0;
      var pos = Number(m.position) || 0;
      var w = Math.max(1, Number(m.impressions) || 1);
      if (pos > 0) {
        map[k].positionSum += pos * w;
        map[k].positionWeight += w;
      }
    });
    return map;
  }

  function gscMapFromStudio() {
    try {
      if (window.AirReachStudio && window.AirReachStudio.getState) {
        return gscMapFromMeasurements(window.AirReachStudio.getState().measurements || []);
      }
      var raw = localStorage.getItem('airreach_studio_v1');
      if (!raw) return {};
      var st = JSON.parse(raw);
      return gscMapFromMeasurements(st.measurements || []);
    } catch (e) {
      return {};
    }
  }

  function lookupGsc(gscMap, keyword) {
    if (!gscMap) return null;
    var key = normKw(keyword);
    if (gscMap[key]) return gscMap[key];
    var best = null;
    var bestScore = 0;
    Object.keys(gscMap).forEach(function (gk) {
      if (!gk) return;
      if (gk === key || key.indexOf(gk) !== -1 || gk.indexOf(key) !== -1) {
        var score = gscMap[gk].impressions + (gk === key ? 1e9 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = gscMap[gk];
        }
      }
    });
    return best;
  }

  function attachGsc(keywords, gscMap) {
    (keywords || []).forEach(function (k) {
      var g = lookupGsc(gscMap, k.keyword);
      if (g && g.impressions > 0) {
        k.gsc_impressions = Math.round(g.impressions);
        k.gsc_clicks = Math.round(g.clicks || 0);
        k.gsc_position = g.positionWeight ? Math.round((g.positionSum / g.positionWeight) * 10) / 10 : null;
        if (k.gsc_impressions > 50) k.strength = '普通';
        if (k.gsc_impressions > 200 && k.priority === 'P2') k.priority = 'P1';
      }
    });
    return keywords;
  }

  function serviceFromText(text) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    text = text.split(/[|\-–—｜・]/)[0].trim();
    text = text.replace(/公式サイト|オフィシャル|ホームページ|株式会社|有限会社/g, '').trim();
    if (text.length > 28) text = text.slice(0, 28).trim();
    return text;
  }

  function profileFromDiagnose(diagnose, url, hint) {
    hint = hint || {};
    var page = (diagnose && diagnose.page) || {};
    var brand = hint.brand || '';
    var service = hint.service || '';
    if (!brand) brand = serviceFromText(page.title) || hostOf(url);
    if (!service) {
      service = serviceFromText(page.h1) || serviceFromText(page.title) || hostOf(url).split('.')[0];
    }
    return {
      url: url,
      brand: brand,
      service: service,
      audience: hint.audience || '',
      summary: hint.summary || (page.h1 ? String(page.h1) : '')
    };
  }

  function buildKeywords(service, region, limit, gscMap) {
    var s = service || 'サービス';
    var loc = region && region !== '全国' && region !== '指定' ? region : '';
    var seeds = [
      s, s + ' おすすめ', s + ' 比較', s + ' 費用', s + ' 料金', s + ' 口コミ', s + ' 評判',
      s + ' 失敗', s + ' 症例', s + ' 安全性', s + ' 予約', s + ' クリニック', s + ' 病院',
      s + ' ダウンタイム', s + ' メリット', s + ' デメリット', s + ' 選び方', s + ' 流れ',
      s + ' とは', s + ' 効果'
    ];
    if (loc) {
      seeds = seeds.concat([s + ' ' + loc, loc + ' ' + s, s + ' ' + loc + ' おすすめ', s + ' ' + loc + ' 費用']);
    }

    // Real GSC queries become first-class keyword seeds (Official impressions).
    var gscSeeds = Object.keys(gscMap || {}).map(function (k) {
      return gscMap[k];
    }).filter(function (g) {
      return g && g.impressions > 0 && g.keyword;
    }).sort(function (a, b) {
      return b.impressions - a.impressions;
    }).slice(0, Math.min(40, Math.ceil(limit * 0.45)));

    gscSeeds.forEach(function (g) {
      seeds.unshift(g.keyword);
    });

    var out = [];
    var seen = {};
    seeds.forEach(function (text) {
      if (out.length >= limit) return;
      text = String(text || '').trim();
      var nk = normKw(text);
      if (!nk || seen[nk]) return;
      seen[nk] = 1;
      var gsc = lookupGsc(gscMap, text);
      var vol = estimateVolume(text, region);
      var intent = /比較|おすすめ|選び方|費用|料金|予約/.test(text) ? 'Commercial' : 'Informational';
      var fromGsc = !!(gsc && gsc.impressions > 0);
      var priority = fromGsc && gsc.impressions >= 200 ? 'P0' : (fromGsc ? 'P1' : 'P2');
      if (/比較|おすすめ|費用|料金/.test(text) && priority === 'P2') priority = 'P1';
      if (!fromGsc && out.filter(function (x) { return x.priority === 'P0'; }).length < Math.ceil(limit * 0.12) && /おすすめ|比較|費用|料金|口コミ/.test(text)) {
        priority = 'P0';
      }
      var strength = fromGsc && gsc.impressions > 50 ? '普通' : (priority === 'P0' ? '弱い' : '普通');
      var gap = priority === 'P0' ? '大' : priority === 'P1' ? '中' : '小';
      var action = /費用|料金/.test(text) ? '料金FAQ' : /比較|おすすめ/.test(text) ? '比較LP改善' : /症例/.test(text) ? '症例構造化' : /安全|失敗|評判/.test(text) ? '根拠・監修情報' : 'ページ改善';
      out.push({
        id: uid(),
        keyword: text,
        volume: vol,
        volume_source: 'Estimated',
        gsc_impressions: fromGsc ? Math.round(gsc.impressions) : null,
        gsc_clicks: fromGsc ? Math.round(gsc.clicks || 0) : null,
        gsc_position: fromGsc && gsc.positionWeight ? Math.round((gsc.positionSum / gsc.positionWeight) * 10) / 10 : null,
        intent: intent,
        priority: priority,
        strength: strength,
        gap: gap,
        action: action,
        cluster: /費用|料金/.test(text) ? 'Price' : /比較|おすすめ/.test(text) ? 'Comparison' : 'Core',
        seed_source: fromGsc ? 'GSC' : 'Generated',
        prompts: []
      });
    });

    var n = 1;
    while (out.length < limit) {
      var t = s + ' ' + (loc || '関連') + ' ' + n;
      n++;
      var nk2 = normKw(t);
      if (seen[nk2]) continue;
      seen[nk2] = 1;
      out.push({
        id: uid(), keyword: t, volume: estimateVolume(t, region), volume_source: 'Estimated',
        gsc_impressions: null, gsc_clicks: null, gsc_position: null,
        intent: 'Informational', priority: 'P2', strength: '普通', gap: '小',
        action: 'ページ改善', cluster: 'Core', seed_source: 'Generated', prompts: []
      });
    }

    out.sort(function (a, b) {
      var pr = prioRank(a.priority) - prioRank(b.priority);
      if (pr) return pr;
      var gi = (b.gsc_impressions || 0) - (a.gsc_impressions || 0);
      if (gi) return gi;
      return (b.volume || 0) - (a.volume || 0);
    });
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
    var existingPages = Math.min(8, Math.max(3, Math.ceil(p0.length * 0.5) || 3));
    var newPages = Math.min(4, Math.max(1, Math.ceil(p0.length * 0.25) || 1));
    var faqCount = Math.min(16, 4 + Math.max(p0.length, 2));
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
    if (!top.length) top = (job.keywords || []).slice(0, 3);
    if (!top.length) return 'まずは公式の案内情報とFAQを整えるところから始めてください。';
    var gscN = (job.keywords || []).filter(function (k) { return k.gsc_impressions != null && k.gsc_impressions > 0; }).length;
    var base = 'まず「' + top.map(function (k) { return k.keyword; }).join('」「') + '」周辺のページ改善を優先してください。';
    if (gscN) base += ' GSC実測が付いているキーワードから着手すると判断が速くなります。';
    return base;
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
      provider: { '@type': 'Organization', name: brand, url: job.url }
    };
    var faqLd = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map(function (q) {
        return {
          '@type': 'Question',
          name: q,
          acceptedAnswer: { '@type': 'Answer', text: '（下書き）公開前に事実確認してください。' }
        };
      })
    };

    var kwRows = (job.keywords || []).map(function (k) {
      return {
        priority: k.priority,
        keyword: k.keyword,
        volume: k.volume,
        volume_source: k.volume_source,
        gsc_impressions: k.gsc_impressions == null ? '' : k.gsc_impressions,
        gsc_clicks: k.gsc_clicks == null ? '' : k.gsc_clicks,
        ai_mention_rate: k.ai_mention_rate == null ? '' : k.ai_mention_rate,
        ai_citation_rate: k.ai_citation_rate == null ? '' : k.ai_citation_rate,
        intent: k.intent,
        cluster: k.cluster,
        gap: k.gap,
        action: k.action,
        seed_source: k.seed_source || ''
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
    var c = job.compression || {};
    var actionRows = [
      { type: 'existing_page', count: c.existingPages || 0, note: '既存ページ改善' },
      { type: 'new_page', count: c.newPages || 0, note: '新規ページ候補' },
      { type: 'faq', count: c.faqCount || 0, note: 'FAQ追加' },
      { type: 'schema', count: c.schemaCount || 0, note: 'JSON-LD整備' },
      { type: 'internal_link', count: c.internalLinks || 0, note: '内部リンク' }
    ];

    var gscKeys = Object.keys(gscMapFromStudio()).length;
    var manifest = {
      generated_at: new Date().toISOString(),
      url: job.url,
      goal: job.goal,
      brand: brand,
      service: service,
      keyword_count: (job.keywords || []).length,
      evidence: {
        market_demand: (job.keywords || []).some(function (k) { return k.volume_source === 'Official'; }) ? 'Official (partial) + Estimated' : 'Estimated',
        acquisition_score: job.diagnose_source === 'Observed' ? 'Observed' : 'Estimated',
        gsc: gscKeys ? 'Official (partial)' : 'Unavailable',
        hack2: job.hack2_imported ? 'Observed (imported JSON)' : 'Unavailable',
        deployment: (job.deployment_run && job.deployment_run.pr_url) ? 'Draft PR awaiting human review' : 'ZIP only'
      },
      conclusion: job.conclusion || '',
      compression: c
    };

    var agent = [
      '# AGENT_PROMPT — HackⅡ Studio implementation draft',
      '',
      'You are helping implement AI-search readiness files for ' + brand + ' (' + job.url + ').',
      '',
      '## Hard rules',
      '- Do not invent prices, case studies, customers, rankings, or metrics.',
      '- JSON-LD must match visible page content.',
      '- Market demand volumes are Estimated by default; Official only when Keyword Planner CSV was applied (volume_source=Official).',
      '- GSC impressions (if present) are Official and must stay in a separate column from market demand.',
      '- HackⅡ mention/citation rates (if present) are Observed and must not be mixed into acquisition score.',
      '- Human approval is required before production publish. Do not open a PR or deploy automatically.',
      '',
      '## Goal',
      job.goal || '',
      '',
      '## Conclusion',
      job.conclusion || '',
      '',
      '## Priority themes',
      (c.topThemes || []).map(function (t) { return '- ' + t; }).join('\n') || '- (none)',
      '',
      '## Files in this package',
      '- strategy/*.csv — keyword / prompt / action tables',
      '- schema/*.jsonld — Organization / Service / FAQ drafts',
      '- public/llms.txt — machine-readable site index draft',
      '- content/faq.md — FAQ draft',
      '- validation/VALIDATION.md — checklist before publish'
    ].join('\n');

    var readme = [
      '# AirReach / HackⅡ Studio implementation package',
      '',
      'Generated: ' + manifest.generated_at,
      'Site: ' + job.url,
      'Service: ' + service,
      'Goal: ' + (job.goal || ''),
      '',
      'This package is a **draft**. It does not publish anything.',
      '',
      '## Directory layout',
      '',
      '```',
      'airreach-implementation/',
      '  README.md',
      '  MANIFEST.json',
      '  AGENT_PROMPT.md',
      '  strategy/keywords.csv',
      '  strategy/prompts.csv',
      '  strategy/actions.csv',
      '  schema/*.jsonld',
      '  public/llms.txt',
      '  public/llms-full.txt',
      '  content/faq.md',
      '  validation/VALIDATION.md',
      '```',
      '',
      '## Evidence',
      '',
      '- Market demand (`volume`): Estimated unless `volume_source=Official` (Keyword Planner CSV)',
      '- GSC impressions: Official, separate from market demand',
      '- Acquisition score: Observed diagnose or Estimated fallback',
      '- HackⅡ mention/citation: Observed JSON import only',
      '',
      '## Publish',
      '',
      'Human review required. No auto-merge and no production auto-deploy from Studio.',
      'See `validation/VALIDATION.md` and `MANIFEST.json`.'
    ].join('\n');

    var validationItems = (window.AirReachPackageSchema && window.AirReachPackageSchema.VALIDATION_ITEMS) || [
      '料金・事例・顧客名・数値の捏造がない',
      'FAQ回答を人間が事実確認した',
      'JSON-LDが公開文面と一致する',
      'llms.txtのリンクが解決する',
      'ステークホルダーが公開を承認した'
    ];
    var validation = [
      '# Validation checklist',
      '',
      'Studio does not auto-deploy. Complete every item before merge/publish.',
      ''
    ].concat(validationItems.map(function (item) { return '- [ ] ' + item; })).join('\n');

    var llms = [
      '# ' + brand,
      '',
      '> ' + (p.summary || service),
      '',
      '## Primary',
      '- Home: ' + job.url,
      '- Service: ' + service,
      '',
      '## Notes',
      '- Draft generated by HackⅡ Studio. Verify before publish.'
    ].join('\n');

    var faqMd = '# FAQ draft\n\n' + faq.map(function (q, i) {
      return '## Q' + (i + 1) + '. ' + q + '\n\n（下書き）公開前に事実確認してください。\n';
    }).join('\n');

    var files = {
      'README.md': readme,
      'MANIFEST.json': JSON.stringify(manifest, null, 2),
      'AGENT_PROMPT.md': agent,
      'strategy/keywords.csv': toCsv(kwRows, (window.AirReachPackageSchema && window.AirReachPackageSchema.KEYWORD_CSV_COLUMNS) || ['priority', 'keyword', 'volume', 'volume_source', 'gsc_impressions', 'gsc_clicks', 'ai_mention_rate', 'ai_citation_rate', 'intent', 'cluster', 'gap', 'action', 'seed_source']),
      'strategy/prompts.csv': toCsv(promptRows, (window.AirReachPackageSchema && window.AirReachPackageSchema.PROMPT_CSV_COLUMNS) || ['keyword', 'prompt', 'intent', 'commercial_score']),
      'strategy/actions.csv': toCsv(actionRows, (window.AirReachPackageSchema && window.AirReachPackageSchema.ACTION_CSV_COLUMNS) || ['type', 'count', 'note']),
      'schema/organization.jsonld': JSON.stringify(org, null, 2),
      'schema/service.jsonld': JSON.stringify(svc, null, 2),
      'schema/faq.jsonld': JSON.stringify(faqLd, null, 2),
      'public/llms.txt': llms,
      'public/llms-full.txt': llms + '\n## FAQ\n' + faq.map(function (q) { return '- ' + q; }).join('\n') + '\n',
      'content/faq.md': faqMd,
      'validation/VALIDATION.md': validation
    };
    if (window.AirReachPackageSchema && window.AirReachPackageSchema.validatePackageFiles) {
      var check = window.AirReachPackageSchema.validatePackageFiles(files);
      if (!check.ok) {
        console.warn('[AirReachPackage] blueprint validation failed', check);
      }
      files._validation = check;
    }
    return files;
  }

  function crc32(buf) {
    var table = crc32._t;
    if (!table) {
      table = crc32._t = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
      }
    }
    var crc = 0 ^ (-1);
    for (var i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    return (crc ^ (-1)) >>> 0;
  }
  function strToU8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0xD800 || c >= 0xE000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else {
        i++;
        var cp = 0x10000 + (((c & 0x3FF) << 10) | (s.charCodeAt(i) & 0x3FF));
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      }
    }
    return new Uint8Array(out);
  }
  function u32(n) { return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]; }
  function u16(n) { return [n & 255, (n >> 8) & 255]; }
  function buildZip(files) {
    var locals = [];
    var central = [];
    var offset = 0;
    Object.keys(files).forEach(function (name) {
      var data = strToU8(String(files[name] == null ? '' : files[name]));
      var nameU8 = strToU8(name);
      var crc = crc32(data);
      var local = [].concat(
        [0x50, 0x4b, 0x03, 0x04], u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(nameU8.length), u16(0)
      );
      var localArr = new Uint8Array(local.length + nameU8.length + data.length);
      localArr.set(local, 0);
      localArr.set(nameU8, local.length);
      localArr.set(data, local.length + nameU8.length);
      locals.push(localArr);
      var cen = [].concat(
        [0x50, 0x4b, 0x01, 0x02], u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(nameU8.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(offset)
      );
      var cenArr = new Uint8Array(cen.length + nameU8.length);
      cenArr.set(cen, 0);
      cenArr.set(nameU8, cen.length);
      central.push(cenArr);
      offset += localArr.length;
    });
    var centralSize = central.reduce(function (s, a) { return s + a.length; }, 0);
    var end = [].concat(
      [0x50, 0x4b, 0x05, 0x06], u16(0), u16(0), u16(locals.length), u16(locals.length),
      u32(centralSize), u32(offset), u16(0)
    );
    var parts = locals.concat(central).concat([new Uint8Array(end)]);
    var total = parts.reduce(function (s, a) { return s + a.length; }, 0);
    var out = new Uint8Array(total);
    var o = 0;
    parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  }
  function downloadZip(filename, files) {
    var clean = {};
    Object.keys(files || {}).forEach(function (k) {
      if (k === '_validation') return;
      clean[k] = files[k];
    });
    if (window.AirReachPackageSchema && window.AirReachPackageSchema.validatePackageFiles) {
      var v = window.AirReachPackageSchema.validatePackageFiles(clean);
      if (!v.ok) {
        alert('パッケージ構造が設計図と一致しません: ' + (v.errors || v.missing || []).join('; '));
        return;
      }
    }
    filename = filename || (window.AirReachPackageSchema && window.AirReachPackageSchema.ZIP_FILENAME) || 'airreach-implementation.zip';
    var data = buildZip(clean);
    var blob = new Blob([data], { type: 'application/zip' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  function persistJob(job) {
    try { localStorage.setItem(ORCH_KEY, JSON.stringify({ lastJob: job })); } catch (e) {}
    try {
      var st = JSON.parse(localStorage.getItem('airreach_studio_v1') || '{}');
      st.profile = job.profile;
      st.keywords = (job.keywords || []).map(function (k) {
        return {
          id: k.id, text: k.keyword, intent: k.intent, cluster: k.cluster,
          priority: k.priority, targetUrl: '', status: '未対策', volume: k.volume,
          gsc_impressions: k.gsc_impressions
        };
      });
      st.competitors = job.competitors;
      st.generated = {};
      Object.keys(job.files || {}).forEach(function (k) {
        if (k === '_validation') return;
        st.generated[k] = job.files[k];
      });
      localStorage.setItem('airreach_studio_v1', JSON.stringify(st));
      if (window.AirReachStudio && window.AirReachStudio.getState) {
        var live = window.AirReachStudio.getState();
        live.profile = st.profile;
        live.keywords = st.keywords;
        live.competitors = st.competitors;
        live.generated = st.generated;
        if (window.AirReachStudio.save) window.AirReachStudio.save();
      }
    } catch (e) {}
  }

  function importGscRows(rows) {
    var mapped = [];
    (rows || []).forEach(function (r) {
      var kw = r.query || r.Query || r.keyword || r.Keyword || '';
      if (!String(kw).trim()) return;
      mapped.push({
        date: r.date || r.Date || '',
        keyword: String(kw).trim(),
        url: r.page || r.Page || r.url || r.URL || '',
        impressions: Number(r.impressions || r.Impressions) || 0,
        clicks: Number(r.clicks || r.Clicks) || 0,
        position: Number(r.position || r.Position) || 0,
        sessions: 0,
        keyEvents: 0
      });
    });
    if (!mapped.length) throw new Error('クエリ列が見つかりません');

    try {
      if (window.AirReachStudio && window.AirReachStudio.getState) {
        var st = window.AirReachStudio.getState();
        mapped.forEach(function (m) { st.measurements.push(m); });
        if (window.AirReachStudio.save) window.AirReachStudio.save();
      } else {
        var raw = JSON.parse(localStorage.getItem('airreach_studio_v1') || '{}');
        raw.measurements = (raw.measurements || []).concat(mapped);
        localStorage.setItem('airreach_studio_v1', JSON.stringify(raw));
      }
    } catch (e) {
      throw new Error('測定データの保存に失敗しました');
    }
    return mapped;
  }

  function reattachGscToJob(job) {
    if (!job || !job.keywords) return job;
    var gscMap = gscMapFromStudio();
    attachGsc(job.keywords, gscMap);
    // Also inject high-impression GSC queries missing from the list (up to limit)
    var limit = job.keyword_limit || job.keywords.length;
    var seen = {};
    job.keywords.forEach(function (k) { seen[normKw(k.keyword)] = 1; });
    Object.keys(gscMap).map(function (k) { return gscMap[k]; })
      .filter(function (g) { return g.impressions > 0 && !seen[normKw(g.keyword)]; })
      .sort(function (a, b) { return b.impressions - a.impressions; })
      .slice(0, Math.max(0, limit - job.keywords.length + 10))
      .forEach(function (g) {
        if (job.keywords.length >= limit) return;
        var nk = normKw(g.keyword);
        if (seen[nk]) return;
        seen[nk] = 1;
        job.keywords.push({
          id: uid(),
          keyword: g.keyword,
          volume: estimateVolume(g.keyword, job.region),
          volume_source: 'Estimated',
          gsc_impressions: Math.round(g.impressions),
          gsc_clicks: Math.round(g.clicks || 0),
          gsc_position: g.positionWeight ? Math.round((g.positionSum / g.positionWeight) * 10) / 10 : null,
          intent: /比較|おすすめ|費用|料金/.test(g.keyword) ? 'Commercial' : 'Informational',
          priority: g.impressions >= 200 ? 'P0' : 'P1',
          strength: g.impressions > 50 ? '普通' : '弱い',
          gap: g.impressions >= 200 ? '大' : '中',
          action: 'ページ改善',
          cluster: 'Core',
          seed_source: 'GSC',
          prompts: promptsForKeyword({ keyword: g.keyword })
        });
      });
    job.keywords.forEach(function (k) {
      if (!k.prompts || !k.prompts.length) {
        k.prompts = promptsForKeyword(k);
        k.prompt_count = k.prompts.length;
      }
    });
    job.keywords.sort(function (a, b) {
      var pr = prioRank(a.priority) - prioRank(b.priority);
      if (pr) return pr;
      var gi = (b.gsc_impressions || 0) - (a.gsc_impressions || 0);
      if (gi) return gi;
      return (b.volume || 0) - (a.volume || 0);
    });
    job.keywords = job.keywords.slice(0, limit);
    job.totalDemand = job.keywords.reduce(function (s, k) { return s + k.volume; }, 0);
    job.compression = compressActions(job.keywords, job.diagnose);
    job.conclusion = buildConclusion(job);
    job.headline4 = {
      keywords: job.keywords.length,
      demand: job.totalDemand,
      score: (job.diagnose && job.diagnose.overall) || 0,
      implSites: job.compression.implSites
    };
    job.files = buildPackageFiles(job);
    persistJob(job);
    return job;
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

    setStep(0, 'running', 10);
    var diagnose = null;
    var diagnoseSource = 'Estimated';
    try {
      if (window.AirReach && window.AirReach.diagnose) {
        diagnose = await window.AirReach.diagnose(job.url, {
          allowProxy: !!(input.proxyConsent || input.allowProxy)
        });
        if (diagnose) diagnoseSource = 'Observed';
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
        evidenceClass: 'Estimated',
        page: { title: '', h1: '', types: [], faqCount: 0 }
      };
      diagnoseSource = 'Estimated';
    }
    job.diagnose = diagnose;
    job.diagnose_source = diagnoseSource;
    job.profile = profileFromDiagnose(diagnose, job.url, {
      brand: (input.profile && input.profile.brand) || '',
      service: (input.profile && input.profile.service) || '',
      audience: (input.profile && input.profile.audience) || '',
      summary: (input.profile && input.profile.summary) || ''
    });
    if (q('orch-service') && job.profile.service && !q('orch-service').value) {
      q('orch-service').value = job.profile.service;
    }
    setStep(0, 'done', 100);
    await sleep(280);

    setStep(1, 'running', 40);
    var gaps = (diagnose.gaps || []).slice(0, 2);
    job.competitors = [
      { url: 'https://competitor-a.example/', note: gaps[0] ? ('推定: ' + gaps[0]) : '比較・料金が強い（推定）', evidenceClass: 'Estimated' },
      { url: 'https://competitor-b.example/', note: gaps[1] ? ('推定: ' + gaps[1]) : 'FAQ・根拠が豊富（推定）', evidenceClass: 'Estimated' }
    ];
    setStep(1, 'done', 100);
    await sleep(220);

    setStep(2, 'running', 50);
    var gscMap = gscMapFromStudio();
    job.gsc_query_count = Object.keys(gscMap).length;
    setStep(2, 'done', 100);
    await sleep(200);

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

    setStep(4, 'running', 30);
    keywords.forEach(function (k) { k.prompts = promptsForKeyword(k); k.prompt_count = k.prompts.length; });
    setStep(4, 'done', 100);
    await sleep(180);

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

    setStep(6, 'running', 50);
    job.files = buildPackageFiles(job);
    job.status = 'completed';
    job.completed_at = new Date().toISOString();
    setStep(6, 'done', 100);

    persistJob(job);
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

  function filteredKeywords(job) {
    var list = (job && job.keywords) || [];
    if (uiState.filter === 'P0' || uiState.filter === 'P1' || uiState.filter === 'P2') {
      return list.filter(function (k) { return k.priority === uiState.filter; });
    }
    if (uiState.filter === 'gsc') {
      return list.filter(function (k) { return k.gsc_impressions != null && k.gsc_impressions > 0; });
    }
    return list;
  }

  function renderKwTable(job) {
    var body = q('orch-kw-body');
    if (!body || !job) return;
    var list = filteredKeywords(job);
    var shown = list.slice(0, uiState.shown);
    body.innerHTML = shown.map(function (k) {
      var official = k.volume_source === 'Official';
      var volTip = official
        ? 'Keyword Planner等の公式ボリュームです。GSC表示回数ではありません。'
        : '市場需要の推定です。GSCの表示回数ではありません。';
      var volBadge = official
        ? ' <span class="orch-badge-off" data-tip="公式ボリューム">公式</span>'
        : ' <span class="orch-badge-est" data-tip="推定ボリューム">推定</span>';
      var gscCell = k.gsc_impressions != null
        ? '<span class="orch-badge-off" data-tip="Search ConsoleのImpressions（実測）">' + Number(k.gsc_impressions).toLocaleString('ja-JP') + '</span>'
        : '—';
      var seed = '';
      if (k.seed_source === 'GSC') seed = ' <span class="orch-seed" data-tip="GSCクエリから採用">GSC</span>';
      if (k.seed_source === 'KeywordPlanner') seed = ' <span class="orch-seed" data-tip="Keyword Plannerから採用">KP</span>';
      var aiCell = (k.ai_mention_rate != null || k.ai_citation_rate != null)
        ? ('<span data-tip="HackⅡ実測の言及率 / 引用率">' +
           (k.ai_mention_rate != null ? k.ai_mention_rate + '%' : '—') + ' / ' +
           (k.ai_citation_rate != null ? k.ai_citation_rate + '%' : '—') + '</span>')
        : '—';
      return '<tr>' +
        '<td><span class="orch-prio">' + esc(k.priority || 'P2') + '</span></td>' +
        '<td>' + esc(k.keyword) + seed + '</td>' +
        '<td><span data-tip="' + esc(volTip) + '">' + Number(k.volume).toLocaleString('ja-JP') + '</span>' + volBadge + '</td>' +
        '<td>' + gscCell + '</td>' +
        '<td>' + aiCell + '</td>' +
        '<td>' + esc(k.strength) + '</td>' +
        '<td>' + (k.prompt_count || (k.prompts && k.prompts.length) || 0) + '</td>' +
        '<td>' + esc(k.gap) + '</td>' +
        '<td>' + esc(k.action) + '</td>' +
        '</tr>';
    }).join('');

    var more = q('orch-kw-more');
    if (more) {
      more.hidden = list.length <= uiState.shown;
      more.textContent = 'さらに表示（残り ' + Math.max(0, list.length - uiState.shown) + '）';
    }
    var count = q('orch-kw-count');
    if (count) {
      count.hidden = false;
      count.textContent = '表示 ' + shown.length + ' / 該当 ' + list.length + '（全 ' + ((job.keywords || []).length) + '）';
    }
    if (window.AirReachTip) window.AirReachTip.enhance(body.parentElement || body);
  }

  function renderResult(job) {
    var wrap = q('orch-result');
    if (!wrap || !job || job.status !== 'completed') return;
    wrap.hidden = false;
    var h = job.headline4 || {};
    if (q('orch-n-kw')) q('orch-n-kw').textContent = String(h.keywords || 0);
    if (q('orch-n-demand')) {
      q('orch-n-demand').textContent = '約 ' + Number(h.demand || 0).toLocaleString('ja-JP');
      var dUnit = q('orch-n-demand').parentElement && q('orch-n-demand').parentElement.querySelector('.unit');
      var hasOfficialVol = (job.keywords || []).some(function (k) { return k.volume_source === 'Official'; });
      if (dUnit) {
        dUnit.innerHTML = hasOfficialVol
          ? '回 <span class="orch-badge-off" data-tip="一部キーワードはKeyword Planner公式ボリューム">公式混在</span>'
          : '回 <span class="orch-badge-est">推定</span>';
      }
    }
    if (q('orch-n-score')) {
      var scoreLabel = String(h.score || 0);
      q('orch-n-score').textContent = scoreLabel;
      var unit = q('orch-n-score').parentElement && q('orch-n-score').parentElement.querySelector('.unit');
      if (unit) {
        unit.innerHTML = '/ 100' + (job.diagnose_source === 'Estimated'
          ? ' <span class="orch-badge-est" data-tip="ページ取得できなかったため推定です">推定</span>'
          : ' <span class="orch-badge-off" data-tip="公開HTMLの準備度（実測）">実測</span>');
      }
    }
    if (q('orch-n-impl')) q('orch-n-impl').textContent = String(h.implSites || 0);
    if (q('orch-conclusion')) q('orch-conclusion').textContent = job.conclusion || '';

    var c = job.compression || {};
    if (q('orch-compress')) {
      q('orch-compress').innerHTML =
        '<div class="orch-compress-grid">' +
        '<div><b>' + (c.existingPages || 0) + '</b><span data-tip="既存ページの改善候補数">既存ページ</span></div>' +
        '<div><b>' + (c.newPages || 0) + '</b><span data-tip="新規ページ候補数">新規ページ</span></div>' +
        '<div><b>' + (c.faqCount || 0) + '</b><span>FAQ</span></div>' +
        '<div><b>' + (c.schemaCount || 0) + '</b><span data-tip="構造化データの修正候補">Schema</span></div>' +
        '<div><b>' + (c.internalLinks || 0) + '</b><span>内部リンク</span></div>' +
        '</div><p class="orch-impl-summary">実際に直すのは <b>' + (c.implSites || 0) + ' 箇所</b>です。</p>';
    }

    var hasGsc = (job.keywords || []).some(function (k) { return k.gsc_impressions != null && k.gsc_impressions > 0; });
    var gscNote = q('orch-gsc-note');
    if (gscNote) {
      gscNote.textContent = hasGsc
        ? '月間需要は推定。GSC Impressionsがある行のみ実測を別列で表示しています。'
        : '月間需要は推定です。上の「GSC CSV」を取り込むと、実測Impressionsが別列で付きます。';
      gscNote.hidden = false;
    }

    uiState.shown = Math.min(uiState.shown, 40);
    if (uiState.shown < 40) uiState.shown = 40;
    renderKwTable(job);
    if (window.AirReachTip) window.AirReachTip.enhance(wrap);
  }

  function mapGoal(raw) {
    raw = String(raw || '');
    if (raw === 'visibility' || /見え方|認知|ブランド/.test(raw)) return '見え方を整える';
    if (raw === 'booking' || /予約/.test(raw)) return '予約を増やす';
    if (raw === 'acquisition' || /問い合わせ|集客|acquisition/.test(raw)) return '問い合わせを増やす';
    return raw || '問い合わせを増やす';
  }

  function prefillLaunch() {
    var url = '';
    var service = '';
    var goal = '';
    var region = '';
    try {
      var params = new URLSearchParams(location.search);
      url = params.get('url') || params.get('site') || '';
      service = params.get('service') || params.get('keyword') || '';
      goal = mapGoal(params.get('goal') || params.get('mode') || '');
      region = params.get('region') || '';
    } catch (e) {}

    try {
      var survey = JSON.parse(localStorage.getItem('airreach_onboard_survey_v1') || 'null');
      if (survey) {
        if (!url && survey.url) url = survey.url;
        if (!service && survey.keyword) service = survey.keyword;
        if (!goal && survey.goal) goal = mapGoal(survey.goal);
      }
    } catch (e) {}

    try {
      var handoff = JSON.parse(localStorage.getItem('airreach_diagnose_handoff_v1') || 'null');
      if (handoff && !url && handoff.url) url = handoff.url;
    } catch (e) {}

    try {
      var st = JSON.parse(localStorage.getItem('airreach_studio_v1') || '{}');
      if (st.profile) {
        if (!url && st.profile.url) url = st.profile.url;
        if (!service && st.profile.service) service = st.profile.service;
      }
    } catch (e) {}

    if (url && q('orch-url') && !q('orch-url').value) q('orch-url').value = url;
    if (service && q('orch-service') && !q('orch-service').value) q('orch-service').value = service;
    if (goal && q('orch-goal')) {
      var opts = q('orch-goal').options || [];
      for (var gi = 0; gi < opts.length; gi++) {
        if (opts[gi].value === goal) { q('orch-goal').value = goal; break; }
      }
    }
    if (region && q('orch-region')) {
      var ropts = q('orch-region').options || [];
      for (var ri = 0; ri < ropts.length; ri++) {
        if (ropts[ri].value === region) { q('orch-region').value = region; break; }
      }
    }
  }

  function restoreLastJob() {
    try {
      var raw = localStorage.getItem(ORCH_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      var job = data && data.lastJob;
      if (!job || job.status !== 'completed') return;
      window.__orchLastJob = job;
      if (q('orch-progress-wrap')) q('orch-progress-wrap').hidden = true;
      renderResult(job);
    } catch (e) {}
  }

  function setGscStatus(msg, ok) {
    var el = q('orch-gsc-status');
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || '';
    el.className = 'orch-gsc-status' + (ok ? ' is-ok' : (msg ? ' is-warn' : ''));
  }

  function bindOverview() {
    var runBtn = q('orch-run');
    if (!runBtn) return;

    prefillLaunch();
    restoreLastJob();

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

    document.querySelectorAll('[data-orch-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        uiState.filter = btn.getAttribute('data-orch-filter') || 'all';
        uiState.shown = 40;
        document.querySelectorAll('[data-orch-filter]').forEach(function (b) { b.classList.remove('is-on'); });
        btn.classList.add('is-on');
        if (window.__orchLastJob) renderKwTable(window.__orchLastJob);
      });
    });

    var moreBtn = q('orch-kw-more');
    if (moreBtn) {
      moreBtn.addEventListener('click', function () {
        uiState.shown += 40;
        if (window.__orchLastJob) renderKwTable(window.__orchLastJob);
      });
    }

    var csvBtn = q('orch-kw-csv');
    if (csvBtn) {
      csvBtn.addEventListener('click', function () {
        var job = window.__orchLastJob;
        if (!job || !job.keywords) {
          alert('先に分析を完了してください');
          return;
        }
        var cols = (window.AirReachPackageSchema && window.AirReachPackageSchema.KEYWORD_CSV_COLUMNS) || [
          'priority', 'keyword', 'volume', 'volume_source', 'gsc_impressions', 'gsc_clicks',
          'ai_mention_rate', 'ai_citation_rate', 'intent', 'cluster', 'gap', 'action', 'seed_source'
        ];
        var rows = filteredKeywords(job).map(function (k) {
          return {
            priority: k.priority,
            keyword: k.keyword,
            volume: k.volume,
            volume_source: k.volume_source,
            gsc_impressions: k.gsc_impressions == null ? '' : k.gsc_impressions,
            gsc_clicks: k.gsc_clicks == null ? '' : k.gsc_clicks,
            ai_mention_rate: k.ai_mention_rate == null ? '' : k.ai_mention_rate,
            ai_citation_rate: k.ai_citation_rate == null ? '' : k.ai_citation_rate,
            intent: k.intent,
            cluster: k.cluster,
            gap: k.gap,
            action: k.action,
            seed_source: k.seed_source || ''
          };
        });
        downloadText('airreach-keywords.csv', toCsv(rows, cols), 'text/csv;charset=utf-8');
      });
    }

    var gscInput = q('orch-gsc-csv');
    if (gscInput) {
      gscInput.addEventListener('change', function () {
        var f = gscInput.files && gscInput.files[0];
        if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          try {
            var rows = parseCsv(rd.result);
            var mapped = importGscRows(rows);
            setGscStatus('GSC取込完了: ' + mapped.length + ' 行（実測）。分析済みなら表へ反映します。', true);
            if (window.__orchLastJob && window.__orchLastJob.status === 'completed') {
              window.__orchLastJob = reattachGscToJob(window.__orchLastJob);
              renderResult(window.__orchLastJob);
            }
          } catch (e) {
            setGscStatus('CSVを読み込めませんでした: ' + (e && e.message ? e.message : e), false);
          }
        };
        rd.readAsText(f, 'utf-8');
      });
    }

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
      var service = (q('orch-service') && q('orch-service').value || '').trim();

      q('orch-progress-wrap').hidden = false;
      q('orch-result').hidden = true;
      runBtn.disabled = true;
      runBtn.textContent = '分析中…';
      uiState.filter = 'all';
      uiState.shown = 40;
      document.querySelectorAll('[data-orch-filter]').forEach(function (b) {
        b.classList.toggle('is-on', b.getAttribute('data-orch-filter') === 'all');
      });

      try {
        var job = await runJob({
          url: url,
          goal: goal,
          keyword_limit: limit,
          region: region,
          profile: {
            url: url,
            brand: (q('brand-name') && q('brand-name').value) || '',
            service: service || (q('service-name') && q('service-name').value) || '',
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
        downloadZip((window.AirReachPackageSchema && window.AirReachPackageSchema.ZIP_FILENAME) || 'airreach-implementation.zip', job.files);
      });
    }

    var prBtn = q('orch-pr');
    if (prBtn) {
      prBtn.addEventListener('click', function (e) {
        e.preventDefault();
      });
    }
  }

  function refreshJobArtifacts(job) {
    if (!job) return job;
    job.totalDemand = (job.keywords || []).reduce(function (s, k) { return s + (Number(k.volume) || 0); }, 0);
    if (job.headline4) {
      job.headline4.keywords = (job.keywords || []).length;
      job.headline4.demand = job.totalDemand;
      if (job.compression) job.headline4.implSites = job.compression.implSites;
    }
    job.files = buildPackageFiles(job);
    persistJob(job);
    return job;
  }

  window.AirReachOrchestrator = {
    runJob: runJob,
    buildPackageFiles: buildPackageFiles,
    downloadZip: downloadZip,
    importGscRows: importGscRows,
    reattachGscToJob: reattachGscToJob,
    refreshJobArtifacts: refreshJobArtifacts,
    renderResult: renderResult,
    parseCsv: parseCsv,
    STEPS: STEPS,
    PackageSchema: window.AirReachPackageSchema || null
  };

  document.addEventListener('DOMContentLoaded', bindOverview);
})();
