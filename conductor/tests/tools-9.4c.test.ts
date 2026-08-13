// Task 9.4c RED tests — FINAL LOCATION conductor/tests/tools-9.4c.test.ts.
//
// SUBJECT (must NOT exist when this goes red): the §4.2 WAVE DRIVER added to the EXISTING
// conductor/adapter/tools.ts (which today carries the §5.3 gate wiring plus the Task
// 9.1/9.2/9.3/9.4a/9.4b handlers). The red is the missing-export shape — tools.ts
// resolves, but this named binding does not yet exist:
//   handleDispatchWave  (conductor_dispatch_wave — computes the wave through core/schedule
//                        nextWave, runs ONE async pipeline per wave member through the
//                        SHARED fan-out engine, and performs PLAN_REVIEWED→EXECUTING on its
//                        first call)
// Every OTHER import in this file resolves to a committed export today. The ONE intentional
// exception beyond that handler is BEHAVIOURAL, not structural:
// [9.4c-gate-offers-wave-while-schedulable] asserts NEW behaviour from the ALREADY-EXPORTED
// core/gates-phase.ts legalTools (the Gap-1 fix), so that row goes red as an ASSERTION
// failure and not as an unresolved import — exactly as 9.4a's deps-ready row did.
//
// The driver follows the §3.4 invariant loop — legality → derive → persist → journal →
// compact return — and REACHES the committed per-item handlers rather than reimplementing
// them (§4.2: one implementation, one set of gates, whether the model or the driver is
// calling). Sub-session traffic goes through the injected Fanout (adapter/fanout.ts) over
// the FAKE SDK (tests/fixtures/fake-sdk.ts); the item test and the full verify run ONLY
// through adapter/evidence.ts, against REAL on-disk `git init` fixture repos and REAL child
// processes. EVERY interleaving / batching / serialization claim below is read off the fake
// SDK's ORDERED CALL LOG (and off responder-driven rendezvous) — never off timing.
//
// Spec read (docs/plans/2026-08-07-conductor-harness-plan.md):
//   §9 Task 9.4c (2640-2651) — the authoritative behaviour of the tool.
//   §4.2                      — the wave, and the three ordering guarantees the DRIVER owns:
//                               writes serialize per tree (parallel.writes "off" ⇒ one shared
//                               tree); conductor_publish runs serially in item order (the git
//                               index is a singleton); no write-capable dispatch enters a tree
//                               with a live verify marker (§3.5's freeze-as-scheduling rule).
//   §3.2                      — dispatch_wave is the run's work engine, legal and recommended
//                               at PLAN_REVIEWED.
//   docs/build/specs/task-9.4c.assertions.json — the 12 rows mapped to the 12 tests below,
//                               its verifiedAgainstHead facts, its two correctionsToDraft
//                               rulings, its reusesExisting list, and its six resolved
//                               specGaps.
//
// ---------------------------------------------------------------------------
// PINNED SPEC-GAP RESOLUTIONS (from task-9.4c.assertions.json; this file is the contract
// that pins them):
//  (G1) REPEAT CALLS vs THE PHASE GATE. core/gates-phase.ts legalTools offers
//       conductor_dispatch_wave ONLY in the PLAN_REVIEWED branch at HEAD (line 324), so
//       every call after the first is denied. The fix is a two-line addition inside the
//       EXECUTING branch, at the nextWave computation that branch ALREADY performs (lines
//       365-372): also set conductor_dispatch_wave legal when `wave.parallel.length > 0`.
//       `recommended` is NOT touched — the per-item stage tool stays the recommendation, so
//       no committed gates-phase row changes meaning. It composes with the C-032
//       cannotEverPublish logic in the same branch; both read the same items array.
//  (G2) STAGES THAT DO NOT EXIST YET. conductor_item_review lands at 9.5a and
//       conductor_publish at 9.5b, AFTER 9.4c in the serial order. The driver takes an
//       INJECTABLE per-stage executor table (dependency injection — the same pattern as the
//       injected Fanout, the injected clock and VerifyOptions.staleMarkerMs), but its
//       DEFAULT table wires ONLY handlers that exist at HEAD, and a member that reaches a
//       stage with no committed executor STOPS there with a disposition NAMING the missing
//       stage. It never throws "not implemented" and never carries a placeholder executor.
//       The rows below inject RECORDING executors to pin ordering for the not-yet-built
//       stages; the Phase 9 milestone gate re-runs those rows against the real 9.5a/9.5b
//       handlers once they land.
//  (G3) "ITEM ORDER" is the deterministic §4.2 wave order — WavePlan.parallel order (DAG
//       depth ascending, then item id ascending), the same order every other §4.2 rule and
//       the legalTools recommendation already use.
//  (G4) BATCHING RENDEZVOUS is deterministic, with no timing window: the driver advances the
//       wave stage-by-stage; at each READ stage it dispatches ONE fanout group holding the
//       jobs of every member that completed the previous stage and is still active. A member
//       that drops out (blocked, deferred, env-failed) leaves all later groups and the
//       survivors proceed without waiting. Write stages never batch — they serialize per
//       tree (§4.3).
//  (G5) SUMMARY SHAPE (return value only — no persisted artifact, no SCHEMAS widening):
//       {runState, wave:{parallel, rationale}, items:[{itemId, state, blocked|null,
//       deferred|null, envError|null, …}]}. "Compact" is pinned as: the return NEVER embeds
//       full §2.4 queue-item or §2.5 item JSON.
//  (G6) EMPTY FIRST WAVE: the PLAN_REVIEWED→EXECUTING transition is UNCONDITIONAL on the
//       first call. Otherwise conductor_report is unreachable and the run wedges at
//       PLAN_REVIEWED — the same class of livelock the P3 binding exists to prevent.
//
// PINNED INTERPRETATIONS THIS FILE ADDS (judgement calls the rows leave open; the
// implementer must target these exactly):
//  (P1) The driver checks its OWN legality through core/gates-phase legalTools before it
//       transitions, computes, or dispatches anything — which is precisely why G1's
//       EXECUTING offer is load-bearing for a multi-wave run. One derivation, one gate.
//  (P2) The driver STARTS each member's pipeline in WavePlan.parallel order, in one
//       synchronous pass, and then lets them run concurrently. Membership order is §4.2's
//       and nothing else's, and this is what makes the freeze/hold staging of the P7 row
//       (and the publish order of the publish row) deterministic rather than racy.
//  (P3) A stage that RAN but did not advance the item (a committed handler returning
//       ok:false — a failing item test, a red verify, a blocked member) STOPS that member's
//       pipeline: the driver never advances an item past work that did not happen and never
//       re-runs a stage inside one dispatch_wave call. The disposition's `stoppedAt` names
//       that stage and `envError` stays null.
//  (P4) A stage NO executor serves (G2) also stops the member — `stoppedAt` names the stage
//       AND `envError` is a non-null message naming it. That is the only difference in the
//       disposition between "ran and did not advance" and "this build cannot serve it", and
//       it is what makes the G4 honesty row checkable.
//  (P5) The wave's PLAN_REVIEWED→EXECUTING edge is journaled as fsm/`transition` carrying
//       {from, to, why} with `why` VERBATIM from core/fsm-run legalRunTransition — the P3
//       binding's observable proof that the gate was consulted rather than re-derived.
//  (P6) The driver is handed the SAME §3.5 TreeState the Fanout was built over, extended
//       with ONE operation the driver owns: notifyClear(tree). The driver calls it after
//       every stage execution, so a tree released by a stage (a verify that finished, a
//       stale marker the evidence layer broke) deterministically releases the fan-out
//       engine's held write-capable jobs — no timers, no polling, no second engine.
//  (P7) The per-item disposition is EXACTLY {itemId, state, blocked, deferred, envError,
//       stoppedAt, anomaly}: `blocked`/`deferred` are the REASON STRINGS (never the §2.5
//       annotation objects — that is half of "compact"), `anomaly` is a non-null string only
//       when something abnormal rode this member (a freeze/marker hold), else null.
//  (P8) A held write-capable job that NOTHING will ever release is env-failed by the driver,
//       never awaited forever. The bound is the driver's own business (this file asserts
//       only the OBSERVABLE: dispatch_wave RETURNS with an envError disposition); it is NOT
//       the fan-out engine's per-job watchdog, which is never even armed for a held job.
//
// ---------------------------------------------------------------------------
// PINNED HANDLER SURFACE + STAGE-EXECUTOR SEAM the implementer must target
// (adapter/tools.ts). ONE options object; runDir is derived as
// <store.root>/.conductor/runs/<runId>/; the fixture repo IS <store.root>. `journal` is the
// leveled sink (adapter/journal.ts Journal-compatible); `now` defaults to Date.now.
// `stateHome`/`workspaceKey` are the OUT-OF-REPO §4.2 quarantine coordinates the committed
// quarantine.ts already takes; `packs` is the doctrine map adapter/inject.ts loadPacks
// produced at init.
//
//   // The seam (G2). Keyed by the §3.4 conductor_* tool name the §3.3 item FSM says
//   // advances the item — the SAME vocabulary core/gates-phase nextStageTool emits.
//   type StageExecutor = (ctx: {
//     tool: string; store: StateStore; fanout: Fanout; runId: string; itemId: string;
//     config: Config; journal: JournalSink; stateHome: string; workspaceKey: string;
//     packs: Record<string, string>; now: () => number;
//   }) => Promise<{ ok: boolean; itemState: ItemState }>;
//
//   // The DEFAULT table wires ONLY handlers committed at HEAD:
//   //   conductor_submit_test → handleSubmitTest   conductor_vet_test  → handleVetTest
//   //   conductor_mark_green  → handleMarkGreen    conductor_validate  → handleValidate
//   // and NOTHING for conductor_item_review (9.5a) or conductor_publish (9.5b).
//   // `executors` MERGES OVER that default table; it never replaces it wholesale.
//
//   handleDispatchWave(input: {
//     store: StateStore; fanout: Fanout; treeState: TreeState & { notifyClear(t: string): void };
//     runId: string; config: Config; journal: JournalSink; stateHome: string;
//     workspaceKey: string; packs: Record<string, string>; now?: () => number;
//     executors?: Record<string, StageExecutor>;
//   }): Promise<{
//     runState: RunState;                    // the PERSISTED run state after the call
//     wave: { parallel: string[]; rationale: string };  // nextWave's OWN plan, verbatim
//     items: Array<{
//       itemId: string;
//       state: ItemState;                    // the PERSISTED item state after the call
//       blocked: string | null;              // the §2.5 block REASON (never the object)
//       deferred: string | null;             // the §2.5 defer REASON (never the object)
//       envError: string | null;             // an environment failure that stopped this member
//       stoppedAt: string | null;            // the conductor_* stage the member stopped at
//       anomaly: string | null;              // e.g. a freeze/marker hold this member rode
//     }>;
//   }>
// ---------------------------------------------------------------------------
//
// Assertion id → test (each test name carries its id as its FIRST token):
//   9.4c-membership-nextwave        → membership IS nextWave's WavePlan (blocked / deferred /
//                                     deps-unready excluded, cap honoured at TWO different
//                                     maxImplementers), rationale verbatim, ZERO sub-sessions
//                                     for the excluded items.
//   9.4c-first-call-executing       → first call transitions; a repeat call does not; an
//                                     EMPTY first wave still transitions.
//   9.4c-binding-p3-transition-context → the edge goes through core legalRunTransition with a
//                                     context DERIVED FROM PERSISTED planReviewRounds; both
//                                     the clean exit and the cap exit advance.
//   9.4c-gate-offers-wave-while-schedulable → the Gap-1 fix, asserted through the PURE gate,
//                                     with `recommended` UNCHANGED.
//   9.4c-interleaving               → two members' pipelines run concurrently through the
//                                     SHARED engine; the ordered call log proves interleaving.
//   9.4c-stage-batching             → like stages batch across members (rendezvous-proven, at
//                                     TWO different vetCritics), and a dropped-out member is
//                                     absent from later groups.
//   9.4c-writes-serialize           → readers overlap freely; write-capable implementer
//                                     sessions never overlap in the shared tree.
//   9.4c-publish-order              → REVIEWED→PUBLISHED runs strictly one at a time in wave
//                                     order even when the second member reaches REVIEWED first.
//   9.4c-missing-stage-stops-honestly → the DEFAULT table stops honestly, naming the missing
//                                     stage, for TWO different missing stages.
//   9.4c-blocked-no-stall           → a member that blocks mid-pipeline does not stall its
//                                     sibling; the wave returns drained-or-blocked.
//   9.4c-compact-summary            → the exact disposition shape; no §2.4/§2.5 JSON embedded.
//   9.4c-binding-p7-stale-marker-onclear → a leaked stale marker HOLDS a write-capable job;
//                                     breaking it releases the hold via the driver's TreeState
//                                     and the wave completes WITHOUT the watchdog firing.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// THE SUBJECT — absent at red time (missing-export red from the existing tools.ts).
import { handleDispatchWave } from "../adapter/tools.ts";

// Adapters + core that DO exist today.
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { readQuestions } from "../adapter/questions.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, TreeState } from "../adapter/fanout.ts";
import { createJournal } from "../adapter/journal.ts";
import type { Journal } from "../adapter/journal.ts";
import { loadPacks } from "../adapter/inject.ts";
import { legalTools } from "../core/gates-phase.ts";
import type { GateItem, GateRun } from "../core/gates-phase.ts";
import { nextWave, readFanout } from "../core/schedule.ts";
import { legalRunTransition } from "../core/fsm-run.ts";
import { isKnownEvent } from "../core/journal-events.ts";
import { validate } from "../core/types.ts";
import type {
  Config,
  EvidenceRecord,
  Item,
  ItemState,
  LogLevel,
  Queue,
  QueueItem,
  RunState,
} from "../core/types.ts";

import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

// ---------------------------------------------------------------------------
// The pinned surface, restated STRUCTURALLY so every call site below type-checks the green
// implementation against this file's contract (the 9.4a/9.4b convention).
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

// P6: the §3.5 tree view the DRIVER drives — adapter/fanout.ts's TreeState (which the
// Fanout was built over) plus the one operation the driver owns.
interface WaveTreeState extends TreeState {
  notifyClear(tree: string): void;
}

interface StageExecutorContext {
  tool: string;
  store: StateStore;
  fanout: Fanout;
  runId: string;
  itemId: string;
  config: Config;
  journal: JournalSink;
  stateHome: string;
  workspaceKey: string;
  packs: Record<string, string>;
  now: () => number;
}

interface StageOutcome {
  ok: boolean;
  itemState: ItemState;
}

type StageExecutor = (ctx: StageExecutorContext) => Promise<StageOutcome>;

// P7: the compact per-item disposition.
interface WaveDisposition {
  itemId: string;
  state: ItemState;
  blocked: string | null;
  deferred: string | null;
  envError: string | null;
  stoppedAt: string | null;
  anomaly: string | null;
}

interface DispatchWaveResult {
  runState: RunState;
  wave: { parallel: string[]; rationale: string };
  items: WaveDisposition[];
}

// The exact key set of a disposition row (P7) — deep-equalled below so a green
// implementation cannot quietly widen the compact return.
const DISPOSITION_KEYS = [
  "anomaly",
  "blocked",
  "deferred",
  "envError",
  "itemId",
  "state",
  "stoppedAt",
] as const;

// ---------------------------------------------------------------------------
// Distinctive fixture markers. Each is unique across the file, so an assertion that a value
// DOES (or does NOT) carry one is unambiguous.
// ---------------------------------------------------------------------------

const TITLE_MARKER = "ITEM-TITLE-MARKER-5518";
const ACCEPT_MARKER = "ACCEPTANCE-MARKER-2207";
const IMPL_MARKER = "IMPLEMENTER-REPLY-MARKER-9914";
const RED_MARKER = "CAPTURED-RED-MARKER-3360";
const MUSTFIX_MARKER = "MUSTFIX-MARKER-7781: assert the sign, not the magnitude";

// The verify scope name is deliberately distinctive so a hardcoded "unit" cannot satisfy it.
const SCOPE = "unit4471";

// A fixed injected clock: every stamped value the driver and the handlers mint reads it.
const START_MS = 1_754_990_000_000;

// The §4.2 shared tree under parallel.writes "off".
const TREE = "main";

// This file's home (conductor/tests/) — the doctrine packs are read RELATIVE to it.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCTRINE_DIR = path.resolve(HERE, "..", "doctrine");

// The REAL doctrine packs through the COMMITTED loader — handleValidate's DEBUG protocol is
// fed from this map, never from a literal typed here.
const PACKS: Record<string, string> = loadPacks(DOCTRINE_DIR);

// ---------------------------------------------------------------------------
// Hermetic git + temp-dir bookkeeping (the tests/evidence.test.ts idiom). Every fixture is a
// throwaway repo under os.tmpdir(); the out-of-repo state home is a SEPARATE throwaway dir.
// ---------------------------------------------------------------------------

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
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

function git(dir: string, args: string[]): void {
  execFileSync("git", args, { cwd: dir, env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] });
}

// A committed fixture repo, so runVerify records a REAL HEAD sha and branch "main".
function committedRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-tools94c-repo-"));
  tmpDirs.push(dir);
  git(dir, ["init", "-b", "main"]);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  mkdirSync(path.join(dir, "docs"), { recursive: true });
  writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  git(dir, ["add", "seed.txt"]);
  git(dir, ["commit", "-m", "seed"]);
  return dir;
}

function freshStateHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-tools94c-state-"));
  tmpDirs.push(dir);
  return dir;
}

// A pid that is provably dead: spawnSync waits for the child, so by the time it returns the
// pid has exited and been reaped (process.kill(pid,0) → ESRCH). The evidence.test.ts idiom.
function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", "0"], { stdio: "ignore" });
  if (typeof r.pid === "number" && r.pid > 1) return r.pid;
  return 2147483646;
}

// ---------------------------------------------------------------------------
// Rendezvous primitives. NO SLEEP IS EVER THE SYNCHRONIZATION HERE.
//  - `until` blocks on a PREDICATE over observable state (the fake SDK's own log); the 1ms
//    interval is granularity and the deadline is a FAILURE BACKSTOP no passing assertion
//    depends on — a satisfied predicate always returns before it.
//  - `turns` yields a bounded number of macrotask turns. It is never a synchronization
//    point: it only gives an INCORRECT (unsynchronized) implementation more opportunity to
//    emit the call whose absence the following assertion claims, so it can only make a
//    passing assertion harder to satisfy, never easier.
// ---------------------------------------------------------------------------

async function until(predicate: () => boolean, what: string, backstopMs = 20_000): Promise<void> {
  const deadline = Date.now() + backstopMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`rendezvous backstop tripped — this never became true: ${what}`);
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1);
    });
  }
}

async function turns(count = 6): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

// ---------------------------------------------------------------------------
// Journal sinks (the tools-9.1/9.2/9.3/9.4a/9.4b harness shape).
// ---------------------------------------------------------------------------

interface CaptureRecord {
  level: string;
  component: string;
  event: string;
  data: Record<string, unknown>;
  corr: { runId?: string; itemId?: string; sessionID?: string };
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

// A TEE onto the REAL adapter/journal.ts journal, which THROWS on any event outside the
// closed §7.4 vocabulary (core/journal-events.ts EVENTS): a driver that invented an event
// name fails loudly instead of quietly widening the vocabulary.
function makeRealJournal(runDir: string, config: Config): { sink: JournalSink; records: CaptureRecord[] } {
  const real: Journal = createJournal(runDir, config, {});
  const records: CaptureRecord[] = [];
  const sink: JournalSink = {
    log(level, component, event, data, corr): void {
      records.push({ level, component, event, data, corr });
      real.log(level as LogLevel, component, event, data, {
        runId: corr.runId ?? "",
        ...(corr.itemId !== undefined ? { itemId: corr.itemId } : {}),
        ...(corr.sessionID !== undefined ? { sessionID: corr.sessionID } : {}),
      });
    },
    flushSync(): void {
      real.flushSync();
    },
  };
  return { sink, records };
}

function transitionsTo(records: CaptureRecord[], from: string, to: string): CaptureRecord[] {
  return records.filter(
    (r) => r.component === "fsm" && r.event === "transition" && r.data["from"] === from && r.data["to"] === to,
  );
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface FixtureScope {
  command: string[];
  timeoutMs: number;
  itemTest?: string[];
}

interface ConfigOpts {
  command?: string[];
  itemTest?: string[];
  vetCritics?: number;
  vetMaxRounds?: number;
  maxReaders?: number;
  maxImplementers?: number;
  planReviewMaxRounds?: number;
  subSessionTimeoutMs?: number;
}

// The trivially-green verify scope command: real spawn, no work.
const GREEN_CMD = [process.execPath, "-e", "0"];

function makeConfig(opts: ConfigOpts = {}): Config {
  const scope: FixtureScope = {
    command: [...(opts.command ?? GREEN_CMD)],
    timeoutMs: 120_000,
    ...(opts.itemTest !== undefined ? { itemTest: [...opts.itemTest] } : {}),
  };
  const scopes: Config["verify"]["scopes"] = { [SCOPE]: scope };
  return {
    version: 1,
    verify: {
      scopes,
      behavioralPaths: ["src/**"],
      requiredScopes: [{ pattern: "**", scopes: [SCOPE] }],
    },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 5,
      planReviewers: 4,
      planReviewMaxRounds: opts.planReviewMaxRounds ?? 3,
      itemReviewers: 1,
      skepticsPerFinding: 1,
      reviewMaxRounds: 1,
      vetCritics: opts.vetCritics ?? 2,
      vetMaxRounds: opts.vetMaxRounds ?? 2,
      testRepairAttempts: 2,
      debugFixCap: 2,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
    },
    parallel: {
      writes: "off",
      maxImplementers: opts.maxImplementers ?? 4,
      maxReaders: opts.maxReaders ?? 4,
      subSessionTimeoutMs: opts.subSessionTimeoutMs ?? 120_000,
    },
    models: { default: "test-model", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: false },
    logging: { level: "info", components: {} },
  };
}

// ---------------------------------------------------------------------------
// Store / run / queue fixtures
// ---------------------------------------------------------------------------

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

const USER_PROMPT = "make the beta parser keep the sign of negative offsets";

function createRunFor(store: StateStore): string {
  const run = store.createRun({
    prompt: USER_PROMPT,
    sessionID: "ses_orchestrator",
    classification: {
      kind: "work",
      rationale: "the prompt asks for a behavioural change",
      check: { agreed: true, note: "" },
    },
  });
  return run.runId;
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
    title: `keep the sign of negative offsets (${TITLE_MARKER})`,
    rationale: "the parser drops the sign, so negative offsets read as positive ones",
    fileScope: [...over.fileScope],
    testScope: [...over.testScope],
    acceptance: [`parse("-7") returns -7 (${ACCEPT_MARKER})`],
    behavioral: over.behavioral ?? true,
    dependsOn: [...(over.dependsOn ?? [])],
    ponytail: {
      necessary: "the user's prompt asks for signed offsets",
      reuse: "checked the existing modules; nothing parses a signed offset",
      ladderRung: "minimal-code",
    },
  };
}

// A non-behavioral item: §2.4 proves its fileScope disjoint from verify.behavioralPaths
// ("src/**"), and it owes no test — so conductor_mark_green runs NO item test for it.
function docsItem(id: string, rel: string, dependsOn: string[] = []): QueueItem {
  return makeQueueItem(id, { fileScope: [rel], testScope: [], behavioral: false, dependsOn });
}

// Drive a run to PLAN_REVIEWED WITHOUT calling any other task's handler (direct on-disk
// seeding, the tools-9.2/9.3/9.4a/9.4b discipline).
function seedPlanReviewed(
  store: StateStore,
  runId: string,
  queue: Queue,
  states: Record<string, ItemState> = {},
  planReviewRounds = 0,
): void {
  const run = store.loadRun(runId);
  run.state = "PLAN_REVIEWED";
  run.planReviewRounds = planReviewRounds;
  store.saveRun(run);
  writeFileSync(path.join(runDirOf(store, runId), "queue.json"), JSON.stringify(queue, null, 2));
  for (const qi of queue.items) {
    store.saveItem(runId, makeRuntimeItem(qi.id, states[qi.id] ?? "PENDING"));
  }
}

function readEvidence(runDir: string): EvidenceRecord[] {
  const file = path.join(runDir, "evidence.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EvidenceRecord);
}

function itemFileBytes(runDir: string, itemId: string): string {
  return readFileSync(path.join(runDir, "items", `${itemId}.json`), "utf8");
}

function markerPathOf(runDir: string, tree = TREE): string {
  return path.join(runDir, `verify-running-${tree}.json`);
}

// The gate's view of the SAME persisted fixture.
function gateItemsOf(store: StateStore, runId: string, queue: Queue): GateItem[] {
  return queue.items.map((qi) => {
    const item = store.loadItem(runId, qi.id);
    return {
      id: qi.id,
      state: item.state,
      behavioral: qi.behavioral,
      dependsOn: [...qi.dependsOn],
      fileScope: [...qi.fileScope],
      blocked: item.blocked === null ? null : { reason: item.blocked.reason },
      deferred: item.deferred === null ? null : { reason: item.deferred.reason },
    };
  });
}

// The wave the DRIVER must produce: core/schedule nextWave's own plan over the SAME
// persisted facts and the SAME config caps. Never a re-derivation in this file either.
function expectedWave(store: StateStore, runId: string, queue: Queue, config: Config): { parallel: string[]; rationale: string } {
  const items = queue.items.map((qi) => {
    const item = store.loadItem(runId, qi.id);
    return {
      id: qi.id,
      state: item.state,
      blocked: item.blocked === null ? null : { reason: item.blocked.reason },
      deferred: item.deferred === null ? null : { reason: item.deferred.reason },
    };
  });
  return nextWave({ items: queue.items }, items, config);
}

// ---------------------------------------------------------------------------
// Fixture source files (behavioral items) + the §2.6 red they carry.
// ---------------------------------------------------------------------------

function assertionTest(marker: string, subjectRel: string): string {
  return (
    `// ${marker}\n` +
    'import test from "node:test";\n' +
    'import assert from "node:assert/strict";\n' +
    `import { parse } from "${subjectRel}";\n` +
    'test("t", () => {\n' +
    '  assert.equal(parse("-7"), -7, "sign");\n' +
    "});\n"
  );
}

function appendRed(runDir: string, itemId: string, seq: number, testRel: string): EvidenceRecord {
  const record: EvidenceRecord = {
    seq,
    ts: START_MS,
    kind: "red",
    itemId,
    command: [process.execPath, "--test", testRel],
    exitCode: 1,
    failureExcerpt: `AssertionError [ERR_ASSERTION]: ${RED_MARKER} (${itemId})\n\n7 !== -7`,
    failureClass: "assertion",
    targeted: true,
  };
  appendFileSync(path.join(runDir, "evidence.jsonl"), JSON.stringify(record) + "\n");
  return record;
}

// Seed a RED item completely: the test file on disk, the §2.6 red on the ledger, and the
// item's §2.6 pointer at it (so handleVetTest never falls back).
function seedRedItem(store: StateStore, runId: string, runDir: string, itemId: string, seq: number, testRel: string, subjectRel: string): void {
  writeFileSync(path.join(store.root, testRel), assertionTest(`TEST-${itemId}`, subjectRel));
  const red = appendRed(runDir, itemId, seq, testRel);
  const item = store.loadItem(runId, itemId);
  item.evidence.red = { ledger: "evidence.jsonl", seq: red.seq };
  store.saveItem(runId, item);
}

// ---------------------------------------------------------------------------
// Fan-out wiring over the FAKE SDK, with an ITEM-AWARE responder. Every ordering claim in
// this file is read off `sdk.calls` — the fixture's monotonic seq log.
// ---------------------------------------------------------------------------

type Canned = { kind: "reply"; text: string } | { kind: "park" };

interface RespondReq {
  role: string;
  itemId: string;
  nth: number; // 0-based ordinal of this prompt among (role,itemId) prompts
  text: string;
  sessionID: string;
}

type Responder = (req: RespondReq) => Canned;

interface PromptedRecord {
  seq: number;
  role: string;
  itemId: string;
  tree: string;
  text: string;
  sessionID: string;
}

interface Wiring {
  fanout: Fanout;
  sdk: ReturnType<typeof makeFakeSdk>;
  treeState: WaveTreeState;
  prompted: PromptedRecord[];
  frozenChecks: string[];
  clears: Array<{ tree: string; callsAt: number }>;
  byRole: (role: string) => PromptedRecord[];
  byItem: (itemId: string) => PromptedRecord[];
}

// A MARKER-BACKED §3.5 tree view. `isFrozen` reads the REAL evidence.ts marker file for the
// tree (so a leaked marker really does freeze the tree the fan-out engine admits into), and
// `notifyClear` is the driver-owned release notification (P6). Every admission check and
// every clear is recorded, so the P7 row can order them against the SDK call log.
function makeTreeState(runDir: string, sdk: ReturnType<typeof makeFakeSdk>): {
  tree: WaveTreeState;
  frozenChecks: string[];
  clears: Array<{ tree: string; callsAt: number }>;
} {
  const frozenChecks: string[] = [];
  const clears: Array<{ tree: string; callsAt: number }> = [];
  const listeners: Array<(tree: string) => void> = [];
  const tree: WaveTreeState = {
    isFrozen(name: string): boolean {
      frozenChecks.push(name);
      return existsSync(markerPathOf(runDir, name));
    },
    onClear(listener: (t: string) => void): () => void {
      listeners.push(listener);
      return (): void => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    notifyClear(name: string): void {
      clears.push({ tree: name, callsAt: sdk.calls.length });
      for (const listener of [...listeners]) listener(name);
    },
  };
  return { tree, frozenChecks, clears };
}

function makeWiring(runId: string, runDir: string, config: Config, journal: JournalSink, respond: Responder): Wiring {
  const registry = new Map<string, { role: string; itemId: string; tree: string }>();
  const sdk = makeFakeSdk({ registry });
  const prompted: PromptedRecord[] = [];
  const counts = new Map<string, number>();
  sdk.setResponder((req) => {
    const role = req.entry?.role ?? "";
    const itemId = req.entry?.itemId ?? "";
    const key = `${role} ${itemId}`;
    const nth = counts.get(key) ?? 0;
    counts.set(key, nth + 1);
    prompted.push({
      seq: sdk.prompts[sdk.prompts.length - 1].seq,
      role,
      itemId,
      tree: req.entry?.tree ?? "",
      text: req.text,
      sessionID: req.sessionID,
    });
    const canned = respond({ role, itemId, nth, text: req.text, sessionID: req.sessionID });
    if (canned.kind === "park") return { kind: "pending" };
    return { kind: "reply", text: canned.text };
  });
  const recording = makeTreeState(runDir, sdk);
  const fanout = createFanout(
    sdk.client,
    config,
    journal as unknown as Parameters<typeof createFanout>[2],
    registry,
    recording.tree,
    runId,
  );
  return {
    fanout,
    sdk,
    treeState: recording.tree,
    prompted,
    frozenChecks: recording.frozenChecks,
    clears: recording.clears,
    byRole: (role: string) => prompted.filter((p) => p.role === role),
    byItem: (itemId: string) => prompted.filter((p) => p.itemId === itemId),
  };
}

// Release every parked prompt matching `match` with `text`.
function release(wiring: Wiring, match: (p: PromptedRecord) => boolean, text: string): number {
  const parked = wiring.sdk.pending.map((p) => p.sessionID);
  let released = 0;
  for (const sessionID of parked) {
    const record = wiring.prompted.find((p) => p.sessionID === sessionID);
    if (record === undefined || !match(record)) continue;
    wiring.sdk.resolvePending(sessionID, { kind: "reply", text });
    released += 1;
  }
  return released;
}

// The §2.10 IMPLEMENTER RESULT receipt every implementer/test-writer dispatch replies with.
function implJson(status = "DONE", summary = `applied the minimal change (${IMPL_MARKER})`): string {
  return JSON.stringify({ status, summary, concerns: [], neededContext: null, blockReason: null });
}

// The §2.10 TEST VET receipt a critic replies with.
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

// ---------------------------------------------------------------------------
// The ORDERED CALL LOG view. Every create carries the engine's own
// `title: "<role>:<itemId>"`, and every prompt's session was registered before it was sent
// (§3.5), so BOTH are attributable to a member. `messages` calls whose id is not a session
// are the test's own ORDERING MARKERS, injected into the same monotonic log so a rendezvous
// point can be compared against sub-session traffic without any reference to wall time.
// ---------------------------------------------------------------------------

interface LogRow {
  seq: number;
  method: string;
  role: string;
  itemId: string;
  mark: string | null;
}

function readLog(sdk: ReturnType<typeof makeFakeSdk>): LogRow[] {
  const bySession = new Map<string, { role: string; itemId: string }>();
  for (const call of sdk.calls) {
    if (call.method !== "create" || call.sessionID === undefined) continue;
    const title = (call.body as { title?: string } | undefined)?.title ?? "";
    const idx = title.indexOf(":");
    if (idx > 0) bySession.set(call.sessionID, { role: title.slice(0, idx), itemId: title.slice(idx + 1) });
  }
  return sdk.calls.map((call) => {
    const sess = call.sessionID ?? "";
    const known = bySession.get(sess);
    return {
      seq: call.seq,
      method: call.method,
      role: known?.role ?? "",
      itemId: known?.itemId ?? "",
      mark: call.method === "messages" && known === undefined ? sess : null,
    };
  });
}

// Inject an ordering marker into the SDK's own log and return its seq.
function logMark(sdk: ReturnType<typeof makeFakeSdk>, label: string): number {
  void sdk.client.session.messages({ path: { id: label } });
  return sdk.calls[sdk.calls.length - 1].seq;
}

function seqsFor(log: LogRow[], itemId: string): number[] {
  return log.filter((r) => r.itemId === itemId).map((r) => r.seq);
}

function markSeq(log: LogRow[], label: string): number {
  const row = log.find((r) => r.mark === label);
  assert.ok(row !== undefined, `the ordering marker "${label}" is in the call log`);
  return row.seq;
}

// ---------------------------------------------------------------------------
// Recording stage executors — the G2 seam. Each emits a start/end ORDERING MARKER into the
// same fake-SDK log the sub-sessions write, yields a bounded number of turns between them
// (so a driver that ran two of them concurrently would produce an OBSERVABLY interleaved
// start/end pattern), and then persists the item state through the REAL store.
// ---------------------------------------------------------------------------

interface StageEvent {
  tool: string;
  itemId: string;
  phase: "start" | "end";
  seq: number;
}

function recorder(opts: {
  sdk: ReturnType<typeof makeFakeSdk>;
  log: StageEvent[];
  advanceTo?: ItemState;
  gate?: (itemId: string) => Promise<void> | undefined;
  onStart?: (ctx: StageExecutorContext) => void;
}): StageExecutor {
  return async (ctx: StageExecutorContext): Promise<StageOutcome> => {
    opts.log.push({
      tool: ctx.tool,
      itemId: ctx.itemId,
      phase: "start",
      seq: logMark(opts.sdk, `STAGE:${ctx.tool}:${ctx.itemId}:start`),
    });
    if (opts.onStart !== undefined) opts.onStart(ctx);
    // A yield WINDOW, not a synchronization point: it only widens the opportunity for a
    // concurrent sibling execution to interleave its own markers into this span.
    await turns(3);
    const gated = opts.gate === undefined ? undefined : opts.gate(ctx.itemId);
    if (gated !== undefined) await gated;
    let state = ctx.store.loadItem(ctx.runId, ctx.itemId).state;
    if (opts.advanceTo !== undefined) {
      const item = ctx.store.loadItem(ctx.runId, ctx.itemId);
      item.state = opts.advanceTo;
      ctx.store.saveItem(ctx.runId, item);
      state = opts.advanceTo;
    }
    opts.log.push({
      tool: ctx.tool,
      itemId: ctx.itemId,
      phase: "end",
      seq: logMark(opts.sdk, `STAGE:${ctx.tool}:${ctx.itemId}:end`),
    });
    return { ok: opts.advanceTo !== undefined, itemState: state };
  };
}

function stageEvent(log: StageEvent[], tool: string, itemId: string, phase: "start" | "end"): StageEvent {
  const rows = log.filter((e) => e.tool === tool && e.itemId === itemId && e.phase === phase);
  assert.equal(rows.length, 1, `exactly one ${phase} event for ${tool} on ${itemId}`);
  return rows[0];
}

function dispositionOf(result: DispatchWaveResult, itemId: string): WaveDisposition {
  const rows = result.items.filter((row) => row.itemId === itemId);
  assert.equal(rows.length, 1, `the summary carries exactly ONE disposition row for ${itemId}`);
  return rows[0];
}

// ---------------------------------------------------------------------------
// Fixture sanity: every canned payload must satisfy the schema the fan-out engine validates
// it against, and the fixtures must be real §2.4/§2.5 records. (The 9.1–9.4b probe-block
// discipline: a red below is then about the driver, never about the fixture.)
// ---------------------------------------------------------------------------

assert.equal(
  validate("ImplementerResult", JSON.parse(implJson()) as unknown).ok,
  true,
  "sanity: the implementer receipt satisfies SCHEMAS.ImplementerResult",
);
assert.equal(
  validate("TestVet", JSON.parse(vetJson([])) as unknown).ok,
  true,
  "sanity: a clean critic receipt satisfies SCHEMAS.TestVet",
);
assert.equal(
  validate("TestVet", JSON.parse(vetJson([MUSTFIX_MARKER])) as unknown).ok,
  true,
  "sanity: a mustFix critic receipt satisfies SCHEMAS.TestVet",
);
assert.equal(
  validate("Queue", { items: [makeQueueItem("I1", { fileScope: ["src/i1.mjs"], testScope: ["tests/i1.test.mjs"] })] }).ok,
  true,
  "sanity: the behavioral queue fixture satisfies SCHEMAS.Queue",
);
assert.equal(
  validate("Queue", { items: [docsItem("I1", "docs/a.md")] }).ok,
  true,
  "sanity: the non-behavioral queue fixture satisfies SCHEMAS.Queue",
);
assert.equal(validate("Item", makeRuntimeItem("I1", "GREEN")).ok, true, "sanity: the runtime item fixture satisfies SCHEMAS.Item");
assert.ok(Object.keys(PACKS).length > 0, "sanity: the REAL doctrine packs loaded through the committed loader");
// The two fan-out sizings the batching row pins are genuinely DIFFERENT numbers.
assert.equal(readFanout("vet", makeConfig({ vetCritics: 2, maxReaders: 4 })), 2, "sanity: readFanout('vet') is the configured critic count");
assert.equal(readFanout("vet", makeConfig({ vetCritics: 1, maxReaders: 4 })), 1, "sanity: a different vetCritics is a different fan-out");

// ===========================================================================
// [9.4c-membership-nextwave]
// ===========================================================================

test("[9.4c-membership-nextwave] wave membership IS core/schedule nextWave's WavePlan and never a re-derivation: over a queue holding two ready scope-disjoint items PLUS a blocked one, a deferred one and a dependency-unready one, the driver runs pipelines for EXACTLY WavePlan.parallel (ZERO sub-sessions attributable to the excluded three), carries nextWave's rationale VERBATIM, and honours parallel.maxImplementers at TWO different caps", async () => {
  // The queue is identical in both sub-cases; only the cap differs, so a driver that
  // hardcoded "everything ready" or "the first two" cannot satisfy both.
  const build = (config: Config): {
    store: StateStore;
    runId: string;
    runDir: string;
    queue: Queue;
    wiring: Wiring;
    journal: { sink: JournalSink; records: CaptureRecord[] };
    stateHome: string;
  } => {
    const root = committedRepo();
    const stateHome = freshStateHome();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    // Every item is NON-behavioral (docs/**, disjoint from behavioralPaths "src/**"), so
    // conductor_mark_green runs no item test and the §4.2 foreign red set is empty — the
    // membership claim is then about the SCHEDULER and nothing else.
    const queue: Queue = {
      items: [
        docsItem("I1", "docs/a.md"),
        docsItem("I2", "docs/b.md"),
        docsItem("I3", "docs/c.md"),
        docsItem("I4", "docs/d.md"),
        docsItem("I5", "docs/e.md", ["I3"]),
      ],
    };
    seedPlanReviewed(store, runId, queue);
    store.setBlocked(runId, "I3", { reason: "an open question blocks this item", stage: "GREEN" });
    store.setDeferred(runId, "I4", { reason: "deferred by the operator", decisionId: "dec-fixture-1" });
    const wiring = makeWiring(runId, runDir, config, journal.sink, () => ({ kind: "reply", text: implJson() }));
    return { store, runId, runDir, queue, wiring, journal, stateHome };
  };

  await test("cap 4: the wave is the two ready scope-disjoint items", async () => {
    const config = makeConfig({ maxImplementers: 4 });
    const bench = build(config);
    const plan = expectedWave(bench.store, bench.runId, bench.queue, config);
    assert.deepEqual(plan.parallel, ["I1", "I2"], "premise: nextWave itself schedules exactly I1 and I2");

    const result: DispatchWaveResult = await handleDispatchWave({
      store: bench.store,
      fanout: bench.wiring.fanout,
      treeState: bench.wiring.treeState,
      runId: bench.runId,
      config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: "wkey",
      packs: PACKS,
      now: () => START_MS,
    });

    assert.deepEqual(result.wave.parallel, plan.parallel, "the driver's wave IS nextWave's parallel set");
    assert.equal(result.wave.rationale, plan.rationale, "the summary carries nextWave's rationale VERBATIM");
    assert.deepEqual(result.items.map((row) => row.itemId), plan.parallel, "one disposition row per wave member, in wave order");

    // The excluded three were never touched: no sub-session, no state change.
    for (const excluded of ["I3", "I4", "I5"]) {
      assert.equal(
        bench.wiring.byItem(excluded).length,
        0,
        `ZERO sub-sessions are attributable to the excluded item ${excluded}`,
      );
      assert.equal(
        readLog(bench.wiring.sdk).filter((row) => row.itemId === excluded).length,
        0,
        `not a single fake-SDK call names ${excluded}`,
      );
    }
    assert.equal(bench.store.loadItem(bench.runId, "I5").state, "PENDING", "the dependency-unready item never advanced");
    // …and the two members really did run: each spent exactly one implementer sub-session.
    assert.deepEqual(
      bench.wiring.byRole("implementer").map((p) => p.itemId).sort(),
      ["I1", "I2"],
      "exactly the wave members got an implementer sub-session",
    );
  });

  await test("cap 1: the SAME queue yields a one-member wave (the cap is nextWave's, not a constant)", async () => {
    const config = makeConfig({ maxImplementers: 1 });
    const bench = build(config);
    const plan = expectedWave(bench.store, bench.runId, bench.queue, config);
    assert.deepEqual(plan.parallel, ["I1"], "premise: at maxImplementers 1 nextWave schedules only I1");

    const result: DispatchWaveResult = await handleDispatchWave({
      store: bench.store,
      fanout: bench.wiring.fanout,
      treeState: bench.wiring.treeState,
      runId: bench.runId,
      config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: "wkey",
      packs: PACKS,
      now: () => START_MS,
    });

    assert.deepEqual(result.wave.parallel, ["I1"], "the driver honours parallel.maxImplementers through nextWave");
    assert.equal(result.wave.rationale, plan.rationale, "the rationale is nextWave's, at this cap too");
    assert.equal(result.items.length, 1, "one disposition row for the one member");
    assert.equal(bench.wiring.byItem("I2").length, 0, "the capped-out READY item got no sub-session at all");
    assert.equal(bench.store.loadItem(bench.runId, "I2").state, "PENDING", "the capped-out item did not advance");
  });
});

// ===========================================================================
// [9.4c-first-call-executing]
// ===========================================================================

test("[9.4c-first-call-executing] the FIRST call performs PLAN_REVIEWED->EXECUTING (persisted through the store, journaled as fsm/transition in the CLOSED §7.4 vocabulary); a repeat call on an already-EXECUTING run performs NO further run transition; and an EMPTY first wave still transitions, returning a zero-member summary with nextWave's own no-items rationale", async () => {
  await test("first call transitions, and the repeat call does not", async () => {
    const root = committedRepo();
    const stateHome = freshStateHome();
    const config = makeConfig();
    const boot = makeJournal();
    const store = openStore(root, boot.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    // The REAL journal: it THROWS on any event outside core/journal-events EVENTS, so a
    // driver that invented a name fails loudly rather than widening §7.4.
    const journal = makeRealJournal(runDir, config);
    const queue: Queue = { items: [docsItem("I1", "docs/a.md"), docsItem("I2", "docs/b.md")] };
    seedPlanReviewed(store, runId, queue);
    const wiring = makeWiring(runId, runDir, config, journal.sink, () => ({ kind: "reply", text: implJson() }));
    const stageLog: StageEvent[] = [];
    // A stage that RUNS and does not advance (P3) leaves the wave schedulable, so the
    // SECOND call has real work to be legal for — which is what makes the "no further
    // transition" claim non-vacuous.
    const executors = { conductor_mark_green: recorder({ sdk: wiring.sdk, log: stageLog }) };

    const input = {
      store,
      fanout: wiring.fanout,
      treeState: wiring.treeState,
      runId,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wkey",
      packs: PACKS,
      now: () => START_MS,
      executors,
    };

    const first: DispatchWaveResult = await handleDispatchWave(input);
    assert.equal(first.runState, "EXECUTING", "the first call reports the run at EXECUTING");
    assert.equal(store.loadRun(runId).state, "EXECUTING", "run.json PERSISTS EXECUTING through the store");
    const firstEdges = transitionsTo(journal.records, "PLAN_REVIEWED", "EXECUTING");
    assert.equal(firstEdges.length, 1, "exactly ONE fsm/transition PLAN_REVIEWED->EXECUTING was journaled");
    assert.equal(firstEdges[0].component, "fsm", "the edge is journaled under the fsm component");
    assert.equal(
      isKnownEvent(firstEdges[0].component, firstEdges[0].event),
      true,
      "the event name is inside the CLOSED §7.4 vocabulary (nothing widened it)",
    );
    assert.equal(firstEdges[0].corr.runId, runId, "the record is correlated to the run");
    assert.deepEqual(
      first.items.map((row) => row.stoppedAt),
      ["conductor_mark_green", "conductor_mark_green"],
      "a stage that ran without advancing STOPS the member, naming that stage (P3)",
    );
    assert.deepEqual(first.items.map((row) => row.envError), [null, null], "…and that is not an environment failure");

    const second: DispatchWaveResult = await handleDispatchWave(input);
    assert.equal(second.runState, "EXECUTING", "the repeat call reports EXECUTING");
    assert.equal(store.loadRun(runId).state, "EXECUTING", "…and run.json is still EXECUTING");
    assert.equal(
      transitionsTo(journal.records, "PLAN_REVIEWED", "EXECUTING").length,
      1,
      "the repeat call performs NO further run transition: still exactly one journaled edge",
    );
    assert.deepEqual(second.wave.parallel, ["I1", "I2"], "the second call scheduled the still-open items (the Gap-1 legality path)");
    assert.equal(stageLog.filter((e) => e.phase === "start").length, 4, "both calls really ran both members' stage");
  });

  await test("an EMPTY first wave still transitions", async () => {
    const root = committedRepo();
    const stateHome = freshStateHome();
    const config = makeConfig();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    const queue: Queue = { items: [docsItem("I1", "docs/a.md"), docsItem("I2", "docs/b.md")] };
    seedPlanReviewed(store, runId, queue);
    // Every item blocked at the plan-review cap ⇒ nextWave schedules nothing.
    store.setBlocked(runId, "I1", { reason: "a surviving major blocks this item", stage: "GREEN" });
    store.setBlocked(runId, "I2", { reason: "a surviving major blocks this item", stage: "GREEN" });
    const plan = expectedWave(store, runId, queue, config);
    assert.deepEqual(plan.parallel, [], "premise: nextWave schedules nothing over an all-blocked queue");

    const wiring = makeWiring(runId, runDir, config, journal.sink, () => ({ kind: "reply", text: implJson() }));
    const result: DispatchWaveResult = await handleDispatchWave({
      store,
      fanout: wiring.fanout,
      treeState: wiring.treeState,
      runId,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wkey",
      packs: PACKS,
      now: () => START_MS,
    });

    assert.equal(result.runState, "EXECUTING", "G6: the transition is UNCONDITIONAL on the first call");
    assert.equal(store.loadRun(runId).state, "EXECUTING", "run.json persists EXECUTING, so conductor_report is reachable");
    assert.deepEqual(result.wave.parallel, [], "the wave is empty");
    assert.equal(result.wave.rationale, plan.rationale, "the summary carries nextWave's OWN no-items rationale, verbatim");
    assert.deepEqual(result.items, [], "a zero-member wave returns a zero-row summary");
    assert.equal(wiring.sdk.calls.length, 0, "nothing was dispatched for an empty wave");
  });
});

// ===========================================================================
// [9.4c-binding-p3-transition-context] — MANDATORY DEFERRED BINDING (P3)
// ===========================================================================

test("[9.4c-binding-p3-transition-context] MANDATORY DEFERRED BINDING (P3): the PLAN_REVIEWED->EXECUTING edge goes through core/fsm-run legalRunTransition with a context DERIVED FROM PERSISTED STATE — Run carries planReviewRounds, not survivingMajors — so a run below the cap passes survivingMajors:0 and a run AT the cap passes {round,max}; BOTH persisted shapes advance to EXECUTING and a clean plan review never livelocks entry to EXECUTING", async () => {
  // The journaled `why` is compared VERBATIM against core's own string for the context the
  // handler must have derived. A handler that always passed {round,max} fails the clean
  // case (0 < 3 is not the cap, so the edge would be refused); a handler that always passed
  // survivingMajors:0 fails the cap case (core would emit the CLEAN rationale instead).
  const run = async (opts: { planReviewRounds: number; planReviewMaxRounds: number }): Promise<{ why: unknown; state: RunState }> => {
    const root = committedRepo();
    const stateHome = freshStateHome();
    const config = makeConfig({ planReviewMaxRounds: opts.planReviewMaxRounds });
    const boot = makeJournal();
    const store = openStore(root, boot.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    const journal = makeRealJournal(runDir, config);
    const queue: Queue = { items: [docsItem("I1", "docs/a.md")] };
    seedPlanReviewed(store, runId, queue, {}, opts.planReviewRounds);
    assert.equal(store.loadRun(runId).planReviewRounds, opts.planReviewRounds, "premise: the round count is PERSISTED on the run");

    const wiring = makeWiring(runId, runDir, config, journal.sink, () => ({ kind: "reply", text: implJson() }));
    const stageLog: StageEvent[] = [];
    const result: DispatchWaveResult = await handleDispatchWave({
      store,
      fanout: wiring.fanout,
      treeState: wiring.treeState,
      runId,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wkey",
      packs: PACKS,
      now: () => START_MS,
      executors: { conductor_mark_green: recorder({ sdk: wiring.sdk, log: stageLog }) },
    });
    assert.equal(result.runState, "EXECUTING", "the run advanced");
    const edges = transitionsTo(journal.records, "PLAN_REVIEWED", "EXECUTING");
    assert.equal(edges.length, 1, "exactly one PLAN_REVIEWED->EXECUTING edge was journaled");
    return { why: edges[0].data["why"], state: store.loadRun(runId).state };
  };

  await test("clean exit (planReviewRounds BELOW the cap) advances with survivingMajors:0", async () => {
    const observed = await run({ planReviewRounds: 0, planReviewMaxRounds: 3 });
    assert.equal(observed.state, "EXECUTING", "a clean plan review must NEVER livelock entry to EXECUTING");
    const core = legalRunTransition("PLAN_REVIEWED", "EXECUTING", { survivingMajors: 0 });
    assert.equal(core.ok, true, "premise: core admits the clean-exit context");
    assert.equal(
      observed.why,
      core.why,
      "the journaled rationale is core legalRunTransition's OWN string for {survivingMajors:0} — the gate was consulted, not re-derived",
    );
  });

  await test("cap exit (planReviewRounds AT a DIFFERENT cap) advances with {round,max}", async () => {
    const observed = await run({ planReviewRounds: 2, planReviewMaxRounds: 2 });
    assert.equal(observed.state, "EXECUTING", "at the cap the run still advances, surfacing majors as questions");
    const core = legalRunTransition("PLAN_REVIEWED", "EXECUTING", { round: 2, max: 2 });
    assert.equal(core.ok, true, "premise: core admits the cap-exit context");
    assert.equal(
      observed.why,
      core.why,
      "the journaled rationale is core's OWN cap string for {round:2,max:2} — derived from the PERSISTED planReviewRounds",
    );
    assert.notEqual(
      observed.why,
      legalRunTransition("PLAN_REVIEWED", "EXECUTING", { survivingMajors: 0 }).why,
      "…and it is NOT the clean-exit rationale: the two persisted shapes take different arms of the gate",
    );
  });
});

// ===========================================================================
// [9.4c-gate-offers-wave-while-schedulable] — the Gap-1 fix, through the PURE gate
// ===========================================================================

test("[9.4c-gate-offers-wave-while-schedulable] the Gap-1 fix asserted through the PURE gate: core/gates-phase legalTools offers conductor_dispatch_wave in EXECUTING whenever the wave is non-empty, and does NOT offer it once every item is settled — while `recommended` is UNCHANGED in both cases, so a second dispatch_wave call on a multi-wave run passes the same legality step the first did", () => {
  const EXECUTING_RUN: GateRun = { state: "EXECUTING", stop: null, classification: { kind: "work" } };
  const PLAN_REVIEWED_RUN: GateRun = { state: "PLAN_REVIEWED", stop: null, classification: { kind: "work" } };

  const item = (id: string, state: string, over: Partial<GateItem> = {}): GateItem => ({
    id,
    state,
    behavioral: true,
    dependsOn: [],
    fileScope: [`src/${id}.mjs`],
    blocked: null,
    deferred: null,
    ...over,
  });

  // (a) a schedulable wave in EXECUTING: dispatch_wave IS offered, argless (a meta tool).
  const open = [item("I1", "PENDING"), item("I2", "GREEN")];
  const openVerdict = legalTools(EXECUTING_RUN, open, [], true);
  assert.equal(
    openVerdict.legal.has("conductor_dispatch_wave"),
    true,
    "EXECUTING with a non-empty wave OFFERS conductor_dispatch_wave (the Gap-1 fix)",
  );
  assert.deepEqual(
    openVerdict.legal.get("conductor_dispatch_wave"),
    {},
    "it is a meta tool: it carries no per-item argsHint",
  );
  // `recommended` is UNCHANGED: still the §4.2 wave-order-first item's stage tool.
  assert.deepEqual(
    openVerdict.recommended,
    { tool: "conductor_submit_test", args: { itemId: "I1" } },
    "the recommendation is untouched — the per-item stage tool stays the recommendation",
  );
  assert.equal(openVerdict.legal.has("conductor_submit_test"), true, "…and every committed per-item offer still stands");
  assert.deepEqual(openVerdict.legal.get("conductor_validate")?.itemIds, ["I2"], "…for every actionable item");

  // (b) every item settled: the wave is empty, so dispatch_wave is NOT offered and the
  //     report recommendation is untouched.
  const settled = [item("I1", "PUBLISHED"), item("I2", "PUBLISHED")];
  const settledVerdict = legalTools(EXECUTING_RUN, settled, [], true);
  assert.equal(
    settledVerdict.legal.has("conductor_dispatch_wave"),
    false,
    "with every item settled the wave is empty, so conductor_dispatch_wave is NOT offered",
  );
  assert.deepEqual(
    settledVerdict.recommended,
    { tool: "conductor_report", args: {} },
    "the settled recommendation is unchanged: conductor_report closes the run",
  );

  // (c) unsettled but UNSCHEDULABLE (every item blocked): still no offer — the offer keys
  //     off the WAVE, not merely off "not all published".
  const blocked = [
    item("I1", "PENDING", { blocked: { reason: "an open question blocks it" } }),
    item("I2", "GREEN", { blocked: { reason: "an open question blocks it" } }),
  ];
  const blockedVerdict = legalTools(EXECUTING_RUN, blocked, [], true);
  assert.equal(
    blockedVerdict.legal.has("conductor_dispatch_wave"),
    false,
    "an EMPTY wave is not offered dispatch_wave even though nothing is PUBLISHED",
  );

  // (d) the committed PLAN_REVIEWED row is untouched by the fix.
  const planned = legalTools(PLAN_REVIEWED_RUN, open, [], true);
  assert.equal(planned.legal.has("conductor_dispatch_wave"), true, "PLAN_REVIEWED still offers conductor_dispatch_wave");
  assert.deepEqual(
    planned.recommended,
    { tool: "conductor_dispatch_wave", args: {} },
    "…and still RECOMMENDS it there (§3.2) — the committed row is unchanged",
  );
});

// ===========================================================================
// [9.4c-interleaving]
// ===========================================================================

test("[9.4c-interleaving] the driver runs TWO members' pipelines concurrently through the SHARED fan-out engine, and the fake SDK's ORDERED CALL LOG proves interleaving: both members' read sub-sessions are simultaneously in flight, at least one of item I2's calls lands STRICTLY BETWEEN two of item I1's (and vice versa), and neither member is a full serial drain of the other", async () => {
  const root = committedRepo();
  const stateHome = freshStateHome();
  const config = makeConfig({ vetCritics: 2, maxReaders: 4 });
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  const queue: Queue = {
    items: [
      makeQueueItem("I1", { fileScope: ["src/i1.mjs"], testScope: ["tests/i1.test.mjs"] }),
      makeQueueItem("I2", { fileScope: ["src/i2.mjs"], testScope: ["tests/i2.test.mjs"] }),
    ],
  };
  seedPlanReviewed(store, runId, queue, { I1: "RED", I2: "RED" });
  seedRedItem(store, runId, runDir, "I1", 1, "tests/i1.test.mjs", "../src/i1.mjs");
  seedRedItem(store, runId, runDir, "I2", 2, "tests/i2.test.mjs", "../src/i2.mjs");

  const wiring = makeWiring(runId, runDir, config, journal.sink, (req) =>
    req.role === "reviewer" ? { kind: "park" } : { kind: "reply", text: implJson() },
  );
  const stageLog: StageEvent[] = [];
  const critics = readFanout("vet", config);

  const pending = handleDispatchWave({
    store,
    fanout: wiring.fanout,
    treeState: wiring.treeState,
    runId,
    config,
    journal: journal.sink,
    stateHome,
    workspaceKey: "wkey",
    packs: PACKS,
    now: () => START_MS,
    // The stage AFTER vet is pinned by a recording executor so this row stays about
    // concurrency and not about the item test.
    executors: { conductor_mark_green: recorder({ sdk: wiring.sdk, log: stageLog }) },
  }) as Promise<DispatchWaveResult>;

  // THE RENDEZVOUS: every critic sub-session of BOTH members is parked at once. The
  // predicate is the synchronization; nothing here waits on a clock.
  await until(
    () => wiring.sdk.pending.length === critics * 2,
    `all ${critics * 2} critic sub-sessions (both members') are simultaneously parked in flight`,
  );
  const parkedItems = wiring.sdk.pending
    .map((p) => wiring.prompted.find((row) => row.sessionID === p.sessionID)?.itemId ?? "")
    .sort();
  assert.deepEqual(
    parkedItems,
    ["I1", "I1", "I2", "I2"],
    "BOTH members have sub-sessions in flight AT THE SAME TIME — no orchestrator-driven design could deliver this",
  );

  // The ordered call log, at the moment both members are in flight.
  const inFlightLog = readLog(wiring.sdk);
  const a = seqsFor(inFlightLog, "I1");
  const b = seqsFor(inFlightLog, "I2");
  assert.ok(a.length >= 2 && b.length >= 2, "both members produced multiple calls");
  assert.ok(
    b.some((seq) => seq > Math.min(...a) && seq < Math.max(...a)),
    "at least one of I2's calls lands STRICTLY BETWEEN two of I1's calls",
  );
  assert.ok(
    a.some((seq) => seq > Math.min(...b) && seq < Math.max(...b)),
    "…and at least one of I1's calls lands STRICTLY BETWEEN two of I2's",
  );
  assert.ok(Math.max(...a) > Math.min(...b), "I1 was NOT fully drained before I2 began");
  assert.ok(Math.max(...b) > Math.min(...a), "…and I2 was not fully drained before I1 began");

  release(wiring, () => true, vetJson([]));
  const result = await pending;

  assert.deepEqual(result.wave.parallel, ["I1", "I2"], "both items were wave members");
  assert.equal(store.loadItem(runId, "I1").state, "TEST_VETTED", "I1 advanced through its vet stage");
  assert.equal(store.loadItem(runId, "I2").state, "TEST_VETTED", "I2 advanced through its vet stage");
  assert.equal(
    wiring.byRole("reviewer").length,
    critics * 2,
    "exactly readFanout('vet') critics per member ran, through the ONE shared engine",
  );
  assert.equal(stageLog.filter((e) => e.phase === "start").length, 2, "both members reached the next stage");
});

// ===========================================================================
// [9.4c-stage-batching]
// ===========================================================================

test("[9.4c-stage-batching] like stages BATCH across members: when both members reach the vet stage BOTH items' critics dispatch as ONE fanout group carrying readFanout('vet', config) critics per member (pinned at TWO different fan-outs), the group is one CONTIGUOUS run in the ordered call log, no member advances past the batched stage while a sibling's critic is still in flight, and a member that has DROPPED OUT is absent from every later group without delaying anything", async () => {
  interface Bench {
    store: StateStore;
    runId: string;
    runDir: string;
    queue: Queue;
    wiring: Wiring;
    journal: { sink: JournalSink; records: CaptureRecord[] };
    stateHome: string;
  }
  const build = (config: Config, respond: Responder): Bench => {
    const root = committedRepo();
    const stateHome = freshStateHome();
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    const queue: Queue = {
      items: [
        makeQueueItem("I1", { fileScope: ["src/i1.mjs"], testScope: ["tests/i1.test.mjs"] }),
        makeQueueItem("I2", { fileScope: ["src/i2.mjs"], testScope: ["tests/i2.test.mjs"] }),
      ],
    };
    seedPlanReviewed(store, runId, queue, { I1: "RED", I2: "RED" });
    seedRedItem(store, runId, runDir, "I1", 1, "tests/i1.test.mjs", "../src/i1.mjs");
    seedRedItem(store, runId, runDir, "I2", 2, "tests/i2.test.mjs", "../src/i2.mjs");
    const wiring = makeWiring(runId, runDir, config, journal.sink, respond);
    return { store, runId, runDir, queue, wiring, journal, stateHome };
  };

  await test("vetCritics 2: one contiguous group of 4, and no member escapes the batch while a sibling is parked", async () => {
    const config = makeConfig({ vetCritics: 2, maxReaders: 4, vetMaxRounds: 2 });
    const critics = readFanout("vet", config);
    assert.equal(critics, 2, "premise: this sub-case's fan-out is 2 critics per member");
    // I1's critics reply IMMEDIATELY; I2's PARK. An unbatched driver would let I1 run
    // ahead into its next stage while I2 is still parked.
    const bench = build(config, (req) => {
      if (req.role !== "reviewer") return { kind: "reply", text: implJson() };
      return req.itemId === "I2" ? { kind: "park" } : { kind: "reply", text: vetJson([]) };
    });
    const stageLog: StageEvent[] = [];

    const pending = handleDispatchWave({
      store: bench.store,
      fanout: bench.wiring.fanout,
      treeState: bench.wiring.treeState,
      runId: bench.runId,
      config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: "wkey",
      packs: PACKS,
      now: () => START_MS,
      executors: { conductor_mark_green: recorder({ sdk: bench.wiring.sdk, log: stageLog, advanceTo: "GREEN" }) },
    }) as Promise<DispatchWaveResult>;

    // RENDEZVOUS: every critic prompt of BOTH members has been ISSUED (I1's already
    // answered, I2's parked). The predicate is the synchronization.
    await until(
      () => bench.wiring.byRole("reviewer").length === critics * 2,
      `all ${critics * 2} critic prompts have been issued`,
    );
    // A bounded yield window: it can only give an UNBATCHED driver more opportunity to
    // emit I1's next-stage marker BEFORE the release marker below, which is precisely the
    // failure this assertion claims does not happen.
    await turns();
    const releaseSeq = logMark(bench.wiring.sdk, "RELEASE-I2-CRITICS");
    assert.equal(
      stageLog.length,
      0,
      "no member has entered the NEXT stage while a sibling's critic is still in flight (the batch is a barrier)",
    );
    assert.equal(release(bench.wiring, (p) => p.itemId === "I2", vetJson([])), critics, "I2's parked critics were released");

    const result = await pending;
    const log = readLog(bench.wiring.sdk);

    // The batch: exactly readFanout('vet') critics PER MEMBER.
    assert.equal(bench.wiring.byRole("reviewer").filter((p) => p.itemId === "I1").length, critics, "I1 got readFanout('vet') critics");
    assert.equal(bench.wiring.byRole("reviewer").filter((p) => p.itemId === "I2").length, critics, "I2 got readFanout('vet') critics");

    // ONE CONTIGUOUS dispatch group: between the first and last critic call, the log holds
    // nothing but critic traffic (the test's own ordering markers excluded).
    const criticSeqs = log.filter((r) => r.role === "reviewer").map((r) => r.seq);
    const span = log.filter((r) => r.seq > Math.min(...criticSeqs) && r.seq < Math.max(...criticSeqs) && r.mark === null);
    assert.deepEqual(
      [...new Set(span.map((r) => r.role))],
      ["reviewer"],
      "the critics form ONE contiguous dispatch group: no other role's traffic interleaves the span",
    );
    assert.deepEqual(
      [...new Set(log.filter((r) => r.role === "reviewer").map((r) => r.itemId))].sort(),
      ["I1", "I2"],
      "…and BOTH members' critics are inside that one group",
    );

    // THE BATCH BARRIER, ordered against the release rendezvous: I1's next stage begins
    // only AFTER I2's critics were released.
    const nextStage = stageEvent(stageLog, "conductor_mark_green", "I1", "start");
    assert.ok(
      nextStage.seq > releaseSeq,
      "I1 did not advance past the batched vet stage until its sibling's critics completed",
    );
    assert.equal(result.items.length, 2, "both members are in the summary");
  });

  await test("vetCritics 1: a DIFFERENT fan-out, so the per-member count is readFanout's and not a constant", async () => {
    const config = makeConfig({ vetCritics: 1, maxReaders: 4, vetMaxRounds: 2 });
    const critics = readFanout("vet", config);
    assert.equal(critics, 1, "premise: this sub-case's fan-out is 1 critic per member");
    const bench = build(config, (req) =>
      req.role === "reviewer" ? { kind: "reply", text: vetJson([]) } : { kind: "reply", text: implJson() },
    );
    const stageLog: StageEvent[] = [];

    const result: DispatchWaveResult = await handleDispatchWave({
      store: bench.store,
      fanout: bench.wiring.fanout,
      treeState: bench.wiring.treeState,
      runId: bench.runId,
      config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: "wkey",
      packs: PACKS,
      now: () => START_MS,
      executors: { conductor_mark_green: recorder({ sdk: bench.wiring.sdk, log: stageLog }) },
    });

    assert.equal(bench.wiring.byRole("reviewer").length, critics * 2, "the batch carries readFanout('vet') critics PER MEMBER");
    assert.equal(bench.wiring.byRole("reviewer").filter((p) => p.itemId === "I1").length, critics, "…one for I1");
    assert.equal(bench.wiring.byRole("reviewer").filter((p) => p.itemId === "I2").length, critics, "…one for I2");
    assert.equal(result.items.length, 2, "both members are in the summary");
  });

  await test("a DROPPED-OUT member is absent from every later group and delays nothing", async () => {
    // vetMaxRounds 1 + a mustFix for I2 ⇒ I2 blocks at the vet cap and leaves the wave.
    const config = makeConfig({ vetCritics: 1, maxReaders: 4, vetMaxRounds: 1 });
    const bench = build(config, (req) => {
      if (req.role !== "reviewer") return { kind: "reply", text: implJson() };
      return { kind: "reply", text: req.itemId === "I2" ? vetJson([MUSTFIX_MARKER]) : vetJson([]) };
    });
    const stageLog: StageEvent[] = [];

    const result: DispatchWaveResult = await handleDispatchWave({
      store: bench.store,
      fanout: bench.wiring.fanout,
      treeState: bench.wiring.treeState,
      runId: bench.runId,
      config,
      journal: bench.journal.sink,
      stateHome: bench.stateHome,
      workspaceKey: "wkey",
      packs: PACKS,
      now: () => START_MS,
      executors: { conductor_mark_green: recorder({ sdk: bench.wiring.sdk, log: stageLog }) },
    });

    assert.notEqual(bench.store.loadItem(bench.runId, "I2").blocked, null, "I2 dropped out at the vet cap (read back through the store)");
    assert.deepEqual(
      stageLog.map((e) => e.itemId),
      ["I1", "I1"],
      "the LATER group holds only the surviving member: I2 is absent from it",
    );
    const lastI2 = Math.max(...seqsFor(readLog(bench.wiring.sdk), "I2"));
    assert.ok(
      stageEvent(stageLog, "conductor_mark_green", "I1", "start").seq > lastI2,
      "the survivor proceeded after the drop-out landed — and without waiting on it",
    );
    assert.equal(dispositionOf(result, "I1").blocked, null, "the survivor is not blocked");
    assert.notEqual(dispositionOf(result, "I2").blocked, null, "the drop-out is reported blocked in the summary");
  });
});

// ===========================================================================
// [9.4c-writes-serialize]
// ===========================================================================

test("[9.4c-writes-serialize] writes SERIALIZE per tree (the §4.2 ordering guarantee the DRIVER owns; parallel.writes 'off' means one shared tree): read-stage sub-sessions overlap freely, but at most ONE write-capable implementer sub-session is ever in flight in the shared tree — I1's and I2's implementer sessions never overlap — and the freeze-admission mechanism is REUSED from the fan-out engine, never reimplemented", async () => {
  await test("readers overlap freely in the shared tree", async () => {
    const root = committedRepo();
    const stateHome = freshStateHome();
    const config = makeConfig({ vetCritics: 2, maxReaders: 4 });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    const queue: Queue = {
      items: [
        makeQueueItem("I1", { fileScope: ["src/i1.mjs"], testScope: ["tests/i1.test.mjs"] }),
        makeQueueItem("I2", { fileScope: ["src/i2.mjs"], testScope: ["tests/i2.test.mjs"] }),
      ],
    };
    seedPlanReviewed(store, runId, queue, { I1: "RED", I2: "RED" });
    seedRedItem(store, runId, runDir, "I1", 1, "tests/i1.test.mjs", "../src/i1.mjs");
    seedRedItem(store, runId, runDir, "I2", 2, "tests/i2.test.mjs", "../src/i2.mjs");
    const wiring = makeWiring(runId, runDir, config, journal.sink, (req) =>
      req.role === "reviewer" ? { kind: "park" } : { kind: "reply", text: implJson() },
    );
    const stageLog: StageEvent[] = [];

    const pending = handleDispatchWave({
      store,
      fanout: wiring.fanout,
      treeState: wiring.treeState,
      runId,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wkey",
      packs: PACKS,
      now: () => START_MS,
      executors: { conductor_mark_green: recorder({ sdk: wiring.sdk, log: stageLog }) },
    }) as Promise<DispatchWaveResult>;

    await until(() => wiring.sdk.pending.length === 4, "all four reader sub-sessions are parked at once");
    assert.equal(wiring.sdk.inFlightCount(), 4, "FOUR read sub-sessions are simultaneously in flight in the shared tree");
    assert.deepEqual(
      wiring.frozenChecks,
      [],
      "readers are never write-capable: the engine made NO freeze-admission check for any of them",
    );
    release(wiring, () => true, vetJson([]));
    await pending;
  });

  await test("write-capable implementer sub-sessions never overlap", async () => {
    const root = committedRepo();
    const stateHome = freshStateHome();
    const config = makeConfig({ maxReaders: 4 });
    const journal = makeJournal();
    const store = openStore(root, journal.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    // NON-behavioral members: conductor_mark_green then dispatches the implementer and runs
    // NO item test, so this row is purely about write-capable dispatch ordering.
    const queue: Queue = { items: [docsItem("I1", "docs/a.md"), docsItem("I2", "docs/b.md")] };
    seedPlanReviewed(store, runId, queue);
    const wiring = makeWiring(runId, runDir, config, journal.sink, (req) =>
      req.role === "implementer" ? { kind: "park" } : { kind: "reply", text: implJson() },
    );
    const stageLog: StageEvent[] = [];

    const pending = handleDispatchWave({
      store,
      fanout: wiring.fanout,
      treeState: wiring.treeState,
      runId,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wkey",
      packs: PACKS,
      now: () => START_MS,
      // conductor_validate is pinned by a recording executor: this row is about the WRITE
      // stage, and the real verify lands in the P7 row.
      executors: { conductor_validate: recorder({ sdk: wiring.sdk, log: stageLog }) },
    }) as Promise<DispatchWaveResult>;

    const implementers = (): PromptedRecord[] => wiring.byRole("implementer");
    await until(() => implementers().length >= 1, "the first write-capable implementer sub-session is in flight");
    // A bounded yield window: it can only give a driver that dispatched both writers
    // concurrently more opportunity to emit the second one before the assertion below.
    await turns();
    assert.equal(implementers().length, 1, "at most ONE write-capable implementer sub-session is in flight in the shared tree");
    assert.equal(wiring.sdk.inFlightCount(), 1, "…and it is the only sub-session parked at all");
    const firstItem = implementers()[0].itemId;
    assert.equal(firstItem, "I1", "the write stages are entered in §4.2 wave order (DAG depth then id)");

    const releaseSeq = logMark(wiring.sdk, "RELEASE-FIRST-WRITER");
    assert.equal(release(wiring, (p) => p.role === "implementer", implJson()), 1, "the first writer was released");
    await until(() => implementers().length === 2, "the SECOND write-capable implementer sub-session is dispatched");
    const secondPrompt = implementers()[1];
    assert.equal(secondPrompt.itemId, "I2", "the second writer is the second wave member");
    assert.ok(
      secondPrompt.seq > releaseSeq,
      "I2's implementer session began only AFTER I1's was released: the two never overlap in the shared tree",
    );
    await turns();
    assert.equal(wiring.sdk.inFlightCount(), 1, "still exactly one write-capable session in flight");
    release(wiring, (p) => p.role === "implementer", implJson());

    const result = await pending;
    // The freeze-admission mechanism is REUSED: the engine consults isFrozen for the
    // write-capable jobs, and every check names the ONE shared tree.
    assert.ok(
      wiring.frozenChecks.length >= 2,
      "the engine's freeze admission was consulted for each write-capable job (the §3.5 mechanism is reused, not reimplemented)",
    );
    assert.deepEqual([...new Set(wiring.frozenChecks)], [TREE], "every freeze-admission check named the ONE shared tree");
    assert.deepEqual(
      wiring.byRole("implementer").map((p) => p.tree),
      [TREE, TREE],
      "both write-capable jobs claimed the SAME shared tree (parallel.writes 'off')",
    );
    assert.equal(store.loadItem(runId, "I1").state, "GREEN", "I1's write stage completed");
    assert.equal(store.loadItem(runId, "I2").state, "GREEN", "I2's write stage completed");
    assert.equal(result.items.length, 2, "both members are in the summary");
  });
});

// ===========================================================================
// [9.4c-publish-order]
// ===========================================================================

test("[9.4c-publish-order] publish is SERIAL in item order: the REVIEWED->PUBLISHED stage executions run strictly one at a time in the deterministic §4.2 wave order (DAG depth then id), item I2's publish never beginning before item I1's completes even though I2 reached REVIEWED FIRST (the git index is a singleton). Pinned through the injected stage-executor seam because conductor_publish lands at 9.5b", async () => {
  const root = committedRepo();
  const stateHome = freshStateHome();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  const queue: Queue = { items: [docsItem("I1", "docs/a.md"), docsItem("I2", "docs/b.md")] };
  seedPlanReviewed(store, runId, queue, { I1: "VALIDATED", I2: "VALIDATED" });
  const plan = expectedWave(store, runId, queue, config);
  assert.deepEqual(plan.parallel, ["I1", "I2"], "premise: the §4.2 wave order is I1 then I2 (DAG depth then id)");

  const wiring = makeWiring(runId, runDir, config, journal.sink, () => ({ kind: "reply", text: implJson() }));
  const stageLog: StageEvent[] = [];

  // I1's item review PARKS until the test releases it, so I2 reaches REVIEWED FIRST.
  let releaseReview: (() => void) | null = null;
  const reviewGate = new Promise<void>((resolve) => {
    releaseReview = resolve;
  });
  const executors = {
    conductor_item_review: recorder({
      sdk: wiring.sdk,
      log: stageLog,
      advanceTo: "REVIEWED",
      gate: (itemId) => (itemId === "I1" ? reviewGate : undefined),
    }),
    conductor_publish: recorder({ sdk: wiring.sdk, log: stageLog, advanceTo: "PUBLISHED" }),
  };

  const pending = handleDispatchWave({
    store,
    fanout: wiring.fanout,
    treeState: wiring.treeState,
    runId,
    config,
    journal: journal.sink,
    stateHome,
    workspaceKey: "wkey",
    packs: PACKS,
    now: () => START_MS,
    executors,
  }) as Promise<DispatchWaveResult>;

  // RENDEZVOUS: I2 has finished its review (it reached REVIEWED first); only then is I1's
  // review released. The predicate is the synchronization.
  await until(
    () => stageLog.some((e) => e.tool === "conductor_item_review" && e.itemId === "I2" && e.phase === "end"),
    "I2 finished its item review while I1's was still parked",
  );
  assert.equal(store.loadItem(runId, "I2").state, "REVIEWED", "I2 really did reach REVIEWED first");
  assert.equal(store.loadItem(runId, "I1").state, "VALIDATED", "…while I1 was still in review");
  assert.ok(releaseReview !== null, "the review gate was installed");
  (releaseReview as unknown as () => void)();

  const result = await pending;

  // I2 reached REVIEWED first…
  assert.ok(
    stageEvent(stageLog, "conductor_item_review", "I2", "end").seq <
      stageEvent(stageLog, "conductor_item_review", "I1", "end").seq,
    "premise held all the way through: I2 completed its review BEFORE I1 did",
  );
  // …and publish still ran I1 first, strictly one at a time.
  const p1Start = stageEvent(stageLog, "conductor_publish", "I1", "start").seq;
  const p1End = stageEvent(stageLog, "conductor_publish", "I1", "end").seq;
  const p2Start = stageEvent(stageLog, "conductor_publish", "I2", "start").seq;
  const p2End = stageEvent(stageLog, "conductor_publish", "I2", "end").seq;
  assert.ok(p1Start < p1End, "I1's publish spans a real window");
  assert.ok(p1End < p2Start, "I2's publish NEVER begins before I1's completes — the git index is a singleton");
  assert.ok(p2Start < p2End, "I2's publish spans a real window");
  assert.deepEqual(
    stageLog.filter((e) => e.tool === "conductor_publish").map((e) => `${e.itemId}:${e.phase}`),
    ["I1:start", "I1:end", "I2:start", "I2:end"],
    "the publish executions are STRICTLY serial, in §4.2 wave order",
  );
  assert.equal(store.loadItem(runId, "I1").state, "PUBLISHED", "I1 published");
  assert.equal(store.loadItem(runId, "I2").state, "PUBLISHED", "I2 published");
  assert.deepEqual(result.items.map((row) => row.state), ["PUBLISHED", "PUBLISHED"], "the summary reports both published");
});

// ===========================================================================
// [9.4c-missing-stage-stops-honestly] — the G4 half of the Gap-2 resolution
// ===========================================================================

test("[9.4c-missing-stage-stops-honestly] with the DEFAULT executor table (only handlers committed at HEAD), a member that reaches a stage no committed handler serves STOPS there and is reported with a disposition NAMING the missing stage: the driver neither throws 'not implemented', nor silently skips the stage, nor advances the item past work that never happened — and it names EACH member's OWN missing stage", async () => {
  const root = committedRepo();
  const stateHome = freshStateHome();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  // I1 owes conductor_item_review (9.5a); I2 owes conductor_publish (9.5b). Two DIFFERENT
  // missing stages, so a hardcoded stage name cannot satisfy both rows.
  const queue: Queue = { items: [docsItem("I1", "docs/a.md"), docsItem("I2", "docs/b.md")] };
  seedPlanReviewed(store, runId, queue, { I1: "VALIDATED", I2: "REVIEWED" });
  const beforeI1 = itemFileBytes(runDir, "I1");
  const beforeI2 = itemFileBytes(runDir, "I2");

  const wiring = makeWiring(runId, runDir, config, journal.sink, () => ({ kind: "reply", text: implJson() }));

  // NO `executors` override at all: the DEFAULT table is the subject.
  const result: DispatchWaveResult = await handleDispatchWave({
    store,
    fanout: wiring.fanout,
    treeState: wiring.treeState,
    runId,
    config,
    journal: journal.sink,
    stateHome,
    workspaceKey: "wkey",
    packs: PACKS,
    now: () => START_MS,
  });

  assert.deepEqual(result.wave.parallel, ["I1", "I2"], "both items were scheduled");
  const d1 = dispositionOf(result, "I1");
  const d2 = dispositionOf(result, "I2");

  assert.equal(d1.stoppedAt, "conductor_item_review", "I1 stopped at the stage no committed handler serves");
  assert.equal(d2.stoppedAt, "conductor_publish", "I2 stopped at ITS OWN missing stage — not a hardcoded one");
  assert.ok(typeof d1.envError === "string" && d1.envError.includes("conductor_item_review"), "I1's disposition NAMES the missing stage");
  assert.ok(typeof d2.envError === "string" && d2.envError.includes("conductor_publish"), "I2's disposition NAMES its missing stage");
  assert.notEqual(d1.envError, d2.envError, "the two dispositions say different things about different stages");

  // Never silently skipped, never advanced past work that did not happen.
  assert.equal(d1.state, "VALIDATED", "I1 did not advance");
  assert.equal(d2.state, "REVIEWED", "I2 did not advance");
  assert.equal(store.loadItem(runId, "I1").state, "VALIDATED", "…and that is what is PERSISTED for I1");
  assert.equal(store.loadItem(runId, "I2").state, "REVIEWED", "…and for I2");
  assert.equal(itemFileBytes(runDir, "I1"), beforeI1, "I1's item file is BYTE-IDENTICAL");
  assert.equal(itemFileBytes(runDir, "I2"), beforeI2, "I2's item file is BYTE-IDENTICAL");
  assert.equal(d1.blocked, null, "an unserved stage is not a §2.5 block");
  assert.equal(d2.blocked, null, "…for either member");

  // Nothing was dispatched and nothing was written: the driver stopped BEFORE the work.
  assert.equal(wiring.sdk.calls.length, 0, "ZERO fake-SDK calls: no sub-session was created for an unserved stage");
  assert.equal(readEvidence(runDir).length, 0, "no §2.6 record was appended");
  assert.equal(readQuestions(runDir).length, 0, "no §2.11 question was raised");
  // The run itself still advanced (this is not a refusal of the tool).
  assert.equal(result.runState, "EXECUTING", "the driver returned normally — it never threw 'not implemented'");
});

// ===========================================================================
// [9.4c-blocked-no-stall]
// ===========================================================================

test("[9.4c-blocked-no-stall] a member that BLOCKS mid-pipeline does not stall the other: the sibling's pipeline continues to its own completion (the ordered call log shows sibling dispatches strictly AFTER the block lands), dispatch_wave RETURNS when the wave is drained-or-blocked, and the blocked member is reported blocked in the summary — read back through the StateStore, never awaited", async () => {
  const root = committedRepo();
  const stateHome = freshStateHome();
  // vetMaxRounds 1 + a mustFix ⇒ I2 blocks at the vet round cap, the REAL committed path.
  const config = makeConfig({ vetCritics: 1, maxReaders: 4, vetMaxRounds: 1 });
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  const queue: Queue = {
    items: [
      makeQueueItem("I1", { fileScope: ["src/i1.mjs"], testScope: ["tests/i1.test.mjs"] }),
      makeQueueItem("I2", { fileScope: ["src/i2.mjs"], testScope: ["tests/i2.test.mjs"] }),
    ],
  };
  seedPlanReviewed(store, runId, queue, { I1: "RED", I2: "RED" });
  seedRedItem(store, runId, runDir, "I1", 1, "tests/i1.test.mjs", "../src/i1.mjs");
  seedRedItem(store, runId, runDir, "I2", 2, "tests/i2.test.mjs", "../src/i2.mjs");

  const wiring = makeWiring(runId, runDir, config, journal.sink, (req) => {
    if (req.role !== "reviewer") return { kind: "reply", text: implJson() };
    return { kind: "reply", text: req.itemId === "I2" ? vetJson([MUSTFIX_MARKER]) : vetJson([]) };
  });
  const stageLog: StageEvent[] = [];

  const result: DispatchWaveResult = await handleDispatchWave({
    store,
    fanout: wiring.fanout,
    treeState: wiring.treeState,
    runId,
    config,
    journal: journal.sink,
    stateHome,
    workspaceKey: "wkey",
    packs: PACKS,
    now: () => START_MS,
    // Two further stages for the SURVIVOR, so "continues to its own completion" is a real
    // claim rather than one step.
    executors: {
      conductor_mark_green: recorder({ sdk: wiring.sdk, log: stageLog, advanceTo: "GREEN" }),
      conductor_validate: recorder({ sdk: wiring.sdk, log: stageLog, advanceTo: "VALIDATED" }),
    },
  });

  // The blocked member, READ BACK THROUGH THE STORE.
  const blockedItem = store.loadItem(runId, "I2");
  assert.notEqual(blockedItem.blocked, null, "I2 is blocked in the PERSISTED §2.5 item");
  assert.equal(blockedItem.state, "RED", "…and stayed at RED: `blocked` is an annotation, not an FSM position");
  const d2 = dispositionOf(result, "I2");
  assert.equal(d2.blocked, blockedItem.blocked?.reason, "the summary reports the block with the PERSISTED reason");
  assert.equal(d2.state, "RED", "the disposition carries the persisted state");
  assert.equal(readQuestions(runDir).filter((q) => q.blocksItems.includes("I2")).length, 1, "exactly ONE §2.11 question blocks I2");

  // The sibling ran on, AFTER the block landed.
  const lastI2Seq = Math.max(...seqsFor(readLog(wiring.sdk), "I2"));
  const survivorStages = stageLog.filter((e) => e.phase === "start");
  assert.deepEqual(
    survivorStages.map((e) => `${e.itemId}:${e.tool}`),
    ["I1:conductor_mark_green", "I1:conductor_validate"],
    "only the SURVIVOR ran the later stages, and it ran BOTH of them",
  );
  for (const event of survivorStages) {
    assert.ok(event.seq > lastI2Seq, `the sibling's ${event.tool} dispatch landed strictly AFTER the block: ${event.seq} > ${lastI2Seq}`);
  }
  assert.equal(store.loadItem(runId, "I1").state, "VALIDATED", "the survivor reached its own completion");
  assert.equal(dispositionOf(result, "I1").blocked, null, "the survivor is not blocked");
  assert.equal(dispositionOf(result, "I1").stoppedAt, "conductor_item_review", "…it stopped only at the stage 9.5a will serve");
  assert.equal(result.runState, "EXECUTING", "dispatch_wave RETURNED with the wave drained-or-blocked");
});

// ===========================================================================
// [9.4c-compact-summary]
// ===========================================================================

test("[9.4c-compact-summary] the return is a COMPACT per-item disposition summary: exactly one row per wave member carrying {itemId, state, blocked|null, deferred|null, envError|null} (plus the pinned stoppedAt/anomaly), alongside the run state and the wave rationale — and 'compact' is ASSERTED: the return embeds NO full §2.4 queue-item and NO full §2.5 item JSON", async () => {
  const root = committedRepo();
  const stateHome = freshStateHome();
  const config = makeConfig();
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const runId = createRunFor(store);
  const runDir = runDirOf(store, runId);
  const queue: Queue = { items: [docsItem("I1", "docs/a.md"), docsItem("I2", "docs/b.md")] };
  seedPlanReviewed(store, runId, queue);
  const plan = expectedWave(store, runId, queue, config);
  const wiring = makeWiring(runId, runDir, config, journal.sink, () => ({ kind: "reply", text: implJson() }));
  const stageLog: StageEvent[] = [];
  const BLOCK_REASON = "the injected stage blocked this member for the summary row";

  const result: DispatchWaveResult = await handleDispatchWave({
    store,
    fanout: wiring.fanout,
    treeState: wiring.treeState,
    runId,
    config,
    journal: journal.sink,
    stateHome,
    workspaceKey: "wkey",
    packs: PACKS,
    now: () => START_MS,
    executors: {
      // I1 advances; I2 blocks — so the summary carries BOTH a clean row and a blocked one.
      conductor_mark_green: recorder({
        sdk: wiring.sdk,
        log: stageLog,
        onStart: (ctx) => {
          if (ctx.itemId === "I2") ctx.store.setBlocked(ctx.runId, ctx.itemId, { reason: BLOCK_REASON, stage: "GREEN" });
        },
      }),
    },
  });

  // Shape.
  assert.equal(result.runState, "EXECUTING", "the run state rides the summary");
  assert.deepEqual(result.wave.parallel, plan.parallel, "the wave rides the summary");
  assert.equal(result.wave.rationale, plan.rationale, "…with nextWave's rationale");
  assert.equal(result.items.length, plan.parallel.length, "EXACTLY one row per wave member");
  assert.deepEqual(result.items.map((row) => row.itemId), plan.parallel, "…in wave order, one per member, no duplicates");

  for (const row of result.items) {
    assert.deepEqual(Object.keys(row).sort(), [...DISPOSITION_KEYS], `the disposition row for ${row.itemId} carries EXACTLY the pinned fields`);
    assert.equal(typeof row.itemId, "string", "itemId is a string");
    assert.equal(typeof row.state, "string", "state is the ItemState");
    assert.ok(row.deferred === null || typeof row.deferred === "string", "deferred is a REASON STRING or null (never the §2.5 object)");
    assert.ok(row.blocked === null || typeof row.blocked === "string", "blocked is a REASON STRING or null (never the §2.5 object)");
    assert.ok(row.envError === null || typeof row.envError === "string", "envError is a string or null");
  }
  const clean = dispositionOf(result, "I1");
  const blocked = dispositionOf(result, "I2");
  assert.equal(clean.blocked, null, "the clean member reports blocked:null");
  assert.equal(clean.deferred, null, "…and deferred:null");
  assert.equal(clean.envError, null, "…and envError:null");
  assert.equal(blocked.blocked, BLOCK_REASON, "the blocked member reports the PERSISTED block reason");
  assert.equal(blocked.blocked, store.loadItem(runId, "I2").blocked?.reason, "…read back through the StateStore");

  // COMPACT: no §2.4 queue-item and no §2.5 item JSON is embedded.
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(TITLE_MARKER), "the return embeds no §2.4 queue-item title");
  assert.ok(!serialized.includes(ACCEPT_MARKER), "…no §2.4 acceptance criteria");
  for (const key of ['"acceptance"', '"ponytail"', '"fileScope"', '"testScope"', '"dependsOn"']) {
    assert.ok(!serialized.includes(key), `the return embeds no §2.4 queue-item field ${key}`);
  }
  for (const key of ['"attempts"', '"evidence"', '"taint"', '"inlineClaim"', '"worktree"', '"debugging"']) {
    assert.ok(!serialized.includes(key), `the return embeds no §2.5 item field ${key}`);
  }
});

// ===========================================================================
// [9.4c-binding-p7-stale-marker-onclear] — MANDATORY DEFERRED BINDING (P7)
// ===========================================================================

test("[9.4c-binding-p7-stale-marker-onclear] MANDATORY DEFERRED BINDING (P7, from C-025 F2 + C-024 F6): a leaked freeze marker becomes an env-fail, never a silent wave hang. A stale verify marker in the shared tree makes the fan-out engine HOLD a write-capable member job (journal fanout/subsession.hold); when the evidence layer BREAKS that marker the driver's TreeState fires onClear so the held job releases and the wave completes — WITHOUT the per-job watchdog firing — and the hold surfaces as an anomaly both in the journal and in the member's disposition. With nothing to break it, the held job is ENV-FAILED rather than awaited forever", { timeout: 60_000 }, async () => {
  await test("a verify BREAKS the stale marker, onClear fires, and the wave completes without the watchdog", async () => {
    const root = committedRepo();
    const stateHome = freshStateHome();
    const config = makeConfig({ maxReaders: 4, subSessionTimeoutMs: 120_000 });
    const boot = makeJournal();
    const store = openStore(root, boot.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    // The REAL journal: the hold/abort vocabulary is enforced, not merely captured.
    const journal = makeRealJournal(runDir, config);
    // I1 (wave order first, P2) owes conductor_mark_green — a WRITE-CAPABLE implementer
    // dispatch. I2 owes conductor_validate — the REAL runVerify that breaks the marker.
    const queue: Queue = { items: [docsItem("I1", "docs/a.md"), docsItem("I2", "docs/b.md")] };
    seedPlanReviewed(store, runId, queue, { I1: "PENDING", I2: "GREEN" });
    assert.deepEqual(expectedWave(store, runId, queue, config).parallel, ["I1", "I2"], "premise: I1 is the wave-order-first member");

    // THE LEAK: a stale verify marker (a provably DEAD pid) freezing the shared tree.
    const leaked = deadPid();
    writeFileSync(markerPathOf(runDir), JSON.stringify({ pid: leaked, startMs: START_MS - 1_000 }));
    assert.equal(existsSync(markerPathOf(runDir)), true, "premise: the shared tree carries a leaked verify marker");

    const wiring = makeWiring(runId, runDir, config, journal.sink, () => ({ kind: "reply", text: implJson() }));
    assert.equal(wiring.treeState.isFrozen(TREE), true, "premise: the marker-backed TreeState reports the shared tree FROZEN");

    const result: DispatchWaveResult = await handleDispatchWave({
      store,
      fanout: wiring.fanout,
      treeState: wiring.treeState,
      runId,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wkey",
      packs: PACKS,
      now: () => START_MS,
    });

    // (1) The engine HELD the write-capable job — its own committed mechanism, reused.
    const holds = journal.records.filter((r) => r.component === "fanout" && r.event === "subsession.hold");
    assert.equal(holds.length, 1, "exactly ONE write-capable job was HELD by the fan-out engine");
    assert.equal(holds[0].data["itemId"], "I1", "…the wave-order-first member's implementer");
    assert.equal(holds[0].data["tree"], TREE, "…on the shared tree");
    assert.equal(isKnownEvent("fanout", "subsession.hold"), true, "the hold is journaled in the CLOSED §7.4 vocabulary");

    // (2) The evidence layer broke the marker, and the DRIVER's TreeState fired onClear.
    const verifies = readEvidence(runDir).filter((r) => r.kind === "verify");
    assert.equal(verifies.length, 1, "the sibling's REAL verify ran (runVerify's staleMarkerBroken path)");
    assert.equal(existsSync(markerPathOf(runDir)), false, "the leaked marker is gone");
    assert.ok(wiring.clears.length > 0, "the driver fired notifyClear on its TreeState (P6) — the held job is released deterministically");
    const clearAt = wiring.clears.find((c) => c.tree === TREE);
    assert.ok(clearAt !== undefined, "…for the shared tree");

    // (3) The released job actually ran — and only AFTER the clear.
    const implementers = wiring.byRole("implementer");
    assert.equal(implementers.length, 1, "the held implementer ran exactly once after release");
    assert.equal(implementers[0].itemId, "I1", "…for the held member");
    const log = readLog(wiring.sdk);
    const firstI1Call = Math.min(...seqsFor(log, "I1"));
    assert.ok(
      firstI1Call > (clearAt as { callsAt: number }).callsAt,
      "the held job produced NO SDK traffic until the clear notification released it",
    );

    // (4) The wave completed WITHOUT the per-job watchdog firing.
    assert.equal(
      journal.records.filter((r) => r.component === "fanout" && r.event === "subsession.abort").length,
      0,
      "the per-job watchdog NEVER fired: termination came from the marker break, not from a timeout",
    );
    assert.equal(wiring.sdk.aborts.length, 0, "no sub-session was aborted");
    assert.equal(store.loadItem(runId, "I1").state, "GREEN", "the held member completed its write stage");
    assert.equal(store.loadItem(runId, "I2").state, "VALIDATED", "the sibling's verify carried it to VALIDATED");

    // (5) The anomaly rides the member's disposition.
    const d1 = dispositionOf(result, "I1");
    assert.ok(typeof d1.anomaly === "string" && d1.anomaly.length > 0, "the held member's disposition carries an ANOMALY");
    assert.match(d1.anomaly as string, /marker|freeze|frozen|held|hold/i, "…describing the freeze/marker hold");
    assert.ok((d1.anomaly as string).includes(TREE), "…and naming the tree it was held on");
    // The anomaly is MEMBER-SPECIFIC, not a blanket wave-level string stamped on every row.
    // (Whether the sibling whose verify broke the marker carries an anomaly of its own is
    // left open — only "the same string on both" is refused.)
    assert.notEqual(
      dispositionOf(result, "I2").anomaly,
      d1.anomaly,
      "the anomaly belongs to the member it happened to, not to the whole wave",
    );
    assert.equal(d1.envError, null, "the held member did NOT env-fail: the marker break released it");
  });

  await test("with NOTHING to break the marker, the held job is ENV-FAILED rather than awaited forever", async () => {
    const root = committedRepo();
    const stateHome = freshStateHome();
    // The bound is the driver's own business (P8); a short sub-session budget keeps the
    // FAILURE case quick without any assertion depending on a duration.
    const config = makeConfig({ maxReaders: 4, subSessionTimeoutMs: 1_000 });
    const boot = makeJournal();
    const store = openStore(root, boot.sink, config);
    const runId = createRunFor(store);
    const runDir = runDirOf(store, runId);
    const journal = makeRealJournal(runDir, config);
    // ONE member, whose only stage is write-capable: nothing in this wave runs a verify.
    const queue: Queue = { items: [docsItem("I1", "docs/a.md")] };
    seedPlanReviewed(store, runId, queue);
    const leaked = deadPid();
    writeFileSync(markerPathOf(runDir), JSON.stringify({ pid: leaked, startMs: START_MS - 1_000 }));

    const wiring = makeWiring(runId, runDir, config, journal.sink, () => ({ kind: "reply", text: implJson() }));

    const result: DispatchWaveResult = await handleDispatchWave({
      store,
      fanout: wiring.fanout,
      treeState: wiring.treeState,
      runId,
      config,
      journal: journal.sink,
      stateHome,
      workspaceKey: "wkey",
      packs: PACKS,
      now: () => START_MS,
    });

    assert.equal(
      journal.records.filter((r) => r.component === "fanout" && r.event === "subsession.hold").length,
      1,
      "the write-capable job was HELD by the frozen tree",
    );
    const d1 = dispositionOf(result, "I1");
    assert.ok(typeof d1.envError === "string" && d1.envError.length > 0, "the member is ENV-FAILED rather than awaited forever");
    assert.match(d1.envError as string, /marker|freeze|frozen|held|hold/i, "…and the env failure names the freeze that held it");
    assert.equal(d1.state, "PENDING", "the member never advanced past the work that did not happen");
    assert.equal(store.loadItem(runId, "I1").state, "PENDING", "…and that is what is PERSISTED");
    assert.equal(wiring.byRole("implementer").length, 0, "the held job never reached the model");
    assert.equal(result.runState, "EXECUTING", "dispatch_wave RETURNED: a leaked marker is an env-fail, never a silent hang");
  });
});
