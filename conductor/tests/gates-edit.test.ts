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
//                                          // "test-writer" | "reviewer" |
//                                          // "skeptic" | "planner" | "mechanical"
//     registered: boolean;                 // has a registry entry
//     fileScope: string[];                 // the item's source globs
//     testScope: string[];                 // the item's test globs
//     path: string;                        // ABSOLUTE path being edited
//     verifyInFlightTree: string | null;   // the tree with a live verify marker
//     sessionTree: string;                 // this session's tree root (prefix)
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
//     toolClass: "read" | "write" | "conductor" | "spawn";
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

import { decideEdit, writeShapedPaths, decideSession } from "../core/gates-edit.ts";

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
  verifyInFlightTree: string | null;
  sessionTree: string;
  inlineClaimScope: string[] | null;
}

interface SessionInput {
  registered: boolean;
  role: string | null;
  toolName: string;
  toolClass: "read" | "write" | "conductor" | "spawn";
}

// ---------------------------------------------------------------------------
// Tree fixtures. TREE is a plain worktree root; WT_UNDER_STATE deliberately
// carries `.conductor` in its PREFIX to prove normalization never false-denies;
// TREE_A / TREE_B are two distinct trees for the per-tree freeze proof.
// ---------------------------------------------------------------------------

const TREE = "/repo";
const WT_UNDER_STATE = "/home/dev/.conductor/state/worktrees/run1/I2";
const TREE_A = "/state/worktrees/run1/I1";
const TREE_B = "/state/worktrees/run1/I9";

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

// ===========================================================================
// [5.2-test-writer] allowed ONLY inside testScope; denied on a fileScope SOURCE
// path (which an implementer could edit) WITH THE TESTSCOPE NAMED.
// ===========================================================================

test("[5.2-test-writer] test-writer is allowed inside its testScope", () => {
  const d = decideEdit(
    editInput({ sessionRole: "test-writer", testScope: ["tests/**"], path: p("tests/a.test.ts") }),
  );
  assertAllow(d, "test-writer inside testScope");
});

test("[5.2-test-writer] test-writer is denied on a fileScope source path, and the reason names the testScope", () => {
  // The path IS inside the item's fileScope (an implementer would be allowed) —
  // but a test-writer may write only testScope, so it is denied, testScope named.
  const d = decideEdit(
    editInput({
      sessionRole: "test-writer",
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
      sessionRole: "test-writer",
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
      sessionRole: "test-writer",
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
      sessionRole: "test-writer",
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
      editInput({ sessionRole: "implementer", fileScope, sessionTree: "/wt", path }),
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
      sessionTree: "/wt",
      path: "/wt/src/a/x.ts",
    }),
  );
  assertAllow(d, "normal in-scope path, no traversal");
});
