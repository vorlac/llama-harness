# Step 5 — Delegation Design & Fix Prioritization (INTERACTIVE)

**This is an agenda for an INTERACTIVE session, not a batch prompt.** It is deliberately short. The
work happens in conversation; a long prompt would front-load the decisions the conversation exists to
make.

**Run this after all three reviews are complete.** Invoke `superpowers:brainstorming`.

---

## Why interactive, and why now

The three reviews are *discovery* — the facts are in the codebase and an agent can find them without
the owner in the loop. This session is *decisions*, and the inputs are not in the repo: how much
verification the owner is willing to do, which failures are tolerable, what a local model can be
trusted with on a bad day.

It runs **after** the reviews and **before** the fix plan is committed to, because the delegation aim
re-orders the findings. If the enforcement review shows the evidence is weak somewhere the owner would never
delegate anyway, those fixes drop down the list. Deciding priority first would lock in the wrong
order.

The lens is expected to move as the discussion goes. That is the point.

---

## Read first

- `docs/reviews/conductor-review/findings-capability.md` — especially its **provisional ordered plan** and its
  **open decisions** section, which is written to be argued with.
- `findings-enforcement.md` — the executive verdict and the enforcement table (which claims the
  harness re-derives vs accepts on trust).
- `findings-macro.md` — the executive verdict and the correction clustering.

---

## The two questions, which are one conversation

**1. What is this system FOR, concretely?**

The stated goal: roughly double what is possible within a metered Claude Code allotment by putting
local models at the disposal of Opus/Fable — delegating the simple work so the expensive budget buys
depth on the hard work. That allotment is always consumed in full; capacity is the binding
constraint.

So the question conductor must answer is not "is it correct?" but:

> **Can a Claude-class orchestrator delegate a task to this harness and get back work it does NOT
> have to redo or re-verify?**

**2. Given that, and given the findings, what gets fixed and in what order?**

---

## Three observations to put on the table early

These are empirical, from the build campaign that produced C-076…C-092. They are seeds for
discussion, not conclusions.

**Briefing cost dominated verification cost.** Across ~20 delegated rounds, the largest orchestrator
expense was not checking returned work — it was *writing the instructions*. Each round needed 100–200
lines naming exact line ranges, exact mutations, exact boundaries, exact traps; briefs that omitted
any of them produced work that had to be redone. Those agents were Claude-class. **A weaker local
model needs more briefing, not less** — so if that cost does not come down, delegation is a net loss
and the whole thesis inverts.

**The cheapest brief is a failing test.** *"Make this red test green, do not touch the test"* is
minimally briefable and maximally checkable, and it is the unit conductor is already built around.
Both costs — briefing and verification — collapse at once. Where a task cannot be reduced to that
shape is probably where Claude should keep the work.

**Triage is unsolved and may be the crux.** Conductor classifies the *user's request* (trivial /
work / question). Nothing assesses whether a task is *within a small local model's competence*. A
local model that fails visibly is fine; one that returns plausible-wrong work is worse than not
delegating — the orchestrator then builds on sand and pays again to unwind it.

---

## Decisions to reach

Roughly in order; expect to move between them.

1. **The delegation primitive.** What is the unit of work handed to a local model? Is the red-test
   shape right, or too narrow?
2. **The trust boundary.** Which of conductor's evidence would the owner accept without re-deriving?
   The enforcement review's enforcement table is the input. This is a risk-tolerance call, not a technical one.
3. **Triage.** How is "is this within the local model's competence" decided, and by whom? Before
   dispatch, or detected after?
4. **Failure economics.** What happens when a delegated task returns wrong work? What is the cost,
   and what would make it cheap to detect?
5. **What briefing the harness could supply itself** — scope, relevant files, prohibitions, traps.
   Every item the harness provides structurally is orchestrator tokens saved on every task.
6. **Therefore: the fix order.** Re-rank the capability review's provisional plan against all of the above. Which
   findings matter for the delegation aim, which are correctness debt to pay anyway, and which can
   be left.
7. **Scope.** How much of this to actually do.

---

## Output

Whatever the conversation warrants — most likely a short design doc plus a re-ordered plan. If it
turns architectural (a new delegation subsystem rather than adjustments), the brainstorming skill's
full path applies: approaches, sectioned design, a written spec, then `writing-plans`.

Do not pre-commit to an artifact shape before the conversation has happened.
