// conductor/core/stops.ts — the §2.9 stop-kind vocabulary, §2.3's SINGLE
// terminality definition, and the termination rule the continuation engine
// and the report tool consult (Task 1.3; plan lines 2100-2128, 888-917,
// 705-711, 1456-1476). Core module: pure — decisions from counters and
// counts only; no I/O, no clock.

import { runDispositionOf, stopKindOf } from "./disposition.ts";
import type { Disposition } from "./disposition.ts";
import type { StopKind } from "./types.ts";

// §2.9's closed vocabulary, exported as runtime data so consumers iterate
// the same list the `StopKind` type is drawn from — nothing missing, nothing
// extra.
export const STOP_KINDS = [
  "done",
  "noop",
  "blocked",
  "surfaced",
  "env",
  "interrupt",
] as const satisfies readonly StopKind[];

// ---------------------------------------------------------------------------
// Input shapes (the minimal fields these pure functions may consume; the full
// §2.3 Run and §2.1 Config assign to them structurally)
// ---------------------------------------------------------------------------

export interface StopRecordLike {
  kind: string;
  reasonDisplay: string;
  tsMs: number;
}

export interface RunLike {
  state: string;
  stop: StopRecordLike | null;
}

export interface RunCounters {
  idleRePrompts: number;
  futileRePrompts: number;
  overridesUsed: number;
}

/** §2.9 / Task 1.3: counts derived from item files plus questions.jsonl. */
export interface ItemsSummary {
  open: number;
  blocked: number;
  deferred: number;
  surfacedQuestions: number;
}

export interface WorkflowBudget {
  workflow: { maxOverridesPerRun: number };
}

export interface TerminateVerdict {
  stop: boolean;
  /** Present exactly when stop is true. */
  kind?: StopKind;
}

// ---------------------------------------------------------------------------
// isTerminal — §2.3, one definition referenced everywhere
// ---------------------------------------------------------------------------

const TERMINAL_STATES: readonly string[] = ["ANSWERED", "REPORTED", "TRIVIAL_DONE"];

/**
 * §2.3 (plan lines 705-711): a run is TERMINAL iff
 * state ∈ {ANSWERED, REPORTED, TRIVIAL_DONE} OR stop !== null. This is the
 * ONLY definition — the continuation engine (§3.7), legalTools (§3.4), and
 * run creation (§3.2) all call it, so "EXECUTING with a stop recorded" is
 * terminal for every subsystem at once.
 */
export function isTerminal(run: RunLike): boolean {
  return run.stop !== null || TERMINAL_STATES.includes(run.state);
}

// ---------------------------------------------------------------------------
// shouldTerminate — the computed stop kinds
// ---------------------------------------------------------------------------

// §3.7 (plan lines 1465-1472): futileRePrompts reaching 3 is the ONLY wedge
// detector; §2.9's noop row and this constant encode the identical rule.
const FUTILE_RE_PROMPT_LIMIT = 3;

/**
 * The §2.9 counts, read as GAP-022 dispositions. `itemsSummary` carries counts
 * rather than items, so the fold is expressed over the counts directly — the
 * SAME four-member vocabulary the per-item derivation produces, so this engine
 * and the report closer cannot disagree about what a position means:
 *   open      -> an item this run can still advance      (actionable)
 *   blocked   -> a human holds the lever                 (waiting-human)
 *   questions -> a human lever with nothing blocked       (waiting-human)
 *   otherwise -> nothing outstanding                      (settled)
 * `deferred` contributes nothing: a deferred item is settled, never actionable.
 */
function summaryDisposition(itemsSummary: ItemsSummary): Disposition {
  const dispositions: Disposition[] = [];
  if (itemsSummary.open > 0) dispositions.push("actionable");
  if (itemsSummary.blocked > 0) dispositions.push("waiting-human");
  return runDispositionOf(dispositions, { openQuestions: itemsSummary.surfacedQuestions });
}

/**
 * Decide whether the run must stop, and with which §2.9 kind:
 *  - noop: futileRePrompts reached 3 (§3.7's rule verbatim) — fires even
 *    with open items: a wedged loop must end loudly, not burn tokens;
 *  - env: the override budget is exhausted — at least one override was USED
 *    and the count reached workflow.maxOverridesPerRun (§2.1) — also fires with
 *    open items: a gate that needs overriding this often makes every gate
 *    advisory. Exhaustion means overrides were consumed up to the cap; a zero
 *    cap at rest (none used) is not exhaustion and never env-stops at START;
 *  - blocked: no open item remains and blocked items remain;
 *  - surfaced: no open and no blocked item remains and human-territory
 *    questions are pending. Deferred items are settled, never actionable —
 *    they influence no rule.
 *  - done is recorded by conductor_report and interrupt directly by halt
 *    handling (§2.9); NEITHER is ever computed here.
 */
export function shouldTerminate(
  run: RunLike,
  counters: RunCounters,
  itemsSummary: ItemsSummary,
  config: WorkflowBudget,
): TerminateVerdict {
  // A terminal run has nothing left to stop: its stop or terminal state is
  // already recorded, and the engine never re-prompts it (§3.7, via
  // isTerminal). Computing a second stop for it would double-record.
  if (isTerminal(run)) return { stop: false };

  // The kinds are never spelled here: GAP-021's closer owns the cause-to-kind
  // mapping, so a rule added to §2.9 lands in one place instead of in each
  // recorder's own literal.
  const closure = {
    disposition: summaryDisposition(itemsSummary),
    blockedItems: itemsSummary.blocked,
    openQuestions: itemsSummary.surfacedQuestions,
    // This engine never closes a run on completion — `done` is conductor_report's
    // to record — so no advancement count is in play here.
    advancedItems: 0,
  };

  if (counters.futileRePrompts >= FUTILE_RE_PROMPT_LIMIT) {
    return { stop: true, kind: stopKindOf({ cause: "futility", run: closure }).kind };
  }

  if (
    counters.overridesUsed > 0 &&
    counters.overridesUsed >= config.workflow.maxOverridesPerRun
  ) {
    return { stop: true, kind: stopKindOf({ cause: "override-exhausted", run: closure }).kind };
  }

  // An open item is actionable work: while one remains, no summary-derived
  // stop applies (the counters above outrank it — a wedged or budget-blown
  // run stops regardless of open work).
  if (itemsSummary.open > 0) return { stop: false };

  // Nothing outstanding is not a stop this engine records: an all-settled run is
  // closed by conductor_report, which is the only writer of `done`.
  if (itemsSummary.blocked === 0 && itemsSummary.surfacedQuestions === 0) return { stop: false };

  return { stop: true, kind: stopKindOf({ cause: "settle", run: closure }).kind };
}
