// conductor/tests/fixtures/strip-comments.ts — the lens both SOURCE audits read
// conductor/{core,adapter,plugin} through.
//
// legaltools-callsites.test.ts and journal-vocab.test.ts scan shipped source as
// text. Comments are BLANKED rather than deleted: every character a comment
// occupied becomes a space, newlines survive verbatim, so the stripped text has
// the same length and the same line numbering as the file on disk — a reported
// line number is the line number a reader will open — and prose that merely
// MENTIONS a call ("forwards to legalTools (repoConfigured)") is never scanned as
// one.
//
// Finding a comment opener requires knowing where the strings are. This codebase
// is dense with globs — `".conductor/**"`, `["src/**", "lib/**"]`, `"**/*.go"` —
// and a quote-blind walk reads the `/*` inside one as a block-comment opener and
// blanks everything to the next `*/`. That is ISSUE-088: 150 code lines of
// core/gates-edit.ts and 189 of adapter/tools.ts (the latter running to end of
// file, taking the `"config.updated"` journal call site with it) were invisible to
// both audits at once, with every anti-vacuity floor still satisfied.
//
// So the walk is a state machine over line comments, block comments, '…', "…",
// `…` with ${…} interpolation (which nests back into code and may hold further
// strings, comments and templates), and regex literals. Backslash escapes are
// honoured everywhere, and a regex character class hides the `/` that would
// otherwise close the literal.
//
// Regex-versus-division is the one genuinely ambiguous case in the grammar, and it
// is settled here by the standard preceding-token heuristic. DELIBERATELY NOT
// HANDLED, both because they are absent from the shipped tree and because
// strip-comments.test.ts's whole-tree canaries go red the moment one arrives: a
// regex literal directly after `)`, `]` or `}` (`if (x) /re/.test(s)`), which is
// read as a division; a regex after a keyword outside KEYWORDS_BEFORE_REGEX; and
// a division whose left operand ends in one of those same keywords spelled as a
// property name. Unterminated strings and regexes recover at the next newline.

// Keywords that can only be followed by an expression, so a `/` after one opens a
// regex literal rather than dividing.
const KEYWORDS_BEFORE_REGEX = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

// The nesting a template literal introduces: `…` is text until its terminator,
// but each ${…} inside it is CODE again, and that code can open another template.
interface Frame {
  kind: "template" | "interp";
  depth: number;
}

const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;
const REGEX_FLAG = /[a-z]/i;
const WHITESPACE = /\s/;

// True iff a `/` at this point opens a regex literal rather than dividing. `word`
// is the identifier immediately to the left, empty when the previous significant
// character is not an identifier character.
function opensRegex(previous: string, word: string): boolean {
  if (previous === "") return true;
  if (word !== "") return KEYWORDS_BEFORE_REGEX.has(word);
  return !(previous === ")" || previous === "]" || previous === "}");
}

export function stripComments(source: string): string {
  const out: string[] = new Array<string>(source.length);
  for (let k = 0; k < source.length; k += 1) out[k] = source[k];

  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k += 1) out[k] = source[k] === "\n" ? "\n" : " ";
  };

  const frames: Frame[] = [];
  // The last significant character emitted in CODE position, and the identifier
  // ending there — together, the regex-versus-division decision.
  let previous = "";
  let word = "";
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    // Inside a template literal's TEXT: only an escape, a terminator or an
    // interpolation opener means anything.
    if (frames.length > 0 && (frames[frames.length - 1] as Frame).kind === "template") {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === "`") {
        frames.pop();
        previous = "`";
        word = "";
        i += 1;
        continue;
      }
      if (ch === "$" && source[i + 1] === "{") {
        frames.push({ kind: "interp", depth: 0 });
        previous = "";
        word = "";
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (ch === "/" && source[i + 1] === "/") {
      let j = i;
      while (j < source.length && source[j] !== "\n") j += 1;
      blank(i, j);
      i = j;
      continue;
    }

    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === ch) {
          j += 1;
          break;
        }
        if (source[j] === "\n") break;
        j += 1;
      }
      previous = ch;
      word = "";
      i = j;
      continue;
    }

    if (ch === "`") {
      frames.push({ kind: "template", depth: 0 });
      i += 1;
      continue;
    }

    if (ch === "/" && opensRegex(previous, word)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < source.length) {
        const c = source[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === "\n") break;
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) {
          j += 1;
          closed = true;
          break;
        }
        j += 1;
      }
      if (closed) {
        while (j < source.length && REGEX_FLAG.test(source[j])) j += 1;
        previous = "/";
        word = "";
        i = j;
        continue;
      }
      // Unterminated: not a regex literal after all, so fall through and treat
      // the character as an ordinary one.
    }

    if (frames.length > 0) {
      const top = frames[frames.length - 1] as Frame;
      if (ch === "{") {
        top.depth += 1;
      } else if (ch === "}") {
        if (top.depth === 0) {
          frames.pop();
          previous = "}";
          word = "";
          i += 1;
          continue;
        }
        top.depth -= 1;
      }
    }

    if (!WHITESPACE.test(ch)) {
      previous = ch;
      word = IDENTIFIER_CHAR.test(ch) ? word + ch : "";
    }
    i += 1;
  }

  return out.join("");
}
