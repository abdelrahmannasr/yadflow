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
# the signature proves the commit came from that account. A `.sdlc/verified-authors` file an older
# release generated is no longer read, and the gate says so when it finds one.
#
# Merge-commit signature exemption: a merge that introduces NO content of its own (its combined diff
# is empty — no conflict-resolution / evil-merge hunks) is signature-waived, because every change it
# carries already lives in its individually author+signature-checked parents. This unblocks self-hosted
# GitLab, which does not sign UI-created merge commits (the signature API returns 404). A merge that
# DOES introduce content of its own still requires a verified signature (fail-closed).
#
# Degradation is explicit, never silent:
#   - no GitHub/GitLab remote  -> signature check SKIPPED with a warning (no platform, no badge)
#   - platform API unreachable -> FAIL closed (a security gate must not pass on a broken check)
#
# GitLab note: the signature API is not readable with CI_JOB_TOKEN — provide a CI variable
# GITLAB_TOKEN (or SDLC_API_TOKEN) with read_api scope; see the pipeline fragment header.
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
[ -n "${1:-}" ] || [ -n "${SDLC_BASE:-}" ] || echo "note [verified-commits]: no base given — diffing against '${BASE}'."

# Fail closed if the base ref can't be resolved (shallow clone / wrong base branch / unfetched ref).
if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [verified-commits]: base ref '${BASE}' not found — fetch full history / check the base branch."
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
      # In CI use the documented API directly; locally fall back to the user's own glab.
      if [ -n "${CI_API_V4_URL:-}" ] && [ -n "${CI_PROJECT_ID:-}" ]; then
        body="$(curl -fsS --header "PRIVATE-TOKEN: ${GITLAB_TOKEN:-${SDLC_API_TOKEN:-}}" \
          "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/repository/commits/${sha}/signature" 2>/dev/null || true)"
      else
        body="$(glab api "projects/:id/repository/commits/${sha}/signature" 2>/dev/null || true)"
      fi
      printf '%s' "$body" | grep -qE '"verification_status"[[:space:]]*:[[:space:]]*"verified"'
      ;;
    *) return 1 ;; # unreachable (platform validated above) — keep the gate fail-closed regardless
  esac
}

# 0 when a merge commit introduced NO content of its own. The combined diff (--cc) lists only hunks
# that differ from ALL parents, so empty output means every change lives in an individually-checked
# parent — there is no conflict-resolution or evil-merge content unique to the merge commit, hence
# nothing an unverified author could smuggle in past the per-parent author+signature checks.
merge_introduces_no_content() {
  # `local` on its own line: `local out=$(...)` would mask the substitution's exit status (local
  # always returns 0). A git error (e.g. a parent tree missing in a shallow clone) must fail closed —
  # an empty stdout from a *failed* command is not evidence the merge is content-free.
  local out
  out="$(git diff-tree --cc --no-commit-id -r "$1")" || return 1
  [ -z "$out" ]
}

rc=0
while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  short="$(git log -1 --format=%h "$sha")"

  # A merge commit (2+ parents) whose content is all in its parents may go unsigned — see
  # merge_introduces_no_content. Every other commit, merges with content of their own included, needs
  # the signature: a platform merge commit is Verified, so a locally-forged merge pushed
  # direct-to-default cannot dodge the check. This matters for the push-on-default yad-update-guard,
  # which (unlike the PR-triggered gates) sees merge commits.
  is_merge=0
  [ "$(git log -1 --format=%P "$sha" | wc -w | tr -d '[:space:]')" -ge 2 ] && is_merge=1

  if [ -n "$platform" ]; then
    if signature_verified "$sha"; then
      echo "PASS [verified-commits]: ${short} signature verified by ${platform}"
    elif [ "$is_merge" = 1 ] && merge_introduces_no_content "$sha"; then
      # Content-free merge: nothing to protect. Self-hosted GitLab does not sign UI merge commits, so
      # requiring a signature here would block every routine merge. An evil merge (content of its own)
      # falls through to FAIL below.
      echo "WARN [verified-commits]: ${short} unsigned merge commit — introduces no content of its own (covered by verified parents); signature waived. (Self-hosted GitLab does not sign UI merge commits; on a platform that signs its merges an unsigned content-free merge is unusual but still harmless.)"
    else
      echo "FAIL [verified-commits]: ${short} signature missing/unverified — sign commits (GPG/SSH key registered on ${platform}), or the signature API was unreachable (GitLab: set GITLAB_TOKEN/SDLC_API_TOKEN with read_api)."
      rc=1
    fi
  fi
done <<EOF
$commits
EOF

exit "$rc"
