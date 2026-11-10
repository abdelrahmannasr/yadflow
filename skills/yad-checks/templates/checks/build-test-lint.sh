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

# The base branch, as the other gates take it: the first argument, or SDLC_BASE (#496).
if yad_unity_skip "${1:-${SDLC_BASE:-}}"; then
  echo "SKIP [build/test/lint]: a Unity project (ProjectSettings/ProjectVersion.txt and Assets/): not built by yad. Build and test it with Unity's own CI, such as GameCI."
  exit 0
fi
# Two assignments on purpose: nested inside another $(...), a failing yad_package_manager_spec would
# be swallowed, and the gate would fall back to lockfile detection and PASS on a package.json it
# had just rejected. Each step fails the gate on its own under `set -e`.
package_manager_spec="$(yad_package_manager_spec)"
package_manager="$(yad_detect_package_manager "$package_manager_spec")"
# `npm`, `pnpm`, or `corepack npm` for a pinned npm — see yad_package_manager_command.
run_with_words="$(yad_package_manager_command "$package_manager_spec" "$package_manager")"
read -r -a run_with <<< "$run_with_words"

# One step of the gate. A failing step used to end the job under `set -e` with only the tool's own
# output; this names the step, the command to run by hand, and the missing-script case (#351).
run_step() {
  local step="$1" has=0
  shift
  # Checked before it runs: npm prints nothing for a missing script, and runs an empty one as a pass,
  # so an empty "test" would read as green. Exit 3 is "none"; a package.json node cannot read is left
  # to the run itself, which reports it.
  YAD_STEP="$step" node --input-type=module -e 'import fs from "node:fs"; const p=JSON.parse(fs.readFileSync("package.json", "utf8").replace(/^\uFEFF/, "")); const s=p.scripts?.[process.env.YAD_STEP]; process.exit(typeof s === "string" && s.trim() ? 0 : 3)' 2>/dev/null || has=$?
  if [ "$has" = 3 ]; then
    echo "FAIL [build/test/lint]: package.json has no \"${step}\" script, or an empty one — add one; the gate runs lint, build and test, in that order."
    exit 1
  fi
  if ! "${run_with[@]}" run --silent "$step" "$@"; then
    echo "FAIL [build/test/lint]: '${run_with_words} run ${step}' failed — the output above says why. Run it on your machine, fix what it reports, and push again."
    exit 1
  fi
}

echo "[build/test/lint] lint…"
run_step lint
echo "[build/test/lint] build…"
run_step build

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
run_step test $extra

echo "PASS [build/test/lint]: lint, build, and tests all green."
