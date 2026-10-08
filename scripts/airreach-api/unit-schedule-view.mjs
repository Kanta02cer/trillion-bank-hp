// 定期計測と費用の計算（assets/js/airreach-schedule-view.js）。架空の設定だけ
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const V = require('../../assets/js/airreach-schedule-view.js');
let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, got === undefined ? '' : JSON.stringify(got)); } };
const base = { enabled: true, engines: ['google_aio', 'google_ai_mode', 'chatgpt_search'], prompts: Array.from({ length: 10 }, (_, i) => ({ prompt: 'q' + i })), weekdays: [1], hour_jst: 10, repeats: 1, max_runs_per_month: 4, monthly_answer_cap: 200, monthly_cost_cap_usd: 5 };
const now = new Date('2026-10-08T03:00:00Z'); // 10/8（木）12:00 JST
// 単価はサーバーと同じ表
const src = fs.readFileSync(new URL('../../api/airreach/schedule-run.js', import.meta.url), 'utf8');
const m = /DEFAULT_COST_PER_ANSWER = (\{[^}]+\})/.exec(src);
t('単価の表が計測サーバー（schedule-run.js）と同じ', m && JSON.stringify(Function('return ' + m[1])()) === JSON.stringify(V.COST));
t('1回：10問 × 3つの AI ＝ 30回答・約 0.6 ドル', V.perRun(base).answers === 30 && V.perRun(base).cost === 0.6, V.perRun(base));
t('2026年10月の月曜は4回', V.slotsInMonth(base, now) === 4);
let p = V.monthPlan(base, now);
t('上限の内：4回・120回答・2.4 ドル・止まらない', p.runs === 4 && p.wanted.answers === 120 && p.wanted.cost === 2.4 && p.stopAt === null, p);
p = V.monthPlan(Object.assign({}, base, { weekdays: [1, 4], max_runs_per_month: 8, monthly_cost_cap_usd: 3 }), now);
t('費用の上限 3 ドルなら、月の 6回目から止まる（0.6 × 5 ＝ 3.0 は内）', p.runs === 8 && p.stopAt === 6 && /費用の上限/.test(p.why), p);
p = V.monthPlan(Object.assign({}, base, { weekdays: [1, 4], max_runs_per_month: 8, monthly_answer_cap: 100 }), now);
t('回答数の上限 100 なら 4回目から止まる', p.stopAt === 4 && /回答数の上限/.test(p.why), p);
p = V.monthPlan(Object.assign({}, base, { weekdays: [1, 3, 5] }), now);
t('曜日では13回でも、月の実行回数の上限 4回で数える', p.slots === 13 && p.runs === 4 && p.capByRuns, p);
t('次の計測：10/12（月）10:00', V.slotLabel(V.nextSlot(base, now)) === '10/12（月）10:00');
t('今日のまだ来ていない時刻も次の計測（木曜 15時）', V.slotLabel(V.nextSlot(Object.assign({}, base, { weekdays: [4], hour_jst: 15 }), now)) === '10/8（木）15:00');
t('止めているときは次の計測なし', V.nextSlot(Object.assign({}, base, { enabled: false }), now) === null);
const jobs = [
  { slot: '2026-10-05T01:00:00Z', status: 'succeeded', answers_done: 28, answers_planned: 30, est_cost_usd: 0.56 },
  { slot: '2026-10-06T01:00:00Z', status: 'failed', answers_done: 0, answers_planned: 30, est_cost_usd: 0 },
  { slot: '2026-10-07T01:00:00Z', status: 'skipped', answers_done: 0, answers_planned: 30, est_cost_usd: 0 },
  { slot: '2026-09-28T01:00:00Z', status: 'succeeded', answers_done: 30, answers_planned: 30, est_cost_usd: 0.6 }];
const u = V.usage(jobs, now);
t('今月の使った分：サーバーと同じ数え方（見送りと先月は数えない・失敗は回数に入れない）', u.runs === 1 && u.answers === 28 && u.cost === 0.56, u);
const r = V.remaining(base, jobs, now);
t('今月これからの予定：10/12・19・26 の3回（上限 4回 − 使った1回）', r.runs === 3 && r.cost === 1.8, r);
t('止めているときは、これからの予定は0', V.remaining(Object.assign({}, base, { enabled: false }), jobs, now).runs === 0);
const es = V.engineStatus([{ engine: 'gemini', status: 'error', error: 'Gemini [quota_billing] ...' }, { engine: 'google_aio', status: 'not_shown' }, { engine: 'chatgpt_search', status: 'ok' }, { engine: 'perplexity', status: 'error', error: '[rate limit; retry after 30s]' }]);
t('AI の状態：支払い待ち・概要なしでも使える・上限', es.gemini[0] === '支払いの設定待ち' && es.google_aio[0] === '使える' && es.chatgpt_search[0] === '使える' && es.perplexity[0] === '回数の上限に当たった', es);
t('見込みの1行：止まる回を出す', /月の 6回目からは止まります/.test(V.planLine(Object.assign({}, base, { weekdays: [1, 4], max_runs_per_month: 8, monthly_cost_cap_usd: 3 }), now)));
t('見込みの1行：質問が無ければ案内だけ', /質問と AI を選ぶと/.test(V.planLine(Object.assign({}, base, { prompts: [] }), now)));
t('画面に SerpApi・有料クレジットの言葉を出さない', !/serpapi|有料クレジット/i.test(V.planLine(base, now) + V.tilesHtml({ used: 1, cap: 5, next: now, last: jobs[0] }) + JSON.stringify(V.ENGINES)));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
