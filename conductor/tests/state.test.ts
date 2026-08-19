// Task 4.1 red tests — lives at conductor/tests/state.test.ts.
//
// Subject (must NOT exist when this goes red; the failure is
// `Cannot find module '../adapter/state.ts'` — the missing-subject shape, a legal
// red because the unresolved path resolves inside THIS task's fileScope):
//   - conductor/adapter/state.ts     (the .conductor/ crash-safe state store)
// The sibling subject conductor/adapter/questions.ts is pinned by questions.test.ts.
//
// ADAPTER module (G14): the subject uses node:fs / node:child_process / node:path /
// node:crypto only, may read the wall clock (adapters do I/O + clock), and NEVER a
// single-runtime (Bun) API or a shell tag. It calls adapter/gitio.ts (real git reads:
// this task is built AFTER 4.2 precisely so createRun can capture startHead/startBranch/
// startDirty from a REAL repo, G4 forbids stubbing them) and journals through an
// injected sink. Every fixture here is a throwaway dir under os.tmpdir(); the
// git-dependent fixtures are `git init`-ed with a hermetic env (GIT_CONFIG_GLOBAL=
// /dev/null) and torn down in after(). This test never runs git against the
// llama-harness repo and never touches port 8080.
//
// Spec read for this test (docs/plans/2026-08-07-conductor-harness-plan.md):
//   2276-2304 §4.1 task + its full enumerated step list (pinned below, un-thinned).
//   671-712   §2.3 run.json shape (startHead/startBranch/startDirty/excludedStaleRed).
//   758-796   §2.5 item + dispositions (blocked/deferred/debugging) + the `open`/
//             itemsSummary definitions.
//   979-1026  §2.11 questions ledger + the WORKSPACE stale-red registry.
//   410-467   §1.2 target layout: .conductor/{config.json,state/{current-run.json,
//             alive.json,stale-red.json,halt,run.lock},runs/<runId>/...} and the
//             .git/info/exclude registration of the `.conductor/` prefix.
//   1478-1495 §3.8 liveness beacon alive.json {pid,startMs,version,sessionID}.
//   1496-1509 §3.9 no-git mode: exclude registration + git provenance simply skipped.
//   docs/build/specs/task-4.1.assertions.json — the 10 rows mapped below.
//
// ---------------------------------------------------------------------------
// PINNED EXPORT SURFACE the implementer must target (state.ts). Derived from the
// §4.1 task text; the open mechanisms (atomic-write injection hook, over-age lock
// threshold, beacon shape, the DI clock) are recorded in the return that ships this
// file. Everything a test reads is here so the implementer can hit it exactly.
//
//   // --- crash-safety primitives ---
//   writeFileAtomicSync(filePath, data: string, opts?: {
//       pid?: number;                          // default process.pid; names the tmp
//       onBeforeRename?: (tmpPath: string) => void;  // injection point: runs AFTER the
//   }): void                                   //   pid-suffixed sibling tmp is fully
//       // written, BEFORE the atomic rename. Throwing here simulates a crash mid-commit
//       // and MUST leave the OLD target intact and remove the tmp (no leftover).
//   readJsonFileSync(filePath): unknown        // strips a leading UTF-8 BOM, then JSON.parse
//   appendLedgerLineRaw(filePath, record): void
//       // the RAW evidence-ledger appender. G6: evidence.ts is THE evidence writer, so
//       // no OTHER adapter may reference this export name — enforced by the source scan
//       // test below (only state.ts, and later evidence.ts, may name it).
//
//   registerConductorExclude(root): boolean
//       // ensures a single `.conductor/` line in <root>/.git/info/exclude; idempotent
//       // (a second call adds nothing). Returns false and writes nothing when <root>
//       // is not a git repo (§3.9). Skipped == false, present-or-added == true.
//
//   // --- the store ---
//   interface StateJournal { log(level, component, event, data, corr): void }
//       // corr = { runId?; itemId?; sessionID? } — runId OPTIONAL because the lock and
//       // beacon are workspace-level events that precede any run. Structurally the real
//       // adapter/journal.ts Journal (minus the mandatory runId) can be adapted to it.
//   interface OpenOptions { root; config: Config; journal: StateJournal; version: string;
//       sessionID: string; now?: () => number; pid?: number; staleLockMs?: number }
//       // now() is THE clock the store reads for beacon.startMs, lock.startMs and
//       // disposition sinceMs (defaults to Date.now); pid defaults to process.pid;
//       // staleLockMs is the over-age lock threshold (default 24h).
//   interface LockRecord { pid: number; startMs: number; sessionID? } // .conductor/state/run.lock
//   interface Beacon { pid: number; startMs: number; version: string; sessionID: string }
//   interface CreateRunInput { prompt; sessionID; classification: {kind;rationale;check:{agreed;note}} }
//   openWorkspace(opts): StateStore
//     // at init: registers the exclude (repo only), acquires the single-writer lock,
//     // then writes the §3.8 beacon — a live foreign lock REFUSES the open (D6) with a
//     // loud (warn) journal record; a dead-pid OR over-age lock => broken
//     // (lock.stale-break) + claimed. See conductor/tests/workspace-lock.test.ts.
//   interface StateStore {
//     readonly root: string;
//     createRun(input): Run; loadRun(runId): Run; saveRun(run): void;
//     currentRun(): Run | null; archiveRun(runId): void;
//     loadItem(runId, itemId): Item; saveItem(runId, item): void;
//     setBlocked(runId, itemId, { reason; stage; questionId? }): Item;   // stamps sinceMs = now()
//     clearBlocked(runId, itemId): Item;
//     setDeferred(runId, itemId, { reason; decisionId }): Item;
//     setDebugging(runId, itemId, { hypothesis }): Item;                 // stamps sinceMs = now()
//     itemsSummary(runId): { open; blocked; deferred; surfacedQuestions };
//     readStaleRed(): StaleRedRegistry;
//     addStaleRed(entry): StaleRedRegistry; removeStaleRed(path): StaleRedRegistry;
//     readBeacon(): Beacon | null; isHalted(): boolean; release(): void;
//   }
// ---------------------------------------------------------------------------
//
// Assertion id -> test name (docs/build/specs/task-4.1.assertions.json):
//   4.1-lifecycle       -> "[4.1-lifecycle] createRun captures startHead/startBranch/
//                           startDirty + the active stale-red entries; loadRun/saveRun/
//                           currentRun/archiveRun round-trip"
//   4.1-retention       -> "[4.1-retention] createRun prunes run dirs to keepRuns
//                           oldest-first and never touches the live run"
//   4.1-dispositions    -> "[4.1-dispositions] setBlocked/clearBlocked/setDeferred/
//                           setDebugging round-trip through disk"
//                        + "[4.1-dispositions] itemsSummary computes {open,blocked,
//                           deferred,surfacedQuestions}"
//   4.1-stale-red       -> "[4.1-stale-red] the workspace stale-red registry reads/adds/
//                           removes"
//   4.1-evidence-append -> "[4.1-evidence-append] only evidence.ts (and state.ts) may
//                           reference the raw ledger-append export (G6 source scan)"
//   4.1-atomic          -> "[4.1-atomic] an injected mid-write throw leaves the old file
//                           intact; the tmp is pid-suffixed, same-dir, and cleaned up"
//                        + "[4.1-atomic] reads tolerate a UTF-8 BOM (primitive + loadRun)"
//   4.1-exclude         -> "[4.1-exclude] .git/info/exclude registration is idempotent"
//                        + "[4.1-exclude] no-git mode skips the exclude write and does not
//                           crash (§3.9)"
//   4.1-beacon          -> "[4.1-beacon] the liveness beacon is written at init (§3.8)"
//                        + "[4.1-beacon] isHalted reflects the presence of the halt file"
//   4.1-lock            -> "[4.1-lock] a fresh workspace claims the single-writer lock"
//                        + "[4.1-lock] a LIVE foreign lock forces read-only mode + a loud
//                           journal warning and is left intact"
//                        + "[4.1-lock] a STALE lock (dead pid) is broken and the lock is
//                           claimed"
//                        + "[4.1-lock] a STALE lock (over-age) is broken even though its
//                           pid is alive"

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, devNull } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// The subject under test — absent at red time (the missing-subject red).
import {
  openWorkspace,
  writeFileAtomicSync,
  readJsonFileSync,
  registerConductorExclude,
} from "../adapter/state.ts";
import type { OpenOptions, StateJournal, LockRecord } from "../adapter/state.ts";
import type { Config, Run, Item } from "../core/types.ts";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

// A fixed injected clock base (plan §2.11 example tsMs). The store reads OpenOptions.now
// for every timestamp, so every stamped value below is deterministic.
const START_MS = 1_754_560_000_000;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADAPTER_DIR = path.resolve(HERE, "..", "adapter");
const HEX40 = /^[0-9a-f]{40}$/;

const tmpDirs: string[] = [];

after(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Hermetic git for BUILDING fixtures — no global/system config can leak in.
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

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function scratchDir(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), tag));
  tmpDirs.push(dir);
  return dir;
}

function initRepo(): string {
  const dir = scratchDir("conductor-state-");
  git(dir, ["init", "-b", "main"]);
  return dir;
}

function bareTempDir(): string {
  return scratchDir("conductor-state-nogit-");
}

function write(dir: string, name: string, content: string): void {
  writeFileSync(path.join(dir, name), content);
}

function commit(dir: string, name: string, content: string, message: string): void {
  write(dir, name, content);
  git(dir, ["add", name]);
  git(dir, ["commit", "-m", message]);
}

// A mutable injected clock local to a test (node:test runs top-level tests
// sequentially, but a per-test clock is concurrency-safe regardless).
function makeClock(start = START_MS): { now: () => number; advance: (d: number) => void; get: () => number } {
  let t = start;
  return { now: () => t, advance: (d: number) => { t += d; }, get: () => t };
}

interface LogCall {
  level: string;
  component: string;
  event: string;
  data: Record<string, unknown>;
  corr: { runId?: string; itemId?: string; sessionID?: string };
}

// A capture journal: records every log() call so the lock/beacon behaviors are
// observable. Structurally a StateJournal (its runId is optional, per the surface).
function makeJournal(): { sink: StateJournal; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const sink: StateJournal = {
    log(level, component, event, data, corr) {
      calls.push({ level, component, event, data, corr });
    },
  };
  return { sink, calls };
}

// A complete §2.1 Config; overrides let a test bend just what it needs.
function makeConfig(overrides: Partial<Config> = {}): Config {
  const base: Config = {
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
  return { ...base, ...overrides };
}

function freshOpts(root: string, overrides: Partial<OpenOptions> = {}): OpenOptions {
  const base: OpenOptions = {
    root,
    config: makeConfig(),
    journal: makeJournal().sink,
    version: "0.0.0-test",
    sessionID: "ses_default",
    now: () => START_MS,
    pid: process.pid,
    staleLockMs: 24 * 60 * 60 * 1000,
  };
  return { ...base, ...overrides };
}

function makeItem(id: string, overrides: Partial<Item> = {}): Item {
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
  return { ...base, ...overrides };
}

const classification = { kind: "work" as const, rationale: "because", check: { agreed: true, note: "" } };

// The normative on-disk locations (§1.2), reused by tests that inspect files directly.
function stateDir(root: string): string {
  return path.join(root, ".conductor", "state");
}
function runDir(root: string, runId: string): string {
  return path.join(root, ".conductor", "runs", runId);
}
function lockPath(root: string): string {
  return path.join(stateDir(root), "run.lock");
}

function preWriteLock(root: string, rec: LockRecord): void {
  mkdirSync(stateDir(root), { recursive: true });
  writeFileSync(lockPath(root), JSON.stringify(rec));
}

function readLock(root: string): LockRecord {
  return JSON.parse(readFileSync(lockPath(root), "utf8")) as LockRecord;
}

// ---------------------------------------------------------------------------
// 4.1-lifecycle
// ---------------------------------------------------------------------------

test("[4.1-lifecycle] createRun captures startHead/startBranch/startDirty + the active stale-red entries; loadRun/saveRun/currentRun/archiveRun round-trip", () => {
  const repo = initRepo();
  commit(repo, "tracked.ts", "export const x = 1;\n", "seed commit");
  // Dirt that existed BEFORE conductor touched anything (§2.3 startDirty): a modified
  // tracked file plus a brand-new untracked file.
  write(repo, "tracked.ts", "export const x = 2;\n");
  write(repo, "untracked.ts", "wip\n");

  const store = openWorkspace(freshOpts(repo));
  // Two active §2.11 stale-red entries must be carried into run.excludedStaleRed.
  store.addStaleRed({ path: "tests/i2.test.ts", itemId: "I2", runId: "r-old", sinceMs: START_MS, reason: "blocked at RED" });
  store.addStaleRed({ path: "tests/i5.test.ts", itemId: "I5", runId: "r-old", sinceMs: START_MS, reason: "blocked at RED" });

  const run = store.createRun({ prompt: "do it", sessionID: "ses_main", classification });

  assert.match(run.startHead, HEX40, "startHead is the full 40-hex HEAD sha");
  assert.equal(run.startHead, git(repo, ["rev-parse", "HEAD"]).trim(), "startHead equals the fixture repo's real HEAD");
  assert.equal(run.startBranch, "main", "startBranch is the fixture's branch");
  assert.ok(run.startDirty.includes("tracked.ts"), "startDirty captures the pre-existing tracked-modified file");
  assert.deepEqual([...run.excludedStaleRed].sort(), ["tests/i2.test.ts", "tests/i5.test.ts"], "createRun carries the active stale-red entries into excludedStaleRed");
  assert.equal(run.prompt, "do it");
  assert.equal(run.state, "INTAKE", "a new run starts at the head of the §3.1 run FSM");
  assert.equal(run.stop, null);

  // currentRun points at the new run.
  assert.equal(store.currentRun()?.runId, run.runId, "the new run becomes current");

  // saveRun/loadRun round-trip a mutation.
  const mutated: Run = { ...run, state: "DECOMPOSED", planReviewRounds: 2 };
  store.saveRun(mutated);
  const reloaded = store.loadRun(run.runId);
  assert.equal(reloaded.state, "DECOMPOSED", "saveRun then loadRun round-trips the mutation");
  assert.equal(reloaded.planReviewRounds, 2);
  assert.equal(reloaded.startHead, run.startHead, "provenance survives the round-trip");

  // archiveRun clears the current pointer but leaves the run dir readable.
  store.archiveRun(run.runId);
  assert.equal(store.currentRun(), null, "archiveRun clears the current-run pointer");
  assert.equal(store.loadRun(run.runId).runId, run.runId, "the archived run is still loadable from disk");
});

// ---------------------------------------------------------------------------
// 4.1-retention
// ---------------------------------------------------------------------------

test("[4.1-retention] createRun prunes run dirs to keepRuns oldest-first and never touches the live run", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");
  const clock = makeClock();
  const store = openWorkspace(
    freshOpts(repo, {
      config: makeConfig({ retention: { keepRuns: 2, maxRunDirBytes: 100_000_000, pruneOnRunCreate: true } }),
      now: clock.now,
    }),
  );

  const mk = (): Run => {
    const r = store.createRun({ prompt: "p", sessionID: "ses", classification });
    clock.advance(1000); // strictly increasing createdIso, so "oldest" is unambiguous
    return r;
  };
  const a = mk();
  const b = mk();
  const c = mk();
  assert.notEqual(a.runId, b.runId, "run ids are distinct");
  assert.notEqual(b.runId, c.runId, "run ids are distinct");

  const runsDir = path.join(repo, ".conductor", "runs");
  const remaining = readdirSync(runsDir)
    .filter((n) => existsSync(path.join(runsDir, n, "run.json")))
    .sort();
  assert.deepEqual(remaining, [b.runId, c.runId].sort(), "exactly keepRuns run dirs remain");
  assert.ok(!remaining.includes(a.runId), "the OLDEST run dir was pruned first");
  assert.equal(store.currentRun()?.runId, c.runId, "the live (newest) run is current and was never pruned");
  assert.throws(() => store.loadRun(a.runId), "the pruned run is gone from disk");
});

// ---------------------------------------------------------------------------
// 4.1-dispositions
// ---------------------------------------------------------------------------

test("[4.1-dispositions] setBlocked/clearBlocked/setDeferred/setDebugging round-trip through disk", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");
  const store = openWorkspace(freshOpts(repo));
  const run = store.createRun({ prompt: "p", sessionID: "ses", classification });
  store.saveItem(run.runId, makeItem("I1"));

  const blocked = store.setBlocked(run.runId, "I1", { reason: "test-repair exhausted", stage: "RED" });
  assert.equal(blocked.blocked?.reason, "test-repair exhausted");
  assert.equal(blocked.blocked?.stage, "RED");
  assert.equal(blocked.blocked?.sinceMs, START_MS, "setBlocked stamps sinceMs from the injected clock");
  assert.equal(store.loadItem(run.runId, "I1").blocked?.reason, "test-repair exhausted", "blocked survives on disk");

  const cleared = store.clearBlocked(run.runId, "I1");
  assert.equal(cleared.blocked, null, "clearBlocked nulls the disposition");
  assert.equal(store.loadItem(run.runId, "I1").blocked, null, "the cleared state survives on disk");

  const deferred = store.setDeferred(run.runId, "I1", { reason: "not this run", decisionId: "D-1" });
  assert.equal(deferred.deferred?.reason, "not this run");
  assert.equal(deferred.deferred?.decisionId, "D-1");
  assert.equal(store.loadItem(run.runId, "I1").deferred?.decisionId, "D-1", "deferred survives on disk");

  const debugging = store.setDebugging(run.runId, "I1", { hypothesis: "off-by-one in the tokenizer" });
  assert.equal(debugging.debugging?.hypothesis, "off-by-one in the tokenizer");
  assert.equal(debugging.debugging?.sinceMs, START_MS, "setDebugging stamps sinceMs from the injected clock");
  assert.equal(store.loadItem(run.runId, "I1").debugging?.hypothesis, "off-by-one in the tokenizer", "debugging survives on disk");
});

test("[4.1-dispositions] itemsSummary computes {open,blocked,deferred,surfacedQuestions}", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");
  const store = openWorkspace(freshOpts(repo));
  const run = store.createRun({ prompt: "p", sessionID: "ses", classification });

  // §2.5: open iff state !== PUBLISHED && blocked === null && deferred === null.
  store.saveItem(run.runId, makeItem("I1", { state: "PENDING" })); // open
  store.saveItem(run.runId, makeItem("I2", { state: "RED", blocked: { reason: "x", sinceMs: START_MS, stage: "RED" } })); // blocked
  store.saveItem(run.runId, makeItem("I3", { state: "GREEN", deferred: { reason: "later", decisionId: "D-9" } })); // deferred
  store.saveItem(run.runId, makeItem("I4", { state: "PUBLISHED" })); // neither open, blocked, nor deferred

  // questions.jsonl: one open (answeredIso null) contributes to surfacedQuestions; one
  // answered does not. Written directly so this pins itemsSummary's READ, not questions.ts.
  const q1 = { id: "Q-0001", tsMs: START_MS, runId: run.runId, question: "open?", askedBy: { role: "planner", sessionID: "ses" }, humanTerritory: true, origin: "plan-review-cap", blocksItems: ["I2"], answeredIso: null, answer: null };
  const q2 = { id: "Q-0002", tsMs: START_MS, runId: run.runId, question: "closed?", askedBy: { role: "planner", sessionID: "ses" }, humanTerritory: true, origin: "surface-tool", blocksItems: [], answeredIso: new Date(START_MS).toISOString(), answer: "yes" };
  writeFileSync(path.join(runDir(repo, run.runId), "questions.jsonl"), JSON.stringify(q1) + "\n" + JSON.stringify(q2) + "\n");

  const summary = store.itemsSummary(run.runId);
  assert.deepEqual(summary, { open: 1, blocked: 1, deferred: 1, surfacedQuestions: 1 }, "itemsSummary counts items by disposition and open questions");
});

// ---------------------------------------------------------------------------
// 4.1-stale-red
// ---------------------------------------------------------------------------

test("[4.1-stale-red] the workspace stale-red registry reads/adds/removes", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");
  const store = openWorkspace(freshOpts(repo));

  const empty = store.readStaleRed();
  assert.equal(empty.version, 1, "a fresh registry is version 1");
  assert.deepEqual(empty.entries, [], "a fresh registry has no entries");

  store.addStaleRed({ path: "tests/i2.test.ts", itemId: "I2", runId: "r-1", sinceMs: START_MS, reason: "blocked at RED" });
  store.addStaleRed({ path: "tests/i5.test.ts", itemId: "I5", runId: "r-1", sinceMs: START_MS, reason: "blocked at RED" });
  const two = store.readStaleRed();
  assert.deepEqual(two.entries.map((e) => e.path).sort(), ["tests/i2.test.ts", "tests/i5.test.ts"], "adds accumulate");

  const after = store.removeStaleRed("tests/i2.test.ts");
  assert.deepEqual(after.entries.map((e) => e.path), ["tests/i5.test.ts"], "removeStaleRed drops exactly the named path");

  // Persisted to the workspace-level file (§2.11), so it survives runs.
  const onDisk = readJsonFileSync(path.join(stateDir(repo), "stale-red.json")) as { entries: Array<{ path: string }> };
  assert.deepEqual(onDisk.entries.map((e) => e.path), ["tests/i5.test.ts"], "the registry persists to .conductor/state/stale-red.json");
});

// ---------------------------------------------------------------------------
// 4.1-evidence-append  (G6 source scan)
// ---------------------------------------------------------------------------

test("[4.1-evidence-append] only evidence.ts (and state.ts) may reference the raw ledger-append export (G6 source scan)", () => {
  // Assembled by concatenation so this guard can never match its OWN mention of the
  // token (defensive; conductor/tests/ is not scanned anyway).
  const rawAppendExport = "append" + "LedgerLineRaw";
  const allowed = new Set(["state.ts", "evidence.ts"]);

  const adapterFiles = readdirSync(ADAPTER_DIR).filter((n) => n.endsWith(".ts"));
  const referencing = adapterFiles.filter((n) => readFileSync(path.join(ADAPTER_DIR, n), "utf8").includes(rawAppendExport));

  const illegal = referencing.filter((n) => !allowed.has(n));
  assert.deepEqual(illegal, [], "the raw ledger-append export is the private primitive of the evidence writer (G6): no other adapter may name it — offenders: " + illegal.join(", "));
  assert.ok(referencing.includes("state.ts"), "state.ts must export the raw ledger-append primitive (otherwise this invariant is vacuous)");
});

// ---------------------------------------------------------------------------
// 4.1-atomic
// ---------------------------------------------------------------------------

test("[4.1-atomic] an injected mid-write throw leaves the old file intact; the tmp is pid-suffixed, same-dir, and cleaned up", () => {
  const dir = scratchDir("conductor-atomic-");
  const target = path.join(dir, "run.json");

  writeFileAtomicSync(target, '{"v":1}');
  assert.equal(readFileSync(target, "utf8"), '{"v":1}', "the first write lands");
  assert.deepEqual(readdirSync(dir).filter((n) => n !== "run.json"), [], "a successful write leaves no tmp behind");

  // Force a crash between the tmp write and the rename.
  let seenTmp = "";
  assert.throws(
    () =>
      writeFileAtomicSync(target, '{"v":2}', {
        onBeforeRename: (tmp) => {
          seenTmp = tmp;
          throw new Error("boom: simulated crash mid-commit");
        },
      }),
    /boom/,
    "the injected throw propagates",
  );

  assert.equal(readFileSync(target, "utf8"), '{"v":1}', "the OLD file is intact after an interrupted write (tmp+rename)");
  assert.ok(seenTmp.length > 0 && seenTmp.includes(String(process.pid)), "the tmp file is pid-suffixed");
  assert.equal(path.dirname(seenTmp), dir, "the tmp is a same-directory sibling (so the rename is atomic)");
  assert.deepEqual(readdirSync(dir).filter((n) => n !== "run.json"), [], "the interrupted tmp is cleaned up, not left as a wedge");
});

test("[4.1-atomic] reads tolerate a UTF-8 BOM (primitive + loadRun)", () => {
  const dir = scratchDir("conductor-bom-");
  const f = path.join(dir, "x.json");
  writeFileSync(f, "\uFEFF" + JSON.stringify({ hello: "world", n: 7 }));
  assert.deepEqual(readJsonFileSync(f), { hello: "world", n: 7 }, "readJsonFileSync strips a leading BOM before parsing");

  // And through the store: a run.json that acquired a BOM still loads.
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");
  const store = openWorkspace(freshOpts(repo));
  const run = store.createRun({ prompt: "p", sessionID: "ses", classification });
  const rjPath = path.join(runDir(repo, run.runId), "run.json");
  writeFileSync(rjPath, "\uFEFF" + readFileSync(rjPath, "utf8"));
  assert.equal(store.loadRun(run.runId).runId, run.runId, "loadRun tolerates a UTF-8 BOM on run.json");
});

// ---------------------------------------------------------------------------
// 4.1-exclude
// ---------------------------------------------------------------------------

test("[4.1-exclude] .git/info/exclude registration is idempotent", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");

  assert.equal(registerConductorExclude(repo), true, "registration reports the entry is present");
  assert.equal(registerConductorExclude(repo), true, "a second registration is a no-op that still reports present");

  const exclude = readFileSync(path.join(repo, ".git", "info", "exclude"), "utf8");
  const hits = exclude.split(/\r?\n/).filter((l) => l.trim() === ".conductor/");
  assert.equal(hits.length, 1, "the `.conductor/` exclude entry appears EXACTLY once after two registrations");
});

test("[4.1-exclude] no-git mode skips the exclude write and does not crash (§3.9)", () => {
  const nonRepo = bareTempDir();

  assert.equal(registerConductorExclude(nonRepo), false, "registration is skipped (returns false) when the root is not a repo");
  assert.equal(existsSync(path.join(nonRepo, ".git")), false, "no .git dir is fabricated");

  // Opening a workspace on a non-repo must not crash and must not write an exclude.
  const store = openWorkspace(freshOpts(nonRepo));
  assert.ok(store !== null, "a non-repo root opens: the absence of git is not contention (§3.9)");
  assert.equal(existsSync(path.join(nonRepo, ".git")), false, "still no .git after open");

  // createRun still works without git: empty provenance, no throw (§3.9 drops the HEAD term).
  const run = store.createRun({ prompt: "p", sessionID: "ses", classification: { kind: "trivial", rationale: "r", check: { agreed: true, note: "" } } });
  assert.equal(run.startHead, "", "no-git: startHead coerces the absent sha to an empty string");
  assert.equal(run.startBranch, "", "no-git: startBranch is empty");
  assert.deepEqual(run.startDirty, [], "no-git: startDirty is empty (no git to query)");
});

// ---------------------------------------------------------------------------
// 4.1-beacon
// ---------------------------------------------------------------------------

test("[4.1-beacon] the liveness beacon is written at init (§3.8)", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");
  const store = openWorkspace(freshOpts(repo, { version: "1.2.3", sessionID: "ses_beacon" }));

  const alivePath = path.join(stateDir(repo), "alive.json");
  assert.ok(existsSync(alivePath), "the beacon alive.json is written at init");
  const beacon = readJsonFileSync(alivePath) as { pid: number; startMs: number; version: string; sessionID: string };
  assert.equal(beacon.pid, process.pid, "the beacon carries this instance's pid");
  assert.equal(beacon.startMs, START_MS, "the beacon startMs is stamped from the injected clock");
  assert.equal(beacon.version, "1.2.3", "the beacon carries the plugin version");
  assert.equal(beacon.sessionID, "ses_beacon", "the beacon carries the session id");

  const rb = store.readBeacon();
  assert.equal(rb?.version, "1.2.3", "readBeacon reads it back");
  assert.equal(rb?.sessionID, "ses_beacon");
});

test("[4.1-beacon] isHalted reflects the presence of the halt file", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");
  const store = openWorkspace(freshOpts(repo));
  assert.equal(store.isHalted(), false, "no halt file => not halted");
  writeFileSync(path.join(stateDir(repo), "halt"), "");
  assert.equal(store.isHalted(), true, "the presence of the halt file means halted (§1.2)");
});

// ---------------------------------------------------------------------------
// 4.1-lock
// ---------------------------------------------------------------------------

test("[4.1-lock] a fresh workspace claims the single-writer lock", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");
  const { sink, calls } = makeJournal();
  const store = openWorkspace(freshOpts(repo, { pid: 4242, journal: sink }));

  const lock = readLock(repo);
  assert.equal(lock.pid, 4242, "the lock carries this instance's pid");
  assert.equal(lock.startMs, START_MS, "the lock startMs is stamped from the injected clock");
  assert.ok(calls.some((c) => c.component === "state" && c.event === "lock.acquired"), "claiming the lock journals lock.acquired");

  store.release();
  assert.ok(calls.some((c) => c.component === "state" && c.event === "lock.released"), "release journals lock.released");
});

test("[4.1-lock] a LIVE foreign lock REFUSES the second session (owner decision D6) + a loud journal warning, and is left intact", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");
  // A lock owned by a DIFFERENT, still-alive process (this test process's own pid).
  preWriteLock(repo, { pid: process.pid, startMs: START_MS - 1000 });

  const { sink, calls } = makeJournal();
  assert.throws(
    () => openWorkspace(freshOpts(repo, { pid: process.pid + 1, journal: sink })),
    /held by another live conductor/,
    "a live foreign lock refuses the second session: it gets no store to write through at all (§4.1)",
  );

  assert.ok(calls.some((c) => c.level === "warn" && c.component === "state"), "a live foreign lock emits a LOUD (warn-level) journal record");
  assert.equal(readLock(repo).pid, process.pid, "the live foreign lock is left intact — never stolen");
});

test("[4.1-lock] a STALE lock (dead pid) is broken and the lock is claimed", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");
  // A reaped child pid is guaranteed dead (process.kill(pid,0) => ESRCH).
  const reaped = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  const deadPid = reaped.pid;
  assert.equal(typeof deadPid, "number", "spawn-and-reap yields a concrete, now-dead pid");
  // Fresh startMs so ONLY the dead pid (not over-age) can trigger the break.
  preWriteLock(repo, { pid: deadPid, startMs: START_MS });

  const { sink, calls } = makeJournal();
  const store = openWorkspace(freshOpts(repo, { pid: 5555, journal: sink }));

  assert.ok(store !== null, "a dead-pid lock is stale: broken, single-writer claimed (a crash never wedges a workspace)");
  assert.ok(calls.some((c) => c.component === "state" && c.event === "lock.stale-break"), "breaking a stale lock is recorded as lock.stale-break (the anomaly trace)");
  assert.equal(readLock(repo).pid, 5555, "the workspace single-writer lock is now claimed by this instance");
});

test("[4.1-lock] a STALE lock (over-age) is broken even though its pid is alive", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");
  // Owner pid is alive (this process), but the lock is far older than the threshold.
  preWriteLock(repo, { pid: process.pid, startMs: START_MS - 10 * 60_000 });

  const { sink, calls } = makeJournal();
  const store = openWorkspace(freshOpts(repo, { pid: process.pid + 7, journal: sink, staleLockMs: 60_000 }));

  assert.ok(store !== null, "an over-age lock is stale even with a live pid: broken and claimed");
  assert.ok(calls.some((c) => c.component === "state" && c.event === "lock.stale-break"), "the over-age break is recorded as lock.stale-break");
  assert.equal(readLock(repo).pid, process.pid + 7, "single-writer claimed after breaking the over-age lock");
});

// ---------------------------------------------------------------------------
// F2 (MAJOR-latent): ids flow from model-driven decomposition, so the store is the
// trust boundary. Every path builder that composes a runId/itemId into a .conductor/
// path must reject an id containing "/", "\", or a ".." segment — otherwise path.join
// collapses the ".." and the write/read escapes .conductor/. A poisoned current-run.json
// pointer must be refused rather than read outside the sandbox.
// ---------------------------------------------------------------------------

test("[4.1-path-safety] F2: id path builders reject traversal ids so no read or write escapes .conductor/", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");
  const store = openWorkspace(freshOpts(repo));
  const run = store.createRun({ prompt: "p", sessionID: "ses", classification });

  // The exact filesystem location the traversal itemId "../../../../tmp/pwned" resolves
  // to from <runId>/items/ — it must never be created.
  const escapeTarget = path.join(repo, "tmp", "pwned.json");
  assert.equal(existsSync(escapeTarget), false, "precondition: the escape target does not exist");

  // saveItem with a traversal itemId throws and writes nothing outside the run's items/ dir.
  assert.throws(
    () => store.saveItem(run.runId, makeItem("../../../../tmp/pwned")),
    /unsafe|refus|escape|separator|slug|dot/i,
    "saveItem rejects an itemId that would escape the run's items/ dir",
  );
  assert.equal(existsSync(escapeTarget), false, "the rejected saveItem wrote nothing outside .conductor/");

  // loadRun with a traversal runId throws with a SAFETY error (not a bare ENOENT).
  assert.throws(
    () => store.loadRun("../../etc/foo"),
    /unsafe|refus|escape|separator|slug|dot/i,
    "loadRun rejects a runId containing path separators",
  );

  // A poisoned current-run.json pointer must NOT let currentRun read outside .conductor/.
  writeFileSync(path.join(stateDir(repo), "current-run.json"), JSON.stringify({ runId: "../../.." }));
  assert.throws(
    () => store.currentRun(),
    /unsafe|refus|escape|separator|slug|dot/i,
    "currentRun refuses a poisoned pointer rather than reading outside .conductor/",
  );

  // Regression: real ids still round-trip.
  store.saveItem(run.runId, makeItem("I1"));
  assert.equal(store.loadItem(run.runId, "I1").id, "I1", "a normal itemId (I1) still round-trips");
  assert.equal(store.loadRun(run.runId).runId, run.runId, "a normal runId (r-<hex>) still loads");
});

// ---------------------------------------------------------------------------
// F5 (minor): createRun must write run.json BEFORE creating the items/ dir. A crash
// after mkdir(items) but before run.json would leave an orphan run dir with NO run.json
// — and pruneRuns skips any dir without a readable run.json, so it would never be
// reclaimed. Writing run.json first means any dir a crash leaves behind is prunable.
// ---------------------------------------------------------------------------

test("[4.1-lifecycle] F5: createRun writes run.json BEFORE items/, so a crash between them leaves a prunable dir, not an unreclaimable orphan", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");
  const store = openWorkspace(freshOpts(repo));

  // Simulate a crash AFTER run.json is written and BEFORE items/ is created.
  assert.throws(
    () =>
      store.createRun(
        { prompt: "p", sessionID: "ses", classification },
        {
          onAfterRunJson: () => {
            throw new Error("boom: crash after run.json, before items/");
          },
        },
      ),
    /boom/,
    "the injected crash between the two writes propagates",
  );

  // The half-created run dir HAS run.json (so pruneRuns can order and reclaim it) and
  // does NOT yet have items/ — proving run.json is written first.
  const runsDir = path.join(repo, ".conductor", "runs");
  const dirs = readdirSync(runsDir);
  assert.equal(dirs.length, 1, "the interrupted createRun left exactly one run dir");
  const orphan = dirs[0];
  assert.ok(
    existsSync(path.join(runsDir, orphan, "run.json")),
    "run.json exists in the crashed dir — it is written BEFORE items/, so the dir is prunable",
  );
  assert.equal(
    existsSync(path.join(runsDir, orphan, "items")),
    false,
    "items/ was NOT created before the crash — proving the run.json-then-items order",
  );
});

// ---------------------------------------------------------------------------
// F4 (minor): fresh-claim TOCTOU. Two cold starts that both see no lock and both write
// are both writers. The claim is an exclusive create, so a lock that appeared between
// the decision and the write is detected as contention. The seam plants a LIVE foreign
// lock in exactly that window; the loser must be REFUSED and leave the racer's lock intact.
// ---------------------------------------------------------------------------

test("[4.1-lock] F4: a fresh claim that loses a TOCTOU race to a live foreign writer is detected as contention, not a double-writer", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");
  const { sink, calls } = makeJournal();
  const foreignPid = process.pid; // alive: this test process

  // At open, NO lock exists. The injected seam fires BEFORE the exclusive-create
  // write, planting a live foreign lock — the cold-start race two writers would hit.
  // Exclusive create must then EEXIST, re-read, and see the live foreign writer.
  assert.throws(
    () =>
      openWorkspace(
        freshOpts(repo, {
          pid: process.pid + 1,
          journal: sink,
          onBeforeFreshLockWrite: () => {
            preWriteLock(repo, { pid: foreignPid, startMs: START_MS });
          },
        }),
      ),
    /held by another live conductor/,
    "losing the fresh-claim race to a live writer is a refusal (no double-writer)",
  );

  assert.equal(readLock(repo).pid, foreignPid, "the racer's live lock is left intact — not overwritten by the loser");
  assert.ok(
    calls.some((c) => c.level === "warn" && c.component === "state" && c.event === "lock.contended"),
    "the lost race is journaled as contention",
  );
});
