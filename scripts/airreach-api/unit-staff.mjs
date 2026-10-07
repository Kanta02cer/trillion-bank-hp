// 担当者ダッシュボードの判断（assets/js/airreach-staff.js）のテスト:  node scripts/airreach-api/unit-staff.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ctx = { window: {}, console, URLSearchParams, setTimeout, clearTimeout, Promise, Date, JSON };
vm.createContext(ctx);
for (const f of ['airreach-nav.js', 'airreach-staff.js', 'airreach-report.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8'), ctx);
const S = ctx.window.AirReachStaff, R = ctx.window.AirReachReport;
let pass = 0, fail = 0;
const t = (name, ok, got) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, got === undefined ? '' : JSON.stringify(got)); } };

// ---- 期間と比較
const full9 = S.periodOf({ start_date: '2026-09-01', end_date: '2026-09-30', days: 30 }, '2026-09-01');
const part10 = S.periodOf({ start_date: '2026-10-01', end_date: '2026-10-05', days: 5 }, '2026-10-01');
const unk = S.periodOf({ clicks: 610 }, '2026-08-01');
t('全期間', full9.status === 'full' && full9.label === '9/1〜9/30（全期間）', full9);
t('途中集計（日数つき）', part10.status === 'partial' && part10.label === '10/1〜10/5（途中集計・5日間）' && part10.short === '途中集計 〜10/5', part10);
t('期間の記録が無いものは推測しない', unk.status === 'unknown' && unk.start === null && unk.label === '期間の記録なし', unk);
t('数字が無ければ期間も無い', S.periodOf(null, '2026-10-01') === null);
let c = S.compare(73, 669, part10, full9);
t('月途中と前月全体は比べない（増減を出さない）', c.mode === 'reference' && c.delta === null && /途中集計/.test(c.reason), c);
c = S.compare(700, 669, S.periodOf({ start_date: '2026-10-01', end_date: '2026-10-31' }, '2026-10-01'), full9);
t('両方が全期間なら比べる', c.mode === 'compare' && c.delta === 31, c);
c = S.compare(40, 30, part10, S.periodOf({ start_date: '2026-09-01', end_date: '2026-09-05', days: 5 }, '2026-09-01'));
t('同じ経過日数（途中集計どうし）なら比べる', c.mode === 'compare' && c.delta === 10, c);
c = S.compare(669, 610, full9, unk);
t('どちらかの期間が不明なら増減は判断しない', c.mode === 'reference' && c.delta === null && /記録がない/.test(c.reason), c);
c = S.compare(null, 669, null, full9);
t('今月が未計測なら比べない（0 にしない）', c.mode === 'none' && c.delta === null, c);
c = S.compare(0, 15, S.periodOf({ start_date: '2026-10-01', end_date: '2026-10-31' }, '2026-10-01'), full9);
t('0 は数字として比べる（未計測と区別）', c.mode === 'compare' && c.delta === -15, c);

// ---- 鮮度（ホーム93点・下書き67点）
const sc = (id, at, score) => ({ id, host: 'a.example', url: 'https://a.example/', createdAt: at, overallScore: score, gaps: [], factors: {} });
const traffic = [{ period_month: '2026-10-01', source: 'gsc_api', metrics: { clicks: 73, start_date: '2026-10-01', end_date: '2026-10-05', days: 5 } }];
const old = R.compileReport({ client: { id: 'x', name: 'X' }, periodMonth: '2026-10-01', now: new Date('2026-09-30T10:00:00Z'), scans: [sc('s1', '2026-09-30T01:00:00Z', 67)], runs: [], traffic: [], actions: [] });
const live = R.compileReport({ client: { id: 'x', name: 'X' }, periodMonth: '2026-10-01', now: new Date('2026-10-07T01:00:00Z'), scans: [sc('s1', '2026-09-30T01:00:00Z', 67), sc('s2', '2026-10-05T01:00:00Z', 93)], runs: [], traffic, actions: [] });
let f = S.freshness(old, live);
t('新しい診断があれば古いと分かる（67点→93点）', f.stale && f.changes.some(x => x.key === 'site' && x.from === '67点' && /^93点/.test(x.to)), f.changes);
t('新しい流入（途中集計）も変化として出す', f.changes.some(x => x.key === 'gsc' && x.from === '未計測' && /73回（〜10\/5）/.test(x.to)), f.changes);
t('集計した日時を出す（日本時間）', f.compiledAtLabel === '9/30 19:00', f.compiledAtLabel);
f = S.freshness(live, live);
t('同じ材料なら新しいデータは無い', !f.stale && f.changes.length === 0, f);

// ---- 「直す材料を作る」
let m = S.materialsStep([{ status: 'planned', created_at: '2026-09-20T00:00:00Z' }], '2026-10');
t('前月から残った予定だけでは今月の完了にしない', !m.ok && m.carry === 1 && m.note === '前月からの持ち越し 1件', m);
m = S.materialsStep([{ status: 'planned', created_at: '2026-10-02T00:00:00Z' }, { status: 'planned', created_at: '2026-09-20T00:00:00Z' }, { status: 'done', created_at: '2026-09-01T00:00:00Z' }], '2026-10');
t('今月登録した施策があれば「予定登録済み」（持ち越しは別に数える）', m.ok && m.thisMonth === 1 && m.carry === 1 && m.doneLabel === '予定登録済み' && m.note === '今月の登録 1件・前月からの持ち越し 1件', m);

// ---- 期限と印
let d = S.dueOf(10, '2026-10-01', '2026-10-07');
t('期限（あと3日）', d.date === '2026-10-10' && d.daysLeft === 3 && d.label === '10/10（あと3日）', d);
d = S.dueOf(31, '2026-09-01', '2026-10-02');
t('月末を超える期限日は月末にする・超過を数える', d.date === '2026-09-30' && d.daysLeft === -2 && /2日超過/.test(d.label), d);
t('期限が未設定なら作らない', S.dueOf(null, '2026-10-01', '2026-10-07') === null && S.dueOf(0, '2026-10-01', '2026-10-07') === null);
let g = S.triage({ client: { owner_email: 'a@tb.test', report_due_day: 10 }, me: 'a@tb.test', month: '2026-10-01', today: '2026-10-07', report: { status: 'draft' }, lastEvent: 'returned', runsThisMonth: 0, trafficThisMonth: ['gsc_api'], pendingRequests: 2 });
t('印：担当・期限が近い・AI未計測・Google未取得（GA4なし）・差し戻し・依頼', g.mine && g.dueSoon && !g.overdue && g.aiMissing && g.googleMissing && g.returned && g.requests === 2 && g.rank === 1, g);
g = S.triage({ client: {}, me: 'a@tb.test', month: '2026-10-01', today: '2026-10-07', report: { status: 'published' }, runsThisMonth: 1, trafficThisMonth: ['gsc_api', 'ga4_api'] });
t('担当・期限が未設定なら印を付けない（架空の担当・期限を作らない）', !g.mine && !g.ownerSet && !g.dueSet && !g.dueSoon && !g.aiMissing && !g.googleMissing && !g.returned && g.rank === 4, g);
g = S.triage({ client: { report_due_day: 5 }, month: '2026-10-01', today: '2026-10-07', report: { status: 'published' } });
t('公開済みなら期限超過にしない', !g.overdue && !g.dueSoon, g);

// ---- Studio へのリンク
const L = S.studioLink({ id: '11111111-1111-4111-8111-111111111111', name: 'サンプル', site: 'https://a.example/', industry: 'clinic' }, 'generator');
t('Studio へのリンクは顧客 ID・名前・サイト・画面を必ず含む', /client=11111111-1111-4111-8111-111111111111/.test(L) && /client_name=/.test(L) && /url=https/.test(L) && L.endsWith('#generator'), L);
t('顧客が分からないときは「顧客なし」で開く（前の顧客を使わせない）', S.studioLink(null, 'generator') === '/airreach/studio/?client=none#generator');

// ---- 自動保存（非同期）
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  let saved = [], states = [], val = { a: 1 }, backup = null, failNext = false, slow = 0;
  const as = new S.Autosave({ delay: 20, collect: () => JSON.parse(JSON.stringify(val)), onState: (s) => states.push(s),
    backup: { write: (p) => { backup = p; }, clear: () => { backup = null; } },
    save: (p) => new Promise((res, rej) => setTimeout(() => { if (failNext) { failNext = false; rej(new Error('network')); } else { saved.push(p); res(); } }, slow)) });
  val = { a: 2 }; as.changed();
  t('入力したらすぐ端末に控えを残す', backup && backup.a === 2, backup);
  await sleep(60);
  t('少し待って保存し、保存済みになる・控えを消す', saved.length === 1 && saved[0].a === 2 && as.state === 'saved' && backup === null, { saved, state: as.state, backup });
  slow = 40; val = { a: 3 }; as.changed(); await sleep(30); val = { a: 4 }; as.changed(); await sleep(30);
  await as.flush(); await sleep(60);
  t('保存中に入力が続いても、最後の入力が最後に保存される（順番が入れ替わらない）', saved[saved.length - 1].a === 4 && saved.every((x, i) => i === 0 || x.a >= saved[i - 1].a), saved);
  slow = 0; failNext = true; val = { a: 5 }; as.changed(); await sleep(60);
  t('保存に失敗したら「失敗」・入力の控えは残す', as.state === 'error' && backup && backup.a === 5 && as.dirty(), { state: as.state, backup });
  await as.flush();
  t('やり直すと保存される', saved[saved.length - 1].a === 5 && as.state === 'saved' && backup === null, { saved, state: as.state });
  const n = saved.length; await Promise.all([as.flush(), as.flush(), as.flush()]);
  t('変わっていなければ連打しても保存しない', saved.length === n, saved.length);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
