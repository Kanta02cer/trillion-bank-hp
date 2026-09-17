# AirReach — what ships now (2026-09-17)

## Deployable on GitHub Pages (no Vercel / no API keys)

| Capability | Route | Evidence class | Status |
|---|---|---|---|
| Public HTML diagnose | `/airreach/` | Observed | Live |
| Growth Impact simulator (manual) | `/airreach/platform/` | User Input × Inferred | Live |
| **GSC CSV → Official keyword metrics + visit baseline** | `/airreach/platform/` | Official → Inferred scenario | **Shipped this commit** |
| **GA4 CSV → Official sessions / key events baseline** | `/airreach/platform/` | Official | **Shipped this commit** |
| Studio keyword ledger + file generation | `/airreach/studio/` | User Input / draft | Live |
| Studio GSC/GA4/HackⅡ CSV/JSON timeseries | `/airreach/studio/` | Official / Observed | Live |
| Studio → Platform baseline handoff | shared `localStorage` | Official | **Shipped this commit** |

## Code present, not live until infra

| Capability | Location | Blocker |
|---|---|---|
| Google OAuth | `api/google/*` | Vercel project + Client Secret |
| GSC / GA4 live sync | `api/google/gsc.js`, `ga4.js` | same |
| URL Inspection / PageSpeed | `api/google/url-inspection.js`, `pagespeed.js` | same |
| GitHub PR auto-create | planned | GitHub App / token + approval |

## Product rule

- Official numbers never get overwritten by Inferred labels.
- Simulation always says assumption-based / no guarantee.
- Keyword table shows Official impr/clicks/CTR/pos; +Click/+Inquiry columns are Inferred.
