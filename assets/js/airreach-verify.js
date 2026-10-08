/**
 * ④ 入れたか確かめる：公開ページと llms.txt を読み、ZIP（承認した FAQ・構造化データ・llms.txt）と同じものが入っているかを判定する。
 *   取得は公開ページの取得口（/api/airreach/fetch。私的なアドレスは断る）を使う。ページは保存しない。
 *   分かるのは「サイトに入ったか」まで。Google が読んだか・効果が出たかは別（Search Console と導入後の計測）
 */
(function (root) {
  'use strict';
  function norm(t) { return String(t || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[\s　]+/g, '').toLowerCase(); }
  /** ページの見える文字（script・style・タグを除く） */
  function visibleText(html) {
    return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ');
  }
  /** ページの JSON-LD を全部読む（@graph の中も平らにする）。読めないブロックは数だけ数える */
  function jsonLd(html) {
    var out = [], broken = 0, re = /<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi, m;
    while ((m = re.exec(String(html || '')))) {
      try {
        var j = JSON.parse(m[1].trim());
        (Array.isArray(j) ? j : [j]).forEach(function (x) { if (x && Array.isArray(x['@graph'])) x['@graph'].forEach(function (g) { out.push(g); }); else if (x) out.push(x); });
      } catch (e) { broken += 1; }
    }
    return { items: out, broken: broken };
  }
  function types(x) { var t = x && x['@type']; return (Array.isArray(t) ? t : [t]).filter(Boolean).map(String); }
  var ORG = /^(Organization|LocalBusiness|Restaurant|Store|HairSalon|BeautySalon|DaySpa|MedicalClinic|Dentist|Physician|LegalService|ProfessionalService|HomeAndConstructionBusiness|GeneralContractor|AutomotiveBusiness|FoodEstablishment|CafeOrCoffeeShop|BarOrPub|Hotel|LodgingBusiness)$/;
  function parse(s) { try { return JSON.parse(s || ''); } catch (e) { return null; } }

  /**
   * job：Studio の分析（files に ZIP の中身）。page：{ url, status, html }。llms：{ url, status, text }（無ければ null）
   * 戻り値：{ checks: [{ key, label, state: ok|warn|ng|skip, detail }], ok }
   */
  function judge(job, page, llms) {
    var files = (job && job.files) || {}, checks = [];
    // 比べる相手：正式な ZIP を作ったときの中身（job.zipped）。無ければいまの承認の内容
    var snap = job && job.zipped && !job.zipped.draft && Array.isArray(job.zipped.faq) ? job.zipped : null;
    var faq = parse(files['schema/faq.jsonld']), org = parse(files['schema/organization.jsonld']);
    var qs = snap ? snap.faq.slice() : (faq && Array.isArray(faq.mainEntity) ? faq.mainEntity.map(function (x) { return { q: String(x.name || ''), a: String((x.acceptedAnswer && x.acceptedAnswer.text) || '') }; }) : []);
    if (snap) { org = { name: snap.org_name }; files = Object.assign({}, files, { 'public/llms.txt': snap.llms }); }
    if (!page || page.status !== 200 || !page.html) {
      checks.push({ key: 'page', label: 'ページを読めた', state: 'ng', detail: page && page.status ? 'ページを読めませんでした（' + page.status + '）。URL を確かめてください' : 'ページを読めませんでした' });
      return { checks: checks, ok: false };
    }
    var text = norm(visibleText(page.html)), ld = jsonLd(page.html);
    // 1. 承認した FAQ がページに表示されているか（質問と答えの文）
    if (!qs.length) checks.push({ key: 'faq_text', label: '承認したよくある質問がページに出ている', state: 'skip', detail: 'パッチに承認したよくある質問がありません' });
    else {
      var shown = qs.filter(function (x) { return text.indexOf(norm(x.q)) >= 0 && text.indexOf(norm(x.a).slice(0, 40)) >= 0; });
      var miss = qs.filter(function (x) { return shown.indexOf(x) < 0; });
      checks.push({ key: 'faq_text', label: '承認したよくある質問がページに出ている', state: miss.length ? 'ng' : 'ok',
        detail: shown.length + ' / ' + qs.length + '問' + (miss.length ? '。出ていない：' + miss.map(function (x) { return '「' + x.q + '」'; }).join('・') : '') });
    }
    // 2. よくある質問の構造化データ（FAQPage）がパッチと同じか
    var faqPages = ld.items.filter(function (x) { return types(x).indexOf('FAQPage') >= 0; });
    if (!qs.length) checks.push({ key: 'faq_ld', label: 'よくある質問の構造化データ', state: 'skip', detail: 'パッチに入れていません（承認した質問が0問）' });
    else if (!faqPages.length) checks.push({ key: 'faq_ld', label: 'よくある質問の構造化データ', state: 'ng', detail: 'ページに FAQPage のデータがありません' });
    else {
      var names = []; faqPages.forEach(function (fp) { (fp.mainEntity || []).forEach(function (q) { names.push(norm(q && q.name)); }); });
      var lack = qs.filter(function (x) { return names.indexOf(norm(x.q)) < 0; });
      checks.push({ key: 'faq_ld', label: 'よくある質問の構造化データ', state: lack.length ? 'ng' : (faqPages.length > 1 ? 'warn' : 'ok'),
        detail: lack.length ? 'パッチの質問のうち ' + lack.length + '問がデータにありません' : (faqPages.length > 1 ? 'FAQPage が ' + faqPages.length + 'つあります（1つにまとめてください）' : 'パッチと同じ ' + qs.length + '問') });
    }
    // 3. 会社・お店の情報のデータ（二重になっていないか・名前が合っているか）
    var orgs = ld.items.filter(function (x) { return types(x).some(function (t) { return ORG.test(t); }); });
    var want = org && (org.name || '');
    if (!orgs.length) checks.push({ key: 'org', label: 'お店・会社の情報のデータ', state: 'warn', detail: 'このページにはありません（トップページに入れる手順のときは、トップページの URL でも確かめてください）' });
    else if (orgs.length > 1) checks.push({ key: 'org', label: 'お店・会社の情報のデータ', state: 'warn', detail: orgs.length + 'つあります。テーマやプラグインと二重になっていないか確かめてください（手順書の 2-2）' });
    else checks.push({ key: 'org', label: 'お店・会社の情報のデータ', state: want && norm(orgs[0].name) !== norm(want) && norm(orgs[0].alternateName) !== norm(want) ? 'warn' : 'ok', detail: '名前：' + (orgs[0].name || '（なし）') + (want && norm(orgs[0].name) !== norm(want) ? '（パッチは ' + want + '）' : '') });
    if (ld.broken) checks.push({ key: 'ld_broken', label: '読めない構造化データ', state: 'ng', detail: ld.broken + 'つのデータが JSON として読めません（貼るときに崩れた可能性）' });
    // 4. AI 向けの案内ファイル
    var wantL = files['public/llms.txt'];
    if (!wantL) checks.push({ key: 'llms', label: 'AI 向けの案内ファイル（llms.txt）', state: 'skip', detail: 'パッチに入れていません' });
    else if (!llms || llms.status !== 200) checks.push({ key: 'llms', label: 'AI 向けの案内ファイル（llms.txt）', state: 'ng', detail: '開けませんでした' + (llms && llms.status ? '（' + llms.status + '）' : '') + '。サイトの一番上に置いてください' });
    else checks.push({ key: 'llms', label: 'AI 向けの案内ファイル（llms.txt）', state: norm(llms.text) === norm(wantL) ? 'ok' : 'warn', detail: norm(llms.text) === norm(wantL) ? 'パッチと同じ' : '開けますが、パッチと中身が違います' });
    var ok = !checks.some(function (c) { return c.state === 'ng'; });
    return { checks: checks, ok: ok };
  }

  /** 公開ページの取得口で読む（ブラウザから）。戻り値 { url, status, html|text, finalUrl } */
  function fetchDoc(url) {
    return fetch('/api/airreach/fetch?url=' + encodeURIComponent(url), { headers: { Accept: 'text/html,text/plain,*/*' } })
      .then(function (r) { return r.text().then(function (t) { return { url: url, status: r.status, body: t, finalUrl: r.headers.get('X-AirReach-Final-URL') || url }; }); });
  }
  /** ページと llms.txt を読んで判定し、分析（job.verified）に残す */
  function run(job, pageUrl) {
    var origin = ''; try { origin = new URL(pageUrl).origin; } catch (e) {}
    return Promise.all([fetchDoc(pageUrl), origin ? fetchDoc(origin + '/llms.txt').catch(function () { return null; }) : Promise.resolve(null)]).then(function (rs) {
      var res = judge(job, { url: pageUrl, status: rs[0].status, html: rs[0].body }, rs[1] ? { url: rs[1].url, status: rs[1].status, text: rs[1].body } : null);
      var mf = parse((job.files || {})['MANIFEST.json']) || {};
      job.verified = { at: new Date().toISOString(), url: pageUrl, ok: res.ok, version: mf.package_version || '', checks: res.checks };
      return res;
    });
  }

  // ---- Studio の「④ 入れたか確かめる」の画面 -------------------------------------------------
  var LABEL = { ok: '入っている', warn: '確かめてください', ng: '入っていない', skip: '対象外' };
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function jobNow() { try { return root.__orchLastJob || (JSON.parse(localStorage.getItem('airreach_studio_orch_v1') || 'null') || {}).lastJob || null; } catch (e) { return null; } }
  function day(iso) { var t = Date.parse(iso); if (isNaN(t)) return ''; var d = new Date(t + 9 * 3600000); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2); }
  function resultHtml(v) {
    if (!v) return '';
    return '<div class="avf-res ' + (v.ok ? 'is-ok' : 'is-ng') + '"><b>' + (v.ok ? 'パッチはサイトに入っています' : 'まだ入っていないところがあります') + '</b><small>' + esc(day(v.at)) + ' · ' + esc(v.url) + (v.version ? ' · パッチ v' + esc(v.version) : '') + '</small></div>' +
      '<ul class="avf-list">' + (v.checks || []).map(function (c) {
        return '<li class="is-' + esc(c.state) + '"><span class="avf-mark" aria-hidden="true">' + ({ ok: '✓', warn: '!', ng: '×', skip: '−' }[c.state] || '') + '</span><span><b>' + esc(c.label) + '</b><small>' + esc(LABEL[c.state] || '') + '：' + esc(c.detail) + '</small></span></li>';
      }).join('') + '</ul>';
  }
  function mountStudio() {
    var btn = document.getElementById('verify-run'), input = document.getElementById('verify-url'), out = document.getElementById('verify-result'), note = document.getElementById('verify-zip-note');
    if (!btn || !input || !out) return;
    function show() {
      var job = jobNow();
      if (note) note.textContent = !job ? '先に「サイトを調べる」と「③ パッチを作る」を行ってください。' : (job.zipped && !job.zipped.draft ? 'パッチ v' + (job.zipped.version || '') + '（' + day(job.zipped.at) + ' に作成）と比べます。' : 'まだ正式なパッチ（ZIP）を作っていません。いまの承認の内容と比べます。');
      if (job && !input.value) input.value = (job.verified && job.verified.url) || job.url || '';
      out.innerHTML = resultHtml(job && job.verified);
    }
    btn.addEventListener('click', function () {
      var job = jobNow(), url = input.value.trim();
      if (!job) { out.innerHTML = '<p class="ars-note is-err">先に「サイトを調べる」を行ってください。</p>'; return; }
      if (!/^https?:\/\//i.test(url)) { out.innerHTML = '<p class="ars-note is-err">https:// から始まる URL を入れてください。</p>'; return; }
      btn.disabled = true; btn.textContent = '確かめています…';
      run(job, url).then(function () {
        root.__orchLastJob = job;
        try { localStorage.setItem('airreach_studio_orch_v1', JSON.stringify({ lastJob: job })); } catch (e) {}
        try { if (root.AirReachStudioSteps) root.AirReachStudioSteps.refresh(); } catch (e) {}
        show();
      }).catch(function (e) { out.innerHTML = '<p class="ars-note is-err">確かめられませんでした：' + esc((e && e.message) || e) + '</p>'; })
        .then(function () { btn.disabled = false; btn.textContent = '確かめる'; });
    });
    show();
    document.addEventListener('click', function (e) { if (e.target && e.target.closest && e.target.closest('.ars-side button[data-panel="verify"]')) setTimeout(show, 30); });
  }
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountStudio); else mountStudio(); }

  var api = { judge: judge, run: run, jsonLd: jsonLd, visibleText: visibleText, resultHtml: resultHtml };
  root.AirReachVerify = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
