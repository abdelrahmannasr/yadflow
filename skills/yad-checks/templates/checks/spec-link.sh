#!/usr/bin/env bash
# spec-link gate (Phase 3 build plan §C).
# Every NON-MAINTENANCE commit must link a real story/spec: it must carry a
# `Task: <story>-<task>` trailer whose <story> resolves to a specs/<story>/link.md.
# Maintenance commits (ci/chore/build/test) are EXEMPT — CI wiring, dependency bumps,
# and test-infra changes legitimately link no story. The exemption covers the ABSENCE of
# a link, never a BROKEN one: a maintenance commit that carries a Task trailer is still
# resolved, so `chore: x` + `Task: EP-ghost-S01-T01` fails exactly like any other commit
# claiming a story that does not exist. Checked per commit (not aggregated across the
# range), so the report names every offending commit.
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
  _cfg="$(sed -nE 's/.*"default_branch"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "${SDLC_HUB_CONFIG:-.sdlc/hub.json}" 2>/dev/null | head -1)" || _cfg=""
  _head="$(git symbolic-ref --short --quiet refs/remotes/origin/HEAD 2>/dev/null)" || _head=""
  for _c in "origin/${_cfg}" "${_head}" origin/main; do
    case "$_c" in ''|origin/) continue ;; esac
    if git rev-parse --verify --quiet "${_c}^{commit}" >/dev/null 2>&1; then printf '%s' "$_c"; return; fi
  done
  printf '%s' origin/main
}

BASE="${1:-${SDLC_BASE:-$(resolve_base)}}"
[ -n "${1:-}" ] || [ -n "${SDLC_BASE:-}" ] || echo "note [spec-link]: no base given — diffing against '${BASE}'."

# Fail closed if the base ref can't be resolved (shallow clone / wrong base branch / unfetched ref).
if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [spec-link]: base ref '${BASE}' not found — fetch full history / check the base branch."
  exit 1
fi
RANGE="${BASE}..HEAD"

# Conventional-Commits types exempt from the spec-link requirement (optional (scope) and breaking !).
EXEMPT='ci|chore|build|test'

# Portable across bash 3.2 (macOS) and 4+ — no mapfile; feed the loop via heredoc (not a pipe) so
# the failure count survives the loop body.
commits="$(git rev-list --no-merges "$RANGE")"
if [ -z "$commits" ]; then
  echo "PASS [spec-link]: no non-merge commits in ${RANGE}"
  exit 0
fi

rc=0
while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  short="$(git log -1 --format=%h "$sha")"
  subject="$(git log -1 --format=%s "$sha")"
  task="$(git log -1 --format='%(trailers:key=Task,valueonly)' "$sha" | sed '/^$/d' | head -1)"
  exempt=0
  note=''
  if printf '%s' "$subject" | grep -qE "^(${EXEMPT})(\([a-z0-9._-]+\))?!?: "; then
    exempt=1
    note=' (maintenance commit, trailer resolved anyway)'
  fi
  # The type exemption waives the REQUIREMENT for a link, not the VALIDITY of one that is claimed.
  # Exempting on the subject alone left an unlinked `chore:` and a `chore:` naming a story that does
  # not exist indistinguishable — both PASSed, so the trailer was decorative on every exempt commit.
  if [ "$exempt" = 1 ] && [ -z "$task" ]; then
    echo "PASS [spec-link]: ${short} '${subject}' — maintenance commit, no Task trailer (exempt)"
    continue
  fi
  if [ -z "$task" ]; then
    echo "FAIL [spec-link]: ${short} '${subject}' has no 'Task:' trailer"
    rc=1
    continue
  fi
  # The trailer must be a real <story>-T<NN> id. Without this guard a malformed trailer
  # (e.g. 'EP-demo-S01' with no -T<NN>) would survive the suffix-strip unchanged and PASS
  # whenever specs/<that>/link.md happens to exist.
  if ! printf '%s' "$task" | grep -qE '.+-T[0-9]+$'; then
    echo "FAIL [spec-link]: ${short} '${subject}' has a malformed Task trailer '${task}' (expected <story>-T<NN>)."
    rc=1
    continue
  fi
  story="$(printf '%s' "$task" | sed -E 's/-T[0-9]+$//')"
  if [ -f "specs/${story}/link.md" ]; then
    echo "PASS [spec-link]: ${short} ${task} -> specs/${story}/link.md${note}"
  else
    echo "FAIL [spec-link]: ${short} ${task} references specs/${story}/ but link.md is missing."
    rc=1
  fi
done <<EOF
$commits
EOF
exit "$rc"
