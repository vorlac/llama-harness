// conductor/core/shell-parse.ts — quote-aware shell tokenizing, operator
// segmentation, git command/subcommand detection, and glob scope matching
// (Task 1.2; plan lines 2085-2099). Git-policy context (plan lines 1362-1385):
// the bash gate matches PARSED TOKENS from a quote-aware split — never
// substring regex, which false-positives on paths and message words — so
// `git add src/config.ts` parses as `add` and `git log --grep config` stays
// `log`. Task 5.1's gate consumes these functions. Core module: pure,
// imports nothing.

// Shell metacharacters that form operator runs. A maximal contiguous run of
// these emits as ONE token (`&&`, `||`, `>&`); a run breaks on any other
// character, so `(a)` tokenizes as `(` / `a` / `)`.
const OPERATOR_CHARS = ";&|<>()";

/**
 * Tokenize a shell command string. Quote-aware: single- and double-quoted
 * spans join into the surrounding token with the quotes stripped, and
 * metacharacters inside quotes are literal. Backslash outside quotes escapes
 * the next character. Operator runs emit as standalone tokens; a newline
 * emits as the literal token "\n".
 */
export function shellTokens(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let hasCurrent = false;

  const flush = (): void => {
    if (hasCurrent) {
      tokens.push(current);
      current = "";
      hasCurrent = false;
    }
  };

  const n = command.length;
  let i = 0;
  while (i < n) {
    const ch = command[i];
    if (ch === "'") {
      // Single quotes: everything literal until the closing quote.
      hasCurrent = true;
      i += 1;
      while (i < n && command[i] !== "'") {
        current += command[i];
        i += 1;
      }
      i += 1; // step past the closing quote (no-op at end of input)
    } else if (ch === '"') {
      // Double quotes: literal except backslash-escaped `"` and `\`.
      hasCurrent = true;
      i += 1;
      while (i < n && command[i] !== '"') {
        const c = command[i];
        const next = i + 1 < n ? command[i + 1] : "";
        if (c === "\\" && (next === '"' || next === "\\")) {
          current += next;
          i += 2;
        } else {
          current += c;
          i += 1;
        }
      }
      i += 1; // step past the closing quote
    } else if (ch === "$" && (command[i + 1] === "'" || command[i + 1] === '"')) {
      // ANSI-C `$'…'` and locale `$"…"` quoting: a `$` immediately before a
      // quote opens a quoted span. Consume the `$`, then let the next loop turn
      // parse the quote exactly like a bare `'`/`"` — the inner literal glues to
      // the current token with the `$` and quotes stripped, so `$'git'` → `git`.
      // (Inner escape decoding like `$'\x67'` is deliberately NOT done here; the
      // literal residual is caught downstream as an unresolvable command word.)
      i += 1;
    } else if (ch === "\\") {
      // Backslash outside quotes: the next character is literal.
      hasCurrent = true;
      if (i + 1 < n) {
        current += command[i + 1];
        i += 2;
      } else {
        current += "\\";
        i += 1;
      }
    } else if (ch === "\n") {
      flush();
      tokens.push("\n");
      i += 1;
    } else if (ch === " " || ch === "\t" || ch === "\r") {
      flush();
      i += 1;
    } else if (OPERATOR_CHARS.includes(ch)) {
      flush();
      let run = "";
      while (i < n && OPERATOR_CHARS.includes(command[i])) {
        run += command[i];
        i += 1;
      }
      tokens.push(run);
    } else {
      current += ch;
      hasCurrent = true;
      i += 1;
    }
  }
  flush();
  return tokens;
}

// An operator token is a newline or a token made solely of operator-run
// characters (as produced by shellTokens outside quotes).
function isOperatorToken(token: string): boolean {
  if (token === "\n") return true;
  if (token.length === 0) return false;
  for (const ch of token) {
    if (!OPERATOR_CHARS.includes(ch)) return false;
  }
  return true;
}

/**
 * Split a token stream into command segments at operator tokens (including
 * the "\n" separator token). Operators are dropped; empty segments are never
 * emitted, so leading/trailing/adjacent operators cannot produce [].
 */
export function splitOnOperators(tokens: string[]): string[][] {
  const segments: string[][] = [];
  let current: string[] = [];
  for (const token of tokens) {
    if (isOperatorToken(token)) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
    } else {
      current.push(token);
    }
  }
  if (current.length > 0) {
    segments.push(current);
  }
  return segments;
}

// Leading command wrappers that pass their tail through to another command:
// `env git push`, `command git push`, `sudo git push`, `builtin`, `exec`. A
// single one is unwrapped so the git gate sees the git invocation behind it.
const GIT_WRAPPERS = ["env", "command", "sudo", "builtin", "exec"];

// The value-taking options of each wrapper: a BARE `-x` of one of these forms
// consumes the FOLLOWING token as its value, so the command word is the token
// AFTER the value (`sudo -u bob git …` → `git`, not `bob`). A self-contained
// `--flag=value` glues its value on and needs no extra skip. `command`/`builtin`/
// `exec` take no value flags. Kept per-wrapper so `env -i` (a NON-value flag)
// does not eat its neighbour while `sudo -u bob` correctly does.
const WRAPPER_VALUE_FLAGS: Record<string, readonly string[]> = {
  sudo: ["-u", "-g", "-C", "-h", "-p", "-r", "-t", "-U"],
  env: ["-u", "-C", "-S"],
  command: [],
  builtin: [],
  exec: [],
};

// A shell env-assignment token in command-prefix position (`NAME=value`).
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

// The basename of a command word: the part after the last "/", so
// `/usr/bin/git` and `./git` both resolve to `git`.
function commandBasename(word: string): string {
  const slash = word.lastIndexOf("/");
  return slash === -1 ? word : word.slice(slash + 1);
}

// Skip ONE recognized wrapper's OWN leading options, starting just past the
// wrapper word. Skips: any `-`/`--` flag; a bare value-taking flag's following
// value token; and (for `env`) leading `NAME=value` assignment tokens. Returns
// the index of the first plain (non-flag, non-assignment) token — the command
// word — or seg.length when the wrapper's options consumed the whole segment.
function skipWrapperOptions(seg: string[], start: number, wrapper: string): number {
  const valueFlags = WRAPPER_VALUE_FLAGS[wrapper] ?? [];
  let i = start;
  while (i < seg.length) {
    const token = seg[i];
    if (wrapper === "env" && ENV_ASSIGNMENT.test(token)) {
      // `env`'s own `NAME=value` assignments precede the command word.
      i += 1;
      continue;
    }
    if (token.startsWith("-")) {
      i += 1;
      // A bare known value-taking flag (`-u bob`) also consumes its value token;
      // a self-contained `--flag=value` does not.
      if (!token.includes("=") && valueFlags.includes(token)) i += 1;
      continue;
    }
    break; // the first plain token is the command word
  }
  return i;
}

/**
 * Locate the command word of a segment. Skips leading `NAME=value` env-assignment
 * prefixes, then unwraps AT MOST ONE leading wrapper (`env`/`command`/`sudo`/
 * `builtin`/`exec`) TOGETHER WITH the wrapper's own options (and, for `env`, its
 * `NAME=value` assignments) before pointing at the command word. Shared by
 * isGitCommand/gitSubcommand and the git gate so detection and the fail-safe
 * agree. Returns:
 *   - { index }                 the command-word index (resolve by basename at the
 *                               call site — token equality, never substring).
 *   - { index: null,            an empty/prefix-only segment with NO wrapper: no
 *       unresolvable: false }   command word and nothing to fail safe on.
 *   - { index: null,            a wrapper WAS unwrapped but its options consumed the
 *       unresolvable: true }    whole segment (ran out / only flags remain), OR the
 *                               token the unwrap landed on is ITSELF another recognized
 *                               wrapper (only one level is unwrapped). The real command
 *                               is decided by the wrapper at runtime — callers MUST
 *                               fail safe (deny).
 */
export function commandWordLocation(
  seg: string[],
): { index: number | null; unresolvable: boolean } {
  let i = 0;
  while (i < seg.length && ENV_ASSIGNMENT.test(seg[i])) i += 1;
  if (i < seg.length && GIT_WRAPPERS.includes(seg[i])) {
    const wrapper = seg[i];
    i = skipWrapperOptions(seg, i + 1, wrapper);
    if (i >= seg.length) return { index: null, unresolvable: true };
    // Only ONE wrapper level is unwrapped: a command word that is itself another
    // recognized wrapper (`sudo env git …`) is unresolvable — fail safe.
    if (GIT_WRAPPERS.includes(seg[i])) return { index: null, unresolvable: true };
    return { index: i, unresolvable: false };
  }
  return i < seg.length ? { index: i, unresolvable: false } : { index: null, unresolvable: false };
}

/**
 * The index of the git command word in a segment, or null when the segment
 * does not invoke git. Sees through leading `NAME=value` env-assignment tokens
 * and one wrapper together with its options (shared commandWordLocation), then
 * resolves the command word by BASENAME. Shared by isGitCommand and gitSubcommand
 * so detection and subcommand extraction never disagree — token equality on the
 * basename, never substring matching, so `echo git status` and
 * `cat tools/git/helper.txt` are still not git commands.
 */
function gitCommandWordIndex(seg: string[]): number | null {
  const { index } = commandWordLocation(seg);
  if (index === null) return null;
  return commandBasename(seg[index]) === "git" ? index : null;
}

/**
 * True when the segment invokes git in COMMAND POSITION, seeing through leading
 * env-assignments, one wrapper, and an absolute/relative path (basename). Never
 * substring matching — `echo git status` and `cat tools/git/helper.txt` are not
 * git commands.
 */
export function isGitCommand(seg: string[]): boolean {
  return gitCommandWordIndex(seg) !== null;
}

/**
 * The git subcommand of a segment, or null when there is none (bare `git`)
 * or the segment is not a git command. Skips the value-taking global options
 * `-c k=v`, `-C dir`, `--git-dir <dir>`, and the inline `--git-dir=<dir>`. Any
 * OTHER leading `-`/`--` flag FAILS SAFE: it is returned verbatim as the
 * subcommand, a deny-forcing token that is on no allow-list, so the Task 5.1
 * gate default-denies rather than trusting the flag's value (which git may
 * itself treat as the real subcommand). The first non-option token wins
 * (`git stash push -m drop` parses as `stash`).
 */
export function gitSubcommand(seg: string[]): string | null {
  const gitIndex = gitCommandWordIndex(seg);
  if (gitIndex === null) return null;
  let i = gitIndex + 1;
  while (i < seg.length) {
    const token = seg[i];
    if (token === "-c" || token === "-C" || token === "--git-dir") {
      i += 2; // option plus its separate value argument
    } else if (token.startsWith("--git-dir=")) {
      i += 1;
    } else if (token.startsWith("-")) {
      return token; // unrecognized global option: fail safe (deny-forcing)
    } else {
      return token;
    }
  }
  return null;
}

// Expand one level of `{a,b}` alternation (recursing until brace-free).
// Nested braces and commas inside inner braces are handled by depth
// counting; an unbalanced `{` is treated as a literal character.
function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open === -1) return [pattern];
  let depth = 0;
  let close = -1;
  for (let i = open; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return [pattern];
  const head = pattern.slice(0, open);
  const body = pattern.slice(open + 1, close);
  const tail = pattern.slice(close + 1);
  const branches: string[] = [];
  let cur = "";
  let d = 0;
  for (const ch of body) {
    if (ch === "{") d += 1;
    else if (ch === "}") d -= 1;
    if (ch === "," && d === 0) {
      branches.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  branches.push(cur);
  const out: string[] = [];
  for (const branch of branches) {
    for (const expanded of expandBraces(head + branch + tail)) {
      out.push(expanded);
    }
  }
  return out;
}

// Split on "/" dropping empty segments (leading/trailing/doubled slashes).
function splitPath(p: string): string[] {
  const segs: string[] = [];
  for (const seg of p.split("/")) {
    if (seg.length > 0) segs.push(seg);
  }
  return segs;
}

// Match one brace-free pattern SEGMENT against one path segment. `*` matches
// any run of characters (segments contain no "/", so it cannot cross one);
// `?` matches exactly one character; everything else — dots included — is
// literal. Iterative two-pointer with star backtracking.
function segMatch(pat: string, text: string): boolean {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pat.length && (pat[p] === "?" || pat[p] === text[t])) {
      p += 1;
      t += 1;
    } else if (p < pat.length && pat[p] === "*") {
      star = p;
      p += 1;
      mark = t;
    } else if (star !== -1) {
      p = star + 1;
      mark += 1;
      t = mark;
    } else {
      return false;
    }
  }
  while (p < pat.length && pat[p] === "*") p += 1;
  return p === pat.length;
}

// Collapse a run of consecutive `**` pattern segments into a single `**`.
// `**/**` matches exactly what `**` matches (both span zero or more whole
// segments), so the collapse is semantically idempotent — but it removes the
// exponential C(stars+segments, stars) backtracking a run of `**` would
// otherwise force in matchSegments. globMatch runs on every edit-scope gate
// check, so one degenerate glob must not be able to wedge the run.
function collapseDoubleStars(segs: string[]): string[] {
  const out: string[] = [];
  for (const seg of segs) {
    if (seg === "**" && out.length > 0 && out[out.length - 1] === "**") continue;
    out.push(seg);
  }
  return out;
}

// Segment-list matcher. A `**` segment matches ZERO or more whole path
// segments, so `src/**` matches `src` itself and `**/*.ts` matches `c.ts`.
// Memoized on (pi, ti): the verdict for a state is a pure function of it, so
// caching every visited state bounds the whole match at O(pattern * path)
// even when several `**` are separated by literals.
function matchSegments(
  pSegs: string[],
  pi: number,
  tSegs: string[],
  ti: number,
  memo: Int8Array,
  width: number,
): boolean {
  const key = pi * width + ti;
  const cached = memo[key];
  if (cached !== 0) return cached === 1;
  let result: boolean;
  if (pi === pSegs.length) {
    result = ti === tSegs.length;
  } else if (pSegs[pi] === "**") {
    result =
      matchSegments(pSegs, pi + 1, tSegs, ti, memo, width) ||
      (ti < tSegs.length && matchSegments(pSegs, pi, tSegs, ti + 1, memo, width));
  } else if (ti === tSegs.length) {
    result = false;
  } else if (!segMatch(pSegs[pi], tSegs[ti])) {
    result = false;
  } else {
    result = matchSegments(pSegs, pi + 1, tSegs, ti + 1, memo, width);
  }
  memo[key] = result ? 1 : 2;
  return result;
}

/**
 * Glob match a path: `*` never crosses `/`, `**` spans zero or more whole
 * segments, `{a,b}` alternation (which may span segments), literal dots.
 * `dir/**` matches `dir` itself; `src/**` does NOT match `src2/x`.
 */
export function globMatch(pattern: string, path: string): boolean {
  const target = splitPath(path);
  const width = target.length + 1;
  for (const expanded of expandBraces(pattern)) {
    const pSegs = collapseDoubleStars(splitPath(expanded));
    const memo = new Int8Array((pSegs.length + 1) * width);
    if (matchSegments(pSegs, 0, target, 0, memo, width)) return true;
  }
  return false;
}

// The leading LITERAL path segments of a glob: everything before the first
// segment containing a wildcard construct (`*`, `?`, `{`, `[`). A glob with
// a wildcard-headed first segment (`**/*.ts`) has an empty literal head.
function literalHead(glob: string): string[] {
  const head: string[] = [];
  for (const seg of splitPath(glob)) {
    if (
      seg.includes("*") ||
      seg.includes("?") ||
      seg.includes("{") ||
      seg.includes("[")
    ) {
      break;
    }
    head.push(seg);
  }
  return head;
}

// Segment-wise prefix overlap: true when one head is a path prefix of the
// other (an empty head prefixes everything). Segment-wise, not string-wise,
// so `src` does not overlap `src2/...`. Segments compare case-INSENSITIVELY:
// on a case-insensitive filesystem (darwin) `Src/**` and `src/**` name the
// same real directory, and per plan lines 2091-2093 an over-approximation only
// serializes work — never corrupts it — so folding case is pure-safe.
function headsOverlap(a: string[], b: string[]): boolean {
  const n = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < n; i++) {
    if (a[i].toLowerCase() !== b[i].toLowerCase()) return false;
  }
  return true;
}

/**
 * Conservative scope intersection for the wave scheduler (plan lines
 * 2091-2093): true when ANY pair across the two lists has overlapping
 * literal heads. Deliberately over-approximates — `src/*.ts` vs `src/*.md`
 * reports true — because a false positive only serializes work, never
 * corrupts it. Symmetric by construction.
 */
export function scopesIntersect(globsA: string[], globsB: string[]): boolean {
  for (const a of globsA) {
    const headA = literalHead(a);
    for (const b of globsB) {
      if (headsOverlap(headA, literalHead(b))) return true;
    }
  }
  return false;
}
