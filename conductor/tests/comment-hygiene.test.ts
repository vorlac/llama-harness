// conductor/tests/comment-hygiene.test.ts — the guard that ends a recurring class
// of review finding rather than fixing one more instance of it.
//
// THE RULE IT ENFORCES. .claude/rules/patterns-and-conventions.md forbids
// CHANGE-NARRATION in comments: prose that describes how the code got here
// ("changed", "updated", "fixed", "now", "new", "previously") instead of what it
// does. The reason is not style. A comment that narrates an edit is written
// against a reader who saw the previous version, and every later reader is a
// reader who did not — so the narration is dead weight at best and a description
// of code that no longer exists at worst. Three separate review rounds have
// reported instances of it by hand; a guard reports all of them, once, forever.
//
// THE LENS. The scan reads COMMENT TEXT ONLY, through the inverse of the lens the
// two source audits already use (tests/fixtures/strip-comments.ts): stripComments
// blanks the comments and keeps the code, commentsOnly blanks the code and keeps
// the comments, and between them they partition every file. Without that split
// the audit would fire on `journal.log("state", "item.updated", …)` — a call site,
// not prose — and would have to be weakened until it caught nothing.
//
// Inline code inside a comment is CODE, not prose, and is excluded on the same
// reasoning: `` `Date.now()` ``, `` `item.updated` `` and `` `fixed` `` are
// identifiers a comment is naming, and demanding they be reworded would be
// demanding a comment lie about what it points at. Backticks are the marker, so
// the exclusion is something an author declares rather than something the audit
// guesses.
//
// THE REMAINDER. adapter/tools.ts is exempt from the zero-hit rule and held to a
// CEILING instead. It carries ~40 hits, nearly all of them §3.3's own vocabulary
// ("the changed test", "the changed-test discipline", "the changed-file/hunk
// set") — spec terms whose rewording would drift the code away from the document
// it implements. The ceiling still ratchets: the count may fall and may never
// rise, so the exemption shrinks and cannot grow.
//
// Runtime hygiene: node:test + node:assert/strict; no skip/todo; the guard reads
// the shipped tree, never a fixture copy of it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { commentsOnly, stripComments } from "./fixtures/strip-comments.ts";

const CONDUCTOR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The shipped source the rule governs. Tests are excluded deliberately: a test
// name and a test's own prose legitimately describe what a defect USED to do,
// which is the whole documentary value of an escape-shaped row.
const GUARDED_DIRS: readonly string[] = ["core", "adapter", "plugin"];

// The prohibited vocabulary, as patterns-and-conventions.md lists it. Word
// boundaries on both sides: "change" and "renew" are ordinary words, and only the
// narration forms are refused.
const PROHIBITED: readonly string[] = ["changed", "updated", "fixed", "now", "new", "previously"];
const PROHIBITED_RE = new RegExp("\\b(?:" + PROHIBITED.join("|") + ")\\b", "gi");

// The one file held to a ceiling instead of zero, and the count it may not exceed.
const REMAINDER_FILE = "adapter/tools.ts";
const REMAINDER_CEILING = 40;

// Every guarded source file, repo-relative with a forward slash, sorted.
function guardedFiles(): string[] {
  const found: string[] = [];
  for (const dir of GUARDED_DIRS) {
    const abs = path.join(CONDUCTOR, dir);
    for (const name of readdirSync(abs).sort()) {
      const file = path.join(abs, name);
      if (!statSync(file).isFile()) continue;
      if (!name.endsWith(".ts")) continue;
      found.push(dir + "/" + name);
    }
  }
  return found;
}

// A comment's inline code spans, blanked. Length and line numbering survive, so a
// reported line number is the line a reader will open.
function blankInlineCode(commentText: string): string {
  return commentText.replace(/`[^`\n]*`/g, (span) => " ".repeat(span.length));
}

interface Hit {
  line: number;
  word: string;
  text: string;
}

// Every prohibited word in one file's comment prose.
function hitsIn(source: string): Hit[] {
  const prose = blankInlineCode(commentsOnly(source));
  const hits: Hit[] = [];
  const lines = prose.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    PROHIBITED_RE.lastIndex = 0;
    let match: RegExpExecArray | null = PROHIBITED_RE.exec(lines[i]);
    while (match !== null) {
      hits.push({ line: i + 1, word: match[0], text: lines[i].trim() });
      match = PROHIBITED_RE.exec(lines[i]);
    }
  }
  return hits;
}

function render(file: string, hits: readonly Hit[]): string {
  return hits.map((hit) => `${file}:${hit.line} [${hit.word}] ${hit.text}`).join("\n");
}

// ===========================================================================
// The lens itself, before it is trusted to police anything.
// ===========================================================================

test("[hygiene-lens] the comment lens is the exact inverse of the code lens: a prohibited word is caught in prose, and the SAME word is invisible in a string, an identifier, and a backticked inline-code span", () => {
  const sample = [
    "// the value is now derived from the artifact",
    'const label = "the value is now derived";',
    "const nowIsFine = 1;",
    "// the `now` seam and `item.updated` are identifiers, not narration",
    "/* a block comment that was previously wrong */",
    "function updatedAt(): number { return 0; }",
  ].join("\n");

  const hits = hitsIn(sample);
  assert.deepEqual(
    hits.map((hit) => [hit.line, hit.word.toLowerCase()]),
    [
      [1, "now"],
      [5, "previously"],
    ],
    "exactly the two prose narrations are caught: not the string literal, not the identifiers, not the backticked spans",
  );

  // The partition property both audits rest on: comments plus code equals the
  // file, character for character. A lens that dropped or duplicated a character
  // would report line numbers a reader cannot open.
  const code = stripComments(sample);
  const prose = commentsOnly(sample);
  assert.equal(code.length, sample.length, "the code lens preserves length");
  assert.equal(prose.length, sample.length, "and so does the comment lens");
  for (let i = 0; i < sample.length; i += 1) {
    const inCode = code[i] === sample[i];
    const inProse = prose[i] === sample[i];
    if (sample[i] === "\n") continue;
    assert.ok(
      !(inCode && inProse) || sample[i] === " ",
      `character ${String(i)} belongs to exactly one lens, never both`,
    );
  }
});

// ===========================================================================
// The guard.
// ===========================================================================

test("[hygiene-no-change-narration] no shipped comment under conductor/{core,adapter,plugin} narrates an edit: the prohibited vocabulary appears in no comment prose outside the one file held to a ceiling", () => {
  const files = guardedFiles();
  assert.ok(files.length >= 40, `premise: the guard scans the whole shipped tree, not a corner of it (${String(files.length)} files)`);
  assert.ok(files.includes(REMAINDER_FILE), "premise: the ceiling file is one of the files scanned");

  const offenders: string[] = [];
  let filesWithComments = 0;
  for (const file of files) {
    const source = readFileSync(path.join(CONDUCTOR, file), "utf8");
    if (commentsOnly(source).trim().length > 0) filesWithComments += 1;
    if (file === REMAINDER_FILE) continue;
    const hits = hitsIn(source);
    if (hits.length > 0) offenders.push(render(file, hits));
  }

  // Anti-vacuity: a lens that stopped finding comments would report zero hits for
  // every file and pass while inspecting nothing.
  assert.ok(
    filesWithComments >= files.length - 2,
    `premise: the comment lens still finds prose in the shipped tree (${String(filesWithComments)}/${String(files.length)} files)`,
  );

  assert.deepEqual(
    offenders,
    [],
    "comment prose must describe what the code does, never how it came to do it " +
      "(.claude/rules/patterns-and-conventions.md). Reword the comment; do not add the file to an exemption:\n" +
      offenders.join("\n"),
  );
});

test("[hygiene-remainder-ratchets] the one exempt file is held to a CEILING, not excused: its change-narration count may fall and may never rise, so the exemption can only shrink", () => {
  const hits = hitsIn(readFileSync(path.join(CONDUCTOR, REMAINDER_FILE), "utf8"));
  assert.ok(
    hits.length <= REMAINDER_CEILING,
    `${REMAINDER_FILE} carries ${String(hits.length)} change-narration comment(s), above the ceiling of ` +
      `${String(REMAINDER_CEILING)}. Reword the comment you added, or lower the ceiling if you cleaned others:\n` +
      render(REMAINDER_FILE, hits),
  );
});
