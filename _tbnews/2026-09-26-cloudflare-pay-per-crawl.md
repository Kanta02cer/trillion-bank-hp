---
layout: tb-article-authority
insight: true
toc: true
cta_type: adctor
direct_answer: "CloudflareのPay per Crawlは、サイト所有者がAIクローラーのアクセスにゾーン単位の価格を付け、HTTP 402と価格ヘッダーで応答する仕組みです。2026年9月時点の公式文書ではクローズドベータです。"
title: "CloudflareのPay per Crawlとは？広告のPPCと違う点"
date: 2026-09-26
last_modified: 2026-09-26
category: 技術
author: 井上 幹太
reviewed_by: 株式会社Trillion Bank 編集部
tbdesc: "Cloudflareが公開しているPay per Crawlを、サイト所有者とクローラー側の動きに分けて一般向けに説明します。完成済みの業界標準ではありません。"
keywords: "Pay per Crawl,Cloudflare,PPC,HTTP 402,AIクローラー,AI Crawl Control"
ai_summary: "Cloudflare Pay per Crawlはクローズドベータ。402で価格を返し、支払い意思があるクロールに200を返す。広告PPCとは別。Adctorは別の研究開発。"
og_image: /images/hero/tb-logo-color.webp
references:
  - title: "Cloudflare — What is Pay Per Crawl?"
    url: "https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/what-is-pay-per-crawl/"
    accessed: 2026-09-26
  - title: "Cloudflare Blog — Introducing pay per crawl"
    url: "https://blog.cloudflare.com/introducing-pay-per-crawl/"
    accessed: 2026-09-26
  - title: "Cloudflare — Crawl pages (AI owner)"
    url: "https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/use-pay-per-crawl-as-ai-owner/crawl-pages/"
    accessed: 2026-09-26
faq_items:
  - question: "Pay per Crawlはすでに誰でも使えますか？"
    answer: "Cloudflare公式はクローズドベータと案内しています。申込やエンタープライズ担当経由の参加が前提です。"
  - question: "402とは何ですか？"
    answer: "Payment RequiredというHTTPステータスです。Pay per Crawlでは、価格を知らせてアクセスをいったん止める応答として使われます。"
  - question: "うちの会社は今日から課金できますか？"
    answer: "Cloudflareの機能に参加できるかは同社の条件次第です。Trillion BankのAdctorは、その決済を代わりに完成させているサービスではありません。"
---

## 結論

**Pay per Crawl**は、AIクローラーがページを取りに来るときに、サイト側が対価や条件を付けられるようにする取り組みの総称です。Cloudflareは自社製品として同名の機能を公開しており、公式ドキュメントはこれを **AI Crawl Control の機能**で、**クローズドベータ**だと書いています（文書の更新表示は2026年7月28日、当サイトの確認日は2026-09-26）。

広告のクリック課金（PPC）ではありません。略語の混同は[PPCの二つの意味](/trillionbank/news/ppc-two-meanings/)を見てください。

## サイト側とクローラー側

公式の説明を業務の言葉にすると、次の往復です。

1. クローラーがページを要求する
2. 有料ゾーンなら、サーバーは **HTTP 402** と価格ヘッダー（`crawler-price`）を返すことがある
3. クローラーは、ちょうどその価格（`crawler-exact-price`）か、上限価格（`crawler-max-price`）を示して再要求できる
4. 条件が合うと **HTTP 200** と、請求額を示すヘッダーが返る
5. Cloudflareはマーチャントオブレコードとして課金と分配の基盤になると説明している

WAFやボット管理で拒否したクローラーは、課金対象より拒否が優先される、とも案内されています。

## 企業が確認するチェック

- 参加ステータスはベータのままか
- 価格はサイト全体か、一部URLだけ無料にする規則があるか
- ブロック規則と課金規則のどちらが勝つか
- 対応するのは署名されたボットか
- 自社が売りたいのは「広告クリック」か「コンテンツ取得」か

仕様の細部は変わるため、実装時はCloudflareの現行ドキュメントを正とします。この記事は操作手順の完全な写しではありません。

## Trillion Bankとの関係

当社はPay per Crawlという概念と、契約・認証・利用証跡を研究しています。Adctorの公開上の状態は**研究開発・PoC相談**です。Cloudflareのベータそのものではなく、自動徴収が完成した決済網でもありません。概念の入口は[Pay per Crawlとは](/trillionbank/news/pay-per-crawl-towa/)、利用単位との違いは[Pay per CrawlとPay per Useの違い](/trillionbank/news/pay-per-crawl-pay-per-use-difference/)です。

## できないこと・限界

- ベータ参加、収入、引用数を約束しません
- HTTPヘッダー名や価格モデルは提供元が更新します
- 未知ボットの完全な識別は対象外です

## このシリーズ

- [PPCの二つの意味](/trillionbank/news/ppc-two-meanings/)
- [AIクローラーと検索の違い](/trillionbank/news/ai-crawler-vs-search/)
- [SIとは](/trillionbank/news/superintelligence-towa/)
