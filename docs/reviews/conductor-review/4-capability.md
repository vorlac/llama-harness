# Step 4 — Capability Review, and the Consolidated Plan

**Read `docs/reviews/conductor-review/1-briefing.md` in full first.** It carries the orientation, the
environment, the rules, the P1–P13 taxonomy, the method and the exhaustiveness doctrine.

**Read `docs/reviews/conductor-review/findings-enforcement.md` and `findings-macro.md` in full before you begin.**
They are your evidence base and your raw material. Steps 2 and 3 each left you `CROSS-LENS
POINTERS`; those are leads you are expected to work, not optional reading.

**Output:** `docs/reviews/conductor-review/findings-capability.md` — the only file you may create outside scratch.

You have two jobs. The first is a review; the second is to assemble everything into something the
repo owner can plan from.

---

# JOB 1 — What is MISSING

Steps 2 and 3 examined what exists. **You examine what is absent**, which no amount of attacking
existing code reveals.

> **What mechanism does not exist, that would materially raise the floor on what a small, lazy,
> fallible model can be made to produce?**

The plan is immutable and authoritative for what it *does* specify — and it was written before the
system had ever run in anger. Several of its assumptions have since been contradicted by measurement
(see `CORRECTIONS.md`). Treat it as **potentially incomplete** for what it does not say. Proposing an
addition is not a violation of its immutability; it is a finding.

## The grounding rule — this is what keeps job 1 from becoming a wish list

**Every `GAP` must trace to a specific `ISSUE`, `MACRO`, correction, or observed behaviour.** The
form that works is:

> *"The harness cannot re-derive X (ISSUE-NNN), so a model can assert X freely, so here is the
> mechanism that would let it re-derive X."*

The form that does not:

> *"It would be good if the system also did Y."*

Anything without grounding is marked `SPECULATIVE` and ranks below every grounded entry. Keep those
few. The enforcement and macro reviews exist precisely so that this review can argue from evidence.

## Where to look

- **Every ACCEPTED-ON-TRUST row in the enforcement review's enforcement table.** For each, ask whether re-derivation
  is absent because it is *impossible* or because *nobody built it*. Only the second is a GAP, and
  these are the highest-value entries in this review.
- **Detection that could become prevention.** G7 is "detection over prevention", honestly disclosed.
  For each disclosed detection-only gap, ask whether prevention is now *cheap* given what has since
  been built — the composition root, the live gate snapshot and the marker enumeration make several
  things trivial that were expensive in the original design.
- **Failures a human never sees.** Any failure whose only trace is an `error`-level journal line is a
  failure nobody will notice. Every terminal state should hand a human an artifact. One such wedge
  was found and fixed (C-085); the enforcement review's composition work (its Part D) should have found more.
- **Dumb mechanical cross-checks.** The highest-value additions in this build's history were not
  clever — a control suite proving the fixture discriminates, an execution witness proving a test
  really ran, a two-way field-set comparison proving two spellings agree, a counter on the router's
  own ledger proving it was contacted. Where else is a boring cross-check available and absent?
- **Doctrine efficacy.** Read all nine packs in `conductor/doctrine/` as if you were a 32k-context
  model with weak instruction-following. Which instruction gets dropped first under context pressure?
  Which are abstract where they could be procedural? Is there a situation the model will certainly
  hit with no doctrine for it? A missing pack, or one too long to survive truncation, is a GAP.
- **Self-diagnosis.** When a run goes wrong, how long does a human take to find out why? What is not
  recorded that must be reconstructed by hand?
- **Advisory that could be structural.** The plan's best ideas make the wrong thing *impossible*
  rather than forbidden — item FSM ordering, handler-run evidence, the single-writer rule. Where does
  the system still rely on a rule the model is asked to follow, when the property could be made
  structural instead?

Use the `GAP-NNN` record from the briefing. `STRUCTURAL OR ADVISORY?` is the field that matters most —
structural beats detected, and if a structural version exists at higher cost, say so.

---

# JOB 2 — The consolidated plan

You hold all three registers. Assemble them into something that can be planned from, **without
making the decisions that are not yours to make.**

## 2a. Merge

- **Dedupe.** The same defect may appear in two registers under different lenses. Merge, keep the
  strongest evidence, and note both origins.
- **Resolve cross-references.** Every `CROSS-LENS POINTER` from the enforcement and macro reviews must be
  dispositioned: became ISSUE-NNN / became GAP-NNN / investigated and cleared / still open, and why.
- **Reclassify freely.** An `IDEA` that turns out to be a defect becomes an `ISSUE`; a `MACRO` that
  is really one local bug becomes an `ISSUE`. The briefing told the earlier reviews to file
  *somewhere* rather than agonise — this is where that gets tidied.
- **Unified register**, one table, every id, with: title, type, severity, subsystem, effort,
  depends-on, blocks, and one-line summary.

## 2b. Structure

- **Systemic clusters.** Groups sharing ONE root cause, where a single structural change closes
  several. These are the highest-value items in the entire output. The enforcement review's `WHY NOTHING CAUGHT IT`
  fields and the macro review's correction clustering are where you find them.
- **Dependency graph.** What must land before what. Identify the independent clusters that could run
  in parallel, and the chains that cannot.
- **Requires-a-live-model**, separated — it cannot be scheduled freely.
- **Blocked-on-a-decision**, separated — anything needing a plan amendment, a schema change, or a
  closed-vocabulary change. Those are the owner's calls, not work items.

## 2c. The provisional plan

Produce an **ordered** plan, so the follow-up session has something to react to rather than a blank
page. Order by the one criterion that is objective:

> **What would a lazy model exploit first?**

That is derivable from the findings — it does not require knowing the owner's preferences. Within
that, order by dependency, then by cost. State the reasoning for each position, briefly.

Mark it clearly as **PROVISIONAL**. It is a draft to be argued with.

## 2d. The decisions you did NOT make — surface them explicitly

This section is as important as the plan. List every choice you deliberately left open, each with the
options, the tradeoff, and what evidence bears on it. At minimum:

- Which findings are acceptable to leave unfixed, and at what cost?
- Which structural changes are worth their migration cost?
- Anything requiring a plan amendment or a vocabulary change.
- Any place where two findings suggest conflicting fixes.
- **How much of this to do at all.**

**Do not answer these.** A follow-up interactive session works through them with the repo owner, and
that session's outcome will re-order your provisional plan. Your job is to make the decisions
*visible and well-framed*, not to pre-empt them.

---

## Output

Write `docs/reviews/conductor-review/findings-capability.md`:

1. **Executive verdict** (≤1 page) — what is missing that most limits this system; would the
   "process quality from a small model" thesis hold as built; your confidence.
2. **The GAP register** — full records, explanatory, every entry grounded or marked SPECULATIVE.
3. **The doctrine assessment** — all nine packs, individually judged for a 32k weak-instruction
   model.
4. **The IDEA register** — yours, plus anything reclassified from the enforcement and macro reviews.
5. **The unified register** (2a) — every id from all three reviews, one table.
6. **Systemic clusters** (2b) — the highest-value section in the document.
7. **The dependency graph** and the parallel/serial split.
8. **The PROVISIONAL ordered plan** (2c), with reasoning.
9. **The open decisions** (2d) — framed, not answered.
10. **Pointer disposition** — every cross-lens pointer from the enforcement and macro reviews, resolved.
11. **Coverage ledger** and **cleared areas**.

No length limit and no token budget. Write incrementally so work survives context exhaustion. **This
review is complete when every pointer is dispositioned, every register entry appears in the unified
table, and every deferred decision is stated with its options** — not when the writing feels done.
