-- 既存の Search Console 由来の質問を無効にする処理（20261007160000_airreach_disable_gsc_prompts）のテスト
--   ローカル Postgres で実行する。本番 DB では実行しない。
--   前提: supabase/migrations の 20261007160000 までを適用済み。
--   判定の例は scripts/airreach-api/unit-google-guard.mjs（画面の判定）と同じにしている。
--   実行: psql -d <db> -v ON_ERROR_STOP=1 -f scripts/airreach-api/gsc-prompt-disable-test.sql
\set QUIET on
begin;
insert into public.staff_members (email, role) values ('staff@tb.test', 'staff');
insert into public.clients (id, name) values
  ('00000000-0000-0000-0000-0000000000b1', 'GSC あり'),
  ('00000000-0000-0000-0000-0000000000b2', 'GSC なし'),
  ('00000000-0000-0000-0000-0000000000b3', '質問なし');

create temp table fixture as select
$j${
  "studio": {
    "profile": { "brand": "炭火焼肉ハナ" },
    "measurements": [
      { "keyword": "町田 焼肉 個室", "impressions": 900, "clicks": 40, "position": 3.1, "gscProperty": "sc-domain:hana.example" },
      { "keyword": "町田 焼肉 ランチ", "impressions": "300", "clicks": 9, "position": 6 },
      { "keyword": "炭火焼肉ハナ", "impressions": 50, "clicks": 20, "position": 1 },
      { "keyword": "AI計測の行", "impressions": 0, "clicks": 0, "position": 0, "sessions": 0, "keyEvents": 0, "aiMention": 1 },
      { "url": "/lunch", "host": "hana.example", "sessions": 120, "keyEvents": 3 }
    ],
    "keywords": [ { "text": "焼肉 デート", "seed_source": "GSC" }, { "text": "町田 焼肉", "seed_source": "Site" } ],
    "prompts": [
      { "id": "a", "text": "「町田 焼肉 個室」でおすすめのところを教えて", "on": true, "src": "keyword" },
      { "id": "b", "text": "焼肉 デートでおすすめは？", "on": false, "src": "keyword", "kw": "焼肉 デート", "kwSeed": "GSC" },
      { "id": "c", "text": "町田 焼肉でおすすめは？", "on": true, "src": "keyword", "kw": "町田 焼肉", "kwSeed": "Site", "confirmed": true },
      { "id": "d", "text": "町田 焼肉 ランチのお店を教えて", "on": true, "src": "manual", "confirmed": true },
      { "id": "e", "text": "炭火焼肉ハナの評判を教えて", "on": true, "src": "branded" },
      { "id": "f", "text": "炭火焼肉ハナはどんなお店？", "on": true, "src": "" },
      { "id": "g", "text": "町田で和牛が食べられるお店は？", "on": true },
      { "id": "h", "text": "ランチでおすすめは？", "on": true, "src": "keyword", "kw": "町田 焼肉 ランチ", "kwSeed": "", "confirmed": true },
      "文字列だけの古い形"
    ]
  },
  "orch": { "lastJob": { "keywords": [ { "keyword": "町田 焼肉 ランチ", "seed_source": "GSC" } ] } }
}$j$::jsonb as d1,
$j${ "studio": { "measurements": [], "keywords": [], "prompts": [ { "id": "x", "text": "「町田 焼肉 個室」でおすすめのところを教えて", "on": true, "src": "keyword" } ] } }$j$::jsonb as d2;

insert into public.studio_workspaces (client_id, data, version, updated_by)
select '00000000-0000-0000-0000-0000000000b1'::uuid, d1, 5, 'staff@tb.test' from fixture
union all select '00000000-0000-0000-0000-0000000000b2'::uuid, d2, 2, 'staff@tb.test' from fixture
union all select '00000000-0000-0000-0000-0000000000b3'::uuid, '{"studio": {"keywords": []}}'::jsonb, 1, 'staff@tb.test';

create or replace function pg_temp.ok(p_name text, p_cond boolean) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_name; end if; raise notice 'PASS: %', p_name; end $$;
create or replace function pg_temp.denied(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then raise notice 'PASS: % (%)', p_name, sqlerrm; return; end;
  raise exception 'FAIL: % (通ってしまった)', p_name;
end $$;
create or replace function pg_temp.p(p_id text) returns jsonb language sql as $$
  select e from public.studio_workspaces w, jsonb_array_elements(w.data #> '{studio,prompts}') e
  where w.client_id = '00000000-0000-0000-0000-0000000000b1' and e ->> 'id' = p_id $$;
grant execute on function pg_temp.ok(text, boolean), pg_temp.denied(text, text) to authenticated;

-- ---- 画面からは呼べない ----
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('email', 'staff@tb.test', 'role', 'authenticated')::text, true);
select pg_temp.denied('社内の人でも画面から無効化は呼べない', $q$select public.airreach_disable_gsc_prompts()$q$);
select pg_temp.denied('社内の人でも画面から取り消しは呼べない', $q$select public.airreach_restore_gsc_prompts()$q$);
reset role;

-- ---- 無効化 ----
create temp table run1 as select public.airreach_disable_gsc_prompts() as r;
select pg_temp.ok('件数：変えた作業 1・GSC 由来 3・今回無効化 3・うち毎月測る 2',
  (select r = '{"workspaces_changed": 1, "prompts_gsc": 3, "prompts_disabled_now": 3, "prompts_monthly_disabled_now": 2}'::jsonb from run1));
select pg_temp.ok('a（古い質問・文に GSC の検索語句）→ 無効', (select p ->> 'google' = 'true' and p ->> 'on' = 'false' and p ->> 'confirmed' = 'false' and p #>> '{gscDisabled,on}' = 'true' from (select pg_temp.p('a') p) x));
select pg_temp.ok('b（GSC の語から作った質問）→ 無効（元は毎月測らない）', (select p ->> 'google' = 'true' and p ->> 'on' = 'false' and p #>> '{gscDisabled,on}' = 'false' from (select pg_temp.p('b') p) x));
select pg_temp.ok('h（出どころ不明の語が GSC の検索語句）→ 無効・確定も外す', (select p ->> 'google' = 'true' and p ->> 'on' = 'false' and p ->> 'confirmed' = 'false' and p #>> '{gscDisabled,confirmed}' = 'true' from (select pg_temp.p('h') p) x));
select pg_temp.ok('c（サイトの語）・d（担当者の入力）・e（指名）・f（社名だけの語）・g（GSC の語なし）はそのまま',
  (select bool_and(pg_temp.p(id) = (select e from fixture, jsonb_array_elements(d1 #> '{studio,prompts}') e where e ->> 'id' = id)) from unnest(array['c', 'd', 'e', 'f', 'g']) id));
select pg_temp.ok('質問の文・数・順番は変えない', (select jsonb_agg(coalesce(e ->> 'text', e #>> '{}') order by o) from public.studio_workspaces w, jsonb_array_elements(w.data #> '{studio,prompts}') with ordinality t(e, o) where w.client_id = '00000000-0000-0000-0000-0000000000b1')
  = (select jsonb_agg(coalesce(e ->> 'text', e #>> '{}') order by o) from fixture, jsonb_array_elements(d1 #> '{studio,prompts}') with ordinality t(e, o)));
select pg_temp.ok('質問のほか（Search Console の行・キーワード・分析の結果）は変えない',
  (select (w.data #- '{studio,prompts}') = (f.d1 #- '{studio,prompts}') from public.studio_workspaces w, fixture f where w.client_id = '00000000-0000-0000-0000-0000000000b1'));
select pg_temp.ok('変えた作業は版を 1 つ上げる（各パソコンが読み込み直す）', (select version = 6 and updated_by = 'system:gsc-prompt-disable' from public.studio_workspaces where client_id = '00000000-0000-0000-0000-0000000000b1'));
select pg_temp.ok('GSC のデータが無い作業は変えない（同じ文の質問でも）', (select version = 2 and data = (select d2 from fixture) from public.studio_workspaces where client_id = '00000000-0000-0000-0000-0000000000b2'));
select pg_temp.ok('質問の無い作業は変えない', (select version = 1 from public.studio_workspaces where client_id = '00000000-0000-0000-0000-0000000000b3'));

-- ---- もう一度実行しても同じ ----
create temp table run2 as select public.airreach_disable_gsc_prompts() as r;
select pg_temp.ok('2回目：何も変えない（版も上がらない）', (select r ->> 'workspaces_changed' = '0' and r ->> 'prompts_disabled_now' = '0' and r ->> 'prompts_gsc' = '3' from run2)
  and (select version = 6 from public.studio_workspaces where client_id = '00000000-0000-0000-0000-0000000000b1'));
-- 画面で毎月測るに戻されても、確定できない（google: true）。もう一度実行しても印は残る
select pg_temp.ok('無効にした質問は google: true のまま（画面でも確定できない）', (select bool_and(pg_temp.p(id) ->> 'google' = 'true') from unnest(array['a', 'b', 'h']) id));

-- ---- 取り消し ----
create temp table run3 as select public.airreach_restore_gsc_prompts() as r;
select pg_temp.ok('取り消し：3 問を元に戻す', (select r = '{"workspaces_changed": 1, "prompts_restored": 3}'::jsonb from run3));
select pg_temp.ok('取り消し：質問が元とまったく同じに戻る', (select (w.data #> '{studio,prompts}') = (f.d1 #> '{studio,prompts}') from public.studio_workspaces w, fixture f where w.client_id = '00000000-0000-0000-0000-0000000000b1'));
select pg_temp.ok('取り消し：版をもう 1 つ上げる', (select version = 7 and updated_by = 'system:gsc-prompt-restore' from public.studio_workspaces where client_id = '00000000-0000-0000-0000-0000000000b1'));
rollback;
\echo ALL PASS
