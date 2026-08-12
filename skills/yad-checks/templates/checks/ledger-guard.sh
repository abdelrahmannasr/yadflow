#!/usr/bin/env bash
# ledger-guard gate.
# In BRIDGE mode the gate ledger is CI-owned: only the yad gate-sync bot may change the
# machine-written gate-state files. A commit on a review PR by anyone else that modifies them is
# rejected — the human keeps the artifact, CI keeps the ledger. This makes "CI is the sole writer of
# the ledger" a mechanical guarantee instead of a convention.
#
# Protected (gate-state, machine-written):
#   epics/*/.sdlc/state.json, approvals.json, comments.json, hub-prs.json
#   epics/*/reviews/*.md
# NOT protected:
#   epics/*/.sdlc/contract-lock.json — artifact-side: the architect locks the contract surface in
#   `gate open`, so a human legitimately commits it alongside the architecture artifact.
#   A brand-new epic's ledger — CREATION is not mutation (#162). No CI path can seed one, so the
#   seed rides the first review PR/MR; see the carve-out below. Mutation stays bot-only.
#
# A "bot commit" must be BOTH authored by the gate bot (name/email contains yad-gate-sync) AND
# platform-VERIFIED — author/committer text alone is user-controlled and spoofable, so the platform
# Verified signature (a key the contributor cannot forge under the bot identity) is what actually
# distinguishes CI-generated commits. A spoofed-author commit that is not Verified is treated as a
# human edit and rejected.
#
# Scope: enforced ONLY when the bridge is enabled — hub.json carries BOTH a `platform` and
# `bridge_enabled` (or the legacy `bridge`) true, the same predicate `isBridge` (cli/gate.mjs) and
# `hubActions` (cli/plan.mjs) apply. Without the bridge (file-only / non-bridge, or a platform-less
# hub) humans legitimately write the ledger locally, so the gate is a no-op.
#
# Degradation: a base ref that cannot be resolved FAILs closed; no platform (cannot read the Verified
# badge) WARNs and waives the signature half — the same stance verified-commits takes.
set -euo pipefail

# ---- bridge gate: only CI-owned ledgers are guarded -------------------------------------------
# The predicate is BOTH a platform and the bridge flag, exactly as `isBridge` (cli/gate.mjs) and
# `hubActions` (cli/plan.mjs) define it. Requiring the flag alone put this gate out of step with every
# other bridge detector (issue #186): a hub carrying `bridge_enabled: true` with no `platform` would
# have its human ledger commits rejected here while the CLI, reading the same file, called it
# file-only and kept the LOCAL write path — no CI writer and no permitted human writer, so no gate
# could advance. Reachable through a stale install (platform set, script wired, platform later
# nulled), not through `yad setup`, which derives both from one value.
#
# `tr -d '\n'` first, like every other hub.json read in these gates: a key and its value may legally
# sit on separate lines, and a per-line match would MISS the flag and silently no-op a security gate
# (the fail-open direction of issue #161). Still depth-blind after flattening — a nested `"bridge":
# true` matches — which is the same limitation the shared `default_branch` read carries below, and not
# worth a JSON parser in bash.
#
# Flattened ONCE into a variable and matched with here-strings, never `tr … | grep -q`: under the
# `pipefail` set above, `grep -q` exits at the first match and can SIGPIPE `tr`, which would make a
# MATCHING pipeline report failure. Reading from a here-string has no upstream process to kill.
HUB="${SDLC_HUB_CONFIG:-.sdlc/hub.json}"
HUB_FLAT="$(tr -d '\n' < "$HUB" 2>/dev/null || true)"
# One line in, so `sed` emits at most one line out — no `head` needed (which would re-introduce the
# SIGPIPE-under-pipefail problem this avoids).
hub_str() { sed -nE "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/p" <<< "$HUB_FLAT"; }
hub_true() { grep -Eq "\"$1\"[[:space:]]*:[[:space:]]*true" <<< "$HUB_FLAT"; }

if [ ! -f "$HUB" ] || [ -z "$(hub_str platform)" ] || { ! hub_true bridge_enabled && ! hub_true bridge; }; then
  echo "PASS [ledger-guard]: bridge not enabled — the ledger is locally owned, nothing to guard."
  exit 0
fi

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
[ -n "${1:-}" ] || [ -n "${SDLC_BASE:-}" ] || echo "note [ledger-guard]: no base given — diffing against '${BASE}'."
if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [ledger-guard]: base ref '${BASE}' not found — fetch full history / check the base branch."
  exit 1
fi
RANGE="${BASE}..HEAD"

commits="$(git rev-list "$RANGE")"
if [ -z "$commits" ]; then
  echo "PASS [ledger-guard]: no commits in ${RANGE}"
  exit 0
fi

# ---- platform for the signature check (mirrors verified-commits) ------------------------------
remote="$(git remote get-url origin 2>/dev/null || true)"
platform=""
case "$remote" in
  *github*) platform=github ;;
  *gitlab*) platform=gitlab ;;
esac
platform="${SDLC_PLATFORM:-$platform}"
case "$platform" in
  github|gitlab) ;;
  ""|none) platform=""; echo "WARN [ledger-guard]: no GitHub/GitLab remote — bot signature NOT verified (the Verified badge is a platform concept)." ;;
  *) echo "FAIL [ledger-guard]: unknown platform '${platform}' (SDLC_PLATFORM must be github|gitlab|none)."; exit 1 ;;
esac

# 0 when the platform marks the commit's signature verified.
signature_verified() {
  local sha v body
  sha="$1"
  case "$platform" in
    github)
      v="$(gh api "repos/{owner}/{repo}/commits/${sha}" --jq '.commit.verification.verified' 2>/dev/null || echo api-error)"
      [ "$v" = "true" ]
      ;;
    gitlab)
      if [ -n "${CI_API_V4_URL:-}" ] && [ -n "${CI_PROJECT_ID:-}" ]; then
        body="$(curl -fsS --header "PRIVATE-TOKEN: ${GITLAB_TOKEN:-${SDLC_API_TOKEN:-}}" \
          "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/repository/commits/${sha}/signature" 2>/dev/null || true)"
      else
        body="$(glab api "projects/:id/repository/commits/${sha}/signature" 2>/dev/null || true)"
      fi
      printf '%s' "$body" | grep -qE '"verification_status"[[:space:]]*:[[:space:]]*"verified"'
      ;;
    *) return 1 ;;
  esac
}

# A trusted bot commit = bot-attributed AND (platform-Verified, or no platform to check against).
trusted_bot() {
  case "$(git show -s --format='%an|%ae' "$1")" in
    *yad-gate-sync*) ;;
    *) return 1 ;;
  esac
  [ -z "$platform" ] && return 0          # degraded: cannot read the Verified badge — waive (warned above)
  signature_verified "$1"
}

# ---- seeding carve-out: creation is not mutation (#162) ---------------------------------------
# A brand-new epic's ledger has no CI author. `gate ci` only ADVANCES an existing chain — it bails on
# a missing state.json ("the review branch is cut from the default branch, so it should carry it") and
# writes only at merge, on the default branch — and the engine itself reads a missing state.json as
# "not seeded yet". `gate open` writes nothing in bridge mode, and `checkpoint` stages back-half
# ledgers only. So the seed the authoring skills write (yad-epic / yad-change / yad-analysis /
# yad-discovery / yad-stub) can reach the trunk ONLY through the first review PR/MR — the one place
# this gate runs. Guarding it there makes the documented flow unshippable on a protected trunk, so an
# epic whose ledger is absent from the BASE ref is exempt: that ledger is human-authored by
# construction and the reviewer sees the whole of it in the diff. The moment its state.json is on the
# base ref the guard is absolute again.
#
# Anchored on state.json — the ledger root, the same "is this epic seeded?" question the engine asks —
# NOT on the individual file: adding hub-prs.json to an epic that IS on the base ref still FAILs.
# Anchored on the BASE ref, not the parent commit, so delete-then-re-add cannot reset the exemption
# (the deletion is itself a guarded change).
#
# The slug match is CASE-FOLDED on purpose. Git paths are byte-exact, but macOS/Windows checkouts are
# not: seeding `epics/ep-x/.sdlc/state.json` beside an on-base `epics/EP-X/` would probe as a brand-new
# epic, pass, and then land ON TOP of the real ledger in every case-insensitive clone — a mutation
# laundered as a creation. So the base's seeded slugs are read once (one ls-tree, not one probe per
# path) and compared folded.
#
# Slugs are held in ARRAYS read from NUL-delimited git output, never in a space- or newline-delimited
# string: git permits a newline inside a path, and a `EP-<newline>x` slug split across two records
# would drop the real epic out of the on-base list and let a mutation through as a "creation". Both
# arrays carry one empty sentinel element so `"${a[@]}"` is safe under `set -u` on bash 3.2 (macOS),
# which has no associative arrays; a slug is never empty, so the sentinel can never match.
base_slugs=("")                     # every epic with a ledger on BASE, lowercased
base_slugs_loaded=0
noted_slugs=("")                    # slugs already announced, so the note prints once each
fold() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
in_list() {                         # $1 = needle, $2… = haystack
  _needle="$1"; shift
  for _item in "$@"; do [ "$_item" = "$_needle" ] && return 0; done
  return 1
}
is_seeding() {                      # $1 = epic slug; 0 when that epic has no ledger on BASE
  if [ "$base_slugs_loaded" = 0 ]; then
    while IFS= read -r -d '' _p; do
      case "$_p" in
        epics/*/.sdlc/state.json)
          _s="${_p#epics/}"; _s="${_s%%/*}"
          base_slugs[${#base_slugs[@]}]="$(fold "$_s")"
          ;;
      esac
    done < <(git -c core.quotePath=false ls-tree -r --name-only -z "${BASE}" -- epics 2>/dev/null || true)
    base_slugs_loaded=1
  fi
  _f="$(fold "$1")"
  in_list "$_f" "${base_slugs[@]}"  && return 1
  in_list "$_f" "${noted_slugs[@]}" && return 0
  noted_slugs[${#noted_slugs[@]}]="$_f"
  echo "note [ledger-guard]: epics/$1 has no ledger on ${BASE} — new epic, its seed is exempt (creation, not mutation)."
  return 0
}

violations=0
for sha in $commits; do
  touches_ledger=0
  # quotePath=false + -z on both git reads: a path git chose to escape ("epics/EP-caf\303\251/…") and a
  # path holding a newline both match no arm below, so the gate would fail OPEN on exactly the paths it
  # is meant to guard. NUL is the only byte a git path cannot contain.
  while IFS= read -r -d '' f; do
    [ -n "$f" ] || continue
    case "$f" in
      epics/*/.sdlc/contract-lock.json) ;; # artifact-side — allowed
      epics/*/.sdlc/state.json|epics/*/.sdlc/approvals.json|epics/*/.sdlc/comments.json|epics/*/.sdlc/hub-prs.json|epics/*/reviews/*.md)
        _slug="${f#epics/}"; _slug="${_slug%%/*}"
        is_seeding "$_slug" && continue      # a new epic's seed — not a mutation of a CI-owned ledger
        touches_ledger=1
        echo "  ${sha} (author $(git show -s --format='%an' "$sha")) → $f"
        ;;
    esac
  done < <(git -c core.quotePath=false diff-tree --no-commit-id --name-only -r -z "$sha")
  if [ "$touches_ledger" = 1 ] && ! trusted_bot "$sha"; then
    violations=$((violations + 1))
  fi
done

if [ "$violations" -gt 0 ]; then
  echo "FAIL [ledger-guard]: ${violations} commit(s) change CI-owned gate files without a verified gate-bot signature. The ledger is CI-owned — let CI sync the gate; do not commit .sdlc/*.json or reviews/*.md yourself."
  # An epic's seed is exempt only while its ledger is off the base ref. Once the first review PR merges
  # (squashed or rebased, so the SHAs differ), those same seed commits still sitting on a sibling
  # authoring branch read as mutations — the author did nothing wrong and the remedy is a rebase, so
  # name it rather than leaving them with "do not commit the ledger yourself".
  echo "hint [ledger-guard]: if these are seed commits from an already-merged review PR, rebase this branch onto the updated ${BASE} — the seed carve-out applies only until the ledger is on the base ref."
  exit 1
fi
# Say WHICH rule passed the range: claiming "every change is a bot commit" would be false on a range
# whose only ledger change was a human seed the carve-out let through.
if [ "${#noted_slugs[@]}" -gt 1 ]; then   # >1: the sentinel element is always there
  echo "PASS [ledger-guard]: every CI-owned gate change in ${RANGE} is a verified gate-bot commit or a new epic's seed."
else
  echo "PASS [ledger-guard]: every CI-owned gate change in ${RANGE} is a verified gate-bot commit."
fi
exit 0
