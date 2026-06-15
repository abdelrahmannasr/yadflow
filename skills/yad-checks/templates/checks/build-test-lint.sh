#!/usr/bin/env bash
# build / test / lint gate (Phase 3 build plan §C).
# Standard quality stage: lint, build, and tests that actually exercise behavior (not just pass).
# Delegates to the repo's npm scripts so each repo owns the specifics.
set -euo pipefail

echo "[build/test/lint] lint…"
npm run --silent lint
echo "[build/test/lint] build…"
npm run --silent build

# Worker cap: when YAD_TEST_MAX_WORKERS is set AND the repo's test script is jest/vitest (the
# runners that accept --maxWorkers), forward it to bound CI test concurrency. For any other runner
# (node --test, mocha, …) it is a deliberate no-op so the gate never breaks on an unknown flag.
extra=""
if [ -n "${YAD_TEST_MAX_WORKERS:-}" ]; then
  case "$(npm pkg get scripts.test 2>/dev/null || true)" in
    *jest*|*vitest*) extra="-- --maxWorkers=${YAD_TEST_MAX_WORKERS}" ;;
  esac
fi
echo "[build/test/lint] test…"
# Intentional word-splitting: $extra is either empty or `-- --maxWorkers=N`.
# shellcheck disable=SC2086
npm run --silent test $extra

echo "PASS [build/test/lint]: lint, build, and tests all green."
