// Minimal ESLint flat config — @eslint/js recommended only, no plugins. This codebase is
// deliberately hand-formatted (dense, aligned tables), so we run NO formatter: eslint here is a
// bug net (undefined refs, unused code, unreachable branches), not a style enforcer. Prettier was
// evaluated and rejected — it would reformat ~2.3k lines and destroy the intentional alignment.
import js from '@eslint/js';

export default [
  // The brain viewer's browser libraries (E177) are vendored byte for byte from npm: not ours to lint.
  { ignores: ['cli/brain/vendor/**'] },
  js.configs.recommended,
  {
    files: ['cli/**/*.mjs', 'cli/**/*.js', 'bin/**/*.mjs'],
    ignores: ['cli/brain/view/**'],
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
  // The brain viewer's page script (E177) runs in a browser, as a plain script.
  {
    files: ['cli/brain/view/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', location: 'readonly', fetch: 'readonly',
        URLSearchParams: 'readonly', Promise: 'readonly', Set: 'readonly', Number: 'readonly', String: 'readonly',
        Object: 'readonly', Date: 'readonly', JSON: 'readonly', Error: 'readonly',
        EventSource: 'readonly', performance: 'readonly', getComputedStyle: 'readonly', Map: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', Math: 'readonly', Array: 'readonly', parseInt: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];
