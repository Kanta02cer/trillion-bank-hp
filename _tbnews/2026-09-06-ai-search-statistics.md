---
layout: tb-article-authority
insight: true
toc: true
direct_answer: "AI検索の統計は、時点・調査規模・手法とセットで読んで初めて意味を持ちます。"
title: "AI検索の統計データまとめ【2026年版】出典・調査規模・時点つき"
date: 2026-09-06
last_modified: 2026-09-06
category: 調査レポート
author: 井上 幹太
tbdesc: "GEO論文の施策別効果、AhrefsのAI検索流入とCVデータ、Wikipedia・Reddit・YouTubeなど引用元の偏り、AIクローラーの技術統計まで、一次調査のみを出典・調査規模・時点つきで整理した2026年版の統計ハブです。"
keywords: "AI検索 統計,AI検索 データ,GEO 論文 効果,AI引用 統計,AIクローラー 統計,LLM 引用元 調査"
ai_summary: "AI検索に関する一次調査の統計を2026年時点で整理。GEO論文は引用文挿入で約43%の可視性改善、キーワード詰め込みは約9%の低下を報告。AhrefsではAI検索流入0.5%がサインアップの12.1%を生成。引用元はWikipedia・Bing上位・earned mediaへ偏るが、数値は調査時点で大きく変動する。"
og_image: /images/hero/tb-logo-color.webp
references:
  - title: "GEO: Generative Engine Optimization（arXiv:2311.09735、KDD 2024）"
    url: "https://arxiv.org/abs/2311.09735"
    accessed: 2026-09-06
  - title: "Ahrefs — AI Search Traffic & Conversions"
    url: "https://ahrefs.com/blog/ai-search-traffic-conversions-ahrefs/"
    accessed: 2026-09-06
  - title: "Ahrefs — llms.txt Study"
    url: "https://ahrefs.com/blog/llmstxt-study/"
    accessed: 2026-09-06
  - title: "Ahrefs — Do AI Assistants Prefer to Cite Fresh Content?"
    url: "https://ahrefs.com/blog/do-ai-assistants-prefer-to-cite-fresh-content/"
    accessed: 2026-09-06
  - title: "Ahrefs — Search Rankings and AI Citations"
    url: "https://ahrefs.com/blog/search-rankings-ai-citations/"
    accessed: 2026-09-06
  - title: "Ahrefs — AI Overview Citations and Top 10 Rankings"
    url: "https://ahrefs.com/blog/ai-overview-citations-top-10"
    accessed: 2026-09-06
  - title: "Seer Interactive — 87% of SearchGPT Citations Match Bing's Top Results"
    url: "https://www.seerinteractive.com/insights/87-percent-of-searchgpt-citations-match-bings-top-results"
    accessed: 2026-09-06
  - title: "Seer Interactive — What Drives Brand Mentions in AI Answers?"
    url: "https://www.seerinteractive.com/insights/what-drives-brand-mentions-in-ai-answers"
    accessed: 2026-09-06
  - title: "Profound — AI Platform Citation Patterns"
    url: "https://tryprofound.com/blog/ai-platform-citation-patterns"
    accessed: 2026-09-06
  - title: "Semrush — Most Cited Domains in AI"
    url: "https://www.semrush.com/blog/most-cited-domains-ai/"
    accessed: 2026-09-06
  - title: "Vercel — The Rise of the AI Crawler"
    url: "https://vercel.com/blog/the-rise-of-the-ai-crawler"
    accessed: 2026-09-06
  - title: "Cloudflare — From Googlebot to GPTBot: who's crawling your site in 2025"
    url: "https://blog.cloudflare.com/from-googlebot-to-gptbot-whos-crawling-your-site-in-2025/"
    accessed: 2026-09-06
  - title: "Muck Rack — Generative Pulse（2026年5月版）"
    url: "https://muckrack.com/blog/what-is-ai-reading-may-2026"
    accessed: 2026-09-06
  - title: "OtterlyAI — YouTube AI Citation Study 2026"
    url: "https://otterly.ai/blog/youtube-ai-citation-study-2026/"
    accessed: 2026-09-06
faq_items:
  - question: "AI検索対策で効果が確認されている施策は何ですか？"
    answer: "GEO論文（KDD 2024）のベンチマーク実験では、引用文の挿入が約43%、統計データの挿入が約33%、出典明記が約28%可視性を改善し、キーワード詰め込みは約9%の低下でした。統制実験の結果であり、実サービスでの再現は保証されません。"
  - question: "AI検索からの流入はどのくらいありますか？"
    answer: "Ahrefsの自社データ（2025年6月）では、AI検索経由は全流入の0.5%にとどまる一方、サインアップの12.1%を占めました。流入量は小さいもののコンバージョン率が高い、という非対称性が報告されています。"
  - question: "AIはどんなサイトを引用しやすいですか？"
    answer: "Profoundの調査ではChatGPTのトップ10引用のうちWikipediaが47.9%、Seer Interactiveの調査ではSearchGPT引用の87%がBing上位結果と一致、Muck Rackの調査ではAI引用の84%がearned mediaでした。偏りは大きい一方、時点によって変動します。"
  - question: "AI検索の統計を引用するときの注意点は？"
    answer: "調査時点・調査規模・測定手法を必ず併記することです。ChatGPTのReddit引用比率が2025年8月から9月にかけて約60%から約10%へ急落した例のように、数値は短期間で大きく動くため、古い数値を現在値として扱わないことが重要です。"
---

本記事は、一次調査・公式データのうち原典URLを確認できた統計のみを、カテゴリ別に出典つきで整理した2026年版の統計ハブです。
## 施策効果に関する統計（GEO論文）

査読付き研究であるGEO論文（arXiv:2311.09735、KDD 2024採択）は、生成エンジン上の可視性を最大約40%改善できると報告しました。手法別の効果（ベースライン比）は次のとおりです。

| 手法 | 可視性の変化 |
|---|---|
| 引用文の挿入 | 約+43% |
| 統計データの挿入 | 約+33% |
| 流暢さの最適化 | 約+29% |
| 出典の明記 | 約+28% |
| キーワード詰め込み | 約-9% |

同論文では、出典明記の効果が検索5位のサイトで+115.1%、1位のサイトで-30.3%と、順位によって効果が逆転することも示されています。上位サイトの模倣ではなく、下位サイトほど効く施策だという点が重要です。

## 流入とコンバージョンに関する統計

| 統計 | 出典・規模・時点 |
|---|---|
| AI検索経由は全流入の0.5%だが、サインアップの12.1%を占めた | Ahrefs自社データ（直近30日、2025年6月） |
| AIアシスタントの引用は自然検索結果より平均25.7%新しい（1,064日 vs 1,432日） | Ahrefs、約1,697万件の引用（2025年7月） |

流入量は小さくてもCVへの寄与が大きい、という非対称性が現時点の中心的な論点です。

## 引用元の偏りに関する統計

| 統計 | 出典・規模・時点 |
|---|---|
| SearchGPT引用の87%がBing上位結果と一致（Googleは56%） | Seer Interactive、100クエリ・500超の引用（2025年2月） |
| Google1ページ目の順位とLLM言及の相関は約0.65 | Seer Interactive、30万超キーワード・GPT-4oへの1万質問（2025年1月） |
| ChatGPTのトップ10引用ドメインのうちWikipediaが47.9% | Profound、6.8億件の引用（2024年8月〜2025年8月） |
| ChatGPTのReddit引用比率が約60%→約10%へ急落（2025年8月→9月） | Semrush、23万超プロンプト・1億超の引用（2025年7〜10月） |
| AI引用の84%がearned media、ペイドは0.3% | Muck Rack、2,500万超リンク（2026年5月） |
| ソーシャル引用の31.8%がYouTube。再生数と被引用の相関は約-0.03 | OtterlyAI、1億超の引用（2026年3月） |
| AI Overviews引用のうちGoogleトップ10のページは76%→約38%へ低下 | Ahrefs、190万件（2025年7月）→86.3万キーワード・400万URL（2026年3月）。検出手法が変わったため単純比較不可 |

## 技術・クローラーに関する統計

| 統計 | 出典・規模・時点 |
|---|---|
| GPTBotは月間5.69億リクエスト。主要AIクローラーにJavaScript実行の証拠なし | Vercel（2024年12月） |
| クローラー上位20のうちGPTBotのシェアは2.2%→7.7%（リクエスト+305%）、順位は9位→3位 | Cloudflare（2024年5月→2025年5月） |
| llms.txt設置ファイルの97%は月間アクセスゼロ | Ahrefs、13.7万ドメイン（2026年5月） |

JS実行の証拠がないことは、クライアントサイドレンダリング主体のサイトがAIに読まれにくいことを意味します。詳細は[AIクローラー一覧と制御方法](/trillionbank/news/ai-crawler-list-control/)と[llms.txtの解説](/trillionbank/news/llms-txt-guide/)を参照してください。

## 統計を引用する際の注意

1. **時点性**: SemrushのReddit急落やAhrefsの76%→38%のように、数値は数週間〜数カ月で大きく動きます。引用時は調査時点を併記してください。
2. **手法差**: 「引用」の定義（回答本文での言及か参照リンクか）、対象プラットフォーム、プロンプト設計が調査ごとに異なるため、異なる調査の数値は横比較できません。
3. **統制実験の限界**: GEO論文はベンチマーク上の統制実験であり、実サービスの本番挙動での再現を保証しません。ベンダー調査は各社ツールの測定範囲に依存します。

自社で測る方法は[AI検索の効果測定方法](/trillionbank/news/ai-search-measurement-method/)と[AI引用率の計算方法](/trillionbank/news/ai-citation-rate-calculation/)で解説しています。株式会社Trillion Bank（トリリオンバンク）では、AirReach Consulting（限定商用検証・導入相談受付）で質問単位の引用観測を継続し、公開統計と自社の観測記録を突き合わせています。

## 実務チェックリスト

1. 引用する統計の一次ソースURLを直接確認した
2. 調査時点・調査規模・測定手法をセットで記載した
3. 異なる調査の数値を同一指標として比較していない
4. 古い数値を「現在の値」として提示していない
5. 自社データで検証できる統計は自社の観測記録と突き合わせた
6. 統計の棚卸し（少なくとも四半期ごと）の担当を決めた

## できないこと・限界

- 本記事の統計は各調査時点のスナップショットであり、現在の各プラットフォームの挙動を示すとは限りません
- 各調査は対象・定義・手法が異なり、単一の「AI検索の真実」を示すものではありません
- 相関（例: 順位とLLM言及の約0.65）は因果を意味しません
- これらの統計を踏まえて施策を行っても、AI回答への掲載・引用や流入・売上の増加は保証されません
