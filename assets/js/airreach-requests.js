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
  var KIND = { competitor: '競合', keyword: 'キーワード', prompt: '質問' };
  var STATUS = { pending: ['確認待ち', 'is-warn'], approved: ['反映済み', 'is-ok'], rejected: ['見送り', ''], cancelled: ['取り消し', ''] };
  // 競合の候補から外すサイト（SNS・口コミ／予約／まとめは AirReachAIBreakdown.classify と同じ。加えて公的機関・学校）
  var SNS = ['instagram.com', 'facebook.com', 'x.com', 'twitter.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'line.me', 'lin.ee', 'threads.net', 'pinterest.com', 'ameblo.jp', 'note.com'];
  var PUBLIC_TLD = /\.(go|lg|ac|ed)\.jp$/;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hostOf(u) { try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; } }
  function under(h, base) { return !!base && (h === base || h.slice(-base.length - 1) === '.' + base); }
  function keyOf(kind, p) { return kind + ':' + String((p && (p.name || p.text)) || '').trim().toLowerCase(); }
  function md(iso) { var t = Date.parse(iso); if (isNaN(t)) return ''; var d = new Date(t + 9 * 3600 * 1000); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate(); }

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
    return p.text || '';
  }

  /**
   * box に描く。o: { sb, clientId, staff, email, selfHosts, onMsg(text, kind) }
   * 戻り値: Promise<{ pending: 件数 }>（DB が未適用なら null）
   */
  function mount(box, o) {
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
      var pendingAdd = function (kind) { return reqs.filter(function (r) { return r.status === 'pending' && r.action === 'add' && r.kind === kind; }); };

      function itemRow(kind, label, sub, payload) {
        var rm = pix['remove:' + keyOf(kind, payload)];
        var btn = rm ? '<span class="arc-chip is-warn">外す依頼が確認待ち</span>' :
          '<button type="button" class="arc-btn-sm" data-rq-remove="' + kind + '" data-rq-payload="' + esc(JSON.stringify(payload)) + '">' + (staff ? '外す' : '外す依頼') + '</button>';
        return '<li><span class="arq-t">' + esc(label) + (sub ? ' <small>' + sub + '</small>' : '') + '</span>' + btn + '</li>';
      }
      function waitRows(kind) {
        return pendingAdd(kind).map(function (r) { return '<li class="arq-wait"><span class="arq-t">' + esc(reqText(r)) + '</span><span class="arc-chip is-warn">追加の依頼が確認待ち</span></li>'; }).join('');
      }
      function block(kind, title, lead, items, empty, form) {
        return '<div class="arq-block"><h3 class="arc-h3">' + title + '</h3><p class="arc-note">' + lead + '</p>' +
          '<ul class="arq-list">' + (items + waitRows(kind) || '<li class="arc-empty">' + empty + '</li>') + '</ul>' + form + '</div>';
      }
      var verb = staff ? '追加する' : '追加を依頼';

      var compItems = comps.map(function (c) { return itemRow('competitor', c.name, c.url && hostOf(c.url) !== String(c.name || '').toLowerCase() ? esc(hostOf(c.url)) : '', { name: c.name }); }).join('');
      var candHtml = cands.length ? '<div class="arq-cands"><p class="arc-note"><b>候補</b>：' + esc(run.measured_on ? String(run.measured_on).slice(5).replace('-', '/') + ' の' : '最新の') +
        'AI 計測で回答の出典になったサイトです（自社・SNS・口コミや予約のサイトは除いています）。同業のお店かどうかを確かめてから選んでください。</p><ul class="arq-chips">' +
        cands.map(function (c) {
          var waiting = pix['add:' + keyOf('competitor', { name: c.host })];
          return '<li><span>' + esc(c.host) + ' <small>' + esc(c.answers) + '回答</small></span>' + (waiting ? '<span class="arc-chip is-warn">確認待ち</span>' :
            '<button type="button" class="arc-btn-sm" data-rq-cand="' + esc(c.host) + '">' + (staff ? '競合に追加' : '競合に追加を依頼') + '</button>') + '</li>';
        }).join('') + '</ul></div>' : '';
      var compForm = '<form class="arc-row arq-form" data-rq-form="competitor"><input class="arc-input" name="name" maxlength="80" placeholder="お店・会社の名前" required aria-label="競合の名前">' +
        '<input class="arc-input" name="url" maxlength="300" placeholder="https://（わかれば）" aria-label="競合のサイトの URL"><button class="arc-btn" type="submit">' + verb + '</button></form>';

      var kwItems = kws.map(function (k) { return itemRow('keyword', k.text, (k.priority ? esc(k.priority) : '') + (k.customer ? ' · ご依頼' : ''), { text: k.text }); }).join('');
      var kwForm = '<form class="arc-row arq-form" data-rq-form="keyword"><input class="arc-input" name="text" maxlength="60" placeholder="例: 渋谷 縮毛矯正" required aria-label="キーワード"><button class="arc-btn" type="submit">' + verb + '</button></form>';

      var pItems = prompts.map(function (p) { return itemRow('prompt', p.text, p.on ? '' : '候補（今は測っていません）', { text: p.text }); }).join('');
      var pForm = '<form class="arc-row arq-form" data-rq-form="prompt"><input class="arc-input arq-wide" name="text" maxlength="200" placeholder="例: 渋谷で縮毛矯正が上手い美容室は？" required aria-label="質問"><button class="arc-btn" type="submit">' + verb + '</button></form>';

      var pend = reqs.filter(function (r) { return r.status === 'pending'; });
      var done = reqs.filter(function (r) { return r.status !== 'pending'; }).slice(0, 8);
      var reqRow = function (r) {
        var who = staff ? '<small>' + esc(r.requested_by || '') + '</small>' : '';
        var acts = '';
        if (r.status === 'pending') {
          if (staff) acts = '<input class="arc-input arq-note" data-rq-note="' + r.id + '" maxlength="500" placeholder="見送る理由（お客様に表示）" aria-label="見送る理由">' +
            '<button type="button" class="arc-btn-sm arq-ok" data-rq-approve="' + r.id + '">承認して反映</button><button type="button" class="arc-btn-sm" data-rq-reject="' + r.id + '">見送る</button>';
          else if (r.requested_by && o.email && String(r.requested_by).toLowerCase() === String(o.email).toLowerCase()) acts = '<button type="button" class="arc-btn-sm" data-rq-cancel="' + r.id + '">取り消す</button>';
        }
        var s = STATUS[r.status] || [r.status, ''];
        return '<li><span class="arc-chip ' + s[1] + '">' + esc(s[0]) + '</span><span class="arq-t">' + esc(KIND[r.kind] || r.kind) + 'を' + (r.action === 'add' ? '追加' : '外す') + '：' + esc(reqText(r)) +
          ' <small>' + esc(md(r.requested_at)) + (r.decision_note && r.status !== 'pending' ? ' · ' + esc(r.decision_note) : '') + '</small>' + who + '</span>' + (acts ? '<span class="arq-acts">' + acts + '</span>' : '') + '</li>';
      };
      var reqHtml = '<div class="arq-reqs"><h3 class="arc-h3">' + (staff ? 'お客様からの依頼・変更の記録' : 'ご依頼と変更の記録') + (pend.length ? ' <span class="arc-chip is-warn">確認待ち ' + pend.length + '件</span>' : '') + '</h3>' +
        (pend.length || done.length ? '<ul class="arq-rlist">' + pend.concat(done).map(reqRow).join('') + '</ul>' : '<p class="arc-empty">' + (staff ? 'まだ依頼はありません。' : 'まだご依頼はありません。') + '</p>') + '</div>';

      box.innerHTML = '<section class="arc-card arq" id="arq">' +
        '<div class="arv-home-head"><h2 class="arc-h2">AI で比べる競合・調べるキーワード・質問</h2></div>' +
        '<p class="arc-note">' + (staff ? '承認すると Studio の作業（競合・キーワード・質問）に反映します。ここで追加・外すと、その場で反映して記録が残ります。Studio を開いたままの画面は、開き直してから保存してください。' :
          '追加したい・外したいものがあれば、ここから依頼してください。担当者が確かめてから反映し、次の計測から使います（毎月測る質問は10問までです）。') + '</p>' +
        (staff ? reqHtml : '') +
        '<div class="arq-grid">' +
        block('competitor', '競合（AI の回答で比べる相手）', 'AI がどのお店をすすめたかを数えるときに、比べる相手です。', compItems, 'まだ登録されていません。', candHtml + compForm) +
        block('keyword', '調べるキーワード', 'お客様が検索しそうな言葉です。対策と質問づくりの元にします。', kwItems, 'まだ登録されていません。', kwForm) +
        block('prompt', '毎月測る質問（' + onN + '/10問）', 'この質問を ChatGPT などの AI に毎月たずね、回答に出るかを測ります。', pItems, 'まだ登録されていません。', pForm) +
        '</div>' + (staff ? '' : reqHtml) + '</section>';
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
    function request(kind, action, payload) {
      var made = rpc('airreach_request_create', { p_client_id: cid, p_kind: kind, p_action: action, p_payload: payload });
      if (!o.staff) return act(made, '依頼しました。担当者が確かめてから反映します。');
      return act(made.then(function (r) { return r && r.ok ? rpc('airreach_request_decide', { p_id: r.id, p_approve: true, p_note: null }) : r; }), function (r) { return (r && r.applied) || (action === 'add' ? '追加しました' : '外しました'); });
    }
    function bind() {
      Array.prototype.forEach.call(box.querySelectorAll('form[data-rq-form]'), function (f) {
        f.addEventListener('submit', function (e) {
          e.preventDefault();
          var kind = f.getAttribute('data-rq-form'), payload = kind === 'competitor' ? { name: f.name.value.trim(), url: f.url.value.trim() } : { text: f.text.value.trim() };
          if (!(payload.name || payload.text)) return;
          request(kind, 'add', payload);
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
          act(rpc('airreach_request_decide', { p_id: b.getAttribute('data-rq-approve'), p_approve: true, p_note: null }), function (r) { return '承認しました：' + ((r && r.applied) || '反映しました'); });
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

  var api = { mount: mount, candidates: candidates, pendingIndex: pendingIndex, KIND: KIND };
  if (typeof window !== 'undefined') window.AirReachRequests = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
