// Task 8.2 red tests — lives at conductor/tests/inject.test.ts once moved in.
//
// Subject (must NOT exist when this goes red; the failure is
// `Cannot find module '../adapter/inject.ts'` — the missing-subject shape, a
// legal red because the unresolved path resolves inside THIS task's fileScope):
//   - conductor/adapter/inject.ts   (the §6.4 system-prompt injection layer)
//
// The three interfaces under test (plan §6.4 lines 1892-1903, §4.1 roles table
// 1512-1543, §4.4 router headers 1636-1698, §3.8 liveness beacon 1478-1495,
// §7.1 levels/sinks 1909-1945), plus the §6.4 "fail-closed at init" pack loader:
//
//   buildSystemAppend(registryEntry, run, items, questions, packs, ctx) -> string[]
//       // [0] is the session's role doctrine pack content (orchestrator: core.md;
//       // sub-session: its role pack); the LAST entry is a live state block <=30
//       // lines carrying: run state, active item+state, the RECOMMENDED next tool
//       // (from legalTools(...).recommended) with its args, a COUNT of the other
//       // legal tools, open-question count, blocked/deferred counts, taint count,
//       // overrides remaining. Re-stated every request, never remembered (G9) —
//       // a pure function of its inputs.
//       //
//       // ctx is the trailing options object this task ADDS to the §6.4 ledger arg
//       // list (which omits the state-block scalars legalTools + the block need):
//       //     { repoConfigured: boolean; taintCount: number; overridesRemaining: number }
//       // repoConfigured is what buildSystemAppend forwards to legalTools; open-
//       // question / blocked / deferred counts are DERIVED from questions + items,
//       // so they are NOT in ctx. packs is the cached Record<filename, content>
//       // keyed by pack filename (e.g. "core.md").
//
//   paramsForRole(role) -> { temperature: number; topP?: number }
//       // §4.1: orchestrator 0.4, planner 0.7, testWriter 0.5, implementer 0.4,
//       // reviewer 0.3, skeptic 0.3, mechanical 0.1.
//
//   headersFor(registryEntry, job?) -> Record<string,string>
//       // §4.4 tags: X-Conductor-Role (the role); X-Conductor-Priority
//       // (interactive|review|batch per §4.1: orchestrator/planner interactive,
//       // testWriter/implementer/reviewer/skeptic review, mechanical batch);
//       // X-Conductor-Group (a prefix-affinity group id, present when a group/tree
//       // is known); X-Conductor-Schema: required ONLY when the job flags schema.
//       // job = { schema?: boolean }.
//
//   loadPacks(doctrineDir) -> Record<string,string>
//       // reads the nine required packs from doctrineDir; THROWS with a message
//       // NAMING the missing pack file when any is absent (§6.4 fail-closed).
//   initPlugin({ doctrineDir, logError, writeBeacon }) -> Record<string,string>
//       // loads packs BEFORE writing the §3.8 beacon: on success calls writeBeacon
//       // exactly once and returns the pack map; on a missing pack it calls
//       // logError(message-naming-the-pack) — the §7.1 stderr ERROR-LOG seam
//       // (client.app.log), NOT a conductor journal event — then re-throws, and
//       // writeBeacon is NEVER called (so §3.8's beacon-ABSENCE proves init failed).
//
// Assertion id -> test name (docs/build/specs/task-8.2.assertions.json):
//   8.2-api               -> three interfaces exist; append = [rolePack, ...block];
//                            paramsForRole temperature table; + G9 purity.
//   8.2-role-packs        -> orchestrator core.md + run block; implementer tdd.md + item block.
//   8.2-30-lines          -> block <=30 lines with 40 items (summarized, not listed).
//   8.2-recommended       -> block recommended tool == legalTools(...).recommended
//                            across three states + conductor_setup when unconfigured.
//   8.2-one-recommendation-> two-item wave: ONE recommendation, rest as a count.
//   8.2-headers           -> role/priority/group/schema tags per §4.4/§4.1.
//   8.2-missing-pack      -> loader + init throw, log, and never write the beacon.
//
// Runtime hygiene: node:test + node:assert/strict; erasable TS (no enum/namespace/
// parameter properties/import=); node built-ins only; no skip/todo, no vacuous
// asserts, no empty catch. legalTools/gates-phase.ts and the doctrine packs both
// EXIST, so the ONLY missing subject is inject.ts — the red is its module-not-found.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// The subject under test — absent at red time (the missing-subject red).
import {
  buildSystemAppend,
  paramsForRole,
  headersFor,
  loadPacks,
  initPlugin,
} from "../adapter/inject.ts";

// The single tool-legality derivation the injection consumes (already implemented).
import { legalTools } from "../core/gates-phase.ts";
import type { GateRun, GateItem, GateQuestion } from "../core/gates-phase.ts";
// Reuse the EXISTING registry-entry shape (chat-message.ts §3.5 orchestrator entry;
// fanout.ts writes the sub-session entries) — a third shape is not invented here.
import type { SessionRegistryEntry } from "../adapter/chat-message.ts";
import { treePath } from "../core/types.ts";

// ---------------------------------------------------------------------------
// Doctrine packs on disk (read relative to THIS test file, not cwd — matches the
// conductor/tests/ home the file is moved into). G4: real pack content, not stubs.
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCTRINE_DIR = path.resolve(HERE, "..", "doctrine");

const PACK_FILES: readonly string[] = [
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

function loadRealPacks(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of PACK_FILES) map[f] = readFileSync(path.join(DOCTRINE_DIR, f), "utf8");
  return map;
}

const PACKS = loadRealPacks();

// ---------------------------------------------------------------------------
// Fixtures (the *Like builder style of gates-phase.test.ts, over the gate subsets).
// ---------------------------------------------------------------------------

const run = (over: Partial<GateRun> = {}): GateRun => ({
  state: "EXECUTING",
  stop: null,
  classification: { kind: "work" },
  ...over,
});

const item = (over: Partial<GateItem> = {}): GateItem => ({
  id: "I1",
  state: "PENDING",
  behavioral: true,
  dependsOn: [],
  fileScope: ["src/i1.ts"],
  blocked: null,
  deferred: null,
  ...over,
});

// The trailing options object this task adds to the §6.4 ledger arg list.
interface InjectCtx {
  repoConfigured: boolean;
  // C-054: §3.9 publish availability, threaded rather than defaulted. The factory
  // below defaults it TRUE — the ordinary git-mode workspace these rows are about
  // — so every existing assertion keeps its meaning; the no-git behaviour has its
  // own row in the gate suite.
  publishEnabled: boolean;
  taintCount: number;
  overridesRemaining: number;
}
const ctx = (over: Partial<InjectCtx> = {}): InjectCtx => ({
  repoConfigured: true,
  publishEnabled: true,
  taintCount: 0,
  overridesRemaining: 3,
  ...over,
});

// The registry entries the injection dispatches on (reused SessionRegistryEntry).
const ORCH: SessionRegistryEntry = { role: "orchestrator" };

// The §3.4 per-item stage tool names (used by the one-recommendation test).
const PER_ITEM_TOOLS: readonly string[] = [
  "conductor_submit_test",
  "conductor_vet_test",
  "conductor_mark_green",
  "conductor_validate",
  "conductor_item_review",
  "conductor_publish",
];

// The state block is the LAST append entry (pack(s) first, live block last).
const stateBlockOf = (append: string[]): string => append[append.length - 1];

// Count newline-delimited lines, not counting a single trailing newline as a line
// (the §8.1 doctrine.test.ts convention).
function lineCount(text: string): number {
  const parts = text.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts.length;
}

// ===========================================================================
// [8.2-api] the three interfaces exist with their shapes; append = [rolePack,
// ...stateBlock]; paramsForRole temperature table; G9 purity.
// ===========================================================================

test("8.2-api: buildSystemAppend/paramsForRole/headersFor exist; append is [rolePack, ...stateBlock]", () => {
  assert.equal(typeof buildSystemAppend, "function", "buildSystemAppend is exported");
  assert.equal(typeof paramsForRole, "function", "paramsForRole is exported");
  assert.equal(typeof headersFor, "function", "headersFor is exported");

  const r = run({ state: "EXECUTING" });
  const items = [item({ id: "I1", state: "PENDING", behavioral: true })];
  const append = buildSystemAppend(ORCH, r, items, [], PACKS, ctx());

  assert.ok(Array.isArray(append), "buildSystemAppend returns an array");
  assert.ok(append.length >= 2, "append carries the role pack AND a distinct state block");
  for (const entry of append) assert.equal(typeof entry, "string", "every append entry is a string");

  // (a) first entry IS the role pack content (orchestrator -> core.md), verbatim.
  assert.equal(append[0], PACKS["core.md"], "append[0] is the orchestrator's core.md pack content");

  // (b) the trailing entry is a non-empty state block naming the recommended tool.
  const block = stateBlockOf(append);
  assert.ok(block.length > 0, "the state block is non-empty");
  const expected = legalTools(r, items, [], true);
  assert.notEqual(expected.recommended, null, "the fixture state has a recommendation to surface");
  assert.ok(
    block.includes(expected.recommended!.tool),
    "the state block names legalTools(...).recommended.tool",
  );

  // paramsForRole + headersFor minimal shapes.
  const p = paramsForRole("orchestrator");
  assert.equal(typeof p.temperature, "number", "paramsForRole returns a numeric temperature");
  const h = headersFor(ORCH);
  assert.equal(h["X-Conductor-Role"], "orchestrator", "headersFor tags the role");
});

test("8.2-api: paramsForRole returns the §4.1 sampling temperature for every role", () => {
  const expected: ReadonlyArray<readonly [string, number]> = [
    ["orchestrator", 0.4],
    ["planner", 0.7],
    ["testWriter", 0.5],
    ["implementer", 0.4],
    ["reviewer", 0.3],
    ["skeptic", 0.3],
    ["mechanical", 0.1],
  ];
  for (const [role, temperature] of expected) {
    const p = paramsForRole(role);
    assert.equal(p.temperature, temperature, `${role} samples at temperature ${temperature} (§4.1)`);
  }
});

test("8.2-api / G9: buildSystemAppend re-states purely — identical inputs yield identical output, never remembered", () => {
  const r = run({ state: "EXECUTING" });
  const items = [
    item({ id: "I1", state: "PENDING", behavioral: true, fileScope: ["src/a.ts"] }),
    item({ id: "I2", state: "TEST_VETTED", behavioral: true, fileScope: ["src/b.ts"] }),
  ];
  const questions: GateQuestion[] = [{ id: "Q1", answeredIso: null }];
  const c = ctx({ taintCount: 1, overridesRemaining: 2 });

  const first = buildSystemAppend(ORCH, r, items, questions, PACKS, c);
  const second = buildSystemAppend(ORCH, r, items, questions, PACKS, c);

  assert.deepEqual(second, first, "the same inputs produce the same append — a pure re-statement (G9)");
});

// ===========================================================================
// [8.2-role-packs] orchestrator -> core.md + run block; implementer -> tdd.md +
// that item's block.
// ===========================================================================

test("8.2-role-packs: orchestrator gets core.md + a run block; implementer gets tdd.md + its item block", () => {
  const items = [
    item({ id: "I1", state: "PENDING", behavioral: true, fileScope: ["src/a.ts"] }),
    item({ id: "I2", state: "GREEN", behavioral: true, fileScope: ["src/b.ts"] }),
  ];

  // Orchestrator: core.md first, a RUN-level block (names the run state).
  const orch = buildSystemAppend(ORCH, run({ state: "EXECUTING" }), items, [], PACKS, ctx());
  assert.equal(orch[0], PACKS["core.md"], "orchestrator's first append entry is core.md");
  assert.ok(stateBlockOf(orch).includes("EXECUTING"), "the orchestrator block reports the run state");

  // Implementer working I2: tdd.md first, and its block is about I2 (its id + state).
  const impl: SessionRegistryEntry = { role: "implementer", itemId: "I2" };
  const implAppend = buildSystemAppend(impl, run({ state: "EXECUTING" }), items, [], PACKS, ctx());
  assert.equal(implAppend[0], PACKS["tdd.md"], "implementer's first append entry is tdd.md");
  const implBlock = stateBlockOf(implAppend);
  assert.ok(implBlock.includes("I2"), "the implementer block is scoped to its item I2");
  assert.ok(implBlock.includes("GREEN"), "the implementer block reports I2's item state");
});

// ===========================================================================
// [8.2-30-lines] with 40 items the block still fits in <=30 lines — it SUMMARIZES,
// it does not list every item.
// ===========================================================================

test("8.2-30-lines: the state block stays <=30 lines with 40 items (summarized, not listed)", () => {
  const ids: string[] = [];
  const items: GateItem[] = [];
  for (let n = 1; n <= 40; n += 1) {
    const id = `I${String(n).padStart(2, "0")}`; // I01..I40 — no id is a substring of another
    ids.push(id);
    items.push(item({ id, state: "PENDING", behavioral: true, fileScope: [`src/${id}.ts`] }));
  }

  const block = stateBlockOf(buildSystemAppend(ORCH, run({ state: "EXECUTING" }), items, [], PACKS, ctx()));

  assert.ok(lineCount(block) <= 30, `the state block is <=30 lines (was ${lineCount(block)})`);

  // Summarization: it cannot be naming all 40 items — a fully-listed block would
  // carry every id.
  const named = ids.filter((id) => block.includes(id)).length;
  assert.ok(named < ids.length, `the block summarizes rather than listing all 40 items (named ${named})`);
});

// ===========================================================================
// [8.2-recommended] the block's recommended tool equals legalTools(...).recommended
// for three DISTINCT run states, and names conductor_setup when the repo is
// unconfigured. The test derives the expectation from legalTools — it never
// hardcodes the tool independently.
// ===========================================================================

test("8.2-recommended: the block names legalTools(...).recommended across three states + conductor_setup when unconfigured", () => {
  const cases: ReadonlyArray<{ label: string; r: GateRun; items: GateItem[]; repoConfigured: boolean }> = [
    // INTAKE unclassified -> conductor_classify.
    { label: "INTAKE unclassified", r: run({ state: "INTAKE", classification: null }), items: [], repoConfigured: true },
    // PLAN_REVIEWED -> conductor_dispatch_wave.
    {
      label: "PLAN_REVIEWED",
      r: run({ state: "PLAN_REVIEWED" }),
      items: [
        item({ id: "I1", state: "PENDING", fileScope: ["src/a.ts"] }),
        item({ id: "I2", state: "PENDING", fileScope: ["src/b.ts"] }),
      ],
      repoConfigured: true,
    },
    // EXECUTING with an actionable behavioral item -> a per-item stage tool.
    {
      label: "EXECUTING per-item",
      r: run({ state: "EXECUTING" }),
      items: [item({ id: "I1", state: "PENDING", behavioral: true })],
      repoConfigured: true,
    },
    // Unconfigured repo -> conductor_setup, whatever the state.
    {
      label: "unconfigured",
      r: run({ state: "EXECUTING" }),
      items: [item({ id: "I1", state: "PENDING", behavioral: true })],
      repoConfigured: false,
    },
  ];

  const seen = new Set<string>();
  for (const kase of cases) {
    const expected = legalTools(kase.r, kase.items, [], kase.repoConfigured);
    assert.notEqual(expected.recommended, null, `${kase.label} yields a recommendation`);
    const tool = expected.recommended!.tool;
    seen.add(tool);

    const block = stateBlockOf(
      buildSystemAppend(ORCH, kase.r, kase.items, [], PACKS, ctx({ repoConfigured: kase.repoConfigured })),
    );
    assert.ok(block.includes(tool), `${kase.label}: the block names the recommended tool ${tool}`);

    // A per-item recommendation carries its target id — the "with its args" clause.
    const itemId = expected.recommended!.args.itemId;
    if (itemId !== undefined) {
      assert.ok(block.includes(itemId), `${kase.label}: the block names the recommended item ${itemId}`);
    }
  }

  // The unconfigured branch really did recommend conductor_setup (guards against a
  // fixture that accidentally recommended the same tool everywhere).
  assert.ok(seen.has("conductor_setup"), "the unconfigured case recommended conductor_setup");
  assert.ok(seen.size >= 3, "the chosen states produced at least three distinct recommendations");
});

// ===========================================================================
// [8.2-one-recommendation] a two-item actionable wave names EXACTLY ONE
// recommendation (the wave-order-first item's stage tool, matching
// legalTools.recommended) and reports the other legal tools as a COUNT — never a
// list of multiple contradictory "do this" instructions.
// ===========================================================================

test("8.2-one-recommendation: a two-item wave names exactly ONE recommendation and counts the rest", () => {
  // I1 behavioral PENDING -> conductor_submit_test; I2 behavioral TEST_VETTED ->
  // conductor_mark_green. Both depth 0, fileScope-disjoint => both actionable; the
  // wave-order-first (tie broken by id) is I1.
  const items = [
    item({ id: "I1", state: "PENDING", behavioral: true, fileScope: ["src/a.ts"] }),
    item({ id: "I2", state: "TEST_VETTED", behavioral: true, fileScope: ["src/b.ts"] }),
  ];
  const r = run({ state: "EXECUTING" });
  const expected = legalTools(r, items, [], true);
  assert.notEqual(expected.recommended, null, "the wave has a recommendation");
  const recommendedTool = expected.recommended!.tool;

  const block = stateBlockOf(buildSystemAppend(ORCH, r, items, [], PACKS, ctx()));

  // Exactly ONE recommendation: among the per-item stage tools in the legal set,
  // ONLY the recommended one is named in the block; the others are folded into a
  // count, never presented as a second "do this".
  for (const tool of PER_ITEM_TOOLS) {
    if (!expected.legal.has(tool)) continue;
    if (tool === recommendedTool) {
      assert.ok(block.includes(tool), `the block names the single recommendation ${tool}`);
    } else {
      assert.ok(
        !block.includes(tool),
        `${tool} is another legal tool — it must be counted, not named as a contradictory instruction`,
      );
    }
  }

  // The block reports a COUNT of the other legal tools — derived from legalTools,
  // not hardcoded: other = legal.size - 1 (the recommended one excluded).
  const otherLegal = expected.legal.size - 1;
  assert.match(
    block,
    new RegExp(`\\b${otherLegal}\\b`),
    `the block reports the ${otherLegal} other legal tools as a count`,
  );
});

// ===========================================================================
// [8.2-headers] §4.4/§4.1 tags: X-Conductor-Role, X-Conductor-Priority per role,
// X-Conductor-Group when a tree is known, X-Conductor-Schema only when the job
// flags a structured-output request.
// ===========================================================================

test("8.2-headers: role + priority per §4.1, group when a tree is known, schema only when the job flags it", () => {
  const priorityByRole: ReadonlyArray<readonly [string, string]> = [
    ["orchestrator", "interactive"],
    ["planner", "interactive"],
    ["testWriter", "review"],
    ["implementer", "review"],
    ["reviewer", "review"],
    ["skeptic", "review"],
    ["mechanical", "batch"],
  ];
  for (const [role, priority] of priorityByRole) {
    const h = headersFor({ role });
    assert.equal(h["X-Conductor-Role"], role, `X-Conductor-Role is ${role}`);
    assert.equal(h["X-Conductor-Priority"], priority, `${role} is priority ${priority} (§4.1)`);
  }

  // X-Conductor-Group: present + non-empty when a tree/group is known...
  const reviewer: SessionRegistryEntry = { role: "reviewer", itemId: "I3", tree: treePath("/repo/reviews/I3") };
  const withTree = headersFor(reviewer);
  assert.ok(Object.hasOwn(withTree, "X-Conductor-Group"), "a tree-bearing entry gets X-Conductor-Group");
  assert.ok(withTree["X-Conductor-Group"].length > 0, "the group id is non-empty");
  // ...and absent for a bare orchestrator entry with no tree/group.
  assert.equal(
    Object.hasOwn(headersFor(ORCH), "X-Conductor-Group"),
    false,
    "no group header when no tree/group is known",
  );

  // X-Conductor-Schema: required ONLY when the job flags structured output.
  const schemaOn = headersFor(ORCH, { schema: true });
  assert.equal(schemaOn["X-Conductor-Schema"], "required", "a schema job tags X-Conductor-Schema: required");
  assert.equal(
    Object.hasOwn(headersFor(ORCH), "X-Conductor-Schema"),
    false,
    "no schema header without a job",
  );
  assert.equal(
    Object.hasOwn(headersFor(ORCH, { schema: false }), "X-Conductor-Schema"),
    false,
    "no schema header when the job does not flag schema",
  );
});

// ===========================================================================
// [8.2-missing-pack] the loader + the init ordering seam: a missing pack throws
// (naming the pack), the error is surfaced via the injected logError seam (§7.1
// stderr, NOT a journal event), and the §3.8 beacon is NEVER written — so the
// beacon's ABSENCE is a real fail-closed signal. On a complete dir, packs load
// FIRST and only then is the beacon written. Injected spies drive the ordering;
// the temp dir lives under os.tmpdir() and the real .conductor/ is never touched.
// ===========================================================================

test("8.2-missing-pack: loadPacks/initPlugin throw naming the missing pack, log the error, and never write the beacon", () => {
  const realPacks = loadRealPacks();
  const OMITTED = "skeptic.md";

  // A doctrine dir carrying 8 of the 9 packs (skeptic.md omitted).
  const missingDir = mkdtempSync(path.join(tmpdir(), "conductor-inject-doctrine-missing-"));
  // A complete doctrine dir carrying all 9 packs (the happy-path ordering check).
  const completeDir = mkdtempSync(path.join(tmpdir(), "conductor-inject-doctrine-complete-"));
  try {
    for (const f of PACK_FILES) {
      writeFileSync(path.join(completeDir, f), realPacks[f]);
      if (f !== OMITTED) writeFileSync(path.join(missingDir, f), realPacks[f]);
    }

    // --- the loader alone throws, NAMING the missing pack ---
    assert.throws(
      () => loadPacks(missingDir),
      new RegExp(OMITTED.replace(".", "\\.")),
      "loadPacks throws an error naming the missing pack file",
    );

    // --- initPlugin: missing pack => throw + logError(naming pack) + NO beacon ---
    const missingLogs: string[] = [];
    let missingBeaconCount = 0;
    assert.throws(
      () =>
        initPlugin({
          doctrineDir: missingDir,
          logError: (msg: string) => {
            missingLogs.push(msg);
          },
          writeBeacon: () => {
            missingBeaconCount += 1;
          },
        }),
      new RegExp(OMITTED.replace(".", "\\.")),
      "initPlugin re-throws the missing-pack error",
    );
    assert.equal(missingLogs.length, 1, "initPlugin surfaced exactly one error via the logError seam");
    assert.ok(
      missingLogs[0].includes(OMITTED),
      "the logged error names the missing pack (§7.1 stderr sink, not a journal event)",
    );
    assert.equal(missingBeaconCount, 0, "the §3.8 beacon is NEVER written when a pack is missing (fail-closed)");

    // --- initPlugin: complete dir => packs load, THEN the beacon is written once ---
    const okLogs: string[] = [];
    let okBeaconCount = 0;
    const loaded = initPlugin({
      doctrineDir: completeDir,
      logError: (msg: string) => {
        okLogs.push(msg);
      },
      writeBeacon: () => {
        okBeaconCount += 1;
      },
    });
    assert.equal(okLogs.length, 0, "a complete doctrine dir logs no error");
    assert.equal(okBeaconCount, 1, "the beacon is written exactly once after the packs load");
    for (const f of PACK_FILES) {
      assert.equal(loaded[f], realPacks[f], `initPlugin returns the cached ${f} content`);
    }
  } finally {
    rmSync(missingDir, { recursive: true, force: true });
    rmSync(completeDir, { recursive: true, force: true });
  }
});

// ===========================================================================
// [8.2-null-recommendation] on a NULL recommendation the block must render the
// AUTHORITATIVE rationale legalTools returns — legalTools(...).why — verbatim,
// NOT a hardcoded terminality claim. legalTools returns recommended===null in
// non-terminal states too (a stalled wave), so a hardcoded "the run is terminal"
// asserts a false claim mid-run. Both scenarios derive the expectation from
// legalTools; neither hardcodes the wording independently.
// ===========================================================================

test("8.2-null-recommendation: a null recommendation renders legalTools(...).why verbatim, never a hardcoded terminality claim", () => {
  // (A) STALLED but NON-TERMINAL: I1 waits on the (blocked) I2, so nothing is
  // schedulable and no report is due — recommended is null in a LIVE run.
  const rStalled = run({ state: "EXECUTING", classification: { kind: "work" } });
  const stalledItems = [
    item({ id: "I1", state: "PENDING", behavioral: true, dependsOn: ["I2"], fileScope: ["src/a.ts"] }),
    item({ id: "I2", state: "PENDING", behavioral: true, blocked: { reason: "x" }, fileScope: ["src/b.ts"] }),
  ];
  const vStalled = legalTools(rStalled, stalledItems, [], true);
  assert.equal(vStalled.recommended, null, "the stalled non-terminal wave really has no recommendation (triggers the bug)");

  const stalledBlock = stateBlockOf(buildSystemAppend(ORCH, rStalled, stalledItems, [], PACKS, ctx()));
  assert.ok(
    stalledBlock.includes(vStalled.why),
    "the block renders the authoritative stalled rationale (legalTools.why) verbatim",
  );
  assert.ok(
    !stalledBlock.toLowerCase().includes("terminal"),
    "a non-terminal EXECUTING run is NEVER labeled terminal (legalTools.why carries no 'terminal' here)",
  );

  // (B) GENUINELY TERMINAL: a REPORTED run — recommended is null AND the
  // authoritative rationale DOES open with "Terminal run:". The fix must RENDER
  // legalTools.why (which here says so), not delete the wording.
  const rTerminal = run({ state: "REPORTED" });
  const vTerminal = legalTools(rTerminal, [], [], true);
  assert.equal(vTerminal.recommended, null, "a terminal run has no recommendation");
  assert.ok(vTerminal.why.startsWith("Terminal run:"), "legalTools' terminal rationale opens with 'Terminal run:'");

  const terminalBlock = stateBlockOf(buildSystemAppend(ORCH, rTerminal, [], [], PACKS, ctx()));
  assert.ok(
    terminalBlock.includes(vTerminal.why),
    "the block renders the authoritative terminal rationale (legalTools.why) verbatim",
  );
});

// ===========================================================================
// [8.2-empty-pack] a present-but-EMPTY (or whitespace-only) pack file is
// effectively-absent doctrine: loadPacks must reject it (naming the pack) rather
// than caching "", and initPlugin must therefore fail-closed — logError once and
// NEVER write the §3.8 beacon. Temp dir under os.tmpdir(); real .conductor/
// untouched; cleaned up in a finally.
// ===========================================================================

test("8.2-empty-pack: a present-but-empty pack is rejected — loadPacks/initPlugin throw naming it and never write the beacon", () => {
  const realPacks = loadRealPacks();
  const EMPTY = "tdd.md";

  const dir = mkdtempSync(path.join(tmpdir(), "conductor-inject-doctrine-empty-"));
  try {
    // All nine packs present, but tdd.md is whitespace-only (effectively absent).
    for (const f of PACK_FILES) {
      writeFileSync(path.join(dir, f), f === EMPTY ? "   \n\t  \n" : realPacks[f]);
    }

    // --- the loader alone rejects the empty pack, NAMING it ---
    assert.throws(
      () => loadPacks(dir),
      new RegExp(EMPTY.replace(".", "\\.")),
      "loadPacks throws an error naming the present-but-empty pack file",
    );

    // --- initPlugin: empty pack => throw + logError(naming pack) + NO beacon ---
    const logs: string[] = [];
    let beaconCount = 0;
    assert.throws(
      () =>
        initPlugin({
          doctrineDir: dir,
          logError: (msg: string) => {
            logs.push(msg);
          },
          writeBeacon: () => {
            beaconCount += 1;
          },
        }),
      new RegExp(EMPTY.replace(".", "\\.")),
      "initPlugin re-throws the empty-pack error",
    );
    assert.equal(logs.length, 1, "initPlugin surfaced exactly one error via the logError seam");
    assert.ok(logs[0].includes(EMPTY), "the logged error names the empty pack");
    assert.equal(
      beaconCount,
      0,
      "the §3.8 beacon is NEVER written for effectively-absent (empty) doctrine (fail-closed)",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ===========================================================================
// [8.2-debug-pack] §4.1: the implementer pack is "tdd.md (+debug.md in DEBUG)".
// DEBUG posture is keyed on the ACTIVE ITEM's `debugging` flag: an implementer
// whose active item is debugging gets BOTH tdd.md (primary, append[0]) and
// debug.md (before the trailing state block); a non-debug implementer gets
// tdd.md only; and debug.md is the IMPLEMENTER's pack — no other role receives
// it from a debugging item. (GateItem.debugging is added next; under node --test
// type-stripping the fixture sets it now, so "append includes debug.md" is the red.)
// ===========================================================================

test("8.2-debug-pack: an implementer on a DEBUG-posture item gets tdd.md + debug.md; non-debug and non-implementer sessions do not", () => {
  // Implementer, active item in DEBUG posture -> BOTH packs.
  const debugItems = [
    item({ id: "I2", state: "GREEN", behavioral: true, fileScope: ["src/b.ts"], debugging: true }),
  ];
  const impl: SessionRegistryEntry = { role: "implementer", itemId: "I2" };
  const append = buildSystemAppend(impl, run({ state: "EXECUTING" }), debugItems, [], PACKS, ctx());

  assert.ok(append.includes(PACKS["tdd.md"]), "the implementer still gets tdd.md");
  assert.ok(append.includes(PACKS["debug.md"]), "a DEBUG-posture item's implementer ALSO gets debug.md");
  assert.equal(append[0], PACKS["tdd.md"], "tdd.md remains the primary pack (append[0])");
  assert.ok(
    append.indexOf(PACKS["debug.md"]) < append.length - 1,
    "debug.md precedes the trailing state block",
  );

  // Implementer, same shape WITHOUT debug posture -> tdd.md only.
  const plainItems = [
    item({ id: "I3", state: "GREEN", behavioral: true, fileScope: ["src/c.ts"] }),
  ];
  const plain = buildSystemAppend(
    { role: "implementer", itemId: "I3" },
    run({ state: "EXECUTING" }),
    plainItems,
    [],
    PACKS,
    ctx(),
  );
  assert.ok(plain.includes(PACKS["tdd.md"]), "a non-debug implementer gets tdd.md");
  assert.ok(!plain.includes(PACKS["debug.md"]), "a non-debug implementer does NOT get debug.md");

  // Guard: debug.md is the IMPLEMENTER's DEBUG pack — a non-implementer session on
  // a debugging active item still receives no debug.md.
  const orchAppend = buildSystemAppend(ORCH, run({ state: "EXECUTING" }), debugItems, [], PACKS, ctx());
  assert.ok(
    !orchAppend.includes(PACKS["debug.md"]),
    "a non-implementer (orchestrator) session never receives debug.md",
  );
});
