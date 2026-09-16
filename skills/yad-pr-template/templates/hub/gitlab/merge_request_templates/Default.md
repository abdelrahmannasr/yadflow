<!-- SDLC HUB MR template — Shape artifact review (epic / architecture+contract / ui-design / stories). -->
<!-- This MR is a REVIEW VEHICLE on the Product, not a code merge. The file gate (yad-review-gate)
     advances the step when this MR is MERGED with the approvals met and every thread resolved. Reviewers
     approve/comment here; `yad gate sync` (or CI at merge, with a verified ledger) pulls that into the file ledger. -->
<!-- GITLAB 2700-CHARACTER LIMIT: the yad-pr-template gate reads $CI_MERGE_REQUEST_DESCRIPTION, which
     GitLab truncates at 2700 characters — a heading past the cutoff reads as missing. The required
     sections come first for that reason; keep long narrative last. Reorder, never delete. -->

## Artifact under review
- Epic: `EP-<slug>`
- Artifact: `epic.md | architecture.md (+contract.md) | ui-design.md | stories/`
- Gate step: `<epic-review | architecture-review | ui-design-review | stories-review>`
- Owner: `<epic.md owner>`

## Impact & Risk (front-half)
- **Domains / repos touched:** <epic.repos, e.g. backend, mobile>
- **Risk tags:** <none | contract | auth | payments>  <!-- contract/auth/payments => raises the advisory approver count -->
- **Contract surface:** <n/a | locked @ sha256:…>  <!-- architecture only; a re-lock invalidates prior approvals -->

## Checklist
- [ ] `owner` set in the artifact frontmatter (inherited from `epic.md`)
- [ ] Contract re-locked (`.sdlc/contract-lock.json`) if the surface changed (architecture only — a short-lane epic has no architecture step and no lock, so tick this only if your route has one)
- [ ] Risk tags reflect the real surface touched (contract/auth/payments raise the approval count)
- [ ] No secrets or tokens in the artifact or this description

## What changed
<!-- One or two sentences on what this artifact says / what changed since the last review round. -->

## Required approvals (yad-review-gate rule)
- Enforced: **1 approval, which should not be the author’s own** (the base).
- Full count, in **distinct people**: base 1 + the step's risk step — 3 on a `contract` step, 2 on
  `auth`/`payments`, 1 otherwise (the largest step, never the sum). The risk step is **advisory** until
  the capacity cap; `yad gate status <epic>` prints it, and so does `yad-hub-bridge`'s `hub-route.sh`
  run on this description.
- No reviewers are requested automatically — ask them on this MR. The `domain:<repo>` labels show the touched repos.

## How to review (this drives the gate)
- **Approve** this MR to record your approval in the file ledger, under your platform login (no role).
- **Comment** to record review comments (synced into `reviews/<artifact>--<date>--comments.md`).
- **Merge to advance** — once the approvals are met and every thread is resolved, merging this MR moves the step (CI records it with a verified ledger; otherwise `yad gate sync`).

/assign me
