// conductor/tests/publish-legality-before-persist.test.ts — the build's central
// invariant, asserted where it was broken: LEGALITY BEFORE PERSIST.
//
// handlePublish was the only §3.3 stage handler that did not consult the gate's
// own derivation (core gates-phase legalTools, via the adapter's shared
// requireStageTool). It re-derived its precondition as `item.state !==
// "REVIEWED"` alone, and consulted the item FSM — the one rule that knows about
// the §2.5 `blocked` annotation — only AFTER the git commit, the push, the
// publish-batch artifact and (in worktree mode) the merge-back. So:
//
//   * a DEFERRED item at REVIEWED published outright: `deferred` is invisible to
//     the FSM table, and the hand-rolled precondition never asked the gate;
//   * a BLOCKED item at REVIEWED was refused, but only after its commit existed.
//     A refusal that arrives after the least reversible write in the system is
//     not a refusal.
//
// Anti-vacuity (C-045). Each row runs the SAME fixture twice, once clean and once
// annotated, and asserts the clean run PUBLISHES with a new commit. Without that
// control a fixture that had quietly stopped being publishable at all — a stale
// verify, a missing evidence record, a scope that stages nothing — would satisfy
// "no commit was made" for a reason that has nothing to do with legality.
//
// The load-bearing assertion is deliberately NOT "the call was refused": for the
// blocked row that is already true today, and a test that stopped there would
// pin nothing. It is that the WORKSPACE IS UNTOUCHED — commit count, publish
// batch and persisted item state all exactly as they were before the call.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import * as path from "node:path";

import { handlePublish } from "../adapter/tools.ts";
import type { PublishInput } from "../adapter/tools.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { createFanout } from "../adapter/fanout.ts";
import type { Fanout, TreeState } from "../adapter/fanout.ts";
import { currentBranch, headSha, isRepo } from "../adapter/gitio.ts";
import { legalTools } from "../core/gates-phase.ts";
import type { GateItem, GateRun } from "../core/gates-phase.ts";
import { MAIN_TREE } from "../core/types.ts";
import { treePath } from "../core/types.ts";
import type { TreePath } from "../core/types.ts";
import type { Config, EvidenceRecord, Item, ItemState, Queue, QueueItem } from "../core/types.ts";

const PUBLISH_TOOL = "conductor_publish";
const SCOPE = "unit-c055";
const START_MS = 1_754_990_000_000;
const WORKSPACE_KEY = "wkey-c055";
const BLOCK_MARKER = "BLOCKED-REASON-MARKER-C055";
const DEFER_MARKER = "DEFERRED-REASON-MARKER-C055";

// ---------------------------------------------------------------------------
// Hermetic git + temp dirs (the tests/evidence.test.ts idiom).
// ---------------------------------------------------------------------------

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_SYSTEM: devNull,
  GIT_AUTHOR_NAME: "Conductor Test",
  GIT_AUTHOR_EMAIL: "conductor-test@example.invalid",
  GIT_COMMITTER_NAME: "Conductor Test",
  GIT_COMMITTER_EMAIL: "conductor-test@example.invalid",
  GIT_TERMINAL_PROMPT: "0",
};

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function tmpDir(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `conductor-c055-${tag}-`));
  tmpDirs.push(dir);
  return dir;
}

function committedRepo(): TreePath {
  const dir = tmpDir("repo");
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.name", "Conductor Test"]);
  git(dir, ["config", "user.email", "conductor-test@example.invalid"]);
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  git(dir, ["add", "seed.txt"]);
  git(dir, ["commit", "-m", "seed"]);
  return treePath(dir);
}

function commitCount(dir: string): number {
  return Number.parseInt(git(dir, ["rev-list", "--count", "HEAD"]).trim(), 10);
}

// ---------------------------------------------------------------------------
// Journal sink (captures; accepts anything).
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

function makeSink(): JournalSink {
  return {
    log(): void {
      /* captured nowhere: this file judges the workspace, not the ledger */
    },
    flushSync(): void {
      /* nothing buffered */
    },
  };
}

// ---------------------------------------------------------------------------
// Config / store / queue fixtures
// ---------------------------------------------------------------------------

function makeConfig(): Config {
  return {
    version: 1,
    verify: {
      scopes: { [SCOPE]: { command: [process.execPath, "-e", "0"], timeoutMs: 120_000 } },
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
      vetMaxRounds: 1,
      testRepairAttempts: 1,
      debugFixCap: 1,
      maxOverridesPerItem: 1,
      maxOverridesPerRun: 1,
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
    sessionID: "ses_orchestrator",
    now: () => START_MS,
    pid: process.pid,
    staleLockMs: 24 * 60 * 60 * 1000,
  };
  return openWorkspace(opts);
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
    fileScope: ["src/beta.mjs"],
    testScope: ["tests/beta.test.mjs"],
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

const OPEN_TREE: TreeState = {
  isFrozen: (): boolean => false,
  onClear: (): (() => void) => (): void => undefined,
};

// A fan-out engine is required by handlePublish's uniform input shape; publish
// dispatches nothing, so the client is never called.
function makeFanout(config: Config, journal: JournalSink, runId: string): Fanout {
  const client = {
    session: {
      create: async (): Promise<{ data: { id: string } }> => ({ data: { id: "ses_never" } }),
      prompt: async (): Promise<{ data: { info: { sessionID: string; finish: string }; parts: [] } }> => ({
        data: { info: { sessionID: "ses_never", finish: "stop" }, parts: [] },
      }),
      abort: async (): Promise<{ data: boolean }> => ({ data: true }),
      messages: async (): Promise<{ data: [] }> => ({ data: [] }),
    },
  };
  return createFanout(
    client as unknown as Parameters<typeof createFanout>[0],
    config,
    journal as unknown as Parameters<typeof createFanout>[2],
    new Map() as unknown as Parameters<typeof createFanout>[3],
    OPEN_TREE,
    runId,
  );
}

interface Bench {
  root: TreePath;
  stateHome: string;
  store: StateStore;
  runId: string;
  runDir: string;
  config: Config;
  queue: Queue;
  fanout: Fanout;
}

// One EXECUTING run, one behavioral item at REVIEWED with the §2.6 red + verify
// records publish rests on, and a real uncommitted implementation in scope.
function buildBench(): Bench {
  const config = makeConfig();
  const root = committedRepo();
  const stateHome = tmpDir("state");
  const sink = makeSink();
  const store = openStore(root, sink, config);
  const run = store.createRun({
    prompt: "make the beta parser keep the sign of negative offsets",
    sessionID: "ses_orchestrator",
    classification: {
      kind: "work",
      rationale: "the prompt asks for a behavioural change",
      check: { agreed: true, note: "" },
    },
  });
  const runId = run.runId;
  const runDir = path.join(store.root, ".conductor", "runs", runId);
  run.state = "EXECUTING";
  store.saveRun(run);

  const queue: Queue = { items: [makeQueueItem("I1")] };
  writeFileSync(path.join(runDir, "queue.json"), JSON.stringify(queue, null, 2));
  store.saveItem(runId, makeRuntimeItem("I1", "REVIEWED"));

  // The item's work, written AFTER the run exists so it is not pre-existing WIP.
  writeFileSync(path.join(root, "src", "beta.mjs"), "export function parse(t) {\n  return Number(t);\n}\n");
  writeFileSync(
    path.join(root, "tests", "beta.test.mjs"),
    'import test from "node:test";\ntest("t", () => {});\n',
  );

  const red: EvidenceRecord = {
    seq: 1,
    ts: START_MS,
    kind: "red",
    itemId: "I1",
    command: [process.execPath, "--test", "tests/beta.test.mjs"],
    exitCode: 1,
    failureExcerpt: "AssertionError [ERR_ASSERTION]: 7 !== -7",
    failureClass: "assertion",
    targeted: true,
  };
  // startedMs in the future keeps every §2.6 freshness mtime term FRESH, so the
  // clean control needs no auto re-verify and the two runs differ in ONE fact.
  const verify: EvidenceRecord = {
    seq: 2,
    ts: START_MS,
    kind: "verify",
    itemId: "I1",
    startedMs: Date.now() + 60_000,
    head: headSha(root) ?? "",
    branch: currentBranch(root) ?? "",
    tree: MAIN_TREE,
    excluded: [],
    green: true,
    scopes: { [SCOPE]: { green: true, exitCode: 0, durationMs: 5 } },
  };
  appendFileSync(path.join(runDir, "evidence.jsonl"), JSON.stringify(red) + "\n");
  appendFileSync(path.join(runDir, "evidence.jsonl"), JSON.stringify(verify) + "\n");
  const item = store.loadItem(runId, "I1");
  item.evidence.red = { ledger: "evidence.jsonl", seq: red.seq };
  item.evidence.validated = { ledger: "evidence.jsonl", seq: verify.seq };
  store.saveItem(runId, item);

  return {
    root,
    stateHome,
    store,
    runId,
    runDir,
    config,
    queue,
    fanout: makeFanout(config, sink, runId),
  };
}

function publishInputFor(bench: Bench): PublishInput {
  return {
    store: bench.store,
    fanout: bench.fanout,
    runId: bench.runId,
    itemId: "I1",
    config: bench.config,
    journal: makeSink(),
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    now: () => START_MS,
  };
}

function batchLines(runDir: string): string[] {
  const file = path.join(runDir, "publish-batch.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

// The gate's view of the SAME persisted fixture, and its verdict — the derivation
// the handler is supposed to be reusing.
function gateOffersPublish(bench: Bench): boolean {
  const run = bench.store.loadRun(bench.runId);
  const gateRun: GateRun = {
    state: run.state,
    stop: run.stop === null ? null : { kind: run.stop.kind },
    classification: { kind: run.classification.kind },
    classified: run.classified === true,
  };
  const items: GateItem[] = bench.queue.items.map((qi) => {
    const item = bench.store.loadItem(bench.runId, qi.id);
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
  const verdict = legalTools(gateRun, items, [], true, isRepo(bench.root));
  return (verdict.legal.get(PUBLISH_TOOL)?.itemIds ?? []).includes("I1");
}

// Run publish and report the outcome uniformly: a REFUSAL may arrive as a thrown
// illegal-call error or as an ok:false denial, and this file pins neither shape —
// what it pins is that nothing was written either way.
interface Outcome {
  refused: boolean;
  detail: string;
}

async function publishOutcome(bench: Bench): Promise<Outcome> {
  try {
    const result = await handlePublish(publishInputFor(bench));
    return { refused: !result.ok, detail: result.denial ?? "(published)" };
  } catch (error) {
    return { refused: true, detail: error instanceof Error ? error.message : String(error) };
  }
}

// The CONTROL half of every row: the identical fixture, unannotated, really does
// publish and really does create a commit. Returns nothing — it throws on failure.
async function assertFixturePublishes(label: string): Promise<void> {
  const bench = buildBench();
  const before = commitCount(bench.root);
  assert.equal(gateOffersPublish(bench), true, `${label} control: the gate offers publish for the clean item`);
  const outcome = await publishOutcome(bench);
  assert.equal(outcome.refused, false, `${label} control: the clean fixture publishes (saw: ${outcome.detail})`);
  assert.equal(
    bench.store.loadItem(bench.runId, "I1").state,
    "PUBLISHED",
    `${label} control: the clean item reaches PUBLISHED`,
  );
  assert.equal(
    commitCount(bench.root),
    before + 1,
    `${label} control: the clean publish created exactly one commit — so "no commit" is a real signal`,
  );
  assert.equal(batchLines(bench.runDir).length, 1, `${label} control: the clean publish appended its batch line`);
}

// ===========================================================================
// [publish-deferred-never-publishes]
// ===========================================================================

test("[publish-deferred-never-publishes] a DEFERRED item sitting at REVIEWED is not publishable — `deferred` is a §2.5 annotation the item FSM table cannot see, so a handler that derives its own precondition from item.state alone commits work the gate never offered", async () => {
  await assertFixturePublishes("deferred row");

  const bench = buildBench();
  bench.store.setDeferred(bench.runId, "I1", {
    reason: `deferred by decision (${DEFER_MARKER})`,
    decisionId: "D-0001",
  });

  // Premises: the fixture is exactly the control's, plus ONE annotation.
  const before = bench.store.loadItem(bench.runId, "I1");
  assert.equal(before.state, "REVIEWED", "premise: the item is at REVIEWED, where publish is the stage tool");
  assert.notEqual(before.deferred, null, "premise: the deferred annotation is persisted");
  assert.equal(before.blocked, null, "premise: `deferred` is the ONLY thing that differs from the control");
  assert.equal(
    gateOffersPublish(bench),
    false,
    "premise: the gate does NOT offer publish for a deferred item — the derivation the handler must reuse",
  );

  const commitsBefore = commitCount(bench.root);
  const head = headSha(bench.root);
  const outcome = await publishOutcome(bench);

  assert.equal(outcome.refused, true, `publish must refuse a deferred item (saw: ${outcome.detail})`);
  assert.equal(commitCount(bench.root), commitsBefore, "and NO commit was created");
  assert.equal(headSha(bench.root), head, "HEAD did not move");
  assert.deepEqual(batchLines(bench.runDir), [], "no publish-batch artifact was appended");
  assert.equal(bench.store.loadItem(bench.runId, "I1").state, "REVIEWED", "the item stayed at REVIEWED");
});

// ===========================================================================
// [publish-blocked-refuses-before-commit]
// ===========================================================================

test("[publish-blocked-refuses-before-commit] a BLOCKED item at REVIEWED is refused BEFORE the commit, not after it: the §3.3 annotation rule is the least reversible write's precondition, so the refusal must leave the repo, the batch artifact and the item exactly as they were", async () => {
  await assertFixturePublishes("blocked row");

  const bench = buildBench();
  bench.store.setBlocked(bench.runId, "I1", {
    reason: `blocked on a surfaced question (${BLOCK_MARKER})`,
    stage: "REVIEWED",
    questionId: "Q-0001",
  });

  const before = bench.store.loadItem(bench.runId, "I1");
  assert.equal(before.state, "REVIEWED", "premise: the item is at REVIEWED, where publish is the stage tool");
  assert.notEqual(before.blocked, null, "premise: the blocked annotation is persisted");
  assert.equal(before.deferred, null, "premise: `blocked` is the ONLY thing that differs from the control");
  assert.equal(
    gateOffersPublish(bench),
    false,
    "premise: the gate does NOT offer publish for a blocked item",
  );

  const commitsBefore = commitCount(bench.root);
  const head = headSha(bench.root);
  const outcome = await publishOutcome(bench);

  assert.equal(outcome.refused, true, `publish must refuse a blocked item (saw: ${outcome.detail})`);
  // The row's whole point: refusing is not enough — the refusal already existed,
  // it just arrived after the commit.
  assert.equal(commitCount(bench.root), commitsBefore, "the refusal came BEFORE the commit — none was created");
  assert.equal(headSha(bench.root), head, "HEAD did not move");
  assert.deepEqual(batchLines(bench.runDir), [], "and no publish-batch artifact was appended either");
  assert.equal(bench.store.loadItem(bench.runId, "I1").state, "REVIEWED", "the item stayed at REVIEWED");
});
