/**
 * 月次レポートの組み立て（assets/js/airreach-report.js）の単体テスト。架空の顧客・数値のみ。
 *   node scripts/airreach-api/unit-report.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const R = createRequire(import.meta.url)(path.join(ROOT, 'assets/js/airreach-report.js'));
const results = [];
const expect = (name, got, want) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
const throws = (name, fn) => {
  let ok = false;
  try { fn(); } catch (e) { ok = true; }
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
};

// 計測スクリプトの summary.json（形だけ本物に合わせた架空の値）
const summary = (openaiRate, geminiRate, qv = 'v1') => ({
  run_id: 'r', generated_at: '2026-09-20T00:00:00Z', matcher_version: 'v1', query_set_version: qv,
  by: [
    { provider: 'openai', model: 'openai/gpt-5-mini', group: 'main', total: 10, denominator: 10, numerator: 0, rate: openaiRate, either: { numerator: 0, rate: openaiRate }, service_mention_rate: 100, search_execution_rate: 90, error_count: 0 },
    { provider: 'gemini', model: 'google/gemini-2.5-flash', group: 'main', total: 10, denominator: 10, numerator: 2, rate: geminiRate, either: { numerator: 2, rate: geminiRate }, service_mention_rate: 90, error_count: 1 },
    { provider: 'openai', model: 'openai/gpt-5-mini', group: 'all', total: 14, denominator: 14, rate: 0 }
  ]
});

const s = R.parseMeasurementSummary(summary(0, 20));
expect('summary: 行数', s.rows.length, 3);
expect('summary: gemini main 引用率', s.rows[1].citeRate, 20);
expect('summary: 言及率', s.rows[0].mentionRate, 100);
throws('summary: 形式違いは例外', () => R.parseMeasurementSummary({ foo: 1 }));

// GSC CSV（日本語の日付CSV、2か月分）
const csvJa = '日付,クリック数,表示回数,CTR,掲載順位\n2026-08-31,5,100,5%,10\n2026-09-01,10,200,5%,8\n2026-09-02,20,300,6.7%,6\n';
const g = R.parseGscCsv(csvJa, '2026-09-01');
expect('gsc(ja): 9月だけ合計', [g.clicks, g.impressions, g.rows], [30, 500, 2]);
expect('gsc(ja): CTR', g.ctr, 6);
expect('gsc(ja): 表示回数で重み付けした順位', g.position, 6.8);
const csvEn = '﻿Top queries,Clicks,Impressions,CTR,Position\n"q, 1",3,30,10%,4\nq2,1,70,1.4%,9\n';
const ge = R.parseGscCsv(csvEn, '2026-09-01');
expect('gsc(en): 日付列なしは全行合計（引用符・BOM対応）', [ge.clicks, ge.impressions], [4, 100]);
throws('gsc: 列が無いCSVは例外', () => R.parseGscCsv('a,b\n1,2', '2026-09-01'));

// レポートの組み立て
const compiled = R.compileReport({
  client: { id: 'c1', name: 'テスト焼肉', industry_id: 'restaurant' },
  periodMonth: '2026-09-15',
  now: new Date('2026-09-30T00:00:00Z'),
  scans: [
    { id: 'a', createdAt: '2026-08-10T00:00:00Z', overallScore: 40, gaps: ['FAQPageがある', 'llms.txtがある'] },
    { id: 'b', createdAt: '2026-09-25T00:00:00Z', overallScore: 48, gaps: ['llms.txtがある', 'robots.txtがある'], factors: { structure: 100 } },
    { id: 'c', createdAt: '2026-10-02T00:00:00Z', overallScore: 60, gaps: [] }
  ],
  runs: [
    { measured_on: '2026-08-20', summary: summary(0, 0) },
    { measured_on: '2026-09-20', summary: summary(10, 20) }
  ],
  traffic: [
    { period_month: '2026-09-01', source: 'gsc_csv', metrics: { clicks: 30, impressions: 500 } },
    { period_month: '2026-08-01', source: 'gsc_csv', metrics: { clicks: 5, impressions: 100 } }
  ],
  actions: [
    { title: 'FAQを追加', status: 'done', done_on: '2026-09-12', evidence_url: 'https://example.test/faq' },
    { title: '予定', status: 'planned', done_on: '2026-09-20' },
    { title: '先月', status: 'done', done_on: '2026-08-12' }
  ]
});
expect('report: 対象月と前月', [compiled.periodMonth, compiled.previousMonth], ['2026-09-01', '2026-08-01']);
expect('report: 当月の診断（翌月の診断は使わない）', compiled.site.current.id, 'b');
expect('report: 点数の差', compiled.site.overallDelta, 8);
expect('report: 解消した不足（判定基準の言い方）', compiled.site.resolved, ['FAQの構造化データ（FAQPage）が無い']);
expect('report: 新しく出た不足', compiled.site.added, ['robots.txt が無い']);
expect('report: AI 引用率の差（同じ質問の版）', compiled.ai.providers.map((p) => p.citeDelta), [10, 20]);
expect('report: 当月の実施済み施策だけ', compiled.actions.map((a) => a.title), ['FAQを追加']);
expect('report: GSC 当月と前月', [compiled.traffic.gsc.clicks, compiled.traffic.gscPrev.clicks], [30, 5]);
expect('report: 事実の最初の行', compiled.facts[0], 'ホームページの情報整備：40点 → 48点（+8）');
expect('report: 足りない材料は GA4 だけ', compiled.missing, ['GA4 の数値']);
expect('report: 推移は6か月（古い順）', compiled.history.map((h) => h.month), ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']);
expect('report: 推移の点数（材料の無い月は null・翌月の診断は入れない）', compiled.history.map((h) => h.score), [null, null, null, null, 40, 48]);
expect('report: 推移の引用率', compiled.history.slice(4).map((h) => h.cite), [{ openai: 0, gemini: 0 }, { openai: 10, gemini: 20 }]);
expect('report: 推移のクリック', compiled.history.slice(4).map((h) => h.clicks), [5, 30]);

// 質問の版が違う月は比較しない
const c2 = R.compileReport({ periodMonth: '2026-09-01', scans: [], runs: [
  { measured_on: '2026-08-20', summary: summary(0, 0, 'v1') },
  { measured_on: '2026-09-20', summary: summary(10, 20, 'v2') }
], traffic: [], actions: [] });
expect('report: 質問の版が違えば差を出さない', c2.ai.providers.map((p) => p.citeDelta), [null, null]);
expect('report: 材料が無ければ missing に並ぶ', c2.missing, ['ホームページの診断', 'Search Console の数値', 'GA4 の数値']);

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
