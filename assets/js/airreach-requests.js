/**
 * AI で比べる競合・調べるキーワード・毎月測る質問（顧客ホームと社内ホームの共通部品）。
 *   - お客様: いまの設定を見て、追加・外す依頼を出す（担当者が承認すると反映）。自分の依頼は取り消せる
 *   - 社内: 依頼を承認・見送る。直接の追加・削除もここからできる（承認と同じ記録が残る）
 *   - 競合の候補: 最新の AI 計測で出典になったサイトから、自社・SNS・口コミ／予約／まとめ・公的機関を除いて出す
 * DB: client_requests と airreach_client_settings / airreach_request_create / _cancel / _decide
 *   （supabase/migrations/20261007120000_airreach_client_requests.sql）。未適用の DB では何も出さない（社内には案内だけ出す）
 */
(function () {
  'use strict';
  var LIMIT = 10;
  var KIND = { competitor: '競合', keyword: 'キーワード', prompt: '質問', decision: 'ご判断' };
  var ANSWER = { ok: 'このまま進めてよい', revise: '直して返す' };
  var STATUS = { pending: ['確認待ち', 'is-warn'], approved: ['反映済み', 'is-ok'], rejected: ['見送り', ''], cancelled: ['取り消し', ''] };
  // 競合の候補から外すサイト（SNS・口コミ／予約／まとめは AirReachAIBreakdown.classify と同じ。加えて公的機関・学校）
  var SNS = ['instagram.com', 'facebook.com', 'x.com', 'twitter.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'line.me', 'lin.ee', 'threads.net', 'pinterest.com', 'ameblo.jp', 'note.com'];
  var PUBLIC_TLD = /\.(go|lg|ac|ed)\.jp$/;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hostOf(u) { try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } }
  function under(h, base) { return !!base && (h === base || h.slice(-base.length - 1) === '.' + base); }
  function keyOf(kind, p) { return kind + ':' + String((p && (p.name || p.text)) || '').trim().toLowerCase(); }
  // 指名質問＝質問の文にお店の名前が入っている（計測の集計 airreach-ai-breakdown.js の isBranded と同じ判定）
  function isBranded(text, brand) {
    if (typeof window !== 'undefined' && window.AirReachAIBreakdown && window.AirReachAIBreakdown.isBranded) return window.AirReachAIBreakdown.isBranded(text, brand);
    var n = function (t) { return String(t || '').toLowerCase().replace(/[\s\u3000・･]+/g, ''); };
    var b = n(brand); if (!b) return false;
    var p = n(text); if (p.indexOf(b) >= 0) return true;
    var core = b.replace(/^(株式会社|有限会社|合同会社)|(株式会社|有限会社|合同会社)$/g, '').replace(/(本店|店)$/, '');
    return core.length >= 2 && p.indexOf(core) >= 0;
  }
  function typeChip(text, brand) { return isBranded(text, brand) ? '<span class="arq-ty is-b">指名</span>' : '<span class="arq-ty is-g">一般</span>'; }
  function md(iso) { var t = Date.parse(iso); if (isNaN(t)) return ''; var d = new Date(t + 9 * 3600 * 1000); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); }

  /**
   * 競合の候補（名前）：AI の回答の本文に挙がったお店・会社の名前。
   *   お店の名前を入れない質問（一般質問）の回答だけを見て、太字（**名前**）と箇条書きの頭（1. 名前 - …）から取り出し、
   *   2つ以上の別々の質問で挙がったものだけを出す。自社・登録済みの競合・一般的な言葉・文の形のものは除く。最後は人が確かめて選ぶ
   */
  var NAME_STOP = /^(特徴|ポイント|メリット|デメリット|注意点?|まとめ|おすすめ|料金|価格|費用|立地|アクセス|サポート|サービス|プラン|口コミ|評判|予約|対応|設備|期間|契約|立地条件|清潔さ?|安全性?|利便性|コスパ|品質|実績|選び方|比較|結論|概要|はじめに|参考|その他)/;
  function nameCandidates(summary, opt) {
    opt = opt || {};
    var answers = summary && Array.isArray(summary.answers) ? summary.answers : [];
    var brand = opt.brand || '';
    var comp = (opt.competitors || []).map(function (c) { return String(c.name || '').toLowerCase().replace(/\s+/g, ''); });
    var by = {};
    answers.forEach(function (a, ai) {
      if (!a || a.status !== 'ok' || a.branded || (brand && isBranded(a.prompt || '', brand))) return;
      var t = String(a.answer || ''), found = {};
      t.replace(/\*\*([^*\n]{2,40})\*\*/g, function (m, x) { found[x] = 1; return m; });
      t.replace(/(?:^|\n)\s*(?:\d+[\.\)．]|[-・●■])\s*([^\n*:：（(、。\-–—|]{2,30})\s*(?:[:：（(\-–—|]|$)/g, function (m, x) { found[x] = 1; return m; });
      Object.keys(found).forEach(function (raw) {
        var nm = raw.replace(/^[\s「『【]+|[\s」』】:：]+$/g, '').trim();
        if (nm.length < 2 || nm.length > 30) return;
        if (NAME_STOP.test(nm) || /です|ます|でしょう|ください|について|ため|場合|[?？。]/.test(nm) || /^[\d\s.,%円]+$/.test(nm)) return;
        if (brand && isBranded(nm, brand)) return;
        var key = nm.toLowerCase().replace(/\s+/g, '');
        if (comp.indexOf(key) >= 0) return;
        var x = by[key] || (by[key] = { name: nm, answers: 0, engines: {}, prompts: {} });
        x.answers += 1; x.engines[a.engine || ''] = 1; x.prompts[a.prompt || ''] = 1;
      });
    });
    return Object.keys(by).map(function (k) { var x = by[k]; return { name: x.name, answers: x.answers, engines: Object.keys(x.engines).filter(Boolean).length, prompts: Object.keys(x.prompts).length }; })
      // 2つ以上の別々の質問で挙がった名前だけ（1つの質問の中で話題として何度も出る名前を除く）
      .filter(function (x) { return x.prompts >= 2; })
      .sort(function (a, b) { return b.answers - a.answers || b.prompts - a.prompts || (a.name < b.name ? -1 : 1); })
      .slice(0, opt.limit || 8);
  }

  /**
   * 競合の候補：計測の summary.cited_domains（[[host, {provider: 回答数}]]）から、出典になった回数の多い順に。
   * 自社のサイト・登録済みの競合・SNS・口コミ／予約／まとめ・公的機関は除く
   */
  function candidates(summary, opt) {
    opt = opt || {};
    var selfHosts = (opt.selfHosts || []).map(hostOf).filter(Boolean);
    var comp = opt.competitors || [];
    var compHosts = comp.map(function (c) { return hostOf(c.url || ''); }).filter(Boolean);
    var compNames = comp.map(function (c) { return String(c.name || '').toLowerCase(); });
    var B = (typeof window !== 'undefined' && window.AirReachAIBreakdown) || null;
    var list = (summary && Array.isArray(summary.cited_domains)) ? summary.cited_domains : [];
    var out = [];
    list.forEach(function (x) {
      var host = hostOf(Array.isArray(x) ? x[0] : (x && x.host)), counts = Array.isArray(x) ? x[1] : (x && x.counts);
      if (!host || host === '(unresolved)') return;
      var n = 0; Object.keys(counts || {}).forEach(function (k) { n += Number(counts[k]) || 0; });
      if (!n) return;
      if (selfHosts.some(function (s) { return under(host, s) || under(s, host); })) return;
      if (compHosts.some(function (c) { return under(host, c); }) || compNames.indexOf(host) >= 0) return;
      var cat = B ? B.classify(host, { selfHost: '', compHosts: [] }) : (SNS.some(function (s) { return under(host, s); }) ? 'sns' : 'other');
      if (cat !== 'other' || PUBLIC_TLD.test(host)) return;
      out.push({ host: host, answers: n });
    });
    out.sort(function (a, b) { return b.answers - a.answers || (a.host < b.host ? -1 : 1); });
    return out.slice(0, opt.limit || 6);
  }

  /** 確認待ちの依頼を「種類:名前」で引けるようにする（一覧で「外す依頼中」「追加の依頼中」を出す） */
  function pendingIndex(reqs) {
    var ix = {};
    (reqs || []).forEach(function (r) { if (r.status === 'pending') ix[r.action + ':' + keyOf(r.kind, r.payload)] = r; });
    return ix;
  }

  function reqText(r) {
    var p = r.payload || {};
    if (r.kind === 'competitor') return (p.name || '') + (p.url && hostOf(p.url) !== String(p.name || '').toLowerCase() ? '（' + hostOf(p.url) + '）' : '');
    if (r.kind === 'decision') return '「' + (p.text || '') + '」→ ' + (ANSWER[r.action] || r.action);
    return p.text || '';
  }

  /**
   * box に描く。o: { sb, clientId, staff, email, selfHosts, onMsg(text, kind) }
   * 戻り値: Promise<{ pending: 件数 }>（DB が未適用なら null）
   */
  function mount(box, o) {
    var openAll = !!(box.querySelector('.arq-all') && box.querySelector('.arq-all').open);
    var sb = o.sb, cid = o.clientId;
    function rpc(name, args) { return sb.rpc(name, args).then(function (r) { if (r.error) throw new Error(r.error.message || String(r.error)); return r.data; }); }
    function say(t, k) { if (o.onMsg) o.onMsg(t, k); }
    box.innerHTML = '<p class="arc-note">設定を読み込んでいます…</p>';
    return Promise.all([
      rpc('airreach_client_settings', { p_client_id: cid }),
      sb.from('client_requests').select('*').eq('client_id', cid).order('requested_at', { ascending: false }).limit(60),
      sb.from('measurement_runs').select('measured_on,summary').eq('client_id', cid).order('measured_on', { ascending: false }).limit(1)
    ]).then(function (rs) {
      if (rs[1].error) throw new Error(rs[1].error.message);
      var st = rs[0] || {}, reqs = rs[1].data || [], run = (rs[2].data || [])[0] || null;
      draw(st, reqs, run);
      return { pending: reqs.filter(function (r) { return r.status === 'pending'; }).length };
    }, function (e) {
      // 本番 DB に migration が無いあいだは、お客様には何も出さない
      if (/airreach_client_settings|client_requests|schema cache|does not exist/i.test(e.message || '')) {
        box.innerHTML = o.staff ? '<section class="arc-card"><h2 class="arc-h2">競合・キーワード・質問の依頼</h2><p class="arc-note">この機能のデータベースがまだ用意されていません（migration 20261007120000 の適用待ち）。</p></section>' : '';
        return null;
      }
      box.innerHTML = '<section class="arc-card"><p class="arc-note">競合・キーワード・質問の設定を読み込めませんでした（' + esc(e.message) + '）</p></section>';
      return null;
    });

    function draw(st, reqs, run) {
      var pix = pendingIndex(reqs), staff = !!o.staff;
      var comps = st.competitors || [], kws = st.keywords || [], prompts = st.prompts || [];
      var onN = prompts.filter(function (p) { return p.on; }).length;
      var cands = candidates(run && run.summary, { selfHosts: o.selfHosts || [], competitors: comps });
      var nameCands = nameCandidates(run && run.summary, { brand: o.brand || '', competitors: comps });
      var pendingAdd = function (kind) { return reqs.filter(function (r) { return r.status === 'pending' && r.action === 'add' && r.kind === kind; }); };

      // 一覧は最初の LIMIT 件だけ出し、残りは「すべて表示」で開く（50件あってもホームが伸び続けない）。絞り込みもできる
      function itemRow(kind, label, sub, payload, i, tag) {
        var rm = pix['remove:' + keyOf(kind, payload)];
        var btn = rm ? '<span class="arc-chip is-warn">外す依頼が確認待ち</span>' :
          '<button type="button" class="arc-btn-sm" data-rq-remove="' + kind + '" data-rq-payload="' + esc(JSON.stringify(payload)) + '">' + (staff ? '外す' : '外す依頼') + '</button>';
        return '<li class="arq-item' + (i >= LIMIT ? ' arq-over' : '') + '" data-text="' + esc(String(label || '').toLowerCase()) + '"><span class="arq-t">' + esc(label) + (sub ? ' <small>' + sub + '</small>' : '') + '</span>' + (tag || '') + btn + '</li>';
      }
      function tools(key, n) {
        return n > LIMIT ? '<div class="arq-tools"><input class="arc-input arq-search" type="search" data-rq-search="' + key + '" placeholder="一覧を絞り込む" aria-label="一覧を絞り込む">' +
          '<button type="button" class="arc-btn-sm" data-rq-all="' + key + '" aria-expanded="false">すべて表示（' + n + '件）</button></div>' : '';
      }
      function waitRows(kind) {
        return pendingAdd(kind).map(function (r) { return '<li class="arq-wait"><span class="arq-t">' + esc(reqText(r)) + '</span>' + (kind === 'prompt' && o.brand ? typeChip(reqText(r), o.brand) : '') + '<span class="arc-chip is-warn">追加の依頼が確認待ち</span></li>'; }).join('');
      }
      function list(key, items, n, empty) {
        return tools(key, n) + '<ul class="arq-list" data-rq-list="' + key + '">' + (items || '<li class="arc-empty">' + empty + '</li>') + '</ul>';
      }
      function block(kind, title, lead, body, form) {
        return '<div class="arq-block"><h3 class="arc-h3">' + title + '</h3><p class="arc-note">' + lead + '</p>' + body +
          (waitRows(kind) ? '<ul class="arq-list">' + waitRows(kind) + '</ul>' : '') + form + '</div>';
      }
      var verb = staff ? '追加する' : '追加を依頼';
      // お客様は「なぜ足したいか」を書ける（任意）。担当者が承認・見送りを決める材料になる
      var noteIn = staff ? '' : '<input class="arc-input arq-wide" name="note" maxlength="500" placeholder="補足（任意）：なぜ足したいか など" aria-label="補足（任意）">';

      var compItems = comps.map(function (c, i) { return itemRow('competitor', c.name, c.url && hostOf(c.url) !== String(c.name || '').toLowerCase() ? esc(hostOf(c.url)) : '', { name: c.name }, i); }).join('');
      var candHtml = cands.length ? '<div class="arq-cands"><p class="arc-note"><b>候補</b>：' + esc(run.measured_on ? String(run.measured_on).slice(5).replace('-', '/') + ' の' : '最新の') +
        'AI 計測で回答の出典になったサイトです（自社・SNS・口コミや予約のサイトは除いています）。同業のお店かどうかを確かめてから選んでください。</p><ul class="arq-chips">' +
        cands.map(function (c) {
          var waiting = pix['add:' + keyOf('competitor', { name: c.host })];
          return '<li><span>' + esc(c.host) + ' <small>' + esc(c.answers) + '回答</small></span>' + (waiting ? '<span class="arc-chip is-warn">確認待ち</span>' :
            '<button type="button" class="arc-btn-sm" data-rq-cand="' + esc(c.host) + '">' + (staff ? '競合に追加' : '競合に追加を依頼') + '</button>') + '</li>';
        }).join('') + '</ul></div>' : '';
      // AI の回答に名前が出たお店（出典のサイトとは別に）
      var nameHtml = nameCands.length ? '<div class="arq-cands"><p class="arc-note"><b>AI の回答に名前が出たお店</b>：' + esc(run.measured_on ? String(run.measured_on).slice(5).replace('-', '/') + ' の' : '最新の') +
        '計測で、お店の名前を入れない質問のうち、2つ以上の質問の回答に出てきた名前です。同業のお店かどうかを確かめてから選んでください。</p><ul class="arq-chips">' +
        nameCands.map(function (c) {
          var waiting = pix['add:' + keyOf('competitor', { name: c.name })];
          return '<li><span>' + esc(c.name) + ' <small>' + esc(c.answers) + '回答</small></span>' + (waiting ? '<span class="arc-chip is-warn">確認待ち</span>' :
            '<button type="button" class="arc-btn-sm" data-rq-cand-name="' + esc(c.name) + '">' + (staff ? '競合に追加' : '競合に追加を依頼') + '</button>') + '</li>';
        }).join('') + '</ul></div>' : '';
      var compForm = '<form class="arc-row arq-form" data-rq-form="competitor"><input class="arc-input" name="name" maxlength="80" placeholder="お店・会社の名前" required aria-label="競合の名前">' +
        '<input class="arc-input" name="url" maxlength="300" placeholder="https://（わかれば）" aria-label="競合のサイトの URL">' + noteIn + '<button class="arc-btn" type="submit">' + verb + '</button></form>';

      var kwItems = kws.map(function (k, i) { return itemRow('keyword', k.text, (k.priority ? esc(k.priority) : '') + (k.customer ? ' · ご依頼' : ''), { text: k.text }, i); }).join('');
      var kwForm = '<form class="arc-row arq-form" data-rq-form="keyword"><input class="arc-input" name="text" maxlength="60" placeholder="例: 渋谷 縮毛矯正" required aria-label="キーワード">' + noteIn + '<button class="arc-btn" type="submit">' + verb + '</button></form>';

      // 毎月測る質問と、今は測っていない候補を分ける
      var onP = prompts.filter(function (p) { return p.on; }), offP = prompts.filter(function (p) { return !p.on; });
      var brand = o.brand || '';
      var pOn = onP.map(function (p, i) { return itemRow('prompt', p.text, '', { text: p.text }, i, typeChip(p.text, brand)); }).join('');
      var pOff = offP.map(function (p, i) { return itemRow('prompt', p.text, '', { text: p.text }, i, typeChip(p.text, brand)); }).join('');
      var nB = onP.filter(function (p) { return isBranded(p.text, brand); }).length;
      // 毎月測る質問の内訳（一般・指名）。お店の名前が分からないときは出さない
      var pMix = brand ? '<div class="arq-mix"><div class="arq-mix-i is-g"><b>一般質問 ' + (onP.length - nB) + '問</b><small>お店の名前を入れずに聞く。新しいお客様に見つけてもらえるか</small></div>' +
        '<div class="arq-mix-i is-b"><b>指名質問 ' + nB + '問</b><small>お店の名前を入れて聞く。お店のことが正しく伝わっているか</small></div></div>' : '';
      var pForm = '<form class="arc-row arq-form" data-rq-form="prompt"><input class="arc-input arq-wide" name="text" maxlength="200" placeholder="例: 渋谷で縮毛矯正が上手い美容室は？" required aria-label="質問"' + (brand ? ' aria-describedby="arq-ptype"' : '') + '>' + noteIn + '<button class="arc-btn" type="submit">' + verb + '</button>' +
        (brand ? '<p class="arq-ptype" id="arq-ptype" role="status" data-rq-ptype hidden></p><p class="arq-eg">例　一般：「渋谷で子連れで行ける美容室は？」／指名：「' + esc(brand) + ' の駐車場は？」</p>' : '') + '</form>';

      var pend = reqs.filter(function (r) { return r.status === 'pending'; });
      var done = reqs.filter(function (r) { return r.status !== 'pending'; }).slice(0, 8);
      var reqRow = function (r) {
        var who = staff ? '<small>' + esc(r.requested_by || '') + '</small>' : '';
        var acts = '';
        if (r.status === 'pending') {
          // ご判断へのお返事は、担当者は「確認した」だけ（Studio の作業は変えない・見送りは無い）
          if (staff && r.kind === 'decision') acts = '<button type="button" class="arc-btn-sm arq-ok" data-rq-approve="' + r.id + '" data-rq-kind="decision">確認した</button>';
          else if (staff) acts = '<input class="arc-input arq-note" data-rq-note="' + r.id + '" maxlength="500" placeholder="見送る理由（お客様に表示）" aria-label="見送る理由">' +
            '<button type="button" class="arc-btn-sm arq-ok" data-rq-approve="' + r.id + '">承認して反映</button><button type="button" class="arc-btn-sm" data-rq-reject="' + r.id + '">見送る</button>';
          else if (r.requested_by && o.email && String(r.requested_by).toLowerCase() === String(o.email).toLowerCase()) acts = '<button type="button" class="arc-btn-sm" data-rq-cancel="' + r.id + '">取り消す</button>';
        }
        var s = r.kind === 'decision' && r.status === 'approved' ? ['確認済み', 'is-ok'] : (STATUS[r.status] || [r.status, '']);
        var what = r.kind === 'decision' ? 'ご判断へのお返事' + (r.payload && r.payload.period_month ? '（' + Number(String(r.payload.period_month).slice(5, 7)) + '月のレポート）' : '') : esc(KIND[r.kind] || r.kind) + 'を' + (r.action === 'add' ? '追加' : '外す');
        return '<li' + (r.kind === 'decision' ? ' class="arq-dec"' : '') + '><span class="arc-chip ' + s[1] + '">' + esc(s[0]) + '</span><span class="arq-t">' + what + '：' + esc(reqText(r)) +
          ' <small>' + esc(md(r.requested_at)) + (r.decision_note && r.status !== 'pending' ? ' · ' + esc(r.decision_note) : '') + '</small>' + who +
          (r.note ? '<span class="arq-why">' + (r.kind === 'decision' ? (staff ? 'お客様のお返事' : 'お返事') : staff ? 'お客様の補足' : '補足') + '：' + esc(r.note) + '</span>' : '') + '</span>' + (acts ? '<span class="arq-acts">' + acts + '</span>' : '') + '</li>';
      };
      // 確認待ちは全部、済んだものは直近3件だけ（残りは開く）
      var reqHtml = '<div class="arq-reqs"><h3 class="arc-h3">' + (staff ? 'お客様からの依頼' : 'ご依頼と変更の記録') + (pend.length ? ' <span class="arc-chip is-warn">確認待ち ' + pend.length + '件</span>' : staff ? ' <span class="arc-chip is-ok">確認待ちなし</span>' : '') + '</h3>' +
        (pend.length || done.length ? '<ul class="arq-rlist">' + pend.concat(done.slice(0, 3)).map(reqRow).join('') + '</ul>' +
          (done.length > 3 ? '<details class="arq-hist"><summary>これまでの記録をもっと見る（' + (done.length - 3) + '件）</summary><ul class="arq-rlist">' + done.slice(3).map(reqRow).join('') + '</ul></details>' : '')
          : '<p class="arc-empty">' + (staff ? 'まだ依頼はありません。' : 'まだご依頼はありません。') + '</p>') + '</div>';

      box.innerHTML = '<section class="arc-card arq" id="arq">' +
        '<div class="arv-home-head"><h2 class="arc-h2">AI で比べる競合・調べるキーワード・質問</h2></div>' +
        '<p class="arc-note">' + (staff ? '承認すると Studio の作業（競合・キーワード・質問）に反映します。ここで追加・外すと、その場で反映して記録が残ります。Studio を開いたままの画面は、開き直してから保存してください。' :
          '追加したい・外したいものがあれば、ここから依頼してください。担当者が確かめてから反映し、次の計測から使います（毎月測る質問は10問までです）。') + '</p>' +
        (staff ? reqHtml : '') +
        // 最初の計測のあと、競合がまだ無ければ、AI がよく挙げたお店を提案する（上位3つに印。押すまで登録しない）
        (staff && !comps.length && nameCands.length ? '<div class="arq-propose" id="arq-propose"><h3 class="arc-h3">競合の候補が見つかりました</h3>' +
          '<p class="arc-note">' + esc(run.measured_on ? String(run.measured_on).slice(5).replace('-', '/') + ' の' : '最新の') + 'AI 計測で、お店の名前を入れない質問の回答によく挙がったお店です。同業のお店に印を付けて登録すると、次の計測から AI の回答で自社と比べます。</p>' +
          '<ul class="arq-propose-l">' + nameCands.slice(0, 6).map(function (c, i) { return '<li><label><input type="checkbox" data-rq-propose-name="' + esc(c.name) + '"' + (i < 3 ? ' checked' : '') + '> <b>' + esc(c.name) + '</b> <small>' + esc(c.answers) + '回答・' + esc(c.prompts) + '問</small></label></li>'; }).join('') + '</ul>' +
          '<div class="arc-row"><button type="button" class="arc-btn" data-rq-propose-go>印を付けたお店を競合に登録</button><span class="arc-note">まとめサイトや別の業種は外してください。</span></div></div>' : '') +
        // 社内のホームでは、一覧と編集は折りたたむ（依頼を埋もれさせない）。お客様の画面は開いたまま
        '<details class="arq-all"' + (staff && !openAll ? '' : ' open') + '><summary>' + (staff ? '競合・キーワード・質問の一覧と編集' : '登録している競合・キーワード・質問') +
          '<small>（競合 ' + comps.length + '・キーワード ' + kws.length + '・毎月測る質問 ' + onN + '・候補 ' + offP.length + '）</small></summary>' +
        '<div class="arq-grid">' +
        block('competitor', '競合（AI の回答で比べる相手）', 'AI がどのお店をすすめたかを数えるときに、比べる相手です。', list('competitor', compItems, comps.length, 'まだ登録されていません。'), nameHtml + candHtml + compForm) +
        block('keyword', '調べるキーワード（' + kws.length + '件）', 'お客様が検索しそうな言葉です。対策と質問づくりの元にします。', list('keyword', kwItems, kws.length, 'まだ登録されていません。'), kwForm) +
        block('prompt', '毎月測る質問（' + onN + '/10問）', 'この質問を ChatGPT などの AI に毎月たずね、回答に出るかを測ります。' + (brand ? '一般と指名は、質問の文にお店の名前が入っているかで自動で分けます。' : ''),
          pMix + list('prompt-on', pOn, onP.length, 'まだ登録されていません。') +
          (offP.length ? '<h4 class="arq-sub">候補（今は測っていない・' + offP.length + '件）</h4>' + list('prompt-off', pOff, offP.length, '') : ''), pForm) +
        '</div></details>' + (staff ? '' : reqHtml) + '</section>';
      bind();
    }

    function act(p, okText) {
      return p.then(function (res) {
        if (res && res.ok === false) { say(res.reason || 'できませんでした', 'error'); return; }
        say(typeof okText === 'function' ? okText(res) : okText, 'ok');
        return mount(box, o).then(function (x) { if (o.onChange) o.onChange(x); });
      }).catch(function (e) { say(e.message || String(e), 'error'); });
    }
    // 社内が直接追加・外すときは、依頼を作ってその場で承認する（だれがいつ変えたかの記録を同じ形で残す）
    function request(kind, action, payload, note) {
      var args = { p_client_id: cid, p_kind: kind, p_action: action, p_payload: payload };
      var made = note ? rpc('airreach_request_create', Object.assign({ p_note: note }, args)).catch(function (e) {
        // 補足の migration（20261007190000）がまだ無い DB では、補足なしで依頼だけ送る
        if (!/p_note|airreach_request_create|schema cache|does not exist/i.test(e.message || '')) throw e;
        return rpc('airreach_request_create', args).then(function (r) { if (r && r.ok) r.noteLost = true; return r; });
      }) : rpc('airreach_request_create', args);
      if (!o.staff) return act(made, function (r) { return r && r.noteLost ? '依頼しました。補足は保存できなかったため、担当者に直接お伝えください。' : '依頼しました。担当者が確かめてから反映します。'; });
      return act(made.then(function (r) { return r && r.ok ? rpc('airreach_request_decide', { p_id: r.id, p_approve: true, p_note: null }) : r; }), function (r) { return (r && r.applied) || (action === 'add' ? '追加しました' : '外しました'); });
    }
    function bind() {
      var all = box.querySelector('.arq-all');
      if (all) all.addEventListener('toggle', function () { openAll = all.open; });
      Array.prototype.forEach.call(box.querySelectorAll('[data-rq-all]'), function (b) {
        b.addEventListener('click', function () {
          var ul = box.querySelector('[data-rq-list="' + b.getAttribute('data-rq-all') + '"]'), on = !ul.classList.contains('is-all');
          ul.classList.toggle('is-all', on); b.setAttribute('aria-expanded', String(on));
          b.textContent = on ? '最初の' + LIMIT + '件だけ表示' : 'すべて表示（' + ul.querySelectorAll('.arq-item').length + '件）';
        });
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-rq-search]'), function (inp) {
        inp.addEventListener('input', function () {
          var ul = box.querySelector('[data-rq-list="' + inp.getAttribute('data-rq-search') + '"]'), v = inp.value.trim().toLowerCase();
          ul.classList.toggle('is-search', !!v);
          Array.prototype.forEach.call(ul.querySelectorAll('.arq-item'), function (li) { li.hidden = !!v && li.getAttribute('data-text').indexOf(v) < 0; });
        });
      });
      var pt = box.querySelector('[data-rq-ptype]'), pf = box.querySelector('form[data-rq-form="prompt"]');
      if (pt && pf) pf.text.addEventListener('input', function () {
        var v = pf.text.value.trim();
        pt.hidden = !v;
        if (!v) return;
        var b = isBranded(v, o.brand);
        pt.className = 'arq-ptype ' + (b ? 'is-b' : 'is-g');
        pt.innerHTML = b ? '<span class="arq-ty is-b">指名</span>お店の名前が入っているので、指名質問として数えます。名前を入れずに聞くと一般質問になります。'
          : '<span class="arq-ty is-g">一般</span>お店の名前が入っていないので、一般質問として数えます。';
      });
      Array.prototype.forEach.call(box.querySelectorAll('form[data-rq-form]'), function (f) {
        f.addEventListener('submit', function (e) {
          e.preventDefault();
          var kind = f.getAttribute('data-rq-form'), payload = kind === 'competitor' ? { name: f.name.value.trim(), url: f.url.value.trim() } : { text: f.text.value.trim() };
          if (!(payload.name || payload.text)) return;
          request(kind, 'add', payload, f.note ? f.note.value.trim() : '');
        });
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-rq-cand-name]'), function (b) {
        b.addEventListener('click', function () { request('competitor', 'add', { name: b.getAttribute('data-rq-cand-name') }); });
      });
      var pg = box.querySelector('[data-rq-propose-go]');
      if (pg) pg.addEventListener('click', function () {
        var names = Array.prototype.map.call(box.querySelectorAll('[data-rq-propose-name]:checked'), function (c) { return c.getAttribute('data-rq-propose-name'); });
        if (!names.length) { say('登録するお店に印を付けてください', 'error'); return; }
        pg.disabled = true;
        // 1社ずつ登録（社内はその場で反映）。終わったら画面を作り直す
        var chain = Promise.resolve(), done = 0, failed = [];
        names.forEach(function (n) {
          chain = chain.then(function () {
            return rpc('airreach_request_create', { p_client_id: cid, p_kind: 'competitor', p_action: 'add', p_payload: { name: n } })
              .then(function (r) { if (!(r && r.ok)) throw new Error((r && r.reason) || 'できませんでした'); return rpc('airreach_request_decide', { p_id: r.id, p_approve: true, p_note: null }); })
              .then(function () { done += 1; }, function (e) { failed.push(n + '（' + (e.message || e) + '）'); });
          });
        });
        chain.then(function () {
          say(done + '社を競合に登録しました。次の計測から比べます。' + (failed.length ? '登録できなかったお店：' + failed.join('、') : ''), failed.length ? 'error' : 'ok');
          return mount(box, o).then(function (x) { if (o.onChange) o.onChange(x); });
        });
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-rq-cand]'), function (b) {
        b.addEventListener('click', function () { var h = b.getAttribute('data-rq-cand'); request('competitor', 'add', { name: h, url: 'https://' + h + '/' }); });
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-rq-remove]'), function (b) {
        b.addEventListener('click', function () {
          // 押し間違いを防ぐ：1回目で確認の文言に変え、もう一度押したら実行
          if (b.getAttribute('data-armed') !== '1') { b.setAttribute('data-armed', '1'); b.textContent = o.staff ? 'もう一度押すと外します' : 'もう一度押すと依頼します'; return; }
          var p = {}; try { p = JSON.parse(b.getAttribute('data-rq-payload')); } catch (e) { return; }
          request(b.getAttribute('data-rq-remove'), 'remove', p);
        });
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-rq-cancel]'), function (b) {
        b.addEventListener('click', function () { act(rpc('airreach_request_cancel', { p_id: b.getAttribute('data-rq-cancel') }), '依頼を取り消しました'); });
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-rq-approve]'), function (b) {
        b.addEventListener('click', function () {
          var dec = b.getAttribute('data-rq-kind') === 'decision';
          act(rpc('airreach_request_decide', { p_id: b.getAttribute('data-rq-approve'), p_approve: true, p_note: null }), function (r) { return dec ? 'お客様のお返事を確認済みにしました' : '承認しました：' + ((r && r.applied) || '反映しました'); });
        });
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-rq-reject]'), function (b) {
        b.addEventListener('click', function () {
          var id = b.getAttribute('data-rq-reject'), n = box.querySelector('[data-rq-note="' + id + '"]');
          act(rpc('airreach_request_decide', { p_id: id, p_approve: false, p_note: n ? n.value.trim() : '' }), '見送りました');
        });
      });
    }
  }

  var api = { mount: mount, candidates: candidates, nameCandidates: nameCandidates, pendingIndex: pendingIndex, isBranded: isBranded, KIND: KIND };
  if (typeof window !== 'undefined') window.AirReachRequests = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
