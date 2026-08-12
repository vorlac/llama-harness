// conductor/core/fsm-item.ts — §3.3 Item FSM (Task 3.1; plan lines 1160-1302,
// 758-796, 817-825, 2208-2233). Core module: pure — no I/O, no runtime globals,
// no wall clock. The handler runs the test; this module only judges the evidence
// it reports (testExit, failureClass) against the §3.3 transition rules.
//
// Two chains share one tail (§3.3):
//   behavioral:true   PENDING -> RED -> TEST_VETTED -> GREEN -> VALIDATED -> REVIEWED -> PUBLISHED
//   behavioral:false  PENDING ----------------------> GREEN -> VALIDATED -> REVIEWED -> PUBLISHED
// `blocked`, `deferred`, `debugging` are §2.5 ANNOTATIONS, never FSM positions: a
// blocked item makes NO transition until answered — one rule orthogonal to the
// table, applied before it.

// §3.3 vocabulary — exactly these seven FSM positions. The three annotations are
// deliberately absent (asserted by the 3.1-vocab test).
export const ITEM_STATES = [
  "PENDING",
  "RED",
  "TEST_VETTED",
  "GREEN",
  "VALIDATED",
  "REVIEWED",
  "PUBLISHED",
] as const;

export type ItemState = (typeof ITEM_STATES)[number];

// §2.6.1 closed failure-class vocabulary.
export type ItemFailureClass = "assertion" | "missing-subject" | "error";

// The §2.5 `blocked` annotation — carries the question that must be answered
// before the item can move again.
export type ItemBlockedAnnotation = {
  questionId?: string;
  reason?: string;
  stage?: string;
};

// The minimal item facts a transition consults. Structural/minimal on purpose: a
// param type demanding a full §2.4/§2.5 item.json would reject the FSM's fixtures.
export type ItemFacts = {
  behavioral: boolean;
  blocked?: ItemBlockedAnnotation | null;
};

// The evidence an item transition claims (§3.3): the item's own facts, plus the
// handler-run test's exit code and classified failure.
export type ItemTransitionContext = {
  item: ItemFacts;
  testExit?: number;
  failureClass?: ItemFailureClass;
};

export type TransitionResult = { ok: boolean; why?: string };

// A transition off the §3.3 chain for this item's behavioral kind. The `why`
// names the legal successor(s) so the caller knows where the item CAN go next.
function illegalItem(from: ItemState, to: ItemState, successors: readonly ItemState[]): TransitionResult {
  if (successors.length === 0) {
    return {
      ok: false,
      why: `illegal item transition ${from}->${to}: ${from} is terminal (§3.3), no successor is legal`,
    };
  }
  return {
    ok: false,
    why: `illegal item transition ${from}->${to}; from ${from} the legal successor(s): ${successors.join(", ")} (§3.3)`,
  };
}

// PENDING->RED evidence gate (§2.6.1; behavioral items only, and to===RED already
// established): the handler-run test must have FAILED (exit != 0) for the RIGHT
// reason — the behavior was evaluated and was wrong ("assertion") or the subject
// this item is contracted to build does not exist yet ("missing-subject"). Class
// "error" (a syntax error, or a failure to resolve something outside the item's
// scope) is NOT a red; a passing test (exit 0) is not a red either.
function redEvidenceGate(context: ItemTransitionContext): TransitionResult {
  const exit = context.testExit;
  const failureClass = context.failureClass;
  if (exit === undefined || exit === 0) {
    return {
      ok: false,
      why: `PENDING->RED requires a genuinely failing test (exit != 0); a passing test is not a red (§2.6.1)`,
    };
  }
  if (failureClass !== "assertion" && failureClass !== "missing-subject") {
    return {
      ok: false,
      why: `PENDING->RED requires failureClass "assertion" or "missing-subject" (§2.6.1); class "${String(failureClass)}" (a syntax/collection error) is not a legal red`,
    };
  }
  return {
    ok: true,
    why: `PENDING->RED: test failed for the right reason (exit ${exit}, class "${failureClass}") (§2.6.1)`,
  };
}

/**
 * Legality of a single item-FSM edge (§3.3). A non-null `blocked` annotation
 * rejects EVERY edge first (naming the blocking questionId), orthogonal to the
 * table. Otherwise the legal successor set depends on `item.behavioral` — the
 * behavioral chain owes a proven RED before GREEN, the non-behavioral chain goes
 * PENDING->GREEN directly (§2.4: fileScope proven disjoint from behavioralPaths).
 * Evidence gates apply on PENDING->RED and TEST_VETTED->GREEN.
 */
export function legalItemTransition(
  from: ItemState,
  to: ItemState,
  context: ItemTransitionContext,
): TransitionResult {
  const item = context.item;

  // Annotation rule (§3.3), applied BEFORE the table: a blocked item makes no
  // transition — even an otherwise-legal one — until conductor_answer resolves
  // the named question.
  const blocked = item.blocked;
  if (blocked !== null && blocked !== undefined) {
    const questionId = blocked.questionId ?? "(unspecified)";
    return {
      ok: false,
      why: `item is blocked on question ${questionId}; a blocked item makes no transition until it is answered (§3.3)`,
    };
  }

  switch (from) {
    case "PENDING": {
      if (item.behavioral) {
        // Behavioral: the only legal exit is a proven RED (§3.3).
        if (to !== "RED") {
          return {
            ok: false,
            why: `from PENDING a behavioral item owes a proven RED first; the legal successor is RED (§3.3)`,
          };
        }
        return redEvidenceGate(context);
      }
      // Non-behavioral: no test is owed or constructible, so PENDING advances
      // directly to GREEN (§2.4). PENDING->RED is rejected here, routed to GREEN.
      if (to !== "GREEN") {
        return {
          ok: false,
          why: `from PENDING a non-behavioral item has no constructible red (§2.4); it advances directly to GREEN — the legal successor is GREEN`,
        };
      }
      return {
        ok: true,
        why: `PENDING->GREEN: non-behavioral item, no test owed (§3.3)`,
      };
    }
    case "RED": {
      if (to !== "TEST_VETTED") return illegalItem("RED", to, ["TEST_VETTED"]);
      return { ok: true, why: `RED->TEST_VETTED: red critics passed (§3.3)` };
    }
    case "TEST_VETTED": {
      if (to !== "GREEN") return illegalItem("TEST_VETTED", to, ["GREEN"]);
      // Evidence gate: the implementer is never done by assertion — the item test
      // must actually pass (exit 0) (§3.3).
      if (context.testExit !== 0) {
        return {
          ok: false,
          why: `TEST_VETTED->GREEN requires the item test to pass (testExit === 0); impl is not done by assertion (§3.3)`,
        };
      }
      return { ok: true, why: `TEST_VETTED->GREEN: item test passes (testExit 0) (§3.3)` };
    }
    case "GREEN": {
      if (to !== "VALIDATED") return illegalItem("GREEN", to, ["VALIDATED"]);
      return { ok: true, why: `GREEN->VALIDATED: full verify runs green, fresh (§3.3)` };
    }
    case "VALIDATED": {
      if (to !== "REVIEWED") return illegalItem("VALIDATED", to, ["REVIEWED"]);
      return { ok: true, why: `VALIDATED->REVIEWED: surviving review findings = 0 (§3.3)` };
    }
    case "REVIEWED": {
      if (to !== "PUBLISHED") return illegalItem("REVIEWED", to, ["PUBLISHED"]);
      return { ok: true, why: `REVIEWED->PUBLISHED: branch/stage/format/freshness/commit (§3.3)` };
    }
    case "PUBLISHED":
      return illegalItem("PUBLISHED", to, []);
    default:
      // Unreachable: ITEM_STATES is closed and every member is handled above.
      return illegalItem(from, to, []);
  }
}
