-- 取り消し: AI計測の定期実行（20261005120000_airreach_measurement_schedules.sql）
--   定期計測で作った計測の記録（measurement_runs.source='schedule'）は残す。source の制約は残したまま戻す
drop function if exists public.airreach_schedule_claim_job(uuid, timestamptz);
drop function if exists public.airreach_schedule_finish(uuid, text, jsonb, integer, integer, integer, numeric, text, timestamptz);
drop function if exists public.airreach_schedule_request_now(uuid, jsonb);
drop function if exists public.airreach_schedule_claim(timestamptz, jsonb, integer);
drop function if exists public.airreach_schedule_usage(uuid, timestamptz);
drop table if exists public.measurement_jobs;
drop table if exists public.measurement_schedules;
