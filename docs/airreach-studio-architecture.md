# AirReach Studio / HackⅡ integration architecture

> **現行 Phase 1 の正本:** [`airreach-studio-orchestrator.md`](airreach-studio-orchestrator.md)。本書は旧統合案の技術参考であり、機能範囲・接続状態・出荷条件が矛盾する場合は正本を優先する。

## Product boundary

AirReach Studio separates three data classes so the UI never presents estimates as measured facts.

1. **Readiness** — deterministic checks on public HTML, metadata, structured data, robots and supporting files.
2. **Google performance** — measured Search Console and GA4 data from manual CSV import in Phase 1. OAuth sync is planned.
3. **HackⅡ AI evidence** — Phase 1は顧客提供JSONの手動取込だけを扱う。mention、citation、SOVのライブ測定と自動同期はplannedとする。

## Modules

- `/airreach/` — free URL readiness check.
- `/airreach/studio/` — remediation workbench.
- `assets/js/airreach-studio.js` — browser-side MVP: gap analysis, generator, keyword registry, CSV import, time series, HackⅡ JSON import.
- `api/google/auth.js` — planned Google OAuth start endpoint for a later phase.
- `api/google/callback.js` — planned OAuth callback.
- `api/google/gsc.js` — planned Search Console sync.
- `api/google/ga4.js` — planned GA4 sync.

## Planned environment variables for a later phase

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (optional; defaults to `/api/google/callback` on the active origin)

These variables and callback settings are not connected in Studio Phase 1. They apply only after the planned server-side OAuth work is approved and deployed.

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

### Phase 2
- connect and validate the planned Vercel Google OAuth/API endpoints
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
