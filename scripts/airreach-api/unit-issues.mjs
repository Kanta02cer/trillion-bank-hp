// この案件の課題（assets/js/airreach-issues.js）の純粋な部分。架空のデータだけ
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ctx = { window: {}, console, URL, JSON, Math, Date };
vm.createContext(ctx);
for (const f of ['airreach-ai3.js', 'airreach-case-steps.js', 'airreach-issues.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8'), ctx);
const I = ctx.window.AirReachIssues;
let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, got === undefined ? '' : JSON.stringify(got).slice(0, 300)); } };
const iss = [
  { id: 'a', title: '公式サイトが出典にならない', status: 'in_progress', rank: 2, cause: 'データが無い', created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:00Z' },
  { id: 'b', title: '縮毛矯正の質問で名前が出ない', status: 'waiting_client', rank: 1, cause: '料金が無い', created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-08T00:00:00Z', evidence: { aio: { x: 2, n: 9, measured_on: '2026-10-07' } } },
  { id: 'c', title: '概要が出ない質問', status: 'watch', rank: 3, created_at: '2026-10-08T00:00:00Z' },
  { id: 'd', title: '解決した課題', status: 'done', rank: 1, created_at: '2026-10-01T00:00:00Z' },
  { id: 'e', title: '未着手の課題', status: 'open', rank: 4, created_at: '2026-10-08T00:00:00Z' }];
t('並び：判断待ち → 対応中 → 未着手 → 様子見 → 解決', I.sorted(iss).map((x) => x.id).join('') === 'baecd', I.sorted(iss).map((x) => x.id));
let h = I.homeHtml(iss, 'C1');
t('ホーム：解決していない課題の数（4つ）と上から3つ', /この案件の課題（4つ）/.test(h) && (h.match(/class="ais-row/g) || []).length === 3 && !/解決した課題/.test(h) && h.indexOf('縮毛矯正') < h.indexOf('公式サイト'));
t('ホーム：課題の画面へのリンク', /href="#\/c\/C1\/issues"/.test(h));
t('ホーム：課題が無いときは書くよう案内', /まだ課題を書いていません/.test(I.homeHtml([], 'C1')) && /課題を書く/.test(I.homeHtml([], 'C1')));
t('ホーム：表が無い（DB 未適用）ときは何も出さない', I.homeHtml(null, 'C1') === '');
const l = I.listHtml(iss);
t('一覧：4つの欄・状態・種類・件数', /何が起きているか/.test(l) && /なぜ（根拠）/.test(l) && /直すこと/.test(l) && /どう確かめるか/.test(l) && /お客様の判断待ち 1/.test(l) && (l.match(/class="ais-card is-/g) || []).length === 5);
t('一覧：書いたときの数字（AI による概要 2 / 9回・10/7）', /書いたときの数字：AI による概要 2 \/ 9回（10\/7 の計測）/.test(l));
t('一覧：表が無いときは準備中', /まだデータベースにありません/.test(I.listHtml(null)));
t('一覧：お客様には見えないと明記', /お客様には見えません/.test(l));
const x = I.listHtml([{ id: 'z', title: '<img src=x onerror=1>', status: 'open', rank: 1, symptom: '<b>x</b>' }]);
t('一覧：エスケープ', !/<img src=x/.test(x) && !/<b>x<\/b>/.test(x));
const ans = (n) => Array.from({ length: n }, (_, i) => ({ prompt: 'q' + i, engine: 'google_aio', status: 'ok', mentioned: i < 3 ? 1 : 0, conditions: { engine: 'google_aio', search: true, location: 'JP', model: 'm' } }));
const ev = I.evidenceFrom([{ id: 'r1', created_at: '2026-10-01T00:00:00Z', measured_on: '2026-10-01', summary: { answers: ans(5) } }, { id: 'r2', created_at: '2026-10-07T00:00:00Z', measured_on: '2026-10-07', summary: { answers: ans(9) } }, { id: 'r3', created_at: '2026-10-09T00:00:00Z', summary: { by: [] } }]);
t('根拠の数字：回答の記録があるいちばん新しい計測（3 / 9回・r2）', ev.aio && ev.aio.x === 3 && ev.aio.n === 9 && ev.aio.run_id === 'r2' && ev.captured_at, ev);
t('根拠の数字：計測が無ければ数字なし（日時だけ）', !I.evidenceFrom([]).aio && I.evidenceFrom([]).captured_at);
const f = I.formHtml({ title: '題', status: 'watch', kind: 'measure', rank: 3 });
t('入力欄：題・4つの欄・状態・種類・並び・既存の値', /name="title"/.test(f) && /name="symptom"/.test(f) && /name="check_how"/.test(f) && /value="watch" selected/.test(f) && /value="measure" selected/.test(f) && /value="3"/.test(f));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
