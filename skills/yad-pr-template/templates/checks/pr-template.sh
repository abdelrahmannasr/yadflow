#!/usr/bin/env bash
# pr-template gate.
# The PR/MR BODY must actually USE the committed template — i.e. carry its required sections so the
# review (and risk-route.sh) has the inputs it needs. This catches an empty / free-form description
# that bypassed the template.
#   --profile code (default) — the code-repo task template (yad-pr-template templates/<platform>/):
#     requires `## Summary`, `## Impact & Risk`, `## Checklist`, and a filled `Risk level:` (low|medium|high).
#   --profile hub — the front-half artifact-review template (templates/hub/<platform>/):
#     requires `## Artifact under review`, `## Impact & Risk (front-half)`, `## Checklist`, and a `Risk tags:` line.
#     BUT only for review/EP-* head branches. Every other hub PR is a tooling/code change to the hub
#     itself and uses the code task template instead; pass the head ref via --head so the gate knows
#     which template to require. With no --head, the hub profile stays strict (artifact-review template).
#     Branch name is not enough on its own: a non-review head that actually changes front-half
#     artifacts (epics/**) would otherwise slip past the review workflow with only the code template.
#     Pass the PR's changed paths via --changed <file> (one path per line); when they touch epics/**
#     on a non-review head the gate FAILS — artifact changes must go through a review/EP-* PR.
# The body is passed as a FILE path (single positional arg); CI writes the event body to a temp file
# (GitHub: github.event.pull_request.body; GitLab: $CI_MERGE_REQUEST_DESCRIPTION).
set -euo pipefail

PROFILE=code
HEADREF=""
CHANGED=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:-code}"; shift 2 ;;
    --profile=*) PROFILE="${1#*=}"; shift ;;
    --head) HEADREF="${2:-}"; shift 2 ;;
    --head=*) HEADREF="${1#*=}"; shift ;;
    --changed) CHANGED="${2:-}"; shift 2 ;;
    --changed=*) CHANGED="${1#*=}"; shift ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
case "$PROFILE" in code|hub) ;; *) echo "FAIL [pr-template]: unknown --profile '$PROFILE' (code|hub)."; exit 1 ;; esac

# True when the PR changes a front-half artifact (anything under epics/**). Reads the --changed list
# of paths CI computed from the PR diff; with no list (direct caller / test) it reports false.
artifact_changed() { [ -n "$CHANGED" ] && [ -f "$CHANGED" ] && grep -qE '^epics/' "$CHANGED"; }

BODY="${ARGS[0]:-}"
if [ -z "$BODY" ] || [ ! -f "$BODY" ]; then
  echo "FAIL [pr-template]: body file not found — pass the PR/MR description as a file path."
  exit 1
fi

# The Review Companion injects a `<!-- yad:trailer --> … <!-- /yad:trailer -->` briefing block (and
# `<!-- yad:noblock -->` notes) into the description. Strip those before the template check so the
# AI-generated prose can never hide a required section heading or be mistaken for the `Risk level:`
# value (the trailer is prepended, so an unstripped "risk level" mention would win `head -1`).
STRIPPED="$(mktemp)"
trap 'rm -f "$STRIPPED"' EXIT
sed '/<!-- yad:trailer -->/,/<!-- \/yad:trailer -->/d; /<!-- yad:noblock -->/d' "$BODY" > "$STRIPPED"
BODY="$STRIPPED"

rc=0
require_heading() {
  if ! grep -qiE "^[[:space:]]*$1[[:space:]]*$" "$BODY"; then
    echo "FAIL [pr-template]: missing section '${2}' — the PR/MR body does not use the template."
    rc=1
  fi
}

# The code task template: `## Summary`, `## Impact & Risk`, `## Checklist`, and a filled `Risk level:`.
# Used by the code profile and by hub tooling PRs (any head branch that is not review/EP-*).
check_code_body() {
  require_heading '## Summary' '## Summary'
  require_heading '## Impact & Risk' '## Impact & Risk'
  require_heading '## Checklist' '## Checklist'
  # Risk level must be present AND filled with a real value (not the <placeholder>).
  local rl
  rl="$(grep -iE '(\*\*)?Risk level:' "$BODY" | head -1 \
        | sed -E 's/<!--.*$//; s/^[^:]*://; s/[*`]//g; s/^[[:space:]]*//; s/[[:space:]]*$//' || true)"
  rl="$(printf '%s' "$rl" | tr 'A-Z' 'a-z' | grep -oE 'low|medium|high' | head -1 || true)"
  if [ -z "$rl" ]; then
    echo "FAIL [pr-template]: 'Risk level:' missing or not set to low|medium|high."
    rc=1
  fi
}

# The front-half artifact-review template.
check_hub_body() {
  require_heading '## Artifact under review' '## Artifact under review'
  require_heading '## Impact & Risk \(front-half\)' '## Impact & Risk (front-half)'
  require_heading '## Checklist' '## Checklist'
  if ! grep -qiE '(\*\*)?Risk tags:' "$BODY"; then
    echo "FAIL [pr-template]: missing 'Risk tags:' line (front-half Impact & Risk)."
    rc=1
  fi
}

KIND="$PROFILE"
if [ "$PROFILE" = hub ]; then
  case "$HEADREF" in
    review/EP-*|"") check_hub_body ;;            # artifact-review PR (or unknown head — stay strict)
    *)
      # tooling/code change to the hub itself — UNLESS it changes front-half artifacts (epics/**),
      # which must go through a review/EP-* PR. Without this guard a non-review head could carry an
      # artifact change past the front-half review with only the code template.
      if artifact_changed; then
        echo "FAIL [pr-template]: head '${HEADREF}' changes front-half artifacts (epics/**) but is not a review/EP-* branch — artifact changes must go through a review PR."
        rc=1
      else
        check_code_body; KIND="hub-tooling"
      fi
      ;;
  esac
else
  check_code_body
fi

[ "$rc" = 0 ] && echo "PASS [pr-template]: body uses the ${KIND} template (required sections present)."
exit "$rc"
