#!/usr/bin/env bash
# Do the wired gate-sync fragments ship the major this release publishes?
#
# Each fragment resolves which yadflow its CI job runs, and trusts a version from a committed file only
# when it is an exact release of the fragment's OWN major — `YAD_MAJOR` in its `yad-pin` block
# (skills/yad-hub-bridge/references/bridge.md, "Which yadflow the wired job runs"). `yad update` rewrites
# the fragment and re-stamps `.sdlc/cli-version.json` together, so the rule costs a user nothing — as
# long as the fragment says the right major. When it does not, a 4.x release ships a fragment that
# rejects every 4.x stamp and falls back to `yadflow@3`: CI silently runs an older engine against a
# project on a newer file shape. That is the step a person forgets at a major, so a machine holds it.
#
# The major a release publishes is not known before semantic-release runs, but it follows from the
# same facts `scripts/shape-guide-check.sh` reads:
#   - the last release tag reachable from HEAD, and
#   - whether semantic-release reads a commit since then as breaking (scripts/release-type.mjs asks its
#     own analyzer — this repo's preset does not count a `feat!:` subject on its own).
# A breaking change moves the major by one — EXCEPT on top of a prerelease of a new major
# (`v4.0.0-next.1`), which already is that bump: the next breaking commit there is `4.0.0-next.2`.
#
# Split out of release-check.sh so it can be run and tested on its own:
#   bash scripts/pin-major-check.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

die() { printf '\nRELEASE CHECK FAILED: %s\n' "$*" >&2; exit 1; }

FRAGMENTS=(
  skills/yad-hub-bridge/templates/github/yad-gate-sync.yml
  skills/yad-hub-bridge/templates/gitlab/yad-gate-sync.gitlab-ci.yml
)

# The major each fragment ships with. Every `YAD_MAJOR=<n>` line in every fragment must agree.
MAJORS="$(grep -hE '^[[:space:]]*YAD_MAJOR=[0-9]+[[:space:]]*$' "${FRAGMENTS[@]}" | sed -E 's/[^0-9]//g' | sort -u)"
[ -n "$MAJORS" ] || die "no \`YAD_MAJOR=<n>\` line in the gate-sync fragments (${FRAGMENTS[*]})"
[ "$(printf '%s\n' "$MAJORS" | wc -l | tr -d ' ')" -eq 1 ] || die "the gate-sync fragments disagree about their major: $(printf '%s ' $MAJORS)"
SHIPS="$MAJORS"

# The last release — the same lookup, and the same reasons, as shape-guide-check.sh.
LAST_TAG="$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)"
[ -n "$LAST_TAG" ] || LAST_TAG="$(git tag --list 'v*' --sort=-v:refname | head -1 || true)"
if [ -z "$LAST_TAG" ]; then
  printf '   no release tag yet — the gate-sync fragments ship major %s, nothing to compare against\n' "$SHIPS"
  exit 0
fi

TAG_MAJOR="$(printf '%s' "$LAST_TAG" | sed -nE 's/^v([0-9]+)\..*/\1/p')"
[ -n "$TAG_MAJOR" ] || die "could not read a major version from the tag '$LAST_TAG'"

# semantic-release's own answer, not a grep of ours — see scripts/release-type.mjs for how they differ.
RELEASE_TYPE="$(node "$ROOT/scripts/release-type.mjs" "$LAST_TAG")" || die "could not work out the release type from the commits since $LAST_TAG"

UPCOMING="$TAG_MAJOR"
if [ "$RELEASE_TYPE" = major ]; then
  # `vN.0.0-<pre>` is already the prerelease of a new major; anything else moves up by one.
  printf '%s' "$LAST_TAG" | grep -qE '^v[0-9]+\.0\.0-' || UPCOMING="$((TAG_MAJOR + 1))"
fi

if [ "$SHIPS" -ne "$UPCOMING" ]; then
  printf '\n   this release publishes %s.x (last tag %s, semantic-release would cut a %s release),\n' \
    "$UPCOMING" "$LAST_TAG" "$RELEASE_TYPE" >&2
  printf '   but the gate-sync fragments carry YAD_MAJOR=%s.\n\n' "$SHIPS" >&2
  printf '   Every wired Product that runs `yad update` would get a fragment that rejects its own\n' >&2
  printf '   %s.x stamp and runs yadflow@%s instead. Set YAD_MAJOR=%s in every yad-pin block of:\n' "$UPCOMING" "$SHIPS" "$UPCOMING" >&2
  printf '     %s\n' "${FRAGMENTS[@]}" >&2
  die "the gate-sync fragments ship major $SHIPS, the release publishes major $UPCOMING"
fi

printf '   the gate-sync fragments ship major %s, the major this release publishes (last tag %s)\n' "$SHIPS" "$LAST_TAG"
