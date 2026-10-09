/**
 * Supabase への唯一の経路。PostgREST の RPC 2 本だけを呼ぶ。
 *   POST {SUPABASE_URL}/rest/v1/rpc/airreach_insert_scan
 *   POST {SUPABASE_URL}/rest/v1/rpc/airreach_get_shared_scan
 * テーブル（/rest/v1/scans 等）への直接アクセスはコード上で不可能にする（ALLOWED_RPC 以外は組み立てない）。
 * service_role key はヘッダにだけ載せ、ログ・エラー・レスポンスに含めない。
 */
import { ApiError } from './errors.js';
import { env } from './env.js';

const ALLOWED_RPC = { insertScan: 'airreach_insert_scan', getSharedScan: 'airreach_get_shared_scan' };

export class SupabaseRpc {
  constructor(cfg = env()) {
    const url = cfg.supabaseUrl;
    const key = cfg.supabaseServiceRoleKey;
    if (!url || !key) throw ApiError.internal('supabase_not_configured');
    let parsed;
    try { parsed = new URL(url); } catch { throw ApiError.internal('supabase_url_invalid'); }
    const isLocal = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (parsed.protocol !== 'https:' && !isLocal) throw ApiError.internal('supabase_url_must_be_https');
    this.baseUrl = url;
    this.key = key;
    this.timeoutMs = cfg.supabaseTimeoutMs;
  }

  /** 1 診断を保存。戻り値は scan id。重複は 409、rule_version 未登録は 422。 */
  async insertScan(args) {
    const out = await this.rpc(ALLOWED_RPC.insertScan, { ...args });
    if (typeof out !== 'string' || !out) throw ApiError.internal('rpc_insert_unexpected_result');
    return out;
  }

  /** share_token の SHA-256 で 1 件取得。該当なし / 失効は null。 */
  async getSharedScan(shareTokenHash) {
    const out = await this.rpc(ALLOWED_RPC.getSharedScan, { p_share_token_hash: shareTokenHash });
    if (out === null || out === undefined) return null;
    if (typeof out !== 'object' || Array.isArray(out)) throw ApiError.internal('rpc_get_unexpected_result');
    if (!out.scan || typeof out.scan !== 'object') throw ApiError.internal('rpc_get_unexpected_shape');
    return {
      scan: out.scan,
      factors: Array.isArray(out.factors) ? out.factors : [],
      checks: Array.isArray(out.checks) ? out.checks : [],
      sources: Array.isArray(out.sources) ? out.sources : [],
      result: out.result ?? null,
    };
  }

  async rpc(name, body) {
    if (!Object.values(ALLOWED_RPC).includes(name)) throw ApiError.internal('rpc_not_allowed');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(`${this.baseUrl}/rest/v1/rpc/${name}`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          apikey: this.key,
          Authorization: `Bearer ${this.key}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
      throw ApiError.dependency(/abort/i.test(msg) ? 'supabase_timeout' : 'supabase_unreachable');
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (res.ok) {
      if (!text) return null;
      try { return JSON.parse(text); } catch { throw ApiError.internal('supabase_invalid_json'); }
    }
    let pgErr = {};
    try { pgErr = text ? JSON.parse(text) : {}; } catch { pgErr = {}; }
    throw mapPostgrestError(res.status, pgErr, name);
  }
}

/** PostgREST / Postgres のエラーを API のエラーへ写す。本文はブラウザへ返さない。 */
function mapPostgrestError(status, err, rpc) {
  const code = typeof err.code === 'string' ? err.code : '';
  const hint = `rpc=${rpc} http=${status} pg=${code || '-'} msg=${String(err.message || '').slice(0, 120)}`;
  if (code === '23505') return new ApiError(409, 'conflict', 'Scan already exists', [], hint);
  if (code === '23503') return new ApiError(422, 'validation_failed', 'Unknown rule version', ['result.ruleVersion is not registered'], hint);
  if (['23514', '22P02', '22003', '22007', '22001'].includes(code)) return new ApiError(422, 'validation_failed', 'Stored value rejected', ['payload violates a database constraint'], hint);
  if (code === '42501' || status === 401 || status === 403) return ApiError.internal(hint);
  if (status >= 500 || status === 429 || status === 408) return ApiError.dependency(hint);
  return ApiError.internal(hint);
}
