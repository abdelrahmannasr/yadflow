#!/usr/bin/env bash
# backfill gate (Phase 3 build plan §G). A change that touches a feature being backfilled must wait
# until that feature's backfill spec is human-approved (verified: true). Gated PER touched feature, not
# the whole repo: touching feature A is never blocked by an unverified feature B. Features that are
# forward-spec'd (their own specs/<story>/) or not yet being backfilled are not this gate's concern.
set -euo pipefail

# --- shared base resolution (byte-identical across the gates; they are standalone by design, so it
# --- is duplicated, not sourced) ---
# With no explicit base, RESOLVE the trunk instead of assuming a hardcoded `origin/main` — on a repo
# whose trunk is `develop`/`master` that guess either fails closed or, where a stale `main` still
# exists, silently diffs the WRONG range (issue #161). Mirrors the CLI's own order (cli/hubcommit.mjs,
# cli/repo.mjs): the CONFIGURED default_branch first, then the remote's published default
# (origin/HEAD), then origin/main. Each candidate must actually resolve before it is used, so a
# DANGLING origin/HEAD (trunk renamed, the old remote-tracking ref pruned) falls through to the next
# candidate instead of failing the gate on a fully-fetched repo. CI always passes the base explicitly,
# so this governs local runs only. The `|| _x=""` guards are load-bearing: under `set -e` a failing
# command substitution in an assignment aborts the script.
resolve_base() {
  # tr first: a key and its value may legally sit on separate lines, which a per-line match misses.
  _cfg="$(tr -d '\n' < "${SDLC_HUB_CONFIG:-.sdlc/hub.json}" 2>/dev/null | sed -nE 's/.*"default_branch"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p')" || _cfg=""
  _head="$(git symbolic-ref --short --quiet refs/remotes/origin/HEAD 2>/dev/null)" || _head=""
  for _c in "origin/${_cfg}" "${_head}" origin/main; do
    case "$_c" in ''|origin/) continue ;; esac
    if git rev-parse --verify --quiet "${_c}^{commit}" >/dev/null 2>&1; then printf '%s' "$_c"; return; fi
  done
  printf '%s' origin/main
}

BASE="${1:-${SDLC_BASE:-$(resolve_base)}}"
[ -n "${1:-}" ] || [ -n "${SDLC_BASE:-}" ] || echo "note [backfill]: no base given — diffing against '${BASE}'."
if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [backfill]: base ref '${BASE}' not found — fetch full history / check the base branch."
  exit 1
fi

# quotePath off so a non-ASCII feature directory still matches src/<feature>/ below.
changed="$(git -c core.quotePath=false diff --name-only "${BASE}..HEAD")"
# Feature = a directory under src/ (src/<feature>/...). Top-level src/*.js files are deliberately NOT
# gated here (they belong to no single feature); only src/<feature>/ changes are checked.
feats="$(printf '%s\n' "$changed" | sed -nE 's#^src/([^/]+)/.*#\1#p' | sort -u)"

if [ -z "$feats" ]; then
  echo "PASS [backfill]: no src/<feature> changes."
  exit 0
fi

rc=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  spec="specs/backfill/${f}/spec.md"
  [ -f "$spec" ] || { echo "note [backfill]: ${f} is not being backfilled (no ${spec}) — skipped."; continue; }
  # Read ONLY the YAML frontmatter (between the first two --- lines) so a prose line that merely
  # contains "verified: true" cannot false-pass the gate.
  fm="$(awk 'NR==1 && /^---[[:space:]]*$/ {f=1; next} f && /^---[[:space:]]*$/ {exit} f {print}' "$spec")"
  if printf '%s\n' "$fm" | grep -qiE '^verified:[[:space:]]*true[[:space:]]*$'; then
    echo "PASS [backfill]: ${f} has an approved (verified) backfill spec."
  else
    echo "FAIL [backfill]: ${f} is being backfilled but its spec is not yet human-approved (verified: true)."
    echo "  -> run yad-backfill approve for ${spec} before changing this feature."
    rc=1
  fi
done <<EOF
$feats
EOF
exit "$rc"
