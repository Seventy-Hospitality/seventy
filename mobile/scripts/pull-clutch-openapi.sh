#!/usr/bin/env bash
# Copy Clutch's published OpenAPI document into clutch/openapi.json and record
# where it came from. Usage:
#   CLUTCH_REPO=/path/to/club-management scripts/pull-clutch-openapi.sh [ref]
# ref defaults to origin/main; use origin/feat/api-contract until it merges.
set -euo pipefail
repo="${CLUTCH_REPO:?set CLUTCH_REPO to a club-management checkout}"
ref="${1:-origin/main}"
here="$(cd "$(dirname "$0")/.." && pwd)"
git -C "$repo" fetch -q origin
git -C "$repo" show "$ref:docs/api/openapi.json" > "$here/clutch/openapi.json"
commit="$(git -C "$repo" rev-parse "$ref")"
printf '{\n  "repo": "we-are-clutch/club-management",\n  "ref": "%s",\n  "commit": "%s"\n}\n' "$ref" "$commit" > "$here/clutch/openapi.source.json"
echo "clutch/openapi.json <- $ref ($commit)"
