/**
 * GA4 の「問い合わせ・予約」を、お客様ごとに決めたイベントで数える（api/google/_lib/conversion-events.js・api/google/ga4.js）の単体テスト。
 * 実際の Google・Supabase には接続しない（fetch をモックする）。架空の顧客・サイトだけ。
 *   node scripts/airreach-api/unit-ga4-events.mjs
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = async (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const E = await imp('api/google/_lib/conversion-events.js');
const ga4 = (await imp('api/google/ga4.js')).default;
const { cookieNames } = await imp('api/google/_lib/token.js');
const { ga4Host } = await imp('api/google/_lib/host.js');

const results = [];
const expect = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(detail).slice(0, 400)}`); };

// ---- 1. イベント名の決まり ----
expect('normalize: 正しい名前だけ・重複なし', JSON.stringify(E.normalizeEvents(['generate_lead', 'form_submit', 'generate_lead', '1bad', 'has space', 'x'.repeat(41), '', null])) === JSON.stringify(['generate_lead', 'form_submit']));
expect('normalize: 10個まで', E.normalizeEvents(Array.from({ length: 12 }, (_, i) => 'ev_' + i)).length === 10);
expect('normalize: 配列でなければ空', E.normalizeEvents('generate_lead').length === 0);
{
  const rows = [
    { dimensionValues: [{ value: 'www.test-shop.example' }, { value: 'generate_lead' }], metricValues: [{ value: '4' }] },
    { dimensionValues: [{ value: 'test-shop.example' }, { value: 'form_submit' }], metricValues: [{ value: '3' }] },
    { dimensionValues: [{ value: 'other.example' }, { value: 'generate_lead' }], metricValues: [{ value: '50' }] },
    { dimensionValues: [{ value: 'test-shop.example' }, { value: 'page_view' }], metricValues: [{ value: '900' }] }
  ];
  const t = E.sumEventRows(rows, 'test-shop.example', ['generate_lead', 'form_submit'], ga4Host);
  // ホストは訪問の合計と同じ決まり（www の有無も区別する）
  expect('sum: 対象ホストの決めたイベントだけ（www 違い・別ホスト・別イベントは入れない）', t.total === 3 && t.byEvent.generate_lead === 0 && t.byEvent.form_submit === 3, JSON.stringify(t));
  const b = E.eventReportBody('2026-09-01', '2026-09-30', ['generate_lead']);
  expect('report: イベント名で絞る', b.dimensionFilter.filter.fieldName === 'eventName' && b.dimensionFilter.filter.inListFilter.values[0] === 'generate_lead' && b.metrics[0].name === 'eventCount');
}

// ---- 2. 設定はサーバーが DB から読む（鍵はヘッダーだけ・応答に出さない）----
const CLIENT = '59824617-70f0-4a9d-a52e-d6353910f3e5';
const ENV = { SUPABASE_URL: 'https://sb.test', SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key' };
{
  let seen = null;
  const f = async (u, init) => { seen = { u: String(u), h: init.headers }; return { ok: true, json: async () => [{ ga4: ['generate_lead', 'bad name'] }] }; };
  const r = await E.loadConversionEvents(CLIENT, ENV, f);
  expect('load: 決めたイベントを読む（正しい名前だけ）', r.loaded && JSON.stringify(r.events) === '["generate_lead"]', JSON.stringify(r));
  expect('load: この顧客の行だけ・必要な項目だけ読む', /studio_workspaces\?select=ga4:data->studio->ga4Events&client_id=eq\.59824617/.test(seen.u) && !/service-role/.test(seen.u), seen.u);
  expect('load: 鍵はヘッダーだけ', seen.h.apikey === 'service-role-test-key');
  const none = await E.loadConversionEvents(CLIENT, ENV, async () => ({ ok: true, json: async () => [] }));
  expect('load: 行が無ければ空（読めた）', none.loaded && none.events.length === 0);
  const fail = await E.loadConversionEvents(CLIENT, ENV, async () => ({ ok: false, json: async () => ({}) }));
  expect('load: 読めなければ空（読めなかった）', !fail.loaded && fail.events.length === 0);
  const bad = await E.loadConversionEvents('not-a-uuid', ENV, async () => { throw new Error('呼ばない'); });
  expect('load: 顧客の ID が正しくなければ読まない', !bad.loaded);
}

// ---- 3. 取り込み（summaryOnly）：決めたイベントがあればその回数、無ければキーイベントの合計。どちらかを記録に残す ----
process.env.SUPABASE_URL = ENV.SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = ENV.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_ANON_KEY = 'anon-test-key';
const STAFF = 'staff-token-0123456789abcdef';
let cfg = null, saved = null, calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push(u);
  if (u === 'https://sb.test/rest/v1/rpc/airreach_google_access') return { ok: true, status: 200, json: async () => ({ allowed: true, role: 'staff' }) };
  if (u.startsWith('https://sb.test/rest/v1/studio_workspaces')) return { ok: true, status: 200, json: async () => (cfg ? [{ ga4: cfg }] : []) };
  if (u === 'https://sb.test/rest/v1/rpc/airreach_save_google_traffic') { saved = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ ok: true }) }; }
  if (/analyticsdata\.googleapis\.com/.test(u)) {
    const b = JSON.parse(init.body);
    if (b.dimensionFilter) return { ok: true, status: 200, json: async () => ({ rows: [
      { dimensionValues: [{ value: 'test-shop.example' }, { value: 'generate_lead' }], metricValues: [{ value: '6' }] },
      { dimensionValues: [{ value: 'other.example' }, { value: 'generate_lead' }], metricValues: [{ value: '40' }] }
    ] }) };
    return { ok: true, status: 200, json: async () => ({ rows: [
      { dimensionValues: [{ value: 'test-shop.example' }, { value: 'google' }], metricValues: [{ value: '100' }, { value: '25' }] },
      { dimensionValues: [{ value: 'test-shop.example' }, { value: 'chatgpt.com' }], metricValues: [{ value: '10' }, { value: '2' }] }
    ] }) };
  }
  return { ok: false, status: 599, json: async () => ({}) };
};
const n = cookieNames(CLIENT);
const req = (body) => ({ method: 'POST', query: { client: CLIENT }, body: Object.assign({ clientId: CLIENT, propertyId: '123456789', siteUrl: 'https://test-shop.example/', startDate: '2026-09-01', endDate: '2026-09-30', summaryOnly: true }, body || {}),
  headers: { host: 'trillion-bank.jp', 'x-forwarded-proto': 'https', authorization: 'Bearer ' + STAFF, cookie: `${n.access}=AT` } });
const mkRes = () => { const r = { statusCode: 200, headers: {} }; r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (o) => { r.body = o; return r; }; r.end = () => {}; return r; };
{
  cfg = ['generate_lead']; calls = [];
  const res = mkRes(); await ga4(req(), res);
  const s = res.body && res.body.summary;
  expect('handler: 決めたイベントの回数（対象ホストだけ）', res.statusCode === 200 && s.conversions === 6 && s.conversionBasis === 'events' && s.conversionsByEvent.generate_lead === 6 && s.keyEvents === 27, JSON.stringify(res.body));
  expect('handler: 応答に鍵を出さない', !/service-role|anon-test/.test(JSON.stringify(res.body)));
}
{
  cfg = null;
  const res = mkRes(); await ga4(req(), res);
  const s = res.body.summary;
  expect('handler: 決めていなければキーイベントの合計・そう記録', s.conversions === 27 && s.conversionBasis === 'all_key_events' && s.conversionEvents.length === 0, JSON.stringify(s));
}
{
  cfg = ['generate_lead']; saved = null;
  const res = mkRes(); await ga4(req({ save: true }), res);
  const m = saved && saved.p_metrics;
  expect('save: 保存する数字に数え方を残す', res.statusCode === 200 && m && m.conversions === 6 && m.conversion_basis === 'events' && m.conversion_events[0] === 'generate_lead' && m.conversions_by_event.generate_lead === 6 && m.key_events === 27, JSON.stringify(saved));
}

// ---- 4. レポートの出どころの書き方 ----
{
  const { createRequire } = await import('node:module');
  const R = createRequire(import.meta.url)(path.join(ROOT, 'assets/js/airreach-report.js'));
  expect('report: 決めたイベント', R.conversionBasisText({ source: 'ga4_api', conversion_basis: 'events', conversion_events: ['generate_lead', 'form_submit'], conversions_by_event: { generate_lead: 4, form_submit: 3 } }) === 'イベント generate_lead（4回）・form_submit（3回） の回数の合計');
  expect('report: 決めていない・古い記録', /キーイベントすべての合計（問い合わせ・予約として数えるイベントを、まだ決めていません）/.test(R.conversionBasisText({ source: 'ga4_api' })));
  expect('report: 手入力', R.conversionBasisText({ source: 'ga4_manual' }) === '担当者が入力した件数');
  const ev = R.evidenceList({ traffic: { ga4: { source: 'ga4_api', conversion_basis: 'events', conversion_events: ['generate_lead'], conversions_by_event: { generate_lead: 6 }, start_date: '2026-09-01', end_date: '2026-09-30' } } });
  expect('report: 数字の出どころに数え方', ev.some((e) => /問い合わせ・予約は イベント generate_lead（6回） の回数の合計/.test(e.detail)), JSON.stringify(ev.map((e) => e.detail)));
}

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
