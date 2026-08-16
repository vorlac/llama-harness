# MACRO Review — Part: The Build Process as a Designed Thing, Documentation, and Operator Experience

**Reviewer scope:** the gate regime (M1–M9, phase gates, blind lens fan-out, skeptic ladder) as a
DESIGN; root-cause clustering of all 92 corrections; the assertion-row mechanism; the correction
ledger's navigability; OPERATIONS.md / HONEST-LIMITS.md accuracy today; comment honesty; what an
operator sees when a run goes wrong.

**Date:** 2026-08-16
**Inputs:** `1-briefing.md`, `3-macro.md`, `findings-enforcement.md` (step-2 output), the plan
(`docs/plans/2026-08-07-conductor-harness-plan.md`), `docs/build/*`, `conductor/docs/*`, source.

**Status: COMPLETE.** Deliverables: the required 92-correction root-cause clustering (Section A);
gate-regime design analysis with redesign proposals (B); assertion-row verdict (C); correction-ledger
navigability verdict (D); docs-accuracy audit with five verified falsehoods per document (E);
comment-honesty audit, four live instances verified (F); operator-experience analysis with
time-to-cause table (G); 11 MACRO findings + 1 labelled OPINION; 9 IDEAs; 7 cross-lens pointers;
disposition of step 2's in-scope pointers; coverage ledger.

**Executive summary of this part:** the machinery WORKS at the unit level (step 2 proved the spine
binds) and is misdesigned at exactly three joints, each measured here: (1) subject-selection by
open-ended enumeration, which produced 23% of all corrections and is still live in the audit layer;
(2) composition deferred to the end, which produced the system-defining dead-injection defect; and
(3) a record layer — gate ledgers, correction obligations, operator docs, cross-module comments —
that is exempt from the system's own re-derive-everything thesis, and therefore carries the
falsehoods the code no longer can. The operator documentation's behavioral layer is false at HEAD
in five verified places while its drift guard is green, because the guard binds nouns to code and
behaviors to a plan whose mechanisms are unbuilt.

---

## Section A — Root-cause clustering of C-001…C-092 (required deliverable)

Method: all 4,610 lines of `docs/build/CORRECTIONS.md` were read in full for this section (not
sampled, not summarized from step 2's sweep). Each correction was assigned a primary root-cause
cluster and, where genuinely multi-causal, a secondary. The clusters are ROOT causes — what made the
defect possible — not symptom classes; several map onto P1–P13 but the mapping is not 1:1 because
P1–P13 classify how defects HIDE, while this table classifies why they EXISTED. Cross-checked
against `parts/sweep-corrections.md` §5's recurrence classes (CL-*) for consistency; no correction
was left unassigned.

### A.1 The full assignment table

| Cluster | Members (primary) | Members (secondary) | Count |
|---|---|---|---|
| **A. A check that inspects less than it appears to** (scanner blindness, count-as-proxy, env-as-oracle, self-oracle, name-vs-body) | C-005, C-013, C-015, C-026, C-045, C-051, C-054, C-057, C-069, C-072, C-074, C-075, C-077, C-078, C-079, C-084, C-092 | C-039, C-047, C-052, C-062 | **~21** |
| **B. One fact/rule spelled or derived twice** | C-018, C-035, C-037, C-040, C-042, C-044, C-047, C-050, C-063, C-064, C-082, C-085, C-087 | C-030, C-057, C-075, C-083, C-086 | **~18** |
| **C. Built but never wired / written but never read / composition deferred** | C-028, C-032, C-050, C-059, C-081 | C-037, C-044, C-063, C-087 | **~9** |
| **D. Crash-safety / write-ordering / partial-write** | C-017, C-019, C-020, C-024, C-029, C-067, C-070, C-071 | C-031 (parks), C-032 (E7), C-034, C-039 | **~12** |
| **E. Fixture cannot reach or discriminate the failing path** | C-033, C-034, C-046, C-052, C-053, C-091 | C-030, C-055, C-063, C-070, C-083 | **~11** |
| **F. Trust-boundary input validation (model-authored strings dereferenced)** | C-016, C-022, C-023, C-038, C-055 | C-020, C-024, C-029, C-032 (E5) | **~9** |
| **G. Environment / upstream semantics surprises** | C-002, C-003, C-004, C-006, C-009, C-012, C-021, C-058 | C-052 (merge.ff), C-062 | **~10** |
| **H. Review-machinery defects (the gates' own failures)** | C-031, C-049, C-082 (P10) | C-030, C-038, C-051, C-079, C-084 | **~8** |
| **I. Process / orchestration errors + obligation storage** | C-007, C-011, C-056, C-060, C-061, C-076 | C-057 (checkout trap), C-072, C-074 | **~9** |
| **J. Plan gaps, contradictions, unsatisfiable rows** | C-008, C-010, C-014, C-041 | C-018, C-042, C-083 (row), C-084 (row), C-088 (frozen row) | **~9** |
| **K. Composition wedges — individually-correct rules composing into a hole** | C-084, C-085 | C-032 (E11) | **3** |
| **L. Untested-but-correct / path never walked** | C-087, C-090, C-091 | C-083 (debug loop) | **~4** |
| (Bootstrap/one-off, no class) | C-001, C-025, C-027, C-036, C-043, C-048, C-065, C-066, C-068, C-073, C-080, C-086, C-089 | | 13 |

(C-025 is concurrency-ordering, C-027 is a P4 seed, C-036/C-043/C-048 are rulings, C-066/C-073/C-080
are fix-completions of earlier entries, C-089 is the P9 origin — each is either a completion of a
clustered entry or a singleton.)

### A.2 What the biggest clusters say about the DESIGN

**Cluster A (~21 entries, 23% of the ledger) is the signature failure, and its root cause is a
design choice: every scanner and gate SELECTS its subject by enumeration (glob, file list, count,
grep) with nothing asserting the selection covered the intended set.** The M5 stub scanner alone
accounts for SIX entries on one axis — its file-set — across C-057 (C++ half unscanned for 11
commits after a layout move), C-072 (`scripts/` never in the set), C-073 (still not), C-074
(untracked files invisible), C-075 (14.1's 3,794 lines outside "117 files scanned"), C-078 (the
ledger's own words: "the eighth appearance"). Every fix was a hand-added floor or glob, post-hoc,
and the class is STILL live at HEAD: ISSUE-088 (stripComments blanks ~240 lines of tools.ts from
both source audits) is the same defect in the audit layer the build built to catch this class.
A different structure prevents the M5 sub-family ENTIRELY: invert the selection — scan every
tracked source file MINUS an explicit exemption list, so growth and layout moves are covered by
construction and only exclusion requires a decision. The build instead chose "enumerate what to
scan," which is open-ended in exactly the direction the repo grows.

**Cluster B (~18 entries) is the second pillar, and the build KNEW.** C-042 named it "the Phase 9
theme" after the fourth instance and instructed the milestone gate to hunt for every remaining
twice-derived rule. At least eight more instances landed AFTER that naming (C-044, C-047, C-050,
C-063, C-064, C-075, C-082, C-085/C-086, C-087), including the two that matter most: the
`testWriter`/`test-writer` dead gate arm that survived a unanimous skeptic refutation (C-082, P10),
and the tree-identity slug/path duality recorded at C-037 ruling 5 — whose unmapped main-mode half
is step 2's CRITICAL ISSUE-002 (every sub-session write denied in the default config). **The
meta-lesson is sharper than the object lesson: naming a defect class in a prose ledger does not
arrest it. Only construction does.** The instances that STOPPED recurring are the ones that got a
construction (single-source.test.ts for the FSM vocabularies, the C-044/C-047 binding-table guard,
composition.test:823 for DEFAULT_MAX_READERS); the instances that got a paragraph recurred.

**Cluster C (~9 entries) has the highest severity-per-entry and one design decision as its sole
root: the §8 manifest builds modules bottom-up with per-module tests and defers ALL composition to
the last coding task (13.1).** C-044 diagnosed the cost mid-build, precisely: "leaving every
tool-to-handler correspondence unverified until the last coding task means each of Phases 9-12 can
add another mismatch, and 13.1 discovers them all at once in the task least able to absorb
surprises." The build then paid it anyway: an inert product at HEAD for ~40 tasks (C-044/C-059), a
dead deliverable (C-059's chat.message), a driver that could not drive three stages (C-050), the
composition root "three years late" (C-081's own title), main() executed by nothing (C-087) — and
the terminal instance, found only by step 2: **the entire §6.4 injection layer is dead code at HEAD
(ISSUE-001, CRITICAL), because no manifest task ever registered the hooks.** The pattern C-028
found at phase 8 ("loaded ≠ delivered") was fixed at pack level and then happened to the whole
subsystem. A walking-skeleton structure — composition root first, every later task extending a
live path, with a per-task gate row "every new export has a production caller or names the wiring
task that will call it" — prevents this cluster ENTIRELY, and with it the single worst defect in
the codebase.

**Cluster D (~12 entries) is convention-where-a-primitive-was-needed.** Legality-before-persist and
clear-first orderings were re-derived site by site; ISSUE-100 shows 5 of 7 question-blocking sites
STILL carry the bare ordering at HEAD, and the reconciler's origin filter excludes 4 of them. One
transactional `blockItemWithQuestion` primitive would have made the class unrepresentable.

**Cluster E (~11 entries) is why the build adopted mutation testing, and the adoption was ad hoc.**
Every entry is a fixture that agreed with the code's assumptions (buffered-only stub at C-033,
`requiredScopes:["**"]` at C-039, rooted globs at C-055, connect-failure-only at C-063, empty
tests/ at C-083). The discriminating input was found by mutation every time — C-034 institutes the
habit and it pays through C-091's M-2b — but mutation never became a mechanical gate leg. The
verdict-shaping fact from step 2: the enforcement spine binds under mutation while the AUDIT layer
(M5, acceptance meter, source audits) is where the decorative checks concentrate (§7.4 of
findings-enforcement.md). The class that motivated the habit is contained; the layer the habit
never reached is where step 2's survivors live.

**Clusters G and J bound what the remaining live tasks will do.** Every live measurement in the
ledger overturned an assumption (opencode self-updates mid-build C-012; `--parallel` divides the
context window C-058; preset mode spawns children and changes `/v1/models` semantics C-062; the
G13 model returns empty content under default budgets C-058). Tasks 13.2 and 14.2 are pure live
measurement. The prior from ten corrections is that first contact will find 2–4 more of these, and
step 2 has already located three candidates in advance (ISSUE-105/106/107: Ctrl-C kills the model,
the router launch leg untested, the PATH-less cell env).

### A.3 Which clusters a different structure would have prevented entirely

| Cluster | Preventing structure | Cost then | Cost now |
|---|---|---|---|
| A's M5 sub-family (6 entries) | Inverted selection: scan all tracked source minus exemptions | trivial | trivial (rewrite one script's file-set logic) |
| C (9 entries incl. ISSUE-001) | Composition-root-first manifest; per-task reachability row | plan §8 restructure | for the remaining work: a standing "unreachable exports" audit (~1 day) |
| B (most of 18) | Vocabulary registry + parity harness; typed Role/RunState/ItemState; cross-language derivation from the exported schemas | moderate | incremental per ISSUE-113–125's fix directions |
| D (most of 12) | One transactional block-and-ask primitive | small | ISSUE-100's fix (~1 day) |
| E (containment, not prevention) | Mutation testing as a first-class gate leg over the audit layer | moderate CI cost | moderate; see PROCESS-AND-DOCS-006 |

Clusters F, G, H, J are not preventable by structure alone (they are discovery work), though H is
reducible — see the gate-regime findings below.

---

## Section B — The gate regime as a designed thing

### B.1 What the machinery demonstrably did well

Honesty requires the credit column first, because the redesign proposals below only make sense
against it. From the ledger: the phase-5/6 adversarial gates closed eight real security bypasses
before any of them shipped (C-022/C-023/C-024); the phase-9 milestone gate found C-054 (a guard
that existed only as its own description) and C-055 (whole-filesystem edit grant) "hours apart, in
code written months apart — the gate earned its cost on these two alone" (the ledger's own words);
the phase-11 gate found the truncation-relayed-as-success defect six times independently (C-063);
per-task reviews found real MAJORs in nearly every Phase-9 task (C-029…C-032); and step 2's honesty
audit found **no fabricated evidence anywhere** — every commitSha real, 7–8 of 8 revertAssertions
reproducing, the two live artifacts genuinely never authored. The mechanical spine of the regime
(red re-derivation, the TAP-parsed gate, the acceptance meter's structure) mostly binds under
mutation. The regime's PRODUCT-side yield is real and large.

### B.2 Where the design (not the execution) is weak — measured

1. **Adjudication quality is asymmetric with adjudication records.** Upheld findings carry pages of
   evidence; refuted findings carry one line (verified: the three refuted phase-13 findings in
   `GATES.json`/artifacts). Of the refutations that step 2 re-litigated, **two were wrong**: C-032
   F1 (`testWriter`/`test-writer`, refuted 2/2, sealed with a "do not re-litigate" note, true the
   whole time — C-082) and C-030 E12 (file budget counts glob entries, refuted 2/2 on procedural
   grounds — ISSUE-012). Both false negatives survived because a refutation costs one sentence and
   an uphold costs a fix round — the incentive gradient inside the panel points toward refutation,
   and `skeptic.md`'s "uncertain ⇒ refuted" default (ISSUE-072) makes that gradient doctrine.
2. **The ladder's throughput numbers say the skeptics are mostly a rubber stamp at the phase-gate
   level.** At the 12/13/15 gates: 25 MAJORs adjudicated, 20 upheld with *neither* skeptic able to
   refute, 2 split, 3 refuted (C-079) — a 12% kill rate, of which an unknown fraction is wrong (the
   two audited false refutations came from earlier panels). At C-063 skeptics refuted 10 of 14 —
   the rate swings wildly by panel. A filter whose kill rate varies 12%→71% across runs, whose
   kills are recorded without evidence, and which has one confirmed sealed false negative is not a
   calibrated instrument; it is a second opinion with unrecorded reasoning.
3. **The machinery runs on a transport that keeps eating its own panels.** C-030: 9 skeptics died
   mid-panel; C-031: BOTH lenses died and the round returned `{surviving: []}` — nearly recorded as
   a clean bill; C-038: 7 skeptic sessions died. The "under-delivered panel counts as upheld" rule
   (the 9.5a binding) is the correct fail-closed patch and was itself born from a near-false-green.
   But the design lesson was never generalized: **a review whose delivery failed is
   indistinguishable from a review that found nothing** unless every layer forces a positive
   artifact (this is E8 in step 2's enforcement table — `{"findings":[]}` advances the item — the
   same hole one level down, still open in the product).
4. **Gate records are hand-written prose with no mechanical emission and no schema.** Verified
   directly: `GATES.json` `taskGates` has 44 rows and ends at 11.8 — the eleven tasks committed
   after it (12.1, 12.2, 13.1, 14.1, 15.0–15.2, 5.4a, 12.1-G5, 13.1-composition-root, CR-2) have no
   task-gate row at all (ISSUE-083). The uniform record stops exactly when tasks started failing
   phase gates and the orchestrator's attention went to fix rounds — i.e. the record is weakest
   precisely where scrutiny is most needed. The `phaseGates` records use **at least five different
   shapes** across phases 0–15 (verified: phases 0–9 one shape; 10, 11, 12, 13/15, 14 each
   another). Nothing validates any of them. A regime whose own ledger has no schema, in a codebase
   whose entire thesis is closed vocabularies and machine-checkable records, is a design
   inconsistency, not an oversight.
5. **M7 was a count until it mattered.** The gate that adjudicates row→test coverage was satisfied
   by "a row id appears somewhere" — and recorded PASS for 13.1 (5 test titles claiming 42 rows)
   and 15.1 (a named test file that DID NOT EXIST) (C-079). The build's most-repeated lesson —
   a check that passes while inspecting less than it appears to — reached the gate layer last,
   after nine product-level appearances.
6. **Gates had no stage-0 precondition until two were dispatched over nothing.** C-072 (phase half
   in flight, uncommitted) and C-074 (phase not started at all; "all green, and none of it is
   evidence about phase 14") each burned a full gate before the "read STATE.json first" rule was
   adopted reactively. The regime's design assumed subjects exist; nothing checked.
7. **The gate's own availability is part of the regime and is unmanaged.** No `--test-timeout`
   (a hang-shaped regression wedges the gate forever instead of failing it, ISSUE-032, measured);
   the full parallel gate is nondeterministically red on unmutated HEAD (ISSUE-134), so every
   recorded "GATE PASS" — including every one cited in this ledger — is a sample from a
   distribution. The regime treats the gate as an oracle; step 2 measured it as a noisy sensor.

### B.3 Given P10, what I would change about the gate regime

In order of leverage, each grounded above:

1. **Symmetric evidence obligations** (fixes B.2.1): a refutation must carry the same record an
   uphold does — the discriminating input, the run, the reading under which the finding fails. A
   one-line refutation is an abstention, and an abstention upholds. Migration cost: a paragraph in
   the skeptic doctrine + a schema field; retroactively impossible (the old refutations are
   unauditable — ISSUE-079 stands).
2. **Kill the "do not re-litigate" note as a category** (fixes the sealing half of P10): a
   refutation may close a finding for THIS gate, never for the record. Replace with "refuted at
   <gate>, evidence at <ref>" — an invitation to re-litigate cheaply, not a prohibition.
3. **Identifier-position matching as doctrine** (the P10 generalized lesson, C-082): when a claim
   is "the spec names X", the skeptic must count identifier positions, not prose occurrences.
   One paragraph in `skeptic.md`. (Currently absent — verified: the pack has no such rule.)
4. **Mechanical gate records** (fixes B.2.4/5): `test-conductor.sh` and `conductor-gate.sh` emit
   their own taskGates row (JSON to stdout, appended by the orchestrator or by the script); M7
   becomes a script (row-id → test-title bijection check, IDEA-ROW-1) rather than an adjudication.
   Cost: ~1 day; converts the weakest record surface into machine truth.
5. **Stage-0 preflight as a scripted precondition** (already adopted post-C-074; make it a script,
   not a rule in prose — the prose rule is Cluster-A-shaped).
6. **Manage the gate as a sensor**: `--test-timeout`, `--concurrency` pinning for the enforcement
   suites, and a flake-quarantine protocol (ISSUE-134's fix direction). Until the gate is
   deterministic, no mutation verdict is fully trustworthy — including the ones this review suite
   rests on.

What I would NOT change: the two-stage shape (mechanical stage 1, adversarial stage 2), the blind
fan-out itself, tie-upholds, and the fix-round cap. The record shows these earning their cost.

---

## Section C — The assertion-row mechanism

**Verdict: sound concept, missing lifecycle machinery — not a wrong concept.** The evidence for
"sound": rows repeatedly FORCED discoveries that nothing else would have made. C-042's untestable
row exposed a real design ambiguity; C-062's row `12.1-live-autoload` caught the orchestrator's own
live artifact recording the wrong measurement — the implementer refused to make its own test green
by editing prose; C-092's row-splitting exposed four rows proven by nothing and twelve partial —
"naming a row forces someone to point at the assertion that proves it, and three times here there
was nothing to point at." Where the discipline was followed 1:1 (12.1: 35 rows/35 named tests;
14.1: 33/33; the C++ tasks 11.2–11.7: every row a same-named TEST_CASE), coverage is verifiably
strong.

The failures are all LIFECYCLE failures, and they cluster into three:

1. **No mechanical binding.** 795 rows; `coveredByTest` null on 548 (69%); 118 rows named in no
   test title; 19 linked only by prose comments no tool checks (ISSUE-081/-132/-133). M7 — the gate
   that owns this — was a count (C-079). The concept assumed a binding that was never built.
2. **No disposition/supersession semantics.** A row, once written, has three legal futures the
   schema cannot express: met, superseded-by-a-narrower-spec, or waived-with-reason. So task
   12.1-G5's 21 promoted rows sat "in force" while the fix shipped against its own 6-row spec —
   14 rows unmet, acceptance ticking anyway (ISSUE-075); 11.8's two live rows discharged by nothing
   with no disclosure (ISSUE-076); C-075's mandated spec revision never landed (ISSUE-078). The
   IDEA-ROW-2 `disposition` field is the fix, and it is cheap.
3. **No satisfiability check at authoring time.** Rows written before implementation can be
   unsatisfiable (C-083's round-2-vs-planReviewRounds contradiction, P8; C-084's SG-4 row
   prescribing a shape the product cannot reach) or untestable (C-042: both implementations pass
   every fixture). The build's own convention — the test-writer flags what its suite cannot
   discriminate — worked when it happened (C-042 was found exactly that way), but it is a norm,
   not a step. Making "state the discriminating input for each row" a required field of the spec
   would convert it into a step.

One more structural observation: **the ledger convention changed silently at least three times**
(populated `coveredByTest` through 9.1; title-naming convention after; free-form later), which is
why a field can be "authoritative for the first half of the build and noise for the second"
(ISSUE-081) — the exact frequency-over-position trap the P10 lesson warns about, at the record
layer. A convention change with no marker converts an honest record into a misleading one without
any entry becoming false.

---

## Section D — The correction ledger at 92 entries

**The ledger is the most valuable document in the repository (the briefing is right) and it is not
navigable by the system's own target model.** Measured: 4,610 lines, ~65–70k tokens — more than
twice a 32k model's entire context. Entries since C-030 average ~50 lines and several exceed 100.
There is no index, no class tags, no status field, and no cross-reference table; the classes exist
only as prose phrases ("the eighth appearance", "the C-044…C-047 family") that a reader must
already know to grep for. Step 2's sweep had to re-derive the entire class inventory (CL-*) from
scratch to audit recurrence — that re-derivation cost is paid by every future reader.

**The measurable failure is obligation loss.** Corrections carry obligations ("owed", "queued",
"raised at the gate"), and the file is their only home once `IN_PROGRESS.json` rotates (C-072
documented exactly this loss mode: "an obligation kept in a one-slot file is an obligation you are
going to lose" — and then the CORRECTIONS copy was the survivor). Non-delivery is measured, not
speculative: C-067(a)'s two-line wiring was recorded and never landed across ≥3 subsequent tools.ts
rounds (ISSUE-100); C-075's mandated 14.2 spec revision never landed (ISSUE-078); C-084's
`acceptanceClusters` fix DID land (C-086) — so the mechanism works when the orchestrator happens to
re-read the entry, and silently fails when it does not. That is a storage design problem: append-only
prose is the right shape for the narrative record and the wrong shape for open work.

**Better shape** (migration cost: low, mechanical): keep `CORRECTIONS.md` append-only as the
narrative; add (a) a generated index — id, one-line title, class tags, obligations extracted with
status — regenerated by a script that fails when an entry carries an obligation-verb with no status;
(b) the obligations themselves in a small machine ledger (id, owner-task, status), which is
IDEA-PROC-1 from step 2, endorsed here with the measured loss rate as its justification. What would
change my mind: evidence that obligations recorded only in CORRECTIONS.md were reliably delivered —
the two measured losses against one measured delivery say otherwise.

---

## Section E — Documentation accuracy today (OPERATIONS.md, HONEST-LIMITS.md, ops-docs.test.ts)

Both documents were read in full (576 + 174 lines) and their load-bearing claims checked against
step 2's reproduced findings and, where cheap, against the code directly. The phase-15 fix round
(C-080) genuinely repaired the NOUN layer — filenames, exit codes, flags, envelopes, vocabularies
all check out and are bound by `ops-docs.test.ts` deriving expectations from source. The BEHAVIOR
layer has drifted again, badly, and the anchor test cannot see it.

### E.1 Claims in OPERATIONS.md that are false at HEAD (each verified)

| Doc claim | Reality | Evidence |
|---|---|---|
| §Preamble + §9: "**First rule: no banner, no conductor**… If the banner is not there, stop and fix the load" | Nothing emits a banner. `grep -n banner` over `plugin/index.ts`, `adapter/inject.ts`, `doctrine/core.md` returns zero hits (run for this review). The §6.4 channel that would carry it is unwired (ISSUE-001). Every healthy session has no banner; the first rule diagnoses every working session as broken. | ISSUE-138; my grep |
| §1 failover: "latches the whole session onto the upstream… marks the run's metrics partial… `routerHealthy` short-circuits" | `metricsPartial` is written at `router-client.ts:112` and read by NOTHING (my grep); `routerHealthy` has zero production callers; only conductor's own setup probes fail over — model traffic structurally cannot (ISSUE-039/-040). The paragraph describes the plan, not the code. | my grep; ISSUE-039/-040 |
| §6 doctrine editing: "`adapter/inject.ts` composes them per sub-session role at dispatch time, so an edit takes effect on the next sub-session" | `inject.ts` is dead in production; sub-sessions receive hand-inlined paraphrases in `tools.ts`; only `debug.md`'s content is ever read from the pack map. Editing 8 of the 9 packs changes nothing a sub-session sees. The whole §6 workflow is inert. | ISSUE-001/-003 |
| §7 stop-kind table: `blocked` and `surfaced` "recorded by `conductor_report`" | `handleReport`'s stop literal is typed `{ kind: "done" }` (`tools.ts:7647-7648`, read for this review). Nothing in the codebase writes `blocked` or `surfaced` (ISSUE-065). Two of the six rows in the operator's how-runs-end table name recorders that do not exist. | my read; ISSUE-065 |
| §10: a second conductor session "drops to read-only conductor — … it writes nothing" | Only 2 of ~12 mutating store methods check `readOnly`; nothing else consults the flag; the second session also overwrites the live writer's `alive.json` beacon. | ISSUE-023 |

HONEST-LIMITS.md — the one document "whose only job is honest disclosure":
- The build-discovered section's edit-detection entry claims "a bounded unwrap of `sh -c "…"` so a
  wrapper cannot hide one" — falsified: `nice`/`nohup`/`time`/shell-keyword prefixes hide a git
  write and a write shape (ISSUE-014/-018, reproduced by step 2).
- The expansion entry claims "the same rule covers the alias route" — falsified by
  `git -c core.pager=<cmd> log` (arbitrary command execution with a clean `git` word, ISSUE-015).
- Limit 9 still frames streaming as conditional ("if opencode streams … that dataset is empty")
  when the build MEASURED that opencode 1.18.15 streams — the Task-11.6 pending item was never
  folded (ISSUE-080).
- Limit 3 claims "the model's only fabrication path is `conductor_override`" — step 2 found three
  more: self-answering questions (ISSUE-051), defer forging `kind:"human"` (ISSUE-052), and setup
  `behavioralPaths:[]` killing TDD repo-wide (ISSUE-048).
- Limit 8 repeats the read-only-second-session overstatement (ISSUE-023).

### E.2 Does ops-docs.test.ts bind enough? No — and one row binds a falsehood

The 25 rows bind NOUNS against code (flags vs argparse, exit codes vs `main.cpp`, filenames vs
`state.ts`, the 503 envelope vs `admission.hpp`, stop-kind NAMES vs `STOP_KINDS`) — this is real
and it is why the noun layer has not re-drifted. But every falsehood in the table above is a
BEHAVIORAL claim (who writes what, what arrives where, what fails over), and the anchor mechanism
cannot express those. Worse: `[15.1-banner-entry-is-first]` REQUIRES the no-banner entry to head
troubleshooting and name the beacon — i.e. **the drift guard pins the operator's false first rule
in place**. The structural cause: where the doc describes behavior, the test binds doc-to-PLAN
(§3.8 banner, §4.4 failover, §2.9 recorders), and the plan's mechanisms are exactly what is
unbuilt. Phase 15 exists because the docs drifted from the code once; the mechanism built to stop
that guards against noun drift and formalizes behavioral drift.

---

## Section F — Comment honesty

The question was: do comments describe what the code does, or what someone hoped? The build's own
ledger already answers "hoped" five times over — C-033 ("a comment three functions away asserted
the opposite"), C-054 (a guard described in the confident past tense that did not exist), C-055 (a
comment stating an invariant false for the product's own generated scope), C-063 (`succeeded`
written and read nowhere under a comment claiming the relay honors it), C-067(b) (durability
claimed for an in-memory baseline). Those are fixed. Four LIVE instances were verified at HEAD for
this review (all four confirmed by direct read, not inherited from step 2):

1. `adapter/router-client.ts:29-34` — "`metricsPartial` is the boolean Task 9.5b
   (conductor_report) reads; `probingDisabled` short-circuits `routerHealthy`…". Nothing reads
   `metricsPartial`; `routerHealthy` has no production caller. The comment names a consumer that
   was never built, in the present tense.
2. `core/stops.ts:65-69` — "This is the ONLY definition — the continuation engine (§3.7),
   legalTools (§3.4)… " while `core/gates-phase.ts:113` carries its own
   `TERMINAL_RUN_STATES` copy and its own `isTerminalRun`, deliberately not calling stops'.
3. `tests/fanout.test.ts:447` — "caught by the suite's `--test-timeout`" — the gate passes no
   `--test-timeout`; the referenced safety net does not exist (and its absence is ISSUE-032's
   wedge).
4. `adapter/router-client.ts:42-43` — "a malformed body never reaches a consumer —
   `fetchMetricsSummary` returns null first" — the function returns an unvalidated cast; any JSON
   object becomes a `MetricsSummary` (dropped finding FANOUT-004, §12.2 of the step-2 register).

Pattern across the fixed five and the live four: **every instance is a comment asserting a
CROSS-MODULE fact** (who reads this field, what catches this hang, who else defines this) — exactly
the facts no local test can pin and no reviewer of one file can check. Single-module comments in
this codebase are, in the sample read, unusually honest (many carry `NOT proven here:` inline
confessions, a genuinely good convention from C-092). The structural cause is that cross-module
claims have no binding anywhere; the structural fix is the same "one derivation, exported" rule the
build already applies to code — a comment naming a consumer should be replaced by a test naming it,
or deleted.

---

## Section G — Operator experience: what a human sees when a run goes wrong

The system's failure surface, by explicit design, is a journal line: "A throw from inside a hook
body is caught, journaled once at `error`… and swallowed. **The journal record is the only trace**"
(OPERATIONS.md §8, accurately describing the code). Everything below follows from that choice.

**What the operator sees, per failure class step 2 reproduced:**

| Failure | What a human sees | Time-to-cause |
|---|---|---|
| ISSUE-002 (default-mode write lockout — the first thing a real run hits) | The model flailing; every sub-session write denied; run eventually `noop`s. The gate deny reason names a tree slug ("main") vs a path — but the deny's `snapshot` (the diagnostic fact) is journaled at `debug`, BELOW the default journal level `info`, so at default verbosity the record needed to diagnose it **was never written**. Reproduce with `CONDUCTOR_LOG=gates:debug` or read code. | Hours; requires re-run with elevated verbosity |
| ISSUE-001 (doctrine never delivered) | Nothing. No banner exists to be missing (the doc's first rule fires on healthy sessions instead); sub-sessions behave like undoctrined models, which is indistinguishable from "the model is weak" — the exact ambiguity the whole harness exists to remove. `conductor_status` does not report delivered doctrine. | Unbounded — nothing surfaces it |
| ISSUE-033/-034 (idle engine permanently silent — throw or hanging transport) | A run that never advances and never stops. One `error` `hook.failed` line per idle pass (034) or nothing at all (033). No counter, no anomaly, no stop, no report. The doc's §9 "run disengaged" entry describes the detector WORKING; there is no entry for the detector dead. | Unbounded until a human reads the journal on suspicion |
| ISSUE-065/-066 (unattended run waiting on a human) | `run.stop = done` ("the run completed") for an all-blocked run, or `noop` + archived for blocked-with-dependent — after which the documented `conductor_answer` resume is dead and the answer clears one item while its dependent stays PENDING forever. The operator's most load-bearing distinction — *done vs waiting-on-you vs wedged* — is collapsed onto the two least informative kinds. | The misdiagnosis is silent; the loss is discovered later |
| Router dies mid-run | In-flight sub-sessions env-fail; the run takes `env` job failures. The doc promises failover + partial-metrics marking; neither happens (E.1). `report.md`'s router-metrics section reads "unavailable" — as it does in EVERY report, healthy or not, because the metrics fn is never composed in (ISSUE-038), so the signal carries no information. | Misleading by equivalence with the healthy case |

**What is genuinely good** — and worth preserving through any redesign: `report.md`-first reading
order with a stop-report on every recorded stop; `replay`'s deterministic journal rendering; the
halt file's presence-only, owner-only semantics; deny messages that name the gate and the state;
the beacon (`alive.json`) as an honest liveness primitive; the §9 entries that DO exist are
well-written and code-accurate at the noun level.

**The structural gap:** every artifact above is written at a RECORDED STOP or read on OPERATOR
INITIATIVE. There is no mechanism that converts *sustained abnormality* — N consecutive
`hook.failed` passes, a raised re-prompt latch, a run idle beyond any timer with unfinished items —
into an operator-visible artifact. The four troubleshooting entries cover: plugin didn't load,
stale publish, schema-retry exhaustion, futility stop — all failures the detectors CATCH. None of
the failures step 2 found (which are precisely the ones the detectors miss) has an entry, and none
could be written today, because the honest text would be "read the code."

---

## MACRO findings

### PROCESS-AND-DOCS-001 — Every scanner and gate selects its subject by open-ended enumeration; nothing asserts the selection covered the intended set

- **THE OBSERVATION:** ~21 of 92 corrections (23%) are the "check inspects less than it appears to"
  class (Section A.1); SIX of them are one scanner's file-set alone (M5: C-057, C-072, C-073,
  C-074, C-075, C-078 — the ledger's own "eighth appearance"); the class is live at HEAD in the
  audit layer built to catch it (ISSUE-088: stripComments blanks ~240 lines of tools.ts from both
  source audits; ISSUE-089: deleting tsconfig.json silently disables the M3 leg).
- **THE CONSEQUENCE:** eleven commits of unscanned C++ (C-057); two whole phases' products never
  scanned (C-078); the repo's best drift guard partly blind today (ISSUE-088); an M7 PASS recorded
  over a test file that did not exist (C-079).
- **WHY STRUCTURAL NOT LOCAL:** each instance was fixed with a hand-added floor, and the next
  instance appeared on a different axis (globs → untracked files → scripts/ → string-stripping).
  Fixing instances provably does not fix it — the ledger records eight fixes and step 2 found
  fresh instances.
- **BETTER SHAPE:** inverted selection everywhere a subject set exists — scan all tracked source
  MINUS an explicit exemption list; leg-activation conditionals become leg-missing failures
  (ISSUE-089's fix); every scanner reports scanned-set ∆ against `git ls-files` and fails on
  unexplained difference. Migration: one script rewrite (M5), one conditional inversion
  (test-conductor.sh), a sentinel-canary for stripComments (~15 lines each).
- **PLAN IMPACT:** none — no §2 schema, vocabulary, or G-invariant touched.
- **WHAT WOULD CHANGE MY MIND:** a demonstration that the enumerated sets are closed under repo
  growth — they demonstrably are not (three layout/growth events each blinded one).

### PROCESS-AND-DOCS-002 — Deferring all composition to the last coding task is the root cause of the system-defining defect

- **THE OBSERVATION:** the §8 manifest builds modules bottom-up and defers every wiring decision to
  task 13.1. Cluster C (Section A.2): 9 corrections, including an inert product at HEAD for ~40
  tasks (C-044/C-059), the composition root "three years late" (C-081), and the terminal instance:
  the entire §6.4 injection layer — doctrine, state block, sampling, router headers — is dead code
  because NO task registered the hooks (ISSUE-001, CRITICAL). C-028 found "loaded ≠ delivered" at
  pack level in phase 8; the same shape then happened to the whole subsystem, undetected.
- **THE CONSEQUENCE:** the shipped harness cannot deliver its thesis mechanism to a single session;
  additionally the default-config write lockout (ISSUE-002) sat unreached because no test composes
  the shape production defaults to.
- **WHY STRUCTURAL NOT LOCAL:** the build DIAGNOSED it mid-flight (C-044: "13.1 discovers them all
  at once in the task least able to absorb surprises") and could not act, because the manifest is
  immutable and no task owned the wiring. The defect is in the manifest's shape, not in any
  module.
- **BETTER SHAPE:** for future work (phases 16–19 and any new subsystem): walking-skeleton ordering
  — composition root first, every subsequent task extends a live path; plus a standing per-task
  audit row "every new export has a production caller, or the record names the wiring task"
  (a ~50-line script over `grep -rn` import graphs; C-059 names the missing detector precisely:
  "every adapter module is reachable from plugin/index.ts").
- **PLAN IMPACT:** none retroactively; the addendum plan (phases 16–19) should adopt the ordering
  rule explicitly.
- **WHAT WOULD CHANGE MY MIND:** if ISSUE-001 traced to an upstream limitation rather than
  unassigned wiring — wire-notes confirms all three hooks work at opencode 1.18.15, so it does not.

### PROCESS-AND-DOCS-003 — The correction mechanism records classes and obligations in prose, and prose does not enforce; recorded debt measurably fails to land

- **THE OBSERVATION:** the two-spellings class was NAMED as "the Phase 9 theme" at C-042 with an
  explicit instruction to hunt survivors; ≥8 more instances landed after the naming (Section A.2),
  two of them in the neighborhoods of both CRITICALs. C-054 shows the inverse failure: a record
  CLAIMED a guard existed and none did. Obligation non-delivery is measured: C-067(a) never wired
  across ≥3 rounds (ISSUE-100); C-075's spec revision never landed (ISSUE-078); against one
  measured delivery (C-084→C-086).
- **THE CONSEQUENCE:** ISSUE-002 (CRITICAL) is the unmapped half of a duality RECORDED at C-037
  ruling 5; the P10 false negative was SEALED by a recorded do-not-re-litigate note. The record
  layer actively carried both failures.
- **WHY STRUCTURAL NOT LOCAL:** the instances that stopped recurring are exactly the ones that got
  a construction (single-source.test.ts, the C-044/C-047 binding guard, composition.test:823); the
  ones that got a paragraph recurred. The discriminator is construction-vs-prose, not diligence.
- **BETTER SHAPE:** (a) the C-054 standing rule, mechanized: a correction entry claiming a guard
  must name the test file, and a script asserts it exists; (b) an obligations ledger with owner +
  status, generated-index over CORRECTIONS.md (Section D); (c) each named class gets a
  construction-or-waiver decision at the next gate, recorded in the index.
- **PLAN IMPACT:** none.
- **WHAT WOULD CHANGE MY MIND:** evidence the prose mechanism reliably lands obligations — the
  measured record (2 lost : 1 landed among audited) says otherwise.

### PROCESS-AND-DOCS-004 — The skeptic ladder is evidence-asymmetric and its default biases toward killing findings; P10 was not bad luck

- **THE OBSERVATION:** upholds carry pages; refutations one line (ISSUE-079). Kill rate swings 12%
  (C-079: 3/25) to 71% (C-063: 10/14) across panels. Two audited refutations were wrong (C-082's
  testWriter, ISSUE-012's file budget), both 2/2 unanimous, one sealed with a do-not-re-litigate
  note. `skeptic.md` instructs "uncertain ⇒ refuted". Panels were repeatedly under-delivered by
  transport deaths (C-030: 9 skeptics; C-031: both lenses; C-038: 7 skeptics) and the fail-closed
  rule for that was invented reactively.
- **THE CONSEQUENCE:** a dead gate arm shipped for the build's whole duration under a refutation
  that "protected" it (C-082); an enforcement-advisory hole survived as officially-refuted
  (ISSUE-012).
- **WHY STRUCTURAL NOT LOCAL:** the asymmetry is in the RECORD SCHEMA and the DOCTRINE, not in any
  panel's judgment — a refutation costs a sentence and an uphold costs a fix round, so the
  gradient exists on every panel regardless of who staffs it.
- **BETTER SHAPE:** Section B.3 items 1–3 (symmetric evidence; refutations never seal;
  identifier-position matching in skeptic.md). Migration: doctrine paragraphs + one schema field.
- **PLAN IMPACT:** §7.2's skeptic protocol prose would want an addendum note; no schema/G change.
- **WHAT WOULD CHANGE MY MIND:** an audit of all recorded refutations showing the two known-wrong
  ones are the only ones — impossible today precisely because refutation evidence was never
  recorded, which is the finding.

### PROCESS-AND-DOCS-005 — The gate regime's own records are unschema'd hand-written prose that stops when scrutiny is most needed

- **THE OBSERVATION:** taskGates ends at 11.8 — 44 rows, none for the eleven later committed tasks
  (verified); phaseGates uses ≥5 record shapes (verified, Section B.2.4); M7 was a count until
  C-079; two gates were dispatched over absent subjects (C-072/C-074); the gate binary itself is a
  noisy sensor (no --test-timeout, ISSUE-032; nondeterministic red on HEAD, ISSUE-134); the five
  status surfaces describe four different presents (ISSUE-082).
- **THE CONSEQUENCE:** the late build's evidence lives in free-form STATE.json prose of varying
  shape; every recorded "GATE PASS" is a sample from a distribution; a cold-boot reader inherits
  retracted claims (ISSUE-073/-082).
- **WHY STRUCTURAL NOT LOCAL:** a codebase whose thesis is closed vocabularies and re-derived
  records applies neither to its own build record — that asymmetry is a design decision (records
  were "for humans"), and every honesty finding in step 2's Cluster L lives in it.
- **BETTER SHAPE:** Section B.3 items 4–6: script-emitted taskGates rows; mechanical M7; scripted
  stage-0 preflight; gate determinism work; one "record currency" stamp across the five surfaces.
  Migration: ~days, all tooling, no product change.
- **PLAN IMPACT:** none.
- **WHAT WOULD CHANGE MY MIND:** nothing plausible — the taskGates truncation and shape drift are
  directly verified.

### PROCESS-AND-DOCS-006 — Mutation testing is the build's most productive instrument and was never institutionalized; the layer it never reached is where the decorative checks concentrate

- **THE OBSERVATION:** adopted ad hoc at C-034, the habit found or confirmed defects in ≥15
  corrections (C-034/035/039/046/049/051/052/062/065/068/070/071/077/083/090/091). It was never
  made a gate leg. Step 2's merged mutation table shows the enforcement spine BINDS while the
  audit/gate layer carries the survivors (M5 multi-line catch, acceptance rows 3/10/F, purity scan,
  G5 consistency-only, stripComments — §7.4 of findings-enforcement.md). The mutation harness
  itself produced false survivors twice until compile/apply checks were added by convention
  (C-049/C-051).
- **THE CONSEQUENCE:** the checks that gate the BUILD are provably weaker than the code they gate —
  the exact inversion a mechanical-enforcement thesis cannot afford.
- **WHY STRUCTURAL NOT LOCAL:** the product got mutated because task loops touched it; the audit
  layer got mutated only when a reviewer chose to — no process step owns "mutate the checkers."
- **BETTER SHAPE:** a small standing mutation suite over the AUDIT layer (the ~15 named survivors
  in step 2's §7.4 are the seed list), run at phase gates, with C-049/C-051's
  compile-and-applied assertions built into the runner (IDEA-STRUCT-7 is the durable form).
  Migration: the mutations are already written down; ~2–3 days to mechanize.
- **PLAN IMPACT:** none.
- **WHAT WOULD CHANGE MY MIND:** if re-running step 2's surviving mutations after the fix wave
  shows the audit layer binding — that is the success criterion, not a refutation.

### PROCESS-AND-DOCS-007 — The operator documentation's behavioral layer is false at HEAD, and the anchor-test mechanism structurally cannot see it (one row pins a falsehood)

- **THE OBSERVATION:** Section E.1's table — five OPERATIONS.md behavioral claims false (banner,
  failover, doctrine editing, stop-kind recorders, read-only session), five HONEST-LIMITS
  claims false or stale (wrapper, alias route, limit 9, limit 3, limit 8) — each verified.
  `ops-docs.test.ts` binds nouns to code and behaviors to the PLAN; `[15.1-banner-entry-is-first]`
  requires the doc to keep teaching a signal nothing emits.
- **THE CONSEQUENCE:** an operator following the first rule concludes every healthy session is
  broken; an operator editing doctrine per §6 changes nothing; an operator trusting limit 3 misses
  three fabrication paths; phase 15's raison d'être (docs drifted once) has recurred under a green
  guard.
- **WHY STRUCTURAL NOT LOCAL:** the drift is not authorial sloppiness — C-080's fix was excellent
  at the noun layer and the nouns held. The mechanism binds what it can reach (static shapes) and
  the falsehoods are all cross-module behaviors, the same category Section F finds in comments.
  Fixing the five sentences leaves the mechanism that regrew them.
- **BETTER SHAPE:** behavioral doc rows bound by journal-driven fixtures (drive a stop, assert the
  recorded kind matches the table row; drive a doctrine edit through a stub dispatch, assert
  arrival), plus a rule that a doc behavioral claim names its binding test or carries an explicit
  `(plan §x — not yet built)` marker. The marker alone would have made all five falsehoods honest
  today at near-zero cost.
- **PLAN IMPACT:** none; §9's numbered limits stay normative — the drifted material is the
  build-discovered section and OPERATIONS prose.
- **WHAT WOULD CHANGE MY MIND:** wiring ISSUE-001 makes the banner/doctrine/failover rows true —
  i.e. the doc describes the plan's target state. But a doc that is true only after the two
  CRITICALs are fixed is still false TODAY, and says so nowhere.

### PROCESS-AND-DOCS-008 — Comments asserting cross-module facts are systematically unreliable; single-module comments are honest

- **THE OBSERVATION:** four live instances verified at HEAD (Section F: router-client ×2, stops.ts
  "ONLY definition", fanout.test's nonexistent --test-timeout), five fixed historical instances
  (C-033/054/055/063/067) — every one a claim about ANOTHER module (who reads this, who catches
  this, who else defines this). The `// NOT proven here:` convention (C-092) shows the codebase
  can be honest about local gaps.
- **THE CONSEQUENCE:** C-033's cap that bounded nothing and C-063's truncation-as-success both hid
  under confident cross-module comments; today's four instances will mislead the next maintainer
  identically.
- **WHY STRUCTURAL NOT LOCAL:** no test can pin a comment, and no reviewer of one file can check a
  claim about another; the class survives any number of instance fixes.
- **BETTER SHAPE:** the code rule applied to prose — a comment naming a consumer/guard is replaced
  by the test that proves it or rewritten as intent ("Task 9.5b SHOULD read this — unwired, see
  ISSUE-039"). Cheap; enforceable by convention in review, imperfectly but usefully by grep for
  present-tense consumer claims.
- **PLAN IMPACT:** none.
- **WHAT WOULD CHANGE MY MIND:** a counter-sample of cross-module comments that are true — likely
  many exist; the finding is the unreliability RATE at the load-bearing sites, and 9 of 9
  audited load-bearing instances were or are false.

### PROCESS-AND-DOCS-009 — Failure visibility is designed as "an error-level journal line nobody reads"; nothing converts sustained abnormality into an operator artifact

- **THE OBSERVATION:** Section G's table. Fail-soft swallows hook throws with one journal line
  (doc §8 says so, accurately); the deny snapshot needed to diagnose the default-mode lockout is
  journaled BELOW the default level; the silent-wedge shapes (ISSUE-033/-034) leave no counter, no
  anomaly, no stop; the unattended-run distinction done/waiting/wedged is collapsed onto
  `done`/`noop` (ISSUE-065/-066); router-metrics "unavailable" in every report, healthy or not
  (ISSUE-038).
- **THE CONSEQUENCE:** for the failures step 2 reproduced, time-to-cause ranges from hours to
  unbounded (Section G); a run that lost its work reads as completed.
- **WHY STRUCTURAL NOT LOCAL:** each artifact (report, anomaly, stop) is written at a RECORDED
  stop; every detector-miss therefore produces nothing by construction. Adding entries to
  troubleshooting cannot fix it — the honest entry text would be "read the code."
- **BETTER SHAPE:** one operator-facing health surface: the beacon extended with
  last-error/last-progress/doctrine-digest (IDEA-OBS-1/2 endorsed), a floor that converts N
  consecutive hook.failed or latch-skipped passes into a recorded `env` stop (extends C-085's
  transport floor to the store seam), deny snapshots at the deny's own level, and stop kinds
  `blocked`/`surfaced` actually written (IDEA-STRUCT-5). Migration: each is small; the floor
  pattern already exists in continuation.ts.
- **PLAN IMPACT:** §3.8's beacon contract widens (additive); §2.9 vocabulary unchanged — the
  writers are the gap.
- **WHAT WOULD CHANGE MY MIND:** an operator drill: inject each Section-G failure into a live run
  and measure detection time under the current surfaces. If a competent operator finds each cause
  in <15 min with today's tools, the finding overstates. The step-2 reproductions strongly suggest
  otherwise.

### PROCESS-AND-DOCS-010 — The assertion-row mechanism is a sound concept shipped without its lifecycle (binding, disposition, satisfiability)

- **THE OBSERVATION & CONSEQUENCE:** Section C in full — 69% coveredByTest null, 118 orphan rows,
  14/21 promoted rows unmet-yet-ticked, unsatisfiable rows, three silent convention changes;
  against strong measured performance wherever 1:1 discipline held (12.1, 14.1, C++ tasks).
- **WHY STRUCTURAL NOT LOCAL:** every failure is a missing lifecycle STEP, not a bad row; more
  diligence produces more rows with the same three gaps.
- **BETTER SHAPE:** mechanical M7 in the gate (row-id↔test-title bijection, IDEA-ROW-1);
  `disposition` field (IDEA-ROW-2); a required "discriminating input" field per row at authoring;
  one convention documented and back-applied.
- **PLAN IMPACT:** none — specs/ is build infrastructure.
- **WHAT WOULD CHANGE MY MIND:** if the strong-discipline tasks turned out to be the easy ones —
  but 14.1 (33/33) and the C++ suite are not simpler than 13.1; the difference was convention
  enforcement, not difficulty.

### PROCESS-AND-DOCS-011 — The correction ledger is the system's memory and exceeds its own target model's context by 2×, with its classes and obligations unindexed

- Section D in full. OBSERVATION: 4,610 lines / ~65-70k tokens / 92 entries; no index, tags,
  status; class knowledge re-derived from scratch by step 2 at real cost; obligations measurably
  lost. CONSEQUENCE: ISSUE-078/-100. STRUCTURAL: append-only prose is the right narrative shape
  and the wrong work-tracking shape — no amount of better entries fixes retrieval. BETTER SHAPE:
  generated index + obligations ledger (Section D; endorses IDEA-PROC-1). PLAN IMPACT: none.
  CHANGES MY MIND: measured reliable obligation delivery from prose alone.

### OPINION-001 — The six-kind stop vocabulary is right; resist collapsing it

Labelled an opinion per the charter (no measurement separates it from alternatives). Step 2's
pointer asked whether `blocked`/`surfaced` should remain separate kinds given nothing writes them.
My reading: the vocabulary encodes the operator's three most load-bearing distinctions
(done / waiting-on-you / broken) and the failure is entirely on the writer side (ISSUE-065's
delegation ring). Removing the kinds would enshrine the current collapse. The closer-computes-kind
design (IDEA-STRUCT-5) is the fix that preserves the design's intent.

---

## IDEA entries

### IDEA-PD-1 — `conductor_status` reports delivered doctrine per role
Origin: Section G — ISSUE-001 was invisible for the whole build because nothing surfaces what a
sub-session actually received. Kind: ergonomics/observability. Value: makes the doctrine channel's
health visible to operator and orchestrator alike; would have exposed ISSUE-001 on day one. Cost:
small (status handler reads the same map the dispatch would). Relates to: ISSUE-001, IDEA-OBS-1.

### IDEA-PD-2 — Journal gate-deny snapshots at the deny record's own level, not `debug`
Origin: Section G's time-to-cause row for ISSUE-002 — the diagnostic fact is dropped at default
verbosity exactly when it is needed. Kind: observability. Value: post-hoc diagnosis of denials
without re-running at elevated verbosity. Cost: trivial (level change on one record; size is small —
the snapshot is a struct, not a diff). Relates to: ISSUE-002, PROCESS-AND-DOCS-009.

### IDEA-PD-3 — Behavioral doc-rows via journal-driven fixtures
Origin: Section E.2. Kind: test-maintainability/docs. Value: extends the successful noun-anchor
pattern to the layer that actually drifted; e.g. drive each stop kind end-to-end and assert the doc
table's "Who records it" column against the journal. Cost: moderate (a fixture per behavioral
claim; ~10 claims). Relates to: PROCESS-AND-DOCS-007.

### IDEA-PD-4 — `(plan §x — not yet built)` markers as a doc convention
Origin: Section E — five falsehoods would be honest sentences today with one marker each. Kind:
docs. Value: keeps plan-target prose while making current-state truth explicit; trivially
greppable for a "what is documented but unbuilt" report. Cost: near zero. Relates to:
PROCESS-AND-DOCS-007, ISSUE-138.

### IDEA-PD-5 — Script-emitted taskGates rows
Origin: Section B.2.4 — the ledger ends at 11.8 because a human stopped writing it. Kind: tooling.
Value: the gate record becomes machine truth with uniform shape; ISSUE-083 becomes structurally
impossible. Cost: ~1 day. Relates to: PROCESS-AND-DOCS-005.

### IDEA-PD-6 — Generated CORRECTIONS index with class tags and obligation status
Origin: Section D. Kind: tooling/docs. Value: navigability for humans and 32k models; obligation
loss becomes visible; step-2-style class recurrence audits become a grep. Cost: ~1 day for the
generator + one back-fill pass. Relates to: PROCESS-AND-DOCS-003/-011, IDEA-PROC-1.

### IDEA-PD-7 — Troubleshooting entries for the detector-dead shapes
Origin: Section G — §9 covers only failures the detectors catch. Once ISSUE-033/-034/-065/-066
fixes land, add: "the run never advances and never stops", "every write is denied", "report says
done but items are blocked". Kind: docs. Value: the three failures an unattended operator will
actually meet. Cost: small, AFTER the fixes (today the honest text cannot be written). Relates to:
PROCESS-AND-DOCS-009.

### IDEA-PD-8 — Skeptic doctrine gains the identifier-position rule
Origin: Section B.3.3; C-082's generalized lesson exists only in the correction ledger, where no
future skeptic session will see it. Kind: docs/doctrine. Value: the P10 root cause becomes a
briefed rule at the point of use. Cost: one paragraph in `skeptic.md` + an anchor row. Relates to:
PROCESS-AND-DOCS-004.

### IDEA-PD-9 — A "review delivery receipt" at every layer
Origin: Section B.2.3 — dead lenses, dead skeptics, and `{"findings":[]}` are indistinguishable
from diligent empty results. Kind: process/structural. Value: extends the 9.5a
under-delivery-counts-as-uphold rule into a uniform principle: every review layer emits a positive
proof-of-work artifact (cited diff range, per the step-2 IDEA-STRUCT-4) or is counted absent.
Cost: doctrine + one schema field. Relates to: ISSUE-072, PROCESS-AND-DOCS-004.

---

## CROSS-LENS POINTERS (for the capability review)

1. **The operator health surface is the highest-leverage missing mechanism in my scope**
   (PROCESS-AND-DOCS-009): beacon extended with last-progress/last-error/doctrine-digest + a floor
   converting sustained hook-failure or latch-silence into a recorded stop. Grounds: ISSUE-033/
   -034/-065/-066 reproduced; Section G's time-to-cause table. Subsumes and extends step 2's
   IDEA-OBS-1/2.
2. **A standing audit-layer mutation suite** (PROCESS-AND-DOCS-006): the ~15 surviving mutations in
   findings-enforcement §7.4 are a ready-made seed corpus; mechanize with compile-and-applied
   assertions (C-049/C-051). This is the capability that keeps every other checker honest.
3. **Reachability/walking-skeleton gating for future growth** (PROCESS-AND-DOCS-002): "every new
   export has a production caller or names its wiring task" as a per-task mechanical row —
   the missing mechanism that would have prevented ISSUE-001 and the whole Cluster C.
4. **Obligations ledger with owners + generated index** (PROCESS-AND-DOCS-003/-011): the
   recorded-debt-never-scheduled meta-pattern is the process's dominant leak; endorse IDEA-PROC-1
   with the measured loss rate (2 lost : 1 landed) as justification.
5. **Behavioral doc binding** (PROCESS-AND-DOCS-007): the doc-drift capability gap is specifically
   BEHAVIORAL claims; noun anchoring is solved. Any doc-guard proposal that adds more noun rows is
   solving the solved half.
6. **For doctrine efficacy analysis** (the capability review's §R3 scope): note that per Section
   E.1, doctrine has NEVER reached a sub-session in any run this system has performed — every
   observation about "will a 32k model follow these packs" is currently counterfactual, and the
   packs' only tested consumers are keyword anchors (ISSUE-135: a pack asserting the OPPOSITE of
   its doctrine stays green).
7. **Re-run pointer to the enforcement lens:** `ops-docs.test.ts` was bound at 25 rows by C-080 but
   was NOT in step 2's mutation targets; after any doc-mechanism change, mutate its section-parsing
   helpers (`sectionsOf`/`entriesOf`) — a parser returning one giant section would satisfy many
   `assertSectionMatches` rows vacuously. (Not verified — flagged as a candidate, ~30 min.)

---

## Disposition of step 2's pointers addressed to the macro review (my scope's subset)

| Pointer | Disposition |
|---|---|
| Stop vocabulary over-specified for the recorders that exist | OPINION-001: keep the vocabulary, build the closer (IDEA-STRUCT-5). The kinds encode the operator's most load-bearing distinctions. |
| The build maintains five status surfaces with no freshness contract; GATES.json shape-inconsistent; assertion-ledger convention changed 3× | Confirmed and extended (PROCESS-AND-DOCS-005/-010): taskGates truncation at 11.8 verified; ≥5 phase-record shapes verified; treated as one design failure — the regime exempts its own records from its own thesis. |
| The gate's own availability (no timeout; nondeterministic red) is a regime design point | Folded into PROCESS-AND-DOCS-005 (B.3.6): the gate must be managed as a sensor; every historical PASS is a distribution sample. |
| "Detection by enumeration" recurring shape | The scanner/file-set face is PROCESS-AND-DOCS-001; the gate-security face (GIT_WRAPPERS etc.) is the architecture part's scope — not treated here. |
| tools.ts size / continuation.ts three engines / inject.ts dead subsystem / layering | Out of this part's scope — owned by the architecture/navigability macro part. Noted: inject.ts's deadness is load-bearing for my E.1/G findings. |
| scripts/ mixes two products; conductor/tools outside hygiene guards; M5 covers no *.sh | Partially mine: the M5 shell-script gap is a live Cluster-A instance (four enforcement scripts outside every scanner — step 2's IDEA-GATE-2); folded into PROCESS-AND-DOCS-001's better-shape (inverted selection covers .sh by construction). |
| UPSTREAM_CONTRACT doubles as findings ledger; CMake project still named `myprogram` | Record-hygiene face acknowledged under PROCESS-AND-DOCS-005's umbrella; the file-role question is the architecture part's. |
| types.ts interface + hand-written schema duality | Architecture part's scope. |

---

## Coverage ledger

| Subject | Treatment | Outcome |
|---|---|---|
| `docs/build/CORRECTIONS.md` (4,610 ln, C-001…C-092) | **read in full**, every entry clustered | Section A; findings 001/002/003/006/011 |
| `docs/reviews/conductor-review/findings-enforcement.md` (2,304 ln) | read in full | evidence base throughout |
| `docs/reviews/conductor-review/1-briefing.md`, `3-macro.md` | read in full | charter compliance |
| `docs/build/GATES.json` | structure enumerated mechanically (taskGates keys, phaseGates shapes) | B.2.4; finding 005 |
| `conductor/docs/OPERATIONS.md` (576 ln) | read in full; five behavioral claims cross-checked | Section E; finding 007 |
| `conductor/docs/HONEST-LIMITS.md` (174 ln) | read in full; five claims cross-checked | Section E; finding 007 |
| `conductor/tests/ops-docs.test.ts` (1,495 ln) | all 25 test titles read; binding mechanism assessed; bodies sampled | E.2 |
| Code spot-verifications (this review's own greps/reads) | banner emitters (none exist); `metricsPartial` readers (none); `run.stop` writers (report's literal `"done"`; continuation; override); `stops.ts:65` vs `gates-phase.ts:113` dual terminality; `router-client.ts:29-43` comments; `fanout.test.ts:447` | E.1, F, G |
| `parts/sweep-corrections.md` class inventory | consulted as cross-check for A.1 | consistent; no correction unassigned |
| NOT examined | plan full re-read (cited ranges only — step 2's subsystem lenses own clause-level conformance); `RUNNER-DISCOVERY.md`; doctrine pack contents beyond grep; no mutations re-RUN by me (three step-2 claims re-verified by direct read/grep instead: metricsPartial, stop literal, banner) | disclosed |

**Honest limits of this part:** (1) I did not re-run any mutation; where a finding rests on a
step-2 reproduction I cite the ISSUE and, for the three most load-bearing, re-verified the
underlying fact by direct read. (2) The clustering's primary/secondary assignments involve
judgment; the raw table is included so a reader can re-cut it. (3) Comment-honesty sampling was
targeted at load-bearing cross-module claims, not a random sample — the 9/9 false rate in F is a
rate among AUDITED load-bearing instances, not among all comments.

**Ceremony report (per briefing §5.1):** none of the mandated analyses was busywork on this
codebase. The clustering (A) changed my conclusions — I expected the two-spellings class to
dominate and found the check-inspects-less class larger and still live; the docs pass (E) found
the anchor-test-pins-a-falsehood result I did not anticipate.
