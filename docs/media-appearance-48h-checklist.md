# 出演・掲載後 48時間チェックリスト

Date: 2026-09-20
Status: ACTIVE
Owner: 広報 / 代表 / サイト更新担当
Companion: docs/eeat-media-authority-strategy.md /trillionbank/media/press-kit/

出演・外部記事・登壇の公開を知ってから **48時間以内** に完了する。

## 0. 入力（公開直後）

- [ ] 媒体名・番組名 / URL / 公開日
- [ ] 分類: 代表出演 / 会社掲載 / 代表者 過去掲載 / 掲載予定 / 確認中
- [ ] 許諾: サムネ・ロゴ・引用の可否
- [ ] スクショ保存（社内のみ。未許諾は公開しない）

## 1. エンティティ照合（必須）

Press Kit と突合する。

- [ ] 法人名が「株式会社Trillion Bank」または通称の正しい組み合わせ
- [ ] 旧社名 Regalis を現在の商号にしていない
- [ ] 銀行・金融機関としての誤認がない
- [ ] HackⅡ と Adctor を混同していない
- [ ] 保証・未承認顧客名・価格の勝手記載がない
- [ ] 誤りがあれば媒体へ訂正依頼（文面は事実のみ）

## 2. 自社サイト同期

- [ ] `_data/media_coverage.yml` に1行追加（媒体・URL・掲載日・要約・記事区分・subjects・service_ids・approval）。カードと `subjectOf` はここから自動生成される
- [ ] `approval.status: approved` は書面確認後にだけ付ける。URLが無い間は本文カードのみ出る
- [ ] `/trillionbank/ceo/` の実績セクション本文を同期（`subjectOf` は台帳から自動）
- [ ] 関連 Insights から **1本だけ** 文脈リンク（キーワード詰め込み禁止）
- [ ] `public_facts.yml` に無い新事実を書いていないか確認
- [ ] `python3 scripts/content_guard.py` を実行

## 3. 発見性（任意・許諾後）

- [ ] TOPのメディア帯に載せるか判断（常設は厳選）
- [ ] SNSは事実リンクのみ。誇張キャプション禁止
- [ ] 外部からの被リンク依頼は Press Kit URL を渡す

## 4. 完了記録

- [ ] 完了日時と担当を社内メモへ
- [ ] 未解消の訂正があれば「確認中」のまま Media に残す

## 止める条件

顧客名・成果数字・投資家情報・未許諾映像の公開。迷ったら出さず承認を取る。
