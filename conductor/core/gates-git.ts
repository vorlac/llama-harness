// conductor/core/gates-git.ts — §3.5 git deny matrix (Task 5.1; plan lines
// 2324-2349, and the NORMATIVE matrix at §3.5 lines 1362-1385). The single most
// security-critical gate in the harness: an enumerated-allow / DEFAULT-DENY
// posture over a possibly-adversarial local model. A missing allow row only
// annoys the model (it surfaces a question); a missing deny row lets `git apply`
// write arbitrary files straight around the edit-scope gate.
//
// Core module: pure. Imports ONLY its core sibling shell-parse.ts (G3) — no
// filesystem, no subprocesses, no runtime globals, no wall clock, no network.
//
// How the command is consumed (the Phase-1 binding, §3.5 line 1362 and the
// task-5.1 phaseGate1Bindings): the RAW command is tokenized with the
// quote-aware §1.2 splitter, split into segments on operators AND newlines, and
// EVERY segment is scanned. Detection sees through env-assignment prefixes
// (`A=b git …`), one wrapper (`env`/`command`/`sudo`/`builtin`/`exec`), and path
// basenames (`/usr/bin/git`, `./git`) — all via the hardened shell-parse
// primitives. ANY denied git segment denies the whole command; a non-git segment
// never denies; an allowed git read never rescues a later denied write.
//
// The decision is taken over the FULL parsed token segment, NOT solely
// gitSubcommand's single-word return — the two-word discriminators (`stash list`
// vs `stash push`, `branch` vs `branch -D`, `worktree list` vs `worktree add`, …)
// are load-bearing. Matching is on parsed TOKENS, never a substring regex, so a
// verb word inside a path (`git add src/config.ts` → `add`) or a message
// (`git commit -m "fix reset logic"` → `commit`) never misfires.

import {
  shellTokens,
  splitOnOperators,
  isGitCommand,
  gitSubcommand,
} from "./shell-parse.ts";

// ---------------------------------------------------------------------------
// Return contract (signature pinned by conductor/tests/gates-git.test.ts).
// ---------------------------------------------------------------------------

export type GitAction = "allow" | "deny";

export interface GitDecision {
  action: GitAction;
  reason?: string;
}

const ALLOW: GitDecision = { action: "allow" };

function deny(reason: string): GitDecision {
  return { action: "deny", reason };
}

// ---------------------------------------------------------------------------
// The exhaustive read-only allow-list (§3.5 line 1372) split into two groups:
//   - SIMPLE: allowed regardless of operands (the verb alone is read-only).
//   - the discriminated subcommands (stash/worktree/remote/config/reflog/branch/
//     checkout/switch/restore) are decided over their operands below.
// Typed `readonly string[]` so `.includes(sub)` accepts the widened subcommand
// string (erasable syntax: no enum, no const-assertion narrowing needed).
// ---------------------------------------------------------------------------

const READ_ONLY_SIMPLE: readonly string[] = [
  "status",
  "log",
  "diff",
  "show",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "rev-list",
  "cat-file",
  "blame",
  "shortlog",
  "describe",
  "grep",
];

// §3.5 line 1373: staging is conductor_publish's job. The reason NAMES the legal
// alternative (conductor_publish) so the model is pointed at the right door.
const STAGING: readonly string[] = ["add", "mv", "rm"];

// §3.5 line 1376: destructive, history-manipulating, network-mutating, or a write
// path around the edit gate — human territory, always denied regardless of
// operands. `apply` is the single most important row: it writes files around the
// edit-scope gate entirely.
const DESTRUCTIVE: readonly string[] = [
  "reset",
  "rebase",
  "filter-branch",
  "filter-repo",
  "clean",
  "merge",
  "cherry-pick",
  "revert",
  "am",
  "apply",
  "update-ref",
  "symbolic-ref",
  "sparse-checkout",
  "submodule",
  "bisect",
  "gc",
  "prune",
  "notes",
  "replace",
  "fetch",
  "pull",
];

// Branch mutating flags (§3.5 lines 1378-1379): the operands that turn the
// allow-listed `branch` (list forms) into a deny — the REQUIRED false-ALLOW trap
// is `git branch -D x`, which MUST deny even though `branch` is on the allow-list.
const BRANCH_MUTATING: readonly string[] = [
  "-d",
  "-D",
  "--delete",
  "-m",
  "-M",
  "--move",
  "-c",
  "-C",
  "--copy",
  "-f",
  "--force",
  "-u",
  "--set-upstream-to",
  "--unset-upstream",
  "--edit-description",
];

// ---------------------------------------------------------------------------
// Reason builders. Every deny carries a non-empty reason (§3.5 line 1338:
// `throw new Error(reason)`), naming the violated rule and, where one exists, the
// legal alternative.
// ---------------------------------------------------------------------------

function stagingReason(verb: string): string {
  return (
    "git " +
    verb +
    " stages changes — staging is conductor_publish's job, not a model session's"
  );
}

const COMMIT_REASON =
  "git commit publishes changes — publishing is conductor_publish's job, not a model session's";

const PUSH_REASON =
  "git push is handler-only and mode-gated (git.mode); it never runs from a model session";

function destructiveReason(sub: string): string {
  return (
    "git " +
    sub +
    " is destructive, history-manipulating, network-mutating, or writes files around the edit-scope gate — human territory, not a model session"
  );
}

function defaultDenyReason(sub: string): string {
  return (
    "git " +
    sub +
    " is not on the git read-only allow-list; request it via conductor_surface if it is genuinely needed (default-deny)"
  );
}

const BARE_GIT_REASON =
  "git was invoked with no subcommand — nothing on the read-only allow-list matches (default-deny)";

// ---------------------------------------------------------------------------
// The branch-movement policy gate (§3.5 line 1380). `switch <br>`, `checkout
// <br>`, and `checkout -b` MOVE HEAD; while a run is non-terminal under
// branchPolicy "pin" they deny (the run is pinned to its branch), under
// "check-only" they allow (publish's HEAD check catches the consequence), and
// under "pin" with no active run they allow. The force-create and worktree-discard
// forms are UNCONDITIONAL denies decided by their callers — they never reach here.
// ---------------------------------------------------------------------------

function movement(
  runActive: boolean,
  branchPolicy: "pin" | "check-only",
): GitDecision {
  if (branchPolicy === "check-only") return ALLOW;
  if (runActive) {
    return deny(
      "branch movement is denied while a run is active under git.branchPolicy 'pin' — the run is pinned to its branch; it is allowed once the run terminates",
    );
  }
  return ALLOW;
}

// A path-like operand (a pathspec that checkout would use to DISCARD working-tree
// changes) versus a branch/ref name. `.`/`..` and anything containing "/" is a
// path; a bare name is a ref.
function isPathLike(operand: string): boolean {
  return operand === "." || operand === ".." || operand.includes("/");
}

function includesAny(operands: string[], flags: readonly string[]): boolean {
  for (const op of operands) {
    if (flags.includes(op)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The discriminated subcommands. Each is decided over its full operand list.
// ---------------------------------------------------------------------------

function decideStash(operands: string[]): GitDecision {
  const op = operands[0];
  if (op === "list") return ALLOW; // the read-only side (§3.5 line 1372)
  if (op === "push" || op === undefined) {
    // `stash push` (and bare `git stash`, which implies push) stages changes.
    return deny(stagingReason("stash push"));
  }
  // drop/clear/pop/apply/save/… all mutate the stash (§3.5 line 1379).
  return deny(
    "git stash " +
      op +
      " mutates the stash — destructive, human territory, not a model session",
  );
}

function decideWorktree(operands: string[]): GitDecision {
  if (operands[0] === "list") return ALLOW;
  return deny(
    "git worktree " +
      (operands[0] ?? "") +
      " manages worktrees — that is adapter/worktrees.ts's job (§4.3), not a model session",
  );
}

function decideRemote(operands: string[]): GitDecision {
  const op = operands[0];
  if (op === "-v" || op === "--verbose") return ALLOW; // `remote -v` (§3.5 line 1372)
  return deny(
    "git remote " +
      (op ?? "") +
      " mutates remotes (add/set-url/remove/rename) — human territory, not a model session",
  );
}

function decideConfig(operands: string[]): GitDecision {
  const op = operands[0];
  // `config --get`/`--list` are the only read forms on the allow-list; a
  // `<key> <value>` write or `--unset` denies (§3.5 lines 1372, 1376).
  if (op === "--list" || op === "-l" || (op !== undefined && op.startsWith("--get"))) {
    return ALLOW;
  }
  return deny(
    "git config here writes or unsets configuration — only config --get/--list read forms are allowed; this is human territory",
  );
}

function decideReflog(operands: string[]): GitDecision {
  if (operands[0] === "show") return ALLOW; // `reflog show` (§3.5 line 1372)
  return deny(
    "git reflog " +
      (operands[0] ?? "") +
      " mutates the reflog (expire/delete) — only reflog show is allowed; human territory",
  );
}

function decideBranch(operands: string[]): GitDecision {
  // The false-ALLOW trap: `branch` is on the read-only allow-list, but any
  // mutating flag (delete/rename/copy/force/upstream) turns it into a write.
  if (includesAny(operands, BRANCH_MUTATING)) {
    return deny(
      "git branch with a delete/rename/copy/force/upstream flag mutates refs — only the read-only list forms (`branch`, `branch --list`) are allowed",
    );
  }
  return ALLOW; // list forms (§3.5 line 1372)
}

function decideCheckout(
  operands: string[],
  runActive: boolean,
  branchPolicy: "pin" | "check-only",
): GitDecision {
  // Worktree-discard and force-create forms are UNCONDITIONAL denies (§3.5 line
  // 1378) — they ignore branch policy entirely.
  if (operands.includes("--")) {
    return deny(
      "git checkout -- <path> discards working-tree changes — unconditional deny (worktree-discarding form)",
    );
  }
  if (operands.includes("-B")) {
    return deny(
      "git checkout -B force-creates/resets a branch — unconditional deny (force-create form)",
    );
  }
  // `checkout -b <br>` creates-and-moves: branch movement, policy-gated.
  if (operands.includes("-b")) return movement(runActive, branchPolicy);

  const positionals = operands.filter((o) => !o.startsWith("-"));
  if (positionals.length >= 2) {
    return deny(
      "git checkout <ref> <path> is a multi-operand form that discards working-tree files — unconditional deny",
    );
  }
  if (positionals.length === 1 && isPathLike(positionals[0])) {
    return deny(
      "git checkout <path> discards working-tree changes — unconditional deny (worktree-discarding form)",
    );
  }
  // A single branch-like operand (or none): branch movement, policy-gated.
  return movement(runActive, branchPolicy);
}

function decideSwitch(
  operands: string[],
  runActive: boolean,
  branchPolicy: "pin" | "check-only",
): GitDecision {
  if (operands.includes("-C") || operands.includes("--force-create")) {
    return deny(
      "git switch -C force-creates a branch — unconditional deny (force-create form)",
    );
  }
  return movement(runActive, branchPolicy); // `switch <br>` is branch movement
}

function decideRestore(operands: string[]): GitDecision {
  // `--worktree` (or `-W`) discards working-tree changes — deny even alongside
  // `--staged` (§3.5 line 1378).
  if (operands.includes("--worktree") || operands.includes("-W")) {
    return deny(
      "git restore --worktree discards working-tree changes — unconditional deny (worktree-discarding form)",
    );
  }
  // `--staged` (or `-S`) alone restores the index only — allowed.
  if (operands.includes("--staged") || operands.includes("-S")) return ALLOW;
  // No `--staged`: the default restore target is the working tree — a discard.
  return deny(
    "git restore without --staged discards working-tree changes — unconditional deny (worktree-discarding form)",
  );
}

// ---------------------------------------------------------------------------
// Per-segment decision over the full parsed tokens.
// ---------------------------------------------------------------------------

function decideGitSegment(
  seg: string[],
  runActive: boolean,
  branchPolicy: "pin" | "check-only",
): GitDecision {
  const sub = gitSubcommand(seg);
  if (sub === null) return deny(BARE_GIT_REASON);

  // Operands = the tokens after the subcommand. The subcommand is the FIRST
  // decision token gitSubcommand returns, so its first index in the segment is
  // its position; slicing after it can only ever WIDEN the operand list (never
  // narrow it), so this can only tighten — never loosen — a decision.
  const subIndex = seg.indexOf(sub);
  const operands = subIndex < 0 ? [] : seg.slice(subIndex + 1);

  // Read-only verbs allowed regardless of operands.
  if (READ_ONLY_SIMPLE.includes(sub)) return ALLOW;

  // Staging → conductor_publish.
  if (STAGING.includes(sub)) return deny(stagingReason(sub));

  // Committing in ANY spelling → conductor_publish.
  if (sub === "commit") return deny(COMMIT_REASON);

  // Pushing (plain, +refspec, :refspec, force — all parse as `push`) → deny.
  if (sub === "push") return deny(PUSH_REASON);

  // Destructive / history / network / write-around-gate verbs.
  if (DESTRUCTIVE.includes(sub)) return deny(destructiveReason(sub));

  // Two-word discriminated subcommands, decided over their operands.
  if (sub === "stash") return decideStash(operands);
  if (sub === "worktree") return decideWorktree(operands);
  if (sub === "remote") return decideRemote(operands);
  if (sub === "config") return decideConfig(operands);
  if (sub === "reflog") return decideReflog(operands);
  if (sub === "branch") return decideBranch(operands);
  if (sub === "checkout") return decideCheckout(operands, runActive, branchPolicy);
  if (sub === "switch") return decideSwitch(operands, runActive, branchPolicy);
  if (sub === "restore") return decideRestore(operands);

  // DEFAULT-DENY: any subcommand not on the read-only allow-list and not an
  // explicit row. The reason NAMES the offending subcommand (so the model can
  // surface it). This is the rule that makes the table's completeness a non-issue.
  return deny(defaultDenyReason(sub));
}

// ---------------------------------------------------------------------------
// The gate entry point.
//
// git policy is role- and mode-uniform for model sessions: the publish/commit
// handler runs git through execFile inside the plugin, which is not a tool call
// and never reaches this gate, so sessionRole and gitMode do not branch the
// decision. Only the branch-movement rows read runActive/branchPolicy.
// ---------------------------------------------------------------------------

export function decideGit(
  command: string,
  sessionRole: string,
  gitMode: "read-only" | "commit" | "commit-and-push",
  runActive: boolean,
  branchPolicy: "pin" | "check-only",
): GitDecision {
  void sessionRole;
  void gitMode;
  const segments = splitOnOperators(shellTokens(command));
  for (const seg of segments) {
    if (!isGitCommand(seg)) continue; // non-git segments never deny
    const decision = decideGitSegment(seg, runActive, branchPolicy);
    if (decision.action === "deny") return decision; // any denied git segment denies the whole command
  }
  return { action: "allow" };
}
