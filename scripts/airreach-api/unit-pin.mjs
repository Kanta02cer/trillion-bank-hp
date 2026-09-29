/**
 * 接続先固定（DNS リバインディング / TOCTOU 対策）の単体テスト。
 * リゾルバを注入して「検証した IP 以外へ接続しない」「リダイレクト先で再解決・再検証する」を確認する。
 * 前提: モック対象サイトが 127.0.0.1:54322 で動いていること。AIRREACH_FETCH_ALLOW_LOOPBACK_FOR_TESTS=1 で実行する。
 *   node scripts/airreach-api/unit-pin.mjs
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { fetchPublicDocument, resolvePinnedAddress } = await import(pathToFileURL(path.join(ROOT, 'api/airreach/_lib/fetch-proxy.js')).href);
const PORT = Number(process.env.TARGET_PORT || 54322);
const results = [];
const expect = (name, cond, detail = '') => { results.push({ name, pass: !!cond }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + detail}`); };
const opts = { timeoutMs: 3000, maxBytes: 900_000 };
const status = async (p) => { try { await p; return 200; } catch (e) { return e && e.status ? e.status : `exception:${e && e.message}`; } };

// 1. 名前解決を注入: rebind.test は実 DNS に存在しない。接続が成功すれば、検証済み IP へ固定接続したことになる
let calls = 0;
const flipResolver = async () => { calls += 1; return calls === 1 ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '10.0.0.1', family: 4 }]; };
const r1 = await fetchPublicDocument(new URL(`http://rebind.test:${PORT}/echo-host`), { ...opts, resolveHost: flipResolver });
const echo1 = JSON.parse(r1.body);
expect('pinned: connects to the validated IP (no second lookup at connect time)', r1.status === 200 && echo1.remote === '127.0.0.1' && calls === 1, `status=${r1.status} calls=${calls} remote=${echo1.remote}`);
expect('pinned: Host header stays the hostname', echo1.host === `rebind.test:${PORT}`, echo1.host);
// 2. 同じ名前を次に取得すると再解決され、今度は private → 400（キャッシュしない）
const s2 = await status(fetchPublicDocument(new URL(`http://rebind.test:${PORT}/echo-host`), { ...opts, resolveHost: flipResolver }));
expect('re-resolution per request: flipped answer (10.0.0.1) → 400', s2 === 400 && calls === 2, `status=${s2} calls=${calls}`);

// 3. リダイレクト先で再解決 + 再検証: 1 ホップ目 127.0.0.1、2 ホップ目（rebind2.test）が private → 400
calls = 0;
const hopResolver = async (host) => { calls += 1; return host === 'rebind.test' ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '10.0.0.1', family: 4 }]; };
const s3 = await status(fetchPublicDocument(new URL(`http://rebind.test:${PORT}/redirect-to-rebind2`), { ...opts, resolveHost: hopResolver }));
expect('redirect: target host re-resolved and rejected (private) → 400', s3 === 400 && calls === 2, `status=${s3} calls=${calls}`);
// 4. リダイレクト先が公開扱い（テストではループバック許可）なら再固定して成功し、Host は新しいホスト名
calls = 0;
const okResolver = async () => { calls += 1; return [{ address: '127.0.0.1', family: 4 }]; };
const r4 = await fetchPublicDocument(new URL(`http://rebind.test:${PORT}/redirect-to-rebind2`), { ...opts, resolveHost: okResolver });
const echo4 = JSON.parse(r4.body);
expect('redirect: re-pinned to new host, Host header = rebind2.test', r4.status === 200 && echo4.host === `rebind2.test:${PORT}` && calls === 2 && r4.finalUrl === `http://rebind2.test:${PORT}/echo`, `status=${r4.status} host=${echo4.host} calls=${calls} final=${r4.finalUrl}`);

// 5. 解決結果に 1 つでも private があれば拒否（IPv4 / IPv6 混在）
const mixed = async () => [{ address: '127.0.0.1', family: 4 }, { address: '::ffff:a00:1', family: 6 }];
const s5 = await status(fetchPublicDocument(new URL(`http://rebind.test:${PORT}/`), { ...opts, resolveHost: mixed }));
expect('mixed records with a private IPv6-mapped address → 400', s5 === 400, `status=${s5}`);
const v6only = async () => [{ address: 'fd00::1', family: 6 }];
const s6 = await status(fetchPublicDocument(new URL(`http://rebind.test:${PORT}/`), { ...opts, resolveHost: v6only }));
expect('ULA-only answer → 400', s6 === 400, `status=${s6}`);
// 6. resolvePinnedAddress は IPv4 を優先し、IPv6 リテラルは family 6
const pin = await resolvePinnedAddress('rebind.test', async () => [{ address: '2606:4700:4700::1111', family: 6 }, { address: '8.8.8.8', family: 4 }]);
expect('resolvePinnedAddress prefers IPv4 when both are public', pin.address === '8.8.8.8' && pin.family === 4, JSON.stringify(pin));
const pin6 = await resolvePinnedAddress('[2606:4700:4700::1111]');
expect('resolvePinnedAddress accepts a public IPv6 literal', pin6.address === '2606:4700:4700::1111' && pin6.family === 6, JSON.stringify(pin6));
// 7. 解決失敗 → 400（fetch 側では 'hostname could not be resolved'）
const s7 = await status(fetchPublicDocument(new URL('http://rebind-nx.test/'), { ...opts, resolveHost: async () => { throw new Error('ENOTFOUND'); } }));
expect('resolver failure → 400', s7 === 400, `status=${s7}`);
// 8. gzip は伸長後サイズで上限判定（3 MB → 502）、通常 gzip は伸長される
const r8 = await fetchPublicDocument(new URL(`http://rebind.test:${PORT}/gzip`), { ...opts, resolveHost: okResolver });
expect('gzip body is decompressed', r8.status === 200 && /<title>Mock Site<\/title>/.test(r8.body));
const s9 = await status(fetchPublicDocument(new URL(`http://rebind.test:${PORT}/gzip-bomb`), { ...opts, resolveHost: okResolver }));
expect('gzip bomb (3 MB decompressed) → 502', s9 === 502, `status=${s9}`);

const failed = results.filter((x) => !x.pass).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
