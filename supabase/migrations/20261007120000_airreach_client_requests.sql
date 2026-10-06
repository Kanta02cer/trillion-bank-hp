-- ============================================================================
-- AirReach: お客様からの追加・削除の依頼（競合・キーワード・計測する質問）（2026-10-07）
--   お客様は、ホームで「いま設定している競合・キーワード・質問」を見て、追加・削除を依頼できる。
--   担当者が承認すると、Studio の作業（studio_workspaces.data.studio）にそのまま反映する。見送ると理由を残す。
--
--   - 依頼（client_requests）は、その顧客のお客様と社内が読める。書き込みは RPC だけ
--   - お客様が見られる設定は airreach_client_settings() が返すものだけ（Studio の作業そのものは社内だけ）
--   - 反映は版（version）を上げる。Studio を開いている人には「最新を読み込む」が出る
--   - 依頼の乱用を防ぐ：顧客ごとに待っている依頼は30件まで・同じ内容の依頼が待っていれば作らない・文字数の上限
--   取り消し: supabase/rollback/20261007120000_airreach_client_requests_rollback.sql
-- ============================================================================
create table if not exists public.client_requests (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  kind          text not null,
  action        text not null,
  payload       jsonb not null,
  status        text not null default 'pending',
  requested_by  text,
  requested_at  timestamptz not null default now(),
  decided_by    text,
  decided_at    timestamptz,
  decision_note text,
  constraint client_requests_kind_check   check (kind in ('competitor', 'keyword', 'prompt')),
  constraint client_requests_action_check check (action in ('add', 'remove')),
  constraint client_requests_status_check check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  constraint client_requests_payload_check check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2000),
  constraint client_requests_note_check   check (decision_note is null or length(decision_note) <= 500)
);
comment on table public.client_requests is 'お客様からの追加・削除の依頼（競合・キーワード・計測する質問）。担当者が承認すると Studio の作業に反映する';
create index if not exists client_requests_client_idx on public.client_requests (client_id, requested_at desc);
create index if not exists client_requests_pending_idx on public.client_requests (status) where status = 'pending';

alter table public.client_requests enable row level security;
drop policy if exists client_requests_select on public.client_requests;
create policy client_requests_select on public.client_requests for select to authenticated
  using (public.airreach_is_staff() or public.airreach_is_member(client_id));
revoke all on table public.client_requests from anon, authenticated, service_role;
grant select on table public.client_requests to authenticated;

-- 依頼の中身を整える（名前・URL・言葉）。正しくなければ例外
create or replace function public.airreach_request_payload(p_kind text, p_payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := btrim(coalesce(p_payload ->> 'text', p_payload ->> 'name', ''));
  v_url  text := btrim(coalesce(p_payload ->> 'url', ''));
begin
  v_text := regexp_replace(v_text, '\s+', ' ', 'g');
  if length(v_text) < 1 then raise exception '名前・言葉を入れてください' using errcode = '22023'; end if;
  if p_kind = 'competitor' then
    if length(v_text) > 80 then raise exception '競合の名前は80文字までです' using errcode = '22023'; end if;
    if v_url <> '' and (length(v_url) > 300 or v_url !~* '^https?://[^\s/]+\.[^\s]+$') then raise exception 'サイトの URL は https:// から入れてください' using errcode = '22023'; end if;
    return jsonb_build_object('name', v_text, 'url', nullif(v_url, ''));
  elsif p_kind = 'keyword' then
    if length(v_text) > 60 then raise exception 'キーワードは60文字までです' using errcode = '22023'; end if;
    return jsonb_build_object('text', v_text);
  else
    if length(v_text) > 200 then raise exception '質問は200文字までです' using errcode = '22023'; end if;
    return jsonb_build_object('text', v_text);
  end if;
end;
$$;

-- いまの設定（お客様に見せてよいもの）：競合（名前・URL）・キーワード（言葉と優先度・最大50）・毎月測る質問と候補
create or replace function public.airreach_client_settings(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_st jsonb;
begin
  if not (public.airreach_is_staff() or public.airreach_is_member(p_client_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select w.data -> 'studio' into v_st from public.studio_workspaces w where w.client_id = p_client_id;
  v_st := coalesce(v_st, '{}'::jsonb);
  return jsonb_build_object(
    'competitors', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(nullif(c ->> 'name', ''), c ->> 'url'), 'url', nullif(c ->> 'url', '')))
                               from jsonb_array_elements(case when jsonb_typeof(v_st -> 'competitors') = 'array' then v_st -> 'competitors' else '[]'::jsonb end) c
                              where coalesce(nullif(c ->> 'name', ''), c ->> 'url') is not null), '[]'::jsonb),
    'keywords', coalesce((select jsonb_agg(jsonb_build_object('text', k ->> 'text', 'priority', k ->> 'priority', 'customer', (k ->> 'src') = 'customer') order by ord)
                            from (select k, ord from jsonb_array_elements(case when jsonb_typeof(v_st -> 'keywords') = 'array' then v_st -> 'keywords' else '[]'::jsonb end) with ordinality as t(k, ord)
                                  where coalesce(k ->> 'text', '') <> '' order by (k ->> 'priority') nulls last, ord limit 50) x), '[]'::jsonb),
    'prompts', coalesce((select jsonb_agg(jsonb_build_object('text', p ->> 'text', 'on', coalesce((p ->> 'on')::boolean, true)) order by ord)
                           from jsonb_array_elements(case when jsonb_typeof(v_st -> 'prompts') = 'array' then v_st -> 'prompts' else '[]'::jsonb end) with ordinality as t(p, ord)
                          where coalesce(p ->> 'text', '') <> ''), '[]'::jsonb)
  );
end;
$$;

-- 依頼する（お客様・社内）
create or replace function public.airreach_request_create(p_client_id uuid, p_kind text, p_action text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.airreach_jwt_email();
  v_payload jsonb;
  v_key text;
  v_id uuid;
begin
  if not (public.airreach_is_staff() or public.airreach_is_member(p_client_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind not in ('competitor', 'keyword', 'prompt') or p_action not in ('add', 'remove') then
    raise exception 'bad request' using errcode = '22023';
  end if;
  v_payload := public.airreach_request_payload(p_kind, p_payload);
  v_key := lower(coalesce(v_payload ->> 'name', v_payload ->> 'text'));
  -- 同じ顧客の依頼を1件ずつ確かめる（同時に送っても上限と重複の確かめが崩れないように）
  perform 1 from public.clients where id = p_client_id for update;
  if (select count(*) from public.client_requests where client_id = p_client_id and status = 'pending') >= 30 then
    return jsonb_build_object('ok', false, 'reason', '確認待ちの依頼が30件あります。担当者の確認をお待ちください');
  end if;
  if exists (select 1 from public.client_requests r where r.client_id = p_client_id and r.status = 'pending' and r.kind = p_kind and r.action = p_action
             and lower(coalesce(r.payload ->> 'name', r.payload ->> 'text')) = v_key) then
    return jsonb_build_object('ok', false, 'reason', '同じ内容の依頼が確認待ちです');
  end if;
  insert into public.client_requests (client_id, kind, action, payload, requested_by)
  values (p_client_id, p_kind, p_action, v_payload, nullif(v_email, ''))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- 依頼を取り消す（依頼した本人・社内。確認待ちのものだけ）
create or replace function public.airreach_request_cancel(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.client_requests;
begin
  select * into r from public.client_requests where id = p_id for update;
  if not found then raise exception 'not found' using errcode = '22023'; end if;
  if not (public.airreach_is_staff() or (public.airreach_is_member(r.client_id) and r.requested_by = public.airreach_jwt_email())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', 'もう確認が済んでいます'); end if;
  update public.client_requests set status = 'cancelled', decided_by = nullif(public.airreach_jwt_email(), ''), decided_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- 担当者が承認・見送り（社内だけ）。承認すると Studio の作業に反映する
create or replace function public.airreach_request_decide(p_id uuid, p_approve boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.airreach_jwt_email();
  r public.client_requests;
  w public.studio_workspaces;
  v_st jsonb;
  v_arr jsonb;
  v_key text;
  v_on integer;
  v_applied text;
  v_src text;
begin
  if not public.airreach_is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into r from public.client_requests where id = p_id for update;
  if not found then raise exception 'not found' using errcode = '22023'; end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', 'もう確認が済んでいます（' || r.status || '）'); end if;
  if not coalesce(p_approve, false) then
    update public.client_requests set status = 'rejected', decided_by = nullif(v_email, ''), decided_at = now(), decision_note = left(nullif(btrim(coalesce(p_note, '')), ''), 500) where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  -- Studio の作業をロックして書き換える（無ければ作る）
  select * into w from public.studio_workspaces where client_id = r.client_id for update;
  v_st := coalesce(case when found then w.data -> 'studio' end, '{}'::jsonb);
  if jsonb_typeof(v_st) <> 'object' then v_st := '{}'::jsonb; end if;
  v_key := lower(coalesce(r.payload ->> 'name', r.payload ->> 'text'));
  -- 社内が直接追加したものは 'staff'、お客様の依頼は 'customer'（画面の「ご依頼」の印に使う）
  v_src := case when exists (select 1 from public.staff_members s where s.email = r.requested_by) then 'staff' else 'customer' end;

  if r.kind = 'competitor' then
    v_arr := case when jsonb_typeof(v_st -> 'competitors') = 'array' then v_st -> 'competitors' else '[]'::jsonb end;
    if r.action = 'add' then
      if exists (select 1 from jsonb_array_elements(v_arr) c where lower(coalesce(c ->> 'name', '')) = v_key) then v_applied := 'すでに登録されていました';
      else v_arr := v_arr || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('name', r.payload ->> 'name', 'url', r.payload ->> 'url', 'src', v_src))); v_applied := '競合に追加しました'; end if;
    else
      v_arr := coalesce((select jsonb_agg(c) from jsonb_array_elements(v_arr) c where lower(coalesce(nullif(c ->> 'name', ''), c ->> 'url', '')) <> v_key), '[]'::jsonb); v_applied := '競合から外しました';
    end if;
    v_st := jsonb_set(v_st, '{competitors}', v_arr);
  elsif r.kind = 'keyword' then
    v_arr := case when jsonb_typeof(v_st -> 'keywords') = 'array' then v_st -> 'keywords' else '[]'::jsonb end;
    if r.action = 'add' then
      if exists (select 1 from jsonb_array_elements(v_arr) k where lower(coalesce(k ->> 'text', '')) = v_key) then v_applied := 'すでに登録されていました';
      else v_arr := v_arr || jsonb_build_array(jsonb_build_object('id', 'cust' || substr(md5(r.id::text), 1, 10), 'text', r.payload ->> 'text', 'priority', 'P1', 'cluster', 'Customer', 'status', '未対策',
                    'intent', '', 'action', '', 'why', case when v_src = 'customer' then 'お客様からの追加（' else 'ダッシュボードから追加（' end || to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM-DD') || ' 承認）', 'src', v_src)); v_applied := 'キーワードに追加しました'; end if;
    else
      v_arr := coalesce((select jsonb_agg(k) from jsonb_array_elements(v_arr) k where lower(coalesce(k ->> 'text', '')) <> v_key), '[]'::jsonb); v_applied := 'キーワードから外しました';
    end if;
    v_st := jsonb_set(v_st, '{keywords}', v_arr);
  else
    v_arr := case when jsonb_typeof(v_st -> 'prompts') = 'array' then v_st -> 'prompts' else '[]'::jsonb end;
    if r.action = 'add' then
      if exists (select 1 from jsonb_array_elements(v_arr) p where lower(coalesce(p ->> 'text', '')) = v_key) then v_applied := 'すでに登録されていました';
      else
        -- 毎月測る質問は10問まで。空きがあれば毎月測る質問に、無ければ候補に入れる
        select count(*) into v_on from jsonb_array_elements(v_arr) p where coalesce((p ->> 'on')::boolean, true);
        v_arr := v_arr || jsonb_build_array(jsonb_build_object('id', 'cust' || substr(md5(r.id::text), 1, 10), 'text', r.payload ->> 'text', 'on', v_on < 10, 'src', v_src));
        v_applied := case when v_on < 10 then '毎月測る質問に追加しました' else '毎月測る質問が10問あるため、候補に追加しました（入れ替えは Studio で）' end;
      end if;
    else
      v_arr := coalesce((select jsonb_agg(p) from jsonb_array_elements(v_arr) p where lower(coalesce(p ->> 'text', '')) <> v_key), '[]'::jsonb); v_applied := '質問から外しました';
    end if;
    v_st := jsonb_set(v_st, '{prompts}', v_arr);
  end if;

  if w.client_id is null then
    insert into public.studio_workspaces (client_id, data, version, updated_by, updated_at)
    values (r.client_id, jsonb_build_object('studio', v_st, 'orch', null), 1, nullif(v_email, ''), now());
  else
    update public.studio_workspaces set data = jsonb_set(coalesce(data, '{}'::jsonb), '{studio}', v_st), version = version + 1, updated_by = nullif(v_email, ''), updated_at = now()
      where client_id = r.client_id;
  end if;
  update public.client_requests set status = 'approved', decided_by = nullif(v_email, ''), decided_at = now(),
      decision_note = left(coalesce(nullif(btrim(coalesce(p_note, '')), ''), v_applied), 500) where id = p_id;
  return jsonb_build_object('ok', true, 'status', 'approved', 'applied', v_applied);
end;
$$;

revoke all on function public.airreach_request_payload(text, jsonb), public.airreach_client_settings(uuid), public.airreach_request_create(uuid, text, text, jsonb),
  public.airreach_request_cancel(uuid), public.airreach_request_decide(uuid, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.airreach_client_settings(uuid), public.airreach_request_create(uuid, text, text, jsonb),
  public.airreach_request_cancel(uuid), public.airreach_request_decide(uuid, boolean, text) to authenticated;
