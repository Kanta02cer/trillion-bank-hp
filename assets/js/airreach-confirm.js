/**
 * 会社・ブランド・サービスの確定と、FAQ の承認（依頼書 R01・R02・R03）。Studio の「直す材料」の下書き一式の上に出す。
 *   job.confirm = { rev, entity: { company, brand, service, url, at }, faq: { 質問文: { state: 'approved' | 'rejected', at } },
 *                   pages: [ページごとのデータ（手順・製品と価格・サービスの価格）。形と決まりは airreach-page-schema.js], pages_seq }
 *   変えるたびに rev を1つ増やし、ZIP の中身（MANIFEST の version・件数・README・faq.md・faq.jsonld）を作り直す。
 *   画面に出す版と件数は、作り直した MANIFEST から読む（画面と ZIP で数がずれない）
 */
(function () {
  'use strict';
  function q(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } }
  function manifestOf(job) { try { return JSON.parse((job.files || {})['MANIFEST.json'] || '{}'); } catch (e) { return {}; } }
  function day(iso) { var t = Date.parse(iso); if (isNaN(t)) return ''; var d = new Date(t + 9 * 3600000); return d.getUTCFullYear() + '/' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2); }

  // サービス名がキャッチコピーらしいか（依頼書 R01：キャッチコピーをサービス名として確定しない）。判断できないときは人に確かめてもらう
  function looksLikeCatchphrase(t) {
    t = String(t || '').trim();
    if (!t) return false;
    if (t.length > 24) return true;
    if (/[。！!？?♪★☆…]/.test(t)) return true;
    if (/(です|ます|ません|ませんか|しよう|しませんか|ください|叶える|届けます|変える|つくる|あなた|私たち)$/.test(t)) return true;
    if (/[、,]/.test(t) && t.length > 12) return true;
    return false;
  }
  function entBox0() { return !!q('orch-entity'); }
  function commit(job) {
    job.confirm.rev = (job.confirm.rev || 0) + 1;
    var O = window.AirReachOrchestrator;
    if (O && O.refreshJobArtifacts) O.refreshJobArtifacts(job);
    window.__orchLastJob = job;
    render(job);
    try { if (window.AirReachStudioSteps) window.AirReachStudioSteps.refresh(); } catch (e) {}
  }

  // ③ ページごとのデータ（手順・製品と価格・サービスの価格）。ページを読んで本文と照らし、承認したものだけを ZIP に入れる
  function pagesHtml(job, cf, PS) {
    var ctx = { url: job.url, industry: job.industry || '' }, food = job.industry === 'restaurant';
    var h = '<div class="ocf-faq ocf-pages"><div><b>③ ページごとのデータ（手順・製品と価格）</b><span>ページに書いてある手順や料金を、検索や AI が読む形のデータにします。ページを読んで本文と照らし、承認したものだけを ZIP に入れます。入れたあとに AI の答えが変わるかは、前後の計測で確かめます。</span></div>';
    if (cf.pages.length) h += '<ol>' + cf.pages.map(function (e) {
      var errs = PS.validate(e, ctx), ck = e.checked || null, can = !errs.length && !!(ck && ck.ok), st = e.state || '', how = e.type === 'howto';
      var body = how ? PS.stepsText(e) : PS.itemsText(e);
      return '<li class="ocf-q' + (st ? ' is-' + st : '') + '" data-ocp="' + esc(e.id) + '">' +
        '<p class="ocf-qt">' + esc(PS.TYPES[e.type]) + '</p><p class="ocf-src">入れるページ：<a href="' + esc(e.url) + '" target="_blank" rel="noopener noreferrer">' + esc(e.url) + '</a></p>' +
        (e.type === 'service_price' ? '' : '<label class="ocf-pl">' + (how ? '手順の名前' : '名前（一覧の見出し）') + '<input class="ars-input" data-ocp-name value="' + esc(e.name || '') + '" autocomplete="off"></label>') +
        '<label class="ocf-pl">' + (how ? '手順（1行に1つ。ページに書いてある文のまま）' : '品名と価格（1行に「品名 | 価格」。「〜から」の価格は数字のあとに「〜」）') +
        '<textarea class="ars-input ocf-ta" data-ocp-body rows="' + Math.min(12, Math.max(3, body.split('\n').length + 1)) + '">' + esc(body) + '</textarea></label>' +
        (errs.length ? '<p class="ocf-err">' + esc(errs.join('／')) + '</p>' : '') +
        '<p class="ocf-src">' + (!ck ? 'まだページの本文と照らしていません。' : ck.ok ? 'ページの本文と一致しました（' + esc(day(ck.at)) + '）。' : 'ページの本文と違うところがあります：' + esc((ck.missing || []).join('／'))) + '</p>' +
        '<p class="ocf-err" data-ocp-err hidden></p>' +
        '<div class="ocf-act"><span class="ocf-st">' + (st === 'approved' ? '承認済み ' + esc(day(e.at)) : st === 'rejected' ? '使わない' : '承認待ち') + '</span>' +
        '<button type="button" class="ars-btn ars-btn-secondary" data-ocp-act="check">直した内容でページと照らす</button>' +
        '<button type="button" class="ars-btn ars-btn-secondary" data-ocp-act="approved"' + (st === 'approved' || !can ? ' disabled' : '') + '>承認する</button>' +
        '<button type="button" class="ars-btn ars-btn-secondary" data-ocp-act="rejected"' + (st === 'rejected' ? ' disabled' : '') + '>使わない</button>' +
        (st ? '<button type="button" class="ars-btn ars-btn-secondary" data-ocp-act="">戻す</button>' : '<button type="button" class="ars-btn ars-btn-secondary" data-ocp-act="delete">消す</button>') + '</div></li>';
    }).join('') + '</ol>';
    else h += '<p class="ocf-none">まだありません。手順や料金が書いてあるページの URL を入れて追加します。</p>';
    h += '<div class="ocf-form"><label>種類<select class="ars-input" id="ocp-type">' + Object.keys(PS.TYPES).filter(function (k) { return !(food && k === 'service_price'); }).map(function (k) { return '<option value="' + k + '">' + esc(PS.TYPES[k]) + '</option>'; }).join('') + '</select></label>' +
      '<label>ページの URL<input class="ars-input" id="ocp-url" placeholder="' + esc(String(job.url || '').replace(/\/+$/, '')) + '/price/" autocomplete="off"></label></div>' +
      '<p class="ocf-err" id="ocp-err" hidden></p><button type="button" class="ars-btn ars-btn-secondary" data-ocp-add>ページを読んで候補を出す</button>';
    return h + '</div>';
  }
  function bindPages(job, cf, PS, box) {
    var ctx = { url: job.url, industry: job.industry || '' };
    function readPage(url) {
      return PS.fetchDoc(url).then(function (d) {
        if (!d || d.status >= 400) throw new Error('ページを読めませんでした（' + ((d && d.status) || '応答なし') + '）');
        if (hostOf(d.finalUrl) !== hostOf(url)) throw new Error('別のサイト（' + hostOf(d.finalUrl) + '）に転送されました');
        return d.body;
      });
    }
    var add = box.querySelector('[data-ocp-add]');
    if (add) add.addEventListener('click', function () {
      var err = q('ocp-err'), type = q('ocp-type').value, url = q('ocp-url').value.trim();
      var e = { id: 'p' + ((cf.pages_seq || 0) + 1), type: type, url: url, name: '', steps: [], items: [], state: '', at: '', checked: null };
      var bad = PS.validate(e, ctx).filter(function (m) { return /URL|サイト|飲食店/.test(m); });
      if (bad.length) { err.hidden = false; err.textContent = bad.join('／'); return; }
      if (cf.pages.some(function (x) { return x.type === type && x.url === url; })) { err.hidden = false; err.textContent = 'このページの同じ種類は、すでにあります。上の欄を直してください。'; return; }
      add.disabled = true; add.textContent = 'ページを読んでいます…';
      readPage(url).then(function (html) {
        if (type === 'howto') { var c = PS.extractSteps(html)[0]; if (c) { e.steps = c.steps; e.name = c.title; } }
        else e.items = PS.extractPrices(html).map(function (i) { return { name: i.name, price: i.price, from: i.from }; });
        if (!PS.validate(e, ctx).length) e.checked = Object.assign(PS.match(e, html), { at: new Date().toISOString() });
        cf.pages_seq = (cf.pages_seq || 0) + 1;
        cf.pages.push(e);
        commit(job);
      }).catch(function (x) { add.disabled = false; add.textContent = 'ページを読んで候補を出す'; err.hidden = false; err.textContent = (x && x.message) || 'ページを読めませんでした'; });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-ocp]'), function (li) {
      var e = cf.pages.filter(function (x) { return x.id === li.getAttribute('data-ocp'); })[0];
      if (!e) return;
      var nameEl = li.querySelector('[data-ocp-name]'), bodyEl = li.querySelector('[data-ocp-body]'), err = li.querySelector('[data-ocp-err]');
      function edited() { return (nameEl && nameEl.value.trim() !== String(e.name || '')) || bodyEl.value.trim() !== (e.type === 'howto' ? PS.stepsText(e) : PS.itemsText(e)).trim(); }
      Array.prototype.forEach.call(li.querySelectorAll('[data-ocp-act]'), function (b) {
        b.addEventListener('click', function () {
          var act = b.getAttribute('data-ocp-act');
          if (act === 'delete') { cf.pages = cf.pages.filter(function (x) { return x !== e; }); commit(job); return; }
          if (act === 'check') {
            // 直したら承認は取り消す（承認したのは、直す前の内容）
            if (nameEl) e.name = nameEl.value.trim();
            if (e.type === 'howto') e.steps = PS.parseSteps(bodyEl.value); else e.items = PS.parseItems(bodyEl.value);
            e.state = ''; e.at = ''; e.checked = null;
            if (PS.validate(e, ctx).length) { commit(job); return; }
            b.disabled = true; b.textContent = 'ページを読んでいます…';
            readPage(e.url).then(function (html) { e.checked = Object.assign(PS.match(e, html), { at: new Date().toISOString() }); commit(job); })
              .catch(function (x) { e.checked = { ok: false, missing: [(x && x.message) || 'ページを読めませんでした'], at: new Date().toISOString(), rule: PS.RULE }; commit(job); });
            return;
          }
          if (act === 'approved') {
            if (edited()) { err.hidden = false; err.textContent = '欄を直しています。先に「直した内容でページと照らす」を押してください。'; return; }
            if (!PS.validate(e, ctx).length && e.checked && e.checked.ok) { e.state = 'approved'; e.at = new Date().toISOString(); commit(job); }
            return;
          }
          e.state = act; e.at = act ? new Date().toISOString() : '';
          commit(job);
        });
      });
    });
  }

  function render(job) {
    var box = q('orch-confirm');
    if (!box || !job) return;
    if (!job.confirm) job.confirm = { rev: 0, entity: null, faq: {} };
    if (!Array.isArray(job.confirm.pages)) job.confirm.pages = [];
    var cf = job.confirm, ent = cf.entity && cf.entity.at ? cf.entity : null, p = job.profile || {};
    var mf = manifestOf(job), fc = mf.faq_counts || {}, items = (mf.faq_items || []).filter(function (f) { return f.status === 'site'; });
    var faqMd = String((job.files || {})['content/faq.md'] || '');
    function answerOf(qtext) { var i = faqMd.indexOf('. ' + qtext + '\n'); if (i < 0) return ''; var rest = faqMd.slice(i + qtext.length + 3); var end = rest.indexOf('\n## Q'); return (end < 0 ? rest : rest.slice(0, end)).trim(); }
    // いま Studio で開いている顧客（依頼書 R01：対象 URL・会社・サービスと顧客 ID をひとまとまりで確かめる）
    var cli = null; try { cli = JSON.parse(sessionStorage.getItem('airreach_studio_client_v1') || 'null'); } catch (e) {}
    var cliHtml = !cli || !cli.id ? '<p class="ocf-cli is-none">顧客：選んでいません（顧客を選ぶと、ZIP の記録に顧客 ID が入ります）</p>'
      : (cli.url && hostOf(cli.url) !== hostOf(job.url)) ? '<p class="ocf-cli is-bad">顧客：' + esc(cli.name || '') + '（' + esc(String(cli.id).slice(0, 8)) + '）の登録サイトは ' + esc(hostOf(cli.url)) + ' です。分析したサイト ' + esc(hostOf(job.url)) + ' と違うため、ZIP に顧客 ID を入れません。顧客かサイトを確かめてください。</p>'
      : '<p class="ocf-cli">顧客：<b>' + esc(cli.name || '') + '</b>（ID ' + esc(String(cli.id).slice(0, 8)) + '…）· 対象のサイト ' + esc(hostOf(job.url)) + '</p>';
    var html = '<section class="ocf" aria-label="確定と承認">' +
      (entBox0() ? '' : cliHtml) + '<p class="ocf-ver">版 <b>' + esc(mf.version != null ? mf.version : cf.rev || 0) + '</b> · よくある質問 提案 ' + esc(fc.proposed || 0) + '問・サイトの記載から ' + esc(fc.from_site || 0) + '問・承認 ' + esc(fc.approved || 0) + '問・<b>設置用に入れる ' + esc(fc.in_schema || 0) + '問</b>' + (fc.pending_approval ? '・承認待ち ' + esc(fc.pending_approval) + '問' : '') + '</p>';
    // ① 会社・ブランド・サービス（Studio の「① 結果と確定」に #orch-entity があればそこへ、無ければここへ）
    var entHtml = '';
    if (ent) {
      entHtml += '<div class="ocf-ent is-done"><div><b>① 会社・サービス：確定済み</b><span>' + esc(day(ent.at)) + '</span></div>' +
        '<dl><div><dt>会社</dt><dd>' + esc(ent.company) + '</dd></div><div><dt>ブランド・店名</dt><dd>' + esc(ent.brand) + '</dd></div><div><dt>サービス</dt><dd>' + esc(ent.service) + '</dd></div><div><dt>対象のサイト</dt><dd>' + esc(ent.url) + '</dd></div></dl>' +
        '<button type="button" class="ars-btn ars-btn-secondary" data-ocf="reopen">確定を取り消して直す</button></div>';
    } else {
      entHtml += '<div class="ocf-ent"><div><b>① 会社・サービスを確定する</b><span>サイトから推定した値です。正しい名前に直して確定してください。確定するまで ZIP は下書きです。</span></div>' +
        '<div class="ocf-form">' +
        '<label>会社（正式名）<input class="ars-input" id="ocf-company" value="' + esc(p.company || p.brand || '') + '" autocomplete="off"></label>' +
        '<label>ブランド・店名<input class="ars-input" id="ocf-brand" value="' + esc(p.brand || '') + '" autocomplete="off"></label>' +
        '<label>サービス<input class="ars-input" id="ocf-service" value="' + esc(p.service || '') + '" autocomplete="off"></label>' +
        '<label>対象のサイト<input class="ars-input" id="ocf-url" value="' + esc(job.url || '') + '" readonly></label></div>' +
        (looksLikeCatchphrase(p.service) ? '<p class="ocf-err" id="ocf-catch-pre">サービスの欄がキャッチコピー（宣伝の文）のようです。「ホームページ制作」「縮毛矯正」のような、サービスの名前に直してください。</p>' : '') +
        '<label class="ocf-ack" id="ocf-ack-wrap" hidden><input type="checkbox" id="ocf-ack"> これはサービスの名前です（キャッチコピーではありません）</label>' +
        '<p class="ocf-err" id="ocf-err" hidden></p>' +
        '<button type="button" class="ars-btn ars-btn-primary" data-ocf="confirm">この内容で確定する</button></div>';
    }
    var entBox = q('orch-entity');
    if (entBox) {
      // ③ の画面には、確定の結果だけを1行で（直すのは ① で）
      html += ent ? '<p class="ocf-cli">会社・サービス：<b>' + esc(ent.company) + '</b>・' + esc(ent.service) + '（' + esc(day(ent.at)) + ' 確定）</p>'
        : '<p class="ocf-cli is-bad">会社・サービスがまだ確定していません。<button type="button" class="ars-btn ars-btn-secondary" data-ocf="goto-entity">① で確定する</button></p>';
    } else html += entHtml;
    // ② FAQ の承認（サイトの記載から作った答えだけ。確認が必要な質問は faq.md で書き足す）
    html += '<div class="ocf-faq"><div><b>② よくある質問を承認する</b><span>承認した答えだけを、検索や AI が読む形のデータ（faq.jsonld）に入れます。</span></div>';
    if (!items.length) html += '<p class="ocf-none">サイトの記載から作れた答えはありません。faq.md で答えを書いてから載せてください。</p>';
    else html += '<ol>' + items.map(function (f) {
      var a = cf.faq[f.q] || {}, st = a.state || '';
      return '<li class="ocf-q' + (st ? ' is-' + st : '') + '"><p class="ocf-qt">' + esc(f.q) + '</p><p class="ocf-a">' + esc(answerOf(f.q).replace(/\n> 元にしたサイトの記載：[\s\S]*$/, '').replace(/\n状態：[\s\S]*$/, '')) + '</p>' +
        '<p class="ocf-src">出典：' + (f.source_url ? '<a href="' + esc(f.source_url) + '" target="_blank" rel="noopener noreferrer">' + esc(f.source_url) + '</a>' : 'サイトの本文') + (f.fetched_at ? ' · 取得 ' + esc(day(f.fetched_at)) : '') + '</p>' +
        '<div class="ocf-act"><span class="ocf-st">' + (st === 'approved' ? '承認済み ' + esc(day(a.at)) : st === 'rejected' ? '使わない' : '承認待ち') + '</span>' +
        '<button type="button" class="ars-btn ars-btn-secondary" data-ocf-q="' + esc(f.q) + '" data-ocf-st="approved"' + (st === 'approved' ? ' disabled' : '') + '>承認する</button>' +
        '<button type="button" class="ars-btn ars-btn-secondary" data-ocf-q="' + esc(f.q) + '" data-ocf-st="rejected"' + (st === 'rejected' ? ' disabled' : '') + '>使わない</button>' +
        (st ? '<button type="button" class="ars-btn ars-btn-secondary" data-ocf-q="' + esc(f.q) + '" data-ocf-st="">戻す</button>' : '') + '</div></li>';
    }).join('') + '</ol>';
    html += '</div>';
    var PS = window.AirReachPageSchema, pend = (mf.page_schema_counts && mf.page_schema_counts.pending) || 0;
    if (PS) html += pagesHtml(job, cf, PS);
    var ready = ent && !fc.pending_approval && !pend;
    html += '<p class="ocf-gate' + (ready ? ' is-ok' : '') + '">' + (ready ? '確定と承認が済みました。ZIP は公開用として作れます（公開前の確認は README の手順で）。' : 'まだ下書きです：' + [!ent ? '会社・サービスが未確定' : '', fc.pending_approval ? '承認待ちの質問が ' + fc.pending_approval + '問' : '', pend ? '承認待ちのページごとのデータが ' + pend + '件（承認するか「使わない」にします）' : ''].filter(Boolean).join('・') + '。ZIP は「-DRAFT」として保存されます。') + '</p></section>';
    box.innerHTML = html;
    if (entBox) entBox.innerHTML = '<section class="ocf" aria-label="会社・サービスの確定">' + cliHtml + entHtml + '</section>';
    var scope = document;
    var gEnt = box.querySelector('[data-ocf="goto-entity"]');
    if (gEnt) gEnt.addEventListener('click', function () { var b = document.querySelector('.ars-side button[data-panel="result"]'); if (b) { b.hidden = false; b.click(); } });

    var cbtn = scope.querySelector('[data-ocf="confirm"]');
    if (cbtn) cbtn.addEventListener('click', function () {
      var company = q('ocf-company').value.trim(), brand = q('ocf-brand').value.trim(), service = q('ocf-service').value.trim();
      var err = q('ocf-err'), bad = [];
      if (company.length < 2) bad.push('会社（正式名）');
      if (brand.length < 2) bad.push('ブランド・店名');
      if (service.length < 2) bad.push('サービス');
      if (bad.length) { err.hidden = false; err.textContent = bad.join('・') + ' を2文字以上で入れてください。'; return; }
      // キャッチコピーらしいサービス名は、人が「サービスの名前です」と確かめるまで確定しない
      var ack = q('ocf-ack'), ackWrap = q('ocf-ack-wrap');
      if (looksLikeCatchphrase(service) && !(ack && ack.checked)) {
        err.hidden = false; err.textContent = '「' + service + '」はキャッチコピーのようです。サービスの名前に直すか、サービスの名前で合っていれば下のチェックを入れてから確定してください。';
        if (ackWrap) ackWrap.hidden = false;
        return;
      }
      cf.entity = { company: company, brand: brand, service: service, url: job.url, at: new Date().toISOString() };
      job.profile = Object.assign({}, job.profile || {}, { brand: brand, service: service, company: company });
      commit(job);
    });
    if (PS) bindPages(job, cf, PS, box);
    var rbtn = scope.querySelector('[data-ocf="reopen"]');
    if (rbtn) rbtn.addEventListener('click', function () { cf.entity = null; commit(job); });
    Array.prototype.forEach.call(box.querySelectorAll('[data-ocf-q]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-ocf-q'), st = b.getAttribute('data-ocf-st');
        if (st) cf.faq[k] = { state: st, at: new Date().toISOString() }; else delete cf.faq[k];
        commit(job);
      });
    });
  }

  window.AirReachConfirm = { render: render, looksLikeCatchphrase: looksLikeCatchphrase, _hostOf: hostOf };
})();
