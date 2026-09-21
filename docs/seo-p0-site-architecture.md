# SEO P0 — サイト情報設計（説明ページ vs ツール）

Date: 2026-09-20
Status: ACTIVE

## 方針

- 検索で勝たせるのは「説明ページ」。ツール画面を全部インデックスすることがSEOではない。
- 1検索意図 = 1代表URL（Keyword Ownership）。
- 「ページの概要」を Answer First ブロックとして全indexページへ。
- 顧客名・成果数字は書面承認があるものだけ。事例は当面 SAMPLE フレームワーク。

## 2事業構造

1. AI集客マーケティング … AirReach（調べる） / HackⅡ（測って直す）
2. AI情報利用管理 … Adctor（Pay per Crawl / Usage Ledger / Pay per Citation 等・R&D）

## Index / noindex（P0）

| URL | Index |
|---|---|
| `/` `/airreach/` `/trillionbank/ai-search/` `/trillionbank/business/*` `/trillionbank/case-studies/*` | index |
| `/airreach/result/` `/airreach/sales/**` `/airreach/studio/` `/airreach/platform/` | noindex |
| `/airreach/{industry}/` | 当面 noindex（固有化まで） |

## Keyword Ownership（代表URL）

| 語 | 代表URL |
|---|---|
| AI検索対策 | `/trillionbank/ai-search/` |
| AirReach | `/airreach/` |
| HackⅡ | `/trillionbank/business/hack2/` |
| Pay per Crawl | `/trillionbank/business/pay-per-crawl/` |
| Pay per Citation | `/trillionbank/business/pay-per-citation/` |
| AIO/GEO/LLMO/AEO | 用語記事へ。親は AI検索対策 |

## Studio Entity Lock

`assets/js/airreach-package-schema.js` の `validateEntityLock`。
ドメインと organization.url 不一致、機械的「関連 N」キーワードは公開ブロック。別ブランド痕跡（例: amasora）は **警告＋公開不可**（ドラフトZIPは可。Draft PRは不可）。
