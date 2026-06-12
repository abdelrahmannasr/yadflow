// Structured error codes for the `yad` CLI. A YadError carries a stable code (greppable,
// documented in README "Troubleshooting") and a one-line recovery hint that the top-level
// catch in bin/yad.mjs prints after the message. Plain Errors still work everywhere; codes
// are reserved for the failures users actually hit and need to act on.
export class YadError extends Error {
  constructor(code, message, hint = '') {
    super(message);
    this.name = 'YadError';
    this.code = code;
    this.hint = hint;
  }
}

// The catalog — single source for doctor, the top-level catch, and the README table.
export const CODES = {
  'YAD-ENV-001': 'git is not installed or not on PATH',
  'YAD-ENV-002': 'the platform CLI (gh/glab) is missing or not authenticated',
  'YAD-ENV-003': 'Node.js is older than the supported range (>=18)',
  'YAD-STATE-001': 'a ledger/config JSON file exists but does not parse',
  'YAD-STATE-002': 'a ledger/config JSON file parses but has the wrong shape',
  'YAD-STATE-003': 'a registered repo path is missing or not a git repository',
  'YAD-CFG-001': 'hub.json names an unknown platform (expected github, gitlab, or null)',
};

export const err = (code, message, hint) => new YadError(code, message, hint);
