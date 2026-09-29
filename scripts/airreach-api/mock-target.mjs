/**
 * fetch 機能のテスト用ターゲットサイト。
 *   HTTP : 127.0.0.1:TARGET_PORT（既定 54322）
 *   HTTPS: TLS_KEY / TLS_CERT / TARGET_TLS_PORT を渡したときだけ起動（既定 54323）。/echo が SNI と Host を返す
 * 通常ページ / llms.txt / robots.txt / リダイレクト各種 / 遅延 / 巨大応答 / 404 / 410 / 500 / PDF / gzip を返す。
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

const PORT = Number(process.env.TARGET_PORT || 54322);
const TLS_PORT = Number(process.env.TARGET_TLS_PORT || 54323);
const HTML = '<!doctype html><html><head><title>Mock Site</title><meta name="description" content="A mock site for AirReach fetch tests, long enough to count."><link rel="canonical" href="http://127.0.0.1:54322/"></head><body><h1>Mock Site</h1><p>' + 'hello '.repeat(200) + '</p><section id="faq" class="faq">FAQ</section><a href="/contact">contact</a></body></html>';

async function handle(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;
  const send = (status, body, headers = {}) => { res.writeHead(status, headers); res.end(body); };
  if (p === '/') return send(200, HTML, { 'Content-Type': 'text/html; charset=utf-8' });
  if (p === '/echo') return send(200, JSON.stringify({ sni: req.socket.servername || null, host: req.headers.host || null, encrypted: !!req.socket.encrypted, remote: req.socket.remoteAddress }), { 'Content-Type': 'application/json' });
  if (p === '/echo-host') return send(200, JSON.stringify({ host: req.headers.host || null, remote: req.socket.remoteAddress }), { 'Content-Type': 'application/json' });
  if (p === '/llms.txt') return send(200, '# Mock Site\n\n> AI 向け案内。\n\n- /: トップ\n- /faq: よくある質問\n- /contact: 問い合わせ\n', { 'Content-Type': 'text/plain; charset=utf-8' });
  if (p === '/robots.txt') return send(200, 'User-agent: *\nAllow: /\nUser-agent: GPTBot\nAllow: /\nSitemap: http://127.0.0.1:54322/sitemap.xml\n', { 'Content-Type': 'text/plain' });
  if (p === '/redirect') return send(302, '', { Location: '/' });
  const chain = p.match(/^\/redirect-chain\/(\d+)$/);
  if (chain) { const n = Number(chain[1]); return send(302, '', { Location: n <= 1 ? '/' : `/redirect-chain/${n - 1}` }); }
  if (p === '/redirect-loop') return send(302, '', { Location: '/redirect-loop' });
  if (p === '/redirect-private') return send(302, '', { Location: 'http://169.254.169.254/latest/meta-data/' });
  if (p === '/redirect-localhost') return send(302, '', { Location: 'http://localhost:54322/' });
  if (p === '/redirect-to-rebind2') return send(302, '', { Location: `${req.socket.encrypted ? 'https' : 'http'}://rebind2.test:${req.socket.encrypted ? TLS_PORT : PORT}/echo` });
  if (p === '/redirect-to-private-name') return send(302, '', { Location: 'http://rebind-private.test/' });
  if (p === '/no-location') return send(302, '');
  if (p === '/slow') { await new Promise((r) => setTimeout(r, 6000)); return send(200, HTML, { 'Content-Type': 'text/html' }); }
  if (p === '/big') { const body = Buffer.alloc(2 * 1024 * 1024, 97); return send(200, body, { 'Content-Type': 'text/html', 'Content-Length': String(body.length) }); }
  if (p === '/big-chunked') { res.writeHead(200, { 'Content-Type': 'text/html' }); const chunk = Buffer.alloc(64 * 1024, 98); for (let i = 0; i < 32; i += 1) res.write(chunk); return res.end(); }
  if (p === '/gzip') { const body = zlib.gzipSync(Buffer.from(HTML)); return send(200, body, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip' }); }
  if (p === '/gzip-bomb') { const body = zlib.gzipSync(Buffer.alloc(3 * 1024 * 1024, 97)); return send(200, body, { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip', 'Content-Length': String(body.length) }); }
  if (p === '/missing') return send(404, '<html>not found</html>', { 'Content-Type': 'text/html' });
  if (p === '/gone') return send(410, 'gone', { 'Content-Type': 'text/plain' });
  if (p === '/error') return send(500, 'boom', { 'Content-Type': 'text/plain' });
  if (p === '/pdf') return send(200, '%PDF-1.4', { 'Content-Type': 'application/pdf' });
  if (p === '/json') return send(200, '{"ok":true}', { 'Content-Type': 'application/json' });
  if (p === '/echo-ua') return send(200, String(req.headers['user-agent'] || ''), { 'Content-Type': 'text/plain' });
  send(404, 'nope', { 'Content-Type': 'text/plain' });
}

http.createServer(handle).listen(PORT, '127.0.0.1', () => console.log(JSON.stringify({ mock: 'target', port: PORT })));
if (process.env.TLS_KEY && process.env.TLS_CERT) {
  https.createServer({ key: fs.readFileSync(process.env.TLS_KEY), cert: fs.readFileSync(process.env.TLS_CERT) }, handle)
    .listen(TLS_PORT, '127.0.0.1', () => console.log(JSON.stringify({ mock: 'target-tls', port: TLS_PORT })));
}
