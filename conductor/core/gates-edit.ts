// conductor/core/gates-edit.ts — the §3.5 session-registry gate and edit-scope
// gate (Task 5.2; plan lines 2351-2374, normative rules at §3.5 lines 1344-1413).
// These two gates constrain a possibly-adversarial local model's writes: the
// registry gate decides whether an unregistered/childless session may act at
// all (and unconditionally forbids sub-agent spawning — the load-bearing half,
// §3.5:1356-1360), and the edit-scope gate decides which files a registered
// session may write, tree-relative, with the per-tree verify FREEZE on top.
//
// Core module: pure. Imports ONLY its core siblings shell-parse.ts and the two
// tree types of types.ts (G3) — no
// filesystem, no subprocesses, no runtime globals, no network, no wall clock.
// The bash write-shape extractor reuses the SAME hardened quote-aware tokenizer
// and operator segmentation the git gate uses, so a write hidden behind an
// `env sh -c "..."` wrapper is analyzed identically to a bare one (the Task 5.2
// phaseGate1 binding).

import { shellTokens, splitOnOperators, globMatch } from "./shell-parse.ts";
import type { TreePath, ToolClass } from "./types.ts";

// ---------------------------------------------------------------------------
// Return contract (signature pinned by conductor/tests/gates-edit.test.ts). A
// DENY always carries a non-empty reason naming the violated rule; an ALLOW may
// omit it. Same shape as Task 5.1's GitDecision.
// ---------------------------------------------------------------------------

export type EditAction = "allow" | "deny";

export interface Decision {
  action: EditAction;
  reason?: string;
}

const ALLOW: Decision = { action: "allow" };

function deny(reason: string): Decision {
  return { action: "deny", reason };
}

// ===========================================================================
// Session-registry gate (§3.5 lines 1344-1360). Runs FIRST, before every other
// gate. Dispatches on the session's registry entry and the tool CLASS.
// ===========================================================================

export interface SessionInput {
  registered: boolean;
  role: string | null;
  toolName: string;
  toolClass: ToolClass;
}

export function decideSession(input: SessionInput): Decision {
  const { registered, toolClass } = input;

  // The spawn deny is UNCONDITIONAL — every session, registered or not. Without
  // it an implementer could create a child session conductor never registered
  // (no role, no item, no scope) and have that child perform exactly the writes
  // the implementer is gated out of. A registry gate whose registry can be
  // grown by a tool call is not a gate (§3.5:1356-1360).
  if (toolClass === "spawn") {
    return deny(
      "sub-agent spawn (the task tool) is denied in every session, registered or not — a child session conductor never registered would perform exactly the writes this session is scoped out of",
    );
  }

  // A registered session passes the registry gate for any non-spawn call; its
  // role/scope is a LATER gate's job (decideEdit), not this one's.
  if (registered) {
    return ALLOW;
  }

  // Unregistered from here down.
  if (toolClass === "read") {
    // A stray reader is harmless and not worth a confusing failure.
    return ALLOW;
  }
  if (toolClass === "conductor") {
    return deny(
      "conductor state advances only from registered sessions; this session has no registry entry",
    );
  }
  // toolClass === "write"
  return deny(
    "this session has no conductor item assignment — an edit/write needs a registered item scope; obtain one through conductor rather than writing unassigned",
  );
}

// ===========================================================================
// Edit-scope gate (§3.5 lines 1387-1413). Applies to edit/write/patch tools and
// bash write-shaped commands. Order: tree-relative normalization, then the
// per-tree FREEZE (strict reading), then the everyone-.conductor deny, then the
// per-role scope check. The registry gate above is a SEPARATE, earlier gate, so
// `registered` is not re-adjudicated here.
// ===========================================================================

export interface EditInput {
  sessionRole: string;
  registered: boolean;
  fileScope: string[];
  // The §2.4 testScope this path is judged against. For a session the registry
  // binds to an item, that item's testScope. For the ORCHESTRATOR seat, which
  // binds to no item, the run's testScopes — the gate is pure, so the only way it
  // can tell a session that its denied path belongs to a test-writer is for the
  // composition root to hand it the scopes that say so.
  testScope: string[];
  path: string;
  // Both are tree PATHS: the tree comparison below is string equality against an
  // absolute edit path, so an evidence-layer slug here denies everything (the
  // C-037 ruling 5 misfeed; core/types.ts brands the two apart).
  verifyInFlightTree: TreePath | null;
  sessionTree: TreePath;
  inlineClaimScope: string[] | null;
}

// Roles that may never write: they read the tree and report (§3.5:1394).
export const READER_ROLES: readonly string[] = ["reviewer", "skeptic", "planner", "mechanical"];

function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === "/") end -= 1;
  return s.slice(0, end);
}

// Evaluate `absPath` relative to the session's tree: strip the tree prefix so
// item scopes (which are tree-relative) and the `.conductor/**` deny both match
// the NORMALIZED path, never the worktree-root prefix. A worktree file at
// <tree>/src/a.ts normalizes to src/a.ts even when <tree> itself lives under a
// `.conductor` state home — the prefix must not false-deny (§3.5:1409-1413).
//
// A path that is NOT under the tree returns null, and the caller denies outright.
// It used to be returned unchanged, on the reasoning that an absolute path
// "matches no tree-relative scope". That reasoning was wrong for any
// WILDCARD-HEADED scope: globMatch("**", "/etc/passwd") is true, because `**`
// spans separators including the leading one. So an item whose fileScope is `**`
// — which verifyScopePathsOf produces for an item that declares no paths — or
// `**/*.ts` granted edit permission to any absolute path on the machine. The `..`
// guard does not help, because no traversal is needed when the path is already
// absolute (C-055, found by the Phase 9 milestone gate).
function normalizeUnderTree(absPath: string, tree: string): string | null {
  const t = stripTrailingSlashes(tree);
  if (absPath === t) return "";
  const prefix = t + "/";
  if (absPath.startsWith(prefix)) return absPath.slice(prefix.length);
  return null;
}

// True when a (normalized) path carries a `..` path segment. normalizeUnderTree
// does not collapse `..`, and globMatch treats `..` as a literal segment a `**`
// swallows, so a scope like `src/a/**` would MATCH a path that resolves out of
// scope — into `.conductor`, a sibling item, or out of the repo. A legitimate
// in-scope edit path never contains `..`, so its presence is denied outright.
function hasDotDotSegment(normalized: string): boolean {
  for (const seg of normalized.split("/")) {
    if (seg === "..") return true;
  }
  return false;
}

// The spelling of a path under which two names that are ONE FILE on a
// case-insensitive filesystem compare equal. Used only by the state-area deny,
// where over-matching costs an editable path name and under-matching costs the
// harness its state.
function foldForStateArea(path: string): string {
  return path.normalize("NFKC").toLowerCase();
}

// True when any glob in `scopes` matches the (tree-relative) path. globMatch is
// the hardened, DoS-safe matcher from shell-parse.ts.
function scopeMatches(scopes: string[], normalized: string): boolean {
  for (const glob of scopes) {
    if (globMatch(glob, normalized)) return true;
  }
  return false;
}

export function decideEdit(input: EditInput): Decision {
  const {
    sessionRole,
    fileScope,
    testScope,
    path,
    verifyInFlightTree,
    sessionTree,
    inlineClaimScope,
  } = input;

  // 1. Tree-relative normalization FIRST — every later check reads the result.
  //    A path outside the tree is denied HERE rather than left for a scope match
  //    to reject, because a wildcard-headed scope would have accepted it.
  const normalized = normalizeUnderTree(path, sessionTree);
  if (normalized === null) {
    return deny(
      "the path is outside this session's tree; an edit is confined to the tree the session was " +
        "dispatched into (§3.5), and no item scope can widen that",
    );
  }

  // 1b. Path traversal — deny any `..` segment BEFORE scope matching. `..` lets
  //     an in-scope glob reach the .conductor state area, a sibling item, or out
  //     of the repo entirely (see hasDotDotSegment). No legitimate edit path
  //     carries one, so this is a fail-safe deny that closes those escapes.
  if (hasDotDotSegment(normalized)) {
    return deny(
      "path traversal (`..`) is denied; an in-scope edit path never contains a `..` segment",
    );
  }

  // 2. FREEZE — precedes scope. Keyed on explicit tree EQUALITY (not the mere
  //    presence of a marker somewhere, and not any freshness field a per-kind
  //    record could leave undefined). While a verify marker is live for THIS
  //    tree, EVERY edit here is denied under the STRICT reading (§3.5:1396-1401)
  //    — production, config, AND a test-writer editing inside its own testScope,
  //    which §4.2's quarantine safety argument requires. A different tree's
  //    marker, or none, does not freeze this tree.
  if (
    verifyInFlightTree !== null &&
    stripTrailingSlashes(verifyInFlightTree) === stripTrailingSlashes(sessionTree)
  ) {
    return deny(
      "a verify marker is live for this tree (freeze); every edit here — source, test, or config — is denied until the verify clears",
    );
  }

  // 3. Everyone: the `.conductor/**` state area is handler-written only, matched
  //    against the NORMALIZED path (the current tree's state area) so a
  //    `.conductor` prefix on the tree root never false-denies (§3.5:1395,1412).
  //    Matched CASE-FOLDED, because the filesystem this defends is
  //    case-insensitive: `.Conductor/runs/<id>/state.json` and
  //    `.conductor/runs/<id>/state.json` are one file on darwin and on Windows,
  //    so a byte-exact match let a session forge run state, evidence, and journal
  //    through the other spelling (ISSUE-016). `headsOverlap` folds case for
  //    exactly this reason. The fold is on the DENY comparison only, and it folds
  //    compatibility forms too, so a fullwidth or decomposed spelling of the token
  //    is the state area as well.
  if (globMatch(".conductor/**", foldForStateArea(normalized))) {
    return deny(
      "the .conductor state area is handler-written only; no session may edit .conductor/** paths",
    );
  }

  // 4. Per-role scope.
  if (sessionRole === "orchestrator") {
    // G8: deny ALL source edits unless an ACTIVE inline claim scopes the path.
    // A present-but-non-matching claim still denies — the claim must scope it.
    if (inlineClaimScope !== null && scopeMatches(inlineClaimScope, normalized)) {
      return ALLOW;
    }
    // A refusal that names an exit the denied path does not have costs the
    // session its next turn and returns it to the same wall. A path inside an
    // item's testScope has no inline-claim exit at all: §3.6 scopes a claim to
    // the item's fileScope, §2.4 holds fileScope and testScope disjoint, so no
    // claim that could ever be granted covers a testScope path. The exit that
    // does exist there is conductor_submit_test, which dispatches the test-writer
    // that owns the file — so the refusal names THAT. The covering globs are
    // quoted the way the implementer branch quotes them: a reader can check the
    // claim against the item's own §2.4 scope.
    const coveringTest = testScope.filter((glob) => globMatch(glob, normalized));
    if (coveringTest.length > 0) {
      return deny(
        `this path is inside an item's testScope [${coveringTest.join(", ")}], and no inline claim reaches it (G8): a claim scopes the item's fileScope (§3.6) and §2.4 holds fileScope and testScope disjoint, so taking one leaves this same edit denied. conductor_submit_test dispatches the test-writer that owns this file — that is the way through`,
      );
    }
    return deny(
      "the orchestrator may not edit source without an active inline claim scoping this path (G8); use conductor_inline_claim if dispatch is genuinely more expensive than doing",
    );
  }

  if (sessionRole === "implementer") {
    // The implementer's writable set is fileScope MINUS testScope, and the
    // subtraction is checked FIRST so a scope that covers both answers the same
    // way a scope that covers only the test does. Queue acceptance refuses an item
    // whose fileScope covers its own testScope, and mark_green's digest witness
    // catches a rewritten vetted test afterwards — but the witness speaks only
    // once a whole sub-session has been spent, and a session gated to write the
    // test it must PASS is a licence to make the proof agree with the code
    // (§2.4 / §4.2). Denied here, where the question costs nothing.
    const covering = testScope.filter((glob) => globMatch(glob, normalized));
    if (covering.length > 0) {
      return deny(
        `this path is inside the item's testScope [${covering.join(", ")}] — an implementer may never edit the test that proves its own item, whatever its fileScope also covers; the test is the test-writer's territory`,
      );
    }
    if (scopeMatches(fileScope, normalized)) {
      return ALLOW;
    }
    return deny(
      `this path is outside the item's fileScope [${fileScope.join(", ")}] — an implementer may edit only its assigned source scope`,
    );
  }

  if (sessionRole === "testWriter") {
    if (scopeMatches(testScope, normalized)) {
      return ALLOW;
    }
    return deny(
      `a test-writer may edit only its item's testScope [${testScope.join(", ")}]; this path is outside it`,
    );
  }

  if (READER_ROLES.includes(sessionRole)) {
    return deny(`${sessionRole} is a read-only role and may not edit files`);
  }

  // Unknown role: fail safe.
  return deny(`role "${sessionRole}" has no edit scope; edits are denied`);
}

// ===========================================================================
// Bash write-target extraction (§3.5:1387-1388, Task 5.2 phaseGate1 binding).
// Surfaces the paths a command WRITES — `>`/`>>` redirect targets, `tee`
// operands, `sed -i` in-place targets, `mv`/`cp` DESTINATIONS, and `rm` targets
// — while pure reads (`cat`, `grep`, the SOURCES of mv/cp) surface nothing.
// Wrapper-aware: a write behind `env sh -c "..."` / `sh -c "..."` is analyzed by
// re-running this SAME extraction over the inner command string.
// ===========================================================================

const OPERATOR_CHARS = ";&|<>()";
// A file redirect operator run: `>`, `>>`, the both-streams forms `&>`, `&>>`,
// and the bash force-overwrite forms `>|` / `&>|` (a trailing `|` on the run).
// Deliberately NOT `>&` (that duplicates a file descriptor, not a file).
const REDIRECT_TO_FILE = /^&?>>?\|?$/;
// The null device. Bytes redirected here reach no tree, so a redirect naming it is
// not a write and adjudicating it as one refuses `cmd 2>/dev/null` — the ordinary
// way a shell command says it does not care about stderr — as an out-of-tree write.
// Matched exactly, so a path that merely starts with it (`/dev/nullish`) is a write
// like any other.
const NULL_DEVICE = "/dev/null";
// A shell env-assignment token in command-prefix position (`NAME=value`).
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
// Leading command wrappers that pass their tail through to another command.
// Unwrapped ITERATIVELY, together with each wrapper's own flags, flag values, and
// (for `env`) its `NAME=value` assignments: a single bare-word level of unwrap
// resolved `env -i sh -c "rm x"` to the command word `-i` and `env FOO=1 sh -c
// "…"` to `FOO=1`, so the inner command reached neither the write-shape
// extraction nor the interpreter state-area rule, and the whole command
// classified as a harmless read. Every wrapper here passes its tail through, so
// the write behind it is the write the segment performs.
const WRAPPERS: readonly string[] = [
  "env",
  "command",
  "sudo",
  "builtin",
  "exec",
  "nice",
  "nohup",
  "time",
  "timeout",
  "xargs",
  "stdbuf",
  "ionice",
];

// Each wrapper's value-taking flags: a BARE `-x` of one of these consumes the
// FOLLOWING token as its value, so the command word is the token after the value.
// A self-contained `--flag=value` carries its own and consumes nothing.
const WRAPPER_VALUE_FLAGS: Record<string, readonly string[]> = {
  env: ["-u", "-C", "-S", "--unset", "--chdir", "--split-string"],
  sudo: ["-u", "-g", "-C", "-h", "-p", "-r", "-t", "-U"],
  command: [],
  builtin: [],
  exec: ["-a"],
  nice: ["-n", "--adjustment"],
  nohup: [],
  time: ["-o", "-f", "--output", "--format"],
  timeout: ["-s", "-k", "--signal", "--kill-after"],
  xargs: ["-n", "-I", "-i", "-P", "-d", "-s", "-a", "-E", "-L", "-e", "--max-args", "--replace", "--max-procs", "--delimiter", "--arg-file"],
  stdbuf: ["-i", "-o", "-e", "--input", "--output", "--error"],
  ionice: ["-c", "-n", "-p", "--class", "--classdata", "--pid"],
};

// Wrappers that take a POSITIONAL operand of their own before the command word:
// `timeout 5 rm x` runs `rm`, not `5`.
const WRAPPER_POSITIONAL_OPERANDS: Record<string, number> = { timeout: 1 };
// Shell interpreters whose `-c` argument is an inner command string to reanalyze.
const SHELLS: readonly string[] = ["sh", "bash", "dash", "zsh", "ksh"];
// Bound on wrapper recursion so a pathological `sh -c "sh -c ..."` nest cannot
// wedge the extractor (it runs on every write-shaped bash gate check).
const MAX_WRAPPER_DEPTH = 8;

// The basename of a command word: `/usr/bin/rm` and `./rm` both resolve to `rm`.
function commandBasename(word: string): string {
  const slash = word.lastIndexOf("/");
  return slash === -1 ? word : word.slice(slash + 1);
}

// The command NAME a segment runs, resolved the way a case-insensitive filesystem
// resolves it: basename first (`/usr/bin/rm` and `./rm` are both `rm`), then
// case-folded on the SAME terms as the state-area deny (foldForStateArea). Every
// membership test in this section — WRAPPERS, SHELLS, INTERPRETERS, and the
// write-shaped command set (`rm`, `tee`, `mv`, …) — reads THIS, so one
// case-insensitive resolution governs all of them. The basename had already been
// folded on the state-area PATH TOKEN (the P2 fix) but NOT on the command names, so
// on a case-insensitive FS (APFS, NTFS) `/usr/bin/PYTHON3`, `NODE`, `ENV`, `SH`,
// `RM` are the very tools those lists name and a byte-exact match let every
// upper/mixed-case spelling walk past all three gates (R0, same class as P2).
// Folding is fail-closed: a lower-case-only tool set that also matches upper
// case can only DENY more, never allow more — no ALLOW arm keys off a command name,
// so surfacing more write shapes and unwrapping more wrappers only widens detection.
function resolvedCommandName(word: string): string {
  return foldForStateArea(commandBasename(word));
}

// A token made solely of operator-run characters (or a newline token): never a
// redirect target filename.
function isOperatorRun(tok: string): boolean {
  if (tok === "\n") return true;
  if (tok.length === 0) return false;
  for (const ch of tok) {
    if (!OPERATOR_CHARS.includes(ch)) return false;
  }
  return true;
}

// The index of the command word in a segment: skip leading `NAME=value`
// env-assignments, then unwrap EVERY leading wrapper (`env -i`, `nice -n 10`,
// `timeout 5`, `xargs -n 1`, …) together with its own flags, its flag values, and
// its positional operands, until a token that is neither an assignment nor a
// wrapper is reached. That token is the command word. Returns seg.length when the
// segment is empty or the wrappers consumed it — the caller surfaces no target,
// which is the same posture the segment had before any unwrap.
//
// The loop advances `i` on every iteration, so it terminates on any input.
function unwrappedCommandIndex(seg: string[]): number {
  let i = 0;
  while (i < seg.length) {
    if (ENV_ASSIGNMENT.test(seg[i])) {
      i += 1;
      continue;
    }
    // Resolved to a BASENAME before the membership test, exactly as the command
    // word one line below is resolved and as the git gate resolves its own: a
    // token-exact test made `/usr/bin/env sh -c "…"` and every other path spelling
    // of a listed wrapper fall out of the unwrap, so the inner command was never
    // analyzed and the write behind it surfaced nothing.
    const wrapper = resolvedCommandName(seg[i]);
    if (!WRAPPERS.includes(wrapper)) break;
    i += 1;
    const valueFlags = WRAPPER_VALUE_FLAGS[wrapper] ?? [];
    let positionals = WRAPPER_POSITIONAL_OPERANDS[wrapper] ?? 0;
    while (i < seg.length) {
      const token = seg[i];
      if (wrapper === "env" && ENV_ASSIGNMENT.test(token)) {
        i += 1;
        continue;
      }
      if (token === "--") {
        i += 1;
        break;
      }
      if (token.startsWith("-") && token.length > 1) {
        i += 1;
        if (!token.includes("=") && valueFlags.includes(token)) i += 1;
        continue;
      }
      if (positionals > 0) {
        positionals -= 1;
        i += 1;
        continue;
      }
      break; // the first plain token past the wrapper's own operands
    }
  }
  return i;
}

// A `sed` in-place flag: `-i`, `-i.bak`, `--in-place`, `--in-place=.bak`.
function isInPlaceFlag(tok: string): boolean {
  return tok.startsWith("-i") || tok.startsWith("--in-place");
}

// A `perl` in-place flag: a single-dash bundle whose letters include `i`
// (`-i`, `-i.bak`, `-pi`, `-ni`, `-pi.orig`). The `i` is what turns perl's
// -p/-n loop into an in-place rewrite of its file operands.
function isPerlInPlaceFlag(tok: string): boolean {
  return /^-[A-Za-z]*i/.test(tok);
}

// ---------------------------------------------------------------------------
// Interpreter one-liners (the Phase III fix round).
//
// The extractor above reads SHELL write shapes: a redirect, `tee`, `sed -i`, an
// `mv` destination. `node -e "require('fs').writeFileSync(p, s)"` is none of
// those, and neither is `python3 -c "open(p,'w').write(s)"` — so both classified
// as class `read`, took no edit-gate decision, and wrote wherever they liked. That
// hole reached all the way into the provenance channel: the ONE artifact the
// design says a gated session cannot produce is a file under `.conductor`, and a
// session holding the bash tool could mint one with a single interpreter call.
//
// Two rules, because the two cases are different. A recognized write CALL yields
// its path operand, which then meets the ordinary edit gate like any other write.
// A script that so much as MENTIONS `.conductor` is refused whole
// (interpreterStateAreaScript), path operand or not: a program text can build the
// path it writes to, and a state-area write is the one case where guessing wrong
// costs the harness its only proof of human authorship.
// ---------------------------------------------------------------------------

// Interpreters whose `-e`/`-c` argument is a PROGRAM to run, not a file to read.
const INTERPRETERS: readonly string[] = [
  "node",
  "nodejs",
  "bun",
  "deno",
  "python",
  "python2",
  "python3",
  "perl",
  "ruby",
];

// The flags that carry the program text. Perl's single-dash bundles (`-pe`,
// `-lne`, `-nE`) end in the eval letter and take the program as the next token.
function isScriptFlag(token: string): boolean {
  if (token === "-e" || token === "-c" || token === "-E" || token === "--eval") return true;
  return /^-[A-Za-z]*[eE]$/.test(token);
}

// The program strings an interpreter invocation carries, in operand order.
function interpreterScripts(operands: readonly string[]): string[] {
  const scripts: string[] = [];
  for (let i = 0; i < operands.length; i += 1) {
    const token = operands[i];
    if (token.startsWith("--eval=")) {
      scripts.push(token.slice("--eval=".length));
      continue;
    }
    if (isScriptFlag(token) && i + 1 < operands.length) {
      scripts.push(operands[i + 1]);
      i += 1;
    }
  }
  return scripts;
}

// The write calls a one-liner makes, each paired with the string literal that is
// its path operand. Deliberately an enumeration rather than a heuristic: a name on
// this list is a write in the language it belongs to, and a caller reading the
// list can check that claim.
const NODE_FS_WRITE =
  /(?:^|[^A-Za-z0-9_$])(?:writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|openSync|truncateSync|copyFileSync|cpSync|renameSync|rmSync|unlinkSync|mkdirSync|rmdirSync)\s*\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
// `open(path, mode)` where the mode asks for anything but a plain read.
const PY_OPEN_WRITE = /\bopen\s*\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*(['"])([^'"]*)\3/g;
const PY_PATH_WRITE = /\bPath\s*\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*\)\s*\.\s*write_(?:text|bytes)\s*\(/g;
const PY_OS_WRITE =
  /\b(?:os\s*\.\s*(?:remove|unlink|rename|replace|makedirs|mkdir|rmdir|truncate)|shutil\s*\.\s*(?:copy|copy2|copyfile|move|rmtree))\s*\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
const RUBY_WRITE =
  /\b(?:File\s*\.\s*(?:write|binwrite|open|delete|unlink|rename)|IO\s*\.\s*write|FileUtils\s*\.\s*(?:cp|mv|rm|rm_rf|mkdir_p))\s*\(?\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
// Perl's `open(FH, ">", $path)` and the two-argument `open(FH, ">$path")`.
const PERL_OPEN_WRITE = /\bopen\s*\(?[^,]{0,64},\s*(['"])\s*\+?>>?\s*((?:\\.|(?!\1)[^\\])*)\1(?:\s*,\s*(['"])((?:\\.|(?!\3)[^\\])*)\3)?/g;
const PERL_UNLINK = /\bunlink\s*\(?\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;

function pushMatches(script: string, pattern: RegExp, group: number, out: string[]): void {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null = pattern.exec(script);
  while (match !== null) {
    const target = match[group];
    if (target !== undefined && target.length > 0) out.push(target);
    match = pattern.exec(script);
  }
}

/**
 * The paths one interpreter one-liner writes, as far as its literal operands say.
 * Exported for the audit that pins the recognized shapes; the gate reaches it
 * through writeShapedPaths.
 */
export function interpreterWritePaths(script: string): string[] {
  const out: string[] = [];
  pushMatches(script, NODE_FS_WRITE, 2, out);
  pushMatches(script, PY_PATH_WRITE, 2, out);
  pushMatches(script, PY_OS_WRITE, 2, out);
  pushMatches(script, RUBY_WRITE, 2, out);
  pushMatches(script, PERL_UNLINK, 2, out);

  PY_OPEN_WRITE.lastIndex = 0;
  let open: RegExpExecArray | null = PY_OPEN_WRITE.exec(script);
  while (open !== null) {
    // Mode `r` (and `rb`) alone is a read; every other letter opens for writing.
    if (/[wax+]/.test(open[4])) out.push(open[2]);
    open = PY_OPEN_WRITE.exec(script);
  }

  PERL_OPEN_WRITE.lastIndex = 0;
  let perl: RegExpExecArray | null = PERL_OPEN_WRITE.exec(script);
  while (perl !== null) {
    // Three-argument form: the mode is its own literal and the path follows.
    const target = perl[2].length > 0 ? perl[2] : perl[4];
    if (target !== undefined && target.length > 0) out.push(target);
    perl = PERL_OPEN_WRITE.exec(script);
  }
  return out;
}

// The `.conductor` state area, as a program text mentions it.
const STATE_AREA_TOKEN = ".conductor";

/**
 * The first interpreter program in this command that names the `.conductor` state
 * area, or null when none does. A hit is refused OUTRIGHT by the caller rather
 * than resolved to a path: the one thing the state area proves is that no gated
 * session wrote it, and a proof that holds only for the path shapes this file
 * happens to parse is not a proof.
 *
 * Wrapper-aware on the same terms as writeShapedPaths — a one-liner behind
 * `env sh -c "..."` is found by re-running the walk over the inner string.
 */
export function interpreterStateAreaScript(command: string): string | null {
  const found: string[] = [];
  collectStateAreaScripts(command, found, 0);
  return found.length > 0 ? found[0] : null;
}

function collectStateAreaScripts(command: string, out: string[], depth: number): void {
  if (depth > MAX_WRAPPER_DEPTH) return;
  for (const seg of splitOnOperators(shellTokens(command))) {
    const cmdIdx = unwrappedCommandIndex(seg);
    if (cmdIdx >= seg.length) continue;
    const cmd = resolvedCommandName(seg[cmdIdx]);
    const operands = seg.slice(cmdIdx + 1);
    if (SHELLS.includes(cmd)) {
      const ci = operands.indexOf("-c");
      if (ci !== -1 && ci + 1 < operands.length) {
        collectStateAreaScripts(operands[ci + 1], out, depth + 1);
      }
      continue;
    }
    if (!INTERPRETERS.includes(cmd)) continue;
    for (const script of interpreterScripts(operands)) {
      // Folded on the same terms as the edit-path deny (GAP-026): the filesystem
      // this rule defends is case-insensitive, so `.Conductor/x` and `.conductor/x`
      // are one file, and a byte-exact test read a one-liner writing the state area
      // under the other spelling as an ordinary program.
      if (foldForStateArea(script).includes(STATE_AREA_TOKEN)) out.push(script);
    }
  }
}

// ---------------------------------------------------------------------------
// Network shapes (Task 21.4).
//
// Denying the `webfetch` NAME leaves `curl https://…` reaching the same network
// through the bash tool. A config flag cannot close that: the bash lane is not
// reached by it. So the shape is read from the command, through the SAME
// tokenizer, the SAME operator segmentation and the SAME wrapper unwrapping the
// write-shape extractor uses — a deny that could be spelled around by choosing
// `env sh -c` would be no deny at all.
//
// This is an ENUMERATION, deliberately, on the same terms as the write-shaped
// command set: a name on this list reaches the network, and a reader can check
// that claim. Its limit is that a program NOT on the list is not detected, which
// is recorded in HONEST-LIMITS rather than papered over.
// ---------------------------------------------------------------------------

// Programs whose purpose is to move bytes over a network.
//
// `git` is absent on purpose: it has its own gate, which adjudicates the whole
// command including its remote-touching subcommands, and a second opinion here
// would deny `git log` for being spelled `git`.
//
// Package managers are absent too. `npm`, `pip` and `bun` fetch, but they are
// also how a repo's own toolchain runs, and denying them would remove far more
// than a network lane. That is a real gap and it is recorded as one.
const NETWORK_PROGRAMS: readonly string[] = [
  "curl",
  "wget",
  "nc",
  "ncat",
  "netcat",
  "ssh",
  "scp",
  "sftp",
  "rsync",
  "ftp",
  "telnet",
];

// The network calls an interpreter one-liner makes. Same rule and same reason as
// the interpreter WRITE shapes above: a one-liner passed to `node -e` is not a
// shell network program, so without this it classifies as an ordinary read the
// way an interpreter write once did.
//
// Two shapes. A bare call, where the function name stands alone; and a dotted
// one, where the module path may be several segments deep, as in the Python
// `urllib.request` and `http.client` forms.
const SCRIPT_NETWORK = new RegExp(
  [
    "(?:^|[^A-Za-z0-9_$.])(?:fetch|XMLHttpRequest)\\s*\\(",
    "\\b(?:requests|axios|httpx|urllib|http|https|net|tls|socket)\\b" +
      "(?:\\s*\\.\\s*[A-Za-z_][A-Za-z0-9_]*)*" +
      "\\s*\\.\\s*(?:get|post|put|head|delete|patch|request|urlopen|urlretrieve|" +
      "createConnection|connect|HTTPConnection|HTTPSConnection)\\s*\\(",
  ].join("|"),
);

/**
 * The network programs a command invokes, de-duplicated in first-seen order.
 *
 * Empty for a command that reaches no enumerated network program. The names are
 * returned rather than a boolean so a refusal can quote what it saw: "denied"
 * teaches nothing, "denied: curl" tells the reader which spelling to stop using.
 */
export function networkShapedCommands(command: string): string[] {
  const out: string[] = [];
  collectNetworkPrograms(command, out, 0);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of out) {
    if (!seen.has(name)) {
      seen.add(name);
      unique.push(name);
    }
  }
  return unique;
}

function collectNetworkPrograms(command: string, out: string[], depth: number): void {
  if (depth > MAX_WRAPPER_DEPTH) return;
  for (const seg of splitOnOperators(shellTokens(command))) {
    const cmdIdx = unwrappedCommandIndex(seg);
    if (cmdIdx >= seg.length) continue;
    const cmd = resolvedCommandName(seg[cmdIdx]);
    const operands = seg.slice(cmdIdx + 1);

    if (SHELLS.includes(cmd)) {
      const ci = operands.indexOf("-c");
      if (ci !== -1 && ci + 1 < operands.length) {
        collectNetworkPrograms(operands[ci + 1], out, depth + 1);
      }
      continue;
    }

    if (INTERPRETERS.includes(cmd)) {
      for (const script of interpreterScripts(operands)) {
        if (SCRIPT_NETWORK.test(script)) out.push(cmd);
      }
      continue;
    }

    if (NETWORK_PROGRAMS.includes(cmd)) {
      out.push(cmd);
      continue;
    }

    // `xargs curl` names its child as an OPERAND, not through `-c`, and
    // unwrappedCommandIndex consumes the wrapper's operands along with it. The
    // wrapper's own tail is therefore re-read for a network program name.
    if (WRAPPERS.includes(cmd)) {
      for (const op of operands) {
        if (NETWORK_PROGRAMS.includes(resolvedCommandName(op))) {
          out.push(resolvedCommandName(op));
        }
      }
    }
  }
}

export function writeShapedPaths(command: string): string[] {
  const out: string[] = [];
  collectWriteTargets(command, out, 0);
  // De-duplicate, preserving first-seen order.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const target of out) {
    if (!seen.has(target)) {
      seen.add(target);
      unique.push(target);
    }
  }
  return unique;
}

function collectWriteTargets(command: string, out: string[], depth: number): void {
  if (depth > MAX_WRAPPER_DEPTH) return;
  const tokens = shellTokens(command);

  // Redirect targets: the token following a `>`/`>>`/`&>`/`&>>` operator run,
  // scanned over the raw token stream (redirects do not survive segmentation).
  for (let i = 0; i < tokens.length; i++) {
    if (REDIRECT_TO_FILE.test(tokens[i])) {
      const next = tokens[i + 1];
      if (next !== undefined && !isOperatorRun(next) && next !== NULL_DEVICE) {
        out.push(next);
      }
    }
  }

  // Per-command analysis over operator/newline-segmented tokens.
  for (const seg of splitOnOperators(tokens)) {
    const cmdIdx = unwrappedCommandIndex(seg);
    if (cmdIdx >= seg.length) continue;
    const cmd = resolvedCommandName(seg[cmdIdx]);
    const operands = seg.slice(cmdIdx + 1);

    if (SHELLS.includes(cmd)) {
      // Wrapper-aware: `-c <inner>` re-analyzes the inner command string.
      const ci = operands.indexOf("-c");
      if (ci !== -1 && ci + 1 < operands.length) {
        collectWriteTargets(operands[ci + 1], out, depth + 1);
      }
      continue;
    }

    // An interpreter one-liner's write calls, before the per-command branches:
    // `perl` reaches both this and its own in-place rule below, so no `continue`.
    if (INTERPRETERS.includes(cmd)) {
      for (const script of interpreterScripts(operands)) {
        for (const target of interpreterWritePaths(script)) out.push(target);
      }
    }

    if (cmd === "tee") {
      // Every non-flag operand is a written file (`-a`/`-i`/`--append` skipped).
      for (const op of operands) {
        if (!op.startsWith("-")) out.push(op);
      }
      continue;
    }

    if (cmd === "sed") {
      // Only `-i` in-place edits write; the file operands (all non-flag operands
      // after the leading script) are the targets.
      if (!operands.some(isInPlaceFlag)) continue;
      const nonFlag = operands.filter((op) => !op.startsWith("-"));
      for (let i = 1; i < nonFlag.length; i++) out.push(nonFlag[i]);
      continue;
    }

    if (cmd === "mv" || cmd === "cp") {
      // The DESTINATION (last non-flag operand) is written; the sources are reads.
      const nonFlag = operands.filter((op) => !op.startsWith("-"));
      if (nonFlag.length >= 2) out.push(nonFlag[nonFlag.length - 1]);
      continue;
    }

    if (cmd === "rm") {
      // Every non-flag operand is a removed (written) target — all of them.
      for (const op of operands) {
        if (!op.startsWith("-")) out.push(op);
      }
      continue;
    }

    if (cmd === "perl") {
      // `perl -pi`/`-i` rewrites its file operands in place. Like sed, the first
      // non-flag operand is the one-liner script (`-e`'s value is a non-flag
      // operand too); the trailing non-flag operands are the files.
      if (!operands.some(isPerlInPlaceFlag)) continue;
      const nonFlag = operands.filter((op) => !op.startsWith("-"));
      for (let i = 1; i < nonFlag.length; i++) out.push(nonFlag[i]);
      continue;
    }

    if (cmd === "dd") {
      // `dd … of=FILE` writes FILE; `if=`/`bs=`/`count=` are reads/params.
      for (const op of operands) {
        if (op.startsWith("of=")) out.push(op.slice(3));
      }
      continue;
    }

    if (cmd === "awk" || cmd === "gawk") {
      // In-place only via gawk's `-i inplace` extension. After removing the
      // `-i inplace` pair, the first non-flag operand is the program and the
      // trailing non-flag operands are the rewritten files.
      const ii = operands.indexOf("-i");
      if (ii === -1 || operands[ii + 1] !== "inplace") continue;
      const rest = operands.slice(0, ii).concat(operands.slice(ii + 2));
      const nonFlag = rest.filter((op) => !op.startsWith("-"));
      for (let i = 1; i < nonFlag.length; i++) out.push(nonFlag[i]);
      continue;
    }

    if (cmd === "ex" || cmd === "ed") {
      // Line editors that rewrite the file they open — every non-flag operand.
      for (const op of operands) {
        if (!op.startsWith("-")) out.push(op);
      }
      continue;
    }

    // `cat`, `grep`, `echo`, `printf`, and any other command: no write shape.
  }
}
