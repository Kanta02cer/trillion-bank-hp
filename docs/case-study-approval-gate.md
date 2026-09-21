# 測定事例 — 実名公開ゲート

Date: 2026-09-20
Status: ACTIVE
Data: `_data/case_study_approvals.yml`

## ルール

| status | 公開してよいもの |
|---|---|
| `sample` | 業種フレームワーク、測定の型、SAMPLE明示。顧客名・成果数字は不可 |
| `approved` | `approved_fields` に列挙した項目のみ。`approval_ref` 必須 |

## 承認後の手順

1. 書面承認番号を `approval_ref` に記入
2. `status: approved` と `approved_fields` を更新
3. 事例ページから SAMPLE バッジを外し、承認済みフィールドだけ本文へ
4. content_guard → 目視 → PR
5. 期限切れ時は SAMPLE に戻すか非公開

Stop: 承認番号なしの実名・KPI掲載。
