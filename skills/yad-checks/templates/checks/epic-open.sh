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

# --- shared base resolution (byte-identical across the gates; they are standalone by design, so it
# --- is duplicated, not sourced) ---
# With no explicit base, RESOLVE the trunk instead of assuming a hardcoded `origin/main` — on a repo
# whose trunk is `develop`/`master` that guess either fails closed or, where a stale `main` still
# exists, silently diffs the WRONG range (issue #161). Mirrors the CLI's own order (cli/hubcommit.mjs,
# cli/repo.mjs): the CONFIGURED default_branch first, then the remote's published default
# (origin/HEAD), then origin/main. Each candidate must actually resolve before it is used, so a
# DANGLING origin/HEAD (trunk renamed, the old remote-tracking ref pruned) falls through to the next
# candidate instead of failing the gate on a fully-fetched repo. CI always passes the base explicitly,
# so this governs local runs only. The `|| _x=""` guards are load-bearing: under `set -e` a failing
# command substitution in an assignment aborts the script.
resolve_base() {
  _cfg="$(sed -nE 's/.*"default_branch"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "${SDLC_HUB_CONFIG:-.sdlc/hub.json}" 2>/dev/null | head -1)" || _cfg=""
  _head="$(git symbolic-ref --short --quiet refs/remotes/origin/HEAD 2>/dev/null)" || _head=""
  for _c in "origin/${_cfg}" "${_head}" origin/main; do
    case "$_c" in ''|origin/) continue ;; esac
    if git rev-parse --verify --quiet "${_c}^{commit}" >/dev/null 2>&1; then printf '%s' "$_c"; return; fi
  done
  printf '%s' origin/main
}

BASE="${1:-${SDLC_BASE:-$(resolve_base)}}"
[ -n "${1:-}" ] || [ -n "${SDLC_BASE:-}" ] || echo "note [epic-open]: no base given — diffing against '${BASE}'."

if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [epic-open]: base ref '${BASE}' not found — fetch full history / check the base branch."
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
  task="$(git log -1 --format='%(trailers:key=Task,valueonly)' "$sha" | sed '/^$/d' | head -1)"
  # The type exemption waives the REQUIREMENT for an owning epic, not the VALIDITY of one that is
  # claimed — same rule spec-link applies. Exempting on the subject alone would let `chore(x): …` plus
  # a Task trailer pointing at a SEALED epic add behaviour to it, which is exactly what this gate exists
  # to refuse.
  if printf '%s' "$subject" | grep -qE "^(${EXEMPT})(\([a-z0-9._-]+\))?!?: " && [ -z "$task" ]; then
    echo "PASS [epic-open]: ${short} '${subject}' — maintenance commit, no Task trailer (exempt)"
    continue
  fi
  if ! printf '%s' "$task" | grep -qE '.+-T[0-9]+$'; then
    echo "note [epic-open]: ${short} has no resolvable Task trailer — deferring to spec-link."
    continue
  fi
  story="$(printf '%s' "$task" | sed -E 's/-T[0-9]+$//')"
  link="specs/${story}/link.md"
  [ -f "$link" ] || { echo "note [epic-open]: ${short} ${task} — link.md missing (spec-link will FAIL)."; continue; }
  product_rel="$(link_val product-repo "$link")"
  epic="$(link_val epic "$link")"
  # A malformed link.md (empty product-repo, or an epic that is not a real EP-<slug>) must FAIL, not
  # slip through as "not reachable" — an empty epic would collapse ep_dir to <product>/epics/ (a real
  # dir) and pass the seal check as if the epic were open.
  if [ -z "$product_rel" ] || ! printf '%s' "$epic" | grep -qE '^EP-[a-z0-9-]+$'; then
    echo "FAIL [epic-open]: ${short} ${task} — link.md has no valid product-repo/epic metadata."
    rc=1
    continue
  fi
  prod="$(resolve_product "$product_rel" "$story")"
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
