-- ============================================================================
-- AirReach: 「ご判断いただきたいこと」へのお客様のお返事（2026-10-09）
--   公開済みの月次レポートの client_decisions の1項目ごとに、お客様が画面で返事をする：
--     ok     = このまま進めてよい（補足は任意）
--     revise = 直して返す（直してほしい点を必ず書く）
--   返事は client_requests に kind = 'decision' で残す（担当者のホームの「お客様からの依頼」に並ぶ）。
--   担当者は「確認した」を押すだけ（Studio の作業は変えない）。お客様は確認前なら取り消せる（airreach_request_cancel）。
--   同じ項目に返事をし直すと、確認前の前の返事は取り消しになる（いちばん新しい返事だけが確認待ちに残る）。
--   取り消し: supabase/rollback/20261009130000_airreach_decision_replies_rollback.sql
-- ============================================================================
alter table public.client_requests drop constraint if exists client_requests_kind_check;
alter table public.client_requests add constraint client_requests_kind_check check (kind in ('competitor', 'keyword', 'prompt', 'decision'));
alter table public.client_requests drop constraint if exists client_requests_action_check;
alter table public.client_requests add constraint client_requests_action_check check (action in ('add', 'remove', 'ok', 'revise'));
-- 種類と動作の組み合わせ（ご判断は ok / revise だけ、それ以外は add / remove だけ）
alter table public.client_requests drop constraint if exists client_requests_kind_action_check;
alter table public.client_requests add constraint client_requests_kind_action_check check ((kind = 'decision') = (action in ('ok', 'revise')));

create or replace function public.airreach_decision_reply(p_report_id uuid, p_index integer, p_answer text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.airreach_jwt_email();
  rep public.reports;
  v_text text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  select * into rep from public.reports where id = p_report_id;
  -- 見られないレポートは「見つからない」と同じ扱い（あるかどうかを漏らさない）
  if not found or rep.status <> 'published' or not (public.airreach_is_member(rep.client_id) or public.airreach_can_staff(rep.client_id)) then
    raise exception 'not found' using errcode = '22023';
  end if;
  if p_answer not in ('ok', 'revise') then raise exception 'bad request' using errcode = '22023'; end if;
  if jsonb_typeof(rep.client_decisions) <> 'array' or p_index is null or p_index < 0 or p_index >= jsonb_array_length(rep.client_decisions) then
    raise exception 'bad request' using errcode = '22023';
  end if;
  -- 項目の文はレポートから取る（画面から送られた文は使わない）
  v_text := left(btrim(coalesce(rep.client_decisions ->> p_index, '')), 300);
  if v_text = '' then raise exception 'bad request' using errcode = '22023'; end if;
  if p_answer = 'revise' and v_note is null then raise exception '直してほしい点を書いてください' using errcode = '22023'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'お返事は500文字までです' using errcode = '22023'; end if;

  perform 1 from public.clients where id = rep.client_id for update;
  -- 同じ項目の確認前の返事は取り消しにする（返事のし直し）
  update public.client_requests set status = 'cancelled', decided_by = nullif(v_email, ''), decided_at = now(), decision_note = '新しいお返事に置き換えました'
    where client_id = rep.client_id and kind = 'decision' and status = 'pending'
      and payload ->> 'report_id' = p_report_id::text and (payload ->> 'index')::integer = p_index;
  if (select count(*) from public.client_requests where client_id = rep.client_id and status = 'pending') >= 30 then
    return jsonb_build_object('ok', false, 'reason', '確認待ちの依頼が30件あります。担当者の確認をお待ちください');
  end if;
  insert into public.client_requests (client_id, kind, action, payload, requested_by, note)
  values (rep.client_id, 'decision', p_answer,
          jsonb_build_object('report_id', rep.id, 'index', p_index, 'text', v_text, 'period_month', rep.period_month),
          nullif(v_email, ''), v_note)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke all on function public.airreach_decision_reply(uuid, integer, text, text) from public, anon, service_role;
grant execute on function public.airreach_decision_reply(uuid, integer, text, text) to authenticated;

-- 担当者の「承認」：ご判断へのお返事は「確認した」の記録だけ（ほかの種類は今までどおり）
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
  -- ご判断へのお返事は、Studio の作業を変えない。担当者が「確認した」と記録するだけ（見送りは無い）
  if r.kind = 'decision' then
    update public.client_requests set status = 'approved', decided_by = nullif(v_email, ''), decided_at = now(),
        decision_note = left(coalesce(nullif(btrim(coalesce(p_note, '')), ''), '担当者が確認しました'), 500) where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'approved', 'applied', '担当者が確認しました');
  end if;
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
