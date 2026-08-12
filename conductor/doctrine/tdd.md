# TDD — the iron law

Write the test first. Watch it fail. Write the minimal code that makes it pass.
If you did not watch the test fail, you do not know that it tests the right thing.

## The iron law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST
```

No new behavior, bug fix, or refactor ships without a test that failed first.
Violating the letter of this rule is violating its spirit.

## The cycle: red → green → commit

1. **RED** — write one minimal test for one behavior. Clear name, real code, one
   assertion of intent. Run it. It MUST fail.
2. **Observe the red for the real reason** — the test must fail because the
   behavior is missing, not because of a typo, an import error, or a crash. Read
   the failure message and confirm it is the failure you predicted. A test that
   errors instead of failing is not yet red — fix it and re-run until it fails
   cleanly for the right reason.
3. **GREEN** — write the simplest code that passes. No extra options, no
   speculative abstraction, no "while I'm here" edits. Just enough to go green.
4. **Verify green** — the new test passes AND every other test still passes AND
   the output is clean (no warnings, no stray errors).
5. **Commit** — one behavior, tested, at green. Refactor only after green, and
   only while staying green.

## delete means delete

Wrote production code before its test? Delete it. Start over from the test.
Do not keep it "as reference," do not "adapt" it while writing the test, do not
look at it. **delete means delete.** Code kept around gets adapted, and adapting
it is testing after — which proves nothing, because a test written after passes
immediately and never proved it can catch the bug.

## No stubs, no placeholders

Green means real behavior, not a hard-coded return that satisfies one assertion.
No empty bodies, no fake constants standing in for logic, no "fill in later."
If the honest minimal implementation is large, your test is too coarse — split
it. A stub that passes is a red test you disabled, not a green one you earned.

## Common rationalizations — all mean STOP and start over

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code still breaks; the test costs seconds. |
| "I'll test after" | Tests-after pass on the first try and prove nothing. |
| "Keep it as reference" | You will adapt it. That is testing after. Delete. |
| "Already manually tested" | Manual is ad-hoc, unrepeatable, and forgotten under pressure. |
| "Deleting hours of work is wasteful" | Sunk cost. Code you cannot trust is the waste. |
| "Just this once / being pragmatic" | Rationalization. TDD is the pragmatic path. |
| "Test is hard to write" | Hard to test = hard to use. Fix the design, not the test. |

## Enforcement — your claim is not the record

Saying "the test failed" or "everything passes" does not make it so.
**the handler runs the test** and records the actual red and green transitions
from that run. The item advances only on evidence the harness itself produced.
RED before GREEN is structurally ordered — you cannot skip it. So do not narrate
a color the run did not show: **your claim is not the record.** Report what
happened; the ledger already knows.

## Checklist before you call it done

- [ ] Every new function has a test.
- [ ] You watched each test fail, for the reason you predicted.
- [ ] You wrote the minimal code to pass — no speculative extras.
- [ ] All tests pass; output is clean.
- [ ] No stubs, no placeholder bodies, no test-only shortcuts in the code.

Cannot check every box? You skipped TDD. Start over.
