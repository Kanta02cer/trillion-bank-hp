#!/usr/bin/env bash
# ci_run.sh <名前> <メモリ上限 例 2g（0=上限なし）> <CPU数（0=上限なし）> [時間の上限（秒）既定 2400]
# GitHub Actions（ci/gemma-bench.yml）から呼ぶ。コンテナを Vercel Functions の大きさに合わせて bench.py を1回動かす。
# これは Linux の制限つきコンテナでの実測で、Vercel での実動確認ではない。
set -uo pipefail
NAME=$1; MEM=$2; CPUS=$3; LIMIT_S=${4:-2400}
OUT=/tmp/out/$NAME; mkdir -p "$OUT"
LIMITS=(); THREADS=4
if [ "$MEM" != "0" ]; then LIMITS+=(--memory="$MEM" --memory-swap="$MEM"); fi
if [ "$CPUS" != "0" ]; then LIMITS+=(--cpus="$CPUS"); THREADS=$CPUS; fi
# 読み込みを「冷えた」状態から測る（ホストのファイルのキャッシュを捨てる）
sync; echo 3 | sudo tee /proc/sys/vm/drop_caches >/dev/null
START=$(date +%s.%N)
timeout --signal=KILL "$LIMIT_S" docker run --name "gb-$NAME" "${LIMITS[@]}" -e MODEL_SHA256="${MODEL_SHA256:-}" -e PYTHONUNBUFFERED=1 \
  -v "$GITHUB_WORKSPACE/tools/airreach-gemma:/work:ro" -v /tmp/model:/model:ro -v "$OUT:/out" \
  gemma-bench python /work/bench.py --model /model/gemma-4-E2B-it.litertlm --threads "$THREADS" --repeat 2 --out /out/result.json 2>&1 \
  | grep --line-buffered -v '^[WI]0000' | tee "$OUT/log.txt"
CODE=${PIPESTATUS[0]}
END=$(date +%s.%N)
OOM=$(docker inspect -f '{{.State.OOMKilled}}' "gb-$NAME" 2>/dev/null || echo unknown)
docker rm -f "gb-$NAME" >/dev/null 2>&1
python3 - "$OUT/meta.json" "$NAME" "$MEM" "$CPUS" "$CODE" "$OOM" "$START" "$END" "$LIMIT_S" <<'PY'
import json, sys
p, name, mem, cpus, code, oom, s, e, lim = sys.argv[1:]
wall = round(float(e) - float(s), 1)
json.dump({'name': name, 'memory': mem, 'cpus': cpus, 'exit_code': int(code), 'oom_killed': oom, 'wall_s': wall,
           'timed_out': int(code) == 137 and oom != 'true' and wall >= float(lim) - 5, 'limit_s': int(lim)}, open(p, 'w'))
print(open(p).read())
PY
exit 0
