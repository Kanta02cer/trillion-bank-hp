# HackⅡ Founding Monitor LP 制作プレビュー

このLPは、`main`へ反映する前に専用ブランチ上のGitHub Codespacesで確認します。

## 対象

- リポジトリ: `Kanta02cer/trillion-bank-hp`
- 制作ブランチ: `preview/hack2-founding-monitor`
- 対象ページ: `/lp/hack2/founding-monitor/`
- 開発サーバー: Jekyll / port `4000`

## 1クリックで開く

[GitHub Codespacesで制作プレビューを開く](https://codespaces.new/Kanta02cer/trillion-bank-hp/tree/preview%2Fhack2-founding-monitor?quickstart=1)

初回は「Create codespace」を選択してください。依存関係のインストール後、Jekyll開発サーバーが自動起動し、ポート4000のプレビューが開きます。

確認するURLパスは次のとおりです。

```text
/lp/hack2/founding-monitor/
```

## 修正確認の流れ

1. このチャットで修正内容を伝える
2. 修正を `preview/hack2-founding-monitor` にコミットする
3. Codespacesのターミナルで次を実行する

```bash
git pull --ff-only
```

4. ブラウザのプレビューを再読み込みして確認する
5. 承認後にのみ `main` へマージする

## 修正依頼テンプレート

```text
対象: PC / スマートフォン / 両方
セクション: Hero、課題、機能、料金・仕様、CTA、フォーム、FAQ など
現状: 現在どのように見えるか
修正: どのように変えたいか
参考: 参考URL、画像、色、文言など
優先度: 高 / 中 / 低
```

## 開発サーバーを再起動する場合

```bash
bash .devcontainer/start-preview.sh
```

ログを確認する場合は次を実行します。

```bash
tail -f .preview/jekyll.log
```

プレビューが自動で開かない場合は、Codespaces下部の「PORTS」タブからポート`4000`を開いてください。

## 本番への影響

この制作ブランチを確認している間、`trillion-bank.jp`の本番ページは変更されません。ドラフトPRを承認して`main`へマージした時点で、既存のGitHub Pagesデプロイ処理が動作します。
