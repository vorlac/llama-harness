// conductor/adapter/worktrees.ts — Task 9.6: the §4.2 worktree mode's git-worktree
// lifecycle (plan lines 2699-2728; §4.2 lines 1605-1617).
//
// An ADAPTER (G14): it shells out to git, so it lives outside the pure core, and it
// runs under BOTH the opencode runtime and Node type-stripping — cross-runtime
// built-ins only. Every git invocation mirrors gitio.ts's module discipline:
// execFileSync with an argv array (shell:false is the default; no shell string
// anywhere) under an environment scrub that strips the repo-location overrides —
// GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE / GIT_COMMON_DIR — so a stray value
// inherited from the parent process can never redirect a worktree write onto some
// other repository. The scrub is applied PER CALL (not snapshotted at module load),
// because the poison arrives in process.env at call time.
//
// The worktree lives OUTSIDE the repository, at
// <stateHome>/conductor/<workspaceKey>/worktrees/<runId>/<itemId> — the same
// out-of-repo coordinates as quarantineDirFor, and for the same reason with more
// force (§4.2): a worktree inside the repo is a complete second copy of every test
// file, which the main tree's whole-tree verify runner would then discover and
// execute, including other items' in-progress red tests.
//
// Path-id trust boundary (F2/F3): workspaceKey, runId and itemId compose a path
// that is later removed and pruned, so each is guarded by state.ts's assertSafeId
// BEFORE any git call — a traversing id is refused, never composed.
//
// Interfaces (the pinned 9.6 surface):
//   createWorktree(workspace, runId, itemId, ctx) -> the worktree path
//   mergeBack(workspace, runId, itemId, ctx)      -> { ok, conflict }
//   removeWorktree(workspace, runId, itemId, ctx) -> void

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import * as path from "node:path";

import { assertSafeId } from "./state.ts";
import { currentBranch, isRepo } from "./gitio.ts";

// The out-of-repo state coordinates every worktree path composes under.
export interface WorktreeContext {
  stateHome: string;
  workspaceKey: string;
}

export interface MergeBackResult {
  ok: boolean;
  conflict: boolean;
}

// The per-call environment scrub (the gitio discipline). GIT_DIR, GIT_WORK_TREE,
// GIT_INDEX_FILE and GIT_COMMON_DIR are stripped so `cwd` is the sole authority
// for which repository is written; GIT_TERMINAL_PROMPT forbids interactive
// prompts; GIT_MERGE_AUTOEDIT keeps a merge commit from ever opening an editor.
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_COMMON_DIR;
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_MERGE_AUTOEDIT = "no";
  return env;
}

// Run git and require success. A non-zero exit is rethrown with git's own stderr
// so the caller sees why; a spawn failure (git missing from PATH) stays loud as-is.
function runGit(cwd: string, args: string[]): void {
  try {
    execFileSync("git", args, { cwd, env: gitEnv(), stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status !== "number") throw err;
    const stderr = (err as { stderr?: unknown }).stderr;
    const detail =
      stderr instanceof Buffer ? stderr.toString("utf8").trim() : typeof stderr === "string" ? stderr.trim() : "";
    throw new Error(
      "worktrees: `git " +
        args.join(" ") +
        "` exited " +
        String(status) +
        (detail.length > 0 ? ": " + detail : ""),
    );
  }
}

// Run git where a non-zero exit is a RESULT the caller reads (an impossible
// fast-forward, a conflicted merge, an already-gone worktree), not an error.
// A spawn failure is still rethrown — a real environment fault stays loud.
function tryGit(cwd: string, args: string[]): number {
  try {
    execFileSync("git", args, { cwd, env: gitEnv(), stdio: ["ignore", "pipe", "pipe"] });
    return 0;
  } catch (err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status !== "number") throw err;
    return status;
  }
}

// The ONE pure branch-name rule, shared by create, merge-back and remove. An
// explicit name is load-bearing: a bare `git worktree add` names the branch after
// the path BASENAME (the itemId), which collides across runs.
function branchOf(runId: string, itemId: string): string {
  return "conductor/" + assertSafeId(runId, "runId") + "/" + assertSafeId(itemId, "itemId");
}

// The §4.2 out-of-repo location (quarantineDirFor's shape, worktree flavor).
// Guards every composed id FIRST — this path is later removed and pruned, so the
// id guard is a trust boundary, not tidiness.
function worktreePathOf(ctx: WorktreeContext, runId: string, itemId: string): string {
  assertSafeId(ctx.workspaceKey, "workspaceKey");
  assertSafeId(runId, "runId");
  assertSafeId(itemId, "itemId");
  return path.join(ctx.stateHome, "conductor", ctx.workspaceKey, "worktrees", runId, itemId);
}

/**
 * Add a linked worktree for one wave item at
 * <stateHome>/conductor/<workspaceKey>/worktrees/<runId>/<itemId>, on the explicit
 * branch conductor/<runId>/<itemId>, and return that path.
 *
 * Refusals throw BEFORE any git write: an unsafe id (assertSafeId) and §3.9 no-git
 * mode (a workspace that is not a repository cannot be handed a worktree the rest
 * of the pipeline would treat as a tree). `git worktree prune` runs BEFORE the add
 * — crash healing at the next worktree operation, the stale-marker-break idiom: a
 * crashed run that deleted its directory but left git's administrative entry
 * behind never wedges a later run. No daemon, no persisted state.
 */
export function createWorktree(
  workspace: string,
  runId: string,
  itemId: string,
  ctx: WorktreeContext,
): string {
  const worktree = worktreePathOf(ctx, runId, itemId);
  if (!isRepo(workspace)) {
    throw new Error(
      'worktrees: refusing to create a worktree for item "' +
        itemId +
        '": the workspace ' +
        workspace +
        " is not a git repository, so §3.9 no-git mode is in force and worktree mode is disabled",
    );
  }
  runGit(workspace, ["worktree", "prune"]);
  mkdirSync(path.dirname(worktree), { recursive: true });
  runGit(workspace, ["worktree", "add", "-b", branchOf(runId, itemId), worktree]);
  return worktree;
}

/**
 * Merge the item's branch back into the workspace's own current branch. Serial by
 * construction: the caller (publish, itself serial in item order) invokes this
 * synchronously, and the workspace index is a singleton (§4.3).
 *
 * Branch identity is verified FIRST: the recomposed conductor/<runId>/<itemId>
 * name is checked against the worktree's actually-checked-out branch, and a
 * mismatch THROWS naming the expected branch with no merge attempted — a renamed
 * or stale branch is never merged silently.
 *
 * Then `git merge --ff-only` is attempted first and a normal merge is only the
 * fallback (§4.2). A conflicted merge is aborted (`git merge --abort`) before
 * returning { ok: false, conflict: true }, so the workspace is left with no
 * MERGE_HEAD, a clean status and no conflict markers — a poisoned mid-merge tree
 * would break every later merge and every integrated-tree verify.
 */
export function mergeBack(
  workspace: string,
  runId: string,
  itemId: string,
  ctx: WorktreeContext,
): MergeBackResult {
  const worktree = worktreePathOf(ctx, runId, itemId);
  const branch = branchOf(runId, itemId);
  const checkedOut = currentBranch(worktree);
  if (checkedOut !== branch) {
    throw new Error(
      'worktrees: refusing merge-back for item "' +
        itemId +
        '": the worktree at ' +
        worktree +
        ' has "' +
        String(checkedOut) +
        '" checked out where branch "' +
        branch +
        '" was expected — a renamed or stale branch is never merged silently',
    );
  }
  if (tryGit(workspace, ["merge", "--ff-only", branch]) === 0) {
    return { ok: true, conflict: false };
  }
  if (tryGit(workspace, ["merge", branch]) === 0) {
    return { ok: true, conflict: false };
  }
  // A conflicted merge leaves MERGE_HEAD behind; anything else failed before a
  // merge ever started (an unmergeable ref, a dirty workspace) and is an error,
  // not a conflict outcome.
  if (tryGit(workspace, ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]) !== 0) {
    throw new Error(
      'worktrees: the merge of "' +
        branch +
        '" into ' +
        workspace +
        " failed without starting a merge — this is an environment fault, not a content conflict",
    );
  }
  runGit(workspace, ["merge", "--abort"]);
  return { ok: false, conflict: true };
}

/**
 * Remove the item's worktree AND delete its branch. `git worktree remove --force`
 * (the tree may hold untracked build artifacts); when the directory is already
 * gone — a crash, a manual rm — the prune fallback still clears git's
 * administrative entry. The branch delete is a separate step on BOTH paths,
 * because `git worktree remove` leaves the branch behind; -D, because a crashed
 * run's branch may be unmerged. A branch already gone is tolerated — cleanup is
 * idempotent, and the administrative entry is what must never survive.
 */
export function removeWorktree(
  workspace: string,
  runId: string,
  itemId: string,
  ctx: WorktreeContext,
): void {
  const worktree = worktreePathOf(ctx, runId, itemId);
  if (tryGit(workspace, ["worktree", "remove", "--force", worktree]) !== 0) {
    runGit(workspace, ["worktree", "prune"]);
  }
  tryGit(workspace, ["branch", "-D", branchOf(runId, itemId)]);
}
