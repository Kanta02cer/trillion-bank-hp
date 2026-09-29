# AirReach 表示契約（区分・状態・根拠リンク）

Date: 2026-09-27
Status: ACTIVE — 境界値・配点は **approved（2026-09-29、AirReach v1 の正式仕様）**
Source: 画面設計案「色分けと根拠リンク」2026-09-25、業種展開設計 2026-09-26

## 目的

点数の区分（低い・普通・高い）と、未取得時の表示規則を **1か所** で定義し、
診断画面・営業画面・営業トーク・判定エンジンがすべて同じ定義を参照する。
色の境界は採点式と切り離して版管理し、公開前に承認する。

## 唯一の定義

| 何 | 場所 |
|---|---|
| 区分・状態・文言・版 | `_data/airreach_display.yml` |
| JS への読み出し口 | `assets/js/airreach-display.js`（Liquid で YAML を埋め込む） |
| 判定ルール（採点式）の版 | `assets/js/airreach-diagnose.js` の `RULE_VERSION` |

参照側は境界値・ラベルを **コードに書かない**。`window.AirReachDisplay.band(score)` を呼ぶ。

- `_includes/airreach-app.html` … 項目カード・凡例・内訳表・4数字の区分チップ
- `assets/js/airreach-sales.js` … `scoreMeaning` / `level` / 内訳・方法論の行
- `assets/js/airreach-sales-kit.js` … 営業トークの区分文言
- `assets/js/airreach-scan-store.js` … 保存時の版スタンプ

## 現在の区分（band-v1・暫定）

| 区分 | 点数 | 色 | 意味 |
|---|---|---|---|
| 低い | 0〜39 | 赤 | 来店前に知りたい情報が、ホームページで見つけにくい |
| 普通 | 40〜69 | 黄 | 基本的な情報は載っているが、足りない項目がある |
| 高い | 70〜100 | 緑 | 知りたい情報が、ひととおり載っている |
| 未確認 | 点数なし | 灰 | 取得できなかったため判定していない。0点ではない |

点数は「ホームページの情報整備」の区分であり、AI掲載率・検索順位・予約数・他店との比較ではない。
色は補助で、ラベルを常に併記する（色覚に依存しない）。

## 3値評価と根拠

各チェックは `state: ok | ng | unknown` を持つ。

| 取得結果 | チェックの状態 | 点数 |
|---|---|---|
| 取得できて該当あり | ok | 加点 |
| 取得できて該当なし（404/410 や本文に無い） | ng | 0 |
| 取得できなかった（通信失敗・遮断・タイムアウト） | unknown | **加算しない（未確認）** |

- 各チェックは `evidence { url, finalUrl, anchor, fetchedAt, via, verified }` を持つ。
  `finalUrl` は取得時のリダイレクト後URL。`anchor` は取得HTMLに実在した id だけ（`#faq` を推測しない）。
- 項目の点数は既知のチェックだけで計算し、すべて未確認なら `null`。
- 総合点は必須項目（骨格・会社情報・FAQ）が `null` なら出さない。見つけやすさ（robots / llms.txt）だけ未確認なら、重みを再配分して計算し `state: 'partial'` を付ける。
- 結果には `ruleVersion` と `displayVersion` を必ず入れる。保存済み診断も同じ2つの版を持つ。

## 診断全体の状態

| 状態 | 表示 |
|---|---|
| verified | 数値・色・位置を表示。根拠リンクは finalUrl（検証済みアンカーがあれば付ける） |
| partial | 取得済み項目のみ表示。必須項目が欠けたら総合点なし |
| failed | 数値・色を出さない。理由と再試行を示す。リンクを推測しない |
| no_site | 対象外。0点にしない |

## 取得Worker（ops/airreach-fetch）

- `Access-Control-Expose-Headers: X-AirReach-Final-URL` を追加済み（`src/index.ts`）。**再デプロイまでは** ブラウザが最終URLを読めず、要求URLで代替する。
- 現行のデプロイ済みWorkerは上流 404 を 502 に変換して返すため、Worker経由では「無い」と「取れない」を区別できず **未確認** になる。`src/index.ts` で 404/410 をそのまま返すよう修正済み。再デプロイ後に区別が有効になる。
- デプロイはエンジニアの PR と Cloudflare 権限で行う（`deploy/index.js` は再ビルドが必要）。

## 承認状況（2026-09-29）

1. 境界値 39 / 69 と「普通」の意味 → **承認済み**（`approval.status: approved`、`approved_on: 2026-09-29`）
2. 4項目の配点・検出条件（ruleVersion `airreach-common-v1`）→ **承認済み**（AirReach v1 の正式仕様）
3. 旧結果への適用方針（端末内の保存済み診断は `displayVersion` で判別できる）
4. 色覚に依存しないラベルの目視確認

## 確認手順

1. `python3 scripts/content_guard.py`
2. `bundle exec jekyll build` → `/airreach/` で診断し、項目カードに区分ラベルと「未確認」が出ること
3. robots.txt を返さないサイトで「見つけやすさ」が未確認（0点でない）になること
4. 内訳表の総合行に判定ルール・表示区分の版が出ること

## 対策・根拠リンク・HackⅡ案内の分離（2026-09-27 追加）

- 対策（`report.actions`）は最大3件で、診断で「なし」だった項目と業種の既定から作る。HackⅡ / Teams は対策に入れない。
- 各対策に `evidence { label, href, note }` を付ける。`href` は診断時に取得した最終URL。FAQ系の対策で取得HTMLに実在する id があるときだけ `#id` を付け、無ければページ先頭を開く（`#faq` を推測しない）。
- HackⅡ の案内は `report.referral`（エンジン側は `result.referral`）として別オブジェクトにし、画面では対策の下の破線枠（`#ar-referral`）にだけ表示する。相談CTA（`#ar-cta-meet`）もこの枠に置く。
- 4数字の「いま」のラベルは `ホームページの情報整備`、意味文は「…の点数（AI掲載率・順位・予約数ではありません）」に統一（`airreach-industry.js`）。結果文の `summary` も情報整備の言い方に限定。
- `content_guard.py` に `scoped_claim_patterns` を追加。AirReach のJS・include・データに対して、AI掲載・順位・成果の断定表現と、HackⅡ を対策に混ぜる書き方を検出する（否定形は許容）。
