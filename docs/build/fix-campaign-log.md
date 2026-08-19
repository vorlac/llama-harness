# Fix Campaign — per-item record

Plan: `docs/build/fix-campaign-plan.md`. One entry per landed item: what landed, the observed
evidence, the verifier's verdict, residuals and where they were routed. Entries are terse and
factual; design rationale lives in the plan and the decision record, not here.

---

## Phase 0.1 — D14 addendum amendment · commit 31456bc
A3–A6 constraints, the five-file tool-addition map at 17.3/18.1, dependency gates on 17.4
(GAP-021) and 17.5 (ISSUE-001). Document work only.

## Phase I.1 (gate half) — GAP-035 / ISSUE-032 · commit f6c0fdd
`scripts/test-conductor.sh`: `--test-timeout=120000` on the node leg; a failing exit preserves
the leg scratch dir at a printed durable path instead of deleting it. Both paths exercised
before commit (zero-glob red preserved evidence + exited 1; scoped green cleaned up).

## Phase I.1 (TS half) — GAP-035 / ISSUE-134 P14 root
- **Landed:** `adapter/clock.ts` (strictly-increasing sub-ms epoch clock, injectable sources;
  `stampResolutionMsOf`); `capturedRedOf` recency = ledger APPEND POSITION, never seq value;
  torn ledger line forces `stale` (skipped for choosing, counted for recency);
  `core/freshness.ts` §2.6 tie decided by `stampResolutionMs` DATA (precise stamp ⇒ tie is
  stale; coarse stamp keeps equality-counts-fresh); one clock instance wired through the
  plugin ToolDeps bundle + continuation hook; `fanout.test.ts` `makeConfig` default
  `subSessionTimeoutMs` 900_000 → 60_000 (ISSUE-032's runner-stall tail).
- **Evidence:** red observed at assertion level by reverting both comparisons (fail=3);
  green 9/9 scoped; full gate 1391/1391 ×3 (implementer, verifier, orchestrator). Load-bearing
  mutation (seq-value comparison restored) re-run independently by verifier AND orchestrator:
  fail=2 each; restores hash-verified (`git diff` sha256 b512669b… identical before/after).
- **Verifier verdict:** CONFIRMED. Core layering clean (no clock/I-O entered core).
- **Honest limit:** the live P14 flake never reproduced (~70 min under 24–28 burners, 250
  harness runs). The claim on record is "the two load-sensitive comparisons ISSUE-134 names
  are no longer load-sensitive," not "the observed flake was watched to die."
- **Residuals routed:** seq minting is still read-max-plus-one (ISSUE-026 — Phase IV.2 owns
  it; capturedRedOf no longer consumes seq for recency, but future consumers inherit the
  collision). Torn line is a whole-ledger flag: one crash artifact costs one extra
  re-establish per vet for the run's life (cost, fail-safe direction; rides GAP-024).
  Stamp resolution is inferred from the value rather than persisted on the record (~1e-6
  per-stamp chance a precise stamp self-reports coarse; degrades lenient — sounder as a
  persisted field if the record schema is ever touched again).
- **New observation (not in any register):** `[G14-gitio]` — under heavy load, bun 1.3.14's
  `execFileSync("git rev-parse HEAD")` returned EMPTY stdout inside `bun-smoke.test.ts`'s
  own git helper while the adapter's `headSha()` was correct; one bun-leg gate failure,
  evidence preserved at the gate's durable path. Watch for recurrence; not scheduled.
