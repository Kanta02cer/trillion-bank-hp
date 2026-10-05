#!/bin/bash
# 定期計測の同時実行のテスト（複数のセッション）。ローカルの検証用 Postgres でだけ実行する。本番 DB では実行しない
#   前提: 20261005・20261006 の migration を適用済み。接続は PGHOST・PGPORT・PGUSER・PGDATABASE（PGHOST は 127.0.0.1 か localhost のみ）
#   確かめること:
#   5) 同じ顧客の「今すぐ1回」の取り出しと定期実行の取り出しが同時に始まっても、月の上限（1回・1回答）を超えない（どちらの順でも）
#   ・別の顧客2社の定期実行を2つのセッションで同時に取り出してもデッドロックしない・各回を1回だけ取る
set -u
case "${PGHOST:-}" in 127.0.0.1|localhost) ;; *) echo "PGHOST は 127.0.0.1 か localhost にしてください（本番 DB では実行しない）"; exit 2;; esac
P() { psql -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }
fail=0
T=$(mktemp -d)
ok() { if [ "$2" = "$3" ]; then echo "PASS: $1"; else echo "FAIL: $1（期待 $3・実際 $2）"; fail=1; fi; }
COST='{"perplexity":0.006}'
S1=00000000-0000-0000-0000-0000000000f1; S2=00000000-0000-0000-0000-0000000000f2
cleanup() { P -c "delete from public.measurement_jobs where client_id in ('$S1','$S2'); delete from public.measurement_schedules where client_id in ('$S1','$S2'); delete from public.clients where id in ('$S1','$S2'); delete from public.staff_members where email = 'cc@tb.test';" >/dev/null; }
setup() {
  cleanup
  P -c "insert into public.staff_members(email, role) values ('cc@tb.test', 'staff');
    insert into public.clients(id, name) values ('$S1', '同時1'), ('$S2', '同時2');
    insert into public.measurement_schedules(client_id, brand, enabled, engines, prompts, weekdays, hour_jst, max_runs_per_month, monthly_answer_cap, monthly_cost_cap_usd)
      values ('$S1', '同時1', true, array['perplexity'], '[{\"prompt\":\"q\"}]', array[extract(isodow from now() at time zone 'Asia/Tokyo')::int % 7]::smallint[], extract(hour from now() at time zone 'Asia/Tokyo')::int, 1, 1, 0.01),
             ('$S2', '同時2', true, array['perplexity'], '[{\"prompt\":\"q\"}]', array[extract(isodow from now() at time zone 'Asia/Tokyo')::int % 7]::smallint[], extract(hour from now() at time zone 'Asia/Tokyo')::int, 4, 100, 5);" >/dev/null
}
# 「今すぐ1回」を受け付ける（社内）→ job の id
request_now() { P -c "begin; set local role authenticated; select set_config('request.jwt.claims', '{\"email\":\"cc@tb.test\",\"role\":\"authenticated\"}', true); select public.airreach_schedule_request_now(id, '$COST') ->> 'job_id' from public.measurement_schedules where client_id = '$1'; commit;" | grep -E '^[0-9a-f-]{36}$'; }
manual_claim() { P -c "begin; set local role service_role; select 'manual:' || coalesce((public.airreach_schedule_claim_job('$1', now(), '$COST')) ->> 'job_id', 'none'); select pg_sleep($2); commit;" 2>&1 | grep -E 'manual:|ERROR'; }
cron_claim() { P -c "begin; set local role service_role; select 'cron:' || count(*) from public.airreach_schedule_claim(now(), '$COST', 10) x where x ->> 'client_id' = '$1'; select pg_sleep($2); commit;" 2>&1 | grep -E 'cron:|ERROR'; }
running_on() { P -c "select count(*) from public.measurement_jobs where client_id = '$1' and status = 'running'"; }
planned_on() { P -c "select coalesce(sum(answers_planned), 0) from public.measurement_jobs where client_id = '$1' and status = 'running'"; }

# 5-a) 手動が先にロックを取り、コミット前に定期実行が始まる
setup; JOB=$(request_now $S1)
( manual_claim $JOB 2 > $T/a ) & sleep 0.5; ( cron_claim $S1 0 > $T/b ) & wait
echo "  $(cat $T/a) / $(cat $T/b)"
ok '5-a) 手動が先：実行中は1件だけ（月1回の上限を超えない）' "$(running_on $S1)" 1
ok '5-a) 実行中の予定回答は1（月1回答の上限を超えない）' "$(planned_on $S1)" 1
ok '5-a) 定期の回は「見送り」・理由は回数' "$(P -c "select count(*) from public.measurement_jobs where client_id = '$S1' and trigger = 'schedule' and status = 'skipped' and skip_reason like '%月の実行回数の上限%'")" 1

# 5-b) 定期実行が先にロックを取り、コミット前に手動が始まる
setup; JOB=$(request_now $S1)
( cron_claim $S1 2 > $T/b ) & sleep 0.5; ( manual_claim $JOB 0 > $T/a ) & wait
echo "  $(cat $T/b) / $(cat $T/a)"
ok '5-b) 定期が先：実行中は1件だけ' "$(running_on $S1)" 1
ok '5-b) 手動の回は「見送り」・理由は回数' "$(P -c "select count(*) from public.measurement_jobs where id = '$JOB' and status = 'skipped' and skip_reason like '%月の実行回数の上限%'")" 1

# 5-c) 2社の定期実行を2つのセッションで同時に取り出す（デッドロックしない・各回を1回だけ）
setup
P -c "update public.measurement_schedules set max_runs_per_month = 4, monthly_answer_cap = 100, monthly_cost_cap_usd = 5" >/dev/null
( P -c "begin; set local role service_role; select 'A:' || count(*) from public.airreach_schedule_claim(now(), '$COST', 10); select pg_sleep(1); commit;" > $T/a 2>&1 ) &
( P -c "begin; set local role service_role; select 'B:' || count(*) from public.airreach_schedule_claim(now(), '$COST', 10); select pg_sleep(1); commit;" > $T/b 2>&1 ) & wait
echo "  $(grep -E 'A:|ERROR' $T/a) / $(grep -E 'B:|ERROR' $T/b)"
ok '5-c) デッドロック・エラーなし' "$(cat $T/a $T/b | grep -c ERROR)" 0
ok '5-c) 2社とも実行中は1件ずつ（合計2）' "$(P -c "select count(*) from public.measurement_jobs where client_id in ('$S1','$S2') and status = 'running'")" 2
ok '5-c) 取り出した数の合計も2（同じ回を2回取らない）' "$(( $(grep -oE '[0-9]+$' $T/a | head -1) + $(grep -oE '[0-9]+$' $T/b | head -1) ))" 2

cleanup; rm -rf "$T"
[ $fail = 0 ] && echo "ALL PASS" || { echo "FAILED"; exit 1; }
