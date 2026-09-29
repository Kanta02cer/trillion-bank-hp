# AirReach API on Vercel — 設計と運用（Phase 1）

Date: 2026-09-29
Status: IMPLEMENTED（ローカルテスト済み）— **本番未デプロイ**
関連: `docs/airreach-supabase-phase1.md`（DB・RPC・RLS）、`supabase/`、`api/airreach/`

## 結論

AirReach は **Vercel（フロント + API）と Supabase（DB）だけ**で運用する。Cloudflare Worker は本番構成から外す。

```
ブラウザ（trillion-bank.jp）
  │  same-origin
  ▼
Vercel
  ├─ 静的サイト（Jekyll ビルド済み _site）
  └─ Vercel Functions（api/airreach/*.js, Node.js）
        ├─ POST /api/airreach/scans                 保存 → RPC airreach_insert_scan
        ├─ GET  /api/airreach/shared-scans/:token   共有 → RPC airreach_get_shared_scan
        ├─ GET  /api/airreach/fetch?url=            公開ページ取得（SSRF ガード付き）
        └─ GET  /api/airreach/health
              │  service_role（server-side env）/ RPC のみ
              ▼
        Supabase「AirReach」Project（opjjxbdrgfyoydyrmzns）
```

DB 設計・RPC・RLS は Phase 1 のまま変更しない。Supabase へはテーブルではなく RPC 2 本だけで到達する。

## 1. 現在の Vercel 構成（調査結果）

| 項目 | 実態 |
|---|---|
| デプロイ経路 | `.github/workflows/deploy-vercel-static.yml` が main への push で Jekyll をビルドし、`_site` + `api/` を **`vercel-deploy` ブランチ**に force push。Vercel はこのブランチだけをデプロイ（`vercel.json` の `git.deploymentEnabled`） |
| 生成される `vercel.json` | `framework: null`, `buildCommand: null`, `installCommand: null`, `outputDirectory: "."`, `cleanUrls: true`, `trailingSlash: true` |
| 生成される `package.json` | `{ name, private }` のみ。**`engines` も `type` も無い** |
| 既存の関数 | `api/*.js`（`export default async function handler(req, res)`、`req.body` / `req.query` / `res.status().json()`）。Google 系は Secret 未設定で非稼働 |
| API の URL | `trailingSlash: true` のため `/api/airreach/scans` は 308 で `/api/airreach/scans/` へ。フロントの `airreach-api.js` は末尾 `/` を付けて呼ぶ |
| ドメイン | `trillion-bank.jp` は現在 GitHub Pages。Vercel は `trillion-bank-hp.vercel.app`。**same-origin になるのは `trillion-bank.jp` を Vercel で配信してから** |
| Node.js | Vercel プロジェクト設定で決まる。Preview の `health` が `node 24.20.0` を返したため、現在は **24.x**。CI の smoke は Node 22、ローカルは 24.18 |

## 2. Cloudflare 依存箇所（移行前）

| 場所 | 依存 | 扱い |
|---|---|---|
| `ops/airreach-fetch/`（取得 Worker） | Worker ランタイム、`cf` fetch オプション、workers.dev URL | `api/airreach/fetch.js` に移植。**削除はまだしない**（比較・ロールバック用） |
| `ops/airreach-api/`（保存 Worker） | `wrangler.jsonc`、Rate Limiting binding、Worker Env 型、`ExportedHandler` | `api/airreach/*.js` に移植。**削除はまだしない** |
| `assets/js/airreach-diagnose.js` | `FIRST_PARTY_PROXY = https://trillion-bank-airreach-fetch.trillion-bank.workers.dev/` と allorigins フォールバック | **未変更**（別工程 PR-3）。`/api/airreach/fetch/?url=` へ切り替え、allorigins は削除する |
| `docs/airreach-display-contract.md` ほか | Worker の再デプロイ手順の記述 | PR-3 で追従 |

## 3. 移行後の構成（ファイル）

```
api/airreach/
  package.json                 {"type":"module"}（この配下は ESM）
  health.js                    GET  /api/airreach/health
  scans.js                     POST /api/airreach/scans
  fetch.js                     GET  /api/airreach/fetch?url=
  shared-scans.js              GET  /api/airreach/shared-scans?shareToken=（パス形式は rewrite で写す）
  _lib/                        共通処理（"_" 始まりは関数として公開されない）
    http.js        Origin 方針 / OPTIONS / 本文読み取り / JSON 応答 / ログ
    env.js         環境変数（server-side のみ）
    errors.js      ApiError
    validate.js    payload 検証・採点再計算（Worker 版から機械的に移植、ロジック同一）
    mapper.js      検証済み診断 → RPC 引数（同上）
    supabase.js    RPC 2 本だけを呼ぶクライアント、PostgREST エラー写像
    share-token.js CSPRNG 32 byte → base64url、SHA-256
    url.js         URL 無害化、SSRF ガード（リテラル + DNS 解決先）
    fetch-proxy.js 公開ページ取得（ops/airreach-fetch から移植）
    rules.js       判定ルール定義
scripts/airreach-api/            ローカル検証（デプロイされない）
  local-server.mjs   Vercel の req/res ヘルパーを模した最小ハーネス
  mock-supabase.mjs  PostgREST モック（RPC 2 本のみ、テーブルは 404 で記録）
  mock-target.mjs    fetch テスト用の対象サイト
  fixture.mjs        自己整合した診断 payload
  e2e.mjs            E2E 一式
```

`deploy-vercel-static.yml` は `api/` を丸ごとコピーするため、`api/airreach/` は既存の仕組みのままデプロイ対象になる。

## 4. エンドポイント仕様

Worker 版と同じ契約。詳細な検証項目とエラー表は `ops/airreach-api/README.md` と同一。

| メソッド / パス | 成功 | 備考 |
|---|---|---|
| `POST /api/airreach/scans/` | 201 `{ ok, scanId, shareToken, sharePath, savedAt }` | 本文 256 KB まで。`shareToken` はこの応答にしか現れない |
| `GET /api/airreach/shared-scans/?shareToken=<token>` | 200 `{ ok, scan, factors, checks, sources, result }` | 形式外・未登録・失効は 404。パス形式 `/api/airreach/shared-scans/:shareToken/` は vercel.json の rewrite で同じ関数へ写す（§4-1） |
| `GET /api/airreach/fetch/?url=` | 取得文書そのもの（`X-AirReach-Final-URL` 付き） | 404 / 410 はそのまま空本文。400（URL 不正・拒否ホスト）/ 502（上流・種別・サイズ）/ 504（タイムアウト） |
| `GET /api/airreach/health/` | 200 `{ ok, service, version }` | DB に触れず、環境変数・ランタイムの情報も返さない |
| `PATCH …/status` | 未提供（404） | Phase 2 で認証必須 |

エラー本文は `{ ok:false, error:{ code, message, details[] } }`。状態: 400 / 403 / 404 / 405 / 409 / 413 / 422 / 500 / 503（Supabase 起因）。429 は Vercel Firewall が返す。

### 4-1. 動的セグメントについて（Preview 検証で判明）

この Vercel プロジェクトの構成（`framework: null`、`outputDirectory: "."`）では、`api/airreach/shared-scans/[shareToken].js` のような動的セグメントの関数が **ルーティングされず 404** になった（Preview `trillion-bank-b1gpc0zia…` で確認。同じ配下の `health.js` / `scans.js` / `fetch.js` は動作）。そのため共有取得は **クエリ形式** `GET /api/airreach/shared-scans/?shareToken=<token>` を正とする（`api/airreach/shared-scans.js`）。

パス形式の URL も使いたい場合は、`deploy-vercel-static.yml` が生成する `vercel.json` に次の rewrite を加える（ワークフロー変更のため承認後）:

```json
"rewrites": [
  { "source": "/api/airreach/shared-scans/:shareToken", "destination": "/api/airreach/shared-scans?shareToken=:shareToken" }
]
```

ローカルハーネス（`scripts/airreach-api/local-server.mjs`）はこの rewrite を模してパス形式も同じ関数へ渡す。

### fetch の仕様（`ops/airreach-fetch` から維持）

- http / https のみ。認証情報とトークンらしきクエリ（token / key / auth / session / sig …）を除去
- プライベート IP / ループバック / リンクローカル / CGNAT / マルチキャスト、`localhost`、`.local` 等の内部サフィックス、単一ラベル名を拒否
- **追加**: ホスト名の DNS 解決先も検査し、1 つでもプライベート / 予約 / 非グローバル IP に解決されるホストを拒否（Worker 版には無かった）
- **追加（DNS リバインディング / TOCTOU 対策）**: `fetch()` は使わず、Node 標準 `http` / `https` の `lookup` オプションで **検証済み IP を接続先に固定**する。ホスト名は `host` に渡すので Host ヘッダ・TLS の SNI・証明書検証はホスト名のまま。リダイレクトのホップごとに再解決・再検証・再固定する。外部依存なし
- **追加**: `Content-Encoding`（gzip / deflate / br）は Node 標準 `zlib` で伸長し、**伸長後のサイズ**で上限を判定（gzip bomb 対策）
- リダイレクト最大 3 回、各ホップで再検査。`Location` 無しは 502
- タイムアウト既定 9 秒（`AIRREACH_FETCH_TIMEOUT_MS`。Vercel Hobby の 10 秒制限に収める。Pro なら 12 秒に戻せる）
- 本文上限 900 KB（ヘッダとストリームの両方で打ち切り）。許可する種別は html / xhtml / plain / markdown / json
- 404 / 410 は状態コードそのまま・空本文で返し、「無い」と「取れない」を区別する
- 生 HTML は保存しない。応答は `Cache-Control: private, max-age=60`

## 5. Same-Origin と CORS

- 本番は `https://trillion-bank.jp/api/airreach/...` を same-origin で呼ぶ。**CORS ヘッダは出さない**。
- `AIRREACH_ALLOWED_ORIGINS`（カンマ区切り）に載る Origin からの別オリジン要求だけ、CORS ヘッダ付きで許可する。Preview / ローカル（例: Jekyll `http://127.0.0.1:4000` から API へ）用で、Production では未設定にする。
- それ以外の別オリジン要求は **処理せず 403**。Origin ヘッダが無い要求（curl 等）は通す。Origin は認証ではない。

## 6. Rate Limit（Vercel Firewall）

コード内には Rate Limit を持たない。Vercel Pro の Firewall → Rules で次を設定する（デプロイ後の作業）。

| 対象 | 条件 | 制限 | 動作 |
|---|---|---|---|
| 保存 | Request Path starts with `/api/airreach/scans` AND Method = POST | 30 requests / 60 s / IP | Deny（429） |
| 共有取得 | Request Path starts with `/api/airreach/shared-scans/` AND Method = GET | 120 requests / 60 s / IP | Deny（429） |
| 取得 | Request Path starts with `/api/airreach/fetch` | 90 requests / 60 s / IP（1 診断 = 3 要求） | Deny（429） |

## 7. Environment Variables（Vercel ダッシュボード）

| 名前 | 環境 | 値 |
|---|---|---|
| `SUPABASE_URL` | Production / Preview | `https://opjjxbdrgfyoydyrmzns.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Production / Preview | AirReach Project の service_role（**Sensitive** にする。Hack2 の鍵ではない） |
| `AIRREACH_ALLOWED_ORIGINS` | Preview / Development のみ | 例 `http://127.0.0.1:4000,http://localhost:4000` |
| `AIRREACH_MAX_BODY_BYTES` / `AIRREACH_SUPABASE_TIMEOUT_MS` / `AIRREACH_FETCH_TIMEOUT_MS` / `AIRREACH_FETCH_MAX_BYTES` | 任意 | 既定 262144 / 8000 / 9000 / 900000 |
| `AIRREACH_FETCH_ALLOW_LOOPBACK_FOR_TESTS` / `AIRREACH_TEST_RESOLVE_MAP` | **設定しない** | ローカル E2E 専用。Vercel には絶対に置かない |

`NEXT_PUBLIC_` / `VITE_` / `PUBLIC_` は付けない。鍵はコード・Git・ブラウザに出さない。

**鍵の取り違えに注意**: `SUPABASE_SERVICE_ROLE_KEY` に anon / publishable（`sb_publishable_…`）の鍵を入れると、RPC は Postgres 側で `permission denied for function airreach_insert_scan`（HTTP 401）になり、API は 500 を返す（Preview 検証 2026-09-28 で発生）。正しいのは Project Settings → API Keys の **service_role**（旧形式 JWT）または **Secret keys**（`sb_secret_…`）。切り分けは Supabase の API ログ（`/rest/v1/rpc/…` が 401、Postgres ログに `permission denied for function`）と Vercel の関数ログ（`hint: supabase_not_configured` 等）で行う。本番の `health` は疎通だけを返し、環境変数の情報は出さない。環境変数を変えたら再デプロイが必要。

## 8. Node.js（調査結果と提案）

- Vercel 側の Node バージョンは **プロジェクト設定**で決まり、生成される `package.json` に `engines` が無いためリポジトリからは固定されていない。ダッシュボードで確認が必要。
- 実装は Node 20 / 22 / 24 いずれでも動く標準 API（`fetch`、`crypto.subtle`、`dns/promises`）だけを使う。ESM は `api/airreach/package.json` の `"type":"module"` で明示した。
- **提案**: `deploy-vercel-static.yml` が生成する `package.json` に `"engines": { "node": "24.x" }` を追加し、ローカル（24.18）と揃える。Node 20 は 2026-04 に EOL。影響は Vercel Functions のランタイムだけ（Jekyll ビルドは GitHub Actions 側で Ruby、Vercel ではビルドしない）。既存 `api/*.js` も標準 API のみで、24 で動かない要素は見当たらない。**この変更はまだ行っていない**（承認後にワークフローを更新する）。

## 9. ローカル検証

```bash
node scripts/airreach-api/e2e.mjs
```

モック Supabase・モック対象サイト・ローカルハーネスを起動し、以下を確認する（106 件）。

- health、same-origin / 許可 Origin / 非許可 Origin、OPTIONS
- POST 201 → 同一 scanId 409、400 / 422 / 413、GET 共有 200 / 不正 404 / 失効 404
- fetch: 正常、llms.txt / robots.txt、UA、リダイレクト（1 / 3 / 5 回、ループ、私設アドレスへ、localhost へ、Location 無し）、タイムアウト、2 MB（Content-Length / chunked）、gzip 伸長と gzip bomb、404 / 410 / 500、PDF 拒否、秘密クエリ除去、SSRF（IPv4 12 種 + IPv6 25 種）、外部サイト（example.com）、DNS でループバックに解決されるホストの拒否、テストフラグ無しでのループバック拒否
- 接続先固定: 注入リゾルバで「実 DNS に無い名前が検証済み IP へ接続される（接続時に再解決しない）」「次の要求では再解決される」「リダイレクト先で再解決・再検証・再固定される」「混在 / IPv6 private の応答は拒否」を確認（`unit-pin.mjs`）。自己署名証明書のローカル HTTPS で SNI = ホスト名、Host = ホスト名、SAN に無い名前は 502 を確認（テスト専用の `AIRREACH_TEST_RESOLVE_MAP` はループバック許可フラグが有効なときだけ参照される。Vercel には置かない）
- Supabase 500 / ハング / 停止 → 503、復旧 → 201
- ログに鍵・トークン・ハッシュ・本文・URL クエリが出ないこと、テーブル直接アクセス 0 件

ハーネスは `vercel dev` の代替であり、Vercel 固有の挙動（本文の自動解釈、308 リダイレクト、関数の実行時間上限）は Preview デプロイで最終確認する。

## 10. 移行手順（本番反映は承認後）

1. **PR-A（本書の実装）**: `api/airreach/`、`scripts/airreach-api/`、docs。main へマージすると `deploy-vercel-static.yml` が `vercel-deploy` を更新し、関数が Vercel に載る。ただし **環境変数が無いと 500（`supabase_not_configured`）** を返すだけで、データ露出はない。
2. Vercel ダッシュボードで環境変数（§7）を設定し、再デプロイ。`https://trillion-bank-hp.vercel.app/api/airreach/health/` で疎通確認。
3. Preview で実環境テスト（POST 201 → GET 200 → 409 → 404、fetch、ログ）。テストデータは削除。
4. Vercel Firewall の Rate Limit（§6）を設定。
5. **PR-3（フロント接続）**: 実装済み。`airreach-diagnose.js` は `/api/airreach/fetch/?url=` だけを使い allorigins を削除。`airreach-scan-sync.js`（保存 / 共有取得、相対 URL のみ）を追加し、`airreach-app.html` の `finishSurvey()`（1 回目の診断だけ保存、最長 2.5 秒待って遷移）と `boot()`（共有 → 端末内 snapshot → 通常診断の順に分岐）を接続。共有 URL は `/airreach/result/?share=<token>`。同一 origin 前提で CORS 設定は不要。
6. `trillion-bank.jp` を Vercel で配信（DNS 切替）。これで AirReach → Cloudflare の通信が 0 件になる。
7. 切替後に `ops/airreach-fetch` / `ops/airreach-api` を deprecated 化または削除（Worker も停止）。

## 11. Cloudflare 版との差分

| 項目 | Cloudflare 版 | Vercel 版 |
|---|---|---|
| ランタイム | Worker（`Request` / `Response`） | Node.js Functions（`req` / `res`） |
| Rate Limit | binding | Vercel Firewall（設定で対応） |
| CORS | 許可リスト常時 | same-origin 前提。`AIRREACH_ALLOWED_ORIGINS` で Preview / ローカルだけ |
| fetch の SSRF | リテラル判定のみ、`fetch()`（接続時に再解決） | リテラル + **DNS 解決先**判定、IPv6 はホワイトリスト方式、**検証済み IP に接続を固定**（`http`/`https` の `lookup`） |
| fetch のタイムアウト | 12 秒 | 9 秒既定（環境変数で調整） |
| 秘密 | `wrangler secret` | Vercel Environment Variables（Sensitive） |
| 検証・採点再計算・mapper・RPC クライアント・トークン | 同一ロジック（TypeScript → JS 移植） | |
