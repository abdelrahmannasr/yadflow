#!/usr/bin/env bash
# pr-title gate.
# The PR/MR TITLE must follow the convention for its repo kind:
#   --profile code (default) — a Conventional-Commits subject "<type>: <description>", no trailing
#     period (config.yaml build.pr_title_style: same_as_commit_subject; one task = one PR, the title is
#     the squash-merge subject). Keep <type> in sync with cli/manifest.mjs COMMIT_TYPES.
#   --profile hub — a front-half artifact-review title "review: <artifact> (EP-<slug>)", the shape
#     `yad gate open` creates (cli/gate.mjs) — BUT only for review/EP-* head branches. Every other
#     hub PR is a tooling/code change to the hub itself and follows the code convention; pass the
#     head ref via --head so the gate can tell the two apart (a tooling PR has no EP artifact to
#     review). With no --head, the hub profile stays strict (requires the review shape).
#     Branch name is not enough on its own: a non-review head that actually changes front-half
#     artifacts (epics/**) would otherwise slip past the review workflow with a plain code title.
#     Pass the PR's changed paths via --changed <file> (one path per line); when they touch epics/**
#     on a non-review head the gate FAILS — artifact changes must go through a review/EP-* PR.
# The title is passed as the (single) positional arg; CI injects it from the event payload
# (GitHub: github.event.pull_request.title; GitLab: $CI_MERGE_REQUEST_TITLE).
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
case "$PROFILE" in code|hub) ;; *) echo "FAIL [pr-title]: unknown --profile '$PROFILE' (code|hub)."; exit 1 ;; esac

# True when the PR changes a front-half artifact (anything under epics/**). Reads the --changed list
# of paths CI computed from the PR diff; with no list (direct caller / test) it reports false.
artifact_changed() { [ -n "$CHANGED" ] && [ -f "$CHANGED" ] && grep -qE '^epics/' "$CHANGED"; }

TITLE="${ARGS[0]:-}"
if [ -z "$TITLE" ]; then
  echo "FAIL [pr-title]: empty title — pass the PR/MR title as the argument."
  exit 1
fi

TYPES='feat|fix|docs|refactor|test|perf|build|ci|chore|revert'

# Conventional-Commits subject (optional scope + breaking `!`), no trailing period. Used by the code
# profile and by hub tooling PRs (any head branch that is not review/EP-*).
check_code_title() {
  if ! printf '%s' "$TITLE" | grep -qE "^(${TYPES})(\([a-z0-9._-]+\))?!?: .+"; then
    echo "FAIL [pr-title]: '${TITLE}' is not '<type>(<scope>)?!?: <description>' (type one of: ${TYPES//|/, })."
    exit 1
  fi
  if printf '%s' "$TITLE" | grep -qE '\.$'; then
    echo "FAIL [pr-title]: '${TITLE}' must not end with a period."
    exit 1
  fi
  echo "PASS [pr-title]: '${TITLE}' (profile: ${PROFILE}, tooling/code)"
  exit 0
}

if [ "$PROFILE" = hub ]; then
  # review/EP-* head branch (or unknown head ref) => front-half artifact-review PR: 'review: <artifact> (EP-<slug>)'.
  case "$HEADREF" in
    review/EP-*|"")
      if printf '%s' "$TITLE" | grep -qE '^review: .+ \(EP-[a-z0-9-]+\)$'; then
        echo "PASS [pr-title]: '${TITLE}' (profile: hub, artifact-review)"
        exit 0
      fi
      echo "FAIL [pr-title]: '${TITLE}' is not a hub review title 'review: <artifact> (EP-<slug>)'."
      exit 1
      ;;
    *)
      # Any other hub PR is a tooling/code change to the hub itself — UNLESS it changes front-half
      # artifacts (epics/**), which must go through a review/EP-* PR. Without this guard a non-review
      # head could carry an artifact change past the front-half review with only a code title.
      if artifact_changed; then
        echo "FAIL [pr-title]: head '${HEADREF}' changes front-half artifacts (epics/**) but is not a review/EP-* branch — artifact changes must go through a review PR."
        exit 1
      fi
      # tooling only — fall through to the code convention.
      ;;
  esac
fi

check_code_title
