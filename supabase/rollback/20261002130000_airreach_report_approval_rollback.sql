-- 20261002130000_airreach_report_approval を取り消す。
-- 注意: 状態が in_review / approved のレポートは、取り消す前に下書き（draft）へ戻すこと（状態の制約を元に戻すため）。
--       承認の記録（report_events・submitted_*・approved_*）は消える。必要なら先に書き出す。
drop trigger if exists reports_guard on public.reports;
drop trigger if exists reports_created on public.reports;
drop function if exists public.airreach_reports_guard();
drop function if exists public.airreach_reports_created();
drop table if exists public.report_events;
alter table public.reports drop constraint if exists reports_approved_check;
alter table public.reports drop constraint if exists reports_in_review_check;
alter table public.reports drop constraint if exists reports_review_note_check;
alter table public.reports drop constraint if exists reports_status_check;
alter table public.reports add constraint reports_status_check check (status in ('draft', 'published'));
alter table public.reports drop column if exists submitted_by, drop column if exists submitted_at,
  drop column if exists approved_by, drop column if exists approved_at, drop column if exists review_note;
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
drop function if exists public.airreach_can_approve();
alter table public.staff_members drop column if exists can_approve;
