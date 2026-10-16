/**
 * 調べる言葉の固定（assets/js/airreach-keyword-lock.js）の単体テスト。架空の会社・言葉だけ。
 *   node scripts/airreach-api/unit-keyword-lock.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const L = createRequire(import.meta.url)(path.join(ROOT, 'assets/js/airreach-keyword-lock.js'));
const results = [];
const ok = (name, cond, detail) => {
  results.push(!!cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  — ${detail || ''}`}`);
};

const items10 = [
  ['テスト整体院', '指名', 'テスト整体院について教えて'],
  ['テスト整体院 口コミ', '指名', 'テスト整体院の口コミは？'],
  ['整体 おすすめ', 'サービス', 'おすすめの整体を教えて'],
  ['骨盤矯正', 'サービス', '骨盤矯正が上手い整体院は？'],
  ['整体 渋谷', '地域', '渋谷でおすすめの整体院は？'],
  ['整体 恵比寿', '地域', '恵比寿でおすすめの整体院は？'],
  ['整体 代官山', '地域', '代官山でおすすめの整体院は？'],
  ['整体 駅近', '条件', '駅から近い整体院を教えて'],
  ['整体 土日', '条件', '土日も開いている整体院は？'],
  ['整体 女性', '条件', '女性が通いやすい整体院は？']
].map(([keyword, group, prompt]) => ({ keyword, group, prompt }));
const T0 = Date.parse('2026-10-16T03:00:00Z');

// 1. 種類の判定と目安
ok('group: seed_group を使う', L.groupOf({ text: '整体 渋谷', seed_group: '地域' }, 'テスト整体院') === '地域');
ok('group: 扱っているもの → サービス', L.groupOf({ text: '骨盤矯正', seed_group: '扱っているもの' }, '') === 'サービス');
ok('group: 会社名を含む → 指名', L.groupOf({ text: 'テスト整体院 評判' }, 'テスト整体院') === '指名');
ok('group: 分からないものは その他', L.groupOf({ text: '肩こり 原因' }, 'テスト整体院') === 'その他');
ok('balance: 10語の目安どおりなら警告なし', L.balance(items10).warnings.length === 0, JSON.stringify(L.balance(items10)));
ok('balance: 地域が足りないと警告', L.balance(items10.slice(0, 5)).warnings.some((w) => /地域の言葉が1語/.test(w)), JSON.stringify(L.balance(items10.slice(0, 5)).warnings));

// 2. 固定できないとき
ok('validate: 11語は断る', L.validate(items10.concat([{ keyword: '整体 夜', group: '条件', prompt: '夜も開いている整体院は？' }])).some((e) => /10 語まで/.test(e)));
ok('validate: 同じ言葉', L.validate([items10[0], Object.assign({}, items10[0], { prompt: '別の質問' })]).some((e) => /同じ言葉/.test(e)));
ok('validate: 同じ質問', L.validate([items10[0], Object.assign({}, items10[1], { prompt: items10[0].prompt })]).some((e) => /同じ質問/.test(e)));
ok('validate: 空の質問', L.validate([Object.assign({}, items10[0], { prompt: ' ' })]).some((e) => /質問が空/.test(e)));
ok('validate: Search Console 由来の言葉は断る', L.validate([Object.assign({}, items10[0], { google: true })]).some((e) => /Search Console/.test(e)));
{
  const st = { prompts: [] };
  const r = L.apply(st, items10, { now: T0 });
  ok('apply: お客様に確認した日が無いと固定しない', !r.ok && r.errors.some((e) => /確認した日/.test(e)) && !st.kwLock, JSON.stringify(r));
}

// 3. 固定すると、言葉ごとに質問が1つ・毎月測る質問はその10問だけ。ほかの質問は候補に回す
const st = { profile: { brand: 'テスト整体院' }, prompts: [
  { id: 'c1', text: 'お客様の質問：骨盤矯正は痛い？', on: true, src: 'customer', confirmed: true },
  { id: 'k1', text: 'おすすめの整体を教えて', on: true, src: 'keyword', confirmed: true }
] };
{
  const r = L.apply(st, items10, { now: T0, clientConfirmedOn: '2026-10-15' });
  ok('apply: 固定できる', r.ok, JSON.stringify(r.errors));
  const on = st.prompts.filter((p) => p.on !== false);
  ok('prompts: 毎月測るのは固定した10問だけ', on.length === 10 && on.every((p) => p.locked && p.confirmed === true && p.src === 'locked'), JSON.stringify(on));
  ok('prompts: 言葉と質問が1対1', on.map((p) => p.kw).join('|') === items10.map((x) => x.keyword).join('|') && on.map((p) => p.text).join('|') === items10.map((x) => x.prompt).join('|'));
  ok('prompts: 同じ質問は二重にしない・ほかは候補', st.prompts.length === 11 && st.prompts[10].id === 'c1' && st.prompts[10].on === false, JSON.stringify(st.prompts.slice(10)));
  ok('history: 固定の記録', st.kwLock.history.length === 1 && st.kwLock.history[0].kind === 'lock' && st.kwLock.history[0].clientConfirmedOn === '2026-10-15');
}

// 4. 変えるのは3か月に1回まで・理由が要る・例外は理由付きで記録
{
  const day = 86400000;
  const swapped = items10.slice(0, 9).concat([{ keyword: '整体 夜', group: '条件', prompt: '夜も開いている整体院は？' }]);
  const same = L.apply(st, items10, { now: T0 + 200 * day, clientConfirmedOn: '2027-05-04', reason: '見直し' });
  ok('change: 何も変わらないときは記録しない', !same.ok && same.errors.some((e) => /変わっていません/.test(e)) && st.kwLock.history.length === 1, JSON.stringify(same));
  const a = L.apply(st, swapped, { now: T0 + 30 * day, clientConfirmedOn: '2026-11-14', reason: '' });
  ok('change: 理由が無いと変えない', !a.ok && a.errors.some((e) => /理由/.test(e)));
  const b = L.apply(st, swapped, { now: T0 + 30 * day, clientConfirmedOn: '2026-11-14', reason: '夜の営業を始めた' });
  ok('change: 90日たつ前は変えない（次に変えられる日を出す）', !b.ok && b.errors.some((e) => /3か月に1回まで.*2027-01-14/.test(e)), JSON.stringify(b.errors));
  ok('change: 変えなかったときは前のまま', st.kwLock.items[9].keyword === '整体 女性');
  const c = L.apply(st, swapped, { now: T0 + 30 * day, clientConfirmedOn: '2026-11-14', reason: '夜の営業を始めた', exception: true });
  ok('change: 例外なら変えられる', c.ok, JSON.stringify(c.errors));
  const h = st.kwLock.history[1];
  ok('change: 記録（例外・足した・外した・理由）', h.kind === 'change' && h.exception === true && h.added.join() === '整体 夜' && h.removed.join() === '整体 女性' && h.reason === '夜の営業を始めた', JSON.stringify(h));
  ok('change: 固定した日は最初のまま', st.kwLock.lockedAt === new Date(T0).toISOString());
  ok('change: 90日はその変更から数え直す', L.changeAllowed(st.kwLock, T0 + 100 * day).ok === false && L.changeAllowed(st.kwLock, T0 + 120 * day).ok === true);
  const d = L.apply(st, swapped.map((x, i) => (i === 0 ? Object.assign({}, x, { prompt: 'テスト整体院はどんな整体院？' }) : x)), { now: T0 + 121 * day, clientConfirmedOn: '2027-02-14', reason: '質問の言い方をお客様と直した' });
  ok('change: 90日後は例外なしで変えられる・質問の直しも記録', d.ok && st.kwLock.history[2].exception === false && st.kwLock.history[2].promptChanged.join() === 'テスト整体院', JSON.stringify(st.kwLock.history[2]));
  ok('prompts: 変えたあとも毎月測るのは固定した10問', st.prompts.filter((p) => p.on !== false).length === 10 && st.prompts.filter((p) => p.locked).map((p) => p.kw).includes('整体 夜') && !st.prompts.some((p) => p.locked && p.kw === '整体 女性'));
}

// 5. 計測 API に送る形：固定した言葉は keyword に元の言葉を入れる（記録で言葉と質問がつながる）
{
  const ctx = { console, URL, window: null };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/airreach-google-guard.js'), 'utf8'), ctx, { filename: 'airreach-google-guard.js' });
  const G = ctx.AirReachGoogleGuard;
  const p = G.toApiPrompt(st.prompts[4]);
  ok('api: 言葉と質問を分けて送る', p.keyword === '整体 渋谷' && p.prompt === '渋谷でおすすめの整体院は？' && p.confirmed === true && p.origin === 'locked', JSON.stringify(p));
  const q = G.toApiPrompt({ text: '手で足した質問', confirmed: true, src: 'manual' });
  ok('api: 固定していない質問は今までどおり', q.keyword === '手で足した質問' && q.prompt === '手で足した質問');
  const pick = G.sendablePrompts(st.prompts, G.ctxOf(st, null));
  ok('api: 送れる質問は固定した10問', pick.send.length === 10, JSON.stringify(pick));
}

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
