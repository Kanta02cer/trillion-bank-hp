-- AirReach Phase 2 追加: 登録されたメールアドレスだけがログイン用アカウントを作れるようにする。
-- Supabase Auth の「Before User Created」フック（Postgres 関数）で使う。
-- 社内（staff_members）か顧客側の担当者（client_members）に登録済みのメールだけを通し、それ以外は 403 で断る。
-- 既にアカウントがある人のログインには影響しない（アカウントを新しく作るときだけ呼ばれる）。
-- フックを有効にするのは Auth の設定（scripts/airreach-api/phase2-apply.py auth-hook）。この migration だけでは動かない。

create or replace function public.airreach_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(coalesce(event->'user'->>'email', ''));
begin
  if v_email <> '' and (
       exists (select 1 from public.staff_members where email = v_email)
    or exists (select 1 from public.client_members where email = v_email)
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'このメールアドレスは登録されていません。担当者にお問い合わせください。'));
end;
$$;

revoke all on function public.airreach_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.airreach_before_user_created(jsonb) to supabase_auth_admin;
