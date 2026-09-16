#!/usr/bin/env bash
# Risk routing (Phase 3 build plan §D). Reads a PR/MR description's Impact & Risk block and prints how
# many approvers the change asks for, as the same sum the review gate prints: base 1, plus a risk step —
# `high` risk +1, a touched contract surface +2, the larger of the two and never their sum. Only the base
# holds a merge until the capacity cap lands; the risk step is advisory. There are no roles and no named
# owners: yadflow keeps no list of people (E62), so the touched domains are printed as a hint for whom to
# ask. Advisory: it ROUTES the human review; it does not approve or merge.
set -euo pipefail

BODY="${1:?usage: risk-route.sh <pr-description-file>}"
[ -f "$BODY" ] || { echo "risk-route: file not found: $BODY" >&2; exit 2; }

# Value side of the FIRST line matching a label regex, with any HTML comment + markdown markers
# stripped. Tolerant: a missing label yields empty (never aborts) — an advisory helper must still
# produce output for a half-filled body. Anchor on the real label so the right line is read.
value_of() {
  grep -iE "$1" "$BODY" 2>/dev/null | head -1 \
    | sed -E 's/<!--.*$//; s/^[^:]*://; s/[*`]//g; s/^[[:space:]]*//; s/[[:space:]]*$//' || true
}

risk="$(printf '%s' "$(value_of 'Risk level:')" | tr 'A-Z' 'a-z' | grep -oE 'low|medium|high' | head -1 || true)"
contract="$(printf '%s' "$(value_of 'Contract surface touched:')" | tr 'A-Z' 'a-z' | grep -oE 'yes|no' | head -1 || true)"
domains="$(value_of 'Domains.*touched:')"

echo "Risk level: ${risk:-unspecified}"
echo "Contract surface touched: ${contract:-unspecified}"
echo "Domains touched: ${domains:-unspecified}"

step=0
tier=""
why=""
if [ "$risk" = "high" ]; then step=1; tier=high; why="risk: high"; fi
if [ "$contract" = "yes" ]; then step=2; tier=contract; why="${why:+$why, }contract surface touched"; fi

if [ "$step" -gt 0 ]; then
  echo "ROUTE: $((1 + step)) approvers = base 1 + ${tier} risk ${step} (${why})"
  echo "       Only the base holds the merge until the capacity cap: 1 approval from someone other than the author."
  echo "       The risk step is advisory. Ask reviewers who know the touched domains:"
  case "$domains" in
    ""|*"<"*|*"…"*|*"|"*)
      echo "  (Domains line not filled in — list each touched domain so the right reviewers can be asked.)" ;;
    *)
      printf '%s\n' "$domains" | tr ',' '\n' | while IFS= read -r d; do
        d="$(printf '%s' "$d" | sed -E 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        [ -n "$d" ] && echo "  - $d"
      done ;;
  esac
else
  echo "ROUTE: 1 approver = base 1 (no risk step)."
fi
