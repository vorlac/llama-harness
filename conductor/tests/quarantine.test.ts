// conductor/tests/quarantine.test.ts — Task 6.1 red tests for the OUT-OF-REPO
// quarantine lifecycle (adapter/quarantine.ts). This mechanism is one of the four
// the plan itself flags most-likely-broken (prompt §8.2: extra red-step scrutiny +
// witness-file-backed proofs), so these tests pin the crash-safe move-aside/restore
// contract exactly.
//
// SUBJECT (must NOT exist when this goes red; the failure is
// `Cannot find module '.../conductor/adapter/quarantine.ts'` — the missing-subject
// shape, a legal greenfield red because the unresolved path resolves inside THIS
// item's fileScope):
//   - conductor/adapter/quarantine.ts   (move foreign red tests OUT of the repo,
//                                         crash-safe manifest, replay pending restores)
//
// ADAPTER module (G14): node:fs / node:path only — no Bun, no shell tag, no `bun:`
// import; the purity guard (tests/purity.test.ts) scans it. This test never touches
// a Bun API, never touches port 8080, and NEVER git-operates on the llama-harness
// repo: every fixture is a throwaway dir under os.tmpdir(), and the out-of-repo
// quarantine root is a SEPARATE throwaway dir, both removed in after().
//
// Spec read for this test:
//   plan 1544-1618 §4.2 — the foreign red set; quarantine = MOVE the named files to
//     `<stateHome>/conductor/<workspaceKey>/quarantine/<runId>/` OUTSIDE the
//     repository (so no whole-tree runner can reach them), with a manifest that
//     REPLAYS PENDING RESTORES after a crash, and restore them when the verify
//     completes. "correctness comes from being outside the walked tree" (1595-1596).
//   plan 2415-2418, 2434-2440 (Task 6.1) — quarantine granularity is the file;
//     the manifest replays pending restores mirroring the stale-marker healing; a
//     quarantined file's mtime MUST survive the round-trip (RENAME, not copy —
//     otherwise every quarantine bumps mtime and invalidates §2.6 freshness).
//   docs/build/specs/task-6.1.assertions.json — rows 6.1-quarantine-out,
//     6.1-crash-manifest, 6.1-mtime.
//
// Assertion id -> test name:
//   6.1-quarantine-out  -> "[6.1-q-dir] quarantineDirFor is the §4.2 out-of-repo path; the dir is OUTSIDE the repo tree"
//                       -> "[6.1-q-move] quarantineFiles moves named files OUT of the repo and writes a crash-safe manifest"
//   6.1-mtime           -> "[6.1-q-mtime] a quarantined file's mtime SURVIVES the move (rename, not copy)"
//   6.1-crash-manifest  -> "[6.1-q-restore] restoreQuarantine renames files back and clears the quarantine dir"
//                       -> "[6.1-q-replay] replayPendingRestores heals a crashed run's orphaned quarantine; idempotent"

import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

// The subject under test — absent at red time (the missing-subject red).
import {
  quarantineDirFor,
  quarantineFiles,
  restoreQuarantine,
  replayPendingRestores,
} from "../adapter/quarantine.ts";
import type { QuarantineHandle, QuarantineManifest, QuarantineManifestEntry } from "../adapter/quarantine.ts";

// ---------------------------------------------------------------------------
// Pinned contract the implementer must target (recorded here so evidence.ts and
// quarantine.ts agree on shapes):
//
//   quarantineDirFor(stateHome, workspaceKey, runId): string
//       => path.join(stateHome, "conductor", workspaceKey, "quarantine", runId)
//          — §4.2's OUT-OF-REPO location (stateHome is never inside the repo).
//
//   quarantineFiles({ repoRoot, files, stateHome, workspaceKey, runId }): QuarantineHandle
//       MOVES each repo-relative `files` entry from <repoRoot>/<f> to
//       <quarantineDir>/<stored> via RENAME (mtime-preserving), after first writing
//       a crash-safe manifest.json describing every planned move (restored:false).
//
//   restoreQuarantine(handle): void
//       RENAMES every not-yet-restored entry back to <repoRoot>/<original>, then
//       removes the quarantine dir (manifest included).
//
//   replayPendingRestores({ stateHome, workspaceKey }): string[]
//       Scans <stateHome>/conductor/<workspaceKey>/quarantine/*/manifest.json and
//       restores every pending entry (using the manifest's own repoRoot/quarantineDir
//       — a crash may recover in a different process), removing each healed dir.
//       Returns the originals it restored; a second call is a no-op ([]).
//
//   QuarantineHandle  { manifestPath: string; quarantineDir: string; entries: QuarantineManifestEntry[] }
//   QuarantineManifest{ version: number; runId: string; repoRoot: string;
//                       quarantineDir: string; entries: QuarantineManifestEntry[] }
//   QuarantineManifestEntry { original: string; stored: string; restored: boolean }
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

after(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function freshRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-quar-repo-"));
  tmpDirs.push(dir);
  return dir;
}

// The out-of-repo state home — a DISTINCT temp dir, never under the repo (that is
// the whole point of §4.2). Tracked separately for cleanup.
function freshStateHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-quar-state-"));
  tmpDirs.push(dir);
  return dir;
}

// A fixed, distinctive past mtime so a copy-instead-of-rename implementation (which
// would stamp "now") is caught: 2024-06-01T00:00:00Z.
const FIXED_MTIME_MS = Date.UTC(2024, 5, 1, 0, 0, 0);
const FIXED_MTIME_S = FIXED_MTIME_MS / 1000;

function writeRepoFile(repoRoot: string, rel: string, content: string): void {
  const abs = path.join(repoRoot, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  utimesSync(abs, FIXED_MTIME_S, FIXED_MTIME_S);
}

function readManifest(manifestPath: string): QuarantineManifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as QuarantineManifest;
}

// mtime compared at second granularity: rename preserves the nanosecond mtime, but
// utimesSync only guarantees the second we set, so we compare floored seconds.
function mtimeSec(abs: string): number {
  return Math.floor(statSync(abs).mtimeMs / 1000);
}

// ===========================================================================

test("[6.1-q-dir] quarantineDirFor is the §4.2 out-of-repo path; the dir is OUTSIDE the repo tree", () => {
  const repoRoot = freshRepo();
  const stateHome = freshStateHome();

  const dir = quarantineDirFor(stateHome, "wkey", "r-20260807-a1b2");
  assert.equal(
    dir,
    path.join(stateHome, "conductor", "wkey", "quarantine", "r-20260807-a1b2"),
    "quarantineDirFor must be <stateHome>/conductor/<workspaceKey>/quarantine/<runId> (§4.2, plan 1585)",
  );

  // The crux of the whole mechanism (plan 1590-1596): the quarantine dir is OUTSIDE
  // the repository, so no whole-tree runner (node --test / pytest / go / ctest) can
  // reach a moved-aside red. A relative path from the repo to the quarantine dir must
  // escape the repo subtree.
  const rel = path.relative(repoRoot, dir);
  assert.ok(
    rel.startsWith(".."),
    `the quarantine dir must be OUTSIDE the repo tree (§4.2) — path.relative(repo, quarantineDir) was "${rel}", which does not escape the repo`,
  );
  assert.equal(
    dir.startsWith(repoRoot + path.sep),
    false,
    "the quarantine dir must not be nested inside the repo root",
  );
});

test("[6.1-q-move] quarantineFiles moves named files OUT of the repo and writes a crash-safe manifest", () => {
  const repoRoot = freshRepo();
  const stateHome = freshStateHome();
  writeRepoFile(repoRoot, "tests/foreign.suite.js", "throw new Error('foreign red');\n");
  writeRepoFile(repoRoot, "tests/other.suite.js", "// second foreign red\n");

  const handle: QuarantineHandle = quarantineFiles({
    repoRoot,
    files: ["tests/foreign.suite.js", "tests/other.suite.js"],
    stateHome,
    workspaceKey: "wkey",
    runId: "r-move",
  });

  const quarantineDir = quarantineDirFor(stateHome, "wkey", "r-move");
  assert.equal(handle.quarantineDir, quarantineDir, "handle.quarantineDir is the §4.2 path");

  // The named files are GONE from the repo — a whole-tree runner cannot see them.
  assert.equal(
    existsSync(path.join(repoRoot, "tests/foreign.suite.js")),
    false,
    "foreign.suite.js must be MOVED out of the repo, not copied",
  );
  assert.equal(existsSync(path.join(repoRoot, "tests/other.suite.js")), false, "other.suite.js moved out");

  // The manifest is crash-safe evidence of the pending restores.
  assert.ok(existsSync(handle.manifestPath), "a manifest must be written for crash replay (§4.2, plan 1586)");
  const manifest = readManifest(handle.manifestPath);
  assert.equal(manifest.repoRoot, repoRoot, "manifest records the repoRoot to restore into");
  assert.equal(manifest.quarantineDir, quarantineDir, "manifest records the quarantine dir");
  assert.equal(manifest.entries.length, 2, "manifest has one entry per quarantined file");

  const foreign = manifest.entries.find(
    (e: QuarantineManifestEntry) => e.original === "tests/foreign.suite.js",
  );
  if (foreign === undefined) {
    throw new Error("manifest must contain an entry keyed by the repo-relative original path");
  }
  assert.equal(foreign.restored, false, "a freshly quarantined entry is NOT yet restored");

  // The stored file physically lives under the quarantine dir (read `stored` from the
  // manifest rather than hardcoding the layout).
  const storedAbs = path.join(quarantineDir, foreign.stored);
  assert.ok(existsSync(storedAbs), "the quarantined file is physically present under the out-of-repo quarantine dir");
  assert.equal(
    readFileSync(storedAbs, "utf8"),
    "throw new Error('foreign red');\n",
    "the quarantined file retains its original content",
  );
});

test("[6.1-q-mtime] a quarantined file's mtime SURVIVES the move (rename, not copy)", () => {
  const repoRoot = freshRepo();
  const stateHome = freshStateHome();
  writeRepoFile(repoRoot, "tests/foreign.suite.js", "throw new Error('foreign red');\n");
  assert.equal(mtimeSec(path.join(repoRoot, "tests/foreign.suite.js")), FIXED_MTIME_S, "precondition: fixed past mtime");

  const handle = quarantineFiles({
    repoRoot,
    files: ["tests/foreign.suite.js"],
    stateHome,
    workspaceKey: "wkey",
    runId: "r-mtime",
  });
  const stored = path.join(handle.quarantineDir, handle.entries[0].stored);
  assert.equal(
    mtimeSec(stored),
    FIXED_MTIME_S,
    "mtime must survive the move OUT (a copy would stamp now and invalidate §2.6 freshness — plan 2439-2440)",
  );

  restoreQuarantine(handle);
  assert.equal(
    mtimeSec(path.join(repoRoot, "tests/foreign.suite.js")),
    FIXED_MTIME_S,
    "mtime must survive the round-trip back into the repo (rename both ways)",
  );
});

test("[6.1-q-restore] restoreQuarantine renames files back and clears the quarantine dir", () => {
  const repoRoot = freshRepo();
  const stateHome = freshStateHome();
  writeRepoFile(repoRoot, "tests/foreign.suite.js", "RED\n");

  const handle = quarantineFiles({
    repoRoot,
    files: ["tests/foreign.suite.js"],
    stateHome,
    workspaceKey: "wkey",
    runId: "r-restore",
  });
  assert.equal(existsSync(path.join(repoRoot, "tests/foreign.suite.js")), false, "moved out during quarantine");

  restoreQuarantine(handle);

  const back = path.join(repoRoot, "tests/foreign.suite.js");
  assert.ok(existsSync(back), "restoreQuarantine must move the file back into the repo");
  assert.equal(readFileSync(back, "utf8"), "RED\n", "restored content is byte-identical");
  assert.equal(
    existsSync(handle.quarantineDir),
    false,
    "the quarantine dir (manifest included) is removed once every pending restore completes",
  );
});

test("[6.1-q-replay] replayPendingRestores heals a crashed run's orphaned quarantine; idempotent", () => {
  const repoRoot = freshRepo();
  const stateHome = freshStateHome();
  writeRepoFile(repoRoot, "tests/foreign.suite.js", "RED\n");

  // Simulate a mid-verify KILL: the files are moved out and the manifest is written,
  // but the process dies before restoreQuarantine runs (no restore call here).
  const handle = quarantineFiles({
    repoRoot,
    files: ["tests/foreign.suite.js"],
    stateHome,
    workspaceKey: "wkey",
    runId: "r-crashed",
  });
  assert.equal(existsSync(path.join(repoRoot, "tests/foreign.suite.js")), false, "crashed run left the file quarantined");
  assert.ok(existsSync(handle.manifestPath), "crashed run left an orphaned manifest to replay");

  // The next run heals the orphan by replaying pending restores (mirrors the
  // stale-marker healing, plan 2438-2439).
  const restored = replayPendingRestores({ stateHome, workspaceKey: "wkey" });
  assert.ok(restored.length >= 1, "replay must report the orphan it restored");
  const back = path.join(repoRoot, "tests/foreign.suite.js");
  assert.ok(existsSync(back), "the orphaned quarantined file is restored to the repo by the next run");
  assert.equal(readFileSync(back, "utf8"), "RED\n", "restored content is byte-identical");
  assert.equal(mtimeSec(back), FIXED_MTIME_S, "replay preserves mtime (rename) so freshness is not invalidated");
  assert.equal(existsSync(handle.quarantineDir), false, "the healed quarantine dir is cleared");

  // Idempotent: nothing is pending now, so a second replay is a no-op and never
  // clobbers the now-present repo file.
  const again = replayPendingRestores({ stateHome, workspaceKey: "wkey" });
  assert.deepEqual(again, [], "a second replay with nothing pending restores nothing");
  assert.ok(existsSync(back), "the restored file is untouched by the idempotent second replay");
});
