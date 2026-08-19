// conductor/adapter/state.ts — Task 4.1: the .conductor/ crash-safe state store
// (plan lines 2276-2304, §1.2 layout, §2.3 run.json, §2.5 item, §2.11 stale-red
// registry, §3.8 beacon, §3.9 no-git mode).
//
// An ADAPTER (G14): it does filesystem I/O and reads the injected clock, so it
// lives outside the pure core. It runs under BOTH the opencode runtime and Node
// type-stripping, so it uses only cross-runtime built-ins — node:fs, node:path,
// node:crypto — plus adapter/gitio.ts for git provenance and core/types.ts for
// the schema validator. No single-runtime API, no shell tag, no subprocess of its
// own (every git read goes through gitio's argv-only, shell:false spawner).
//
// Crash-safety is the whole point of this module: every persisted write goes
// through writeFileAtomicSync — a pid-suffixed SAME-DIR temp file, fully written,
// then atomically renamed over the target — so a crash mid-commit can never
// corrupt a state file. A read never trusts the wall clock: openWorkspace takes
// an injected `now()` and every stamped timestamp (beacon.startMs, lock.startMs,
// disposition sinceMs, run createdIso) comes from it.

import {
  appendFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

import { currentBranch, dirtyFiles, gitCommonDir, headSha, isRepo } from "./gitio.ts";
import { treePath, validate } from "../core/types.ts";
import type { Config, Item, Run, StaleRedRegistry, TreePath } from "../core/types.ts";

// The over-age lock threshold: a lock older than this is stale even if its owner
// pid is still alive (a crashed-then-reused pid, or an abandoned process). 24h.
const DEFAULT_STALE_LOCK_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

// A workspace-level journal sink. Structurally the real adapter/journal.ts
// Journal minus the mandatory runId — the lock and beacon are workspace events
// that PRECEDE any run, so runId is optional here.
export interface StateJournal {
  log: (
    level: string,
    component: string,
    event: string,
    data: Record<string, unknown>,
    corr: { runId?: string; itemId?: string; sessionID?: string },
  ) => void;
}

export interface OpenOptions {
  root: string;
  config: Config;
  journal: StateJournal;
  version: string;
  sessionID: string;
  // THE clock the store reads for every stamped timestamp; defaults to `Date.now`.
  now?: () => number;
  pid?: number; // defaults to process.pid; names the temp files and the lock owner
  staleLockMs?: number; // over-age lock threshold; defaults to 24h
  // Test seam (F4): fires BEFORE a fresh claim is published at the lock path, so a
  // test can plant a racing lock in that window. Undefined in production.
  onBeforeFreshLockWrite?: () => void;
  // Test seam (P0/N-party): fires after a fresh claim is published and BEFORE it is
  // verified against what is on disk, so a test can plant a displacing lock in
  // exactly that window. Undefined in production.
  onAfterFreshLockWrite?: () => void;
  // Test seam (ISSUE-024, generalized to N parties): fires after this open judges a
  // foreign lock STALE and before it breaks and claims, so a test can drive any
  // number of other racers through that window. It is handed the attempt index and
  // the record this open judged, which is what lets one seam model party 3, party 4
  // and beyond on successive attempts rather than a single racer. Undefined in
  // production.
  onBeforeStaleClaim?: (window: { attempt: number; judged: LockRecord | null }) => void;
  // Test seam (R2 publication-atomicity guard): fires inside claimLockFile AFTER the
  // whole claim has been written to a same-dir temp and BEFORE it is published with
  // linkSync. It is handed the temp path and the lock path, which lets a guard assert
  // the two facts that distinguish atomic temp+link publication from a
  // create-then-write: the temp exists and already carries the COMPLETE claim, and
  // the lock path is NOT a present-but-empty file at the publish instant. A revert to
  // an O_EXCL-create-then-write publication has no temp to hand here, so the guard
  // that asserts this seam fires goes red. Undefined in production.
  onClaimTempWritten?: (window: { temp: string; lockPath: string }) => void;
}

// The refusal a second session gets (owner decision D6). Carries the holder so the
// composition root can name it to the operator rather than reporting an errno.
export interface WorkspaceLockedError extends Error {
  conductorCode: typeof WORKSPACE_LOCKED_CODE;
  holder: LockRecord;
}

const WORKSPACE_LOCKED_CODE = "CONDUCTOR_WORKSPACE_LOCKED";

export function isWorkspaceLocked(err: unknown): err is WorkspaceLockedError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { conductorCode?: unknown }).conductorCode === WORKSPACE_LOCKED_CODE
  );
}

function workspaceLockedError(root: string, holder: LockRecord): WorkspaceLockedError {
  const who =
    "pid " +
    String(holder.pid) +
    (holder.sessionID === undefined ? "" : ' (session "' + holder.sessionID + '")');
  const err = new Error(
    "state: the conductor workspace at " +
      root +
      " is held by another live conductor — " +
      who +
      ", holding since " +
      new Date(holder.startMs).toISOString() +
      ". Two conductors sharing one workspace mint colliding evidence seqs and publish " +
      "one item's green on another item's verify, so the second session does not open. " +
      "Close that session (or wait for it to release the workspace) and try again.",
  );
  return Object.assign(err, { conductorCode: WORKSPACE_LOCKED_CODE, holder }) as WorkspaceLockedError;
}

// The refusal for a RETRY-BUDGET exhaustion, as opposed to a live young holder. The
// live-holder refusal (workspaceLockedError) is thrown from inside acquireLock and
// truthfully names a live conductor; this one is thrown when the budget runs out
// without a claim, where the artifact in the way may be a stale lock whose break
// right is contended, or a stuck break right — NOT necessarily a live process. It
// must not assert a (possibly dead) pid is a live conductor: it reports the holder's
// pid together with whether that pid is actually alive, and names the break right as
// a possible cause so the operator knows what to clear.
function workspaceUnreclaimableError(root: string, holder: LockRecord | null): WorkspaceLockedError {
  const fallback: LockRecord = holder ?? { pid: -1, startMs: 0 };
  const alive = holder !== null && pidIsAlive(holder.pid);
  const who =
    holder === null
      ? "no readable lock file is present"
      : "the lock names pid " +
        String(holder.pid) +
        (alive ? " (alive)" : " (not alive — a stale lock or a stuck break right, not a live conductor)") +
        (holder.sessionID === undefined ? "" : ' (session "' + holder.sessionID + '")');
  const err = new Error(
    "state: the conductor workspace at " +
      root +
      " could not be acquired within the retry budget — " +
      who +
      ". Either a live conductor holds it, or a stale lock could not be reclaimed because its break " +
      "right is contended. Retry; if it persists, and no conductor is running, remove " +
      ".conductor/state/run.lock and any .conductor/state/run.lock.break.* by hand.",
  );
  return Object.assign(err, {
    conductorCode: WORKSPACE_LOCKED_CODE,
    holder: fallback,
  }) as WorkspaceLockedError;
}

// .conductor/state/run.lock — the OS-level single-writer lock. `sessionID` names
// the opencode session behind the pid, so a refusal can tell the operator WHICH
// conductor holds the workspace and not merely that something does.
//
// `token` is the ACQUISITION identity: a random word minted once per successful
// claim. pid+startMs cannot name a claim uniquely — a recycled pid under an
// injected clock repeats both — and every removal in this module is keyed on the
// identity the remover READ, so the identity has to be unforgeable. A lock written
// by an older conductor (or by a test fixture) carries no token; identity then
// falls back to pid+startMs, which is what release() compared before.
export interface LockRecord {
  pid: number;
  startMs: number;
  sessionID?: string;
  token?: string;
}

// .conductor/state/alive.json — the §3.8 liveness beacon.
export interface Beacon {
  pid: number;
  startMs: number;
  version: string;
  sessionID: string;
}

export interface CreateRunInput {
  prompt: string;
  sessionID: string;
  classification: Run["classification"];
}

export interface StateStore {
  // The §3.8 beacon as it stood BEFORE this session claimed the workspace: the
  // conductor that held it last, or null for a first open. It is the signal that
  // tells a fresh session whether the previous one exited or died — read once at
  // open, because the claim overwrites the beacon with this session's own.
  readonly priorBeacon: Beacon | null;
  // The workspace root, as the tree PATH the §3.5 gates compare an edit path
  // against: it IS the tree of every session working an item with no worktree.
  readonly root: TreePath;
  createRun(input: CreateRunInput, opts?: { onAfterRunJson?: () => void }): Run;
  loadRun(runId: string): Run;
  saveRun(run: Run): void;
  currentRun(): Run | null;
  archiveRun(runId: string): void;
  // archiveRun's named inverse: re-point the current-run pointer at a run whose
  // stop a human answer has cleared (ISSUE-066).
  resumeRun(runId: string): void;
  loadItem(runId: string, itemId: string): Item;
  saveItem(runId: string, item: Item): void;
  removeItem(runId: string, itemId: string): void;
  setBlocked(
    runId: string,
    itemId: string,
    input: { reason: string; stage: string; questionId?: string },
  ): Item;
  clearBlocked(runId: string, itemId: string): Item;
  setDeferred(runId: string, itemId: string, input: { reason: string; decisionId: string }): Item;
  setDebugging(runId: string, itemId: string, input: { hypothesis: string }): Item;
  itemsSummary(runId: string): {
    open: number;
    blocked: number;
    deferred: number;
    surfacedQuestions: number;
  };
  readStaleRed(): StaleRedRegistry;
  addStaleRed(entry: StaleRedRegistry["entries"][number]): StaleRedRegistry;
  removeStaleRed(entryPath: string): StaleRedRegistry;
  readBeacon(): Beacon | null;
  isHalted(): boolean;
  release(): void;
}

// ---------------------------------------------------------------------------
// Crash-safety primitives (exported)
// ---------------------------------------------------------------------------

// Atomically replace filePath's contents with `data`. The bytes are written to a
// pid-suffixed sibling temp file in the SAME directory (so the rename is a true
// same-filesystem atomic swap), then renamed over the target. `onBeforeRename`
// fires AFTER the temp is fully written and BEFORE the rename — the injection
// point a test uses to simulate a crash mid-commit. A throw there (or a rename
// failure) leaves the OLD target byte-for-byte intact and removes the temp, so
// no half-written wedge is ever left behind.
export function writeFileAtomicSync(
  filePath: string,
  data: string,
  opts?: { pid?: number; onBeforeRename?: (tmpPath: string) => void },
): void {
  const pid = opts?.pid ?? process.pid;
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `${path.basename(filePath)}.${pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  writeFileSync(tmpPath, data);
  try {
    if (opts?.onBeforeRename !== undefined) opts.onBeforeRename(tmpPath);
    renameSync(tmpPath, filePath);
  } catch (err) {
    // The commit was interrupted: drop the temp (force:true swallows ENOENT) so
    // the old target stays the only copy, then re-raise so the caller sees the crash.
    rmSync(tmpPath, { force: true });
    throw err;
  }
}

// Read + JSON.parse a file, tolerating a leading UTF-8 BOM (all conductor JSON is
// written without a BOM, but a well-meaning editor may add one — §2 requires
// every read to be BOM-tolerant).
export function readJsonFileSync(filePath: string): unknown {
  let raw = readFileSync(filePath, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw);
}

// The RAW evidence-ledger appender: one JSON record per line. G6 — evidence.ts is
// THE evidence writer, so this primitive is defined here and referenced ONLY by
// state.ts and (later) evidence.ts; no other adapter may name it (a source-scan
// test enforces this).
export function appendLedgerLineRaw(filePath: string, record: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  appendFileSync(filePath, JSON.stringify(record) + "\n");
}

// ---------------------------------------------------------------------------
// The workspace lock, read from outside the store (ISSUE-026)
// ---------------------------------------------------------------------------

// Parse a lock file into a LockRecord, or null when it is absent, unreadable or
// not lock-shaped. Shared by the store's own acquisition path and by the
// out-of-store readers below, so "what a lock file says" has ONE derivation.
function parseLockFile(lockPath: string): LockRecord | null {
  if (!existsSync(lockPath)) return null;
  let parsed: unknown;
  try {
    parsed = readJsonFileSync(lockPath);
  } catch {
    return null;
  }
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    typeof (parsed as { pid?: unknown }).pid === "number" &&
    typeof (parsed as { startMs?: unknown }).startMs === "number"
  ) {
    const rec = parsed as { pid: number; startMs: number; sessionID?: unknown; token?: unknown };
    const out: LockRecord = { pid: rec.pid, startMs: rec.startMs };
    if (typeof rec.sessionID === "string") out.sessionID = rec.sessionID;
    if (typeof rec.token === "string") out.token = rec.token;
    return out;
  }
  return null;
}

// Two lock reads name the SAME acquisition. Token equality when both records carry
// one (the only comparison that survives a recycled pid or a frozen clock), else
// pid+startMs. An absent record matches only an absent record: "the lock file is
// gone" is itself an identity, and it is the one an unreadable-lock break judged.
function sameLockIdentity(a: LockRecord | null, b: LockRecord | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.token !== undefined && b.token !== undefined) return a.token === b.token;
  return a.pid === b.pid && a.startMs === b.startMs;
}

// The filesystem-safe spelling of one lock identity, used to NAME the two files
// that carry out a break. Keying those names on the identity being broken is what
// makes the break a compare-and-delete: a racer holding a different view of the
// lock composes a different name, so it can neither claim the break right for an
// identity it did not read nor collide with the aside of one it did not judge.
function lockIdentityKey(rec: LockRecord | null): string {
  if (rec === null) return "unreadable";
  const raw = rec.token ?? `p${String(rec.pid)}-t${String(rec.startMs)}`;
  return raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}

// Alive iff signal 0 does NOT report ESRCH. EPERM (the pid exists but is not ours)
// and every other error count as alive — a lock is never treated as free unless
// its owner is provably gone.
export function pidIsAlive(checkPid: number): boolean {
  try {
    process.kill(checkPid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

// `<root>/.conductor/state/run.lock` for a run directory `<root>/.conductor/runs/<runId>`.
// The run dir is what the evidence/question writers are handed, and the lock is the
// fact they depend on, so the derivation lives here beside the writer of the lock
// rather than being re-spelled at each ledger.
export function lockPathForRunDir(runDir: string): string {
  return path.join(path.resolve(runDir, "..", ".."), "state", "run.lock");
}

// The workspace lock holder for a run dir, or null when no lock file is present.
export function lockHolderForRunDir(runDir: string): LockRecord | null {
  return parseLockFile(lockPathForRunDir(runDir));
}

/**
 * The cross-process guard a ledger mint runs before it issues a number
 * (ISSUE-026). Single-writer is the primary mechanism — openWorkspace hands out a
 * store only to the process holding the lock — and this is the seam that makes
 * the dependency executable rather than assumed: minting beside a LIVE foreign
 * holder throws, naming the holder, instead of quietly issuing a number that
 * process is about to issue too.
 *
 * A missing lock (a bare run dir, a §3.9 no-git fixture) and a DEAD holder's lock
 * are both permitted: a crash must never make a run unwritable, and the store's
 * own stale-break is what reclaims the workspace.
 */
export function assertWorkspaceLockHeld(runDir: string, pid: number, what: string): void {
  const holder = lockHolderForRunDir(runDir);
  if (holder === null) return;
  if (holder.pid === pid) return;
  if (!pidIsAlive(holder.pid)) return;
  throw new Error(
    "state: refusing to mint " +
      what +
      " in " +
      runDir +
      " — the workspace single-writer lock is held by pid " +
      String(holder.pid) +
      (holder.sessionID === undefined ? "" : ' (session "' + holder.sessionID + '")') +
      ", and two writers minting into one ledger is how a run ships one item's green on another's evidence",
  );
}

// ---------------------------------------------------------------------------
// Path-id trust boundary (F2)
// ---------------------------------------------------------------------------

// Guard every id (runId / itemId) that is composed into a .conductor/ path. ids
// originate in model-driven decomposition, so the store is the trust boundary: an id
// carrying "/", "\", or a ".." segment would let path.join collapse the ".." and escape
// .conductor/. Real ids are simple slugs (r-20260807-a1b2, I1, Q-0001), so we reject
// anything that is not a conservative slug — empty, a path separator, a bare "." / "..",
// a leading "..", or a character outside [A-Za-z0-9._-] — with a clear error naming the
// offending id. Returns the id unchanged so it composes inline in a path builder.
const SAFE_ID = /^[A-Za-z0-9._-]+$/;
export function assertSafeId(id: string, kind: string): string {
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`state: refusing an empty ${kind} — unsafe path id`);
  }
  if (id.includes("/") || id.includes("\\")) {
    throw new Error(`state: refusing ${kind} "${id}" — a path separator would escape .conductor/`);
  }
  if (id === "." || id === ".." || id.startsWith("..")) {
    throw new Error(`state: refusing ${kind} "${id}" — a dot-dot segment would escape .conductor/`);
  }
  if (!SAFE_ID.test(id)) {
    throw new Error(`state: refusing ${kind} "${id}" — not a conservative slug (allowed: A-Za-z0-9 . _ -)`);
  }
  return id;
}

// ---------------------------------------------------------------------------
// .git/info/exclude registration (§1.2 / §3.9)
// ---------------------------------------------------------------------------

// Ensure a single `.conductor/` line in the repository's info/exclude so the
// harness never dirties the target's tracked files with its own presence.
// Idempotent: a second call adds nothing. Returns false and writes nothing when
// <root> is not a git repo (§3.9 no-git mode simply skips the registration).
//
// C-021: the exclude file lives under the COMMON gitdir, resolved through
// `git rev-parse --git-common-dir` (resolved against root when git answers the
// relative ".git") — NEVER composed as <root>/.git/info. In a LINKED worktree
// <root>/.git is a FILE, so the literal composition throws ENOTDIR, and the
// isRepo guard cannot catch it (rev-parse --is-inside-work-tree reports true
// there). The per-worktree gitdir is not the target either: an exclude written
// there is empirically inert — only the common dir's info/exclude takes effect.
export function registerConductorExclude(root: string): boolean {
  if (!isRepo(root)) return false;
  const commonDir = gitCommonDir(root);
  if (commonDir === null) return false;
  const infoDir = path.join(commonDir, "info");
  const excludePath = path.join(infoDir, "exclude");
  mkdirSync(infoDir, { recursive: true });
  let content = "";
  if (existsSync(excludePath)) content = readFileSync(excludePath, "utf8");
  const alreadyPresent = content.split(/\r?\n/).some((line) => line.trim() === ".conductor/");
  if (alreadyPresent) return true;
  let next = content;
  if (next.length > 0 && !next.endsWith("\n")) next += "\n";
  next += ".conductor/\n";
  writeFileAtomicSync(excludePath, next);
  return true;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export function openWorkspace(opts: OpenOptions): StateStore {
  const root = treePath(opts.root);
  const config = opts.config;
  const journal = opts.journal;
  const now = opts.now ?? Date.now;
  const pid = opts.pid ?? process.pid;
  const staleLockMs = opts.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
  // The lock and beacon precede any run, so the correlation triple carries only
  // the session id (runId absent), which the StateJournal permits.
  const corr = { sessionID: opts.sessionID };

  const stateDir = path.join(root, ".conductor", "state");
  const runsDir = path.join(root, ".conductor", "runs");
  const lockPath = path.join(stateDir, "run.lock");
  const currentRunPath = path.join(stateDir, "current-run.json");
  const staleRedPath = path.join(stateDir, "stale-red.json");
  const alivePath = path.join(stateDir, "alive.json");
  const haltPath = path.join(stateDir, "halt");

  // Every builder validates the ids it composes (F2). runJsonPath/itemsDirOf/
  // questionsPath route through runDirOf, so guarding runId there covers them all;
  // itemJsonPath additionally guards the itemId.
  const runDirOf = (runId: string): string => path.join(runsDir, assertSafeId(runId, "runId"));
  const runJsonPath = (runId: string): string => path.join(runDirOf(runId), "run.json");
  const itemsDirOf = (runId: string): string => path.join(runDirOf(runId), "items");
  const itemJsonPath = (runId: string, itemId: string): string =>
    path.join(itemsDirOf(runId), `${assertSafeId(itemId, "itemId")}.json`);
  const questionsPath = (runId: string): string =>
    path.join(runDirOf(runId), "questions.jsonl");

  // --- lock acquisition (GAP-027: one writer, decided by the OS) -----------

  function readExistingLock(): LockRecord | null {
    return parseLockFile(lockPath);
  }

  /**
   * Publish a claim at the lock path, or report that one already stands.
   *
   * The claim is written WHOLE into a same-directory temp file and then published
   * with `link`, which is atomic and refuses to overwrite: the lock file is either
   * absent or complete, never observed mid-write, and exactly one racer's link can
   * win. An exclusive-create-then-write (`{flag:"wx"}`) has neither half of that
   * property — the file exists, EMPTY, from the create until the write lands, and a
   * concurrent opener that reads it in that window sees an unparseable lock, judges
   * it broken, and breaks a live claim. Five real node processes racing one
   * workspace hit exactly that: two writers, one of them holding a lock file
   * another process had already deleted.
   */
  function claimLockFile(record: LockRecord): boolean {
    const temp = `${lockPath}.claim.${String(pid)}.${randomBytes(6).toString("hex")}`;
    writeFileSync(temp, JSON.stringify(record));
    try {
      // R2 guard seam: the whole claim already sits in `temp` and the lock path has not
      // been touched. An atomicity guard inspects both here; production leaves it undefined.
      if (opts.onClaimTempWritten !== undefined) opts.onClaimTempWritten({ temp, lockPath });
      linkSync(temp, lockPath);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      return false;
    } finally {
      rmSync(temp, { force: true });
    }
  }

  /**
   * Break a lock this open has judged stale: an atomic compare-and-delete keyed on
   * the identity that was READ.
   *
   * A bare rename of `run.lock` is not that compare-and-delete, and with three or
   * more racers it is a double-writer generator. Rename moves whatever occupies the
   * path at the instant it runs, not the inode the caller judged: racer A breaks the
   * stale lock and exclusive-creates its own, and a laggard B — still holding its
   * read of the dead lock — renames A's LIVE lock aside and drops it, leaving A
   * convinced it holds a workspace whose lock file belongs to somebody else. Two
   * parties never expose this: the loser's rename simply fails on a path nobody
   * recreated. Real 4-process races produced concurrent writers in 12 of 25 runs.
   *
   * The break therefore runs in three parts, all keyed on identity X = the record
   * this open read:
   *
   *   1. EXCLUSIVE BREAK RIGHT — an O_EXCL create of `run.lock.break.<X>`. The name
   *      encodes X, so exactly one racer per identity may attempt the removal, and a
   *      racer that read a DIFFERENT identity is not blocked by it (it will fail on
   *      the re-read below instead, which is the outcome it deserves).
   *   2. RE-READ UNDER THE RIGHT — the lock file must STILL carry X. Once X has been
   *      broken it can never reappear (identities are minted per acquisition), so
   *      seeing X here proves no break of X has completed, which in turn proves the
   *      inode about to be moved is X's. A laggard whose view is stale reads
   *      somebody else's live lock here and returns without touching a byte.
   *   3. MOVE, VERIFY, DELETE — rename X aside under an X-keyed name and confirm the
   *      moved file is X before deleting it. If an over-age holder released and a
   *      successor claimed inside that window, the aside is put back with `link`,
   *      which REFUSES to overwrite an existing lock, rather than with a rename,
   *      which would clobber the successor's claim.
   *
   * `expected` is null when the judgment was made on an UNPARSEABLE lock file; a
   * file that still does not parse is then the one that was judged.
   *
   * Returns true only when the lock removed is the stale one this open judged.
   */
  // Create the break right atomically AND exclusively: the whole record is written
  // to a same-dir temp and then linked into place. linkSync refuses to overwrite (so
  // exactly one racer per identity wins the right — the O_EXCL property the bare
  // `{flag:"wx"}` create had) and publishes the file WHOLE (so a concurrent opener
  // that inspects the right never reads a present-but-empty file and mistakes a live
  // mid-create for an orphan — the property `{flag:"wx"}` did NOT have, and the seam
  // the reclaim below would otherwise race against). Returns false on EEXIST.
  function createBreakRight(breakRight: string, record: unknown): boolean {
    const temp = `${breakRight}.mint.${String(pid)}.${randomBytes(6).toString("hex")}`;
    writeFileSync(temp, JSON.stringify(record));
    try {
      linkSync(temp, breakRight);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      return false;
    } finally {
      rmSync(temp, { force: true });
    }
  }

  // Is an existing break right an ORPHAN this open may reclaim — as opposed to a
  // live breaker's exclusive right, which must NOT be stolen? Two grounds, both
  // fail-safe: a break right whose breaker pid is provably gone (its removal of the
  // identity can never follow — an identity is minted once per acquisition — yet the
  // identity is stuck at the lock path, so the "identity has left" clear can never
  // fire), and an over-age right (a recycled breaker pid that happens to be alive, or
  // a right missing its breaker pid, must not wedge the workspace forever). Age is
  // measured on the SAME injected-clock idiom as the stale-lock rule: `now()` minus the
  // right's own stamped startMs, never the wall clock or a file mtime.
  function breakRightIsReclaimable(breakRight: string): boolean {
    let rec: { breakerPid?: unknown; startMs?: unknown };
    try {
      rec = readJsonFileSync(breakRight) as { breakerPid?: unknown; startMs?: unknown };
    } catch {
      // Gone (a racer cleared it) — nothing to reclaim; the caller retries. With
      // atomic creation a present right is never empty, so this is "absent", not
      // "being born", and returning false does not risk stealing a live mid-create.
      return false;
    }
    if (typeof rec.breakerPid === "number" && !pidIsAlive(rec.breakerPid)) return true;
    if (typeof rec.startMs === "number" && now() - rec.startMs > staleLockMs) return true;
    return false;
  }

  function breakStaleLock(expected: LockRecord | null): boolean {
    const key = lockIdentityKey(expected);
    const breakRight = `${lockPath}.break.${key}`;
    const aside = `${lockPath}.stale.${key}`;
    if (!createBreakRight(breakRight, { breakerPid: pid, key, startMs: now() })) {
      // A break right for this identity already stands. It must resolve, never wedge:
      //   (a) its identity has LEFT the lock path — no removal of it can ever follow,
      //       so a right abandoned by a breaker that died mid-break protects nothing
      //       and is cleared here; OR
      //   (b) its identity is STILL at the lock path but the right is an ORPHAN (its
      //       breaker is provably gone, or it is over-age). A dead-pid lock plus an
      //       orphan right would otherwise wedge EVERY later opener forever, because
      //       the clear in (a) can never fire while the identity is stuck at the path.
      // A right held by a LIVE breaker matches neither and is respected, not stolen.
      if (!sameLockIdentity(readExistingLock(), expected) || breakRightIsReclaimable(breakRight)) {
        rmSync(breakRight, { force: true });
      }
      return false;
    }
    try {
      if (!sameLockIdentity(readExistingLock(), expected)) return false;
      // "No record" is the one judgement that is not an identity: an absent lock
      // file can become a live claim a microsecond later, where a real identity,
      // once broken, never returns. So an absent path is not broken at all — the
      // caller's exclusive create is the correct move against it — and only a file
      // that is genuinely present and unreadable is removed under this key.
      if (expected === null && !existsSync(lockPath)) return false;
      try {
        renameSync(lockPath, aside);
      } catch {
        return false;
      }
      const moved = parseLockFile(aside);
      if (!sameLockIdentity(moved, expected)) {
        try {
          linkSync(aside, lockPath); // refuses to displace a claim that already stands
        } catch {
          /* a live claim occupies the path: the aside is ours to discard */
        }
        rmSync(aside, { force: true });
        return false;
      }
      rmSync(aside, { force: true });
      return true;
    } finally {
      rmSync(breakRight, { force: true });
    }
  }

  /**
   * Take the workspace's single-writer lock, or REFUSE (owner decision D6).
   *
   * The claim is published atomically and exclusively by claimLockFile — the OS
   * decides the winner, so two cold starts cannot both become writers. A foreign
   * lock is
   * honored unless its owner is provably gone (dead pid) or it is over-age (a
   * recycled pid must never wedge a workspace forever); a stale one is broken by
   * the identity-keyed compare-and-delete above and the claim retried. A LIVE young
   * holder ends the open: this process gets no store at all, rather than a demoted
   * one whose write guards cover a fraction of the store's mutating surface
   * (ISSUE-023).
   *
   * A won publication is not yet a held lock. The definitive single-writer check is
   * the SELF-VERIFY that follows it: the lock file on disk must carry this claim's
   * own token. Winning the exclusive publication says only that the path was free at
   * that instant; being the identity the path names is what makes this process the
   * writer, and any
   * displacement — a break that judged this claim, a fixture, a stray write — is
   * caught here rather than one ledger mint later.
   *
   * The retry budget is bounded: each pass either claims, refuses, or removes one
   * identity from play, and a workspace with a handful of racers converges inside
   * it. Exhausting it is itself a refusal, never a silent claim.
   */
  function acquireLock(): LockRecord {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const startMs = now();
      const record: LockRecord = {
        pid,
        startMs,
        sessionID: opts.sessionID,
        token: randomBytes(12).toString("hex"),
      };
      if (attempt === 0 && opts.onBeforeFreshLockWrite !== undefined) opts.onBeforeFreshLockWrite();
      const created = claimLockFile(record);
      if (created) {
        if (opts.onAfterFreshLockWrite !== undefined) opts.onAfterFreshLockWrite();
        if (sameLockIdentity(readExistingLock(), record)) {
          journal.log("info", "state", "lock.acquired", { pid, startMs }, corr);
          return record;
        }
        // The claim was displaced between the create and this read. Whoever the
        // lock names is the writer; this process re-decides against it.
        journal.log(
          "warn",
          "state",
          "lock.contended",
          { pid, startMs, displaced: true },
          corr,
        );
        continue;
      }

      const existing = readExistingLock();
      if (existing !== null && existing.pid === pid) {
        // Our OWN lock (an idempotent re-open): adopt it as it stands. Rewriting it
        // would move the startMs the over-age rule is measured from.
        journal.log(
          "info",
          "state",
          "lock.acquired",
          { pid, startMs: existing.startMs, reopened: true },
          corr,
        );
        return existing;
      }

      // An unparseable lock file is not evidence of a live holder, and it is not
      // evidence of a dead one either — it is broken, and breaking it is the only
      // way the workspace becomes usable again.
      const alive = existing !== null && pidIsAlive(existing.pid);
      const overAge = existing !== null && startMs - existing.startMs > staleLockMs;
      if (existing !== null && alive && !overAge) {
        journal.log(
          "warn",
          "state",
          "lock.contended",
          {
            holderPid: existing.pid,
            holderStartMs: existing.startMs,
            ...(existing.sessionID === undefined ? {} : { holderSessionID: existing.sessionID }),
          },
          corr,
        );
        throw workspaceLockedError(root, existing);
      }

      journal.log(
        "warn",
        "state",
        "lock.stale-break",
        existing === null
          ? { reason: "unreadable" }
          : {
              brokenPid: existing.pid,
              brokenStartMs: existing.startMs,
              reason: alive ? "over-age" : "dead-pid",
            },
        corr,
      );
      if (opts.onBeforeStaleClaim !== undefined) opts.onBeforeStaleClaim({ attempt, judged: existing });
      breakStaleLock(existing);
      // Whether the break succeeded or a racer got there first, the next iteration
      // re-decides against what is actually on disk.
    }
    // Budget exhausted WITHOUT a claim. This is not the live-young-holder refusal
    // (that returns from inside the loop above): the lock could not be reclaimed,
    // which a dead-pid lock behind a stuck break right can cause. Name the real
    // artifact rather than asserting a possibly-dead pid is a live conductor.
    const holder = readExistingLock();
    throw workspaceUnreclaimableError(root, holder);
  }

  // --- stale-red registry (§2.11) -----------------------------------------

  function readStaleRed(): StaleRedRegistry {
    if (!existsSync(staleRedPath)) return { version: 1, entries: [] };
    let parsed: unknown;
    try {
      parsed = readJsonFileSync(staleRedPath);
    } catch {
      return { version: 1, entries: [] };
    }
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as { version?: unknown }).version === "number" &&
      Array.isArray((parsed as { entries?: unknown }).entries)
    ) {
      return parsed as StaleRedRegistry;
    }
    return { version: 1, entries: [] };
  }

  function writeStaleRed(registry: StaleRedRegistry): void {
    const result = validate("StaleRedRegistry", registry);
    if (!result.ok) {
      throw new Error("state: refusing to write an invalid stale-red registry: " + result.errors.join("; "));
    }
    writeFileAtomicSync(staleRedPath, JSON.stringify(registry, null, 2));
  }

  function addStaleRed(entry: StaleRedRegistry["entries"][number]): StaleRedRegistry {
    const current = readStaleRed();
    // Upsert by path so a re-registered file never accumulates duplicate entries.
    const entries = current.entries.filter((e) => e.path !== entry.path);
    entries.push(entry);
    const next: StaleRedRegistry = { version: current.version, entries };
    writeStaleRed(next);
    return next;
  }

  function removeStaleRed(entryPath: string): StaleRedRegistry {
    const current = readStaleRed();
    const next: StaleRedRegistry = {
      version: current.version,
      entries: current.entries.filter((e) => e.path !== entryPath),
    };
    writeStaleRed(next);
    return next;
  }

  // --- run lifecycle ------------------------------------------------------

  // Mint a unique run id `r-<yyyymmdd>-<4hex>`, retrying on the (astronomically
  // unlikely) collision with an existing run dir so ids are unique on disk even
  // when several runs are minted under a single pinned clock value.
  function mintRunId(nowMs: number): string {
    const d = new Date(nowMs);
    const datePart =
      `${d.getUTCFullYear()}` +
      `${String(d.getUTCMonth() + 1).padStart(2, "0")}` +
      `${String(d.getUTCDate()).padStart(2, "0")}`;
    let id = `r-${datePart}-${randomBytes(2).toString("hex")}`;
    while (existsSync(runDirOf(id))) {
      id = `r-${datePart}-${randomBytes(2).toString("hex")}`;
    }
    return id;
  }

  function readCurrentPointer(): { runId: string } | null {
    if (!existsSync(currentRunPath)) return null;
    let parsed: unknown;
    try {
      parsed = readJsonFileSync(currentRunPath);
    } catch {
      return null;
    }
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as { runId?: unknown }).runId === "string"
    ) {
      return { runId: (parsed as { runId: string }).runId };
    }
    return null;
  }

  function setCurrentRun(runId: string | null): void {
    writeFileAtomicSync(currentRunPath, JSON.stringify(runId === null ? null : { runId }));
  }

  // Prune runs/ to config.retention.keepRuns, removing the OLDEST (by createdIso)
  // first and NEVER touching the live run just created. Run dirs without a
  // readable run.json are skipped rather than ordered blindly.
  function pruneRuns(liveRunId: string): void {
    if (!config.retention.pruneOnRunCreate) return;
    const keepRuns = config.retention.keepRuns;
    if (!existsSync(runsDir)) return;
    const ordered: Array<{ name: string; createdIso: string }> = [];
    for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rjPath = path.join(runsDir, entry.name, "run.json");
      if (!existsSync(rjPath)) continue;
      try {
        const run = readJsonFileSync(rjPath) as Run;
        ordered.push({ name: entry.name, createdIso: run.createdIso });
      } catch {
        continue; // an unreadable run.json cannot be ordered, so it is left alone
      }
    }
    ordered.sort((a, b) =>
      a.createdIso < b.createdIso ? -1 : a.createdIso > b.createdIso ? 1 : 0,
    );
    let toRemove = ordered.length - keepRuns;
    for (const entry of ordered) {
      if (toRemove <= 0) break;
      if (entry.name === liveRunId) continue; // the live run is never a prune target
      rmSync(path.join(runsDir, entry.name), { recursive: true, force: true });
      toRemove -= 1;
    }
  }

  function createRun(input: CreateRunInput, opts?: { onAfterRunJson?: () => void }): Run {
    // Git provenance (§2.3). No-git mode (§3.9) coerces every absent term to the
    // Run's non-null string/[] types — the HEAD term is simply dropped, no throw.
    let startHead = "";
    let startBranch = "";
    let startDirty: string[] = [];
    if (isRepo(root)) {
      startHead = headSha(root) ?? "";
      startBranch = currentBranch(root) ?? "";
      const dirty = dirtyFiles(root);
      startDirty = [...dirty.trackedModified, ...dirty.untracked];
    }
    const registry = readStaleRed();
    const nowMs = now();
    const runId = mintRunId(nowMs);
    const run: Run = {
      runId,
      createdIso: new Date(nowMs).toISOString(),
      prompt: input.prompt,
      sessionID: input.sessionID,
      state: "INTAKE",
      classification: input.classification,
      startHead,
      startBranch,
      startDirty,
      excludedStaleRed: registry.entries.map((e) => e.path),
      planReviewRounds: 0,
      stop: null,
      counters: { idleRePrompts: 0, futileRePrompts: 0, overridesUsed: 0 },
    };
    // Write run.json FIRST, then the items/ dir (F5). A crash after mkdir(items) but
    // before run.json would leave an orphan run dir with no run.json — and pruneRuns
    // skips any dir lacking a readable run.json, so it could never be reclaimed. Writing
    // run.json first means any dir a crash leaves behind carries a run.json and is prunable.
    saveRun(run);
    // Test seam: a throw here simulates a crash AFTER run.json and BEFORE items/ is created.
    if (opts?.onAfterRunJson !== undefined) opts.onAfterRunJson();
    mkdirSync(itemsDirOf(runId), { recursive: true });
    setCurrentRun(runId);
    pruneRuns(runId);
    return run;
  }

  function loadRun(runId: string): Run {
    return readJsonFileSync(runJsonPath(runId)) as Run;
  }

  function saveRun(run: Run): void {
    const result = validate("Run", run);
    if (!result.ok) {
      throw new Error("state: refusing to write an invalid run.json: " + result.errors.join("; "));
    }
    writeFileAtomicSync(runJsonPath(run.runId), JSON.stringify(run, null, 2));
  }

  function currentRun(): Run | null {
    const ptr = readCurrentPointer();
    if (ptr === null) return null;
    if (!existsSync(runJsonPath(ptr.runId))) return null;
    return loadRun(ptr.runId);
  }

  function archiveRun(runId: string): void {
    // Clear the current-run pointer if it names this run; the run dir itself is
    // left readable on disk (archiving is not deletion).
    const ptr = readCurrentPointer();
    if (ptr !== null && ptr.runId === runId) setCurrentRun(null);
  }

  // archiveRun's named inverse (ISSUE-066). A run that stopped waiting on a human
  // has its pointer cleared, so the work it committed is unreachable to every
  // subsequent pass even after the human answers. Re-pointing is a pointer write
  // and nothing else: run.json is untouched here, so the caller stays the sole
  // authority on whether the run is revivable at all.
  function resumeRun(runId: string): void {
    if (!existsSync(runJsonPath(runId))) {
      throw new Error(`state: cannot resume run "${runId}" — no run.json on disk`);
    }
    setCurrentRun(runId);
  }

  // --- item CRUD + dispositions -------------------------------------------

  function loadItem(runId: string, itemId: string): Item {
    return readJsonFileSync(itemJsonPath(runId, itemId)) as Item;
  }

  function saveItem(runId: string, item: Item): void {
    const result = validate("Item", item);
    if (!result.ok) {
      throw new Error("state: refusing to write an invalid item.json: " + result.errors.join("; "));
    }
    writeFileAtomicSync(itemJsonPath(runId, item.id), JSON.stringify(item, null, 2));
  }

  // Retire an item the queue no longer names (conductor_queue_amend's `remove`). An
  // item file with no queue entry is an orphan that a later amendment re-adding the
  // same id would RESURRECT, handing the reborn item another run's state, evidence
  // and attempts. Absent is not an error: the caller's job is that the file is gone.
  function removeItem(runId: string, itemId: string): void {
    rmSync(itemJsonPath(runId, itemId), { force: true });
  }

  function setBlocked(
    runId: string,
    itemId: string,
    input: { reason: string; stage: string; questionId?: string },
  ): Item {
    const item = loadItem(runId, itemId);
    item.blocked = {
      reason: input.reason,
      sinceMs: now(),
      stage: input.stage,
      ...(input.questionId !== undefined ? { questionId: input.questionId } : {}),
    };
    saveItem(runId, item);
    return item;
  }

  // Clearing the §2.5 `blocked` annotation is the ONE moment at which the item knows
  // which question it was released from — the next reader sees only `blocked: null`,
  // which is also what a half-applied blockAndAsk leaves behind (C-032 E7). So the
  // release is written down here, in the item's own durable record, rather than left
  // to be inferred later from file timestamps that a replay, a backup restore or a
  // copy would destroy. Recorded once per question: a second release under the same
  // reused question adds nothing to the history that is not there already.
  function clearBlocked(runId: string, itemId: string): Item {
    const item = loadItem(runId, itemId);
    const questionId = item.blocked?.questionId;
    if (questionId !== undefined) {
      const released = item.releasedQuestions ?? [];
      if (!released.includes(questionId)) item.releasedQuestions = [...released, questionId];
    }
    item.blocked = null;
    saveItem(runId, item);
    return item;
  }

  function setDeferred(
    runId: string,
    itemId: string,
    input: { reason: string; decisionId: string },
  ): Item {
    const item = loadItem(runId, itemId);
    item.deferred = { reason: input.reason, decisionId: input.decisionId };
    saveItem(runId, item);
    return item;
  }

  function setDebugging(runId: string, itemId: string, input: { hypothesis: string }): Item {
    const item = loadItem(runId, itemId);
    item.debugging = { sinceMs: now(), hypothesis: input.hypothesis };
    saveItem(runId, item);
    return item;
  }

  // Count unanswered questions (answeredIso === null), coalescing the ledger by
  // id so an answer appended for an existing id does not double-count.
  function countOpenQuestions(runId: string): number {
    const qp = questionsPath(runId);
    if (!existsSync(qp)) return 0;
    let raw = readFileSync(qp, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const byId = new Map<string, { answeredIso: string | null }>();
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let record: { id?: unknown; answeredIso?: unknown };
      try {
        record = JSON.parse(trimmed) as { id?: unknown; answeredIso?: unknown };
      } catch {
        continue;
      }
      if (typeof record.id === "string") {
        byId.set(record.id, {
          answeredIso: typeof record.answeredIso === "string" ? record.answeredIso : null,
        });
      }
    }
    let open = 0;
    for (const record of byId.values()) {
      if (record.answeredIso === null) open += 1;
    }
    return open;
  }

  function itemsSummary(runId: string): {
    open: number;
    blocked: number;
    deferred: number;
    surfacedQuestions: number;
  } {
    let open = 0;
    let blocked = 0;
    let deferred = 0;
    const dir = itemsDirOf(runId);
    if (existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".json")) continue;
        let item: Item;
        try {
          item = readJsonFileSync(path.join(dir, name)) as Item;
        } catch {
          continue;
        }
        const isBlocked = item.blocked !== null && item.blocked !== undefined;
        const isDeferred = item.deferred !== null && item.deferred !== undefined;
        if (isBlocked) blocked += 1;
        if (isDeferred) deferred += 1;
        // §2.5: open iff state !== PUBLISHED && blocked === null && deferred === null.
        if (item.state !== "PUBLISHED" && !isBlocked && !isDeferred) open += 1;
      }
    }
    return { open, blocked, deferred, surfacedQuestions: countOpenQuestions(runId) };
  }

  // --- beacon / halt / release --------------------------------------------

  function readBeacon(): Beacon | null {
    if (!existsSync(alivePath)) return null;
    try {
      return readJsonFileSync(alivePath) as Beacon;
    } catch {
      return null;
    }
  }

  function isHalted(): boolean {
    return existsSync(haltPath);
  }

  function release(): void {
    // ISSUE-025: delete the lock only when it is still OURS. A session whose lock
    // was legitimately over-age-broken finds a SUCCESSOR's lock at the same path,
    // and removing that would hand the workspace to a third writer while the
    // successor is still working in it. Identity is this claim's own token, and
    // pid+startMs for a lock minted without one: a recycled pid alone would pass
    // this check, and under an injected clock so would pid+startMs.
    const current = readExistingLock();
    if (current === null) return;
    if (!sameLockIdentity(current, held)) {
      journal.log(
        "warn",
        "state",
        "lock.contended",
        { holderPid: current.pid, holderStartMs: current.startMs, releasedBy: pid, retained: true },
        corr,
      );
      return;
    }
    rmSync(lockPath, { force: true });
    journal.log("info", "state", "lock.released", { pid }, corr);
  }

  // --- init sequence (§3.9 exclude, single-writer lock, §3.8 beacon) ------

  mkdirSync(stateDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });

  registerConductorExclude(root);

  // The lock FIRST, the beacon second (ISSUE-023). §3.8's beacon answers "which
  // conductor is live in this workspace"; written before the lock is won it named
  // whichever process opened last, including one that was about to be refused.
  const held = acquireLock();

  const priorBeacon = readBeacon();
  const beacon: Beacon = { pid, startMs: now(), version: opts.version, sessionID: opts.sessionID };
  writeFileAtomicSync(alivePath, JSON.stringify(beacon, null, 2));

  return {
    priorBeacon,
    root,
    createRun,
    loadRun,
    saveRun,
    currentRun,
    archiveRun,
    resumeRun,
    loadItem,
    saveItem,
    removeItem,
    setBlocked,
    clearBlocked,
    setDeferred,
    setDebugging,
    itemsSummary,
    readStaleRed,
    addStaleRed,
    removeStaleRed,
    readBeacon,
    isHalted,
    release,
  };
}
