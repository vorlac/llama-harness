// conductor/tests/doctrine-mechanics.test.ts — Phase I.4 stage B: the two
// implementer-facing doctrine riders, GAP-005 and GAP-039.
//
// GAP-005 (single-source doctrine composition). Doctrine lived in TWO unguarded
// spellings: the anchor-tested `.md` packs, and hand-written restatements inside
// adapter/tools.ts dispatch prompts (ISSUE-003 named five sites). Nothing guarded
// either direction, so an edit to a pack changed nothing a session read and an
// edit to a prompt changed doctrine nobody reviewed. Two halves close it:
//   (a) every dispatch prompt COMPOSES its doctrine slice out of the loaded pack
//       map — the debugFixPrompt pattern — so the rules exist in exactly one
//       place and an operator's doctrine override reaches the prompt;
//   (b) each pack carries a GENERATED mechanics section derived from the tool
//       vocabulary itself (core/tool-bindings.ts) and the legality machine
//       (core/gates-phase.ts), so pack mechanics cannot drift from the machine.
//
// GAP-039 (tdd.md's headline cycle ended in an action the git gate ALWAYS
// denies). A doctrine-following implementer walked into a guaranteed deny at the
// end of every green. The cycle must end in an action the gates allow, and the
// pack must say so in a sentence anchored here (ISSUE-135's fix form: anchor the
// full sentence, not a keyword).
//
// Anti-vacuity: 1B re-derives the tool sequences INDEPENDENTLY (walking
// legalTools in this file) rather than comparing renderMechanics to itself, and
// 3E pins the git-gate denial that makes GAP-039 a defect at all — so a pack that
// merely says "never run git commit" is checked against the machine that denies
// it, not against a belief about the machine.
//
// Runtime hygiene: node:test + node:assert/strict; erasable TS; pack reads go
// through new URL("../doctrine/…", import.meta.url); no skip/todo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MECHANICS_BEGIN,
  MECHANICS_END,
  extractMechanics,
  itemStageTools,
  mechanicsBlock,
  metaTools,
  nonBehavioralEntryTool,
  packSection,
  renderMechanics,
  runStageTools,
} from "../core/mechanics.ts";
import { legalTools } from "../core/gates-phase.ts";
import { PLAN_PLACEHOLDER_LABELS, scanPlaceholders } from "../core/planning.ts";
import type { GateItem, GateRun } from "../core/gates-phase.ts";
import { TOOL_BINDINGS } from "../core/tool-bindings.ts";
import { ITEM_STATES } from "../core/fsm-item.ts";
import { decideGit } from "../core/gates-git.ts";
import {
  decomposePrompt,
  itemLensPrompt,
  itemSkepticPrompt,
  lensPrompt,
  planPrompt,
  skepticRefutePrompt,
} from "../adapter/tools.ts";
import type { Config, Queue, QueueItem, Findings } from "../core/types.ts";

// ---------------------------------------------------------------------------
// Pack fixtures — the real doctrine directory, read relative to THIS file.
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

function readPack(name: string): string {
  return readFileSync(new URL(`../doctrine/${name}`, import.meta.url), "utf8");
}

// The whole doctrine directory as the composition root hands it to the handlers.
function packMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const name of PACKS) map[name] = readPack(name);
  return map;
}

// Collapse every run of whitespace (newlines included) to one space, so an anchor
// sentence still matches across the line wrapping a markdown pack applies to it.
function flat(s: string): string {
  return s.replace(/`/g, "").replace(/\s+/g, " ").trim();
}

// ===========================================================================
// 1. GAP-005 half (b) — the GENERATED mechanics section.
// ===========================================================================

test("I4B-1A: every doctrine pack carries exactly one generated mechanics block equal to a fresh derivation", () => {
  for (const name of PACKS) {
    const text = readPack(name);
    const begins = text.split(MECHANICS_BEGIN).length - 1;
    const ends = text.split(MECHANICS_END).length - 1;
    assert.equal(begins, 1, `${name} must carry exactly one ${MECHANICS_BEGIN} marker`);
    assert.equal(ends, 1, `${name} must carry exactly one ${MECHANICS_END} marker`);

    const embedded = extractMechanics(text);
    assert.notEqual(embedded, null, `${name}'s mechanics block must be extractable`);
    assert.equal(
      embedded,
      renderMechanics(name),
      `${name}'s embedded mechanics section must equal a FRESH derivation from the tool ` +
        "vocabulary — regenerate it rather than editing the pack by hand",
    );
    // The block the generator emits is what the pack carries, markers included.
    assert.ok(
      text.includes(mechanicsBlock(name)),
      `${name} must embed mechanicsBlock(${JSON.stringify(name)}) verbatim, markers included`,
    );
  }
});

test("I4B-1B: the mechanics derivation matches an INDEPENDENT walk of the legality machine", () => {
  const asRun = (state: string, classification: string | null): GateRun => ({
    state,
    stop: null,
    classification: classification === null ? null : { kind: classification },
    classified: classification !== null,
  });
  const asItem = (state: string, behavioral: boolean): GateItem => ({
    id: "I1",
    state,
    behavioral,
    dependsOn: [],
    fileScope: ["src/a.ts"],
    blocked: null,
    deferred: null,
  });
  const recommendation = (
    run: GateRun,
    items: GateItem[],
  ): { tool: string; perItem: boolean } | null => {
    const verdict = legalTools(run, items, [], true, true);
    if (verdict.recommended === null) return null;
    return {
      tool: verdict.recommended.tool,
      perItem: verdict.recommended.args.itemId !== undefined,
    };
  };

  // Run-level: the recommendation at each run FSM position that has one.
  const runWalk: string[] = [];
  const runPositions: Array<[string, string | null]> = [
    ["INTAKE", null],
    ["INTAKE", "work"],
    ["DECOMPOSED", "work"],
    ["PLANNED", "work"],
    ["PLAN_REVIEWED", "work"],
    ["EXECUTING", "work"],
  ];
  for (const [state, kind] of runPositions) {
    const items = state === "EXECUTING" ? [asItem("PUBLISHED", true)] : [];
    const rec = recommendation(asRun(state, kind), items);
    if (rec !== null && !rec.perItem && !runWalk.includes(rec.tool)) runWalk.push(rec.tool);
  }
  assert.deepEqual(
    runStageTools(),
    runWalk,
    "runStageTools() must equal the run-level recommendations legalTools actually produces",
  );
  assert.ok(runWalk.length >= 6, "the run-stage walk must find every run stage, not a truncated prefix");

  // Item-level: the recommendation for a lone behavioral item at each item state.
  const itemWalk: string[] = [];
  for (const state of ITEM_STATES) {
    const rec = recommendation(asRun("EXECUTING", "work"), [asItem(state, true)]);
    if (rec !== null && rec.perItem && !itemWalk.includes(rec.tool)) itemWalk.push(rec.tool);
  }
  assert.deepEqual(
    itemStageTools(),
    itemWalk,
    "itemStageTools() must equal the per-item recommendations legalTools actually produces",
  );
  assert.ok(itemWalk.length >= 6, "the item-stage walk must find every item stage, not a truncated prefix");

  // The non-behavioral entry point is derived, not asserted.
  const nonBehavioral = recommendation(asRun("EXECUTING", "work"), [asItem("PENDING", false)]);
  assert.notEqual(nonBehavioral, null, "a non-behavioral PENDING item must have a recommended stage tool");
  assert.equal(
    nonBehavioralEntryTool(),
    nonBehavioral === null ? "" : nonBehavioral.tool,
    "nonBehavioralEntryTool() must equal what legalTools recommends for a non-behavioral PENDING item",
  );

  // Meta tools: the bound vocabulary minus the stage tools, and nothing invented.
  const bound = Object.keys(TOOL_BINDINGS).filter((name) => TOOL_BINDINGS[name] !== null);
  const stage = new Set([...runWalk, ...itemWalk]);
  const expectedMeta = bound.filter((name) => !stage.has(name)).sort();
  assert.deepEqual(
    metaTools(),
    expectedMeta,
    "metaTools() must be the bound TOOL_BINDINGS vocabulary minus the stage tools",
  );
});

test("I4B-1D: the mechanics derivation's legalTools call is pinned to the two NAMED description constants", () => {
  const source = readFileSync(new URL("../core/mechanics.ts", import.meta.url), "utf8");
  // The C-048 guard (tests/legaltools-callsites.test.ts) forbids a shipped VERDICT
  // that hardcodes publishEnabled. This call site renders a checked-in pack rather
  // than judging a workspace, so it fixes both gate inputs — and that exception is
  // recorded HERE, by name, so it cannot quietly become a bare literal later.
  assert.ok(
    source.includes(
      "legalTools(run, items, [], DESCRIBES_CONFIGURED_REPO, DESCRIBES_FULL_PIPELINE)",
    ),
    "core/mechanics.ts must pass the two NAMED description constants to legalTools, so the " +
      "reason this call site fixes them is readable at the call rather than assumed",
  );
  for (const name of ["DESCRIBES_CONFIGURED_REPO", "DESCRIBES_FULL_PIPELINE"]) {
    assert.ok(
      source.includes(`const ${name} = true;`),
      `core/mechanics.ts must define ${name} = true (the fullest pipeline the FSM defines)`,
    );
  }
});

test("I4B-1C: every conductor_* token a pack's mechanics block names is a bound tool in the closed vocabulary", () => {
  const bound = new Set(Object.keys(TOOL_BINDINGS).filter((name) => TOOL_BINDINGS[name] !== null));
  let namedTotal = 0;
  for (const name of PACKS) {
    const block = extractMechanics(readPack(name));
    assert.notEqual(block, null, `${name} must carry a mechanics block`);
    const named = (block ?? "").match(/conductor_[a-z_]+/g) ?? [];
    assert.ok(named.length > 0, `${name}'s mechanics block must name at least one tool`);
    namedTotal += named.length;
    for (const tool of named) {
      assert.ok(
        bound.has(tool),
        `${name}'s mechanics block names ${tool}, which is not a bound tool in TOOL_BINDINGS`,
      );
    }
  }
  assert.ok(namedTotal >= 9, "the packs' mechanics blocks together must name the tool vocabulary, not one token");
});

// ===========================================================================
// 2. GAP-005 half (a) — dispatch prompts DERIVE their doctrine from the packs.
// ===========================================================================

// A minimal §2.2 config the prompt builders read (behavioral paths, the trivial
// file cap, the ponytail intensity). Only the fields the prompts consume matter.
function testConfig(): Config {
  return {
    verify: {
      scopes: {},
      behavioralPaths: ["src/**"],
    },
    workflow: { trivialMaxFiles: 3 },
    ponytail: "standard",
  } as unknown as Config;
}

function testQueueItem(): QueueItem {
  return {
    id: "I1",
    title: "an item",
    rationale: "because",
    fileScope: ["src/a.ts"],
    testScope: ["tests/a.test.ts"],
    acceptance: ["it does the thing"],
    behavioral: true,
    dependsOn: [],
    ponytail: { ladderRung: "minimal-code", necessary: "n", reuse: "r" },
  } as unknown as QueueItem;
}

function testQueue(): Queue {
  return { items: [testQueueItem()] } as unknown as Queue;
}

function testFinding(): Findings["findings"][number] {
  return {
    id: "F1",
    severity: "major",
    lens: "correctness",
    claim: "the thing is wrong",
    evidence: "src/a.ts:1",
    suggestedFix: "fix the thing",
  } as unknown as Findings["findings"][number];
}

// Each row: the prompt under test, the pack it must compose FROM, and one heading
// whose text must arrive VERBATIM (so the rules exist in the pack and nowhere else).
const DERIVATION_ROWS: ReadonlyArray<{
  label: string;
  pack: string;
  heading: string;
  build: (packs: Record<string, string>) => string;
}> = [
  {
    label: "decomposePrompt",
    pack: "decompose.md",
    heading: "Rejection checklist (self-check before you return)",
    build: (packs) => decomposePrompt("do the work", testConfig(), packs),
  },
  {
    label: "planPrompt",
    pack: "plan.md",
    heading: "Self-check before returning",
    build: (packs) => planPrompt("do the work", testQueue(), testConfig(), packs),
  },
  {
    label: "lensPrompt",
    pack: "review.md",
    heading: "An empty review is the approval",
    build: (packs) =>
      lensPrompt(
        { id: "correctness", charge: "correctness of the plan" },
        "do the work",
        "# plan",
        testQueue(),
        packs,
      ),
  },
  {
    label: "skepticRefutePrompt",
    pack: "skeptic.md",
    heading: "Refutation carries evidence; abstention upholds",
    build: (packs) =>
      skepticRefutePrompt(testFinding(), "correctness", 3, "do the work", "# plan", testQueue(), packs),
  },
  {
    label: "itemLensPrompt",
    pack: "review.md",
    heading: "An empty review is the approval",
    build: (packs) => itemLensPrompt(["correctness"], testQueueItem(), "\ndiff\n", "test text", 2, packs, "RW-nonce"),
  },
  {
    label: "itemSkepticPrompt",
    pack: "skeptic.md",
    heading: "Refutation carries evidence; abstention upholds",
    build: (packs) =>
      itemSkepticPrompt(
        { finding: testFinding(), lens: "correctness", sessionID: "s1", key: "s1:F1" },
        3,
        testQueueItem(),
        "\ndiff\n",
        "test text",
        packs,
      ),
  },
];

test("I4B-2A: every dispatch prompt carries its doctrine slice VERBATIM out of the pack map", () => {
  const packs = packMap();
  for (const row of DERIVATION_ROWS) {
    const slice = packSection(packs[row.pack] ?? "", row.heading) ?? "";
    assert.ok(
      slice.length > 80,
      `${row.pack} must carry the section "${row.heading}" the ${row.label} composition reads, ` +
        "with real doctrine in it",
    );
    const prompt = row.build(packs);
    assert.ok(
      prompt.includes(slice),
      `${row.label} must carry ${row.pack}'s "${row.heading}" section VERBATIM (composed from the pack ` +
        "map, never re-spelled in the prompt literal)",
    );
  }
});

test("I4B-2B: an edited pack changes what the dispatch prompt says (the override is not theater)", () => {
  const packs = packMap();
  const marker = "OPERATOR OVERRIDE SENTINEL 4711";
  for (const row of DERIVATION_ROWS) {
    const original = packs[row.pack] ?? "";
    const edited = original.replace("## " + row.heading, "## " + row.heading + "\n\n" + marker);
    assert.notEqual(edited, original, `the ${row.pack} edit fixture must actually change the pack`);
    const prompt = row.build({ ...packs, [row.pack]: edited });
    assert.ok(
      prompt.includes(marker),
      `${row.label} must reflect an edit to ${row.pack} — otherwise the doctrine directory it reads is theater`,
    );
  }
});

test("I4B-2C: a dispatch prompt whose pack is missing REFUSES, naming the pack", () => {
  const packs = packMap();
  for (const row of DERIVATION_ROWS) {
    const without: Record<string, string> = { ...packs };
    delete without[row.pack];
    assert.throws(
      () => row.build(without),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        assert.ok(
          message.includes(row.pack),
          `${row.label}'s refusal must NAME the absent pack (${row.pack}); got: ${message}`,
        );
        return true;
      },
      `${row.label} must refuse to dispatch without the doctrine that governs it`,
    );
  }
});

// The two fail-closed arms of doctrineSlice answer two DIFFERENT questions — "is
// the pack there at all?" and "does that pack still carry the section this
// dispatch composes from?" — and an operator reads the refusal to know which file
// to repair and how. I4B-2C alone cannot tell them apart: both refusals name the
// pack, so folding the pack check into the section check (a `?? ""` default and a
// dead first arm) leaves it green while every absent-pack dispatch starts
// reporting a missing HEADING in a pack that does not exist. This row pins the two
// message shapes apart, which is what makes each arm separately load-bearing.
const NO_PACK_SHAPE = /the loaded pack set has none/;
const NO_SECTION_SHAPE = /carries no section/;

function refusalMessage(build: () => string): string {
  try {
    build();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return "";
}

test("I4B-2E: the ABSENT-pack refusal and the ABSENT-section refusal are distinguishable shapes", () => {
  const packs = packMap();
  for (const row of DERIVATION_ROWS) {
    // (a) the pack is not in the map at all.
    const without: Record<string, string> = { ...packs };
    delete without[row.pack];
    const absent = refusalMessage(() => row.build(without));
    assert.match(
      absent,
      NO_PACK_SHAPE,
      `${row.label} must refuse an ABSENT ${row.pack} as a missing PACK ("the loaded pack set has ` +
        `none"), so the operator is told the file is gone; got: ${absent}`,
    );
    assert.doesNotMatch(
      absent,
      NO_SECTION_SHAPE,
      `and it must not report a missing SECTION of a pack that is not there — that is the other ` +
        `arm's message, and reading it sends the operator hunting for a heading in a file that ` +
        `does not exist; got: ${absent}`,
    );

    // (b) the pack is present but EMPTY: doctrine that governs nothing is the
    // same failure as doctrine that is absent, and it takes the same arm.
    const blank = refusalMessage(() => row.build({ ...packs, [row.pack]: "   \n\n" }));
    assert.match(
      blank,
      NO_PACK_SHAPE,
      `${row.label} must treat an EMPTY ${row.pack} as no doctrine at all; got: ${blank}`,
    );

    // (c) the pack is real doctrine but no longer carries the section the prompt
    // composes from — a pack edit, not a missing file.
    const renamed = (packs[row.pack] ?? "").replace("## " + row.heading, "## " + row.heading + " (retitled)");
    assert.notEqual(renamed, packs[row.pack], `the ${row.pack} retitle fixture must change the pack`);
    const missingSection = refusalMessage(() => row.build({ ...packs, [row.pack]: renamed }));
    assert.match(
      missingSection,
      NO_SECTION_SHAPE,
      `${row.label} must refuse a PRESENT ${row.pack} whose "${row.heading}" section is gone as a ` +
        `missing SECTION; got: ${missingSection}`,
    );
    assert.ok(
      missingSection.includes(row.heading),
      `and it must name the heading it looked for; got: ${missingSection}`,
    );
    assert.doesNotMatch(
      missingSection,
      NO_PACK_SHAPE,
      `and it must not claim the pack set has no ${row.pack} when it has one; got: ${missingSection}`,
    );
  }
});

// The conductor_plan prompt states the placeholder law by carrying plan.md's
// self-check verbatim. That is only equivalent to the law if the self-check NAMES
// the shapes core/planning.ts actually rejects: a planner told "no step defers its
// content" and then rejected for the token "TBD" was never told the rule it was
// judged by, and the bounded re-prompt burns on a defect the doctrine could have
// prevented.
//
// The check runs the REAL rejector over the doctrine, so there is no second copy of
// the list to drift: a rule added to PLAN_PLACEHOLDERS goes red here until the
// self-check names an example of it.
test("I4B-2F: plan.md's self-check names every placeholder shape core/planning.ts rejects, and the dispatch prompt carries them", () => {
  const selfCheck = packSection(readPack("plan.md"), "Self-check before returning");
  assert.notEqual(selfCheck, null, "plan.md must carry the self-check section the plan prompt composes from");
  const tripped = new Set(scanPlaceholders(selfCheck ?? ""));
  assert.ok(PLAN_PLACEHOLDER_LABELS.length >= 7, "premise: the rejector names several distinct shapes");
  for (const label of PLAN_PLACEHOLDER_LABELS) {
    assert.ok(
      tripped.has(label),
      `plan.md's self-check must name the "${label}" shape by example, so the planner reads the same ` +
        "law the handler judges it by; scanning the section reported: " +
        JSON.stringify([...tripped]),
    );
  }

  // And the tokens survive the composition into the prompt the planner is sent —
  // the section can name them and the prompt still lose them if the slice moves.
  const prompt = planPrompt("do the work", testQueue(), testConfig(), packMap());
  for (const token of ["TBD", "add error handling", "similar to task"]) {
    assert.ok(
      prompt.includes(token),
      `the conductor_plan prompt must name the "${token}" defect (plan line 1115 names these three ` +
        "by name); it reaches the prompt only through plan.md's self-check slice",
    );
  }
});

test("I4B-2D: the retired paraphrases are GONE from adapter/tools.ts — one spelling, not two", () => {
  const source = readFileSync(new URL("../adapter/tools.ts", import.meta.url), "utf8");
  const retired: readonly string[] = [
    "dependsOn names other item ids and must form a DAG",
    "an item that writes nothing is not an item",
    "acceptance criteria are observable checks an assertion can run",
    "are plan defects BY ",
    "is a genuine defect that must be fixed before this plan",
    "when you cannot decide, the verdict is REFUTED",
    "comes FIRST and must FAIL before any implementation",
    "smaller robustness issue",
  ];
  for (const phrase of retired) {
    assert.ok(
      !source.includes(phrase),
      `adapter/tools.ts still hand-spells doctrine: ${JSON.stringify(phrase)} — compose it from the pack map`,
    );
  }
});

// ===========================================================================
// 3. GAP-039 — tdd.md's cycle must end in an action the gates ALLOW.
// ===========================================================================

test("I4B-3A: the git gate denies `git commit` for a model session (the fact GAP-039 rests on)", () => {
  for (const mode of ["read-only", "commit", "commit-and-push"] as const) {
    const decision = decideGit('git commit -m "wip"', "implementer", mode, true, "pin");
    assert.equal(
      decision.action,
      "deny",
      `git commit must be DENIED in git mode ${mode} — doctrine may not teach a step the gate refuses`,
    );
  }
});

test("I4B-3B: tdd.md's headline cycle ends in handing back, not in a git write", () => {
  const tdd = readPack("tdd.md");
  const headings = tdd.split("\n").filter((line) => line.startsWith("## "));
  const cycle = headings.find((line) => line.toLowerCase().includes("the cycle"));
  assert.notEqual(cycle, undefined, "tdd.md must carry a headline cycle heading");
  assert.ok(
    !/commit/i.test(cycle ?? ""),
    `tdd.md's cycle heading must not end in commit (the git gate denies it); found ${JSON.stringify(cycle)}`,
  );
  assert.ok(
    /hand back/i.test(cycle ?? ""),
    `tdd.md's cycle must end in handing back; found ${JSON.stringify(cycle)}`,
  );
});

test("I4B-3C: tdd.md anchors the full sentence that names the legal path (ISSUE-135's fix form)", () => {
  const tdd = flat(readPack("tdd.md"));
  assert.ok(
    tdd.includes(
      flat("conductor_publish commits; you never run git commit — a self-publish is denied by design"),
    ),
    "tdd.md must anchor the FULL sentence 'conductor_publish commits; you never run git commit — a " +
      "self-publish is denied by design' (a keyword anchor is what ISSUE-135 says is not enough)",
  );
  assert.ok(
    tdd.includes(flat("conductor_mark_green")),
    "tdd.md must name conductor_mark_green — the legal action the implementer's cycle ends in",
  );
});

test("I4B-3D: the only git invocation tdd.md names is the one it forbids", () => {
  const tdd = readPack("tdd.md");
  const invocations = flat(tdd).match(/git [a-z][a-z-]*/g) ?? [];
  assert.ok(invocations.length > 0, "tdd.md must still name the git write it forbids");
  for (const invocation of invocations) {
    assert.ok(
      flat(tdd).includes(`you never run ${invocation}`),
      `tdd.md names "${invocation}" outside the sentence that forbids it — a doctrine step the gate denies`,
    );
  }
});

// ===========================================================================
// 4. Pack size discipline — the packs ride in a 32k context.
// ===========================================================================

// ~2.6k tokens at the conservative 4-bytes-per-token rule is ~10.4kB; this floor
// is deliberately tighter, because a role can receive TWO packs plus the live
// state block plus its payload in the same window.
const MAX_PACK_BYTES = 6500;

test("I4B-4: every doctrine pack stays lean enough for a 32k context", () => {
  for (const name of PACKS) {
    const bytes = Buffer.byteLength(readPack(name), "utf8");
    assert.ok(
      bytes <= MAX_PACK_BYTES,
      `${name} is ${bytes} bytes — over the ${MAX_PACK_BYTES}-byte pack budget; the packs ride in a ` +
        "32k context alongside the state block and the payload",
    );
  }
});
