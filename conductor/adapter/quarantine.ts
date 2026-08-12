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
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import * as path from "node:path";

import { writeFileAtomicSync } from "./state.ts";

const MANIFEST_VERSION = 1;
const MANIFEST_NAME = "manifest.json";

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
    entries,
  };

  // Manifest BEFORE the moves (crash-safe), then rename each file OUT.
  writeFileAtomicSync(manifestPath, JSON.stringify(manifest, null, 2));
  for (const entry of entries) {
    const src = path.join(repoRoot, entry.original);
    const dst = path.join(quarantineDir, entry.stored);
    mkdirSync(path.dirname(dst), { recursive: true });
    renameSync(src, dst);
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

// Rename every not-yet-restored entry back to <repoRoot>/<original>, using the
// manifest's OWN repoRoot/quarantineDir (recovery may run in a different process).
// A stored file that is already gone (a partial prior restore) is skipped, so the
// operation is idempotent. Returns the originals actually moved back.
function restoreEntries(manifest: QuarantineManifest): string[] {
  const restored: string[] = [];
  for (const entry of manifest.entries) {
    if (entry.restored) continue;
    const stored = path.join(manifest.quarantineDir, entry.stored);
    const dst = path.join(manifest.repoRoot, entry.original);
    if (existsSync(stored)) {
      mkdirSync(path.dirname(dst), { recursive: true });
      renameSync(stored, dst);
      restored.push(entry.original);
    }
    entry.restored = true;
  }
  return restored;
}

/**
 * Restore a quarantine created by `quarantineFiles`: rename every pending entry
 * back into the repo (mtime survives the round-trip), then remove the quarantine
 * dir (manifest included). Reads the manifest for the authoritative repoRoot.
 */
export function restoreQuarantine(handle: QuarantineHandle): void {
  const manifest = readManifest(handle.manifestPath);
  if (manifest !== null) {
    restoreEntries(manifest);
    rmSync(manifest.quarantineDir, { recursive: true, force: true });
  }
  rmSync(handle.quarantineDir, { recursive: true, force: true });
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
  const quarantineRoot = path.join(stateHome, "conductor", workspaceKey, "quarantine");
  if (!existsSync(quarantineRoot)) return [];
  const restored: string[] = [];
  for (const entry of readdirSync(quarantineRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(quarantineRoot, entry.name);
    const manifest = readManifest(path.join(dir, MANIFEST_NAME));
    if (manifest === null) continue;
    for (const original of restoreEntries(manifest)) restored.push(original);
    rmSync(manifest.quarantineDir, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
  return restored;
}
