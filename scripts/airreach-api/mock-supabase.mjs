/**
 * ローカルテスト用の PostgREST モック。
 * 実装する経路は本物と同じ 2 本だけ:
 *   POST /rest/v1/rpc/airreach_insert_scan
 *   POST /rest/v1/rpc/airreach_get_shared_scan
 * それ以外の /rest/v1/* は「テーブル直接アクセス」として記録し 404 を返す（テストで 0 件を確認する）。
 * エラーは PostgREST と同じ形 { code, message, details, hint } と HTTP 状態で返す。
 * 制御用: /__mock/state, /__mock/mode, /__mock/revoke, /__mock/reset
 */
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 54321);
const KEY = process.env.MOCK_SERVICE_KEY || 'test-service-key';
const KNOWN_RULES = new Set(['airreach-common-v1']);

const state = { mode: 'ok', scans: new Map(), sites: new Map(), forbiddenPaths: [], calls: [], lastInsertArgs: null };

function send(res, status, body, headers = {}) {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(text);
}
function pgError(res, http, code, message, details = null) {
  send(res, http, { code, message, details, hint: null });
}
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  // ---- control endpoints --------------------------------------------------
  if (path.startsWith('/__mock/')) {
    if (path === '/__mock/state') return send(res, 200, { mode: state.mode, scans: [...state.scans.keys()], hashes: [...state.scans.values()].map((x) => x.share_token_hash), sites: [...state.sites.keys()], forbiddenPaths: state.forbiddenPaths, calls: state.calls, lastInsertArgs: state.lastInsertArgs });
    const body = req.method === 'POST' ? await readJson(req) : {};
    if (path === '/__mock/mode') { state.mode = body.mode || 'ok'; return send(res, 200, { mode: state.mode }); }
    if (path === '/__mock/revoke') { const s = state.scans.get(body.id); if (s) s.share_revoked_at = new Date().toISOString(); return send(res, 200, { revoked: !!s }); }
    if (path === '/__mock/reset') { state.scans.clear(); state.sites.clear(); state.forbiddenPaths = []; state.calls = []; state.mode = 'ok'; state.lastInsertArgs = null; return send(res, 200, { ok: true }); }
    return send(res, 404, { error: 'unknown control' });
  }

  // ---- auth (service_role のヘッダが両方あること) ----------------------------
  if (req.headers.apikey !== KEY || req.headers.authorization !== `Bearer ${KEY}`) {
    return send(res, 401, { message: 'Invalid API key', hint: 'Double check your Supabase `anon` or `service_role` API key.' });
  }

  // ---- failure modes -------------------------------------------------------
  if (state.mode === 'error500') { res.writeHead(500, { 'Content-Type': 'text/html' }); return res.end('<html>upstream error</html>'); }
  if (state.mode === 'hang') { await new Promise((r) => setTimeout(r, 20000)); return send(res, 200, null); }

  // ---- only the two RPCs ----------------------------------------------------
  if (req.method === 'POST' && path === '/rest/v1/rpc/airreach_insert_scan') {
    const args = await readJson(req);
    state.calls.push('insert');
    state.lastInsertArgs = args;
    for (const k of ['p_site', 'p_scan', 'p_factors', 'p_checks', 'p_sources']) if (!(k in args)) return pgError(res, 404, 'PGRST202', `Could not find the function public.airreach_insert_scan without parameter ${k}`);
    const scan = args.p_scan;
    if (state.scans.has(scan.id)) return pgError(res, 409, '23505', 'duplicate key value violates unique constraint "scans_pkey"', `Key (id)=(${scan.id}) already exists.`);
    if (!KNOWN_RULES.has(scan.rule_version)) return pgError(res, 409, '23503', 'insert or update on table "scans" violates foreign key constraint "scans_rule_version_fkey"', `Key (rule_version)=(${scan.rule_version}) is not present in table "rule_versions".`);
    if (!/^[0-9a-f]{64}$/.test(scan.share_token_hash || '')) return pgError(res, 400, '23514', 'new row for relation "scans" violates check constraint "scans_share_token_hash_check"');
    if (!/^[a-z0-9]{8,32}$/.test(scan.id || '')) return pgError(res, 400, '23514', 'new row for relation "scans" violates check constraint "scans_id_format_check"');
    const site = state.sites.get(args.p_site.normalized_url) || { ...args.p_site, scan_count: 0 };
    site.scan_count += 1;
    state.sites.set(args.p_site.normalized_url, site);
    state.scans.set(scan.id, { ...scan, share_revoked_at: null, created_at: new Date().toISOString(), site, factors: args.p_factors, checks: args.p_checks, sources: args.p_sources });
    return send(res, 200, scan.id);
  }

  if (req.method === 'POST' && path === '/rest/v1/rpc/airreach_get_shared_scan') {
    const args = await readJson(req);
    state.calls.push('get');
    const h = args.p_share_token_hash;
    if (!/^[0-9a-f]{64}$/.test(h || '')) return send(res, 200, null);
    const s = [...state.scans.values()].find((x) => x.share_token_hash === h && !x.share_revoked_at);
    if (!s) return send(res, 200, null);
    return send(res, 200, {
      scan: { id: s.id, url: s.site.normalized_url, host: s.site.host, industryId: s.industry_id, goal: s.goal, outcomeGoal: s.outcome_goal, keyword: s.keyword, siteTitle: s.site_title, state: s.state, overallScore: s.overall_score, ruleVersion: s.rule_version, displayVersion: s.display_version, source: s.source, status: 'diagnosed', summary: s.summary, page: s.page, fetchedAt: s.fetched_at, createdAt: s.created_at },
      factors: s.factors,
      checks: s.checks.map(({ scan_id, ...c }) => c),
      sources: s.sources,
      result: s.raw_result,
    });
  }

  if (path.startsWith('/rest/v1/')) {
    state.forbiddenPaths.push(`${req.method} ${path}`);
    return pgError(res, 404, 'PGRST205', `Could not find the table or function ${path} in the schema cache`);
  }
  send(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(JSON.stringify({ mock: 'supabase', port: PORT }));
});
