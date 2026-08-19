# Test vetting — the criteria, and the five mock lenses

A test earns trust only when it exercises real behavior. Mocks isolate; they are
never the thing under test. Test what the code does, not what the mocks do.

Your verdict scores the §2.10 criteria generated at the foot of this pack — the
same list the harness validates it against; a criterion you fail sends the test
back to its writer. The five mock lenses below are that checklist's depth where
mocks reach.

## The Iron Laws

```
1. NEVER test mock behavior
2. NEVER add test-only methods to production code
3. NEVER mock a dependency you do not understand
```

## 1. Testing Mock Behavior

**Spot it:** the assertion checks a mock's existence — a `*-mock` test id, or
that a stubbed function "was called" — instead of an observable result.
**Avoid it:** assert on the real output the user would see; if a thing must be
mocked for isolation, assert on the behavior of the code around it, not the mock.
If you are checking the mock, delete the assertion or stop mocking that piece.

## 2. Test-Only Methods in Production

**Spot it:** a method on a production class is called only from test files
(a `destroy()`, a `reset()`, a back-door setter), or reaching past the lifecycle
it owns.
**Avoid it:** move the helper into test utilities. Production code carries only
what production calls; test cleanup and setup live in the harness, not the class.

## 3. Mocking Without Understanding

**Spot it:** you mocked a method "to be safe" without knowing its side effects —
and the test now passes for the wrong reason, or can no longer catch the behavior
it should.
**Avoid it:** before mocking, name the real method's side effects and whether the
test depends on any. If unsure, run against the real implementation first, then
mock at the lowest level (the slow or external operation) — never the high-level
method the test depends on.

## 4. Incomplete Mocks

**Spot it:** a mock response carries only the fields you happened to think of;
downstream code reads a field you omitted and fails silently, or passes in the
test while real integration breaks.
**Avoid it:** mirror the COMPLETE structure the real dependency returns — every
field the system may consume downstream, checked against docs or a real example.
If you build a mock, you own understanding its whole shape; when uncertain,
include all documented fields.

## 5. Integration Tests as Afterthought

**Spot it:** "implementation complete, ready for testing" — code first, tests
promised later, or the seams never exercised together.
**Avoid it:** testing is part of implementation, not a follow-up. Write the
failing test first, implement to pass, then claim complete.

## When mocks get complicated

Mock setup longer than the test, mocks missing methods the real object has, tests
that break when the mock changes — these are signals, not chores: a real component
is often simpler than an elaborate mock, so ask whether you need it.

<!-- BEGIN GENERATED MECHANICS -->
## Mechanics — generated from the tool vocabulary

Item stages, in FSM order: conductor_submit_test -> conductor_vet_test -> conductor_mark_green -> conductor_validate -> conductor_item_review -> conductor_publish. A non-behavioral item enters at conductor_mark_green.
A dispatched sub-session may call only: conductor_override, conductor_status, conductor_surface. Every other conductor tool belongs to the orchestrator, and a call from a dispatched session is refused by name — a session cannot answer its own question, defer its own item, close its own run or widen its own scope.

The harness re-derives which of these is legal on every request and names the one it recommends. A call out of order is refused, not negotiated.

## The §2.10 vet criteria

Judge a test on exactly these criteria, in this order, scoring each one `{pass, note}`:

1. `observableBehavior` — it asserts observable behaviour through the subject's public surface, not internals.
   Assert what a caller can see: a returned value, a thrown error, a written file. A test that reaches past the public surface pins the implementation the subject happens to have, and goes red on a refactor that broke nothing.

2. `wouldCatchWrongImpl` — a subtly WRONG implementation would still fail it — it is not a tautology and it is not testing a mock.
   Name the wrong implementation this test would catch, then check the assertion really would catch it. A test that passes against a stub, a mock's own return, or any implementation at all pins nothing — the one failure this stage exists to find.

3. `rightLevel` — it is at the right level (unit vs integration) for what it pins.
   Pin a self-contained decision at unit level; pin a seam between components where that seam actually runs. A unit test standing in for an integration concern passes while the wiring is broken, and the reverse is slow and names no cause when it fails.

4. `pinsAcceptance` — it pins THIS item's acceptance criteria, not a neighbouring concern.
   Read the item's acceptance and point every assertion at one of its clauses. A test aimed at a neighbouring concern earns a green the item's acceptance never demanded and leaves the behaviour it owed untested.

5. `antiPatterns` — no anti-patterns — no sleep-based timing, no assertion-free run, no snapshot of everything, no test that cannot fail.
   Wait on a condition rather than a clock, assert rather than merely execute, and pin the fields that carry the behaviour rather than snapshotting the world. test-vet.md's five mock lenses are this criterion's long form.

A `pass:false` IS a must-fix. The harness reads the verdicts a critic returns: a criterion failed with no `mustFix` entry beside it becomes one naming that criterion, and the test goes back to its writer for repair. An EMPTY `mustFix` with every criterion passing is the approval; never invent a fix to look thorough, and never ask for a change that only restates a criterion.

## When you are stuck

Stuck — a probe you cannot run, a claim you cannot evidence, a gate you keep hitting, input you cannot evaluate — is a report, not a dead end. Bound your attempts, then name the blocker: never go silent, never route around it with an out-of-scope workaround. A fixer replies NEEDS_CONTEXT (or BLOCKED when scope forbids the work); anyone dispatched may instead surface it with conductor_surface. A silent stall reads the same as a faked success.
<!-- END GENERATED MECHANICS -->
