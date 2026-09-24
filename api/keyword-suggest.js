/**
 * Suggest user-intent keywords / AI prompts from a page + entities.
 * POST /api/keyword-suggest/
 * body: {
 *   url?: string, text?: string, title?: string,
 *   brand?: string, ceoName?: string, serviceName?: string,
 *   mediaUrl?: string, region?: string, category?: string,
 *   max?: number
 * }
 *
 * Returns branded + generic keyword prompts. Does not guarantee AI citation.
 */
const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
const MAX_CHARS = 10000;
const MAX_KEYWORDS = 24;

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const max = Math.min(MAX_KEYWORDS, Math.max(4, Number(body.max) || 16));
  let pageText = String(body.text || '').trim();
  let pageTitle = String(body.title || '').trim();
  let pageUrl = body.url ? String(body.url).trim() : '';
  let fetchNote = null;

  if ((!pageText || pageText.length < 40) && pageUrl) {
    try {
      const fetched = await fetchPublicPage(pageUrl);
      pageText = fetched.text;
      pageTitle = pageTitle || fetched.title || '';
      pageUrl = fetched.url;
    } catch (e) {
      fetchNote = e && e.message ? e.message : 'page fetch failed';
    }
  }

  let entities = {
    brand: String(body.brand || '').trim(),
    ceoName: String(body.ceoName || '').trim(),
    serviceName: String(body.serviceName || '').trim(),
    region: String(body.region || '').trim(),
    category: String(body.category || '').trim()
  };

  // Heuristic fill from title / hostname
  if (!entities.brand && pageTitle) {
    entities.brand = guessBrandFromTitle(pageTitle);
  }
  if (!entities.brand && pageUrl) {
    try {
      const host = new URL(pageUrl).hostname.replace(/^www\./, '');
      entities.brand = host.split('.')[0];
    } catch (e) {}
  }
  if (!entities.serviceName && pageTitle) {
    entities.serviceName = guessServiceFromTitle(pageTitle, entities.brand);
  }

  // Optional Jev enrichment
  let enrichment = null;
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (apiKey && pageText && pageText.length >= 40) {
    try {
      enrichment = await enrichWithJev(apiKey, pageText, pageTitle, pageUrl, entities);
      if (enrichment.brand && !body.brand) entities.brand = enrichment.brand;
      if (enrichment.ceoName && !body.ceoName) entities.ceoName = enrichment.ceoName;
      if (enrichment.serviceName && !body.serviceName) entities.serviceName = enrichment.serviceName;
      if (enrichment.category && !body.category) entities.category = enrichment.category;
      if (enrichment.region && !body.region) entities.region = enrichment.region;
    } catch (e) {
      enrichment = { error: e && e.message ? e.message : 'enrichment failed' };
    }
  }

  const mediaUrl = String(body.mediaUrl || '').trim() || null;
  const keywords = buildKeywords(entities, { max, mediaUrl, topics: (enrichment && enrichment.topics) || [] });

  return json(res, 200, {
    ok: keywords.length > 0,
    scoreVersion: 'keyword-suggest-v1',
    evidenceClass: enrichment && !enrichment.error ? 'Estimated' : 'Customer supplied',
    url: pageUrl || null,
    title: pageTitle || null,
    entities,
    mediaUrl,
    keywords,
    fetchNote,
    enrichmentNote: enrichment && enrichment.error ? enrichment.error : null,
    disclaimer:
      'キーワード提案はユーザーが調べそうな質問の候補です。AI回答への掲載・引用・順位は保証しません。指名検索と一般検索は分けて計測してください。'
  });
}

function buildKeywords(entities, opts) {
  const max = opts.max || 16;
  const out = [];
  const seen = {};

  function add(item) {
    const prompt = String(item.prompt || '').trim();
    if (!prompt || seen[prompt]) return;
    seen[prompt] = 1;
    out.push({
      id: 'kw_' + out.length + '_' + Math.random().toString(36).slice(2, 6),
      keyword: item.keyword || prompt,
      prompt,
      intent: item.intent, // branded | generic
      entityType: item.entityType || null, // company | ceo | service | topic
      priority: item.priority || 'P1',
      why: item.why || '',
      mediaUrl: opts.mediaUrl || null
    });
  }

  const brand = entities.brand;
  const ceo = entities.ceoName;
  const service = entities.serviceName;
  const category = entities.category || service || brand;
  const region = entities.region;

  if (brand) {
    add({ keyword: brand, prompt: brand + 'とは', intent: 'branded', entityType: 'company', priority: 'P0', why: '会社名の基本理解' });
    add({ keyword: brand + ' 評判', prompt: brand + 'の評判は？', intent: 'branded', entityType: 'company', priority: 'P0', why: '指名の信頼確認' });
    add({ keyword: brand + ' 口コミ', prompt: brand + 'の口コミを教えて', intent: 'branded', entityType: 'company', priority: 'P1', why: '第三者評価の確認' });
  }
  if (ceo) {
    add({ keyword: ceo, prompt: ceo + 'とは', intent: 'branded', entityType: 'ceo', priority: 'P0', why: '代表者の人物理解' });
    add({ keyword: ceo + ' 評判', prompt: ceo + 'の評判は？', intent: 'branded', entityType: 'ceo', priority: 'P1', why: '代表者の信頼確認' });
  }
  if (service && service !== brand) {
    add({ keyword: service, prompt: service + 'とは', intent: 'branded', entityType: 'service', priority: 'P0', why: 'サービス理解' });
    add({ keyword: service + ' 評判', prompt: service + 'の評判は？', intent: 'branded', entityType: 'service', priority: 'P0', why: 'サービスの信頼確認' });
    add({ keyword: service + ' 料金', prompt: service + 'の料金は？', intent: 'branded', entityType: 'service', priority: 'P1', why: '検討段階の実務質問' });
  }
  if (brand && service && service !== brand) {
    add({ keyword: brand + ' ' + service, prompt: brand + 'の' + service + 'について教えて', intent: 'branded', entityType: 'company', priority: 'P1', why: '会社×サービスの複合指名' });
  }

  // Generic discovery
  if (category) {
    add({ keyword: category + ' おすすめ', prompt: category + 'のおすすめは？', intent: 'generic', entityType: 'topic', priority: 'P1', why: '未認知ユーザーの探索' });
    add({ keyword: category + ' 比較', prompt: category + 'の比較で選び方を教えて', intent: 'generic', entityType: 'topic', priority: 'P1', why: '比較検討' });
    add({ keyword: category + ' 料金', prompt: category + 'の料金相場は？', intent: 'generic', entityType: 'topic', priority: 'P2', why: '価格検討' });
  }
  if (region && category) {
    add({
      keyword: region + ' ' + category,
      prompt: region + 'でおすすめの' + category + 'は？',
      intent: 'generic',
      entityType: 'topic',
      priority: 'P1',
      why: '地域×業種の実需'
    });
  }

  (opts.topics || []).slice(0, 6).forEach((topic) => {
    const t = String(topic || '').trim();
    if (!t || t.length < 2) return;
    add({
      keyword: t,
      prompt: t + 'とは何ですか？',
      intent: 'generic',
      entityType: 'topic',
      priority: 'P2',
      why: 'ページ主題からの派生質問'
    });
  });

  // Prefer P0 branded first
  out.sort((a, b) => {
    const o = { P0: 0, P1: 1, P2: 2 };
    const ai = o[a.priority] != null ? o[a.priority] : 9;
    const bi = o[b.priority] != null ? o[b.priority] : 9;
    if (ai !== bi) return ai - bi;
    if (a.intent !== b.intent) return a.intent === 'branded' ? -1 : 1;
    return 0;
  });

  return out.slice(0, max);
}

async function enrichWithJev(apiKey, text, title, url, entities) {
  const state = {
    page: { title: title || null, url: url || null, text: truncate(text, MAX_CHARS) },
    hint: entities
  };
  const questions = {
    brand: {
      type: 'short_string',
      instructions: 'Extract the primary company / brand name from `page` (Japanese OK). Prefer legal or common brand name. If unclear return empty string.'
    },
    ceo: {
      type: 'short_string',
      instructions: 'Extract CEO / founder / representative name if clearly stated. Else empty string.'
    },
    service: {
      type: 'short_string',
      instructions: 'Extract the main product or service name. Else empty string.'
    },
    category: {
      type: 'short_string',
      instructions: 'One short category label users would search (e.g. パーソナルジム, ニュース配信, AI検索対策).'
    },
    region: {
      type: 'short_string',
      instructions: 'Primary city/region if local business, else empty string.'
    },
    topics: {
      type: 'string_list',
      instructions: 'Up to 5 short topics a prospective customer might search related to this page.'
    }
  };

  const tsRes = await fetch(TYPESAFE_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, model: 'jev-latest', questions })
  });
  const payload = await tsRes.json().catch(() => ({}));
  if (!tsRes.ok) throw new Error((payload && payload.error) || ('TypeSafe failed ' + tsRes.status));
  const a = payload.answers || {};
  return {
    brand: strAns(a.brand),
    ceoName: strAns(a.ceo),
    serviceName: strAns(a.service),
    category: strAns(a.category),
    region: strAns(a.region),
    topics: listAns(a.topics)
  };
}

function strAns(ans) {
  if (!ans) return '';
  const v = ans.value != null ? ans.value : ans.answer;
  return String(v || '').trim().slice(0, 80);
}
function listAns(ans) {
  if (!ans) return [];
  const v = ans.value != null ? ans.value : ans.answer;
  if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6);
  if (typeof v === 'string') return v.split(/[,、\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 6);
  return [];
}

function guessBrandFromTitle(title) {
  const t = String(title || '').split(/[|\-–—｜]/)[0].trim();
  return t.replace(/株式会社|有限会社|合同会社/g, '').trim().slice(0, 40);
}
function guessServiceFromTitle(title, brand) {
  const t = String(title || '');
  if (brand && t.indexOf(brand) >= 0) {
    const rest = t.replace(brand, '').replace(/株式会社|有限会社|合同会社|[|\-–—｜]/g, ' ').trim();
    return rest.slice(0, 40);
  }
  return '';
}

async function fetchPublicPage(targetUrl) {
  const parsed = new URL(targetUrl);
  if (!/^https?:$/i.test(parsed.protocol)) throw new Error('Only http/https URLs are supported');
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.)/.test(host) ||
    host.endsWith('.local') ||
    host === 'metadata.google.internal'
  ) {
    throw new Error('Private or local hosts cannot be fetched');
  }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 12000) : null;
  try {
    const pageRes = await fetch(parsed.href, {
      headers: { Accept: 'text/html', 'User-Agent': 'TrillionBank-KeywordSuggest/1.0' },
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined
    });
    if (!pageRes.ok) throw new Error('Failed to fetch page (' + pageRes.status + ')');
    const html = (await pageRes.text()).slice(0, 900000);
    return { text: htmlToText(html), title: extractTitle(html), url: parsed.href };
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  if (!text || text.length <= max) return text || '';
  return text.slice(0, max) + '…';
}
function setCors(req, res) {
  const origin = req.headers.origin || '';
  let allow = 'https://trillion-bank.jp';
  try {
    const host = origin ? new URL(origin).hostname : '';
    if (
      host === 'trillion-bank.jp' || host === 'www.trillion-bank.jp' ||
      host === 'localhost' || host === '127.0.0.1' ||
      (host && (host.endsWith('.vercel.app') || host.endsWith('.github.io')))
    ) allow = origin;
  } catch (e) {}
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
}
function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}
