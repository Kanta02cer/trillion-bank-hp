// 競合と比べる（SOV）: 計測 API の競合判定と、Studio の summary がレポートで読めること
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
const expect = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(detail).slice(0, 300)}`); };

const { competitorHits, nameIn, studioKeyOk, staffTokenOk } = await import(pathToFileURL(path.join(ROOT, 'api/hack2-measure.js')).href);
const comps = [{ name: '赤坂そば', url: 'https://akasaka-soba.example/' }, { name: 'Soba Lab', url: 'soba-lab.example' }];
let h = competitorHits('おすすめは赤坂そばと SOBA LAB です', ['https://www.akasaka-soba.example/menu'], comps);
expect('hits: 名前（大文字小文字を区別しない）と出典URLのホスト（www 付き）', JSON.stringify(h) === JSON.stringify([{ name: '赤坂そば', mentioned: 1, cited: 1 }, { name: 'Soba Lab', mentioned: 1, cited: 0 }]), JSON.stringify(h));
h = competitorHits('soba-lab.example が詳しい', null, comps);
expect('hits: 出典URLが無いときは本文のドメインで判定、無ければ null（0 にしない）', h[0].cited === null && h[1].cited === 1 && h[1].mentioned === 0, JSON.stringify(h));
h = competitorHits('回答', [], [{ name: 'X社', url: '' }]);
expect('hits: URL の無い競合は cited=null', h[0].cited === null && h[0].mentioned === 0, JSON.stringify(h));

h = competitorHits('総本家更科堀井 本店がおすすめ', null, [{ name: '総本家 更科堀井', url: '' }]);
expect('hits: 空白の有無（全角含む）を無視して名前を照合', h[0].mentioned === 1 && nameIn('永坂　更科', '永坂更科') && !nameIn('更科', '永坂更科'), JSON.stringify(h));

// 社内キー（AIRREACH_STUDIO_KEY）
expect('key: 未設定なら通す（従来どおり）', studioKeyOk({ headers: {} }, {}) === true);
expect('key: 設定済みでヘッダーなし → 断る', studioKeyOk({ headers: {} }, { AIRREACH_STUDIO_KEY: 'abc' }) === false);
expect('key: 一致 → 通す（カンマ区切りの2つ目でも）', studioKeyOk({ headers: { 'x-airreach-key': 'def' } }, { AIRREACH_STUDIO_KEY: 'abc, def' }) === true);
expect('key: 不一致 → 断る', studioKeyOk({ headers: { 'x-airreach-key': 'zzz' } }, { AIRREACH_STUDIO_KEY: 'abc' }) === false);

// レポート側
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/airreach-report.js'), 'utf8'), ctx);
const R = ctx.window.AirReachReport;
const studioSummary = (sov, ver) => ({ run_id: 'studio-x', query_set_version: ver, source: 'studio', competitors: ['赤坂そば'],
  by: [{ provider: 'perplexity', model: 'sonar', group: 'main', label: 'Studio', denominator: 6, judged: 6, either: { rate: 33.3, numerator: 2 }, service_mention_rate: 50, sov, competitor_mention_rates: { '赤坂そば': 50 }, error_count: 0 },
       { provider: 'openai', model: 'gpt-4o-mini', group: 'main', label: 'Studio', denominator: 6, judged: 0, either: { rate: null, numerator: 0 }, service_mention_rate: 16.7, sov: null, competitor_mention_rates: {}, error_count: 0 }] });
const parsed = R.parseMeasurementSummary(studioSummary(50, 'studio-a'));
expect('parse: Studio の summary を読める（SOV・競合ごとの割合・ChatGPT の引用率は null）', parsed.rows.length === 2 && parsed.rows[0].sov === 50 && parsed.rows[0].competitorMentionRates['赤坂そば'] === 50 && parsed.rows[1].citeRate === null, JSON.stringify(parsed.rows));
const rep = (ver) => R.compileReport({ client: { name: 't' }, periodMonth: '2026-10-01', now: new Date('2026-10-30T00:00:00Z'), scans: [], traffic: [], actions: [],
  runs: [{ measured_on: '2026-09-20', summary: studioSummary(40, 'studio-a') }, { measured_on: '2026-10-20', summary: studioSummary(50, ver) }] });
let c = rep('studio-a');
const pp = c.ai.providers.filter((x) => x.provider === 'perplexity')[0];
expect('compile: 同じ質問の版なら SOV の前月差（40 → 50 = +10）', pp.sov === 50 && pp.prevSov === 40 && pp.sovDelta === 10, JSON.stringify(pp));
expect('compile: 事実に SOV の行', c.facts.some((f) => /SOV（Perplexity）：40% → 50%（\+10pt）/.test(f)), JSON.stringify(c.facts));
c = rep('studio-b');
expect('compile: 質問の版が違えば SOV の差は出さない', c.ai.providers[0].sovDelta === null, JSON.stringify(c.ai.providers[0]));
const old = R.parseMeasurementSummary({ by: [{ provider: 'openai', group: 'main', denominator: 10, either: { rate: 10, numerator: 1 }, service_mention_rate: 20 }] });
expect('parse: SOV の無い従来の summary は sov=null', old.rows[0].sov === null && old.rows[0].competitorMentionRates === null);

// ---- 社内ログインのトークン（偽の Supabase で確かめる）----
{
  const env = { SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'anon' };
  const tok = (t) => ({ headers: { authorization: 'Bearer ' + t } });
  let calls = 0;
  const fakeFetch = (me, status = 200) => async (url, init) => { calls++; return { ok: status === 200, json: async () => me, _url: url, _init: init }; };
  expect('staff token: 社内なら通す', await staffTokenOk(tok('a'.repeat(40)), env, fakeFetch({ is_staff: true })) === true);
  expect('staff token: 顧客（is_staff=false）は通さない', await staffTokenOk(tok('b'.repeat(40)), env, fakeFetch({ is_staff: false })) === false);
  expect('staff token: 無効なトークンは通さない', await staffTokenOk(tok('c'.repeat(40)), env, fakeFetch(null, 401)) === false);
  expect('staff token: トークンなしは通さない', await staffTokenOk({ headers: {} }, env, fakeFetch({ is_staff: true })) === false);
  expect('staff token: Supabase の設定が無ければ通さない', await staffTokenOk(tok('d'.repeat(40)), {}, fakeFetch({ is_staff: true })) === false);
  expect('staff token: 形の崩れたトークンは問い合わせない', await staffTokenOk(tok('x y'), env, fakeFetch({ is_staff: true })) === false);
  calls = 0; const f = fakeFetch({ is_staff: true });
  await staffTokenOk(tok('e'.repeat(40)), env, f); await staffTokenOk(tok('e'.repeat(40)), env, f);
  expect('staff token: 同じトークンは5分覚える（問い合わせ1回）', calls === 1);
  expect('staff token: 通信失敗は通さない', await staffTokenOk(tok('f'.repeat(40)), env, async () => { throw new Error('network'); }) === false);
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
