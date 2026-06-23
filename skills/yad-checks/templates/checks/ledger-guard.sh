#!/usr/bin/env bash
# ledger-guard gate.
# The gate ledger is CI-owned: only the yad gate-sync bot may change the machine-written gate-state
# files. A commit on a review PR by anyone else that modifies them is rejected — the human keeps the
# artifact, CI keeps the ledger. This makes "CI is the sole writer of the ledger" a mechanical
# guarantee instead of a convention.
#
# Protected (gate-state, machine-written):
#   epics/*/.sdlc/state.json, approvals.json, comments.json, hub-prs.json
#   epics/*/reviews/*.md
# NOT protected:
#   epics/*/.sdlc/contract-lock.json — artifact-side: the architect locks the contract surface in
#   `gate open`, so a human legitimately commits it alongside the architecture artifact.
#
# Exempt author: the gate bot (yad-gate-sync[bot] / yad-gate-sync). The AUTHOR is checked, not the
# committer, so a human rebase that re-commits the bot's ledger work still passes; and if a
# force-push drops the bot's ledger commits, CI rebuilds them on the next event.
#
# Degradation is explicit: a base ref that cannot be resolved FAILs closed (a guard must never pass
# on a broken check).
set -euo pipefail

BASE="${1:-${SDLC_BASE:-origin/main}}"

if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [ledger-guard]: base ref '${BASE}' not found — fetch full history / check the base branch."
  exit 1
fi
RANGE="${BASE}..HEAD"

commits="$(git rev-list "$RANGE")"
if [ -z "$commits" ]; then
  echo "PASS [ledger-guard]: no commits in ${RANGE}"
  exit 0
fi

# 0 when the commit is AUTHORED by the gate bot (name or email contains yad-gate-sync).
is_bot() {
  case "$(git show -s --format='%an|%ae' "$1")" in
    *yad-gate-sync*) return 0 ;;
    *) return 1 ;;
  esac
}

violations=0
for sha in $commits; do
  is_bot "$sha" && continue
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      epics/*/.sdlc/contract-lock.json) ;; # artifact-side — allowed
      epics/*/.sdlc/state.json|epics/*/.sdlc/approvals.json|epics/*/.sdlc/comments.json|epics/*/.sdlc/hub-prs.json|epics/*/reviews/*.md)
        echo "FAIL [ledger-guard]: commit ${sha} (author $(git show -s --format='%an' "$sha")) modifies CI-owned gate file: $f"
        violations=$((violations + 1))
        ;;
    esac
  done < <(git diff-tree --no-commit-id --name-only -r "$sha")
done

if [ "$violations" -gt 0 ]; then
  echo "FAIL [ledger-guard]: ${violations} gate-state change(s) by a non-bot author. The ledger is CI-owned — let CI sync the gate; do not commit .sdlc/*.json or reviews/*.md yourself."
  exit 1
fi
echo "PASS [ledger-guard]: no non-bot edits to CI-owned gate files in ${RANGE}"
exit 0
