#!/usr/bin/env bash
# pr-title gate.
# The PR/MR TITLE must follow the convention for its repo kind:
#   --profile code (default) — a Conventional-Commits subject "<type>: <description>", no trailing
#     period (config.yaml build.pr_title_style: same_as_commit_subject; one task = one PR, the title is
#     the squash-merge subject). Keep <type> in sync with cli/manifest.mjs COMMIT_TYPES.
#   --profile hub — a front-half artifact-review title "review: <artifact> (EP-<slug>)", the shape
#     `yad gate open` creates (cli/gate.mjs).
# The title is passed as the (single) positional arg; CI injects it from the event payload
# (GitHub: github.event.pull_request.title; GitLab: $CI_MERGE_REQUEST_TITLE).
set -euo pipefail

PROFILE=code
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:-code}"; shift 2 ;;
    --profile=*) PROFILE="${1#*=}"; shift ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
case "$PROFILE" in code|hub) ;; *) echo "FAIL [pr-title]: unknown --profile '$PROFILE' (code|hub)."; exit 1 ;; esac

TITLE="${ARGS[0]:-}"
if [ -z "$TITLE" ]; then
  echo "FAIL [pr-title]: empty title — pass the PR/MR title as the argument."
  exit 1
fi

TYPES='feat|fix|docs|refactor|test|perf|build|ci|chore|revert'

if [ "$PROFILE" = hub ]; then
  # review: <artifact> (EP-<slug>)
  if printf '%s' "$TITLE" | grep -qE '^review: .+ \(EP-[a-z0-9-]+\)$'; then
    echo "PASS [pr-title]: '${TITLE}' (profile: hub)"
    exit 0
  fi
  echo "FAIL [pr-title]: '${TITLE}' is not a hub review title 'review: <artifact> (EP-<slug>)'."
  exit 1
fi

# code profile — Conventional-Commits subject, no trailing period.
if ! printf '%s' "$TITLE" | grep -qE "^(${TYPES}): .+"; then
  echo "FAIL [pr-title]: '${TITLE}' is not '<type>: <description>' (type one of: ${TYPES//|/, })."
  exit 1
fi
if printf '%s' "$TITLE" | grep -qE '\.$'; then
  echo "FAIL [pr-title]: '${TITLE}' must not end with a period."
  exit 1
fi
echo "PASS [pr-title]: '${TITLE}' (profile: code)"
