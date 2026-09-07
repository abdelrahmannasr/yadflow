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
# Two assignments on purpose: nested inside another $(...), a failing yad_package_manager_spec would
# be swallowed, and the gate would fall back to lockfile detection and PASS on a package.json it
# had just rejected. Each step fails the gate on its own under `set -e`.
package_manager_spec="$(yad_package_manager_spec)"
package_manager="$(yad_detect_package_manager "$package_manager_spec")"
# `npm`, `pnpm`, or `corepack npm` for a pinned npm — see yad_package_manager_command.
run_with_words="$(yad_package_manager_command "$package_manager_spec" "$package_manager")"
read -r -a run_with <<< "$run_with_words"

echo "[build/test/lint] lint…"
"${run_with[@]}" run --silent lint
echo "[build/test/lint] build…"
"${run_with[@]}" run --silent build

# Worker cap: when YAD_TEST_MAX_WORKERS is set AND the repo's test script is jest/vitest (the
# runners that accept --maxWorkers), forward it to bound CI test concurrency. For any other runner
# (node --test, mocha, …) it is a deliberate no-op so the gate never breaks on an unknown flag.
# npm needs the `--` separator to hand the flag to the script; pnpm (7+) forwards a literal `--` to
# the script instead, where jest reads `--maxWorkers=N` as a test-path pattern and finds no tests.
extra=""
if [ -n "${YAD_TEST_MAX_WORKERS:-}" ]; then
  case "$(node --input-type=module -e 'import fs from "node:fs"; const p=JSON.parse(fs.readFileSync("package.json", "utf8").replace(/^\uFEFF/, "")); process.stdout.write(p.scripts?.test || "")' 2>/dev/null || true)" in
    *jest*|*vitest*)
      if [ "$package_manager" = "pnpm" ]; then extra="--maxWorkers=${YAD_TEST_MAX_WORKERS}"; else extra="-- --maxWorkers=${YAD_TEST_MAX_WORKERS}"; fi
      ;;
  esac
fi
echo "[build/test/lint] test…"
# Intentional word-splitting: $extra is empty, `-- --maxWorkers=N` (npm), or `--maxWorkers=N` (pnpm).
# shellcheck disable=SC2086
"${run_with[@]}" run --silent test $extra

echo "PASS [build/test/lint]: lint, build, and tests all green."
