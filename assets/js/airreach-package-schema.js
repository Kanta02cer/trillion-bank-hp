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
    'ステークホルダーが公開を承認した'
  ];

  function validatePackageFiles(files) {
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
    return {
      ok: errors.length === 0 && missing.length === 0,
      missing: missing,
      extra: extra,
      errors: errors
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
    validatePackageFiles: validatePackageFiles
  };

  root.AirReachPackageSchema = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
