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

## Phase I.3 — ISSUE-088 stripComments canary
- **Landed:** one shared string/template/regex-aware `stripComments` at
  `conductor/tests/fixtures/strip-comments.ts` (both private quote-blind copies deleted);
  8 tests incl. three whole-tree canaries (no shipped file loses a CODE line, every tail
  survives, the original witness site is readable). Measured blast radius at HEAD before
  the fix: 150 blanked code lines in `core/gates-edit.ts`, 189 in `adapter/tools.ts`.
- **Widened-view sweep:** zero real violations in the newly visible ~340 lines — the one
  newly seen journal site (`config.updated`, tools.ts:9276) is a legal, listed event.
  Cross-checked against a real TS 5.9.3 parse over all 104 files: 0 code chars blanked,
  0 comment chars kept. Register drift noted: file is `core/gates-edit.ts` (register said
  adapter/), ranges shifted; defect reproduced exactly.
- **Evidence:** TDD red 6/8 → green 8/8; full gate 1404/1404 (implementer) + orchestrator
  mutation re-run (quote-branch neutered → fail=6; restore hash-identical) + full gate.
- **Verification note:** the stage's adversarial verifier never ran (see incident below);
  orchestrator verification substituted. The implementer itself caught and fixed a
  non-load-bearing regex assertion via mutation testing mid-stage.
- **Incident:** the machine SLEPT mid-workflow — the I.4a wiring agent died mid-response
  ("computer went to sleep"); the canary had already finished; no partial wiring edits
  reached the tree (verified: only the four canary files present). `caffeinate -is`
  (pid noted in session) now pins the machine awake for the campaign's remainder; the
  wiring stage resumes from the workflow cache.

## Phase I.2 — ISSUE-002 (CRITICAL) + GAP-004 + CR-2
- **Landed:** `sessionTreeOf(store, item)` returns `item.worktree ?? store.root` — always a
  PATH — with `itemTreeOf` deriving the marker SLUG independently; the shipped default
  (`parallel.writes:"off"`) accepts in-scope sub-session writes end to end. `core/types.ts`
  defines `TreeSlug`/`TreePath` (unique-symbol brands, erasable) + validating constructors
  (`treePath` refuses `"main"`; run-time half survives type-stripping) + `MAIN_TREE`/`NO_TREE`;
  the brand threads through every tree-carrying seam (9 production files, 25 test files).
  JSON schema spellings untouched (schema export regenerated byte-identical). New tests:
  `[issue-002-default-main-tree-composition]` (both directions through the real composed
  gate), `tree-types.test.ts` (misfeed = compile error on exactly 8 marked lines +
  anti-vacuity control + fail-closed constructors).
- **CR-2:** found ALREADY LANDED at HEAD (C-081 era) — all six `13.1-cr2-*` rows had
  passing, mutation-verified tests; the stage verified instead of re-implementing. Spec
  rows 62–67 `coveredByTest` filled and `knownPartialCoverage` marked paid (this commit).
- **Evidence:** TDD reds observed per subject; full gate 1396/1396 ×2 (verifier,
  orchestrator). Verifier re-ran all 15 load-bearing mutations with hash-verified restores;
  orchestrator independently re-ran the ISSUE-002 mutation (fail=3, restore hash-identical).
- **Verifier verdict:** CONFIRMED.
- **Residuals routed:** `sameTree` re-spelling at plugin/index.ts:842–848 → ISSUE-142,
  owned by GAP-002's deriveGateFacts (Phase VII.1). ISSUE-002 row premise hardcodes
  `writes:"off"` rather than binding production's default (C-077-adjacent scope nit) →
  small-fix basket. `tree-types.test.ts` writes tsc probes under `conductor/node_modules/`
  (cleanup in `after`; hygiene walkers all skip it) — accepted. `treePath("")` admitted as
  NO_TREE traces fail-closed on every path (HEAD-identical behavior) — accepted.
