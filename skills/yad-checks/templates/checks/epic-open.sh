#!/usr/bin/env bash
# epic-open gate (Phase 6 — the staleness preventer). An epic is SEALED once every one of its stories
# is `shipped`. A SEALED epic's artifacts are the final, approved description of shipped behaviour — so
# new behaviour must NOT be added to it; it belongs in a NEW threaded change-epic whose re-authored
# stories/test-cases describe the change. This gate FAILs any non-maintenance commit whose owning epic
# is sealed, forcing Shape to stay current (staleness becomes unshippable).
#
# The owning epic lives in the PRODUCT repo (via specs/<story>/link.md `product-repo`). When it is not
# reachable from CI, the seal cannot be read, so the commit PASSes with a note (degraded, fail-open here
# because lineage/spec-link still gate the link itself). Per commit; ci/chore/build/test exempt.
# Fails CLOSED on an unresolvable base.
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
[ -n "${1:-}" ] || [ -n "${SDLC_BASE:-}" ] || echo "note [epic-open]: no base given — diffing against '${BASE}'."

if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [epic-open]: base ref '${BASE}' not found — fetch full history / check the base branch."
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
#  - `product-repo` comes from the BASE. Where the Product lives is a fact about the whole repo, not
#    about one story, so: link.md as it stands on the base when that has a value; else the first
#    `specs/*/link.md` on the base that has one (a story new in this PR, or a link.md that never had a
#    value); else — the repo's first spec — this PR's value. Otherwise a PR could point it at a path
#    that does not exist — "not reachable", a deferral, a PASS — or at a folder of its own. A value
#    that differs is printed and counts once it merges. Only `product-repo` comes from the base:
#    `contract-lock` is read as the PR leaves it — a re-spec PR updates the pin, and must.
#  - a Product folder this repo TRACKS (a monorepo: the Product and the code in one git repo) is read as
#    it stands on the base, never as the PR leaves it: its `epics/` is copied out of the base commit
#    with a throwaway index (`git read-tree` + `git checkout-index`). It counts as one only when the base tracks its `.sdlc/hub.json`, which every
#    Product commits; any other tracked file under a Product path is refused, so one force-added file
#    cannot switch the gates to a partial Product. So is a path that runs through a tracked symlink,
#    submodule or file, where what is behind it is the PR's to choose. "Inside the code repo" is NOT
#    the test: CI can only check a second repo out INSIDE the workspace, and an untracked checkout
#    there is not the PR's.
# Sets product_rel, prod (the folder to read), prod_note and prod_fail (text; the caller prints them).
_yad_tmp=""
_arch_key=""
_arch_dir=""
yad_tmp() { [ -n "$_yad_tmp" ] || { _yad_tmp="$(mktemp -d)"; trap 'rm -rf "$_yad_tmp"' EXIT; }; }
# `product-repo` as link.md $1 has it on the base (empty when it is not there or names none).
base_product_rel() {
  git cat-file -e "${BASE}:$1" 2>/dev/null || return 0
  yad_tmp
  git show "${BASE}:$1" > "$_yad_tmp/base-link.md" 2>/dev/null || : > "$_yad_tmp/base-link.md"
  link_val product-repo "$_yad_tmp/base-link.md"
}
product_for() {
  _link="specs/$1/link.md"
  prod=""; prod_note=""; prod_fail=""
  yad_tmp   # here, in this shell: a $(…) below would set it, and its EXIT trap, in a subshell only
  product_rel="$(link_val product-repo "$_link")"
  _from="$_link"
  _base_rel="$(base_product_rel "$_link")"
  if [ -z "$_base_rel" ]; then
    # A sibling's value. Every link.md sits at specs/<story>/, so a relative value means the same there.
    while IFS= read -r _sib; do
      [ -n "$_sib" ] && [ "$_sib" != "$_link" ] || continue
      _base_rel="$(base_product_rel "$_sib")"
      if [ -n "$_base_rel" ]; then _from="$_sib"; break; fi
    done <<SIBLINGS
$(git ls-tree -r -z --name-only "$BASE" -- specs 2>/dev/null | tr '\0' '\n' | grep -E '^specs/[^/]+/link\.md$' || true)
SIBLINGS
  fi
  if [ -n "$_base_rel" ] && [ "$_base_rel" != "$product_rel" ]; then
    prod_note="${_link} names product-repo '${product_rel}', but ${_from} on ${BASE} says '${_base_rel}' — the Product is read from the base value; a new one counts once it merges."
    product_rel="$_base_rel"
  fi
  prod="$(resolve_product "$product_rel" "$1")"
  [ -n "$prod" ] || return 0
  _t="$(product_tracked "$prod")"
  case "$_t" in
    entry:*)
      prod_fail="product-repo reaches the Product through '${_t#*:}', a symlink, submodule or file this repo tracks — what is behind it is this PR's to choose. Point product-repo at the Product itself." ;;
    tree:*)
      _r="${_t#*:}"; _e="${_r:+$_r/}epics"
      if ! git cat-file -e "${BASE}:${_r:+$_r/}.sdlc/hub.json" 2>/dev/null; then
        prod_fail="product-repo resolves to '${_r:-.}', which holds files this repo tracks, but ${BASE} does not track '${_r:+$_r/}.sdlc/hub.json' there, so it is not a Product kept in this repo. Untrack those files (git rm -r --cached '${_r:-.}') or point product-repo at the Product."
        return 0
      fi
      if ! git cat-file -e "${BASE}:${_e}" 2>/dev/null; then
        prod_fail="product-repo resolves to '${_r:-.}', a Product this repo tracks, and ${BASE} has no '${_e}' — there is nothing on the base to read."
        return 0
      fi
      # Keyed as "x<path>": the repo root is the path "", which an empty key would take as done.
      if [ "$_arch_key" != "x$_r" ]; then
        yad_tmp
        _arch_dir="$(mktemp -d "$_yad_tmp/product.XXXXXX")"
        # A throwaway index holding the base's epics/, written out under the temp folder. Not `git
        # archive`: it drops whatever the base's .gitattributes marks `export-ignore` — a Product folder
        # so marked came out empty, and the gate failed for the wrong reason.
        if ! { GIT_INDEX_FILE="${_arch_dir}.idx" git read-tree "${BASE}:${_e}" &&
               GIT_INDEX_FILE="${_arch_dir}.idx" git checkout-index -a --prefix="${_arch_dir}/${_e}/"; } >/dev/null 2>&1; then
          prod_fail="product-repo resolves to '${_r:-.}', a Product this repo tracks, and '${_e}' could not be read from ${BASE}."
          return 0
        fi
        _arch_key="x$_r"
      fi
      prod="${_arch_dir}${_r:+/$_r}"
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
    cd -P "./$_c" 2>/dev/null || exit 0   # ./ — a part named `-p` is not an option
  done
  _in "$(pwd -P)" || exit 0
  if [ -n "$(_hit "${_r:-.}" | head -1)" ]; then printf 'tree:%s' "$_r"; fi
  exit 0
)

# E118. A story's epic is its ID's prefix (EP-<slug>-S0N -> EP-<slug>): yad-spec always writes link.md's
# `epic:` so, and contract-check never read the field. The field is the PR's to write, so a gate that took
# it as it stands gated whichever epic the PR named — a story of a SEALED epic could name an open one and
# pass epic-open, or step off a thread frozen for hotfix debt. The gates that read `epic:` require it to
# agree with the story ID.
story_epic() { printf '%s' "$1" | sed -E 's/-S[0-9]+$//'; }

# One story ID shape for every gate (E117 review 1): EP-<slug>-S<n>, what yad-stories writes. Anything
# else is refused by name — a Task trailer of `EP-x-S01/.-T1` read `specs/EP-x-S01/./link.md`, a path
# the base read never found, and its `epic:` of `EP-x-S01/.` agreed with story_epic. The whole string
# must match (bash `=~`, not a line-wise grep), and the letters are spelled out so no locale widens them.
_story_re='^EP-[abcdefghijklmnopqrstuvwxyz0123456789-]+-S[0123456789]+$'
story_ok() { [[ $1 =~ $_story_re ]]; }

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

# Is the epic SEALED? true iff it has >=1 story and EVERY stories/*.md frontmatter status is `shipped`.
epic_sealed() {
  ep_dir="$1"
  sdir="${ep_dir}/stories"
  [ -d "$sdir" ] || return 1
  found=0
  for f in "$sdir"/*.md; do
    [ -e "$f" ] || continue
    found=1
    st="$(fm_val status "$f")"
    [ "$st" = "shipped" ] || return 1
  done
  [ "$found" = "1" ] || return 1
  return 0
}

commits="$(git rev-list --no-merges "$RANGE")"
if [ -z "$commits" ]; then
  echo "PASS [epic-open]: no non-merge commits in ${RANGE}"
  exit 0
fi

rc=0
while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  short="$(git log -1 --format=%h "$sha")"
  subject="$(git log -1 --format=%s "$sha")"
  task="$(git log -1 --format='%(trailers:key=Task,valueonly)' "$sha" | sed '/^$/d' | head -1)"
  # The type exemption waives the REQUIREMENT for an owning epic, not the VALIDITY of one that is
  # claimed — same rule spec-link applies. Exempting on the subject alone would let `chore(x): …` plus
  # a Task trailer pointing at a SEALED epic add behaviour to it, which is exactly what this gate exists
  # to refuse.
  if printf '%s' "$subject" | grep -qE "^(${EXEMPT})(\([a-z0-9._-]+\))?!?: " && [ -z "$task" ]; then
    echo "PASS [epic-open]: ${short} '${subject}' — maintenance commit, no Task trailer (exempt)"
    continue
  fi
  if ! printf '%s' "$task" | grep -qE '.+-T[0-9]+$'; then
    echo "note [epic-open]: ${short} has no resolvable Task trailer — deferring to spec-link."
    continue
  fi
  story="$(printf '%s' "$task" | sed -E 's/-T[0-9]+$//')"
  if ! story_ok "$story"; then
    echo "FAIL [epic-open]: ${short} ${task} — '${story}' is not a story ID (expected EP-<slug>-S<n>, the slug in lowercase letters, digits and dashes)."
    rc=1
    continue
  fi
  link="specs/${story}/link.md"
  [ -f "$link" ] || { echo "note [epic-open]: ${short} ${task} — link.md missing (spec-link will FAIL)."; continue; }
  epic="$(link_val epic "$link")"
  # A malformed link.md (empty product-repo, or an epic that is not a real EP-<slug>) must FAIL, not
  # slip through as "not reachable" — an empty epic would collapse ep_dir to <product>/epics/ (a real
  # dir) and pass the seal check as if the epic were open.
  if ! printf '%s' "$epic" | grep -qE '^EP-[a-z0-9-]+$'; then
    echo "FAIL [epic-open]: ${short} ${task} — link.md has no valid product-repo/epic metadata."
    rc=1
    continue
  fi
  if [ "$epic" != "$(story_epic "$story")" ]; then
    echo "FAIL [epic-open]: ${short} ${task} — ${link} says epic: ${epic:-<none>}, but ${story} is a story of $(story_epic "$story")."
    echo "  A story's epic is the prefix of its ID; the gate will not read another. Fix epic: in ${link}."
    rc=1
    continue
  fi
  product_for "$story"
  if [ -n "$prod_note" ]; then printf '%s\n' "$prod_note" | sed "s/^/note [epic-open]: ${short} /"; fi
  # The empty-product-repo half of the malformed check, on the value product_for settled on (E117).
  if [ -z "$product_rel" ]; then
    echo "FAIL [epic-open]: ${short} ${task} — link.md has no valid product-repo/epic metadata."
    rc=1
    continue
  fi
  if [ -n "$prod_fail" ]; then
    echo "FAIL [epic-open]: ${short} ${task} — ${prod_fail}"
    rc=1
    continue
  fi
  ep_dir="${prod}/epics/${epic}"
  if [ ! -d "$prod" ]; then
    echo "PASS [epic-open]: ${short} ${task} -> ${epic} (product repo not reachable — seal check deferred)."
    continue
  fi
  if [ ! -d "$ep_dir" ]; then
    echo "FAIL [epic-open]: ${short} ${task} -> epic ${epic} does not exist in the product repo (orphan story link)."
    rc=1
    continue
  fi
  if epic_sealed "$ep_dir"; then
    echo "FAIL [epic-open]: ${short} ${task} targets SEALED epic ${epic} (all stories shipped)."
    echo "  -> New behaviour cannot mutate a shipped epic. Open a threaded change-epic with yad-change"
    echo "     (type change|defect|hotfix, parent: ${epic}) and implement against ITS stories instead."
    rc=1
    continue
  fi
  echo "PASS [epic-open]: ${short} ${task} -> ${epic} (epic is open — has unshipped stories)."
done <<EOF
$commits
EOF
exit "$rc"
