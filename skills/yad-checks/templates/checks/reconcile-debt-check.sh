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
#    stands on the base, never as the PR leaves it. Whether it is one is asked of the BASE, from the
#    path's text alone, before anything on disk: the base tracks `<path>/.sdlc/hub.json`, which every
#    Product commits. The disk is the PR's — a PR that deleted or moved that folder read as untracked,
#    and deferred. Any other tracked file under a Product path is refused, so one force-added file
#    cannot switch the gates to a partial Product; so is a path that runs through a tracked symlink,
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
    _sibs="$(git ls-tree -r -z --name-only "$BASE" -- specs 2>/dev/null | tr '\0' '\n' | grep -E '^specs/[^/]+/link\.md$' || true)"
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
  # And when product-repo does not name it — spelled past the repo's own folder name, on another
  # machine's absolute path, or pointing nowhere on the repo's first spec — a Product the base keeps is
  # still THE Product (E117 review 3). Its text cannot be folded to it, and the disk walk below stops at
  # the first missing folder: exactly what a PR that deleted or moved it leaves.
  kept_products
  if [ -n "$_kept" ]; then
    if [ "$(printf '%s' "$_kept" | grep -c .)" -gt 1 ]; then
      prod_fail="${BASE} keeps more than one Product ($(printf '%s' "$_kept" | tr '\n' ' ' | sed -E 's/ +$//')), and product-repo '${product_rel}' names none of them — the gate cannot tell which is meant."
      return 0
    fi
    _k="$(printf '%s' "$_kept" | head -1)"
    prod_note="${prod_note:+$prod_note
}product-repo '${product_rel}' does not name the Product this repo keeps at '${_k}' on ${BASE} — that one is read."
    [ "$_k" != . ] || _k=""
    base_product "$_k"
    return 0
  fi
  [ -n "$product_rel" ] || return 0
  prod="$(resolve_product "$product_rel" "$1")"
  _t="$(product_tracked "$prod")"
  case "$_t" in
    entry:*)
      prod_fail="product-repo reaches the Product through '${_t#*:}', a symlink, submodule or file this repo tracks — what is behind it is this PR's to choose. Point product-repo at the Product itself." ;;
    tree:*)
      _r="${_t#*:}"
      if git cat-file -e "${BASE}:${_r:+$_r/}.sdlc/hub.json" 2>/dev/null; then base_product "$_r"; return 0; fi
      prod_fail="product-repo resolves to '${_r:-.}', which holds files this repo tracks, but ${BASE} does not track '${_r:+$_r/}.sdlc/hub.json' there, so it is not a Product kept in this repo. Untrack those files (git rm -r --cached '${_r:-.}') or point product-repo at the Product." ;;
  esac
  return 0
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
$(git ls-tree -r -z --name-only "$BASE" 2>/dev/null | tr '\0' '\n' | grep -E '(^|/)\.sdlc/hub\.json$' || true)
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
  # A symlink or submodule inside it is refused by name, as under specs/ (E115): a link written out
  # still points where it pointed — an absolute one into this PR's working tree — and a submodule comes
  # out as an empty folder, which reads as an epic with no stories.
  _bad="$(git ls-tree -r -z "${BASE}:${_e}" 2>/dev/null | tr '\0' '\n' | awk '$1 == "120000" || $1 == "160000" { sub(/^[^\t]*\t/, ""); print; exit }')"
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
  if ! story_ok "$story"; then
    echo "FAIL [reconcile-debt]: ${short} ${task} — '${story}' is not a story ID (expected EP-<slug>-S<n>, the slug in lowercase letters, digits and dashes)."
    rc=1
    continue
  fi
  link="specs/${story}/link.md"
  [ -f "$link" ] || continue
  epic="$(link_val epic "$link")"
  if [ "$epic" != "$(story_epic "$story")" ]; then
    echo "FAIL [reconcile-debt]: ${short} ${task} — ${link} says epic: ${epic:-<none>}, but ${story} is a story of $(story_epic "$story")."
    echo "  A story's epic is the prefix of its ID; the gate will not read another. Fix epic: in ${link}."
    rc=1
    continue
  fi
  product_for "$story"
  if [ -n "$prod_note" ]; then printf '%s\n' "$prod_note" | sed "s/^/note [reconcile-debt]: ${short} /"; fi
  if [ -n "$prod_fail" ]; then
    echo "FAIL [reconcile-debt]: ${short} ${task} — ${prod_fail}"
    rc=1
    continue
  fi
  ep_dir="${prod}/epics/${epic}"
  if [ -z "$product_rel" ] || [ ! -d "$prod" ]; then
    echo "PASS [reconcile-debt]: ${short} ${task} -> ${epic} (product repo not reachable — debt check deferred)."
    continue
  fi
  # A Product that WAS reached with no such epic is an orphan story link, as lineage-check and epic-open
  # say — not "not reachable" (E117 review 2).
  if [ ! -d "$ep_dir" ]; then
    echo "FAIL [reconcile-debt]: ${short} ${task} -> epic ${epic} does not exist in the product repo (orphan story link)."
    rc=1
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
