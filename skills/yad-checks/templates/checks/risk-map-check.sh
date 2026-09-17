#!/usr/bin/env bash
# risk-map check (E65). Reads this repo's `.sdlc/risk-map` — one line per directory giving it a risk
# level (high / medium / low), no names — and WARNS when the map has gone stale for the change in front
# of it. It never fails the build: nothing counts the map until E66, and a warning is how a team keeps
# it true. No AI and no Node: the same map and the same diff give the same output on every run.
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
[ -n "${1:-}" ] || [ -n "${SDLC_BASE:-}" ] || echo "note [risk-map]: no base given — diffing against '${BASE}'."

MAP=".sdlc/risk-map"
if [ ! -f "$MAP" ]; then
  echo "note [risk-map]: this repo has no ${MAP} — no directory has a risk level yet."
  echo "  -> From the Product: \`yad risk-map draft <repo>\`, then let yad-connect-repos classify it, and commit it here."
  echo "PASS [risk-map]: advisory — nothing to check."
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# core.quotePath=false: a path holding a non-ASCII byte is printed as it is, not quoted and escaped, so
# it compares against the map's directories.
git -c core.quotePath=false ls-files > "$tmp/files"
# The base is advisory here, so an unresolvable one does not fail the check the way it fails the
# blocking gates: the map's own lines are still checked, and the per-change warnings are skipped.
if git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  git -c core.quotePath=false diff --name-only --diff-filter=ACMR "${BASE}..HEAD" > "$tmp/changed"
else
  echo "note [risk-map]: base ref '${BASE}' not found — checking the map's own lines only, not this change."
  : > "$tmp/changed"
fi

awk -v mapf="$MAP" -v filesf="$tmp/files" -v changedf="$tmp/changed" '
function problem(code, target, msg) { np++; pc[np] = code; pt[np] = target; pm[np] = msg }
function warn(code, target, msg) {
  nw++
  if (target == "") printf "WARN [risk-map] %s: %s\n", code, msg
  else printf "WARN [risk-map] %s %s: %s\n", code, target, msg
}
function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
function validdir(d,   body, n, segs, k) {
  if (d == "./") return 1
  if (d !~ /\/$/ || substr(d, 1, 1) == "/" || index(d, "//")) return 0
  if (index(d, "*") || index(d, "?") || index(d, "[") || index(d, "\\")) return 0
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
      v = line; sub(/^.*v/, "", v); v = trim(v) + 0
      if (v != 1) unsupported = v
      next
    }
  }
  if (unsupported) next
  if (line ~ /^@[A-Za-z0-9_-]/ || line ~ /[ \t]@[A-Za-z0-9_-]/)
    problem("names", "line " FNR, "names a person (`@…`) — the map holds directories and levels only")
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
END {
  if (unsupported) {
    warn("version", "v" unsupported, "written for risk-map v" unsupported "; this release reads v1 — nothing in it was read")
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
    for (i = 1; i <= na2; i++) warn("uncovered", ask[i], "no line gives this directory a level")
    for (j = 1; j <= nc; j++) if (fc[j] == ".sdlc/risk-map") { warn("map-edited", ".sdlc/risk-map", "this change edits the risk map, which decides how much review later changes need"); break }
  }
  if (nw) printf "PASS [risk-map]: %d warning(s) — advisory, never blocks a merge. Fix the map in this change.\n", nw
  else print "PASS [risk-map]: every file this change touches has a confirmed level."
}
' "$MAP" "$tmp/files" "$tmp/changed"
