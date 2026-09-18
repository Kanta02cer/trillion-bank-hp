# AirReach Sales View (v2 P0) — 漆沢FB対応

## 最優先（これだけでまずはいい）

### 一般検索
1. 今どれだけ検索されているか（月間需要 · Estimated / User Input / Official）
2. うちはどれだけ入れるか（獲得力スコア · Observed from URL診断）
3. サービスで何倍に増やせるか（改善後レンジ · Inferred · 倍表記）
4. 問い合わせ見込み（+件レンジ · Inferred）

### 指名検索（メディくる組み込み想定）
1. 今どれだけ指名検索されているか
2. 情報反映度スコア
3. メディくる等で整えた場合の改善後スコアレンジ
4. 記事URL登録時は指定記事の参照されやすさ（保証なし）／未登録時は問い合わせ見込み

## UI規則
- 最初の画面は4数字まで
- AIO/GEO/SchemaはExpert Viewのみ
- 「必ず引用」「2倍になります」断定禁止 → レンジ＋ラベル

## ルート
`/airreach/` Sales View · `/airreach/studio/` 実装 · `/airreach/platform/` Expert · HackⅡ 実測
