---
title: "AirReach Consulting Research 始動｜「AirReach ConsultingでAirReach Consultingを測る」公開測定プロジェクトを開始します"
date: 2026-08-13
last_modified: 2026-08-13
category: 調査レポート
tbdesc: "トリリオンバンクがAI検索の実測データを公開する研究シリーズ「AirReach Consulting Research」を開始。第1弾は自社を測定対象とする「AirReach ConsultingでAirReach Consultingを測る」プロジェクトです。測定設計とデータポリシーを先に全公開します。続報は本シリーズでご確認ください。"
keywords: "AirReach Consulting Research,AI検索 実測データ,AI推薦 調査,AEO 調査レポート,AI検索 測定方法,LLMO データ,トリリオンバンク,AirReach Consulting"
ai_summary: "株式会社トリリオンバンクが、AI検索での企業推薦・引用元・競合差を実測データとして公開する研究シリーズ「AirReach Consulting Research」を開始。第1弾はトリリオンバンク自身を測定対象に、測定→改善→再測定の全過程を公開する「AirReach ConsultingでAirReach Consultingを測る」プロジェクトの設計とデータポリシーを解説する。"
references:
  - title: "Google — Google検索の生成AI機能向け最適化ガイド"
    url: "https://developers.google.com/search/docs/fundamentals/ai-optimization-guide"
    note: "Googleの生成AI検索も基礎的SEO・クロール/インデックス可能性・人間向けの独自コンテンツが中心と説明する公式ガイド。測定設計の前提として参照。"
  - title: "Gartner — By 2026, traditional search engine volume will drop 25%"
    note: "AI検索シフトの市場データ。研究シリーズを立ち上げる背景として参照。"
  - title: "Generative Engine Optimization (GEO) — Princeton/Georgia Tech/IIT Delhi/Allen AI"
    url: "https://arxiv.org/abs/2311.09735"
    note: "最適化でAI可視性が最大30〜40%向上したとする研究。「施策前後で差が測れる」ことの先行事例として参照。"
jsonld: |
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "AirReach Consulting Researchとは何ですか？",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "AirReach Consulting Researchは、株式会社トリリオンバンク（東京都千代田区、代表取締役CEO 井上幹太）が運営する研究シリーズです。AI検索での企業推薦の状況・引用元チャネル・競合との差を、AI Recommendation Intelligence「AirReach Consulting」の測定フレームを用いた実測にもとづく独自データとして公開します。第1弾はトリリオンバンク自身を測定対象とする「AirReach ConsultingでAirReach Consultingを測る」プロジェクトです。"
        }
      },
      {
        "@type": "Question",
        "name": "AirReach Consulting Researchで公開されるデータは信頼できますか？",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "本シリーズでは、公開するすべてのデータについて測定日時・使用した質問・測定条件を明記します。また、自社に都合の悪い結果（推薦候補に入らなかった、改善後も差が出なかった等）もそのまま公開する方針です。AI検索の回答は日々変動するため、単発のスクリーンショットではなく、同一条件での再測定を含む形で公開します。"
        }
      },
      {
        "@type": "Question",
        "name": "AirReach Consulting Researchで顧客のデータが公開されることはありますか？",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "ありません。AirReach Consulting Researchで公開するのは、トリリオンバンク自社の測定データ、または一般に公開されている情報のみです。AirReach Consultingの導入企業・商談中の企業の測定結果や社名を、同意なく公開することは一切ありません。"
        }
      },
      {
        "@type": "Question",
        "name": "AirReach Consulting Researchの結果はいつ・どこで公開されますか？",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "測定完了後、株式会社トリリオンバンクのオウンドメディア内の本シリーズ（カテゴリ：調査レポート）で順次公開します。特別な購読手続きは不要で、どなたでも無料で閲覧できます。公開時期を数値で予告することはせず、測定と検証が完了したものから記事化します。"
        }
      },
      {
        "@type": "Question",
        "name": "AirReach Consultingはすでに完成した製品ですか？",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "AirReach Consultingは現在開発中で、導入相談を受付中のAI Recommendation Intelligenceです。AI Decision Share（候補入り率）、Recommendation Win・Loss（競合勝敗）、Citation Channel Map（引用元チャネル分析）、Measure→Act→Remeasure（施策前後の再測定）の4つの測定フレームで設計されています。対応AIの範囲は、契約時点で本番検証済みの範囲をご案内しています。"
        }
      }
    ]
  }
  </script>
---

## AirReach Consulting Researchとは

**AirReach Consulting Researchとは、AI検索での企業推薦・引用元・競合差を、実測にもとづく独自データとして公開する、株式会社トリリオンバンクの研究シリーズです。** 解説や推測ではなく「実際に測ったらどうだったか」を、測定条件つきで公開していきます。

本記事はその創刊宣言です。重要な前提として先にお伝えします。**この記事に測定結果の数値は一切登場しません。** まだ測っていないからです。今回は「何を・どう測り・どう公開するか」の設計だけを、先にすべて公開します。

### この記事で分かること

- AirReach Consulting Researchの目的と、なぜ独自データを公開するのか
- 第1弾プロジェクト「AirReach ConsultingでAirReach Consultingを測る」の6ステップ設計
- 測定・公開に関するデータポリシー（顧客データの扱いを含む）
- 今後の公開予定テーマと、結果の公開方法

---

## なぜ独自データを公開するのか

AI検索対策（AEO/LLMO）の情報は、この1年で急速に増えました。当社も「[LLMO・GEO・AEOの違いとは](/trillionbank/news/llmo-geo-aeo/)」や「[生成AIに引用されない原因と対策](/trillionbank/news/not-cited-by-ai/)」といった解説記事を公開してきました。しかし、解説記事には構造的な限界があります。

### 理由1: 解説記事は模倣されるが、実測データは模倣されない

手法の解説は、公開した瞬間から誰でも書けるものになります。実際、AEO/LLMOの解説記事は各社から同じような内容が出続けています。一方、**「いつ・どの条件で・何を測ったらこうだった」という一次データは、測定した者にしか出せません。** 読者にとっての情報価値も、二次的な解説より一次データの方が長持ちします。

### 理由2: 読者の判断材料になる

AI検索対策は効果が見えにくく、「やるべきか」「外注すべきか」の判断が難しい領域です。当社は「[内製/外注判断ガイド](/trillionbank/guide/inhouse-or-outsource/)」でも書いたとおり、内製という選択肢を否定しません。判断に必要なのは営業トークではなく、**施策の前後で何がどれだけ変わったのか（あるいは変わらなかったのか）という事実**です。AirReach Consulting Researchはその事実を提供する場にします。

### 理由3: 測定条件を透明化する文化をつくる

AI検索の回答は日々変動します。都合のよい瞬間のスクリーンショット1枚で「AIに推薦されました」と示すことは、誰にでもできてしまいます。だからこそ本シリーズでは、**測定日時・使用した質問・測定条件を必ず明記し、同一条件での再測定とセットで公開**します。この業界に「測定条件を書かないデータは信用しない」という文化ができることは、当社を含むすべての事業者の利益になると考えています。

なお、GEO研究（プリンストン大学等、arXiv:2311.09735）が最適化によるAI可視性の最大30〜40%向上を実験で示したように、「施策の前後で差を測る」というアプローチ自体には先行事例があります。当社はこれを、日本語のAI検索環境で、自社を実験台にして実践します。

---

## 第1弾プロジェクト「AirReach ConsultingでAirReach Consultingを測る」

第1弾の測定対象は、他社ではなく**トリリオンバンク自身**です。開発中のAI Recommendation Intelligence「AirReach Consulting」の測定フレームを、まず自社に適用します。

AirReach Consultingの中心思想は、AI検索で「出たか」ではなく、**なぜ選ばれ、なぜ外れたかまで**を測ることです。その思想を自社で実証できないなら、他社に提供する資格はない——それがこのプロジェクトの出発点です。

### 6ステップの実施計画

| ステップ | 内容 | 対応する測定フレーム |
|---------|------|-------------------|
| ① 重要質問の設定 | 見込み顧客がAIに聞くと想定される質問群を定義し、公開する | — |
| ② 候補入り測定 | 自社・競合が各質問で推薦候補に入るかを測定する | AI Decision Share / Recommendation Win・Loss |
| ③ 引用URL確認 | AIの回答が根拠として引用した情報源・URLを確認する | Citation Channel Map |
| ④ サイト改善 | ③の結果にもとづき自社サイトを改善する（施策内容も公開） | — |
| ⑤ 同条件で再測定 | ①と同じ質問・同じ条件で測定をやり直す | Measure→Act→Remeasure |
| ⑥ 結果公開 | 改善前後の差分を、良い結果も悪い結果も本シリーズで公開する | — |

ポイントは⑤です。施策の効果を語るには、**施策前と同一条件での再測定**が不可欠です。ここが崩れると、単なる「変動」を「効果」と言い張ることができてしまいます。逆に言えば、再測定して差が出なければ、その施策は（少なくともその条件では）効かなかったと正直に書きます。

なお、測定に使用するAIの範囲は、AirReach Consulting本体と同じ方針をとります。つまり、**その時点で本番検証済みの範囲を明記した上で測定**し、対応AIのリストを確定事実として先回りして約束することはしません。AirReach Consultingの測定フレームの詳細は「[AirReach Consulting製品ページ](/trillionbank/business/hack2/)」を、レポートの出力イメージは「[AirReach Consultingサンプルレポート](/trillionbank/news/hackii-sample-report/)」をご覧ください。

### このプロジェクトの限界も先に書いておきます

誠実開示の観点から、あらかじめ限界を明記します。

- **n=1の事例です。** トリリオンバンク1社の結果であり、すべての業界・企業に一般化できるものではありません。
- **AI検索の回答は変動します。** 改善施策と無関係な要因（モデル更新等）で結果が動く可能性があり、完全な因果の証明はできません。測定回数と条件の明記で、できる限り解釈可能性を担保します。
- **成果を約束するものではありません。** このプロジェクトは方法論の公開実験であり、AirReach Consultingや特定施策によるAIでの表示・問い合わせ・売上を保証するものではありません。

また、Googleが公式の「生成AI機能向け最適化ガイド」で述べているとおり、Googleの生成AI検索に対しては基礎的なSEO・クロール/インデックス可能性・人間向けの独自コンテンツが中心であり、Google向けにllms.txtやAI専用マークアップは不要とされています。④の改善施策は、こうした一次情報と矛盾しない範囲で設計し、何をやったかを個別に公開します。

---

## 測定・公開のデータポリシー

AirReach Consulting Researchのすべての記事は、以下のポリシーに従います。

1. **顧客データは公開しません。** AirReach Consultingの導入企業・商談中の企業の測定結果や社名を、同意なく公開することは一切ありません。
2. **公開するのは自社データまたは公開情報のみです。** 競合比較を行う場合も、一般に公開されている情報にもとづく範囲にとどめます。
3. **測定日時・条件を必ず明記します。** 使用した質問、測定時期、測定に使用したAIの範囲を各記事に記載します。
4. **都合の悪い結果も公開します。** 「候補に入らなかった」「改善しても差が出なかった」という結果も、そのまま記事にします。うまくいった結果だけを選んで見せることはしません。

---

## 今後の公開予定テーマ

第1弾と並行して、以下のテーマを予定しています（いずれも「予定」であり、内容・順序は変わる可能性があります）。

- **業界別のAI推薦シェア調査（予定）** — 特定業界の想定質問で、どの企業が候補に入りやすいかの傾向
- **AIが引用する情報源の傾向分析（予定）** — 自社サイト・比較サイト・メディア・SNSなど、引用元チャネルの構成比
- **AI回答の変動率調査（予定）** — 同一質問を期間をあけて測定した場合、回答がどの程度入れ替わるか

変動率調査は特に重要だと考えています。変動の大きさが分からなければ、「施策の効果」と「ただの揺らぎ」を区別できないからです。この論点は「[AI検索可視性ベンチマーク](/trillionbank/news/ai-search-visibility-benchmark/)」でも扱っています。

---

## よくある質問（FAQ）

**Q. AirReach Consulting Researchの目的は何ですか？**

A. AI検索での企業推薦・引用元・競合差について、推測ではなく実測にもとづく独自データを公開し、読者が「AI検索対策をやるべきか・どうやるべきか」を判断する材料を提供することです。あわせて、測定条件を明記してデータを公開する文化をこの領域につくることを目指します。

**Q. 公開されるデータの信頼性はどう担保されますか？**

A. すべての記事で測定日時・使用した質問・測定条件を明記し、施策の効果を示す場合は必ず同一条件での再測定とセットで公開します。また、都合の悪い結果もそのまま公開する方針です。

**Q. 顧客のデータが使われることはありますか？**

A. ありません。公開するのはトリリオンバンク自社の測定データ、または一般に公開されている情報のみです。

**Q. どうすれば続報を読めますか？**

A. 本オウンドメディアの「調査レポート」カテゴリで順次公開します。特別な購読手続きは不要で、どなたでも無料で閲覧できます。

**Q. AirReach Consultingは今すぐ使えますか？**

A. AirReach Consultingは現在開発中で、導入相談を受付中です。対応AIの範囲は契約時点で本番検証済みの範囲をご案内しています。詳細は[AirReach Consulting製品ページ](/trillionbank/business/hack2/)をご覧ください。

---

## まとめ — 結果は本シリーズで順次公開します

AirReach Consulting Researchは、AI検索の実測データを測定条件つきで公開する研究シリーズです。第1弾「AirReach ConsultingでAirReach Consultingを測る」では、①重要質問の設定 → ②候補入り測定 → ③引用URL確認 → ④サイト改善 → ⑤同条件で再測定 → ⑥結果公開、の6ステップをトリリオンバンク自身に適用し、良い結果も悪い結果も公開します。測定結果は、測定完了後、順次本シリーズで公開します。

それまでの間、AI検索測定の考え方は「[AI検索可視性ベンチマーク](/trillionbank/news/ai-search-visibility-benchmark/)」を、代理店の方は「[販売代理店がAI検索対策を提案すべき3つの理由](/trillionbank/news/ai-search-for-agencies/)」をあわせてご覧ください。
