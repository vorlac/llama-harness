// Task 9.1 RED tests — FINAL LOCATION conductor/tests/tools-9.1.test.ts.
//
// SUBJECT (must NOT exist when this goes red): the SIX Phase-9 stage-tool handlers
// added to the EXISTING conductor/adapter/tools.ts (which today carries only the §5.3
// gate wiring). The red is the missing-export shape — tools.ts resolves, but the named
// bindings below do not yet exist:
//   handleClassify, handleStatus, handleDecide, handleSurface, handleAnswer, handleDefer
//
// Each handler follows the §3.4 invariant loop: legality → derive → persist → journal →
// compact return. Handlers are the ONLY writers of run/item state (G6); they persist
// through the adapters that already exist — adapter/state.ts (StateStore: createRun /
// saveRun / loadItem / saveItem / setBlocked / clearBlocked / setDeferred) and
// adapter/questions.ts (appendQuestion / readQuestions / answerQuestion) — and they write
// the two ledgers this task introduces at the run dir (queue.json for a synthesized
// trivial item, decisions.jsonl for decide/defer).
//
// Spec read (docs/plans/2026-08-07-conductor-harness-plan.md):
//   §9 Task 9.1 (2567-2582)  — the authoritative behaviour of the six tools.
//   §3.4 (1303-1332)         — tool inventory + the invariant handler loop.
//   §3.2 (1076-1094)         — INTAKE: classify dispatches a mechanical classifier then a
//                              skeptic check; disagreement escalates to the STRICTER kind;
//                              question⇒ANSWERED, trivial⇒EXECUTING(one synthesized item),
//                              work⇒stays INTAKE with the classification recorded; the
//                              handler re-checks trivialMaxFiles / testScope / behavioralPaths
//                              and escalates to work on any violation (classifier proposes,
//                              handler disposes).
//   §2.4 (715-751)           — the queue item + ponytail block + the disjoint behavioralPaths guard.
//   §2.7 (852-874)           — the decision record + the ≥2-scored-options rule for kind:derived.
//   §2.11 (979-998)          — the question record + the blocked:{questionId} shape + answer's
//                              clear-first order.
//   docs/build/specs/task-9.1.assertions.json — the 8 rows mapped to the tests below.
//
// ---------------------------------------------------------------------------
// PINNED HANDLER SURFACE the implementer must target (adapter/tools.ts). Each input is a
// single options object; each result is a compact record the orchestrator can narrate.
// runDir is derived by every handler as <store.root>/.conductor/runs/<runId>/. `journal`
// is the leveled sink (adapter/journal.ts Journal-compatible); `now` defaults to Date.now.
//
//   // conductor_classify — dispatches a classifier (schema CLASSIFICATION) then a skeptic
//   // check (schema CLASSIFICATION_CHECK) through the injected Fanout (adapter/fanout.ts,
//   // which drives the SDK — the fake SDK here). Escalates to the stricter kind on
//   // disagreement AND on any handler re-check failure; embeds {agreed,note} into
//   // run.classification.check; on trivial, synthesizes queue.json's one §2.4 item and the
//   // §2.5 runtime item and advances the run to EXECUTING.
//   handleClassify(input: {
//     store: StateStore; fanout: Fanout; runId: string; config: Config;
//     journal: JournalSink; sessionID?: string; now?: () => number;
//   }): Promise<{
//     kind: ClassificationKind;               // the FINAL (possibly escalated) kind
//     agreed: boolean;                        // the skeptic's verdict
//     correctedKind: ClassificationKind | null; // null IFF agreed
//     itemId: string | null;                  // the synthesized trivial item id, else null
//     runState: RunState;                     // ANSWERED | EXECUTING | INTAKE
//   }>
//
//   // conductor_status — read-only render of run/item/question dispositions.
//   handleStatus(input: { store: StateStore; runId: string; journal: JournalSink }): {
//     runId: string; state: RunState;
//     classification: { kind: ClassificationKind } | null;
//     items: Array<{ id: string; state: string; blocked: unknown; deferred: unknown }>;
//     openQuestions: Array<{ id: string; question: string }>;
//   }
//
//   // conductor_decide — appends the §2.7 record; REJECTS (throws) a kind:derived record
//   // carrying <2 scored options (core requireTwoOptions); mints id+tsIso; persists+journals.
//   handleDecide(input: {
//     store: StateStore; runId: string; journal: JournalSink; now?: () => number;
//     question: string;
//     options: Array<{ name: string; score?: DecisionRecord["options"][number]["score"] }>;
//     choice: string; why: string; kind: "derived" | "human"; appliedWhere: string;
//   }): { decisionId: string; record: DecisionRecord }
//
//   // conductor_surface — appends the §2.11 question (origin "surface-tool"), sets
//   // blocked:{questionId} on every named item, leaves the rest actionable, journals.
//   handleSurface(input: {
//     store: StateStore; runId: string; journal: JournalSink; now?: () => number;
//     question: string; blocksItems: string[];
//     askedBy: { role: string; sessionID: string }; humanTerritory?: boolean;
//   }): { questionId: string; blockedItemIds: string[] }
//
//   // conductor_answer — clears blocked on EXACTLY the items bound to the question and no
//   // others (clear-first, then mark answered — delegated to questions.answerQuestion,
//   // the C-018/C-020 wedge guard), journals.
//   handleAnswer(input: {
//     store: StateStore; runId: string; journal: JournalSink; now?: () => number;
//     questionId: string; answer: string;
//   }): { questionId: string; clearedItemIds: string[] }
//
//   // conductor_defer — appends a §2.7 decision record explaining the deferral, then sets
//   // deferred:{reason,decisionId} on the item (report accepts a deferred item as settled).
//   handleDefer(input: {
//     store: StateStore; runId: string; journal: JournalSink; now?: () => number;
//     itemId: string; reason: string;
//   }): { itemId: string; decisionId: string }
// ---------------------------------------------------------------------------
//
// Assertion id → test:
//   9.1-classify         → "[9.1-classify] dispatches a classifier + a skeptic (each
//                           schema-constrained) on the fake SDK; disagreement escalates to the
//                           stricter kind; run.json embeds the check; correctedKind null iff agreed"
//   9.1-trivial-item     → "[9.1-trivial-item] a trivial classification synthesizes its one §2.4
//                           item (title + acceptance + ponytail) and enters EXECUTING"
//   9.1-trivial-escalate → three tests, one per violation (fileScope>trivialMaxFiles; empty
//                           behavioral testScope; behavioral:false ∩ behavioralPaths)
//   9.1-status           → "[9.1-status] renders open questions + item dispositions, read-only"
//   9.1-decide           → "[9.1-decide] appends the §2.7 record; rejects <2 scored options for
//                           kind:derived; the record persists and journals"
//   9.1-surface          → "[9.1-surface] writes questions.jsonl + blocks every named item; the
//                           run continues on the rest; journals"
//   9.1-answer           → "[9.1-answer] clears exactly the bound items, marks answered, journals"
//   9.1-defer            → "[9.1-defer] sets deferred + a decision record; report's precondition
//                           accepts the deferred item as settled"

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// The SUBJECTS — absent at red time (missing-export red from the existing tools.ts).
import {
  handleClassify,
  handleStatus,
  handleDecide,
  handleSurface,
  handleAnswer,
  handleDefer,
} from "../adapter/tools.ts";

// Adapters + core that DO exist (Tasks 4.1 / 7.1 / 1.1 / 3.2 / 1.5).
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { appendQuestion, readQuestions } from "../adapter/questions.ts";
import type { NewQuestion } from "../adapter/questions.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, TreeState } from "../adapter/fanout.ts";
import { legalTools } from "../core/gates-phase.ts";
import type { GateItem, GateRun } from "../core/gates-phase.ts";
import { validate, SCHEMAS } from "../core/types.ts";
import type {
  Classification,
  ClassificationCheck,
  ClassificationKind,
  Config,
  DecisionRecord,
  Item,
  RunState,
  TrivialItem,
  TreePath,
} from "../core/types.ts";

import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

// Adversarial-review fix tests (F1-F7) additionally exercise: the REAL throwing journal
// (createJournal), the closed §7.4 event vocabulary (isKnownEvent), and the §6.2
// human-territory classifier (isHumanTerritory) that §2.11 makes authoritative.
import { createJournal } from "../adapter/journal.ts";
import { isKnownEvent } from "../core/journal-events.ts";
import { isHumanTerritory } from "../core/decide.ts";

// ---------------------------------------------------------------------------
// Fixtures + helpers.
// ---------------------------------------------------------------------------

// A fixed injected clock: the store reads OpenOptions.now for every stamped value, so
// every persisted timestamp below is deterministic.
const START_MS = 1_754_560_000_000;

// A leveled sink structurally compatible with adapter/journal.ts Journal (used for the
// store, the fan-out engine, and every handler) — captures every record for the journal
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

// A never-frozen §3.5 tree view (classify runs readers only, so this only has to admit).
const OPEN_TREE: TreeState = {
  isFrozen(): boolean {
    return false;
  },
  onClear(): () => void {
    return () => undefined;
  },
};

// A complete §2.1 Config; only trivialMaxFiles / behavioralPaths / models.default matter
// to these tests, so they are parameterised and the rest are inert-but-valid defaults.
function makeConfig(
  opts: { trivialMaxFiles?: number; behavioralPaths?: string[]; modelDefault?: string } = {},
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
    ponytail: "full",
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
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-tools91-"));
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

// Create a run at INTAKE with a schema-valid PLACEHOLDER classification (chat.message
// synthesizes one; conductor_classify overwrites it). Returns the run id.
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

// A schema-valid §2.5 runtime Item at PENDING (seeding for the disposition handlers).
function makeItem(id: string, over: Partial<Item> = {}): Item {
  const base: Item = {
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
  return { ...base, ...over };
}

// A schema-valid §2.10 trivialItem (a COMPLETE §2.4 item minus id/dependsOn).
function makeTrivialItem(over: Partial<TrivialItem> = {}): TrivialItem {
  const base: TrivialItem = {
    title: "rename the widget helper",
    rationale: "the helper name no longer matches its behaviour",
    fileScope: ["src/widget.ts"],
    testScope: ["tests/widget.test.ts"],
    acceptance: ["widget() returns the trimmed label"],
    behavioral: true,
    ponytail: { necessary: "the call site needs the corrected name", reuse: "checked util.ts; nothing covers this", ladderRung: "one-liner" },
  };
  return { ...base, ...over };
}

function makeClassification(kind: ClassificationKind, trivialItem: TrivialItem | null): Classification {
  return { kind, rationale: `classified ${kind}`, confidence: "high", trivialItem };
}
function makeCheck(agreed: boolean, correctedKind: ClassificationKind | null, note: string): ClassificationCheck {
  return { agreed, correctedKind, note };
}

// Build a Fanout over the fake SDK that replies with `classification` to the classifier
// sub-session and `check` to the skeptic sub-session — discriminated by the registry role
// the fan-out engine writes BEFORE the first prompt (the §3.5 registry-before-prompt
// witness). Records every role that was actually prompted so the test can assert BOTH a
// classifier and a skeptic were dispatched.
function makeClassifyFanout(
  runId: string,
  config: Config,
  journal: JournalSink,
  classification: Classification,
  check: ClassificationCheck,
): { fanout: Fanout; sdk: ReturnType<typeof makeFakeSdk>; promptedRoles: string[] } {
  const registry = new Map<string, { role: string; itemId: string; tree: TreePath }>();
  const sdk = makeFakeSdk({ registry });
  const promptedRoles: string[] = [];
  sdk.setResponder((req) => {
    const role = req.entry?.role ?? "";
    promptedRoles.push(role);
    const body = role === "skeptic" ? check : classification;
    return { kind: "reply", text: JSON.stringify(body) };
  });
  const fanout = createFanout(sdk.client, config, journal as unknown as Parameters<typeof createFanout>[2], registry, OPEN_TREE, runId);
  return { fanout, sdk, promptedRoles };
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

// assert.throws that hands back the Error so the caller can assert on the reason.
function expectThrow(fn: () => void, ctx: string): Error {
  let caught: unknown;
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    caught = e;
  }
  assert.ok(threw, `${ctx}: expected a throw`);
  assert.ok(caught instanceof Error, `${ctx}: the throw must be an Error`);
  assert.ok((caught as Error).message.length > 0, `${ctx}: the thrown reason must be non-empty`);
  return caught as Error;
}

// ---------------------------------------------------------------------------
// Fixture sanity: every payload the fake SDK returns must satisfy the schema the
// fan-out engine validates it against, or a classify red would be a fixture bug, not a
// handler bug. (Same discipline as fanout.test.ts's probe sanity block.)
// ---------------------------------------------------------------------------
assert.equal(
  validate("Classification", makeClassification("trivial", makeTrivialItem())).ok,
  true,
  "sanity: a trivial Classification fixture must satisfy SCHEMAS.Classification",
);
assert.equal(
  validate("Classification", makeClassification("work", null)).ok,
  true,
  "sanity: a work Classification fixture must satisfy SCHEMAS.Classification",
);
assert.equal(
  validate("ClassificationCheck", makeCheck(false, "work", "should be work")).ok,
  true,
  "sanity: a ClassificationCheck fixture must satisfy SCHEMAS.ClassificationCheck",
);

// ===========================================================================
// [9.1-classify]
// ===========================================================================

test("[9.1-classify] dispatches a classifier + a skeptic (each schema-constrained) on the fake SDK; disagreement escalates to the stricter kind; run.json embeds the check; correctedKind null iff agreed", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ trivialMaxFiles: 5, modelDefault: "test-model" });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);

    // --- disagreement: classifier says "trivial", skeptic corrects to "work" ---------
    const runId = createIntakeRun(store);
    const wiring = makeClassifyFanout(
      runId,
      config,
      journal.sink,
      makeClassification("trivial", makeTrivialItem()),
      makeCheck(false, "work", "touches production wiring — should be work"),
    );

    const res = await handleClassify({ store, fanout: wiring.fanout, runId, config, journal: journal.sink, sessionID: "ses_orchestrator" });

    // BOTH sub-sessions were actually dispatched ON THE FAKE SDK.
    assert.equal(wiring.sdk.creates.length, 2, "classify creates exactly two sub-sessions (classifier + skeptic)");
    assert.equal(wiring.sdk.prompts.length, 2, "classify prompts both sub-sessions");
    assert.ok(
      wiring.sdk.prompts.every((p) => p.hasFormatField === false),
      "structured output is prompt-shaped + independently validated (no native `format` field — Task 0.2 DRIFT)",
    );
    // One classifier (a non-skeptic role) and one skeptic — that is the two-role dispatch.
    assert.equal(wiring.promptedRoles.length, 2, "exactly two roles were prompted");
    assert.ok(wiring.promptedRoles.includes("skeptic"), "one dispatched sub-session is the skeptic cross-check");
    assert.ok(
      wiring.promptedRoles.some((r) => r.length > 0 && r !== "skeptic"),
      "the other dispatched sub-session is the classifier (a non-skeptic role)",
    );

    // Disagreement escalates to the STRICTER kind (work > trivial > question).
    assert.equal(res.kind, "work", "trivial-vs-work disagreement escalates to the stricter kind: work");
    assert.equal(res.agreed, false, "the skeptic disagreed");
    assert.equal(res.correctedKind, "work", "on disagreement correctedKind is the skeptic's non-null correction");
    assert.equal(res.runState, "INTAKE", "a work classification keeps the run in INTAKE (decompose is next)");

    // run.json embeds the check ({agreed, note}) and records the final kind.
    const run = store.loadRun(runId);
    assert.equal(run.classification.kind, "work", "run.json records the escalated kind");
    assert.equal(run.classification.check.agreed, false, "run.json embeds the skeptic verdict (disagreed)");
    assert.ok(run.classification.check.note.length > 0, "run.json embeds the skeptic's note");
    assert.equal(run.state, "INTAKE", "the persisted run stays INTAKE for a work classification");

    // --- agreement: correctedKind is null IFF they agreed --------------------------
    const runId2 = createIntakeRun(store);
    const wiring2 = makeClassifyFanout(
      runId2,
      config,
      journal.sink,
      makeClassification("work", null),
      makeCheck(true, null, "agrees: this is real work"),
    );
    const res2 = await handleClassify({ store, fanout: wiring2.fanout, runId: runId2, config, journal: journal.sink });
    assert.equal(res2.agreed, true, "the skeptic agreed");
    assert.equal(res2.correctedKind, null, "correctedKind is null exactly when they agreed");
    assert.equal(res2.kind, "work", "an agreed work classification stays work");
    const run2 = store.loadRun(runId2);
    assert.equal(run2.classification.check.agreed, true, "run.json embeds the agreed verdict");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.1-trivial-item]
// ===========================================================================

test("[9.1-trivial-item] a trivial classification synthesizes its one §2.4 item (title + acceptance + ponytail) and enters EXECUTING", async () => {
  const root = scratchDir();
  try {
    // trivialMaxFiles 1, one file, non-empty testScope, behavioral true → passes every re-check.
    const config = makeConfig({ trivialMaxFiles: 1, behavioralPaths: ["src/**"], modelDefault: "test-model" });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);

    const trivial = makeTrivialItem({ fileScope: ["src/widget.ts"], testScope: ["tests/widget.test.ts"], behavioral: true });
    const wiring = makeClassifyFanout(runId, config, journal.sink, makeClassification("trivial", trivial), makeCheck(true, null, "agrees trivial"));

    const res = await handleClassify({ store, fanout: wiring.fanout, runId, config, journal: journal.sink });

    assert.equal(res.kind, "trivial", "the trivial classification survives the handler re-check");
    assert.equal(res.runState, "EXECUTING", "a trivial run enters EXECUTING flagged trivial (§3.2)");
    assert.ok(res.itemId !== null && res.itemId.length > 0, "the synthesized item has an id");
    const itemId = res.itemId as string;

    // The synthesized queue (§2.4) is persisted and validates as any decomposed queue would.
    const queuePath = path.join(runDirOf(store, runId), "queue.json");
    assert.ok(existsSync(queuePath), "the trivial path writes runs/<runId>/queue.json");
    const queue = JSON.parse(readFileSync(queuePath, "utf8")) as { items: unknown[] };
    assert.equal(validate("Queue", queue).ok, true, "the synthesized queue validates against the §2.4 queue schema");
    assert.equal(queue.items.length, 1, "the trivial run has exactly one synthesized item");
    const qi = queue.items[0] as {
      id: string;
      title: string;
      acceptance: string[];
      dependsOn: string[];
      ponytail: { necessary: string; reuse: string; ladderRung: string };
    };
    assert.equal(qi.id, itemId, "the synthesized queue item carries the returned id");
    assert.deepEqual(qi.dependsOn, [], "a lone synthesized item depends on nothing");
    // title + acceptance + the whole ponytail block are present (the fields the earlier
    // bare-scope design had no source for — now sourced from classification.trivialItem).
    assert.ok(qi.title.length > 0, "the synthesized item carries a title");
    assert.ok(Array.isArray(qi.acceptance) && qi.acceptance.length > 0, "the synthesized item carries acceptance criteria");
    assert.ok(qi.ponytail.necessary.length > 0, "the ponytail block carries `necessary`");
    assert.ok(qi.ponytail.reuse.length > 0, "the ponytail block carries the reuse note");
    assert.ok(qi.ponytail.ladderRung.length > 0, "the ponytail block carries a ladderRung");

    // The §2.5 runtime item was created at the head of the item FSM.
    const runtime = store.loadItem(runId, itemId);
    assert.equal(validate("Item", runtime).ok, true, "the runtime item validates against the §2.5 item schema");
    assert.equal(runtime.state, "PENDING", "the synthesized item starts at PENDING (the item FSM is never skipped)");
    assert.equal(runtime.blocked, null, "a fresh synthesized item is neither blocked");
    assert.equal(runtime.deferred, null, "nor deferred");

    const run = store.loadRun(runId);
    assert.equal(run.classification.kind, "trivial", "run.json records the trivial classification");
    assert.equal(run.state, "EXECUTING", "the persisted run is EXECUTING");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.1-trivial-escalate] — one test per §2.4 violation; each escalates trivial → work
// even though the skeptic AGREED it was trivial (classifier proposes, handler disposes).
// ===========================================================================

// A shared driver: run classify with a trivial classifier + agreeing skeptic and assert
// the handler escalated to work (no item synthesized, run stays INTAKE).
async function assertEscalatesToWork(
  root: string,
  config: Config,
  trivial: TrivialItem,
  ctx: string,
): Promise<void> {
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createIntakeRun(store);
  const wiring = makeClassifyFanout(runId, config, journal.sink, makeClassification("trivial", trivial), makeCheck(true, null, "agrees trivial"));

  const res = await handleClassify({ store, fanout: wiring.fanout, runId, config, journal: journal.sink });

  assert.equal(res.kind, "work", `${ctx}: the handler re-check escalates to work`);
  assert.equal(res.itemId, null, `${ctx}: an escalated run synthesizes no trivial item`);
  assert.equal(res.runState, "INTAKE", `${ctx}: an escalated work run stays in INTAKE`);
  assert.ok(
    !existsSync(path.join(runDirOf(store, runId), "queue.json")),
    `${ctx}: no queue.json is written when the trivial classification is escalated`,
  );
  const run = store.loadRun(runId);
  assert.equal(run.classification.kind, "work", `${ctx}: run.json records the escalated kind`);
  assert.equal(run.classification.check.agreed, true, `${ctx}: the skeptic still AGREED — the arithmetic escalated, not the check`);
}

test("[9.1-trivial-escalate] a trivial fileScope exceeding trivialMaxFiles escalates to work", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ trivialMaxFiles: 1, behavioralPaths: [], modelDefault: "test-model" });
    // two files, cap is one.
    const trivial = makeTrivialItem({ fileScope: ["src/a.ts", "src/b.ts"], testScope: ["tests/a.test.ts"], behavioral: true });
    await assertEscalatesToWork(root, config, trivial, "fileScope>trivialMaxFiles");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("[9.1-trivial-escalate] a behavioral trivial item with an empty testScope escalates to work", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ trivialMaxFiles: 5, behavioralPaths: [], modelDefault: "test-model" });
    // behavioral true but no test paths — a behavioral item MUST carry testScope (§2.4).
    const trivial = makeTrivialItem({ fileScope: ["src/a.ts"], testScope: [], behavioral: true });
    await assertEscalatesToWork(root, config, trivial, "behavioral+empty-testScope");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("[9.1-trivial-escalate] a behavioral:false trivial item whose fileScope intersects behavioralPaths escalates to work", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ trivialMaxFiles: 5, behavioralPaths: ["src/**"], modelDefault: "test-model" });
    // behavioral:false claims untestability while editing production code under behavioralPaths
    // — the §2.4 disjoint-path guard forbids it. testScope empty is legal only for behavioral:false,
    // so the ONLY violation exercised here is the path intersection.
    const trivial = makeTrivialItem({ fileScope: ["src/core/thing.ts"], testScope: [], behavioral: false });
    await assertEscalatesToWork(root, config, trivial, "behavioral:false ∩ behavioralPaths");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.1-status]
// ===========================================================================

test("[9.1-status] renders open questions + item dispositions, read-only", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    const runDir = runDirOf(store, runId);

    // Three items with distinct dispositions: I1 blocked, I2 deferred, I3 plain.
    store.saveItem(runId, makeItem("I1", { state: "RED" }));
    store.saveItem(runId, makeItem("I2", { state: "GREEN" }));
    store.saveItem(runId, makeItem("I3", { state: "PENDING" }));

    const q = appendQuestion(
      runDir,
      { runId, question: "Fail the whole load, or collect and report?", askedBy: { role: "planner", sessionID: "ses_p" }, humanTerritory: true, origin: "plan-review-cap", blocksItems: ["I1"] },
      START_MS,
    );
    store.setBlocked(runId, "I1", { reason: "awaiting answer", stage: "plan-review", questionId: q.id });
    store.setDeferred(runId, "I2", { reason: "not this run", decisionId: "D-0001" });

    // Snapshot the persisted files to prove read-only.
    const before = {
      i1: readFileSync(path.join(runDir, "items", "I1.json"), "utf8"),
      i2: readFileSync(path.join(runDir, "items", "I2.json"), "utf8"),
      i3: readFileSync(path.join(runDir, "items", "I3.json"), "utf8"),
      run: readFileSync(path.join(runDir, "run.json"), "utf8"),
      questions: readFileSync(path.join(runDir, "questions.jsonl"), "utf8"),
    };

    const status = handleStatus({ store, runId, journal: journal.sink });

    assert.equal(status.runId, runId, "status names the run");
    assert.equal(status.state, "INTAKE", "status renders the run state");

    const byId = new Map(status.items.map((it) => [it.id, it]));
    const i1 = byId.get("I1");
    const i2 = byId.get("I2");
    const i3 = byId.get("I3");
    assert.ok(i1 !== undefined && i2 !== undefined && i3 !== undefined, "status renders every item");
    assert.equal(i1?.state, "RED", "status renders each item's FSM state (I1 RED)");
    assert.equal(i2?.state, "GREEN", "status renders each item's FSM state (I2 GREEN)");
    assert.ok(i1?.blocked, "I1's blocked disposition is rendered");
    assert.ok(!i1?.deferred, "I1 is not deferred");
    assert.ok(i2?.deferred, "I2's deferred disposition is rendered");
    assert.ok(!i2?.blocked, "I2 is not blocked");
    assert.ok(!i3?.blocked && !i3?.deferred, "I3 has no disposition");

    const oq = status.openQuestions.find((x) => x.id === q.id);
    assert.ok(oq !== undefined, "status renders the open question");
    assert.match(oq?.question ?? "", /collect and report/, "the open question text is rendered");

    // Read-only: not a single persisted byte changed.
    assert.equal(readFileSync(path.join(runDir, "items", "I1.json"), "utf8"), before.i1, "status did not mutate I1");
    assert.equal(readFileSync(path.join(runDir, "items", "I2.json"), "utf8"), before.i2, "status did not mutate I2");
    assert.equal(readFileSync(path.join(runDir, "items", "I3.json"), "utf8"), before.i3, "status did not mutate I3");
    assert.equal(readFileSync(path.join(runDir, "run.json"), "utf8"), before.run, "status did not mutate run.json");
    assert.equal(readFileSync(path.join(runDir, "questions.jsonl"), "utf8"), before.questions, "status did not mutate questions.jsonl");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.1-decide]
// ===========================================================================

test("[9.1-decide] appends the §2.7 record; rejects <2 scored options for kind:derived; the record persists and journals", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    const runDir = runDirOf(store, runId);

    const fullScore = { capability: 2, testability: 2, movingParts: 2, validationEarliness: 1, singleSource: 2 };
    const leanScore = { capability: 1, testability: 1, movingParts: 0, validationEarliness: 1, singleSource: 2 };

    // (a) REJECT: a kind:derived record with <2 scored options (Task 1.5's decide.requireTwoOptions).
    const err = expectThrow(
      () =>
        handleDecide({
          store,
          runId,
          journal: journal.sink,
          now: () => START_MS,
          question: "HTTP client: cpp-httplib vs raw sockets?",
          options: [{ name: "cpp-httplib", score: fullScore }],
          choice: "cpp-httplib",
          why: "only one option scored",
          kind: "derived",
          appliedWhere: "src/router note",
        }),
      "decide <2 scored options",
    );
    assert.match(err.message, /2|two|option/i, "the rejection names the ≥2-scored-options rule");
    assert.equal(readDecisions(runDir).length, 0, "a rejected decision writes NO ledger line (legality precedes persist)");

    // (b) ACCEPT: two scored options → persists + journals.
    const out = handleDecide({
      store,
      runId,
      journal: journal.sink,
      now: () => START_MS,
      question: "HTTP client: cpp-httplib vs raw sockets?",
      options: [
        { name: "cpp-httplib", score: fullScore },
        { name: "raw sockets", score: leanScore },
      ],
      choice: "cpp-httplib",
      why: "strict superset on scored criteria; already a dependency",
      kind: "derived",
      appliedWhere: "src/router note",
    });

    const ledger = readDecisions(runDir);
    assert.equal(ledger.length, 1, "an accepted decision appends exactly one ledger line");
    const rec = ledger[0];
    assert.equal(rec.id, out.decisionId, "the returned decisionId matches the persisted record");
    assert.match(rec.id, /^D-/, "the decision id is minted in the §2.7 D- namespace");
    assert.ok(rec.tsIso.length > 0, "the record is timestamped");
    assert.equal(validate("DecisionRecord", rec).ok, true, "the persisted record validates against the §2.7 schema");
    assert.equal(rec.kind, "derived", "the record preserves kind:derived");
    assert.equal(rec.options.length, 2, "the record preserves both options");
    assert.ok(rec.options.every((o) => o.score !== undefined), "both preserved options carry scores");
    assert.equal(rec.choice, "cpp-httplib", "the record preserves the choice");

    // journals: some record references the decision.
    assert.ok(
      journal.records.some((r) => JSON.stringify(r).includes(out.decisionId)),
      "the accepted decision is journaled (references its id)",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.1-surface]
// ===========================================================================

test("[9.1-surface] writes questions.jsonl + blocks every named item; the run continues on the rest; journals", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    const runDir = runDirOf(store, runId);

    store.saveItem(runId, makeItem("I1"));
    store.saveItem(runId, makeItem("I2"));
    store.saveItem(runId, makeItem("I3")); // NOT named — must stay actionable.

    const out = handleSurface({
      store,
      runId,
      journal: journal.sink,
      now: () => START_MS,
      question: "Should unknown config keys fail the load, or collect and report?",
      blocksItems: ["I1", "I2"],
      askedBy: { role: "orchestrator", sessionID: "ses_orchestrator" },
      humanTerritory: false,
    });

    assert.match(out.questionId, /^Q-/, "surface mints a §2.11 question id");

    // questions.jsonl carries the surfaced question (origin surface-tool, the named blocks).
    const questions = readQuestions(runDir);
    const q = questions.find((x) => x.id === out.questionId);
    assert.ok(q !== undefined, "the surfaced question is persisted to questions.jsonl");
    assert.equal(q?.origin, "surface-tool", "a surface-tool question records its origin");
    assert.deepEqual([...(q?.blocksItems ?? [])].sort(), ["I1", "I2"], "the question records the items it blocks");
    assert.equal(q?.answeredIso, null, "a freshly surfaced question is open");

    // Every NAMED item is blocked on this question.
    const i1 = store.loadItem(runId, "I1");
    const i2 = store.loadItem(runId, "I2");
    assert.ok(i1.blocked !== null && i1.blocked.questionId === out.questionId, "I1 is blocked on the surfaced question");
    assert.ok(i2.blocked !== null && i2.blocked.questionId === out.questionId, "I2 is blocked on the surfaced question");
    assert.deepEqual([...out.blockedItemIds].sort(), ["I1", "I2"], "the result names exactly the blocked items");

    // The run CONTINUES on the rest: the un-named item stays actionable.
    const i3 = store.loadItem(runId, "I3");
    assert.equal(i3.blocked, null, "an un-named item is NOT blocked (the run continues on it)");
    assert.equal(i3.deferred, null, "an un-named item is not deferred either");
    assert.equal(i3.state, "PENDING", "an un-named item keeps its actionable FSM state");

    // journals: some record references the question.
    assert.ok(
      journal.records.some((r) => JSON.stringify(r).includes(out.questionId)),
      "the surface is journaled (references the question id)",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// [9.1-answer]
// ===========================================================================

test("[9.1-answer] clears exactly the bound items, marks answered, journals", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    const runDir = runDirOf(store, runId);

    // Two questions; Q1 blocks I1+I2, Q2 blocks I3; I4 is free.
    const q1 = appendQuestion(runDir, baseQ(runId, ["I1", "I2"], "collect or fail?"), START_MS);
    const q2 = appendQuestion(runDir, baseQ(runId, ["I3"], "different question?"), START_MS);
    store.saveItem(runId, makeItem("I1", { state: "RED", blocked: { reason: "q1", sinceMs: START_MS, questionId: q1.id, stage: "surface" } }));
    store.saveItem(runId, makeItem("I2", { state: "RED", blocked: { reason: "q1", sinceMs: START_MS, questionId: q1.id, stage: "surface" } }));
    store.saveItem(runId, makeItem("I3", { state: "RED", blocked: { reason: "q2", sinceMs: START_MS, questionId: q2.id, stage: "surface" } }));
    store.saveItem(runId, makeItem("I4", { state: "PENDING" }));

    const out = handleAnswer({ store, runId, journal: journal.sink, now: () => START_MS, questionId: q1.id, answer: "collect and report all", via: "tool" });

    // Exactly the items bound to Q1 are cleared — and no others.
    assert.deepEqual([...out.clearedItemIds].sort(), ["I1", "I2"], "answer clears exactly the items bound to the question");
    assert.equal(store.loadItem(runId, "I1").blocked, null, "I1 is unblocked");
    assert.equal(store.loadItem(runId, "I2").blocked, null, "I2 is unblocked");
    const i3 = store.loadItem(runId, "I3");
    assert.ok(i3.blocked !== null && i3.blocked.questionId === q2.id, "an item bound to a DIFFERENT question is untouched");
    assert.equal(store.loadItem(runId, "I4").blocked, null, "a never-blocked item is left alone");

    // The answered question is marked answered (clear-first, then mark — the C-018/C-020
    // wedge order, delegated to questions.answerQuestion). Q2 stays open.
    const questions = readQuestions(runDir);
    const answered = questions.find((x) => x.id === q1.id);
    const stillOpen = questions.find((x) => x.id === q2.id);
    assert.ok(answered?.answeredIso !== null && answered?.answeredIso !== undefined, "the answered question is stamped answered");
    assert.equal(answered?.answer, "collect and report all", "the answer is persisted on the question");
    assert.equal(stillOpen?.answeredIso, null, "an unrelated question stays open");

    // journals: some record references the answered question.
    assert.ok(
      journal.records.some((r) => JSON.stringify(r).includes(q1.id)),
      "the answer is journaled (references the question id)",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// A §2.11 question fixture for the answer test.
function baseQ(runId: string, blocksItems: string[], question: string): NewQuestion {
  return { runId, question, askedBy: { role: "orchestrator", sessionID: "ses_orchestrator" }, humanTerritory: false, origin: "surface-tool", blocksItems };
}

// ===========================================================================
// [9.1-defer]
// ===========================================================================

test("[9.1-defer] sets deferred + a decision record; report's precondition accepts the deferred item as settled", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    const runDir = runDirOf(store, runId);

    store.saveItem(runId, makeItem("I1", { state: "PENDING" }));

    const out = handleDefer({ store, runId, journal: journal.sink, now: () => START_MS, itemId: "I1", reason: "depends on an upstream migration not in scope this run" });

    // A §2.7 decision record explaining the deferral is appended and validates.
    const ledger = readDecisions(runDir);
    assert.equal(ledger.length, 1, "defer appends exactly one decision record");
    const rec = ledger[0];
    assert.equal(rec.id, out.decisionId, "the returned decisionId matches the persisted record");
    assert.equal(validate("DecisionRecord", rec).ok, true, "the deferral decision validates against the §2.7 schema");
    assert.ok(JSON.stringify(rec).includes("upstream migration"), "the decision record explains the deferral reason");

    // The item carries deferred:{reason, decisionId} linked to that record.
    const item = store.loadItem(runId, "I1");
    assert.ok(item.deferred !== null, "the item is deferred");
    assert.equal(item.deferred?.decisionId, out.decisionId, "the deferred annotation links the decision record");
    assert.match(item.deferred?.reason ?? "", /upstream migration/, "the deferred annotation carries the reason");

    // conductor_report's precondition (legalTools' isSettled) accepts a deferred item as a
    // settled disposition: an EXECUTING run whose ONLY item is deferred legalizes report.
    const gRun: GateRun = { state: "EXECUTING", stop: null, classification: { kind: "work" } };
    const gItem: GateItem = {
      id: "I1",
      state: item.state,
      behavioral: true,
      dependsOn: [],
      fileScope: ["src/a.ts"],
      blocked: item.blocked,
      deferred: item.deferred,
    };
    const verdict = legalTools(gRun, [gItem], [], true);
    assert.ok(verdict.legal.has("conductor_report"), "report's precondition accepts the deferred item as settled");

    // journals: some record references the deferral.
    assert.ok(
      journal.records.some((r) => JSON.stringify(r).includes(out.decisionId) || JSON.stringify(r).includes("I1")),
      "the deferral is journaled",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// Adversarial-review fixes (F1-F6 RED against the current handlers; F7 green now).
// Each reuses the helpers above; each test name carries its fix id.
// ===========================================================================

// ---------------------------------------------------------------------------
// F1 [9.1-fix-classify-escalate-work] (MAJOR): a classifier proposing "question"
// (trivialItem:null) plus a skeptic correcting to the stricter "trivial" is a spec-legal
// escalation (trivial > question), but there is NO trivialItem to synthesize. The handler
// must escalate FURTHER to work (classifier proposes, handler disposes) — never throw on a
// null trivialItem.
// ---------------------------------------------------------------------------

test("[9.1-fix-classify-escalate-work] a question→trivial correction with no trivialItem escalates further to work (does not throw)", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ trivialMaxFiles: 5, modelDefault: "test-model" });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);

    // classifier says "question" (no trivialItem); skeptic corrects to the STRICTER "trivial"
    // — which needs a trivialItem that does not exist, so the handler must dispose to work.
    const wiring = makeClassifyFanout(
      runId,
      config,
      journal.sink,
      makeClassification("question", null),
      makeCheck(false, "trivial", "this is not a pure question — there is code to change"),
    );

    let res: { kind: ClassificationKind; itemId: string | null; runState: RunState } | undefined;
    let threw: unknown;
    try {
      res = await handleClassify({ store, fanout: wiring.fanout, runId, config, journal: journal.sink });
    } catch (e) {
      threw = e;
    }

    assert.equal(threw, undefined, "a trivial correction with no trivialItem must NOT throw — it escalates to work");
    assert.ok(res !== undefined, "classify resolved with a result");
    assert.equal(res?.kind, "work", "an un-synthesizable trivial correction escalates further to work");
    assert.equal(res?.itemId, null, "an escalated work run synthesizes no item");
    assert.equal(res?.runState, "INTAKE", "an escalated work run stays in INTAKE");
    assert.ok(
      !existsSync(path.join(runDirOf(store, runId), "queue.json")),
      "no queue.json is written for an escalated work run",
    );
    assert.equal(store.loadRun(runId).classification.kind, "work", "run.json records the escalated kind work");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F2 [9.1-fix-surface-precheck] (MAJOR): §3.4 legality-before-persist. surface must verify
// EVERY named item exists before writing anything; a bad id must leave ZERO writes — no
// orphan question, no half-applied block. (The current handler appends the question and
// blocks the good item, then throws when it reaches the missing one.)
// ---------------------------------------------------------------------------

test("[9.1-fix-surface-precheck] surface verifies every named item exists BEFORE any write — a bad id leaves zero writes", () => {
  const root = scratchDir();
  try {
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    const runDir = runDirOf(store, runId);
    store.saveItem(runId, makeItem("I1")); // the ONLY item; IBOGUS does not exist.

    const err = expectThrow(
      () =>
        handleSurface({
          store,
          runId,
          journal: journal.sink,
          now: () => START_MS,
          question: "does the missing item matter?",
          blocksItems: ["I1", "IBOGUS"],
          askedBy: { role: "orchestrator", sessionID: "ses_orchestrator" },
          humanTerritory: false,
        }),
      "surface naming a nonexistent item",
    );
    assert.ok(err.message.length > 0, "the rejection carries a reason");

    // Zero writes: no orphan question, and the real item is NOT blocked.
    assert.equal(readQuestions(runDir).length, 0, "surface persisted NO question when a named item does not exist");
    assert.equal(store.loadItem(runId, "I1").blocked, null, "surface did not block the real item on the aborted call");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F3 [9.1-fix-defer-precheck] (MAJOR): defer must verify the item exists before appending
// the decision record — otherwise a bad id leaves an orphan decision (and advances the
// D- counter) with no item to point at it.
// ---------------------------------------------------------------------------

test("[9.1-fix-defer-precheck] defer verifies the item exists BEFORE appending the decision record — no orphan decision", () => {
  const root = scratchDir();
  try {
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    const runDir = runDirOf(store, runId);
    assert.equal(readDecisions(runDir).length, 0, "precondition: the decision ledger is empty (no items either)");

    const err = expectThrow(
      () =>
        handleDefer({
          store,
          runId,
          journal: journal.sink,
          now: () => START_MS,
          itemId: "IBOGUS",
          reason: "defer the item that is not there",
        }),
      "defer a nonexistent item",
    );
    assert.ok(err.message.length > 0, "the rejection carries a reason");
    assert.equal(
      readDecisions(runDir).length,
      0,
      "defer appended NO decision record when the item does not exist (no orphan, no advanced D- counter)",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F4 [9.1-fix-surface-humanterritory] (MAJOR): §2.11 defines humanTerritory as the
// core/decide.ts isHumanTerritory VERDICT, not a caller flag. The handler must compute it;
// a caller may force true but cannot force a human-territory question to false.
// ---------------------------------------------------------------------------

test("[9.1-fix-surface-humanterritory] surface persists humanTerritory as the core isHumanTerritory verdict, not the caller flag", () => {
  const root = scratchDir();
  try {
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    const runDir = runDirOf(store, runId);
    store.saveItem(runId, makeItem("I1"));
    store.saveItem(runId, makeItem("I2"));

    // Chosen against decide.ts HUMAN_PATTERNS: the money/subscription shape is human
    // territory; the derivable config question is not.
    const humanQ = "Should we buy the paid subscription tier for the hosted model?";
    const machineQ = "Should unknown config keys fail the whole load, or collect and report all?";
    // premise: the core classifier really does split these two the way this test assumes.
    assert.equal(isHumanTerritory(humanQ), true, "premise: the money/subscription question is human territory");
    assert.equal(isHumanTerritory(machineQ), false, "premise: the derivable config question is machine territory");

    // The caller passes humanTerritory:false for BOTH — the handler must OVERRIDE to the verdict.
    const hOut = handleSurface({
      store,
      runId,
      journal: journal.sink,
      now: () => START_MS,
      question: humanQ,
      blocksItems: ["I1"],
      askedBy: { role: "orchestrator", sessionID: "ses_orchestrator" },
      humanTerritory: false,
    });
    const mOut = handleSurface({
      store,
      runId,
      journal: journal.sink,
      now: () => START_MS,
      question: machineQ,
      blocksItems: ["I2"],
      askedBy: { role: "orchestrator", sessionID: "ses_orchestrator" },
      humanTerritory: false,
    });

    const questions = readQuestions(runDir);
    const hq = questions.find((x) => x.id === hOut.questionId);
    const mq = questions.find((x) => x.id === mOut.questionId);
    assert.ok(hq !== undefined && mq !== undefined, "both surfaced questions are persisted");
    assert.equal(hq?.humanTerritory, isHumanTerritory(humanQ), "the human-territory question persists the isHumanTerritory verdict, not the caller's false");
    assert.equal(hq?.humanTerritory, true, "the money/subscription question is recorded human-territory");
    assert.equal(mq?.humanTerritory, isHumanTerritory(machineQ), "the machine-territory question persists the isHumanTerritory verdict");
    assert.equal(mq?.humanTerritory, false, "the derivable config question is recorded machine-territory");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F5 [9.1-fix-classify-corrected-null-iff-agreed] (MINOR): a schema-valid but
// self-contradictory skeptic reply {agreed:false, correctedKind:null} must not break the
// result contract "correctedKind is null IFF agreed" and must escalate nothing (there is
// no actionable correction to escalate to).
// ---------------------------------------------------------------------------

test("[9.1-fix-classify-corrected-null-iff-agreed] a {agreed:false, correctedKind:null} skeptic reply keeps the null-iff-agreed invariant and escalates nothing", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ trivialMaxFiles: 5, modelDefault: "test-model" });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);

    // dissent without a correction: agreed:false yet no proposed kind.
    const wiring = makeClassifyFanout(
      runId,
      config,
      journal.sink,
      makeClassification("work", null),
      makeCheck(false, null, "vague dissent with no proposed kind"),
    );

    let res: { kind: ClassificationKind; agreed: boolean; correctedKind: ClassificationKind | null } | undefined;
    let threw: unknown;
    try {
      res = await handleClassify({ store, fanout: wiring.fanout, runId, config, journal: journal.sink });
    } catch (e) {
      threw = e;
    }

    assert.equal(threw, undefined, "a dissent-without-correction reply must not throw");
    assert.ok(res !== undefined, "classify resolved");
    assert.equal(
      res?.correctedKind === null,
      res?.agreed,
      "the null-iff-agreed invariant holds even for a {agreed:false, correctedKind:null} skeptic reply",
    );
    assert.equal(res?.kind, "work", "with no actionable correction the classifier's kind (work) stands — nothing escalated");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F6 [9.1-fix-decisions-torn-line] (MINOR): decide must tolerate a torn/malformed line in
// decisions.jsonl (a crash artifact) when minting the next id, instead of wedging on
// JSON.parse. (Read-back here is torn-tolerant, since the shared readDecisions helper is
// not — the point is the HANDLER survives the torn line.)
// ---------------------------------------------------------------------------

test("[9.1-fix-decisions-torn-line] decide tolerates a torn/malformed line in decisions.jsonl instead of wedging", () => {
  const root = scratchDir();
  try {
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    const runDir = runDirOf(store, runId);

    // One VALID prior decision (D-0001), then a torn half-written append line claiming D-0002.
    const d1: DecisionRecord = {
      id: "D-0001",
      tsIso: "2026-08-07T12:00:00Z",
      question: "seed decision",
      options: [
        { name: "a", score: { capability: 1, testability: 1, movingParts: 1, validationEarliness: 1, singleSource: 1 } },
        { name: "b", score: { capability: 2, testability: 2, movingParts: 2, validationEarliness: 2, singleSource: 2 } },
      ],
      choice: "b",
      why: "seed",
      kind: "derived",
      appliedWhere: "seed",
    };
    writeFileSync(path.join(runDir, "decisions.jsonl"), JSON.stringify(d1) + "\n" + '{"id":"D-0002","truncat' + "\n");

    const fullScore = { capability: 2, testability: 2, movingParts: 2, validationEarliness: 1, singleSource: 2 };
    const leanScore = { capability: 1, testability: 1, movingParts: 0, validationEarliness: 1, singleSource: 2 };

    let out: { decisionId: string } | undefined;
    let threw: unknown;
    try {
      out = handleDecide({
        store,
        runId,
        journal: journal.sink,
        now: () => START_MS,
        question: "next derived decision after a torn ledger line",
        options: [
          { name: "x", score: fullScore },
          { name: "y", score: leanScore },
        ],
        choice: "x",
        why: "torn-line tolerance",
        kind: "derived",
        appliedWhere: "src/note",
      });
    } catch (e) {
      threw = e;
    }

    assert.equal(threw, undefined, "decide must tolerate a torn decisions.jsonl line instead of crashing on JSON.parse");
    assert.ok(out !== undefined, "decide returned a result");
    assert.equal(out?.decisionId, "D-0003", "the next id is minted past the torn line's D-0002 (max seen + 1)");

    // Torn-tolerant read-back: the valid records include the seed and the appended one.
    const raw = readFileSync(path.join(runDir, "decisions.jsonl"), "utf8").split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    const records: DecisionRecord[] = [];
    for (const line of raw) {
      try {
        records.push(JSON.parse(line) as DecisionRecord);
      } catch {
        continue; // the torn crash-artifact line — exactly what decide had to skip
      }
    }
    assert.ok(records.some((r) => r.id === "D-0001"), "the prior valid decision survives");
    assert.ok(records.some((r) => r.id === "D-0003"), "the appended decision is present and readable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// F7 [9.1-fix-known-events] (hardening, green now): drive decide/defer/classify through the
// REAL journal (adapter/journal.ts), which THROWS on any event outside the closed §7.4
// vocabulary in dev/test — proving the Phase-9 names (decision.recorded, item.updated,
// fsm:transition) are all registered. This is the grep-test the §7.4 widening rule requires
// for the added "decision.recorded" name.
// ---------------------------------------------------------------------------

test("[9.1-fix-known-events] decide/defer/classify journal only closed-vocab §7.4 events (driven through the REAL throwing journal)", async () => {
  const root = scratchDir();
  try {
    const config = makeConfig({ trivialMaxFiles: 5, behavioralPaths: ["src/**"], modelDefault: "test-model" });
    const journal = makeJournal(); // loose sink for the store + fan-out internals
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    const runDir = runDirOf(store, runId);

    // The REAL journal throws on any event outside the closed §7.4 vocabulary in dev/test
    // (env carries no NODE_ENV=production), so an unlisted event name surfaces here as a throw.
    const realJournal = createJournal(runDir, config, {});

    const trivial = makeTrivialItem({ fileScope: ["src/widget.ts"], testScope: ["tests/widget.test.ts"], behavioral: true });
    const wiring = makeClassifyFanout(runId, config, journal.sink, makeClassification("trivial", trivial), makeCheck(true, null, "agrees trivial"));

    let res: { itemId: string | null } | undefined;
    let threw: unknown;
    try {
      // classify (INTAKE→EXECUTING transition + item creation) through the real journal.
      res = await handleClassify({ store, fanout: wiring.fanout, runId, config, journal: realJournal });
      // decide (decision.recorded) through the real journal.
      handleDecide({
        store,
        runId,
        journal: realJournal,
        now: () => START_MS,
        question: "a derived decision",
        options: [
          { name: "a", score: { capability: 2, testability: 2, movingParts: 2, validationEarliness: 1, singleSource: 2 } },
          { name: "b", score: { capability: 1, testability: 1, movingParts: 0, validationEarliness: 1, singleSource: 2 } },
        ],
        choice: "a",
        why: "closed-vocab drive",
        kind: "derived",
        appliedWhere: "src/note",
      });
      // defer (decision.recorded + item.updated) through the real journal.
      if (res.itemId !== null) {
        handleDefer({ store, runId, journal: realJournal, now: () => START_MS, itemId: res.itemId, reason: "defer via the real journal" });
      }
    } catch (e) {
      threw = e;
    }

    assert.equal(threw, undefined, "no handler emitted an event outside the closed §7.4 vocabulary (the real journal would have thrown)");
    assert.ok(res !== undefined && res.itemId !== null, "the trivial classify synthesized an item, so defer was exercised too");

    // The grep guarantee the §7.4 widening rule requires for the Phase-9 names.
    assert.equal(isKnownEvent("state", "decision.recorded"), true, "decision.recorded is in the closed state vocabulary");
    assert.equal(isKnownEvent("state", "item.updated"), true, "item.updated is in the closed state vocabulary");
    assert.equal(isKnownEvent("fsm", "transition"), true, "fsm:transition is in the closed vocabulary");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// C-054 [9.1-fix-surface-first-block-wins] (MAJOR): §2.5 gives an item exactly ONE
// `blocked` disposition, and conductor_answer keys the release on blocked.questionId. A
// second surfaced question that names an already-blocked item must therefore NOT overwrite
// the block: overwriting erases every trace of the first question from the item, so
// answering the SECOND one releases the item while the FIRST is still open and no longer
// reachable from any item (§2.11 forbids hand-editing state to resume).
//
// The rule is FIRST-BLOCK-WINS — the same rule the plan-review cap path already applies
// (adapter/tools.ts, "an item carries ONE `blocked` disposition, so the first surviving
// major that names it owns the block"): the later question is still appended and still
// records the item in its own blocksItems, the item keeps the block it already had, and
// the call's blockedItemIds names only the items THIS question actually blocked.
// ---------------------------------------------------------------------------

test("[9.1-fix-surface-first-block-wins] a second surfaced question naming an already-blocked item leaves the first block intact — answering the second does not release it, answering the first does", () => {
  const root = scratchDir();
  try {
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createIntakeRun(store);
    const runDir = runDirOf(store, runId);

    store.saveItem(runId, makeItem("I1")); // named by BOTH questions
    store.saveItem(runId, makeItem("I2")); // named by the second question only

    // Q1 blocks I1.
    const first = handleSurface({
      store,
      runId,
      journal: journal.sink,
      now: () => START_MS,
      question: "Should unknown config keys fail the load, or collect and report?",
      blocksItems: ["I1"],
      askedBy: { role: "orchestrator", sessionID: "ses_orchestrator" },
      humanTerritory: false,
    });

    // PREMISE: the fixture really is an item blocked on Q1 — the whole record, not just a
    // non-null field. Everything below compares against THIS exact object.
    const blockedOnQ1 = store.loadItem(runId, "I1").blocked;
    assert.ok(blockedOnQ1 !== null && blockedOnQ1 !== undefined, "premise: I1 is blocked after the first surface");
    assert.equal(blockedOnQ1?.questionId, first.questionId, "premise: I1's block names the FIRST question");
    assert.ok((blockedOnQ1?.reason ?? "").includes(first.questionId), "premise: I1's block reason names the first question id");
    const q1Snapshot = JSON.parse(JSON.stringify(blockedOnQ1)) as Record<string, unknown>;

    // Q2 names the already-blocked I1 AND the free I2.
    const journalBefore = journal.records.length;
    const second = handleSurface({
      store,
      runId,
      journal: journal.sink,
      now: () => START_MS + 60_000,
      question: "Should the retry budget be per-request or per-session?",
      blocksItems: ["I1", "I2"],
      askedBy: { role: "orchestrator", sessionID: "ses_orchestrator" },
      humanTerritory: false,
    });
    assert.notEqual(second.questionId, first.questionId, "premise: the second surface mints a DIFFERENT question id");

    // The ledger holds BOTH questions (floor on what the reads below inspected), and the
    // second one still records the item it names, so the linkage is never lost.
    const afterSurface = readQuestions(runDir);
    assert.equal(afterSurface.length, 2, "both surfaced questions are persisted (the scan below has two records to inspect)");
    const q2 = afterSurface.find((x) => x.id === second.questionId);
    assert.ok(q2 !== undefined, "the second question is in the ledger");
    assert.deepEqual([...(q2?.blocksItems ?? [])].sort(), ["I1", "I2"], "the second question still records BOTH items it names");

    // The already-blocked item keeps its FIRST block, byte for byte.
    assert.deepEqual(
      JSON.parse(JSON.stringify(store.loadItem(runId, "I1").blocked)) as Record<string, unknown>,
      q1Snapshot,
      "I1's blocked record is untouched by the second surface (reason, stage, sinceMs and questionId all still the first question's)",
    );
    // The free item IS blocked on the second question.
    const i2 = store.loadItem(runId, "I2");
    assert.ok(i2.blocked !== null && i2.blocked.questionId === second.questionId, "the previously-unblocked I2 is blocked on the second question");

    // The compact return must not CLAIM the item it did not block — a caller told "I1 is
    // blocked on Q2" would expect answering Q2 to release it.
    assert.deepEqual(second.blockedItemIds, ["I2"], "blockedItemIds names only the item this question actually blocked");
    assert.ok(
      !journal.records
        .slice(journalBefore)
        .some((r) => JSON.stringify(r).includes(second.questionId) && JSON.stringify(r.corr.itemId) === '"I1"'),
      "no journal record claims I1 was blocked on the second question",
    );

    // Answering the SECOND question releases only I2; I1 stays blocked on the still-open first.
    const ansSecond = handleAnswer({
      store,
      runId,
      journal: journal.sink,
      now: () => START_MS + 120_000,
      questionId: second.questionId,
      via: "tool",
      answer: "per-session",
    });
    assert.deepEqual(ansSecond.clearedItemIds, ["I2"], "answering the second question clears only the item it blocked");
    assert.deepEqual(
      JSON.parse(JSON.stringify(store.loadItem(runId, "I1").blocked)) as Record<string, unknown>,
      q1Snapshot,
      "I1 is STILL blocked on the first question after the second is answered",
    );
    const midLedger = readQuestions(runDir);
    assert.equal(midLedger.length, 2, "the ledger still holds both questions");
    assert.equal(
      midLedger.find((x) => x.id === first.questionId)?.answeredIso,
      null,
      "the first question is still OPEN — it was never answered, and the item still points at it",
    );

    // Answering the FIRST question is what finally releases I1.
    const ansFirst = handleAnswer({
      store,
      runId,
      journal: journal.sink,
      now: () => START_MS + 180_000,
      questionId: first.questionId,
      via: "tool",
      answer: "collect and report all",
    });
    assert.deepEqual(ansFirst.clearedItemIds, ["I1"], "answering the first question releases the item it blocked");
    assert.equal(store.loadItem(runId, "I1").blocked, null, "I1 is unblocked once its own question is answered");
    assert.equal(
      readQuestions(runDir).filter((x) => x.answeredIso === null).length,
      0,
      "both questions end answered — no question was stranded by the second surface",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
