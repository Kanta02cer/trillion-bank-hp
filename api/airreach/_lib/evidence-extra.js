/**
 * 診断の根拠（任意項目）の整形。月次レポートで「診断の範囲」「AI ボットの許可・拒否」「構造化データの中身」を出すために保存する。
 *
 *  - どれも任意。形が崩れていても保存自体は止めず、その項目を捨てる（null）。必須項目の検証は validate.js が行う
 *  - 文字数・件数に上限を設け、許可した項目だけを残す（受け取った JSON をそのまま保存しない）
 *  - robots.txt の全文と、構造化データの元の JSON は保存しない
 */
import { sanitizeHttpUrl } from './url.js';

const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? (v.replace(CONTROL_RE, '').trim().slice(0, max) || null) : null);
const int = (v, min, max) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);
const oneOf = (v, list) => (typeof v === 'string' && list.includes(v) ? v : null);
const iso = (v) => (typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);
function url(v) {
  if (typeof v !== 'string' || !v) return null;
  try { return sanitizeHttpUrl(v, { maxLength: 2048 }); } catch { return null; }
}

const FETCH_STATES = ['ok', 'missing', 'failed'];
const VIA = ['direct', 'first_party_proxy', 'third_party_proxy'];
const ROLES = ['menu', 'access', 'reserve', 'faq'];
const BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'];
const LD_FIELDS = ['name', 'url', 'telephone', 'address', 'openingHours', 'openingHoursSpecification', 'priceRange', 'servesCuisine',
  'acceptsReservations', 'logo', 'image', 'description', 'sameAs', 'questions'];

/** result.scope: 点数に使ったページ・下層ページ・案内ファイルの取得結果 */
export function scopeOut(v) {
  if (!isObj(v)) return null;
  const file = (o) => (isObj(o) ? { url: url(o.url), state: oneOf(o.state, FETCH_STATES), status: int(o.status, 100, 599) } : null);
  const page = isObj(v.page) ? { url: url(v.page.url), finalUrl: url(v.page.finalUrl), status: int(v.page.status, 100, 599), via: oneOf(v.page.via, VIA) } : null;
  if (!page || !page.url) return null;
  const subpages = (Array.isArray(v.subpages) ? v.subpages.slice(0, 8) : [])
    .filter(isObj)
    .map((s) => ({ url: url(s.url), role: oneOf(s.role, ROLES), ok: s.ok === true, status: int(s.status, 100, 599) }))
    .filter((s) => s.url);
  return { diagnosedAt: iso(v.diagnosedAt), page, subpages, llms: file(v.llms), robots: file(v.robots) };
}

/** result.robots: AI ボットごとの許可・拒否と、根拠になった行（ボットごとに最大 12 行） */
export function robotsOut(v) {
  if (!isObj(v)) return null;
  const bots = (Array.isArray(v.bots) ? v.bots.slice(0, 12) : [])
    .filter((b) => isObj(b) && BOTS.includes(b.name))
    .map((b) => ({
      name: b.name,
      org: str(b.org, 60),
      via: oneOf(b.via, ['own', 'star', 'none']),
      verdict: oneOf(b.verdict, ['allowed', 'partial', 'blocked', 'unspecified']),
      // 根拠の行は { n: 行番号, text: 行の中身 }（diagnose.js の parseRobots と同じ形）
      lines: (Array.isArray(b.lines) ? b.lines.slice(0, 12) : [])
        .map((l) => (isObj(l) ? { n: int(l.n, 1, 100000), text: str(l.text, 200) } : null))
        .filter((l) => l && l.text),
    }));
  return { state: oneOf(v.state, FETCH_STATES), status: int(v.status, 100, 599), url: url(v.url), fetchedAt: iso(v.fetchedAt), bots };
}

/** result.page.ld: 構造化データの種類と主な項目（元の JSON は保存しない） */
export function ldOut(v) {
  if (!isObj(v)) return null;
  const blocks = (Array.isArray(v.blocks) ? v.blocks.slice(0, 12) : [])
    .filter(isObj)
    .map((b) => {
      const types = (Array.isArray(b.types) ? b.types.slice(0, 5) : []).map((t) => str(t, 80)).filter(Boolean);
      const fields = {};
      if (isObj(b.fields)) for (const k of LD_FIELDS) { const s = str(b.fields[k], 400); if (s) fields[k] = s; }
      return { types, fields };
    })
    .filter((b) => b.types.length);
  return { blocks, scripts: int(v.scripts, 0, 100) ?? 0, errors: int(v.errors, 0, 100) ?? 0 };
}
