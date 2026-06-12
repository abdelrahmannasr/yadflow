#!/usr/bin/env bash
# backfill gate (Phase 3 build plan §G). A change that touches a feature being backfilled must wait
# until that feature's backfill spec is human-approved (verified: true). Gated PER touched feature, not
# the whole repo: touching feature A is never blocked by an unverified feature B. Features that are
# forward-spec'd (their own specs/<story>/) or not yet being backfilled are not this gate's concern.
set -euo pipefail

BASE="${1:-${SDLC_BASE:-origin/main}}"
if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [backfill]: base ref '${BASE}' not found — fetch full history / check the base branch."
  exit 1
fi

changed="$(git diff --name-only "${BASE}..HEAD")"
# Feature = a directory under src/ (src/<feature>/...). Top-level src/*.js files are deliberately NOT
# gated here (they belong to no single feature); only src/<feature>/ changes are checked.
feats="$(printf '%s\n' "$changed" | sed -nE 's#^src/([^/]+)/.*#\1#p' | sort -u)"

if [ -z "$feats" ]; then
  echo "PASS [backfill]: no src/<feature> changes."
  exit 0
fi

rc=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  spec="specs/backfill/${f}/spec.md"
  [ -f "$spec" ] || { echo "note [backfill]: ${f} is not being backfilled (no ${spec}) — skipped."; continue; }
  # Read ONLY the YAML frontmatter (between the first two --- lines) so a prose line that merely
  # contains "verified: true" cannot false-pass the gate.
  fm="$(awk 'NR==1 && /^---[[:space:]]*$/ {f=1; next} f && /^---[[:space:]]*$/ {exit} f {print}' "$spec")"
  if printf '%s\n' "$fm" | grep -qiE '^verified:[[:space:]]*true[[:space:]]*$'; then
    echo "PASS [backfill]: ${f} has an approved (verified) backfill spec."
  else
    echo "FAIL [backfill]: ${f} is being backfilled but its spec is not yet human-approved (verified: true)."
    echo "  -> run yad-backfill approve for ${spec} before changing this feature."
    rc=1
  fi
done <<EOF
$feats
EOF
exit "$rc"
