// 診断の根拠: robots.txt の AI ボットごとの判定と、直した場合の点数（同じ計算式での出し直し）
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
const expect = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(detail).slice(0, 300)}`); };
const ctx = { window: {}, console, URL, setTimeout, clearTimeout, Promise };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/airreach-diagnose.js'), 'utf8'), ctx);
const T = ctx.window.AirReach._test;
const ok = (text) => T.robotsBreakdown({ state: 'ok', status: 200, url: 'https://x/robots.txt', fetchedAt: 't' }, text);
const v = (rb, name) => rb.bots.find((b) => b.name === name);

let rb = ok('User-agent: *\nAllow: /\n');
expect('robots: * allow → all allowed via *', rb.bots.every((b) => b.verdict === 'allowed' && b.via === 'star'), JSON.stringify(rb.bots.map((b) => [b.name, b.verdict, b.via])));
rb = ok('User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n');
expect('robots: GPTBot own group Disallow / → blocked, others allowed', v(rb, 'GPTBot').verdict === 'blocked' && v(rb, 'GPTBot').via === 'own' && v(rb, 'ClaudeBot').verdict === 'allowed', JSON.stringify(rb.bots.map((b) => [b.name, b.verdict])));
rb = ok('User-agent: *\nDisallow: /\n');
expect('robots: * Disallow / → all blocked', rb.bots.every((b) => b.verdict === 'blocked'));
rb = ok('User-agent: *\nDisallow:\n');
expect('robots: empty Disallow → allowed', rb.bots.every((b) => b.verdict === 'allowed'));
rb = ok('User-agent: ClaudeBot\nUser-agent: PerplexityBot\nDisallow: /admin/\n');
expect('robots: shared group, partial disallow → partial; no * → others allowed (none)', v(rb, 'ClaudeBot').verdict === 'partial' && v(rb, 'PerplexityBot').verdict === 'partial' && v(rb, 'GPTBot').via === 'none' && v(rb, 'GPTBot').verdict === 'allowed', JSON.stringify(rb.bots.map((b) => [b.name, b.verdict, b.via])));
rb = ok('User-agent: GPTBot\nDisallow: /\nAllow: /public/\n');
expect('robots: Disallow / with Allow subpath → top blocked', v(rb, 'GPTBot').verdict === 'blocked');
rb = ok('User-agent: Google-Extended\nDisallow: /\n# comment\nSitemap: https://x/sitemap.xml\n');
expect('robots: case-insensitive name, comments ignored', v(rb, 'Google-Extended').verdict === 'blocked' && v(rb, 'Google-Extended').lines.length === 2, JSON.stringify(v(rb, 'Google-Extended')));
rb = T.robotsBreakdown({ state: 'missing', status: 404, url: 'https://x/robots.txt' }, '');
expect('robots: missing → no bots judged', rb.bots.length === 0 && rb.status === 404);

// 直した場合の点数
const c = (factor, label, ok, max) => ({ factor, label, state: ok ? 'ok' : 'ng', ok, known: true, points: ok ? max : 0, max });
const checks = [c('structure', 'A', true, 10), c('structure', 'B', false, 10), c('entity', 'C', false, 4), c('entity', 'D', true, 4), c('faq', 'E', false, 3), c('faq', 'F', false, 3), c('discover', 'G', true, 4), c('discover', 'H', false, 4)];
const now = T.computeScores(checks, []).overall;
const pj = T.projectFixes(checks, [], now);
const allFixed = T.computeScores(checks.map((x) => Object.assign({}, x, { state: 'ok', points: x.max })), []).overall;
expect('projection: current equals computeScores', pj.current === now);
expect('projection: afterAll equals recomputation with every ng fixed', pj.afterAll === allFixed, pj.afterAll + ' vs ' + allFixed);
expect('projection: top 3 sorted by gain and afterTop between current and afterAll', pj.top.length === 3 && pj.top[0].gain >= pj.top[1].gain && pj.top[1].gain >= pj.top[2].gain && pj.afterTop >= now && pj.afterTop <= pj.afterAll, JSON.stringify(pj));
expect('projection: null when overall unknown', T.projectFixes(checks, [], null) === null);

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
