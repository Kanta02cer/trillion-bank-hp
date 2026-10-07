-- AirReach: 顧客ごとの担当（社内）と、毎月の報告期限（日）（2026-10-08）
--   担当者ダッシュボードの顧客一覧で「自分の担当」「期限が近い・超過」を絞り込み、ホームに「報告の期限」を出すため。
--   未設定は null のまま（画面は「未設定」と出す。架空の担当・期限は作らない）。
--   書き込みは既存の clients の書き込みポリシー（社内だけ）のまま。お客様は自社の行を読めるので、担当のメールアドレスも見える（社内の業務用アドレスのみ）
alter table public.clients add column if not exists owner_email text;
alter table public.clients add column if not exists report_due_day smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_owner_email_fkey') then
    alter table public.clients add constraint clients_owner_email_fkey
      foreign key (owner_email) references public.staff_members (email) on update cascade on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'clients_report_due_day_check') then
    alter table public.clients add constraint clients_report_due_day_check check (report_due_day is null or report_due_day between 1 and 31);
  end if;
end $$;

create index if not exists clients_owner_email_idx on public.clients (owner_email);
comment on column public.clients.owner_email is '担当の社内メンバー（staff_members.email）。未設定は null';
comment on column public.clients.report_due_day is '毎月の報告期限（日・1〜31）。月末を超える日はその月の末日。未設定は null';
