#!/usr/bin/env bash
# ledger-guard HARNESS HOOK — the local half of the CI gate of the same name (#171).
#
# The gate ledger is CI-owned in bridge mode: `checks/ledger-guard.sh` rejects any non-bot commit
# that changes `epics/*/.sdlc/{state,approvals,comments,hub-prs}.json` or `epics/*/reviews/*.md`.
# This hook says so at the moment an agent tries the edit, instead of twenty minutes later in a
# failed pipeline, and names the command that owns the transition (`yad gate open`).
#
# This file is only the ADAPTER. It locates `yad` and hands the tool-call payload to
# `yad hook ledger-guard`, which holds the decision — so the wiring never hard-codes an install path
# and the logic stays testable. The contract it passes through:
#
#   stdin   the harness's tool-call payload as JSON (optional)
#   exit 0  allow
#   exit 2  deny, reason on stderr
#
# Wired for Claude Code as a `PreToolUse` hook in `.claude/settings.json` (`yad check --fix` writes
# that entry). Any harness that can run a command and read those two exit codes can use it.
#
# FAIL-OPEN: if no `yad` can be found, this ALLOWS and says why on stderr. A guardrail that blocked
# every edit the moment an install went sideways would be worse than the problem. The CI gate fails
# CLOSED and is what actually protects the ledger.
set -uo pipefail

# The hub root is this script's grandparent — hooks/ledger-guard.sh — so the resolution below does
# not depend on the harness's working directory.
HOOK_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HUB_ROOT="$(dirname -- "$HOOK_DIR")"

# Resolution order, cheapest and most specific first: an explicit override, then the copy installed
# in this hub, then whatever is on PATH, then a network-free npx. `--no-install` matters — a hook
# runs on every tool call and must never pause an agent to download a package.
CMD=()
if [ -n "${YAD_BIN:-}" ]; then
  # Split deliberately: YAD_BIN is commonly an interpreter + script ("node /path/to/yad.mjs").
  read -r -a CMD <<< "$YAD_BIN"
elif [ -f "$HUB_ROOT/node_modules/yadflow/bin/yad.mjs" ] && command -v node >/dev/null 2>&1; then
  CMD=(node "$HUB_ROOT/node_modules/yadflow/bin/yad.mjs")
elif command -v yad >/dev/null 2>&1; then
  CMD=(yad)
elif command -v npx >/dev/null 2>&1; then
  CMD=(npx --no-install yadflow)
else
  echo "  • yad hook: no \`yad\` on PATH and none installed in $HUB_ROOT — allowing (install yadflow to re-arm the ledger guard)" >&2
  exit 0
fi

# Run it rather than `exec`, so the exit code can be mapped. ONLY an explicit deny (2) blocks: a
# `yad` that is present but cannot run — an `npx --no-install` with no yadflow to find, a crash, a
# broken install — must not read as a refusal. Fail-open is the whole stance of this hook; the CI
# gate is what fails closed.
"${CMD[@]}" hook ledger-guard "$@"
rc=$?
[ "$rc" -eq 2 ] && exit 2
if [ "$rc" -ne 0 ]; then
  echo "  • yad hook: \`${CMD[*]} hook ledger-guard\` exited $rc — allowing (run \`yad doctor\` to check the install)" >&2
fi
exit 0
