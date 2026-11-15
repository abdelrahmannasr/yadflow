// Text that holds a secret (E185 part 3; the patterns are the ones `yad scan` has always used). A module of its
// own, with no imports, so anything — the local setup script, the scanner — can ask without an import cycle.

// Every token yad knows, plus any run of 40 or more key-like characters: for text a machine wrote.
export const SECRET = /(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|glpat-[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{12,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?|-----BEGIN[^-]*-----|[A-Za-z0-9+_=-]{40,})/g;
// Text a person wrote keeps its commit hashes and long names: only tokens with a known prefix count.
export const PREFIXED = /(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|glpat-[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{12,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?|-----BEGIN[^-]*-----)/g;
export const redactTokens = (s) => String(s ?? '').replace(PREFIXED, '[redacted]');
export const redact = (s) => String(s ?? '').replace(SECRET, '[redacted]');

// A secret value written into text: a known token, or a password, secret, token or key given a literal value.
// A name for where the value comes from (`$API_KEY`, `${TOKEN}`, `<your key>`, `{{ secret }}`) is not one.
const ASSIGNED = /(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\w*["']?\s*[=:]\s*["']?(?![$<{%])[^\s"'`]{8,}/i;
export const looksSecret = (s) => typeof s === 'string' && (redactTokens(s) !== s || ASSIGNED.test(s));
