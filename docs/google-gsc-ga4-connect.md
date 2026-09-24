# Google Search Console / GA4 ライブ連携

## 何ができるか

AirReach Studio（`/airreach/studio/#google`）から:

1. Google アカウントで OAuth 接続
2. Search Console のクエリ×ページを Official として同期
3. GA4 の sessions / keyEvents を Official として同期

CSV フォールバックは維持されます。

## Vercel 環境変数

| 変数 | 必須 | 説明 |
|------|------|------|
| `GOOGLE_CLIENT_ID` | Yes | Google Cloud OAuth クライアント ID |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth クライアントシークレット |
| `GOOGLE_REDIRECT_URI` | Yes | `https://trillion-bank-hp.vercel.app/api/google/callback/` |
| `GOOGLE_FRONTEND_REDIRECT` | Recommended | `https://trillion-bank.jp/airreach/studio/` |
| `GOOGLE_GSC_SITE_URL` | Optional | 既定 `https://trillion-bank.jp/` |
| `GOOGLE_GA4_PROPERTY_ID` | Optional | GA4 **プロパティID（数字）**。測定ID `G-0XHQPCC4CF` ではない |

## Google Cloud 設定手順

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成／選択
2. API を有効化:
   - Google Search Console API
   - Google Analytics Data API
3. OAuth 同意画面（External または Internal）を設定。テストユーザーに接続する Google アカウントを追加
4. 認証情報 → OAuth クライアント ID（ウェブアプリ）
   - 承認済みリダイレクト URI: `https://trillion-bank-hp.vercel.app/api/google/callback/`
5. クライアント ID / シークレットを Vercel Production（と Preview 必要なら）へ登録
6. Search Console で `https://trillion-bank.jp/`（またはドメインプロパティ）への閲覧権限があるアカウントで接続
7. GA4 管理 → プロパティ設定 から **プロパティ ID（数字）** を Studio の入力欄へ

## 接続フロー（技術）

GitHub Pages（trillion-bank.jp）と Vercel API が分かれているため:

1. Studio「Googleで接続」→ Vercel `/api/google/auth/`
2. Google 同意 → `/api/google/callback/`
3. コールバックが Studio へリダイレクトし、トークンを URL hash 経由で `sessionStorage` へ保存
4. 同期 API は `Authorization: Bearer` で呼ぶ（Cookie は補助）

トークンはブラウザの sessionStorage のみ。リポジトリへ保存しない。

## Studio 操作

1. `/airreach/studio/` →「Google連携」
2. GSC サイト URL を確認（既定: `https://trillion-bank.jp/`）
3. GA4 プロパティ ID を入力して保存
4. 「Googleで接続」
5. 期間を選び「GSC」「GA4」で同期

## 限界

- 掲載・順位・問い合わせ・売上は保証しない
- OAuth 未設定時は CSV のみ
- GA4 測定 ID（G-XXXX）では Data API を呼べない
- 接続アカウントに GSC / GA4 の権限が必要
