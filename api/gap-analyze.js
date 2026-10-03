/**
 * Content gap analysis via TypeSafe Jev.
 * POST /api/gap-analyze/
 * body: { url?: string, text?: string, title?: string, brand?: string, service?: string, industry?: 'restaurant'|'clinic'|'b2b'|... }
 *
 * 業種ごとに「足りない情報」の項目を変える（飲食店に『導入事例』『監修者』を求めない）。
 * 対象のページは、無料診断と同じ安全な取得（_lib/fetch-proxy.js: 公開アドレスだけ・DNS 固定・サイズ上限）で本文を読む。
 */
// 取得の部品は ESM（api/airreach は type: module）。この関数は CommonJS に変換されるため、動的 import で読む
const loadFetchProxy = () => import('./airreach/_lib/fetch-proxy.js');
const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
const MAX_CHARS = 12000;

const ALLOWED_HOSTS = new Set([
  'trillion-bank.jp',
  'www.trillion-bank.jp',
  'trillion-bank-hp.vercel.app',
  'localhost',
  '127.0.0.1'
]);

// 会社向けサービス（既定）
const GAP_DEFS_B2B = [
  { id: 'pricing', label: '料金・プラン', action: '料金・条件を公式に明記する', why: '購入判断に必要な価格条件が不足' },
  { id: 'case', label: '導入事例 / Before After', action: '事例・導入の流れを追加する', why: '成果の根拠が不足' },
  { id: 'comparison', label: '比較・選び方', action: '比較・向いている人を整理する', why: '商用Intentに答えられていない' },
  { id: 'faq', label: 'FAQ', action: 'FAQを質問単位で公式に置く', why: 'AIが回答を抜き出しにくい' },
  { id: 'evidence', label: '独自データ / 数値根拠', action: '一次情報・数値根拠を追加する', why: '引用理由になる根拠が不足' },
  { id: 'author', label: '監修者 / 運営主体', action: '運営主体・監修を明確にする', why: 'Entity/Trustの説明が弱い' },
  { id: 'schema', label: 'JSON-LD / Schema', action: '本文と一致する構造化データを置く', why: '機械可読な関係性が不足' },
  { id: 'cta', label: '問い合わせ / CV導線', action: '次の一歩（相談・問い合わせ）を明示する', why: '流入後の導線が弱い' },
  { id: 'policy', label: '利用条件 / ポリシー', action: '利用条件・責任範囲を整える', why: 'サービス条件が不明瞭' }
];
// 飲食店: 初めて行く人が来店・予約を決める前に知りたいこと
const GAP_DEFS_RESTAURANT = [
  { id: 'menu', label: 'メニュー・予算の目安', action: '主なメニューと価格帯（ランチ・ディナー）を文字で書く', why: '何がいくらで食べられるか分からない' },
  { id: 'hours', label: '営業時間・定休日', action: '営業時間・ラストオーダー・定休日を書く', why: '行ける日時が分からない' },
  { id: 'reserve', label: '予約方法', action: '予約の方法（電話・予約サイト）と可否を書く', why: '予約できるか・どうするか分からない' },
  { id: 'access', label: 'アクセス・駐車場', action: '最寄り駅からの道順・駐車場の有無を書く', why: '行き方が分からない' },
  { id: 'seats', label: '席・個室', action: '席数・個室の有無と人数を書く', why: '人数や用途に合うか分からない' },
  { id: 'family', label: '子ども連れ・バリアフリー', action: '子ども連れ・車いすの可否を書く', why: '家族やシニアが来られるか分からない' },
  { id: 'payment', label: '支払い方法', action: '使えるカード・電子マネーを書く', why: '支払いで困るか分からない' },
  { id: 'faq', label: 'よくある質問', action: 'よく聞かれる質問と答えをまとめて置く', why: 'AIが答えを抜き出しにくい' },
  { id: 'schema', label: 'お店の情報（構造化データ）', action: '店名・住所・電話・営業時間を検索やAIが読み取れる形で埋め込む', why: '検索やAIがお店の基本情報を読み取れない' }
];
// 美容・クリニック: 初めての人が予約を決める前に知りたいこと
const GAP_DEFS_CLINIC = [
  { id: 'menu', label: 'メニュー・料金の目安', action: '主なメニューと料金（追加料金の有無）を書く', why: 'いくらかかるか分からない' },
  { id: 'flow', label: '施術・来院の流れ', action: '初回の流れと所要時間を書く', why: '当日の様子が想像できない' },
  { id: 'reserve', label: '予約方法・キャンセル', action: '予約の方法とキャンセル規定を書く', why: '予約のしかたや条件が分からない' },
  { id: 'access', label: 'アクセス・駐車場', action: '最寄り駅からの道順・駐車場の有無を書く', why: '行き方が分からない' },
  { id: 'staff', label: '担当者・資格', action: '担当者の経歴・資格を書く（書面で確認できるものだけ）', why: '誰が担当するか分からない' },
  { id: 'caution', label: '注意点・リスク', action: '施術後の注意点やリスクを書く', why: '不安が解消できない' },
  { id: 'faq', label: 'よくある質問', action: 'よく聞かれる質問と答えをまとめて置く', why: 'AIが答えを抜き出しにくい' },
  { id: 'schema', label: 'お店の情報（構造化データ）', action: '名前・住所・電話・営業時間を検索やAIが読み取れる形で埋め込む', why: '検索やAIが基本情報を読み取れない' }
];
// メディア・広報（記事を読んでもらう・運営者を信頼してもらう）
const GAP_DEFS_MEDIA = [
  { id: 'about', label: '運営者・編集方針', action: '運営している会社・人と、記事の作り方（取材・確認の方針）を書く', why: '誰が書いているか分からず、信頼されにくい' },
  { id: 'author', label: '書き手・監修者', action: '記事ごとに書き手（必要なら監修者）の名前と紹介を書く（書面で確認できるものだけ）', why: '内容を信頼してよいか判断できない' },
  { id: 'sources', label: '出典・参考資料', action: '記事の根拠になった資料や取材先を記事の中に書く', why: 'AI が引用するときの裏付けにならない' },
  { id: 'dates', label: '公開日・更新日', action: '記事に公開日と最終更新日を出す', why: '情報が古いか新しいか分からない' },
  { id: 'categories', label: 'カテゴリ・テーマの一覧', action: '扱うテーマと記事の一覧ページを用意する', why: '何のサイトか・どの記事を読めばよいか分からない' },
  { id: 'faq', label: 'よくある質問', action: 'よく聞かれることをまとめて置く', why: 'AIが答えを抜き出しにくい' },
  { id: 'contact', label: '問い合わせ・取材依頼', action: '問い合わせ・取材や掲載の依頼先を書く', why: '連絡したい人が連絡できない' },
  { id: 'schema', label: '記事の情報（構造化データ）', action: '記事の見出し・書き手・公開日を検索やAIが読み取れる形で埋め込む', why: '検索やAIが記事の基本情報を読み取れない' }
];
// その他（地域の事業・教室・小売など。初めての人が利用するかを決める）
const GAP_DEFS_OTHER = [
  { id: 'service', label: 'できること・扱うもの', action: '何をしてくれるのか・何を扱っているのかを具体的に書く', why: '何のお店・会社か分からない' },
  { id: 'price', label: '料金の目安', action: '主な料金と、追加でかかるものを書く', why: 'いくらかかるか分からない' },
  { id: 'flow', label: '利用の流れ', action: '申し込みから利用までの流れと所要時間を書く', why: '初めてで何をすればよいか分からない' },
  { id: 'hours', label: '営業時間・定休日', action: '営業時間・定休日・受付時間を書く', why: 'いつ行けば・連絡すればよいか分からない' },
  { id: 'access', label: 'アクセス・対応地域', action: '所在地・最寄り駅・駐車場、または対応している地域を書く', why: '行けるか・来てもらえるか分からない' },
  { id: 'voice', label: 'お客様の声・実績', action: '利用した人の声や実績を書く（掲載の同意を取ったものだけ）', why: '頼んでよいか判断できない' },
  { id: 'faq', label: 'よくある質問', action: 'よく聞かれる質問と答えをまとめて置く', why: 'AIが答えを抜き出しにくい' },
  { id: 'schema', label: 'お店・会社の情報（構造化データ）', action: '名前・住所・電話・営業時間を検索やAIが読み取れる形で埋め込む', why: '検索やAIが基本情報を読み取れない' }
];
const GAP_SETS = {
  restaurant: { defs: GAP_DEFS_RESTAURANT, reader: 'a first-time customer deciding whether to visit or reserve' },
  clinic: { defs: GAP_DEFS_CLINIC, reader: 'a first-time customer or patient deciding whether to book' },
  b2b: { defs: GAP_DEFS_B2B, reader: 'a first-time business reader evaluating' },
  media: { defs: GAP_DEFS_MEDIA, reader: 'a first-time reader deciding whether to trust and read the site' },
  other: { defs: GAP_DEFS_OTHER, reader: 'a first-time customer deciding whether to use this business' }
};
export function gapSetFor(industry) { return GAP_SETS[industry] || GAP_SETS.b2b; }

function isCorsHost(host) {
  if (!host) return false;
  if (ALLOWED_HOSTS.has(host)) return true;
  if (host.endsWith('.vercel.app') || host.endsWith('.github.io')) return true;
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) return json(res, 500, { error: 'TYPESAFE_API_KEY is not configured' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const brand = String(body.brand || 'このお店・会社').trim();
  const service = String(body.service || '').trim();
  const set = gapSetFor(String(body.industry || ''));
  const GAP_DEFS = set.defs;

  try {
    const extracted = await resolveContent(req, body);
    if (!extracted.text || extracted.text.trim().length < 40) {
      return json(res, 400, { error: 'Not enough page text to analyze' });
    }

    const judgments = GAP_DEFS.map((g) => ({
      id: g.id,
      label: g.label,
      thinking: '「' + g.label + '」が本文から読み取れるか判定しています'
    }));

    const state = {
      page: {
        path: extracted.path || null,
        url: extracted.url || null,
        title: extracted.title || null,
        text: truncate(extracted.text, MAX_CHARS)
      },
      brand: { name: brand, service: service || null }
    };

    const questions = {};
    GAP_DEFS.forEach((g) => {
      questions['has_' + g.id] = {
        type: 'noul',
        instructions:
          'Does `page.text` clearly present usable ' + g.label +
          ' information for ' + set.reader + ' `' + brand +
          (service ? '` / `' + service : '') + '`?',
        criteria: {
          true: g.label + ' is present and usable on the page',
          false: g.label + ' is missing, vague, or not usable'
        }
      };
    });
    questions.overall_readiness = {
      type: 'score',
      instructions:
        'How ready is this page as AI-search citation material for the brand (answer-first clarity, evidence, entity, CTA)?',
      criteria: [
        'Not ready — major gaps block trust or understanding',
        'Weak — some basics exist but important gaps remain',
        'Adequate — core facts exist with a few gaps',
        'Strong — clear, evidence-aligned, citation-ready'
      ]
    };
    questions.top_gap = {
      type: 'choice',
      instructions: 'If one gap should be fixed first to improve AI-search usefulness, which is it?',
      criteria: Object.assign(
        { none: 'No major gap; page is already strong enough' },
        GAP_DEFS.reduce((acc, g) => {
          acc[g.id] = g.label + ' — ' + g.why;
          return acc;
        }, {})
      )
    };

    const tsRes = await fetch(TYPESAFE_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        state,
        model: 'jev-latest',
        questions
      })
    });
    const payload = await tsRes.json().catch(() => ({}));
    if (!tsRes.ok) {
      return json(res, 502, {
        error: 'TypeSafe request failed',
        status: tsRes.status,
        detail: payload
      });
    }

    const answers = payload.answers || {};
    const items = GAP_DEFS.map((g) => {
      const has = noulYes(answers['has_' + g.id]);
      const p = noulProb(answers['has_' + g.id]);
      return {
        id: g.id,
        label: g.label,
        present: has,
        probability_present: p,
        missing: !has,
        why: g.why,
        action: g.action,
        evidenceClass: 'Estimated',
        source: 'TypeSafe Jev'
      };
    });

    const missing = items.filter((x) => x.missing);
    const top = answers.top_gap && (answers.top_gap.value || answers.top_gap.answer || answers.top_gap.choice);
    missing.sort((a, b) => {
      if (top && a.id === top) return -1;
      if (top && b.id === top) return 1;
      return a.probability_present - b.probability_present;
    });
    missing.forEach((m, i) => {
      m.priority = i < 3 ? 'P0' : i < 6 ? 'P1' : 'P2';
    });

    return json(res, 200, {
      ok: true,
      model: payload.model || 'jev-latest',
      evidenceClass: 'Estimated',
      industry: GAP_SETS[String(body.industry || '')] ? String(body.industry) : 'b2b',
      source: {
        fetched: !!extracted.fetched,
        path: extracted.path || null,
        url: extracted.url || null,
        title: extracted.title || null,
        chars: extracted.text.length
      },
      judgments,
      readiness: scorePayload(answers.overall_readiness),
      top_gap: top || null,
      items,
      missing,
      usage: payload.usage || null
    });
  } catch (err) {
    return json(res, 500, {
      error: err && err.message ? err.message : 'Gap analysis failed'
    });
  }
}

async function resolveContent(req, body) {
  if (body.text && String(body.text).trim()) {
    return {
      text: String(body.text),
      title: body.title ? String(body.title) : null,
      path: body.path ? String(body.path) : null,
      url: body.url ? String(body.url) : null
    };
  }
  let targetUrl = body.url ? String(body.url) : null;
  if (!targetUrl && body.path) {
    const origin = getOrigin(req);
    const path = String(body.path).startsWith('/') ? String(body.path) : '/' + body.path;
    targetUrl = origin + path;
  }
  if (targetUrl) {
    try {
      const parsed = new URL(targetUrl);
      if (!(ALLOWED_HOSTS.has(parsed.hostname) || parsed.hostname.endsWith('.vercel.app'))) {
        // お客様のサイト: 無料診断と同じ安全な取得で本文を読む（読めなければ下の概要で判定）
        const { fetchPublicDocument, sanitizeTargetUrl } = await loadFetchProxy();
        const doc = await fetchPublicDocument(sanitizeTargetUrl(targetUrl), { timeoutMs: 8000, maxBytes: 1500000 });
        if (doc.status >= 200 && doc.status < 300 && /html/i.test(doc.contentType || '') && doc.body) {
          const text = htmlToText(doc.body);
          if (text.length >= 40) return { text, title: extractTitle(doc.body), path: parsed.pathname, url: doc.finalUrl || targetUrl, fetched: true };
        }
      } else {
        const pageRes = await fetch(targetUrl, {
          headers: { Accept: 'text/html', 'User-Agent': 'TrillionBank-GapAnalyze/1.0' },
          redirect: 'follow'
        });
        if (pageRes.ok) {
          const html = await pageRes.text();
          return {
            text: htmlToText(html),
            title: extractTitle(html),
            path: parsed.pathname,
            url: targetUrl,
            fetched: true
          };
        }
      }
    } catch (e) {
      // fall through to summary
    }
  }
  const summary = String(body.summary || '').trim();
  if (summary.length >= 40) {
    const brand = String(body.brand || '').trim();
    const service = String(body.service || '').trim();
    const bits = [];
    if (brand) bits.push('Brand: ' + brand);
    if (service) bits.push('Service: ' + service);
    if (targetUrl) bits.push('URL: ' + targetUrl);
    bits.push(summary);
    if (Array.isArray(body.known) && body.known.length) {
      bits.push('Known present: ' + body.known.join(', '));
    }
    return {
      text: bits.join('\n'),
      title: body.title ? String(body.title) : (brand || 'Summary'),
      path: body.path ? String(body.path) : null,
      url: targetUrl
    };
  }
  throw new Error('Provide text, fetchable url/path, or summary (40+ chars)');
}

function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
function extractTitle(html) {
  const m = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}
function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}
function noulYes(ans) {
  if (!ans) return false;
  if (typeof ans.value === 'boolean') return ans.value;
  if (typeof ans.answer === 'boolean') return ans.answer;
  return noulProb(ans) >= 0.5;
}
function noulProb(ans) {
  if (!ans) return 0;
  if (typeof ans.probability === 'number') return ans.probability;
  if (typeof ans.p === 'number') return ans.p;
  if (ans.value === true || ans.answer === true) return 1;
  if (ans.value === false || ans.answer === false) return 0;
  return 0;
}
function scorePayload(ans) {
  if (!ans) return null;
  return {
    score: typeof ans.score === 'number' ? ans.score : null,
    confidence: typeof ans.confidence === 'number' ? ans.confidence : null,
    legend: ans.legend || null
  };
}
function getOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  return proto + '://' + host;
}
function allowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return '*';
  try {
    const host = new URL(origin).hostname;
    if (isCorsHost(host)) return origin;
  } catch (e) {}
  return 'https://trillion-bank.jp';
}
function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}
