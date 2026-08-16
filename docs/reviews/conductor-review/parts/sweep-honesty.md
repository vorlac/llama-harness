# Sweep — Build-Record Honesty and Artifact Audit (P9)

**Scope:** Cross-check `docs/build/STATE.json`, `GATES.json`, `CORRECTIONS.md` against the actual
tree. Verify recorded commitShas exist and contain what is claimed. Verify every COMMITTED/PASS.
Check honest disclosure of deferred/live-manual items. Hunt fabricated evidence (P9). Audit every
artifact under `docs/build/artifacts/` for the two-identical-arms shape (C-089). Re-run
`scripts/verify-acceptance.sh` and verify the 17/21 claim.

**Date:** 2026-08-16 · **Reviewer:** sweep-honesty subagent (part of the step-2 enforcement review)
**HEAD at review:** ce05498, tree clean apart from two owner-owned untracked paths.

## Headline verdict

**No fabricated evidence was found.** Every recorded commit sha exists and carries the recorded
message; the acceptance claim reproduces exactly (17 PASS / 4 FAIL, same four rows); the two
sampled `revertAssertion`s reproduce their recorded reds precisely (8.1 even to the "4 tests
red" count); the two unbuilt live artifacts have never existed anywhere in git history — nobody
hand-authored them; CORRECTIONS.md runs C-001…C-092 contiguously; the retraction of the one
known fabricated-in-effect artifact (C-089) is thorough and its replacement guard genuinely
binds (proved by three mutations). The build's honesty failures are of a different, quieter
kind: **the record surfaces have stopped being maintained at different moments**, so STATE.json
still narrates the discredited G5 tautology as real evidence, GATES.json's task-gate ledger
silently ends at 11.8, the assertion ledgers' `coveredByTest` field is dead on 69% of rows, and
HANDOFF/NOW/JOURNAL describe three different past presents. A cold-boot reader who trusts the
prescribed boot order inherits several claims the build itself has since retracted.

---

## 1. ISSUE register

### SWEEP-HONESTY-001 — STATE.json still records the discredited G5 tautology as real evidence

**Severity:** MAJOR (record honesty). **Pattern:** P9 sealed into the ledger.
**Where:** `docs/build/STATE.json` — task row `12.1`, deviations list (line ~1809, the "G5
EQUIVALENCE STEP CLOSED" entry) and the whole `12.1-G5` row (lines 2124–2158).

C-089 (CORRECTIONS.md:4376) established that the 2026-08-14 G5 record was "a tautology on two
counts": its arms differed only in `CONDUCTOR_OPENAI_BASE_URL`, which a repo-wide grep finds in
no source file (re-verified now: zero hits in `conductor/`, `scripts/`, `router/`), and the e2e
it ran had no router touchpoint at all. The artifact was regenerated on 2026-08-15 (commit
a48c346 "conductor-build: G5 equivalence, a real two-arm run"). STATE.json was last touched
2026-08-15 04:07 and still:

- describes the old record as "a real two-arm run: both baseURLs derived from
  scripts/conductor_wiring.py … the committed e2e run green under EACH baseURL with identical
  verdict lines" (12.1 row);
- carries a `12.1-G5` row whose tap block records armA/armB as the two baseURL commands and
  cites the superseded 194-line artifact (the shipped one is 213 lines).

STATE.json is "per-task machine truth" per HANDOFF.md's own boot instruction. A reader trusting
it inherits a narrative CORRECTIONS.md has already retracted; nothing in either row says
"superseded". (Note the old record's *traffic half* — same request body through 8088 and 8080 —
may well have been genuinely run; C-089 does not dispute it. What is discredited is the
pipeline-half equivalence claim, which is exactly what these rows still assert.)

*Refutation attempted:* `meta.convention.commitSha` says rows are backfilled "by the next
STATE.json touch", so staleness is conventional. Failed — that convention covers the sha field,
not a prose account of evidence later found tautological. The rows' claims are false now and
unmarked. *Fix direction:* amend both rows to name C-089 and the superseding commit, or add a
`supersededBy` field.

### SWEEP-HONESTY-002 — The anti-tautology guard proves consistency, not provenance; an internally consistent fabricated G5 artifact passes the full gate, and this residual is disclosed nowhere

**Severity:** MEDIUM (undocumented residual). **Pattern:** P9-adjacent, new shape: *a guard
against last year's forgery*.
**Where:** `conductor/tools/g5-artifact-check.ts` (all five rules operate on the markdown
text); `conductor/docs/HONEST-LIMITS.md` (no entry); the artifact's own line 9–11 ("Nothing
here is typed by hand" — a claim no check can verify).

Mutations G5-M1/M2/M3 (mutation table) confirm the guard binds against the recorded forgery
shape and its neighbours: flattened arms, a WITHOUT-arm summary, and a provenance mismatch each
go red. But mutation G5-M4 — rewriting `ROUTER-SERVED-SUMMARY` **and** `REPORT-METRICS-WITH` to
the same invented numbers (`totalRequests` 6→99) — keeps the scoped gate GREEN. The checker
compares the artifact's lines to each other, never to an event, so an internally consistent
hand-fabrication passes every leg. That is an inherent limit of statically checking a text
artifact, and arguably an acceptable one — but the build's stated worst failure is fabricated
evidence and its stated doctrine is G7 ("detection over prevention, honestly documented").
HONEST-LIMITS.md's limit 3 covers runtime ledger fabrication only; the build-discovered section
says nothing about build artifacts. *Fix direction:* one sentence in HONEST-LIMITS.md; optionally
have the driver emit facts the checker can independently re-derive cheaply (e.g. cross-parse the
`CONDUCTOR_E2E_FACTS` files) to narrow the forgery room.

### SWEEP-HONESTY-003 — filesTouched/commitSha imprecision across nine STATE.json rows: the named commit does not contain what the row claims

**Severity:** MINOR overall; the 11.8 instance borders MAJOR. **Pattern:** P3-adjacent (one
fact — "what this task shipped" — spelled as a sha and as a file list that disagree).
All verified against git:

- **11.8:** commitSha 2e3dd96 contains ONLY `docs/build/artifacts/11.8-live-smoke.md`; the four
  claimed CLI files live in 6b732a3 ("conductor: 11.8 router CLI (C-041)") under pre-hoist
  `src/` paths. The row's sha covers one fifth of its claim; disclosure is one parenthetical
  inside the tap string.
- **15.1:** claimed `conductor/tests/ops-docs.test.ts` is not in 4afdf2b; it arrived in a6ad3cd
  (phase-15 fix round 1). The row silently folds a fix-round deliverable into the original task.
- **2.2:** `scripts/test-conductor.sh` (bun leg) was committed in 1319713, not the recorded
  06818b3.
- **9.3 / 9.4b / 9.4c / 12.1 / 15.0:** each claims its own `task-N.assertions.json`, which in
  fact rides a neighbour commit (spec authored before the task; e.g. task-9.3's is in 75a2531,
  task-12.1's and task-15.0's in 013ebc9).
- **10.1:** filesTouched entries carry prose annotations, and two files ("stage 2 fix round 2
  only") are in a later commit the row never names by sha. (The referenced
  `phaseGates.10.stage2FixRound2.scopeException` DOES exist in GATES.json and is an honest,
  explicit approval record — verified.)

None of this is fabrication — every claimed file exists in history with the claimed content —
but "commitSha + filesTouched" cannot be mechanically replayed for 9 of 55 rows, which is what
such a record exists for. *Fix direction:* allow commitSha to be a list / add fixRoundShas; add
a checker asserting filesTouched ⊆ the named commits' union.

### SWEEP-HONESTY-004 — HONEST-LIMITS.md never received the Task-11.6 pending item; limit 9 still frames as conditional what the build measured as fact

**Severity:** MEDIUM (deferred-item disclosure). **Pattern:** P1 applied to a docs fold.
**Where:** `docs/build/honest-limits-pending.md:70-91` ("Router schema observation is
request-side only on real fan-out traffic") vs `conductor/docs/HONEST-LIMITS.md` (no
corresponding entry; limit 9 reads "if opencode streams (Task 0.2 determines this), that
dataset is empty").

The pending file's own header: "Task 15.1 must copy §9 verbatim AND append these
build-discovered items." Five of six pending items were folded into "Limits the build itself
discovered"; the 11.6 item was not, and limit 9's conditional was left standing even though
wire-notes recorded that opencode 1.18.15 DOES stream — so the router's response-side schema
dataset IS empty on real traffic and every fan-out request records `schemaMissing`. An operator
reading the shipped doc gets a possibility where the build holds a certainty. The phase-15
MAJOR ("HONEST-LIMITS.md omits the entire build-discovered part") was fixed for five of six
items and the fix's completeness never re-checked — consistent with "stage 2 not re-run" in the
known-open list, but this is a concrete item that re-run must catch. *Fix direction:* append the
11.6 entry; reword limit 9 to the measured fact.

### SWEEP-HONESTY-005 — The three refuted phase-13 findings are recorded without the skeptic reasoning the record claims to hold

**Severity:** MINOR–MEDIUM (meta-record). **Pattern:** P10-enabling.
**Where:** `docs/build/artifacts/phase-gates-12-13-15-findings.md:589-593` vs GATES.json
`phaseGates.{12,13,15}.fullFindings`, which describes that artifact as holding "every failure
scenario, the exact mutation that proves it, and both skeptics' reasoning".

Every confirmed MAJOR does carry both skeptics' texts. The three unanimously-refuted findings
(gate-hook-exercised-only-on-DENY; scenario-5 report-refusal regex; override one-shot grant)
carry one line each: title, location, "both skeptics refuted it". C-082 proved this build's
skeptic panel can unanimously refute a true finding; the briefing's standing P10 instruction is
to re-open refuted findings — which requires the refutation evidence the record says it kept
and did not. *Fix direction:* append the skeptic texts (they existed at run time) or correct
the fullFindings description.

### SWEEP-HONESTY-006 — coveredByTest is dead ledger weight: unmaintained on 69% of rows, yet read as evidence by an adjudicator

**Severity:** MEDIUM (record trustworthiness). **Pattern:** P1 applied to the record layer.
**Where:** `docs/build/specs/*.assertions.json`; consumed as evidence at
`phase-gates-12-13-15-findings.md:613` ("every one of its 25 rows carries `coveredByTest: None`
— the spec itself records that nothing tests them").

Measured: 26 ledgers fully populated (0.1–9.1, plus 10.1 and 11.1); 34 ledgers with the field
entirely null (9.2–9.6, 11.2–11.8, 12.x–15.x, all five fix-*.assertions.json); 548 of 795 rows
carry nothing. Yet `ops-docs.test.ts` names all 25 15.1 row ids, 14.1's 33 ids all appear
literally in `scripts/test_conductor_bench.py` (re-derived here: 33/33 present, 33 test
methods), and CR-1's tap claims all 21 rows carry named titles. For task-15.1 the adjudicator's
inference from nullness was true at the time and independently corroborated — but the same
inference applied to task-14.1 or task-13.1-composition-root would be false. A field
authoritative for the first half of the build and noise for the second invites exactly the
frequency-over-position mistake C-082 documents. After a6ad3cd added ops-docs.test.ts, nobody
updated the 25 rows it covers — the ledger still says nothing tests them. (The phase-13
adjudicator flagged the 13.1 instance as a note; no correction tracks the general drift.)
*Fix direction:* maintain it mechanically (grep row ids in test titles, rewrite the field), or
delete the field everywhere and let M7's row-naming checks be the single source.

### SWEEP-HONESTY-007 — The four record surfaces describe four different presents; only CORRECTIONS.md is current

**Severity:** MEDIUM (cold-boot honesty). **Pattern:** new — *record surfaces with divergent
freshness, no staleness markers*.
**Where/what (all verified):**

- `JOURNAL.jsonl` — last event 2026-08-14T17:40 ("closeout … 16 PASS / 5 FAIL"). Everything
  after — CR-1, CR-2, C-085…C-092, the G5 regeneration — has no journal event. Its final entry
  also switches key vocabulary (`at/task/note` vs the file's `ts/taskId/detail`).
- `NOW.md` — frozen at 2026-08-14 06:34 ("five agents in flight", "43 of 55 rows committed"),
  while its header promises it "is rewritten whenever the work changes, so it is never a
  summary written after the fact".
- `HANDOFF.md` — frozen at 2026-08-15 02:55, the CR-1 moment: instructs "Do CR-2 next" (done
  at 04:07 the same night, commit 46bc73f), reports gate 1326/1326 (now 1382/1382).
- `STATE.json` — 2026-08-15 04:07; carries ISSUE-001's stale G5 narrative.
- `CORRECTIONS.md` — current through C-092 (2026-08-15 17:21).

Each individually is defensible snapshotting; together they mean the prescribed cold boot
(HANDOFF → STATE → NOW) delivers instructions to redo finished work and evidence claims already
retracted, with the only current surface (CORRECTIONS.md) last in the reading order. *Fix
direction:* a single "record currency" stamp (which surface was updated when, which is
authoritative today) or one refresh pass over HANDOFF/NOW/STATE.

### SWEEP-HONESTY-008 — The M1–M9 task-gate ledger silently ends at 11.8: eleven COMMITTED rows have no task-gate record

**Severity:** MEDIUM (record completeness). **Pattern:** P1 applied to the gate ledger — it
appears to be "the" gate record and inspects less of the build than it appears to.
**Where:** `docs/build/GATES.json` `taskGates` — 44 keys, ending at 11.8 plus
`acceptance-round-1`.

Tasks 12.1, 12.2, 13.1, 14.1, 15.0, 15.1, 15.2, 5.4a, 12.1-G5, 13.1-composition-root and CR-2
are COMMITTED with no `taskGates` row. `15.0` appears ZERO times anywhere in GATES.json and
once, incidentally, in CORRECTIONS.md — its M-gate adjudication is recorded nowhere. The
convention CORRECTIONS.md itself records (line ~124: M4's "result is recorded in GATES.json on
the next docs/build touch") was abandoned mid-build. The late tasks' evidence lives instead in
free-form prose inside STATE.json tap fields, of varying shape (compare 14.1's forensic detail
to 15.2's one-liner). The claims that DO exist there check out where sampled (14.1's 33/33
coverage re-derived; CR-2's commit exists with its nine claimed files) — the problem is that a
uniform, mechanically readable per-task gate record stops existing exactly when tasks started
failing their phase gates. *Fix direction:* backfill taskGates rows for the eleven, even if
terse, or record in GATES.json that the ledger's scope ends at 11.8.

### SWEEP-HONESTY-009 — verify-acceptance's "command transcript" requirement is satisfied by any code fence: the meter's only anti-fabrication check for live artifacts does not check what its message claims

**Severity:** MAJOR (enforcement gap in the meter; the two artifacts it will matter for are the
two not yet written). **Pattern:** P1, proved by mutation.
**Where:** `scripts/verify-acceptance.sh:145` — `grep -qE '^\s*\$ |^\s*```'` inside
`check_artifact`, whose comment reads "A live artifact an LLM can fabricate more cheaply than
it can measure is the single worst outcome available to this build. Require a command
transcript, not prose," and whose failure message says "prose-only claims are a FAIL".

Mutation ACC-A: replaced `12.1-g5-equivalence.md` with 28 lines of pure prose containing one
empty ```` ``` ```` fence and the two required substrings. Row 9b **PASSED**: "present, 28
lines, with a command transcript." The alternation accepts a bare fence as a transcript, so any
markdown with any fenced block — a YAML snippet, an empty fence — passes the "transcript"
check. For row 9b, defense-in-depth held: row 1b went red because `g5-artifact.test.ts`
rejected the fabrication. **But rows 6 (SMOKE.md) and 8 (conductor-report.md) have no such
standing node-suite guard** — when 13.2/14.2 are finally built, `check_artifact` plus a
20-line floor plus two or four substrings is the ONLY structural barrier between a measured
live artifact and a fabricated one, and this mutation shows it does not bar prose. The
substring requirements are equally shallow (row 6: "retry", "behavioral"). *Fix direction:*
require at least one `^\s*\$ ` line (an actual command), or N of them; consider requiring
matched command/output pairs; for 13.2/14.2, ship a standing checker in the node suite the way
G5 got one, BEFORE the artifacts exist.

---

## 2. IDEA register

### IDEA-001 — Give the artifacts directory a manifest with checksums
Origin: auditing five artifacts of four different shapes for provenance.
Kind: tooling. Value: a `docs/build/artifacts/MANIFEST.json` (path, generator, generating
commit, sha256) would let any reviewer distinguish "regenerated by the driver" from
"hand-edited since" in one command; today that takes git archaeology per file.
Cost: small script. Relates to: SWEEP-HONESTY-002.

### IDEA-002 — The stray-process check needs an ownership signal
Origin: the briefing-prescribed `ps | grep 'llama-router|fake-llama|time\.sleep'` check found
live processes that belonged to a CONCURRENT review session's python leg (parent traced to
another `claude` pid); this reviewer killed some of them before realising, possibly failing
that session's in-flight run. Two reviewers following the same instruction will kill each
other's test children.
Kind: process/tooling. Value: scope the check to your own process tree (`pgrep -g` / session
id), or have the suite tag its children's argv with the gate run id.
Cost: one line in the runbook or the spawner. Relates to: standalone.

### IDEA-003 — JOURNAL.jsonl key vocabulary drifted in its own file
Origin: reading the journal tail. The closeout event uses `at`/`task`/`note` where every
earlier event uses `ts`/`taskId`/`detail` — the build's own P3 pattern, inside the record that
exists to be machine-read.
Kind: polish. Cost: trivial. Relates to: SWEEP-HONESTY-007.

### IDEA-004 — envNamesReadBySource proves "mentioned", not "read"
Origin: reading g5-artifact-check.ts:123-138. The function greps for the variable NAME anywhere
in any shipped file — a comment mentioning the variable would satisfy "read by source" (P4
shape: name asserts more than the body checks). Today the distinguishing variables are genuinely
read; the negative case even depends on the dead variable staying unmentioned (assembled from
fragments). A comment in any of the six scanned trees could silently satisfy rule 3.
Kind: test-maintainability. Cost: small (require the name inside a `process.env` /
`os.environ` context). Relates to: SWEEP-HONESTY-002.

### IDEA-005 — COMPLETION-REPORT §8 is the template this repo needs more of
Origin: cross-checking the closeout report for overclaims and finding instead a "what I am
least confident about, worst first" section that pre-empted two of this sweep's findings
("STATE.json is largely self-reported"; "corrections summaries are heading-level only").
Kind: docs/process. Value: make §8-style epistemic-status sections mandatory in future gate and
closeout records. Cost: convention only. Relates to: standalone.

---

## 3. CROSS-LENS POINTERS

- **Enforcement (main sweep):** phase-13 adjudicator note — row `13.1-s1-freeze-denies-test-file-edit`
  states in its own spec text that it "fails against the HEAD literal verifyInFlightTree: null"
  — a row born unsatisfiable (P8) unless CR-2 amended it; verify against the CR-2 diff.
- **Enforcement:** HONEST-LIMITS claims the sigil rule closed the alias-injection route via
  "a command word that resolves to no real binary is denied" — but `git -c alias.x='!git push' x`
  has command word `git` (a real binary); the actual closure is default-deny of unknown
  subcommand `x`. Verify the deny actually fires on that exact shape (honest-limits-pending:20
  called it a "spec-level hole").
- **Enforcement (concurrency/resources):** the python leg's supervisor tests
  (`test_conductor_wiring.py`) appear to leave `time.sleep(600)`-anchored supervisor +
  fake-router process groups alive after individual test cases complete; observed repeatedly
  during this review (attribution partly confounded by a concurrent session — see IDEA-002).
  Check whether the suite reaps its children or leaves minutes-long orphans per case.
- **Enforcement (meta-audit):** the three refuted phase-13 findings (findings artifact
  :589-593) have no preserved refutation reasoning to audit — re-litigation must re-derive
  from code (SWEEP-HONESTY-005).
- **Macro:** the build maintains five status surfaces (HANDOFF, NOW, STATE, JOURNAL,
  CORRECTIONS) with no defined freshness contract between them (SWEEP-HONESTY-007 is the
  honesty half; how many surfaces should exist is macro's question).
- **Macro:** GATES.json phase records are shape-inconsistent (phase 10 has 14 ad-hoc keys,
  phase 8 has 5; phase 12's `verdictHistory` still says "stage 2 has not run" while the same
  record's top-level verdict IS the stage-2 FAIL) — the record schema itself drifted per phase.
- **Capability:** rows 6 and 8 will someday accept live artifacts with no standing checker in
  the suite (unlike G5's). A "live-artifact checker ships before the artifact" mechanism would
  raise the floor (grounds: SWEEP-HONESTY-009 / mutation ACC-A).

---

## 4. Mutation table

| # | Mutation | File mutated | Expectation | Result | Verdict | Restored |
|---|---|---|---|---|---|---|
| G5-M1 | ARM-WITHOUT line made byte-identical to ARM-WITH | docs/build/artifacts/12.1-g5-equivalence.md | scoped gate red | tests=6 pass=5 fail=1, GATE FAIL | check BINDS | cp+cmp identical |
| G5-M2 | REPORT-METRICS-WITHOUT: null → the WITH summary | same | scoped gate red | 5/6, GATE FAIL | check BINDS | cp+cmp identical |
| G5-M3 | REPORT-METRICS-WITH completionTokens 0→9 (de-synced from ROUTER-SERVED) | same | scoped gate red | 5/6, GATE FAIL | check BINDS | cp+cmp identical |
| G5-M4 | ROUTER-SERVED-SUMMARY **and** REPORT-METRICS-WITH both set to the same fabricated numbers (502:6→99, totalRequests 6→99) | same | green predicted (hypothesis: consistency-only check) | tests=6 pass=6, GATE PASS | **residual confirmed** → SWEEP-HONESTY-002 | cp+cmp identical |
| RA-1 | `mv conductor/core/shell-parse.ts` aside (STATE 1.2 revertAssertion) | conductor/core/shell-parse.ts | missing-subject red naming the module | ERR_MODULE_NOT_FOUND naming shell-parse.ts, GATE FAIL | recorded evidence GENUINE | mv back, cmp identical |
| RA-2 | `mv conductor/doctrine/tdd.md` aside (GATES 8.1 M4: "rm tdd.md -> 4 tests red") | conductor/doctrine/tdd.md | red; recorded count 4 | tests=15 pass=11 **fail=4**, GATE FAIL — exact count match | recorded evidence GENUINE | mv back, cmp identical |
| ACC-A | Replace G5 artifact with 28 lines of prose + one bare ``` fence + required substrings | docs/build/artifacts/12.1-g5-equivalence.md | row 9b should fail ("transcript") | row 9b **PASS**; row 1b FAIL (g5-artifact.test caught it); 16 PASS / 5 FAIL | row-9b transcript check DECORATIVE → SWEEP-HONESTY-009; suite guard binds | cp+cmp identical |
| ACC-B | WIRE_CONTRACT_VERIFIED stamp → `<pending>` | router/UPSTREAM_CONTRACT.md | detector F fails | detector F FAIL + row 1b FAIL (node wire-contract pins it) + row 4 FAIL (python leg pins it at test_conductor_wiring.py:1490) | check BINDS, triply | cp+cmp identical |

All mutations snapshot-restored via `cp` and verified byte-identical with `cmp`; no
`git checkout` used. Baseline scoped gate re-confirmed green before the first mutation, and the
combined ACC-A+ACC-B run (14 PASS / 7 FAIL) was decomposed by re-running each alone.

---

## 5. Coverage ledger

| File / area | What was done | Coverage | Conclusion / ids |
|---|---|---|---|
| scripts/verify-acceptance.sh | full run ×3 (baseline + 2 mutation runs); targeted read of rows 4–12, check_artifact, detector F (~140 of 400 lines) | run: full; read: partial | 17/4 claim VERIFIED; SWEEP-HONESTY-009; detector F binds |
| docs/build/STATE.json | full structured extraction (all 57 rows); targeted reads of 12.1, 12.1-G5, 10.1, meta | high | all 55 shas exist, all messages match; SWEEP-HONESTY-001, -003; meta claims (planLines 3399, manifestCount 52, 50 committed, only 13.2/14.2 open) re-verified |
| docs/build/GATES.json | structure + all 44 taskGates summaries + all 17 phaseGates verdicts + all 11 rejections + m7CrossCutting + 10.1 scopeException + 12/13/15 counts | high | phase verdicts match briefing (0–11 PASS, 12–15 FAIL); SWEEP-HONESTY-005, -008; phase-12 verdictHistory contradiction (pointer) |
| docs/build/CORRECTIONS.md | all 92 headers; C-089 in full; C-090 head; targeted lines elsewhere | headers full, bodies ~10% | contiguous C-001…C-092, no gaps/dups; C-089 honest incl. its own invalid first mutation attempt |
| docs/build/HANDOFF.md | read in full (139 lines), claims cross-checked | full | math checks out for its moment; stale by one step (CR-2) → SWEEP-HONESTY-007 |
| docs/build/NOW.md | first 30 lines + mtime | partial | frozen 2026-08-14 against its own freshness promise → -007 |
| docs/build/COMPLETION-REPORT.md | header, §1, §8 in full; structure scan | ~30% | honest snapshot, explicitly dated; §8 exemplary → IDEA-005 |
| docs/build/JOURNAL.jsonl | tail + mtime | partial | ends 2026-08-14T17:40 → -007; key drift → IDEA-003 |
| docs/build/honest-limits-pending.md | read in full | full | one item never folded → SWEEP-HONESTY-004 |
| conductor/docs/HONEST-LIMITS.md | read in full (174 lines) | full | 15 §9 limits + 6 build-discovered sections present; no artifact-fabrication residual → -002, -004 |
| artifacts/12.1-g5-equivalence.md | read in full; 4 mutations; env vars cross-grepped; generator + checker + test read | full | two-identical-arms shape ABSENT in shipped version; guard binds; consistency-only residual → -002 |
| conductor/tools/g5-artifact-check.ts | read in full (239 lines) | full | sound vs recorded forgery; "mentioned ≠ read" → IDEA-004; argv-differs escape noted (rules 4/5 still bind) |
| conductor/tests/g5-artifact.test.ts | read in full (175 lines) | full | drives shipped artifact + 4 negative families; DEAD_VAR fragment trick verified live |
| artifacts/11.8-live-smoke.md | read in full; internal arithmetic re-checked (462=120+342, rate 0.5, statusCounts) | full | internally consistent; honest non-discharge section (SG-E/SG-F/SG-D); no arms shape; live-manual, not re-runnable by design |
| artifacts/phase-11-redteam-probe.md | read in full | full | mechanical PASS with explicit not-covered section; clean |
| artifacts/phase-11-lens-findings.md | headings + majors section | ~30% | 7 majors consistent with GATES.json phase-11 stage2 (27 findings, 7 major) |
| artifacts/phase-gates-12-13-15-findings.md | verdicts, both adjudicator self-run sections, confirmed-major claims, refuted section, phase-13 minors, phase-15 evidence list (~25% of 1,061 lines) | targeted | counts match GATES.json exactly; honestly self-undermining; refuted findings evidence-free → -005 |
| docs/build/specs/*.assertions.json (60 files) | row counts + coveredByTest sweep across all; task-14.1 and task-15.1 deep-checked | structural full | 14.1's 33/33 coverage claim re-derived TRUE; coveredByTest dead on 548/795 rows → -006 |
| router/UPSTREAM_CONTRACT.md | stamp region + header | partial | stamp real, dated, attributed; ACC-B proves it triply pinned |
| scripts/conductor-gate.sh | exemption-liveness section | partial | stale-exemption design noted; mutation-testing it is the main sweep's target |
| conductor/SMOKE.md, artifacts/conductor-report.md | `git log --all --diff-filter=A` | full | NEVER existed in any commit — no hand-authoring ever happened |
| The immutable plan | cited ranges only (G5 step 2884-2888, via artifacts) | LOW — disclosed | clause-by-clause conformance is the main enforcement agent's scope, not this sweep's |

**Not examined:** CORRECTIONS.md bodies C-001…C-088 (headers plus targeted reads only);
COMPLETION-REPORT §§2–7 details; GATES.json phase 0–11 lens prose; JOURNAL.jsonl body;
docs/build/branch-b-plan.md; the 22-tool binding itself (main sweep enumeration 1). Historical
per-task suite counts were validated for internal consistency — monotone in commit time; the
apparent 11.1 regression to tap=847 (vs 10.1's 1244) dissolves under commit-date ordering
because phase 11 was interleaved between 8.2 (837) and 9.1 (864) — but were not re-executed at
historical shas.

---

## 6. Cleared areas — attacked and could not break

1. **CommitSha existence and attribution.** All 55 recorded shas exist; all 55 commit subjects
   match `commitMessage` byte-for-byte. Attack: scripted git cross-check of every row. Nothing
   broke; the only defects are the file-list imprecisions of SWEEP-HONESTY-003.
2. **The acceptance headline.** 17 PASS / 4 FAIL reproduces exactly, with exactly the four
   disclosed rows failing, all owed by 13.2/14.2; the embedded full gate reports 1382/1382,
   matching the "1,382 node tests" claim. Attack: full re-run at HEAD. Matches.
3. **The G5 guard against its recorded forgery class.** Attacks G5-M1/M2/M3 (flatten,
   WITHOUT-summary, provenance de-sync) all went red in the scoped gate. Only the
   consistency-vs-provenance residual (G5-M4) survives, filed as -002.
4. **Recorded red evidence (sampled).** Two revertAssertions re-executed (1.2 missing-subject,
   8.1 doctrine-pack removal); both reproduce precisely, 8.1 to the exact failing-test count.
   The recorded-red evidence class is genuine where sampled.
5. **The wire-contract stamp.** Attack ACC-B: one stamp edit trips three independent checks
   (detector F, node suite, python leg). Over-determined in the good direction.
6. **Hand-authoring of the two live artifacts.** Attack: history-wide `--diff-filter=A` search
   for SMOKE.md and conductor-report.md ever existing. Never created — the "authoring either is
   fabrication" line was honored in fact, not just in prose.
7. **Corrections numbering.** C-001…C-092 contiguous, no gaps, no duplicates — no correction
   was quietly deleted or renumbered.
8. **14.1's coverage claim.** "33 assertion ids, 33 test methods, every id present by literal
   match" — re-derived: true on all three counts.
9. **Two-identical-arms shape across ALL five artifacts.** Only the retracted, superseded G5
   record ever had it; the shipped G5 artifact's arms differ in variables genuinely read by
   shipped source (grep-verified); 11.8, the redteam probe, and both findings artifacts contain
   no equivalence-arms structure at all.

**Fabrication hunt conclusion (honesty audit):** no fabricated evidence found. Checked: every
artifact under docs/build/artifacts/ (shape, internal arithmetic, provenance, generator
existence, regeneration commits); every commitSha and commit message; the acceptance meter's
claims against live runs; two recorded reds re-executed; the never-existence of the two
live-manual artifacts; corrections numbering; the disclosed open items (13.2/14.2, phase gates
12–15 FAIL, stage-2 not re-run) — all disclosed accurately or, where wrong, wrong in the
direction of UNDERCLAIMING (HANDOFF still lists CR-2 as open). The failures found are
staleness, abandonment, and one decorative check — none is an invented measurement.

*Process note:* stray supervisor/fake-router processes observed during this review were traced
to a concurrent `claude` session's python-leg run; this reviewer killed several before tracing
ownership (see IDEA-002). Final check on exit: no processes matching the briefing's pattern
remain that belong to this session.
