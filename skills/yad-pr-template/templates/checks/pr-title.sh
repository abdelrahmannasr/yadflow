#!/usr/bin/env bash
# pr-title gate.
# The PR/MR TITLE must follow the convention for its repo kind:
#   --profile code (default) — a Conventional-Commits subject "<type>: <description>", no trailing
#     period (config.yaml build.pr_title_style: same_as_commit_subject; one task = one PR, the title is
#     the squash-merge subject). Keep <type> in sync with cli/manifest.mjs COMMIT_TYPES.
#   --profile product (old name: hub) — a Shape artifact-review title "review: <artifact> (EP-<slug>)", the shape
#     `yad gate open` creates (cli/gate.mjs) — BUT only for review/EP-* head branches. Every other
#     Product PR is a tooling/code change to the Product itself and follows the code convention; pass the
#     head ref via --head so the gate can tell the two apart (a tooling PR has no EP artifact to
#     review). With no --head, the Product profile stays strict (requires the review shape).
#     Branch name is not enough on its own: a non-review head that actually changes Shape
#     artifacts (epics/**) would otherwise slip past the review workflow with a plain code title.
#     Pass the PR's changed paths via --changed <file> (one path per line); when they touch epics/**
#     on a non-review head the gate FAILS — artifact changes must go through a review/EP-* PR.
#     Build the list with `git -c core.quotePath=false diff --no-renames --name-only`: without
#     --no-renames a rename lists only its new path, and the removed artifact is never seen.
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
case "$PROFILE" in code|hub|product) ;; *) echo "FAIL [pr-title]: unknown --profile '$PROFILE' (code|product, or hub, the old name for product)."; exit 1 ;; esac
# `product` is the Product's profile. `hub` is its old name, and BOTH are accepted.
#
# This script and the workflow that passes the flag are both in PRODUCT_WIRING (cli/manifest.mjs) and
# normally land together on one `yad update` — but not always: a copy the team edited is kept. So the
# order is add-before-remove: the new spelling was accepted first, the workflow templates switched to
# emit it in E123 (`yad-product-checks.yml`), and the old one is dropped after that. `hub` stays
# accepted meanwhile, for a workflow of the team's own or one they edited. The other direction — an
# edited copy of THIS script from before 4.0, which rejects `product`, beside the new workflow — fails
# every Product PR; `yad update` and `yad doctor` (`profile:`) say so.
#
# Normalised to `product` immediately, so nothing below has to know there are two spellings. That is
# load-bearing in pr-title.sh and pr-template.sh: leave `$PROFILE` as `hub` and the `= product`
# branch is skipped, taking the whole review-branch arm with it — including the guard that stops a
# plain code title carrying an artifact change past its review.
[ "$PROFILE" = hub ] && PROFILE=product


# True when the PR changes a Shape artifact (anything under epics/** — or foundation/**, the Product level, E75). Reads the --changed list
# of paths CI computed from the PR diff; with no list (direct caller / test) it reports false.
# Two records are not artifacts: a step owner file (`yad assign`, E47) and an epic's issue-links file (`yad issues
# link`, E170, #512). Both are reviewed by nobody (an assignment is advice; a link names where a tracker item is),
# and a review/EP-* PR would advance a step on merge. So a PR of these files alone is not an artifact change.
# The issue-links file is a feature epic's only: `yad issues link` refuses the Foundation, so foundation/ has none.
# No `-q` on the second grep: under pipefail an early exit would SIGPIPE the first and read as "no artifact".
# `"?`: git still C-quotes a path holding `"`, `\`, a tab or a newline, even with core.quotePath=false. Such a
# line counts as an artifact, and neither exemption matches it — so it fails closed.
# `LC_ALL=C grep -a` on both: with quotePath off a path's high bytes arrive raw, and GNU grep under a UTF-8
# locale drops a line that is not valid UTF-8 from its output — the pipe would then read as "no artifact".
artifact_changed() { [ -n "$CHANGED" ] && [ -f "$CHANGED" ] && LC_ALL=C grep -aE '^"?(epics|foundation)/' "$CHANGED" | LC_ALL=C grep -avE '^(epics/EP-[^/]+|foundation)/\.sdlc/owners/[^/]+\.json$|^epics/EP-[^/]+/\.sdlc/issue-links\.json$' >/dev/null; }

TITLE="${ARGS[0]:-}"
if [ -z "$TITLE" ]; then
  echo "FAIL [pr-title]: empty title — pass the PR/MR title as the argument."
  exit 1
fi

# A GitLab draft MR carries its draft mark IN the title: `Draft:`, `[Draft]` or `(Draft)`, any case (GitLab
# 14 and later; the older `WIP:` is not one) (#451). Marking the MR ready removes it but starts no pipeline,
# so the draft-time result is the one that stands at merge: the mark is stripped before the title is judged.
# A repeat is stripped too — a title that still starts with a mark is still a draft, and cannot merge. Only in GitLab CI (GITLAB_CI=true on every job) — a GitHub draft is a
# flag, so there a `Draft:` title would be the squash subject and still fails. An environment variable, not a
# flag: the gate runs the base branch's copy of this script with the PR's call (#426), and an older copy
# would read an unknown flag as the title.
DRAFT=""
if [ "${GITLAB_CI:-}" = true ]; then
  while :; do
    # Matched by pattern, not lower-cased with `tr`: no process, and no locale (BSD tr stops on a byte that
    # is not valid UTF-8, which under `set -e` would end the job with no FAIL line).
    case "$TITLE" in
      '['[Dd][Rr][Aa][Ff][Tt]']'* | '('[Dd][Rr][Aa][Ff][Tt]')'*) n=7 ;;
      [Dd][Rr][Aa][Ff][Tt]':'*) n=6 ;;
      *) break ;;
    esac
    DRAFT="${DRAFT}${TITLE:0:n}"
    TITLE="${TITLE:n}"
    TITLE="${TITLE#"${TITLE%%[![:space:]]*}"}"
  done
fi
DRAFT_NOTE=""
if [ -n "$DRAFT" ]; then
  if [ -z "$TITLE" ]; then
    echo "FAIL [pr-title]: the title is only the GitLab draft marker '${DRAFT}' — write the title after it."
    exit 1
  fi
  echo "note [pr-title]: the GitLab draft marker '${DRAFT}' is not part of the title that is checked."
  DRAFT_NOTE=", GitLab draft marker ignored"
fi

TYPES='feat|fix|docs|refactor|test|perf|build|ci|chore|revert'

# Conventional-Commits subject (optional scope + breaking `!`), no trailing period. Used by the code
# profile and by Product tooling PRs (any head branch that is not review/EP-*).
check_code_title() {
  if ! printf '%s' "$TITLE" | grep -qE "^(${TYPES})(\([a-z0-9._-]+\))?!?: .+"; then
    echo "FAIL [pr-title]: '${TITLE}' is not '<type>(<scope>)?!?: <description>' (type one of: ${TYPES//|/, })."
    exit 1
  fi
  if printf '%s' "$TITLE" | grep -qE '\.$'; then
    echo "FAIL [pr-title]: '${TITLE}' must not end with a period."
    exit 1
  fi
  echo "PASS [pr-title]: '${TITLE}' (profile: ${PROFILE}, tooling/code${DRAFT_NOTE})"
  exit 0
}

if [ "$PROFILE" = product ]; then
  # review/EP-* head branch (or unknown head ref) => Shape artifact-review PR: 'review: <artifact> (EP-<slug>)'.
  case "$HEADREF" in
    review/EP-*|"")
      if printf '%s' "$TITLE" | grep -qE '^review: .+ \(EP-[a-z0-9-]+\)$'; then
        echo "PASS [pr-title]: '${TITLE}' (profile: product, artifact-review${DRAFT_NOTE})"
        exit 0
      fi
      echo "FAIL [pr-title]: '${TITLE}' is not a Product review title 'review: <artifact> (EP-<slug>)'."
      exit 1
      ;;
    *)
      # Any other Product PR is a tooling/code change to the Product itself — UNLESS it changes Shape
      # artifacts (epics/**), which must go through a review/EP-* PR. Without this guard a non-review
      # head could carry an artifact change past the Shape review with only a code title.
      if artifact_changed; then
        echo "FAIL [pr-title]: head '${HEADREF}' changes Shape artifacts (epics/** or foundation/**) but is not a review/EP-* branch — move those changes to a review/<epic>/<artifact> branch, like review/EP-<slug>/architecture (review/EP-foundation/foundation for foundation/), and run yad open-pr from it, which pushes the branch and opens the review PR; or drop them from this PR."
        exit 1
      fi
      # tooling only — fall through to the code convention.
      ;;
  esac
fi

check_code_title
