#!/usr/bin/env bash
# contract-check gate (Phase 3 build plan §C; contract representation from Phase 2).
# The contract surface is singular and owned upstream (the product repo's locked contract.md).
# A code repo carries its quoted slice under specs/<story>/contracts/. If the diff changes that
# slice (i.e. tries to move the shared surface from inside a code repo), it MUST carry a
# `Contract-Change: yes` trailer AND the contract must have been updated/re-locked upstream first
# (link.md's pinned hash must match the product lock). Otherwise FAIL and route back to the
# architecture gate. Normal implementation that only CONSUMES the contract passes untouched.
set -euo pipefail
# Bytes, not characters (E114). The changed list below carries raw path bytes, and a path that is not
# valid UTF-8 read under a UTF-8 locale is one GNU grep and sed may skip or leave unmatched — one such
# file in a diff would hide every other path from the patterns (Linux CI). On macOS, `tr` and `sed` stop
# on it with "Illegal byte sequence" instead, so the gate fails with a message that names nothing.
export LC_ALL=C

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
[ -n "${1:-}" ] || [ -n "${SDLC_BASE:-}" ] || echo "note [contract-check]: no base given — diffing against '${BASE}'."

# Fail CLOSED if the base ref can't be resolved (shallow clone / wrong base branch / unfetched ref).
# Never let an undiffable range silently report "no surface change" — that would green-light a bypass.
if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [contract-check]: base ref '${BASE}' not found — fetch full history / check the base branch."
  exit 1
fi
RANGE="${BASE}..HEAD"

# No symlink and no submodule anywhere under specs/ (E115). The gate reads PATHS: a link lets the
# content live somewhere the paths below never name. A symlink at `specs`, `specs/<story>` or
# `specs/<story>/contracts` hid the slice from every rule here, and so did every later edit to the
# link's target; a symlinked slice file was seen once, when added, and never again. A link.md behind a
# link redirects the lock pin the fidelity check reads. yad-spec writes real files, so nothing
# legitimate lives there as a link.
#
# Read from the TREE at HEAD, not from the diff, and before the "no surface" PASS below: a link merged
# before this check existed fails every PR until one PR removes it — no diff would ever show it again.
# 120000 is a symlink, 160000 a submodule; `-r` lists `specs` itself when `specs` is the link.
#
# The WHOLE tree, from the repo root (--full-tree), matched without case: on macOS and Windows `Specs/`
# IS `specs/`, and git's path filter matches exact bytes only (`:(icase)` is refused by ls-tree). So a
# link under `Specs/` got past a `-- specs` read, and a plain file at `Specs/<story>/contracts/…` was
# never on the surface below, which is spelled in lowercase. A top folder spelled any other way than
# `specs` is refused too, once, by its own name. The name printed is everything after the first tab.
# `tolower` under LC_ALL=C folds ASCII only, so every character APFS folds (full case folding, then
# NFD) into ASCII alone is mapped by hand, as bytes — all 13, from Unicode's own tables, the same list
# as backfill-check (E121): ß and ẞ into `ss`, ſ into `s` (APFS reads `ſpecs/` as `specs/`), the Kelvin
# sign into `k`, the ligatures ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ into their letters, and the Greek question mark and varia
# into `;` and `` ` ``. That is `fold` below.
#
# The same holds one and two folders down (review 3): `specs/<story>/Contracts/` IS `contracts/` on a
# Mac, and `specs/EP-x-S01/` and `specs/ep-x-s01/` are one folder there, while every rule below reads
# exact bytes. So a `contracts` spelled any other way is refused, and so is a second spelling of a
# story folder — each once, by name. So is a FILE named `specs`, where the folder has to go. `fold`
# does not know other non-ASCII case or NFC/NFD: `EP-démo` beside `EP-DÉMO` (or an NFC/NFD twin) is not
# caught here. A twin that holds a slice fails anyway — its folder is not a story ID (E117) — and
# refusing every non-ASCII story name would refuse real repos.
#
# `tr '\n\0' '?\n'`: one record per line, and a newline inside a path becomes `?` (E121, as E116
# review 2). Split on newlines alone, a file named `x<newline>specs` read as a file named `specs`, and
# one named like a whole record added a link that was not there — every PR refused, naming the wrong file.
links="$(git ls-tree -r -z --full-tree HEAD | tr '\n\0' '?\n' | awk '
  function fold(x) { x = tolower(x)
    gsub(/\303\237|\341\272\236/, "ss", x); gsub(/\305\277/, "s", x); gsub(/\342\204\252/, "k", x)
    gsub(/\357\254\200/, "ff", x); gsub(/\357\254\201/, "fi", x); gsub(/\357\254\202/, "fl", x)
    gsub(/\357\254\203/, "ffi", x); gsub(/\357\254\204/, "ffl", x); gsub(/\357\254\205|\357\254\206/, "st", x)
    gsub(/\315\276/, ";", x); gsub(/\341\277\257/, "`", x); return x }
  function once(k, msg) { if (!(k in said)) { said[k] = 1; print "  " msg } }
  { t = index($0, "\t"); p = (t ? substr($0, t + 1) : $0); m = (t ? substr($0, 1, t - 1) : ""); lp = fold(p) }
  lp !~ /^specs(\/|$)/ { next }
  m ~ /^120000 / { print "  " p " (symlink)"; next }
  m ~ /^160000 / { print "  " p " (submodule)"; next }
  p !~ /^specs(\/|$)/ { top = p; sub(/\/.*/, "", top); once(top, (top == p ? top " (a file" : top "/ (a folder") " spelled other than specs — the same name on macOS and Windows)"); next }
  p == "specs" { print "  specs (a file, where the specs/ folder goes)"; next }
  { n = split(p, c, "/"); fs = fold(c[2]) }
  (fs in story) && story[fs] != c[2] { once("s/" c[2], "specs/" story[fs] (n == 2 ? " and specs/" c[2] " (one file" : "/ and specs/" c[2] "/ (one folder") " on macOS and Windows)") }
  !(fs in story) { story[fs] = c[2] }
  n >= 3 && c[3] != "contracts" && fold(c[3]) == "contracts" { once("c/" c[2] "/" c[3], "specs/" c[2] "/" c[3] (n == 3 ? " (a file" : "/ (a folder") " spelled other than contracts — the same name on macOS and Windows)") }
')" || { echo "FAIL [contract-check]: could not read the tree at HEAD — the links under specs/ cannot be checked."; exit 1; }
if [ -n "$links" ]; then
  echo "FAIL [contract-check]: specs/ holds a symlink, a submodule or a second spelling — this gate cannot see what it points at:"
  printf '%s\n' "$links"
  echo "  -> replace each link with the real files (yad-spec writes real files), and keep ONE spelling"
  echo "     of each folder: specs/, specs/<story>/, specs/<story>/contracts/. Until then every PR in this"
  echo "     repo fails here, because the contract surface cannot be checked. Removing a link or merging"
  echo "     a spelling is itself a change to specs/: under contracts/ it needs 'Contract-Change: yes'."
  exit 1
fi

# How the changed list is built, and why each flag is there (E114):
#   --no-renames  a rename is listed by BOTH paths, as a delete and an add. Without it git names a
#                 rename by its NEW path only, so `git mv specs/S1/contracts/api.md docs/api.md`
#                 took the slice off the surface and the gate never saw it — no trailer needed.
#   -z | tr       NUL-separated, so git never quotes a path. By default git wraps a path holding a
#                 non-ASCII byte in quotes and octal-escapes it, and it still quotes one holding a `"`
#                 or a tab with core.quotePath off — either way a slice like
#                 specs/EP-démo-S01/contracts/api.md never matched the pattern below. `tr '\n\0' '?\n'`
#                 (E121): one path per line, and a newline inside a path becomes `?` — split on
#                 newlines alone, a file named `notes<newline>specs/S1/contracts/api.md` read as a
#                 slice change and failed the PR over a file that does not exist.
# Both lists (this one and `deleted` below) are built the SAME way: the no-lock escape hatch compares
# them line for line.
changed="$(git diff --no-renames --name-only -z "$RANGE" | tr '\n\0' '?\n')"
surface="$(printf '%s\n' "$changed" | grep -E '^specs/[^/]+/contracts(/|$)' || true)"

# Slice paths this diff DELETES. `--name-only` above lists a deleted file exactly like a changed one,
# which is right for the trailer rule — removing an agreed endpoint IS a surface change — but it
# creates a dead end for the one epic that should never have had a slice in the first place.
#
# A short-lane epic has no lock and never will (E40). Once a `specs/<story>/contracts/` file exists
# under one, the unflagged rule below fails the commit, the no-lock rule further down fails the
# flagged one, and the cleanup commit that DELETES the file fails too — so there is no diff that
# passes, including the correct one. An escape hatch is not optional there.
#
# Deleting your own copy of a surface that nothing upstream has locked cannot widen it: with no lock
# there is no agreed shape for the deletion to contradict. So a delete-only diff is allowed through
# the no-lock branch (and only that branch — where a lock EXISTS, a deletion is still a real surface
# change and every rule below applies to it unchanged).
# --no-renames matters here too: a slice MOVED out of contracts/ is a delete of the old path, and
# without it git reports an `R`, which --diff-filter=D never matches — the hatch would refuse the move.
deleted="$(git diff --no-renames --diff-filter=D --name-only -z "$RANGE" | tr '\n\0' '?\n' | grep -E '^specs/[^/]+/contracts(/|$)' || true)"

if [ -z "$surface" ]; then
  echo "PASS [contract-check]: diff does not touch the contract surface (specs/*/contracts and everything under it)."
  exit 0
fi

echo "note [contract-check]: diff touches the contract surface:"
printf '%s\n' "$surface" | sed 's/^/  /'

cc="$(git log "$RANGE" --format='%(trailers:key=Contract-Change,valueonly)' | sed '/^$/d' | tr 'A-Z' 'a-z')"
if ! printf '%s\n' "$cc" | grep -qx 'yes'; then
  echo "FAIL [contract-check]: contract surface changed without a 'Contract-Change: yes' trailer."
  echo "  -> Route back to the architecture gate: update + re-lock contract.md in the product repo,"
  echo "     or, if this epic is on a short lane (chore/spike) and has no architecture gate, move the"
  echo "     surface change to a new epic on the classic route,"
  echo "     re-run yad-spec, then implement with Contract-Change: yes. The surface is never widened"
  echo "     from inside a code repo."
  exit 1
fi

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
  if [ -n "$_base_rel" ] && [ "$_base_rel" != "$product_rel" ]; then
    prod_note="${_link} names product-repo '${product_rel}', but ${_from} on ${BASE} says '${_base_rel}' — the Product is read from the base value; a new one counts once it merges."
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

# Fidelity check (best-effort): when the product repo is reachable, the story's link.md must pin the
# CURRENT product lock — proof the contract was actually updated/re-locked upstream, not just flagged.
#
# Checked for EVERY story whose slice the diff touches, not just the first one. `git diff --name-only`
# is path-sorted, so reading a single story off `head -1` validated whichever story sorted first and
# left the rest unpinned: a second story pinning a STALE hash passed, and a first story with no
# link.md deferred the whole check before the stale one was ever read (issue #161). Failures are
# AGGREGATED — every story reports, so one clean-or-deferred story never masks another's stale pin
# (the same rule spec-link applies per commit).
stories="$(printf '%s\n' "$surface" | sed -E 's#^specs/([^/]+)/contracts(/.*)?$#\1#' | sort -u)"
rc=0
while IFS= read -r story; do
  [ -z "$story" ] && continue
  # This story's own changed and deleted slice paths, matched as text (a folder that is not a story ID
  # may hold characters a pattern would read; the prefix goes in through the environment, because
  # `awk -v` turns a `\b` in a folder name into a backspace). A story whose every changed slice file is
  # DELETED only removes (only_removes); one whose slice is also GONE at HEAD (slice_gone) is a whole
  # clean-up, the only kind that needs no link.md — deleting link.md with PART of a slice used to drop
  # a stale pin while the rest of the slice stayed (E117 review 3).
  story_surface="$(printf '%s\n' "$surface" | p="specs/${story}/contracts" awk 'BEGIN { p = ENVIRON["p"] } index($0, p) == 1 && (length($0) == length(p) || substr($0, length(p) + 1, 1) == "/")')"
  story_deleted="$(printf '%s\n' "$deleted" | p="specs/${story}/contracts" awk 'BEGIN { p = ENVIRON["p"] } index($0, p) == 1 && (length($0) == length(p) || substr($0, length(p) + 1, 1) == "/")')"
  only_removes=""
  [ -n "$story_surface" ] && [ "$story_surface" = "$story_deleted" ] && only_removes=1
  slice_gone=""
  if [ -n "$only_removes" ] && ! git cat-file -e "HEAD:specs/${story}/contracts" 2>/dev/null; then slice_gone=1; fi
  link="specs/${story}/link.md"
  if ! story_ok "$story"; then
    if [ -n "$only_removes" ]; then
      echo "note [contract-check]: specs/${story}/contracts is not under a story ID, and this only removes it — allowed."
      continue
    fi
    echo "FAIL [contract-check]: specs/${story}/contracts is not under a story ID (expected EP-<slug>-S<n>, the slug in lowercase letters, digits and dashes) — its lock cannot be found."
    echo "  Move the slice under its story's folder, or delete it. (A Spec Kit folder such as specs/001-name/ is not one.)"
    rc=1
    continue
  fi
  if [ ! -f "$link" ]; then
    # Removing a story's whole slice with its link.md is a clean-up, as before. Adding or changing a
    # slice without its link.md is not (E117 review 2): yad-spec writes the two together, and a PR could
    # delete link.md to drop a stale pin, or add a slice for an epic that exists nowhere. Nor is removing
    # PART of one (review 3): what is left is still a slice, with nothing pinning it.
    if [ -n "$slice_gone" ]; then
      echo "note [contract-check]: no ${link}, and this only removes ${story}'s slice — fidelity check not needed."
      continue
    fi
    echo "FAIL [contract-check]: ${story}'s contract slice changes, but ${link} is not there — the slice cannot be tied to a contract lock."
    echo "  Re-run yad-spec for ${story} (it writes the slice and link.md together), or remove the slice."
    rc=1
    continue
  fi
  pinned="$(printf '%s' "$(link_val contract-lock "$link")" | sed -E 's/^sha256:([0-9a-f]+).*$/\1/')"
  epic="$(story_epic "$story")"   # story EP-<slug>-S0N -> epic EP-<slug>
  product_for "$story"
  if [ -n "$prod_note" ]; then printf '%s\n' "$prod_note" | sed 's/^/note [contract-check]: /'; fi
  if [ -n "$prod_fail" ]; then
    echo "FAIL [contract-check]: ${link} — ${prod_fail}"
    rc=1
    continue
  fi
  # Only build the lock path when the product repo actually resolved. With an empty `prod` the
  # interpolation yields "/epics/<epic>/…" — a path rooted at the filesystem root, which is both a
  # misleading thing to print and, on a machine that happened to have /epics, a foreign file to read.
  lock=""
  [ -n "$prod" ] && lock="${prod}/epics/${epic}/.sdlc/contract-lock.json"
  if [ -n "$product_rel" ] && [ -f "$lock" ]; then
    # Newline-tolerant, first-match: `"hash":` and its value may legally sit on separate lines, and an
    # unparseable lock is a FAIL below — so a formatting choice must not become a gate failure.
    # `|| current=""` is load-bearing: under `pipefail` a no-match grep fails the whole pipeline, which
    # under `set -e` would abort the gate instead of reaching the unparseable-lock FAIL below.
    current="$(tr '\n' ' ' < "$lock" | grep -oE '"hash"[[:space:]]*:[[:space:]]*"sha256:[0-9a-f]+"' | head -1 | sed -E 's/.*sha256:([0-9a-f]+)"$/\1/')" || current=""
    # A lock we can READ but cannot PARSE proves nothing, and an empty `current` used to short-circuit
    # the comparison below straight into the "hash matches" note — the gate affirmatively reporting a
    # match it never made. Fail closed instead: a truncated, half-written or schema-changed lock is a
    # broken lock, and a Contract-Change is being claimed against it.
    if [ -z "$current" ]; then
      echo "FAIL [contract-check]: ${lock} has no readable \"hash\": \"sha256:…\" value —"
      echo "  the lock cannot prove ${link}'s pin. Re-lock the contract upstream (yad-architecture Step 5)."
      rc=1
      continue
    fi
    if [ "$current" != "$pinned" ]; then
      echo "FAIL [contract-check]: Contract-Change claimed, but ${link} still pins ${pinned:0:12}…"
      echo "  while the product lock is ${current:0:12}… — re-run yad-spec so the slice matches the re-locked contract."
      rc=1
      continue
    fi
    echo "note [contract-check]: ${link} hash matches the product lock (${current:0:12}…)."
  elif [ -n "$prod" ] && [ -d "${prod}/epics/${epic}/.sdlc" ]; then
    # THE PRODUCT REPO RESOLVED AND THERE IS STILL NO LOCK. That is a different fact from "not
    # reachable", and it must not share its answer. A `Contract-Change: yes` is being claimed against
    # an epic that has no locked surface at all, so there is nothing the claim could be true of.
    #
    # This is the steady state of the short lanes (E40): `chore` and `spike` carry no architecture
    # step, so `contract.md` and `contract-lock.json` never exist on them. Deferring here meant every
    # short-lane epic could move the shared cross-repo surface forever, with a note that reads like a
    # pass. The guard used to be prose in the authoring skills; this is the gate.
    #
    # Narrow on purpose, and the guard is the EPIC'S LEDGER DIRECTORY, not the product path — because
    # `resolve_product` ALWAYS returns some path and never verifies that the one it picked exists. (Its
    # own two `-d` tests only choose BETWEEN the story-relative and repo-root joins; neither rejects a
    # miss.) Requiring `epics/<epic>/.sdlc/` to exist is what separates "this epic is real and has no
    # lock" from "nothing is checked out here". A CI job that does not check the
    # product repo out still defers below, exactly as before — that case proves nothing either way,
    # and failing it would break every setup that has always run this way.
    # The escape hatch described at the top: with no lock upstream there is no agreed shape for a
    # deletion to contradict, so REMOVING a slice is always allowed here. This is what keeps a
    # short-lane story that should never have had a `contracts/` folder from being unfixable.
    if [ -n "$only_removes" ]; then
      echo "note [contract-check]: ${story} only REMOVES contract slice files and ${epic} has no lock —"
      echo "  nothing upstream is being contradicted, so the removal is allowed."
      continue
    fi
    echo "FAIL [contract-check]: Contract-Change claimed, but ${epic} has no contract lock at all."
    echo "  Expected ${lock} — the epic's ledger directory is there and the lock file is not."
    echo "  Three ways to be here, with three different fixes:"
    echo "   - a SHORT LANE (chore/spike): it has no architecture step and never locks a surface, so it"
    echo "     carries no specs/<story>/contracts/ at all. DELETE the slice; a delete-only diff passes."
    echo "     A real surface change belongs to a new epic on the classic route."
    echo "   - a STUB / lightly-promoted brownfield epic: the feature was never documented, so there is"
    echo "     nothing to lock yet. Run yad-backfill and promote it fully (which locks contract.md)."
    echo "   - a CLASSIC epic that has not reached its architecture gate: author and lock contract.md"
    echo "     first (yad-architecture Step 5)."
    rc=1
    continue
  elif [ -n "$prod" ] && [ -d "$prod" ] && [ ! -d "${prod}/epics/${epic}" ]; then
    # The Product WAS reached, and has no such epic: a slice for an epic that exists nowhere (E117
    # review 2). It used to say "not reachable" and defer. "Reached" is the folder itself, as in the three
    # twin gates — not `epics/` inside it (review 3). Removing such a slice is always allowed: there is
    # no lock anywhere for it to contradict.
    if [ -n "$only_removes" ]; then
      echo "note [contract-check]: ${story}'s slice belongs to ${epic}, which the Product does not have, and this only removes it — allowed."
      continue
    fi
    echo "FAIL [contract-check]: ${story}'s slice belongs to ${epic}, which does not exist in the Product (${prod}/epics/) — an orphan slice."
    rc=1
    continue
  elif [ -z "$_base_rel" ] && [ -z "$only_removes" ] && { [ -z "$prod" ] || [ ! -d "$prod" ]; }; then
    # The repo's FIRST spec (E119): no link.md on the base names a Product, so product-repo is this PR's
    # own value — and it reaches nothing. Deferring here let a PR pick a path that does not exist and
    # pass a slice change with no lock check at all. This case is known from paths alone: the slice is
    # on the surface, and the base holds no link.md with a value. A value merged on the base that reaches
    # nothing still defers below (a CI job that does not check the Product out); a PR that only removes
    # a slice passes as before. The other Product-reading gates judge the epic, not the surface, and
    # still defer here — E120. Only when the Product is NOT reached (review 1): one that is reached, with
    # the epic's folder but no ledger in it, is not "nowhere", and defers below as it always has.
    echo "FAIL [contract-check]: ${link} is this repo's first spec — no link.md on ${BASE} names a Product —"
    if [ -n "$product_rel" ]; then
      echo "  and its product-repo '${product_rel}' reaches nothing, so the contract lock cannot be checked."
    else
      echo "  and it names no product-repo, so the contract lock cannot be checked."
    fi
    echo "  Check the Product out in this repo's CI where product-repo points, or fix product-repo."
    rc=1
    continue
  else
    # Say so. A skipped fidelity check used to be indistinguishable from a passed one, which is how a
    # mis-resolved product-repo could turn a stale-pin FAIL into a silent PASS (issue #149).
    echo "note [contract-check]: product lock not reachable at ${lock:-<no product-repo in link.md>} — fidelity check deferred."
  fi
done <<EOF
$stories
EOF

if [ "$rc" != 0 ]; then
  echo "FAIL [contract-check]: a changed slice pins a stale or absent contract lock, or reads its Product from a place this PR chose (see above) — the surface was not proven re-locked upstream for every story in this diff."
  exit 1
fi

echo "PASS [contract-check]: surface change accompanied by Contract-Change: yes (and an updated contract)."
exit 0
