// Text that holds a secret (E185 part 3; the patterns are the ones `yad scan` has always used). A module of its
// own, with no imports, so anything — the local setup script, the scanner — can ask without an import cycle.

// Every token yad knows, plus any run of 40 or more key-like characters: for text a machine wrote.
export const SECRET = /(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|glpat-[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{12,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?|-----BEGIN[^-]*-----|[A-Za-z0-9+_=-]{40,})/g;
// Text a person wrote keeps its commit hashes and long names: only tokens with a known prefix count.
export const PREFIXED = /(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|glpat-[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{12,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?|-----BEGIN[^-]*-----)/g;
export const redactTokens = (s) => String(s ?? '').replace(PREFIXED, '[redacted]');
export const redact = (s) => String(s ?? '').replace(SECRET, '[redacted]');

// A secret value written into text (review 1 widened both ways). It counts when:
//   - a known token is there (the list above), or a Stripe key (`sk_live_…`, `rk_test_…`);
//   - a password, secret, token or key NAME is given a literal value (`API_KEY=abcd…`, `password: "…"`) —
//     never when the name is for where or what the value is (`TOKEN_URL`, `PASSWORD_FILE`, `SECRET_NAME`),
//     nor when the value names where it comes from (`$API_KEY`, `${TOKEN}`, `<your key>`, `{{ vault }}`, a path
//     or a URL);
//   - a password sits in a URL (`https://user:pw@host`), or after `--password` / `--token`, after `-p` on a
//     login line (`docker login -p …`, `mysql -p…`), or after `aws configure set` for a secret key.
const KEYWORD = /password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key/i;
const NAME_FOR_WHERE = /[_-](?:url|uri|file|path|name|header|id|dir|env|endpoint|host|type|length|expiry|ttl)$/i;
const NAMED = /([A-Za-z_][\w.-]*)["']?\s*[=:]\s*["']?([^\s"'`,;]+)/g;
const literal = (v) => v.length >= 8 && !/^[$<{%]/.test(v) && !/^(?:\/|\.{1,2}\/|~\/|[a-z][\w+.-]*:\/\/)/i.test(v);
const OTHER = [
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/,
  /[a-z][\w+.-]*:\/\/[^\s/:@]+:([^\s/@$<{%][^\s/@]*)@/i,
  /(?:^|\s)--(?:password|passwd|token|secret)(?:=|\s+)["']?(?![$<{%])[^\s"'`-][^\s"'`]{5,}/i,
  /\blogin\b[^\n]*\s-p\s*["']?(?![$<{%])[^\s"'`-][^\s"'`]{5,}/i,
  /\bmysql\b[^\n]*\s-p(?![$<{%\s])[^\s"'`]{6,}/i,
  /\bconfigure\s+set\s+\S*(?:secret|token|key)\S*\s+(?![$<{%])[^\s"'`]{8,}/i,
];
export function looksSecret(s) {
  if (typeof s !== 'string') return false;
  if (redactTokens(s) !== s || OTHER.some((re) => re.test(s))) return true;
  for (const [, name, value] of s.matchAll(NAMED)) if (KEYWORD.test(name) && !NAME_FOR_WHERE.test(name) && literal(value)) return true;
  return false;
}
