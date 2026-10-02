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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AirReach-Key');
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
  // 実際の AI に聞く計測は費用がかかる。社内キー（Vercel の環境変数 AIRREACH_STUDIO_KEY、カンマ区切りで複数可）が
  // 設定されているときは、ヘッダー X-AirReach-Key が一致しない要求を断る。ブラウザからの要求は許可したサイトだけ受ける
  const origin = req.headers.origin || '';
  if (origin) {
    let oh = '';
    try { oh = new URL(origin).hostname; } catch (e) {}
    if (!isCorsHost(oh)) return json(res, 403, { error: 'origin not allowed', code: 'origin_not_allowed' });
  }
  if (!studioKeyOk(req)) {
    return json(res, 401, { error: '社内キーが必要です。Studio の右上「その他」→「社内キー」で設定してください。', code: 'studio_key_required' });
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
  // 競合（名前は必須・最大5件）。回答に競合の名前が出たか・競合のサイトが出典になったかも数える（SOV 用）
  const competitors = (Array.isArray(body.competitors) ? body.competitors : [])
    .map((c) => ({ name: String((c && c.name) || '').trim().slice(0, 80), url: String((c && c.url) || '').trim() }))
    .filter((c) => c.name.length >= 2)
    .slice(0, 5);
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

  await Promise.all(engines.map(async (engine) => {
    try {
      if (engine === 'jev') {
        const apiKey = process.env.TYPESAFE_API_KEY;
        if (!apiKey) {
          engineStatus.jev = { ok: false, error: 'TYPESAFE_API_KEY is not configured' };
          return;
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
        const live = await measureWithProvider(engine, brand, prompts, pageUrl, competitors);
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
  }));

  const judgments = [];
  engines.forEach((engine) => {
    if (engine === 'jev') {
      judgments.push({
        id: 'jev',
        label: 'Jev (Estimated)',
        thinking: 'ページ本文とプロンプトから言及・引用の可能性を判定しています'
      });
      prompts.forEach((p, i) => {
        judgments.push({
          id: 'jev-prompt-' + i,
          label: 'Jev · ' + truncate(p.prompt, 40),
          thinking: '言及・引用の有無を推定しています'
        });
      });
    } else {
      judgments.push({
        id: engine,
        label: engineLabel(engine),
        thinking: 'API接続して回答を取得・解析しています'
      });
    }
  });

  return json(res, 200, {
    ok: rows.length > 0,
    brand,
    url: pageUrl,
    competitors: competitors.map((c) => c.name),
    engines,
    engineStatus,
    judgments,
    model: engines.indexOf('jev') >= 0 ? 'jev-latest' : (engines[0] || null),
    rows,
    note:
      'Jev results are Estimated proxy judgments from page text + prompt, not live AI-search captures. ' +
      'ChatGPT (gpt-4o-mini, no web search) is measured for mentions only; cited is null. ' +
      'Claude answers with web search; cited = the official host is in the returned citation URLs. ' +
      'Perplexity citation URLs are not returned through the gateway, so cited is judged only from the answer text (null when not found).',
    fetchNote: fetchNote
  });
}

export function studioKeyOk(req, env = process.env) {
  const keys = String(env.AIRREACH_STUDIO_KEY || '').split(',').map((k) => k.trim()).filter(Boolean);
  if (!keys.length) return true; // 未設定のあいだは従来どおり（設定した時点から有効）
  const got = String((req.headers && (req.headers['x-airreach-key'] || req.headers['X-AirReach-Key'])) || '').trim();
  return !!got && keys.indexOf(got) !== -1;
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

function hostOf(u) {
  try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; }
}
// 1つの回答について、各競合の名前が出たか・競合サイトが出典になったか
// 名前の照合は空白（全角を含む）を無視する（「総本家 更科堀井」と回答の「総本家更科堀井」を同じとみなす）
export function nameIn(text, name) {
  const t = String(text || '').toLowerCase().replace(/[\s\u3000]+/g, '');
  const n = String(name || '').toLowerCase().replace(/[\s\u3000]+/g, '');
  return !!n && t.indexOf(n) !== -1;
}
export function competitorHits(answer, citations, competitors) {
  const lower = String(answer || '').toLowerCase();
  return (competitors || []).map((c) => {
    const host = hostOf(c.url);
    let cited = null;
    if (host) {
      if (Array.isArray(citations)) cited = citations.some((u) => hostMatches(u, host)) ? 1 : 0;
      else cited = lower.indexOf(host) !== -1 ? 1 : null;
    }
    return { name: c.name, mentioned: nameIn(answer, c.name) ? 1 : 0, cited };
  });
}

async function measureWithProvider(engine, brand, prompts, pageUrl, competitors) {
  const gatewayKey = process.env.AI_GATEWAY_API_KEY || '';
  const keyMap = {
    chatgpt: process.env.OPENAI_API_KEY,
    claude: process.env.ANTHROPIC_API_KEY,
    perplexity: process.env.PERPLEXITY_API_KEY
  };
  const directKey = keyMap[engine];
  const useGateway = !!gatewayKey && (engine === 'chatgpt' || engine === 'claude' || engine === 'perplexity');
  if (!useGateway && !directKey) {
    return {
      rows: [],
      status: {
        ok: false,
        error:
          'AI_GATEWAY_API_KEY (or provider key) is not configured on Vercel for ' +
          engine +
          '. Jev uses TYPESAFE_API_KEY separately.',
        code: 'engine_unavailable'
      }
    };
  }

  let host = '';
  if (pageUrl) {
    try { host = new URL(pageUrl).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) {}
  }
  // 検索つき（Responses API）は Claude だけ。ChatGPT は費用を抑えるため検索なしで言及率だけを測る（引用は判定しない）。
  // Perplexity は出典URLが gateway から返らないため本文で判定
  const withSearch = useGateway && engine === 'claude';
  const mentionOnly = engine === 'chatgpt';

  const rows = await Promise.all(prompts.map(async (p) => {
    let out;
    if (withSearch) out = await callResponsesWithSearch(gatewayModel(engine), gatewayKey, p.prompt);
    else out = { answer: useGateway ? await callViaGateway(engine, gatewayKey, p.prompt) : await callProvider(engine, directKey, p.prompt), citations: null, searched: engine === 'perplexity' };
    if (mentionOnly) {
      return {
        engine: engineLabel(engine),
        keyword: p.keyword || p.prompt,
        prompt: p.prompt,
        mentioned: nameIn(out.answer, brand) ? 1 : 0,
        cited: null,
        citeMethod: 'none',
        searched: false,
        citations: [],
        competitors: competitorHits(out.answer, null, competitors).map((h) => ({ name: h.name, mentioned: h.mentioned, cited: null })),
        evidenceClass: 'Observed',
        model: useGateway ? gatewayModel(engine) : engine,
        source: useGateway ? 'Vercel AI Gateway / ' + engineLabel(engine) : engineLabel(engine) + ' API',
        answer_excerpt: String(out.answer || '').slice(0, 400)
      };
    }
    const lower = String(out.answer || '').toLowerCase();
    const mentioned = nameIn(out.answer, brand) ? 1 : 0;
    let cited = 0;
    let citeMethod = 'citations';
    if (Array.isArray(out.citations)) {
      cited = host && out.citations.some((u) => hostMatches(u, host)) ? 1 : 0;
    } else {
      // 出典URLの一覧が無い: 本文にドメインがあれば引用ありとし、無ければ判定できない（0 にしない）
      citeMethod = 'text';
      cited = host && lower.indexOf(host) !== -1 ? 1 : null;
    }
    return {
      engine: engineLabel(engine),
      keyword: p.keyword || p.prompt,
      prompt: p.prompt,
      mentioned,
      cited,
      citeMethod,
      searched: !!out.searched,
      citations: Array.isArray(out.citations) ? out.citations.slice(0, 10) : [],
      competitors: competitorHits(out.answer, out.citations, competitors),
      evidenceClass: 'Observed',
      model: useGateway ? gatewayModel(engine) : engine,
      source: useGateway ? 'Vercel AI Gateway / ' + engineLabel(engine) : engineLabel(engine) + ' API',
      answer_excerpt: String(out.answer || '').slice(0, 400)
    };
  }));
  return {
    rows,
    status: {
      ok: true,
      count: rows.length,
      evidenceClass: 'Observed',
      search: withSearch || engine === 'perplexity',
      citeMethod: mentionOnly ? 'none' : (withSearch ? 'citations' : 'text'),
      model: useGateway ? gatewayModel(engine) : engine,
      via: useGateway ? 'ai-gateway' : 'direct'
    }
  };
}

function hostMatches(url, host) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return h === host || h.endsWith('.' + host);
  } catch (e) {
    return false;
  }
}

/** Responses API（Web検索つき）。引用は output_text の url_citation から取る */
async function callResponsesWithSearch(model, key, prompt) {
  const res = await fetch('https://ai-gateway.vercel.sh/v1/responses', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: prompt,
      tools: [{ type: 'web_search', user_location: { type: 'approximate', country: 'JP' } }],
      // 費用を抑える: 検索は1回まで・推論は少なめ（2026-09-30 実測 gpt-5-mini: 制限なし 0.04〜0.085ドル/回答・3〜7回検索 → 制限あり 約0.015ドル/回答、引用URLは8〜12件返る）
      max_tool_calls: 1,
      reasoning: /^openai\//.test(model) ? { effort: 'low' } : undefined,
      store: false
    }),
    signal: AbortSignal.timeout(120000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(gatewayError(res.status, data, model));
  let answer = '';
  const citations = [];
  let searched = false;
  for (const o of data.output || []) {
    if (o.type === 'web_search_call') searched = true;
    if (o.type !== 'message') continue;
    for (const c of o.content || []) {
      if (c.type !== 'output_text') continue;
      answer += c.text || '';
      for (const a of c.annotations || []) {
        if (a.type === 'url_citation' && a.url && citations.indexOf(a.url) < 0) citations.push(a.url);
      }
    }
  }
  return { answer, citations, searched };
}

function gatewayError(status, data, model) {
  const msg = (data && data.error && (data.error.message || data.error)) || '';
  if (status === 403 && /free tier/i.test(String(msg))) {
    return model + ' は Vercel AI Gateway の無料枠では使えません（有料クレジットが必要）';
  }
  if (/not found/i.test(String(msg))) return model + ' が見つかりません（モデル名を確認）';
  return String(msg || ('AI Gateway failed (' + status + ')')).slice(0, 200);
}

function gatewayModel(engine) {
  // ChatGPT は検索なしの言及率だけ（1回答 約0.0002ドル・2026-09-30 実測）
  if (engine === 'chatgpt') return process.env.AIRREACH_OPENAI_MODEL || 'openai/gpt-4o-mini';
  if (engine === 'claude') return process.env.AIRREACH_CLAUDE_MODEL || 'anthropic/claude-haiku-4.5';
  if (engine === 'perplexity') return process.env.AIRREACH_PERPLEXITY_MODEL || 'perplexity/sonar';
  return null;
}

async function callViaGateway(engine, key, prompt) {
  const model = gatewayModel(engine);
  if (!model) throw new Error('Unknown engine for AI Gateway');
  const system =
    'You are answering a Japanese business search question. Be concise. Prefer factual sources when known.';
  const res = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(gatewayError(res.status, data, model));
  return data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : '';
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
        model: process.env.AIRREACH_OPENAI_MODEL || 'gpt-4o-mini',
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
        model: process.env.AIRREACH_CLAUDE_MODEL || 'claude-haiku-4-5',
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
        model: process.env.AIRREACH_PERPLEXITY_MODEL || 'sonar',
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
