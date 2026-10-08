-- 取り消し: 20261009130000_airreach_decision_replies.sql
--   ⚠️ お客様のお返事（kind = 'decision' の行）は消える。戻す前に残すなら書き出しておく:
--      select * from public.client_requests where kind = 'decision';
begin;
delete from public.client_requests where kind = 'decision';
alter table public.client_requests drop constraint if exists client_requests_kind_action_check;
alter table public.client_requests drop constraint if exists client_requests_kind_check;
alter table public.client_requests add constraint client_requests_kind_check check (kind in ('competitor', 'keyword', 'prompt'));
alter table public.client_requests drop constraint if exists client_requests_action_check;
alter table public.client_requests add constraint client_requests_action_check check (action in ('add', 'remove'));
drop function if exists public.airreach_decision_reply(uuid, integer, text, text);
-- airreach_request_decide を 20261008120000_airreach_partner_orgs.sql の形に戻す
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
  if not public.airreach_is_any_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into r from public.client_requests where id = p_id for update;
  if not found then raise exception 'not found' using errcode = '22023'; end if;
  -- 共同会社の人は、自社の顧客の依頼だけ決められる（ほかの会社の依頼は「見つからない」と同じ扱い）
  if not public.airreach_can_staff(r.client_id) then raise exception 'not found' using errcode = '22023'; end if;
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
commit;
