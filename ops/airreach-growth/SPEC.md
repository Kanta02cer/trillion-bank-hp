# AirReach Growth layers — backend contract (Issue #24)

Public site ships client-side P0–P3 surfaces. Live OAuth and HackⅡ execution stay off the static site until credentials and contracts are approved.

## P1 Connected (GSC / GA4)

- OAuth scopes (planned): Search Console read, GA4 Data API read
- Ingest: query × page × device × country, brand vs non-brand, CTR gap, generative AI performance when available
- Replacement rule: measured impressions/clicks/position/CVR replace model estimates per theme; keep `dataKind: 実測`
- Current public fallback: manual metric input on `/airreach/` labeled `実測（ユーザー入力）`

## P2 HackⅡ

- Platforms: ChatGPT / Gemini / Claude / Perplexity (contract-defined)
- Metrics: visibility, mention, citation, recommendation, SOV, position, sentiment, fact accuracy, fanout, volatility
- Competitor Win/Loss and source-domain gaps
- Current public fallback: SAMPLE projection only, never claimed as live

## P3 Action

- Priority engine already runs client-side from theme opportunity × effort × confidence
- Content brief generator: title / meta / H1 / H2 / FAQ / schema / links (draft only)
- GitHub: human review → PR (no auto-merge). CMS: draft only
- Remeasure: browser snapshots now; server time-series after Connected/HackⅡ APIs

## Non-goals on public pages

- No fake live AI citation rates
- No guaranteed CV / revenue claims
- No auto-publish
