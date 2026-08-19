// conductor/core/disposition.ts — GAP-022's ONE disposition function and
// GAP-021's TOTAL stop-kind closer. Core module: pure — decisions from persisted
// run/item state only; no I/O, no clock.
//
// WHY ONE FUNCTION (MACRO-005). "Is this item finished / waiting / hopeless?" is
// not an FSM state; it was recomputed by four core predicates with subtly
// different closures (isSettled, cannotEverPublish, settledForReport, the
// continuation engine's actionability condition). Every recorded wedge in this
// build lived in a disagreement BETWEEN those closures — the FSM edges themselves
// never strained. Each orthogonal execution mode (no-git, worktrees, debug,
// blocked dependencies) had independently minted its own disposition hole, which
// is the argument for one derivation with several consumers rather than several
// derivations that happen to agree.
//
// WHY ONE CLOSER (MACRO-006 / ISSUE-065). §2.9 defines six stop kinds; two of
// them — `blocked` and `surfaced` — were computed by core and written by nothing.
// `shouldTerminate` produced them, its one consumer deferred them to
// conductor_report, and conductor_report hardcoded `done`: a delegation ring with
// no writer, in which a run whose every item waited on a human closed
// "the run completed". `stopKindOf` is total over the six kinds and every
// terminal path routes through it, so the next execution mode extends ONE
// function instead of minting the next hole.

import type { FailureClass, StopKind } from "./types.ts";

// ---------------------------------------------------------------------------
// The closed disposition vocabulary
// ---------------------------------------------------------------------------

/**
 * The four dispositions, closed. Ordered worst-first for the run-level fold:
 *  - actionable   — the run can advance this item by itself;
 *  - waiting-human— a human holds the only lever (an OPEN §2.11 question);
 *  - stuck        — nothing this run can do and no answer that would release it;
 *  - settled      — the item's disposition for this run is final.
 */
export const DISPOSITIONS = ["actionable", "waiting-human", "stuck", "settled"] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

// ---------------------------------------------------------------------------
// Input shapes (the minimal persisted fields these pure functions may consume;
// the full §2.5 Item and the gate's narrower GateItem both assign structurally)
// ---------------------------------------------------------------------------

/**
 * §2.5's block annotation, as this derivation reads it. `questionId` is what
 * separates a block a human can release from one nothing can: a block minted
 * without one, or whose question has been answered, is not something an answer
 * will move. The index signature carries §2.5's other fields (`reason`,
 * `sinceMs`, `stage`) so the persisted record and the gate's narrower view both
 * assign without a widening cast at the call site.
 */
export interface BlockedRef {
  questionId?: string;
  [field: string]: unknown;
}

export interface DispositionItem {
  id: string;
  state: string;
  dependsOn: readonly string[];
  blocked: BlockedRef | null;
  deferred: unknown;
}

export interface DispositionCtx {
  /**
   * The ids of the §2.11 questions still UNANSWERED. Supply the real ledger:
   * with it, a blocked item whose question is live reads waiting-human and one
   * whose question is answered (or that never had one) reads stuck.
   */
  openQuestionIds?: readonly string[];
  /**
   * §3.9: with publish disabled, REVIEWED is where an item ENDS — the plan says
   * items "terminate at REVIEWED with their diff recorded in the report". So it
   * settles in that mode and only that mode; under git a REVIEWED item still
   * owes a publish.
   */
  publishEnabled?: boolean;
  /**
   * When the caller has no question ledger in hand, every blocked item is read
   * as waiting-human — the conservative reading, because treating a live block
   * as hopeless would let a report close over work a human was about to release.
   * Callers that DO hold the ledger pass `openQuestionIds` and get the sharper
   * answer.
   */
  assumeBlockedIsAnswerable?: boolean;
}

// ---------------------------------------------------------------------------
// dispositionsOf — the ONE derivation
// ---------------------------------------------------------------------------

function settles(item: DispositionItem, publishEnabled: boolean): boolean {
  if (item.state === "PUBLISHED") return true;
  if (item.deferred !== null && item.deferred !== undefined) return true;
  return !publishEnabled && item.state === "REVIEWED";
}

// An item that will never reach PUBLISHED in this run PROPAGATES: its dependents
// cannot reach PUBLISHED either. A deferred item is settled AND never publishes,
// which is exactly the pair the old cannotEverPublish seeded from. A blocked item
// with a LIVE question deliberately does not propagate — a question can be
// answered, so a run stalled behind one is waiting rather than finished, and
// legalizing an exit over it would offer a close over work that is still live.
function neverPublishes(item: DispositionItem, disposition: Disposition): boolean {
  if (disposition === "stuck") return true;
  return item.state !== "PUBLISHED" && item.deferred !== null && item.deferred !== undefined;
}

/**
 * Every item's disposition, as one map keyed by id. TOTAL: every input item
 * appears in the result exactly once.
 *
 * Computed as a FIXPOINT (seed, then propagate) rather than a recursive walk: a
 * queue whose dependsOn edges form a cycle — which core validateQueue refuses,
 * but which this derivation must not assume away — terminates here instead of
 * recursing forever.
 */
export function dispositionsOf(
  items: readonly DispositionItem[],
  ctx: DispositionCtx = {},
): Map<string, Disposition> {
  const publishEnabled = ctx.publishEnabled ?? true;
  const assumeAnswerable = ctx.assumeBlockedIsAnswerable ?? ctx.openQuestionIds === undefined;
  const openQuestions = new Set(ctx.openQuestionIds ?? []);

  const known = new Set(items.map((item) => item.id));
  const byId = new Map<string, DispositionItem>();
  const out = new Map<string, Disposition>();

  // (1) Seed: each item's own disposition, before any dependency reasoning.
  for (const item of items) {
    byId.set(item.id, item);
    if (settles(item, publishEnabled)) {
      out.set(item.id, "settled");
      continue;
    }
    if (item.blocked !== null && item.blocked !== undefined) {
      const questionId = item.blocked.questionId;
      const answerable =
        assumeAnswerable || (questionId !== undefined && openQuestions.has(questionId));
      out.set(item.id, answerable ? "waiting-human" : "stuck");
      continue;
    }
    out.set(item.id, "actionable");
  }

  // (2) Propagate: an actionable item whose dependency chain can never publish is
  //     stuck, not actionable — otherwise a single deferred dependency leaves the
  //     run with no legal exit at all (no stage tool for the dependents, no
  //     report, nothing recommended, forever).
  for (;;) {
    let added = false;
    for (const item of items) {
      if (out.get(item.id) !== "actionable") continue;
      const doomed = item.dependsOn.some((dep) => {
        if (!known.has(dep)) return true;
        const depItem = byId.get(dep);
        const depDisposition = out.get(dep);
        if (depItem === undefined || depDisposition === undefined) return true;
        return neverPublishes(depItem, depDisposition);
      });
      if (doomed) {
        out.set(item.id, "stuck");
        added = true;
      }
    }
    if (!added) return out;
  }
}

// There is deliberately no single-item `dispositionOf`. A disposition is not a
// property of an item in isolation — "stuck" is reached through the dependency
// chain — so a per-item entry point would need the sibling set anyway and would
// only offer a second, narrower spelling of the same derivation to drift from.

export interface RunFoldCtx {
  /** §2.11 questions still unanswered, including any that block no item. */
  openQuestions: number;
}

/**
 * Fold the item dispositions into the run's ONE disposition, worst-first: while
 * anything is actionable the run is actionable; failing that, a human lever
 * (a blocked item waiting on an answer, or an open question blocking nothing)
 * makes the run waiting-human; failing that, a stuck item makes it stuck;
 * otherwise it is settled.
 */
export function runDispositionOf(
  dispositions: readonly Disposition[],
  ctx: RunFoldCtx = { openQuestions: 0 },
): Disposition {
  if (dispositions.includes("actionable")) return "actionable";
  if (dispositions.includes("waiting-human") || ctx.openQuestions > 0) return "waiting-human";
  if (dispositions.includes("stuck")) return "stuck";
  return "settled";
}

// ---------------------------------------------------------------------------
// stopKindOf — the total §2.9 closer
// ---------------------------------------------------------------------------

/**
 * The terminal paths §2.9 recognizes. Every one of them names a cause here, and
 * every cause resolves to a member of STOP_KINDS through `stopKindOf` — so a
 * seventh terminal path has to answer the disposition question rather than
 * inventing its own literal.
 */
export const STOP_CAUSES = [
  // A run closing over its persisted dispositions (conductor_report, and the
  // continuation engine's detectable-wait floor).
  "settle",
  // The closing verify came back RED (decision D5).
  "closing-verify-red",
  // §3.7's futile re-prompt limit.
  "futility",
  // §3.6's override budget, spent to the cap.
  "override-exhausted",
  // The delivery layer could not reach the orchestrator.
  "transport",
  // §2.9 halt handling.
  "halt",
] as const;

export type StopCause = (typeof STOP_CAUSES)[number];

export interface RunDisposition {
  /** The run-level fold (runDispositionOf). */
  disposition: Disposition;
  /** Items carrying a §2.5 `blocked` annotation. */
  blockedItems: number;
  /** §2.11 questions still unanswered. */
  openQuestions: number;
  /**
   * Items the run actually carried to a terminal-with-work disposition:
   * PUBLISHED, or REVIEWED under §3.9's no-git mode. `done` requires at least
   * one — a run that advanced nothing did not complete, whatever else settled.
   */
  advancedItems: number;
  /** Items carrying a §2.5 `deferred` annotation, named in the no-progress reason. */
  deferredItems?: number;
}

export interface StopInputs {
  cause: StopCause;
  run: RunDisposition;
  /**
   * For `closing-verify-red`: the §2.6.1 class of the failure, which decides
   * between the two honest kinds. Absent or unclassifiable fails closed to
   * `blocked`.
   */
  failureClass?: FailureClass | null;
}

// Every §2.9 kind names the branch that produces it. `satisfies` makes a kind
// with no producing branch a TYPE error, which is MACRO-006's proof obligation:
// a closed vocabulary with no owning closer is over-specified for its recorders.
const PRODUCERS = {
  done: "every item settled, at least one advanced, and no human lever outstanding",
  noop: "the futile re-prompt limit, or a settle in which the run advanced no item at all",
  blocked:
    "a settle with a blocked or stuck item, or a RED closing verify the work itself owes",
  surfaced: "a settle with an open question that blocks no item",
  env: "override-budget exhaustion, a transport failure, or a closing verify whose runner could not run",
  interrupt: "halt handling",
} as const satisfies Record<StopKind, string>;

export interface StopVerdict {
  kind: StopKind;
  why: string;
}

function verdict(kind: StopKind, detail: string): StopVerdict {
  return { kind, why: detail + " (" + PRODUCERS[kind] + ")" };
}

/**
 * The ONE mapping from a terminal cause plus the run's persisted disposition to
 * a §2.9 stop kind. Total over STOP_CAUSES and onto STOP_KINDS.
 *
 * The `done` branch is the narrowest on purpose (G5): completion is the one
 * verdict a prompter must be able to trust blind, so it is reachable only from a
 * settle whose run has nothing actionable, nothing blocked, no open question, no
 * stuck item, at least one advanced item, and no red closing verify. Every other
 * shape resolves to a kind that tells the operator what to look at.
 */
export function stopKindOf(input: StopInputs): StopVerdict {
  const { cause, run } = input;

  switch (cause) {
    case "halt":
      return verdict("interrupt", "the run was halted");

    case "transport":
      return verdict("env", "the orchestrator could not be reached");

    case "override-exhausted":
      return verdict("env", "the override budget was spent to its cap");

    case "futility":
      return verdict("noop", "the run made no observable progress across consecutive re-prompts");

    case "closing-verify-red": {
      // Decision D5, STRICT. §3.2 calls the closing verify
      // "verification-before-completion made mechanical"; a law that cannot fail
      // the completion is advisory, so this branch has no `done` at all. The
      // failure class picks WHICH honest kind: an assertion (or a subject the
      // run owed and never wrote) is the work's own debt; a runner that could not
      // run is the environment's.
      const failureClass = input.failureClass ?? null;
      if (failureClass === "error") {
        return verdict("env", "the closing verify came back RED because its runner could not run");
      }
      return verdict(
        "blocked",
        "the closing verify came back RED" +
          (failureClass === null ? "" : " with a " + failureClass + " failure"),
      );
    }

    case "settle": {
      if (run.blockedItems > 0) {
        return verdict(
          "blocked",
          String(run.blockedItems) + " item(s) are blocked and none can be advanced by this run",
        );
      }
      if (run.disposition === "stuck") {
        return verdict("blocked", "the remaining work can never publish in this run");
      }
      if (run.disposition === "actionable" || run.disposition === "waiting-human") {
        // A settle over work that is still live is a contradiction between the
        // caller and the persisted state. It fails closed to the kind that sends
        // the operator looking, never to completion.
        if (run.openQuestions > 0) {
          return verdict("surfaced", "a human question is still open over live work");
        }
        return verdict("blocked", "the run was closed while work was still live");
      }
      if (run.openQuestions > 0) {
        return verdict("surfaced", String(run.openQuestions) + " human question(s) are still open");
      }
      if (run.advancedItems === 0) {
        // MACRO-007's measured escape: defer every item, close on a green verify
        // that executed none of the deferred work, and the run reads as
        // completion. Nothing is priced here — deferral stays free (decision D3)
        // — but a run that published nothing did not complete.
        const deferred = run.deferredItems ?? 0;
        return verdict(
          "noop",
          "every item settled without a single one being advanced" +
            (deferred > 0 ? ", " + String(deferred) + " of them deferred" : ""),
        );
      }
      return verdict("done", String(run.advancedItems) + " item(s) advanced and nothing is outstanding");
    }
  }
}

// ---------------------------------------------------------------------------
// closingVerifyFailure — the §2.6.1 class of a red closing verify
// ---------------------------------------------------------------------------

// Exit codes the evidence layer and the shell use to say the command did not
// run at all, as opposed to running and failing its assertions:
//   124 — adapter/evidence.ts's own stand-in when the child produced no numeric
//         status (timeout kill, spawn failure);
//   126 — found but not executable;
//   127 — not found;
//   >=129 — terminated by a signal (128 + signo).
const UNRUNNABLE_EXIT_CODES: readonly number[] = [124, 126, 127];

function unrunnable(exitCode: number): boolean {
  return UNRUNNABLE_EXIT_CODES.includes(exitCode) || exitCode >= 129;
}

/**
 * Classify a closing verify from the per-scope results the §2.6 verify record
 * already carries. A verify record holds no failure excerpt — only each scope's
 * green flag and exit code — so the class is derived from the codes, which is
 * the same distinction the evidence layer draws when it stamps 124 for a child
 * that never produced a status.
 *
 * Returns null for a green verify: there is no failure to classify.
 */
export function closingVerifyFailure(
  scopes: Readonly<Record<string, { green: boolean; exitCode: number }>>,
): FailureClass | null {
  const failing = Object.values(scopes).filter((scope) => !scope.green);
  if (failing.length === 0) return null;
  // One unrunnable scope makes the whole closing verify environmental: the run
  // has no verdict to give, which is a different fact than a failing test.
  if (failing.some((scope) => unrunnable(scope.exitCode))) return "error";
  return "assertion";
}

// ---------------------------------------------------------------------------
// The resume path (ISSUE-066)
// ---------------------------------------------------------------------------

/**
 * The stop kinds a human answer may revive. `blocked` and `surfaced` are the two
 * kinds that MEAN "waiting on you"; `noop` is included because the futile-wedge
 * detector is what fires on a run stalled behind an unanswered question, and
 * that run's committed work is exactly what ISSUE-066 recorded being written off.
 *
 * `done`, `env` and `interrupt` are not resumable: a completed run has its
 * artifact, a broken environment is not repaired by an answer, and an
 * interrupted run was stopped deliberately.
 */
export const RESUMABLE_STOP_KINDS = ["blocked", "surfaced", "noop"] as const;

export function isResumableStop(kind: string): boolean {
  return (RESUMABLE_STOP_KINDS as readonly string[]).includes(kind);
}
