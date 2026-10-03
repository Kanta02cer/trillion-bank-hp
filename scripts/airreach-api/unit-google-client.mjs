/**
 * Google のつながりを顧客ごとに持つ（Cookie の名前）ことの単体テスト。
 *   node scripts/airreach-api/unit-google-client.mjs
 */
import { cookieNames, getAccessToken, requestClientId } from '../../api/google/_lib/token.js';

const results = [];
const expect = (name, cond, detail = '') => { results.push(!!cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : '  — ' + detail}`); };
const C1 = '59824617-70f0-4a9d-a52e-d6353910f3e5', C2 = 'd35725c9-9afd-4b18-b865-2077dfb9522f';

expect('顧客なし → 共通の Cookie 名', cookieNames('').access === 'airreach_google_access');
expect('顧客あり → 顧客の Cookie 名', cookieNames(C1).access === 'airreach_g_5982461770f04a9da52ed6353910f3e5_a');
expect('形の違う ID は共通扱い（Cookie 名に入れない）', cookieNames('../x').access === 'airreach_google_access');

const req = (cookie, body, query) => ({ headers: { cookie }, body, query });
let r = await getAccessToken(req(`airreach_google_access=GLOBAL; ${cookieNames(C1).access}=TOKEN1`), C1);
expect('顧客1 は顧客1のトークン', r === 'TOKEN1', r);
globalThis.fetch = async () => { throw new Error('Google を呼んではいけない'); };
r = await getAccessToken(req(`airreach_google_access=GLOBAL; ${cookieNames(C1).access}=TOKEN1`), C2);
expect('顧客2 は（共通がつながっていても）つながっていない', r === null, r);
r = await getAccessToken(req('airreach_google_access=GLOBAL'), '');
expect('顧客なし（Studio の取り込み画面）は共通のトークン', r === 'GLOBAL', r);
expect('body.clientId を読む', requestClientId(req('', { clientId: C1 })) === C1);
expect('?client= を読む', requestClientId(req('', {}, { client: C2 })) === C2);
expect('形の違う clientId は使わない', requestClientId(req('', { clientId: 'x' })) === '');

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
