# SEO記事 Ownership Map

Date: 2026-09-20
Status: ACTIVE
Companion: docs/eeat-media-authority-strategy.md / docs/seo-p0-site-architecture.md

## ルール

- 1検索意図 = 1代表URL。
- 代表以外は「支援」：代表へ内部リンク、重複H1を避ける、必要なら将来301。
- 製品URLと用語記事を混ぜない（HackⅡ ≠ AI検索対策）。
- ツール画面は ownership 対象外（noindex）。

## Pillar（柱・常時強化）

| 意図 | 代表URL | 役割 |
|---|---|---|
| 会社・エンティティ | `/` `/trillionbank/company/` | Trust / FAQ |
| 代表人物 | `/trillionbank/ceo/` | Person entity |
| メディア台帳 | `/trillionbank/media/` | 出演・掲載の一次リスト |
| AI検索対策 | `/trillionbank/ai-search/` | 対策の定義と進め方 |
| AirReach | `/airreach/` | 無料診断の説明 |
| HackⅡ | `/trillionbank/business/hack2/` | 測定サービス定義 |
| Pay per Crawl | `/trillionbank/business/pay-per-crawl/` | Adctor系・R&D |
| Pay per Citation | `/trillionbank/business/pay-per-citation/` | Adctor系・R&D |
| Insightsハブ | `/trillionbank/insights/` | クラスタ案内 |

## 用語・定義クラスタ（Expertise）

| 意図 | 代表記事 | 支援・統合候補 |
|---|---|---|
| SEO/AEO/GEO/AIO/LLMOの違い | `/trillionbank/news/seo-aeo-geo-aio-llmo-difference/` | `llmo-geo-aeo`（旧）→ 代表へ誘導優先 |
| AI検索の効果測定 | `ai-search-effect-measurement` / `ai-search-measurement-method` | 重複見出しを代表1本に寄せる |
| 引用率・引用分析 | `ai-citation-rate-calculation` / `generative-ai-citation-analysis` | 定義は前者、手順は後者 |
| SOV | `ai-search-sov` | 調査レポートはデータ側 |
| JSON-LD / E-E-A-T | `json-ld-eeat-ai-search` | 実装ガイド唯一 |
| llms.txt | `llms-txt-guide` | — |
| AI Overviews | `ai-overviews-optimization` | — |
| ChatGPT検索 | `chatgpt-search-optimization` | — |
| クローラー制御 | `ai-crawler-list-control` | — |

## 変換クラスタ（選び方・支援会社）

意図は近いが比較軸が違うため **維持**。各記事末尾で柱（AI検索対策 / HackⅡ）へ戻す。

- `ai-search-optimization-company`
- `aeo-support-company`
- `geo-consulting-company`
- `llmo-company-selection`
- `ai-search-marketing-support`
- `ai-brand-visibility-tool`
- `ai-search-tools-vendors` / `aeo-tools` / `aeo-tools-comparison`（ツール比較は1本へ将来統合検討）

## オーディエンス・クラスタ

| クラスタ | 代表入口 | 方針 |
|---|---|---|
| SME | Insights「中小企業」群 / `sme-*` | 維持。製品ページと分離 |
| Partner | `partner-program-overview` | 維持。代理店検討専用 |
| Industry | clinic / hotel / real-estate 等 | 維持。固有データ追加まで過度な量産禁止 |

## 調査・Experience

| 種別 | 扱い |
|---|---|
| `調査レポート` | Media / Insights から優先リンク。数字は測定条件を併記 |
| SAMPLE事例 | `/trillionbank/case-studies/**` のみ。承認後に実名置換 |

## ツール比較3本の役割（確定）

| 記事 | 役割 | 扱い |
|---|---|---|
| `ai-search-tools-vendors` | **代表** — 3分類＋選定観点 | Insights / 関連リンクの起点 |
| `aeo-tools` | 支援 — 計測7軸の深掘り | 代表へ誘導済み。維持 |
| `aeo-tools-comparison` | 支援 — 製品一覧（価格変動） | 代表へ誘導済み。301はGSC確認後 |

## P1 進捗

1. [x] `llmo-geo-aeo` → 用語代表へ誘導
2. [x] ツール比較3本の役割確定＋誘導
3. [x] Insightsハブを Ownership に合わせて更新
4. [x] 301候補のデータ化＋Worker `PENDING_REDIRECTS`（**有効化はGSC後**）
5. [x] 取材用事実シート（`/trillionbank/media/press-kit/`）

## P2 進捗

1. [x] 出演後48hチェックリスト（docs + `/trillionbank/media/ops-48h/`）
2. [x] Mediaに AFTER AIR セクション
3. [x] `docs/seo-redirect-candidates.md` + `_data/seo_redirect_candidates.yml`
4. [ ] GSCで重複確認後、候補を `approved` → Worker 301（人の判断）

## P3 進捗

1. [x] AirReach業種ページの固有H1/FAQ（noindex維持）
2. [x] 事例承認ゲート（`case_study_approvals.yml`）
3. [x] 301実行ランブック
4. [ ] GSC後の301実行 / 書面承認後の事例実名 / 業種 index 復帰（人の判断）

## 新規記事ゲート

公開前チェック:

- [ ] 既存の代表URLと意図が被っていない
- [ ] author = 井上幹太（または明示的な別著者）
- [ ] FAQがあるなら記事固有のみ
- [ ] 一次情報リンクと as-of 日付
- [ ] 誇張語・未承認数字なし
- [ ] 柱ページへの戻りリンク
