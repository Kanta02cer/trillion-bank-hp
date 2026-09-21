#!/usr/bin/env bash
# Reliable Jekyll build for Ruby 3.2+ (Vercel / GitHub Actions).
# Liquid 4 still calls Object#tainted?, which Ruby 3.2+ removed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPAT="${ROOT}/_plugins/ruby32_compat.rb"

echo "[jekyll_build] root=${ROOT}"
echo "[jekyll_build] ruby=$(command -v ruby || true) $(ruby -v 2>/dev/null || true)"
echo "[jekyll_build] bundle=$(command -v bundle || true) $(bundle -v 2>/dev/null || true)"
echo "[jekyll_build] pwd=$(pwd)"
ls -la "${COMPAT}"

if [[ ! -f "${COMPAT}" ]]; then
  echo "error: missing Liquid taint polyfill at ${COMPAT}" >&2
  exit 1
fi

cd "${ROOT}"

# Prove the polyfill loads before Jekyll starts.
bundle exec ruby -r"${COMPAT}" -e 'abort("polyfill missing") unless Object.instance_methods.include?(:tainted?); puts "[jekyll_build] polyfill ok tainted?=#{ {}.tainted? }"'

bundle exec ruby -r"${COMPAT}" -S jekyll build "$@"
echo "[jekyll_build] done"
