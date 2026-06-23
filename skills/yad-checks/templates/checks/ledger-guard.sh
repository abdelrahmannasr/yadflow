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
#
# A "bot commit" must be BOTH authored by the gate bot (name/email contains yad-gate-sync) AND
# platform-VERIFIED — author/committer text alone is user-controlled and spoofable, so the platform
# Verified signature (a key the contributor cannot forge under the bot identity) is what actually
# distinguishes CI-generated commits. A spoofed-author commit that is not Verified is treated as a
# human edit and rejected.
#
# Scope: enforced ONLY when the bridge is enabled (a platform + gate-sync CI). Without the bridge
# (file-only / non-bridge) humans legitimately write the ledger locally, so the gate is a no-op.
#
# Degradation: a base ref that cannot be resolved FAILs closed; no platform (cannot read the Verified
# badge) WARNs and waives the signature half — the same stance verified-commits takes.
set -euo pipefail

# ---- bridge gate: only CI-owned ledgers are guarded -------------------------------------------
HUB="${SDLC_HUB_CONFIG:-.sdlc/hub.json}"
if [ ! -f "$HUB" ] || ! grep -Eq '"(bridge_enabled|bridge)"[[:space:]]*:[[:space:]]*true' "$HUB"; then
  echo "PASS [ledger-guard]: bridge not enabled — the ledger is locally owned, nothing to guard."
  exit 0
fi

BASE="${1:-${SDLC_BASE:-origin/main}}"
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

violations=0
for sha in $commits; do
  touches_ledger=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      epics/*/.sdlc/contract-lock.json) ;; # artifact-side — allowed
      epics/*/.sdlc/state.json|epics/*/.sdlc/approvals.json|epics/*/.sdlc/comments.json|epics/*/.sdlc/hub-prs.json|epics/*/reviews/*.md)
        touches_ledger=1
        echo "  ${sha} (author $(git show -s --format='%an' "$sha")) → $f"
        ;;
    esac
  done < <(git diff-tree --no-commit-id --name-only -r "$sha")
  if [ "$touches_ledger" = 1 ] && ! trusted_bot "$sha"; then
    violations=$((violations + 1))
  fi
done

if [ "$violations" -gt 0 ]; then
  echo "FAIL [ledger-guard]: ${violations} commit(s) change CI-owned gate files without a verified gate-bot signature. The ledger is CI-owned — let CI sync the gate; do not commit .sdlc/*.json or reviews/*.md yourself."
  exit 1
fi
echo "PASS [ledger-guard]: every CI-owned gate change in ${RANGE} is a verified gate-bot commit."
exit 0
