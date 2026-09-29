---
title: "トリリオンバンクのエンティティ衝突をどう改善するか｜実装プロセス公開"
date: 2026-09-05
last_modified: 2026-09-05
category: 調査レポート
author: 井上 幹太
tbdesc: "株式会社Trillion Bankが、類似名称との混同を減らすために実施した社名統一、公式URL集約、構造化データ、外部サイテーション、固定質問での再計測プロセスを公開します。"
keywords: "エンティティ最適化,AI検索 ブランド誤認,トリリオンバンク,株式会社Trillion Bank,ナレッジグラフ,GEO対策"
ai_summary: "正式社名を株式会社Trillion Bank、通称をトリリオンバンクに統一し、所在地、ロゴ、公式URL、Organization/LocalBusiness、外部プロフィールを同じ情報へ揃える。改善結果は固定質問で継続測定し、未確認の成果は主張しない。"
og_image: /images/hero/tb-logo-color.webp
references:
  - title: "Google Search Central — Site names"
    url: "https://developers.google.com/search/docs/appearance/site-names"
  - title: "Google Search Central — Organization structured data"
    url: "https://developers.google.com/search/docs/appearance/structured-data/organization"
faq_items:
  - question: "エンティティ衝突とは何ですか？"
    answer: "会社名やブランド名が既存作品、商品、別会社と似ているため、検索エンジンやAIが同一対象か別対象かを判別しにくい状態です。"
  - question: "株式会社Trillion Bankの正式な表記は何ですか？"
    answer: "法人の正式名称は株式会社Trillion Bank、通称はトリリオンバンク、英語ブランド表記はTRILLION BANKです。"
  - question: "社名を統一すればAIの誤認はすぐ直りますか？"
    answer: "保証されません。公式サイト内の統一に加え、Googleビジネスプロフィール、SNS、プレスリリース、第三者記事など外部情報も同じ表記へ揃え、継続的に再計測する必要があります。"
---

**エンティティ衝突とは、似た名称を持つ作品・商品・別会社が存在し、検索エンジンやAIが会社とブランドの関係を誤って結び付ける状態です。**

株式会社Trillion Bankでは、「トリリオンバンク」という通称が別の固有名詞と混同される可能性を確認しました。本記事は解消済みという成果報告ではなく、改善のために実施した内容と判定方法を公開するものです。

## 正式名称と通称を固定する

| 項目 | 統一表記 |
|---|---|
| 法人の正式名称 | 株式会社Trillion Bank |
| 通称 | トリリオンバンク |
| 英語ブランド | TRILLION BANK |
| 公式ドメイン | trillion-bank.jp |
| 主力サービス | AI検索計測・最適化インフラ AirReach Consulting |

「株式会社トリリオンバンク」は過去表記・検索補助用のalternateNameとして残し、現在の法人名としては使用しません。

## NAPとロゴを統一する

- 所在地：〒102-0083 東京都千代田区麹町六丁目2番1号 麹町サイトビル6階 ROOMZ
- addressLocality：千代田区
- areaServed：麹町、千代田区、東京都、JP
- ロゴ：TRILLION BANKの現行シンボル・ワードマーク

トップ、会社概要、フッター、llms.txt、構造化データ、Googleビジネスプロフィール、SNS、プレスリリース、第三者プロフィールで同じ文字列を使います。

## 構造化データを1つのグラフへ整理する

記事ページでは、Organization、Person、LocalBusiness、Article、FAQPage、BreadcrumbListを1つの`@graph`にまとめ、`@id`で参照します。

LocalBusinessの所在地は本文と一致させ、旧商号（Regalis Japan Group株式会社）は`parentOrganization`ではなく沿革・旧称として扱います（同一法人の旧商号を親会社として宣言しない）。`sameAs`には実際に管理している組織プロフィールだけを追加し、出演動画などは別の関係として扱います。

## 第三者サイテーションを増やす

公式サイトだけで自己申告を増やしても、別の情報源から確認できません。優先する外部掲載は次のとおりです。

1. PR TIMESの会社・製品リリース
2. ITreview・BOXIL等の製品プロフィール
3. LLMO・GEO・AEOツール比較記事
4. 登壇・出演・採択・受賞の主催者ページ
5. LinkedIn等の公式組織プロフィール

掲載依頼では、正式社名、短い会社説明、所在地、サービス名、公式URL、新ロゴを同じ掲載パックで渡します。

## 改善を判定する固定質問

| 質問 | 確認すること |
|---|---|
| トリリオンバンクとは？ | IT企業として識別されるか |
| 株式会社Trillion Bankの事業内容は？ | AirReach Consultingと公式URLが出るか |
| AI検索計測のトリリオンバンク | サービスとの共起が形成されるか |
| トリリオンバンク AirReach Consulting | 別作品・別商品より公式情報が優先されるか |

回答本文、引用URL、誤認内容、実行日時を保存し、サイト変更・外部掲載の前後を比較します。

## 現時点で言えること

社名、所在地、ロゴ、構造化データ、主URLの統一は実施できますが、AI回答の誤認解消やSOV向上は即時に保証できません。外部掲載が公開され、検索・AIクローラーが取得した後に、同じ質問で再計測して判定します。

