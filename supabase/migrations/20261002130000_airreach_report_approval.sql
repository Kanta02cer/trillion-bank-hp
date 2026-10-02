-- ============================================================================
-- AirReach: 月次レポートの承認フロー（2026-10-02）
--   下書き（draft）→ 確認待ち（in_review）→ 承認済み（approved）→ 公開（published）
--
--   - 承認できるのは staff_members.can_approve = true の人だけ。確認を依頼した本人は承認できない
--   - 公開できるのは「承認済み」からだけ（下書きから直接公開できない）
--   - 中身（集計・結論・施策・判断事項）を変えられるのは下書きのときだけ。直すときは下書きに戻す
--     （下書きに戻すと、依頼と承認の記録は消え、もう一度確認と承認が必要になる）
--   - 状態の変化は report_events に残す（誰が・いつ・何をしたか）。社内だけが読める
--   - この決まりは画面ではなく DB（トリガ）で守る。画面やスクリプトから飛ばせない
--   - 例外: ログインした利用者（role が authenticated / anon）以外、つまり管理者の SQL は決まりを通さない（記録は残す）
--
--   既存の公開済みレポートはそのまま（承認の記録は空のまま）。
--   取り消し: supabase/rollback/20261002130000_airreach_report_approval_rollback.sql
-- ============================================================================

-- 1. 承認できる人
alter table public.staff_members add column if not exists can_approve boolean not null default false;
comment on column public.staff_members.can_approve is '月次レポートを承認できる（admin が画面または SQL で設定する）';

-- 2. レポートの状態と記録
alter table public.reports add column if not exists submitted_by text;
alter table public.reports add column if not exists submitted_at timestamptz;
alter table public.reports add column if not exists approved_by  text;
alter table public.reports add column if not exists approved_at  timestamptz;
alter table public.reports add column if not exists review_note  text;
alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports add constraint reports_status_check check (status in ('draft', 'in_review', 'approved', 'published'));
alter table public.reports drop constraint if exists reports_review_note_check;
alter table public.reports add constraint reports_review_note_check check (review_note is null or length(review_note) <= 1000);
alter table public.reports drop constraint if exists reports_approved_check;
alter table public.reports add constraint reports_approved_check check (status <> 'approved' or (approved_by is not null and approved_at is not null));
alter table public.reports drop constraint if exists reports_in_review_check;
alter table public.reports add constraint reports_in_review_check check (status <> 'in_review' or (submitted_by is not null and submitted_at is not null));

create table if not exists public.report_events (
  id         bigint generated always as identity primary key,
  report_id  uuid not null references public.reports (id) on delete cascade,
  action     text not null,
  from_status text,
  to_status  text not null,
  actor      text,
  note       text,
  created_at timestamptz not null default now(),
  constraint report_events_action_check check (action in ('created', 'submitted', 'withdrawn', 'returned', 'approved', 'published', 'unpublished'))
);
create index if not exists report_events_report_idx on public.report_events (report_id, created_at);
comment on table public.report_events is '月次レポートの状態の変化（依頼・差し戻し・承認・公開）。トリガだけが書く';

-- 3. 判定の関数
create or replace function public.airreach_can_approve()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.staff_members s where s.email = public.airreach_jwt_email() and s.can_approve and public.airreach_jwt_email() <> '');
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

-- 4. 決まりを守るトリガ
create or replace function public.airreach_reports_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email   text := public.airreach_jwt_email();
  -- SECURITY DEFINER の中では current_user が関数の所有者になるため、PostgREST が設定する role で判定する
  v_enforce boolean := coalesce(current_setting('role', true), '') in ('authenticated', 'anon');
  v_action  text;
begin
  if tg_op = 'INSERT' then
    if v_enforce then
      if new.status <> 'draft' then
        raise exception '新しいレポートは下書きで作ってください' using errcode = 'P0001';
      end if;
      new.submitted_by := null; new.submitted_at := null; new.approved_by := null; new.approved_at := null;
    end if;
    return new;
  end if;

  -- 中身を変えられるのは下書きのときだけ（下書きを直してそのまま依頼する、承認後に下書きへ戻して直す、は可）
  if v_enforce and old.status <> 'draft' and new.status <> 'draft' and (
       new.compiled is distinct from old.compiled or new.conclusions is distinct from old.conclusions
    or new.next_actions is distinct from old.next_actions or new.client_decisions is distinct from old.client_decisions
    or new.client_id is distinct from old.client_id or new.period_month is distinct from old.period_month) then
    raise exception '確認・承認・公開の途中は中身を変えられません。下書きに戻してから直してください' using errcode = 'P0001';
  end if;

  if new.status is not distinct from old.status then
    -- 状態を変えずに依頼・承認の記録だけを書き換えることはできない
    if v_enforce and (new.submitted_by is distinct from old.submitted_by or new.submitted_at is distinct from old.submitted_at
        or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at) then
      raise exception '依頼・承認の記録は直接変えられません' using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.status = 'in_review' then
    if v_enforce and old.status <> 'draft' then
      raise exception '確認の依頼は下書きからだけできます' using errcode = 'P0001';
    end if;
    new.submitted_by := coalesce(nullif(v_email, ''), new.submitted_by);
    new.submitted_at := now();
    new.approved_by := null; new.approved_at := null; new.published_at := null;
    v_action := 'submitted';
  elsif new.status = 'approved' then
    if v_enforce then
      if old.status <> 'in_review' then
        raise exception '承認は確認待ちのレポートにだけできます' using errcode = 'P0001';
      end if;
      if not public.airreach_can_approve() then
        raise exception '承認する権限がありません' using errcode = '42501';
      end if;
      if v_email = old.submitted_by then
        raise exception '確認を依頼した本人は承認できません' using errcode = 'P0001';
      end if;
    end if;
    new.submitted_by := old.submitted_by; new.submitted_at := old.submitted_at;
    new.approved_by := coalesce(nullif(v_email, ''), new.approved_by);
    new.approved_at := now();
    new.published_at := null;
    v_action := 'approved';
  elsif new.status = 'published' then
    if v_enforce and old.status <> 'approved' then
      raise exception '公開できるのは承認済みのレポートだけです' using errcode = 'P0001';
    end if;
    new.submitted_by := old.submitted_by; new.submitted_at := old.submitted_at;
    new.approved_by := old.approved_by; new.approved_at := old.approved_at;
    new.published_at := coalesce(new.published_at, now());
    v_action := 'published';
  else -- draft
    v_action := case
      when old.status = 'published' then 'unpublished'
      when old.status = 'in_review' and v_email = old.submitted_by then 'withdrawn'
      else 'returned' end;
    new.submitted_by := null; new.submitted_at := null; new.approved_by := null; new.approved_at := null;
    new.published_at := null;
  end if;

  insert into public.report_events (report_id, action, from_status, to_status, actor, note)
  values (new.id, v_action, old.status, new.status, nullif(v_email, ''), left(new.review_note, 1000));
  return new;
end;
$$;

drop trigger if exists reports_guard on public.reports;
create trigger reports_guard before insert or update on public.reports
  for each row execute function public.airreach_reports_guard();

-- 作成の記録（INSERT は AFTER で id が確定してから書く）
create or replace function public.airreach_reports_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.report_events (report_id, action, from_status, to_status, actor)
  values (new.id, 'created', null, new.status, nullif(public.airreach_jwt_email(), ''));
  return null;
end;
$$;
drop trigger if exists reports_created on public.reports;
create trigger reports_created after insert on public.reports
  for each row execute function public.airreach_reports_created();

-- 5. RLS と権限（report_events は社内が読むだけ。書くのはトリガだけ）
alter table public.report_events enable row level security;
drop policy if exists report_events_select on public.report_events;
create policy report_events_select on public.report_events for select to authenticated
  using (public.airreach_is_staff());
revoke all on table public.report_events from anon, authenticated, service_role;
grant select on table public.report_events to authenticated;

revoke all on function public.airreach_can_approve(), public.airreach_reports_guard(), public.airreach_reports_created() from public, anon;
grant execute on function public.airreach_can_approve() to authenticated;
