# AirReach 本番実測・定期計測の開始手順（準備）

作成: 2026-10-06。**この文書は手順の準備であり、実行の許可ではない。** 本番の AI への質問・無料枠を使う計測・API の購入・有料プラン・DB の適用・環境変数と cron の変更・レポートの公開は、それぞれ判断が出てから行う。

## 0. いまの状態（2026-10-06）

- コード: 引用判定・10問・定期計測・月次集計・FAQ 下書き・構造化データの不足判定は本番に反映済み。定期計測の上限・停止の確かめ方の修正（migration `20261006120000`）は PR で確認中
- 本番 DB: 定期計測の表は未適用。計測の記録 15件（すべて 2026-10-03・判定方法を変える前の Studio の計測）。レポート2件とも下書き・公開済み 0件
- Vercel の本番の環境変数（名前だけ確認）: `AI_GATEWAY_API_KEY`・`SERPAPI_API_KEY` はある。`OPENAI_API_KEY`・`ANTHROPIC_API_KEY`・`PERPLEXITY_API_KEY`・`GEMINI_API_KEY`・`CRON_SECRET`・`AIRREACH_SCHEDULE_ENABLED` は無い
- 承認者は平川さん1名（社内の管理者であることと、レポートの承認権限は別）

## 1. 接続ごとの試験表

| AI（Studio の選択肢） | 経路 | 必要な設定 | 何が測れるか | 注意 |
|---|---|---|---|---|
| ChatGPT（検索なし） | AI Gateway（chat） | `AI_GATEWAY_API_KEY`（あり） | **言及だけ**。引用は測らない（`cite_source=not_measured`） | 出典の検証には使わない |
| ChatGPT（検索あり） | AI Gateway（Responses・web_search）／`OPENAI_API_KEY` があれば直接 | Gateway の有料クレジット（無料枠で使えるか未確認）か `OPENAI_API_KEY` | 言及・AI が返した出典 | 9/30 実測 約0.015ドル/回答 |
| Perplexity | `PERPLEXITY_API_KEY` があれば直接、無ければ AI Gateway | Gateway（あり）／直接は `PERPLEXITY_API_KEY` | 直接：AI が返した出典（`citations`・`search_results`）。**Gateway：出典は渡されない（10/3 実測）＝本文の URL で判定、無ければ判定できない** | Gateway と直接の結果を混同しない |
| Claude（検索あり） | `ANTHROPIC_API_KEY` があれば直接、無ければ AI Gateway（Responses） | どちらか | 言及・AI が返した出典 | 検索 1,000回10ドル＋トークン |
| Gemini | Google の Gemini API（Google 検索つき） | `GEMINI_API_KEY`（無し） | 言及・出典（groundingMetadata） | キーが無いとエラーの行になる |
| Google AI による概要 | SerpApi | `SERPAPI_API_KEY`（あり） | 表示されたときだけ言及・出典。**出ないときは `not_shown`（分母に入れない）** | 1問あたり最大2検索。無料枠は月250検索 |
| Google AI モード | SerpApi | `SERPAPI_API_KEY`（あり） | 言及・出典 | 1問あたり1検索 |

費用の上限は、アプリの中の見込みの単価（`api/airreach/schedule-run.js` の `DEFAULT_COST_PER_ANSWER`、`AIRREACH_COST_PER_ANSWER` で上書き）で数えている。**実際の請求の絶対の上限ではない**。失敗した呼び出し・取り直し・回数の上限に当たって待ったあとの呼び出しでも費用が出ることがある。実際の請求は各サービスの管理画面で別に確かめる。

## 2. 初回の Studio 実測（判断のあと）

前提: 試験の予算・対象の AI・固定10問が決まっている。対象は「テスト」（都市伝説ラボ）の案（`docs/airreach-dev-record.md`）。

1. 社内のアカウントで https://trillion-bank.jp/airreach/app/ にログインし、顧客「テスト」から Studio を開く
2. 「AI での見え方を測る」で、固定10問だけにチェックが入っていること（毎月測る 10 / 10問）と、対象の AI だけにチェックがあることを確かめる
3. 「計測実行」を1回だけ押す（5問ずつ2回に分けて送る。進み具合が「1/2回目」「2/2回目」と出る）
4. 計測後、画面で確かめる
   - AI ごとのカード：引用率・言及・「判定の方法：AI が返した出典 n回・回答の本文の URL n回」・「AI の回答が表示されなかった n問」・「エラー n問」
   - 質問ごとの結果：10問すべてがあり、各回答に判定の方法と、AI が返した出典／本文の URL が区別して出る
5. ページを読み込み直し、「これまでの記録」に1回分が残っていることを確かめる
6. 本番 DB を読むだけで確かめる（`measurement_runs` の最新1件・`summary.answers`）
   - 回答の数 ＝ 10問 × AI の数（重複・欠落なし。同じ質問 × AI が1件ずつ）
   - 各回答に `prompt`・`engine`・`measured_at`・`conditions`（モデル・経由・検索の有無・地域）・`cite_source`・`citations` または `urls_in_answer`
   - `mentioned`（言及）・`cited_by_sources`（AI の出典）・`self_url_in_text`（本文の URL）が別々に入っている
   - `status` が `not_shown`・`error` の回答は、`summary.by[].denominator`・`judged` に入っていない。出典が取れない回答の `cited` は null（0 ではない）

完了の条件: 上の 4〜6 がすべて満たされ、費用が予算の範囲（各サービスの管理画面）。満たさなければ直して、関連するテストと、必要なら再実測。

## 3. お客様のレポートの本番確認（公開してよいと判断が出てから）

1. 社内で、その月の下書きを作る → 結論・次の3施策を書いて確認を依頼する
2. 平川さんが承認する → 公開する（公開は、お客様に見えるようになる操作。勝手に行わない）
3. お客様のアカウントでログインし、確かめる
   - 自社の公開済みレポートだけが一覧に出る。他社・下書き・確認待ちのレポートの URL を開くと「表示できません」
   - 社内の画面（顧客一覧・Studio・定期計測の設定）が出ない
   - AI 回答の計測：今月の合計・分子 ÷ 分母・判定できない／表示なし／エラー・一般／指名・回答の記録（計測日時・AI・判定の方法・出典）
4. 「PDFで保存（印刷）」で PDF にし、画面と中身が同じこと（回答の記録は PDF では開いた状態）

いまは本番に公開済みのレポートが無いため、**本番の画面での確認は終わっていない**（ローカルでは架空の店のデータで確認済み）。

## 4. 定期計測の設定案（未確定）

| 項目 | 案 |
|---|---|
| 対象 | 「テスト」1社 |
| AI | 判断待ち（いまのキーで測れるのは Perplexity〈Gateway〉・ChatGPT 検索なし・AI による概要・AI モード） |
| 質問の版 | 固定10問（指名2・一般8）。途中で入れ替えると前月と比べられない |
| 曜日・時刻 | 毎週月曜 10時（日本時間） |
| 1回に同じ質問を聞く回数 | 1 |
| 月の上限 | 実行 4回・回答 160（10問 × 4つの AI × 4回。**計測の枠であり、引用を判定できた回答の数とは別**）・費用の見込み 5ドル（判断待ち） |
| 再試行 | 失敗は15分あけて最大3回。取り直す前に「止めていないか」と上限を確かめ直す |
| 止め方 | ダッシュボードの「定期計測」で「有効にする」を外す（待っている回・取り直す回も見送りになる）。全体を止めるときは Vercel の `AIRREACH_SCHEDULE_ENABLED` を外す |

「月192回答」は初期案で、固定していない。

## 5. DB の適用・設定・cron・1社の試運転（判断のあと）

1. **確認**：Supabase の毎日のバックアップがあること（2026-10-05 時点で 9/28〜10/5 の8件・PITR なし）。適用するのは表2つ・RPC・制約の追加と RPC の置き換え（既存の行は変えない）
2. **DB の適用**：`python3 scripts/airreach-api/phase2-apply.py apply-schedules`（20261005 → 20261006 を順に入れ、権限と関数を確かめる。設定は0件＝何も動かない）
3. **Vercel の契約を確かめる**：Hobby は cron が1日1回まで。毎時の実行には Pro が要る（公式: https://vercel.com/docs/cron-jobs/usage-and-pricing ）。毎時にできないなら、計測の時刻に合わせた1日1回（例: 毎日 01:00 UTC ＝ 10時 JST）にする
4. **環境変数**：`CRON_SECRET`（長いランダムな文字列）と `AIRREACH_SCHEDULE_ENABLED=true` を Vercel の本番に入れる（値はクリップボード経由で、記録に残さない）
5. **cron**：**`.github/workflows/deploy-vercel-static.yml` が作る配信用の vercel.json** に `"crons": [{ "path": "/api/airreach/schedule-run/", "schedule": "0 * * * *" }]`（または1日1回）を足す。リポジトリ直下の vercel.json だけでは本番に入らない
6. **1社の設定**：ダッシュボードの「テスト」→ AI計測 → 定期計測で、AI・10問・曜日・時刻・上限を入れ、まず「今すぐ1回測る」で1回だけ試す → 問題なければ「有効にする」
7. **確かめる**：実行の記録（成功・一部成功・見送りの理由）、計測の記録（`source=schedule`）、月次の合計、同じ時刻の二重実行が無いこと、失敗の取り直し、回数・回答数・費用の見込みの上限で見送られること。費用は「アプリの見込み」と「実際の請求」を分けて報告する

### 戻し方

- すぐ止める：ダッシュボードで「有効にする」を外す、または Vercel の `AIRREACH_SCHEDULE_ENABLED` を外す（cron が呼んでも何もしない）
- cron を外す：配信用の vercel.json から `crons` を消してデプロイ
- DB を戻す：`supabase/rollback/20261006120000_airreach_schedule_guards_rollback.sql` → `supabase/rollback/20261005120000_airreach_measurement_schedules_rollback.sql`（定期計測で作った計測の記録は残る）
