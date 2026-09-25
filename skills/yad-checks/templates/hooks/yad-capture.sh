#!/usr/bin/env bash
# yad-capture HARNESS HOOK — background capture of Shape artifacts (E43).
#
# Runs AFTER an agent edits a file, and snapshots every changed artifact of the Product onto the
# person's private `yad/wip/<name>/<epic>` branches — built with git plumbing, so the checkout, the
# index and the current branch are never touched. The push runs in the background, at most once
# every few minutes. The decision lives in `yad capture --hook`; this file only locates `yad`.
#
# Wired by `yad check --fix`, in BOTH ledger modes:
#   Claude Code  a `PostToolUse` hook in `.claude/settings.json`
#   Cursor       an `afterFileEdit` hook in `.cursor/hooks.json`
# Any other harness: run this script (or `yad capture --hook`) after a file write.
#
# The contract: it ALWAYS exits 0 and prints NOTHING to stdout — a capture must never block, slow or
# confuse an agent. A problem is one line on stderr. `YAD_CAPTURE=0`, or `"capture": false` in the
# Product config, turns it off.
set -uo pipefail
# Drain the payload the harness sends on stdin, so it never sees a broken pipe — but never wait on it: not
# at all from a terminal (someone ran this by hand), and at most a second on a pipe that never closes.
if [ ! -t 0 ]; then
  while IFS= read -r -t 1 _ 2>/dev/null; do :; done
fi
_src="${BASH_SOURCE[0]}"
while [ -L "$_src" ]; do
  _dir="$(CDPATH= cd -P -- "$(dirname -- "$_src")" && pwd)"
  _src="$(readlink -- "$_src")"
  case "$_src" in /*) ;; *) _src="$_dir/$_src" ;; esac
done
HOOK_DIR="$(CDPATH= cd -P -- "$(dirname -- "$_src")" && pwd)"
HUB_ROOT="$(dirname -- "$HOOK_DIR")"
[ "${YAD_CAPTURE:-}" = "0" ] && exit 0
CMD=()
_yad_bin="${YAD_BIN:-}"
if [ -n "${_yad_bin//[[:space:]]/}" ]; then
  read -r -a CMD <<< "$_yad_bin"
elif [ -f "$HUB_ROOT/node_modules/yadflow/bin/yad.mjs" ] && command -v node >/dev/null 2>&1; then
  CMD=(node "$HUB_ROOT/node_modules/yadflow/bin/yad.mjs")
elif command -v yad >/dev/null 2>&1; then
  CMD=(yad)
elif command -v npx >/dev/null 2>&1; then
  CMD=(npx --no-install yadflow)
else
  echo "  • yad capture: no \`yad\` on PATH and none installed in $HUB_ROOT — nothing captured" >&2
  exit 0
fi
[ "${#CMD[@]}" -eq 0 ] && exit 0
"${CMD[@]}" capture --hook --dir "$HUB_ROOT" </dev/null >/dev/null
exit 0
