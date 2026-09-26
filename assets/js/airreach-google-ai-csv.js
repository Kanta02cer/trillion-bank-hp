/**
 * Google Search Console Generative AI Performance CSV → Official evidence.
 * No invented API. Import-only until Google documents a public endpoint.
 */
(function (root) {
  'use strict';

  function parseCsv(text) {
    var rows = [], row = [], cur = '', quote = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i], nx = text[i + 1];
      if (ch === '"' && quote && nx === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { quote = !quote; continue; }
      if (ch === ',' && !quote) { row.push(cur); cur = ''; continue; }
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
    Object.keys(row).forEach(function (k) { lower[k.toLowerCase()] = row[k]; });
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

  /**
   * Accepts Generative AI Performance export rows.
   * Flexible headers: Date, Page, Country, Device, Impressions (+ JP variants).
   */
  function aggregate(rows, periodDays) {
    var totalImp = 0;
    var byPage = {};
    var byDate = {};
    var byCountry = {};
    var byDevice = {};
    var accepted = 0;

    (rows || []).forEach(function (r) {
      var page = String(pick(r, [
        'Page', 'page', 'URL', 'url', 'Landing page', 'ページ', '上位のページ'
      ])).trim();
      var date = String(pick(r, ['Date', 'date', '日付', '日'])).trim();
      var country = String(pick(r, ['Country', 'country', '国'])).trim() || '(all)';
      var device = String(pick(r, ['Device', 'device', 'デバイス'])).trim() || '(all)';
      var imp = num(pick(r, [
        'Impressions', 'impressions', 'Impression', '表示回数',
        'AI Overviews impressions', 'AI Mode impressions', '生成AIの表示回数'
      ]));
      // skip classic Search Performance rows that look like query+clicks without generative signals
      var hasQuery = String(pick(r, ['Query', 'query', '検索クエリ', 'クエリ'])).trim();
      var clicks = num(pick(r, ['Clicks', 'clicks', 'クリック数', 'クリック']));
      if (hasQuery && !page && clicks >= 0 && imp > 0 && !date) {
        // still allow if impressions present — but prefer page-based gen AI exports
      }
      if (!page && !date && imp <= 0) return;
      accepted++;
      totalImp += imp;
      var pk = page || '(no page)';
      if (!byPage[pk]) byPage[pk] = { page: pk, impressions: 0 };
      byPage[pk].impressions += imp;
      if (date) {
        if (!byDate[date]) byDate[date] = { date: date, impressions: 0 };
        byDate[date].impressions += imp;
      }
      if (!byCountry[country]) byCountry[country] = { country: country, impressions: 0 };
      byCountry[country].impressions += imp;
      if (!byDevice[device]) byDevice[device] = { device: device, impressions: 0 };
      byDevice[device].impressions += imp;
    });

    var pages = Object.keys(byPage).map(function (k) { return byPage[k]; })
      .sort(function (a, b) { return b.impressions - a.impressions; });
    var dates = Object.keys(byDate).map(function (k) { return byDate[k]; })
      .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    var countries = Object.keys(byCountry).map(function (k) { return byCountry[k]; })
      .sort(function (a, b) { return b.impressions - a.impressions; });
    var devices = Object.keys(byDevice).map(function (k) { return byDevice[k]; })
      .sort(function (a, b) { return b.impressions - a.impressions; });

    return {
      evidenceClass: 'Official',
      source: 'GSC Generative AI CSV',
      periodDays: periodDays || null,
      totalImpressions: totalImp,
      rowCount: accepted,
      pages: pages.slice(0, 100),
      dates: dates,
      countries: countries.slice(0, 50),
      devices: devices,
      importedAt: new Date().toISOString(),
      note: 'AI Overviews / AI Mode の表示回数（Official）。掲載・順位・引用の保証ではない。通常検索の Imp/Click とは別指標。'
    };
  }

  function fromCsvText(text, periodDays) {
    return aggregate(parseCsv(text), periodDays);
  }

  root.AirReachGoogleAiCsv = {
    parseCsv: parseCsv,
    aggregate: aggregate,
    fromCsvText: fromCsvText
  };
})(typeof window !== 'undefined' ? window : globalThis);
