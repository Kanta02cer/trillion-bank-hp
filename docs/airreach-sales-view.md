# AirReach Sales View — URL-first 導線（P0）

## URL
| 入口 | パス |
|---|---|
| 無料診断（URL-first） | `/airreach/` |
| 診断結果（共有） | `/airreach/result/?scan=` |
| 営業履歴 | `/airreach/sales/` |
| 飲食店 | `/airreach/restaurant/` |
| 美容・クリニック | `/airreach/clinic/` |
| BtoB | `/airreach/b2b/` |
| メディア | `/airreach/media/` |
| その他 | `/airreach/other/` |

## 動線（店舗）
1. `/airreach/` で URL → 同意 → 店確認 → 増やしたいこと
2. 診断を `scanId` で端末保存（`AirReachScanStore`）
3. 業種ページへ遷移し結論表示。主CTAは「この改善方法を見る」1つ
4. Studio / Platform / Google連携は「その他のツール」

## 動線（営業）
1. `/airreach/sales/` で履歴一覧
2. 「新しいお客様を診断」→ `/airreach/?fresh=1`
3. `/airreach/result/?scan=` で同じ結果を開き直し

## 永続化
P0: localStorage。本番: Client / Project / Diagnosis（`docs/airreach-p0-er.md`）。
