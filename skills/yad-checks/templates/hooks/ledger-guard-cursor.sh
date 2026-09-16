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
#   deny    {"permission":"deny","user_message":"<reason>","agent_message":"<reason>"}   exit 0
#
# A deny exits 0 because the JSON is the authoritative answer and exit 0 is what tells Cursor to read
# it; exit 2 blocks too, but is documented as the code for "no JSON to read" and would discard the
# reason — and naming the command that owns the transition is the whole point of speaking at edit time.
#
# It takes NO arguments, deliberately. Cursor's `hooks.json` holds one command STRING and does not
# document whether it is run through a shell, so a command with a flag in it might never be split into
# program and argument — a command not found, silently, on every call.
set -uo pipefail

# `CDPATH=` is load-bearing, and the Cursor entry is what makes it so: that entry invokes the script
# by a RELATIVE path, so `${BASH_SOURCE[0]}` is relative and `cd` consults $CDPATH before the current
# directory. An exported CDPATH in a login profile — an ordinary thing to have, and inherited by the
# harness — would resolve `hooks` to some other tree entirely, and the guard would fail open on every
# write for as long as that profile lived.
#
# The loop resolves a symlinked SCRIPT, which `cd -P` does not: `-P` resolves the directory path, and
# a script reached through a link in another directory would otherwise look for its sibling beside the
# LINK and not find it. `readlink` without `-f` because `-f` is not portable to macOS.
_src="${BASH_SOURCE[0]}"
while [ -L "$_src" ]; do
  _dir="$(CDPATH= cd -P -- "$(dirname -- "$_src")" && pwd)"
  _src="$(readlink -- "$_src")"
  case "$_src" in /*) ;; *) _src="$_dir/$_src" ;; esac
done
HOOK_DIR="$(CDPATH= cd -P -- "$(dirname -- "$_src")" && pwd)"
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
raw="$("$HOOK_DIR/ledger-guard.sh" --format cursor)"
rc=$?

# THE VERDICT IS THE LAST NON-EMPTY LINE, not the whole of stdout, and it is recognised by containing
# a `"permission"` key rather than by starting with one.
#
# Both halves of that matter. `yad`'s own top-level failure handler prints to STDOUT, so a usage error
# or a crash banner can land in front of the JSON; a prefix test would then fail to recognise our own
# deny and fall through to the allow below, turning a real refusal into a permitted write with nothing
# on stderr to say so. And a containment test does not care what order the JSON's properties are in,
# so the deny answer's shape on the other side of this language boundary is not silently load-bearing.
verdict="$(printf '%s\n' "$raw" | awk 'NF { line = $0 } END { print line }')"

# `ledger-guard.sh` has its own fail-open branches that exit 0 with EMPTY stdout — no `yad` on PATH,
# an install it cannot resolve — and each one of those would otherwise reach Cursor as invalid JSON
# and block the write.
case "$verdict" in
  *'"permission"'*) echo "$verdict"; exit 0 ;;
esac

# EXIT 2 IS A DENY, even with nothing on stdout — and this branch is reached in a real, ordinary case.
# `ledger-guard.sh` resolves `yad` from the Product's own `node_modules/yadflow` BEFORE `PATH`, so a
# project pinned to a yadflow older than `--format` parses the flag, ignores it, and answers in the
# exit protocol: exit 2, empty stdout. Falling through to the generic allow below would turn a real
# refusal into a permitted write, and print "exited 2 — allowing" while doing it.
#
# The message is a FIXED literal with nothing interpolated. The reason the older `yad` printed has
# already gone to stderr, where Cursor logs it; escaping arbitrary multi-line text into JSON in bash
# is exactly the sort of thing that produces an off-schema response, and there is no need to risk it.
if [ "$rc" -eq 2 ]; then
  echo '{"permission":"deny","user_message":"yad: this edit touches CI-owned gate state.","agent_message":"This edit touches CI-owned gate state, which CI is the sole writer of. Do not edit the ledger by hand: use `yad gate open` for the transition, and commit only the artifact. The installed yadflow is older than this hook, so the full reason is in the hook log rather than here — `yad doctor` will name the version gap."}'
  exit 0
fi

if [ "$rc" -ne 0 ]; then
  echo "  • yad hook: ledger-guard.sh exited $rc — allowing (run \`yad doctor\` to check the install)" >&2
fi
echo "$ALLOW"
exit 0
