# yadflow SDLC overview site

This folder is the **SDLC overview site**: an interactive web page that shows the whole yadflow
lifecycle. It walks through each phase — Setup, Foundation, Shape, Build, Automation and Change
Management — step by step, with the files each step writes and the commands that drive it. It also
has reference pages: the review gate, the check gates, the CLI commands, error codes and a glossary.

It is a single-page app (one HTML page that changes its content in the browser) built with React,
TypeScript and Vite (a build tool that bundles the code for the browser).

## Where the content lives

| What | Where |
| --- | --- |
| The phases and their steps | `src/data/paths.ts` |
| The boxes on the canvas (files, tools, repos) | `src/data/components.ts` |
| Reference tables (check gates, CLI commands, error codes) | `src/data/referenceData.ts` |
| The long-form sections (review gate, glossary, …) | `src/components/DocSections/` |
| The hand-written main documentation page | `public/report.html` |

The `yad-docs-overview` skill writes this content from the project's pipeline definition
(`skills/sdlc/config.yaml`, `skills/sdlc/module-help.csv` and `docs/diagrams/sdlc-overview.mmd`).
After the first run it updates the files in place. Edits by hand go in the same pull request as the
change they describe.

## Run it locally

You need Node.js and npm.

```bash
cd docs/sdlc-site
npm ci           # install the exact versions in package-lock.json
npm run dev      # start a local server with live reload
```

Other scripts in `package.json`:

| Script | What it does |
| --- | --- |
| `npm run build` | Type-checks the code (`tsc -b`), then builds the site into `dist/` |
| `npm run preview` | Serves the built `dist/` folder, to check the build |
| `npm run lint` | Runs ESLint over the code |

The site is built to be served under `/yadflow/app/` (the `base` in `vite.config.ts`).

## How it is built and published

The `yad docs` commands build and deploy it (`--overview` picks this site):

- `yad docs build --overview` runs `npm ci` (or `npm install` when there is no lockfile) and then
  `npm run build` here.
- `yad docs deploy --overview` builds it and reports the Pages deploy.
- `yad docs list` and `yad docs sync --check` say whether the site is stale — that is, whether the
  pipeline files above changed since the last build.

The Pages workflow (`.github/workflows/yad-docs.yml`, installed by `yad docs sync --wire`) runs
`npm ci && npm run build` in this folder. It puts `public/report.html` at the root of the published
site (`<base>/`, the main documentation), this app under `<base>/app/`, and the tutorial site
(`docs/tutorial-site`) under `<base>/tutorial/`.
