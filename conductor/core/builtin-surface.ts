// conductor/core/builtin-surface.ts — the §2 side-effect class of every tool
// conductor's client offers, and the decision that refuses one it cannot class.
//
// WHY THIS EXISTS. Four layers decline to restrict a read-class call:
// classifyTool ends in a catch-all `read`; decideSession allows a registered
// session's non-spawn call and allows a read-class call even from an unregistered
// one; the gate hook forms no further opinion about a non-bash, non-write tool;
// and the client offers `webfetch` to the model with no permission narrowing of
// any kind (adapter/wire-notes.md, 20.2). The composition is not a decision to
// permit those calls — it is the absence of a decision, which is a different and
// worse thing, because nothing records that it happened and nothing fails closed.
//
// This module supplies the missing decision. A built-in that carries no class is
// REFUSED. That inverts a fail-open path, so the ALLOW rows below are as
// load-bearing as the refusal: `read`, `grep`, `glob`, `todowrite` and `skill`
// must each be explicitly permitted or a conductor session loses the ability to
// read the tree it is working in.
//
// TWO TABLES, TWO QUESTIONS, NO OVERLAP. core/tool-legality.ts TOOL_LEGALITY
// governs `conductor_*` names and answers "legal at this position, for this
// caller". This table governs UPSTREAM names and answers "what can this reach".
// A `conductor_*` name is not adjudicated here at all: two tables answering for
// one name is how they drift apart.
//
// Core module: pure, imports only sibling core types.

import type { Decision } from "./gates-edit.ts";
import type { SideEffectClass } from "./types.ts";

// The class of every tool the pinned client can put in front of the model.
//
// The offered set is MEASURED, not assumed — adapter/wire-notes.md "20.1" carries
// it and conductor/tests/wire-contract.test.ts pins it by deepEqual against the
// running binary, so a tool arriving on an opencode bump turns that test red
// before it can arrive here unclassified.
//
// `bash` is deliberately ABSENT. It has no single class: `ls` is R0, a checker is
// R1, `man` is R2, `curl` is R3 and `sed -i` is W. Naming one class for it is the
// same catch-all this module exists to remove, so a bash call is classified from
// its COMMAND by the caller and passed in.
//
// The registry-only names are classified even though 1.18.15 does not offer them.
// They are one config flip from reachable, and a class declared ahead of that
// flip is what stops it from also silently widening the surface.
export const BUILTIN_SIDE_EFFECT: Readonly<Record<string, SideEffectClass>> = {
  // Pure repo-local reads.
  read: "R0",
  grep: "R0",
  glob: "R0",
  // Session-local state, never the tree: a todo list and an instruction load.
  // R0 is the class for "reaches nothing beyond this session and the repo it can
  // already read", which is what both of these do.
  todowrite: "R0",
  skill: "R0",
  // opencode's own operator-facing surfaces. Neither reaches the tree or the
  // network; `invalid` is where opencode redirects a call to a tool the agent may
  // not use, so refusing it would replace a clear upstream message with a
  // conductor refusal for a call that already did nothing.
  question: "R0",
  invalid: "R0",
  // Network reads. Allowed by the client with no narrowing in any agent kind;
  // Task 21.4 is what turns this class into a refusal.
  webfetch: "R3",
  websearch: "R3",
  // Write-capable, adjudicated by the edit-scope gate over their one filePath.
  edit: "W",
  write: "W",
  // Structurally unboundable: a patch body names its write targets in a form no
  // gate here parses. Refused ahead of every other gate, permanently.
  patch: "X",
  apply_patch: "X",
  // Session-spawning. Denied in every session, registered or not.
  task: "S",
};

/** The class of a built-in by NAME, or undefined when the table declares none. */
export function builtinSideEffect(toolName: string): SideEffectClass | undefined {
  return BUILTIN_SIDE_EFFECT[toolName];
}

/** The refusal for an upstream tool that reached the gate carrying no class. */
export function undeclaredBuiltinWhy(toolName: string): string {
  return (
    toolName +
    ": no side-effect class is declared for this tool in core/builtin-surface.ts " +
    "BUILTIN_SIDE_EFFECT, so conductor cannot say what it reaches — the repository, the machine, " +
    "the network, or nothing. The call is refused rather than run unclassified, because a tool " +
    "nobody classified is exactly the surface this gate exists to bound. Declare its class beside " +
    "the others and record it in adapter/wire-notes.md."
  );
}

export interface BuiltinSurfaceInput {
  toolName: string;
  // The class derived from a bash command's text. Supplied only for `bash`, whose
  // class is a property of the command rather than of the name.
  commandClass?: SideEffectClass;
  // The lane's flag. False restores the prior posture — an unclassified tool runs
  // — without touching any other lane.
  classifyBuiltins: boolean;
}

const ALLOW: Decision = { action: "allow" };

/**
 * Whether a tool may be called at all, judged on what it can reach.
 *
 * Independent of the session: a stray unregistered reader and a dispatched
 * implementer meet the same table, because the question is what the TOOL does.
 * The session's own rules are a separate, later gate.
 */
export function decideBuiltinSurface(input: BuiltinSurfaceInput): Decision {
  // conductor_* names belong to TOOL_LEGALITY. Returning ALLOW here is not a
  // permission — it is this table declining to answer a question that is not its.
  if (input.toolName.startsWith("conductor_")) return ALLOW;

  const cls = input.commandClass ?? builtinSideEffect(input.toolName);
  if (cls === undefined) {
    if (!input.classifyBuiltins) return ALLOW;
    return { action: "deny", reason: undeclaredBuiltinWhy(input.toolName) };
  }

  return ALLOW;
}
