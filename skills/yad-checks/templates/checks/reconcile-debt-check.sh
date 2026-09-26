#!/usr/bin/env bash
# reconcile-debt gate (Phase 6 — hotfix debt). A hotfix may ship code BEFORE its Shape gates approve
# (ship-first), but it opens a reconcile-debt.json entry: the Shape artifacts do not yet describe what
# is in production. That debt must be PAID (artifacts updated + a regression test added) before the NEXT
# normal change on the same feature thread can ship. This gate FAILs a non-maintenance commit whose
# owning epic is on a thread carrying an OPEN debt that this epic does not itself own.
#
# Thread-scoped (only the affected thread is frozen, never the whole repo). Reads the PRODUCT repo via
# specs/<story>/link.md `product-repo`; degrades to PASS-with-note when it is not reachable. Per commit;
# ci/chore/build/test exempt. Fails CLOSED on an unresolvable base.
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
[ -n "${1:-}" ] || [ -n "${SDLC_BASE:-}" ] || echo "note [reconcile-debt]: no base given — diffing against '${BASE}'."

if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [reconcile-debt]: base ref '${BASE}' not found — fetch full history / check the base branch."
  exit 1
fi
RANGE="${BASE}..HEAD"
EXEMPT='ci|chore|build|test'

# --- shared link.md resolution (byte-identical in contract-check / lineage-check / epic-open /
# --- reconcile-debt-check; the gates are deliberately standalone, so it is duplicated, not sourced) ---
# Read one frontmatter value from the FIRST --- … --- block only. awk bounds to the first block (stops
# at the first closing fence), so a body `---` or an absent key can never leak a body line. Plain
# scalars only; trailing spaces/CR are stripped so they never become part of a path.
fm_val() { awk -v k="$1" 'NR==1 && /^---$/ {f=1; next} f && /^---$/ {exit} f && index($0, k":")==1 {sub("^" k ":[ \t]*", ""); print; exit}' "$2" 2>/dev/null | tr -d '\r' | sed -E 's/[[:space:]]+$//'; }

# Same, for a link.md field. yad-spec writes link.md WITH frontmatter, but code repos still carry
# pre-frontmatter ones that contract-check used to read with a whole-file scan — so fall back to that
# rather than silently reading an empty value and skipping the check it guards. Deliberately separate
# from fm_val: Product artifacts (epic.md, stories/*.md) stay bounded to their first block.
link_val() {
  _v="$(fm_val "$1" "$2")"
  [ -n "$_v" ] || _v="$(sed -nE "s/^$1:[[:space:]]*(.*)\$/\1/p" "$2" 2>/dev/null | head -1 | tr -d '\r' | sed -E 's/[[:space:]]+$//')"
  printf '%s' "$_v"
}

# E117. WHERE the Product is read from must not be something the PR under check chose. link.md is a file
# the PR's own author writes, so two things are read around it:
#  - `product-repo` comes from link.md AS IT STANDS ON THE BASE when the base has a value. Otherwise a PR
#    could point it at a path that does not exist — "not reachable", a deferral, a PASS — or at a folder
#    of its own. A changed value is printed and counts once it merges. A link.md new in this PR (the
#    first one for a story), or a base one with no value, has only this PR's value to read. Only
#    `product-repo` comes from the base: the other fields (`contract-lock`, `epic`) are read as the PR
#    leaves them — a re-spec PR updates the pin, and must.
#  - a Product folder this repo TRACKS is read as it stands on the base, never as the PR leaves it: its
#    `epics/` is copied out of the base commit with `git archive`. That is how a monorepo keeps working
#    (the Product and the code in one git repo). A tracked folder with no `epics/` on the base is files
#    this PR adds, and is refused; so is a path that runs through a tracked symlink, submodule or file,
#    where what is behind it is the PR's to choose. "Inside the code repo" is NOT the test: CI can only
#    check a second repo out INSIDE the workspace, and an untracked checkout there is not the PR's.
# Sets product_rel, prod (the folder to read), prod_note and prod_fail (text; the caller prints them).
_yad_tmp=""
yad_tmp() { [ -n "$_yad_tmp" ] || { _yad_tmp="$(mktemp -d)"; trap 'rm -rf "$_yad_tmp"' EXIT; }; }
product_for() {
  _link="specs/$1/link.md"
  prod=""; prod_note=""; prod_fail=""
  product_rel="$(link_val product-repo "$_link")"
  if git cat-file -e "${BASE}:${_link}" 2>/dev/null; then
    yad_tmp
    git show "${BASE}:${_link}" > "$_yad_tmp/base-link.md" 2>/dev/null || : > "$_yad_tmp/base-link.md"
    _base_rel="$(link_val product-repo "$_yad_tmp/base-link.md")"
    if [ -n "$_base_rel" ] && [ "$_base_rel" != "$product_rel" ]; then
      prod_note="${_link} changes product-repo from '${_base_rel}' to '${product_rel}' — the Product is read from the base value; the new one counts once this merges."
      product_rel="$_base_rel"
    fi
  fi
  prod="$(resolve_product "$product_rel" "$1")"
  [ -n "$prod" ] || return 0
  _t="$(product_tracked "$prod")"
  case "$_t" in
    entry*)
      prod_fail="product-repo reaches the Product through '${_t#*:}', a symlink, submodule or file this repo tracks — what is behind it is this PR's to choose. Point product-repo at the Product itself." ;;
    tree*)
      _r="${_t#*:}"; _e="${_r:+$_r/}epics"
      if ! git cat-file -e "${BASE}:${_e}" 2>/dev/null; then
        prod_fail="product-repo resolves to '${_r:-.}', a folder this repo tracks, and ${BASE} has no '${_e}' — the Product there would be files this PR adds."
        return 0
      fi
      yad_tmp
      _d="$(mktemp -d "$_yad_tmp/product.XXXXXX")"
      if ! git archive --format=tar "$BASE" -- "$_e" 2>/dev/null | tar -x -C "$_d" 2>/dev/null; then
        prod_fail="product-repo resolves to '${_r:-.}', a folder this repo tracks, and '${_e}' could not be read from ${BASE}."
        return 0
      fi
      prod="${_d}${_r:+/$_r}"
      prod_note="${prod_note:+$prod_note
}the Product at '${_r:-.}' is tracked by this repo, so it is read as it stands on ${BASE}, not as this PR leaves it." ;;
  esac
  return 0
}

# Is the path $1 — as the shell would walk it, `..` and links included — something this repo tracks?
# Prints `entry:<path>` when a part of the way is a tracked entry itself (a symlink, a submodule, a
# file), `tree:<path>` when it ends in a folder with tracked files at or under it, and nothing when
# it is the repo's to neither. <path> is from the repo root, as the disk spells it (`pwd -P`). The case
# is folded where git folds it (core.ignorecase — a Mac checkout), and in ASCII only.
product_tracked() (
  _top="$(git rev-parse --show-toplevel 2>/dev/null)" && _top="$(cd -P "$_top" 2>/dev/null && pwd -P)" || exit 0
  _ps='literal'; [ "$(git config --bool core.ignorecase 2>/dev/null)" = true ] && _ps='literal,icase'
  _in() { case "$1/" in "$_top"/*) _r="${1#"$_top"}"; _r="${_r#/}"; return 0 ;; esac; return 1; }
  _hit() { git -C "$_top" ls-files -z -- ":(${_ps})$1" 2>/dev/null | tr '\0' '\n'; }
  case "$1" in /*) cd / ;; esac
  _rest="$1"
  while [ -n "$_rest" ]; do
    _c="${_rest%%/*}"
    case "$_rest" in */*) _rest="${_rest#*/}" ;; *) _rest="" ;; esac
    case "$_c" in ''|.) continue ;; esac
    if [ "$_c" != .. ] && _in "$(pwd -P)/$_c" && [ -n "$_r" ] &&
       _hit "$_r" | awk -v p="$_r" -v i="$_ps" '{ a = $0; b = p; if (i ~ /icase/) { a = tolower(a); b = tolower(b) } } a == b { f = 1 } END { exit !f }'; then
      printf 'entry:%s' "$_r"; exit 0
    fi
    cd -P "$_c" 2>/dev/null || exit 0
  done
  _in "$(pwd -P)" || exit 0
  if [ -n "$(_hit "${_r:-.}" | head -1)" ]; then printf 'tree:%s' "$_r"; fi
  exit 0
)

# Resolve link.md's `product-repo` to a path in THIS checkout. An ABSOLUTE value is used as-is. A
# RELATIVE value is written relative to the link.md's own directory (specs/<story>/) — the canonical
# form — but contract-check historically read it from the repo root, so a link.md authored against that
# reading still resolves: prefer the canonical join, fall back to the root-relative one when only it
# exists. All four gates share this verbatim, so a value one gate can reach is reachable from every
# gate (issue #149). An unexpanded ~ or $VAR is returned untouched, so it fails the reachability test
# loudly instead of being joined into a nonsense path.
resolve_product() {
  case "$1" in
    '') return ;;
    /*|'~'*|'$'*) printf '%s' "$1" ;;
    *) if [ -d "specs/$2/$1" ] || [ ! -d "$1" ]; then printf 'specs/%s/%s' "$2" "$1"; else printf '%s' "$1"; fi ;;
  esac
}

# Thread ROOT of an epic: walk `parent:` to the genesis (no parent). COMPUTED — never trusts the
# denormalized `thread:` cache, so a missing/wrong cache cannot bypass the freeze. Cycle-safe.
thread_root() {
  prod="$1"; cur="$2"; seen=" "
  while : ; do
    case "$seen" in *" $cur "*) break ;; esac   # cycle guard -> stop at the last seen id
    seen="$seen$cur "
    em="${prod}/epics/${cur}/epic.md"
    [ -f "$em" ] || break
    p="$(fm_val parent "$em")"
    [ -z "$p" ] && { printf '%s' "$cur"; return; }   # genesis reached
    cur="$p"
  done
  printf '%s' "$cur"
}

# Print "epicId" for any epic that (a) belongs to the target thread — by COMPUTED membership, not the
# debt's `thread` field — (b) is not the current epic, and (c) has an OPEN entry in its reconcile-debt
# ledger. Because each ledger lives under exactly one epic (one thread), "this epic is on the thread AND
# its ledger has an open status" is the correct, per-object-safe test.
open_debt_on_thread() {
  prod="$1"; thread="$2"; self="$3"
  for dj in "${prod}"/epics/*/.sdlc/reconcile-debt.json; do
    [ -e "$dj" ] || continue
    owner_epic="$(basename "$(dirname "$(dirname "$dj")")")"   # the epic that OWNS this ledger
    [ "$owner_epic" = "$self" ] && continue
    [ "$(thread_root "$prod" "$owner_epic")" = "$thread" ] || continue   # computed thread membership
    grep -q "\"status\"[[:space:]]*:[[:space:]]*\"open\"" "$dj" 2>/dev/null || continue
    printf '%s\n' "$owner_epic"
  done
}

commits="$(git rev-list --no-merges "$RANGE")"
if [ -z "$commits" ]; then
  echo "PASS [reconcile-debt]: no non-merge commits in ${RANGE}"
  exit 0
fi

rc=0
seen_keys=""
while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  short="$(git log -1 --format=%h "$sha")"
  subject="$(git log -1 --format=%s "$sha")"
  task="$(git log -1 --format='%(trailers:key=Task,valueonly)' "$sha" | sed '/^$/d' | head -1)"
  # The type exemption waives the REQUIREMENT for an owning epic, not the VALIDITY of one that is
  # claimed — same rule spec-link applies. Exempting on the subject alone would let `chore(x): …` plus
  # a Task trailer ship a change onto a thread that is frozen for open hotfix debt.
  if printf '%s' "$subject" | grep -qE "^(${EXEMPT})(\([a-z0-9._-]+\))?!?: " && [ -z "$task" ]; then
    continue
  fi
  printf '%s' "$task" | grep -qE '.+-T[0-9]+$' || continue
  story="$(printf '%s' "$task" | sed -E 's/-T[0-9]+$//')"
  link="specs/${story}/link.md"
  [ -f "$link" ] || continue
  epic="$(link_val epic "$link")"
  product_for "$story"
  if [ -n "$prod_note" ]; then printf '%s\n' "$prod_note" | sed "s/^/note [reconcile-debt]: ${short} /"; fi
  if [ -n "$prod_fail" ]; then
    echo "FAIL [reconcile-debt]: ${short} ${task} — ${prod_fail}"
    rc=1
    continue
  fi
  ep_dir="${prod}/epics/${epic}"
  if [ -z "$product_rel" ] || [ ! -d "$ep_dir" ]; then
    echo "PASS [reconcile-debt]: ${short} ${task} -> ${epic} (product repo not reachable — debt check deferred)."
    continue
  fi
  thread="$(thread_root "$prod" "$epic")"
  # De-dup by (thread, epic) — NOT thread alone. open_debt_on_thread excludes the CURRENT epic, so the
  # blocker set depends on both; caching by thread would make later commits on a different epic in the
  # same thread inherit the first epic's result (order-dependent, can miss a real block).
  key="${thread}:${epic}"
  case " $seen_keys " in *" $key "*) continue ;; esac
  seen_keys="$seen_keys $key"
  blockers="$(open_debt_on_thread "$prod" "$thread" "$epic")"
  if [ -n "$blockers" ]; then
    echo "FAIL [reconcile-debt]: thread ${thread} carries OPEN hotfix debt:"
    printf '%s\n' "$blockers" | sed 's/^/    /'
    echo "  -> Pay it first: update the Shape artifacts + add the regression test, then mark the"
    echo "     reconcile-debt.json entry status: paid. The thread is frozen for new changes until then."
    rc=1
    continue
  fi
  echo "PASS [reconcile-debt]: thread ${thread} has no open hotfix debt."
done <<EOF
$commits
EOF
exit "$rc"
