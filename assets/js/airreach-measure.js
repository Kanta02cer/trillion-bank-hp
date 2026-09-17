/**
 * AirReach real-number measurement helpers.
 * - GSC Performance CSV/TSV import (actual Google Search Console exports)
 * - AI answer hand-measurement log (actual observations by the user)
 * Does not call live Google OAuth or live LLM APIs.
 */
(function () {
  'use strict';

  function yen(n) { return Math.round(Number(n) || 0); }
  function round1(n) { return Math.round(Number(n) * 10) / 10; }
  function round4(n) { return Math.round(Number(n) * 10000) / 10000; }

  function assumptionsFrom(result) {
    var a = (result && result.opportunity && result.opportunity.assumptions) || {};
    return {
      cvr: a.cvr != null ? a.cvr : 0.02,
      expectedCvValueYen: a.expectedCvValueYen != null ? a.expectedCvValueYen : 150000,
      grossMargin: a.grossMargin != null ? a.grossMargin : 0.7,
      reachableCtr: a.reachableCtr != null ? a.reachableCtr : 0.06
    };
  }

  function stripBom(text) {
    return String(text || '').replace(/^\uFEFF/, '');
  }

  function detectDelimiter(headerLine) {
    var commas = (headerLine.match(/,/g) || []).length;
    var tabs = (headerLine.match(/\t/g) || []).length;
    var semis = (headerLine.match(/;/g) || []).length;
    if (tabs >= commas && tabs >= semis) return '\t';
    if (semis > commas) return ';';
    return ',';
  }

  function splitCsvLine(line, delim) {
    var out = [];
    var cur = '';
    var inQ = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === delim && !inQ) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map(function (s) { return String(s || '').trim(); });
  }

  function normalizeHeader(h) {
    return String(h || '').toLowerCase().replace(/\s+/g, '').replace(/"/g, '');
  }

  function mapHeader(headers) {
    var idx = { query: -1, clicks: -1, impressions: -1, ctr: -1, position: -1, page: -1 };
    headers.forEach(function (h, i) {
      var n = normalizeHeader(h);
      if (n === 'query' || n === 'クエリ' || n === '検索クエリ' || n.indexOf('query') >= 0 || n.indexOf('クエリ') >= 0) {
        if (idx.query < 0) idx.query = i;
      } else if (n === 'page' || n === 'ページ' || n === 'landingpage' || n === '上位のページ') {
        if (idx.page < 0) idx.page = i;
      } else if (n === 'clicks' || n === 'クリック数' || n === 'クリック') {
        idx.clicks = i;
      } else if (n === 'impressions' || n === '表示回数' || n === 'インプレッション') {
        idx.impressions = i;
      } else if (n === 'ctr') {
        idx.ctr = i;
      } else if (n === 'position' || n === '掲載順位' || n === '平均掲載順位' || n === '順位') {
        idx.position = i;
      }
    });
    return idx;
  }

  function parseNumber(raw) {
    if (raw == null || raw === '') return 0;
    var s = String(raw).replace(/[%％,，\s]/g, '').replace(/　/g, '');
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  function parseCtr(raw, clicks, impressions) {
    if (raw != null && String(raw).trim() !== '') {
      var s = String(raw).trim();
      if (/%|％/.test(s) || parseFloat(s) > 1) return parseNumber(s) / 100;
      var n = parseFloat(s);
      if (isFinite(n)) return n > 1 ? n / 100 : n;
    }
    return impressions > 0 ? clicks / impressions : 0;
  }

  /** Parse GSC Performance export (Queries or Pages). Returns rows with real metrics. */
  function parseGscCsv(text) {
    text = stripBom(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    var lines = text.split('\n').filter(function (l) { return l.trim().length; });
    if (lines.length < 2) throw new Error('CSVにヘッダーとデータ行が必要です。');
    var delim = detectDelimiter(lines[0]);
    var headers = splitCsvLine(lines[0], delim);
    var idx = mapHeader(headers);
    if (idx.query < 0 && idx.page < 0) {
      throw new Error('「クエリ」または「ページ」列が見つかりません。Search ConsoleのパフォーマンスCSVを選んでください。');
    }
    if (idx.impressions < 0 && idx.clicks < 0) {
      throw new Error('「表示回数」または「クリック数」列が見つかりません。');
    }
    var rows = [];
    for (var r = 1; r < lines.length; r++) {
      var cols = splitCsvLine(lines[r], delim);
      var name = idx.query >= 0 ? cols[idx.query] : cols[idx.page];
      if (!name) continue;
      var clicks = idx.clicks >= 0 ? parseNumber(cols[idx.clicks]) : 0;
      var impressions = idx.impressions >= 0 ? parseNumber(cols[idx.impressions]) : 0;
      var ctr = parseCtr(idx.ctr >= 0 ? cols[idx.ctr] : '', clicks, impressions);
      var position = idx.position >= 0 ? parseNumber(cols[idx.position]) : null;
      rows.push({
        name: name,
        kind: idx.query >= 0 ? 'query' : 'page',
        clicks: clicks,
        impressions: impressions,
        ctr: round4(ctr),
        position: position && position > 0 ? round1(position) : null
      });
    }
    if (!rows.length) throw new Error('有効なデータ行がありません。');
    return {
      dataKind: '実測（GSC CSV）',
      source: 'Google Search Console エクスポート',
      importedAt: new Date().toISOString(),
      rowCount: rows.length,
      rows: rows
    };
  }

  function brandTokens(result) {
    var host = (result.plainSummary && result.plainSummary.host) || '';
    var brand = host.replace(/^www\./, '').split('.')[0] || '';
    var tokens = [brand, brand.replace(/-/g, ''), 'trillion', 'トリリオン', 'ハック'];
    if (result.page && result.page.h1) tokens.push(String(result.page.h1).slice(0, 20));
    return tokens.filter(Boolean).map(function (t) { return String(t).toLowerCase(); });
  }

  function isBrandQuery(name, tokens) {
    var q = String(name || '').toLowerCase();
    return tokens.some(function (t) { return t && q.indexOf(t) >= 0; });
  }

  function scoreMatch(themeName, query) {
    var a = String(themeName || '').toLowerCase();
    var b = String(query || '').toLowerCase();
    if (!a || !b) return 0;
    if (a === b) return 100;
    if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return 80;
    var at = a.split(/[\s　・|/／]+/).filter(function (x) { return x.length > 1; });
    var hit = 0;
    at.forEach(function (t) { if (b.indexOf(t) >= 0) hit += 1; });
    return hit ? Math.min(75, 20 + hit * 15) : 0;
  }

  function rowToTheme(row, result, brand) {
    var a = assumptionsFrom(result);
    var reachable = Math.max(row.ctr, a.reachableCtr);
    var missed = Math.max(0, Math.round(row.impressions * reachable - row.clicks));
    var cvOpp = missed * a.cvr;
    var revenueOpp = cvOpp * a.expectedCvValueYen;
    var opportunityScore = Math.min(99, Math.round(
      (row.impressions / 80) * 0.25 +
      (missed / 6) * 0.35 +
      ((row.position || 20) > 10 ? 20 : 8) +
      (brand ? 5 : 15)
    ));
    return {
      name: row.name,
      intent: brand ? 'commercial' : (/比較|おすすめ|料金|選び方/.test(row.name) ? 'comparison' : 'informational'),
      googleVolumeEst: row.impressions,
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: row.ctr,
      currentRank: row.position,
      aiDemandLabel: brand ? '中' : '高',
      opportunityScore: opportunityScore,
      clicksEst: missed,
      cvEst: round1(cvOpp),
      revenueEst: yen(revenueOpp),
      profitEst: yen(revenueOpp * a.grossMargin),
      ctrGap: round4(reachable - row.ctr),
      priority: opportunityScore,
      effort: missed > 200 ? '中' : '低',
      confidence: 88,
      prompts: [row.name, row.name + ' とは', row.name + ' おすすめ'],
      action: missed > 0
        ? 'CTR Gapを埋める（タイトル・説明・比較情報の補強）'
        : '維持しつつ関連クエリを拡張',
      dataKind: '実測（GSC CSV）',
      measuredSource: 'GSC CSV',
      brandQuery: brand,
      isBrand: brand
    };
  }

  /**
   * Replace model themes with GSC-measured themes / enrich matches.
   * Prefer real query rows sorted by missed-click opportunity.
   */
  function applyGscImport(result, parsed, options) {
    options = options || {};
    var a = assumptionsFrom(result);
    var tokens = brandTokens(result);
    var rows = (parsed.rows || []).slice();
    var mode = options.mode || 'replace-top'; // replace-top | merge

    var brandImp = 0, brandClicks = 0, nonImp = 0, nonClicks = 0;
    rows.forEach(function (row) {
      if (isBrandQuery(row.name, tokens)) {
        brandImp += row.impressions;
        brandClicks += row.clicks;
      } else {
        nonImp += row.impressions;
        nonClicks += row.clicks;
      }
    });

    var themes;
    if (mode === 'merge' && result.themes && result.themes.length) {
      themes = result.themes.map(function (t) {
        var best = null;
        var bestScore = 0;
        rows.forEach(function (row) {
          var s = scoreMatch(t.name, row.name);
          if (s > bestScore) { bestScore = s; best = row; }
        });
        if (!best || bestScore < 40) return t;
        return Object.assign({}, rowToTheme(best, result, isBrandQuery(best.name, tokens)), {
          name: t.name,
          matchedQuery: best.name,
          matchScore: bestScore,
          action: t.action || rowToTheme(best, result, false).action
        });
      });
    } else {
      themes = rows
        .map(function (row) { return rowToTheme(row, result, isBrandQuery(row.name, tokens)); })
        .sort(function (x, y) { return (y.clicksEst - x.clicksEst) || (y.impressions - x.impressions); })
        .slice(0, 15);
    }

    var totalImp = rows.reduce(function (s, r) { return s + r.impressions; }, 0);
    var totalClicks = rows.reduce(function (s, r) { return s + r.clicks; }, 0);
    var opp = window.AirReachGrowth
      ? window.AirReachGrowth.recomputeOpportunity(themes)
      : null;
    if (opp) {
      opp.dataKind = '実測（GSC CSV）';
      opp.formula = '追加クリック ≒ 実測表示回数 × max(実測CTR, 到達可能CTR) − 実測クリック。追加CV ≒ 追加クリック × CVR（' + (a.cvr * 100) + '%）。';
      opp.assumptions = Object.assign({}, a, {
        note: '表示・クリック・順位はGSC CSVの実測。CVR・期待価値は前提値（GA4未接続時）。'
      });
    }

    var searchMeasured = {
      dataKind: '実測（GSC CSV）',
      source: parsed.source,
      importedAt: parsed.importedAt,
      rowCount: parsed.rowCount,
      totalImpressions: totalImp,
      totalClicks: totalClicks,
      avgCtr: totalImp > 0 ? round4(totalClicks / totalImp) : 0,
      brandImpressions: brandImp,
      brandClicks: brandClicks,
      nonBrandImpressions: nonImp,
      nonBrandClicks: nonClicks,
      brandShare: totalImp > 0 ? round4(brandImp / totalImp) : 0
    };

    var top = themes[0];
    var plain = Object.assign({}, result.plainSummary || {}, {
      topTheme: top ? top.name : (result.plainSummary && result.plainSummary.topTheme),
      biggestProblem: totalImp
        ? ('GSC実測: 表示 ' + totalImp.toLocaleString('ja-JP') + ' / クリック ' + totalClicks.toLocaleString('ja-JP') +
          '。非指名比率 ' + Math.round((1 - searchMeasured.brandShare) * 100) + '%。CTR Gapのあるクエリから改善。')
        : (result.plainSummary && result.plainSummary.biggestProblem),
      verdict: 'Search Consoleの実測で機会を再計算しました。次は弱いクエリのページを直し、AI回答はHackⅡまたは手計測で追います。'
    });

    var next = Object.assign({}, result, {
      themes: themes,
      opportunity: opp || result.opportunity,
      searchMeasured: searchMeasured,
      plainSummary: plain
    });
    if (window.AirReachGrowth && window.AirReachGrowth.refreshMeasurementProgress) {
      window.AirReachGrowth.refreshMeasurementProgress(next, { searchMeasured: true, hack2Sample: false, hack2Measured: !!(result.aiMeasured && result.aiMeasured.sampleSize) });
    }
    return next;
  }

  /** Record one AI-answer observation (hand measurement). */
  function addAiObservation(result, obs) {
    var list = ((result.aiMeasured && result.aiMeasured.observations) || []).slice();
    var entry = {
      at: obs.at || new Date().toISOString(),
      prompt: String(obs.prompt || '').trim(),
      model: String(obs.model || 'ChatGPT').trim(),
      mentioned: !!obs.mentioned,
      cited: !!obs.cited,
      recommended: !!obs.recommended,
      position: obs.position != null && obs.position !== '' ? Number(obs.position) : null,
      citationUrl: String(obs.citationUrl || '').trim(),
      competitorMentioned: !!obs.competitorMentioned,
      note: String(obs.note || '').trim()
    };
    if (!entry.prompt) throw new Error('プロンプト（質問文）を入力してください。');
    list.push(entry);
    return finalizeAiMeasured(result, list);
  }

  function finalizeAiMeasured(result, observations) {
    var n = observations.length;
    var mentioned = observations.filter(function (o) { return o.mentioned; }).length;
    var cited = observations.filter(function (o) { return o.cited; }).length;
    var recommended = observations.filter(function (o) { return o.recommended; }).length;
    var positions = observations.map(function (o) { return o.position; }).filter(function (p) { return p != null && isFinite(p); });
    var avgPos = positions.length
      ? round1(positions.reduce(function (s, p) { return s + p; }, 0) / positions.length)
      : null;
    var mentionRate = n ? Math.round((mentioned / n) * 100) : 0;
    var citationRate = n ? Math.round((cited / n) * 100) : 0;
    var recommendationRate = n ? Math.round((recommended / n) * 100) : 0;
    var visibility = Math.round(mentionRate * 0.5 + citationRate * 0.25 + recommendationRate * 0.25);

    var byModel = {};
    observations.forEach(function (o) {
      if (!byModel[o.model]) byModel[o.model] = { n: 0, mentioned: 0, cited: 0, recommended: 0 };
      byModel[o.model].n += 1;
      if (o.mentioned) byModel[o.model].mentioned += 1;
      if (o.cited) byModel[o.model].cited += 1;
      if (o.recommended) byModel[o.model].recommended += 1;
    });

    var aiMeasured = {
      dataKind: '実測（手計測）',
      sampleSize: n,
      measuredAt: new Date().toISOString(),
      mentionRate: mentionRate,
      citationRate: citationRate,
      recommendationRate: recommendationRate,
      aiVisibility: visibility,
      averagePosition: avgPos,
      byModel: byModel,
      observations: observations,
      disclaimer: '手計測の実測です。サンプル数・モデル・日時に依存します。HackⅡの同条件自動測定とは異なります。'
    };

    var themes = (result.themes || []).map(function (t, i) {
      var related = observations.filter(function (o) {
        return scoreMatch(t.name, o.prompt) >= 40 || o.prompt.indexOf(t.name) >= 0;
      });
      var use = related.length ? related : (i === 0 ? observations : []);
      if (!use.length) {
        return Object.assign({}, t, {
          hack2: {
            theme: t.name,
            dataKind: '実測（手計測・テーマ未割当）',
            disclaimer: aiMeasured.disclaimer,
            metrics: null,
            whyLosing: null
          }
        });
      }
      var mN = use.length;
      var mMen = use.filter(function (o) { return o.mentioned; }).length;
      var mCit = use.filter(function (o) { return o.cited; }).length;
      var mRec = use.filter(function (o) { return o.recommended; }).length;
      var mComp = use.filter(function (o) { return o.competitorMentioned; }).length;
      var mPos = use.map(function (o) { return o.position; }).filter(function (p) { return p != null && isFinite(p); });
      var metrics = {
        aiVisibility: Math.round(((mMen / mN) * 0.5 + (mCit / mN) * 0.25 + (mRec / mN) * 0.25) * 100),
        brandMentionRate: Math.round((mMen / mN) * 100),
        citationRate: Math.round((mCit / mN) * 100),
        recommendationRate: Math.round((mRec / mN) * 100),
        top1Rate: Math.round((use.filter(function (o) { return o.position === 1; }).length / mN) * 100),
        shareOfVoice: Math.round((mMen / Math.max(mN, mComp || mN)) * 100),
        citationShare: Math.round((mCit / mN) * 100),
        averagePosition: mPos.length ? round1(mPos.reduce(function (s, p) { return s + p; }, 0) / mPos.length) : null,
        sampleSize: mN
      };
      return Object.assign({}, t, {
        hack2: {
          theme: t.name,
          dataKind: '実測（手計測）',
          disclaimer: aiMeasured.disclaimer + ' このテーマに紐づく観測 n=' + mN,
          metrics: metrics,
          whyLosing: {
            competitorName: '競合（手計測）',
            competitorRec: Math.round((mComp / mN) * 100),
            selfRec: metrics.recommendationRate,
            gaps: [
              { label: '観測数', competitor: String(mComp), self: String(mMen) },
              { label: '引用あり', competitor: '—', self: metrics.citationRate + '%' },
              { label: '推薦あり', competitor: Math.round((mComp / mN) * 100) + '%', self: metrics.recommendationRate + '%' }
            ]
          }
        }
      });
    });

    var next = Object.assign({}, result, {
      themes: themes,
      aiMeasured: aiMeasured,
      hack2Sample: false,
      plainSummary: Object.assign({}, result.plainSummary || {}, {
        verdict: 'AI回答の手計測が ' + n + ' 件あります。Mention ' + mentionRate + '% / Citation ' + citationRate + '% / Recommendation ' + recommendationRate + '%。'
      })
    });
    if (window.AirReachGrowth && window.AirReachGrowth.refreshMeasurementProgress) {
      window.AirReachGrowth.refreshMeasurementProgress(next, {
        searchMeasured: !!(next.searchMeasured),
        hack2Measured: true,
        hack2Sample: false
      });
    }
    return next;
  }

  window.AirReachMeasure = {
    parseGscCsv: parseGscCsv,
    applyGscImport: applyGscImport,
    addAiObservation: addAiObservation,
    finalizeAiMeasured: finalizeAiMeasured
  };
})();
