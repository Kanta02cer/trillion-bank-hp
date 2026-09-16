# X / note 投稿自動化

## 目的

`_data/ai_search_partner_keywords.yml` の対策キーワードと、公開済み Insights 記事を結び、
**問い合わせフォームへの導線付き投稿**を継続生成する。

## できること / できないこと

| チャネル | 自動化範囲 | 理由 |
|---|---|---|
| X | 下書き生成 +（承認後）API投稿 | Twitter API v2 が利用可能 |
| note | 下書きMarkdown生成まで | 安定した公式投稿APIが無い |

## 運用フロー

1. 記事を `_tbnews/` に公開（`insight: true` + allowlist）
2. キーワードYAMLの `slug` / `status` を更新
3. 毎日 CI が下書きを `ops/social-publisher/outbox/YYYY-MM-DD/` に生成
4. 担当者が内容確認
5. Xは Actions の `x-publish` + `confirm=publish` で投稿
6. noteは outbox の `.note.md` を確認して手動公開

## ローカル確認

```bash
pip install pyyaml requests requests-oauthlib
python3 scripts/social/generate_queue.py --limit 3
python3 scripts/social/post_x.py --dry-run
python3 scripts/social/export_note.py
```

## Secrets

Repository secrets:

- `X_API_KEY`
- `X_API_SECRET`
- `X_ACCESS_TOKEN`
- `X_ACCESS_TOKEN_SECRET`

## ガードレール

- 成果保証・最上級表現は拒否
- CTA（お問い合わせ）必須
- 同一 keyword × article の再投稿は state で抑制
