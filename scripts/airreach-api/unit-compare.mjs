// 前後の比較（assets/js/airreach-compare.js）：同じ条件・同じ質問のときだけ差を出す・AIO が主・PDF と画面は同じデータ。架空の計測だけ
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ctx = { window: {}, console, URL, TextEncoder, Promise, JSON, Math, Date };
ctx.window.crypto = globalThis.crypto;
vm.createContext(ctx);
for (const f of ['airreach-ai3.js', 'airreach-compare.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8'), ctx);
const C = ctx.window.AirReachCompare;
let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, got === undefined ? '' : JSON.stringify(got).slice(0, 300)); } };

const cond = (engine, x) => Object.assign({ engine, model: engine === 'chatgpt_search' ? 'openai/gpt-5-mini' : 'serpapi/' + engine, search: true, location: 'JP' }, x || {});
const Q = ['渋谷で美味しいそば屋は？', '渋谷で個室のあるそば屋は？', '渋谷駅近くの十割そばは？', '渋谷で昼に行けるそば屋は？', '渋谷でそば打ち体験は？'];
// engine の AI に、質問ごとに結果（'m' 名前あり / 'n' なし / 's' 概要なし / 'e' 失敗）
const answers = (engine, pattern, x) => Q.map((q, i) => { const k = pattern[i]; return { prompt: q, engine, status: k === 's' ? 'not_shown' : k === 'e' ? 'error' : 'ok', mentioned: k === 'm' ? 1 : k === 'n' ? 0 : null, cited_by_sources: k === 'm' ? 1 : k === 'n' ? 0 : null, measured_at: '2026-09-01T01:00:00Z', conditions: cond(engine, x) }; });
const run = (id, day, ver, parts) => ({ id, measured_on: day, created_at: day + 'T01:00:00Z', query_set_version: ver, summary: { answers: [].concat(...parts) } });

// 前：AIO 1/4（概要なし1は分母・失敗1は外）→ 後：AIO 3/5
const before = run('r1', '2026-09-01', 'v3', [answers('google_aio', 'mnsne'), answers('google_ai_mode', 'nnnnm'), answers('chatgpt_search', 'nnnnn')]);
const after = run('r2', '2026-10-01', 'v3', [answers('google_aio', 'mmsmn'), answers('google_ai_mode', 'mnnnm'), answers('chatgpt_search', 'nnnmn')]);
let c = C.compare(before, after, { brand: 'サンプルそば' });
const aio = c.engines.find((e) => e.key === 'aio');
t('AIO が主の指標・最初', c.engines[0].key === 'aio' && aio.main);
t('AIO：前 1/4（概要なしは分母・失敗は外）', aio.before.mentioned === 1 && aio.before.denominator === 4 && aio.before.errors === 1, aio.before);
t('AIO：後 3/5', aio.after.mentioned === 3 && aio.after.denominator === 5, aio.after);
t('AIO：差 +35ポイント（25%→60%）', aio.comparable && aio.diff === 35, aio);
t('AI モード・ChatGPT も同じ条件なら差を出す', c.engines.every((e) => e.comparable), c.engines.map((e) => [e.key, e.reasons]));

// 地域が違う
const afterLoc = run('r3', '2026-10-01', 'v3', [answers('google_aio', 'mmsmn', { location: 'Shibuya,Tokyo,Japan' }), answers('google_ai_mode', 'mnnnm'), answers('chatgpt_search', 'nnnmn')]);
c = C.compare(before, afterLoc, {});
t('地域が違う AI は比べない（理由つき）・ほかの AI は比べる', !c.engines[0].comparable && /地域が違います/.test(c.engines[0].reasons.join()) && c.engines[0].diff === null && c.engines[1].comparable, c.engines[0].reasons);
// 質問の版が違う
c = C.compare(before, run('r4', '2026-10-01', 'v4', [answers('google_aio', 'mmsmn')]), {});
t('質問の版が違えば比べない', !c.engines[0].comparable && /質問の版が違います/.test(c.engines[0].reasons.join()));
// 聞いた質問が違う
const fewer = run('r5', '2026-10-01', 'v3', [answers('google_aio', 'mmsmn').slice(0, 3)]);
c = C.compare(before, fewer, {});
t('聞いた質問が違えば比べない', !c.engines[0].comparable && /聞いた質問が違います/.test(c.engines[0].reasons.join()), c.engines[0].reasons);
// 片方で測っていない
t('後で測っていない AI は「測っていません」', /後の計測でこの AI を測っていません/.test(C.compare(before, fewer, {}).engines[1].reasons.join()));
// 古い形式（answers なし）
c = C.compare(run('r6', '2026-08-01', 'v3', []), after, {});
t('回答ごとの記録が無い古い計測とは比べない', c.engines.every((e) => !e.comparable && /古い形式/.test(e.reasons.join())));
// 全部失敗＝分母0
c = C.compare(before, run('r7', '2026-10-01', 'v3', [answers('google_aio', 'eeeee'), answers('google_ai_mode', 'mnnnm'), answers('chatgpt_search', 'nnnmn')]), {});
t('分母0の計測とは差を出さない（0% と比べない）', !c.engines[0].comparable && c.engines[0].diff === null && /分母が0/.test(c.engines[0].reasons.join()));
// 検索なしの ChatGPT は主の ChatGPT（検索あり）と混ぜない
const nos = run('r8', '2026-10-01', 'v3', [answers('google_aio', 'mmsmn'), answers('google_ai_mode', 'mnnnm'), answers('openai', 'mmmmm', { engine: 'chatgpt', search: false, model: 'openai/gpt-4o-mini' })]);
c = C.compare(before, nos, {});
t('検索なしの ChatGPT は検索ありと比べない', !c.engines[2].comparable && /後の計測でこの AI を測っていません/.test(c.engines[2].reasons.join()));
// 指紋：同じデータなら同じ・違えば違う
const f1 = await C.fingerprint(before, after), f2 = await C.fingerprint(before, after), f3 = await C.fingerprint(before, afterLoc);
t('データの指紋：同じデータは同じ・違うデータは違う', /^[0-9a-f]{64}$/.test(f1) && f1 === f2 && f1 !== f3);
// 画面の本文と PDF は同じ本文から
c = C.compare(before, after, {});
const body = C.bodyHtml(c, { fp: f1 }), pdf = C.printHtml(c, { fp: f1, clientName: 'サンプルそば', site: 'https://sample-soba.example/' });
t('PDF は画面と同じ本文を含む（同じ保存データから）', pdf.includes(body));
t('PDF：AIO を主に・差・指紋・保存した計測の日付・注意書き', /主に見る指標/.test(pdf) && /\+35ポイント/.test(pdf) && pdf.includes(f1.slice(0, 16)) && /保存した計測 2026-09-01 と 2026-10-01 から作成/.test(pdf) && /合算しません/.test(pdf) && /保証するものではありません/.test(pdf));
{ const h = C.printHtml(c, { clientName: '<script>x</script>' }); t('PDF：顧客名などはエスケープ', h.includes('&lt;script&gt;x') && !h.includes('<script>x')); }
t('比べられない AI は「比べられません」と理由を本文に出す', /比べられない理由：地域が違います/.test(C.bodyHtml(C.compare(before, afterLoc, {}), {})));
// R10：質問ごとの根拠と、優先して直すこと3点
c = C.compare(before, after, { brand: 'サンプルそば' });
const qa = c.engines[0].questions;
t('質問ごとの根拠：AIO の5問それぞれに前後の結果', qa.length === 5 && qa[0].b === 'mentioned' && qa[0].a === 'mentioned' && qa[2].b === 'not_shown' && qa[4].b === 'error' && qa[1].a === 'mentioned', qa);
const imps = [{ title: 'よくある質問のページを作る', how: '料金・予約を質問と答えで' }, { title: '会社の情報を構造化データに', how: '' }, { title: '店名を統一', how: '' }, { title: '4つ目', how: '' }];
const info = { fp: f1, improvements: imps, improvementsSource: 'サイトの診断（最新）から' };
const b2 = C.bodyHtml(c, info), p2 = C.printHtml(c, Object.assign({ clientName: 'サンプルそば' }, info));
t('PDF：質問ごとの結果の表（概要なし・取得失敗も）', /質問ごとの結果（Google AI Overviews）/.test(p2) && /概要なし/.test(p2) && /取得失敗/.test(p2) && (p2.match(/<tr><td>/g) || []).length === 5);
t('PDF：優先して直すこと3点だけ・材料が別だと明記', /優先して直すこと（3点）/.test(p2) && p2.includes('よくある質問のページを作る') && !p2.includes('4つ目') && /AI の計測の結果とは別の材料/.test(p2));
t('画面と PDF は同じ本文（根拠と3点を含めても）', p2.includes(b2));
// 一般の質問だけを比べる（指名の質問は別）
const brQ = (engine, m) => ({ prompt: 'サンプルそば 口コミ', engine, status: 'ok', mentioned: m, cited_by_sources: null, measured_at: '2026-09-01T01:00:00Z', conditions: cond(engine) });
const b2r = run('r9', '2026-09-01', 'v3', [answers('google_aio', 'mnsne'), [brQ('google_aio', 1)]]), a2r = run('r10', '2026-10-01', 'v3', [answers('google_aio', 'mmsmn'), [brQ('google_aio', 1)]]);
c = C.compare(b2r, a2r, { brand: 'サンプルそば' });
t('前後比較は一般の質問だけ（指名1問を混ぜず 1/4→3/5）', c.segment === 'general' && c.engines[0].before.denominator === 4 && c.engines[0].after.denominator === 5 && c.engines[0].diff === 35, c.engines[0]);
t('本文に「一般の質問だけ」と書く', /一般の質問（名前を入れていない質問）だけ/.test(C.bodyHtml(c, {})));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
