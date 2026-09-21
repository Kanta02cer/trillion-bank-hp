# AirReach業種ページ — index復帰ゲート

Date: 2026-09-20
Status: ACTIVE — 当面 **noindex 維持**
Data: `_data/airreach_industries.yml`

## 対象URL

- `/airreach/restaurant/`
- `/airreach/clinic/`
- `/airreach/b2b/`
- `/airreach/media/`
- `/airreach/other/`

いずれも `_config.yml` と front matter で `noindex, follow`。

## 固有化の最低条件（すべて必須）

1. [x] 業種固有の H1 / lead / page_summary（データ駆動）
2. [x] 業種固有の焦点・質問例・FAQ（HTMLとしてクロール可能）
3. [x] FAQPage 構造化データが可視FAQと一致
4. [ ] 親の `/airreach/` と意図が食い違うクエリで、業種ページ側に明確な需要がある（GSCまたはキーワード調査）
5. [ ] ツールUIの文言が業種ページ間で実質コピーになっていない（診断ロジックは共通で可）
6. [ ] 保証・誇張・未承認数字なし（content_guard）

## index に切り替える手順

1. 上記チェックを満たす
2. 各 `airreach/*/index.html` の `robots` を index 系へ
3. `_config.yml` の該当 `scope.path` の noindex を削除または上書き
4. SEO integrity / content_guard / 目視
5. 公開後、GSCでカバレッジを監視

**今は切り替えない。** 固有コピーを先に積んだ状態。
