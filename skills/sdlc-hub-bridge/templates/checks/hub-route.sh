#!/usr/bin/env bash
# Hub review routing — the front-half analogue of sdlc-pr-template's risk-route.sh. Reads a hub review
# PR/MR description's "Impact & Risk (front-half)" block and prints the required reviewers, reusing
# sdlc-review-gate's rule: base = owner + 1 reviewer; if a risk tag (contract|auth|payments) is set OR
# the artifact is the stories set, ALSO a domain-owner per touched repo. Advisory: it ROUTES the human
# review; it does not approve or merge.
set -euo pipefail

BODY="${1:?usage: hub-route.sh <hub-pr-description-file>}"
[ -f "$BODY" ] || { echo "hub-route: file not found: $BODY" >&2; exit 2; }

# Value side of the FIRST line matching a label regex, comments + markdown markers stripped. Tolerant:
# a missing label yields empty (never aborts) — an advisory helper must still print for a half-filled body.
value_of() {
  grep -iE "$1" "$BODY" 2>/dev/null | head -1 \
    | sed -E 's/<!--.*$//; s/^[^:]*://; s/[*`]//g; s/^[[:space:]]*//; s/[[:space:]]*$//' || true
}

risk_tags="$(printf '%s' "$(value_of 'Risk tags:')" | tr 'A-Z' 'a-z')"
repos="$(value_of 'Domains.*touched:')"
artifact="$(value_of 'Artifact:')"

echo "Risk tags: ${risk_tags:-none}"
echo "Repos touched: ${repos:-unspecified}"

escalate=no
why=""
case "$risk_tags" in
  *contract*) escalate=yes; why="risk tag: contract" ;;
esac
case "$risk_tags" in *auth*) escalate=yes; why="${why:+$why, }risk tag: auth" ;; esac
case "$risk_tags" in *payments*) escalate=yes; why="${why:+$why, }risk tag: payments" ;; esac
# The stories review routes per-repo even with no risk tag.
case "$artifact" in *stories*) escalate=yes; why="${why:+$why, }stories per-repo routing" ;; esac

if [ "$escalate" = "yes" ]; then
  echo "ROUTE: ESCALATED (${why}) -> owner + 1 reviewer PLUS one domain-owner approval per touched repo"
  echo "       (same escalation as sdlc-review-gate; map each repo to its domain_owner in repos.json)."
  case "$repos" in
    ""|*"<"*|*"…"*|*"|"*)
      echo "  (Repos line not filled in — list each touched repo to route the domain owners.)" ;;
    *)
      printf '%s\n' "$repos" | tr ',' '\n' | while IFS= read -r r; do
        r="$(printf '%s' "$r" | sed -E 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        [ -n "$r" ] && echo "  - domain-owner: $r"
      done ;;
  esac
else
  echo "ROUTE: base rule -> owner + 1 reviewer (no domain-owner escalation)."
fi
