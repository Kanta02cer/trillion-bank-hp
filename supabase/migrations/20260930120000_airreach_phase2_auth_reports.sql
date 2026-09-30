-- ============================================================================
-- AirReach Phase 2: ログイン（Supabase Auth・メール）／顧客管理／月次レポート
-- Target : AirReach 専用 Supabase Project（ref: opjjxbdrgfyoydyrmzns）のみ
-- NEVER  : Hack2 Project（ref: inlnrdjdfccnhmskpyrs）には適用しない
-- Design : docs/airreach-phase2-auth-reports.md
-- Depends: 20260928120000_airreach_phase1.sql
--
-- 方針
--   - ブラウザは Supabase Auth でログインし、authenticated ロールで PostgREST を直接使う。
--     見てよい行は RLS で決める。権限は anon には一切与えない。
--   - 誰が社内（staff）か、誰がどの顧客のメンバーかは「メールアドレス」で持つ。
--     Supabase Auth のメールリンクでログインした JWT の email は、リンクを踏んだ＝確認済み。
--     招待はメールアドレスを登録するだけで、ログインした時点で権限が効く。
--   - 顧客は「公開済み」のレポートと、自社の材料（計測・流入・施策）だけを読める。書けない。
--   - Phase 1 の診断テーブル（scans 等）は引き続き直接触らせない。
--     顧客のサイトの診断履歴は RPC airreach_client_scans() で、権限を確かめてから返す。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. tables
-- ----------------------------------------------------------------------------

-- 社内スタッフ。行の追加は SQL（管理者）か、admin ロールのスタッフが画面から行う。
create table if not exists public.staff_members (
  email      text primary key,
  role       text not null default 'staff',
  name       text,
  created_at timestamptz not null default now(),
  constraint staff_members_email_check check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint staff_members_role_check  check (role in ('admin', 'staff'))
);
comment on table public.staff_members is 'AirReach 社内スタッフ（小文字メールで一意）。admin はスタッフの追加・削除ができる';

-- 顧客（会社・店舗）。
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  industry_id text,
  status      text not null default 'active',
  notes       text,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint clients_name_check   check (length(name) between 1 and 200),
  constraint clients_status_check check (status in ('active', 'paused', 'ended'))
);
comment on table public.clients is 'AirReach の顧客（会社・店舗）';

-- 顧客側のメンバー（閲覧のみ）。メールアドレスで招待する。
create table if not exists public.client_members (
  client_id  uuid not null references public.clients (id) on delete cascade,
  email      text not null,
  name       text,
  created_at timestamptz not null default now(),
  constraint client_members_pkey        primary key (client_id, email),
  constraint client_members_email_check check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
comment on table public.client_members is '顧客側のメンバー。ログインしたメールが一致すると、その顧客の公開済みレポートを読める';

-- 顧客の対象サイト。host で Phase 1 の sites と結びつける（www. の有無は同一視）。
create table if not exists public.client_sites (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients (id) on delete cascade,
  url        text not null,
  host       text not null,
  label      text,
  created_at timestamptz not null default now(),
  constraint client_sites_host_check check (host = lower(host) and host !~ '^www\.' and host ~ '^[a-z0-9.-]+$'),
  constraint client_sites_client_host_key unique (client_id, host)
);
comment on table public.client_sites is '顧客の対象サイト。host は小文字・先頭の www. を除いた値';

-- AI 回答の計測（社内計測スクリプトの summary.json を取り込む）。
create table if not exists public.measurement_runs (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients (id) on delete cascade,
  measured_on       date not null,
  run_label         text,
  query_set_version text,
  source            text not null default 'script',
  summary           jsonb not null,
  notes             text,
  created_by        text,
  created_at        timestamptz not null default now(),
  constraint measurement_runs_source_check check (source in ('script', 'manual'))
);
comment on table  public.measurement_runs is 'AI 回答の計測 1 回分。summary は計測スクリプトの summary.json（by: provider×group の引用率・言及率など）';
create index if not exists measurement_runs_client_date_idx on public.measurement_runs (client_id, measured_on desc);

-- 検索・アクセスの月次の数値（GSC の CSV・GA4 の手入力。API 連携後は *_api）。
create table if not exists public.traffic_snapshots (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients (id) on delete cascade,
  period_month date not null,
  source       text not null,
  metrics      jsonb not null,
  notes        text,
  created_by   text,
  created_at   timestamptz not null default now(),
  constraint traffic_snapshots_month_check  check (period_month = date_trunc('month', period_month)::date),
  constraint traffic_snapshots_source_check check (source in ('gsc_csv', 'ga4_manual', 'gsc_api', 'ga4_api')),
  constraint traffic_snapshots_key unique (client_id, period_month, source)
);
comment on table public.traffic_snapshots is '月次の検索・アクセス数値。metrics 例: {clicks, impressions, ctr, position} / {sessions, ai_sessions, target_page_views, conversions}';

-- 実施した施策（施策台帳）。
create table if not exists public.action_items (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients (id) on delete cascade,
  title        text not null,
  category     text,
  status       text not null default 'done',
  done_on      date,
  evidence_url text,
  notes        text,
  created_by   text,
  created_at   timestamptz not null default now(),
  constraint action_items_title_check  check (length(title) between 1 and 300),
  constraint action_items_status_check check (status in ('planned', 'done'))
);
create index if not exists action_items_client_done_idx on public.action_items (client_id, done_on desc);

-- 月次レポート。compiled は作成時点の材料の写し（あとで材料が変わってもレポートは変わらない）。
create table if not exists public.reports (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients (id) on delete cascade,
  period_month     date not null,
  status           text not null default 'draft',
  compiled         jsonb not null default '{}'::jsonb,
  conclusions      jsonb not null default '[]'::jsonb,
  next_actions     jsonb not null default '[]'::jsonb,
  client_decisions jsonb not null default '[]'::jsonb,
  published_at     timestamptz,
  created_by       text,
  updated_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint reports_month_check  check (period_month = date_trunc('month', period_month)::date),
  constraint reports_status_check check (status in ('draft', 'published')),
  constraint reports_published_at_check check ((status = 'published') = (published_at is not null)),
  constraint reports_client_month_key unique (client_id, period_month)
);
comment on table public.reports is '月次レポート。顧客は status=published だけ読める';

-- ----------------------------------------------------------------------------
-- 2. 権限判定の関数（RLS から呼ぶ）。STABLE・search_path 固定。
-- ----------------------------------------------------------------------------
create or replace function public.airreach_jwt_email()
returns text
language sql stable
set search_path = ''
as $$
  select lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''));
$$;

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

create or replace function public.airreach_is_member(p_client_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.client_members m
    where m.client_id = p_client_id and m.email = public.airreach_jwt_email() and public.airreach_jwt_email() <> ''
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. RPC
-- ----------------------------------------------------------------------------

-- ログイン中の人の情報（社内か、どの顧客のメンバーか）。
create or replace function public.airreach_me()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'email',    public.airreach_jwt_email(),
    'is_staff', public.airreach_is_staff(),
    'is_admin', public.airreach_is_admin(),
    'client_ids', coalesce((
      select jsonb_agg(m.client_id order by m.client_id)
      from public.client_members m where m.email = public.airreach_jwt_email() and public.airreach_jwt_email() <> ''
    ), '[]'::jsonb)
  );
$$;

-- 顧客の対象サイトの診断履歴（Phase 1 の scans から、社内または当該顧客のメンバーにだけ返す）。
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
        )
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

-- updated_at を更新するトリガ
create or replace function public.airreach_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients
  for each row execute function public.airreach_touch_updated_at();
drop trigger if exists reports_touch on public.reports;
create trigger reports_touch before update on public.reports
  for each row execute function public.airreach_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 4. RLS
-- ----------------------------------------------------------------------------
alter table public.staff_members     enable row level security;
alter table public.clients           enable row level security;
alter table public.client_members    enable row level security;
alter table public.client_sites      enable row level security;
alter table public.measurement_runs  enable row level security;
alter table public.traffic_snapshots enable row level security;
alter table public.action_items      enable row level security;
alter table public.reports           enable row level security;

-- staff_members: 社内は一覧を読める。追加・変更・削除は admin だけ。
drop policy if exists staff_members_select on public.staff_members;
create policy staff_members_select on public.staff_members for select to authenticated
  using (public.airreach_is_staff());
drop policy if exists staff_members_write on public.staff_members;
create policy staff_members_write on public.staff_members for all to authenticated
  using (public.airreach_is_admin()) with check (public.airreach_is_admin());

-- clients: 社内は全件の読み書き。メンバーは自社を読むだけ。
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated
  using (public.airreach_is_staff() or public.airreach_is_member(id));
drop policy if exists clients_write on public.clients;
create policy clients_write on public.clients for all to authenticated
  using (public.airreach_is_staff()) with check (public.airreach_is_staff());

-- client_members: 社内は読み書き。メンバーは自分の行だけ読める（他のメンバーのメールは見せない）。
drop policy if exists client_members_select on public.client_members;
create policy client_members_select on public.client_members for select to authenticated
  using (public.airreach_is_staff() or email = public.airreach_jwt_email());
drop policy if exists client_members_write on public.client_members;
create policy client_members_write on public.client_members for all to authenticated
  using (public.airreach_is_staff()) with check (public.airreach_is_staff());

-- 材料（サイト・計測・流入・施策）: 社内は読み書き。メンバーは自社分を読むだけ。
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

-- reports: 社内は全件の読み書き。メンバーは自社の「公開済み」だけ読める。
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated
  using (public.airreach_is_staff() or (status = 'published' and public.airreach_is_member(client_id)));
drop policy if exists reports_write on public.reports;
create policy reports_write on public.reports for all to authenticated
  using (public.airreach_is_staff()) with check (public.airreach_is_staff());

-- ----------------------------------------------------------------------------
-- 5. 権限（Phase 1 と同じく既定に頼らず明示する）
--    anon: なし。authenticated: 新テーブルの DML と RPC 3 本（行は RLS で絞る）。
-- ----------------------------------------------------------------------------
revoke all on table public.staff_members, public.clients, public.client_members, public.client_sites,
                    public.measurement_runs, public.traffic_snapshots, public.action_items, public.reports
  from anon, service_role;
grant usage on schema public to authenticated;
grant select, insert, update, delete on table
  public.staff_members, public.clients, public.client_members, public.client_sites,
  public.measurement_runs, public.traffic_snapshots, public.action_items, public.reports
  to authenticated;

revoke all on function public.airreach_jwt_email(), public.airreach_is_staff(), public.airreach_is_admin(),
                       public.airreach_is_member(uuid), public.airreach_me(), public.airreach_client_scans(uuid, integer),
                       public.airreach_touch_updated_at()
  from public, anon;
grant execute on function public.airreach_jwt_email(), public.airreach_is_staff(), public.airreach_is_admin(),
                          public.airreach_is_member(uuid), public.airreach_me(), public.airreach_client_scans(uuid, integer)
  to authenticated;

-- ----------------------------------------------------------------------------
-- 6. 最初の管理者（適用する人が自分のメールに置き換えて1回だけ実行する。ここでは実行しない）
--   insert into public.staff_members (email, role, name) values ('<admin@example.com>', 'admin', '<名前>');
-- ----------------------------------------------------------------------------
