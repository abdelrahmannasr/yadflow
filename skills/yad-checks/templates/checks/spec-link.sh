#!/usr/bin/env bash
# spec-link gate (Phase 3 build plan §C).
# The change must link a real story/spec: every commit range under review must carry a
# `Task: <story>-<task>` trailer whose <story> resolves to a specs/<story>/link.md.
# Fail if the link is missing — no unlinked code reaches merge.
set -euo pipefail

BASE="${1:-${SDLC_BASE:-origin/main}}"

# Fail closed if the base ref can't be resolved (shallow clone / wrong base branch / unfetched ref).
if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [spec-link]: base ref '${BASE}' not found — fetch full history / check the base branch."
  exit 1
fi
RANGE="${BASE}..HEAD"

# Portable across bash 3.2 (macOS) and 4+ — no mapfile.
tasks="$(git log "$RANGE" --format='%(trailers:key=Task,valueonly)' | sed '/^$/d' | sort -u)"

if [ -z "$tasks" ]; then
  echo "FAIL [spec-link]: no 'Task: <story>-<task>' trailer in ${RANGE} — change does not link a story/spec."
  exit 1
fi

rc=0
while IFS= read -r t; do
  [ -z "$t" ] && continue
  story="$(printf '%s' "$t" | sed -E 's/-T[0-9]+$//')"
  if [ -f "specs/${story}/link.md" ]; then
    echo "PASS [spec-link]: ${t} -> specs/${story}/link.md"
  else
    echo "FAIL [spec-link]: ${t} references specs/${story}/ but link.md is missing."
    rc=1
  fi
done <<EOF
$tasks
EOF
exit "$rc"
