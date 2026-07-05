import type { Module } from './types';

// The guided tutorial content. Each lesson teaches one concept, names the exact
// command, the file it produces, and ends with a comprehension check.
// Sourced from TEAM-GUIDE.md and docs/WALKTHROUGH.md — keep them in sync.

export const MODULES: Module[] = [
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'why',
    number: 1,
    title: 'Why Yadflow',
    blurb: 'The problem it solves and the one idea behind it.',
    icon: 'lightbulb',
    level: 'beginner',
    lessons: [
      {
        id: 'why-problem',
        title: 'The problem: ungoverned AI code',
        duration: '4 min',
        level: 'beginner',
        summary: 'Why shipping fast with AI quietly becomes a governance problem.',
        body: [
          { kind: 'p', text: 'AI writes code faster than any team can review it. That speed is real — and so is the risk that comes with it.' },
          { kind: 'p', text: 'Left ungoverned, AI-assisted teams drift into three failures: unreviewed AI-generated changes merge straight into the codebase; architectural decisions get made by autocomplete instead of by people; and the trail of **why** a change was made disappears.' },
          { kind: 'callout', tone: 'key', text: 'The faster a team ships with AI, the harder it becomes to keep control of quality, architecture, and accountability. Yadflow exists to put that control back — without slowing the build to a crawl.' },
          { kind: 'p', text: 'Yadflow is not another code generator. It is the **governance layer** around AI-assisted development: the wall between "the AI proposed this" and "we shipped this".' },
        ],
        quiz: [
          {
            q: 'What problem is Yadflow built to solve?',
            options: [
              'Generating code faster than a human could',
              'Keeping AI-assisted teams in control of quality, architecture, and the audit trail',
              'Replacing code review with an AI reviewer',
              'Hosting your git repositories',
            ],
            answer: 1,
            explain: 'Yadflow is a governance layer — it keeps a human in control of every step, rather than generating code or replacing review.',
          },
        ],
      },
      {
        id: 'why-idea',
        title: 'The one idea: AI builds, the hand decides',
        duration: '5 min',
        level: 'beginner',
        summary: 'Gates, files, and the human hand on every step.',
        body: [
          { kind: 'p', text: 'Yadflow (from **يد**, Arabic for "hand") puts a human gate on every step of the lifecycle. Each step does its work, writes its output to a plain file, and then **waits**.' },
          { kind: 'p', text: 'A step never advances until a human approves it — or, later, until a step has *earned* the right to advance on its own. That is the whole idea.' },
          { kind: 'list', items: [
            'Every step writes an **artifact** (a file) and stops.',
            'A **gate** is a human review that the artifact must pass.',
            'All state lives in files you can read, diff, and edit — no database, nothing hidden.',
          ] },
          { kind: 'callout', tone: 'info', text: 'Because everything is a file, the audit trail *is* the repository. You can answer "why is this here?" with `git log`, not a meeting.' },
        ],
        quiz: [
          {
            q: 'Where does Yadflow keep its state?',
            options: [
              'In a hosted database',
              'In plain files in the repository',
              'Only in memory while the agent runs',
              'In your IDE settings',
            ],
            answer: 1,
            explain: 'All state — artifacts, approvals, the contract lock, the build log — lives in plain files. No database.',
          },
        ],
      },
      {
        id: 'why-two-halves',
        title: 'Two halves, and earned automation',
        duration: '4 min',
        level: 'beginner',
        summary: 'Front half decides; build half builds; automation is opt-in.',
        body: [
          { kind: 'p', text: 'The lifecycle has two halves. The **front half** is where you decide — the epic, the architecture and its locked contract, the UI, the stories. It is always human-gated; nothing auto-advances.' },
          { kind: 'p', text: 'The **build half** is where you build — once per story, per code repo: spec → implement → checks → ship.' },
          { kind: 'callout', tone: 'key', text: 'Automation is opt-in and earned. A safe build-half step can earn the right to auto-advance only after it proves itself — and one command reverts everything to manual. The engineer review and every front-half step are never automatable.' },
        ],
        quiz: [
          {
            q: 'Which steps can NEVER be automated?',
            options: [
              'The build-half checks',
              'The spec step',
              'The engineer review and every front-half step',
              'None — everything can be automated',
            ],
            answer: 2,
            explain: 'The engineer review and all front-half states stay human-approved permanently. Only safe back-half steps can earn automation.',
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'map',
    number: 2,
    title: 'The map',
    blurb: 'The repos involved and the lifecycle at a glance.',
    icon: 'map',
    level: 'beginner',
    lessons: [
      {
        id: 'map-repos',
        title: 'The repos: hub vs code',
        duration: '5 min',
        level: 'beginner',
        summary: 'The product hub holds the thinking; code repos hold the code.',
        body: [
          { kind: 'p', text: 'A Yadflow project spans separate git repos, each with one job:' },
          { kind: 'list', items: [
            '**yadflow** — the skills source. You install the workflow from here and pull updates. No product work happens inside it.',
            '**product hub** — the thinking. All epics, contracts, stories, reviews, and state, under `epics/EP-<slug>/`.',
            '**code repos** (one or more) — the real application code. Each story\'s spec lives here too, and every PR links back to its story in the hub.',
          ] },
          { kind: 'callout', tone: 'key', text: 'The handoff rule: everything up to and including the locked contract lives in the product hub. Everything from the spec onward (specs, tasks, code) lives in each code repo.' },
        ],
        quiz: [
          {
            q: 'Where does the locked contract live?',
            options: [
              'In every code repo',
              'In the product hub',
              'In the yadflow skills source',
              'In a database',
            ],
            answer: 1,
            explain: 'The contract is singular and lives in the product hub. Code repos quote it but never own it.',
          },
        ],
      },
      {
        id: 'map-lifecycle',
        title: 'The lifecycle at a glance',
        duration: '4 min',
        level: 'beginner',
        summary: 'Setup → front half → build half → (earned) automation.',
        body: [
          { kind: 'p', text: 'Setup is one-time. Then, for each feature (epic), you run the front half in the hub; once stories are approved the epic is `ready-for-build` and the build half runs per story per repo.' },
          { kind: 'steps', items: [
            'Setup (once): install skills, connect repos, wire CI gates.',
            'Front half (per epic): epic → architecture → UI → stories → test cases. Every artifact is gated.',
            'Build half (per story per repo): spec → implement → checks → ship.',
            'Automation (optional, earned): let safe build-half steps auto-advance once they prove themselves.',
          ] },
          { kind: 'callout', tone: 'info', text: 'Lost? `yad-status` is a read-only view of where any epic is and what is blocking it. Start there.' },
        ],
        commands: [
          { cmd: 'yad next', note: 'project-wide: the one next action to take — including the next build sub-step per story/repo once you reach the build half' },
          { cmd: 'yad-status', note: 'read-only: where every epic is and what is blocking it' },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'setup',
    number: 3,
    title: 'One-time setup',
    blurb: 'Install, connect your repos, wire the gates.',
    icon: 'rocket_launch',
    level: 'beginner',
    lessons: [
      {
        id: 'setup-install',
        title: 'Install with the guided wizard',
        duration: '6 min',
        level: 'beginner',
        summary: 'npx yadflow setup walks a short profile interview, then installs.',
        body: [
          { kind: 'p', text: 'From your product hub repo (an empty git repo is fine — the first epic creates its own files), run the guided wizard. It opens with a short profile interview — solo or team? greenfield or brownfield? monorepo or separate repos? — and branches the rest so you only answer what your situation needs.' },
          { kind: 'p', text: 'It installs the skills into your IDE skill directories, detects your hub platform (GitHub/GitLab) from the remote, and sets up the reviewer roster.' },
          { kind: 'callout', tone: 'info', text: 'Re-run `npx yadflow check --fix` after any workflow update — it reports what is missing / drifted / stale and reconciles only what changed. It never re-asks for what you already answered.' },
        ],
        commands: [
          { cmd: 'cd <product-hub-repo>' },
          { cmd: 'npx yadflow setup', note: 'guided profile interview + install' },
          { cmd: 'npx yadflow check --fix', note: 'reconcile after any update' },
        ],
        produces: ['.sdlc/hub.json', '.sdlc/cli-version.json', 'skills installed in .claude/ (and other IDE dirs)'],
        quiz: [
          {
            q: 'What does the setup wizard open with?',
            options: [
              'A license agreement',
              'A short profile interview (solo/team, greenfield/brownfield, monorepo/separate)',
              'A request for an API key',
              'A choice of database',
            ],
            answer: 1,
            explain: 'The profile interview branches the rest of setup so you only answer what your situation needs.',
          },
        ],
      },
      {
        id: 'setup-connect',
        title: 'Connect your code repos',
        duration: '5 min',
        level: 'beginner',
        summary: 'Cache a code-map so the front half knows what already exists.',
        body: [
          { kind: 'p', text: 'Connecting a code repo registers it in `.sdlc/repos.json` and caches an AI-readable picture of it — a Repomix pack plus a lightweight **code-map** of its existing endpoints, events, data-models, and modules (secret-scanned).' },
          { kind: 'p', text: 'The front-half steps then read that map, so the architecture cross-checks the contract against code that already exists, the UI reuses existing components, and stories anchor to real modules.' },
          { kind: 'callout', tone: 'info', text: 'It clones/fetches as **you** — your own SSH key or git credential helper, GitHub or GitLab, no stored tokens. Greenfield with no code yet? Skip it; the brain just proceeds.' },
        ],
        commands: [
          { cmd: 'yad-connect-repos action: connect repo:<repo> path:<path-or-git_url> domain_owner:<who>' },
          { cmd: 'yad repo list', note: 'show connected repos as fresh / stale' },
          { cmd: 'yad repo refresh <repo>', note: 're-pack a repo whose code has moved' },
          { cmd: 'yad repo refresh <repo> --push', note: 'publish the refreshed code-maps and .sdlc/repos.json to the hub default branch (chore(hub) audit commit)' },
        ],
        produces: ['.sdlc/repos.json', '.sdlc/code-context/<repo>/pack.md', '.sdlc/code-context/<repo>/code-map.md'],
      },
      {
        id: 'setup-wire',
        title: 'Wire the gates (and optional tools)',
        duration: '6 min',
        level: 'beginner',
        summary: 'Install CI gates, the PR template, and review scaffolds per repo.',
        body: [
          { kind: 'p', text: 'Wire each code repo once. Wiring is **additive** — `yad-checks` detects any CI you already have and merges its gates in; it never edits a foreign workflow. Re-running a wire is a no-op.' },
          { kind: 'p', text: 'Optional tools plug in and the workflow **degrades gracefully** if they are absent: a design tool (Figma) lets `yad-ui` materialize screens; a testing tool (Playwright) lets `yad-test-cases` implement automation; a learning tool (DeepTutor) powers in-context tutoring. You can start with none of them.' },
        ],
        commands: [
          { cmd: 'yad-checks          repo:<repo> action: wire', note: 'install the CI gates (merges with existing CI)' },
          { cmd: 'yad-pr-template     repo:<repo> action: wire', note: 'PR/MR template + risk routing' },
        ],
        produces: ['.github/workflows/yad-checks.yml (or GitLab include)', 'PR/MR template'],
        quiz: [
          {
            q: 'What happens when you wire gates into a repo that already has CI?',
            options: [
              'It overwrites the existing CI',
              'It refuses to run',
              'It merges the gates in additively, never editing your existing workflows',
              'It deletes the old workflow and starts fresh',
            ],
            answer: 2,
            explain: 'Wiring is additive — yad-checks adds a separate workflow/include and never touches a foreign one.',
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'front',
    number: 4,
    title: 'Your first epic',
    blurb: 'The front half — author and gate the thinking.',
    icon: 'edit_document',
    level: 'intermediate',
    lessons: [
      {
        id: 'front-epic',
        title: 'yad-epic — start a feature',
        duration: '6 min',
        level: 'intermediate',
        summary: 'Shape the idea, write epic.md, get a stable EP-<slug> ID.',
        body: [
          { kind: 'p', text: 'Run `yad-epic` in the product hub. With the analyst and pm lenses it shapes the idea and writes `epic.md`. It assigns the stable `EP-<slug>` ID and seeds the epic\'s state (`.sdlc/state.json`, all human-approve, front steps locked).' },
          { kind: 'p', text: 'When the step finishes it sets itself `done`, moves `currentStep` to the epic review, and **stops at the gate**. You clear the gate before moving on (next module).' },
          { kind: 'callout', tone: 'warn', text: 'IDs are immutable once assigned. Renaming an EP-<slug> breaks every downstream link (stories, tasks, branches, PRs).' },
        ],
        commands: [{ cmd: 'run yad-epic', note: 'invoke the skill by name in your AI IDE' }],
        produces: ['epics/EP-<slug>/epic.md', '.sdlc/state.json', '.sdlc/approvals.json'],
        quiz: [
          {
            q: 'After yad-epic writes epic.md, what does it do?',
            options: [
              'Immediately starts writing the architecture',
              'Sets the step done and stops at the epic review gate',
              'Opens a pull request and merges it',
              'Deletes the draft',
            ],
            answer: 1,
            explain: 'Every author step writes its artifact, marks itself done, moves to its review, and stops. A human clears the gate.',
          },
        ],
      },
      {
        id: 'front-architecture',
        title: 'yad-architecture — the locked contract',
        duration: '7 min',
        level: 'intermediate',
        summary: 'Author architecture.md plus the hash-locked contract surface.',
        body: [
          { kind: 'p', text: 'Run `yad-architecture` with the architect lens. It authors `architecture.md` and the **locked** `contract.md` — the shared cross-repo surface (endpoints, events, data-models) that every code repo must honor.' },
          { kind: 'p', text: 'It then hash-locks the contract surface into `.sdlc/contract-lock.json`. From here on, any code change that touches that surface must declare it and re-lock — otherwise CI fails and routes back to this gate.' },
          { kind: 'callout', tone: 'key', text: 'The architecture review is **escalated**: it needs the base approvals plus a domain owner for every repo in the epic. Changing the locked surface invalidates existing approvals.' },
        ],
        commands: [{ cmd: 'run yad-architecture' }],
        produces: ['epics/EP-<slug>/architecture.md', 'epics/EP-<slug>/contract.md (locked)', '.sdlc/contract-lock.json'],
        quiz: [
          {
            q: 'What does hash-locking the contract surface protect against?',
            options: [
              'Slow CI runs',
              'A code change quietly altering the shared cross-repo surface without review',
              'Two people editing the same file',
              'Merge conflicts in the UI',
            ],
            answer: 1,
            explain: 'The lock makes any change to the agreed surface explicit and re-reviewed — a silent bypass fails the contract-check gate.',
          },
        ],
      },
      {
        id: 'front-ui',
        title: 'yad-ui — the design',
        duration: '4 min',
        level: 'intermediate',
        summary: 'Author ui-design.md and DESIGN.md; materialize screens if a design tool is connected.',
        body: [
          { kind: 'p', text: 'Run `yad-ui` with the ux-designer lens to author `ui-design.md` and `DESIGN.md`. If a design tool is connected, it also materializes the actual screens (mobile/web) in the tool and records the screen→frame map; otherwise it stays markdown-only.' },
          { kind: 'p', text: 'The UI review uses the base rule (owner + 1 reviewer).' },
        ],
        commands: [{ cmd: 'run yad-ui' }],
        produces: ['epics/EP-<slug>/ui-design.md', 'epics/EP-<slug>/DESIGN.md'],
      },
      {
        id: 'front-stories',
        title: 'yad-stories — break it down',
        duration: '6 min',
        level: 'intermediate',
        summary: 'Repo-tagged stories with stable IDs — reaching ready-for-build.',
        body: [
          { kind: 'p', text: 'Run `yad-stories` with the pm lens to break the approved epic into user stories, one file per story, each tagged with the repos that must implement it. Stories get zero-padded `EP-<slug>-S0N` IDs.' },
          { kind: 'p', text: 'The stories review is **per-repo**: base rule plus a domain owner for every repo any story touches.' },
          { kind: 'callout', tone: 'key', text: 'When the stories gate passes, the epic state reaches `currentStep: ready-for-build`. You can start building now.' },
        ],
        commands: [{ cmd: 'run yad-stories' }],
        produces: ['epics/EP-<slug>/stories/EP-<slug>-S0N.md (one per story)'],
        quiz: [
          {
            q: 'What milestone does passing the stories gate reach?',
            options: [
              'shipped',
              'ready-for-build',
              'discovery-done',
              'in-review',
            ],
            answer: 1,
            explain: 'Once stories are approved the epic is ready-for-build and the build half can start.',
          },
        ],
      },
      {
        id: 'front-test-cases',
        title: 'yad-test-cases — the parallel track',
        duration: '4 min',
        level: 'intermediate',
        summary: 'Author test cases alongside the build half — non-blocking.',
        body: [
          { kind: 'p', text: 'Run `yad-test-cases` with the test architect lens to author `test-cases.md` covering the approved stories (risk-based P0–P3 cases with story→case traceability). When a testing tool is connected it also implements the automation tests.' },
          { kind: 'callout', tone: 'info', text: 'This track is **parallel and non-blocking**: it opens when the stories gate passes and runs alongside the build half. Its review never moves the epic off `ready-for-build`.' },
        ],
        commands: [{ cmd: 'run yad-test-cases' }],
        produces: ['epics/EP-<slug>/test-cases.md'],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'gate',
    number: 5,
    title: 'The review gate',
    blurb: 'How every review works, and who must approve.',
    icon: 'gavel',
    level: 'intermediate',
    lessons: [
      {
        id: 'gate-loop',
        title: 'open → comment → approve → advance',
        duration: '6 min',
        level: 'intermediate',
        summary: 'One gate, reused for every front-half review.',
        body: [
          { kind: 'p', text: 'Every front-half review is the same loop, run with `yad-review-gate`. Commenting never advances the step; only `advance` moves it forward, and only when the rule is met.' },
          { kind: 'steps', items: [
            'open — present the artifact; reviewers leave comments.',
            'comment — the owner addresses notes, editing in place. (This never advances.)',
            'approve — a reviewer approves with name + role, recorded in approvals.json.',
            'advance — moves forward only if the rule is satisfied; otherwise it names who is still missing.',
          ] },
          { kind: 'callout', tone: 'warn', text: 'Approvals are revoked when the reviewed artifact actually changes (it is re-hashed) — so a late edit gives reviewers a fresh pass instead of sneaking through.' },
        ],
        commands: [
          { cmd: 'yad-review-gate action: open' },
          { cmd: 'yad-review-gate action: approve', note: 'name + role → approvals.json' },
          { cmd: 'yad-review-gate action: advance', note: 'moves only if the rule is met' },
        ],
        quiz: [
          {
            q: 'In the review gate, what advances a step?',
            options: [
              'Leaving a comment',
              'Only the advance action, once the approval rule is satisfied',
              'Closing the IDE',
              'Any reviewer opening the file',
            ],
            answer: 1,
            explain: 'Commenting never advances. Only advance moves the step, and only when the rule is met.',
          },
        ],
      },
      {
        id: 'gate-pr',
        title: 'PR-driven vs file-only',
        duration: '5 min',
        level: 'intermediate',
        summary: 'The same gate over a real PR/MR when the hub is on a platform.',
        body: [
          { kind: 'p', text: 'With no hub platform, the gate runs **file-only**: comments and approvals are recorded as files and you end with an explicit `advance`.' },
          { kind: 'p', text: 'When the hub is on GitHub/GitLab, the `yad gate` CLI runs the same gate over a real PR/MR. `open` raises the review PR; `sync` pulls approvals and comment threads into the file ledger; the step **auto-advances when the approved, fully-resolved PR is merged** — the merge click is the human approval act.' },
          { kind: 'callout', tone: 'info', text: 'The file ledger always stays the source of truth. The platform is just a nicer surface for the same predicate.' },
        ],
        commands: [
          { cmd: 'yad gate open <epic> <artifact>', note: 'raise the review PR/MR' },
          { cmd: 'yad gate sync <epic>', note: 'pull approvals + threads into the ledger' },
          { cmd: 'yad gate status <epic>', note: 'show recorded approvals' },
        ],
      },
      {
        id: 'gate-rules',
        title: 'Who approves what',
        duration: '4 min',
        level: 'intermediate',
        summary: 'The base rule and its escalations.',
        body: [
          { kind: 'p', text: 'The base rule is **owner + 1 reviewer**, with escalation on risky surfaces (contract, auth, payments):' },
          { kind: 'list', items: [
            '**Epic, UI** — owner + 1 reviewer.',
            '**Architecture + contract** — base, plus a domain owner for every repo in the epic. The surface is hash-locked.',
            '**Stories** — base, plus a domain owner for every repo any story touches.',
            '**Engineer review at ship** — a human engineer, always, never automated.',
          ] },
        ],
        quiz: [
          {
            q: 'The architecture review escalates beyond the base rule. What does it add?',
            options: [
              'Nothing — it uses the base rule',
              'A domain owner for every repo in the epic',
              'Approval from the CEO',
              'A second AI review',
            ],
            answer: 1,
            explain: 'Because it locks the shared contract, architecture needs a domain owner per repo on top of owner + reviewer.',
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'build',
    number: 6,
    title: 'Building a story',
    blurb: 'The build half — turn a story into shipped code.',
    icon: 'construction',
    level: 'intermediate',
    lessons: [
      {
        id: 'build-spec',
        title: 'yad-spec — spec the story',
        duration: '5 min',
        level: 'intermediate',
        summary: 'Run the Spec Kit ceremony once per story per repo.',
        body: [
          { kind: 'p', text: 'From a `ready-for-build` story, inside a code repo it is tagged with, run `yad-spec`. It runs the Spec Kit ceremony once (specify → clarify → plan → analyze → checklist → tasks), writing `specs/<story-id>/` and a `link.md` back to the story.' },
          { kind: 'callout', tone: 'key', text: 'The spec **quotes** the locked contract — it never widens it. The contract stays singular in the hub.' },
        ],
        commands: [{ cmd: 'yad-spec story:<id> repo:<repo>' }],
        produces: ['specs/<story-id>/ (spec, plan, tasks)', 'specs/<story-id>/link.md'],
      },
      {
        id: 'build-implement',
        title: 'yad-implement — one task, one branch',
        duration: '6 min',
        level: 'intermediate',
        summary: 'Implement a single atomic task as a small, contained diff.',
        body: [
          { kind: 'p', text: 'Run `yad-implement` for one task. The rule is **one atomic task = one branch = one commit**. The diff stays inside the files the task declared — if it would grow beyond them, the step flags it and stops.' },
          { kind: 'p', text: 'Commit by convention with `yad commit`: it builds the Conventional subject, derives the `Task:` trailer from the branch, appends an optional `--ai` co-author, and refuses a non-atomic stage. Add `--contract-change` only if the locked surface is touched.' },
        ],
        commands: [
          { cmd: 'yad-implement story:<id> repo:<repo> task:<T0N>' },
          { cmd: 'yad commit --type feat -m "<subject>" --ai claude' },
        ],
        produces: ['a feature branch with one atomic, convention-compliant commit'],
        quiz: [
          {
            q: 'What is the atomic unit of the implement step?',
            options: [
              'A whole story in one commit',
              'One task = one branch = one commit, staying inside the declared files',
              'The entire epic at once',
              'Whatever the AI decides to change',
            ],
            answer: 1,
            explain: 'Each task is one small, contained diff on its own branch. Overrunning the declared files halts the step.',
          },
        ],
      },
      {
        id: 'build-checks',
        title: 'yad-checks — the CI gates',
        duration: '6 min',
        level: 'intermediate',
        summary: 'The production-safety gates that must pass before merge.',
        body: [
          { kind: 'p', text: 'The check gates protect production. They run in CI (GitHub Actions and GitLab CI) and must pass before merge:' },
          { kind: 'list', items: [
            '**spec-link** — every change links a real story/spec.',
            '**contract-check** — a contract-surface change without a declared, re-locked contract FAILS and routes back to the architecture gate.',
            '**build / test / lint** — the usual.',
            '**verified-commits** — every commit is signed with a platform-Verified key and authored by a roster-known email.',
            '**pattern gates** — commit-message, pr-title, and pr-template conventions.',
          ] },
          { kind: 'callout', tone: 'info', text: 'These exist already in Yadflow — wiring them is a one-time setup step. This is the "preventing bad AI code from reaching the PR" wall.' },
        ],
        commands: [{ cmd: 'yad-checks repo:<repo> action: run' }],
        quiz: [
          {
            q: 'What happens if a diff changes the locked contract surface without declaring it?',
            options: [
              'Nothing — it merges normally',
              'The contract-check gate fails and routes back to the architecture gate',
              'It is silently auto-approved',
              'The commit is deleted',
            ],
            answer: 1,
            explain: 'contract-check fails closed on an undeclared surface change and sends it back to architecture for re-lock and re-review.',
          },
        ],
      },
      {
        id: 'build-ship',
        title: 'yad-engineer-review — ship it',
        duration: '5 min',
        level: 'intermediate',
        summary: 'AI review (advisory) → engineer review (human) → merge.',
        body: [
          { kind: 'p', text: 'Finally, `yad-engineer-review`: an AI review (CodeRabbit) runs first as an **advisory** pass — never the authority. Then a human engineer approves (owner + 1 reviewer, escalating to domain owners).' },
          { kind: 'p', text: 'On merge, the ship is recorded in `build-log.json` and the story moves to `in-build` → `shipped`. The epic → story → task → PR → merge-commit chain stays traceable both ways.' },
          { kind: 'callout', tone: 'key', text: 'A story tagged for multiple repos runs the whole build half in each repo independently, all from the one locked contract.' },
        ],
        commands: [{ cmd: 'run yad-engineer-review' }],
        produces: ['.sdlc/build-log.json (append-only)', 'story status → shipped'],
        quiz: [
          {
            q: 'What role does the AI review (CodeRabbit) play at ship time?',
            options: [
              'It is the final authority that merges the PR',
              'An advisory first pass — a human engineer still approves',
              'It replaces the human engineer',
              'It is skipped entirely',
            ],
            answer: 1,
            explain: 'AI review is advisory. The human engineer review is the gate, and it is never automated.',
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'change',
    number: 7,
    title: 'Changing a shipped feature',
    blurb: 'Post-lock changes, defects, and hotfixes via threads.',
    icon: 'account_tree',
    level: 'advanced',
    lessons: [
      {
        id: 'change-threads',
        title: 'Why you do not edit locked artifacts',
        duration: '5 min',
        level: 'advanced',
        summary: 'A feature is a thread of epics; changes supersede, never mutate.',
        body: [
          { kind: 'p', text: 'Once a feature\'s contract is locked and its stories ship, you do not edit the locked artifacts — that would destroy the audit trail and the lock. Instead you open a **new epic threaded to the original**.' },
          { kind: 'p', text: 'A feature becomes a *thread* of epics (genesis → change → defect → …). The new epic **inherits** everything it does not change (by reference) and **re-authors only what it does**. Old artifacts are not stale — they are *superseded*.' },
          { kind: 'callout', tone: 'warn', text: 'You will know you need this when CI fails with `epic-open: targets SEALED epic …` — the epic is fully shipped and a new change must go in its own threaded epic.' },
        ],
        commands: [{ cmd: 'yad thread <epic>', note: 'show the thread + resolved current truth + open debt' }],
        quiz: [
          {
            q: 'How do you change a feature whose epic is already sealed (all stories shipped)?',
            options: [
              'Edit the locked contract.md directly',
              'Open a new epic threaded to the original, re-authoring only what changes',
              'Delete the old epic and start over',
              'Force-merge past the gate',
            ],
            answer: 1,
            explain: 'Changes go in a new threaded epic that inherits the unchanged artifacts and re-authors only what changes.',
          },
        ],
      },
      {
        id: 'change-intake',
        title: 'yad-change — intake and triage',
        duration: '6 min',
        level: 'advanced',
        summary: 'Classify the change depth; re-author only what it touches.',
        body: [
          { kind: 'p', text: 'Run `yad-change` with the parent epic, a title, and the kind (change / defect / hotfix). For a defect or hotfix, also give the origin, severity, the **escape_stage** (which gate should have caught it) and the root cause.' },
          { kind: 'p', text: 'It triages the **depth** and tells you what to re-author vs inherit:' },
          { kind: 'list', items: [
            '**defect-fix** — re-author stories (a regression story) + test-cases; inherit the rest.',
            '**behavioral change, surface unchanged** — re-author stories + test-cases (+ UI if visible); inherit architecture/contract.',
            '**contract-surface change** — re-author architecture (it re-locks and re-routes the escalated review) + stories + test-cases.',
          ] },
          { kind: 'p', text: 'Then you author and gate only the re-authored artifacts, and build + ship the change-epic\'s story the normal way. A defect\'s regression test is the durable memory of the bug.' },
        ],
        commands: [{ cmd: 'yad-change parent:<epic> title:"…" kind:<change|defect|hotfix>' }],
        produces: ['a new threaded EP-<slug> with inherited steps pre-approved', 'change.json (+ reconcile-debt.json for hotfixes)'],
      },
      {
        id: 'change-hotfix',
        title: 'Hotfixes and reconcile debt',
        duration: '4 min',
        level: 'advanced',
        summary: 'Ship the fix first, but pay down the debt before the next change.',
        body: [
          { kind: 'p', text: 'A hotfix may ship the fix **first** — an outage cannot wait for the front gates. But `yad-change` opens **reconcile debt**: the thread\'s next change is blocked until you pay it down by updating the front artifacts and adding a regression test.' },
          { kind: 'callout', tone: 'info', text: '`yad reconcile` and `yad doctor` both surface open debt. `yad-defects` shows which gate your defects keep escaping at — so you fix the stage, not just the symptom.' },
        ],
        commands: [
          { cmd: 'yad reconcile', note: 'sweep threads for drift / orphans / open debt' },
          { cmd: 'run yad-defects', note: 'quality-gap report by escape stage + root cause' },
        ],
        quiz: [
          {
            q: 'After an emergency hotfix ships first, what does reconcile debt enforce?',
            options: [
              'Nothing — the hotfix is final',
              'The thread\'s next change is blocked until the front artifacts are updated and a regression test added',
              'The whole repo is frozen forever',
              'An automatic rollback',
            ],
            answer: 1,
            explain: 'Hotfixes can skip the front gates to ship fast, but the debt must be paid before the next change proceeds.',
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'automation',
    number: 8,
    title: 'Automation, earned',
    blurb: 'The two dials, earning machine-advance, the kill switch.',
    icon: 'tune',
    level: 'advanced',
    lessons: [
      {
        id: 'auto-dials',
        title: 'The two dials',
        duration: '5 min',
        level: 'advanced',
        summary: 'assistance = how much AI helps; automation = who advances.',
        body: [
          { kind: 'p', text: 'Each step has two independent dials:' },
          { kind: 'list', items: [
            '**assistance** — none | review | heavy — how much the AI helps.',
            '**automation** — human_approve | machine_advance — who advances the step.',
          ] },
          { kind: 'p', text: 'Every step starts at `human_approve`. The front authoring steps and their reviews are **locked** — they may never be set to machine_advance. The engineer review is locked too.' },
        ],
        quiz: [
          {
            q: 'What does the automation dial control?',
            options: [
              'How much the AI helps write the artifact',
              'Who advances the step — a human, or the machine once earned',
              'The CI runner size',
              'The font of the docs site',
            ],
            answer: 1,
            explain: 'assistance = how much AI helps; automation = who advances. Front states and the engineer review stay human_approve.',
          },
        ],
      },
      {
        id: 'auto-earn',
        title: 'Earning machine-advance + the kill switch',
        duration: '5 min',
        level: 'advanced',
        summary: 'A step earns automation with evidence; revert in one move.',
        body: [
          { kind: 'p', text: 'Automation is **earned with evidence and reversible in one move**. The orchestrator `yad-run` drives a story\'s back half, recording every run\'s verdict in a trust log. A diff merged as authored is `approved-unchanged`; one edited first is `approved-with-edits`; a failed one is `rejected`.' },
          { kind: 'p', text: 'Once a step\'s trust record clears the threshold (default ≥5 runs and ≥80% unchanged), you can flip it to machine_advance. The setter refuses if the evidence is short, or for any front state or the engineer review.' },
          { kind: 'callout', tone: 'key', text: 'The kill switch is instant: `yad-run action: kill` forces every step back to human_approve system-wide. `action: unkill` restores earned automation. No code change, no per-step edits.' },
        ],
        commands: [
          { cmd: 'yad-run story:<id> repo:<repo>', note: 'drive the back half on the dials' },
          { cmd: 'yad-run action: set-dial step: checks to: machine_advance', note: 'flip an earned step' },
          { cmd: 'yad-run action: kill', note: 'everything → manual, instantly' },
        ],
        quiz: [
          {
            q: 'Can you set a step to machine_advance whenever you like?',
            options: [
              'Yes, any step at any time',
              'Only once its trust record clears the threshold — and never for front states or the engineer review',
              'No, automation does not exist',
              'Only by editing the database',
            ],
            answer: 1,
            explain: 'A step must earn automation with trust evidence; front states and the engineer review are permanently locked to human_approve.',
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'reference',
    number: 9,
    title: 'Reference',
    blurb: 'Naming, handy commands, and where to go next.',
    icon: 'menu_book',
    level: 'beginner',
    lessons: [
      {
        id: 'ref-naming',
        title: 'Naming cheat sheet',
        duration: '3 min',
        level: 'beginner',
        summary: 'The immutable ID formats.',
        body: [
          { kind: 'p', text: 'IDs are immutable once assigned — renaming them breaks every downstream link.' },
          { kind: 'list', items: [
            '**Epic** — `EP-<slug>` — e.g. `EP-istifta-inquiries`',
            '**Story** — `EP-<slug>-S0N` — e.g. `EP-istifta-inquiries-S01`',
            '**Task** — `EP-<slug>-S0N-T0N` — e.g. `EP-istifta-inquiries-S01-T03`',
            '**Branch** — `feat/<story-id>-<task-id>-<short-slug>`',
            '**Commit trailer** — `Task: <story-id>-<task-id>` (add `Contract-Change: yes` only if the locked surface is touched)',
          ] },
          { kind: 'p', text: 'Commits and PR titles follow Conventional Commits (lowercase after the type, e.g. `feat: …`, `fix: …`).' },
        ],
      },
      {
        id: 'ref-anytime',
        title: 'Handy anytime + where next',
        duration: '4 min',
        level: 'beginner',
        summary: 'The commands you reach for, and the deeper docs.',
        body: [
          { kind: 'p', text: 'A few commands you will reach for constantly:' },
          { kind: 'list', items: [
            '`yad-status` (or `yad-status EP-<slug>`) — read-only view of the whole chain and what is blocking. Start here when stuck.',
            '`yad next` — the single next action to take; in the build half it names the next build sub-step (spec → tasks → implement → checks → engineer-review) per story/repo.',
            '`yad doctor` — environment + state health check; attach `--json` to a bug report.',
            '`npx yadflow check --fix` — reconcile the install after any update.',
          ] },
          { kind: 'callout', tone: 'info', text: 'Go deeper: the full command reference is in docs/CLI.md, the skill catalogue in docs/SKILLS.md, and the by-hand end-to-end path in docs/WALKTHROUGH.md. The terminology report explains every term on one illustrated page.' },
        ],
        commands: [
          { cmd: 'yad-status', note: 'where is everything, what is blocking' },
          { cmd: 'yad next', note: 'the one next action' },
          { cmd: 'yad doctor', note: 'health check' },
        ],
      },
    ],
  },
];

// ── derived helpers ─────────────────────────────────────────────────────────

export const ALL_LESSONS = MODULES.flatMap((m) =>
  m.lessons.map((l) => ({ ...l, moduleId: m.id, moduleTitle: m.title, moduleNumber: m.number })),
);

export const TOTAL_LESSONS = ALL_LESSONS.length;

/** Look up a lesson by id, returning it with its previous/next neighbours (or null). */
export function findLesson(id: string) {
  const idx = ALL_LESSONS.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  return { lesson: ALL_LESSONS[idx], prev: ALL_LESSONS[idx - 1] ?? null, next: ALL_LESSONS[idx + 1] ?? null };
}
