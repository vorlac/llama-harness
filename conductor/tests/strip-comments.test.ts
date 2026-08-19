// conductor/tests/strip-comments.test.ts — the guard for the one function both
// SOURCE audits see the repository through.
//
// legaltools-callsites.test.ts and journal-vocab.test.ts do not test behaviour:
// they read conductor/{core,adapter,plugin} as text and assert things about the
// call sites they find. Comments are blanked first, so prose that merely mentions
// a call — "forwards to legalTools (repoConfigured)" — is never scanned as one.
// That blanker is therefore the lens both audits look through, and a lens that
// silently narrows makes both of them claim coverage they do not have.
//
// It did narrow. The blanker was quote-blind, so the `/*` inside a glob literal
// (`".conductor/**"`, `["src/**", "lib/**"]`, `"**/*.go"`) read as a comment
// opener and everything to the next `*/` was blanked: 150 code lines of
// core/gates-edit.ts and 189 of adapter/tools.ts, the latter running to end of
// file. The `input.journal.log(…, "config.updated", …)` site at the tail of
// tools.ts sat inside that span, so deleting "config.updated" from the closed
// §7.4 vocabulary left the vocabulary audit green — and every handler appended
// after that point was born unaudited by both guards at once. The anti-vacuity
// floors could not see it either: enough sites survived to clear them.
//
// So this file pins the lens from two directions. Fixture sources state the
// property directly — a `/*` inside a string literal is TEXT, a `//` inside a URL
// is TEXT, a real comment is still blanked — and whole-tree invariants assert
// that no shipped file loses a line of code to the blanker, that every file's
// TAIL survives, and that the witness call site of the original defect is
// something the audits can still read.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "./fixtures/strip-comments.ts";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const conductorDir = path.resolve(testsDir, "..");

// The same tree both audits walk.
const PRODUCTION_DIRS = ["core", "adapter", "plugin"];
const MIN_FILES_SCANNED = 12;

function productionFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith(".ts")) out.push(full);
    }
  };
  for (const dir of PRODUCTION_DIRS) walk(path.join(conductorDir, dir));
  return out;
}

// ===========================================================================
// (1) Fixture sources — the property, stated on text small enough to read
// ===========================================================================

// The exact shape that blinded both audits: a glob literal carrying `/*`, then a
// journal call site, then a doc comment whose `*/` is where the runaway blanking
// stopped in the real files.
const GLOB_THEN_CALL_SITE = [
  'const scope = { behavioralPaths: ["src/**", "lib/**"] };',
  'if (globMatch(".conductor/**", normalized)) return deny("handler-written only");',
  'input.journal.log("info", "state", "config.updated", { path: configPath(root) }, {});',
  "/**",
  " * A doc comment, whose terminator is where the runaway blank stopped.",
  " */",
  "export function tail(): number { return 1; }",
].join("\n");

test("[strip-comments] a `/*` inside a STRING LITERAL is text, not a comment opener — the glob `\"src/**\"` must not blank the journal call site three lines below it, which is exactly how one real call site and every handler after it left both source audits' view", () => {
  const stripped = stripComments(GLOB_THEN_CALL_SITE);

  assert.ok(
    stripped.includes('input.journal.log("info", "state", "config.updated"'),
    "the journal call site after a glob literal survived the blanker — if it did not, the vocabulary " +
      "audit cannot see it, and removing its event name from the closed §7.4 list stays green",
  );
  assert.ok(
    stripped.includes('globMatch(".conductor/**", normalized)'),
    "the glob literal itself survived as text",
  );
  assert.ok(
    stripped.includes("export function tail(): number"),
    "and the code after the doc comment survived — the file's tail is what ran off the end in adapter/tools.ts",
  );
  assert.ok(
    !stripped.includes("A doc comment"),
    "premise: the REAL comment is still blanked, so this is a lens that narrowed to comments rather than one that stopped blanking",
  );
});

test("[strip-comments] a `//` inside a string literal is text — a URL or a bare path must not blank the rest of its line", () => {
  const source = 'const origin = "https://example.invalid/v1"; legalTools(a, b, c, d, isRepo);';
  const stripped = stripComments(source);
  assert.ok(
    stripped.includes("legalTools(a, b, c, d, isRepo)"),
    "the call after a URL literal survived — a quote-blind blanker eats the rest of the line at `//`",
  );
  assert.ok(stripped.includes('"https://example.invalid/v1"'), "and the URL itself survived as text");
});

test("[strip-comments] single quotes, backticks, `${…}` interpolation and escaped quotes all delimit text the same way", () => {
  const source = [
    "const single = 'src/**/*.ts';",
    "const template = `${dir}/**/*.go and ${nested(`${inner}/**`)}`;",
    'const escaped = "a \\" /* still inside the string \\" b";',
    'journal.log("info", "gates", "allow", {}, corr);',
  ].join("\n");
  const stripped = stripComments(source);

  assert.ok(stripped.includes("const single = 'src/**/*.ts';"), "a single-quoted glob is text");
  assert.ok(
    stripped.includes("const template = `${dir}/**/*.go and ${nested(`${inner}/**`)}`;"),
    "a template literal, including a nested template inside its interpolation, is text",
  );
  assert.ok(
    stripped.includes('const escaped = "a \\" /* still inside the string \\" b";'),
    "an escaped quote does not end the literal, so the `/*` after it is still text",
  );
  assert.ok(
    stripped.includes('journal.log("info", "gates", "allow", {}, corr);'),
    "and the call site below every one of them is still visible to the audit",
  );
});

test("[strip-comments] a regex literal is text, and a division is not one — an unpaired quote inside a regex must not open a phantom string, and a `/` between two operands must not open a phantom regex; either mistake leaves a REAL comment unblanked and the audits then scan PROSE as a call site", () => {
  const source = [
    'const LEADING = /^["\'`([{<]+/;',
    "const TRAILING = /[\"'`)\\]}>,;:!?.]+$/;",
    "const inClass = /(?:^|[^\\w/.-])(?:delete|destroy)\\s+[A-Za-z]/i;",
    'const quoted = /["]/; // journal.log("info", "state", "regex-phantom", {}, corr)',
    'const half = Math.ceil(k / 2); // journal.log("info", "state", "division-phantom", {}, corr)',
    'journal.log("info", "state", "run.created", {}, corr);',
  ].join("\n");
  const stripped = stripComments(source);

  assert.ok(stripped.includes('const LEADING = /^["\'`([{<]+/;'), "a regex full of quote characters is text");
  assert.ok(stripped.includes("const inClass = /(?:^|[^\\w/.-])"), "a `/` inside a character class does not end the literal");
  assert.ok(stripped.includes('const quoted = /["]/;'), "the regex holding one unpaired quote is text");
  assert.ok(stripped.includes("const half = Math.ceil(k / 2);"), "and a division survives as the code it is");

  assert.ok(
    !stripped.includes("regex-phantom"),
    "the comment after a quote-carrying regex is still blanked — read that regex as a division and its " +
      "`\"` opens a string, the `//` after it stops being a comment opener, and the audit scans a line of " +
      "PROSE as a journal call site",
  );
  assert.ok(
    !stripped.includes("division-phantom"),
    "the comment after a division is still blanked — read that `/` as a regex opener and the scan runs " +
      "through the comment's own `//`, leaving the prose after it as scannable text",
  );
  assert.ok(
    stripped.includes('journal.log("info", "state", "run.created", {}, corr);'),
    "and the real call site below all of them is visible",
  );
});

test("[strip-comments] REAL comments are still blanked, and blanking preserves length and line numbering so a reported line number is the line number on disk", () => {
  const source = [
    "// journal.log(\"info\", \"state\", \"not-a-real-event\", {}, corr);",
    "const a = 1; /* legalTools(1, 2, 3, 4) */ const b = 2;",
    "/* a block",
    "   spanning lines */",
    "const c = 3;",
  ].join("\n");
  const stripped = stripComments(source);

  assert.ok(!stripped.includes("not-a-real-event"), "a call named inside a line comment is not scannable text");
  assert.ok(!stripped.includes("legalTools(1, 2, 3, 4)"), "nor is one inside a block comment");
  assert.ok(!stripped.includes("spanning lines"), "nor one spanning several lines");
  assert.ok(stripped.includes("const a = 1;") && stripped.includes("const b = 2;"), "the code either side of an inline block comment survives");
  assert.ok(stripped.includes("const c = 3;"), "and the code after a multi-line block comment survives");

  assert.equal(stripped.length, source.length, "blanking preserves length — a comment becomes spaces, never nothing");
  assert.equal(
    stripped.split("\n").length,
    source.split("\n").length,
    "and preserves line count, which is what makes a reported line number the line number on disk",
  );
});

// ===========================================================================
// (2) Whole-tree invariants — the sentinel canary on the files that ship
// ===========================================================================

// A raw line that opens or continues a comment. Everything else that carries
// non-whitespace is CODE, and code must never come back blank.
function looksLikeCommentLine(raw: string): boolean {
  return /^\s*(\/\/|\*|\/\*)/.test(raw);
}

test("[strip-comments-canary] no shipped file loses a line of CODE to the blanker — the whole-tree statement of the defect that hid 150 lines of core/gates-edit.ts and 189 of adapter/tools.ts from both source audits at once", () => {
  const files = productionFiles();
  assert.ok(
    files.length >= MIN_FILES_SCANNED,
    `walked only ${files.length} shipped .ts files (>= ${MIN_FILES_SCANNED} exist) — a walk that inspects nothing passes vacuously`,
  );

  const lost: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const stripped = stripComments(source);
    const rel = path.relative(conductorDir, file);

    assert.equal(stripped.length, source.length, `${rel}: blanking must preserve length`);
    const rawLines = source.split("\n");
    const outLines = stripped.split("\n");
    assert.equal(outLines.length, rawLines.length, `${rel}: blanking must preserve line count`);

    for (let n = 0; n < rawLines.length; n += 1) {
      const raw = rawLines[n] as string;
      const out = outLines[n] as string;
      if (raw.trim().length === 0 || out.trim().length > 0) continue;
      if (looksLikeCommentLine(raw)) continue;
      lost.push(`${rel}:${n + 1} — ${raw.trim().slice(0, 90)}`);
    }
  }

  assert.deepEqual(
    lost,
    [],
    "these lines carry code in the file on disk and nothing after the blanker, so both source audits " +
      "are blind to them. A blanker that reads a glob literal's `/*` as a comment opener is the way " +
      "this happens; the audits stay green while inspecting less than they claim.",
  );
});

test("[strip-comments-canary] every shipped file's TAIL survives the blanker — adapter/tools.ts ran off the end, so handlers appended at the bottom of a file were born unaudited", () => {
  const files = productionFiles();
  assert.ok(files.length >= MIN_FILES_SCANNED, "premise: the walk reached the shipped tree");

  const truncated: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const stripped = stripComments(source);
    const rawEnd = source.trimEnd().length;
    const outEnd = stripped.trimEnd().length;
    if (rawEnd === outEnd) continue;
    const line = source.slice(0, outEnd).split("\n").length;
    truncated.push(
      `${path.relative(conductorDir, file)}: the audits see nothing past line ${line} of ${source.split("\n").length}`,
    );
  }

  assert.deepEqual(
    truncated,
    [],
    "a shipped file whose tail is blank after stripping is a file the source audits stop reading part " +
      "way through — every call site below that point is invisible to them",
  );
});

test("[strip-comments-canary] the witness site of the original defect is readable: adapter/tools.ts's `config.updated` journal call, which sat inside the runaway blank and let its event name be deleted from the closed §7.4 vocabulary with the audit still green", () => {
  const source = readFileSync(path.join(conductorDir, "adapter", "tools.ts"), "utf8");
  assert.ok(source.includes('"config.updated"'), "premise: the witness call site is still in adapter/tools.ts");

  const stripped = stripComments(source);
  assert.ok(
    stripped.includes('"config.updated"'),
    "the witness call site is blank after stripping — the vocabulary audit cannot see it, which is the " +
      "exact state ISSUE-088 recorded. If the site legitimately moved, repoint this canary at whichever " +
      "journal call site now sits nearest the end of adapter/tools.ts.",
  );
});
