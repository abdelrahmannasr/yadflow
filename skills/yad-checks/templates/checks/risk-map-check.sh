#!/usr/bin/env bash
# risk-map check (E65, E66). Reads this repo's `.sdlc/risk-map` — one line per directory giving it a
# risk level (high / medium / low), no names — and WARNS when the map has gone stale for the change in
# front of it. It never fails the build: a warning is how a team keeps the map true. No AI and no Node:
# the same map and the same diff give the same output on every run.
#
# It also COUNTS (E66): a change touching a `high` directory adds the high step, +1 approver, printed as
# a `COUNT [risk-map]:` line. The count reads the map on the BASE branch, never this change's copy, so a
# change cannot lower its own count by editing the map. It is reported, not enforced: only the base of
# one approver holds a merge until the capacity cap (E72). A `guessed` level counts as a `confirmed` one;
# an `unset` line and an uncovered directory add nothing. The change's files for the count include
# deleted and moved-away files — deleting code in a `high` directory is a `high` change.
#
#   risk-map-check.sh [<base>]           the warnings, then the count (CI runs this on every PR)
#   risk-map-check.sh --level [<base>]   the count only, as machine lines, for checks/risk-route.sh:
#                                          BASE <ref>
#                                          UNKNOWN <why>      the level could not be read — not zero
#                                          NOMAP <why>        the base has no map: nothing adds a step
#                                          FILES <n>          how many files the change touches
#                                          LEVEL <high|medium|low|none>
#                                          DIR <dir> <level> <guessed|confirmed>   one per touched line
#
# It warns about:
#   uncovered   a file this change adds or edits that no line covers — names the directory to add
#   dead        a line whose directory holds no file any more
#   unset       a line this change touches that has no level yet
#   guessed     a line this change touches whose level is still a guess (a person confirms it)
#   unreadable  a line that is not `<dir>/ <level> <guessed|confirmed>`; `names` for an `@login`;
#               `duplicate` for a directory listed twice; `header` / `version` for the first line
#   map-edited  this change edits the map itself, which decides how much review later changes need
#
# The rules have a twin in cli/riskmap.mjs (`yad risk-map check`, `yad doctor`). Change one, change the
# other: a test runs both over the same repos and compares what they report.
set -euo pipefail
# Bytes, not characters, for every tool below: a Mac `tr` in a UTF-8 locale dies on a path that is not
# valid UTF-8 ("Illegal byte sequence"), which pipefail would turn into a failing exit, and a UTF-8-aware
# awk (macOS 26's) splits some non-ASCII whitespace differently from mawk, older awks and cli/riskmap.mjs.
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

LEVEL_ONLY=0
if [ "${1:-}" = "--level" ]; then LEVEL_ONLY=1; shift; fi

MAP=".sdlc/risk-map"
# Advisory means exit 0 on every input — outside a git repo too, where `set -e` would stop at git.
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [ "$LEVEL_ONLY" = 1 ]; then echo "UNKNOWN not inside a git repo"; exit 0; fi
  echo "note [risk-map]: not inside a git repo — nothing to check."
  echo "PASS [risk-map]: advisory — nothing to check."
  exit 0
fi

# Every path below is from the repo root — the map, the file list, `.sdlc/hub.json` — so a run from a
# subfolder reads the same repo as CI does, which always runs at the root.
cd "$(git rev-parse --show-toplevel)"

BASE="${1:-${SDLC_BASE:-$(resolve_base)}}"
[ "$LEVEL_ONLY" = 1 ] || [ -n "${1:-}" ] || [ -n "${SDLC_BASE:-}" ] || echo "note [risk-map]: no base given — diffing against '${BASE}'."
base_ok=0
# A usable base resolves AND shares history with HEAD: the three-dot range below needs a merge base,
# which a shallow clone (a host GIT_DEPTH) or unrelated history does not have — git would exit 128.
if git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null && git merge-base "$BASE" HEAD >/dev/null 2>&1; then
  base_ok=1
fi
# The change is measured from where this branch left the base (three dots), not against the base's
# tip: when the base has moved on, a two-dot range would blame this change for the base's own commits
# (the risk map's warnings are about what THIS change touches).
RANGE="${BASE}...HEAD"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The map's rules, in awk: read by the warnings below over this change's copy of the map, and by the
# count over the BASE branch's copy (`mode=level`). One program, so the two can never read a line
# differently. Its twin is cli/riskmap.mjs.
RISK_MAP_AWK='
function problem(code, target, msg) { np++; pc[np] = code; pt[np] = target; pm[np] = msg }
function warn(code, target, msg) {
  nw++
  if (target == "") printf "WARN [risk-map] %s: %s\n", code, msg
  else printf "WARN [risk-map] %s %s: %s\n", code, target, msg
}
function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
function validdir(d,   body, n, segs, k) {
  if (d == "./") return 1
  if (d !~ /\/$/ || substr(d, 1, 1) == "/" || substr(d, 1, 1) == "#" || index(d, "//")) return 0
  if (index(d, "*") || index(d, "?") || index(d, "[") || index(d, "\\") || index(d, " ") || index(d, "\t") || index(d, "\r")) return 0
  body = substr(d, 1, length(d) - 1)
  n = split(body, segs, "/")
  for (k = 1; k <= n; k++) if (segs[k] == "." || segs[k] == "..") return 0
  return 1
}
function cover(f,   i, best, bl) {
  if (index(f, "/") == 0) { for (i = 1; i <= ne; i++) if (ed[i] == "./") return i; return 0 }
  best = 0; bl = 0
  for (i = 1; i <= ne; i++)
    if (ed[i] != "./" && substr(f, 1, length(ed[i])) == ed[i] && length(ed[i]) > bl) { best = i; bl = length(ed[i]) }
  return best
}
function toadd(f,   n, segs, prefix, k, cand, i, deeper) {
  n = split(f, segs, "/")
  if (n == 1) return "./"
  prefix = ""
  for (k = 1; k < n; k++) {
    cand = prefix segs[k] "/"
    if (!validdir(cand)) return (prefix != "") ? prefix : cand
    deeper = 0
    for (i = 1; i <= ne; i++) if (ed[i] != cand && substr(ed[i], 1, length(cand)) == cand) { deeper = 1; break }
    if (!deeper) return cand
    prefix = cand
  }
  return prefix
}
FILENAME == mapf {
  line = $0; sub(/\r$/, "", line)
  if (line ~ /^[ \t]*$/) next
  if (!seenfirst) {
    seenfirst = 1
    if (line ~ /^#[ \t]*yad-risk-map[ \t]+v[0-9]+[ \t]*$/) {
      header = 1
      # Compared as TEXT, leading zeros dropped: `v0` is not 1, and a huge number prints as written.
      v = line; sub(/^.*v/, "", v); v = trim(v); sub(/^0+/, "", v); if (v == "") v = "0"
      if (v != "1") { unsupported = 1; badv = v }
      next
    }
  }
  if (unsupported) next
  # A word starting `@x` names a person — `@org/team` too — unless it ends in `/` (a directory: `@types/`).
  nw2 = split(line, words, /[ \t]+/); named = 0
  for (k = 1; k <= nw2; k++) if (words[k] ~ /^@[A-Za-z0-9_-]/ && words[k] !~ /\/$/) named = 1
  if (named) problem("names", "line " FNR, "names a person (`@…`) — the map holds directories and levels only")
  if (line ~ /^[ \t]*#/) next
  body = line
  if (match(line, /[ \t]#/)) body = substr(line, 1, RSTART - 1)
  body = trim(body)
  nf = split(body, f, /[ \t]+/)
  if (nf < 2 || nf > 3) { problem("unreadable", "line " FNR, "expected `<dir>/ <level> <guessed|confirmed>`"); next }
  dir = f[1]; level = f[2]; state = (nf == 3) ? f[3] : ""
  if (!validdir(dir)) { problem("unreadable", "line " FNR, "`" dir "` is not a directory from the repo root ending in `/`"); next }
  if (level != "high" && level != "medium" && level != "low" && level != "unset") { problem("unreadable", "line " FNR, "`" level "` is not a level (high, medium, low or unset)"); next }
  if (level == "unset" && state == "confirmed") { problem("unreadable", "line " FNR, "an `unset` line cannot be `confirmed`"); next }
  if ((level == "unset" && state != "" && state != "guessed") || (level != "unset" && state != "guessed" && state != "confirmed")) {
    problem("unreadable", "line " FNR, "the third field must be `guessed` or `confirmed`"); next
  }
  if (dir in listed) { problem("duplicate", "line " FNR, "`" dir "` is listed again — the first line wins"); next }
  listed[dir] = 1
  ne++; ed[ne] = dir; el[ne] = level; es[ne] = (level == "unset") ? "" : state
  next
}
FILENAME == filesf { na++; fa[na] = $0; next }
FILENAME == changedf { nc++; fc[nc] = $0; next }
function rank(l) { return (l == "high") ? 3 : (l == "medium") ? 2 : (l == "low") ? 1 : 0 }
# E66, the --level mode: the level this change takes from the map (the twin of `changeLevel` in
# cli/riskmap.mjs). The highest level among the lines that decide the changed files; `unset` and an
# uncovered file add nothing; `guessed` counts as `confirmed`. Parse problems add nothing either.
function level_out(   j, k, i, best) {
  if (unsupported) { print "UNKNOWN the map on the base is written for risk-map v" badv " and this release reads v1"; return }
  for (j = 1; j <= nc; j++) { k = cover(fc[j]); if (k && el[k] != "unset") lt[k] = 1 }
  best = ""
  for (i = 1; i <= ne; i++) if ((i in lt) && rank(el[i]) > rank(best)) best = el[i]
  print "FILES " (nc + 0)
  print "LEVEL " ((best == "") ? "none" : best)
  for (i = 1; i <= ne; i++) if (i in lt) print "DIR " ed[i] " " el[i] " " es[i]
}
END {
  if (mode == "level") { level_out(); exit }
  if (unsupported) {
    warn("version", "v" badv, "written for risk-map v" badv "; this release reads v1 — nothing in it was read")
  } else {
    if (seenfirst && !header) warn("header", "", "no `# yad-risk-map v1` line at the top — read as version 1")
    for (i = 1; i <= np; i++) warn(pc[i], pt[i], pm[i])
    for (i = 1; i <= ne; i++) {
      holds = 0
      for (j = 1; j <= na; j++) {
        if (ed[i] == "./") { if (index(fa[j], "/") == 0) { holds = 1; break } }
        else if (substr(fa[j], 1, length(ed[i])) == ed[i]) { holds = 1; break }
      }
      if (!holds) warn("dead", ed[i], "no file is in this directory any more — remove the line or fix the path")
    }
    for (j = 1; j <= nc; j++) { k = cover(fc[j]); if (k) touched[k] = 1 }
    for (i = 1; i <= ne; i++) if ((i in touched) && el[i] == "unset") warn("unset", ed[i], "has no level yet")
    for (i = 1; i <= ne; i++) if ((i in touched) && es[i] == "guessed") warn("guessed", ed[i], "`" el[i] "` is still a guess — a person confirms it")
    na2 = 0
    for (j = 1; j <= nc; j++) {
      if (cover(fc[j])) continue
      d = toadd(fc[j])
      if (!(d in asked)) { asked[d] = 1; na2++; ask[na2] = d }
    }
    for (i = 1; i <= na2; i++) {
      if (validdir(ask[i])) warn("uncovered", ask[i], "no line gives this directory a level")
      else warn("uncovered", ask[i], "no line gives this directory a level, and its name cannot be written in the map (a space, `#`, `*`, `?`, `[` or `\\`) — rename it")
    }
    for (j = 1; j <= nc; j++) if (fc[j] == ".sdlc/risk-map") { warn("map-edited", ".sdlc/risk-map", "this change edits the risk map, which decides how much review later changes need"); break }
  }
  if (nw) printf "PASS [risk-map]: %d warning(s) — advisory, never blocks a merge. Fix the map in this change.\n", nw
  else print "PASS [risk-map]: every file this change touches has a confirmed level."
}
'

# The count's machine lines (see the top of this file). The map comes from the base TIP — the branch
# this change merges into, which the change cannot edit. The files come from the same three-dot range
# as the warnings, with every kind of change kept: a deleted or moved-away file counts where it was.
base_level() {
  echo "BASE ${BASE}"
  if [ "$base_ok" != 1 ]; then echo "UNKNOWN base ref '${BASE}' not found, or it shares no history with HEAD (a shallow clone?)"; return; fi
  # Only a real file on the base is a map: a symlink or a folder of that name is not read (git would
  # print a symlink's target as if it were the map's text). --full-tree: ls-tree reads a path from the
  # current folder, and run from a subfolder it would find no map and quietly count zero.
  _entry="$(git ls-tree --full-tree "$BASE" -- "$MAP")" || { echo "UNKNOWN git could not read the tree of '${BASE}'"; return; }
  case "$_entry" in
    "100644 blob "*|"100755 blob "*) ;;
    "") echo "NOMAP '${BASE}' has no ${MAP}"; return ;;
    *) echo "NOMAP '${BASE}' holds ${MAP}, but not as a file"; return ;;
  esac
  # Explicit guards, not `set -e`: the CI count runs this inside `$(...)`, where bash does not stop on a
  # failing command, and an unread map or a cut-short file list would print a false zero.
  git show "${BASE}:${MAP}" > "$tmp/basemap" || { echo "UNKNOWN git could not read ${MAP} on '${BASE}'"; return; }
  if ! git diff --name-only -z --no-renames "$RANGE" | tr '\0' '\n' > "$tmp/all-changed"; then
    echo "UNKNOWN git could not list the files this change touches"; return
  fi
  awk -v mode=level -v mapf="$tmp/basemap" -v filesf=/dev/null -v changedf="$tmp/all-changed" "$RISK_MAP_AWK" "$tmp/basemap" /dev/null "$tmp/all-changed"
}

if [ "$LEVEL_ONLY" = 1 ]; then base_level; exit 0; fi

# The count, said on every PR. Reported, never enforced: it is how many approvers the change ASKS for.
lv="$(base_level)"
dirs_of() { printf '%s\n' "$lv" | awk -v want="$1" '$1 == "DIR" && $3 == want { printf "%s%s%s", sep, $2, ($4 == "guessed") ? " (guessed)" : ""; sep = ", " }'; }
case "$lv" in
  *"
UNKNOWN "*)
    echo "note [risk-map]: not counted — $(printf '%s\n' "$lv" | sed -n 's/^UNKNOWN //p'). The count from the map is unknown, not zero." ;;
  *"
NOMAP "*)
    echo "COUNT [risk-map]: 1 approver = base 1 — $(printf '%s\n' "$lv" | sed -n 's/^NOMAP //p'), so no directory adds a step." ;;
  *)
    high="$(dirs_of high)"; medium="$(dirs_of medium)"
    if [ -n "$high" ]; then
      echo "COUNT [risk-map]: 2 approvers = base 1 + high risk 1 (high on ${BASE}: ${high}) — only the base holds the merge until the capacity cap."
    else
      echo "COUNT [risk-map]: 1 approver = base 1 — nothing this change touches is high on ${BASE}."
    fi
    [ -z "$medium" ] || echo "  medium on ${BASE} (reported only, adds nothing): ${medium}"
    ;;
esac

if [ ! -f "$MAP" ]; then
  # Deleting the map is the largest edit to it there is, so it is said, not passed over as "no map".
  # Asked of git by path, with no pipe to cut short. --no-renames: a move away (even into a folder the
  # pathspec also matches, `.sdlc/risk-map/x`) is a delete. T: a map turned into a symlink is gone too.
  # The exact line is matched, because the pathspec also matches files under a FOLDER of that name.
  deleted=""
  [ "$base_ok" = 1 ] && deleted="$(git diff --name-only --no-renames --diff-filter=DT "$RANGE" -- "$MAP")"
  nl='
'
  case "${nl}${deleted}${nl}" in *"${nl}${MAP}${nl}"*)
    echo "WARN [risk-map] map-edited ${MAP}: this change deletes the risk map, which decides how much review later changes need"
    echo "PASS [risk-map]: 1 warning(s) — advisory, never blocks a merge."
    exit 0 ;;
  esac
  echo "note [risk-map]: this repo has no ${MAP} — no directory has a risk level yet."
  echo "  -> From the Product: \`yad risk-map draft <repo>\`, then let yad-connect-repos classify it, and commit it here."
  echo "PASS [risk-map]: advisory — nothing to check."
  exit 0
fi

# -z, then NUL to newline: git prints each path exactly as it is, never quoted or escaped (quotePath
# only stops escaping non-ASCII — a `"`, `\` or tab would still arrive wrapped in quotes). awk reads the
# lines; macOS awk cannot split records on NUL itself.
git ls-files -z | tr '\0' '\n' > "$tmp/files"
# The base is advisory here, so an unresolvable one does not fail the check the way it fails the
# blocking gates: the map's own lines are still checked, and the per-change warnings are skipped.
if [ "$base_ok" = 1 ]; then
  # T: a file replaced by a symlink (or back) is an edit too — the map included.
  git diff --name-only -z --diff-filter=ACMRT "$RANGE" | tr '\0' '\n' > "$tmp/changed"
else
  echo "note [risk-map]: base ref '${BASE}' not found, or shares no history with HEAD (a shallow clone?) — checking the map's own lines only, not this change."
  : > "$tmp/changed"
fi

awk -v mapf="$MAP" -v filesf="$tmp/files" -v changedf="$tmp/changed" "$RISK_MAP_AWK" "$MAP" "$tmp/files" "$tmp/changed"
