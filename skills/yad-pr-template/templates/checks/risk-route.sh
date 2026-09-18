#!/usr/bin/env bash
# Risk routing (Phase 3 build plan §D). Reads a PR/MR description's Impact & Risk block and prints how
# many approvers the change asks for, as the same sum the review gate prints: base 1, plus a risk step —
# `high` risk +1, a touched contract surface +2, the larger of the two and never their sum. Only the base
# holds a merge until the capacity cap lands; the risk step is advisory. There are no roles and no named
# owners: yadflow keeps no list of people (E62), so when a risk step raises the count the touched domains
# are printed as a hint for whom to ask (with no risk step it prints the base line alone). Advisory: it
# ROUTES the human review; it does not approve or merge.
#
# E66 — the risk map counts too. Run inside the code repo, ON THE PR'S BRANCH, it also asks
# `checks/risk-map-check.sh --level` which directories the change touches on the BASE branch's
# `.sdlc/risk-map`: a `high` one adds the high step (+1). The largest step wins, so the body can raise
# the count and never lower it — a body saying `low` on a change to a `high` directory still counts +1,
# and the output says the two disagree. When the map cannot be read, it says so and counts the body
# alone; it never guesses a level.
#
#   risk-route.sh <pr-description-file> [<base>]     <base> defaults the way the checks resolve it
set -euo pipefail

BODY="${1:?usage: risk-route.sh <pr-description-file> [<base>]}"
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

# The map's level for this change, from the risk-map check beside this script (wired together as
# checks/), or from the repo's checks/ when this copy runs from elsewhere. Machine lines, see that file.
here="$(cd "$(dirname "$0")" 2>/dev/null && pwd)" || here=""
checker=""
for c in "${here:+$here/}risk-map-check.sh" checks/risk-map-check.sh; do
  if [ -f "$c" ]; then checker="$c"; break; fi
done
if [ -z "$checker" ]; then
  lv="UNKNOWN checks/risk-map-check.sh is not here — wire it with \`yad update\`"
else
  lv="$(bash "$checker" --level ${2:+"$2"} 2>/dev/null)" || lv="UNKNOWN checks/risk-map-check.sh failed"
fi
line_of() { printf '%s\n' "$lv" | sed -n "s/^$1 //p" | head -1; }
dirs_of() { printf '%s\n' "$lv" | awk -v want="$1" '$1 == "DIR" && $3 == want { printf "%s%s%s", sep, $2, ($4 == "guessed") ? " (guessed)" : ""; sep = ", " }'; }
# A risk-map check from before E66 has no --level mode: it reads the flag as a base and prints warnings,
# none of the lines above. Reading that as "nothing is high" would be a guess, so it is unknown instead.
if [ -z "$(line_of UNKNOWN)$(line_of NOMAP)$(line_of LEVEL)" ]; then
  lv="UNKNOWN checks/risk-map-check.sh cannot count the risk map yet (it predates E66) — update it with \`yad update\`"
fi
map_base="$(line_of BASE)"
map_high=""
if [ -n "$(line_of UNKNOWN)" ]; then
  echo "Risk map: not counted — $(line_of UNKNOWN). Only the body is counted."
elif [ -n "$(line_of NOMAP)" ]; then
  echo "Risk map: none — $(line_of NOMAP), so no directory adds a step."
else
  map_high="$(dirs_of high)"
  map_medium="$(dirs_of medium)"
  if [ "$(line_of FILES)" = "0" ]; then
    echo "Risk map (${map_base}): this checkout changes no file against ${map_base} — run it on the PR's branch."
  elif [ -n "$map_high" ]; then
    echo "Risk map (${map_base}): high — ${map_high}"
  else
    echo "Risk map (${map_base}): $(line_of LEVEL) — nothing this change touches is high"
  fi
  [ -z "$map_medium" ] || echo "  medium (reported only, adds nothing): ${map_medium}"
fi

step=0
tier=""
why=""
if [ "$risk" = "high" ]; then step=1; tier=high; why="risk: high"; fi
if [ -n "$map_high" ]; then
  [ "$step" -ge 1 ] || { step=1; tier=high; }
  why="${why:+$why, }high on the risk map: ${map_high}"
fi
if [ "$contract" = "yes" ]; then step=2; tier=contract; why="${why:+$why, }contract surface touched"; fi

if [ "$step" -gt 0 ]; then
  echo "ROUTE: $((1 + step)) approvers = base 1 + ${tier} risk ${step} (${why})"
  # The body can raise the count and never lower it: say so when it tried to.
  if [ -n "$map_high" ] && [ "$risk" != "high" ]; then
    echo "       The body says Risk level: ${risk:-unspecified}, but the risk map on ${map_base} marks ${map_high} high — the larger counts."
  fi
  echo "       Only the base holds the merge until the capacity cap: 1 approval (GitHub blocks self-approval; GitLab only if its settings do)."
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
