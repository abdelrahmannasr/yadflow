#!/usr/bin/env bash
# ledger-guard gate.
# In verified mode the gate ledger is CI-owned: only the yad gate-sync bot may change the
# machine-written gate-state files. A commit on a review PR by anyone else that modifies them is
# rejected — the human keeps the artifact, CI keeps the ledger. This makes "CI is the sole writer of
# the ledger" a mechanical guarantee instead of a convention.
#
# Protected (gate-state, machine-written):
#   epics/*/.sdlc/state.json, approvals.json, comments.json, product-prs.json, hub-prs.json
#   foundation/.sdlc/… and foundation/reviews/*.md — the same files for the Product level (E75), whose
#   ledger lives in its own top-level folder. A copy of this script from before that release does NOT
#   guard them; `yad doctor` says so on a verified Product that has a Foundation, and `yad update`
#   refreshes this file.
#
# BOTH names of the PR ledger are guarded. It was renamed `hub-prs.json` -> `product-prs.json`, and
# the engine writes both for one major so that a copy of THIS script which predates the rename still
# finds the file it knows. Guarding only one name would leave the other open to a hand-edit on a
# verified product — the exact thing this gate exists to refuse.
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
# Scope: enforced ONLY when the ledger is verified — hub.json carries BOTH a `platform` and either
# `ledger: "verified"` or, on a project that has not run `yad migrate` yet, `bridge_enabled` (or the
# legacy `bridge`) true. That is the same predicate `isVerifiedLedger` (cli/manifest.mjs) and
# `productActions` (cli/plan.mjs) apply. With a local ledger — or a platform-less Product — humans
# legitimately write the ledger themselves, so the gate is a no-op.
#
# Degradation: a base ref that cannot be resolved FAILs closed; no platform (cannot read the Verified
# badge) WARNs and waives the signature half — the same stance verified-commits takes.
set -euo pipefail

# ---- bridge gate: only CI-owned ledgers are guarded -------------------------------------------
# The predicate is BOTH a platform and the verified ledger flag, exactly as `isVerifiedLedger` (`cli/manifest.mjs`) and
# `productActions` (cli/plan.mjs) define it. Requiring the flag alone put this gate out of step with every
# other ledger reader (issue #186): a Product carrying `bridge_enabled: true` with no `platform` would
# have its human ledger commits rejected here while the CLI, reading the same file, called it
# local and kept the LOCAL write path — no CI writer and no permitted human writer, so no gate
# could advance. Reachable through a stale install (platform set, script wired, platform later
# nulled), not through `yad setup`, which derives both from one value.
#
# `tr -d '\n'` first, like every other hub.json read in these gates: a key and its value may legally
# sit on separate lines, and a per-line match would MISS the flag and silently no-op a security gate
# (the fail-open direction of issue #161).
#
# Matched at the ROOT LEVEL only. The shared `default_branch` read below is depth-blind, and that is
# survivable there — a false match yields a bogus branch name and the gate fails loudly. Here it is
# not: a nested `"bridge": true` (say under `review`) would silently ENABLE this gate on a Product whose
# `isVerifiedLedger` is false, recreating the exact no-writer deadlock #186 is about, from the other side. So
# the nesting is stripped rather than ignored: peel the outermost braces, then delete innermost
# objects/arrays until none remain, leaving only root-level pairs to match against. Not a JSON parser
# — a value containing a literal brace would confuse it — but hub.json is machine-written and the
# failure it prevents is the one that matters.
#
# Flattened ONCE into a variable and matched with here-strings, never `tr … | grep -q`: under the
# `pipefail` set above, `grep -q` exits at the first match and can SIGPIPE `tr`, which would make a
# MATCHING pipeline report failure. Reading from a here-string has no upstream process to kill.
HUB="${SDLC_HUB_CONFIG:-.sdlc/hub.json}"
HUB_FLAT="$(tr -d '\n' < "$HUB" 2>/dev/null || true)"
HUB_ROOT="${HUB_FLAT#*\{}"
HUB_ROOT="${HUB_ROOT%\}*}"
while :; do
  _stripped="$(sed -E 's/\{[^{}]*\}//g; s/\[[^][]*\]//g' <<< "$HUB_ROOT")"
  [ "$_stripped" = "$HUB_ROOT" ] && break
  HUB_ROOT="$_stripped"
done
# One line in, so `sed` emits at most one line out — no `head` needed (which would re-introduce the
# SIGPIPE-under-pipefail problem this avoids).
hub_str() { sed -nE "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/p" <<< "$HUB_ROOT"; }
hub_true() { grep -Eq "\"$1\"[[:space:]]*:[[:space:]]*true" <<< "$HUB_ROOT"; }
# Is the key present with a STRING value at all, empty included? `hub_str` cannot answer this: it
# returns nothing both for a missing key and for an empty one.
hub_has_str() { grep -Eq "\"$1\"[[:space:]]*:[[:space:]]*\"" <<< "$HUB_ROOT"; }

# READ ORDER, identical to `isVerifiedLedger` (cli/manifest.mjs) — the two must never disagree:
#   1. `ledger`, if hub.json carries it — shape 2 and later. "verified" and nothing else.
#   2. otherwise the old booleans `bridge_enabled` (canonical) or `bridge` (older still).
# A platform is required either way, for the reason in the header.
#
# Step 2 is NOT dead weight. This script is committed inside the user's repo and refreshed by
# `yad update`, which is a separate act from `yad migrate` — so an un-migrated hub.json (no `ledger`
# key at all) will be read by this version of the script, and it has to keep saying "verified".
# cli/test-checks.mjs runs a table of hub.json variants through this script AND through the JS
# reader and asserts they agree on every row.
# Written as if/else rather than `cmd; verified=$?`: under the `set -e` above, a bare failing test
# would EXIT the script instead of recording a false — and exiting mid-guard is indistinguishable
# from passing, so the gate would silently stop guarding.
# PRESENCE of the key decides which branch runs, not whether its value is non-empty. `"ledger": ""`
# is a present key with a string value: the JS reader stops there and answers "local", so this must
# too. Testing `-n` instead sent an empty value down to the old booleans and the two readers gave
# OPPOSITE answers — the guard rejecting human writes while the CLI kept the local path open, which
# is the no-writer deadlock of #186 reached from a third direction.
verified=no
if hub_has_str ledger; then
  if [ "$(hub_str ledger)" = "verified" ]; then verified=yes; fi
elif hub_true bridge_enabled || hub_true bridge; then
  verified=yes
fi

if [ ! -f "$HUB" ] || [ -z "$(hub_str platform)" ] || [ "$verified" != yes ]; then
  echo "PASS [ledger-guard]: the ledger is locally owned (ledger: local) — nothing to guard."
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
# "not seeded yet". `gate open` writes nothing in verified mode, and `checkpoint` stages Build
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
        # The Product level (E75) has ONE ledger, in `foundation/`, under the fixed id EP-foundation.
        foundation/.sdlc/state.json)
          base_slugs[${#base_slugs[@]}]="ep-foundation"
          ;;
      esac
    done < <(git -c core.quotePath=false ls-tree -r --name-only -z "${BASE}" -- epics foundation 2>/dev/null || true)
    # A product has ONE product level. When its OLD spelling (epics/EP-discovery) is already on BASE, a
    # Foundation ledger is not a new product level being created — it is a second one replacing a
    # CI-owned ledger, and on a verified Product no CI path writes one. So it counts as seeded, and a
    # human commit adding it is a mutation like any other.
    if in_list "ep-discovery" "${base_slugs[@]}"; then
      base_slugs[${#base_slugs[@]}]="ep-foundation"
    fi
    # …and the mirror: with a Foundation on BASE, a fresh epics/EP-discovery ledger is a second product
    # level too, not a new epic.
    if in_list "ep-foundation" "${base_slugs[@]}"; then
      base_slugs[${#base_slugs[@]}]="ep-discovery"
    fi
    base_slugs_loaded=1
  fi
  _f="$(fold "$1")"
  in_list "$_f" "${base_slugs[@]}"  && return 1
  in_list "$_f" "${noted_slugs[@]}" && return 0
  noted_slugs[${#noted_slugs[@]}]="$_f"
  if [ "$_f" = "ep-foundation" ]; then _where="foundation"; else _where="epics/$1"; fi
  echo "note [ledger-guard]: ${_where} has no ledger on ${BASE} — new epic, its seed is exempt (creation, not mutation)."
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
      epics/*/.sdlc/state.json|epics/*/.sdlc/approvals.json|epics/*/.sdlc/comments.json|epics/*/.sdlc/product-prs.json|epics/*/.sdlc/hub-prs.json|epics/*/reviews/*.md)
        _slug="${f#epics/}"; _slug="${_slug%%/*}"
        is_seeding "$_slug" && continue      # a new epic's seed — not a mutation of a CI-owned ledger
        touches_ledger=1
        echo "  ${sha} (author $(git show -s --format='%an' "$sha")) → $f"
        ;;
      # The Foundation's ledger (E75) — the same files, in the Product level's own folder, under the fixed
      # id EP-foundation. Matched on the path BELOW `foundation/` with a leading `/` put back, so the
      # same `*/.sdlc/<file>` test covers the ledger itself and a nested copy (the epic arms' `*` spans
      # `/` too) without also catching a section file that merely ends in `.sdlc` or `reviews`.
      foundation/*)
        case "/${f#foundation/}" in
          */.sdlc/state.json|*/.sdlc/approvals.json|*/.sdlc/comments.json|*/.sdlc/product-prs.json|*/.sdlc/hub-prs.json|*/reviews/*.md)
            is_seeding "EP-foundation" && continue
            touches_ledger=1
            echo "  ${sha} (author $(git show -s --format='%an' "$sha")) → $f"
            ;;
        esac
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
