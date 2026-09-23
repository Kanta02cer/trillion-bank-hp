/**
 * JobPosting validator + fix-draft generator (Recruit v0).
 * POST /api/job-posting-validate/
 * body: { jsonld?: object|string, html?: string, url?: string, pageTextHints?: object }
 *
 * Does NOT invent salary, location, or benefits.
 * Does NOT claim Google Job inclusion or ranking.
 */
const CHECKS = [
  { id: 'title', path: 'title', required: true, label: 'title（職種名）' },
  { id: 'description', path: 'description', required: true, label: 'description' },
  { id: 'datePosted', path: 'datePosted', required: true, label: 'datePosted' },
  { id: 'hiringOrganization', path: 'hiringOrganization', required: true, label: 'hiringOrganization' },
  { id: 'jobLocation', path: 'jobLocation', required: false, label: 'jobLocation' },
  { id: 'employmentType', path: 'employmentType', required: false, label: 'employmentType' },
  { id: 'validThrough', path: 'validThrough', required: false, label: 'validThrough' },
  { id: 'baseSalary', path: 'baseSalary', required: false, label: 'baseSalary' },
  { id: 'directApply', path: 'directApply', required: false, label: 'directApply' },
  { id: 'identifier', path: 'identifier', required: false, label: 'identifier' },
  { id: 'jobLocationType', path: 'jobLocationType', required: false, label: 'jobLocationType（リモート）' },
  { id: 'applicantLocationRequirements', path: 'applicantLocationRequirements', required: false, label: 'applicantLocationRequirements' },
  { id: 'url', path: 'url', required: false, label: 'url（求人詳細）' },
  { id: '@type', path: '@type', required: true, label: '@type = JobPosting' }
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const extracted = extractJobPosting(body);
  if (!extracted.job) {
    return json(res, 400, {
      error: extracted.error || 'JobPosting JSON-LD が見つかりません',
      hint: '求人詳細ページの JSON-LD を貼るか、html に script[type=application/ld+json] を含めてください。一覧ページへの複数 JobPosting は不可です。'
    });
  }

  const job = extracted.job;
  const hints = body.pageTextHints || {};
  const checks = CHECKS.map((c) => evaluateCheck(job, c, hints));
  const remoteNotes = remoteDiagnostics(job, hints);
  const titleNotes = titleDiagnostics(job);
  const salaryNotes = salaryDiagnostics(job, hints);

  const okRequired = checks.filter((c) => c.required && c.status === 'ok').length;
  const totalRequired = checks.filter((c) => c.required).length;
  const okAll = checks.filter((c) => c.status === 'ok').length;
  const totalAll = checks.length;

  const draft = buildFixDraft(job, checks, hints);

  return json(res, 200, {
    evidenceClass: 'Observed',
    scoreVersion: 'jobposting-readiness-v0',
    sourceUrl: body.url || null,
    okCount: okAll,
    totalCount: totalAll,
    requiredOk: okRequired,
    requiredTotal: totalRequired,
    readinessLabel: okRequired + ' / ' + totalRequired + ' 必須項目',
    checks: checks,
    notes: [].concat(remoteNotes, titleNotes, salaryNotes, extracted.notes || []),
    fixDraft: draft,
    disclaimer: 'JobPosting の整備は Google 求人検索の掲載対象になり得る状態を整えるものです。掲載・順位・AI引用は保証しません。給与・勤務地等は雇用主が実際に提示している値のみを使ってください。'
  });
}

function extractJobPosting(body) {
  const notes = [];
  let nodes = [];

  if (body.jsonld != null) {
    try {
      const parsed = typeof body.jsonld === 'string' ? JSON.parse(body.jsonld) : body.jsonld;
      nodes = nodes.concat(flattenLd(parsed));
    } catch {
      return { job: null, error: 'jsonld の JSON 解析に失敗しました' };
    }
  }

  if (body.html) {
    const fromHtml = extractLdFromHtml(String(body.html));
    nodes = nodes.concat(fromHtml.nodes);
    notes.push.apply(notes, fromHtml.notes);
  }

  const jobs = nodes.filter((n) => isJobPosting(n));
  if (jobs.length > 1) {
    notes.push('複数の JobPosting が見つかりました。Google は1求人=1詳細ページを要求します。最初の1件のみ検証します。');
  }
  if (!jobs.length) return { job: null, error: 'JobPosting タイプの JSON-LD がありません', notes };
  return { job: jobs[0], notes };
}

function extractLdFromHtml(html) {
  const notes = [];
  const nodes = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      nodes.push.apply(nodes, flattenLd(parsed));
    } catch {
      notes.push('JSON-LD ブロックの解析に失敗した箇所があります');
    }
  }
  return { nodes, notes };
}

function flattenLd(node) {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(flattenLd);
  if (node['@graph']) return flattenLd(node['@graph']).concat([node]);
  return [node];
}

function isJobPosting(n) {
  if (!n || typeof n !== 'object') return false;
  const t = n['@type'];
  if (Array.isArray(t)) return t.map(String).some((x) => /jobposting/i.test(x));
  return /jobposting/i.test(String(t || ''));
}

function getPath(obj, path) {
  if (!obj) return undefined;
  if (path === '@type') return obj['@type'];
  return obj[path];
}

function hasValue(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number' || typeof v === 'boolean') return true;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return false;
}

function evaluateCheck(job, def, hints) {
  const raw = getPath(job, def.path);
  let status = hasValue(raw) ? 'ok' : (def.required ? 'missing' : 'optional_missing');
  let detail = '';

  if (def.id === '@type') {
    status = isJobPosting(job) ? 'ok' : 'missing';
    detail = status === 'ok' ? 'JobPosting' : '@type が JobPosting ではありません';
  }
  if (def.id === 'title' && hasValue(raw)) {
    const t = String(raw);
    if (/円|万円|¥|\$|東京|大阪|横浜|名古屋|福岡|正社員|契約|パート/.test(t)) {
      status = 'warn';
      detail = 'タイトルに勤務地・給与・雇用形態が含まれている可能性があります。純粋な職種名が推奨されます。';
    }
  }
  if (def.id === 'description' && hasValue(raw)) {
    const d = String(raw).replace(/<[^>]+>/g, ' ');
    if (d.trim().length < 80) {
      status = 'warn';
      detail = 'description が短すぎる可能性があります（業務・資格・時間・経験など）。';
    }
  }
  if (def.id === 'baseSalary' && hasValue(raw) && hints.salaryIsEstimate) {
    status = 'fail';
    detail = '推定給与は使えません。雇用主が実際に提示している給与のみ設定してください。';
  }
  if (def.id === 'jobLocation' && !hasValue(raw)) {
    const remote = String(job.jobLocationType || '').toUpperCase() === 'TELECOMMUTE';
    if (!remote) {
      status = def.required ? 'missing' : 'optional_missing';
      detail = '勤務地または TELECOMMUTE の設定が必要です';
    } else {
      status = 'ok';
      detail = 'リモート（TELECOMMUTE）のため jobLocation 省略可の可能性があります';
    }
  }

  return {
    id: def.id,
    label: def.label,
    required: !!def.required,
    status: status,
    present: hasValue(raw),
    detail: detail || (status === 'ok' ? '設定あり' : status === 'optional_missing' ? '未設定（任意）' : '未設定')
  };
}

function remoteDiagnostics(job, hints) {
  const notes = [];
  const type = String(job.jobLocationType || '').toUpperCase();
  const textSaysRemote = !!(hints.remoteMentioned || /リモート|在宅|telecommute|remote/i.test(String(hints.pageText || '')));
  if (textSaysRemote && type !== 'TELECOMMUTE') {
    notes.push({
      level: 'warn',
      message: 'フルリモートと書いてありますが、Google向けの remote 情報（jobLocationType: TELECOMMUTE）が設定されていない可能性があります。'
    });
  }
  if (type === 'TELECOMMUTE' && !hasValue(job.applicantLocationRequirements)) {
    notes.push({
      level: 'warn',
      message: 'TELECOMMUTE の場合は applicantLocationRequirements（応募可能地域）の設定を確認してください。'
    });
  }
  return notes;
}

function titleDiagnostics(job) {
  const notes = [];
  const t = String(job.title || '');
  if (/募集|急募|高収入/.test(t)) {
    notes.push({ level: 'info', message: 'タイトルは純粋な職種名が推奨されます（煽り文句や条件の詰め込みは避けてください）。' });
  }
  return notes;
}

function salaryDiagnostics(job, hints) {
  const notes = [];
  if (hints.salaryIsEstimate) {
    notes.push({ level: 'fail', message: '推定給与を Schema に入れないでください。' });
  }
  if (!hasValue(job.baseSalary) && hints.salaryShownOnPage) {
    notes.push({ level: 'info', message: 'ページ上に給与がある場合は、提示額と一致する baseSalary を検討してください（推定は不可）。' });
  }
  return notes;
}

function buildFixDraft(job, checks, hints) {
  const draft = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting'
  };
  // Copy only existing factual fields — never invent salary/location
  const copyKeys = [
    'title', 'description', 'datePosted', 'validThrough', 'employmentType',
    'hiringOrganization', 'jobLocation', 'baseSalary', 'identifier',
    'directApply', 'url', 'jobLocationType', 'applicantLocationRequirements',
    'industry', 'occupationalCategory', 'qualifications', 'responsibilities',
    'skills', 'workHours', 'jobImmediateStart', 'experienceRequirements'
  ];
  copyKeys.forEach((k) => {
    if (hasValue(job[k])) draft[k] = job[k];
  });

  const suggestions = [];
  checks.forEach((c) => {
    if (c.status === 'missing' || c.status === 'warn' || c.status === 'fail') {
      suggestions.push({ id: c.id, action: suggestAction(c.id), status: c.status });
    }
  });
  if (hints.remoteMentioned && String(draft.jobLocationType || '').toUpperCase() !== 'TELECOMMUTE') {
    suggestions.push({
      id: 'jobLocationType',
      action: '本文がフルリモートなら jobLocationType に TELECOMMUTE を設定し、応募可能地域を applicantLocationRequirements で明示（値は事実に合わせる）',
      status: 'warn'
    });
  }

  return {
    jsonld: draft,
    suggestions: suggestions,
    humanApprovalRequired: true,
    note: 'この下書きは既存 JSON-LD のコピー＋不足指摘です。欠けた給与・勤務地は自動補完しません。公開前に人が承認してください。'
  };
}

function suggestAction(id) {
  const map = {
    title: '純粋な職種名にする（勤務地・給与・企業名を詰め込まない）',
    description: '業務・資格・勤務時間・経験要件などを HTML 本文と一致させて十分に書く',
    datePosted: '元の掲載日を ISO 8601 で設定する',
    hiringOrganization: '正式な企業名（Organization）を設定する',
    jobLocation: '正確な勤務地 Place/PostalAddress を設定する（または TELECOMMUTE）',
    employmentType: 'FULL_TIME / PART_TIME / CONTRACTOR 等を設定する',
    validThrough: '募集終了日がある場合は設定し、終了後は削除または Indexing API で通知する',
    baseSalary: '雇用主が実際に提示している給与のみ（推定不可）',
    directApply: '自社で直接応募できる場合のみ true',
    identifier: 'ATS 側の求人 ID と対応付ける',
    jobLocationType: '完全リモートなら TELECOMMUTE',
    applicantLocationRequirements: 'リモート応募可能地域を Country 等で明示',
    url: 'この求人の詳細ページ URL（1求人=1URL）',
    '@type': '@type を JobPosting にする'
  };
  return map[id] || '公式ドキュメントに沿って不足項目を補う';
}

function allowedOrigin(req) {
  const origin = req.headers.origin || '';
  try {
    const host = new URL(origin).hostname;
    if (
      host === 'trillion-bank.jp' ||
      host === 'www.trillion-bank.jp' ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.endsWith('.vercel.app') ||
      host.endsWith('.github.io')
    ) return origin;
  } catch { /* ignore */ }
  return 'https://trillion-bank.jp';
}

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}
