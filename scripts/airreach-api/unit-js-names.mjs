// 画面の JS で、同じ名前の関数を2回定義していないこと（後の定義が前の定義を上書きして、片方が黙って使われなくなる）
//   2026-10-05: レポートの「回答の記録」を作る evidenceHtml が「数字の出どころ」の evidenceHtml に上書きされ、本番で出ていなかった
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.join(ROOT, 'assets/js');
let bad = 0, n = 0;
for (const f of fs.readdirSync(dir).filter((x) => /^airreach-.*\.js$/.test(x))) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  // ファイル直下（字下げ 0〜2：即時関数の中のいちばん外側）の宣言だけを比べる。別の関数の中にある同名の小さな関数は別のスコープなので数えない
  const names = {};
  for (const m of src.matchAll(/^([ \t]*)function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) { if (m[1].length > 2) continue; const k = m[1].length + ':' + m[2]; names[k] = (names[k] || 0) + 1; }
  const dup = Object.keys(names).filter((k) => names[k] > 1).map((k) => k.split(':')[1]);
  n += 1;
  if (dup.length) { bad += 1; console.log('FAIL  ' + f + ': 同じ名前の関数 ' + dup.join(', ')); }
}
console.log(`\n${n - bad}/${n} passed`);
process.exit(bad ? 1 : 0);
