// Minimal ESLint flat config — @eslint/js recommended only, no plugins. This codebase is
// deliberately hand-formatted (dense, aligned tables), so we run NO formatter: eslint here is a
// bug net (undefined refs, unused code, unreachable branches), not a style enforcer. Prettier was
// evaluated and rejected — it would reformat ~2.3k lines and destroy the intentional alignment.
import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['cli/**/*.mjs', 'bin/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        __dirname: 'readonly',
        // Node >=18 web globals used by the dependency-free update check. `fetch` is reached via
        // globalThis (a bare reference would throw where it is unavailable), so only AbortSignal
        // is named here — and that one is only ever touched inside a try/catch.
        globalThis: 'readonly',
        AbortSignal: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];
