// ページごとの構造化データ（手順 HowTo・製品と価格 Product/Offer・サービスの価格）。架空のサイトだけ・ネットワークなし
//   候補の取り出し → 本文との照合 → 承認したものだけ ZIP に入る → ZIP の検査 → 公開ページの判定
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
const t = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400)}`); };
const ctx = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, URL, URLSearchParams, TextEncoder, Date, JSON, Math, Promise, crypto: globalThis.crypto };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } };
ctx.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} }; ctx.sessionStorage = ctx.localStorage;
ctx.location = { search: '', hash: '', href: 'https://trillion-bank.jp/airreach/studio/' };
vm.createContext(ctx);
for (const f of ['airreach-keyword.js', 'airreach-package-schema.js', 'airreach-verify.js', 'airreach-page-schema.js', 'airreach-orchestrator.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8'), ctx, { filename: f });
const K = ctx.AirReachKeyword, O = ctx.AirReachOrchestrator, S = ctx.AirReachPackageSchema, P = ctx.AirReachPageSchema;
const SITE = 'https://sample-salon.example/';

// ---- 1) 候補の取り出し ----
const flowHtml = `<html><head><title>ご予約の流れ</title><script>var x = "<ol><li>だまし</li><li>だまし2</li></ol>";</script></head><body>
<nav><ol class="breadcrumb"><li>ホーム</li><li>ご予約の流れ</li></ol></nav>
<h1>ご予約の流れ</h1><h2>はじめての方の予約方法</h2>
<ol><li>Web の予約フォームから希望日を選びます</li><li>確認のメールが届きます</li><li>当日は10分前にご来店ください</li></ol>
<ol><li>A</li></ol><p style="display:none">隠した手順：裏口から入ります</p></body></html>`;
let steps = P.extractSteps(flowHtml);
t('手順：番号つきのリストから3つ取り出す', steps.length === 1 && steps[0].steps.length === 3 && steps[0].steps[1] === '確認のメールが届きます', steps);
t('手順：直前の見出しを名前の候補にする', steps[0].title === 'はじめての方の予約方法', steps[0].title);
t('手順：パンくず・script の中・1件だけのリストは候補にしない', !steps.some((s) => s.steps.includes('ホーム') || s.steps.includes('だまし') || s.steps.includes('A')));
const stepHead = P.extractSteps('<h2>導入の流れ</h2><h3>STEP1 お問い合わせ</h3><p>…</p><h3>STEP 2：お見積もり</h3><h3>ステップ３ ご契約</h3>');
t('手順：「STEP 1」の見出しの並びから取り出す', stepHead.length === 1 && stepHead[0].steps.join('|') === 'お問い合わせ|お見積もり|ご契約' && stepHead[0].title === '導入の流れ', stepHead);

const priceHtml = `<html><body><h1>料金</h1>
<table><tr><th>メニュー</th><th>料金</th></tr><tr><td>カット</td><td>4,400円</td></tr><tr><td>カラー</td><td>￥６,６００〜</td></tr></table>
<dl><dt>縮毛矯正</dt><dd>16,500円（税込）</dd></dl>
<p>資本金 10,000,000円</p><p>累計売上 5,000,000円を突破</p><p>ヘッドスパ 3万円</p></body></html>`;
let prices = P.extractPrices(priceHtml);
const byName = Object.fromEntries(prices.map((p) => [p.name, p]));
t('価格：表の行から品名と価格を取り出す', byName['カット'] && byName['カット'].price === 4400 && byName['カット'].from === false, prices);
t('価格：全角・¥・「〜」を読む（「〜から」の価格）', byName['カラー'] && byName['カラー'].price === 6600 && byName['カラー'].from === true, byName['カラー']);
t('価格：定義リスト（dt・dd）と「3万円」を読む', byName['縮毛矯正'] && byName['縮毛矯正'].price === 16500 && byName['ヘッドスパ'] && byName['ヘッドスパ'].price === 30000, prices);
t('価格：資本金・売上は候補にしない', !prices.some((p) => /資本金|売上/.test(p.name) || p.price === 10000000 || p.price === 5000000), prices);
t('入力欄：「品名 | 価格」と「〜」を読む', JSON.stringify(P.parseItems('カット | 4,400円\nカラー｜6600〜\n\n名前だけ')) === JSON.stringify([{ name: 'カット', price: 4400, from: false }, { name: 'カラー', price: 6600, from: true }, { name: '名前だけ', price: null, from: false }]), P.parseItems('カット | 4,400円\nカラー｜6600〜\n\n名前だけ'));
t('入力欄：手順の頭の番号を外す', P.parseSteps('1. 予約する\n２）来店する\n・支払う').join('|') === '予約する|来店する|支払う', P.parseSteps('1. 予約する\n２）来店する\n・支払う'));

// ---- 2) 形の確認と、本文との照合 ----
const C = { url: SITE, industry: 'other', brand: 'サンプル美容室', company: 'サンプル株式会社', service: 'ヘアカット' };
const how = { id: 'p1', type: 'howto', url: SITE + 'flow/', name: steps[0].title, steps: steps[0].steps.slice(), state: '', checked: null };
const prod = { id: 'p2', type: 'product', url: SITE + 'price/', name: '料金', items: [{ name: 'カット', price: 4400, from: false }, { name: 'カラー', price: 6600, from: true }], state: '', checked: null };
t('確認：正しい形は直すところなし', P.validate(how, C).length === 0 && P.validate(prod, C).length === 0, [P.validate(how, C), P.validate(prod, C)]);
t('確認：別のサイトのページは入れられない', P.validate({ ...how, url: 'https://other.example/flow/' }, C).some((m) => /対象のサイト/.test(m)));
t('確認：www の有無は同じサイトとして扱う', P.validate({ ...how, url: 'https://www.sample-salon.example/flow/' }, C).length === 0);
t('確認：手順が1つ・価格が数字でない・飲食店のサービスの価格は直すところあり',
  P.validate({ ...how, steps: ['1つだけ'] }, C).length > 0 && P.validate({ ...prod, items: [{ name: 'カット', price: null }] }, C).length > 0 && P.validate({ ...prod, type: 'service_price' }, { ...C, industry: 'restaurant' }).some((m) => /飲食店/.test(m)));
t('照合：ページに書いてある手順は一致', P.match(how, flowHtml).ok === true, P.match(how, flowHtml));
t('照合：ページに無い手順は一致しない（どれが無いかを返す）', (() => { const r = P.match({ ...how, steps: how.steps.concat(['会員カードを作ります']) }, flowHtml); return !r.ok && r.missing.length === 1 && /手順4/.test(r.missing[0]); })());
t('照合：隠してある文は「書いてある」にしない', P.match({ ...how, steps: ['確認のメールが届きます', '隠した手順：裏口から入ります'] }, flowHtml).ok === false);
t('照合：品名の近くに同じ価格があれば一致（全角・桁区切り・¥ の違いは無視）', P.match(prod, priceHtml).ok === true, P.match(prod, priceHtml));
t('照合：価格が違えば一致しない', (() => { const r = P.match({ ...prod, items: [{ name: 'カット', price: 4000, from: false }] }, priceHtml); return !r.ok && /4000円/.test(r.missing[0]); })());
t('照合：「14,400円」を「4,400円」と読み違えない', P.match({ ...prod, items: [{ name: 'セット', price: 4400, from: false }] }, '<p>セット 14,400円</p>').ok === false);
t('照合：「3万円」と 30000 は同じ', P.match({ ...prod, items: [{ name: 'ヘッドスパ', price: 30000, from: false }] }, priceHtml).ok === true);
t('照合：本文が読めないページは一致にしない', P.match(how, '<html><body><div id="app"></div><script>render()</script></body></html>').ok === false);

// ---- 3) 構造化データの中身 ----
const hl = P.build(how, C);
t('HowTo：名前・URL・手順（順番つき）だけを入れる', hl['@type'] === 'HowTo' && hl.url === how.url && hl.step.length === 3 && hl.step[2].position === 3 && hl.step[0]['@type'] === 'HowToStep' && Object.keys(hl).sort().join() === '@context,@type,name,step,url', hl);
const pl = P.build(prod, C);
t('Product：複数は一覧（ItemList）にし、1つずつ Product と Offer', pl['@type'] === 'ItemList' && pl.itemListElement.length === 2 && pl.itemListElement[0].item['@type'] === 'Product' && pl.itemListElement[0].item.offers.price === 4400 && pl.itemListElement[0].item.offers.priceCurrency === 'JPY', pl);
t('Product：「〜から」の価格は price にせず最低価格（minPrice）にする', (() => { const o = pl.itemListElement[1].item.offers; return o.price === undefined && o.priceSpecification.minPrice === 6600; })(), pl.itemListElement[1]);
const one = P.build({ ...prod, items: [prod.items[0]] }, C);
t('Product：1つだけなら Product をそのまま', one['@type'] === 'Product' && one.name === 'カット' && one.offers['@type'] === 'Offer' && one.brand.name === 'サンプル美容室', one);
t('確かめていない項目（税・在庫・評価）は足さない', !/availability|aggregateRating|review|valueAddedTax/i.test(JSON.stringify([hl, pl, one])));

// ---- 4) ZIP：承認したものだけ入る ----
const facts = K.facts({ text: '営業時間 10:00〜19:00 定休日 水曜 TEL 03-1234-5678', url: SITE });
const ent = { company: 'サンプル株式会社', brand: 'サンプル美容室', service: 'ヘアカット', url: SITE, at: '2026-10-13T01:00:00Z' };
const mk = (pages, industry) => ({ url: SITE, industry: industry || 'other', profile: { brand: 'サンプル美容室', service: 'ヘアカット' }, keywords: [], diagnose: { page: { keywordAuto: { facts } } }, completed_at: '2026-10-13T00:00:00Z',
  confirm: { rev: 3, entity: ent, faq: {}, pages } });
const approved = (e, html) => ({ ...e, state: 'approved', at: '2026-10-13T02:00:00Z', checked: { ...P.match(e, html), at: '2026-10-13T01:30:00Z' } });
const clean = (f) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== '_validation'));
const allFaqDone = (job) => { const f = O.buildPackageFiles(job); JSON.parse(f['MANIFEST.json']).faq_items.filter((i) => i.status === 'site').forEach((i) => { job.confirm.faq[i.q] = { state: 'approved', at: '2026-10-13T01:10:00Z' }; }); return job; };

let job = allFaqDone(mk([]));
let f = O.buildPackageFiles(job), mf = JSON.parse(f['MANIFEST.json']);
t('何も足していない：ページごとのファイルは無く、件数は0（今までの ZIP と同じ）', !Object.keys(f).some((k) => /^schema\/pages\//.test(k)) && mf.page_schema_counts.total === 0 && mf.page_schemas.length === 0 && !JSON.parse(f['schema/service.jsonld']).offers, mf.page_schema_counts);
t('何も足していない：公開用にできる', S.validatePackageFiles(clean(f), { targetUrl: SITE, industry: 'other' }).publishable === true, S.validatePackageFiles(clean(f), { targetUrl: SITE, industry: 'other' }));

job = allFaqDone(mk([{ ...how, checked: { ...P.match(how, flowHtml), at: '2026-10-13T01:30:00Z' } }]));
f = O.buildPackageFiles(job); mf = JSON.parse(f['MANIFEST.json']);
let v = S.validatePackageFiles(clean(f), { targetUrl: SITE, industry: 'other' });
t('承認待ち：ファイルは入らず、ZIP は公開用にならない', !Object.keys(f).some((k) => /^schema\/pages\//.test(k)) && mf.page_schema_counts.pending === 1 && v.ok && !v.publishable && v.warnings.some((w) => /ページごとのデータ/.test(w)), [mf.page_schema_counts, v.warnings]);
t('承認待ち：README に承認されていないと書く', /ページごとのデータ（手順・価格）のうち 1 件は、まだ承認されていません/.test(f['README.md']));

const svcPrice = { id: 'p3', type: 'service_price', url: SITE + 'price/', name: '', items: [{ name: 'カット', price: 4400, from: false }], state: '', checked: null };
job = allFaqDone(mk([approved(how, flowHtml), approved(prod, priceHtml), approved(svcPrice, priceHtml), { ...how, id: 'p4', url: SITE + 'other/', state: 'rejected' }]));
f = O.buildPackageFiles(job); mf = JSON.parse(f['MANIFEST.json']);
t('承認済み：手順と製品のファイルが入る', !!f['schema/pages/howto-p1.jsonld'] && !!f['schema/pages/product-p2.jsonld'] && JSON.parse(f['schema/pages/howto-p1.jsonld'])['@type'] === 'HowTo', Object.keys(f));
t('承認済み：サービスの価格は service.jsonld の offers に入る', (() => { const s = JSON.parse(f['schema/service.jsonld']); return Array.isArray(s.offers) && s.offers.length === 1 && s.offers[0].name === 'カット' && s.offers[0].price === 4400 && s.offers[0].url === SITE + 'price/'; })(), f['schema/service.jsonld']);
t('承認済み：MANIFEST に入れる先のページ・ファイル・承認と照合の日時', mf.page_schemas.length === 3 && mf.page_schemas[0].url === SITE + 'flow/' && mf.page_schemas[0].path === 'schema/pages/howto-p1.jsonld' && mf.page_schemas[0].approved_at && mf.page_schemas[0].checked_at && mf.page_schema_counts.approved === 3 && mf.page_schema_counts.rejected === 1 && mf.page_schema_counts.pending === 0, mf.page_schemas);
t('承認済み：README と WordPress の手順に、入れる先のページを書く', /ページごとのデータを入れる先/.test(f['README.md']) && f['README.md'].includes('| schema/pages/howto-p1.jsonld | 手順（HowTo・3件） | ' + SITE + 'flow/ |') && /schema\/pages フォルダのファイルは/.test(f['INSTALL_WORDPRESS.md']) && /schema\/service\.jsonld（価格つき）/.test(f['INSTALL_WORDPRESS.md']), f['README.md'].slice(0, 1500));
v = S.validatePackageFiles(clean(f), { targetUrl: SITE, industry: 'other' });
t('承認済み：ZIP の検査を通り、公開用にできる', v.ok && v.publishable, v);
t('どのファイルにも undefined・NaN・null の行が無い', Object.keys(clean(f)).every((k) => !/(^|[^A-Za-z_])(undefined|NaN)(?![A-Za-z_])/.test(f[k])) && !/\nnull\n/.test(f['README.md'] + f['INSTALL_WORDPRESS.md']));

// 承認のあとでページと合わなくなった・形が崩れたものは入れない
job = allFaqDone(mk([{ ...approved(how, flowHtml), checked: { ok: false, missing: ['x'], at: '2026-10-13T03:00:00Z' } }, { ...approved(prod, priceHtml), items: [{ name: 'カット', price: null }] }]));
f = O.buildPackageFiles(job); mf = JSON.parse(f['MANIFEST.json']);
t('承認済みでも、照合が通っていない・形が崩れたものは入れない（承認待ちに戻る）', !Object.keys(f).some((k) => /^schema\/pages\//.test(k)) && mf.page_schema_counts.pending === 2, mf.page_schema_counts);

// 飲食店：サービスの価格は入れない（service.jsonld を作らない）
job = allFaqDone(mk([approved(svcPrice, priceHtml), approved(how, flowHtml)], 'restaurant'));
f = O.buildPackageFiles(job); mf = JSON.parse(f['MANIFEST.json']);
t('飲食店：サービスの価格は入らず、手順は入る', !('schema/service.jsonld' in f) && !!f['schema/pages/howto-p1.jsonld'] && mf.page_schemas.length === 1, [Object.keys(f), mf.page_schema_counts]);

// 無料診断の下書き（confirm なし）には出ない
f = O.buildPackageFiles({ url: SITE, industry: 'other', profile: { brand: 'サンプル美容室', service: 'ヘアカット' }, keywords: [], diagnose: { page: { keywordAuto: { facts } } } });
t('無料診断の下書き：ページごとのデータは作らない', !Object.keys(f).some((k) => /^schema\/pages\//.test(k)) && JSON.parse(f['MANIFEST.json']).page_schema_counts.total === 0);

// ---- 5) ZIP の検査：承認していないファイルを紛れ込ませない・最小の ZIP にも入る ----
job = allFaqDone(mk([approved(how, flowHtml), approved(prod, priceHtml)]));
f = clean(O.buildPackageFiles(job));
v = S.validatePackageFiles({ ...f, 'schema/pages/howto-zz9.jsonld': f['schema/pages/howto-p1.jsonld'] }, { targetUrl: SITE, industry: 'other' });
t('検査：MANIFEST の一覧に無いページのファイルは不合格', !v.ok && v.errors.some((e) => /MANIFEST\.page_schemas に無い/.test(e)), v.errors);
v = S.validatePackageFiles({ ...f, 'schema/pages/howto-p1.jsonld': JSON.stringify({ '@context': 'https://schema.org', '@type': 'HowTo', name: 'x', step: [] }) }, { targetUrl: SITE, industry: 'other' });
t('検査：手順が空の HowTo は不合格', !v.ok && v.errors.some((e) => /HowTo ではありません/.test(e)), v.errors);
const fin = await O.finalizePackage(O.buildPackageFiles(job), S.MINIMAL_FILES);
const fmf = JSON.parse(fin['MANIFEST.json']);
t('最小の ZIP：ページごとのファイルも入り、MANIFEST の files に SHA-256 がある', !!fin['schema/pages/howto-p1.jsonld'] && !!fin['schema/pages/product-p2.jsonld'] && fmf.selection === 'partial' && fmf.files.some((x) => x.path === 'schema/pages/howto-p1.jsonld' && /^[0-9a-f]{64}$/.test(x.sha256)), fmf.files.map((x) => x.path));
v = S.validatePackageFiles(fin);
t('最小の ZIP：検査を通り、公開用にできる', v.ok && v.publishable, v);
t('最小の ZIP：中身の SHA-256 が MANIFEST と一致', (await S.verifyManifestHashes(fin)).ok === true);

// ---- 6) 公開したページの判定 ----
const ldTag = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
t('判定：本文があり、同じ HowTo が入っていれば ok', P.judge(how, flowHtml.replace('</body>', ldTag(hl) + '</body>')).state === 'ok', P.judge(how, flowHtml.replace('</body>', ldTag(hl) + '</body>')));
t('判定：構造化データが無ければ ng', P.judge(how, flowHtml).state === 'ng');
t('判定：本文から手順が消えていれば ng（データだけ残っていても）', P.judge(how, '<html><body><h1>ご予約の流れ</h1>' + ldTag(hl) + '</body></html>').state === 'ng');
t('判定：HowTo の手順の数が違えば要確認', P.judge(how, flowHtml.replace('</body>', ldTag({ ...hl, step: hl.step.slice(0, 2) }) + '</body>')).state === 'review');
t('判定：Product の一覧が入っていれば ok・品名が足りなければ要確認', P.judge(prod, priceHtml.replace('</body>', ldTag(pl) + '</body>')).state === 'ok' && P.judge(prod, priceHtml.replace('</body>', ldTag(one) + '</body>')).state === 'review');
t('判定：Service に価格が入っていれば ok・無ければ要確認', P.judge(svcPrice, priceHtml.replace('</body>', ldTag({ '@type': 'Service', name: 'ヘアカット', offers: [{ '@type': 'Offer', price: 4400 }] }) + '</body>')).state === 'ok' && P.judge(svcPrice, priceHtml.replace('</body>', ldTag({ '@type': 'Service', name: 'ヘアカット' }) + '</body>')).state === 'review');

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
