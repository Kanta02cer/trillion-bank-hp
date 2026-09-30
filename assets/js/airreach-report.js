/**
 * AirReach 月次レポート — 材料（診断・AI計測・流入・施策）から下書きを組み立てる。
 * 画面（airreach-console.js）とは切り離し、Node でも単体テストできる純粋関数だけを置く。
 *
 * 方針
 *   - 数字は材料にあるものだけを使う。無いものは null（画面では「—」や「未計測」）。推定で埋めない。
 *   - 自動で作るのは「事実の変化」まで（点数 48→55、引用率 0%→20% など）。結論・次の施策は担当者が書く。
 */
(function (root) {
  'use strict';

  function monthStart(d) {
    var s = String(d || '').slice(0, 7);
    return /^\d{4}-\d{2}$/.test(s) ? s + '-01' : '';
  }
  function prevMonth(m) {
    var y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
    mo -= 1; if (mo === 0) { mo = 12; y -= 1; }
    return y + '-' + (mo < 10 ? '0' : '') + mo + '-01';
  }
  function monthEnd(m) {
    var y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
    var next = mo === 12 ? (y + 1) + '-01-01' : y + '-' + (mo + 1 < 10 ? '0' : '') + (mo + 1) + '-01';
    return next;
  }
  function inMonth(dateStr, m) {
    var d = String(dateStr || '').slice(0, 10);
    return d >= m && d < monthEnd(m);
  }
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(String(v).replace(/[,%\s]/g, ''));
    return isFinite(n) ? n : null;
  }
  function round1(n) { return n == null ? null : Math.round(n * 10) / 10; }
  function delta(cur, prev) { return cur == null || prev == null ? null : round1(cur - prev); }

  // ---- 計測スクリプトの summary.json ----------------------------------------
  /**
   * @returns {{runId,generatedAt,querySetVersion,matcherVersion,rows:Array}} rows: provider×group の KPI
   */
  function parseMeasurementSummary(json) {
    var d = typeof json === 'string' ? JSON.parse(json) : json;
    if (!d || !Array.isArray(d.by)) throw new Error('summary.json の形式ではありません（by が無い）');
    var rows = d.by.map(function (b) {
      var either = b.either && b.either.rate != null ? b.either.rate : b.rate;
      return {
        provider: String(b.provider || ''),
        model: String(b.model || ''),
        group: String(b.group || ''),
        label: String(b.label || ''),
        answers: num(b.denominator != null ? b.denominator : b.total),
        citeRate: num(either),
        citeCount: num(b.either && b.either.numerator != null ? b.either.numerator : b.numerator),
        mentionRate: num(b.service_mention_rate),
        mediaDomainRate: num(b.media_domain_rate),
        searchRate: num(b.search_execution_rate),
        errors: num(b.error_count) || 0
      };
    }).filter(function (r) { return r.provider && r.group; });
    if (!rows.length) throw new Error('summary.json に集計行がありません');
    return {
      runId: String(d.run_id || ''),
      generatedAt: String(d.generated_at || ''),
      querySetVersion: String(d.query_set_version || ''),
      matcherVersion: String(d.matcher_version || ''),
      rows: rows
    };
  }

  // ---- GSC の CSV（日本語・英語の書き出しどちらも）----------------------------
  function splitCsvLine(line) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (q) {
        if (ch === '"' && line.charAt(i + 1) === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }
  var GSC_COLS = {
    date: /^(date|日付)$/i,
    clicks: /^(clicks|クリック数)$/i,
    impressions: /^(impressions|表示回数)$/i,
    ctr: /^(ctr)$/i,
    position: /^(position|掲載順位|平均掲載順位)$/i
  };
  /**
   * GSC の「日付」CSV（Chart.csv / グラフ.csv）または「クエリ」「ページ」の CSV を合計する。
   * 日付列があれば periodMonth の行だけを合計する。
   * @returns {{clicks,impressions,ctr,position,rows}}
   */
  function parseGscCsv(text, periodMonth) {
    var lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) throw new Error('CSV にデータ行がありません');
    var head = splitCsvLine(lines[0]).map(function (h) { return h.trim(); });
    var idx = {};
    Object.keys(GSC_COLS).forEach(function (k) {
      for (var i = 0; i < head.length; i++) if (GSC_COLS[k].test(head[i])) { idx[k] = i; break; }
    });
    if (idx.clicks == null || idx.impressions == null) throw new Error('Search Console の CSV ではありません（クリック数・表示回数の列が無い）');
    var clicks = 0, imps = 0, posWeighted = 0, rows = 0;
    lines.slice(1).forEach(function (l) {
      var c = splitCsvLine(l);
      if (idx.date != null && periodMonth && !inMonth(c[idx.date], periodMonth)) return;
      var ck = num(c[idx.clicks]) || 0, im = num(c[idx.impressions]) || 0;
      clicks += ck; imps += im; rows++;
      if (idx.position != null && num(c[idx.position]) != null) posWeighted += num(c[idx.position]) * im;
    });
    if (!rows) throw new Error('対象の月（' + (periodMonth || '').slice(0, 7) + '）の行がありません');
    return {
      clicks: clicks,
      impressions: imps,
      ctr: imps ? round1(clicks / imps * 100) : null,
      position: imps && idx.position != null ? round1(posWeighted / imps) : null,
      rows: rows
    };
  }

  // ---- レポートの下書き ------------------------------------------------------
  function latest(list, dateKey, pred) {
    return (list || []).filter(pred).sort(function (a, b) { return String(b[dateKey]).localeCompare(String(a[dateKey])); })[0] || null;
  }

  function aiKpis(run) {
    if (!run || !run.summary) return null;
    var parsed;
    try { parsed = parseMeasurementSummary(run.summary); } catch (e) { return null; }
    var main = parsed.rows.filter(function (r) { return r.group === 'main'; });
    var use = main.length ? main : parsed.rows.filter(function (r) { return r.group === 'all'; });
    return {
      measuredOn: run.measured_on,
      querySetVersion: parsed.querySetVersion || run.query_set_version || '',
      providers: use.map(function (r) {
        return { provider: r.provider, model: r.model, answers: r.answers, citeRate: r.citeRate, mentionRate: r.mentionRate, errors: r.errors };
      })
    };
  }

  function trafficFor(list, month) {
    var out = {};
    (list || []).filter(function (t) { return t.period_month === month; }).forEach(function (t) {
      var kind = /^gsc/.test(t.source) ? 'gsc' : 'ga4';
      if (!out[kind] || /_api$/.test(t.source)) out[kind] = Object.assign({ source: t.source }, t.metrics || {});
    });
    return out;
  }

  /**
   * @param {object} p { client, periodMonth:'YYYY-MM-01', scans:[], runs:[], traffic:[], actions:[], now? }
   */
  function compileReport(p) {
    var m = monthStart(p.periodMonth);
    if (!m) throw new Error('対象月が不正です');
    var pm = prevMonth(m);
    var end = monthEnd(m);

    // 診断: 当月（なければ月末までで最新）と、前月の最新
    var scanNow = latest(p.scans, 'createdAt', function (s) { return String(s.createdAt).slice(0, 10) < end; });
    var scanPrev = latest(p.scans, 'createdAt', function (s) { return inMonth(s.createdAt, pm); });
    var gapsNow = scanNow ? (scanNow.gaps || []) : [];
    var gapsPrev = scanPrev ? (scanPrev.gaps || []) : [];
    var site = {
      current: scanNow ? { id: scanNow.id, createdAt: scanNow.createdAt, url: scanNow.url, overall: scanNow.overallScore, factors: scanNow.factors || {}, gaps: gapsNow, unknownChecks: scanNow.unknownChecks || 0, inMonth: inMonth(scanNow.createdAt, m) } : null,
      previous: scanPrev ? { id: scanPrev.id, createdAt: scanPrev.createdAt, overall: scanPrev.overallScore, gaps: gapsPrev } : null,
      overallDelta: scanNow && scanPrev ? delta(scanNow.overallScore, scanPrev.overallScore) : null,
      resolved: scanPrev ? gapsPrev.filter(function (g) { return gapsNow.indexOf(g) < 0; }) : [],
      added: scanPrev ? gapsNow.filter(function (g) { return gapsPrev.indexOf(g) < 0; }) : []
    };

    // AI 計測: 当月の最新と前月の最新
    var runNow = latest(p.runs, 'measured_on', function (r) { return inMonth(r.measured_on, m); });
    var runPrev = latest(p.runs, 'measured_on', function (r) { return inMonth(r.measured_on, pm); });
    var aiNow = aiKpis(runNow), aiPrev = aiKpis(runPrev);
    var ai = null;
    if (aiNow) {
      ai = {
        measuredOn: aiNow.measuredOn, querySetVersion: aiNow.querySetVersion,
        comparable: !!(aiPrev && aiPrev.querySetVersion === aiNow.querySetVersion),
        providers: aiNow.providers.map(function (r) {
          var prev = aiPrev ? aiPrev.providers.filter(function (x) { return x.provider === r.provider; })[0] : null;
          var comparable = !!(aiPrev && aiPrev.querySetVersion === aiNow.querySetVersion && prev);
          return Object.assign({}, r, {
            prevCiteRate: prev ? prev.citeRate : null, prevMentionRate: prev ? prev.mentionRate : null,
            citeDelta: comparable ? delta(r.citeRate, prev.citeRate) : null,
            mentionDelta: comparable ? delta(r.mentionRate, prev.mentionRate) : null
          });
        })
      };
    }

    // 流入
    var tNow = trafficFor(p.traffic, m), tPrev = trafficFor(p.traffic, pm);
    var traffic = { gsc: tNow.gsc || null, gscPrev: tPrev.gsc || null, ga4: tNow.ga4 || null, ga4Prev: tPrev.ga4 || null };

    // 施策（当月に実施したもの）
    var actions = (p.actions || []).filter(function (a) { return a.status === 'done' && inMonth(a.done_on, m); })
      .sort(function (a, b) { return String(a.done_on).localeCompare(String(b.done_on)); })
      .map(function (a) { return { title: a.title, doneOn: a.done_on, evidenceUrl: a.evidence_url || '', category: a.category || '' }; });

    // 事実の変化（結論の下書きに使う候補）
    var facts = [];
    if (site.current && site.current.overall != null) {
      facts.push(site.previous && site.previous.overall != null
        ? 'ホームページの情報整備：' + site.previous.overall + '点 → ' + site.current.overall + '点（' + (site.overallDelta >= 0 ? '+' : '') + site.overallDelta + '）'
        : 'ホームページの情報整備：' + site.current.overall + '点（前月の診断なし）');
    }
    if (site.resolved.length) facts.push('前月から解消した不足：' + site.resolved.length + '件');
    if (ai) ai.providers.forEach(function (r) {
      if (r.citeRate == null) return;
      facts.push('AIの引用率（' + r.provider + '）：' + (r.citeDelta != null ? (r.prevCiteRate + '% → ') : '') + r.citeRate + '%' + (r.citeDelta != null ? '（' + (r.citeDelta >= 0 ? '+' : '') + r.citeDelta + 'pt）' : (ai.comparable ? '' : '（前月と質問の版が違う、または前月の計測なし）')));
    });
    if (traffic.gsc && traffic.gsc.clicks != null) {
      facts.push('検索からのクリック：' + (traffic.gscPrev && traffic.gscPrev.clicks != null ? traffic.gscPrev.clicks + ' → ' : '') + traffic.gsc.clicks);
    }
    if (actions.length) facts.push('今月実施した施策：' + actions.length + '件');

    // 足りない材料（レポートに「未計測」と出すもの）
    var missing = [];
    if (!site.current) missing.push('ホームページの診断');
    else if (!site.current.inMonth) missing.push('当月の診断（' + String(site.current.createdAt).slice(0, 10) + ' の診断を使用）');
    if (!ai) missing.push('AI回答の計測');
    if (!traffic.gsc) missing.push('Search Console の数値');
    if (!traffic.ga4) missing.push('GA4 の数値');

    return {
      version: 'report-v1',
      periodMonth: m,
      previousMonth: pm,
      client: p.client ? { id: p.client.id, name: p.client.name, industryId: p.client.industry_id || '' } : null,
      generatedAt: (p.now || new Date()).toISOString ? (p.now || new Date()).toISOString() : String(p.now),
      site: site,
      ai: ai,
      traffic: traffic,
      actions: actions,
      facts: facts,
      missing: missing
    };
  }

  var api = { parseMeasurementSummary: parseMeasurementSummary, parseGscCsv: parseGscCsv, compileReport: compileReport, monthStart: monthStart, prevMonth: prevMonth, version: 'report-v1' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AirReachReport = api;
})(typeof window !== 'undefined' ? window : null);
