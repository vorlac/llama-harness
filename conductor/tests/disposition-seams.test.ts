// conductor/tests/disposition-seams.test.ts — Phase III.2 of the fix campaign: the
// DISPOSITION seams. Every row performs the escape the register recorded and
// asserts the honest disposition, so a fix that is reasoned rather than wired
// fails here.
//
//   GAP-022 / MACRO-005 — "is this item finished / waiting / hopeless?" was
//     recomputed by four core predicates with subtly different closures
//     (isSettled, cannotEverPublish, settledForReport, the continuation
//     actionability condition). Seven recorded wedges lived in the disagreements
//     between them. ONE core `dispositionsOf` over the closed enum
//     `actionable | waiting-human | stuck | settled` owns the fact; the report
//     closer, the continuation engine and shouldTerminate read IT.
//
//   GAP-021 / MACRO-006 / ISSUE-065 — two members of the closed §2.9 stop
//     vocabulary (`blocked`, `surfaced`) were COMPUTED by core and written by
//     NOTHING: a delegation ring whose one consumer deferred both to
//     conductor_report, which hardcoded `done`. An all-blocked run closed
//     "the run completed". One total `stopKindOf` closes every terminal path and
//     a `satisfies` over STOP_KINDS proves every kind has a producing branch.
//
//   ISSUE-053 / decision D5 (STRICT) — the closing verify's result was rendered
//     and never consulted, so §3.2's "verification-before-completion made
//     mechanical" was advisory: a run whose blocked item left broken production
//     edits closed `done` with reasonDisplay "closing verify RED". A RED closing
//     verify maps to `blocked` (an assertion the work owes) or `env` (the runner
//     could not run), and can NEVER stamp `done`.
//
//   ISSUE-066 — an honest waiting run lost committed work: the engine archived it
//     and cleared the pointer, so the documented conductor_answer resume path
//     could not revive the dependent. A stop of a RESUMABLE kind that still holds
//     an open question is not archived, and answering that question revives the
//     run.
//
//   ISSUE-067 — a blocked item with no live question plus a dependent was a
//     permanently SILENT wedge. A blocked item no answer can release is `stuck`,
//     which is a disposition the engine records rather than sits in.
//
//   MACRO-007 / the defer escape — classify -> decompose -> defer-all -> report
//     closed clean `done` with nothing published. `done` requires that the run
//     actually advanced an item; a run that published nothing reads `noop`.
//
//   Attempt cap (Phase II) — exhaustion takes the item to its blocked path, and
//     that blocked path must reach the run's disposition: the run reads
//     waiting-human and stops `blocked`, never `done`.

import { after, test } from "node:test";
import assert from "node:assert/strict";

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// ---- the subjects ---------------------------------------------------------
import {
  DISPOSITIONS,
  STOP_CAUSES,
  closingVerifyFailure,
  dispositionsOf,
  isResumableStop,
  runDispositionOf,
  stopKindOf,
} from "../core/disposition.ts";
import type { Disposition, DispositionItem, StopCause } from "../core/disposition.ts";

// ---- committed machinery these rows compose over --------------------------
import { STOP_KINDS } from "../core/stops.ts";
import { isKnownEvent } from "../core/journal-events.ts";
import { settledForReport } from "../core/gates-phase.ts";
import { handleAnswer, handleDefer, handleMarkGreen, handleReport, handleSurface } from "../adapter/tools.ts";
import type { ReportResult } from "../adapter/tools.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, TreeState } from "../adapter/fanout.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { readQuestions } from "../adapter/questions.ts";
import type { Config, Item, ItemState, Queue, QueueItem, StopKind, TreePath } from "../core/types.ts";
import { makeFakeSdk } from "./fixtures/fake-sdk.ts";

const START_MS = 1_755_500_000_000;
const SCOPE = "unitDSP01";
const WORKSPACE_KEY = "wkeyDSP01";
const ORCH = "ses_orchestrator";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

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
  const dir = mkdtempSync(path.join(tmpdir(), `conductor-disp-${tag}-`));
  tmpDirs.push(dir);
  return dir;
}

const GREEN_CMD = [process.execPath, "-e", "0"];
const RED_ASSERTION_CMD = [process.execPath, "-e", "process.exit(1)"];
const RED_ENV_CMD = [process.execPath, "-e", "process.exit(127)"];

function makeConfig(opts: { command?: string[]; implementerAttempts?: number; itemTest?: string[] } = {}): Config {
  const scope: { command: string[]; timeoutMs: number; itemTest?: string[] } = {
    command: [...(opts.command ?? GREEN_CMD)],
    timeoutMs: 120_000,
    ...(opts.itemTest !== undefined ? { itemTest: [...opts.itemTest] } : {}),
  };
  return {
    version: 1,
    verify: {
      scopes: { [SCOPE]: scope },
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
      debugFixCap: 3,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
      ...(opts.implementerAttempts === undefined ? {} : { implementerAttempts: opts.implementerAttempts }),
    },
    parallel: { writes: "off", maxImplementers: 4, maxReaders: 4, subSessionTimeoutMs: 120_000 },
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

function makeQueueItem(id: string, over: Partial<QueueItem> = {}): QueueItem {
  const base: QueueItem = {
    id,
    title: "keep the sign of negative offsets",
    rationale: "the parser drops the sign, so negative offsets read as positive ones",
    fileScope: [`src/${id}.mjs`],
    testScope: [`tests/${id}.test.mjs`],
    acceptance: ['parse("-7") returns -7'],
    behavioral: true,
    dependsOn: [],
    ponytail: {
      necessary: "the user's prompt asks for signed offsets",
      reuse: "checked the existing modules; nothing parses a signed offset",
      ladderRung: "minimal-code",
    },
  };
  return { ...base, ...over };
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

const OPEN_TREE: TreeState = {
  isFrozen: (): boolean => false,
  onClear: (): (() => void) => (): void => undefined,
};

function makeWiring(
  runId: string,
  config: Config,
  journal: JournalSink,
  script: Record<string, string[]>,
): { fanout: Fanout; dispatchedRoles: string[] } {
  const registry = new Map<string, { role: string; itemId: string; tree: TreePath }>();
  const sdk = makeFakeSdk({ registry });
  const dispatchedRoles: string[] = [];
  sdk.setResponder((req) => {
    const role = req.entry?.role ?? "";
    dispatchedRoles.push(role);
    const replies = script[role] ?? [];
    if (replies.length === 0) return { kind: "reply", text: `UNSCRIPTED ROLE ${role}` };
    return { kind: "reply", text: replies[Math.min(dispatchedRoles.length - 1, replies.length - 1)] };
  });
  const fanout = createFanout(
    sdk.client,
    config,
    journal as unknown as Parameters<typeof createFanout>[2],
    registry,
    OPEN_TREE,
    runId,
  );
  return { fanout, dispatchedRoles };
}

const DOCTRINE_PACKS: Record<string, string> = {};
{
  const doctrineDir = new URL("../doctrine/", import.meta.url);
  for (const name of readdirSync(doctrineDir)) {
    if (name.endsWith(".md")) DOCTRINE_PACKS[name] = readFileSync(new URL(name, doctrineDir), "utf8");
  }
}

interface Bench {
  root: string;
  runId: string;
  runDir: string;
  store: StateStore;
  config: Config;
  journal: { sink: JournalSink; records: CaptureRecord[] };
  fanout: Fanout;
}

function makeBench(opts: {
  tag: string;
  queue: Queue;
  states: Record<string, ItemState>;
  config?: Config;
}): Bench {
  const root = scratchDir(opts.tag);
  const config = opts.config ?? makeConfig();
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(path.join(root, "tests"), { recursive: true });
  for (const entry of opts.queue.items) {
    for (const file of entry.fileScope) writeFileSync(path.join(root, file), "export const x = 1;\n");
    for (const file of entry.testScope) writeFileSync(path.join(root, file), "// placeholder\n");
  }
  const journal = makeJournal();
  const store = openStore(root, journal.sink, config);
  const run = store.createRun({
    prompt: "keep the sign",
    sessionID: ORCH,
    classification: { kind: "work", rationale: "behavioural", check: { agreed: true, note: "" } },
  });
  run.state = "EXECUTING";
  store.saveRun(run);
  const runDir = path.join(store.root, ".conductor", "runs", run.runId);
  writeFileSync(path.join(runDir, "queue.json"), JSON.stringify(opts.queue, null, 2));
  for (const entry of opts.queue.items) {
    store.saveItem(run.runId, makeRuntimeItem(entry.id, opts.states[entry.id] ?? "PENDING"));
  }
  const wiring = makeWiring(run.runId, config, journal.sink, {});
  return { root, runId: run.runId, runDir, store, config, journal, fanout: wiring.fanout };
}

function report(bench: Bench): Promise<ReportResult> {
  return handleReport({
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    config: bench.config,
    journal: bench.journal.sink,
    stateHome: scratchDir("state"),
    workspaceKey: WORKSPACE_KEY,
    now: () => START_MS,
    metrics: async () => null,
  });
}

function readReport(runDir: string): string {
  return readFileSync(path.join(runDir, "report.md"), "utf8");
}

// ===========================================================================
// GAP-022 — the ONE disposition function
// ===========================================================================

function dispItem(id: string, over: Partial<DispositionItem> = {}): DispositionItem {
  return { id, state: "PENDING", dependsOn: [], blocked: null, deferred: null, ...over };
}

test("[disp-enum-closed] the disposition vocabulary is exactly the closed GAP-022 enum: actionable, waiting-human, stuck, settled — nothing missing, nothing extra", () => {
  assert.deepEqual(
    [...DISPOSITIONS].sort(),
    ["actionable", "settled", "stuck", "waiting-human"],
    "one enum, closed at four members",
  );
});

test("[disp-one-derivation] dispositionsOf is TOTAL over the item set and separates the four cases that the four private predicates disagreed about: published/deferred settle, blocked-with-a-live-question waits on the human, blocked-with-no-question is stuck, and a dependent of a deferred item is stuck while a dependent of a waiting item stays actionable", () => {
  const items: DispositionItem[] = [
    dispItem("PUB", { state: "PUBLISHED" }),
    dispItem("DEF", { deferred: { reason: "not this run" } }),
    dispItem("WAIT", { blocked: { reason: "asked the human", questionId: "q1" } }),
    dispItem("WEDGE", { blocked: { reason: "blocked with nothing to answer" } }),
    dispItem("ONDEF", { dependsOn: ["DEF"] }),
    dispItem("ONWAIT", { dependsOn: ["WAIT"] }),
    dispItem("ONWEDGE", { dependsOn: ["WEDGE"] }),
    dispItem("ONGHOST", { dependsOn: ["NOSUCHITEM"] }),
    dispItem("FREE"),
  ];
  const got = dispositionsOf(items, { openQuestionIds: ["q1"] });

  assert.equal(got.size, items.length, "every item gets exactly one disposition — the function is total");
  const expected: Record<string, Disposition> = {
    PUB: "settled",
    DEF: "settled",
    WAIT: "waiting-human",
    WEDGE: "stuck",
    ONDEF: "stuck",
    ONWAIT: "actionable",
    ONWEDGE: "stuck",
    ONGHOST: "stuck",
    FREE: "actionable",
  };
  for (const [id, want] of Object.entries(expected)) {
    assert.equal(got.get(id), want, `${id} reads ${want}`);
  }
});

test("[disp-answered-question-is-not-a-live-lever] a blocked item whose question has been ANSWERED is stuck, not waiting-human: `waiting-human` means a human still has a lever, and an answered question is not one", () => {
  const items = [dispItem("A", { blocked: { reason: "asked", questionId: "q1" } })];
  assert.equal(dispositionsOf(items, { openQuestionIds: ["q1"] }).get("A"), "waiting-human", "open question => waiting");
  assert.equal(dispositionsOf(items, { openQuestionIds: [] }).get("A"), "stuck", "answered/absent question => stuck");
});

test("[disp-cycle-terminates] a dependsOn cycle — which core validateQueue refuses but the derivation must not assume away — terminates instead of recursing forever", () => {
  const items = [
    dispItem("A", { dependsOn: ["B"] }),
    dispItem("B", { dependsOn: ["A"] }),
  ];
  const got = dispositionsOf(items, { openQuestionIds: [] });
  assert.equal(got.size, 2, "both items are dispositioned");
  for (const id of ["A", "B"]) {
    assert.ok(DISPOSITIONS.includes(got.get(id) as Disposition), `${id} carries a member of the closed enum`);
  }
});

test("[disp-nogit-reviewed-settles] §3.9: with publish disabled REVIEWED is where an item ENDS, so it settles — and under git it still owes a publish and stays actionable", () => {
  const items = [dispItem("R", { state: "REVIEWED" })];
  assert.equal(dispositionsOf(items, { openQuestionIds: [], publishEnabled: false }).get("R"), "settled");
  assert.equal(dispositionsOf(items, { openQuestionIds: [], publishEnabled: true }).get("R"), "actionable");
});

test("[disp-report-precondition-is-the-same-derivation] settledForReport is DERIVED from dispositionsOf rather than spelled a second time: `allSettled` is exactly `no item is actionable` and `unsettled` is exactly the actionable ids", () => {
  const items = [
    { id: "PUB", state: "PUBLISHED", behavioral: true, dependsOn: [], fileScope: [], blocked: null, deferred: null },
    { id: "OPEN", state: "PENDING", behavioral: true, dependsOn: [], fileScope: [], blocked: null, deferred: null },
  ];
  const verdict = settledForReport(items);
  const disp = dispositionsOf(
    items.map((i) => ({ id: i.id, state: i.state, dependsOn: i.dependsOn, blocked: i.blocked, deferred: i.deferred })),
    { openQuestionIds: [] },
  );
  const actionable = [...disp.entries()].filter(([, d]) => d === "actionable").map(([id]) => id);
  assert.deepEqual(verdict.unsettled, actionable, "the unsettled set IS the actionable set");
  assert.equal(verdict.allSettled, actionable.length === 0, "and allSettled is exactly `nothing actionable`");
});

test("[disp-run-fold] runDispositionOf folds the item dispositions into ONE run-level answer, worst-first: any actionable item makes the run actionable, else a human lever makes it waiting-human, else a stuck item makes it stuck, else settled", () => {
  const fold = (ds: Disposition[], openQuestions = 0): Disposition =>
    runDispositionOf(ds, { openQuestions });
  assert.equal(fold(["settled", "actionable", "stuck"]), "actionable");
  assert.equal(fold(["settled", "waiting-human", "stuck"]), "waiting-human");
  assert.equal(fold(["settled", "stuck"]), "stuck");
  assert.equal(fold(["settled", "settled"]), "settled");
  assert.equal(fold(["settled"], 1), "waiting-human", "an open question with nothing blocked is still a human lever");
});

// ===========================================================================
// GAP-021 — the TOTAL stop-kind closer
// ===========================================================================

test("[disp-stop-closer-total] stopKindOf is TOTAL over the §2.9 vocabulary: every one of the six stop kinds has a producing branch, and every cause produces a member of STOP_KINDS", () => {
  const produced = new Set<StopKind>();
  const causes: StopCause[] = [...STOP_CAUSES];
  const runs = [
    { disposition: "settled" as Disposition, blockedItems: 0, openQuestions: 0, advancedItems: 1 },
    { disposition: "settled" as Disposition, blockedItems: 0, openQuestions: 2, advancedItems: 1 },
    { disposition: "waiting-human" as Disposition, blockedItems: 1, openQuestions: 1, advancedItems: 0 },
    { disposition: "stuck" as Disposition, blockedItems: 0, openQuestions: 0, advancedItems: 0 },
    { disposition: "settled" as Disposition, blockedItems: 0, openQuestions: 0, advancedItems: 0 },
  ];
  for (const cause of causes) {
    for (const run of runs) {
      for (const failureClass of [null, "assertion", "error"] as const) {
        const got = stopKindOf({ cause, run, failureClass });
        assert.ok(STOP_KINDS.includes(got.kind), `${cause} produced ${got.kind}, which must be a §2.9 kind`);
        assert.ok(got.why.length > 0, `${cause} supplies a non-empty rationale`);
        produced.add(got.kind);
      }
    }
  }
  assert.deepEqual(
    [...produced].sort(),
    [...STOP_KINDS].sort(),
    "MACRO-006's proof obligation: every kind in the closed vocabulary has a producing branch",
  );
});

test("[disp-stop-closer-kinds] each cause names its §2.9 kind: halt => interrupt, futility => noop, override exhaustion and transport => env", () => {
  const run = { disposition: "actionable" as Disposition, blockedItems: 0, openQuestions: 0, advancedItems: 0 };
  assert.equal(stopKindOf({ cause: "halt", run }).kind, "interrupt");
  assert.equal(stopKindOf({ cause: "futility", run }).kind, "noop");
  assert.equal(stopKindOf({ cause: "override-exhausted", run }).kind, "env");
  assert.equal(stopKindOf({ cause: "transport", run }).kind, "env");
});

test("[disp-stop-closer-settle] a settle names the disposition it closes on: a blocked item => blocked, a pending question with nothing blocked => surfaced, an advanced all-settled run => done", () => {
  const settle = (over: Partial<Parameters<typeof stopKindOf>[0]["run"]>): StopKind =>
    stopKindOf({
      cause: "settle",
      run: { disposition: "settled", blockedItems: 0, openQuestions: 0, advancedItems: 1, ...over },
    }).kind;
  assert.equal(settle({ disposition: "waiting-human", blockedItems: 2, openQuestions: 1 }), "blocked");
  assert.equal(settle({ disposition: "stuck", blockedItems: 1 }), "blocked");
  assert.equal(settle({ disposition: "stuck", blockedItems: 0 }), "blocked");
  assert.equal(settle({ openQuestions: 2 }), "surfaced");
  assert.equal(settle({}), "done");
});

test("[disp-stop-closer-fail-closed] G5: `done` is reachable ONLY from a fully settled run that actually advanced an item — an actionable disposition at a settle is a contradiction and fails closed to `blocked`, never `done`", () => {
  assert.equal(
    stopKindOf({
      cause: "settle",
      run: { disposition: "actionable", blockedItems: 0, openQuestions: 0, advancedItems: 1 },
    }).kind,
    "blocked",
    "actionable work at a settle can never read as completion",
  );
});

test("[disp-D5-strict] decision D5: a RED closing verify can NEVER yield `done` — an assertion-class failure maps to `blocked` (the work owes it), a runner that could not run maps to `env`, and an unclassifiable red fails closed to `blocked`", () => {
  const run = { disposition: "settled" as Disposition, blockedItems: 0, openQuestions: 0, advancedItems: 3 };
  assert.equal(stopKindOf({ cause: "closing-verify-red", run, failureClass: "assertion" }).kind, "blocked");
  assert.equal(stopKindOf({ cause: "closing-verify-red", run, failureClass: "missing-subject" }).kind, "blocked");
  assert.equal(stopKindOf({ cause: "closing-verify-red", run, failureClass: "error" }).kind, "env");
  assert.equal(stopKindOf({ cause: "closing-verify-red", run, failureClass: null }).kind, "blocked");
  for (const failureClass of ["assertion", "missing-subject", "error", null] as const) {
    assert.notEqual(
      stopKindOf({ cause: "closing-verify-red", run, failureClass }).kind,
      "done",
      "no red closing verify, of any failure class, may stamp done",
    );
  }
});

test("[disp-verify-failure-class] the closing verify's failure class is derived from the scope exit codes the §2.6 record already carries: a runner exit of 1 is the work's assertion, while the evidence layer's kill/absent codes (124, 126, 127, signal codes) say the runner could not run at all", () => {
  const scope = (green: boolean, exitCode: number): { green: boolean; exitCode: number; durationMs: number } => ({
    green,
    exitCode,
    durationMs: 1,
  });
  assert.equal(closingVerifyFailure({ a: scope(true, 0) }), null, "a green verify has no failure class");
  assert.equal(closingVerifyFailure({ a: scope(false, 1) }), "assertion");
  assert.equal(closingVerifyFailure({ a: scope(true, 0), b: scope(false, 1) }), "assertion");
  assert.equal(closingVerifyFailure({ a: scope(false, 127) }), "error", "command not found is environmental");
  assert.equal(closingVerifyFailure({ a: scope(false, 124) }), "error", "the evidence layer's kill code is environmental");
  assert.equal(closingVerifyFailure({ a: scope(false, 137) }), "error", "a signal-terminated runner is environmental");
  assert.equal(
    closingVerifyFailure({ a: scope(false, 1), b: scope(false, 127) }),
    "error",
    "one unrunnable scope makes the whole closing verify environmental",
  );
});

test("[disp-resumable-kinds] exactly the stop kinds a human answer can revive are resumable: blocked, surfaced and noop — a completed, environment-broken or interrupted run is not revived by answering a question", () => {
  const resumable = STOP_KINDS.filter((kind) => isResumableStop(kind));
  assert.deepEqual([...resumable].sort(), ["blocked", "noop", "surfaced"], "the resumable set is closed and explicit");
});

// ===========================================================================
// ESCAPE 1 — a run closing on a RED closing verify stamps blocked/env, never done
// ===========================================================================

test("[disp-escape-red-verify-never-done] ISSUE-053 / D5-STRICT: a run whose every item is settled but whose CLOSING VERIFY comes back RED closes `blocked` (assertion class) — never `done` — and report.md says the closing verify was RED and that the stop kind follows from it", async () => {
  const bench = makeBench({
    tag: "redverify",
    queue: { items: [makeQueueItem("I1")] },
    states: { I1: "PUBLISHED" },
    config: makeConfig({ command: RED_ASSERTION_CMD }),
  });

  const res = await report(bench);
  assert.equal(res.green, false, "premise: the closing verify really is RED");
  assert.equal(
    res.stop?.kind,
    "blocked",
    `a RED closing verify may never stamp done; got ${String(res.stop?.kind)} (${String(res.stop?.reasonDisplay)})`,
  );
  const persisted = bench.store.loadRun(bench.runId);
  assert.equal(persisted.stop?.kind, "blocked", "and the kind is what run.json carries on disk");
  assert.notEqual(persisted.stop?.kind, "done", "the §3.2 completion law is mechanical, not advisory");

  const md = readReport(bench.runDir);
  assert.match(md, /Closing verify: RED/, "report.md names the RED closing verify");
  assert.match(md, /Stop kind: blocked/, "and the stop kind it produced");
  assert.match(
    res.stop?.reasonDisplay ?? "",
    /closing verify/i,
    `the reason SAYS WHY: ${String(res.stop?.reasonDisplay)}`,
  );
});

test("[disp-escape-red-verify-env] the same law, environmental half: a closing verify whose runner could not run at all (exit 127) closes `env`, still never `done`", async () => {
  const bench = makeBench({
    tag: "redenv",
    queue: { items: [makeQueueItem("I1")] },
    states: { I1: "PUBLISHED" },
    config: makeConfig({ command: RED_ENV_CMD }),
  });
  const res = await report(bench);
  assert.equal(res.green, false, "premise: RED");
  assert.equal(res.stop?.kind, "env", `an unrunnable closing verify is an env stop; got ${String(res.stop?.kind)}`);
});

// ===========================================================================
// ESCAPE 2 — a defer-heavy run cannot read as settled-done
// ===========================================================================

test("[disp-escape-defer-all-not-done] MACRO-007's measured escape: classify -> decompose -> defer-all -> report closed clean `done` with NOTHING published. The disposition model prices nothing (D3) but refuses the lie: a run that advanced no item reads `noop`, and report.md names every deferral", async () => {
  const bench = makeBench({
    tag: "deferall",
    queue: { items: [makeQueueItem("I1"), makeQueueItem("I2")] },
    states: { I1: "PENDING", I2: "PENDING" },
  });
  for (const itemId of ["I1", "I2"]) {
    handleDefer({
      store: bench.store,
      runId: bench.runId,
      journal: bench.journal.sink,
      now: () => START_MS,
      itemId,
      reason: "not this run",
    });
  }

  const res = await report(bench);
  assert.equal(res.green, true, "premise: the closing verify is green — the lazy run's whole cover story");
  assert.notEqual(res.stop?.kind, "done", "a run that published nothing may not read as completion");
  assert.equal(res.stop?.kind, "noop", `it reads noop; got ${String(res.stop?.kind)}`);
  assert.match(
    res.stop?.reasonDisplay ?? "",
    /deferred/i,
    `and the reason names the deferrals: ${String(res.stop?.reasonDisplay)}`,
  );

  const md = readReport(bench.runDir);
  assert.match(md, /Disposition: deferred/, "report.md names the deferred disposition per item");
});

test("[disp-defer-does-not-poison-a-real-run] the same rule does NOT price honest deferral: a run that published one item and deferred another still reads `done` — progress happened", async () => {
  const bench = makeBench({
    tag: "defermixed",
    queue: { items: [makeQueueItem("I1"), makeQueueItem("I2")] },
    states: { I1: "PUBLISHED", I2: "PENDING" },
  });
  handleDefer({
    store: bench.store,
    runId: bench.runId,
    journal: bench.journal.sink,
    now: () => START_MS,
    itemId: "I2",
    reason: "not this run",
  });
  const res = await report(bench);
  assert.equal(res.stop?.kind, "done", `an advanced run still closes done; got ${String(res.stop?.kind)}`);
});

// ===========================================================================
// ESCAPE 3 — an all-blocked run reads waiting-human; resume works after an answer
// ===========================================================================

test("[disp-escape-all-blocked-reads-waiting-human] ISSUE-065 reproduced and closed: a run whose every remaining item is BLOCKED on an open §2.11 question closed `done` — 'the run completed' — though nothing was published and every item waits on a human. It closes `blocked`, the report names the open question, and the run's disposition reads waiting-human", async () => {
  const bench = makeBench({
    tag: "allblocked",
    queue: { items: [makeQueueItem("I1"), makeQueueItem("I2")] },
    states: { I1: "PENDING", I2: "PENDING" },
  });
  const surfaced = await handleSurface({
    store: bench.store,
    runId: bench.runId,
    journal: bench.journal.sink,
    now: () => START_MS,
    question: "which sign convention does the parser owe?",
    blocksItems: ["I1", "I2"],
    askedBy: { role: "orchestrator", sessionID: ORCH },
  });
  assert.ok(surfaced.questionId.length > 0, "premise: a §2.11 question was minted");
  for (const id of ["I1", "I2"]) {
    assert.notEqual(bench.store.loadItem(bench.runId, id).blocked, null, `premise: ${id} is blocked`);
  }

  const items = ["I1", "I2"].map((id) => {
    const persisted = bench.store.loadItem(bench.runId, id);
    return {
      id,
      state: persisted.state,
      dependsOn: [],
      blocked: persisted.blocked,
      deferred: persisted.deferred,
    };
  });
  const openIds = readQuestions(bench.runDir)
    .filter((q) => q.answeredIso === null)
    .map((q) => q.id);
  const disp = dispositionsOf(items, { openQuestionIds: openIds });
  assert.equal(
    runDispositionOf([...disp.values()], { openQuestions: openIds.length }),
    "waiting-human",
    "the run's ONE disposition reads waiting-human",
  );

  const res = await report(bench);
  assert.equal(res.stop?.kind, "blocked", `an all-blocked run stops blocked; got ${String(res.stop?.kind)}`);
  assert.notEqual(res.stop?.kind, "done", "never 'the run completed'");
  const md = readReport(bench.runDir);
  assert.match(md, /Disposition: blocked/, "report.md names the blocked disposition");
  assert.ok(md.includes(surfaced.questionId), "and names the open question the human must answer");
});

test("[disp-escape-resume-after-answer] ISSUE-066's lost work: a run stopped on a RESUMABLE kind while an open question still gates it is NOT written off — answering that question clears the stop, restores the current-run pointer, and the run is live again", async () => {
  const bench = makeBench({
    tag: "resume",
    queue: { items: [makeQueueItem("I1"), makeQueueItem("I2", { dependsOn: ["I1"] })] },
    states: { I1: "PENDING", I2: "PENDING" },
  });
  const surfaced = await handleSurface({
    store: bench.store,
    runId: bench.runId,
    journal: bench.journal.sink,
    now: () => START_MS,
    question: "which sign convention does the parser owe?",
    blocksItems: ["I1"],
    askedBy: { role: "orchestrator", sessionID: ORCH },
  });

  // The engine's honest waiting stop: EXECUTING, terminal only by the stop record.
  const stopped = bench.store.loadRun(bench.runId);
  stopped.stop = { kind: "blocked", reasonDisplay: "every remaining item waits on a human", tsMs: START_MS };
  bench.store.saveRun(stopped);
  assert.equal(bench.store.loadRun(bench.runId).state, "EXECUTING", "premise: the FSM never left EXECUTING");

  const answered = handleAnswer({
    store: bench.store,
    runId: bench.runId,
    journal: bench.journal.sink,
    now: () => START_MS,
    questionId: surfaced.questionId,
    answer: "negative offsets keep their sign",
    via: "tool",
  });
  assert.deepEqual(answered.clearedItemIds, ["I1"], "premise: the answer released the blocked item");

  const revived = bench.store.loadRun(bench.runId);
  assert.equal(revived.stop, null, "the stop is cleared: an answered question is not a dead run");
  assert.equal(revived.state, "EXECUTING", "and the FSM position is untouched — no backwards edge was invented");
  assert.equal(bench.store.currentRun()?.runId, bench.runId, "the current-run pointer names the revived run again");
  assert.equal(
    answered.resumed,
    true,
    "and the handler REPORTS the revival, so the caller is not left guessing",
  );
});

test("[disp-resume-refuses-unresumable] the resume path is not a general un-stop: a run that closed `done` (or `env`, or `interrupt`) is never revived by answering a leftover question", async () => {
  const bench = makeBench({
    tag: "noresume",
    queue: { items: [makeQueueItem("I1")] },
    states: { I1: "PENDING" },
  });
  for (const kind of ["done", "env", "interrupt"] as const) {
    const surfaced = await handleSurface({
      store: bench.store,
      runId: bench.runId,
      journal: bench.journal.sink,
      now: () => START_MS,
      question: "does " + kind + " revive?",
      blocksItems: ["I1"],
      askedBy: { role: "orchestrator", sessionID: ORCH },
    });
    const run = bench.store.loadRun(bench.runId);
    run.stop = { kind, reasonDisplay: "fixture", tsMs: START_MS };
    bench.store.saveRun(run);
    const answered = handleAnswer({
      store: bench.store,
      runId: bench.runId,
      journal: bench.journal.sink,
      now: () => START_MS,
      questionId: surfaced.questionId,
      answer: "x",
      via: "tool",
    });
    assert.equal(answered.resumed, false, `a ${kind} run is not resumable`);
    assert.equal(bench.store.loadRun(bench.runId).stop?.kind, kind, "and its stop record stands");
  }
});

// ===========================================================================
// The Phase II attempt cap lands in the disposition model
// ===========================================================================

const FAILING_TEST =
  'import test from "node:test";\n' +
  'import assert from "node:assert/strict";\n' +
  'import { parse } from "../src/I1.mjs";\n' +
  'test("keeps the sign", () => {\n' +
  '  assert.equal(parse("-7"), -7, "DISP-ATTEMPT-CAP");\n' +
  "});\n";

test("[disp-attempt-cap-reaches-the-run-disposition] the Phase II per-item attempt cap does not stop at the item: an exhausted item is blocked with a §2.11 question, which makes the RUN read waiting-human and close `blocked` — the exhaustion is never silent and never reads as completion", async () => {
  const config = makeConfig({
    implementerAttempts: 1,
    itemTest: [process.execPath, "--test", "{files}"],
    command: GREEN_CMD,
  });
  const bench = makeBench({
    tag: "attemptcap",
    queue: { items: [makeQueueItem("I1")] },
    states: { I1: "TEST_VETTED" },
    config,
  });
  writeFileSync(path.join(bench.root, "src", "I1.mjs"), "export function parse(t) { return Math.abs(Number(t)); }\n");
  writeFileSync(path.join(bench.root, "tests", "I1.test.mjs"), FAILING_TEST);

  const wiring = makeWiring(bench.runId, config, bench.journal.sink, {
    implementer: [
      JSON.stringify({ status: "DONE", summary: "applied", concerns: [], neededContext: null, blockReason: null }),
    ],
  });
  const markGreen = (): Promise<{ ok: boolean; questionId: string | null }> =>
    handleMarkGreen({
      store: bench.store,
      fanout: wiring.fanout,
      runId: bench.runId,
      itemId: "I1",
      config,
      journal: bench.journal.sink,
      stateHome: scratchDir("attemptcap-state"),
      workspaceKey: WORKSPACE_KEY,
      now: () => START_MS,
    });

  await markGreen();
  const exhausted = await markGreen();
  const blocked = bench.store.loadItem(bench.runId, "I1");
  assert.ok(blocked.blocked !== null, "premise: the exhausted item took its blocked path");
  assert.ok(exhausted.questionId !== null, "premise: with a §2.11 question offering the human the unblock path");

  const openIds = readQuestions(bench.runDir)
    .filter((q) => q.answeredIso === null)
    .map((q) => q.id);
  const disp = dispositionsOf(
    [{ id: "I1", state: blocked.state, dependsOn: [], blocked: blocked.blocked, deferred: blocked.deferred }],
    { openQuestionIds: openIds },
  );
  assert.equal(disp.get("I1"), "waiting-human", "the exhausted item reads waiting-human, not settled");
  assert.equal(
    stopKindOf({
      cause: "settle",
      run: { disposition: "waiting-human", blockedItems: 1, openQuestions: openIds.length, advancedItems: 0 },
    }).kind,
    "blocked",
    "and the run it belongs to stops blocked",
  );

  const res = await report(bench);
  assert.equal(res.stop?.kind, "blocked", `the closed run reads blocked; got ${String(res.stop?.kind)}`);
  assert.notEqual(res.stop?.kind, "done", "an exhausted attempt budget never reads as completion");
});

// ===========================================================================
// §7.4 vocabulary: the resume path's journal name
// ===========================================================================

test("[disp-resume-journal-name] `run.resumed` is a WIDENING, not a borrowed near-miss: it is listed in the core vocabulary, it is emitted by the handler that performs the revival, and an actual revival files exactly one record under it", async () => {
  assert.equal(isKnownEvent("state", "run.resumed"), true, "the closed §7.4 vocabulary lists it");
  const handlerSource = readFileSync(new URL("../adapter/tools.ts", import.meta.url), "utf8");
  assert.ok(
    handlerSource.includes('"run.resumed"'),
    "and a call site names it — a vocabulary entry with no producer is dead vocabulary",
  );

  const bench = makeBench({
    tag: "resumejournal",
    queue: { items: [makeQueueItem("I1")] },
    states: { I1: "PENDING" },
  });
  const surfaced = await handleSurface({
    store: bench.store,
    runId: bench.runId,
    journal: bench.journal.sink,
    now: () => START_MS,
    question: "which convention?",
    blocksItems: ["I1"],
    askedBy: { role: "orchestrator", sessionID: ORCH },
  });
  const run = bench.store.loadRun(bench.runId);
  run.stop = { kind: "surfaced", reasonDisplay: "waiting on an answer", tsMs: START_MS };
  bench.store.saveRun(run);

  handleAnswer({
    store: bench.store,
    runId: bench.runId,
    journal: bench.journal.sink,
    now: () => START_MS,
    questionId: surfaced.questionId,
    answer: "the signed one",
    via: "tool",
  });

  const records = bench.journal.records.filter((r) => r.component === "state" && r.event === "run.resumed");
  assert.equal(records.length, 1, "exactly one revival record");
  assert.equal(records[0].data["resumedFromStop"], "surfaced", "naming the kind it revived from");
  assert.equal(records[0].corr.runId, bench.runId, "correlated to the run it revived");
});
