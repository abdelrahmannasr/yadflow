#!/usr/bin/env bash
# Risk routing (Phase 3 build plan §D). Reads a PR/MR description's Impact & Risk block and prints the
# required reviewers, reusing sdlc-review-gate's escalation: a `high` risk level — or a touched
# contract/auth/payments surface — requires a domain-owner approval per touched domain, on top of the
# base rule (owner + 1 reviewer). Advisory: it ROUTES the human review; it does not approve or merge.
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

if [ "$risk" = "high" ] || [ "$contract" = "yes" ]; then
  why=""
  [ "$risk" = "high" ] && why="risk: high"
  [ "$contract" = "yes" ] && why="${why:+$why, }contract surface touched"
  echo "ROUTE: ESCALATED (${why}) -> owner + 1 reviewer PLUS one domain-owner approval per touched domain"
  echo "       (same escalation as sdlc-review-gate). Required domain owners:"
  case "$domains" in
    ""|*"<"*|*"…"*|*"|"*)
      echo "  (Domains line not filled in — list each touched domain to route the owners.)" ;;
    *)
      printf '%s\n' "$domains" | tr ',' '\n' | while IFS= read -r d; do
        d="$(printf '%s' "$d" | sed -E 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        [ -n "$d" ] && echo "  - domain-owner: $d"
      done ;;
  esac
else
  echo "ROUTE: base rule -> owner + 1 reviewer (no domain-owner escalation)."
fi
