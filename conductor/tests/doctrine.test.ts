// conductor/tests/doctrine.test.ts — §8.1 anchor test for the doctrine packs.
//
// This is the WIDEST-FAN-OUT anchor: it fixes, mechanically, the shape and the
// required content of the nine always-on doctrine packs (§1.1, §6.1 port map,
// §6.3 ponytail) BEFORE any pack is written. Nine pack-writer subagents each
// author one conductor/doctrine/*.md file to satisfy exactly the anchors below.
//
// The packs do NOT exist yet: this test is RED by construction. Every read goes
// through readPack(), which throws ENOENT (naming the missing doctrine file)
// until the pack exists — the failure is missing-subject-shaped, not a defect in
// this test. No file read happens at module top level, so the module loads clean
// and each assertion fails on its own ENOENT.
//
// The anchor strings are NORMATIVE (plan lines 2517-2540, §6.1 1826-1850, §6.3
// 1880-1891). They are pinned verbatim from the source skills the port map cites:
//   - systematic-debugging's four phases + 3-fix rule       -> debug.md
//   - testing-anti-patterns' five anti-patterns             -> test-vet.md
//   - test-driven-development's iron law + "delete means delete" -> tdd.md
//   - the §2.10 finding-schema severity triad + file:line   -> review.md
//   - ponytail's seven-rung ladder (§2.4 ladderRung enum)   -> decompose.md
//   - receiving-code-review's verify-first + forbidden phrase -> receive-review.md
//   - the §3.6 override budget + `env`-stop-on-exhaustion    -> core.md
//
// Model-facing packs are client-agnostic: no pack may name opencode, Claude, or
// Cursor, and none may carry a placeholder marker. Asserted over ALL nine files.
//
// Runtime hygiene: node:test + node:assert/strict; erasable TS; .ts-relative file
// reads via new URL("../doctrine/<name>", import.meta.url); no skip/todo, no
// vacuous asserts, no empty catch. Forbidden placeholder markers are assembled by
// concatenation so this test file never carries the bare literals it forbids.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// The nine packs (§1.1), in canonical order.
// ---------------------------------------------------------------------------
const PACKS: readonly string[] = [
  "core.md",
  "decompose.md",
  "plan.md",
  "tdd.md",
  "test-vet.md",
  "debug.md",
  "review.md",
  "skeptic.md",
  "receive-review.md",
];

const MAX_LINES = 120;

// Read a pack file relative to THIS test file (not cwd). Throws ENOENT — naming
// the doctrine path — while the pack is unwritten, which is the intended red.
function readPack(name: string): string {
  const url = new URL(`../doctrine/${name}`, import.meta.url);
  return readFileSync(url, "utf8");
}

// Count newline-delimited lines, not counting a single trailing newline as a line.
function lineCount(text: string): number {
  const parts = text.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts.length;
}

// Content normalizer for anchor matching: strip markdown backticks, fold curly
// quotes to straight, lowercase. Keeps anchors robust to formatting while still
// pinning the exact words. NOT applied to the SHOUTED iron laws (asserted raw).
function soft(s: string): string {
  return s
    .replace(/`/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase();
}

function has(haystack: string, needle: string): boolean {
  return soft(haystack).includes(soft(needle));
}

// Whole-token match — used for the short severity words so "nit" is not satisfied
// by "unit"/"initial", nor "minor" by a longer word.
function hasWord(haystack: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, "i").test(haystack);
}

function assertAllPresent(
  packName: string,
  text: string,
  anchors: readonly string[],
): void {
  for (const anchor of anchors) {
    assert.ok(
      has(text, anchor),
      `${packName} must contain the anchor ${JSON.stringify(anchor)}`,
    );
  }
}

// Placeholder markers, assembled so this file never carries the bare literals.
const PLACEHOLDER_MARKERS: readonly string[] = ["TO" + "DO", "TB" + "D"];
// Client names that model-facing doctrine must never mention (§6.1, §8.1).
const CLIENT_NAMES: readonly string[] = ["opencode", "claude", "cursor"];

// ===========================================================================
// 8.1-files
// ===========================================================================
test("8.1-files: all nine doctrine packs exist, are non-empty, and are <=120 lines", () => {
  for (const name of PACKS) {
    // Throws ENOENT (naming the doctrine path) until the pack-writer creates it.
    const text = readPack(name);
    assert.ok(
      text.trim().length > 0,
      `${name} must be non-empty (contain more than whitespace)`,
    );
    const lines = lineCount(text);
    assert.ok(
      lines >= 1,
      `${name} must have at least one line`,
    );
    assert.ok(
      lines <= MAX_LINES,
      `${name} must be <=${MAX_LINES} lines (found ${lines})`,
    );
  }
});

// ===========================================================================
// 8.1-mechanism — every pack naming an enforced behavior names its enforcing
// mechanism ("the handler runs the test; your claim is not the record").
// tdd.md is the enforced-behavior pack (handler-run red/green); it must carry the
// mechanism sentence so the pack cannot present the model's claim as the record.
// ===========================================================================
test("8.1-mechanism: tdd.md names its enforcing mechanism ('your claim is not the record')", () => {
  const tdd = readPack("tdd.md");
  assert.ok(
    has(tdd, "the handler runs the test"),
    "tdd.md must name the enforcing mechanism: 'the handler runs the test'",
  );
  assert.ok(
    has(tdd, "your claim is not the record"),
    "tdd.md must state 'your claim is not the record' (handler-run evidence, not the model's word)",
  );
});

// ===========================================================================
// 8.1-anchors-tdd — the TDD iron law (SHOUTED, verbatim) + "delete means delete".
// ===========================================================================
test("8.1-anchors-tdd: tdd.md contains the TDD iron law and 'delete means delete'", () => {
  const tdd = readPack("tdd.md");
  // Iron law asserted RAW (case-sensitive) — the caps are the doctrine.
  assert.ok(
    tdd.includes("NO PRODUCTION CODE WITHOUT A FAILING TEST"),
    "tdd.md must contain, verbatim and capitalized, 'NO PRODUCTION CODE WITHOUT A FAILING TEST'",
  );
  assert.ok(
    has(tdd, "delete means delete"),
    "tdd.md must contain 'delete means delete' (code written before its test is deleted)",
  );
});

// ===========================================================================
// 8.1-anchors-debug — systematic-debugging's four phase names + the 3-fix rule.
// Four phases (skill "## The Four Phases"): Root Cause Investigation, Pattern
// Analysis, Hypothesis and Testing, Implementation. 3-fix rule: after 3 fixes,
// question the architecture (debugFixCap=3 escalation).
// ===========================================================================
const DEBUG_PHASES: readonly string[] = [
  "Root Cause Investigation",
  "Pattern Analysis",
  "Hypothesis and Testing",
  "Implementation",
];
test("8.1-anchors-debug: debug.md names the four phases and the 3-fix rule", () => {
  const debug = readPack("debug.md");
  assertAllPresent("debug.md", debug, DEBUG_PHASES);
  // The 3-fix rule: the count AND the mandated escalation.
  assert.ok(
    has(debug, "3 fixes"),
    "debug.md must state the '3 fixes' count (debugFixCap) that triggers escalation",
  );
  assert.ok(
    has(debug, "question the architecture"),
    "debug.md must state that after 3 failed fixes you 'question the architecture'",
  );
});

// ===========================================================================
// 8.1-anchors-review — the §2.10 severity triad (major | minor | nit) + file:line.
// ===========================================================================
const SEVERITY_TRIAD: readonly string[] = ["major", "minor", "nit"];
test("8.1-anchors-review: review.md contains the severity triad and 'file:line'", () => {
  const review = readPack("review.md");
  for (const level of SEVERITY_TRIAD) {
    assert.ok(
      hasWord(review, level),
      `review.md must name the severity level ${JSON.stringify(level)} (triad: major | minor | nit)`,
    );
  }
  assert.ok(
    has(review, "file:line"),
    "review.md must require 'file:line' specificity for every finding",
  );
});

// ===========================================================================
// 8.1-anchors-testvet — testing-anti-patterns' five anti-patterns, by name.
// ===========================================================================
const FIVE_ANTI_PATTERNS: readonly string[] = [
  "Testing Mock Behavior",
  "Test-Only Methods in Production",
  "Mocking Without Understanding",
  "Incomplete Mocks",
  "Integration Tests as Afterthought",
];
test("8.1-anchors-testvet: test-vet.md names the five anti-patterns", () => {
  const vet = readPack("test-vet.md");
  assertAllPresent("test-vet.md", vet, FIVE_ANTI_PATTERNS);
});

// ===========================================================================
// 8.1-anchors-decompose — the seven-rung ponytail ladder (§2.4 ladderRung enum)
// AND the behavioral / non-behavioral rule with its path test (behavioral:false
// only when fileScope is disjoint from behavioralPaths) AND the "prefer a new
// test file per item" guidance (keeps §4.2 file-granular quarantine from removing
// unrelated coverage).
// ===========================================================================
const SEVEN_RUNGS: readonly string[] = [
  "skip",
  "reuse",
  "stdlib",
  "platform",
  "dependency",
  "one-liner",
  "minimal-code",
];
test("8.1-anchors-decompose: decompose.md has the seven rungs, the behavioral path test, and the new-test-file guidance", () => {
  const decompose = readPack("decompose.md");
  // The seven ladder rungs, verbatim from the §2.4 ladderRung enum.
  assertAllPresent("decompose.md", decompose, SEVEN_RUNGS);
  // The behavioral / non-behavioral rule and its path test.
  assert.ok(
    has(decompose, "behavioral"),
    "decompose.md must reference behavioral items",
  );
  assert.ok(
    has(decompose, "non-behavioral"),
    "decompose.md must reference non-behavioral items",
  );
  assert.ok(
    has(decompose, "behavioralPaths"),
    "decompose.md must name behavioralPaths (the verification-owed globs)",
  );
  assert.ok(
    has(decompose, "fileScope"),
    "decompose.md must name fileScope (the item's edit globs) for the path test",
  );
  assert.ok(
    has(decompose, "disjoint"),
    "decompose.md must state the path test: behavioral:false only when fileScope is disjoint from behavioralPaths",
  );
  // The new-test-file guidance (§4.2 quarantine safety).
  assert.ok(
    has(decompose, "prefer a new test file per item"),
    "decompose.md must carry the 'prefer a new test file per item' guidance",
  );
});

// ===========================================================================
// 8.1-anchors-core — the §3.6 override budget + exhaustion is an `env` stop.
// ===========================================================================
test("8.1-anchors-core: core.md states the override budget and that exhaustion stops the run", () => {
  const core = readPack("core.md");
  assert.ok(
    has(core, "maxOverridesPerItem"),
    "core.md must name the per-item override budget field maxOverridesPerItem",
  );
  assert.ok(
    has(core, "maxOverridesPerRun"),
    "core.md must name the per-run override budget field maxOverridesPerRun",
  );
  assert.ok(
    has(core, "exhaustion"),
    "core.md must state what happens on budget exhaustion",
  );
  assert.ok(
    has(core, "env stop"),
    "core.md must state that exhaustion is an `env` stop (it stops the run, never another override)",
  );
});

// ===========================================================================
// 8.1-anchors-receive — verify-first protocol + the banned performative phrase.
// ===========================================================================
test("8.1-anchors-receive: receive-review.md says 'verify before implementing' and bans 'You're absolutely right'", () => {
  const receive = readPack("receive-review.md");
  assert.ok(
    has(receive, "verify before implementing"),
    "receive-review.md must state the core principle 'verify before implementing'",
  );
  assert.ok(
    has(receive, "You're absolutely right"),
    "receive-review.md must list 'You're absolutely right' among the forbidden (performative) responses",
  );
});

// ===========================================================================
// 8.1-no-todo — no pack carries a placeholder marker; no pack names a client.
// Asserted over ALL nine files (model-facing text is client-agnostic).
// ===========================================================================
test("8.1-no-todo: no pack contains a placeholder marker or names opencode/Claude/Cursor", () => {
  for (const name of PACKS) {
    const lower = readPack(name).toLowerCase();
    for (const marker of PLACEHOLDER_MARKERS) {
      assert.ok(
        !lower.includes(marker.toLowerCase()),
        `${name} must not contain the placeholder marker ${JSON.stringify(marker)}`,
      );
    }
    for (const client of CLIENT_NAMES) {
      assert.ok(
        !lower.includes(client),
        `${name} must not name the client ${JSON.stringify(client)} (model-facing text is client-agnostic)`,
      );
    }
  }
});
