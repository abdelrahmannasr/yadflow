# yadflow docs site (template)

This is the **vendored shell** that the `yad-docs` / `yad-docs-overview` skills copy to generate an
interactive documentation site (an animated flow canvas + role-based stakeholder doc pages). It is a
React 19 + Vite 7 + Tailwind v4 + framer-motion + zustand + react-router app.

**You normally don't edit this template directly.** The skills copy it (to
`epics/EP-<slug>/docs-site/` for a feature, or `docs/sdlc-site/` for the SDLC overview) and then
**generate the content** into `src/data/*.ts` + the `DocSections/*` components, theme `src/index.css`
from the connected design system, and substitute the Vite `base` (the `__BASE_PATH__` token) from
`.sdlc/docs.json`.

## What is generated vs. fixed

- **Generated per site:** `src/data/{paths,components,roles,docSections,referenceData}.ts`, the
  `:root` theme block of `src/index.css`, the referenced `DocSections/*` content, and the `base` path.
- **Fixed shell (copied verbatim):** `src/App.tsx`, `src/main.tsx`, the `components/` /
  `hooks/` / `store/` infrastructure, and `src/data/types.ts` (the contracts the generated data
  satisfies).

## Local commands

```bash
npm ci          # or: npm install
npm run dev     # local preview
npm run build   # tsc -b && vite build  → dist/
```

Build + deploy are normally driven by the CLI: `yad docs build|deploy|sync`. The login gate
(`DOCS_REQUIRE_LOGIN` in `src/store/useAuthStore.ts`) is **off by default** — it is presentational
only, never a security control; private docs rely on the repo / Pages access control.
