// ZIP の事実と件数（依頼書 R02・R03・T02・T04）：資本金・売上を料金にしない／FAQ 0件で空の schema を出さない／README などの件数が実体と一致する
//   ブラウザ用の部品を Node の vm で読み、架空のサイトだけで確かめる（ネットワーク・本番データに触れない）
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
const expect = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(detail).slice(0, 300)}`); };

const ctx = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, URL, URLSearchParams, TextEncoder, Date, JSON, Math, Promise };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } };
ctx.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} }; ctx.sessionStorage = ctx.localStorage;
ctx.location = { search: '', hash: '', href: 'https://trillion-bank.jp/airreach/studio/' };
vm.createContext(ctx);
for (const f of ['airreach-keyword.js', 'airreach-package-schema.js', 'airreach-orchestrator.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8'), ctx, { filename: f });
const K = ctx.AirReachKeyword, O = ctx.AirReachOrchestrator;

const price = (text) => { const f = K.facts({ text, url: 'https://sample-co.example/' }).price; return f ? f.value : null; };
expect('資本金は料金にしない', price('会社概要 資本金 50,000,000円。設立 2010年。') === null, price('会社概要 資本金 50,000,000円。'));
expect('売上・年商は料金にしない', price('売上高 1,200,000,000円（2025年度）') === null && price('年商 300,000,000円') === null);
expect('実績・累計の金額は料金にしない', price('累計取引額 25,000,000円を突破') === null);
expect('料金の言葉がある金額は料金にする（月額）', /30,000円/.test(price('料金プラン 月額 30,000円（税込）') || ''), price('料金プラン 月額 30,000円（税込）'));
expect('料金の言葉がある金額は料金にする（〜の幅）', /5,000円/.test(price('カット 5,000円〜8,000円') || ''));
expect('飲食店のメニュー（品名つきの少額）は料金にする', /2,013円/.test(price('天重 2,013円 うな重 3,500円') || ''));
expect('品名も料金の言葉も無い大きな金額は料金にしない', price('お客様の声 1,000,000円 の効果がありました') === null);

const build = (facts, industry) => {
  const job = { url: 'https://sample-co.example/', industry: industry || 'b2b', profile: { brand: 'サンプル株式会社', service: 'Web制作' }, keywords: [], diagnose: { page: { keywordAuto: { facts } } }, generatedAt: '2026-10-07T00:00:00Z' };
  return O.buildPackageFiles(job);
};
const textFiles = (files) => Object.keys(files).filter((k) => typeof files[k] === 'string');
// 資本金だけのサイト（T02）
let files = build(K.facts({ text: '会社概要 資本金 50,000,000円。設立 2010年。', url: 'https://sample-co.example/' }));
expect('T02：FAQ 本文に資本金の金額を出さない', !/50,000,000/.test(files['content/faq.md']));
expect('T02：どのファイルにも資本金を料金として出さない', textFiles(files).every((k) => !/料金[^\n]{0,20}50,000,000|50,000,000[^\n]{0,10}料金/.test(files[k])));
// FAQ 0件（T04）
expect('T04：確定した FAQ が0件なら faq.jsonld を出さない', !('schema/faq.jsonld' in files));
expect('T04：README に undefined が無い', !/undefined/.test(files['README.md']), (files['README.md'].match(/.{20}undefined.{10}/g) || []).join(' | '));
expect('T04：どのテキストのファイルにも undefined・NaN が無い', textFiles(files).every((k) => !/(^|[^A-Za-z_])(undefined|NaN)(?![A-Za-z_])/.test(files[k])), textFiles(files).filter((k) => /undefined|NaN/.test(files[k])).join(','));
expect('T04：README は faq.jsonld を入れていないと書く', /faq\.jsonld：\*\*入れていません\*\*/.test(files['README.md']));
let mf = JSON.parse(files['MANIFEST.json']);
expect('T04：MANIFEST の件数（提案・サイトから・要確認・schema）', mf.faq_counts && mf.faq_counts.in_schema === 0 && mf.faq_counts.from_site === 0 && mf.faq_counts.proposed === mf.faq_counts.needs_check, JSON.stringify(mf.faq_counts));
expect('T04：検査に通る（faq.jsonld を求めない）', files._validation && files._validation.ok, JSON.stringify(files._validation && files._validation.errors));
// サイトの記載から答えがある（件数の一致）
files = build(K.facts({ text: '営業時間 10:00〜19:00 定休日 水曜 TEL 03-1234-5678 料金プラン 月額 30,000円（税込）', url: 'https://sample-co.example/' }), 'other');
mf = JSON.parse(files['MANIFEST.json']);
const ld = files['schema/faq.jsonld'] ? JSON.parse(files['schema/faq.jsonld']) : null;
const readmeN = Number((/サイトの記載から作った答えだけ\*\*を入れています（(\d+)問）/.exec(files['README.md']) || [])[1]);
const mdN = Number((/サイトに書かれていたことから答えを作った質問が (\d+) 問/.exec(files['content/faq.md']) || [])[1]);
expect('件数：README・FAQ 本文・JSON-LD・MANIFEST が同じ', ld && ld.mainEntity.length > 0 && ld.mainEntity.length === readmeN && readmeN === mdN && mdN === mf.faq_counts.in_schema, JSON.stringify({ ld: ld && ld.mainEntity.length, readmeN, mdN, mf: mf.faq_counts }));
expect('件数のときも undefined が無い', textFiles(files).every((k) => !/(^|[^A-Za-z_])undefined(?![A-Za-z_])/.test(files[k])));
// 検査：空の FAQ の JSON-LD・undefined を見つける
const S = ctx.AirReachPackageSchema;
const bad = Object.assign({}, files, { 'schema/faq.jsonld': JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [] }), 'README.md': files['README.md'] + '\n（undefined問）' });
const v = S.validatePackageFiles(bad, { targetUrl: 'https://sample-co.example/', industry: 'other' });
expect('検査：空の FAQ の JSON-LD を誤りにする', v.errors.some((e) => /no questions/.test(e)), JSON.stringify(v.errors));
expect('検査：README の undefined を誤りにする', v.errors.some((e) => /README\.md contains "undefined"/.test(e)), JSON.stringify(v.errors));

// R02：メニューやナビの切れ端を答えの根拠にしない
const F = (text) => K.facts({ text, url: 'https://sample-co.example/' });
const navText = 'ホーム | 料金 | アクセス | お問い合わせ | 会社概要 営業時間 10:00〜19:00 | ブログ | サイトマップ';
expect('ナビの切れ端の中の営業時間は使わない', !F(navText).hours, F(navText).hours);
expect('ナビの切れ端の中の料金は使わない', !F('トップ ｜ 料金プラン 月額 30,000円 ｜ アクセス ｜ お問い合わせ ｜ 採用情報').price, F('トップ ｜ 料金プラン 月額 30,000円 ｜ アクセス ｜ お問い合わせ').price);
expect('本文の営業時間は使う（ナビの言葉が近くに1つだけなら）', !!F('当店の営業時間は 10:00〜19:00 です。定休日は水曜です。ご予約はお問い合わせから。').hours);
expect('フッターの電話番号は使う（電話・住所はナビの近くでも事実）', !!F('会社概要 | プライバシー | サイトマップ | TEL 03-1234-5678').phone);
// R01：キャッチコピーをサービス名として確定しない
const cctx = { window: {}, document: { getElementById() { return null; } }, sessionStorage: { getItem() { return null; } }, console };
vm.createContext(cctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/airreach-confirm.js'), 'utf8'), cctx);
const LC = cctx.window.AirReachConfirm.looksLikeCatchphrase;
expect('キャッチコピーらしい：句読点・感嘆符・長い文・宣伝の言い回し', ['あなたの毎日に、ときめく眉を。', '理想の眉を叶える', '美しさを、もっと自由に！', '経営の課題を解決し、未来をつくるパートナーです'].every(LC));
expect('サービス名はキャッチコピーとしない', ['ホームページ制作', '眉毛サロン', '縮毛矯正', 'Web制作', 'そば・うどん'].every((x) => !LC(x)), ['ホームページ制作', '眉毛サロン', '縮毛矯正', 'Web制作', 'そば・うどん'].filter(LC));
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
