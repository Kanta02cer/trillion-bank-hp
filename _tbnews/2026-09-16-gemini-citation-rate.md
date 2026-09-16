---
layout: tb-article-authority
insight: true
toc: true
direct_answer: "Geminiの引用率は、選定した質問集合のうち自社URLが出典として提示された割合として定義するのが実務的です。分母・成功条件・欠損を明示してください。"
title: "Geminiの引用率とは？計算の考え方と測定時の注意"
date: 2026-09-16
last_modified: 2026-09-16
category: 解説
author: 井上 幹太
reviewed_by: 井上 幹太
review_date: 2026-09-16
tbdesc: "Gemini回答における引用率の定義例と、測定で混ぜてはいけない指標を整理します。"
keywords: "Gemini 引用率,Gemini citation,AI検索 引用率,生成AI 出典"
ai_summary: "引用率は定義を固定。言及率や推薦率と混ぜない。"
og_image: /images/hero/tb-logo-color.webp
references:
  - title: "Google Search Central — AI features and your website"
    url: "https://developers.google.com/search/docs/appearance/ai-features"
    accessed: 2026-09-16
  - title: "Google Search Central — AI optimization guide"
    url: "https://developers.google.com/search/docs/fundamentals/ai-optimization-guide"
    accessed: 2026-09-16
  - title: "GEO: Generative Engine Optimization (arXiv:2311.09735)"
    url: "https://arxiv.org/abs/2311.09735"
    accessed: 2026-09-16
faq_items:
  - question: "引用と言及の違いは？"
    answer: "言及は本文に名前が出ること、引用はURL等が出典として出ることです。"
  - question: "分母はどうしますか？"
    answer: "測定対象にした質問数を分母にし、対象外は別管理します。"
  - question: "計算の一般論は？"
    answer: "[引用率の計算](/trillionbank/news/ai-citation-rate-calculation/)を参照してください。"
---

## 結論：Geminiでも定義を先に書く

引用率は便利な指標ですが、定義が揺れると施策評価が壊れます。Geminiでも「どの画面・どの質問・何をもって引用成功か」を先に固定します。

## 定義例

- 分母：事前に決めた質問セット（例: 20問 × 反復）
- 分子：自社ドメインのURLが出典として提示された回数
- 除外：実験用プロンプト、途中で条件変更した試行

## 注意

- Googleの検索機能と、他プロダクトの回答面を混同しない
- 引用率が高くても重要質問で負けている場合がある
- Google公式はAI専用の特別マークアップを必須としていない

## できないこと・限界

- AI回答への掲載、推薦、流入、問い合わせ、売上を保証しません
- すべてのAIサービス・画面を完全測定できるわけではありません
- 用語（AEO / GEO / AIO / LLMO）の定義は業界で統一されていません
- 仕様やレポート項目は提供側の変更で変わる可能性があります（as of 2026-09-16）

## 次の一歩

現状確認や測定設計の相談は、[お問い合わせフォーム](/trillionbank/contact/#form)からご連絡ください。HackⅡ（限定商用検証・導入相談受付）は、選定した質問についてAI回答・引用URL・競合言及を保存し、改善優先度の整理を支援します。

関連: [引用率計算](/trillionbank/news/ai-citation-rate-calculation/) / [生成AI引用分析](/trillionbank/news/generative-ai-citation-analysis/)
