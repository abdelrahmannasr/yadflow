#!/usr/bin/env bash
# commit-message gate.
# Every non-merge commit in the range under review must follow the project commit convention
# (CONTRIBUTING.md / config.yaml build — mirrors cli/commit.mjs buildCommitMessage):
#   - subject is "<type>: <description>" where <type> is a known Conventional-Commits type,
#   - the subject does NOT end with a period,
#   - any trailers appear in the fixed order Task -> Contract-Change -> Co-Authored-By.
# Keep the type list in sync with cli/manifest.mjs COMMIT_TYPES and config.yaml build.commit_subject_style.
#
# Profiles (--profile code|hub, default code): the subject rule is identical on the product hub and on
# code repos (both follow CONTRIBUTING). The Task trailer is NOT required here (the spec-link gate owns
# that on code repos; hub commits are not task-scoped) — this gate only checks SHAPE and ORDER.
#
# Merge/squash commits (2+ parents) are skipped: their platform-generated subjects are not authored.
set -euo pipefail

PROFILE=code
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:-code}"; shift 2 ;;
    --profile=*) PROFILE="${1#*=}"; shift ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
case "$PROFILE" in code|hub) ;; *) echo "FAIL [commit-message]: unknown --profile '$PROFILE' (code|hub)."; exit 1 ;; esac

BASE="${ARGS[0]:-${SDLC_BASE:-origin/main}}"

# Fail closed if the base ref can't be resolved (shallow clone / wrong base branch / unfetched ref).
if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [commit-message]: base ref '${BASE}' not found — fetch full history / check the base branch."
  exit 1
fi
RANGE="${BASE}..HEAD"

# Conventional-Commits types — keep in sync with cli/manifest.mjs COMMIT_TYPES.
TYPES='feat|fix|docs|refactor|test|perf|build|ci|chore|revert'

commits="$(git rev-list --no-merges "$RANGE")"
if [ -z "$commits" ]; then
  echo "PASS [commit-message]: no non-merge commits in ${RANGE} (profile: ${PROFILE})"
  exit 0
fi

rc=0
while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  short="$(git log -1 --format=%h "$sha")"
  subject="$(git log -1 --format=%s "$sha")"

  # 1) subject shape: "<type>: <non-empty description>"
  if ! printf '%s' "$subject" | grep -qE "^(${TYPES}): .+"; then
    echo "FAIL [commit-message]: ${short} subject '${subject}' is not '<type>: <description>' (type one of: ${TYPES//|/, })."
    rc=1
  # 2) no trailing period on the subject
  elif printf '%s' "$subject" | grep -qE '\.$'; then
    echo "FAIL [commit-message]: ${short} subject '${subject}' must not end with a period."
    rc=1
  else
    echo "PASS [commit-message]: ${short} '${subject}'"
  fi

  # 3) trailer order Task -> Contract-Change -> Co-Authored-By (only among those present).
  body="$(git log -1 --format=%B "$sha")"
  lt="$(printf '%s\n' "$body" | grep -niE '^Task:' | head -1 | cut -d: -f1 || true)"
  lc="$(printf '%s\n' "$body" | grep -niE '^Contract-Change:' | head -1 | cut -d: -f1 || true)"
  lo="$(printf '%s\n' "$body" | grep -niE '^Co-Authored-By:' | head -1 | cut -d: -f1 || true)"
  if { [ -n "$lt" ] && [ -n "$lc" ] && [ "$lt" -gt "$lc" ]; } \
     || { [ -n "$lt" ] && [ -n "$lo" ] && [ "$lt" -gt "$lo" ]; } \
     || { [ -n "$lc" ] && [ -n "$lo" ] && [ "$lc" -gt "$lo" ]; }; then
    echo "FAIL [commit-message]: ${short} trailers out of order — expected Task -> Contract-Change -> Co-Authored-By."
    rc=1
  fi
done <<EOF
$commits
EOF

exit "$rc"
