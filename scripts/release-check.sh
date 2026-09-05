#!/usr/bin/env bash
# The release check — the gate a release has to clear before anything reaches npm.
#
# Rule 10 of the change-safety rules (docs/roadmap-idea-1.md, Part 8): a release is a human decision.
# A person decides by fast-forwarding `release` to `main`; this decides whether that decision is SAFE
# to carry out. Semantic-release runs only after this passes (.github/workflows/release.yml).
#
# It exists because the engine's file shapes are changing. A green unit suite proves the code works on
# the machine that wrote it. What a release needs to prove is different, and every step below is one
# way a user could be hurt by an upgrade:
#
#   1  tests + coverage    the ordinary bar, at the ordinary thresholds
#   2  the golden test     a real frozen v3 project still reads exactly as it did (rule 6)
#   3  migrate --preview   the upgrade path can be PLANNED on that project without touching it
#   4  fresh install       the tarball people actually download installs and sets a project up
#   5  doctor              that brand-new project is healthy by this release's own reckoning
#   6  migration guide     if the file shape moved, the page explaining it exists (rule 7)
#
# Run it yourself before deciding: bash scripts/release-check.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/yad-release-check.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

say()  { printf '\n== %s\n' "$*"; }
pass() { printf '   ok: %s\n' "$*"; }
die()  { printf '\nRELEASE CHECK FAILED: %s\n' "$*" >&2; exit 1; }

cd "$ROOT"

# The coverage thresholds are node's own `--test-coverage-*` flags, which older runtimes do not have.
# Without this the script dies at step 1 with "tests or coverage thresholds" — a confident, wrong
# diagnosis of what is really an unsupported Node. ci.yml pins the same floor for the same reason.
MIN_NODE=22.8
node -e '
  const [maj, min] = process.versions.node.split(".").map(Number);
  const [wantMaj, wantMin] = process.argv[1].split(".").map(Number);
  if (maj < wantMaj || (maj === wantMaj && min < wantMin)) process.exit(1);
' "$MIN_NODE" || die "this check needs Node >= $MIN_NODE (running $(node -v)) — the coverage thresholds in step 1 use node flags older runtimes do not have. The PUBLISHED package still supports Node >= 18; this floor is only for running the check."

# ---------------------------------------------------------------------------------------------
say "1/6  tests + coverage"
# Coverage carries its own thresholds (package.json) and runs the whole suite, so it subsumes `npm
# test`. Running both would double the slowest step of this script for no extra signal.
npm run coverage >"$WORK/coverage.log" 2>&1 || { cat "$WORK/coverage.log"; die "tests or coverage thresholds"; }
grep -E '^# (tests|pass|fail)' "$WORK/coverage.log" | sed 's/^# /   /'
pass "suite green at the configured coverage floors"

# ---------------------------------------------------------------------------------------------
say "2/6  the golden compatibility test"
# Already covered by step 1, but named separately and run on its own so a failure here is unmissable:
# this is the alarm bell for the whole roadmap, and "if it breaks, the change is wrong" (rule 6).
node --test cli/test-golden.mjs >"$WORK/golden.log" 2>&1 || { cat "$WORK/golden.log"; die "the frozen v3 project no longer reads as it did — the change is wrong, not the test"; }
pass "the frozen v3 project reads exactly as it did"

# ---------------------------------------------------------------------------------------------
say "3/6  yad migrate --preview on the golden project"
# The upgrade path, planned against a REAL v3 project. A preview must never write, and must never
# report a file it cannot handle — that would be a user, on the current release, who cannot upgrade.
GOLDEN="$WORK/golden-v3"
cp -R "$ROOT/cli/fixtures/golden-v3" "$GOLDEN"
# Hash with node rather than shasum/sha256sum: node is the one tool guaranteed present (it is what is
# being released), and the two checksum binaries are not both available on both platforms.
tree_hash() {
  DIR="$1" node -e '
    const fs = require("fs"), path = require("path"), { createHash } = require("crypto");
    const out = [];
    (function walk(d) {
      for (const n of fs.readdirSync(d).sort()) {
        const p = path.join(d, n);
        if (fs.statSync(p).isDirectory()) walk(p);
        else out.push(createHash("sha256").update(fs.readFileSync(p)).digest("hex") + "  " + path.relative(process.env.DIR, p));
      }
    })(process.env.DIR);
    console.log(out.join("\n"));
  '
}
BEFORE="$(tree_hash "$GOLDEN")"
node "$ROOT/bin/yad.mjs" migrate --json --dir "$GOLDEN" >"$WORK/migrate.json" 2>"$WORK/migrate.err" \
  || { cat "$WORK/migrate.err" "$WORK/migrate.json" 2>/dev/null; die "yad migrate --preview could not plan the upgrade of a real v3 project"; }
AFTER="$(tree_hash "$GOLDEN")"
[ "$BEFORE" = "$AFTER" ] || die "yad migrate wrote to the project during a PREVIEW"
J_FILE="$WORK/migrate.json" node -e '
  const j = JSON.parse(require("fs").readFileSync(process.env.J_FILE, "utf8"));
  const blocked = j.rows.filter((r) => r.action === "ahead" || r.action === "unreadable");
  if (!j.ok || blocked.length) {
    console.error("   blocked rows: " + JSON.stringify(blocked, null, 2));
    process.exit(1);
  }
  console.log(`   ${j.rows.length} file(s) planned, ${j.changed.length} would change, engine shape ${j.engine}`);
' || die "the migration plan for a real v3 project has files it cannot handle"
pass "the upgrade can be planned, and the preview wrote nothing"

# ---------------------------------------------------------------------------------------------
say "4/6  a fresh install of the real tarball"
# Not the working tree — the artifact people download. `files` mistakes (a missing bin/, a leaked
# fixture) only ever show up here.
# Not `$(npm pack … 2>/dev/null | tail -1)`: under `set -e` + `pipefail` a pack failure aborts on the
# assignment with its stderr already thrown away, so the release fails with no explanation at all.
npm pack --pack-destination "$WORK" >"$WORK/pack.log" 2>&1 || { cat "$WORK/pack.log"; die "npm pack failed"; }
TARBALL="$WORK/$(tail -1 "$WORK/pack.log")"
[ -f "$TARBALL" ] || { cat "$WORK/pack.log"; die "npm pack produced no tarball"; }
npm install -g --prefix "$WORK/prefix" "$TARBALL" >"$WORK/install.log" 2>&1 || { cat "$WORK/install.log"; die "the packed tarball does not install"; }
export PATH="$WORK/prefix/bin:$PATH"
# The installed copy has no .git, so the update notifier's dev-checkout guard does not apply and it
# would reach the real registry. A release check must not depend on the network.
export YAD_NO_UPDATE_NOTIFIER=1
export YAD_CACHE_DIR="$WORK/cache"
command -v yad >/dev/null || die "yad is not on PATH after installing the tarball"
pass "installed $(yad --version)"

say "     …and a fresh project set up with it"
HUB="$WORK/hub"
mkdir -p "$HUB"
git init -q "$HUB"
git -C "$HUB" config user.name  release-check
git -C "$HUB" config user.email release-check@local
( cd "$HUB" && echo "# hub" > README.md && git add -A && git commit -qm "init" )
SDLC_NONINTERACTIVE=1 yad setup --dir "$HUB" --solo --greenfield --separate >"$WORK/setup.log" 2>&1 \
  || { cat "$WORK/setup.log"; die "a fresh \`yad setup\` failed with this release"; }
[ -f "$HUB/.sdlc/cli-version.json" ] || die "setup left no .sdlc/cli-version.json"
pass "a new project can be created by this release"

# ---------------------------------------------------------------------------------------------
say "5/6  yad doctor on that brand-new project"
# A release that cannot produce a project its own doctor calls healthy is not shippable. Warnings are
# fine (a fresh project has no repos connected yet); a FAILURE is not.
set +e
yad doctor --json --dir "$HUB" >"$WORK/doctor.json" 2>"$WORK/doctor.err"
DOCTOR_RC=$?
set -e
[ -s "$WORK/doctor.json" ] || { cat "$WORK/doctor.err"; die "yad doctor produced no JSON"; }
J_FILE="$WORK/doctor.json" node -e '
  const j = JSON.parse(require("fs").readFileSync(process.env.J_FILE, "utf8"));
  const failed = j.checks.filter((c) => c.status === "fail");
  const shape  = j.checks.filter((c) => c.section === "shape");
  if (failed.length) {
    console.error("   failures: " + failed.map((c) => `${c.id}: ${c.message}`).join("\n             "));
    process.exit(1);
  }
  if (!shape.length) { console.error("   doctor reported no shape section — the drift report is missing"); process.exit(1); }
  if (shape.some((c) => c.status !== "ok")) {
    console.error("   a project this release just created is not on this release'"'"'s own shape:");
    console.error("   " + shape.map((c) => `${c.status}: ${c.message}`).join("\n   "));
    process.exit(1);
  }
  console.log(`   ${j.checks.length} checks, 0 failures; shape: ${shape[0].message}`);
' || die "yad doctor is not clean on a project this release just created"
[ "$DOCTOR_RC" -eq 0 ] || die "yad doctor exited $DOCTOR_RC on a brand-new project"
pass "a project this release creates passes its own health check"

# ---------------------------------------------------------------------------------------------
say "6/6  a migration guide, if the file shape moved"
# Rule 7: a file-shape change ships together with its migration guide. The changelog is generated
# AFTER this check by semantic-release, so what is enforced here is the page the notes point at —
# authored by a person, before the release, or the release does not happen.
bash "$ROOT/scripts/shape-guide-check.sh"

printf '\n== RELEASE CHECK PASSED — safe to publish\n'
