// 媒体の記事向けのレビュー用パッチ（assets/js/airreach-review-package.js）と、その照合（airreach-verify.js の judgeArticle）。
// 架空の会社・架空の媒体だけ。ネットワークなし。ZIP はこのテストの中で作る（無圧縮と deflate の両方）
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ctx = { window: {}, console, URL, JSON, Math, Date, TextDecoder, TextEncoder, DecompressionStream, Blob, Response, Promise, Uint8Array, DataView, ArrayBuffer };
ctx.window.crypto = globalThis.crypto;
vm.createContext(ctx);
for (const f of ['airreach-ai3.js', 'airreach-verify.js', 'airreach-review-package.js', 'airreach-case-steps.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8'), ctx);
const V = ctx.window.AirReachVerify, R = ctx.window.AirReachReviewPkg, K = ctx.window.AirReachCaseSteps;
let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, got === undefined ? '' : JSON.stringify(got).slice(0, 500)); } };

// ---- 架空のレビュー用パッチ（3媒体） ----
const CO = '株式会社サンプル商事', VER = 'sample-review/2026.10.10.1';
const MEDIA = [
  { dir: '01_news', publisher: '架空ニュース', url: 'https://news.example/article.php?id=500', type: 'NewsArticle', op: 'add_if_no_article', cop: 'insert_before', headline: '架空の代表、店舗を広げた歩み' },
  { dir: '02_interview', publisher: '架空インタビュー', url: 'https://interview.example/articles/500/', type: 'Article', op: 'replace_existing_article', cop: 'insert_before', headline: '架空の代表インタビュー' },
  { dir: '03_review', publisher: '架空レビュー', url: 'https://review.example/reports/500/', type: 'Article', op: 'replace_existing_article', cop: 'replace_one', headline: '架空の会社の調べもの' }
];
const P1 = '架空の代表は、ブランド「サンプルプラス」を運営する' + CO + 'の代表取締役です。';
const P2 = '会社の公式情報では、店舗の運営と加盟店の経営指導が事業として案内されています。';
const content = (m) => `<section id="airreach-company-summary"><h2>${m.publisher}の記事に登場する会社</h2><p>${P1}</p><p>${P2}</p></section>`;
const article = (m) => ({ '@context': 'https://schema.org', '@type': m.type, '@id': m.url + '#article', url: m.url, mainEntityOfPage: m.url, headline: m.headline,
  about: [{ '@type': 'Person', name: '架空の代表' }, { '@type': 'Organization', name: CO, url: 'https://sample-shoji.example/' }] });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const enc = (s) => Buffer.from(typeof s === 'string' ? s : JSON.stringify(s, null, 2), 'utf8');
function buildFiles(edit) {
  const files = {};
  for (const m of MEDIA) {
    const f = { 'CONTENT.html': enc(content(m)), 'ARTICLE.jsonld': enc(article(m)),
      'CHANGESET.json': enc({ format: 'airreach-review-changeset/1', target_url: m.url, content: { operation: m.cop, payload: 'CONTENT.html' }, structured_data: { operation: m.op, target_type: m.type, payload: 'ARTICLE.jsonld' }, apply_mode: 'manual_cms_review' }),
      'README.md': enc('架空の手順') };
    const man = { format: 'airreach-review-package/1', package_version: VER, status: 'REVIEW', target: { publisher: m.publisher, article_url: m.url, company: CO, brand: 'サンプルプラス' },
      files: Object.keys(f).sort().map((p) => ({ path: p, bytes: f[p].length, sha256: sha(f[p]) })) };
    f['MANIFEST.json'] = enc(man);
    for (const p of Object.keys(f)) files[m.dir + '/' + p] = f[p];
  }
  if (edit) edit.before && edit.before(files);
  const list = Object.keys(files).sort().map((p) => ({ path: p, bytes: files[p].length, sha256: sha(files[p]) }));
  files['MANIFEST.json'] = enc({ format: 'airreach-review-bundle/1', version: VER, status: 'REVIEW', files: list });
  if (edit) edit.after && edit.after(files);
  return files;
}
// ZIP（UTF-8 の名前・一番上のフォルダ付き）
function zip(files, deflate) {
  const locals = [], central = []; let off = 0;
  for (const name0 of Object.keys(files)) {
    const name = Buffer.from('sample_review_v1/' + name0, 'utf8'), raw = files[name0], data = deflate ? zlib.deflateRawSync(raw) : raw;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, name, data); central.push(ch, name); off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}
const ld = (o) => '<script type="application/ld+json">' + JSON.stringify(o) + '</script>';
const page = (m, body, head) => ({ url: m.url, status: 200, html: '<html><head>' + (head || '') + '</head><body><header>媒体</header><article><h1>' + m.headline + '</h1>' + body + '<p>本文（架空）</p></article></body></html>' });
const RD = (p) => ({ text: V.visibleText(p.html), complete: true, method: 'test' });
const st = (r, k) => (r.checks.find((c) => c.key === k) || {}).state;

// ---- 1. 取り込み（MANIFEST の指紋） ----
let r = await R.importZip(zip(buildFiles(), false), new Date('2026-10-10T00:00:00Z'));
t('取り込み（無圧縮）：3記事・版・会社', r.ok && r.pkg.items.length === 3 && r.pkg.version === VER && r.pkg.company === CO, r.errors);
const files0 = buildFiles();
t('MANIFEST の指紋は、実際の MANIFEST.json のバイト列の SHA-256', r.ok && r.pkg.manifest_sha256 === sha(files0['MANIFEST.json']) && r.pkg.items[0].manifest_sha256 === sha(files0['01_news/MANIFEST.json']));
const it0 = r.ok && r.pkg.items[0];
t('記事ごとに URL・会社説明の全文・記事データ・CHANGESET を持つ', it0 && it0.target_url === MEDIA[0].url && it0.content_blocks.length === 3 && it0.content_blocks[1] === P1 && JSON.parse(it0.article_jsonld)['@type'] === 'NewsArticle' && it0.changeset.structured_data.operation === 'add_if_no_article', it0);
let rz = await R.importZip(zip(buildFiles(), true));
t('取り込み（deflate の ZIP）', rz.ok && rz.pkg.manifest_sha256 === r.pkg.manifest_sha256, rz.errors);
rz = await R.importZip(zip(buildFiles({ after: (f) => { f['02_interview/CONTENT.html'] = enc(content(MEDIA[1]).replace('代表取締役', '取締役')); } })));
t('改ざん：会社説明を書き換えた ZIP は取り込まない', !rz.ok && rz.errors.some((e) => /02_interview\/CONTENT\.html/.test(e)), rz.errors);
rz = await R.importZip(zip(buildFiles({ before: (f) => { f['03_review/ARTICLE.jsonld'] = enc(article(MEDIA[0])); } })));
t('媒体の MANIFEST と中身が合わない（媒体の一覧で検出）', !rz.ok && rz.errors.some((e) => /03_review\/ARTICLE\.jsonld/.test(e)), rz.errors);
rz = await R.importZip(zip(buildFiles({ after: (f) => { f['01_news/extra.js'] = enc('alert(1)'); } })));
t('MANIFEST に無いファイルが入っていたら取り込まない', !rz.ok && rz.errors.some((e) => /extra\.js/.test(e)), rz.errors);
rz = await R.importZip(zip(buildFiles({ after: (f) => { delete f['01_news/README.md']; } })));
t('ファイルが欠けていたら取り込まない', !rz.ok && rz.errors.some((e) => /README\.md/.test(e)), rz.errors);
rz = await R.importZip(zip({ 'MANIFEST.json': enc({ format: 'airreach-package/2', files: [] }) }));
t('通常のパッチ（Studio の ZIP）は、ここでは取り込まない', !rz.ok && /レビュー用パッチの形式ではありません/.test(rz.errors[0]), rz.errors);

// ---- 2. 承認・記録・④ ----
const pkg = r.pkg, now = new Date('2026-10-20T00:00:00Z');
t('取り込んだだけでは正式版にしない', !R.official(pkg) && R.recordPublish(pkg, '01_news', '2026-10-15T01:00:00Z', MEDIA[0].url, now).ok === false);
R.approve(pkg, 'staff@sample.test', new Date('2026-10-12T00:00:00Z'));
t('承認すると正式版', R.official(pkg) && pkg.approved.manifest_sha256 === pkg.manifest_sha256);
t('今回の対象を選んでいなければ④は済まない', !R.state(pkg, now).done && /選んでいない/.test(R.state(pkg, now).why));
for (const [u, why] of [['https://www.news.example/article.php?id=500', 'www'], ['https://news.example/article.php?id=501', '記事 ID'], ['https://portal.example/news/news_500/', '転載先']]) {
  const x = R.recordPublish(pkg, '01_news', '2026-10-15T01:00:00Z', u, now);
  t('公開の記録：対象と違う URL（' + why + '）は受け付けない', !x.ok && /対象の記事の URL/.test(x.error), x);
}
t('公開の記録：対象の記事', R.recordPublish(pkg, '01_news', '2026-10-15T01:00:00Z', MEDIA[0].url, now).ok);
const good0 = page(MEDIA[0], content(MEDIA[0]), ld(article(MEDIA[0])));
let res = V.judgeArticle(pkg.items[0], good0, RD(good0));
R.recordVerify(pkg, '01_news', res, { at: '2026-10-15T02:00:00Z', url: MEDIA[0].url, final_url: MEDIA[0].url });
R.setRound(pkg, ['01_news']);
t('1記事だけを今回の対象にして、その記事が公開・照合済みなら④は済み', R.state(pkg, now).done, R.state(pkg, now));
R.setRound(pkg, ['01_news', '02_interview']);
t('2記事を対象にすると、1記事の合格だけでは済まない', !R.state(pkg, now).done && /1 \/ 2記事が未完了（架空インタビュー）/.test(R.state(pkg, now).why), R.state(pkg, now).why);
t('記事ごとに記録が分かれる（2記事目は未記録・1記事目はそのまま）', !pkg.items[1].published && pkg.items[0].published.url === MEDIA[0].url && pkg.items[0].verified.ok);
const p2 = JSON.parse(JSON.stringify(pkg)); p2.items[0].verified.final_url = 'https://news.example/article.php?id=777';
t('照合したページが転送されていたら済みにしない', !R.itemState(p2, p2.items[0], now).verified.ok && /転送/.test(R.itemState(p2, p2.items[0], now).verified.why));
const p3 = JSON.parse(JSON.stringify(pkg)); p3.items[0].verified.url = 'https://www.news.example/article.php?id=500';
t('www 付きで照合した記録は、対象の記事の照合にしない', !R.itemState(p3, p3.items[0], now).verified.ok);
const p4 = JSON.parse(JSON.stringify(pkg)); p4.items[0].verified.rule = 'verify/2026.10.09';
t('前の判定方法の記録は使わない', !R.itemState(p4, p4.items[0], now).verified.ok);
// 新しい版を取り込んだら、前の版の記録・承認は使わない
const r2 = await R.importZip(zip(buildFiles({ before: (f) => { const m = JSON.parse(f['01_news/MANIFEST.json']); m.package_version = 'sample-review/2026.10.10.2'; f['01_news/MANIFEST.json'] = enc(m); for (const d of ['02_interview', '03_review']) { const x = JSON.parse(f[d + '/MANIFEST.json']); x.package_version = 'sample-review/2026.10.10.2'; f[d + '/MANIFEST.json'] = enc(x); } } })));
const pkgNew = Object.assign({}, r2.pkg, { approved: pkg.approved, round: ['01_news'], items: r2.pkg.items.map((x, i) => Object.assign({}, x, { published: pkg.items[i].published, verified: pkg.items[i].verified })) });
t('別の版：前の承認・公開・照合の記録を新しい版の合格にしない', r2.ok && !R.official(pkgNew) && !R.state(pkgNew, now).done && !R.itemState(Object.assign({}, pkgNew, { approved: Object.assign({}, pkg.approved, { version: pkgNew.version, manifest_sha256: pkgNew.manifest_sha256 }) }), pkgNew.items[0], now).published.ok, r2.errors);

// ---- 3. 照合（judgeArticle） ----
const m0 = MEDIA[0], i0 = pkg.items[0], A0 = article(m0), C0 = content(m0);
const J = (item, p, rd) => V.judgeArticle(item, p, rd === undefined ? RD(p) : rd);
res = J(i0, good0);
t('正常：会社説明の全文・記事データが1つ・about に会社 → 合格（llms・直下の会社は求めない）', res.ok && st(res, 'content') === 'ok' && st(res, 'article') === 'ok' && st(res, 'not_required') === 'skip' && !res.checks.some((c) => c.key === 'llms' || c.key === 'org'), res.checks);
res = J(i0, page(m0, C0.replace('<p>' + P2 + '</p>', ''), ld(A0)));
t('本文の欠落：段落が1つ無い → 不合格', !res.ok && st(res, 'content') === 'ng' && /1か所/.test(res.checks[0].detail), res.checks[0]);
res = J(i0, page(m0, C0.replace(CO + 'の代表取締役', CO + 'の取締役'), ld(A0)));
t('本文の改変：1語違う → 不合格', !res.ok && st(res, 'content') === 'ng', res.checks[0]);
res = J(i0, page(m0, C0.replace('<section ', '<section hidden '), ld(A0)));
t('本文が非表示（hidden）→ 不合格（見えないところにある）', !res.ok && st(res, 'content') === 'ng' && /見えない/.test(res.checks[0].detail), res.checks[0]);
const cssHidden = page(m0, C0.replace('<section ', '<section class="sr-only" '), ld(A0));
res = J(i0, cssHidden, { text: '媒体 ' + m0.headline + ' 本文（架空）', complete: true, method: 'test' });
t('本文が CSS で見えない（描画で見えない）→ 不合格', !res.ok && st(res, 'content') === 'ng' && /見えない/.test(res.checks[0].detail), res.checks[0]);
res = J(i0, good0, null);
t('描画で確かめられない → 要確認（合格にしない）', !res.ok && res.state === 'review' && st(res, 'content') === 'review');
res = J(i0, page(m0, C0, ld(Object.assign({}, A0, { about: [{ '@type': 'Organization', name: '株式会社ちがう会社' }] }))));
t('会社違い：記事データの about の会社が別 → 不合格', !res.ok && st(res, 'article') === 'ng' && /about の会社が違います/.test(res.checks.find((c) => c.key === 'article').detail));
res = J(i0, page(m0, C0, ld(Object.assign({}, A0, { about: undefined }))));
t('about に会社が無い → 不合格', !res.ok && /about に会社/.test(res.checks.find((c) => c.key === 'article').detail));
const orig = { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: m0.headline, author: { '@type': 'Person', name: '記者' } };
res = J(i0, page(m0, C0, ld(orig) + ld(A0)));
t('重複：元の NewsArticle と新しい NewsArticle が二重 → 不合格', !res.ok && /2つあります/.test(res.checks.find((c) => c.key === 'article').detail), res.checks);
res = J(i0, page(m0, C0, ld(A0) + ld(A0)));
t('重複：同じ記事データを2回貼った → 不合格', !res.ok && /2つあります/.test(res.checks.find((c) => c.key === 'article').detail));
res = J(i0, page(m0, C0, ld(Object.assign({}, orig, { '@type': 'Article', about: A0.about }))));
t('GNA 相当（無ければ新設）：既存の Article を更新して about を足した → 合格', res.ok && /新設・既存の更新のどちらでも可/.test(res.checks.find((c) => c.key === 'article').detail), res.checks);
res = J(i0, page(m0, C0, ld({ '@context': 'https://schema.org', '@graph': [Object.assign({}, A0, { '@context': undefined })] })));
t('@graph の中の記事データも読む', res.ok, res.checks);
res = J(i0, page(m0, C0, ld(orig)));
t('既存のままで about を足していない → 不合格（新設・更新したことにしない）', !res.ok && /about に会社/.test(res.checks.find((c) => c.key === 'article').detail));
const i1 = pkg.items[1], m1 = MEDIA[1];
res = J(i1, page(m1, content(m1), ld(Object.assign({}, article(m1), { '@type': 'NewsArticle' }))));
t('置き換え（replace_existing_article）で種類が違う → 不合格', !res.ok && /種類が違います/.test(res.checks.find((c) => c.key === 'article').detail));
res = J(i1, page(m1, content(m1), ld(Object.assign({}, article(m1), { url: 'https://interview.example/articles/501/', mainEntityOfPage: undefined, '@id': undefined }))));
t('別 URL の記事データだけ → この記事の記事データが無い（不合格）', !res.ok && /この記事の記事データがありません/.test(res.checks.find((c) => c.key === 'article').detail));
res = J(i1, { url: m1.url, status: 404, html: '' });
t('ページが開けない → 不合格', !res.ok && st(res, 'page') === 'ng');

// ---- 4. 案件の5段階（③④）に反映 ----
const pk = JSON.parse(JSON.stringify(pkg)); pk.round = ['01_news'];
let cs = K.compute({ workspace: { orch: null, review: { v: 1, pkg: pk } }, runs: [], now });
t('5段階：承認したレビュー用パッチで③済み・今回の対象が照合済みなら④済み', cs.steps[2].done && cs.steps[3].done && /今回の対象 1記事すべて/.test(cs.steps[3].detail) && cs.steps[0].done, cs.steps.map((s) => [s.key, s.done, s.detail]));
pk.round = ['01_news', '03_review'];
cs = K.compute({ workspace: { review: { v: 1, pkg: pk } }, runs: [], now });
t('5段階：対象のうち1記事が未完了なら④は済まない', cs.steps[2].done && !cs.steps[3].done && /架空レビュー/.test(cs.steps[3].detail), cs.steps[3]);
const pkU = JSON.parse(JSON.stringify(pkg)); pkU.approved = null; pkU.round = ['01_news'];
cs = K.compute({ workspace: { review: { v: 1, pkg: pkU } }, runs: [], now });
t('5段階：未承認のレビュー用パッチは③にも数えない', !cs.steps[2].done && !cs.steps[3].done);

// ---- 5. Studio の ZIP の指紋は、ZIP に入れた MANIFEST.json から取る（作るときに一覧を書き足したもの） ----
const orch = fs.readFileSync(path.join(ROOT, 'assets/js/airreach-orchestrator.js'), 'utf8');
t('Studio の ZIP：正式版の指紋は ZIP に入れた MANIFEST.json（clean）から計算', /sha256Hex\(String\(\(clean && clean\['MANIFEST\.json'\]\)/.test(orch) && /saveZip\(filename, clean\); return clean;/.test(orch));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
