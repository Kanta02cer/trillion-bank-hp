/**
 * HackⅡ Studio measurement helper (TypeSafe Jev + optional provider keys).
 * Keys live only in Vercel env — never commit them.
 *
 * POST /api/hack2-measure/
 */
const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
const MAX_CHARS = 10000;
const MAX_PROMPTS = 8;

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

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const brand = String(body.brand || '').trim();
  if (!brand) return json(res, 400, { error: 'brand is required' });

  const prompts = normalizePrompts(body.prompts);
  if (!prompts.length) {
    return json(res, 400, { error: 'prompts[] with prompt text is required (max ' + MAX_PROMPTS + ')' });
  }

  const engines = normalizeEngines(body.engines);
  let pageText = body.text ? String(body.text) : '';
  let pageUrl = body.url ? String(body.url) : null;
  let pageTitle = body.title ? String(body.title) : null;

  let fetchNote = null;
  try {
    if (!pageText && pageUrl) {
      const fetched = await fetchAllowedPage(pageUrl);
      pageText = fetched.text;
      pageTitle = pageTitle || fetched.title;
      pageUrl = fetched.url;
    }
  } catch (err) {
    // External client sites cannot be fetched from Vercel allowlist — continue prompt-only.
    fetchNote = err && err.message ? err.message : 'page fetch skipped';
    pageText = pageText || '';
  }

  const date = new Date().toISOString().slice(0, 10);
  const rows = [];
  const engineStatus = {};

  for (const engine of engines) {
    try {
      if (engine === 'jev') {
        const apiKey = process.env.TYPESAFE_API_KEY;
        if (!apiKey) {
          engineStatus.jev = { ok: false, error: 'TYPESAFE_API_KEY is not configured' };
          continue;
        }
        const judged = await measureWithJev({
          apiKey,
          brand,
          pageText: truncate(pageText || '', MAX_CHARS),
          pageUrl,
          pageTitle,
          prompts
        });
        judged.forEach((r) => {
          rows.push(Object.assign({ measurement_date: date, engine: 'Jev', url: pageUrl || '' }, r));
        });
        engineStatus.jev = { ok: true, count: judged.length, evidenceClass: 'Estimated' };
      } else {
        const live = await measureWithProvider(engine, brand, prompts, pageUrl);
        live.rows.forEach((r) => {
          rows.push(Object.assign({ measurement_date: date, url: pageUrl || '' }, r));
        });
        engineStatus[engine] = live.status;
      }
    } catch (err) {
      engineStatus[engine] = {
        ok: false,
        error: err && err.message ? err.message : 'measurement failed'
      };
    }
  }

  return json(res, 200, {
    ok: rows.length > 0,
    brand,
    url: pageUrl,
    engines,
    engineStatus,
    rows,
    note:
      'Jev results are Estimated proxy judgments from page text + prompt, not live AI-search captures. Provider engines require their API keys on Vercel.',
    fetchNote: fetchNote
  });
}

function normalizePrompts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => {
      if (typeof p === 'string') return { keyword: p, prompt: p };
      return {
        keyword: String((p && (p.keyword || p.prompt)) || '').trim(),
        prompt: String((p && (p.prompt || p.keyword)) || '').trim()
      };
    })
    .filter((p) => p.prompt)
    .slice(0, MAX_PROMPTS);
}

function normalizeEngines(raw) {
  const list = Array.isArray(raw) && raw.length ? raw : ['jev'];
  const out = [];
  const seen = {};
  list.forEach((e) => {
    let k = String(e || '').toLowerCase().trim();
    if (k === 'gpt' || k === 'openai') k = 'chatgpt';
    if (k === 'anthropic') k = 'claude';
    if (k === 'pplx' || k === 'sonar') k = 'perplexity';
    if (k === 'typesafe' || k === 'jev-latest') k = 'jev';
    if (['jev', 'chatgpt', 'claude', 'perplexity'].indexOf(k) === -1) return;
    if (seen[k]) return;
    seen[k] = true;
    out.push(k);
  });
  return out.length ? out : ['jev'];
}

async function measureWithJev(opts) {
  const state = {
    brand: opts.brand,
    page: {
      url: opts.pageUrl || null,
      title: opts.pageTitle || null,
      text: opts.pageText || '(no page text provided)'
    },
    prompts: opts.prompts
  };

  const questions = {};
  opts.prompts.forEach((p, i) => {
    questions['mentioned_' + i] = {
      type: 'noul',
      instructions:
        'Given `page` content and prompt `prompts[' + i + '].prompt`, would a careful AI answer likely mention the brand `' +
        opts.brand +
        '` by name?',
      criteria: {
        true: 'Brand name is likely mentioned in an answer to this prompt',
        false: 'Brand name is unlikely to be mentioned'
      }
    };
    questions['cited_' + i] = {
      type: 'noul',
      instructions:
        'Given `page` content and prompt `prompts[' + i + '].prompt`, would a careful AI answer likely cite or link the brand site (`page.url` or official domain) for `' +
        opts.brand +
        '`?',
      criteria: {
        true: 'Official URL / site is likely cited',
        false: 'Official URL / site is unlikely to be cited'
      }
    };
  });

  const tsRes = await fetch(TYPESAFE_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + opts.apiKey,
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
    throw new Error((payload && payload.error) || ('TypeSafe request failed (' + tsRes.status + ')'));
  }

  const answers = payload.answers || {};
  return opts.prompts.map((p, i) => {
    const mentioned = noulYes(answers['mentioned_' + i]);
    const cited = noulYes(answers['cited_' + i]);
    return {
      keyword: p.keyword || p.prompt,
      prompt: p.prompt,
      mentioned: mentioned ? 1 : 0,
      cited: cited ? 1 : 0,
      evidenceClass: 'Estimated',
      source: 'TypeSafe Jev',
      model: payload.model || 'jev-latest',
      confidence: {
        mentioned: noulProb(answers['mentioned_' + i]),
        cited: noulProb(answers['cited_' + i])
      }
    };
  });
}

async function measureWithProvider(engine, brand, prompts, pageUrl) {
  const keyMap = {
    chatgpt: process.env.OPENAI_API_KEY,
    claude: process.env.ANTHROPIC_API_KEY,
    perplexity: process.env.PERPLEXITY_API_KEY
  };
  const key = keyMap[engine];
  if (!key) {
    return {
      rows: [],
      status: {
        ok: false,
        error:
          engine.toUpperCase() +
          '_API_KEY is not configured on Vercel. Import HackⅡ JSON or enable the key.',
        code: 'engine_unavailable'
      }
    };
  }

  const rows = [];
  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    const answer = await callProvider(engine, key, p.prompt);
    const lower = String(answer || '').toLowerCase();
    const brandL = brand.toLowerCase();
    const mentioned = lower.indexOf(brandL) !== -1 ? 1 : 0;
    let cited = 0;
    if (pageUrl) {
      try {
        const host = new URL(pageUrl).hostname.replace(/^www\./, '').toLowerCase();
        if (host && lower.indexOf(host) !== -1) cited = 1;
      } catch (e) {}
    }
    rows.push({
      engine: engineLabel(engine),
      keyword: p.keyword || p.prompt,
      prompt: p.prompt,
      mentioned,
      cited,
      evidenceClass: 'Observed',
      source: engineLabel(engine) + ' API',
      answer_excerpt: String(answer || '').slice(0, 400)
    });
  }
  return { rows, status: { ok: true, count: rows.length, evidenceClass: 'Observed' } };
}

async function callProvider(engine, key, prompt) {
  const system =
    'You are answering a Japanese business search question. Be concise. Prefer factual sources when known.';
  if (engine === 'chatgpt') {
    const oai = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2
      })
    });
    const oaiData = await oai.json().catch(() => ({}));
    if (!oai.ok) throw new Error((oaiData && oaiData.error && oaiData.error.message) || 'OpenAI failed');
    return oaiData.choices && oaiData.choices[0] && oaiData.choices[0].message
      ? oaiData.choices[0].message.content
      : '';
  }
  if (engine === 'claude') {
    const ant = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest',
        max_tokens: 800,
        system,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const antData = await ant.json().catch(() => ({}));
    if (!ant.ok) throw new Error((antData && antData.error && antData.error.message) || 'Anthropic failed');
    const blocks = antData.content || [];
    return blocks.map((b) => b.text || '').join('\n');
  }
  if (engine === 'perplexity') {
    const pplx = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.PERPLEXITY_MODEL || 'sonar',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ]
      })
    });
    const pplxData = await pplx.json().catch(() => ({}));
    if (!pplx.ok) throw new Error((pplxData && pplxData.error && pplxData.error.message) || 'Perplexity failed');
    return pplxData.choices && pplxData.choices[0] && pplxData.choices[0].message
      ? pplxData.choices[0].message.content
      : '';
  }
  throw new Error('Unknown engine');
}

function engineLabel(engine) {
  if (engine === 'chatgpt') return 'ChatGPT';
  if (engine === 'claude') return 'Claude';
  if (engine === 'perplexity') return 'Perplexity';
  return engine;
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

async function fetchAllowedPage(targetUrl) {
  const parsed = new URL(targetUrl);
  if (!ALLOWED_HOSTS.has(parsed.hostname) && !parsed.hostname.endsWith('.vercel.app')) {
    throw new Error('URL host is not allowed for server-side fetch');
  }
  const pageRes = await fetch(targetUrl, {
    headers: { Accept: 'text/html', 'User-Agent': 'TrillionBank-Hack2Measure/1.0' },
    redirect: 'follow'
  });
  if (!pageRes.ok) throw new Error('Failed to fetch page (' + pageRes.status + ')');
  const html = await pageRes.text();
  return {
    text: htmlToText(html),
    title: extractTitle(html),
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
