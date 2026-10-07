-- お客様からの依頼（client_requests / airreach_request_* / airreach_client_settings）のテスト
--   ローカル Postgres で実行する。本番 DB では実行しない。前提: 20261007120000 までの migration を適用済み
\set QUIET on
begin;
insert into public.staff_members (email, role) values ('s@tb.test', 'staff');
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000a1', 'A店'), ('00000000-0000-0000-0000-0000000000a2', 'B店');
insert into public.client_members (client_id, email) values ('00000000-0000-0000-0000-0000000000a1', 'm@a.test'), ('00000000-0000-0000-0000-0000000000a2', 'm@b.test'), ('00000000-0000-0000-0000-0000000000a1', 'm2@a.test');
insert into public.studio_workspaces (client_id, data, version) values ('00000000-0000-0000-0000-0000000000a1',
  '{"studio":{"competitors":[{"name":"ルミエール","url":"https://lumiere.example/"}],"keywords":[{"text":"渋谷 美容室","priority":"P0"}],"prompts":[{"text":"q1","on":true}],"profile":{"brand":"A店"},"hack2":[{"x":1}]},"orch":null}', 5);
create or replace function pg_temp.as_user(p_email text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('email', p_email, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_name; end if; raise notice 'PASS: %', p_name; end $$;
create or replace function pg_temp.denied(p_name text, p_sql text) returns void language plpgsql as $$
begin begin execute p_sql; exception when others then raise notice 'PASS: % (%)', p_name, sqlerrm; return; end; raise exception 'FAIL: % (通ってしまった)', p_name; end $$;
grant execute on function pg_temp.as_user(text), pg_temp.ok(text, boolean), pg_temp.denied(text, text) to authenticated;
\set A '''00000000-0000-0000-0000-0000000000a1'''
\set B '''00000000-0000-0000-0000-0000000000a2'''

set local role authenticated;
-- ---- お客様：いまの設定を見る ----
select pg_temp.as_user('m@a.test');
select pg_temp.ok('お客様は自社の設定を見られる（競合・キーワード・質問だけ）', (select s -> 'competitors' -> 0 ->> 'name' = 'ルミエール' and s -> 'keywords' -> 0 ->> 'text' = '渋谷 美容室' and s -> 'prompts' -> 0 ->> 'text' = 'q1' and not (s ? 'hack2') and not (s ? 'profile') from (select public.airreach_client_settings(:A) s) x));
select pg_temp.denied('お客様は他社の設定を見られない', $q$select public.airreach_client_settings('00000000-0000-0000-0000-0000000000a2')$q$);
select pg_temp.ok('お客様は Studio の作業そのものは読めない', (select count(*) from public.studio_workspaces) = 0);
-- ---- お客様：依頼する ----
select pg_temp.ok('競合の追加を依頼できる', (public.airreach_request_create(:A, 'competitor', 'add', '{"name":"  サロン ソラ ","url":"https://sora.example/"}') ->> 'ok')::boolean);
select pg_temp.ok('名前の前後の空白は取る', (select payload ->> 'name' = 'サロン ソラ' from public.client_requests where kind = 'competitor'));
select pg_temp.ok('同じ内容の依頼が待っていれば作らない（大文字小文字も同じとみなす）', not (public.airreach_request_create(:A, 'competitor', 'add', '{"name":"サロン ソラ"}') ->> 'ok')::boolean);
select pg_temp.ok('キーワードの追加を依頼できる', (public.airreach_request_create(:A, 'keyword', 'add', '{"text":"渋谷 縮毛矯正"}') ->> 'ok')::boolean);
select pg_temp.ok('質問の追加を依頼できる', (public.airreach_request_create(:A, 'prompt', 'add', '{"text":"渋谷で縮毛矯正が上手い美容室は？"}') ->> 'ok')::boolean);
select pg_temp.ok('競合の削除を依頼できる', (public.airreach_request_create(:A, 'competitor', 'remove', '{"name":"ルミエール"}') ->> 'ok')::boolean);
select pg_temp.denied('空の名前は断る', $q$select public.airreach_request_create('00000000-0000-0000-0000-0000000000a1', 'keyword', 'add', '{"text":"  "}')$q$);
select pg_temp.denied('URL の形が違えば断る', $q$select public.airreach_request_create('00000000-0000-0000-0000-0000000000a1', 'competitor', 'add', '{"name":"X","url":"javascript:alert(1)"}')$q$);
select pg_temp.denied('知らない種類は断る', $q$select public.airreach_request_create('00000000-0000-0000-0000-0000000000a1', 'client', 'add', '{"text":"x"}')$q$);
select pg_temp.denied('他社への依頼は断る', $q$select public.airreach_request_create('00000000-0000-0000-0000-0000000000a2', 'keyword', 'add', '{"text":"x"}')$q$);
select pg_temp.denied('お客様は承認できない', $q$select public.airreach_request_decide((select id from public.client_requests limit 1), true, null)$q$);
select pg_temp.denied('お客様は依頼の表に直接書けない', $q$insert into public.client_requests (client_id, kind, action, payload) values ('00000000-0000-0000-0000-0000000000a1', 'keyword', 'add', '{"text":"x"}')$q$);
select pg_temp.ok('お客様は自社の依頼を読める（4件）', (select count(*) from public.client_requests) = 4);
select pg_temp.as_user('m@b.test');
select pg_temp.ok('他社のお客様には見えない', (select count(*) from public.client_requests) = 0);
-- ---- 取り消し：本人だけ ----
select pg_temp.as_user('m2@a.test');
select pg_temp.denied('同じ会社でも、ほかの人の依頼は取り消せない', $q$select public.airreach_request_cancel((select id from public.client_requests where kind = 'keyword'))$q$);
select pg_temp.as_user('m@a.test');
select pg_temp.ok('依頼した本人は取り消せる', (public.airreach_request_cancel((select id from public.client_requests where kind = 'keyword')) ->> 'ok')::boolean);
select pg_temp.ok('取り消した依頼はもう一度取り消せない', not (public.airreach_request_cancel((select id from public.client_requests where kind = 'keyword')) ->> 'ok')::boolean);

-- ---- 社内：承認すると Studio の作業に反映 ----
select pg_temp.as_user('s@tb.test');
select pg_temp.ok('社内は全部の依頼を読める', (select count(*) from public.client_requests) = 4);
select pg_temp.ok('競合の追加を承認 → 反映', (public.airreach_request_decide((select id from public.client_requests where kind = 'competitor' and action = 'add'), true, null) ->> 'applied') = '競合に追加しました');
select pg_temp.ok('Studio の作業に競合（名前・URL・お客様から）が入り、版が上がる', (select data -> 'studio' -> 'competitors' -> 1 ->> 'name' = 'サロン ソラ' and data -> 'studio' -> 'competitors' -> 1 ->> 'src' = 'customer' and version = 6 and data -> 'studio' -> 'hack2' is not null from public.studio_workspaces where client_id = :A));
select pg_temp.ok('質問の追加を承認 → 毎月測る質問に（10問未満）', (public.airreach_request_decide((select id from public.client_requests where kind = 'prompt'), true, null) ->> 'applied') = '毎月測る質問に追加しました');
select pg_temp.ok('競合の削除を承認', (public.airreach_request_decide((select id from public.client_requests where kind = 'competitor' and action = 'remove'), true, null) ->> 'applied') = '競合から外しました');
select pg_temp.ok('外した競合は Studio の作業から消える（ほかは残る）', (select data -> 'studio' -> 'competitors' = '[{"src": "customer", "url": "https://sora.example/", "name": "サロン ソラ"}]'::jsonb from public.studio_workspaces where client_id = :A));
select pg_temp.ok('承認した依頼は「承認済み」・反映の内容と承認した人が残る', (select bool_and(status = 'approved' and decided_by = 's@tb.test' and decision_note is not null) from public.client_requests where status <> 'cancelled'));
select pg_temp.ok('済んだ依頼はもう一度承認できない', not (public.airreach_request_decide((select id from public.client_requests where kind = 'prompt'), true, null) ->> 'ok')::boolean);
-- 見送り（理由つき）
select public.airreach_request_create(:A, 'keyword', 'add', '{"text":"渋谷 激安"}');
select pg_temp.ok('見送れる', (public.airreach_request_decide((select id from public.client_requests where payload ->> 'text' = '渋谷 激安'), false, '価格訴求の言葉は対策しない方針のため') ->> 'status') = 'rejected');
select pg_temp.ok('見送ると反映しない・理由が残る', (select decision_note from public.client_requests where payload ->> 'text' = '渋谷 激安') = '価格訴求の言葉は対策しない方針のため'
  and not exists (select 1 from public.studio_workspaces w, jsonb_array_elements(w.data -> 'studio' -> 'keywords') k where k ->> 'text' = '渋谷 激安'));
-- 質問：毎月測る10問が埋まっていれば候補に
reset role;
update public.studio_workspaces set data = jsonb_set(data, '{studio,prompts}', (select jsonb_agg(jsonb_build_object('text', 'q' || g, 'on', true)) from generate_series(1, 10) g)) where client_id = :A;
set local role authenticated;
select public.airreach_request_create(:A, 'prompt', 'add', '{"text":"11問目"}');
select pg_temp.ok('毎月測る質問が10問なら候補として承認', (public.airreach_request_decide((select id from public.client_requests where payload ->> 'text' = '11問目'), true, null) ->> 'applied') like '%候補に追加しました%');
select pg_temp.ok('11問目は測らない候補（on=false）で入る', (select (p ->> 'on')::boolean = false from public.studio_workspaces w, jsonb_array_elements(w.data -> 'studio' -> 'prompts') p where p ->> 'text' = '11問目'));
-- キーワードの追加と削除（お客様の依頼を承認）
select pg_temp.as_user('m@a.test');
select public.airreach_request_create(:A, 'keyword', 'add', '{"text":"渋谷 縮毛矯正"}');
select pg_temp.as_user('s@tb.test');
select public.airreach_request_decide((select id from public.client_requests where payload ->> 'text' = '渋谷 縮毛矯正' and status = 'pending'), true, null);
select pg_temp.ok('キーワードを追加（P1・お客様から）', (select k ->> 'priority' = 'P1' and k ->> 'src' = 'customer' from public.studio_workspaces w, jsonb_array_elements(w.data -> 'studio' -> 'keywords') k where k ->> 'text' = '渋谷 縮毛矯正'));
-- 社内が直接追加したものは「お客様から」にしない
select public.airreach_request_create(:A, 'keyword', 'add', '{"text":"渋谷 ヘッドスパ"}');
select public.airreach_request_decide((select id from public.client_requests where payload ->> 'text' = '渋谷 ヘッドスパ'), true, null);
select pg_temp.ok('社内が直接追加したキーワードは src=staff', (select k ->> 'src' = 'staff' and k ->> 'why' like 'ダッシュボードから追加%' from public.studio_workspaces w, jsonb_array_elements(w.data -> 'studio' -> 'keywords') k where k ->> 'text' = '渋谷 ヘッドスパ'));
select public.airreach_request_create(:A, 'keyword', 'remove', '{"text":"渋谷 美容室"}');
select public.airreach_request_decide((select id from public.client_requests where payload ->> 'text' = '渋谷 美容室'), true, null);
select pg_temp.ok('キーワードを外す', not exists (select 1 from public.studio_workspaces w, jsonb_array_elements(w.data -> 'studio' -> 'keywords') k where k ->> 'text' = '渋谷 美容室'));
-- Studio の作業が無い顧客：承認すると作る
select public.airreach_request_create(:B, 'competitor', 'add', '{"name":"C社"}');
select pg_temp.ok('Studio の作業が無い顧客でも承認できる', (public.airreach_request_decide((select id from public.client_requests where client_id = :B), true, null) ->> 'ok')::boolean);
select pg_temp.ok('承認したときに Studio の作業を作る', (select version = 1 and data -> 'studio' -> 'competitors' -> 0 ->> 'name' = 'C社' from public.studio_workspaces where client_id = :B));
-- 補足（20261007190000 を適用したとき）
select pg_temp.as_user('m@a.test');
select pg_temp.ok('補足つきで依頼できる', (public.airreach_request_create(:A, 'keyword', 'add', '{"text":"渋谷 白髪染め"}', '  白髪染めのお客様が増えているため  ') ->> 'ok')::boolean);
select pg_temp.ok('補足の前後の空白は取る', (select note = '白髪染めのお客様が増えているため' from public.client_requests where payload ->> 'text' = '渋谷 白髪染め'));
select pg_temp.ok('空の補足でも依頼できる', (public.airreach_request_create(:A, 'keyword', 'add', '{"text":"渋谷 トリートメント"}', '   ') ->> 'ok')::boolean);
select pg_temp.ok('空の補足は付けない（null）', (select note is null from public.client_requests where payload ->> 'text' = '渋谷 トリートメント'));
select pg_temp.denied('補足は500文字まで', $q$select public.airreach_request_create('00000000-0000-0000-0000-0000000000a1', 'keyword', 'add', '{"text":"x1"}', repeat('あ', 501))$q$);
select pg_temp.ok('補足なしの4つの引数の呼び出しもそのまま使える', (public.airreach_request_create(:A, 'keyword', 'add', '{"text":"渋谷 前髪カット"}') ->> 'ok')::boolean);
select pg_temp.as_user('m@b.test');
select pg_temp.ok('他社のお客様には補足も見えない', (select count(*) from public.client_requests where note is not null) = 0);
select pg_temp.as_user('s@tb.test');
select public.airreach_request_cancel(id) from public.client_requests where client_id = :A and status = 'pending';
-- 待っている依頼は30件まで
select public.airreach_request_create(:A, 'keyword', 'add', json_build_object('text', 'kw' || g)::jsonb) from generate_series(1, 30) g;
select pg_temp.ok('確認待ちが30件あれば新しい依頼は断る', (select count(*) from public.client_requests where client_id = :A and status = 'pending') = 30 and not (public.airreach_request_create(:A, 'keyword', 'add', '{"text":"31件目"}') ->> 'ok')::boolean);
reset role;
-- ---- anon・service_role は何もできない ----
set local role anon;
select pg_temp.denied('anon は依頼の表を読めない', 'select count(*) from public.client_requests');
reset role;
rollback;
\echo ALL PASS
