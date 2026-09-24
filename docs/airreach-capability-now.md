# AirReach — what ships now (2026-09-17)

## Deployable on GitHub Pages (no Vercel / no API keys)

| Capability | Route | Evidence class | Status |
|---|---|---|---|
| Public HTML diagnose | `/airreach/` | Observed | Live |
| Growth Impact simulator (manual) | `/airreach/platform/` | User Input × Inferred | Live |
| **GSC CSV → Official keyword metrics + visit baseline** | `/airreach/platform/` | Official → Inferred scenario | **Shipped this commit** |
| **GA4 CSV → Official sessions / key events baseline** | `/airreach/platform/` | Official | **Shipped this commit** |
| Studio keyword ledger + file generation | `/airreach/studio/` | User Input / draft | Live |
| **Keyword AIO（URL→指名/一般提案→キーワード別計測）** | `/airreach/keyword-aio/` | Estimated / Observed | **This branch** |
| Studio GSC/GA4/HackⅡ CSV/JSON timeseries | `/airreach/studio/` | Official / Observed | Live |
| Studio → Platform baseline handoff | shared `localStorage` | Official | Shipped |
| **Keyword Planner CSV → Official volume on Studio rows** | `/airreach/studio/` | Official | **Phase 2** |
| **HackⅡ JSON → mention/citation on Studio rows** | `/airreach/studio/` | Observed | **Phase 2** |
| **GitHub draft PR from Studio ZIP** | `/airreach/studio/` (user PAT in sessionStorage) | draft / human review | **Phase 2** |
| Publish checklist (no auto-deploy) | `/airreach/studio/` | n/a | **Phase 2** |
| **Diagnose → Simulator handoff** | `/airreach/` → `/airreach/platform/` | Observed score → Inferred uplift; Official GSC/GA4 auto-fill | **Shipped** |

## Code present, not live until infra

| Capability | Location | Blocker |
|---|---|---|
| Google OAuth | `api/google/*` | Vercel project + Client Secret |
| GSC / GA4 live sync | `api/google/gsc.js`, `ga4.js` | same |
| URL Inspection / PageSpeed | `api/google/url-inspection.js`, `pagespeed.js` | same |
| GitHub draft PR (Studio) | shipped (browser PAT) | merge + deploy remain human |
| GitHub App auto-merge / auto-deploy | not provided | intentional |

## Product rule

- Official numbers never get overwritten by Inferred labels.
- Simulation always says assumption-based / no guarantee.
- Keyword table shows Official impr/clicks/CTR/pos; +Click/+Inquiry columns are Inferred.
