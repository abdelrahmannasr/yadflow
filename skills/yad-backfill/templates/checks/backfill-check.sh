#!/usr/bin/env bash
# backfill gate (Phase 3 build plan §G). A change that touches a feature being backfilled must wait
# until that feature's backfill spec is human-approved (verified: true). Gated PER touched feature, not
# the whole repo: touching feature A is never blocked by an unverified feature B. Features that are
# forward-spec'd (their own specs/<story>/) or not yet being backfilled are not this gate's concern.
# The spec and its approval are read from the BASE, and a link where a backfilled feature lives is
# refused (E116).
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
[ -n "${1:-}" ] || [ -n "${SDLC_BASE:-}" ] || echo "note [backfill]: no base given — diffing against '${BASE}'."
if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [backfill]: base ref '${BASE}' not found — fetch full history / check the base branch."
  exit 1
fi


# Folded as macOS and Windows fold a name (E116, as E115): `Src/` IS `src/` there, and `src/Billing/` IS
# `src/billing/`, while git and Linux CI read exact bytes. `tolower` under LC_ALL=C folds ASCII only, so
# every character APFS folds (full case folding, then NFD) into ASCII alone is mapped by hand, as bytes —
# all 13 of them, from Unicode's own tables (reviews 4 and 5): ß and ẞ into `ss`, ſ into `s`, the
# Kelvin sign into `k`, the ligatures ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ into their letters, and the Greek question mark and
# varia into `;` and `` ` ``. So `src/claß/` IS `src/class/` on a Mac, and is read so here. Not folded,
# and stated: characters that fold into other non-ASCII ones (`CAFÉ` is `café` on a Mac) and NFC/NFD
# twins; awk cannot fold them, and refusing every non-ASCII feature name would refuse real repos (E115
# made the same call).
FOLD='function fold(x) { x = tolower(x)
  gsub(/\303\237|\341\272\236/, "ss", x); gsub(/\305\277/, "s", x); gsub(/\342\204\252/, "k", x)
  gsub(/\357\254\200/, "ff", x); gsub(/\357\254\201/, "fi", x); gsub(/\357\254\202/, "fl", x)
  gsub(/\357\254\203/, "ffi", x); gsub(/\357\254\204/, "ffl", x); gsub(/\357\254\205|\357\254\206/, "st", x)
  gsub(/\315\276/, ";", x); gsub(/\341\277\257/, "`", x); return x }'

# Which features are being backfilled is read from the BASE, never from the PR (E116). Read from the
# PR, the gate let a PR approve itself: it could set `verified: true` in the same PR, or delete the spec
# so the feature read as "not being backfilled". So a spec, and its approval, count once they are merged.
# The whole tree, folded: on a Mac checkout `Specs/backfill/Billing/spec.md` is the spec of `billing`.
# A symlink or submodule where the specs live hides what the spec says: at `specs/backfill/<f>` or its
# spec.md, <f> counts as being backfilled and unapproved; at `specs` or `specs/backfill`, the gate cannot
# tell which features are, so every src/<feature> change fails until one PR puts real files back (that PR
# changes no feature, so it passes).
# `tr '\n\0' '?\n'`: one record per line, and a newline inside a path becomes `?` — split on newlines
# alone, a file named `notes<newline>100644 blob 0<TAB>src/Billing/y` added a record nobody made (review 2).
base_tree="$(git ls-tree -r -z --full-tree "$BASE" | tr '\n\0' '?\n')" || {
  echo "FAIL [backfill]: git could not read the tree of '${BASE}' — the gate cannot tell which features are being backfilled."
  exit 1
}
# One line each: `S <oid> <path>` a spec to read, `U - <path>` a link where a spec goes, `A - <path>` a
# link above. A spec is read by its object id, never by its path again: with a newline written as `?`,
# `x?y/spec.md` and `x<newline>y/spec.md` are one path here, and reading `<base>:x?y/spec.md` twice let
# an approved spec stand in for an unapproved one (review 3).
specs="$(printf '%s\n' "$base_tree" | awk "$FOLD"'
  { t = index($0, "\t"); if (!t) next; p = substr($0, t + 1); m = substr($0, 1, 6); lp = fold(p); split(substr($0, 1, t - 1), h, " ") }
  lp !~ /^specs(\/backfill(\/[^\/]+(\/spec\.md)?)?)?$/ { next }
  m == "120000" || m == "160000" { print (lp ~ /^specs\/backfill\/[^\/]+/ ? "U - " : "A - ") p; next }
  lp ~ /^specs\/backfill\/[^\/]+\/spec\.md$/ { print "S " h[3] " " p }
')"
blind="$(printf '%s\n' "$specs" | sed -n 's/^A - //p')"
# The folded names of the features being backfilled, one per line.
bf="$(printf '%s\n' "$specs" | sed -n 's/^[SU] [^ ]* //p' | awk "$FOLD"'{ split($0, c, "/"); print fold(c[3]) }' | sort -u)"

# No symlink, no submodule and no second spelling where a feature being backfilled lives (E116). The
# gate reads PATHS: with a link at `src/<feature>` (or `src`, or inside the feature) the code lives
# where no path under src/ names it, so every later edit to the link's target passed. Read from the tree
# at HEAD, on EVERY PR and before the "no src/<feature> changes" PASS — an edit to the target changes no
# path under src/ at all. Links elsewhere in src/ are not this gate's concern: a code repo may hold real
# ones. 120000 is a symlink, 160000 a submodule; `-r` lists `src` itself when `src` is the link. When
# the base hides its specs behind a link (`blind`), every folder under src/ is taken as backfilled here.
# A second spelling is two spellings of one folder at HEAD at once (`Src/billing/` beside `src/billing/`,
# or `src/Billing/` beside it): one folder on macOS and Windows, two on Linux CI. A lone `Src/` clashes
# with nothing, and is read as `src/`.
# Lists go to awk IN the stream, each line tagged, never through the environment: a list of every
# src/ folder passed as a variable hit the size limit ("Argument list too long") in a large repo and
# failed every PR there (review 2). `tagged T "$list"` prints `T<TAB><line>` for each line that is not
# empty.
tagged() { printf '%s\n' "$2" | awk -v t="$1" 'length($0) { print t "\t" $0 }'; }
head_tree="$(git ls-tree -r -z --full-tree HEAD | tr '\n\0' '?\n')" || {
  echo "FAIL [backfill]: git could not read the tree at HEAD — the gate cannot check src/ for links."
  exit 1
}
if [ -n "$bf" ] || [ -n "$blind" ]; then
  bad="$({ tagged B "$bf"; printf '%s\n' "$head_tree"; } | ALL="${blind:+1}" awk "$FOLD"'
    function once(k, s) { if (!(k in done)) { done[k] = 1; print "  " s } }
    BEGIN { all = (ENVIRON["ALL"] != "") }
    /^B\t/ { bf[substr($0, 3)] = 1; next }
    { t = index($0, "\t"); if (!t) next; p = substr($0, t + 1); m = substr($0, 1, 6); lp = fold(p); ln = (m == "120000" || m == "160000") }
    lp == "src" && ln { print "  " p (m == "120000" ? " (a symlink" : " (a submodule") ", where the src/ folder goes)"; next }
    lp !~ /^src\// { next }
    { split(p, c, "/"); f = fold(c[2]) }
    !all && !(f in bf) { next }
    { s = c[1] "/" c[2] }
    (f in sp) && sp[f] != s { once("f/" f "/" s, sp[f] " and " s " (one name on macOS and Windows)") }
    !(f in sp) { sp[f] = s }
    m == "120000" { print "  " p " (symlink)"; next }
    m == "160000" { print "  " p " (submodule)"; next }
  ')"
  if [ -n "$bad" ]; then
    echo "FAIL [backfill]: src/ holds a symlink, a submodule or a second spelling where a feature being backfilled lives — this gate cannot see what changes behind it:"
    printf '%s\n' "$bad"
    echo "  -> put the real files in place of each link, and keep one spelling of each folder. A PR that only"
    echo "     removes a link, or every file of one spelling, passes; until then every PR in this repo fails,"
    echo "     because an edit to the link's target changes no path under src/."
    if [ -n "$blind" ]; then
      echo "     On the base, $(printf '%s' "$blind" | head -n 1) is a symlink or submodule, so the gate cannot tell which"
      echo "     features are being backfilled and checks EVERY folder under src/ — a link above may belong to no"
      echo "     backfilled feature. Remove it in the PR that puts the real specs back; add it back after."
    fi
    exit 1
  fi
fi

# --no-renames (E114): a rename is listed by BOTH paths. Without it git names a rename by its NEW path
# only, so `git mv src/<feature>/x.js lib/x.js` took the file out of a feature being backfilled and the
# gate never saw the feature. -z | tr: NUL-separated, so git never quotes a path — a quoted one (any
# non-ASCII byte by default; a `"` or a tab always) never matched src/<feature>/ below. --raw gives each
# path after a record with its modes and status; with --no-renames every change has exactly one path.
# The two are paired here, NUL by NUL, into one line — `<modes and status><TAB><path>` — and a newline
# inside a path becomes `?`: split into lines first, one file named `a<newline>b` put every later header
# where its path should be, and every src/<feature> change after it was never seen (review 1).
changed="$(git diff --no-renames --raw -z "${BASE}..HEAD" | while IFS= read -r -d '' h && IFS= read -r -d '' p; do
  printf '%s\t%s\n' "$h" "${p//$'\n'/?}"
done)" || {
  echo "FAIL [backfill]: git could not list the changes between '${BASE}' and HEAD."
  exit 1
}
# The spellings of each src/<feature> folder, on the base and at HEAD: `<top>/<feature>`, once each.
spellings() {
  awk "$FOLD"'{ t = index($0, "\t"); if (!t) next; p = substr($0, t + 1); if (fold(p) !~ /^src\/[^\/]+\//) next
    split(p, c, "/"); s = c[1] "/" c[2]; if (!(s in seen)) { seen[s] = 1; print s } }'
}
base_sp="$(printf '%s\n' "$base_tree" | spellings)"
head_sp="$(printf '%s\n' "$head_tree" | spellings)"
# Feature = a directory under src/ (src/<feature>/...), folded (E116). A path that IS `src/<feature>` — a
# link, a submodule or a file put where the folder goes — is that feature too. Top-level src/*.js files
# are deliberately NOT gated here (they belong to no single feature), so a path that IS `src/<name>`
# counts only as a link or a submodule (either side), or when <name> is being backfilled. A deleted
# symlink or submodule is not a change to the feature: removing the link is how a repo gets out of the
# refusal above, and the spec's approval may itself be waiting on that PR. For the same reason a file
# deleted from one spelling of a folder the base held in two, when that spelling is gone at HEAD, is not
# a change either (review 1): without it, neither removing the twin nor approving the spec could pass.
# Only while ANOTHER spelling of that folder is still there at HEAD (review 2): deleting both spellings
# deletes the feature, and that is a change to it. (A diff header starts with `:`, so the tags below
# cannot be mistaken for one.)
feats="$({ tagged B "$bf"; tagged S "$base_sp"; tagged H "$head_sp"; printf '%s\n' "$changed"; } | awk "$FOLD"'
  /^B\t/ { bf[substr($0, 3)] = 1; next }
  /^S\t/ { cnt[fold(substr($0, 3))]++; next }
  /^H\t/ { here[substr($0, 3)] = 1; still[fold(substr($0, 3))] = 1; next }
  { t = index($0, "\t"); if (!t) next; h = substr($0, 1, t - 1); p = substr($0, t + 1); lp = fold(p) }
  lp !~ /^src\/./ { next }
  { split(h, w, " "); om = substr(w[1], 2); nm = w[2]; ln = (om ~ /^1[26]0000$/ || nm ~ /^1[26]0000$/) }
  w[5] == "D" && ln { next }
  { k = split(p, c, "/"); f = fold(c[2]); s = c[1] "/" c[2] }
  w[5] == "D" && k > 2 && cnt[fold(s)] > 1 && !(s in here) && (fold(s) in still) { next }
  k > 2 || ln || (f in bf) { print f }
' | sort -u)"

if [ -z "$feats" ]; then
  echo "PASS [backfill]: no src/<feature> changes."
  exit 0
fi

rc=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if [ -n "$blind" ]; then
    echo "FAIL [backfill]: cannot tell whether ${f} is being backfilled — on the base, $(printf '%s' "$blind" | head -n 1) is a symlink or submodule, so the specs behind it are not read."
    echo "  -> put the real specs/backfill/ folder back in its own PR first."
    rc=1
    continue
  fi
  mine="$(printf '%s\n' "$specs" | F="$f" awk "$FOLD"'/^[SU] / { r = substr($0, 3); split(substr(r, index(r, " ") + 1), c, "/"); if (fold(c[3]) == ENVIRON["F"]) print }')"
  if [ -z "$mine" ]; then
    echo "note [backfill]: ${f} is not being backfilled (no specs/backfill/${f}/spec.md on the base) — skipped."
    continue
  fi
  ok=1
  while IFS= read -r l; do
    rest="${l#? }"; oid="${rest%% *}"; spec="${rest#* }"
    case "$l" in
      U\ *) echo "FAIL [backfill]: ${f} is being backfilled, but on the base ${spec} is a symlink or submodule — its spec is not read."
            echo "  -> put the real spec there in its own PR first."
            ok=0; continue ;;
    esac
    # Read ONLY the YAML frontmatter (between the first two --- lines) so a prose line that merely
    # contains "verified: true" cannot false-pass the gate — and only once it closes: a spec that opens
    # `---` and never closes it has no frontmatter, or a body line would count (review 5). Read to the end,
    # never stopped early: under pipefail a closed pipe would read a long approved spec as unapproved.
    fm="$(git cat-file blob "$oid" 2>/dev/null | awk 'NR==1 && /^---[[:space:]]*$/ {f=1; next} f==1 && /^---[[:space:]]*$/ {f=2; next} f==1 {b = b $0 "\n"} END {if (f == 2) printf "%s", b}')" || fm=""
    # The LAST `verified:` line, as YAML reads a repeated key (review 6): `true` then `false` is false.
    last="$(printf '%s\n' "$fm" | grep -iE '^verified:' | tail -n 1)" || last=""
    if ! printf '%s\n' "$last" | grep -qiE '^verified:[[:space:]]*true[[:space:]]*$'; then
      echo "FAIL [backfill]: ${f} is being backfilled but its spec is not yet human-approved (verified: true) on the base."
      echo "  -> run yad-backfill approve for ${spec} and merge that first: the gate reads the spec"
      echo "     as it stands on the base, so an approval in this same PR does not count."
      ok=0
    fi
  done <<EOF
$mine
EOF
  if [ "$ok" = 1 ]; then echo "PASS [backfill]: ${f} has an approved (verified) backfill spec."; else rc=1; fi
done <<EOF
$feats
EOF
exit "$rc"
