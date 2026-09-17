# AirReach Growth / OS layers — Issue #24 + product brush-up

# AirReach Growth layers — backend contract (Issue #24)

Public site ships client-side P0–P3 surfaces. Live OAuth and HackⅡ execution stay off the static site until credentials and contracts are approved.

## P1 Connected (GSC / GA4)

- OAuth scopes (planned): Search Console read, GA4 Data API read
- Ingest: query × page × device × country, brand vs non-brand, CTR gap, generative AI performance when available
- Replacement rule: measured impressions/clicks/position/CVR replace model estimates per theme; keep `dataKind: 実測`
- Current public measurement: GSC Performance CSV/TSV import (browser-only) labeled `実測（GSC CSV）`; optional single-theme manual input; AI hand-measurement log labeled `実測（手計測）`

## P2 HackⅡ

- Platforms: ChatGPT / Gemini / Claude / Perplexity (contract-defined)
- Metrics: visibility, mention, citation, recommendation, SOV, position, sentiment, fact accuracy, fanout, volatility
- Competitor Win/Loss and source-domain gaps
- Current public measurement: hand log of prompt/model/mention/citation/recommendation; SAMPLE remains demo-only; live multi-model runs require HackⅡ

## P3 Action

- Priority engine already runs client-side from theme opportunity × effort × confidence
- Content brief generator: title / meta / H1 / H2 / FAQ / schema / links (draft only)
- GitHub: human review → PR (no auto-merge). CMS: draft only
- Remeasure: browser snapshots now; server time-series after Connected/HackⅡ APIs

## Non-goals on public pages

- No fake live AI citation rates
- No guaranteed CV / revenue claims
- No auto-publish


## Free OS surface (shipped on Jekyll)

- AI Understanding Map (measured from public HTML)
- Search Foundation checks (noindex/canonical/robots/schema)
- Decision Coverage (query bank vs page coverage, displayed /100)
- Citation Gap + NEXT 3 ACTIONS
- 1 FREE FIX (rule/template; no server LLM)
- GSC CSV + AI hand log remain for numeric replacement
- Live ChatGPT/Gemini rates still require HackⅡ
- Vercel/Next.js migration is planned separately when project credentials are available
