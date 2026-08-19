// conductor/tests/doctrine-content.test.ts — Phase V.1: the doctrine-content rest
// of Theme VI (GAP-037, GAP-042, GAP-043, GAP-044). These pin the ADVISORY layer
// against the machine it rides on, single-sourced where the mechanics idiom
// applies:
//
//   GAP-037 — core.md carries an orchestrator run-shape playbook that points at
//     the GENERATED run sequence rather than hand-listing the tools (a hand-typed
//     tool list would be a second, unguarded spelling of the FSM order).
//   GAP-042 — decompose.md teaches the units the DECOMPOSED queue gate actually
//     measures, with the caps DERIVED from the same core/planning.ts constants
//     validateQueue reads, so a cap change regenerates the pack.
//   GAP-043 — every pack carries the same uniform stuck-state protocol, generated
//     so the nine copies cannot drift apart.
//   GAP-044 — core.md's ask policy stops contradicting the mid-run surface design.
//
// Runtime hygiene: node:test + node:assert/strict; erasable TS; pack reads go
// through new URL("../doctrine/…", import.meta.url); no skip/todo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MECHANICS_BEGIN, MECHANICS_END, extractMechanics, packSection } from "../core/mechanics.ts";
import { ITEM_MAX_FILES, DEFAULT_READ_SET_TOKEN_BUDGET } from "../core/planning.ts";

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

function readPack(name: string): string {
  return readFileSync(new URL(`../doctrine/${name}`, import.meta.url), "utf8");
}

// The pack text with its generated mechanics block cut out — the hand-written
// PROSE, so an assertion about the advisory layer never reads the derived block.
function proseOnly(text: string): string {
  const start = text.indexOf(MECHANICS_BEGIN);
  if (start < 0) return text;
  const end = text.indexOf(MECHANICS_END, start);
  if (end < 0) return text.slice(0, start);
  return text.slice(0, start) + text.slice(end + MECHANICS_END.length);
}

// ===========================================================================
// GAP-044 — core.md's ask policy reconciles with the mid-run surface design.
// ===========================================================================
test("V1-gap044: core.md's ask policy surfaces mid-run and no longer says questions are not fired mid-run", () => {
  const core = readPack("core.md");
  assert.ok(
    !core.includes("not fired mid-run"),
    "core.md must DROP the 'not fired mid-run' claim that contradicts conductor_surface's mid-run design",
  );
  assert.ok(
    core.includes("surface the moment it blocks an item"),
    "core.md must tell the orchestrator to surface the moment a blocker stops an item",
  );
  assert.ok(
    core.includes("you do not sit on them"),
    "core.md must state that batching is the human's view, not licence to sit on a blocker",
  );
});

// ===========================================================================
// GAP-037 — core.md's run-shape playbook points at the generated sequence and
// hand-lists no tools of its own (single source: the derived block).
// ===========================================================================
test("V1-gap037: core.md carries a run-shape playbook that defers to the generated sequence and spells no tools itself", () => {
  const core = readPack("core.md");
  const section = packSection(core, "The run shape");
  assert.notEqual(section, null, "core.md must carry a '## The run shape' orchestrator playbook section");
  const playbook = section ?? "";
  assert.ok(
    playbook.includes("do not choose the next tool from memory"),
    "the run-shape playbook must tell the orchestrator to take the recommended action, not choose from memory",
  );
  assert.ok(
    !/conductor_[a-z_]+/.test(playbook),
    "the run-shape playbook must NOT hand-list conductor_* tools — the sequence is single-sourced in the " +
      "generated mechanics block, and a second hand-typed spelling is the drift GAP-037 forbids",
  );
});

// ===========================================================================
// GAP-042 — decompose.md's measured limits are DERIVED from the queue gate's own
// constants, and the pack teaches the measurement rule the gate uses.
// ===========================================================================
test("V1-gap042: decompose.md's generated block carries the queue gate's measured caps, derived from core/planning.ts", () => {
  const block = extractMechanics(readPack("decompose.md"));
  assert.notEqual(block, null, "decompose.md must carry a generated mechanics block");
  const mechanics = block ?? "";
  assert.ok(
    mechanics.includes(String(ITEM_MAX_FILES)),
    `decompose.md's block must carry the derived file cap (${String(ITEM_MAX_FILES)}) from ITEM_MAX_FILES`,
  );
  assert.ok(
    mechanics.includes(String(DEFAULT_READ_SET_TOKEN_BUDGET)),
    `decompose.md's block must carry the derived read-set cap (${String(DEFAULT_READ_SET_TOKEN_BUDGET)}) ` +
      "from DEFAULT_READ_SET_TOKEN_BUDGET",
  );
  assert.ok(
    mechanics.includes("greater of"),
    "decompose.md must teach that item size is the GREATER of the entry count and the files the globs " +
      "match (the Math.max validateQueue computes), not the entry count alone (ISSUE-012)",
  );
});

test("V1-gap042-noprose: decompose.md no longer hand-types the drift-prone '~5' file figure in its prose", () => {
  const prose = proseOnly(readPack("decompose.md"));
  assert.ok(
    !prose.includes("~5"),
    "decompose.md's prose must not restate the file cap as a hand-typed '~5' — the number is derived in the " +
      "generated block and a hand copy drifts (the MACRO-021 rule applied to doctrine)",
  );
});

// ===========================================================================
// GAP-043 — every pack carries the same generated stuck-state protocol.
// ===========================================================================
const STUCK_ANCHORS: readonly string[] = ["never route around it", "conductor_surface", "NEEDS_CONTEXT"];
test("V1-gap043: every doctrine pack carries the uniform stuck-state protocol in its generated block", () => {
  for (const name of PACKS) {
    const block = extractMechanics(readPack(name));
    assert.notEqual(block, null, `${name} must carry a generated mechanics block`);
    const mechanics = block ?? "";
    for (const anchor of STUCK_ANCHORS) {
      assert.ok(
        mechanics.includes(anchor),
        `${name}'s generated block must carry the stuck-state protocol anchor ${JSON.stringify(anchor)} ` +
          "(GAP-043 makes the protocol uniform across all nine packs)",
      );
    }
  }
});
