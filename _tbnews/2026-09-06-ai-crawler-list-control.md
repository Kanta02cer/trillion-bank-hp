---
layout: tb-article-authority
insight: true
toc: true
direct_answer: "AIクローラーの制御は、各社が公式に公表するUser-Agentトークンをrobots.txtへ用途別（学習・検索・ユーザー操作）に記述して行い、学習用のGPTBotやClaudeBotを拒否しつつ、検索引用用のOAI-SearchBotやClaude-SearchBotを許可する、という切り分けが基本です。"
title: "AIクローラー一覧と制御方法｜robots.txtでの許可・拒否の考え方"
date: 2026-09-06
last_modified: 2026-09-06
category: AI検索対策
author: 井上 幹太
tbdesc: "GPTBot・ClaudeBot・PerplexityBotなど主要AIクローラーのUser-Agentを公式ドキュメントで確認できた範囲で一覧化し、学習は拒否しつつ検索引用は許可するrobots.txt設定例と、その限界・確認方法を解説します。"
keywords: "AIクローラー 一覧,robots.txt AI 拒否,GPTBot,ClaudeBot,PerplexityBot,Google-Extended,AI学習 拒否 引用 許可,Trillion Bank"
ai_summary: "主要AIクローラーは学習用・検索用・ユーザー操作用に分かれ、robots.txtでUser-Agentトークン単位に許可・拒否を指定できる。ただしrobots.txtは強制力のない意思表示であり、未知Botやなりすましには効かないため、アクセスログでの確認を併用する。"
og_image: /images/hero/tb-logo-color.webp
references:
  - title: "OpenAI — Overview of OpenAI Crawlers"
    url: "https://developers.openai.com/api/docs/bots"
    accessed: 2026-09-06
  - title: "Anthropic Help Center — Does Anthropic crawl data from the web, and how can site owners block the crawler?"
    url: "https://support.claude.com/en/articles/8896518"
    accessed: 2026-09-06
  - title: "Perplexity Docs — Perplexity Crawlers"
    url: "https://docs.perplexity.ai/guides/bots"
    accessed: 2026-09-06
  - title: "Google Search Central — Google's common crawlers"
    url: "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers"
    accessed: 2026-09-06
  - title: "Common Crawl — CCBot"
    url: "https://commoncrawl.org/ccbot"
    accessed: 2026-09-06
  - title: "Meta for Developers — Meta Web Crawlers"
    url: "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/"
    accessed: 2026-09-06
  - title: "Amazon — Amazonbot"
    url: "https://developer.amazon.com/amazonbot"
    accessed: 2026-09-06
faq_items:
  - question: "robots.txtでAIの学習だけを拒否し、検索引用は許可できますか？"
    answer: "できます。学習用途のGPTBot、ClaudeBot、Google-Extended、meta-externalagentなどをDisallowにし、検索用途のOAI-SearchBot、Claude-SearchBot、PerplexityBotを許可すれば、用途別の意思表示になります。"
  - question: "robots.txtで拒否すればAIには一切使われませんか？"
    answer: "いいえ。robots.txtは技術的な強制力のない意思表示で、準拠を公表していないBotやUser-Agentのなりすましには効きません。過去に取得済みのデータが削除されるとも限りません。"
  - question: "ChatGPT-UserやPerplexity-Userも拒否できますか？"
    answer: "両社とも、ユーザー操作起点のアクセスにはrobots.txtが適用されない場合があると公表しています。確実に止めたい場合はWAFやレート制限などサーバー側の制御を検討します。"
  - question: "どのAIクローラーが来ているかを確認する方法はありますか？"
    answer: "WebサーバーのアクセスログをGPTBotやClaudeBotなどのUser-Agent文字列で集計し、来訪頻度と対象URLを確認します。UAは自己申告のため、なりすましの可能性も考慮します。"
---

ただし、robots.txtは強制力のない意思表示であり、設定してもAI検索での引用や表示、流入を保証するものではありません。本記事は各社公式ドキュメントで確認できた範囲のみを記載します。

## 主要AIクローラーのUser-Agent一覧

| User-Agent | 運営元 | 主な用途 | robots.txt準拠の公表 |
|---|---|---|---|
| GPTBot | OpenAI | 生成AI基盤モデルの学習 | 準拠を公表 |
| OAI-SearchBot | OpenAI | ChatGPT検索での表示・リンク | 準拠を公表 |
| ChatGPT-User | OpenAI | ユーザー操作起点のアクセス | 適用されない場合があると公表 |
| ClaudeBot | Anthropic | モデルの学習・開発 | 準拠を公表 |
| Claude-User | Anthropic | ユーザー起点のWebアクセス | 準拠を公表 |
| Claude-SearchBot | Anthropic | 検索結果の品質向上 | 準拠を公表 |
| PerplexityBot | Perplexity | 検索結果での表示・リンク（基盤モデル学習には不使用と公表） | 準拠を公表 |
| Perplexity-User | Perplexity | ユーザー操作起点のアクセス | 原則適用されないと公表 |
| Google-Extended | Google | Geminiの学習・グラウンディング利用の制御（独自UAなしの制御用トークン） | 準拠を公表 |
| GoogleOther | Google | 各製品チームによる汎用クロール | 準拠を公表 |
| CCBot | Common Crawl | 公開クロールデータの収集・提供 | 準拠を公表 |
| Amazonbot | Amazon | サービス改善（AIモデル学習に利用される場合あり） | 準拠を公表 |
| meta-externalagent | Meta | AIモデルの学習・製品のインデックス作成 | 準拠を公表 |
| meta-externalfetcher | Meta | ユーザー要求起点の取得 | 適用されない場合があると公表 |

Amazonbotの用途・準拠状況はAmazonの公式ページ（developer.amazon.com/amazonbot）で確認できます。Bytespider等、運営元の公式ドキュメントを確認できなかったUser-Agentは本表に掲載していません。

## 「学習は拒否、検索引用は許可」の設定例

```
# 生成AIの学習用クローラーを拒否
User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: meta-externalagent
Disallow: /

# 検索・引用用クローラーは許可
User-agent: OAI-SearchBot
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /
```

注意点は2つあります。第一に、Google-Extendedは独自のUser-Agent文字列を持たず、既存のGoogleのUAでクロールした内容の利用可否を制御するトークンです。アクセスログには現れません。第二に、OpenAIはOAI-SearchBotを拒否したサイトはChatGPT検索の回答に表示されなくなると明記しており、検索用トークンの拒否は引用機会の放棄を意味します。

## 拒否と引用機会のトレードオフ

学習用と検索用のトークンが分かれているため、「モデルの学習には使わせないが、検索経由の引用・リンクは受け入れる」という方針は設定として表現できます。一方で、次のトレードオフを理解しておく必要があります。

- 学習を拒否すると、将来のモデルが自社の情報を内部知識として持たない可能性があり、検索を伴わないAI回答での説明に影響しうる
- CCBotの拒否は、Common Crawlの公開データセットを利用する多数の研究・開発主体への意思表示となり、影響範囲を個別に予測しにくい
- 許可・拒否のどちらを選んでも、AI回答での引用や表示が約束されるわけではない

どの経路を許可するかは、コンテンツの性質（無料公開の集客記事か、有料・会員向け資産か）ごとに分けて判断するのが実務的です。

## robots.txtのできないこと・限界

- **強制力がない**：robots.txtは慣行に基づく意思表示であり、準拠は各運営元の自主的な運用に依存する
- **未知のBotに効かない**：公表されていないUAや新規のBotは、トークンを書きようがない
- **なりすましを防げない**：UA文字列は自己申告のため、第三者がGPTBot等を名乗るアクセスは排除できない
- **遡及しない**：過去に取得済みのデータやアーカイブが削除されるとは限らない
- **ユーザー操作型に適用されない場合がある**：ChatGPT-User、Perplexity-User、meta-externalfetcherは適用外となる場合があると各社が公表している

確実な遮断が必要な場合は、WAF、認証、レート制限などサーバー側の制御を併用します。

## アクセスログでの確認方法（概要）

robots.txtの設定が実際にどう働いているかは、自社のアクセスログで確認できます。手順の概要は次の通りです。

1. アクセスログからGPTBot、ClaudeBot等のUA文字列を含む行を抽出する
2. 期間別・パス別・ステータスコード別に件数を集計し、来訪頻度と対象コンテンツを把握する
3. robots.txt変更日を記録し、変更前後で各Botのアクセスが変化したかを比較する
4. UAは自己申告のため、運営元が確認手段を公開している場合はIP等で照合する

## 実務チェックリスト

1. 現状のアクセスログで、AI系UAの来訪有無・頻度・対象パスを確認した
2. 学習・検索・ユーザー操作の3用途に分けて、許可・拒否の方針を決めた
3. robots.txtへ用途別のUser-agentグループを記述し、文法を検証した
4. 検索用トークンを拒否した場合の引用機会への影響を関係者へ共有した
5. 変更日を記録し、変更前後のログで各Botの挙動変化を確認した
6. 準拠しないBotへの対応（WAF・レート制限等）をサーバー側で別途検討した
7. 各社の公式ドキュメントを定期的に再確認する体制を決めた（UAと用途は追加・変更される）

なお、Googleは自社のAI機能への表示にあたり、新しい機械可読ファイルやAI用テキストファイルを作成する必要はないと公表しています（developers.google.com/search/docs/appearance/ai-features）。llms.txtのような試みは、AIによる利用や引用を約束するものではなく、現時点では効果が確立していない実験的な補助手段として扱うのが妥当です。

株式会社Trillion Bank（トリリオンバンク）は、限定商用検証・導入相談受付中のAirReach Consultingで、選定した質問に対するAI回答本文と引用URLの保存・比較を支援しています。robots.txt変更の前後で同一質問を再測定すれば、引用状況の変化を証跡付きで確認できます。ただし、測定はAI検索での引用や流入を保証するものではありません。
