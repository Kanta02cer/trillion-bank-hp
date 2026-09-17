# AirReach AIO Measurement Platform — product requirements

## Product promise

AirReach should answer the commercial question a buyer actually has:

> If we improve our AI/search visibility, how much additional traffic and inquiry opportunity could we plausibly create under explicit assumptions?

It must not present simulated outcomes as guarantees.

## Competitive positioning

AirReach does not try to win only on the number of AI engines, charts, or prompt-monitoring features. Those are increasingly standard across GEO/AIO platforms.

AirReach differentiates on the closed loop:

1. Measure AI/search visibility.
2. Explain the cause of gaps.
3. Generate the exact remediation artifacts.
4. Implement through Git/CMS workflows.
5. Re-measure search and AI visibility.
6. Connect changes to visits, inquiries, meetings, and optional revenue scenarios.

## Required top-level modules

### 1. Executive overview
- AI readiness score
- measured AI mention rate
- measured AI citation rate
- Share of Voice
- GSC impressions / clicks / CTR / average position
- GA4 sessions / key events / CVR
- opportunity scenario
- top 3 next-best actions
- data-quality/evidence badges: Official / Observed / Inferred

### 2. Growth impact simulator
Inputs:
- current monthly visitors
- current monthly inquiries
- current LINE registrations / other lead events
- optional current monthly service fee
- optional inquiry-to-sale rate
- optional average order value
- optional gross margin
- assumed traffic uplift
- assumed relative CVR uplift

Outputs:
- Low / Base / High traffic scenarios
- estimated additional visitors
- estimated additional inquiries
- estimated additional LINE registrations
- optional sales and gross-profit scenario
- optional reference ROI

Simulation outputs MUST be labelled as assumption-based estimates, not causal forecasts.

### 3. AI visibility measurement
By prompt, engine, date, locale:
- answer text
- brand mentioned
- cited
- mention position
- cited URLs
- referenced URLs
- competitor mentions
- competitor citations
- SOV
- model / engine
- run status
- measurement evidence

### 4. Search measurement
Search Console API:
- date
- query
- page
- clicks
- impressions
- CTR
- average position
- country and device as optional dimensions

Search Console Generative AI report:
- store separately from standard GSC API until a dedicated supported API dimension/end point is verified
- support import/export ingestion from the official report

### 5. Analytics and conversion
GA4 Data API:
- date
- landing page
- sessions
- active users
- engaged sessions
- key events
- total revenue when configured

Customer-defined lead events:
- form submit
- LINE registration
- meeting booking
- phone click
- document download

### 6. Technical Search / AIO audit
- indexability
- canonical
- robots meta
- robots.txt
- sitemap
- redirect chains
- 404
- structured data
- Organization / Service / Product / LocalBusiness schema
- FAQ visible content vs FAQ schema
- internal links
- H1/title/meta
- PageSpeed / Lighthouse
- CrUX metrics
- llms.txt / llms-full.txt presence (supplemental only)

### 7. Competitor gap
- competitor domain
- prompt
- competitor cited URL
- content type
- title / headings
- answer-first coverage
- pricing visibility
- comparison content
- case-study evidence
- first-party data
- structured data
- third-party evidence
- content recency
- gap category

### 8. Remediation / AI Search Patch
Generate:
- FAQ copy
- FAQPage JSON-LD
- Organization JSON-LD
- Service JSON-LD
- Product / LocalBusiness when appropriate
- title/meta/H1 proposal
- Answer-first blocks
- comparison page outline
- internal-link patch
- llms.txt
- llms-full.txt
- machine-readable /ai page draft
- implementation guide
- GitHub patch / PR-ready artifact

Future production flow:
Analyze -> Generate -> Preview -> Approve -> Pull Request -> Deploy -> Verify -> Re-measure

## Data source catalogue

### Google Search Console Search Analytics API
Authentication: OAuth 2.0.
Cost: no usage charge from Google; quota applies.
Use: query/page/date search performance.

### Google Search Console URL Inspection API
Authentication: OAuth 2.0.
Cost: no usage charge; quota applies.
Use: property-authorized URL index inspection.

### Google Analytics Data API (GA4)
Authentication: OAuth or service credentials depending architecture.
Cost: API itself is not paid per request; quotas apply.
Use: sessions, users, key events, landing pages, revenue.

### PageSpeed Insights API
Authentication: requests can be made without an API key for low-volume usage; key recommended for quota management.
Use: Lighthouse/PageSpeed data.

### Chrome UX Report API
Authentication: Google Cloud API key.
Cost: no per-request product fee; quota applies.
Use: origin/page field UX metrics such as LCP/INP/CLS when data is available.

### Google Business Profile APIs
Authentication: OAuth and approved project/account access.
Cost: no per-request product fee; quota/access requirements apply.
Use: local business data where eligible.

### Public HTML / robots / sitemap
Authentication: none for public resources.
Cost: infrastructure/bandwidth only.
Use: deterministic audit.
Safety: server fetcher must block localhost, private IP ranges, cloud metadata addresses, oversized responses, unsupported schemes, and excessive redirect chains.

### HackII measurement runner
Authentication: internal.
Cost: model/browser/provider costs depend on runner.
Use: observed AI answer / mention / citation measurements.

## Evidence classes

Every metric displayed to customers should have one of:

- `official` — first-party Google/analytics/customer system data.
- `observed` — AirReach/HackII directly measured the event/output.
- `inferred` — calculated or modelled from other values.
- `user_input` — manually supplied by the customer.

Do not merge inferred values into official or observed percentages.

## Recommended ER model

```text
organization
  id PK
  name

workspace
  id PK
  organization_id FK
  name
  timezone
  default_currency

site
  id PK
  workspace_id FK
  domain
  canonical_url
  gsc_property
  ga4_property_id

conversion_event
  id PK
  workspace_id FK
  name
  event_key
  event_type
  monetary_value nullable

competitor
  id PK
  workspace_id FK
  name
  domain

keyword_prompt
  id PK
  workspace_id FK
  text
  type              # seo_keyword | ai_prompt
  intent
  cluster
  priority
  locale
  target_url
  status

search_measurement_daily
  id PK
  site_id FK
  keyword_prompt_id FK nullable
  date
  page_url
  country nullable
  device nullable
  impressions
  clicks
  ctr
  position
  source

analytics_measurement_daily
  id PK
  site_id FK
  date
  landing_page
  sessions
  active_users
  engaged_sessions
  key_events
  revenue

conversion_measurement_daily
  id PK
  conversion_event_id FK
  site_id FK
  date
  landing_page nullable
  conversions
  revenue nullable

ai_engine
  id PK
  name
  provider
  model_label nullable

ai_run
  id PK
  workspace_id FK
  keyword_prompt_id FK
  ai_engine_id FK
  measured_at
  locale
  answer_text
  run_status
  mentioned
  cited
  mention_position nullable
  share_of_voice nullable
  evidence_class

ai_run_citation
  id PK
  ai_run_id FK
  url
  domain
  citation_type
  position nullable
  is_own_domain
  competitor_id FK nullable

technical_audit_run
  id PK
  site_id FK
  started_at
  completed_at
  target_url
  readiness_score

technical_audit_finding
  id PK
  technical_audit_run_id FK
  category
  severity
  finding_key
  title
  evidence_json
  recommended_action

implementation_event
  id PK
  workspace_id FK
  site_id FK
  target_url
  implemented_at
  change_type
  artifact_type
  commit_sha nullable
  pull_request_url nullable
  deployment_url nullable

simulation
  id PK
  workspace_id FK
  created_at
  current_visitors
  current_inquiries
  current_line_registrations
  traffic_uplift_assumption
  cvr_uplift_assumption
  close_rate nullable
  average_order_value nullable
  gross_margin nullable
  monthly_fee nullable

simulation_scenario
  id PK
  simulation_id FK
  scenario            # low | base | high
  projected_visitors
  projected_inquiries
  projected_line_registrations
  projected_revenue nullable
  projected_gross_profit nullable

connector_account
  id PK
  workspace_id FK
  provider             # google | github | etc
  external_account_id
  status
  encrypted_credentials_ref

sync_run
  id PK
  connector_account_id FK
  source
  started_at
  completed_at
  status
  rows_written
  error_summary nullable
```

## Core relationships

- organization 1:N workspace
- workspace 1:N site
- workspace 1:N keyword_prompt
- workspace 1:N competitor
- workspace 1:N ai_run
- site 1:N search_measurement_daily
- site 1:N analytics_measurement_daily
- ai_run 1:N ai_run_citation
- technical_audit_run 1:N technical_audit_finding
- workspace 1:N implementation_event
- simulation 1:N simulation_scenario

## Opportunity model

Do not infer opportunity directly from readiness score.

Preferred calculation order:

1. Use actual GSC/GA4 baseline where connected.
2. Select affected query/page scope.
3. Apply an explicitly visible traffic-uplift assumption.
4. Apply an explicitly visible relative CVR-uplift assumption.
5. Calculate additional visits and leads.
6. Only calculate revenue when close rate / value data is available.
7. Store assumptions with the result so sales cannot present them as guaranteed outcomes.

Future empirical model:

`uplift_prior(industry, finding_type, intervention_type)`

should be learned from AirReach implementation history only after enough before/after samples exist. Until then, use customer-selected assumptions or clearly labelled benchmark ranges.

## Web architecture

### Current MVP
- Jekyll/GitHub Pages for marketing UI.
- Browser localStorage for Studio workspace.
- CSV ingestion fallback.
- Vercel-compatible API files for Google OAuth/GSC/GA4.

### Production target
- Next.js App Router on Vercel.
- Server Components for dashboards / report pages.
- Route Handlers for OAuth, sync, audit, simulations and artifact generation.
- PostgreSQL-compatible database for normalized measurement history.
- Scheduled jobs for GSC/GA4/HackII sync.
- Queue for long-running audits and prompt measurement.
- GitHub integration for approved patch / PR creation.

## Pages

```text
/airreach/                 free URL diagnostic
/airreach/platform/        sales + data catalogue + impact simulator
/airreach/studio/          remediation workspace
/airreach/dashboard/       authenticated executive overview (future)
/airreach/prompts/         AI/SEO prompt registry (future)
/airreach/competitors/     competitive gap (future)
/airreach/implementation/  AI Search Patch history (future)
/airreach/settings/        connectors and conversion definitions (future)
```

## Sales UX rule

The first sales screen should answer, in this order:

1. What are we currently missing?
2. How much traffic/inquiry opportunity might that represent under explicit assumptions?
3. Why is the gap occurring?
4. What should we change first?
5. Can AirReach/HackII implement it?
6. Did the metrics improve afterward?

Technical details and scoring methodology belong lower on the page, not in the first sales frame.
