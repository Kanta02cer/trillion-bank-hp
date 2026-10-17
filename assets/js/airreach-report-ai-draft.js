/**
 * 月次レポートの「結論・次にやる施策・お客様に判断いただきたいこと」を、AI に下書きしてもらう（担当者の編集画面）。
 *   1. このレポートの集計データ（compiled）だけから「AI に渡す材料」を作り、指示と一緒にコピーする
 *   2. 担当者が AI の返事（JSON）を貼ると、形を確かめて編集画面の欄に入れる
 *   3. AI の文章に、材料に無い数字があれば一覧で知らせる（担当者が直してから確認を依頼する）
 * サーバーから AI は呼ばない（費用・送り先が増えない）。欄に入れた文章は、今までどおり確認・承認・公開を通ってお客様に見える。
 * 数字・表・計測の条件はレポート画面がデータから出すので、AI には文章だけを書かせる。
 */
(function (root) {
  'use strict';

  var PROV = { openai: 'ChatGPT', chatgpt_search: 'ChatGPT（検索あり）', gemini: 'Gemini', claude: 'Claude', perplexity: 'Perplexity', google_aio: 'Google の AI による概要', google_ai_mode: 'Google の AI モード' };
  var MAX_TEXT = 200;

  function num(x) { return x == null || x === '' ? null : x; }

  /** AI に渡す材料（このレポートの集計データから。お客様の画面と同じ数字だけ） */
  function material(cmp) {
    var c = cmp || {}, site = c.site || {}, cur = site.current || null, ai = c.ai || null, tr = c.traffic || {};
    var R = root.AirReachReport;
    var todos = R && R.todoList ? R.todoList(c).slice(0, 6).map(function (t) { return t.plainText || t.text || ''; }).filter(Boolean) : (cur && cur.gaps) || [];
    var aioCell = function (k) {
      if (!k || !k.now) return null;
      return k.now.unmeasurable ? { 測定不能: k.now.unmeasurable } : { 名前が出た回数: k.now.x, 聞いた回数: k.now.n };
    };
    return {
      会社名: c.client ? c.client.name : '',
      対象の月: String(c.periodMonth || '').slice(0, 7),
      初回の計測か: !!c.first,
      自動で集めた事実: (c.facts || []).slice(),
      'Google の AI による概要（名前を入れていない質問）': aioCell(c.aio),
      'ChatGPT 検索あり（名前を入れていない質問・補助）': aioCell(c.chatgpt),
      AIごとの結果: ai ? (ai.providers || []).map(function (p) {
        return {
          AI: PROV[p.provider] || p.provider,
          回答の数: num(p.answers),
          公式サイトが出典になった回答: num(p.citeCount), 出典を判定できた回答: num(p.judged), '出典になった割合(%)': p.citeRate == null ? (p.citeNa || '測定不能') : p.citeRate,
          名前が出た回答: num(p.mentionCount), '名前が出た割合(%)': p.mentionRate == null ? (p.mentionNa || '測定不能') : p.mentionRate
        };
      }) : '今月は計測していません',
      'ホームページの情報整備（点）': cur ? num(cur.overall) : '診断なし',
      まだ足りないこと: todos,
      検索とサイト: {
        検索からのクリック: tr.gsc ? num(tr.gsc.clicks) : '未計測',
        検索の表示回数: tr.gsc ? num(tr.gsc.impressions) : '未計測',
        サイトへの訪問回数: tr.ga4 ? num(tr.ga4.sessions) : '未計測',
        問い合わせ・予約: tr.ga4 ? num(tr.ga4.conversions) : '未計測'
      },
      今月実施したこと: (c.actions || []).map(function (a) { return a.title; }),
      未計測の項目: (c.missing || []).slice()
    };
  }

  /** AI に渡す指示（材料を含む） */
  function prompt(cmp) {
    var m = material(cmp);
    return [
      'あなたは、AI検索での見え方を測るサービスの担当者です。お客様向けの月次レポートに載せる文章の下書きを書いてください。',
      '数字・表・計測の条件は、レポートが自動で載せます。あなたが書くのは、次の3つの文章だけです。',
      '',
      '# 書くもの',
      '- conclusions：今月の結論。1〜3件。1件は80字まで。',
      '- next_actions：次にやる施策。1〜3件。title は60字まで。owner（担当。例：当社・御社・制作会社）と due（期限。YYYY-MM-DD）は分からなければ空文字。',
      '- client_decisions：お客様に判断いただきたいこと。0〜3件。なければ空の配列。',
      '',
      '# 守ること（最重要）',
      '1. 数字は、下の「材料」にあるものだけを使う。計算・推測・丸めをしない。割合を書くときは、回数も書く（例：25回中3回）。',
      '2. 「測定不能」「未計測」のものを 0 や 0% と書かない。',
      '3. 業界平均・他社の事例・一般に言われている数字など、材料に無い数字や事実は書かない。',
      '4. 順位・AIでの掲載・問い合わせ・売上を保証する書き方や、「必ず」「確実に」は使わない。',
      '5. 専門用語（構造化データ、llms.txt、robots.txt など）は使わず、「検索やAIが読み取れる形で会社の情報を載せる」のように言い換える。',
      '6. 取得の手段の名前（ツール名・API名・料金プラン）は書かない。AI の名前だけを書く。',
      m.初回の計測か ? '7. 今回は初回の計測です。前の月との比較や「増えた・減った」は書かず、「改善前の基準として記録した」と書いてください。' : '7. 前の月と比べるときは、材料の「自動で集めた事実」に差が書かれているものだけを使ってください。',
      '',
      '# 返事の形',
      '次の JSON だけを返してください（説明の文章は付けない）。',
      '{"conclusions":["…"],"next_actions":[{"title":"…","owner":"","due":""}],"client_decisions":[]}',
      '',
      '# 材料',
      JSON.stringify(m, null, 2)
    ].join('\n');
  }

  function cut(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) : s; }

  /** AI の返事を読む。JSON（コードブロックの中でもよい）から、3つの欄の形に直す */
  function parseReply(text) {
    var t = String(text || '').trim();
    var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1].trim();
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return { ok: false, errors: ['返事に JSON が見つかりません。AI に「JSON だけを返して」と頼み直してください'] };
    var o;
    try { o = JSON.parse(t.slice(a, b + 1)); } catch (e) { return { ok: false, errors: ['返事の JSON が読めません（' + e.message + '）'] }; }
    var errors = [];
    var concl = (Array.isArray(o.conclusions) ? o.conclusions : []).map(function (x) { return cut(x, MAX_TEXT); }).filter(Boolean);
    if (!concl.length) errors.push('結論（conclusions）がありません');
    if (concl.length > 3) { errors.push('結論が' + concl.length + '件あります。最初の3件だけを入れました'); concl = concl.slice(0, 3); }
    var next = (Array.isArray(o.next_actions) ? o.next_actions : []).map(function (x) {
      x = x && typeof x === 'object' ? x : { title: x };
      var due = String(x.due || '').trim();
      return { title: cut(x.title, MAX_TEXT), owner: cut(x.owner, 40), due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : '' };
    }).filter(function (x) { return x.title; });
    if (next.length > 3) { errors.push('施策が' + next.length + '件あります。最初の3件だけを入れました'); next = next.slice(0, 3); }
    var dec = (Array.isArray(o.client_decisions) ? o.client_decisions : []).map(function (x) { return cut(x, MAX_TEXT); }).filter(Boolean).slice(0, 3);
    return { ok: concl.length > 0, value: { conclusions: concl, next_actions: next, client_decisions: dec }, errors: errors };
  }

  // 文章の中の数字（全角も半角にそろえる）。日付（2026-10-01・10/6・10月）は数字の確認から外す
  function numbersIn(s) {
    var t = String(s || '').replace(/[０-９．]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); });
    t = t.replace(/\d{4}-\d{1,2}-\d{1,2}/g, ' ').replace(/\d{4}年\d{1,2}月(\d{1,2}日)?/g, ' ').replace(/\d{1,2}月\d{1,2}日/g, ' ').replace(/\d{1,2}\/\d{1,2}/g, ' ').replace(/\d{1,2}月/g, ' ');
    return (t.match(/\d+(?:\.\d+)?/g) || []).map(function (x) { return String(Number(x)); });
  }

  /** AI の文章にあって、材料に無い数字（担当者が確かめる）。1〜3 は「3つ」などに使うので除く */
  function unknownNumbers(value, cmp) {
    var known = {};
    numbersIn(JSON.stringify(material(cmp))).forEach(function (n) { known[n] = true; });
    var texts = [].concat(value.conclusions || [], (value.next_actions || []).map(function (x) { return x.title; }), value.client_decisions || []);
    var out = [];
    texts.forEach(function (s) {
      numbersIn(s).forEach(function (n) { if (!known[n] && Number(n) > 3 && out.indexOf(n) < 0) out.push(n); });
    });
    return out;
  }

  var api = { material: material, prompt: prompt, parseReply: parseReply, unknownNumbers: unknownNumbers };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AirReachReportAiDraft = api;
})(typeof window !== 'undefined' ? window : globalThis);
