// conductor/adapter/gitio.ts — Task 4.2: read-only git queries (plan 2305-2318).
//
// An ADAPTER (G14): it shells out to git and stats files, so it lives outside the
// pure core. It runs under BOTH the opencode runtime and Node type-stripping, so it
// uses only cross-runtime built-ins — node:child_process, node:fs, node:path — with
// no single-runtime API and, deliberately, no shell: every query goes through
// execFileSync with an argv array (shell:false is the default; there is no shell
// string anywhere). That argv discipline is the whole point of this interface — a
// path containing a space or a shell metacharacter is one argv element, never
// re-tokenized — which is why the -z parsers below can trust NUL as the only
// delimiter.
//
// Every function takes an explicit `cwd` as its first argument (the workspace root
// OR a linked worktree path). Nothing here reads a process-global repo location; git
// discovers the repo from `cwd`, which is exactly what lets Task 9.6's worktree mode
// reuse this interface without an interface break.
//
// Failure discipline: a git command that exits non-zero for a LEGITIMATE repo-state
// reason — an unborn HEAD, a detached HEAD, a directory that is not a repo — is
// mapped to the null / false / empty value the caller expects, never allowed to
// throw. But a git that could not even be spawned (a real environment fault) is NOT
// swallowed: tryGit re-throws it so a genuine bug stays visible.
//
// Interfaces (plan 2307-2312):
//   stagedFiles(cwd)                -> string[]
//   stagedNameStatus(cwd)           -> Array<{ status; path; origPath? }>
//   dirtyFiles(cwd)                 -> { trackedModified; untracked }
//   unstagedDrift(cwd, paths)       -> string[]
//   indexMtimeMs(cwd)               -> number
//   worktreeMtimes(cwd, paths)      -> Map<string, number>
//   headShortSubject(cwd)           -> string | null
//   headSha(cwd)                    -> string | null   (freshness §2.6 HEAD term; run.startHead)
//   currentBranch(cwd)              -> string | null
//   isRepo(cwd)                     -> boolean
//   gitCommonDir(cwd)               -> string | null  (the effective exclude target, C-021)
//   initRepo(cwd)                   -> boolean        (§3.9's "initialize a repo here")

import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import * as path from "node:path";

// A staged change as reported by `git diff --cached --name-status -z`. `status` is the
// raw letter(s) git emits — "A" add, "M" modify, "D" delete, "R<score>"/"C<score>"
// rename/copy. For a rename or copy, `origPath` is the source and `path` is the
// destination.
export interface NameStatusEntry {
  status: string;
  path: string;
  origPath?: string;
}

// Working-tree dirt split into two mutually exclusive buckets so publish's startDirty
// rule (§3.3) can consume both distinguishably: a path appears in exactly one.
export interface DirtyFiles {
  trackedModified: string[];
  untracked: string[];
}

// The environment every git invocation runs under. We start from process.env (so PATH
// finds git) but strip the repo-location overrides — GIT_DIR / GIT_WORK_TREE /
// GIT_INDEX_FILE / GIT_COMMON_DIR — so that a stray value inherited from the parent
// process can never redirect a query away from `cwd` onto some other repository. With
// them gone, `cwd` is the sole authority for which repo is read (this is also what
// guarantees a query for a fixture repo can never touch the surrounding repo).
// GIT_OPTIONAL_LOCKS=0 keeps read-only queries from opportunistically rewriting the
// index (which would perturb the indexMtimeMs freshness signal); GIT_TERMINAL_PROMPT=0
// forbids interactive prompts. No global/system config knob can alter what the parsers
// below see because every command pins its own machine format (-z, --porcelain,
// --untracked-files=all), which overrides config such as core.quotepath and
// status.showUntrackedFiles.
const GIT_ENV: NodeJS.ProcessEnv = (() => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_COMMON_DIR;
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
})();

// Run git in `cwd` and return stdout as a string. Throws on a non-zero exit (the
// thrown error carries a numeric `.status`) and on a spawn failure (no `.status`).
// stderr is captured (piped), never inherited, so git's "fatal:" chatter for expected
// failures does not leak to the console.
function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

// Run git, returning null when git RAN and exited non-zero (the expected repo-state
// failures: unborn HEAD, detached HEAD, not-a-repo — all carry a numeric `.status`),
// and re-throwing when git could not be spawned at all (a real environment fault with
// no `.status`, e.g. git missing from PATH). This is the narrow catch the contract
// asks for: known non-zero exits are mapped, genuine faults stay loud.
function tryGit(cwd: string, args: string[]): string | null {
  try {
    return runGit(cwd, args);
  } catch (err) {
    if (typeof (err as { status?: unknown }).status === "number") return null;
    throw err;
  }
}

// Split a NUL-delimited git payload into its non-empty fields. `-z` output terminates
// every field with a NUL (so the trailing element after the final NUL is empty); the
// filter drops that trailing empty without discarding any real path.
function splitNul(payload: string): string[] {
  return payload.split("\0").filter((field) => field.length > 0);
}

// Paths staged in the index — `git diff --cached --name-only -z`. On a zero-commit
// repo git compares the index against the empty tree, so this still lists staged
// additions rather than failing. NUL-split, never whitespace-split, so a filename
// containing a space survives as one path.
export function stagedFiles(cwd: string): string[] {
  return splitNul(runGit(cwd, ["diff", "--cached", "--name-only", "-z"]));
}

// Staged changes with their status letters — `git diff --cached --name-status -z`.
// In the -z name-status stream each entry is `status NUL path NUL`, except a rename
// or copy which is `status NUL origPath NUL newPath NUL` (source before destination).
// We walk the NUL fields, consuming one path for ordinary changes and two for an
// R/C entry, so the extra rename field is never mistaken for a new entry's status.
export function stagedNameStatus(cwd: string): NameStatusEntry[] {
  const fields = runGit(cwd, ["diff", "--cached", "--name-status", "-z"]).split("\0");
  const entries: NameStatusEntry[] = [];
  let i = 0;
  while (i < fields.length) {
    const status = fields[i];
    i += 1;
    if (status.length === 0) continue; // trailing empty after the final NUL
    if (status[0] === "R" || status[0] === "C") {
      const origPath = fields[i];
      const newPath = fields[i + 1];
      i += 2;
      if (origPath === undefined || newPath === undefined) break; // truncated stream
      entries.push({ status, path: newPath, origPath });
    } else {
      const changedPath = fields[i];
      i += 1;
      if (changedPath === undefined) break; // truncated stream
      entries.push({ status, path: changedPath });
    }
  }
  return entries;
}

// Working-tree dirt from `git status --porcelain -z --untracked-files=all`, split into
// tracked-modified vs untracked. In porcelain v1 -z each entry is `XY SP path` where X
// is the index column and Y the worktree column; a rename adds a second NUL-separated
// path we consume but do not classify (a rename is a staged change, not worktree dirt).
// `??` is untracked; a tracked path whose worktree column shows a modification
// (M/D/T) is tracked-modified. --untracked-files=all pins untracked reporting on
// regardless of the user's status.showUntrackedFiles config.
export function dirtyFiles(cwd: string): DirtyFiles {
  const fields = runGit(
    cwd,
    ["status", "--porcelain", "-z", "--untracked-files=all"],
  ).split("\0");
  const trackedModified: string[] = [];
  const untracked: string[] = [];
  let i = 0;
  while (i < fields.length) {
    const entry = fields[i];
    i += 1;
    if (entry.length === 0) continue; // trailing empty after the final NUL
    const xy = entry.slice(0, 2);
    const filePath = entry.slice(3); // skip the single space between XY and the path
    if (xy === "??") {
      untracked.push(filePath);
      continue;
    }
    const indexCol = xy[0];
    const worktreeCol = xy[1];
    if (indexCol === "R" || indexCol === "C") i += 1; // consume the rename's source path
    if (worktreeCol === "M" || worktreeCol === "D" || worktreeCol === "T") {
      trackedModified.push(filePath);
    }
  }
  return { trackedModified, untracked };
}

// The subset of `paths` whose worktree differs from the index —
// `git diff --name-only -z -- <paths>`. Passing the paths as pathspecs scopes git's
// diff to exactly them; we then intersect git's answer with the input so the result
// is literally a subset of `paths`, in input order. An empty `paths` short-circuits
// (a bare `git diff` with no pathspec would report the whole tree).
export function unstagedDrift(cwd: string, paths: string[]): string[] {
  if (paths.length === 0) return [];
  const drifted = new Set(
    splitNul(runGit(cwd, ["diff", "--name-only", "-z", "--", ...paths])),
  );
  return paths.filter((p) => drifted.has(p));
}

// Absolute path to the gitdir git resolves for `cwd`. For a linked worktree — where
// `.git` is a FILE pointing at `<repo>/.git/worktrees/<name>` rather than a directory
// — this returns that per-worktree gitdir, whose own `index` is the right one to stat.
// So indexMtimeMs never assumes a literal `<cwd>/.git/index`.
function absoluteGitDir(cwd: string): string {
  return runGit(cwd, ["rev-parse", "--absolute-git-dir"]).trim();
}

// mtime of the index in epoch milliseconds — statSync(.git/index).mtimeMs — resolving
// the real gitdir first so a worktree's `.git` file is followed to its linked index.
// A zero-index repo has no index file yet (git writes .git/index only on the first
// `git add`); rather than throw, we fall back to the gitdir's own mtime as a sensible
// freshness proxy, and to 0 only if even that cannot be stat'd.
export function indexMtimeMs(cwd: string): number {
  const gitDir = absoluteGitDir(cwd);
  try {
    return statSync(path.join(gitDir, "index")).mtimeMs;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw err; // a real stat fault stays loud
    try {
      return statSync(gitDir).mtimeMs; // zero-index repo: use the gitdir's mtime
    } catch (gitDirErr) {
      const gitDirCode = (gitDirErr as NodeJS.ErrnoException).code;
      if (gitDirCode !== "ENOENT" && gitDirCode !== "ENOTDIR") throw gitDirErr;
      return 0;
    }
  }
}

// worktree mtime (epoch ms) for each of `paths` that EXISTS; missing paths are omitted
// from the Map (freshness maxes only over "staged files that exist", §2.6). Keys are
// the caller's original path strings; a path that does not resolve to a stat'able file
// is left out, while any OTHER stat error is re-thrown rather than hidden.
export function worktreeMtimes(cwd: string, paths: string[]): Map<string, number> {
  const mtimes = new Map<string, number>();
  for (const p of paths) {
    const abs = path.isAbsolute(p) ? p : path.join(cwd, p);
    try {
      mtimes.set(p, statSync(abs).mtimeMs);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw err; // omit only true absences
    }
  }
  return mtimes;
}

// Short one-line subject of HEAD — `git log -1 --format=%s` — or null on an unborn
// branch (no commit to describe), which git reports as a non-zero exit.
export function headShortSubject(cwd: string): string | null {
  const out = tryGit(cwd, ["log", "-1", "--format=%s"]);
  if (out === null) return null;
  const subject = out.replace(/\r?\n$/, "");
  return subject.length > 0 ? subject : null;
}

// Full 40-hex HEAD sha, or null on a zero-commit repo. This is the load-bearing null:
// it feeds freshness §2.6's HEAD term (which must be VACUOUS, not a crash, before the
// first commit) and run.startHead. `rev-parse --verify HEAD` exits non-zero on an
// unborn HEAD, which tryGit maps to null.
export function headSha(cwd: string): string | null {
  const out = tryGit(cwd, ["rev-parse", "--verify", "HEAD"]);
  if (out === null) return null;
  const sha = out.trim();
  return sha.length > 0 ? sha : null;
}

// Current branch name, or null when HEAD is detached. `symbolic-ref --short HEAD`
// resolves HEAD's symref target, so it WORKS on an unborn branch (returns e.g. "main"
// even before the first commit) and exits non-zero when HEAD is detached (or the dir
// is not a repo) — both mapped to null by tryGit.
export function currentBranch(cwd: string): string | null {
  const out = tryGit(cwd, ["symbolic-ref", "--short", "HEAD"]);
  if (out === null) return null;
  const branch = out.trim();
  return branch.length > 0 ? branch : null;
}

// True iff `cwd` is inside a git work tree; false (never a throw) for a plain
// directory. `rev-parse --is-inside-work-tree` prints "true" inside a work tree and
// exits non-zero outside any repo (mapped to null → false by tryGit).
export function isRepo(cwd: string): boolean {
  const out = tryGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return out !== null && out.trim() === "true";
}

// The §3.9:1500-1502 "initialize a repo here" branch: `git init` in `cwd`, run
// by the HANDLER under the same execFileSync/argv discipline as every read above
// (never a shell string, never a model session — core/gates-git.ts denies
// session-side git writes outright). The ONLY write this module performs, and it
// is deliberately narrow: no commit, no config, no remote, no branch rename.
//
// Returns true when this call created the repository, false when `cwd` already
// was one (idempotent, so a caller that re-derives isRepo sees the same answer
// either way). A git that cannot run, or an init that leaves `cwd` still outside
// a work tree, throws — an init nobody can see is worse than a loud failure.
export function initRepo(cwd: string): boolean {
  if (isRepo(cwd)) return false;
  runGit(cwd, ["init", "-q"]);
  if (!isRepo(cwd)) {
    throw new Error(`gitio: \`git init\` in ${cwd} left it outside a work tree`);
  }
  return true;
}

// Absolute path to the repository's COMMON gitdir — `rev-parse --git-common-dir`,
// resolved against `cwd` when git answers with a relative path (a main repo
// answers the literal ".git"). Inside a linked worktree this names the MAIN
// repository's .git directory, which is the only place an info/exclude entry is
// effective — an exclude written into the per-worktree gitdir is inert (C-021).
// Null outside any repository.
export function gitCommonDir(cwd: string): string | null {
  const out = tryGit(cwd, ["rev-parse", "--git-common-dir"]);
  if (out === null) return null;
  const dir = out.trim();
  if (dir.length === 0) return null;
  return path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
}
