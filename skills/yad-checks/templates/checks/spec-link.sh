#!/usr/bin/env bash
# spec-link gate (Phase 3 build plan §C).
# Every NON-MAINTENANCE commit must link a real story/spec: it must carry a
# `Task: <story>-<task>` trailer whose <story> resolves to a specs/<story>/link.md.
# Maintenance commits (ci/chore/build/test) are EXEMPT — CI wiring, dependency bumps,
# and test-infra changes legitimately link no story. Checked per commit (not aggregated
# across the range), so the report names every offending commit.
set -euo pipefail

BASE="${1:-${SDLC_BASE:-origin/main}}"

# Fail closed if the base ref can't be resolved (shallow clone / wrong base branch / unfetched ref).
if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [spec-link]: base ref '${BASE}' not found — fetch full history / check the base branch."
  exit 1
fi
RANGE="${BASE}..HEAD"

# Conventional-Commits types exempt from the spec-link requirement (optional (scope) and breaking !).
EXEMPT='ci|chore|build|test'

# Portable across bash 3.2 (macOS) and 4+ — no mapfile; feed the loop via heredoc (not a pipe) so
# the failure count survives the loop body.
commits="$(git rev-list --no-merges "$RANGE")"
if [ -z "$commits" ]; then
  echo "PASS [spec-link]: no non-merge commits in ${RANGE}"
  exit 0
fi

rc=0
while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  short="$(git log -1 --format=%h "$sha")"
  subject="$(git log -1 --format=%s "$sha")"
  if printf '%s' "$subject" | grep -qE "^(${EXEMPT})(\([a-z0-9._-]+\))?!?: "; then
    echo "PASS [spec-link]: ${short} '${subject}' — maintenance commit (exempt)"
    continue
  fi
  task="$(git log -1 --format='%(trailers:key=Task,valueonly)' "$sha" | sed '/^$/d' | head -1)"
  if [ -z "$task" ]; then
    echo "FAIL [spec-link]: ${short} '${subject}' has no 'Task:' trailer"
    rc=1
    continue
  fi
  story="$(printf '%s' "$task" | sed -E 's/-T[0-9]+$//')"
  if [ -f "specs/${story}/link.md" ]; then
    echo "PASS [spec-link]: ${short} ${task} -> specs/${story}/link.md"
  else
    echo "FAIL [spec-link]: ${short} ${task} references specs/${story}/ but link.md is missing."
    rc=1
  fi
done <<EOF
$commits
EOF
exit "$rc"
