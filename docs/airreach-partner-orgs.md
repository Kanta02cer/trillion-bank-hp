# AirReach：共同会社（パートナー）の使い方と仕組み（2026-10-08）

共同会社の人は、AirReach の社内向けの画面（顧客の画面・7工程・Studio・営業キット・デモ）を使えます。見えるのは **自社が担当する顧客だけ** です。Trillion Bank（TB）の顧客や、ほかの共同会社の顧客は、一覧にも検索にも関数にも出ません。

## 決めたこと

| 項目 | 決まり |
|---|---|
| 見える顧客 | 自社が担当する顧客だけ（`clients.org_id` が自社）。TB の社内は全顧客 |
| 承認 | 共同会社の中で承認・公開できる（承認者は `can_approve`）。自社の顧客のレポートだけ |
| 使える機能 | 顧客の画面と7工程、Studio（診断・材料・AI 計測）、営業キット・デモ、顧客の追加・お客様の招待 |
| 人の追加・削除 | TB の管理者だけ（共同会社の人は人を増やせない） |
| 使えない機能 | 定期計測の設定（費用がかかるため TB の社内だけ）、顧客の削除、Google のデータの削除、社内の人の管理 |

## 仕組み（漏れたら「見えない」に倒す）

- `airreach_is_staff()` は「TB の社内」だけを指す。今までこれで全顧客を許していた場所は、書き換えなくても共同会社には閉じる。
- 共同会社に開く場所だけ `airreach_can_staff(顧客)`（社内は全顧客・共同会社は自社の顧客）に置き換えた：顧客・お客様・サイト・AI 計測・検索と訪問・施策・レポート・レポートの出来事・Studio の作業・依頼・Google 連携・診断の一覧。
- 共同会社の人が顧客を作ると、所属は自社に固定される（ほかの会社を指定しても自社になる）。所属は変えられず、担当には自社の人だけを設定できる（トリガ `clients_org_guard`）。
- 画面は `airreach_me` の `is_internal`・`org` を見て、ヘッダーに会社名を出し、定期計測の設定を出さない。見える範囲そのものは DB が決める（画面で隠しているだけではない）。

## 気をつけること

- 診断（無料診断と同じ公開サイトの分析）は URL ごとに保存されている。共同会社の人が、TB の顧客と同じ URL を自社の顧客に登録すると、その URL の診断の記録が見える。公開サイトを誰でも診断できる無料診断と同じ内容のため、守る対象にはしていない。
- `add-staff` で追加した人は TB の社内（全顧客が見える）になる。共同会社の人は必ず `add-partner-staff` で追加する（TB の社内の人を共同会社の人に変えることはしない）。
- 取り消し（rollback）は、共同会社の人が残っていると止まる（残したまま戻すと、その人が全顧客を見られる社内の人になるため）。

## 手順（本番。実行は承認のあと）

```
python3 scripts/airreach-api/phase2-apply.py apply-partner-orgs                          # 仕組みを入れる（適用前に本番の関数の形を確かめ、適用後に9項目を検証）
python3 scripts/airreach-api/phase2-apply.py add-partner-org 共同会社名                     # 共同会社を作る
python3 scripts/airreach-api/phase2-apply.py add-partner-staff someone@example.jp 共同会社名 [approver]
python3 scripts/airreach-api/phase2-apply.py assign-client <顧客ID> 共同会社名               # 既存の顧客を共同会社に渡す（TB に戻すときは TB）
```

取り消し：`supabase/rollback/20261008120000_airreach_partner_orgs_rollback.sql`（先に共同会社の人を消す）

## テスト

- `scripts/airreach-api/partner-orgs-test.sql`（ローカル Postgres）：共同会社2社と TB の顧客を置き、表8つ＋顧客・関数・書き込み・承認・割り当ての 50項目
- 既存の SQL テスト10本すべて合格。取り消し → 既存テスト合格 → 再適用 → 合格

## 開通の手順（共同会社の人の初回ログイン）

確認が済んでから行う（NDA・共有してよい顧客・承認者・利用期間）。登録済み・ログイン成功・対象の顧客を開けた、は別々に確認する。

1. 状態を見る：`phase2-apply.py partner-status`（共同会社・人・承認者・最後のログイン・割り当てた顧客。読み取りのみ）
2. 会社名を正式名にする（必要なとき・SQL）：`update public.partner_orgs set name = '正式名' where id = '…'`
3. 顧客を割り当てる：`assign-client <顧客ID> <会社名>`（共同会社に移すと、その顧客の担当者は未設定に戻る）
4. 承認者を決める：`add-partner-staff <email> <会社名> approver`（確認を依頼した本人は承認できない）
5. 本人に案内する：`/airreach/app/` を開いてメールアドレスを入れる → 届いたメールのリンクを押す（有効期限1時間）。ヘッダーに会社名が出る
6. 確認する：`partner-status` で最後のログインが入ったこと、本人の画面で割り当てた顧客だけが出ること

## 解除の手順

- 顧客だけ外す：`assign-client <顧客ID> TB`
- 人を外す：`remove-partner-staff <email>`（社内の人は消さない。次の画面の読み込みから使えなくなる）
- 試験：`partner-orgs-test.sql` に、ID の直書き・割り当ての解除・人の解除の確認がある（ローカル Postgres）

## 他社の情報が出ないこと（CSV・ZIP・PDF・API）

- 画面の CSV・ZIP・月次レポート（PDF・印刷）は、ブラウザがデータベースから読めたデータだけで作る。読める範囲は RLS（`airreach_can_staff`）で決まる
- サーバーの API はログインした人の権限で関数を呼ぶ。Google の API は、その人自身の Google の接続だけを使う。データベースを全権（service_role）で読むのは定期計測の処理だけで、定期計測の設定は社内だけ
