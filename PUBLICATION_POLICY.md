# Trillion Bank public information policy

Last reviewed: 2026-09-05

## Purpose

This policy separates public corporate information from internal operating, financing, legal, technical, and partner information. It applies to pages, metadata, structured data, `llms*.txt`, JSON feeds, images, downloadable files, GitHub Pages build output, and automated article generation.

## Publication classes

| Class | Meaning | Default action |
|---|---|---|
| PUBLIC | Approved company, service, methodology, or contact information | May publish if current |
| PUBLIC_WITH_SOURCE | External or quantitative claim with an authoritative source and date | Publish with source and scope |
| APPROVAL_REQUIRED | Named customer, partner, media, case study, result, product availability, or legal claim | Do not publish until approved |
| CONFIDENTIAL | Investor, cap table, valuation, cash, contract, unpublished patent, credentials, private discussions | Never publish |

## Approved public facts

The machine-readable source is `_data/public_facts.yml`. Pages may paraphrase those facts without changing their meaning.

## Product-status language

Use these status labels consistently:

- AirReach Consulting: `限定商用検証・導入相談受付`
- Adctor: `研究開発・PoC相談`
- Roadmap capabilities: `構想` or `検討中`

Do not use `提供中`, `正式リリース`, `導入実績`, or `対応済み` unless the underlying evidence and approval are recorded.

## Claims and evidence

A public claim must answer:

1. What exactly is being claimed?
2. For which product, date, population, model, query set, or geography?
3. Is it measured, supplied by a customer, estimated, or planned?
4. Where is the primary evidence?
5. Who approved external use?

A claim that cannot answer all relevant questions is omitted or marked as a hypothesis.

## Media and third-party rights

Text may describe a confirmed appearance conservatively. Logos, thumbnails, video clips, stills, photographs, quotations, and co-star names require the relevant rights and approvals. Being visible in a program does not transfer the program's copyright.

## Automation

Automated article workflows may create drafts, but they may not publish directly to the public collection unless:

- sources are primary and current;
- the content guard passes;
- the page has a human reviewer and review date;
- visible content and structured data match;
- no restricted term or private data is introduced.

## Removal and correction

When an error or rights concern is reported, pause promotion immediately. Correct the source page, metadata, structured data, machine-readable files, and dependent generated files together. Add a visible correction note when the change is material.
