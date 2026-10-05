// 構造化データの不足判定（業種ごとに必要な項目と比べる・ページにだけ書いてある項目を示す）
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
const expect = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(detail).slice(0, 400)}`); };
const ctx = { window: {}, console }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/airreach-schema-gaps.js'), 'utf8'), ctx);
const G = ctx.window.AirReachSchemaGaps;

const ld = { blocks: [{ types: ['WebSite'], fields: { name: 'そば福', url: 'https://x/' } }, { types: ['Restaurant'], fields: { name: 'そば福', url: 'https://x/', address: '270-0022 千葉県 松戸市', servesCuisine: 'そば' } }] };
const facts = { phone: { value: '047-387-3280', quote: '…TEL. 047-387-3280…', url: 'https://x/' }, hours: { value: '11:00～21:00', quote: '営業時間：11:00～21:00', url: 'https://x/' } };
let r = G.check(ld, 'restaurant', facts);
const by = (k) => r.items.find((x) => x.key === k);
expect('飲食店：Restaurant の項目で判定（WebSite ではない）', r.mainType === 'Restaurant' && r.foundTypes.join() === 'WebSite,Restaurant', r.mainType);
expect('必要な項目：名前・住所・URL はあり', by('name').status === 'ok' && by('address').status === 'ok' && by('url').status === 'ok');
expect('電話・営業時間：構造化データに無いがページにある → on_page_only・その値で直す', by('telephone').status === 'on_page_only' && /047-387-3280/.test(by('telephone').fix) && by('openingHours').status === 'on_page_only' && by('openingHours').pageQuote === '営業時間：11:00～21:00', JSON.stringify([by('telephone'), by('openingHours')]));
expect('そろっている必要な項目 3 / 5・あるとよい項目の不足（価格帯・写真・予約）も数える', r.summary.requiredOk === 3 && r.summary.required === 5 && by('priceRange').status === 'missing' && by('priceRange').level === 'recommended', JSON.stringify(r.summary));
r = G.check({ blocks: [{ types: ['Organization'], fields: { name: 'A', url: 'https://a/', telephone: '03' } }] }, 'restaurant', {});
expect('飲食店なのに Organization だけ → 種類が合っていないと示す（判定は Organization で）', /Restaurant/.test(r.typeNote) && r.mainType === 'Organization' && r.items.find((x) => x.key === 'telephone').status === 'ok', r.typeNote);
r = G.check({ blocks: [{ types: ['WebSite'], fields: { name: 'A' } }] }, 'clinic', {});
expect('業種に合う種類が無い → すべて無い・理由つき', !r.mainType && /合う種類の構造化データがありません/.test(r.typeNote) && r.items.every((x) => x.status === 'missing'), r.typeNote);
r = G.check({ blocks: [] }, 'b2b', {});
expect('構造化データが無い → 会社向けは名前・URL・ロゴが必要', /構造化データがありません/.test(r.typeNote) && r.items.filter((x) => x.level === 'required').map((x) => x.key).join() === 'name,url,logo');
expect('ページにも無い項目は推測せず「実際の…を確かめて」', /確かめて/.test(G.check({ blocks: [] }, 'restaurant', {}).items.find((x) => x.key === 'telephone').fix));
expect('営業時間は openingHoursSpecification でもあり', G.check({ blocks: [{ types: ['Restaurant'], fields: { openingHoursSpecification: 'Mo-Fr 11:00-21:00' } }] }, 'restaurant', {}).items.find((x) => x.key === 'openingHours').status === 'ok');
const md = G.markdown(G.check(ld, 'restaurant', facts));
expect('一覧（Markdown）：見つかった種類・そろっている数・判定の根拠・直し方', /見つかった種類：WebSite、Restaurant/.test(md) && /3 \/ 5/.test(md) && /ページの記載「…TEL\. 047-387-3280…」/.test(md) && /ページに無い値を構造化データだけに書かない/.test(md));
{ const r2 = G.check({ blocks: [] }, 'restaurant', null).items.find((x) => x.key === 'telephone');
  expect('ページを確かめていない（レポート）→「ページにも見つからない」と言わない', r2.status === 'missing' && !/ページにも/.test(r2.fix) && /ページに書いてある値と同じ/.test(r2.fix), r2.fix); }
expect('知らない業種は「その他」で判定', G.check({ blocks: [] }, 'xyz', {}).industry === 'other');

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
