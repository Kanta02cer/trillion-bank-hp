// 競合・キーワード・質問の依頼（assets/js/airreach-requests.js）の純粋な部分のテスト
//   node scripts/airreach-api/unit-requests.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ctx = { window: {}, console, URL };
vm.createContext(ctx);
for (const f of ['airreach-ai-breakdown.js', 'airreach-requests.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js', f), 'utf8'), ctx);
const Q = ctx.window.AirReachRequests;
let pass = 0, fail = 0;
const t = (name, ok, got) => { if (ok) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, got === undefined ? '' : JSON.stringify(got)); } };
const hosts = (x) => JSON.stringify(x.map((c) => c.host));

const sum = { cited_domains: [
  ['beauty.hotpepper.jp', { perplexity: 9 }], ['salon-b.example', { perplexity: 4, openai: 1 }], ['www.salon-a.example', { perplexity: 3 }],
  ['hana-salon.example', { perplexity: 6 }], ['blog.hana-salon.example', { perplexity: 2 }], ['instagram.com', { perplexity: 2 }], ['city.shibuya.lg.jp', { perplexity: 2 }],
  ['www.mhlw.go.jp', { perplexity: 2 }], ['hair-c.example', { openai: 1 }], ['zero.example', { openai: 0 }], ['(unresolved)', { openai: 4 }], ['tabelog.com', { openai: 1 }], ['ja.wikipedia.org', { openai: 3 }]] };
const opt = { selfHosts: ['https://hana-salon.example/'], competitors: [{ name: 'サロンA', url: 'https://salon-a.example/' }] };
t('候補：出典になった回数の多い順', hosts(Q.candidates(sum, opt)) === '["salon-b.example","hair-c.example"]', hosts(Q.candidates(sum, opt)));
t('候補：回答数を合計する（perplexity 4 + openai 1）', Q.candidates(sum, opt)[0].answers === 5);
t('候補：自社とそのサブドメインは除く', !Q.candidates(sum, opt).some((c) => /hana-salon/.test(c.host)));
t('候補：登録済みの競合は www. の有無を問わず除く', !Q.candidates(sum, opt).some((c) => /salon-a/.test(c.host)));
t('候補：競合を名前（ホスト名）で登録していても除く', !Q.candidates(sum, { selfHosts: [], competitors: [{ name: 'salon-b.example' }] }).some((c) => c.host === 'salon-b.example'));
t('候補：SNS・口コミ／予約・まとめ・公的機関（lg.jp / go.jp）は除く', !Q.candidates(sum, opt).some((c) => /instagram|hotpepper|tabelog|wikipedia|lg\.jp|go\.jp/.test(c.host)));
t('候補：回数0と (unresolved) は除く', !Q.candidates(sum, opt).some((c) => /zero|unresolved/.test(c.host)));
t('候補：上限（limit）', Q.candidates(sum, { limit: 1 }).length === 1);
t('候補：計測が無い・形が違っても空', Q.candidates(null, opt).length === 0 && Q.candidates({ cited_domains: 'x' }, opt).length === 0);
t('候補：{host, counts} の形も読める', hosts(Q.candidates({ cited_domains: [{ host: 'salon-e.example', counts: { perplexity: 2 } }] }, {})) === '["salon-e.example"]');
const ix = Q.pendingIndex([
  { status: 'pending', action: 'remove', kind: 'competitor', payload: { name: 'サロンA' } },
  { status: 'pending', action: 'add', kind: 'keyword', payload: { text: ' 渋谷 縮毛矯正 ' } },
  { status: 'approved', action: 'add', kind: 'keyword', payload: { text: '渋谷 カラー' } }]);
t('確認待ちの索引：外す依頼を名前で引ける', !!ix['remove:competitor:サロンa']);
t('確認待ちの索引：前後の空白と大文字小文字を無視', !!ix['add:keyword:渋谷 縮毛矯正']);
t('確認待ちの索引：済んだ依頼は入れない', !ix['add:keyword:渋谷 カラー']);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
