#!/usr/bin/env bash
# Deterministic CI dependency installation selected by package.json#packageManager.
set -euo pipefail

YAD_CHECKS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly YAD_CHECKS_DIR
# shellcheck source-path=SCRIPTDIR
# shellcheck source=package-manager.sh
source "$YAD_CHECKS_DIR/package-manager.sh"

package_manager_spec="$(yad_package_manager_spec)"
package_manager="$(yad_detect_package_manager "$package_manager_spec")"

# Corepack is the Node tool that downloads and activates the declared version. It is only bundled
# with Node 20 through 24 (Node 25+ dropped it), and the copy in early 18/20 images predates the
# 2025 npm registry key rotation. A declared packageManager without a working Corepack must say so
# instead of dying with "command not found" in the middle of the job.
yad_require_corepack() {
  if command -v corepack >/dev/null 2>&1; then return 0; fi
  echo "FAIL [install-deps]: package.json#packageManager is set but corepack is not on PATH. Corepack ships with Node 20 (20.19+), 22 and 24 only — set YAD_NODE_VERSION to one of those, or install it first (npm install -g corepack)." >&2
  exit 1
}

case "$package_manager" in
  npm)
    if [ ! -f "$YAD_NPM_LOCKFILE" ] && [ ! -f "$YAD_NPM_SHRINKWRAP" ]; then
      echo "FAIL [install-deps]: npm requires package-lock.json or npm-shrinkwrap.json." >&2
      exit 1
    fi
    if [[ "$package_manager_spec" == npm@* ]]; then
      yad_require_corepack
      corepack enable
      corepack prepare "$package_manager_spec" --activate
      # npm's shim is not enabled by Corepack, so dispatch it explicitly through Corepack. This
      # guarantees package.json#packageManager selects the npm version instead of the Node image's
      # ambient npm binary.
      corepack npm ci
    else
      npm ci
    fi
    ;;
  pnpm)
    if [ ! -f "$YAD_PNPM_LOCKFILE" ]; then
      echo "FAIL [install-deps]: pnpm requires pnpm-lock.yaml." >&2
      exit 1
    fi
    if [[ "$package_manager_spec" != pnpm@* ]]; then
      echo "FAIL [install-deps]: pnpm CI requires an exact package.json#packageManager value (for example pnpm@9.15.0)." >&2
      exit 1
    fi
    yad_require_corepack
    corepack enable
    corepack prepare "$package_manager_spec" --activate
    pnpm install --frozen-lockfile
    ;;
esac
