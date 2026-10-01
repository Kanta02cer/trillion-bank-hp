/**
 * AirReach 月次レポート — 材料（診断・AI計測・流入・施策）から下書きを組み立てる。
 * 画面（airreach-console.js）とは切り離し、Node でも単体テストできる純粋関数だけを置く。
 *
 * 方針
 *   - 数字は材料にあるものだけを使う。無いものは null（画面では「—」や「未計測」）。推定で埋めない。
 *   - 自動で作るのは「事実の変化」まで（点数 48→55、引用率 0%→20% など）。結論・次の施策は担当者が書く。
 */
(function (root) {
  'use strict';

  // 診断のチェック名 → 不足のときの言い方（airreach-diagnose.js の CHECK_CRITERIA の ng と同じ。変えるときは両方）
  var GAP_TEXT = {
    'ページタイトルがある': 'ページタイトル（title）が無い',
    'H1が1つ': '主見出し（H1）が0個か、2個以上ある',
    '説明文（meta）が十分': '説明文（meta description）が無いか、40文字未満',
    'canonicalがある': '正規URL（canonical）の指定が無い',
    'og:titleがある': '共有用タイトル（og:title）が無い',
    '本文量がある': '本文が800文字以下',
    '会社情報（Organization等）': '会社・お店の構造化データ（Organization / LocalBusiness）が無い',
    'WebSite / WebPage': 'サイト種別の構造化データ（WebSite / WebPage）が無い',
    'Service / Product': 'サービス・商品の構造化データ（Service / Product）が無い',
    'BreadcrumbList': 'ページ階層の構造化データ（BreadcrumbList）が無い',
    '問い合わせ導線': '問い合わせ・予約・相談の案内が無い',
    'FAQPageがある': 'FAQの構造化データ（FAQPage）が無い',
    'FAQが3問以上': 'FAQが3問未満',
    '画面上のFAQらしき領域': '画面にFAQのまとまりが無い',
    'llms.txtがある': 'llms.txt が無いか、80文字以下',
    'robots.txtがある': 'robots.txt が無い',
    '主要AIボットの記載': 'robots.txt にAIボット（GPTBot など）の記載が無い',
    'sitemap案内': 'robots.txt にサイトマップの案内が無い'
  };
  function gapText(label) { return GAP_TEXT[label] || label; }

  // 不足ごとの「直すこと」。配点は airreach-diagnose.js の check() と同じ（変えるときは両方）。
  // studio: 直す材料（/airreach/studio/）で下書きを作れるもの
  var FACTOR_LABEL = { structure: 'ページの骨格', entity: '会社・お店の情報', faq: 'よくある質問', discover: '見つけやすさ' };
  var FIX_INFO = {
    'ページタイトルがある': { factor: 'structure', points: 2, why: '検索結果やAIが、ページの主題を読む最初の手がかりになります。', how: '店名・会社名と、何のページかが分かるタイトル（title）を設定する。' },
    'H1が1つ': { factor: 'structure', points: 3, why: '主題が一目で分かる見出しが1つだけあると、内容を取り違えられにくくなります。', how: 'ページの主見出し（H1）を1つにし、店名・サービス名を入れる。' },
    '説明文（meta）が十分': { factor: 'structure', points: 2, why: '検索結果に出る説明文で、誰向けの何のページかが伝わります。', how: '40文字以上の説明文（meta description）を書く。対象・内容・場所を入れる。' },
    'canonicalがある': { factor: 'structure', points: 2, why: '同じ内容のURLが複数あるとき、正しいURLを示せます。', how: '正規URL（canonical）をページごとに指定する。' },
    'og:titleがある': { factor: 'structure', points: 1, why: 'SNSやチャットで共有されたときの見出しになります。', how: '共有用タイトル（og:title）を設定する。' },
    '本文量がある': { factor: 'structure', points: 2, why: '案内の文章が少ないと、AIや検索が内容を判断する材料が足りません。', how: 'サービス内容・料金の目安・対象・場所など、来店前・相談前に知りたいことを本文に書き足す。' },
    '会社情報（Organization等）': { factor: 'entity', points: 4, why: '誰のサイトか（正式名称・所在地・連絡先）を機械が読めると、取り違えられにくくなります。', how: '会社・お店の構造化データ（Organization / LocalBusiness）を入れる。', studio: true },
    'WebSite / WebPage': { factor: 'entity', points: 2, why: 'サイトとページの種類を機械が読めるようになります。', how: 'サイト種別の構造化データ（WebSite / WebPage）を入れる。' },
    'Service / Product': { factor: 'entity', points: 2, why: '何を提供しているかを機械が読めるようになります。', how: 'サービス・商品の構造化データ（Service / Product）を入れる。', studio: true },
    'BreadcrumbList': { factor: 'entity', points: 1, why: 'ページの階層（どこの何のページか）が伝わります。', how: 'ページ階層の構造化データ（BreadcrumbList）を入れる。' },
    '問い合わせ導線': { factor: 'entity', points: 1, why: '興味を持った人が、次に何をすればよいか分かります。', how: '予約・問い合わせ・相談の案内（ボタンやリンク）を目立つ位置に置く。' },
    'FAQPageがある': { factor: 'faq', points: 3, why: 'よくある質問と答えを機械が読める形にすると、AIの回答の材料になりやすくなります。', how: '画面のFAQと同じ内容で、FAQの構造化データ（FAQPage）を入れる。', studio: true },
    'FAQが3問以上': { factor: 'faq', points: 3, why: '決める前に聞かれることに、公式の答えが用意されている状態になります。', how: '予約・料金・駐車場・支払い方法など、よく聞かれる質問を3問以上書く。', studio: true },
    '画面上のFAQらしき領域': { factor: 'faq', points: 2, why: '人が読めるFAQがあると、機械向けのデータと内容をそろえられます。', how: 'ページに「よくある質問」の見出しとQ&Aのまとまりを置く。' },
    'llms.txtがある': { factor: 'discover', points: 4, why: 'AI向けに、サイトの概要と重要なページを案内するファイルです。', how: 'サイトの一番上の階層に llms.txt（81文字以上）を置く。', studio: true },
    'robots.txtがある': { factor: 'discover', points: 2, why: '検索やAIのクローラーに、読んでよい範囲を伝えるファイルです。', how: 'サイトの一番上の階層に robots.txt を置く。' },
    '主要AIボットの記載': { factor: 'discover', points: 2, why: 'AIのクローラーへの方針（読んでよいか）が明示されます。', how: 'robots.txt に GPTBot などAIボットへの方針を書く。' },
    'sitemap案内': { factor: 'discover', points: 2, why: 'クローラーがページの一覧を見つけやすくなります。', how: 'robots.txt に Sitemap: の行でサイトマップのURLを書く。' }
  };
  // お客様向けの言い方（専門用語を使わない）。社内の画面は FIX_INFO / GAP_TEXT の正確な用語のまま。
  // t: 足りないこと / how: 直し方 / why: 直すと何がよいか。効果を約束する言い方はしない
  var PLAIN = {
    'ページタイトルがある': { ok: 'ページの題名が入った', t: '検索結果に出るページの題名が無い', how: 'ページの題名に、店名・会社名と何のページかを入れる', why: '検索やAIが、何のページかを最初に判断する手がかりになります。' },
    'H1が1つ': { ok: 'ページの一番大きな見出しが1つにそろった', t: 'ページの一番大きな見出しが無いか、2つ以上ある', how: 'ページの一番大きな見出しを1つにし、店名・サービス名を入れる', why: '何のページかが一目で伝わり、内容を取り違えられにくくなります。' },
    '説明文（meta）が十分': { ok: '検索結果に出る紹介文が入った', t: '検索結果に出る紹介文が無いか、短い', how: '検索結果に出る紹介文（40文字以上）に、誰向けの何のお店・サービスかと場所を書く', why: '検索結果を見た人に、どんなお店・サービスかが伝わります。' },
    'canonicalがある': { ok: 'ページの正式なURLが指定された', t: 'ページの正式なURLが指定されていない', how: '同じページが複数のURLで開ける場合に、正式なURLを指定する（制作会社に依頼）', why: '検索やAIが、どのURLを正式なページとして扱うか迷わなくなります。' },
    'og:titleがある': { ok: 'SNSやLINEで共有されたときの題名が入った', t: 'SNSやLINEで共有されたときの題名が無い', how: 'SNSやLINEで共有されたときに表示される題名を設定する', why: '共有されたときに、何のページかが伝わります。' },
    '本文量がある': { ok: 'ページの説明の文章が十分になった', t: 'ページの説明の文章が少ない', how: 'メニュー・料金の目安・場所・予約方法など、来店や相談の前に知りたいことを書き足す', why: '文章が少ないと、検索やAIがお店の内容を判断できません。' },
    '会社情報（Organization等）': { ok: 'お店・会社の基本情報が、検索やAIが読み取れる形になった', t: 'お店・会社の基本情報が、検索やAIが読み取れる形になっていない', how: '店名・住所・電話番号・営業時間などを、検索やAIが読み取れる形式でサイトに埋め込む', why: '誰のサイトかを正しく認識され、ほかのお店・会社と取り違えられにくくなります。' },
    'WebSite / WebPage': { ok: 'サイト名やページの種類が、検索やAIが読み取れる形になった', t: 'サイト名やページの種類が、検索やAIが読み取れる形になっていない', how: 'サイト名やページの種類を、検索やAIが読み取れる形式で埋め込む', why: 'サイトとページの関係が伝わりやすくなります。' },
    'Service / Product': { ok: '提供しているサービス・商品が、検索やAIが読み取れる形になった', t: '提供しているサービス・商品が、検索やAIが読み取れる形になっていない', how: 'サービス・商品の名前と内容を、検索やAIが読み取れる形式で埋め込む', why: '何を提供しているお店・会社かが伝わりやすくなります。' },
    'BreadcrumbList': { ok: 'サイトの中でのページの位置が、読み取れる形になった', t: 'サイトの中でのページの位置が、読み取れる形になっていない', how: 'ページの位置（トップ ＞ メニュー など）を、検索やAIが読み取れる形式で埋め込む', why: 'どこの何のページかが伝わります。' },
    '問い合わせ導線': { ok: '予約・問い合わせの案内が入った', t: '予約・問い合わせの案内が見当たらない', how: '予約・問い合わせのボタンやリンクを、目立つ位置に置く', why: '興味を持った人が、次に何をすればよいか分かります。' },
    'FAQPageがある': { ok: 'よくある質問が、検索やAIが読み取れる形になった', t: 'よくある質問が、検索やAIが読み取れる形になっていない', how: 'ページに載せている「よくある質問」と同じ内容を、検索やAIが読み取れる形式でも埋め込む', why: 'AIが回答するときに参考にできる、お店の公式の答えになります。' },
    'FAQが3問以上': { ok: 'よくある質問が3問以上になった', t: 'よくある質問が3問より少ない', how: '予約・料金・駐車場・支払い方法など、よく聞かれる質問と答えを3問以上書く', why: '来店や相談の前に知りたいことに、お店が公式に答えている状態になります。' },
    '画面上のFAQらしき領域': { ok: 'ページに「よくある質問」のまとまりができた', t: 'ページに「よくある質問」のまとまりが無い', how: 'ページに「よくある質問」の見出しを作り、質問と答えをまとめて載せる', why: 'お客様が自分で答えを見つけやすくなります。' },
    'llms.txtがある': { ok: 'AI向けのサイト案内のファイルが置かれた', t: 'AI向けのサイト案内のファイルが無い', how: 'サイトの概要と主なページを書いた、AI向けの案内ファイルを置く（制作会社に依頼）', why: 'AIがサイトの内容を把握するための補助になります。' },
    'robots.txtがある': { ok: '検索やAIの巡回ロボット向けの案内ファイルが置かれた', t: '検索やAIの巡回ロボット向けの案内ファイルが無い', how: 'サイトのどこを読んでよいかを伝える案内ファイルを置く（制作会社に依頼）', why: '検索やAIの巡回ロボットに、読んでよい範囲を伝えられます。' },
    '主要AIボットの記載': { ok: 'AIの巡回ロボットへの方針が書かれた', t: 'AIの巡回ロボットへの方針が書かれていない', how: '巡回ロボット向けの案内ファイルに、ChatGPT などのAIのロボットを受け入れるかどうかを書く（制作会社に依頼）', why: 'AIの巡回ロボットが、サイトを読んでよいか判断できます。' },
    'sitemap案内': { ok: 'サイトのページ一覧の場所が案内された', t: 'サイトのページ一覧の場所が案内されていない', how: '巡回ロボット向けの案内ファイルに、ページ一覧（サイトマップ）の場所を書く（制作会社に依頼）', why: '検索やAIが、サイトのページを見つけやすくなります。' }
  };
  /** お客様向けの「直ったこと」（前月から解消した不足）。肯定の言い方にする */
  function plainResolved(labelOrText) {
    var k = PLAIN[labelOrText] ? labelOrText : TEXT_TO_KEY[labelOrText];
    return k && PLAIN[k] && PLAIN[k].ok ? PLAIN[k].ok : labelOrText;
  }
  /** お客様向けの「足りないこと」。チェック名でも、社内向けの言い方でも受け付ける */
  function plainGap(labelOrText) {
    var k = PLAIN[labelOrText] ? labelOrText : TEXT_TO_KEY[labelOrText];
    return k && PLAIN[k] ? PLAIN[k].t : labelOrText;
  }

  var TEXT_TO_KEY = {};
  Object.keys(GAP_TEXT).forEach(function (k) { TEXT_TO_KEY[GAP_TEXT[k]] = k; });

  /**
   * 最新の診断の不足を「直すこと」にして、配点の大きい順に並べる。
   * @returns {Array<{key,text,factor,factorLabel,points,why,how,studio}>}
   */
  function todoList(compiled) {
    var cur = compiled && compiled.site && compiled.site.current;
    if (!cur) return [];
    var keys = Array.isArray(cur.gapKeys) ? cur.gapKeys : (cur.gaps || []).map(function (t) { return TEXT_TO_KEY[t] || t; });
    var order = ['entity', 'faq', 'discover', 'structure'];
    return keys.map(function (k) {
      var f = FIX_INFO[k] || {};
      var pl = PLAIN[k] || {};
      return { key: k, text: gapText(k), factor: f.factor || '', factorLabel: FACTOR_LABEL[f.factor] || '', points: f.points || 0, why: f.why || '', how: f.how || '', studio: !!f.studio,
        plainText: pl.t || gapText(k), plainHow: pl.how || f.how || '', plainWhy: pl.why || f.why || '' };
    }).sort(function (a, b) { return (b.points - a.points) || (order.indexOf(a.factor) - order.indexOf(b.factor)); });
  }

  function monthStart(d) {
    var s = String(d || '').slice(0, 7);
    return /^\d{4}-\d{2}$/.test(s) ? s + '-01' : '';
  }
  function prevMonth(m) {
    var y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
    mo -= 1; if (mo === 0) { mo = 12; y -= 1; }
    return y + '-' + (mo < 10 ? '0' : '') + mo + '-01';
  }
  function monthEnd(m) {
    var y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
    var next = mo === 12 ? (y + 1) + '-01-01' : y + '-' + (mo + 1 < 10 ? '0' : '') + (mo + 1) + '-01';
    return next;
  }
  function inMonth(dateStr, m) {
    var d = String(dateStr || '').slice(0, 10);
    return d >= m && d < monthEnd(m);
  }
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(String(v).replace(/[,%\s]/g, ''));
    return isFinite(n) ? n : null;
  }
  function round1(n) { return n == null ? null : Math.round(n * 10) / 10; }
  function delta(cur, prev) { return cur == null || prev == null ? null : round1(cur - prev); }

  // ---- 計測スクリプトの summary.json ----------------------------------------
  /**
   * @returns {{runId,generatedAt,querySetVersion,matcherVersion,rows:Array}} rows: provider×group の KPI
   */
  function parseMeasurementSummary(json) {
    var d = typeof json === 'string' ? JSON.parse(json) : json;
    if (!d || !Array.isArray(d.by)) throw new Error('summary.json の形式ではありません（by が無い）');
    var rows = d.by.map(function (b) {
      var either = b.either && b.either.rate != null ? b.either.rate : b.rate;
      return {
        provider: String(b.provider || ''),
        model: String(b.model || ''),
        group: String(b.group || ''),
        label: String(b.label || ''),
        answers: num(b.denominator != null ? b.denominator : b.total),
        citeRate: num(either),
        citeCount: num(b.either && b.either.numerator != null ? b.either.numerator : b.numerator),
        mentionRate: num(b.service_mention_rate),
        mediaDomainRate: num(b.media_domain_rate),
        searchRate: num(b.search_execution_rate),
        errors: num(b.error_count) || 0
      };
    }).filter(function (r) { return r.provider && r.group; });
    if (!rows.length) throw new Error('summary.json に集計行がありません');
    return {
      runId: String(d.run_id || ''),
      generatedAt: String(d.generated_at || ''),
      querySetVersion: String(d.query_set_version || ''),
      matcherVersion: String(d.matcher_version || ''),
      rows: rows
    };
  }

  // ---- GSC の CSV（日本語・英語の書き出しどちらも）----------------------------
  function splitCsvLine(line) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (q) {
        if (ch === '"' && line.charAt(i + 1) === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }
  var GSC_COLS = {
    date: /^(date|日付)$/i,
    clicks: /^(clicks|クリック数)$/i,
    impressions: /^(impressions|表示回数)$/i,
    ctr: /^(ctr)$/i,
    position: /^(position|掲載順位|平均掲載順位)$/i
  };
  /**
   * GSC の「日付」CSV（Chart.csv / グラフ.csv）または「クエリ」「ページ」の CSV を合計する。
   * 日付列があれば periodMonth の行だけを合計する。
   * @returns {{clicks,impressions,ctr,position,rows}}
   */
  function parseGscCsv(text, periodMonth) {
    var lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (lines.length < 2) throw new Error('CSV にデータ行がありません');
    var head = splitCsvLine(lines[0]).map(function (h) { return h.trim(); });
    var idx = {};
    Object.keys(GSC_COLS).forEach(function (k) {
      for (var i = 0; i < head.length; i++) if (GSC_COLS[k].test(head[i])) { idx[k] = i; break; }
    });
    if (idx.clicks == null || idx.impressions == null) throw new Error('Search Console の CSV ではありません（クリック数・表示回数の列が無い）');
    var clicks = 0, imps = 0, posWeighted = 0, rows = 0;
    lines.slice(1).forEach(function (l) {
      var c = splitCsvLine(l);
      if (idx.date != null && periodMonth && !inMonth(c[idx.date], periodMonth)) return;
      var ck = num(c[idx.clicks]) || 0, im = num(c[idx.impressions]) || 0;
      clicks += ck; imps += im; rows++;
      if (idx.position != null && num(c[idx.position]) != null) posWeighted += num(c[idx.position]) * im;
    });
    if (!rows) throw new Error('対象の月（' + (periodMonth || '').slice(0, 7) + '）の行がありません');
    return {
      clicks: clicks,
      impressions: imps,
      ctr: imps ? round1(clicks / imps * 100) : null,
      position: imps && idx.position != null ? round1(posWeighted / imps) : null,
      rows: rows
    };
  }

  // ---- レポートの下書き ------------------------------------------------------
  function latest(list, dateKey, pred) {
    return (list || []).filter(pred).sort(function (a, b) { return String(b[dateKey]).localeCompare(String(a[dateKey])); })[0] || null;
  }

  function aiKpis(run) {
    if (!run || !run.summary) return null;
    var parsed;
    try { parsed = parseMeasurementSummary(run.summary); } catch (e) { return null; }
    var main = parsed.rows.filter(function (r) { return r.group === 'main'; });
    var use = main.length ? main : parsed.rows.filter(function (r) { return r.group === 'all'; });
    return {
      measuredOn: run.measured_on,
      querySetVersion: parsed.querySetVersion || run.query_set_version || '',
      providers: use.map(function (r) {
        return { provider: r.provider, model: r.model, answers: r.answers, citeRate: r.citeRate, mentionRate: r.mentionRate, errors: r.errors };
      })
    };
  }

  function trafficFor(list, month) {
    // 連携（*_api）の値を優先し、連携で取れない項目（対象ページ閲覧など）は CSV・手入力の値で埋める
    var byKind = {};
    (list || []).filter(function (t) { return t.period_month === month; }).forEach(function (t) {
      var kind = /^gsc/.test(t.source) ? 'gsc' : 'ga4';
      byKind[kind] = byKind[kind] || {};
      byKind[kind][/_api$/.test(t.source) ? 'api' : 'manual'] = t;
    });
    var out = {};
    Object.keys(byKind).forEach(function (kind) {
      var api = byKind[kind].api, manual = byKind[kind].manual, m = {};
      [manual, api].forEach(function (t) {
        if (!t) return;
        Object.keys(t.metrics || {}).forEach(function (k) { if (t.metrics[k] != null) m[k] = t.metrics[k]; });
      });
      out[kind] = Object.assign({ source: (api || manual).source }, m);
    });
    return out;
  }

  /**
   * @param {object} p { client, periodMonth:'YYYY-MM-01', scans:[], runs:[], traffic:[], actions:[], now? }
   */
  function compileReport(p) {
    var m = monthStart(p.periodMonth);
    if (!m) throw new Error('対象月が不正です');
    var pm = prevMonth(m);
    var end = monthEnd(m);

    // 診断: 当月（なければ月末までで最新）と、前月の最新
    var scanNow = latest(p.scans, 'createdAt', function (s) { return String(s.createdAt).slice(0, 10) < end; });
    var scanPrev = latest(p.scans, 'createdAt', function (s) { return inMonth(s.createdAt, pm); });
    var gapsNow = scanNow ? (scanNow.gaps || []).map(gapText) : [];
    var gapsPrev = scanPrev ? (scanPrev.gaps || []).map(gapText) : [];
    var site = {
      current: scanNow ? { id: scanNow.id, createdAt: scanNow.createdAt, url: scanNow.url, overall: scanNow.overallScore, factors: scanNow.factors || {}, gaps: gapsNow, gapKeys: (scanNow.gaps || []).slice(), unknownChecks: scanNow.unknownChecks || 0, inMonth: inMonth(scanNow.createdAt, m) } : null,
      previous: scanPrev ? { id: scanPrev.id, createdAt: scanPrev.createdAt, overall: scanPrev.overallScore, gaps: gapsPrev } : null,
      overallDelta: scanNow && scanPrev ? delta(scanNow.overallScore, scanPrev.overallScore) : null,
      resolved: scanPrev ? gapsPrev.filter(function (g) { return gapsNow.indexOf(g) < 0; }) : [],
      added: scanPrev ? gapsNow.filter(function (g) { return gapsPrev.indexOf(g) < 0; }) : []
    };

    // AI 計測: 当月の最新と前月の最新
    var runNow = latest(p.runs, 'measured_on', function (r) { return inMonth(r.measured_on, m); });
    var runPrev = latest(p.runs, 'measured_on', function (r) { return inMonth(r.measured_on, pm); });
    var aiNow = aiKpis(runNow), aiPrev = aiKpis(runPrev);
    var ai = null;
    if (aiNow) {
      ai = {
        measuredOn: aiNow.measuredOn, querySetVersion: aiNow.querySetVersion,
        comparable: !!(aiPrev && aiPrev.querySetVersion === aiNow.querySetVersion),
        providers: aiNow.providers.map(function (r) {
          var prev = aiPrev ? aiPrev.providers.filter(function (x) { return x.provider === r.provider; })[0] : null;
          var comparable = !!(aiPrev && aiPrev.querySetVersion === aiNow.querySetVersion && prev);
          return Object.assign({}, r, {
            prevCiteRate: prev ? prev.citeRate : null, prevMentionRate: prev ? prev.mentionRate : null,
            citeDelta: comparable ? delta(r.citeRate, prev.citeRate) : null,
            mentionDelta: comparable ? delta(r.mentionRate, prev.mentionRate) : null
          });
        })
      };
    }

    // 流入
    var tNow = trafficFor(p.traffic, m), tPrev = trafficFor(p.traffic, pm);
    var traffic = { gsc: tNow.gsc || null, gscPrev: tPrev.gsc || null, ga4: tNow.ga4 || null, ga4Prev: tPrev.ga4 || null };

    // 施策（当月に実施したもの）
    var actions = (p.actions || []).filter(function (a) { return a.status === 'done' && inMonth(a.done_on, m); })
      .sort(function (a, b) { return String(a.done_on).localeCompare(String(b.done_on)); })
      .map(function (a) { return { title: a.title, doneOn: a.done_on, evidenceUrl: a.evidence_url || '', category: a.category || '' }; });

    // 事実の変化（結論の下書きに使う候補）
    var facts = [];
    if (site.current && site.current.overall != null) {
      facts.push(site.previous && site.previous.overall != null
        ? 'ホームページの情報整備：' + site.previous.overall + '点 → ' + site.current.overall + '点（' + (site.overallDelta >= 0 ? '+' : '') + site.overallDelta + '）'
        : 'ホームページの情報整備：' + site.current.overall + '点（前月の診断なし）');
    }
    if (site.resolved.length) facts.push('前月から解消した不足：' + site.resolved.length + '件');
    if (ai) ai.providers.forEach(function (r) {
      if (r.citeRate == null) return;
      facts.push('AIの引用率（' + ({ openai: 'ChatGPT', gemini: 'Gemini' }[r.provider] || r.provider) + '）：' + (r.citeDelta != null ? (r.prevCiteRate + '% → ') : '') + r.citeRate + '%' + (r.citeDelta != null ? '（' + (r.citeDelta >= 0 ? '+' : '') + r.citeDelta + 'pt）' : (ai.comparable ? '' : '（前月と質問の版が違う、または前月の計測なし）')));
    });
    if (traffic.gsc && traffic.gsc.clicks != null) {
      facts.push('検索からのクリック：' + (traffic.gscPrev && traffic.gscPrev.clicks != null ? traffic.gscPrev.clicks + ' → ' : '') + traffic.gsc.clicks);
    }
    if (actions.length) facts.push('今月実施した施策：' + actions.length + '件');

    // 推移（対象月までの6か月）。グラフ用。各月の最新の材料だけを使い、無い月は null のまま（線をつながない）
    var history = [];
    for (var k = 5; k >= 0; k--) {
      var mm = m;
      for (var j = 0; j < k; j++) mm = prevMonth(mm);
      var sc = latest(p.scans, 'createdAt', function (s) { return inMonth(s.createdAt, mm); });
      var ak = aiKpis(latest(p.runs, 'measured_on', function (r) { return inMonth(r.measured_on, mm); }));
      var tr = trafficFor(p.traffic, mm);
      var cite = {};
      if (ak) ak.providers.forEach(function (r) { cite[r.provider] = r.citeRate; });
      history.push({
        month: mm,
        score: sc ? num(sc.overallScore) : null,
        querySetVersion: ak ? ak.querySetVersion : null,
        cite: cite,
        clicks: tr.gsc ? num(tr.gsc.clicks) : null,
        conversions: tr.ga4 ? num(tr.ga4.conversions) : null
      });
    }

    // 足りない材料（レポートに「未計測」と出すもの）
    var missing = [];
    if (!site.current) missing.push('ホームページの診断');
    else if (!site.current.inMonth) missing.push('当月の診断（' + String(site.current.createdAt).slice(0, 10) + ' の診断を使用）');
    if (!ai) missing.push('AI回答の計測');
    if (!traffic.gsc) missing.push('Search Console の数値');
    if (!traffic.ga4) missing.push('GA4 の数値');

    return {
      version: 'report-v1',
      periodMonth: m,
      previousMonth: pm,
      client: p.client ? { id: p.client.id, name: p.client.name, industryId: p.client.industry_id || '' } : null,
      generatedAt: (p.now || new Date()).toISOString ? (p.now || new Date()).toISOString() : String(p.now),
      site: site,
      ai: ai,
      traffic: traffic,
      actions: actions,
      facts: facts,
      history: history,
      missing: missing
    };
  }

  var api = { gapText: gapText, plainGap: plainGap, plainResolved: plainResolved, todoList: todoList, parseMeasurementSummary: parseMeasurementSummary, parseGscCsv: parseGscCsv, compileReport: compileReport, monthStart: monthStart, prevMonth: prevMonth, version: 'report-v1' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.AirReachReport = api;
})(typeof window !== 'undefined' ? window : null);
