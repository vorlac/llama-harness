// conductor/core/gates-edit.ts — the §3.5 session-registry gate and edit-scope
// gate (Task 5.2; plan lines 2351-2374, normative rules at §3.5 lines 1344-1413).
// These two gates constrain a possibly-adversarial local model's writes: the
// registry gate decides whether an unregistered/childless session may act at
// all (and unconditionally forbids sub-agent spawning — the load-bearing half,
// §3.5:1356-1360), and the edit-scope gate decides which files a registered
// session may write, tree-relative, with the per-tree verify FREEZE on top.
//
// Core module: pure. Imports ONLY its core sibling shell-parse.ts (G3) — no
// filesystem, no subprocesses, no runtime globals, no network, no wall clock.
// The bash write-shape extractor reuses the SAME hardened quote-aware tokenizer
// and operator segmentation the git gate uses, so a write hidden behind an
// `env sh -c "..."` wrapper is analyzed identically to a bare one (the Task 5.2
// phaseGate1 binding).

import { shellTokens, splitOnOperators, globMatch } from "./shell-parse.ts";

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
  toolClass: "read" | "write" | "conductor" | "spawn";
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
  testScope: string[];
  path: string;
  verifyInFlightTree: string | null;
  sessionTree: string;
  inlineClaimScope: string[] | null;
}

// Roles that may never write: they read the tree and report (§3.5:1394).
const READER_ROLES: readonly string[] = ["reviewer", "skeptic", "planner", "mechanical"];

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
  if (globMatch(".conductor/**", normalized)) {
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
    return deny(
      "the orchestrator may not edit source without an active inline claim scoping this path (G8); use conductor_inline_claim if dispatch is genuinely more expensive than doing",
    );
  }

  if (sessionRole === "implementer") {
    if (scopeMatches(fileScope, normalized)) {
      return ALLOW;
    }
    return deny(
      `this path is outside the item's fileScope [${fileScope.join(", ")}] — an implementer may edit only its assigned source scope`,
    );
  }

  if (sessionRole === "test-writer") {
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
// A shell env-assignment token in command-prefix position (`NAME=value`).
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
// One leading command wrapper that passes its tail through to another command.
const WRAPPERS: readonly string[] = ["env", "command", "sudo", "builtin", "exec"];
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
// env-assignments, then unwrap one leading wrapper (`env`/`command`/…), then
// point at the command word. May return seg.length when the segment is empty.
function unwrappedCommandIndex(seg: string[]): number {
  let i = 0;
  while (i < seg.length && ENV_ASSIGNMENT.test(seg[i])) i += 1;
  if (i < seg.length && WRAPPERS.includes(seg[i])) i += 1;
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
      if (next !== undefined && !isOperatorRun(next)) {
        out.push(next);
      }
    }
  }

  // Per-command analysis over operator/newline-segmented tokens.
  for (const seg of splitOnOperators(tokens)) {
    const cmdIdx = unwrappedCommandIndex(seg);
    if (cmdIdx >= seg.length) continue;
    const cmd = commandBasename(seg[cmdIdx]);
    const operands = seg.slice(cmdIdx + 1);

    if (SHELLS.includes(cmd)) {
      // Wrapper-aware: `-c <inner>` re-analyzes the inner command string.
      const ci = operands.indexOf("-c");
      if (ci !== -1 && ci + 1 < operands.length) {
        collectWriteTargets(operands[ci + 1], out, depth + 1);
      }
      continue;
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
