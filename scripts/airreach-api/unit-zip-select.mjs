// 最小の ZIP（依頼書 R07・T09）：ファイルを選ぶ・MANIFEST に形式・版・大きさ・SHA-256・展開して照合・WordPress の手順。架空のサイトだけ
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { readStoredZip, verifyFiles } from './verify-zip.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
const t = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300)}`); };
const ctx = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, URL, URLSearchParams, TextEncoder, TextDecoder, Date, JSON, Math, Promise, crypto: globalThis.crypto };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.document = { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } };
ctx.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} }; ctx.sessionStorage = ctx.localStorage;
ctx.location = { search: '', hash: '', href: '' };
vm.createContext(ctx);
for (const f of ['airreach-keyword.js', 'airreach-package-schema.js', 'airreach-orchestrator.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8'), ctx, { filename: f });
const K = ctx.AirReachKeyword, O = ctx.AirReachOrchestrator, S = ctx.AirReachPackageSchema;
const facts = K.facts({ text: '営業時間 10:00〜19:00 定休日 水曜 TEL 03-1234-5678 料金プラン 月額 30,000円（税込）', url: 'https://sample-co.example/' });
const job = { url: 'https://sample-co.example/', industry: 'other', profile: { brand: 'サンプル', service: 'Web制作' }, keywords: [], diagnose: { page: { keywordAuto: { facts } } }, completed_at: '2026-10-07T01:00:00Z', confirm: { rev: 4, entity: { company: '株式会社サンプル', brand: 'サンプル', service: 'ホームページ制作', url: 'https://sample-co.example/', at: '2026-10-07T02:00:00Z' }, faq: {} } };
const built = O.buildPackageFiles(job);
const mfq = JSON.parse(built['MANIFEST.json']).faq_items.filter((i) => i.status === 'site');
mfq.forEach((i) => { job.confirm.faq[i.q] = { state: 'approved', at: '2026-10-07T02:00:00Z' }; });
const files = O.buildPackageFiles(job);

const min = await O.finalizePackage(files, S.MINIMAL_FILES);
const mf = JSON.parse(min['MANIFEST.json']);
t('最小：設置に必要なファイルだけ（CSV・AGENT_PROMPT・VALIDATION は入れない）', !('strategy/keywords.csv' in min) && !('AGENT_PROMPT.md' in min) && !('validation/VALIDATION.md' in min) && 'content/faq.md' in min && 'schema/faq.jsonld' in min && 'public/llms.txt' in min, Object.keys(min));
t('最小：README・MANIFEST・WordPress の手順は必ず入る', ['README.md', 'MANIFEST.json', 'INSTALL_WORDPRESS.md'].every((k) => k in min));
t('MANIFEST：形式・選び方・版', mf.package_format === 'airreach-package/2' && mf.selection === 'partial' && mf.version === 4, mf);
t('MANIFEST：入れたファイルごとに大きさと SHA-256（MANIFEST 自身は除く）', mf.files.length === Object.keys(min).length - 1 && mf.files.every((x) => /^[0-9a-f]{64}$/.test(x.sha256) && x.bytes > 0), mf.files);
const v = S.validatePackageFiles(min, { targetUrl: job.url, industry: 'other' });
t('検査：最小の ZIP も構造は正しく、確定・承認済みなので公開用', v.ok && v.publishable, v);
t('検査：ハッシュの照合が通る', (await S.verifyManifestHashes(min)).ok);
// ZIP にして展開し、照合する
const zip = O._buildZip(min);
const back = readStoredZip(zip);
const r = verifyFiles(back);
t('展開して照合：大きさ・SHA-256・JSON・件数が一致', r.ok && r.files === Object.keys(min).length && r.version === 4 && r.selection === 'partial', r);
t('展開しても日本語の中身がそのまま', back['content/faq.md'] === min['content/faq.md']);
// 書き換えを見つける
const bad = Object.assign({}, back, { 'content/faq.md': back['content/faq.md'] + '\n料金は無料です' });
t('展開後に書き換えたファイルを見つける（SHA-256）', verifyFiles(bad).errors.some((e) => /content\/faq\.md/.test(e)), verifyFiles(bad));
const extra = Object.assign({}, back, { 'notes.txt': 'x' });
t('MANIFEST に無いファイルを見つける', verifyFiles(extra).errors.some((e) => /notes\.txt/.test(e)) && !S.validatePackageFiles(extra, { targetUrl: job.url }).ok);
const missing = Object.assign({}, back); delete missing['public/llms.txt'];
t('入っているはずのファイルが無いのを見つける', verifyFiles(missing).errors.some((e) => /llms\.txt/.test(e)) && (await S.verifyManifestHashes(missing)).errors.length > 0);
// すべて
const all = await O.finalizePackage(files, null);
const mfa = JSON.parse(all['MANIFEST.json']);
t('すべて：全部のファイル・selection=all・照合が通る', mfa.selection === 'all' && 'strategy/keywords.csv' in all && verifyFiles(readStoredZip(O._buildZip(all))).ok);
t('すべて：検査も通る', S.validatePackageFiles(all, { targetUrl: job.url, industry: 'other' }).ok);
// WordPress の手順
const ins = min['INSTALL_WORDPRESS.md'];
t('手順：承認済みの質問だけ載せる・二重にしない・llms.txt の場所・リッチリザルトテスト・戻し方', /承認済み」の質問だけ/.test(ins) && /二重にしない/.test(ins) && /wp-config\.php と同じ階層/.test(ins) && /リッチリザルト テスト/.test(ins) && /## 戻し方/.test(ins) && /sample-co\.example\/llms\.txt/.test(ins));
// FAQ を承認していなければ、手順は faq.jsonld を飛ばすと書く
const job0 = JSON.parse(JSON.stringify(job)); job0.confirm.faq = {};
const f0 = await O.finalizePackage(O.buildPackageFiles(job0), S.MINIMAL_FILES);
t('承認0問：faq.jsonld は入らず、手順もその手順を飛ばすと書く', !('schema/faq.jsonld' in f0) && /この手順は飛ばします/.test(f0['INSTALL_WORDPRESS.md']) && verifyFiles(readStoredZip(O._buildZip(f0))).ok);
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
