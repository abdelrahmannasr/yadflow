#!/usr/bin/env bash
# ledger-guard CURSOR ADAPTER — the same guard, answered in the protocol Cursor requires (E11).
#
# Cursor's `preToolUse` is a PERMISSION hook, and its docs are explicit: for a permission hook,
# "invalid JSON or a response that doesn't match the hook's schema blocks the action". Empty stdout is
# invalid JSON. The plain `ledger-guard.sh` prints nothing when it allows — so wiring it directly
# would have blocked EVERY file write in a verified project, which is the exact opposite of this
# guard's fail-open design.
#
# This wrapper guarantees one thing: a permission answer on stdout, always, whatever happens below.
#
#   allow   {"permission":"allow"}   exit 0
#   deny    {"permission":"deny","agentMessage":"<reason>"}   exit 0
#
# A deny exits 0 because the JSON is the authoritative answer and exit 0 is what tells Cursor to read
# it; exit 2 blocks too, but is documented as the code for "no JSON to read" and would discard the
# reason — and naming the command that owns the transition is the whole point of speaking at edit time.
#
# It takes NO arguments, deliberately. Cursor's `hooks.json` holds one command STRING and does not
# document whether it is run through a shell, so a command with a flag in it might never be split into
# program and argument — a command not found, silently, on every call.
set -uo pipefail

HOOK_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ALLOW='{"permission":"allow"}'

# Every failure below this line resolves to ALLOW, because this guard fails open by design and CI is
# what fails closed. A wrapper that blocked when it could not reach `yad` would stop an agent editing
# anything at all the moment an install went sideways.
if [ ! -x "$HOOK_DIR/ledger-guard.sh" ]; then
  echo "  • yad hook: $HOOK_DIR/ledger-guard.sh is missing or not executable — allowing (run \`yad check --fix\`)" >&2
  echo "$ALLOW"
  exit 0
fi

# stdout is CAPTURED (the JSON verdict), stderr is not (it flows through to Cursor's log). stdin is
# inherited by the command substitution, so the tool-call payload still reaches the guard.
verdict="$("$HOOK_DIR/ledger-guard.sh" --format cursor)"
rc=$?

# Only a well-formed permission answer is passed through. `ledger-guard.sh` has its own fail-open
# branches that exit 0 with EMPTY stdout — no `yad` on PATH, an install it cannot resolve — and each
# one of those would otherwise reach Cursor as invalid JSON and block the write.
case "$verdict" in
  '{"permission":'*) echo "$verdict"; exit 0 ;;
esac

if [ "$rc" -ne 0 ]; then
  echo "  • yad hook: ledger-guard.sh exited $rc — allowing (run \`yad doctor\` to check the install)" >&2
fi
echo "$ALLOW"
exit 0
