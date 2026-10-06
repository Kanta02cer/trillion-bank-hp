# AirReach: Google のユーザーデータの扱い（Google OAuth の審査対応）

作成: 2026-10-06。対象: Search Console（`webmasters.readonly`）・GA4（`analytics.readonly`）・`openid email`。
このリポジトリは公開なので、人名・メールアドレス・キーの値・お客様のデータは書かない。

## 決めたこと

| # | 決めたこと | 実装 |
|---|---|---|
| 1 | Search Console の検索語句・表示回数・クリックなどは、AI計測の質問の生成・選択・並び順・優先順位に使わない。GSC の分析・画面の表示・改善の分析・月次レポートだけに使う | `assets/js/airreach-google-guard.js`（`promptKeywords`）。Studio の質問の候補は GSC 由来の語を除き、Keyword Planner の検索数 → 文字コード順で並べる |
| 2 | 外部の AI に送れる質問は、お客様または担当者が確定したものだけ。GSC 由来の質問は確定できず、送れない | 画面: `sendablePrompts`・Studio の「確定する」。サーバー: `api/hack2-measure.js` の `promptPolicyError`（未確定・GSC 由来が1問でもあれば、どの AI にも送らず 400） |
| 3 | 自動の計測は質問を自動で作らない。確定した質問があるときだけ測る | `airreach-studio.js` の `autoMeasure` |
| 4 | GitHub に出すパッケージに Google のデータを入れない | `airreach-orchestrator.js` の `googleFreeJob`・`buildPackageFiles(job, { noGoogle: true })`。`createDraftPr` は作り直したものを送る |
| 5 | Google 連携は、社内スタッフか契約中の顧客のメンバーだけ。契約が終わった顧客については、社内スタッフでも新しく取得しない | `api/google/_lib/access.js` → RPC `airreach_google_access`。`auth.js`（開始）・`gsc.js`・`ga4.js`・`url-inspection.js` |
| 6 | 接続の前に、担当者が分析・改善提案・月次レポート作成・サポートに必要な範囲で Google のデータを閲覧することへの同意を取る | Studio・ダッシュボードの同意のチェック。`auth.js` は `consent: true` が無い開始を断る |
| 7 | 契約終了から 90 日以内に、Google 由来のデータを消す | `clients.ended_at`（トリガー）・`airreach_purge_expired_google_data(80)`・pg_cron（毎日 03:30 JST） |
| 8 | 削除依頼は、管理者が顧客ごとに一括で消す。消した記録は Google のデータ本体と分けて残す | `airreach_delete_google_data`（顧客名の確認つき）・`google_data_deletions`・ダッシュボードの「契約の状態と Google データの削除」 |
| 9 | ブラウザに残った分も消せるようにする | `purgeLocal`。DB で消した日時（`clients.google_purged_at`）を Studio が見て、そのブラウザの作業を消す（消さないと自動の共有で DB に戻るため）。Studio の「このブラウザの Google データを消す」 |

## 消す対象（顧客ごと・`airreach_purge_google_data`）

| 対象 | 扱い |
|---|---|
| `traffic_snapshots` | すべて消す（月次の Search Console / GA4 の数字。接続したアカウントのメールを含む） |
| `studio_workspaces` | 作業ごと消す（Search Console の検索語句の行を含む） |
| `measurement_runs` | すべて消す（以前は GSC の検索語句から作った質問が入っていたため） |
| `measurement_schedules`・`measurement_jobs` | 有れば消す（質問を含む） |
| `reports.compiled` | `traffic`・推移のクリック/問い合わせ・「検索からのクリック」の事実を除く。レポートと担当者の文章は残す（文章に数字を書いた場合は担当者が直す） |
| ブラウザ | Studio の作業・控え・端末の基準値・Google の設定（`airreach-google-guard.js` の `purgeLocal`） |

Google のトークンは DB に無い（ブラウザの HttpOnly Cookie。リフレッシュトークンの Cookie は最長 30 日）。
削除依頼のとき、ダッシュボードはそのブラウザの接続を切る（Google の許可も取り消す）。ほかのブラウザの接続は、そのブラウザで「切断」するか、Google アカウントの「サードパーティ製のアプリとサービス」から外す。

## 既存の Search Console 由来の質問を無効にする（`20261007160000_airreach_disable_gsc_prompts.sql`）

以前に作られた Studio の質問には、出どころ・確定の印が無い。画面と同じ条件（`airreach-google-guard.js` の `isGoogleDerivedPrompt`）で
Search Console 由来の質問を調べ、`google: true`・`confirmed: false`・`on: false`（毎月測らない）にする。

- 元の状態（on・confirmed・google）はその質問の `gscDisabled` に残す（取り消し用。質問文はほかへ写さない）
- 変えた作業は `version` を 1 つ上げる。各パソコンの Studio は、開いたときにこの内容を読み込み直す
- AI計測の記録（`measurement_runs`）・Search Console の行・キーワードには触らない。質問は消さない
- 何度実行しても同じ結果。出力は件数だけ（質問文・検索語句は出さない）
- 取り消し: `supabase/rollback/20261007160000_airreach_disable_gsc_prompts_rollback.sql`（戻しても、画面とサーバーは確定していない・GSC 由来の質問を送らない）

## 本番への適用の順番（判断のあと）

> 本番の状態（2026-10-06）: `20261007150000`（governance）と `20261007160000`（質問の無効化）は SQL Editor で適用済み（当時の番号は 20261007120000 / 20261007140000。main の `20261007120000_airreach_client_requests` と番号が重なるため、中身はそのままで番号だけ振り直した）。SQL Editor で実行したため `supabase_migrations.schema_migrations` には記録が無い。pg_cron（`20261007170000`）は未適用。

1. `supabase/migrations/20261007150000_airreach_google_data_governance.sql` を適用する（`measurement_schedules` が未適用でも適用できる）
2. `supabase/migrations/20261007160000_airreach_disable_gsc_prompts.sql` を適用する（適用したときに 1 回実行され、件数が NOTICE に出る）
3. コードをデプロイする。**1 より先にデプロイしない**（`airreach_google_access` が無いと、Google 連携が 503 で止まる）
4. 動作を確かめる（下の「確認」）
5. `supabase/migrations/20261007170000_airreach_google_retention_pg_cron.sql` を適用する（pg_cron を有効にして毎日の削除を登録する）
6. 既存の Studio の質問は、出どころ・確定の印が無いため、すべて「未確定」になる。担当者が質問を確かめて「確定」するまで、手動・自動の計測は外部の AI に送らない（GSC 由来と判定した質問は確定できない）

取り消し: `supabase/rollback/20261007160000_airreach_disable_gsc_prompts_rollback.sql` → `supabase/rollback/20261007150000_airreach_google_data_governance_rollback.sql`（消したデータは戻らない）。pg_cron は `select cron.unschedule('airreach-google-retention');`。

## 確認（本番に入れたあと。件数だけを見る）

```sql
-- 1) GSC 由来なのに、毎月測る・確定になっている質問（0 であること）
select count(*) from public.studio_workspaces w, jsonb_array_elements(w.data #> '{studio,prompts}') e
where jsonb_typeof(w.data #> '{studio,prompts}') = 'array'
  and public.airreach_is_gsc_prompt(e, public.airreach_gsc_queries(w.data), public.airreach_gsc_norm(w.data #>> '{studio,profile,brand}'))
  and ((e ->> 'on') is distinct from 'false' or e ->> 'confirmed' = 'true' or (e ->> 'google') is distinct from 'true');
-- 2) 無効にした質問の数（無効化の件数と同じであること）
select count(*) from public.studio_workspaces w, jsonb_array_elements(w.data #> '{studio,prompts}') e
where jsonb_typeof(w.data #> '{studio,prompts}') = 'array' and e ? 'gscDisabled';
-- 3) もう一度実行しても何も変わらない（prompts_disabled_now = 0）
select public.airreach_disable_gsc_prompts();
```

## テスト

| テスト | 内容 |
|---|---|
| `node scripts/airreach-api/unit-google-guard.mjs` | 質問の候補・送れる質問・GSC 由来の判定・ブラウザの削除・GitHub 用のパッケージ |
| `node scripts/airreach-api/unit-google-access.mjs` | ログインしていない・契約していない人は Google に触れない／未確定・GSC 由来の質問はどの AI にも送らない |
| `node scripts/airreach-api/unit-google-oauth.mjs` | OAuth の開始（POST・同意・ログイン）と GSC / GA4 の取得 |
| `SITE_DIR=<_site> node scripts/airreach-api/google-ai-e2e.mjs` | 実際の Studio の画面で、GSC の検索語句（目印の語）が計測 API に1件も送られないこと（手動・作り直し・自動） |
| `SITE_DIR=<_site> node scripts/airreach-api/google-console-e2e.mjs` | ダッシュボードの同意・一括削除・削除の記録・契約の状態 |
| `scripts/airreach-api/google-data-test.sql`（ローカル Postgres） | アクセスの判定・終了日のトリガー・一括削除・80 日後の削除・削除の記録・権限 |
| `scripts/airreach-api/gsc-prompt-disable-test.sql`（ローカル Postgres） | 既存の質問の無効化（画面と同じ判定）・ほかは変えない・2回目は何もしない・取り消し |
