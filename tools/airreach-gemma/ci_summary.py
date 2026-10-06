"""gemma-bench の結果を Markdown の表にする:  python3 ci_summary.py /tmp/out"""
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
print('## Gemma 4 E2B（LiteRT-LM・CPU）Linux x86_64\n')
print('| 条件 | 終了 | OOM | 読み込み(秒) | 短い本文 FAQ 初回/2回目(秒) | 長い本文 FAQ 初回/2回目(秒) | 公開ページ FAQ(秒) | 要約(秒) | ピークRSS(MB) | コンテナのピーク(MB) |')
print('|---|---|---|---|---|---|---|---|---|---|')
for d in sorted(p for p in root.iterdir() if p.is_dir()):
    meta = json.loads((d / 'meta.json').read_text()) if (d / 'meta.json').exists() else {}
    res = json.loads((d / 'result.json').read_text()) if (d / 'result.json').exists() else {}
    runs = res.get('runs', [])
    def tt(task):
        xs = [r for r in runs if r['task'] == task]
        return ' / '.join(str(r.get('total_s')) for r in xs) or '—'
    print(f"| {d.name} | {meta.get('exit_code')} | {meta.get('oom_killed')} | {res.get('load_s', '—')} | {tt('faq_short')} | {tt('faq_long')} | {tt('faq_public')} | {tt('summary')} | {res.get('peak_rss_mb', '—')} | {res.get('cgroup_peak_mb', '—')} |")
print()
for d in sorted(p for p in root.iterdir() if p.is_dir()):
    res = json.loads((d / 'result.json').read_text()) if (d / 'result.json').exists() else {}
    for r in res.get('runs', [])[:1]:
        pass
    ok = [(r['task'], r.get('site'), r.get('needs_check')) for r in res.get('runs', []) if r['task'] != 'summary']
    if ok:
        print(f"- {d.name}: FAQ（site/確認が必要）= " + ', '.join(f'{t}:{a}/{b}' for t, a, b in ok))
