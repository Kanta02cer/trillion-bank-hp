/**
 * お客様ごとの計測の条件（月1回・月2回、1つの質問の回数、AI）と、計測の時期への反映の単体テスト。
 *   node scripts/airreach-api/unit-measure-plan.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CS = createRequire(import.meta.url)(path.join(ROOT, 'assets/js/airreach-case-steps.js'));
const results = [];
const ok = (name, cond, detail) => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  — ${detail || ''}`}`); };

// 条件の読み方
const p0 = CS.measurePlan(null);
ok('default plan = monthly 30 days', p0.perMonth === 1 && p0.intervalDays === 30 && p0.repeats === 1 && !p0.set, JSON.stringify(p0));
const p2 = CS.measurePlan({ perMonth: 2, repeats: 3, engines: ['google_aio', 'chatgpt_search', 'google_ai_mode', 'unknown', 'google_aio'] });
ok('twice a month = 15 days', p2.perMonth === 2 && p2.intervalDays === 15, JSON.stringify(p2));
ok('repeats 3 kept', p2.repeats === 3);
ok('unknown/duplicate engines dropped', p2.engines.join(',') === 'google_aio,chatgpt_search,google_ai_mode', p2.engines.join(','));
ok('odd values fall back', CS.measurePlan({ perMonth: 5, repeats: 7 }).perMonth === 1 && CS.measurePlan({ perMonth: 5, repeats: 7 }).repeats === 1);

// 計測の時期：前回から15日（月2回）／30日（今までどおり）
const now = new Date('2026-10-20T03:00:00Z');
const base = { entityAt: '2026-09-01T00:00:00Z', lastRunAt: '2026-10-01T03:00:00Z' };
const t1 = CS.timing(base, now);
const t2 = CS.timing({ ...base, plan: { perMonth: 2 } }, now);
ok('monthly due 30 days after', t1.kind === 'monthly' && t1.every === 30 && Math.round((t1.due - new Date(base.lastRunAt)) / 864e5) === 30, JSON.stringify(t1));
ok('twice-a-month due 15 days after', t2.kind === 'monthly' && t2.every === 15 && Math.round((t2.due - new Date(base.lastRunAt)) / 864e5) === 15, JSON.stringify(t2));
ok('twice-a-month is due/late by 10/20', t2.state === 'due' || t2.state === 'late', t2.state);
ok('monthly not yet due by 10/20', t1.state === 'soon' || t1.state === 'later', t1.state);
ok('staff line says 15 days', /15日（月2回の契約）/.test(CS.timingLine(t2)), CS.timingLine(t2));
ok('staff line unchanged for monthly', /前回の計測から30日/.test(CS.timingLine(t1)), CS.timingLine(t1));

// お客様の画面（DB の関数が measure_plan を返したとき／返さない古い関数のとき）
const d = { entity_at: base.entityAt, last_run_at: base.lastRunAt };
const c1 = CS.customerTiming(d, new Date('2026-10-05T03:00:00Z'));
const c2 = CS.customerTiming({ ...d, measure_plan: { perMonth: 2 } }, new Date('2026-10-05T03:00:00Z'));
ok('customer: old function = 30 days', c1 && c1.every === 30, JSON.stringify(c1));
ok('customer: plan = 15 days', c2 && c2.every === 15, JSON.stringify(c2));
ok('customer text: 月2回', /月2回の計測です/.test(CS.timingCustomer(c2)), CS.timingCustomer(c2));

// 担当者の「次にやること」：Studio の作業データの measurePlan を使う
const ws = { orch: { lastJob: { confirm: { entity: { at: base.entityAt, company: 'テスト', service: 'テスト' } } } }, studio: { measurePlan: { perMonth: 2, repeats: 3 } } };
const runs = [{ created_at: base.lastRunAt, summary: { answers: [{ engine: 'google_aio', status: 'ok' }] } }];
const r = CS.compute({ workspace: ws, runs, studioHref: '/s', runsHref: '#', now });
ok('compute uses workspace plan', r.timing && r.timing.every === 15, JSON.stringify(r.timing));

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
