#!/usr/bin/env bash
# Did the file shape move since the last release, and if so is its migration guide here?
#
# Rule 7 of the change-safety rules (docs/roadmap-idea-1.md, Part 2): file-shape changes ship together
# with the migration guide. This is the half of that rule a machine can hold.
#
# The comparison is between the SCHEMA_VERSION in the working tree and the one in the last released
# tag. When it has gone up, `docs/migrations/shape-<N>.md` must exist — the page `yad migrate` sends
# people to, written by a person, before the release rather than after the complaints.
#
# Split out of release-check.sh so it can be run and tested on its own:
#   bash scripts/shape-guide-check.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

die() { printf '\nRELEASE CHECK FAILED: %s\n' "$*" >&2; exit 1; }

# The engine's current shape, read from the module that owns it rather than by grepping a number.
CURRENT="$(node -e 'import("./cli/manifest.mjs").then((m) => console.log(m.SCHEMA_VERSION))')"
# A renamed or deleted export prints the literal string "undefined", which is non-empty — so test that
# it is a NUMBER. Otherwise the script limps on and dies later at the arithmetic loop with an unbound
# variable, failing closed but naming the wrong cause.
case "$CURRENT" in
  ''|*[!0-9]*) die "could not read a numeric SCHEMA_VERSION from cli/manifest.mjs (got '${CURRENT}')" ;;
esac

# The last release, by tag. A repo with no tags yet has nothing to compare against — the first release
# defines the baseline rather than migrating from one.
LAST_TAG="$(git tag --list 'v*' --sort=-v:refname | head -1 || true)"
if [ -z "$LAST_TAG" ]; then
  printf '   no release tag yet — shape %s is the baseline, nothing to migrate from\n' "$CURRENT"
  exit 0
fi

# Read the released shape out of the tag. Before E13 there was no SCHEMA_VERSION at all; that is not a
# missing value but a real answer — everything the engine wrote then was shape 1 by rule 1.
RELEASED="$(git show "$LAST_TAG:cli/manifest.mjs" 2>/dev/null \
  | sed -n 's/^export const SCHEMA_VERSION = \([0-9][0-9]*\);.*/\1/p' | head -1 || true)"
[ -n "$RELEASED" ] && FROM="$RELEASED" || FROM=1

if [ "$CURRENT" -lt "$FROM" ]; then
  die "the file shape went DOWN — $LAST_TAG shipped shape $FROM, this tree is on $CURRENT. A release may add, never remove (rule 3)"
fi

if [ "$CURRENT" -eq "$FROM" ]; then
  printf '   file shape unchanged since %s (shape %s) — no migration guide required\n' "$LAST_TAG" "$CURRENT"
  exit 0
fi

# The shape moved. Every step between the released shape and this one needs its page, because a user
# can be sitting on any of them.
MISSING=()
for ((n = FROM + 1; n <= CURRENT; n++)); do
  [ -f "docs/migrations/shape-$n.md" ] || MISSING+=("docs/migrations/shape-$n.md")
done

if [ ${#MISSING[@]} -gt 0 ]; then
  printf '\n   the file shape moved from %s to %s since %s, and these are missing:\n' "$FROM" "$CURRENT" "$LAST_TAG" >&2
  printf '     %s\n' "${MISSING[@]}" >&2
  printf '\n   Write each one before releasing. It is what `yad migrate` sends people to, and rule 7\n' >&2
  printf '   says a file-shape change ships WITH its migration guide — not in the release after.\n' >&2
  printf '   Say what changed, what `yad migrate --apply` will do about it, and what to check after.\n' >&2
  die "missing migration guide for shape $CURRENT"
fi

printf '   file shape moved %s -> %s since %s; migration guide(s) present\n' "$FROM" "$CURRENT" "$LAST_TAG"
