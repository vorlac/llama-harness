// conductor/tests/workspace-lock.test.ts — Phase IV.2 item 2 (GAP-027): the
// workspace is held by ONE writer, enforced by the OS.
//
// Owner decision D6: the flock lands — a second session fails LOUDLY, never
// corrupts. So openWorkspace does not demote a second opener to a decorative
// "read-only conductor" (ISSUE-023: that flag guarded 2 of ~12 mutating methods
// and nothing outside state.ts ever consulted it); it REFUSES, naming the holder.
//
// SUBJECT: conductor/adapter/state.ts — openWorkspace / release.
//
// The three defects this pins closed:
//   ISSUE-023 — the demotion flag, and the beacon written BEFORE the lock was won
//               (so a refused session named itself in §3.8's liveness signal).
//   ISSUE-024 — the stale-break was a naked read-then-overwrite: two racers on one
//               stale lock both became writers (TOCTOU).
//   ISSUE-025 — release() deleted whoever's lock was present, handing the
//               workspace to a third writer.
//
// HERMETIC: throwaway dirs under os.tmpdir(); no git remote, no socket, no port.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { isWorkspaceLocked, openWorkspace } from "../adapter/state.ts";
import type { Beacon, LockRecord, OpenOptions, StateJournal } from "../adapter/state.ts";
import type { Config } from "../core/types.ts";

const START_MS = 1_754_560_000_000;

const tmpDirs: string[] = [];
after(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-lock-"));
  tmpDirs.push(dir);
  return dir;
}

interface LogCall {
  level: string;
  component: string;
  event: string;
  data: Record<string, unknown>;
}

function makeJournal(): { sink: StateJournal; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const sink: StateJournal = {
    log(level, component, event, data) {
      calls.push({ level, component, event, data });
    },
  };
  return { sink, calls };
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

function opts(root: string, over: Partial<OpenOptions> = {}): OpenOptions {
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
  return { ...base, ...over };
}

function stateDir(root: string): string {
  return path.join(root, ".conductor", "state");
}
function lockPath(root: string): string {
  return path.join(stateDir(root), "run.lock");
}
function alivePath(root: string): string {
  return path.join(stateDir(root), "alive.json");
}
function preWriteLock(root: string, rec: LockRecord): void {
  mkdirSync(stateDir(root), { recursive: true });
  writeFileSync(lockPath(root), JSON.stringify(rec));
}
function readLock(root: string): LockRecord {
  return JSON.parse(readFileSync(lockPath(root), "utf8")) as LockRecord;
}
function readBeaconFile(root: string): Beacon | null {
  if (!existsSync(alivePath(root))) return null;
  return JSON.parse(readFileSync(alivePath(root), "utf8")) as Beacon;
}
// Every entry in the state dir that is not one of its known artifacts: a
// stale-break that leaves its scratch copy behind would show up here.
function stateDirLeftovers(root: string): string[] {
  const known = new Set(["run.lock", "alive.json", "current-run.json", "stale-red.json", "halt"]);
  const dir = stateDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => !known.has(name));
}

// The exclusive break RIGHT for one lock identity, as adapter/state.ts names it:
// `run.lock.break.<identity>`, where the identity is the claim's token, or
// pid+startMs for a record minted without one. The name is the protocol — a racer
// composes it from the identity it READ, so a party holding a different view of the
// lock cannot claim, and cannot collide with, the removal right for this one.
function breakRightPath(root: string, holder: LockRecord): string {
  const key = holder.token ?? `p${String(holder.pid)}-t${String(holder.startMs)}`;
  return lockPath(root) + ".break." + key;
}

function deadPid(): number {
  const reaped = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  assert.equal(typeof reaped.pid, "number", "spawn-and-reap yields a concrete, now-dead pid");
  return reaped.pid as number;
}

// ---------------------------------------------------------------------------
// D6: a second session fails LOUDLY
// ---------------------------------------------------------------------------

test("[IV.2-lock] a second session opening a workspace held by a LIVE writer is REFUSED, and the refusal names the holder", () => {
  const root = scratch();
  // The holder: a different, still-alive process (this test process).
  preWriteLock(root, { pid: process.pid, startMs: START_MS - 1000, sessionID: "ses_holder" });
  const { sink, calls } = makeJournal();

  let thrown: unknown = null;
  try {
    openWorkspace(opts(root, { pid: process.pid + 1, journal: sink, sessionID: "ses_second" }));
  } catch (err) {
    thrown = err;
  }

  assert.notEqual(thrown, null, "opening a locked workspace is a refusal, never a quiet demotion");
  assert.equal(isWorkspaceLocked(thrown), true, "the refusal is the workspace-locked refusal, not an incidental throw");
  const message = (thrown as Error).message;
  assert.ok(message.includes(String(process.pid)), "the refusal names the HOLDER's pid: " + message);
  assert.ok(message.includes("ses_holder"), "the refusal names the holder's session: " + message);
  assert.deepEqual(
    readLock(root),
    { pid: process.pid, startMs: START_MS - 1000, sessionID: "ses_holder" },
    "the live holder's lock is left byte-for-byte intact — never stolen, never rewritten",
  );
  assert.ok(
    calls.some((c) => c.level === "warn" && c.component === "state" && c.event === "lock.contended"),
    "the refusal is journaled loudly (warn) as lock.contended",
  );
});

test("[IV.2-lock] ISSUE-023: the refused session does NOT overwrite the holder's §3.8 beacon", () => {
  const root = scratch();
  preWriteLock(root, { pid: process.pid, startMs: START_MS - 1000, sessionID: "ses_holder" });
  // The holder's beacon, as its own open would have written it.
  mkdirSync(stateDir(root), { recursive: true });
  writeFileSync(
    alivePath(root),
    JSON.stringify({ pid: process.pid, startMs: START_MS - 1000, version: "0.0.0-holder", sessionID: "ses_holder" }),
  );

  assert.throws(
    () => openWorkspace(opts(root, { pid: process.pid + 1, sessionID: "ses_second", version: "0.0.0-second" })),
    /lock|held/i,
    "the second open is refused",
  );

  const beacon = readBeaconFile(root);
  assert.equal(beacon?.pid, process.pid, "alive.json still names the process that actually holds the workspace");
  assert.equal(beacon?.sessionID, "ses_holder", "§3.8's liveness signal is not repointed by a session that never won the lock");
});

test("[IV.2-lock] ISSUE-023: the store exposes no decorative read-only flag — a store exists only for the lock HOLDER", () => {
  const root = scratch();
  const store = openWorkspace(opts(root));
  assert.equal(
    Object.hasOwn(store as unknown as Record<string, unknown>, "readOnly"),
    false,
    "a flag that guarded 2 of ~12 mutating methods and that nothing consulted is not a safety mechanism; the lock is",
  );
  store.release();
});

// ---------------------------------------------------------------------------
// ISSUE-024: the stale break is atomic
// ---------------------------------------------------------------------------

test("[IV.2-lock] a STALE lock (dead pid) is broken atomically and the workspace is claimed", () => {
  const root = scratch();
  preWriteLock(root, { pid: deadPid(), startMs: START_MS });
  const { sink, calls } = makeJournal();

  const store = openWorkspace(opts(root, { pid: 5555, journal: sink }));
  assert.equal(readLock(root).pid, 5555, "the dead owner's lock is broken and this instance claims the workspace");
  assert.ok(
    calls.some((c) => c.component === "state" && c.event === "lock.stale-break"),
    "the break is recorded as lock.stale-break (the anomaly trace)",
  );
  assert.deepEqual(
    stateDirLeftovers(root),
    [],
    "the broken lock is not left parked beside the live one under a scratch name",
  );
  store.release();
});

test("[IV.2-lock] ISSUE-024: a racer that plants a LIVE lock inside the stale-break window does not end up with two writers", () => {
  const root = scratch();
  // The lock we are about to judge stale.
  const dead = deadPid();
  preWriteLock(root, { pid: dead, startMs: START_MS });
  const { sink, calls } = makeJournal();

  // The seam fires after this open decides "stale" and BEFORE it claims: the racer
  // has already broken the same stale lock and claimed the workspace for itself.
  let planted = false;
  let thrown: unknown = null;
  try {
    openWorkspace(
      opts(root, {
        pid: process.pid + 1,
        journal: sink,
        sessionID: "ses_loser",
        onBeforeStaleClaim: () => {
          if (planted) return;
          planted = true;
          preWriteLock(root, { pid: process.pid, startMs: START_MS, sessionID: "ses_racer" });
        },
      }),
    );
  } catch (err) {
    thrown = err;
  }

  assert.equal(planted, true, "the seam fired — the window this test aims at exists");
  assert.equal(isWorkspaceLocked(thrown), true, "the loser of the stale-break race is REFUSED, not made a second writer");
  assert.equal(readLock(root).pid, process.pid, "the racer's live lock stands: the loser neither stole nor overwrote it");
  assert.equal(readLock(root).sessionID, "ses_racer", "and it stands unmodified");
  assert.ok(
    calls.some((c) => c.event === "lock.contended"),
    "the lost race is journaled as contention",
  );
});

// ---------------------------------------------------------------------------
// ISSUE-025: release deletes only its OWN lock
// ---------------------------------------------------------------------------

test("[IV.2-lock] ISSUE-025: release() deletes only the lock it holds — a successor's lock survives", () => {
  const root = scratch();
  const store = openWorkspace(opts(root, { pid: 4242, sessionID: "ses_first" }));
  assert.equal(readLock(root).pid, 4242, "the first opener holds the workspace");

  // The first session went over-age and a NEW writer legitimately broke its lock.
  preWriteLock(root, { pid: process.pid, startMs: START_MS + 1, sessionID: "ses_successor" });

  store.release();

  assert.equal(existsSync(lockPath(root)), true, "the successor's lock is still on disk");
  assert.equal(readLock(root).pid, process.pid, "a stale session's release must not hand the workspace to a third writer");
});

test("[IV.2-lock] release() removes the holder's OWN lock, so the next session opens cleanly", () => {
  const root = scratch();
  const store = openWorkspace(opts(root, { pid: 4242, sessionID: "ses_first" }));
  store.release();
  assert.equal(existsSync(lockPath(root)), false, "the holder's own lock is removed on release");

  const second = openWorkspace(opts(root, { pid: 4243, sessionID: "ses_second" }));
  assert.equal(readLock(root).pid, 4243, "the workspace is claimable again once released");
  second.release();
});

test("[IV.2-lock] re-opening under the SAME pid adopts the existing lock instead of refusing itself", () => {
  const root = scratch();
  const first = openWorkspace(opts(root, { pid: 4242, sessionID: "ses_first" }));
  const again = openWorkspace(opts(root, { pid: 4242, sessionID: "ses_first" }));
  assert.equal(readLock(root).pid, 4242, "the lock stays ours across an idempotent re-open");
  again.release();
  assert.equal(existsSync(lockPath(root)), false, "and releasing it removes it");
  first.release();
});

// ---------------------------------------------------------------------------
// P0: the stale break is correct for N racers, not for two
//
// The two-party model above is satisfiable by a protocol that still produces two
// writers the moment a THIRD opener joins. Rename moves whatever occupies the lock
// path, not the inode the caller judged: racer A breaks the stale lock and claims
// its own, and a laggard B — still holding its read of the dead lock — renames A's
// LIVE lock aside and drops it. Four real node processes racing one dead-pid lock
// produced concurrent writers in 12 of 25 iterations under that protocol.
//
// The invariant these pin: for ANY number of concurrent parties, at most one
// proceeds as writer; every loser gets a loud refusal naming the holder, and no
// loser removes, displaces or rewrites a byte of somebody else's live lock.
// ---------------------------------------------------------------------------

test("[IV.2-lock] P0: a laggard that does NOT hold the identity-keyed break right removes nothing — the stale lock stands and the laggard is refused", () => {
  const root = scratch();
  const stale: LockRecord = { pid: deadPid(), startMs: START_MS, sessionID: "ses_dead" };
  preWriteLock(root, stale);
  // Party 2 is mid-break: it owns the removal of THIS identity and no other party
  // may act on the same view. (In the shipped protocol it holds this exclusively;
  // the test plants it so the third party's behaviour is deterministic.)
  writeFileSync(breakRightPath(root, stale), JSON.stringify({ breakerPid: process.pid }));
  const before = readFileSync(lockPath(root), "utf8");
  const { sink, calls } = makeJournal();

  let thrown: unknown = null;
  try {
    openWorkspace(opts(root, { pid: process.pid + 1, journal: sink, sessionID: "ses_laggard" }));
  } catch (err) {
    thrown = err;
  }

  assert.equal(isWorkspaceLocked(thrown), true, "the third party is REFUSED, never made a second writer");
  assert.equal(
    readFileSync(lockPath(root), "utf8"),
    before,
    "a racer that does not own the removal right for the identity it read deletes nothing: the lock is byte-for-byte as it was",
  );
  assert.equal(existsSync(breakRightPath(root, stale)), true, "and it does not steal the right another racer holds");
  assert.ok(
    calls.some((c) => c.event === "lock.stale-break"),
    "the refusal follows a real stale judgement — the test drives the break path, not the live-holder path",
  );

  // The serialization is not a wedge: once the breaker's right is gone, the same
  // stale lock is claimable again.
  rmSync(breakRightPath(root, stale), { force: true });
  const store = openWorkspace(opts(root, { pid: process.pid + 1, sessionID: "ses_laggard" }));
  assert.equal(readLock(root).pid, process.pid + 1, "with the right released, the stale lock is broken and claimed");
  assert.deepEqual(stateDirLeftovers(root), [], "and the break leaves neither its right nor its scratch copy behind");
  store.release();
});

test("[IV.2-lock] P0: N parties race one stale lock — exactly ONE holds the workspace, and the three losers leave the winner's lock untouched", () => {
  const root = scratch();
  preWriteLock(root, { pid: deadPid(), startMs: START_MS, sessionID: "ses_dead" });

  // Party B opens, judges the dead lock stale, and is suspended inside the break
  // window. Parties A, C and D drive REAL opens of the shipped path in that window:
  // A wins the break; C and D arrive after it and must be refused.
  let winner: ReturnType<typeof openWorkspace> | null = null;
  const refusals: unknown[] = [];
  let lockAfterWinner = "";
  let winnerStat: Stats | null = null;
  let windows = 0;

  let thrownB: unknown = null;
  try {
    openWorkspace(
      opts(root, {
        pid: process.pid + 1,
        sessionID: "ses_B",
        onBeforeStaleClaim: ({ attempt, judged }) => {
          windows += 1;
          if (attempt !== 0) return;
          assert.notEqual(judged, null, "the seam is handed the record this open judged stale");
          winner = openWorkspace(opts(root, { pid: process.pid, sessionID: "ses_A" }));
          lockAfterWinner = readFileSync(lockPath(root), "utf8");
          winnerStat = statSync(lockPath(root));
          for (const late of ["ses_C", "ses_D"]) {
            try {
              openWorkspace(opts(root, { pid: process.pid + 2, sessionID: late }));
              refusals.push(null); // a store handed out here is a second writer
            } catch (err) {
              refusals.push(err);
            }
          }
        },
      }),
    );
  } catch (err) {
    thrownB = err;
  }

  assert.equal(windows > 0, true, "the seam fired — the break window this test aims at exists");
  assert.notEqual(winner, null, "exactly one party — the one that won the break — got a store");
  assert.equal(isWorkspaceLocked(thrownB), true, "the laggard B is refused, not made a second writer");
  assert.equal(refusals.length, 2, "both late parties completed their open attempt");
  for (const err of refusals) {
    assert.equal(isWorkspaceLocked(err), true, "every late party is REFUSED, naming the holder");
    assert.ok((err as Error).message.includes("ses_A"), "and the refusal names the party that actually holds it");
  }
  assert.equal(
    readFileSync(lockPath(root), "utf8"),
    lockAfterWinner,
    "the winner's lock survives all three losers byte-for-byte — no laggard renamed it aside, rewrote it or dropped it",
  );
  // Content equality alone cannot tell "untouched" from "moved aside and put back",
  // and the difference is the whole defect: a laggard that moves a live lock at all
  // has a window in which the workspace has no lock file and a further party can
  // claim it. The inode and its ctime are what a rename or a relink would disturb.
  const finalStat = statSync(lockPath(root));
  const claimStat = winnerStat as Stats | null;
  assert.notEqual(claimStat, null, "premise: the winner's lock was stat'd the instant it was claimed");
  assert.equal(finalStat.ino, claimStat?.ino, "the winner's lock is the same inode: no laggard moved or recreated it");
  assert.equal(
    finalStat.ctimeMs,
    claimStat?.ctimeMs,
    "and it was never touched at all — a laggard acts on the identity it READ, or it acts on nothing",
  );
  assert.deepEqual(stateDirLeftovers(root), [], "and no break right or scratch copy is parked beside it");

  // The winner still genuinely holds the workspace: its own release is the one that
  // frees it, which a displaced holder's release would decline to do.
  (winner as unknown as { release: () => void }).release();
  assert.equal(existsSync(lockPath(root)), false, "the holder — and only the holder — releases the workspace");
});

test("[IV.2-lock] P0: a claim that wins the exclusive create but is DISPLACED before it verifies does not proceed as writer", () => {
  const root = scratch();
  const { sink, calls } = makeJournal();

  // The window between winning O_EXCL and reading back what the lock path actually
  // says. Winning the create says the path was free; being the identity the file
  // names is what makes a process the writer.
  let planted = false;
  let thrown: unknown = null;
  try {
    openWorkspace(
      opts(root, {
        pid: process.pid + 1,
        journal: sink,
        sessionID: "ses_displaced",
        onAfterFreshLockWrite: () => {
          if (planted) return;
          planted = true;
          preWriteLock(root, { pid: process.pid, startMs: START_MS, sessionID: "ses_intruder" });
        },
      }),
    );
  } catch (err) {
    thrown = err;
  }

  assert.equal(planted, true, "the seam fired — the post-create window exists");
  assert.equal(isWorkspaceLocked(thrown), true, "a displaced claim is a refusal, not a store");
  assert.equal(readLock(root).sessionID, "ses_intruder", "the party the lock file names is the writer");
  assert.ok(
    calls.some((c) => c.event === "lock.contended" && c.data.displaced === true),
    "and the displacement is journaled loudly rather than swallowed",
  );
});

test("[IV.2-lock] P0: a break right abandoned by a breaker that died mid-break does not wedge the workspace", () => {
  const root = scratch();
  const first: LockRecord = { pid: deadPid(), startMs: START_MS, sessionID: "ses_dead_one" };
  const second: LockRecord = { pid: deadPid(), startMs: START_MS, sessionID: "ses_dead_two" };
  preWriteLock(root, first);

  // Inside the first break window: the breaker of `first` died between taking its
  // right and finishing, and a later party's dead lock occupies the path. The right
  // protects an identity that can never return, so it must not outlive this open.
  const store = openWorkspace(
    opts(root, {
      pid: 4242,
      sessionID: "ses_after_crash",
      onBeforeStaleClaim: ({ attempt }) => {
        if (attempt !== 0) return;
        writeFileSync(breakRightPath(root, first), JSON.stringify({ breakerPid: deadPid() }));
        preWriteLock(root, second);
      },
    }),
  );

  assert.equal(readLock(root).pid, 4242, "the workspace is still claimable after a breaker died mid-break");
  assert.deepEqual(
    stateDirLeftovers(root),
    [],
    "the abandoned right is cleared, so it cannot wedge every later opener against a lock nobody can break",
  );
  store.release();
});

test("[IV.2-lock] P0/ISSUE-025: identity is the claim's own token — a successor sharing this claim's pid AND startMs is not released by it", () => {
  const root = scratch();
  const store = openWorkspace(opts(root, { pid: 4242, sessionID: "ses_first" }));
  const mine = readLock(root);
  assert.equal(typeof mine.token, "string", "a claim stamps a per-acquisition identity, not just pid+startMs");

  // A recycled pid under the injected clock: same pid, same startMs, different
  // acquisition. pid+startMs alone cannot tell the two claims apart.
  preWriteLock(root, { pid: 4242, startMs: START_MS, sessionID: "ses_successor", token: "successor-token" });

  store.release();

  assert.equal(existsSync(lockPath(root)), true, "the successor's lock survives a stale session's release");
  assert.equal(readLock(root).sessionID, "ses_successor", "release removes only the acquisition it actually holds");
});

test("[IV.2-lock] an over-age lock is broken even though its owner pid is alive (a wedged workspace is not a safe one)", () => {
  const root = scratch();
  preWriteLock(root, { pid: process.pid, startMs: START_MS - 10 * 60_000, sessionID: "ses_ancient" });
  const { sink, calls } = makeJournal();

  const store = openWorkspace(opts(root, { pid: process.pid + 7, journal: sink, staleLockMs: 60_000 }));
  assert.equal(readLock(root).pid, process.pid + 7, "the over-age lock is broken and the workspace claimed");
  assert.ok(
    calls.some((c) => c.event === "lock.stale-break" && c.data.reason === "over-age"),
    "the break records WHY it was legal",
  );
  store.release();
});

// ---------------------------------------------------------------------------
// R1: an ORPHAN break right (breaker died mid-break) does not PERMANENTLY wedge the
// workspace, and the exhaustion refusal names the real artifact.
//
// The round-2 clear-on-abandon path only fires once the broken identity has LEFT the
// lock path — which cannot happen while a dead-pid lock sits there unbroken. So a
// dead-pid lock plus a break right for that identity, abandoned by a breaker that
// then died, wedged every later opener forever, and the refusal misreported it as
// "held by another live conductor — pid <dead pid>". The fix reclaims a break right
// whose breaker is provably gone (or that is over-age), while still respecting a
// right a LIVE breaker holds.
// ---------------------------------------------------------------------------

test("[IV.2-lock] R1: a dead-pid lock behind an ORPHAN break right (breaker provably gone) is RECLAIMED, not wedged forever", () => {
  const root = scratch();
  const stale: LockRecord = { pid: deadPid(), startMs: START_MS, sessionID: "ses_dead" };
  preWriteLock(root, stale);
  // A break right for THIS identity, abandoned by a breaker that has since died. The
  // lock is NOT displaced, so the "identity has left the path" clear can never fire:
  // only a liveness/age reclaim of the right can break the wedge.
  writeFileSync(
    breakRightPath(root, stale),
    JSON.stringify({ breakerPid: deadPid(), key: "x", startMs: START_MS }),
  );
  const { sink, calls } = makeJournal();

  const store = openWorkspace(opts(root, { pid: 4242, sessionID: "ses_after_crash", journal: sink }));
  assert.equal(
    readLock(root).pid,
    4242,
    "the orphan right is reclaimed and the stale lock broken — the workspace is claimable again, not wedged",
  );
  assert.equal(existsSync(breakRightPath(root, stale)), false, "the reclaimed orphan right is gone");
  assert.deepEqual(stateDirLeftovers(root), [], "neither the orphan right nor a scratch copy is left behind");
  assert.ok(
    calls.some((c) => c.event === "lock.stale-break"),
    "the reclaim-then-break is journaled as a real stale break",
  );
  store.release();
});

test("[IV.2-lock] R1: a FRESH break right (a LIVE breaker mid-break) is RESPECTED — not stolen — and the exhaustion refusal does not call a dead pid a live conductor", () => {
  const root = scratch();
  const stale: LockRecord = { pid: deadPid(), startMs: START_MS, sessionID: "ses_dead" };
  preWriteLock(root, stale);
  // The break right is held by a LIVE breaker (this very test process), mid-break.
  const right = breakRightPath(root, stale);
  writeFileSync(right, JSON.stringify({ breakerPid: process.pid, key: "x", startMs: START_MS }));

  let thrown: unknown = null;
  try {
    openWorkspace(opts(root, { pid: process.pid + 1, sessionID: "ses_newcomer" }));
  } catch (err) {
    thrown = err;
  }

  assert.equal(
    isWorkspaceLocked(thrown),
    true,
    "the newcomer backs off (a refusal) rather than stealing a live breaker's exclusive right",
  );
  assert.equal(
    existsSync(right),
    true,
    "the live breaker's right is left intact — a live mid-break is respected, never reclaimed",
  );
  assert.deepEqual(
    readLock(root),
    stale,
    "and the stale lock the live breaker is working on is untouched by the refused newcomer",
  );
  const message = (thrown as Error).message;
  assert.doesNotMatch(
    message,
    /held by another live conductor/i,
    "the corrected refusal does not misreport a stuck break right as a live holder",
  );
  assert.match(message, /not alive/i, "it reports the dead holder pid as NOT alive");
  assert.match(message, /break right/i, "and names the stuck break right as the cause so the operator knows what to clear");
});

// ---------------------------------------------------------------------------
// R2: the atomic publication of a claim (write-whole-to-temp + linkSync) has an
// in-gate guard. The whole workspace-lock suite stayed green with publication
// reverted to an O_EXCL-create-then-write, whose lock file is present-but-EMPTY from
// the create until the write lands — the window a concurrent opener reads as an
// unparseable, breakable lock and steals a live claim through. This guard binds the
// temp+link mechanism deterministically: it goes red the moment publication stops
// writing the claim whole to a temp before linking it into place.
// ---------------------------------------------------------------------------

test("[IV.2-lock] R2: lock publication is ATOMIC — the claim reaches a same-dir temp and is linked whole; the lock path is never a present-but-empty file", () => {
  const root = scratch();
  let seamFired = false;
  let tempCarriedCompleteClaim = false;
  let lockPresentButEmpty = false;

  const store = openWorkspace(
    opts(root, {
      pid: 7777,
      sessionID: "ses_atomic",
      onClaimTempWritten: ({ temp, lockPath: lp }) => {
        seamFired = true;
        // The whole claim is already in the temp — content is assembled OFF the lock
        // path, never at it. A create-then-write has no such temp to hand here.
        try {
          const rec = JSON.parse(readFileSync(temp, "utf8")) as LockRecord;
          tempCarriedCompleteClaim = typeof rec.token === "string" && rec.pid === 7777;
        } catch {
          tempCarriedCompleteClaim = false;
        }
        // At the publish instant the lock path is absent (this fresh open) or a prior
        // COMPLETE claim — never the empty shell a create-then-write exposes between
        // its O_EXCL create and its write.
        if (existsSync(lp)) {
          const raw = readFileSync(lp, "utf8");
          let parseable = true;
          try {
            JSON.parse(raw);
          } catch {
            parseable = false;
          }
          if (raw.length === 0 || !parseable) lockPresentButEmpty = true;
        }
      },
    }),
  );

  assert.equal(
    seamFired,
    true,
    "the temp+link publication path was taken — a create-then-write revert has no temp to report here, so this assertion goes red",
  );
  assert.equal(
    tempCarriedCompleteClaim,
    true,
    "the claim is written WHOLE to the temp before publication, not assembled at the lock path",
  );
  assert.equal(
    lockPresentButEmpty,
    false,
    "the lock path is never a present-but-empty file that a concurrent opener would read as unparseable and break",
  );
  assert.equal(readLock(root).pid, 7777, "and the atomically published lock is the one on disk");
  store.release();
});
