// conductor/adapter/quarantine.ts — Task 6.1 (§4.2 quarantine lifecycle): the
// OUT-OF-REPO move-aside/restore of the foreign red set, with a crash-safe
// manifest that replays pending restores after a mid-verify kill.
//
// An ADAPTER (G14): it does filesystem I/O only — node:fs / node:path, plus the
// crash-safe primitive writeFileAtomicSync from adapter/state.ts. It runs under
// BOTH the opencode runtime and Node type-stripping, so it uses only cross-runtime
// built-ins: no single-runtime global, no shell tag, no single-runtime import (the purity guard scans it).
// It is NOT the evidence writer, so it never touches the evidence ledger.
//
// Why "outside the repository" is load-bearing (§4.2, plan 1590-1596): the verify
// command is the target repo's own whole-tree test runner (node --test / pytest /
// go / ctest). A red test parked anywhere INSIDE the repo is still on a collected
// path — correctness comes from the file being outside the walked tree, reached by
// a RENAME (not a copy) so its mtime survives and §2.6 freshness is not perturbed.
//
// Crash-safety: the manifest is written BEFORE any file moves, so a kill at any
// point leaves a manifest that names every planned move; the next run replays the
// pending restores (mirroring the stale-marker healing), reading the manifest's OWN
// repoRoot/quarantineDir because recovery may happen in a different process.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
} from "node:fs";
import * as path from "node:path";

import { assertSafeId, writeFileAtomicSync } from "./state.ts";

const MANIFEST_VERSION = 1;
const MANIFEST_NAME = "manifest.json";

// ---------------------------------------------------------------------------
// Crash/sandbox-safe primitives
// ---------------------------------------------------------------------------

/**
 * Move `src` to `dst` preserving the mtime (§2.6 freshness invariant). A plain
 * renameSync is atomic and mtime-preserving on ONE filesystem, but the quarantine
 * dir lives under $stateHome (the home volume) while the repo may be a different
 * mount — so renameSync throws EXDEV across volumes. On EXDEV (and only EXDEV) fall
 * back to copy + explicit mtime restore + unlink, so the moved file keeps the
 * ORIGINAL's mtime. `rename` is injectable so the EXDEV branch is testable without a
 * second real filesystem.
 */
export function moveFilePreservingMtime(
  src: string,
  dst: string,
  rename: (from: string, to: string) => void = renameSync,
): void {
  try {
    rename(src, dst);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
  }
  // Cross-filesystem fallback: stat the original FIRST (it still exists), copy the
  // bytes, stamp the copy with the original atime/mtime, then remove the original.
  const st = statSync(src);
  copyFileSync(src, dst);
  utimesSync(dst, st.atime, st.mtime);
  unlinkSync(src);
}

// Alive iff signal 0 does not report ESRCH; EPERM (exists, not ours) counts alive —
// the same process.kill(pid,0) check state.ts uses for lock owners.
function pidAlive(checkPid: number): boolean {
  try {
    process.kill(checkPid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

// A repo-relative quarantine target must never be absolute or contain a ".." segment:
// an absolute path or a ".." would let a poisoned excludeTestFiles entry move a file
// from OUTSIDE the repo (or restore one to an arbitrary location). Reject both.
function assertSafeRelPath(rel: string): void {
  if (typeof rel !== "string" || rel.length === 0) {
    throw new Error("quarantine: refusing an empty file path — unsafe quarantine target");
  }
  if (path.isAbsolute(rel)) {
    throw new Error(`quarantine: refusing absolute path "${rel}" — quarantine targets must be repo-relative`);
  }
  const segments = rel.split(/[\\/]/);
  if (segments.some((seg) => seg === "..")) {
    throw new Error(`quarantine: refusing "${rel}" — a ".." segment escapes the repository`);
  }
}

// True iff `p` exists AND is a directory (a vanished repoRoot must not be recreated).
function existsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Types (pinned by conductor/tests/quarantine.test.ts)
// ---------------------------------------------------------------------------

export interface QuarantineManifestEntry {
  /** The repo-relative path the file was moved FROM (and will be restored TO). */
  original: string;
  /** The name the file is physically stored under, relative to the quarantine dir. */
  stored: string;
  /** True once this entry has been renamed back into the repo. */
  restored: boolean;
}

export interface QuarantineManifest {
  version: number;
  runId: string;
  /** The repository root to restore into — the source of truth on replay. */
  repoRoot: string;
  /** The out-of-repo directory the files were moved to. */
  quarantineDir: string;
  /**
   * The pid of the run that owns this quarantine. Replay heals a manifest ONLY when
   * its owner is NOT alive — a live owner is an in-flight verify, not a crashed
   * orphan, and stealing its files back mid-verify would corrupt the running verify.
   */
  pid: number;
  /** Wall-clock start of the owning run (informational / parity with the lock). */
  startMs: number;
  entries: QuarantineManifestEntry[];
}

export interface QuarantineHandle {
  manifestPath: string;
  quarantineDir: string;
  entries: QuarantineManifestEntry[];
}

export interface QuarantineInput {
  repoRoot: string;
  files: string[];
  stateHome: string;
  workspaceKey: string;
  runId: string;
  /** The owning run's pid (defaults to process.pid) — stamped into the manifest. */
  pid?: number;
  /** The owning run's start (defaults to Date.now()) — stamped into the manifest. */
  startMs?: number;
}

// ---------------------------------------------------------------------------
// The §4.2 out-of-repo location
// ---------------------------------------------------------------------------

/**
 * `<stateHome>/conductor/<workspaceKey>/quarantine/<runId>` — the directory the
 * foreign red set is moved to. `stateHome` is never inside the repository, so the
 * result escapes the repo subtree and no whole-tree runner can reach a moved file.
 */
export function quarantineDirFor(stateHome: string, workspaceKey: string, runId: string): string {
  // §F3 trust boundary: workspaceKey and runId compose a path under $stateHome that is
  // later rmSync(recursive)'d — a traversing id (e.g. "../../etc") would target an
  // arbitrary tree. Reject anything that is not a conservative slug (reuses state.ts).
  assertSafeId(workspaceKey, "workspaceKey");
  assertSafeId(runId, "runId");
  return path.join(stateHome, "conductor", workspaceKey, "quarantine", runId);
}

// ---------------------------------------------------------------------------
// Move aside
// ---------------------------------------------------------------------------

// Flatten a repo-relative path to a single stored name so nested paths neither
// collide nor require re-creating their directory tree under the quarantine dir.
function flatten(rel: string): string {
  return rel.split(path.sep).join("/").split("/").join("__");
}

/**
 * Move each repo-relative `files` entry OUT of the repository into the §4.2
 * quarantine dir by RENAME (mtime-preserving). The manifest is written FIRST — a
 * crash between the manifest write and any move leaves a replayable record — then
 * the files are moved. Returns the handle the completing verify restores with.
 */
export function quarantineFiles(input: QuarantineInput): QuarantineHandle {
  const { repoRoot, files, stateHome, workspaceKey, runId } = input;
  // §F3: reject any target that is absolute or climbs out of the repo BEFORE creating
  // the quarantine dir, so a poisoned excludeTestFiles entry (e.g. "../x") moves nothing.
  for (const original of files) assertSafeRelPath(original);
  const quarantineDir = quarantineDirFor(stateHome, workspaceKey, runId);
  mkdirSync(quarantineDir, { recursive: true });
  const manifestPath = path.join(quarantineDir, MANIFEST_NAME);

  const entries: QuarantineManifestEntry[] = [];
  const usedStored = new Set<string>();
  for (const original of files) {
    const base = flatten(original);
    let stored = base;
    let n = 1;
    while (usedStored.has(stored)) {
      stored = `${base}.${n}`;
      n += 1;
    }
    usedStored.add(stored);
    entries.push({ original, stored, restored: false });
  }

  const manifest: QuarantineManifest = {
    version: MANIFEST_VERSION,
    runId,
    repoRoot,
    quarantineDir,
    // §F4: stamp the owning run so replay can tell a live verify from a crashed orphan.
    pid: input.pid ?? process.pid,
    startMs: input.startMs ?? Date.now(),
    entries,
  };

  // Manifest BEFORE the moves (crash-safe), then move each file OUT (mtime-preserving,
  // EXDEV-tolerant). A mid-quarantine failure rolls the partial moves back so the repo
  // is never left with half its foreign red set stranded outside the tree (§F1).
  writeFileAtomicSync(manifestPath, JSON.stringify(manifest, null, 2));
  const moved: QuarantineManifestEntry[] = [];
  try {
    for (const entry of entries) {
      const src = path.join(repoRoot, entry.original);
      const dst = path.join(quarantineDir, entry.stored);
      mkdirSync(path.dirname(dst), { recursive: true });
      moveFilePreservingMtime(src, dst);
      moved.push(entry);
    }
  } catch (err) {
    // Heal what moved (restore it into the repo) before re-raising, so the failure is
    // not propagated with files stranded out of the tree.
    for (const entry of moved) {
      moveFilePreservingMtime(
        path.join(quarantineDir, entry.stored),
        path.join(repoRoot, entry.original),
      );
    }
    rmSync(quarantineDir, { recursive: true, force: true });
    throw err;
  }

  return { manifestPath, quarantineDir, entries };
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

function isManifest(value: unknown): value is QuarantineManifest {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.repoRoot === "string" &&
    typeof m.quarantineDir === "string" &&
    Array.isArray(m.entries)
  );
}

function readManifest(manifestPath: string): QuarantineManifest | null {
  if (!existsSync(manifestPath)) return null;
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch {
    return null; // an unreadable manifest names nothing we can safely restore
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // an unparseable manifest is treated as absent
  }
  return isManifest(parsed) ? parsed : null;
}

interface RestoreResult {
  /** Originals actually moved back into the repo. */
  restored: string[];
  /** Originals NOT restored because the repo slot was already refilled (§F2). */
  conflicts: string[];
}

// Move every not-yet-restored entry back to <repoRoot>/<original>, using the manifest's
// OWN repoRoot/quarantineDir (recovery may run in a different process) and preserving
// mtime (§F1, rename/EXDEV-copy). Idempotent and safe against concurrency:
//   - §F2 no-clobber: if the repo slot was REFILLED (dst exists), never overwrite it —
//     skip the entry, leave the stored file in quarantine, and record a conflict.
//   - §F4 peer-healed: a stored source gone (ENOENT) mid-restore = a peer already
//     restored it — skip, do not throw.
//   - a stored file already absent (a prior partial restore) is skipped.
function restoreEntries(manifest: QuarantineManifest): RestoreResult {
  const restored: string[] = [];
  const conflicts: string[] = [];
  for (const entry of manifest.entries) {
    if (entry.restored) continue;
    const stored = path.join(manifest.quarantineDir, entry.stored);
    const dst = path.join(manifest.repoRoot, entry.original);
    if (existsSync(dst)) {
      // The slot was refilled between the crash and this replay — the stored copy is a
      // stale red. Do NOT clobber the refilled slot; leave the stored file in quarantine.
      conflicts.push(entry.original);
      continue; // entry stays NOT restored so the caller preserves the quarantine dir
    }
    if (existsSync(stored)) {
      mkdirSync(path.dirname(dst), { recursive: true });
      try {
        moveFilePreservingMtime(stored, dst);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          // A peer restored this between the existsSync check and the move — healed.
          entry.restored = true;
          continue;
        }
        throw err;
      }
      restored.push(entry.original);
    }
    entry.restored = true;
  }
  return { restored, conflicts };
}

/**
 * Restore a quarantine created by `quarantineFiles`: rename every pending entry
 * back into the repo (mtime survives the round-trip), then remove the quarantine
 * dir (manifest included). Reads the manifest for the authoritative repoRoot.
 */
export function restoreQuarantine(handle: QuarantineHandle): void {
  const manifest = readManifest(handle.manifestPath);
  if (manifest === null) {
    rmSync(handle.quarantineDir, { recursive: true, force: true });
    return;
  }
  const result = restoreEntries(manifest);
  // §F2: a conflict means a stored file is still parked in quarantine (its slot was
  // refilled). Preserve the quarantine dir so nothing is lost; otherwise clear it.
  if (result.conflicts.length === 0) {
    rmSync(manifest.quarantineDir, { recursive: true, force: true });
    rmSync(handle.quarantineDir, { recursive: true, force: true });
  }
}

/**
 * Heal every crashed run's orphaned quarantine under this workspace: scan
 * every `<runId>` manifest under `<stateHome>/conductor/<workspaceKey>/quarantine/`, restore every
 * pending entry, and remove each healed dir. Returns the originals restored; a
 * second call with nothing pending is a no-op ([]) and never clobbers a
 * now-present repo file (an already-restored stored file is absent, so skipped).
 */
export function replayPendingRestores(input: { stateHome: string; workspaceKey: string }): string[] {
  const { stateHome, workspaceKey } = input;
  // §F3: workspaceKey composes the rmSync'd quarantine root — validate it (may throw on
  // a poisoned id; this is a caller/trust-boundary error, distinct from the per-entry
  // healing errors below which are swallowed so recovery never wedges a run).
  assertSafeId(workspaceKey, "workspaceKey");
  const quarantineRoot = path.join(stateHome, "conductor", workspaceKey, "quarantine");
  if (!existsSync(quarantineRoot)) return [];
  const restored: string[] = [];
  let dirents: import("node:fs").Dirent[];
  try {
    dirents = readdirSync(quarantineRoot, { withFileTypes: true });
  } catch {
    return restored; // the root vanished under us — nothing to heal
  }
  for (const entry of dirents) {
    // §F4: per-entry isolation — one bad manifest must never abort healing the rest,
    // and replay must NEVER throw out of runVerify.
    try {
      if (!entry.isDirectory()) continue;
      const dir = path.join(quarantineRoot, entry.name);
      const manifest = readManifest(path.join(dir, MANIFEST_NAME));
      if (manifest === null) continue;
      // §F4: never heal a LIVE run's quarantine — a live owner is an in-flight verify,
      // not a crashed orphan. Leave it entirely untouched.
      if (typeof manifest.pid === "number" && pidAlive(manifest.pid)) continue;
      // §F4: a vanished repoRoot means the checkout is gone — skip, never mkdir-recreate.
      if (!existsDir(manifest.repoRoot)) continue;
      const result = restoreEntries(manifest);
      for (const original of result.restored) restored.push(original);
      // §F2: only clear a fully-drained dir; a conflict leaves stored files parked.
      if (result.conflicts.length === 0) {
        rmSync(manifest.quarantineDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      continue; // heal what we can; a single bad entry never wedges the sweep
    }
  }
  return restored;
}
