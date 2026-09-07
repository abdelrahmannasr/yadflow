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

case "$package_manager" in
  npm)
    if [ ! -f "$YAD_NPM_LOCKFILE" ] && [ ! -f "$YAD_NPM_SHRINKWRAP" ]; then
      echo "FAIL [install-deps]: npm requires package-lock.json or npm-shrinkwrap.json." >&2
      exit 1
    fi
    if [[ "$package_manager_spec" == npm@* ]]; then
      yad_require_corepack
      corepack enable
      yad_corepack_prepare "$package_manager_spec"
      # npm's shim is not enabled by Corepack, so dispatch it explicitly through Corepack — the same
      # `corepack npm` the gate uses for lint/build/test, so package.json#packageManager selects the
      # npm version end to end instead of the Node image's ambient npm binary.
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
    yad_corepack_prepare "$package_manager_spec"
    pnpm install --frozen-lockfile
    ;;
esac
