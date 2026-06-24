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
# The body is passed as a FILE path (single positional arg); CI writes the event body to a temp file
# (GitHub: github.event.pull_request.body; GitLab: $CI_MERGE_REQUEST_DESCRIPTION).
set -euo pipefail

PROFILE=code
HEADREF=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:-code}"; shift 2 ;;
    --profile=*) PROFILE="${1#*=}"; shift ;;
    --head) HEADREF="${2:-}"; shift 2 ;;
    --head=*) HEADREF="${1#*=}"; shift ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
case "$PROFILE" in code|hub) ;; *) echo "FAIL [pr-template]: unknown --profile '$PROFILE' (code|hub)."; exit 1 ;; esac

BODY="${ARGS[0]:-}"
if [ -z "$BODY" ] || [ ! -f "$BODY" ]; then
  echo "FAIL [pr-template]: body file not found — pass the PR/MR description as a file path."
  exit 1
fi

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
    *) check_code_body; KIND="hub-tooling" ;;    # tooling/code change to the hub itself
  esac
else
  check_code_body
fi

[ "$rc" = 0 ] && echo "PASS [pr-template]: body uses the ${KIND} template (required sections present)."
exit "$rc"
