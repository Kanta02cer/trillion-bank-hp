# AirReach P0 — 役割再設計（店舗 / Sales / Expert）

Status: ACTIVE P0
Date: 2026-09-20
Audience: product + engineering

## 結論

機能追加より先に、**誰が・どの画面で・何をするか**を固定する。
1つの Client Data の上に、3種類の UI を載せる。

| 画面 | 役割 | 主なユーザー |
|---|---|---|
| AirReach 無料診断 | 入口。店舗が1人で使える | 店舗担当 |
| Sales Mode | 売る（診断・トーク・提案・案件） | 代理店・営業 |
| Expert（旧 Platform / Studio） | 測る・直す | Trillion / コンサル |

表示名の方針:

- **前面に出す**: AirReach / 診断結果 / やること / 相談する
- **前面に出さない**: Platform / Studio（Expert 内の道具として扱う）

## 店舗向けフロー（3STEP）

1. **ホームページのURLだけ**入れる →「30秒で無料診断する」
2. **このお店で合っていますか？**（店名・業種・地域は自動取得。違うときだけ直す）
3. **何を増やしたいですか？**（予約 / 来店 / 電話 / LINE など）→「この条件で診断する」

キーワード入力は店舗に求めない。サイト情報と業種から自動生成し、Sales / Expert で編集可能にする。

## 結果画面（店舗）

最初に見せるもの:

- AI・検索での見つかりやすさ（点数）
- お客様が探す言葉（件数・代表例）
- 改善できそうなポイント（件数）
- **いちばん最初に直すところ**（1件）＋主CTA 1つ

「詳しいデータを見る」は副導線。Studio / Platform / Google連携は結果直後に並べない。

## 証拠ラベル（表示）

| 内部分類 | 店舗・営業への表示 |
|---|---|
| Official | Google実測 |
| Observed | AirReach実測 / HackⅡ実測 |
| User Input | お客様入力 |
| Inferred / Estimated | 参考予測 |

数字そのものは LLM に作らせない。DB + 決定論計算のみ。LLM は説明・営業トーク・文案。

## Sales Mode（P0最小 → P1拡張）

P0（実装済み・端末内）:

- `/airreach/sales/` 診断履歴一覧
- `/airreach/sales/deal/?scan=` 案件（営業トーク・提案書下書き・ステータス）
- `/airreach/sales/present/?scan=` Present Mode（商談大画面）
- `/airreach/result/?scan=` 店舗と同じ結果の共有
- SQL草案: `ops/sql/airreach_p0_client_db.sql`（**未適用**）

P1:

- ログイン、サーバー顧客DB、見積、継続計測連携

## URL マップ（目標）

| パス | 用途 | P0 |
|---|---|---|
| `/airreach/` | 無料診断（URL-first） | 実装 |
| `/airreach/{industry}/` | 業種結果（互換） | 維持 |
| `/airreach/result/?scan=` | 共有可能な結果 | 実装 |
| `/airreach/sales/` | 営業トップ（履歴） | 実装 |
| `/airreach/sales/deal/?scan=` | 案件・提案 | 実装 |
| `/airreach/sales/present/?scan=` | 商談モード | 実装 |
| `/app/...` `/sales/...` | 本格アプリ | 後続（別基盤） |

## データ永続化

現状: `localStorage`（端末依存）。
P0橋渡し: `scanId` 単位で端末保存 + 共有URL。
本番目標: PostgreSQL（Client / Agency / Project / Diagnosis）。ER は `docs/airreach-p0-er.md`。

## 公開事実

`_data/public_facts.yml` の AirReach 定義を、4STEPアンケート前提から **URL-first 3STEP** 前提へ更新する。

## やらないこと（このP0）

- Studio への機能追加
- 未承認の顧客名・成果数字の公開
- 本番自動Deploy
- LLMによる数値の捏造
