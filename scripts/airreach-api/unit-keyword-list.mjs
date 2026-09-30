/**
 * 「調べる言葉」の一覧（assets/js/airreach-keyword-list.js）の単体テスト。
 * keyword（メイン）と keywords（最大5語）の整合、旧データの読み込み、追加・削除・メイン切替。
 *   node scripts/airreach-api/unit-keyword-list.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const L = createRequire(import.meta.url)(path.join(ROOT, 'assets/js/airreach-keyword-list.js'));
const results = [];
const expect = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const pass = g === w;
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `\n      got  ${g}\n      want ${w}`}`);
};
const kw = (text, source, primary = false) => ({ text, source, primary });

// ---- 旧データ（keyword だけ）----
expect('legacy keyword → 1 legacy primary',
  L.normalize('町田 焼肉', undefined), { keyword: '町田 焼肉', keywords: [kw('町田 焼肉', 'legacy', true)] });
expect('legacy withKeywords keeps other fields',
  L.withKeywords({ id: 'abc', keyword: '町田 焼肉' }), { id: 'abc', keyword: '町田 焼肉', keywords: [kw('町田 焼肉', 'legacy', true)] });
expect('no keyword, no keywords → empty',
  L.normalize('', undefined), { keyword: '', keywords: [] });
expect('null / broken keywords are ignored',
  L.normalize('渋谷 居酒屋', 'oops'), { keyword: '渋谷 居酒屋', keywords: [kw('渋谷 居酒屋', 'legacy', true)] });

// ---- 新データ ----
const saved = [kw('町田 焼肉', 'auto', true), kw('町田 焼肉 個室', 'user'), kw('町田 焼肉 ランチ', 'gsc')];
expect('new data round-trips unchanged',
  L.normalize('町田 焼肉', saved), { keyword: '町田 焼肉', keywords: saved });
expect('keyword empty → primary flag becomes keyword',
  L.normalize('', saved).keyword, '町田 焼肉');
expect('keyword empty, no primary flag → first item',
  L.normalize('', [kw('a b', 'user'), kw('c d', 'auto')]).keyword, 'a b');
expect('keyword wins over a stale primary flag',
  L.normalize('町田 焼肉 個室', saved).keywords.map((k) => k.primary), [false, true, false]);
expect('keyword not in list → added as legacy at head',
  L.normalize('新しい 言葉', saved).keywords[0], kw('新しい 言葉', 'legacy', true));
expect('exactly one primary even if many flagged',
  L.normalize('', [kw('a', 'user', true), kw('b', 'user', true)]).keywords.filter((k) => k.primary).length, 1);

// ---- 正規化 ----
expect('whitespace / full-width space collapsed',
  L.normalize('  町田　 焼肉 ', undefined).keyword, '町田 焼肉');
expect('duplicates removed (after cleaning)',
  L.normalize('', [kw('町田 焼肉', 'auto', true), kw('町田  焼肉', 'user')]).keywords.length, 1);
expect('unknown source → legacy',
  L.normalize('', [kw('x y', 'magic', true)]).keywords[0].source, 'legacy');
expect('empty / non-string text dropped',
  L.normalize('', [kw('', 'user'), { text: 3, source: 'user' }, null, kw('ok', 'user')]).keywords.map((k) => k.text), ['ok']);
expect('text capped at 100 chars',
  L.normalize('x'.repeat(150), undefined).keyword.length, 100);

// ---- 上限5語 ----
const six = ['1', '2', '3', '4', '5', '6'].map((t) => kw('w' + t, 'user'));
expect('max 5 items',
  L.normalize('', six).keywords.length, 5);
expect('primary beyond 5th is kept (swapped into 5th)',
  L.normalize('w6', six).keywords.map((k) => k.text), ['w1', 'w2', 'w3', 'w4', 'w6']);

// ---- 追加・削除・メイン切替 ----
let s = L.normalize('', L.single('町田 焼肉', 'auto'));
expect('single(auto)', s, { keyword: '町田 焼肉', keywords: [kw('町田 焼肉', 'auto', true)] });
expect('single(empty) → []', L.single('', 'auto'), []);
s = L.add(s.keywords, '町田 焼肉 個室', 'user');
expect('add keeps current primary', s.keyword, '町田 焼肉');
expect('add appends with source', s.keywords[1], kw('町田 焼肉 個室', 'user', false));
expect('add existing text is a no-op', L.add(s.keywords, '町田 焼肉 個室', 'gsc').keywords.length, 2);
expect('add to empty list becomes primary', L.add([], 'a b', 'user').keyword, 'a b');
expect('add with makePrimary', L.add(s.keywords, 'x y', 'user', true).keyword, 'x y');
let full = L.normalize('', six.slice(0, 5));
expect('add beyond 5 is refused', L.add(full.keywords, 'w9', 'user').keywords.length, 5);
expect('setPrimary switches keyword', L.setPrimary(s.keywords, '町田 焼肉 個室').keyword, '町田 焼肉 個室');
expect('setPrimary unknown text is a no-op', L.setPrimary(s.keywords, 'nope').keyword, '町田 焼肉');
expect('remove primary → next becomes primary', L.remove(s.keywords, '町田 焼肉'), { keyword: '町田 焼肉 個室', keywords: [kw('町田 焼肉 個室', 'user', true)] });
expect('remove last → empty', L.remove([kw('a', 'user', true)], 'a'), { keyword: '', keywords: [] });
expect('SOURCES', L.SOURCES, ['auto', 'user', 'gsc', 'legacy']);

// ---- GSC のサイト（プロパティ）の読み取りと照合 ----
expect('gscProperty: domain property', L.gscProperty('sc-domain:Example-Yakiniku.test'), { property: 'sc-domain:example-yakiniku.test', scope: 'domain', host: 'example-yakiniku.test' });
expect('gscProperty: URL-prefix keeps www', L.gscProperty('https://WWW.example-yakiniku.test/menu/'), { property: 'https://WWW.example-yakiniku.test/menu/', scope: 'url_prefix', host: 'www.example-yakiniku.test' });
expect('gscProperty: bare host → https URL-prefix', L.gscProperty('example-yakiniku.test')?.host, 'example-yakiniku.test');
expect('gscProperty: default port dropped, other port kept', [L.gscProperty('https://a.test:443/')?.host, L.gscProperty('http://a.test:8080/')?.host], ['a.test', 'a.test:8080']);
expect('gscProperty: trailing dot removed', L.gscProperty('https://a.test./')?.host, 'a.test');
expect('gscProperty: invalid → null', ['', '   ', 'sc-domain:', 'sc-domain:www.a.test', 'ftp://a.test/', 'localhost', null].map((v) => L.gscProperty(v)), [null, null, null, null, null, null, null]);
expect('siteHost follows API policy (lowercase, www kept)', L.siteHost('https://WWW.Example.test:443/x'), 'www.example.test');
const cov = (p, h) => L.propertyCoversHost(L.gscProperty(p), h);
expect('domain property covers apex and www only', [cov('sc-domain:a.test', 'a.test'), cov('sc-domain:a.test', 'www.a.test'), cov('sc-domain:a.test', 'shop.a.test'), cov('sc-domain:a.test', 'a.test.evil.test'), cov('sc-domain:a.test', 'xa.test')], [true, true, false, false, false]);
expect('URL-prefix property needs exact host (www differs)', [cov('https://www.a.test/', 'www.a.test'), cov('https://www.a.test/', 'a.test'), cov('https://a.test/', 'www.a.test'), cov('http://a.test/', 'a.test')], [true, false, false, true]);

// ---- 取り込み → gscSites（サイトの記録が無い行・別サイトのページの行は使わない）----
const NOW = '2026-09-30T00:00:00.000Z';
const imported = [
  { keyword: '町田　焼肉　予約', url: 'https://www.example-yakiniku.test/', impressions: 1000, clicks: 30, position: 8, gscProperty: 'sc-domain:example-yakiniku.test' },
  { keyword: '町田 焼肉 予約', url: 'https://example-yakiniku.test/menu', impressions: 240, clicks: 8, position: 10.5, gscProperty: 'sc-domain:example-yakiniku.test' },
  { keyword: '町田 焼肉 予約', url: 'https://shop.example-yakiniku.test/', impressions: 999, clicks: 99, position: 1, gscProperty: 'sc-domain:example-yakiniku.test' },
  { keyword: '町田 焼肉 予約', url: 'https://other.test/', impressions: 777, clicks: 77, position: 1, gscProperty: 'sc-domain:example-yakiniku.test' },
  { keyword: '町田 焼肉 予約', url: '', impressions: 555, clicks: 5, position: 2, gscProperty: '' },
  { keyword: '別サイトの言葉', url: 'https://other.test/', impressions: 50, clicks: 1, position: 3, gscProperty: 'https://other.test/' },
  { keyword: 'AI計測の行', url: 'https://example-yakiniku.test/', impressions: 0, clicks: 0, position: 0 },
];
const sites = L.gscSitesFromRows(imported, 28, NOW);
expect('gscSitesFromRows: one entry per property', sites.map((x) => [x.property, x.scope, x.host]), [['sc-domain:example-yakiniku.test', 'domain', 'example-yakiniku.test'], ['https://other.test/', 'url_prefix', 'other.test']]);
expect('gscSitesFromRows: rows for other hosts / no property dropped, impressions summed', sites[0].keywords.map((k) => [k.query, k.impressions, k.clicks]), [['町田 焼肉 予約', 1240, 38]]);
expect('gscSitesFromRows: position weighted by impressions', Math.round(sites[0].keywords[0].position * 100) / 100, Math.round(((8 * 1000 + 10.5 * 240) / 1240) * 100) / 100);
expect('gscSitesFromRows: no property anywhere → []', L.gscSitesFromRows([{ keyword: 'x', impressions: 5 }], 28, NOW), []);
expect('mergeGscSites: same property replaced, others kept', L.mergeGscSites([{ property: 'p1', v: 'old' }, { property: 'p2' }], [{ property: 'p1', v: 'new' }]).map((x) => [x.property, x.v]), [['p1', 'new'], ['p2', undefined]]);

// ---- gscFromBaseline: 診断したサイトと同じサイトのデータだけ ----
const kws = [kw('町田 焼肉 おすすめ', 'user', true), kw('町田 個室 焼肉', 'auto'), kw('町田 焼肉 予約', 'auto')];
const baseline = { periodDays: 28, source: 'GSC CSV', keywords: [{ query: '町田 焼肉 予約', impressions: 9999, clicks: 9, position: 1 }], gscSites: sites };
expect('gscFromBaseline: no baseline → null', L.gscFromBaseline(null, 'https://example-yakiniku.test/'), null);
expect('gscFromBaseline: legacy baseline (keywords, no gscSites) → null', L.gscFromBaseline({ keywords: baseline.keywords }, 'https://example-yakiniku.test/'), null);
expect('gscFromBaseline: legacy host field alone is not trusted', L.gscFromBaseline({ host: 'example-yakiniku.test', keywords: baseline.keywords }, 'https://example-yakiniku.test/'), null);
expect('gscFromBaseline: same site (apex) → its rows', L.gscFromBaseline(baseline, 'https://example-yakiniku.test/')?.rows[0].impressions, 1240);
expect('gscFromBaseline: same site (www under domain property) → its rows', L.gscFromBaseline(baseline, 'https://www.example-yakiniku.test/menu/')?.property, 'sc-domain:example-yakiniku.test');
expect('gscFromBaseline: other subdomain → null', L.gscFromBaseline(baseline, 'https://shop.example-yakiniku.test/'), null);
expect('gscFromBaseline: other site → only that site\'s own data', L.gscFromBaseline(baseline, 'https://other.test/')?.rows.map((r) => r.query), ['別サイトの言葉']);
expect('gscFromBaseline: unrelated site → null', L.gscFromBaseline(baseline, 'https://third.test/'), null);
expect('gscFromBaseline: tampered scope/host → ignored', L.gscFromBaseline({ gscSites: [{ ...sites[0], host: 'third.test' }] }, 'https://third.test/'), null);
expect('gscFromBaseline: bad site URL → null', L.gscFromBaseline(baseline, 'not a url'), null);

// ---- キーワード比較の「検索データ」（GSC 実測 / 正式な月間検索数 / 入力値。推定は使わない）----
const none = { gsc: null, volume: null, input: null };
let rows = L.compare(kws, {});
expect('compare without GSC: no search data at all', rows.map((r) => r.searchData), [none, none, none]);
expect('compare keeps text / source / primary', rows.map((r) => [r.text, r.source, r.primary]), [['町田 焼肉 おすすめ', 'user', true], ['町田 個室 焼肉', 'auto', false], ['町田 焼肉 予約', 'auto', false]]);
rows = L.compare(kws, { gsc: L.gscFromBaseline(baseline, 'https://example-yakiniku.test/') });
expect('compare: GSC matched (full-width spaces normalized)', { ...rows[2].searchData.gsc, position: Math.round(rows[2].searchData.gsc.position * 10) / 10 }, { impressions: 1240, clicks: 38, position: 8.5, periodDays: 28, property: 'sc-domain:example-yakiniku.test' });
expect('compare: unmatched keywords have no GSC data', [rows[0].searchData.gsc, rows[1].searchData.gsc], [null, null]);
expect('compare: GSC impressions never become a volume', rows[2].searchData.volume, null);
expect('matchKey folds full-width alnum and case', L.matchKey('ＡＢＣ　焼肉'), L.matchKey('abc 焼肉'));
rows = L.compare(kws, { volumes: [{ keyword: '町田 個室 焼肉', value: 1900, source: 'keyword_planner' }, { keyword: '町田 焼肉 予約', value: 5000, source: 'hash' }, { keyword: '町田 焼肉 おすすめ', value: 3000 }] });
expect('compare: formal volume (Keyword Planner) shown as 月間検索数 source', rows[1].searchData.volume, { value: 1900, source: 'keyword_planner', sourceLabel: 'Keyword Planner' });
expect('compare: volumes from unknown / missing sources ignored', [rows[0].searchData.volume, rows[2].searchData.volume], [null, null]);
rows = L.compare(kws, { volumeInput: 2300 });
expect('compare: user input only on the primary', rows.map((r) => r.searchData.input), [{ value: 2300 }, null, null]);
expect('compare: volumeInput null / "" / spaces is not 0', [null, '', '  '].map((v) => L.compare(kws, { volumeInput: v })[0].searchData.input), [null, null, null]);
expect('compare: GSC null clicks stay null', L.compare([kw('町田 焼肉 予約', 'user', true)], { gsc: { rows: [{ query: '町田 焼肉 予約', impressions: 3, clicks: null }], periodDays: 7 } })[0].searchData.gsc, { impressions: 3, clicks: null, position: null, periodDays: 7, property: '' });
rows = L.compare([kw('町田 焼肉 予約', 'user', true)], { gsc: L.gscFromBaseline(baseline, 'https://example-yakiniku.test/'), volumeInput: 99 });
expect('compare: GSC and user input are kept side by side', [!!rows[0].searchData.gsc, rows[0].searchData.input], [true, { value: 99 }]);
expect('compare: legacy keyword list', L.compare(L.normalize('町田 焼肉', undefined).keywords, {}).map((r) => [r.text, r.source, r.primary]), [['町田 焼肉', 'legacy', true]]);
expect('compare: empty → []', L.compare([], {}), []);
expect('compare: position 0 → null', L.compare([kw('abc 焼肉', 'user', true)], { gsc: { rows: [{ query: 'ABC 焼肉', impressions: 5, clicks: 0, position: 0 }], periodDays: 28 } })[0].searchData.gsc.position, null);

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
