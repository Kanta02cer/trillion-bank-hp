# Trillion Bank 30秒CM — 絵コンテ・出典台帳

- 尺: 30.0秒 / 1920×1080 / 30fps（モーションブラー: 4サブフレーム・180°シャッター）/ H.264 + AAC 320kbps
- 音: オリジナル合成（`audio/score.py`、サンプル・第三者音源なし）120BPM、Dマイナー → Dメジャーで解決。48kHz、-14 LUFS（Web配信基準）、True Peak ≤ -1 dBTP。最後の0.5秒は無音
- 状態: **社内レビュー用ドラフト（未公開）**。サイトやSNSで公開する前に人によるレビュー・承認が必要（`PUBLICATION_POLICY.md`）

## コンセプト

「AI検索が重要なのは分かる。でも、判断材料がない」という公式サイト上の課題から始め、
**測る（AirReach） → 証跡化する（Adctor） → 測る・守る・記録する・正規化する → タグライン → ロゴ**の順に、
サイトの役割（`AGENTS.md` Mission: 30秒で「何をする会社か／何を測るか／今使えるものと研究中のもの／相談先」を伝える）をそのまま30秒の映像にしています。

ロゴのシンボル（3枚のパネル＋波線）を映像全体のモチーフとして使います。冒頭の光の線、Adctorのゲートウェイ、4つの動詞で1パーツずつ組み上がる背景、エンドカードのロゴ組み上げは、すべて同じシンボルの形です。

## タイムライン（秒）

| # | 時間 | シーン | テロップ（画面の文字） | 出典 |
|---|---|---|---|---|
| S1 | 0.0–4.0 | 課題。紺の空間にAI回答カードとキーワード（AI検索 / AEO / GEO / LLMO / 引用 / 言及）が浮かび、ロゴの波線が光って画面を横切る。2.5秒以降はカードが「?」に変わり、グリッチ | 「AI検索が重要なのは分かる。」「でも、判断材料がない。」 | `index.html:265`（PROBLEM見出し） |
| S2 | 4.0–7.0 | 白に反転。ブランドグラデーションの波線が太く走る | 「「出たか」ではなく、」「なぜ選ばれ、なぜ外れたかまで。」 | `trillionbank/business/hack2/index.html:35`（ページ見出し） |
| S3 | 7.0–12.6 | AirReach Consulting。AI回答画面（SAMPLE）にスキャン光が走り、言及・回答本文・引用URL・測定日時と条件にラベルが付く。最後は保存した回答を同じ条件で並べて比べる | BUSINESS 01 — 測る / AirReach Consulting / 限定商用検証・導入相談受付 / 01 自社・競合の言及 / 02 AI回答本文 / 03 引用URL / 04 測定日時・条件 / 05 時系列の比較 / 初回・2回目…5回目 / 「AI検索の現在地を、証拠付きで。」 | `_data/public_facts.yml` products.hack2（status、public_definition、verified_scope「AI回答本文と引用URLの保存」「自社・競合の言及・引用状況の確認」「測定条件と時系列の比較」）。「証拠付きで」は `index.html:166` FAQ・hack2 tbdesc「証拠付きで測定」。「現在地」は public_definition「AI検索上の現在地」と public_cta.primary_label |
| S4 | 12.4–14.6 | ロゴのパネルと同じ角度の青いワイプ。AirReach Tools にURLを入れると、見つかりやすさの点数と「いちばん最初に直すこと」が表示される（SAMPLE） | FREE CHECK — 店舗・営業向け / AirReach Tools / 無料診断 / 「URLから、無料診断。」 / 見つかりやすさ / いちばん最初に直すこと | public_facts products.airreach（status「店舗・営業向け無料診断。URL入力から…」、public_definition「見つかりやすさの点数といちばん最初に直すこと、主ボタン1つ」）、`index.html:285` |
| S5 | 14.3–20.0 | Adctor。3枚の暗いパネルがシャッターのように閉じて場面転換。ロゴのシンボルがゲートウェイになり、AI Agent / RAG / MCP の取得要求が波線に沿ってパネルを通り、利用レシートが台帳に並ぶ | BUSINESS 02 — 証跡化する / Adctor / 研究開発・PoC相談 / USAGE LEDGER 利用イベントの記録（検証中） / 01 取得要求 → 02 利用レシート → 03 証跡保存 → 04 契約条件 → 05 請求（構想） / 「AIに使われた情報を、価値へ。」 | public_facts products.adctor（status、public_definition「AI・RAG・MCP・Agent…」）、`trillionbank/business/pay-per-crawl/index.html:45-52`（FLOW）、`index.html:225`（「AIに使われた情報を価値へ変える」）、`index.html:293,312`（Usage Ledger／検証中） |
| S6 | 20.0–24.0 | 4つの動詞を1拍2つ（1秒）ずつ打つ。背景のシンボルが1語ごとに1パーツずつ組み上がる | 01 MEASURE 測る — AI検索での言及・引用・推薦を可視化 / 02 PROTECT 守る — AIクローラーのアクセス制御を研究開発 / 03 RECORD 記録する — 利用イベントの台帳記録を検証中 / 04 NORMALIZE 正規化する — ライセンス・請求・将来の分配へ接続 | `index.html:308-313`（ARCHITECTURE）。英語ラベルは見出し語の訳で、新しい主張は含まない |
| S7 | 24.0–30.0 | タグライン。背景で 1 → 1,000,000,000,000（＝1兆＝トリリオン）と1桁ずつ増える。そのあとロゴのシンボルが描かれ、ワードマークが1文字ずつ立ち上がる。トリウルくんが登場 | 「AI革命で、トリリオンの課題を担う。」 / TRILLION BANK（公式ワードマーク） / 株式会社Trillion Bank / 「AI検索の現在地を相談する →」 / trillion-bank.jp / ※株式会社Trillion Bankは銀行業を営む会社ではありません。 | `index.html:224`（H1）、public_facts company.legal_name・website・bank_disclaimer、public_cta.primary_label |

### 注釈テロップ（各シーンの左下）

- S3: ※画面はイメージです（SAMPLE）。 ※AI検索での掲載・順位・売上・問い合わせを保証するものではありません。 — public_facts hack2.limitations
- S4: ※画面はイメージです（SAMPLE）。 ※診断結果は目安です。掲載・順位・予約・売上を保証するものではありません。 — public_facts airreach.limitations
- S5: ※画面は構想イメージです。Adctorは研究開発・PoC段階の取り組みで、完成済みの決済・自動徴収・自動分配サービスではありません。 — public_facts adctor.limitations / pay-per-crawl「証跡から請求までの流れ（構想）」
- S7: ※株式会社Trillion Bankは銀行業を営む会社ではありません。 — public_facts company.bank_disclaimer

## 素材（すべて公式サイトの公開素材、または公式素材から作ったもの）

| 素材 | 元ファイル | 使い方 |
|---|---|---|
| ワードマーク | `images/hero/tb-logo-hero.webp` | `tools/prep_assets.py` で黒部分と「A」の青いバーに分け、1文字ずつ切り出して表示する。ピクセルは描き直していない |
| シンボル | `images/hero/tb-logo-symbol.webp` | 形状を計測してSVGで作り直したもの（波線のRMS誤差0.09px、パネルの重なり順も原画と同じ）。最後のロックアップの配置は `images/hero/tb-logo-color.webp` の比率に合わせた |
| トリウルくん | `trillionbank/assets/images/toriuru/toriuru-{base,ears,tail}.webp` | サイトと同じレイヤー構成（耳・しっぽの回転の支点もサイトのCSSと同じ） |
| 色 | `#164BFF` / `#52D5FF` / `#071426` / `#0B1220` | サイトのCSSトークン |
| 書体 | Noto Sans JP / Inter / Space Grotesk（OFL） | サイトと同じ書体ファミリー |

使っていないもの: 旧Regalis期の素材（`open.anim.mp4` を含む）、メディア出演の映像・サムネイル、顧客・投資家・パートナー名、価格、実測値。

## SAMPLE表示の方針

- AI回答画面、URL診断画面、時系列グラフはすべて「SAMPLE」と明記したイメージ。測定条件の欄は hack2 ページの「複数AIで同条件・定点測定」の言い換え。社名は「自社」「競合A」、URLは予約済みドメイン（example.jp / .com / .org）、質問は「おすすめの〇〇サービスは？」
- 時系列グラフは改善を示さないよう上下に揺れる系列にしている。実測値・成果を表すものではない
- 見つかりやすさの「64」も画面例で、実測値ではない

## 音（`audio/score.py`）

| 時間 | 内容 |
|---|---|
| 0.0–4.0 | 低いドローン、時計のようなハイハット、2.5秒「でも、」でロー、グリッチ音（映像のグリッチと同じフレーム）、ライザー |
| 4.0 | ドロップ。4つ打ち、オフビートのベース、16分のアルペジオ（Dm–B♭–F–C） |
| 7.0–14.0 | 文字が流れるタイプ音、スキャン音、ラベルごとのブリップ（Fの和音を上昇）、保存スタンプ、URL入力、点数のリング、完了チャイム |
| 14.3–20.0 | シャッターの3連打音、ゲート通過音（パケットごとに位置を計算）、レシート音。暗めの16分ベース（Gm–B♭）、18.25秒「価値へ。」でFに上がる |
| 20.0–24.0 | 4拍のヒット＋スタブ（Dm–B♭–C–A）、24.0秒直前に一瞬の無音 |
| 24.0–30.0 | Dメジャーで解決。1兆へ数字が増えるのに合わせて13音の上昇音階、ロゴ完成時にベル、トリウルくんのポップ音、きらめき。29.5秒以降は無音 |

## 再レンダリング

```bash
cd ops/cm-30s
npm install                         # 書体・Playwright・pngjs
python3 tools/prep_assets.py        # ワードマークのレイヤー（コミット済み）
node render.mjs --cues              # 音のキュー → out/cues.json
python3 audio/score.py              # → out/score.wav
node render.mjs                     # → out/trillion-bank-cm-30s.mp4（マスター、約20分）
node render.mjs --stills 4.5,9.8    # 確認用の静止画
./tools/review_video.sh             # コンタクトシート・ラウドネス確認
```

- モーションブラー: 1フレームにつき4サブフレーム（180°シャッター）。ワイプ・シャッター・ズーム・動詞のスラムなど速い動きの区間（`render.mjs` の `FAST`）は16サブフレームにしている
- `dist/trillion-bank-cm-30s.mp4` は Web 用に再エンコードしたもの（マスターから `ffmpeg -crf 21`）

`cm.html` をブラウザで開くとリアルタイムでプレビューできます（クリックで頭出し、`?t=12.3` でその時刻の静止画）。
