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

# 架空の集計データ（既存の月次集計で出した数字を渡す想定）。要約の数字は summary_from_metrics の定型文で作る（Gemma は数字を作らない）
SUMMARY_DATA = {
    'target': 'サンプル美容室 Hana（架空）', 'period': '2026年9月', 'prev_period': '2026年8月',
    'metrics': [
        {'id': 'mention_rate', 'label': 'AIの回答に名前が出た割合', 'ai': 'すべての AI', 'current': {'num': 5, 'den': 16}, 'previous': {'num': 3, 'den': 16}},
        {'id': 'cite_rate', 'label': 'AIの回答で出典になった割合', 'ai': 'Perplexity', 'current': {'num': 3, 'den': 12}, 'previous': {'num': 1, 'den': 12}},
        {'id': 'cite_rate', 'label': 'AIの回答で出典になった割合', 'ai': 'ChatGPT（検索なし）', 'current': None, 'previous': None},
    ],
}
SAMPLES = {'faq_short': ('short_salon.txt', None), 'faq_long': ('long_restaurant.txt', None), 'faq_clinic': ('long_clinic.txt', None),
           'faq_public': ('public_airreach_page.txt', 'https://trillion-bank.jp/airreach/')}


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
    ap.add_argument('--tasks', default='faq_short,faq_long,faq_clinic,faq_public,summary')
    ap.add_argument('--bench', action='store_true')
    ap.add_argument('--out', default='')
    a = ap.parse_args()

    from importlib import metadata
    res = {'platform': platform.platform(), 'machine': platform.machine(), 'python': platform.python_version(), 'cpu_count': os.cpu_count(), 'threads': a.threads,
           'litert_lm_api': metadata.version('litert-lm-api'), 'model': os.path.basename(a.model), 'model_bytes': os.path.getsize(a.model),
           'model_sha256': os.environ.get('MODEL_SHA256') or None, 'max_tokens': a.max_tokens,
           'sampler': {'temperature': 0.2, 'top_k': 20, 'top_p': 0.9, 'seed': 1}, 'thinking': False, 'max_output_tokens_faq': 2000,
           'measure': 'load_s=Engine の作成まで・ttft_s=最初の文字まで・total_s=全部出るまで（time.perf_counter）・peak_rss_mb=ru_maxrss・cgroup_peak_mb=memory.peak'}
    res.update({'status': 'loading', 'started_at': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'runs': []})

    def save(status=None):
        """途中経過を毎回書く（OOM・時間切れで止まっても、読み込み時間と済んだ処理の結果が残る）。書き換えは別名に書いてから置き換える"""
        if status:
            res['status'] = status
        res['peak_rss_mb'] = peak_rss_mb()
        res['cgroup_peak_mb'] = cgroup_peak_mb()
        if a.out:
            tmp = a.out + '.tmp'
            Path(tmp).write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str))
            os.replace(tmp, a.out)

    save()
    try:
        t0 = time.perf_counter()
        r = G.GemmaRunner(a.model, threads=a.threads, max_tokens=a.max_tokens, cache_dir=os.environ.get('GEMMA_CACHE_DIR') or None)
        res['load_s'] = round(time.perf_counter() - t0, 2)
        res['rss_after_load_mb'] = peak_rss_mb()
        save('loaded')
        for task in [x for x in a.tasks.split(',') if x]:
            for i in range(a.repeat):
                res['current'] = {'task': task, 'n': i + 1, 'started_s': round(time.perf_counter() - t0, 1)}
                save('running')
                if task == 'summary':
                    out = r.summary(SUMMARY_DATA)
                else:
                    fname, url = SAMPLES[task]
                    out = r.faq((HERE / 'samples' / fname).read_text(), source_url=url)
                row = {'task': task, 'n': i + 1, **{k: (round(v, 2) if isinstance(v, float) else v) for k, v in out['timing'].items()}, 'peak_rss_mb': peak_rss_mb()}
                if task != 'summary':
                    row.update({'source_chars': out.get('source_chars'), 'site': out.get('site'), 'needs_check': out.get('needs_check'), 'ok': out.get('ok'), 'error': out.get('error'),
                                'faqs': out.get('faqs'), 'raw_chars': len(out.get('raw') or ''), 'raw': out.get('raw'), 'removed_instructions': out.get('removed_instructions'),
                                'reasons': sorted({x.split(':')[0] for f in (out.get('faqs') or []) for x in f.get('reasons', [])})})
                else:
                    row.update({'ok': out['ok'], 'text': out['text'], 'model_used': out.get('model_used')})
                res['runs'].append(row)
                res.pop('current', None)
                save('running')
                print(json.dumps({k: v for k, v in row.items() if k not in ('faqs', 'raw')}, ensure_ascii=False)[:400], flush=True)
        r.close()
        if a.bench:
            import litert_lm as L
            b = L.Benchmark(a.model, L.Backend.CPU(thread_count=a.threads), prefill_tokens=1024, decode_tokens=256, max_num_tokens=2048)
            info = b.run() if hasattr(b, 'run') else None
            res['bench'] = {k: getattr(info, k) for k in dir(info) if not k.startswith('_') and not callable(getattr(info, k))} if info is not None else None
        save('complete')
    except Exception as e:  # noqa: BLE001  Python の例外で止まったとき（OOM の強制終了は例外にならない＝その直前の途中経過が残る）
        res['error'] = f'{type(e).__name__}: {str(e)[:300]}'
        save('error')
        raise
    finally:
        print(json.dumps({k: v for k, v in res.items() if k != 'runs'}, ensure_ascii=False, default=str), flush=True)

if __name__ == '__main__':
    main()
