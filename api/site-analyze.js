/**
 * Site content analysis via TypeSafe Jev (System One).
 * API key must live in Vercel env TYPESAFE_API_KEY — never commit it.
 *
 * POST /api/site-analyze
 * body: { path?: string, url?: string, text?: string, title?: string }
 */
const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
const MAX_CHARS = 12000;

const ALLOWED_HOSTS = new Set([
  'trillion-bank.jp',
  'www.trillion-bank.jp',
  'trillion-bank-hp.vercel.app',
  'localhost',
  '127.0.0.1'
]);

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

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    return json(res, 500, { error: 'TYPESAFE_API_KEY is not configured' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  try {
    const extracted = await resolveContent(req, body);
    if (!extracted.text || extracted.text.trim().length < 40) {
      return json(res, 400, { error: 'Not enough page text to analyze' });
    }

    const state = {
      page: {
        path: extracted.path || null,
        url: extracted.url || null,
        title: extracted.title || null,
        text: truncate(extracted.text, MAX_CHARS)
      },
      brand: {
        legal_name: '株式会社Trillion Bank',
        products: ['AirReach', 'HackⅡ', 'Adctor'],
        not_a_bank: true
      }
    };

    const questions = {
      clarity: {
        type: 'score',
        instructions:
          'How clearly does `page.text` explain what Trillion Bank does for a first-time business reader?',
        criteria: [
          'Unclear or keyword-stuffed; hard to understand the offer',
          'Partly clear; reader must infer the main offer',
          'Clear: what the company does and for whom is understandable',
          'Very clear: answer-first, concrete, low jargon'
        ]
      },
      claim_safety: {
        type: 'score',
        instructions:
          'How safe are absolute or marketing claims in `page.text` given public-site guardrails (no 世界初/保証/完全自動, no unverified customer results)?',
        criteria: [
          'Contains high-risk absolute or unverified performance claims',
          'Some stretch claims or ambiguous guarantees',
          'Mostly careful; a few soft marketing phrases',
          'Cautious and evidence-aligned for a public corporate site'
        ]
      },
      entity_consistency: {
        type: 'noul',
        instructions:
          'Does `page.text` stay consistent with `brand` (Trillion Bank is not a bank; products are AirReach / HackⅡ / Adctor; measurement vs research stay separate)?',
        criteria: {
          true: 'Consistent with the brand facts',
          false: 'Contradicts or confuses brand / product roles'
        }
      },
      primary_job: {
        type: 'choice',
        instructions: 'What is the primary job of this page for the visitor?',
        criteria: {
          educate: 'Defines concepts or teaches AI search topics',
          product: 'Explains a product or offers implementation help',
          company: 'Company / trust / contact / legal information',
          lead: 'Conversion or diagnosis / contact capture',
          other: 'None of the above clearly'
        }
      },
      needs_edit: {
        type: 'noul',
        instructions:
          'Should an editor revise this page before treating it as a strong public primary source?',
        criteria: {
          true: 'Revision recommended for clarity, claims, or entity consistency',
          false: 'Good enough to keep as-is for now'
        }
      }
    };

    const tsRes = await fetch(TYPESAFE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
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

    const judgments = [
      { id: 'clarity', label: '明瞭性', thinking: '初見読者に何をする会社か伝わるか判定しています' },
      { id: 'claim_safety', label: '主張安全性', thinking: '誇大・保証表現のリスクを判定しています' },
      { id: 'entity_consistency', label: 'エンティティ整合', thinking: '銀行誤認や製品の混同がないか判定しています' },
      { id: 'primary_job', label: 'ページ役割', thinking: 'ページの主目的を分類しています' },
      { id: 'needs_edit', label: '編集要否', thinking: '公開一次情報として直すべきか判定しています' }
    ];

    return json(res, 200, {
      ok: true,
      source: {
        path: extracted.path || null,
        url: extracted.url || null,
        title: extracted.title || null,
        chars: extracted.text.length
      },
      model: payload.model || 'jev-latest',
      judgments,
      answers: payload.answers,
      usage: payload.usage || null
    });
  } catch (err) {
    return json(res, 500, {
      error: err && err.message ? err.message : 'Analysis failed'
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
    const path = String(body.path).startsWith('/') ? String(body.path) : `/${body.path}`;
    targetUrl = `${origin}${path}`;
  }
  if (!targetUrl) {
    throw new Error('Provide text, url, or path');
  }

  const parsed = new URL(targetUrl);
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error('URL host is not allowed');
  }

  const pageRes = await fetch(targetUrl, {
    headers: { Accept: 'text/html', 'User-Agent': 'TrillionBank-SiteAnalyze/1.0' },
    redirect: 'follow'
  });
  if (!pageRes.ok) {
    throw new Error(`Failed to fetch page (${pageRes.status})`);
  }
  const html = await pageRes.text();
  return {
    text: htmlToText(html),
    title: extractTitle(html),
    path: parsed.pathname,
    url: targetUrl
  };
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
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
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
