# Sweep: The 92-Correction Recurrence Sweep

**Scope:** Read all 92 entries of `docs/build/CORRECTIONS.md`; for each, extract the defect CLASS
and hunt the repo for unfixed recurrences of that class. Then re-open every REFUTED finding in
`docs/build/GATES.json` and `docs/build/artifacts/phase-gates-12-13-15-findings.md` and test whether
the settling evidence actually discriminates (P10).

**Date:** 2026-08-16
**Reviewer:** sweep-corrections agent (step-2 enforcement review, corrections lens)
**Status:** COMPLETE. 10 ISSUEs (1 medium-major, 5 medium, 3 minor, 1 low), 7 IDEAs, 7
cross-lens pointers. All 92 corrections have a recurrence-table verdict; the P10 re-open
overturned one refutation (ISSUE-004), confirmed one refuted finding true at e2e scope (§6.1),
and found the refutation record itself unauditable (ISSUE-005). All mutations restored and
verified (cmp + git status); no stray processes.

---

## 1. ISSUE register

### SWEEP-CORRECTIONS-001 — The C-032 E7 crash-window class covers 7 blocking sites; the prevention half covers 2 and the repair half covers an origin filter that excludes 4 of them

- **Class:** CL-CRASHORD (question-first / setBlocked-second half-applied block), recurrence of
  C-032 E7 / C-031 E4 / C-067(a).
- **Severity:** MINOR-to-MAJOR depending on site (see below). Filed as one issue because it is one
  rule enforced in fragments.
- **Where:** `conductor/adapter/tools.ts` and `conductor/adapter/continuation.ts:425-466`.
- **Evidence (verified at HEAD, 2026-08-16):**
  - `reuseOrAppendBlockingQuestion` (tools.ts:573) — the C-032 E7 *prevention* — is called at
    exactly TWO sites: tools.ts:3138 (submit/blockAndAsk) and tools.ts:3595 (vet).
  - Bare `appendQuestion` question-first / `store.setBlocked` second still exists at FIVE
    block-minting sites: tools.ts:4231 (`mark_green` stuck exit, origin `implementer-blocked` —
    the exact site C-067(a) recorded as owed), tools.ts:6099 (`blockReviewAndAsk`, origin
    `implementer-blocked` — C-067(a)'s second owed site), tools.ts:3794 (origin
    `review-round-cap`), tools.ts:6560 (origin `review-round-cap`), tools.ts:4571 (origin
    `debug-architecture`), plus tools.ts:6901 (origin `scope-conflict`) and the multi-item
    plan-review-cap loop at tools.ts:2246 (origin `plan-review-cap` — C-031 E4's exact deferred
    shape, one question then per-item blocks in a loop).
  - The *repair* half, `reconcileOrphanQuestions` (continuation.ts:425), contains
    `if (question.origin !== "implementer-blocked") continue;` — so a crash in the window at any
    of the `review-round-cap` / `debug-architecture` / `scope-conflict` / `plan-review-cap` sites
    leaves an open question whose `blocksItems` name items carrying **no disposition**, and no
    production path ever completes the block.
- **Consequence, reasoned precisely:** not a permanent wedge (the question is open, so
  `conductor_answer` stays legal, and `answerQuestion`'s clear is idempotent). But: (a) the item a
  cap intended to freeze stays actionable — e.g. after `review-round-cap` fires, `attempts` were
  persisted BEFORE the question (tools.ts:6089-6090), so a crash in the window leaves an
  at-cap item unblocked; the driver re-enters the stage, hits the cap instantly, and mints a
  SECOND open question via bare `appendQuestion` — the duplicate-ask defect C-032 E7 was fixed
  for, on a different origin; (b) the `plan-review-cap` loop can still crash half-applied with a
  resume that re-appends duplicate cap questions (C-031 E4, deferred to 10.1; 10.1's fix repaired
  only `implementer-blocked`).
- **History:** C-067(a) recorded two of these sites in 2026-08 with "a two-line change …
  belongs to whoever next opens tools.ts for the Phase 10 review". tools.ts has since been opened
  by C-081, C-082, C-088 and others; the wiring never happened, and the origin filter in the
  repair half was never widened. A recorded debt with no owner does not get paid — cross-refs the
  meta-observation in §3.
- **Attempted refutation (per briefing §4):** I tried to read the origin filter as deliberate —
  the reconciler's comment cites "§2.11, C-032 E7", which is the implementer-blocked story, and
  the cap origins mint their question at a point where `setBlocked` follows within microseconds.
  That refutation fails because the identical microsecond argument applied to blockAndAsk, and
  the build still judged the window worth closing there (twice: prevention + repair). The class
  is the same; only the origin string differs.
- **Fix direction:** route all seven sites through `reuseOrAppendBlockingQuestion` (it is
  origin-generic already), and drop or widen the reconciler's origin filter to "any origin whose
  producers pair the question with a block" (all of the above).

### SWEEP-CORRECTIONS-002 — C-075 Finding 1's mandated 14.2 spec revision never landed: a flawless POC campaign still fails acceptance

- **Class:** CL-BADROW (P8) + recorded-obligation-never-scheduled.
- **Severity:** MAJOR for the 14.2 campaign (the build's most expensive single artifact).
- **Evidence (verified at HEAD):** `scripts/verify-acceptance.sh:163` hard-codes
  `POC=docs/build/artifacts/conductor-report.md` (and references the same path again at :365).
  `docs/build/specs/task-14.2.assertions.json` contains **zero** occurrences of that path
  (`grep -c` = 0); its SG-A resolution and row `14.2-committed-copy` (line 118) still fix the
  committed copy at `bench/conductor-report.md` ONLY, with a byte-identical-prefix proof against
  the `.data/` emission — a proof shape that does not even leave room for a second copy unless the
  row is revised.
- **Why it matters:** C-075 stated it exactly: "A flawless 14.2 campaign, executed exactly as its
  own spec instructs, lands the artifact where the meter does not look and leaves acceptance at
  17/4," and mandated the additive dual-path revision "**before** the campaign launches …
  discovering it after ninety runs means either a re-run or an artifact shuffled across paths
  after the fact, which is exactly the 'measurement tuned while it is being taken' shape row
  `14.2-no-tuning` exists to forbid." The revision was recorded in CORRECTIONS.md on 2026-08-14
  and never made. 14.2 is still unscheduled, so the window to fix this cheaply is open — but the
  obligation lives only inside a 4,600-line append-only file, which is how C-072 already lost one
  obligation (`IN_PROGRESS.json` single slot) before C-062's copy saved it.
- **Attempted refutation — and it PARTIALLY SUCCEEDS, entry downgraded accordingly:**
  `docs/build/HANDOFF.md:55-60` DOES carry the obligation ("Then 14.2 … **FIRST fix its spec**,
  and the conflict is now THREE-way: `conductor_bench.py:45` writes
  `.data/benchmark/conductor-report.md`, spec row `14.2-committed-copy` names
  `bench/conductor-report.md`, and the meter checks `docs/build/artifacts/conductor-report.md`").
  So this is a **tracked known-open**, not an untracked one. What survives of the finding:
  (a) the spec file itself is still self-contradictory with the meter — anyone consuming
  `task-14.2.assertions.json` without HANDOFF is misled; (b) HANDOFF names a THREE-way conflict
  where C-075 named two, which I verified is the more accurate description
  (`conductor_bench.py:45` does emit to `.data/benchmark/`); (c) severity drops to MEDIUM
  (tracked, but the fix is a text edit that has now been owed across two corrections and one
  handoff revision without landing — the same never-scheduled pattern as ISSUE-001).
- **Fix direction:** add the second-path clause to `14.2-committed-copy` (or a sibling row) now,
  exactly as C-075 specified; the obligation should not outlive a third document.

### SWEEP-CORRECTIONS-003 — The POC report's noise-honesty sentence can be inverted to a lie with every test green (C-077's class, surviving in the file C-077 fixed)

- **Class:** CL-ORACLE (P2).
- **Severity:** MEDIUM-MAJOR — it sits on the exact honesty surface C-077 named ("an unpinned
  honesty formatter in the driver is a fabrication route that needs no one to fabricate
  anything"), in the renderer of the artifact acceptance row 8 reads.
- **Evidence (mutation, run 2026-08-16, snapshot/`cmp` restored):**
  - `scripts/conductor_bench.py:131` `NOISE_NOTE = "…within noise at three repetitions and are
    not separable."` The test file's only uses are `assertIn(cb.NOISE_NOTE, report)`
    (test_conductor_bench.py:1598) and an `assertNotIn` on the cleanly-separated fixture
    (:1610) — both sides read the module constant.
  - Mutation `"not separable." → "fully separable and statistically significant."`:
    **Ran 33 tests … OK.** The report now asserts the opposite of what the overlap computation
    established, and nothing notices. (The PRESENCE/ABSENCE gating is properly pinned: mutating
    the constant to the empty string fails `[14.1-report-never-bare-aggregate]` via the
    `assertNotIn` direction, and `SECTION_MISSING`/`PARTIAL_MARKER` empty-string mutations each
    fail one test — recorded in the mutation table. What is unpinned is the CONTENT.)
  - C-077's own fix pattern (pin the literal in the test that owns the round-trip assertion) was
    applied to the five formatters and to `NA` (:1449 pins `"n/a"`), and NOT to `NOISE_NOTE`,
    `SECTION_PER_TASK`, `SECTION_ARM_TOTALS`, `SECTION_MISSING`, `NOISE_NOTE`, `PARTIAL_MARKER` —
    of these only NOISE_NOTE carries a semantic claim, which is why it is the one filed.
- **Attempted refutation:** one could argue the note's presence-iff-overlap is the load-bearing
  property and the wording is cosmetic. That fails: the wording IS the honesty claim ("within
  noise … not separable") — a reader of conductor-report.md acts on the sentence, not on the
  branch that emitted it, and C-077 treated exactly this surface as MAJOR.
- **Fix direction:** `self.assertEqual(cb.NOISE_NOTE, "<the full literal>")` beside the existing
  formatter pins; same one-line pin for the section headings while there.

### SWEEP-CORRECTIONS-004 — The §3.2 item size budget counts fileScope ENTRIES, so one broad glob evades it (C-030 E12, wrongly refuted)

- **Class:** enforcement-advisory (R1's core question) + CL-FALSEREF (P10).
- **Severity:** MEDIUM. Not a security hole (the edit gate still bounds writes to the scope —
  but the scope IS the broad glob, so the bound is the whole tree under it).
- **Evidence:** `core/planning.ts:37` `ITEM_MAX_FILES = 5`; `:378`
  `if (item.fileScope.length > ITEM_MAX_FILES)`. The module is pure (no fs imports), so the
  check structurally counts list entries. §2.4 permits glob entries (adapter
  `expandScopeEntry` exists in handlePublish because of exactly that, C-052). An item declaring
  `fileScope: ["src/**"]` therefore passes the §3.2 "~5 files" size row while granting itself
  edit permission over every file under `src/` — the evasion a competent-but-lazy planner model
  lands on naturally, since splitting items is the work the budget exists to force.
- **P10 history:** raised twice at the 9.2 review (E12 refuted 2/2, F7 panel under-delivered);
  the recorded refutation rationale is procedural ("the stronger panel governs"), not
  substantive, and the refutation evidence itself is unrecorded. Re-opened per my charter;
  the evasion is live at HEAD by construction.
- **Attempted refutation (mine):** (a) "globs are rare in practice" — false premise, the
  product's own publish path was FIXED to handle them; (b) "the disjointness/cluster rules bound
  the item anyway" — they bound INTERSECTION and acceptance phrasing, not size; (c) "counting
  expanded files needs fs access core cannot have" — true for core, but the ADAPTER validates
  queues too and already owns `expandScopeEntry`; the check can live at the legality step like
  `assertContainedPaths` (C-032 E5) does.
- **Fix direction:** at queue-accept time in the adapter, expand glob entries against the repo
  and count FILES against the budget (or refuse globs in fileScope at decompose, forcing the
  planner to name files — which is what "~5 files" means).

### SWEEP-CORRECTIONS-005 — Refuted review findings are recorded without their refutation evidence, making P10 auditing impossible from the record

- **Class:** CL-FALSEREF (P10), meta.
- **Severity:** MEDIUM (process; it is the exact mechanism by which C-032 F1's false negative
  survived five months of subsequent review).
- **Evidence:** `docs/build/artifacts/phase-gates-12-13-15-findings.md:589-593` — three refuted
  MAJORs, one line each, zero refutation reasoning (upheld findings in the same artifact carry
  full per-skeptic rationales); `CORRECTIONS.md` C-027 ("1 refuted … dropped", unnamed), C-028
  ("4 refuted", unnamed), C-030 (E1/E7/E12 named, one-clause rationales). GATES.json phase-8 row
  (:916) repeats "4 refuted" without names.
- **Consequence demonstrated:** re-litigating the three phase-13 refutations (this document §6.1)
  required re-running the mutations from scratch; one of the three named refutations elsewhere
  (C-030 E12) turned out not to discriminate (ISSUE-004). Whether the OTHER unnamed refuted
  findings (phase 8's four, C-027's one) were sound is now unknowable without re-running those
  panels.
- **Fix direction:** the review-machinery rule should be symmetric: a refutation is recorded with
  the same evidence obligations as an uphold — the discriminating input, the run, and the exact
  reading under which the finding fails. One paragraph per refutation would have sufficed.

### SWEEP-CORRECTIONS-007 — The C-032 E12 torn-questions-ledger fix covers 2 of 4 reader sites: conductor_status and conductor_report still die with a raw SyntaxError

- **Class:** CL-TORNLINE (C-017 / C-029-F6 / C-032-E12 recurrence).
- **Severity:** MEDIUM. `handleStatus` is the always-legal diagnostic tool — the one an operator
  reaches for when something is already wrong — and `handleReport` is the terminal artifact
  writer, including the §2.9 STOP-REPORT path: a torn `questions.jsonl` makes the run unclosable
  with an error naming neither tool nor file.
- **Evidence (reproduced):** `readQuestions` (adapter/questions.ts:67) is a bare per-line
  `JSON.parse` — fed a ledger whose trailing line is torn mid-record it throws
  `SyntaxError: Unterminated string in JSON at position 32 (line 1 column 33)` (reproduced in a
  scratch dir 2026-08-16; note "line 1" refers to the trimmed line, obscuring further). Its
  production callers split cleanly into fixed and unfixed:
  - **Wrapped with the C-032 E12 named-refusal pattern:** tools.ts:2609 (comment: "must fail as
    a NAMED legality failure … never as a raw SyntaxError naming neither") and tools.ts:5145
    (dispatch_wave); tools.ts:582/1086 and continuation.ts:375/433 degrade to `[]`.
  - **Unwrapped:** tools.ts:835 inside `handleStatus` (starts :819) and tools.ts:7390
    (`reportQuestionLines`, called from `handleReport` :7418).
- **Attempted refutation:** "a torn ledger is rare and status throwing is loud." Loud, yes —
  named, no; C-032 E12 classified precisely this as a fix-worthy NIT and the fix's own comment
  states the rule generally. Also "degrade-to-[] callers are fine" — mostly, though note the
  futility signature (continuation.ts:375) silently drops all questions on a torn ledger, which
  can make a wedged run's signature appear to change once; one-sided and bounded, noted only.
- **Fix direction:** either heal at the reader (skip unparseable lines the way journal.ts:114
  and evidence.ts:263 do — both tolerate bad lines) or wrap the two remaining callers in the
  same named refusal as tools.ts:2609. The reader-level heal is strictly better: it makes the
  class unrepresentable instead of chasing call sites, which is this build's own stated
  preference (constructions over conventions).

### SWEEP-CORRECTIONS-006 — A stale prunable git worktree is again left registered (C-074 Finding 3's class, second instance)

- **Class:** CL-STALEWT (hygiene; a claim in a gate record falsified by the tree).
- **Severity:** LOW.
- **Evidence:** `git worktree list` at review start shows
  `…/scratchpad/wt14 7b3ae58 (detached HEAD) prunable` alongside main. C-074 Finding 3 recorded
  the identical shape for `wt12` ("whose record asserts 'worktree removed afterwards;
  `git worktree list` shows only the main tree'"). wt12 was cleaned; the NEXT gate (the one that
  cut wt14) repeated the leak. The cleanup is manual and the claim "worktree removed afterwards"
  keeps entering records unverified.
- **Fix direction:** the fresh-worktree gate leg ends with `git worktree remove` + a
  `git worktree list` assertion in the same script, not in prose. (Not removed by this review —
  a concurrent session may hold it; same restraint C-074 exercised.)

---

### SWEEP-CORRECTIONS-008 — The C-032 E13 "floor fractional knobs at the read" rule is applied at eight sites and skipped at three

- **Class:** CL-KNOB (C-032 E13 / C-031 E10 recurrence), and a small CL-TWOSPELL (one rule,
  hand-applied per site).
- **Severity:** MINOR.
- **Evidence:** floored: `testRepairAttempts` (tools.ts:3095), vet critics (:3529, :6309),
  `vetMaxRounds` (:3541), `debugFixCap` (:4485), `subSessionTimeoutMs` (:5220), item-review
  sessions (:6017), item-review skeptics k (:6019), `reviewMaxRounds` (:6020). NOT floored:
  - `planReviewMaxRounds` (tools.ts:2129, :5237) — `planReviewMaxRounds: 2.5` grants a third
    revision (round 2 >= 2.5 false), one more than any integer reading permits;
  - plan-review `skepticsPerFinding` (tools.ts:1984) — the k<1 guard passes k=1.5; the dispatch
    loop `i < k` rounds UP to 2 jobs per major, and the read-back stride
    `verdictResults[index * k + i]` (:2029) lands on fractional indices for the second and later
    majors, yielding `undefined` verdicts and tripping the "no skeptic verdict came back" throw
    — a real transport-loss error message for what is a config-shape error (C-031 E10's exact
    prediction, raised at the Phase 9 gate and never closed);
  - `readFanout` itself (core/schedule.ts:263) returns the raw min — callers floor it at some
    sites (vet) and not others (planReview's `Math.max(readFanout(...), 4)` at :1942 can carry
    4.5 into the job-count loop).
- **Attempted refutation:** "no operator writes 1.5." The §2.1 schema types these `number` with
  no integer constraint (that is WHY E13 was filed and fixed), and C-038 gave the C++ side full
  integer validation for the same reason; the TS side chose per-read flooring and then applied
  it inconsistently.
- **Fix direction:** floor once in a shared `readKnob`/config-load normalisation (the C-038
  approach), deleting the per-site `Math.floor`s — this is also the Phase 9 "one rule, one
  derivation" theme applied to itself.

### SWEEP-CORRECTIONS-009 — verify-acceptance.sh still uses fixed /tmp transcript paths, the exact class C-078 fixed in test-conductor.sh

- **Class:** CL-FIXEDTMP (C-074 F2 / C-078 recurrence).
- **Severity:** MINOR (verdicts come from exit codes; what can be corrupted is the quoted
  EVIDENCE, not the pass/fail).
- **Evidence:** `scripts/verify-acceptance.sh` writes `/tmp/accept-bun.out` (:64),
  `/tmp/accept-cmake.out` (:83), `/tmp/accept-ctest.out` (:84), `/tmp/accept-guards.out` (:103),
  `/tmp/accept-m5.out` (:352), and then greps THEM for the strings it prints into its own PASS
  lines ("row 3: ctest green — $(grep -Eo '[0-9]+% tests passed' /tmp/accept-ctest.out)"),
  and its FAIL lines tail them for the displayed reason. Two concurrent meter runs — or any
  process using those names — cross-contaminate the quoted evidence: a PASS line can quote
  another run's counts, and a FAIL line another run's failure. C-078 fixed the identical shape
  in test-conductor.sh with a per-invocation `mktemp -d` + EXIT trap and wrote down the lesson
  ("a gate that reads another gate's numbers is a wrong answer that looks exactly like a right
  one"); the acceptance meter — the build's outermost check — kept the old shape.
- **Fix direction:** the same five-line mktemp change, same trap.

### SWEEP-CORRECTIONS-010 — The gate's bun leg has no test-count floor: `bun test` exits 0 on a file with zero tests

- **Class:** CL-SCAN (P1), in the gate itself — the class C-005/C-015/C-062 closed for the node
  and python legs, left open for the bun leg.
- **Severity:** MINOR (single file, currently populated; the hole opens only if discovery
  silently breaks).
- **Evidence:** probed 2026-08-16 in scratch: a `.test.ts` file containing no tests →
  `bun test file; echo $?` → **0**. `scripts/test-conductor.sh`'s bun leg takes its verdict from
  the exit code alone and uses `grep -Eo '[0-9]+ pass'` for DISPLAY only. The node leg fails on
  `tests == 0`; the python leg fails on `Ran 0`; the bun leg — the G14 dual-runtime proof —
  would pass vacuously if bun stopped discovering the smoke file's tests (a bun upgrade changing
  node:test interop is the realistic route; bun self-updates were the C-012 lesson's sibling).
- **Fix direction:** assert the displayed grep: fail unless the captured "N pass" has N ≥ 1 —
  three lines, matching its siblings.

## 2. IDEA register

### IDEA-001 — Pin the report section headings and honesty constants with one-line literal asserts
Origin: ISSUE-003's hunt. Kind: test-maintainability. Value: closes the whole remaining P2
surface of the POC report in ~6 lines. Cost: trivial. Relates to: ISSUE-003.

### IDEA-002 — M5 should scan `scripts/*.sh`
Origin: reading conductor-gate.sh in full. The four gate shell scripts are the enforcement
machinery itself and are outside every scanner (M5 skips them; they are not tests; they are not
python). A TODO-marker or an `|| true` rotting in a gate script is exactly where it hurts most.
Kind: tooling. Cost: one glob + floor (they would need ~2 line-exemptions at most). Relates to:
recurrence rows C-057/C-072/C-078.

### IDEA-003 — Heal torn JSONL lines at the reader for ALL ledgers, the way journal.ts and evidence.ts already do
Origin: ISSUE-007. questions.jsonl is the only per-line-parsed ledger whose reader still throws
on a torn line; journal.ts:114 and evidence.ts:263 both skip unparseable lines. One shared
`readJsonlTolerant` would make CL-TORNLINE unrepresentable. Kind: tooling. Relates to: ISSUE-007.

### IDEA-004 — The fresh-worktree gate leg should end with `git worktree remove` + a list assertion inside the script
Origin: ISSUE-006 (second stale worktree in two gates). Kind: tooling. Relates to: ISSUE-006.

### IDEA-005 — Record refutations with evidence, symmetrically with upholds
Origin: §6.2 of this file; the refuted-findings re-open was only possible by re-running
mutations from scratch. Kind: process. Relates to: ISSUE-005.

### IDEA-006 — A standing "owed items" ledger with owners, distinct from CORRECTIONS.md prose
Origin: ISSUE-001/-002: obligations recorded inside 4,600 lines of append-only prose (C-067's
two-line fix, C-075's spec revision) do not get scheduled; the ones that lived in HANDOFF or
GATES.json obligations did. Kind: process. Value: recorded-debt-never-scheduled is now the
sweep's single most repeated meta-pattern. Cost: a JSON list with task-shaped entries.

### IDEA-007 — Session-end `git status` check belongs in every mutation-running agent's checklist
Origin: my own harness incident (see mutation table note M-INCIDENT): a cp+cmp restore printed
"restored" mid-session yet the mutation was later found live in the tree; only a `git status
--porcelain` sweep caught it. The corrections already teach snapshot/cmp (C-035, C-057); the
missing half is an END-OF-SESSION tree-state audit against `git status`, which catches a
re-applied or missed restore regardless of cause. Kind: process. Cost: one command.

---

## 3. CROSS-LENS POINTERS

- **MACRO:** recorded-debt-never-scheduled is the sweep's dominant meta-pattern (ISSUE-001's
  two-line fix owed since C-067 across ≥3 subsequent tools.ts rounds; ISSUE-002's spec revision
  owed since C-075; C-063's R11-004 deferred and untouched). The build has append-only records
  and no owned work queue for non-task obligations — a process-shape finding (IDEA-006 sketches
  the fix).
- **MACRO:** CORRECTIONS.md is 4,610 lines and is itself the only index of ~30 live obligations;
  its value decays as it grows. Belongs to the build-process-as-designed-thing lens.
- **MACRO:** the "one rule, two derivations" theme (C-042's headline) recurred AFTER the Phase-9
  gate supposedly closed it (C-063 R11-004 metrics-vs-dashboard; ISSUE-008's per-site flooring);
  the gate answered the four known sites, not the generating habit.
- **ENFORCEMENT (main step-2 register, other subsystems):** e2e's gate-hook coverage is
  deny-side only within e2e (my §6.1 M6 result) — the allow-side burden rests entirely on
  gate-wiring/5.4a/9.5c suites; worth an explicit e2e allow-side row when C-092's four are
  written.
- **ENFORCEMENT:** router lane — R11-004 (percentile zeros) and R11-06 (empty-model 2× cap)
  confirmed still live at HEAD (metrics.hpp:137; admission empty-key bucket); both are recorded
  obligations, flagged here so the router section re-verifies rather than trusts.
- **CAPABILITY:** ISSUE-005 (refutations recorded without evidence) implies a missing mechanism:
  a refutation-evidence field in the skeptic-panel output schema, enforced the way findings are.
- **CAPABILITY:** ISSUE-004 implies a missing mechanism: no size measure exists for glob-scoped
  items anywhere in the pipeline (decompose, amend, wave) — the §3.2 budget needs an
  expansion-aware measurement point.

---

## 4. Mutation table

| # | File | Mutation | Expectation | Result | Verdict | Restored (cmp) |
|---|------|----------|-------------|--------|---------|----------------|
| M1 | scripts/conductor_bench.py | `SECTION_MISSING = ""` | suspect P2 survivor | FAILED (1) — `[14.1-report-incomplete-honest]` (cell-id content assertion broke) | check BINDS (accidentally, via content) | yes |
| M2 | scripts/conductor_bench.py | `NOISE_NOTE = ""` | suspect P2 survivor | FAILED (1) — `[14.1-report-never-bare-aggregate]` assertNotIn("" ) direction | check BINDS for presence only | yes |
| M3 | scripts/conductor_bench.py | `PARTIAL_MARKER = ""` | suspect P2 survivor | FAILED (1) | check BINDS for presence only | yes |
| M4 | scripts/conductor_bench.py | NOISE_NOTE reworded to assert the OPPOSITE ("fully separable and statistically significant") | survive if P2 residual real | **Ran 33 tests … OK — SURVIVED** | **DECORATIVE for content → ISSUE-003** | yes |
| M5 | conductor/adapter/tools.ts | gateBeforeToolCall → unconditional throw "BLANKET DENY" | e2e green if refuted-finding-1 true | e2e 34/1 — only catch is a deny-REASON regex | partial | yes |
| M6 | conductor/adapter/tools.ts | same, message contains "registry" (satisfies the regex) | e2e green | **e2e 35/35 GREEN**; full suite 1352/30 (gate-wiring, 5.3, 5.4a, 9.4b, 9.5c, 9.6, composition-root, journal-vocab catch it) | e2e blind on allow-side, repo not — §6.1 | yes |
| M7 | (scratch dir, no source mutation) | torn trailing line appended to a synthetic questions.jsonl, fed to the real `readQuestions` | raw SyntaxError | `SyntaxError: Unterminated string in JSON at position 32 (line 1 column 33)` | reproduces ISSUE-007's premise | n/a |

**M-INCIDENT (harness honesty note, in the C-049/C-051/C-057 tradition):** after M6's restore — a
`cp snap → file && cmp && echo restored` that DID print "restored" — the M6 throw line was later
found LIVE in the tree again (`git status` showed ` M conductor/adapter/tools.ts`; `git diff`
showed exactly the one mutated line; `cmp` against the pristine snapshot differed). No command in
the intervening transcript writes that file; the cause is unidentified. Recovery: re-restored
from the snapshot, verified THREE ways (cmp clean, `git diff` empty, `git status --porcelain`
empty for the file), and re-ran a gate leg (`gates-edit.test.ts` scoped gate: GATE PASS). The
operational lesson is IDEA-007: cp+cmp mid-session is necessary but not sufficient; end the
session with a `git status` sweep. All other mutations in this table were re-verified restored by
the same sweep at session end.

---

## 5. Recurrence table (C-001 … C-092)

Method note: 92 entries were read in full. Many entries share a defect class; the table groups by
correction but the hunting was organised by class. The class names used below:

- **CL-SCAN** (P1) — a check that passes while inspecting less than it appears to (C-044/045/046/047/051/052/057/063/072/074/075/078/079/084a)
- **CL-ORACLE** (P2) — self-referential oracle (C-077, C-080 risk)
- **CL-TWOSPELL** (P3) — one fact spelled in two places (C-032/036/037/040/042/048/054/057/063-R11-004/064/082/085/086)
- **CL-NAMECLAIM** (P4) — name/comment asserts a property the body does not implement (C-033/051/054/055/059/063/066/067/081-#3)
- **CL-HAPPYVAL** (P5) — validator never fed input it must refuse (C-081-#5)
- **CL-GUARDFIRE** (P6) — guard firing mistaken for delivery (C-028, C-091 M-2b)
- **CL-COMPOSE** (P7) — individually-correct rules composing into a hole (C-084/C-085 wedge)
- **CL-BADROW** (P8) — unreachable or self-contradictory acceptance row (C-083, C-084, C-088)
- **CL-TAUTEV** (P9) — evidence that is a tautology (C-089)
- **CL-FALSEREF** (P10) — refutation false negative, sealed (C-032-F1/C-082)
- **CL-UNTESTED** (P11) — untested-but-correct behaviour (C-090)
- **CL-UNWALKED** (P12) — a path nothing ever walked (C-083 debug loop, C-091)
- **CL-ROWNAME** (P13) — a named test that does not prove its row (C-092)
- **CL-CRASHORD** — crash-window write ordering (C-020-F1, C-029-F2/F3, C-031 deferrals, C-067a)
- **CL-TORNLINE** — torn JSONL line handling (C-017, C-029-F6, C-032-E12)
- **CL-PATHESC** — model-supplied id/path escaping a sandbox (C-020-F2, C-024-F3, C-032-E5, C-055)
- **CL-KNOB** — schema-unconstrained numeric knobs (fractional/negative/huge) (C-032-E13, C-038)
- **CL-FIXEDTMP** — fixed shared temp paths across concurrent runs (C-074-F2, C-078)
- **CL-ENVORACLE** — assertion reads the environment where it means the artifact (C-069, C-070)
- **CL-LEAK** — resource leak (C-087 log_handle)
- **CL-STALEWT** — stale git worktrees left behind by gates (C-074-F3)
- **CL-STREAMFIX** — fixtures that only exercise the buffered/default path (C-033, C-046, C-052/053)

| C | Class | Where else I looked | What I found |
|---|-------|---------------------|--------------|
| C-001 | process (progress lives in STATE.json, not plan checkboxes) | n/a — a convention, not a defect class | no recurrence surface |
| C-002, C-003 | preflight installs | n/a | environmental one-offs |
| C-004 | environment claim wrong (shell) | environment claims in HANDOFF/briefing | briefing's env claims re-verified where load-bearing (no `timeout` binary — not retested; python path used as documented and worked) |
| C-005 | vacuous `node --test` verdicts | test-conductor.sh read IN FULL | all four trailer guards + directive guard present; python leg has the C-062 floor; bun leg verdict is exit-code only (bun 0-test file would pass — LOW, noted in cleared areas) |
| C-006 | pinned tsc binary | test-conductor.sh | present, fails loudly if missing |
| C-007, C-008 | commit-order conventions | n/a | no product class |
| C-009 | unanchored .gitignore pattern shadowing tracked dirs | read .gitignore in full | `build/`+`!docs/build/` pair present; `out/`, `staging/`, `router/tests/schemas/` all deliberate; no new shadowing candidates |
| C-010 | trivial assertion forbidden even in smoke | M5 PAT_TRIV | present, universal |
| C-011 | M4-after-commit sequencing; test runners collect worktree copies | n/a (process) | out-of-repo worktrees + quarantine exist for it; not re-tested here |
| C-012 | wire-contract pinning; opencode self-update | conductor/opencode config | auto-update pinning was 12.1's job; not examined (main enforcement lane) |
| C-013, C-026 | M5 word-vs-shape false positives | conductor-gate.sh read in full | shape-matched patterns + per-line exemptions + liveness check all present |
| C-014 | fragment task-tool deny | fragment.test.ts exists | not deep-read (main lane) |
| C-015 | describe-level skip invisible to trailer | test-conductor.sh | directive guard present at any depth; python leg's skip trailer guard present |
| C-016 | Phase-1 security hardening (globMatch DoS, wrapper unwrap, etc.) | gates-git/shell-parse | not re-attacked (R1 Part C owns it); no drift observed in passing |
| C-017 | torn JSONL trailing line (journal) | ALL per-line JSONL readers enumerated | journal.ts:114 and evidence.ts:263 tolerate bad lines; **questions.ts:67 does NOT → ISSUE-007** (handleStatus, handleReport unwrapped) |
| C-018 | trivial-report legality hole; FSM single-source guard | single-source.test.ts exists | present in tree; not mutated (main lane) |
| C-019 | closed-vocab routing choice (lock break → journal) | journal-events widening rule + journal-vocab.test.ts | vocabulary guard live (my M6 reddened `[vocab-live-override-granted]` — the vocab test executes real paths) |
| C-020 | crash-ordering (answer-first), assertSafeId, tmp-name predictability, lock TOCTOU | question/block ordering repo-wide | **the answer-side fix held; the question/block-side ordering class recurred and is only partially fixed → ISSUE-001** |
| C-021, C-040(gitdir), C-052(exclude) | linked-worktree gitdir | gitio common-dir fix per C-052 | recorded fixed; not re-tested (needs worktree fixture; main lane) |
| C-022, C-023 | shell-token bypasses (ANSI-C quoting, wrapper flags) | G7 residual list | documented residuals unchanged; not re-attacked (R1 Part C owns the tokenizer) |
| C-024 | quarantine EXDEV/clobber/escape/replay-live | quarantine.ts posture | skip-nonexistent + no-clobber + pid-guard present per C-039/C-024; not re-crashed (main lane) |
| C-025 | watchdog arms after session.create; hold-subscribe race | fanout.ts | not re-examined (main lane concurrency section) |
| C-026 | see C-013 | | |
| C-027 | pre-commit review findings (inject false terminality; empty pack) | inject.ts | the 1 REFUTED finding is UNNAMED in the record → feeds ISSUE-005 |
| C-028 | pack loaded ≠ delivered (P6); receive-review deferred binding | ROLE_PACKS + buildSystemAppend | debug.md/receive-review delivery pinned by later rows; **the "4 refuted" are unnamed → ISSUE-005**; X-Conductor-Group nit still as recorded (inject.ts:242, raw group id) |
| C-029 | half-write before validation (surface/defer); torn decisions.jsonl mint | mintDecisionId + ISSUE-001 sweep | decisions mint is parse-free (safe); **the question-before-block half-write class persists at 5 sites → ISSUE-001** |
| C-030 | plan-defect scans; duplicate-id graphs; E12 refutation | core/planning.ts at HEAD | scans present; **E12 re-litigated: the entry-count evasion is LIVE → ISSUE-004**; E1 refutation accepted (§6.4) |
| C-031 | roster coverage floor; path-token matching; cumulative claims; fractional k stride | tools.ts plan review | floor present (:1942); **fractional-k stride still un-floored → ISSUE-008**; crash-class deferrals E4 (plan-review-cap half-applied) still only origin-filtered-repaired → ISSUE-001 |
| C-032 | redAdmission; stale-red pairing; testScope containment; E12 torn-questions; E13 fractional knobs; F1 refutation | all re-checked at HEAD | containment at StageContext (:2601); **E12's named-refusal pattern missed 2 of 4 sites → ISSUE-007**; **E13's flooring missed 3 knobs → ISSUE-008**; F1 refutation retired by C-082 (P10's type specimen) |
| C-033 | comment asserts what code doesn't do; streaming path untested by buffered fixtures | router slot capture; comment sweep | slot captured in provider (fixed); comment-citing-tests sweep ran — every cited test file exists (see cleared areas) |
| C-034 | mutation-per-branch discipline; own-tests guard | tools-9.4b rows | rows present; not re-mutated (main lane) |
| C-035 | tool/handler surface disagreement; git-checkout revert trap | tool-binding guard | guard live with shape half (C-047); allowlist still exactly one entry (verified) |
| C-036 | roster rule decided once | readFanout floors vs sets | rule holds at all four stages; interacts with ISSUE-008 (fractional) |
| C-037 | one predicate, two derivations (report); tree identity slug-vs-path | settledForReport; verifyInFlightTreeFor | slug→path bridge exists + tested (`[9.6-tree-identity-slug-to-path]` reddened under my M6 — it executes the real gate) |
| C-038 | C++ integer overflow/validation | config.hpp | fixed per record; not re-attacked (router lane) |
| C-039 | vacuous verify (empty scopes); nonexistent-file quarantine; write-before-validate | requiredScopeNames union | fix present per record; not re-mutated (main lane) |
| C-040 | no-git publish gate; journal 32KiB truncation carrier; batch artifact | legalTools 5-arg | all three call sites pass derived flag (legaltools-callsites guard verified present with comment-blanking) |
| C-041 | plan gap: no runnable binary task | CLI exists | `router/cli.hpp` + cli_test.cpp in tree |
| C-042 | one rule two places (skeptic scope) | `[9.5a-skeptics-cover-non-major]` | row exists in tests (not re-mutated) |
| C-043, C-048, C-054 | publishEnabled: ruling → amendment → guard-documented-into-existence | legaltools-callsites.test.ts READ | guard EXISTS now, blanks comments, requires derived fifth arg; inject.ts:117 passes 5 args — C-048's display residual CLOSED |
| C-044, C-047 | name-level binding audit + shape half | tool-binding.test.ts | floor "at least 13 comparable" live; allowlist 1 entry; the C-047 anti-rot trio present |
| C-045 | binary test file invisible to grep | source-hygiene.test.ts | walk floor >100 files, extension allowlist incl. .py/.sh — present |
| C-046 | assertion satisfiable by two mechanisms (stream gate) | 11.6 row | both-directions fixture per record; not re-run (router lane) |
| C-049 | unasserted exit path; stale-binary mutation trap | — | trap procedure adopted in later corrections; my own M-INCIDENT is this family's TS cousin |
| C-050 | driver stage coverage | defaultStageExecutors | serves all six stages per C-052; `[9.4c-default-table-serves-every-stage]` exists |
| C-051 | test name claims "alone", body never tests it | — | class hunted via C-092's row-vs-title work (known-open); no new instance found by me beyond the recorded four |
| C-053 | hardcoded tree = derived value coincidence | sessionTreeOf threading | itemTree derivation present in handleItemReview |
| C-055 | wildcard scope grants filesystem-wide edit | normalizeUnderTree | returns null out-of-tree; premise-asserting row exists; my M6 confirms gate rows execute the real gate |
| C-056 | vocab breaches; first-block-wins; abandoned-stage fence | journal-vocab live tests; fence | vocab guard executes real paths (M6 evidence); first-block-wins residual STILL open (recorded C-071 residual, unchanged); fence's ledger-append limit still open as disclosed |
| C-057, C-072, C-078 | M5 glob rot (C++, scripts/, python) | conductor-gate.sh read in full | globs + three floors present; default set now covers all task products; `.sh` gap → IDEA-002 |
| C-058 | live-measurement contradicts plan recipe (--parallel ctx split) | 12.1 rows | `12.1-ctx-per-slot-preserved` exists; not re-run (needs model) |
| C-059, C-044-F1, C-081 | inert product / composition root | plugin/index.ts | 22 tools bound, hooks real; composition-root.test.ts exercises them (M6 reddened its rows — they execute the real plugin) |
| C-060 | orchestrator-only file vs task deliverable | conductor_wiring.py split | split held per record |
| C-061 | stale staging copy raced its writer | staging/ | gitignored; rule recorded; no recurrence surface to test |
| C-062 | grepping source is not testing (supervisor); readiness 503 trap | test_conductor_wiring.py | executed supervisor tests present (C-073); wait_for_router_health both-directions row present (C-090); **the 5th disclosed survivor accounting is fuzzy — C-073 says "four of five remain", C-090 closes three; net: all named survivors have rows now** |
| C-063, C-066 | mid-body truncation relayed as success; percentile zeros; empty-model bucket | metrics.hpp/admission.hpp at HEAD | truncation fixed+tested per C-066; **R11-004 percentile-zeros STILL live (metrics.hpp:137 pushes every wait incl. 0) and still disagrees with the dashboard — recorded obligation for the Phase-14 gate, unchanged**; R11-06 empty-model double-cap still as recorded |
| C-064 | ownership amendment must pin the signature | loadConfig | single reader in config-io.ts |
| C-065 | brief named an unprobed discriminator; source guard for inert-at-seam config | gates-git decideGit | `void gitMode` design intact; source guard exists per record |
| C-067 | (a) two unwired blocking sites; (b) comment claims durability | (a) re-checked; (b) continuation.ts header | **(a) STILL UNWIRED → ISSUE-001**; (b) sentence corrected per C-068 |
| C-068 | restart+idle false futility | continuation.ts:671 guard | guard present (`lastSignature === null && idleRePrompts > 0` carry-forward) |
| C-069 | assertion reads environment not artifact | grep REPO_ROOT/__file__ in both python test files | one remaining REPO_ROOT equality (wiring:603) compares two DERIVATIONS of the same tree — portable, not the class; :1505 carries the lesson as a comment |
| C-070, C-071 | discriminator outside the durable record (mtime) | statSync/mtime in adapter | releasedQuestions in-record discriminator present (state.ts:624); remaining mtime uses are the §2.6 freshness rule (by design); C-071's three residuals still open as recorded |
| C-073 | string test kept beside executed test | test_conductor_wiring.py | both present |
| C-074 | gate over unbuilt phase; fixed /tmp; stale worktree | worktree list; /tmp sweep | **stale worktree AGAIN (wt14) → ISSUE-006**; **fixed /tmp persists in verify-acceptance.sh → ISSUE-009**; test-conductor.sh fixed (mktemp+trap verified) |
| C-075 | fabrication refusal; meter-vs-spec path conflict; M5 blind to untracked | 14.2 spec vs meter | **spec still names only bench/ path; tracked in HANDOFF but spec unrevised → ISSUE-002** |
| C-076 | meter satisfied by editing the claim; commit-message rewrite | STATE.json convention | history rewritten per record; no recurrence surface examined |
| C-077 | self-referential oracle (formatters) | test_conductor_bench.py at HEAD | five formatters + NA literal-pinned; **NOISE_NOTE content NOT pinned — opposite-meaning reword survives 33/33 → ISSUE-003** |
| C-079 | M7 counting ids is not coverage | 13.1 M7 state | 22/42 named, four rows proven by nothing — **unchanged from briefing known-open** (verified: zero grep hits for the four row ids) |
| C-080 | doc anchor test derives expectations from code | ops-docs.test.ts | exists; not mutated (main lane) |
| C-081 | five defects incl. liveVerifyTrees (P4) and parser-bypass row (P5) | evidence.ts, composition-root rows | fixes present; queueEntry two-way §2.4 guard present |
| C-082 | testWriter false refutation sealed (P10) | gates-edit.ts:235 + one-role-vocabulary guard | fixed; guard present; refutation retired — the P10 type specimen, applied throughout §6 |
| C-083 | vacuous e2e verify; cap-exit; correction loops; pack-key drift; acceptanceClusters | e2e + planning.ts | fixes present; acceptanceClusters identifier-run rule present (C-086); the e2e single-criterion workaround's reversion NOT verified (no marker found to grep; low value) |
| C-084 | wedge (P7); unvalidated input.client; XDG no seam | continuation + plugin | wedge closed (C-085); transport floor present (limit 5, bounded by test); **XDG_STATE_HOME still read at event time with no injection seam (plugin/index.ts:468) — recorded residual, unchanged** |
| C-085 | UNIVERSAL_META_TOOLS restatement | continuation.ts:658 | now DERIVED by probing the gate under both publish modes — C-086's fix verified present |
| C-086 | subject-token misparse; derived meta tools | planning.ts + continuation.ts | both fixes present; M5's mirrored patterns vs planning.ts:585-601 compared — still in correspondence (deliberate duplication, documented both ends) |
| C-087 | serve.py orphan window; supervisor policy drift; log_handle fd | serve.py + bench.py | fixes present per record; log_handle (:693) still unclosed as recorded-deliberate; the only other bare `open(` (bench.py:812) IS closed in a finally — no recurrence |
| C-088 | failover latch herd; zero/multi-ecosystem coverage | tools.ts | fixes per record; the new-extension residual is briefing known-open |
| C-089 | G5 tautology (P9) | g5-artifact-check + node guard | checker + negative cases + assembled-name trick present; g5-artifact.test.ts runs in suite |
| C-090 | untested-but-correct guards (P11) | wiring tests | all three rows present (health both-directions, grace ceiling tied to READY_TIMEOUT, bool guard) |
| C-091 | unwalked DEBUG loop (P12); doctrine-arrival discriminator (P6) | e2e | scenario present; §3.3 reverted-behavior probe still unexercised — briefing known-open, unchanged |
| C-092 | named rows proving nothing (P13) | the four row ids repo-wide | **still zero tests for all four** — known-open confirmed, unchanged; 17 `// NOT proven here` partials remain in e2e |

---

## 6. Refuted-findings re-open (P10)

### 6.1 The three unanimously-refuted phase-13 findings (artifacts/phase-gates-12-13-15-findings.md:589-593)

**R1 — "The gate hook is exercised only on DENY: a blanket-deny hook passes all five scenarios."**
Re-litigated BY MUTATION at HEAD, not by reading:
- Naive mutation (`gateBeforeToolCall` throws "BLANKET DENY" unconditionally):
  e2e = 34 pass / 1 fail — the sole catch is `[13.1-s1-unregistered-write-denied]`'s
  `/regist/i` **reason-content** assertion, i.e. still a deny-side check.
- Tailored mutation (same blanket deny, message contains "registry"): **e2e 35/35 GREEN.** The
  finding's literal claim is TRUE at HEAD: the five scenarios drive every pipeline stage by
  calling handlers directly, exercise the hook only via three `callGate` probes, and all three
  probes expect DENY. The e2e's own `// NOT proven here` comments concede exactly this ("without
  which this proves only that something was denied, not that the right thing was").
- Full suite under the tailored mutation: **30 failures** across gate-wiring / 5.3 / 5.4a /
  9.4b / 9.5c / 9.6 / composition-root / journal-vocab — allow-side rows exist OUTSIDE e2e.
**Verdict:** the refutation discriminates at REPO scope (a blanket-deny gate cannot survive the
build), so no false negative repo-wide; but the finding as filed (scoped to the five scenarios)
was true, and remains true, and is disclosed only in inline comments. This folds into the C-092
known-open (e2e's hook rows are deny-side and partially proven). All mutations snapshot-restored,
`cmp` clean, gate re-green.

**R2 — "Scenario 5's report refusal is the wrong precondition, and its regex matches every
conductor_report throw."** The subject was REWRITTEN by C-084 (scenario 5 rebuilt around the
blocked-dependency wedge). At HEAD the assertion requires the refusal to name `B1`
(e2e.test.ts:3818-3821, `assert.match(String(w.reportRefusal), /B1/)`) — a content-discriminating
check. **Verdict: moot at HEAD; current form discriminates.**

**R3 — "The override's one-shot grant never reaches a gate, and the plugin has no field to carry
it."** At the gate's HEAD (108ea25) the plugin bound all 22 tools to `handlerNotBound`, so in
PRODUCTION terms the claim was true of the whole tool surface, not just the override — that is
C-044/C-081's recorded state, and the finding was arguably a rediscovery of it. At HEAD the path
is end-to-end and NAMED: plugin/index.ts:645 mints the single `overrideGrants` map, :978/:1389
thread it to the gate, and `[13.1-cr-override-grant-spendable]` (composition-root.test.ts:2030)
drives mint → gate → consume → second-call-denied. My blanket-deny mutation reddened
`[9.5c-override-one-shot]` and `[vocab-live-override-granted]`, confirming the gate-side consume
is live under test. **Verdict: moot at HEAD.**

### 6.2 Cross-cutting P10 defect in the record itself

Refuted findings are recorded as ONE-LINERS with no refutation evidence, in both
`phase-gates-12-13-15-findings.md` (§"Refuted and dropped (3)") and CORRECTIONS.md (C-028 "4
refuted" — unnamed entirely; C-027 "1 refuted … dropped" — unnamed; C-030's E1/E7/E12 named but
with one-clause rationales). Upheld findings carry pages of reasoning; refuted ones carry
nothing a later reviewer can audit. C-082's lesson was that the DAMAGE of a false refutation is
the durable do-not-re-litigate note; a refutation recorded without its evidence is that note in
its most unauditable form. See ISSUE-005.

### 6.3 C-030 E12 re-litigated — and it does NOT survive scrutiny (ISSUE-004)

E12: "the file budget counts fileScope ENTRIES so one broad glob evades it — refuted 2/2."
At HEAD, `core/planning.ts:378` is `item.fileScope.length > ITEM_MAX_FILES` — entries, not
files — and core/planning.ts is PURE (no fs access), so it structurally cannot count expanded
files. An item with `fileScope: ["src/**"]` counts 1 and touches everything; §2.4 explicitly
permits glob fileScope (C-052's publish fix exists BECAUSE globs are legal), so this is not a
degenerate input — it is the input a lazy planner will emit to avoid splitting, and the §3.2
"~5 files" size budget is thereby advisory. The refutation's recorded rationale is one clause
("the same claim as F7, whose panel under-delivered, so the stronger panel governs") — a
procedural argument about WHICH panel governs, not a substantive refutation of the evasion.
**Verdict: the refutation does not discriminate. Filed as ISSUE-004.**

### 6.4 C-030 E1 re-examined — refutation PLAUSIBLE, accepted

"Concurrent handleDecompose invocations both persist — refuted 2/2: the workspace lock plus the
single-orchestrator model." The lock is per-workspace-open and the orchestrator model serializes
tool calls per session; a second decompose implies a second orchestrator session, which the
registry model forbids. No cheap counterexample constructible; accepted as refuted, noted as
untested (no test drives concurrent handler invocation — that is CL-UNTESTED, but constructing
the state requires violating the model's own preconditions).

### 6.5 GATES.json refutation records

Phase gates 12/13/15 (GATES.json:1300-1610): all listed adjudications are UPHELD (20 unanimous,
2 split-tie-upholds); the refuted three are §6.1 above. The split-uphold pair
(`conductor_wiring.py:724` — skeptic 1's refutation argued "every failure it describes is
counterfactual"; the artifact records BOTH skeptic rationales for splits, which is the right
shape and is what §6.2 asks for everywhere). Phase 8 (GATES.json:916): "11 raw -> 4 refuted -> 7
confirmed" — the four are UNNAMED in both GATES.json and C-028; un-re-litigatable (§6.2).
C-032 F1 (testWriter/test-writer): already adjudicated a FALSE NEGATIVE by C-082; nothing to add
except that its two skeptics' string-frequency method would have been auditable — and correctable
— had the refutation evidence been recorded at the time, which is §6.2's point.

---

## 7. Coverage ledger

Scope note: my charter is the corrections recurrence sweep plus the refuted-findings re-open —
not a per-file audit of the whole tree (the main step-2 register owns that). This ledger lists
what THIS sweep touched and at what depth. "Read for class X" means read far enough to settle
that class's recurrence question, not read in full.

| File | What I did | Coverage | Conclusion / ids |
|---|---|---|---|
| docs/build/CORRECTIONS.md | read IN FULL (all 4,610 lines, C-001…C-092) | 100% | the sweep's substrate; every entry has a recurrence-table row |
| docs/reviews/conductor-review/1-briefing.md, 2-enforcement.md | read in full | 100% | governing docs |
| docs/build/GATES.json | grepped all refutation records; read phase-gate adjudication blocks | partial (~20%) | §6.5; ISSUE-005 |
| docs/build/artifacts/phase-gates-12-13-15-findings.md | read refuted/minors/phase-15 sections; upheld skimmed | ~40% | §6.1, ISSUE-005 |
| docs/build/HANDOFF.md | grepped for 14.2/conductor-report | targeted | ISSUE-002 downgrade evidence |
| docs/build/specs/task-14.2.assertions.json | grepped both report paths; read SG-A + 2 rows | targeted | ISSUE-002 |
| scripts/conductor-gate.sh | read IN FULL | 100% | recurrence rows C-013/026/057/072/078; IDEA-002 |
| scripts/test-conductor.sh | read IN FULL | 100% | C-005/015/062/078 rows; ISSUE-010 (bun floor) |
| scripts/verify-acceptance.sh | read row-8 region + all /tmp sites + row plumbing greps | ~30% | ISSUE-009; row-by-row mutation audit NOT done here (main lane Part B) |
| scripts/conductor_bench.py | read constants + run_command; mutated 4× | targeted | ISSUE-003; M1-M4 |
| scripts/test_conductor_bench.py | grepped all assertIn/assertEqual oracle shapes; read the relevant tests | targeted | ISSUE-003 |
| scripts/test_conductor_wiring.py | grepped env-oracle shapes; read :595-610, :1503-1505 | targeted | C-069 row (clear) |
| scripts/serve.py | grepped log_handle | targeted | C-087 row |
| conductor/adapter/tools.ts | read ~15 regions (question sites, gate entry, StageContext, knob reads, stride, status/report readers); mutated 2× | ~10% of 9k+ lines, targeted by class | ISSUE-001, -007, -008; M5/M6 |
| conductor/adapter/continuation.ts | read reconciler, signature builder, UNIVERSAL_META_TOOLS, header | ~15% | ISSUE-001 (origin filter); C-068/070/071/085/086 rows |
| conductor/adapter/questions.ts | read readQuestions + writeRecords | targeted | ISSUE-007 (+ M7 repro) |
| conductor/adapter/evidence.ts | grepped parse + marker prefix | targeted | C-017 row (tolerant), C-037 row |
| conductor/adapter/state.ts | grepped releasedQuestions, parse sites | targeted | C-071 row |
| conductor/adapter/inject.ts | grepped legalTools arity, X-Conductor-Group | targeted | C-048-residual closed; C-028 nit unchanged |
| conductor/plugin/index.ts | grepped override map, XDG, doctrine dir | targeted | §6.1 R3; C-084 residual |
| conductor/core/planning.ts | read size-budget, placeholder shapes, cluster rules | ~25% | ISSUE-004; C-086 row |
| conductor/core/schedule.ts | read readFanout | targeted | ISSUE-008 |
| conductor/core/gates-phase.ts | grepped publishEnabled comment | targeted | C-054 row |
| conductor/core/queue-amend.ts | grepped worktree | targeted | clear |
| conductor/tests/e2e.test.ts | read gate-hook region, scenario-5 refusal, deny rows; ran under 2 mutations | ~15% | §6.1; C-092 row |
| conductor/tests/legaltools-callsites.test.ts | read comment-blanking half | ~30% | C-054 construction verified |
| conductor/tests/tool-binding.test.ts | grepped floor + allowlist | targeted | C-044/047 construction verified |
| conductor/tests/source-hygiene.test.ts | read extension list + floor | ~40% | C-045 construction verified |
| conductor/tests/composition-root.test.ts | grepped override row | targeted | §6.1 R3 |
| router/metrics.hpp, router/admission.hpp | grepped waitMs push + empty-model key | targeted | C-063 obligations confirmed live |
| .gitignore | read in full | 100% | C-009 row |
| NOT EXAMINED (owned by the main step-2 register / router lane): conductor/core/{gates-git,gates-edit,shell-parse,decide,freshness,fsm-*,stops,types,verdict,commit-message,journal-events,tool-bindings}.ts bodies; conductor/adapter/{fanout,router-client,worktrees,gitio,chat-message,config-io,journal,quarantine}.ts bodies; router/*.hpp bodies beyond the two greps; all remaining test files; scripts/{fetch_models,models_catalog,hostinfo,ui,benchmark,bench_presets}.py; the 3,399-line plan (consulted via corrections' citations only — my charter is the corrections map, and I flag rather than judge spec conformance). | | | |

### 7.1 Verification of tree state at session end

`git status --porcelain` at close: only ` ?? docs/plans/…addendum…`, `?? docs/reviews/conductor-review/parts/`
(pre-existing/deliverable) — **no modified source or test files**; every mutation restored
(cmp + git-clean, see M-INCIDENT). Process check ran clean: no llama-router/fake-llama/sleep
strays.

---

## 8. Cleared areas

What I attacked (or verified as constructions) and could NOT break, with the attack named:

1. **SECTION_MISSING / NOISE_NOTE / PARTIAL_MARKER empty-string mutations** (M1-M3) — each
   caught by exactly one test. The presence/absence half of the report-honesty surface binds.
   (The content half does not — ISSUE-003.)
2. **Blanket-deny gate at repo scope** (M6) — 30 failures across seven suites; a gate that
   denies everything cannot survive the build. (Its e2e-local survival is §6.1's finding.)
3. **The C-054 legaltools-callsites guard** — read: blanks comments preserving line numbers,
   requires a DERIVED fifth argument, names sites. The construction described is the
   construction built (the thing C-054 itself failed at).
4. **The C-047 shape guard** — read: ≥13-comparable floor, single-entry allowlist
   (`conductor_queue_amend.ops` with its real parseAmendOps bridge), unclassifiable-arg
   red-by-default. No rot since C-081.
5. **The C-045 source-hygiene guard** — read: >100-file floor, extension allowlist including
   .py/.sh/.bash. Present as described.
6. **The C-086 UNIVERSAL_META_TOOLS derivation** — present, derived by probing legalTools under
   both publish modes (the both-modes-intersection trick defeating the callsites guard honestly).
7. **The C-068 restart guard, C-071 releasedQuestions, C-085 transport floor (limit 5),
   C-050/C-052 six-stage executor table, C-053 itemTree threading, C-055 out-of-tree null
   return** — all verified present in source at the cited sites (not re-mutated; their pinning
   rows exist and two of them reddened incidentally under my M6, proving those rows execute the
   real gate).
8. **C-069's environment-oracle class in the python suites** — hunted by grep; the one REPO_ROOT
   equality remaining compares two derivations of the same live tree (portable); the fixed
   assertion carries the lesson as a comment. No recurrence.
9. **C-087's fd-leak class in the python entry points** — the only other bare `open(` (bench.py
   run_command) is closed in a `finally`. No recurrence beyond the recorded-deliberate
   serve.py:693.
10. **Fixed-/tmp class in test-conductor.sh** — mktemp + EXIT trap verified present (C-078's fix
    held). Recurrence found only in verify-acceptance.sh (ISSUE-009).
11. **Comment-cites-a-test-that-does-not-exist (C-054's disease)** — swept every
    `tests/*.test.ts` citation in core/adapter/plugin comments; all nine cited files exist in
    conductor/tests/. No recurrence.
12. **M5 pattern mirror vs planning.ts** — the knowingly-duplicated shapes (C-057) compared;
    still in correspondence, cross-referenced in comments at both ends.
13. **Scenario-5 report-refusal regex** (refuted finding 2) — current assertion requires the
    refusal to NAME B1; discriminating. Could not reconstruct the "matches every throw" defect.
14. **The torn-line class in journal.ts and evidence.ts** — both readers skip unparseable lines
    (read); only questions.ts throws (ISSUE-007).

Mechanical box-ticking report (briefing §5.1): the 92-row table was NOT busywork — it produced
ISSUE-001/-002/-003/-004/-007/-008/-009 directly. The lowest-yield stretch was C-001…C-016
(process/preflight entries with no product recurrence surface); a future sweep could mark those
"no class" up front and spend the time on C-017+.
