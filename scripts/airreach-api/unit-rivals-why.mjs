// 競合との比較の「なぜ」（assets/js/airreach-rivals-why.js）。架空のページと回答だけ・ネットワークなし
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ctx = { window: {}, console, URL, JSON, Math, Date, document: { addEventListener() {}, querySelectorAll() { return []; }, getElementById() { return null; }, readyState: 'complete' }, localStorage: { getItem() { return null; } } };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['airreach-keyword.js', 'airreach-ai-breakdown.js', 'airreach-ai3.js', 'airreach-rivals.js', 'airreach-rivals-why.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8'), ctx, { filename: f });
const RV = ctx.AirReachRivals, W = ctx.AirReachRivalsWhy;
let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, got === undefined ? '' : JSON.stringify(got).slice(0, 400)); } };
// ② ページに書いてあること
const ld = (o) => '<script type="application/ld+json">' + JSON.stringify(o) + '</script>';
const rival = '<html><head>' + ld({ '@type': 'HairSalon', name: 'ミドリ', dateModified: '2026-09-20' }) + ld({ '@type': 'FAQPage', mainEntity: [] }) + '</head><body><h1>縮毛矯正</h1><p>料金プラン 縮毛矯正 16,500円〜（税込）。所要時間 約3時間。施術の流れ：カウンセリング→薬剤→仕上げ。営業時間 10:00〜20:00</p></body></html>';
const mine = '<html><body><h1>サンプル美容室 Hana</h1><p>渋谷駅から徒歩3分。個室あり。</p><p>最終更新 2024年4月</p></body></html>';
const fr = W.features(rival, 'https://midori-hair.example/straight'), fm = W.features(mine, 'https://sample-salon.example/');
t('相手のページ：料金・営業時間・流れ・よくある質問・お店の情報・更新日', fr.price && fr.hours && fr.flow && fr.faq && fr.org && fr.updated === '2026年', fr);
t('自分のページ：料金・流れ・よくある質問・お店の情報なし・更新 2024年', !fm.price && !fm.flow && !fm.faq && !fm.org && fm.updated === '2024年', fm);
t('資本金は料金と判定しない（料金の判定は keyword.js と同じ）', !W.features('<p>会社概要 資本金 50,000,000円</p>', 'https://x.example/').price);
// 回答
const cond = (e) => ({ engine: e, search: true, location: 'JP', model: 'm' });
const A = (prompt, me, mi, cites, answer) => ({ prompt, engine: 'google_aio', status: 'ok', mentioned: me ? 1 : 0, conditions: cond('google_aio'), citations: cites, answer,
  competitors: [{ name: 'ヘアサロン ミドリ', mentioned: mi ? 1 : 0 }] });
const answers = [
  A('渋谷でおすすめの美容室は？', 1, 1, ['https://midori-hair.example/', 'https://beauty.hotpepper.jp/x'], 'サンプル美容室 Hana は渋谷駅から徒歩3分で個室があります。ヘアサロン ミドリは口コミの評価が高い人気店です。'),
  A('渋谷で縮毛矯正が上手い美容室は？', 0, 1, ['https://midori-hair.example/straight', 'https://midori-hair.example/straight'], 'ヘアサロン ミドリは縮毛矯正が得意で、料金もわかりやすいと評判です。'),
  A('渋谷駅近くでカラーが得意な美容室は？', 0, 1, ['https://midori-hair.example/straight'], 'ヘアサロン ミドリはカラーのメニューが豊富です。')];
const runs = [{ id: 'r1', created_at: '2026-10-07T02:00:00Z', measured_on: '2026-10-07', summary: { answers } }];
const base = { runs, brand: 'サンプル美容室 Hana', selfUrl: 'https://sample-salon.example/', competitors: [{ name: 'ヘアサロン ミドリ', url: 'https://midori-hair.example/' }] };
const r = RV.compute(base);
const pages = W.pickPages(r, answers, base);
t('比べるページ：相手は出典にいちばん多く出たページ・自分は出典にならず、サイトのトップ', pages.find((p) => !p.self).url === 'https://midori-hair.example/straight' && pages.find((p) => p.self).url === 'https://sample-salon.example/' && /トップ/.test(pages.find((p) => p.self).why), pages);
// ③ AI がどう紹介したか
const tr = W.traits(r, answers, base);
t('自分：駅から近い・個室（相手の文の「評価が高い」は自分に数えない）', tr['サンプル美容室 Hana'].near === 1 && tr['サンプル美容室 Hana'].private === 1 && !tr['サンプル美容室 Hana'].review, tr['サンプル美容室 Hana']);
t('相手：技術・料金・評判・メニュー（「評判です」だけでは評判がよいと数えない）', tr['ヘアサロン ミドリ'].skill === 1 && tr['ヘアサロン ミドリ'].price === 1 && tr['ヘアサロン ミドリ'].review === 1 && tr['ヘアサロン ミドリ'].variety === 1, tr['ヘアサロン ミドリ']);
// ④ 直すこと
const pageRes = { 'ヘアサロン ミドリ': { url: 'https://midori-hair.example/straight', ok: true, f: fr }, 'サンプル美容室 Hana': { url: 'https://sample-salon.example/', ok: true, f: fm } };
pageRes.self = pageRes['サンプル美容室 Hana'];
let sg = W.suggestions(r, tr, pageRes);
t('直すこと：3つまで・ページの差から（料金・営業時間…）・根拠つき', sg.length === 3 && /料金をページに書く/.test(sg[0].title) && /ヘアサロン ミドリの出典ページにはあり、自分のページ/.test(sg[0].why), sg.map((x) => x.title));
t('直すこと：症状に「相手だけが出た質問」', /相手だけが出た質問が 2問/.test(sg[0].symptom), sg[0].symptom);
sg = W.suggestions(r, tr, null);
t('ページを読む前：AI の紹介の差から（技術・料金…）', sg.length === 3 && sg.some((x) => /「技術・専門性」がページから伝わるようにする/.test(x.title)) && sg.every((x) => /自分は言われていない/.test(x.why)), sg.map((x) => x.title));
t('当てはまらなければ書かない、と直し方に書く（推測で足さない）', /当てはまらなければ書かない/.test(sg[0].fix));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
