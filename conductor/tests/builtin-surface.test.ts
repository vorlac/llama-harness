// conductor/tests/builtin-surface.test.ts — Task 21.3 RED tests for the built-in
// classification table and its deny point (core/builtin-surface.ts).
//
// WHAT THIS INVERTS. At HEAD four layers decline to restrict a read-class call:
// classifyTool ends in a catch-all `return "read"`; decideSession returns ALLOW
// for a registered session's non-spawn call AND for a read-class call from an
// UNREGISTERED one; gateBeforeToolCall makes no further decision for a non-bash,
// non-write tool; and the pinned client offers `webfetch` to the model. So a tool
// nobody classified reaches the model with no gate having formed an opinion.
//
// This table inverts that: a built-in with no class is REFUSED. That is a
// tightening, and the risk it carries is over-denial — `read`, `grep`, `glob`,
// `todowrite` and `skill` must each be explicitly ALLOWED or a conductor session
// loses the ability to read files. The allow rows below are therefore as
// load-bearing as the deny, and the [21.3-still-reads] row is the one that proves
// the tightening did not break the harness.
//
// The class vocabulary is core/types.ts SIDE_EFFECT_CLASSES (§2). The offered
// built-in set is measured, not assumed: conductor/adapter/wire-notes.md "20.1"
// carries it, pinned by wire-contract.test.ts against the running binary.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BUILTIN_SIDE_EFFECT,
  builtinSideEffect,
  decideBuiltinSurface,
  undeclaredBuiltinWhy,
} from "../core/builtin-surface.ts";
import { SIDE_EFFECT_CLASSES, validate } from "../core/types.ts";
import { DEFAULT_CONFIG } from "../adapter/config-io.ts";
import { readFileSync } from "node:fs";

// The measured offered set (wire-notes 20.1), plus the registry-only names that
// exist in opencode's tool registry without being offered. A name here that the
// table does not carry is a name a conductor session would be refused.
// `bash` is excluded deliberately and is covered by its own row below: it has no
// class by NAME, because `ls` is R0 and `curl` is R3, so it is classified from
// its command text instead. Every OTHER offered name must carry one.
const OFFERED = ["edit", "glob", "grep", "read", "skill", "task", "todowrite", "webfetch", "write"];
const REGISTRY_ONLY = ["question", "invalid", "websearch", "apply_patch", "patch"];

const surface = (over: Partial<Parameters<typeof decideBuiltinSurface>[0]> = {}) =>
  decideBuiltinSurface({ toolName: "read", classifyBuiltins: true, ...over });

test("[21.3-table-covers-offered] every tool the pinned client offers carries a class", () => {
  const missing = OFFERED.filter((name) => builtinSideEffect(name) === undefined);
  assert.deepEqual(
    missing,
    [],
    "a tool opencode offers but the table does not classify is refused in every conductor session — " +
      "classify it in core/builtin-surface.ts and record it in wire-notes.md 20.4",
  );
});

test("[21.3-table-covers-registry-only] the names opencode holds without offering are classified too", () => {
  const missing = REGISTRY_ONLY.filter((name) => builtinSideEffect(name) === undefined);
  assert.deepEqual(
    missing,
    [],
    "a registry-only name is one config flip from reachable; classifying it now means the flip " +
      "does not also silently widen the surface",
  );
});

test("[21.3-classes-are-vocabulary] every class in the table is a declared SideEffectClass", () => {
  const vocabulary: readonly string[] = SIDE_EFFECT_CLASSES;
  for (const [name, cls] of Object.entries(BUILTIN_SIDE_EFFECT)) {
    assert.ok(vocabulary.includes(cls), `${name} carries ${cls}, which is not a SideEffectClass`);
  }
});

test("[21.3-classes-are-right] the classes match the measured taxonomy", () => {
  assert.equal(builtinSideEffect("read"), "R0");
  assert.equal(builtinSideEffect("grep"), "R0");
  assert.equal(builtinSideEffect("glob"), "R0");
  assert.equal(builtinSideEffect("todowrite"), "R0");
  assert.equal(builtinSideEffect("skill"), "R0");
  assert.equal(builtinSideEffect("webfetch"), "R3");
  assert.equal(builtinSideEffect("websearch"), "R3");
  assert.equal(builtinSideEffect("edit"), "W");
  assert.equal(builtinSideEffect("write"), "W");
  assert.equal(builtinSideEffect("patch"), "X");
  assert.equal(builtinSideEffect("apply_patch"), "X");
  assert.equal(builtinSideEffect("task"), "S");
});

test("[21.3-bash-has-no-single-class] bash is absent from the table because it is adjudicated per command", () => {
  assert.equal(
    "bash" in BUILTIN_SIDE_EFFECT,
    false,
    "a single class for bash is the catch-all that produced the false premise: `ls` is R0 and " +
      "`curl` is R3 and the NAME cannot tell them apart",
  );
  // It is nonetheless classified — by command, which the caller supplies.
  assert.equal(builtinSideEffect("bash"), undefined);
  assert.equal(surface({ toolName: "bash", commandClass: "R0" }).action, "allow");
});

test("[21.3-still-reads] a normal session still reads, greps, globs, writes todos and loads skills", () => {
  for (const name of ["read", "grep", "glob", "todowrite", "skill"]) {
    const decision = surface({ toolName: name });
    assert.equal(
      decision.action,
      "allow",
      `${name} was denied: the tightening removed the ability to read the tree, which is not the ` +
        "capability this phase means to remove",
    );
  }
});

test("[21.3-unclassified-refused] a built-in the table does not carry is REFUSED, not defaulted to read", () => {
  const decision = surface({ toolName: "some_upstream_tool" });
  assert.equal(decision.action, "deny");
  assert.ok((decision.reason ?? "").includes("some_upstream_tool"), "the refusal names the tool");
});

test("[21.3-refusal-is-written-for-an-upstream-tool] the message is not the conductor-row message", () => {
  const why = undeclaredBuiltinWhy("some_upstream_tool");
  // core/tool-legality.ts undeclaredToolWhy is written for a FORGOTTEN CONDUCTOR
  // ROW and tells the reader to declare a phase and a caller. Reusing it here
  // would send someone to the wrong table with the wrong question.
  assert.doesNotMatch(why, /TOOL_LEGALITY/, "that table governs conductor_* tools, not upstream ones");
  assert.doesNotMatch(why, /phase \+ callers/, "an upstream tool has no phase and no caller row");
  assert.match(why, /side-effect class/i, "it must name the missing fact: the tool's class");
  assert.match(why, /builtin-surface/, "and where to declare it");
});

test("[21.3-conductor-tools-bypass] a conductor_* name is not adjudicated here at all", () => {
  // TOOL_LEGALITY owns those, keyed to CONDUCTOR_TOOL_NAMES by deepEqual in both
  // directions. Two tables answering for the same name is how they drift.
  const decision = surface({ toolName: "conductor_dispatch_wave" });
  assert.equal(decision.action, "allow");
});

test("[21.3-flag-off-restores-the-prior-behaviour] classifyBuiltins:false allows an unclassified tool", () => {
  const decision = surface({ toolName: "some_upstream_tool", classifyBuiltins: false });
  assert.equal(
    decision.action,
    "allow",
    "the lane must be revertible to the prior posture without touching any other lane",
  );
});

// ---------------------------------------------------------------------------
// The wiring half. A table with a deny point that no composition root consults
// is the built-but-never-wired shape this build keeps finding (ISSUE-001, C-028):
// the module is real, its tests are green, and it adjudicates zero calls. These
// rows read the shipped sources rather than a synthetic input, because what they
// are checking is that the WIRING exists, not that the function works.
// ---------------------------------------------------------------------------

test("[21.3-wired] gateBeforeToolCall consults the tool-surface decision", () => {
  const tools = readFileSync(new URL("../adapter/tools.ts", import.meta.url), "utf8");
  assert.match(
    tools,
    /decideBuiltinSurface\(\{/,
    "adapter/tools.ts must CALL the decision, not merely import it",
  );
  assert.match(
    tools,
    /surfaceDecision\.action === "deny"/,
    "and it must act on a deny, or the table is advisory in a gate that has no advisory mode",
  );
});

test("[21.3-flag-threaded] the plugin passes the repo's toolSurface config into the gate", () => {
  const plugin = readFileSync(new URL("../plugin/index.ts", import.meta.url), "utf8");
  assert.match(
    plugin,
    /toolSurface: config\.toolSurface/,
    "a lane flag the composition root never threads is a config key that does nothing — the gate " +
      "would silently use its own default and the documented rollback would not work",
  );
});

test("[21.3-default-is-on] DEFAULT_CONFIG ships the lane enabled", () => {
  assert.equal(
    DEFAULT_CONFIG.toolSurface?.classifyBuiltins,
    true,
    "the floor ships on; the flag exists to turn it OFF for a rollback, not to opt into it",
  );
});

test("[21.3-config-validates] a config carrying the block passes its own registered schema", () => {
  const withBlock = { ...DEFAULT_CONFIG, toolSurface: { classifyBuiltins: false } };
  assert.equal(validate("Config", withBlock).ok, true, validate("Config", withBlock).errors?.join("; "));
  // And absent still validates, so a config written before the block existed is
  // not rejected — it reads as every lane enabled.
  const { toolSurface: _omitted, ...withoutBlock } = DEFAULT_CONFIG;
  assert.equal(validate("Config", withoutBlock).ok, true);
});
