#!/usr/bin/env bash
# verified-commits gate.
# Every commit in the range under review must carry a signature the PLATFORM marks as verified (the
# GitHub/GitLab "Verified" badge — proves the commit was signed by a key registered to the account that
# owns the author email). Unsigned commits do not reach merge — on the Product and on every connected
# repo alike.
#
# There is no author allowlist. It used to be `.sdlc/verified-authors`, generated from the Product
# roster's emails; yadflow removed the roster (E62) and keeps no list of people. Who may author a commit
# is who has write access to the repository — the platform's own answer, which never goes stale — and
# the signature proves which platform account made the commit. A `.sdlc/verified-authors` file an older
# release generated is no longer read, and the gate says so when it finds one.
#
# Merge-commit signature exemption: a merge that introduces NO content of its own is signature-waived,
# because every change it carries already lives in its individually signature-checked parents. This
# unblocks platform merge buttons that do not sign the merge commit (self-hosted GitLab: the signature
# API returns 404). Only a merge of exactly two parents can be waived; a merge of three or more parents
# (an octopus merge) always needs a verified signature. "No content of its own" is decided by redoing
# the merge: with git 2.36 or newer in a clone that is not shallow, the merge is waived when
# `git show --remerge-diff` prints nothing — the commit is exactly what git's own automatic merge of the
# two parents gives, so a clean merge of nearby lines in one file passes (#600). Parents with no merge
# base (unrelated histories) are redone against an empty tree, so a hand-picked mix shows as conflicts.
# A merge whose result differs from that redone merge — an extra change, or a conflict resolved by
# hand, even one that keeps one side — still requires a verified signature (fail-closed), and so does a
# merge git fails to redo. Only on older git, or in a shallow clone (where the merge base may be cut
# off), does the gate use the older test instead: the combined diff (`git diff-tree --cc`) must be
# empty. An error never waives a merge.
#
# Degradation is explicit, never silent:
#   - no GitHub/GitLab remote  -> signature check SKIPPED with a warning (no platform, no badge)
#   - platform API unreachable -> FAIL closed (a security gate must not pass on a broken check)
#
# GitLab note: the signature API is not readable with CI_JOB_TOKEN — provide a CI variable
# GITLAB_TOKEN (or SDLC_API_TOKEN) with read_api scope; see the pipeline fragment header.
set -euo pipefail
# Read the commits as they are: a `refs/replace/` object must not stand in for a commit or tree this gate
# judges.
export GIT_NO_REPLACE_OBJECTS=1

# --- shared Product settings file (byte-identical across the gates; they are standalone by design, so
# --- it is duplicated, not sourced) ---
# The Product's settings live under two names until v5: `.sdlc/product.json`, read first from 4.0, and
# `.sdlc/hub.json`, which an older yadflow wrote and its gates read. The environment may name the file
# instead: SDLC_PRODUCT_CONFIG, or the older SDLC_HUB_CONFIG. Two names that say different things are
# never settled by picking one — the CLI refuses the same way (YAD-STATE-008) — so the gate FAILS and
# names both. Said on stderr and returned as a failure: this runs inside `$(...)`, where an `exit` would
# only leave the subshell. `cmp -s` is byte for byte, like the CLI's own comparison.
product_config() {
  if [ -n "${SDLC_PRODUCT_CONFIG:-}" ] && [ -n "${SDLC_HUB_CONFIG:-}" ] \
    && [ "$SDLC_PRODUCT_CONFIG" != "$SDLC_HUB_CONFIG" ] && ! cmp -s "$SDLC_PRODUCT_CONFIG" "$SDLC_HUB_CONFIG"; then
    echo "FAIL [product-settings]: SDLC_PRODUCT_CONFIG (${SDLC_PRODUCT_CONFIG}) and SDLC_HUB_CONFIG (${SDLC_HUB_CONFIG}) name files that say different things. Set only SDLC_PRODUCT_CONFIG." >&2
    return 1
  fi
  if [ -n "${SDLC_PRODUCT_CONFIG:-}" ]; then printf '%s' "$SDLC_PRODUCT_CONFIG"; return 0; fi
  if [ -n "${SDLC_HUB_CONFIG:-}" ]; then printf '%s' "$SDLC_HUB_CONFIG"; return 0; fi
  if [ -f .sdlc/product.json ] && [ -f .sdlc/hub.json ] && ! cmp -s .sdlc/product.json .sdlc/hub.json; then
    echo "FAIL [product-settings]: .sdlc/product.json and .sdlc/hub.json say different things — they are one file under two names until v5. In the Product, run \`yad migrate --apply --keep product\` (or \`--keep hub\`) to choose the copy to keep, then commit both files." >&2
    return 1
  fi
  if [ -f .sdlc/product.json ]; then printf '%s' .sdlc/product.json; else printf '%s' .sdlc/hub.json; fi
}
PRODUCT_CONFIG="$(product_config)" || exit 1

# --- shared base resolution (byte-identical across the gates; they are standalone by design, so it
# --- is duplicated, not sourced) ---
# With no explicit base, RESOLVE the trunk instead of assuming a hardcoded `origin/main` — on a repo
# whose trunk is `develop`/`master` that guess either fails closed or, where a stale `main` still
# exists, silently diffs the WRONG range (issue #161). Mirrors the CLI's own order (cli/productcommit.mjs,
# cli/repo.mjs): the CONFIGURED default_branch first, then the remote's published default
# (origin/HEAD), then origin/main. Each candidate must actually resolve before it is used, so a
# DANGLING origin/HEAD (trunk renamed, the old remote-tracking ref pruned) falls through to the next
# candidate instead of failing the gate on a fully-fetched repo. CI always passes the base explicitly,
# so this governs local runs only. The `|| _x=""` guards are load-bearing: under `set -e` a failing
# command substitution in an assignment aborts the script.
resolve_base() {
  # tr first: a key and its value may legally sit on separate lines, which a per-line match misses.
  _cfg="$({ tr -d '\n' < "$PRODUCT_CONFIG"; } 2>/dev/null | sed -nE 's/.*"default_branch"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p')" || _cfg=""
  _head="$(git symbolic-ref --short --quiet refs/remotes/origin/HEAD 2>/dev/null)" || _head=""
  for _c in "origin/${_cfg}" "${_head}" origin/main; do
    case "$_c" in ''|origin/) continue ;; esac
    if git rev-parse --verify --quiet "${_c}^{commit}" >/dev/null 2>&1; then printf '%s' "$_c"; return; fi
  done
  printf '%s' origin/main
}

BASE="${1:-${SDLC_BASE:-$(resolve_base)}}"
[ -n "${1:-}" ] || [ -n "${SDLC_BASE:-}" ] || echo "note [verified-commits]: no base given — diffing against '${BASE}'."

# Fail closed if the base ref can't be resolved (shallow clone / wrong base branch / unfetched ref).
if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [verified-commits]: base ref '${BASE}' not found — check the code out with full history (GitHub: actions/checkout with fetch-depth: 0; GitLab: GIT_DEPTH: \"0\"), and give a base that names a fetched branch (the first argument, or SDLC_BASE)."
  exit 1
fi
RANGE="${BASE}..HEAD"

commits="$(git rev-list "$RANGE")"
if [ -z "$commits" ]; then
  echo "PASS [verified-commits]: no commits in ${RANGE}"
  exit 0
fi

# ---- the author allowlist is gone (E62) ------------------------------------------------------------
# Said out loud when an older one is still on disk, so nobody edits it believing it decides something.
if [ -f .sdlc/verified-authors ]; then
  echo "note [verified-commits]: .sdlc/verified-authors is no longer read — write access to the repo decides who can author; the signature is still required."
fi

# ---- platform for the signature check (override with SDLC_PLATFORM=github|gitlab|none) -----------
remote="$(git remote get-url origin 2>/dev/null || true)"
platform=""
case "$remote" in
  *github*) platform=github ;;
  *gitlab*) platform=gitlab ;;
esac
platform="${SDLC_PLATFORM:-$platform}"
case "$platform" in
  github|gitlab) ;;
  ""|none)
    platform=""
    echo "WARN [verified-commits]: no GitHub/GitLab remote — signature verification SKIPPED (the Verified badge is a platform concept)."
    ;;
  *)
    # Fail closed: an unknown override must never let signature checks silently pass.
    echo "FAIL [verified-commits]: unknown platform '${platform}' (SDLC_PLATFORM must be github|gitlab|none)."
    exit 1
    ;;
esac

# 0 when the platform marks the commit's signature verified. On GitHub a failed API call sets
# sig_api_error=1, so the FAIL can tell "not signed" from "could not ask" (#351). It is read from gh's
# exit status: on an HTTP error (a bad token, a rate limit) gh still prints the error body to stdout.
# GitLab answers an unsigned commit with a 404, which `curl -f` cannot tell from a refused token, so it
# stays one case.
sig_api_error=0
signature_verified() {
  local sha v body
  sha="$1"
  sig_api_error=0
  case "$platform" in
    github)
      if ! v="$(gh api "repos/{owner}/{repo}/commits/${sha}" --jq '.commit.verification.verified' 2>/dev/null)"; then
        sig_api_error=1
        return 1
      fi
      [ "$v" = "true" ]
      ;;
    gitlab)
      # In CI use the documented API directly; locally fall back to the user's own glab.
      if [ -n "${CI_API_V4_URL:-}" ] && [ -n "${CI_PROJECT_ID:-}" ]; then
        body="$(curl -fsS --max-time 15 --header "PRIVATE-TOKEN: ${GITLAB_TOKEN:-${SDLC_API_TOKEN:-}}" \
          "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/repository/commits/${sha}/signature" 2>/dev/null || true)"
      else
        body="$(glab api "projects/:id/repository/commits/${sha}/signature" 2>/dev/null || true)"
      fi
      printf '%s' "$body" | grep -qE '"verification_status"[[:space:]]*:[[:space:]]*"verified"'
      ;;
    *) return 1 ;; # unreachable (platform validated above) — keep the gate fail-closed regardless
  esac
}

# 0 when this git has `git show --remerge-diff` (git 2.36+). Parses `git --version` — "git version
# 2.39.5 (Apple Git-154)" and "git version 2.45.1.windows.1" alike. Anything it cannot read as digits is
# "no": the caller then keeps the older combined-diff check.
git_has_remerge_diff() {
  local v major minor
  v="$(git --version 2>/dev/null)" || return 1
  v="${v#git version }"
  major="${v%%.*}"
  minor="${v#*.}"
  minor="${minor%%[!0-9]*}"
  case "$major" in ''|*[!0-9]*) return 1 ;; esac
  case "$minor" in ''|*[!0-9]*) return 1 ;; esac
  [ "$major" -gt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -ge 36 ]; }
}
# The redone-merge test needs git 2.36+ and a clone that is not shallow; asked once per run. Anything
# else (old git, a shallow clone, a failed question) keeps the combined-diff test.
remerge_ok=0
if git_has_remerge_diff && [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = false ]; then
  remerge_ok=1
fi

# 0 when a merge commit introduced NO content of its own. Only a two-parent merge can be: an octopus
# merge (3+ parents) is never waived — redoing it is not supported, and a platform merge button never
# makes one.
# With remerge_ok, git redoes the merge (`--remerge-diff`) and prints how the commit differs from that
# redone merge. Empty output means the commit is exactly git's own automatic merge of its parents —
# every change lives in an individually-checked parent. Any output is final: an extra change or a
# conflict resolved by hand (even to one side, which the combined diff below misses) is content of the
# merge's own. Parents with no merge base (unrelated histories) are redone against an empty tree, so a
# result that mixes the two sides shows as conflicts. When git fails to redo the merge, the answer is
# "has content" (the signature is required), and the reason is printed.
# The flags stop config from changing the answer: no external diff or textconv driver, submodule
# changes shown even under diff.ignoreSubmodules, no diff.relative narrowing, and rename detection set
# the same on every runner (merge.renames / merge.directoryRenames).
# Without remerge_ok (git older than 2.36, or a shallow clone), fall back to the combined diff (--cc):
# it lists only hunks that differ from ALL parents, so it is empty for a merge of disjoint files but not
# for one where both sides edited nearby lines of one file.
merge_introduces_no_content() {
  # `local` on its own line: `local out=$(...)` would mask the substitution's exit status (local
  # always returns 0). A git error (e.g. a parent tree missing in a shallow clone) must fail closed —
  # an empty stdout from a *failed* command is not evidence the merge is content-free.
  local out parents errf why id
  # Plumbing, which reads no log.* config (log.showSignature would add lines to `git log` output).
  parents="$(git rev-list --parents -n1 "$1")" || return 1
  id="$(git rev-parse --short "$1")" || return 1
  # shellcheck disable=SC2086 # word-split on purpose: the commit, then its parents
  set -- $parents
  if [ "$#" -gt 3 ]; then
    echo "WARN [verified-commits]: ${id} merges $(( $# - 1 )) parents — only a merge of two parents can go unsigned, so this one needs a verified signature."
    return 1
  fi
  [ "$#" -eq 3 ] || return 1
  if [ "$remerge_ok" = 1 ]; then
    errf="$(mktemp)" || return 1
    if out="$(git -c merge.renames=true -c merge.directoryRenames=conflict show --remerge-diff --no-ext-diff --no-textconv --ignore-submodules=none --no-relative --format= "$1" 2>"$errf")"; then
      rm -f "$errf"
      [ -z "$out" ]
      return
    fi
    # git's own words, on one line and without control characters (a path in them comes from the repo).
    why="$(head -n 3 "$errf" | tr '\n' ' ' | LC_ALL=C tr -d '\000-\037\177')"
    rm -f "$errf"
    echo "WARN [verified-commits]: ${id} — git could not redo the merge to check it (git show --remerge-diff failed: ${why:-no message}), so it needs a verified signature."
    return 1
  fi
  out="$(git diff-tree --cc --no-commit-id -r "$1")" || return 1
  [ -z "$out" ]
}

rc=0
while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  short="$(git rev-parse --short "$sha")"

  # A merge commit of two parents whose content is all in its parents may go unsigned — see
  # merge_introduces_no_content. Every other commit, merges with content of their own included, needs
  # the signature: a platform merge commit is Verified, so a locally-forged merge pushed
  # direct-to-default cannot dodge the check. The PR-triggered gates see one too: a GitHub pull_request run
  # and a GitLab merged-results pipeline check a merge the platform made, unsigned and content-free (#433).
  is_merge=0
  # `rev-list --parents` prints the commit, then its parents; plumbing, so log.* config adds nothing.
  [ "$(git rev-list --parents -n1 "$sha" | wc -w | tr -d '[:space:]')" -ge 3 ] && is_merge=1

  if [ -n "$platform" ]; then
    if signature_verified "$sha"; then
      echo "PASS [verified-commits]: ${short} signature verified by ${platform}"
    elif [ "$is_merge" = 1 ] && merge_introduces_no_content "$sha"; then
      # Content-free merge: nothing to protect. Self-hosted GitLab does not sign UI merge commits, so
      # requiring a signature here would block every routine merge. An evil merge (content of its own)
      # falls through to FAIL below.
      echo "WARN [verified-commits]: ${short} unsigned merge commit — introduces no content of its own (covered by verified parents); signature waived. (Self-hosted GitLab does not sign UI merge commits; on a platform that signs its merges an unsigned content-free merge is unusual but still harmless.)"
    else
      if [ "$sig_api_error" = 1 ]; then
        echo "FAIL [verified-commits]: ${short} — the job could not ask GitHub for the commit's signature (gh api failed). The job needs GH_TOKEN set to the workflow's github.token, as the yad workflows set it; then run it again. On your own machine: install gh and run gh auth login."
      else
        resign="sign commits with a GPG or SSH key added to your ${platform} account (git config commit.gpgsign true; for an SSH key also gpg.format ssh and user.signingkey). On a pull request branch, re-sign the commits already made: git rebase --exec 'git commit --amend --no-edit -S' ${BASE}, and force-push. On the default branch, do not force-push: revert the commit, then land the change again through a pull request of signed commits."
        if [ "$platform" = gitlab ]; then
          echo "FAIL [verified-commits]: ${short} signature missing/unverified — ${resign} If the commits are signed, the job could not read GitLab's signature API: set a GITLAB_TOKEN (or SDLC_API_TOKEN) CI/CD variable with the read_api scope."
        else
          echo "FAIL [verified-commits]: ${short} signature missing/unverified — ${resign}"
        fi
      fi
      rc=1
    fi
  fi
done <<EOF
$commits
EOF

exit "$rc"
