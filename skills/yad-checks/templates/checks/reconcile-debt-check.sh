#!/usr/bin/env bash
# reconcile-debt gate (Phase 6 — hotfix debt). A hotfix may ship code BEFORE its front gates approve
# (ship-first), but it opens a reconcile-debt.json entry: the front artifacts do not yet describe what
# is in production. That debt must be PAID (artifacts updated + a regression test added) before the NEXT
# normal change on the same feature thread can ship. This gate FAILs a non-maintenance commit whose
# owning epic is on a thread carrying an OPEN debt that this epic does not itself own.
#
# Thread-scoped (only the affected thread is frozen, never the whole repo). Reads the PRODUCT repo via
# specs/<story>/link.md `product-repo`; degrades to PASS-with-note when it is not reachable. Per commit;
# ci/chore/build/test exempt. Fails CLOSED on an unresolvable base.
set -euo pipefail

BASE="${1:-${SDLC_BASE:-origin/main}}"

if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [reconcile-debt]: base ref '${BASE}' not found — fetch full history / check the base branch."
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

# Thread ROOT of an epic: walk `parent:` to the genesis (no parent). COMPUTED — never trusts the
# denormalized `thread:` cache, so a missing/wrong cache cannot bypass the freeze. Cycle-safe.
thread_root() {
  prod="$1"; cur="$2"; seen=" "
  while : ; do
    case "$seen" in *" $cur "*) break ;; esac   # cycle guard -> stop at the last seen id
    seen="$seen$cur "
    em="${prod}/epics/${cur}/epic.md"
    [ -f "$em" ] || break
    p="$(fm_val parent "$em")"
    [ -z "$p" ] && { printf '%s' "$cur"; return; }   # genesis reached
    cur="$p"
  done
  printf '%s' "$cur"
}

# Print "epicId" for any epic that (a) belongs to the target thread — by COMPUTED membership, not the
# debt's `thread` field — (b) is not the current epic, and (c) has an OPEN entry in its reconcile-debt
# ledger. Because each ledger lives under exactly one epic (one thread), "this epic is on the thread AND
# its ledger has an open status" is the correct, per-object-safe test.
open_debt_on_thread() {
  prod="$1"; thread="$2"; self="$3"
  for dj in "${prod}"/epics/*/.sdlc/reconcile-debt.json; do
    [ -e "$dj" ] || continue
    owner_epic="$(basename "$(dirname "$(dirname "$dj")")")"   # the epic that OWNS this ledger
    [ "$owner_epic" = "$self" ] && continue
    [ "$(thread_root "$prod" "$owner_epic")" = "$thread" ] || continue   # computed thread membership
    grep -q "\"status\"[[:space:]]*:[[:space:]]*\"open\"" "$dj" 2>/dev/null || continue
    printf '%s\n' "$owner_epic"
  done
}

commits="$(git rev-list --no-merges "$RANGE")"
if [ -z "$commits" ]; then
  echo "PASS [reconcile-debt]: no non-merge commits in ${RANGE}"
  exit 0
fi

rc=0
seen_keys=""
while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  short="$(git log -1 --format=%h "$sha")"
  subject="$(git log -1 --format=%s "$sha")"
  task="$(git log -1 --format='%(trailers:key=Task,valueonly)' "$sha" | sed '/^$/d' | head -1)"
  # The type exemption waives the REQUIREMENT for an owning epic, not the VALIDITY of one that is
  # claimed — same rule spec-link applies. Exempting on the subject alone would let `chore(x): …` plus
  # a Task trailer ship a change onto a thread that is frozen for open hotfix debt.
  if printf '%s' "$subject" | grep -qE "^(${EXEMPT})(\([a-z0-9._-]+\))?!?: " && [ -z "$task" ]; then
    continue
  fi
  printf '%s' "$task" | grep -qE '.+-T[0-9]+$' || continue
  story="$(printf '%s' "$task" | sed -E 's/-T[0-9]+$//')"
  link="specs/${story}/link.md"
  [ -f "$link" ] || continue
  product_rel="$(link_val product-repo "$link")"
  epic="$(link_val epic "$link")"
  prod="$(resolve_product "$product_rel" "$story")"
  ep_dir="${prod}/epics/${epic}"
  if [ -z "$product_rel" ] || [ ! -d "$ep_dir" ]; then
    echo "PASS [reconcile-debt]: ${short} ${task} -> ${epic} (product repo not reachable — debt check deferred)."
    continue
  fi
  thread="$(thread_root "$prod" "$epic")"
  # De-dup by (thread, epic) — NOT thread alone. open_debt_on_thread excludes the CURRENT epic, so the
  # blocker set depends on both; caching by thread would make later commits on a different epic in the
  # same thread inherit the first epic's result (order-dependent, can miss a real block).
  key="${thread}:${epic}"
  case " $seen_keys " in *" $key "*) continue ;; esac
  seen_keys="$seen_keys $key"
  blockers="$(open_debt_on_thread "$prod" "$thread" "$epic")"
  if [ -n "$blockers" ]; then
    echo "FAIL [reconcile-debt]: thread ${thread} carries OPEN hotfix debt:"
    printf '%s\n' "$blockers" | sed 's/^/    /'
    echo "  -> Pay it first: update the front artifacts + add the regression test, then mark the"
    echo "     reconcile-debt.json entry status: paid. The thread is frozen for new changes until then."
    rc=1
    continue
  fi
  echo "PASS [reconcile-debt]: thread ${thread} has no open hotfix debt."
done <<EOF
$commits
EOF
exit "$rc"
