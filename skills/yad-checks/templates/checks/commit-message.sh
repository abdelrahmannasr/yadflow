#!/usr/bin/env bash
# commit-message gate.
# Every non-merge commit in the range under review must follow the project commit convention
# (CONTRIBUTING.md / config.yaml build — mirrors cli/commit.mjs buildCommitMessage):
#   - subject is "<type>: <description>" where <type> is a known Conventional-Commits type,
#   - the subject does NOT end with a period,
#   - any trailers appear in the fixed order Task -> Contract-Change -> Co-Authored-By.
# Keep the type list in sync with cli/manifest.mjs COMMIT_TYPES and config.yaml build.commit_subject_style.
#
# Profiles (--profile code|product, default code; `hub` is the old name for product): the subject rule is identical on the Product and on
# code repos (both follow CONTRIBUTING). The Task trailer is NOT required here (the spec-link gate owns
# that on code repos; Product commits are not task-scoped) — this gate only checks SHAPE and ORDER.
#
# Merge/squash commits (2+ parents) are skipped: their platform-generated subjects are not authored.
set -euo pipefail

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
    echo "FAIL [product-settings]: .sdlc/product.json and .sdlc/hub.json say different things — they are one file under two names until v5. Run \`yad migrate\` in the Product to choose the copy to keep, and commit both." >&2
    return 1
  fi
  if [ -f .sdlc/product.json ]; then printf '%s' .sdlc/product.json; else printf '%s' .sdlc/hub.json; fi
}
PRODUCT_CONFIG="$(product_config)" || exit 1

PROFILE=code
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:-code}"; shift 2 ;;
    --profile=*) PROFILE="${1#*=}"; shift ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
case "$PROFILE" in code|hub|product) ;; *) echo "FAIL [commit-message]: unknown --profile '$PROFILE' (code|product, or hub, the old name for product)."; exit 1 ;; esac
# `product` is the Product's profile. `hub` is its old name, and BOTH are accepted.
#
# This script and the workflow that passes the flag are both in PRODUCT_WIRING (cli/manifest.mjs) and
# normally land together on one `yad update` — but not always: a copy the team edited is kept. So the
# order is add-before-remove: the new spelling was accepted first, the workflow templates switched to
# emit it in E123 (`yad-product-checks.yml`), and the old one is dropped after that. `hub` stays
# accepted meanwhile, for a workflow of the team's own or one they edited. The other direction — an
# edited copy of THIS script from before 4.0, which rejects `product`, beside the new workflow — fails
# every Product PR; `yad update` and `yad doctor` (`profile:`) say so.
#
# Normalised to `product` immediately, so nothing below has to know there are two spellings. That is
# load-bearing in pr-title.sh and pr-template.sh: leave `$PROFILE` as `hub` and the `= product`
# branch is skipped, taking the whole review-branch arm with it — including the guard that stops a
# plain code title carrying an artifact change past its review.
[ "$PROFILE" = hub ] && PROFILE=product


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

BASE="${ARGS[0]:-${SDLC_BASE:-$(resolve_base)}}"
[ -n "${ARGS[0]:-}" ] || [ -n "${SDLC_BASE:-}" ] || echo "note [commit-message]: no base given — diffing against '${BASE}'."

# Fail closed if the base ref can't be resolved (shallow clone / wrong base branch / unfetched ref).
if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [commit-message]: base ref '${BASE}' not found — fetch full history / check the base branch."
  exit 1
fi
RANGE="${BASE}..HEAD"

# Conventional-Commits types — keep in sync with cli/manifest.mjs COMMIT_TYPES.
TYPES='feat|fix|docs|refactor|test|perf|build|ci|chore|revert'

commits="$(git rev-list --no-merges "$RANGE")"
if [ -z "$commits" ]; then
  echo "PASS [commit-message]: no non-merge commits in ${RANGE} (profile: ${PROFILE})"
  exit 0
fi

rc=0
while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  short="$(git log -1 --format=%h "$sha")"
  subject="$(git log -1 --format=%s "$sha")"

  # 1) subject shape: "<type>(<optional scope>)<optional !>: <non-empty description>"
  #    (scope + breaking-change `!` are allowed per CONTRIBUTING.md).
  if ! printf '%s' "$subject" | grep -qE "^(${TYPES})(\([a-z0-9._-]+\))?!?: .+"; then
    echo "FAIL [commit-message]: ${short} subject '${subject}' is not '<type>(<scope>)?!?: <description>' (type one of: ${TYPES//|/, })."
    rc=1
  # 2) no trailing period on the subject
  elif printf '%s' "$subject" | grep -qE '\.$'; then
    echo "FAIL [commit-message]: ${short} subject '${subject}' must not end with a period."
    rc=1
  else
    echo "PASS [commit-message]: ${short} '${subject}'"
  fi

  # 3) trailer order Task -> Contract-Change -> Co-Authored-By (only among those present).
  #    Parse ONLY the trailing trailer block (git interpret-trailers) so a body prose line that
  #    happens to start with a trailer key is never mistaken for a trailer.
  trailers="$(git log -1 --format=%B "$sha" | git interpret-trailers --parse 2>/dev/null || true)"
  lt="$(printf '%s\n' "$trailers" | grep -niE '^Task:' | head -1 | cut -d: -f1 || true)"
  lc="$(printf '%s\n' "$trailers" | grep -niE '^Contract-Change:' | head -1 | cut -d: -f1 || true)"
  lo="$(printf '%s\n' "$trailers" | grep -niE '^Co-Authored-By:' | head -1 | cut -d: -f1 || true)"
  if { [ -n "$lt" ] && [ -n "$lc" ] && [ "$lt" -gt "$lc" ]; } \
     || { [ -n "$lt" ] && [ -n "$lo" ] && [ "$lt" -gt "$lo" ]; } \
     || { [ -n "$lc" ] && [ -n "$lo" ] && [ "$lc" -gt "$lo" ]; }; then
    echo "FAIL [commit-message]: ${short} trailers out of order — expected Task -> Contract-Change -> Co-Authored-By."
    rc=1
  fi
done <<EOF
$commits
EOF

exit "$rc"
