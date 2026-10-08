-- ご判断へのお返事（20261009130000_airreach_decision_replies）のテスト。ローカル Postgres で実行する。本番 DB では実行しない
\set QUIET on
begin;
insert into public.partner_orgs (id, name) values ('00000000-0000-0000-0000-0000000000f1', '共同会社1');
insert into public.staff_members (email, role, org_id, can_approve) values ('tb@tb.test', 'staff', null, false), ('p1@p1.test', 'staff', '00000000-0000-0000-0000-0000000000f1', false);
insert into public.clients (id, name, org_id) values
  ('00000000-0000-0000-0000-0000000000a0', 'TBの顧客', null),
  ('00000000-0000-0000-0000-0000000000a1', 'もう1社', null);
insert into public.client_members (client_id, email) values ('00000000-0000-0000-0000-0000000000a0', 'owner@c0.test'), ('00000000-0000-0000-0000-0000000000a1', 'owner@c1.test');
-- 公開の手順（承認者・トリガー）は別のテストで確かめているので、ここではトリガーを止めて公開済みの行を直接作る
alter table public.reports disable trigger user;
insert into public.reports (id, client_id, period_month, status, published_at, client_decisions, compiled) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000a0', '2026-10-01', 'published', now(), '["縮毛矯正の料金（16,500円〜）を載せてよいか", "駐車場の案内を載せてよいか"]', '{}'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000a0', '2026-11-01', 'draft', null, '["下書きの項目"]', '{}');
alter table public.reports enable trigger user;
create or replace function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('email', p_email, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_name; end if; raise notice 'PASS: %', p_name; end $$;
create or replace function pg_temp.denied(p_name text, p_sql text) returns void language plpgsql as $$
begin begin execute p_sql; exception when others then raise notice 'PASS: % (%)', p_name, sqlerrm; return; end; raise exception 'FAIL: % (通ってしまった)', p_name; end $$;
grant execute on function pg_temp.ok(text, boolean), pg_temp.denied(text, text), pg_temp.as_user(text) to authenticated;
set local role authenticated;

select pg_temp.as_user('owner@c0.test');
select pg_temp.ok('お客様：「このまま進めてよい」を返せる（補足は任意）', (public.airreach_decision_reply('00000000-0000-0000-0000-00000000e001', 0, 'ok', null) ->> 'ok')::boolean);
select pg_temp.ok('返事は kind=decision・action=ok で、項目の文はレポートから取る', (select count(*) = 1 and bool_and(action = 'ok' and payload ->> 'text' = '縮毛矯正の料金（16,500円〜）を載せてよいか' and requested_by = 'owner@c0.test' and status = 'pending') from public.client_requests where kind = 'decision'));
select pg_temp.denied('「直して返す」は直してほしい点が無いと送れない', $q$select public.airreach_decision_reply('00000000-0000-0000-0000-00000000e001', 0, 'revise', '  ')$q$);
select pg_temp.ok('返事のし直しを送れる', (public.airreach_decision_reply('00000000-0000-0000-0000-00000000e001', 0, 'revise', '料金は 17,600円〜 です') ->> 'ok')::boolean);
select pg_temp.ok('同じ項目に返事をし直すと、前の確認前の返事は取り消しになる', (select count(*) filter (where status = 'pending') = 1 and count(*) filter (where status = 'cancelled') = 1 from public.client_requests where kind = 'decision'));
select pg_temp.ok('ほかの項目にも返事できる', (public.airreach_decision_reply('00000000-0000-0000-0000-00000000e001', 1, 'ok', null) ->> 'ok')::boolean);
select pg_temp.ok('ほかの項目の返事は別に残る', (select count(*) = 2 from public.client_requests where kind = 'decision' and status = 'pending'));
select pg_temp.denied('項目の番号が範囲外なら送れない', $q$select public.airreach_decision_reply('00000000-0000-0000-0000-00000000e001', 2, 'ok', null)$q$);
select pg_temp.denied('決まっていない返事（ok / revise 以外）は送れない', $q$select public.airreach_decision_reply('00000000-0000-0000-0000-00000000e001', 0, 'add', null)$q$);
select pg_temp.denied('公開前（下書き）のレポートには返事できない', $q$select public.airreach_decision_reply('00000000-0000-0000-0000-00000000e002', 0, 'ok', null)$q$);
select pg_temp.denied('お返事は500文字まで', $q$select public.airreach_decision_reply('00000000-0000-0000-0000-00000000e001', 0, 'revise', repeat('あ', 501))$q$);
select pg_temp.denied('お客様は表に直接書けない（RPC だけ）', $q$insert into public.client_requests (client_id, kind, action, payload) values ('00000000-0000-0000-0000-0000000000a0', 'decision', 'ok', '{}')$q$);
select pg_temp.ok('お客様は確認前の自分の返事を取り消せる', (public.airreach_request_cancel((select id from public.client_requests where kind = 'decision' and status = 'pending' and (payload ->> 'index') = '1')) ->> 'ok')::boolean);

select pg_temp.as_user('owner@c1.test');
select pg_temp.denied('ほかの顧客のお客様は、そのレポートに返事できない', $q$select public.airreach_decision_reply('00000000-0000-0000-0000-00000000e001', 0, 'ok', null)$q$);
select pg_temp.ok('ほかの顧客のお客様には、返事が見えない', (select count(*) = 0 from public.client_requests where kind = 'decision'));

select pg_temp.as_user('p1@p1.test');
select pg_temp.denied('共同会社の人は、担当でない顧客の返事を確認できない', $q$select public.airreach_request_decide((select id from public.client_requests where kind = 'decision' and status = 'pending' limit 1), true, null)$q$);

select pg_temp.as_user('tb@tb.test');
select pg_temp.ok('担当者が「確認した」：状態は反映済み', (public.airreach_request_decide((select id from public.client_requests where kind = 'decision' and status = 'pending' limit 1), true, null) ->> 'status') = 'approved');
select pg_temp.ok('Studio の作業は作らない・記録は「担当者が確認しました」', (select count(*) = 0 from public.studio_workspaces) and (select decision_note = '担当者が確認しました' from public.client_requests where kind = 'decision' and status = 'approved'));
select pg_temp.ok('もう一度返事', (public.airreach_decision_reply('00000000-0000-0000-0000-00000000e001', 1, 'ok', null) ->> 'ok')::boolean);
select pg_temp.ok('「見送る」を押しても、ご判断の返事は確認済みとして残る（見送りにしない）', (public.airreach_request_decide((select id from public.client_requests where kind = 'decision' and status = 'pending' limit 1), false, '') ->> 'status') = 'approved');
select pg_temp.ok('これまでの種類（競合の追加）は今までどおり反映される', (public.airreach_request_decide((public.airreach_request_create('00000000-0000-0000-0000-0000000000a0', 'competitor', 'add', '{"name":"サンプル店"}') ->> 'id')::uuid, true, null) ->> 'applied') = '競合に追加しました');
select pg_temp.denied('種類と動作の組み合わせが合わない行は作れない（競合に ok）', $q$select public.airreach_request_create('00000000-0000-0000-0000-0000000000a0', 'competitor', 'ok', '{"name":"x"}')$q$);
reset role;
select pg_temp.denied('表の制約：decision に add は入らない', $q$insert into public.client_requests (client_id, kind, action, payload) values ('00000000-0000-0000-0000-0000000000a0', 'decision', 'add', '{}')$q$);
select pg_temp.ok('anon は返事の関数を呼べない', not has_function_privilege('anon', 'public.airreach_decision_reply(uuid, integer, text, text)', 'execute'));
select 'ALL PASSED' as result;
rollback;
