// 代理店向けデモ（/airreach/demo/）：架空データの整合・本番からの分離
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const results = [];
const expect = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + String(detail).slice(0, 300)}`); };
const ctx = { window: {}, console }; vm.createContext(ctx);
for (const f of ['airreach-report.js', 'airreach-demo-data.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8'), ctx);
const D = ctx.window.AirReachDemoData;
expect('公開済みの見本レポートが3か月分（新しい順）', D.reports.length === 3 && D.reports.map((r) => r.period_month).join() === '2026-09-01,2026-08-01,2026-07-01' && D.reports.every((r) => r.status === 'published'));

// 数字の整合：引用率・言及率は回答の記録の数と一致する。表示なし・判定できないは分母に入れない
for (const r of D.reports) {
  const c = r.compiled, ans = c.ai.evidence;
  for (const p of c.ai.providers) {
    const rows = ans.filter((a) => a.engine === p.provider), ok = rows.filter((a) => a.status === 'ok');
    const judged = ok.filter((a) => a.cited === 0 || a.cited === 1), cited = judged.filter((a) => a.cited === 1).length;
    const good = p.answers === ok.length && p.judged === judged.length && p.citeCount === cited && p.notShown === rows.length - ok.length && p.mentionCount === ok.filter((a) => a.mentioned).length &&
      (p.citeRate === (judged.length ? Math.round(cited / judged.length * 1000) / 10 : null)) && p.undetermined === ok.length - judged.length;
    if (!good) { expect(r.id + ' ' + p.provider + '：割合が回答の記録と一致', false, JSON.stringify(p)); }
  }
  expect(r.id + '：AI ごとの分子・分母・表示なし・判定できないが回答の記録と一致', true);
  const prev = D.reports.find((x) => x.period_month === c.previousMonth);
  if (prev) {
    const pp = prev.compiled.ai.providers;
    expect(r.id + '：前月との差＝今月 − 前月（レポート同士で一致）', c.ai.providers.every((p) => { const q = pp.find((x) => x.provider === p.provider); return !q || p.citeDelta === Math.round((p.citeRate - q.citeRate) * 10) / 10; }) && c.site.overallDelta === c.site.current.overall - prev.compiled.site.current.overall);
  }
  expect(r.id + '：結論の数字がその月の数字と同じ', r.conclusions.some((t) => t.includes(c.site.current.overall + '点')) && r.conclusions.some((t) => t.includes(String(c.traffic.gsc.clicks))));
  expect(r.id + '：未計測の月は null（0 にしない）', c.history.filter((h) => h.month < '2026-06-01').every((h) => Object.keys(h.cite).length === 0 || Object.values(h.cite).every((v) => v == null)));
}

// 架空であること：URL・メールは予約済みのドメインだけ・回答に架空の印・成果を断定しない
const all = JSON.stringify(D);
const urls = all.match(/https?:\/\/[^"\s)）]+/g) || [];
expect('URL は .example だけ（実在のサイトへリンクしない）', urls.every((u) => /^https:\/\/[a-z0-9.-]+\.example\//.test(u)), urls.filter((u) => !/\.example\//.test(u)).slice(0, 3));
expect('AI の回答の見本には「デモ用の架空の回答」の印', D.reports.every((r) => r.compiled.ai.evidence.filter((e) => e.answer).every((e) => e.answer.includes('デモ用の架空の回答'))));
expect('結論で成果や因果を断定しない（「〜のおかげ」「保証」などがない）', !/おかげ|保証します|確実に|必ず/.test(D.reports.map((r) => r.conclusions.join('')).join('')));

// 本番からの分離
const page = fs.readFileSync(path.join(ROOT, 'airreach/demo/index.html'), 'utf8');
expect('デモのページは noindex・解析なし・SAMPLE 表示', /robots: "noindex, nofollow"/.test(page) && /no_analytics: true/.test(page) && /SAMPLE／デモ用の架空データ/.test(page));
expect('デモのページは Supabase・ログイン・計測・Google の処理を読み込まない', !/supabase|airreach-console\.js|airreach-studio|hack2-measure|\/api\//i.test(page));
const demoJs = fs.readFileSync(path.join(ROOT, 'assets/js/airreach-demo.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'assets/js/airreach-demo-data.js'), 'utf8');
expect('デモの JS は通信・保存をしない（fetch・XHR・localStorage・sessionStorage なし）', !/fetch\(|XMLHttpRequest|localStorage|sessionStorage|navigator\.sendBeacon/.test(demoJs));
const view = fs.readFileSync(path.join(ROOT, 'assets/js/airreach-report-view.js'), 'utf8');
expect('本番のレポート画面：デモの印はページの HTML（data-demo）だけで決まり、URL のパラメータでは切り替わらない', /root\.getAttribute\('data-demo'\) === '1'/.test(view) && !/searchParams\.get\('demo'\)|[?&]demo=/.test(view));
const app = fs.readFileSync(path.join(ROOT, 'airreach/app/report/index.html'), 'utf8');
expect('本番のレポートのページには data-demo が無い（ログインと閲覧の制限はそのまま）', !/data-demo/.test(app));
const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
expect('robots.txt でデモを検索の対象から外す', /Disallow: \/airreach\/demo\//.test(robots));
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
expect('サイトマップにデモを載せない', !/airreach\/demo/.test(sitemap));

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
