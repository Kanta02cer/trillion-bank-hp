-- 20261003120000_airreach_studio_workspaces を取り消す。
-- 注意: 共有していた Studio の作業（studio_workspaces）は消える。各ブラウザに残っている作業はそのまま。必要なら先に書き出す。
drop function if exists public.airreach_studio_save(uuid, jsonb, integer);
drop table if exists public.studio_workspaces;
