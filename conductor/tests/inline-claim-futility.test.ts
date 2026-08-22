// conductor/tests/inline-claim-futility.test.ts — the §3.6 claim that can never
// license its own next step is refused where it is taken.
//
// The wedge this closes, measured from a live run: a trivial-classified run
// reached EXECUTING with one behavioral item at PENDING. The orchestrator took an
// inline claim over that item — a correctly reasoned, correctly scored §2.7
// decision — and was then DENIED by the G8 edit gate when it tried to write the
// failing test, because inlineClaimScopeFor grants entry.fileScope and nothing
// else, and the test file lives in testScope. Widening the scope through
// conductor_queue_amend was refused too, because §2.4 holds fileScope and
// testScope disjoint. Both refusals are individually correct; together they leave
// a claim with no legal route to the red its own pipeline demands, and the run
// spent 59% of its cell there and wrote nothing.
//
// The futility is STATICALLY PROVABLE at the moment the claim is taken:
//   - inlineClaimScopeFor returns [...entry.fileScope] and nothing else (§3.6),
//   - validateQueue guarantees fileScope is disjoint from testScope (§2.4),
//   - a behavioral item at PENDING advances only through conductor_submit_test,
//     whose red is written into testScope,
// therefore the claim cannot cover the one write its own next step needs.
//
// The rows below pin BOTH halves: the provable case is refused with nothing
// persisted, and the three claims that remain useful — a non-behavioral item, a
// behavioral item at RED, a behavioral item at TEST_VETTED, where implementation
// lands inside the fileScope the claim DOES grant — are still taken.

import { after, test } from "node:test";
import assert from "node:assert/strict";

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { handleInlineClaim } from "../adapter/tools.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import type { Config, Item, ItemState, Queue, QueueItem, RunState } from "../core/types.ts";

const START_MS = 1_755_600_000_000;
const SCOPE = "unitICF01";
const ORCH = "ses_orchestrator";

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
  return {
    records,
    sink: {
      log(level, component, event, data, corr): void {
        records.push({ level, component, event, data, corr });
      },
      flushSync(): void {
        /* nothing buffered */
      },
    },
  };
}

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function scratchDir(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `conductor-icf-${tag}-`));
  tmpDirs.push(dir);
  return dir;
}

function makeConfig(): Config {
  return {
    version: 1,
    verify: {
      scopes: { [SCOPE]: { command: [process.execPath, "-e", "0"], timeoutMs: 120_000 } },
      behavioralPaths: [],
      requiredScopes: [{ pattern: "**", scopes: [SCOPE] }],
    },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: 1,
      planReviewMaxRounds: 1,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: 1,
      vetMaxRounds: 1,
      testRepairAttempts: 1,
      debugFixCap: 1,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
    },
    parallel: { writes: "off", maxImplementers: 1, maxReaders: 1, subSessionTimeoutMs: 120_000 },
    models: { default: "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

function openStore(root: string, journal: JournalSink, config: Config): StateStore {
  const opts: OpenOptions = {
    root,
    config,
    journal,
    version: "0.0.0-test",
    sessionID: ORCH,
    now: () => START_MS,
    pid: process.pid,
    staleLockMs: 24 * 60 * 60 * 1000,
  };
  return openWorkspace(opts);
}

interface QueueOver {
  testScope?: string[];
  dependsOn?: string[];
}

function makeQueueItem(id: string, behavioral: boolean, over: QueueOver = {}): QueueItem {
  return {
    id,
    title: "keep the sign of negative offsets",
    rationale: "the parser drops the sign, so negative offsets read as positive ones",
    fileScope: [`src/${id}.mjs`],
    testScope: over.testScope ?? (behavioral ? [`tests/${id}.test.mjs`] : []),
    acceptance: ['parse("-7") returns -7'],
    behavioral,
    dependsOn: over.dependsOn ?? [],
    ponytail: {
      necessary: "the user's prompt asks for signed offsets",
      reuse: "checked the existing modules; nothing parses a signed offset",
      ladderRung: "minimal-code",
    },
  };
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

interface Bench {
  runId: string;
  runDir: string;
  store: StateStore;
  journal: { sink: JournalSink; records: CaptureRecord[] };
}

// Everything a row varies about the run the claim is taken in. The defaults are
// the analyzed path: an EXECUTING run holding one unblocked, dependency-free item.
interface BenchOver {
  runState?: RunState;
  blocked?: Item["blocked"];
  deferred?: Item["deferred"];
  dependsOn?: string[];
  testScope?: string[];
  // A second queue entry the item depends on, left unpublished.
  extraQueueItem?: QueueItem;
  extraItemState?: ItemState;
  // Drop the item's queue entry entirely: the shape a torn or hand-edited
  // queue.json leaves behind.
  omitQueueEntry?: boolean;
}

function makeBench(
  tag: string,
  itemId: string,
  behavioral: boolean,
  state: ItemState,
  over: BenchOver = {},
): Bench {
  const root = scratchDir(tag);
  const config = makeConfig();
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "tests"), { recursive: true });
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const run = store.createRun({
    prompt: "keep the sign",
    sessionID: ORCH,
    classification: { kind: "work", rationale: "behavioural", check: { agreed: true, note: "" } },
  });
  run.state = over.runState ?? "EXECUTING";
  store.saveRun(run);
  const runDir = path.join(store.root, ".conductor", "runs", run.runId);
  const entry = makeQueueItem(itemId, behavioral, {
    ...(over.dependsOn === undefined ? {} : { dependsOn: over.dependsOn }),
    ...(over.testScope === undefined ? {} : { testScope: over.testScope }),
  });
  const entries: QueueItem[] = over.omitQueueEntry === true ? [] : [entry];
  if (over.extraQueueItem !== undefined) entries.unshift(over.extraQueueItem);
  const queue: Queue = { items: entries };
  writeFileSync(path.join(runDir, "queue.json"), JSON.stringify(queue, null, 2));
  const item = makeRuntimeItem(itemId, state);
  if (over.blocked !== undefined) item.blocked = over.blocked;
  if (over.deferred !== undefined) item.deferred = over.deferred;
  store.saveItem(run.runId, item);
  if (over.extraQueueItem !== undefined) {
    store.saveItem(run.runId, makeRuntimeItem(over.extraQueueItem.id, over.extraItemState ?? "PENDING"));
  }
  return { runId: run.runId, runDir, store, journal };
}

// A §2.7-legal derived claim: two scored options, so nothing below can be refused
// for the decision's own shape.
function claimArgs(bench: Bench, itemId: string): Parameters<typeof handleInlineClaim>[0] {
  const score = {
    capability: 3,
    testability: 3,
    movingParts: 3,
    validationEarliness: 3,
    singleSource: 3,
  };
  return {
    store: bench.store,
    runId: bench.runId,
    journal: bench.journal.sink as unknown as Parameters<typeof handleInlineClaim>[0]["journal"],
    now: () => START_MS,
    itemId,
    reason: "dispatching a sub-session for a one-line change costs more than doing it",
    options: [
      { name: "dispatch an implementer sub-session", score },
      { name: "take the claim and edit inline", score: { ...score, movingParts: 5 } },
    ],
    choice: "take the claim and edit inline",
  };
}

function decisionLines(runDir: string): string[] {
  const ledger = path.join(runDir, "decisions.jsonl");
  if (!existsSync(ledger)) return [];
  return readFileSync(ledger, "utf8").split("\n").filter((line) => line.trim().length > 0);
}

// ---------------------------------------------------------------------------
// The refusal
// ---------------------------------------------------------------------------

test("[claim-futility-refused] a claim on a BEHAVIORAL item at PENDING is refused where it is taken: the claim grants fileScope only, the item's one legal next step writes a red into testScope, and §2.4 holds those disjoint — so the claim can never license its own next step", () => {
  const bench = makeBench("refused", "I1", true, "PENDING");

  assert.throws(
    () => handleInlineClaim(claimArgs(bench, "I1")),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      assert.match(
        message,
        /conductor_inline_claim/,
        "the refusal names the tool that refused, as every other handler refusal does",
      );
      assert.match(
        message,
        /conductor_submit_test/,
        "the refusal must name the way FORWARD (conductor_submit_test), or the orchestrator " +
          "is left exactly where the live run was: refused with no legal route stated",
      );
      assert.match(
        message,
        /testScope/,
        "and it must say WHY the claim cannot help — the red is written into testScope, which the " +
          "claim's fileScope grant does not and cannot cover",
      );
      return true;
    },
  );

  // Legality precedes persist (§3.4): a refused claim writes NOTHING.
  assert.deepEqual(
    decisionLines(bench.runDir),
    [],
    "a refused claim must leave NO ledger line — the decision was never taken",
  );
  assert.equal(
    bench.store.loadItem(bench.runId, "I1").inlineClaim,
    null,
    "and no §2.5 annotation: the item must be exactly as it was before the refused call",
  );
  assert.deepEqual(
    bench.journal.records.filter((record) => record.event === "decision.recorded"),
    [],
    "and no decision.recorded record, which would advertise a ledger line that does not exist",
  );
});

// ---------------------------------------------------------------------------
// The claims that stay legal — the narrowness of the refusal above
// ---------------------------------------------------------------------------

const ALLOWED: ReadonlyArray<{ tag: string; behavioral: boolean; state: ItemState; why: string }> = [
  {
    tag: "nonbehavioral",
    behavioral: false,
    state: "PENDING",
    why: "a non-behavioral item owes no red at all (§2.4): from PENDING it advances straight to GREEN, and that work lands inside the fileScope the claim grants",
  },
  {
    tag: "red",
    behavioral: true,
    state: "RED",
    why: "the red already exists; the next step is the vet fan-out, and the implementation that follows lands inside fileScope",
  },
  {
    tag: "vetted",
    behavioral: true,
    state: "TEST_VETTED",
    why: "past the red, the next step is implementation into fileScope — exactly what the claim covers",
  },
];

for (const row of ALLOWED) {
  test(`[claim-still-legal-${row.tag}] the futility refusal is NARROW: ${row.why}`, () => {
    const bench = makeBench(row.tag, "I1", row.behavioral, row.state);

    const result = handleInlineClaim(claimArgs(bench, "I1"));

    assert.equal(result.itemId, "I1");
    assert.match(result.decisionId, /^D-\d{4}$/, "the claim minted its §2.7 ledger id");
    assert.deepEqual(
      result.fileScope,
      ["src/I1.mjs"],
      "and the granted scope is read back through inlineClaimScopeFor, the ONE derivation the gate is fed from",
    );
    assert.equal(
      decisionLines(bench.runDir).length,
      1,
      "an accepted claim writes exactly one ledger line",
    );
    assert.deepEqual(
      bench.store.loadItem(bench.runId, "I1").inlineClaim,
      {
        reason: "dispatching a sub-session for a one-line change costs more than doing it",
        decisionId: result.decisionId,
      },
      "and the §2.5 annotation points at it",
    );
  });
}

// ---------------------------------------------------------------------------
// The refusal names an exit the caller ACTUALLY HAS
//
// gates-edit.ts holds the rule these rows enforce: a refusal that names an exit
// the caller does not have is worse than the deadlock it replaced, because the
// caller spends turns on a door that is locked from the other side. The futility
// above is real in every row below — a behavioral PENDING item's red is written
// into testScope wherever the run sits — but conductor_submit_test is legal for
// the item in exactly ONE of them, so it may be prescribed in exactly one.
// ---------------------------------------------------------------------------

const NO_SUBMIT_TEST: ReadonlyArray<{
  tag: string;
  why: string;
  over: BenchOver;
  names: RegExp;
}> = [
  {
    tag: "blocked",
    why: "a blocked item makes no transition at all (§3.3 annotations veto every edge), so conductor_submit_test is not legal for it and conductor_answer is the real exit",
    over: { blocked: { reason: "the acceptance criterion is ambiguous", sinceMs: START_MS, questionId: "Q-0001", stage: "RED" } },
    names: /blocked on question Q-0001/,
  },
  {
    tag: "deferred",
    why: "a deferred item makes no transition either, so nothing about submitting a test is available to the caller",
    over: { deferred: { reason: "out of scope for this run", decisionId: "D-0009" } },
    names: /deferred/,
  },
  {
    tag: "deps-unready",
    why: "a dependency-unready item is offered no stage tool at all (§4.2: nothing below PUBLISHED unlocks a dependent), so the exit is the unpublished dependency, not the test",
    over: {
      dependsOn: ["I0"],
      extraQueueItem: makeQueueItem("I0", false),
      extraItemState: "PENDING",
    },
    names: /dependency-UNREADY[\s\S]*I0/,
  },
  {
    tag: "pre-executing",
    why: "items exist at PENDING from DECOMPOSED onward, but no stage tool is legal until the run reaches EXECUTING (§3.2) — at PLANNED the run owes conductor_plan_review",
    over: { runState: "PLANNED" },
    names: /not EXECUTING/,
  },
];

for (const row of NO_SUBMIT_TEST) {
  test(`[claim-futility-exit-${row.tag}] the futility refusal names the REAL blocker rather than conductor_submit_test: ${row.why}`, () => {
    const bench = makeBench(`exit-${row.tag}`, "I1", true, "PENDING", row.over);

    assert.throws(
      () => handleInlineClaim(claimArgs(bench, "I1")),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        assert.match(message, /conductor_inline_claim/, "the refusal names the tool that refused");
        assert.match(
          message,
          row.names,
          "and it must name the blocker the caller can actually act on, derived from the SAME phase " +
            "gate the stage handler refuses through",
        );
        assert.doesNotMatch(
          message,
          /Call conductor_submit_test/,
          "it must NOT prescribe conductor_submit_test here: the phase gate does not offer it for this " +
            "item, so the refusal would send the caller into a second refusal — the exact failure " +
            "gates-edit.ts forbids",
        );
        return true;
      },
    );

    assert.deepEqual(decisionLines(bench.runDir), [], "and a refused claim still writes NO ledger line");
    assert.equal(bench.store.loadItem(bench.runId, "I1").inlineClaim, null, "and no §2.5 annotation");
  });
}

test("[claim-futility-exit-available] where conductor_submit_test IS the item's legal next step, the refusal prescribes it by name — the narrowness of the four rows above, which would otherwise be satisfied by a refusal that prescribes nothing at all", () => {
  const bench = makeBench("exit-available", "I1", true, "PENDING");

  assert.throws(
    () => handleInlineClaim(claimArgs(bench, "I1")),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      assert.match(
        message,
        /Call conductor_submit_test on "I1"/,
        "the analyzed path still gets its exit named, or the fix for the other four would be to say nothing",
      );
      return true;
    },
  );
});

test("[claim-futility-honest-promise] the refusal does not promise a saved sub-session: a claim buys the ORCHESTRATOR edit permission inside fileScope, and conductor_mark_green dispatches its implementer whether or not the item carries one", () => {
  const bench = makeBench("honest", "I1", true, "PENDING");

  assert.throws(
    () => handleInlineClaim(claimArgs(bench, "I1")),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      assert.match(
        message,
        /conductor_mark_green (still )?dispatches/,
        "handleMarkGreen calls dispatchImplementer before either branch, with no claim-aware guard, so a " +
          "refusal that points the caller at TEST_VETTED as the place a claim pays for itself is pointing " +
          "at a second futility",
      );
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// The claim that could grant nothing is refused, not recorded
// ---------------------------------------------------------------------------

test("[claim-no-queue-entry] a claim over an item with NO queue entry is refused: inlineClaimScopeFor derives its scope from that entry and fails closed without one, so accepting would spend a §2.7 ledger line and a §2.5 annotation on a claim that grants nothing", () => {
  const bench = makeBench("noentry", "I1", true, "PENDING", { omitQueueEntry: true });

  assert.throws(
    () => handleInlineClaim(claimArgs(bench, "I1")),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      assert.match(message, /conductor_inline_claim/);
      assert.match(
        message,
        /queue\.json/,
        "and it says WHERE the missing fact lives, so the caller can tell a torn queue from a wrong item id",
      );
      return true;
    },
  );

  assert.deepEqual(
    decisionLines(bench.runDir),
    [],
    "nothing is persisted: the fail-closed posture inlineClaimScopeFor already takes, taken one step earlier",
  );
  assert.equal(bench.store.loadItem(bench.runId, "I1").inlineClaim, null);
});

test("[claim-futility-empty-testscope] a behavioral entry whose testScope is empty renders no degenerate parenthetical — the refusal reads as a sentence, not as `testScope ()`", () => {
  const bench = makeBench("emptyscope", "I1", true, "PENDING", { testScope: [] });

  assert.throws(
    () => handleInlineClaim(claimArgs(bench, "I1")),
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      assert.doesNotMatch(
        message,
        /\(\)/,
        "an empty list must not be rendered as an empty pair of parentheses",
      );
      assert.match(message, /testScope/, "the reason is still stated");
      return true;
    },
  );
});
