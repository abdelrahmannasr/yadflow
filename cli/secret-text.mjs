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
const NAME_FOR_WHERE = /[_.-](?:url|uri|file|path|name|header|id|dir|env|endpoint|host|type|length|expiry|ttl|json|yaml|yml)$/i;
// A name starts where no name character came before — a `-` counts only inside a name, so `--api-key=x` reads
// `api-key` and `--from-literal=password=x` reads `password` (linear either way; reviews 2, 3). The value is read
// ahead without being taken, so a name inside a value (`url=https://h/?token=…`) is read on its own too; the value
// itself keeps `&` and `=`, so a password holding them still counts (a query string may be refused: use $VAR).
// A quoted value is read to its closing quote, so `TOKEN="abc,defghijk"` counts whole (review 4) — but never one
// that starts with a space or a shell operator: in `read -p "Password: " PW` or `echo "Password:"; read PW`, that
// quote closes the prompt, it opens nothing (reviews 5, 6).
const NAMED = /(?<![\w.]|[\w.]-)([A-Za-z_][\w.-]*)["']?\s*[=:]\s*(?=("[^"\s;&|][^"\n]*"|'[^'\s;&|][^'\n]*'|["']?[^\s"'`,;]+))/g;
// A value with its quotes taken off. An unquoted one that is `&name=…` is an empty value before the next name in a
// query (`password=&user=x`); a quoted `&…` is a real value (review 5).
const literal = (raw) => {
  const quoted = /^["']/.test(raw);
  const v = raw.replace(/^["']|["']$/g, '');
  if (!quoted && /^&[A-Za-z_][\w.-]*(?:[=&]|$)/.test(v)) return false;
  return v.length >= 8 && !/^[$<{%]/.test(v) && !/^(?:\/|\.{1,2}\/|~\/|[a-z][\w+.-]*:\/\/)/i.test(v);
};
const OTHER = [
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/,
  /(?<![\w+.-])[a-z][\w+.-]*:\/\/[^\s/:@]+:([^\s/@$<{%][^\s/@]*)@/i,
  /(?:^|\s)--(?:password|passwd|token|secret)(?:=|\s+)["']?(?![$<{%])[^\s"'`-][^\s"'`]{5,}/i,
  // `-p` only within the login command itself: never past `&&`, `;` or `|` (`gh auth login && mkdir -p x`).
  /\blogin\b[^\n;&|]*\s-p\s*["']?(?![$<{%])[^\s"'`-][^\s"'`]{5,}/i,
  /\bmysql\b[^\n;&|]*\s-p(?![$<{%\s])[^\s"'`]{6,}/i,
  /\bconfigure\s+set\s+\S*(?:secret|token|key)\S*\s+(?![$<{%])[^\s"'`]{8,}/i,
];
// One window of text, at most WINDOW long.
function windowLooksSecret(s) {
  if (OTHER.some((re) => re.test(s))) return true;
  for (const [, name, value] of s.matchAll(NAMED)) if (KEYWORD.test(name) && !NAME_FOR_WHERE.test(name) && literal(value)) return true;
  return false;
}
// Long text is read in overlapping windows, so the time grows with its length, never with its square (review 2).
// A secret sits on one line, and any secret these patterns name is far shorter than the overlap. A step's fields are
// capped below one window today; the windows keep any later caller (a scanner, say) safe too.
const WINDOW = 1000;
const OVERLAP = 200;
export function looksSecret(s) {
  if (typeof s !== 'string') return false;
  if (redactTokens(s) !== s) return true;
  for (const line of s.split('\n')) {
    if (line.length <= WINDOW) { if (windowLooksSecret(line)) return true; continue; }
    for (let i = 0; i < line.length; i += WINDOW - OVERLAP) if (windowLooksSecret(line.slice(i, i + WINDOW))) return true;
  }
  return false;
}
