# Social publisher (X / note)

Trillion Bank の対策キーワード（`_data/ai_search_partner_keywords.yml`）と公開 Insights から、
X投稿文と note 下書きを自動生成し、承認後に配信する仕組みです。

## 方針

1. **下書き自動生成は常時ON**（ローカル / CI）
2. **Xへの実投稿は明示承認時のみ**（`workflow_dispatch` + `confirm=publish` + secrets）
3. **note は下書きMarkdown自動生成まで**（公式の安定した投稿APIが無いため）
4. 誇大表現・成果保証表現は `content_guard` / 本モジュール双方で拒否

## コマンド

```bash
# 今日分の下書きを生成（X + note）
python3 scripts/social/generate_queue.py --date 2026-09-15

# X に dry-run（投稿しない）
python3 scripts/social/post_x.py --dry-run

# X に本番投稿（要環境変数）
python3 scripts/social/post_x.py --publish

# note 下書きを outbox に書き出し
python3 scripts/social/export_note.py
```

## 必要な GitHub Secrets（X実投稿時）

- `X_API_KEY`
- `X_API_SECRET`
- `X_ACCESS_TOKEN`
- `X_ACCESS_TOKEN_SECRET`

※ 値はリポジトリにコミットしないこと。

## ファイル

- `_data/social_publish.yml` … 設定
- `ops/social-publisher/outbox/` … 生成された下書き（gitignore推奨の一部はstate）
- `ops/social-publisher/state/posted.json` … 投稿済みID
- `.github/workflows/social-publish.yml` … 日次生成 + 手動公開
