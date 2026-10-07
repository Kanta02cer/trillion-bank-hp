/**
 * 会社・ブランド・サービスの確定と、FAQ の承認（依頼書 R01・R02・R03）。Studio の「直す材料」の下書き一式の上に出す。
 *   job.confirm = { rev, entity: { company, brand, service, url, at }, faq: { 質問文: { state: 'approved' | 'rejected', at } } }
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

  function commit(job) {
    job.confirm.rev = (job.confirm.rev || 0) + 1;
    var O = window.AirReachOrchestrator;
    if (O && O.refreshJobArtifacts) O.refreshJobArtifacts(job);
    window.__orchLastJob = job;
    render(job);
  }

  function render(job) {
    var box = q('orch-confirm');
    if (!box || !job) return;
    if (!job.confirm) job.confirm = { rev: 0, entity: null, faq: {} };
    var cf = job.confirm, ent = cf.entity && cf.entity.at ? cf.entity : null, p = job.profile || {};
    var mf = manifestOf(job), fc = mf.faq_counts || {}, items = (mf.faq_items || []).filter(function (f) { return f.status === 'site'; });
    var faqMd = String((job.files || {})['content/faq.md'] || '');
    function answerOf(qtext) { var i = faqMd.indexOf('. ' + qtext + '\n'); if (i < 0) return ''; var rest = faqMd.slice(i + qtext.length + 3); var end = rest.indexOf('\n## Q'); return (end < 0 ? rest : rest.slice(0, end)).trim(); }
    var html = '<section class="ocf" aria-label="確定と承認">' +
      '<p class="ocf-ver">版 <b>' + esc(mf.version != null ? mf.version : cf.rev || 0) + '</b> · よくある質問 提案 ' + esc(fc.proposed || 0) + '問・サイトの記載から ' + esc(fc.from_site || 0) + '問・承認 ' + esc(fc.approved || 0) + '問・<b>設置用に入れる ' + esc(fc.in_schema || 0) + '問</b>' + (fc.pending_approval ? '・承認待ち ' + esc(fc.pending_approval) + '問' : '') + '</p>';
    // ① 会社・ブランド・サービス
    if (ent) {
      html += '<div class="ocf-ent is-done"><div><b>① 会社・サービス：確定済み</b><span>' + esc(day(ent.at)) + '</span></div>' +
        '<dl><div><dt>会社</dt><dd>' + esc(ent.company) + '</dd></div><div><dt>ブランド・店名</dt><dd>' + esc(ent.brand) + '</dd></div><div><dt>サービス</dt><dd>' + esc(ent.service) + '</dd></div><div><dt>対象のサイト</dt><dd>' + esc(ent.url) + '</dd></div></dl>' +
        '<button type="button" class="ars-btn ars-btn-secondary" data-ocf="reopen">確定を取り消して直す</button></div>';
    } else {
      html += '<div class="ocf-ent"><div><b>① 会社・サービスを確定する</b><span>サイトから推定した値です。正しい名前に直して確定してください。確定するまで ZIP は下書きです。</span></div>' +
        '<div class="ocf-form">' +
        '<label>会社（正式名）<input class="ars-input" id="ocf-company" value="' + esc(p.company || p.brand || '') + '" autocomplete="off"></label>' +
        '<label>ブランド・店名<input class="ars-input" id="ocf-brand" value="' + esc(p.brand || '') + '" autocomplete="off"></label>' +
        '<label>サービス<input class="ars-input" id="ocf-service" value="' + esc(p.service || '') + '" autocomplete="off"></label>' +
        '<label>対象のサイト<input class="ars-input" id="ocf-url" value="' + esc(job.url || '') + '" readonly></label></div>' +
        '<p class="ocf-err" id="ocf-err" hidden></p>' +
        '<button type="button" class="ars-btn ars-btn-primary" data-ocf="confirm">この内容で確定する</button></div>';
    }
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
    var ready = ent && !fc.pending_approval;
    html += '<p class="ocf-gate' + (ready ? ' is-ok' : '') + '">' + (ready ? '確定と承認が済みました。ZIP は公開用として作れます（公開前の確認は README の手順で）。' : 'まだ下書きです：' + [!ent ? '会社・サービスが未確定' : '', fc.pending_approval ? '承認待ちの質問が ' + fc.pending_approval + '問' : ''].filter(Boolean).join('・') + '。ZIP は「-DRAFT」として保存されます。') + '</p></section>';
    box.innerHTML = html;

    var cbtn = box.querySelector('[data-ocf="confirm"]');
    if (cbtn) cbtn.addEventListener('click', function () {
      var company = q('ocf-company').value.trim(), brand = q('ocf-brand').value.trim(), service = q('ocf-service').value.trim();
      var err = q('ocf-err'), bad = [];
      if (company.length < 2) bad.push('会社（正式名）');
      if (brand.length < 2) bad.push('ブランド・店名');
      if (service.length < 2) bad.push('サービス');
      if (bad.length) { err.hidden = false; err.textContent = bad.join('・') + ' を2文字以上で入れてください。'; return; }
      cf.entity = { company: company, brand: brand, service: service, url: job.url, at: new Date().toISOString() };
      job.profile = Object.assign({}, job.profile || {}, { brand: brand, service: service, company: company });
      commit(job);
    });
    var rbtn = box.querySelector('[data-ocf="reopen"]');
    if (rbtn) rbtn.addEventListener('click', function () { cf.entity = null; commit(job); });
    Array.prototype.forEach.call(box.querySelectorAll('[data-ocf-q]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-ocf-q'), st = b.getAttribute('data-ocf-st');
        if (st) cf.faq[k] = { state: st, at: new Date().toISOString() }; else delete cf.faq[k];
        commit(job);
      });
    });
  }

  window.AirReachConfirm = { render: render, _hostOf: hostOf };
})();
