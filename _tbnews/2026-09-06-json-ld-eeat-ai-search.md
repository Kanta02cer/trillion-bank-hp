---
layout: tb-article-authority
insight: true
toc: true
direct_answer: "E-E-A-Tを機械可読にするとは、ページ上に表示している運営者・著者・更新日・出典といった信頼の根拠を、schema.org語彙のJSON-LDとして記述し、検索エンジンやAIが同一エンティティとして解釈できる状態にすることです。"
title: "構造化データ（JSON-LD）でE-E-A-Tを機械可読にする実装ガイド"
date: 2026-09-06
last_modified: 2026-09-06
category: 技術
author: 井上 幹太
tbdesc: "E-E-A-Tの根拠をJSON-LDで機械可読にする実装ガイド。Organization・Person・Articleとの対応表、@idによるエンティティ設計、可視コンテンツ一致の原則、検証手順、やってはいけない実装、構造化データの限界まで解説します。"
keywords: "構造化データ E-E-A-T,JSON-LD 実装,schema.org Organization,knowsAbout,sameAs,FAQPage ガイドライン,AI検索 構造化データ,Trillion Bank"
ai_summary: "E-E-A-Tを機械可読にするには、Organization・Person・ArticleをJSON-LDで記述し、@idで同一エンティティを全ページから参照する。前提は可視コンテンツとの一致であり、構造化データ単独では順位・リッチリザルト・AI回答での引用は決まらない。"
og_image: /images/hero/tb-logo-color.webp
references:
  - title: "Google Search Central — Introduction to structured data markup in Google Search"
    url: "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data"
    accessed: 2026-09-06
  - title: "Google Search Central — General structured data guidelines"
    url: "https://developers.google.com/search/docs/appearance/structured-data/sd-policies"
    accessed: 2026-09-06
  - title: "Google Search Central — Search updates（FAQリッチリザルトの提供終了に関する告知）"
    url: "https://developers.google.com/search/updates#removing-faq-rich-result"
    accessed: 2026-09-06
  - title: "Schema.org — Organization"
    url: "https://schema.org/Organization"
    accessed: 2026-09-06
  - title: "Schema.org — Person"
    url: "https://schema.org/Person"
    accessed: 2026-09-06
  - title: "Google Search Central — AI features and your website"
    url: "https://developers.google.com/search/docs/appearance/ai-features"
    accessed: 2026-09-06
faq_items:
  - question: "構造化データを入れれば検索順位は上がりますか？"
    answer: "上がりません。構造化データは内容の理解を助ける伝達手段であり、Googleはリッチリザルトの表示すら保証していません。評価の中心はあくまで可視コンテンツの品質と実績です。"
  - question: "E-E-A-Tはどのプロパティで表現しますか？"
    answer: "組織はOrganizationのlegalName・sameAs・knowsAbout、著者はPersonのjobTitle・knowsAbout・sameAs、記事はauthor・publisher・datePublished・dateModifiedで根拠を記述します。"
  - question: "FAQPageはどんなページに付けてよいですか？"
    answer: "ページに実際に表示している質問と回答だけに付けます。非表示のQ&Aへの付与はGoogleのガイドライン違反であり、現在はFAQリッチリザルトの表示自体も一般サイトでは期待できません。"
  - question: "@idはなぜ必要ですか？"
    answer: "組織や著者を1つのエンティティとして全ページから参照するためです。ページごとに別々のOrganizationを書き直すと、同一主体としての名寄せの手がかりが分散します。"
---

前提は「可視コンテンツとの一致」であり、マークアップ単独で順位やAI回答での引用が決まることはありません。E-E-A-T（経験・専門性・権威性・信頼性）は検索品質評価の考え方であって、直接のランキング要素でもありません。それでも、「誰が」「どの組織として」「いつ」「何を根拠に」発信しているかを構造化データでも示すことで、クローラーが著者と組織を誤認・混同するリスクを減らせます。株式会社Trillion Bank（トリリオンバンク）の自社サイトも、この方針で全ページから同一エンティティを参照する設計を採用しています。

## E-E-A-T要素とschema.orgの対応表

| E-E-A-T要素 | 主なタイプ | 主なプロパティ | 記述する内容 |
|---|---|---|---|
| 経験（Experience） | Article / ProfilePage | author、dateModified | 誰が実務で書いたか。著者ページをProfilePageとして宣言 |
| 専門性（Expertise） | Person | jobTitle、knowsAbout、sameAs | 著者の肩書、専門領域、外部プロフィールへの参照 |
| 権威性（Authoritativeness） | Organization | legalName、sameAs、knowsAbout | 登記上の正式社名、公式SNS・外部データベースへの参照、事業領域 |
| 信頼性（Trust） | Article / BreadcrumbList / FAQPage | publisher、datePublished、dateModified | 発行組織、公開日・更新日、サイト内での位置 |

schema.orgの定義では、knowsAboutは「知っている話題を示すが、専門性を保証するものではない」とされています。プロパティを書くこと自体が評価になるのではなく、可視コンテンツにある根拠を機械可読な形式へ変換する位置づけです。

## @idで同一エンティティを全ページから参照する

組織と代表者のノードにサイト内で一意の`@id`を与え、各記事からは`@id`で参照します。

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://trillion-bank.jp/#organization",
      "name": "Trillion Bank",
      "legalName": "株式会社Trillion Bank"
    },
    {
      "@type": "Article",
      "author": { "@id": "https://trillion-bank.jp/ceo/#person" },
      "publisher": { "@id": "https://trillion-bank.jp/#organization" }
    }
  ]
}
```

`@id`は`#organization`のようなURL断片で固定し、サイト改修後も変えないことが重要です。ページごとに内容の違うOrganizationを書き直すと、同一主体としての名寄せの手がかりが分散します。

## 可視コンテンツと一致させる原則

Googleの構造化データポリシーは、読者に見えないコンテンツをマークアップしないことを明示しています（"Don't mark up content that is not visible to readers of the page" — Google Search Central）。JSON-LDに書いた著者名・組織名・日付は、ページ本文にも同じ内容が表示されている必要があります。情報として正確であっても、画面に表示していない内容を構造化データだけに入れる実装はガイドライン違反です。

## FAQPageとBreadcrumbListの扱い

FAQPageは、ページに実際に表示している質問と回答のみに付けます。Googleは2023年にFAQリッチリザルトの表示を著名な政府・医療系サイトへ限定し、その後は検索結果での表示終了をドキュメントで案内しています。したがってFAQPageは「表示枠の獲得」ではなく、Q&Aの構造を機械可読にしておく目的で維持するのが現実的です。

BreadcrumbListは、記事がサイト内のどの階層に属するかを示します。こちらも画面に表示しているパンくずと一致させます。

## 検証手順

| ツール | URL | 確認できること |
|---|---|---|
| リッチリザルト テスト | search.google.com/test/rich-results | Google対応機能への適格性、必須プロパティの不足 |
| Schema Markup Validator | validator.schema.org | schema.org語彙としての構文・型の妥当性 |

リッチリザルトテストはGoogleが対応する機能だけを判定するため、OrganizationやPerson単体のマークアップはSchema Markup Validatorで確認します。公開後はSearch Consoleのレポートでエラーの推移を監視します。

## やってはいけない実装

- **非表示FAQ**：画面に出していないQ&AへのFAQPage付与。可視コンテンツ一致の原則に反します
- **架空・自作自演のレビュー**：実在しない評価の記述は、ユーザーを欺くマークアップとして禁止されています
- **キーワード詰め込み**：knowsAboutやaboutへ関連性の薄い語を大量に列挙しても、専門性の裏付けにはなりません
- **他者への偽装**：別組織・別人物になりすます記述は明確なポリシー違反です

## 実務チェックリスト

1. Organizationノードに`legalName`・`sameAs`・`knowsAbout`を設定し、`@id`を固定する
2. Personノードに`jobTitle`・`knowsAbout`・`sameAs`を設定し、著者ページをProfilePageとして宣言する
3. 記事に`author`・`publisher`・`datePublished`・`dateModified`を`@id`参照で記述する
4. JSON-LDの内容とページの可視コンテンツが一致しているか照合する
5. FAQPageは表示中のQ&Aに限定する
6. リッチリザルトテストとSchema Markup Validatorの両方で検証する
7. 記事更新時は`dateModified`と本文の更新箇所を同時に変更する
8. 変更履歴を残し、検証結果とあわせて定期的に再点検する

## できないこと・限界

構造化データは「伝達」を改善する手段であり、評価そのものを作る手段ではありません。

- Googleは、構造化データを正しく実装してもリッチリザルトの表示は保証されないと明言しています
- E-E-A-Tはコンテンツと実績の問題であり、マークアップだけで専門性や権威性が生まれることはありません
- AI機能についてもGoogleは、AI Overviews等に表示されるための特別なファイルや特別な構造化データは不要で、通常の検索と同じ基本対策が適用されると説明しています
- したがって、構造化データの整備がAI検索での引用や掲載順位、売上や問い合わせの増加をもたらすことを保証するものではありません

当社では、構造化データ整備の前後で「どの質問で、どのURLが引用されたか」をAirReach Consulting（限定商用検証・導入相談受付中）で記録し、施策と観測結果を分けて評価しています。変化が観測されても、モデル更新や外部情報など施策以外の要因を除外できない前提で判断します。
