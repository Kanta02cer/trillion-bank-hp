/**
 * AirReach Platform — Growth Impact + Official baseline (GSC/GA4 CSV).
 * Evidence classes: Official / Observed / Inferred / User Input.
 * Simulation outputs are always Inferred (never guarantees).
 */
(function () {
  'use strict';

  var BASELINE_KEY = 'airreach_official_baseline_v1';
  var STUDIO_KEY = 'airreach_studio_v1';

  function q(id) { return document.getElementById(id); }
  function n(id) {
    var el = q(id);
    var v = el ? parseFloat(el.value) : 0;
    return isFinite(v) ? v : 0;
  }
  function yen(v) {
    return v > 0 ? '¥' + Math.round(v).toLocaleString('ja-JP') : '—';
  }
  function count(v) {
    return Math.round(v).toLocaleString('ja-JP');
  }
  function pct(v) {
    return (Math.round(v * 1000) / 10) + '%';
  }

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var cur = '';
    var quote = false;
    text = String(text || '').replace(/^\uFEFF/, '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      var nx = text[i + 1];
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
    var head = rows.shift().map(function (x) { return String(x || '').trim(); });
    return rows.map(function (r) {
      var o = {};
      head.forEach(function (h, j) { o[h] = r[j] || ''; });
      return o;
    });
  }

  function numCell(v) {
    var x = parseFloat(String(v == null ? '' : v).replace(/[%％,，\s]/g, ''));
    return isFinite(x) ? x : 0;
  }

  function pick(row, keys) {
    for (var i = 0; i < keys.length; i++) {
      if (row[keys[i]] != null && String(row[keys[i]]).trim() !== '') return row[keys[i]];
    }
    var lower = {};
    Object.keys(row).forEach(function (k) { lower[k.toLowerCase().replace(/\s+/g, '')] = row[k]; });
    for (var j = 0; j < keys.length; j++) {
      var k2 = keys[j].toLowerCase().replace(/\s+/g, '');
      if (lower[k2] != null && String(lower[k2]).trim() !== '') return lower[k2];
    }
    return '';
  }

  function scaleToMonthly(total, periodDays) {
    var days = periodDays > 0 ? periodDays : 28;
    return Math.round((total / days) * 30);
  }

  function aggregateGscRows(rows, periodDays) {
    var byQuery = {};
    rows.forEach(function (r) {
      var query = String(pick(r, ['query', 'Query', 'クエリ', '検索クエリ', 'keyword', 'Keyword']) || '').trim();
      var page = String(pick(r, ['page', 'Page', 'ページ', '上位のページ', 'url', 'URL']) || '').trim();
      var key = query || page;
      if (!key) return;
      var impressions = numCell(pick(r, ['impressions', 'Impressions', '表示回数', 'インプレッション']));
      var clicks = numCell(pick(r, ['clicks', 'Clicks', 'クリック数', 'クリック']));
      var position = numCell(pick(r, ['position', 'Position', '掲載順位', '平均掲載順位', '順位']));
      var ctrRaw = pick(r, ['ctr', 'CTR']);
      var ctr = ctrRaw !== '' ? (numCell(ctrRaw) > 1 ? numCell(ctrRaw) / 100 : numCell(ctrRaw))
        : (impressions > 0 ? clicks / impressions : 0);
      if (!byQuery[key]) {
        byQuery[key] = {
          query: key,
          impressions: 0,
          clicks: 0,
          positionSum: 0,
          positionWeight: 0,
          evidenceClass: 'Official'
        };
      }
      byQuery[key].impressions += impressions;
      byQuery[key].clicks += clicks;
      if (position > 0) {
        byQuery[key].positionSum += position * Math.max(impressions, 1);
        byQuery[key].positionWeight += Math.max(impressions, 1);
      }
      byQuery[key].ctr = byQuery[key].impressions > 0
        ? byQuery[key].clicks / byQuery[key].impressions
        : ctr;
    });

    var keywords = Object.keys(byQuery).map(function (k) {
      var row = byQuery[k];
      row.position = row.positionWeight > 0 ? row.positionSum / row.positionWeight : 0;
      row.missedClicks = Math.max(0, Math.round(row.impressions * Math.max(0.06 - row.ctr, 0)));
      return row;
    }).sort(function (a, b) {
      return (b.missedClicks - a.missedClicks) || (b.impressions - a.impressions);
    });

    var totalImp = keywords.reduce(function (s, r) { return s + r.impressions; }, 0);
    var totalClicks = keywords.reduce(function (s, r) { return s + r.clicks; }, 0);
    return {
      evidenceClass: 'Official',
      source: 'GSC CSV',
      periodDays: periodDays || 28,
      totalImpressions: totalImp,
      totalClicks: totalClicks,
      monthlyImpressions: scaleToMonthly(totalImp, periodDays || 28),
      monthlyClicks: scaleToMonthly(totalClicks, periodDays || 28),
      avgCtr: totalImp > 0 ? totalClicks / totalImp : 0,
      keywords: keywords.slice(0, 50),
      importedAt: new Date().toISOString()
    };
  }

  function aggregateGa4Rows(rows, periodDays) {
    var sessions = 0;
    var keyEvents = 0;
    rows.forEach(function (r) {
      sessions += numCell(pick(r, ['sessions', 'Sessions', 'セッション']));
      keyEvents += numCell(pick(r, [
        'keyEvents', 'Key events', 'キーイベント', 'conversions', 'Conversions', 'コンバージョン'
      ]));
    });
    return {
      evidenceClass: 'Official',
      source: 'GA4 CSV',
      periodDays: periodDays || 28,
      sessions: sessions,
      keyEvents: keyEvents,
      monthlySessions: scaleToMonthly(sessions, periodDays || 28),
      monthlyKeyEvents: scaleToMonthly(keyEvents, periodDays || 28),
      importedAt: new Date().toISOString()
    };
  }

  function loadBaseline() {
    try { return JSON.parse(localStorage.getItem(BASELINE_KEY) || 'null'); }
    catch (e) { return null; }
  }

  function saveBaseline(baseline) {
    try { localStorage.setItem(BASELINE_KEY, JSON.stringify(baseline)); } catch (e) {}
  }

  function baselineFromStudio() {
    try {
      var studio = JSON.parse(localStorage.getItem(STUDIO_KEY) || '{}');
      var measurements = studio.measurements || [];
      if (!measurements.length) return null;
      var asGsc = measurements.map(function (m) {
        return {
          query: m.keyword || '',
          page: m.url || '',
          impressions: m.impressions || 0,
          clicks: m.clicks || 0,
          position: m.position || 0
        };
      }).filter(function (r) { return r.query || r.page; });
      var gsc = aggregateGscRows(asGsc, 28);
      var sessions = measurements.reduce(function (s, m) { return s + (Number(m.sessions) || 0); }, 0);
      var keyEvents = measurements.reduce(function (s, m) { return s + (Number(m.keyEvents) || 0); }, 0);
      if (sessions > 0 || keyEvents > 0) {
        gsc.ga4 = {
          evidenceClass: 'Official',
          source: 'Studio measurements',
          monthlySessions: scaleToMonthly(sessions, 28),
          monthlyKeyEvents: scaleToMonthly(keyEvents, 28)
        };
      }
      gsc.source = 'Studio localStorage';
      return gsc;
    } catch (e) {
      return null;
    }
  }

  function applyBaselineToForm(baseline) {
    if (!baseline) return;
    var visitorsEl = q('arp-visitors');
    var inqEl = q('arp-inquiries');
    if (baseline.ga4 && baseline.ga4.monthlySessions > 0 && visitorsEl) {
      visitorsEl.value = baseline.ga4.monthlySessions;
      visitorsEl.dataset.evidence = 'Official';
    } else if (baseline.monthlyClicks > 0 && visitorsEl) {
      visitorsEl.value = baseline.monthlyClicks;
      visitorsEl.dataset.evidence = 'Official';
    }
    if (baseline.ga4 && baseline.ga4.monthlyKeyEvents > 0 && inqEl && !inqEl.dataset.userTouched) {
      inqEl.value = baseline.ga4.monthlyKeyEvents;
      inqEl.dataset.evidence = 'Official';
    }
  }

  function keywordOpportunity(row, cvr, close, order, margin) {
    var addClicks = row.missedClicks || 0;
    var addInquiries = addClicks * cvr;
    var addProfit = addInquiries * close * order * margin;
    return {
      addClicks: addClicks,
      addInquiries: addInquiries,
      addProfit: addProfit,
      evidenceClass: 'Inferred'
    };
  }

  function renderKeywords(baseline) {
    var body = q('arp-kw-body');
    var meta = q('arp-kw-meta');
    var box = q('arp-kw-section');
    if (!body || !box) return;
    if (!baseline || !(baseline.keywords || []).length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    var cvr = n('arp-visitors') > 0 ? n('arp-inquiries') / n('arp-visitors') : 0.02;
    var close = n('arp-close-rate') / 100;
    var order = n('arp-order-value');
    var margin = n('arp-margin') / 100;
    if (meta) {
      meta.textContent =
        'Official · ' + baseline.source +
        ' · 期間≒' + (baseline.periodDays || 28) + '日を月次換算' +
        ' · 表示 ' + count(baseline.monthlyImpressions) +
        ' / クリック ' + count(baseline.monthlyClicks) +
        ' / CTR ' + pct(baseline.avgCtr) +
        (baseline.ga4 ? ' · GA4 sessions ' + count(baseline.ga4.monthlySessions) : '');
    }
    body.innerHTML = baseline.keywords.slice(0, 20).map(function (row) {
      var opp = keywordOpportunity(row, cvr, close, order, margin);
      return '<tr>' +
        '<td>' + String(row.query).replace(/</g, '&lt;') + '</td>' +
        '<td>' + count(row.impressions) + '</td>' +
        '<td>' + count(row.clicks) + '</td>' +
        '<td>' + pct(row.ctr || 0) + '</td>' +
        '<td>' + (row.position ? row.position.toFixed(1) : '—') + '</td>' +
        '<td>+' + count(opp.addClicks) + '</td>' +
        '<td>+' + (Math.round(opp.addInquiries * 10) / 10) + '</td>' +
        '<td><span class="arp-chip arp-chip-official">Official</span></td>' +
        '</tr>';
    }).join('');
  }

  function renderBaselineBadge(baseline) {
    var el = q('arp-baseline-badge');
    var chip = q('arp-result-chip');
    if (!el) return;
    if (!baseline) {
      el.textContent = '基準値: User Input（手入力）';
      if (chip) chip.textContent = '条件付き試算 · Inferred';
      return;
    }
    var visitSrc = baseline.ga4 && baseline.ga4.monthlySessions > 0
      ? 'GA4 sessions (Official)'
      : 'GSC clicks (Official)';
    el.textContent = '基準値: ' + visitSrc + ' × 問い合わせは ' +
      (baseline.ga4 && baseline.ga4.monthlyKeyEvents > 0 ? 'GA4 Key Events (Official)' : 'User Input') +
      ' · 改善シナリオは Inferred';
    if (chip) chip.textContent = 'Official基準 × Inferredシナリオ';
  }

  function scenario(mult) {
    var visitors = n('arp-visitors');
    var inquiries = n('arp-inquiries');
    var line = n('arp-line');
    var traffic = n('arp-traffic-uplift') * mult / 100;
    var cvr = n('arp-cvr-uplift') * mult / 100;
    var currentCvr = visitors > 0 ? inquiries / visitors : 0;
    var currentLineRate = visitors > 0 ? line / visitors : 0;
    var newVisitors = visitors * (1 + traffic);
    var newCvr = currentCvr * (1 + cvr);
    var newInquiries = newVisitors * newCvr;
    var newLine = newVisitors * currentLineRate * (1 + cvr);
    var close = n('arp-close-rate') / 100;
    var order = n('arp-order-value');
    var margin = n('arp-margin') / 100;
    var extraInquiries = Math.max(0, newInquiries - inquiries);
    var extraProfit = (close > 0 && order > 0 && margin > 0)
      ? extraInquiries * close * order * margin
      : 0;
    return {
      visitors: newVisitors,
      inquiries: newInquiries,
      line: newLine,
      extraVisitors: newVisitors - visitors,
      extraInquiries: extraInquiries,
      extraLine: newLine - line,
      extraProfit: extraProfit,
      evidenceClass: 'Inferred'
    };
  }

  function render() {
    var baseline = loadBaseline();
    var low = scenario(0.6);
    var base = scenario(1);
    var high = scenario(1.4);
    var fee = n('arp-fee');
    q('arp-extra-visitors').textContent = '+' + count(base.extraVisitors);
    q('arp-extra-inquiries').textContent = '+' + count(base.extraInquiries);
    q('arp-extra-line').textContent = '+' + count(base.extraLine);
    q('arp-extra-profit').textContent = yen(base.extraProfit);
    var rows = [['Low', low], ['Base', base], ['High', high]];
    q('arp-scenario-body').innerHTML = rows.map(function (r) {
      return '<tr><td>' + r[0] + '</td><td>' + count(r[1].visitors) +
        '</td><td>' + count(r[1].inquiries) +
        '</td><td>+' + count(r[1].extraInquiries) +
        '</td><td>' + yen(r[1].extraProfit) + '</td></tr>';
    }).join('');
    if (base.extraProfit > 0 && fee > 0) {
      var roi = (base.extraProfit - fee) / fee * 100;
      q('arp-roi').textContent = (roi >= 0 ? '+' : '') + roi.toFixed(0) + '%';
      q('arp-roi-note').textContent =
        '基準シナリオの追加粗利 ÷ 月額費用から算出した参考ROI（Inferred）。因果効果ではありません。';
    } else {
      q('arp-roi').textContent = '—';
      q('arp-roi-note').textContent =
        '受注率・平均受注額・粗利率・月額費用を入力すると参考ROIを表示します。';
    }
    renderBaselineBadge(baseline);
    renderKeywords(baseline);
  }

  function setStatus(msg, kind) {
    var el = q('arp-import-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'arp-import-status' + (kind ? ' is-' + kind : '');
  }

  function onGscFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var rows = parseCsv(reader.result);
        var period = n('arp-period-days') || 28;
        var gsc = aggregateGscRows(rows, period);
        if (!gsc.keywords.length) throw new Error('クエリ/ページ行が見つかりません');
        var prev = loadBaseline() || {};
        if (prev.ga4) gsc.ga4 = prev.ga4;
        saveBaseline(gsc);
        applyBaselineToForm(gsc);
        if (window.AirReachHandoff) {
          var seedGsc = window.AirReachHandoff.buildSimulatorSeed();
          if (q('arp-traffic-uplift')) q('arp-traffic-uplift').value = seedGsc.trafficUpliftPct;
          if (q('arp-cvr-uplift')) q('arp-cvr-uplift').value = seedGsc.cvrUpliftPct;
        }
        setStatus(
          'Official取込完了: ' + gsc.keywords.length + 'キーワード · 月次換算クリック ' +
          count(gsc.monthlyClicks) + ' · 自動再計算済み',
          'good'
        );
        render();
      } catch (e) {
        setStatus('GSC CSVを読めませんでした: ' + (e && e.message ? e.message : e), 'warn');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function onGa4File(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var rows = parseCsv(reader.result);
        var period = n('arp-period-days') || 28;
        var ga4 = aggregateGa4Rows(rows, period);
        var baseline = loadBaseline() || {
          evidenceClass: 'Official',
          source: 'GA4 CSV',
          periodDays: period,
          keywords: [],
          monthlyClicks: 0,
          monthlyImpressions: 0,
          avgCtr: 0
        };
        baseline.ga4 = ga4;
        if (!baseline.source) baseline.source = 'GA4 CSV';
        saveBaseline(baseline);
        applyBaselineToForm(baseline);
        if (window.AirReachHandoff) {
          var seedGa = window.AirReachHandoff.buildSimulatorSeed();
          if (q('arp-traffic-uplift')) q('arp-traffic-uplift').value = seedGa.trafficUpliftPct;
          if (q('arp-cvr-uplift')) q('arp-cvr-uplift').value = seedGa.cvrUpliftPct;
        }
        setStatus(
          'Official GA4取込: sessions ' + count(ga4.monthlySessions) +
          ' / key events ' + count(ga4.monthlyKeyEvents) + '（月次換算）· 自動再計算済み',
          'good'
        );
        render();
      } catch (e) {
        setStatus('GA4 CSVを読めませんでした: ' + (e && e.message ? e.message : e), 'warn');
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function bind() {
    [
      'arp-visitors', 'arp-inquiries', 'arp-line', 'arp-fee', 'arp-close-rate',
      'arp-order-value', 'arp-margin', 'arp-traffic-uplift', 'arp-cvr-uplift', 'arp-period-days'
    ].forEach(function (id) {
      var el = q(id);
      if (!el) return;
      el.addEventListener('input', function () {
        if (id === 'arp-inquiries' || id === 'arp-visitors') el.dataset.userTouched = '1';
        if (id === 'arp-visitors') el.dataset.evidence = 'User Input';
        render();
      });
    });

    var demo = q('arp-demo');
    if (demo) {
      demo.onclick = function () {
        q('arp-visitors').value = 8000;
        q('arp-inquiries').value = 64;
        q('arp-line').value = 30;
        q('arp-fee').value = 200000;
        q('arp-close-rate').value = 18;
        q('arp-order-value').value = 600000;
        q('arp-margin').value = 55;
        q('arp-traffic-uplift').value = 18;
        q('arp-cvr-uplift').value = 12;
        render();
      };
    }

    var gsc = q('arp-gsc-file');
    if (gsc) {
      gsc.addEventListener('change', function () {
        if (gsc.files && gsc.files[0]) onGscFile(gsc.files[0]);
      });
    }
    var ga4 = q('arp-ga4-file');
    if (ga4) {
      ga4.addEventListener('change', function () {
        if (ga4.files && ga4.files[0]) onGa4File(ga4.files[0]);
      });
    }
    var fromStudio = q('arp-load-studio');
    if (fromStudio) {
      fromStudio.addEventListener('click', function () {
        var baseline = baselineFromStudio();
        if (!baseline || !(baseline.keywords || []).length) {
          setStatus('Studioに計測データがありません。StudioでGSC/GA4 CSVを取り込んでください。', 'warn');
          return;
        }
        saveBaseline(baseline);
        applyBaselineToForm(baseline);
        setStatus('StudioのOfficial計測を基準値として読み込みました。', 'good');
        render();
      });
    }

    function applySeed(seed) {
      if (!seed) return;
      if (q('arp-visitors') && !q('arp-visitors').dataset.userTouched) {
        q('arp-visitors').value = seed.monthlyVisitors;
        q('arp-visitors').dataset.evidence = seed.sources.visitors;
      }
      if (q('arp-inquiries') && !q('arp-inquiries').dataset.userTouched) {
        q('arp-inquiries').value = seed.monthlyInquiries;
        q('arp-inquiries').dataset.evidence = seed.sources.inquiries;
      }
      if (q('arp-line')) q('arp-line').value = seed.monthlyLine;
      if (q('arp-fee')) q('arp-fee').value = seed.monthlyFee;
      if (q('arp-close-rate')) q('arp-close-rate').value = seed.closeRatePct;
      if (q('arp-order-value')) q('arp-order-value').value = seed.avgDeal;
      if (q('arp-margin')) q('arp-margin').value = seed.grossMarginPct;
      if (q('arp-traffic-uplift')) q('arp-traffic-uplift').value = seed.trafficUpliftPct;
      if (q('arp-cvr-uplift')) q('arp-cvr-uplift').value = seed.cvrUpliftPct;
    }

    function showHandoffBanner(seed) {
      var banner = q('arp-handoff-banner');
      if (!banner) return;
      var hasHandoff = !!(seed && seed.handoff);
      var hasOfficial = !!(seed && seed.baseline && (
        (seed.baseline.monthlyClicks > 0) ||
        (seed.baseline.ga4 && seed.baseline.ga4.monthlySessions > 0)
      ));
      if (!hasHandoff && !hasOfficial) {
        banner.hidden = true;
        return;
      }
      banner.hidden = false;
      var title = q('arp-handoff-title');
      var body = q('arp-handoff-body');
      var chip = q('arp-auto-chip');
      if (title) {
        title.textContent = hasHandoff
          ? ('無料診断から引き継ぎ · スコア ' + (seed.handoff.overall || '—') + '/100')
          : 'Official実測を基準に自動計算';
      }
      if (body) {
        var parts = [];
        if (hasHandoff && seed.handoff.url) parts.push('URL: ' + seed.handoff.url);
        if (seed.sources) {
          parts.push('訪問基準: ' + seed.sources.visitors);
          parts.push('問い合わせ基準: ' + seed.sources.inquiries);
          parts.push('改善率: ' + seed.sources.uplift +
            '（訪問 +' + seed.trafficUpliftPct + '% / CVR +' + seed.cvrUpliftPct + '%）');
        }
        if (seed.autoReady) {
          parts.push('GSC/GA4実数があるため、追加訪問・追加問い合わせは入力なしで再計算済みです。');
        } else {
          parts.push('訪問・問い合わせは手入力のままです。GSC/GA4 CSVを取り込むと自動入力に切り替わります。');
        }
        parts.push('シミュレーション結果は Inferred（成果保証なし）です。');
        body.textContent = parts.join(' · ');
      }
      if (chip) {
        chip.textContent = seed.autoReady ? 'Auto · Official×Inferred' : 'Diagnose handoff';
        chip.className = 'arp-chip' + (seed.autoReady ? ' arp-chip-official' : '');
      }
    }

    var seed = window.AirReachHandoff
      ? window.AirReachHandoff.buildSimulatorSeed()
      : null;

    // Prefer shared handoff seed; fall back to raw baseline only
    if (seed) {
      applySeed(seed);
      showHandoffBanner(seed);
      if (seed.autoReady) {
        setStatus(
          '自動計算: ' + seed.sources.visitors + ' / ' + seed.sources.inquiries +
          ' · 改善率は診断スコア由来（Inferred）',
          'good'
        );
      } else if (seed.handoff) {
        setStatus(
          '診断スコア ' + seed.handoff.overall +
          ' から改善率を自動設定しました。GSC/GA4 CSVを入れると訪問・問い合わせも自動入力されます。',
          'good'
        );
      }
    } else {
      var existing = loadBaseline();
      if (existing) applyBaselineToForm(existing);
    }

    // URL params: score override
    try {
      var hash = location.hash || '';
      var qs = hash.indexOf('?') >= 0 ? hash.slice(hash.indexOf('?') + 1) : location.search.replace(/^\?/, '');
      var params = new URLSearchParams(qs);
      if (params.get('score') && window.AirReachHandoff) {
        var lifts = window.AirReachHandoff.liftsFromScore(params.get('score'), 78);
        if (q('arp-traffic-uplift')) q('arp-traffic-uplift').value = lifts.trafficUpliftPct;
        if (q('arp-cvr-uplift')) q('arp-cvr-uplift').value = lifts.cvrUpliftPct;
      }
    } catch (e) {}

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
