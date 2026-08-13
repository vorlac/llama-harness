// Task 9.4a REVIEW-FIX tests — the defects the adversarial review of the 9.4a diff
// surfaced that the 11 authored tests structurally could not catch (C-032).
//
// Each row below is a DEFECT REPRODUCTION: it fails against the reviewed 9.4a
// implementation and passes only once the defect is fixed. Same harness shape as
// conductor/tests/tools-9.4a.test.ts (real on-disk fixture repos, real child
// `node --test` processes, real StateStore + evidence ledger; the FAKE SDK only
// stands in for sub-sessions), deliberately self-contained so neither file's
// helpers constrain the other.
//
// THE DEFECTS (survived N blind lenses -> K refute-biased skeptics):
//
//  D1  (major, found twice) adapter/evidence.ts computes `legalRed` — the §2.1
//      illegal-red rule, `isLegalClass(class) && (targeted || the excerpt names a
//      testScope file)` — for exactly the §3.3 case "a collection failure elsewhere
//      is NOT red". Both handlers DROPPED it, admitting the red on failureClass
//      alone, so a full-scope fallback run that failed somewhere else in the suite
//      was accepted as this item's RED. Reachable on any project whose verify scope
//      carries no §2.1 `itemTest` template (schema-optional) and via the zero-test
//      fallback. Rows: [C032-D1-*].
//
//  D2  (major, found twice) the vet's captured red was a property of the POINTER,
//      not of the test on disk. A mustFix repair that stopped being a red blocked
//      the item WITHOUT re-pointing or invalidating item.evidence.red, so after the
//      question was answered the next vet paired the PRE-repair red with the
//      POST-repair (passing) test, a clean critic round advanced RED->TEST_VETTED,
//      and TEST_VETTED->GREEN needs only exit 0 — a green item with no red ever
//      proven for the test it ships. The exact anchoring G6/P6 exist to prevent.
//      Row: [C032-D2-stale-red].
//
//  D3  (major) queue-declared `testScope` paths were dereferenced un-normalised in
//      BOTH directions: handed to the child test runner as argv, and read into
//      sub-session prompts. A `..` entry escaped the run's tree — the child
//      EXECUTED an out-of-repo file and its contents were streamed to the model.
//      queue.json is model-authored and core validateQueue never constrained path
//      SHAPE; the rest of the codebase takes the opposite posture (gates-edit
//      denies `..` before scope matching, state.assertSafeId, quarantine rejects
//      absolute paths). Row: [C032-D3-testscope-escape].
//
//  D4  (minor, REGRESSION FROM THIS DIFF) the 9.4a/5.3 depsReady binding made a
//      DEFERRED dependency wedge the run: dependents got no stage tool (unready)
//      and were not `isSettled`, so conductor_report was never legalized and
//      `recommended` was null — permanently. Before the binding the dependents were
//      still offered their stage tool, so the run could finish. Row:
//      [C032-D4-deferred-dep-wedge].
//
//  D5  (minor) capturedRedOf trusted the ledger unconditionally, feeding the critics
//      a §2.6.1 class-"error" record — the very class the submit side refuses as
//      "not a red" — as THE CAPTURED RED. Row: [C032-D5-illegal-class-red].
//
//  D6  (minor) item.attempts.{testRepairs,vetRounds} were ASSIGNED the current
//      call's local counter rather than accumulated, so the §2.5 attempts record
//      under-reported the item's real history. Row: [C032-D6-attempts-accumulate].
//
//  D7  (nit) a crash-torn trailing line in questions.jsonl killed the LEGALITY step
//      with a raw SyntaxError naming neither the tool nor the file — the shape
//      readQueueJson was explicitly written to avoid. Row: [C032-D7-torn-questions].
//
//  D8  (nit) fractional knobs (the §2.1 schema types them `number`; the subset
//      validator has no integer/minimum keyword) were consumed unnormalised, so
//      `repairs >= maxRepairs` with 1.5 spent 2 repairs — the budget rounded UP past
//      what was configured. Row: [C032-D8-fractional-budget].
//
//  D9  (minor) only ImplementerResult.status "BLOCKED" was handled; NEEDS_CONTEXT
//      was treated as a completed write, so a writer asking for context silently
//      burned a repair attempt per round and the question raised at exhaustion did
//      not relay what it asked for. Row: [C032-D9-needs-context].
//
// NOT FIXED HERE (recorded in docs/build/CORRECTIONS.md C-032 and raised at the
// Phase 9 MILESTONE gate, because each is a POLICY choice rather than a defect):
// the duplicated §4.2 readiness predicate (gate vs deny message), itemVerifyScope's
// scope-selection rule, the question/setBlocked crash window (same class as the
// C-031 parks), config-knob validation at load, the synchronous item-test run
// freezing the orchestrator's event loop, and the vet-roster-vs-plan-review
// fan-out floor disagreement.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { handleSubmitTest, handleVetTest } from "../adapter/tools.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { readQuestions, answerQuestion } from "../adapter/questions.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, TreeState } from "../adapter/fanout.ts";
import { legalTools } from "../core/gates-phase.ts";
import type { GateItem, GateRun } from "../core/gates-phase.ts";
import type { Config, EvidenceRecord, Item, ItemState, Queue, QueueItem } from "../core/types.ts";
import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

// ---------------------------------------------------------------------------
// Markers + fixture sources
// ---------------------------------------------------------------------------

const START_MS = 1_754_560_000_000;
const USER_PROMPT = "make the beta parser keep the sign of negative offsets";

const UNRELATED_MARKER = "UNRELATED-SUITE-FAILURE-4711";
const RED_MARKER = "REVIEW-SEEDED-RED-9330";
const OUTSIDE_MARKER = "SECRET-OUTSIDE-THE-REPO-8811";
const NEEDED_CONTEXT = "which module owns the sign convention? NEEDED-CONTEXT-MARKER-6614";
const BROKEN_TOKEN = "BROKEN_TEST_MARKER_5521";

const PROD_PARSER = "export function parse(text) {\n  return Math.abs(Number(text));\n}\n";

// A test that RUNS and fails its assertion → §2.6.1 class "assertion".
function assertionTest(marker: string): string {
  return (
    `// ${marker}\n` +
    'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\n' +
    'import { parse } from "../src/parser.mjs";\n' +
    'test("t", () => {\n' +
    '  assert.equal(parse("-7"), -7, "sign");\n' +
    "});\n"
  );
}

// A test that PASSES immediately (exit 0) — never a red.
function passingTest(marker: string): string {
  return (
    `// ${marker}\n` +
    'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\n' +
    'import { parse } from "../src/parser.mjs";\n' +
    'test("t", () => {\n' +
    '  assert.equal(parse("7"), 7);\n' +
    "});\n"
  );
}

// A test that is itself BROKEN — a syntax error → §2.6.1 class "error", not a red.
function brokenTest(marker: string): string {
  return `// ${marker}\nimport test from "node:test";\nconst ${BROKEN_TOKEN} = ;\ntest("t", () => {});\n`;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

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
function makeJournal(): JournalSink {
  return { log: (): void => {}, flushSync: (): void => {} };
}

function makeTree(): TreeState {
  return {
    isFrozen(): boolean {
      return false;
    },
    onClear(): () => void {
      return () => undefined;
    },
  };
}

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

// `itemTest` present  → the TARGETED run §3.3 depends on.
// `itemTest` omitted  → the full-scope fallback (schema-legal: §2.1 requires only
//                       command + timeoutMs), which is D1's whole subject.
function makeConfig(
  opts: {
    vetCritics?: number;
    vetMaxRounds?: number;
    testRepairAttempts?: number;
    maxReaders?: number;
    itemTest?: boolean;
    fullCommand?: string[];
  } = {},
): Config {
  const unit: Config["verify"]["scopes"][string] = {
    command: opts.fullCommand ?? [process.execPath, "--test", "tests/other.test.mjs"],
    timeoutMs: 120_000,
    ...(opts.itemTest === false ? {} : { itemTest: [process.execPath, "--test", "{files}"] }),
  };
  return {
    version: 1,
    verify: {
      scopes: { unit },
      behavioralPaths: ["src/**"],
      requiredScopes: [{ pattern: "**", scopes: ["unit"] }],
    },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: 4,
      planReviewMaxRounds: 1,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: opts.vetCritics ?? 1,
      vetMaxRounds: opts.vetMaxRounds ?? 2,
      testRepairAttempts: opts.testRepairAttempts ?? 2,
      debugFixCap: 3,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
    },
    parallel: { writes: "off", maxImplementers: 4, maxReaders: opts.maxReaders ?? 2, subSessionTimeoutMs: 120_000 },
    models: { default: "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

function scratchRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-94a-rev-"));
  tmpDirs.push(dir);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "src", "parser.mjs"), PROD_PARSER);
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

function createRunFor(store: StateStore): string {
  return store.createRun({
    prompt: USER_PROMPT,
    sessionID: "ses_orchestrator",
    classification: {
      kind: "work",
      rationale: "the prompt asks for a behavioural change",
      check: { agreed: true, note: "" },
    },
  }).runId;
}

function runDirOf(store: StateStore, runId: string): string {
  return path.join(store.root, ".conductor", "runs", runId);
}

function makeRuntimeItem(id: string, state: ItemState): Item {
  return {
    id,
    state,
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

function makeQueueItem(
  id: string,
  over: { fileScope: string[]; testScope: string[]; behavioral?: boolean; dependsOn?: string[] },
): QueueItem {
  return {
    id,
    title: "keep the sign of negative offsets",
    rationale: "the parser drops the sign, so negative offsets read as positive ones",
    fileScope: [...over.fileScope],
    testScope: [...over.testScope],
    acceptance: ['parse("-7") returns -7'],
    behavioral: over.behavioral ?? true,
    dependsOn: [...(over.dependsOn ?? [])],
    ponytail: {
      necessary: "the user's prompt asks for signed offsets",
      reuse: "checked the existing modules; nothing parses a signed offset",
      ladderRung: "minimal-code",
    },
  };
}

function seedExecuting(
  store: StateStore,
  runId: string,
  queue: Queue,
  states: Record<string, ItemState> = {},
): void {
  const run = store.loadRun(runId);
  run.state = "EXECUTING";
  store.saveRun(run);
  writeFileSync(path.join(runDirOf(store, runId), "queue.json"), JSON.stringify(queue, null, 2));
  for (const qi of queue.items) store.saveItem(runId, makeRuntimeItem(qi.id, states[qi.id] ?? "PENDING"));
}

// A §2.6 red hand-written to the ledger, with the item's pointer aimed at it.
function seedRedEvidence(
  store: StateStore,
  runId: string,
  itemId: string,
  over: { failureClass?: string } = {},
): EvidenceRecord {
  const record = {
    seq: 1,
    ts: START_MS,
    kind: "red",
    itemId,
    command: [process.execPath, "--test", "tests/p.test.mjs"],
    exitCode: 1,
    failureExcerpt: `AssertionError [ERR_ASSERTION]: ${RED_MARKER}\n\n7 !== -7`,
    failureClass: over.failureClass ?? "assertion",
    targeted: true,
  } as unknown as EvidenceRecord;
  writeFileSync(path.join(runDirOf(store, runId), "evidence.jsonl"), JSON.stringify(record) + "\n");
  const item = store.loadItem(runId, itemId);
  item.evidence.red = { ledger: "evidence.jsonl", seq: 1 };
  store.saveItem(runId, item);
  return record;
}

function readEvidence(runDir: string): EvidenceRecord[] {
  const file = path.join(runDir, "evidence.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EvidenceRecord);
}

function implJson(status = "DONE", over: { neededContext?: string } = {}): string {
  return JSON.stringify({
    status,
    summary: "wrote the item test",
    concerns: [],
    neededContext: over.neededContext ?? null,
    blockReason: null,
  });
}

function vetJson(mustFix: string[]): string {
  const clean = mustFix.length === 0;
  const verdict = (note: string): { pass: boolean; note: string } => ({ pass: clean, note });
  return JSON.stringify({
    verdictsByCriterion: {
      observableBehavior: verdict("asserts the returned value"),
      wouldCatchWrongImpl: verdict("a sign-dropping implementation still fails it"),
      rightLevel: verdict("unit level is right for a pure function"),
      pinsAcceptance: verdict("pins this item's acceptance criterion"),
      antiPatterns: verdict("no mock-testing, no tautology"),
    },
    mustFix: [...mustFix],
  });
}

type CannedReply = string | ((promptText: string) => string);
interface RoleScript {
  testWriter: CannedReply[];
  reviewer: CannedReply[];
}
interface PromptedRecord {
  role: string;
  text: string;
}
interface Wiring {
  fanout: Fanout;
  prompted: PromptedRecord[];
  byRole: (role: string) => PromptedRecord[];
}
function makeWiring(runId: string, config: Config, journal: JournalSink, script: RoleScript): Wiring {
  const registry = new Map<string, { role: string; itemId: string; tree: string }>();
  const sdk = makeFakeSdk({ registry });
  const prompted: PromptedRecord[] = [];
  const sessionIdx = new Map<string, number>();
  const nextByRole = new Map<string, number>();
  sdk.setResponder((req) => {
    const role = req.entry?.role ?? "";
    prompted.push({ role, text: req.text });
    const queue = role === "testWriter" ? script.testWriter : role === "reviewer" ? script.reviewer : [];
    if (queue.length === 0) return { kind: "reply", text: `UNSCRIPTED ROLE ${role}` };
    let idx = sessionIdx.get(req.sessionID);
    if (idx === undefined) {
      idx = nextByRole.get(role) ?? 0;
      nextByRole.set(role, idx + 1);
      sessionIdx.set(req.sessionID, idx);
    }
    const canned = queue[Math.min(idx, queue.length - 1)];
    return { kind: "reply", text: typeof canned === "function" ? canned(req.text) : canned };
  });
  const fanout = createFanout(
    sdk.client,
    config,
    journal as unknown as Parameters<typeof createFanout>[2],
    registry,
    makeTree(),
    runId,
  );
  return { fanout, prompted, byRole: (role: string) => prompted.filter((p) => p.role === role) };
}

function writerWrites(repo: string, rel: string, content: string): CannedReply {
  return (): string => {
    const target = path.join(repo, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    return implJson();
  };
}

// ---------------------------------------------------------------------------
// D1 — a fallback red that failed SOMEWHERE ELSE is not this item's red
// ---------------------------------------------------------------------------

test("[C032-D1-fallback-red-refused] a non-targeted full-scope failure naming no testScope file is NOT admitted as the item's RED", async () => {
  const root = scratchRepo();
  // The verify scope carries NO itemTest template, so runTest falls back to the full
  // scope command — which runs a REAL node --test over an unrelated suite that fails
  // its own assertion. §2.6.1 class is "assertion" (legal), exit is 1, and the item's
  // own test is never executed: the classic "collection failure elsewhere" §3.3 names.
  writeFileSync(
    path.join(root, "tests", "other.test.mjs"),
    'import test from "node:test";\n' +
      'import assert from "node:assert/strict";\n' +
      `test("unrelated", () => {\n  assert.equal(1, 2, "${UNRELATED_MARKER}");\n});\n`,
  );
  const config = makeConfig({ itemTest: false, testRepairAttempts: 0 });
  const journal = makeJournal();
  const store = openStore(root, journal, config);
  const runId = createRunFor(store);
  const queue: Queue = {
    items: [makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] })],
  };
  seedExecuting(store, runId, queue);

  // The writer's test itself is fine — irrelevant, since the fallback never runs it.
  const wiring = makeWiring(runId, config, journal, {
    testWriter: [writerWrites(root, "tests/p.test.mjs", assertionTest("V1"))],
    reviewer: [],
  });

  const result = await handleSubmitTest({
    store,
    fanout: wiring.fanout,
    runId,
    itemId: "I1",
    config,
    journal,
    now: () => START_MS,
  });

  const item = store.loadItem(runId, "I1");
  const runDir = runDirOf(store, runId);
  const red = readEvidence(runDir).find((r) => r.kind === "red");
  assert.ok(red !== undefined, "the run DID append a §2.6.1-legal-class red (the premise of the defect)");
  assert.equal(
    (red as unknown as { targeted: boolean }).targeted,
    false,
    "the premise: the run fell back to the full verify scope, so it is not targeted",
  );

  assert.equal(result.ok, false, "a failure somewhere else in the suite is not this item's red (§3.3)");
  assert.equal(item.state, "PENDING", "the item does NOT advance on somebody else's red");
  assert.equal(item.evidence.red, undefined, "no §2.6 pointer is written for a red the item did not earn");
  assert.ok(result.questionId !== null, "the stage stops with ONE §2.11 question, as at any other repair exhaustion");
  const questions = readQuestions(runDir);
  assert.equal(questions.length, 1, "exactly one question");
  assert.ok(
    /fell back|full verify scope|names none of|not targeted/i.test(questions[0].question),
    "the question SAYS the run fell back / named no testScope file, so the reader can act on it: " +
      questions[0].question,
  );
  assert.notEqual(item.blocked, null, "the item carries blocked:{stage:'RED'} with the question id");
});

// ---------------------------------------------------------------------------
// D2 — the captured red is a property of the TEST ON DISK, not of the pointer
// ---------------------------------------------------------------------------

test("[C032-D2-stale-red] a vet re-entered after a repair cannot advance a PASSING test on the pre-repair red", async () => {
  const root = scratchRepo();
  const config = makeConfig({ vetCritics: 1, vetMaxRounds: 2 });
  const journal = makeJournal();
  const store = openStore(root, journal, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  const queue: Queue = {
    items: [makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] })],
  };
  seedExecuting(store, runId, queue, { I1: "RED" });
  writeFileSync(path.join(root, "tests", "p.test.mjs"), assertionTest("V1"));
  seedRedEvidence(store, runId, "I1");

  // Call 1: round 1 raises a mustFix; the writer "repairs" the test into one that
  // PASSES, so the re-run is no longer a red and the stage stops with a question.
  const first = makeWiring(runId, config, journal, {
    testWriter: [writerWrites(root, "tests/p.test.mjs", passingTest("V2"))],
    reviewer: [vetJson(["MUSTFIX-A: assert the returned value"])],
  });
  const call1 = await handleVetTest({
    store,
    fanout: first.fanout,
    runId,
    itemId: "I1",
    config,
    journal,
    now: () => START_MS,
  });
  assert.equal(call1.ok, false, "the repaired test passes, so the vet stops (the 9.4a contract)");
  assert.ok(call1.questionId !== null, "with ONE §2.11 question");
  assert.equal(store.loadItem(runId, "I1").state, "RED", "the item stays at RED");

  // The human answers, which clears `blocked` — the ONLY supported way to resume.
  answerQuestion(runDir, call1.questionId as string, "rewrite the test so it pins the sign", START_MS + 1000);
  assert.equal(store.loadItem(runId, "I1").blocked, null, "answering unblocks the item");

  // Call 2: the critics are CLEAN. The test on disk still passes, so there is no red
  // for them to have judged it against — the item must NOT reach TEST_VETTED.
  const second = makeWiring(runId, config, journal, {
    testWriter: [writerWrites(root, "tests/p.test.mjs", passingTest("V2"))],
    reviewer: [vetJson([])],
  });
  const call2 = await handleVetTest({
    store,
    fanout: second.fanout,
    runId,
    itemId: "I1",
    config,
    journal,
    now: () => START_MS + 2000,
  }).catch((error: unknown) => error as Error);

  const item = store.loadItem(runId, "I1");
  assert.notEqual(
    item.state,
    "TEST_VETTED",
    "a test that PASSES can never be vetted: TEST_VETTED->GREEN needs only exit 0, so this would " +
      "publish an item whose shipped test never had a red (G6)",
  );
  assert.equal(item.state, "RED", "the item stays where it was");
  if (!(call2 instanceof Error)) {
    assert.equal(call2.ok, false, "and the call does not report success");
  }
  // Whatever exit it takes, the critics must not have been shown the stale red beside
  // the passing test — that pairing is the defect itself.
  const criticPrompts = second.byRole("reviewer").map((p) => p.text);
  for (const prompt of criticPrompts) {
    assert.ok(
      !prompt.includes(RED_MARKER),
      "no critic is handed the PRE-repair red to judge the POST-repair test against",
    );
  }
});

// ---------------------------------------------------------------------------
// D3 — testScope may not escape the run's tree
// ---------------------------------------------------------------------------

test("[C032-D3-testscope-escape] a testScope entry that escapes the repo is refused before anything is dispatched or spawned", async () => {
  const root = scratchRepo();
  // An out-of-tree file that PROVES execution by writing a sentinel, and proves
  // exfiltration by carrying a marker no prompt may ever contain.
  const outsideDir = path.join(root, "..", `probe-outside-${process.pid}`);
  mkdirSync(outsideDir, { recursive: true });
  tmpDirs.push(outsideDir);
  const sentinel = path.join(outsideDir, "executed.sentinel");
  writeFileSync(
    path.join(outsideDir, "leak.test.mjs"),
    `// ${OUTSIDE_MARKER}\n` +
      'import { writeFileSync } from "node:fs";\n' +
      `writeFileSync(${JSON.stringify(sentinel)}, "executed");\n` +
      'import test from "node:test";\ntest("t", () => {});\n',
  );
  const escaping = path.join("..", path.basename(outsideDir), "leak.test.mjs");

  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal, config);
  const runId = createRunFor(store);
  const queue: Queue = {
    items: [makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: [escaping] })],
  };
  seedExecuting(store, runId, queue);

  const wiring = makeWiring(runId, config, journal, {
    testWriter: [writerWrites(root, "tests/p.test.mjs", assertionTest("V1"))],
    reviewer: [],
  });

  const error = await handleSubmitTest({
    store,
    fanout: wiring.fanout,
    runId,
    itemId: "I1",
    config,
    journal,
    now: () => START_MS,
  }).then(
    () => null,
    (err: unknown) => err as Error,
  );

  assert.ok(error instanceof Error, "the stage REFUSES an escaping testScope (P7: a deny is a throw)");
  assert.ok(
    /escape|outside|\.\.|traversal/i.test(error.message),
    "and says why, naming the offending shape: " + error.message,
  );
  assert.equal(existsSync(sentinel), false, "the out-of-tree file is NEVER executed by the child test runner");
  assert.equal(wiring.prompted.length, 0, "nothing is dispatched — the refusal precedes every sub-session");
  for (const record of wiring.prompted) {
    assert.ok(!record.text.includes(OUTSIDE_MARKER), "and no out-of-repo content reaches a model prompt");
  }
});

// ---------------------------------------------------------------------------
// D4 — a deferred dependency must not wedge the run (regression from the binding)
// ---------------------------------------------------------------------------

test("[C032-D4-deferred-dep-wedge] an item stalled behind a DEFERRED dependency counts as settled, so the run can still report", () => {
  const run: GateRun = { state: "EXECUTING", stop: null, classification: { kind: "work" } };
  const items: GateItem[] = [
    {
      id: "I1",
      state: "PENDING",
      behavioral: true,
      dependsOn: [],
      fileScope: ["src/a.mjs"],
      blocked: null,
      deferred: { reason: "the user deferred this item" },
    },
    {
      id: "I2",
      state: "PENDING",
      behavioral: true,
      dependsOn: ["I1"],
      fileScope: ["src/b.mjs"],
      blocked: null,
      deferred: null,
    },
  ];

  const verdict = legalTools(run, items, [], true);

  assert.equal(
    verdict.legal.has("conductor_submit_test"),
    false,
    "the 9.4a/5.3 binding still holds: I2's dependency is not PUBLISHED, so no stage tool is offered",
  );
  assert.ok(
    verdict.legal.has("conductor_report"),
    "but the run is NOT wedged: I2 can never become schedulable, so the §3.2 report precondition is met " +
      "(without this, the run has no legal exit at all and `recommended` is null forever)",
  );
  assert.ok(verdict.recommended !== null, "and the continuation engine has something to recommend");
  assert.equal(verdict.recommended?.tool, "conductor_report", "namely the report that closes the run");
});

// ---------------------------------------------------------------------------
// D5 — a class-"error" ledger record is not a red the critics may judge against
// ---------------------------------------------------------------------------

test("[C032-D5-illegal-class-red] the vet refuses to judge a test against a §2.6.1 class-\"error\" record", async () => {
  const root = scratchRepo();
  const config = makeConfig({ vetCritics: 1 });
  const journal = makeJournal();
  const store = openStore(root, journal, config);
  const runId = createRunFor(store);
  const queue: Queue = {
    items: [makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] })],
  };
  seedExecuting(store, runId, queue, { I1: "RED" });
  writeFileSync(path.join(root, "tests", "p.test.mjs"), assertionTest("V1"));
  // The ONLY red on the ledger is one the SUBMIT side would have refused outright.
  seedRedEvidence(store, runId, "I1", { failureClass: "error" });

  const wiring = makeWiring(runId, config, journal, { testWriter: [], reviewer: [vetJson([])] });

  const outcome = await handleVetTest({
    store,
    fanout: wiring.fanout,
    runId,
    itemId: "I1",
    config,
    journal,
    now: () => START_MS,
  }).then(
    (value) => value,
    (err: unknown) => err as Error,
  );

  const item = store.loadItem(runId, "I1");
  assert.notEqual(
    item.state,
    "TEST_VETTED",
    "a broken test is not a red (§2.6.1), so it cannot be vetted into TEST_VETTED either",
  );
  if (outcome instanceof Error) {
    assert.ok(
      /class|error|red/i.test(outcome.message),
      "the refusal names what is wrong with the evidence: " + outcome.message,
    );
  } else {
    assert.equal(outcome.ok, false, "or the stage stops with the blocked+question shape");
  }
  for (const record of wiring.byRole("reviewer")) {
    assert.ok(
      !record.text.includes(RED_MARKER),
      "no critic is handed the illegal-class record as THE CAPTURED RED",
    );
  }
});

// ---------------------------------------------------------------------------
// D6 — §2.5 attempts are the ITEM's history, not the last call's
// ---------------------------------------------------------------------------

test("[C032-D6-attempts-accumulate] item.attempts.testRepairs accumulates across calls rather than being overwritten", async () => {
  const root = scratchRepo();
  const config = makeConfig({ testRepairAttempts: 1 });
  const journal = makeJournal();
  const store = openStore(root, journal, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  const queue: Queue = {
    items: [makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] })],
  };
  seedExecuting(store, runId, queue);

  // The writer is broken forever: every call spends its whole repair budget.
  const script = (): RoleScript => ({
    testWriter: [writerWrites(root, "tests/p.test.mjs", brokenTest("BROKEN"))],
    reviewer: [],
  });

  const first = makeWiring(runId, config, journal, script());
  const call1 = await handleSubmitTest({
    store,
    fanout: first.fanout,
    runId,
    itemId: "I1",
    config,
    journal,
    now: () => START_MS,
  });
  assert.equal(call1.ok, false, "a class-\"error\" test is never a red");
  assert.equal(store.loadItem(runId, "I1").attempts.testRepairs, 1, "call 1 spent its one repair");

  answerQuestion(runDir, call1.questionId as string, "write it as a plain assertion", START_MS + 1000);

  const second = makeWiring(runId, config, journal, script());
  await handleSubmitTest({
    store,
    fanout: second.fanout,
    runId,
    itemId: "I1",
    config,
    journal,
    now: () => START_MS + 2000,
  });

  assert.equal(
    store.loadItem(runId, "I1").attempts.testRepairs,
    2,
    "§2.5 attempts record the ITEM's real history — two repairs have now been spent on it, and a " +
      "counter that reads 1 hides half of what this item cost",
  );
});

// ---------------------------------------------------------------------------
// D7 — a torn questions.jsonl line is a NAMED legality failure
// ---------------------------------------------------------------------------

test("[C032-D7-torn-questions] a crash-torn questions.jsonl line fails legality by name, not with a raw SyntaxError", async () => {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  const queue: Queue = {
    items: [makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] })],
  };
  seedExecuting(store, runId, queue);
  // Exactly what an interrupted append leaves behind.
  appendFileSync(path.join(runDir, "questions.jsonl"), '{"id":"Q-0002","tsMs":1754');

  const wiring = makeWiring(runId, config, journal, {
    testWriter: [writerWrites(root, "tests/p.test.mjs", assertionTest("V1"))],
    reviewer: [],
  });

  const error = await handleSubmitTest({
    store,
    fanout: wiring.fanout,
    runId,
    itemId: "I1",
    config,
    journal,
    now: () => START_MS,
  }).then(
    () => null,
    (err: unknown) => err as Error,
  );

  assert.ok(error instanceof Error, "the torn line still stops the stage");
  assert.ok(
    error.message.includes("conductor_submit_test"),
    "but the failure names the TOOL, so the reader knows what refused: " + error.message,
  );
  assert.ok(
    error.message.includes("questions.jsonl"),
    "and names the FILE that needs repair: " + error.message,
  );
  assert.equal(wiring.prompted.length, 0, "and nothing was dispatched");
});

// ---------------------------------------------------------------------------
// D8 — a fractional budget is never rounded UP
// ---------------------------------------------------------------------------

test("[C032-D8-fractional-budget] a fractional testRepairAttempts spends no more repairs than the whole number below it", async () => {
  const root = scratchRepo();
  const config = makeConfig({ testRepairAttempts: 1.5 });
  const journal = makeJournal();
  const store = openStore(root, journal, config);
  const runId = createRunFor(store);
  const queue: Queue = {
    items: [makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] })],
  };
  seedExecuting(store, runId, queue);

  const wiring = makeWiring(runId, config, journal, {
    testWriter: [writerWrites(root, "tests/p.test.mjs", brokenTest("BROKEN"))],
    reviewer: [],
  });

  const result = await handleSubmitTest({
    store,
    fanout: wiring.fanout,
    runId,
    itemId: "I1",
    config,
    journal,
    now: () => START_MS,
  });

  assert.equal(
    result.attempts,
    2,
    "1 initial write + floor(1.5) = 1 repair. Spending 2 repairs would be a budget the operator " +
      "never configured — the knob rounds DOWN, never up",
  );
  assert.equal(store.loadItem(runId, "I1").attempts.testRepairs, 1, "and the item records the one repair");
});

// ---------------------------------------------------------------------------
// D9 — NEEDS_CONTEXT is a stop-and-ask, not a completed write
// ---------------------------------------------------------------------------

test("[C032-D9-needs-context] a writer that replies NEEDS_CONTEXT stops the stage and relays what it asked for", async () => {
  const root = scratchRepo();
  const config = makeConfig({ testRepairAttempts: 3 });
  const journal = makeJournal();
  const store = openStore(root, journal, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  const queue: Queue = {
    items: [makeQueueItem("I1", { fileScope: ["src/parser.mjs"], testScope: ["tests/p.test.mjs"] })],
  };
  seedExecuting(store, runId, queue);

  const wiring = makeWiring(runId, config, journal, {
    testWriter: [implJson("NEEDS_CONTEXT", { neededContext: NEEDED_CONTEXT })],
    reviewer: [],
  });

  const result = await handleSubmitTest({
    store,
    fanout: wiring.fanout,
    runId,
    itemId: "I1",
    config,
    journal,
    now: () => START_MS,
  });

  assert.equal(result.ok, false, "a writer that needs context did not produce a red");
  assert.equal(
    result.attempts,
    1,
    "and is not asked to repair blind: re-running an identical prompt cannot supply what it asked " +
      "for, so the budget is not burned one round at a time",
  );
  assert.ok(result.questionId !== null, "the stage stops with ONE §2.11 question");
  const questions = readQuestions(runDir);
  assert.equal(questions.length, 1, "exactly one question");
  assert.ok(
    questions[0].question.includes(NEEDED_CONTEXT),
    "which RELAYS what the writer actually asked for — otherwise the human is asked to unblock a " +
      "stage without being told what is missing: " + questions[0].question,
  );
  assert.notEqual(store.loadItem(runId, "I1").blocked, null, "and the item is blocked with an unblock path");
});
