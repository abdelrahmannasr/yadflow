#!/usr/bin/env bash
# Check the Product out where the code repo's record says (E120), so the Product-reading gates
# (contract-check, lineage-check, epic-open, reconcile-debt-check) can read it in CI.
#
# The record is `.sdlc/product-link.json` — `git_url`, `path` (from the repo root, inside the repo) and
# `default_branch` — written by `yad check --fix` / `yad update` and merged on its own. It is read from
# the BASE, never as the PR leaves it: a PR must not choose what CI clones, or where.
#
# Needs the YAD_PRODUCT_TOKEN secret (a token that can read the Product: a GitHub fine-grained token or
# App token, a GitLab project/group access token). Without it nothing is cloned and the gates defer. A PR
# from a fork never gets a secret, so there that is a note; on any other PR in CI the record says the team
# wants the Product read, so a missing token is a loud WARNING (#345) — still not a failure. With a token,
# a clone that fails FAILS the job: a broken setup must not read like a deferral. Before the clone, one
# call to the Product host's API with the token reads its expiry date, so CI warns 30 days before the
# token stops working and says "rejected" when the platform refuses it (#345).
set -euo pipefail

# --- shared Product settings file (byte-identical across the gates; they are standalone by design, so
# --- it is duplicated, not sourced) ---
# The Product's settings live under two names until v5: `.sdlc/product.json`, read first from 4.0, and
# `.sdlc/hub.json`, which an older yadflow wrote and its gates read. The environment may name the file
# instead: SDLC_PRODUCT_CONFIG, or the older SDLC_HUB_CONFIG. Two names that say different things are
# never settled by picking one — the CLI refuses the same way (YAD-STATE-008) — so the gate FAILS and
# names both. Said on stderr and returned as a failure: this runs inside `$(...)`, where an `exit` would
# only leave the subshell. `cmp -s` is byte for byte, like the CLI's own comparison.
product_config() {
  if [ -n "${SDLC_PRODUCT_CONFIG:-}" ] && [ -n "${SDLC_HUB_CONFIG:-}" ] \
    && [ "$SDLC_PRODUCT_CONFIG" != "$SDLC_HUB_CONFIG" ] && ! cmp -s "$SDLC_PRODUCT_CONFIG" "$SDLC_HUB_CONFIG"; then
    echo "FAIL [product-settings]: SDLC_PRODUCT_CONFIG (${SDLC_PRODUCT_CONFIG}) and SDLC_HUB_CONFIG (${SDLC_HUB_CONFIG}) name files that say different things. Set only SDLC_PRODUCT_CONFIG." >&2
    return 1
  fi
  if [ -n "${SDLC_PRODUCT_CONFIG:-}" ]; then printf '%s' "$SDLC_PRODUCT_CONFIG"; return 0; fi
  if [ -n "${SDLC_HUB_CONFIG:-}" ]; then printf '%s' "$SDLC_HUB_CONFIG"; return 0; fi
  if [ -f .sdlc/product.json ] && [ -f .sdlc/hub.json ] && ! cmp -s .sdlc/product.json .sdlc/hub.json; then
    echo "FAIL [product-settings]: .sdlc/product.json and .sdlc/hub.json say different things — they are one file under two names until v5. In the Product, run \`yad migrate --apply --keep product\` (or \`--keep hub\`) to choose the copy to keep, then commit both files." >&2
    return 1
  fi
  if [ -f .sdlc/product.json ]; then printf '%s' .sdlc/product.json; else printf '%s' .sdlc/hub.json; fi
}
PRODUCT_CONFIG="$(product_config)" || exit 1
export LC_ALL=C

# --- shared base resolution (byte-identical across the gates; they are standalone by design, so it
# --- is duplicated, not sourced) ---
# With no explicit base, RESOLVE the trunk instead of assuming a hardcoded `origin/main` — on a repo
# whose trunk is `develop`/`master` that guess either fails closed or, where a stale `main` still
# exists, silently diffs the WRONG range (issue #161). Mirrors the CLI's own order (cli/productcommit.mjs,
# cli/repo.mjs): the CONFIGURED default_branch first, then the remote's published default
# (origin/HEAD), then origin/main. Each candidate must actually resolve before it is used, so a
# DANGLING origin/HEAD (trunk renamed, the old remote-tracking ref pruned) falls through to the next
# candidate instead of failing the gate on a fully-fetched repo. CI always passes the base explicitly,
# so this governs local runs only. The `|| _x=""` guards are load-bearing: under `set -e` a failing
# command substitution in an assignment aborts the script.
resolve_base() {
  # tr first: a key and its value may legally sit on separate lines, which a per-line match misses.
  _cfg="$({ tr -d '\n' < "$PRODUCT_CONFIG"; } 2>/dev/null | sed -nE 's/.*"default_branch"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p')" || _cfg=""
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
  echo "FAIL [product-checkout]: base ref '${BASE}' not found — check the code out with full history (GitHub: actions/checkout with fetch-depth: 0; GitLab: GIT_DEPTH: \"0\"), and give a base that names a fetched branch (the first argument, or SDLC_BASE)."
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

# A warning the CI shows as one: a GitHub annotation on the run (and its PR), and a WARNING line in the log
# on every platform (GitLab has no annotation from a script).
warn() {
  echo "WARNING [product-checkout]: $1"
  [ "${GITHUB_ACTIONS:-}" != true ] || echo "::warning title=product-checkout::$1"
}
# The record read whole, for the two "set, but written so field cannot read it" tests below. Matched in
# bash (grep -q under pipefail can end the pipe early); byte by byte, as field reads it, since the script
# runs under LC_ALL=C (above), which `yad run checks` matches.
_raw="$(git show "${BASE}:${rec}" 2>/dev/null | tr -d '\n\r')" || _raw=""
_is_set() { local re="\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]"; [[ "$_raw" =~ $re ]]; }
# Before the token: a url this check cannot read is the thing to fix first, with or without a token.
if [ -z "$url" ] && _is_set git_url; then
  # yad check --fix compares the parsed value, so it keeps an escaped url that decodes to the same one.
  echo "note [product-checkout]: ${rec} on ${BASE} names a git_url this check cannot read (it is written with a JSON escape, a quote or a backslash) — the Product is not checked out."
  echo "  Write git_url in ${rec} without escapes, and merge that change first."
  exit 0
fi
if [ -z "${YAD_PRODUCT_TOKEN:-}" ]; then
  # Whether this PR comes from a fork, which never gets a secret: GitHub's workflow passes YAD_PR_FORK
  # (head repo != this repo); GitLab names both projects. Outside CI nothing is known, and it is a note.
  _fork=""
  if [ "${GITHUB_ACTIONS:-}" = true ]; then _fork="${YAD_PR_FORK:-}"
  elif [ "${GITLAB_CI:-}" = true ] && [ -n "${CI_MERGE_REQUEST_PROJECT_ID:-}" ]; then
    # A pipeline that runs OUTSIDE the MR's target project (a fork's own pipeline) never gets the target's
    # variables; a fork's MR pipeline a maintainer runs IN the target project does (review 1).
    if [ "${CI_PROJECT_ID:-}" != "${CI_MERGE_REQUEST_PROJECT_ID}" ]; then _fork=true; else _fork=false; fi
  fi
  if [ -n "$url" ] && { [ "${GITHUB_ACTIONS:-}" = true ] || [ "${GITLAB_CI:-}" = true ]; } && [ "$_fork" != true ]; then
    warn "no YAD_PRODUCT_TOKEN secret — the Product is not checked out, so contract-check, lineage-check, epic-open and reconcile-debt-check cannot read it and only defer on this PR."
    echo "  ${rec} on ${BASE} names the Product, so this repo is meant to read it in CI. Add a token that can read the Product"
    echo "  as the YAD_PRODUCT_TOKEN secret (GitHub: Actions secret; GitLab: a masked, NOT protected CI/CD variable on this project)."
    [ "${GITHUB_ACTOR:-}" != 'dependabot[bot]' ] || echo "  This run is a Dependabot PR, which gets Dependabot secrets only: add the token there too."
    exit 0
  fi
  echo "note [product-checkout]: no YAD_PRODUCT_TOKEN secret — the Product is not checked out, and the gates defer."
  [ "$_fork" != true ] || echo "  This PR comes from a fork, which is never given secrets."
  echo "  To check it out here, add a token that can read the Product as the YAD_PRODUCT_TOKEN secret (CI variable)."
  exit 0
fi
if [ -z "$url" ]; then
  echo "note [product-checkout]: ${rec} on ${BASE} names no git_url — the Product is not checked out."
  echo "  Set the Product's git_url in its .sdlc/product.json (.sdlc/hub.json on a Product that has only that name; when both exist, then run \`yad migrate --apply --keep product\`), then run \`yad check --fix --push\` from the Product."
  exit 0
fi
# Inside the repo, and not the repo itself: CI can only place a checkout in the workspace, and the gates
# read an UNTRACKED folder there as CI's checkout.
_bad=false
case "/${dest}/" in
  //|/./|*/../*|//*|/.git/*|/.git) _bad=true ;;
esac
# A path of only spaces names no folder either (yad run checks refuses it too).
case "$dest" in *[![:space:]]*) ;; *) _bad=true ;; esac
# As yad run checks reads it: a path of only `.` parts (`./`) is the repo itself, and a `.git` part in any
# case is the git folder on a disk that ignores case.
_lc="$(printf '%s' "$dest" | tr '[:upper:]' '[:lower:]')"
case "/${_lc}/" in */.git/*) _bad=true ;; esac
_named=false
_r="$dest"
while [ -n "$_r" ]; do
  _q="${_r%%/*}"
  [ "$_q" = "$_r" ] && _r="" || _r="${_r#*/}"
  case "$_q" in ""|.) ;; *) _named=true ;; esac
done
[ "$_named" = true ] || _bad=true
if [ "$_bad" = true ]; then
  # The record is read from the base, so a fix on the PR's branch does not count until it merges. A
  # missing path is one `yad check --fix --push` writes; a path that is set is kept by it, so a person
  # changes that one. `field` reads a value written with an escape, a quote or a backslash as empty:
  # that path is set.
  if [ -n "$dest" ]; then
    echo "FAIL [product-checkout]: ${rec} on ${BASE} says path '${dest}' — it must be a folder inside this repo. Change path in ${rec} to one, such as .yad/product, and merge that change first: this check reads the record from ${BASE}, so changing it in this PR does not help."
  elif _is_set path; then
    echo "FAIL [product-checkout]: ${rec} on ${BASE} names a path this check cannot read (it is written with a JSON escape, a quote or a backslash) — change path in ${rec} to a plain folder such as .yad/product, and merge that change first: this check reads the record from ${BASE}."
  else
    echo "FAIL [product-checkout]: ${rec} on ${BASE} names no path — run yad check --fix --push from the Product, on a machine that has this repo cloned and on its default branch; it writes path .yad/product to ${rec} there. Or set path yourself and merge that change first."
  fi
  exit 1
fi
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
# Tracked first (review 2): a tracked folder is also "already there", and read that way it passed.
if [ -n "$(git ls-files -- "$dest" 2>/dev/null | head -1)" ]; then
  # The command is printed for a person to paste, so a quote in the path is written the shell's way.
  _qd="$(printf '%s' "$dest" | sed "s/'/'\\\\''/g")"
  echo "FAIL [product-checkout]: '${dest}' holds files this repo tracks — the Product cannot be checked out there. Untrack them only if they do not belong in this repo (git rm -r --cached -- '${_qd}', and add the folder to .gitignore), or change path in ${rec} to an untracked folder such as .yad/product and merge that change first (the record is read from ${BASE})."
  exit 1
fi
if [ -e "$dest" ]; then
  echo "note [product-checkout]: '${dest}' is already there — it is not replaced."
  exit 0
fi
# https only: the token goes in as HTTP basic auth. An ssh form (git@host:org/repo.git or ssh://) is
# read as the same repo over https; a file:// url (a local test) is cloned as it is.
case "$url" in
  git@*:*) _h="${url#git@}"; url="https://${_h%%:*}/${_h#*:}" ;;
  ssh://git@*) _h="${url#ssh://git@}"; _hp="${_h%%/*}"; url="https://${_hp%%:*}/${_h#*/}" ;;   # an ssh port is not the https one
  https://*|file://*) ;;
  http://*) echo "FAIL [product-checkout]: ${rec} on ${BASE} has an http:// git_url — the token is not sent over plain http. Set the Product's git_url to the https url, then run yad check --fix --push from the Product, on a machine that has this repo cloned and on its default branch; it rewrites the record there."; exit 1 ;;
  *) echo "FAIL [product-checkout]: ${rec} on ${BASE} has a git_url git cannot clone over https: '${url}' — set the Product's git_url to an https:// or git@host:org/repo form, then run yad check --fix --push from the Product, on a machine that has this repo cloned and on its default branch; it rewrites the record there."; exit 1 ;;
esac
# --- the token's expiry (#345) ---
# One call to the Product host's API with the token: GitHub answers a personal access token's expiry in
# the `github-authentication-token-expiration` header of any call; GitLab answers a personal, project or
# group access token's `expires_at` at /personal_access_tokens/self (GitLab 15.5+). The token goes to curl
# in a header FILE (`-H @file`), never on its command line. Anything this cannot read is a note and the
# clone goes on: only the clone decides whether the job fails. A file:// url (a local test) has no API.
days_from_civil() { # YYYY-MM-DD -> days since 1970-01-01, in shell arithmetic (GNU and BSD date differ)
  local y=$((10#${1:0:4})) m=$((10#${1:5:2})) d=$((10#${1:8:2}))
  [ "$m" -le 2 ] && y=$((y - 1))
  local era=$(( (y >= 0 ? y : y - 399) / 400 ))
  local yoe=$(( y - era * 400 ))
  local mp=$(( m > 2 ? m - 3 : m + 9 ))
  local doy=$(( (153 * mp + 2) / 5 + d - 1 ))
  local doe=$(( yoe * 365 + yoe / 4 - yoe / 100 + doy ))
  echo $(( era * 146097 + doe - 719468 ))
}
_rejected=""
_host=""
case "$url" in https://*) _h="${url#https://}"; _host="${_h%%/*}"; _host="${_host##*@}" ;; esac
_api=""
_kind=""
# Which API, from the Product's HOST first (review 1: a GitHub-run code repo can read a GitLab Product),
# and only for a host that names neither platform, from the CI it runs in. Always the Product's own host
# (or api.github.com / api.<sub>.ghe.com for GitHub's cloud): the token goes nowhere the clone does not.
_hn="$(printf '%s' "${_host%%:*}" | tr '[:upper:]' '[:lower:]')"
if [ -n "$_hn" ]; then
  case "$_hn" in
    github.com) _api="https://api.github.com/rate_limit"; _kind=github ;;
    *.ghe.com) _api="https://api.${_hn}/rate_limit"; _kind=github ;;
    gitlab.com|*gitlab*) _api="https://${_host}/api/v4/personal_access_tokens/self"; _kind=gitlab ;;
    *) if [ "${GITLAB_CI:-}" = true ]; then _api="https://${_host}/api/v4/personal_access_tokens/self"; _kind=gitlab
       elif [ "${GITHUB_ACTIONS:-}" = true ]; then _api="https://${_host}/api/v3/rate_limit"; _kind=github
       fi ;;
  esac
fi
if [ -n "$_api" ] && command -v curl >/dev/null 2>&1; then
  _tmp="$(mktemp -d)"
  trap 'rm -rf "$_tmp"' EXIT
  ( umask 077
    if [ "$_kind" = github ]; then printf 'Authorization: Bearer %s\n' "$YAD_PRODUCT_TOKEN"; else printf 'PRIVATE-TOKEN: %s\n' "$YAD_PRODUCT_TOKEN"; fi > "$_tmp/h" )
  _code="$(curl -sS --max-time 15 -o "$_tmp/body" -D "$_tmp/head" -w '%{http_code}' -H @"$_tmp/h" -- "$_api" 2>/dev/null)" || _code=""
  rm -f "$_tmp/h"
  _exp=""
  if [ "$_code" = 200 ]; then
    if [ "$_kind" = github ]; then
      _exp="$(tr -d '\r' < "$_tmp/head" | sed -nE 's/^[Gg][Ii][Tt][Hh][Uu][Bb]-[Aa][Uu][Tt][Hh][Ee][Nn][Tt][Ii][Cc][Aa][Tt][Ii][Oo][Nn]-[Tt][Oo][Kk][Ee][Nn]-[Ee][Xx][Pp][Ii][Rr][Aa][Tt][Ii][Oo][Nn]:[[:space:]]*([0-9]{4}-[0-9]{2}-[0-9]{2}).*/\1/p' | head -1)" || _exp=""
    else
      _exp="$(tr -d '\n\r' < "$_tmp/body" | sed -nE 's/.*"expires_at"[[:space:]]*:[[:space:]]*"([0-9]{4}-[0-9]{2}-[0-9]{2})[^"]*".*/\1/p')" || _exp=""
    fi
    if [ -n "$_exp" ]; then
      _left=$(( $(days_from_civil "$_exp") - $(days_from_civil "$(date -u +%Y-%m-%d)") ))
      if [ "$_left" -le 30 ]; then
        warn "YAD_PRODUCT_TOKEN expires on ${_exp} (in ${_left} day(s)) — renew it before then, or every Product-reading gate on this repo fails its checkout."
      else
        echo "note [product-checkout]: YAD_PRODUCT_TOKEN expires on ${_exp}."
      fi
    else
      echo "note [product-checkout]: the platform did not say when YAD_PRODUCT_TOKEN expires (a token with no expiry date, or an app token)."
    fi
  elif [ "$_code" = 401 ]; then
    _rejected=1
  elif [ "$_code" = 403 ] && [ "$_kind" = gitlab ]; then
    # A clone-only token (read_repository) may not call GitLab's API at all: its expiry is then read by
    # `yad doctor`, from the Product's own list of access tokens.
    echo "note [product-checkout]: ${_host} would not tell this token its own expiry date (HTTP 403 — a token with only read_repository cannot use the API); \`yad doctor\` warns about the Product's project access tokens that expire soon."
  else
    echo "note [product-checkout]: could not read YAD_PRODUCT_TOKEN's expiry date from ${_host} (${_code:+HTTP }${_code:-no answer}); going on with the clone."
  fi
fi

# The token never goes on a command line or into a URL, so no process list or log line shows it; git
# reads the header from its environment (GIT_CONFIG_COUNT, git 2.31+). GitHub is told to mask the
# encoded form too — it only masks the secret as written.
# The user name the host expects with a token: by the host's kind when the API choice above named one
# (review 2), else by the CI this runs in.
case "${_kind:-}" in
  gitlab) _user=oauth2 ;;
  github) _user=x-access-token ;;
  *) case "${GITLAB_CI:-}" in true) _user=oauth2 ;; *) _user=x-access-token ;; esac ;;
esac
_auth="$(printf '%s:%s' "$_user" "$YAD_PRODUCT_TOKEN" | base64 | tr -d '\n')"
[ "${GITHUB_ACTIONS:-}" != true ] || echo "::add-mask::${_auth}"
if ! GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader GIT_CONFIG_VALUE_0="Authorization: Basic ${_auth}" \
    GIT_TERMINAL_PROMPT=0 git clone --quiet --depth 1 ${branch:+--branch "$branch"} -- "$url" "$dest"; then
  echo "FAIL [product-checkout]: could not clone the Product from ${url}${branch:+ (${branch})} into '${dest}'."
  if [ -n "$_rejected" ]; then
    echo "  ${_host} rejected YAD_PRODUCT_TOKEN (HTTP 401): it has expired or been revoked. Make a new token that can read the Product and set it as the secret."
  else
    echo "  Check that YAD_PRODUCT_TOKEN can read that repo, and that git_url and default_branch in ${rec} are right."
  fi
  exit 1
fi
[ -z "$_rejected" ] || warn "${_host} rejected YAD_PRODUCT_TOKEN on its API (HTTP 401), though the clone worked — check that it has not expired or been revoked."
echo "note [product-checkout]: the Product is checked out at '${dest}'${branch:+ (${branch})} — the gates read it there."
