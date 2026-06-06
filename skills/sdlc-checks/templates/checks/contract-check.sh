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
  echo "     re-run sdlc-spec, then implement with Contract-Change: yes. The surface is never widened"
  echo "     from inside a code repo."
  exit 1
fi

# Fidelity check (best-effort): when the product repo is reachable, the story's link.md must pin the
# CURRENT product lock — proof the contract was actually updated/re-locked upstream, not just flagged.
story="$(printf '%s\n' "$surface" | head -1 | sed -E 's#^specs/([^/]+)/contracts/.*#\1#')"
link="specs/${story}/link.md"
if [ -f "$link" ]; then
  product_rel="$(sed -nE 's/^product-repo:[[:space:]]*(.*)$/\1/p' "$link" | head -1)"
  pinned="$(sed -nE 's/^contract-lock:[[:space:]]*sha256:([0-9a-f]+).*$/\1/p' "$link" | head -1)"
  epic="$(printf '%s' "$story" | sed -E 's/-S[0-9]+$//')"   # story EP-<slug>-S0N -> epic EP-<slug>
  lock="${product_rel}/epics/${epic}/.sdlc/contract-lock.json"
  if [ -n "$product_rel" ] && [ -f "$lock" ]; then
    current="$(sed -nE 's/.*"hash":[[:space:]]*"sha256:([0-9a-f]+)".*/\1/p' "$lock" | head -1)"
    if [ -n "$current" ] && [ "$current" != "$pinned" ]; then
      echo "FAIL [contract-check]: Contract-Change claimed, but ${link} still pins ${pinned:0:12}…"
      echo "  while the product lock is ${current:0:12}… — re-run sdlc-spec so the slice matches the re-locked contract."
      exit 1
    fi
    echo "note [contract-check]: link.md hash matches the product lock (${current:0:12}…)."
  fi
fi

echo "PASS [contract-check]: surface change accompanied by Contract-Change: yes (and an updated contract)."
exit 0
