<!-- SDLC HUB MR template — Shape artifact review (epic / architecture+contract / ui-design / stories). -->
<!-- This MR is a REVIEW VEHICLE on the product hub, not a code merge. The file gate (yad-review-gate)
     advances the step; do NOT rely on merging this MR to advance. Reviewers approve/comment here, then a
     `yad-review-gate action: sync` pulls that into the file ledger. -->
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
- **Risk tags:** <none | contract | auth | payments>  <!-- contract/auth/payments => escalates to domain owners -->
- **Contract surface:** <n/a | locked @ sha256:…>  <!-- architecture only; a re-lock invalidates prior approvals -->

## Checklist
- [ ] `owner` set in the artifact frontmatter (inherited from `epic.md`)
- [ ] Contract re-locked (`.sdlc/contract-lock.json`) if the surface changed (architecture only)
- [ ] Risk tags reflect the real surface touched (contract/auth/payments escalate)
- [ ] No secrets or tokens in the artifact or this description

## What changed
<!-- One or two sentences on what this artifact says / what changed since the last review round. -->

## Required approvals (yad-review-gate rule)
- Base: **owner + 1 reviewer**.
- Escalated (risk tag set, or a stories MR): **plus one domain-owner per touched repo** — see the
  reviewers / `domain:<repo>` labels on this MR. Run `bash checks/hub-route.sh <this-description>` to list them.

## How to review (this drives the gate)
- **Approve** this MR to record an `owner` / `reviewer` / `domain-owner` approval in the file ledger
  (your platform login maps to your SDLC name + role via `.sdlc/hub.json`'s roster).
- **Comment** to record review comments (synced into `reviews/<artifact>--<date>--comments.md`).
- **Do NOT merge to advance** — `yad-review-gate action: sync` + `action: advance` move the step.

/assign me
