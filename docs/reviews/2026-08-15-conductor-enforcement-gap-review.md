# SUPERSEDED — see docs/reviews/conductor-review/

This single-document review was split so each lens gets a full, undiluted pass. Three lenses in one
prompt risked exactly the shallowness the split now prevents.

Run the five steps in `docs/reviews/conductor-review/`, in order:

| Step | File | What it is |
|---|---|---|
| 1 | `1-briefing.md` | Shared ground — orientation, environment and traps, rules of engagement, the P1-P13 defect taxonomy, method, exhaustiveness doctrine, known-open. **Read in full before any step.** Not run on its own. |
| 2 | `2-enforcement.md` | Micro: does enforcement hold, is every check able to fail — plus correctness, security, concurrency, crash-safety, the C++ router, build-record honesty. Produces `ISSUE-NNN` → `findings-enforcement.md`. |
| 3 | `3-macro.md` | Shape: organisation, layering, design coherence, the build process as a designed thing, docs, fitness for what comes next. Produces `MACRO-NNN` → `findings-macro.md`. |
| 4 | `4-capability.md` | Absent: what mechanism would raise the floor on a lazy model, grounded in steps 2-3. Produces `GAP-NNN` → `findings-capability.md`, plus the consolidated provisional plan and the decisions it deliberately did not make. |
| 5 | `5-delegation-design-session.md` | **Interactive.** The delegation aim and the final fix prioritization, worked through with the repo owner. Not a batch prompt. |

Steps 2-4 are sequential: each reads the previous findings and dispositions the cross-lens pointers
left for it. Step 5 runs last because the delegation aim re-orders the findings.

The earlier `fable-full-and-adversarial-review.md` predates all of this and is retained as a
historical artifact.
