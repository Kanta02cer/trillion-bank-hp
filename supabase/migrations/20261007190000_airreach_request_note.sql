-- AirReach: お客様からの依頼に「補足」（なぜ足したい・外したいか）を付けられるようにする（2026-10-07）
--   client_requests.note（500文字まで・任意）と、補足を受け取る airreach_request_create(…, p_note)。
--   既存の4つの引数の airreach_request_create はそのまま使える（補足なし）。p_note には既定値を付けない
--   （付けると PostgREST が4つの引数の呼び出しで2つの関数のどちらか決められなくなるため）
alter table public.client_requests add column if not exists note text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_requests_note_check') then
    alter table public.client_requests add constraint client_requests_note_check check (note is null or length(note) between 1 and 500);
  end if;
end $$;
comment on column public.client_requests.note is 'お客様（または社内）が依頼に付けた補足。500文字まで・任意';

create or replace function public.airreach_request_create(p_client_id uuid, p_kind text, p_action text, p_payload jsonb, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.airreach_jwt_email();
  v_payload jsonb;
  v_key text;
  v_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not (public.airreach_is_staff() or public.airreach_is_member(p_client_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind not in ('competitor', 'keyword', 'prompt') or p_action not in ('add', 'remove') then
    raise exception 'bad request' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception '補足は500文字までです' using errcode = '22023';
  end if;
  v_payload := public.airreach_request_payload(p_kind, p_payload);
  v_key := lower(coalesce(v_payload ->> 'name', v_payload ->> 'text'));
  -- 同じ顧客の依頼を1件ずつ確かめる（同時に送っても上限と重複の確かめが崩れないように）
  perform 1 from public.clients where id = p_client_id for update;
  if (select count(*) from public.client_requests where client_id = p_client_id and status = 'pending') >= 30 then
    return jsonb_build_object('ok', false, 'reason', '確認待ちの依頼が30件あります。担当者の確認をお待ちください');
  end if;
  if exists (select 1 from public.client_requests r where r.client_id = p_client_id and r.status = 'pending' and r.kind = p_kind and r.action = p_action
             and lower(coalesce(r.payload ->> 'name', r.payload ->> 'text')) = v_key) then
    return jsonb_build_object('ok', false, 'reason', '同じ内容の依頼が確認待ちです');
  end if;
  insert into public.client_requests (client_id, kind, action, payload, requested_by, note)
  values (p_client_id, p_kind, p_action, v_payload, nullif(v_email, ''), v_note)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.airreach_request_create(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.airreach_request_create(uuid, text, text, jsonb, text) to authenticated;
