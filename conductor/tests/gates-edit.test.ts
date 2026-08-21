// Task 5.2 red tests — lives at conductor/tests/gates-edit.test.ts.
// Subject: conductor/core/gates-edit.ts (must NOT exist when this goes red; the
// failure is Cannot find module '../core/gates-edit.ts' — the missing-subject
// shape, a legal red per §2.6.1).
//
// Spec: plan §3.5 (lines 1344-1413) — the session-registry gate table, the
// edit-scope gate rules, FREEZE (the strict reading), and tree-relative path
// normalization; Task 5.2's enumerated case list (lines 2351-2374); and
// docs/build/specs/task-5.2.assertions.json (the 9 rows + phaseGate1Bindings:
// writeShapedPaths must be wrapper-aware — `env sh -c '...'` and redirect / tee /
// sed -i / mv / cp / rm shapes behind a wrapper are still caught).
//
// -------------------------------------------------------------------------
// EXPECTED EXPORT SURFACE (this test file is the contract the subject must meet)
// -------------------------------------------------------------------------
// The gate-decision shape mirrors Task 5.1's decideGit (plan line 2327):
//
//   type Decision = { action: "allow" | "deny"; reason?: string };
//   // a DENY always carries a non-empty `reason`; an ALLOW may omit it.
//
//   decideEdit({
//     sessionRole: string;                 // "orchestrator" | "implementer" |
//                                          // "testWriter" | "reviewer" |
//                                          // "skeptic" | "planner" | "mechanical"
//     registered: boolean;                 // has a registry entry
//     fileScope: string[];                 // the item's source globs
//     testScope: string[];                 // the item's test globs
//     path: string;                        // ABSOLUTE path being edited
//     verifyInFlightTree: TreePath | null; // the tree with a live verify marker
//     sessionTree: TreePath;               // this session's tree root (prefix)
//     inlineClaimScope: string[] | null;   // the orchestrator's active claim globs
//   }) -> Decision
//
//   writeShapedPaths(command: string) -> string[]
//     // bash write-target extraction: > and >> redirect targets, `tee` file
//     // operands, `sed -i` in-place targets, `mv`/`cp` DESTINATIONS, `rm`
//     // targets. Reads NEVER match (`cat`, `grep` operands). Wrapper-aware:
//     // `env sh -c "<cmd>"` / `sh -c "<cmd>"` re-analyze the inner command
//     // (phaseGate1 binding — the SAME hardened segment analysis).
//
//   decideSession({
//     registered: boolean;
//     role: string | null;                 // null when unregistered
//     toolName: string;                     // e.g. "edit", "task", "conductor_publish"
//     toolClass: ToolClass (core/types.ts TOOL_CLASSES);
//   }) -> Decision
//
// -------------------------------------------------------------------------
// NORMALIZATION CONTRACT (the security-critical part, §3.5 lines 1409-1413)
// -------------------------------------------------------------------------
// Every `path` is evaluated RELATIVE to `sessionTree`; item scopes are
// tree-relative. A worktree implementer's file at
//   <stateHome>/…/worktrees/<runId>/<itemId>/src/a.ts
// normalizes to `src/a.ts` and is matched against the (tree-relative) scope.
// The `.conductor/**` deny applies to the NORMALIZED path — the state area of
// the CURRENT tree — never to the worktree-root prefix itself. So even when
// `sessionTree` itself lives under a `.conductor/` state home, an in-scope
// `src/a.ts` under it is ALLOWED (the prefix `.conductor` must not false-deny),
// while `<tree>/.conductor/…` normalizes to `.conductor/…` and is DENIED.

import { test } from "node:test";
import assert from "node:assert/strict";

import { TOOL_CLASSES } from "../core/types.ts";

import {
  decideEdit,
  writeShapedPaths,
  decideSession,
  interpreterStateAreaScript,
} from "../core/gates-edit.ts";
// The matcher the gate itself uses — imported so [5.2-out-of-tree-escape] can assert
// its PREMISE rather than assume it.
import { networkShapedCommands } from "../core/gates-edit.ts";
import { globMatch } from "../core/shell-parse.ts";
import { treePath } from "../core/types.ts";
import type { TreePath } from "../core/types.ts";

// ---------------------------------------------------------------------------
// Local structural mirrors of the subject's param + return shapes. Kept local
// (not imported) so the file is a self-contained contract; the subject's real
// types assign to these under tsc --strict.
// ---------------------------------------------------------------------------

interface Decision {
  action: "allow" | "deny";
  reason?: string;
}

interface EditInput {
  sessionRole: string;
  registered: boolean;
  fileScope: string[];
  testScope: string[];
  path: string;
  // Both trees are PATHS (core/types.ts TreePath): the normalization and freeze
  // rules below are string-prefix and string-equality tests against an absolute
  // edit path, so the evidence layer's tree SLUG cannot be one of these.
  verifyInFlightTree: TreePath | null;
  sessionTree: TreePath;
  inlineClaimScope: string[] | null;
}

interface SessionInput {
  registered: boolean;
  role: string | null;
  toolName: string;
  toolClass: (typeof TOOL_CLASSES)[number];
}

// ---------------------------------------------------------------------------
// Tree fixtures. TREE is a plain worktree root; WT_UNDER_STATE deliberately
// carries `.conductor` in its PREFIX to prove normalization never false-denies;
// TREE_A / TREE_B are two distinct trees for the per-tree freeze proof.
// ---------------------------------------------------------------------------

const TREE = treePath("/repo");
const WT_UNDER_STATE = treePath("/home/dev/.conductor/state/worktrees/run1/I2");
const TREE_A = treePath("/state/worktrees/run1/I1");
const TREE_B = treePath("/state/worktrees/run1/I9");

// Build an absolute path inside the default TREE.
const p = (rel: string): string => `${TREE}/${rel}`;

const editInput = (over: Partial<EditInput> = {}): EditInput => ({
  sessionRole: "implementer",
  registered: true,
  fileScope: ["src/**"],
  testScope: ["tests/**"],
  path: p("src/a.ts"),
  verifyInFlightTree: null,
  sessionTree: TREE,
  inlineClaimScope: null,
  ...over,
});

const sessionInput = (over: Partial<SessionInput> = {}): SessionInput => ({
  registered: true,
  role: "implementer",
  toolName: "edit",
  toolClass: "write",
  ...over,
});

// A DENY must carry a non-empty reason; return it (narrowed to string) so the
// caller can assert on WHAT it names. Non-vacuous: fails on allow or on an
// empty reason.
function denyReason(d: Decision, ctx: string): string {
  assert.equal(d.action, "deny", `${ctx}: expected a DENY decision`);
  const r = d.reason;
  assert.ok(r, `${ctx}: a DENY must carry a non-empty reason`);
  return r;
}

function assertAllow(d: Decision, ctx: string): void {
  assert.equal(
    d.action,
    "allow",
    `${ctx}: expected an ALLOW${d.reason === undefined ? "" : ` (got deny: ${d.reason})`}`,
  );
}

// ===========================================================================
// [5.2-api] the export surface + decision/return shapes.
// ===========================================================================

test("[5.2-api] decideEdit/decideSession yield {action, reason?}; writeShapedPaths yields string[]", () => {
  assert.equal(typeof decideEdit, "function", "decideEdit is exported");
  assert.equal(typeof decideSession, "function", "decideSession is exported");
  assert.equal(typeof writeShapedPaths, "function", "writeShapedPaths is exported");

  const e: Decision = decideEdit(editInput());
  assert.ok(e.action === "allow" || e.action === "deny", "decideEdit action is allow|deny");

  const s: Decision = decideSession(sessionInput());
  assert.ok(s.action === "allow" || s.action === "deny", "decideSession action is allow|deny");

  const w = writeShapedPaths("echo hi > out.txt");
  assert.ok(Array.isArray(w), "writeShapedPaths returns an array");
  for (const item of w) assert.equal(typeof item, "string", "each write-shaped path is a string");
});

// ===========================================================================
// [5.2-orchestrator] denied on src; allowed with a MATCHING inline claim;
// still denied with a non-matching claim (a present-but-wrong claim is not a
// pass — the claim must SCOPE the path).
// ===========================================================================

test("[5.2-orchestrator] orchestrator is denied on a source edit without an inline claim (G8)", () => {
  const d = decideEdit(editInput({ sessionRole: "orchestrator", path: p("src/x.ts"), inlineClaimScope: null }));
  const reason = denyReason(d, "orchestrator no-claim source edit");
  assert.match(reason, /claim|inline|orchestrator|source/i, "the reason names the inline-claim requirement / G8");
});

test("[5.2-orchestrator] orchestrator is ALLOWED on a source edit an active inline claim scopes", () => {
  const d = decideEdit(
    editInput({ sessionRole: "orchestrator", path: p("src/x.ts"), inlineClaimScope: ["src/x.ts"] }),
  );
  assertAllow(d, "orchestrator with a matching inline claim");
});

test("[5.2-orchestrator] a present-but-non-matching inline claim does NOT unlock the edit", () => {
  const d = decideEdit(
    editInput({ sessionRole: "orchestrator", path: p("src/x.ts"), inlineClaimScope: ["src/other.ts"] }),
  );
  denyReason(d, "orchestrator with a non-matching inline claim");
});

// ===========================================================================
// [5.2-implementer] allowed inside fileScope; denied outside WITH THE SCOPE NAMED.
// ===========================================================================

test("[5.2-implementer] implementer is allowed on a path inside its fileScope", () => {
  const d = decideEdit(editInput({ sessionRole: "implementer", fileScope: ["src/**"], path: p("src/a.ts") }));
  assertAllow(d, "implementer inside fileScope");
});

test("[5.2-implementer] implementer is denied outside its fileScope, and the reason names the scope", () => {
  const d = decideEdit(editInput({ sessionRole: "implementer", fileScope: ["src/**"], path: p("lib/b.ts") }));
  const reason = denyReason(d, "implementer outside fileScope");
  assert.ok(reason.includes("src/**"), `the reason names the fileScope it was out of; got: ${reason}`);
});

// The PREVENTION half of the vetted-test identity rule. Queue acceptance refuses
// an item whose testScope its own fileScope covers, and mark_green's
// digest witness catches a rewritten vetted test after the fact — but the witness
// only speaks once a whole implementer sub-session has been spent, and it is the
// LAST line rather than the first. The gate is where the question is cheap: the
// implementer's writable set is fileScope MINUS testScope, so the session that
// must PASS the test can never be the session that writes it, through whatever
// residual path a colocated scope reached the gate by.
test("[5.2-implementer] an implementer edit inside the item's TESTSCOPE is DENIED even when its fileScope covers the same path — the session that must pass the test may not write it", () => {
  const d = decideEdit(
    editInput({
      sessionRole: "implementer",
      // The colocated shape: fileScope really does cover the test file.
      fileScope: ["src/**", "tests/**"],
      testScope: ["tests/beta.test.ts"],
      path: p("tests/beta.test.ts"),
    }),
  );
  const reason = denyReason(d, "implementer editing its own vetted test");
  assert.ok(
    reason.includes("tests/beta.test.ts"),
    `the reason names the testScope entry it was inside; got: ${reason}`,
  );
  assert.match(reason, /test/i, "and names the rule it broke, not a generic scope miss");
});

test("[5.2-implementer] the subtraction is EXACT: the same implementer with the same scopes is still ALLOWED on a production path", () => {
  const d = decideEdit(
    editInput({
      sessionRole: "implementer",
      fileScope: ["src/**", "tests/**"],
      testScope: ["tests/beta.test.ts"],
      path: p("src/beta.ts"),
    }),
  );
  assertAllow(d, "implementer on a fileScope path outside the testScope");
});

// ===========================================================================
// [5.2-test-writer] allowed ONLY inside testScope; denied on a fileScope SOURCE
// path (which an implementer could edit) WITH THE TESTSCOPE NAMED.
// ===========================================================================

test("[5.2-test-writer] test-writer is allowed inside its testScope", () => {
  const d = decideEdit(
    editInput({ sessionRole: "testWriter", testScope: ["tests/**"], path: p("tests/a.test.ts") }),
  );
  assertAllow(d, "test-writer inside testScope");
});

test("[5.2-test-writer] test-writer is denied on a fileScope source path, and the reason names the testScope", () => {
  // The path IS inside the item's fileScope (an implementer would be allowed) —
  // but a test-writer may write only testScope, so it is denied, testScope named.
  const d = decideEdit(
    editInput({
      sessionRole: "testWriter",
      fileScope: ["src/**"],
      testScope: ["tests/**"],
      path: p("src/a.ts"),
    }),
  );
  const reason = denyReason(d, "test-writer on a fileScope source path");
  assert.ok(reason.includes("tests/**"), `the reason names the testScope it was out of; got: ${reason}`);
});

// ===========================================================================
// [5.2-readonly-roles] reviewer / skeptic / planner / mechanical are readers —
// denied EVERYWHERE, even on a path an implementer would be allowed to edit.
// ===========================================================================

for (const role of ["reviewer", "skeptic", "planner", "mechanical"]) {
  test(`[5.2-readonly-roles] ${role} is denied every edit (reader role), even inside a would-be scope`, () => {
    const d = decideEdit(editInput({ sessionRole: role, fileScope: ["src/**"], path: p("src/a.ts") }));
    const reason = denyReason(d, `${role} edit`);
    assert.match(reason, /read|reviewer|skeptic|planner|mechanical|role/i, "the reason names the reader role");
  });
}

// ===========================================================================
// [5.2-normalization] tree-relative normalization, then the everyone-.conductor
// deny. The worktree root carries `.conductor` in its PREFIX — an in-scope
// src/a.ts under it is ALLOWED (the prefix must not false-deny), while
// <tree>/.conductor/… is DENIED after normalization.
// ===========================================================================

test("[5.2-normalization] a worktree src path normalizes into fileScope and is ALLOWED despite a .conductor prefix", () => {
  const d = decideEdit(
    editInput({
      sessionRole: "implementer",
      fileScope: ["src/**"],
      sessionTree: WT_UNDER_STATE,
      path: `${WT_UNDER_STATE}/src/a.ts`, // normalizes to src/a.ts
    }),
  );
  assertAllow(d, "worktree src path under a .conductor-prefixed tree");
});

test("[5.2-normalization] <tree>/.conductor/… normalizes to .conductor/… and is DENIED for everyone", () => {
  const d = decideEdit(
    editInput({
      sessionRole: "implementer",
      fileScope: ["src/**"],
      sessionTree: WT_UNDER_STATE,
      path: `${WT_UNDER_STATE}/.conductor/journal.ndjson`, // normalizes to .conductor/journal.ndjson
    }),
  );
  const reason = denyReason(d, "edit of the tree's .conductor state area");
  assert.match(reason, /\.conductor/, "the reason names .conductor (state is handler-written only)");
});

// ===========================================================================
// [5.2-freeze] while a verify marker is live for a tree, EVERY edit in THAT tree
// is denied — including a test-writer editing inside its OWN testScope (the
// disputed case; the STRICT reading is normative). The same edit in a DIFFERENT
// tree (or with no live verify) is allowed. Keyed on tree EQUALITY, not mere
// presence of a marker somewhere.
// ===========================================================================

test("[5.2-freeze] a live verify on the session's own tree denies even a test-writer's in-testScope edit", () => {
  const d = decideEdit(
    editInput({
      sessionRole: "testWriter",
      testScope: ["tests/**"],
      sessionTree: TREE_A,
      path: `${TREE_A}/tests/a.test.ts`, // in testScope — allowed but for the freeze
      verifyInFlightTree: TREE_A, // SAME tree => frozen
    }),
  );
  const reason = denyReason(d, "test-writer in own testScope under a live freeze");
  assert.match(reason, /freeze|verify/i, "the reason names the freeze / live verify");
});

test("[5.2-freeze] the SAME edit in a DIFFERENT tree (not the frozen one) is allowed", () => {
  const d = decideEdit(
    editInput({
      sessionRole: "testWriter",
      testScope: ["tests/**"],
      sessionTree: TREE_A,
      path: `${TREE_A}/tests/a.test.ts`,
      verifyInFlightTree: TREE_B, // a DIFFERENT tree is frozen => this tree is free
    }),
  );
  assertAllow(d, "test-writer in own testScope while a different tree is frozen");
});

test("[5.2-freeze] with no live verify marker the in-testScope edit is allowed", () => {
  const d = decideEdit(
    editInput({
      sessionRole: "testWriter",
      testScope: ["tests/**"],
      sessionTree: TREE_A,
      path: `${TREE_A}/tests/a.test.ts`,
      verifyInFlightTree: null,
    }),
  );
  assertAllow(d, "test-writer in own testScope with no freeze");
});

// ===========================================================================
// [5.2-unregistered] the session-registry gate (decideSession). An UNREGISTERED
// session: a read is allowed; an edit/write, a conductor_* call, and a spawn are
// each denied. A spawn is ALSO denied from a REGISTERED implementer — the
// UNCONDITIONAL sub-agent-spawn deny (the load-bearing half). Registered
// non-spawn calls pass the registry gate (scope is a later gate's job).
// ===========================================================================

test("[5.2-unregistered] an unregistered session's read-only call is allowed", () => {
  const d = decideSession(sessionInput({ registered: false, role: null, toolName: "read", toolClass: "read" }));
  assertAllow(d, "unregistered read");
});

test("[5.2-unregistered] an unregistered session's edit/write is denied", () => {
  const d = decideSession(sessionInput({ registered: false, role: null, toolName: "edit", toolClass: "write" }));
  const reason = denyReason(d, "unregistered write");
  assert.match(reason, /assign|item|scope|register|conductor/i, "the reason names the missing item assignment / conductor");
});

test("[5.2-unregistered] an unregistered session's conductor_* call is denied", () => {
  const d = decideSession(
    sessionInput({ registered: false, role: null, toolName: "conductor_dispatch_wave", toolClass: "conductor" }),
  );
  const reason = denyReason(d, "unregistered conductor_* call");
  assert.match(reason, /register|state|conductor/i, "the reason names that state advances only from registered sessions");
});

test("[5.2-unregistered] an unregistered session's spawn is denied", () => {
  const d = decideSession(sessionInput({ registered: false, role: null, toolName: "task", toolClass: "spawn" }));
  const reason = denyReason(d, "unregistered spawn");
  assert.match(reason, /spawn|sub-?agent|task|child/i, "the reason names the spawn deny");
});

test("[5.2-unregistered] a spawn is denied even from a REGISTERED implementer (unconditional spawn deny)", () => {
  const d = decideSession(
    sessionInput({ registered: true, role: "implementer", toolName: "task", toolClass: "spawn" }),
  );
  const reason = denyReason(d, "registered implementer spawn");
  assert.match(reason, /spawn|sub-?agent|task|child/i, "the spawn deny is unconditional — registration does not unlock it");
});

test("[5.2-unregistered] a REGISTERED session's non-spawn calls pass the registry gate", () => {
  // The registry gate is role-agnostic for registered sessions (scope/role is a
  // later gate's job); it denies only unregistered writes/conductor and any spawn.
  assertAllow(
    decideSession(sessionInput({ registered: true, role: "implementer", toolName: "read", toolClass: "read" })),
    "registered read",
  );
  assertAllow(
    decideSession(sessionInput({ registered: true, role: "implementer", toolName: "edit", toolClass: "write" })),
    "registered write (registry gate passes; scope is decideEdit's job)",
  );
  assertAllow(
    decideSession(
      sessionInput({ registered: true, role: "orchestrator", toolName: "conductor_report", toolClass: "conductor" }),
    ),
    "registered conductor_* call",
  );
});

// ===========================================================================
// [5.2-write-shapes] writeShapedPaths matrix (phase-gate red-team-by-data,
// >=15 write shapes). Every positive shape must surface its write target; every
// pure read must surface NONE.
// ===========================================================================

const WRITE_SHAPES: ReadonlyArray<{ cmd: string; target: string; note: string }> = [
  { cmd: "echo hi > out.txt", target: "out.txt", note: "> redirect" },
  { cmd: "echo hi >> log.txt", target: "log.txt", note: ">> append redirect" },
  { cmd: "printf x > a/b/c.txt", target: "a/b/c.txt", note: "> redirect to a nested path" },
  { cmd: "echo hi | tee out.txt", target: "out.txt", note: "tee file operand" },
  { cmd: "echo hi | tee -a log.txt", target: "log.txt", note: "tee -a append operand" },
  { cmd: "sed -i 's/a/b/' file.ts", target: "file.ts", note: "sed -i in-place target" },
  { cmd: "sed -i 's/x/y/' src/app.ts", target: "src/app.ts", note: "sed -i nested in-place target" },
  { cmd: "mv a.ts b.ts", target: "b.ts", note: "mv destination" },
  { cmd: "mv src/a.ts dst/b.ts", target: "dst/b.ts", note: "mv nested destination" },
  { cmd: "cp -r dir1 dir2", target: "dir2", note: "cp -r destination" },
  { cmd: "rm a.ts", target: "a.ts", note: "rm target" },
  { cmd: "rm -rf build", target: "build", note: "rm -rf target" },
  { cmd: "rm x.ts y.ts", target: "x.ts", note: "rm first of several targets" },
];

for (const { cmd, target, note } of WRITE_SHAPES) {
  test(`[5.2-write-shapes] writeShapedPaths surfaces the ${note}: ${cmd}`, () => {
    const paths = writeShapedPaths(cmd);
    assert.ok(paths.includes(target), `${note}: expected write target ${target} in ${JSON.stringify(paths)}`);
  });
}

test("[5.2-write-shapes] rm records EVERY target, not just the first", () => {
  const paths = writeShapedPaths("rm x.ts y.ts");
  assert.ok(paths.includes("x.ts") && paths.includes("y.ts"), `both rm targets are write shapes; got ${JSON.stringify(paths)}`);
});

const READ_SHAPES: ReadonlyArray<{ cmd: string; note: string }> = [
  { cmd: "cat file.ts", note: "cat read" },
  { cmd: "grep foo file.ts", note: "grep read" },
  { cmd: "cat a.ts b.ts", note: "cat of two read operands" },
  { cmd: "grep -r pattern src/", note: "recursive grep read" },
];

for (const { cmd, note } of READ_SHAPES) {
  test(`[5.2-write-shapes] a pure read yields NO write targets (${note}): ${cmd}`, () => {
    assert.deepEqual(writeShapedPaths(cmd), [], `${note}: reads never match`);
  });
}

test("[5.2-write-shapes] a redirect after a read catches only the redirect target, never the read operand", () => {
  const grep = writeShapedPaths("grep foo file.ts > matches.txt");
  assert.ok(grep.includes("matches.txt"), "the > redirect target is a write shape");
  assert.ok(!grep.includes("file.ts"), "the grep read operand is NOT a write shape");

  const cat = writeShapedPaths("cat a.ts > b.ts");
  assert.ok(cat.includes("b.ts"), "the > redirect target is a write shape");
  assert.ok(!cat.includes("a.ts"), "the cat read operand is NOT a write shape");
});

test("[5.2-write-shapes] cp records the destination but not the source (the source is a read)", () => {
  const paths = writeShapedPaths("cp a.ts b.ts");
  assert.ok(paths.includes("b.ts"), "cp destination is a write shape");
  assert.ok(!paths.includes("a.ts"), "cp source is a read, not a write shape");
});

// ===========================================================================
// [5.2-write-shapes] phaseGate1 binding — writeShapedPaths must be WRAPPER-AWARE:
// the SAME hardened segment analysis, so a write behind `env sh -c "…"` /
// `sh -c "…"` still yields the inner write target.
// ===========================================================================

const WRAPPER_SHAPES: ReadonlyArray<{ cmd: string; target: string; note: string }> = [
  { cmd: `env sh -c "echo x > f"`, target: "f", note: "redirect behind env sh -c" },
  { cmd: `env sh -c "sed -i 's/a/b/' g.ts"`, target: "g.ts", note: "sed -i behind env sh -c" },
  { cmd: `sh -c "mv a.ts b.ts"`, target: "b.ts", note: "mv destination behind sh -c" },
  { cmd: `sh -c "echo hi | tee out.txt"`, target: "out.txt", note: "tee behind sh -c" },
  { cmd: `env sh -c "rm doomed.ts"`, target: "doomed.ts", note: "rm target behind env sh -c" },
];

for (const { cmd, target, note } of WRAPPER_SHAPES) {
  test(`[5.2-write-shapes:binding] wrapper-aware — ${note}: ${cmd}`, () => {
    const paths = writeShapedPaths(cmd);
    assert.ok(paths.includes(target), `wrapper-aware analysis must surface ${target}; got ${JSON.stringify(paths)}`);
  });
}

test("[5.2-write-shapes:binding] a pure read behind a wrapper still yields NO write targets", () => {
  assert.deepEqual(writeShapedPaths(`env sh -c "cat file.ts"`), [], "a wrapped read never matches");
});

// ===========================================================================
// [5.2-write-shapes:force-redirect] `>|` (and `&>|`) is bash's force-overwrite
// redirect — its following token is a write target, exactly like `>`. Missing it
// classified the command as a read and skipped the edit + registry gates.
// ===========================================================================

test("[5.2-write-shapes] >| force-redirect surfaces its write target", () => {
  const paths = writeShapedPaths("echo x >| out.ts");
  assert.ok(paths.includes("out.ts"), `>| target must be a write shape; got ${JSON.stringify(paths)}`);
});

test("[5.2-write-shapes] a plain > redirect is unchanged by the >| addition", () => {
  assert.deepEqual(writeShapedPaths("echo x > out.ts"), ["out.ts"]);
});

// ===========================================================================
// [5.2-write-shapes:in-place-writers] common non-enumerated in-place writers —
// `perl -pi`/`perl -i`, `dd … of=FILE`, `gawk/awk -i inplace … FILE`, and the
// `ex`/`ed` line editors — write their file operands. (Arbitrary obscure in-place
// writers remain a documented G7 limit; this closes the common ones.)
// ===========================================================================

const IN_PLACE_WRITERS: ReadonlyArray<{ cmd: string; target: string; note: string }> = [
  { cmd: "perl -pi -e 's/a/b/g' file.ts", target: "file.ts", note: "perl -pi -e in-place" },
  { cmd: "perl -i.bak -pe 's/x/y/' src/app.ts", target: "src/app.ts", note: "perl -i.bak in-place" },
  { cmd: "dd if=/dev/zero of=out.img bs=1M count=1", target: "out.img", note: "dd of= target" },
  { cmd: "gawk -i inplace '{print}' data.txt", target: "data.txt", note: "gawk -i inplace target" },
  { cmd: "awk -i inplace '{print}' notes.txt", target: "notes.txt", note: "awk -i inplace target" },
  { cmd: "ex out.txt", target: "out.txt", note: "ex file operand" },
  { cmd: "ed notes.txt", target: "notes.txt", note: "ed file operand" },
];

for (const { cmd, target, note } of IN_PLACE_WRITERS) {
  test(`[5.2-write-shapes] in-place writer surfaces the ${note}: ${cmd}`, () => {
    const paths = writeShapedPaths(cmd);
    assert.ok(paths.includes(target), `${note}: expected write target ${target} in ${JSON.stringify(paths)}`);
  });
}

test("[5.2-write-shapes] the in-place-writer additions leave pure reads as reads (no targets)", () => {
  assert.deepEqual(writeShapedPaths("cat file.ts"), [], "cat is a read");
  assert.deepEqual(writeShapedPaths("grep foo file.ts"), [], "grep is a read");
});

// ===========================================================================
// [5.2-path-traversal] a normalized edit path containing a `..` segment is
// denied BEFORE scope matching. normalizeUnderTree does not collapse `..`, and
// globMatch treats `..` as a literal segment a `**` swallows — so a scope like
// `src/a/**` would otherwise MATCH (and ALLOW) a path that resolves into the
// `.conductor` state area, a sibling item, or clean out of the repo. A
// legitimate in-scope edit path never carries a `..`.
// ===========================================================================

const TRAVERSALS: ReadonlyArray<{ path: string; fileScope: string[]; note: string }> = [
  {
    path: "/wt/src/a/../../.conductor/run.json",
    fileScope: ["src/a/**"],
    note: "escape into the .conductor state area (src/a/** would otherwise swallow it)",
  },
  {
    path: "/wt/src/a/../itemB/x.ts",
    fileScope: ["src/a/**"],
    note: "cross-item escape into a sibling scope",
  },
  {
    path: "/wt/src/module/../../../../etc/passwd",
    fileScope: ["src/**"],
    note: "out-of-repo escape (src/** would otherwise swallow it)",
  },
];

for (const { path, fileScope, note } of TRAVERSALS) {
  test(`[5.2-path-traversal] a '..' segment is denied before scope matching (${note})`, () => {
    const d = decideEdit(
      editInput({ sessionRole: "implementer", fileScope, sessionTree: treePath("/wt"), path }),
    );
    const reason = denyReason(d, `traversal: ${note}`);
    assert.match(reason, /traversal|\.\./, "the reason names the path traversal");
  });
}

test("[5.2-path-traversal] a normal in-scope path without '..' is unchanged (allow)", () => {
  const d = decideEdit(
    editInput({
      sessionRole: "implementer",
      fileScope: ["src/a/**"],
      sessionTree: treePath("/wt"),
      path: "/wt/src/a/x.ts",
    }),
  );
  assertAllow(d, "normal in-scope path, no traversal");
});

// ===========================================================================
// [5.2-out-of-tree-escape] — Phase 9 MILESTONE GATE finding (C-055).
//
// normalizeUnderTree strips the session tree's prefix so item scopes, which are
// TREE-RELATIVE, match. Its comment then claims that a path NOT under the tree
// "is left as-is: it matches no tree-relative scope and is denied by the role
// check below."
//
// That claim is false for any WILDCARD-HEADED scope. globMatch("**", "/etc/passwd")
// is true — `**` spans separators, including the leading one — so an absolute
// path outside the tree, left unchanged by normalization, is matched by the
// item's own fileScope and ALLOWED.
//
// This is not an exotic scope. `verifyScopePathsOf` returns exactly ["**"] for an
// item that declares no paths, and a decomposition is free to produce `**/*.ts`
// or `src/**` — the first two of which match absolute paths anywhere on the
// filesystem. The `..` guard does not help: no traversal is needed when the path
// is already absolute.
//
// The freeze and `.conductor/**` checks do not save it either: freeze is keyed on
// tree equality, and `.conductor/**` is matched against the same unchanged
// absolute path, so an out-of-tree state file matches neither.
// ===========================================================================

test("[5.2-out-of-tree-escape] an ABSOLUTE path outside the session tree is denied even when the item's own fileScope is wildcard-headed — normalization leaving it unchanged must not hand it to a `**` that spans separators", () => {
  // The premise, stated so this test cannot pass because the matcher changed:
  // `**` really does match an absolute path.
  assert.equal(globMatch("**", "/etc/passwd"), true, "premise: `**` spans the leading separator");

  for (const scope of [["**"], ["**/*.ts"], ["src/**", "**"]]) {
    for (const outside of ["/etc/passwd", "/Users/someone/.ssh/id_rsa", "/tmp/evil.ts"]) {
      const verdict = decideEdit(editInput({ fileScope: scope, path: outside }));
      assert.equal(
        verdict.action,
        "deny",
        `scope ${JSON.stringify(scope)} must NOT grant an edit to ${outside} — it is outside the session tree`,
      );
      assert.match(
        verdict.reason ?? "",
        /outside|tree/i,
        "the denial says the path is outside the session tree, not something incidental",
      );
    }
  }

  // And the ordinary in-tree case still works, so the fix is a deny of the
  // out-of-tree case rather than a blanket deny of wildcard scopes.
  assert.equal(
    decideEdit(editInput({ fileScope: ["**"], path: p("src/a.ts") })).action,
    "allow",
    "an in-tree path under a wildcard scope is still allowed",
  );
});

// ===========================================================================
// [5.2-state-area-casefold] GAP-026 / ISSUE-016 — the `.conductor/**` deny was
// byte-exact while the filesystem it defends is case-INSENSITIVE (darwin, and
// Windows), so `.Conductor/runs/<id>/state.json` is the SAME FILE as
// `.conductor/runs/<id>/state.json` and wrote the real state area: run state,
// evidence, and journal forged by a session whose scope admits the path.
// `headsOverlap` already folds case for exactly this reason. Every spelling of
// the state area is the state area.
// ===========================================================================

const STATE_AREA_SPELLINGS: readonly string[] = [
  ".Conductor/runs/run-0001/state.json",
  ".CONDUCTOR/runs/run-0001/state.json",
  ".cOnDuCtOr/journal.ndjson",
  ".Conductor/runs/run-0001/answers/Q-0001.md",
];

for (const rel of STATE_AREA_SPELLINGS) {
  test(`[5.2-state-area-casefold] <tree>/${rel} is the state area on a case-insensitive filesystem and is DENIED`, () => {
    const d = decideEdit(
      editInput({
        sessionRole: "implementer",
        fileScope: ["**"],
        path: p(rel),
      }),
    );
    const reason = denyReason(d, `case-folded state-area path ${rel}`);
    assert.match(reason, /\.conductor/i, "the reason names the state area it protects");
  });
}

test("[5.2-state-area-casefold] the fold does not over-match: a neighbouring name that merely STARTS with the token is still editable", () => {
  assertAllow(
    decideEdit(editInput({ fileScope: ["**"], path: p(".conductorial/notes.md") })),
    "a directory whose name only begins with the token is not the state area",
  );
  assertAllow(
    decideEdit(editInput({ fileScope: ["**"], path: p("conductor/core/gates-edit.ts") })),
    "the dotless project directory is ordinary source",
  );
  assertAllow(
    decideEdit(editInput({ fileScope: ["**"], path: p("src/Conductor.ts") })),
    "a source file named after the project is ordinary source",
  );
});

// ===========================================================================
// [5.2-wrapper-chain] Phase III residual — `unwrappedCommandIndex` skipped
// exactly ONE wrapper word and none of that wrapper's own flags or assignments,
// so `env -i sh -c "…"` and `env FOO=1 sh -c "…"` reached NEITHER the write-shape
// extractor NOR the interpreter state-area rule: the command word read as `-i` /
// `FOO=1` and the segment surfaced nothing at all. The record's wrapper list
// (env with its flags and assignments, nice, nohup, time, timeout, xargs, and the
// already-listed command/sudo/builtin/exec) must be unwrapped ITERATIVELY, with
// the same fail-closed posture as one level.
// ===========================================================================

const WRAPPER_CHAINS: ReadonlyArray<{ cmd: string; target: string; note: string }> = [
  { cmd: `env -i sh -c "rm /outside/x"`, target: "/outside/x", note: "env -i sh -c (the reported shape)" },
  { cmd: `env FOO=1 sh -c "rm /outside/x"`, target: "/outside/x", note: "env FOO=1 sh -c (the reported shape)" },
  { cmd: `env -i sh -c "echo x > /outside/f"`, target: "/outside/f", note: "redirect behind env -i sh -c" },
  { cmd: `env -u PATH sh -c "rm /outside/x"`, target: "/outside/x", note: "env -u NAME consumes its value" },
  { cmd: "nice rm /outside/x", target: "/outside/x", note: "nice" },
  { cmd: "nice -n 10 rm /outside/x", target: "/outside/x", note: "nice -n 10" },
  { cmd: "nohup rm /outside/x", target: "/outside/x", note: "nohup" },
  { cmd: "time rm /outside/x", target: "/outside/x", note: "time" },
  { cmd: "timeout 5 rm /outside/x", target: "/outside/x", note: "timeout with its duration operand" },
  { cmd: "timeout -k 1 5 rm /outside/x", target: "/outside/x", note: "timeout -k with its duration operand" },
  { cmd: "xargs rm /outside/x", target: "/outside/x", note: "xargs" },
  { cmd: "xargs -n 1 rm /outside/x", target: "/outside/x", note: "xargs -n 1" },
  { cmd: "sudo -u bob rm /outside/x", target: "/outside/x", note: "a listed wrapper's value flag" },
  { cmd: "nice nohup rm /outside/x", target: "/outside/x", note: "two wrappers deep" },
  { cmd: `nice env -i sh -c "rm /outside/x"`, target: "/outside/x", note: "three levels: nice, env -i, sh -c" },
  { cmd: `env -i sh -c "sed -i 's/a/b/' /outside/g.ts"`, target: "/outside/g.ts", note: "sed -i behind env -i sh -c" },
  { cmd: `nice mv src/a.ts /outside/b.ts`, target: "/outside/b.ts", note: "mv destination behind nice" },
];

for (const { cmd, target, note } of WRAPPER_CHAINS) {
  test(`[5.2-wrapper-chain] writeShapedPaths sees through ${note}: ${cmd}`, () => {
    const paths = writeShapedPaths(cmd);
    assert.ok(
      paths.includes(target),
      `the wrapper chain must not hide the write of ${target}; got ${JSON.stringify(paths)}`,
    );
  });
}

test("[5.2-wrapper-chain] an interpreter one-liner naming the state area is found behind the same chains", () => {
  const chains: ReadonlyArray<[string, string]> = [
    [
      `env -i node -e "require('fs').writeFileSync('.conductor/runs/r/answers/Q.md','x')"`,
      "env -i node -e",
    ],
    [
      `env FOO=1 sh -c "node -e \\"require('fs').writeFileSync('.conductor/runs/r/answers/Q.md','x')\\""`,
      "env FOO=1 sh -c node -e",
    ],
    [
      `nice node -e "require('fs').writeFileSync('.conductor/state.json','x')"`,
      "nice node -e",
    ],
    [
      `timeout 5 node -e "require('fs').writeFileSync('.conductor/state.json','x')"`,
      "timeout 5 node -e",
    ],
  ];
  for (const [cmd, note] of chains) {
    assert.notEqual(
      interpreterStateAreaScript(cmd),
      null,
      `${note}: the state-area program must be found behind the wrapper chain`,
    );
  }
});

test("[5.2-wrapper-chain] a pure read behind the same chains still surfaces NOTHING (the unwrap widens detection, not the deny)", () => {
  assert.deepEqual(writeShapedPaths("nice cat file.ts"), [], "nice cat is a read");
  assert.deepEqual(writeShapedPaths("timeout 5 grep foo file.ts"), [], "timeout grep is a read");
  assert.deepEqual(writeShapedPaths(`env -i sh -c "cat file.ts"`), [], "a wrapped read never matches");
  assert.equal(
    interpreterStateAreaScript(`env -i node -e "console.log('hello')"`),
    null,
    "an innocent one-liner behind a wrapper is not a state-area program",
  );
});

// ===========================================================================
// [5.2-wrapper-path] Phase IV residual (P1) — the wrapper test was token-EXACT
// while the very next line, and the sibling git gate, resolve a command word to
// its BASENAME. So `/usr/bin/env sh -c "…"`, `/bin/nice rm …` and every other
// path spelling of a listed wrapper fell out of the unwrap: the command word read
// as `/usr/bin/env`, the inner command was never analyzed, and a write behind it
// surfaced nothing. A gate whose reach depends on how a caller spells `env` is
// spelled around by writing the path.
// ===========================================================================

const PATH_SPELLED_WRAPPERS: ReadonlyArray<{ cmd: string; target: string; note: string }> = [
  { cmd: `/usr/bin/env sh -c "printf x > /outside/y"`, target: "/outside/y", note: "absolute env, redirect inside sh -c (the reported shape)" },
  { cmd: `/usr/bin/env -i sh -c "rm /outside/x"`, target: "/outside/x", note: "absolute env with its own flag" },
  { cmd: `./env sh -c "rm /outside/x"`, target: "/outside/x", note: "relative env" },
  { cmd: "/bin/nice rm /outside/x", target: "/outside/x", note: "absolute nice" },
  { cmd: "/usr/bin/timeout 5 rm /outside/x", target: "/outside/x", note: "absolute timeout with its duration operand" },
  { cmd: "/usr/bin/sudo -u bob rm /outside/x", target: "/outside/x", note: "absolute sudo with a value flag" },
  { cmd: `/usr/bin/nice /usr/bin/env -i /bin/sh -c "rm /outside/x"`, target: "/outside/x", note: "every level path-spelled" },
];

for (const { cmd, target, note } of PATH_SPELLED_WRAPPERS) {
  test(`[5.2-wrapper-path] a path-spelled wrapper does not hide the write — ${note}: ${cmd}`, () => {
    const paths = writeShapedPaths(cmd);
    assert.ok(
      paths.includes(target),
      `the wrapper is resolved to its basename before the membership test; got ${JSON.stringify(paths)}`,
    );
    // …and the surfaced target meets the gate, which is where the escape ended.
    const reason = denyReason(
      decideEdit(editInput({ fileScope: ["**"], testScope: [], path: target })),
      `the write behind ${cmd}`,
    );
    assert.ok(reason.length > 0, "the surfaced target reaches a DENY carrying a reason");
  });
}

test("[5.2-wrapper-path] a path-spelled interpreter behind a path-spelled wrapper still reaches the state-area rule", () => {
  const chains: ReadonlyArray<[string, string]> = [
    [
      `/usr/bin/env -i /usr/local/bin/node -e "require('fs').writeFileSync('.conductor/state.json','x')"`,
      "absolute env + absolute node",
    ],
    [
      `/usr/bin/env sh -c "/usr/bin/python3 -c \\"open('.conductor/x','w')\\""`,
      "absolute env, sh -c, absolute python3",
    ],
    [
      `/bin/nice /usr/bin/python3 -c "open('.conductor/runs/r/answers/Q.md','w').write('x')"`,
      "absolute nice + absolute python3",
    ],
  ];
  for (const [cmd, note] of chains) {
    assert.notEqual(
      interpreterStateAreaScript(cmd),
      null,
      `${note}: a state-area program is found however its wrapper and interpreter are spelled`,
    );
  }
});

test("[5.2-wrapper-path] basename resolution does not widen the wrapper LIST: a command that merely ends in a wrapper's name is not unwrapped", () => {
  // `myenv` and `subenv` are not `env`; resolving `/usr/bin/env` must not make
  // every word ending in those three letters a pass-through wrapper.
  assert.deepEqual(
    writeShapedPaths(`myenv sh -c "rm /outside/x"`),
    [],
    "a command word that merely CONTAINS a wrapper name is a command, not a wrapper",
  );
  assert.deepEqual(
    writeShapedPaths(`/usr/bin/notnice rm /outside/x`),
    [],
    "a path whose basename is not a listed wrapper is not unwrapped",
  );
});

// ===========================================================================
// [5.2-interpreter-casefold] Phase IV residual (P2) — GAP-026's case fold landed
// on the edit-path deny but the interpreter state-area rule stayed byte-exact, so
// `python3 -c "open('.Conductor/x','w')"` was not a state-area program at all. The
// filesystem this defends is case-insensitive: `.Conductor/x` and `.conductor/x`
// are one file on darwin and on Windows, and the state area is the one artifact
// whose whole value is that no gated session wrote it.
// ===========================================================================

const FOLDED_STATE_AREA_SCRIPTS: ReadonlyArray<[string, string]> = [
  [`python3 -c "open('.Conductor/x','w')"`, "capitalized .Conductor (the reported shape)"],
  [`python3 -c "open('.CONDUCTOR/x','w')"`, "upper-case token"],
  [`node -e "require('fs').writeFileSync('.CoNdUcToR/state.json','x')"`, "mixed case"],
  [`env -i sh -c "python3 -c \\"open('.Conductor/x','w')\\""`, "folded token behind a wrapper chain"],
  [`/usr/bin/env python3 -c "open('.Conductor/x','w')"`, "folded token behind a path-spelled wrapper"],
];

for (const [cmd, note] of FOLDED_STATE_AREA_SCRIPTS) {
  test(`[5.2-interpreter-casefold] the interpreter state-area rule folds case — ${note}`, () => {
    assert.notEqual(
      interpreterStateAreaScript(cmd),
      null,
      `${cmd}: a state-area program is caught by the interpreter rule itself, not only by whatever literal operand a backstop happens to parse`,
    );
  });
}

test("[5.2-interpreter-casefold] the fold does not over-match: an innocent program naming a neighbouring word is not a state-area program", () => {
  assert.equal(
    interpreterStateAreaScript(`python3 -c "print('the conductorial notes')"`),
    null,
    "a word that merely begins with the token is not the state area",
  );
  assert.equal(
    interpreterStateAreaScript(`node -e "console.log('hello')"`),
    null,
    "an innocent one-liner is still innocent",
  );
});

// ===========================================================================
// [5.2-command-casefold] Phase IV residual (R0, same class as P2) — the P2 fold
// landed on the state-area PATH TOKEN but NOT on the command NAMES. WRAPPERS,
// SHELLS, INTERPRETERS and the write-shaped command set were matched byte-exactly
// against the resolved basename, so on a case-insensitive FS (APFS, NTFS) an
// upper/mixed-case spelling of a tool walked past all three gates: `/usr/bin/ENV`,
// `/bin/SH`, `NODE`, `RM`, `/usr/bin/PYTHON3` are the very tools those lists name,
// yet a write behind them classified as a harmless read. The command name is now
// resolved to a folded basename before EVERY membership test.
// ===========================================================================

const CASE_SPELLED_WRITES: ReadonlyArray<{ cmd: string; target: string; note: string }> = [
  { cmd: `/usr/bin/ENV sh -c "rm /outside/x"`, target: "/outside/x", note: "upper-case wrapper ENV" },
  { cmd: `/bin/SH -c "printf x > /outside/y"`, target: "/outside/y", note: "upper-case shell SH, redirect inside" },
  { cmd: `RM /outside/x`, target: "/outside/x", note: "bare upper-case rm" },
  { cmd: `/bin/RM -rf /outside/x`, target: "/outside/x", note: "path-spelled upper-case rm with flags" },
  { cmd: `NODE -e "require('fs').writeFileSync('/outside/x','y')"`, target: "/outside/x", note: "bare upper-case interpreter NODE" },
  { cmd: `Timeout 5 rm /outside/x`, target: "/outside/x", note: "mixed-case wrapper Timeout with its operand" },
  { cmd: `TEE /outside/x`, target: "/outside/x", note: "upper-case tee" },
  { cmd: `MV src/a.ts /outside/b.ts`, target: "/outside/b.ts", note: "upper-case mv destination" },
];

for (const { cmd, target, note } of CASE_SPELLED_WRITES) {
  test(`[5.2-command-casefold] an upper/mixed-case command name does not hide the write — ${note}: ${cmd}`, () => {
    const paths = writeShapedPaths(cmd);
    assert.ok(
      paths.includes(target),
      `the command name is folded to its resolved basename before the membership test; got ${JSON.stringify(paths)}`,
    );
    // …and the surfaced target reaches the DENY where the escape used to end.
    const reason = denyReason(
      decideEdit(editInput({ fileScope: ["**"], testScope: [], path: target })),
      `the write behind ${cmd}`,
    );
    assert.ok(reason.length > 0, "the surfaced target reaches a DENY carrying a reason");
  });
}

const CASE_SPELLED_STATE_AREA: ReadonlyArray<[string, string]> = [
  [`/usr/bin/PYTHON3 -c "open('.conductor/x','w')"`, "upper-case PYTHON3 (the reported shape)"],
  [`NODE -e "require('fs').writeFileSync('.conductor/state.json','x')"`, "bare upper-case NODE"],
  [`/usr/bin/ENV PYTHON3 -c "open('.conductor/x','w')"`, "folded wrapper AND folded interpreter"],
  [`/usr/bin/ENV SH -c "python3 -c \\"open('.conductor/x','w')\\""`, "folded wrapper and folded shell over the state area"],
];

for (const [cmd, note] of CASE_SPELLED_STATE_AREA) {
  test(`[5.2-command-casefold] an upper/mixed-case interpreter still reaches the state-area rule — ${note}`, () => {
    assert.notEqual(
      interpreterStateAreaScript(cmd),
      null,
      `${cmd}: the interpreter is resolved case-insensitively, so its state-area program is caught`,
    );
  });
}

test("[5.2-command-casefold] folding the command name does not widen the tool sets: a name that merely resembles a listed tool still passes", () => {
  assert.deepEqual(
    writeShapedPaths(`MYENV sh -c "rm /outside/x"`),
    [],
    "MYENV folds to `myenv`, which is not the wrapper `env` — the inner command is not unwrapped",
  );
  assert.deepEqual(
    writeShapedPaths(`NOTNICE rm /outside/x`),
    [],
    "NOTNICE folds to `notnice`, which is not the wrapper `nice`",
  );
  assert.equal(
    interpreterStateAreaScript(`PRINT -c "open('.conductor/x','w')"`),
    null,
    "PRINT folds to `print`, which is not an interpreter — its argument is not a program the gate runs",
  );
});

// ===========================================================================
// Task 21.4 — the network-shape extractor.
//
// The point of this extractor is that a config flag alone cannot deliver the
// "R3 off" posture. Denying the `webfetch` NAME leaves `curl https://…` running
// through the bash tool, which is the same command with a different spelling.
// So the shape is read from the command, with the SAME quote-aware tokenizer,
// the SAME operator segmentation and the SAME wrapper unwrapping the write-shape
// extractor uses — anything less and the deny is spellable-around by choosing a
// wrapper, which is precisely the property the patch refusal was designed to
// avoid needing.
//
// It is an ENUMERATION, not a heuristic, and its limit is stated where it is
// felt: a program not on the list is not detected. That is recorded in
// HONEST-LIMITS in the same voice as the git-detection limit it mirrors.
// ===========================================================================

test("[21.4-plain] the enumerated network programs are detected", () => {
  for (const cmd of [
    "curl https://example.com",
    "wget https://example.com/x.tar.gz",
    "nc example.com 443",
    "ssh user@host",
    "scp file user@host:/tmp/x",
    "sftp user@host",
    "ftp example.com",
    "telnet example.com 80",
    "rsync -a ./x user@host:/tmp/",
  ]) {
    assert.notDeepEqual(networkShapedCommands(cmd), [], `undetected network command: ${cmd}`);
  }
});

test("[21.4-not-network] ordinary read commands are NOT network-shaped", () => {
  for (const cmd of [
    "ls -la",
    "grep -rn foo src/",
    "cat README.md",
    "node --test tests/x.test.ts",
    "git status",
    "sed -i '' s/a/b/ src/x.ts",
    // The substring trap: a path or flag that merely contains a program name.
    "cat ./curl-notes.md",
    "ls src/ssh_config",
    "echo nc",
  ]) {
    assert.deepEqual(networkShapedCommands(cmd), [], `over-detected as network: ${cmd}`);
  }
});

test("[21.4-wrappers] every wrapper the write extractor unwraps is unwrapped here too", () => {
  for (const cmd of [
    `env sh -c "curl https://example.com"`,
    `env -i curl https://example.com`,
    `env FOO=1 curl https://example.com`,
    "sudo curl https://example.com",
    "nice -n 10 curl https://example.com",
    "timeout 5 curl https://example.com",
    "nohup wget https://example.com",
    "command curl https://example.com",
    "xargs -n 1 curl",
    `sh -c "wget https://example.com"`,
    `bash -c "sh -c 'curl https://example.com'"`,
  ]) {
    assert.notDeepEqual(networkShapedCommands(cmd), [], `wrapper hid a network call: ${cmd}`);
  }
});

test("[21.4-compound] a network call in any segment of a compound command is found", () => {
  for (const cmd of [
    "ls && curl https://example.com",
    "ls ; curl https://example.com",
    "ls | curl https://example.com",
    "echo x\ncurl https://example.com",
    "cd /tmp && wget https://example.com && ls",
  ]) {
    assert.notDeepEqual(networkShapedCommands(cmd), [], `segmentation hid a network call: ${cmd}`);
  }
});

test("[21.4-case-and-path] the command name is resolved the way the filesystem resolves it", () => {
  for (const cmd of ["/usr/bin/curl https://example.com", "./curl https://x", "CURL https://x"]) {
    assert.notDeepEqual(networkShapedCommands(cmd), [], `name resolution missed: ${cmd}`);
  }
  // Folding must not WIDEN the set: a name that merely resembles one is not it.
  assert.deepEqual(networkShapedCommands("curler https://x"), []);
  assert.deepEqual(networkShapedCommands("myssh host"), []);
});

test("[21.4-interpreters] a network call inside an interpreter one-liner is found", () => {
  for (const cmd of [
    `node -e "fetch('https://example.com')"`,
    `python3 -c "import urllib.request; urllib.request.urlopen('https://x')"`,
    `python3 -c "import requests; requests.get('https://x')"`,
    `bun -e "await fetch('https://x')"`,
  ]) {
    assert.notDeepEqual(networkShapedCommands(cmd), [], `interpreter one-liner hid a network call: ${cmd}`);
  }
  assert.deepEqual(
    networkShapedCommands(`node -e "console.log('fetching nothing')"`),
    [],
    "prose mentioning a network verb is not a network call",
  );
});

test("[21.4-proxy-defeating] the flags that defeat an egress proxy do not change the answer", () => {
  // The egress proxy is a process-wide backstop; `--noproxy '*'` walks past it.
  // This extractor is the layer that catches that shape, so the flags must not
  // make the call LESS visible here.
  for (const cmd of [
    `curl --noproxy '*' https://example.com`,
    "curl -x '' https://example.com",
    "wget --no-proxy https://example.com",
  ]) {
    assert.notDeepEqual(networkShapedCommands(cmd), [], `proxy-defeating flag hid the call: ${cmd}`);
  }
});

test("[21.4-reports-what-it-saw] the extractor names the program it found, so the refusal can quote it", () => {
  assert.deepEqual(networkShapedCommands("ls && curl https://example.com"), ["curl"]);
  assert.deepEqual(networkShapedCommands("curl https://a ; wget https://b"), ["curl", "wget"]);
  // De-duplicated, first-seen order, like writeShapedPaths.
  assert.deepEqual(networkShapedCommands("curl https://a ; curl https://b"), ["curl"]);
});
