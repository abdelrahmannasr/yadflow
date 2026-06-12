#!/usr/bin/env bash
# build / test / lint gate (Phase 3 build plan §C).
# Standard quality stage: lint, build, and tests that actually exercise behavior (not just pass).
# Delegates to the repo's npm scripts so each repo owns the specifics.
set -euo pipefail

echo "[build/test/lint] lint…"
npm run --silent lint
echo "[build/test/lint] build…"
npm run --silent build
echo "[build/test/lint] test…"
npm run --silent test

echo "PASS [build/test/lint]: lint, build, and tests all green."
