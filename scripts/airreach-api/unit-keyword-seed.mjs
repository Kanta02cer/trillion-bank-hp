/**
 * キーワードの材料の取り出し（assets/js/airreach-keyword-seed.js）と、材料からの言葉づくりの単体テスト。
 * 入力はすべて架空の会社・サイト。実在の会社名・顧客名は入れない。
 *   node scripts/airreach-api/unit-keyword-seed.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const S = createRequire(import.meta.url)(path.join(ROOT, 'assets/js/airreach-keyword-seed.js'));
const results = [];
const ok = (name, cond, detail) => {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  — ${detail || ''}`}`);
};
const vals = (a) => (a || []).map((x) => x.value);
const texts = (a) => (a || []).map((x) => x.text);

// 1. 題名のキャッチコピーは会社名にもサービス名にもしない。最後の区切りが会社名
{
  const r = S.analyze({ title: '肌が変われば、毎日が変わる｜まつ毛パーマ・眉毛専門店｜テストブロウ', url: 'https://test-brow.example/' });
  ok('catchphrase is not brand', r.brand.value === 'テストブロウ', JSON.stringify(r.brand));
  ok('services from title parts', vals(r.services).join(',') === 'まつ毛パーマ,眉毛専門店', vals(r.services).join(','));
  ok('catchphrase is rejected with reason', r.rejected.some((x) => /文の形/.test(x.reason)), JSON.stringify(r.rejected));
}
// 2. 「地域の〇〇」と条件（「家具・家電付き」は1つの条件）
{
  const r = S.analyze({ title: '大阪のマンスリーマンション｜家具・家電付き・即日入居OK｜テスト住まい', url: 'https://test-sumai.example/' });
  ok('brand is last segment', r.brand.value === 'テスト住まい', r.brand.value);
  ok('service after region', vals(r.services)[0] === 'マンスリーマンション', vals(r.services).join(','));
  ok('region from 〇〇の', vals(r.regions)[0] === '大阪', vals(r.regions).join(','));
  ok('conditions merged', vals(r.conditions).join(',') === '家具家電付き,即日入居', vals(r.conditions).join(','));
  const kw = texts(S.keywords(r, 'realestate', 40));
  ok('region keyword', kw.includes('マンスリーマンション 大阪'), kw.join(' / '));
  ok('condition keyword', kw.includes('マンスリーマンション 即日入居'), kw.join(' / '));
  ok('no OK in keywords', !kw.some((t) => /OK/.test(t)), kw.join(' / '));
}
// 3. 「〇〇を目指すなら△△×個別指導 BRAND」：英字の会社名と、なら の後ろ
{
  const r = S.analyze({ title: '難関校を目指すなら高校受験×個別指導 TESTJUKU', url: 'https://testjuku.example/' });
  ok('latin brand from title', r.brand.value === 'TESTJUKU', r.brand.value);
  ok('services after なら', vals(r.services).join(',') === '高校受験,個別指導', vals(r.services).join(','));
}
// 4. 会社名の区切り（株式会社・英字・ドメイン）は読まない。「PR会社」はサービス
{
  const r = S.analyze({ title: '株式会社テストベクター｜TEST VECTOR INC.｜PR会社', url: 'https://www.testvector.example/' });
  ok('brand without 株式会社', r.brand.value === 'テストベクター', r.brand.value);
  ok('PR会社 is service', vals(r.services)[0] === 'PR会社', vals(r.services).join(','));
}
// 5. 説明文の「A・B・Cの3店舗」から地域、「〜をお探しなら」からサービス
{
  const r = S.analyze({ title: 'テストサロン｜公式サイト', metaDesc: '駅前で脱毛をお探しならテストサロン。北千住・川口・大宮の3店舗。完全個室。', url: 'https://test-salon.example/' });
  ok('regions from store list', ['北千住', '川口', '大宮'].every((x) => vals(r.regions).includes(x)), vals(r.regions).join(','));
  ok('condition 個室', vals(r.conditions).includes('個室'), vals(r.conditions).join(','));
}
// 6. メニューの案内・会社情報・お知らせの見出し・記号入りは落とす
{
  const r = S.analyze({ title: 'テスト整体院｜整体', topics: ['お部屋を探す', 'ご契約の流れ', '会社概要', '新サービスの提供開始', '骨盤矯正', '肩こり+腰痛+首', '院長紹介', '産後の骨盤ケア'], url: 'https://test-seitai.example/' });
  ok('noise topics removed', vals(r.topics).join(',') === '骨盤矯正,産後の骨盤ケア', vals(r.topics).join(','));
  ok('headline rejected', r.rejected.some((x) => x.text === '新サービスの提供開始' && /見出し/.test(x.reason)), JSON.stringify(r.rejected));
}
// 7. メディア：会社名＋とは、分野は「〇〇 ニュース」。料金・口コミを付けない
{
  const r = S.analyze({ title: 'テストニュースアジア -Test News Asia-｜アジアの今を伝えるニュースサイト', topics: ['タイ', 'ベトナム', '新着ニュース'], url: 'https://testnewsasia.example/', industry: 'media' });
  ok('media brand japanese only', r.brand.value === 'テストニュースアジア', r.brand.value);
  const kw = texts(S.keywords(r, 'media', 40));
  ok('media topic + ニュース', kw.includes('タイ ニュース'), kw.join(' / '));
  ok('media no price words', !kw.some((t) => /料金|口コミ|おすすめ/.test(t)), kw.join(' / '));
}
// 8. 業種がメディアで登録されていても、会社向けのサービスしか無ければ会社向けの言葉にする
{
  const r = S.analyze({ title: '株式会社テストPR｜PR会社', metaDesc: '戦略PR事業を主軸とする総合PR会社です。', url: 'https://test-pr.example/', industry: 'media' });
  ok('media → b2b', r.industry === 'b2b', r.industry);
  const kw = texts(S.keywords(r, 'media', 40));
  ok('b2b words', kw.includes('PR会社 比較') && !kw.some((t) => /とは$/.test(t)), kw.join(' / '));
}
// 9. 会社向け・メディアでは、本文の地名（本社・記事の地名）を地域にしない
{
  const r = S.analyze({ title: 'テストDX｜DXコンサルティング', text: '本社 渋谷 渋谷区… 渋谷オフィス', url: 'https://test-dx.example/' });
  ok('no body region for b2b', vals(r.regions).length === 0, vals(r.regions).join(','));
  const r2 = S.analyze({ title: 'テストマンスリー｜マンスリーマンション', text: '新宿の物件 新宿エリア 渋谷の物件 渋谷エリア', url: 'https://test-monthly.example/' });
  ok('body regions for local business', ['新宿', '渋谷'].every((x) => vals(r2.regions).includes(x)), vals(r2.regions).join(','));
}
// 10. 言葉の検査
ok('check: punctuation', S.checkKeyword('肌が変われば、毎日が変わる 料金') !== '');
ok('check: とは おすすめ', S.checkKeyword('とは おすすめ') !== '');
ok('check: ok keyword', S.checkKeyword('マンスリーマンション 新宿') === '');

// 11. 生成の本体（orchestrator）に材料を渡すと、材料から作った言葉だけになり、関係の薄い埋め合わせをしない
{
  const ctx = { console, setTimeout, clearTimeout, URL, Blob: function () {}, document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } }, sessionStorage: { getItem() { return null; }, setItem() {} }, localStorage: { getItem() { return null; }, setItem() {} } };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['airreach-keyword.js', 'airreach-keyword-seed.js', 'airreach-package-schema.js', 'airreach-orchestrator.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8'), ctx, { filename: f });
  const O = ctx.AirReachOrchestrator;
  const page = { title: '肌が変われば、毎日が変わる｜まつ毛パーマ・眉毛専門店｜テストブロウ', metaDesc: '北千住・川口の2店舗。', topics: ['会社概要', 'ラッシュリフト'], kwSrc: { text: '' }, ld: { blocks: [] } };
  const prof = O.profileFromDiagnose({ page }, 'https://test-brow.example/', { industry: 'clinic' });
  ok('profile brand from seed', prof.brand === 'テストブロウ', prof.brand);
  ok('profile service from seed', prof.service === 'まつ毛パーマ', prof.service);
  const seed = O._seedFromDiagnose({ page }, 'https://test-brow.example/', 'clinic', {});
  const kws = O._buildKeywords(prof.service, '', 40, {}, { industry: 'clinic', topics: page.topics, brand: prof.brand, url: 'https://test-brow.example/', seed });
  const t = kws.map((k) => k.keyword);
  ok('no catchphrase keyword', !t.some((x) => /変われば/.test(x)), t.join(' / '));
  ok('no padding words', !t.some((x) => /注意点|ポイント|期間|回数/.test(x)), t.join(' / '));
  ok('region keyword is P0', kws.some((k) => k.keyword === 'まつ毛パーマ 北千住' && k.priority === 'P0'), t.join(' / '));
  ok('seed group recorded', kws.every((k) => k.seed_group), kws.filter((k) => !k.seed_group).map((k) => k.keyword).join(','));
  // 材料が無いとき（部品を読み込まない画面など）は今までの作り方のまま
  const old = O._buildKeywords('まつ毛パーマ', '', 10, {}, { industry: 'clinic', topics: [], brand: 'テストブロウ', url: 'https://test-brow.example/' });
  ok('fallback without seed', old.length > 0 && old.every((k) => !k.seed_group), old.map((k) => k.keyword).join(','));
}

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
