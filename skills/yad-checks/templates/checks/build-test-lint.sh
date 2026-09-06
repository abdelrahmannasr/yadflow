#!/usr/bin/env bash
# build / test / lint gate (Phase 3 build plan §C).
# Standard quality stage: lint, build, and tests that actually exercise behavior (not just pass).
# Delegates to the package manager named by package.json so each repo owns the specifics.
set -euo pipefail

YAD_CHECKS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly YAD_CHECKS_DIR
# shellcheck source-path=SCRIPTDIR
# shellcheck source=package-manager.sh
source "$YAD_CHECKS_DIR/package-manager.sh"
package_manager="$(yad_detect_package_manager "$(yad_package_manager_spec)")"

echo "[build/test/lint] lint…"
"$package_manager" run --silent lint
echo "[build/test/lint] build…"
"$package_manager" run --silent build

# Worker cap: when YAD_TEST_MAX_WORKERS is set AND the repo's test script is jest/vitest (the
# runners that accept --maxWorkers), forward it to bound CI test concurrency. For any other runner
# (node --test, mocha, …) it is a deliberate no-op so the gate never breaks on an unknown flag.
extra=""
if [ -n "${YAD_TEST_MAX_WORKERS:-}" ]; then
  case "$(node --input-type=module -e 'import fs from "node:fs"; const p=JSON.parse(fs.readFileSync("package.json", "utf8")); process.stdout.write(p.scripts?.test || "")' 2>/dev/null || true)" in
    *jest*|*vitest*) extra="-- --maxWorkers=${YAD_TEST_MAX_WORKERS}" ;;
  esac
fi
echo "[build/test/lint] test…"
# Intentional word-splitting: $extra is either empty or `-- --maxWorkers=N`.
# shellcheck disable=SC2086
"$package_manager" run --silent test $extra

echo "PASS [build/test/lint]: lint, build, and tests all green."
