#!/usr/bin/env bash
# lineage-check gate (Phase 6 — feature threads). Builds on spec-link: every NON-MAINTENANCE commit
# must link a real story (spec-link enforces that), and the OWNING epic must be a valid node in a
# feature thread — a change/defect/hotfix epic MUST thread to a real parent. This is the
# "every code change has an owning epic in a thread" enforcement. Per commit; maintenance commits
# (ci/chore/build/test) are exempt. Fails CLOSED on an unresolvable base.
#
# The owning epic lives in the PRODUCT repo (reached via specs/<story>/link.md's `product-repo` path,
# exactly like contract-check). When the product repo is not reachable from CI, lineage is verified
# best-effort: the commit PASSes with a note (spec-link already proved the story link).
set -euo pipefail

BASE="${1:-${SDLC_BASE:-origin/main}}"

if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [lineage-check]: base ref '${BASE}' not found — fetch full history / check the base branch."
  exit 1
fi
RANGE="${BASE}..HEAD"
EXEMPT='ci|chore|build|test'

# --- shared link.md resolution (byte-identical in contract-check / lineage-check / epic-open /
# --- reconcile-debt-check; the gates are deliberately standalone, so it is duplicated, not sourced) ---
# Read one frontmatter value from the FIRST --- … --- block only. awk bounds to the first block (stops
# at the first closing fence), so a body `---` or an absent key can never leak a body line. Plain
# scalars only; trailing spaces/CR are stripped so they never become part of a path.
fm_val() { awk -v k="$1" 'NR==1 && /^---$/ {f=1; next} f && /^---$/ {exit} f && index($0, k":")==1 {sub("^" k ":[ \t]*", ""); print; exit}' "$2" 2>/dev/null | tr -d '\r' | sed -E 's/[[:space:]]+$//'; }

# Same, for a link.md field. yad-spec writes link.md WITH frontmatter, but code repos still carry
# pre-frontmatter ones that contract-check used to read with a whole-file scan — so fall back to that
# rather than silently reading an empty value and skipping the check it guards. Deliberately separate
# from fm_val: hub artifacts (epic.md, stories/*.md) stay bounded to their first block.
link_val() {
  _v="$(fm_val "$1" "$2")"
  [ -n "$_v" ] || _v="$(sed -nE "s/^$1:[[:space:]]*(.*)\$/\1/p" "$2" 2>/dev/null | head -1 | tr -d '\r' | sed -E 's/[[:space:]]+$//')"
  printf '%s' "$_v"
}

# Resolve link.md's `product-repo` to a path in THIS checkout. An ABSOLUTE value is used as-is. A
# RELATIVE value is written relative to the link.md's own directory (specs/<story>/) — the canonical
# form — but contract-check historically read it from the repo root, so a link.md authored against that
# reading still resolves: prefer the canonical join, fall back to the root-relative one when only it
# exists. All four gates share this verbatim, so a value one gate can reach is reachable from every
# gate (issue #149). An unexpanded ~ or $VAR is returned untouched, so it fails the reachability test
# loudly instead of being joined into a nonsense path.
resolve_product() {
  case "$1" in
    '') return ;;
    /*|'~'*|'$'*) printf '%s' "$1" ;;
    *) if [ -d "specs/$2/$1" ] || [ ! -d "$1" ]; then printf 'specs/%s/%s' "$2" "$1"; else printf '%s' "$1"; fi ;;
  esac
}

commits="$(git rev-list --no-merges "$RANGE")"
if [ -z "$commits" ]; then
  echo "PASS [lineage-check]: no non-merge commits in ${RANGE}"
  exit 0
fi

rc=0
while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  short="$(git log -1 --format=%h "$sha")"
  subject="$(git log -1 --format=%s "$sha")"
  task="$(git log -1 --format='%(trailers:key=Task,valueonly)' "$sha" | sed '/^$/d' | head -1)"
  # The type exemption waives the REQUIREMENT for an owning epic, not the VALIDITY of one that is
  # claimed — same rule spec-link applies. Exempting on the subject alone would let `chore(x): …` plus
  # a Task trailer pointing at an orphaned/sealed epic bypass this gate entirely.
  if printf '%s' "$subject" | grep -qE "^(${EXEMPT})(\([a-z0-9._-]+\))?!?: " && [ -z "$task" ]; then
    echo "PASS [lineage-check]: ${short} '${subject}' — maintenance commit, no Task trailer (exempt)"
    continue
  fi
  # No / malformed Task trailer is spec-link's job to FAIL; here we only skip what we can't resolve.
  if ! printf '%s' "$task" | grep -qE '.+-T[0-9]+$'; then
    echo "note [lineage-check]: ${short} has no resolvable Task trailer — deferring to spec-link."
    continue
  fi
  story="$(printf '%s' "$task" | sed -E 's/-T[0-9]+$//')"
  link="specs/${story}/link.md"
  if [ ! -f "$link" ]; then
    echo "note [lineage-check]: ${short} ${task} — specs/${story}/link.md missing (spec-link will FAIL)."
    continue
  fi
  product_rel="$(link_val product-repo "$link")"
  epic="$(link_val epic "$link")"
  if [ -z "$epic" ]; then
    echo "FAIL [lineage-check]: ${short} ${task} — link.md has no 'epic:' (cannot place it in a thread)."
    rc=1
    continue
  fi
  prod="$(resolve_product "$product_rel" "$story")"
  epicmd="${prod}/epics/${epic}/epic.md"
  # Defer ONLY when the product checkout itself is unreachable. A reachable hub whose epic is missing is
  # an orphaned story link — FAIL, do not pass it off as "not reachable".
  if [ -z "$product_rel" ] || [ ! -d "$prod" ]; then
    echo "PASS [lineage-check]: ${short} ${task} -> epic ${epic} (product repo not reachable — lineage check deferred)."
    continue
  fi
  if [ ! -f "$epicmd" ]; then
    echo "FAIL [lineage-check]: ${short} ${task} -> epic ${epic} does not exist in the product repo (orphan story link)."
    rc=1
    continue
  fi
  kind="$(fm_val kind "$epicmd")"
  [ -z "$kind" ] && kind="feature"
  if [ "$kind" = "feature" ]; then
    echo "PASS [lineage-check]: ${short} ${task} -> ${epic} (genesis feature epic)."
    continue
  fi
  # A change/defect/hotfix epic MUST thread to a real parent.
  parent="$(fm_val parent "$epicmd")"
  if [ -z "$parent" ]; then
    echo "FAIL [lineage-check]: ${short} ${task} -> ${epic} is kind:${kind} but declares no 'parent:' — a change-epic must thread to its predecessor."
    rc=1
    continue
  fi
  if [ ! -f "${prod}/epics/${parent}/epic.md" ]; then
    echo "FAIL [lineage-check]: ${short} ${task} -> ${epic} threads to '${parent}', but epics/${parent}/ does not exist in the hub (orphan thread)."
    rc=1
    continue
  fi
  echo "PASS [lineage-check]: ${short} ${task} -> ${epic} (kind:${kind} threaded to ${parent})."
done <<EOF
$commits
EOF
exit "$rc"
