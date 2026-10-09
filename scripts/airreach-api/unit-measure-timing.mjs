// 計測の時期（assets/js/airreach-case-steps.js の timing）。架空の日付だけ
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CS = require('../../assets/js/airreach-case-steps.js');
let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, got === undefined ? '' : JSON.stringify(got)); } };
const now = new Date('2026-10-08T03:00:00Z'); // 10/8 12:00 JST
const T = (d) => CS.timing(d, now);
t('会社・サービスが未確定なら時期なし', T({ lastRunAt: '2026-09-01T00:00:00Z' }) === null);
let x = T({ entityAt: '2026-10-07T01:00:00Z' });
t('① 確定して計測なし：導入前の計測・すぐ（時期）', x.kind === 'baseline' && x.state === 'due', x);
x = T({ entityAt: '2026-09-20T01:00:00Z' });
t('① 確定から18日：遅れ', x.kind === 'baseline' && x.state === 'late' && x.days === -18, x);
x = T({ entityAt: '2026-09-01T00:00:00Z', lastRunAt: '2026-09-20T01:00:00Z' });
t('③ 前回 9/20 → 30日後の 10/20・12日後は「これから」', x.kind === 'monthly' && x.days === 12 && x.state === 'later' && CS.timingChip(x).text === '計測 10/20', [x, CS.timingChip(x)]);
x = T({ entityAt: '2026-09-01T00:00:00Z', lastRunAt: '2026-09-12T01:00:00Z' });
t('③ 4日後なら「7日以内」', x.state === 'soon' && x.days === 4 && /（4日後）/.test(CS.timingChip(x).text), x);
x = T({ entityAt: '2026-09-01T00:00:00Z', lastRunAt: '2026-09-06T01:00:00Z' });
t('③ 期日 10/6 から2日：まだ「時期」（3日までは遅れにしない）', x.state === 'due' && x.days === -2, x);
x = T({ entityAt: '2026-08-01T00:00:00Z', lastRunAt: '2026-09-01T01:00:00Z' });
t('③ 期日 10/1 から7日：遅れ', x.state === 'late' && CS.timingChip(x).text === '計測が7日遅れ', x);
x = T({ entityAt: '2026-09-01T00:00:00Z', lastRunAt: '2026-09-20T01:00:00Z', verifiedAt: '2026-09-28T01:00:00Z', verifiedOk: true });
t('② パッチを確かめた 9/28 のあと計測なし → 14日後の 10/12（効果）', x.kind === 'effect' && x.days === 4 && /効果を測る計測：10\/12/.test(CS.timingLine(x)), [x, CS.timingLine(x)]);
x = T({ entityAt: '2026-09-01T00:00:00Z', lastRunAt: '2026-10-05T01:00:00Z', verifiedAt: '2026-09-20T01:00:00Z', verifiedOk: true });
t('② 確かめたあとに測っていれば、次は毎月（10/5 から30日）', x.kind === 'monthly' && /11\/4/.test(CS.timingLine(x)), CS.timingLine(x));
x = T({ entityAt: '2026-09-01T00:00:00Z', lastRunAt: '2026-09-20T01:00:00Z', verifiedAt: '2026-09-28T01:00:00Z', verifiedOk: false });
t('入っていないところがある（ok でない）なら効果の時期にしない', x.kind === 'monthly', x);
t('お客様向け：日付と理由（遅れは出さない）', CS.timingCustomer(T({ entityAt: '2026-09-01T00:00:00Z', lastRunAt: '2026-09-20T01:00:00Z' })) === '次の計測は 10/20 ごろの予定です。毎月の計測です。'
  && CS.timingCustomer(T({ entityAt: '2026-08-01T00:00:00Z', lastRunAt: '2026-09-01T01:00:00Z' })) === '次の計測は、近日中に行います。毎月の計測です。');
// compute：時期が来たら次にやることが計測になる（①〜⑤が済んでいても）
const ws = { orch: { lastJob: { confirm: { entity: { company: 'x', service: 'y', at: '2026-08-01T00:00:00Z' } }, zipped: { at: '2026-08-10T00:00:00Z', version: '1' }, published: { at: '2026-08-11T00:00:00Z', version: '1', zipped_at: '2026-08-10T00:00:00Z', url: 'https://x.example/' }, verified: { ok: true, state: 'ok', rule: 'verify/2026.10.09', version: '1', zipped_at: '2026-08-10T00:00:00Z', at: '2026-08-12T00:00:00Z', url: 'https://x.example/' }, files: {} } } };
const runs = [{ created_at: '2026-08-05T00:00:00Z', summary: { ai3: {} } }, { created_at: '2026-09-01T00:00:00Z', summary: { ai3: {} } }];
const r = CS.compute({ workspace: ws, runs, studioHref: '', now });
t('④まで済み・前回 9/1 から37日 → 次にやることは「毎月の計測をする（7日遅れ）」（⑤ は要約だけの記録なので未確認）', r.steps[3].state === 'done' && r.next.timing && r.next.title === '毎月の計測をする（7日遅れ）' && r.next.href === '#hack2', r.next);
t('顧客のホームの枠に「計測の予定」の行', /計測の予定　毎月の計測：10\/1/.test(CS.cardHtml(r)));
const r2 = CS.compute({ workspace: ws, runs: [{ created_at: '2026-10-01T00:00:00Z', summary: { ai3: {} } }, runs[0]], studioHref: '', now });
t('時期が先なら、次にやることは今までどおり', !r2.next.timing, r2.next);
// 2026-10-09：14日後は運用の目安。公開と確認の遅い方から数える
x = T({ entityAt: '2026-09-01T00:00:00Z', lastRunAt: '2026-09-20T01:00:00Z', verifiedAt: '2026-09-28T01:00:00Z', publishedAt: '2026-09-29T01:00:00Z', verifiedOk: true });
t('効果の時期は、公開と確認の遅い方（9/29）から14日（10/13）', x.kind === 'effect' && /効果を測る計測：10\/13/.test(CS.timingLine(x)), CS.timingLine(x));
t('「14日後」は運用の目安と書き、Google が読み直す時間と断定しない', /運用の目安/.test(CS.timingLine(x)) && /保証するものではありません/.test(CS.timingLine(x)) && !/読み直す時間）/.test(CS.timingLine(x)), CS.timingLine(x));
const ws2 = JSON.parse(JSON.stringify(ws)); delete ws2.orch.lastJob.published;
const r3 = CS.compute({ workspace: ws2, runs: [{ created_at: '2026-08-05T00:00:00Z', summary: { ai3: {} } }], studioHref: '', now });
t('公開の記録が無ければ「効果を測る」時期にしない（毎月の計測）', r3.timing.kind === 'monthly', r3.timing);

// ---- レビュー（10/9）：お客様の画面も担当者側と同じ規則（DB の publish_job を publishState で判定） ----
{
  const Z = { at: '2026-09-10T00:00:00Z', version: '1.0.0', draft: false, manifest_sha256: 'aaa' };
  const P = { at: '2026-09-27T00:00:00Z', url: 'https://s.example/faq/', version: '1.0.0', zipped_at: Z.at, manifest_sha256: 'aaa' };
  const VV = { at: '2026-09-28T00:00:00Z', ok: true, state: 'ok', rule: 'verify/2026.10.09', version: '1.0.0', zipped_at: Z.at, zip_manifest_sha256: 'aaa', url: P.url, final_url: P.url };
  const D = (pj) => ({ entity_at: '2026-09-01T00:00:00Z', last_run_at: '2026-09-20T01:00:00Z', publish_job: pj });
  const both = (pj) => [CS.customerTiming(D(pj), now), CS.publishState(pj, now).done];
  let [ct, staff] = both({ zipped: Z, published: P, verified: VV });
  t('正常：お客様も担当者も「効果を測る」（公開と確認の遅い 9/28 から14日＝10/12）', ct.kind === 'effect' && staff === true && /10\/12/.test(CS.timingLine(ct)), [ct, staff]);
  [ct, staff] = both({ zipped: Object.assign({}, Z, { at: '2026-09-29T00:00:00Z', manifest_sha256: 'bbb' }), published: P, verified: VV });
  t('同じ版番号で ZIP を作り直した：お客様も担当者も効果の時期にしない（修正前はお客様だけ effect）', ct.kind === 'monthly' && staff === false, [ct.kind, staff]);
  [ct, staff] = both({ zipped: Z, published: P, verified: Object.assign({}, VV, { url: 'https://s.example/other/', final_url: 'https://s.example/other/' }) });
  t('別のページを照合：どちらも効果の時期にしない', ct.kind === 'monthly' && staff === false);
  [ct, staff] = both({ zipped: Z, published: P, verified: Object.assign({}, VV, { at: '2026-09-26T00:00:00Z' }) });
  t('公開より前の照合：どちらも効果の時期にしない', ct.kind === 'monthly' && staff === false);
  [ct, staff] = both({ zipped: Z, published: null, verified: VV });
  t('公開の記録が無い：どちらも効果の時期にしない', ct.kind === 'monthly' && staff === false);
  t('古い DB の関数（publish_job なし）：効果の時期を案内しない', CS.customerTiming({ entity_at: '2026-09-01T00:00:00Z', last_run_at: '2026-09-20T01:00:00Z', verified_ok: true, verified_at: '2026-09-28T00:00:00Z' }, now).kind === 'monthly');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
