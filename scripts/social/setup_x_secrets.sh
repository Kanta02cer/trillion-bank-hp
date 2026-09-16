#!/usr/bin/env bash
set -euo pipefail
# Set GitHub Actions secrets for X (Twitter) API posting.
# Usage:
#   export X_API_KEY=...
#   export X_API_SECRET=...
#   export X_ACCESS_TOKEN=...
#   export X_ACCESS_TOKEN_SECRET=...
#   ./scripts/social/setup_x_secrets.sh
#
# Values are read from environment variables and never printed.

REPO="${GITHUB_REPOSITORY:-Kanta02cer/trillion-bank-hp}"

need=(X_API_KEY X_API_SECRET X_ACCESS_TOKEN X_ACCESS_TOKEN_SECRET)
missing=()
for k in "${need[@]}"; do
  if [[ -z "${!k:-}" ]]; then missing+=("$k"); fi
done
if ((${#missing[@]})); then
  echo "Missing env vars: ${missing[*]}"
  echo "Create an X developer app (Read+Write), then export the 4 values and re-run."
  exit 1
fi

if ! command -v gh >/dev/null; then
  echo "gh CLI is required"
  exit 1
fi

if ! gh auth status -h github.com >/dev/null 2>&1; then
  echo "Run: gh auth login -h github.com"
  exit 1
fi

for k in "${need[@]}"; do
  printf '%s' "${!k}" | gh secret set "$k" --repo "$REPO"
  echo "set $k"
done

echo "Done. Next:"
echo "1) Actions → Social draft generation → Run workflow → mode=generate"
echo "2) mode=x-dry-run"
echo "3) mode=x-publish / confirm=publish （内容確認後）"
