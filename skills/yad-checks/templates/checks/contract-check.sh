#!/usr/bin/env bash
# contract-check gate (Phase 3 build plan §C; contract representation from Phase 2).
# The contract surface is singular and owned upstream (the product repo's locked contract.md).
# A code repo carries its quoted slice under specs/<story>/contracts/. If the diff changes that
# slice (i.e. tries to move the shared surface from inside a code repo), it MUST carry a
# `Contract-Change: yes` trailer AND the contract must have been updated/re-locked upstream first
# (link.md's pinned hash must match the product lock). Otherwise FAIL and route back to the
# architecture gate. Normal implementation that only CONSUMES the contract passes untouched.
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
[ -n "${1:-}" ] || [ -n "${SDLC_BASE:-}" ] || echo "note [contract-check]: no base given — diffing against '${BASE}'."

# Fail CLOSED if the base ref can't be resolved (shallow clone / wrong base branch / unfetched ref).
# Never let an undiffable range silently report "no surface change" — that would green-light a bypass.
if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [contract-check]: base ref '${BASE}' not found — fetch full history / check the base branch."
  exit 1
fi
RANGE="${BASE}..HEAD"

# core.quotePath=false: with the default ON, git wraps any path holding a non-ASCII byte in quotes
# and octal-escapes it, so a slice like specs/EP-démo-S01/contracts/api.md never matches the pattern
# below — the surface change would be invisible to the gate it exists to stop.
changed="$(git -c core.quotePath=false diff --name-only "$RANGE")"
surface="$(printf '%s\n' "$changed" | grep -E '^specs/[^/]+/contracts/' || true)"

if [ -z "$surface" ]; then
  echo "PASS [contract-check]: diff does not touch the contract surface (specs/*/contracts/**)."
  exit 0
fi

echo "note [contract-check]: diff touches the contract surface:"
printf '%s\n' "$surface" | sed 's/^/  /'

cc="$(git log "$RANGE" --format='%(trailers:key=Contract-Change,valueonly)' | sed '/^$/d' | tr 'A-Z' 'a-z')"
if ! printf '%s\n' "$cc" | grep -qx 'yes'; then
  echo "FAIL [contract-check]: contract surface changed without a 'Contract-Change: yes' trailer."
  echo "  -> Route back to the architecture gate: update + re-lock contract.md in the product repo,"
  echo "     re-run yad-spec, then implement with Contract-Change: yes. The surface is never widened"
  echo "     from inside a code repo."
  exit 1
fi

# --- shared link.md resolution (byte-identical in contract-check / lineage-check / epic-open /
# --- reconcile-debt-check; the gates are deliberately standalone, so it is duplicated, not sourced) ---
# Read one frontmatter value from the FIRST --- … --- block only. awk bounds to the first block (stops
# at the first closing fence), so a body `---` or an absent key can never leak a body line. Plain
# scalars only; trailing spaces/CR are stripped so they never become part of a path.
fm_val() { awk -v k="$1" 'NR==1 && /^---$/ {f=1; next} f && /^---$/ {exit} f && index($0, k":")==1 {sub("^" k ":[ \t]*", ""); print; exit}' "$2" 2>/dev/null | tr -d '\r' | sed -E 's/[[:space:]]+$//'; }

# Same, for a link.md field. yad-spec writes link.md WITH frontmatter, but code repos still carry
# pre-frontmatter ones that contract-check used to read with a whole-file scan — so fall back to that
# rather than silently reading an empty value and skipping the check it guards. Deliberately separate
# from fm_val: hub artifacts (epic.md, stories/*.md) stay bounded to their first block.
link_val() {
  _v="$(fm_val "$1" "$2")"
  [ -n "$_v" ] || _v="$(sed -nE "s/^$1:[[:space:]]*(.*)\$/\1/p" "$2" 2>/dev/null | head -1 | tr -d '\r' | sed -E 's/[[:space:]]+$//')"
  printf '%s' "$_v"
}

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
stories="$(printf '%s\n' "$surface" | sed -E 's#^specs/([^/]+)/contracts/.*#\1#' | sort -u)"
rc=0
while IFS= read -r story; do
  [ -z "$story" ] && continue
  link="specs/${story}/link.md"
  if [ ! -f "$link" ]; then
    echo "note [contract-check]: no ${link} — fidelity check deferred (spec-link gates the link itself)."
    continue
  fi
  product_rel="$(link_val product-repo "$link")"
  pinned="$(printf '%s' "$(link_val contract-lock "$link")" | sed -E 's/^sha256:([0-9a-f]+).*$/\1/')"
  epic="$(printf '%s' "$story" | sed -E 's/-S[0-9]+$//')"   # story EP-<slug>-S0N -> epic EP-<slug>
  prod="$(resolve_product "$product_rel" "$story")"
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
  else
    # Say so. A skipped fidelity check used to be indistinguishable from a passed one, which is how a
    # mis-resolved product-repo could turn a stale-pin FAIL into a silent PASS (issue #149).
    echo "note [contract-check]: product lock not reachable at ${lock:-<no product-repo in link.md>} — fidelity check deferred."
  fi
done <<EOF
$stories
EOF

if [ "$rc" != 0 ]; then
  echo "FAIL [contract-check]: a changed slice pins a stale contract lock (see above) — the surface was not re-locked upstream for every story in this diff."
  exit 1
fi

echo "PASS [contract-check]: surface change accompanied by Contract-Change: yes (and an updated contract)."
exit 0
