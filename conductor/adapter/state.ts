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
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

import { currentBranch, dirtyFiles, headSha, isRepo } from "./gitio.ts";
import { validate } from "../core/types.ts";
import type { Config, Item, Run, StaleRedRegistry } from "../core/types.ts";

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
  // THE clock the store reads for every stamped timestamp; defaults to Date.now.
  now?: () => number;
  pid?: number; // defaults to process.pid; names the temp files and the lock owner
  staleLockMs?: number; // over-age lock threshold; defaults to 24h
}

// .conductor/state/run.lock — the advisory single-writer lock.
export interface LockRecord {
  pid: number;
  startMs: number;
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
  readonly readOnly: boolean;
  readonly root: string;
  createRun(input: CreateRunInput): Run;
  loadRun(runId: string): Run;
  saveRun(run: Run): void;
  currentRun(): Run | null;
  archiveRun(runId: string): void;
  loadItem(runId: string, itemId: string): Item;
  saveItem(runId: string, item: Item): void;
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
// .git/info/exclude registration (§1.2 / §3.9)
// ---------------------------------------------------------------------------

// Ensure a single `.conductor/` line in <root>/.git/info/exclude so the harness
// never dirties the target's tracked files with its own presence. Idempotent: a
// second call adds nothing. Returns false and writes nothing when <root> is not a
// git repo (§3.9 no-git mode simply skips the registration).
export function registerConductorExclude(root: string): boolean {
  if (!isRepo(root)) return false;
  const infoDir = path.join(root, ".git", "info");
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
  const root = opts.root;
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

  let readOnly = false;

  const runDirOf = (runId: string): string => path.join(runsDir, runId);
  const runJsonPath = (runId: string): string => path.join(runDirOf(runId), "run.json");
  const itemsDirOf = (runId: string): string => path.join(runDirOf(runId), "items");
  const itemJsonPath = (runId: string, itemId: string): string =>
    path.join(itemsDirOf(runId), `${itemId}.json`);
  const questionsPath = (runId: string): string =>
    path.join(runDirOf(runId), "questions.jsonl");

  // --- lock acquisition ---------------------------------------------------

  function readExistingLock(): LockRecord | null {
    if (!existsSync(lockPath)) return null;
    let parsed: unknown;
    try {
      parsed = readJsonFileSync(lockPath);
    } catch {
      return null; // an unparseable lock is treated as absent and freshly claimed
    }
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as { pid?: unknown }).pid === "number" &&
      typeof (parsed as { startMs?: unknown }).startMs === "number"
    ) {
      const rec = parsed as { pid: number; startMs: number };
      return { pid: rec.pid, startMs: rec.startMs };
    }
    return null;
  }

  // Alive iff signal 0 does NOT report ESRCH. EPERM (exists, not ours) and any
  // other error are treated as alive — the over-age check is the independent
  // safety net that breaks a crashed owner's lock, so we never steal a lock we
  // cannot prove is dead.
  function isAlive(checkPid: number): boolean {
    try {
      process.kill(checkPid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code !== "ESRCH";
    }
  }

  function acquireLock(): boolean {
    const startMs = now();
    const existing = readExistingLock();
    if (existing === null || existing.pid === pid) {
      writeFileAtomicSync(lockPath, JSON.stringify({ pid, startMs }));
      journal.log("info", "state", "lock.acquired", { pid, startMs }, corr);
      return false;
    }
    const alive = isAlive(existing.pid);
    const overAge = startMs - existing.startMs > staleLockMs;
    if (!alive || overAge) {
      // A dead pid or an over-age lock is stale — an opencode crash must never
      // wedge a workspace, so we break it and claim the single-writer lock. The
      // break is journaled as lock.stale-break (the anomaly trace) carrying the
      // broken owner's pid.
      journal.log(
        "warn",
        "state",
        "lock.stale-break",
        { brokenPid: existing.pid, brokenStartMs: existing.startMs, reason: alive ? "over-age" : "dead-pid" },
        corr,
      );
      writeFileAtomicSync(lockPath, JSON.stringify({ pid, startMs }));
      return false;
    }
    // A LIVE foreign lock (a second opencode session on this workspace): drop to
    // read-only conductor, journal a LOUD warning, and leave the lock intact —
    // never stolen (§4.1 second-session rule).
    journal.log(
      "warn",
      "state",
      "lock.contended",
      { holderPid: existing.pid, holderStartMs: existing.startMs },
      corr,
    );
    return true;
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

  function createRun(input: CreateRunInput): Run {
    if (readOnly) {
      throw new Error(
        "state: this conductor is read-only (a live foreign lock holds the workspace); cannot create a run",
      );
    }
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
    mkdirSync(itemsDirOf(runId), { recursive: true });
    saveRun(run);
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

  function clearBlocked(runId: string, itemId: string): Item {
    const item = loadItem(runId, itemId);
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
    // Only a writer releases its own lock; a read-only instance never held one,
    // so it must not delete the live foreign lock it observed.
    if (readOnly) return;
    if (existsSync(lockPath)) rmSync(lockPath, { force: true });
    journal.log("info", "state", "lock.released", { pid }, corr);
  }

  // --- init sequence (§3.8 beacon, §3.9 exclude, single-writer lock) ------

  mkdirSync(stateDir, { recursive: true });
  mkdirSync(runsDir, { recursive: true });

  const beacon: Beacon = { pid, startMs: now(), version: opts.version, sessionID: opts.sessionID };
  writeFileAtomicSync(alivePath, JSON.stringify(beacon, null, 2));

  registerConductorExclude(root);

  readOnly = acquireLock();

  return {
    readOnly,
    root,
    createRun,
    loadRun,
    saveRun,
    currentRun,
    archiveRun,
    loadItem,
    saveItem,
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
