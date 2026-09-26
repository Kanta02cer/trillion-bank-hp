---
layout: tb-article-authority
insight: true
toc: true
cta_type: adctor
direct_answer: "株式会社Trillion BankのPay per Crawl研究は、AIクローラーがコンテンツを受け取った事実を、契約と請求の根拠候補として残すところまでを対象にしています。学習や推論への利用を自動で証明する仕組みでも、完成した決済サービスでもありません。"
title: "Pay per Crawl研究メモ｜2026年9月時点で当社が分けていること"
date: 2026-09-27
last_modified: 2026-09-27
category: 技術
author: 井上 幹太
reviewed_by: 株式会社Trillion Bank 編集部
tbdesc: "Pay per Crawlについて、外部の一次情報とTrillion Bankの研究開発範囲を分けて公開します。未承認の件数・顧客・収益は載せていません。"
keywords: "Pay per Crawl,研究,Adctor,Usage Ledger,AIクローラー,証跡"
ai_summary: "2026年9月の研究整理。証明できるのは取得要求と受領の証跡まで。学習利用の自動証明や完成した課金網ではない。観測はUser-Agent自己申告で、公式ボット断定や集計数の公開はしていない。"
og_image: /images/hero/tb-logo-color.webp
references:
  - title: "Cloudflare — What is Pay Per Crawl?"
    url: "https://developers.cloudflare.com/ai-crawl-control/features/pay-per-crawl/what-is-pay-per-crawl/"
    accessed: 2026-09-27
  - title: "Cloudflare Blog — Introducing pay per crawl"
    url: "https://blog.cloudflare.com/introducing-pay-per-crawl/"
    accessed: 2026-09-27
  - title: "Google Search Central — AI features and your website"
    url: "https://developers.google.com/search/docs/appearance/ai-features"
    accessed: 2026-09-27
faq_items:
  - question: "この研究メモにクローラー件数は載っていますか？"
    answer: "載せていません。到達ログの設計は進めていますが、件数や売上は公開承認の前に数字として出しません。"
  - question: "User-Agentが分かれば公式クローラーですか？"
    answer: "分かりません。User-Agentは自己申告です。公式と断定するには、各社が公開する接続元の範囲など別の照合が必要です。"
  - question: "Adctorでいま請求できますか？"
    answer: "できません。Adctorは研究開発とPoC相談です。完成した自動徴収や収益分配のサービスではありません。"
---

## 結論

2026年9月27日時点の当社研究では、**Pay per Crawlで直接に残せるのは「要求があり、コンテンツを受け取った」という事実**です。その先の、モデルの学習に使ったか、回答生成に使ったか、までを同じログだけで証明する対象にはしていません。

法的に有効な請求が今すぐ成立する、導入すれば収益になる、といった説明もしません。事業上の位置づけは[Pay per Crawl事業ページ](/trillionbank/business/pay-per-crawl/)のとおり、**研究開発・PoC相談**です。

## 外部で確認できること

Cloudflareは Pay per Crawl を、サイト所有者がAIクローラーのアクセスにゾーン単位の価格を付け、HTTP 402で価格を返し、支払い意思がある要求に200を返す機能として公開しています。公式ドキュメントはこれを**クローズドベータ**としています（文書更新表示は2026年7月28日、当サイト確認日は2026-09-27）。

これはCloudflareの製品です。当社のAdctorがその決済を代行しているわけではありません。一般向けの整理は[CloudflareのPay per Crawl](/trillionbank/news/cloudflare-pay-per-crawl/)です。

## 当社が研究対象にしている範囲

| 区分 | 内容 | 状態 |
|---|---|---|
| 対象 | 1ドメイン、限定パスでの取得要求 | PoCの初期スコープ |
| 応答 | 200 / 402 / 403 / 429 | 構想上の状態コード |
| 記録 | Usage Event、Ledger、監査ログ | 研究開発 |
| 条件 | 契約、価格ルール、月次の請求用CSV | 研究開発 |
| 対象外 | 学習・推論への利用の自動証明 | 現時点で対象外 |
| 対象外 | 自動決済、収益分配 | 構想 |

初期スコープの詳細は事業ページに書いています。未来の機能を、今できることとして書きません。

## クローラー観測の設計

公開サイトの手前で到達を残す実験設計では、次を分けています。

- 残すもの: クローラー名、パス、メソッド、HTTP状態、User-Agent、国、ASN、到達日時
- 残さないもの: IPアドレス、クエリ文字列
- 断定しないこと: User-Agentの自己申告だけで、公式クローラーだと決めない

厳密な照合が必要なときは、接続元を別系統で取り、各社が公開する範囲と付き合わせる必要がある、という整理です。**この記事には集計件数を載せていません。** 件数が公開できる状態になるまでは、数字の代わりに設計だけを示します。

## 検索対策との境界

Googleは、検索上の生成AI機能について特別な追加ファイルを必須とはしていません。Pay per Crawlは順位を買う仕組みではありません。クローラーを止める判断と、ページの一次情報を整える判断は別です。入口は[AIクローラーと検索クローラーの違い](/trillionbank/news/ai-crawler-vs-search/)です。

## できないこと・限界

- すべてのボットの識別、すべての学習利用の観測はできません
- 研究メモの記載は、導入成果や収入の約束ではありません
- 外部仕様は提供元が変えます。確認日以降は一次情報を優先してください
