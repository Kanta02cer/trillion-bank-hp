# AirReach Sales View — 業種別ページ導線

## URL
| 入口 | パス |
|---|---|
| アンケートハブ | `/airreach/` |
| 飲食店 | `/airreach/restaurant/` |
| 美容・クリニック | `/airreach/clinic/` |
| BtoB | `/airreach/b2b/` |
| メディア | `/airreach/media/` |
| その他 | `/airreach/other/` |

## 動線
1. `/airreach/` で業種→URL→目的→言葉
2. 回答保存（localStorage）
3. 業種専用ページへ `location.assign`
4. 結論4数字のみ → CTAで改善後 → 施策3件

## フォント
本文・見出し: `var(--sans)` = Noto Sans JP  
ラベル: `var(--mono)` = Space Grotesk  
サイト共通 `tb.css` と統一。
