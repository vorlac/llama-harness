// Task 5.4 red tests — lives at conductor/tests/chat-message.test.ts.
//
// Subject (must NOT exist when this goes red; the failure is
// `Cannot find module '../adapter/chat-message.ts'` — the missing-subject shape, a
// legal red because the unresolved path resolves inside THIS task's fileScope):
//   - conductor/adapter/chat-message.ts   (the `chat.message` hook BODY, factored as a
//                                           testable adapter function — NOT the opencode
//                                           plugin wiring, which is Task 5.3's plugin/index.ts)
//
// This task (5.4) was SPECIFIED by the plan but never assigned a task id; the build adds
// it (orchestrator prompt §3.3). The hook is the glue between an arriving user prompt and
// a conductor run: on a prompt with no live run it CREATES the run (state INTAKE), and on
// a prompt during a live run it ROUTES the prompt into that run as orchestrator context.
//
// ADAPTER module (G14): the subject is a THIN composition over subjects that already
// exist — adapter/state.ts (openWorkspace -> StateStore.createRun / currentRun /
// readStaleRed; the run lifecycle, which itself captures startHead/startBranch/startDirty
// via adapter/gitio.ts) and core/stops.ts (isTerminal, §2.3's single terminality
// definition). It does node:fs I/O only THROUGH the store; no Bun API, no shell tag, no
// port 8080. Every fixture here is a throwaway dir under os.tmpdir(), git-init'd with a
// hermetic env for the git-backed cases, and torn down in after(). This test never runs
// git against the llama-harness repo.
//
// Spec read for this test (docs/plans/2026-08-07-conductor-harness-plan.md):
//   1064-1075 §3.2 INTAKE: the chat.message hook, on a prompt arriving while no run is
//             live (isTerminal(currentRun) or none), creates runs/<runId>/run.json (state
//             INTAKE), points current-run.json at it, and captures startHead/startBranch/
//             startDirty + excludedStaleRed in one place — AND reports the stale-red
//             exclusions to the user in its first response. A prompt arriving DURING a live
//             run is routed as orchestrator context (journaled `user.midrun-prompt`) and
//             NEVER starts a new run.
//   1344-1347 §3.5: the session-registry entry `sessionID -> {role, itemId, tree}` for the
//             ORCHESTRATOR session is written by the chat.message hook (fan-out writes the
//             sub-session entries; chat.message writes the orchestrator's).
//   705-711   §2.3 isTerminal (one definition): terminal iff stop !== null OR state ∈
//             {ANSWERED, REPORTED, TRIVIAL_DONE}.
//   1002-1008 §2.11 workspace stale-red registry (the entries carried into excludedStaleRed).
//   1496-1509 §3.9 no-git mode: run creation still works; git provenance is simply skipped,
//             so startHead/startBranch coerce to "" (state.ts's no-git path).
//   docs/build/specs/task-5.4.assertions.json — the 6 rows mapped below.
//
// ---------------------------------------------------------------------------
// PINNED EXPORT SURFACE the implementer must target (chat-message.ts). Everything a
// test reads is here so the implementer can hit it EXACTLY. The open mechanisms (the
// registry interface shape, the flat result shape, the placeholder classification the
// hook synthesizes at INTAKE) are recorded in the return that ships this file.
//
//   // The §3.5 session-registry the gate also consults. chat.message writes the
//   // orchestrator's entry; the fan-out engine (elsewhere) writes sub-session entries.
//   interface SessionRegistryEntry { role: string; itemId?: string; tree?: TreePath }
//   interface SessionRegistry {
//     register(sessionID: string, entry: SessionRegistryEntry): void;
//     get(sessionID: string): SessionRegistryEntry | undefined;
//   }
//
//   // The journal sink the hook writes `user.midrun-prompt` through. Structurally the
//   // adapter/state.ts StateJournal (log-only; runId optional because a hook precedes
//   // its run). NOTE for the implementer: `user.midrun-prompt` is not yet in the closed
//   // §7.4 vocabulary (core/journal-events.ts) — under the REAL createJournal it must be
//   // added there, or this hook journals through a sink that tolerates it. This test
//   // injects a capture sink, so it asserts only the event NAME + correlation.
//   interface ChatMessageJournal {
//     log(level: string, component: string, event: string,
//         data: Record<string, unknown>,
//         corr: { runId?: string; itemId?: string; sessionID?: string }): void;
//   }
//
//   interface HandleChatMessageInput {
//     store: StateStore;          // the openWorkspace() result
//     registry: SessionRegistry;  // the §3.5 session registry (orchestrator entry written here)
//     sessionID: string;          // the arriving (orchestrator) session
//     prompt: string;             // the user's prompt text
//     journal: ChatMessageJournal;
//     now?: () => number;         // optional injected clock for any ts the hook itself stamps
//   }
//
//   // A FLAT result (not a discriminated union) so callers need no narrowing:
//   //  - action "created":      a fresh run was minted; runId is that new run; staleReport
//   //                           is the user-facing exclusion notice (null when none in force).
//   //  - action "routed-midrun": no run created; runId is the LIVE run the prompt was
//   //                           routed into; staleReport is null.
//   interface ChatMessageResult {
//     action: "created" | "routed-midrun";
//     runId: string;
//     staleReport: string | null;
//   }
//
//   handleChatMessage(input: HandleChatMessageInput): ChatMessageResult
//     // No live run (store.currentRun() === null OR isTerminal(currentRun)) =>
//     //   store.createRun(...) (which captures startHead/startBranch/startDirty +
//     //   excludedStaleRed and points current-run at it), register the orchestrator session
//     //   (sessionID -> {role:"orchestrator"}), build staleReport from the run's
//     //   excludedStaleRed, return {action:"created", runId, staleReport}.
//     // A live (non-terminal) run => do NOT create; journal `user.midrun-prompt` on the live
//     //   run; return {action:"routed-midrun", runId: liveRunId, staleReport: null}.
//     // The classification is unknown at INTAKE (conductor_classify runs LATER), so the hook
//     //   synthesizes a schema-valid PLACEHOLDER classification for createRun; its content is
//     //   the implementer's choice and this test does not pin it.
// ---------------------------------------------------------------------------
//
// Assertion id -> test name (docs/build/specs/task-5.4.assertions.json):
//   5.4-create      -> "[5.4-create] a prompt with no live run creates runs/<runId>/run.json
//                       (state INTAKE), captures startHead/startBranch/startDirty, and points
//                       current-run at it"
//                    + "[5.4-create] after the live run becomes terminal (a stop is recorded),
//                       a new prompt starts a FRESH run"
//   5.4-start-facts -> "[5.4-start-facts] run creation carries the active §2.11 stale-red
//                       entries into run.excludedStaleRed"
//   5.4-stale-report-> "[5.4-stale-report] the hook's first response reports the stale-red
//                       exclusions by count; a run with none in force reports nothing"
//   5.4-midrun      -> "[5.4-midrun] a prompt during a live (non-terminal) run routes as
//                       orchestrator context (journaled user.midrun-prompt) and starts no new run"
//   5.4-registry    -> "[5.4-registry] the orchestrator session is registered (role
//                       'orchestrator'); a follow-on prompt keeps it registered (idempotent)"
//   5.4-nogit       -> "[5.4-nogit] run creation in a no-git workspace coerces startHead/
//                       startBranch to '' and does not crash (§3.9)"

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, devNull } from "node:os";
import * as path from "node:path";

// The store the hook composes over — this DOES exist (Task 4.1).
import { openWorkspace } from "../adapter/state.ts";
import type { OpenOptions } from "../adapter/state.ts";
import type { Config, TreePath } from "../core/types.ts";

// The subject under test — absent at red time (the missing-subject red names THIS path).
import { handleChatMessage } from "../adapter/chat-message.ts";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

// A fixed injected clock: the store reads OpenOptions.now for every stamped value, so
// every timestamp below is deterministic.
const START_MS = 1_754_560_000_000;
const HEX40 = /^[0-9a-f]{40}$/;

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Hermetic git for BUILDING fixtures — no global/system config can leak in, and every
// invocation is scoped to the fixture dir (never the surrounding repo).
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

function write(dir: string, name: string, content: string): void {
  writeFileSync(path.join(dir, name), content);
}

function commit(dir: string, name: string, content: string, message: string): void {
  write(dir, name, content);
  git(dir, ["add", name]);
  git(dir, ["commit", "-m", message]);
}

// A git-backed fixture with a seed commit; the caller adds any pre-existing dirt.
function initRepo(): string {
  const dir = scratchDir("conductor-chatmsg-");
  git(dir, ["init", "-b", "main"]);
  return dir;
}

// A plain (no-git) workspace for the §3.9 case.
function bareDir(): string {
  return scratchDir("conductor-chatmsg-nogit-");
}

// ---- the injected §3.5 session registry (in-memory, backed by a Map) --------
interface RegistryEntry {
  role: string;
  itemId?: string;
  // The §3.5 tree PATH (core/types.ts TreePath) — never the evidence layer's slug.
  tree?: TreePath;
}
interface TestRegistry {
  register(sessionID: string, entry: RegistryEntry): void;
  get(sessionID: string): RegistryEntry | undefined;
}
function makeRegistry(): TestRegistry {
  const m = new Map<string, RegistryEntry>();
  return {
    register(sessionID, entry) {
      m.set(sessionID, entry);
    },
    get(sessionID) {
      return m.get(sessionID);
    },
  };
}

// ---- the injected capture journal ------------------------------------------
interface LogCall {
  level: string;
  component: string;
  event: string;
  data: Record<string, unknown>;
  corr: { runId?: string; itemId?: string; sessionID?: string };
}
interface TestJournal {
  log(
    level: string,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: { runId?: string; itemId?: string; sessionID?: string },
  ): void;
}
function makeJournal(): { sink: TestJournal; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const sink: TestJournal = {
    log(level, component, event, data, corr) {
      calls.push({ level, component, event, data, corr });
    },
  };
  return { sink, calls };
}

// A complete §2.1 Config; the store needs one, but nothing this test asserts depends on
// its values. keepRuns is generous so a second run never prunes the first.
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
    retention: { keepRuns: 10, maxRunDirBytes: 100_000_000, pruneOnRunCreate: true },
    logging: { level: "info", components: {} },
  };
  return { ...base, ...overrides };
}

function openStore(root: string, journal: TestJournal, sessionID: string) {
  const opts: OpenOptions = {
    root,
    config: makeConfig(),
    journal,
    version: "0.0.0-test",
    sessionID,
    now: () => START_MS,
    pid: process.pid,
    staleLockMs: 24 * 60 * 60 * 1000,
  };
  return openWorkspace(opts);
}

// Count run directories that carry a run.json (the durable, prune-visible runs).
function countRuns(root: string): number {
  const runsDir = path.join(root, ".conductor", "runs");
  if (!existsSync(runsDir)) return 0;
  return readdirSync(runsDir, { withFileTypes: true }).filter(
    (e) => e.isDirectory() && existsSync(path.join(runsDir, e.name, "run.json")),
  ).length;
}

// ---------------------------------------------------------------------------
// 5.4-create
// ---------------------------------------------------------------------------

test("[5.4-create] a prompt with no live run creates runs/<runId>/run.json (state INTAKE), captures startHead/startBranch/startDirty, and points current-run at it", () => {
  const repo = initRepo();
  commit(repo, "tracked.ts", "export const x = 1;\n", "seed");
  // Dirt that existed BEFORE conductor touched anything (§2.3 startDirty): a modified
  // tracked file plus a brand-new untracked file.
  write(repo, "tracked.ts", "export const x = 2;\n");
  write(repo, "wip.ts", "wip\n");

  const journal = makeJournal();
  const registry = makeRegistry();
  const store = openStore(repo, journal.sink, "ses_orchestrator");

  assert.equal(store.currentRun(), null, "precondition: no run is live");

  const res = handleChatMessage({
    store,
    registry,
    sessionID: "ses_orchestrator",
    prompt: "add a feature",
    journal: journal.sink,
  });

  assert.equal(res.action, "created", "a prompt with no live run creates a run");
  assert.equal(typeof res.runId, "string", "the created runId is returned");

  // The run is persisted at INTAKE with the starting facts captured.
  const run = store.loadRun(res.runId);
  assert.equal(run.state, "INTAKE", "a new run starts at the head of the §3.1 run FSM");
  assert.equal(run.prompt, "add a feature", "the run records the arriving prompt");
  assert.match(run.startHead, HEX40, "startHead is the full 40-hex HEAD sha");
  assert.equal(
    run.startHead,
    git(repo, ["rev-parse", "HEAD"]).trim(),
    "startHead equals the fixture repo's real HEAD",
  );
  assert.equal(run.startBranch, "main", "startBranch is the fixture's branch");
  assert.ok(
    run.startDirty.includes("tracked.ts"),
    "startDirty captures the pre-existing tracked-modified file (H4)",
  );
  assert.equal(run.stop, null, "a fresh run has no stop recorded");

  // current-run points at the new run.
  assert.equal(store.currentRun()?.runId, res.runId, "the new run becomes current");
  assert.equal(countRuns(repo), 1, "exactly one run dir exists after the first prompt");
});

test("[5.4-create] after the live run becomes terminal (a stop is recorded), a new prompt starts a FRESH run", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");

  const journal = makeJournal();
  const registry = makeRegistry();
  const store = openStore(repo, journal.sink, "ses_orchestrator");

  const first = handleChatMessage({
    store,
    registry,
    sessionID: "ses_orchestrator",
    prompt: "first task",
    journal: journal.sink,
  });
  assert.equal(first.action, "created", "the first prompt creates run A");

  // Drive run A terminal via the §2.3 `stop !== null` branch of isTerminal (state left at
  // INTAKE, so it is the stop — not a terminal state name — that ends the run).
  const runA = store.loadRun(first.runId);
  runA.stop = { kind: "done", reasonDisplay: "report filed", tsMs: START_MS };
  store.saveRun(runA);
  assert.notEqual(store.currentRun()?.stop, null, "run A is now terminal (a stop is recorded)");

  const second = handleChatMessage({
    store,
    registry,
    sessionID: "ses_orchestrator",
    prompt: "second task",
    journal: journal.sink,
  });

  assert.equal(second.action, "created", "a prompt after a terminal run starts a fresh run");
  assert.notEqual(second.runId, first.runId, "run B is a distinct run from run A");
  assert.equal(store.currentRun()?.runId, second.runId, "current-run now points at run B");
  assert.equal(store.loadRun(second.runId).state, "INTAKE", "run B starts at INTAKE");
  assert.equal(countRuns(repo), 2, "both run dirs exist on disk (A archived-by-stop, B live)");
});

// ---------------------------------------------------------------------------
// 5.4-start-facts
// ---------------------------------------------------------------------------

test("[5.4-start-facts] run creation carries the active §2.11 stale-red entries into run.excludedStaleRed", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");

  const journal = makeJournal();
  const registry = makeRegistry();
  const store = openStore(repo, journal.sink, "ses_orchestrator");

  // Two stale-red files from earlier runs are in force at creation time (§2.11).
  store.addStaleRed({ path: "tests/i2.test.ts", itemId: "I2", runId: "r-old", sinceMs: START_MS, reason: "blocked at RED" });
  store.addStaleRed({ path: "tests/i5.test.ts", itemId: "I5", runId: "r-old", sinceMs: START_MS, reason: "blocked at RED" });

  const res = handleChatMessage({
    store,
    registry,
    sessionID: "ses_orchestrator",
    prompt: "do work",
    journal: journal.sink,
  });
  assert.equal(res.action, "created");

  const run = store.loadRun(res.runId);
  assert.deepEqual(
    [...run.excludedStaleRed].sort(),
    ["tests/i2.test.ts", "tests/i5.test.ts"],
    "the active stale-red entries are captured into run.excludedStaleRed at creation",
  );
});

// ---------------------------------------------------------------------------
// 5.4-stale-report
// ---------------------------------------------------------------------------

test("[5.4-stale-report] the hook's first response reports the stale-red exclusions by count; a run with none in force reports nothing", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");

  // --- with three stale-red files in force: the first response names the count ---
  const journalA = makeJournal();
  const storeA = openStore(repo, journalA.sink, "ses_orchestrator");
  storeA.addStaleRed({ path: "tests/a.test.ts", itemId: "I1", runId: "r-old", sinceMs: START_MS, reason: "red" });
  storeA.addStaleRed({ path: "tests/b.test.ts", itemId: "I2", runId: "r-old", sinceMs: START_MS, reason: "red" });
  storeA.addStaleRed({ path: "tests/c.test.ts", itemId: "I3", runId: "r-old", sinceMs: START_MS, reason: "red" });

  const withStale = handleChatMessage({
    store: storeA,
    registry: makeRegistry(),
    sessionID: "ses_orchestrator",
    prompt: "do work",
    journal: journalA.sink,
  });
  assert.equal(withStale.action, "created");
  assert.notEqual(withStale.staleReport, null, "a run with stale-red exclusions reports them");
  const report = withStale.staleReport ?? "";
  assert.ok(report.includes("3"), "the report names the count of excluded files (3)");
  assert.match(report, /still red/i, "the report explains the files are still red (plan §3.2 phrasing)");
  assert.match(report, /excluded from verification/i, "the report says they are excluded from verification");

  // --- with NO stale-red files: a fresh workspace reports nothing (staleReport null) ---
  const repoB = initRepo();
  commit(repoB, "f.ts", "x\n", "seed");
  const journalB = makeJournal();
  const storeB = openStore(repoB, journalB.sink, "ses_orchestrator");
  const noStale = handleChatMessage({
    store: storeB,
    registry: makeRegistry(),
    sessionID: "ses_orchestrator",
    prompt: "do work",
    journal: journalB.sink,
  });
  assert.equal(noStale.action, "created");
  assert.equal(noStale.staleReport, null, "with no stale-red exclusions in force, the response reports nothing");
});

// ---------------------------------------------------------------------------
// 5.4-midrun
// ---------------------------------------------------------------------------

test("[5.4-midrun] a prompt during a live (non-terminal) run routes as orchestrator context (journaled user.midrun-prompt) and starts no new run", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");

  const journal = makeJournal();
  const registry = makeRegistry();
  const store = openStore(repo, journal.sink, "ses_orchestrator");

  const first = handleChatMessage({
    store,
    registry,
    sessionID: "ses_orchestrator",
    prompt: "the task",
    journal: journal.sink,
  });
  assert.equal(first.action, "created", "the first prompt creates the live run");

  const liveBefore = store.currentRun();
  assert.equal(liveBefore?.runId, first.runId);
  assert.equal(liveBefore?.stop, null, "the live run is non-terminal when the second prompt arrives");

  const MIDRUN_PROMPT = "MIDRUN-CONTEXT-9f3a: also handle the edge case";
  const second = handleChatMessage({
    store,
    registry,
    sessionID: "ses_orchestrator",
    prompt: MIDRUN_PROMPT,
    journal: journal.sink,
  });

  // Routed into the live run — NOT a new run.
  assert.equal(second.action, "routed-midrun", "a prompt during a live run is routed, not run-creating");
  assert.equal(second.runId, first.runId, "the routed result names the live run it was folded into");

  // The live run is untouched: same id, same createdIso, and no second run dir.
  const liveAfter = store.currentRun();
  assert.equal(liveAfter?.runId, first.runId, "current-run still points at the same live run");
  assert.equal(liveAfter?.createdIso, liveBefore?.createdIso, "the live run.json was not re-created");
  assert.equal(countRuns(repo), 1, "no new run dir is created by a mid-run prompt");

  // The mid-run prompt is journaled as `user.midrun-prompt`, correlated to the live run,
  // with the prompt text preserved (the orchestrator context must not be lost).
  const midrun = journal.calls.find((c) => c.event === "user.midrun-prompt");
  assert.ok(midrun !== undefined, "a mid-run prompt is journaled under event user.midrun-prompt");
  assert.equal(midrun?.corr.runId, first.runId, "the journal record is correlated to the live run");
  assert.ok(
    JSON.stringify(midrun?.data).includes(MIDRUN_PROMPT),
    "the routed prompt text is preserved in the journal record's data",
  );
});

// ---------------------------------------------------------------------------
// 5.4-registry
// ---------------------------------------------------------------------------

test("[5.4-registry] the orchestrator session is registered (role 'orchestrator'); a follow-on prompt keeps it registered (idempotent)", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");

  const journal = makeJournal();
  const registry = makeRegistry();
  const store = openStore(repo, journal.sink, "ses_orchestrator");

  assert.equal(registry.get("ses_orchestrator"), undefined, "precondition: the session is unregistered");

  const first = handleChatMessage({
    store,
    registry,
    sessionID: "ses_orchestrator",
    prompt: "start",
    journal: journal.sink,
  });
  assert.equal(first.action, "created");

  const entry = registry.get("ses_orchestrator");
  assert.ok(entry !== undefined, "the orchestrator session is registered by the hook (§3.5)");
  assert.equal(entry?.role, "orchestrator", "its registry role is 'orchestrator'");

  // A follow-on prompt on the SAME (now live) session must leave the registration intact —
  // registering the orchestrator is idempotent (§3.5: chat.message owns the orchestrator entry).
  const second = handleChatMessage({
    store,
    registry,
    sessionID: "ses_orchestrator",
    prompt: "more context",
    journal: journal.sink,
  });
  assert.equal(second.action, "routed-midrun", "the follow-on prompt is a mid-run route");
  assert.equal(
    registry.get("ses_orchestrator")?.role,
    "orchestrator",
    "the orchestrator session stays registered after the follow-on prompt",
  );
});

// ---------------------------------------------------------------------------
// 5.4-nogit
// ---------------------------------------------------------------------------

test("[5.4-nogit] run creation in a no-git workspace coerces startHead/startBranch to '' and does not crash (§3.9)", () => {
  const root = bareDir(); // a plain directory — NOT a git repo

  const journal = makeJournal();
  const registry = makeRegistry();
  const store = openStore(root, journal.sink, "ses_orchestrator");

  const res = handleChatMessage({
    store,
    registry,
    sessionID: "ses_orchestrator",
    prompt: "work in a non-repo",
    journal: journal.sink,
  });

  assert.equal(res.action, "created", "run creation still works with no git present");
  const run = store.loadRun(res.runId);
  assert.equal(run.state, "INTAKE", "the no-git run starts at INTAKE");
  assert.equal(run.startHead, "", "no-git mode coerces startHead to the empty string (state.ts §3.9 path)");
  assert.equal(run.startBranch, "", "no-git mode coerces startBranch to the empty string");
  assert.deepEqual(run.startDirty, [], "no-git mode records no pre-existing dirt");
  assert.equal(store.currentRun()?.runId, res.runId, "current-run points at the no-git run");
  assert.equal(
    registry.get("ses_orchestrator")?.role,
    "orchestrator",
    "the orchestrator session is registered even in no-git mode",
  );
});

// ---------------------------------------------------------------------------
// smoke-F09 — the fan-out's registry entry survives the sub-session's own prompt
//
// opencode fires `chat.message` for EVERY session, including the ones the fan-out
// engine creates. The hook registering `{role:"orchestrator"}` unconditionally
// therefore overwrote the entry adapter/fanout.ts writes before its first prompt,
// and with it the itemId and tree. Measured downstream in the 13.2 live smoke
// (run r-20260821-b8de): a planner sub-session received the orchestrator's
// doctrine pack (core.md, not decompose.md+plan.md), carried
// `X-Conductor-Priority: interactive`, passed continuation.ts's orchestrator-only
// idle guard, and was re-prompted with "call conductor_decompose now" until the
// futility limit stopped the run.
// ---------------------------------------------------------------------------

test("[smoke-F09] a prompt arriving in a fan-out sub-session leaves its registry entry alone, journals no user.midrun-prompt and creates no run", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");

  const journal = makeJournal();
  const registry = makeRegistry();
  const store = openStore(repo, journal.sink, "ses_orchestrator");

  const created = handleChatMessage({
    store,
    registry,
    sessionID: "ses_orchestrator",
    prompt: "the task",
    journal: journal.sink,
  });
  assert.equal(created.action, "created");

  // What adapter/fanout.ts writes BEFORE it prompts the sub-session (§3.5).
  const SUB = "ses_planner";
  registry.register(SUB, { role: "planner", itemId: "I1", tree: "/w/tree-a" as TreePath });

  const BRIEF = "Decompose the following work request into a queue of independently implementable items.";
  const res = handleChatMessage({
    store,
    registry,
    sessionID: SUB,
    prompt: BRIEF,
    journal: journal.sink,
  });

  assert.equal(res.action, "subsession", "a registered sub-session's prompt is neither a run nor mid-run context");

  const entry = registry.get(SUB);
  assert.equal(entry?.role, "planner", "the fan-out's role survives the sub-session's own prompt");
  assert.equal(entry?.itemId, "I1", "the fan-out's itemId survives it");
  assert.equal(entry?.tree, "/w/tree-a", "the fan-out's tree binding survives it");

  const mislabelled = journal.calls.filter(
    (c) => c.event === "user.midrun-prompt" && c.corr.sessionID === SUB,
  );
  assert.deepEqual(mislabelled, [], "a fan-out brief is not operator context and is not journaled as one");

  assert.equal(countRuns(repo), 1, "the sub-session's prompt creates no run");
  assert.equal(store.currentRun()?.runId, created.runId, "current-run still points at the orchestrator's run");
});

test("[smoke-F09] the orchestrator's own entry is still (re-)asserted, and an unregistered session still routes mid-run", () => {
  const repo = initRepo();
  commit(repo, "f.ts", "x\n", "seed");

  const journal = makeJournal();
  const registry = makeRegistry();
  const store = openStore(repo, journal.sink, "ses_orchestrator");

  handleChatMessage({ store, registry, sessionID: "ses_orchestrator", prompt: "start", journal: journal.sink });
  assert.equal(registry.get("ses_orchestrator")?.role, "orchestrator");

  // A session the fan-out never registered is not a sub-session: it routes as before.
  const other = handleChatMessage({
    store,
    registry,
    sessionID: "ses_other",
    prompt: "more context",
    journal: journal.sink,
  });
  assert.equal(other.action, "routed-midrun", "an unregistered session's mid-run prompt still routes");
  assert.equal(registry.get("ses_other")?.role, "orchestrator", "and it is registered as the orchestrator");
});
