// 計測の予定の部品（assets/js/airreach-schedule-view.js）：単価の表と AI の状態。架空のデータだけ
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const V = require('../../assets/js/airreach-schedule-view.js');
let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, got === undefined ? '' : JSON.stringify(got)); } };
const src = fs.readFileSync(new URL('../../api/airreach/schedule-run.js', import.meta.url), 'utf8');
const m = /DEFAULT_COST_PER_ANSWER = (\{[^}]+\})/.exec(src);
t('単価の表が計測サーバー（schedule-run.js）と同じ', m && JSON.stringify(Function('return ' + m[1])()) === JSON.stringify(V.COST));
const es = V.engineStatus([{ engine: 'gemini', status: 'error', error: 'Gemini [quota_billing] ...' }, { engine: 'google_aio', status: 'not_shown' }, { engine: 'chatgpt_search', status: 'ok' }, { engine: 'perplexity', status: 'error', error: '[rate limit; retry after 30s]' }, { engine: 'claude', status: 'error', error: 'timeout' }]);
t('AI の状態：支払い待ち・概要なしでも使える・上限・取れなかった', es.gemini[0] === '支払いの設定待ち' && es.google_aio[0] === '使える' && es.chatgpt_search[0] === '使える' && es.perplexity[0] === '回数の上限に当たった' && es.claude[0] === '取れなかった', es);
t('AI の名前に取得の手段の名前を出さない', !/serpapi|有料クレジット/i.test(JSON.stringify(V.ENGINES)));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
