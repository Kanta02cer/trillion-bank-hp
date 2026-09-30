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
- `api/google/auth.js` — Google OAuth start endpoint for Vercel. **Scopes (read-only):** Search Console `webmasters.readonly` and GA4 `analytics.readonly`. No write scopes. Defined in `api/google/_lib/scopes.js`.
- `api/google/callback.js` — exchanges the code, stores HttpOnly token cookies and a readable `airreach_google_scopes` cookie (`gsc.ga4`, feature names only — not a token). Checks the granted scopes: both → `?google=connected`; Search Console only → `?google=ga4_missing`; GA4 only → `?google=gsc_missing` (the granted one works); neither → `?google=scope_missing` (no tokens stored). Returns to `/airreach/studio/?google=…#google`.
- `api/google/gsc.js` — Search Console `date + query + page` sync.
- `api/google/ga4.js` — GA4 Data API `properties/{propertyId}:runReport`, dimensions `date` + `landingPagePlusQueryString` + `hostName`, metrics `sessions` + `keyEvents`. Requires `propertyId` (numeric Property ID, e.g. `123456789`; a Measurement ID `G-XXXXXXXXXX` is rejected with `400 measurement_id`), `siteUrl`, `startDate`, `endDate`. **Returns only rows whose `hostName` equals the site host** (other domains, the other www variant and `(not set)` are dropped and counted in `excluded`). Google errors are mapped: missing analytics scope → `403 scope_insufficient` (reconnect), no access to the property → `403 forbidden`, expired → `401 unauthorized`.

## Environment variables for Vercel

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (optional; defaults to `/api/google/callback` on the active origin)

The OAuth client must allow the production callback URL, e.g. `https://trillion-bank.jp/api/google/callback` when the site/API is served by Vercel.

## Google OAuth same-origin

The OAuth state and token cookies are host-only cookies on the page's domain, and the callback is `https://trillion-bank.jp/api/google/callback`. So Studio calls `/api/google/auth/`, `/api/google/gsc/` and `/api/google/ga4/` on the **same origin** (not the `tb-api-base` Vercel host). Users who connected before GA4 was enabled must reconnect to grant `analytics.readonly`; Studio shows a notice while the `airreach_google_scopes` cookie lacks `ga4`.

## GA4 data in the free diagnosis (site matching)

GA4 sessions / key events are used only for the same site as the diagnosed URL — the same idea as `gscSites`.

Storage: `localStorage.airreach_official_baseline_v1.ga4Sites` (existing fields, including the old `ga4`, are kept for compatibility):

```js
ga4Sites: [{
  propertyId: '123456789',            // '' for a CSV import without a Property ID
  siteUrl: 'https://example.com/',
  host: 'example.com',                // normalized
  periodDays: 28,
  sessions: 1234, keyEvents: 45,      // totals over the period (from all matching rows)
  rows: [{ date, host, url, sessions, keyEvents }],  // first 2000 rows kept
  rowsTotal, source: 'api' | 'csv', updatedAt
}]
```

Writers: Studio GA4 sync (`/api/google/ga4` with `siteUrl`; the 「GA4 対象サイトURL」 field defaults to the profile URL), Studio GA4 CSV and platform GA4 CSV (only when a target site URL is given). Same host + same property replaces the previous entry.

Matching (`assets/js/airreach-keyword-list.js` `ga4FromBaseline`, server `api/google/_lib/host.js`):

- Host normalization: lowercase, trailing dot removed, default port dropped. **`www` is a different host** (example.com ≠ www.example.com).
- API rows: only rows whose `hostName` equals the site host.
- CSV rows: a Hostname column or an absolute landing-page URL must match the host; path-only rows are attributed to the site URL the user gave.
- The diagnosis and the platform simulator use GA4 only when the diagnosed host equals `ga4Sites[].host` (and matches its `siteUrl`). Otherwise sessions / key events stay 「未計測」 — there is no fallback to another site.
- The old `baseline.ga4` and GA4 CSV imports without a site URL are treated as 「サイト未紐付け」 and are not used as measurements.

## Metric definitions

- GSC = impressions / clicks / CTR / average position. **Impressions are not search volume** (they count how often the site appeared in results).
- Monthly search volume (月間検索数) comes only from Keyword Planner. No data = 「未計測」. String/hash-derived search counts are never used or shown.
- AI citation / mention rates are a separate metric from search data.
- GSC CTR = clicks / impressions.
- Average position = impression-weighted display for aggregated views; raw GSC position is retained by row.
- GA4 CVR = keyEvents / sessions for the selected date/landing-page scope.
- AI mention/citation rates = HackⅡ measured runs only. Readiness scores must never be mixed into these percentages.
- `unmeasured`, `failed`, and measured `0` should be separate states before productionizing the HackⅡ connector.

## GSC data in the free diagnosis (site matching)

Every GSC import records which Search Console property it came from. The free diagnosis (AirReach Tools, 「キーワード比較」 → 「検索データ」 column) only uses GSC data for the same site as the diagnosed URL.

Storage: `localStorage.airreach_official_baseline_v1.gscSites` (existing baseline fields are unchanged):

```js
gscSites: [{
  property: 'sc-domain:example.com' | 'https://www.example.com/',  // GSC siteUrl as imported
  scope: 'domain' | 'url_prefix',
  host: 'example.com',                // normalized
  periodDays: 28,
  keywords: [{ query, impressions, clicks, position }],  // position = impression-weighted average
  updatedAt
}]
```

Writers: `/api/google/gsc` sync (response includes `siteUrl`; each Studio measurement row stores `gscProperty`), Studio GSC CSV (uses the 「GSCサイトURL」 setting), platform CSV (optional 「GSCプロパティ」 field). Rows without a property are kept for Studio but never become `gscSites`.

Matching (`assets/js/airreach-keyword-list.js`):

- Host normalization follows the API's `normalizeSiteUrl`: lowercase, trailing dot removed, default port dropped. `www` is a different host.
- Domain property `sc-domain:example.com` covers `example.com` and `www.example.com` only (other subdomains are not used).
- URL-prefix property covers the exact same host only (including `www`).
- At import time, rows whose page URL is on another host are discarded.
- Old baselines without `gscSites` (or with an unverified `host` field) are never used as Google実測.
- Without OAuth / GSC data, every keyword shows 「未計測」 and the keyword feature works on its own.

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
