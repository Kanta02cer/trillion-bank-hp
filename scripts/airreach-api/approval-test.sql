-- AirReach 月次レポートの承認フローのテスト（ローカル Postgres で実行する。本番 DB では実行しない）
--   前提: phase1 / seed / phase2 / 20261002130000_airreach_report_approval を適用済み。
--   実行: psql -d <db> -v ON_ERROR_STOP=1 -f scripts/airreach-api/approval-test.sql
--   失敗すると例外で止まる。最後に 'ALL PASS' を出す。
\set QUIET on
begin;
insert into public.staff_members (email, role, name, can_approve) values
  ('ichinose@tb.test', 'staff', '担当', false), ('hirakawa@tb.test', 'staff', '承認者', true), ('other@tb.test', 'staff', '別の担当', false);
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000e1', '承認テスト顧客');
insert into public.client_members (client_id, email) values ('00000000-0000-0000-0000-0000000000e1', 'member@e1.test');

create or replace function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('email', p_email, 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_name; end if;
  raise notice 'PASS: %', p_name;
end $$;
-- 失敗するはずの文を実行し、失敗したら PASS
create or replace function pg_temp.denied(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'PASS: % (%)', p_name, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % (通ってしまった)', p_name;
end $$;
grant execute on function pg_temp.as_user(text), pg_temp.ok(text, boolean), pg_temp.denied(text, text) to authenticated;

set local role authenticated;
select pg_temp.as_user('ichinose@tb.test');
select pg_temp.denied('いきなり公開で作れない', $q$insert into public.reports (client_id, period_month, status, published_at) values ('00000000-0000-0000-0000-0000000000e1', '2026-10-01', 'published', now())$q$);
insert into public.reports (id, client_id, period_month, conclusions) values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000e1', '2026-10-01', '["結論"]');
select pg_temp.ok('下書きで作れる', (select status from public.reports where id = '00000000-0000-0000-0000-00000000f001') = 'draft');
select pg_temp.denied('下書きから直接公開できない', $q$update public.reports set status = 'published', published_at = now() where id = '00000000-0000-0000-0000-00000000f001'$q$);
select pg_temp.denied('下書きから直接承認できない', $q$update public.reports set status = 'approved' where id = '00000000-0000-0000-0000-00000000f001'$q$);
update public.reports set status = 'in_review' where id = '00000000-0000-0000-0000-00000000f001';
select pg_temp.ok('確認を依頼できる・依頼者が記録される', (select submitted_by = 'ichinose@tb.test' and submitted_at is not null from public.reports where id = '00000000-0000-0000-0000-00000000f001'));
select pg_temp.denied('確認待ちの間は中身を変えられない', $q$update public.reports set conclusions = '["書き換え"]' where id = '00000000-0000-0000-0000-00000000f001'$q$);
select pg_temp.denied('依頼した本人は承認できない（権限なし）', $q$update public.reports set status = 'approved' where id = '00000000-0000-0000-0000-00000000f001'$q$);
select pg_temp.as_user('other@tb.test');
select pg_temp.denied('承認者でない担当は承認できない', $q$update public.reports set status = 'approved' where id = '00000000-0000-0000-0000-00000000f001'$q$);
select pg_temp.denied('承認の記録を直接書けない', $q$update public.reports set approved_by = 'hirakawa@tb.test', approved_at = now() where id = '00000000-0000-0000-0000-00000000f001'$q$);
select pg_temp.as_user('hirakawa@tb.test');
select pg_temp.ok('承認者は can_approve=true', (public.airreach_me() ->> 'can_approve')::boolean);
update public.reports set status = 'approved', approved_by = 'someone@else.test' where id = '00000000-0000-0000-0000-00000000f001';
select pg_temp.ok('承認できる・承認者は自分の名前で記録される', (select approved_by = 'hirakawa@tb.test' and approved_at is not null from public.reports where id = '00000000-0000-0000-0000-00000000f001'));
select pg_temp.as_user('ichinose@tb.test');
update public.reports set status = 'published' where id = '00000000-0000-0000-0000-00000000f001';
select pg_temp.ok('承認済みは公開できる・公開日時が入る', (select status = 'published' and published_at is not null and approved_by = 'hirakawa@tb.test' from public.reports where id = '00000000-0000-0000-0000-00000000f001'));
select pg_temp.denied('公開中は中身を変えられない', $q$update public.reports set compiled = '{"x":1}' where id = '00000000-0000-0000-0000-00000000f001'$q$);
select pg_temp.as_user('member@e1.test');
select pg_temp.ok('顧客は公開済みを読める', (select count(*) from public.reports where id = '00000000-0000-0000-0000-00000000f001') = 1);
select pg_temp.ok('顧客は承認の履歴を読めない', (select count(*) from public.report_events) = 0);
select pg_temp.as_user('ichinose@tb.test');
update public.reports set status = 'draft' where id = '00000000-0000-0000-0000-00000000f001';
select pg_temp.ok('非公開に戻すと承認も消える', (select status = 'draft' and published_at is null and approved_by is null and submitted_by is null from public.reports where id = '00000000-0000-0000-0000-00000000f001'));
update public.reports set conclusions = '["直した結論"]', status = 'in_review' where id = '00000000-0000-0000-0000-00000000f001';
select pg_temp.denied('直したあとは承認なしで公開できない', $q$update public.reports set status = 'published' where id = '00000000-0000-0000-0000-00000000f001'$q$);
select pg_temp.as_user('member@e1.test');
select pg_temp.ok('顧客は確認待ちのレポートを読めない', (select count(*) from public.reports where id = '00000000-0000-0000-0000-00000000f001') = 0);
select pg_temp.as_user('hirakawa@tb.test');
update public.reports set status = 'draft', review_note = '結論2を言い換えてください' where id = '00000000-0000-0000-0000-00000000f001';
select pg_temp.denied('顧客・担当は履歴を書けない', $q$insert into public.report_events (report_id, action, to_status) values ('00000000-0000-0000-0000-00000000f001', 'approved', 'approved')$q$);
select pg_temp.ok('履歴: 作成→依頼→承認→公開→非公開→依頼→差し戻し',
  (select string_agg(action, ',' order by id) from public.report_events where report_id = '00000000-0000-0000-0000-00000000f001') = 'created,submitted,approved,published,unpublished,submitted,returned');
select pg_temp.ok('差し戻しの理由と差し戻した人が残る',
  (select note = '結論2を言い換えてください' and actor = 'hirakawa@tb.test' from public.report_events where report_id = '00000000-0000-0000-0000-00000000f001' and action = 'returned'));
select pg_temp.as_user('ichinose@tb.test');
update public.staff_members set can_approve = true where email = 'ichinose@tb.test';
select pg_temp.ok('担当は自分に承認権限を付けられない（RLS で0行）', not (public.airreach_me() ->> 'can_approve')::boolean);
reset role;
rollback;
\echo ALL PASS
