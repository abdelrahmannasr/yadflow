#!/usr/bin/env bash
# Product review routing — the Shape analogue of yad-pr-template's risk-route.sh. Reads a Product review
# PR/MR description's "Impact & Risk (front-half)" block and prints how many approvers the gate asks for,
# as the same sum the gate prints: base 1, plus a risk step from the tags — `contract` +2, `auth` or
# `payments` +1, the largest and never the sum. Only the base holds the gate; the risk step is advisory.
# The gate reports that count capped at the number of active people less one (E72); this
# script cannot count people, so it prints the full sum. There are no roles and no named owners: yadflow
# keeps no list of people (E62), so when a risk tag raises the count the touched repos are printed as a
# hint for whom to ask (with no risk step it prints the base line alone). Advisory: it ROUTES the human
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

echo "Risk tags: ${risk_tags:-none}"
echo "Repos touched: ${repos:-unspecified}"

step=0
tier=""
why=""
# Whole tags only, as the gate reads them (`gateRuleFor`): `oauth` or `contracts` is not a risk tag.
tags=" $(printf '%s' "$risk_tags" | tr ',;' '  ' | tr -s '[:space:]' ' ') "
case "$tags" in *" auth "*) step=1; tier=high; why="risk tag: auth" ;; esac
case "$tags" in *" payments "*) step=1; tier=high; why="${why:+$why, }risk tag: payments" ;; esac
case "$tags" in *" contract "*) step=2; tier=contract; why="${why:+$why, }risk tag: contract" ;; esac

if [ "$step" -gt 0 ]; then
  echo "ROUTE: $((1 + step)) approvers = base 1 + ${tier} risk ${step} (${why})"
  echo "       Only the base holds the gate: 1 approval (the platform decides whether the author may give it)."
  echo "       The risk step is advisory; \`yad gate status\` prints it capped by the active people. Ask reviewers who know the touched repos:"
  case "$repos" in
    ""|*"<"*|*"…"*|*"|"*)
      echo "  (Repos line not filled in — list each touched repo so the right reviewers can be asked.)" ;;
    *)
      printf '%s\n' "$repos" | tr ',' '\n' | while IFS= read -r r; do
        r="$(printf '%s' "$r" | sed -E 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        if [ -n "$r" ]; then echo "  - $r"; fi   # not `&&`: an empty last item (`a, b,`) would exit 1
      done ;;
  esac
else
  echo "ROUTE: 1 approver = base 1 (no risk step)."
fi
