import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STUDIO_PATH = path.join(ROOT, 'assets/js/airreach-studio.js');
const ORCHESTRATOR_PATH = path.join(ROOT, 'assets/js/airreach-orchestrator.js');
const STUDIO_HTML_PATH = path.join(ROOT, 'airreach/studio/index.html');
const STUDIO_CSS_PATH = path.join(ROOT, 'assets/css/airreach-studio.css');
const PLATFORM_PATH = path.join(ROOT, 'assets/js/airreach-platform.js');
const HANDOFF_PATH = path.join(ROOT, 'assets/js/airreach-handoff.js');
const STORAGE_KEY = 'airreach_studio_v2';
const FIXED_NOW = '2026-09-19T12:00:00.000Z';
const ANALYSIS_INPUT = Object.freeze({
  url: 'https://example.test/service/',
  goal: '問い合わせを増やす',
  keywordCount: 20,
  region: '東京'
});

const [studioSource, orchestratorSource, studioHtml, studioCss, platformSource, handoffSource] = await Promise.all([
  readFile(STUDIO_PATH, 'utf8'),
  readFile(ORCHESTRATOR_PATH, 'utf8'),
  readFile(STUDIO_HTML_PATH, 'utf8'),
  readFile(STUDIO_CSS_PATH, 'utf8'),
  readFile(PLATFORM_PATH, 'utf8'),
  readFile(HANDOFF_PATH, 'utf8')
]);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createStorage(initialState) {
  const values = new Map();
  if (initialState) values.set(STORAGE_KEY, JSON.stringify(initialState));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function studioState({ measurements = [], gscConnected = false } = {}) {
  return {
    schema_version: 2,
    profile: {
      url: ANALYSIS_INPUT.url,
      brand: 'Example',
      service: 'Studio Test',
      audience: '',
      summary: ''
    },
    competitors: [],
    keywords: [],
    measurements,
    hack2: [],
    google: {
      gscSite: gscConnected ? 'sc-domain:example.test' : '',
      gaProperty: ''
    },
    generated: {},
    faqSuggestions: [],
    sources: {
      gsc: {
        status: gscConnected ? 'imported' : 'not_connected',
        source: 'GSC CSV',
        evidence_class: 'Official',
        imported_at: gscConnected ? FIXED_NOW : null,
        period_start: gscConnected ? '2026-08-01' : null,
        period_end: gscConnected ? '2026-08-31' : null,
        row_count: measurements.length
      }
    },
    analysis_job: null,
    migration: null,
    updated_at: FIXED_NOW
  };
}

function loadRuntime(initialState = studioState()) {
  const sandbox = {
    URL,
    Blob,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    DataView,
    setTimeout,
    clearTimeout,
    console,
    localStorage: createStorage(initialState)
  };

  vm.createContext(sandbox);
  vm.runInContext(studioSource, sandbox, { filename: STUDIO_PATH });
  vm.runInContext(orchestratorSource, sandbox, { filename: ORCHESTRATOR_PATH });

  assert.ok(sandbox.AirReachStudio, 'AirReachStudio public API was not registered');
  assert.ok(sandbox.AirReachOrchestrator, 'AirReachOrchestrator public API was not registered');
  return {
    studio: sandbox.AirReachStudio,
    orchestrator: sandbox.AirReachOrchestrator
  };
}

function createOrchestrator(runtime, dependencyOverrides = {}) {
  return runtime.orchestrator.create({
    stepDelay: 0,
    now: () => FIXED_NOW,
    dependencies: {
      AirReachStudio: runtime.studio,
      diagnose: async () => ({
        overall: 64,
        gaps: ['公式情報の確認が必要']
      }),
      ...dependencyOverrides
    }
  });
}

async function runAnalysis({ count = 20, initialState, dependencyOverrides } = {}) {
  const runtime = loadRuntime(initialState || studioState());
  const orchestrator = createOrchestrator(runtime, dependencyOverrides);
  const job = await orchestrator.run({ ...ANALYSIS_INPUT, keywordCount: count });
  return { runtime, orchestrator, job: plain(job) };
}

function manifestPaths(bundle) {
  return bundle.manifest.files.map((entry) => entry.path).sort();
}

const REQUIRED_BUNDLE_PATHS = [
  'README.md',
  'MANIFEST.json',
  'AGENT_PROMPT.md',
  'strategy/keyword-candidates.csv',
  'strategy/prompt-candidates.csv',
  'strategy/actions.csv',
  'schema/VALIDATION_REQUIRED.md',
  'content-stubs/CONTENT_DRAFT.md',
  'public/llms.txt',
  'public/llms-full.txt',
  'validation/VALIDATION.md'
];

test('Overview structure, noindex, Expert containment, and script order stay fixed', () => {
  const ids = [...studioHtml.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const scripts = [...studioHtml.matchAll(/<script\s+src="([^"]+)"\s+defer><\/script>/g)].map((match) => match[1]);
  const expertStart = studioHtml.indexOf('<details id="expert-panels"');
  const expertEnd = studioHtml.indexOf('</details>', expertStart);
  const expertHtml = studioHtml.slice(expertStart, expertEnd);

  assert.match(studioHtml, /^robots:\s*"noindex, follow"$/m);
  assert.equal(new Set(ids).size, ids.length, 'HTML IDs must remain unique');
  assert.ok(expertStart > studioHtml.indexOf('id="analysis-form"'));
  for (const panel of ['gaps', 'competitors', 'generator', 'keywords', 'timeseries', 'google', 'hack2']) {
    assert.match(expertHtml, new RegExp(`data-panel-view="${panel}"`));
  }
  assert.deepEqual(scripts.slice(-4), [
    '/assets/js/airreach-diagnose.js',
    '/assets/js/airreach-sales.js',
    '/assets/js/airreach-studio.js',
    '/assets/js/airreach-orchestrator.js'
  ]);
  assert.match(studioHtml, /GitHub PRを作る<\/button>\s*<span[^>]*>準備中<\/span>/);
  assert.match(studioHtml, /サイト(?:内)?全ページの巡回、競合SERP、HackⅡライブ測定は行いません/);
  assert.match(studioCss, /@media \(max-width: 680px\)/);
  assert.match(studioCss, /content: attr\(data-label\)/);
});

test('public APIs generate exactly 20, 50, and 100 unique keyword candidates', async () => {
  for (const count of [20, 50, 100]) {
    const { runtime, job } = await runAnalysis({ count });

    assert.equal(job.status, 'completed');
    assert.equal(job.progress, 100);
    assert.equal(job.keyword_candidates.length, count);
    assert.equal(job.summary.keyword_count, count);
    assert.equal(job.prompt_candidates.length, count * 3);
    assert.ok(job.keyword_candidates.every((candidate) => candidate.ai_prompt_count === 3));
    assert.equal(
      new Set(job.keyword_candidates.map((candidate) => runtime.studio.normalizeKeyword(candidate.keyword))).size,
      count,
      'keyword candidates must be unique after normalization'
    );
    assert.ok(job.keyword_candidates.every((candidate) => candidate.volume_source === 'Estimated'));
    assert.ok(job.keyword_candidates.every((candidate) => Number.isFinite(candidate.estimated_monthly_demand)));
    assert.ok(job.artifact_bundle, 'completed job must include an artifact bundle');
  }
});

test('estimated demand and GSC impressions coexist without replacement or addition', async () => {
  const withoutGsc = await runAnalysis();
  const exactKeyword = withoutGsc.job.keyword_candidates[0].keyword;
  const nearMatchKeyword = withoutGsc.job.keyword_candidates[1].keyword;
  const measurements = [
    {
      source_type: 'gsc',
      source: 'GSC CSV',
      evidence_class: 'Official',
      keyword: exactKeyword.toUpperCase().replaceAll(' ', '　'),
      impressions: 120,
      clicks: 8,
      position: 4.5,
      date: '2026-08-01'
    },
    {
      source_type: 'gsc',
      source: 'GSC CSV',
      evidence_class: 'Official',
      keyword: exactKeyword,
      impressions: 30,
      clicks: 2,
      position: 5.5,
      date: '2026-08-31'
    },
    {
      source_type: 'gsc',
      source: 'GSC CSV',
      evidence_class: 'Official',
      keyword: `${nearMatchKeyword} 追加`,
      impressions: 999999,
      clicks: 999,
      position: 1,
      date: '2026-08-15'
    }
  ];
  const withGsc = await runAnalysis({
    initialState: studioState({ measurements, gscConnected: true })
  });
  const exact = withGsc.job.keyword_candidates.find((candidate) => (
    withGsc.runtime.studio.normalizeKeyword(candidate.keyword) === withGsc.runtime.studio.normalizeKeyword(exactKeyword)
  ));
  const similarButNotExact = withGsc.job.keyword_candidates.find((candidate) => (
    withGsc.runtime.studio.normalizeKeyword(candidate.keyword) === withGsc.runtime.studio.normalizeKeyword(nearMatchKeyword)
  ));

  assert.ok(exact, 'expected exact keyword candidate was not generated');
  assert.equal(exact.volume_source, 'Estimated');
  assert.ok(exact.estimated_monthly_demand > 0);
  assert.equal(exact.gsc_impressions, 150, 'duplicate exact GSC rows should be summed');
  assert.equal(exact.gsc_source, 'Official');
  assert.equal(exact.gsc_status, 'matched');
  assert.equal(exact.gsc_period_start, '2026-08-01');
  assert.equal(exact.gsc_period_end, '2026-08-31');

  assert.ok(similarButNotExact, 'expected comparison keyword candidate was not generated');
  assert.equal(similarButNotExact.gsc_impressions, null, 'prefix/near match must not receive GSC data');
  assert.equal(similarButNotExact.gsc_source, null);
  assert.equal(similarButNotExact.gsc_status, 'not_matched');

  const estimatedTotal = withGsc.job.keyword_candidates.reduce(
    (sum, candidate) => sum + candidate.estimated_monthly_demand,
    0
  );
  assert.equal(withGsc.job.summary.estimated_monthly_demand, estimatedTotal);
  assert.equal(
    withGsc.job.summary.estimated_monthly_demand,
    withoutGsc.job.summary.estimated_monthly_demand,
    'GSC impressions must not change the estimated market-demand total'
  );
  assert.equal(withGsc.job.gsc_status.connected, true);
  assert.equal(withoutGsc.job.gsc_status.connected, false);
  assert.equal(withoutGsc.job.gsc_status.label, 'GSC未接続');
  assert.equal(withGsc.job.artifact_bundle.manifest.data_sources.gsc.property, 'sc-domain:example.test');
  assert.equal(withGsc.job.artifact_bundle.manifest.data_sources.gsc.evidence_class, 'Official');
  const bundledKeywordRows = plain(withGsc.runtime.studio.parseCsv(
    withGsc.job.artifact_bundle.files['strategy/keyword-candidates.csv']
  ));
  assert.ok(Object.hasOwn(bundledKeywordRows[0], 'gsc_period_start'));
  assert.ok(Object.hasOwn(bundledKeywordRows[0], 'gsc_period_end'));
});

test('actions are unique and duplicate actions are counted once in the summary', async () => {
  const runtime = loadRuntime();
  const actions = plain(runtime.studio.buildActions(
    ANALYSIS_INPUT,
    { overall: 64, gaps: ['確認事項'] },
    [],
    []
  ));
  assert.ok(actions.length > 0);
  assert.equal(new Set(actions.map((action) => action.target_key)).size, actions.length);

  const duplicate = {
    id: 'action_1',
    type: 'existing',
    target_key: 'existing|https://example.test/service/',
    title: '同じ修正',
    target_url: 'https://example.test/service/',
    reason: '確認',
    evidence_class: 'Inferred',
    status: 'draft'
  };
  const orchestrator = createOrchestrator(runtime, {
    buildActions: () => [duplicate, { ...duplicate, id: 'action_2' }]
  });
  const job = plain(await orchestrator.run(ANALYSIS_INPUT));

  assert.equal(job.actions.length, 2, 'fixture must contain duplicate rows');
  assert.equal(job.summary.action_count, 1, 'duplicate action must not be counted twice');
});

test('blocked actions are excluded from the implementable count', async () => {
  const runtime = loadRuntime();
  const blocked = {
    id: 'action_blocked',
    type: 'schema',
    target_key: 'schema|https://example.test/service/',
    target_url: ANALYSIS_INPUT.url,
    title: 'Schema確認',
    status: 'blocked',
    blocked_reason: '公開情報を確認できませんでした。'
  };
  const candidate = {
    id: 'action_candidate',
    type: 'new',
    target_key: 'new|https://example.test/candidate/',
    target_url: 'https://example.test/candidate/',
    title: '検討候補',
    status: 'candidate'
  };
  const orchestrator = createOrchestrator(runtime, {
    diagnose: async () => null,
    buildActions: () => [blocked, candidate]
  });
  const job = plain(await orchestrator.run(ANALYSIS_INPUT));

  assert.equal(job.summary.action_count, 0);
  assert.equal(job.summary.actionCount, 0);
});

test('invalid reruns replace a previous success with a failed job', async () => {
  const runtime = loadRuntime();
  const orchestrator = createOrchestrator(runtime);
  const completed = plain(await orchestrator.run(ANALYSIS_INPUT));
  assert.equal(completed.status, 'completed');
  assert.ok(completed.artifact_bundle);

  await assert.rejects(orchestrator.run({ ...ANALYSIS_INPUT, url: 'not a public URL' }));
  const failed = plain(orchestrator.getJob());
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error.code, 'INVALID_INPUT');
  assert.equal(failed.artifact_bundle, null);
});

test('actions without a diagnosis gap remain blocked candidates', () => {
  const { studio } = loadRuntime();
  const actions = plain(studio.buildActions(
    ANALYSIS_INPUT,
    {
      overall: 100,
      gaps: [],
      actions: { now: [], weeks: ['重要カテゴリ質問で競合が出る場合の公式比較軸・対象外をページ化する'] },
      page: { faqCount: 5 }
    },
    [],
    []
  ));

  assert.equal(actions.length, 5, 'all implementation categories should remain inspectable');
  assert.ok(actions.every((action) => action.status === 'blocked'));
  assert.ok(actions.every((action) => action.blocked_reason));
});

test('orchestrator removes URL credentials, query, and fragment before every downstream step', async () => {
  const runtime = loadRuntime();
  const seen = { diagnose: null, diagnoseOptions: null, gsc: null };
  const orchestrator = createOrchestrator(runtime, {
    diagnose: async (url, options) => {
      seen.diagnose = url;
      seen.diagnoseOptions = options;
      return { overall: 64, gaps: [] };
    },
    getGscStatus: (url) => {
      seen.gsc = url;
      return { connected: false, status: 'not_connected', label: 'GSC未接続' };
    }
  });
  const job = plain(await orchestrator.run({
    ...ANALYSIS_INPUT,
    url: 'https://user:password@example.test/service/?access_token=secret-value#private'
  }));

  assert.equal(job.input.url, ANALYSIS_INPUT.url);
  assert.equal(seen.diagnose, ANALYSIS_INPUT.url);
  assert.equal(seen.diagnoseOptions.allowProxy, false);
  assert.equal(seen.diagnoseOptions.allowThirdPartyProxy, false);
  assert.equal(seen.gsc, ANALYSIS_INPUT.url);
  assert.doesNotMatch(JSON.stringify(job), /password|secret-value|access_token|#private/);
});

test('Overview keywords do not reuse a saved service name without explicit Expert context', () => {
  const { studio } = loadRuntime(studioState());
  const overview = plain(studio.buildKeywordCandidates(ANALYSIS_INPUT, null));
  const expert = plain(studio.buildKeywordCandidates({ ...ANALYSIS_INPUT, useProfileContext: true }, null));

  assert.ok(overview.every((candidate) => !candidate.keyword.includes('Studio Test')));
  assert.ok(expert.some((candidate) => candidate.keyword.includes('Studio Test')));
});

test('GSC URL-prefix property cannot attach data outside its path', () => {
  const measurements = [{
    source_type: 'gsc',
    source: 'GSC CSV',
    evidence_class: 'Official',
    keyword: 'example keyword',
    impressions: 100,
    clicks: 4,
    position: 3,
    date: '2026-08-01'
  }];
  const initial = studioState({ measurements, gscConnected: true });
  initial.sources.gsc.property = 'https://example.test/blog/';
  const { studio } = loadRuntime(initial);

  assert.equal(plain(studio.getGscStatus('https://example.test/blog/article/')).connected, true);
  assert.equal(plain(studio.getGscStatus('https://example.test/shop/')).connected, false);
  assert.equal(plain(studio.getGscStatus('https://example.test/shop/')).status, 'property_mismatch');
  assert.ok(
    plain(studio.buildKeywordCandidates({ ...ANALYSIS_INPUT, url: 'https://example.test/shop/' }, null))
      .every((candidate) => candidate.gsc_status === 'property_mismatch' && candidate.gsc_impressions === null)
  );
});

test('Official baseline bridges accept only matching targets and Official v2 rows', () => {
  const baselineKey = 'airreach_official_baseline_v1';
  const handoffKey = 'airreach_diagnose_handoff_v1';
  const matchingStorage = createStorage();
  matchingStorage.setItem(handoffKey, JSON.stringify({
    url: 'https://example.test/service/',
    overall: 64,
    lifts: { trafficUpliftPct: 12, cvrUpliftPct: 8 }
  }));
  matchingStorage.setItem(baselineKey, JSON.stringify({
    evidenceClass: 'Official',
    property: 'sc-domain:example.test',
    monthlyClicks: 90,
    ga4: { evidenceClass: 'Official', monthlySessions: 200, monthlyKeyEvents: 4 }
  }));
  const handoffSandbox = { URL, URLSearchParams, localStorage: matchingStorage, console };
  handoffSandbox.window = handoffSandbox;
  vm.createContext(handoffSandbox);
  vm.runInContext(handoffSource, handoffSandbox, { filename: HANDOFF_PATH });
  const matchingSeed = plain(handoffSandbox.AirReachHandoff.buildSimulatorSeed());
  assert.equal(matchingSeed.autoReady, true);
  assert.equal(matchingSeed.monthlyVisitors, 200);

  matchingStorage.setItem(handoffKey, JSON.stringify({
    url: 'https://other.test/service/',
    overall: 64,
    lifts: { trafficUpliftPct: 12, cvrUpliftPct: 8 }
  }));
  const mismatchedSeed = plain(handoffSandbox.AirReachHandoff.buildSimulatorSeed());
  assert.equal(mismatchedSeed.autoReady, false);
  assert.equal(mismatchedSeed.baseline, null);
  assert.equal(mismatchedSeed.monthlyVisitors, 5000);

  matchingStorage.setItem(handoffKey, JSON.stringify({ url: 'https://example.test/service/' }));
  matchingStorage.setItem(baselineKey, JSON.stringify({
    evidenceClass: 'Sample',
    property: 'sc-domain:example.test',
    monthlyClicks: 999
  }));
  const sampleSeed = plain(handoffSandbox.AirReachHandoff.buildSimulatorSeed());
  assert.equal(sampleSeed.autoReady, false);
  assert.equal(sampleSeed.baseline, null);
  matchingStorage.setItem(baselineKey, JSON.stringify({
    evidenceClass: 'Official',
    monthlyClicks: 777
  }));
  const unboundSeed = plain(handoffSandbox.AirReachHandoff.buildSimulatorSeed());
  assert.equal(unboundSeed.autoReady, false);
  assert.equal(unboundSeed.baseline, null);

  const studioStorage = createStorage();
  studioStorage.setItem(STORAGE_KEY, JSON.stringify({
    schema_version: 2,
    profile: { url: 'https://example.test/service/' },
    analysis_job: { input: { url: 'https://example.test/service/' } },
    sources: {
      gsc: {
        status: 'imported',
        property: 'sc-domain:example.test',
        period_start: '2026-08-01',
        period_end: '2026-08-31'
      },
      ga4: { status: 'imported', period_start: '2026-09-01', period_end: '2026-09-10' }
    },
    measurements: [
      { source_type: 'gsc', evidence_class: 'Official', keyword: 'official', impressions: 31, clicks: 3 },
      { source_type: 'legacy', evidence_class: 'Unverified', keyword: 'legacy', impressions: 9999, clicks: 999 },
      { source_type: 'ga4', evidence_class: 'Official', url: 'https://example.test/service/', sessions: 100, key_events: 5 },
      { source_type: 'ga4', evidence_class: 'Unverified', sessions: 900, key_events: 90 }
    ]
  }));
  const documentStub = {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; }
  };
  const platformSandbox = {
    URL,
    URLSearchParams,
    localStorage: studioStorage,
    document: documentStub,
    location: { hash: '', search: '' },
    console,
    FileReader: function FileReader() {}
  };
  platformSandbox.AirReachHandoff = {
    loadDiagnoseHandoff() { return { url: 'https://example.test/service/' }; }
  };
  platformSandbox.window = platformSandbox;
  const instrumentedPlatform = platformSource.replace(
    /\n\}\)\(\);\s*$/,
    '\nwindow.__baselineFromStudio = baselineFromStudio;\nwindow.__loadBaseline = loadBaseline;\nwindow.__baselineMatchesCurrentHandoff = baselineMatchesCurrentHandoff;\nwindow.__gscRowsMatchTarget = gscRowsMatchTarget;\nwindow.__ga4RowsMatchTarget = ga4RowsMatchTarget;\nwindow.__inferGscProperty = inferGscProperty;\nwindow.__inferGa4Property = inferGa4Property;\nwindow.__ga4RowsMatchProperty = ga4RowsMatchProperty;\nwindow.__applyBaselineToForm = applyBaselineToForm;\n})();\n'
  );
  vm.createContext(platformSandbox);
  vm.runInContext(instrumentedPlatform, platformSandbox, { filename: PLATFORM_PATH });
  const studioBaseline = plain(platformSandbox.__baselineFromStudio());

  assert.equal(studioBaseline.property, 'sc-domain:example.test');
  assert.equal(studioBaseline.monthlyImpressions, 30, '31-day GSC period should be monthly-normalized');
  assert.equal(studioBaseline.keywords.length, 1);
  assert.equal(studioBaseline.keywords[0].query, 'official');
  assert.equal(studioBaseline.ga4.monthlySessions, 300, 'GA4 must use its own 10-day period');
  assert.equal(studioBaseline.ga4.monthlyKeyEvents, 15);
  assert.equal(platformSandbox.__gscRowsMatchTarget([
    { Query: 'keyword', Page: 'https://example.test/page/' }
  ], ANALYSIS_INPUT.url), true);
  assert.equal(platformSandbox.__gscRowsMatchTarget([
    { Query: 'keyword', Page: 'https://other.test/page/' }
  ], ANALYSIS_INPUT.url), false);
  assert.equal(platformSandbox.__gscRowsMatchTarget([{ Query: 'keyword' }], ANALYSIS_INPUT.url), false);
  assert.equal(platformSandbox.__ga4RowsMatchTarget([
    { 'Landing page': '/service/', Sessions: '10' }
  ], ANALYSIS_INPUT.url), true);
  assert.equal(platformSandbox.__ga4RowsMatchTarget([
    { 'Landing page': 'https://other.test/', Sessions: '10' }
  ], ANALYSIS_INPUT.url), false);
  assert.equal(platformSandbox.__inferGscProperty([
    { Query: 'a', Page: 'https://example.test/a/' },
    { Query: 'b', Page: 'https://example.test/b/' }
  ]), 'https://example.test/');
  assert.equal(platformSandbox.__inferGscProperty([{ Query: 'a' }]), null);
  assert.equal(platformSandbox.__inferGa4Property([
    { 'Landing page': 'https://example.test/a/', Sessions: '10' }
  ]), 'https://example.test/');
  assert.equal(platformSandbox.__inferGa4Property([
    { 'Landing page': '/relative/', Sessions: '10' }
  ]), null);
  assert.equal(platformSandbox.__ga4RowsMatchProperty([
    { 'Landing page': '/service/', Sessions: '10' }
  ], 'sc-domain:example.test'), true);

  const formElements = {
    'arp-visitors': { value: '1', dataset: { userTouched: '1' } },
    'arp-inquiries': { value: '2', dataset: { userTouched: '1' } }
  };
  documentStub.getElementById = (id) => formElements[id] || null;
  platformSandbox.__applyBaselineToForm({
    evidenceClass: 'Official',
    monthlyClicks: 90,
    ga4: { evidenceClass: 'Official', monthlySessions: 200, monthlyKeyEvents: 4 }
  }, true);
  assert.equal(formElements['arp-visitors'].value, 200);
  assert.equal(formElements['arp-inquiries'].value, 4);
  assert.equal(formElements['arp-inquiries'].dataset.userTouched, undefined);
  assert.equal(platformSandbox.__baselineMatchesCurrentHandoff(studioBaseline), true);

  platformSandbox.AirReachHandoff.loadDiagnoseHandoff = () => ({ url: 'https://other.test/service/' });
  assert.equal(
    platformSandbox.__baselineMatchesCurrentHandoff(studioBaseline),
    false,
    'Studio import controls must reject an Official baseline for another active handoff target'
  );

  const mixedStudioState = JSON.parse(studioStorage.getItem(STORAGE_KEY));
  mixedStudioState.measurements.push({
    source_type: 'ga4',
    evidence_class: 'Official',
    url: 'https://other.test/',
    sessions: 900,
    key_events: 90
  });
  studioStorage.setItem(STORAGE_KEY, JSON.stringify(mixedStudioState));
  assert.equal(
    plain(platformSandbox.__baselineFromStudio()).ga4,
    undefined,
    'mixed or unbound GA4 rows must not be promoted into a target-bound Official baseline'
  );

  platformSandbox.AirReachHandoff.loadDiagnoseHandoff = () => ({ url: 'https://example.test/service/' });
  studioStorage.setItem(baselineKey, JSON.stringify({
    property: 'sc-domain:other.test',
    evidenceClass: 'Official',
    monthlyClicks: 999,
    keywords: [{ query: 'wrong customer', impressions: 999 }]
  }));
  assert.equal(platformSandbox.__loadBaseline(), null, 'Platform rendering must reject a baseline for another target');
  studioStorage.setItem(baselineKey, JSON.stringify({
    property: 'sc-domain:example.test',
    evidenceClass: 'Official',
    monthlyClicks: 90,
    ga4: { evidenceClass: 'Sample', monthlySessions: 999, monthlyKeyEvents: 99 }
  }));
  assert.equal(plain(platformSandbox.__loadBaseline()).ga4, undefined, 'Platform must not render nested Sample GA4 as Official');
  studioStorage.setItem(baselineKey, JSON.stringify({ evidenceClass: 'Official', monthlyClicks: 777 }));
  assert.equal(platformSandbox.__loadBaseline(), null, 'legacy unbound Official baselines must be rejected');
});

test('regional prompts do not repeat a region already present in the keyword', () => {
  const { studio } = loadRuntime();
  const keywords = plain(studio.buildKeywordCandidates(ANALYSIS_INPUT, null));
  const prompts = plain(studio.buildPromptCandidates(keywords, ANALYSIS_INPUT));

  assert.ok(keywords[0].keyword.includes(ANALYSIS_INPUT.region));
  assert.ok(prompts.every((candidate) => !candidate.prompt.includes('東京で東京')));
});

test('a superseded run rejects as stale instead of resolving with the newer job', async () => {
  const runtime = loadRuntime();
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const orchestrator = runtime.orchestrator.create({
    now: () => FIXED_NOW,
    stepDelay(stepId, job) {
      if (stepId === 'site' && job.input.url.includes('first.test')) return firstGate;
      return 0;
    },
    dependencies: {
      AirReachStudio: runtime.studio,
      diagnose: async () => ({ overall: 64, gaps: ['FAQが不足'] })
    }
  });
  const first = orchestrator.run({ ...ANALYSIS_INPUT, url: 'https://first.test/' });
  await Promise.resolve();
  const second = orchestrator.run({ ...ANALYSIS_INPUT, url: 'https://second.test/' });
  const secondJob = plain(await second);
  releaseFirst();

  await assert.rejects(first, (error) => error && error.stale === true);
  assert.equal(secondJob.input.url, 'https://second.test/');
  assert.equal(secondJob.status, 'completed');
});

test('artifact bundle contains required files and MANIFEST matches every entry', async () => {
  const { job } = await runAnalysis();
  const bundle = job.artifact_bundle;
  const actualPaths = Object.keys(bundle.files).sort();
  const embeddedManifest = JSON.parse(bundle.files['MANIFEST.json']);

  for (const requiredPath of REQUIRED_BUNDLE_PATHS) {
    assert.ok(actualPaths.includes(requiredPath), `missing required bundle file: ${requiredPath}`);
    assert.ok(bundle.files[requiredPath].length > 0, `required bundle file is empty: ${requiredPath}`);
  }

  assert.deepEqual(manifestPaths(bundle), actualPaths);
  assert.deepEqual(embeddedManifest, bundle.manifest);
  assert.deepEqual(
    embeddedManifest.files.map((entry) => entry.path).sort(),
    actualPaths,
    'embedded MANIFEST file list must match ZIP inputs exactly'
  );
  assert.equal(embeddedManifest.input.url, ANALYSIS_INPUT.url);
  assert.equal(embeddedManifest.input.goal, ANALYSIS_INPUT.goal);
  assert.equal(embeddedManifest.input.keywordCount, ANALYSIS_INPUT.keywordCount);
  assert.equal(embeddedManifest.input.region, ANALYSIS_INPUT.region);
  assert.equal(embeddedManifest.status, 'draft');
  assert.equal(embeddedManifest.boundaries.github_pr, 'planned');
  assert.equal(embeddedManifest.boundaries.production_deploy, 'planned');
  assert.equal(embeddedManifest.boundaries.keyword_planner, 'not_connected');
  assert.equal(embeddedManifest.boundaries.hack2_live_measurement, 'not_connected');
});

test('AGENT_PROMPT fixes the non-fabrication, visible-Schema, approval, and source-separation rules', async () => {
  const { job } = await runAnalysis();
  const prompt = job.artifact_bundle.files['AGENT_PROMPT.md'];

  assert.match(prompt, /事実を創作しない/);
  assert.match(prompt, /料金、症例、顧客名、実績、数値は提供された確認済み事実のみ/);
  assert.match(prompt, /Schemaは同じページの可視本文と一致/);
  assert.match(prompt, /人間が承認するまで公開しない/);
  assert.match(prompt, /Pull Requestを作成しない/);
  assert.match(prompt, /本番へDeployしない/);
  assert.match(prompt, /成果を保証しない/);
  assert.match(prompt, /推定市場需要とGSC実測値を混ぜない/);
});

test('CSV serialization neutralizes spreadsheet formulas, including bundled strategy CSV', () => {
  const { studio } = loadRuntime();
  const dangerous = ['=SUM(1,2)', '+cmd', '-1+2', '@SUM(A1:A2)', '\t=cmd', '\r=cmd', '   +cmd'];
  const csv = studio.toCsv(
    dangerous.map((value) => ({ value })),
    ['value']
  );
  const parsed = plain(studio.parseCsv(csv));

  parsed.forEach((row, index) => {
    assert.ok(row.value.startsWith("'"), `formula-like CSV value was not neutralized: ${dangerous[index]}`);
  });
  assert.equal(plain(studio.parseCsv(studio.toCsv([{ value: 'safe text' }], ['value'])))[0].value, 'safe text');

  const bundle = plain(studio.buildArtifactBundle({
    id: 'analysis_job_formula_fixture',
    input: ANALYSIS_INPUT,
    keyword_candidates: [{
      keyword_id: 'kw_001',
      priority: 'P0',
      keyword: '=HYPERLINK("https://example.test")',
      intent: 'Commercial',
      cluster: 'Comparison',
      estimated_monthly_demand: 100,
      volume_source: 'Estimated',
      gsc_impressions: null,
      gsc_source: null,
      gsc_status: 'not_connected',
      target_url: 'https://user:password@example.test/service/?access_token=secret-value#private',
      competitor_gap: '未計測',
      competitor_gap_source: null,
      ai_prompt_count: 0,
      status: '未対策',
      action: '確認'
    }],
    prompt_candidates: [],
    actions: [{
      id: 'action_secret_fixture',
      type: 'existing',
      target_key: 'existing|https://user:password@example.test/?access_token=secret-value',
      title: '確認',
      target_url: 'https://user:password@example.test/service/?access_token=secret-value#faq',
      status: 'draft'
    }]
  }));
  const keywordRows = plain(studio.parseCsv(bundle.files['strategy/keyword-candidates.csv']));
  assert.ok(keywordRows[0].keyword.startsWith("'"), 'formula injection must remain neutralized in bundle CSV');
  assert.doesNotMatch(JSON.stringify(bundle), /password|secret-value|access_token|#private/);
  assert.match(bundle.files['strategy/actions.csv'], /https:\/\/example\.test\/service\/#faq/);
});

test('generated ZIP passes Python zipfile CRC validation and extracts to disk', async (t) => {
  const { runtime, job } = await runAnalysis();
  const bundle = job.artifact_bundle;
  const blob = runtime.studio.createZipBlob(bundle.files);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'airreach-studio-test-'));
  const zipPath = path.join(tempRoot, bundle.file_name);
  const extractPath = path.join(tempRoot, 'extracted');
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(zipPath, Buffer.from(await blob.arrayBuffer()));

  const python = [
    'import json, pathlib, sys, zipfile',
    'zip_path = pathlib.Path(sys.argv[1])',
    'extract_path = pathlib.Path(sys.argv[2])',
    'extract_path.mkdir(parents=True, exist_ok=True)',
    'with zipfile.ZipFile(zip_path) as archive:',
    '    broken = archive.testzip()',
    '    if broken:',
    '        raise RuntimeError(f"CRC failure: {broken}")',
    '    names = archive.namelist()',
    '    archive.extractall(extract_path)',
    'print(json.dumps(sorted(names), ensure_ascii=False))'
  ].join('\n');
  const result = spawnSync('python3', ['-c', python, zipPath, extractPath], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const extractedNames = JSON.parse(result.stdout);
  assert.deepEqual(extractedNames, Object.keys(bundle.files).sort());

  for (const requiredPath of REQUIRED_BUNDLE_PATHS) {
    const file = await stat(path.join(extractPath, ...requiredPath.split('/')));
    assert.ok(file.isFile(), `Python did not extract required file: ${requiredPath}`);
  }
  const extractedManifest = JSON.parse(await readFile(path.join(extractPath, 'MANIFEST.json'), 'utf8'));
  assert.deepEqual(extractedManifest.files.map((entry) => entry.path).sort(), extractedNames);
});
