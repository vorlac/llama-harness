# Test vetting — the five anti-patterns

A test earns trust only when it exercises real behavior. Mocks isolate; they are
never the thing under test. Test what the code does, not what the mocks do.
Before you keep a test, run it through these five lenses. Any hit = fix it.

## The Iron Laws

```
1. NEVER test mock behavior
2. NEVER add test-only methods to production code
3. NEVER mock a dependency you do not understand
```

## 1. Testing Mock Behavior

**Spot it:** the assertion checks a mock's existence — a `*-mock` test id, or
that a stubbed function "was called" — instead of an observable result.
**Avoid it:** assert on the real output or rendered role the user would see; if a
thing must be mocked for isolation, do not assert on the mock — assert on the
behavior of the code around it. If you are checking the mock, delete the
assertion or stop mocking that piece.

## 2. Test-Only Methods in Production

**Spot it:** a method on a production class is called only from test files
(a `destroy()`, a `reset()`, a back-door setter), or the class is reaching past
the lifecycle it actually owns.
**Avoid it:** move the helper into test utilities. Production code carries only
what production calls. Test cleanup and setup live in the test harness, never in
the shipped class.

## 3. Mocking Without Understanding

**Spot it:** you mocked a method "to be safe" or "because it might be slow"
without knowing its side effects — and the test now passes for the wrong reason
(or the behavior it should catch can no longer happen).
**Avoid it:** before mocking, name the real method's side effects and whether the
test depends on any of them. If unsure, run the test against the real
implementation first, observe what it truly needs, then mock at the lowest level
(the slow or external operation) — never the high-level method the test depends
on.

## 4. Incomplete Mocks

**Spot it:** a mock response carries only the fields you happened to think of;
downstream code reads a field you omitted and fails silently, or passes in the
test while real integration breaks.
**Avoid it:** mirror the COMPLETE structure the real dependency returns — every
field the system may consume downstream, checked against docs or a real example.
If you build a mock, you own understanding its whole shape. When uncertain,
include all documented fields.

## 5. Integration Tests as Afterthought

**Spot it:** "implementation complete, ready for testing" — code first, tests
promised later, or the seams between components never exercised together.
**Avoid it:** testing is part of implementation, not a follow-up. Write the
failing test first, implement to pass, then claim complete. You cannot call work
done without the tests that prove it.

## When mocks get complicated

Mock setup longer than the test, mocks missing methods the real object has, tests
that break when the mock changes — these are signals, not chores. A real
component is often simpler than an elaborate mock. Ask whether you need the mock
at all.

## The bottom line

Mocks are tools to isolate, not things to test. If vetting shows a test is
checking mock behavior, the test went wrong — test real behavior, or question
why the mock exists.

<!-- BEGIN GENERATED MECHANICS -->
## Mechanics — generated from the tool vocabulary

Item stages, in FSM order: conductor_submit_test -> conductor_vet_test -> conductor_mark_green -> conductor_validate -> conductor_item_review -> conductor_publish. A non-behavioral item enters at conductor_mark_green.

The harness re-derives which of these is legal on every request and names the one it recommends. A call out of order is refused, not negotiated.
<!-- END GENERATED MECHANICS -->
