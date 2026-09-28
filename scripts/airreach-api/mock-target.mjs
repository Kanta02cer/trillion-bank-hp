/**
 * fetch 機能のテスト用ターゲットサイト。127.0.0.1:54322。
 * 通常ページ / llms.txt / robots.txt / リダイレクト各種 / 遅延 / 巨大応答 / 404 / 410 / 500 / PDF を返す。
 */
import http from 'node:http';

const PORT = Number(process.env.TARGET_PORT || 54322);
const HTML = '<!doctype html><html><head><title>Mock Site</title><meta name="description" content="A mock site for AirReach fetch tests, long enough to count."><link rel="canonical" href="http://127.0.0.1:54322/"></head><body><h1>Mock Site</h1><p>' + 'hello '.repeat(200) + '</p><section id="faq" class="faq">FAQ</section><a href="/contact">contact</a></body></html>';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;
  const send = (status, body, headers = {}) => { res.writeHead(status, headers); res.end(body); };
  if (p === '/') return send(200, HTML, { 'Content-Type': 'text/html; charset=utf-8' });
  if (p === '/llms.txt') return send(200, '# Mock Site\n\n> AI 向け案内。\n\n- /: トップ\n- /faq: よくある質問\n- /contact: 問い合わせ\n', { 'Content-Type': 'text/plain; charset=utf-8' });
  if (p === '/robots.txt') return send(200, 'User-agent: *\nAllow: /\nUser-agent: GPTBot\nAllow: /\nSitemap: http://127.0.0.1:54322/sitemap.xml\n', { 'Content-Type': 'text/plain' });
  if (p === '/redirect') return send(302, '', { Location: '/' });
  const chain = p.match(/^\/redirect-chain\/(\d+)$/);
  if (chain) { const n = Number(chain[1]); return send(302, '', { Location: n <= 1 ? '/' : `/redirect-chain/${n - 1}` }); }
  if (p === '/redirect-loop') return send(302, '', { Location: '/redirect-loop' });
  if (p === '/redirect-private') return send(302, '', { Location: 'http://169.254.169.254/latest/meta-data/' });
  if (p === '/redirect-localhost') return send(302, '', { Location: 'http://localhost:54322/' });
  if (p === '/no-location') return send(302, '');
  if (p === '/slow') { await new Promise((r) => setTimeout(r, 6000)); return send(200, HTML, { 'Content-Type': 'text/html' }); }
  if (p === '/big') { const body = Buffer.alloc(2 * 1024 * 1024, 97); return send(200, body, { 'Content-Type': 'text/html', 'Content-Length': String(body.length) }); }
  if (p === '/big-chunked') { res.writeHead(200, { 'Content-Type': 'text/html' }); const chunk = Buffer.alloc(64 * 1024, 98); for (let i = 0; i < 32; i += 1) res.write(chunk); return res.end(); }
  if (p === '/missing') return send(404, '<html>not found</html>', { 'Content-Type': 'text/html' });
  if (p === '/gone') return send(410, 'gone', { 'Content-Type': 'text/plain' });
  if (p === '/error') return send(500, 'boom', { 'Content-Type': 'text/plain' });
  if (p === '/pdf') return send(200, '%PDF-1.4', { 'Content-Type': 'application/pdf' });
  if (p === '/json') return send(200, '{"ok":true}', { 'Content-Type': 'application/json' });
  if (p === '/echo-ua') return send(200, String(req.headers['user-agent'] || ''), { 'Content-Type': 'text/plain' });
  send(404, 'nope', { 'Content-Type': 'text/plain' });
});
server.listen(PORT, '127.0.0.1', () => console.log(JSON.stringify({ mock: 'target', port: PORT })));
