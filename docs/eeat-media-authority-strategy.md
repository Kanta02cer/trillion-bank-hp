# E-E-A-T / メディア / 権威性戦略（SEO・AIO・GEO）

Date: 2026-09-20
Status: ACTIVE
Owner: Trillion Bank（公開面）

## 目的

検索・AI回答・人が判断する局面のすべてで、**Trillion Bank / 井上幹太 / HackⅡ / AirReach / Adctor** が同じ一次情報として一貫して参照されるようにする。

権威はキーワード密度ではなく、次の4層で積む。

| 層 | 意味 | サイト上の置き場 |
|---|---|---|
| Experience | 実測・現場の観測 | Insights 調査レポート、SAMPLE→承認済み事例 |
| Expertise | 定義・測定方法の正確さ | 用語柱・測定方法・FAQ |
| Authoritativeness | 他者からの言及・出演 | Media、CEO、外部寄稿の引用リンク |
| Trust | 法人・連絡先・限界の明示 | Company、免責、銀行ではない注記 |

## エンティティ・ロック（公開の前提）

すべての公開面・外部寄稿で揃える識別子。

| 項目 | 固定値 |
|---|---|
| 法人名 | 株式会社Trillion Bank |
| 通称 | トリリオンバンク / TRILLION BANK |
| 代表 | 井上 幹太（Kanta Inoue） |
| 代表URL | `/trillionbank/ceo/` |
| 会社URL | `/trillionbank/company/` |
| Organization `@id` | `https://trillion-bank.jp/#organization` |
| Person `@id` | `https://trillion-bank.jp/#kanta-inoue` |
| ロゴ | `tb-logo-symbol.webp` / `tb-logo-hero.webp` |

外部記事・出演後は、媒体側の表記ゆれをチェックリストで回収する（旧社名・旧ロゴ・「銀行」誤認・価格の勝手記載を禁止）。

## サイト情報アーキテクチャ（権威の骨格）

```
/                         … 二事業の結論 + FAQ（エンティティ入口）
/trillionbank/company/    … 法人事実 + FAQ（Trust）
/trillionbank/ceo/        … 人物エンティティ + 出演一次リンク（A + Experience）
/trillionbank/media/      … 出演・掲載の分類台帳 + 取材テーマ
/trillionbank/insights/   … 解説クラスタのハブ（Expertise）
/trillionbank/ai-search/  … 「AI検索対策」柱
/airreach/                … AirReach 柱（説明。ツール画面は noindex）
/trillionbank/business/*  … 製品定義（測定 vs R&D を分離）
```

ツール画面（`/airreach/result/` `/airreach/sales/**` `/airreach/studio/` 等）は **権威の証拠には使わず noindex**。証拠は測定方法記事・調査・承認済み事例に置く。

## SEO記事の整理方針

詳細は `docs/seo-article-ownership.md`。要約:

1. **1意図 = 1代表URL**（柱 or 用語定義記事）。
2. 同趣旨の古い記事は代表へ内部リンクを集約。リダイレクトは計測後に段階実施。
3. 「選び方」「支援会社」系は変換クラスタとして維持し、必ず柱・測定記事・相談CTAへ戻す。
4. partner / sme クラスタはオーディエンス別。製品定義とは混ぜない。
5. 顧客名・成果数字は `APPROVAL_REQUIRED` のまま。SAMPLE以外は出さない。

## 代表出演・外部寄稿の戦略

### 狙い（優先順）

1. **定義の一次ソース化** … 「AI検索対策とは／測定とは」を語る枠（専門メディア・業界紙）。
2. **人物エンティティの補強** … 起業・人材・テック番組（既存の令和の虎等を継続し、テーマをAI検索測定へ寄せる）。
3. **共同提案チャネル** … 広告代理店・制作会社向け寄稿（販売ではなく「測定の入れ方」）。
4. **避けた方がよい枠** … 価格保証・「必ず引用される」系、未承認顧客事例、投資家向け数値。

### 取材・登壇の標準パッケージ（Mediaページに公開）

媒体が記事を書きやすいよう、常設で渡す素材:

- 会社1文 / 二事業の区別 / 代表プロフィール50字・200字
- ロゴURL・顔写真URL・CEOページURL
- 話すテーマ3本（測定 / 用語の使い分け / 内製か外注か）
- 言わないこと（保証・未承認事例・銀行誤認）
- 事実の出典は常に `public_facts.yml` と会社・CEOページ

### 出演後の運用（48時間以内）

1. Media台帳に「代表出演 / 会社掲載 / 過去掲載」で追加。
2. CEO `subjectOf` と Media カードを同期。
3. 関連 Insights 記事から1本だけ文脈リンク。
4. 媒体側の社名・肩書・事業説明の誤りがあれば訂正依頼。
5. スクショやロゴ利用は許諾確認後のみ。

### 外部に書いてもらうときの依頼テンプレ（要旨）

- 主題は「Trillion Bankの宣伝」ではなく **読者の判断軸**（測定範囲、保証しないこと、用語の揺れ）。
- 会社紹介は会社概要URLへのリンク1つに限定。
- 製品は HackⅡ（測定・導入相談）と Adctor（R&D）を混同しない。
- 引用する数字は公開承認済みか SAMPLE 明示のみ。

## FAQ設計

| 置き場 | 役割 |
|---|---|
| TOP FAQ | 初見向け（何の会社か / HackⅡ / Adctor / 向き不向き） |
| Company FAQ | 法人・問い合わせ・銀行ではない・二事業 |
| 各柱ページ | その意図固有（AI検索対策とは、AirReachで分かること 等） |
| 記事 FAQ | 記事意図のみ。会社FAQのコピペ禁止 |

回答文は `public_facts` の定義・限界と一致させる。構造化データは **画面に見えるFAQと同一文**。

## タイポグラフィ（ブランド統一）

AI定番の Inter + Space Grotesk をやめ、ロゴの幾何学ワードマークに寄せる。

| トークン | フォント | 用途 |
|---|---|---|
| `--sans` | IBM Plex Sans JP | 本文・日本語UI |
| `--en` / `--brand` | Sora | 英字ラベル・ブランド近似・見出しアクセント |
| `--mono` | IBM Plex Mono | 日付・番号・データ・eyebrow |

詳細は `docs/brand-typography.md`。

## フェーズ

| Phase | 内容 | 状態 |
|---|---|---|
| P0 | 戦略文書・記事所有マップ・フォント切替・Company/Media権威強化 | 完了 |
| P1 | Insightsハブ更新・ツール役割確定・Press Kit | 完了 |
| P2 | 出演後48h運用定着・301候補準備（有効化はGSC後） | 完了 |
| P3 | 業種固有コピー実装・事例承認ゲート・301ランブック（実行はGSC/承認後） | 準備完了・実行待ち |
| P4 | GSC sitemap/noindex整合・柱ページ送信・自動検収 | 本対応 |

## Stop conditions

- 未承認の顧客名・成果数字の公開
- Adctorを完成商用決済として書くこと
- 旧Regalis名称・価格・住所の現在事実化
- 「世界初」「必ず」「保証」系の誇張
