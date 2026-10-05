# supabase/ — AirReach 専用 Project の DB 定義

このディレクトリは **AirReach 専用 Supabase Project** の migration と seed を置く場所です。

| 項目 | 値 |
|---|---|
| Project 名 | AirReach |
| Project ref | `opjjxbdrgfyoydyrmzns` |
| Region | ap-northeast-1（Tokyo） |
| 設計書 | `docs/airreach-supabase-phase1.md` |

## 絶対に守ること

- **Hack2 Project（ref `inlnrdjdfccnhmskpyrs`）には適用しない。** Hack2 の `public.*` テーブル・RLS・migration は AirReach と無関係で、変更しない。
- `service_role` キー・DB パスワード・接続文字列をこのリポジトリに置かない（`.env*` は `.gitignore` 済み）。ブラウザに出してよいのは将来の publishable（anon）キーだけ。
- migration は追記のみ。適用済みファイルを書き換えない。変更は新しいファイルで行う。
- このディレクトリは Jekyll の `exclude` に含める（`_config.yml`）。サイトへ出力しない。

## 適用状況

| 日付 | 内容 | Project |
|---|---|---|
| 2026-09-28 | `airreach_phase1`（migration 版 `20260928114908`）と seed `airreach-common-v1` を適用。確認クエリ・advisors・テストデータによる動作確認済み（テストデータは削除済み） | AirReach `opjjxbdrgfyoydyrmzns` のみ |

## ファイル

| ファイル | 内容 |
|---|---|
| `migrations/20260928120000_airreach_phase1.sql` | Phase 1 スキーマ（6 テーブル）、RPC `airreach_insert_scan()` / `airreach_get_shared_scan()`（SECURITY DEFINER）、RLS 有効化と権限設定 |
| `seed/airreach_rule_versions.sql` | 判定ルール版 `airreach-common-v1` の登録（冪等） |
| `migrations/20261005120000_airreach_measurement_schedules.sql` | AI計測の定期実行（`measurement_schedules`・`measurement_jobs`・RPC）。**本番は未適用**（2026-10-06 時点） |
| `migrations/20261006120000_airreach_schedule_guards.sql` | 定期実行の上限・停止の確かめ方の修正（今すぐ1回の回数上限・止めた顧客の再試行・取り直す前の上限の再確認・受け付け後の条件変更の再計算・同じ顧客の同時開始の直列化）。20261005 の RPC を置き換える。**本番は未適用**。適用は `phase2-apply.py apply-schedules`（2本を順に入れる）。テスト `scripts/airreach-api/schedule-test.sql`・`schedule-guards-test.sql`・`schedule-concurrency-test.sh`。取り消し `rollback/20261006120000_airreach_schedule_guards_rollback.sql` → `rollback/20261005120000_…` |

## 適用手順（承認後にのみ実行）

### 方法 A: Supabase MCP（Claude Code から）

1. `list_projects` で対象が `AirReach / opjjxbdrgfyoydyrmzns` であることを確認する。
2. `apply_migration`（project_id = `opjjxbdrgfyoydyrmzns`、name = `airreach_phase1`）で migration を適用する。
3. `execute_sql` で seed を実行する。
4. 下記「確認クエリ」で検証する。

### 方法 B: Supabase CLI

```bash
supabase link --project-ref opjjxbdrgfyoydyrmzns
supabase db push                       # supabase/migrations を適用
psql "$AIRREACH_DB_URL" -f supabase/seed/airreach_rule_versions.sql
```

`AIRREACH_DB_URL` はローカル環境変数にだけ置く。

## 確認クエリ

```sql
-- テーブルと RLS
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r'
order by relname;

-- anon / authenticated にテーブル権限が無いこと（0 行が期待値）
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated');

-- RPC が anon / authenticated から実行できないこと（false が期待値）
select has_function_privilege('anon', 'public.airreach_insert_scan(jsonb,jsonb,jsonb,jsonb,jsonb)', 'execute'),
       has_function_privilege('authenticated', 'public.airreach_insert_scan(jsonb,jsonb,jsonb,jsonb,jsonb)', 'execute');

-- service_role にテーブル権限が無いこと（0 行が期待値）
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'service_role';

-- service_role が RPC 2 本だけ実行できること（true, true が期待値）
select has_function_privilege('service_role', 'public.airreach_insert_scan(jsonb,jsonb,jsonb,jsonb,jsonb)', 'execute'),
       has_function_privilege('service_role', 'public.airreach_get_shared_scan(text)', 'execute');

-- 両 RPC が SECURITY DEFINER かつ search_path 固定であること
select proname, prosecdef, proconfig
from pg_proc
where pronamespace = 'public'::regnamespace and proname like 'airreach_%';

-- seed
select rule_version, default_display_version, published_at from public.rule_versions;
```

## 権限の方針

- この Project の既定 ACL（`postgres` が作るオブジェクト）は anon / authenticated / service_role に DML も EXECUTE も与えない（2026-09-28 実測）。**必要な権限は migration に明示 GRANT する。** 既定権限に依存しない。
- Phase 1: service_role には RPC 2 本の EXECUTE だけ（テーブル権限ゼロ）。RPC は SECURITY DEFINER で `search_path = ''`。anon / authenticated は権限なし、以後の自動付与も停止。
- Phase 2: authenticated 向けの RLS ポリシーを追加するときは、**同じ migration で `grant select ... to authenticated` を明示する**。ポリシーだけでは読めない。
- 適用のたびに上の確認クエリで権限を検証する。

適用後は Supabase MCP の `get_advisors`（security / performance）も確認する。

## 書き込み経路

ブラウザ → Vercel Functions `api/airreach/`（`docs/airreach-vercel-api.md`） → PostgREST `rpc/airreach_insert_scan` → 本 DB。
共有結果の読み取りは `rpc/airreach_get_shared_scan`（`share_token` の SHA-256 を渡す）。
`service_role` キーは Vercel の server-side Environment Variables にだけ置き、その鍵で使えるのはこの RPC 2 本だけ。
（`ops/airreach-api` の Cloudflare 版は比較・ロールバック用に残置。本番構成からは外す）

## Phase 2 ログイン・顧客管理・月次レポート（PR #57・未適用）

| ファイル | 内容 |
|---|---|
| `migrations/20260930120000_airreach_phase2_auth_reports.sql` | 社内メンバー・顧客・顧客側担当者・対象サイト・AI計測・流入・施策・レポートの8テーブル、RLS（社内は全件、顧客は自社の公開済みレポートだけ）、RPC `airreach_me()` / `airreach_client_scans()` |
| `migrations/20260930130000_airreach_phase2_signup_guard.sql` | Auth の Before User Created フック関数。`staff_members` か `client_members` に登録済みのメールだけがアカウントを作れる |
| `rollback/20260930120000_airreach_phase2_rollback.sql` | Phase 2 の取り消し（Phase 1 には触らない・Phase 2 の行は消える） |

ローカル検証: `scripts/airreach-api/phase2-rls-test.sql`（26 PASS）。取り消し→再適用で Phase 1 の関数と行が変わらないことも確認済み。

### 適用手順（Change ID の承認後にだけ）

`scripts/airreach-api/phase2-apply.py` で1手順ずつ実行する。トークンは本人のアカウントで期限つきに発行し、`~/.config/airreach/supabase_token`（chmod 600）に置く。スクリプトは AirReach 以外の Project を拒否する。

1. `check` — 読むだけ。Phase 1 があり Phase 2 が無いことを確認
2. `apply-db` — migration 2本を適用し、権限を6項目で検証
3. `add-staff <email> admin` — 最初の管理者
4. `auth-config` — 戻り先 `https://trillion-bank.jp/airreach/app/`・日本語のメール文面（`~/.config/airreach/smtp.json` があれば SMTP も）。変更前の設定を `~/.config/airreach/` に保存
5. `auth-hook` — 登録制限フックを有効化（管理者が0人なら止まる）
6. `anon-key-to-vercel` — 公開用キーを Vercel 本番の `SUPABASE_ANON_KEY` に登録（値は表示しない）
7. PR #57 をマージ → 本番で管理者のログイン・顧客登録・レポート作成を確認

取り消すときは、フックを無効にしてから rollback SQL を実行し、Vercel の `SUPABASE_ANON_KEY` を消す。

⚠️ Supabase 標準のメール送信は、Supabase のチームメンバー宛てにしか届かない。顧客がログインするには独自 SMTP が必要。

## Phase 2 で見送ったもの

- `accounts` / `memberships` / `client_relationships` / `locations`（代理店の階層。今回は社内と顧客の2者だけ）
- `scans.status` の変更（認証ユーザー限定）、サイト別履歴一覧 API
- `scan_findings`（検出内容の正規化。Phase 1 は `scans.raw_result` と `scan_checks.state` で代替）
