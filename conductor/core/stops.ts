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

/**
 * Consecutive orchestrator turns observed at ONE unchanged futility signature.
 * Counted by the continuation engine, which owns both the signature derivation
 * and the turn events; this module owns only the threshold and the verdict.
 */
export interface TurnCounters {
  stalledTurns: number;
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

// §3.7 (plan lines 1465-1472): futileRePrompts reaching 3 is the wedge detector
// for a run that goes IDLE; §2.9's noop row and this constant encode the
// identical rule.
const FUTILE_RE_PROMPT_LIMIT = 3;

/**
 * The wedge detector for a run that never goes idle.
 *
 * FUTILE_RE_PROMPT_LIMIT counts RE-PROMPTS, and a re-prompt is only ever sent to
 * a session the bus reported idle. A session that generates continuously is
 * never sampled, so a run that spins productively-looking while making no
 * progress passes every guard: in the analyzed three-arm run the futility
 * signature held for 36 minutes while the model worked, run.json closed at
 * futileRePrompts 0, and the tier ceiling — not the harness — ended it, leaving
 * no stop record and no artifact. This threshold measures the SAME signature over
 * orchestrator TURNS, which are observable whether or not anything goes idle.
 *
 * WHY TWELVE. The analyzed run took 16 turns at one unchanged signature, and its
 * MEDIAN turn was about 80 seconds (its mean, 123 s, was dragged up by two
 * context compactions). Twelve turns is therefore ~16 minutes of wall clock at
 * the median and ~25 at the mean — inside the 45-minute tier ceiling either way,
 * so the run ends with a named stop instead of being killed mid-generation, and
 * four turns below the count actually observed, so that wedge dies here.
 *
 * The floor is set by what a HEALTHY run does at one signature. The signature
 * moves on every item state change, every run state change, every question
 * raised or answered; between two of those an orchestrator legitimately reads
 * files, greps and runs commands. Twelve consecutive model turns of that with
 * nothing to show is already far past a session gathering context, and the count
 * is CONSECUTIVE — any movement returns the whole budget — so the cost of the
 * threshold to a run that is working is zero.
 */
const STALLED_TURN_LIMIT = 12;

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
 * The run's position as GAP-021's closer reads it. The kinds are never spelled
 * by the callers below: the closer owns the cause-to-kind mapping, so a rule
 * added to §2.9 lands in one place instead of in each recorder's own literal.
 */
function closureOf(itemsSummary: ItemsSummary): {
  disposition: Disposition;
  blockedItems: number;
  openQuestions: number;
  advancedItems: number;
} {
  return {
    disposition: summaryDisposition(itemsSummary),
    blockedItems: itemsSummary.blocked,
    openQuestions: itemsSummary.surfacedQuestions,
    // This engine never closes a run on completion — `done` is conductor_report's
    // to record — so no advancement count is in play here.
    advancedItems: 0,
  };
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

  const closure = closureOf(itemsSummary);

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

/**
 * Decide whether the run must stop because the orchestrator has taken
 * STALLED_TURN_LIMIT consecutive turns without the futility signature moving.
 *
 * A second THRESHOLD over the one existing wedge rule, never a second rule: the
 * signature derivation and the progress comparison stay where they are, in the
 * continuation engine, and this function reads only the count they produce. The
 * kind is `noop` for the same reason the re-prompt limit's is — the run made no
 * observable progress — and it is reached through the same closer, so a run
 * stopped by turn count and one stopped by re-prompt count are one §2.9 stop
 * with one recorder, not a special case advanceRun has to know about.
 *
 * A terminal run is never stopped again: its stop or terminal state is already
 * recorded, and computing a second one would double-record.
 */
export function shouldTerminateStalledTurns(
  run: RunLike,
  turns: TurnCounters,
  itemsSummary: ItemsSummary,
): TerminateVerdict {
  if (isTerminal(run)) return { stop: false };
  if (turns.stalledTurns < STALLED_TURN_LIMIT) return { stop: false };
  return { stop: true, kind: stopKindOf({ cause: "futility", run: closureOf(itemsSummary) }).kind };
}
