# 掲載実績の台帳と、サービス・記事の構造化データ接続

Date: 2026-09-27
Status: ACTIVE
Source: 「AI検索でのメディア引用 技術設計・実装ガイド」2026-09-22

## 目的

掲載実績（記事・出演）を1つの台帳に持ち、メディアページの本文と JSON-LD を同じデータから出す。
自社サービスに `@id` を付け、記事側の `about` と自社側の `subjectOf` で結べる状態にする。
構造化データは可視本文の忠実な記述であり、追加の主張を隠す場所ではない。

## 唯一の定義

| 何 | 場所 |
|---|---|
| 掲載実績 | `_data/media_coverage.yml` |
| サービスの URL と `@id` | `_data/public_facts.yml` → `products.*.url` / `schema_id` |
| 会社・代表・サイトの JSON-LD | `_includes/tb-entity-jsonld.html`（`tb-head.html` と `_layouts/corp.html` が読む） |
| `subjectOf` の生成 | `_includes/tb-media-subjectof.html`（`scope="organization" / "ceo" / "service:<id>"`） |

## 台帳の行（資料の CMS 設計に対応）

`id, kind, kind_label, schema_type, headline, publisher, url, published_at, summary, article_type, subjects, service_ids, approval, checked_at, link_status, related_post`

公開ルール:

- `approval.status: approved` かつ `url` ありの行だけ JSON-LD（`subjectOf`、メディアページの `ItemList`）に出す。
- URL の無い行（掲載予定）は本文カードだけ。`link_status` と `checked_at` でリンク切れ確認を回す。
- `subjects` で Organization / Person のどちらに付けるかを決める（旧会社時の掲載は `ceo` のみ）。
- `service_ids` にサービスを入れると、そのサービスの `Service.subjectOf` にも出る。
- `sameAs` には掲載URLを入れない（同一性の関係ではない）。

## サービスの `@id`

| サービス | `@id` | 出力箱所 |
|---|---|---|
| HackⅡ | `/trillionbank/business/hack2/#service` | `trillionbank/business/hack2/index.html` |
| AirReach | `/airreach/#service` | `_includes/airreach-app.html`（`/airreach/` のみ） |
| Adctor / Pay per Crawl | `/trillionbank/business/pay-per-crawl/#service` | `trillionbank/business/pay-per-crawl/index.html` |

Organization の `makesOffer` は同じ `@id` を参照する。

## 記事側（自社 Insights）

`_layouts/tb-article.html` のフロントマター:

- `about_service: hack2` … 記事の主題がそのサービスのとき。`WebPage.about` と `Article.about` が Service の `@id` を指す。
- `mentions_services: [airreach]` … 触れただけのとき。`Article.mentions` に出る。
- 指定が無ければ従来どおり Organization が `about`。

## 統合した重複

- Organization JSON-LD は `tb-head.html`・`_layouts/corp.html`・`_layouts/tb-article.html` の3か所にあり、`sameAs` や `subjectOf` の内容が食い違っていた。`tb-entity-jsonld.html` に一本化し、記事レイアウトは `@id` 参照だけにした。
- CEO ページの `Person.subjectOf` も台帳から出す。

## 未対応（意図的に残したもの）

- トップページのメディア帯は画像付きの直書き。画像の許諾管理と合わせて次で台帳へ寄せる。
- `knowledge.json` の出演URL直書き。
- 掲載日（`published_at`）は元記事で確認できたものだけ入れる。現状は `null`（画面では「確認中」）。

## 受入確認（資料 06 に対応）

1. `python3 scripts/content_guard.py`
2. `bundle exec jekyll build` → `/trillionbank/media/`・`/trillionbank/ceo/`・`/trillionbank/business/hack2/`・`/airreach/` の JSON-LD を Schema Markup Validator で確認
3. `subjectOf` の見出し・URL・媒体名が本文カードと一致
4. Search Console の URL 検査で取得・索引状態を確認
