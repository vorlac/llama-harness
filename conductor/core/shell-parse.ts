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

/**
 * True when the segment invokes git: the token in COMMAND POSITION is exactly
 * "git". Token equality, never substring matching — `echo git status` and
 * `cat tools/git/helper.txt` are not git commands.
 */
export function isGitCommand(seg: string[]): boolean {
  return seg.length > 0 && seg[0] === "git";
}

/**
 * The git subcommand of a segment, or null when there is none (bare `git`)
 * or the segment is not a git command. Skips the value-taking global options
 * `-c k=v`, `-C dir`, `--git-dir <dir>`, and the inline `--git-dir=<dir>`;
 * any other leading `-`/`--` flag is skipped without a value. The first
 * non-option token wins (`git stash push -m drop` parses as `stash`).
 */
export function gitSubcommand(seg: string[]): string | null {
  if (!isGitCommand(seg)) return null;
  let i = 1;
  while (i < seg.length) {
    const token = seg[i];
    if (token === "-c" || token === "-C" || token === "--git-dir") {
      i += 2; // option plus its separate value argument
    } else if (token.startsWith("--git-dir=")) {
      i += 1;
    } else if (token.startsWith("-")) {
      i += 1; // unrecognized global flag: skip the flag token itself
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

// Segment-list matcher. A `**` segment matches ZERO or more whole path
// segments, so `src/**` matches `src` itself and `**/*.ts` matches `c.ts`.
function matchSegments(
  pSegs: string[],
  pi: number,
  tSegs: string[],
  ti: number,
): boolean {
  if (pi === pSegs.length) return ti === tSegs.length;
  if (pSegs[pi] === "**") {
    if (matchSegments(pSegs, pi + 1, tSegs, ti)) return true;
    return ti < tSegs.length && matchSegments(pSegs, pi, tSegs, ti + 1);
  }
  if (ti === tSegs.length) return false;
  if (!segMatch(pSegs[pi], tSegs[ti])) return false;
  return matchSegments(pSegs, pi + 1, tSegs, ti + 1);
}

/**
 * Glob match a path: `*` never crosses `/`, `**` spans zero or more whole
 * segments, `{a,b}` alternation (which may span segments), literal dots.
 * `dir/**` matches `dir` itself; `src/**` does NOT match `src2/x`.
 */
export function globMatch(pattern: string, path: string): boolean {
  const target = splitPath(path);
  for (const expanded of expandBraces(pattern)) {
    if (matchSegments(splitPath(expanded), 0, target, 0)) return true;
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
// so `src` does not overlap `src2/...`.
function headsOverlap(a: string[], b: string[]): boolean {
  const n = a.length < b.length ? a.length : b.length;
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return false;
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
