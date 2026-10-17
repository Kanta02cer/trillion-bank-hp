/**
 * 月次レポートの AI 下書き（assets/js/airreach-report-ai-draft.js）の単体テスト。架空の会社・数字だけ。AI には接続しない。
 *   node scripts/airreach-api/unit-report-ai-draft.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const D = createRequire(import.meta.url)(path.join(ROOT, 'assets/js/airreach-report-ai-draft.js'));
const results = [];
const ok = (name, cond, detail) => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  — ${detail || ''}`}`); };

const cmp = {
  periodMonth: '2026-10-01', first: true,
  client: { id: 'x', name: 'テスト整体院' },
  facts: ['AIの引用率（ChatGPT）：12%（前月と質問の版が違う、または前月の計測なし）'],
  aio: { now: { x: 3, n: 25 } },
  chatgpt: { now: { unmeasurable: '測定不能（有効な回答が0件）' } },
  ai: { providers: [{ provider: 'openai', answers: 25, citeCount: 3, judged: 25, citeRate: 12, mentionCount: 5, mentionRate: 20 }] },
  site: { current: { overall: 64, gaps: ['FAQ がない'] } },
  traffic: {},
  actions: [], missing: ['Search Console の数値', 'GA4 の数値']
};

// 1. 材料と指示
const m = D.material(cmp);
ok('material: 会社名・初回・AIの数字', m.会社名 === 'テスト整体院' && m.初回の計測か === true && m.AIごとの結果[0].公式サイトが出典になった回答 === 3);
ok('material: 測定不能はそのまま渡す（0 にしない）', m['ChatGPT 検索あり（名前を入れていない質問・補助）'].測定不能 === '測定不能（有効な回答が0件）');
ok('material: GSC・GA4 が無ければ「未計測」', m.検索とサイト.検索からのクリック === '未計測' && m.検索とサイト.問い合わせ・予約 === '未計測');
const p = D.prompt(cmp);
ok('prompt: 初回は比較を書かせない', /初回の計測です。前の月との比較/.test(p));
ok('prompt: 外部の数字・保証・取得手段を禁止', /業界平均/.test(p) && /保証/.test(p) && /取得の手段の名前/.test(p));
ok('prompt: 材料を含む', p.includes('"会社名": "テスト整体院"'));
ok('prompt: 2回目以降は差のある事実だけ', /差が書かれているものだけ/.test(D.prompt(Object.assign({}, cmp, { first: false }))));

// 2. 返事を読む
const reply = '```json\n{"conclusions":["改善前の基準として記録しました。Google の AI による概要では25回中3回、名前が出ました。","b","c","d"],"next_actions":[{"title":"会社の情報をAIが読み取れる形で載せる","owner":"当社","due":"2026-11-15"},{"title":"よくある質問を載せる","owner":"","due":"来月"}],"client_decisions":[]}\n```';
const r = D.parseReply(reply);
ok('parse: コードブロックの JSON を読む', r.ok && r.value.conclusions[0].startsWith('改善前の基準'), JSON.stringify(r));
ok('parse: 結論は3件まで（超えたら知らせる）', r.value.conclusions.length === 3 && r.errors.some((e) => /4件/.test(e)));
ok('parse: 期限は日付の形だけ', r.value.next_actions[0].due === '2026-11-15' && r.value.next_actions[1].due === '');
ok('parse: JSON が無い', !D.parseReply('すみません、書けません').ok);
ok('parse: 結論が空なら入れない', !D.parseReply('{"conclusions":[],"next_actions":[]}').ok);
ok('parse: 文字列だけの施策も読む', D.parseReply('{"conclusions":["a"],"next_actions":["FAQを載せる"]}').value.next_actions[0].title === 'FAQを載せる');

// 3. 材料に無い数字
ok('numbers: 材料にある数字は通す', D.unknownNumbers(r.value, cmp).length === 0, JSON.stringify(D.unknownNumbers(r.value, cmp)));
const bad = D.parseReply('{"conclusions":["業界平均は35%です。御社は25回中3回でした。"],"next_actions":[{"title":"3つの施策を11/15までに進める"}]}').value;
ok('numbers: 材料に無い数字を見つける（日付・1〜3は除く）', JSON.stringify(D.unknownNumbers(bad, cmp)) === '["35"]', JSON.stringify(D.unknownNumbers(bad, cmp)));
ok('numbers: 全角の数字も見る', JSON.stringify(D.unknownNumbers({ conclusions: ['出典は４７回'] }, cmp)) === '["47"]');

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
