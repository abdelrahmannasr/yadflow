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
    if [ ! -f "package-lock.json" ] && [ ! -f "npm-shrinkwrap.json" ]; then
      echo "FAIL [install-deps]: npm requires package-lock.json or npm-shrinkwrap.json." >&2
      exit 1
    fi
    npm ci
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
    corepack enable
    corepack prepare "$package_manager_spec" --activate
    pnpm install --frozen-lockfile
    ;;
esac
