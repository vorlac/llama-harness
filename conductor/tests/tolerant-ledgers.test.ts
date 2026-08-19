// conductor/tests/tolerant-ledgers.test.ts — Phase IV.2 item 5 (GAP-024): a torn
// ledger line skips-and-counts, every terminal run leaves its §2.9 artifact, and a
// partially-moved quarantine is drained instead of leaking forever.
//
// SUBJECTS:
//   conductor/adapter/jsonl.ts       — the ONE tolerant reader.
//   conductor/adapter/questions.ts   — reads through it (ISSUE-101: handleStatus and
//                                      the stop-report writer died on a torn
//                                      questions.jsonl, so a crashed run was
//                                      unclosable exactly when the artifact matters).
//   conductor/adapter/tools.ts       — ensureTerminalReport: a run whose conductor
//                                      died still hands the human report.md naming
//                                      its disposition, section by section, with a
//                                      section that throws rendering as unavailable
//                                      rather than sinking the artifact (ISSUE-061).
//   conductor/adapter/quarantine.ts  — ISSUE-029: a crash between two moves leaves
//                                      one file still in the repo; that is "never
//                                      moved", not "refilled", and the drained dir
//                                      is removed rather than re-walked by every
//                                      later verify.
//
// HERMETIC: throwaway dirs under os.tmpdir(); no git remote, no socket, no port.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { readJsonlTolerant } from "../adapter/jsonl.ts";
import { appendQuestion, readQuestions } from "../adapter/questions.ts";
import { ensureTerminalReport, handleReport } from "../adapter/tools.ts";
import { openWorkspace } from "../adapter/state.ts";
import type { StateJournal, StateStore } from "../adapter/state.ts";
import { quarantineFiles, replayPendingRestores } from "../adapter/quarantine.ts";
import type { Config, Item, LogLevel, Queue } from "../core/types.ts";

const START_MS = 1_754_560_000_000;

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function scratch(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), tag));
  tmpDirs.push(dir);
  return dir;
}

interface LogCall {
  level: string;
  component: string;
  event: string;
  data: Record<string, unknown>;
}

function makeJournal(): {
  sink: StateJournal & {
    log: (
      level: LogLevel,
      component: string,
      event: string,
      data: Record<string, unknown>,
      corr: { runId: string; itemId?: string; sessionID?: string },
    ) => void;
  };
  calls: LogCall[];
} {
  const calls: LogCall[] = [];
  const sink = {
    log(level: string, component: string, event: string, data: Record<string, unknown>): void {
      calls.push({ level, component, event, data });
    },
  };
  return { sink: sink as never, calls };
}

function makeConfig(): Config {
  const cfg: Config = {
    version: 1,
    verify: { scopes: {}, behavioralPaths: [], requiredScopes: [] },
    format: { rules: [] },
    git: { mode: "commit", branchPolicy: "pin", preexistingDirty: "exclude" },
    workflow: {
      trivialMaxFiles: 1,
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
    parallel: { writes: "off", maxImplementers: 1, maxReaders: 1, subSessionTimeoutMs: 1000 },
    models: { default: "qwen3.6-27b", roles: {} },
    ponytail: "full",
    retention: { keepRuns: 5, maxRunDirBytes: 100_000_000, pruneOnRunCreate: true },
    logging: { level: "info", components: {} },
  };
  return cfg;
}

function makeItem(id: string): Item {
  return {
    id,
    state: "RED",
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

function makeQueue(): Queue {
  return {
    items: [
      {
        id: "I1",
        title: "the item",
        rationale: "because the acceptance says so",
        behavioral: true,
        dependsOn: [],
        fileScope: ["src/a.ts"],
        testScope: ["tests/a.test.ts"],
        acceptance: ["it works"],
        ponytail: { necessary: "yes", reuse: "none", ladderRung: "minimal-code" },
      },
    ],
  };
}

// A workspace with a live run, its queue, and one item — the shape a report reads.
function runBench(pid?: number): { store: StateStore; runId: string; runDir: string; root: string; calls: LogCall[] } {
  const root = scratch("conductor-tolerant-");
  const { sink, calls } = makeJournal();
  const store = openWorkspace({
    root,
    config: makeConfig(),
    journal: sink,
    version: "0.0.0-test",
    sessionID: "ses_test",
    now: () => START_MS,
    ...(pid === undefined ? {} : { pid }),
  });
  const run = store.createRun({
    prompt: "make it work",
    sessionID: "ses_test",
    classification: { kind: "work", rationale: "r", check: { agreed: true, note: "" } },
  });
  const runDir = path.join(root, ".conductor", "runs", run.runId);
  store.saveItem(run.runId, makeItem("I1"));
  writeFileSync(path.join(runDir, "queue.json"), JSON.stringify(makeQueue(), null, 2));
  return { store, runId: run.runId, runDir, root, calls };
}

// ---------------------------------------------------------------------------
// The ONE tolerant reader
// ---------------------------------------------------------------------------

test("[IV.2-tolerant] readJsonlTolerant skips a torn line and COUNTS it", () => {
  const dir = scratch("conductor-jsonl-");
  const file = path.join(dir, "ledger.jsonl");
  writeFileSync(file, '{"a":1}\n{"a":2}\n{"a":3\n');

  const read = readJsonlTolerant<{ a: number }>(file);
  assert.deepEqual(read.records.map((r) => r.a), [1, 2], "every parseable line is returned");
  assert.equal(read.torn, 1, "the unparseable tail is counted: some callers must know the ledger is not whole");

  const absent = readJsonlTolerant(path.join(dir, "nothing.jsonl"));
  assert.deepEqual(absent, { records: [], torn: 0 }, "an absent ledger reads as empty, never as a throw");
});

test("[IV.2-tolerant] ISSUE-101: readQuestions heals a torn questions.jsonl instead of dying with a raw SyntaxError", () => {
  const dir = scratch("conductor-questions-");
  const good = {
    id: "Q-0001",
    tsMs: START_MS,
    runId: "r-1",
    question: "what now",
    askedBy: { role: "implementer", sessionID: "ses" },
    humanTerritory: false,
    origin: "implementer-blocked",
    blocksItems: ["I1"],
    answeredIso: null,
    answer: null,
    answeredVia: null,
  };
  // The crash fingerprint: a whole record, then a line the kill cut in half.
  writeFileSync(path.join(dir, "questions.jsonl"), JSON.stringify(good) + '\n{"id":"Q-0002","tsMs":17');

  const questions = readQuestions(dir);
  assert.equal(questions.length, 1, "the whole record is still readable");
  assert.equal(questions[0].id, "Q-0001", "and it is the record that was actually written");

  // The mint must still advance PAST the torn line's id rather than colliding with it.
  const minted = appendQuestion(
    dir,
    {
      runId: "r-1",
      question: "and now",
      askedBy: { role: "implementer", sessionID: "ses" },
      humanTerritory: false,
      origin: "implementer-blocked",
      blocksItems: ["I1"],
    },
    START_MS + 1,
  );
  assert.notEqual(minted.id, "Q-0001", "the mint does not re-issue a live id");
  assert.equal(readQuestions(dir).length, 2, "and the ledger is readable afterwards");
});

// ---------------------------------------------------------------------------
// The guaranteed terminal report
// ---------------------------------------------------------------------------

test("[IV.2-report] a run whose conductor DIED leaves report.md naming its disposition on the next open", () => {
  // The previous conductor: a pid that is provably gone, recorded as the beacon's
  // owner, with a live run and no stop — the shape a kill leaves behind.
  const bench = runBench(999_999_999);
  const store = bench.store;
  store.release();

  const { sink } = makeJournal();
  const reopened = openWorkspace({
    root: bench.root,
    config: makeConfig(),
    journal: sink,
    version: "0.0.0-test",
    sessionID: "ses_second",
    now: () => START_MS + 60_000,
  });

  const result = ensureTerminalReport({ store: reopened, journal: sink, now: () => START_MS + 60_000 });

  assert.equal(result.written, true, "the artifact §2.9 owes the human is written on the next open");
  const report = readFileSync(path.join(bench.runDir, "report.md"), "utf8");
  assert.ok(report.includes("Run disposition:"), "the report NAMES the run's disposition: " + report.slice(0, 200));
  assert.ok(report.includes("I1"), "and accounts for each item");
  assert.ok(
    report.includes(String(999_999_999)),
    "and names the conductor that is gone, so the reader knows why the run stopped mid-flight",
  );
});

test("[IV.2-report] an existing report is never clobbered, and a live owner's run gets no premature artifact", () => {
  const bench = runBench();
  const { sink } = makeJournal();

  // The owner is THIS process, which is alive: the run is in flight, not dead.
  const live = ensureTerminalReport({ store: bench.store, journal: sink, now: () => START_MS + 1 });
  assert.equal(live.written, false, "a run whose conductor is alive is not closed behind its back");
  assert.equal(existsSync(path.join(bench.runDir, "report.md")), false, "and no artifact is fabricated for it");

  // A report that already stands is the run's artifact; a later pass leaves it be.
  writeFileSync(path.join(bench.runDir, "report.md"), "# the real report\n");
  const again = ensureTerminalReport({ store: bench.store, journal: sink, now: () => START_MS + 2 });
  assert.equal(again.written, false, "an existing artifact is not overwritten");
  assert.equal(readFileSync(path.join(bench.runDir, "report.md"), "utf8"), "# the real report\n", "byte-for-byte");
});

test("[IV.2-report] ISSUE-061: a section that cannot be built renders as unavailable — the artifact still lands", () => {
  const bench = runBench(999_999_999);
  bench.store.release();
  // The queue this run's item section is built from is torn by the same crash.
  writeFileSync(path.join(bench.runDir, "queue.json"), '{"items": [ {"id": "I1"');
  // So is the question ledger.
  writeFileSync(path.join(bench.runDir, "questions.jsonl"), '{"id":"Q-0001","tsMs"');

  const { sink } = makeJournal();
  const reopened = openWorkspace({
    root: bench.root,
    config: makeConfig(),
    journal: sink,
    version: "0.0.0-test",
    sessionID: "ses_second",
    now: () => START_MS + 60_000,
  });
  const result = ensureTerminalReport({ store: reopened, journal: sink, now: () => START_MS + 60_000 });

  assert.equal(result.written, true, "a torn run dir still gets its artifact — that is exactly when one is needed");
  const report = readFileSync(path.join(bench.runDir, "report.md"), "utf8");
  assert.ok(report.includes("unavailable"), "the section that could not be built says so: " + report.slice(0, 300));
  assert.ok(report.includes("Run disposition:"), "and the sections that could be built are all there");
});

test("[IV.2-report] ISSUE-061: the §2.9 stop-report writer never throws away the artifact over one bad section", async () => {
  const bench = runBench();
  // The run stopped, and the crash that stopped it left the queue naming an item
  // whose runtime file was never written — reading it throws inside the item
  // section, which is precisely the shape that used to leave a stopped run with no
  // artifact at all.
  const run = bench.store.loadRun(bench.runId);
  run.stop = { kind: "blocked", reasonDisplay: "everything is blocked", tsMs: START_MS + 10 };
  bench.store.saveRun(run);
  const queue = makeQueue();
  queue.items.push({ ...queue.items[0], id: "I2" });
  writeFileSync(path.join(bench.runDir, "queue.json"), JSON.stringify(queue, null, 2));

  const { sink } = makeJournal();
  const result = await handleReport({
    store: bench.store,
    runId: bench.runId,
    config: makeConfig(),
    journal: sink,
    stateHome: scratch("conductor-report-state-"),
    workspaceKey: "wskey",
    now: () => START_MS + 20,
  });

  assert.equal(result.stopReport, true, "the stop-report mode ran");
  const report = readFileSync(path.join(bench.runDir, "report.md"), "utf8");
  assert.ok(report.includes("Stop kind: blocked"), "the artifact states the stop it was written for");
  assert.ok(
    report.includes("unavailable"),
    "and the section it could not build says so instead of taking the artifact down: " + report.slice(0, 400),
  );
});

test("[IV.2-report] ISSUE-061: a stopped run whose queue.json is torn still gets its artifact", async () => {
  const bench = runBench();
  const run = bench.store.loadRun(bench.runId);
  run.stop = { kind: "interrupt", reasonDisplay: "the operator halted the run", tsMs: START_MS + 10 };
  bench.store.saveRun(run);
  writeFileSync(path.join(bench.runDir, "queue.json"), '{"items": [ {"id": "I1"');

  const { sink } = makeJournal();
  const result = await handleReport({
    store: bench.store,
    runId: bench.runId,
    config: makeConfig(),
    journal: sink,
    stateHome: scratch("conductor-report-state2-"),
    workspaceKey: "wskey",
    now: () => START_MS + 20,
  });

  assert.equal(result.stopReport, true, "the artifact is still written for a run whose queue a kill cut in half");
  const report = readFileSync(path.join(bench.runDir, "report.md"), "utf8");
  assert.ok(report.includes("Stop kind: interrupt"), "and it states the stop: " + report.slice(0, 200));
  assert.ok(report.includes("unavailable"), "with the queue-derived sections naming the failure");
});

// ---------------------------------------------------------------------------
// ISSUE-029: the partially-moved quarantine is drained, not leaked
// ---------------------------------------------------------------------------

test("[IV.2-quarantine] a crash between two moves is healed and the dir is REMOVED, not preserved as a permanent conflict", () => {
  const repo = scratch("conductor-quar-repo-");
  const stateHome = scratch("conductor-quar-state-");
  mkdirSync(path.join(repo, "tests"), { recursive: true });
  writeFileSync(path.join(repo, "tests", "a.test.ts"), "a\n");
  writeFileSync(path.join(repo, "tests", "b.test.ts"), "b\n");

  const handle = quarantineFiles({
    repoRoot: repo,
    files: ["tests/a.test.ts", "tests/b.test.ts"],
    stateHome,
    workspaceKey: "wskey",
    runId: "r-dead",
    pid: 999_999_999,
  });

  // The crash: A was moved out, B never was. B is therefore present in the repo
  // because it was NEVER MOVED — which is not the same fact as "the slot was
  // refilled while we were away", and treating it as a conflict is what preserved
  // the dir forever and re-walked it on every later verify.
  const storedB = path.join(handle.quarantineDir, "tests__b.test.ts");
  rmSync(storedB, { force: true });
  writeFileSync(path.join(repo, "tests", "b.test.ts"), "b\n");

  const restored = replayPendingRestores({ stateHome, workspaceKey: "wskey" });

  assert.ok(restored.includes("tests/a.test.ts"), "the file that WAS moved out is put back");
  assert.equal(readFileSync(path.join(repo, "tests", "a.test.ts"), "utf8"), "a\n", "with its contents");
  assert.equal(readFileSync(path.join(repo, "tests", "b.test.ts"), "utf8"), "b\n", "and the never-moved file is untouched");

  const quarantineRoot = path.join(stateHome, "conductor", "wskey", "quarantine");
  const leftovers = existsSync(quarantineRoot) ? readdirSync(quarantineRoot) : [];
  assert.deepEqual(leftovers, [], "the drained quarantine dir is removed: nothing is left for the next verify to re-walk");

  const second = replayPendingRestores({ stateHome, workspaceKey: "wskey" });
  assert.deepEqual(second, [], "and a second sweep finds nothing to do");
});

test("[IV.2-quarantine] a genuinely REFILLED slot is still a conflict: the stored copy is kept, never clobbered over the new file", () => {
  const repo = scratch("conductor-quar-repo2-");
  const stateHome = scratch("conductor-quar-state2-");
  mkdirSync(path.join(repo, "tests"), { recursive: true });
  writeFileSync(path.join(repo, "tests", "a.test.ts"), "the quarantined red\n");

  quarantineFiles({
    repoRoot: repo,
    files: ["tests/a.test.ts"],
    stateHome,
    workspaceKey: "wskey",
    runId: "r-dead",
    pid: 999_999_999,
  });
  // The stored copy is still parked out of the repo AND the slot was refilled by
  // someone else: restoring would destroy the newer file.
  writeFileSync(path.join(repo, "tests", "a.test.ts"), "a NEWER file someone wrote\n");

  replayPendingRestores({ stateHome, workspaceKey: "wskey" });

  assert.equal(
    readFileSync(path.join(repo, "tests", "a.test.ts"), "utf8"),
    "a NEWER file someone wrote\n",
    "the refilled slot is never clobbered",
  );
  const quarantineRoot = path.join(stateHome, "conductor", "wskey", "quarantine");
  assert.deepEqual(
    readdirSync(quarantineRoot),
    ["r-dead"],
    "and the stored copy stays parked, because dropping it would lose the file outright",
  );
});
