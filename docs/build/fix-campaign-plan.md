# Conductor Fix Campaign — Ordered Plan

**Source of authority:** decided 2026-08-18 in the step-5 session; the decision record with all
rationale is `docs/reviews/conductor-review/step5-decisions.md`. Evidence lives in the three
review registers under `docs/reviews/conductor-review/` (ISSUE-/MACRO-/GAP- ids below resolve
there). This plan supersedes the capability register's §8 provisional ordering and HANDOFF.md's
2026-08-14 "Do these in this order" list (mapping in §"Absorbed queue" below).

**The premise every item serves:** trust lives in the harness, not the orchestrator. Any
prompter — human or LLM — hands the system a request; local models do all the work; the result
comes back self-defending (re-derived evidence, honest disposition, guaranteed terminal
report). **Acceptance criterion for the campaign: a naive prompter can accept the returned
result without re-verifying the work.**

**Execution rules:** progress is tracked in STATE.json/HANDOFF, never by editing this document.
All standing rules in HANDOFF.md apply (gate via `bash scripts/test-conductor.sh`, explicit
`git add` paths, `.data/`/`.out/` untouchable, per-task loop with observed red/green).

---

## Hard sequencing constraints

1. **GAP-035 before everything** — the gate is nondeterministically red at HEAD (ISSUE-134);
   no later verdict is evidence until it lands. Also the prerequisite of D5-strict semantics.
2. **GAP-017's stripComments canary before the ISSUE-001 wiring** (D2) — the wiring's new code
   otherwise lands in the audit's blind span.
3. **GAP-021/022 before any 13.2 attempt** — 13.2's acceptance is unsatisfiable without honest
   stop kinds; likewise 17.4 (recorded in the D14 amendment).
4. **GAP-025 flip and GAP-038 land together, only after 13.2's deny-rate data** (D7, D15a).
5. **The build-floor pass (Phase VII) completes before any phases-16–19 addendum task runs**
   (MACRO-030; recorded in the D14 amendment).

---

## Phase 0 — Document work (immediately; no code)

| Item | Content |
|---|---|
| 0.1 | **D14 addendum amendment**, six corrections: two silent-seam files added to file lists (MACRO-025); 17.4 gated on GAP-021; 17.5's ISSUE-001 dependency stated; D2 split re-decision rider; MACRO-030 sequencing constraint; the orchestrator-agnostic premise. Then commit the addendum. |
| 0.2 | GAP-048 risk-acceptance record (dashboard unread — 1,077 lines; read pass scheduled Phase 16). |

## Phase I — Preconditions (~week 1–1.5)

| # | Item | Content | Effort |
|---|---|---|---|
| I.1 | GAP-035 | Gate timeout, durable failure scratch, monotonic clock. De-noises every later verdict. | hours–1d |
| I.2 | ISSUE-002 + GAP-004 (+ CR-2) | Tree types (slug/path duality → compile error); the missing no-worktree composition test; the shipped default can accept sub-session writes. CR-2 (real `fileScope`/`testScope`/`verifyInFlightTree` derivation replacing the `plugin/index.ts` literals) is this same seam — land it here. | S |
| I.3 | GAP-017 canary | The stripComments fix only — makes the audit see the code Phase I.4 adds. Full inversion waits for Phase VII. | hours |
| I.4 | ISSUE-001 + GAP-001 + GAP-003 | Hooks registered (`chat.system.transform`, `chat.params`, `chat.headers`); delivery witnessed at wire, runtime, and beacon; the live-ish gate leg (real opencode + stub provider) standing. **Riders:** GAP-005 (single-source doctrine composition, generated MECHANICS section) and GAP-039 (tdd.md's cycle no longer ends in an always-denied action). | M |

## Phase II — The trust floor (~weeks 2–3)

| # | Item | Content | Effort |
|---|---|---|---|
| II.1 | GAP-006 | One legality choke point, threaded caller identity, an FSM API that cannot be lied to. Closes defer-all→done, classify-shopping, self-answer/self-defer (ISSUE-005/-006/E20/E21). | S–M |
| II.2 | Scope/TDD pass | GAP-015 (degenerate-config refusal), ISSUE-009 (rootLevelOnly hole, one line), GAP-007 (vetted-test identity witness across RED→vet→GREEN), GAP-008 (green-admission symmetry, **refuse** per D10), GAP-009 (scope size/shape at queue acceptance) **+ riders: read-set token bound, ISSUE-071 id/glob shape validation**, GAP-010 (scope disjointness, routeOf to core), ISSUE-046 (post-validate deletion freshness). **Plus the per-item attempt cap** (exhaustion → blocked/stuck, never a silent loop). | ~3–4d |
| II.3 | GAP-041 | test-vet.md and §2.10 become one list **and the criteria bite** (a critic failing `wouldCatchWrongImpl` with empty `mustFix` no longer advances the test — ISSUE-013). On the floor because a local testWriter's only check is the vet. | ~1d |

*Exit criterion: every reproduced lazy-model escape reachable from any pipeline role is closed.*

## Phase III — Judgment seams + disposition (~weeks 3–4.5)

| # | Item | Content | Effort |
|---|---|---|---|
| III.1 | Review-layer pass | GAP-011 (`[]` stops being free — diligence witness; review.md's calibration line kept verbatim, D15b), GAP-012 (fixer-receipt floor: DONE must intersect the finding), GAP-036 (**abstention-upholds** skeptic default, D11; symmetric refutation evidence), GAP-040 (reply protocols named; pushback matcher gets exact tokens). | ~3d |
| III.2 | GAP-022 + GAP-021 | One disposition function (actionable / waiting-human / stuck / settled) + total stop-kind closer + resume, under **D5-strict**: red closing verify ⇒ `blocked`/`env`, never `done`; §2.9's done row amended; six stop kinds kept. | M |
| III.3 | GAP-013 + ISSUE-052 | The out-of-band human-answer channel via the state area the model cannot write (§2.11 `answeredVia`); defer provenance derived, never model-claimed. Closes E14/E15 for a weak local orchestrator. | ~2d |

## Phase IV — Hygiene (~weeks 4.5–5.5)

| # | Item | Content | Effort |
|---|---|---|---|
| IV.1 | Security XS day | ISSUE-015 (`-c` exec-config keys), GAP-026 (case-fold `.conductor` deny), ISSUE-019 (hyphenated plumbing), ISSUE-020 (branch-creation arm), ISSUE-021 (`checkout -p`), ISSUE-037, **D8: apply_patch/patch removed from WRITE tools + wire-contract pin**. | ~1d |
| IV.2 | Concurrency/crash pass | Evidence attribution (immediately), then the OS single-writer **flock** (GAP-027, D6 — second session fails loudly); GAP-028 (transactional block-and-ask primitive); GAP-024 (tolerant ledgers, guaranteed terminal report). Withdraw the false "read-only conductor" claim. | ~3d |
| IV.3 | Cheap fixes + honesty records | ISSUE-070 (human-territory pattern narrowing); ISSUE-110 (**delete** eviction knob + dead `fetch_model` + README section); D9 deviation records (ISSUE-040 failover = setup probes only; ISSUE-041 503 codes diagnostic-only), lying headers corrected, `routerHealthy` deleted-or-wired, MACRO-031 "single upstream, single model" disclosure. | ~1–2d |

## Phase V — Doctrine + pre-live + first live contact (~weeks 5.5–6.5)

| # | Item | Content | Effort |
|---|---|---|---|
| V.1 | Doctrine content rest | GAP-037 (orchestrator playbook: generated run-shape in core.md), GAP-042 (decompose.md teaches gate-measured units), GAP-043 (uniform stuck-state protocol), GAP-044 (ask policy contradiction). GAP-005/-039 already landed in Phase I. | ~1.5d |
| V.2 | Pre-live readiness | GAP-032 (spec currency + the ~2-minute preflight — includes re-verifying the 13.2 spec against D5-strict and attended reality, MACRO-028), GAP-033 (both checkers, bound to runId + evidence seq), ISSUE-107, ISSUE-078, ISSUE-112, ISSUE-104 re-point, ISSUE-105/-106/-108, **ISSUE-042 key-bounding fix** (D9). All sub-day. | ~2–3d |
| V.3 | **13.2 attended live smoke** | From the re-verified spec. Instrumented: GAP-046 per-role doctrine-efficacy probes, IDEA-LC-9 deny-rate recording, **per-item competence-outcome recording** (triage thresholds), **briefing-bottleneck observation** (GAP-045 go/no-go). Produces `conductor/SMOKE.md`; pins `permission.asked` into wire-notes.md (10.1 SG-10). | live |

## Phase VI — Data-driven closures (post-smoke)

| # | Item | Content |
|---|---|---|
| VI.1 | GAP-025 flip **+ GAP-038** | Gate posture enumeration → attribution/deny-by-default, calibrated by 13.2's deny rates, landing together with deny-recovery doctrine + closed OVERRIDE_GATES vocabulary + deny-loop floor (D7, D15a). |
| VI.2 | **14.2 campaign** | 90 headless runs, detached. Spec conflict fixed FIRST per HANDOFF (three-way report-path conflict). Runs with valid arms (post-Phase I), honest stop kinds (post-III.2), a defended report, a measured posture. |

## Phase VII — The build floor (before any addendum task; ~1–2 weeks, parallelizable)

| # | Item | Content |
|---|---|---|
| VII.1 | GAP-002 + GAP-016 | Wiring manifest with completeness test + vocabulary registry with two-way parity and cross-language derivation — one declarative substrate. The registry **pins** plan-frozen spellings, never replaces them (D15c). |
| VII.2 | GAP-020, GAP-017 full, GAP-019 | Unreachable-exports audit; full inverted subject selection for every scanner and gate leg; control/discrimination witness (every checker proves it can fail). |
| VII.3 | GAP-018 | Standing mutation suite over the audit layer (seed corpus exists). |
| VII.4 | GAP-029, GAP-034 | Router-contact witness in every report; replay imports its vocabulary. |
| VII.5 | Record pass | GAP-030 (row-id ↔ test-title bijection + row lifecycle — absorbs 13.1's 37 uncovered M7 rows), GAP-031 (gate-record completeness, currency stamp, obligations index), honesty one-offs (ISSUE-073/-080/-084/-085), MACRO-021 doc fixes with IDEA-PD-4 markers. |
| VII.6 | Phase-16 basket | tools.ts split **re-decision** (D2 rider), GAP-048 one-agent dashboard read pass, MACRO-034's two-list paragraph, MACRO-014/IDEA-NAV items, small-fix leftovers. |

---

## Milestone-gated (parked, with owners — see decision record §4)

- **Unattended milestone** (first run left alone): GAP-014 full escape-hatch pricing (rest of
  D3), GAP-023 operator health surface.
- **13.2-data-gated:** GAP-045 read-set assembly (only if briefing is still the bottleneck);
  triage competence thresholds; GAP-025 flip calibration (Phase VI.1).

## Explicitly not scheduled (recorded risk acceptances, D13)

ISSUE-044, ISSUE-045, ISSUE-127, MACRO-034 (until VII.6), GAP-045/-047 (SPECULATIVE). Costs
stated in their register entries. The small-fix basket (capability §7) fills slack from
Phase II onward.

---

## Absorbed queue — HANDOFF.md's 2026-08-14 ordering, mapped

| Old item | Where it lives now |
|---|---|
| 1. CR-2 (gate literals) | Phase I.2 — same composition seam as ISSUE-002/GAP-004. |
| 2. Phase-gate 12/13/15 closure | Phase 12's six product defects overlap the pre-live set (V.2: ISSUE-105–108/-112 territory); 13.1's M7 row coverage → VII.5 (GAP-030); gate stage-2 re-runs happen when their subjects change, not before. |
| 3. 13.2 live smoke | Phase V.3, now instrumented and behind the trust floor instead of first. |
| 4. 14.2 (+ spec conflict) | Phase VI.2; the "fix its spec FIRST" instruction preserved verbatim. |
