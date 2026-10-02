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
// 連携（*_api）と手入力が同じ月にあるとき: 連携を優先し、連携で取れない項目は手入力で埋める
const merged = R.compileReport({
  client: { name: 'テスト' }, periodMonth: '2026-09-01', now: new Date('2026-09-30T00:00:00Z'), scans: [], runs: [], actions: [],
  traffic: [
    { period_month: '2026-09-01', source: 'ga4_manual', metrics: { sessions: 100, ai_sessions: 2, target_page_views: 40, conversions: 3 } },
    { period_month: '2026-09-01', source: 'ga4_api', metrics: { sessions: 120, ai_sessions: 5, target_page_views: null, conversions: 4 } },
    { period_month: '2026-09-01', source: 'gsc_api', metrics: { clicks: 636, impressions: 24091 } },
    { period_month: '2026-09-01', source: 'gsc_csv', metrics: { clicks: 351, impressions: 14958 } }
  ]
});
expect('traffic: GA4 は連携の値を優先し、取れない対象ページ閲覧は手入力で埋める',
  [merged.traffic.ga4.source, merged.traffic.ga4.sessions, merged.traffic.ga4.ai_sessions, merged.traffic.ga4.target_page_views, merged.traffic.ga4.conversions], ['ga4_api', 120, 5, 40, 4]);
expect('traffic: GSC は連携（サイト全体）の値を使う（並び順に左右されない）', [merged.traffic.gsc.source, merged.traffic.gsc.clicks], ['gsc_api', 636]);
// AI が参照したサイト・引用された対象ページ（社内計測の summary.json の cited_domains / media_citations）
{
  const sum = { run_id: 'r1', query_set_version: 'v1', by: [{ provider: 'openai', model: 'gpt-x', group: 'main', denominator: 10, either: { rate: 20, numerator: 2 }, service_mention_rate: 30 }],
    cited_domains: [['example.com', { openai: 3, gemini: 1 }], ['(unresolved)', { openai: 2 }], ['news.example', { openai: 1, gemini: 0 }]],
    media_citations: [{ provider: 'openai', query: '町田 焼肉', url: 'https://news.example/a/1', match_type: 'exact_target' }, { provider: 'gemini', query: 'x', url: 'not-a-url' }] };
  const pr = R.parseMeasurementSummary(sum);
  expect('cited: domains parsed, unresolved dropped, totals', pr.citedDomains.map((d) => [d.host, d.total]), [['example.com', 4], ['news.example', 1]]);
  expect('cited: target citations keep only real URLs', pr.targetCitations.map((t) => t.url), ['https://news.example/a/1']);
  const rc = R.compileReport({ client: { name: 't' }, periodMonth: '2026-10-01', now: new Date('2026-10-30T00:00:00Z'), scans: [{ id: 's', createdAt: '2026-10-05T00:00:00Z', url: 'https://example.com/', overallScore: 50, ruleVersion: 'r9', gaps: [] }], actions: [],
    runs: [{ measured_on: '2026-10-20', source: 'script', summary: sum }],
    traffic: [{ period_month: '2026-10-01', source: 'gsc_api', metrics: { clicks: 5, impressions: 50, start_date: '2026-10-01', end_date: '2026-10-28', days: 28, property: 'sc-domain:example.com' } }] });
  expect('cited: compiled ai has cited domains and target citations', [rc.ai.citedDomains.length, rc.ai.targetCitations.length], [2, 1]);
  const ev = R.evidenceList(rc);
  expect('evidence: site row has date, url, rule version', /2026-10-05 \d\d:\d\d に https:\/\/example\.com\/ .*判定基準 r9/.test(ev[0].detail), true);
  expect('evidence: ai row has date, version, model and answers', /計測日 2026-10-20・質問の版 v1・ChatGPT（gpt-x） 10回答/.test(ev[1].detail), true);
  expect('evidence: gsc row has source and period', ev[2].source === 'Google Search Console（連携で取得）' && /2026-10-01〜2026-10-28（28日間）・sc-domain:example\.com・サイト全体の合計/.test(ev[2].detail), true);
  expect('evidence: ga4 missing → 未取得', ev[3].source, '未取得');
}
const todo = R.todoList(compiled);
expect('todo: 配点の大きい順（llms.txt 4点 → robots.txt 2点）', todo.map((t) => [t.key, t.points]), [['llms.txtがある', 4], ['robots.txtがある', 2]]);
expect('todo: 直し方と直す材料の有無', [todo[0].studio, todo[1].studio, !!todo[0].how], [true, false, true]);
expect('todo: 旧レポート（gapKeys なし）でも言い方から戻せる', R.todoList({ site: { current: { gaps: ['FAQの構造化データ（FAQPage）が無い'] } } }).map((t) => t.key), ['FAQPageがある']);

// お客様向けの言い方（専門用語を使わない）
expect('plain: チェック名から', R.plainGap('llms.txtがある'), 'AI向けのサイト案内のファイルが無い');
expect('plain: 社内向けの言い方から', R.plainGap('robots.txt が無い'), '検索やAIの巡回ロボット向けの案内ファイルが無い');
expect('plain: 知らない言い方はそのまま', R.plainGap('その他の不足'), 'その他の不足');
expect('plain: todo にお客様向けの言い方と、制作会社向けの正式な用語が両方ある', [todo[0].plainText, todo[0].text], ['AI向けのサイト案内のファイルが無い', 'llms.txt が無いか、80文字以下']);
const allPlain = Object.keys({ 'ページタイトルがある': 1, 'H1が1つ': 1, '説明文（meta）が十分': 1, 'canonicalがある': 1, 'og:titleがある': 1, '本文量がある': 1, '会社情報（Organization等）': 1, 'WebSite / WebPage': 1, 'Service / Product': 1, 'BreadcrumbList': 1, '問い合わせ導線': 1, 'FAQPageがある': 1, 'FAQが3問以上': 1, '画面上のFAQらしき領域': 1, 'llms.txtがある': 1, 'robots.txtがある': 1, '主要AIボットの記載': 1, 'sitemap案内': 1 });
const jargon = /Organization|LocalBusiness|WebSite|WebPage|Service \/|Product|Breadcrumb|FAQPage|llms\.txt|robots\.txt|canonical|og:title|meta|H1|構造化データ|Sitemap/;
expect('plain: 18項目すべて、お客様向けの言い方に専門用語が入っていない', allPlain.filter((k) => jargon.test(R.plainGap(k))), []);

expect('plain: 直ったことは肯定の言い方', R.plainResolved('FAQの構造化データ（FAQPage）が無い'), 'よくある質問が、検索やAIが読み取れる形になった');
expect('plain: 18項目すべてに直ったときの言い方がある', allPlain.filter((k) => R.plainResolved(k) === k), []);

// 質問の版が違う月は比較しない
const c2 = R.compileReport({ periodMonth: '2026-09-01', scans: [], runs: [
  { measured_on: '2026-08-20', summary: summary(0, 0, 'v1') },
  { measured_on: '2026-09-20', summary: summary(10, 20, 'v2') }
], traffic: [], actions: [] });
expect('report: 質問の版が違えば差を出さない', c2.ai.providers.map((p) => p.citeDelta), [null, null]);
expect('report: 材料が無ければ missing に並ぶ', c2.missing, ['ホームページの診断', 'Search Console の数値', 'GA4 の数値']);

// ---- 診断の根拠（RPC airreach_client_scans の拡張後の形に合わせた架空の値）----
import fs from 'node:fs';
const diagSrc = fs.readFileSync(path.join(ROOT, 'assets/js/airreach-diagnose.js'), 'utf8');
const diagLabels = [...diagSrc.matchAll(/check\('(?:structure|entity|faq|discover)', '([^']+)'/g)].map((m) => m[1]);
expect('criteria: 診断の18項目すべてに判定基準の言い方がある', diagLabels.filter((l) => !R.criteria[l]), []);
expect('criteria: 診断の項目数は18', diagLabels.length, 18);
const wts = Object.fromEntries([...diagSrc.matchAll(/\{ id: '(\w+)', label: '[^']+', weight: ([0-9.]+)/g)].map((m) => [m[1], Number(m[2])]));
expect('criteria: 重みが診断と同じ', R.factorWeight, wts);

const mkChecks = () => diagLabels.map((l, i) => ({ label: l, factor: i < 6 ? 'structure' : i < 11 ? 'entity' : i < 14 ? 'faq' : 'discover', state: 'ok', points: 2, max: 2, evidenceUrl: 'https://x.test/' }));
const ev = mkChecks();
ev.find((c) => c.label === 'FAQPageがある').state = 'ng'; ev.find((c) => c.label === 'FAQPageがある').points = 0;
ev.find((c) => c.label === 'FAQが3問以上').state = 'ng'; ev.find((c) => c.label === 'FAQが3問以上').points = 0;
ev.find((c) => c.label === 'llms.txtがある').state = 'ng'; ev.find((c) => c.label === 'llms.txtがある').points = 0;
ev.find((c) => c.label === 'sitemap案内').state = 'unknown'; ev.find((c) => c.label === 'sitemap案内').points = null;
const scanEv = {
  id: 'e1', createdAt: '2026-10-05T01:02:00Z', fetchedAt: '2026-10-05T01:02:00Z', url: 'https://x.test/', overallScore: 53, ruleVersion: 'r1',
  factors: { structure: 83, entity: 40, faq: 0, discover: 72 }, gaps: ['FAQPageがある', 'FAQが3問以上', 'llms.txtがある'], unknownChecks: 1,
  checks: ev, adjustments: [{ factor: 'discover', label: 'meta robotsにnoindex', points: -3 }],
  scope: { diagnosedAt: '2026-10-05T01:02:00Z', page: { url: 'https://x.test/', finalUrl: 'https://x.test/', status: 200 },
    subpages: [{ url: 'https://x.test/menu/', role: 'menu', ok: true, status: 200 }, { url: 'https://x.test/access/', role: 'access', ok: false, status: 404 }] },
  robots: { state: 'ok', url: 'https://x.test/robots.txt', bots: [{ name: 'GPTBot', org: 'OpenAI（学習）', via: 'own', verdict: 'blocked', lines: [{ n: 4, text: 'User-agent: GPTBot' }, { n: 5, text: 'Disallow: /' }] }, { name: 'ClaudeBot', org: 'Anthropic', via: 'star', verdict: 'allowed', lines: [] }] },
  ld: { blocks: [{ types: ['Restaurant'], fields: { name: 'テスト店' } }], scripts: 1, errors: 0 }, types: ['Restaurant'],
  evidence: { llms: { state: 'ok' }, robots: { state: 'ok' } }, pageInfo: { faqCount: 1, hasLlms: false, hasRobots: true, finalUrl: 'https://x.test/' }
};
const ce = R.compileReport({ periodMonth: '2026-10-01', scans: [scanEv], runs: [], traffic: [], actions: [] });
const dt = ce.site.current.detail;
expect('detail: 18項目すべてに結果が出る', dt.checks.length, 18);
expect('detail: 内訳の寄与の合計は総合点に近い', Math.abs(dt.breakdown.total - 53) < 1, true);
expect('detail: 内訳の寄与（ページの骨格 83×30%）', dt.breakdown.rows[0].contribution, 24.9);
expect('detail: 重みの配り直しなし', dt.breakdown.redistributed, false);
expect('detail: FAQ 0点の理由に問数が出る', dt.checks.find((c) => c.label === 'FAQが3問以上').reason, 'トップページで見つかったよくある質問：1問');
expect('detail: FAQPage の理由に見つかった種類', dt.checks.find((c) => c.label === 'FAQPageがある').reason, '該当する構造化データがありません（トップページで見つかった種類：Restaurant）');
expect('detail: llms.txt はあるが短い', dt.llms.key, 'short');
expect('detail: 判定できない項目は0点扱いにしない', dt.checks.find((c) => c.label === 'sitemap案内').points, null);
expect('detail: 判定基準の文', dt.checks.find((c) => c.label === 'FAQが3問以上').rule, 'よくある質問が3問以上あるか');
expect('detail: 減点を残す', dt.adjustments, [{ factor: 'discover', factorLabel: '見つけやすさ', label: 'meta robotsにnoindex', points: -3 }]);
expect('detail: 確認したページ数（読めた下層ページだけ数える）', dt.scope.pagesRead, 2);
expect('detail: 下層ページの一覧', dt.scope.subpages.map((p) => [p.url, p.role, p.ok]), [['https://x.test/menu/', 'メニュー・料金', true], ['https://x.test/access/', 'アクセス・店舗情報', false]]);
expect('detail: 根拠の行に行番号', dt.robots.bots[0].lines, ['4行目：User-agent: GPTBot', '5行目：Disallow: /']);
expect('detail: AIボットの判定', dt.robots.bots.map((b) => [b.name, b.verdictText]), [['GPTBot', '拒否'], ['ClaudeBot', '許可']]);
expect('detail: 個別指定のあるボット', dt.checks.find((c) => c.label === '主要AIボットの記載').reason, 'robots.txt に個別の指定があるAIのロボット：GPTBot');
expect('detail: 診断日時は日本時間', R.jstTime('2026-10-05T01:02:00Z'), '2026-10-05 10:02');
const todos = R.todoList(ce);
expect('todo: 提案の理由に診断結果を結びつける', todos.find((t) => t.key === 'FAQPageがある').basis, '診断で「よくある質問」の「よくある質問が、構造化データ（FAQPage）で書かれているか」が満たされていなかった（0／2点）ため。「よくある質問」は0点です。');
expect('first: 前の月の材料が無ければ初回', ce.first, true);
const ce2 = R.compileReport({ periodMonth: '2026-10-01', scans: [scanEv, { ...scanEv, id: 'e0', createdAt: '2026-09-05T00:00:00Z', fetchedAt: null }], runs: [], traffic: [], actions: [] });
expect('first: 前月の診断があれば初回ではない', ce2.first, false);
const oldScan = { id: 'o', createdAt: '2026-10-05T00:00:00Z', url: 'https://x.test/', overallScore: 40, factors: { structure: 50 }, gaps: [] };
const co = R.compileReport({ periodMonth: '2026-10-01', scans: [oldScan], runs: [], traffic: [], actions: [] });
expect('old: 根拠の記録が無い古い診断でも落ちない', [co.site.current.detail.checks.length, co.site.current.detail.scope.pagesRead, co.site.current.detail.llms.key], [0, null, 'unknown']);
expect('evidence: 診断の行に時刻と確認したページ数', R.evidenceList(ce)[0].detail.indexOf('2026-10-05 10:02') === 0 && R.evidenceList(ce)[0].detail.indexOf('読んだページ 2ページ') > 0, true);

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
