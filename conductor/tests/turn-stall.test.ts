// conductor/tests/turn-stall.test.ts — the no-progress detector that does not
// depend on idleness.
//
// THE HOLE THIS FILE CLOSES. §3.7's futile re-prompt limit is the only wedge
// detector the design has, and it is sampled in exactly one place:
// handleSessionIdle, driven by opencode's `session.idle` bus event. A session
// that never goes idle is never sampled. In the analyzed three-arm run the
// futility signature — run EXECUTING, item I1 PENDING, no questions — held
// unchanged for 36 minutes across 16 orchestrator turns while the model
// generated continuously, and run.json closed at idleRePrompts 0 /
// futileRePrompts 0. The run was killed by the tier ceiling, leaving no stop
// record, no §2.9 kind and no human-readable artifact.
//
// THE SUBJECT (absent at red time):
//   core/stops.ts       shouldTerminateStalledTurns — the pure verdict.
//   adapter/continuation.ts handleOrchestratorTurn  — the counting and the stop.
//   adapter/continuation.ts handlePluginEvent       — the `message.updated`
//                                                     route that feeds it.
//
// WHAT A TURN IS. One COMPLETED assistant message on the orchestrator's own
// session: opencode's `message.updated` bus event whose properties.info is an
// assistant message carrying `time.completed`. That is the same unit the
// analysis counted (23 turns in the analyzed cell), and it is observable
// without any idleness.
//
// THE SIGNATURE IS NOT RE-DERIVED HERE. These tests never spell out what makes
// a run "moved" — they move the persisted state the ONE existing derivation
// reads (item state, run state, questions) and assert the counter's behaviour,
// so a change to that derivation cannot leave this file asserting a second
// definition of progress.
//
// THE FALSE-POSITIVE ROWS COME FIRST. A detector that stops healthy runs is
// worse than no detector, so the rows that assert NOTHING is stopped —
// signature moving, a re-delivered message id, a sub-session's turn — carry
// more weight than the row that asserts the wedge dies.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// THE SUBJECT.
import {
  createContinuationState,
  handleOrchestratorTurn,
  handlePluginEvent,
} from "../adapter/continuation.ts";
import type { ContinuationClient, ContinuationState } from "../adapter/continuation.ts";
import { isTerminal, shouldTerminateStalledTurns } from "../core/stops.ts";

// Committed surfaces the fixture stands on.
import { openWorkspace } from "../adapter/state.ts";
import { appendQuestion } from "../adapter/questions.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import type { RegistryEntry } from "../adapter/tools.ts";
import { treePath } from "../core/types.ts";
import type { AnomalyRecord, Config, Item, ItemState, Queue, QueueItem, Run, TreePath } from "../core/types.ts";

// ---------------------------------------------------------------------------
// Fixture plumbing (the tests/continuation.test.ts idiom: a throwaway git repo,
// an injected clock, a capturing journal, an out-of-repo state home)
// ---------------------------------------------------------------------------

const ORCH = "ses_orchestrator";
const SUB = "ses_implementer";
const SCOPE = "unit4471";
const START_MS = 1_755_100_000_000;
const TURN_MS = 80_000; // the analyzed run's MEDIAN turn, so wall clock is readable

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

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "Conductor Test",
  GIT_AUTHOR_EMAIL: "conductor-test@example.invalid",
  GIT_COMMITTER_NAME: "Conductor Test",
  GIT_COMMITTER_EMAIL: "conductor-test@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00 +0000",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00 +0000",
  GIT_TERMINAL_PROMPT: "0",
};

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function scratchRepo(): TreePath {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-turn-repo-"));
  tmpDirs.push(dir);
  git(dir, ["init", "-b", "main"]);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "src", "parser.mjs"), "export const parse = (t) => Math.abs(Number(t));\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "seed"]);
  return treePath(dir);
}

function freshStateHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-turn-state-"));
  tmpDirs.push(dir);
  return dir;
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

interface Clock {
  now: () => number;
  advance: (delta: number) => void;
}
function makeClock(): Clock {
  let ms = START_MS;
  return {
    now: () => ms,
    advance: (delta: number) => {
      ms += delta;
    },
  };
}

function makeConfig(): Config {
  return {
    version: 1,
    verify: {
      scopes: {
        [SCOPE]: { command: [process.execPath, "-e", "process.exit(0)"], timeoutMs: 120_000 },
      },
      behavioralPaths: ["src/**"],
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
      vetMaxRounds: 2,
      testRepairAttempts: 2,
      debugFixCap: 2,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 4,
    },
    parallel: { writes: "off", maxImplementers: 4, maxReaders: 4, subSessionTimeoutMs: 120_000 },
    models: { default: "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

function openStore(root: string, journal: JournalSink, config: Config, now: () => number): StateStore {
  const opts: OpenOptions = {
    root,
    config,
    journal,
    version: "0.0.0-test",
    sessionID: ORCH,
    now,
    pid: process.pid,
    staleLockMs: 24 * 60 * 60 * 1000,
  };
  return openWorkspace(opts);
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

function makeQueueItem(id: string): QueueItem {
  return {
    id,
    title: "keep the sign of negative offsets",
    rationale: "the parser drops the sign, so negative offsets read as positive ones",
    fileScope: ["src/parser.mjs"],
    testScope: ["tests/p.test.mjs"],
    acceptance: ['parse("-7") returns -7'],
    behavioral: true,
    dependsOn: [],
    ponytail: {
      necessary: "the user's prompt asks for signed offsets",
      reuse: "checked the existing modules; nothing parses a signed offset",
      ladderRung: "minimal-code",
    },
  };
}

// The wedge fixture, on disk exactly as the analyzed run left it: EXECUTING,
// one behavioral item PENDING, no questions. The gate's next action here is
// conductor_submit_test{I1} and nothing the engine does can advance it.
function seedOneItemExecuting(store: StateStore, runId: string): Queue {
  const queue: Queue = { items: [makeQueueItem("I1")] };
  const run = store.loadRun(runId);
  run.state = "EXECUTING";
  store.saveRun(run);
  writeFileSync(path.join(runDirOf(store, runId), "queue.json"), JSON.stringify(queue, null, 2));
  for (const qi of queue.items) store.saveItem(runId, makeRuntimeItem(qi.id, "PENDING"));
  return queue;
}

function createRunFor(store: StateStore): string {
  return store.createRun({
    prompt: "make the beta parser keep the sign of negative offsets",
    sessionID: ORCH,
    classification: {
      kind: "work",
      rationale: "the prompt asks for a behavioural change",
      check: { agreed: true, note: "" },
    },
  }).runId;
}

function readRunFile(store: StateStore, runId: string): Run {
  return JSON.parse(readFileSync(path.join(runDirOf(store, runId), "run.json"), "utf8")) as Run;
}

function readAnomalies(runDir: string): AnomalyRecord[] {
  const file = path.join(runDir, "anomalies.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AnomalyRecord);
}

// A client the turn path must never touch: any call is a test failure. The
// detector samples persisted state and dispatches no model work of its own.
function forbiddenClient(): ContinuationClient {
  const explode = (): never => {
    throw new Error("the turn detector reached the SDK; it must not");
  };
  return {
    session: { create: explode, prompt: explode, abort: explode, messages: explode },
    postSessionIdPermissionsPermissionId: explode,
  } as unknown as ContinuationClient;
}

interface Harness {
  root: TreePath;
  store: StateStore;
  runId: string;
  runDir: string;
  state: ContinuationState;
  registry: Map<string, RegistryEntry>;
  journal: { sink: JournalSink; records: CaptureRecord[] };
  clock: Clock;
  config: Config;
  stateHome: string;
  reports: string[];
  turn: (messageID: string, sessionID?: string) => Promise<{ stop: { kind: string; reasonDisplay: string } | null }>;
}

function harness(): Harness {
  const root = scratchRepo();
  const config = makeConfig();
  const journal = makeJournal();
  const clock = makeClock();
  const store = openStore(root, journal.sink, config, clock.now);
  const runId = createRunFor(store);
  seedOneItemExecuting(store, runId);
  const registry = new Map<string, RegistryEntry>([
    [ORCH, { role: "orchestrator" } as RegistryEntry],
    [SUB, { role: "implementer", itemId: "I1" } as RegistryEntry],
  ]);
  const state = createContinuationState();
  const stateHome = freshStateHome();
  const reports: string[] = [];
  const h: Harness = {
    root,
    store,
    runId,
    runDir: runDirOf(store, runId),
    state,
    registry,
    journal,
    clock,
    config,
    stateHome,
    reports,
    turn: async (messageID, sessionID = ORCH) => {
      clock.advance(TURN_MS);
      const result = await handleOrchestratorTurn({
        store,
        state,
        registry,
        sessionID,
        messageID,
        config,
        journal: journal.sink,
        stateHome,
        workspaceKey: "turn-stall-test",
        now: clock.now,
        deps: {
          writeStopReport: async (i) => {
            reports.push(i.runId);
            return { reportPath: path.join(runDirOf(store, i.runId), "report.md") };
          },
          removeWorktree: () => undefined,
        },
      });
      return { stop: result.stop };
    },
  };
  return h;
}

// ===========================================================================
// [turn-stall-pure-below-limit] / [turn-stall-pure-at-limit]
// The core verdict, in isolation: the threshold is a named constant in core and
// the decision is a pure function of the counter.
// ===========================================================================

const LIVE = { state: "EXECUTING", stop: null };
const EMPTY_SUMMARY = { open: 1, blocked: 0, deferred: 0, surfacedQuestions: 0 };

test("[turn-stall-pure-below-limit] the pure verdict does not stop a run below the stalled-turn limit, at any count, and the limit is high enough that a dozen turns of reading before a stage tool is not a stop", () => {
  for (let turns = 0; turns <= 11; turns += 1) {
    const verdict = shouldTerminateStalledTurns(LIVE, { stalledTurns: turns }, EMPTY_SUMMARY);
    assert.equal(verdict.stop, false, `stalledTurns ${turns} must not stop the run`);
    assert.equal(verdict.kind, undefined, "a no-stop verdict names no kind");
  }
});

test("[turn-stall-pure-at-limit] the pure verdict stops the run `noop` once the stalled-turn count reaches the limit, and keeps stopping above it; a run that is ALREADY terminal is never stopped a second time", () => {
  const verdict = shouldTerminateStalledTurns(LIVE, { stalledTurns: 12 }, EMPTY_SUMMARY);
  assert.equal(verdict.stop, true, "twelve turns at one signature is a wedge");
  assert.equal(verdict.kind, "noop", "§2.9's kind for a run that made no observable progress");
  assert.equal(
    shouldTerminateStalledTurns(LIVE, { stalledTurns: 40 }, EMPTY_SUMMARY).stop,
    true,
    "and it stays a stop above the limit",
  );

  const alreadyStopped = {
    state: "EXECUTING",
    stop: { kind: "noop", reasonDisplay: "already recorded", tsMs: START_MS },
  };
  assert.equal(
    shouldTerminateStalledTurns(alreadyStopped, { stalledTurns: 99 }, EMPTY_SUMMARY).stop,
    false,
    "a recorded stop makes the run terminal for every subsystem at once; nothing double-records",
  );
  assert.equal(
    shouldTerminateStalledTurns({ state: "REPORTED", stop: null }, { stalledTurns: 99 }, EMPTY_SUMMARY).stop,
    false,
    "and a terminal FSM state is equally closed",
  );
});

// ===========================================================================
// [turn-stall-moving-run-never-stopped] — THE ROW THAT MATTERS MOST
// ===========================================================================

test("[turn-stall-moving-run-never-stopped] a run that KEEPS MOVING is never stopped, however many turns it takes: across 28 orchestrator turns that advance the item every fourth turn — three turns of reading per stage, which is what a healthy run looks like — no stop is recorded, run.json stays non-terminal, no disengage anomaly is written and no stop report is driven", async () => {
  const h = harness();
  const states: ItemState[] = ["PENDING", "RED", "TEST_VETTED", "GREEN", "VALIDATED", "REVIEWED", "PENDING"];

  let advanced = 0;
  for (let turn = 0; turn < 28; turn += 1) {
    const result = await h.turn(`msg_move_${turn}`);
    assert.equal(result.stop, null, `turn ${turn} of a moving run must not stop it`);
    // Every fourth turn the run actually advances: the item reaches its next
    // state, which is a change the ONE futility derivation reads.
    if (turn % 4 === 3) {
      advanced += 1;
      const item = h.store.loadItem(h.runId, "I1");
      item.state = states[advanced % states.length];
      h.store.saveItem(h.runId, item);
    }
  }

  assert.equal(advanced, 7, "the fixture really did advance the item seven times");
  const run = readRunFile(h.store, h.runId);
  assert.equal(run.stop, null, "a moving run carries no stop record");
  assert.equal(run.state, "EXECUTING", "and is left in the state it was working in");
  assert.deepEqual(
    readAnomalies(h.runDir).filter((a) => a.kind === "disengage"),
    [],
    "no disengage anomaly is written for a run that was never wedged",
  );
  assert.deepEqual(h.reports, [], "and no stop report is driven");
  assert.deepEqual(
    h.journal.records.filter((r) => r.component === "continuation" && r.event === "disengage"),
    [],
    "and nothing is journaled as a disengagement",
  );
});

// ===========================================================================
// [turn-stall-redelivery-counts-once]
// ===========================================================================

test("[turn-stall-redelivery-counts-once] the bus may re-deliver one assistant message many times: 60 deliveries of the SAME message id count as ONE turn and stop nothing, and the count the handler reports never exceeds the number of DISTINCT turns observed", async () => {
  const h = harness();
  for (let i = 0; i < 60; i += 1) {
    const result = await h.turn("msg_one_and_only");
    assert.equal(result.stop, null, `re-delivery ${i} must not be counted as a turn`);
  }
  assert.equal(readRunFile(h.store, h.runId).stop, null, "sixty deliveries of one message wedge nothing");
});

// ===========================================================================
// [turn-stall-subsession-turns-do-not-count]
// ===========================================================================

test("[turn-stall-subsession-turns-do-not-count] a SUB-SESSION's turns are not the orchestrator's: 30 completed turns on an implementer session, plus 30 on a session with no §3.5 registry entry at all, stop nothing", async () => {
  const h = harness();
  for (let i = 0; i < 30; i += 1) {
    assert.equal((await h.turn(`msg_sub_${i}`, SUB)).stop, null, "a sub-session turn is the fan-out engine's business");
    assert.equal((await h.turn(`msg_unknown_${i}`, "ses_stranger")).stop, null, "an unregistered session is nobody's");
  }
  assert.equal(readRunFile(h.store, h.runId).stop, null, "and the orchestrator's run is untouched");
});

// ===========================================================================
// [turn-stall-wedge-stops-noop] — the true positive
// ===========================================================================

test("[turn-stall-wedge-stops-noop] the analyzed wedge, reproduced: with run EXECUTING, item I1 PENDING and no questions, the signature does not move across turns — the run is stopped `noop` on the twelfth turn and not before, the §2.8 disengage anomaly is written, the ONE stop-report writer is driven exactly once, and the run is left terminal", async () => {
  const h = harness();

  for (let turn = 1; turn <= 11; turn += 1) {
    const result = await h.turn(`msg_wedge_${turn}`);
    assert.equal(result.stop, null, `turn ${turn} is below the limit and must not stop the run`);
    assert.equal(readRunFile(h.store, h.runId).stop, null, "and nothing durable is written before the limit");
  }

  const stopped = await h.turn("msg_wedge_12");
  assert.ok(stopped.stop !== null, "the twelfth consecutive turn at one signature is the wedge");
  assert.equal(stopped.stop.kind, "noop", "§2.9's kind for a run that made no observable progress");

  const run = readRunFile(h.store, h.runId);
  assert.ok(run.stop !== null, "the stop is durable on run.json");
  assert.equal(run.stop.kind, "noop", "and it is the same kind the handler returned");
  assert.equal(
    isTerminal({ state: run.state, stop: run.stop }),
    true,
    "a recorded stop makes the run terminal for every subsystem at once — no special case for this one",
  );

  const anomalies = readAnomalies(h.runDir).filter((a) => a.kind === "disengage");
  assert.equal(anomalies.length, 1, "exactly one §2.8 disengage record");
  assert.equal(
    anomalies[0].detail,
    run.stop.reasonDisplay,
    "and the anomaly's detail is the very reason the stop carries",
  );
  assert.deepEqual(h.reports, [h.runId], "the ONE stop-report writer is driven exactly once");

  const disengages = h.journal.records.filter((r) => r.component === "continuation" && r.event === "disengage");
  assert.equal(disengages.length, 1, "and the disengagement is journaled once under the committed vocabulary");
  assert.equal(disengages[0].corr.runId, h.runId, "correlated to the run it ended");
});

// ===========================================================================
// [turn-stall-reason-names-the-blocker]
// ===========================================================================

test("[turn-stall-reason-names-the-blocker] the stop NAMES the blocker rather than saying only that nothing happened: its reason carries the run state it was stuck in, the item that never moved, and the tool the phase gate was recommending the whole time", async () => {
  const h = harness();
  let stop: { kind: string; reasonDisplay: string } | null = null;
  for (let turn = 1; turn <= 12 && stop === null; turn += 1) {
    stop = (await h.turn(`msg_named_${turn}`)).stop;
  }
  assert.ok(stop !== null, "the wedge was stopped");
  const reason = stop.reasonDisplay;

  assert.match(reason, /EXECUTING/, "the reason names the state the run was stuck in");
  assert.match(reason, /\bI1\b/, "and the item that never moved");
  assert.match(reason, /conductor_submit_test/, "and the action the gate was recommending, unheeded, throughout");
  assert.match(reason, /12/, "and how many turns it watched go by");
});

// ===========================================================================
// [turn-stall-resets-on-progress]
// ===========================================================================

test("[turn-stall-resets-on-progress] the count is CONSECUTIVE: eleven turns at one signature followed by one real advance, then eleven more, stops nothing — a run that moves gets its full budget back every time it moves", async () => {
  const h = harness();
  for (let turn = 0; turn < 11; turn += 1) {
    assert.equal((await h.turn(`msg_first_${turn}`)).stop, null, "eleven turns is below the limit");
  }
  const item = h.store.loadItem(h.runId, "I1");
  item.state = "RED";
  h.store.saveItem(h.runId, item);
  for (let turn = 0; turn < 11; turn += 1) {
    assert.equal((await h.turn(`msg_second_${turn}`)).stop, null, "and the advance restored the whole budget");
  }
  assert.equal(readRunFile(h.store, h.runId).stop, null, "22 turns spanning one real advance is not a wedge");
});

// ===========================================================================
// [turn-stall-answerable-run-keeps-its-pointer]
// ===========================================================================

test("[turn-stall-answerable-run-keeps-its-pointer] a wedged run that is still holding an UNANSWERED question keeps its current-run pointer: the stop is recorded and reported, but the run is not archived, because `noop` is resumable and archiving is what makes conductor_answer unable to revive committed work", async () => {
  const h = harness();
  const question = appendQuestion(
    h.runDir,
    {
      runId: h.runId,
      question: "Should we delete the production data before the migration?",
      askedBy: { role: "orchestrator", sessionID: ORCH },
      humanTerritory: true,
      origin: "surface-tool",
      blocksItems: ["I1"],
    },
    START_MS,
  );
  const item = h.store.loadItem(h.runId, "I1");
  item.blocked = { reason: "waiting on a human call", sinceMs: START_MS, questionId: question.id, stage: "PENDING" };
  h.store.saveItem(h.runId, item);

  let stop: { kind: string; reasonDisplay: string } | null = null;
  for (let turn = 1; turn <= 12 && stop === null; turn += 1) {
    stop = (await h.turn(`msg_answerable_${turn}`)).stop;
  }
  assert.ok(stop !== null, "spinning for twelve turns against an open question is still a wedge");
  assert.equal(stop.kind, "noop", "and it is recorded as one");
  assert.deepEqual(h.reports, [h.runId], "the stop report is written");
  assert.equal(
    h.store.currentRun()?.runId,
    h.runId,
    "but the pointer is held, so the documented answer path still has a run to revive",
  );
});

// ===========================================================================
// [turn-stall-bus-route] — the plumbing, through the ONE event router
// ===========================================================================

test("[turn-stall-bus-route] handlePluginEvent routes a `message.updated` carrying a COMPLETED assistant message for the orchestrator session into the detector: twelve of them wedge the run, while an in-flight message (no time.completed), a user message and a payload with no info at all are each ignored", async () => {
  const h = harness();
  const fire = async (properties: Record<string, unknown>): Promise<void> => {
    h.clock.advance(TURN_MS);
    await handlePluginEvent({
      event: { type: "message.updated", properties },
      store: h.store,
      state: h.state,
      registry: h.registry,
      client: forbiddenClient(),
      config: h.config,
      journal: h.journal.sink,
      stateHome: h.stateHome,
      workspaceKey: "turn-stall-test",
      now: h.clock.now,
      deps: {
        writeStopReport: async (i) => {
          h.reports.push(i.runId);
          return { reportPath: path.join(runDirOf(h.store, i.runId), "report.md") };
        },
        removeWorktree: () => undefined,
      },
    });
  };

  // Payloads the route must IGNORE, fired first so no later observation is theirs.
  for (let i = 0; i < 30; i += 1) {
    await fire({ info: { id: `msg_inflight_${i}`, sessionID: ORCH, role: "assistant", time: { created: START_MS } } });
    await fire({ info: { id: `msg_user_${i}`, sessionID: ORCH, role: "user", time: { created: START_MS } } });
    await fire({ sessionID: ORCH, id: "no_info_at_all" });
  }
  assert.equal(readRunFile(h.store, h.runId).stop, null, "an in-flight or user message is not a completed turn");

  for (let i = 1; i <= 12; i += 1) {
    await fire({
      info: {
        id: `msg_bus_${i}`,
        sessionID: ORCH,
        role: "assistant",
        time: { created: START_MS, completed: START_MS + i },
      },
    });
  }
  const run = readRunFile(h.store, h.runId);
  assert.ok(run.stop !== null, "twelve completed assistant turns on the bus wedge the run");
  assert.equal(run.stop.kind, "noop", "with the same §2.9 kind the direct handler records");
  assert.deepEqual(h.reports, [h.runId], "and the same ONE stop-report writer is driven once");
});

// ===========================================================================
// [turn-stall-terminal-run-untouched]
// ===========================================================================

test("[turn-stall-terminal-run-untouched] a run that has ALREADY recorded a stop is terminal for every subsystem at once: 30 further turns write no second stop, no second anomaly and drive no second report", async () => {
  const h = harness();
  const run = h.store.loadRun(h.runId);
  run.stop = { kind: "blocked", reasonDisplay: "a human holds the next move", tsMs: START_MS };
  h.store.saveRun(run);

  for (let i = 0; i < 30; i += 1) {
    assert.equal((await h.turn(`msg_terminal_${i}`)).stop, null, "a terminal run is never stopped again");
  }
  const after = readRunFile(h.store, h.runId);
  assert.equal(after.stop?.kind, "blocked", "the recorded stop is left exactly as it was");
  assert.deepEqual(readAnomalies(h.runDir), [], "no anomaly is appended to a run that already ended");
  assert.deepEqual(h.reports, [], "and no report is driven for it");
});
