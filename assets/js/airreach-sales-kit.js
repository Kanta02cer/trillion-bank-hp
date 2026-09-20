/**
 * AirReach Sales kit — talk script + proposal draft from scan (deterministic).
 * Does not invent metrics; only rearranges stored diagnosis fields.
 */
(function () {
  'use strict';

  var OUTCOME = {
    reservation: '予約', visit: '来店', phone: '電話', line: 'LINE登録',
    inquiry: '問い合わせ', meeting: '商談', download: '資料請求',
    awareness: '認知', citation: '記事の使われ方'
  };
  var IND = {
    restaurant: '飲食店', clinic: '美容・クリニック', b2b: '会社向けサービス',
    media: 'メディア・広報', other: 'その他'
  };

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function scoreOf(scan) {
    if (scan && scan.scoreOverall != null && isFinite(Number(scan.scoreOverall))) return Number(scan.scoreOverall);
    if (scan && scan.previewDiagnose && scan.previewDiagnose.overall != null) return Number(scan.previewDiagnose.overall);
    return null;
  }

  function firstFix(scan) {
    if (scan && scan.firstFix) return String(scan.firstFix);
    if (scan && scan.previewDiagnose && scan.previewDiagnose.gaps && scan.previewDiagnose.gaps[0]) {
      return String(scan.previewDiagnose.gaps[0]);
    }
    return 'よく聞かれる質問や料金・メニューなど、決める前の情報が不足している可能性があります。';
  }

  function buildTalk(scan) {
    scan = scan || {};
    var name = scan.displayName || scan.siteTitle || scan.url || '御社';
    var score = scoreOf(scan);
    var outcome = OUTCOME[scan.outcomeGoal] || '集客';
    var fix = firstFix(scan);
    var kw = scan.keyword ? '「' + scan.keyword + '」' : 'お客様が使いそうな言葉';
    var lines = [];
    lines.push(name + 'さんのホームページを拝見しました。');
    if (score != null) {
      lines.push('いまの見つかりやすさは、参考で ' + score + ' / 100 です。（参考予測・成果保証なし）');
    } else {
      lines.push('いまの見つかりやすさを診断しました。');
    }
    lines.push(kw + ' で探しているお客さんに対して、' + outcome + 'につながる情報が足りない可能性があります。');
    lines.push('いちばん最初に直すとよいのは次です。');
    lines.push('→ ' + fix);
    lines.push('まずここを整えたうえで、続けて測りながら改善するのがおすすめです。');
    return lines.join('\n');
  }

  function buildProposalHtml(scan) {
    scan = scan || {};
    var name = esc(scan.displayName || scan.siteTitle || scan.url || 'ご提案先');
    var score = scoreOf(scan);
    var scoreText = score != null ? (score + ' / 100') : '—';
    var industry = esc(IND[scan.industryId] || scan.industryId || '');
    var outcome = esc(OUTCOME[scan.outcomeGoal] || scan.outcomeGoal || '');
    var fix = esc(firstFix(scan));
    var talk = esc(buildTalk(scan)).replace(/\n/g, '<br>');
    var url = esc(scan.url || '');
    var when = esc((scan.savedAt || '').slice(0, 10));
    var headlines = (scan.reportLite && scan.reportLite.headline) || [];
    var rows = headlines.map(function (h) {
      return '<tr><td>' + esc(h.label) + '</td><td><b>' + esc(h.value) + '</b> ' + esc(h.unit || '') +
        '</td><td>' + esc(h.badge || '参考予測') + '</td></tr>';
    }).join('');
    if (!rows) {
      rows = '<tr><td>見つかりやすさ</td><td><b>' + esc(scoreText) + '</b></td><td>参考予測</td></tr>';
    }
    return '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>提案書下書き - ' + name + '</title>' +
      '<style>body{font-family:"Noto Sans JP",sans-serif;color:#0f172a;max-width:720px;margin:32px auto;padding:0 20px;line-height:1.6}' +
      'h1{font-size:1.5rem}h2{font-size:1.1rem;margin-top:28px}.meta{color:#64748b;font-size:.9rem}' +
      'table{width:100%;border-collapse:collapse;margin:12px 0}td,th{border:1px solid #e2e8f0;padding:10px;text-align:left}' +
      '.box{border:1px solid #bfdbfe;background:#eff6ff;border-radius:10px;padding:14px 16px;margin:16px 0}' +
      '.note{font-size:.8rem;color:#94a3b8;margin-top:32px}@media print{.no-print{display:none}}</style></head><body>' +
      '<p class="meta">AirReach 提案書下書き · ' + when + ' · 成果・掲載は保証しません</p>' +
      '<h1>' + name + ' 様へのご提案</h1>' +
      '<p class="meta">' + industry + (outcome ? (' · 増やしたいこと：' + outcome) : '') + '<br>' + url + '</p>' +
      '<h2>いまの状態（参考）</h2><table><thead><tr><th>項目</th><th>値</th><th>区分</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="box"><b>いちばん最初に直すこと</b><br>' + fix + '</div>' +
      '<h2>商談で話すポイント</h2><p>' + talk + '</p>' +
      '<h2>次の進め方</h2><ol><li>上記の不足情報を公式サイトに追加する</li>' +
      '<li>必要なら Google の実測（Search Console）と接続して継続測定する</li>' +
      '<li>改善後に同じ条件で再診断し、Before / After を確認する</li></ol>' +
      '<p class="note">本資料の数値は AirReach の診断・参考予測に基づきます。検索順位・AI掲載・予約・問い合わせ・売上を保証するものではありません。顧客名・成果の公開には別途承認が必要です。</p>' +
      '<p class="no-print"><button onclick="window.print()">印刷 / PDF保存</button></p></body></html>';
  }

  function openProposal(scan) {
    var html = buildProposalHtml(scan);
    var w = window.open('', '_blank');
    if (!w) return false;
    w.document.open();
    w.document.write(html);
    w.document.close();
    return true;
  }

  window.AirReachSalesKit = {
    buildTalk: buildTalk,
    buildProposalHtml: buildProposalHtml,
    openProposal: openProposal,
    firstFix: firstFix,
    scoreOf: scoreOf,
    OUTCOME: OUTCOME,
    IND: IND
  };
})();
