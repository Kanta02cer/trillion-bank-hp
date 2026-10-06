-- ============================================================================
-- AirReach: Google のユーザーデータの扱い（2026-10-07・Google OAuth の審査対応）
-- Target : AirReach 専用 Supabase Project のみ（Hack2 Project には適用しない）
-- Depends: phase1 / phase2 / 20261002130000_airreach_report_approval / 20261003120000_airreach_studio_workspaces
--          （measurement_schedules・measurement_jobs は有れば対象にする。無くても適用できる）
--
-- 決めたこと
--   1. Google 連携（OAuth の開始・Search Console / GA4 の取得）は、社内スタッフか、契約中の顧客のメンバーだけ。
--      判定は RPC airreach_google_access()。API（api/google/_lib/access.js）がログインのトークンで呼ぶ
--   2. 契約が終わった顧客（clients.status = 'ended'）の Google 由来のデータは、終了から 90 日以内に消す。
--      終了日は clients.ended_at（status を ended にした時点でトリガーが入れる）。
--      消すのは airreach_purge_expired_google_data()（終了から 80 日たった顧客。90 日以内に収めるための余裕 10 日）。
--      毎日の実行は別の migration（20261007170000_airreach_google_retention_pg_cron.sql）で pg_cron に登録する
--   3. 削除依頼は、管理者（staff_members.role = 'admin'）が顧客ごとに airreach_delete_google_data() で一括で消す
--   4. 消した記録は google_data_deletions に残す（Google のデータ本体は入れない。件数・理由・日時・実行した人だけ）。
--      顧客を消しても記録は残す（外部キーにしない）
--
-- 消す対象（顧客ごと）
--   - traffic_snapshots       … 月次の Search Console / GA4 の数字（接続したアカウントのメールを含む）。すべて消す
--   - studio_workspaces       … Studio の作業（Search Console の検索語句の行を含む）。作業ごと消す
--   - measurement_runs        … AI 計測の記録（以前は Search Console の検索語句から作った質問が入っていた）。すべて消す
--   - measurement_schedules / measurement_jobs … 定期計測の設定と実行の記録（質問を含む）。有れば消す
--   - reports.compiled        … 月次レポートの材料のうち、検索・訪問の数字（traffic・推移のクリック/問い合わせ・クリックの事実）を除く。
--                               レポート自体と担当者が書いた結論・次の打ち手は残す（自由記述に数字を書いた場合は担当者が直す）
--   Google のトークンは DB に無い（ブラウザの Cookie）。ブラウザに残ったデータは clients.google_purged_at を見て画面が消す
-- 取り消し: supabase/rollback/20261007150000_airreach_google_data_governance_rollback.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 顧客の契約終了日・Google データを消した日時
-- ----------------------------------------------------------------------------
alter table public.clients add column if not exists ended_at timestamptz;
alter table public.clients add column if not exists google_purged_at timestamptz;
comment on column public.clients.ended_at is '契約終了日時（status を ended にした時点。トリガーで入る）。Google 由来のデータは、この日から 90 日以内に消す';
comment on column public.clients.google_purged_at is 'この顧客の Google 由来のデータを最後に消した日時。画面はこれより前の作業をブラウザから消す';

-- 既に終了している顧客は、最後に更新した日時を終了日とみなす
update public.clients set ended_at = coalesce(updated_at, created_at) where status = 'ended' and ended_at is null;

-- status の変化で終了日を入れる・外す。ended_at と google_purged_at は画面から直接変えさせない
create or replace function public.airreach_clients_google_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.ended_at := case when new.status = 'ended' then now() else null end;
    new.google_purged_at := null;
    return new;
  end if;
  if new.status = 'ended' and old.status is distinct from 'ended' then
    new.ended_at := now();
  elsif new.status <> 'ended' then
    new.ended_at := null;
  else
    new.ended_at := old.ended_at;
  end if;
  if coalesce(current_setting('airreach.google_purging', true), '') <> '1' then
    new.google_purged_at := old.google_purged_at;
  end if;
  return new;
end;
$$;
drop trigger if exists clients_google_guard on public.clients;
create trigger clients_google_guard before insert or update on public.clients
  for each row execute function public.airreach_clients_google_guard();

-- ----------------------------------------------------------------------------
-- 2. 削除の記録（監査用。Google のデータ本体は入れない）
-- ----------------------------------------------------------------------------
create table if not exists public.google_data_deletions (
  id            bigint generated always as identity primary key,
  client_id     uuid not null,
  client_name   text,
  reason        text not null,
  request_note  text,
  executed_by   text not null,
  executed_at   timestamptz not null default now(),
  counts        jsonb not null default '{}'::jsonb,
  constraint google_data_deletions_reason_check check (reason in ('contract_end', 'user_request')),
  constraint google_data_deletions_note_check check (request_note is null or length(request_note) <= 500)
);
comment on table public.google_data_deletions is 'Google 由来のデータを消した記録（監査用）。件数・理由・日時・実行した人だけを残し、Google のデータ本体は入れない';
create index if not exists google_data_deletions_client_idx on public.google_data_deletions (client_id, executed_at desc);

alter table public.google_data_deletions enable row level security;
drop policy if exists google_data_deletions_select on public.google_data_deletions;
create policy google_data_deletions_select on public.google_data_deletions for select to authenticated
  using (public.airreach_is_staff());
-- 書き込みは下の関数（security definer）だけ。画面から直接は書けない・消せない
revoke all on table public.google_data_deletions from public, anon, authenticated, service_role;
grant select on table public.google_data_deletions to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Google 連携を使ってよい人か
-- ----------------------------------------------------------------------------
-- 社内スタッフ → 使える。顧客のメンバー → その顧客（p_client_id）が契約中（ended でない）なら使える。
-- p_client_id が無いとき（Studio の取り込み画面）は、契約中の顧客のメンバーであれば使える。
-- 契約が終わった顧客（p_client_id の status が ended）については、社内スタッフでも新しく取得しない。
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
revoke all on function public.airreach_google_access(uuid) from public, anon;
grant execute on function public.airreach_google_access(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. 顧客の Google 由来のデータを消す（本体。画面からは直接呼べない）
-- ----------------------------------------------------------------------------
create or replace function public.airreach_purge_google_data(p_client_id uuid, p_reason text, p_actor text, p_note text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_name text;
  v_n integer;
  v_counts jsonb := '{}'::jsonb;
begin
  if p_reason not in ('contract_end', 'user_request') then
    raise exception 'invalid reason' using errcode = '22023';
  end if;
  select name into v_name from public.clients where id = p_client_id for update;
  if not found then
    raise exception 'client not found' using errcode = 'P0002';
  end if;

  delete from public.traffic_snapshots where client_id = p_client_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('traffic_snapshots', v_n);

  delete from public.studio_workspaces where client_id = p_client_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('studio_workspaces', v_n);

  if to_regclass('public.measurement_jobs') is not null then
    execute 'delete from public.measurement_jobs where client_id = $1' using p_client_id;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('measurement_jobs', v_n);
  end if;
  if to_regclass('public.measurement_schedules') is not null then
    execute 'delete from public.measurement_schedules where client_id = $1' using p_client_id;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('measurement_schedules', v_n);
  end if;

  delete from public.measurement_runs where client_id = p_client_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('measurement_runs', v_n);

  -- 月次レポートの材料から、検索・訪問の数字を除く（レポートと担当者の文章は残す）
  update public.reports r set compiled =
    (r.compiled - 'traffic')
    || jsonb_build_object('history', coalesce((
         select jsonb_agg(case when jsonb_typeof(h) = 'object' then h || '{"clicks": null, "conversions": null}'::jsonb else h end order by o)
         from jsonb_array_elements(case when jsonb_typeof(r.compiled -> 'history') = 'array' then r.compiled -> 'history' else '[]'::jsonb end) with ordinality as t(h, o)
       ), '[]'::jsonb))
    || jsonb_build_object('facts', coalesce((
         select jsonb_agg(f order by o)
         from jsonb_array_elements(case when jsonb_typeof(r.compiled -> 'facts') = 'array' then r.compiled -> 'facts' else '[]'::jsonb end) with ordinality as t(f, o)
         where not (jsonb_typeof(f) = 'string' and (f #>> '{}') like '検索からのクリック%')
       ), '[]'::jsonb))
    || jsonb_build_object('googleDataRemovedAt', now())
  where r.client_id = p_client_id and jsonb_typeof(r.compiled) = 'object';
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('reports_cleaned', v_n);

  perform set_config('airreach.google_purging', '1', true);
  update public.clients set google_purged_at = now() where id = p_client_id;
  perform set_config('airreach.google_purging', '', true);

  insert into public.google_data_deletions (client_id, client_name, reason, request_note, executed_by, counts)
  values (p_client_id, v_name, p_reason, nullif(left(coalesce(p_note, ''), 500), ''), coalesce(nullif(p_actor, ''), 'unknown'), v_counts);

  return jsonb_build_object('ok', true, 'counts', v_counts);
end;
$$;
revoke all on function public.airreach_purge_google_data(uuid, text, text, text) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. 削除依頼（管理者が画面から）
-- ----------------------------------------------------------------------------
-- 間違えて別の顧客を消さないよう、顧客名を打ち込んで一致したときだけ消す
create or replace function public.airreach_delete_google_data(p_client_id uuid, p_confirm_name text, p_note text default null)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if not public.airreach_is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select name into v_name from public.clients where id = p_client_id;
  if not found then
    raise exception 'client not found' using errcode = 'P0002';
  end if;
  if btrim(coalesce(p_confirm_name, '')) <> btrim(v_name) then
    raise exception 'confirm name mismatch' using errcode = '22023';
  end if;
  return public.airreach_purge_google_data(p_client_id, 'user_request', public.airreach_jwt_email(), p_note);
end;
$$;
revoke all on function public.airreach_delete_google_data(uuid, text, text) from public, anon;
grant execute on function public.airreach_delete_google_data(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. 契約終了から一定日数たった顧客の Google データを消す（毎日の実行から）
-- ----------------------------------------------------------------------------
-- p_days: 終了から何日たったら消すか（既定 80 日＝90 日以内に収めるための余裕 10 日）。1〜89 日だけ受け付ける
create or replace function public.airreach_purge_expired_google_data(p_days integer default 80)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  r record;
  v_done jsonb := '[]'::jsonb;
begin
  if p_days is null or p_days < 1 or p_days > 89 then
    raise exception 'p_days must be between 1 and 89' using errcode = '22023';
  end if;
  for r in
    select c.id from public.clients c
    where c.status = 'ended' and c.ended_at is not null
      and c.ended_at <= now() - make_interval(days => p_days)
      and (c.google_purged_at is null or c.google_purged_at < c.ended_at)
    order by c.ended_at
  loop
    perform public.airreach_purge_google_data(r.id, 'contract_end', 'system:retention', null);
    v_done := v_done || to_jsonb(r.id);
  end loop;
  return jsonb_build_object('ok', true, 'purged', jsonb_array_length(v_done));
end;
$$;
revoke all on function public.airreach_purge_expired_google_data(integer) from public, anon, authenticated;
grant execute on function public.airreach_purge_expired_google_data(integer) to service_role;
