#!/usr/bin/env bash
# Reliable Jekyll build for Ruby 3.2+ (Vercel / GitHub Actions).
# Liquid 4 still calls Object#tainted?, which Ruby 3.2+ removed.
# Do not rely on RUBYOPT alone — bundle exec can rewrite it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPAT="${ROOT}/_plugins/ruby32_compat.rb"

if [[ ! -f "${COMPAT}" ]]; then
  echo "error: missing Liquid taint polyfill at ${COMPAT}" >&2
  exit 1
fi

cd "${ROOT}"
exec bundle exec ruby -r"${COMPAT}" -S jekyll build "$@"
