# AirReach 開発記録（最新）

最終更新: 2026-10-05。古い記録（airreach-capability-now.md など）と食い違うときは、この記録と実装を優先する。

## 2026-10-05: AI計測の引用元・10問・定期計測・月次集計・改善資料・構造化データ

PR は順に積んである（先にマージするものが下）。どれも未マージ。

| PR | テーマ | 状態 |
|---|---|---|
| #134 | ① 引用元の取得と判定（言及・AI の出典・本文の URL を区別） | 検証済み・未マージ |
| #135 | ② 質問10問を漏れなく計測（5問ずつに分けて送る） | 検証済み・未マージ（#134 の上） |
| #136 | ③ 定期計測の仕組み（既定は無効・DB は未適用） | 検証済み・未マージ（#135 の上） |
| #137 | ④ 月次集計と根拠の確認 | 検証済み・未マージ（#136 の上） |
| #138 | ⑤ サイトの事実で FAQ の下書き・確認が必要な箇所 | 検証済み・未マージ（#137 の上） |
| #139 | ⑥ 構造化データの業種ごとの不足判定 | 検証済み・未マージ（#138 の上） |

### 判定と数え方（決めたこと）

- 回答ごとに分けて記録する: `mentioned`（社名への言及）／`cited_by_sources`（AI が返した出典に自社サイト）／`self_url_in_text`（回答の本文の URL に自社サイト）
- `cited`（引用率に使う値）は、出典の一覧 → 無ければ本文の URL → どちらも無ければ **null（0 にしない）**。`cite_source` に判定方法
- 回答の状態 `status`: ok / not_shown（Google の AI による概要が出なかった）/ error（その質問だけ失敗）。not_shown と error は割合の分母に入れず件数で出す
- 引用率 ＝ 自社サイトが引用された回答 ÷ 引用の有無を判定できた回答（分子・分母も出す）。判定できない回答 ＝ 回答 − 判定できた数
- 月次レポート・ホームのタイルは **その月のすべての計測の合計**。最新1回は `ai.latest` に別に残す。前月との差は、両方の月が同じ質問の版1つだけのとき
- FAQ の下書き: サイトの本文に書かれた値だけで答えを作り、元の記載（前後の文と URL）を付ける。見つからない質問は「【確認が必要】」。検索や AI が読む形（faq.jsonld）には、サイトの記載から作った答えだけ
- 構造化データの不足: 業種ごとの必要な項目と JSON-LD の項目を比べる。ページの本文にだけある値は「その値で直せる」と示す。ページを確かめていないとき（月次レポート）は「ページにも無い」と言わない

### 本番の状態（2026-10-05 確認）

- Vercel の本番の環境変数（名前だけ確認）: `AI_GATEWAY_API_KEY`・`SERPAPI_API_KEY`・Supabase・Google OAuth・`TYPESAFE_API_KEY`・`AIRREACH_STUDIO_KEY`。**`PERPLEXITY_API_KEY`・`ANTHROPIC_API_KEY`・`OPENAI_API_KEY`・`GEMINI_API_KEY`・`CRON_SECRET`・`AIRREACH_SCHEDULE_ENABLED` は無い**
- 本番のキーは Sensitive のためローカルに取り出せない（`vercel env pull` は値が入らない）。実際の AI での確認は、反映後に本番の計測で行う
- お客様の権限（本番 DB で、お客様のログインを rollback するトランザクションで再現・書き込みなし）: お客様のメンバー1人 → 見える顧客は自社1件・レポート0件（本番の2件はどちらも未公開）・他社の計測0・スタッフ一覧0・is_staff=false。公開済みレポートが見えることは本番に公開済みが無いため、ローカルの RLS テストで確認
- 定期計測の表（measurement_schedules・measurement_jobs）は本番に未適用。自動実行の経路（cron）も無い

### 費用の見込み（1回答あたり・定期計測の上限判定に使う。`AIRREACH_COST_PER_ANSWER` で上書き）

ChatGPT 検索なし 0.0003／ChatGPT 検索あり 0.015（9/30 実測）／Claude 検索 0.02／Perplexity 0.006／Gemini（Google 検索）0.035／AI による概要（SerpApi・最大2回）0.03／AI モード 0.015 ドル。SerpApi は Free Plan（月250回）

### 必要な判断

1. 出典の取得: Perplexity の出典を取るなら `PERPLEXITY_API_KEY`（AI Gateway は渡さない）。Claude を直接使うなら `ANTHROPIC_API_KEY`（検索 1,000回 10ドル＋トークン）。ChatGPT（検索あり）は AI Gateway の有料クレジットか `OPENAI_API_KEY`。Gemini は `GEMINI_API_KEY`
2. 定期計測: 対象の AI・質問・曜日・回数・月の上限（回答数・費用）。「月192回答」は初期案のまま固定していない。SerpApi は Free Plan では足りない
3. 定期計測を有効にする手順（判断のあと）: `phase2-apply.py apply-schedules` → Vercel に `CRON_SECRET` と `AIRREACH_SCHEDULE_ENABLED=true` → `.github/workflows/deploy-vercel-static.yml` の vercel.json に `crons`（例: 毎時0分に `/api/airreach/schedule-run/`）→ 顧客ごとに設定を「有効」

### テスト

- `node scripts/airreach-api/unit-measure-citation.mjs`（引用判定・API）・`unit-schedule.mjs`（定期実行）・`unit-monthly-ai.mjs`（月次集計）・`unit-faq-draft.mjs`（FAQ 下書き）・`unit-schema-gaps.mjs`（構造化データ）
- ローカル Postgres: `scripts/airreach-api/schedule-test.sql`（定期実行の権限・二重実行・上限・再試行。本番 DB では実行しない）
- `unit-pin.mjs` は main でも失敗する（DNS の確認で私的アドレス扱い。今回の変更とは無関係）
