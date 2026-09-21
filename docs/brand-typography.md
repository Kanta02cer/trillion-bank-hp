# Brand typography — TRILLION BANK

Date: 2026-09-20
Status: ACTIVE

## 方針

ロゴの幾何学ワードマーク（大文字・明瞭・計測インフラの印象）に寄せ、
AI生成サイトで頻出する **Inter + Space Grotesk + Noto だけの組み合わせ** をやめる。

## トークン

| CSS変数 | ファミリー | 役割 |
|---|---|---|
| `--sans` | IBM Plex Sans JP | 日本語本文・ナビ・本文UI |
| `--en` / `--brand` | Sora | 英字eyebrow・ブランド近似テキスト・英数字強調 |
| `--mono` | IBM Plex Mono | 日付・STEP番号・データ・コード的ラベル |

## 使い方

- ブランド名のテキストフォールバック: `font-family: var(--brand); letter-spacing: 0.12em; text-transform: uppercase; font-weight: 600`
- 本文は常に `--sans`。見出しも基本 `--sans`、英字ラベルだけ `--brand` / `--mono`
- ロゴ画像がある箇所は画像を優先。フォントは補助

## 読み込み

`_includes/tb-head.html` の Google Fonts 1本。
corp レイアウトも同じ3ファミリーに揃える。

## 避けるもの

- Inter / Roboto / system-ui のみの「無個性SaaS」見た目を主軸にしない
- Space Grotesk をサイト全体のシグネチャにしない
- クリーム地×セリフ×テラコッタ、紫グラデ、蛍光ダークの定番AIルック
