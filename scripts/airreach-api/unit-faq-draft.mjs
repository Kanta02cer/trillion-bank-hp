// 直す材料の FAQ 下書き：サイトから読めた事実で答えを作る・見つからない項目は推測で埋めない・検索や AI が読む形には確かな答えだけ
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
const expect = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(detail).slice(0, 400)}`); };
const store = {};
const win = { localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { href: 'https://trillion-bank.jp/', search: '', hash: '' }, addEventListener() {} };
const ctx = { window: win, console, URL, document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, readyState: 'loading' }, navigator: {}, setTimeout, clearTimeout };
win.window = win; vm.createContext(ctx);
for (const f of ['airreach-keyword.js', 'airreach-package-schema.js', 'airreach-orchestrator.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8'), ctx);
const K = win.AirReachKeyword, O = win.AirReachOrchestrator;
expect('読み込み：事実の抽出と下書きの組み立てがある', !!(K && K.facts && O && O.buildDraftFromDiagnose));

const text = 'サンプル美容室 Hana。営業時間 10:00〜19:00 定休日：毎週火曜日 TEL 03-1234-5678 FAX 03-1234-5679 〒150-0002 東京都渋谷区渋谷1-2-3 渋谷駅から徒歩5分。駐車場はございません。カット 4,400円（税込） ご予約はWebまたはお電話で承ります。';
const F = K.facts({ url: 'https://hana.example/', text, pages: [] });
expect('事実：営業時間・定休日・電話（FAX は除く）・郵便番号つき住所・駅から徒歩・駐車場なし・料金・予約', F.hours.value === '10:00〜19:00' && F.closed.value === '毎週火曜日' && F.phone.value === '03-1234-5678' && F.address.value === '〒150-0002 東京都渋谷区渋谷1-2-3' && F.access.value === '渋谷駅から徒歩5分' && F.parking.value === '駐車場なし' && F.price.value === 'カット 4,400円（税込）' && /Web/.test(F.reservation.value), JSON.stringify(F));
expect('事実：どこに書いてあったか（前後の文と URL）', /営業時間 10:00〜19:00/.test(F.hours.quote) && F.hours.url === 'https://hana.example/');
const F2 = K.facts({ text: 'お気軽にお問い合わせください。FAX 03-0000-0000' });
expect('事実：書いていない項目は入れない（FAX だけでは電話にしない）', Object.keys(F2).length === 0, JSON.stringify(F2));

const diag = { page: { keywordAuto: { facts: F, candidates: [{ modifier: '初めて', answered: true, evidence: '…初めての方も安心…', evidenceUrl: 'https://hana.example/first/' }] } } };
const files = O.buildDraftFromDiagnose({ url: 'https://hana.example/', industry: 'other', brand: 'サンプル美容室 Hana', service: '美容室', diagnose: diag });
const faq = files['content/faq.md'];
expect('FAQ：営業時間の答えはサイトの値のまま（定休日も）', /営業時間は 10:00〜19:00 です。定休日は 毎週火曜日 です。/.test(faq), faq.slice(0, 600));
expect('FAQ：行き方に住所と駐車場なしを添える', /渋谷駅から徒歩5分です。住所は 〒150-0002 東京都渋谷区渋谷1-2-3 です。駐車場はありません。/.test(faq));
expect('FAQ：答えの下に元にしたサイトの記載', /> 元にしたサイトの記載：「.*営業時間 10:00〜19:00.*」（https:\/\/hana\.example\/）/.test(faq));
expect('FAQ：関係する記載だけある質問は【確認が必要】＋その記載', /【確認が必要】サイトに「初めての方も安心」と書かれています/.test(faq));
expect('FAQ：見つからない質問は推測で埋めず【確認が必要】', /\? ?\n\n【確認が必要】サイトには書かれていませんでした/.test(faq.replace(/？/g, '?')) && !/料金は.*お安く|格安/.test(faq));
const ld = JSON.parse(files['schema/faq.jsonld']);
expect('検索・AI が読む形（faq.jsonld）には、サイトの記載から作った答えだけ（確認が必要は入れない）', ld.mainEntity.length === 4 && ld.mainEntity.every((q) => !/確認が必要/.test(q.acceptedAnswer.text)), JSON.stringify(ld.mainEntity.map((q) => q.name)));
const org = JSON.parse(files['schema/organization.jsonld']);
expect('お店の情報：電話と郵便番号はサイトの値だけ（番地は推測しない）', org.telephone === '03-1234-5678' && org.address.postalCode === '150-0002' && !org.address.streetAddress, JSON.stringify(org));
expect('サイトから読めた情報の一覧：見つからない項目は「確認が必要」', /\| 営業時間 \| 10:00〜19:00 \|/.test(files['content/site-info.md']) && /\| 支払い方法 \| \*\*確認が必要\*\*/.test(files['content/site-info.md']));
expect('手順書は日本語（作業の手順・守ること）', /## 作業の手順/.test(files['README.md']) && /推測で書き足さない/.test(files['README.md']) && !/implementation package/.test(files['README.md']));

// サイトを読めなかった（事実なし）→ すべて確認が必要・faq.jsonld は空
const empty = O.buildDraftFromDiagnose({ url: 'https://x.example/', industry: 'restaurant', brand: 'X', diagnose: {} });
expect('事実が無い → すべて【確認が必要】・faq.jsonld の質問は0', (empty['content/faq.md'].match(/^【確認が必要】/gm) || []).length === 10 && JSON.parse(empty['schema/faq.jsonld']).mainEntity.length === 0);
// 業種に合った質問
const clinic = O.buildDraftFromDiagnose({ url: 'https://c.example/', industry: 'clinic', brand: 'C', diagnose: diag })['content/faq.md'];
expect('業種：クリニックはダウンタイム・受付時間の質問', /ダウンタイム/.test(clinic) && /受付時間と休みの日/.test(clinic) && !/個室/.test(clinic));

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
