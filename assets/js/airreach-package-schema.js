/**
 * Shared package tree + validators for HackⅡ Studio ZIP / GitHub draft PR.
 * Source of truth for paths: docs/airreach-studio-package-blueprint.md
 */
(function (root) {
  'use strict';

  var PACKAGE_ROOT = 'airreach-implementation';
  var ZIP_FILENAME = 'airreach-implementation.zip';

  var REQUIRED_FILES = [
    'README.md',
    'MANIFEST.json',
    'AGENT_PROMPT.md',
    'strategy/keywords.csv',
    'strategy/prompts.csv',
    'strategy/actions.csv',
    'schema/organization.jsonld',
    'schema/service.jsonld',
    'schema/faq.jsonld',
    'public/llms.txt',
    'public/llms-full.txt',
    'content/faq.md',
    'validation/VALIDATION.md'
  ];

  var KEYWORD_CSV_COLUMNS = [
    'priority', 'keyword', 'volume', 'volume_source',
    'gsc_impressions', 'gsc_clicks', 'ai_mention_rate', 'ai_citation_rate',
    'intent', 'cluster', 'gap', 'action', 'seed_source'
  ];

  var PROMPT_CSV_COLUMNS = ['keyword', 'prompt', 'intent', 'commercial_score'];
  var ACTION_CSV_COLUMNS = ['type', 'count', 'note'];

  var VALIDATION_ITEMS = [
    '料金・事例・顧客名・数値の捏造がない',
    'FAQ回答を人間が事実確認した',
    'JSON-LDが公開文面と一致する',
    'llms.txtのリンクが解決する',
    'ステークホルダーが公開を承認した',
    'Entity Lock（ドメイン・組織・サービス一致）を通過した'
  ];

  function hostOf(url) {
    try {
      var u = String(url || '').trim();
      if (!u) return '';
      if (u.indexOf('http') !== 0) u = 'https://' + u;
      return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
    } catch (e) { return ''; }
  }

  function parseJsonMaybe(v) {
    if (v == null) return null;
    if (typeof v === 'object') return v;
    try { return JSON.parse(String(v)); } catch (e) { return null; }
  }

  /**
   * Entity Lock: DOMAIN → ORGANIZATION → SERVICE must agree.
   * Blocks mixed-brand packages from being treated as publishable.
   */
  function validateEntityLock(files, opts) {
    opts = opts || {};
    var map = files || {};
    var errors = [];
    var warnings = [];
    var manifest = parseJsonMaybe(map['MANIFEST.json']) || {};
    var org = parseJsonMaybe(map['schema/organization.jsonld']) || {};
    var service = parseJsonMaybe(map['schema/service.jsonld']) || {};
    var targetHost = hostOf(opts.targetUrl || manifest.target_url || manifest.url || '');
    var orgUrl = org.url || (org['@id'] || '');
    var orgHost = hostOf(orgUrl);
    var orgName = String(org.name || org.legalName || '').trim();
    var serviceName = String(service.name || '').trim();
    var serviceProvider = '';
    if (service.provider) {
      serviceProvider = typeof service.provider === 'string'
        ? service.provider
        : String(service.provider.name || '');
    }

    if (!targetHost) {
      errors.push('Entity Lock: target URL / MANIFEST target_url が必要です');
    }
    if (!orgName) errors.push('Entity Lock: organization.name が空です');
    if (targetHost && orgHost && targetHost !== orgHost) {
      errors.push('Entity Lock: 対象ドメイン(' + targetHost + ')と organization.url(' + orgHost + ')が一致しません。公開不可・要確認');
    }
    if (serviceProvider && orgName && serviceProvider.indexOf(orgName) === -1 && orgName.indexOf(serviceProvider) === -1) {
      warnings.push('Entity Lock: service.provider と organization.name が一致しない可能性');
    }

    var kwBody = String(map['strategy/keywords.csv'] || '');
    var badKw = [];
    kwBody.split(/\r?\n/).slice(1).forEach(function (line) {
      if (!line.trim()) return;
      var cells = line.split(',');
      var kw = String(cells[1] || cells[0] || '').trim();
      if (/^関連\s*\d+$/i.test(kw) || /^related\s*\d+$/i.test(kw)) badKw.push(kw);
    });
    if (badKw.length) {
      errors.push('Entity Lock: 機械的キーワードは公開不可: ' + badKw.slice(0, 5).join(', '));
    }

    // Cross-brand residue: other known demo brands mixed into text
    var blob = [
      String(map['content/faq.md'] || ''),
      String(map['public/llms.txt'] || ''),
      String(map['README.md'] || ''),
      JSON.stringify(org),
      JSON.stringify(service)
    ].join('\n');
    var lockedBrand = orgName;
    if (lockedBrand && /メディくる|CROSSONE|amasora|豊胸/i.test(blob)) {
      var hits = [];
      if (/メディくる/i.test(blob) && !/メディくる/i.test(lockedBrand)) hits.push('メディくる');
      if (/CROSSONE/i.test(blob) && !/CROSSONE/i.test(lockedBrand)) hits.push('CROSSONE');
      if (/amasora/i.test(blob) && !/amasora/i.test(lockedBrand)) hits.push('amasora');
      if (hits.length) errors.push('Entity Lock: 別ブランド痕跡が混在: ' + hits.join(', ') + '。公開不可・要確認');
    }

    return {
      ok: errors.length === 0,
      publishable: errors.length === 0,
      errors: errors,
      warnings: warnings,
      targetHost: targetHost,
      orgHost: orgHost,
      orgName: orgName,
      serviceName: serviceName
    };
  }

  function validatePackageFiles(files, opts) {
    var missing = [];
    var extra = [];
    var map = files || {};
    var i;
    for (i = 0; i < REQUIRED_FILES.length; i++) {
      if (map[REQUIRED_FILES[i]] == null || map[REQUIRED_FILES[i]] === '') {
        missing.push(REQUIRED_FILES[i]);
      }
    }
    Object.keys(map).forEach(function (k) {
      if (REQUIRED_FILES.indexOf(k) === -1) extra.push(k);
    });
    var errors = [];
    if (missing.length) errors.push('missing: ' + missing.join(', '));
    try {
      var manifest = typeof map['MANIFEST.json'] === 'string'
        ? JSON.parse(map['MANIFEST.json'])
        : map['MANIFEST.json'];
      if (!manifest || !manifest.evidence) errors.push('MANIFEST.json.evidence required');
      if (manifest && !manifest.generated_at) errors.push('MANIFEST.json.generated_at required');
    } catch (e) {
      errors.push('MANIFEST.json is not valid JSON');
    }
    var kwHead = String(map['strategy/keywords.csv'] || '').split(/\r?\n/)[0] || '';
    KEYWORD_CSV_COLUMNS.forEach(function (col) {
      if (kwHead.indexOf(col) === -1) errors.push('keywords.csv missing column: ' + col);
    });
    var lock = validateEntityLock(map, opts || {});
    lock.errors.forEach(function (e) { errors.push(e); });
    return {
      ok: errors.length === 0 && missing.length === 0,
      missing: missing,
      extra: extra,
      errors: errors,
      entityLock: lock,
      publishable: errors.length === 0 && missing.length === 0 && lock.publishable
    };
  }

  var api = {
    PACKAGE_ROOT: PACKAGE_ROOT,
    ZIP_FILENAME: ZIP_FILENAME,
    REQUIRED_FILES: REQUIRED_FILES,
    KEYWORD_CSV_COLUMNS: KEYWORD_CSV_COLUMNS,
    PROMPT_CSV_COLUMNS: PROMPT_CSV_COLUMNS,
    ACTION_CSV_COLUMNS: ACTION_CSV_COLUMNS,
    VALIDATION_ITEMS: VALIDATION_ITEMS,
    validatePackageFiles: validatePackageFiles,
    validateEntityLock: validateEntityLock
  };

  root.AirReachPackageSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
