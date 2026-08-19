// Task 2.2 — the dual-runtime smoke (G14): conductor/tests/bun-smoke.test.ts.
//
// The plugin runs under opencode's Bun runtime; every OTHER test in this plan runs
// under Node. For the pure core that gap is harmless (G3 forbids I/O there). For the
// ADAPTERS it is not: atomic tmp+rename, appendFileSync under repeated appends,
// process.kill(pid,0) liveness probing, and execFile with shell:false are all
// runtime-observable. This file re-asserts the already-built state-store + journal +
// gitio behaviour so a runtime divergence is caught HERE — at three adapters — rather
// than at Phase 13 under thirty modules (plan 2179-2202).
//
// It is a PROOF, not a red: the subjects EXIST (adapter/state.ts, adapter/journal.ts,
// adapter/gitio.ts). Written with node:test + node:assert/strict ONLY — the common
// subset confirmed to run under BOTH `node --test` and `bun test` — so it uses no
// bun:test-only and no Node-only assertion surface. It drives the adapters through
// throwaway temp dirs under os.tmpdir() (mkdtempSync), cleaned up in after(); it never
// runs git against the llama-harness repo and never touches port 8080.
//
// The four runtime-observable behaviours asserted (plan 2189-2192):
//   1. atomic write survives an injected mid-commit throw (old file intact, no leftover tmp);
//   2. single-writer lock claim + stale-break (dead-pid AND over-age) + the live-foreign
//      read-only path — the process.kill(pid,0) liveness probe, both branches;
//   3. JSONL journal append ordering (seq monotonic) AND the torn-trailing-line heal;
//   4. one execFile round-trip through gitio (isRepo + headSha on a fixture repo, plus the
//      non-zero-exit mapping on a non-repo) — proving node:child_process works under bun.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, devNull } from "node:os";
import * as path from "node:path";

// The three adapter subjects under proof (they EXIST — this is not a red).
import {
  openWorkspace,
  writeFileAtomicSync,
  readJsonFileSync,
} from "../adapter/state.ts";
import type { OpenOptions, StateJournal, LockRecord } from "../adapter/state.ts";
import { createJournal } from "../adapter/journal.ts";
import { EVENTS } from "../core/journal-events.ts";
import { headSha, isRepo } from "../adapter/gitio.ts";
import type { Config, JournalRecord } from "../core/types.ts";

// ---------------------------------------------------------------------------
// Fixtures and helpers (ephemeral; never the repo tree, never port 8080)
// ---------------------------------------------------------------------------

// A fixed injected clock base so every stamped timestamp is deterministic under BOTH
// runtimes (the store reads OpenOptions.now for every timestamp it writes).
const START_MS = 1_754_560_000_000;
const HEX40 = /^[0-9a-f]{40}$/;

const tmpDirs: string[] = [];

after(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function scratchDir(tag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), tag));
  tmpDirs.push(dir);
  return dir;
}

// Hermetic git for BUILDING the fixture repo — no global/system config can leak in,
// and the fixed identity + dates make the fixture reproducible across runtimes.
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

// EVENTS indexed by an arbitrary string, independent of the exact key typing — the
// test sources a valid event name from the closed vocabulary itself, so a log() call
// never throws on an unknown-event by accident.
const eventsByComponent = EVENTS as unknown as Record<string, readonly string[]>;

function anyEvent(component: string): string {
  const list = eventsByComponent[component];
  assert.ok(Array.isArray(list) && list.length > 0, `EVENTS.${component} must be a non-empty list`);
  return list[0];
}

interface LogCall {
  level: string;
  component: string;
  event: string;
  data: Record<string, unknown>;
  corr: { runId?: string; itemId?: string; sessionID?: string };
}

// A capture journal so the lock/beacon behaviours (lock.acquired, lock.stale-break,
// lock.contended) are observable to the assertions.
function makeJournal(): { sink: StateJournal; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const sink: StateJournal = {
    log(level, component, event, data, corr) {
      calls.push({ level, component, event, data, corr });
    },
  };
  return { sink, calls };
}

// A complete §2.1 Config; only the fields the adapters read matter, but a full object
// keeps the types honest. maxRunDirBytes is large so the journal never rotates here.
function makeConfig(): Config {
  return {
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
    retention: { keepRuns: 5, maxRunDirBytes: 268435456, pruneOnRunCreate: true },
    logging: { level: "trace", components: {} },
  };
}

function freshOpts(root: string, overrides: Partial<OpenOptions> = {}): OpenOptions {
  const base: OpenOptions = {
    root,
    config: makeConfig(),
    journal: makeJournal().sink,
    version: "0.0.0-smoke",
    sessionID: "ses_smoke",
    now: () => START_MS,
    pid: process.pid,
    staleLockMs: 24 * 60 * 60 * 1000,
  };
  return { ...base, ...overrides };
}

// The normative on-disk lock location (§1.2), for tests that inspect/seed it directly.
function lockPath(root: string): string {
  return path.join(root, ".conductor", "state", "run.lock");
}

function preWriteLock(root: string, rec: LockRecord): void {
  mkdirSync(path.join(root, ".conductor", "state"), { recursive: true });
  writeFileSync(lockPath(root), JSON.stringify(rec));
}

function readLock(root: string): LockRecord {
  return JSON.parse(readFileSync(lockPath(root), "utf8")) as LockRecord;
}

const DEV_ENV: Record<string, string> = {}; // no NODE_ENV => dev/test (unknown events throw)
const CORR = { runId: "r-2.2" } as const;

function readRecords(runDir: string): JournalRecord[] {
  const file = path.join(runDir, "journal.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as JournalRecord);
}

// ===========================================================================
// (1) Atomic write survives an injected mid-commit throw
// ===========================================================================

test("[G14-atomic] an injected mid-commit throw leaves the old file byte-for-byte intact; the pid-suffixed same-dir tmp is cleaned up", () => {
  const dir = scratchDir("conductor-bun-atomic-");
  const target = path.join(dir, "run.json");

  writeFileAtomicSync(target, '{"v":1}');
  assert.equal(readFileSync(target, "utf8"), '{"v":1}', "the first write lands");
  assert.deepEqual(
    readdirSync(dir).filter((n) => n !== "run.json"),
    [],
    "a successful write leaves no tmp behind",
  );

  // Force a crash between the tmp write and the rename via the onBeforeRename hook.
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
    "the injected throw propagates to the caller",
  );

  assert.equal(
    readFileSync(target, "utf8"),
    '{"v":1}',
    "the OLD file is byte-for-byte intact after an interrupted tmp+rename",
  );
  assert.ok(
    seenTmp.length > 0 && seenTmp.includes(String(process.pid)),
    "the tmp file is a pid-suffixed sibling",
  );
  assert.equal(path.dirname(seenTmp), dir, "the tmp is a same-directory sibling (so the rename is atomic)");
  assert.deepEqual(
    readdirSync(dir).filter((n) => n !== "run.json"),
    [],
    "the interrupted tmp is cleaned up, not left as a wedge",
  );
});

// ===========================================================================
// (2) Single-writer lock: fresh claim + stale-break (dead-pid AND over-age) +
//     live-foreign read-only. Exercises the process.kill(pid,0) liveness probe in
//     both directions — the branch most likely to diverge across runtimes.
// ===========================================================================

test("[G14-lock] a fresh workspace claims the single-writer lock and stamps it from the injected clock", () => {
  const root = scratchDir("conductor-bun-lock-fresh-");
  const { sink, calls } = makeJournal();
  const store = openWorkspace(freshOpts(root, { pid: 4242, journal: sink }));

  const lock = readLock(root);
  assert.equal(lock.pid, 4242, "the lock carries this instance's pid");
  assert.equal(lock.startMs, START_MS, "the lock startMs is stamped from the injected clock");
  assert.ok(
    calls.some((c) => c.component === "state" && c.event === "lock.acquired"),
    "claiming the lock journals lock.acquired",
  );

  store.release();
  assert.ok(
    calls.some((c) => c.component === "state" && c.event === "lock.released"),
    "release journals lock.released",
  );
  assert.equal(existsSync(lockPath(root)), false, "release removes the writer's own lock file");
});

test("[G14-lock] a dead-pid lock is stale-broken and reclaimed (process.kill probe reports ESRCH under both runtimes)", () => {
  const root = scratchDir("conductor-bun-lock-dead-");
  // A spawned-and-reaped child pid is guaranteed dead: process.kill(pid,0) => ESRCH.
  const reaped = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  const deadPid = reaped.pid;
  assert.equal(typeof deadPid, "number", "spawn-and-reap yields a concrete, now-dead pid");
  // Fresh startMs so ONLY the dead pid (not over-age) can trigger the break.
  preWriteLock(root, { pid: deadPid as number, startMs: START_MS });

  const { sink, calls } = makeJournal();
  const store = openWorkspace(freshOpts(root, { pid: 5555, journal: sink }));

  assert.ok(store !== null, "a dead-pid lock is stale: broken and single-writer claimed");
  assert.ok(
    calls.some((c) => c.component === "state" && c.event === "lock.stale-break"),
    "breaking a dead-pid lock is recorded as lock.stale-break",
  );
  assert.equal(readLock(root).pid, 5555, "the workspace single-writer lock is now claimed by this instance");
});

test("[G14-lock] an over-age lock is stale-broken even though its owner pid is alive", () => {
  const root = scratchDir("conductor-bun-lock-overage-");
  // Owner pid is alive (this process), but the lock is far older than the threshold —
  // this exercises the process.kill(pid,0) => ALIVE branch plus the over-age override.
  preWriteLock(root, { pid: process.pid, startMs: START_MS - 10 * 60_000 });

  const { sink, calls } = makeJournal();
  const store = openWorkspace(
    freshOpts(root, { pid: process.pid + 7, journal: sink, staleLockMs: 60_000 }),
  );

  assert.ok(store !== null, "an over-age lock is stale even with a live pid: broken and claimed");
  assert.ok(
    calls.some((c) => c.component === "state" && c.event === "lock.stale-break"),
    "the over-age break is recorded as lock.stale-break",
  );
  assert.equal(readLock(root).pid, process.pid + 7, "single-writer claimed after breaking the over-age lock");
});

test("[G14-lock] a LIVE foreign lock REFUSES the second session and is left intact (never stolen)", () => {
  const root = scratchDir("conductor-bun-lock-foreign-");
  // A lock owned by a DIFFERENT, still-alive process (this test process's own pid),
  // young enough that only the liveness probe — not over-age — decides the outcome.
  preWriteLock(root, { pid: process.pid, startMs: START_MS - 1000 });

  const { sink, calls } = makeJournal();
  assert.throws(
    () => openWorkspace(freshOpts(root, { pid: process.pid + 1, journal: sink })),
    /held by another live conductor/,
    "a live foreign lock refuses the second session under both runtimes (§4.1, owner decision D6)",
  );
  assert.ok(
    calls.some((c) => c.level === "warn" && c.component === "state"),
    "a live foreign lock emits a LOUD (warn-level) journal record",
  );
  assert.equal(readLock(root).pid, process.pid, "the live foreign lock is left intact — never stolen");
});

// ===========================================================================
// (3) JSONL journal: append ordering (seq monotonic) + torn-trailing-line heal
// ===========================================================================

test("[G14-journal] N appendFileSync log() calls produce N ordered, parseable lines with strictly increasing seq", () => {
  const runDir = scratchDir("conductor-bun-journal-");
  const journal = createJournal(runDir, makeConfig(), DEV_ENV);

  const N = 12;
  const event = anyEvent("fsm");
  for (let i = 0; i < N; i += 1) {
    journal.log("info", "fsm", event, { i }, CORR);
  }
  journal.flushSync();

  const raw = readFileSync(path.join(runDir, "journal.jsonl"), "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  assert.equal(lines.length, N, "one complete line per record — no partial or interleaved appends");

  const records = lines.map((l) => JSON.parse(l) as JournalRecord);
  for (let i = 0; i < N; i += 1) {
    assert.equal((records[i].data as { i: number }).i, i, "records land on disk in the order they were logged");
  }
  for (let i = 1; i < records.length; i += 1) {
    assert.ok(
      records[i].seq > records[i - 1].seq,
      `seq must strictly increase across the appended records: ${records[i - 1].seq} -> ${records[i].seq}`,
    );
  }
});

test("[G14-journal] a torn trailing partial line is isolated; the next record stays its own parseable line and seq continues (§7.4)", () => {
  const runDir = scratchDir("conductor-bun-torn-");
  const cfg = makeConfig();

  // A prior process wrote some complete records, then crashed mid-append.
  const first = createJournal(runDir, cfg, DEV_ENV);
  for (let i = 0; i < 3; i += 1) {
    first.log("info", "fsm", anyEvent("fsm"), { pass: 1, i }, CORR);
  }
  first.flushSync();

  const before = readRecords(runDir);
  const lastCompleteSeq = before[before.length - 1].seq;

  // Simulate the crash: a partial record with NO terminating newline (power loss /
  // disk full mid-append) is left at the end of the file.
  const TORN = '{"seq":999,"ts":1,"level":"in';
  appendFileSync(path.join(runDir, "journal.jsonl"), TORN); // note: no trailing newline

  // A fresh journal restarts on the same dir and logs its next record.
  const second = createJournal(runDir, cfg, DEV_ENV);
  second.log("warn", "fsm", anyEvent("fsm"), { marker: "post-crash" }, CORR);
  second.flushSync();

  const lines = readFileSync(path.join(runDir, "journal.jsonl"), "utf8").split("\n");

  // The torn partial survives as its own still-unparseable line — the writer must not
  // have concatenated the new record onto it.
  assert.ok(
    lines.includes(TORN),
    `the torn partial must survive as its own line, not merge into the next record; saw: ${JSON.stringify(lines)}`,
  );
  assert.throws(() => JSON.parse(TORN), "the torn partial is unparseable by construction");

  // The record written after the torn line is one complete, JSON-parseable line.
  const parsed = lines
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      try {
        return JSON.parse(l) as JournalRecord;
      } catch {
        return undefined;
      }
    })
    .filter((r): r is JournalRecord => r !== undefined);

  const postCrash = parsed.filter((r) => (r.data as { marker?: unknown }).marker === "post-crash");
  assert.equal(
    postCrash.length,
    1,
    "the record written after the torn line is one complete, JSON-parseable line of its own",
  );
  assert.equal(
    postCrash[0].seq,
    lastCompleteSeq + 1,
    "the new record's seq continues from the last COMPLETE record, past the torn partial",
  );
});

// ===========================================================================
// (4) One execFile round-trip through gitio: isRepo + headSha on a fixture repo,
//     plus the non-zero-exit mapping on a non-repo. Proves node:child_process
//     execFileSync (shell:false argv) works under bun.
// ===========================================================================

test("[G14-gitio] execFileSync round-trip: isRepo + headSha read a fixture repo, and a non-repo maps a non-zero git exit to false", () => {
  const repo = scratchDir("conductor-bun-gitio-");
  git(repo, ["init", "-b", "main"]);
  writeFileSync(path.join(repo, "tracked.ts"), "export const x = 1;\n");
  git(repo, ["add", "tracked.ts"]);
  git(repo, ["commit", "-m", "seed commit"]);

  assert.equal(isRepo(repo), true, "isRepo returns true inside a git work tree (execFileSync round-trip)");

  const sha = headSha(repo);
  assert.ok(sha !== null, "headSha returns a sha for a repo with a commit");
  assert.match(sha as string, HEX40, "headSha is the full 40-hex HEAD sha");
  assert.equal(sha, git(repo, ["rev-parse", "HEAD"]).trim(), "headSha equals the fixture repo's real HEAD");

  // A plain directory is not a repo: git exits non-zero and gitio maps that to false
  // (never a throw) — a SECOND execFile round-trip exercising the failure path.
  const nonRepo = scratchDir("conductor-bun-nogit-");
  assert.equal(isRepo(nonRepo), false, "isRepo maps a non-zero git exit on a non-repo to false");
  assert.equal(headSha(nonRepo), null, "headSha maps the non-repo failure to null, not a throw");
});
