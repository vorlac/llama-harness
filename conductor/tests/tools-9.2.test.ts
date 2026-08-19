// Task 9.2 RED tests — FINAL LOCATION conductor/tests/tools-9.2.test.ts.
//
// SUBJECT (must NOT exist when this goes red): the TWO Phase-9 planning-stage
// handlers added to the EXISTING conductor/adapter/tools.ts (which today carries the
// §5.3 gate wiring + the SIX Task-9.1 handlers). The red is the missing-export shape —
// tools.ts resolves, but the named bindings below do not yet exist:
//   handleDecompose, handlePlan
//
// Each handler follows the §3.4 invariant loop — legality → derive → persist → journal
// → compact return — and (with the state store it delegates to) is the ONLY writer of
// run/item state (G6). The two ledgers/artifacts this task exercises live at the run
// dir: queue.json (the decomposed queue) and decisions.jsonl (plan's ≥2-option forks),
// plus plan.md (the plan document). Both handlers dispatch the `planner` role through the
// injected Fanout (adapter/fanout.ts) driving the FAKE SDK (tests/fixtures/fake-sdk.ts).
//
// Spec read (docs/plans/2026-08-07-conductor-harness-plan.md):
//   §9 Task 9.2 (2584-2594)  — the authoritative behaviour of the two tools.
//   §3.2 (1096-1117)         — the DECOMPOSED validation TABLE (DAG acyclicity; non-empty
//                              fileScope; non-empty testScope IFF behavioral; behavioral:false
//                              ⇒ fileScope ∩ behavioralPaths = ∅; ponytail rung + reuse note
//                              under full; item size > ~5 files ⇒ one bounded re-split, then
//                              rejection) and the PLANNED behaviour (plan.md doctrine — no
//                              placeholders — plus ≥2-option decisions recorded via the handler).
//   §2.4 (713-756)           — the queue item + the DAG dependsOn rule + the disjoint
//                              behavioralPaths guard + the ponytail block.
//   §6.3 (1880-1890)         — full mode REJECTS a `minimal-code` rung with an empty reuse note.
//   §2.7 (854-874)           — the decision record + the ≥2-scored-options rule for kind:derived.
//   docs/build/specs/task-9.2.assertions.json — the 9 rows mapped to the tests below.
//
// ---------------------------------------------------------------------------
// PINNED HANDLER SURFACE the implementer must target (adapter/tools.ts). Each input is a
// single options object; runDir is derived by every handler as
// <store.root>/.conductor/runs/<runId>/. `journal` is the leveled sink (adapter/journal.ts
// Journal-compatible); `now` defaults to Date.now.
//
//   // conductor_decompose (§3.2) — dispatch the `planner` role (schema "Queue") through the
//   // injected Fanout; validate the returned queue against the §3.2 table; on ANY validation
//   // failure RE-PROMPT the planner with the concrete reason (BOUNDED — the fake returns a bad
//   // queue then a good one); on the accepted acyclic queue persist queue.json + create the
//   // §2.5 PENDING items and advance INTAKE→DECOMPOSED. A queue that STILL fails after the
//   // bounded re-prompt is REJECTED — handleDecompose REJECTS (its Promise throws), naming the
//   // reason (for the disjoint-path guard: the intersecting glob); NOTHING is persisted and the
//   // run is left in INTAKE.
//   handleDecompose(input: {
//     store: StateStore; fanout: Fanout; runId: string; config: Config;
//     journal: JournalSink; now?: () => number;
//   }): Promise<{ itemIds: string[]; runState: RunState }>
//
//   // conductor_plan (§3.2) — dispatch the `planner` role (schema "Plan") through the Fanout;
//   // write plan.md at the run dir; extract the plan's ≥2-option decisions into decisions.jsonl
//   // (minting the §2.7 D- id + tsIso per record, REJECTING a kind:derived proposal carrying <2
//   // scored options via core requireTwoOptions — legality BEFORE persist, exactly like
//   // conductor_decide); reject placeholder strings in the plan output ("TBD" / "add error
//   // handling" / "similar to task N", plan.md doctrine) with ONE BOUNDED re-prompt (the fake
//   // returns a placeholder-laden plan then a clean one); advance DECOMPOSED→PLANNED.
//   handlePlan(input: {
//     store: StateStore; fanout: Fanout; runId: string; config: Config;
//     journal: JournalSink; now?: () => number;
//   }): Promise<{ planPath: string; decisionIds: string[]; runState: RunState }>
//
// PINNED "Plan" schema (the implementer MUST register SCHEMAS.Plan in tools.ts with THIS
// subset-legal shape; the planner returns the plan document plus the ≥2-option forks as
// decision PROPOSALS — no id/tsIso, which the handler mints):
//   Plan = {
//     markdown: string,
//     decisions: Array<{
//       question: string,
//       options: Array<{ name: string, score?: {capability,testability,movingParts,
//                                                validationEarliness,singleSource: number} }>,
//       choice: string, why: string, kind: "derived" | "human", appliedWhere: string
//     }>
//   }
// ---------------------------------------------------------------------------
//
// Assertion id → test (each test name carries its id):
//   9.2-decompose-dag                     → valid acyclic queue accepted + persisted + items
//                                           PENDING + DECOMPOSED; a dependsOn cycle rejected then
//                                           fixed on a bounded re-prompt.
//   9.2-decompose-size                    → an oversized item rejected with one bounded re-split
//                                           re-prompt, then a validly-sized decomposition accepted.
//   9.2-decompose-behavioral-false-reject → behavioral:false ∩ behavioralPaths rejected, naming
//                                           the intersecting glob.
//   9.2-decompose-behavioral-false-docs-ok→ the same item docs-only (disjoint) accepted with an
//                                           empty testScope.
//   9.2-decompose-behavioral-testscope    → a behavioral:true item with an empty testScope rejected.
//   9.2-decompose-ponytail                → full mode rejects a minimal-code rung + empty reuse note.
//   9.2-plan-writes                       → plan.md written + DECOMPOSED→PLANNED + journals.
//   9.2-plan-decisions                    → ≥2-option decisions extracted + minted; a <2-scored
//                                           kind:derived proposal rejected (requireTwoOptions).
//   9.2-plan-placeholder                  → a placeholder-laden plan rejected with one bounded
//                                           re-prompt, then a clean plan accepted.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// The SUBJECTS — absent at red time (missing-export red from the existing tools.ts).
import { handleDecompose, handlePlan } from "../adapter/tools.ts";

// Adapters + core that DO exist (Tasks 4.1 / 7.1 / 1.1).
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, TreeState } from "../adapter/fanout.ts";
import { SCHEMAS, validate } from "../core/types.ts";
import type { Config, DecisionRecord, Item, Queue, QueueItem, TreePath } from "../core/types.ts";
import { acceptanceClusters, scanPlaceholders, vagueAcceptance, validateQueue } from "../core/planning.ts";

import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

// ---------------------------------------------------------------------------
// Fixtures + helpers (the same shape as tools-9.1.test.ts's harness).
// ---------------------------------------------------------------------------

// A fixed injected clock: the store reads OpenOptions.now for every stamped value.
const START_MS = 1_754_560_000_000;

// A leveled sink structurally compatible with adapter/journal.ts Journal (used for the
// store, the fan-out engine, and both handlers) — captures every record for the journal
// assertions. Deliberately loose (level:string, runId?) so it assigns to both the
// StateJournal (runId optional) and the Journal (runId required) parameter shapes.
interface CaptureRecord {
  level: string;
  component: string;
  event: string;
  data: Record<string, unknown>;
  corr: { runId?: string; itemId?: string; sessionID?: string };
}
interface JournalSink {
  log: (
    level: string,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: { runId?: string; itemId?: string; sessionID?: string },
  ) => void;
  flushSync: () => void;
}
function makeJournal(): { sink: JournalSink; records: CaptureRecord[] } {
  const records: CaptureRecord[] = [];
  const sink: JournalSink = {
    log(level, component, event, data, corr): void {
      records.push({ level, component, event, data, corr });
    },
    flushSync(): void {
      /* nothing buffered */
    },
  };
  return { sink, records };
}

// A never-frozen §3.5 tree view (decompose/plan run readers only, so this only admits).
const OPEN_TREE: TreeState = {
  isFrozen(): boolean {
    return false;
  },
  onClear(): () => void {
    return () => undefined;
  },
};

// A complete §2.1 Config; only behavioralPaths / trivialMaxFiles / ponytail / models.default
// matter to these tests, so they are parameterised and the rest are inert-but-valid defaults.
function makeConfig(
  opts: {
    trivialMaxFiles?: number;
    behavioralPaths?: string[];
    modelDefault?: string;
    ponytail?: Config["ponytail"];
  } = {},
): Config {
  return {
    version: 1,
    verify: {
      scopes: {},
      behavioralPaths: opts.behavioralPaths ?? [],
      requiredScopes: [],
    },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: opts.trivialMaxFiles ?? 5,
      planReviewers: 1,
      planReviewMaxRounds: 1,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: 1,
      vetMaxRounds: 1,
      testRepairAttempts: 1,
      debugFixCap: 3,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
    },
    parallel: { writes: "off", maxImplementers: 4, maxReaders: 4, subSessionTimeoutMs: 100_000 },
    models: { default: opts.modelDefault ?? "test-model", roles: {} },
    ponytail: opts.ponytail ?? "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

// Temp-dir bookkeeping: each test creates its own workspace and removes it in its own
// finally; this after() is the backstop that guarantees nothing survives the run.
const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});
function scratchDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-tools92-"));
  tmpDirs.push(dir);
  return dir;
}

function openStore(root: string, journal: JournalSink, config: Config): StateStore {
  const opts: OpenOptions = {
    root,
    config,
    journal,
    version: "0.0.0-test",
    sessionID: "ses_orchestrator",
    now: () => START_MS,
    pid: process.pid,
    staleLockMs: 24 * 60 * 60 * 1000,
  };
  return openWorkspace(opts);
}

// Create a run at INTAKE with a schema-valid `work` classification (the state decompose
// legally advances from). Returns the run id.
function createIntakeRun(store: StateStore): string {
  const run = store.createRun({
    prompt: "do the thing",
    sessionID: "ses_orchestrator",
    classification: { kind: "work", rationale: "intake placeholder", check: { agreed: true, note: "" } },
  });
  return run.runId;
}

function runDirOf(store: StateStore, runId: string): string {
  return path.join(store.root, ".conductor", "runs", runId);
}

// Count persisted §2.5 item files under a run (0 when the run created no items).
function itemFileCount(store: StateStore, runId: string): number {
  const dir = path.join(runDirOf(store, runId), "items");
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((n) => n.endsWith(".json")).length;
}

// A schema-valid §2.4 queue item. The default is behavioral+testscoped+minimal-code-with-
// reuse, i.e. it PASSES every §3.2 check; each test overrides exactly the field it probes.
function makeQueueItem(id: string, over: Partial<QueueItem> = {}): QueueItem {
  const base: QueueItem = {
    id,
    title: "parse and validate the config",
    rationale: "the loader must reject malformed config early",
    fileScope: ["src/config.ts"],
    testScope: ["tests/config.test.ts"],
    acceptance: ["config.load rejects an unknown key with a named error"],
    behavioral: true,
    dependsOn: [],
    ponytail: {
      necessary: "config validation is required by the loader",
      reuse: "checked src/util.ts; nothing there validates config",
      ladderRung: "minimal-code",
    },
  };
  return { ...base, ...over };
}
function makeQueue(items: QueueItem[]): Queue {
  return { items };
}
// The prompt-shaped receipt the fake planner returns for a decompose dispatch.
function queueJson(items: QueueItem[]): string {
  return JSON.stringify(makeQueue(items));
}

// §2.7 ladder-5 scores for decision proposals.
const FULL_SCORE = { capability: 2, testability: 2, movingParts: 2, validationEarliness: 1, singleSource: 2 };
const LEAN_SCORE = { capability: 1, testability: 1, movingParts: 0, validationEarliness: 1, singleSource: 2 };

// A decision PROPOSAL as it rides inside a Plan receipt (no id/tsIso — the handler mints them).
interface DecisionProposal {
  question: string;
  options: Array<{ name: string; score?: typeof FULL_SCORE }>;
  choice: string;
  why: string;
  kind: "derived" | "human";
  appliedWhere: string;
}
function makeDecisionProposal(over: Partial<DecisionProposal> = {}): DecisionProposal {
  const base: DecisionProposal = {
    question: "HTTP client: cpp-httplib vs raw sockets?",
    options: [
      { name: "cpp-httplib", score: FULL_SCORE },
      { name: "raw sockets", score: LEAN_SCORE },
    ],
    choice: "cpp-httplib",
    why: "strict superset on the scored criteria; already a dependency",
    kind: "derived",
    appliedWhere: "src/router",
  };
  return { ...base, ...over };
}
// The prompt-shaped receipt the fake planner returns for a plan dispatch.
function planJson(markdown: string, decisions: DecisionProposal[]): string {
  return JSON.stringify({ markdown, decisions });
}

// A clean plan document — carries the "Plan" marker, free of the plan.md placeholder defects.
const CLEAN_PLAN_MD =
  "## Plan\n\n" +
  "### Item I1 — src/config.ts\n" +
  "- Test strategy: assert config.load('{}') returns an empty object and config.load of an unknown key throws a NamedError.\n" +
  "- Implementation: add a load(json) parser in src/config.ts that validates keys against a known set.\n" +
  "- Risks: none material; the parser is pure and fully covered by the item test.\n";
// A placeholder-laden plan document — every §3.2/plan.md defect phrase by name.
const PLACEHOLDER_PLAN_MD =
  "## Plan\n\n" +
  "### Item I1\n" +
  "- Test strategy: TODO: add error handling here.\n" +
  "- Implementation: similar to task 3; the exact interface is TBD.\n";

// Build a Fanout over the fake SDK that answers each NEW sub-session (each fanout.dispatch
// creates one) with the next canned reply, clamping to the last so a bad-forever reply
// stream drives the "still fails after the bounded re-prompt" path. Records every prompted
// role so a test can pin the `planner` dispatch (spec, not impl). Replies are schema-valid
// receipts, so the fan-out engine never internally retries — one prompt per dispatch, which
// is what the re-prompt-count assertions read.
function makePlannerFanout(
  runId: string,
  config: Config,
  journal: JournalSink,
  replies: string[],
): { fanout: Fanout; sdk: ReturnType<typeof makeFakeSdk>; promptedRoles: string[] } {
  const registry = new Map<string, { role: string; itemId: string; tree: TreePath }>();
  const sdk = makeFakeSdk({ registry });
  const promptedRoles: string[] = [];
  const assigned = new Map<string, number>();
  let next = 0;
  sdk.setResponder((req) => {
    promptedRoles.push(req.entry?.role ?? "");
    let idx = assigned.get(req.sessionID);
    if (idx === undefined) {
      idx = next;
      next += 1;
      assigned.set(req.sessionID, idx);
    }
    const text = replies[Math.min(idx, replies.length - 1)];
    return { kind: "reply", text };
  });
  const fanout = createFanout(
    sdk.client,
    config,
    journal as unknown as Parameters<typeof createFanout>[2],
    registry,
    OPEN_TREE,
    runId,
  );
  return { fanout, sdk, promptedRoles };
}

// A schema-valid §2.5 runtime Item at PENDING (seeding the DECOMPOSED state for plan tests).
function makeRuntimeItem(id: string): Item {
  return {
    id,
    state: "PENDING",
    assignee: null,
    worktree: null,
    attempts: { green: 0, reviewRounds: 0, vetRounds: 0, testRepairs: 0, debugFixes: 0, overridesUsed: 0 },
    blocked: null,
    deferred: null,
    debugging: null,
    evidence: {},
    taint: [],
    inlineClaim: null,
  };
}

// Drive a run to the DECOMPOSED state WITHOUT depending on handleDecompose (so the plan
// tests fail only on plan bugs): flip run.state, write a valid queue.json, seed one PENDING
// item — the on-disk shape a green decompose would have left.
function seedDecomposed(store: StateStore, runId: string): void {
  const run = store.loadRun(runId);
  run.state = "DECOMPOSED";
  store.saveRun(run);
  writeFileSync(
    path.join(runDirOf(store, runId), "queue.json"),
    JSON.stringify(makeQueue([makeQueueItem("I1")]), null, 2),
  );
  store.saveItem(runId, makeRuntimeItem("I1"));
}

// Read decisions.jsonl (§2.7 ledger) as records; a missing file is an empty ledger.
function readDecisions(runDir: string): DecisionRecord[] {
  const p = path.join(runDir, "decisions.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as DecisionRecord);
}

// await a rejection and hand back the Error so the caller can assert on the reason.
async function expectReject(fn: () => Promise<unknown>, ctx: string): Promise<Error> {
  let caught: unknown;
  let threw = false;
  try {
    await fn();
  } catch (e) {
    threw = true;
    caught = e;
  }
  assert.ok(threw, `${ctx}: expected a rejection`);
  assert.ok(caught instanceof Error, `${ctx}: the rejection must be an Error`);
  assert.ok((caught as Error).message.length > 0, `${ctx}: the thrown reason must be non-empty`);
  return caught as Error;
}

// ---------------------------------------------------------------------------
// Fixture sanity: the queue fixtures satisfy the §2.4 schema, and — crucially — a
// behavioral:false / empty-testScope item is SCHEMA-valid, proving the §3.2 rejections
// below are HANDLER-level checks, not schema failures. (Same discipline as 9.1's probe block.)
// ---------------------------------------------------------------------------
assert.equal(
  validate("Queue", makeQueue([makeQueueItem("I1")])).ok,
  true,
  "sanity: the default QueueItem fixture satisfies SCHEMAS.Queue",
);
assert.equal(
  validate("Queue", makeQueue([makeQueueItem("I1", { behavioral: false, fileScope: ["docs/x.md"], testScope: [] })])).ok,
  true,
  "sanity: a behavioral:false empty-testScope item is schema-valid (the guard is handler-level)",
);
assert.equal(
  validate("Queue", makeQueue([makeQueueItem("I1", { ponytail: { necessary: "x", reuse: "", ladderRung: "minimal-code" } })])).ok,
  true,
  "sanity: a minimal-code/empty-reuse item is schema-valid (the ponytail guard is handler-level)",
);

// ===========================================================================
// [9.2-decompose-dag]
// ===========================================================================

test("[9.2-decompose-dag] a valid acyclic queue is accepted + persisted + items created PENDING + INTAKE→DECOMPOSED; a dependsOn cycle is rejected then fixed on a bounded re-prompt", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ behavioralPaths: [] });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);

    // --- Part A: a valid acyclic queue is accepted on the FIRST try ------------------
    const runId = createIntakeRun(store);
    const good = queueJson([
      makeQueueItem("I1", { fileScope: ["src/a.ts"], testScope: ["tests/a.test.ts"], dependsOn: [] }),
      makeQueueItem("I2", { fileScope: ["src/b.ts"], testScope: ["tests/b.test.ts"], dependsOn: ["I1"] }),
    ]);
    const w1 = makePlannerFanout(runId, config, journal.sink, [good]);
    const res = await handleDecompose({ store, fanout: w1.fanout, runId, config, journal: journal.sink });

    assert.equal(res.runState, "DECOMPOSED", "a valid decomposition advances INTAKE→DECOMPOSED");
    assert.deepEqual([...res.itemIds].sort(), ["I1", "I2"], "the result names every created item id");
    assert.equal(w1.sdk.prompts.length, 1, "a first-try-valid queue needs no re-prompt");
    assert.ok(w1.promptedRoles.length > 0 && w1.promptedRoles.every((r) => r === "planner"), "decompose dispatches the planner role (spec, not impl)");
    assert.ok(
      w1.sdk.prompts.every((p) => p.hasFormatField === false),
      "structured output is prompt-shaped + independently validated (no native `format` field — Task 0.2 DRIFT)",
    );

    const queuePath = path.join(runDirOf(store, runId), "queue.json");
    assert.ok(existsSync(queuePath), "decompose persists queue.json at the run dir");
    const persisted = JSON.parse(readFileSync(queuePath, "utf8")) as Queue;
    assert.equal(validate("Queue", persisted).ok, true, "the persisted queue validates against the §2.4 schema");
    assert.equal(persisted.items.length, 2, "the persisted queue carries both items");

    for (const id of ["I1", "I2"]) {
      const item = store.loadItem(runId, id);
      assert.equal(validate("Item", item).ok, true, `${id} validates against the §2.5 item schema`);
      assert.equal(item.state, "PENDING", `${id} is created at the head of the item FSM (PENDING)`);
      assert.equal(item.blocked, null, `${id} starts unblocked`);
      assert.equal(item.deferred, null, `${id} starts undeferred`);
    }
    assert.equal(store.loadRun(runId).state, "DECOMPOSED", "the persisted run is DECOMPOSED");
    assert.ok(
      journal.records.some((r) => JSON.stringify(r).includes("DECOMPOSED")),
      "the INTAKE→DECOMPOSED transition is journaled",
    );

    // --- Part B: a dependsOn cycle is rejected, then fixed on a bounded re-prompt -----
    const runId2 = createIntakeRun(store);
    const cyclic = queueJson([
      makeQueueItem("I1", { fileScope: ["src/a.ts"], testScope: ["tests/a.test.ts"], dependsOn: ["I2"] }),
      makeQueueItem("I2", { fileScope: ["src/b.ts"], testScope: ["tests/b.test.ts"], dependsOn: ["I1"] }),
    ]);
    const fixed = queueJson([
      makeQueueItem("I1", { fileScope: ["src/a.ts"], testScope: ["tests/a.test.ts"], dependsOn: [] }),
      makeQueueItem("I2", { fileScope: ["src/b.ts"], testScope: ["tests/b.test.ts"], dependsOn: ["I1"] }),
    ]);
    const w2 = makePlannerFanout(runId2, config, journal.sink, [cyclic, fixed]);
    const res2 = await handleDecompose({ store, fanout: w2.fanout, runId: runId2, config, journal: journal.sink });

    assert.equal(w2.sdk.prompts.length, 2, "the cycle triggers exactly one bounded re-prompt (two planner prompts)");
    assert.ok(/cycl|acyclic|\bdag\b|depend/i.test(w2.sdk.prompts[1].text), "the re-prompt names the DAG/cycle reason");
    assert.equal(res2.runState, "DECOMPOSED", "the fixed acyclic queue is accepted → DECOMPOSED");
    assert.deepEqual([...res2.itemIds].sort(), ["I1", "I2"], "the accepted (fixed) queue's items are created");
    const persisted2 = JSON.parse(readFileSync(path.join(runDirOf(store, runId2), "queue.json"), "utf8")) as Queue;
    const p2i1 = persisted2.items.find((x) => x.id === "I1");
    assert.deepEqual(p2i1?.dependsOn, [], "the persisted queue is the FIXED (acyclic) reply, not the cyclic first one");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.2-decompose-size]
// ===========================================================================

test("[9.2-decompose-size] an oversized item is rejected with one bounded re-split re-prompt, then a validly-sized decomposition is accepted", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ trivialMaxFiles: 5, behavioralPaths: [] });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);

    // 12 files — unambiguously past any "~5 files" size budget (§3.2's table row).
    const oversized = queueJson([
      makeQueueItem("I1", {
        fileScope: [
          "src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts", "src/f.ts",
          "src/g.ts", "src/h.ts", "src/i.ts", "src/j.ts", "src/k.ts", "src/l.ts",
        ],
        testScope: ["tests/a.test.ts"],
        dependsOn: [],
      }),
    ]);
    const resplit = queueJson([
      makeQueueItem("I1", { fileScope: ["src/a.ts"], testScope: ["tests/a.test.ts"], dependsOn: [] }),
      makeQueueItem("I2", { fileScope: ["src/b.ts"], testScope: ["tests/b.test.ts"], dependsOn: ["I1"] }),
    ]);
    const w = makePlannerFanout(runId, config, journal.sink, [oversized, resplit]);
    const res = await handleDecompose({ store, fanout: w.fanout, runId, config, journal: journal.sink });

    assert.equal(w.sdk.prompts.length, 2, "the oversized item triggers exactly one bounded re-split re-prompt");
    assert.ok(/siz|split|file|too (?:big|large|many)/i.test(w.sdk.prompts[1].text), "the re-prompt names the size/split reason");
    assert.equal(res.runState, "DECOMPOSED", "the re-split (validly-sized) decomposition is accepted → DECOMPOSED");
    assert.deepEqual([...res.itemIds].sort(), ["I1", "I2"], "the accepted re-split creates both smaller items");
    assert.ok(existsSync(path.join(runDirOf(store, runId), "queue.json")), "the accepted queue is persisted");
    assert.equal(store.loadItem(runId, "I2").state, "PENDING", "the re-split's new item is created PENDING");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.2-decompose-behavioral-false-reject]
// ===========================================================================

test("[9.2-decompose-behavioral-false-reject] a behavioral:false item whose fileScope intersects behavioralPaths is rejected, and the rejection names the intersecting glob", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ behavioralPaths: ["lib/runtime/**"] });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);

    // behavioral:false CLAIMS untestability while editing production code UNDER behavioralPaths
    // — the §2.4 disjoint-path guard forbids it. Returned on every attempt (bad-forever), so the
    // decomposition is rejected whether or not the handler re-prompts first.
    const bad = queueJson([
      makeQueueItem("I1", { behavioral: false, fileScope: ["lib/runtime/widget.ts"], testScope: [] }),
    ]);
    const w = makePlannerFanout(runId, config, journal.sink, [bad]);

    const err = await expectReject(
      () => handleDecompose({ store, fanout: w.fanout, runId, config, journal: journal.sink }),
      "behavioral:false ∩ behavioralPaths",
    );
    assert.ok(/lib\/runtime/.test(err.message), "the rejection NAMES the intersecting glob");
    assert.ok(!existsSync(path.join(runDirOf(store, runId), "queue.json")), "a rejected decomposition writes no queue.json");
    assert.equal(store.loadRun(runId).state, "INTAKE", "a rejected decomposition leaves the run in INTAKE");
    assert.equal(itemFileCount(store, runId), 0, "a rejected decomposition creates no items");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.2-decompose-behavioral-false-docs-ok]
// ===========================================================================

test("[9.2-decompose-behavioral-false-docs-ok] the same behavioral:false item with a docs-only fileScope (disjoint from behavioralPaths) is accepted and may carry an empty testScope", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ behavioralPaths: ["lib/runtime/**"] });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);

    // docs-only fileScope is DISJOINT from behavioralPaths, so behavioral:false is legal and the
    // empty testScope is permitted (§2.4: testScope MAY be empty iff behavioral is false).
    const good = queueJson([
      makeQueueItem("I1", {
        behavioral: false,
        fileScope: ["docs/guide.md"],
        testScope: [],
        ponytail: { necessary: "the guide documents the new loader", reuse: "checked docs/index.md; no loader guide exists", ladderRung: "one-liner" },
      }),
    ]);
    const w = makePlannerFanout(runId, config, journal.sink, [good]);
    const res = await handleDecompose({ store, fanout: w.fanout, runId, config, journal: journal.sink });

    assert.equal(res.runState, "DECOMPOSED", "a behavioral:false docs-only item is accepted → DECOMPOSED");
    assert.deepEqual(res.itemIds, ["I1"], "the docs-only item is created");
    const persisted = JSON.parse(readFileSync(path.join(runDirOf(store, runId), "queue.json"), "utf8")) as Queue;
    assert.equal(validate("Queue", persisted).ok, true, "the persisted queue validates against the §2.4 schema");
    assert.equal(persisted.items[0].behavioral, false, "the persisted item preserves behavioral:false");
    assert.deepEqual(persisted.items[0].testScope, [], "a behavioral:false item may carry an empty testScope");
    assert.equal(store.loadItem(runId, "I1").state, "PENDING", "the runtime item is created PENDING");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.2-decompose-behavioral-testscope]
// ===========================================================================

test("[9.2-decompose-behavioral-testscope] a behavioral:true item with an empty testScope is rejected", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ behavioralPaths: [] });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);

    // behavioral change with NO test paths — a behavioral item owes a test scope (§2.4). Bad-forever.
    const bad = queueJson([makeQueueItem("I1", { behavioral: true, fileScope: ["src/a.ts"], testScope: [] })]);
    const w = makePlannerFanout(runId, config, journal.sink, [bad]);

    const err = await expectReject(
      () => handleDecompose({ store, fanout: w.fanout, runId, config, journal: journal.sink }),
      "behavioral+empty-testScope",
    );
    assert.ok(/test\s*scope|test path/i.test(err.message), "the rejection names the missing test scope");
    assert.ok(!existsSync(path.join(runDirOf(store, runId), "queue.json")), "no queue.json is persisted");
    assert.equal(store.loadRun(runId).state, "INTAKE", "the run stays in INTAKE");
    assert.equal(itemFileCount(store, runId), 0, "no items are created");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.2-decompose-ponytail]
// ===========================================================================

test("[9.2-decompose-ponytail] ponytail full mode rejects an item whose ladderRung is minimal-code with an empty reuse note", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ behavioralPaths: [], ponytail: "full" });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);

    // full mode: a minimal-code rung with an EMPTY reuse note is rejected (§6.3: you must show
    // you looked before writing new code). Every other field is valid, so this is the sole defect.
    const bad = queueJson([
      makeQueueItem("I1", { ponytail: { necessary: "the loader needs it", reuse: "", ladderRung: "minimal-code" } }),
    ]);
    const w = makePlannerFanout(runId, config, journal.sink, [bad]);

    const err = await expectReject(
      () => handleDecompose({ store, fanout: w.fanout, runId, config, journal: journal.sink }),
      "ponytail full: minimal-code + empty reuse",
    );
    assert.ok(/reuse|minimal-code|ponytail|looked/i.test(err.message), "the rejection names the ponytail reuse-evidence rule");
    assert.ok(!existsSync(path.join(runDirOf(store, runId), "queue.json")), "no queue.json is persisted");
    assert.equal(store.loadRun(runId).state, "INTAKE", "the run stays in INTAKE");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.2-plan-writes]
// ===========================================================================

test("[9.2-plan-writes] conductor_plan writes plan.md at the run dir, advances DECOMPOSED→PLANNED, and journals", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ behavioralPaths: [] });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    seedDecomposed(store, runId);

    const reply = planJson(CLEAN_PLAN_MD, []);
    const w = makePlannerFanout(runId, config, journal.sink, [reply]);
    const res = await handlePlan({ store, fanout: w.fanout, runId, config, journal: journal.sink, now: () => START_MS });

    assert.equal(res.runState, "PLANNED", "conductor_plan advances DECOMPOSED→PLANNED");
    assert.ok(res.planPath.endsWith("plan.md"), "the result names plan.md");
    assert.ok(existsSync(res.planPath), "plan.md exists at the returned path");

    const planPath = path.join(runDirOf(store, runId), "plan.md");
    assert.ok(existsSync(planPath), "plan.md is written at the run dir");
    const written = readFileSync(planPath, "utf8");
    assert.ok(written.length > 0, "plan.md is non-empty");
    assert.ok(written.includes("Plan"), "plan.md carries the planner's markdown");

    assert.ok(w.promptedRoles.length > 0 && w.promptedRoles.every((r) => r === "planner"), "plan dispatches the planner role (spec, not impl)");
    assert.equal(store.loadRun(runId).state, "PLANNED", "the persisted run is PLANNED");
    assert.ok(
      journal.records.some((r) => JSON.stringify(r).includes("PLANNED")),
      "the DECOMPOSED→PLANNED transition is journaled",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.2-plan-decisions]
// ===========================================================================

test("[9.2-plan-decisions] conductor_plan extracts ≥2-option decisions into decisions.jsonl; a kind:derived decision with <2 scored options is rejected (requireTwoOptions)", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ behavioralPaths: [] });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);

    // --- Part A: valid ≥2-option decisions are extracted, minted, and persisted --------
    const runId = createIntakeRun(store);
    seedDecomposed(store, runId);
    const d1 = makeDecisionProposal({ question: "HTTP client: cpp-httplib vs raw sockets?", appliedWhere: "src/router" });
    const d2 = makeDecisionProposal({ question: "JSON parser: stdlib vs vendored?", choice: "stdlib", appliedWhere: "src/parse" });
    const wA = makePlannerFanout(runId, config, journal.sink, [planJson(CLEAN_PLAN_MD, [d1, d2])]);
    const resA = await handlePlan({ store, fanout: wA.fanout, runId, config, journal: journal.sink, now: () => START_MS });

    assert.equal(resA.runState, "PLANNED", "a plan carrying valid decisions still reaches PLANNED");
    const ledger = readDecisions(runDirOf(store, runId));
    assert.equal(ledger.length, 2, "both ≥2-option decisions are extracted into decisions.jsonl");
    assert.deepEqual([...resA.decisionIds].sort(), ledger.map((r) => r.id).sort(), "the returned decisionIds match the persisted records");
    for (const rec of ledger) {
      assert.equal(validate("DecisionRecord", rec).ok, true, "each extracted decision validates against the §2.7 schema");
      assert.match(rec.id, /^D-/, "each decision id is minted in the §2.7 D- namespace");
      assert.ok(rec.tsIso.length > 0, "each extracted decision is timestamped by the handler");
      assert.equal(rec.kind, "derived", "the extracted decisions preserve kind:derived");
      assert.ok(rec.options.length >= 2 && rec.options.every((o) => o.score !== undefined), "each derived decision carries ≥2 scored options");
    }

    // --- Part B: a kind:derived decision with <2 scored options is rejected -------------
    const runId2 = createIntakeRun(store);
    seedDecomposed(store, runId2);
    const oneOption = makeDecisionProposal({ options: [{ name: "cpp-httplib", score: FULL_SCORE }] });
    const wB = makePlannerFanout(runId2, config, journal.sink, [planJson(CLEAN_PLAN_MD, [oneOption])]);

    const err = await expectReject(
      () => handlePlan({ store, fanout: wB.fanout, runId: runId2, config, journal: journal.sink, now: () => START_MS }),
      "plan <2-option derived decision",
    );
    assert.match(err.message, /2|two|option/i, "the rejection names the ≥2-scored-options rule");
    assert.equal(readDecisions(runDirOf(store, runId2)).length, 0, "a rejected plan writes NO decision line (legality precedes persist)");
    assert.ok(!existsSync(path.join(runDirOf(store, runId2), "plan.md")), "a rejected plan writes no plan.md (legality precedes persist)");
    assert.equal(store.loadRun(runId2).state, "DECOMPOSED", "a rejected plan leaves the run in DECOMPOSED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.2-plan-placeholder]
// ===========================================================================

test("[9.2-plan-placeholder] a placeholder-laden plan output is rejected with one bounded re-prompt, then a clean plan is accepted", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ behavioralPaths: [] });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    seedDecomposed(store, runId);

    const w = makePlannerFanout(runId, config, journal.sink, [
      planJson(PLACEHOLDER_PLAN_MD, []),
      planJson(CLEAN_PLAN_MD, []),
    ]);
    const res = await handlePlan({ store, fanout: w.fanout, runId, config, journal: journal.sink, now: () => START_MS });

    assert.equal(w.sdk.prompts.length, 2, "the placeholder-laden plan triggers exactly one bounded re-prompt");
    assert.ok(
      /placeholder|\bTBD\b|\bTODO\b|add error handling|similar to task/i.test(w.sdk.prompts[1].text),
      "the re-prompt names the placeholder defect",
    );
    assert.equal(res.runState, "PLANNED", "the clean re-prompted plan is accepted → PLANNED");

    const written = readFileSync(path.join(runDirOf(store, runId), "plan.md"), "utf8");
    assert.ok(written.includes("Plan"), "plan.md carries the clean planner markdown");
    assert.ok(
      !/\bTBD\b|\bTODO\b|add error handling|similar to task/i.test(written),
      "the persisted plan.md is the CLEAN reply, free of the placeholder defects",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// REVIEW-FIX TESTS (R1-R14). The 3-lens adversarial panel over the 9.2 diff
// returned 19 surviving findings (2 MAJOR). Each test below pins ONE fix and
// was observed RED against the pre-fix implementation. Findings whose skeptic
// panel under-delivered (the session limit killed both refuters) are counted as
// UPHELD here, per the plan's own under-delivered-panel rule.
// ===========================================================================

// --- R1 [F1/I1 MAJOR] the item file budget is its OWN number, not the trivial
// ceiling. §2.1 ships trivialMaxFiles:2 (the TRIVIAL-classification ceiling)
// while §3.2's size row says "~5 files"; wiring the row to trivialMaxFiles
// rejected every 3+-file item under the DEFAULT config and made the trivial
// knob silently retune decompose.
test("[9.2-fix-size-budget] the §3.2 item size budget is independent of workflow.trivialMaxFiles", () => {
  const config = makeConfig({ trivialMaxFiles: 2 });
  const threeFiles = makeQueueItem("I1", {
    fileScope: ["src/a.ts", "src/b.ts", "src/c.ts"],
    testScope: ["tests/a.test.ts"],
  });
  const sized = validateQueue(makeQueue([threeFiles]), config);
  assert.equal(
    sized.violations.some((v) => /too large|budget|split/i.test(v)),
    false,
    "a 3-file item is within the ~5-file §3.2 budget even when trivialMaxFiles is 2",
  );
  assert.equal(sized.ok, true, "the 3-file decomposition is accepted under the default trivial ceiling");

  const sixFiles = makeQueueItem("I1", {
    fileScope: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts", "src/f.ts"],
    testScope: ["tests/a.test.ts"],
  });
  const over = validateQueue(makeQueue([sixFiles]), config);
  assert.equal(over.ok, false, "a 6-file item is over the ~5-file §3.2 budget");
  assert.ok(
    over.violations.some((v) => /too large|budget|split/i.test(v)),
    "the oversize rejection names the size defect",
  );
});

// --- R2 [F2/I3/E4 MAJOR] acceptance clusters must survive ordinary English.
// The raw leading token made every "the …" criterion collapse to the subject
// "the" (under-reject) and split one subject phrased with/without an article
// into two clusters (over-reject, with the nonsense reason "spans 2 clusters
// (parser, the)").
test("[9.2-fix-acceptance-clusters] cluster subjects ignore leading determiners in both directions", () => {
  assert.equal(
    acceptanceClusters(["the parser rejects an unknown key", "the router retries on 502"]).length,
    2,
    "two different subjects behind articles are TWO clusters (the two-things smell the row targets)",
  );
  assert.equal(
    acceptanceClusters(["parser rejects empty input", "the parser preserves key order"]).length,
    1,
    "one subject phrased with and without an article is ONE cluster",
  );
});

// --- R3 [F3/E11] "make it <observable outcome>" is a check, not a wish. The
// row's exemplar is the quality wish "make it better".
test("[9.2-fix-make-it] vagueAcceptance rejects the quality wish but keeps observable 'make it' criteria", () => {
  assert.equal(
    vagueAcceptance("make it return 404 on a missing id"),
    null,
    "a 'make it <concrete outcome>' criterion is an observable check",
  );
  assert.notEqual(vagueAcceptance("make it better"), null, "the 'make it better' quality wish is still rejected");
});

// --- R4 [F4/E6] the placeholder scan may not condemn a plan for legitimately
// DISCUSSING placeholders/TODOs, nor for an elided line inside a fenced code
// block (idiomatic in Python stubs / YAML).
test("[9.2-fix-placeholder-scan] the placeholder scan targets defect SHAPES, not innocent content", () => {
  assert.deepEqual(
    scanPlaceholders("## Plan\n- Add an input whose placeholder attribute reads 'name'.\n"),
    [],
    "a plan legitimately describing an HTML placeholder attribute is clean",
  );
  assert.deepEqual(
    scanPlaceholders("## Plan\n- Remove the TODO comments left in src/x.ts.\n"),
    [],
    "a plan whose WORK is removing TODO comments is clean",
  );
  assert.deepEqual(
    scanPlaceholders("## Plan\n- Implement the stub:\n\n```python\ndef f():\n    ...\n```\n"),
    [],
    "an elided line INSIDE a fenced code block is idiomatic, not an elision defect",
  );
  assert.notEqual(
    scanPlaceholders("## Plan\n- Implementation: TODO: write the parser.\n").length,
    0,
    "a comment-marker-shaped TODO: is still a plan defect",
  );
  assert.notEqual(
    scanPlaceholders("## Plan\n- The exact interface is TBD.\n").length,
    0,
    "TBD is still a plan defect by name",
  );
  assert.notEqual(
    scanPlaceholders("## Plan\n- Implementation:\n\n...\n\nthen wire it up.\n").length,
    0,
    "a bare elision line OUTSIDE a code fence is still a defect",
  );
});

// --- R5 [E2] duplicate ids must not make the cycle detector judge a DIFFERENT
// graph than the queue (last-writer-wins on the deps map hid a real cycle, so
// the single re-prompt omitted it and attempt 2 died for an unshown defect).
test("[9.2-fix-duplicate-id-cycle] a cycle routed through a duplicated id is still reported", () => {
  const config = makeConfig();
  const queue = makeQueue([
    makeQueueItem("I1", { dependsOn: ["I2"] }),
    makeQueueItem("I2", { dependsOn: ["I1"] }),
    makeQueueItem("I2", { dependsOn: [] }),
  ]);
  const result = validateQueue(queue, config);
  assert.equal(result.ok, false, "the queue is rejected");
  assert.ok(
    result.violations.some((v) => /duplicate item id/i.test(v)),
    "the duplicate id is named",
  );
  assert.ok(
    result.violations.some((v) => /cycle/i.test(v)),
    "the cycle hidden behind the duplicate id is ALSO named, in the same round",
  );
});

// --- R6 [E3] every cycle is reported in one round, so the single bounded
// re-prompt carries the complete defect list (validateQueue's own contract).
test("[9.2-fix-all-cycles] two disjoint cycles are both named in one round", () => {
  const config = makeConfig();
  const queue = makeQueue([
    makeQueueItem("I1", { dependsOn: ["I2"] }),
    makeQueueItem("I2", { dependsOn: ["I1"] }),
    makeQueueItem("I3", { dependsOn: ["I4"] }),
    makeQueueItem("I4", { dependsOn: ["I3"] }),
  ]);
  const joined = validateQueue(queue, config).violations.join(" | ");
  assert.ok(/I1/.test(joined) && /I2/.test(joined), "the first cycle is named");
  assert.ok(/I3/.test(joined) && /I4/.test(joined), "the SECOND disjoint cycle is named in the same round");
});

// --- R7 [E13] an empty-string id is not a graph node, so it can never produce
// the incoherent violation "dependsOn contains a cycle ( -> )".
test("[9.2-fix-empty-id] an empty item id is named as such and mints no phantom cycle", () => {
  const config = makeConfig();
  const queue = makeQueue([makeQueueItem("", { dependsOn: [""] })]);
  const result = validateQueue(queue, config);
  assert.equal(result.ok, false, "the queue is rejected");
  assert.ok(
    result.violations.some((v) => /empty id/i.test(v)),
    "the empty id is named",
  );
  assert.equal(
    result.violations.some((v) => /cycle \(\s*->\s*\)/.test(v)),
    false,
    "no incoherent empty-node cycle text is emitted",
  );
});

// --- R8 [E5] the disjoint-path guard must not false-reject a root-level-only
// glob. `*.md` matches only top-level files, so it cannot intersect a
// behavioralPath rooted in a directory; `**/*.md` genuinely can, and still must.
test("[9.2-fix-rootless-glob] a root-level-only fileScope glob is disjoint from a directory behavioralPath", () => {
  const config = makeConfig({ behavioralPaths: ["lib/runtime/**"] });
  const rootOnly = validateQueue(
    makeQueue([makeQueueItem("I1", { behavioral: false, fileScope: ["*.md"], testScope: [] })]),
    config,
  );
  assert.equal(
    rootOnly.violations.some((v) => /disjoint|intersect/i.test(v)),
    false,
    "'*.md' matches only root-level files and cannot intersect 'lib/runtime/**'",
  );

  const recursive = validateQueue(
    makeQueue([makeQueueItem("I1", { behavioral: false, fileScope: ["**/*.md"], testScope: [] })]),
    config,
  );
  assert.ok(
    recursive.violations.some((v) => /intersect/i.test(v)),
    "'**/*.md' DOES reach under lib/runtime and is still rejected",
  );
});

// --- R9 [E8/F8] the placeholder doctrine covers the whole plan OUTPUT: a
// decision proposal carrying "TBD" would otherwise be minted into the permanent
// §2.7 ledger while the identical string in markdown rejects the whole plan.
test("[9.2-fix-decision-placeholders] placeholders in a decision proposal reject the plan and persist nothing", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    seedDecomposed(store, runId);

    const dirty = makeDecisionProposal({ why: "TBD" });
    const w = makePlannerFanout(runId, config, journal.sink, [planJson(CLEAN_PLAN_MD, [dirty])]);
    const err = await expectReject(
      () => handlePlan({ store, fanout: w.fanout, runId, config, journal: journal.sink, now: () => START_MS }),
      "plan decision carrying a placeholder",
    );
    assert.match(err.message, /TBD|placeholder/i, "the rejection names the placeholder defect");
    assert.equal(readDecisions(runDirOf(store, runId)).length, 0, "no decision line is minted");
    assert.ok(!existsSync(path.join(runDirOf(store, runId), "plan.md")), "no plan.md is written");
    assert.equal(store.loadRun(runId).state, "DECOMPOSED", "the run stays in DECOMPOSED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- R10 [E9] the ONE bounded re-prompt must carry EVERY defect class. A reply
// that is both placeholder-laden AND carries a <2-option derived decision used
// to be re-prompted about the placeholders only, so a compliant attempt 2 died
// terminally for a defect the planner was never shown.
test("[9.2-fix-reprompt-all-defects] the single re-prompt names placeholder AND decision defects together", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    seedDecomposed(store, runId);

    const oneOption = makeDecisionProposal({ options: [{ name: "cpp-httplib", score: FULL_SCORE }] });
    const w = makePlannerFanout(runId, config, journal.sink, [
      planJson(PLACEHOLDER_PLAN_MD, [oneOption]),
      planJson(CLEAN_PLAN_MD, [makeDecisionProposal()]),
    ]);
    const res = await handlePlan({ store, fanout: w.fanout, runId, config, journal: journal.sink, now: () => START_MS });

    assert.equal(w.sdk.prompts.length, 2, "exactly one bounded re-prompt");
    const reprompt = w.sdk.prompts[1].text;
    assert.ok(/\bTBD\b|placeholder|TODO/i.test(reprompt), "the re-prompt names the placeholder defect");
    assert.ok(/2|two|option/i.test(reprompt), "the SAME re-prompt also names the ≥2-scored-options defect");
    assert.equal(res.runState, "PLANNED", "the compliant second reply is accepted");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- R11 [I5] a decision-gate rejection journals its reason like every other
// rejection in these handlers (it threw with no grep-able trace).
test("[9.2-fix-journal-decision-reject] a rejected plan decision emits a guard-reject before throwing", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    seedDecomposed(store, runId);

    const oneOption = makeDecisionProposal({ options: [{ name: "only", score: FULL_SCORE }] });
    const w = makePlannerFanout(runId, config, journal.sink, [planJson(CLEAN_PLAN_MD, [oneOption])]);
    await expectReject(
      () => handlePlan({ store, fanout: w.fanout, runId, config, journal: journal.sink, now: () => START_MS }),
      "plan <2-option derived decision",
    );
    assert.ok(
      journal.records.some((r) => r.component === "fsm" && r.event === "guard-reject"),
      "the decision-gate rejection is journaled as fsm/guard-reject (closed vocabulary)",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- R12 [I2] a corrupt queue.json is a NAMED legality failure (it leaked a raw
// SyntaxError naming neither tool nor file), and reads are BOM-tolerant.
test("[9.2-fix-queue-read] a corrupt queue.json is named, and a BOM-prefixed queue.json still parses", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);

    const runId = createIntakeRun(store);
    seedDecomposed(store, runId);
    writeFileSync(path.join(runDirOf(store, runId), "queue.json"), "{not json");
    const w = makePlannerFanout(runId, config, journal.sink, [planJson(CLEAN_PLAN_MD, [])]);
    const err = await expectReject(
      () => handlePlan({ store, fanout: w.fanout, runId, config, journal: journal.sink, now: () => START_MS }),
      "corrupt queue.json",
    );
    assert.match(err.message, /conductor_plan/, "the error names the tool");
    assert.match(err.message, /queue\.json/, "the error names the file");

    const runId2 = createIntakeRun(store);
    seedDecomposed(store, runId2);
    writeFileSync(
      path.join(runDirOf(store, runId2), "queue.json"),
      "﻿" + JSON.stringify(makeQueue([makeQueueItem("I1")]), null, 2),
    );
    const w2 = makePlannerFanout(runId2, config, journal.sink, [planJson(CLEAN_PLAN_MD, [])]);
    const res = await handlePlan({
      store,
      fanout: w2.fanout,
      runId: runId2,
      config,
      journal: journal.sink,
      now: () => START_MS,
    });
    assert.equal(res.runState, "PLANNED", "a BOM-prefixed queue.json is read, not rejected (§2 BOM tolerance)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- R13 [I6] the Plan decision schema is DERIVED from the DecisionRecord
// schema, so a future §2.7 field cannot drift the two apart (the TS type is
// already Omit<DecisionRecord,"id"|"tsIso">).
test("[9.2-fix-plan-schema-derived] SCHEMAS.Plan's decision shape is DecisionRecord minus id/tsIso", () => {
  const record = SCHEMAS.DecisionRecord as { properties: Record<string, unknown>; required: string[] };
  const plan = SCHEMAS.Plan as {
    properties: { decisions: { items: { properties: Record<string, unknown>; required: string[] } } };
  };
  const proposal = plan.properties.decisions.items;
  assert.deepEqual(
    Object.keys(proposal.properties).sort(),
    Object.keys(record.properties).filter((k) => k !== "id" && k !== "tsIso").sort(),
    "the proposal carries exactly the DecisionRecord fields minus the two the handler mints",
  );
  assert.deepEqual(
    [...proposal.required].sort(),
    record.required.filter((k) => k !== "id" && k !== "tsIso").sort(),
    "and requires exactly the same fields minus those two",
  );
});

// --- R14 [F6] the decompose prompt must state the ponytail law that will
// ACTUALLY be enforced: under "lite" the ladder is advisory (validateQueue does
// not enforce it), so telling the planner it "is rejected" is a lie; "ultra"
// additionally instructs the planner to challenge requirements (§6.3).
test("[9.2-fix-ponytail-prompt] the decompose prompt states the ponytail law at the CONFIGURED intensity", async () => {
  const root = scratchDir();
  try {
    const journal = makeJournal();
    const good = queueJson([makeQueueItem("I1", { fileScope: ["src/a.ts"], testScope: ["tests/a.test.ts"] })]);

    const liteConfig = makeConfig({ ponytail: "lite" });
    const liteStore = openStore(root, journal.sink, liteConfig);
    const liteRun = createIntakeRun(liteStore);
    const wl = makePlannerFanout(liteRun, liteConfig, journal.sink, [good]);
    await handleDecompose({ store: liteStore, fanout: wl.fanout, runId: liteRun, config: liteConfig, journal: journal.sink });
    assert.equal(
      /empty reuse note is rejected|is rejected/i.test(wl.sdk.prompts[0].text.split("ponytail")[1] ?? ""),
      false,
      "under lite the prompt does not claim the ladder rung is REJECTED (it is advisory)",
    );

    const ultraRoot = scratchDir();
    const ultraConfig = makeConfig({ ponytail: "ultra" });
    const ultraStore = openStore(ultraRoot, journal.sink, ultraConfig);
    const ultraRun = createIntakeRun(ultraStore);
    const wu = makePlannerFanout(ultraRun, ultraConfig, journal.sink, [good]);
    await handleDecompose({
      store: ultraStore,
      fanout: wu.fanout,
      runId: ultraRun,
      config: ultraConfig,
      journal: journal.sink,
    });
    assert.ok(
      /challenge/i.test(wu.sdk.prompts[0].text),
      "under ultra the prompt carries the §6.3 challenge-requirements instruction",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// fix-cluster-and-drift (a): the acceptance-cluster SUBJECT scan
// ===========================================================================
//
// acceptanceClusters takes each criterion's first whitespace token and strips
// only the LEADING and TRAILING runs of non-[\w./-] characters, so ordinary CALL
// SYNTAX — which §3.2's observable-check row actively asks for — reads one
// function as two subjects: `pad("a")` keeps an internal `("` and becomes
// `pad("a`, while `pad("")` loses `("")` because it IS a trailing run and becomes
// `pad`. validateQueue then rejects a legitimate item and quotes the nonsense
// cluster name back at the planner, pushing it to jam two checks onto one line to
// get past the guard — degrading the acceptance quality the guard exists to
// protect. The four rows below are the fix-cluster-and-drift contract; the one
// SIZE rule itself (> 1 cluster is too large) is not in scope and is not touched.

// The measured failing pair, verbatim from the spec's MEASURED CONSEQUENCE: two
// observable checks on ONE function, written the way an assertion runs.
const ONE_SUBJECT_CALLS = ['pad("a") === "[a]"', 'pad("") === ""'];
// The same pair with no call syntax anywhere — the phrasing that already works,
// which localises the defect to the punctuation rather than to the pair.
const ONE_SUBJECT_BARE = ["pad returns [a] for a", "pad returns the empty string for empty input"];

// A delimiter is unbalanced when its opener and closer counts disagree (quotes
// count as their own pair, so an ODD number is unbalanced). Used to judge the
// cluster names a violation quotes back at the planner.
function unbalancedDelimiters(text: string): string[] {
  const bad: string[] = [];
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
    const opens = text.split(open).length - 1;
    const closes = text.split(close).length - 1;
    if (opens !== closes) bad.push(`${open}${close}`);
  }
  for (const quote of ['"', "'", "`"]) {
    if ((text.split(quote).length - 1) % 2 !== 0) bad.push(quote);
  }
  return bad;
}

// ===========================================================================
// [fc-clusters-one-subject-many-checks]
// ===========================================================================

test("[fc-clusters-one-subject-many-checks] two acceptance criteria that assert about the SAME subject are ONE cluster however they are phrased — the docstring's own promise that an item may pin several observable checks on one behaviour — so the measured call-syntax pair yields exactly one subject and validateQueue ACCEPTS the item, and the bare-identifier phrasing of the same pair does the same", () => {
  const config = makeConfig();

  assert.deepEqual(
    acceptanceClusters(ONE_SUBJECT_CALLS),
    ["pad"],
    'both criteria assert about pad(), so the item pins two observable checks on ONE subject — not "two things"',
  );

  // Through validateQueue, because the rejection the planner actually sees is
  // the thing that was wrong.
  const verdict = validateQueue(makeQueue([makeQueueItem("S1", { acceptance: [...ONE_SUBJECT_CALLS] })]), config);
  assert.deepEqual(
    verdict.violations.filter((v) => /cluster/i.test(v)),
    [],
    "the planner is told nothing about clusters: a legitimate two-check item is not a two-cluster item",
  );
  assert.equal(verdict.ok, true, "and the item is accepted");

  assert.deepEqual(
    acceptanceClusters(ONE_SUBJECT_BARE),
    ["pad"],
    "the same pair written without call syntax resolves to the same single subject",
  );
  const bare = validateQueue(makeQueue([makeQueueItem("S1", { acceptance: [...ONE_SUBJECT_BARE] })]), config);
  assert.equal(bare.ok, true, "and is accepted too — the two phrasings of one pair cannot disagree");
});

// ===========================================================================
// [fc-clusters-distinct-subjects-still-split]
// ===========================================================================

test("[fc-clusters-distinct-subjects-still-split] the size guard is not loosened into uselessness: two criteria about genuinely DIFFERENT subjects are still TWO clusters and are still rejected, including the near-miss pair config.load versus config — which stays distinct whether or not the call is written with arguments, so the fix cannot be 'strip everything after the first word'", () => {
  const config = makeConfig();

  const twoThings = ["parser rejects an unknown key", "router retries on 502"];
  assert.deepEqual(
    acceptanceClusters(twoThings),
    ["parser", "router"],
    "two subjects are two clusters — exactly the 'this item covers two things' smell §3.2's size row targets",
  );
  const split = validateQueue(makeQueue([makeQueueItem("S1", { acceptance: twoThings })]), config);
  assert.equal(split.ok, false, "and the two-things item is still REJECTED");
  assert.ok(
    split.violations.some((v) => /spans 2 clusters/i.test(v)),
    `the rejection is the one-cluster budget's; got: ${split.violations.join(" | ")}`,
  );

  // The near miss. A dot, slash or hyphen is part of an identifier; a parenthesis
  // or a quote is not. So `config.load(cfg)` is the subject `config.load`, which
  // is NOT the subject `config` — collapsing those two would make the size guard
  // too permissive instead of too strict.
  const nearMiss = ["config.load(cfg) rejects an unknown key with a named error", "config exposes the parsed table"];
  assert.deepEqual(
    acceptanceClusters(nearMiss),
    ["config.load", "config"],
    "config.load and config stay DISTINCT subjects, and the call's arguments are no part of either name",
  );
  const nearVerdict = validateQueue(makeQueue([makeQueueItem("S2", { acceptance: nearMiss })]), config);
  assert.equal(nearVerdict.ok, false, "so the near-miss item is still rejected as two clusters");
  assert.ok(
    nearVerdict.violations.some((v) => /spans 2 clusters/i.test(v)),
    `the near-miss rejection is the one-cluster budget's too; got: ${nearVerdict.violations.join(" | ")}`,
  );
});

// ===========================================================================
// [fc-clusters-determiner-behaviour-preserved]
// ===========================================================================

test("[fc-clusters-determiner-behaviour-preserved] the determiner fix core/planning.ts:205-216 records stays fixed under the new scan: a criterion opening with an article resolves to the same subject as the same criterion without one, two criteria differing only by an article stay ONE cluster and are accepted, two different subjects behind articles stay TWO — and the two fixes compose, an article in front of a CALL still resolving to the bare subject", () => {
  const config = makeConfig();

  const withAndWithout = ["the parser rejects an unknown key", "parser preserves key order"];
  assert.deepEqual(
    acceptanceClusters(withAndWithout),
    ["parser"],
    "one subject phrased with and without an article is ONE cluster, named for the subject and not for the article",
  );
  assert.equal(
    validateQueue(makeQueue([makeQueueItem("S1", { acceptance: withAndWithout })]), config).ok,
    true,
    "so the item is accepted — the nonsense reason 'spans 2 clusters (parser, the)' cannot come back",
  );

  assert.deepEqual(
    acceptanceClusters(["the parser rejects an unknown key", "the router retries on 502"]),
    ["parser", "router"],
    "and two DIFFERENT subjects behind articles do not collapse into the article",
  );

  const articleThenCall = ['the pad("a") returns "[a]"', 'pad("") === ""'];
  assert.deepEqual(
    acceptanceClusters(articleThenCall),
    ["pad"],
    "the determiner skip and the subject scan compose: an article in front of a call still resolves to the bare subject",
  );
});

// ===========================================================================
// [fc-clusters-violation-names-a-real-subject]
// ===========================================================================

test("[fc-clusters-violation-names-a-real-subject] when the guard DOES reject, the violation names subjects a human recognises: on two different call-syntax subjects the rejection still stands, and no cluster name it quotes back at the planner carries an unbalanced quote or parenthesis — the measured defect quoted `pad(\"a`, which is not a thing that exists in the item", () => {
  const config = makeConfig();
  const twoCalls = ['pad("a") === "[a]"', 'trim("b") === "b"'];
  const verdict = validateQueue(makeQueue([makeQueueItem("S1", { acceptance: twoCalls })]), config);

  assert.equal(verdict.ok, false, "premise: two DIFFERENT functions, so the one-cluster budget still rejects this item");
  const clusterViolations = verdict.violations.filter((v) => /clusters/i.test(v));
  assert.equal(
    clusterViolations.length,
    1,
    `premise: exactly one cluster violation to read the names out of; got: ${verdict.violations.join(" | ")}`,
  );

  const named = /clusters \((.*)\), over the one-cluster/.exec(clusterViolations[0]);
  assert.notEqual(named, null, `the violation lists the clusters it counted; got: ${clusterViolations[0]}`);
  const names = (named === null ? "" : named[1]).split(", ");
  assert.equal(names.length, 2, `two clusters were counted, so two names are listed; got: ${clusterViolations[0]}`);
  for (const name of names) {
    assert.deepEqual(
      unbalancedDelimiters(name),
      [],
      `the violation quotes the cluster name "${name}" back at the planner, which is not a thing that exists in the item: ${clusterViolations[0]}`,
    );
  }
});
