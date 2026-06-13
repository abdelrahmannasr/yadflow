#!/usr/bin/env bash
# E2E harness: pack the REAL tarball, install it into a throwaway prefix, and drive the
# installed `yad` binary through a full cycle on scratch repos — setup, drift check,
# review-gate open/sync (against a fake `gh`), convention commit, and the code-repo check
# gates (pass + deliberate-fail). Asserts wiring and exit codes; the predicate matrix and
# per-gate edge cases live in cli/test.mjs / cli/test-checks.mjs.
# Run from anywhere: bash test/e2e/run.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/yad-e2e.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

say() { printf '\n== %s\n' "$*"; }
die() { printf 'E2E FAIL: %s\n' "$*" >&2; exit 1; }

# jassert <file> <js-predicate over `j`> — assert on a JSON file's content.
jassert() {
  J_FILE="$1" node -e '
    const j = JSON.parse(require("fs").readFileSync(process.env.J_FILE, "utf8"));
    if (!new Function("j", "return (" + process.argv[1] + ")")(j)) {
      console.error("E2E FAIL: " + process.env.J_FILE + " does not satisfy: " + process.argv[1]);
      process.exit(1);
    }
  ' "$2"
}

# Test commits must carry the identity each scratch repo sets, not CI's exported one.
unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL || true
git_id() { git -C "$1" config user.name dev; git -C "$1" config user.email dev@corp.io; }

say "pack the tarball"
TARBALL="$WORK/$(cd "$ROOT" && npm pack --pack-destination "$WORK" 2>/dev/null | tail -1)"
[ -f "$TARBALL" ] || die "npm pack produced no tarball"
echo "   $TARBALL"

say "install into a throwaway prefix"
npm install -g --prefix "$WORK/prefix" "$TARBALL" >/dev/null 2>&1
export PATH="$WORK/prefix/bin:$PATH"
command -v yad >/dev/null || die "yad not on PATH after install"
yad --version >/dev/null || die "yad --version failed"

say "arm the fake gh"
mkdir -p "$WORK/shim"
cp "$ROOT/test/e2e/fixtures/gh" "$WORK/shim/gh"
chmod +x "$WORK/shim/gh"
export PATH="$WORK/shim:$PATH"
export E2E_GH_PHASE_FILE="$WORK/gh-phase"
echo pending > "$E2E_GH_PHASE_FILE"
[ "$(command -v gh)" = "$WORK/shim/gh" ] || die "fake gh not first on PATH"

say "scaffold hub + code repo"
HUB="$WORK/hub"
BACKEND="$HUB/repos/backend"
mkdir -p "$BACKEND"
git init -q "$HUB" && git_id "$HUB"
( cd "$HUB" && echo "# hub" > README.md && git add -A && git commit -qm "init hub" )
git init -q "$BACKEND" && git_id "$BACKEND"
( cd "$BACKEND" && echo '{}' > package.json && git add -A && git commit -qm "init backend" && git branch -qM main )
HEAD_BACKEND="$(git -C "$BACKEND" rev-parse HEAD)"

# Pre-seed hub config + registry so the non-interactive setup keeps them (roster drives the gate).
mkdir -p "$HUB/.sdlc"
cat > "$HUB/.sdlc/hub.json" <<EOF
{"platform":"github","bridge_enabled":true,"bridge":true,"default_branch":"main","roster":[
  {"login":"alice","name":"Alice","role":"owner","email":"alice@corp.io"},
  {"login":"bob","name":"Bob","role":"reviewer","email":"bob@corp.io"}
]}
EOF
cat > "$HUB/.sdlc/repos.json" <<EOF
{"repos":[{"name":"backend","path":"repos/backend","platform":"github","domain_owner":"Alice",
 "default_branch":"main","syncedHead":"$HEAD_BACKEND",
 "contextPack":".sdlc/code-context/backend/pack.md","codeMap":".sdlc/code-context/backend/code-map.md"}]}
EOF

say "yad setup (non-interactive)"
SDLC_NONINTERACTIVE=1 yad setup --dir "$HUB" || die "yad setup failed"
[ -f "$HUB/.claude/skills/yad-epic/SKILL.md" ] || die "skills not installed"
[ -f "$BACKEND/checks/spec-link.sh" ] || die "code repo not wired with check gates"
[ -x "$BACKEND/checks/spec-link.sh" ] || die "spec-link.sh not executable"
grep -q "alice@corp.io" "$HUB/.sdlc/verified-authors" || die "verified-authors not generated from roster"

say "setup recorded the pluggable tool connections (design + testing)"
jassert "$HUB/.sdlc/design.json" 'j.tool === "figma" && j.auth === "user" && j.source === null'
jassert "$HUB/.sdlc/testing.json" 'j.tool === "playwright" && j.auth === "user" && j.source === null'

say "yad check is clean after setup"
CHECK_OUT="$(yad check --dir "$HUB")" || die "yad check failed"
echo "$CHECK_OUT" | grep -q "summary: 0 missing, 0 outdated, 0 stale, 0 legacy" \
  || die "yad check reports drift right after setup: $(echo "$CHECK_OUT" | grep summary)"
# Land the wiring on the code repo's main (as a real team would) so feature branches diff clean.
# This moves HEAD past syncedHead — `yad check` would now rightly call the code-context stale.
( cd "$BACKEND" && git add -A && git commit -qm "chore: wire yad check gates" )

say "seed an epic at its review gate"
EPIC="$HUB/epics/EP-e2e"
mkdir -p "$EPIC/.sdlc"
printf -- '---\nowner: Alice\nrepos: [backend]\n---\n# EP-e2e\n' > "$EPIC/epic.md"
cat > "$EPIC/.sdlc/state.json" <<'EOF'
{"epicId":"EP-e2e","createdAt":"2026-06-13","currentStep":"epic-review","steps":[
 {"id":"epic","type":"author","artifact":"epic.md","assistance":"review","automation":"human_approve","locked":true,"status":"done","risk_tags":[]},
 {"id":"epic-review","type":"review+approve","artifact":"epic.md","assistance":"review","automation":"human_approve","locked":true,"status":"in_review","risk_tags":[]}
]}
EOF

say "yad gate open records the review PR"
yad gate open EP-e2e epic.md --dir "$HUB" || die "gate open failed"
jassert "$EPIC/.sdlc/hub-prs.json" 'j.length === 1 && j[0].number === 7 && j[0].artifact === "epic.md"'

say "gate sync holds while approvals are missing"
yad gate sync EP-e2e epic.md --dir "$HUB" || die "gate sync (pending) failed"
jassert "$EPIC/.sdlc/state.json" 'j.steps.find(s => s.id === "epic-review").status === "in_review"'
jassert "$EPIC/.sdlc/approvals.json" 'j.length === 1 && j[0].approver === "Bob" && j[0].role === "reviewer"'

say "gate sync advances on owner + reviewer + merge"
echo approved > "$E2E_GH_PHASE_FILE"
yad gate sync EP-e2e epic.md --dir "$HUB" || die "gate sync (approved) failed"
jassert "$EPIC/.sdlc/state.json" 'j.steps.find(s => s.id === "epic-review").status === "done" && j.currentStep === "ready-for-build"'
jassert "$EPIC/.sdlc/approvals.json" 'j.some(a => a.approver === "Alice" && a.role === "owner" && a.status === "approved")'
yad gate status EP-e2e --dir "$HUB" >/dev/null || die "gate status failed"

say "yad doctor is healthy on the fresh project"
yad doctor --dir "$HUB" >/dev/null || die "doctor must pass on a healthy project"

say "a corrupt ledger fails loudly (never silently defaulted)"
cp "$EPIC/.sdlc/approvals.json" "$WORK/approvals.bak"
echo '{ corrupt' > "$EPIC/.sdlc/approvals.json"
if yad gate sync EP-e2e epic.md --dir "$HUB" >/dev/null 2>&1; then
  die "gate sync must fail on a corrupt approvals.json"
fi
DOCTOR_OUT="$(yad doctor --json --dir "$HUB" || true)"
echo "$DOCTOR_OUT" | grep -q "YAD-STATE-001" || die "doctor must surface the corrupt ledger with YAD-STATE-001"
if yad doctor --dir "$HUB" >/dev/null 2>&1; then
  die "doctor must exit 1 while a ledger is corrupt"
fi
cp "$WORK/approvals.bak" "$EPIC/.sdlc/approvals.json"

say "yad commit derives the Task trailer from the branch"
( cd "$BACKEND" && git checkout -qb feat/EP-e2e-S01-T01-add-endpoint )
mkdir -p "$BACKEND/specs/EP-e2e-S01" "$BACKEND/src"
printf 'story: EP-e2e-S01\n' > "$BACKEND/specs/EP-e2e-S01/link.md"
printf 'export {};\n' > "$BACKEND/src/endpoint.js"
( cd "$BACKEND" && git add -A )
yad commit --dir "$BACKEND" --type feat -m "add endpoint" || die "yad commit failed"
git -C "$BACKEND" log -1 --format=%B | grep -q "Task: EP-e2e-S01-T01" || die "Task trailer missing from commit"

say "installed check gates pass on the linked branch"
( cd "$BACKEND" && bash checks/spec-link.sh main ) || die "spec-link should pass on a linked branch"
( cd "$BACKEND" && bash checks/contract-check.sh main ) || die "contract-check should pass when the surface is untouched"

say "check gates fail closed on violations"
( cd "$BACKEND" && git checkout -q main && git checkout -qb feat/unlinked )
mkdir -p "$BACKEND/src"
printf 'rogue\n' > "$BACKEND/src/rogue.js"
( cd "$BACKEND" && git add -A && git commit -qm "rogue: no trailer" )
if ( cd "$BACKEND" && bash checks/spec-link.sh main >/dev/null 2>&1 ); then
  die "spec-link must fail on an unlinked change"
fi
mkdir -p "$BACKEND/specs/EP-e2e-S01/contracts"
printf 'widened\n' > "$BACKEND/specs/EP-e2e-S01/contracts/api.md"
( cd "$BACKEND" && git add -A && git commit -qm "widen surface silently" )
if ( cd "$BACKEND" && bash checks/contract-check.sh main >/dev/null 2>&1 ); then
  die "contract-check must fail on a silent surface change"
fi

say "ALL E2E CHECKS PASSED"
