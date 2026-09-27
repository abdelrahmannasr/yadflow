#!/usr/bin/env bash
# Check the Product out where the code repo's record says (E120), so the Product-reading gates
# (contract-check, lineage-check, epic-open, reconcile-debt-check) can read it in CI.
#
# The record is `.sdlc/product-link.json` — `git_url`, `path` (from the repo root, inside the repo) and
# `default_branch` — written by `yad check --fix` / `yad update` and merged on its own. It is read from
# the BASE, never as the PR leaves it: a PR must not choose what CI clones, or where.
#
# Needs the YAD_PRODUCT_TOKEN secret (a token that can read the Product: a GitHub fine-grained token or
# App token, a GitLab project/group access token). Without it — the default, and every PR from a fork —
# nothing is cloned and the gates defer, as before. With it, a clone that fails FAILS the job: a broken
# setup must not read like a deferral.
set -euo pipefail
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
[ -n "${1:-}" ] || [ -n "${SDLC_BASE:-}" ] || echo "note [product-checkout]: no base given — reading the record from '${BASE}'."
if ! git rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null; then
  echo "FAIL [product-checkout]: base ref '${BASE}' not found — fetch full history / check the base branch."
  exit 1
fi

rec=.sdlc/product-link.json
if ! git cat-file -e "${BASE}:${rec}" 2>/dev/null; then
  echo "note [product-checkout]: no ${rec} on ${BASE} — nothing to check out; the gates read link.md as before."
  exit 0
fi
# One string value of the record on the base (a flat JSON object written by yad; no escapes in values).
field() { git show "${BASE}:${rec}" 2>/dev/null | tr -d '\n\r' | sed -nE "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"([^\"\\\\]*)\".*/\\1/p" || true; }
url="$(field git_url)"
dest="$(field path)"
branch="$(field default_branch)"

if [ -z "${YAD_PRODUCT_TOKEN:-}" ]; then
  echo "note [product-checkout]: no YAD_PRODUCT_TOKEN secret — the Product is not checked out, and the gates defer."
  echo "  To check it out here, add a token that can read the Product as the YAD_PRODUCT_TOKEN secret (CI variable)."
  exit 0
fi
if [ -z "$url" ]; then
  echo "note [product-checkout]: ${rec} on ${BASE} names no git_url — the Product is not checked out."
  echo "  Set the Product's git_url in its .sdlc/product.json, then run \`yad check --fix --push\` from the Product."
  exit 0
fi
# Inside the repo, and not the repo itself: CI can only place a checkout in the workspace, and the gates
# read an UNTRACKED folder there as CI's checkout.
case "/${dest}/" in
  //|/./|*/../*|//*|/.git/*|/.git)
    echo "FAIL [product-checkout]: ${rec} on ${BASE} says path '${dest}' — it must be a folder inside this repo, such as .yad/product."
    exit 1 ;;
esac
# And no symlink on the way (review 1): the text above is only text, and a PR can track `.yad` as a link
# to `../elsewhere` — git clone follows it, so the clone (with the token) would land where the PR chose.
_p=""
_rest="$dest"
while [ -n "$_rest" ]; do
  _part="${_rest%%/*}"
  [ "$_part" = "$_rest" ] && _rest="" || _rest="${_rest#*/}"
  [ -n "$_part" ] || continue
  _p="${_p:+$_p/}$_part"
  if [ -L "$_p" ]; then
    echo "FAIL [product-checkout]: '${_p}' is a symlink — the Product is not checked out through it. Point path in ${rec} at a real folder."
    exit 1
  fi
done
if [ -e "$dest" ]; then
  echo "note [product-checkout]: '${dest}' is already there — it is not replaced."
  exit 0
fi
if [ -n "$(git ls-files -- "$dest" 2>/dev/null | head -1)" ]; then
  echo "FAIL [product-checkout]: '${dest}' holds files this repo tracks — the Product cannot be checked out there."
  exit 1
fi
# https only: the token goes in as HTTP basic auth. An ssh form (git@host:org/repo.git or ssh://) is
# read as the same repo over https; a file:// url (a local test) is cloned as it is.
case "$url" in
  git@*:*) _h="${url#git@}"; url="https://${_h%%:*}/${_h#*:}" ;;
  ssh://git@*) _h="${url#ssh://git@}"; _hp="${_h%%/*}"; url="https://${_hp%%:*}/${_h#*/}" ;;   # an ssh port is not the https one
  https://*|file://*) ;;
  *) echo "FAIL [product-checkout]: ${rec} on ${BASE} has a git_url git cannot clone over https: '${url}'."; exit 1 ;;
esac
# The token never goes on a command line or into a URL, so no process list or log line shows it; git
# reads the header from its environment (GIT_CONFIG_COUNT, git 2.31+). GitHub is told to mask the
# encoded form too — it only masks the secret as written.
case "${GITLAB_CI:-}" in true) _user=oauth2 ;; *) _user=x-access-token ;; esac
_auth="$(printf '%s:%s' "$_user" "$YAD_PRODUCT_TOKEN" | base64 | tr -d '\n')"
[ "${GITHUB_ACTIONS:-}" != true ] || echo "::add-mask::${_auth}"
if ! GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader GIT_CONFIG_VALUE_0="Authorization: Basic ${_auth}" \
    GIT_TERMINAL_PROMPT=0 git clone --quiet --depth 1 ${branch:+--branch "$branch"} -- "$url" "$dest"; then
  echo "FAIL [product-checkout]: could not clone the Product from ${url}${branch:+ (${branch})} into '${dest}'."
  echo "  Check that YAD_PRODUCT_TOKEN can read that repo, and that git_url and default_branch in ${rec} are right."
  exit 1
fi
echo "note [product-checkout]: the Product is checked out at '${dest}'${branch:+ (${branch})} — the gates read it there."
