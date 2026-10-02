/**
 * 「調べた言葉」自動導出（assets/js/airreach-keyword.js）の単体テスト。
 * 入力は架空の店。実店舗名・顧客名は入れない。
 *   node scripts/airreach-api/unit-keyword.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const K = createRequire(import.meta.url)(path.join(ROOT, 'assets/js/airreach-keyword.js'));
const results = [];
const expect = (name, got, want) => {
  const pass = got === want;
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `  — got "${got}", want "${want}"`}`);
};

// 地域: 構造化データの住所。町名がタイトルにも出ていれば町名を使う
expect('structured address + town in title',
  K.derive({ title: '炭火焼肉 さくら 神楽坂店', ldAddress: ['東京都', '新宿区', '神楽坂3-1-2'] }).keyword, '神楽坂 焼肉');
// 町名がタイトルに無ければ市区町村から「区」を外す
expect('structured address, ward without 区',
  K.derive({ title: '一軒家居酒屋 はなれ', ldAddress: ['東京都渋谷区千駄ヶ谷1-2-3'] }).keyword, '渋谷 居酒屋');
// 野々市市: 市で終わる市名を削りすぎない
expect('city ending with 市 (野々市市)',
  K.derive({ title: 'ビストロ・テスト', ldAddress: ['石川県野々市市押野1-1'] }).keyword, '野々市 ビストロ');
// 府中市: 都道府県の「府」で切らない
expect('府中市 is not split by 府',
  K.derive({ title: '手打ちそば テスト | 多摩地区（府中市）のお蕎麦屋', text: '所在地 東京都府中市緑町1-2-3 定休日 月曜' }).keyword, '府中 そば');
// タイトルの市区町村は本文の住所と一致したときだけ採用（店名の「〜市」を拾わない）
expect('shop name containing 市 is ignored',
  K.derive({ title: 'そば工房 ～朝市asaichi～', text: '〒919-0000 福井県坂井市丸岡町1-2' }).keyword, '坂井 そば');
// 住所が無ければ未設定（固定語で埋めない）
expect('no address -> empty', K.derive({ title: 'そば処 テスト 公式ページ', text: '営業時間 11:00-15:00' }).keyword, '');
// 業態: タイトルで最初に出る語（辞書順ではない）
expect('genre = first in title, not lexicon order',
  K.derive({ title: 'そば処 テスト｜松戸市常盤平のそば処。うどんもあります', text: '千葉県松戸市常盤平1-2-3' }).keyword, '常盤平 そば');
// 業態: タイトルに無ければ構造化データ、それも無ければ本文3回以上
expect('genre from servesCuisine',
  K.derive({ title: 'テスト亭', ldAddress: ['北海道上川郡清水町本通1'], ldCuisine: ['そば'] }).keyword, '清水町 そば');
expect('genre from body frequency (>=3)',
  K.derive({ title: 'ホーム', text: '高知県四万十市中村1-2 インド料理 本格インド料理 インド料理のランチ' }).keyword, '四万十 インド料理');
expect('genre from body frequency (<3) -> empty',
  K.derive({ title: 'ホーム', text: '高知県四万十市中村1-2 インド料理' }).keyword, '');
// 表記ゆれの正規化
expect('鮨 -> 寿司', K.derive({ title: '築地の鮨店', text: '東京都中央区築地1-2-3' }).keyword, '築地 寿司');
// 複数店舗の印
expect('multi-store flag',
  K.derive({ title: '焼肉レストラン テスト', text: '栃木県佐野市1-1 群馬県太田市2-2 埼玉県熊谷市3-3' }).multiStore, true);
// 根拠の表示
expect('source label', K.derive({ title: '炭火焼肉 さくら 神楽坂店', ldAddress: ['東京都新宿区神楽坂3-1-2'] }).sourceLabel,
  '地域は構造化データの住所、業態はタイトルから');

// 調べそうな言葉の一覧（Studio と同じ組み立て・飲食店の付け足す言葉）
{
  const src = { title: '[公式] 炭火焼肉 さくら | 神楽坂', ldAddress: ['東京都新宿区神楽坂3-1-2'], text: 'ランチ営業 11:30〜 ご予約はこちら 個室あり 1,200円 ' + '炭火で焼き上げる国産牛の焼肉をお楽しみください。'.repeat(12) };
  const set = K.candidates(K.derive(src), src, 'restaurant', 20);
  const by = Object.fromEntries(set.map((c) => [c.text, c]));
  expect('set: base keyword first', set[0].text, '神楽坂 焼肉');
  expect('set: condition answered (個室)', by['神楽坂 焼肉 個室'].answered, true);
  expect('set: condition not answered (駐車場)', by['神楽坂 焼肉 駐車場'].answered, false);
  expect('set: not judged (おすすめ)', by['神楽坂 焼肉 おすすめ'].answered, null);
  expect('set: brand from title without 公式', K.shopName(src), '炭火焼肉 さくら');
  expect('set: brand + 予約 answered', by['炭火焼肉 さくら 予約'].answered, true);
  expect('set: size <= 20', set.length <= 20, true);
}
// 「All Rights Reserved」を予約の答えと取り違えない（2026-10-02: 更科堀井で 予約=答えあり と誤判定していた）
{
  const src = { title: '[公式] 炭火焼肉 さくら | 神楽坂', ldAddress: ['東京都新宿区神楽坂3-1-2'], text: '炭火で焼き上げる国産牛の焼肉をお楽しみください。'.repeat(12) + ' Copyright 2026 Sakura. All Rights Reserved.' };
  const set = K.candidates(K.derive(src), src, 'restaurant', 20);
  const by = Object.fromEntries(set.map((c) => [c.text, c]));
  expect('set: All Rights Reserved is not a 予約 answer', by['神楽坂 焼肉 予約'].answered, false);
  const none = K.candidates(K.derive({ title: 'ホーム', text: '' }), { title: 'ホーム', text: '' }, 'restaurant', 20);
  expect('set: no base and no brand -> empty', none.length, 0);
  expect('shopName prefers structured name', K.shopName({ ldName: 'そば処 テスト', ogSiteName: 'TEST', title: 'TOP | x' }), 'そば処 テスト');
}

// 語の一部を業態にしない
expect('サーバー is not バー', K.genreIn('クラウドサーバーの会社'), '');
expect('ジャパン is not パン', K.genreIn('〇〇ジャパン株式会社'), '');
expect('アドバイス is not アイス', K.genreIn('無料アドバイス'), '');
expect('駅のそば is not そば', K.genreIn('駅のそばにあるホテル'), '');
expect('real バー still found', K.genreIn('神楽坂のワインバー 〇〇'), 'ワインバー');
expect('real パン still found', K.genreIn('手作りパンの店'), 'パン');
expect('Bistro inside word ignored', K.genreIn('MyBistroApp'), '');

// 業種別
{
  const clinic = K.derive({ title: '【公式】テスト美容クリニック｜美容皮膚科', text: '〒220-0000 神奈川県横浜市西区1-2-3' }, 'clinic');
  expect('clinic: area + treatment', clinic.keyword, '横浜 美容皮膚科');
  const other = K.derive({ title: 'パーソナルジム テスト 渋谷店', ldAddress: ['東京都渋谷区道玄坂1-2'] }, 'other');
  expect('other: area + business', other.keyword, '渋谷 パーソナルジム');
  expect('b2b: name without 株式会社', K.derive({ title: '株式会社テスト｜クラウド会計' }, 'b2b').keyword, 'テスト');
  expect('media: name in 「」', K.derive({ title: 'IT総合情報ポータル「テストメディア」Home' }, 'media').keyword, 'テストメディア');
  expect('b2b: trailing （…） removed', K.derive({ title: 'テストSaaS（営業支援サービス）' }, 'b2b').keyword, 'テストSaaS');
  const all = K.deriveAll({ title: '株式会社テスト｜会計ソフト', text: '料金プラン 月額1,000円 導入事例' });
  expect('b2b set: 料金 answered', all.b2b.candidates.find((c) => c.modifier === '料金').answered, true);
  expect('b2b set: no area keyword', all.b2b.candidates.some((c) => c.group === 'base'), false);
  expect('restaurant unchanged in deriveAll', all.restaurant.keyword, '');
}

// 本文を読めないサイト（JavaScript で表示）は「書いていない」にしない
{
  const src = { title: 'テスト（営業支援）', text: '' };
  const set = K.deriveAll(src).b2b.candidates;
  expect('unreadable: not judged as missing', set.find((c) => c.modifier === '問い合わせ').answered, null);
  expect('unreadable: reason set', set.find((c) => c.modifier === '問い合わせ').reason, 'unreadable');
}

// 下層ページ: トップに無い答えを下層で見つけ、見つけたページを記録する
{
  const long = '炭火焼肉の店です。'.repeat(40);
  const src = { title: '炭火焼肉 テスト', ldAddress: ['東京都新宿区神楽坂1-1'], text: long,
    pages: [{ url: 'https://example.jp/access/', text: '駐車場はございません。近隣のコインパーキングをご利用ください。' + long }] };
  const set = K.candidates(K.derive(src), src, 'restaurant', 20);
  const park = set.find((c) => c.modifier === '駐車場');
  expect('subpage: answer found on subpage', park.answered, true);
  expect('subpage: evidence url recorded', park.evidenceUrl, 'https://example.jp/access/');
  const addr = K.derive({ title: 'そば処 テスト', text: long, pages: [{ url: 'https://example.jp/shop/', text: '所在地 〒270-0000 千葉県松戸市常盤平1-2-3' }] });
  expect('subpage: address found on subpage', addr.keyword, '松戸 そば');
}

// 県名と同じ名前の市（長野市・静岡市）
expect('長野市川中島町 is 長野', K.derive({ title: 'そば処 テスト', text: '〒381-2221 長野市川中島町1-2 営業時間 11時から' }).keyword, '長野 そば');
expect('静岡県静岡市 is 静岡', K.derive({ title: 'テスト寿司', text: '住所 静岡県静岡市葵区1-2-3' }).keyword, '静岡 寿司');

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
