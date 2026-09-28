-- ============================================================================
-- AirReach Phase 1 schema
-- Target : AirReach 専用 Supabase Project（ref: opjjxbdrgfyoydyrmzns）のみ
-- NEVER  : Hack2 Project（ref: inlnrdjdfccnhmskpyrs）には適用しない
-- Design : docs/airreach-supabase-phase1.md
--
-- 内容
--   1. テーブル 6 本（rule_versions / sites / scans / scan_factor_scores /
--      scan_checks / scan_evidence_sources）
--   2. RPC 2 本（SECURITY DEFINER, search_path 固定）
--        public.airreach_insert_scan()     1 診断を 1 トランザクションで書く
--        public.airreach_get_shared_scan() share_token の SHA-256 で 1 診断を読む
--   3. RLS 有効化、anon / authenticated からの権限剥奪、
--      service_role には RPC 2 本の EXECUTE だけを付与（テーブル権限はゼロ）
--
-- 方針
--   - scan_id（端末生成の公開 ID）と share_token（共有用の秘密）は分離する。
--     DB には share_token の SHA-256（hex 64 桁）だけを保存し、生トークンは保存しない。
--   - 点数は既存 assets/js/airreach-diagnose.js が計算した値をそのまま保存する。
--     未確認（unknown）は null であり 0 ではない。
--   - 読み書きは ops/airreach-api（Cloudflare Worker, service_role）→ RPC 経由のみ。
--     service_role にテーブルの SELECT / INSERT / UPDATE / DELETE は与えない。
--     鍵が漏れても「任意行の UPDATE」「全診断の一覧取得」はできない構成にする。
--     ブラウザ（anon）からは直接読み書きできない。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. tables
-- ----------------------------------------------------------------------------

-- 判定ルール（採点式）の版。assets/js/airreach-diagnose.js の RULE_VERSION と 1:1。
create table if not exists public.rule_versions (
  rule_version            text primary key,
  factors                 jsonb not null,
  check_definitions       jsonb not null,
  default_display_version text not null,
  notes                   text,
  published_at            timestamptz not null default now(),
  created_at              timestamptz not null default now()
);
comment on table  public.rule_versions is 'AirReach 判定ルール（採点式）の版。RULE_VERSION を変えたら行を追加する。';
comment on column public.rule_versions.factors is '因子定義 [{id,label,weight,required}]。airreach-diagnose.js の FACTORS の写し';
comment on column public.rule_versions.check_definitions is 'チェック定義 [{sort_order,factor_id,label,max_points,partial_points}]。airreach-diagnose.js analyze() の写し';
comment on column public.rule_versions.default_display_version is '公開時に組み合わせた表示区分の版（_data/airreach_display.yml の display_version）';

-- 診断対象サイト。正規化 URL ごとに 1 行。
create table if not exists public.sites (
  id               uuid primary key default gen_random_uuid(),
  normalized_url   text not null,
  host             text not null,
  display_name     text,
  industry_id      text,
  scan_count       integer not null default 0,
  first_scanned_at timestamptz,
  last_scanned_at  timestamptz,
  created_at       timestamptz not null default now(),
  constraint sites_normalized_url_key unique (normalized_url)
);
comment on table  public.sites is 'AirReach 診断対象サイト。normalized_url（小文字ホスト・fragment 除去・末尾スラッシュ正規化）で一意';
comment on column public.sites.display_name is 'サイトタイトルまたは H1（診断結果から）';

-- 診断 1 回の本体。
create table if not exists public.scans (
  id               text primary key,
  site_id          uuid not null references public.sites (id),
  share_token_hash text not null,
  share_revoked_at timestamptz,
  rule_version     text not null references public.rule_versions (rule_version),
  display_version  text not null,
  state            text not null,
  overall_score    smallint,
  industry_id      text not null,
  goal             text,
  outcome_goal     text,
  keyword          text,
  site_title       text,
  source           text not null default 'airreach_free',
  status           text not null default 'diagnosed',
  page             jsonb,
  summary          text,
  raw_result       jsonb not null,
  fetched_at       timestamptz,
  client_saved_at  timestamptz,
  created_at       timestamptz not null default now(),
  constraint scans_id_format_check          check (id ~ '^[a-z0-9]{8,32}$'),
  constraint scans_share_token_hash_key     unique (share_token_hash),
  constraint scans_share_token_hash_check   check (share_token_hash ~ '^[0-9a-f]{64}$'),
  constraint scans_display_version_check    check (length(display_version) between 1 and 64),
  constraint scans_state_check              check (state in ('verified', 'partial', 'failed', 'not_diagnosed')),
  constraint scans_overall_score_check      check (overall_score is null or overall_score between 0 and 100),
  constraint scans_goal_check               check (goal is null or goal in ('acquisition', 'visibility')),
  constraint scans_source_check             check (source in ('airreach_free', 'sales_mode', 'expert')),
  constraint scans_status_check             check (status in ('diagnosed', 'proposed', 'won', 'active', 'closed'))
);
comment on table  public.scans is 'AirReach 診断 1 回 = 1 行。id は端末生成の scanId（公開 ID）。共有は share_token_hash 経由のみ';
comment on column public.scans.share_token_hash is '共有トークン（32 byte CSPRNG, base64url）の SHA-256 hex。生トークンは保存しない';
comment on column public.scans.share_revoked_at is '非 null なら共有リンク失効（Phase 2 で使用）';
comment on column public.scans.display_version is '表示区分の版（_data/airreach_display.yml の display_version）。境界値の正本はリポジトリ';
comment on column public.scans.overall_score is '総合点 0-100。必須因子が未確認なら null（0 ではない）';
comment on column public.scans.status is 'Phase 1 では diagnosed 固定。変更は Phase 2 の認証ユーザーのみ';
comment on column public.scans.page is 'title / h1 / types / faqCount / faqAnchor / hasLlms / hasRobots / baseHref / finalUrl';
comment on column public.scans.raw_result is 'airreach-diagnose.js diagnose() の戻り値全体。共有表示の再現と監査に使う';
comment on column public.scans.created_at is 'サーバ受理時刻。画面の「診断日時」はこの値';

create index if not exists scans_site_id_created_at_idx on public.scans (site_id, created_at desc);
create index if not exists scans_created_at_idx         on public.scans (created_at desc);
create index if not exists scans_rule_version_idx       on public.scans (rule_version);

-- 項目別（4 因子）の点数。
create table if not exists public.scan_factor_scores (
  scan_id      text not null references public.scans (id) on delete cascade,
  factor_id    text not null,
  score        smallint,
  weight       numeric(4, 2) not null,
  required     boolean not null,
  state        text not null,
  known_checks smallint not null,
  total_checks smallint not null,
  constraint scan_factor_scores_pkey          primary key (scan_id, factor_id),
  constraint scan_factor_scores_factor_check  check (factor_id in ('structure', 'entity', 'faq', 'discover')),
  constraint scan_factor_scores_score_check   check (score is null or score between 0 and 100),
  constraint scan_factor_scores_state_check   check (state in ('verified', 'partial', 'unknown')),
  constraint scan_factor_scores_counts_check  check (known_checks between 0 and total_checks)
);
comment on table public.scan_factor_scores is '診断 × 因子。score は既知チェックだけで計算、全て未確認なら null';

-- 18 チェックの 3 値判定と根拠 URL。
create table if not exists public.scan_checks (
  id                  bigint generated always as identity primary key,
  scan_id             text not null references public.scans (id) on delete cascade,
  sort_order          smallint not null,
  factor_id           text not null,
  label               text not null,
  state               text not null,
  points              smallint,
  max_points          smallint not null,
  evidence_url        text,
  evidence_final_url  text,
  evidence_anchor     text,
  evidence_via        text,
  evidence_fetched_at timestamptz,
  evidence_verified   boolean not null default false,
  constraint scan_checks_scan_sort_key   unique (scan_id, sort_order),
  constraint scan_checks_factor_check    check (factor_id in ('structure', 'entity', 'faq', 'discover')),
  constraint scan_checks_state_check     check (state in ('ok', 'ng', 'unknown')),
  constraint scan_checks_points_check    check (points is null or (points >= 0 and points <= max_points)),
  constraint scan_checks_unknown_check   check (state <> 'unknown' or points is null),
  constraint scan_checks_via_check       check (evidence_via is null or evidence_via in ('direct', 'first_party_proxy', 'third_party_proxy'))
);
comment on table  public.scan_checks is '診断 × チェック。state=unknown は取得不能で points null（0 ではない）';
comment on column public.scan_checks.evidence_final_url is '取得時のリダイレクト後 URL。根拠リンクはこれを使う';
comment on column public.scan_checks.evidence_anchor is '取得 HTML に実在した id だけ。推測しない';

-- page / llms.txt / robots.txt の取得記録。
create table if not exists public.scan_evidence_sources (
  scan_id       text not null references public.scans (id) on delete cascade,
  kind          text not null,
  requested_url text,
  final_url     text,
  http_status   smallint,
  fetch_state   text not null,
  via           text,
  fetched_at    timestamptz,
  error         text,
  constraint scan_evidence_sources_pkey        primary key (scan_id, kind),
  constraint scan_evidence_sources_kind_check  check (kind in ('page', 'llms', 'robots')),
  constraint scan_evidence_sources_state_check check (fetch_state in ('ok', 'missing', 'failed')),
  constraint scan_evidence_sources_via_check   check (via is null or via in ('direct', 'first_party_proxy', 'third_party_proxy'))
);
comment on table public.scan_evidence_sources is '診断 × 取得元（page/llms/robots）。missing=取得できて無い、failed=取得できず';

-- ----------------------------------------------------------------------------
-- 2. RPC
--    共通方針
--    - SECURITY DEFINER: 所有者 postgres の権限で動く。service_role はテーブル権限を持たず、
--      この関数の EXECUTE だけで書く/読む。関数が許す操作以外は不可能。
--    - set search_path = '' と全オブジェクトのスキーマ修飾で、検索パス差し替えを防ぐ。
--    - 引数は jsonb。関数内で列に分解して型と CHECK を通す。動的 SQL は使わない。
--    - anon / authenticated / PUBLIC から EXECUTE を剥奪する。
--
-- 2-1. airreach_insert_scan: 1 診断を 1 トランザクションで書く
--    - scans に対する操作は INSERT のみ。UPDATE / DELETE の経路は無い
--    - scans.id 重複 → unique_violation で全体ロールバック（Worker は 409 を返す）
--    - rule_version 未登録 → foreign_key_violation（Worker は 422 を返す。seed で先に登録する）
-- ----------------------------------------------------------------------------
create or replace function public.airreach_insert_scan(
  p_site     jsonb,
  p_scan     jsonb,
  p_factors  jsonb,
  p_checks   jsonb,
  p_sources  jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_scan_id text;
begin
  insert into public.sites (normalized_url, host, display_name, industry_id, scan_count, first_scanned_at, last_scanned_at)
  values (
    p_site->>'normalized_url',
    p_site->>'host',
    nullif(p_site->>'display_name', ''),
    nullif(p_site->>'industry_id', ''),
    1, now(), now()
  )
  on conflict (normalized_url) do update
    set last_scanned_at = now(),
        scan_count      = public.sites.scan_count + 1,
        display_name    = coalesce(excluded.display_name, public.sites.display_name),
        industry_id     = coalesce(excluded.industry_id,  public.sites.industry_id)
  returning id into v_site_id;

  insert into public.scans (
    id, site_id, share_token_hash, rule_version, display_version, state,
    overall_score, industry_id, goal, outcome_goal, keyword, site_title,
    source, page, summary, raw_result, fetched_at, client_saved_at
  )
  select
    s.id, v_site_id, s.share_token_hash, s.rule_version, s.display_version, s.state,
    s.overall_score, s.industry_id, s.goal, s.outcome_goal, s.keyword, s.site_title,
    coalesce(s.source, 'airreach_free'), s.page, s.summary, s.raw_result, s.fetched_at, s.client_saved_at
  from jsonb_to_record(p_scan) as s (
    id text, share_token_hash text, rule_version text, display_version text, state text,
    overall_score smallint, industry_id text, goal text, outcome_goal text, keyword text,
    site_title text, source text, page jsonb, summary text, raw_result jsonb,
    fetched_at timestamptz, client_saved_at timestamptz
  )
  returning id into v_scan_id;

  insert into public.scan_factor_scores (scan_id, factor_id, score, weight, required, state, known_checks, total_checks)
  select v_scan_id, f.factor_id, f.score, f.weight, f.required, f.state, f.known_checks, f.total_checks
  from jsonb_to_recordset(p_factors) as f (
    factor_id text, score smallint, weight numeric, required boolean,
    state text, known_checks smallint, total_checks smallint
  );

  insert into public.scan_checks (
    scan_id, sort_order, factor_id, label, state, points, max_points,
    evidence_url, evidence_final_url, evidence_anchor, evidence_via, evidence_fetched_at, evidence_verified
  )
  select
    v_scan_id, c.sort_order, c.factor_id, c.label, c.state, c.points, c.max_points,
    c.evidence_url, c.evidence_final_url, nullif(c.evidence_anchor, ''), c.evidence_via, c.evidence_fetched_at,
    coalesce(c.evidence_verified, false)
  from jsonb_to_recordset(p_checks) as c (
    sort_order smallint, factor_id text, label text, state text, points smallint, max_points smallint,
    evidence_url text, evidence_final_url text, evidence_anchor text, evidence_via text,
    evidence_fetched_at timestamptz, evidence_verified boolean
  );

  insert into public.scan_evidence_sources (scan_id, kind, requested_url, final_url, http_status, fetch_state, via, fetched_at, error)
  select v_scan_id, e.kind, e.requested_url, e.final_url, e.http_status, e.fetch_state, e.via, e.fetched_at, e.error
  from jsonb_to_recordset(p_sources) as e (
    kind text, requested_url text, final_url text, http_status smallint,
    fetch_state text, via text, fetched_at timestamptz, error text
  );

  return v_scan_id;
end
$$;
comment on function public.airreach_insert_scan(jsonb, jsonb, jsonb, jsonb, jsonb) is
  'AirReach: 1 診断（site upsert + scans + factor_scores + checks + evidence_sources）を 1 トランザクションで書く。SECURITY DEFINER。service_role のみ実行可';

revoke execute on function public.airreach_insert_scan(jsonb, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2-2. airreach_get_shared_scan: share_token の SHA-256（hex 64 桁）で 1 診断を読む
--    - 該当なし / 失効済み / 形式不正 → null（Worker は 404 を返す）
--    - share_token_hash は返さない
--    - service_role はこの関数以外で scans を読めないため、鍵が漏れても一覧取得はできない
-- ----------------------------------------------------------------------------
create or replace function public.airreach_get_shared_scan(p_share_token_hash text)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'scan', jsonb_build_object(
      'id',             s.id,
      'url',            si.normalized_url,
      'host',           si.host,
      'industryId',     s.industry_id,
      'goal',           s.goal,
      'outcomeGoal',    s.outcome_goal,
      'keyword',        s.keyword,
      'siteTitle',      s.site_title,
      'state',          s.state,
      'overallScore',   s.overall_score,
      'ruleVersion',    s.rule_version,
      'displayVersion', s.display_version,
      'source',         s.source,
      'status',         s.status,
      'summary',        s.summary,
      'page',           s.page,
      'fetchedAt',      s.fetched_at,
      'createdAt',      s.created_at
    ),
    'factors', (
      select coalesce(jsonb_agg(to_jsonb(f) - 'scan_id' order by f.factor_id), '[]'::jsonb)
      from public.scan_factor_scores f where f.scan_id = s.id
    ),
    'checks', (
      select coalesce(jsonb_agg(to_jsonb(c) - 'id' - 'scan_id' order by c.sort_order), '[]'::jsonb)
      from public.scan_checks c where c.scan_id = s.id
    ),
    'sources', (
      select coalesce(jsonb_agg(to_jsonb(e) - 'scan_id' order by e.kind), '[]'::jsonb)
      from public.scan_evidence_sources e where e.scan_id = s.id
    ),
    'result', s.raw_result
  )
  from public.scans s
  join public.sites si on si.id = s.site_id
  where p_share_token_hash ~ '^[0-9a-f]{64}$'
    and s.share_token_hash = p_share_token_hash
    and s.share_revoked_at is null;
$$;
comment on function public.airreach_get_shared_scan(text) is
  'AirReach: share_token の SHA-256 で共有用の診断 1 件を読む。該当なし/失効は null。SECURITY DEFINER。service_role のみ実行可';

revoke execute on function public.airreach_get_shared_scan(text)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. RLS と権限
--    Phase 1: ポリシーは作らない（= anon / authenticated は 0 行）。
--             さらにテーブル権限自体を剥奪して二重に閉じる。
--             service_role は RLS をバイパスし、Worker だけがこの鍵を持つ。
--    Phase 2: authenticated に対して RLS ポリシー付きで SELECT を「明示 GRANT」で限定再付与する。
--
--    実測（2026-09-28, AirReach Project, pg_default_acl）:
--      postgres ロールが public に作るオブジェクトの既定 ACL は
--        tables    : anon / authenticated / service_role = Dxtm（TRUNCATE/REFERENCES/TRIGGER/MAINTAIN のみ。DML なし）
--        sequences : postgres のみ
--        functions : postgres のみ（PUBLIC の EXECUTE も無い）
--      したがって service_role が RPC とテーブルを使うには明示 GRANT が必須。
--      既定権限に依存せず、必要な権限はすべてこのファイルに書く。
-- ----------------------------------------------------------------------------
alter table public.rule_versions         enable row level security;
alter table public.sites                 enable row level security;
alter table public.scans                 enable row level security;
alter table public.scan_factor_scores    enable row level security;
alter table public.scan_checks           enable row level security;
alter table public.scan_evidence_sources enable row level security;

revoke all on table public.rule_versions,
                    public.sites,
                    public.scans,
                    public.scan_factor_scores,
                    public.scan_checks,
                    public.scan_evidence_sources
  from anon, authenticated;

revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- 以後 postgres ロールが public に作るオブジェクトにも既定権限を与えない
-- （Phase 2 で authenticated に必要な権限は、各 migration で明示 GRANT する）
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

-- service_role（Worker 専用）: RPC 2 本の EXECUTE だけ。テーブル・sequence の権限はゼロ。
-- 既定 ACL で付く TRUNCATE / REFERENCES / TRIGGER / MAINTAIN も外す。
-- SECURITY DEFINER の関数は所有者 postgres の権限で動くため、service_role に sequence 権限は不要。
grant usage on schema public to service_role;
revoke all on table public.rule_versions,
                    public.sites,
                    public.scans,
                    public.scan_factor_scores,
                    public.scan_checks,
                    public.scan_evidence_sources
  from service_role;
revoke all on all sequences in schema public from service_role;
grant execute on function public.airreach_insert_scan(jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.airreach_get_shared_scan(text)                       to service_role;
