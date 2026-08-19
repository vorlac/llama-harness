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

## Phase II — GAP-006 + the scope/TDD pass + GAP-041 (the trust floor)
- **Landed (II.1, GAP-006):** `core/tool-legality.ts` — one declaration table (phase rule from
  a closed vocabulary + caller allowlist) through which EVERY `conductor_*` call passes via
  `requireToolLegal`; caller identity read from the §3.5 registry, never from arguments;
  sub-session allowlist = status/surface/override only; `advanceRun` derives position from
  persisted state (the hardcoded `legalRunTransition("EXECUTING",…)` sites are gone);
  `Run.classified` receipt closes classify re-entry; `OVERRIDE_GATES` closed vocabulary with
  unknown names refused at zero budget cost. Growth: an undeclared tool fails a guard test
  AND is refused at runtime. One pre-existing e2e test corrected (it spent its override on a
  gate with no consumption point — encoded ISSUE-007's defect).
- **Landed (II.2a):** setup floor (GAP-015), rootLevelOnly hole (ISSUE-009), vetted-test
  identity witness (GAP-007), green-admission REFUSE per D10 (GAP-008), real staged-deletion
  fact at publish freshness (ISSUE-046).
- **Landed (II.2b):** validateQueue refuses wildcard-headed globs, matched-file size budget,
  read-set token bound (`workflow.readSetTokenBudget`, default 20000, 0=off), id shape +
  newline folding (ISSUE-071), inter-item write-territory overlap for ANY kind pair;
  per-item attempt cap (`workflow.implementerAttempts`, default 3). Both knobs documented in
  docs/user/configuration.md (this commit).
- **Landed (II.3, GAP-041):** test-vet.md and §2.10 are one list; a critic verdict failing a
  load-bearing criterion refuses advancement naming the criterion (ISSUE-013 closed).
- **Fix rounds (4):** round 1 verdict PARTIAL → F1 (trivial-classification path bypassed ALL
  queue acceptance — closed: one acceptance authority, trivial routes through validateQueue),
  F3 (implementer's writable set now fileScope MINUS testScope — prevention before the spent
  sub-session), F6 (overlap refusal kind-blind), F7 (caller rule answered before argument
  shape). Round 3: GAP-015 coverage judged on ONE evidence universe (the detection walk) with
  complete judgment (no sorted 200-slice); decompose.md trimmed 6498→6319 bytes. Round 4:
  multi-ecosystem escape (coverage judged on PRE-widening per-ecosystem source globs; widened
  unions stay for requiredScopes routing) — verifier re-performed six doc-shaped answers, all
  refused.
- **Escape gauntlet (fresh verifier, own probes through real handlers):** defer-all→report
  refused from four positions; classify re-entry refused incl. deleted-receipt variant;
  eleven orchestrator-only tools refused from a real dispatched sub-session; misspelled
  override gate costs nothing; root-level TDD skip refused; '**' trivial fileScope refused;
  zero-test/fallback greens refused. Gate 1476/1476; orchestrator re-ran the round-4
  load-bearing mutation (red observed, restore hash-identical).
- **Residuals routed/accepted:** template-less ecosystems (cargo/cmake) now block at
  mark_green until an itemTest template is configured — loud, recoverable, a consequence of
  the owner's D10 REFUSE (accepted). Multi-ecosystem greenfield scaffolds take the
  non-empty fallback (deliberate). decompose.md headroom now 181 bytes — watch at Phase 16.

## Phase I.4 — ISSUE-001 (CRITICAL) + GAP-001 + GAP-003 + GAP-005 + GAP-039
- **Landed (wiring):** plugin registers `experimental.chat.system.transform` / `chat.params` /
  `chat.headers` (names verified against the SDK's own d.ts); one pure `composeDelivery`
  entry point in `adapter/inject.ts` so system text, temperature, and headers are three
  fields of one decision; every dispatched session receives its role's packs verbatim + the
  live state block (recommended next tool) + §4.1 temperature + §4.4 router tags. ISSUE-004
  ordering fixed: packs load fail-closed BEFORE the beacon writes, so beacon presence means
  doctrine deliverable. ISSUE-003 folded: doctrine dir resolvable, override channel honest.
- **Landed (witness, GAP-001):** three layers — wire (`live-inject.test.ts` drives a real
  `opencode serve` against a stub provider and asserts doctrine/state-block/params/headers
  in the outbound request, with an anti-vacuity leg), runtime (one journal receipt per
  delivery under the listed `inject`/`system-append` event: role, packs, packDigest),
  status (`conductor_status` renders last delivery per session). Multi-role witnessed at
  the unit layer (a parked in-flight sub-session gets tdd.md, its own temperature, its own
  role headers — NOT the orchestrator fallback); live leg stays single-role (gate cost).
- **Landed (GAP-003):** the live-ish leg rides the main suite via the wire-contract spawn
  idiom — real opencode, stub provider, every full gate run.
- **Landed (GAP-005):** `core/mechanics.ts` derives pack MECHANICS from `legalTools` itself
  (~14 synthetic FSM positions; meta list = TOOL_BINDINGS minus stage tools, so a new tool
  can never go unnamed); all nine packs carry the generated block; `tools/generate-mechanics.ts`
  splices under a marker law, CLI round-trip tested; guard test compares each pack against a
  FRESH derivation with an independent re-derivation anti-vacuity leg. Seven dispatch prompts
  stopped hand-spelling doctrine — they compose through fail-closed `doctrineSlice` (both
  failure arms separately load-bearing). `PLAN_PLACEHOLDER_LABELS` derives from the real
  rejector; plan.md names every rejected shape, guard goes red if a rule is added unnamed.
- **Landed (GAP-039):** tdd.md's cycle ends in a gate-legal action.
- **Evidence:** TDD reds per subject; fix round closed all 8 findings of the round-1 PARTIAL
  verdict (two false mutation claims, single-role witness, isRepo memo divergence, plan.md
  token regression, hygiene) — fresh verifier CONFIRMED all 8 with mutation re-runs; gate
  1440/1440 ×2 (recheck) + orchestrator (below). Orchestrator re-ran THE mutation
  (system-transform hook unregistered): 8/16 witness tests red; restore hash-identical.
- **Residuals routed:** beacon `doctrineLoaded` digest field (Beacon interface pinned by
  ops-docs at 4 fields; docs are orchestrator-territory) → Phase VII.5 record pass.
  GAP-002 wiring manifest → Phase VII.1 as planned. Live leg single-role → acceptable,
  noted. No repo guard exists for prohibited comment words (two 'now's slipped through
  agents twice) → candidate small guard, Phase VII basket.

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
