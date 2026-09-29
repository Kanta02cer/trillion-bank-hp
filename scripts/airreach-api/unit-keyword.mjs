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
  const src = { title: '[公式] 炭火焼肉 さくら | 神楽坂', ldAddress: ['東京都新宿区神楽坂3-1-2'], text: 'ランチ営業 11:30〜 ご予約はこちら 個室あり 1,200円' };
  const set = K.candidates(K.derive(src), src, 'restaurant', 20);
  const by = Object.fromEntries(set.map((c) => [c.text, c]));
  expect('set: base keyword first', set[0].text, '神楽坂 焼肉');
  expect('set: condition answered (個室)', by['神楽坂 焼肉 個室'].answered, true);
  expect('set: condition not answered (駐車場)', by['神楽坂 焼肉 駐車場'].answered, false);
  expect('set: not judged (おすすめ)', by['神楽坂 焼肉 おすすめ'].answered, null);
  expect('set: brand from title without 公式', K.shopName(src), '炭火焼肉 さくら');
  expect('set: brand + 予約 answered', by['炭火焼肉 さくら 予約'].answered, true);
  expect('set: size <= 20', set.length <= 20, true);
  const none = K.candidates(K.derive({ title: 'ホーム', text: '' }), { title: 'ホーム', text: '' }, 'restaurant', 20);
  expect('set: no base and no brand -> empty', none.length, 0);
  expect('shopName prefers structured name', K.shopName({ ldName: 'そば処 テスト', ogSiteName: 'TEST', title: 'TOP | x' }), 'そば処 テスト');
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
