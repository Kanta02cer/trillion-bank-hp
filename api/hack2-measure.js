/**
 * HackⅡ Studio measurement helper (TypeSafe Jev + optional provider keys).
 * Keys live only in Vercel env — never commit them.
 *
 * POST /api/hack2-measure/
 */
const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';
const MAX_CHARS = 10000;
// 1回の要求で受ける質問の数。Studio は10問を5問ずつに分けて送る（関数の制限時間と AI の回数の上限に収めるため）
const MAX_PROMPTS = 10;

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AirReach-Key, Authorization');
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
  // 社内の人は、AirReach のダッシュボードにログインしていればキーなしで使える（Authorization: Bearer <ログインのトークン>）。
  // そうでなければ社内キーで判定する
  if (!(await staffTokenOk(req)) && !studioKeyOk(req)) {
    return json(res, 401, { error: 'AirReach のダッシュボード（/airreach/app/）に社内の人としてログインしてから、もう一度押してください。', code: 'staff_login_required' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' });
  }

  const brand = String(body.brand || '').trim();
  if (!brand) return json(res, 400, { error: 'brand is required' });

  // 外部の AI に送ってよい質問か（確定済み・Search Console 由来でない）。1問でも違えば、どの AI にも聞かない
  const policy = promptPolicyError(body.prompts);
  if (policy) return json(res, 400, policy);

  const prompts = normalizePrompts(body.prompts);
  if (!prompts.length) {
    return json(res, 400, { error: 'prompts[] with prompt text is required (max ' + MAX_PROMPTS + ')' });
  }

  const engines = normalizeEngines(body.engines);
  // 地域（任意）。SerpApi の地域名（例: Shibuya,Tokyo,Japan）。形が違えば計測しない（黙って日本全体に変えない）
  const location = normalizeLocation(body.location);
  if (location === false) return json(res, 400, { error: 'location must look like "City,Prefecture,Japan" (letters, spaces, commas; max 80)' });
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

  const measured = await measureEngines({ brand, prompts, engines, competitors, pageText, pageUrl, pageTitle, date, location });
  measured.rows.forEach((r) => rows.push(r));
  Object.assign(engineStatus, measured.engineStatus);

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
      'mentioned = the brand name appears in the answer. cited_by_sources = the official host is in the source URLs the AI returned (null when no source list). ' +
      'self_url_in_text = the official host is in URLs written in the answer text (null when the answer has no URL). cited uses sources first, then answer text; null is never counted as 0. ' +
      'status: ok / not_shown (no AI answer on the results page) / error. ChatGPT without search measures mentions only.',
    fetchNote: fetchNote
  });
}

/**
 * 計測の本体（Studio の計測 API と定期計測の両方から使う）。AI ごとに並べて聞き、行と AI ごとの状態を返す
 *   prompts: [{ keyword, prompt }] / engines: normalizeEngines 済み / competitors: [{ name, url }]
 */
export async function measureEngines({ brand, prompts, engines, competitors, pageText = '', pageUrl = null, pageTitle = null, date = new Date().toISOString().slice(0, 10), location = null }) {
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
        const live = await measureWithProvider(engine, brand, prompts, pageUrl, competitors, { location });
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

  return { rows, engineStatus };
}
export { normalizeEngines, normalizePrompts };

// ログインのトークンが AirReach の社内メンバーのものかを、その人のトークンで airreach_me を呼んで確かめる。
// トークンの署名と期限は Supabase（PostgREST）が検証する。同じトークンの結果は5分だけ覚える
const staffCache = new Map();
export async function staffTokenOk(req, env = process.env, fetchImpl = globalThis.fetch) {
  const h = String((req.headers && (req.headers.authorization || req.headers.Authorization)) || '');
  const m = /^Bearer\s+([A-Za-z0-9._-]{20,4096})$/.exec(h.trim());
  if (!m) return false;
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const anon = String(env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !anon) return false;
  const token = m[1];
  const hit = staffCache.get(token);
  if (hit && hit.until > Date.now()) return hit.ok;
  let ok = false;
  try {
    const r = await fetchImpl(url + '/rest/v1/rpc/airreach_me', {
      method: 'POST',
      headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5000)
    });
    if (r.ok) { const me = await r.json(); ok = !!(me && me.is_staff === true); }
  } catch (e) { ok = false; }
  if (staffCache.size > 500) staffCache.clear();
  staffCache.set(token, { ok, until: Date.now() + 5 * 60 * 1000 });
  return ok;
}

// 上限つきで並べて実行する（順番は入力どおり）
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// 回数の上限（rate limit・429）に当たったら、案内された秒数（無ければ15秒）待って最大3回聞き直す。期限を越えるなら諦める
export function rateLimitWait(err) {
  const m = String((err && err.message) || err || '');
  if (!/rate limit|too many requests|\b429\b/i.test(m)) return null;
  const s = /retry after\s+(\d+)\s*s/i.exec(m);
  return Math.min(60, (s ? Number(s[1]) : 15) + 1) * 1000;
}
export async function withRateRetry(fn, deadline, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (e) {
      const wait = rateLimitWait(e);
      if (wait == null || attempt >= 3 || Date.now() + wait > deadline) throw e;
      await sleep(wait);
    }
  }
}

export function studioKeyOk(req, env = process.env) {
  const keys = String(env.AIRREACH_STUDIO_KEY || '').split(',').map((k) => k.trim()).filter(Boolean);
  if (!keys.length) return true; // 未設定のあいだは従来どおり（設定した時点から有効）
  const got = String((req.headers && (req.headers['x-airreach-key'] || req.headers['X-AirReach-Key'])) || '').trim();
  return !!got && keys.indexOf(got) !== -1;
}

/**
 * 外部の AI に送る質問の決まり（Google OAuth の審査・Google API Services User Data Policy の Limited Use 対応）。
 *   - 送れるのは、お客様または担当者が確定した質問（confirmed: true）だけ
 *   - Search Console のデータから作った質問（origin / src が gsc、google: true）は送らない
 *   文字列だけの質問（確定の印が無い）も断る。定期計測（schedule-run）は担当者が保存した設定の質問を使うため、ここを通らない
 * 戻り値: 断るときは { error, code }、よければ null
 */
export function promptPolicyError(raw) {
  if (!Array.isArray(raw)) return null;
  for (const p of raw) {
    if (!p || typeof p !== 'object') {
      return { error: '確定していない質問は外部の AI に送れません。Studio で質問を確かめて「確定」してください。', code: 'prompt_not_confirmed' };
    }
    const origin = String(p.origin || p.src || '').toLowerCase();
    if (p.google === true || origin === 'gsc' || origin === 'google') {
      return { error: 'Search Console のデータから作った質問は外部の AI に送れません。', code: 'google_data_not_allowed' };
    }
    if (p.confirmed !== true) {
      return { error: '確定していない質問は外部の AI に送れません。Studio で質問を確かめて「確定」してください。', code: 'prompt_not_confirmed' };
    }
  }
  return null;
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
    // 同じ質問（空白・大文字小文字の違いだけ）は1回だけ聞く（費用と集計の二重計上を防ぐ）
    .filter((p, i, a) => a.findIndex((q) => q.prompt.replace(/\s+/g, '').toLowerCase() === p.prompt.replace(/\s+/g, '').toLowerCase()) === i)
    .slice(0, MAX_PROMPTS);
}

function normalizeEngines(raw) {
  const list = Array.isArray(raw) && raw.length ? raw : ['jev'];
  const out = [];
  const seen = {};
  list.forEach((e) => {
    let k = String(e || '').toLowerCase().trim();
    if (k === 'gpt' || k === 'openai') k = 'chatgpt';
    if (k === 'chatgpt-search' || k === 'openai_search' || k === 'chatgpt_web') k = 'chatgpt_search';
    if (k === 'anthropic') k = 'claude';
    if (k === 'pplx' || k === 'sonar') k = 'perplexity';
    if (k === 'typesafe' || k === 'jev-latest') k = 'jev';
    if (k === 'google') k = 'gemini';
    if (k === 'aio' || k === 'ai_overview' || k === 'ai_overviews') k = 'google_aio';
    if (k === 'ai_mode' || k === 'aimode') k = 'google_ai_mode';
    if (['jev', 'chatgpt', 'chatgpt_search', 'claude', 'perplexity', 'gemini', 'google_aio', 'google_ai_mode'].indexOf(k) === -1) return;
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
// 回答の中で名前が出てきた順番（自社と競合）。言及の順位に使う。名前は空白を無視して探す
export function mentionOrder(answer, brand, competitors) {
  const t = String(answer || '').toLowerCase().replace(/[\s\u3000]+/g, '');
  const pos = (name) => { const n = String(name || '').toLowerCase().replace(/[\s\u3000]+/g, ''); return n ? t.indexOf(n) : -1; };
  const all = [{ name: String(brand || ''), self: true, at: pos(brand) }]
    .concat((competitors || []).map((c) => ({ name: String(c.name || ''), self: false, at: pos(c.name) })))
    .filter((x) => x.name && x.at >= 0)
    .sort((a, b) => a.at - b.at);
  const selfIdx = all.findIndex((x) => x.self);
  return { order: all.map((x) => x.name).slice(0, 12), self_rank: selfIdx >= 0 ? selfIdx + 1 : null };
}
// 回答の本文に書かれた URL（出典の一覧が返らない AI のための参考）
export function urlsInAnswer(answer) {
  const out = [];
  String(answer || '').replace(/https?:\/\/[^\s)\]>"'、。）」]+/g, (u) => { if (out.indexOf(u) < 0 && out.length < 20) out.push(u.replace(/[.,;:]+$/, '')); return u; });
  return out;
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

/**
 * 1つの回答の判定。次の3つを分けて記録する（混ぜない）
 *   - mentioned：回答の本文に社名が出たか（社名への言及）
 *   - cited_by_sources：AI が返した出典の一覧に自社サイトがあるか（出典の一覧が返らなければ null）
 *   - self_url_in_text：回答の本文に書かれた URL・ドメインに自社サイトがあるか（本文に URL が1つも無ければ null）
 * cited（引用率に使う値）は、出典の一覧があればそれで、無ければ本文の URL で決める。どちらでも判定できなければ null（0 にしない）。
 * shown=false（Google の AI による概要が検索結果に出なかった など）は、回答そのものが無いので status='not_shown'・すべて null
 */
export function judgeAnswer({ answer, citations, shown, brand, host, competitors, searched }) {
  const comps = competitors || [];
  if (shown === false) {
    return { status: 'not_shown', mentioned: null, cited: null, cite_source: 'not_shown', citeMethod: 'none', cited_by_sources: null, self_url_in_text: null,
      sources_available: false, searched: !!searched, citations: [], urls_in_answer: [], competitors: comps.map((c) => ({ name: c.name, mentioned: null, cited: null })), order: [], self_rank: null };
  }
  const text = String(answer || '');
  const lower = text.toLowerCase();
  const sources = Array.isArray(citations) && citations.length ? citations.slice(0, 20) : null;
  const inText = urlsInAnswer(text);
  const bySources = sources && host ? (sources.some((u) => hostMatches(u, host)) ? 1 : 0) : null;
  // 本文：自社のドメインがあれば 1。ほかのサイトの URL だけが並んでいれば 0。URL が無ければ判定できない（null）
  const selfInText = host ? (lower.indexOf(host) !== -1 ? 1 : (inText.length ? 0 : null)) : null;
  let cited = null, source = 'none';
  if (bySources !== null) { cited = bySources; source = 'ai_sources'; }
  else if (selfInText !== null) { cited = selfInText; source = 'answer_text'; }
  return {
    status: 'ok',
    mentioned: nameIn(text, brand) ? 1 : 0,
    cited,
    cite_source: source,
    citeMethod: source === 'ai_sources' ? 'citations' : (source === 'answer_text' ? 'text' : 'none'),
    cited_by_sources: bySources,
    self_url_in_text: selfInText,
    sources_available: !!sources,
    searched: !!searched,
    citations: sources || [],
    urls_in_answer: inText,
    competitors: competitorHits(text, sources, comps),
    ...mentionOrder(text, brand, comps)
  };
}

async function measureWithProvider(engine, brand, prompts, pageUrl, competitors, opts = {}) {
  const location = opts.location || null;
  const gatewayKey = process.env.AI_GATEWAY_API_KEY || '';
  const keyMap = {
    chatgpt: process.env.OPENAI_API_KEY,
    // ChatGPT（検索あり）：OpenAI の Responses API の web_search。出典（url_citation）が返る
    chatgpt_search: process.env.OPENAI_API_KEY,
    claude: process.env.ANTHROPIC_API_KEY,
    perplexity: process.env.PERPLEXITY_API_KEY,
    // Gemini は Google の Gemini API を直接使う（Google 検索で調べてから答え、出典を返す）。AI Gateway は使わない
    gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    // Google の AI による概要・AI モードは SerpApi で検索結果の画面を取る（Google に公式の API が無いため）
    google_aio: process.env.SERPAPI_API_KEY || process.env.SERPAPI_KEY,
    google_ai_mode: process.env.SERPAPI_API_KEY || process.env.SERPAPI_KEY
  };
  const directKey = keyMap[engine];
  // 出典が返る直接の API（Perplexity・Claude の検索・ChatGPT の検索）は、キーがあれば AI Gateway より優先する。
  // AI Gateway は Perplexity の出典を渡さない（2026-10-03 実測）
  const preferDirect = !!directKey && (engine === 'perplexity' || engine === 'claude' || engine === 'chatgpt_search');
  const useGateway = !!gatewayKey && !preferDirect && ['chatgpt', 'chatgpt_search', 'claude', 'perplexity'].indexOf(engine) >= 0;
  if ((engine === 'google_aio' || engine === 'google_ai_mode') && !directKey) {
    return { rows: [], status: { ok: false, error: 'Google の AI の計測に使う API キーがまだ設定されていません（社内の設定が必要です）', engine } };
  }
  if (engine === 'gemini' && !directKey) {
    return { rows: [], status: { ok: false, error: 'Gemini の API キー（GEMINI_API_KEY）がまだ設定されていません', engine } };
  }
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
  // 検索つき（AI Gateway の Responses API）は Claude と ChatGPT（検索あり）。ChatGPT（検索なし）は費用を抑えて言及だけを測る（引用は判定しない）。
  // Perplexity は直接の API なら出典の一覧、AI Gateway なら本文で判定
  const withSearch = useGateway && (engine === 'claude' || engine === 'chatgpt_search');
  const mentionOnly = engine === 'chatgpt';
  const measuredAt = new Date().toISOString();
  const conditions = { engine, model: useGateway ? gatewayModel(engine) : directModel(engine), via: useGateway ? 'ai-gateway' : 'direct', search: mentionOnly ? false : true, location: location || 'JP' };

  // Gateway の無料枠は1分あたりの回数に上限がある（Perplexity は5回/分）。同時に2問までにし、
  // 上限に当たったら返ってきた待ち時間だけ待って聞き直す（関数の制限時間に収まる範囲で）
  // Gemini は遅いと他の AI の結果まで待たせる（Studio は全部の AI を1回の要求で聞く）。Gemini だけ持ち時間を短くし、超えたら失敗として先に返す
  const deadline = Date.now() + (ENGINE_BUDGET_MS[engine] || 240000);
  const rows = await mapLimit(prompts, 2, async (p) => {
    const base = { engine: engineLabel(engine), keyword: p.keyword || p.prompt, prompt: p.prompt, evidenceClass: 'Observed',
      model: conditions.model, source: useGateway ? 'Vercel AI Gateway / ' + engineLabel(engine) : engineLabel(engine) + ' API', measured_at: measuredAt, conditions };
    let out;
    try {
      if (withSearch) out = await withRateRetry(() => callResponsesWithSearch(gatewayModel(engine), gatewayKey, p.prompt, location), deadline);
      else {
        let got = null;
        if (useGateway && engine === 'perplexity') {
          try { got = await withRateRetry(() => callPerplexityResponses(gatewayModel(engine), gatewayKey, p.prompt), deadline); }
          catch (e) { if (/rate limit|回数の上限|429/i.test(String((e && e.message) || e))) throw e; got = null; }
          if (got && !got.answer) got = null;
        }
        if (!got) got = await withRateRetry(() => (useGateway ? callViaGateway(engine, gatewayKey, p.prompt) : callProvider(engine, directKey, p.prompt, location)), deadline);
        out = got && typeof got === 'object'
          ? { answer: got.answer, citations: got.citations, searched: got.searched != null ? got.searched : engine === 'perplexity', fields: got.fields, shown: got.shown, location_used: got.location_used || null, model_used: got.model_used || null }
          : { answer: got, citations: null, searched: engine === 'perplexity' };
      }
    } catch (err) {
      // この質問だけ失敗（回数の上限・タイムアウトなど）。言及も引用も判定できないので null。集計では「エラー」として別に数える
      return Object.assign(base, { status: 'error', error: String((err && err.message) || err || 'failed').slice(0, 300), error_type: errorType(err), mentioned: null, cited: null, cite_source: 'error', citeMethod: 'none',
        cited_by_sources: null, self_url_in_text: null, sources_available: false, searched: false, citations: [], urls_in_answer: [],
        competitors: (competitors || []).map((c) => ({ name: c.name, mentioned: null, cited: null })), order: [], self_rank: null, answer_excerpt: '' });
    }
    if (mentionOnly) {
      return Object.assign(base, {
        status: 'ok',
        mentioned: nameIn(out.answer, brand) ? 1 : 0,
        cited: null,
        cite_source: 'not_measured',
        citeMethod: 'none',
        cited_by_sources: null,
        self_url_in_text: null,
        sources_available: false,
        searched: false,
        citations: [],
        urls_in_answer: urlsInAnswer(out.answer),
        competitors: competitorHits(out.answer, null, competitors).map((h) => ({ name: h.name, mentioned: h.mentioned, cited: null })),
        ...mentionOrder(out.answer, brand, competitors),
        answer_excerpt: String(out.answer || '').slice(0, 400),
        answer_text: String(out.answer || '').slice(0, 4000)
      });
    }
    // 検索ありの ChatGPT で、検索が実際に走らなかった回答は「検索あり」の結果に入れない（失敗として別に数える）
    if (engine === 'chatgpt_search' && !out.searched) {
      return Object.assign(base, { status: 'error', error: 'ChatGPT が Web 検索をしないで答えました（検索ありの結果に入れません）', error_type: 'search_not_run', search_ran: false, mentioned: null, cited: null, cite_source: 'error', citeMethod: 'none',
        cited_by_sources: null, self_url_in_text: null, sources_available: false, searched: false, citations: [], urls_in_answer: [],
        competitors: (competitors || []).map((c) => ({ name: c.name, mentioned: null, cited: null })), order: [], self_rank: null, answer_excerpt: String(out.answer || '').slice(0, 400), answer_text: String(out.answer || '').slice(0, 4000) });
    }
    const j = judgeAnswer({ answer: out.answer, citations: out.citations, shown: out.shown, brand, host, competitors, searched: out.searched });
    // 案内に従って別のモデルで答えたときは、その行のモデルと条件を実際のものにする（条件の違う結果を混ぜないため）
    if (out.model_used && out.model_used !== base.model) Object.assign(base, { model: out.model_used, conditions: Object.assign({}, conditions, { model: out.model_used }) });
    return Object.assign(base, j, {
      search_ran: !!out.searched,
      location_used: out.location_used || null,
      answer_excerpt: String(out.answer || '').slice(0, 400),
      // 根拠の確認用に、回答の本文を残す（長すぎる分は切る）
      answer_text: String(out.answer || '').slice(0, 4000),
      citation_fields: out.fields || null,
      ai_shown: out.shown == null ? null : !!out.shown
    });
  });
  const okN = rows.filter((r) => r.status === 'ok').length;
  const errRows = rows.filter((r) => r.status === 'error');
  if (!okN && errRows.length && !rows.some((r) => r.status === 'not_shown')) {
    return { rows, status: { ok: false, error: errRows[0].error, errors: errRows.length, count: rows.length, engine } };
  }
  return {
    rows,
    status: {
      ok: true,
      count: rows.length,
      answered: okN,
      not_shown: rows.filter((r) => r.status === 'not_shown').length,
      errors: errRows.length,
      error: errRows.length ? errRows[0].error : undefined,
      evidenceClass: 'Observed',
      search: !mentionOnly,
      citeMethod: mentionOnly ? 'none' : (rows.some((r) => r.cite_source === 'ai_sources') ? 'citations' : 'text'),
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
async function callResponsesWithSearch(model, key, prompt, location) {
  const res = await fetch('https://ai-gateway.vercel.sh/v1/responses', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: prompt,
      tools: [{ type: 'web_search', user_location: userLocation(location) }],
      // 費用を抑える: 検索は1回まで・推論は少なめ（2026-09-30 実測 gpt-5-mini: 制限なし 0.04〜0.085ドル/回答・3〜7回検索 → 制限あり 約0.015ドル/回答、引用URLは8〜12件返る）
      max_tool_calls: 1,
      reasoning: /^openai\//.test(model) ? { effort: 'low' } : undefined,
      store: false
    }),
    signal: AbortSignal.timeout(120000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(gatewayError(res.status, data, model));
  return parseSearchResponses(data);
}
/** Responses API（web_search つき）の応答：本文と、本文に付いた出典（url_citation）。検索したか（web_search_call）も返す */
export function parseSearchResponses(data) {
  let answer = '';
  const citations = [];
  let searched = false;
  for (const o of (data && data.output) || []) {
    if (o.type === 'web_search_call') searched = true;
    if (o.type !== 'message') continue;
    for (const c of o.content || []) {
      if (c.type !== 'output_text') continue;
      answer += c.text || '';
      for (const a of c.annotations || []) {
        const u = a && (a.url || (a.url_citation && a.url_citation.url));
        if (a && a.type === 'url_citation' && u && citations.indexOf(u) < 0) citations.push(u);
      }
    }
  }
  // 出典が1つも無いときは null（「引用なし」と決めつけず、本文で判定する）
  return { answer, citations: citations.length ? citations.slice(0, 20) : null, searched, fields: ['responses', 'web_search'] };
}

/**
 * Perplexity を AI Gateway の Responses API で聞く。chat/completions では出典の一覧が返らない（2026-10-03 実測：citation_fields が空）。
 * Responses API の出典は output[].content[].annotations の url_citation で返る（Claude の検索と同じ形）。
 * 出典の項目が1つも無いときは citations を null にして、本文での判定に回す
 */
export async function callPerplexityResponses(model, key, prompt) {
  const res = await fetch('https://ai-gateway.vercel.sh/v1/responses', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: prompt, store: false }),
    signal: AbortSignal.timeout(120000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(gatewayError(res.status, data, model));
  return parseResponsesOutput(data);
}
export function parseResponsesOutput(data) {
  let answer = '';
  const citations = [];
  let sawAnnotations = false;
  for (const o of (data && data.output) || []) {
    if (o.type !== 'message') continue;
    for (const c of o.content || []) {
      if (c.type !== 'output_text') continue;
      answer += c.text || '';
      if (Array.isArray(c.annotations)) sawAnnotations = true;
      for (const a of c.annotations || []) {
        const u = a && (a.url || (a.url_citation && a.url_citation.url));
        if (a && a.type === 'url_citation' && u && citations.indexOf(u) < 0) citations.push(u);
      }
    }
  }
  // 上位にまとめて返る形（sources・citations）にも備える
  const extra = gatewayCitations(data);
  extra.urls && extra.urls.forEach((u) => { if (citations.indexOf(u) < 0) citations.push(u); });
  // 空の一覧は「出典なし」ではなく「渡されていない」とみる（Perplexity は必ず検索する。AI Gateway は出典を渡さないことがある：2026-10-03 実測）。
  // 0% と記録すると実際より悪く見えるので、URL が1つも無ければ null（本文で判定）にする
  return { answer, citations: citations.length ? citations.slice(0, 20) : null, fields: ['responses'].concat(sawAnnotations ? ['annotations'] : [], extra.fields) };
}

function gatewayError(status, data, model) {
  const msg = (data && data.error && (data.error.message || data.error)) || '';
  if (status === 403 && /free tier/i.test(String(msg))) {
    return model + ' は今の設定では使えません（社内の設定が必要です）';
  }
  if (/not found/i.test(String(msg))) return model + ' が見つかりません（モデル名を確認）';
  if (status === 429 || /rate limit/i.test(String(msg))) {
    const sec = (/retry after (\d+)s/i.exec(String(msg)) || [])[1];
    // 末尾の英語は自動で待って聞き直すための目印（rateLimitWait が読む）。消さない
    return model.split('/')[0] + ' の回数の上限（1分あたりの回数）に当たりました。' + (sec ? sec + '秒ほど' : '1〜2分') + 'あけて、もう一度計測してください（続けて押すと上限に当たります）' + ' [rate limit' + (sec ? '; retry after ' + sec + 's' : '') + ']';
  }
  return String(msg || ('AI Gateway failed (' + status + ')')).slice(0, 200);
}

function directModel(engine) {
  if (engine === 'chatgpt') return process.env.AIRREACH_OPENAI_MODEL || 'gpt-4o-mini';
  if (engine === 'chatgpt_search') return process.env.AIRREACH_OPENAI_SEARCH_MODEL_DIRECT || 'gpt-5-mini';
  if (engine === 'claude') return process.env.AIRREACH_CLAUDE_MODEL || 'claude-haiku-4-5';
  if (engine === 'perplexity') return process.env.AIRREACH_PERPLEXITY_MODEL || 'sonar';
  if (engine === 'gemini') return process.env.AIRREACH_GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
  if (engine === 'google_aio') return 'serpapi/google_ai_overview';
  if (engine === 'google_ai_mode') return 'serpapi/google_ai_mode';
  return engine;
}

function gatewayModel(engine) {
  // ChatGPT は検索なしの言及率だけ（1回答 約0.0002ドル・2026-09-30 実測）
  if (engine === 'chatgpt') return process.env.AIRREACH_OPENAI_MODEL || 'openai/gpt-4o-mini';
  // ChatGPT（検索あり）: 2026-09-30 実測 gpt-5-mini・検索1回まで 約0.015ドル/回答、引用URLは8〜12件
  if (engine === 'chatgpt_search') return process.env.AIRREACH_OPENAI_SEARCH_MODEL || 'openai/gpt-5-mini';
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
  const msg = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message : {};
  const cites = gatewayCitations(data);
  return { answer: msg.content || '', citations: cites.urls, fields: cites.fields };
}

/**
 * AI Gateway（OpenAI 互換）の応答から、AI が参照した URL（出典）を取り出す。
 * 検索する AI（Perplexity など）は、出典を次のどこかで返す：data.citations / data.search_results / message.annotations（url_citation）/ message.citations / choices[0].citations。
 * どこにも無ければ urls は null（出典の一覧が無い＝本文での判定にする）。項目はあるが空なら []（出典なし）。
 * fields は、どの項目が返ってきたかの名前だけ（中身は含めない。返り方の確認用）
 */
export function gatewayCitations(data) {
  const d = data || {};
  const ch = (d.choices && d.choices[0]) || {};
  const msg = ch.message || {};
  const srcs = [['citations', d.citations], ['search_results', d.search_results], ['annotations', msg.annotations], ['message.citations', msg.citations], ['choice.citations', ch.citations], ['sources', d.sources]];
  const fields = [];
  let found = false;
  const urls = [];
  const pick = (x) => {
    if (!x) return '';
    if (typeof x === 'string') return x;
    if (x.url) return x.url;
    if (x.url_citation && x.url_citation.url) return x.url_citation.url;
    if (x.source && x.source.url) return x.source.url;
    return '';
  };
  srcs.forEach(([name, v]) => {
    if (!Array.isArray(v)) return;
    fields.push(name);
    found = true;
    v.forEach((x) => { const u = pick(x); if (/^https?:\/\//i.test(u) && urls.indexOf(u) < 0) urls.push(u); });
  });
  return { urls: found ? urls.slice(0, 20) : null, fields };
}

/**
 * Gemini（Google の Gemini API・Google 検索で調べてから答える）。出典は groundingMetadata.groundingChunks[].web。
 * uri は Google の転送用 URL のことが多いので、title がドメインならそれを、違えば転送先（Location）を読んで実際の URL にする
 */
// 2026-10-07 実測：gemini-2.5-flash は「新しい利用者には使えない」と断られた（Google の案内は gemini-3.8-flash）。
// 変えるときは Vercel の環境変数 AIRREACH_GEMINI_MODEL で上書きできる
/** AI ごとの持ち時間（聞き直しの待ちを含む）。書いていない AI は240秒 */
export const ENGINE_BUDGET_MS = { gemini: 70000 };
/** Gemini 1回あたりの待ち時間 */
export const GEMINI_TIMEOUT_MS = 40000;
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
/** 「このモデルは使えない・〇〇を使って」という Google の案内から、案内されたモデル名を読む（無ければ null） */
export function geminiSuggestedModel(msg) {
  const m = /no longer available[\s\S]*?use models\/([a-z0-9.\-]+)/i.exec(String(msg || ''));
  return m ? m[1].replace(/[.\-]+$/, '') : null;
}
export async function callGemini(key, prompt, model = process.env.AIRREACH_GEMINI_MODEL || GEMINI_DEFAULT_MODEL, retried = false) {
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2 }
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS)
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new Error('Gemini が' + Math.round(GEMINI_TIMEOUT_MS / 1000) + '秒以内に答えませんでした（時間切れ）。少しあけて、もう一度計測してください [timeout]');
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || ('Gemini API failed (' + res.status + ')');
    if (res.status === 429) {
      const d = ((data.error && data.error.details) || []).map((x) => x && x.retryDelay).filter(Boolean)[0];
      const sec = d ? parseInt(String(d), 10) : 30;
      throw new Error('gemini の回数の上限に当たりました。' + sec + '秒ほどあけて、もう一度計測してください [rate limit; retry after ' + sec + 's]');
    }
    // モデルが使えなくなったときは、Google が案内したモデルで1回だけ聞き直す（使ったモデルは行に残す）
    const next = !retried && geminiSuggestedModel(msg);
    if (next && next !== model) return callGemini(key, prompt, next, true);
    throw new Error(String(msg).slice(0, 200));
  }
  const out = await parseGeminiResponse(data, resolveRedirect);
  return Object.assign(out, { model_used: model });
}
// ---- SerpApi：Google の AI による概要（AI Overviews）と AI モード（AI Mode）--------------------------
// 日本の Google（google.co.jp・日本語・日本）で取る。答えの本文は text_blocks の snippet、出典は references[].link。
// AI による概要は、検索結果の中に出ないこともある（出ない質問は shown=false。回答が無いので言及・引用とも判定せず「表示なし」として別に数える）
const SERP_BASE = 'https://serpapi.com/search.json';
async function serpGet(params, key) {
  const q = new URLSearchParams(Object.assign({ hl: 'ja', gl: 'jp', api_key: key }, params));
  if (!q.get('location')) q.delete('location');
  const res = await fetch(SERP_BASE + '?' + q.toString(), { signal: AbortSignal.timeout(90000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = String(data.error || ('Google の AI の計測に失敗しました（' + res.status + '）'));
    if (res.status === 429 || /rate|limit|run out|searches/i.test(msg)) throw new Error('Google の AI の計測で回数の上限に当たりました（' + msg.slice(0, 80) + '） [rate limit; retry after 30s]');
    throw new Error(msg.slice(0, 200));
  }
  return data;
}
export function serpBlocksText(blocks) {
  const out = [];
  const walk = (b) => {
    if (!b) return;
    if (b.title) out.push(String(b.title));
    if (b.snippet) out.push(String(b.snippet));
    (b.list || []).forEach(walk);
    (b.text_blocks || []).forEach(walk);
    if (Array.isArray(b.table)) b.table.forEach((row) => out.push([].concat(row).join(' ')));
  };
  (blocks || []).forEach(walk);
  return out.join('\n');
}
export function serpAnswer(part) {
  const p = part || {};
  const refs = (p.references || []).map((r) => r && r.link).filter((u) => /^https?:\/\//i.test(String(u || '')));
  return { answer: serpBlocksText(p.text_blocks), citations: refs.filter((u, i, a) => a.indexOf(u) === i).slice(0, 20) };
}
export async function callSerpAio(key, prompt, location) {
  const data = await serpGet({ engine: 'google', q: prompt, google_domain: 'google.co.jp', location: location || '' }, key);
  const used = serpLocationUsed(data);
  let aio = data.ai_overview || null;
  // 後から読み込まれる形のときは、page_token でもう1回取る
  if (aio && aio.page_token && !(aio.text_blocks && aio.text_blocks.length)) {
    const d2 = await serpGet({ engine: 'google_ai_overview', page_token: aio.page_token }, key);
    aio = d2.ai_overview || aio;
  }
  if (!aio || !(aio.text_blocks && aio.text_blocks.length)) return { answer: '', citations: [], searched: true, shown: false, fields: ['serpapi', 'aio_not_shown'], location_used: used };
  const a = serpAnswer(aio);
  return { answer: a.answer, citations: a.citations, searched: true, shown: true, fields: ['serpapi', 'ai_overview'], location_used: used };
}
export async function callSerpAiMode(key, prompt, location) {
  const data = await serpGet({ engine: 'google_ai_mode', q: prompt, location: location || '' }, key);
  const a = serpAnswer(data);
  return { answer: a.answer, citations: a.citations, searched: true, shown: !!a.answer, fields: ['serpapi', 'ai_mode'], location_used: serpLocationUsed(data) };
}
/** SerpApi が実際に使った地域（指定しなかったときは null） */
export function serpLocationUsed(data) {
  const sp = (data && data.search_parameters) || {};
  return sp.location_used || sp.location_requested || null;
}
/** 地域の指定を、SerpApi の地域名の形（英字・空白・カンマ）に限る。空なら null（日本全体）、形が違えば false */
export function normalizeLocation(v) {
  if (v == null || v === '') return null;
  const t = String(v).trim().replace(/\s*,\s*/g, ',');
  if (!t) return null;
  if (!/^[A-Za-z][A-Za-z .'-]*(,[A-Za-z][A-Za-z .'-]*){0,3}$/.test(t) || t.length > 80) return false;
  return t;
}
/** OpenAI の web_search に渡す地域（市区町村だけを渡す。国は日本） */
export function userLocation(location) {
  const parts = String(location || '').split(',').map((x) => x.trim()).filter(Boolean);
  const out = { type: 'approximate', country: 'JP' };
  // 「市区町村,都道府県,Japan」なら市区町村と都道府県、「都道府県,Japan」なら都道府県だけ
  if (parts.length >= 3) { out.city = parts[0]; out.region = parts[1]; } else if (parts.length === 2) out.region = parts[0];
  return out;
}
/** 失敗の種類（集計で分けて数える） */
export function errorType(err) {
  const m = String((err && err.message) || err || '');
  if (/rate limit|回数の上限|429|too many requests/i.test(m)) return 'rate_limit';
  if (/timeout|timed out|aborted|時間/i.test(m)) return 'timeout';
  if (/fetch failed|network|ECONN|ENOTFOUND|socket/i.test(m)) return 'network';
  if (/not configured|API_KEY|unauthorized|401|403/i.test(m)) return 'auth';
  return 'other';
}

async function resolveRedirect(uri) {
  try {
    const r = await fetch(uri, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(4000) });
    return r.headers.get('location') || '';
  } catch (e) { return ''; }
}
export async function parseGeminiResponse(data, resolve) {
  const cand = (data && data.candidates && data.candidates[0]) || {};
  const answer = ((cand.content && cand.content.parts) || []).map((p) => p.text || '').join('');
  const gm = cand.groundingMetadata || null;
  const chunks = (gm && gm.groundingChunks) || [];
  const urls = [];
  await Promise.all(chunks.slice(0, 12).map(async (c, i) => {
    const w = c && c.web; if (!w) return;
    let u = '';
    if (w.title && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(String(w.title).trim())) u = 'https://' + String(w.title).trim().toLowerCase() + '/';
    else if (w.uri && !/vertexaisearch\.cloud\.google\.com/.test(w.uri)) u = w.uri;
    else if (w.uri && resolve) u = await resolve(w.uri);
    if (/^https?:\/\//i.test(u)) urls[i] = u;
  }));
  const list = urls.filter(Boolean).filter((u, i, a) => a.indexOf(u) === i);
  const searched = !!(gm && ((gm.webSearchQueries || []).length || chunks.length));
  // 検索して出典が1つ以上あれば一覧で判定。出典が無ければ本文での判定に回す（0 にしない）
  return { answer, citations: list.length ? list : null, searched, fields: ['gemini'].concat(gm ? ['groundingMetadata'] : []) };
}

async function callProvider(engine, key, prompt, location) {
  const system =
    'You are answering a Japanese business search question. Be concise. Prefer factual sources when known.';
  if (engine === 'gemini') return callGemini(key, prompt);
  if (engine === 'google_aio') return callSerpAio(key, prompt, location);
  if (engine === 'google_ai_mode') return callSerpAiMode(key, prompt, location);
  if (engine === 'chatgpt_search') return callOpenAISearch(key, prompt, location);
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
  if (engine === 'claude') return callClaudeSearch(key, prompt);
  if (engine === 'perplexity') return callPerplexityDirect(key, prompt);
  throw new Error('Unknown engine');
}

/** 回数の上限（429）のときの共通の文。末尾の英語は自動で待って聞き直すための目印（rateLimitWait が読む） */
function limitError(name, sec) {
  const s2 = sec || 30;
  return new Error(name + ' の回数の上限に当たりました。' + s2 + '秒ほどあけて、もう一度計測してください [rate limit; retry after ' + s2 + 's]');
}
/**
 * Perplexity の API（直接）。出典は citations（URL の配列）と search_results[].url で返る。
 * 費用（2026-10 公開価格）: sonar は 1回の検索つき回答あたり request fee＋トークン料。PERPLEXITY_API_KEY が必要
 */
export async function callPerplexityDirect(key, prompt) {
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: directModel('perplexity'), messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(90000)
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) throw limitError('perplexity');
  if (!res.ok) throw new Error(String((data && data.error && (data.error.message || data.error)) || ('Perplexity failed (' + res.status + ')')).slice(0, 200));
  return parsePerplexityDirect(data);
}
export function parsePerplexityDirect(data) {
  const d = data || {};
  const msg = (d.choices && d.choices[0] && d.choices[0].message) || {};
  const urls = [];
  (Array.isArray(d.citations) ? d.citations : []).forEach((u) => { if (typeof u === 'string' && /^https?:\/\//i.test(u) && urls.indexOf(u) < 0) urls.push(u); });
  (Array.isArray(d.search_results) ? d.search_results : []).forEach((r) => { const u = r && r.url; if (/^https?:\/\//i.test(String(u || '')) && urls.indexOf(u) < 0) urls.push(u); });
  const fields = ['perplexity'].concat(Array.isArray(d.citations) ? ['citations'] : [], Array.isArray(d.search_results) ? ['search_results'] : []);
  return { answer: msg.content || '', citations: urls.length ? urls.slice(0, 20) : null, searched: true, fields };
}
/**
 * Claude（Anthropic の API・直接）を Web 検索つきで聞く。出典は本文ブロックの citations（web_search_result_location）。
 * 費用: 検索 1,000回あたり 10ドル＋トークン料（Haiku 4.5）。検索は1回までに抑える。ANTHROPIC_API_KEY が必要
 */
export async function callClaudeSearch(key, prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: directModel('claude'),
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1, user_location: { type: 'approximate', country: 'JP' } }]
    }),
    signal: AbortSignal.timeout(120000)
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) throw limitError('claude');
  if (!res.ok) throw new Error(String((data && data.error && data.error.message) || ('Anthropic failed (' + res.status + ')')).slice(0, 200));
  return parseClaudeSearch(data);
}
export function parseClaudeSearch(data) {
  let answer = '';
  const urls = [];
  let searched = false;
  for (const b of (data && data.content) || []) {
    if (b.type === 'server_tool_use' && b.name === 'web_search') searched = true;
    if (b.type === 'web_search_tool_result') searched = true;
    if (b.type !== 'text') continue;
    answer += b.text || '';
    for (const c of b.citations || []) { const u = c && c.url; if (/^https?:\/\//i.test(String(u || '')) && urls.indexOf(u) < 0) urls.push(u); }
  }
  return { answer, citations: urls.length ? urls.slice(0, 20) : null, searched, fields: ['claude'].concat(searched ? ['web_search'] : []) };
}
/** ChatGPT（OpenAI の API・直接）を Web 検索つきで聞く（Responses API）。OPENAI_API_KEY が必要 */
export async function callOpenAISearch(key, prompt, location) {
  const model = directModel('chatgpt_search');
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: prompt, tools: [{ type: 'web_search', user_location: userLocation(location) }], max_tool_calls: 1, reasoning: { effort: 'low' }, store: false }),
    signal: AbortSignal.timeout(120000)
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 429) throw limitError('openai');
  if (!res.ok) throw new Error(String((data && data.error && data.error.message) || ('OpenAI failed (' + res.status + ')')).slice(0, 200));
  return parseSearchResponses(data);
}

function engineLabel(engine) {
  if (engine === 'chatgpt') return 'ChatGPT';
  if (engine === 'chatgpt_search') return 'ChatGPT（検索あり）';
  if (engine === 'gemini') return 'Gemini';
  if (engine === 'google_aio') return 'Google AI Overviews';
  if (engine === 'google_ai_mode') return 'Google AI Mode';
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
