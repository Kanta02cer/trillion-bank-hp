# MANUAL_INPUT_REQUIRED.md — Founding Monitor LP

> 公開前に以下を確認・差し替えしてください。

## ロゴ・画像

| 項目 | 現在 | 必要な対応 |
|---|---|---|
| AirReach Consultingロゴ（Primary） | 未設置（ナビにTBロゴのみ） | AirReach ConsultingロゴをHero付近またはプログラム欄に追加 |
| AirReach Consultingロゴ（White） | 未使用 | ダーク背景CTAセクションに使用可 |
| Trillion Bankロゴ | `/images/hero/tb-logo-color.webp` 使用中 | 正式版に差し替え不要か確認 |
| AirReach Consulting実画面スクリーンショット | イメージ画像（09_dashboard_mockup）表示中 | 公開許可済みの実画面が用意でき次第差し替え |

## フォーム送信先

| 項目 | 現在 | 必要な対応 |
|---|---|---|
| フォーム送信先 | `localStorage`にバックアップ保存（デモ用） | Formspree / Google Forms / CRM webhook に接続 |
| 営業通知先メール | 未設定 | 通知先メールアドレスを設定 |
| 自動返信送信元 | 未設定 | フォームサービス側で設定 |

## URL・リンク

| 項目 | 現在 | 必要な対応 |
|---|---|---|
| 商談予約URL | `https://calendar.app.google/AdGZLYVzDAfJk31G8` | 正式URLに差し替え |
| プライバシーポリシー | `/trillionbank/privacy/` | 正式URLを確認 |
| LP公開先 | `/lp/hack2/founding-monitor/` | `trillion-bank.jp/lp/hack2/founding-monitor/` で表示確認 |

## 表記・コンテンツ

| 項目 | 現在 | 必要な対応 |
|---|---|---|
| Founding Monitorの募集残数 | 「先行受付中（社数限定）」 | 具体的な残数を入れる場合はここを変更 |
| 本番検証済みAI | 「本番検証済み 1エンジン」 | エンジン名を記載する場合はここを変更 |
| 公開可能な顧客事例 | 未掲載 | 許可済みの事例がある場合はセクション追加 |
| 公開可能な会社実績 | 未掲載 | 導入社数等を掲載する場合はセクション追加 |

## セキュリティ・コンプライアンス

| 項目 | 現在 | 必要な対応 |
|---|---|---|
| スパム対策 | ハニーポット＋二重送信ガード | reCAPTCHA or Turnstile 追加を検討 |
| GA4イベント | `founding_monitor_submit` （domain, inquiry_type, source_page） | 個人情報を含まないことを確認 |
| 同意チェックボックス | プライバシーポリシー＋成果非保証を記載 | 法務確認 |

## 最終公開承認

| 項目 | 担当 |
|---|---|
| 最終公開承認者 | （要指定） |
| 公開日 | （要決定） |
