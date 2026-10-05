# AirReach 開発記録（最新）

最終更新: 2026-10-05（夜）。古い記録（airreach-capability-now.md など）と食い違うときは、この記録と実装を優先する。

## 2026-10-05: AI計測の引用元・10問・定期計測・月次集計・改善資料・構造化データ

#134〜#139 は 2026-10-05 に main へマージし、本番に反映済み（1a5ef3e）。本番で新しい JS・Studio の「ChatGPT（検索あり）」・レポートの構造化データの不足・定期計測 API（未ログインは 401）を確認。無料診断（そば福・変更を当てない本番）で、サイトから読めた情報・FAQ 4問がサイト由来・構造化データの不足・ZIP を確認。

| PR | テーマ | 状態 |
|---|---|---|
| #134 | ① 引用元の取得と判定（言及・AI の出典・本文の URL を区別） | 本番反映済み |
| #135 | ② 質問10問を漏れなく計測（5問ずつに分けて送る） | 本番反映済み |
| #136 | ③ 定期計測の仕組み | コードは本番反映済み。**DB は未適用・自動実行は止めている** |
| #137 | ④ 月次集計と根拠の確認 | 本番反映済み（「回答の記録」は下の不具合で出ていなかった→修正 PR） |
| #138 | ⑤ サイトの事実で FAQ の下書き・確認が必要な箇所 | 本番反映済み |
| #139 | ⑥ 構造化データの業種ごとの不足判定 | 本番反映済み |

### 2026-10-05（夜）本番実測の準備で見つけて直したこと

- **レポートの「回答の記録」が出ていなかった**：同じファイルの「数字の出どころ」の関数と名前が同じ（evidenceHtml）で、後の定義に上書きされていた（本番では「数字の出どころ」が2回出ていた）。`answerRecordsHtml` に改名。同名の関数を見つけるテスト `unit-js-names.mjs` を追加
- **判定方法を変える前の計測が月の合計に混ざる**：本番の計測15回（すべて 10/3・Studio・回答の記録なし）は、AI による概要が出なかった質問を「引用なし」と数えていた。同じ月に新しい判定の計測があれば、古い Studio の計測は合計に入れず「判定方法を変える前の計測 n回は含めていません」と出す（計測スクリプトの summary はそのまま使う）
- お客様のレポートで、画面と印刷（PDF）の中身が同じこと（印刷では回答の記録が開く）、他社の公開済みレポートが見えないことを、架空の店のデータで確認

### 本番実測の条件（判断待ち・2026-10-05 時点の案）

- 対象：「テスト」（都市伝説ラボ・メディア・https://www.toshidensetsu-labo.net/）。本番で計測が多く、実在のお客様ではない
- 固定10問の案（指名2・一般8）：都市伝説ラボはどんなサイトですか？／都市伝説ラボの記事は信頼できますか？／おすすめの都市伝説サイトを教えて／おすすめのオカルトサイトを教えて／世界一怖い都市伝説について教えて／「都市伝説 怖い」のランキングを教えて／八尺様について教えて／赤い部屋について教えて／ひきこさんについて教えて／「鬼滅の刃 都市伝説」について詳しく書いてあるサイトを教えて
- いまのキーだけで測れる AI：Perplexity（AI Gateway・出典は本文で判定）・ChatGPT 検索なし（言及だけ）・Google の AI による概要と AI モード（SerpApi 無料枠）。ChatGPT（検索あり）・Claude は AI Gateway の有料クレジットが要るか未確認、Gemini はキーなし
- 1回（10問）の費用の見込み：Perplexity 0.06・ChatGPT 0.003・AI による概要 0.3・AI モード 0.15 ドル（SerpApi は無料枠なら請求 0 で検索回数を約20〜30回使う）。ChatGPT（検索あり）を足すと +0.15、Claude +0.2、Gemini +0.35
- 定期計測の案：毎週月曜 10時・1回ずつ・月4回。10問 × 4つの AI × 4回 ＝ 160回答（「月192回答」は初期案として固定しない）。SerpApi は1社でも月120回前後を使う

### 定期計測の DB を入れる前の確認（2026-10-05）

- バックアップ：毎日（9/28〜10/5 02:44 の8件）。PITR は無効
- 変えるもの：表2つ（measurement_schedules・measurement_jobs）と RPC 5本を足す。`measurement_runs.source` の制約に `schedule` を足す（既存の15行は manual のまま。行は変えない）
- 戻し方：`supabase/rollback/20261005120000_airreach_measurement_schedules_rollback.sql`（定期計測で作った計測の記録は残す）
- 権限：お客様は2つの表を読めない、社内は設定を読み書き・記録は読むだけ、service_role は RPC 3本だけ（ローカルで 37 PASS）

### 判定と数え方（決めたこと）

- 回答ごとに分けて記録する: `mentioned`（社名への言及）／`cited_by_sources`（AI が返した出典に自社サイト）／`self_url_in_text`（回答の本文の URL に自社サイト）
- `cited`（引用率に使う値）は、出典の一覧 → 無ければ本文の URL → どちらも無ければ **null（0 にしない）**。`cite_source` に判定方法
- 回答の状態 `status`: ok / not_shown（Google の AI による概要が出なかった）/ error（その質問だけ失敗）。not_shown と error は割合の分母に入れず件数で出す
- 引用率 ＝ 自社サイトが引用された回答 ÷ 引用の有無を判定できた回答（分子・分母も出す）。判定できない回答 ＝ 回答 − 判定できた数
- 月次レポート・ホームのタイルは **その月のすべての計測の合計**。最新1回は `ai.latest` に別に残す。前月との差は、両方の月が同じ質問の版1つだけのとき
- FAQ の下書き: サイトの本文に書かれた値だけで答えを作り、元の記載（前後の文と URL）を付ける。見つからない質問は「【確認が必要】」。検索や AI が読む形（faq.jsonld）には、サイトの記載から作った答えだけ
- 構造化データの不足: 業種ごとの必要な項目と JSON-LD の項目を比べる。ページの本文にだけある値は「その値で直せる」と示す。ページを確かめていないとき（月次レポート）は「ページにも無い」と言わない

### 本番の状態（2026-10-05 確認・昼）

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
