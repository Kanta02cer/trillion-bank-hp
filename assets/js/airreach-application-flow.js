/**
 * AirReach Recruit — Application Flow (canonical events).
 * Stages: job_view → apply_cta_click → apply_start → apply_complete
 * Evidence: Official (GA4/ATS CSV) | Customer supplied (manual) | Planned (checklist only)
 * No invented conversion rates. No ATS-specific adapters yet.
 */
(function (root) {
  'use strict';

  var STAGES = [
    { id: 'job_view', label: '求人閲覧', aliases: ['job_view', 'job_page_view', 'page_view', 'view_item', '求人閲覧', '閲覧'] },
    { id: 'apply_cta_click', label: '応募ボタン', aliases: ['apply_cta_click', 'apply_click', 'cta_click', 'select_content', '応募ボタン', '応募クリック'] },
    { id: 'apply_start', label: '応募開始', aliases: ['apply_start', 'begin_checkout', 'form_start', 'generate_lead', '応募開始', 'フォーム開始'] },
    { id: 'apply_complete', label: '応募完了', aliases: ['apply_complete', 'apply_submit', 'purchase', 'submit', 'conversion', '応募完了', '応募送信'] }
  ];

  function parseCsv(text) {
    var rows = [], row = [], cur = '', quote = false;
    text = String(text || '').replace(/^\uFEFF/, '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i], nx = text[i + 1];
      if (ch === '"' && quote && nx === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { quote = !quote; continue; }
      if ((ch === ',' || ch === '\t') && !quote) { row.push(cur); cur = ''; continue; }
      if ((ch === '\n' || ch === '\r') && !quote) {
        if (ch === '\r' && nx === '\n') i++;
        row.push(cur);
        if (row.some(function (x) { return x !== ''; })) rows.push(row);
        row = []; cur = '';
        continue;
      }
      cur += ch;
    }
    row.push(cur);
    if (row.some(function (x) { return x !== ''; })) rows.push(row);
    if (!rows.length) return [];
    var head = rows.shift().map(function (x) { return String(x || '').trim(); });
    return rows.map(function (r) {
      var o = {};
      head.forEach(function (h, j) { o[h] = r[j] || ''; });
      return o;
    });
  }

  function pick(row, keys) {
    for (var i = 0; i < keys.length; i++) {
      if (row[keys[i]] != null && String(row[keys[i]]).trim() !== '') return row[keys[i]];
    }
    var lower = {};
    Object.keys(row).forEach(function (k) { lower[String(k).toLowerCase()] = row[k]; });
    for (var j = 0; j < keys.length; j++) {
      var k2 = keys[j].toLowerCase();
      if (lower[k2] != null && String(lower[k2]).trim() !== '') return lower[k2];
    }
    return '';
  }

  function num(v) {
    var x = parseFloat(String(v || '').replace(/[% ,]/g, ''));
    return isFinite(x) ? x : 0;
  }

  function mapEventName(name) {
    var raw = String(name || '').trim().toLowerCase();
    if (!raw) return null;
    for (var i = 0; i < STAGES.length; i++) {
      var aliases = STAGES[i].aliases;
      for (var j = 0; j < aliases.length; j++) {
        if (raw === String(aliases[j]).toLowerCase()) return STAGES[i].id;
      }
    }
    // soft contains
    if (/complete|完了|submit|送信/.test(raw)) return 'apply_complete';
    if (/start|開始|begin|form_start/.test(raw)) return 'apply_start';
    if (/cta|click|ボタン|クリック/.test(raw) && /apply|応募/.test(raw)) return 'apply_cta_click';
    if (/view|閲覧|page_view/.test(raw) && /job|求人|career|recruit/.test(raw)) return 'job_view';
    return null;
  }

  /**
   * Accepts:
   * - event,eventCount / Event name,Event count
   * - stage,count
   * - date,event,count,job_id,url (optional extras aggregated)
   */
  function aggregateRows(rows, opts) {
    opts = opts || {};
    var counts = { job_view: 0, apply_cta_click: 0, apply_start: 0, apply_complete: 0 };
    var unmatched = [];
    var accepted = 0;

    (rows || []).forEach(function (r) {
      var stageDirect = String(pick(r, ['stage', 'Stage', 'funnel_stage', 'ステップ'])).trim();
      var eventName = pick(r, [
        'eventName', 'Event name', 'Event Name', 'event', 'Event', 'イベント名', 'イベント'
      ]);
      var mapped = stageDirect
        ? mapEventName(stageDirect) || (counts.hasOwnProperty(stageDirect) ? stageDirect : null)
        : mapEventName(eventName);
      var count = num(pick(r, [
        'eventCount', 'Event count', 'Event Count', 'count', 'Count', 'sessions', 'Sessions',
        'keyEvents', 'Key events', '総数', '件数', '回数'
      ]));
      if (!mapped) {
        if (eventName || stageDirect) unmatched.push(String(eventName || stageDirect));
        return;
      }
      if (count <= 0) count = 1;
      counts[mapped] += count;
      accepted++;
    });

    return buildFunnel(counts, {
      evidenceClass: opts.evidenceClass || 'Official',
      source: opts.source || 'Application Flow CSV',
      rowCount: accepted,
      unmatched: unmatched.slice(0, 20)
    });
  }

  function buildFunnel(counts, meta) {
    meta = meta || {};
    counts = counts || {};
    var stages = STAGES.map(function (s) {
      return { id: s.id, label: s.label, count: Math.max(0, num(counts[s.id])) };
    });
    var rates = [];
    for (var i = 1; i < stages.length; i++) {
      var prev = stages[i - 1].count;
      var cur = stages[i].count;
      rates.push({
        from: stages[i - 1].id,
        to: stages[i].id,
        fromLabel: stages[i - 1].label,
        toLabel: stages[i].label,
        rate: prev > 0 ? cur / prev : null,
        dropOff: prev > 0 ? Math.max(0, prev - cur) : null
      });
    }
    var view = stages[0].count;
    var complete = stages[3].count;
    return {
      evidenceClass: meta.evidenceClass || 'Customer supplied',
      source: meta.source || 'manual',
      scoreVersion: 'application-flow-v0',
      stages: stages,
      stepRates: rates,
      overallCvr: view > 0 ? complete / view : null,
      rowCount: meta.rowCount || 0,
      unmatched: meta.unmatched || [],
      importedAt: new Date().toISOString(),
      note: '応募完了率は計測できた範囲の参考値です。掲載・順位・AI引用とは別指標です。'
    };
  }

  function fromCsvText(text, opts) {
    return aggregateRows(parseCsv(text), opts);
  }

  function instrumentationScore(flags) {
    flags = flags || {};
    var keys = [
      'hasJobView',
      'hasApplyCta',
      'hasApplyStart',
      'hasApplyComplete',
      'hasJobIdParam'
    ];
    var ok = keys.filter(function (k) { return !!flags[k]; }).length;
    return {
      ok: ok,
      total: keys.length,
      label: ok + ' / ' + keys.length + ' 計測項目',
      evidenceClass: 'Planned',
      scoreVersion: 'application-instrumentation-v0'
    };
  }

  /** Recommended gtag snippet — customer installs manually. */
  function snippetTemplate(jobIdPlaceholder) {
    var jid = jobIdPlaceholder || 'JOB_ID';
    return [
      '// AirReach Recruit — recommended event names (install on career site)',
      "// 1) job detail view",
      "gtag('event', 'job_view', { job_id: '" + jid + "', page_location: location.href });",
      '',
      "// 2) apply CTA click",
      "gtag('event', 'apply_cta_click', { job_id: '" + jid + "' });",
      '',
      "// 3) application form start",
      "gtag('event', 'apply_start', { job_id: '" + jid + "' });",
      '',
      "// 4) application complete (thank-you / ATS success)",
      "gtag('event', 'apply_complete', { job_id: '" + jid + "' });",
      '',
      '// Map these as Key events in GA4. Do not invent counts in AirReach.'
    ].join('\n');
  }

  root.AirReachApplicationFlow = {
    STAGES: STAGES,
    parseCsv: parseCsv,
    aggregateRows: aggregateRows,
    buildFunnel: buildFunnel,
    fromCsvText: fromCsvText,
    instrumentationScore: instrumentationScore,
    snippetTemplate: snippetTemplate,
    mapEventName: mapEventName
  };
})(typeof window !== 'undefined' ? window : globalThis);
