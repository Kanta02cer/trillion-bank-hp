// 競合との比較（assets/js/airreach-rivals.js）。架空の回答だけ
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ctx = { window: {}, console, URL, JSON, Math, Date, document: { addEventListener() {}, querySelectorAll() { return []; }, getElementById() { return null; } } };
vm.createContext(ctx);
for (const f of ['airreach-ai-breakdown.js', 'airreach-ai3.js', 'airreach-rivals.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8'), ctx);
const RV = ctx.window.AirReachRivals;
let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, got === undefined ? '' : JSON.stringify(got).slice(0, 400)); } };
const comps = [{ name: 'ヘアサロン ミドリ', url: 'https://midori-hair.example/' }, { name: 'ビューティ ソラ', url: 'https://beauty-sora.example/' }];
const cond = (e) => ({ engine: e, search: true, location: 'JP', model: 'm' });
// a: 自分が出た / mi: ミドリ / so: ソラ / cites
const A = (prompt, me, mi, so, cites, extra) => Object.assign({ prompt, engine: 'google_aio', status: 'ok', mentioned: me ? 1 : 0, conditions: cond('google_aio'), citations: cites || [],
  competitors: [{ name: 'ヘアサロン ミドリ', mentioned: mi ? 1 : 0 }, { name: 'ビューティ ソラ', mentioned: so ? 1 : 0 }] }, extra || {});
const answers = [
  A('渋谷でおすすめの美容室は？', 1, 1, 1, ['https://beauty.hotpepper.jp/x', 'https://midori-hair.example/', 'https://beauty-sora.example/menu']),
  A('渋谷で縮毛矯正が上手い美容室は？', 0, 1, 0, ['https://midori-hair.example/straight', 'https://instagram.com/midori']),
  A('渋谷駅近くでカラーが得意な美容室は？', 0, 1, 1, ['https://beauty-sora.example/color', 'https://midori-hair.example/color']),
  A('渋谷で個室のある美容室は？', 1, 0, 0, ['https://beauty.hotpepper.jp/y']),
  { prompt: '渋谷で安いカットは？', engine: 'google_aio', status: 'not_shown', conditions: cond('google_aio') },
  { prompt: '渋谷のメンズカットは？', engine: 'google_aio', status: 'error', conditions: cond('google_aio') },
  A('サンプル美容室 Hana の評判は？', 1, 0, 0, ['https://sample-salon.example/']),
  A('渋谷でおすすめの美容室は？', 0, 1, 0, [], { engine: 'google_ai_mode', conditions: cond('google_ai_mode') })];
const runs = [{ id: 'r1', created_at: '2026-10-07T02:00:00Z', measured_on: '2026-10-07', summary: { answers } }, { id: 'r0', created_at: '2026-09-01T00:00:00Z', summary: { answers: [A('古い', 1, 0, 0)] } }];
const base = { runs, brand: 'サンプル美容室 Hana', selfUrl: 'https://sample-salon.example/', competitors: comps };
let r = RV.compute(base);
const by = (n) => r.shops.find((s) => s.name === n);
t('いちばん新しい計測を使う', r.run.id === 'r1');
t('AIO の分母：概要なしも入れ、失敗と指名の質問は除く（5問）', r.denominator === 5, r.denominator);
t('名前が出た数：ミドリ3・自分2・ソラ2（指名の質問は数えない）', by('ヘアサロン ミドリ').mentioned === 3 && by('サンプル美容室 Hana').mentioned === 2 && by('ビューティ ソラ').mentioned === 2, r.shops.map((s) => [s.name, s.mentioned]));
t('順位：3店中 2位（同数のソラより上）・1位との差1問', r.rank === 2 && r.total === 3 && r.gap === 1 && r.shops[0].name === 'ヘアサロン ミドリ' && r.shops[1].self, [r.rank, r.gap, r.shops.map((s) => s.name)]);
t('相手だけが出た質問：縮毛矯正とカラーの2問', JSON.stringify(r.onlyRivals) === JSON.stringify(['渋谷で縮毛矯正が上手い美容室は？', '渋谷駅近くでカラーが得意な美容室は？']), r.onlyRivals);
const mi = by('ヘアサロン ミドリ').src;
t('出典の種類（ミドリ）：公式3・口コミ等1・SNS1・そのほか2（ソラのサイト）', mi.official === 3 && mi.portal === 1 && mi.sns === 1 && mi.other === 2, mi);
const me = by('サンプル美容室 Hana');
t('出典の種類（自分）：公式0・口コミ等2（予約サイトの掲載だけで出ている）', me.src.official === 0 && me.src.portal === 2, me.src);
const h = RV.html(r, base);
t('表示：ひと言の結論・自分の順位・1位との差', /3店のうち 2位。ヘアサロン ミドリは、こちらより 1問多く名前が出ています/.test(h) && /相手だけが出た質問が 2問/.test(h));
t('表示：公式サイトが一度も出典になっていない注意', /公式サイトが一度も出典になっていません/.test(h));
t('表示：質問の表は登録順の列（自分が先頭）・相手だけの行は黄色', /<th class="is-self">サンプル美容室 Hana<\/th><th>ヘアサロン ミドリ<\/th><th>ビューティ ソラ<\/th>/.test(h) && (h.match(/class="is-only"/g) || []).length === 2);
r = RV.compute(Object.assign({}, base, { engine: 'aimode' }));
t('AI モードは別に数える（合算しない）：ミドリ1・自分0・分母1', r.ok && r.denominator === 1 && r.shops.find((s) => s.name === 'ヘアサロン ミドリ').mentioned === 1, [r.denominator, r.shops.map((s) => s.mentioned)]);
r = RV.compute(Object.assign({}, base, { engine: 'chatgpt_search' }));
t('回答の無い AI は「回答がありません」', !r.ok && /回答がありません/.test(r.reason));
r = RV.compute(Object.assign({}, base, { competitors: [] }));
t('競合が未登録なら比べない（登録の案内）', !r.ok && /登録されていません/.test(RV.html(r, base)) && /Studio の「競合」/.test(RV.html(r, base)));
t('計測が無ければ「まだ計測がありません」', /まだ計測がありません/.test(RV.html(RV.compute(Object.assign({}, base, { runs: [] })), base)));
const x = RV.html(RV.compute(Object.assign({}, base, { brand: '<b>x</b>' })), Object.assign({}, base, { brand: '<b>x</b>' }));
t('エスケープ', !/<b>x<\/b>/.test(x));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
