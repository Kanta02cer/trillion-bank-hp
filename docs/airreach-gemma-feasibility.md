# AirReach × Gemma：サーバー側で動かせるかの調査と試作（2026-10-06）

状態：**調査と試作のみ**。本番・Vercel の設定・環境変数・Supabase・既存の AI 計測と月次集計には触っていない。費用は発生していない。
このリポジトリは公開なので、モデルの重み・顧客情報・キーは入れない（試作の材料は架空の本文と自社の公開ページだけ）。

## 結論（先に）

<!-- RESULT_SUMMARY -->

## 1. 候補のモデルとランタイム

| 項目 | 確認した内容 | 出典 |
|---|---|---|
| モデル | Gemma 4 E2B（指示調整版 `gemma-4-E2B-it`）。Apache-2.0、ゲートなし | Hugging Face `litert-community/gemma-4-E2B-it-litert-lm`（README・API） |
| CPU 用のファイル | `gemma-4-E2B-it.litertlm` **2,588,147,712 バイト（約2.6GB）**。テキスト専用の Web 版 `gemma-4-E2B-it-web.litertlm` は約2.0GB（WebGPU 用） | Hugging Face の API（ファイル一覧）と実際のダウンロード |
| 公式のメモリの目安 | E2B：BF16 11.4GB／Q4_0 2.9GB／Mobile 1.1GB／**Mobile（テキストのみ）0.84GB**。Mobile は LiteRT-LM の値 | https://ai.google.dev/gemma/docs/core |
| 0.84GB の意味 | 2/4/8bit の混合量子化で、テキストだけなら**重みのメモリが 0.8GB 程度**。別に **1.12GB の埋め込みをファイルからメモリマップ**で読む＝ファイルは 2.6GB、プロセスの使用量は 0.84GB に収まるとは限らない | モデルの README |
| 公式の実測（CPU） | Linux Arm（4スレッド）：prefill 260 tok/s・decode 35 tok/s・メモリ 1,628MB／MacBook Pro M4 Max：901・41.6・736MB／Windows Intel LunarLake：435・29.8・**3,505MB**（1024入力・256出力・文脈2048） | モデルの README |
| ランタイム | LiteRT-LM。Python の `litert-lm-api` 0.17.1（Apache-2.0）に **Linux x86_64 の wheel（manylinux_2_27・47MB）** と macOS arm64 がある。JavaScript はブラウザ用（Early Preview）で、Node.js 用は無い。C API の共有ライブラリあり | PyPI・https://github.com/google-ai-edge/LiteRT-LM |
| 出力の形 | JSON Schema に沿った出力（LL_GUIDANCE）ができる。思考（thinking）は切れる | `litert_lm` 0.17.1 の API（`ResponseFormat.json`・`ThinkingConfig`） |

## 2. 今の Vercel（読み取りで確認・2026-10-06）

| 項目 | 状態 | 確かめ方 |
|---|---|---|
| プラン | **Pro（active）** | Vercel API（チームの billing.plan） |
| Fluid compute | 有効 | プロジェクトの resourceConfig |
| 関数の既定 | メモリ **standard（2GB / 1vCPU）**・既定の時間 300秒・リージョン iad1（ワシントン D.C.）・Node.js 24 | 同上・`vercel project inspect` |
| 配信の仕組み | GitHub Actions が Jekyll の `_site` と `api/` を `vercel-deploy` ブランチ（**公開リポジトリ**）に置く。生成する `package.json` は依存なし、`vercel.json` は `buildCommand`・`installCommand` が null | `.github/workflows/deploy-vercel-static.yml` |
| 関数の上限（公式） | メモリ：Pro 最大 4GB / 2vCPU。時間：Pro 既定300秒・最大800秒。**大きさ：250MB（Python は 500MB）。Large functions（Beta）で 5GB**。Large functions は既存のプロジェクトでは環境変数 `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` で有効にする | https://vercel.com/docs/functions/limitations |
| 料金（iad1・Pro） | Active CPU $0.128/時間、Provisioned Memory $0.0106/GB時間（インスタンスが動いている間） | https://vercel.com/docs/functions/usage-and-pricing |

## 3. 今の構成に「そのまま」載せられない理由

1. **大きさ**：モデル 2.6GB は関数の上限（250MB・Python 500MB）を超える。Large functions（Beta・5GB）が要り、このプロジェクトでは**環境変数の追加（本番設定の変更）**が要る。このプロジェクトが「新しいプロジェクト」として既定で対象かは**未確認**
2. **重みの置き場所**：今の配信は公開リポジトリのブランチに成果物を push する方式。2.6GB の重みは公開 Git に入れない方針で、GitHub も 100MB を超えるファイルを受け付けない。→ Vercel のビルド中にダウンロードして関数に含めるか、CI から `vercel deploy --prebuilt` で直接送る方式に変える必要がある
3. **依存のインストール**：今の配信は依存を入れない（`installCommand: null`・依存なしの package.json）。Python の関数として `litert-lm-api` を入れたときに Vercel のビルドで入るかは**未確認**
4. **メモリ**：重みと埋め込みをファイルからメモリマップで読むため、メモリの上限が小さいとファイルの読み直しが増える（下の Mac の実測で、空きメモリが少ないときに同じ文章が 5秒→110秒になった）。2GB でどうなるかは Linux で上限をかけて測る必要がある
5. **同時の要求**：Fluid compute は1つのインスタンスに複数の要求を入れる。生成は CPU を占有するので、1インスタンス1件に絞る必要がある（試作の関数は処理中なら 429）

## 4. 試作（`tools/airreach-gemma/`）

- `gemma_faq.py`：サイトの本文 → FAQ の下書き（JSON）。**モデルの答えをコードで確かめる**：根拠が本文にそのままあるか／答えの数字が本文にあるか／「無料」「駐車場」などの言い切りが本文にあるか。外れたら「【確認が必要】」に差し替える。本文に埋め込まれた **AI への指示らしき文は本文から外す**（根拠にも使わせない）。要約は渡した数字以外が出たら捨てる
- `bench.py`：読み込み・最初の文字まで・全体の時間・ピークメモリを測る
- `test_gemma_faq.py`：確かめの部分のテスト（モデル不要・23件）
- `vercel-draft/`：Vercel の Python Function として置くときの下書き（**配置していない**）。既定で無効（`AIRREACH_GEMMA_ENABLED=true` のときだけ）、社内のログインだけ、入力 6000 文字・出力 1400 トークンまで、同時に1件、失敗しても外部の AI に切り替えない
- 既存の AI 計測・月次集計・レポートの計算には一切つながない（読み書きしない）

## 5. 実測

<!-- MEASUREMENTS -->

## 6. 出力の例

<!-- EXAMPLES -->

## 7. 選択肢と必要な最小変更

| 案 | どこで動くか | 必要な変更（本番・費用に関わるもの） | 長所 | 短所・リスク |
|---|---|---|---|---|
| **A. 別の Vercel プロジェクト（推奨の試し方）** | Vercel Functions（サーバー）。今の Pro チームに AI 専用のプロジェクトを1つ足す | ① プロジェクトの作成 ② そのプロジェクトだけに `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`・関数のメモリ 4GB・maxDuration 300〜800 ③ CI でモデルを取得し `vercel deploy --prebuilt` で送る（Vercel のトークンを GitHub の Secret に置く） | 今のサイト・API・配信の仕組みに触れずに試せる。失敗してもプロジェクトを消せば戻る | Large functions は Beta。使った分の料金（下の試算）。初回起動の時間は未測定 |
| B. 今のプロジェクトに足す | Vercel Functions（サーバー） | ① `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`（本番の環境変数）② 配信用 `vercel.json` に関数の設定とモデルのダウンロード（`buildCommand`）を足す ③ `api/airreach/gemma-faq.py`・requirements | URL が今の API と同じ | 配信の仕組みを変える＝サイト全体のデプロイに影響。重いビルドが毎回走る |
| C. ブラウザで動かす | **利用者の端末**（サーバーではない） | なし（ページに LiteRT-LM の JS か MediaPipe を足す） | サーバーの費用なし・本文が端末の外に出ない | 初回に約2.0GB のダウンロード。WebGPU が要る（対応ブラウザ・端末だけ）。GPU メモリ約1.8GB（公式）。画面を閉じると止まる。MediaPipe 経由は保守モード。端末ごとに速さが違う |
| D. AI 用のサーバーを別に用意 | 別のサーバー（VPS・Cloud Run など） | 契約・費用・運用（常時起動なら月額） | メモリ・CPU を選べる。読み込みを1回で済ませられる | 新しい契約と運用。今回の範囲外 |


## 8. 未確認の項目

<!-- UNKNOWN -->
