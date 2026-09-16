---
layout: tb-article-authority
insight: true
toc: true
direct_answer: "JSON-LDのFAQは、可視の質問回答と一致させることが前提です。AI検索での引用を保証するものではなく、理解補助と検索機能向けの構造化として使います。"
title: "JSON-LDのFAQとAI検索｜効果と正しい使い方"
date: 2026-09-16
last_modified: 2026-09-16
category: 解説
author: 井上 幹太
reviewed_by: 井上 幹太
review_date: 2026-09-16
tbdesc: "JSON-LD FAQの正しい使い方。"
keywords: "JSON-LD FAQ AI検索,FAQ JSON-LD,構造化データ FAQ"
ai_summary: "可視一致が必須。非表示FAQは禁止。"
og_image: /images/hero/tb-logo-color.webp
references:
  - title: "Schema.org — FAQPage"
    url: "https://schema.org/FAQPage"
    accessed: 2026-09-16
  - title: "Google Search Central — AI optimization guide"
    url: "https://developers.google.com/search/docs/fundamentals/ai-optimization-guide"
    accessed: 2026-09-16
  - title: "Google Search Central — Creating helpful, reliable, people-first content"
    url: "https://developers.google.com/search/docs/fundamentals/creating-helpful-content"
    accessed: 2026-09-16
faq_items:
  - question: "非表示FAQは？"
    answer: "置かないでください。"
  - question: "何問が適切？"
    answer: "数より、実際に聞かれる質。"
  - question: "関連は？"
    answer: "[FAQPage](/trillionbank/news/faqpage-structured-data/)と[実務ガイド](/trillionbank/news/sme-faq-schema-starter/)を参照。"
---

## 結論：FAQのJSON-LDは可視FAQの写し

AI検索対策としてFAQを隠してSchemaだけ置く手法は、ポリシー上避けます。

## 正しい手順

1. ページにFAQを書く
2. 同じ内容をFAQPageで示す
3. 更新時は両方を直す

## できないこと・限界

- AI回答への掲載、推薦、流入、問い合わせ、売上を保証しません
- すべてのAIサービス・画面を完全測定できるわけではありません
- 用語（AEO / GEO / AIO / LLMO）の定義は業界で統一されていません
- 仕様やレポート項目は提供側の変更で変わる可能性があります（as of 2026-09-16）

## 次の一歩

現状確認や測定設計の相談は、[お問い合わせフォーム](/trillionbank/contact/#form)からご連絡ください。HackⅡ（限定商用検証・導入相談受付）は、選定した質問についてAI回答・引用URL・競合言及を保存し、改善優先度の整理を支援します。

関連: [FAQPage](/trillionbank/news/faqpage-structured-data/) / [JSON-LDとE-E-A-T](/trillionbank/news/json-ld-eeat-ai-search/)
