#!/usr/bin/env bash
# contract-check gate (Phase 3 build plan §C; contract representation from Phase 2).
# The contract surface is singular and owned upstream (the product repo's locked contract.md).
# A code repo carries its quoted slice under specs/<story>/contracts/. If the diff changes that
# slice (i.e. tries to move the shared surface from inside a code repo), it MUST carry a
# `Contract-Change: yes` trailer AND the contract must have been updated/re-locked upstream first
# (link.md's pinned hash must match the product lock). Otherwise FAIL and route back to the
# architecture gate. Normal implementation that only CONSUMES the contract passes untouched.
set -euo pipefail

BASE="${1:-${SDLC_BASE:-origin/main}}"

# Fail CLOSED if the base ref can't be resolved (shallow clone / wrong base branch / unfetched ref).
# Never let an undiffable range silently report "no surface change" — that would green-light a bypass.
if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [contract-check]: base ref '${BASE}' not found — fetch full history / check the base branch."
  exit 1
fi
RANGE="${BASE}..HEAD"

changed="$(git diff --name-only "$RANGE")"
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
story="$(printf '%s\n' "$surface" | head -1 | sed -E 's#^specs/([^/]+)/contracts/.*#\1#')"
link="specs/${story}/link.md"
if [ -f "$link" ]; then
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
    current="$(sed -nE 's/.*"hash":[[:space:]]*"sha256:([0-9a-f]+)".*/\1/p' "$lock" | head -1)"
    if [ -n "$current" ] && [ "$current" != "$pinned" ]; then
      echo "FAIL [contract-check]: Contract-Change claimed, but ${link} still pins ${pinned:0:12}…"
      echo "  while the product lock is ${current:0:12}… — re-run yad-spec so the slice matches the re-locked contract."
      exit 1
    fi
    echo "note [contract-check]: link.md hash matches the product lock (${current:0:12}…)."
  else
    # Say so. A skipped fidelity check used to be indistinguishable from a passed one, which is how a
    # mis-resolved product-repo could turn a stale-pin FAIL into a silent PASS (issue #149).
    echo "note [contract-check]: product lock not reachable at ${lock:-<no product-repo in link.md>} — fidelity check deferred."
  fi
else
  echo "note [contract-check]: no ${link} — fidelity check deferred (spec-link gates the link itself)."
fi

echo "PASS [contract-check]: surface change accompanied by Contract-Change: yes (and an updated contract)."
exit 0
