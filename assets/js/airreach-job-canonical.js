/**
 * Job Canonical Model + CSV Source Adapter (v0).
 * Converts rows into internal job records. No per-ATS custom code.
 */
(function (root) {
  'use strict';

  var STORE_KEY = 'airreach_recruit_jobs_canonical_v1';

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
      if (row[keys[i]] != null && String(row[keys[i]]).trim() !== '') return String(row[keys[i]]).trim();
    }
    var lower = {};
    Object.keys(row).forEach(function (k) { lower[String(k).toLowerCase()] = row[k]; });
    for (var j = 0; j < keys.length; j++) {
      var k2 = keys[j].toLowerCase();
      if (lower[k2] != null && String(lower[k2]).trim() !== '') return String(lower[k2]).trim();
    }
    return '';
  }

  function uid() {
    return 'job_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function normalizeEmployment(v) {
    var s = String(v || '').toUpperCase();
    if (/FULL|正社員|フルタイム/.test(s)) return 'FULL_TIME';
    if (/PART|パート|アルバイト/.test(s)) return 'PART_TIME';
    if (/CONTRACT|契約/.test(s)) return 'CONTRACTOR';
    if (/INTERN|インターン/.test(s)) return 'INTERN';
    if (/TEMP|派遣/.test(s)) return 'TEMPORARY';
    return v || '';
  }

  function rowToCanonical(row, source) {
    var title = pick(row, ['title', 'Title', '職種', '求人タイトル', 'job_title']);
    var jobId = pick(row, ['job_id', 'id', 'Job ID', '求人ID', 'identifier']) || uid();
    var remote = pick(row, ['remote_policy', 'remote', 'リモート', '勤務形態']);
    var loc = pick(row, ['location', 'locations', '勤務地', 'job_location']);
    return {
      job_id: jobId,
      organization_id: pick(row, ['organization_id', 'org_id', '会社ID']) || null,
      title: title,
      description: pick(row, ['description', 'Description', '仕事内容', '業務内容']),
      employment_type: normalizeEmployment(pick(row, ['employment_type', 'employmentType', '雇用形態'])),
      locations: loc ? [loc] : [],
      remote_policy: remote || null,
      salary: pick(row, ['salary', 'baseSalary', '給与']) || null,
      date_posted: pick(row, ['date_posted', 'datePosted', '掲載日']) || null,
      valid_through: pick(row, ['valid_through', 'validThrough', '締切']) || null,
      application_url: pick(row, ['application_url', 'url', '応募URL', '求人URL']) || null,
      direct_apply: /^(1|true|yes|はい)$/i.test(pick(row, ['direct_apply', 'directApply', '直接応募'])),
      source: source || 'csv',
      source_updated_at: new Date().toISOString()
    };
  }

  function fromCsvText(text, source) {
    var rows = parseCsv(text);
    var jobs = rows.map(function (r) { return rowToCanonical(r, source || 'csv'); })
      .filter(function (j) { return j.title || j.application_url; });
    return {
      adapter: 'CSV Adapter',
      model: 'Job Canonical Model',
      count: jobs.length,
      jobs: jobs,
      importedAt: new Date().toISOString()
    };
  }

  function toJobPostingDraft(job) {
    if (!job) return null;
    var draft = {
      '@context': 'https://schema.org',
      '@type': 'JobPosting',
      title: job.title || undefined,
      description: job.description || undefined,
      datePosted: job.date_posted || undefined,
      validThrough: job.valid_through || undefined,
      employmentType: job.employment_type || undefined,
      url: job.application_url || undefined,
      directApply: job.direct_apply || undefined,
      identifier: job.job_id ? { '@type': 'PropertyValue', name: 'job_id', value: job.job_id } : undefined
    };
    if (job.locations && job.locations[0]) {
      draft.jobLocation = {
        '@type': 'Place',
        address: { '@type': 'PostalAddress', addressLocality: job.locations[0] }
      };
    }
    if (/telecommute|remote|リモート|在宅/i.test(String(job.remote_policy || ''))) {
      draft.jobLocationType = 'TELECOMMUTE';
    }
    // Never invent salary into schema from free text without confirmation
    return draft;
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function save(jobs) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(jobs || [])); } catch (e) {}
  }

  function mergeImport(result) {
    var existing = load();
    var byId = {};
    existing.forEach(function (j) { byId[j.job_id] = j; });
    (result.jobs || []).forEach(function (j) { byId[j.job_id] = j; });
    var merged = Object.keys(byId).map(function (k) { return byId[k]; });
    save(merged);
    return merged;
  }

  root.AirReachJobCanonical = {
    STORE_KEY: STORE_KEY,
    parseCsv: parseCsv,
    fromCsvText: fromCsvText,
    toJobPostingDraft: toJobPostingDraft,
    load: load,
    save: save,
    mergeImport: mergeImport
  };
})(typeof window !== 'undefined' ? window : globalThis);
