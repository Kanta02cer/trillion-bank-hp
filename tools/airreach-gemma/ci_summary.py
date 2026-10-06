"""gemma-bench の結果を Markdown にする:  python3 ci_summary.py /tmp/out
Linux の制限つきコンテナでの実測（Vercel での実動確認ではない）"""
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
dirs = sorted(p for p in root.iterdir() if p.is_dir())
print('## Gemma 4 E2B（LiteRT-LM・CPU）Linux x86_64・制限つきコンテナ\n')
print('Vercel での実動確認ではない。GitHub Actions の標準ランナーで、docker の --memory/--cpus で上限をかけた結果。\n')
first = next((json.loads((d / 'result.json').read_text()) for d in dirs if (d / 'result.json').exists()), {})
print(f"- litert-lm-api {first.get('litert_lm_api')}・Python {first.get('python')}・{first.get('platform')}")
print(f"- モデル {first.get('model')}（{first.get('model_bytes')} バイト・sha256 {first.get('model_sha256')}）・max_tokens {first.get('max_tokens')}・出力上限 {first.get('max_output_tokens_faq')}・sampler {first.get('sampler')}\n")
print('| 条件 | 終了コード | OOM | 時間切れ | 全体(秒) | 読み込み(秒) | 短い本文 初回/2回目 | 長い本文(食堂) | 長い本文(歯科) | 公開ページ | ピークRSS(MB) | コンテナのピーク(MB) |')
print('|---|---|---|---|---|---|---|---|---|---|---|---|')
for d in dirs:
    meta = json.loads((d / 'meta.json').read_text()) if (d / 'meta.json').exists() else {}
    res = json.loads((d / 'result.json').read_text()) if (d / 'result.json').exists() else {}
    runs = res.get('runs', [])
    def tt(task):
        xs = [r for r in runs if r['task'] == task]
        return ' / '.join(f"{r.get('total_s')}s（通過{r.get('site')}・確認{r.get('needs_check')}）" for r in xs) or '—'
    print(f"| {d.name} | {meta.get('exit_code')} | {meta.get('oom_killed')} | {meta.get('timed_out')} | {meta.get('wall_s')} | {res.get('load_s', '—')} | {tt('faq_short')} | {tt('faq_long')} | {tt('faq_clinic')} | {tt('faq_public')} | {res.get('peak_rss_mb', '—')} | {res.get('cgroup_peak_mb', '—')} |")
print('\n確認に回った理由（種類）:')
for d in dirs:
    res = json.loads((d / 'result.json').read_text()) if (d / 'result.json').exists() else {}
    for r in res.get('runs', []):
        if r['task'] != 'summary' and r['n'] == 1:
            print(f"- {d.name} {r['task']}: {', '.join(r.get('reasons') or []) or 'なし'}")
