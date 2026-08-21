// conductor/core/tool-legality.ts — GAP-006: the ONE legality declaration table
// every conductor_* call passes through, plus the closed §3.6 override
// vocabulary.
//
// WHAT THIS REPLACES. core/gates-phase.ts legalTools had exactly two production
// consumers — requireStageTool (the six per-item stage tools) and waveVerdict
// (conductor_dispatch_wave). Every other §3.4 name reached its handler with no
// legality question asked of it at all: two layers each assumed the other owned
// the meta tools, and neither did (ISSUE-005). This table is the answer to "who
// owns 'is this tool legal at this position?'" — one row per tool, no exceptions,
// and a name
// with no row is REFUSED rather than run (the growth property: a tool cannot be
// born guarded by nothing).
//
// A row answers two independent questions:
//
//   phase   — WHERE in the run this tool may be called, drawn from the closed
//             PHASE_RULES vocabulary below. The adapter evaluates the rule
//             against PERSISTED state; the rule itself is declared here.
//   callers — WHO may call it. §3.5's registry says whether a session is the
//             orchestrator or a dispatched sub-session, and a dispatched session
//             answering its own blocking question, deferring its own item or
//             closing its own run is marking its own homework (ISSUE-006).
//
// Core module (G3): pure data and pure predicates — no I/O, no clock, no runtime
// globals. The state reading lives in adapter/tools.ts requireToolLegal, which
// is where every stateful legality question in this codebase already lives.

import { isTerminalRunState } from "./fsm-run.ts";
import { READER_ROLES } from "./gates-edit.ts";

// ---------------------------------------------------------------------------
// Caller identity (§3.5)
// ---------------------------------------------------------------------------

// The two kinds of caller the registry can produce. Roles multiply (implementer,
// testWriter, reviewer, skeptic, planner, mechanical, critic, ...) but the
// legality question only ever splits one way: is this the session that drives the
// run, or one the run dispatched?
export type CallerKind = "orchestrator" | "sub-session";

// The caller as the composition root reads it out of the §3.5 registry — never
// as the model supplies it. `itemId` is carried so a refusal can name the item
// the calling session was dispatched for.
export interface CallerIdentity {
  role?: string;
  itemId?: string;
}

/**
 * The caller kind for a §3.5 registry role. An ABSENT entry is treated as the
 * orchestrator's own call: the registry gate (core/gates-edit.ts decideSession)
 * already refuses a conductor tool from an unregistered session before it can
 * reach a handler, so "no entry" here is the composition root's own seeded
 * orchestrator, not an anonymous caller sneaking past a check.
 */
export function callerKindOf(role: string | undefined): CallerKind {
  return role === undefined || role === "orchestrator" ? "orchestrator" : "sub-session";
}

// ---------------------------------------------------------------------------
// The phase-rule vocabulary
// ---------------------------------------------------------------------------

// The closed set of phase rules a row may declare. Kept small deliberately: a
// rule per tool is a second implementation of the FSM, and a free-form predicate
// per row is a place for the next escape to hide.
//
//   always         — legal at every position, including with no live run at all
//                    (conductor_status is read-only; conductor_setup adjudicates
//                    its own preconditions; conductor_forget_stale precedes every
//                    run by design, §2.11).
//   verdict        — legal exactly when core/gates-phase.ts legalTools OFFERS the
//                    tool for the run's current position. This is the rule the
//                    meta tools were missing.
//   non-terminal   — legal while the run is live; refused once the run reaches a
//                    §2.3 terminal position or records a stop. legalTools does not
//                    emit these names (they are hatches, not pipeline steps), so
//                    the terminality question is asked here instead of nowhere
//                    (ISSUE-005 (c): inline_claim reopening G8 edit permission on
//                    a REPORTED run).
//   once-at-intake — legal exactly once, at INTAKE, before a classification has
//                    been recorded. conductor_classify's own rule: re-entry is
//                    classification shopping, and on an advanced run it clobbers
//                    queue.json and walks the FSM along edges §3.1 lacks.
//   stage          — the phase question is DELEGATED to a committed legality path
//                    the row NAMES (requireStageTool for the per-item tools, the
//                    run-FSM edge check for the run pipeline). Delegation, not
//                    exemption: the row still carries the caller rule, and the
//                    guard test refuses a `stage` row that names no path.
export const PHASE_RULES = [
  "always",
  "verdict",
  "non-terminal",
  "once-at-intake",
  "stage",
] as const;

export type PhaseRule = (typeof PHASE_RULES)[number];

export interface ToolLegalityRow {
  phase: PhaseRule;
  callers: readonly CallerKind[];
  // For a `stage` row: the committed legality path that performs the phase check
  // instead. An unnamed delegation is indistinguishable from no guard at all.
  guardedBy?: string;
  // Why this rule is the right one for this tool, in one line.
  why: string;
}

const ORCHESTRATOR_ONLY: readonly CallerKind[] = ["orchestrator"];
const EITHER: readonly CallerKind[] = ["orchestrator", "sub-session"];

// The per-item stage tools and the run-pipeline tools share one delegation shape.
function stageRow(guardedBy: string, why: string): ToolLegalityRow {
  return { phase: "stage", callers: ORCHESTRATOR_ONLY, guardedBy, why };
}

/**
 * One row per §3.4 tool name. conductor/tests/tool-legality.test.ts pins the keys
 * to adapter/tools.ts CONDUCTOR_TOOL_NAMES, so a tool added to the inventory
 * without a row — or a row for a tool that no longer exists — is red.
 */
export const TOOL_LEGALITY: Readonly<Record<string, ToolLegalityRow>> = {
  conductor_classify: {
    phase: "once-at-intake",
    callers: ORCHESTRATOR_ONLY,
    why: "classification is recorded once and every later stage rests on it; re-entry re-rolls the classifier until it says something cheaper",
  },
  conductor_decompose: stageRow(
    "handleDecompose's legalRunTransition(run.state -> DECOMPOSED) edge",
    "the run-FSM edge already refuses a decompose from anywhere but a classified INTAKE",
  ),
  conductor_plan: stageRow(
    "handlePlan's legalRunTransition(run.state -> PLANNED) edge",
    "the run-FSM edge already refuses a plan from anywhere but DECOMPOSED",
  ),
  conductor_plan_review: stageRow(
    "handlePlanReview's legalRunTransition(run.state -> PLAN_REVIEWED) edge",
    "the run-FSM edge already refuses a plan review from anywhere but PLANNED",
  ),
  conductor_dispatch_wave: stageRow(
    "handleDispatchWave's waveVerdict + legalRunTransition(run.state -> EXECUTING) edge",
    "the wave driver asks legalTools for its own offer and every member's next stage before it dispatches",
  ),
  conductor_submit_test: stageRow(
    "requireStageTool",
    "the per-item legality step refuses the tool for an item the gate does not offer it for",
  ),
  conductor_vet_test: stageRow(
    "requireStageTool",
    "the per-item legality step refuses the tool for an item the gate does not offer it for",
  ),
  conductor_mark_green: stageRow(
    "requireStageTool",
    "the per-item legality step refuses the tool for an item the gate does not offer it for",
  ),
  conductor_validate: stageRow(
    "requireStageTool",
    "the per-item legality step refuses the tool for an item the gate does not offer it for",
  ),
  conductor_item_review: stageRow(
    "requireStageTool",
    "the per-item legality step refuses the tool for an item the gate does not offer it for",
  ),
  conductor_publish: stageRow(
    "requireStageTool",
    "the per-item legality step refuses the tool for an item the gate does not offer it for",
  ),
  conductor_report: {
    phase: "verdict",
    callers: ORCHESTRATOR_ONLY,
    why: "closing a run is a claim over every item; the gate offers it only from EXECUTING with all work settled (§3.2:1142)",
  },
  conductor_surface: {
    phase: "verdict",
    callers: EITHER,
    why: "a dispatched session raising a §2.11 question is the design's own escalation path, and askedBy records which one raised it",
  },
  conductor_answer: {
    phase: "verdict",
    callers: ORCHESTRATOR_ONLY,
    why: "an answer carries a human's judgment into the run; a dispatched session answering its own blocking question forges one",
  },
  conductor_defer: {
    phase: "verdict",
    callers: ORCHESTRATOR_ONLY,
    why: "deferral is a disposition over the run's scope, and an item's own session deferring it is the item excusing itself",
  },
  conductor_decide: {
    phase: "verdict",
    callers: ORCHESTRATOR_ONLY,
    why: "the §2.7 ledger records the run's decisions; a dispatched session writes its findings back through its receipt, not the ledger",
  },
  conductor_queue_amend: {
    phase: "non-terminal",
    callers: ORCHESTRATOR_ONLY,
    why: "amending the queue is a scope change, and an implementer widening its own fileScope is the scope gate answering to the session it constrains",
  },
  conductor_inline_claim: {
    phase: "non-terminal",
    callers: ORCHESTRATOR_ONLY,
    why: "the claim is the orchestrator electing to work an item itself instead of dispatching, and it reopens G8 edit permission — which a terminal run must never regain",
  },
  conductor_override: {
    phase: "non-terminal",
    callers: EITHER,
    why: "§3.6's budget is spent BY the session working the item the bypass applies to; a terminal run has no gate left to bypass",
  },
  conductor_status: {
    phase: "always",
    callers: EITHER,
    why: "read-only, and the way any session — orchestrator or dispatched — orients itself",
  },
  conductor_setup: {
    phase: "always",
    callers: ORCHESTRATOR_ONLY,
    why: "setup precedes every run and adjudicates its own preconditions (an already-configured repo, a live run)",
  },
  conductor_forget_stale: {
    phase: "always",
    callers: ORCHESTRATOR_ONLY,
    why: "the §2.11 stale-red registry precedes every run, so it can carry no run position at all",
  },
};

/** The declared row for a tool, or undefined when the tool declares none. */
export function legalityRowOf(tool: string): ToolLegalityRow | undefined {
  return TOOL_LEGALITY[tool];
}

/**
 * Whether a session in `role` may mint an override for `gate`.
 *
 * One rule, and it is narrow on purpose. A dispatched reader names its role agent
 * on every prompt (Task 21.1), and conductor-reviewer, conductor-skeptic,
 * conductor-planner and conductor-mechanical each carry `edit: "deny"` in
 * opencode-fragment.json. opencode refuses that edit before conductor's gate is
 * consulted, so an edit grant minted by one of those sessions can never convert
 * into anything. Spending both budget meters and recording a permanent taint for
 * a bypass that provably cannot happen is ISSUE-007's shape, and this is
 * ISSUE-007's answer: refuse for free.
 *
 * The other gates are NOT covered. A `session` or `git` override from a reader is
 * not blocked at the opencode layer, so refusing it here would be inventing a
 * policy rather than declining a pointless spend.
 */
export function readerMayOverrideGate(role: string, gate: string): boolean {
  return !(READER_ROLES.includes(role) && gate === "edit");
}

/** The refusal for a reader-role edit override, naming why it costs nothing. */
export function readerEditOverrideWhy(tool: string, role: string): string {
  return (
    tool +
    ': the "edit" gate cannot be overridden from a ' +
    role +
    " session. That role is dispatched under an opencode agent whose own permission ruleset denies " +
    "edit, so the grant would be refused before this gate ever saw it — and a grant that cannot " +
    "convert is not worth an item taint or a budget meter. Nothing was spent. An edit this item " +
    "needs belongs to the implementer, through the receive-review loop."
  );
}

/** The refusal for a tool that reached the choke point with no declared row. */
export function undeclaredToolWhy(tool: string): string {
  return (
    tool +
    ": no legality row is declared for this tool in core/tool-legality.ts TOOL_LEGALITY, so " +
    "conductor cannot say whether it is legal at this position or legal for this caller. The " +
    "call is refused rather than run unguarded — declare its row (phase + callers) beside the " +
    "others, which is what makes a new tool impossible to add without answering both questions."
  );
}

/**
 * Whether `caller` may call `tool` at all, independent of where the run stands.
 * The refusal names the caller, because "refused for WHO you are" and "refused
 * for WHERE the run is" are different facts and a reader acts on them differently.
 */
export function callerAllowed(
  tool: string,
  caller: CallerIdentity,
): { ok: boolean; why: string } {
  const row = legalityRowOf(tool);
  if (row === undefined) return { ok: false, why: undeclaredToolWhy(tool) };
  const kind = callerKindOf(caller.role);
  if (row.callers.includes(kind)) {
    return { ok: true, why: tool + " is callable by " + kind + " sessions (§3.5)" };
  }
  const named =
    kind === "sub-session"
      ? 'a registered sub-session (role "' +
        String(caller.role) +
        '"' +
        (caller.itemId === undefined || caller.itemId.length === 0
          ? ""
          : ", dispatched for item " + caller.itemId) +
        ")"
      : "the orchestrator session";
  const allowlist = Object.entries(TOOL_LEGALITY)
    .filter(([, other]) => other.callers.includes(kind))
    .map(([name]) => name)
    .sort()
    .join(", ");
  return {
    ok: false,
    why:
      tool +
      ": this call arrives from " +
      named +
      ", and " +
      tool +
      " is not among the tools such a session may call. " +
      row.why +
      ". A " +
      kind +
      " may call: " +
      allowlist +
      " (§3.5).",
  };
}

// ---------------------------------------------------------------------------
// §3.6 override gates — the closed vocabulary (ISSUE-007)
// ---------------------------------------------------------------------------

/**
 * The gates a §3.6 override can actually bypass: exactly the decisions
 * adapter/tools.ts gateBeforeToolCall offers a grant against. A name outside
 * this set has no consumption point anywhere, so granting one taints the item,
 * appends the anomaly and spends BOTH budget meters for a bypass that can never
 * happen — two honest misspellings then exhaust the default budget and the third
 * stops the run `env`. The refusal below spends nothing.
 */
export const OVERRIDE_GATES: readonly string[] = ["session", "git", "edit"];

export function isOverrideGate(gate: string): boolean {
  return OVERRIDE_GATES.includes(gate);
}

/** The refusal for an override naming a gate no consumption point can spend. */
export function unknownOverrideGateWhy(tool: string, gate: string): string {
  return (
    tool +
    ': "' +
    gate +
    '" is not a gate an override can bypass. The gates with a consumption point are: ' +
    OVERRIDE_GATES.join(", ") +
    ". Nothing was spent — no budget meter moved, no taint was recorded, no anomaly was " +
    "appended — because an override that can never be converted is not an override that " +
    "happened (§3.6). Re-issue it naming one of those gates, or take the refusal the gate " +
    "actually gave you as the answer."
  );
}

// ---------------------------------------------------------------------------
// The phase predicates the adapter evaluates against persisted state
// ---------------------------------------------------------------------------

// The run position a phase rule is judged against — the §2.3 fields and nothing
// else, so a test fixture and a real run.json both assign.
export interface RunPositionForLegality {
  state: string;
  stop: { kind: string } | null;
  classified: boolean;
}

/**
 * The `non-terminal` rule (§2.3 terminality): a run is finished for every
 * subsystem at once the moment it records a stop or reaches a terminal state.
 */
export function nonTerminalAllowed(
  tool: string,
  run: RunPositionForLegality,
): { ok: boolean; why: string } {
  if (run.stop === null && !isTerminalRunState(run.state)) {
    return { ok: true, why: tool + ": the run is live at " + run.state + " (§2.3)" };
  }
  return {
    ok: false,
    why:
      tool +
      ": the run is TERMINAL — it is at " +
      run.state +
      (run.stop === null ? "" : ' and carries a stop of kind "' + run.stop.kind + '"') +
      ". A terminal run takes no further mutation (§2.3): its report is written, its items are " +
      "disposed of, and reopening it would make that record a lie. conductor_status still reads it.",
  };
}

/**
 * The `once-at-intake` rule: conductor_classify records the classification the
 * whole run rests on, exactly once, before anything else has been derived from it.
 */
export function onceAtIntakeAllowed(
  tool: string,
  run: RunPositionForLegality,
): { ok: boolean; why: string } {
  if (run.state === "INTAKE" && !run.classified) {
    return { ok: true, why: tool + ": the run is at INTAKE with no classification recorded (§3.2)" };
  }
  if (run.state !== "INTAKE") {
    return {
      ok: false,
      why:
        tool +
        ": the run has advanced to " +
        run.state +
        ", and classification is what every stage after INTAKE was derived from. Re-running it " +
        "here would rewrite queue.json under items that already exist and move the run along an " +
        "edge §3.1 does not have (§3.2).",
    };
  }
  return {
    ok: false,
    why:
      tool +
      ": this run's classification is already recorded, and it is recorded ONCE (§3.2). A second " +
      "classify re-rolls the classifier until it returns a cheaper kind — a `question` closes the " +
      "run ANSWERED, a `trivial` replaces the queue with one synthesized item and skips " +
      "decomposition and planning outright. Work with the classification the run has, or surface " +
      "the disagreement as a §2.11 question.",
  };
}

/**
 * The `verdict` rule: the tool must appear in core/gates-phase.ts legalTools'
 * offer for the run's current position. The refusal carries the gate's OWN
 * rationale and the offer it made instead, so the caller is told what to do next
 * rather than only what it may not do.
 */
export function verdictAllowed(
  tool: string,
  verdict: { legal: ReadonlyMap<string, unknown>; why: string },
): { ok: boolean; why: string } {
  if (verdict.legal.has(tool)) {
    return { ok: true, why: tool + " is offered at this position: " + verdict.why };
  }
  const offered = [...verdict.legal.keys()].sort();
  return {
    ok: false,
    why:
      tool +
      ": the phase-order gate does not offer it at the run's current position. " +
      verdict.why +
      " Legal right now: " +
      (offered.length === 0 ? "(nothing)" : offered.join(", ")) +
      ".",
  };
}
