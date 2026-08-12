// conductor/core/fsm-run.ts — §3.1 Run FSM (Task 3.1; plan lines 1029-1063,
// 671-712, 2208-2233). Core module: pure — no I/O, no runtime globals, no wall
// clock. Every fact a transition needs arrives as a plain context argument.
//
// The run advances FORWARD-ONLY through the §3.1 diagram; the majors -> revise ->
// re-review loop is INTERNAL to the plan-review handler and never regresses run
// state (PLAN_REVIEWED is reached only on a clean round or at planReviewMaxRounds).
// Two states branch: INTAKE routes on `classification`, and EXECUTING splits on
// the work/trivial close. Everything else is a single gated forward edge.

// §3.1 / §2.3 vocabulary — exactly these eight positions, nothing else.
export const RUN_STATES = [
  "INTAKE",
  "DECOMPOSED",
  "PLANNED",
  "PLAN_REVIEWED",
  "EXECUTING",
  "REPORTED",
  "TRIVIAL_DONE",
  "ANSWERED",
] as const;

export type RunState = (typeof RUN_STATES)[number];

// The evidence a run transition claims (§3.1). Structural/minimal on purpose: a
// param type demanding a full §2.3 run.json would reject the FSM's own fixtures.
export type RunTransitionContext = {
  classification?: "work" | "trivial" | "question";
  survivingMajors?: number;
  round?: number;
  max?: number;
};

export type TransitionResult = { ok: boolean; why?: string };

// The §3.1 forward diagram, as the legal successor set per state. INTAKE lists all
// three of its classification-selected exits; the selection itself is enforced in
// legalRunTransition (only ONE is legal for a given classification).
const RUN_SUCCESSORS: Record<RunState, readonly RunState[]> = {
  INTAKE: ["DECOMPOSED", "ANSWERED", "EXECUTING"],
  DECOMPOSED: ["PLANNED"],
  PLANNED: ["PLAN_REVIEWED"],
  PLAN_REVIEWED: ["EXECUTING"],
  EXECUTING: ["REPORTED", "TRIVIAL_DONE"],
  REPORTED: [],
  TRIVIAL_DONE: [],
  ANSWERED: [],
};

// A transition off the §3.1 diagram entirely. The `why` names the legal
// successors of `from` so the caller is told where the run CAN go next.
function illegalRun(from: RunState, to: RunState): TransitionResult {
  const successors = RUN_SUCCESSORS[from];
  if (successors.length === 0) {
    return {
      ok: false,
      why: `illegal run transition ${from}->${to}: ${from} is terminal (§3.1), no successor is legal`,
    };
  }
  return {
    ok: false,
    why: `illegal run transition ${from}->${to}; from ${from} the legal successor(s): ${successors.join(", ")} (§3.1)`,
  };
}

// §3.1 shared gate for PLANNED->PLAN_REVIEWED and PLAN_REVIEWED->EXECUTING: the
// plan-review loop exits only on a clean round (survivingMajors === 0) OR at the
// round cap (round >= max), at which point surviving majors are surfaced as
// questions and the run proceeds on the rest.
function planReviewGate(
  context: RunTransitionContext,
  from: RunState,
  to: RunState,
): TransitionResult {
  const majors = context.survivingMajors;
  const round = context.round;
  const max = context.max;
  if (majors === 0) {
    return { ok: true, why: `${from}->${to}: plan review clean (survivingMajors === 0) (§3.1)` };
  }
  if (round !== undefined && max !== undefined && round >= max) {
    return {
      ok: true,
      why: `${from}->${to}: planReviewMaxRounds reached (round ${round} >= max ${max}); surviving majors are surfaced as questions (§3.1)`,
    };
  }
  return {
    ok: false,
    why: `${from}->${to} needs a clean plan-review round (survivingMajors === 0) or the round cap (round >= max); ${String(majors)} major(s) survive below the cap (§3.1)`,
  };
}

/**
 * Legality of a single run-FSM edge (§3.1). Returns {ok:true} with a rationale
 * when the edge is on the forward diagram AND its context gate is satisfied;
 * {ok:false, why} otherwise. An off-diagram edge's `why` always names a legal
 * successor of `from`; a gate failure's `why` states the unmet requirement.
 */
export function legalRunTransition(
  from: RunState,
  to: RunState,
  context: RunTransitionContext,
): TransitionResult {
  switch (from) {
    case "INTAKE": {
      // The classification selects the ONE legal exit (§3.2): work->DECOMPOSED,
      // trivial->EXECUTING, question->ANSWERED. Any other target is off-route.
      const cls = context.classification;
      const route =
        cls === "work"
          ? "DECOMPOSED"
          : cls === "trivial"
            ? "EXECUTING"
            : cls === "question"
              ? "ANSWERED"
              : undefined;
      if (route === undefined) {
        return {
          ok: false,
          why: `INTAKE cannot advance without a classification; the legal successors are DECOMPOSED (work), ANSWERED (question), EXECUTING (trivial) (§3.1)`,
        };
      }
      if (to === route) {
        return { ok: true, why: `INTAKE classified "${cls}" advances to ${route} (§3.2)` };
      }
      return {
        ok: false,
        why: `INTAKE classified "${cls}" advances to ${route}, not ${to}; the legal successors of INTAKE are DECOMPOSED, ANSWERED, EXECUTING (§3.1)`,
      };
    }
    case "DECOMPOSED": {
      if (to !== "PLANNED") return illegalRun("DECOMPOSED", to);
      return { ok: true, why: `DECOMPOSED->PLANNED: queue validated, planning proceeds (§3.2)` };
    }
    case "PLANNED": {
      if (to !== "PLAN_REVIEWED") return illegalRun("PLANNED", to);
      return planReviewGate(context, "PLANNED", "PLAN_REVIEWED");
    }
    case "PLAN_REVIEWED": {
      if (to !== "EXECUTING") return illegalRun("PLAN_REVIEWED", to);
      return planReviewGate(context, "PLAN_REVIEWED", "EXECUTING");
    }
    case "EXECUTING": {
      // The close splits on run kind (§3.2): work runs close to REPORTED (full
      // report); trivial runs close report-lite to TRIVIAL_DONE.
      const cls = context.classification;
      if (to === "REPORTED") {
        if (cls === "work") {
          return { ok: true, why: `EXECUTING->REPORTED: work run closes with the full report (§3.2)` };
        }
        return {
          ok: false,
          why: `EXECUTING->REPORTED is work-only; a trivial run reports-lite to TRIVIAL_DONE (§3.2)`,
        };
      }
      if (to === "TRIVIAL_DONE") {
        if (cls === "trivial") {
          return { ok: true, why: `EXECUTING->TRIVIAL_DONE: trivial run closes report-lite (§3.2)` };
        }
        return {
          ok: false,
          why: `EXECUTING->TRIVIAL_DONE is trivial-only; a work run closes to REPORTED (§3.2)`,
        };
      }
      return illegalRun("EXECUTING", to);
    }
    case "REPORTED":
    case "TRIVIAL_DONE":
    case "ANSWERED":
      return illegalRun(from, to);
    default:
      // Unreachable: RUN_STATES is closed and every member is handled above.
      return illegalRun(from, to);
  }
}
