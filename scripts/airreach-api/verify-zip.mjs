// AirReach の ZIP（無圧縮）を展開して、MANIFEST.files の大きさ・SHA-256・JSON の形・undefined の混入を確かめる
//   node scripts/airreach-api/verify-zip.mjs path/to/airreach-implementation.zip
import fs from 'node:fs';
import crypto from 'node:crypto';

/** 無圧縮の ZIP を { パス: 文字列 } にする（AirReach の buildZip の形だけを読む） */
export function readStoredZip(buf) {
  const u = new Uint8Array(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength), out = {};
  let o = 0;
  while (o + 30 <= u.length && dv.getUint32(o, true) === 0x04034b50) {
    const method = dv.getUint16(o + 8, true), size = dv.getUint32(o + 18, true), nlen = dv.getUint16(o + 26, true), xlen = dv.getUint16(o + 28, true);
    if (method !== 0) throw new Error('圧縮された ZIP は読めません（AirReach の ZIP ではない）');
    const name = new TextDecoder().decode(u.subarray(o + 30, o + 30 + nlen));
    const start = o + 30 + nlen + xlen;
    out[name] = new TextDecoder().decode(u.subarray(start, start + size));
    o = start + size;
  }
  return out;
}
export function verifyFiles(files) {
  const errors = [];
  let mf = null;
  try { mf = JSON.parse(files['MANIFEST.json'] || ''); } catch (e) { errors.push('MANIFEST.json が JSON として読めません'); }
  if (mf) {
    if (!Array.isArray(mf.files)) errors.push('MANIFEST.files がありません');
    else {
      const listed = mf.files.map((x) => x.path);
      Object.keys(files).forEach((k) => { if (k !== 'MANIFEST.json' && !listed.includes(k)) errors.push('MANIFEST に無いファイル: ' + k); });
      mf.files.forEach((x) => {
        if (!(x.path in files)) { errors.push('入っていない: ' + x.path); return; }
        const b = Buffer.from(files[x.path], 'utf8');
        if (b.length !== x.bytes) errors.push('大きさが違う: ' + x.path);
        if (crypto.createHash('sha256').update(b).digest('hex') !== x.sha256) errors.push('中身が違う（SHA-256）: ' + x.path);
      });
    }
  }
  Object.keys(files).forEach((k) => {
    if (/\.(jsonld|json)$/.test(k)) { try { JSON.parse(files[k]); } catch (e) { errors.push('JSON として読めない: ' + k); } }
    if (/(^|[^A-Za-z_])(undefined|NaN)(?![A-Za-z_])/.test(files[k])) errors.push('undefined・NaN が残っている: ' + k);
  });
  if (files['schema/faq.jsonld']) {
    const ld = JSON.parse(files['schema/faq.jsonld']);
    const n = (ld.mainEntity || []).length;
    if (!n) errors.push('空の FAQ の構造化データ');
    if (mf && mf.faq_counts && mf.faq_counts.in_schema !== n) errors.push('faq.jsonld の質問の数が MANIFEST と違う');
  }
  return { ok: !errors.length, errors, files: Object.keys(files).length, version: mf ? mf.version : null, selection: mf ? mf.selection : null };
}
if (process.argv[1] && import.meta.url === 'file://' + process.argv[1]) {
  const p = process.argv[2];
  if (!p) { console.error('使い方: node scripts/airreach-api/verify-zip.mjs <zip>'); process.exit(2); }
  const r = verifyFiles(readStoredZip(fs.readFileSync(p)));
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}
