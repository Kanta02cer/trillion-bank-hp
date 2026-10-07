-- 取り消し: 共同会社（20261008120000_airreach_partner_orgs.sql）。元の関数とポリシーに戻し、追加した列・表を消す
--   共同会社の人（staff_members.org_id が null でない行）が残っていると、戻した瞬間に全顧客を見られる社内の人になるため、残っていたら止める
do $$ begin
  if exists (select 1 from public.staff_members where org_id is not null) then
    raise exception '共同会社の人が残っています。先に消してから戻してください';
  end if;
end $$;
drop trigger if exists clients_org_guard on public.clients;
drop function if exists public.airreach_clients_org_guard();
drop policy if exists clients_insert on public.clients;
drop policy if exists clients_update on public.clients;
drop policy if exists clients_delete on public.clients;


drop policy if exists staff_members_select on public.staff_members;
create policy staff_members_select on public.staff_members for select to authenticated
  using (public.airreach_is_staff());

drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated
  using (public.airreach_is_staff() or public.airreach_is_member(id));

drop policy if exists clients_write on public.clients;
create policy clients_write on public.clients for all to authenticated
  using (public.airreach_is_staff()) with check (public.airreach_is_staff());

drop policy if exists client_members_select on public.client_members;
create policy client_members_select on public.client_members for select to authenticated
  using (public.airreach_is_staff() or email = public.airreach_jwt_email());

drop policy if exists client_members_write on public.client_members;
create policy client_members_write on public.client_members for all to authenticated
  using (public.airreach_is_staff()) with check (public.airreach_is_staff());

drop policy if exists client_sites_select on public.client_sites;
create policy client_sites_select on public.client_sites for select to authenticated
  using (public.airreach_is_staff() or public.airreach_is_member(client_id));

drop policy if exists client_sites_write on public.client_sites;
create policy client_sites_write on public.client_sites for all to authenticated
  using (public.airreach_is_staff()) with check (public.airreach_is_staff());

drop policy if exists measurement_runs_select on public.measurement_runs;
create policy measurement_runs_select on public.measurement_runs for select to authenticated
  using (public.airreach_is_staff() or public.airreach_is_member(client_id));

drop policy if exists measurement_runs_write on public.measurement_runs;
create policy measurement_runs_write on public.measurement_runs for all to authenticated
  using (public.airreach_is_staff()) with check (public.airreach_is_staff());

drop policy if exists traffic_snapshots_select on public.traffic_snapshots;
create policy traffic_snapshots_select on public.traffic_snapshots for select to authenticated
  using (public.airreach_is_staff() or public.airreach_is_member(client_id));

drop policy if exists traffic_snapshots_write on public.traffic_snapshots;
create policy traffic_snapshots_write on public.traffic_snapshots for all to authenticated
  using (public.airreach_is_staff()) with check (public.airreach_is_staff());

drop policy if exists action_items_select on public.action_items;
create policy action_items_select on public.action_items for select to authenticated
  using (public.airreach_is_staff() or public.airreach_is_member(client_id));

drop policy if exists action_items_write on public.action_items;
create policy action_items_write on public.action_items for all to authenticated
  using (public.airreach_is_staff()) with check (public.airreach_is_staff());

drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated
  using (public.airreach_is_staff() or (status = 'published' and public.airreach_is_member(client_id)));

drop policy if exists reports_write on public.reports;
create policy reports_write on public.reports for all to authenticated
  using (public.airreach_is_staff()) with check (public.airreach_is_staff());

drop policy if exists report_events_select on public.report_events;
create policy report_events_select on public.report_events for select to authenticated
  using (public.airreach_is_staff());

drop policy if exists studio_workspaces_select on public.studio_workspaces;
create policy studio_workspaces_select on public.studio_workspaces for select to authenticated
  using (public.airreach_is_staff());

drop policy if exists client_requests_select on public.client_requests;
create policy client_requests_select on public.client_requests for select to authenticated
  using (public.airreach_is_staff() or public.airreach_is_member(client_id));

create or replace function public.airreach_is_staff()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff_members s where s.email = public.airreach_jwt_email() and public.airreach_jwt_email() <> '');
$$;

create or replace function public.airreach_is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff_members s where s.email = public.airreach_jwt_email() and s.role = 'admin' and public.airreach_jwt_email() <> '');
$$;

create or replace function public.airreach_me()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'email',       public.airreach_jwt_email(),
    'is_staff',    public.airreach_is_staff(),
    'is_admin',    public.airreach_is_admin(),
    'can_approve', public.airreach_can_approve(),
    'client_ids', coalesce((
      select jsonb_agg(m.client_id order by m.client_id)
      from public.client_members m where m.email = public.airreach_jwt_email() and public.airreach_jwt_email() <> ''
    ), '[]'::jsonb)
  );
$$;

create or replace function public.airreach_client_scans(p_client_id uuid, p_limit integer default 60)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not (public.airreach_is_staff() or public.airreach_is_member(p_client_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x order by x->>'createdAt' desc)
    from (
      select jsonb_build_object(
        'id',            s.id,
        'createdAt',     s.created_at,
        'fetchedAt',     s.fetched_at,
        'url',           si.normalized_url,
        'host',          si.host,
        'overallScore',  s.overall_score,
        'state',         s.state,
        'industryId',    s.industry_id,
        'keyword',       s.keyword,
        'ruleVersion',   s.rule_version,
        'displayVersion', s.display_version,
        'factors', (
          select coalesce(jsonb_object_agg(f.factor_id, f.score), '{}'::jsonb)
          from public.scan_factor_scores f where f.scan_id = s.id
        ),
        'gaps', (
          select coalesce(jsonb_agg(c.label order by c.sort_order), '[]'::jsonb)
          from public.scan_checks c where c.scan_id = s.id and c.state = 'ng'
        ),
        'unknownChecks', (
          select count(*) from public.scan_checks c where c.scan_id = s.id and c.state = 'unknown'
        ),
        'checks', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'factor', c.factor_id, 'label', c.label, 'state', c.state, 'points', c.points, 'max', c.max_points,
            'evidenceUrl', coalesce(c.evidence_final_url, c.evidence_url), 'fetchedAt', c.evidence_fetched_at
          ) order by c.sort_order), '[]'::jsonb)
          from public.scan_checks c where c.scan_id = s.id
        ),
        'adjustments', s.raw_result -> 'adjustments',
        'scope',      s.raw_result -> 'scope',
        'robots',     (s.raw_result -> 'robots') - 'lines',
        'ld',         (s.raw_result -> 'page' -> 'ld') - 'raw',
        'types',      s.raw_result -> 'page' -> 'types',
        'evidence',   jsonb_build_object(
                        'llms',   (s.raw_result -> 'evidence' -> 'llms')   - 'error',
                        'robots', (s.raw_result -> 'evidence' -> 'robots') - 'error'),
        'pageInfo',   jsonb_build_object('faqCount', s.page -> 'faqCount', 'hasLlms', s.page -> 'hasLlms', 'hasRobots', s.page -> 'hasRobots', 'finalUrl', s.page -> 'finalUrl')
      ) as x
      from public.scans s
      join public.sites si on si.id = s.site_id
      join public.client_sites cs
        on cs.client_id = p_client_id
       and cs.host = regexp_replace(lower(si.host), '^www\.', '')
      order by s.created_at desc
      limit greatest(1, least(coalesce(p_limit, 60), 200))
    ) q
  ), '[]'::jsonb);
end;
$$;

create or replace function public.airreach_studio_save(p_client_id uuid, p_data jsonb, p_base_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.airreach_jwt_email();
  v_row   public.studio_workspaces;
begin
  if not public.airreach_is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'data must be an object' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'client not found' using errcode = '22023';
  end if;

  select * into v_row from public.studio_workspaces w where w.client_id = p_client_id for update;
  if not found then
    if coalesce(p_base_version, 0) <> 0 then
      return jsonb_build_object('ok', false, 'conflict', true, 'version', 0);
    end if;
    insert into public.studio_workspaces (client_id, data, version, updated_by, updated_at)
    values (p_client_id, p_data, 1, nullif(v_email, ''), now());
    return jsonb_build_object('ok', true, 'version', 1);
  end if;

  if v_row.version <> coalesce(p_base_version, -1) then
    return jsonb_build_object('ok', false, 'conflict', true, 'version', v_row.version, 'updated_by', v_row.updated_by, 'updated_at', v_row.updated_at);
  end if;
  update public.studio_workspaces
     set data = p_data, version = v_row.version + 1, updated_by = nullif(v_email, ''), updated_at = now()
   where client_id = p_client_id;
  return jsonb_build_object('ok', true, 'version', v_row.version + 1);
end;
$$;

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

create or replace function public.airreach_request_create(p_client_id uuid, p_kind text, p_action text, p_payload jsonb, p_note text)
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
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not (public.airreach_is_staff() or public.airreach_is_member(p_client_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind not in ('competitor', 'keyword', 'prompt') or p_action not in ('add', 'remove') then
    raise exception 'bad request' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception '補足は500文字までです' using errcode = '22023';
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
  insert into public.client_requests (client_id, kind, action, payload, requested_by, note)
  values (p_client_id, p_kind, p_action, v_payload, nullif(v_email, ''), v_note)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

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

create or replace function public.airreach_google_access(p_client_id uuid default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_email text := public.airreach_jwt_email();
begin
  if v_email = '' then
    return jsonb_build_object('allowed', false, 'reason', 'login_required');
  end if;
  if p_client_id is not null and exists (select 1 from public.clients c where c.id = p_client_id and c.status = 'ended') then
    return jsonb_build_object('allowed', false, 'reason', 'contract_ended');
  end if;
  if public.airreach_is_staff() then
    return jsonb_build_object('allowed', true, 'role', 'staff');
  end if;
  if p_client_id is not null then
    if exists (select 1 from public.client_members m join public.clients c on c.id = m.client_id
               where m.client_id = p_client_id and m.email = v_email and c.status <> 'ended') then
      return jsonb_build_object('allowed', true, 'role', 'member');
    end if;
    return jsonb_build_object('allowed', false, 'reason', 'not_contracted');
  end if;
  if exists (select 1 from public.client_members m join public.clients c on c.id = m.client_id
             where m.email = v_email and c.status <> 'ended') then
    return jsonb_build_object('allowed', true, 'role', 'member');
  end if;
  return jsonb_build_object('allowed', false, 'reason', 'not_contracted');
end;
$$;

drop policy if exists partner_orgs_select on public.partner_orgs;
drop policy if exists partner_orgs_write on public.partner_orgs;
alter table public.clients drop column if exists org_id;
alter table public.staff_members drop column if exists org_id;
drop table if exists public.partner_orgs;
drop function if exists public.airreach_can_staff(uuid);
drop function if exists public.airreach_staff_org();
drop function if exists public.airreach_is_any_staff();
