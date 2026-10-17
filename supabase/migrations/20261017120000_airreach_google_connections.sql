-- ============================================================================
-- AirReach: お客様の Search Console・GA4 のつながりをサーバーに保管し、毎月自動で取り込む（2026-10-17）
--   これまで（20261010）はつながりがブラウザの Cookie にしかなく、毎月お客様が「取り込み直す」を押す必要があった。
--   また保存していたのは月の合計だけで、どの検索語句・どのページで表示されたかは残らなかった。
--   1) google_connections   … 顧客ごとのつながり。更新用トークンはサーバーが暗号化した文字列だけを置く（平文は置かない）
--                              画面（anon・authenticated）からは読めない。状態は airreach_google_connection_status で見る
--   2) gsc_query_snapshots  … 月ごとの「検索語句 × ページ」の表示・クリック・掲載順位（Search Console）
--   3) 保存はサーバー（service_role）だけ。選んだ Search Console のサイトが、その顧客に登録したサイトと同じときだけ
--   4) Google のデータを消すとき（clients.google_purged_at が入ったとき）は、つながりと語句のデータも消す
--   取り消し: supabase/rollback/20261017120000_airreach_google_connections_rollback.sql
-- ============================================================================

create table if not exists public.google_connections (
  client_id uuid primary key references public.clients (id) on delete cascade,
  google_email text,
  refresh_token_enc text not null,
  scopes text[] not null default '{}',
  gsc_property text,
  gsc_permission text,
  connected_by text,
  connected_at timestamptz not null default now(),
  property_set_at timestamptz,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  constraint google_connections_token_len check (octet_length(refresh_token_enc) between 20 and 4000),
  constraint google_connections_sync_status check (last_sync_status is null or last_sync_status in ('ok', 'error', 'token_revoked', 'site_mismatch', 'no_property'))
);
alter table public.google_connections enable row level security;
-- 方針なし（policy なし）＝ authenticated・anon は読み書きできない。service_role だけ
revoke all on public.google_connections from public, anon, authenticated;
grant select, insert, update, delete on public.google_connections to service_role;

create table if not exists public.gsc_query_snapshots (
  client_id uuid not null references public.clients (id) on delete cascade,
  period_month date not null,
  query text not null,
  page text not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  ctr double precision not null default 0,
  position double precision not null default 0,
  property text not null,
  fetched_at timestamptz not null default now(),
  primary key (client_id, period_month, query, page),
  constraint gsc_query_snapshots_month check (period_month = date_trunc('month', period_month)::date),
  constraint gsc_query_snapshots_len check (char_length(query) <= 500 and char_length(page) <= 2000)
);
create index if not exists gsc_query_snapshots_client_month on public.gsc_query_snapshots (client_id, period_month, impressions desc);
alter table public.gsc_query_snapshots enable row level security;
revoke all on public.gsc_query_snapshots from public, anon;
grant select on public.gsc_query_snapshots to authenticated;
grant select, insert, update, delete on public.gsc_query_snapshots to service_role;
drop policy if exists gsc_query_snapshots_select on public.gsc_query_snapshots;
create policy gsc_query_snapshots_select on public.gsc_query_snapshots for select to authenticated
  using (public.airreach_can_staff(client_id) or public.airreach_is_member(client_id));

-- 選んだ Search Console のプロパティが、その顧客に登録したサイトか（20261010 の保存と同じ規則）
create or replace function public.airreach_gsc_property_matches(p_client_id uuid, p_property text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(bool_or(lower(coalesce(p_property, '')) in ('sc-domain:' || h, 'https://' || h || '/', 'https://www.' || h || '/', 'http://' || h || '/', 'http://www.' || h || '/')), false)
    from (select distinct regexp_replace(lower(s.url), '^https?://(www\.)?([^/:?#]+).*$', '\2') h
            from public.client_sites s where s.client_id = p_client_id) x;
$$;
revoke all on function public.airreach_gsc_property_matches(uuid, text) from public, anon, authenticated;
grant execute on function public.airreach_gsc_property_matches(uuid, text) to service_role;

-- つながりを保存する（Google の同意から戻ったとき）。トークンは暗号化済みの文字列だけを受け取る
create or replace function public.airreach_save_google_connection(p_client_id uuid, p_token_enc text, p_scopes text[], p_google_email text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.clients c where c.id = p_client_id and c.status <> 'ended') then
    return jsonb_build_object('ok', false, 'reason', 'not_contracted');
  end if;
  if p_token_enc is null or p_token_enc !~ '^v1\.' then raise exception 'token must be encrypted' using errcode = '22023'; end if;
  insert into public.google_connections (client_id, refresh_token_enc, scopes, google_email, connected_at, gsc_property, gsc_permission, property_set_at, last_sync_status, last_sync_error)
  values (p_client_id, p_token_enc, coalesce(p_scopes, '{}'), left(nullif(btrim(coalesce(p_google_email, '')), ''), 200), now(), null, null, null, null, null)
  on conflict (client_id) do update set
    refresh_token_enc = excluded.refresh_token_enc, scopes = excluded.scopes, google_email = excluded.google_email, connected_at = now(),
    -- 別の Google アカウントでつなぎ直したときは、選んだサイトを選び直してもらう
    gsc_property = case when public.google_connections.google_email is not distinct from excluded.google_email then public.google_connections.gsc_property end,
    gsc_permission = case when public.google_connections.google_email is not distinct from excluded.google_email then public.google_connections.gsc_permission end,
    last_sync_status = null, last_sync_error = null;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.airreach_save_google_connection(uuid, text, text[], text) from public, anon, authenticated;
grant execute on function public.airreach_save_google_connection(uuid, text, text[], text) to service_role;

-- お客様が選んだ Search Console のサイトを記録する。permission は Google が返した権限（siteOwner など）
create or replace function public.airreach_set_gsc_property(p_client_id uuid, p_property text, p_permission text, p_set_by text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.google_connections g where g.client_id = p_client_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_connected');
  end if;
  if not public.airreach_gsc_property_matches(p_client_id, p_property) then
    return jsonb_build_object('ok', false, 'reason', 'site_mismatch');
  end if;
  if p_permission is null or p_permission not in ('siteOwner', 'siteFullUser', 'siteRestrictedUser') then
    return jsonb_build_object('ok', false, 'reason', 'no_permission');
  end if;
  update public.google_connections
     set gsc_property = p_property, gsc_permission = p_permission, property_set_at = now(),
         connected_by = left(nullif(btrim(coalesce(p_set_by, '')), ''), 200)
   where client_id = p_client_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.airreach_set_gsc_property(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.airreach_set_gsc_property(uuid, text, text, text) to service_role;

-- 月の「検索語句 × ページ」を入れ替えで保存する（同じ月の前の行は消してから入れる）。1回に 5,000 行まで
create or replace function public.airreach_save_gsc_queries(p_client_id uuid, p_period_month date, p_property text, p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not exists (select 1 from public.clients c where c.id = p_client_id and c.status <> 'ended') then
    return jsonb_build_object('ok', false, 'reason', 'not_contracted');
  end if;
  if p_period_month is null or p_period_month <> date_trunc('month', p_period_month)::date then raise exception 'bad period' using errcode = '22023'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'bad rows' using errcode = '22023'; end if;
  if not public.airreach_gsc_property_matches(p_client_id, p_property) then
    return jsonb_build_object('ok', false, 'reason', 'site_mismatch');
  end if;
  delete from public.gsc_query_snapshots where client_id = p_client_id and period_month = p_period_month;
  insert into public.gsc_query_snapshots (client_id, period_month, query, page, clicks, impressions, ctr, position, property)
  select p_client_id, p_period_month, left(r ->> 'query', 500), left(r ->> 'page', 2000),
         greatest(coalesce((r ->> 'clicks')::numeric, 0), 0)::integer,
         greatest(coalesce((r ->> 'impressions')::numeric, 0), 0)::integer,
         greatest(coalesce((r ->> 'ctr')::double precision, 0), 0),
         greatest(coalesce((r ->> 'position')::double precision, 0), 0),
         p_property
    from jsonb_array_elements(p_rows) r
   where coalesce(r ->> 'query', '') <> '' and coalesce(r ->> 'page', '') <> ''
  on conflict (client_id, period_month, query, page) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'rows', v_n);
end;
$$;
revoke all on function public.airreach_save_gsc_queries(uuid, date, text, jsonb) from public, anon, authenticated;
grant execute on function public.airreach_save_gsc_queries(uuid, date, text, jsonb) to service_role;

-- 毎月の取り込みの結果を記録する
create or replace function public.airreach_mark_google_sync(p_client_id uuid, p_status text, p_error text)
returns void
language sql security definer
set search_path = ''
as $$
  update public.google_connections
     set last_sync_at = now(), last_sync_status = p_status, last_sync_error = left(nullif(p_error, ''), 500)
   where client_id = p_client_id;
$$;
revoke all on function public.airreach_mark_google_sync(uuid, text, text) from public, anon, authenticated;
grant execute on function public.airreach_mark_google_sync(uuid, text, text) to service_role;

-- 切断（お客様の「つながりを切る」・Google 側で取り消されたとき）
create or replace function public.airreach_delete_google_connection(p_client_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_n integer;
begin
  delete from public.google_connections where client_id = p_client_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_n);
end;
$$;
revoke all on function public.airreach_delete_google_connection(uuid) from public, anon, authenticated;
grant execute on function public.airreach_delete_google_connection(uuid) to service_role;

-- 画面向け：つながりの状態（トークンは返さない）。社内か、その顧客のメンバーだけ
create or replace function public.airreach_google_connection_status(p_client_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare g public.google_connections%rowtype;
begin
  if not (public.airreach_can_staff(p_client_id) or public.airreach_is_member(p_client_id)) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  select * into g from public.google_connections where client_id = p_client_id;
  if not found then return jsonb_build_object('ok', true, 'connected', false); end if;
  return jsonb_build_object('ok', true, 'connected', true, 'google_email', g.google_email, 'gsc_property', g.gsc_property,
    'gsc_permission', g.gsc_permission, 'owner_verified', g.gsc_permission in ('siteOwner', 'siteFullUser'),
    'connected_at', g.connected_at, 'last_sync_at', g.last_sync_at, 'last_sync_status', g.last_sync_status);
end;
$$;
revoke all on function public.airreach_google_connection_status(uuid) from public, anon;
grant execute on function public.airreach_google_connection_status(uuid) to authenticated;

-- 毎月の取り込みの対象（サーバーだけ）。契約中で、サイトを選び終えたつながり
create or replace function public.airreach_google_sync_targets()
returns table (client_id uuid, refresh_token_enc text, gsc_property text, scopes text[])
language sql stable security definer
set search_path = ''
as $$
  select g.client_id, g.refresh_token_enc, g.gsc_property, g.scopes
    from public.google_connections g join public.clients c on c.id = g.client_id
   where c.status <> 'ended' and g.gsc_property is not null and c.google_purged_at is null
   order by g.last_sync_at nulls first;
$$;
revoke all on function public.airreach_google_sync_targets() from public, anon, authenticated;
grant execute on function public.airreach_google_sync_targets() to service_role;

-- Google のデータを消したとき（airreach_purge_google_data が clients.google_purged_at を入れる）、つながりと語句のデータも消す
create or replace function public.airreach_purge_google_connection_on_purge()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.google_purged_at is not null and new.google_purged_at is distinct from old.google_purged_at then
    delete from public.google_connections where client_id = new.id;
    delete from public.gsc_query_snapshots where client_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists airreach_purge_google_connection on public.clients;
create trigger airreach_purge_google_connection after update of google_purged_at on public.clients
  for each row execute function public.airreach_purge_google_connection_on_purge();
