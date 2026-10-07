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
t('最小：設置に必要なファイルと検証の確認表だけ（CSV・AGENT_PROMPT は入れない）', !('strategy/keywords.csv' in min) && !('AGENT_PROMPT.md' in min) && 'validation/VALIDATION.md' in min && 'content/faq.md' in min && 'schema/faq.jsonld' in min && 'public/llms.txt' in min, Object.keys(min));
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
// R06：MANIFEST の版・作成した道具の版・対象 URL、ZIP の名前
t('MANIFEST：package_version（1.版.0）・generator_version・target_url', mf.package_version === '1.4.0' && /^airreach-studio\//.test(mf.generator_version) && mf.target_url === job.url && 'client_id' in mf && 'query_set_version' in mf, mf);
t('ZIP の名前：airreach-ドメイン-日付-v版.zip', /^airreach-sample-co\.example-\d{8}-v1\.4\.0\.zip$/.test(O.packageFilename({ url: job.url, files })), O.packageFilename({ url: job.url, files }));
// R02：llms-full の FAQ は承認した質問だけ
const lf = files['public/llms-full.txt'];
const job1 = JSON.parse(JSON.stringify(job)); job1.confirm.faq = { [mfq[0].q]: { state: 'approved', at: '2026-10-07T02:00:00Z' } };
const lf1 = O.buildPackageFiles(job1)['public/llms-full.txt'];
t('llms-full：承認した質問だけ（1問承認なら1問）', (lf1.split('## FAQ')[1] || '').split('\n').filter((l) => /^- /.test(l)).length === 1 && lf1.includes(mfq[0].q) && !lf1.includes(mfq[1].q), lf1);
const job0b = JSON.parse(JSON.stringify(job)); job0b.confirm.faq = {};
t('llms-full：承認0問なら FAQ の節を出さない', !/## FAQ/.test(O.buildPackageFiles(job0b)['public/llms-full.txt']));
// R08：鍵・不要ファイル・危険なパス・実行ファイル・他のドメインのメール
const base = Object.assign({}, min);
const errOf = (extra) => S.validatePackageFiles(Object.assign({}, base, extra), { targetUrl: job.url, industry: 'other' });
t('鍵（sk-…）が入っていれば誤り', errOf({ 'content/faq.md': base['content/faq.md'] + '\nsk-proj-' + 'A'.repeat(30) }).errors.some((e) => /API キー/.test(e)));
t('Google の API キー・JWT・秘密鍵・環境変数名も誤り', ['AIza' + 'B'.repeat(35), 'eyJ' + 'a'.repeat(12) + '.' + 'b'.repeat(12) + '.' + 'c'.repeat(12), '-----BEGIN ' + 'PRIVATE KEY-----', 'SUPABASE_SERVICE_ROLE_KEY'].every((x) => !S.validatePackageFiles(Object.assign({}, base, { 'README.md': base['README.md'] + '\n' + x }), { targetUrl: job.url }).ok));
t('.DS_Store・__MACOSX は誤り', !errOf({ '.DS_Store': 'x' }).ok && !errOf({ '__MACOSX/a': 'x' }).ok);
t('危険なパス（../・絶対パス）は誤り', !errOf({ '../evil.txt': 'x' }).ok && !errOf({ '/etc/passwd': 'x' }).ok);
t('実行できるファイル（.sh・.php・.exe）は誤り', !errOf({ 'run.sh': 'x' }).ok && !errOf({ 'a.php': 'x' }).ok && !errOf({ 'b.exe': 'x' }).ok);
const mailv = errOf({ 'content/faq.md': base['content/faq.md'] + '\n連絡先 other.person@rival-company.co.jp' });
t('対象のサイト以外のメールアドレスは警告（伏せ字）・止めない', mailv.warnings.some((w) => /以外のメールアドレス/.test(w) && !/other\.person/.test(w)) && !mailv.errors.some((e) => /メール/.test(e)), mailv.warnings);
t('対象のサイトのメールアドレスは警告しない', !errOf({ 'content/faq.md': base['content/faq.md'] + '\ninfo@sample-co.example' }).warnings.some((w) => /メール/.test(w)));
t('ふつうに作った ZIP は安全性の誤りなし', S.safetyErrors(min, { targetUrl: job.url }).length === 0 && S.safetyErrors(all, { targetUrl: job.url }).length === 0, S.safetyErrors(all, { targetUrl: job.url }));
t('verify-zip も安全性を見る（鍵入りの ZIP を誤り）', !verifyFiles(Object.assign({}, back, { 'README.md': back['README.md'] + '\nsk-ant-' + 'C'.repeat(30) })).ok);
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
