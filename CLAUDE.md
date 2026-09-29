# Trillion Bank website - Claude Code guide

The authoritative repository instructions are in `AGENTS.md`. Read that file before planning or editing.

## Required context order

1. `AGENTS.md`
2. `_data/public_facts.yml`
3. `_data/content_guardrails.yml`
4. `PUBLICATION_POLICY.md`
5. the target page, its includes/layouts, and related articles

## Working agreement

- Plan first; do not combine information architecture, copy, component refactoring, and deployment in one unreviewed edit.
- Use a feature branch and a pull request.
- Do not revive Regalis-era names, prices, claims, routes, or product definitions.
- Do not publish customer, investor, fundraising, cap-table, patent, partner-discussion, or private media information without an explicit approval marker.
- Keep AirReach Consulting (limited commercial validation) separate from Adctor (research / PoC).
- Treat structured data as a faithful description of visible content, not as a place to hide extra claims.
- Run `python3 scripts/content_guard.py` before every commit touching public content.
- Build Jekyll and visually inspect desktop/mobile pages before requesting review.

## Primary objective

Make Trillion Bank the clearest Japanese primary source for:

- AI検索
- AEO
- GEO
- LLMO
- AI検索の効果測定
- AI回答の引用元分析
- AI検索とSEOの違い
- AI検索を内製するか外部支援を使うかの判断

Authority comes from accurate definitions, transparent measurement methodology, primary-source citations, useful tools and examples, and consistent entity information - not from repeating keywords or unsupported superlatives.
