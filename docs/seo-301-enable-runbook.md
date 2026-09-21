# 301有効化ランブック（GSC後・実行用）

Date: 2026-09-20
Companion: docs/seo-redirect-candidates.md / `_data/seo_redirect_candidates.yml`

**このドキュメントは実行手順書。GSC判定が終わるまで Worker のコメントを外さない。**

## A. 判定（人）

候補IDごとに:

1. GSC「クエリ」で from/to の重複を確認（28日+推奨）
2. `_data/seo_redirect_candidates.yml` の `status` を `approved` に変更
3. PRレビューで承認

## B. コード変更（1候補ずつ）

例: `terminology-llmo-geo-aeo`

1. `ops/crawler-observability/src/index.ts`
   - `PENDING_REDIRECTS` の該当行を `PERMANENT_REDIRECTS` へ移動（コメント解除）
2. `_tbnews/2026-07-26-llmo-geo-aeo.md`
   - 案1: front matter に `layout: redirect` + `redirect_to: /trillionbank/news/seo-aeo-geo-aio-llmo-difference/`
   - 案2: robots noindex のまま誘導のみ（被リンク保全を優先する場合）
3. `.github/workflows/seo-integrity.yml` の `approved` から旧パスを削除（redirect化する場合）
4. `_config.yml` の旧パス index 許可を削除
5. Insightsハブに旧URLが残っていれば代表のみに

## C. デプロイ

1. サイトPRをマージ（GitHub Pages）
2. `ops/crawler-observability` で `npm run check && npm run deploy`
3. `curl -I https://trillion-bank.jp/trillionbank/news/llmo-geo-aeo/` が 301 で to を返すことを確認

## D. 監視（14日）

- GSC: 旧URLの「リダイレクト」・新URLの掲載
- 404が増えていないか
- 問題があれば Worker から当該301を外してロールバック
