"""
Gemma（LiteRT-LM・CPU）の速さ・ピークメモリ・出力を測る。1回の実行＝1プロセス（モデルの読み込みから測る）。

  python bench.py --model gemma-4-E2B-it.litertlm --threads 2 --repeat 2 --out result.json

測るもの
  - load_s: モデルの読み込み（Engine を作るまで）
  - 各処理の ttft_s（最初の文字まで）・total_s（全部出るまで）。repeat 2 で「初回」と「続けて2回目」
  - peak_rss_mb: このプロセスの最大常駐メモリ（ru_maxrss。Linux は KB・macOS は byte で返るので換算）
  - cgroup_peak_mb: コンテナで動かしたとき、コンテナ全体の最大メモリ（memory.peak。ファイルのキャッシュも含む＝Vercel の上限に近い見方）
  - bench: LiteRT-LM の Benchmark（prefill 1024・decode 256 トークン）の tok/s（--bench のとき）
材料は samples/ の架空の本文と公開ページ。外部の生成 AI API は呼ばない。
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import resource
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import gemma_faq as G  # noqa: E402

# 架空の計測値（既存の集計で出した数字を渡す想定。Gemma は数字を作らない）
SUMMARY_DATA = {
    '対象': 'サンプル美容室 Hana（架空）',
    '月': '2026年9月',
    'AIの回答に名前が出た割合': {'今月': '31.3%（16回答中5回答）', '前月': '18.8%（16回答中3回答）'},
    'AIの回答で出典になった割合': {'今月': '25.0%（判定できた12回答中3回答）', '前月': '8.3%（判定できた12回答中1回答）'},
    '競合のサロンAの名前が出た割合': '43.8%（16回答中7回答）',
    '今月やったこと': ['よくある質問のページを作った', 'トップページに会社情報の構造化データを追加した'],
}


def peak_rss_mb() -> float:
    v = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return round(v / (1024 * 1024) if sys.platform == 'darwin' else v / 1024, 1)


def cgroup_peak_mb():
    for p in ('/sys/fs/cgroup/memory.peak', '/sys/fs/cgroup/memory/memory.max_usage_in_bytes'):
        try:
            return round(int(Path(p).read_text().strip()) / (1024 * 1024), 1)
        except Exception:  # noqa: BLE001
            continue
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--threads', type=int, default=None)
    ap.add_argument('--max-tokens', type=int, default=4096)
    ap.add_argument('--repeat', type=int, default=2)
    ap.add_argument('--tasks', default='faq_short,faq_long,faq_public,summary')
    ap.add_argument('--bench', action='store_true')
    ap.add_argument('--out', default='')
    a = ap.parse_args()

    res = {'platform': platform.platform(), 'machine': platform.machine(), 'cpu_count': os.cpu_count(), 'threads': a.threads,
           'model': os.path.basename(a.model), 'model_mb': round(os.path.getsize(a.model) / 1e6, 1), 'max_tokens': a.max_tokens}
    t0 = time.perf_counter()
    r = G.GemmaRunner(a.model, threads=a.threads, max_tokens=a.max_tokens, cache_dir=os.environ.get('GEMMA_CACHE_DIR') or None)
    res['load_s'] = round(time.perf_counter() - t0, 2)
    res['rss_after_load_mb'] = peak_rss_mb()
    samples = {'faq_short': 'short_salon.txt', 'faq_long': 'long_restaurant.txt', 'faq_public': 'public_airreach_page.txt'}
    res['runs'] = []
    for task in [x for x in a.tasks.split(',') if x]:
        for i in range(a.repeat):
            if task == 'summary':
                out = r.summary(SUMMARY_DATA)
            else:
                out = r.faq((HERE / 'samples' / samples[task]).read_text())
            row = {'task': task, 'n': i + 1, **{k: (round(v, 2) if isinstance(v, float) else v) for k, v in out['timing'].items()}, 'peak_rss_mb': peak_rss_mb()}
            if task != 'summary':
                row.update({'source_chars': out.get('source_chars'), 'site': out.get('site'), 'needs_check': out.get('needs_check'), 'ok': out.get('ok'), 'error': out.get('error'),
                            'faqs': out.get('faqs'), 'raw_chars': len(out.get('raw') or '')})
            else:
                row.update({'ok': out['ok'], 'text': out['text'], 'model_text': out['model_text'], 'bad_numbers': out['bad_numbers']})
            res['runs'].append(row)
            print(json.dumps({k: v for k, v in row.items() if k not in ('faqs',)}, ensure_ascii=False)[:400], flush=True)
    r.close()
    if a.bench:
        import litert_lm as L
        b = L.Benchmark(a.model, L.Backend.CPU(thread_count=a.threads), prefill_tokens=1024, decode_tokens=256, max_num_tokens=2048)
        info = b.run() if hasattr(b, 'run') else None
        res['bench'] = {k: getattr(info, k) for k in dir(info) if not k.startswith('_') and not callable(getattr(info, k))} if info is not None else None
    res['peak_rss_mb'] = peak_rss_mb()
    res['cgroup_peak_mb'] = cgroup_peak_mb()
    print(json.dumps({k: v for k, v in res.items() if k != 'runs'}, ensure_ascii=False, default=str), flush=True)
    if a.out:
        Path(a.out).write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str))


if __name__ == '__main__':
    main()
