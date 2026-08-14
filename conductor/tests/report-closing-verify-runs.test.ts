// conductor/tests/report-closing-verify-runs.test.ts — the closing verify must
// EXECUTE something before a run is allowed to close.
//
// handleReport passed the literal string "**" to runVerify as the PATH its §2.1
// required scopes are selected against. `selectScopes` glob-matches each
// `verify.requiredScopes` pattern AGAINST that string, so the selection only
// worked for a config whose pattern happens to match the two-character literal
// "**". Under any path-shaped pattern ("src/**", "tests/**") nothing matched,
// `runScopes` returned {}, and `Object.values({}).every(...)` is VACUOUSLY TRUE —
// the run closed REPORTED on a "green" closing verify that ran no command at all.
//
// This is the C-039 shape exactly (there: handleValidate deriving its own
// one-line scope rule instead of the shared union helper), so it takes the C-039
// resolution: the shared `requiredScopeNames` union over the paths the subject
// actually declares — here every queue item's testScope ∪ fileScope — a NAMED
// refusal when no entry covers them, and an empty `scopes` map is not admissible.
//
// Anti-vacuity. "The closing verify was green" is the one assertion that cannot
// tell a real green from a verify that ran nothing, so no row rests on it:
//
//   * every row's scope command APPENDS A LINE TO A WITNESS FILE outside the
//     workspace, and the rows assert the witness line COUNT — a run that executed
//     nothing is red, never a silent pass;
//   * the control run differs from the subject in EXACTLY ONE fact, the
//     requiredScopes PATTERN ("**" vs "src/**" + "tests/**"). Same items, same
//     command, same bench shape. It passes on HEAD and after the fix, which is
//     what makes the subject's failure attributable to pattern selection alone;
//   * row 2 makes the two worlds diverge in the VERDICT: its scope command exits
//     1. A verify that truly ran it reports RED; the vacuous one reports green.
//     Only one mechanism can produce `green:false` here — a scope that ran;
//   * row 3 pins the C-039 refusal layer: with no entry covering the run at all,
//     the report refuses BY NAME, the witness stays empty, and the run is still
//     EXECUTING with no report.md — a report that proves nothing is not written.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { handleReport } from "../adapter/tools.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions, StateStore } from "../adapter/state.ts";
import { globMatch } from "../core/shell-parse.ts";
import type { Config, EvidenceRecord, Item, ItemState, Queue, QueueItem } from "../core/types.ts";

const REPORT_TOOL = "conductor_report";
const SCOPE = "unit-c056";
const START_MS = 1_754_990_000_000;
const WORKSPACE_KEY = "wkey-c056";

// The item's declared paths, and the two path-shaped patterns that cover them.
const FILE_PATH = "src/beta.mjs";
const TEST_PATH = "tests/beta.test.mjs";
const SRC_PATTERN = "src/**";
const TEST_PATTERN = "tests/**";
// The pattern the committed fixtures use — the ONLY reason the defect was invisible.
const MATCH_ALL_PATTERN = "**";
// The placeholder handleReport used to pass as a PATH.
const PLACEHOLDER = "**";

// ---------------------------------------------------------------------------
// Temp dirs
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function tmpDir(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `conductor-c056-${tag}-`));
  tmpDirs.push(dir);
  return dir;
}

// A workspace that is NOT a git repository: §3.9 no-git mode, where an item
// TERMINATES at REVIEWED. That keeps this file about scope selection and nothing
// else — no commits, no publish, no worktrees.
function plainRoot(): string {
  const dir = tmpDir("root");
  mkdirSync(path.join(dir, "src"), { recursive: true });
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  return dir;
}

// ---------------------------------------------------------------------------
// The witness: a file OUTSIDE the workspace that the verify scope command
// appends to. Its line count is how many times the scope actually executed.
// ---------------------------------------------------------------------------

function witnessFile(tag: string): string {
  return path.join(tmpDir("witness"), `${tag}.log`);
}

function witnessRuns(file: string): number {
  if (!existsSync(file)) return 0;
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
}

// A scope command that records its own execution and then exits 0 (or 1).
function witnessCommand(file: string, exitCode: number): string[] {
  const body =
    "require('fs').appendFileSync(" +
    JSON.stringify(file) +
    ", 'ran\\n'); process.exit(" +
    String(exitCode) +
    ");";
  return [process.execPath, "-e", body];
}

// ---------------------------------------------------------------------------
// Journal sink (this file judges the workspace and the ledger on disk).
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
      /* not the subject */
    },
    flushSync(): void {
      /* nothing buffered */
    },
  };
}

// ---------------------------------------------------------------------------
// Config / store / queue fixtures
// ---------------------------------------------------------------------------

function makeConfig(opts: { patterns: string[]; witness: string; exitCode?: number }): Config {
  return {
    version: 1,
    verify: {
      scopes: {
        [SCOPE]: { command: witnessCommand(opts.witness, opts.exitCode ?? 0), timeoutMs: 120_000 },
      },
      behavioralPaths: ["src/**"],
      requiredScopes: opts.patterns.map((pattern) => ({ pattern, scopes: [SCOPE] })),
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
    fileScope: [FILE_PATH],
    testScope: [TEST_PATH],
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

interface Bench {
  root: string;
  stateHome: string;
  store: StateStore;
  runId: string;
  runDir: string;
  config: Config;
  queue: Queue;
  sink: JournalSink;
}

// One EXECUTING run whose single item is SETTLED (no-git mode: REVIEWED is where
// an item ends), so the report's §3.2 completeness check passes and the closing
// verify is the only thing left to happen.
function buildBench(config: Config): Bench {
  const root = plainRoot();
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

  return { root, stateHome, store, runId, runDir, config, queue, sink };
}

function readEvidence(runDir: string): EvidenceRecord[] {
  const file = path.join(runDir, "evidence.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as EvidenceRecord);
}

type VerifyEvidence = Extract<EvidenceRecord, { kind: "verify" }>;

function verifyRecords(runDir: string): VerifyEvidence[] {
  return readEvidence(runDir).filter((r): r is VerifyEvidence => r.kind === "verify");
}

interface ReportShape {
  runState: string;
  reportPath: string;
  verifySeq: number | null;
  green: boolean;
}

async function report(bench: Bench): Promise<ReportShape> {
  const res = await handleReport({
    store: bench.store,
    runId: bench.runId,
    config: bench.config,
    journal: bench.sink,
    stateHome: bench.stateHome,
    workspaceKey: WORKSPACE_KEY,
    metrics: async () => null,
  });
  return { runState: res.runState, reportPath: res.reportPath, verifySeq: res.verifySeq, green: res.green };
}

// ---------------------------------------------------------------------------
// The premise, asserted before anything else: the fixture patterns cover the
// run's real paths and do NOT match the literal "**" placeholder — and the
// committed fixtures' "**" pattern DOES, which is why 1135 green rows could not
// see this. If any of these ever stop holding, the rows below are meaningless
// and this row says so first.
// ---------------------------------------------------------------------------

test("[c056-premise] the fixture's requiredScopes patterns cover the run's declared paths but do NOT match the literal '**' string — and the committed fixtures' '**' pattern does", () => {
  assert.equal(globMatch(SRC_PATTERN, FILE_PATH), true, "src/** covers the item's fileScope path");
  assert.equal(globMatch(TEST_PATTERN, TEST_PATH), true, "tests/** covers the item's testScope path");
  assert.equal(
    globMatch(SRC_PATTERN, PLACEHOLDER),
    false,
    "src/** does NOT match the literal placeholder, so passing '**' as a PATH selects nothing",
  );
  assert.equal(globMatch(TEST_PATTERN, PLACEHOLDER), false, "nor does tests/**");
  assert.equal(
    globMatch(MATCH_ALL_PATTERN, PLACEHOLDER),
    true,
    "control: the committed fixtures' '**' pattern matches the placeholder — why the defect stayed invisible",
  );
});

// ---------------------------------------------------------------------------
// Row 1 — the closing verify EXECUTED a command.
// ---------------------------------------------------------------------------

test("[c056-closing-verify-executes] the closing verify RUNS the scopes §2.1 requires of the run's own paths: the witness file proves the command executed, and the §2.6 record names the scope it ran", async () => {
  // CONTROL: identical bench and identical scope command, differing in ONE fact —
  // the requiredScopes pattern is the fixtures' "**". This passes on HEAD too; it
  // exists so the subject's failure cannot be blamed on the bench, the command,
  // the witness, or the report's own preconditions.
  const controlWitness = witnessFile("control");
  const control = buildBench(makeConfig({ patterns: [MATCH_ALL_PATTERN], witness: controlWitness }));
  assert.equal(witnessRuns(controlWitness), 0, "control premise: nothing has run yet");
  const controlRes = await report(control);
  assert.equal(witnessRuns(controlWitness), 1, "control: the closing verify executed the scope exactly once");
  const controlVerify = verifyRecords(control.runDir);
  assert.equal(controlVerify.length, 1, "control: exactly one closing verify record");
  assert.deepEqual(Object.keys(controlVerify[0].scopes), [SCOPE], "control: the record names the scope it ran");
  assert.equal(controlRes.green, true, "control: and it is green");

  // SUBJECT: same everything, path-shaped patterns.
  const witness = witnessFile("subject");
  const bench = buildBench(makeConfig({ patterns: [SRC_PATTERN, TEST_PATTERN], witness }));
  assert.equal(witnessRuns(witness), 0, "premise: nothing has run yet");

  const res = await report(bench);

  assert.equal(
    witnessRuns(witness),
    1,
    "the closing verify EXECUTED the required scope exactly once — a report that ran no command proves nothing",
  );
  const verifies = verifyRecords(bench.runDir);
  assert.equal(verifies.length, 1, "exactly one closing verify record was appended");
  assert.deepEqual(
    Object.keys(verifies[0].scopes),
    [SCOPE],
    "the §2.6 record names the scope that ran — an empty scopes map is the vacuous green",
  );
  assert.equal(verifies[0].scopes[SCOPE].exitCode, 0, "with the scope's real exit code");
  assert.equal(res.verifySeq, verifies[0].seq, "the return points at that record");
  assert.equal(res.green, true, "and the run's verdict rests on a command that actually ran");
  assert.equal(res.runState, "REPORTED", "the run closes on that evidence");
});

// ---------------------------------------------------------------------------
// Row 2 — the verdict is decided by the scope, not by an empty map.
// ---------------------------------------------------------------------------

test("[c056-closing-verify-red-is-red] a required scope that FAILS makes the closing verify RED: the vacuous selection and the real one diverge on the verdict, and only a scope that ran can produce green:false", async () => {
  const witness = witnessFile("red");
  const bench = buildBench(
    makeConfig({ patterns: [SRC_PATTERN, TEST_PATTERN], witness, exitCode: 1 }),
  );
  assert.equal(witnessRuns(witness), 0, "premise: nothing has run yet");

  const res = await report(bench);

  assert.equal(witnessRuns(witness), 1, "the failing scope was executed exactly once");
  const verifies = verifyRecords(bench.runDir);
  assert.equal(verifies.length, 1, "exactly one closing verify record");
  assert.deepEqual(Object.keys(verifies[0].scopes), [SCOPE], "which names the scope that ran");
  assert.equal(verifies[0].scopes[SCOPE].green, false, "the scope's own result is red");
  assert.equal(verifies[0].scopes[SCOPE].exitCode, 1, "carrying its real exit code");
  assert.equal(res.green, false, "so the closing verify is RED — a vacuous selection would have said green");
  assert.match(
    readFileSync(res.reportPath, "utf8"),
    /Closing verify: RED/,
    "and report.md says so rather than claiming a green nobody earned",
  );
});

// ---------------------------------------------------------------------------
// Row 3 — the C-039 refusal layer.
// ---------------------------------------------------------------------------

test("[c056-uncovered-run-refused] a run no requiredScopes entry covers is REFUSED BY NAME before anything runs (C-039 layer b): no command executes, no report.md is written, and the run stays EXECUTING", async () => {
  const witness = witnessFile("uncovered");
  // A pattern that covers neither of the item's declared paths — and, like every
  // path-shaped pattern, not the literal placeholder either.
  const uncovered = "lib/**";
  assert.equal(globMatch(uncovered, FILE_PATH), false, "premise: the pattern does not cover the fileScope path");
  assert.equal(globMatch(uncovered, TEST_PATH), false, "nor the testScope path");
  const bench = buildBench(makeConfig({ patterns: [uncovered], witness }));

  await assert.rejects(
    () => report(bench),
    (err: Error) => {
      assert.match(err.message, new RegExp("^" + REPORT_TOOL + ":"), "the refusal names the tool");
      assert.match(
        err.message,
        /no verify\.requiredScopes entry covers/,
        "and says exactly what is wrong — never a silent green",
      );
      return true;
    },
  );

  assert.equal(witnessRuns(witness), 0, "nothing executed");
  assert.equal(verifyRecords(bench.runDir).length, 0, "no §2.6 verify record was appended");
  assert.equal(
    existsSync(path.join(bench.runDir, "report.md")),
    false,
    "no report.md: a report that proves nothing is not written",
  );
  assert.equal(bench.store.loadRun(bench.runId).state, "EXECUTING", "and the run is NOT closed");
});
