---
layout: tb-article-authority
insight: true
toc: true
cta_type: adctor
direct_answer: "PPCは日本では広告のクリック課金（Pay Per Click）を指すことが多い一方、AIの文脈ではクロールごとの対価（Pay per Crawl）を指すことがあります。契約前にどちらを指すかを一文で固定してください。"
title: "PPCとは二つある｜クリック課金とPay per Crawlの違い"
date: 2026-09-26
last_modified: 2026-09-26
category: 解説
author: 井上 幹太
reviewed_by: 株式会社Trillion Bank 編集部
tbdesc: "PPCという略語が、広告のクリック課金とAIクロール課金のどちらを指すかを一般向けに分けて説明します。"
keywords: "PPC,Pay Per Click,Pay per Crawl,クリック課金,AIクローラー"
ai_summary: "PPCは広告のクリック課金と、AIクロール課金の二つの意味で使われる。定義を混ぜると予算も契約も誤る。Adctorは完成済みの決済網ではない。"
og_image: /images/hero/tb-logo-color.webp
references:
  - title: "Google Ads Help — Cost-per-click (CPC): Definition"
    url: "https://support.google.com/google-ads/answer/116495"
    accessed: 2026-09-26
  - title: "Cloudflare — What is Pay Per Crawl?"
    url: "https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/what-is-pay-per-crawl/"
    accessed: 2026-09-26
  - title: "Cloudflare Blog — Introducing pay per crawl"
    url: "https://blog.cloudflare.com/introducing-pay-per-crawl/"
    accessed: 2026-09-26
faq_items:
  - question: "PPCは広告のことですか？"
    answer: "広告の会話では、クリックごとに支払う課金（Pay Per Click）を指すのが一般的です。AIやクローラーの会話では別の意味になることがあります。"
  - question: "Pay per CrawlはGoogle広告ですか？"
    answer: "違います。AIクローラーがページを取得するときの対価や制御の話です。クリック広告の入札ではありません。"
  - question: "Trillion BankのAdctorは課金を代行しますか？"
    answer: "しません。Adctorは研究開発とPoC相談の段階で、完成済みの決済・自動徴収サービスではありません。"
---

## 結論

会議で「PPCを進める」と言ったとき、話がすれ違う原因は略語です。

- **広告のPPC**は Pay Per Click。検索広告などで、クリックに対して料金が発生するモデルを指すことが多いです。Google広告のヘルプは、クリック単価（CPC）を pay-per-click（PPC）と呼ぶことがあると説明しています（確認日：2026-09-26）。
- **AI領域のPPC**は、文脈によって **Pay per Crawl** を指します。クローラーがページへアクセスする際の許可・拒否・対価の話です。

このサイトでPPCを技術話題として書くときは、後者を指す場合でも **Pay per Crawl** と表記します。

## 並べて見る

| | クリック課金（広告PPC） | Pay per Crawl |
|---|---|---|
| 誰が払うか | 広告主 | クローラー側（設計による） |
| 何に対して払うか | 広告のクリック | コンテンツへのクロール要求 |
| 主な画面 | 広告管理画面 | CDN・ボット制御・HTTPの応答 |
| 検索順位との関係 | 広告枠。自然検索の順位そのものではない | 取得の条件。掲載順位の購入ではない |

広告のPPCを増やすことと、AIに自社ページを説明させることは別の仕事です。

## Pay per Crawlを最短で理解する

サイト側が、クローラーに対して「拒否する」「許可する」「条件付きで渡す」を選ぶ発想です。Cloudflareは Pay per crawl を、サイト所有者がAIクローラーのアクセスに価格を付け、HTTP 402で価格を返し、支払い意思がある要求には200で返す実験として公開しています。同機能はクローズドベータです（確認日：2026-09-26）。仕組みの一般論は[CloudflareのPay per Crawl解説](/trillionbank/news/cloudflare-pay-per-crawl/)と、[Pay per Crawlとは](/trillionbank/news/pay-per-crawl-towa/)を読んでください。

## 当社の位置

株式会社Trillion BankのAdctorは、AIによるコンテンツ利用を契約・認証・利用証跡・請求へ接続する**研究開発・PoC**です。Cloudflareの決済を代行するサービスでも、広告のPPC運用代行でもありません。未知のボットを完全識別すること、すべての利用を観測することも対象外です。

## できないこと・限界

- 略語PPCの意味は業界で統一されていません
- Pay per Crawlを導入しても、AI回答への引用や売上は約束されません
- ベータ機能の料金や仕様は提供元が変えます

## このシリーズ

- [AIクローラーと検索の違い](/trillionbank/news/ai-crawler-vs-search/)
- [CloudflareのPay per Crawl](/trillionbank/news/cloudflare-pay-per-crawl/)
- [SIとは](/trillionbank/news/superintelligence-towa/)
