# Debugging doctrine — the systematic four-phase protocol

A bug, a failing test, or any unexpected behavior is not a prompt to start
patching. It is a prompt to understand. Guessing at fixes mutates the code
faster than you learn from it, and each blind edit hides the next clue. Work
the four phases in order. Do not skip a phase because the fix "looks obvious" —
an obvious fix that has not survived phase 3 is still a guess.

## The four phases (in order)

### 1. Root Cause Investigation

Before proposing any fix, find the actual cause.

- Read the error, the stack trace, and the failing assertion completely. The
  message usually names the file and line where reality diverged from
  expectation — start there, not where you assume the bug lives.
- Reproduce the failure deterministically. A bug you cannot trigger on demand
  is a bug you cannot prove you fixed.
- Trace the failing value backward to its origin. Follow the data, not your
  memory of how the code "should" flow.
- State the root cause in one sentence. If you cannot, you are still in
  phase 1.

### 2. Pattern Analysis

A single failure is rarely alone.

- Search for every other call site that shares the faulty shape, guard, or
  assumption. The same mistake tends to be copied.
- Compare the broken path against a working sibling. What differs is the lead.
- Decide whether this is one local defect or one instance of a systemic one.
  A local fix on a systemic fault leaves the other instances live.

### 3. Hypothesis and Testing

Form ONE hypothesis at a time and test it before acting.

- Write the hypothesis as a falsifiable claim: "if X is the cause, then
  changing Y makes the failure disappear and nothing else breaks."
- Test it with the smallest probe possible — a log line, an assertion, a
  one-value experiment — not a broad rewrite.
- If the probe disproves the hypothesis, discard it and return to phase 1 with
  what you learned. Do not stack a second guess on top of an unconfirmed first.
- Only a confirmed hypothesis earns a fix.

### 4. Implementation

Fix the confirmed root cause, minimally.

- Change the least code that removes the cause. Resist "while I'm here"
  refactors; they hide whether the fix worked.
- Re-run the failing test and the surrounding suite. A green that you did not
  watch turn from red is not evidence.
- If phase 2 found siblings, fix them in the same pass or record them
  explicitly. Silent partial fixes are how a bug returns.

## The 3-fix rule — after 3 fixes, question the architecture

Count your attempts at the same failure site. If 3 fixes at the same place have
each failed to resolve it, STOP. Do not attempt a fourth patch.

Three failed fixes at one spot is not bad luck — it is a signal that the frame
is wrong. The bug is probably not where you keep editing; the design around it
makes the correct behavior unreachable or the failure inevitable. So
**question the architecture**: name the assumption the current structure forces,
ask whether a different structure removes the class of bug entirely, and
surface that question rather than grinding out a fourth guess. Escalating the
architecture after 3 fixes is the disciplined move, not the failure.

<!-- BEGIN GENERATED MECHANICS -->
## Mechanics — generated from the tool vocabulary

Item stages, in FSM order: conductor_submit_test (testWriter) -> conductor_vet_test (reviewer, testWriter) -> conductor_mark_green (implementer) -> conductor_validate (implementer) -> conductor_item_review (reviewer, skeptic, implementer, testWriter) -> conductor_publish. A non-behavioral item enters at conductor_mark_green.
A stage's parenthesised roles are the sub-sessions it dispatches: making the call is how that work gets authored, so never write the artifact yourself. A bare stage dispatches none.
A dispatched sub-session may call only: conductor_override, conductor_status, conductor_surface. Every other conductor tool belongs to the orchestrator, and a call from a dispatched session is refused by name — a session cannot answer its own question, defer its own item, close its own run or widen its own scope.

The harness re-derives which of these is legal on every request and names the one it recommends. A call out of order is refused, not negotiated.

## When you are stuck

Stuck — a probe you cannot run, a claim you cannot evidence, a gate you keep hitting, input you cannot evaluate — is a report, not a dead end. Bound your attempts, then name the blocker: never go silent, never route around it with an out-of-scope workaround. A fixer replies NEEDS_CONTEXT (or BLOCKED when scope forbids the work); anyone dispatched may instead surface it with conductor_surface. A silent stall reads the same as a faked success.
<!-- END GENERATED MECHANICS -->
