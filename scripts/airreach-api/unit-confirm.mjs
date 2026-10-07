// 会社・サービスの確定と FAQ の承認（依頼書 R01・R02・R03・T05）。架空のサイトだけ・ネットワークなし
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
const t = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300)}`); };
const ctx = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, URL, URLSearchParams, TextEncoder, Date, JSON, Math, Promise };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } };
ctx.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} }; ctx.sessionStorage = ctx.localStorage;
ctx.location = { search: '', hash: '', href: 'https://trillion-bank.jp/airreach/studio/' };
vm.createContext(ctx);
for (const f of ['airreach-keyword.js', 'airreach-package-schema.js', 'airreach-orchestrator.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8'), ctx, { filename: f });
const K = ctx.AirReachKeyword, O = ctx.AirReachOrchestrator, S = ctx.AirReachPackageSchema;
const facts = K.facts({ text: '営業時間 10:00〜19:00 定休日 水曜 TEL 03-1234-5678 料金プラン 月額 30,000円（税込）', url: 'https://sample-co.example/' });
const mk = (confirm) => ({ url: 'https://sample-co.example/', industry: 'other', profile: { brand: 'サンプル', service: 'Web制作' }, keywords: [], diagnose: { page: { keywordAuto: { facts } } }, completed_at: '2026-10-07T01:00:00Z', confirm });
const parse = (files) => ({ mf: JSON.parse(files['MANIFEST.json']), ld: files['schema/faq.jsonld'] ? JSON.parse(files['schema/faq.jsonld']) : null, org: JSON.parse(files['schema/organization.jsonld']), svc: files['schema/service.jsonld'] ? JSON.parse(files['schema/service.jsonld']) : null });

// 1) 未確定・未承認（Studio の分析＝confirm あり）
let f = O.buildPackageFiles(mk({ rev: 0, entity: null, faq: {} }));
let x = parse(f);
const siteQs = x.mf.faq_items.filter((i) => i.status === 'site').map((i) => i.q);
t('前提：サイトの記載から作った答えがある', siteQs.length >= 2, siteQs);
t('未承認：faq.jsonld を出さない（承認した答えだけを入れる）', !('schema/faq.jsonld' in f) && x.mf.faq_counts.in_schema === 0 && x.mf.faq_counts.pending_approval === siteQs.length, x.mf.faq_counts);
t('未確定：MANIFEST.entity_confirmed=false・版0', x.mf.entity_confirmed === false && x.mf.entity === null && x.mf.version === 0);
t('未確定：README に「まだ確定していません」', /まだ確定していません/.test(f['README.md']));
let v = S.validatePackageFiles(Object.fromEntries(Object.entries(f).filter(([k]) => k !== '_validation')), { targetUrl: 'https://sample-co.example/', industry: 'other' });
t('未確定・承認待ち：構造は正しいが公開用にしない（publishable=false）', v.ok && !v.publishable && v.warnings.some((w) => /未確定/.test(w)) && v.warnings.some((w) => /承認待ち/.test(w)), v);
t('faq.md に承認待ちの状態', /状態：承認待ち/.test(f['content/faq.md']));

// 2) 確定＋1問承認・1問却下
const at = '2026-10-07T02:00:00.000Z';
const conf = { rev: 3, entity: { company: '株式会社サンプル', brand: 'サンプル', service: 'ホームページ制作', url: 'https://sample-co.example/', at }, faq: { [siteQs[0]]: { state: 'approved', at }, [siteQs[1]]: { state: 'rejected', at } } };
f = O.buildPackageFiles(mk(conf)); x = parse(f);
t('承認した1問だけが faq.jsonld に入る', x.ld && x.ld.mainEntity.length === 1 && x.ld.mainEntity[0].name === siteQs[0], x.ld);
t('却下した質問は faq.jsonld に入らない', !x.ld.mainEntity.some((m) => m.name === siteQs[1]));
t('確定した会社名が organization・service の提供者に入る', x.org.name === '株式会社サンプル' && x.org.alternateName === 'サンプル' && x.svc.provider.name === '株式会社サンプル' && x.svc.name === 'ホームページ制作', { org: x.org, svc: x.svc });
t('MANIFEST：確定・版3・件数（承認1・設置1）', x.mf.entity_confirmed === true && x.mf.entity.company === '株式会社サンプル' && x.mf.version === 3 && x.mf.faq_counts.approved === 1 && x.mf.faq_counts.in_schema === 1, x.mf);
t('MANIFEST：質問ごとの出典の URL・取得日・状態', x.mf.faq_items.find((i) => i.q === siteQs[0]).approval === 'approved' && x.mf.faq_items.find((i) => i.q === siteQs[1]).approval === 'rejected' && x.mf.faq_items.every((i) => 'source_url' in i && i.fetched_at === '2026-10-07T01:00:00Z'));
const readmeN = Number((/承認した答えだけ\*\*を入れています（(\d+)問）/.exec(f['README.md']) || [])[1]);
t('件数の一致：README・JSON-LD・MANIFEST', readmeN === 1 && x.ld.mainEntity.length === x.mf.faq_counts.in_schema, { readmeN });
t('README に版と確定日', /版：3/.test(f['README.md']) && /確定済みです（2026-10-07）/.test(f['README.md']));
t('faq.md に承認済み・使わない', /状態：承認済み（2026-10-07）/.test(f['content/faq.md']) && /状態：使わない（却下）/.test(f['content/faq.md']));
const pend = siteQs.length - 2;
v = S.validatePackageFiles(Object.fromEntries(Object.entries(f).filter(([k]) => k !== '_validation')), { targetUrl: 'https://sample-co.example/', industry: 'other' });
t(pend ? '確定済みでも承認待ちが残れば公開用にしない' : '確定・承認が済めば公開用', pend ? !v.publishable : v.publishable, v.warnings);
// 3) 全部承認 → 公開用
const all = JSON.parse(JSON.stringify(conf)); siteQs.forEach((q) => { all.faq[q] = { state: 'approved', at }; });
f = O.buildPackageFiles(mk(all)); x = parse(f);
v = S.validatePackageFiles(Object.fromEntries(Object.entries(f).filter(([k]) => k !== '_validation')), { targetUrl: 'https://sample-co.example/', industry: 'other' });
t('確定・全部承認：公開用（publishable）・設置用に全問', v.publishable && x.mf.faq_counts.in_schema === siteQs.length && x.mf.faq_counts.pending_approval === 0, v);
// 4) 無料診断の下書き（confirm なし）は今までどおり
f = O.buildPackageFiles(mk(undefined)); x = parse(f);
t('confirm なし（無料診断の下書き）：サイトの記載から作った答えを入れる・公開用にはしない', x.ld && x.ld.mainEntity.length === siteQs.length && x.mf.version === null && x.mf.entity_confirmed === false);
// 5) 同じ入力からは同じ中身（版・件数・本文）
const a1 = O.buildPackageFiles(mk(all)), a2 = O.buildPackageFiles(mk(all));
const strip = (fs2) => Object.fromEntries(Object.entries(fs2).filter(([k]) => k !== '_validation').map(([k, val]) => [k, k === 'MANIFEST.json' ? val.replace(/"generated_at": "[^"]+"/, '') : String(val).replace(/作成日：\d{4}-\d{2}-\d{2}/, '')]));
t('同じ確定・承認からは同じ ZIP の中身（再読み込み後も一致）', JSON.stringify(strip(a1)) === JSON.stringify(strip(a2)));
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
