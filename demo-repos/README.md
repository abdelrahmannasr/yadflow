# demo-repos/ — throwaway code repos for the build half

These are **separate, throwaway git repos** used to exercise the Phase 3 build half on real code,
without coupling the product repo to any one application. They model the real architecture:

> **Per-repo specs in each code repo, one shared contract in the product repo.**
> (`docs/phase-3-build-plan.md`, Cross-cutting)

Each `demo-repos/<repo>/` has **its own `.git`** and is **gitignored** from this product repo
(`.gitignore`: `demo-repos/*/`, with `!demo-repos/README.md` keeping this file tracked). The product
repo never tracks these bytes and they are never a submodule — `git add demo-repos/<repo>` must not be
run. Only this README is version-controlled; the repos themselves are regenerable.

## What lives here

- `backend/` — a deliberately thin Node backend, just believable enough to be a valid Spec Kit target.
  Step A (`sdlc-spec`) writes its spec under `backend/specs/<story-id>/`.
- `mobile/` — a second thin repo, added for **Step F (multi-repo)**. A cross-repo story tagged
  `repos: [backend, mobile]` (e.g. `EP-istifta-inquiries-S03`) is spec'd and built in **both** repos
  independently, each pinning the **same** locked contract hash. Both carry the same gate scripts and
  PR template, so the contract-check blocks a surface bypass in either repo.

> Running the gates locally: these throwaway repos have **no remote**, so pass the base branch
> explicitly — e.g. `bash checks/contract-check.sh master` (the scripts default to `origin/main` and
> fail closed when it can't be resolved). Set `SDLC_BASE=master` to avoid repeating it.

## Regenerate `backend/`

```bash
cd demo-repos
mkdir -p backend/src/inquiry backend/.specify/memory
cd backend
git init -q
# minimal Node marker so Spec Kit detects a real project
printf '%s\n' '{ "name": "demo-backend", "private": true, "version": "0.0.0" }' > package.json
# thin placeholder so the repo is plausible (not a working service)
printf '%s\n' '// Inquiry service — placeholder for the demo backend.' > src/inquiry/index.js
# Spec Kit constitution stub (constitution itself is out of Step A scope)
printf '%s\n' '# Demo backend constitution (stub)' > .specify/memory/constitution.md
git add -A && git commit -qm "chore: scaffold throwaway demo backend"
```

Then run Step A from the product repo: `sdlc-spec` with `epic`, `story`, `repo` to generate
`backend/specs/<story-id>/` (spec/plan/tasks + `link.md`).
