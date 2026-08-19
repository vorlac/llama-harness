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
  gitInvocation,
  commandWordLocation,
} from "./shell-parse.ts";
import type { GitInvocation } from "./shell-parse.ts";

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

// The LIST forms of `git branch` (§3.5 lines 1372, 1378-1379). Only these are
// read-only, and the arm is an enumerated allow with a DEFAULT-DENY tail: an
// allow arm built the other way round — everything not on a hand-list of
// mutating flags — admitted bare branch CREATION (`git branch newbranch` writes
// a ref) and let the `=`-glued `--set-upstream-to=origin/x` past an exact-token
// comparison that only knew the spaced spelling (ISSUE-020).
const BRANCH_LIST_FLAGS: readonly string[] = [
  "--list",
  "-l",
  "-a",
  "--all",
  "-r",
  "--remotes",
  "-v",
  "-vv",
  "--verbose",
  "-q",
  "--quiet",
  "-i",
  "--ignore-case",
  "--show-current",
  "--color",
  "--no-color",
  "--column",
  "--no-column",
  "--omit-empty",
  "--no-abbrev",
  "--contains",
  "--no-contains",
  "--merged",
  "--no-merged",
  "--points-at",
  "--sort",
  "--format",
  "--abbrev",
];

// The list flags that take a VALUE. In the bare spelling the value is the
// following token — a positional that must not be read as a branch name to
// create. The `--flag=value` spelling carries its own value and consumes nothing.
const BRANCH_LIST_VALUE_FLAGS: readonly string[] = [
  "--contains",
  "--no-contains",
  "--merged",
  "--no-merged",
  "--points-at",
  "--sort",
  "--format",
  "--abbrev",
];

// The list flags that turn a positional operand into a match PATTERN rather than
// a branch name to create (`git branch --list 'feat/*'`).
//
// `-l` is NOT one of them, though it is a list flag on its own: it spells
// `--create-reflog` on git < 2.28, where `git branch -l topic` CREATES `topic`.
// The gate cannot see which git version is on the other side of the call, so the
// spelling that means two things is read as the one that writes a ref — the
// positional beside it is a branch NAME, and the enumerated allow denies it. Bare
// `-l` stays on BRANCH_LIST_FLAGS: with no operand neither reading writes anything.
const BRANCH_PATTERN_FLAGS: readonly string[] = ["--list"];

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

// The flag name of an operand token, with any `=`-glued value stripped: the
// comparison must see `--set-upstream-to` in `--set-upstream-to=origin/x`, the
// same normalization the gate already applies to `--git-dir=`.
function flagName(token: string): string {
  const eq = token.indexOf("=");
  return eq === -1 ? token : token.slice(0, eq);
}

const BRANCH_NOT_LIST_REASON =
  "git branch here is not a read-only list form — creating, deleting, renaming, copying, or re-pointing a branch writes a ref; only the list forms (`branch`, `branch --list <pattern>`, `-a`/`-r`/`-v`, and the list filters) are allowed";

function decideBranch(operands: string[]): GitDecision {
  // Enumerated allow, DEFAULT-DENY tail. Any flag off the list-form enumeration
  // is a write (delete/rename/copy/force/upstream/track/edit-description), and a
  // positional operand is a branch NAME to create unless a pattern flag makes it
  // a match pattern.
  const patternMode = operands.some((op) => BRANCH_PATTERN_FLAGS.includes(flagName(op)));
  for (let i = 0; i < operands.length; i += 1) {
    const token = operands[i];
    if (token.startsWith("-")) {
      const name = flagName(token);
      if (!BRANCH_LIST_FLAGS.includes(name)) return deny(BRANCH_NOT_LIST_REASON);
      // A bare value-taking list filter consumes the following token as its
      // value, so that token is not a branch name.
      if (!token.includes("=") && BRANCH_LIST_VALUE_FLAGS.includes(name)) i += 1;
      continue;
    }
    if (!patternMode) return deny(BRANCH_NOT_LIST_REASON);
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
  if (
    operands.includes("-f") ||
    operands.includes("--force") ||
    operands.includes("--discard-changes")
  ) {
    return deny(
      "git checkout -f/--force/--discard-changes discards working-tree changes — unconditional deny (worktree-discarding form)",
    );
  }
  // `checkout -p`/`--patch` discards selected working-tree hunks and moves no
  // HEAD, so publish's HEAD check cannot see the loss — it belongs with the other
  // unconditional discard forms rather than on the policy-gated movement path,
  // where `check-only` allowed it (ISSUE-021). The sibling `restore -p` denies.
  if (operands.includes("-p") || operands.includes("--patch")) {
    return deny(
      "git checkout -p/--patch discards selected working-tree hunks — unconditional deny (worktree-discarding form)",
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
  if (
    operands.includes("-f") ||
    operands.includes("--force") ||
    operands.includes("--discard-changes")
  ) {
    return deny(
      "git switch -f/--force/--discard-changes discards working-tree changes — unconditional deny (worktree-discarding form)",
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
// Config- and environment-driven EXECUTION (ISSUE-015). `git -c core.pager=<cmd>
// log` runs <cmd>: the command word is the literal `git` (so the unresolvable-
// expansion rule never engages), `-c k=v` is skipped by subcommand resolution
// (plan line 2089 mandates the skip), and the decision lands on an allow-listed
// read-only verb — while git executes the configured pager, external diff,
// editor, credential helper, hook, or alias. `GIT_PAGER=<cmd> git log` is the
// same route through the environment, and env-assignment prefixes are seen
// through by detection without their VALUES ever being adjudicated.
//
// Both rules are keyed on the exec-capable KEY, not on `-c` or on env prefixes as
// such: `git -c user.name=x log` and `A=b git status` are untouched. Every other
// global option spelling (`--exec-path=…`, `--config-env=…`, a glued `-ckey=v`)
// is already deny-forcing — subcommand resolution returns the unrecognized flag
// verbatim and the matrix default-denies it.
// ---------------------------------------------------------------------------

// Config SECTIONS whose every key names a program git runs.
const EXEC_CONFIG_SECTIONS: readonly string[] = [
  "alias",
  "pager",
  "credential",
  "difftool",
  "mergetool",
  "filter",
  "trailer",
  "guitool",
  "instaweb",
];

// Final key components whose value git executes, whatever section or subsection
// carries them: `core.pager`, `diff.external`, `sequence.editor`,
// `diff.<driver>.command`, `filter.<f>.clean`, `remote.<r>.uploadpack`, …
const EXEC_CONFIG_LEAVES: readonly string[] = [
  "pager",
  "editor",
  "external",
  "command",
  "cmd",
  "driver",
  "clean",
  "smudge",
  "process",
  "helper",
  "program",
  "browser",
  "textconv",
  "packobjectshook",
  "sshcommand",
  "askpass",
  "hookspath",
  "gitproxy",
  "proxy",
  "fsmonitor",
  "uploadpack",
  "receivepack",
  "templatedir",
  "httpd",
  "hook",
];

// git config section and final-key names are case-insensitive, so the fold is
// git's own rule rather than an extra allowance.
function isExecConfigKey(key: string): boolean {
  const parts = key.toLowerCase().split(".");
  if (EXEC_CONFIG_SECTIONS.includes(parts[0])) return true;
  return EXEC_CONFIG_LEAVES.includes(parts[parts.length - 1]);
}

// Environment variables that hand git a program to run, or hand it configuration
// that can name one (the `GIT_CONFIG_*` family injects config wholesale).
const EXEC_ENV_VARS: readonly string[] = [
  "GIT_PAGER",
  "GIT_EXTERNAL_DIFF",
  "GIT_EDITOR",
  "GIT_SEQUENCE_EDITOR",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_ASKPASS",
  "GIT_PROXY_COMMAND",
  "GIT_EXEC_PATH",
  "GIT_TEMPLATE_DIR",
  "GIT_TEXTCONV",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "PAGER",
  "EDITOR",
  "VISUAL",
];

const EXEC_ENV_PREFIXES: readonly string[] = ["GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_"];

function isExecEnvName(name: string): boolean {
  if (EXEC_ENV_VARS.includes(name)) return true;
  for (const prefix of EXEC_ENV_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  return false;
}

const ENV_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=/;

function configExecReason(key: string): string {
  return (
    "git -c " +
    key +
    " hands git a program to execute — a config key of this shape runs an arbitrary command under any subcommand, including a read-only one; request it via conductor_surface if it is genuinely needed"
  );
}

function envExecReason(name: string): string {
  return (
    name +
    " hands git a program to execute — an environment prefix of this shape runs an arbitrary command under any subcommand, including a read-only one; request it via conductor_surface if it is genuinely needed"
  );
}

// The exec-route denial for one git segment, or null when it carries none.
// `gitIndex` is the git command-word index: assignments before it are the
// segment's environment prefix. `optionEnd` bounds the scan to git's OWN global
// options — the region before the subcommand — so a subcommand's own `-c` (`git
// grep -c <pattern>` counts matches) is never read as a config assignment.
function configExecDenial(
  seg: string[],
  gitIndex: number,
  optionEnd: number,
): GitDecision | null {
  for (let i = 0; i < gitIndex; i += 1) {
    const match = ENV_ASSIGNMENT.exec(seg[i]);
    if (match !== null && isExecEnvName(match[1])) return deny(envExecReason(match[1]));
  }
  for (let i = gitIndex + 1; i < optionEnd; i += 1) {
    const token = seg[i];
    if (token !== "-c" && token !== "--config-env") continue;
    const value = i + 1 < seg.length ? seg[i + 1] : "";
    const eq = value.indexOf("=");
    const key = eq === -1 ? value : value.slice(0, eq);
    if (key.length > 0 && isExecConfigKey(key)) return deny(configExecReason(key));
    i += 1; // the option's value token is consumed either way
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-segment decision over the full parsed tokens.
// ---------------------------------------------------------------------------

function decideGitSegment(
  seg: string[],
  invocation: GitInvocation,
  runActive: boolean,
  branchPolicy: "pin" | "check-only",
): GitDecision {
  // The execution routes that ride a git invocation rather than its subcommand:
  // an exec-capable `-c` config key, or an exec-capable environment prefix. Both
  // are decided BEFORE the subcommand, because the whole point of the route is
  // that the subcommand is a legal read-only one (ISSUE-015).
  const configDenial = configExecDenial(seg, invocation.index, invocation.operandStart - 1);
  if (configDenial !== null) return configDenial;

  const sub = invocation.sub;
  if (sub === null) return deny(BARE_GIT_REASON);

  // Operands = the tokens after the subcommand, from the resolution that found
  // the subcommand — so the dashed dispatch form (`git-branch -D x`, where the
  // subcommand rides the binary name and appears in NO token) exposes the same
  // operands the spaced form does.
  const operands = seg.slice(invocation.operandStart);

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
// Unresolvable command word (fail-safe deny). After the §1.2 splitter resolves
// the ordinary quoting spellings, a residual command word can still be one whose
// real value is produced by shell expansion the static parser cannot evaluate:
// an ANSI-C escape residual (`$'\x67it'` → the literal `\x67it`, which a real
// shell decodes to `git`), a variable (`$x`), a backtick command substitution,
// or a `${…}`/`$(…)` splice glued into the word. Detection resolves the command
// word by token equality, so such a word reads as "not git" and would let a git
// write straight through. These deny the whole command fail-safe.
// ---------------------------------------------------------------------------

// True when a command-word token still carries an unresolved shell-expansion
// sigil: a backtick, a `$` opening a `$'…'`/`$"…"` span or a `${…}`/`$(…)`
// splice or a `$VAR` reference, or a backslash escape a real shell would decode
// (§1.2 keeps the `$'\x67it'` residual as the literal `\x67it`). The command
// that word names is knowable only at shell runtime — deny fail-safe.
function hasUnresolvedExpansion(word: string): boolean {
  for (let i = 0; i < word.length; i += 1) {
    const ch = word[i];
    if (ch === "`" || ch === "\\") return true;
    if (ch === "$") {
      const next = i + 1 < word.length ? word[i + 1] : "";
      if (
        next === "'" ||
        next === '"' ||
        next === "{" ||
        next === "(" ||
        next === "_" ||
        (next >= "A" && next <= "Z") ||
        (next >= "a" && next <= "z") ||
        (next >= "0" && next <= "9")
      ) {
        return true;
      }
    }
  }
  return false;
}

const UNRESOLVABLE_REASON =
  "unresolvable command word (shell expansion in command position); use conductor_surface if the command is genuinely needed";

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
    const loc = commandWordLocation(seg);
    // Fail-safe: a wrapper (sudo/env/…) whose own options consumed the segment —
    // or a second wrapper level the unwrap landed on — leaves the real command
    // word unknowable to the static parser. The wrapper resolves it at runtime and
    // it could be a git write (`sudo -u bob git push`), so DENY rather than treat
    // the segment as non-git (the C-022 unresolvable-command-word posture).
    if (loc.unresolvable) return deny(UNRESOLVABLE_REASON);
    // Fail-safe: a command word computed by unresolvable shell expansion denies
    // the whole command — it could resolve to a git write detection cannot see.
    const word = loc.index === null ? null : seg[loc.index];
    if (word !== null && hasUnresolvedExpansion(word)) return deny(UNRESOLVABLE_REASON);
    const invocation = gitInvocation(seg);
    if (invocation === null) continue; // non-git segments never deny
    const decision = decideGitSegment(seg, invocation, runActive, branchPolicy);
    if (decision.action === "deny") return decision; // any denied git segment denies the whole command
  }
  return { action: "allow" };
}
