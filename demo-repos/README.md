# demo-repos/ — throwaway code repos for Build

These are **separate, throwaway git repos** used to exercise the Phase 3 Build on real code,
without coupling a Product to any one application. They model the real architecture:

> **Per-repo specs in each code repo, one shared contract in the Product.**
> (`docs/phase-3-build-plan.md`, Cross-cutting)

Each `demo-repos/<repo>/` has **its own `.git`** and is **gitignored** from this repository
(`.gitignore`: `demo-repos/*/`, with `!demo-repos/README.md` keeping this file tracked). This
repository never tracks these bytes and they are never a submodule — `git add demo-repos/<repo>` must not be
run. Only this README is version-controlled; the repos themselves are regenerable.

## What lives here

- `backend/` — a deliberately thin Node backend, just believable enough to be a valid Spec Kit target.
  Step A (`yad-spec`) writes its spec under `backend/specs/<story-id>/`.
- `mobile/` — a second thin repo, added for **Step F (multi-repo)**. A cross-repo story tagged
  `repos: [backend, mobile]` (e.g. `EP-checkout-S03`) is spec'd and built in **both** repos
  independently, each pinning the **same** locked contract hash. Both carry the same gate scripts and
  PR template, so the contract-check blocks a surface bypass in either repo.

> Running the gates locally: the scripts resolve the trunk on their own — the configured
> `default_branch`, else the remote's published default (`origin/HEAD`), else `origin/main` — and fail
> closed when none of them resolves. These throwaway repos have **no remote**, so pass the base branch
> explicitly — e.g. `bash checks/contract-check.sh master`. Set `SDLC_BASE=master` to avoid repeating it.
>
> `yad open-pr` resolves its PR base the same way (`.sdlc/repos.json` `default_branch` → the platform's
> own default → `origin/HEAD` → `main`). The Product you run the demo from registers both demo repos
> with `"default_branch": "master"`, so it picks up `master` here without a `--base`.
>
> **This repository is no longer the demo Product** (2026-11-16): it is a code repo of yadflow's own
> Product, so it holds no `.sdlc/repos.json` registering these repos. The old demo Product is kept as
> `cli/fixtures/golden-v3/`, and its `repos.json` already registers `demo-repos/backend` and
> `demo-repos/mobile` with `master`. To run the demo:
>
> 1. Copy that folder to a scratch place, and go into the copy.
> 2. Run `yad migrate --apply` there (the fixture is an older project shape). It suggests `yad update`;
>    the demo does not need it.
> 3. Right after that, before any other yad command: the copy still names the public yadflow repo on
>    GitHub as its home. Run `git init -b main` in the copy, add `demo-repos/*/` to its `.gitignore` (the
>    one `yad migrate` just made), and set `platform` and `git_url` to `null` in its Product settings
>    (`.sdlc/product.json`, and `.sdlc/hub.json` while both exist: they must say the same). Then commit
>    everything in the copy: `git add -A && git commit -m "demo Product"`.
> 4. From the copy's root, make the two repos with the block below: once for `backend`, then, back at
>    the copy's root, once more with `mobile` in place of `backend`.

## Regenerate `backend/`

```bash
mkdir -p demo-repos && cd demo-repos
mkdir -p backend/src/order backend/.specify/memory
cd backend
git init -q -b master   # the fixture registers both repos on master
# minimal Node marker so Spec Kit detects a real project
printf '%s\n' '{ "name": "demo-backend", "private": true, "version": "0.0.0" }' > package.json
# thin placeholder so the repo is plausible (not a working service)
printf '%s\n' '// Order service — placeholder for the demo backend.' > src/order/index.js
# Spec Kit constitution stub (constitution itself is out of Step A scope)
printf '%s\n' '# Demo backend constitution (stub)' > .specify/memory/constitution.md
git add -A && git commit -qm "chore: scaffold throwaway demo backend"
cd ../..   # back to the copy's root
```

Then run Step A from the Product (your copy of the fixture): `yad-spec` with `epic`, `story`, `repo` to generate
`backend/specs/<story-id>/` (spec/plan/tasks + `link.md`).
