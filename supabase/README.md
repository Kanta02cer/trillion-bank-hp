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

## Phase 2（このディレクトリにまだ無いもの）

- Supabase Auth と `accounts` / `memberships` / `clients` / `client_relationships` / `locations`
- `authenticated` への RLS ポリシー付き SELECT 再付与
- `scans.status` の変更（認証ユーザー限定）、サイト別履歴一覧 API
- `scan_findings`（検出内容の正規化。Phase 1 は `scans.raw_result` と `scan_checks.state` で代替）
