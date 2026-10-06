-- ============================================================================
-- AirReach: 既存の Studio の質問のうち、Search Console 由来のものを AI計測に使わない状態にする（2026-10-06・Google OAuth の審査対応）
-- Target : AirReach 専用 Supabase Project のみ（Hack2 Project には適用しない）
-- Depends: 20261003120000_airreach_studio_workspaces.sql
--
-- 何をするか
--   studio_workspaces.data.studio.prompts の各質問を、画面の判定（assets/js/airreach-google-guard.js の
--   isGoogleDerivedPrompt）と同じ条件で調べ、Search Console 由来の質問を次の状態にする:
--     google: true（確定できない・外部の AI に送れない）、confirmed: false、on: false（毎月測らない）
--   元の状態（on・confirmed・google）は、その質問の中の gscDisabled に残す（取り消し用。質問文はほかへ写さない）。
--   変えた作業は version を 1 つ上げる（各パソコンの Studio が開いたときに、この内容を読み込み直すため）。
--   AI計測の記録（measurement_runs）・Search Console の行・キーワードには触らない。質問は消さない。
--
-- 何度実行しても同じ結果になる（gscDisabled がある質問はそのまま）。出力は件数だけ（質問文・検索語句は出さない）。
-- 取り消し: supabase/rollback/20261007140000_airreach_disable_gsc_prompts_rollback.sql
-- ============================================================================

-- 比べるための形（空白・鉤括弧を除く）。airreach-google-guard.js の norm と同じ
create or replace function public.airreach_gsc_norm(p_text text)
returns text
language sql immutable
set search_path = ''
as $$
  select regexp_replace(coalesce(p_text, ''), '[\s　「」『』]+', '', 'g');
$$;

-- 数字に直せないときは 0（"" や文字が入っていても止まらない）
create or replace function public.airreach_gsc_num(p_v jsonb)
returns numeric
language sql immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_v) = 'number' then (p_v #>> '{}')::numeric
    when jsonb_typeof(p_v) = 'string' and (p_v #>> '{}') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then btrim(p_v #>> '{}')::numeric
    else 0 end;
$$;

-- この作業にある Search Console の検索語句（airreach-google-guard.js の gscQuerySet と同じ）
create or replace function public.airreach_gsc_queries(p_data jsonb)
returns text[]
language sql immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct q), '{}'::text[]) from (
    select public.airreach_gsc_norm(coalesce(m ->> 'keyword', m ->> 'query')) as q
    from jsonb_array_elements(case when jsonb_typeof(p_data #> '{studio,measurements}') = 'array' then p_data #> '{studio,measurements}' else '[]'::jsonb end) m
    where jsonb_typeof(m) = 'object'
      and public.airreach_gsc_num(m -> 'sessions') = 0 and public.airreach_gsc_num(m -> 'keyEvents') = 0
      and (m ->> 'source' in ('gsc', 'ga4') or m ? 'gscProperty' or m ? 'ga4Property'
           or public.airreach_gsc_num(m -> 'impressions') > 0 or public.airreach_gsc_num(m -> 'clicks') > 0 or public.airreach_gsc_num(m -> 'position') > 0)
    union all
    select public.airreach_gsc_norm(coalesce(k ->> 'text', k ->> 'keyword'))
    from jsonb_array_elements(case when jsonb_typeof(p_data #> '{studio,keywords}') = 'array' then p_data #> '{studio,keywords}' else '[]'::jsonb end) k
    where jsonb_typeof(k) = 'object' and (k ->> 'seed_source' = 'GSC' or k ->> 'source' = 'gsc' or k ->> 'cluster' = 'GSC')
    union all
    select public.airreach_gsc_norm(coalesce(k ->> 'keyword', k ->> 'text'))
    from jsonb_array_elements(case when jsonb_typeof(p_data #> '{orch,lastJob,keywords}') = 'array' then p_data #> '{orch,lastJob,keywords}' else '[]'::jsonb end) k
    where jsonb_typeof(k) = 'object' and (k ->> 'seed_source' = 'GSC' or k ->> 'source' = 'gsc' or k ->> 'cluster' = 'GSC')
  ) x where length(q) >= 2;
$$;

-- Search Console 由来の質問か（airreach-google-guard.js の isGoogleDerivedPrompt と同じ）
create or replace function public.airreach_is_gsc_prompt(p jsonb, p_gsc text[], p_brand text)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  v_src text;
  v_text text;
begin
  if jsonb_typeof(p) is distinct from 'object' then return false; end if;
  if p ->> 'google' = 'true' or p ->> 'src' = 'gsc' then return true; end if;
  v_src := coalesce(p ->> 'src', '');
  if v_src in ('manual', 'customer', 'branded') then return false; end if;
  if p ? 'kw' and jsonb_typeof(p -> 'kw') <> 'null' then
    if p ->> 'kwSeed' = 'GSC' then return true; end if;
    if coalesce(p ->> 'kwSeed', '') <> '' then return false; end if;
    return public.airreach_gsc_norm(p ->> 'kw') = any (p_gsc);
  end if;
  v_text := public.airreach_gsc_norm(coalesce(p ->> 'text', p ->> 'prompt'));
  if v_text = '' then return false; end if;
  if v_text = any (p_gsc) then return true; end if;
  return exists (
    select 1 from unnest(p_gsc) q
    where position(q in v_text) > 0 and not (coalesce(p_brand, '') <> '' and position(q in p_brand) > 0)
  );
end;
$$;

-- 無効化（本体）。戻り値は件数だけ
create or replace function public.airreach_disable_gsc_prompts()
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  r record;
  v_gsc text[];
  v_brand text;
  v_new jsonb;
  v_flagged integer;
  v_now integer;
  v_monthly integer;
  t_ws integer := 0;
  t_flagged integer := 0;
  t_now integer := 0;
  t_monthly integer := 0;
begin
  for r in
    select client_id, data from public.studio_workspaces
    where jsonb_typeof(data #> '{studio,prompts}') = 'array'
    order by client_id
    for update
  loop
    v_gsc := public.airreach_gsc_queries(r.data);
    v_brand := public.airreach_gsc_norm(r.data #>> '{studio,profile,brand}');
    select
      coalesce(jsonb_agg(
        case when f.flag and not (f.p ? 'gscDisabled') then
          (f.p - 'gscDisabled') || jsonb_build_object(
            'google', true, 'confirmed', false, 'on', false,
            'gscDisabled', jsonb_build_object('at', now(), 'on', coalesce(f.p -> 'on', 'null'::jsonb), 'confirmed', coalesce(f.p -> 'confirmed', 'null'::jsonb), 'google', coalesce(f.p -> 'google', 'null'::jsonb)))
        else f.p end
        order by f.o), '[]'::jsonb),
      count(*) filter (where f.flag),
      count(*) filter (where f.flag and not (f.p ? 'gscDisabled')),
      count(*) filter (where f.flag and not (f.p ? 'gscDisabled') and (f.p ->> 'on') is distinct from 'false')
    into v_new, v_flagged, v_now, v_monthly
    from (
      select e.p, e.o, public.airreach_is_gsc_prompt(e.p, v_gsc, v_brand) as flag
      from jsonb_array_elements(r.data #> '{studio,prompts}') with ordinality as e(p, o)
    ) f;
    t_flagged := t_flagged + v_flagged;
    t_monthly := t_monthly + v_monthly;
    if v_now > 0 then
      update public.studio_workspaces
        set data = jsonb_set(data, '{studio,prompts}', v_new), version = version + 1, updated_by = 'system:gsc-prompt-disable', updated_at = now()
        where client_id = r.client_id;
      t_ws := t_ws + 1;
      t_now := t_now + v_now;
    end if;
  end loop;
  return jsonb_build_object('workspaces_changed', t_ws, 'prompts_gsc', t_flagged, 'prompts_disabled_now', t_now, 'prompts_monthly_disabled_now', t_monthly);
end;
$$;

-- 取り消し（rollback から呼ぶ）。gscDisabled に残した元の状態に戻す
create or replace function public.airreach_restore_gsc_prompts()
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  r record;
  v_new jsonb;
  v_n integer;
  t_ws integer := 0;
  t_n integer := 0;
begin
  for r in
    select client_id, data from public.studio_workspaces
    where jsonb_typeof(data #> '{studio,prompts}') = 'array'
    order by client_id
    for update
  loop
    select
      coalesce(jsonb_agg(
        case when e.p ? 'gscDisabled' then
          (e.p - 'gscDisabled' - 'on' - 'confirmed' - 'google')
          || jsonb_strip_nulls(jsonb_build_object('on', e.p #> '{gscDisabled,on}', 'confirmed', e.p #> '{gscDisabled,confirmed}', 'google', e.p #> '{gscDisabled,google}'))
        else e.p end
        order by e.o), '[]'::jsonb),
      count(*) filter (where e.p ? 'gscDisabled')
    into v_new, v_n
    from jsonb_array_elements(r.data #> '{studio,prompts}') with ordinality as e(p, o);
    if v_n > 0 then
      update public.studio_workspaces
        set data = jsonb_set(data, '{studio,prompts}', v_new), version = version + 1, updated_by = 'system:gsc-prompt-restore', updated_at = now()
        where client_id = r.client_id;
      t_ws := t_ws + 1;
      t_n := t_n + v_n;
    end if;
  end loop;
  return jsonb_build_object('workspaces_changed', t_ws, 'prompts_restored', t_n);
end;
$$;

revoke all on function public.airreach_gsc_norm(text), public.airreach_gsc_num(jsonb), public.airreach_gsc_queries(jsonb),
  public.airreach_is_gsc_prompt(jsonb, text[], text), public.airreach_disable_gsc_prompts(), public.airreach_restore_gsc_prompts()
  from public, anon, authenticated, service_role;

-- 適用したときに 1 回実行する（件数は NOTICE に出す。質問文は出さない）
do $$
declare v jsonb;
begin
  v := public.airreach_disable_gsc_prompts();
  raise notice 'airreach_disable_gsc_prompts: %', v;
end;
$$;
