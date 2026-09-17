# AirReach v1 final product specification

Status: FROZEN FOR MVP BUILD
Date: 2026-09-17

## Product definition

AirReach is an AIO measurement and growth platform that connects AI visibility, Google Search, technical website quality, conversion data, remediation, and before/after measurement.

The primary customer question is not "What is my AIO score?" but:

> Given my current traffic and conversion baseline, where are we likely losing demand, what should we fix first, and how much additional traffic/inquiry could be plausible under explicit assumptions?

Hack II is the measured-AI and managed implementation layer connected to AirReach.

## Product promise

AirReach must support this loop:

Measure -> Diagnose -> Prioritize -> Simulate -> Generate -> Implement -> Re-measure -> Inquiry/Revenue

AirReach must never present inferred outcome ranges as guaranteed results.

## Core audiences

1. Marketing manager: wants to know what to fix and why.
2. Executive / owner: wants expected business impact in traffic/inquiries.
3. Agency / partner: wants a repeatable diagnosis and proposal workflow.
4. Engineer / web team: wants exact files, code changes, and implementation instructions.

## P0 - required for MVP

### 1. Free URL diagnosis
- URL input
- Technical readiness
- Entity / schema readiness
- FAQ / answerability
- Discoverability
- Clear distinction between readiness and live AI measurement

### 2. Growth impact simulator
Inputs:
- monthly visitors
- monthly inquiries
- monthly LINE registrations (optional)
- monthly service fee (optional)
- inquiry-to-close rate (optional)
- average order value (optional)
- gross margin (optional)
- traffic uplift assumption
- CVR uplift assumption

Outputs:
- low / base / high scenarios
- added visitors
- added inquiries
- added LINE registrations
- optional added gross profit
- optional ROI reference

Evidence class: inferred + user_input.

### 3. Data catalog
Must visibly label every metric as one of:
- official
- official_public
- observed
- inferred
- user_input

### 4. Google data integration
- Search Console Search Analytics: date/query/page/clicks/impressions/CTR/position
- GA4: date/landing page/sessions/key events/revenue where available
- URL Inspection: indexing verdict, canonical, crawl, robots, page fetch, rich result details
- PageSpeed Insights: performance/SEO/accessibility/best-practices and lab/field UX metrics

Google Generative AI reporting must remain a separate source until the Search Console API exposes a documented dedicated endpoint/dimension for it.

### 5. Keyword / Decision Query registry
Each item:
- text
- intent
- cluster
- priority
- target URL
- locale
- status

### 6. Hack II AI measurement ingestion
Each run:
- prompt
- engine
- locale
- timestamp
- answer text
- mentioned
- cited
- cited URLs
- share of voice where measured
- run status

States must distinguish:
- unmeasured
- failed
- measured zero
- measured positive

### 7. Gap analysis
Must identify at least:
- pricing information gap
- case study gap
- comparison gap
- FAQ gap
- evidence / first-party data gap
- author / operator identity gap
- schema gap
- conversion path gap
- policy / trust gap

### 8. Artifact generation
Generate:
- Organization JSON-LD
- Service JSON-LD
- FAQPage JSON-LD
- llms.txt
- llms-full.txt
- CLAUDE.md (developer agent context only)
- keyword-map.csv
- faq-plan.md
- implementation-plan.md
- measurement-template.csv

Rules:
- generated structured data must match visible approved facts
- FAQPage must correspond to visible FAQ content
- llms files are supplemental and not ranking guarantees
- CLAUDE.md must never be described as a web ranking signal

### 9. Time series
Overlay by date:
- GSC impressions/clicks/CTR/position
- GA4 sessions/key events/CVR
- Hack II mention/citation
- implementation events

### 10. Sales-ready result screen
Primary result hierarchy:
1. estimated opportunity range
2. added visitors / inquiries under assumptions
3. top 3 causes
4. top 3 actions
5. measured/search data underneath
6. readiness score as supporting detail, not hero KPI

## P1 - next production phase

### 11. AI Search Patch
- identify target file/page
- generate patch
- preview diff
- create GitHub branch
- create PR
- human approval
- deployment handoff
- post-deploy verification

### 12. Next Best Action engine
Priority formula base:
Business impact x confidence / effort

Inputs can include:
- affected queries/prompts
- GSC impressions
- conversion baseline
- competitor gap
- implementation difficulty
- evidence quality

### 13. Competitor intelligence
- competitor URLs
- prompt win/loss
- cited pages
- content/schema/evidence gap
- comparison pages
- latest-update freshness where observable

### 14. Evidence Graph
Claim -> owned page -> structured data -> case study -> external source -> last verified.

### 15. Query fan-out
Store observed or inferred related search/query branches separately and label their evidence class.

## P2 - moat / vertical layer

### 16. Industry-specific uplift priors
Accumulate intervention data:
industry x problem x intervention x before x after

Do not use as deterministic prediction. Use as prior/range with sample size and confidence.

### 17. AirReach Local / Live
For verticals with live supply or appointment inventory:
- beauty/wellness
- home services / repair
- pet services
- restaurants
- real estate / appointment-led categories where appropriate

Model real-time availability/inventory separately from general AIO visibility.

## Canonical ER model

### organization
- id
- name
- industry

### workspace
- id
- organization_id
- name
- plan

### site
- id
- workspace_id
- url
- search_console_property
- ga4_property_id

### keyword_prompt
- id
- workspace_id
- text
- intent
- cluster
- priority
- target_url
- locale
- status

### competitor
- id
- workspace_id
- name
- domain

### search_measurement_daily
- date
- site_id
- keyword_prompt_id nullable
- url
- impressions
- clicks
- ctr
- position
- evidence_class

### analytics_measurement_daily
- date
- site_id
- url
- sessions
- active_users
- key_events
- revenue
- evidence_class

### ai_run
- id
- workspace_id
- keyword_prompt_id
- engine
- prompt
- locale
- measured_at
- answer_text
- mentioned
- cited
- share_of_voice
- run_status
- evidence_class

### ai_run_citation
- id
- ai_run_id
- cited_url
- source_domain
- position

### technical_audit_run
- id
- site_id
- run_at
- source
- status

### technical_finding
- id
- technical_audit_run_id
- url
- finding_type
- severity
- evidence
- recommended_fix

### conversion_baseline
- id
- workspace_id
- period_start
- period_end
- visitors
- inquiries
- line_registrations
- close_rate
- average_order_value
- gross_margin
- evidence_class

### simulation
- id
- workspace_id
- created_at
- baseline_id
- traffic_uplift
- cvr_uplift
- scenario
- estimated_visitors
- estimated_inquiries
- estimated_profit
- assumption_json

### recommendation
- id
- workspace_id
- target_url
- finding_type
- action_type
- business_impact
- confidence
- effort
- priority_score
- status

### generated_artifact
- id
- recommendation_id
- artifact_type
- target_path
- content
- approval_status

### implementation_event
- id
- workspace_id
- target_url
- event_at
- change_type
- artifact_id nullable
- commit_or_ticket
- deployment_url nullable
- owner

## Final product KPI

Do not optimize for number of charts or number of supported AI models alone.

Primary product KPIs:
- diagnosis-to-action rate
- artifact generation rate
- approved patch rate
- time to patch
- deployment rate
- remeasurement completion rate
- post-fix traffic lift
- post-fix inquiry lift
- percentage of recommendations linked to measurable outcomes

## Positioning

AirReach:
"AI search measurement that shows what to fix and how much acquisition could change under explicit assumptions."

Hack II:
"Managed measurement and implementation that takes recommended changes through execution and remeasurement."
