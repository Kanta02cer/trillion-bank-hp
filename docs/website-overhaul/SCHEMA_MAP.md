# Structured-data map

| Page type | Schema | Notes |
|---|---|---|
| all public pages | Organization + WebSite in shared head | approved facts only; stable `@id` |
| home | WebPage | no fake SearchAction unless site search exists |
| company | AboutPage / Organization reference | visible company facts must match public data |
| representative | ProfilePage + Person | only verified public profile and sameAs |
| HackⅡ | Service + WebPage + BreadcrumbList | no Product/AggregateOffer without approved public price and availability |
| Adctor | WebPage + ResearchProject | visibly describe research/PoC status |
| authority article | Article or TechArticle + WebPage + BreadcrumbList | author, reviewer, dates and sources |
| visible FAQ | FAQPage | render the same Q&A visibly |

Prohibited patterns include fake reviews, ratings, customers, awards, offers, certifications, a nonexistent parent organization, a SearchAction without working site search, machine-only prices, and media entries without confirmed rights.

## AIO diagnosis (2026-09-11) decisions

- Homepage now has visible FAQ + FAQPage.
- SearchAction is intentionally omitted (no site search).
- Homepage Article/Product are intentionally omitted (not an article; no public Product/Offer).
- BreadcrumbList on homepage root is optional; WebPage + FAQPage added instead.
