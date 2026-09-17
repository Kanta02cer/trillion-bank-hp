# AirReach Studio / HackⅡ integration architecture

## Product boundary

AirReach Studio separates three data classes so the UI never presents estimates as measured facts.

1. **Readiness** — deterministic checks on public HTML, metadata, structured data, robots and supporting files.
2. **Google performance** — measured Search Console and GA4 data after OAuth authorization.
3. **HackⅡ AI measurement** — measured prompt/engine results including mention, citation, SOV and run status.

## Modules

- `/airreach/` — free URL readiness check.
- `/airreach/studio/` — remediation workbench.
- `assets/js/airreach-studio.js` — browser-side MVP: gap analysis, generator, keyword registry, CSV import, time series, HackⅡ JSON import.
- `api/google/auth.js` — Google OAuth start endpoint for Vercel.
- `api/google/callback.js` — OAuth callback.
- `api/google/gsc.js` — Search Console `date + query + page` sync.
- `api/google/ga4.js` — GA4 `date + landingPagePlusQueryString` with sessions/keyEvents sync.

## Environment variables for Vercel

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (optional; defaults to `/api/google/callback` on the active origin)

The OAuth client must allow the production callback URL, e.g. `https://trillion-bank.jp/api/google/callback` when the site/API is served by Vercel.

## Metric definitions

- GSC CTR = clicks / impressions.
- Average position = impression-weighted display for aggregated views; raw GSC position is retained by row.
- GA4 CVR = keyEvents / sessions for the selected date/landing-page scope.
- AI mention/citation rates = HackⅡ measured runs only. Readiness scores must never be mixed into these percentages.
- `unmeasured`, `failed`, and measured `0` should be separate states before productionizing the HackⅡ connector.

## Generated file tree

```text
/airreach-output/
  web/
    schema/
      organization.jsonld
      service.jsonld
      faq.jsonld
    llms.txt
    llms-full.txt
  agents/
    CLAUDE.md
  strategy/
    keyword-map.csv
    faq-plan.md
    implementation-plan.md
  data/
    measurement-template.csv
```

### Placement rules

- JSON-LD must match visible page facts. Do not generate claims that do not exist on the page or in approved source data.
- `FAQPage` structured data must correspond to visible FAQ content when used.
- `llms.txt` and `llms-full.txt` are supplemental machine-readable guidance, not ranking/citation guarantees. If published, root-level placement is preferred.
- `CLAUDE.md` is a Claude Code/project-instruction file. It is not a Google ranking or AI citation standard and belongs in the repository/project context, not the public SEO layer unless there is a separate intentional reason to expose it.

## Recommended production data model

### keyword
- id
- workspace_id
- text
- intent
- cluster
- priority
- target_url
- locale
- status

### measurement_daily
- date
- keyword_id
- url
- gsc_impressions
- gsc_clicks
- gsc_ctr
- gsc_position
- ga_sessions
- ga_key_events
- ga_cvr

### ai_run
- timestamp
- keyword_id
- engine
- prompt
- locale
- answer_text
- mentioned
- cited
- cited_urls
- share_of_voice
- run_status
- cost

### implementation_event
- timestamp
- target_url
- change_type
- artifact
- commit_or_ticket
- owner

This enables charts to overlay implementation dates with GSC/GA4/HackⅡ changes.

## Rollout

### Phase 1 — included in this branch
- Studio UI
- browser persistence
- FAQ gap
- artifact generation
- keyword/Prompt registry
- CSV fallback
- time-series aggregation
- HackⅡ JSON ingestion
- Vercel Google OAuth/API endpoints

### Phase 2
- persist workspaces in a database instead of localStorage
- wire Studio buttons directly to `/api/google/*`
- background/scheduled sync
- HackⅡ API connector and run-status model
- competitor crawler/API integration

### Phase 3
- one-click GitHub PR generation for approved artifacts
- CMS adapters
- change-event overlays in charts
- recommendation priority = business impact × confidence / effort
- automated monthly report and task creation
