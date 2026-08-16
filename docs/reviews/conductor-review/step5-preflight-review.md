# Step-5 Preflight Review — of `docs/reviews/conductor-review/**/*`

**Date:** 2026-08-16
**Scope:** every file under `docs/reviews/conductor-review/` (5 workflow docs, 6 runner scripts,
3 merged findings documents, 23 part files, README), reviewed in preparation for running step 5.
**Method:** all orchestration docs, runner scripts, and the three findings documents read in full;
part files checked for truncation and spot-checked for merge fidelity; cross-document bookkeeping
(ID spaces, pointer dispositions, mapping tables, register counts) verified mechanically; working
tree checked for leftover mutations.

---

## Bottom line

**Step 5 is ready to run. Nothing found blocks it.** Every input the step-5 agenda names exists and
is complete: findings-capability.md carries the provisional ordered plan (§8) and open decisions
D1–D15 (§9); findings-enforcement.md carries the executive verdict and the E1–E24 enforcement
table (§5); findings-macro.md carries the executive verdict and the 92-correction clustering (§3).
The suite's own checkpoint criteria all held (real mutation table, UNOWNED FILES = ∅, findings —
not filled-in templates). The findings below are corrections and clarifications, ranked by how much
each could mislead the step-5 session or a future re-run of the suite.

---

## Findings

### 1. ISSUE-139…142 have no home in the ISSUE register — a step-5 reader tracing them from the unified table hits a dead end

- **Where:** `findings-capability.md` §4 (lines ~737–745), §5.1 (rows 139–142);
  `findings-enforcement.md` ends at ISSUE-138.
- **What:** Step 4 correctly minted four new ISSUEs from step 2's dropped findings and one macro
  pointer (ISSUE-139 unvalidated `MetricsSummary` cast; ISSUE-140 fixed-`/tmp` scratch in
  verify-acceptance; ISSUE-141 two weak acceptance detectors; ISSUE-142 `sameTree` restatement).
  But the enforcement register — the document that owns the `ISSUE-` ID space and holds every other
  ISSUE's full record — ends at 138 and contains no forward pointer. The only full-detail records
  for 139–141 are buried in `findings-enforcement.md` §12.2's DROPPED table (under their *part-local*
  names) and in the original part files; ISSUE-142's fullest record is one sentence in
  `findings-macro.md` §6.
- **Why it matters for step 5:** the session is told to argue from the unified register. Anyone
  who follows ISSUE-139/-140/-141/-142 back for evidence will not find them where every other
  ISSUE lives.
- **Fix direction:** append a four-entry "ISSUE-139…142 (minted post-merge by step 4)" stub at the
  end of `findings-enforcement.md` §2 (or a pointer note in §12.2), each citing its §12.2 row /
  origin part. Five minutes; or simply carry this note into the step-5 session.

### 2. The mutation table mis-cites the evidence for ISSUE-139, and two tables disagree about it

- **Where:** `findings-enforcement.md` §6 row "delete metrics-body-object guard → DECORATIVE →
  **ISSUE-040**" (line ~1471); §7.4 row for the same mutation says "**(dropped id — see §12)**"
  (line ~1649); §12.2 (line ~2227) establishes the evidence actually belongs to FANOUT-004 —
  now ISSUE-139.
- **What:** the merged mutation table attributes the metrics-body-object-guard mutation to
  ISSUE-040 (failover — a different defect, FANOUT-012). §12.2 documents this as the predecessor's
  mis-attribution, and §7.4 already says "dropped id", but the §6 row was never corrected. Now that
  ISSUE-139 exists, both rows should cite it.
- **Fix direction:** change the §6 row's Issue cell to ISSUE-139 (with a note), and the §7.4 row
  likewise. Two cell edits.

### 3. The provisional plan's position 2 quietly contradicts the dependency graph's chain 2

- **Where:** `findings-capability.md` §7 serial chain 2 ("**MACRO-010 split decision →
  ISSUE-001/-002 wiring** → GAP-001/GAP-003 → 13.2") vs §8 positions 2–3 (position 2 lands the
  ISSUE-002 fix + GAP-004 *before* position 3 takes the split decision).
- **What:** chain 2 orders the tools.ts-split decision before *both* CRITICAL fixes; the plan takes
  it only before ISSUE-001's wiring. The relaxation is probably right — ISSUE-002's fix sits around
  tools.ts:2362, *outside* the audit-blind spans (8405–8488, 9104–EOF) that motivate
  split-before-wiring, so the rationale doesn't apply to it — but the document nowhere says so, and
  step 5 is going to re-order this plan. It should do so knowing which ordering constraint is real
  (ISSUE-001's new handler code landing in the blind span) and which is textual overreach in
  chain 2 (ISSUE-002).
- **Fix direction:** either narrow chain 2 to "…→ ISSUE-001 wiring" with a note that ISSUE-002's
  fix is exempt (edit lands outside the blind span), or add that sentence to position 2.

### 4. The charters cite record templates the briefing does not contain — every step-2 reviewer had to improvise

- **Where:** `2-enforcement.md:201` ("structured per briefing **§10** conventions" — the briefing
  ends at §8) and `:206` ("full record per the briefing's **field list**" — no ISSUE field list
  exists; the briefing defines only the IDEA template, §6.2); `3-macro.md:141` ("per the briefing's
  field list" — though 3-macro then enumerates its fields inline, which saved it);
  `4-capability.md:72–73` ("Use the **`GAP-NNN` record from the briefing**. `STRUCTURAL OR
  ADVISORY?` is the field that matters most" — no GAP record exists in the briefing);
  `run-step2a-subsystems.js:60`, `run-step2b-sweeps.js:60` ("per the briefing field list");
  `run-step4-capability.js:101` ("Use GAP records per the briefing").
- **What:** these are dangling references to a briefing revision that evidently once carried §9/§10
  record templates. The cost was real and is on the record: `parts/state-crash.md:19–22` documents
  improvising a field list; `parts/tools-handlers-b.md:543` filed it as a finding; the enforcement
  merge notes (findings-enforcement.md:1331–1333) say "This merge used the state-crash reviewer's
  field list." Every part coped, but each invented its own shape — a P3 (two spellings) inside the
  review machinery's own documents, which the machinery itself flagged.
- **Why it matters:** the README frames this suite as a standalone, re-runnable reference. On a
  re-run, sixteen agents will improvise sixteen record shapes again.
- **Fix direction:** add the de-facto field lists to the briefing (ISSUE: Pattern / Severity /
  Where / Claim / Defect / Evidence / What-a-lying-model-gets-away-with / Refutation-attempted /
  Fix direction — the state-crash list the merge adopted; GAP: Grounding / Mechanism /
  STRUCTURAL-or-DETECTED-or-ADVISORY / Effort / Floor-raised — the shape findings-capability
  actually used), or repoint the four citations at the charters' own §Output field enumerations.

### 5. Garbled sentence in the briefing's seam-findings rule

- **Where:** `1-briefing.md:316–317`: "…file a one-line pointer in your register's `CROSS-LENS
  POINTERS` section, naming which review owns it. **The macro review and 3 each begin** by reading
  the previous registers' pointers…"
- **What:** "The macro review and 3" is an editing leftover (presumably from "R2 and R3"). Should
  read "The macro and capability reviews (steps 3 and 4) each begin…". Harmless this run (both
  merges did read the pointers), confusing on a re-run.

### 6. The briefing uses three numbering schemes for the three reviews, two of them undefined

- **Where:** `1-briefing.md` §6 table (numbers the reviews 1/2/3 in the `#` column while the files
  are steps 2/3/4); §6.1 owner column uses **R1/R2/R3**, which are defined nowhere in the suite
  (the run-order renumbering removed whatever once defined them). `2-enforcement.md` still tells
  its agents "You are step 2, the first of three sequential reviews" — a fourth framing.
- **What:** all resolvable by inference (R1 = enforcement, R2 = macro, R3 = capability), but this is
  the exact "two spellings of one fact" pattern (P3) the same document teaches, applied to itself.
  One line defining R1/R2/R3 — or replacing them with "enforcement / macro / capability" — closes it.

### 7. Coverage-assertion arithmetic in the enforcement merge notes is off by one, and the router/tests exclusion is silent

- **Where:** `findings-enforcement.md` §12.5 (lines ~2293–2296): "yields **59** production files
  (17 core + 14 adapter + 1 plugin + 4 tools + 9 router + 15 scripts…)".
- **What:** the breakdown sums to **60**, and `git ls-files` over the stated scope (excluding
  `conductor/tests/`, `.md`/`.json`) confirms 60 (69 tracked source files minus the 9
  `router/tests/*.cpp`). Two wrinkles: (a) "59" contradicts the merge's own breakdown; (b) the
  scope sentence excludes only `conductor/tests/` — `router/tests/` (9 .cpp files) was excluded
  silently, without the "production file" interpretation being stated. Substance unaffected: the
  cpp-router part's assigned scope explicitly included `router/tests/` and read it, and the
  UNOWNED FILES = ∅ conclusion holds either way. But an off-by-one in the one section that exists
  to be mechanical is worth the two-word fix ("60 production files; router/tests/ excluded as the
  router's analog of conductor/tests/").

### 8. findings-macro's pointer to the dropped findings says "three", lists four, and cites the wrong section

- **Where:** `findings-macro.md:1058–1062`: "The **three** step-2 DROPPED findings (**§M.4**) need
  triage into the enforcement register: FANOUT-004 …, SWEEP-CORRECTIONS-009 …, SCRIPTS-PYTHON-014 …,
  SWEEP-GATE-MUTATION-010 …" — four items.
- **What:** count is wrong (four), and "§M.4" points at findings-macro's own merge-note section
  M.4 (the OPINION-downgrade tally); the dropped-findings list actually lives in
  `findings-enforcement.md` §12.2. No harm done — step 4 found and triaged all four — but the
  citation should read "enforcement §12.2" and "four".

### 9. README omits the continuation script that actually finished step 2, and its lose-the-run-ID advice is garbled

- **Where:** `README.md` Files section (lines 147–151) lists five `run-step*.js` scripts;
  `run-step2c2-merge-continuation.js` — the recovery workflow that completed
  findings-enforcement.md §7–§12 after the merge agent died — is absent from the README entirely.
  And lines 74–76: "If you lose the run ID, just re-run the script normally — agents whose part
  files already exist will redo work, **so instead delete nothing and re-run only the invocation
  you need**" — the sentence contradicts itself ("just re-run normally … so instead …").
- **What:** the 2c2 script is both part of the shipped suite and the audit trail of how the step-2
  deliverable came to exist (documented in findings-enforcement.md §12.0); the README should list
  it and name the pattern (a continuation prompt that appends the missing sections, inheriting the
  numbering). The recovery paragraph should say what it means: *re-running a whole script redoes
  completed agents' work (parts are overwritten); prefer resumeFromRunId; without a run ID, re-run
  only the specific invocation whose parts are missing, and delete nothing.*

### 10. The skeleton-first crash protection silently failed for the step-3 and step-4 merge agents — recorded in provenance notes, fed back nowhere

- **Where:** `findings-macro.md:10–12` ("the review harness blocks subagent file writes, so this
  document was returned as the merge agent's output for the orchestrator to place");
  `findings-capability.md:10–12` ("blocks subagent report writes, so this file was produced via
  shell append").
- **What:** the suite's whole crash story ("an agent that has been appending loses only its last
  few minutes") did not hold for the two later merge agents: the macro merge existed only in the
  agent's return value until the orchestrator placed it — a kill at minute 59 would have lost the
  entire merge, the exact failure the design exists to prevent (and which actually happened to the
  step-2c merge). The capability merge worked around it with shell appends. Neither the README's
  crash section nor the runner scripts record this hazard or the shell-append workaround for reuse.
- **Fix direction:** one paragraph in README §"If a run dies", and/or instruct merge agents in
  run-step3/run-step4 to write via shell append (the workaround that worked).

### 11. `run-step2c-composition-merge.js` meta says "sixteen parts"; the merge reads seventeen

- **Where:** `run-step2c-composition-merge.js:6` — phase detail "reconcile sixteen parts into one
  register"; the merge prompt itself (line 101) correctly says ten audits + six sweeps + one
  composition pass = seventeen. Cosmetic; one word.

### 12. Stale prunable worktree `wt14` is still registered — ISSUE-087's exact subject persists into step 5

- **Where:** `git worktree list` at HEAD shows
  `/private/tmp/claude-501/.../scratchpad/wt14 … (detached HEAD) prunable`.
- **What:** ISSUE-087 (C-074 F3 recurrence, second instance) records precisely this leak; the
  reviewers correctly did not fix it ("report, do not fix"). It is one command
  (`git worktree prune` or `git worktree remove`) and worth doing before step 5 so the third
  recurrence doesn't get recorded by whatever runs next.

### 13. All 28 review artifacts are staged but uncommitted — ~21k lines of findings exist in exactly one place

- **What:** everything under `docs/reviews/conductor-review/` (plus the phases-16-19 addendum plan)
  is `git add`-ed but not committed. The suite's own findings emphasize durable artifacts; the
  entire review record is currently one `reset`/crash away from gone. Recommend committing before
  opening the step-5 session (step 5 will also want a stable base to diff its outputs against).
  Note the addendum plan doc is staged in the same batch — decide deliberately whether it rides
  the same commit.

### 14. The three step-2 runner scripts triplicate the ~40-line COMMON preamble verbatim

- **Where:** `run-step2a-subsystems.js:11–49`, `run-step2b-sweeps.js:11–49`,
  `run-step2c-composition-merge.js:14–52` — byte-identical blocks.
- **What:** the machinery's own P3. Fine for a one-shot campaign; if the suite is kept as the
  reusable reference the README claims, a drift in one copy (e.g. a changed trap or gate command)
  silently diverges the other two. Low priority; a shared module or a "keep these three in sync"
  comment is enough.

### 15. Minor register-navigation notes for the step-5 reader (no action required)

- The enforcement doc's own §4 pointer still says tools.ts carries "~15 handlers"; macro M.5
  re-measured it as **22** and corrected it forward — trust the macro/capability numbers.
- Enforcement §12.1 documents that ISSUE-001's header over-claims its facets ("-002/-003/-004/-008"
  — only -002/-003 are folded in); already flagged inline, nothing to do.
- ISSUE/IDEA formats drift between registers (IDEA-NNN vs IDEA-STRUCT-1/IDEA-DE-4 etc.) — the
  briefing's §5.1 explicitly authorizes breaking the format, and the capability doc maps them all;
  cosmetic only.

---

## What was checked and found sound (so step 5 can rely on it)

- **Register arithmetic:** 138 `#### ISSUE-` entries in enforcement; 34 MACROs; 48 GAPs; unified
  table rows count 142/34/48 = 224, matching the claimed totals exactly.
- **Pointer bookkeeping is total:** step 2 left 10 macro pointers → all dispositioned in macro §7;
  6 capability pointers → all worked in capability §10; macro left 11 capability pointers → all
  worked; macro's 4 "enforcement-if-re-run" pointers → all dispositioned by step 4. Nothing dropped.
- **The four DROPPED step-2 findings were all recovered** (ISSUE-139/-140/-141 minted;
  SWEEP-GATE-MUTATION-010 folded into ISSUE-134 as a facet, with reasoning).
- **Mapping tables are total:** every part-local id in every part maps to a final id (spot-checked
  across gates-security, sweep-vocabulary, cpp-router, all four macro parts, MM-001…035,
  DE-001…014); capability's §2.1 covers all 49 part entries.
- **No part file is truncated** — all 23 end with completed cleanup/coverage/cleared sections.
- **The working tree is clean** — no unstaged modifications, no leftover mutations (the
  IDEA-PROC-3 hazard did not materialize at HEAD).
- **The runbook's checkpoint criteria all held:** the mutation table has ~70 real entries with
  observed outcomes; MERGE NOTES' UNOWNED FILES list is empty (verified mechanically here too,
  modulo finding 7's off-by-one); the registers are findings-dense, not template-shaped.
- **Step 5's own factual claims check out:** the classification vocabulary is indeed
  question/trivial/work (`conductor/core/types.ts:43`, plan line 681); `superpowers:brainstorming`
  is available; every "Read first" section it names exists in the named document.
- **Every file the charters name exists** (the four audit tests, nine doctrine packs, four
  conductor/tools files, CORRECTIONS.md, the phase-gates artifact, extending.md).

## Suggested order of operations

1. Commit the staged review artifacts (finding 13); prune `wt14` (finding 12).
2. Optionally spend ~15 minutes on findings 1–3 (the only ones that could actually mislead the
   step-5 conversation); the rest are for whenever the suite is next touched.
3. Run step 5 per the runbook — nothing blocks it.

---

## Corrections applied (2026-08-16, same day, before step 5)

The findings that could mislead the step-5 session were fixed in place; each edit carries a
provenance note at the site. The pre-correction text quoted in the findings above describes the
state as reviewed, not the state as committed.

- **Finding 1 — fixed.** Stub records for ISSUE-139…-142 appended at the end of enforcement §2
  (each citing its §12.2 row / origin part, and noting SWEEP-GM-010's fold into ISSUE-134); a
  triage-completed note added under the §12.2 intro; the §1 totals line now points forward to
  the minted ids. A `grep -c '^#### ISSUE-'` over the register now returns **139** (138 originals
  + the one stub heading covering 139–142).
- **Finding 2 — fixed.** The §6 mutation row and the §7.4 row both cite **ISSUE-139** (with the
  mis-attribution noted); §12.2's account is unchanged.
- **Finding 3 — fixed.** Chain 2 in capability §7 narrowed to "…→ ISSUE-001 wiring", with the
  ISSUE-002 exemption (fix at tools.ts:2362, outside the audit-blind spans) stated and the §8
  position-2 ordering marked deliberate.
- **Finding 7 — fixed.** Enforcement §12.5 now says **60** production files, and the
  `router/tests/` exclusion is stated instead of silent.
- **Finding 8 — fixed.** Macro's pointer now reads "four" and cites "enforcement §12.2"; the
  same three-vs-four miscount echoed in capability §10 ("The three DROPPED findings triage")
  fixed to "four".
- **Finding 15, first bullet — annotated.** The enforcement §4 pointer's "~15 handlers" now
  carries "[macro M.5 re-measured: 22]" inline.
- **Finding 12 — done.** `wt14` pruned.
- **Finding 13 — done.** Everything under `docs/reviews/conductor-review/` committed (the
  phases-16-19 addendum plan left staged, deliberately, for its own commit decision).

**Deliberately NOT fixed** (re-run concerns, deferred to whenever the suite is next touched, per
the triage above): findings 4 (briefing record templates), 5 (garbled seam sentence), 6 (R1/R2/R3),
9 (README continuation script), 10 (skeleton-first hazard feedback), 11 (sixteen/seventeen), 14
(COMMON preamble triplication). Part files under `parts*/` were not edited even where they carry
the same miscounts (e.g. fitness-forward's "59 files", missing-mechanisms' "three DROPPED") — they
are the audit trail of what each part actually wrote.
