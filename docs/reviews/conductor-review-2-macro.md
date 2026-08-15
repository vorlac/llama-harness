# Review 2 of 3 — Macro: Shape, Organisation, Design Coherence

**Read `docs/reviews/conductor-review-briefing.md` in full first.** It carries the orientation, the
environment, the rules, the P1–P13 taxonomy, the method and the exhaustiveness doctrine. This prompt
does not repeat any of it.

**Read `docs/reviews/findings-1-enforcement.md` before you begin.** Review 1 has already produced the
enumerations, the mutation table, the reproduced defects and a set of `CROSS-LENS POINTERS` addressed
to you. That is your evidence base — this review argues *from measurement*, not from taste.

**Output:** `docs/reviews/findings-2-macro.md` — the only file you may create outside scratch.

---

## Your question

> Review 1 asked whether the individual parts work. **You ask whether the SHAPE is right** — whether
> a system that passes every local check is nonetheless organised, layered and decomposed in a way
> that will keep producing the defects review 1 found.

Shape defects are invisible from inside a single file, which is exactly where review 1 spent its
time. Nothing else in this process will see them.

**The evidence burden here is the highest of the three reviews**, precisely because structural
opinions are the easiest to write persuasively without proof. Every finding needs a measurement, a
cited pattern across at least three corrections, or a defect from review 1 whose *cause* is
structural. A finding with none of those is an OPINION and must be labelled one.

---

## Part A — Organisation, judged by the system's own standard

This project's thesis is that small, context-limited models can do good work here. So the codebase is
not merely *implemented for* small models — it must be **navigable by** them. That is measurable, so
measure it.

Starting facts, which you should verify and extend:
- `conductor/adapter/tools.ts` is **9,253 lines**. `conductor/tests/e2e.test.ts` is **4,317**.
  `conductor/plugin/index.ts` is **1,427**. The immutable plan is **3,399**.
- Every agent brief written during the build campaign carried an explicit *"NEVER read this file
  whole"* instruction, and agents routinely had to be handed exact line ranges before they could
  begin work at all. That is recorded across C-076…C-092 and visible in the build's own briefs.

Now answer, with numbers:

- **Can a 32k-context model do a task in this repo without being told where to look?** Pick several
  representative tasks — add a tool, change a gate arm, add an assertion row, fix a handler bug — and
  determine what a model would have to read to do each one safely. Count the tokens. If the answer is
  "more than its context", that is a first-order design finding about a system whose entire purpose
  is to be worked on by such models.
- **What does the current decomposition cost?** In tokens per task, in error rate, in how much
  orchestrator hand-holding each delegated task needed. Review 1's mutation table and the build's
  corrections are evidence here — how many defects trace to someone not having read enough?
- **Is there a discoverable path from "I need to change X" to the file that owns X?** Or does it
  require the kind of repo-wide grep that a context-limited model cannot afford?
- **What is the right decomposition?** If `tools.ts` should be split, say along which seams, what it
  would cost, and what would break. A proposal without a migration cost is not actionable.

---

## Part B — Layering and responsibility

- Is the **G3 pure-core / thin-adapter** split actually holding? Check dependency directions. Has any
  `core/` module grown I/O, a clock or network awareness? Has `adapter/` accumulated decision logic
  that belongs in core?
- **Where does responsibility for one concern live?** The gate regime spans `core/gates-*.ts`,
  `adapter/tools.ts` and `plugin/index.ts`. Is that a clean seam or a smear? Several corrections are
  exactly "two layers each believed the other owned this" — find them, count them, and say whether
  the boundary or the discipline is at fault.
- Is the composition root the right size, and does it do only composition?
- Are the module boundaries such that a change in one place requires changes in three?

---

## Part C — Design coherence

- Do the parts share one philosophy, or are there competing ones? Detection-over-prevention in some
  places and prevention in others — principled, or accidental?
- Are there concepts existing twice under different names **at the design level** rather than the
  string level (which is review 1's P3)? Two mechanisms doing one job.
- **Is the role decomposition right?** Seven roles, nine doctrine packs. Would a small model do better
  with fewer, sharper roles — or does it need more? What evidence exists either way in the build
  record?
- **Is the run/item FSM pair the right abstraction**, or does it force awkward states? Look at every
  recorded deviation mentioning a state that is "settled but not finished" or similar — those are
  where the model of the world strains. C-084's wedge is one; find the rest.
- Are the closed vocabularies the right closures? Any place where a legitimate state has no name?

---

## Part D — The build process is part of the design

The task gates (M1–M9), phase gates, blind lens fan-out and skeptic ladder are machinery that
produced this codebase. Review 1 audited whether they *work*. You ask whether they are **well
designed**.

- Given that machinery produced a confirmed false negative and then sealed it (P10), what would you
  change about the gate regime?
- **Cluster all 92 corrections by root cause.** This analysis is a required deliverable in itself.
  What do the biggest clusters say about where the *design* — not the implementation — is weak? Which
  clusters would a different structure have prevented entirely?
- Is the assertion-row mechanism working as intended? Rows have been found unreachable,
  self-contradictory and named-but-unproven. Is the concept sound with better discipline, or does it
  need a structural change?
- Is the correction ledger itself well-designed? Ninety-two entries in one 4,000-line file — is that
  navigable, and would a model find the relevant one?

---

## Part E — Documentation, comments, operator experience

- Are `conductor/docs/OPERATIONS.md` and `HONEST-LIMITS.md` accurate *today*? Phase 15 exists because
  they drifted from the code once already, and `ops-docs.test.ts` now binds 25 rows — check whether
  it binds enough, and whether anything has drifted since.
- **Comment honesty:** do comments describe what the code does, or what someone hoped? Sample widely.
  A comment that asserts a property the code does not have is a P4 in prose.
- **Operator experience:** when a run goes wrong, what does a human see? How long to find the cause?
  What is not recorded that would have to be reconstructed by hand? Which failures leave nothing but
  an `error`-level journal line nobody will read?

---

## Part F — Fitness for what comes next

- Two live tasks remain and **the system has never run against a real model end to end.** Read the
  design and say where you expect it to break on first contact, and why.
- What happens at 2× the tasks, 2× the tools, a second router backend? Which structures scale and
  which are already at their limit?
- What would a second contributor — or a second orchestrating agent — need that does not exist?
- Is the system's own growth sustainable: does adding a tool, a role or a gate require touching one
  place or five?

---

## Output

Write `docs/reviews/findings-2-macro.md`:

1. **Executive verdict** (≤1 page) — is the shape right; what will keep producing defects if
   unchanged; your confidence and what most affects it.
2. **The MACRO register** — full records per the briefing's field list, written explanatorily, each
   with `THE OBSERVATION` (numbers where numbers exist), `THE CONSEQUENCE` (tied to something that
   has actually happened), `WHY IT IS STRUCTURAL NOT LOCAL`, `WHAT A BETTER SHAPE LOOKS LIKE` (with
   migration cost), `PLAN IMPACT`, and `WHAT WOULD CHANGE YOUR MIND`.
3. **The correction clustering** (Part D) — all 92 by root cause, with what each cluster implies.
4. **The navigability measurement** (Part A) — the representative tasks, token counts, verdicts.
5. **The IDEA register** — every improvement thought, however small.
6. **CROSS-LENS POINTERS** — anything belonging to review 3 (missing mechanisms), and anything you
   believe review 1 under-covered and should be re-run against. Review 3 reads these.
7. **Disposition of review 1's pointers to you** — every pointer it left, and what you concluded.
8. **The coverage ledger** — what you examined, how much, what you concluded.
9. **Cleared areas** — structural concerns you investigated and found sound, with what you checked.

No length limit and no token budget. Write incrementally so work survives context exhaustion. **The
review is complete when every correction has been clustered, every representative task measured, and
every pointer from review 1 dispositioned** — not when you have enough to say.
