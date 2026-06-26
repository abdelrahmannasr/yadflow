#!/usr/bin/env bash
# epic-open gate (Phase 6 — the staleness preventer). An epic is SEALED once every one of its stories
# is `shipped`. A SEALED epic's artifacts are the final, approved description of shipped behaviour — so
# new behaviour must NOT be added to it; it belongs in a NEW threaded change-epic whose re-authored
# stories/test-cases describe the change. This gate FAILs any non-maintenance commit whose owning epic
# is sealed, forcing the front half to stay current (staleness becomes unshippable).
#
# The owning epic lives in the PRODUCT repo (via specs/<story>/link.md `product-repo`). When it is not
# reachable from CI, the seal cannot be read, so the commit PASSes with a note (degraded, fail-open here
# because lineage/spec-link still gate the link itself). Per commit; ci/chore/build/test exempt.
# Fails CLOSED on an unresolvable base.
set -euo pipefail

BASE="${1:-${SDLC_BASE:-origin/main}}"

if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [epic-open]: base ref '${BASE}' not found — fetch full history / check the base branch."
  exit 1
fi
RANGE="${BASE}..HEAD"
EXEMPT='ci|chore|build|test'

# Read one frontmatter value from the FIRST --- … --- block only (awk stops at the first closing fence).
fm_val() { awk -v k="$1" 'NR==1 && /^---$/ {f=1; next} f && /^---$/ {exit} f && index($0, k":")==1 {sub("^" k ":[ \t]*", ""); print; exit}' "$2" 2>/dev/null | tr -d '\r'; }

# Is the epic SEALED? true iff it has >=1 story and EVERY stories/*.md frontmatter status is `shipped`.
epic_sealed() {
  ep_dir="$1"
  sdir="${ep_dir}/stories"
  [ -d "$sdir" ] || return 1
  found=0
  for f in "$sdir"/*.md; do
    [ -e "$f" ] || continue
    found=1
    st="$(fm_val status "$f")"
    [ "$st" = "shipped" ] || return 1
  done
  [ "$found" = "1" ] || return 1
  return 0
}

commits="$(git rev-list --no-merges "$RANGE")"
if [ -z "$commits" ]; then
  echo "PASS [epic-open]: no non-merge commits in ${RANGE}"
  exit 0
fi

rc=0
while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  short="$(git log -1 --format=%h "$sha")"
  subject="$(git log -1 --format=%s "$sha")"
  if printf '%s' "$subject" | grep -qE "^(${EXEMPT})(\([a-z0-9._-]+\))?!?: "; then
    echo "PASS [epic-open]: ${short} '${subject}' — maintenance commit (exempt)"
    continue
  fi
  task="$(git log -1 --format='%(trailers:key=Task,valueonly)' "$sha" | sed '/^$/d' | head -1)"
  if ! printf '%s' "$task" | grep -qE '.+-T[0-9]+$'; then
    echo "note [epic-open]: ${short} has no resolvable Task trailer — deferring to spec-link."
    continue
  fi
  story="$(printf '%s' "$task" | sed -E 's/-T[0-9]+$//')"
  link="specs/${story}/link.md"
  [ -f "$link" ] || { echo "note [epic-open]: ${short} ${task} — link.md missing (spec-link will FAIL)."; continue; }
  product_rel="$(fm_val product-repo "$link")"
  epic="$(fm_val epic "$link")"
  # A malformed link.md (empty product-repo, or an epic that is not a real EP-<slug>) must FAIL, not
  # slip through as "not reachable" — an empty epic would collapse ep_dir to <product>/epics/ (a real
  # dir) and pass the seal check as if the epic were open.
  if [ -z "$product_rel" ] || ! printf '%s' "$epic" | grep -qE '^EP-[a-z0-9-]+$'; then
    echo "FAIL [epic-open]: ${short} ${task} — link.md has no valid product-repo/epic metadata."
    rc=1
    continue
  fi
  # product-repo is relative to the link.md's directory (specs/<story>/), so join it there.
  prod="specs/${story}/${product_rel}"
  ep_dir="${prod}/epics/${epic}"
  if [ ! -d "$prod" ]; then
    echo "PASS [epic-open]: ${short} ${task} -> ${epic} (product repo not reachable — seal check deferred)."
    continue
  fi
  if [ ! -d "$ep_dir" ]; then
    echo "FAIL [epic-open]: ${short} ${task} -> epic ${epic} does not exist in the product repo (orphan story link)."
    rc=1
    continue
  fi
  if epic_sealed "$ep_dir"; then
    echo "FAIL [epic-open]: ${short} ${task} targets SEALED epic ${epic} (all stories shipped)."
    echo "  -> New behaviour cannot mutate a shipped epic. Open a threaded change-epic with yad-change"
    echo "     (kind: change|defect|hotfix, parent: ${epic}) and implement against ITS stories instead."
    rc=1
    continue
  fi
  echo "PASS [epic-open]: ${short} ${task} -> ${epic} (epic is open — has unshipped stories)."
done <<EOF
$commits
EOF
exit "$rc"
