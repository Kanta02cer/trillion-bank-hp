function setCors(req, res) {
  const origin = req.headers.origin || '';
  let allow = 'https://trillion-bank.jp';
  try {
    const host = origin ? new URL(origin).hostname : '';
    if (
      host === 'trillion-bank.jp' ||
      host === 'www.trillion-bank.jp' ||
      host === 'trillion-bank-hp.vercel.app' ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      (host && (host.endsWith('.vercel.app') || host.endsWith('.github.io')))
    ) {
      allow = origin;
    }
  } catch (e) {}
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({ error: 'GET or POST required' });
  const input = req.method === 'GET' ? req.query : (req.body || {});
  const targetUrl = input.url;
  const strategy = (input.strategy || 'mobile').toLowerCase();
  if (!targetUrl) return res.status(400).json({ error: 'url is required' });

  let parsed;
  try { parsed = new URL(targetUrl); } catch (_) {
    return res.status(400).json({ error: 'url must be a valid absolute URL' });
  }
  if (!/^https?:$/.test(parsed.protocol)) return res.status(400).json({ error: 'Only http/https URLs are supported' });
  if (!['mobile','desktop'].includes(strategy)) return res.status(400).json({ error: 'strategy must be mobile or desktop' });

  const params = new URLSearchParams({ url: parsed.href, strategy });
  ['performance','accessibility','best-practices','seo'].forEach(c => params.append('category', c));
  if (process.env.PAGESPEED_API_KEY) params.set('key', process.env.PAGESPEED_API_KEY);

  const r = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`);
  const data = await r.json();
  if (!r.ok) return res.status(r.status).json(data);

  const cats = data.lighthouseResult?.categories || {};
  const audits = data.lighthouseResult?.audits || {};
  const loading = data.loadingExperience?.metrics || {};
  const origin = data.originLoadingExperience?.metrics || {};

  return res.status(200).json({
    source: 'pagespeed_insights',
    evidenceClass: 'official_public',
    url: parsed.href,
    strategy,
    fetchedAt: data.analysisUTCTimestamp || new Date().toISOString(),
    scores: {
      performance: score(cats.performance),
      accessibility: score(cats.accessibility),
      bestPractices: score(cats['best-practices']),
      seo: score(cats.seo)
    },
    lab: {
      lcpMs: numeric(audits['largest-contentful-paint']?.numericValue),
      cls: numeric(audits['cumulative-layout-shift']?.numericValue),
      tbtMs: numeric(audits['total-blocking-time']?.numericValue),
      fcpMs: numeric(audits['first-contentful-paint']?.numericValue),
      speedIndexMs: numeric(audits['speed-index']?.numericValue)
    },
    field: summarizeField(loading),
    originField: summarizeField(origin),
    raw: data
  });
}

function score(category) {
  const s = category?.score;
  return typeof s === 'number' ? Math.round(s * 100) : null;
}
function numeric(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
function summarizeField(metrics) {
  function m(name) {
    const x = metrics?.[name];
    return x ? { percentile: x.percentile ?? null, category: x.category || null, distributions: x.distributions || [] } : null;
  }
  return {
    lcp: m('LARGEST_CONTENTFUL_PAINT_MS'),
    inp: m('INTERACTION_TO_NEXT_PAINT'),
    cls: m('CUMULATIVE_LAYOUT_SHIFT_SCORE'),
    fcp: m('FIRST_CONTENTFUL_PAINT_MS'),
    ttfb: m('EXPERIMENTAL_TIME_TO_FIRST_BYTE')
  };
}
