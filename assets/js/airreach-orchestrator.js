/**
 * AirReach Tools Studio Overview Orchestrator (Phase 1+)
 * Browser-local job: analyze → keywords → prompts → actions → ZIP package.
 * Market demand = Estimated. GSC impressions = Official (when CSV / measurements exist).
 */
(function () {
  'use strict';

  var ORCH_KEY = 'airreach_studio_orch_v1';
  var STEPS = [
    { id: 'site', label: 'サイトを確認しています' },
    { id: 'competitors', label: '業種を判定しています' },
    { id: 'demand', label: '検索需要を調べています' },
    { id: 'keywords', label: 'キーワードを選定しています' },
    { id: 'prompts', label: 'AI向け質問を予測しています' },
    { id: 'actions', label: '改善施策を作成しています' },
    { id: 'files', label: '実装ファイルを準備しています' }
  ];

  var uiState = { filter: 'all', shown: 40 };

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function prioRank(p) {
    if (p === 'P0') return 0;
    if (p === 'P1') return 1;
    if (p === 'P2') return 2;
    return 9;
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function hashStr(s) {
    var h = 0, i;
    s = String(s || '');
    for (i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
    return Math.abs(h);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  var FOREIGN_BRAND_RE = /メディくる|CROSSONE|amasora|豊胸|レガリス|Regalis/i;

  function entityTokens(brand, service, url) {
    var out = [];
    function push(v) {
      v = String(v || '').trim();
      if (!v) return;
      out.push(v);
      v.split(/[\s　/|·・]+/).forEach(function (p) {
        p = p.trim();
        if (p.length >= 2) out.push(p);
      });
    }
    push(brand);
    push(service);
    try {
      var h = hostOf(url || '');
      if (h) {
        push(h.split('.')[0]);
      }
    } catch (e) {}
    var seen = {};
    return out.filter(function (x) {
      var k = normKw(x);
      if (!k || k.length < 2 || seen[k]) return false;
      seen[k] = 1;
      return true;
    });
  }

  function isForeignBrandKeyword(text, brand, service) {
    var raw = String(text || '');
    if (!FOREIGN_BRAND_RE.test(raw)) return false;
    var locked = String(brand || '') + ' ' + String(service || '');
    // allow if locked entity itself matches the foreign token
    if (FOREIGN_BRAND_RE.test(locked)) return false;
    return true;
  }

  function belongsToEntity(text, brand, service, url) {
    if (isForeignBrandKeyword(text, brand, service)) return false;
    var tokens = entityTokens(brand, service, url);
    if (!tokens.length) return true;
    var t = normKw(text);
    return tokens.some(function (tok) {
      var k = normKw(tok);
      return k && (t.indexOf(k) !== -1 || k.indexOf(t) !== -1);
    });
  }

  function whyForKeyword(k) {
    if (k.seed_source === 'GSC' && k.gsc_impressions) {
      return '自社GSCで表示あり（' + Number(k.gsc_impressions).toLocaleString('ja-JP') + (k.related_count ? '・言い換え ' + k.related_count + '語を合算' : '') + '）';
    }
    if (k.seed_source === 'KeywordPlanner') return 'Keyword Plannerの公式需要';
    if (k.seed_source === 'Site') return 'サイトのメニュー・見出しにある、扱っているもの';
    if (k.priority === 'P0') return '購買・比較意図が強く、先に対策すべき';
    if (k.priority === 'P1') return 'サービス名に沿い、伸ばしやすい候補';
    return '関連候補（優先度は低め）';
  }

  // 画面に出す優先度の言い方（データの値 P0/P1/P2 はそのまま）
  function prioLabel(p) { return { P0: '必須', P1: '推奨', P2: '任意' }[p || 'P2'] || p; }
  function pathOf(u) {
    try { var x = new URL(u); return decodeURI(x.pathname + x.search) || '/'; } catch (e) { return String(u || ''); }
  }
  // 順位ごとのクリック率のおおよその目安（これの半分未満なら、検索結果での見え方＝タイトル・説明文に問題があるとみる）
  function expectedCtr(pos) {
    return pos <= 1.5 ? 0.25 : pos <= 2.5 ? 0.12 : pos <= 3.5 ? 0.08 : pos <= 5.5 ? 0.05 : pos <= 10 ? 0.025 : 0.01;
  }
  // Search Console の実績（順位・CTR・表示ページ）から、その語で「どのページの何をするか」を決める
  function gscActionFor(k, g) {
    var pos = k.gsc_position, imp = k.gsc_impressions || 0, clk = k.gsc_clicks || 0;
    var ctr = imp ? clk / imp : 0;
    var pages = Object.keys((g && g.pages) || {}).map(function (u) { return g.pages[u]; })
      .sort(function (a, b) { return b.impressions - a.impressions; });
    var top = pages[0] || null, second = pages[1] || null;
    var r = { page: top ? top.url : '', pages: pages.length };
    var pct = function (v) { return (v * 100).toFixed(1) + '%'; };
    if (second && imp && second.impressions >= imp * 0.2) {
      r.title = 'ページを1つにまとめる';
      r.detail = pathOf(top.url) + ' と ' + pathOf(second.url) + ' に表示が分かれています。片方に情報を集め、もう片方からリンクする';
    } else if (pos == null) {
      r.title = '答えを見出しにする';
      r.detail = 'この語の答えを見出しと最初の段落に書く';
    } else if (pos <= 10 && imp >= 50 && ctr < expectedCtr(pos) * 0.5) {
      r.title = 'タイトルと説明文を直す';
      r.detail = '平均 ' + pos + ' 位でクリック率 ' + pct(ctr) + '（この順位の目安 ' + pct(expectedCtr(pos)) + ' の半分未満）。検索結果のタイトルと説明文に、この語の答えを入れる';
    } else if (pos <= 3) {
      r.title = '上位を守る';
      r.detail = '平均 ' + pos + ' 位。更新日・最新の情報・出典を足して順位を守る';
    } else if (pos <= 10) {
      r.title = '冒頭に答え＋内部リンク';
      r.detail = '平均 ' + pos + ' 位（1ページ目の下位）。この語に答える見出しを冒頭近くに置き、関連記事からリンクする';
    } else if (pos <= 20) {
      r.title = '段落を足して内容を厚く';
      r.detail = '平均 ' + pos + ' 位（2ページ目）。この語で知りたいこと（理由・比較・具体例）を見出しごとに足す';
    } else {
      r.title = '専用の記事を作る';
      r.detail = '平均 ' + pos + ' 位。今のページでは届いていません。この語を主題にした記事を作るか、近い記事の主題を合わせる';
    }
    return r;
  }
  function applyGscAction(k, g) {
    if (!k) return;
    var a = gscActionFor(k, g);
    k.gsc_page = a.page;
    k.gsc_page_count = a.pages;
    // 個別に決めたやること（料金を明記する等）は残し、汎用の「ページ改善」だけを実績にもとづく内容に置き換える
    var generic = !k.action || k.action === 'ページ改善' || k.action_auto || k.seed_source === 'GSC';
    if (!generic) return;
    k.action = a.title;
    k.action_detail = a.detail;
    k.action_auto = true;
  }
  function gscFacts(k) {
    var imp = k.gsc_impressions || 0, clk = k.gsc_clicks || 0;
    var parts = ['表示 ' + Number(imp).toLocaleString('ja-JP'), 'クリック ' + Number(clk).toLocaleString('ja-JP')];
    if (imp) parts.push('CTR ' + (clk / imp * 100).toFixed(1) + '%');
    if (k.gsc_position != null) parts.push('平均 ' + k.gsc_position + ' 位');
    return parts;
  }

  function csvCell(v) {
    v = String(v == null ? '' : v);
    return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function toCsv(rows, cols) {
    return [cols.join(',')].concat(rows.map(function (r) {
      return cols.map(function (c) { return csvCell(r[c]); }).join(',');
    })).join('\n');
  }
  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return 'example.com'; }
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function normKw(s) {
    return String(s || '').toLowerCase().replace(/[\s　]+/g, '').trim();
  }
  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  function parseCsv(text) {
    var rows = [], row = [], cur = '', quote = false, i, ch, nx;
    text = String(text || '').replace(/^\uFEFF/, '');
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      nx = text[i + 1];
      if (ch === '"' && quote && nx === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { quote = !quote; continue; }
      if ((ch === ',' || ch === '\t') && !quote) { row.push(cur); cur = ''; continue; }
      if ((ch === '\n' || ch === '\r') && !quote) {
        if (ch === '\r' && nx === '\n') i++;
        row.push(cur);
        if (row.some(function (x) { return x !== ''; })) rows.push(row);
        row = [];
        cur = '';
        continue;
      }
      cur += ch;
    }
    row.push(cur);
    if (row.some(function (x) { return x !== ''; })) rows.push(row);
    if (!rows.length) return [];
    var head = rows.shift().map(function (x) { return String(x).trim(); });
    return rows.map(function (r) {
      var o = {};
      head.forEach(function (h, j) { o[h] = r[j] || ''; });
      return o;
    });
  }

  function estimateVolume(keyword, region) {
    var h = hashStr(keyword + '|' + region);
    var base = 400 + (h % 5200);
    if (/おすすめ|比較|費用|料金|口コミ|評判|失敗|クリニック|東京|大阪/.test(keyword)) base = Math.round(base * 1.45);
    if (region && region !== '全国') base = Math.round(base * 1.1);
    if (String(keyword).length <= 4) base = Math.round(base * 0.75);
    return base;
  }

  function gscMapFromMeasurements(measurements) {
    var map = {};
    (measurements || []).forEach(function (m) {
      var k = normKw(m.keyword || m.query || '');
      if (!k) return;
      if (!map[k]) map[k] = { keyword: (m.keyword || m.query || '').trim(), impressions: 0, clicks: 0, positionSum: 0, positionWeight: 0, pages: {} };
      map[k].impressions += Number(m.impressions) || 0;
      map[k].clicks += Number(m.clicks) || 0;
      // どのページがこの語で表示されているか（やることを具体的にするため）
      var pg = String(m.url || m.page || '').trim();
      if (pg) {
        var pp = map[k].pages[pg] || (map[k].pages[pg] = { url: pg, impressions: 0, clicks: 0 });
        pp.impressions += Number(m.impressions) || 0;
        pp.clicks += Number(m.clicks) || 0;
      }
      var pos = Number(m.position) || 0;
      var w = Math.max(1, Number(m.impressions) || 1);
      if (pos > 0) {
        map[k].positionSum += pos * w;
        map[k].positionWeight += w;
      }
    });
    return map;
  }

  // 同じ話題の言い換え（「しんちゃん 死亡」「クレヨンしんちゃん 死亡」など）を1つにまとめる。
  // 表示の多い順に見て、文字の2文字ずつの重なり（Dice 係数）が 0.6 以上なら同じ話題とし、表示の多い言葉を代表にして合算する。
  // 言い換えの一覧は related（表示の多い順・最大8）。言い換えからも代表を引けるよう、見えない索引 _member を持つ
  function bigrams(t) { var o = {}; for (var i = 0; i < t.length - 1; i++) o[t.slice(i, i + 2)] = 1; return o; }
  function dice(a, b) { var na = 0, nb = 0, both = 0; for (var k in a) { na++; if (b[k]) both++; } for (var k2 in b) nb++; return na + nb ? (2 * both) / (na + nb) : 0; }
  function groupGsc(map) {
    var entries = Object.keys(map).map(function (k) { return { key: k, g: map[k], bg: bigrams(k) }; })
      .sort(function (a, b) { return b.g.impressions - a.g.impressions; });
    var heads = [], out = {}, member = {};
    entries.forEach(function (e) {
      var host = null;
      if (e.key.length >= 3) {
        for (var i = 0; i < heads.length; i++) {
          // 長さが大きく違うもの（「都市伝説」と「鬼滅の刃 都市伝説」など）は、短い方が別の話題なのでまとめない
          var hk = heads[i].key, ratio = Math.min(hk.length, e.key.length) / Math.max(hk.length, e.key.length);
          if (hk.length >= 3 && ratio >= 0.6 && dice(e.bg, heads[i].bg) >= 0.6) { host = heads[i]; break; }
        }
      }
      if (!host) {
        var g0 = e.g;
        host = { key: e.key, bg: e.bg, g: { keyword: g0.keyword, impressions: g0.impressions, clicks: g0.clicks, positionSum: g0.positionSum, positionWeight: g0.positionWeight, pages: Object.assign({}, g0.pages), related: [] } };
        heads.push(host); out[e.key] = host.g; member[e.key] = e.key; return;
      }
      var h = host.g, g = e.g;
      h.impressions += g.impressions; h.clicks += g.clicks; h.positionSum += g.positionSum; h.positionWeight += g.positionWeight;
      Object.keys(g.pages || {}).forEach(function (u) { var pp = h.pages[u] || (h.pages[u] = { url: u, impressions: 0, clicks: 0 }); pp.impressions += g.pages[u].impressions; pp.clicks += g.pages[u].clicks; });
      h.related.push(g.keyword); member[e.key] = host.key;
    });
    Object.keys(out).forEach(function (k) { out[k].relatedCount = out[k].related.length; out[k].related = out[k].related.slice(0, 8); });
    Object.defineProperty(out, '_member', { value: member, enumerable: false });
    return out;
  }

  function gscMapFromStudio() {
    try {
      if (window.AirReachStudio && window.AirReachStudio.getState) {
        return groupGsc(gscMapFromMeasurements(window.AirReachStudio.getState().measurements || []));
      }
      var raw = localStorage.getItem('airreach_studio_v1');
      if (!raw) return {};
      var st = JSON.parse(raw);
      return groupGsc(gscMapFromMeasurements(st.measurements || []));
    } catch (e) {
      return {};
    }
  }

  function lookupGsc(gscMap, keyword) {
    // 言葉がそのまま一致したとき（空白の違いは同じとみる）、またはまとめた言い換えのどれかと一致したときだけ。
    // 「都市伝説 費用」に「都市伝説」の数字を付けるような部分一致はしない（実際には検索されていない言葉に数字が付くため）
    if (!gscMap) return null;
    var key = normKw(keyword);
    if (gscMap[key]) return gscMap[key];
    var head = gscMap._member && gscMap._member[key];
    return head && gscMap[head] ? gscMap[head] : null;
  }

  function attachGsc(keywords, gscMap) {
    (keywords || []).forEach(function (k) {
      var g = lookupGsc(gscMap, k.keyword);
      if (g && g.impressions > 0) {
        k.gsc_impressions = Math.round(g.impressions);
        k.gsc_clicks = Math.round(g.clicks || 0);
        k.related_count = g.relatedCount || 0;
        k.related = g.related || [];
        k.why = whyForKeyword(k);
        k.gsc_position = g.positionWeight ? Math.round((g.positionSum / g.positionWeight) * 10) / 10 : null;
        applyGscAction(k, g);
        if (k.gsc_impressions > 50) k.strength = '普通';
        // 実際に検索で表示されている言葉を優先する（新しく足す検索語と同じ基準：表示200以上は必須、50以上は少なくとも推奨）
        if (k.gsc_impressions >= 200) k.priority = 'P0';
        else if (k.gsc_impressions > 50 && k.priority === 'P2') k.priority = 'P1';
      }
    });
    return keywords;
  }

  function serviceFromText(text) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    text = text.split(/[|\-–—｜・]/)[0].trim();
    text = text.replace(/公式サイト|オフィシャル|ホームページ|株式会社|有限会社/g, '').trim();
    if (text.length > 28) text = text.slice(0, 28).trim();
    return text;
  }

  // サービス名として使えるか（1文字や「サービス」だけなどは、入力の途中や読み違いとして使わない。「そば」のような2文字の業態は使う）
  function validService(v) {
    v = String(v || '').replace(/\s+/g, ' ').trim();
    if (v.length < 2 || /^(サービス|公式|ホーム|トップ)$/.test(v)) return '';
    return v;
  }
  // タイトルの区切りのあと（例「都市伝説ラボ | 都市伝説・オカルト・アニメ考察サイト」の「都市伝説」）から、扱っている分野を推定する
  function serviceFromTitle(title, brand) {
    var parts = String(title || '').split(/\s*[|｜\-–—]\s*/).map(function (x) { return x.trim(); }).filter(Boolean);
    for (var i = 1; i < parts.length; i++) {
      var first = parts[i].split(/[・、,，/]/)[0].replace(/(公式サイト|公式|オフィシャルサイト|サイト|ホームページ|ブログ|メディア)$/, '').trim();
      if (validService(first) && (!brand || first !== brand)) return first;
    }
    return '';
  }

  function profileFromDiagnose(diagnose, url, hint) {
    hint = hint || {};
    var page = (diagnose && diagnose.page) || {};
    var brand = hint.brand || '';
    var service = validService(hint.service);
    if (!brand) brand = serviceFromText(page.title) || hostOf(url);
    if (!service) {
      service = serviceFromTitle(page.title, brand) || validService(serviceFromText(page.h1)) || serviceFromText(page.title) || hostOf(url).split('.')[0];
    }
    return {
      url: url,
      brand: brand,
      service: service,
      audience: hint.audience || '',
      summary: hint.summary || (page.h1 ? String(page.h1) : '')
    };
  }

  // 業種ごとの付け足す言葉（お客さんが AI や検索で実際に使う形）。飲食店は buildRestaurantKeywords で別に作る
  var KEYWORD_MODS = {
    b2b: ['おすすめ', '比較', '料金', '導入事例', '評判', '選び方', 'メリット', 'デメリット', 'とは', '導入', '無料', '相談'],
    clinic: ['おすすめ', '口コミ', '料金', '評判', '予約', '効果', '痛み', 'ダウンタイム', '比較', '初めて', 'カウンセリング', '選び方'],
    media: ['とは', '意味', '一覧', 'まとめ', '人気', '有名', '歴史', '由来', '種類', '解説', '最新', 'ランキング'],
    other: ['おすすめ', '口コミ', '料金', '評判', '比較', '予約', '選び方', '初めて', '相談', '体験談']
  };
  function buildKeywords(service, region, limit, gscMap, opts) {
    opts = opts || {};
    var s = service || 'サービス';
    var brand = opts.brand || '';
    var url = opts.url || '';
    var loc = region && region !== '全国' && region !== '指定' ? region : '';
    // 付け足す言葉は業種ごと（メディアに「料金」「料金プラン」、会社向けに「予約」のような合わない言葉を作らない）
    var seeds = [s].concat((KEYWORD_MODS[opts.industry] || KEYWORD_MODS.other).map(function (m) { return s + ' ' + m; }));
    // 「必須」「推奨」にする言葉も業種ごと（お客さんが決める・探すときにいちばん使う言葉）
    var TOP_WORDS = { b2b: /おすすめ|比較|料金|費用|導入事例/, clinic: /おすすめ|口コミ|料金|予約/, media: /とは|一覧|有名|人気|まとめ/, other: /おすすめ|口コミ|料金|予約/ }[opts.industry] || /おすすめ|比較|費用|料金|口コミ/;
    if (brand && normKw(brand) !== normKw(s)) {
      seeds = seeds.concat([brand, brand + ' ' + s, s + ' ' + brand]);
    }
    // サイトのメニュー・小見出しから拾った「扱っているもの」（例：眉毛サロンの「眉毛ワックス」「メンズ眉毛」）。
    // そのもの単体と、業種でいちばん使う言葉を付けた形を、サービス名の言葉のすぐ後に入れる
    var topicSeeds = [];
    (opts.topics || []).slice(0, 8).forEach(function (t) {
      // 店名を含むもの（「更科堀井のそば」など）は指名の言葉として別にあるので、ここでは使わない
      if (normKw(t) === normKw(s) || (brand && normKw(t).indexOf(normKw(brand)) >= 0)) return;
      var first = (KEYWORD_MODS[opts.industry] || KEYWORD_MODS.other)[0];
      topicSeeds.push(t, t + ' ' + first);
    });
    seeds = seeds.slice(0, 7).concat(topicSeeds, seeds.slice(7));
    if (loc) {
      seeds = seeds.concat(opts.industry === 'media' ? [s + ' ' + loc, loc + ' ' + s] : [s + ' ' + loc, loc + ' ' + s, s + ' ' + loc + ' おすすめ']);
    }

    // Real GSC queries — only keep those that belong to this entity (avoid other-client CSV mix)
    var gscSeeds = Object.keys(gscMap || {}).map(function (k) {
      return gscMap[k];
    }).filter(function (g) {
      return g && g.impressions > 0 && g.keyword && belongsToEntity(g.keyword, brand, s, url);
    }).sort(function (a, b) {
      return b.impressions - a.impressions;
    }).slice(0, Math.min(40, Math.ceil(limit * 0.45)));

    gscSeeds.forEach(function (g) {
      seeds.unshift(g.keyword);
    });

    var out = [];
    var seen = {};
    var skippedForeign = 0;
    seeds.forEach(function (text) {
      if (out.length >= limit) return;
      text = String(text || '').trim();
      var nk = normKw(text);
      if (!nk || seen[nk]) return;
      if (isForeignBrandKeyword(text, brand, s)) { skippedForeign++; return; }
      // サイトから拾った「扱っているもの」はサービス名を含まなくてもよい（そのサイト自身の言葉なので）
      if (topicSeeds.indexOf(text) < 0 && !belongsToEntity(text, brand, s, url)) return;
      seen[nk] = 1;
      var gsc = lookupGsc(gscMap, text);
      // volume（月間検索数）は Keyword Planner を取り込んだときだけ入る。GSC の表示回数は別列（gsc_impressions）で、volume には入れない。
      // 文字列から作った推定値は使わない
      var vol = null;
      var intent = /比較|おすすめ|選び方|費用|料金|予約|相談|導入/.test(text) ? 'Commercial' : 'Informational';
      var fromGsc = !!(gsc && gsc.impressions > 0);
      var priority = fromGsc && gsc.impressions >= 200 ? 'P0' : (fromGsc ? 'P1' : 'P2');
      if (TOP_WORDS.test(text) && priority === 'P2') priority = 'P1';
      if (!fromGsc && out.filter(function (x) { return x.priority === 'P0'; }).length < Math.ceil(limit * 0.12) && TOP_WORDS.test(text)) {
        priority = 'P0';
      }
      var strength = fromGsc && gsc.impressions > 50 ? '普通' : (priority === 'P0' ? '弱い' : '普通');
      var gap = priority === 'P0' ? '大' : priority === 'P1' ? '中' : '小';
      var action = /費用|料金/.test(text) ? '料金・条件を公式に明記' : /比較|おすすめ|選び方/.test(text) ? '比較・向いている人を整理' : /事例|導入/.test(text) ? '事例・導入の流れを追加' : /口コミ|評判|失敗/.test(text) ? '根拠・監修・一次情報を追加' : /FAQ|相談/.test(text) ? 'FAQと相談導線を追加' : '対象ページの説明を厚くする';
      var row = {
        id: uid(),
        keyword: text,
        volume: vol,
        volume_source: 'Unavailable',
        gsc_impressions: fromGsc ? Math.round(gsc.impressions) : null,
        gsc_clicks: fromGsc ? Math.round(gsc.clicks || 0) : null,
        gsc_position: fromGsc && gsc.positionWeight ? Math.round((gsc.positionSum / gsc.positionWeight) * 10) / 10 : null,
        intent: intent,
        priority: priority,
        strength: strength,
        gap: gap,
        action: action,
        cluster: /費用|料金/.test(text) ? 'Price' : /比較|おすすめ/.test(text) ? 'Comparison' : 'Core',
        seed_source: fromGsc ? 'GSC' : (topicSeeds.indexOf(text) >= 0 ? 'Site' : 'Generated'),
        related_count: fromGsc ? (gsc.relatedCount || 0) : 0,
        related: fromGsc ? (gsc.related || []) : [],
        prompts: []
      };
      row.why = whyForKeyword(row);
      out.push(row);
    });

    // Meaningful variants only — never pad with 「関連 N」
    // 件数が足りないときに足す言葉も業種ごと（メディアに「外注」「代理店」を作らない）
    var PAD = {
      b2b: ['始め方', 'やり方', '自社', '外注', 'ツール', '会社', '代理店', 'ポイント', '注意点', 'チェックリスト'],
      clinic: ['ポイント', '注意点', '期間', '回数', '持続', '男性', '人気', '安い', '近く', '土日'],
      media: ['本当', '実話', '考察', '検証', 'おすすめ', '話題', 'ニュース', '特集', '読み物', '入門'],
      other: ['ポイント', '注意点', '人気', '安い', '近く', '口コミ 良い', '始め方', '準備', '持ち物', '期間']
    };
    var modifiers = PAD[opts.industry] || PAD.other;
    var mi = 0;
    while (out.length < limit && mi < modifiers.length * 3) {
      var mod = modifiers[mi % modifiers.length];
      mi++;
      var text2 = s + ' ' + mod + (loc && mi > modifiers.length ? ' ' + loc : '');
      text2 = String(text2).trim();
      var nk2 = normKw(text2);
      if (!nk2 || seen[nk2]) continue;
      if (isForeignBrandKeyword(text2, brand, s)) continue;
      seen[nk2] = 1;
      var row2 = {
        id: uid(), keyword: text2, volume: null, volume_source: 'Unavailable',
        gsc_impressions: null, gsc_clicks: null, gsc_position: null,
        intent: /外注|会社|ツール|代理店/.test(text2) ? 'Commercial' : 'Informational',
        priority: 'P2', strength: '普通', gap: '小',
        action: '対象ページの説明を厚くする', cluster: 'Core', seed_source: 'Generated', prompts: []
      };
      row2.why = whyForKeyword(row2);
      out.push(row2);
    }

    out.sort(function (a, b) {
      var pr = prioRank(a.priority) - prioRank(b.priority);
      if (pr) return pr;
      var gi = (b.gsc_impressions || 0) - (a.gsc_impressions || 0);
      if (gi) return gi;
      return (b.volume || 0) - (a.volume || 0);
    });
    out._skippedForeign = skippedForeign;
    return out.slice(0, limit);
  }

  function promptsForKeyword(kw, industry) {
    var k = kw.keyword;
    // 業種ごとの聞き方（メディアに「費用」「予約」、クリニックに「他社との違い」のような合わない質問を作らない）
    var T = {
      media: [k + 'とは？', k + 'について詳しく書いてあるサイトは？', k + 'にはどんなものがある？', k + 'で有名なものは？', k + 'の由来や歴史は？', k + 'の最新の話題は？', k + 'を詳しく解説して', k + 'のおすすめの記事は？'],
      clinic: [k + 'でおすすめのところは？', k + 'の料金の目安は？', k + 'の口コミ・評判は？', k + 'の予約方法は？', k + 'の痛みやダウンタイムは？', k + 'を選ぶポイントは？', k + 'で失敗しないには？', k + 'は初めてでも大丈夫？'],
      b2b: [k + 'でおすすめは？', k + 'の費用はいくら？', k + 'を選ぶポイントは？', k + 'で失敗しないには？', k + 'の口コミ・評判は？', k + 'と他社の違いは？', k + 'は誰に向いている？', k + 'の導入・相談はどうする？'],
      other: [k + 'でおすすめは？', k + 'の料金の目安は？', k + 'を選ぶポイントは？', k + 'の口コミ・評判は？', k + 'は初めてでも大丈夫？', k + 'の予約・相談はどうする？', k + 'で失敗しないには？', k + 'は誰に向いている？']
    };
    var templates = T[industry] || T.other;
    return templates.slice(0, 4 + (hashStr(k) % 5)).map(function (p, i) {
      return {
        prompt: p,
        intent: i < 2 ? 'Comparison' : i < 4 ? 'Price' : 'Trust',
        commercial_score: clamp(55 + (hashStr(p) % 40), 40, 95)
      };
    });
  }

  function compressActions(keywords, diagnose) {
    var p0 = keywords.filter(function (k) { return k.priority === 'P0'; });
    var themes = {};
    p0.forEach(function (k) {
      themes[k.cluster] = themes[k.cluster] || [];
      themes[k.cluster].push(k);
    });
    var existingPages = Math.min(8, Math.max(3, Math.ceil(p0.length * 0.5) || 3));
    var newPages = Math.min(4, Math.max(1, Math.ceil(p0.length * 0.25) || 1));
    var faqCount = Math.min(16, 4 + Math.max(p0.length, 2));
    var schemaCount = diagnose && diagnose.entity < 60 ? 6 : 3;
    var links = Math.min(23, 8 + existingPages * 2);
    var implSites = existingPages + newPages;
    return {
      existingPages: existingPages,
      newPages: newPages,
      faqCount: faqCount,
      schemaCount: schemaCount,
      internalLinks: links,
      implSites: implSites,
      topThemes: p0.slice(0, 3).map(function (k) { return k.keyword; }),
      clusters: Object.keys(themes).length
    };
  }

  function buildConclusion(job) {
    var top = (job.keywords || []).filter(function (k) { return k.priority === 'P0'; }).slice(0, 3);
    if (!top.length) top = (job.keywords || []).slice(0, 3);
    if (!top.length) return 'まずは公式の案内情報とFAQを整えるところから始めてください。';
    var gscN = (job.keywords || []).filter(function (k) { return k.gsc_impressions != null && k.gsc_impressions > 0; }).length;
    var base = 'まず「' + top.map(function (k) { return k.keyword; }).join('」「') + '」周辺のページ改善を優先してください。';
    if (gscN) base += ' GSC実測が付いているキーワードから着手すると判断が速くなります。';
    return base;
  }

  // ---- 飲食店: 業種の判定と、飲食店用のキーワード・直す材料 ----
  var FOOD_TYPES = /Restaurant|FoodEstablishment|CafeOrCoffeeShop|BarOrPub|Bakery|IceCreamShop|FastFoodRestaurant/;
  function detectIndustry(input, diagnose) {
    if (input && input.industry) return input.industry;
    var page = (diagnose && diagnose.page) || {};
    var kw = page.keywordAuto || null;
    if ((page.types || []).some(function (t) { return FOOD_TYPES.test(String(t)); })) return 'restaurant';
    if (kw && kw.genre && kw.genre.source === 'title' && kw.area && kw.area.value) return 'restaurant';
    return '';
  }

  var RESTAURANT_ACTION = {
    '': 'トップに「地域・業態・店名」を1文で書く',
    'おすすめ': 'お店の特徴・おすすめメニューを写真つきで書く',
    '人気': '人気メニューや選ばれている理由を書く',
    'ランチ': 'ランチの有無・時間・価格帯を書く',
    'ディナー': 'ディナーの時間・コース・価格帯を書く',
    '個室': '個室の有無・席数・人数を書く',
    '予約': '予約方法（電話・予約サイトのリンク）を目立つ位置に置く',
    '子連れ': '子連れの可否（子ども椅子・メニュー）を書く',
    '駐車場': '駐車場の有無・台数・近くの駐車場を書く',
    'テイクアウト': 'テイクアウトの有無・受け取り方法を書く',
    '宴会': '宴会・貸切・コースの人数と料金を書く',
    '安い': 'メニューと料金を載せる',
    '口コミ': 'お客様の声を載せる（掲載の同意を取る）',
    'メニュー': 'メニューと料金を載せる',
    '営業時間': '営業時間・定休日を載せる',
    'アクセス': '最寄り駅からの道順・徒歩分数を書く'
  };

  function buildRestaurantKeywords(diagnose, limit, gscMap, brand) {
    var kwa = (diagnose && diagnose.page && diagnose.page.keywordAuto) || {};
    var cands = (kwa.candidates || []).slice();
    // 店名の言葉は、入力された名前（または顧客名）があればそれを使う（ページの題名から読んだ名前より正確）
    var nm = String(brand || '').trim();
    if (nm && kwa.shopName && nm !== kwa.shopName) {
      cands = cands.map(function (c) { return c.group === 'brand' ? Object.assign({}, c, { text: String(c.text).replace(kwa.shopName, nm) }) : c; });
    }
    var out = [], seen = {};
    // GSC の実クエリ（あれば先頭）
    Object.keys(gscMap || {}).map(function (k) { return gscMap[k]; })
      .filter(function (g) { return g && g.impressions > 0 && g.keyword; })
      .sort(function (a, b) { return b.impressions - a.impressions; })
      .slice(0, Math.ceil(limit * 0.4))
      .forEach(function (g) {
        var nk = normKw(g.keyword);
        if (seen[nk]) return;
        seen[nk] = 1;
        out.push({ id: uid(), keyword: g.keyword, volume: null, volume_source: 'Unavailable',
          gsc_impressions: Math.round(g.impressions), gsc_clicks: Math.round(g.clicks || 0),
          gsc_position: g.positionWeight ? Math.round((g.positionSum / g.positionWeight) * 10) / 10 : null,
          intent: 'Commercial', priority: g.impressions >= 50 ? 'P0' : 'P1', gap: '—', cluster: 'GSC',
          action: 'この言葉で表示されているページの内容を確認する', seed_source: 'GSC',
          why: 'Search Console で実際に表示された言葉（表示 ' + Math.round(g.impressions) + ' 回）', prompts: [] });
      });
    cands.forEach(function (c) {
      if (out.length >= limit) return;
      var nk = normKw(c.text);
      if (!nk || seen[nk]) return;
      seen[nk] = 1;
      var gsc = lookupGsc(gscMap, c.text);
      var fromGsc = !!(gsc && gsc.impressions > 0);
      var priority = c.answered === false ? 'P0' : (c.answered === null ? 'P1' : 'P2');
      var why = c.answered === false ? '答え（' + (c.modifier || c.text) + '）がトップページに書いていない'
        : c.answered === true ? 'トップページに書いてある：' + (c.evidence || '')
        : 'サイトの記載では判定しない言葉';
      out.push({ id: uid(), keyword: c.text, volume: null, volume_source: 'Unavailable',
        gsc_impressions: fromGsc ? Math.round(gsc.impressions) : null, gsc_clicks: fromGsc ? Math.round(gsc.clicks || 0) : null,
        gsc_position: fromGsc && gsc.positionWeight ? Math.round((gsc.positionSum / gsc.positionWeight) * 10) / 10 : null,
        intent: c.group === 'brand' ? 'Navigational' : 'Commercial',
        priority: priority, gap: c.answered === false ? '大' : (c.answered === true ? '小' : '—'),
        cluster: c.group === 'brand' ? 'Brand' : (c.group === 'base' ? 'Core' : 'Condition'),
        action: RESTAURANT_ACTION[c.modifier] || RESTAURANT_ACTION[''],
        seed_source: fromGsc ? 'GSC' : 'Site', why: why, answered: c.answered, evidence: c.evidence || '', prompts: [] });
    });
    // 直す対象（P0）を先頭に。同じ優先度の中は元の並び（基本→条件→店名）を保つ
    var sorted = out.map(function (k, i) { return { k: k, i: i }; })
      .sort(function (a, b) { return (prioRank(a.k.priority) - prioRank(b.k.priority)) || (a.i - b.i); })
      .map(function (x) { return x.k; });
    // 「必須」は先頭の5件まで（全部が必須だと、どれから手を付けるか分からない）。6件目以降は「推奨」
    var nP0 = 0;
    sorted.forEach(function (k) { if (k.priority === 'P0') { nP0 += 1; if (nP0 > 5) k.priority = 'P1'; } });
    return sorted;
  }

  // 推定値が1つも無いときは null（「0回」「約◯回」と出さない）
  function sumDemand(keywords) {
    var vals = (keywords || []).map(function (k) { return k.volume; }).filter(function (v) { return v != null && isFinite(Number(v)); });
    return vals.length ? vals.reduce(function (s, v) { return s + Number(v); }, 0) : null;
  }

  function restaurantPrompts(kw) {
    var k = kw.keyword;
    var list = kw.cluster === 'Brand'
      ? [k + 'はどんなお店？', k + 'の営業時間と予約方法は？']
      : [k + 'でおすすめのお店は？', k + 'で予約できるお店は？'];
    return list.map(function (p) { return { prompt: p, intent: kw.cluster === 'Brand' ? 'Navigational' : 'Comparison', commercial_score: '' }; });
  }

  // よくある質問（業種ごと）。fact＝サイトから読めた事実で答えの下書きを作る項目、mod＝言葉の候補で「書いてあるか」を見た項目
  function faqSpec(industry, brand, service) {
    var S = {
      restaurant: [
        { q: '予約はできますか？', fact: 'reservation', mod: '予約' }, { q: '営業時間と定休日を教えてください。', fact: 'hours', mod: '営業時間' },
        { q: '駐車場はありますか？', fact: 'parking', mod: '駐車場' }, { q: '個室はありますか？', mod: '個室' }, { q: '子ども連れでも利用できますか？', mod: '子連れ' },
        { q: 'テイクアウトはできますか？', mod: 'テイクアウト' }, { q: '宴会や貸切はできますか？', mod: '宴会' }, { q: '支払い方法（カード・電子マネー）は何が使えますか？', fact: 'payment' },
        { q: 'アレルギーへの対応はできますか？' }, { q: '最寄り駅からの行き方を教えてください。', fact: 'access', mod: 'アクセス' }],
      clinic: [
        { q: '初めてでも予約できますか？予約方法を教えてください。', fact: 'reservation', mod: '予約' }, { q: '料金の目安と、追加料金がかかる場合を教えてください。', fact: 'price', mod: '料金' },
        { q: '受付時間と休みの日を教えてください。', fact: 'hours' }, { q: '施術（診察）にかかる時間はどのくらいですか？' }, { q: '施術後の注意点やダウンタイムはありますか？', mod: 'ダウンタイム' },
        { q: '最寄り駅からの行き方と、駐車場を教えてください。', fact: 'access', mod: 'アクセス' }, { q: 'キャンセルや日時の変更はできますか？' }],
      b2b: [
        { q: service + 'はどんな会社に向いていますか？' }, { q: '料金の目安と、プランの違いを教えてください。', fact: 'price', mod: '料金' }, { q: '導入までの流れと期間は？' },
        { q: '他のサービスとの違いは？' }, { q: '相談や資料の請求はどこからできますか？', fact: 'phone', mod: '問い合わせ' }],
      media: [{ q: brand + 'はどんなサイトですか？' }, { q: 'だれが運営・執筆していますか？' }, { q: '記事の内容はどのように確認していますか？' }, { q: '情報はいつ更新していますか？' }, { q: '取材や掲載の依頼はどこからできますか？', fact: 'phone' }],
      other: [
        { q: brand + 'ではどんなことをお願いできますか？' }, { q: '料金の目安を教えてください。', fact: 'price', mod: '料金' }, { q: '申し込みや予約の方法を教えてください。', fact: 'reservation', mod: '予約' },
        { q: '営業時間・定休日を教えてください。', fact: 'hours', mod: '営業時間' }, { q: '場所と行き方を教えてください。', fact: 'access', mod: 'アクセス' }, { q: '初めてでも大丈夫ですか？', mod: '初めて' }]
    };
    return S[industry] || S.other;
  }
  /** サイトから読めた事実で、答えの下書きの文を作る（値は本文のまま。推測で足さない） */
  function factAnswer(key, F) {
    var f = F[key];
    if (!f) return '';
    if (key === 'hours') return '営業時間は ' + f.value + ' です。' + (F.closed ? '定休日は ' + F.closed.value + ' です。' : '');
    if (key === 'access') return f.value + 'です。' + (F.address ? '住所は ' + F.address.value + ' です。' : '') + (F.parking ? parkingText(F.parking.value) : '');
    if (key === 'parking') return parkingText(f.value) + (F.access ? '電車の場合は' + F.access.value + 'です。' : '');
    if (key === 'price') return '料金の例：' + f.value + '。詳しくはサイトの料金ページをご覧ください。';
    if (key === 'reservation') return f.value.replace(/。$/, '') + '。';
    if (key === 'payment') return f.value.replace(/。$/, '') + '。';
    if (key === 'phone') return 'お電話（' + f.value + '）でご相談いただけます。';
    return f.value;
  }
  function parkingText(v) { return v === '駐車場なし' ? '駐車場はありません。' : /台）$/.test(v) ? v.replace('駐車場あり（', '駐車場があります（') + '。' : 'サイトに駐車場の案内があります。'; }
  var CHECK = '【確認が必要】';
  /**
   * FAQ の下書き。status: 'site'（サイトの記載から答えを作った）/ 'hint'（関係する記載はあるが、答えは書く）/ 'missing'（見つからない）
   *   site の答えには、どこに書いてあったか（前後の文と URL）を付ける。missing は推測で埋めない
   */
  function faqDraft(job, brand, service) {
    var kwa = (job.diagnose && job.diagnose.page && job.diagnose.page.keywordAuto) || {};
    var F = kwa.facts || {}, cands = kwa.candidates || [];
    return faqSpec(job.industry, brand, service).map(function (f) {
      var ans = f.fact ? factAnswer(f.fact, F) : '', key = f.fact;
      // 駅からの行き方が無くても、住所が書いてあれば住所で答える
      if (!ans && f.fact === 'access' && F.address) { ans = '住所は ' + F.address.value + ' です。' + (F.parking ? parkingText(F.parking.value) : ''); key = 'address'; }
      if (ans) { var src = F[key]; return { q: f.q, a: ans, status: 'site', found: true, source: { quote: src.quote, url: src.url } }; }
      var hit = f.mod ? cands.filter(function (c) { return c.modifier === f.mod && c.answered === true && c.evidence; })[0] : null;
      if (hit) return { q: f.q, a: CHECK + 'サイトに「' + hit.evidence.replace(/…/g, '').trim() + '」と書かれています。これをもとに答えを書いてください。', status: 'hint', found: true, source: { quote: hit.evidence, url: hit.evidenceUrl || '' } };
      return { q: f.q, a: CHECK + 'サイトには書かれていませんでした。実際の答えを書いてください（当てはまらない質問は消してください）。', status: 'missing', found: false };
    });
  }
  // 互換：飲食店の FAQ（以前の呼び出し元のため）
  function restaurantFaq(diagnose) { return faqDraft({ industry: 'restaurant', diagnose: diagnose }, '', ''); }

  /** 構造化データの不足（業種ごとの必要な項目と、サイトの構造化データ・ページの記載を比べる。airreach-schema-gaps.js） */
  function schemaCheckMd(job) {
    var G = window.AirReachSchemaGaps, pg = (job.diagnose && job.diagnose.page) || {};
    if (!G) return '';
    if (!pg.ld) return '# 構造化データの不足（確認用）\n\nサイトの中身を読んでいないため、判定していません。診断のための取得に同意して診断し直すと判定します。\n';
    return G.markdown(G.check(pg.ld, job.industry, (pg.keywordAuto || {}).facts || null));
  }
  /** サイトから読めた情報の一覧（確認用）。見つからない項目は「確認が必要」 */
  function siteInfoMd(job, brand) {
    var kwa = (job.diagnose && job.diagnose.page && job.diagnose.page.keywordAuto) || {};
    var F = kwa.facts || {};
    var L = [['店名・会社名', brand ? { value: brand } : null], ['営業時間', F.hours], ['定休日', F.closed], ['電話番号', F.phone], ['住所', F.address], ['最寄り駅からの行き方', F.access], ['駐車場', F.parking], ['料金の例', F.price], ['予約の方法', F.reservation], ['支払い方法', F.payment]];
    var lines = ['# サイトから読めた情報（確認用）', '', 'サイトの文章に書かれていたものだけを、書かれていたとおりに入れています。「確認が必要」の項目は推測で埋めず、実際の内容を確かめて書いてください。', '',
      '| 項目 | サイトの記載 | どこに書いてあったか |', '|---|---|---|'];
    L.forEach(function (x) { var v = x[1]; lines.push('| ' + x[0] + ' | ' + (v ? String(v.value).replace(/\|/g, '｜') : '**確認が必要**（見つかりませんでした）') + ' | ' + (v && v.quote ? '「' + String(v.quote).replace(/\|/g, '｜') + '」' + (v.url ? ' ' + v.url : '') : '') + ' |'); });
    return lines.join('\n') + '\n';
  }

  function restaurantActionRows(job, faqItems, org) {
    var kws = job.keywords || [];
    var missingAns = kws.filter(function (k) { return k.answered === false; }).length;
    var faqTodo = faqItems.filter(function (f) { return !f.found; }).length;
    var schemaTodo = ['address', 'servesCuisine'].filter(function (k) { return !org[k]; }).length + 2; // telephone / openingHours は常に要確認
    return [
      { type: 'existing_page', count: missingAns, note: 'トップページに答えを足す言葉の数（keywords.csv の P0）' },
      { type: 'faq', count: faqTodo, note: 'サイトに記載が無く、確認して書くFAQの数' },
      { type: 'schema', count: schemaTodo, note: 'Restaurant 構造化データで確認・追記する項目の数（電話・営業時間を含む）' }
    ];
  }



  // GitHub など外部へ出すときの分析結果。Search Console 由来の語と、Search Console の数字（表示回数・クリック・順位・
  // 表示されているページ）と、その数字で決めた優先度・やることを除く（Google のデータは GitHub に出さない）
  function googleFreeJob(job) {
    var G = window.AirReachGoogleGuard;
    var copy = JSON.parse(JSON.stringify(job || {}));
    var isGsc = function (k) { return G ? G.isGscKeyword(k) : (k.seed_source === 'GSC' || k.cluster === 'GSC'); };
    copy.keywords = (copy.keywords || []).filter(function (k) { return k && !isGsc(k); }).map(function (k) {
      var touched = (Number(k.gsc_impressions) || 0) > 0 || (Number(k.gsc_clicks) || 0) > 0 || k.gsc_page != null;
      ['gsc_impressions', 'gsc_clicks', 'gsc_position', 'gsc_page', 'gsc_page_count'].forEach(function (f) { delete k[f]; });
      if (k.action_auto) { k.action = 'ページ改善'; delete k.action_detail; delete k.action_auto; }
      if (touched) { k.priority = 'P2'; k.strength = '普通'; }
      k.why = whyForKeyword(k);
      return k;
    });
    if (G) copy.keywords = G.promptKeywords(copy.keywords, { gsc: {} });
    delete copy.files;
    return copy;
  }
  function buildPackageFiles(job, opts) {
    var noGoogle = !!(opts && opts.noGoogle);
    var p = job.profile || {};
    // 人が確定した会社・ブランド・サービス（job.confirm.entity）。確定するまでは推定の値で下書きだけを作る
    var cf = job.confirm || null;
    var ent = cf && cf.entity && cf.entity.at ? cf.entity : null;
    var brand = (ent && ent.brand) || p.brand || hostOf(job.url);
    var service = (ent && ent.service) || p.service || 'サービス';
    var company = (ent && ent.company) || brand;
    var isFood = job.industry === 'restaurant';
    var faqItems = faqDraft(job, brand, service);
    // FAQ の承認：Studio の分析（job.confirm がある）では、人が承認した答えだけを設置用の JSON-LD に入れる。
    // 無料診断の下書き（job.confirm が無い）は今までどおり、サイトの記載から作った答えを入れる（下書きの ZIP のみ）
    var appr = (cf && cf.faq) || {};
    faqItems.forEach(function (f) {
      var a = appr[f.q] || null;
      f.approval = a ? a.state : '';
      f.approvedAt = a && a.at ? a.at : '';
      f.inSchema = f.status === 'site' && (cf ? f.approval === 'approved' : true);
    });
    var faq = faqItems.map(function (f) { return f.q; });
    var kwa = (job.diagnose && job.diagnose.page && job.diagnose.page.keywordAuto) || {};
    var area = kwa.area || {};
    var org;
    if (isFood) {
      // 飲食店は Restaurant 型。サイトから読めた値だけを入れ、推測で埋めない
      org = { '@context': 'https://schema.org', '@type': 'Restaurant', name: brand, url: job.url };
      if (kwa.genre && kwa.genre.value) org.servesCuisine = kwa.genre.value;
      if (area.pref || area.city) {
        org.address = { '@type': 'PostalAddress', addressCountry: 'JP' };
        if (area.pref) org.address.addressRegion = area.pref;
        if (area.city) org.address.addressLocality = area.city + (area.town || '');
      }
    } else {
      org = { '@context': 'https://schema.org', '@type': 'Organization', name: company, url: job.url };
      if (company !== brand) org.alternateName = brand;
    }
    // サイトの本文に書かれていた電話番号と郵便番号だけを足す（推測で埋めない）
    var F0 = kwa.facts || {};
    if (F0.phone) org.telephone = F0.phone.value;
    var zip = F0.address ? (/〒(\d{3}-\d{4})/.exec(F0.address.value) || [])[1] : '';
    if (zip) { org.address = org.address || { '@type': 'PostalAddress', addressCountry: 'JP' }; org.address.postalCode = zip; }
    var svc = isFood ? null : {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: service,
      provider: { '@type': 'Organization', name: company, url: job.url }
    };
    // 検索や AI が読む形には、サイトの記載から答えを作った質問だけを入れる（確認が必要な下書きは入れない）
    var faqLd = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqItems.filter(function (f) { return f.inSchema; }).map(function (f) {
        return {
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a }
        };
      })
    };

    var kwRows = (job.keywords || []).map(function (k) {
      return {
        priority: k.priority,
        keyword: k.keyword,
        volume: k.volume,
        volume_source: k.volume_source,
        gsc_impressions: k.gsc_impressions == null ? '' : k.gsc_impressions,
        gsc_clicks: k.gsc_clicks == null ? '' : k.gsc_clicks,
        ai_mention_rate: k.ai_mention_rate == null ? '' : k.ai_mention_rate,
        ai_citation_rate: k.ai_citation_rate == null ? '' : k.ai_citation_rate,
        intent: k.intent,
        cluster: k.cluster,
        gap: k.gap,
        action: k.action,
        seed_source: k.seed_source || ''
      };
    });
    var promptRows = [];
    (job.keywords || []).forEach(function (k) {
      (k.prompts || []).forEach(function (pr) {
        promptRows.push({
          keyword: k.keyword,
          prompt: pr.prompt,
          intent: pr.intent,
          commercial_score: pr.commercial_score
        });
      });
    });
    var c = job.compression || {};
    var actionRows = isFood ? restaurantActionRows(job, faqItems, org) : [
      { type: 'existing_page', count: c.existingPages || 0, note: '既存ページ改善' },
      { type: 'new_page', count: c.newPages || 0, note: '新規ページ候補' },
      { type: 'faq', count: c.faqCount || 0, note: 'FAQ追加' },
      { type: 'schema', count: c.schemaCount || 0, note: 'JSON-LD整備' },
      { type: 'internal_link', count: c.internalLinks || 0, note: '内部リンク' }
    ];

    var gscKeys = noGoogle ? 0 : Object.keys(gscMapFromStudio()).length;
    // FAQ の件数は先に数える（README・FAQ 本文・JSON-LD・MANIFEST を同じ数から作る）
    var siteN = faqItems.filter(function (f) { return f.status === 'site'; }).length;
    var schemaN = faqItems.filter(function (f) { return f.inSchema; }).length;
    var pendingN = cf ? faqItems.filter(function (f) { return f.status === 'site' && !f.approval; }).length : 0;
    var manifest = {
      generated_at: new Date().toISOString(),
      url: job.url,
      goal: job.goal,
      industry: job.industry || '',
      brand: brand,
      service: service,
      keyword_count: (job.keywords || []).length,
      evidence: {
        market_demand: isFood ? ((job.keywords || []).some(function (k) { return k.gsc_impressions > 0; }) ? 'GSC impressions only (no market volume)' : 'Unavailable (no search volume shown)')
          : ((job.keywords || []).some(function (k) { return k.volume_source === 'Official'; }) ? 'Official (partial, Keyword Planner)' : 'Unavailable (no search volume shown)'),
        acquisition_score: job.diagnose_source === 'Observed' ? 'Observed' : 'Estimated',
        gsc: noGoogle ? 'Not included (Google user data is not exported)' : (gscKeys ? 'Official (partial)' : 'Unavailable'),
        hack2: job.hack2_imported ? 'Observed (imported JSON)' : 'Unavailable',
        deployment: (job.deployment_run && job.deployment_run.pr_url) ? 'Draft PR awaiting human review' : 'ZIP only'
      },
      conclusion: job.conclusion || '',
      // FAQ の件数：提案した質問・サイトの記載から答えを作った質問・設置用 JSON-LD に入れた質問（0件なら faq.jsonld は出さない）
      faq_counts: { proposed: faqItems.length, from_site: siteN, needs_check: faqItems.length - siteN, approved: cf ? faqItems.filter(function (f) { return f.approval === 'approved'; }).length : null, pending_approval: pendingN, in_schema: schemaN },
      // 会社・ブランド・サービス・対象 URL を人が確定したか（確定するまでは公開用にしない）
      entity_confirmed: !!ent,
      entity: ent ? { company: company, brand: brand, service: service, url: ent.url || job.url, confirmed_at: ent.at } : null,
      // 版：確定・承認を変えるたびに増える。画面・CSV・ZIP の版が同じかをこの数で確かめる
      version: cf ? (cf.rev || 0) : null,
      faq_items: faqItems.map(function (f) { return { q: f.q, status: f.status, approval: f.approval || (f.status === 'site' && cf ? 'pending' : ''), in_schema: !!f.inSchema, source_url: (f.source && f.source.url) || '', fetched_at: job.completed_at || job.finished_at || '' }; }),
      compression: c
    };

    var agent = [
      '# AGENT_PROMPT — AirReach Tools Studio implementation draft',
      '',
      'You are helping implement AI-search readiness files for ' + brand + ' (' + job.url + ').',
      '',
      '## Hard rules',
      '- Do not invent prices, case studies, customers, rankings, or metrics.',
      '- JSON-LD must match visible page content.',
      '- Market demand volumes are empty unless a Keyword Planner CSV was applied (volume_source=Official). Do not invent volumes.',
      '- GSC impressions (if present) are Official and must stay in a separate column from market demand.',
      '- AirReach Consulting mention/citation rates (if present) are Observed and must not be mixed into acquisition score.',
      '- Human approval is required before production publish. Do not open a PR or deploy automatically.',
      '',
      '## Goal',
      job.goal || '',
      '',
      '## Conclusion',
      job.conclusion || '',
      '',
      '## Priority themes',
      (c.topThemes || []).map(function (t) { return '- ' + t; }).join('\n') || '- (none)',
      '',
      '## Files in this package',
      '- strategy/*.csv — keyword / prompt / action tables',
      '- schema/*.jsonld — Organization / Service / FAQ drafts',
      '- public/llms.txt — machine-readable site index draft',
      '- content/faq.md — FAQ draft',
      '- validation/VALIDATION.md — checklist before publish'
    ].join('\n');

    var readme = [
      '# サイトに足す文章とデータ（下書き）',
      '',
      '作成日：' + manifest.generated_at.slice(0, 10) + '　対象：' + brand + '（' + job.url + '）' + (cf ? '　版：' + (cf.rev || 0) : ''),
      '',
      ent ? '会社・ブランド・サービスは担当者が確定済みです（' + ent.at.slice(0, 10) + '）：' + company + (company !== brand ? '／' + brand : '') + '・' + service
        : '**会社・ブランド・サービスはまだ確定していません。** 名前やサービスはサイトから推定した値です。確定するまでは公開に使わないでください。',
      cf && pendingN ? 'サイトの記載から作った答えのうち ' + pendingN + ' 問は、まだ承認されていません（設置用のデータには入れていません）。' : null,
      '',
      'AirReach が作った**下書き**です。このファイルを開いただけでは、どこにも公開されません。',
      'お店・会社の方が内容を確かめ、ホームページを作った人（制作会社など）にサイトへ入れてもらいます。',
      '',
      '## 作業の手順',
      '',
      '1. **content/site-info.md を開く**：サイトから読めた情報（営業時間・電話・住所など）の一覧です。「確認が必要」の項目は、実際の内容を書き足してください。',
      '2. **content/faq.md を直す**：よくある質問の下書きです（' + faqItems.length + '問）。「' + CHECK + '」の答え（' + (faqItems.length - siteN) + '問）を書き、当てはまらない質問は消してください。' + (siteN ? 'サイトの記載から作った答え（' + siteN + '問）も、最新の内容か確かめてください。' : 'サイトの記載から作れた答えはありませんでした。'),
      '3. **よくある質問をサイトに載せる**：直した faq.md の質問と答えを、サイトの「よくある質問」のページに載せます（制作会社に依頼）。',
      '4. **検索や AI が読む形のデータを入れる**：schema フォルダのファイルを、制作会社に渡します。',
      '   - organization.jsonld：トップページに入れる、お店・会社の情報（電話・郵便番号はサイトに書かれていた値だけを入れています）',
      schemaN ? '   - faq.jsonld：よくある質問のページに入れる。' + (cf ? '**担当者が承認した答えだけ**' : '**サイトの記載から作った答えだけ**') + 'を入れています（' + schemaN + '問）。手順2で書き足した質問は、載せたあとに追加してください'
        : '   - faq.jsonld：**入れていません**（' + (cf && siteN ? '承認した答えが0問のため' : 'サイトの記載から作れた答えが0問のため') + '。空のデータは置かないでください）。手順2で答えを確かめて載せたあとに作ります',
      '   - service.jsonld：サービスの説明（飲食店はありません）',
      '5. **AI 向けの案内ファイルを置く**：public/llms.txt を、サイトの一番上の階層に llms.txt という名前で置きます（制作会社に依頼）。',
      '6. **公開前の確認**：validation/VALIDATION.md の項目を確かめます。',
      '',
      '## 守ること',
      '',
      '- 料金・実績・お客様の声・順位などを、推測で書き足さない',
      '- 検索や AI が読む形のデータ（schema）は、ページに実際に書いてある内容と同じにする',
      '',
      '## そのほかのファイル（担当者向け）',
      '',
      '- strategy/keywords.csv・prompts.csv・actions.csv：対策する言葉・AI に聞く質問・作業の一覧',
      '- MANIFEST.json・AGENT_PROMPT.md：作業の記録と、制作の手伝いをする AI への指示',
      '- public/llms-full.txt：llms.txt の詳しい版',
      '',
      '## 根拠の区分',
      '',
      '- 検索の多さ：' + manifest.evidence.market_demand,
      '- 集客の点数：' + manifest.evidence.acquisition_score,
      '- Search Console：' + manifest.evidence.gsc
    ].filter(function (l) { return l !== null; }).join('\n');

    var validationItems = (window.AirReachPackageSchema && window.AirReachPackageSchema.VALIDATION_ITEMS) || [
      '料金・事例・顧客名・数値の捏造がない',
      'FAQ回答を人間が事実確認した',
      'JSON-LDが公開文面と一致する',
      'llms.txtのリンクが解決する',
      'ステークホルダーが公開を承認した'
    ];
    var validation = [
      '# Validation checklist',
      '',
      'Studio does not auto-deploy. Complete every item before merge/publish.',
      ''
    ].concat(validationItems.map(function (item) { return '- [ ] ' + item; })).join('\n');

    var llms = [
      '# ' + brand,
      '',
      '> ' + (isFood ? ((kwa.keyword || service) + 'のお店') : (p.summary || service)),
      '',
      '## Primary',
      '- Home: ' + job.url,
      (isFood ? '- 業態: ' + service + (area.value ? '（' + area.value + '）' : '') : '- Service: ' + service),
      '',
      '## Notes',
      '- Draft generated by AirReach Tools Studio. Verify before publish.'
    ].join('\n');

    var faqMd = '# よくある質問（下書き）\n\n' +
      'サイトに書かれていたことから答えを作った質問が ' + siteN + ' 問、確認が必要な質問が ' + (faqItems.length - siteN) + ' 問あります。\n' +
      '「' + CHECK + '」の答えは、実際の内容を確かめて書き直してください。サイトの記載から作った答えも、最新の内容か確かめてから載せてください。\n\n' +
      faqItems.map(function (f, i) {
        var st = f.status !== 'site' ? '' : !cf ? '' : f.approval === 'approved' ? '承認済み' + (f.approvedAt ? '（' + f.approvedAt.slice(0, 10) + '）' : '') : f.approval === 'rejected' ? '使わない（却下）' : '承認待ち';
        return '## Q' + (i + 1) + '. ' + f.q + '\n\n' + f.a + '\n' +
          (f.status === 'site' && f.source ? '\n> 元にしたサイトの記載：「' + f.source.quote + '」' + (f.source.url ? '（' + f.source.url + '）' : '') + '\n' : '') +
          (st ? '\n状態：' + st + '\n' : '');
      }).join('\n');

    // 設置の手順（WordPress の1つに絞る。ほかの CMS は制作会社に README を渡す）
    var install = [
      '# WordPress に入れる手順',
      '',
      '対象：' + brand + '（' + job.url + '）' + (cf ? '　版：' + (cf.rev || 0) : ''),
      '',
      'WordPress のサイトに、この ZIP の中身を入れる手順です。ほかの仕組みのサイトは、README.md を制作会社に渡してください。',
      '作業の前に、WordPress のバックアップを取ってください。',
      '',
      '## 1. よくある質問のページ',
      '',
      '1. WordPress の管理画面に**管理者**でログインします（管理者でないと、手順2のデータが保存時に消えることがあります）。',
      '2. 固定ページ「よくある質問」を開きます（無ければ作ります）。',
      '3. content/faq.md の質問を見出し、答えを本文として載せます。' + (cf ? '**「状態：承認済み」の質問だけ**を載せ、「承認待ち」「使わない」は載せません。' : '「' + CHECK + '」の答えは、実際の内容に書き直してから載せます。'),
      '',
      '## 2. 検索や AI が読む形のデータ（構造化データ）',
      '',
      schemaN ? '1. 同じ「よくある質問」のページの一番下に「カスタム HTML」ブロックを足し、schema/faq.jsonld の中身を、1行目に `<script type="application/ld+json">`、最後の行に `</script>` を足して貼ります。'
        : '1. この ZIP に schema/faq.jsonld は入っていません（承認した答えが0問のため）。この手順は飛ばします。',
      '2. トップページにも同じ方法で schema/organization.jsonld を貼ります。**テーマや SEO のプラグインがすでに会社・お店の情報を出している場合は、二重にしない**でください（ページのソースを開き「Organization」や「LocalBusiness」で検索して確かめます）。',
      '3. 貼る内容は、ページに実際に書いてある内容と同じにします。ページに無い答えや情報は足しません。',
      '',
      '## 3. AI 向けの案内ファイル（llms.txt）',
      '',
      '1. public/llms.txt を、サーバーの公開フォルダの一番上（wp-config.php と同じ階層）に、llms.txt という名前で置きます（FTP やサーバーの管理画面から。わからなければ制作会社に依頼）。',
      '2. ブラウザで ' + String(job.url || '').replace(/\/+$/, '') + '/llms.txt を開き、中身が表示されることを確かめます。',
      '',
      '## 4. 確かめる',
      '',
      '1. Google の「リッチリザルト テスト」に、よくある質問のページの URL を入れ、エラーが0件であることを確かめます。',
      '2. ページの答えと、貼ったデータの答えが同じかを見比べます。',
      '3. MANIFEST.json の files に、この ZIP に入れたファイルと SHA-256 があります。届いた ZIP が作ったものと同じかは、この値で確かめられます。',
      '',
      '## 戻し方',
      '',
      '- 足した「カスタム HTML」ブロックを消し、ページを更新します。',
      '- サーバーに置いた llms.txt を消します。'
    ].join('\n');

    var files = {
      'README.md': readme,
      'INSTALL_WORDPRESS.md': install,
      'MANIFEST.json': JSON.stringify(manifest, null, 2),
      'AGENT_PROMPT.md': agent,
      'strategy/keywords.csv': toCsv(kwRows, (window.AirReachPackageSchema && window.AirReachPackageSchema.KEYWORD_CSV_COLUMNS) || ['priority', 'keyword', 'volume', 'volume_source', 'gsc_impressions', 'gsc_clicks', 'ai_mention_rate', 'ai_citation_rate', 'intent', 'cluster', 'gap', 'action', 'seed_source']),
      'strategy/prompts.csv': toCsv(promptRows, (window.AirReachPackageSchema && window.AirReachPackageSchema.PROMPT_CSV_COLUMNS) || ['keyword', 'prompt', 'intent', 'commercial_score']),
      'strategy/actions.csv': toCsv(actionRows, (window.AirReachPackageSchema && window.AirReachPackageSchema.ACTION_CSV_COLUMNS) || ['type', 'count', 'note']),
      'schema/organization.jsonld': JSON.stringify(org, null, 2),
      'schema/service.jsonld': svc ? JSON.stringify(svc, null, 2) : '',
      'schema/faq.jsonld': schemaN ? JSON.stringify(faqLd, null, 2) : '',
      'public/llms.txt': llms,
      'public/llms-full.txt': llms + '\n## FAQ\n' + faq.map(function (q) { return '- ' + q; }).join('\n') + '\n',
      'content/faq.md': faqMd,
      'content/site-info.md': siteInfoMd(job, brand),
      'content/schema-check.md': schemaCheckMd(job),
      'validation/VALIDATION.md': validation
    };
    if (isFood) {
      delete files['schema/service.jsonld'];
    }
    // 確定した FAQ が0件なら、空の FAQ の JSON-LD は出さない（設置用に空のデータを置かせない）
    if (!schemaN) delete files['schema/faq.jsonld'];
    if (window.AirReachPackageSchema && window.AirReachPackageSchema.validatePackageFiles) {
      var check = window.AirReachPackageSchema.validatePackageFiles(files, { targetUrl: job.url, industry: job.industry || '', faqCount: schemaN });
      if (!check.ok) {
        console.warn('[AirReachPackage] blueprint validation failed', check);
      }
      files._validation = check;
    }
    return files;
  }

  function crc32(buf) {
    var table = crc32._t;
    if (!table) {
      table = crc32._t = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
      }
    }
    var crc = 0 ^ (-1);
    for (var i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
    return (crc ^ (-1)) >>> 0;
  }
  function strToU8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0xD800 || c >= 0xE000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else {
        i++;
        var cp = 0x10000 + (((c & 0x3FF) << 10) | (s.charCodeAt(i) & 0x3FF));
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      }
    }
    return new Uint8Array(out);
  }
  function u32(n) { return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]; }
  function u16(n) { return [n & 255, (n >> 8) & 255]; }
  function buildZip(files) {
    var locals = [];
    var central = [];
    var offset = 0;
    Object.keys(files).forEach(function (name) {
      var data = strToU8(String(files[name] == null ? '' : files[name]));
      var nameU8 = strToU8(name);
      var crc = crc32(data);
      var local = [].concat(
        [0x50, 0x4b, 0x03, 0x04], u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(nameU8.length), u16(0)
      );
      var localArr = new Uint8Array(local.length + nameU8.length + data.length);
      localArr.set(local, 0);
      localArr.set(nameU8, local.length);
      localArr.set(data, local.length + nameU8.length);
      locals.push(localArr);
      var cen = [].concat(
        [0x50, 0x4b, 0x01, 0x02], u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(nameU8.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(offset)
      );
      var cenArr = new Uint8Array(cen.length + nameU8.length);
      cenArr.set(cen, 0);
      cenArr.set(nameU8, cen.length);
      central.push(cenArr);
      offset += localArr.length;
    });
    var centralSize = central.reduce(function (s, a) { return s + a.length; }, 0);
    var end = [].concat(
      [0x50, 0x4b, 0x05, 0x06], u16(0), u16(0), u16(locals.length), u16(locals.length),
      u32(centralSize), u32(offset), u16(0)
    );
    var parts = locals.concat(central).concat([new Uint8Array(end)]);
    var total = parts.reduce(function (s, a) { return s + a.length; }, 0);
    var out = new Uint8Array(total);
    var o = 0;
    parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  }
  /**
   * ZIP に入れる直前の仕上げ：選んだファイルだけにし、MANIFEST に形式・選び方・入れたファイルの大きさと SHA-256 を書く。
   *   paths を渡さなければ全部。README・MANIFEST・設置の手順は必ず入れる
   */
  function finalizePackage(files, paths) {
    var S = window.AirReachPackageSchema;
    var all = {};
    Object.keys(files || {}).forEach(function (k) { if (k !== '_validation') all[k] = files[k]; });
    var out = paths && S && S.selectFiles ? S.selectFiles(all, paths) : all;
    var partial = Object.keys(out).length < Object.keys(all).length;
    var names = Object.keys(out).filter(function (k) { return k !== 'MANIFEST.json'; }).sort();
    return Promise.all(names.map(function (k) { return S.sha256Hex(out[k]).then(function (h) { return { path: k, bytes: new TextEncoder().encode(String(out[k])).length, sha256: h }; }); }))
      .then(function (list) {
        var mf = {};
        try { mf = JSON.parse(out['MANIFEST.json'] || '{}'); } catch (e) {}
        mf.package_format = (S && S.PACKAGE_FORMAT) || 'airreach-package/2';
        mf.selection = partial ? 'partial' : 'all';
        mf.files = list;
        out['MANIFEST.json'] = JSON.stringify(mf, null, 2);
        return out;
      });
  }
  function downloadZip(filename, files, paths) {
    return finalizePackage(files, paths).then(function (clean) { saveZip(filename, clean); });
  }
  function saveZip(filename, clean) {
    if (window.AirReachPackageSchema && window.AirReachPackageSchema.validatePackageFiles) {
      var v = window.AirReachPackageSchema.validatePackageFiles(clean);
      if (!v.ok) {
        alert('パッケージ構造が設計図と一致しません: ' + (v.errors || v.missing || []).join('; '));
        return;
      }
      if (!v.publishable) {
        var warn = (v.warnings || []).concat((v.entityLock && v.entityLock.warnings) || []);
        var msg = '公開不可の警告があります（ドラフトZIPとして保存できます）:\n' +
          (warn.length ? warn.join('\n') : 'Entity Lock / 要確認') +
          '\n\nドラフトZIPをダウンロードしますか？';
        if (!confirm(msg)) return;
        filename = (filename || (window.AirReachPackageSchema && window.AirReachPackageSchema.ZIP_FILENAME) || 'airreach-implementation.zip')
          .replace(/\.zip$/i, '-DRAFT.zip');
      }
    }
    filename = filename || (window.AirReachPackageSchema && window.AirReachPackageSchema.ZIP_FILENAME) || 'airreach-implementation.zip';
    var data = buildZip(clean);
    var blob = new Blob([data], { type: 'application/zip' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  // 無料診断の「直す材料を作る」用：診断の結果から下書き一式を作り、確認のダイアログを出さずに -DRAFT.zip として保存する
  // （一般の方向け。公開前の確認はファイルの中の手順書で案内する）
  // 無料診断の「直す材料を作る」用：診断の結果から下書き一式を作る（画面に見せる・ZIP で渡す）
  function buildDraftFromDiagnose(opts) {
    var o = opts || {};
    var job = { url: o.url, industry: o.industry || 'other', profile: { brand: o.brand || hostOf(o.url), service: o.service || '' }, diagnose: o.diagnose || {}, keywords: o.keywords || [], goal: o.goal || '' };
    var files = buildPackageFiles(job);
    var clean = {};
    Object.keys(files || {}).forEach(function (k) { if (k !== '_validation') clean[k] = files[k]; });
    return clean;
  }
  // 下書き一式を、確認のダイアログを出さずに -DRAFT.zip として保存する（一般の方向け。公開前の確認は手順書で案内する）
  function downloadDraftZip(files, url) {
    var host = (hostOf(url) || 'site').replace(/[^a-z0-9.-]/gi, '');
    var data = buildZip(files);
    var blob = new Blob([data], { type: 'application/zip' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'airreach-' + host + '-DRAFT.zip';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }
  function downloadDraftFromDiagnose(opts) {
    var files = buildDraftFromDiagnose(opts);
    downloadDraftZip(files, (opts || {}).url);
    return files;
  }

  function persistJob(job) {
    try { localStorage.setItem(ORCH_KEY, JSON.stringify({ lastJob: job })); } catch (e) {}
    try {
      var st = JSON.parse(localStorage.getItem('airreach_studio_v1') || '{}');
      st.profile = job.profile;
      if (job.industry) st.industry = job.industry;
      st.keywords = (job.keywords || []).map(function (k) {
        return {
          id: k.id, text: k.keyword, intent: k.intent, cluster: k.cluster,
          priority: k.priority, targetUrl: '', status: '未対策', volume: k.volume, answered: k.answered === undefined ? null : k.answered,
          gsc_impressions: k.gsc_impressions, related_count: k.related_count || 0, related: k.related || [], why: k.why || '', action: k.action || '',
          // 出どころ（Search Console 由来の語は AI計測の質問に使わない。airreach-google-guard.js）
          seed_source: k.seed_source || '',
          brandScope: (job.profile && job.profile.brand) || '',
          serviceScope: (job.profile && job.profile.service) || ''
        };
      });
      // 分析は競合を調べない（job.competitors は常に空）。手で登録した競合を空で上書きしない
      if (job.competitors && job.competitors.length) st.competitors = job.competitors;
      else st.competitors = st.competitors || [];
      st.generated = {};
      Object.keys(job.files || {}).forEach(function (k) {
        if (k === '_validation') return;
        st.generated[k] = job.files[k];
      });
      localStorage.setItem('airreach_studio_v1', JSON.stringify(st));
      if (window.AirReachStudio && window.AirReachStudio.getState) {
        var live = window.AirReachStudio.getState();
        // 画面の欄も分析結果の名前・URLに更新する（欄が古いままだと、次の操作で空の欄が保存済みの名前を消していた）
        if (window.AirReachStudio.setProfile) window.AirReachStudio.setProfile(st.profile); else live.profile = st.profile;
        live.keywords = st.keywords;
        if (st.industry) live.industry = st.industry;
        if (job.competitors && job.competitors.length) live.competitors = job.competitors;
        else st.competitors = live.competitors || st.competitors;
        live.generated = st.generated;
        if (window.AirReachStudio.save) window.AirReachStudio.save();
      }
    } catch (e) {}
  }

  // opts.property: GSC のサイト URL（'sc-domain:example.com' / 'https://www.example.com/'）。
  // 指定が無ければ Studio の「GSCサイトURL」を使う。どちらも無ければ記録しない（診断結果の Google実測 には使わない）
  function importGscRows(rows, opts) {
    var mapped = [];
    var prop = (opts && opts.property != null) ? String(opts.property).trim()
      : ((window.AirReachStudio && window.AirReachStudio.gscPropertyInput) ? window.AirReachStudio.gscPropertyInput() : '');
    if (prop && window.AirReachKeywordList && !window.AirReachKeywordList.gscProperty(prop)) prop = '';
    (rows || []).forEach(function (r) {
      var kw = r.query || r.Query || r.keyword || r.Keyword || '';
      if (!String(kw).trim()) return;
      mapped.push({
        date: r.date || r.Date || '',
        keyword: String(kw).trim(),
        url: r.page || r.Page || r.url || r.URL || '',
        impressions: Number(r.impressions || r.Impressions) || 0,
        clicks: Number(r.clicks || r.Clicks) || 0,
        position: Number(r.position || r.Position) || 0,
        sessions: 0,
        keyEvents: 0
      });
      if (prop) mapped[mapped.length - 1].gscProperty = prop;
    });
    if (!mapped.length) throw new Error('クエリ列が見つかりません');
    mapped.gscProperty = prop;

    try {
      if (window.AirReachStudio && window.AirReachStudio.getState) {
        var st = window.AirReachStudio.getState();
        mapped.forEach(function (m) { st.measurements.push(m); });
        if (window.AirReachStudio.save) window.AirReachStudio.save();
        // 診断結果（キーワード比較）が読む端末の基準値にも反映する
        if (window.AirReachStudio.publishBaseline) window.AirReachStudio.publishBaseline();
      } else {
        var raw = JSON.parse(localStorage.getItem('airreach_studio_v1') || '{}');
        raw.measurements = (raw.measurements || []).concat(mapped);
        localStorage.setItem('airreach_studio_v1', JSON.stringify(raw));
      }
    } catch (e) {
      throw new Error('測定データの保存に失敗しました');
    }
    return mapped;
  }

  function reattachGscToJob(job) {
    if (!job || !job.keywords) return job;
    var gscMap = gscMapFromStudio();
    attachGsc(job.keywords, gscMap);
    // Also inject high-impression GSC queries missing from the list (up to limit)
    var limit = job.keyword_limit || job.keywords.length;
    var seen = {};
    job.keywords.forEach(function (k) { seen[normKw(k.keyword)] = 1; });
    Object.keys(gscMap).map(function (k) { return gscMap[k]; })
      .filter(function (g) { return g.impressions > 0 && !seen[normKw(g.keyword)]; })
      .sort(function (a, b) { return b.impressions - a.impressions; })
      .slice(0, Math.max(0, limit - job.keywords.length + 10))
      .forEach(function (g) {
        if (job.keywords.length >= limit) return;
        var nk = normKw(g.keyword);
        if (seen[nk]) return;
        seen[nk] = 1;
        job.keywords.push({
          id: uid(),
          keyword: g.keyword,
          volume: null,
          volume_source: 'Unavailable',
          gsc_impressions: Math.round(g.impressions),
          gsc_clicks: Math.round(g.clicks || 0),
          gsc_position: g.positionWeight ? Math.round((g.positionSum / g.positionWeight) * 10) / 10 : null,
          intent: /比較|おすすめ|費用|料金/.test(g.keyword) ? 'Commercial' : 'Informational',
          priority: g.impressions >= 200 ? 'P0' : 'P1',
          strength: g.impressions > 50 ? '普通' : '弱い',
          gap: g.impressions >= 200 ? '大' : '中',
          action: '',
          cluster: 'Core',
          seed_source: 'GSC',
          related_count: g.relatedCount || 0,
          related: g.related || [],
          prompts: promptsForKeyword({ keyword: g.keyword })
        });
        applyGscAction(job.keywords[job.keywords.length - 1], g);
        job.keywords[job.keywords.length - 1].why = whyForKeyword(job.keywords[job.keywords.length - 1]);
      });
    job.keywords.forEach(function (k) {
      if (!k.prompts || !k.prompts.length) {
        k.prompts = job.industry === 'restaurant' ? restaurantPrompts(k) : promptsForKeyword(k, job.industry);
        k.prompt_count = k.prompts.length;
      }
    });
    job.keywords.sort(function (a, b) {
      var pr = prioRank(a.priority) - prioRank(b.priority);
      if (pr) return pr;
      var gi = (b.gsc_impressions || 0) - (a.gsc_impressions || 0);
      if (gi) return gi;
      return (b.volume || 0) - (a.volume || 0);
    });
    job.keywords = job.keywords.slice(0, limit);
    job.totalDemand = sumDemand(job.keywords);
    job.compression = compressActions(job.keywords, job.diagnose);
    job.conclusion = buildConclusion(job);
    job.headline4 = {
      keywords: job.keywords.length,
      demand: job.totalDemand,
      score: (job.diagnose && job.diagnose.overall) || 0,
      implSites: job.compression.implSites
    };
    if (!job.confirm) job.confirm = { rev: 0, entity: null, faq: {} };
    job.files = buildPackageFiles(job);
    persistJob(job);
    return job;
  }

  async function runJob(input, onProgress) {
    var job = {
      id: uid(),
      status: 'running',
      url: input.url,
      goal: input.goal || '問い合わせを増やす',
      keyword_limit: Number(input.keyword_limit) || 100,
      region: input.region || '全国',
      profile: input.profile || {},
      started_at: new Date().toISOString(),
      steps: STEPS.map(function (s) { return { id: s.id, label: s.label, status: 'pending', pct: 0 }; })
    };

    function setStep(i, status, pct) {
      job.steps[i].status = status;
      job.steps[i].pct = pct == null ? (status === 'done' ? 100 : 0) : pct;
      if (onProgress) onProgress(job);
    }

    setStep(0, 'running', 10);
    var diagnose = null;
    var diagnoseSource = 'Estimated';
    try {
      if (window.AirReach && window.AirReach.diagnose) {
        diagnose = await window.AirReach.diagnose(job.url, {
          allowProxy: !!(input.proxyConsent || input.allowProxy)
        });
        if (diagnose) diagnoseSource = 'Observed';
      }
    } catch (e) {
      diagnose = null;
    }
    if (!diagnose) {
      // 取得できなかったときに仮の診断結果で続けない（以前は固定の42点などで最後まで進んでいた）
      throw new Error('サイトを取得できませんでした。「診断のための取得に同意」にチェックを入れて、もう一度お試しください。');
    }
    job.diagnose = diagnose;
    job.diagnose_source = diagnoseSource;
    job.industry = detectIndustry(input, diagnose);
    var kwa = (diagnose.page && diagnose.page.keywordAuto) || {};
    var isFood = job.industry === 'restaurant';
    job.profile = profileFromDiagnose(diagnose, job.url, {
      brand: (input.profile && input.profile.brand) || (isFood ? (kwa.shopName || '') : ''),
      // 飲食店のサービス名は業態（焼肉・そば など）。入力が無ければサイトから読んだ業態を使う
      service: (isFood && kwa.genre && kwa.genre.value && !(input.profile && input.profile.serviceTyped)) ? kwa.genre.value : ((input.profile && input.profile.service) || ''),
      audience: (input.profile && input.profile.audience) || '',
      summary: (input.profile && input.profile.summary) || ''
    });
    if (isFood && kwa.area && kwa.area.value) job.region = kwa.area.value;
    if (q('orch-service') && job.profile.service && !q('orch-service').value) {
      q('orch-service').value = job.profile.service;
    }
    setStep(0, 'done', 100);
    await sleep(280);

    setStep(1, 'running', 40);
    var gaps = (diagnose.gaps || []).slice(0, 2);
    // 実在の競合を調べる仕組みが無いので、架空の競合（competitor-a.example など）は出さない
    job.competitors = [];
    setStep(1, 'done', 100);
    await sleep(220);

    setStep(2, 'running', 50);
    var gscMap = gscMapFromStudio();
    job.gsc_query_count = Object.keys(gscMap).length;
    setStep(2, 'done', 100);
    await sleep(200);

    setStep(3, 'running', 20);
    var keywords = isFood ? buildRestaurantKeywords(diagnose, job.keyword_limit, gscMap, (input.profile && input.profile.brand) || '') : buildKeywords(job.profile.service, job.region, job.keyword_limit, gscMap, {
      industry: job.industry,
      topics: (diagnose && diagnose.page && diagnose.page.topics) || [],
      brand: job.profile.brand,
      url: job.url || job.profile.url
    });
    if (keywords._skippedForeign) {
      job.keyword_skip_note = '他社ブランド語を ' + keywords._skippedForeign + ' 件除外しました';
    }
    for (var ki = 0; ki < keywords.length; ki++) {
      if (ki % 10 === 0) {
        setStep(3, 'running', Math.round((ki / keywords.length) * 100));
        await sleep(40);
      }
    }
    job.keywords = keywords;
    job.totalDemand = sumDemand(keywords);
    setStep(3, 'done', 100);
    await sleep(180);

    setStep(4, 'running', 30);
    keywords.forEach(function (k) { k.prompts = isFood ? restaurantPrompts(k) : promptsForKeyword(k, job.industry); k.prompt_count = k.prompts.length; });
    setStep(4, 'done', 100);
    await sleep(180);

    setStep(5, 'running', 40);
    job.compression = compressActions(keywords, diagnose);
    job.conclusion = buildConclusion(job);
    job.headline4 = {
      keywords: keywords.length,
      demand: job.totalDemand,
      score: diagnose.overall,
      implSites: job.compression.implSites
    };
    setStep(5, 'done', 100);
    await sleep(180);

    setStep(6, 'running', 50);
    if (!job.confirm) job.confirm = { rev: 0, entity: null, faq: {} };
    job.files = buildPackageFiles(job);
    job.status = 'completed';
    job.completed_at = new Date().toISOString();
    setStep(6, 'done', 100);

    persistJob(job);
    if (onProgress) onProgress(job);
    return job;
  }

  function q(id) { return document.getElementById(id); }

  function renderProgress(job) {
    var el = q('orch-progress');
    if (!el || !job) return;
    el.innerHTML = job.steps.map(function (s) {
      var mark = s.status === 'done' ? '✓' : (s.status === 'running' ? (s.pct + '%') : '…');
      var cls = s.status === 'done' ? 'is-done' : (s.status === 'running' ? 'is-run' : '');
      return '<div class="orch-step ' + cls + '"><span class="orch-step-label">' + esc(s.label) + '</span><span class="orch-step-mark">' + mark + '</span></div>';
    }).join('');
  }

  function filteredKeywords(job) {
    var list = (job && job.keywords) || [];
    if (uiState.filter === 'P0' || uiState.filter === 'P1' || uiState.filter === 'P2') {
      return list.filter(function (k) { return k.priority === uiState.filter; });
    }
    if (uiState.filter === 'gsc') {
      return list.filter(function (k) { return k.gsc_impressions != null && k.gsc_impressions > 0; });
    }
    return list;
  }

  function renderKwTable(job) {
    var body = q('orch-kw-body');
    if (!body || !job) return;
    var list = filteredKeywords(job);
    var shown = list.slice(0, uiState.shown);
    // 同じページを対象にする語の数（まとめて直せる）
    var pageCount = {};
    (job.keywords || []).forEach(function (k) { if (k.gsc_page) pageCount[k.gsc_page] = (pageCount[k.gsc_page] || 0) + 1; });
    body.innerHTML = shown.map(function (k) {
      var why = k.why || whyForKeyword(k);
      var meta = [];
      if (k.seed_source === 'GSC') meta.push('GSC');
      if (k.seed_source === 'KeywordPlanner') meta.push('Keyword Planner');
      // 月間検索数は Keyword Planner の値だけ表示する（それ以外の volume は出さない）
      if (k.volume_source === 'Official' && k.volume != null && isFinite(Number(k.volume))) meta.push('月間検索数 ' + Number(k.volume).toLocaleString('ja-JP') + '（Keyword Planner）');
      if (k.ai_mention_rate != null) meta.push('AI言及 ' + k.ai_mention_rate + '%');
      var metaHtml = meta.length ? ('<div class="orch-kw-meta">' + meta.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('') + '</div>') : '';
      var hasGsc = k.gsc_impressions != null && k.gsc_impressions > 0;
      var same = k.gsc_page ? (pageCount[k.gsc_page] || 1) - 1 : 0;
      var pageHtml = k.gsc_page ? '<a class="orch-kw-page" href="' + esc(k.gsc_page) + '" target="_blank" rel="noopener noreferrer">' + esc(pathOf(k.gsc_page)) + ' ↗</a>' +
        (same > 0 ? '<span class="orch-kw-same">同じページで他 ' + same + ' 語</span>' : '') : '';
      var whyHtml = hasGsc
        ? '<div class="orch-kw-facts">' + gscFacts(k).map(function (f) { return '<span>' + esc(f) + '</span>'; }).join('') + '</div><div class="orch-kw-src">Search Console（実測）</div>'
        : esc(why);
      var actTitle = k.action && k.action !== 'ページ改善' ? k.action : '';
      var actHtml = actTitle
        ? '<strong>' + esc(actTitle) + '</strong>' + (k.action_detail ? '<p>' + esc(k.action_detail) + '</p>' : '')
        : '<span class="orch-kw-muted">Search Console を取り込むと、対象ページと直し方を出します</span>';
      return '<tr class="orch-kw-row">' +
        '<td data-label="優先"><span class="orch-prio orch-prio-' + esc(k.priority || 'P2') + '">' + esc(prioLabel(k.priority)) + '</span></td>' +
        '<td data-label="対策キーワード"><div class="orch-kw-main"><strong>' + esc(k.keyword) + '</strong>' + pageHtml + metaHtml + '</div></td>' +
        '<td data-label="根拠" class="orch-kw-why">' + whyHtml + '</td>' +
        '<td data-label="やること" class="orch-kw-act">' + actHtml + '</td>' +
        '</tr>';
    }).join('');

    var more = q('orch-kw-more');
    if (more) {
      more.hidden = list.length <= uiState.shown;
      more.textContent = 'さらに表示（残り ' + Math.max(0, list.length - uiState.shown) + '）';
    }
    var count = q('orch-kw-count');
    if (count) {
      count.hidden = false;
      var skip = job.keyword_skip_note ? ' · ' + job.keyword_skip_note : '';
      count.textContent = '表示 ' + shown.length + ' / 該当 ' + list.length + '（全 ' + ((job.keywords || []).length) + '）' + skip;
    }
    if (window.AirReachTip) window.AirReachTip.enhance(body.parentElement || body);
  }

  function renderResult(job) {
    var wrap = q('orch-result');
    if (!wrap || !job || job.status !== 'completed') return;
    wrap.hidden = false;
    try { if (window.AirReachConfirm) window.AirReachConfirm.render(job); } catch (e) {}
    renderDashboardButton(job);
    var h = job.headline4 || {};
    if (q('orch-n-kw')) q('orch-n-kw').textContent = String(h.keywords || 0);
    // ② 探している人: 月間検索数は Keyword Planner の値（volume_source=Official）だけを合計する。
    // 値が無ければ「未計測」。Search Console の表示回数・文字列からの推定は含めない
    if (q('orch-n-demand')) {
      var demandEl = q('orch-n-demand');
      var dUnit = demandEl.parentElement && demandEl.parentElement.querySelector('.unit');
      var allKw = job.keywords || [];
      var plannerKw = allKw.filter(function (k) { return k.volume_source === 'Official' && k.volume != null && k.volume !== '' && isFinite(Number(k.volume)); });
      if (!plannerKw.length) {
        demandEl.textContent = '—';
        if (dUnit) dUnit.textContent = '（任意）Google 広告の Keyword Planner のファイルを「Google とつなぐ」で取り込むと、月間の検索回数が出ます';
      } else {
        var plannerTotal = plannerKw.reduce(function (s2, k) { return s2 + Number(k.volume); }, 0);
        demandEl.textContent = plannerTotal.toLocaleString('ja-JP');
        if (dUnit) {
          dUnit.innerHTML = '回/月 · 月間検索数 <span class="orch-badge-off" data-tip="Google 広告 Keyword Planner の月間検索数">Keyword Planner</span>' +
            (plannerKw.length < allKw.length ? ' <span class="orch-demand-part">（' + plannerKw.length + ' / ' + allKw.length + ' 語の合計）</span>' : '');
        }
      }
    }
    if (q('orch-n-score')) {
      var scoreLabel = String(h.score || 0);
      q('orch-n-score').textContent = scoreLabel;
      var unit = q('orch-n-score').parentElement && q('orch-n-score').parentElement.querySelector('.unit');
      if (unit) {
        unit.innerHTML = '/ 100' + (job.diagnose_source === 'Estimated'
          ? ' <span class="orch-badge-est" data-tip="ページ取得できなかったため推定です">推定</span>' : '');
      }
    }
    if (q('orch-n-impl')) q('orch-n-impl').textContent = String(h.implSites || 0);
    if (q('orch-conclusion')) q('orch-conclusion').textContent = job.conclusion || '';

    var c = job.compression || {};
    if (q('orch-compress')) {
      q('orch-compress').innerHTML =
        '<div class="orch-compress-grid">' +
        '<div><b>' + (c.existingPages || 0) + '</b><span>今あるページを直す</span></div>' +
        '<div><b>' + (c.newPages || 0) + '</b><span>新しく作るページ</span></div>' +
        '<div><b>' + (c.faqCount || 0) + '</b><span>よくある質問</span></div>' +
        '<div><b>' + (c.schemaCount || 0) + '</b><span data-tip="検索やAIが読み取れる形でお店・会社の情報を埋め込む作業">構造化データ</span></div>' +
        '<div><b>' + (c.internalLinks || 0) + '</b><span>ページどうしのリンク</span></div>' +
        '</div><p class="orch-impl-summary">キーワードごとに数えた延べ数です。同じページでまとめて直せるものをまとめると、実際に手を入れるのは <b>' + (c.implSites || 0) + ' 箇所</b>です。</p>';
    }

    var hasGsc = (job.keywords || []).some(function (k) { return k.gsc_impressions != null && k.gsc_impressions > 0; });
    var gscNote = q('orch-gsc-note');
    if (gscNote) {
      gscNote.textContent = hasGsc
        ? 'GSC の表示回数（Impressions）がある行だけ Google 実測を別列で表示しています。表示回数は検索回数ではありません。月間検索数は Keyword Planner の取り込み時だけ表示します。'
        : '検索回数は出していません。左のメニューの「Google とつなぐ」で Search Console を取り込むと、Google 実測の表示回数・クリックが別列で付きます（表示回数は検索回数ではありません）。';
      gscNote.hidden = false;
    }

    uiState.shown = Math.min(uiState.shown, 40);
    if (uiState.shown < 40) uiState.shown = 40;
    renderKwTable(job);
    if (window.AirReachTip) window.AirReachTip.enhance(wrap);
  }

  function mapGoal(raw) {
    raw = String(raw || '');
    if (raw === 'visibility' || /見え方|認知|ブランド/.test(raw)) return '見え方を整える';
    if (raw === 'booking' || /予約/.test(raw)) return '予約を増やす';
    if (raw === 'acquisition' || /問い合わせ|集客|acquisition/.test(raw)) return '問い合わせを増やす';
    return raw || '問い合わせを増やす';
  }

  var prefillIndustry = '';
  var prefillIndustryHost = '';

  // ---- ダッシュボードとの受け渡し -------------------------------------------------
  var STUDIO_CLIENT_KEY = 'airreach_studio_client_v1';
  var STUDIO_ACTIONS_KEY = 'airreach_studio_actions_v1';
  var studioClient = null;
  function renderClientBanner() {
    var launch = document.querySelector('.ars-orch-launch');
    if (!launch || !studioClient) return;
    var el = q('orch-client-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'orch-client-banner';
      el.className = 'ars-note';
      el.style.marginBottom = '12px';
      launch.parentNode.insertBefore(el, launch);
    }
    el.innerHTML = 'ダッシュボードの顧客「<strong>' + escHtml(studioClient.name || '（名前なし）') + '</strong>」の作業として開いています。' +
      'この顧客の分析・キーワード・AI計測・下書きは、ダッシュボードにログインしていれば社内で共有されます（共有の状態は上に表示）。下書きを作ったあと「ダッシュボードに施策として登録」で、施策の予定として登録できます。 ' +
      '<a href="/airreach/app/#/c/' + studioClient.id + '">ダッシュボードに戻る</a>' +
      ' · <button type="button" class="ars-btn ars-btn-secondary" id="orch-client-clear" style="padding:2px 10px;font-size:12px">この顧客の作業をやめる</button>';
    var clr = q('orch-client-clear');
    // 顧客の作業をやめる＝顧客なしの作業場所に切り替えて開き直す（airreach-studio-clients.js が入れ替える）
    if (clr) clr.onclick = function () { try { sessionStorage.removeItem(STUDIO_CLIENT_KEY); } catch (e) {} location.href = '/airreach/studio/?client=none'; };
  }
  function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  /** 下書きのファイルから、ダッシュボードの「施策（予定）」の候補を作る */
  function actionItemsFromFiles(job) {
    var f = (job && job.files) || {}, food = job && job.industry === 'restaurant', out = [];
    // 施策の名前はお客様の画面とレポートにも出るので、専門用語を使わない（正式なファイル名は file に残す）
    if (f['schema/organization.jsonld']) out.push({ file: 'schema/organization.jsonld', title: food ? 'お店の基本情報（店名・住所・電話番号・営業時間など）を、検索やAIが読み取れる形でサイトに埋め込む' : '会社の基本情報を、検索やAIが読み取れる形でサイトに埋め込む' });
    if (f['schema/service.jsonld']) out.push({ file: 'schema/service.jsonld', title: '提供しているサービスの内容を、検索やAIが読み取れる形でサイトに埋め込む' });
    if (f['content/site-info.md'] && /確認が必要/.test(f['content/site-info.md'])) out.push({ file: 'content/site-info.md', title: food ? '店舗情報（営業時間・予約・駐車場など）を公式ページに書き足す' : '会社の基本情報（電話・住所・営業時間など）を公式ページに書き足す' });
    if (f['content/faq.md'] || f['schema/faq.jsonld']) out.push({ file: 'content/faq.md・schema/faq.jsonld', title: 'よくある質問をページに追加し、検索やAIが読み取れる形でも埋め込む' });
    if (f['public/llms.txt']) out.push({ file: 'public/llms.txt', title: 'AI向けのサイト案内ファイルを置く' });
    return out;
  }
  function renderDashboardButton(job) {
    var b = q('orch-to-dashboard');
    if (!b) return;
    var ok = !!(studioClient && job && job.files);
    // 別のサイトの下書きを誤って登録しないよう、顧客から開いたときのURLと同じサイトのときだけ出す
    if (ok && studioClient.url && job.url && hostOf(studioClient.url) !== hostOf(job.url)) ok = false;
    b.hidden = !ok;
    if (!ok) return;
    b.onclick = function () {
      var items = actionItemsFromFiles(job);
      try {
        sessionStorage.setItem(STUDIO_ACTIONS_KEY, JSON.stringify({ clientId: studioClient.id, clientName: studioClient.name, url: job.url, createdAt: new Date().toISOString(), items: items }));
      } catch (e) {}
      location.href = '/airreach/app/#/c/' + studioClient.id;
    };
  }
  function outcomeToGoal(o) {
    if (o === 'reservation' || o === 'visit') return '予約を増やす';
    if (o === 'awareness' || o === 'citation') return '見え方を整える';
    return o ? '問い合わせを増やす' : '';
  }

  // ---- Studio の分析を「診断の履歴」にも残す（無料診断と同じ保存先。月次レポートの点数に使われる）-------------
  // 無料診断と別々だと、Studio で分析しても月次レポートに出なかった。分析1回につき1回だけ保存する
  function scanId() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 16); } catch (e) {}
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function scanNote(text, kind) {
    var res = q('orch-result');
    if (!res) return;
    var el = q('orch-scan-saved');
    if (!el) { el = document.createElement('p'); el.id = 'orch-scan-saved'; el.className = 'ars-note'; res.insertBefore(el, res.firstChild); }
    el.className = 'ars-note' + (kind ? ' ' + kind : '');
    el.textContent = text;
  }
  // 顧客を選んで分析したときは、分析したサイトを顧客のサイトとして登録する（登録が無いと、ダッシュボードにこの診断が出ない）
  function linkScanToClient(url) {
    var SC = window.AirReachStudioClients;
    if (!SC || !SC.ensureSite || !SC.current()) return;
    SC.ensureSite(url).then(function (r) {
      var name = SC.current().name || 'この顧客';
      if (r.state === 'added') scanNote('この分析を保存し、' + r.host + ' を「' + name + '」のサイトとして登録しました。ダッシュボードのホームと「これまでの診断」に出ます。', 'good');
      else if (r.state === 'nologin') scanNote('この分析は保存しましたが、ログインしていないため「' + name + '」には紐づいていません。ダッシュボードにログインしてから、もう一度分析してください。', 'warn');
      else if (r.state === 'other') {
        scanNote('この分析は保存しましたが、' + r.host + ' は「' + name + '」に登録されたサイト（' + r.hosts.join('・') + '）と違うため、ダッシュボードには出ません。', 'warn');
        var el = q('orch-scan-saved');
        if (el) {
          var b = document.createElement('button'); b.type = 'button'; b.className = 'ars-btn ars-btn-secondary'; b.style.marginLeft = '8px'; b.textContent = r.host + ' もこの顧客のサイトにする';
          b.onclick = function () { b.disabled = true; r.add().then(function () { scanNote('この分析を保存し、' + r.host + ' を「' + name + '」のサイトに加えました。ダッシュボードに出ます。', 'good'); }, function () { b.disabled = false; scanNote('サイトを登録できませんでした。ダッシュボードの「これまでの診断」から追加してください。', 'warn'); }); };
          el.appendChild(b);
        }
      }
    }).catch(function () { scanNote('この分析は保存しましたが、顧客のサイトの確認に失敗しました。ダッシュボードの「これまでの診断」でサイトが登録されているか確かめてください。', 'warn'); });
  }
  function saveScanFromJob(job, goal) {
    if (!job || !job.diagnose || !job.diagnose.checks || job._scanSaved) return;
    job._scanSaved = true;
    var p = job.profile || {};
    var body = {
      scan: {
        // 保存の API は goal を acquisition / visibility、成果の種類を outcomeGoal（英小文字）で受ける
        id: scanId(), url: job.url, industryId: job.industry || 'other', goal: goal === '見え方を整える' ? 'visibility' : 'acquisition',
        outcomeGoal: goal === '予約を増やす' ? 'reservation' : (goal === '見え方を整える' ? 'awareness' : 'inquiry'),
        keyword: (job.keywords && job.keywords[0] && job.keywords[0].keyword) || null,
        siteTitle: (job.diagnose.page && job.diagnose.page.title) || null, displayName: p.brand || null,
        source: 'expert', savedAt: new Date().toISOString()
      },
      result: job.diagnose
    };
    fetch('/api/airreach/scans/', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 201) {
          scanNote('この分析は「診断の履歴」に保存しました（' + (job.diagnose.overall != null ? job.diagnose.overall + '点・' : '') + '月次レポートの点数に使われます）。', 'good');
          linkScanToClient(job.url);
        } else {
          scanNote('分析は終わりましたが、「診断の履歴」への保存に失敗しました（' + r.status + '）。月次レポートに使うには、もう一度分析してください。', 'warn');
          job._scanSaved = false;
        }
      })
      .catch(function () { job._scanSaved = false; scanNote('分析は終わりましたが、通信の問題で「診断の履歴」に保存できませんでした。もう一度分析してください。', 'warn'); });
  }

  function prefillLaunch() {
    var url = '';
    var service = '';
    var goal = '';
    var region = '';
    try {
      var params = new URLSearchParams(location.search);
      url = params.get('url') || params.get('site') || '';
      service = params.get('service') || params.get('keyword') || '';
      var goalParam = params.get('goal') || params.get('mode') || '';
      goal = goalParam ? mapGoal(goalParam) : '';
      region = params.get('region') || '';
      // ダッシュボードの顧客から開いたとき（airreach-console.js の studioHref）
      var cid = params.get('client') || '';
      if (/^[0-9a-f-]{36}$/.test(cid)) {
        studioClient = { id: cid, name: params.get('client_name') || '', url: url };
        try { sessionStorage.setItem(STUDIO_CLIENT_KEY, JSON.stringify(studioClient)); } catch (e2) {}
        var ind = params.get('industry') || '';
        if (ind === 'restaurant' && url) { prefillIndustry = 'restaurant'; prefillIndustryHost = hostOf(url); }
      }
      // 業種の指定（顧客を選ばずに開いたときも使う）
      var ind0 = params.get('industry') || '';
      if (ind0 === 'restaurant' && url && !prefillIndustry) { prefillIndustry = 'restaurant'; prefillIndustryHost = hostOf(url); }
    } catch (e) {}
    if (!studioClient) {
      try { studioClient = JSON.parse(sessionStorage.getItem(STUDIO_CLIENT_KEY) || 'null'); } catch (e) { studioClient = null; }
    }
    renderClientBanner();

    try {
      var survey = JSON.parse(localStorage.getItem('airreach_onboard_survey_v1') || 'null');
      if (survey) {
        // 無料診断の入力はブラウザに1つだけ残る。顧客を開いたときは、同じサイトの診断のときだけ使う（別のサイトの言葉を混ぜない）
        var sameSite = !studioClient || !!(url && survey.url && hostOf(survey.url) === hostOf(url));
        if (!url && survey.url && !studioClient) url = survey.url;
        if (sameSite && survey.industryId === 'restaurant') { prefillIndustry = 'restaurant'; prefillIndustryHost = hostOf(survey.url || ''); }
        // 飲食店の「調べる言葉」は地域＋業態なので、サービス名には使わない（業態は下の handoff から入れる）
        if (sameSite && !service && survey.keyword && prefillIndustry !== 'restaurant') service = validService(survey.keyword);
        if (!goal && survey.outcomeGoal) goal = outcomeToGoal(survey.outcomeGoal);
        if (!goal && survey.goal) goal = mapGoal(survey.goal);
      }
    } catch (e) {}

    try {
      var handoff = JSON.parse(localStorage.getItem('airreach_diagnose_handoff_v1') || 'null');
      if (handoff && studioClient && (!url || !handoff.url || hostOf(handoff.url) !== hostOf(url))) handoff = null; // 顧客の作業では、同じサイトの診断だけ使う
      if (handoff && !url && handoff.url) url = handoff.url;
      if (handoff && handoff.keywordAuto && handoff.keywordAuto.genre && (prefillIndustry === 'restaurant' || !service)) {
        if (!service || prefillIndustry === 'restaurant') service = handoff.keywordAuto.genre;
      }
    } catch (e) {}

    try {
      var st = JSON.parse(localStorage.getItem('airreach_studio_v1') || '{}');
      if (st.profile) {
        if (!url && st.profile.url) url = st.profile.url;
        if (!service && st.profile.service) service = validService(st.profile.service);
      }
    } catch (e) {}

    // ダッシュボードの顧客から開いたときは、前回の入力より顧客のURLを優先する
    var forceClientUrl = !!(studioClient && studioClient.url && url === studioClient.url);
    if (url && q('orch-url') && (forceClientUrl || !q('orch-url').value)) q('orch-url').value = url;
    if (service && q('orch-service') && !q('orch-service').value) q('orch-service').value = service;
    // 飲食店なら目標の初期値は「予約を増やす」（問い合わせではない）
    if (!goal && prefillIndustry === 'restaurant') goal = '予約を増やす';
    if (goal && q('orch-goal')) {
      var opts = q('orch-goal').options || [];
      for (var gi = 0; gi < opts.length; gi++) {
        if (opts[gi].value === goal) { q('orch-goal').value = goal; break; }
      }
    }
    if (region && q('orch-region')) {
      var ropts = q('orch-region').options || [];
      for (var ri = 0; ri < ropts.length; ri++) {
        if (ropts[ri].value === region) { q('orch-region').value = region; break; }
      }
    }
  }

  function restoreLastJob() {
    try {
      var raw = localStorage.getItem(ORCH_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      var job = data && data.lastJob;
      if (!job || job.status !== 'completed') return;
      // 顧客の作業として開いているときは、別のサイトの前回結果を出さない
      if (studioClient && studioClient.url && hostOf(job.url || '') !== hostOf(studioClient.url)) return;
      // 保存済みの結果にも、いまの Search Console の実績（対象ページ・直し方）を付け直す
      try { job = reattachGscToJob(job); } catch (e2) {}
      window.__orchLastJob = job;
      if (q('orch-progress-wrap')) q('orch-progress-wrap').hidden = true;
      renderResult(job);
    } catch (e) {}
  }

  function setGscStatus(msg, ok) {
    var el = q('orch-gsc-status');
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || '';
    el.className = 'orch-gsc-status' + (ok ? ' is-ok' : (msg ? ' is-warn' : ''));
  }

  function bindOverview() {
    var runBtn = q('orch-run');
    if (!runBtn) return;

    prefillLaunch();
    restoreLastJob();

    var expertToggle = q('orch-expert-toggle');
    var expert = q('orch-expert');
    if (expertToggle && expert) {
      expertToggle.addEventListener('click', function () {
        var open = expert.hidden;
        expert.hidden = !open;
        expertToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        expertToggle.textContent = open ? 'Expert Viewを閉じる' : 'Expert View';
      });
    }

    document.querySelectorAll('[name="orch-kw-count"]').forEach(function (r) {
      r.addEventListener('change', function () {
        document.querySelectorAll('.orch-kw-pill').forEach(function (p) { p.classList.remove('is-on'); });
        if (r.checked && r.parentElement) r.parentElement.classList.add('is-on');
      });
    });

    document.querySelectorAll('[data-orch-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        uiState.filter = btn.getAttribute('data-orch-filter') || 'all';
        uiState.shown = 40;
        document.querySelectorAll('[data-orch-filter]').forEach(function (b) { b.classList.remove('is-on'); });
        btn.classList.add('is-on');
        if (window.__orchLastJob) renderKwTable(window.__orchLastJob);
      });
    });

    var moreBtn = q('orch-kw-more');
    if (moreBtn) {
      moreBtn.addEventListener('click', function () {
        uiState.shown += 40;
        if (window.__orchLastJob) renderKwTable(window.__orchLastJob);
      });
    }

    var csvBtn = q('orch-kw-csv');
    if (csvBtn) {
      csvBtn.addEventListener('click', function () {
        var job = window.__orchLastJob;
        if (!job || !job.keywords) {
          alert('先に分析を完了してください');
          return;
        }
        var cols = (window.AirReachPackageSchema && window.AirReachPackageSchema.KEYWORD_CSV_COLUMNS) || [
          'priority', 'keyword', 'volume', 'volume_source', 'gsc_impressions', 'gsc_clicks',
          'ai_mention_rate', 'ai_citation_rate', 'intent', 'cluster', 'gap', 'action', 'seed_source'
        ];
        var rows = filteredKeywords(job).map(function (k) {
          return {
            priority: k.priority,
            keyword: k.keyword,
            volume: k.volume,
            volume_source: k.volume_source,
            gsc_impressions: k.gsc_impressions == null ? '' : k.gsc_impressions,
            gsc_clicks: k.gsc_clicks == null ? '' : k.gsc_clicks,
            ai_mention_rate: k.ai_mention_rate == null ? '' : k.ai_mention_rate,
            ai_citation_rate: k.ai_citation_rate == null ? '' : k.ai_citation_rate,
            intent: k.intent,
            cluster: k.cluster,
            gap: k.gap,
            action: k.action,
            seed_source: k.seed_source || ''
          };
        });
        downloadText('airreach-keywords.csv', toCsv(rows, cols), 'text/csv;charset=utf-8');
      });
    }

    var gscInput = q('orch-gsc-csv');
    if (gscInput) {
      gscInput.addEventListener('change', function () {
        var f = gscInput.files && gscInput.files[0];
        if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          try {
            var rows = parseCsv(rd.result);
            var mapped = importGscRows(rows);
            setGscStatus('GSC取込完了: ' + mapped.length + ' 行（実測）。分析済みなら表へ反映します。' +
              (mapped.gscProperty ? '' : ' GSCサイトURLが未設定のため、無料診断の「Google実測」には使いません。'), true);
            if (window.__orchLastJob && window.__orchLastJob.status === 'completed') {
              window.__orchLastJob = reattachGscToJob(window.__orchLastJob);
              renderResult(window.__orchLastJob);
            }
          } catch (e) {
            setGscStatus('CSVを読み込めませんでした: ' + (e && e.message ? e.message : e), false);
          }
        };
        rd.readAsText(f, 'utf-8');
      });
    }

    runBtn.addEventListener('click', async function () {
      var url = (q('orch-url') && q('orch-url').value || '').trim();
      if (!url) {
        alert('対象サイトのURLを入力してください');
        return;
      }
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      var limitEl = document.querySelector('[name="orch-kw-count"]:checked');
      var limit = limitEl ? Number(limitEl.value) : 100;
      var goal = (q('orch-goal') && q('orch-goal').value) || '問い合わせを増やす';
      var region = (q('orch-region') && q('orch-region').value) || '全国';
      var service = (q('orch-service') && q('orch-service').value || '').trim();
      // 1文字など短すぎるサービス名（入力の途中など）は使わず、サイトのタイトルから推定する
      if (service && !validService(service)) { service = ''; if (q('orch-service')) q('orch-service').value = ''; }

      if (q('orch-proxy') && !q('orch-proxy').checked) {
        alert('「診断のための取得に同意」にチェックを入れてから分析してください。サイトを取得できないと分析できません。');
        return;
      }
      q('orch-progress-wrap').hidden = false;
      q('orch-result').hidden = true;
      runBtn.disabled = true;
      runBtn.textContent = '分析中…';
      uiState.filter = 'all';
      uiState.shown = 40;
      document.querySelectorAll('[data-orch-filter]').forEach(function (b) {
        b.classList.toggle('is-on', b.getAttribute('data-orch-filter') === 'all');
      });

      try {
        var job = await runJob({
          url: url,
          goal: goal,
          keyword_limit: limit,
          region: region,
          profile: {
            url: url,
            brand: ((q('orch-brand') && q('orch-brand').value.trim()) || (q('brand-name') && q('brand-name').value) || ''),
            service: service || validService(q('service-name') && q('service-name').value) || '',
            summary: (q('service-summary') && q('service-summary').value) || ''
          },
          proxyConsent: !!(q('orch-proxy') && q('orch-proxy').checked),
          // 無料診断で選んだ業種は、同じサイトを分析するときだけ使う
          industry: (prefillIndustry && prefillIndustryHost && hostOf(url) === prefillIndustryHost) ? prefillIndustry : ''
        }, function (j) { renderProgress(j); });
        renderResult(job);
        window.__orchLastJob = job;
        saveScanFromJob(job, goal);
        // 終わった進み具合の一覧は残さない（結果の邪魔になる）
        setTimeout(function () { if (q('orch-progress-wrap')) q('orch-progress-wrap').hidden = true; }, 1200);
      } catch (e) {
        alert('分析に失敗しました: ' + (e && e.message ? e.message : e));
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = 'サイト全体を分析する';
      }
    });

    // 前回選んだ ZIP の中身（最小・すべて）を戻す
    try { var lastSet = localStorage.getItem('airreach_zip_set'); var r0 = lastSet && document.querySelector('input[name="orch-zip-set"][value="' + lastSet + '"]'); if (r0) r0.checked = true; } catch (e) {}
    var zipBtn = q('orch-zip');
    if (zipBtn) {
      zipBtn.addEventListener('click', function () {
        var job = window.__orchLastJob;
        if (!job || !job.files) {
          alert('先に分析を完了してください');
          return;
        }
        // 別の顧客・別のサイトの分析を取り違えて渡さない
        var cur = '';
        try { cur = hostOf((JSON.parse(localStorage.getItem('airreach_studio_v1') || '{}').profile || {}).url || ''); } catch (e) {}
        if (cur && hostOf(job.url) && cur !== hostOf(job.url)) {
          alert('いま開いているサイト（' + cur + '）と、分析したサイト（' + hostOf(job.url) + '）が違います。いまのサイトをもう一度分析してから作ってください。');
          return;
        }
        var set = (document.querySelector('input[name="orch-zip-set"]:checked') || {}).value || 'minimal';
        try { localStorage.setItem('airreach_zip_set', set); } catch (e) {}
        var paths = set === 'all' ? null : (window.AirReachPackageSchema && window.AirReachPackageSchema.MINIMAL_FILES) || null;
        downloadZip((window.AirReachPackageSchema && window.AirReachPackageSchema.ZIP_FILENAME) || 'airreach-implementation.zip', job.files, paths)
          .catch(function (e) { alert('ZIP を作れませんでした：' + (e && e.message ? e.message : e)); });
      });
    }

    var prBtn = q('orch-pr');
    if (prBtn) {
      prBtn.addEventListener('click', function (e) {
        e.preventDefault();
      });
    }
  }

  function refreshJobArtifacts(job) {
    if (!job) return job;
    job.totalDemand = sumDemand(job.keywords || []);
    if (job.headline4) {
      job.headline4.keywords = (job.keywords || []).length;
      job.headline4.demand = job.totalDemand;
      if (job.compression) job.headline4.implSites = job.compression.implSites;
    }
    job.files = buildPackageFiles(job);
    persistJob(job);
    return job;
  }

  window.AirReachOrchestrator = {
    validService: validService,
    serviceFromTitle: serviceFromTitle,
    profileFromDiagnose: profileFromDiagnose,
    runJob: runJob,
    buildPackageFiles: buildPackageFiles,
    googleFreeJob: googleFreeJob,
    downloadZip: downloadZip,
    finalizePackage: finalizePackage,
    _buildZip: buildZip,
    importGscRows: importGscRows,
    reattachGscToJob: reattachGscToJob,
    refreshJobArtifacts: refreshJobArtifacts,
    renderResult: renderResult,
    parseCsv: parseCsv,
    STEPS: STEPS,
    PackageSchema: window.AirReachPackageSchema || null,
    // テスト用（業種ごとのキーワード・質問の確認）
    downloadDraftFromDiagnose: downloadDraftFromDiagnose,
    buildDraftFromDiagnose: buildDraftFromDiagnose,
    downloadDraftZip: downloadDraftZip,
    _buildKeywords: buildKeywords,
    _promptsForKeyword: promptsForKeyword,
    _groupGsc: function (measurements) { return groupGsc(gscMapFromMeasurements(measurements)); },
    _lookupGsc: lookupGsc
  };

  document.addEventListener('DOMContentLoaded', bindOverview);
})();
