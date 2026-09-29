# Trillion Bank website - Codex operating guide

## Mission

This repository publishes the corporate website of **株式会社Trillion Bank** at `https://trillion-bank.jp/`.
The public site must help a reader understand, within 30 seconds:

1. what Trillion Bank does;
2. what AirReach Consulting measures;
3. what is available now and what remains research / PoC;
4. where to ask for a business discussion.

The site is not a data room, cap table, product backlog, patent draft, investor memo, or internal sales notebook.

## Current stack

- Jekyll on GitHub Pages
- Liquid templates
- shared partials under `_includes/`
- shared layouts under `_layouts/`
- corporate content under `trillionbank/`
- articles under `_tbnews/`
- public data under `_data/`
- no secret, token, API key, customer data, investor term, or private contact list may be committed

## Source of truth

Before changing public copy, read:

1. `_data/public_facts.yml`
2. `_data/content_guardrails.yml`
3. `PUBLICATION_POLICY.md`
4. the relevant page and its structured data

When sources conflict, use the newest explicitly approved public fact. Do not reconcile conflicting numbers by guessing. Mark the item `確認中` or omit it.

## Public positioning

### Company

Trillion Bank is a technology company that works on the measurement and governance of information in AI search and AI-agent environments. It is **not a bank or financial institution**.

### AirReach Consulting

AirReach Consulting measures and stores selected AI answers, cited URLs, brand/competitor mentions, measurement conditions, and changes over time so that companies can make evidence-based decisions about AI-search visibility.

Current public status: **limited commercial validation / implementation consultation**.

Do not claim that AirReach Consulting:

- guarantees inclusion, rankings, traffic, leads, bookings, or revenue;
- measures every AI surface;
- fully identifies why a model selected an answer;
- is a fully self-serve or fully automated production SaaS;
- automatically publishes fixes;
- already includes Pay per Crawl, x402, billing, or revenue sharing.

### Adctor / Pay per Use

Adctor is a separate research and PoC program for AI-content access, licensing, usage evidence, and future billing workflows. It is not a completed commercial settlement network. Keep it visually and contractually separate from AirReach Consulting.

## Information that must not be published without written approval

- customer names, logos, contracts, domains, dashboards, measurements, or case-study numbers;
- investor names, proposed investments, valuation, cap table, share counts, negotiation limits, bank balance, runway, monthly revenue, or fundraising targets;
- unreleased patent claims, diagrams, technical novelty arguments, or filing strategy;
- private partner discussions or names of companies only introduced / under discussion;
- personal phone numbers, non-public email addresses, IDs, credentials, tokens, private addresses, or private schedules;
- unpublished program footage, logos, stills, backstage details, contract terms, or third-party statements;
- unsupported superlatives such as `世界初`, `日本初`, `業界唯一`, `圧倒的`, `完全自動`, `必ず`, `保証`;
- an old Regalis brand, old pricing, old product names, or old company address as current facts.

## Content rules

- Write for a real decision-maker, not for a crawler.
- Use answer-first headings and short definitions, but do not keyword-stuff.
- Every non-obvious external claim requires a primary source link and an `as of` date.
- Structured data must match visible page content.
- `llms.txt` is an optional machine-readable index, not a ranking guarantee.
- Use only schema types that describe visible content. Never create fake ratings, reviews, awards, customers, certifications, or offers.
- Separate `measured`, `customer supplied`, `estimated`, and `planned` values.
- Distinguish product availability from roadmap.
- Prices stay off public pages unless `_data/public_facts.yml` explicitly marks them public.

## Design rules

- White / quiet gray base, Trillion navy and blue accent.
- Large conclusion-led headings, generous whitespace, no dense microcopy.
- One section, one message.
- Product proof uses actual approved screenshots; mockups must say `SAMPLE`.
- All interactive controls must be keyboard accessible.
- Respect `prefers-reduced-motion`.
- Avoid layout shift by specifying image dimensions.

## Required workflow

1. Audit before editing. List affected routes, templates, data, schemas, redirects, and risks.
2. Create or use a feature branch. Never push a large refactor directly to `main`.
3. Make one coherent phase at a time.
4. Run the content guard, Jekyll build, HTML checks, and browser checks.
5. Inspect desktop and mobile screenshots for home, AirReach Consulting, insights, company, and contact.
6. Check console errors, broken links, canonical URLs, structured data, robots, and sitemap.
7. Open a pull request with facts changed, routes changed, screenshots, test results, and unresolved approvals.

## Commands

Use the repository's actual scripts when present. At minimum, run:

```bash
python3 scripts/content_guard.py
bundle exec jekyll build
```

Then serve `_site` and use Playwright / browser tooling for visual and interaction checks.

## Stop conditions

Stop and request approval when a change would:

- publish a named customer, investor, partner, media asset, or measured result;
- change a legal page or commercial commitment;
- add public pricing;
- claim a product capability not demonstrated in the repository;
- delete a live route without a redirect plan;
- expose a secret or private document;
- alter analytics, consent, form destinations, or production deployment credentials.
