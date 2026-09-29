/**
 * Vercel Node.js Functions をローカルで動かす最小ハーネス（vercel CLI 不要）。
 * Vercel が付与する req.query / req.body / res.status() / res.json() / res.send() を同じ意味で用意し、
 * api/airreach/*.js のハンドラをそのまま呼ぶ。本番の挙動を置き換えるものではなく、ローカル検証用。
 *
 *   node scripts/airreach-api/local-server.mjs   # PORT=3900
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PORT = Number(process.env.PORT || 3900);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// SITE_DIR を渡すと、ビルド済み Jekyll サイト（_site）を同じ origin で配信する（Vercel の cleanUrls / trailingSlash 相当）
const SITE_DIR = process.env.SITE_DIR ? path.resolve(process.env.SITE_DIR) : null;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4' };

function serveStatic(req, res, url) {
  if (!SITE_DIR) return false;
  let p = decodeURIComponent(url.pathname);
  if (p.includes('..')) { res.writeHead(400); res.end(); return true; }
  const full = path.join(SITE_DIR, p);
  if (!full.startsWith(SITE_DIR)) { res.writeHead(400); res.end(); return true; }
  const sendFile = (file) => {
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  };
  if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
    if (!p.endsWith('/')) { res.writeHead(308, { Location: p + '/' + url.search }); res.end(); return true; }
    const index = path.join(full, 'index.html');
    if (fs.existsSync(index)) { sendFile(index); return true; }
  } else if (fs.existsSync(full)) { sendFile(full); return true; }
  else if (fs.existsSync(full + '.html')) { sendFile(full + '.html'); return true; }
  res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('NOT_FOUND'); return true;
}
const ROUTES = [
  { re: /^\/api\/airreach\/health\/?$/, file: 'api/airreach/health.js' },
  { re: /^\/api\/airreach\/scans\/?$/, file: 'api/airreach/scans.js' },
  { re: /^\/api\/airreach\/shared-scans\/?$/, file: 'api/airreach/shared-scans.js' },
  // vercel.json の rewrite（/shared-scans/:shareToken → /shared-scans?shareToken=）を模す
  { re: /^\/api\/airreach\/shared-scans\/([^/]+)\/?$/, file: 'api/airreach/shared-scans.js', param: 'shareToken' },
  { re: /^\/api\/airreach\/fetch\/?$/, file: 'api/airreach/fetch.js' },
];

const handlers = new Map();
async function loadHandler(file) {
  if (!handlers.has(file)) handlers.set(file, (await import(pathToFileURL(path.join(ROOT, file)).href)).default);
  return handlers.get(file);
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const route = ROUTES.find((r) => r.re.test(url.pathname));
  if (!route) {
    if (serveStatic(req, res, url)) return;
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'NOT_FOUND' }));
    return;
  }
  // Vercel の trailingSlash: true と同じく、末尾スラッシュ無しの API パスは 308 で付け直す
  if (!url.pathname.endsWith('/') && !/\.[a-z0-9]+$/i.test(url.pathname)) { res.writeHead(308, { Location: url.pathname + '/' + url.search }); res.end(); return; }
  // Vercel 互換のヘルパー
  req.query = Object.fromEntries(url.searchParams.entries());
  if (route.param) req.query[route.param] = url.pathname.match(route.re)[1];
  const raw = await readRaw(req);
  const ct = String(req.headers['content-type'] || '');
  if (raw.length === 0) req.body = undefined;
  else if (/^application\/json/i.test(ct)) {
    const text = raw.toString('utf8');
    try { req.body = JSON.parse(text); } catch { req.body = text; }
  } else if (/^text\//i.test(ct) || /urlencoded/i.test(ct)) req.body = raw.toString('utf8');
  else req.body = raw;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); return res; };
  res.send = (body) => { res.end(body); return res; };

  try {
    const handler = await loadHandler(route.file);
    await handler(req, res);
    if (!res.writableEnded) res.end();
  } catch (err) {
    console.error(JSON.stringify({ harness: 'unhandled', message: String(err && err.message || err) }));
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'FUNCTION_INVOCATION_FAILED' }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(JSON.stringify({ harness: 'airreach-api local', port: PORT, site: SITE_DIR || null }));
});
