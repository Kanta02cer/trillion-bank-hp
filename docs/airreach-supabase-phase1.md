# AirReach × Supabase — Phase 1 設計（診断結果の保存と共有）

Date: 2026-09-28
Status: APPLIED — 2026-09-28 に AirReach Project へ migration `20260928114908_airreach_phase1` と seed を適用済み（Hack2 は無変更）
方針変更（2026-09-29）: API 層は Cloudflare Worker ではなく **Vercel Functions** で運用する。詳細は `docs/airreach-vercel-api.md`。本書の「ops/airreach-api」「Worker」は Vercel 版 `api/airreach/` に読み替える（DB・RPC・RLS は変更なし）。
Supabase: AirReach 専用 Project（ref `opjjxbdrgfyoydyrmzns`, ap-northeast-1）
関連: `docs/airreach-display-contract.md`, `docs/airreach-p0-er.md`, `docs/airreach-p0-roles-architecture.md`

## 結論

- AirReach の診断結果を **端末（localStorage）に加えてサーバへも保存**し、共有リンクで別端末から開けるようにする。
- 既存の取得（`ops/airreach-fetch`）・判定・採点（`assets/js/airreach-diagnose.js`）・描画は **変更しない**。変えるのは「保存先を 1 つ増やす」ことだけ。
- Supabase は **保存**に使う。認証・権限管理は Phase 2。
- Hack2 Project（HackⅡ 計測 DB）には一切触れない。

## Phase の切り分け

| Phase 1（今回） | Phase 2（別途） |
|---|---|
| 診断結果保存 / 診断履歴（DB に蓄積） / 項目別結果 / 根拠 URL / 共有結果表示 | ログイン（Supabase Auth） / 代理店管理 / クライアント・店舗の権限管理 / 営業案件管理（status 変更） / サイト別履歴一覧 API / `scan_findings` |

## 1. アーキテクチャ

```
ブラウザ（trillion-bank.jp / GitHub Pages）
│
│ ① ゲート画面: URL → AirReach.diagnose()            （既存・無変更）
│      取得 ────────────────▶ ops/airreach-fetch        （既存 Worker・無変更）
│      判定・採点                                       （既存・無変更）
│
│ ② finishSurvey(): localStorage 保存（既存）＋ [新] AirReachScanSync.push()
│      POST /v1/scans ───────▶ [新] ops/airreach-api（Cloudflare Worker）
│                                ・Origin 許可リスト（濫用抑止。認証ではない）
│                                ・Rate Limiting（IP 単位）
│                                ・payload 検証 ＋ 因子点/総合点の再計算による整合性検証
│                                ・share_token 生成（32 byte CSPRNG）→ SHA-256 だけを保存
│                                ・service_role で RPC airreach_insert_scan() ─▶ Supabase「AirReach」
│                                  （service_role はテーブル権限ゼロ。RPC 2 本の EXECUTE だけ）
│      ◀── 201 { scanId, shareToken, sharePath }
│          → localStorage の scan に shareToken を追記
│
│ ③ 遷移先 /airreach/{業種}/?scan=ID: 2 回目の診断（既存）→ 描画。**サーバ保存は呼ばない**
│
│ ④ 共有 /airreach/result/?share=<token>
│      GET /v1/shared-scans/:token ──▶ Worker が SHA-256 化 ──▶ RPC airreach_get_shared_scan(hash)
│      ◀── 保存済み結果（raw_result 含む）→ localStorage に取り込み
│          → /airreach/{業種}/?scan=ID&snapshot=1  （snapshot=1 は再診断せず保存済み結果を描画）
│
│ ✕ PATCH /v1/scans/:id/status → Phase 1 は未実装（405）。Phase 2 で Supabase JWT 検証必須
```

### 決めたこと

| 論点 | 決定 | 理由 |
|---|---|---|
| Supabase Project | AirReach 専用の新 Project。`public` スキーマを使う | Hack2 の `projects` / `users` と衝突せず、事故時の影響範囲を分離 |
| サーバ層 | 新 Worker `ops/airreach-api`。`ops/airreach-fetch` は無変更 | 取得と保存を分離。既存 ops と同じ運用（wrangler） |
| 保存タイミング | ゲート画面の 1 回目の診断だけ。遷移先の 2 回目（`runDiagnose`）は保存しない | 同一利用での重複防止 |
| 重複防止 | `scans.id` = 既存 `AirReachScanStore.uid()` を PK に流用。RPC 内の unique 違反で全体ロールバック → 409。端末側も `syncedAt` 付き scan は再送しない | |
| scan_id と share_token | 分離。scan_id は公開 ID、share_token は 256 bit の秘密。DB には SHA-256 のみ | scan_id を知っていても匿名では取得できない |
| 診断失敗時 | `previewDiagnose` が null なら保存しない | 共有できる結果が無い |
| 履歴 | DB に `sites` 単位で蓄積。**一覧 API は Phase 2（認証後）** | 匿名でサイト別一覧を返すと他社の診断内容（キーワード・目的）が見える |
| `scan_findings` | **Phase 2 に回す** | strength/gap/unknown は `scan_checks.state` から導出でき、adjustments/actions は `scans.raw_result` にある。Phase 1 の共有表示は raw_result で描画する |
| `display_version` | `scans.display_version` に文字列で記録（FK なし） | 区分の境界値の正本は `_data/airreach_display.yml`（git 管理）。DB は版ラベルの記録に留める |
| 認証 | Phase 1 に「認証が必要な操作」は無い。書き込みは無料ツールとして匿名、読み取りは share_token 所持者のみ。Origin は権限判断に使わない | |

## 2. テーブル（Phase 1: 6 本）

| テーブル | 役割 | 行の粒度 |
|---|---|---|
| `rule_versions` | 判定ルール（採点式）の版 | 1 版 = 1 行 |
| `sites` | 診断対象サイト | 正規化 URL ごと 1 行 |
| `scans` | 診断 1 回の本体（総合点・状態・共有トークンハッシュ・全文 JSON） | 診断 1 回 = 1 行 |
| `scan_factor_scores` | 項目別（4 因子）の点数 | 診断 × 因子 |
| `scan_checks` | 18 チェックの 3 値判定と根拠 URL | 診断 × チェック |
| `scan_evidence_sources` | page / llms / robots の取得記録 | 診断 × 3 |

定義の正本: `supabase/migrations/20260928120000_airreach_phase1.sql`

### 主なカラム

**rule_versions**: `rule_version` PK, `factors` jsonb, `check_definitions` jsonb, `default_display_version`, `notes`, `published_at`, `created_at`

**sites**: `id` uuid PK, `normalized_url` UNIQUE, `host`, `display_name`, `industry_id`, `scan_count`, `first_scanned_at`, `last_scanned_at`, `created_at`

**scans**: `id` text PK（`^[a-z0-9]{8,32}$`）, `site_id` FK, `share_token_hash` UNIQUE（hex 64）, `share_revoked_at`, `rule_version` FK, `display_version`, `state`（verified / partial / failed / not_diagnosed）, `overall_score` 0–100 or null, `industry_id`, `goal`, `outcome_goal`, `keyword`, `site_title`, `source`, `status`（Phase 1 は diagnosed 固定）, `page` jsonb, `summary`, `raw_result` jsonb, `fetched_at`, `client_saved_at`, `created_at`

**scan_factor_scores**: PK(`scan_id`, `factor_id`), `score` or null, `weight`, `required`, `state`（verified / partial / unknown）, `known_checks`, `total_checks`

**scan_checks**: `id` identity PK, `scan_id` FK, `sort_order`, `factor_id`, `label`, `state`（ok / ng / unknown）, `points` or null, `max_points`, `evidence_url`, `evidence_final_url`, `evidence_anchor`, `evidence_via`, `evidence_fetched_at`, `evidence_verified`; UNIQUE(`scan_id`, `sort_order`)

**scan_evidence_sources**: PK(`scan_id`, `kind`), `requested_url`, `final_url`, `http_status`, `fetch_state`（ok / missing / failed）, `via`, `fetched_at`, `error`

### 既存データとの対応

| 既存（`diagnose()` の戻り値 / localStorage の scan） | 保存先 |
|---|---|
| `ruleVersion`, `displayVersion`, `state`, `overall`, `page`, `review.summary`, 戻り値全体 | `scans` |
| `factors[id].{score,weight,required,state,knownChecks,totalChecks}` | `scan_factor_scores` |
| `checks[i].{factor,label,state,points,max,evidence{url,finalUrl,anchor,via,fetchedAt,verified}}` | `scan_checks` |
| `evidence.{page,llms,robots}.{url,finalUrl,state,status,via,fetchedAt,error}` | `scan_evidence_sources` |
| scan の `url, industryId, goal, outcomeGoal, keyword, siteTitle, source, savedAt` | `scans` / `sites` |
| `strengths / gaps / unknowns / adjustments / actions / referral` | `scans.raw_result`（Phase 2 で正規化を検討） |

## 3. API（ops/airreach-api、Phase 1）

| メソッド / パス | 認証 | 役割 |
|---|---|---|
| `POST /v1/scans` | 匿名（Origin 許可リスト＋Rate Limit＋整合性検証） | 保存し share_token を 1 回だけ返す |
| `GET /v1/shared-scans/:shareToken` | share_token 所持 | 共有用に保存済み結果を返す |
| `GET /v1/health` | なし | 疎通確認 |
| `PATCH /v1/scans/:id/status` | **未実装（405）** | Phase 2: Supabase JWT 検証＋RLS 前提 |

### POST /v1/scans

リクエスト: `{ "scan": {端末の scan の要約}, "result": {diagnose() の戻り値} }`

Worker の検証:

1. サイズ上限 256 KB、`scan.id` の形式、列挙値、`checks` は 18 件以内で各 `points ≤ max`
2. `result.ruleVersion` が `rule_versions` に登録済み（未登録は 422。新しい版は seed で先に登録）
3. `checks` から因子点と総合点を再計算し、`result.factors[*].score` と `result.overall` に一致すること（偽造した点数の共有ページを防ぐ）
4. `share_token` = 32 byte CSPRNG → base64url 43 文字。SHA-256 hex を `share_token_hash` に保存
5. RPC `airreach_insert_scan()` を 1 回呼ぶ

レスポンス:

| 状態 | 内容 |
|---|---|
| 201 | `{ "scanId", "shareToken", "sharePath": "/airreach/result/?share=<token>", "createdAt" }` |
| 409 | 同じ `scan.id` が既に存在。**トークンは返さない** |
| 413 / 422 / 429 | サイズ超過 / 検証失敗 / レート制限 |

### GET /v1/shared-scans/:shareToken

トークン形式 `^[A-Za-z0-9_-]{43}$` を確認 → SHA-256 hex → RPC `airreach_get_shared_scan(hash)` を 1 回呼ぶ。RPC は該当なし・失効済み・形式不正のとき null を返し、Worker は 404 にする。`share_token_hash` は応答に含めない。`Cache-Control: no-store`。

レスポンス: `{ "scan": {...}, "factors": [...], "checks": [...], "sources": [...], "result": {raw_result} }`

## 4. セキュリティ

- **鍵**: `service_role` は `wrangler secret put` で Worker にのみ。リポジトリ・JS・Jekyll データに書かない。ブラウザに出してよいのは将来の publishable キーだけ。
- **DB 側**: 全テーブル RLS 有効。Phase 1 はポリシーを作らない（anon / authenticated は 0 行）うえ、テーブル権限と sequence 権限、RPC の execute も剥奪。既定権限も剥奪しておく。
- **Worker の経路は RPC のみ**: `service_role` にはテーブル・sequence の権限を一切与えず、`airreach_insert_scan()`（INSERT 専用）と `airreach_get_shared_scan()`（ハッシュ 1 件読み）の EXECUTE だけを付与する。両関数は SECURITY DEFINER（所有者 postgres）で `search_path = ''`、全オブジェクトをスキーマ修飾、動的 SQL なし。service_role の鍵が漏れても、任意行の UPDATE / DELETE、全診断の一覧取得、トークンハッシュの列挙はできない。
- **Worker 側**: Origin 許可リスト（`ops/airreach-fetch` と同じ集合）、Rate Limiting、サイズ上限、列挙検証、採点再計算。生 HTML と個人情報は受け取らない（URL の秘密クエリは既存コードが除去済み）。
- **共有**: share_token は推測不能な 256 bit。DB 漏えい時も生トークンは復元できない。失効は `share_revoked_at`（Phase 2 で UI 化）。
- **監査**: `rule_version` と `display_version` を必ず保存し、採点式や区分の変更後も過去診断を比較できる。

### 権限の実測と方針（2026-09-28 レビューで追加）

AirReach Project の `pg_default_acl` を実測した結果、MCP / CLI が使う `postgres` ロールが `public` に作るオブジェクトの既定権限は次のとおりだった。

| オブジェクト | anon / authenticated / service_role の既定権限 |
|---|---|
| tables | TRUNCATE / REFERENCES / TRIGGER / MAINTAIN のみ（SELECT / INSERT / UPDATE / DELETE は無い） |
| sequences | 無し |
| functions | 無し（PUBLIC の EXECUTE も無い） |

このため **既定権限には依存せず、必要な権限は migration に明示的に書く**。

- Phase 1: `service_role` には RPC 2 本（`airreach_insert_scan`, `airreach_get_shared_scan`）の EXECUTE と schema USAGE だけを明示 GRANT。テーブル・sequence の権限はゼロ（既定 ACL の TRUNCATE 等も revoke）。RPC は SECURITY DEFINER なので、所有者 postgres の権限で INSERT / SELECT が実行される。
- Phase 1: anon / authenticated はテーブル・sequence・関数の権限をすべて剥奪し、`alter default privileges for role postgres` で以後の自動付与も止める。
- **Phase 2: authenticated に必要な権限（例: `scans` / `scan_*` の SELECT、`scans.status` の UPDATE）は、RLS ポリシーと同じ migration で `grant ... to authenticated` を明示する。** RLS ポリシーだけではテーブル権限は付かず、既定権限も剥奪済みのため、GRANT を書き忘れると認証ユーザーは何も読めない。
- 各 migration 適用後は `information_schema.role_table_grants` と `has_function_privilege()` で anon / authenticated / service_role の権限を確認する（クエリは `supabase/README.md`）。
- 注意: `postgres` の既定 ACL には service_role の TRUNCATE / REFERENCES / TRIGGER / MAINTAIN（`Dxtm`）が残っている。Phase 2 で新しいテーブルを作るときは、Phase 1 と同じく `revoke all on table ... from service_role` を必ず書く。
- advisors の `rls_enabled_no_policy`（INFO）は Phase 1 の意図どおり（ポリシーを作らず、権限も剥奪している）。`unused_index`（INFO）は行が無い段階の表示で対応不要。

### RPC の失敗と Worker の応答

PostgREST は `unique_violation`（23505）と `foreign_key_violation`（23503）をどちらも HTTP 409 で返すため、Worker は HTTP 状態ではなく応答本文の `code` で分岐する。

| Postgres エラー | 意味 | Worker の応答 |
|---|---|---|
| 23505（`scans_pkey`） | 同じ `scan.id` が既に存在 | 409。share_token は返さない。既存行は変更しない |
| 23503（`scans_rule_version_fkey`） | `rule_version` が未登録 | 422。seed で登録してから再送 |
| 23514（check 違反） | 列挙値・範囲の不整合 | 422 |
| その他 | | 502。本文をログに出さない（URL 以外の機密は無いが、念のため） |

`scans` には UPDATE / DELETE の経路が無い（RPC は INSERT のみ、anon にも service_role にもテーブル権限なし）。同じ `scan.id` の再送は RPC 全体（`sites` の upsert を含む）がロールバックされ、既存の診断・共有トークンは一切変わらない。`sites.display_name` / `industry_id` だけは同じ URL の新しい診断で更新される（サイト単位のメタ情報であり、診断結果ではない）。

## 5. ファイル計画

### 今回作成済み

| ファイル | 内容 |
|---|---|
| `docs/airreach-supabase-phase1.md` | 本書 |
| `supabase/migrations/20260928120000_airreach_phase1.sql` | スキーマ・RPC・RLS/権限 |
| `supabase/seed/airreach_rule_versions.sql` | `airreach-common-v1` の登録 |
| `supabase/README.md` | 適用手順・確認クエリ |
| `_config.yml` | `exclude` に `supabase` を追加（SQL をサイトへ出力しない） |

### PR-2 で作成済み（`ops/airreach-api/`、未デプロイ）

| ファイル | 内容 |
|---|---|
| `wrangler.jsonc`, `package.json`, `tsconfig.json`, `.gitignore`, `.dev.vars.example`, `README.md` | Worker の骨格。Rate Limiting binding 2 本、非秘密の vars |
| `src/index.ts` | ルーティング、CORS / OPTIONS、Rate Limit、本文サイズ制限、エラー整形、トークンを伏せたログ |
| `src/validate.ts` | payload 検証（構造 400 / 内容 422）と採点再計算、ホワイトリストでの組み立て直し |
| `src/mapper.ts` | 検証済み診断 → RPC 引数（`raw_result` も検証済み値だけ） |
| `src/share-token.ts` | 32 byte CSPRNG → base64url 43 文字、SHA-256 hex |
| `src/supabase.ts` | `rpc/airreach_insert_scan` と `rpc/airreach_get_shared_scan` だけを呼ぶ。PostgREST エラーの写像（23505→409、23503/23514→422、5xx/timeout→503） |
| `src/rules.ts`, `src/url.ts`, `src/cors.ts`, `src/errors.ts`, `src/env.ts` | ルール定義、URL 無害化（fetch Worker と同じ規則）、CORS、エラー型、環境 |
| `test/mock-supabase.mjs`, `test/fixture.mjs`, `test/e2e.mjs` | モック PostgREST（RPC 2 本のみ）、自己整合 payload、E2E |

### 次の PR（PR-3）で作成

| ファイル | 内容 |
|---|---|
| `assets/js/airreach-scan-sync.js` | `push(scan)` / `fetchShared(token)` / `sharePath(scan)` |

### 次の PR で変更

| ファイル | 変更点 |
|---|---|
| `_includes/airreach-app.html` | script タグ追加。`finishSurvey()` で `push()` を呼び最長 2.5 秒待って遷移（`keepalive: true`）。`boot()` で `snapshot=1` なら再診断せず保存済み結果を描画。shareToken があるときだけ「共有リンクをコピー」を表示 |
| `airreach/result/index.html` | `?share=` を処理して端末に取り込み、`snapshot=1` で遷移。`?scan=` は従来どおり |
| `airreach/sales/index.html` | 注記の更新と共有リンク表示 |
| `_data/content_guardrails.yml` | `scoped_claim_patterns.roots` に新 JS を追加 |
| `.gitignore` | `ops/airreach-api/.dev.vars`, `ops/airreach-api/.wrangler/` |
| `_data/public_facts.yml` | 「端末内保存」「サーバー DB 未接続」の記述を実装後に更新 |
| `docs/airreach-p0-er.md`, `docs/airreach-p0-roles-architecture.md`, `ops/sql/airreach_p0_client_db.sql` | 本書への参照。旧 SQL 草案に superseded 注記 |

### 変更しない

`ops/airreach-fetch/*`, `assets/js/airreach-diagnose.js`, `airreach-sales.js`, `airreach-display.js`, `airreach-scan-store.js`, Hack2 Project の一切

## 6. 実装順序

| 順 | 作業 | 完了条件 |
|---|---|---|
| 1 | 本書・migration・seed・README をリポジトリに追加（済） | レビュー承認 |
| 2 | migration と seed を AirReach Project へ適用（済 2026-09-28）。RLS 全有効、anon / authenticated / service_role のテーブル権限 0、RPC 2 本のみ service_role が実行可、advisors は INFO のみ、テストデータで INSERT / 重複 409 / 共有取得 / 不正・失効トークン null / anon・authenticated 拒否を確認しテストデータ削除済み | 済 |
| 3 | `ops/airreach-api` 実装（済 2026-09-28）。`npm run check`（types / tsc / deploy --dry-run）通過。モック PostgREST + `wrangler dev` の E2E 66 件通過（201 / 409 / 400 / 422 / 413 / 200 / 404 / 405 / 503、CORS、OPTIONS、鍵・トークン非漏えい、テーブル直接アクセス 0 件）。Worker が生成した RPC 引数を実 DB にリプレイして INSERT と共有取得を確認し、テスト行は削除済み。**未デプロイ** | 済（ローカルのみ） |
| 4 | Worker デプロイ、`wrangler secret put SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | workers.dev URL 確定 |
| 5 | フロント実装。`content_guard.py`、Jekyll build、デスクトップ / モバイルで「診断 → 共有リンク → 別ブラウザで開く」を目視確認 | PR |
| 6 | `public_facts.yml` / `content_guardrails.yml` / docs / `.gitignore` の追従 | content guard 通過 |
| 7 | Phase 2 設計 | 別途提示 |

## 7. 公開文言への影響

Phase 1 完了後、`_data/public_facts.yml` の AirReach `limitations` にある「P0 の診断保存は端末内」「サーバー上の顧客DBは後続」は「診断結果はサーバにも保存し、共有リンクで開き直せる。ログインと顧客管理は後続」へ更新する。点数の意味（ホームページの情報整備であり、AI 掲載率・順位・成果ではない）は変わらない。
