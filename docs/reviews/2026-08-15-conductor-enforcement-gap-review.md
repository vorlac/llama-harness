# SUPERSEDED — split into a briefing plus three sequenced reviews

This single-document review was split so each lens gets a full, undiluted pass. Three lenses in one
prompt risked exactly the shallowness the split now prevents.

Use instead, in order:

1. **`conductor-review-briefing.md`** — shared: orientation, environment and traps, rules of
   engagement, the P1-P13 defect taxonomy, method, exhaustiveness doctrine, known-open.
   Read in full before any review.
2. **`conductor-review-1-enforcement.md`** — micro: does enforcement hold, is every check able to
   fail, plus correctness, security, concurrency, crash-safety, the C++ router, build-record
   honesty. Produces `ISSUE-NNN`.
3. **`conductor-review-2-macro.md`** — shape: organisation, layering, design coherence, the build
   process as a designed thing, documentation, fitness for what comes next. Produces `MACRO-NNN`.
4. **`conductor-review-3-capability.md`** — absent: what mechanism would raise the floor on a lazy
   model, grounded in 1 and 2. Produces `GAP-NNN`, and consolidates all three registers into a
   provisional plan plus the decisions it deliberately did not make.

Then, interactively:

5. **`delegation-design-session.md`** — the delegation aim and final fix prioritization, worked
   through with the repo owner. Not a batch prompt.

The earlier `fable-full-and-adversarial-review.md` predates all of this and is retained as a
historical artifact.
