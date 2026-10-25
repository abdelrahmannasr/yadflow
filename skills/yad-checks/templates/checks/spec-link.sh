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
[ -n "${1:-}" ] || [ -n "${SDLC_BASE:-}" ] || echo "note [spec-link]: no base given — diffing against '${BASE}'."

# Fail closed if the base ref can't be resolved (shallow clone / wrong base branch / unfetched ref).
if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [spec-link]: base ref '${BASE}' not found — check the code out with full history (GitHub: actions/checkout with fetch-depth: 0; GitLab: GIT_DEPTH: \"0\"), and give a base that names a fetched branch (the first argument, or SDLC_BASE)."
  exit 1
fi
RANGE="${BASE}..HEAD"

# Conventional-Commits types exempt from the spec-link requirement (optional (scope) and breaking !).
EXEMPT='ci|chore|build|test'
# The letters are spelled out so no locale widens them; matched whole with bash `=~`.
STORY_RE='^EP-[abcdefghijklmnopqrstuvwxyz0123456789-]+-S[0123456789]+$'

# --- shared SHA exemption (byte-identical in spec-link / lineage-check / epic-open / reconcile-debt-check;
# --- the gates are deliberately standalone, so it is duplicated, not sourced) ---
# A commit already on a shared branch cannot be reworded without rewriting that branch, so one bad trailer
# would fail every later PR whose range still holds it — and a release PR to the default branch walks the
# whole release, so it fails again on every release until that commit reaches the base. `.sdlc/gate-exempt`
# names such commits, one full SHA per line, `#` comments allowed; every per-commit gate passes
# them, so a commit is waived once, in a reviewed change, instead of on every pipeline. A listed commit
# skips EVERY check of the gate, not only its trailer's — a sealed epic or a frozen thread included. SDLC_GATE_EXEMPT
# names another path in the repo. It comes from the pipeline config, which a PR may change where the PR's
# own pipeline runs; it still names a file on the BASE whose every entry must be a full SHA, so it cannot
# list the PR's own commits — and a PR that changes the pipeline could drop the gates anyway, which
# required checks and branch protection, not this script, prevent. The list is read from the BASE, never from this PR — a PR that could
# list its own commits would wave itself past every gate; an entry counts once it merges. An entry must be
# a FULL hex SHA: git reads 40 hex characters (64 in a SHA-256 repo) as a commit, but looks a short one up as a tag or branch name
# first — so a tag named like a listed short SHA would stand in for another commit, and a short SHA also
# grows ambiguous as the repo grows. An entry that is not one, or names no commit here, exempts nothing;
# both are said as notes, so a typo is visible.
GATE_EXEMPT_FILE="${SDLC_GATE_EXEMPT:-.sdlc/gate-exempt}"
exempt_shas=''
load_exempt_shas() {
  # Three dots: against the merge base, so a base that moved on is not mistaken for this PR's change.
  # Only exit 1 means "it changed"; an error (no merge base) says nothing about the file.
  _ex_rc=0
  git diff --quiet "${BASE}...HEAD" -- "$GATE_EXEMPT_FILE" 2>/dev/null || _ex_rc=$?
  if [ "$_ex_rc" -eq 1 ]; then
    echo "note [$1]: ${GATE_EXEMPT_FILE} changes in this PR — the list is read from ${BASE}, not from this PR; the new one counts once it merges."
  fi
  git cat-file -e "${BASE}:${GATE_EXEMPT_FILE}" 2>/dev/null || return 0
  _ex_list="$(git show "${BASE}:${GATE_EXEMPT_FILE}" 2>/dev/null | sed -E 's/#.*//; s/^[[:space:]]+//; s/[[:space:]]+$//')" || _ex_list=""
  while IFS= read -r _ex; do
    [ -z "$_ex" ] && continue
    case "$_ex" in
      *[!0123456789abcdef]*) echo "note [$1]: ${GATE_EXEMPT_FILE} entry '${_ex}' is not a lowercase hex SHA — it exempts nothing." ; continue ;;
    esac
    if [ "${#_ex}" -ne 40 ] && [ "${#_ex}" -ne 64 ]; then
      echo "note [$1]: ${GATE_EXEMPT_FILE} entry '${_ex}' is not a full SHA (40 characters, or 64 in a SHA-256 repo) — it exempts nothing (a short one could be taken over by a tag or branch of that name)."
      continue
    fi
    _ex_full="$(git rev-parse --verify --quiet "${_ex}^{commit}" 2>/dev/null)" || _ex_full=""
    # Only an entry git reads back as exactly itself: hex of the other hash's length (64 in a SHA-1 repo,
    # 40 in a SHA-256 one) is looked up as a tag or branch name first, so a ref of that name would stand in;
    # and an annotated tag's own SHA peels to its commit's — the list names commits, as rev-list walks them.
    if [ -z "$_ex_full" ] || [ "$_ex_full" != "$_ex" ]; then
      echo "note [$1]: ${GATE_EXEMPT_FILE} entry '${_ex}' is not the full SHA of a commit here — it exempts nothing."
      continue
    fi
    exempt_shas="${exempt_shas}${_ex_full}
"
  done <<EXEMPT_LIST
$_ex_list
EXEMPT_LIST
}
is_exempt_sha() { [ -n "$exempt_shas" ] && printf '%s' "$exempt_shas" | grep -qxF "$1"; }
load_exempt_shas spec-link

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
  task="$(git log -1 --format='%(trailers:key=Task,valueonly)' "$sha" | awk '!f && length($0) { print; f = 1 }')"
  if is_exempt_sha "$sha"; then
    echo "PASS [spec-link]: ${short} '${subject}' — SHA exemption (${GATE_EXEMPT_FILE} on ${BASE})"
    continue
  fi
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
    echo "FAIL [spec-link]: ${short} '${subject}' has no 'Task:' trailer — add one naming the task it implements, as 'Task: EP-<slug>-S<n>-T<NN>'. \`yad commit --task <id>\` writes it, and reads the id from a branch named like feat/EP-<slug>-S01-T01-<words> when no --task is given. For a commit already made, reword it (git commit --amend, or git rebase -i ${BASE}) and force-push. A ci, chore, build or test commit needs no trailer."
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
  # One story ID shape, the same as the Product-reading gates (E117 review 1): EP-<slug>-S<n>. A trailer
  # of `EP-x-S01/.-T1` names `specs/EP-x-S01/./link.md`, which exists, and walked past the others.
  if ! [[ $story =~ $STORY_RE ]]; then
    echo "FAIL [spec-link]: ${short} ${task} — '${story}' is not a story ID (expected EP-<slug>-S<n>, the slug in lowercase letters, digits and dashes)."
    rc=1
    continue
  fi
  if [ -f "specs/${story}/link.md" ]; then
    echo "PASS [spec-link]: ${short} ${task} -> specs/${story}/link.md${note}"
  else
    echo "FAIL [spec-link]: ${short} ${task} references specs/${story}/ but link.md is missing — run the yad-spec skill for ${story} in this repo (it writes specs/${story}/link.md), or fix the story id in the Task trailer."
    rc=1
  fi
done <<EOF
$commits
EOF
exit "$rc"
