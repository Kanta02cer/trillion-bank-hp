/**
 * AirReach Studio — browser-only Phase 1 workspace.
 *
 * Data sources stay separate: estimated market demand is never replaced by or
 * added to GSC impressions. Generated files are drafts and are never deployed.
 */
(function (root) {
  'use strict';

  var STORAGE_KEY = 'airreach_studio_v2';
  var LEGACY_KEY = 'airreach_studio_v1';
  var BASELINE_KEY = 'airreach_official_baseline_v1';
  var SCHEMA_VERSION = 2;
  var ACTION_TYPES = ['existing', 'new', 'faq', 'schema', 'link'];
  var state;
  var overviewShowAll = false;
  var overviewJob = null;
  var orchestratorUnsubscribe = null;

  function q(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
  }

  function each(nodes, callback) {
    Array.prototype.forEach.call(nodes || [], callback);
  }

  function isArray(value) {
    return Array.isArray(value);
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !isArray(value);
  }

  function cloneValue(value, seen, copies) {
    var index;
    var output;
    var keys;
    var i;
    if (value === null || typeof value !== 'object') return value;
    if (Object.prototype.toString.call(value) === '[object Date]') return new Date(value.getTime());
    if (Object.prototype.toString.call(value) === '[object RegExp]') return new RegExp(value.source, value.flags || '');
    if (typeof Uint8Array !== 'undefined' && value instanceof Uint8Array) return new Uint8Array(value);
    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return value.slice(0);
    seen = seen || [];
    copies = copies || [];
    index = seen.indexOf(value);
    if (index >= 0) return copies[index];
    output = isArray(value) ? [] : {};
    seen.push(value);
    copies.push(output);
    keys = Object.keys(value);
    for (i = 0; i < keys.length; i += 1) output[keys[i]] = cloneValue(value[keys[i]], seen, copies);
    return output;
  }

  function clone(value) {
    return cloneValue(value, [], []);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function text(value) {
    return String(value == null ? '' : value);
  }

  function cleanText(value) {
    return text(value).replace(/^\s+|\s+$/g, '');
  }

  function safeLine(value) {
    return cleanText(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ');
  }

  function pad3(value) {
    var output = String(value);
    while (output.length < 3) output = '0' + output;
    return output;
  }

  function sanitizePublicUrl(value, allowEmpty) {
    var raw = cleanText(value);
    var Constructor = root.URL || (typeof URL !== 'undefined' ? URL : null);
    var parsed;
    if (!raw && allowEmpty) return '';
    try {
      if (!Constructor) throw new Error('URL unavailable');
      parsed = new Constructor(raw);
      if (!/^https?:$/i.test(parsed.protocol) || !parsed.hostname) throw new Error('invalid protocol');
      parsed.username = '';
      parsed.password = '';
      // Query values are not required by Phase 1 and can contain tokens,
      // sessions, personal identifiers, or campaign data. Persist the public
      // page URL only, and never include fragments in a job or artifact.
      parsed.search = '';
      parsed.hash = '';
      return parsed.href;
    } catch (e) {
      if (allowEmpty) return '';
      throw new Error('URLの形式を確認してください。');
    }
  }

  function sanitizeArtifactUrl(value, preserveGeneratedFragment) {
    var raw = cleanText(value);
    var Constructor = root.URL || (typeof URL !== 'undefined' ? URL : null);
    var parsed;
    var fragment = '';
    if (!raw) return '';
    try {
      if (!Constructor) return '';
      parsed = new Constructor(raw);
      if (preserveGeneratedFragment && /^#(?:faq|schema|internal-links)$/.test(parsed.hash)) fragment = parsed.hash;
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      parsed.hash = '';
      if (!/^https?:$/i.test(parsed.protocol) || !parsed.hostname) return '';
      return parsed.href + fragment;
    } catch (e) {
      return '';
    }
  }

  function safeGscProperty(value) {
    var property = cleanText(value);
    if (property.indexOf('sc-domain:') === 0) {
      var domain = property.slice('sc-domain:'.length).toLowerCase().replace(/^www\./, '');
      return /^[a-z0-9.-]+$/.test(domain) ? 'sc-domain:' + domain : null;
    }
    return sanitizePublicUrl(property, true) || null;
  }

  function esc(value) {
    return text(value).replace(/[&<>"']/g, function (character) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character];
    });
  }

  function number(value, fallback) {
    var parsed;
    if (value === null || value === undefined || value === '') return fallback == null ? 0 : fallback;
    parsed = Number(text(value).replace(/[%,\s]/g, ''));
    return isFinite(parsed) ? parsed : (fallback == null ? 0 : fallback);
  }

  function nullableNumber(value) {
    var parsed;
    if (value === null || value === undefined || cleanText(value) === '') return null;
    parsed = Number(text(value).replace(/[%,\s]/g, ''));
    return isFinite(parsed) ? parsed : null;
  }

  function measuredBinary(value) {
    var normalized;
    var parsed;
    if (value === null || value === undefined || cleanText(value) === '') return null;
    if (value === true) return 1;
    if (value === false) return 0;
    normalized = normalizeKeyword(value);
    if (/^(true|yes|あり|有|言及あり|引用あり)$/.test(normalized)) return 1;
    if (/^(false|no|なし|無|言及なし|引用なし)$/.test(normalized)) return 0;
    parsed = Number(normalized);
    return isFinite(parsed) && (parsed === 0 || parsed === 1) ? parsed : null;
  }

  function percent(numerator, denominator) {
    return denominator ? (numerator / denominator) * 100 : 0;
  }

  function formatNumber(value) {
    if (value === null || value === undefined || !isFinite(Number(value))) return '未取得';
    return String(Math.round(Number(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function normalizeKeyword(value) {
    var normalized = text(value);
    try {
      if (normalized.normalize) normalized = normalized.normalize('NFKC');
    } catch (e) {
      // Older browsers may not support String#normalize.
    }
    return normalized.toLowerCase().replace(/[\u3000\s]+/g, ' ').replace(/^\s+|\s+$/g, '');
  }

  function defaultSources() {
    return {
      gsc: {
        status: 'not_connected',
        source: 'GSC CSV',
        evidence_class: 'Official',
        imported_at: null,
        period_start: null,
        period_end: null,
        row_count: 0
      },
      ga4: {
        status: 'not_connected',
        source: 'GA4 CSV',
        evidence_class: 'Official',
        imported_at: null,
        period_start: null,
        period_end: null,
        row_count: 0
      },
      hack2: {
        status: 'not_connected',
        source: 'HackⅡ JSON import',
        evidence_class: 'Customer Supplied',
        imported_at: null,
        period_start: null,
        period_end: null,
        row_count: 0
      }
    };
  }

  function defaultState() {
    return {
      schema_version: SCHEMA_VERSION,
      profile: { url: '', brand: '', service: '', audience: '', summary: '' },
      competitors: [],
      keywords: [],
      measurements: [],
      hack2: [],
      google: { gscSite: '', gaProperty: '' },
      generated: {},
      faqSuggestions: [],
      sources: defaultSources(),
      analysis_job: null,
      migration: null,
      updated_at: null
    };
  }

  function safeStorageGet(key) {
    try {
      return root.localStorage ? root.localStorage.getItem(key) : null;
    } catch (e) {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      if (root.localStorage) root.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  function safeStorageRemove(key) {
    try {
      if (root.localStorage) root.localStorage.removeItem(key);
    } catch (e) {
      // Storage can be unavailable in private/restricted contexts.
    }
  }

  function parseStored(raw) {
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      return isObject(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function normalizeExpertKeyword(keyword) {
    keyword = isObject(keyword) ? keyword : {};
    return {
      id: safeLine(keyword.id) || uid('kw'),
      text: safeLine(keyword.text || keyword.keyword),
      intent: safeLine(keyword.intent) || 'Informational',
      cluster: safeLine(keyword.cluster) || 'Core',
      priority: /^(P0|P1|P2)$/.test(keyword.priority) ? keyword.priority : 'P1',
      targetUrl: sanitizePublicUrl(keyword.targetUrl || keyword.target_url, true),
      status: safeLine(keyword.status) || '未対策'
    };
  }

  function markInterrupted(job) {
    var copy;
    if (!isObject(job)) return null;
    copy = clone(job);
    if (copy.status === 'running' || copy.status === 'validating') {
      copy.status = 'interrupted';
      copy.current_step = null;
      copy.completed_at = nowIso();
      copy.error = {
        step: 'resume',
        code: 'INTERRUPTED',
        message: 'ページの再読み込みにより前回の分析が中断されました。再度実行してください。'
      };
      if (isArray(copy.steps)) {
        copy.steps.forEach(function (step) {
          if (step.status === 'running') {
            step.status = 'interrupted';
            step.completed_at = copy.completed_at;
          }
        });
      }
    }
    return copy;
  }

  function migrateLegacy(legacy) {
    var next = defaultState();
    var old = isObject(legacy) ? legacy : {};
    next.profile = isObject(old.profile) ? {
      url: sanitizePublicUrl(old.profile.url, true),
      brand: safeLine(old.profile.brand),
      service: safeLine(old.profile.service),
      audience: safeLine(old.profile.audience),
      summary: text(old.profile.summary)
    } : next.profile;
    next.competitors = isArray(old.competitors) ? old.competitors.map(function (item) {
      return { url: sanitizePublicUrl(item && item.url, true), note: text(item && item.note) };
    }).filter(function (item) { return !!item.url; }) : [];
    next.keywords = isArray(old.keywords) ? old.keywords.map(normalizeExpertKeyword).filter(function (item) {
      return !!item.text;
    }) : [];

    // v1 mixed GSC, GA4, sample, and other rows without provenance. Preserve
    // them for Expert View, but never promote them to Official/GSC in Overview.
    next.measurements = isArray(old.measurements) ? old.measurements.map(function (row) {
      row = isObject(row) ? row : {};
      return {
        id: uid('legacy'),
        source_type: 'legacy',
        source: 'Studio v1 migration',
        evidence_class: 'Unverified',
        date: safeLine(row.date),
        keyword: safeLine(row.keyword),
        normalized_keyword: normalizeKeyword(row.keyword),
        url: sanitizePublicUrl(row.url, true),
        impressions: nullableNumber(row.impressions),
        clicks: nullableNumber(row.clicks),
        position: nullableNumber(row.position),
        sessions: nullableNumber(row.sessions),
        key_events: nullableNumber(row.keyEvents),
        ai_mention: row.aiMention == null ? null : number(row.aiMention),
        ai_citation: row.aiCitation == null ? null : number(row.aiCitation)
      };
    }) : [];
    next.hack2 = isArray(old.hack2) ? old.hack2.map(function (row) {
      var migrated = clone(row || {});
      migrated.id = migrated.id || uid('hack2_legacy');
      migrated.source_type = 'hack2';
      migrated.source = 'HackⅡ JSON import (v1 migration)';
      migrated.evidence_class = 'Customer Supplied';
      return migrated;
    }) : [];
    next.google = isObject(old.google) ? {
      gscSite: safeLine(old.google.gscSite),
      gaProperty: safeLine(old.google.gaProperty)
    } : next.google;
    next.faqSuggestions = isArray(old.faqSuggestions) ? old.faqSuggestions.map(safeLine).filter(Boolean) : [];
    next.generated = {};
    next.migration = {
      from: LEGACY_KEY,
      migrated_at: nowIso(),
      note: 'v1の出典不明な計測値はUnverifiedとし、旧生成ファイルは安全のため再利用していません。'
    };
    next.sources.hack2.status = next.hack2.length ? 'imported' : 'not_connected';
    next.sources.hack2.row_count = next.hack2.length;
    next.updated_at = nowIso();
    return next;
  }

  function hydrateV2(raw) {
    var next = defaultState();
    if (!isObject(raw)) return next;
    if (isObject(raw.profile)) {
      next.profile = clone(raw.profile);
      next.profile.url = sanitizePublicUrl(next.profile.url, true);
    }
    if (isArray(raw.competitors)) {
      next.competitors = raw.competitors.map(function (competitor) {
        return { url: sanitizePublicUrl(competitor && competitor.url, true), note: text(competitor && competitor.note) };
      }).filter(function (competitor) { return !!competitor.url; });
    }
    if (isArray(raw.keywords)) next.keywords = raw.keywords.map(normalizeExpertKeyword).filter(function (item) { return !!item.text; });
    if (isArray(raw.measurements)) {
      next.measurements = clone(raw.measurements).map(function (row) {
        if (row && row.url !== undefined) row.url = sanitizePublicUrl(row.url, true);
        return row;
      });
    }
    if (isArray(raw.hack2)) next.hack2 = clone(raw.hack2);
    if (isObject(raw.google)) next.google = clone(raw.google);
    if (isObject(raw.generated)) next.generated = clone(raw.generated);
    if (isArray(raw.faqSuggestions)) next.faqSuggestions = clone(raw.faqSuggestions);
    if (isObject(raw.sources)) {
      ['gsc', 'ga4', 'hack2'].forEach(function (name) {
        if (isObject(raw.sources[name])) next.sources[name] = clone(raw.sources[name]);
      });
    }
    next.analysis_job = sanitizeAnalysisJob(markInterrupted(raw.analysis_job));
    next.migration = raw.migration ? clone(raw.migration) : null;
    next.updated_at = raw.updated_at || null;
    return next;
  }

  function loadState() {
    var current = parseStored(safeStorageGet(STORAGE_KEY));
    var legacy;
    if (current && Number(current.schema_version) === SCHEMA_VERSION) return hydrateV2(current);
    legacy = parseStored(safeStorageGet(LEGACY_KEY));
    if (legacy) {
      current = migrateLegacy(legacy);
      safeStorageSet(STORAGE_KEY, JSON.stringify(current));
      return current;
    }
    return defaultState();
  }

  function persist(render) {
    state.schema_version = SCHEMA_VERSION;
    state.updated_at = nowIso();
    safeStorageSet(STORAGE_KEY, JSON.stringify(state));
    if (render !== false) renderAll();
  }

  function getState() {
    return clone(state);
  }

  function sanitizeAnalysisJob(job) {
    var copy = clone(job);
    if (!isObject(copy)) return null;
    if (isObject(copy.input)) {
      if (copy.input.url !== undefined) copy.input.url = sanitizePublicUrl(copy.input.url, true);
      if (copy.input.target_url !== undefined) copy.input.target_url = sanitizePublicUrl(copy.input.target_url, true);
    }
    if (copy.diagnosis && copy.diagnosis.page) {
      if (copy.diagnosis.page.baseHref !== undefined) copy.diagnosis.page.baseHref = sanitizePublicUrl(copy.diagnosis.page.baseHref, true);
      if (copy.diagnosis.page.canonical !== undefined) copy.diagnosis.page.canonical = sanitizePublicUrl(copy.diagnosis.page.canonical, true);
    }
    if (isArray(copy.keyword_candidates)) {
      copy.keyword_candidates.forEach(function (candidate) {
        if (candidate && candidate.target_url !== undefined) candidate.target_url = sanitizeArtifactUrl(candidate.target_url, false);
      });
    }
    if (isArray(copy.actions)) {
      copy.actions.forEach(function (action) {
        if (!action) return;
        if (action.target_url) action.target_url = sanitizeArtifactUrl(action.target_url, true);
        action.target_key = safeLine(action.type || 'action') + '|' + normalizeKeyword(action.target_url || 'unbound');
      });
    }
    return copy;
  }

  function setAnalysisJob(job) {
    state.analysis_job = job ? sanitizeAnalysisJob(job) : null;
    overviewJob = state.analysis_job;
    persist(false);
    renderAnalysisJob(overviewJob);
    return clone(state.analysis_job);
  }

  function sourceRows(sourceType, evidenceClass) {
    return state.measurements.filter(function (row) {
      return row && row.source_type === sourceType && (!evidenceClass || row.evidence_class === evidenceClass);
    });
  }

  function propertyMatchesTarget(property, targetUrl) {
    var target;
    var propertyUrl;
    var domain;
    try {
      target = new (root.URL || URL)(targetUrl);
    } catch (e) {
      return false;
    }
    property = cleanText(property);
    if (!property) return false;
    if (property.indexOf('sc-domain:') === 0) {
      domain = property.slice('sc-domain:'.length).toLowerCase().replace(/^www\./, '');
      if (!domain) return false;
      return target.hostname.toLowerCase() === domain || target.hostname.toLowerCase().slice(-(domain.length + 1)) === '.' + domain;
    }
    try {
      propertyUrl = new (root.URL || URL)(property);
      if (propertyUrl.origin !== target.origin) return false;
      if (!propertyUrl.pathname || propertyUrl.pathname === '/') return true;
      if (target.pathname === propertyUrl.pathname) return true;
      return propertyUrl.pathname.charAt(propertyUrl.pathname.length - 1) === '/'
        ? target.pathname.indexOf(propertyUrl.pathname) === 0
        : target.pathname.indexOf(propertyUrl.pathname + '/') === 0;
    } catch (propertyError) {
      return false;
    }
  }

  function getGscStatus(targetUrl) {
    var rows = sourceRows('gsc', 'Official');
    var meta = state.sources.gsc || defaultSources().gsc;
    var activeJobUrl = state.analysis_job && state.analysis_job.input
      ? (state.analysis_job.input.url || state.analysis_job.input.target_url)
      : '';
    var target = sanitizePublicUrl(targetUrl || activeJobUrl || state.profile.url, true);
    var hasImportedProperty = Object.prototype.hasOwnProperty.call(meta, 'property');
    var property = cleanText(hasImportedProperty ? meta.property : state.google.gscSite);
    var imported = rows.length > 0 && meta.status === 'imported';
    var matches = imported && !!target && propertyMatchesTarget(property, target);
    var status = !imported ? 'not_connected' : (!property ? 'unbound' : (matches ? 'connected' : 'property_mismatch'));
    return {
      connected: matches,
      status: status,
      label: matches ? 'GSC CSV取込済み' : (status === 'unbound' ? 'GSC取込済み・対象未確認' : (status === 'property_mismatch' ? 'GSC対象不一致' : 'GSC未接続')),
      source: matches ? 'GSC CSV' : null,
      evidence_class: matches ? 'Official' : null,
      row_count: rows.length,
      period_start: matches ? (meta.period_start || null) : null,
      period_end: matches ? (meta.period_end || null) : null,
      imported_at: matches ? (meta.imported_at || null) : null,
      property: property || null,
      target_url: target || null
    };
  }

  function exactGscIndex(targetUrl) {
    var index = {};
    if (!getGscStatus(targetUrl).connected) return index;
    sourceRows('gsc', 'Official').forEach(function (row) {
      var key = normalizeKeyword(row.keyword || row.query);
      var weight;
      if (!key) return;
      if (!index[key]) {
        index[key] = {
          impressions: 0,
          clicks: 0,
          position_sum: 0,
          position_weight: 0,
          period_start: null,
          period_end: null
        };
      }
      index[key].impressions += Math.max(0, number(row.impressions));
      index[key].clicks += Math.max(0, number(row.clicks));
      weight = Math.max(1, number(row.impressions));
      if (nullableNumber(row.position) !== null && number(row.position) > 0) {
        index[key].position_sum += number(row.position) * weight;
        index[key].position_weight += weight;
      }
      if (row.date && (!index[key].period_start || row.date < index[key].period_start)) index[key].period_start = row.date;
      if (row.date && (!index[key].period_end || row.date > index[key].period_end)) index[key].period_end = row.date;
    });
    Object.keys(index).forEach(function (key) {
      index[key].position = index[key].position_weight
        ? index[key].position_sum / index[key].position_weight
        : null;
      delete index[key].position_sum;
      delete index[key].position_weight;
    });
    return index;
  }

  function inputValue(input, camel, snake, fallback) {
    if (input && input[camel] !== undefined) return input[camel];
    if (input && input[snake] !== undefined) return input[snake];
    return fallback;
  }

  function estimateDemand(keyword) {
    var sales = root.AirReachSales;
    var result;
    if (sales && typeof sales.estimateSearchVolume === 'function') {
      result = sales.estimateSearchVolume(keyword, 'generic_search');
      return result && nullableNumber(result.value) !== null ? Math.max(0, Math.round(Number(result.value))) : null;
    }

    // Same deterministic model used by AirReachSales. This keeps the Studio
    // usable if scripts are loaded out of order, while retaining Estimated.
    var key = cleanText(keyword);
    var hash = 0;
    var i;
    var base;
    if (!key) return null;
    for (i = 0; i < key.length; i += 1) hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash = Math.abs(hash);
    base = 800 + (hash % 18000);
    if (/おすすめ|比較|料金|費用|口コミ|評判|東京|大阪|クリニック|会社|予約/.test(key)) base = Math.round(base * 1.35);
    if (key.length <= 4) base = Math.round(base * 0.7);
    if (key.length >= 12) base = Math.round(base * 1.15);
    return base;
  }

  function keywordSubject(input, diagnosis) {
    var supplied = safeLine(state.profile.service);
    var observed = diagnosis && diagnosis.page
      ? safeLine(diagnosis.page.h1 || diagnosis.page.title)
      : '';
    var target = sanitizePublicUrl(inputValue(input, 'url', 'target_url', state.profile.url), true);
    var profileUrl = sanitizePublicUrl(state.profile.url, true);
    var host = '';
    if (observed) return observed.slice(0, 80);
    if (input && input.useProfileContext === true && supplied && normalizedOrigin(profileUrl) && normalizedOrigin(profileUrl) === normalizedOrigin(target)) return supplied;
    try {
      host = new (root.URL || URL)(target).hostname.replace(/^www\./, '');
    } catch (e) {
      host = '';
    }
    return host || '対象サイト';
  }

  function keywordIntent(topic) {
    if (/料金|費用|おすすめ|比較|選び方|評判|口コミ|会社|ツール|外注/.test(topic)) return 'Commercial';
    if (/導入|予約|相談/.test(topic)) return 'Transactional';
    return 'Informational';
  }

  function keywordCluster(topic) {
    if (/料金|費用/.test(topic)) return 'Pricing';
    if (/おすすめ|比較|選び方|評判|口コミ|会社|ツール|外注/.test(topic)) return 'Comparison';
    if (/FAQ|セキュリティ|失敗/.test(topic)) return 'Trust';
    return 'Core';
  }

  function candidateAction(topic) {
    if (/料金|費用/.test(topic)) return '料金条件の確認項目を整理';
    if (/おすすめ|比較|選び方|会社|ツール|外注/.test(topic)) return '比較軸の下書きを作成';
    if (/FAQ|失敗|セキュリティ/.test(topic)) return '可視FAQの下書きを作成';
    return '対象ページの説明を確認';
  }

  function buildKeywordCandidates(input, diagnosis) {
    var requested = Number(inputValue(input, 'keywordCount', 'keyword_count', 20));
    var count = requested === 50 || requested === 100 ? requested : 20;
    var region = safeLine(inputValue(input, 'region', 'region', ''));
    var goal = safeLine(inputValue(input, 'goal', 'goal', ''));
    var targetUrl = sanitizePublicUrl(inputValue(input, 'url', 'target_url', state.profile.url), false);
    var subject = keywordSubject(input, diagnosis);
    var goalTopics = ({
      '問い合わせ': ['相談', '問い合わせ', '見積もり'],
      '予約': ['予約', '予約方法', '申し込み'],
      '資料請求': ['資料請求', 'サービス資料', '導入資料'],
      '記事参照': ['解説', '基礎知識', '活用方法'],
      '認知': ['とは', '特徴', '基礎知識']
    })[goal] || (goal ? [goal] : []);
    var baseTopics = [
      'おすすめ', '比較', '料金', '費用', '選び方', '導入', '事例', '評判', '口コミ', 'メリット',
      'デメリット', '自社対応', '外注', '会社', 'ツール', '効果測定', 'KPI', '始め方', '失敗しない方法', 'セキュリティ'
    ];
    var topics = [];
    var topicSeen = {};
    var contexts = [region, '', '法人向け', region ? region + ' 法人向け' : '地域別', '導入前', '中小企業向け', '大企業向け'];
    var generated = [];
    var seen = {};
    var gscStatus = getGscStatus(targetUrl);
    var gsc = exactGscIndex(targetUrl);
    var manual = {};

    goalTopics.concat(baseTopics).forEach(function (topic) {
      var key = normalizeKeyword(topic);
      if (!key || topicSeen[key]) return;
      topicSeen[key] = true;
      topics.push(topic);
    });
    var contextSeen = {};
    contexts = contexts.filter(function (context) {
      var normalized = normalizeKeyword(context);
      var key = normalized || '__empty__';
      if (contextSeen[key]) return false;
      contextSeen[key] = true;
      return true;
    });

    state.keywords.forEach(function (item) {
      var itemTarget = sanitizePublicUrl(item.targetUrl || item.target_url, true);
      if (!itemTarget || normalizedOrigin(itemTarget) !== normalizedOrigin(targetUrl)) return;
      manual[normalizeKeyword(item.text)] = item;
    });

    var attempt = 0;
    var maxAttempts = Math.max(200, count * 8);
    while (generated.length < count && attempt < maxAttempts) {
      var topic = topics[attempt % topics.length];
      var context = contexts[Math.floor(attempt / topics.length) % contexts.length];
      var keyword = [context, subject, topic].filter(function (part) { return !!safeLine(part); }).join(' ');
      var normalized = normalizeKeyword(keyword);
      if (normalized && !seen[normalized]) {
        seen[normalized] = true;
        generated.push({ keyword: keyword, topic: topic, normalized: normalized });
      }
      attempt += 1;
    }

    return generated.slice(0, count).map(function (item, index) {
      var match = gsc[item.normalized] || null;
      var existing = manual[item.normalized] || null;
      return {
        keyword_id: 'kw_' + pad3(index + 1),
        keyword: item.keyword,
        intent: existing ? existing.intent : keywordIntent(item.topic),
        cluster: existing ? existing.cluster : keywordCluster(item.topic),
        priority: existing ? existing.priority : (index < 20 ? 'P0' : (index < 60 ? 'P1' : 'P2')),
        estimated_monthly_demand: estimateDemand(item.keyword),
        volume_source: 'Estimated',
        estimate_method_version: 'airreach-sales-v1',
        gsc_impressions: match ? Math.round(match.impressions) : null,
        gsc_clicks: match ? Math.round(match.clicks) : null,
        gsc_position: match ? match.position : null,
        gsc_period_start: match ? (match.period_start || gscStatus.period_start) : null,
        gsc_period_end: match ? (match.period_end || gscStatus.period_end) : null,
        gsc_source: match ? 'Official' : null,
        gsc_status: match ? 'matched' : (gscStatus.connected ? 'not_matched' : (gscStatus.status || 'not_connected')),
        status: existing ? existing.status : '未対策',
        target_url: existing && existing.targetUrl && normalizedOrigin(existing.targetUrl) === normalizedOrigin(targetUrl)
          ? existing.targetUrl
          : targetUrl,
        competitor_gap: '未計測',
        competitor_gap_source: null,
        action: candidateAction(item.topic),
        ai_prompt_count: 0,
        diagnosis_source: diagnosis && diagnosis.overall != null ? 'Observed' : null
      };
    });
  }

  function buildPromptCandidates(keywords, input) {
    var region = safeLine(inputValue(input, 'region', 'region', ''));
    var output = [];
    (keywords || []).forEach(function (candidate, keywordIndex) {
      var keyword = safeLine(candidate.keyword || candidate.text);
      var keywordId = candidate.keyword_id || ('kw_' + pad3(keywordIndex + 1));
      var regionalPrefix = region && normalizeKeyword(keyword).indexOf(normalizeKeyword(region)) < 0 ? region + 'で' : '';
      var prompts = [
        keyword + 'とは何ですか？',
        keyword + 'を比較するときの確認点は何ですか？',
        regionalPrefix + keyword + 'を検討する際の注意点は何ですか？'
      ];
      prompts.forEach(function (prompt, promptIndex) {
        output.push({
          prompt_id: 'prompt_' + pad3(keywordIndex + 1) + '_' + (promptIndex + 1),
          keyword_id: keywordId,
          keyword: keyword,
          prompt: prompt,
          intent: candidate.intent || 'Informational',
          locale: 'ja-JP',
          generation_basis: 'Rule-based draft',
          status: 'candidate'
        });
      });
    });
    return output;
  }

  function normalizedOrigin(url) {
    try {
      return new (root.URL || URL)(url).origin;
    } catch (e) {
      return cleanText(url).replace(/\/$/, '');
    }
  }

  function buildActions(input, diagnosis, keywords, prompts) {
    var targetUrl = sanitizePublicUrl(inputValue(input, 'url', 'target_url', state.profile.url), false);
    var origin = normalizedOrigin(targetUrl);
    var refs = (keywords || []).slice(0, 5).map(function (candidate) { return candidate.keyword_id; });
    var firstGap = diagnosis && isArray(diagnosis.gaps) && diagnosis.gaps.length
      ? safeLine(diagnosis.gaps[0])
      : '入力URLの公開情報は人間の確認が必要';
    var diagnosisAvailable = !!(diagnosis && diagnosis.overall != null);
    var diagnosisGaps = diagnosis && isArray(diagnosis.gaps) ? diagnosis.gaps.map(safeLine) : [];
    var diagnosisActions = [];
    if (diagnosis && isObject(diagnosis.actions)) {
      ['now', 'weeks'].forEach(function (group) {
        if (isArray(diagnosis.actions[group])) diagnosisActions = diagnosisActions.concat(diagnosis.actions[group].map(safeLine));
      });
    }
    // SiteDiagnose always includes a conditional comparison idea ("競合が出る場合…").
    // It is not observed evidence and must not inflate "実装可能件数" on a clean page.
    var actionableDiagnosisActions = diagnosisActions.filter(function (action) {
      return action && !/競合が出る場合/.test(action);
    });
    if (!diagnosisGaps.length && actionableDiagnosisActions.length) firstGap = actionableDiagnosisActions[0];
    var evidenceText = diagnosisGaps.concat(actionableDiagnosisActions).join(' ');
    var faqCount = diagnosis && diagnosis.page ? nullableNumber(diagnosis.page.faqCount) : null;
    var definitions = [
      {
        type: 'existing',
        target_url: targetUrl,
        title: '主要ページの説明を整理',
        reason: firstGap,
        supported: diagnosisAvailable && (diagnosisGaps.length > 0 || actionableDiagnosisActions.length > 0)
      },
      {
        type: 'new',
        target_url: origin + '/comparison/',
        title: '比較ページの下書きを検討',
        reason: '比較・選び方の質問候補を一つの判断材料にまとめる',
        supported: diagnosisAvailable && /比較|選び方|ページ化/.test(evidenceText)
      },
      {
        type: 'faq',
        target_url: targetUrl + (targetUrl.indexOf('#') >= 0 ? '' : '#faq'),
        title: '購入前質問の可視FAQ下書きを作成',
        reason: '生成したAI質問候補に対し、公式回答の確認枠を用意する',
        supported: diagnosisAvailable && (/FAQ|よくある質問/i.test(evidenceText) || (faqCount !== null && faqCount < 3))
      },
      {
        type: 'schema',
        target_url: targetUrl + (targetUrl.indexOf('#') >= 0 ? '' : '#schema'),
        title: '可視本文と一致するSchemaの要否を確認',
        reason: '未確認の事実を構造化データに入れず、実装前に照合する',
        supported: diagnosisAvailable && /schema|構造化|JSON-LD|Organization|FAQPage/i.test(evidenceText)
      },
      {
        type: 'link',
        target_url: targetUrl + (targetUrl.indexOf('#') >= 0 ? '' : '#internal-links'),
        title: '関連ページへの導線を確認',
        reason: '重要な公式情報へ辿り着けるかを人間が確認する',
        supported: diagnosisAvailable && /内部リンク|導線|canonical|llms\.txt|主要ページ/i.test(evidenceText)
      }
    ];
    var seen = {};
    var output = [];
    definitions.forEach(function (definition, index) {
      var key = definition.type + '|' + normalizeKeyword(definition.target_url);
      if (seen[key]) return;
      seen[key] = true;
      output.push({
        id: 'act_' + pad3(index + 1),
        type: definition.type,
        target_key: key,
        title: definition.title,
        target_url: definition.target_url,
        reason: definition.reason,
        evidence_class: definition.supported ? 'Inferred' : 'Unverified',
        source_refs: refs.slice(),
        status: definition.supported ? 'draft' : 'blocked',
        blocked_reason: definition.supported
          ? null
          : (diagnosisAvailable
            ? 'この実装種別を必要とする診断根拠がないため、候補として保留します。'
            : 'サイト確認が完了していないため、実装箇所として確定できません。')
      });
    });
    return output;
  }

  function csvSafeValue(value) {
    var string;
    if (typeof value === 'number' && isFinite(value)) return String(value);
    string = text(value).replace(/\u0000/g, '');
    var trimmed = string.replace(/^\s+/, '');
    if (/^[\t\r\n]/.test(string) || /^[=+\-@]/.test(trimmed)) string = "'" + string;
    return string;
  }

  function csvCell(value) {
    var string = csvSafeValue(value);
    return /[",\r\n]/.test(string) ? '"' + string.replace(/"/g, '""') + '"' : string;
  }

  function toCsv(rows, columns) {
    rows = isArray(rows) ? rows : [];
    columns = isArray(columns) && columns.length
      ? columns.slice()
      : (rows.length && isObject(rows[0]) ? Object.keys(rows[0]) : []);
    return '\uFEFF' + [columns.map(csvCell).join(',')].concat(rows.map(function (row) {
      return columns.map(function (column) { return csvCell(row && row[column]); }).join(',');
    })).join('\r\n');
  }

  function parseCsv(input) {
    var source = text(input).replace(/^\uFEFF/, '');
    var matrix = [];
    var row = [];
    var cell = '';
    var quoted = false;
    var i;
    var character;
    var next;
    var headers;
    for (i = 0; i < source.length; i += 1) {
      character = source.charAt(i);
      next = source.charAt(i + 1);
      if (character === '"') {
        if (quoted && next === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (character === ',' && !quoted) {
        row.push(cell);
        cell = '';
      } else if ((character === '\n' || character === '\r') && !quoted) {
        if (character === '\r' && next === '\n') i += 1;
        row.push(cell);
        if (row.some(function (value) { return value !== ''; })) matrix.push(row);
        row = [];
        cell = '';
      } else {
        cell += character;
      }
    }
    if (quoted) throw new Error('CSVの引用符が閉じられていません。');
    row.push(cell);
    if (row.some(function (value) { return value !== ''; })) matrix.push(row);
    if (!matrix.length) return [];
    headers = matrix.shift().map(function (header) { return cleanText(header); });
    return matrix.map(function (values) {
      var object = {};
      headers.forEach(function (header, index) {
        if (header) object[header] = values[index] == null ? '' : values[index];
      });
      return object;
    });
  }

  function csvRowsForKeywords(keywords) {
    return (keywords || []).map(function (candidate) {
      return {
        priority: candidate.priority,
        keyword: candidate.keyword,
        intent: candidate.intent,
        cluster: candidate.cluster,
        estimated_monthly_demand: candidate.estimated_monthly_demand,
        volume_source: candidate.volume_source,
        gsc_impressions: candidate.gsc_impressions,
        gsc_clicks: candidate.gsc_clicks,
        gsc_position: candidate.gsc_position,
        gsc_period_start: candidate.gsc_period_start,
        gsc_period_end: candidate.gsc_period_end,
        gsc_source: candidate.gsc_source,
        gsc_status: candidate.gsc_status,
        target_url: candidate.target_url,
        competitor_gap: candidate.competitor_gap,
        competitor_gap_source: candidate.competitor_gap_source,
        ai_prompt_count: candidate.ai_prompt_count,
        status: candidate.status,
        action: candidate.action
      };
    });
  }

  function markdownList(items) {
    return items.length ? items.map(function (item) { return '- ' + safeLine(item); }).join('\n') : '- 要確認';
  }

  function bundleFiles(job) {
    var keywords = isArray(job.keyword_candidates) ? job.keyword_candidates : [];
    var prompts = isArray(job.prompt_candidates) ? job.prompt_candidates : [];
    var actions = isArray(job.actions) ? job.actions : [];
    var input = isObject(job.input) ? job.input : {};
    var targetUrl = sanitizePublicUrl(input.url || input.target_url, true);
    var generatedAt = nowIso();
    var gscStatus = isObject(job.gsc_status) ? job.gsc_status : {};
    var gscProperty = safeGscProperty(gscStatus.property);
    var files = {};
    var topKeywords = keywords.slice(0, 20).map(function (candidate) { return candidate.keyword; });
    var actionLines = actions.map(function (action) {
      return '[' + safeLine(action.type) + '] ' + safeLine(action.title) + ' — ' +
        safeLine(action.target_url) + (action.blocked_reason ? '（保留: ' + safeLine(action.blocked_reason) + '）' : '');
    });

    files['README.md'] = [
      '# AirReach Studio implementation draft',
      '',
      '- Status: Draft / human review required',
      '- Target URL: ' + (targetUrl || '未入力'),
      '- Goal: ' + safeLine(input.goal),
      '- Region: ' + safeLine(input.region),
      '- Generated at: ' + generatedAt,
      '- GSC status: ' + safeLine(gscStatus.label || gscStatus.status || 'GSC未接続'),
      '- GSC property: ' + (gscProperty || '未確認'),
      '- GSC period: ' + (gscStatus.period_start || '未記録') + ' 〜 ' + (gscStatus.period_end || '未記録'),
      '',
      '## Phase 1 scope',
      '',
      '画面上の「サイト全体を分析する」は一連の改善ワークフローを示すラベルです。サイト確認の自動取得範囲は、入力URLの公開HTMLとサイトルートの `llms.txt` / `robots.txt` であり、サイト内全ページのクロール完了を意味しません。',
      '',
      '市場需要は推定、GSC Impressionsは取込期間の実測です。両者は加算・平均・置換していません。',
      '',
      '## Proposed implementation order',
      '',
      markdownList(actionLines),
      '',
      '## Non-guarantee',
      '',
      '検索順位、AI掲載・言及・引用、流入、問い合わせ、予約、売上を保証するものではありません。'
    ].join('\n');

    files['AGENT_PROMPT.md'] = [
      '# AGENT PROMPT — mandatory rules',
      '',
      '1. 事実を創作しない。料金、症例、顧客名、実績、数値は提供された確認済み事実のみ使う。',
      '2. Schemaは同じページの可視本文と一致させ、未確認事実を追加しない。',
      '3. 生成物は下書き。事実、権利、ブランド、法務、表示内容を人間が承認するまで公開しない。',
      '4. GitHub branch、commit、Pull Requestを作成しない。Previewや本番へDeployしない。',
      '5. 検索順位、AI掲載・引用、問い合わせ、予約、売上の成果を保証しない。',
      '6. 推定市場需要とGSC実測値を混ぜない。',
      '',
      'Target URL: ' + (targetUrl || '未入力')
    ].join('\n');

    files['strategy/keyword-candidates.csv'] = toCsv(csvRowsForKeywords(keywords), [
      'priority', 'keyword', 'intent', 'cluster', 'estimated_monthly_demand', 'volume_source',
      'gsc_impressions', 'gsc_clicks', 'gsc_position', 'gsc_period_start', 'gsc_period_end',
      'gsc_source', 'gsc_status', 'target_url', 'competitor_gap',
      'competitor_gap_source', 'ai_prompt_count', 'status', 'action'
    ]);
    files['strategy/prompt-candidates.csv'] = toCsv(prompts, [
      'prompt_id', 'keyword_id', 'keyword', 'prompt', 'intent', 'locale', 'generation_basis', 'status'
    ]);
    files['strategy/actions.csv'] = toCsv(actions.map(function (action) {
      return {
        id: action.id,
        type: action.type,
        target_key: action.target_key,
        title: action.title,
        target_url: action.target_url,
        reason: action.reason,
        evidence_class: action.evidence_class,
        status: action.status,
        blocked_reason: action.blocked_reason,
        source_refs: isArray(action.source_refs) ? action.source_refs.join('|') : ''
      };
    }), ['id', 'type', 'target_key', 'title', 'target_url', 'reason', 'evidence_class', 'status', 'blocked_reason', 'source_refs']);

    files['schema/VALIDATION_REQUIRED.md'] = [
      '# Schema validation required',
      '',
      '未確認のSchema JSONは生成していません。',
      '',
      '- 対象ページの可視本文と各プロパティを照合する',
      '- 料金、症例、評価、レビュー、顧客、実績を推測しない',
      '- 構文検証と人間承認後にのみ実装する'
    ].join('\n');

    files['content-drafts/IMPLEMENTATION_DRAFT.md'] = [
      '# Content implementation draft',
      '',
      '> 下書きです。未確認事実を補完せず、公開前に人間が確認してください。',
      '',
      '## Priority topics',
      '',
      markdownList(topKeywords),
      '',
      '## Proposed changes',
      '',
      markdownList(actionLines),
      '',
      '## Facts to confirm',
      '',
      '- [ ] 対象者・対応範囲',
      '- [ ] 料金・契約条件',
      '- [ ] 実績・顧客名・数値の公開許諾',
      '- [ ] FAQ回答と可視本文',
      '- [ ] Schemaと可視本文の一致'
    ].join('\n');

    files['content-stubs/CONTENT_DRAFT.md'] = files['content-drafts/IMPLEMENTATION_DRAFT.md'];

    files['public/llms.txt'] = [
      '# DRAFT — human review required',
      '',
      '> Supplemental navigation draft. This file does not guarantee search ranking or AI citation.',
      '',
      '## Target',
      '- ' + (targetUrl || '[URL to confirm]'),
      '',
      '## Priority topics',
      markdownList(topKeywords.slice(0, 10))
    ].join('\n');

    files['public/llms-full.txt'] = [
      files['public/llms.txt'],
      '',
      '## Candidate questions',
      markdownList(prompts.slice(0, 30).map(function (prompt) { return prompt.prompt; })),
      '',
      '## Review note',
      '公式情報と照合し、未確認の料金・実績・顧客名・数値を公開しないでください。'
    ].join('\n');

    files['validation/VALIDATION.md'] = [
      '# Pre-publication validation',
      '',
      '- [ ] 入力URLと対象サイトが一致する',
      '- [ ] 料金、症例、顧客名、実績、数値は確認済み',
      '- [ ] Schemaは同じページの可視本文と一致する',
      '- [ ] 内部リンクと対象URLは有効',
      '- [ ] CSVのUTF-8、改行、カンマ、数式注入対策を確認',
      '- [ ] 推定需要とGSC実測を別項目として表示',
      '- [ ] 検索順位、AI掲載・引用、問い合わせ、売上の保証表現がない',
      '- [ ] 人間承認前にPR作成・Preview・Deploy・公開を行っていない'
    ].join('\n');
    return files;
  }

  function fileRole(path) {
    if (path === 'README.md') return 'readme';
    if (path === 'AGENT_PROMPT.md') return 'agent_rules';
    if (path.indexOf('strategy/') === 0) return 'strategy';
    if (path.indexOf('schema/') === 0) return 'schema_validation';
    if (path.indexOf('content-') === 0) return 'content_draft';
    if (path.indexOf('public/') === 0) return 'public_draft';
    if (path.indexOf('validation/') === 0) return 'validation';
    return 'draft';
  }

  function buildArtifactBundle(job) {
    var snapshot = isObject(job) ? clone(job) : {};
    var rawInput = isObject(snapshot.input) ? snapshot.input : {};
    snapshot.input = {
      url: sanitizePublicUrl(rawInput.url || rawInput.target_url, true),
      goal: safeLine(rawInput.goal),
      keywordCount: Number(rawInput.keywordCount || rawInput.keyword_count) || null,
      region: safeLine(rawInput.region)
    };
    if (isArray(snapshot.keyword_candidates)) {
      snapshot.keyword_candidates.forEach(function (candidate) {
        if (candidate && candidate.target_url !== undefined) candidate.target_url = sanitizeArtifactUrl(candidate.target_url, false);
      });
    }
    if (isArray(snapshot.actions)) {
      snapshot.actions.forEach(function (action) {
        if (!action) return;
        if (action.target_url !== undefined) action.target_url = sanitizeArtifactUrl(action.target_url, true);
        action.target_key = safeLine(action.type || 'action') + '|' + normalizeKeyword(action.target_url || 'unbound');
      });
    }
    var files = bundleFiles(snapshot);
    var manifestPaths = Object.keys(files).concat(['MANIFEST.json']).sort();
    var jobId = safeLine(snapshot.id || snapshot.job_id) || uid('analysis_job');
    var manifest = {
      schema_version: '1.0',
      bundle_id: 'bundle_' + jobId,
      job_id: jobId,
      status: 'draft',
      generated_at: nowIso(),
      input: clone(snapshot.input || {}),
      scope: {
        label: 'サイト全体分析ワークフロー',
        automated_site_check: '入力URLの公開HTML + root llms.txt + root robots.txt',
        full_site_crawl: false
      },
      data_sources: {
        market_demand: { evidence_class: 'Estimated', aggregation: 'separate_from_gsc' },
        gsc: {
          status: snapshot.gsc_status && snapshot.gsc_status.status ? safeLine(snapshot.gsc_status.status) : 'not_connected',
          connected: !!(snapshot.gsc_status && snapshot.gsc_status.connected),
          evidence_class: snapshot.gsc_status && snapshot.gsc_status.connected ? 'Official' : null,
          property: safeGscProperty(snapshot.gsc_status && snapshot.gsc_status.property),
          period_start: snapshot.gsc_status && snapshot.gsc_status.period_start ? safeLine(snapshot.gsc_status.period_start) : null,
          period_end: snapshot.gsc_status && snapshot.gsc_status.period_end ? safeLine(snapshot.gsc_status.period_end) : null
        }
      },
      files: manifestPaths.map(function (path) {
        return { path: path, role: path === 'MANIFEST.json' ? 'manifest' : fileRole(path), status: 'draft' };
      }),
      boundaries: {
        github_pr: 'planned',
        production_deploy: 'planned',
        keyword_planner: 'not_connected',
        hack2_live_measurement: 'not_connected'
      }
    };
    files['MANIFEST.json'] = JSON.stringify(manifest, null, 2) + '\n';
    return {
      file_name: ('airreach-studio-' + jobId + '.zip').replace(/[^a-zA-Z0-9._-]/g, '-'),
      files: files,
      manifest: manifest
    };
  }

  function utf8Bytes(value) {
    var string = text(value);
    var bytes = [];
    var code;
    var next;
    var i;
    if (typeof root.TextEncoder === 'function') return new root.TextEncoder().encode(string);
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(string);
    for (i = 0; i < string.length; i += 1) {
      code = string.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF) {
        next = string.charCodeAt(i + 1);
        if (next >= 0xDC00 && next <= 0xDFFF) {
          code = 0x10000 + ((code - 0xD800) << 10) + (next - 0xDC00);
          i += 1;
        } else {
          code = 0xFFFD;
        }
      } else if (code >= 0xDC00 && code <= 0xDFFF) {
        code = 0xFFFD;
      }
      if (code <= 0x7F) bytes.push(code);
      else if (code <= 0x7FF) bytes.push(0xC0 | (code >>> 6), 0x80 | (code & 0x3F));
      else if (code <= 0xFFFF) bytes.push(0xE0 | (code >>> 12), 0x80 | ((code >>> 6) & 0x3F), 0x80 | (code & 0x3F));
      else bytes.push(0xF0 | (code >>> 18), 0x80 | ((code >>> 12) & 0x3F), 0x80 | ((code >>> 6) & 0x3F), 0x80 | (code & 0x3F));
    }
    return new Uint8Array(bytes);
  }

  function contentBytes(value) {
    if (typeof Uint8Array !== 'undefined' && value instanceof Uint8Array) return new Uint8Array(value);
    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return new Uint8Array(value);
    return utf8Bytes(value);
  }

  function sanitizeZipPath(path) {
    var raw = text(path).replace(/\\/g, '/');
    var parts;
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) throw new Error('ZIP内のファイル名が不正です。');
    if (/^(?:\/|[a-zA-Z]:\/)/.test(raw)) throw new Error('ZIP内で絶対パスは使えません。');
    parts = raw.split('/');
    if (parts.some(function (part) { return !part || part === '.' || part === '..'; })) {
      throw new Error('ZIP内のパスに不正な要素があります。');
    }
    return parts.join('/');
  }

  var CRC_TABLE = (function () {
    var table = [];
    var i;
    var j;
    var value;
    for (i = 0; i < 256; i += 1) {
      value = i;
      for (j = 0; j < 8; j += 1) value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
      table[i] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xFFFFFFFF;
    var i;
    for (i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function write16(view, offset, value) {
    view.setUint16(offset, value & 0xFFFF, true);
  }

  function write32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function dosDateTime(date) {
    var year = Math.max(1980, date.getFullYear());
    return {
      time: ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((Math.floor(date.getSeconds() / 2)) & 0x1F),
      date: (((year - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0x0F) << 5) | (date.getDate() & 0x1F)
    };
  }

  function normalizeFileEntries(files) {
    var entries = [];
    var seen = {};
    var seenInsensitive = {};
    var totalBytes = 0;
    if (isArray(files)) {
      files.forEach(function (entry) {
        if (!entry) return;
        entries.push({ path: entry.path || entry.name, content: entry.content == null ? '' : entry.content });
      });
    } else if (isObject(files)) {
      Object.keys(files).forEach(function (path) { entries.push({ path: path, content: files[path] }); });
    } else {
      throw new Error('ZIPに入れるファイルがありません。');
    }
    entries.forEach(function (entry) {
      entry.path = sanitizeZipPath(entry.path);
      if (seen[entry.path] || seenInsensitive[entry.path.toLowerCase()]) throw new Error('ZIP内のファイル名が重複しています: ' + entry.path);
      seen[entry.path] = true;
      seenInsensitive[entry.path.toLowerCase()] = true;
      entry.name_bytes = utf8Bytes(entry.path);
      entry.data = contentBytes(entry.content);
      if (entry.name_bytes.length > 0xFFFF || entry.data.length > 0xFFFFFFFF) {
        throw new Error('ZIP内のファイルが大きすぎます: ' + entry.path);
      }
      entry.crc = crc32(entry.data);
      totalBytes += entry.data.length;
    });
    if (!entries.length) throw new Error('ZIPに入れるファイルがありません。');
    if (entries.length >= 0xFFFF) throw new Error('ZIP内のファイル数が上限を超えています。');
    if (totalBytes > 64 * 1024 * 1024) throw new Error('ZIP内のデータが64MiBを超えています。');
    return entries.sort(function (a, b) { return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0); });
  }

  function createZipBlob(files) {
    var entries = normalizeFileEntries(files);
    var stamp = dosDateTime(new Date());
    var localParts = [];
    var centralParts = [];
    var offset = 0;
    var centralSize = 0;
    entries.forEach(function (entry) {
      var local = new Uint8Array(30 + entry.name_bytes.length);
      var localView = new DataView(local.buffer);
      var central;
      var centralView;
      write32(localView, 0, 0x04034B50);
      write16(localView, 4, 20);
      write16(localView, 6, 0x0800);
      write16(localView, 8, 0);
      write16(localView, 10, stamp.time);
      write16(localView, 12, stamp.date);
      write32(localView, 14, entry.crc);
      write32(localView, 18, entry.data.length);
      write32(localView, 22, entry.data.length);
      write16(localView, 26, entry.name_bytes.length);
      write16(localView, 28, 0);
      local.set(entry.name_bytes, 30);
      localParts.push(local, entry.data);

      central = new Uint8Array(46 + entry.name_bytes.length);
      centralView = new DataView(central.buffer);
      write32(centralView, 0, 0x02014B50);
      write16(centralView, 4, 20);
      write16(centralView, 6, 20);
      write16(centralView, 8, 0x0800);
      write16(centralView, 10, 0);
      write16(centralView, 12, stamp.time);
      write16(centralView, 14, stamp.date);
      write32(centralView, 16, entry.crc);
      write32(centralView, 20, entry.data.length);
      write32(centralView, 24, entry.data.length);
      write16(centralView, 28, entry.name_bytes.length);
      write16(centralView, 30, 0);
      write16(centralView, 32, 0);
      write16(centralView, 34, 0);
      write16(centralView, 36, 0);
      write32(centralView, 38, 0);
      write32(centralView, 42, offset);
      central.set(entry.name_bytes, 46);
      centralParts.push(central);
      offset += local.length + entry.data.length;
      centralSize += central.length;
      if (offset >= 0xFFFFFFFF || centralSize >= 0xFFFFFFFF) throw new Error('ZIP32のサイズ上限を超えています。');
    });

    var end = new Uint8Array(22);
    var endView = new DataView(end.buffer);
    write32(endView, 0, 0x06054B50);
    write16(endView, 4, 0);
    write16(endView, 6, 0);
    write16(endView, 8, entries.length);
    write16(endView, 10, entries.length);
    write32(endView, 12, centralSize);
    write32(endView, 16, offset);
    write16(endView, 20, 0);

    return new Blob(localParts.concat(centralParts).concat([end]), { type: 'application/zip' });
  }

  function triggerBlobDownload(blob, fileName) {
    var urlApi = root.URL || root.webkitURL;
    var anchor;
    var objectUrl;
    if (typeof document === 'undefined' || !document.body || !urlApi || !urlApi.createObjectURL) return blob;
    objectUrl = urlApi.createObjectURL(blob);
    anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = safeLine(fileName).replace(/[\\/]/g, '-') || 'airreach-studio.zip';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(function () {
      urlApi.revokeObjectURL(objectUrl);
      if (anchor.parentNode) anchor.parentNode.removeChild(anchor);
    }, 1000);
    return blob;
  }

  function downloadArtifactBundle(bundle) {
    var name;
    var blob;
    if (!isObject(bundle) || !isObject(bundle.files)) throw new Error('ZIP生成用のファイルがありません。');
    name = safeLine(bundle.file_name || 'airreach-studio.zip').replace(/[\\/]/g, '-');
    if (!/\.zip$/i.test(name)) name += '.zip';
    blob = createZipBlob(bundle.files);
    triggerBlobDownload(blob, name);
    return blob;
  }

  state = loadState();

  root.AirReachStudio = {
    getState: getState,
    setAnalysisJob: setAnalysisJob,
    getGscStatus: getGscStatus,
    buildKeywordCandidates: buildKeywordCandidates,
    buildPromptCandidates: buildPromptCandidates,
    buildActions: buildActions,
    buildArtifactBundle: buildArtifactBundle,
    createZipBlob: createZipBlob,
    downloadArtifactBundle: downloadArtifactBundle,
    parseCsv: parseCsv,
    toCsv: toCsv,
    normalizeKeyword: normalizeKeyword
  };

  function valueOf(id) {
    var element = q(id);
    return element ? element.value : '';
  }

  function setValue(id, value) {
    var element = q(id);
    if (element) element.value = value == null ? '' : value;
  }

  function setText(id, value) {
    var element = q(id);
    if (element) element.textContent = value == null ? '' : value;
  }

  function setHidden(element, hidden) {
    if (!element) return;
    element.hidden = !!hidden;
    if (hidden) element.setAttribute('aria-hidden', 'true');
    else element.removeAttribute('aria-hidden');
  }

  function on(id, eventName, listener) {
    var element = q(id);
    if (element) element.addEventListener(eventName, listener);
  }

  function downloadText(name, content, type) {
    var blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    return triggerBlobDownload(blob, name);
  }

  function notifyUser(message) {
    if (typeof root.alert === 'function') root.alert(message);
  }

  function profileFromForm() {
    var siteUrl = q('site-url');
    var analysisUrl = q('analysis-url');
    state.profile = {
      url: siteUrl ? sanitizePublicUrl(siteUrl.value, true) : (analysisUrl ? sanitizePublicUrl(analysisUrl.value, true) : state.profile.url),
      brand: q('brand-name') ? cleanText(valueOf('brand-name')) : state.profile.brand,
      service: q('service-name') ? cleanText(valueOf('service-name')) : state.profile.service,
      audience: q('target-audience') ? cleanText(valueOf('target-audience')) : state.profile.audience,
      summary: q('service-summary') ? text(valueOf('service-summary')) : state.profile.summary
    };
  }

  function fillProfile() {
    setValue('site-url', state.profile.url);
    setValue('brand-name', state.profile.brand);
    setValue('service-name', state.profile.service);
    setValue('target-audience', state.profile.audience);
    setValue('service-summary', state.profile.summary);
    setValue('gsc-site', state.google.gscSite);
    setValue('ga-property', state.google.gaProperty);
    if (q('analysis-url') && !valueOf('analysis-url')) setValue('analysis-url', state.profile.url);
  }

  function renderLegacyKpis() {
    var diagnosis = state.analysis_job && state.analysis_job.diagnosis;
    setText('kpi-readiness', diagnosis && diagnosis.overall != null ? diagnosis.overall : '--');
    setText('kpi-faq', state.faqSuggestions.length ? state.faqSuggestions.length : '--');
    setText('kpi-keywords', state.keywords.length);
    setText('kpi-rows', state.measurements.length + state.hack2.length);
  }

  function renderCompetitors() {
    var container = q('competitor-list');
    if (!container) return;
    if (!state.competitors.length) {
      container.innerHTML = '<div class="ars-note">競合はまだ登録されていません。ライブ競合分析は未接続です。</div>';
      return;
    }
    container.innerHTML = state.competitors.map(function (competitor, index) {
      return '<div class="ars-file"><div><code>' + esc(competitor.url) + '</code><small>' +
        esc(competitor.note || 'メモなし') + '</small></div><button class="ars-btn ars-btn-danger" type="button" data-del-comp="' +
        index + '">削除</button></div>';
    }).join('');
    each(container.querySelectorAll('[data-del-comp]'), function (button) {
      button.addEventListener('click', function () {
        state.competitors.splice(Number(button.getAttribute('data-del-comp')), 1);
        persist();
      });
    });
  }

  function renderKeywords() {
    var body = q('keyword-body');
    var selector = q('timeseries-keyword');
    var current;
    if (body) {
      body.innerHTML = state.keywords.map(function (keyword, index) {
        var chipClass = keyword.priority === 'P0' ? ' bad' : (keyword.priority === 'P1' ? ' warn' : '');
        return '<tr><td><span class="ars-chip' + chipClass + '">' + esc(keyword.priority) + '</span></td>' +
          '<td>' + esc(keyword.text) + '</td><td>' + esc(keyword.intent) + '</td><td>' + esc(keyword.cluster) +
          '</td><td>' + esc(keyword.targetUrl || '未設定') + '</td><td>' + esc(keyword.status || '未対策') +
          '</td><td><button class="ars-btn ars-btn-danger" type="button" data-del-kw="' + index + '">削除</button></td></tr>';
      }).join('');
      each(body.querySelectorAll('[data-del-kw]'), function (button) {
        button.addEventListener('click', function () {
          state.keywords.splice(Number(button.getAttribute('data-del-kw')), 1);
          persist();
        });
      });
    }
    if (selector) {
      current = selector.value;
      selector.innerHTML = '<option value="">全体</option>' + state.keywords.map(function (keyword) {
        return '<option value="' + esc(keyword.text) + '">' + esc(keyword.text) + '</option>';
      }).join('');
      selector.value = current;
    }
  }

  function renderGenerated() {
    var list = q('generated-files');
    var selector = q('file-preview-select');
    var preview = q('file-preview');
    var names = Object.keys(state.generated || {});
    function show(name) {
      if (selector) selector.value = name;
      if (preview) preview.value = text(state.generated[name]);
    }
    if (!list || !selector) return;
    if (!names.length) {
      list.innerHTML = '<div class="ars-note">まだ生成されていません。</div>';
      selector.innerHTML = '';
      if (preview) preview.value = '';
      return;
    }
    list.innerHTML = names.map(function (name, index) {
      return '<div class="ars-file"><div><code>' + esc(name) + '</code><small>実装下書き</small></div>' +
        '<button class="ars-btn ars-btn-secondary" type="button" data-preview-index="' + index + '">表示</button></div>';
    }).join('');
    selector.innerHTML = names.map(function (name) {
      return '<option value="' + esc(name) + '">' + esc(name) + '</option>';
    }).join('');
    show(selector.value || names[0]);
    selector.onchange = function () { show(selector.value); };
    each(list.querySelectorAll('[data-preview-index]'), function (button) {
      button.addEventListener('click', function () { show(names[Number(button.getAttribute('data-preview-index'))]); });
    });
  }

  function aggregateMeasurements(keyword) {
    var result = { impressions: 0, clicks: 0, sessions: 0, keyEvents: 0, positionSum: 0, positionWeight: 0 };
    state.measurements.forEach(function (row) {
      var weight;
      if (keyword && row.keyword !== keyword) return;
      if (row.source_type === 'gsc' && row.evidence_class === 'Official') {
        result.impressions += Math.max(0, number(row.impressions));
        result.clicks += Math.max(0, number(row.clicks));
      }
      if (row.source_type === 'ga4' && row.evidence_class === 'Official') {
        result.sessions += Math.max(0, number(row.sessions));
        result.keyEvents += Math.max(0, number(row.key_events));
      }
      if (row.source_type === 'gsc' && row.evidence_class === 'Official' && nullableNumber(row.position) !== null && number(row.position) > 0) {
        weight = Math.max(1, number(row.impressions));
        result.positionSum += number(row.position) * weight;
        result.positionWeight += weight;
      }
    });
    result.ctr = percent(result.clicks, result.impressions);
    result.cvr = percent(result.keyEvents, result.sessions);
    result.position = result.positionWeight ? result.positionSum / result.positionWeight : 0;
    return result;
  }

  function renderChart(rows) {
    var element = q('timeseries-chart');
    var grouped = {};
    var points;
    var maxImpressions;
    var width = 900;
    var height = 230;
    var padding = 30;
    function line(field, scale) {
      return points.map(function (point, index) {
        var x = padding + (points.length === 1 ? 0 : (index / (points.length - 1)) * (width - padding * 2));
        var y = height - padding - (point[field] / scale) * (height - padding * 2);
        return x.toFixed(1) + ',' + y.toFixed(1);
      }).join(' ');
    }
    if (!element) return;
    rows = rows.filter(function (row) {
      return row && row.evidence_class === 'Official' && (row.source_type === 'gsc' || row.source_type === 'ga4');
    });
    if (!rows.length) {
      element.innerHTML = '<div class="ars-note">集計対象のGSC / GA4実測データがありません。サンプル・移行データは集計しません。</div>';
      return;
    }
    rows.forEach(function (row) {
      var date = safeLine(row.date) || 'unknown';
      if (!grouped[date]) grouped[date] = { impressions: 0, clicks: 0, conversions: 0 };
      if (row.source_type === 'gsc') {
        grouped[date].impressions += Math.max(0, number(row.impressions));
        grouped[date].clicks += Math.max(0, number(row.clicks));
      }
      if (row.source_type === 'ga4') grouped[date].conversions += Math.max(0, number(row.key_events));
    });
    points = Object.keys(grouped).sort().map(function (date) {
      return {
        date: date,
        impressions: grouped[date].impressions,
        clicks: grouped[date].clicks,
        conversions: grouped[date].conversions
      };
    });
    maxImpressions = Math.max.apply(null, points.map(function (point) { return point.impressions; }).concat([1]));
    element.innerHTML = '<svg viewBox="0 0 900 230" role="img" aria-label="時系列チャート">' +
      '<line x1="30" y1="200" x2="870" y2="200" stroke="#e2e8f0"/>' +
      '<polyline fill="none" stroke="#2563eb" stroke-width="3" points="' + line('impressions', maxImpressions) + '"/>' +
      '<polyline fill="none" stroke="#64748b" stroke-width="2" points="' + line('clicks', Math.max.apply(null, points.map(function (point) { return point.clicks; }).concat([1]))) + '"/>' +
      '<polyline fill="none" stroke="#16a34a" stroke-width="2" points="' + line('conversions', Math.max.apply(null, points.map(function (point) { return point.conversions; }).concat([1]))) + '"/>' +
      '</svg>';
  }

  function renderMeasurements() {
    var body = q('measurement-body');
    var keyword = q('timeseries-keyword') ? valueOf('timeseries-keyword') : '';
    var rows = state.measurements.filter(function (row) { return !keyword || row.keyword === keyword; }).sort(function (a, b) {
      return text(a.date).localeCompare(text(b.date));
    });
    var aggregate = aggregateMeasurements(keyword);
    if (body) {
      body.innerHTML = rows.map(function (row) {
        var impressions = nullableNumber(row.impressions);
        var clicks = nullableNumber(row.clicks);
        var sessions = nullableNumber(row.sessions);
        var keyEvents = nullableNumber(row.key_events);
        return '<tr><td>' + esc(row.date) + '</td><td>' + esc(row.keyword) + '</td><td>' + esc(row.url) + '</td>' +
          '<td>' + esc((row.source || row.source_type || '未確認') + ' / ' + (row.evidence_class || '出所未確認')) + '</td>' +
          '<td class="num">' + (impressions === null ? '-' : formatNumber(impressions)) + '</td>' +
          '<td class="num">' + (clicks === null ? '-' : formatNumber(clicks)) + '</td>' +
          '<td class="num">' + (impressions ? percent(clicks || 0, impressions).toFixed(1) + '%' : '-') + '</td>' +
          '<td class="num">' + (nullableNumber(row.position) === null ? '-' : number(row.position).toFixed(1)) + '</td>' +
          '<td class="num">' + (sessions === null ? '-' : formatNumber(sessions)) + '</td>' +
          '<td class="num">' + (keyEvents === null ? '-' : formatNumber(keyEvents)) + '</td>' +
          '<td class="num">' + (sessions ? percent(keyEvents || 0, sessions).toFixed(1) + '%' : '-') + '</td>' +
          '<td class="num">' + (row.ai_mention == null ? '-' : esc(row.ai_mention)) + '</td>' +
          '<td class="num">' + (row.ai_citation == null ? '-' : esc(row.ai_citation)) + '</td></tr>';
      }).join('');
    }
    setText('ts-imp', formatNumber(aggregate.impressions));
    setText('ts-ctr', aggregate.ctr.toFixed(1) + '%');
    setText('ts-cvr', aggregate.cvr.toFixed(1) + '%');
    setText('ts-pos', aggregate.position ? aggregate.position.toFixed(1) : '-');
    renderChart(rows);
  }

  function renderHack2() {
    var container = q('hack2-models');
    var engines = ['Google AI Overviews', 'Gemini', 'ChatGPT', 'Claude', 'Perplexity'];
    if (!container) return;
    container.innerHTML = engines.map(function (engine) {
      var normalizedEngine = engine.toLowerCase().replace('google ai overviews', 'google');
      var rows = state.hack2.filter(function (row) {
        var rowEngine = text(row.engine).toLowerCase();
        return rowEngine === engine.toLowerCase() || rowEngine.indexOf(normalizedEngine) >= 0;
      });
      var mentions;
      var citations;
      var mentionValues;
      var citationValues;
      if (!rows.length) return '<div class="ars-model"><strong>' + esc(engine) + '</strong><div class="mval">--</div><small>未測定</small></div>';
      mentionValues = rows.map(function (row) { return measuredBinary(row.mentioned); }).filter(function (value) { return value !== null; });
      citationValues = rows.map(function (row) { return measuredBinary(row.cited); }).filter(function (value) { return value !== null; });
      mentions = mentionValues.reduce(function (sum, value) { return sum + value; }, 0);
      citations = citationValues.reduce(function (sum, value) { return sum + value; }, 0);
      return '<div class="ars-model"><strong>' + esc(engine) + '</strong><div class="mval">' +
        (mentionValues.length ? percent(mentions, mentionValues.length).toFixed(0) + '%' : '--') + '</div><small>言及 ' +
        (mentionValues.length ? percent(mentions, mentionValues.length).toFixed(0) + '%' : '未測定') + ' / 引用 ' +
        (citationValues.length ? percent(citations, citationValues.length).toFixed(0) + '%' : '未測定') + '（JSON取込）</small></div>';
    }).join('');
  }

  function renderAll() {
    renderLegacyKpis();
    renderCompetitors();
    renderKeywords();
    renderGenerated();
    renderMeasurements();
    renderHack2();
    renderAnalysisJob(state.analysis_job);
  }

  function getCaseInsensitive(row, names) {
    var map = {};
    Object.keys(row || {}).forEach(function (key) { map[normalizeKeyword(key)] = row[key]; });
    var found = '';
    names.some(function (name) {
      var key = normalizeKeyword(name);
      if (Object.prototype.hasOwnProperty.call(map, key)) {
        found = map[key];
        return true;
      }
      return false;
    });
    return found;
  }

  function sourcePeriod(rows, dateKey) {
    var dates = rows.map(function (row) { return safeLine(row[dateKey]); }).filter(Boolean).sort();
    return { start: dates.length ? dates[0] : null, end: dates.length ? dates[dates.length - 1] : null };
  }

  function normalizeMeasurementDate(value) {
    var date = safeLine(value);
    var compact = date.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return compact[1] + '-' + compact[2] + '-' + compact[3];
    return date;
  }

  function measurementBaseUrl() {
    var gscMeta = state.sources.gsc || {};
    var property = cleanText(gscMeta.property || state.google.gscSite);
    var target = state.analysis_job && state.analysis_job.input
      ? (state.analysis_job.input.url || state.analysis_job.input.target_url)
      : state.profile.url;
    if (property.indexOf('sc-domain:') === 0) {
      return sanitizePublicUrl('https://' + property.slice('sc-domain:'.length) + '/', true);
    }
    return sanitizePublicUrl(property, true) || sanitizePublicUrl(target, true);
  }

  function resolveMeasurementUrl(value) {
    var raw = safeLine(value);
    var base = measurementBaseUrl();
    var Constructor = root.URL || (typeof URL !== 'undefined' ? URL : null);
    if (!raw) return '';
    try {
      if (!Constructor) return '';
      return sanitizePublicUrl(new Constructor(raw, base || undefined).href, true);
    } catch (e) {
      return '';
    }
  }

  function periodDaysFromMeta(meta, fallback) {
    var start;
    var end;
    var difference;
    meta = meta || {};
    if (meta.period_start && meta.period_end) {
      start = new Date(meta.period_start + 'T00:00:00Z');
      end = new Date(meta.period_end + 'T00:00:00Z');
      difference = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
      if (isFinite(difference) && difference > 0) return difference;
    }
    return fallback || 28;
  }

  function importGscRows(rows) {
    var mapped = [];
    rows.forEach(function (row) {
      var keyword = safeLine(getCaseInsensitive(row, ['query', 'keyword', '検索キーワード', 'クエリ']));
      var impressions = nullableNumber(getCaseInsensitive(row, ['impressions', '表示回数']));
      var clicks = nullableNumber(getCaseInsensitive(row, ['clicks', 'クリック数']));
      if (!keyword || impressions === null) return;
      mapped.push({
        id: uid('gsc'),
        source_type: 'gsc',
        source: 'GSC CSV',
        evidence_class: 'Official',
        date: normalizeMeasurementDate(getCaseInsensitive(row, ['date', '日付'])),
        keyword: keyword,
        normalized_keyword: normalizeKeyword(keyword),
        url: sanitizePublicUrl(getCaseInsensitive(row, ['page', 'url', 'ページ']), true),
        impressions: Math.max(0, impressions),
        clicks: clicks === null ? null : Math.max(0, clicks),
        position: nullableNumber(getCaseInsensitive(row, ['position', '平均掲載順位', '掲載順位'])),
        sessions: null,
        key_events: null,
        ai_mention: null,
        ai_citation: null
      });
    });
    if (!mapped.length) throw new Error('GSC CSVにQueryとImpressionsの有効な行がありません。');
    state.measurements = state.measurements.filter(function (row) { return row.source_type !== 'gsc'; }).concat(mapped);
    var period = sourcePeriod(mapped, 'date');
    var configuredProperty = cleanText(state.google.gscSite);
    var configuredMatchesRows = !!configuredProperty && mapped.filter(function (row) { return !!row.url; }).every(function (row) {
      return propertyMatchesTarget(configuredProperty, row.url);
    });
    var rowsHaveUrls = mapped.some(function (row) { return !!row.url; });
    // A Page column is not proof of Search Console property ownership. Keep
    // the import unbound until the user explicitly supplies a matching
    // domain or URL-prefix property.
    var datasetProperty = configuredProperty && (!rowsHaveUrls || configuredMatchesRows)
      ? configuredProperty
      : '';
    state.sources.gsc = {
      status: 'imported',
      source: 'GSC CSV',
      evidence_class: 'Official',
      imported_at: nowIso(),
      period_start: period.start,
      period_end: period.end,
      row_count: mapped.length,
      property: datasetProperty || null,
      configured_property: configuredProperty || null,
      property_warning: !configuredProperty
        ? 'Search Console propertyが未設定のため、対象未確認として保存しました。'
        : (rowsHaveUrls && !configuredMatchesRows
          ? '設定プロパティとCSVのPageが一致しないため、対象未確認として保存しました。'
          : null)
    };
    publishOfficialBaseline();
  }

  function rebindConfiguredGscProperty() {
    var rows = sourceRows('gsc', 'Official');
    var meta = state.sources.gsc || defaultSources().gsc;
    var configuredProperty = cleanText(state.google.gscSite);
    var rowsWithUrls;
    if (meta.status !== 'imported' || !rows.length || !configuredProperty) {
      return { attempted: false, bound: false };
    }
    rowsWithUrls = rows.filter(function (row) { return !!row.url; });
    meta.configured_property = configuredProperty;
    if (rowsWithUrls.some(function (row) { return !propertyMatchesTarget(configuredProperty, row.url); })) {
      meta.property_warning = '設定プロパティと取込済みGSCのPageが一致しないため、設定を適用していません。';
      state.sources.gsc = meta;
      return { attempted: true, bound: false };
    }
    meta.property = configuredProperty;
    meta.property_warning = null;
    state.sources.gsc = meta;
    publishOfficialBaseline();
    return { attempted: true, bound: true };
  }

  function importGa4Rows(rows) {
    var mapped = [];
    rows.forEach(function (row) {
      var url = safeLine(getCaseInsensitive(row, ['landingPagePlusQueryString', 'Landing page + query string', 'landingPage', 'Landing page', 'url']));
      var sessions = nullableNumber(getCaseInsensitive(row, ['sessions', 'セッション']));
      var keyEvents = nullableNumber(getCaseInsensitive(row, ['keyEvents', 'Key events', 'conversions', 'Conversions', 'キーイベント']));
      if (!url && sessions === null && keyEvents === null) return;
      mapped.push({
        id: uid('ga4'),
        source_type: 'ga4',
        source: 'GA4 CSV',
        evidence_class: 'Official',
        date: normalizeMeasurementDate(getCaseInsensitive(row, ['date', '日付'])),
        keyword: '',
        normalized_keyword: '',
        url: resolveMeasurementUrl(url),
        impressions: null,
        clicks: null,
        position: null,
        sessions: sessions === null ? 0 : Math.max(0, sessions),
        key_events: keyEvents === null ? 0 : Math.max(0, keyEvents),
        ai_mention: null,
        ai_citation: null
      });
    });
    if (!mapped.length) throw new Error('GA4 CSVにLanding page、Sessions、Key eventsの有効な行がありません。');
    state.measurements = state.measurements.filter(function (row) { return row.source_type !== 'ga4'; }).concat(mapped);
    var period = sourcePeriod(mapped, 'date');
    state.sources.ga4 = {
      status: 'imported',
      source: 'GA4 CSV',
      evidence_class: 'Official',
      imported_at: nowIso(),
      period_start: period.start,
      period_end: period.end,
      row_count: mapped.length
    };
    publishOfficialBaseline();
  }

  function importHack2Rows(rows) {
    var mapped;
    if (!isArray(rows)) throw new Error('配列JSONが必要です。');
    mapped = rows.map(function (row) {
      var copy = clone(row || {});
      copy.id = copy.id || uid('hack2');
      copy.source_type = 'hack2';
      copy.source = 'HackⅡ JSON import';
      copy.evidence_class = 'Customer Supplied';
      copy.measurement_date = safeLine(copy.measurement_date || copy.date);
      copy.keyword = safeLine(copy.keyword || copy.prompt);
      copy.mentioned = measuredBinary(copy.mentioned);
      copy.cited = measuredBinary(copy.cited);
      return copy;
    }).filter(function (row) { return !!(row.measurement_date || row.keyword || row.engine); });
    if (!mapped.length) throw new Error('HackⅡ JSONに有効な行がありません。');
    state.hack2 = mapped;
    var dates = mapped.map(function (row) { return row.measurement_date; }).filter(Boolean).sort();
    state.sources.hack2 = {
      status: 'imported',
      source: 'HackⅡ JSON import',
      evidence_class: 'Customer Supplied',
      imported_at: nowIso(),
      period_start: dates.length ? dates[0] : null,
      period_end: dates.length ? dates[dates.length - 1] : null,
      row_count: mapped.length
    };
  }

  function publishOfficialBaseline() {
    var gscRows = sourceRows('gsc', 'Official');
    var ga4Rows = sourceRows('ga4', 'Official');
    var boundGa4Rows;
    var byKeyword = {};
    var totalImpressions = 0;
    var totalClicks = 0;
    var meta = state.sources.gsc || {};
    var ga4Meta = state.sources.ga4 || {};
    var periodDays = periodDaysFromMeta(meta, 28);
    var ga4PeriodDays = periodDaysFromMeta(ga4Meta, 28);
    var property = cleanText(meta.property || state.google.gscSite);
    var currentTarget = state.analysis_job && state.analysis_job.input
      ? (state.analysis_job.input.url || state.analysis_job.input.target_url)
      : state.profile.url;
    currentTarget = sanitizePublicUrl(currentTarget, true);
    var baseline;
    if (!property || !gscRows.length || (currentTarget && !propertyMatchesTarget(property, currentTarget)) || gscRows.some(function (row) {
      return row.url && !propertyMatchesTarget(property, row.url);
    })) {
      // A global Official baseline is unsafe until every imported row is bound
      // to one verified Search Console property.
      safeStorageRemove(BASELINE_KEY);
      return;
    }
    boundGa4Rows = ga4Rows.length && ga4Rows.every(function (row) {
      return !!row.url && propertyMatchesTarget(property, row.url);
    }) ? ga4Rows : [];
    gscRows.forEach(function (row) {
      var key = normalizeKeyword(row.keyword);
      var weight;
      if (!key) return;
      if (!byKeyword[key]) {
        byKeyword[key] = { query: row.keyword, impressions: 0, clicks: 0, positionSum: 0, positionWeight: 0, evidenceClass: 'Official' };
      }
      byKeyword[key].impressions += number(row.impressions);
      byKeyword[key].clicks += number(row.clicks);
      if (nullableNumber(row.position) !== null && number(row.position) > 0) {
        weight = Math.max(1, number(row.impressions));
        byKeyword[key].positionSum += number(row.position) * weight;
        byKeyword[key].positionWeight += weight;
      }
    });
    var keywords = Object.keys(byKeyword).map(function (key) {
      var row = byKeyword[key];
      row.position = row.positionWeight ? row.positionSum / row.positionWeight : 0;
      row.ctr = row.impressions ? row.clicks / row.impressions : 0;
      delete row.positionSum;
      delete row.positionWeight;
      totalImpressions += row.impressions;
      totalClicks += row.clicks;
      return row;
    }).sort(function (a, b) { return b.impressions - a.impressions; }).slice(0, 50);
    baseline = {
      evidenceClass: 'Official',
      source: 'GSC CSV only',
      producer: 'airreach-studio',
      property: property,
      targetUrl: currentTarget || null,
      periodDays: periodDays,
      periodStart: meta.period_start || null,
      periodEnd: meta.period_end || null,
      totalImpressions: totalImpressions,
      totalClicks: totalClicks,
      monthlyImpressions: Math.round((totalImpressions / periodDays) * 30),
      monthlyClicks: Math.round((totalClicks / periodDays) * 30),
      avgCtr: totalImpressions ? totalClicks / totalImpressions : 0,
      keywords: keywords,
      importedAt: meta.imported_at || nowIso()
    };
    if (boundGa4Rows.length) {
      var sessions = boundGa4Rows.reduce(function (sum, row) { return sum + number(row.sessions); }, 0);
      var keyEvents = boundGa4Rows.reduce(function (sum, row) { return sum + number(row.key_events); }, 0);
      baseline.ga4 = {
        evidenceClass: 'Official',
        source: 'GA4 CSV only',
        periodDays: ga4PeriodDays,
        periodStart: ga4Meta.period_start || null,
        periodEnd: ga4Meta.period_end || null,
        monthlySessions: Math.round((sessions / ga4PeriodDays) * 30),
        monthlyKeyEvents: Math.round((keyEvents / ga4PeriodDays) * 30)
      };
    }
    safeStorageSet(BASELINE_KEY, JSON.stringify(baseline));
  }

  function clearMismatchedOfficialBaseline(targetUrl) {
    var baseline = parseStored(safeStorageGet(BASELINE_KEY));
    if (!baseline) return;
    if (!baseline.property || !propertyMatchesTarget(baseline.property, targetUrl)) {
      safeStorageRemove(BASELINE_KEY);
    }
  }

  function fileHandler(id, importer) {
    var element = q(id);
    if (!element) return;
    element.addEventListener('change', function () {
      var file = element.files && element.files[0];
      var reader;
      if (!file) return;
      reader = new FileReader();
      reader.onload = function () {
        try {
          importer(parseCsv(reader.result));
          persist();
        } catch (error) {
          notifyUser('ファイルを読み込めませんでした: ' + error.message);
        }
      };
      reader.onerror = function () { notifyUser('ファイルを読み込めませんでした。'); };
      reader.readAsText(file, 'utf-8');
    });
  }

  function generateFaq() {
    var service;
    var defaults;
    var existing;
    var output;
    profileFromForm();
    service = state.profile.service || 'サービス';
    defaults = [
      service + 'はどのような企業・担当者に向いていますか？',
      '導入前に必要な準備は何ですか？',
      '他社サービスや自社運用との違いは何ですか？',
      '成果はどの指標で計測しますか？',
      '契約後、実装まではどのような流れですか？',
      'セキュリティやデータの取り扱いはどうなっていますか？',
      '対応できないケースはありますか？',
      '料金は何によって変わりますか？',
      '途中で施策を変更できますか？',
      'AI検索と通常のSEOは同時に対策できますか？'
    ];
    existing = valueOf('existing-faq').split(/\n+/).map(cleanText).filter(Boolean);
    state.faqSuggestions = defaults.filter(function (question) {
      return !existing.some(function (item) { return normalizeKeyword(item) === normalizeKeyword(question); });
    });
    output = q('faq-gap-output');
    if (output) {
      output.innerHTML = state.faqSuggestions.map(function (question, index) {
        return '<div class="ars-card ars-c6"><span class="ars-chip">FAQ ' + (index + 1) + '</span><p>' +
          esc(question) + '</p><textarea class="ars-textarea" data-faq-answer="' + index +
          '" placeholder="確認済みの回答案を入力してください。未入力のまま公開しないでください。"></textarea></div>';
      }).join('');
    }
    persist(false);
    renderLegacyKpis();
  }

  function seedKeywordsExpert() {
    profileFromForm();
    state.keywords = buildKeywordCandidates({
      url: state.profile.url || 'https://example.invalid/',
      goal: 'inquiry',
      keywordCount: 100,
      region: valueOf('analysis-region') || '地域未指定',
      useProfileContext: true
    }, null).map(function (candidate) {
      return normalizeExpertKeyword({
        id: candidate.keyword_id,
        text: candidate.keyword,
        intent: candidate.intent,
        cluster: candidate.cluster,
        priority: candidate.priority,
        targetUrl: candidate.target_url,
        status: candidate.status
      });
    });
    persist();
  }

  function generateFilesExpert() {
    var input;
    var keywords;
    var prompts;
    var actions;
    var job;
    var bundle;
    profileFromForm();
    input = {
      url: state.profile.url || valueOf('analysis-url'),
      goal: valueOf('analysis-goal') || 'inquiry',
      keywordCount: state.keywords.length >= 100 ? 100 : (state.keywords.length >= 50 ? 50 : 20),
      region: valueOf('analysis-region') || '地域未指定',
      useProfileContext: true
    };
    keywords = state.keywords.length ? state.keywords.slice(0, input.keywordCount).map(function (keyword, index) {
      var estimated = estimateDemand(keyword.text);
      var gsc = exactGscIndex(input.url)[normalizeKeyword(keyword.text)] || null;
      return {
        keyword_id: 'kw_' + pad3(index + 1),
        keyword: keyword.text,
        intent: keyword.intent,
        cluster: keyword.cluster,
        priority: keyword.priority,
        estimated_monthly_demand: estimated,
        volume_source: 'Estimated',
        gsc_impressions: gsc ? gsc.impressions : null,
        gsc_source: gsc ? 'Official' : null,
        gsc_status: gsc ? 'matched' : (getGscStatus(input.url).connected ? 'not_matched' : 'not_connected'),
        target_url: keyword.targetUrl || input.url,
        competitor_gap: '未計測',
        competitor_gap_source: null,
        ai_prompt_count: 3,
        status: keyword.status,
        action: candidateAction(keyword.text)
      };
    }) : buildKeywordCandidates(input, null);
    prompts = buildPromptCandidates(keywords, input);
    actions = buildActions(input, null, keywords, prompts);
    job = {
      id: uid('expert_draft'),
      status: 'completed',
      input: input,
      diagnosis: null,
      keyword_candidates: keywords,
      prompt_candidates: prompts,
      actions: actions
    };
    bundle = buildArtifactBundle(job);
    state.generated = clone(bundle.files);
    setText('implementation-guide', '実装下書きを生成しました。事実確認 → 可視本文 → Schema照合 → 人間承認の順に確認してください。');
    persist();
  }

  function loadDemo() {
    state.profile = {
      url: 'https://trillion-bank.jp/',
      brand: '株式会社Trillion Bank',
      service: 'HackⅡ / AirReach',
      audience: '企業のマーケティング・経営担当者',
      summary: 'AI検索での見え方を確認し、改善候補と再計測の計画を整理します。'
    };
    state.competitors = [];
    state.measurements = state.measurements.filter(function (row) { return row.source_type !== 'demo'; });
    state.measurements.push({
      id: uid('demo'),
      source_type: 'demo',
      source: 'Sample data',
      evidence_class: 'Sample',
      date: '2026-09-01',
      keyword: 'サンプルキーワード',
      normalized_keyword: normalizeKeyword('サンプルキーワード'),
      url: 'https://trillion-bank.jp/',
      impressions: 100,
      clicks: 5,
      position: 12,
      sessions: null,
      key_events: null,
      ai_mention: null,
      ai_citation: null
    });
    seedKeywordsExpert();
    fillProfile();
    persist();
  }

  function runGapAnalysis() {
    var checked = [];
    var definitions = [
      ['pricing', '料金・プラン', '購入判断に必要な価格条件を確認'],
      ['case', '事例・Before/After', '公開許諾済みの根拠を確認'],
      ['comparison', '比較・選び方', '比較軸の下書きを確認'],
      ['faq', 'FAQ', '可視FAQの有無を確認'],
      ['evidence', '一次情報・独自データ', '引用可能な一次情報を確認'],
      ['author', '運営主体・監修者', '公開中の運営主体情報を確認'],
      ['schema', 'JSON-LD / Schema', '可視本文との一致を確認'],
      ['cta', 'CV導線', '問い合わせ導線を確認'],
      ['policy', 'ポリシー', '責任範囲を確認']
    ];
    var output = q('gap-results');
    if (!output) return;
    each(document.querySelectorAll('.gap-check:checked'), function (element) { checked.push(element.value); });
    output.innerHTML = definitions.filter(function (definition) {
      return checked.indexOf(definition[0]) < 0;
    }).map(function (definition, index) {
      return '<li><strong>P' + (index < 3 ? '0' : (index < 6 ? '1' : '2')) + ' · ' +
        esc(definition[1]) + '</strong>' + esc(definition[2]) + '</li>';
    }).join('') || '<li><strong>主要項目は確認済み</strong>公開内容と実装状態を人間が再確認してください。</li>';
  }

  function bindExpertNavigation() {
    var scope = q('expert-panels') || document;
    each(scope.querySelectorAll('.ars-side button[data-panel]'), function (button) {
      button.addEventListener('click', function () {
        var panelName = button.getAttribute('data-panel');
        each(scope.querySelectorAll('.ars-side button[data-panel]'), function (item) {
          item.classList.remove('is-active');
          item.setAttribute('aria-selected', 'false');
        });
        each(scope.querySelectorAll('.ars-panel[data-panel-view]'), function (panel) {
          panel.classList.remove('is-active');
          panel.hidden = true;
        });
        button.classList.add('is-active');
        button.setAttribute('aria-selected', 'true');
        var target = scope.querySelector('[data-panel-view="' + panelName.replace(/"/g, '') + '"]');
        if (target) {
          target.classList.add('is-active');
          target.hidden = false;
        }
        if (panelName === 'timeseries') renderMeasurements();
      });
    });
  }

  function resetStudioState() {
    if (root.AirReachOrchestrator && typeof root.AirReachOrchestrator.reset === 'function') {
      root.AirReachOrchestrator.reset();
    }
    safeStorageRemove(STORAGE_KEY);
    safeStorageRemove(LEGACY_KEY);
    safeStorageRemove(BASELINE_KEY);
    state = defaultState();
    overviewJob = null;
    fillProfile();
    renderAll();
  }

  function bindExpert() {
    bindExpertNavigation();
    on('save-profile', 'click', function () { profileFromForm(); persist(); });
    on('add-competitor', 'click', function () {
      var url = safeLine(valueOf('comp-url'));
      if (!url) return;
      state.competitors.push({ url: url, note: text(valueOf('comp-note')) });
      setValue('comp-url', '');
      setValue('comp-note', '');
      persist();
    });
    on('run-gap-analysis', 'click', runGapAnalysis);
    on('generate-faq-gap', 'click', generateFaq);
    on('generate-files', 'click', generateFilesExpert);
    on('seed-keywords', 'click', seedKeywordsExpert);
    on('add-keyword', 'click', function () {
      var keyword = safeLine(valueOf('kw-text'));
      if (!keyword) return;
      state.keywords.push(normalizeExpertKeyword({
        text: keyword,
        intent: valueOf('kw-intent'),
        cluster: valueOf('kw-cluster'),
        priority: valueOf('kw-priority'),
        status: '未対策'
      }));
      setValue('kw-text', '');
      persist();
    });
    on('export-keywords', 'click', function () {
      downloadText('airreach-keywords.csv', toCsv(state.keywords.map(function (keyword) {
        return {
          priority: keyword.priority,
          keyword: keyword.text,
          intent: keyword.intent,
          cluster: keyword.cluster,
          target_url: keyword.targetUrl,
          status: keyword.status
        };
      }), ['priority', 'keyword', 'intent', 'cluster', 'target_url', 'status']), 'text/csv;charset=utf-8');
    });
    on('download-current-file', 'click', function () {
      var name = valueOf('file-preview-select');
      if (name && Object.prototype.hasOwnProperty.call(state.generated, name)) {
        downloadText(name.split('/').pop(), state.generated[name]);
      }
    });
    on('download-all-files', 'click', function () {
      if (!Object.keys(state.generated).length) return;
      downloadArtifactBundle({ file_name: 'airreach-studio-expert-drafts.zip', files: state.generated });
    });
    on('timeseries-keyword', 'change', renderMeasurements);
    on('export-measurements', 'click', function () {
      downloadText('airreach-measurements.csv', toCsv(state.measurements, [
        'date', 'source_type', 'source', 'evidence_class', 'keyword', 'url', 'impressions', 'clicks',
        'position', 'sessions', 'key_events', 'ai_mention', 'ai_citation'
      ]), 'text/csv;charset=utf-8');
    });
    on('save-google-settings', 'click', function () {
      var binding;
      state.google.gscSite = safeLine(valueOf('gsc-site'));
      state.google.gaProperty = safeLine(valueOf('ga-property'));
      binding = rebindConfiguredGscProperty();
      persist(false);
      var status = q('google-status');
      if (status) {
        status.textContent = binding.bound
          ? '設定を保存し、取込済みGSCを対象プロパティへ紐づけました。Googleライブ接続は未接続です。'
          : (binding.attempted
            ? '設定を保存しましたが、取込済みGSCのPageと一致しないため紐づけていません。Googleライブ接続は未接続です。'
            : '設定をブラウザに保存しました。Googleライブ接続は未接続です。');
      }
    });
    // google-connect / sync-gsc / sync-ga4 are intentionally not bound in Phase 1.
    on('import-hack2', 'click', function () {
      try {
        importHack2Rows(JSON.parse(valueOf('hack2-json')));
        persist();
      } catch (error) {
        notifyUser('HackⅡ JSONを読み込めませんでした: ' + error.message);
      }
    });
    on('ars-demo', 'click', loadDemo);
    on('ars-reset', 'click', function () {
      if (typeof root.confirm === 'function' && !root.confirm('AirReach Studioのブラウザ保存データを初期化しますか？')) return;
      resetStudioState();
    });
    on('studio-reset', 'click', function () {
      if (typeof root.confirm === 'function' && !root.confirm('AirReach Studioのブラウザ保存データを初期化しますか？')) return;
      resetStudioState();
    });
    fileHandler('gsc-csv', importGscRows);
    fileHandler('ga4-csv', importGa4Rows);
    fileHandler('keyword-csv', function (rows) {
      rows.forEach(function (row) {
        var keyword = safeLine(getCaseInsensitive(row, ['keyword', 'query', 'キーワード']));
        if (!keyword) return;
        state.keywords.push(normalizeExpertKeyword({
          text: keyword,
          intent: getCaseInsensitive(row, ['intent']) || 'Informational',
          cluster: getCaseInsensitive(row, ['cluster']),
          priority: getCaseInsensitive(row, ['priority']) || 'P1',
          targetUrl: getCaseInsensitive(row, ['target_url', 'url']),
          status: getCaseInsensitive(row, ['status']) || '未対策'
        }));
      });
    });
  }

  function statusLabel(status) {
    return ({
      idle: '未実行',
      pending: '未実行',
      validating: '確認中',
      running: '処理中',
      completed: '完了',
      succeeded: '完了',
      warning: '注意あり',
      failed: '失敗',
      interrupted: '中断',
      skipped: '対象外',
      cancelled: '中止'
    })[status] || safeLine(status) || '未実行';
  }

  function completedJob(job) {
    return !!job && (job.status === 'completed' || job.status === 'succeeded');
  }

  function renderAnalysisSteps(job) {
    var container = q('analysis-steps');
    if (!container) return;
    while (container.firstChild) container.removeChild(container.firstChild);
    (job && isArray(job.steps) ? job.steps : []).forEach(function (step) {
      var item = document.createElement(/^(UL|OL)$/.test(container.tagName) ? 'li' : 'div');
      var mark = document.createElement('span');
      var copy = document.createElement('span');
      var strong = document.createElement('strong');
      var small = document.createElement('small');
      var label = safeLine(step.label || step.id);
      var status = statusLabel(step.status);
      if ((step.id === 'competitors' || step.id === 'competitor_context') && (step.status === 'completed' || step.status === 'succeeded' || step.status === 'warning')) {
        status = 'ライブ未接続・未計測';
      }
      item.className = 'ars-progress-step is-' + safeLine(step.status).replace(/[^a-z_-]/gi, '');
      item.setAttribute('data-step-id', safeLine(step.id));
      if (step.status === 'running') item.setAttribute('aria-current', 'step');
      mark.className = 'ars-progress-mark';
      mark.setAttribute('aria-hidden', 'true');
      strong.textContent = label;
      small.textContent = status;
      copy.appendChild(strong);
      copy.appendChild(small);
      item.appendChild(mark);
      item.appendChild(copy);
      container.appendChild(item);
    });
  }

  function addTableCell(row, value, className, label) {
    var cell = document.createElement('td');
    if (className) cell.className = className;
    if (label) cell.setAttribute('data-label', label);
    cell.textContent = value == null ? '' : value;
    row.appendChild(cell);
    return cell;
  }

  function renderStrategy(job) {
    var body = q('strategy-body');
    var candidates = job && isArray(job.keyword_candidates) ? job.keyword_candidates : [];
    var visible = overviewShowAll ? candidates : candidates.slice(0, 20);
    var toggle = q('toggle-keywords');
    if (!body) return;
    while (body.firstChild) body.removeChild(body.firstChild);
    visible.forEach(function (candidate) {
      var row = document.createElement('tr');
      var gscValue;
      addTableCell(row, candidate.priority || 'P1', '', '優先');
      addTableCell(row, candidate.keyword || '', '', 'KW');
      addTableCell(row, candidate.estimated_monthly_demand == null ? '未取得' : formatNumber(candidate.estimated_monthly_demand) + '（推定）', 'num', '需要推定 / 月');
      if (candidate.gsc_status === 'matched') gscValue = formatNumber(candidate.gsc_impressions) + '（実測）';
      else if (candidate.gsc_status === 'not_matched') gscValue = '該当なし';
      else if (candidate.gsc_status === 'property_mismatch') gscValue = '対象不一致';
      else if (candidate.gsc_status === 'unbound') gscValue = '対象未確認';
      else gscValue = 'GSC未接続';
      addTableCell(row, gscValue, 'num', 'GSC表示回数');
      addTableCell(row, candidate.status || '未対策', '', '状態');
      addTableCell(row, String(candidate.ai_prompt_count == null ? 0 : candidate.ai_prompt_count), 'num', 'AI質問数');
      addTableCell(row, candidate.competitor_gap || '未計測', '', '競合差');
      addTableCell(row, candidate.action || '確認する', '', 'やること');
      body.appendChild(row);
    });
    if (toggle) {
      setHidden(toggle, candidates.length <= 20);
      toggle.textContent = overviewShowAll ? '上位20件に戻す' : 'すべて表示（' + candidates.length + '件）';
      toggle.setAttribute('aria-expanded', overviewShowAll ? 'true' : 'false');
    }
  }

  function renderImplementation(job) {
    var container = q('implementation-breakdown');
    var actions = job && isArray(job.actions) ? job.actions : [];
    var seen = {};
    var counts = { existing: 0, new: 0, faq: 0, schema: 0, link: 0 };
    var total = 0;
    var labels = { existing: '既存', 'new': '新規', faq: 'FAQ', schema: 'Schema', link: 'リンク' };
    actions.forEach(function (action) {
      var type = action.type === 'existing_page' ? 'existing' : (action.type === 'new_page' ? 'new' : action.type);
      var key = safeLine(action.target_key) || (type + '|' + normalizeKeyword(action.target_url));
      if (action.status === 'blocked' || action.blocked_reason) return;
      if (action.status && action.status !== 'draft' && action.status !== 'ready') return;
      if (!Object.prototype.hasOwnProperty.call(counts, type) || seen[key]) return;
      seen[key] = true;
      counts[type] += 1;
      total += 1;
    });
    if (container) {
      while (container.firstChild) container.removeChild(container.firstChild);
      ACTION_TYPES.forEach(function (type) {
        var item = document.createElement('span');
        item.className = 'implementation-count';
        item.textContent = labels[type] + ' ' + counts[type];
        container.appendChild(item);
      });
    }
    setText('implementation-total', '直すのは ' + total + ' 箇所');
  }

  function renderGscResult(job) {
    var element = q('gsc-result-status');
    var status = job && job.gsc_status ? job.gsc_status : getGscStatus();
    if (!element) return;
    if (status && status.connected) {
      element.textContent = 'GSC CSV実測：' + (status.period_start || '期間未記録') + '〜' + (status.period_end || '期間未記録');
      element.className = 'ars-source-status is-official';
    } else if (status && status.status === 'property_mismatch') {
      element.textContent = 'GSC対象不一致：入力URLと取込データのプロパティが一致しないため、実測値を使用していません。';
      element.className = 'ars-source-status ars-note warn';
    } else if (status && status.status === 'unbound') {
      element.textContent = 'GSC取込済み・対象未確認：プロパティ確認後にのみ実測値を使用します。';
      element.className = 'ars-source-status ars-note warn';
    } else {
      element.textContent = 'GSC未接続：市場需要の推定値のみ表示しています。';
      element.className = 'ars-source-status is-muted';
    }
  }

  function renderAnalysisJob(job) {
    var progress = q('analysis-progress');
    var progressLabel = q('analysis-progress-label');
    var error = q('analysis-error');
    var results = q('analysis-results');
    var runButton = q('run-analysis');
    var downloadButton = q('download-zip');
    var summary = job && job.summary ? job.summary : {};
    var running = !!job && (job.status === 'running' || job.status === 'validating');
    var done = completedJob(job);
    var hasWarnings = !!(job && isArray(job.warnings) && job.warnings.length);
    var progressValue = job && isFinite(Number(job.progress)) ? Math.max(0, Math.min(100, Number(job.progress))) : 0;
    overviewJob = job || null;
    setHidden(progress, !job || job.status === 'idle');
    if (progress) {
      progress.setAttribute('aria-busy', running ? 'true' : 'false');
      progress.style.setProperty('--progress', progressValue + '%');
    }
    if (progressLabel) {
      var finishedSteps = job && isArray(job.steps) ? job.steps.filter(function (step) {
        return ['completed', 'succeeded', 'warning', 'failed', 'skipped'].indexOf(step.status) >= 0;
      }).length : 0;
      var stepTotal = job && isArray(job.steps) && job.steps.length ? job.steps.length : 7;
      progressLabel.textContent = job
        ? (finishedSteps + ' / ' + stepTotal + '　' + statusLabel(job.status) + (done && hasWarnings ? '（確認できない項目あり）' : ''))
        : '0 / 7　未実行';
    }
    if (runButton) {
      runButton.disabled = running;
      runButton.setAttribute('aria-busy', running ? 'true' : 'false');
    }
    renderAnalysisSteps(job);
    if (error) {
      if (job && (job.status === 'failed' || job.status === 'interrupted') && job.error) {
        error.textContent = job.error.message || '分析を完了できませんでした。';
        error.className = 'ars-alert ars-alert-error';
        setHidden(error, false);
      } else if (done && hasWarnings) {
        error.textContent = '確認できない項目があります。' + job.warnings.map(function (warning) {
          return safeLine(warning.message);
        }).filter(Boolean).join(' / ');
        error.className = 'ars-alert ars-note warn';
        setHidden(error, false);
      } else {
        error.textContent = '';
        error.className = 'ars-alert ars-alert-error';
        setHidden(error, true);
      }
    }
    setHidden(results, !done);
    setText('analysis-result-title', done ? (hasWarnings ? '分析結果（確認できない項目あり・実装下書き）' : '分析結果（実装下書き）') : '分析結果');
    if (done) {
      setText('result-keyword-count', summary.keyword_count != null ? summary.keyword_count : summary.keywordCount);
      setText('result-demand', formatNumber(summary.estimated_monthly_demand != null ? summary.estimated_monthly_demand : summary.estimatedMonthlyDemand));
      var readiness = summary.diagnosis_overall != null ? summary.diagnosis_overall : summary.diagnosisOverall;
      setText('result-readiness', readiness == null ? '未取得' : readiness + ' / 100');
      setText('result-action-count', summary.action_count != null ? summary.action_count : summary.actionCount);
      setText('analysis-conclusion', job.conclusion || '優先度の高い候補から、人間が事実と実装範囲を確認してください。');
      renderGscResult(job);
      renderStrategy(job);
      renderImplementation(job);
    }
    if (downloadButton) {
      downloadButton.disabled = !(done && job.artifact_bundle && job.artifact_bundle.files);
      downloadButton.setAttribute('aria-disabled', downloadButton.disabled ? 'true' : 'false');
    }
  }

  function ensureScopeNote() {
    var note = q('analysis-scope-note') || (typeof document !== 'undefined' ? document.querySelector('.ars-scope-note') : null);
    var form = q('analysis-form');
    if (note) {
      if (!note.id) note.id = 'analysis-scope-note';
      note.textContent = 'Phase 1の自動確認範囲は、入力URLの公開HTMLとサイトルートの llms.txt・robots.txt です。サイト内全ページの巡回、競合SERP、HackⅡライブ測定は行いません。ブラウザから取得できない場合は未確認として続行します。';
      return;
    }
    if (!form || !form.parentNode) return;
    note = document.createElement('p');
    note.id = 'analysis-scope-note';
    note.className = 'ars-note';
    note.textContent = 'Phase 1の自動確認範囲は、入力URLの公開HTMLとサイトルートの llms.txt・robots.txt です。サイト内全ページの巡回、競合SERP、HackⅡライブ測定は行いません。ブラウザから取得できない場合は未確認として続行します。';
    form.parentNode.insertBefore(note, form.nextSibling);
  }

  function currentAnalysisInput() {
    return {
      url: cleanText(valueOf('analysis-url') || valueOf('site-url')),
      goal: cleanText(valueOf('analysis-goal')),
      keywordCount: Number(valueOf('analysis-keyword-count')),
      region: cleanText(valueOf('analysis-region'))
    };
  }

  function runOverviewAnalysis(event) {
    var orchestrator = root.AirReachOrchestrator;
    var input;
    if (event && event.preventDefault) event.preventDefault();
    if (!orchestrator || typeof orchestrator.run !== 'function') {
      var error = q('analysis-error');
      if (error) {
        error.textContent = '分析処理を読み込めませんでした。ページを再読み込みしてください。';
        setHidden(error, false);
      }
      return;
    }
    input = currentAnalysisInput();
    try {
      var validatedUrl = sanitizePublicUrl(input.url, false);
      clearMismatchedOfficialBaseline(validatedUrl);
      state.profile.url = validatedUrl;
      setValue('site-url', validatedUrl);
      persist(false);
    } catch (inputError) {
      // The orchestrator creates a fresh failed job so stale results and ZIP
      // controls are cleared instead of leaving the previous success visible.
    }
    orchestrator.run(input).catch(function () {
      // The orchestrator subscription renders its structured failure state.
      renderAnalysisJob(orchestrator.getJob());
    });
  }

  function connectOrchestrator() {
    var orchestrator = root.AirReachOrchestrator;
    var ignoreInitialIdle = !!(state.analysis_job && state.analysis_job.status !== 'idle');
    if (!orchestrator || typeof orchestrator.subscribe !== 'function' || orchestratorUnsubscribe) return false;
    orchestratorUnsubscribe = orchestrator.subscribe(function (job) {
      if (ignoreInitialIdle && job.status === 'idle') {
        ignoreInitialIdle = false;
        return;
      }
      ignoreInitialIdle = false;
      setAnalysisJob(job);
    });
    return true;
  }

  function bindOverview() {
    var form = q('analysis-form');
    var runButton = q('run-analysis');
    ensureScopeNote();
    if (form) {
      form.addEventListener('submit', runOverviewAnalysis);
      if (runButton && !form.contains(runButton)) runButton.addEventListener('click', runOverviewAnalysis);
    } else if (runButton) {
      runButton.addEventListener('click', runOverviewAnalysis);
    }
    on('toggle-keywords', 'click', function () {
      overviewShowAll = !overviewShowAll;
      renderStrategy(overviewJob);
    });
    on('download-zip', 'click', function () {
      if (!completedJob(overviewJob) || !overviewJob.artifact_bundle) return;
      try {
        downloadArtifactBundle(overviewJob.artifact_bundle);
      } catch (error) {
        var errorElement = q('analysis-error');
        if (errorElement) {
          errorElement.textContent = 'ZIPを生成できませんでした: ' + error.message;
          setHidden(errorElement, false);
        }
      }
    });
    renderAnalysisJob(state.analysis_job);
    if (!connectOrchestrator()) setTimeout(connectOrchestrator, 0);
  }

  function restoreHashPanel() {
    try {
      var panel = (root.location && root.location.hash ? root.location.hash : '').replace('#', '');
      var scope = q('expert-panels') || document;
      var button;
      if (['google', 'timeseries', 'files', 'generator', 'keywords', 'gaps', 'competitors', 'hack2'].indexOf(panel) < 0) return;
      button = scope.querySelector('.ars-side button[data-panel="' + panel.replace(/"/g, '') + '"]');
      if (button) {
        if (q('expert-panels') && q('expert-panels').tagName === 'DETAILS') q('expert-panels').open = true;
        button.click();
      }
    } catch (e) {
      // Hash navigation is optional.
    }
  }

  function initialize() {
    // Persist an interrupted state immediately so a second reload cannot look
    // like the old job is still running.
    persist(false);
    fillProfile();
    bindOverview();
    bindExpert();
    renderAll();
    restoreHashPanel();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
    else initialize();
  }
})(typeof window !== 'undefined' ? window : this);
