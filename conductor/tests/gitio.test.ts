// Task 4.2 red tests — lives at conductor/tests/gitio.test.ts.
//
// Subject (must NOT exist when this goes red; the failure is
// `Cannot find module '../adapter/gitio.ts'` — the missing-subject shape, a legal
// red per §2.6.1 because the unresolved path resolves inside THIS item's fileScope):
//   - conductor/adapter/gitio.ts   (read-only git queries)
//
// ADAPTER module (G14): the subject uses node:fs / node:child_process only, every
// query via execFile with shell:false, and every function takes an explicit `cwd`
// (the workspace root OR a worktree path — this is exactly what lets Task 9.6's
// worktree mode reuse the interface without breaking it). This test never touches a
// Bun API, never touches port 8080, and — critically — never runs git against the
// llama-harness repo: every fixture is a throwaway repo built under os.tmpdir() with
// `git init`, torn down in the global after() hook.
//
// Spec read for this test:
//   plan 2305-2318 — the task, the ten-function interface, and the required cases
//     (NUL-split a filename with a space; zero-commit repo where headSha is null and
//      the freshness HEAD term is vacuous rather than crashing; staged deletion;
//      dirtyFiles distinguishing tracked-modified from untracked).
//   plan 797-851 §2.6 — freshness: a verify is fresh iff startedMs >= max(worktree
//     mtimes of staged files that exist, index mtime when a staged entry is a
//     deletion/rename) AND record.head === currentHead. headSha feeds the HEAD term
//     (and run.startHead); worktreeMtimes / indexMtimeMs feed the mtime term. On a
//     zero-commit repo the HEAD term must be VACUOUS — headSha returns null, it does
//     not throw.
//   plan 1160-1210 §3.3 + 1279-1285 — publish stages `fileScope ∪ testScope` MINUS
//     `run.startDirty`. startDirty is "paths dirty BEFORE conductor touched anything"
//     and the preexistingDirty rule ("refuse"/"exclude") consumes it, so dirtyFiles
//     must surface tracked-modified AND untracked paths distinguishably.
//   docs/build/specs/task-4.2.assertions.json — the 6 rows mapped below.
//
// Assertion id -> test name (see docs/build/specs/task-4.2.assertions.json):
//   4.2-api          -> "[4.2-api] full export surface; every function honors the
//                        explicit cwd rather than a process-global"
//   4.2-nul          -> "[4.2-nul] stagedFiles/stagedNameStatus split on NUL, not
//                        whitespace, for a filename containing a space"
//   4.2-zero-commit  -> "[4.2-zero-commit] zero-commit repo: headSha null, currentBranch
//                        is the unborn branch, isRepo true (HEAD term vacuous not crash)"
//   4.2-deletion     -> "[4.2-deletion] stagedNameStatus surfaces a staged deletion as D"
//   4.2-dirty        -> "[4.2-dirty] dirtyFiles distinguishes tracked-modified from untracked"
//   4.2-fixtures     -> "[4.2-fixtures] throwaway fixture repos under os.tmpdir(); isRepo
//                        true for a git fixture, false for a bare temp dir"
// Non-thinning extras required by plan 2314-2317 (headSha/headShortSubject on a
// committed repo; indexMtimeMs; worktreeMtimes; unstagedDrift):
//   "[4.2-head] headSha and headShortSubject on a repo with commits"
//   "[4.2-mtimes] indexMtimeMs is an epoch-ms number; worktreeMtimes returns mtimes
//    only for paths that exist"
//   "[4.2-drift] unstagedDrift reports only the passed paths that drift from the index"

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, devNull } from "node:os";
import * as path from "node:path";

// The subject under test — absent at red time (the missing-subject red).
import {
  stagedFiles,
  stagedNameStatus,
  dirtyFiles,
  unstagedDrift,
  indexMtimeMs,
  worktreeMtimes,
  headShortSubject,
  headSha,
  currentBranch,
  isRepo,
} from "../adapter/gitio.ts";

// ---------------------------------------------------------------------------
// Pinned contract (execFile, shell:false; first arg is always an explicit `cwd`).
// Return shapes the implementer must target:
//   stagedFiles(cwd): string[]
//       paths staged in the index (git diff --cached --name-only -z).
//   stagedNameStatus(cwd): Array<{ status: string; path: string; origPath?: string }>
//       staged changes with status letters (-z name-status). "A" add, "M" modify,
//       "D" delete; renames carry "R<score>" + origPath. NUL-delimited, never
//       whitespace-split.
//   dirtyFiles(cwd): { trackedModified: string[]; untracked: string[] }
//       working-tree dirt, split so publish's startDirty rule can consume both.
//       A path is in exactly one bucket.
//   unstagedDrift(cwd, paths: string[]): string[]
//       the subset of `paths` whose worktree differs from the index.
//   indexMtimeMs(cwd): number         // mtime of .git/index in epoch ms.
//   worktreeMtimes(cwd, paths: string[]): Map<string, number>
//       path -> worktree mtime (epoch ms), for the paths that EXIST; missing paths
//       are omitted (freshness maxes over "staged files that exist").
//   headShortSubject(cwd): string | null   // short one-line subject of HEAD; null if unborn.
//   headSha(cwd): string | null       // full 40-hex HEAD sha; NULL on a zero-commit repo.
//   currentBranch(cwd): string | null // branch name (works on an unborn branch); null if detached.
//   isRepo(cwd): boolean              // true iff cwd is inside a git work tree.
// ---------------------------------------------------------------------------

// Hermetic git: no global/system config (so a user's gpgsign / defaultBranch / etc.
// can never leak in), a deterministic committer, no interactive prompts.
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

const tmpDirs: string[] = [];

after(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Fixture builders. Every one runs git ONLY against its own temp dir — never the
// llama-harness repo. `git init` inside a mkdtemp fixture is the required, allowed use.
function git(dir: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: dir,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-gitio-"));
  tmpDirs.push(dir);
  git(dir, ["init", "-b", "main"]);
  return dir;
}

function bareTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "conductor-gitio-nogit-"));
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

const HEX40 = /^[0-9a-f]{40}$/;
const EPOCH_MS_FLOOR = 1_000_000_000_000; // ~2001 in ms; a seconds-valued mtime is < this.

// ---------------------------------------------------------------------------

test("[4.2-api] full export surface; every function honors the explicit cwd rather than a process-global", () => {
  // Two independent repos. `node --test` runs with cwd = the llama-harness repo (itself
  // a git repo), so a function that ignored its `cwd` argument and read a process-global
  // would return identical answers for both — these assertions catch exactly that.
  const repoA = initRepo();
  const repoB = initRepo();
  commit(repoA, "fileA.txt", "alpha\n", "repo A commit");
  commit(repoB, "fileB.txt", "beta\n", "repo B commit");

  const shaA = headSha(repoA);
  const shaB = headSha(repoB);
  assert.ok(shaA !== null, "headSha(repoA) must be non-null on a committed repo");
  assert.ok(shaB !== null, "headSha(repoB) must be non-null on a committed repo");
  assert.match(shaA, HEX40, "headSha must be the full 40-hex sha");
  assert.match(shaB, HEX40, "headSha must be the full 40-hex sha");
  assert.notEqual(shaA, shaB, "distinct repos at distinct cwds must yield distinct HEAD shas");

  const subjA = headShortSubject(repoA);
  const subjB = headShortSubject(repoB);
  assert.ok(subjA !== null && subjA.includes("repo A commit"), "headShortSubject honors cwd (repoA)");
  assert.ok(subjB !== null && subjB.includes("repo B commit"), "headShortSubject honors cwd (repoB)");

  assert.equal(currentBranch(repoA), "main", "currentBranch honors cwd and reports the init branch");
  assert.equal(isRepo(repoA), true, "isRepo true for a git fixture");

  // Shape of the remaining read-only queries.
  assert.ok(Array.isArray(stagedFiles(repoA)), "stagedFiles returns an array");
  assert.ok(Array.isArray(stagedNameStatus(repoA)), "stagedNameStatus returns an array");

  const dirty = dirtyFiles(repoA);
  assert.ok(Array.isArray(dirty.trackedModified), "dirtyFiles.trackedModified is an array");
  assert.ok(Array.isArray(dirty.untracked), "dirtyFiles.untracked is an array");

  const im = indexMtimeMs(repoA);
  assert.ok(Number.isFinite(im) && im > EPOCH_MS_FLOOR, "indexMtimeMs is an epoch-ms number");

  const mtimes = worktreeMtimes(repoA, ["fileA.txt"]);
  assert.ok(mtimes instanceof Map, "worktreeMtimes returns a Map");
  assert.ok(mtimes.has("fileA.txt"), "worktreeMtimes includes an existing path");

  assert.deepEqual(
    unstagedDrift(repoA, ["fileA.txt"]),
    [],
    "a freshly-committed, unmodified file does not drift",
  );
});

test("[4.2-nul] stagedFiles/stagedNameStatus split on NUL, not whitespace, for a filename containing a space", () => {
  const dir = initRepo();
  commit(dir, "seed.txt", "seed\n", "seed commit");

  // A single file whose name contains a space. `git add` receives it as ONE argv
  // element (execFile, shell:false) — the only way it can split into two paths later
  // is a buggy whitespace tokenizer in the subject.
  write(dir, "a b.txt", "spaced\n");
  git(dir, ["add", "a b.txt"]);

  const staged = stagedFiles(dir);
  assert.deepEqual(staged, ["a b.txt"], "the one staged path is the spaced name, intact");
  assert.ok(!staged.includes("a"), "must not split the name on the space (no bare 'a')");
  assert.ok(!staged.includes("b.txt"), "must not split the name on the space (no bare 'b.txt')");

  const ns = stagedNameStatus(dir);
  assert.equal(ns.length, 1, "exactly one staged name-status entry");
  assert.equal(ns[0].status, "A", "the spaced file is staged as an addition");
  assert.equal(ns[0].path, "a b.txt", "name-status path preserves the embedded space");
});

test("[4.2-zero-commit] zero-commit repo: headSha null, currentBranch is the unborn branch, isRepo true (HEAD term vacuous not crash)", () => {
  const dir = initRepo(); // `git init -b main` — an unborn branch, no commits.

  assert.equal(headSha(dir), null, "headSha on a zero-commit repo is null (freshness HEAD term vacuous, not a throw)");
  assert.equal(currentBranch(dir), "main", "currentBranch reports the unborn branch name");
  assert.equal(isRepo(dir), true, "a git dir with no commits is still a repo");
});

test("[4.2-deletion] stagedNameStatus surfaces a staged deletion as D", () => {
  const dir = initRepo();
  commit(dir, "gamma.txt", "gamma\n", "add gamma");

  git(dir, ["rm", "gamma.txt"]); // stages the deletion, removes it from the worktree.

  const ns = stagedNameStatus(dir);
  const del = ns.find((e) => e.path === "gamma.txt");
  assert.ok(del !== undefined, "the staged deletion appears in name-status");
  assert.equal(del.status, "D", "the staged deletion carries status D");
});

test("[4.2-dirty] dirtyFiles distinguishes tracked-modified from untracked", () => {
  const dir = initRepo();
  commit(dir, "tracked.txt", "one\n", "add tracked");

  // A tracked file modified in the worktree (unstaged), plus a brand-new untracked file.
  write(dir, "tracked.txt", "one\ntwo\n");
  write(dir, "untracked.txt", "new\n");

  const dirty = dirtyFiles(dir);
  assert.ok(dirty.trackedModified.includes("tracked.txt"), "the modified tracked file is reported as tracked-modified");
  assert.ok(dirty.untracked.includes("untracked.txt"), "the new file is reported as untracked");
  // The distinction is the whole point (publish's startDirty rule consumes both):
  // a path lands in exactly one bucket.
  assert.ok(!dirty.untracked.includes("tracked.txt"), "a tracked-modified path is NOT reported as untracked");
  assert.ok(!dirty.trackedModified.includes("untracked.txt"), "an untracked path is NOT reported as tracked-modified");
});

test("[4.2-fixtures] throwaway fixture repos under os.tmpdir(); isRepo true for a git fixture, false for a bare temp dir", () => {
  const gitDir = initRepo();
  const nonGit = bareTempDir();

  // Fixtures are throwaway temp dirs (torn down in after()), never the harness repo.
  assert.ok(gitDir.includes("conductor-gitio-"), "git fixture is a throwaway temp dir");
  assert.ok(nonGit.includes("conductor-gitio-nogit-"), "non-git fixture is a throwaway temp dir");

  assert.equal(isRepo(gitDir), true, "isRepo true inside a git work tree");
  assert.equal(isRepo(nonGit), false, "isRepo false for a directory that is not a git repo");
});

test("[4.2-head] headSha and headShortSubject on a repo with commits", () => {
  const dir = initRepo();
  commit(dir, "alpha.txt", "alpha\n", "add alpha file");

  const sha = headSha(dir);
  assert.ok(sha !== null, "headSha is non-null once a commit exists");
  assert.match(sha, HEX40, "headSha is the full 40-hex object name");
  // Independent read of the same fact: the adapter must capture git's sha faithfully
  // (trimmed, full-length) — a mis-parse (short sha, stray newline) would diverge here.
  assert.equal(sha, git(dir, ["rev-parse", "HEAD"]).trim(), "headSha equals the repo's actual HEAD");

  const subj = headShortSubject(dir);
  assert.ok(subj !== null && subj.length > 0, "headShortSubject is a non-empty string");
  assert.ok(subj.includes("add alpha file"), "headShortSubject carries the commit subject line");
});

test("[4.2-mtimes] indexMtimeMs is an epoch-ms number; worktreeMtimes returns mtimes only for paths that exist", () => {
  const dir = initRepo();
  commit(dir, "alpha.txt", "alpha\n", "add alpha");
  commit(dir, "beta.txt", "beta\n", "add beta");

  const im = indexMtimeMs(dir);
  assert.ok(Number.isFinite(im), "indexMtimeMs is a finite number");
  assert.ok(im > EPOCH_MS_FLOOR, "indexMtimeMs is epoch MILLISECONDS (a seconds value would fall below the floor)");
  assert.ok(im < Date.now() + 86_400_000, "indexMtimeMs is not implausibly in the future");

  const mtimes = worktreeMtimes(dir, ["alpha.txt", "beta.txt", "ghost.txt"]);
  assert.ok(mtimes instanceof Map, "worktreeMtimes returns a Map");
  const a = mtimes.get("alpha.txt");
  const b = mtimes.get("beta.txt");
  assert.ok(a !== undefined && a > EPOCH_MS_FLOOR, "existing path alpha.txt has an epoch-ms mtime");
  assert.ok(b !== undefined && b > EPOCH_MS_FLOOR, "existing path beta.txt has an epoch-ms mtime");
  assert.ok(!mtimes.has("ghost.txt"), "a non-existent path is omitted, not present with a bogus mtime");
});

test("[4.2-drift] unstagedDrift reports only the passed paths that drift from the index", () => {
  const dir = initRepo();
  commit(dir, "alpha.txt", "alpha\n", "add alpha");
  commit(dir, "beta.txt", "beta\n", "add beta");

  // alpha drifts (worktree differs from the index); beta is untouched.
  write(dir, "alpha.txt", "alpha\nmore\n");

  const drift = unstagedDrift(dir, ["alpha.txt", "beta.txt"]);
  assert.ok(drift.includes("alpha.txt"), "the modified path is reported as drifting");
  assert.ok(!drift.includes("beta.txt"), "an unmodified path does not drift");

  assert.deepEqual(
    unstagedDrift(dir, ["beta.txt"]),
    [],
    "unstagedDrift is scoped to the paths passed in (beta alone: no drift)",
  );
});
