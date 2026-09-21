# SEO 301 / 統合候補（GSCゲート付き）

Date: 2026-09-20
Status: ACTIVE — **GSC確認前に301を有効化しない**
Data: `_data/seo_redirect_candidates.yml`
Worker: `ops/crawler-observability/src/index.ts` の `PENDING_REDIRECTS`

## なぜゲートが必要か

GitHub Pages単体では真のHTTP 301が弱い。本番の統合は Cloudflare Worker の `PERMANENT_REDIRECTS` で行う。
承認済み Insights は SEO integrity CI が **自己canonical** を要求するため、301と同時に:

1. 旧URLを `approved` から外す（または redirect レイアウト化）
2. `_config.yml` の index 許可を外す
3. Worker に 301 を追加してデプロイ
4. Search Console で旧URLの「削除」ではなく移転を監視

## GSCで見る判定（すべて満たしたら有効化可）

対象クエリ群で:

1. 代表URLと支援URLが **同じクエリで食い合っている**（インプレッションが分散）
2. 代表URLの方が CTR または掲載順位が安定して良い、または戦略上こちらを勝たせたい
3. 支援URLのユニーク流入（別意図）が小さい
4. 外部からの重要な被リンクが支援URLに集中していない（集中時は301より中身統合）

計測期間の目安: 公開後28日以上、または十分なインプレッション。

## 候補一覧（要約）

| From | To | 状態 |
|---|---|---|
| `/trillionbank/news/llmo-geo-aeo/` | `/trillionbank/news/seo-aeo-geo-aio-llmo-difference/` | pending — 用語カニバリ。誘導文は済 |
| `/trillionbank/news/aeo-tools-comparison/` | `/trillionbank/news/ai-search-tools-vendors/` | pending — 製品一覧→分類代表。価格変動記事 |
| （将来）効果測定の重複見出し | `ai-search-measurement-method` | watch |

`aeo-tools`（7軸）は代表へ誘導済みだが、意図が異なるため **当面301しない**。

## 有効化手順

1. `_data/seo_redirect_candidates.yml` の該当 `status` を `approved` に
2. Worker で `PENDING_REDIRECTS` から `PERMANENT_REDIRECTS` へ移す
3. Insights CI の `approved` から旧パスを削除し、旧記事を `layout: redirect` または noindex
4. `npm run deploy`（crawler-observability）
5. GSC「ページのインデックス登録」で旧→新を確認
