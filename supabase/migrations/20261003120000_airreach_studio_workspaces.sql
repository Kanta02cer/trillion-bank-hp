-- ============================================================================
-- AirReach: Studio の作業を顧客ごとに共有する（2026-10-03・ダッシュボードと Studio の統合②）
--   これまで Studio の作業（分析・キーワード・直す材料・AI計測）はブラウザの中だけに保存していたため、
--   別のパソコンや別の担当者からは見えなかった。顧客ごとに1件、DB に保存して共有する。
--
--   - 読み書きできるのは社内（staff_members）だけ。お客様（client_members）は読めない
--   - 書き込みは RPC airreach_studio_save() だけ。版（version）が合わない保存は断る（後から保存した人が、
--     先に保存した人の作業を気づかずに消さないため）。断られたら画面で最新を読み込み直す
--   - data は Studio の保存内容（{ studio: ..., orch: ... }）。大きすぎる保存は断る（4MB）
--   取り消し: supabase/rollback/20261003120000_airreach_studio_workspaces_rollback.sql
-- ============================================================================
create table if not exists public.studio_workspaces (
  client_id  uuid primary key references public.clients (id) on delete cascade,
  data       jsonb not null,
  version    integer not null default 1,
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint studio_workspaces_size_check    check (octet_length(data::text) <= 4000000),
  constraint studio_workspaces_version_check check (version >= 1)
);
comment on table public.studio_workspaces is 'Studio の作業（顧客ごとに1件）。社内だけが読み書き。書き込みは airreach_studio_save() で版を確かめて行う';

alter table public.studio_workspaces enable row level security;
drop policy if exists studio_workspaces_select on public.studio_workspaces;
create policy studio_workspaces_select on public.studio_workspaces for select to authenticated
  using (public.airreach_is_staff());
revoke all on table public.studio_workspaces from anon, authenticated, service_role;
grant select on table public.studio_workspaces to authenticated;

-- 保存。p_base_version = 画面が最後に読んだ（または保存した）版。初めてなら 0。
-- 戻り値: { ok: true, version } または { ok: false, conflict: true, version, updated_by, updated_at }
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

revoke all on function public.airreach_studio_save(uuid, jsonb, integer) from public, anon;
grant execute on function public.airreach_studio_save(uuid, jsonb, integer) to authenticated;
