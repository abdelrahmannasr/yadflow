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
# scalars only; trailing spaces/CR are stripped so they never become part of a path. The CR goes BEFORE
# the fences are matched: a CRLF file's `---\r` is no fence, and every key in it read as empty (E117 r2).
fm_val() { awk -v k="$1" '{ sub(/\r$/, "") } NR==1 && /^---$/ {f=1; next} f && /^---$/ {exit} f && index($0, k":")==1 {sub("^" k ":[ \t]*", ""); print; exit}' "$2" 2>/dev/null | tr -d '\r' | sed -E 's/[[:space:]]+$//'; }

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
#    about one story, so: link.md as it stands on the base when that has a value; else a sibling
#    `specs/<story>/link.md` on the base — one of the same epic first, and the first whose value reaches
#    a folder here, so one stale link.md cannot hand every new story a deferral; else — the repo's
#    first spec — this PR's value. Otherwise a PR could point it at a path that does not exist —
#    "not reachable", a deferral, a PASS — or at a folder of its own. A value that differs is printed
#    and counts once it merges. Only `product-repo` comes from the base: `contract-lock` is read as the
#    PR leaves it — a re-spec PR updates the pin, and must.
#  - a Product this repo KEEPS (a monorepo: the Product and the code in one git repo) is read as it
#    stands on the base, never as the PR leaves it. In order: (1) the path's TEXT names a folder whose
#    `.sdlc/hub.json` the base tracks (every Product commits one) — asked of the base before the disk,
#    which is the PR's: a PR that deleted or moved that folder read as untracked, and deferred; (2) the
#    path is walked on disk: a tracked symlink, submodule or file on the way is refused (what is behind
#    it is the PR's to choose), and so is a tracked folder that is not a kept Product, so one force-added
#    file cannot switch the gates to a partial Product; the walk is repeated from where the path really
#    lands (an alias like /proc/self/cwd means another folder to each process); an untracked folder
#    that is there is CI's checkout, and is read — unless it is inside the repo's own git folder,
#    which branch names shape (review 7); (3) only when the path reaches NOTHING, a Product the base keeps that holds
#    this story's epic is the one meant. "Inside the code repo" is NOT the test: CI can only check a
#    second repo out INSIDE the workspace, and an untracked checkout there is not the PR's.
#
# E120. Before any of that, the repo's own record: `.sdlc/product-link.json`, written by `yad check --fix`
# / `yad update` and merged on its own. Its `path` (from the repo root; where CI checks the Product out)
# is read from the BASE and wins over every link.md — so no gate takes where the Product lives from the
# PR. A record the PR adds or changes counts once it merges (a note says so). A link.md whose own
# product-repo reaches a DIFFERENT folder here gets a note; one that reaches nothing (a path on its
# author's machine) is passed over in silence. With no record on the base, the order above is kept.
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
# The `path` of `.sdlc/product-link.json` at $1 (a commit), or empty when there is none or it names none.
record_path() {
  git cat-file -e "$1:.sdlc/product-link.json" 2>/dev/null || return 0
  git show "$1:.sdlc/product-link.json" 2>/dev/null | tr -d '\n\r' | sed -nE 's/.*"path"[[:space:]]*:[[:space:]]*"([^"\\]*)".*/\1/p' || true
}
product_for() {
  _link="specs/$1/link.md"
  prod=""; prod_note=""; prod_fail=""
  yad_tmp   # here, in this shell: a $(…) below would set it, and its EXIT trap, in a subshell only
  product_rel="$(link_val product-repo "$_link")"
  _from="$_link"
  _rec="$(record_path "$BASE")"
  _rec_head="$(record_path HEAD)"
  if [ "$_rec_head" != "$_rec" ]; then
    if [ -n "$_rec" ]; then _w="changes in this PR"; _s="record"; else _w="is new in this PR"; _s="link.md files"; fi
    prod_note=".sdlc/product-link.json ${_w} — the Product is read from ${BASE}'s ${_s}; the new one counts once it merges."
  fi
  if [ -n "$_rec" ]; then
    # Relative to the repo root; link.md values are relative to specs/<story>/, so join it that way.
    case "$_rec" in /*) _base_rel="$_rec" ;; *) _base_rel="../../$_rec" ;; esac
    _from=".sdlc/product-link.json"
  else
    _base_rel="$(base_product_rel "$_link")"
  fi
  if [ -z "$_base_rel" ]; then
    # A sibling's value. Every link.md sits at specs/<story>/, so a relative value means the same there.
    _sibs="$(git ls-tree -r -z --name-only "$BASE" -- specs 2>/dev/null | tr '\n\0' '?\n' | grep -E '^specs/[^/]+/link\.md$' || true)"
    _first=""; _first_from=""
    for _pass in same other; do
      while IFS= read -r _sib; do
        [ -n "$_sib" ] && [ "$_sib" != "$_link" ] || continue
        _s="${_sib#specs/}"; _s="${_s%/link.md}"
        story_ok "$_s" || continue
        if [ "$(story_epic "$_s")" = "$(story_epic "$1")" ]; then [ "$_pass" = same ] || continue; else [ "$_pass" = other ] || continue; fi
        _v="$(base_product_rel "$_sib")"
        [ -n "$_v" ] || continue
        if [ -z "$_first" ]; then _first="$_v"; _first_from="$_sib"; fi
        if [ -d "$(resolve_product "$_v" "$1")" ]; then _base_rel="$_v"; _from="$_sib"; break 2; fi
      done <<SIBLINGS
$_sibs
SIBLINGS
    done
    if [ -z "$_base_rel" ]; then _base_rel="$_first"; _from="$_first_from"; fi
  fi
  if [ -n "$_rec" ]; then
    # The record wins. Say so only when this link.md's own value reaches a different folder here.
    _mine="$(resolve_product "$product_rel" "$1")"
    _theirs="$(resolve_product "$_base_rel" "$1")"
    if [ -n "$product_rel" ] && [ -d "$_mine" ] && ! [ "$_mine" -ef "$_theirs" ]; then
      prod_note="${prod_note:+$prod_note
}${_link} names product-repo '${product_rel}', but .sdlc/product-link.json on ${BASE} says '${_rec}' — the record is read."
    fi
    product_rel="$_base_rel"
  elif [ -n "$_base_rel" ] && [ "$_base_rel" != "$product_rel" ]; then
    prod_note="${prod_note:+$prod_note
}${_link} names product-repo '${product_rel}', but ${_from} on ${BASE} says '${_base_rel}' — the Product is read from the base value; a new one counts once it merges."
    product_rel="$_base_rel"
  fi
  # A Product this repo keeps, asked of the base first (see above). Both joins resolve_product may pick.
  case "$product_rel" in
    '') _cands="" ;;
    /*|'~'*|'$'*) _cands="$product_rel" ;;
    *) _cands="specs/$1/$product_rel
$product_rel" ;;
  esac
  while IFS= read -r _cand; do
    [ -n "$_cand" ] || continue
    _lr="$(lex_rel "$_cand")"
    [ -n "$_lr" ] || continue
    [ "$_lr" != . ] || _lr=""
    if git cat-file -e "${BASE}:${_lr:+$_lr/}.sdlc/hub.json" 2>/dev/null; then base_product "$_lr"; return 0; fi
  done <<CANDS
$_cands
CANDS
  if [ -n "$product_rel" ]; then
    prod="$(resolve_product "$product_rel" "$1")"
    ! tracked_verdict "$(product_tracked "$prod")" || return 0
    if [ -d "$prod" ]; then
      # Walked once more, from where it really lands, resolved in ONE step from this shell (review 5).
      # The walk above goes one part at a time in a subshell, and a Linux magic link such as
      # /proc/self/cwd means a different folder to each process: there it pointed at the walk's own
      # subshell and found nothing, while this shell read the PR's own copy of a kept Product through it.
      # `./` before a relative path, so a value starting with `-` is not read by `cd` as an option
      # (review 6); and a folder that is there but cannot be entered is refused, not read unchecked.
      case "$prod" in /*) _pc="$prod" ;; *) _pc="./$prod" ;; esac
      _phys="$(cd -P "$_pc" 2>/dev/null && pwd -P)" || _phys=""
      if [ -z "$_phys" ]; then
        prod_fail="product-repo resolves to '${prod}', a folder the gate cannot enter to check where it really is — so it is not read."
        return 0
      fi
      # Not inside this repo's own git folder (review 7). git never lists `.git/` as tracked, yet a PR
      # shapes it: a branch named `epics/EP-x/y` makes the folders `.git/refs/…/epics/EP-x/` when CI
      # fetches, and that read as an untracked checkout holding an open epic with no lock.
      # Compared as FOLDERS (`-ef`: the same one on disk), not as spellings: on a disk that ignores case
      # (macOS, Windows) `.GIT/refs` is `.git/refs`, and `pwd -P` keeps the case it was typed in (review 8).
      for _gd in "$(git rev-parse --absolute-git-dir 2>/dev/null)" "$(git rev-parse --git-common-dir 2>/dev/null)"; do
        [ -n "$_gd" ] && [ -d "$_gd" ] || continue
        _p="$_phys"
        while :; do
          if [ "$_p" -ef "$_gd" ]; then
            prod_fail="product-repo resolves to '${prod}', inside this repo's own git folder — what is there is git's, shaped by branch names, not a Product."
            return 0
          fi
          case "$_p" in /|'') break ;; esac
          _p="${_p%/*}"; [ -n "$_p" ] || _p=/
        done
      done
      ! tracked_verdict "$(product_tracked "$_phys")" || return 0
      # An untracked folder that is there is the Product CI checked out: a PR cannot make one. Read it.
      return 0
    fi
  fi
  # product-repo reaches NOTHING. Then a Product the base keeps that holds this story's epic is the one
  # meant (E117 review 3): a monorepo value spelled past the repo's own folder name, another machine's
  # absolute path, or a first spec pointing nowhere cannot be folded to it by text, and a PR that deleted
  # or moved it leaves no disk to walk. Only when nothing is reached (review 4): a kept Product used to
  # win over the real checkout, so a merged test fixture shaped like a Product was read instead of it.
  # And only one holding the epic, so such a fixture is not read for stories it knows nothing about.
  # (In a two-repo setup whose CI checks nothing out, a fixture that DOES hold the epic is read where
  # the gate used to defer — no weaker than the deferral it replaces.)
  kept_products
  _epic_of="$(story_epic "$1")"
  _kept_here=""
  while IFS= read -r _k; do
    [ -n "$_k" ] || continue
    _kd="$_k"; [ "$_kd" != . ] || _kd=""
    if [ "$(git cat-file -t "${BASE}:${_kd:+$_kd/}epics/${_epic_of}" 2>/dev/null)" = tree ]; then _kept_here="${_kept_here}${_k}
"; fi
  done <<KEPT
$_kept
KEPT
  [ -n "$_kept_here" ] || return 0
  if [ -n "$product_rel" ]; then _what="product-repo '${product_rel}' reaches nothing"; else _what="link.md names no product-repo"; fi
  if [ "$(printf '%s' "$_kept_here" | grep -c .)" -gt 1 ]; then
    prod_fail="${_what}, and ${BASE} keeps more than one Product holding ${_epic_of} ($(printf '%s' "$_kept_here" | tr '\n' ' ' | sed -E 's/ +$//')) — the gate cannot tell which is meant."
    return 0
  fi
  _k="$(printf '%s' "$_kept_here" | head -1)"
  prod_note="${prod_note:+$prod_note
}${_what} here; the Product this repo keeps at '${_k}' on ${BASE} holds ${_epic_of}, so that one is read."
  product_rel="$_k"
  [ "$_k" != . ] || _k=""
  base_product "$_k"
  return 0
}

# Act on product_tracked's answer $1: a tracked entry on the way is refused; a tracked folder is read from
# the base when the base keeps a Product there, and refused otherwise. Returns 1 when there was nothing to
# act on (the path is not the repo's), so the caller goes on.
tracked_verdict() {
  case "$1" in
    entry:*)
      prod_fail="product-repo reaches the Product through '${1#*:}', a symlink, submodule or file this repo tracks — what is behind it is this PR's to choose. Point product-repo at the Product itself."
      return 0 ;;
    tree:*)
      _r="${1#*:}"
      if git cat-file -e "${BASE}:${_r:+$_r/}.sdlc/hub.json" 2>/dev/null; then base_product "$_r"; return 0; fi
      prod_fail="product-repo resolves to '${_r:-.}', which holds files this repo tracks, but ${BASE} does not track '${_r:+$_r/}.sdlc/hub.json' there, so it is not a Product kept in this repo. Untrack those files (git rm -r --cached '${_r:-.}') or point product-repo at the Product."
      return 0 ;;
  esac
  return 1
}

# Every Product the base keeps: a tracked `.sdlc/hub.json` with an `epics/` folder beside it (a code repo
# may track a hub.json of its own; only a Product has epics). One line each, `.` for the root; read once.
_kept=""
_kept_read=""
kept_products() {
  [ -z "$_kept_read" ] || return 0
  _kept_read=1
  while IFS= read -r _h; do
    [ -n "$_h" ] || continue
    _d="${_h%.sdlc/hub.json}"; _d="${_d%/}"
    if [ "$(git cat-file -t "${BASE}:${_d:+$_d/}epics" 2>/dev/null)" = tree ]; then _kept="${_kept}${_d:-.}
"; fi
  done <<KEPT
$(git ls-tree -r -z --name-only "$BASE" 2>/dev/null | tr '\n\0' '?\n' | grep -E '(^|/)\.sdlc/hub\.json$' || true)
KEPT
}

# Read the Product this repo keeps at $1 (from the repo root; "" is the root) as it stands on the base:
# its `epics/` written out under the temp folder. Sets prod, or prod_fail.
base_product() {
  _r="$1"; _e="${_r:+$_r/}epics"
  if [ "$(git cat-file -t "${BASE}:${_e}" 2>/dev/null)" != tree ]; then
    prod_fail="product-repo resolves to '${_r:-.}', a Product this repo keeps, and ${BASE} has no '${_e}' folder — there is nothing on the base to read."
    return 0
  fi
  # (awk reads to the end rather than stopping at the first hit: stopping left `tr` writing into a
  # closed pipe on a large epics/, and under pipefail the gate died with no message — review 6.)
  # A symlink or submodule inside it is refused by name, as under specs/ (E115): a link written out
  # still points where it pointed — an absolute one into this PR's working tree — and a submodule comes
  # out as an empty folder, which reads as an epic with no stories.
  _bad="$(git ls-tree -r -z "${BASE}:${_e}" 2>/dev/null | tr '\n\0' '?\n' | awk '!f && ($1 == "120000" || $1 == "160000") { sub(/^[^\t]*\t/, ""); print; f = 1 }')"
  if [ -n "$_bad" ]; then
    prod_fail="'${_e}/${_bad}' on ${BASE} is a symlink or a submodule, so the Product this repo keeps cannot be read from the base. Replace it with the files themselves."
    return 0
  fi
  # Keyed as "x<path>": the repo root is the path "", which an empty key would take as done.
  if [ "$_arch_key" != "x$_r" ]; then
    _arch_dir="$(mktemp -d "$_yad_tmp/product.XXXXXX")"
    # A throwaway index holding the base's epics/, written out with the WORK TREE pointed at the empty
    # temp folder. Not `git archive`: it drops whatever the base's .gitattributes marks `export-ignore`.
    # And not with the real work tree: `git checkout-index` takes attributes from the work tree, which
    # is the PR's — a `.gitattributes` of `*.md text eol=crlf` or `working-tree-encoding=UTF-16` in the
    # PR wrote the base's files unreadable, and every gate passed. Pointed here, it finds none but the
    # base's own.
    # The index's own `.gitattributes` entries are dropped before it is written out, for the same reason
    # (review 3): one merged into the base's epics/ applied `working-tree-encoding=UTF-16` to every file.
    if ! { mkdir -p "${_arch_dir}/${_e}" &&
           GIT_INDEX_FILE="${_arch_dir}.idx" git read-tree "${BASE}:${_e}" &&
           GIT_INDEX_FILE="${_arch_dir}.idx" git ls-files -z -- ':(glob)**/.gitattributes' |
             GIT_INDEX_FILE="${_arch_dir}.idx" xargs -0 git update-index --force-remove -- &&
           GIT_WORK_TREE="${_arch_dir}/${_e}" GIT_INDEX_FILE="${_arch_dir}.idx" git checkout-index -a -f; } >/dev/null 2>&1; then
      prod_fail="product-repo resolves to '${_r:-.}', a Product this repo keeps, and '${_e}' could not be read from ${BASE}."
      return 0
    fi
    _arch_key="x$_r"
  fi
  prod="${_arch_dir}${_r:+/$_r}"
  prod_note="${prod_note:+$prod_note
}the Product at '${_r:-.}' is kept in this repo, so it is read as it stands on ${BASE}, not as this PR leaves it."
  return 0
}

# The path $1 from the repo root, `.` and `..` folded by its text alone — no disk. Prints `.` for the
# root and nothing when it leaves the repo. An absolute path counts when it starts with the repo's path
# as the shell spells it or as the disk does (`pwd`, `pwd -P`; the gates run from the root).
lex_rel() (
  _p="$1"
  case "$_p" in
    /*)
      _in=""
      for _top in "$(pwd)" "$(pwd -P)"; do
        case "$_p/" in "$_top"/*) _p="${_p#"$_top"}"; _in=1; break ;; esac
      done
      [ -n "$_in" ] || exit 0 ;;
  esac
  _out=""
  set -f; IFS=/
  for _c in $_p; do
    case "$_c" in
      ''|.) ;;
      ..) [ -n "$_out" ] || exit 0
          case "$_out" in */*) _out="${_out%/*}" ;; *) _out="" ;; esac ;;
      *) _out="${_out:+$_out/}$_c" ;;
    esac
  done
  printf '%s' "${_out:-.}"
)

# Is the path $1 — as the shell would walk it, `..` and links included — something this repo tracks?
# Prints `entry:<path>` when a part of the way is a tracked entry itself (a symlink, a submodule, a
# file), `tree:<path>` when it ends in a folder with tracked files at or under it, and nothing when
# it is the repo's to neither. <path> is from the repo root, as the disk spells it (`pwd -P`). The case
# is folded where git folds it (core.ignorecase — a Mac checkout), and in ASCII only.
product_tracked() (
  _top="$(git rev-parse --show-toplevel 2>/dev/null)" && _top="$(cd -P "$_top" 2>/dev/null && pwd -P)" || exit 0
  _ps='literal'; [ "$(git config --bool core.ignorecase 2>/dev/null)" = true ] && _ps='literal,icase'
  _in() { case "$1/" in "$_top"/*) _r="${1#"$_top"}"; _r="${_r#/}"; return 0 ;; esac; return 1; }
  _hit() { git -C "$_top" ls-files -z -- ":(${_ps})$1" 2>/dev/null | tr '\n\0' '?\n'; }
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
  task="$(git log -1 --format='%(trailers:key=Task,valueonly)' "$sha" | awk '!f && length($0) { print; f = 1 }')"
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
