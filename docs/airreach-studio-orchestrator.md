# HackⅡ Studio — Overview Orchestrator (Phase 1)

## Product shape

Studio is an **execution OS**, not a multi-panel analysis tool.

User steps (visible):

1. Enter URL, goal, keyword count, region
2. Press **サイト全体を分析する**
3. Watch one progress rail
4. Read 4 numbers + one conclusion
5. Review keyword strategy table
6. Download **AI実装パッケージ (ZIP)**

Expert panels (gap / competitors / generator / keywords / timeseries / Google / HackⅡ) stay available under **Expert View** only.

## Evidence rules

| Field | Allowed sources | Must not mix with |
|-------|-----------------|-------------------|
| Market demand (月間検索需要) | Estimated model | GSC impressions |
| GSC Impressions | Official CSV / OAuth | Market demand label 「検索回数」 alone |
| Acquisition score | Observed diagnose or Estimated placeholder | AI mention/citation rates |
| Prompts / actions | Inferred generation | Guarantees of rank/citation |

## Phase 1 pipeline

```text
URL + goal + kwLimit + region
→ site understand (diagnose or estimated)
→ competitor stubs (estimated from industry)
→ keyword candidates (limit 20/50/100)
→ attach estimated volumes (+ optional GSC impressions)
→ AI prompts per keyword
→ gap → priority actions compressed to N pages
→ artifact bundle → ZIP download
```

GitHub PR, Keyword Planner, live HackⅡ, and production deploy are **Phase 2+** (UI may show disabled controls).

## Phase 1.5 (usability / real data)

Keep the same Overview flow. Additions:

- Optional **GSC Performance CSV** on Overview (Official impressions; never mixed into market demand)
- Soft-match GSC queries onto keyword rows; high-impression queries become keyword seeds
- Prefill URL / service / goal from `?url=` query, onboard survey, diagnose handoff, or last Studio profile
- Restore last completed job from `localStorage`
- Keyword table: priority filter, GSC column, show-more, CSV export
- Diagnose uses `allowProxy` from the consent checkbox; score shows Observed vs Estimated
- Service name field drives keyword generation (falls back to page H1 / title)



## Phase 2 (human-approved handoff)

Same Overview flow. Additions that stay browser-local unless infra is connected:

1. **Keyword Planner CSV** — Official monthly volume on matching rows (`volume_source: Official`). Unmatched rows stay Estimated.
2. **HackⅡ measurement JSON** — mention / citation rates on keyword rows (Observed). Not mixed into acquisition score.
3. **GitHub draft PR** — user PAT in `sessionStorage` only; creates a **draft** PR from the ZIP files. No auto-merge.
4. **Publish checklist** — validation UI only. **No production auto-deploy.**
5. **Optional** `/api/google/gsc` sync from Expert View when Vercel Google OAuth is configured; otherwise CSV remains the path.

```text
deployment_run: { type: github_draft_pr, status: awaiting_human_review, auto_deploy: false }
```

## Browser data model (local)

- `analysis_job`: id, status, keyword_limit, locale, goal, url, steps[], result
- `keyword_candidate`: keyword, volume, volume_source, intent, priority, prompts[], gap, action
- `prompt_candidate`: prompt, intent, commercial_score
- `artifact_bundle`: files map + MANIFEST.json + AGENT_PROMPT.md

Persisted in `localStorage` key `airreach_studio_orch_v1`.

## ZIP package (Phase 1+)

詳細な設計図・列定義・ERは [`airreach-studio-package-blueprint.md`](./airreach-studio-package-blueprint.md) を正とする。

```text
airreach-implementation/
  README.md
  MANIFEST.json
  AGENT_PROMPT.md
  strategy/keywords.csv
  strategy/prompts.csv
  strategy/actions.csv
  schema/*.jsonld
  public/llms.txt
  public/llms-full.txt
  content/faq.md
  validation/VALIDATION.md
```

Rules baked into AGENT_PROMPT:

- Do not invent prices, cases, customers, or metrics
- JSON-LD must match visible content
- Human approval before production publish

## Package blueprint

ディレクトリ構造・ER・CSV列・GitHub配置の設計図: [`docs/airreach-studio-package-blueprint.md`](./airreach-studio-package-blueprint.md)

## Related code

- `assets/js/airreach-orchestrator.js` — job state machine + UI bind for Overview
- `assets/js/airreach-orch-phase2.js` — Planner CSV, HackⅡ JSON, draft PR, publish checklist
- `assets/js/airreach-studio.js` — Expert panels + package helpers
- `airreach/studio/index.html` — Overview command center


## データモデル拡張（Phase 1 ローカル / Phase 2+ サーバ）

```text
analysis_job
keyword_candidate   (volume_source: Estimated | Official)
prompt_candidate
competitor_observation  (Phase 1: stub / Estimated)
artifact_bundle
generated_file
deployment_run          (Phase 2+: GitHub PR)
```
