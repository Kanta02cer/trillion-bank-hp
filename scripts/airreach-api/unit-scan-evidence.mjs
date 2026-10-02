/**
 * 診断の根拠（任意項目 scope・robots・page.ld）の保存時の整形テスト。架空の値のみ。
 *   node scripts/airreach-api/unit-scan-evidence.mjs
 */
import { buildScanPayload } from './fixture.mjs';
import { validateScanRequest } from '../../api/airreach/_lib/validate.js';
import { buildInsertArgs } from '../../api/airreach/_lib/mapper.js';
const res = []; const ok = (n, c) => { res.push(c); console.log((c ? 'PASS ' : 'FAIL ') + n); };
const base = buildScanPayload();
const body = JSON.parse(JSON.stringify(base));
body.result.scope = { diagnosedAt: '2026-10-05T01:02:00Z', page: { url: 'https://x.test/', finalUrl: 'https://x.test/', status: 200, via: 'direct' },
  subpages: [{ url: 'https://x.test/menu/', role: 'menu', ok: true, status: 200 }, { url: 'javascript:alert(1)', role: 'menu', ok: true }, { url: 'https://u:p@x.test/a?utm_source=z', role: 'evil', ok: 'yes', status: 999 }],
  llms: { url: 'https://x.test/llms.txt', state: 'missing', status: 404 }, robots: { url: 'https://x.test/robots.txt', state: 'ok', status: 200 } };
body.result.robots = { state: 'ok', status: 200, url: 'https://x.test/robots.txt', bots: [{ name: 'GPTBot', org: 'OpenAI', via: 'own', verdict: 'blocked', lines: [{ n: 1, text: 'User-agent: GPTBot' }, { n: 2, text: 'Disallow: /' }, { n: 3, text: 'x'.repeat(500) }, 'bare string'] }, { name: 'EvilBot', verdict: 'allowed' }], lines: ['whole', 'file'] };
body.result.page.ld = { blocks: [{ types: ['Restaurant'], fields: { name: 'テスト', telephone: '03', evil: 'drop', description: 'a'.repeat(1000) } }, { types: [], fields: {} }], raw: ['{"secret":1}'], scripts: 1, errors: 0 };
const v = validateScanRequest(body);
const raw = buildInsertArgs(v, 'a'.repeat(64)).p_scan.raw_result;
ok('scope saved', !!raw.scope && raw.scope.subpages.length === 2);
ok('javascript: url dropped', !JSON.stringify(raw.scope).includes('javascript'));
ok('credentials stripped & invalid role nulled', raw.scope.subpages[1].url.indexOf('u:p@') < 0 && raw.scope.subpages[1].role === null && raw.scope.subpages[1].ok === false && raw.scope.subpages[1].status === null);
ok('robots saved without whole file', raw.robots && !('lines' in raw.robots) && raw.robots.bots.length === 1);
ok('robots line capped 200', raw.robots.bots[0].lines[2].text.length === 200 && raw.robots.bots[0].lines.length === 3 && raw.robots.bots[0].lines[0].n === 1);
ok('ld saved, unknown field dropped, raw dropped', raw.page.ld && !('raw' in raw.page.ld) && !('evil' in raw.page.ld.blocks[0].fields) && raw.page.ld.blocks.length === 1);
ok('ld field capped 400', raw.page.ld.blocks[0].fields.description.length === 400);
const bad = JSON.parse(JSON.stringify(base)); bad.result.scope = 'x'; bad.result.robots = [1]; bad.result.page.ld = { blocks: 'no' };
let threw = false, r2; try { r2 = buildInsertArgs(validateScanRequest(bad), 'a'.repeat(64)).p_scan.raw_result; } catch (e) { threw = true; }
ok('malformed optional fields do not reject the save', !threw && !r2.scope && !r2.robots && r2.page.ld.blocks.length === 0);
const none = buildInsertArgs(validateScanRequest(JSON.parse(JSON.stringify(base))), 'a'.repeat(64)).p_scan.raw_result;
ok('old clients without new fields still save', !('scope' in none) && !('robots' in none));
console.log(res.filter(Boolean).length + '/' + res.length);
process.exit(res.every(Boolean) ? 0 : 1);
