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


## Secrets 設定手順（X）

1. [X Developer Portal](https://developer.x.com/) でプロジェクト／アプリを作成
2. アプリ権限を **Read and write** にする
3. API Key / API Secret / Access Token / Access Token Secret を発行
4. ローカルで（値はチャットやgitに書かない）:

```bash
export X_API_KEY='...'
export X_API_SECRET='...'
export X_ACCESS_TOKEN='...'
export X_ACCESS_TOKEN_SECRET='...'
chmod +x scripts/social/setup_x_secrets.sh
./scripts/social/setup_x_secrets.sh
```

5. GitHub Actions で `Social draft generation` を `generate` → `x-dry-run` の順に実行
6. note は `ops/social-publisher/outbox/` の `.note.md` を確認して手動公開
