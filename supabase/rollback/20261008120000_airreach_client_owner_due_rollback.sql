-- 取り消し: 顧客ごとの担当と報告期限（20261008120000_airreach_client_owner_due.sql）。設定した担当・期限は消える
drop index if exists public.clients_owner_email_idx;
alter table public.clients drop constraint if exists clients_report_due_day_check;
alter table public.clients drop constraint if exists clients_owner_email_fkey;
alter table public.clients drop column if exists report_due_day;
alter table public.clients drop column if exists owner_email;
