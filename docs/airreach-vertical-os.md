# AirReach Vertical OS

Status: Recruit v0 + Indexing API + recruitment AI prompts (P1 scaffold)  
Last updated: 2026-09-23  
Related: `docs/airreach-final-spec.md`, `docs/airreach-product-spec.md`

## Positioning

AirReach is not a bag of schema generators. It manages the path:

**fetchability → entity → structure → observed measurement → conversion**

Vertical modules sit on one **AirReach Core**. They are not separate products.

| Module | Purpose | Public status |
|--------|---------|---------------|
| AirReach Search | SEO / AIO / GEO / LLMO readiness | Current product surface |
| AirReach Local | Store / MEO / regional AI search | Industry packs (restaurant/clinic) |
| AirReach Recruit | Jobs / hiring / Google Job search / recruitment AI | v0 + Indexing notify + HackⅡ prompt split |
| AirReach Media | News / third-party articles / AI citation readiness | Industry pack |
| AirReach Commerce | Product / EC / AI Shopping | Planned |
| AirReach B2B | Service comparison / inquiry | Industry pack |
| HackⅡ | Multi-AI observation & improvement loop | Limited commercial validation |

## Shared Core contracts (must not diverge)

Reuse from `airreach-final-spec.md`:

- `evidence[]` with `evidenceClass`: Official | Observed | Inferred | Customer supplied | Estimated | Planned
- `scoreVersion` — never mix incompatible score meanings
- `projection.status`: `projected` | `not_projected`
- Never treat `0` as the same as `not_measured`
- Easy / Detail modes stay: show state, why improve, first action; detail deep-links existing screens

## Google AI Visibility (P0 — all customers)

As of 2026-08-31, Google Search Console exposes a Generative AI performance report (AI Overviews / AI Mode impressions by page, country, device, date).

AirReach policy:

1. **P0**: CSV / Excel import as `Official` evidence (`source: GSC Generative AI CSV`)
2. **Later**: API sync only after Google publishes a documented public API
3. Do **not** invent a “guessed Generative AI API”
4. Keep Generative AI metrics **separate** from classic Search Click / Impression / CTR / Position
5. Keep Generative AI Official metrics **separate** from HackⅡ Observed citations/mentions

Studio / Platform Google panel layout:

```text
Google
  通常検索     → classic GSC
  生成AI       → Generative AI Performance (CSV Official)
```

Search generative AI control (GSC site setting) is a **checklist item** (confirmed / unconfirmed). AirReach must not auto-toggle it.

## AirReach Recruit = recruitment search OS

### Do not sell as

- “Google for Jobs API に求人を直接掲載して上位表示”
- “Schema を入れれば順位が上がる”
- “JobPosting 10項目 = AIに選ばれる確率80%”
- AI-invented salary / location / benefits in schema
- Fake `EmployerAggregateRating`

### Do sell as

> AirReach Recruit prepares job pages so Google Job search, Google AI, and other AI surfaces can understand them more reliably, then measures discovery → employer understanding → application — without guaranteeing inclusion, rank, or AI citation.

### Three surfaces (always separate)

1. **Google Job Visibility** — job-intent queries / JobPosting readiness / index lifecycle  
2. **Recruitment AI Visibility** — employer/job questions in ChatGPT / Gemini / etc. (HackⅡ Observed)  
3. **Application Conversion** — view → apply CTA → start → complete (GA4 / ATS)

### Initial score panels (no single composite in v0)

| Panel | Meaning |
|-------|---------|
| Google求人掲載準備度 | JobPosting / remote fields / policy checks |
| 採用情報充足度 | salary, location, role, work style, apply path, AI-usable employer info |
| AI検索実測 | HackⅡ Observed (not_measured until run) |
| 応募導線 | Application flow instrumentation |

A future `Recruitment Visibility Score v1` is allowed only after enough real data and an explicit `scoreVersion`.

### Job lifecycle (target pipeline)

```text
ATS / career site
  → Job Source Adapter → Job Canonical Model
  → Google requirement check → gap + fix draft
  → Human approval
  → JobPosting publish (customer site)
  → Indexing API URL_UPDATED / URL_DELETED
  → URL Inspection / index status
  → Google Job search + classic Search + AI Overview/Mode + other AI
  → Application events
  → Before / After (Official + Observed)
```

### Job Canonical Model (internal)

```text
job_id, organization_id, title, description, employment_type,
locations[], remote_policy, salary, date_posted, valid_through,
application_url, direct_apply, source, source_updated_at
```

Adapters: API / Webhook / CSV / XML|JSON feed / Website crawler.  
Do not start with per-ATS custom integrations.

### Evidence Graph (later)

`employer_claim` → `employer_evidence[]` (official pages, JobPosting snapshot, interviews, third-party articles).  
UI language: “参照可能な根拠が N 件” — never “引用される”.

### ER additions (target)

`recruitment_site`, `job_posting`, `job_source`, `job_location`, `job_salary`, `application_flow`, `job_schema_snapshot`, `job_validation`, `indexing_event`, `index_status`, `recruitment_prompt`, `ai_job_run`, `employer_claim`, `employer_evidence`, `application_event`

Snapshots only — AirReach does not silently overwrite live job body copy.

## Media-only: Preferred Sources

Preferred Sources belong in **AirReach Media**, not Recruit / Search for every SMB.

## Explicit non-goals (2026)

- Auto-generate every Schema.org type
- Revive deprecated rich-result patterns as product promises
- EmployerAggregateRating for sites without real user-generated employer reviews
- Claiming control over AI citation selection

## Build order

1. Lock Core contracts above — done  
2. **P0** Google Generative AI CSV Official into Studio / Platform — done  
3. **Recruit v0** URL / JSON-LD JobPosting validator + fix draft (no invented facts) — done  
4. Indexing API lifecycle (P1) — done (`/api/google/indexing/`, Recruit UI; needs `GOOGLE_INDEXING_*` on Vercel + Search Console owner)  
5. HackⅡ recruitment prompts (branded vs generic) — done (Recruit page; Jev default; Studio for live LLMs)  
6. Application flow (GA4 / ATS) — next  
7. Evidence Graph  
8. Recruitment Visibility Score only after data

### Indexing API env (Vercel only)

```text
GOOGLE_INDEXING_CLIENT_EMAIL
GOOGLE_INDEXING_PRIVATE_KEY
```

Service account must be added as a Search Console owner for the property. AirReach requires `confirm:true` for live notify; `dryRun` previews without calling Google.

## Public wording guard

| Avoid | Prefer |
|-------|--------|
| Google for Jobs に直接掲載 | 求人詳細ページ + JobPosting + クロール/インデックス対象になり得る状態へ整える |
| 上位表示させる | 掲載・順位・引用は保証しない |
| 求人AIO 73点 | 準備度 / 充足度 / 実測 / 応募導線を分離表示 |
