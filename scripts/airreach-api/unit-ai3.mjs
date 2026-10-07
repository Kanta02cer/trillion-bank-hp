// 3つの AI の集計（assets/js/airreach-ai3.js）と、計測 API の地域・検索の確認（依頼書 R04・R09・T06・T07・T12）。架空のデータだけ
//   node scripts/airreach-api/unit-ai3.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ctx = { window: {}, console, URL };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/airreach-ai3.js'), 'utf8'), ctx);
const A = ctx.window.AirReachAI3;
const M = await import(path.join(ROOT, 'api/hack2-measure.js'));
let pass = 0, fail = 0;
const t = (name, ok, got) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, got === undefined ? '' : JSON.stringify(got)); } };

const C = (engine, extra) => Object.assign({ engine, model: engine === 'chatgpt_search' ? 'openai/gpt-5-mini' : 'serpapi/' + engine, search: true, location: 'JP' }, extra || {});
const R = (engine, status, extra) => Object.assign({ prompt: '質問' + Math.random().toString(36).slice(2, 6), status, measured_at: '2026-10-07T01:00:00Z', conditions: C(engine), mentioned: null }, extra || {});
const ok = (engine, m, extra) => R(engine, 'ok', Object.assign({ mentioned: m ? 1 : 0, answer_text: m ? 'サンプル商店は駅前にあります' : '別のお店があります' }, extra || {}));

// AIO：10回試行＝名前あり2・名前なし3・概要なし4・失敗1 → 分母は正常に取れた9（概要なしを含む）
const aio = [ok('google_aio', 1), ok('google_aio', 1), ok('google_aio', 0), ok('google_aio', 0), ok('google_aio', 0),
  R('google_aio', 'not_shown'), R('google_aio', 'not_shown'), R('google_aio', 'not_shown'), R('google_aio', 'not_shown'), R('google_aio', 'error', { error: 'timeout' })];
let s = A.summarize(aio, { brand: 'サンプル商店' }).aio.t;
t('AIO：分母に概要なしを入れる（2/9）', s.mentioned === 2 && s.denominator === 9, s);
t('AIO：出現率 22.2%', s.rate === 22.2, s.rate);
t('AIO：失敗は分母に入れず別に数える', s.errors === 1 && s.ok === 9 && s.attempts === 10);
t('AIO：概要が出た 5/9', s.shown === 5 && s.notShown === 4);
// AI モード：回答なしは分母に入れない
s = A.summarize([ok('google_ai_mode', 1), ok('google_ai_mode', 0), R('google_ai_mode', 'not_shown')], { brand: 'サンプル商店' }).aimode.t;
t('AI モード：回答なしは分母に入れない（1/2）', s.mentioned === 1 && s.denominator === 2, s);
// 分母0は N/A（0% にしない）
s = A.summarize([R('google_aio', 'error'), R('google_aio', 'error')], {}).aio.t;
t('全部失敗：分母0は N/A（null）で 0% にしない', s.denominator === 0 && s.rate === null && s.errors === 2, s);
// 未計測
t('計測していない AI は「未計測」', A.summarize(aio, {}).chatgpt_search.status === 'unmeasured');
// ChatGPT：検索なしは主表示に入れない
const gpt = [ok('chatgpt_search', 1), ok('chatgpt_search', 0), ok('chatgpt', 1, { conditions: C('chatgpt', { search: false, model: 'openai/gpt-4o-mini' }) })];
s = A.summarize(gpt, { brand: 'サンプル商店' }).chatgpt_search;
t('ChatGPT：検索なしの回答は「検索あり」に混ぜない', s.t.attempts === 2 && s.t.mentioned === 1, s.t);
t('ChatGPT：engineOf で検索なしを分ける', A.engineOf(gpt[2]) === 'chatgpt_nosearch' && A.engineOf(gpt[0]) === 'chatgpt_search');
// 条件の違う結果を混ぜない（地域が違う）
const mixed = [ok('google_aio', 1, { measured_at: '2026-10-01T00:00:00Z', conditions: C('google_aio', { location: 'Osaka,Osaka,Japan' }) }), ok('google_aio', 0), ok('google_aio', 0)];
s = A.summarize(mixed, { brand: 'サンプル商店' }).aio;
t('条件（地域）が違う結果は混ぜない：新しい条件だけ 0/2・ほか1組', s.t.denominator === 2 && s.t.mentioned === 0 && s.others === 1, { d: s.t.denominator, o: s.others });
// 質問の版が違う結果も混ぜない
const vers = [ok('google_aio', 1, { query_set_version: 'v1', measured_at: '2026-09-01T00:00:00Z' }), ok('google_aio', 0, { query_set_version: 'v2' })];
t('質問の版が違う結果は混ぜない', A.summarize(vers, {}).aio.others === 1 && A.summarize(vers, {}).aio.t.attempts === 1);
// 言及・公式の出典・記事の出典・本文の URL を別々に
const cites = [ok('google_aio', 1, { cited_by_sources: 1, citations: ['https://sample-shop.example/menu/'], self_url_in_text: 0 }),
  ok('google_aio', 1, { cited_by_sources: 0, citations: ['https://review.example/x'], self_url_in_text: 1 }), ok('google_aio', 0)];
s = A.summarize(cites, { brand: 'サンプル商店', articleUrls: ['https://sample-shop.example/menu'] }).aio.t;
t('出典：公式サイトが正式な出典 1/2（判定できた回答だけ）', s.official === 1 && s.officialJudged === 2, s);
t('出典：対象の記事が正式な出典 1', s.article === 1);
t('出典：本文の URL は別に数える 1（正式な出典に入れない）', s.bodyUrl === 1);
// 否定の言及は数えない（要確認）
const deny = [ok('google_aio', 1, { answer_text: 'サンプル商店という店舗は確認できませんでした。' }), ok('google_aio', 1)];
s = A.summarize(deny, { brand: 'サンプル商店' }).aio.t;
t('「確認できません」の言及は要確認にし、言及に数えない', s.review === 1 && s.mentioned === 1 && s.denominator === 2, s);
// 失敗の種類
t('失敗の種類：error_type を数える', A.summarize([R('google_aio', 'error', { error_type: 'rate_limit' })], {}).aio.t.errorKinds.rate_limit === 1);
// 描画（DOM の代わりに innerHTML を受ける箱）
const box = { innerHTML: '', querySelectorAll: () => [] };
A.render(box, aio, { brand: 'サンプル商店' });
t('描画：AIO を主に X/N と出現率', /2<small> \/ 9回/.test(box.innerHTML) && /出現率 22\.2%/.test(box.innerHTML));
t('描画：失敗・概要なしを別に出す', /取得失敗<\/dt><dd>1回/.test(box.innerHTML) && /概要なし<\/dt><dd>4回/.test(box.innerHTML));
t('描画：未計測のタブ', /ChatGPT<\/b><small>未計測/.test(box.innerHTML));
t('描画：根拠の表に結果の種類', /概要なし/.test(box.innerHTML) && /名前あり/.test(box.innerHTML) && /取得失敗/.test(box.innerHTML));
t('描画：合算しない注意書き', /合算しません/.test(box.innerHTML));
const box2 = { innerHTML: '', querySelectorAll: () => [] };
A.render(box2, [R('google_aio', 'error')], {});
t('描画：分母0は N/A', /N\/A<small>（分母が0）/.test(box2.innerHTML));
const box3 = { innerHTML: '', querySelectorAll: () => [] };
A.render(box3, [ok('google_aio', 1, { answer_text: '<img src=x onerror=alert(1)>' , prompt: '<b>x</b>' })], {});
t('描画：回答と質問はエスケープ', !/<img/.test(box3.innerHTML) && !/<b>x<\/b>/.test(box3.innerHTML));

// API：地域・検索の確認・失敗の種類・重複
t('地域：空は日本全体（null）', M.normalizeLocation('') === null && M.normalizeLocation(undefined) === null);
t('地域：SerpApi の形は通す（空白を詰める）', M.normalizeLocation('Shibuya, Tokyo, Japan') === 'Shibuya,Tokyo,Japan');
t('地域：日本語・記号・長すぎは false（黙って日本全体にしない）', M.normalizeLocation('渋谷区') === false && M.normalizeLocation('a;drop') === false && M.normalizeLocation('A'.repeat(81)) === false);
t('地域：OpenAI へは市区町村と都道府県', JSON.stringify(M.userLocation('Shibuya,Tokyo,Japan')) === JSON.stringify({ type: 'approximate', country: 'JP', city: 'Shibuya', region: 'Tokyo' }));
t('地域：都道府県だけ', JSON.stringify(M.userLocation('Tokyo,Japan')) === JSON.stringify({ type: 'approximate', country: 'JP', region: 'Tokyo' }) && JSON.stringify(M.userLocation(null)) === JSON.stringify({ type: 'approximate', country: 'JP' }));
t('SerpApi が実際に使った地域を読む', M.serpLocationUsed({ search_parameters: { location_used: 'Shibuya,Tokyo,Japan' } }) === 'Shibuya,Tokyo,Japan' && M.serpLocationUsed({}) === null);
t('失敗の種類', M.errorType(new Error('x [rate limit; retry after 30s]')) === 'rate_limit' && M.errorType(new Error('The operation was aborted due to timeout')) === 'timeout' && M.errorType(new Error('fetch failed')) === 'network' && M.errorType(new Error('?')) === 'other');
t('検索したかを読む（web_search_call）', M.parseSearchResponses({ output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: 'a' }] }] }).searched === true && M.parseSearchResponses({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'a' }] }] }).searched === false);
t('同じ質問（空白・大文字小文字だけ違う）は1回だけ', M.normalizePrompts(['渋谷 そば', '渋谷そば', 'ABC', 'abc ', '新宿 そば']).length === 3);
let calls = 0;
await M.withRateRetry(async () => { calls++; throw new Error('rate limit; retry after 1s'); }, Date.now() + 60000, async () => {}).catch(() => {});
t('回数の上限での聞き直しは有限（4回で止める）', calls === 4, calls);

// 指名の質問と一般の質問を分ける（R04）
const brand = 'サンプル商店';
const mix = [ok('google_aio', 1, { prompt: 'サンプル商店の営業時間は？' }), ok('google_aio', 1, { prompt: 'サンプル商店 口コミ' }), ok('google_aio', 0, { prompt: '駅前で人気のお店は？' }), R('google_aio', 'not_shown', { prompt: '駅前 雑貨屋 おすすめ' })];
t('一般の質問だけ：名前なし1・概要なし1 → 0/2', (() => { const x = A.summarize(mix, { brand, segment: 'general' }).aio.t; return x.mentioned === 0 && x.denominator === 2; })());
t('指名の質問だけ：2/2', (() => { const x = A.summarize(mix, { brand, segment: 'branded' }).aio.t; return x.mentioned === 2 && x.denominator === 2; })());
t('すべて：2/4', (() => { const x = A.summarize(mix, { brand, segment: 'all' }).aio.t; return x.mentioned === 2 && x.denominator === 4; })());
t('保存した branded を優先', A.isBranded({ prompt: '駅前のお店', branded: true }, brand) && !A.isBranded({ prompt: 'サンプル商店', branded: false }, brand));
t('株式会社・店を外した名前でも指名と判定', A.isBranded({ prompt: 'ライフスタジオの料金' }, '株式会社ライフスタジオ'));
const box4 = { innerHTML: '', querySelectorAll: () => [] };
A.render(box4, mix, { brand });
t('描画：既定は一般の質問（0 / 2回）・切り替えに件数', /一般の質問<small>2回/.test(box4.innerHTML) && /指名の質問<small>2回/.test(box4.innerHTML) && /0<small> \/ 2回/.test(box4.innerHTML) && /一般の質問（名前を入れていない質問）だけ/.test(box4.innerHTML), box4.innerHTML.slice(0, 400));
const box5 = { innerHTML: '', querySelectorAll: () => [] };
A.render(box5, [ok('google_aio', 1, { prompt: 'サンプル商店の場所' })], { brand });
t('描画：一般の質問が0なら「すべて」で出す', /1<small> \/ 1回/.test(box5.innerHTML) && /一般と指名の質問をすべて/.test(box5.innerHTML));
t('API：試行番号と判定ルールの版', M.JUDGE_VERSION && /^judge\//.test(M.JUDGE_VERSION));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
