# AirReach Keyword AIO（キーワード別AIO分析）

## Purpose

公式サイトURLとエンティティ（会社・代表・サービス）から、ユーザーが実際に調べそうな **指名検索** / **一般検索** キーワードを提案し、キーワードごとに AI 言及・公式引用・（任意）第三者メディア引用を計測する。

## Routes

| Surface | Path | robots |
|---------|------|--------|
| Keyword AIO UI | `/airreach/keyword-aio/` | noindex |
| Studio link | `/airreach/studio/#keywords` →「URLからキーワード別AIO」「URLから提案」 | noindex |

## APIs

| Endpoint | Role |
|----------|------|
| `POST /api/keyword-suggest/` | URL/本文 → branded + generic prompts |
| `POST /api/hack2-measure/` | prompts[] → perKeyword mention/citation/media + score |

## Evidence

- Jev: Estimated（ページ本文からの推定）
- ChatGPT / Claude / Perplexity: Observed（環境変数キーがある場合のみ）
- スコア: 言及50% + 公式引用30% + メディア引用20%（ローカル指標。AI選出確率ではない）

## Non-claims

掲載・引用・順位・流入・売上は保証しない。第三者メディアURL指定は「引用監視」であり、引用されやすさの保証ではない。

## LINE / MediCure context

顧客要望の「とは / 評判 / 比較」系と、Infoseek 等メディア記事の引用観測を、保証なしの計測ワークフローとして実装。
