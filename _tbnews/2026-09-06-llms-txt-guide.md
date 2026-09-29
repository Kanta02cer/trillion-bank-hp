---
layout: tb-article-authority
insight: true
toc: true
direct_answer: "llms.txtとは、サイトのルート直下に置くMarkdown形式のテキストファイルで、サイトの要点と主要ページへのリンクをAI（LLM）へ簡潔に伝えるための提案仕様です。標準規格ではなく、設置してもAIによる読み込み・引用・学習は保証されません。"
title: "llms.txtとは？書き方・設置方法・効果と限界【実装例つき】"
date: 2026-09-06
last_modified: 2026-09-06
category: 技術
author: 井上 幹太
tbdesc: "llms.txtはサイトのルート直下に置くMarkdown形式の案内ファイルの提案仕様です。書き方、llms-full.txtとの違い、設置・検証方法、robots.txtとの役割の差、採用状況の現実と限界を、自社実装の経験を交えて解説します。"
keywords: "llms.txt とは,llms.txt 書き方,llms.txt 設置方法,llms-full.txt 違い,robots.txt 違い,AI検索 最適化"
ai_summary: "llms.txtはllmstxt.orgが提案するMarkdown形式のAI向け案内ファイルで、ルート直下に設置する。標準規格ではなく採用は限定的で、Googleは特別なAI用ファイルは不要と明言している。設置してもAIによる引用や学習は保証されない。"
og_image: /images/hero/tb-logo-color.webp
references:
  - title: "The /llms.txt file — llmstxt.org"
    url: "https://llmstxt.org/"
    accessed: 2026-09-06
  - title: "Google Search Central — AI features and your website"
    url: "https://developers.google.com/search/docs/appearance/ai-features"
    accessed: 2026-09-06
  - title: "Google Search Central — Introduction to robots.txt"
    url: "https://developers.google.com/search/docs/crawling-indexing/robots/intro"
    accessed: 2026-09-06
  - title: "RFC 9309 — Robots Exclusion Protocol"
    url: "https://www.rfc-editor.org/rfc/rfc9309"
    accessed: 2026-09-06
faq_items:
  - question: "llms.txtとは何ですか？"
    answer: "llmstxt.orgが提案する、サイトのルート直下に置くMarkdown形式のテキストファイルです。AIにサイトの要点と主要ページへのリンクを簡潔に伝える案内役で、標準規格ではなく提案仕様です。"
  - question: "llms.txtを設置すればAIに引用されますか？"
    answer: "保証されません。主要AIサービスが参照する確約はなく、GoogleはAI OverviewsやAI Modeに特別なAI用ファイルやマークアップは不要と明言しています。実験的な補助手段として扱うべきです。"
  - question: "llms.txtとllms-full.txtの違いは何ですか？"
    answer: "llms.txtは要約とリンクの目次型インデックス、llms-full.txtは本文まで1ファイルへまとめる運用です。後者はコミュニティ慣行で、llmstxt.orgの提案本文には規定がありません。"
  - question: "robots.txtとllms.txtは何が違いますか？"
    answer: "robots.txtはRFC 9309で標準化されたクローラーのアクセス制御ファイルで、主要クローラーが尊重します。llms.txtは情報を案内する非標準の提案で、読むかどうかはAI側の任意です。"
---

## llms.txtの定義と位置づけ

llms.txtは、llmstxt.org（Jeremy Howard氏、2024年9月提案）が公開している提案仕様です。LLMのコンテキストウィンドウはサイト全体を読み込むには小さく、HTMLにはナビゲーションや広告などのノイズが多いという前提に立ち、「小さな目次ファイルに要点とリンクをまとめ、詳細はリンク先で必要なときだけ取得させる」という設計を取ります。

重要なのは、これがIETFやW3Cのような標準化団体を経た規格ではなく、コミュニティ提案である点です。仕様は現在も更新されており、正式な標準にはなっていません。

## llms.txt と llms-full.txt の違い

| 項目 | llms.txt | llms-full.txt |
|---|---|---|
| 役割 | 要約とリンクの目次（インデックス） | 主要コンテンツの本文まで1ファイルに集約 |
| サイズ | 小さく保つことが前提 | 大きくなりやすい |
| 根拠 | llmstxt.orgの提案本文に規定 | コミュニティ慣行（提案本文に規定なし） |

llmstxt.orgの提案本文（2026年更新版）が定義しているのはllms.txtのみで、詳細情報は「各ページのMarkdown版へのリンク」で提供する設計です。llms-full.txtは、ドキュメントサイトなどで広がった運用上の派生であり、必須ではありません。

## 書き方（Markdown構造）

提案仕様で必須なのはH1見出しだけで、推奨構造は次の順序です。

1. `# サイト名`（H1・必須）
2. `> 要約`（blockquote・サイトの1〜2文の説明）
3. 補足の段落や箇条書き（任意）
4. `## セクション名` ごとの、`[タイトル](URL): 補足` 形式のリンクリスト

最小の例は次のとおりです。

```markdown
# 株式会社Example
> 何をしている会社かを1〜2文で説明する。

## 主要ページ
- [サービス概要](https://example.com/service/): 提供範囲と制約
- [料金と契約条件](https://example.com/terms/): 契約前に確認する条件

## 会社情報
- [会社概要](https://example.com/company/): 所在地・代表者
```

記載すべき項目は、会社・サイトの正式名称、事業の一文説明、主要ページ（サービス、会社情報、問い合わせ、ポリシー類）、更新日です。誇張表現や宣伝文は避け、リンク先のHTMLと矛盾しない事実だけを書きます。

## 設置方法

- ルート直下（`https://example.com/llms.txt`）に配置します。ドキュメント配下など、サブパス（`/docs/llms.txt`）での設置も提案上は認められています
- 文字コードはUTF-8、配信はテキストとして行います
- robots.txtで`/llms.txt`自体をブロックしないよう確認します

## 検証方法

設置後は、次の手順で状態を確認します。

1. ブラウザまたは`curl -I`でHTTP 200が返ることを確認する
2. Markdownとして開き、H1・blockquote・リンクリストの構造を確認する
3. 記載した全リンクが200を返し、リダイレクトや404がないか確認する
4. 記載内容が公開ページの記述と一致しているか照合する
5. サーバーログでAI系ユーザーエージェントによる`/llms.txt`への実アクセスの有無を観測する

## 対応状況の現実

採用状況は限定的です。一部のAI関連企業や開発者向けドキュメントサイトが自らllms.txtを公開していますが、主要なAI検索・AIアシスタントが回答生成時にllms.txtを優先参照すると公式に確約した例は確認できていません。

Googleは公式ドキュメントで、AI OverviewsやAI Modeに表示されるために追加の要件はなく、新しい機械可読ファイル・AI用テキストファイル・特別なマークアップを作る必要はないと明言しています。少なくともGoogle検索のAI機能に関しては、llms.txtは要件ではありません。

## robots.txtとの役割の違い

| 項目 | robots.txt | llms.txt |
|---|---|---|
| 目的 | クローラーのアクセス制御（拒否・許可） | AIへの情報案内（要点とリンクの提示） |
| 規格 | RFC 9309（IETF提案標準・2022年） | llmstxt.orgの提案（非標準） |
| 設置場所 | ルート直下が必須 | ルート直下が基本（サブパスも可） |
| 形式 | 独自の指示書式（User-agent, Disallow等） | Markdown |
| 拘束力 | 主要クローラーが尊重（アクセス制限の手段。非公開化の保証ではない） | 参照するかどうかはAI側の任意 |

robots.txtが「入ってよい場所を制限する」ファイルであるのに対し、llms.txtは「読んでほしい情報を差し出す」ファイルです。方向が逆であり、どちらか一方で代替はできません。

## 当社サイトでの実装

株式会社Trillion Bank（トリリオンバンク）では、trillion-bank.jp/llms.txt をH1・blockquote・H2リンクリストの構造で公開し、掲載対象を承認済みの公開ページに限定しています。ファイル末尾には、これが実験的な索引であり、ランキング指示や掲載の保証ではないこと、正本はHTMLページであることを明記しています。llms-full.txtには、製品の検証済み範囲だけでなく「できないこと」も併記しています。

設置前後のAI回答の変化は、AirReach Consulting（限定商用検証・導入相談受付）で質問単位に回答本文と引用URLを記録して観測していますが、現時点でllms.txt単独の効果を裏づける結果は得ておらず、効果の断定はしていません。

## 実務チェックリスト

1. ルート直下に`/llms.txt`をUTF-8で設置した
2. H1・blockquote・H2リンクリストの構造になっている
3. 記載内容が公開ページの事実と一致している
4. 全リンクがHTTP 200を返す
5. robots.txtが`/llms.txt`をブロックしていない
6. 更新日を記載し、サイト改修時に更新する担当を決めた
7. サーバーログでAIクローラーのアクセスを観測している
8. 効果を保証しない前提で、観測結果を記録している

## できないこと・限界

- 設置しても、AIがファイルを読むこと、回答で引用すること、学習に使うことは保証されません
- Googleは検索のAI機能について特別なAI用ファイルは不要と明言しており、Google対策としての効果は期待できません
- どのAIがいつ参照したかを外部から完全に検証する手段はありません
- HTMLとllms.txtの二重管理になるため、更新が止まると古い情報をAIへ案内し続けるリスクがあります

llms.txtは、AI検索での掲載・引用・流入や売上を保証するものではありません。低コストで試せる実験的な補助手段と位置づけ、正確な一次情報の整備と観測を優先することを推奨します。
