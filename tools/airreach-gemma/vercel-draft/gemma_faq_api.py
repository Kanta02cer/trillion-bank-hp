"""
【下書き・未配置】Vercel の Python Function として置くときの形（api/airreach/gemma-faq.py の想定）。
このファイルは tools/ の下にあり、配信されない（Jekyll の exclude・配信用ブランチには api/ だけを入れる）。

POST /api/airreach/gemma-faq   Authorization: Bearer <AirReach のログインのトークン>
  {"text": "サイトの本文（6000文字まで）", "url": "本文を取ったページの URL（任意）"}
  → {"ok": true, "faqs": [{question, answer, answer_from_source, evidence, source_url, status, reasons, ...}], "removed_instructions": [...], "timing": {...}}
  status=site だけが「本文と照合できた下書き」。needs_check は担当者が本文を見て書く。どちらも下書きで、公開は既存の確認・承認の流れで行う

- 既定で無効：環境変数 AIRREACH_GEMMA_ENABLED=true のときだけ動く（それ以外は 404）
- 社内だけ：トークンで airreach_me を呼び is_staff を確かめる（api/hack2-measure.js の staffTokenOk と同じ）
- 入力は 6000 文字・出力は 2000 トークンまで。1つの実行環境で同時に1件だけ（処理中は 429）
- 失敗しても外部の生成 AI に切り替えない。モデルの答えは gemma_faq.validate_faq で確かめ、通らない答えは「確認が必要」
- 計測値・月次集計には触らない（DB へ書かない）
"""
import json
import os
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gemma_faq as G  # noqa: E402  配置するときは同じ場所に置く

MODEL = os.environ.get('AIRREACH_GEMMA_MODEL', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models', 'gemma-4-E2B-it.litertlm'))
_runner = None
_lock = threading.Lock()
_staff_cache = {}


def staff_ok(auth_header):
    h = str(auth_header or '').strip()
    if not h.startswith('Bearer ') or not (20 <= len(h) - 7 <= 4096):
        return False
    token = h[7:]
    hit = _staff_cache.get(token)
    if hit and hit[1] > time.time():
        return hit[0]
    url = os.environ.get('SUPABASE_URL', '').rstrip('/')
    anon = os.environ.get('SUPABASE_ANON_KEY', '')
    ok = False
    if url and anon:
        try:
            req = urllib.request.Request(url + '/rest/v1/rpc/airreach_me', data=b'{}', method='POST',
                                         headers={'apikey': anon, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=5) as r:
                ok = bool(json.load(r).get('is_staff') is True)
        except Exception:  # noqa: BLE001
            ok = False
    if len(_staff_cache) > 500:
        _staff_cache.clear()
    _staff_cache[token] = (ok, time.time() + 300)
    return ok


class handler(BaseHTTPRequestHandler):  # Vercel の Python ランタイムの書き方
    def _send(self, code, body):
        b = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_POST(self):
        global _runner
        if os.environ.get('AIRREACH_GEMMA_ENABLED') != 'true':
            return self._send(404, {'ok': False, 'error': 'not found'})
        if not staff_ok(self.headers.get('Authorization')):
            return self._send(401, {'ok': False, 'error': '社内のログインが必要です'})
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > 64 * 1024:
            return self._send(413, {'ok': False, 'error': '本文が大きすぎます'})
        try:
            body = json.loads(self.rfile.read(n))
            text = str(body.get('text') or '')
            url = str(body.get('url') or '')[:500] or None
            if url and not url.startswith(('https://', 'http://')):
                url = None
        except Exception:  # noqa: BLE001
            return self._send(400, {'ok': False, 'error': 'JSON を読めません'})
        if len(text.strip()) < 50:
            return self._send(400, {'ok': False, 'error': '本文が短すぎます（50文字以上）'})
        if not _lock.acquire(blocking=False):
            return self._send(429, {'ok': False, 'error': 'ほかの下書きを作成中です。少し待ってからやり直してください'})
        try:
            if _runner is None:
                _runner = G.GemmaRunner(MODEL, threads=int(os.environ.get('AIRREACH_GEMMA_THREADS', '2')), max_tokens=4096, cache_dir='/tmp/litert-lm-cache')
            out = _runner.faq(text, source_url=url)
            out.pop('raw', None)
            out['model'] = 'gemma-4-E2B-it (LiteRT-LM, CPU)'
            out['draft'] = True
            return self._send(200 if out.get('ok') else 502, out)
        except Exception as e:  # noqa: BLE001  外部の AI には切り替えない
            return self._send(500, {'ok': False, 'error': 'FAQ の下書きを作れませんでした（' + str(e)[:120] + '）'})
        finally:
            _lock.release()
