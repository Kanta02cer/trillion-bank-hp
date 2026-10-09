/**
 * 競合との比較の「なぜ」（画面の再設計）：
 *   ② 出典になったページに書いてあること：AI が出典にした各お店の公式ページを公開ページの取得口で読み、料金・営業時間などが書いてあるかを比べる
 *   ③ AI がどう紹介したか：名前が出た回答の文から、お店ごとに言われたこと（駅から近い・技術・評判など）を数える
 *   ④ 追いつくために直すこと：②③と出典の種類から、根拠つきで最大3つ。「課題に足す」で、この案件の課題に入れられる
 *   どれも回答と公開ページの「書いてあること」を数えたもので、AI が判断した理由ではない
 */
(function (root) {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hostOf(u) { try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } }
  function under(h, base) { return !!base && !!h && (h === base || h.slice(-base.length - 1) === '.' + base); }
  function normName(t) { return String(t || '').toLowerCase().replace(/[\s　・･]+/g, ''); }

  // ---- ② ページに書いてあること -------------------------------------------------
  var ITEMS = [['price', '料金'], ['hours', '営業時間'], ['reservation', '予約のしかた'], ['access', 'アクセス'], ['flow', 'サービスの流れ・所要時間'], ['faq', 'よくある質問'], ['org', 'お店の情報のデータ（検索や AI が読む形）'], ['updated', '更新日の表示']];
  var ORG = /^(Organization|LocalBusiness|Restaurant|Store|HairSalon|BeautySalon|DaySpa|MedicalClinic|Dentist|Physician|LegalService|ProfessionalService|HomeAndConstructionBusiness|FoodEstablishment|CafeOrCoffeeShop|Hotel|LodgingBusiness)$/;
  function visibleText(html) { return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' '); }
  function ldItems(html) {
    var out = [], re = /<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi, m;
    while ((m = re.exec(String(html || '')))) { try { var j = JSON.parse(m[1].trim()); (Array.isArray(j) ? j : [j]).forEach(function (x) { if (x && Array.isArray(x['@graph'])) out = out.concat(x['@graph']); else if (x) out.push(x); }); } catch (e) {} }
    return out;
  }
  function typesOf(x) { var t = x && x['@type']; return (Array.isArray(t) ? t : [t]).filter(Boolean).map(String); }
  /** 1つのページから、書いてあることを判定する（推測で埋めない。書いてあれば true） */
  function features(html, url) {
    var text = visibleText(html), ld = ldItems(html), F = {};
    try { F = (root.AirReachKeyword && root.AirReachKeyword.facts({ text: text, url: url })) || {}; } catch (e) { F = {}; }
    var years = (text.match(/(?:最終)?更新(?:日)?[：:\s]*(20\d\d)/) || [])[1] || (ld.map(function (x) { return String(x.dateModified || ''); }).join(' ').match(/20\d\d/) || [])[0] || '';
    return {
      price: !!F.price, hours: !!F.hours, reservation: !!F.reservation, access: !!(F.access || F.address),
      flow: /所要時間|施術の流れ|ご利用の流れ|サービスの流れ|ステップ\s*\d|約\s*\d+\s*(分|時間)/.test(text),
      faq: ld.some(function (x) { return typesOf(x).indexOf('FAQPage') >= 0; }) || /よくある(ご)?質問/.test(text),
      org: ld.some(function (x) { return typesOf(x).some(function (t) { return ORG.test(t); }); }),
      updated: years ? years + '年' : '',
      priceText: F.price ? F.price.value : ''
    };
  }
  /** 比べるページ：各お店で、名前が出た回答の出典のうち、そのお店のサイトでいちばん多く出たページ。自分が一度も出典にならなければ、サイトのトップ */
  function pickPages(r, answers, opts) {
    var A = root.AirReachAI3, shops = r.shops || [], pages = [];
    var rows = A ? A.bySegment(answers || [], 'general', opts.brand).filter(function (x) { return A.engineOf(x) === r.engine; }) : [];
    shops.forEach(function (s) {
      var cnt = {};
      rows.forEach(function (x) {
        var hit = s.self ? (x.mentioned === 1 || x.mentioned === true) : (x.competitors || []).some(function (c) { return normName(c.name) === normName(s.name) && c.mentioned; });
        if (!hit) return;
        (x.citations || []).forEach(function (u) { if (under(hostOf(u), s.host)) cnt[u] = (cnt[u] || 0) + 1; });
      });
      var best = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
      if (best) pages.push({ shop: s.name, self: s.self, url: best, why: '出典に ' + cnt[best] + '回' });
      else if (s.self && opts.selfUrl) pages.push({ shop: s.name, self: true, url: opts.selfUrl, why: '出典にならなかったため、サイトのトップ' });
    });
    return pages;
  }
  function fetchPage(url) {
    return fetch('/api/airreach/fetch?url=' + encodeURIComponent(url)).then(function (res) { return res.text().then(function (t) { return { status: res.status, html: t }; }); });
  }

  // ---- ③ AI がどう紹介したか --------------------------------------------------
  var TRAITS = [
    ['near', '駅から近い・行きやすい', /駅(から|前|近)|徒歩\s*\d+\s*分|駅チカ|アクセス(が|の)?(良|便利|いい)/],
    ['price', '料金がわかりやすい・手頃', /リーズナブル|手頃|お手頃|安い|お得|料金(が|も)?(明確|わかりやすい|分かりやすい)|コスパ/],
    ['skill', '技術・専門性', /得意|専門|上手|定評|技術(力)?(が)?(高|確か)|スペシャリスト/],
    ['review', '評判・人気', /(口コミ|評価|評判|レビュー)(が|の|も)?(高|良|多)|高評価|人気/],
    ['private', '個室がある', /個室|半個室|プライベート(空間|サロン)/],
    ['kids', '子連れでも行ける', /子連れ|キッズ|お子さま|お子様/],
    ['parking', '駐車場がある', /駐車場|パーキング/],
    ['late', '遅くまで開いている', /(夜|深夜)(遅く|まで)|2[0-3]時まで|仕事帰り/],
    ['variety', 'メニューが多い', /(種類|メニュー)(が|も)?(豊富|多)/],
    ['care', '丁寧な対応', /丁寧|親身|カウンセリング|寄り添/]
  ];
  /** 名前が出た回答の文から、お店ごとに言われたこと（回答1つにつき1回まで数える） */
  function traits(r, answers, opts) {
    var A = root.AirReachAI3, shops = r.shops || [], out = {};
    var rows = A ? A.bySegment(answers || [], 'general', opts.brand).filter(function (x) { return A.engineOf(x) === r.engine; }) : [];
    shops.forEach(function (s) { out[s.name] = {}; });
    rows.forEach(function (x) {
      var text = String(x.answer || x.answer_text || x.answer_excerpt || '');
      if (!text) return;
      var parts = text.split(/[。\n！!？?]/);
      shops.forEach(function (s) {
        var key = normName(s.name), core = key.replace(/(株式会社|有限会社|合同会社)/g, '');
        var seen = {};
        parts.forEach(function (p) {
          var np = normName(p);
          if (!(np.indexOf(key) >= 0 || (core.length >= 2 && np.indexOf(core) >= 0))) return;
          TRAITS.forEach(function (t) { if (!seen[t[0]] && t[2].test(p)) { seen[t[0]] = 1; out[s.name][t[0]] = (out[s.name][t[0]] || 0) + 1; } });
        });
      });
    });
    return out;
  }

  // ---- ④ 追いつくために直すこと ---------------------------------------------------
  function suggestions(r, tr, pageRes) {
    var me = (r.shops || []).filter(function (s) { return s.self; })[0], rivals = (r.shops || []).filter(function (s) { return !s.self; });
    var out = [], only = r.onlyRivals || [];
    var sym = only.length ? '相手だけが出た質問が ' + only.length + '問（' + only.slice(0, 2).join('・') + (only.length > 2 ? ' ほか' : '') + '）' : '名前が出た質問の数で、近くのお店に負けている';
    // ②：相手の出典ページにあって、自分のページに無いこと
    if (pageRes && pageRes.self) {
      ITEMS.forEach(function (it) {
        if (out.length >= 3 || it[0] === 'updated') return;
        if (pageRes.self.f[it[0]]) return;
        var has = rivals.filter(function (s) { return pageRes[s.name] && pageRes[s.name].f[it[0]]; });
        if (!has.length) return;
        out.push({ title: it[1] + 'をページに書く', why: has.map(function (s) { return s.name; }).join('・') + 'の出典ページにはあり、自分のページ（' + pageRes.self.url + '）には無い', fix: '自分のページに' + it[1] + 'を書く（実際の内容をお店に確かめてから）', symptom: sym });
      });
    }
    // ③：相手は言われて、自分は言われていないこと
    var mine = (me && tr[me.name]) || {};
    TRAITS.forEach(function (t) {
      if (out.length >= 3) return;
      var who = rivals.filter(function (s) { return (tr[s.name] || {})[t[0]]; });
      if (!who.length || mine[t[0]]) return;
      out.push({ title: '「' + t[1] + '」がページから伝わるようにする', why: 'AI の回答で ' + who.map(function (s) { return s.name; }).join('・') + 'は「' + t[1] + '」と紹介され、自分は言われていない', fix: '当てはまるなら、それが分かる事実（例：料金・実績・設備）をページに書く。当てはまらなければ書かない', symptom: sym });
    });
    // 出典の種類：自分の公式サイトが一度も出典になっていない
    if (out.length < 3 && me && me.mentioned && me.srcTotal && me.src.official === 0) {
      out.push({ title: '公式サイトが AI の出典になるようにする', why: '自分の名前が出た回答で、公式サイトが一度も出典になっていない（ほかのサイトの掲載から出ている）', fix: 'お店の情報のデータとよくある質問を公式サイトに入れる（③ パッチを作る）', symptom: sym });
    }
    return out.slice(0, 3);
  }

  // ---- 表示 -----------------------------------------------------------------
  function pageTable(pageRes, r) {
    var cols = (r.shops || []).filter(function (s) { return pageRes[s.name]; }).sort(function (a, b) { return (b.self ? 1 : 0) - (a.self ? 1 : 0); }); // 自分を先頭に
    if (!cols.length) return '<p class="arc-note">比べられるページがありません（名前が出た回答に、お店の公式サイトの出典がありません）。</p>';
    var head = '<tr><th>書いてあること</th>' + cols.map(function (s) { var p = pageRes[s.name]; return '<th' + (s.self ? ' class="is-self"' : '') + '>' + esc(s.name) + '<small>' + esc(p.ok ? hostOf(p.url) + (new URL(p.url).pathname.length > 1 ? new URL(p.url).pathname.slice(0, 24) : '') : '読めなかった') + '</small></th>'; }).join('') + '</tr>';
    var rows = ITEMS.map(function (it) {
      var selfHas = pageRes.self && pageRes.self.f && pageRes.self.f[it[0]];
      return '<tr><td>' + esc(it[1]) + '</td>' + cols.map(function (s) {
        var p = pageRes[s.name];
        if (!p.ok) return '<td class="rvl-na">—</td>';
        var v = p.f[it[0]];
        var lack = s.self && !v && cols.some(function (o) { return !o.self && pageRes[o.name].ok && pageRes[o.name].f[it[0]]; });
        return '<td class="' + (v ? 'rvl-yes' : 'rvl-no') + (lack ? ' is-lack' : '') + '">' + (v ? (typeof v === 'string' ? esc(v) : 'あり') : 'なし') + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="arc-table-wrap"><table class="rvl-table rvl-pages"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div><p class="arc-note">黄色は、相手のページにあって自分のページに無いこと。公開ページだけを読み、保存はしません。</p>';
  }
  function traitHtml(tr, r) {
    var me = (r.shops || []).filter(function (s) { return s.self; })[0];
    var cards = (r.shops || []).map(function (s) {
      var t = tr[s.name] || {}, ks = TRAITS.filter(function (x) { return t[x[0]]; });
      return '<div class="rvl-tc' + (s.self ? ' is-self' : '') + '"><b>' + esc(s.name) + (s.self ? '（自分）' : '') + '</b><div>' + (ks.length ? ks.map(function (x) { return '<span>' + esc(x[1]) + ' ' + t[x[0]] + '</span>'; }).join('') : '<small>言われたことは見つかりません</small>') + '</div></div>';
    }).join('');
    var mine = (me && tr[me.name]) || {}, rivalOnly = {}, selfOnly = [];
    (r.shops || []).forEach(function (s) { if (s.self) return; TRAITS.forEach(function (x) { if ((tr[s.name] || {})[x[0]] && !mine[x[0]]) rivalOnly[x[1]] = 1; }); });
    TRAITS.forEach(function (x) { if (mine[x[0]] && !(r.shops || []).some(function (s) { return !s.self && (tr[s.name] || {})[x[0]]; })) selfOnly.push(x[1]); });
    return '<div class="rvl-tcs">' + cards + '</div><div class="rvl-diff"><div class="is-rival"><b>相手は言われて、自分は言われていない</b><span>' + esc(Object.keys(rivalOnly).join('・') || 'なし') + '</span></div><div class="is-self"><b>自分だけが言われた（強みとして残す）</b><span>' + esc(selfOnly.join('・') || 'なし') + '</span></div></div>' +
      '<p class="arc-note">名前が出た回答の文の言い回しを数えたもので、AI が判断した理由ではありません。回答はその日によって変わります。</p>';
  }
  function sugHtml(list) {
    if (!list.length) return '<p class="arc-note">いまの材料からは、直すことの候補がありません。</p>';
    return '<ol class="rvl-sugs">' + list.map(function (x, i) {
      return '<li><b>' + esc(x.title) + '</b><small>根拠：' + esc(x.why) + '</small><button type="button" class="arc-btn-sm" data-rv-issue="' + i + '">課題に足す</button></li>';
    }).join('') + '</ol>';
  }

  /** 競合との比較の画面の下に足す。ctx：rivals の ctx ＋ sb・clientId・onIssue */
  function mount(box, r, ctx) {
    if (!box || !r || !r.ok) { if (box) box.innerHTML = ''; return; }
    var answers = (r.run && r.run.summary && r.run.summary.answers) || [];
    if (root.AirReachAI3 && root.AirReachAI3.finalRows) answers = root.AirReachAI3.finalRows(answers);
    var tr = traits(r, answers, ctx), pageRes = null, pages = pickPages(r, answers, ctx);
    function draw() {
      var sugs = suggestions(r, tr, pageRes);
      box.innerHTML =
        '<section class="rvl-sec"><h3>出典になったページに書いてあること</h3>' +
        (pageRes ? pageTable(pageRes, r) : '<p class="arc-note">AI が出典にした各お店のページ（' + pages.length + 'ページ）を読み、料金・営業時間などが書いてあるかを比べます。</p><button type="button" class="arc-btn" data-rv-pages' + (pages.length ? '' : ' disabled') + '>出典ページを読んで比べる</button>') + '</section>' +
        '<section class="rvl-sec"><div class="rvl-eyebrow">AI がどう紹介したか</div><h3>回答の中で、それぞれのお店について言われたこと</h3>' + traitHtml(tr, r) + '</section>' +
        '<section class="rvl-sec"><h3>追いつくために直すこと</h3>' + sugHtml(sugs) + (pageRes ? '' : '<p class="arc-note">出典ページを読むと、ページの中身の差からも候補を出します。</p>') + '</section>';
      var pb = box.querySelector('[data-rv-pages]');
      if (pb) pb.addEventListener('click', function () {
        pb.disabled = true; pb.textContent = '読んでいます…';
        Promise.all(pages.map(function (p) { return fetchPage(p.url).then(function (x) { return { p: p, x: x }; }, function () { return { p: p, x: null }; }); })).then(function (rs) {
          pageRes = {};
          rs.forEach(function (o) { var ok = !!(o.x && o.x.status === 200); var e = { url: o.p.url, ok: ok, f: ok ? features(o.x.html, o.p.url) : {} }; pageRes[o.p.shop] = e; if (o.p.self) pageRes.self = e; });
          draw();
        });
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-rv-issue]'), function (b) {
        b.addEventListener('click', function () {
          var x = sugs[Number(b.getAttribute('data-rv-issue'))];
          if (!ctx.sb || !ctx.clientId) return;
          b.disabled = true; b.textContent = '足しています…';
          var ev = root.AirReachIssues ? root.AirReachIssues.evidenceFrom(ctx.runs) : {};
          ctx.sb.from('client_issues').insert({ client_id: ctx.clientId, title: x.title.slice(0, 120), symptom: x.symptom.slice(0, 600), cause: x.why.slice(0, 600), fix: x.fix.slice(0, 600), check_how: '次の計測で、相手だけが出た質問に名前が出るか', kind: 'site', status: 'open', evidence: ev })
            .then(function (res) { if (res.error) throw res.error; b.textContent = '課題に足しました'; if (ctx.onIssue) ctx.onIssue(); })
            .catch(function (e) { b.disabled = false; b.textContent = '課題に足す'; if (root.alert) root.alert('課題に足せませんでした：' + ((e && e.message) || e)); });
        });
      });
    }
    draw();
  }

  var api = { features: features, pickPages: pickPages, traits: traits, suggestions: suggestions, mount: mount, ITEMS: ITEMS, TRAITS: TRAITS };
  root.AirReachRivalsWhy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
