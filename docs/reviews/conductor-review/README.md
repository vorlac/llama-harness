# Conductor Review Suite — Runbook

**Standalone reference. Everything you need to run this is here.**

Five steps. Steps 2–4 are batch workflows (six invocations total); step 5 is a conversation.
**Run every invocation in a FRESH session.**

---

## The commands, in order

Copy-paste each into a **new** Claude Code session in this repo. Wait for each to finish before
starting the next.

```
1.  (nothing to run — 1-briefing.md is read automatically by every agent)

2a. Run the workflow at docs/reviews/conductor-review/run-step2a-subsystems.js
2b. Run the workflow at docs/reviews/conductor-review/run-step2b-sweeps.js
2c. Run the workflow at docs/reviews/conductor-review/run-step2c-composition-merge.js

    >>> CHECKPOINT: read findings-enforcement.md before continuing <<<

3.  Run the workflow at docs/reviews/conductor-review/run-step3-macro.js
4.  Run the workflow at docs/reviews/conductor-review/run-step4-capability.js

5.  Open docs/reviews/conductor-review/5-delegation-design-session.md and work through it
    as a conversation (it uses the superpowers:brainstorming skill).
```

| Invocation | Agents | Runs in batches of | Produces |
|---|---|---|---|
| 2a subsystems | 10 | 3 | `parts/*.md` |
| 2b sweeps | 6 | 3 | `parts/*.md` |
| 2c composition + merge | 2 | sequential | **`findings-enforcement.md`** |
| 3 macro | 5 | 2 | **`findings-macro.md`** |
| 4 capability | 3 | 2 | **`findings-capability.md`** (+ the consolidated plan) |
| 5 delegation | — | interactive | design + final priority |

---

## The checkpoint after step 2c — do not skip this

Read `findings-enforcement.md` before running step 3. This is the cheapest possible validation that
the review design is working. Look for:

- Are issues **reproduced**, or merely asserted?
- Does the **mutation table** have real entries — checks that were broken and observed?
- Does **MERGE NOTES** list any `UNOWNED FILES`? If so, coverage is incomplete, and the executive
  verdict should say so at the top.
- Is it mostly findings, or mostly filled-in templates? (The briefing calls the latter "compliance
  theatre" and explicitly forbids it — check whether that held.)

If it looks wrong, fix the prompts before spending on steps 3 and 4. That is the whole point of
splitting step 2 into three invocations.

---

## If a run dies (rate limit, crash, killed session)

**Nothing is lost.** Two protections are built in:

1. **Every agent writes a skeleton file within its first few tool calls, then appends as it works.**
   An agent killed at minute 25 has its findings on disk up to that moment. Check `parts/`,
   `parts-macro/`, `parts-capability/`.
2. **Workflows resume from cache.** Re-run with the run ID printed when the workflow started:

```
Resume the workflow at docs/reviews/conductor-review/<script>.js with resumeFromRunId: "wf_xxxxx"
```

Completed agents replay instantly from cache; only the unfinished ones re-run. A death at agent 8 of
10 costs you 2 agents, not 10.

**If you lose the run ID**, just re-run the script normally — agents whose part files already exist
will redo work, so instead delete nothing and re-run only the invocation you need. The parts on disk
are the durable artifact either way.

---

## Cost expectations

Rough estimate, extrapolated from a prior campaign of comparable depth:

| Step | Estimate |
|---|---|
| 2 (a+b+c) | ~4–8M tokens |
| 3 | ~1–2M |
| 4 | ~1M |
| **Total** | **~6–11M** |

**Step 2 alone may exhaust a 5-hour window.** That is expected and fine — the three invocations are
independent, so hitting a limit between them costs nothing, and hitting one *inside* an invocation
costs at most the agents in that batch (3, or 2 for steps 3–4). Batch sizes are deliberately small
for exactly this reason.

Nothing is pinned to a model. The agents inherit whatever you run the session with, so switching
accounts or models needs no edits. If you want tiering later, the natural split is mechanical work
(the vocabulary inventory, the 92-correction sweep) versus judgment work (the composition pass and
the two merges) — the latter is where reasoning quality decides whether the output is worth anything.

---

## Why fresh sessions

Each prompt is written for a reviewer "dropped into an unfamiliar repository with no prior context",
and everything a reviewer needs is in `1-briefing.md`.

More importantly: **a session that has been working on this code is the wrong reviewer.** It carries
a model of where the problems are and a stake in the work holding up, so it re-confirms rather than
discovers. That is the same failure this build already recorded as P10 — its own skeptic panel
refuted a true finding by accepting a plausible argument, then sealed it with a "do not re-litigate"
note. Independence is the mitigation.

---

## Why workflows rather than one big session

**Context.** Step 2 requires reading a 3,399-line plan, a 9,253-line `tools.ts`, ~15 test files, and
mutation-testing every gate. One agent runs out partway and returns whatever it has. Ten subsystem
agents each get a full window for their slice.

**Fan-out's blind spot, handled.** Splitting by subsystem is structurally bad at defects living in
the *seams* — the archetype is C-085, where three individually-correct rules composed into a run that
could never exit and never be detected. Step 2c is a dedicated composition pass that reads all
sixteen parts first and hunts exactly that.

**Merge is reconciliation, not concatenation.** The merge agent dedupes across parts, reconciles
severity to one standard, resolves factual contradictions by checking itself, and **mechanically
verifies coverage** — unioning every part's coverage ledger against `git ls-files` and naming every
production file that appears in none. That check exists because the scope assignment in these scripts
was written by hand, and a hand-written partition is exactly the kind that looks complete and is not.
One such gap (`conductor/tools/`, three adapter modules, several scripts) was found and patched
*before* any of this ran.

---

## Files

```
1-briefing.md                     shared: orientation, traps, rules, P1-P13 taxonomy, method
2-enforcement.md                  step 2 charter
3-macro.md                        step 3 charter
4-capability.md                   step 4 charter
5-delegation-design-session.md    step 5 agenda (interactive)

run-step2a-subsystems.js          10 agents, batches of 3
run-step2b-sweeps.js               6 agents, batches of 3
run-step2c-composition-merge.js    2 agents, sequential
run-step3-macro.js                 5 agents, batches of 2
run-step4-capability.js            3 agents, batches of 2

findings-enforcement.md           ← step 2 output   (the checkpoint)
findings-macro.md                 ← step 3 output
findings-capability.md            ← step 4 output, includes the consolidated plan
parts/                            ← step 2 per-agent parts (audit trail, keep)
parts-macro/                      ← step 3 per-agent parts
parts-capability/                 ← step 4 per-agent parts
```

The `parts*/` directories are kept deliberately: they are the audit trail behind each merged
document, showing what each individual reviewer saw and where each one stopped.
