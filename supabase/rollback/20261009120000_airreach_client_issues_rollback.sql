-- 20261009120000_airreach_client_issues を戻す（課題の表ごと消える。消す前に控えを取ること）
drop trigger if exists client_issues_touch on public.client_issues;
drop function if exists public.airreach_client_issues_touch();
drop table if exists public.client_issues;
