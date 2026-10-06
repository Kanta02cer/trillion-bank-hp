#!/usr/bin/env bash
# ci_run.sh <名前> <メモリ上限 例 2g（0=上限なし）> <CPU数（0=上限なし）> [時間の上限（秒）既定 2400]
# GitHub Actions（ci/gemma-bench.yml）から呼ぶ。コンテナを Vercel Functions の大きさに合わせて bench.py を1回動かす。
# これは Linux の制限つきコンテナでの実測で、Vercel での実動確認ではない。
#
# 残すもの（/tmp/out/<名前>/）
#   result.json  bench.py が読み込みの後・処理ごとに書き直す途中経過（OOM・時間切れでも、そこまでの結果が残る）
#   mem.csv      2秒ごとのコンテナのメモリ（経過秒, memory.current, memory.peak, oom_kill の回数）＝ホスト側の cgroup から読む
#   log.txt      コンテナの出力
#   meta.json    終了コード・OOM・時間切れ・全体の時間・メモリの最大（サンプルとピーク）
set -uo pipefail
NAME=$1; MEM=$2; CPUS=$3; LIMIT_S=${4:-2400}
OUT=/tmp/out/$NAME; mkdir -p "$OUT"
LIMITS=(); THREADS=4
if [ "$MEM" != "0" ]; then LIMITS+=(--memory="$MEM" --memory-swap="$MEM"); fi
if [ "$CPUS" != "0" ]; then LIMITS+=(--cpus="$CPUS"); THREADS=$CPUS; fi
# 読み込みを「冷えた」状態から測る（ホストのファイルのキャッシュを捨てる）
sync; echo 3 | sudo tee /proc/sys/vm/drop_caches >/dev/null
START=$(date +%s.%N)
CID=$(docker run -d --name "gb-$NAME" "${LIMITS[@]}" -e MODEL_SHA256="${MODEL_SHA256:-}" -e PYTHONUNBUFFERED=1 \
  -v "$GITHUB_WORKSPACE/tools/airreach-gemma:/work:ro" -v /tmp/model:/model:ro -v "$OUT:/out" \
  gemma-bench python /work/bench.py --model /model/gemma-4-E2B-it.litertlm --threads "$THREADS" --repeat 2 --out /out/result.json)
# コンテナの cgroup（systemd の cgroup v2 なら system.slice/docker-<ID>.scope）
CG=""
for c in "/sys/fs/cgroup/system.slice/docker-$CID.scope" "/sys/fs/cgroup/docker/$CID"; do [ -d "$c" ] && CG=$c && break; done
echo "elapsed_s,memory_current_bytes,memory_peak_bytes,oom_kill" > "$OUT/mem.csv"
TIMED_OUT=false
while [ "$(docker inspect -f '{{.State.Running}}' "$CID" 2>/dev/null)" = "true" ]; do
  EL=$(python3 -c "import time;print(round(time.time()-$START,1))")
  if [ -n "$CG" ]; then
    CUR=$(cat "$CG/memory.current" 2>/dev/null || echo); PEAK=$(cat "$CG/memory.peak" 2>/dev/null || echo)
    OOMK=$(awk '/^oom_kill /{print $2}' "$CG/memory.events" 2>/dev/null || echo)
    echo "$EL,$CUR,$PEAK,$OOMK" >> "$OUT/mem.csv"
  fi
  if python3 -c "import sys;sys.exit(0 if $EL >= $LIMIT_S else 1)"; then
    TIMED_OUT=true; docker kill "$CID" >/dev/null 2>&1; break
  fi
  sleep 2
done
END=$(date +%s.%N)
docker logs "$CID" 2>&1 | grep -v '^[WI]0000' > "$OUT/log.txt"
tail -n 20 "$OUT/log.txt"
CODE=$(docker inspect -f '{{.State.ExitCode}}' "$CID" 2>/dev/null || echo -1)
OOM=$(docker inspect -f '{{.State.OOMKilled}}' "$CID" 2>/dev/null || echo unknown)
docker rm -f "$CID" >/dev/null 2>&1
python3 - "$OUT" "$NAME" "$MEM" "$CPUS" "$CODE" "$OOM" "$START" "$END" "$LIMIT_S" "$TIMED_OUT" "$CG" <<'PY'
import csv, json, sys
from pathlib import Path
out, name, mem, cpus, code, oom, s, e, lim, to, cg = sys.argv[1:]
rows = list(csv.DictReader(open(Path(out) / 'mem.csv')))
def mx(k):
    v = [int(r[k]) for r in rows if (r.get(k) or '').strip().isdigit()]
    return round(max(v) / 1048576, 1) if v else None
oomk = [int(r['oom_kill']) for r in rows if (r.get('oom_kill') or '').strip().isdigit()]
res = {}
try:
    res = json.loads((Path(out) / 'result.json').read_text())
except Exception:
    pass
meta = {'name': name, 'memory': mem, 'cpus': cpus, 'exit_code': int(code), 'oom_killed': oom, 'oom_kill_events': max(oomk) if oomk else None,
        'timed_out': to == 'true', 'limit_s': int(lim), 'wall_s': round(float(e) - float(s), 1),
        'mem_samples': len(rows), 'mem_current_max_mb': mx('memory_current_bytes'), 'mem_peak_mb': mx('memory_peak_bytes'), 'cgroup_path_found': bool(cg),
        'bench_status': res.get('status'), 'bench_last_task': res.get('current'), 'bench_runs_done': len(res.get('runs') or []), 'load_s': res.get('load_s')}
(Path(out) / 'meta.json').write_text(json.dumps(meta, ensure_ascii=False))
print(json.dumps(meta, ensure_ascii=False))
PY
exit 0
