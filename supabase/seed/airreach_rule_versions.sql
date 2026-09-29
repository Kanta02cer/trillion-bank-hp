-- ============================================================================
-- AirReach Phase 1 seed: rule_versions
-- Target : AirReach 専用 Supabase Project（ref: opjjxbdrgfyoydyrmzns）のみ
-- NEVER  : Hack2 Project（ref: inlnrdjdfccnhmskpyrs）には適用しない
--
-- 内容は assets/js/airreach-diagnose.js（RULE_VERSION / FACTORS / analyze() の check 定義）
-- と _data/airreach_display.yml（display_version）の写し。
-- コード側の版を変えたら、ここに行を追加する（既存行は書き換えない）。
-- 冪等: 同じ rule_version が既にあれば何もしない。
-- ============================================================================

insert into public.rule_versions (rule_version, factors, check_definitions, default_display_version, notes, published_at)
values (
  'airreach-common-v1',
  -- FACTORS（重み・必須）。総合 = Σ(score × weight) / Σweight（既知因子のみ）。必須因子が unknown なら総合は null。
  '[
    {"id": "structure", "label": "ページの骨格",     "weight": 0.30, "required": true},
    {"id": "entity",    "label": "会社・サービス情報", "weight": 0.25, "required": true},
    {"id": "faq",       "label": "よくある質問",     "weight": 0.20, "required": true},
    {"id": "discover",  "label": "見つけやすさ",     "weight": 0.25, "required": false}
  ]'::jsonb,
  -- 18 チェック。因子点 = 既知チェックの points 合計 / max_points 合計 × 100（減点適用後、下限 0）。
  -- partial_points は ok でなくても部分点が入る条件（H1 が 2 つ以上 / FAQ が 1〜2 問）。
  -- adjustments は取得できたときだけ適用する減点。
  '{
    "checks": [
      {"sort_order": 1,  "factor_id": "structure", "label": "ページタイトルがある",        "max_points": 2, "partial_points": 0},
      {"sort_order": 2,  "factor_id": "structure", "label": "H1が1つ",                    "max_points": 3, "partial_points": 1},
      {"sort_order": 3,  "factor_id": "structure", "label": "説明文（meta）が十分",        "max_points": 2, "partial_points": 0},
      {"sort_order": 4,  "factor_id": "structure", "label": "canonicalがある",            "max_points": 2, "partial_points": 0},
      {"sort_order": 5,  "factor_id": "structure", "label": "og:titleがある",             "max_points": 1, "partial_points": 0},
      {"sort_order": 6,  "factor_id": "structure", "label": "本文量がある",               "max_points": 2, "partial_points": 0},
      {"sort_order": 7,  "factor_id": "entity",    "label": "会社情報（Organization等）",  "max_points": 4, "partial_points": 0},
      {"sort_order": 8,  "factor_id": "entity",    "label": "WebSite / WebPage",          "max_points": 2, "partial_points": 0},
      {"sort_order": 9,  "factor_id": "entity",    "label": "Service / Product",          "max_points": 2, "partial_points": 0},
      {"sort_order": 10, "factor_id": "entity",    "label": "BreadcrumbList",             "max_points": 1, "partial_points": 0},
      {"sort_order": 11, "factor_id": "entity",    "label": "問い合わせ導線",             "max_points": 1, "partial_points": 0},
      {"sort_order": 12, "factor_id": "faq",       "label": "FAQPageがある",              "max_points": 3, "partial_points": 0},
      {"sort_order": 13, "factor_id": "faq",       "label": "FAQが3問以上",               "max_points": 3, "partial_points": 1},
      {"sort_order": 14, "factor_id": "faq",       "label": "画面上のFAQらしき領域",       "max_points": 2, "partial_points": 0},
      {"sort_order": 15, "factor_id": "discover",  "label": "llms.txtがある",             "max_points": 4, "partial_points": 0},
      {"sort_order": 16, "factor_id": "discover",  "label": "robots.txtがある",           "max_points": 2, "partial_points": 0},
      {"sort_order": 17, "factor_id": "discover",  "label": "主要AIボットの記載",         "max_points": 2, "partial_points": 0},
      {"sort_order": 18, "factor_id": "discover",  "label": "sitemap案内",                "max_points": 2, "partial_points": 0}
    ],
    "factor_max_points": {"structure": 12, "entity": 10, "faq": 8, "discover": 10},
    "adjustments": [
      {"factor_id": "discover", "label": "robots.txtが全体をDisallow", "points": -2, "applies_when": "robots.txt を取得できたとき"},
      {"factor_id": "discover", "label": "meta robotsにnoindex",       "points": -3, "applies_when": "ページを取得できたとき"}
    ],
    "sources": ["page", "llms", "robots"],
    "check_states": ["ok", "ng", "unknown"],
    "unknown_rule": "取得できなかったチェックは unknown。points は null で、因子点の分母にも入れない（0 点扱いにしない）"
  }'::jsonb,
  'band-v1',
  '初版。assets/js/airreach-diagnose.js の RULE_VERSION=airreach-common-v1 と同値。表示区分 band-v1（0-39 低い / 40-69 普通 / 70-100 高い、未確認は点数なし）は _data/airreach_display.yml が正本で、境界値は provisional（未承認）。',
  '2026-09-27T00:00:00+09:00'
)
on conflict (rule_version) do nothing;
