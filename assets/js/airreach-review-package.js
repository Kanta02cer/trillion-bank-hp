/**
 * ③④ 媒体の記事向けのレビュー用パッチ（airreach-review-bundle/1・airreach-review-package/1）を、そのまま取り込んで正式版にする。
 *   - 中身は作り直さない。ZIP の中の MANIFEST.json に書かれた各ファイルの大きさと SHA-256 を、実際のバイト列で確かめてから取り込む
 *     （1つでも違う・足りない・一覧に無いファイルがあれば取り込まない）
 *   - 取り込みと承認は別。取り込んだだけでは正式版にしない（approve で担当者が承認したときだけ）
 *   - 媒体ごとに：対象の記事の URL・会社説明の全文・記事データ（Article／NewsArticle）・CHANGESET・版・MANIFEST の指紋を残す
 *   - 公開・照合・収録の記録は記事ごと。④ は、今回の反映の対象に選んだ記事が全部「公開・照合済み」のときだけ済み
 *     （どの記事を今回の対象にするかは担当者が選ぶ。最初は何も選ばない）
 *   - URL は厳しく比べる（www の有無・記事 ID・転載先・転送先を同じ記事として扱わない）
 *   保存はこのブラウザの airreach_studio_review_v1（顧客ごとの作業として DB の studio_workspaces.data.review にも同期する）
 */
(function (root) {
  'use strict';
  var KEY = 'airreach_studio_review_v1';
  var RULE = 'verify-article/2026.10.10';
  var ARTICLE = /^(Article|NewsArticle|BlogPosting|Report)$/;
  var IGNORE = /(^|\/)(__MACOSX\/|\.DS_Store$)/;

  function utf8(bytes) { return new TextDecoder('utf-8').decode(bytes); }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  function sha256(bytes) { return root.crypto.subtle.digest('SHA-256', bytes).then(hex); }
  function nfc(s) { return String(s || '').normalize ? String(s || '').normalize('NFC') : String(s || ''); }
  function parse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

  // ---- ZIP を読む（無圧縮と deflate。ブラウザの DecompressionStream を使う） ----
  function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('このブラウザでは圧縮された ZIP を開けません'));
    var ds = new DecompressionStream('deflate-raw');
    var out = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(out).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  /** ZIP のバイト列 → { 'パス': Uint8Array }。パスは NFC にそろえ、共通の一番上のフォルダを外す */
  function readZip(input) {
    var u8 = input instanceof Uint8Array ? input : new Uint8Array(input), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) return Promise.reject(new Error('ZIP として読めません'));
    var count = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true), entries = [];
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) return Promise.reject(new Error('ZIP の目次が壊れています'));
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      var name = nfc(utf8(u8.subarray(p + 46, p + 46 + nlen)));
      p += 46 + nlen + xlen + clen;
      if (/\/$/.test(name) || IGNORE.test(name)) continue;
      if (dv.getUint32(off, true) !== 0x04034b50) return Promise.reject(new Error('ZIP のファイルが壊れています：' + name));
      var start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      entries.push({ name: name, method: method, data: u8.subarray(start, start + csize) });
    }
    return Promise.all(entries.map(function (e) {
      if (e.method === 0) return Promise.resolve(e.data.slice());
      if (e.method === 8) return inflateRaw(e.data);
      return Promise.reject(new Error('対応していない圧縮方式です：' + e.name));
    })).then(function (datas) {
      var files = {};
      entries.forEach(function (e, k) { files[e.name] = datas[k]; });
      return stripTop(files);
    });
  }
  function stripTop(files) {
    var names = Object.keys(files);
    if (!names.length || files['MANIFEST.json']) return files;
    var top = names[0].split('/')[0] + '/';
    if (!names.every(function (x) { return x.indexOf(top) === 0; })) return files;
    var out = {}; names.forEach(function (x) { out[x.slice(top.length)] = files[x]; }); return out;
  }

  // ---- MANIFEST の指紋を確かめる ----
  /** MANIFEST の files[] を実際のバイト列と比べる。base はフォルダ（'' か '01_媒体/'）。戻り値 Promise<[問題…]> */
  function checkListed(files, man, base) {
    var list = Array.isArray(man.files) ? man.files : [];
    if (!list.length) return Promise.resolve(['MANIFEST にファイルの一覧がありません（' + (base || '一番上') + '）']);
    return Promise.all(list.map(function (f) {
      var path = base + nfc(f.path), b = files[path];
      if (!b) return Promise.resolve('ファイルがありません：' + path);
      if (typeof f.bytes === 'number' && f.bytes !== b.length) return Promise.resolve('大きさが MANIFEST と違います：' + path);
      return sha256(b).then(function (h) { return h === String(f.sha256 || '').toLowerCase() ? '' : '指紋（SHA-256）が MANIFEST と違います：' + path; });
    })).then(function (xs) { return xs.filter(Boolean); });
  }
  /** 会社説明の HTML → 見出し・段落ごとの文（全文照合に使う） */
  function blocksOf(html) {
    var out = [], re = /<(h[1-6]|p|li|dd|dt)\b[^>]*>([\s\S]*?)<\/\1>/gi, m;
    var txt = function (s) { return String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim(); };
    while ((m = re.exec(String(html || '')))) { var t = txt(m[2]); if (t) out.push(t); }
    if (!out.length) { var all = txt(html); if (all) out.push(all); }
    return out;
  }
  function flat(j) { var out = []; (Array.isArray(j) ? j : [j]).forEach(function (x) { if (x && Array.isArray(x['@graph'])) x['@graph'].forEach(function (g) { out.push(g); }); else if (x) out.push(x); }); return out; }
  function types(x) { var t = x && x['@type']; return (Array.isArray(t) ? t : [t]).filter(Boolean).map(String); }
  /** 記事データの about にある会社（Organization 系）の名前 */
  function aboutOrgs(x) {
    var ab = x && x.about; ab = Array.isArray(ab) ? ab : ab ? [ab] : [];
    return ab.filter(function (a) { return a && types(a).some(function (t) { return /Organization|Corporation|LocalBusiness/.test(t); }); }).map(function (a) { return String(a.name || ''); });
  }
  /** 1媒体分（フォルダ base）を確かめて取り出す */
  function readItem(files, base) {
    var mBytes = files[base + 'MANIFEST.json'], man = mBytes ? parse(utf8(mBytes)) : null, errs = [];
    if (!man || man.format !== 'airreach-review-package/1') return Promise.resolve({ errors: [(base || '一番上') + ' の MANIFEST.json が、レビュー用パッチの形式（airreach-review-package/1）ではありません'] });
    return Promise.all([checkListed(files, man, base), sha256(mBytes)]).then(function (r) {
      errs = r[0];
      var need = ['CONTENT.html', 'ARTICLE.jsonld', 'CHANGESET.json'];
      need.forEach(function (f) { if (!(man.files || []).some(function (x) { return nfc(x.path) === f; })) errs.push(base + f + ' が MANIFEST にありません'); });
      if (errs.length) return { errors: errs };
      var content = utf8(files[base + 'CONTENT.html']), ldText = utf8(files[base + 'ARTICLE.jsonld']), cs = parse(utf8(files[base + 'CHANGESET.json'])), art = parse(ldText);
      var t = man.target || {}, url = String(t.article_url || '');
      var a0 = flat(art).filter(function (x) { return types(x).some(function (y) { return ARTICLE.test(y); }); })[0];
      if (!/^https?:\/\//i.test(url)) errs.push(base + '：対象の記事の URL がありません');
      if (!cs || urlKey(cs.target_url) !== urlKey(url)) errs.push(base + '：CHANGESET の URL が MANIFEST の対象と違います');
      if (!a0) errs.push(base + '：ARTICLE.jsonld に記事データ（Article・NewsArticle）がありません');
      else if (urlKey(a0.url || a0.mainEntityOfPage || '') !== urlKey(url)) errs.push(base + '：記事データの URL が MANIFEST の対象と違います');
      if (a0 && t.company && aboutOrgs(a0).indexOf(String(t.company)) < 0) errs.push(base + '：記事データの about に会社（' + t.company + '）がありません');
      if (!blocksOf(content).length) errs.push(base + '：会社説明（CONTENT.html）が空です');
      if (errs.length) return { errors: errs };
      return { item: {
        key: base.replace(/\/$/, '') || 'item', publisher: String(t.publisher || ''), target_url: url, company: String(t.company || ''), brand: String(t.brand || ''),
        content_html: content, content_blocks: blocksOf(content), article_jsonld: ldText,
        article: { type: types(a0)[0], headline: String(a0.headline || ''), url: url },
        changeset: { content: cs.content || null, structured_data: cs.structured_data || null, apply_mode: cs.apply_mode || '' },
        version: String(man.package_version || ''), manifest_sha256: r[1], manifest_files: (man.files || []).length
      } };
    });
  }
  /**
   * ZIP を取り込む。戻り値 Promise<{ ok, errors, pkg }>。一番上がバンドル（airreach-review-bundle/1）なら、
   * 一番上の一覧と媒体ごとの一覧の両方を確かめる。一覧に無いファイルが入っていても取り込まない
   */
  function importZip(bytes, now) {
    return readZip(bytes).then(function (files) {
      var rootMan = files['MANIFEST.json'], man = rootMan ? parse(utf8(rootMan)) : null;
      if (!man) return { ok: false, errors: ['MANIFEST.json がありません。送付したレビュー用パッチの ZIP を選んでください'] };
      var bases = [];
      if (man.format === 'airreach-review-bundle/1') {
        Object.keys(files).forEach(function (f) { var m = /^([^/]+\/)MANIFEST\.json$/.exec(f); if (m) bases.push(m[1]); });
        bases.sort();
      } else if (man.format === 'airreach-review-package/1') bases = [''];
      else return { ok: false, errors: ['レビュー用パッチの形式ではありません（' + (man.format || '形式の記載なし') + '）。Studio で作った通常のパッチは「③ パッチを作る」で扱います'] };
      var bundleCheck = man.format === 'airreach-review-bundle/1' ? checkListed(files, man, '') : Promise.resolve([]);
      return Promise.all([bundleCheck, sha256(rootMan)].concat(bases.map(function (b) { return readItem(files, b); }))).then(function (r) {
        var errs = r[0].slice(), items = [];
        // 一覧に無いファイル（あとから足されたもの）は取り込まない
        var listed = {};
        listed['MANIFEST.json'] = 1;
        (man.files || []).forEach(function (f) { listed[nfc(f.path)] = 1; });
        bases.forEach(function (b) { listed[b + 'MANIFEST.json'] = 1; var m2 = parse(utf8(files[b + 'MANIFEST.json'])) || {}; (m2.files || []).forEach(function (f) { listed[b + nfc(f.path)] = 1; }); });
        Object.keys(files).forEach(function (f) { if (!listed[f]) errs.push('MANIFEST に無いファイルが入っています：' + f); });
        r.slice(2).forEach(function (x) { if (x.errors) errs = errs.concat(x.errors); else items.push(x.item); });
        if (!items.length && !errs.length) errs.push('媒体のパッチが見つかりません');
        var comps = items.map(function (x) { return x.company; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
        if (comps.length > 1) errs.push('媒体ごとに会社が違います（' + comps.join('・') + '）');
        var vers = items.map(function (x) { return x.version; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
        if (vers.length > 1) errs.push('媒体ごとに版が違います（' + vers.join('・') + '）');
        if (errs.length) return { ok: false, errors: errs };
        var pkg = { format: man.format, version: String(man.version || man.package_version || items[0].version || ''), company: comps[0] || '',
          manifest_sha256: r[1], imported_at: (now || new Date()).toISOString(), approved: null, round: [], items: items };
        return { ok: true, errors: [], pkg: pkg };
      });
    }).catch(function (e) { return { ok: false, errors: [(e && e.message) || String(e)] }; });
  }

  // ---- 承認・今回の対象・記録 ----
  /** 正式版か（承認した版・指紋が、いまのパッケージと同じ） */
  function official(pkg) { return !!(pkg && pkg.approved && pkg.approved.manifest_sha256 === pkg.manifest_sha256 && pkg.approved.version === pkg.version); }
  function approve(pkg, by, now) {
    if (!pkg) return { ok: false, error: '先にレビュー用パッチを取り込んでください' };
    pkg.approved = { at: (now || new Date()).toISOString(), by: String(by || ''), version: pkg.version, manifest_sha256: pkg.manifest_sha256 };
    return { ok: true };
  }
  function setRound(pkg, keys) {
    var valid = (pkg.items || []).map(function (x) { return x.key; });
    pkg.round = (keys || []).filter(function (k, i, a) { return valid.indexOf(k) >= 0 && a.indexOf(k) === i; });
  }
  function stampOf(pkg, item) { return { version: pkg.version, manifest_sha256: pkg.manifest_sha256, item_manifest_sha256: item.manifest_sha256 }; }
  function sameStamp(rec, pkg, item) { return !!rec && rec.version === pkg.version && rec.manifest_sha256 === pkg.manifest_sha256 && rec.item_manifest_sha256 === item.manifest_sha256; }
  /**
   * URL を比べる鍵（厳しい）：https/http と大文字小文字・末尾の / ・# だけをそろえる。www の有無・クエリ（記事 ID）は区別する
   */
  function urlKey(u) {
    var s = String(u || '').trim().replace(/#.*$/, ''), m = /^(https?):\/\/([^/?#]+)([^?#]*)(\?[^#]*)?$/i.exec(s);
    if (!m) return s.toLowerCase();
    return m[2].toLowerCase() + (m[3] || '').replace(/\/+$/, '') + (m[4] || '');
  }
  function recordPublish(pkg, key, atIso, url, now) {
    var item = itemOf(pkg, key); if (!item) return { ok: false, error: '記事が見つかりません' };
    if (!official(pkg)) return { ok: false, error: '先にレビュー用パッチを承認して、正式版にしてください' };
    var t = Date.parse(atIso || ''), n = (now || new Date()).getTime();
    if (isNaN(t)) return { ok: false, error: '公開した日時を入れてください' };
    if (t < Date.parse(pkg.approved.at)) return { ok: false, error: '公開した日時が、承認した日時より前です' };
    if (t > n + 60000) return { ok: false, error: '公開した日時が未来です' };
    if (urlKey(url) !== urlKey(item.target_url)) return { ok: false, error: '対象の記事の URL（' + item.target_url + '）と違います。www の有無・記事 ID・転載先は別の記事として扱います' };
    item.published = Object.assign({ at: new Date(t).toISOString(), url: String(url).trim(), recorded_at: new Date(n).toISOString() }, stampOf(pkg, item));
    return { ok: true };
  }
  function recordIndexed(pkg, key, atIso, how, now) {
    var item = itemOf(pkg, key); if (!item) return { ok: false, error: '記事が見つかりません' };
    if (!official(pkg)) return { ok: false, error: '先にレビュー用パッチを承認して、正式版にしてください' };
    var t = Date.parse(atIso || ''), n = (now || new Date()).getTime();
    if (isNaN(t) || t > n + 60000) return { ok: false, error: '確かめた日時を入れてください（未来は不可）' };
    item.indexed = Object.assign({ at: new Date(t).toISOString(), how: String(how || ''), url: item.target_url, recorded_at: new Date(n).toISOString() }, stampOf(pkg, item));
    return { ok: true };
  }
  /** 照合の結果（AirReachVerify.judgeArticle）を記事の記録にする */
  function recordVerify(pkg, key, res, meta) {
    var item = itemOf(pkg, key); if (!item) return { ok: false, error: '記事が見つかりません' };
    meta = meta || {};
    item.verified = Object.assign({ at: (meta.at || new Date().toISOString()), url: meta.url || '', final_url: meta.final_url || meta.url || '', ok: !!res.ok, state: res.state,
      html_sha256: meta.html_sha256 || '', rendered: meta.rendered || null, rule: RULE, checks: res.checks }, stampOf(pkg, item));
    return { ok: true };
  }
  function itemOf(pkg, key) { return ((pkg && pkg.items) || []).filter(function (x) { return x.key === key; })[0] || null; }
  /** 1記事の状態 */
  function itemState(pkg, item, now) {
    var nowT = (now || new Date()).getTime(), off = official(pkg);
    var out = { key: item.key, published: { ok: false, why: '' }, verified: { ok: false, state: '', why: '' }, indexed: { ok: false }, done: false };
    var pb = item.published, vf = item.verified, ix = item.indexed;
    if (!off) out.published.why = 'まだ承認していない（正式版でない）';
    else if (!pb || !pb.at) out.published.why = '公開した日時が未記録';
    else if (!sameStamp(pb, pkg, item)) out.published.why = '公開の記録は別の版';
    else if (urlKey(pb.url) !== urlKey(item.target_url)) out.published.why = '公開の記録の URL が対象の記事と違う';
    else if (Date.parse(pb.at) > nowT) out.published.why = '公開した日時が未来になっている';
    else out.published = { ok: true, at: pb.at, url: pb.url };
    if (!vf || !vf.at) out.verified.why = 'まだ確かめていない';
    else if (!sameStamp(vf, pkg, item)) out.verified.why = '確かめた記録は別の版。いまの版で確かめ直す';
    else if (vf.rule !== RULE) out.verified.why = '前の判定方法での記録。もう一度確かめる';
    else if (urlKey(vf.url) !== urlKey(item.target_url)) out.verified.why = '照合したページ（' + vf.url + '）が対象の記事と違う';
    else if (vf.final_url && urlKey(vf.final_url) !== urlKey(vf.url)) out.verified.why = '照合したページが別の URL（' + vf.final_url + '）に転送された';
    else if (vf.state === 'review') { out.verified.state = 'review'; out.verified.why = '要確認（見える形で入ったかを確かめきれていない）'; }
    else if (!vf.ok || vf.state !== 'ok') { out.verified.state = 'ng'; out.verified.why = '入っていない・違うところがある'; }
    else if (out.published.ok && Date.parse(vf.at) < Date.parse(pb.at)) out.verified.why = '確かめたのが公開より前。公開のあとに確かめ直す';
    else out.verified = { ok: true, state: 'ok', at: vf.at, why: '' };
    if (off && ix && ix.at && sameStamp(ix, pkg, item)) out.indexed = { ok: true, at: ix.at, how: ix.how || '' };
    out.done = out.published.ok && out.verified.ok;
    return out;
  }
  /**
   * ④ の状態。今回の対象（round）が空なら済みにしない。対象の記事が全部「公開・照合済み」のときだけ済み。
   *   published.at は、対象の記事のうち最後に公開した日時（公開後の計測はこれより後）
   */
  function state(pkg, now) {
    var out = { pkg: pkg || null, official: official(pkg), round: [], items: [], done: false, published: { ok: false, at: null }, why: '' };
    if (!pkg) { out.why = 'レビュー用パッチを取り込んでいない'; return out; }
    out.items = (pkg.items || []).map(function (it) { var s = itemState(pkg, it, now); s.publisher = it.publisher; s.target_url = it.target_url; s.inRound = (pkg.round || []).indexOf(it.key) >= 0; return s; });
    out.round = out.items.filter(function (x) { return x.inRound; });
    if (!out.official) out.why = 'まだ承認していない';
    else if (!out.round.length) out.why = '今回の反映の対象の記事を選んでいない';
    else {
      var left = out.round.filter(function (x) { return !x.done; });
      out.done = !left.length;
      out.why = left.length ? left.length + ' / ' + out.round.length + '記事が未完了（' + left.map(function (x) { return x.publisher || x.key; }).join('・') + '）' : '';
      var pubs = out.round.filter(function (x) { return x.published.ok; }).map(function (x) { return Date.parse(x.published.at); });
      if (out.done && pubs.length) out.published = { ok: true, at: new Date(Math.max.apply(null, pubs)).toISOString() };
    }
    return out;
  }

  // ---- 保存（このブラウザ。顧客ごとの作業の同期は airreach-studio-clients.js） ----
  function load() { try { return (JSON.parse(localStorage.getItem(KEY) || 'null') || {}).pkg || null; } catch (e) { return null; } }
  function save(pkg) { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, pkg: pkg })); } catch (e) { return false; } return true; }

  // ---- Studio の ④ の画面（#review-box） ----
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function day(iso) { var t = Date.parse(iso); if (isNaN(t)) return ''; var d = new Date(t + 9 * 3600000); return d.getUTCFullYear() + '/' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2); }
  function fromLocal(v) { if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v || '')) return null; var t = Date.parse(v + ':00+09:00'); return isNaN(t) ? null : new Date(t).toISOString(); }
  var OP = { insert_before: '本文に追加', replace_one: '既存の文を置き換え', add_if_no_article: '無ければ新設・あれば既存を更新', replace_existing_article: '既存の記事データを置き換え' };
  function mountStudio() {
    var box = document.getElementById('review-box');
    if (!box) return;
    var msg = '', msgBad = false;
    function refreshSteps() { try { if (root.AirReachStudioSteps) root.AirReachStudioSteps.refresh(); } catch (e) {} }
    function put(pkg, text, bad) { save(pkg); msg = text || ''; msgBad = !!bad; draw(); refreshSteps(); }
    function draw() {
      var pkg = load(), S = state(pkg);
      var h = '<h3 class="arv-h">媒体の記事向けのレビュー用パッチ</h3>' +
        '<p class="ars-gnote">送付済みのレビュー用パッチ（ZIP）を、作り直さずに取り込みます。MANIFEST の指紋を確かめ、担当者が承認してから正式版にします。公開・照合・収録は記事ごとに記録します。</p>' +
        '<div class="ars-row arv-imp"><label class="ars-btn" for="review-file">ZIP を取り込む</label><input type="file" id="review-file" accept=".zip,application/zip" class="arv-file"></div>';
      if (msg) h += '<p class="ars-note' + (msgBad ? ' is-err' : '') + '" role="status">' + msg + '</p>';
      if (pkg) {
        h += '<div class="arv-sum"><b>' + esc(pkg.company) + '・' + pkg.items.length + '記事</b><small>版 ' + esc(pkg.version) + ' · MANIFEST の指紋 ' + esc(pkg.manifest_sha256.slice(0, 12)) + ' · 取り込み ' + esc(day(pkg.imported_at)) + '</small>' +
          '<span class="arv-badge ' + (S.official ? 'is-ok' : 'is-wait') + '">' + (S.official ? '承認済み（正式版）' + esc(day(pkg.approved.at)) + (pkg.approved.by ? '・' + esc(pkg.approved.by) : '') : '未承認（正式版ではありません）') + '</span></div>';
        h += '<div class="arc-table-wrap"><table class="arv-t"><thead><tr><th>媒体</th><th>対象の記事</th><th>会社説明</th><th>記事データ</th></tr></thead><tbody>' + pkg.items.map(function (it) {
          var c = it.changeset || {};
          return '<tr><td>' + esc(it.publisher) + '</td><td class="arv-url">' + esc(it.target_url) + '</td><td>' + esc(OP[(c.content || {}).operation] || '') + '<details><summary>全文</summary>' + it.content_blocks.map(function (b) { return '<p>' + esc(b) + '</p>'; }).join('') + '</details></td><td>' + esc(it.article.type) + '・' + esc(OP[(c.structured_data || {}).operation] || '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
        if (!S.official) {
          h += '<label class="arv-chk"><input type="checkbox" id="review-ok"> 会社説明の全文・記事データ・対象の記事を確かめました</label><button type="button" class="ars-btn ars-btn-primary" id="review-approve">承認して正式版にする</button>';
        } else {
          h += '<fieldset class="arv-round"><legend>今回の反映の対象（まとめて・段階的のどちらで進めるかに合わせて選ぶ）</legend>' + pkg.items.map(function (it) {
            return '<label class="arv-chk"><input type="checkbox" name="review-round" value="' + esc(it.key) + '"' + ((pkg.round || []).indexOf(it.key) >= 0 ? ' checked' : '') + '> ' + esc(it.publisher) + '</label>';
          }).join('') + '<button type="button" class="ars-btn" id="review-round-save">対象を決める</button></fieldset>';
          h += '<p class="arv-total ' + (S.done ? 'is-ok' : 'is-wait') + '" id="review-total">④ ' + (S.done ? '済み：今回の対象 ' + S.round.length + '記事すべて公開・照合済み' : '未完了：' + esc(S.why)) + '</p>';
          h += S.items.map(function (st) {
            var it = itemOf(pkg, st.key), k = esc(it.key), v = it.verified;
            return '<section class="arv-item" data-item="' + k + '"><h4>' + esc(it.publisher) + (st.inRound ? '' : '<small>（今回の対象外）</small>') + '</h4><p class="arv-url">' + esc(it.target_url) + '</p>' +
              '<p class="arv-st ' + (st.published.ok ? 'is-ok' : 'is-wait') + '">公開：' + (st.published.ok ? esc(day(st.published.at)) : esc(st.published.why)) + '</p>' +
              '<div class="apb-f"><label>公開した日時（日本時間）<input class="ars-input" type="datetime-local" data-pub-at></label><label>公開した記事の URL<input class="ars-input" data-pub-url inputmode="url" value="' + esc((it.published && it.published.url) || it.target_url) + '"></label><button type="button" class="ars-btn" data-pub-save>公開を記録する</button></div>' +
              '<p class="arv-st ' + (st.verified.ok ? 'is-ok' : st.verified.state === 'ng' ? 'is-ng' : 'is-wait') + '">照合：' + (st.verified.ok ? '見える形で入っている（' + esc(day(st.verified.at)) + '）' : esc(st.verified.why)) + '</p>' +
              (v && v.checks ? '<ul class="avf-list">' + v.checks.map(function (c) { return '<li class="is-' + esc(c.state) + '"><span><b>' + esc(c.label) + '</b><small>' + esc(c.detail) + '</small></span></li>'; }).join('') + '</ul>' : '') +
              '<div class="ars-row"><input class="ars-input" data-ver-url inputmode="url" value="' + esc((v && v.url) || it.target_url) + '"><button type="button" class="ars-btn ars-btn-primary" data-ver-run>確かめる</button></div>' +
              '<p class="arv-st ' + (st.indexed.ok ? 'is-ok' : 'is-wait') + '">Google の収録：' + (st.indexed.ok ? '確かめた ' + esc(day(st.indexed.at)) + '（' + esc(st.indexed.how) + '）' : '未確認') + '</p>' +
              '<div class="apb-f"><label>確かめた日時<input class="ars-input" type="datetime-local" data-ix-at></label><label>確かめ方<select class="ars-input" data-ix-how><option>Search Console の URL 検査</option><option>媒体側の確認</option><option>その他</option></select></label><button type="button" class="ars-btn" data-ix-save>収録を記録する</button></div></section>';
          }).join('');
        }
      }
      box.innerHTML = h;
      bind();
    }
    function bind() {
      var f = document.getElementById('review-file');
      if (f) f.addEventListener('change', function () {
        var file = f.files && f.files[0]; if (!file) return;
        msg = '確かめています…'; msgBad = false;
        file.arrayBuffer().then(function (buf) { return importZip(buf); }).then(function (r) {
          if (!r.ok) { msg = '取り込みませんでした：' + r.errors.map(esc).join('<br>'); msgBad = true; draw(); return; }
          var old = load();
          put(r.pkg, '取り込みました（未承認）。MANIFEST の指紋はすべて一致しました。内容を確かめて承認してください。' + (old && old.manifest_sha256 !== r.pkg.manifest_sha256 ? '前の版の承認・公開・照合の記録は、この版には使いません。' : ''));
        });
      });
      var ap = document.getElementById('review-approve');
      if (ap) ap.addEventListener('click', function () {
        if (!(document.getElementById('review-ok') || {}).checked) { msg = '承認する前に、確かめたことのチェックを入れてください。'; msgBad = true; draw(); return; }
        var pkg = load(), by = root.AirReachStudioClients && root.AirReachStudioClients.email ? root.AirReachStudioClients.email() : '';
        approve(pkg, by); put(pkg, '承認しました。この版が正式版です。');
      });
      var rs = document.getElementById('review-round-save');
      if (rs) rs.addEventListener('click', function () {
        var pkg = load(); setRound(pkg, Array.prototype.map.call(document.querySelectorAll('input[name="review-round"]:checked'), function (x) { return x.value; }));
        put(pkg, pkg.round.length ? '今回の対象を ' + pkg.round.length + '記事にしました。' : '今回の対象を選んでいません（④ は済みになりません）。');
      });
      Array.prototype.forEach.call(box.querySelectorAll('.arv-item'), function (sec) {
        var key = sec.getAttribute('data-item');
        sec.querySelector('[data-pub-save]').addEventListener('click', function () {
          var pkg = load(), r = recordPublish(pkg, key, fromLocal(sec.querySelector('[data-pub-at]').value), sec.querySelector('[data-pub-url]').value.trim());
          if (!r.ok) { msg = esc(r.error); msgBad = true; draw(); return; }
          put(pkg, '公開を記録しました。続けて「確かめる」で照合してください。');
        });
        sec.querySelector('[data-ix-save]').addEventListener('click', function () {
          var pkg = load(), r = recordIndexed(pkg, key, fromLocal(sec.querySelector('[data-ix-at]').value), sec.querySelector('[data-ix-how]').value);
          if (!r.ok) { msg = esc(r.error); msgBad = true; draw(); return; }
          put(pkg, 'Google の収録を記録しました。');
        });
        var run = sec.querySelector('[data-ver-run]');
        run.addEventListener('click', function () {
          var V = root.AirReachVerify, url = sec.querySelector('[data-ver-url]').value.trim(), it = itemOf(load(), key);
          if (!V || !V.runArticle) return;
          if (!/^https?:\/\//i.test(url)) { msg = 'https:// から始まる URL を入れてください。'; msgBad = true; draw(); return; }
          run.disabled = true; run.textContent = '確かめています…';
          V.runArticle(it, url).then(function (x) {
            var pkg = load(); recordVerify(pkg, key, x.res, x.meta);
            put(pkg, it.publisher + '：' + (x.res.ok ? '見える形で入っています。' : x.res.state === 'review' ? '要確認です。' : '入っていない・違うところがあります。'), !x.res.ok);
          }).catch(function (e) { msg = '確かめられませんでした：' + esc((e && e.message) || e); msgBad = true; draw(); });
        });
      });
    }
    draw();
  }
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountStudio); else mountStudio(); }

  var api = { KEY: KEY, RULE: RULE, readZip: readZip, importZip: importZip, blocksOf: blocksOf, official: official, approve: approve, setRound: setRound,
    recordPublish: recordPublish, recordIndexed: recordIndexed, recordVerify: recordVerify, itemState: itemState, state: state, itemOf: itemOf, urlKey: urlKey, load: load, save: save };
  root.AirReachReviewPkg = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
