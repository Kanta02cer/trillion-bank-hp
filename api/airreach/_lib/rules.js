/**
 * 判定ルールの定義（assets/js/airreach-diagnose.js の FACTORS / analyze() と同値）。
 * API は点数を「計算し直して一致を確認」するだけで、点数の決め方は変えない。
 * 新しい RULE_VERSION を出すときは、ここと supabase/seed に同じ定義を追加する。
 */
export const FACTOR_IDS = ['structure', 'entity', 'faq', 'discover'];

export const RULES = {
  'airreach-common-v1': {
    factors: [
      { id: 'structure', weight: 0.3, required: true },
      { id: 'entity', weight: 0.25, required: true },
      { id: 'faq', weight: 0.2, required: true },
      { id: 'discover', weight: 0.25, required: false },
    ],
    // { factor, max, partialMax(ok でないときに入りうる部分点の上限) }
    checks: [
      { factor: 'structure', max: 2, partialMax: 0 },
      { factor: 'structure', max: 3, partialMax: 1 },
      { factor: 'structure', max: 2, partialMax: 0 },
      { factor: 'structure', max: 2, partialMax: 0 },
      { factor: 'structure', max: 1, partialMax: 0 },
      { factor: 'structure', max: 2, partialMax: 0 },
      { factor: 'entity', max: 4, partialMax: 0 },
      { factor: 'entity', max: 2, partialMax: 0 },
      { factor: 'entity', max: 2, partialMax: 0 },
      { factor: 'entity', max: 1, partialMax: 0 },
      { factor: 'entity', max: 1, partialMax: 0 },
      { factor: 'faq', max: 3, partialMax: 0 },
      { factor: 'faq', max: 3, partialMax: 1 },
      { factor: 'faq', max: 2, partialMax: 0 },
      { factor: 'discover', max: 4, partialMax: 0 },
      { factor: 'discover', max: 2, partialMax: 0 },
      { factor: 'discover', max: 2, partialMax: 0 },
      { factor: 'discover', max: 2, partialMax: 0 },
    ],
    maxAdjustments: 2,
  },
};

/** 表示区分の版（_data/airreach_display.yml の display_version）。 */
export const DISPLAY_VERSIONS = new Set(['band-v1']);
