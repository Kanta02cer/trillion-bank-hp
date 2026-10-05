-- ============================================================================
-- AirReach: 契約終了から 90 日以内に Google 由来のデータを消す処理を、毎日 DB の中で動かす（pg_cron）
-- Depends: 20261007120000_airreach_google_data_governance.sql
--
-- - 毎日 03:30 JST（18:30 UTC）に airreach_purge_expired_google_data(80) を実行する。
--   終了から 80 日たった顧客を消す（90 日以内に収めるための余裕 10 日。止まった日があっても間に合うように）
-- - Vercel の cron・環境変数・鍵を使わない（DB の中で完結する）
-- - 実行の結果は cron.job_run_details（pg_cron）と public.google_data_deletions に残る
-- - この migration は、20261007120000 を適用して動作を確かめたあとに、別に判断して適用する
-- 取り消し: select cron.unschedule('airreach-google-retention');
-- ============================================================================
create extension if not exists pg_cron;

select cron.unschedule(jobid) from cron.job where jobname = 'airreach-google-retention';
select cron.schedule('airreach-google-retention', '30 18 * * *', $$select public.airreach_purge_expired_google_data(80)$$);
