// 2対象の計測（two-engine/1）：AI による概要と検索ありの ChatGPT 以外に、黙って聞かない（費用を発生させない）。ネットワークなし
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, got === undefined ? '' : JSON.stringify(got)); } };
const M = await import(pathToFileURL(path.join(ROOT, 'api/hack2-measure.js')).href);
const { enginePolicyError, normalizeEngines, measureEngines } = M;
t('決まりなし：今までどおり（断らない）', enginePolicyError(undefined, ['perplexity']) === null);
t('two-engine/1：AI による概要と検索ありの ChatGPT は通す', enginePolicyError('two-engine/1', normalizeEngines(['aio', 'chatgpt-search'])) === null);
t('two-engine/1：推定（外部に聞かない）は通す', enginePolicyError('two-engine/1', ['jev']) === null);
let e = enginePolicyError('two-engine/1', normalizeEngines(['google_aio', 'gemini', 'ai_mode']));
t('two-engine/1：Gemini・AI モードが混ざれば断る（どれか）', e && e.code === 'engine_not_allowed' && e.engines.join() === 'gemini,google_ai_mode', e);
t('two-engine/1：検索なしの ChatGPT も断る（検索ありの代わりにしない）', enginePolicyError('two-engine/1', ['chatgpt']).code === 'engine_not_allowed');
t('知らない決まりは断る', enginePolicyError('three-engine', ['google_aio']).code === 'engine_policy_unknown');
t('AI を指定しないときは推定（Jev）だけ＝外部の AI に聞かない', normalizeEngines(undefined).join() === 'jev' && normalizeEngines([]).join() === 'jev');
t('知らない AI の名前は捨てる（別の AI に読み替えない）', normalizeEngines(['bard', 'google_aio']).join() === 'google_aio');
// 外部の AI に1回も聞かないこと：fetch を見張って、推定だけの計測を流す
const calls = []; const orig = globalThis.fetch; globalThis.fetch = (...a) => { calls.push(String(a[0])); return Promise.reject(new Error('blocked in test')); };
try { await measureEngines({ brand: 'サンプル', prompts: [{ prompt: 'q', confirmed: true }], engines: ['jev'], competitors: [], pageText: 'サンプルの本文', date: '2026-10-09' }); } catch (x) { /* 推定の失敗は問わない */ }
globalThis.fetch = orig;
t('推定だけの計測は、外部への通信が0回', calls.length === 0, calls);
// Studio：既定で選ばれているのは2対象だけ。2対象だけのときは two-engine/1 を付けて送る
const html = fs.readFileSync(path.join(ROOT, 'airreach/studio/index.html'), 'utf8');
const checked = [...html.matchAll(/<input type="checkbox" data-hack2-engine value="([a-z_]+)" checked>/g)].map((m) => m[1]);
const checkedCmp = [...html.matchAll(/<input type="checkbox" data-cmp-engine value="([a-z_]+)" checked>/g)].map((m) => m[1]);
t('競合との比較（AI の回答で比べる）の既定も2対象だけ', checkedCmp.join() === 'google_aio,chatgpt_search', checkedCmp);
t('Studio の既定は AI による概要と検索ありの ChatGPT だけ', checked.join() === 'google_aio,chatgpt_search', checked);
t('ほかの AI は「ほかの AI」の中・既定で選ばない', /<details class="ars-other-ai">[\s\S]*value="gemini">[\s\S]*<\/details>/.test(html) && !/engine value="(gemini|perplexity|google_ai_mode|claude|chatgpt)" checked/.test(html));
const js = fs.readFileSync(path.join(ROOT, 'assets/js/airreach-studio.js'), 'utf8');
t('Studio は2対象だけのとき two-engine/1 を付ける', /policy:engines\.every\(function\(e\)\{return e==='google_aio'\|\|e==='chatgpt_search'\|\|e==='jev'\}\)\?'two-engine\/1':undefined/.test(js));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
