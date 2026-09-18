# AirReach Sales View — アンケート導線 + 業種別UX

## 開始ゲート（必須）
1. 業種
2. 会社URL
3. 目的（集客を調べる / 自社の見え方を調べる）
4. 調べたい言葉（＋見え方時は任意の記事URL）

すりガラス全画面で入力完了まで本編をブロック。
回答は `localStorage`（`airreach_onboard_survey_v1`）に User Input として保存。

## ルーティング
- 飲食・クリニック・BtoB × 集客 → generic_search + 業種KPI
- メディア、または「見え方」 → branded_search + 記事参照/情報源マップ

## 営業画面の原則
- 約7割を隠す：Impact / 施策は次のCTAまで非表示
- 4数字 + 意味 + データ種別
- CTAは1つずつ
