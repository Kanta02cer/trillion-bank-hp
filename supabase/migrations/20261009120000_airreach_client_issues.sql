-- 案件の課題（画面の再設計「この案件の課題」）。2026-10-08
--   担当者（社内・共同会社の人）が、顧客ごとに課題を書いて残す：何が起きているか・なぜ（根拠）・直すこと・どう確かめるか・状態。
--   根拠の数字（計測の X/N など）は、保存したときの値を evidence に残す（あとで計測が増えても、書いたときの根拠が分かるように）。
--   見られる・書けるのは、その顧客を担当できる人だけ（airreach_can_staff。共同会社の人は自社の顧客だけ）。お客様（client_members）には、いまは見せない
create table if not exists public.client_issues (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients (id) on delete cascade,
  rank       smallint not null default 1,
  title      text not null,
  symptom    text not null default '',
  cause      text not null default '',
  fix        text not null default '',
  check_how  text not null default '',
  kind       text not null default 'site',
  status     text not null default 'open',
  evidence   jsonb not null default '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_issues_rank_check    check (rank between 1 and 20),
  constraint client_issues_title_check   check (length(btrim(title)) between 2 and 120),
  constraint client_issues_text_check    check (length(symptom) <= 600 and length(cause) <= 600 and length(fix) <= 600 and length(check_how) <= 400),
  -- site：サイトを直す課題 ／ measure：測り方の課題（質問の入れ替えなど）
  constraint client_issues_kind_check    check (kind in ('site', 'measure')),
  -- open：未着手 ／ waiting_client：お客様の判断待ち ／ in_progress：対応中（パッチ作成中など）／ watch：様子を見る ／ done：解決
  constraint client_issues_status_check  check (status in ('open', 'waiting_client', 'in_progress', 'watch', 'done')),
  constraint client_issues_evidence_check check (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 8000)
);
create index if not exists client_issues_client_idx on public.client_issues (client_id, status, rank);

alter table public.client_issues enable row level security;
revoke all on public.client_issues from anon;
grant select, insert, update, delete on public.client_issues to authenticated;

drop policy if exists client_issues_staff on public.client_issues;
create policy client_issues_staff on public.client_issues for all to authenticated
  using (public.airreach_can_staff(client_id)) with check (public.airreach_can_staff(client_id));

-- 書いた人・直した人・日時は DB で入れる（画面から送られた値は使わない）
create or replace function public.airreach_client_issues_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := nullif(public.airreach_jwt_email(), '');
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := new.updated_by;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.client_id := old.client_id; -- 課題を別の顧客に移さない
  end if;
  return new;
end $$;
drop trigger if exists client_issues_touch on public.client_issues;
create trigger client_issues_touch before insert or update on public.client_issues
  for each row execute function public.airreach_client_issues_touch();
