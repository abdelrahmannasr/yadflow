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

fm_val() { sed -n '/^---$/,/^---$/p' "$2" 2>/dev/null | sed -nE "s/^$1:[[:space:]]*(.*)$/\1/p" | head -1 | tr -d '\r'; }

# Thread root of an epic dir: its frontmatter `thread:` if set, else the epic id (genesis).
thread_of() {
  ep_dir="$1"; ep_id="$2"
  t="$(fm_val thread "${ep_dir}/epic.md")"
  [ -n "$t" ] && printf '%s' "$t" || printf '%s' "$ep_id"
}

# Print "epicId" for any OPEN reconcile-debt on the given thread, excluding the current epic. Scans every
# epic's reconcile-debt.json in the product repo (a small JSON array). Best-effort JSON scan with grep —
# the ledger is machine-written one entry per object, so a per-object grep is reliable enough for a gate.
open_debt_on_thread() {
  prod="$1"; thread="$2"; self="$3"
  for dj in "${prod}"/epics/*/.sdlc/reconcile-debt.json; do
    [ -e "$dj" ] || continue
    # Only consider ledgers whose thread matches AND that carry an open status.
    if grep -q "\"thread\"[[:space:]]*:[[:space:]]*\"${thread}\"" "$dj" 2>/dev/null \
       && grep -q "\"status\"[[:space:]]*:[[:space:]]*\"open\"" "$dj" 2>/dev/null; then
      owner_epic="$(sed -nE 's/.*"epicId"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$dj" | head -1)"
      [ -z "$owner_epic" ] && owner_epic="$(basename "$(dirname "$(dirname "$dj")")")"
      [ "$owner_epic" = "$self" ] && continue
      printf '%s\n' "$owner_epic"
    fi
  done
}

commits="$(git rev-list --no-merges "$RANGE")"
if [ -z "$commits" ]; then
  echo "PASS [reconcile-debt]: no non-merge commits in ${RANGE}"
  exit 0
fi

rc=0
seen_threads=""
while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  short="$(git log -1 --format=%h "$sha")"
  subject="$(git log -1 --format=%s "$sha")"
  if printf '%s' "$subject" | grep -qE "^(${EXEMPT})(\([a-z0-9._-]+\))?!?: "; then
    continue
  fi
  task="$(git log -1 --format='%(trailers:key=Task,valueonly)' "$sha" | sed '/^$/d' | head -1)"
  printf '%s' "$task" | grep -qE '.+-T[0-9]+$' || continue
  story="$(printf '%s' "$task" | sed -E 's/-T[0-9]+$//')"
  link="specs/${story}/link.md"
  [ -f "$link" ] || continue
  product_rel="$(fm_val product-repo "$link")"
  epic="$(fm_val epic "$link")"
  # product-repo is relative to the link.md's directory (specs/<story>/), so join it there.
  prod="specs/${story}/${product_rel}"
  ep_dir="${prod}/epics/${epic}"
  if [ -z "$product_rel" ] || [ ! -d "$ep_dir" ]; then
    echo "PASS [reconcile-debt]: ${short} ${task} -> ${epic} (product repo not reachable — debt check deferred)."
    continue
  fi
  thread="$(thread_of "$ep_dir" "$epic")"
  # De-dup the (potentially expensive) thread scan per range.
  case " $seen_threads " in *" $thread "*) continue ;; esac
  seen_threads="$seen_threads $thread"
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
