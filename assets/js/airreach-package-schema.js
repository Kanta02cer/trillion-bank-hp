/**
 * Shared package tree + validators for AirReach Tools Studio ZIP / GitHub draft PR.
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

  // 最小の ZIP：設置に必要なものだけ（README・MANIFEST・設置の手順・FAQ・構造化データ・llms.txt）。README と MANIFEST と手順は必ず入れる
  var PACKAGE_FORMAT = 'airreach-package/2';
  var ALWAYS_FILES = ['README.md', 'MANIFEST.json', 'INSTALL_WORDPRESS.md'];
  var MINIMAL_FILES = ALWAYS_FILES.concat(['content/faq.md', 'schema/organization.jsonld', 'schema/service.jsonld', 'schema/faq.jsonld', 'public/llms.txt']);

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
      if (typeof URL !== 'undefined') {
        return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
      }
      var m = u.match(/^https?:\/\/([^\/?#]+)/i);
      if (!m) return '';
      return m[1].replace(/^www\./, '').toLowerCase();
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

    // Cross-brand residue: soft-warn unless token matches locked brand or target host
    var blob = [
      String(map['content/faq.md'] || ''),
      String(map['public/llms.txt'] || ''),
      String(map['README.md'] || ''),
      JSON.stringify(org),
      JSON.stringify(service)
    ].join('\n');
    var lockedBrand = orgName;
    var brandTokens = [
      { re: /メディくる/i, label: 'メディくる' },
      { re: /CROSSONE/i, label: 'CROSSONE' },
      { re: /amasora/i, label: 'amasora' },
      { re: /豊胸/i, label: '豊胸' }
    ];
    var hits = [];
    brandTokens.forEach(function (t) {
      if (!t.re.test(blob)) return;
      var allowed = false;
      if (lockedBrand && t.re.test(lockedBrand)) allowed = true;
      if (targetHost && targetHost.indexOf(t.label.toLowerCase()) !== -1) allowed = true;
      if (!allowed) hits.push(t.label);
    });
    if (hits.length) {
      warnings.push('Entity Lock: 別ブランド痕跡が混在: ' + hits.join(', ') + '。公開不可・要確認（ドラフトZIPは可）');
    }

    var publishable = errors.length === 0 && warnings.filter(function (w) {
      return /別ブランド痕跡|公開不可/.test(w);
    }).length === 0;

    return {
      ok: errors.length === 0,
      publishable: publishable,
      draftOk: errors.length === 0,
      errors: errors,
      warnings: warnings,
      targetHost: targetHost,
      orgHost: orgHost,
      orgName: orgName,
      serviceName: serviceName
    };
  }

  /** 文字列の SHA-256（16進）。ブラウザと Node（globalThis.crypto.subtle）で同じ */
  function sha256Hex(text) {
    var c = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto : (root.crypto || null);
    if (!c || !c.subtle) return Promise.reject(new Error('SHA-256 を計算できません'));
    return c.subtle.digest('SHA-256', new TextEncoder().encode(String(text))).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    });
  }
  /** 展開したファイルが MANIFEST.files の大きさ・ハッシュと同じかを確かめる → { ok, errors } */
  function verifyManifestHashes(files) {
    var map = files || {};
    var mf = parseJsonMaybe(map['MANIFEST.json']) || {};
    if (!Array.isArray(mf.files)) return Promise.resolve({ ok: false, errors: ['MANIFEST.files がありません'] });
    return Promise.all(mf.files.map(function (x) {
      if (!(x.path in map)) return Promise.resolve(x.path + ': 入っていません');
      var bytes = new TextEncoder().encode(String(map[x.path])).length;
      if (bytes !== x.bytes) return Promise.resolve(x.path + ': 大きさが違います（' + bytes + ' / ' + x.bytes + '）');
      return sha256Hex(map[x.path]).then(function (h) { return h === x.sha256 ? null : x.path + ': 中身が MANIFEST と違います'; });
    })).then(function (r) { var errors = r.filter(Boolean); return { ok: !errors.length, errors: errors }; });
  }
  /** 入れるファイルを選ぶ（README・MANIFEST・設置の手順は必ず入れる。無いファイルは飛ばす） */
  function selectFiles(files, paths) {
    var out = {};
    var want = ALWAYS_FILES.concat(paths || []);
    Object.keys(files || {}).forEach(function (k) { if (k !== '_validation' && want.indexOf(k) >= 0) out[k] = files[k]; });
    return out;
  }

  function validatePackageFiles(files, opts) {
    var missing = [];
    var extra = [];
    var map = files || {};
    var i;
    // 飲食店は Service ではなく Restaurant（organization.jsonld）に業態を書くので service.jsonld を求めない
    var mf = parseJsonMaybe(map['MANIFEST.json']) || {};
    var industry = (opts && opts.industry) || mf.industry || '';
    // 確定した FAQ の数（MANIFEST の faq_counts.in_schema）。0件なら faq.jsonld は求めない（空の FAQ の JSON-LD は出さない）
    var faqCount = opts && opts.faqCount != null ? Number(opts.faqCount) : (mf.faq_counts && mf.faq_counts.in_schema != null ? Number(mf.faq_counts.in_schema) : null);
    // 一部だけを選んだ ZIP（MANIFEST.selection=partial）は、README と MANIFEST だけを必須にし、選んだファイルは MANIFEST.files と照らす
    var partial = mf.selection === 'partial';
    var required = (partial ? ['README.md', 'MANIFEST.json'] : REQUIRED_FILES).filter(function (f) {
      if (f === 'schema/service.jsonld' && industry === 'restaurant') return false;
      if (f === 'schema/faq.jsonld' && faqCount === 0) return false;
      return true;
    });
    for (i = 0; i < required.length; i++) {
      if (map[required[i]] == null || map[required[i]] === '') {
        missing.push(required[i]);
      }
    }
    Object.keys(map).forEach(function (k) {
      if (REQUIRED_FILES.indexOf(k) === -1 && ALWAYS_FILES.indexOf(k) === -1) extra.push(k);
    });
    var errors = [];
    // MANIFEST.files（入れたファイルの一覧）があれば、一覧と実際のファイルが同じかを見る（中身のハッシュは verifyManifestHashes）
    if (Array.isArray(mf.files)) {
      var listed = mf.files.map(function (x) { return x.path; });
      Object.keys(map).forEach(function (k) { if (k !== 'MANIFEST.json' && listed.indexOf(k) === -1) errors.push('MANIFEST.files に無いファイル: ' + k); });
      listed.forEach(function (k) { if (!(k in map)) errors.push('MANIFEST.files にあるのに入っていないファイル: ' + k); });
    }
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
    // FAQ の JSON-LD：0件なら置かない。置くなら質問が1つ以上あり、件数が MANIFEST と一致する
    if (map['schema/faq.jsonld']) {
      var fl = parseJsonMaybe(map['schema/faq.jsonld']);
      var nq = fl && Array.isArray(fl.mainEntity) ? fl.mainEntity.length : -1;
      if (nq <= 0) errors.push('schema/faq.jsonld has no questions (do not ship an empty FAQ schema)');
      else if (faqCount != null && nq !== faqCount) errors.push('schema/faq.jsonld has ' + nq + ' questions but MANIFEST says ' + faqCount);
    } else if (faqCount === 0 && map['schema/faq.jsonld'] === '') {
      errors.push('schema/faq.jsonld must be omitted when there is no confirmed FAQ');
    }
    // 文章のファイルに、作り途中の値（undefined・null・NaN）を残さない
    Object.keys(map).forEach(function (k) {
      var v = map[k];
      if (typeof v !== 'string' || !/\.(md|txt|csv|jsonld|json)$/.test(k)) return;
      var hit = /(^|[^A-Za-z_])(undefined|NaN)(?![A-Za-z_])/.exec(v.replace(/typeof [A-Za-z_.]+ !== 'undefined'/g, ''));
      if (hit) errors.push(k + ' contains "' + hit[2] + '"');
    });
    var kwHead = String(map['strategy/keywords.csv'] || '').split(/\r?\n/)[0] || '';
    if (!(partial && !('strategy/keywords.csv' in map))) KEYWORD_CSV_COLUMNS.forEach(function (col) {
      if (kwHead.indexOf(col) === -1) errors.push('keywords.csv missing column: ' + col);
    });
    var lock = validateEntityLock(map, opts || {});
    lock.errors.forEach(function (e) { errors.push(e); });
    // 会社・ブランド・サービスを人が確定していない（MANIFEST.entity_confirmed=false）・承認待ちの FAQ がある → 公開用にしない（下書きのみ）
    var gate = [];
    if (mf.entity_confirmed === false) gate.push('会社・ブランド・サービスが未確定です（担当者が確定するまで公開に使えません）');
    if (mf.faq_counts && mf.faq_counts.pending_approval > 0) gate.push('承認待ちの FAQ が ' + mf.faq_counts.pending_approval + ' 問あります');
    var structureOk = errors.length === 0 && missing.length === 0;
    return {
      ok: structureOk,
      missing: missing,
      extra: extra,
      errors: errors,
      warnings: (lock.warnings || []).concat(gate),
      entityLock: lock,
      publishable: structureOk && !!lock.publishable && !gate.length,
      draftOk: structureOk && !!lock.draftOk
    };
  }

  var api = {
    PACKAGE_ROOT: PACKAGE_ROOT,
    ZIP_FILENAME: ZIP_FILENAME,
    PACKAGE_FORMAT: PACKAGE_FORMAT,
    ALWAYS_FILES: ALWAYS_FILES,
    MINIMAL_FILES: MINIMAL_FILES,
    sha256Hex: sha256Hex,
    verifyManifestHashes: verifyManifestHashes,
    selectFiles: selectFiles,
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
