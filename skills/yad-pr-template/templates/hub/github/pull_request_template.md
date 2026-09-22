<!-- SDLC HUB PR template — Shape artifact review (epic / architecture+contract / ui-design / stories). -->
<!-- This PR is a REVIEW VEHICLE on the Product, not a code merge. The file gate (yad-review-gate)
     advances the step when this PR is MERGED with the approvals met and every thread resolved. Reviewers
     approve/comment here; `yad gate sync` (or CI at merge, with a verified ledger) pulls that into the file ledger. -->

## Artifact under review
- Epic: `EP-<slug>`
- Artifact: `epic.md | architecture.md (+contract.md) | ui-design.md | stories/`
- Gate step: `<epic-review | architecture-review | ui-design-review | stories-review>`
- Owner: `<epic.md owner>`

## What changed
<!-- One or two sentences on what this artifact says / what changed since the last review round. -->

## Impact & Risk (front-half)
- **Domains / repos touched:** <epic.repos, e.g. backend, mobile>
- **Risk tags:** <none | contract | auth | payments>  <!-- contract/auth/payments => raises the advisory approver count -->
- **Contract surface:** <n/a | locked @ sha256:…>  <!-- architecture only; a re-lock invalidates prior approvals -->

## Required approvals (yad-review-gate rule)
- Full count, in **distinct people**: base 1 + the step's risk step — 3 on a `contract` step, 2 on
  `auth`/`payments`, 1 otherwise (the largest step, never the sum). No approval should be the author’s own.
- Enforced: **1 approval** (the base). The risk step is **advisory** until E73. `yad gate status <epic>`
  prints the count capped at the active people less one (one seat is left for the author), and
  `yad-hub-bridge`'s `hub-route.sh` run on this description prints the full count.
- No reviewers are requested automatically — ask them on this PR. The `domain:<repo>` labels show the touched repos.

## How to review (this drives the gate)
- **Approve** this PR to record your approval in the file ledger, under your platform login (no role).
- **Comment / request changes** to record review comments (synced into `reviews/<artifact>--<date>--comments.md`).
- **Merge to advance** — once the approvals are met and every thread is resolved, merging this PR moves the step (CI records it with a verified ledger; otherwise `yad gate sync`).

## Checklist
- [ ] `owner` set in the artifact frontmatter (inherited from `epic.md`)
- [ ] Contract re-locked (`.sdlc/contract-lock.json`) if the surface changed (architecture only — a short-lane epic has no architecture step and no lock, so tick this only if your route has one)
- [ ] Risk tags reflect the real surface touched (contract/auth/payments raise the approval count)
- [ ] No secrets or tokens in the artifact or this description
