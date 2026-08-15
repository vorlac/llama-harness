# Conductor Review Suite — Runbook

Five steps. Steps 2–4 are batch workflows; step 5 is a conversation. **Run each step in a FRESH
session** — see "Why fresh sessions" below.

| Step | Artifact | Run as | Produces |
|---|---|---|---|
| 1 | `1-briefing.md` | *not run* — read by every agent automatically | — |
| 2 | `2-enforcement.md` + `run-step2-enforcement.js` | workflow, **18 agents** | `findings-enforcement.md` |
| 3 | `3-macro.md` + `run-step3-macro.js` | workflow, **5 agents** | `findings-macro.md` |
| 4 | `4-capability.md` + `run-step4-capability.js` | workflow, **3 agents** | `findings-capability.md` |
| 5 | `5-delegation-design-session.md` | **interactive conversation** | design + final plan |

---

## How to run it

### Step 2 — enforcement (do this first, then stop)

Open a **new Claude Code session** in this repo and say:

```
Run the workflow at docs/reviews/conductor-review/run-step2-enforcement.js
```

It fans out nine subsystem audits and six cross-cutting sweeps in parallel, then a composition pass
that hunts defects living *between* subsystems, then a merge that reconciles all sixteen parts into
one register. Expect it to take a while and consume a lot of tokens — that is intended.

**Then stop and read `findings-enforcement.md` before going further.** This is the checkpoint that
matters: if the prompt design is producing process compliance instead of findings, it shows up here,
and fixing it costs one stage instead of three. Look for:
- Are issues **reproduced**, or merely asserted?
- Does the **mutation table** have real entries — checks that were broken and observed?
- Does **MERGE NOTES** list any `UNOWNED FILES`? If so, coverage is incomplete and it should say so
  in the executive verdict.
- Is the register mostly findings, or mostly filled-in templates?

### Step 3 — macro

New session:

```
Run the workflow at docs/reviews/conductor-review/run-step3-macro.js
```

Reads step 2's output as its evidence base. Four lenses plus a merge.

### Step 4 — capability + consolidation

New session:

```
Run the workflow at docs/reviews/conductor-review/run-step4-capability.js
```

Reads steps 2 and 3. Produces the GAP register **and** the consolidated plan across all three
registers — unified table, systemic clusters, dependency graph, a provisional ordered plan, and an
explicit list of the decisions it deliberately did *not* make.

### Step 5 — the interactive session

New session. Open `5-delegation-design-session.md` and work through it as a conversation. It uses
the `superpowers:brainstorming` skill. This one is **not** a workflow, on purpose: it makes decisions
that depend on your risk tolerance and intent, which cannot be derived from the codebase.

---

## Why fresh sessions

Each step's prompt is written for a reviewer "dropped into an unfamiliar repository with no prior
context" — that is the design, and everything a reviewer needs is in `1-briefing.md`.

More importantly: **a session that has been working on this code is the wrong reviewer.** It has a
model of where the problems are and a stake in the work holding up, so it re-confirms rather than
discovers. That is the same failure the build already recorded as P10, where the skeptic panel
refuted a true finding by accepting a plausible argument. Independence is the mitigation.

---

## What the workflows do that a single agent could not

**Context.** Step 2 requires reading a 3,399-line plan, a 9,253-line `tools.ts`, ~15 test files, and
mutation-testing every gate. One agent runs out of context partway and returns whatever it has. Nine
subsystem agents each get a full window for their slice.

**Fan-out's blind spot, handled.** Splitting by subsystem is structurally bad at defects that live in
the *seams* — the archetype is C-085, where three individually-correct rules composed into a run that
could never exit and never be detected. So there is a dedicated composition pass that reads all
sixteen parts first and hunts exactly that.

**Merge is reconciliation, not concatenation.** The merge agent is instructed to dedupe across parts,
reconcile severity to one standard, resolve factual contradictions by checking itself, and — the
part that matters most — **mechanically verify coverage**: union every part's coverage ledger against
`git ls-files` and name every production file that appears in none. That check exists because the
scope assignment in `run-step2-enforcement.js` was written by hand, and a hand-written partition is
exactly the kind that looks complete and is not. One such gap (`conductor/tools/`, three adapter
modules, several scripts) was found and patched *before* the script ever ran.

---

## Files

```
1-briefing.md                     shared: orientation, traps, rules, P1-P13 taxonomy, method
2-enforcement.md                  step 2 charter
3-macro.md                        step 3 charter
4-capability.md                   step 4 charter
5-delegation-design-session.md    step 5 agenda (interactive)
run-step2-enforcement.js          workflow, 18 agents
run-step3-macro.js                workflow, 5 agents
run-step4-capability.js           workflow, 3 agents

findings-enforcement.md           ← step 2 output
findings-macro.md                 ← step 3 output
findings-capability.md            ← step 4 output (includes the consolidated plan)
parts/                            ← step 2 per-agent parts (audit trail, kept)
parts-macro/                      ← step 3 per-agent parts
parts-capability/                 ← step 4 per-agent parts
```

The `parts*/` directories are kept deliberately: they are the audit trail behind each merged
document, and they show what each individual reviewer saw and where each one stopped.
