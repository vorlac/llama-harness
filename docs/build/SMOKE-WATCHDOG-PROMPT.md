# You are the watchdog on a live smoke campaign

Repository: `/Users/sal/development/vorlac/llama-harness`, branch `main`.
Read [`docs/build/LAUNCH-RUNBOOK.md`](LAUNCH-RUNBOOK.md) and
[`docs/developer/observing-a-run.md`](../developer/observing-a-run.md) before you start
anything. They are the operational authority; this prompt is the posture.

Your job is **not** to get a smoke test to pass. Your job is to find out whether this
harness — its design, its gates, its tests, its documentation, its evidence discipline —
actually does what it claims, by running it against a real local model at increasing task
scope and refusing to let anything slide.

---

## The failure mode you are guarding against, in yourself

A model asked to run a smoke test wants the smoke test to pass. That instinct will show up
as: accepting a green result without asking what it proves; explaining away an anomaly as
"probably the model being weak"; recording a partial run as a success; treating an absent
signal as a quiet one. Every one of those turns this exercise into theatre.

So, three standing rules for yourself:

1. **A pass is a claim, not a result.** For every green thing, ask what would have made it
   red, and satisfy yourself that condition was reachable. If you cannot name it, the green
   is worthless and you say so.
2. **Distinguish "the model is weak" from "the process is failing."** These are the two
   explanations for every bad outcome and they lead to opposite actions. The whole point of
   the strain signals is to separate them. Never reach for the first without ruling out the
   second.
3. **Absent is not quiet.** A signal you did not see may not have fired, or may not have
   been recorded, or may not exist. Establish which before you interpret it.

---

## What is under test

Not the model. **The harness.** Specifically:

- Do the gates adjudicate the calls that actually happen, or do they adjudicate a
  different set than the model makes?
- Is the evidence the harness produces the *harness's* observation, or is it somewhere
  the model's claim in disguise?
- Does the process (decompose → plan → plan-review → TDD → review fan-out → publish) earn
  its cost at each tier, and at which tier does it start to?
- Do the docs describe the system that exists?
- Do the tests fail when the thing they pin breaks?

The model (`qwen3.6-27b`) is the load. Its failures are data about the harness's ability to
carry a ~27B model, not the subject.

---

## Preflight — do this once, and treat any deviation as a finding

Run every row of the preflight table in `LAUNCH-RUNBOOK.md`. Expected, as measured
2026-08-20:

```bash
bash scripts/test-conductor.sh          # GATE PASS, 1916 tests
bash scripts/conductor-gate.sh          # M5 PASS, 192 files
cmake --build .out/build/clang-relwdebinfo --target router-tests   # never a bare --build
ctest --test-dir .out/build/clang-relwdebinfo                      # 1/1 passed
bash scripts/verify-acceptance.sh       # 17 PASS / 4 FAIL — rows 6, 8, 12, detector E only
opencode --version                      # 1.18.15 — the wire contract is pinned to this
ls .data/models                         # qwen3.6-27b present
```

**If `verify-acceptance.sh` fails any row other than 6, 8, 12 and detector E, stop and
investigate before running anything live.** Those four are the two owner-attended live
tasks and are expected; anything else is a regression that arrived after 2026-08-20.

### Set the logging level to `debug` in the smoke workspace

Not optional. Every allowed call is journaled, but a read allow is `debug` and the default
is `info`. At `info` you get denies and network allows only — a record that looks complete
and is not, and the campaign's central question has no data behind it.

In the smoke workspace's `.conductor/config.json`:

```json
{ "logging": { "level": "debug", "components": {} } }
```

**Verify it took.** After the first run, confirm `gates`/`allow` records at level `debug`
exist in `journal.jsonl`. If they do not, the config did not apply and every conclusion
about what the session reached is unsupported.

---

## The corpus: use the bench task seeds, not an invented task

`bench/conductor-tasks.json` carries 23 tasks with **hidden acceptance** that has been
verified two ways: every hidden test exits non-zero on its unmodified seed
(`--verify-tasks`), and every seeded repository passes its own visible suite
(`--seed-green`). An invented ad-hoc task has neither property and scores nothing.

```
T0  10 tasks   slugify-ts retry-ts duration-py ledger-py clamp-cpp ring-cpp
               api-docs-ts docstrings-py paths-py dedupe-ts
T1   4 tasks   euler-cli-py snake-board-ts fieldmask-cpp changelog-ts
T2   3 tasks   euler-solvers-py logfmt-lenses-ts textkit-cpp
T3   3 tasks   euler-suite-py snake-game-ts tetris-py
T4   3 tasks   clock-inject-py config-widen-ts bounds-cpp
```

Timeouts per tier: T0 1800s, T1 2700s, T2 3600s, T3 7200s, T4 3600s.

Materialize a task's `seedFiles` into a scratch workspace under
`${TMPDIR}` or a job scratch dir — **never inside this repository** — `git init` it, commit,
and drive conductor against that. Materialize `hiddenFiles` and run `hiddenTestCommand`
only **after** the run has exited. Seeding acceptance into the work tree destroys the
measurement.

---

## The ladder — run these in order, and stop climbing when you learn something

You are looking for **the tier at which the harness stops helping**, so the interesting
information is at the transition, not at the top.

| Step | Task                    | What it is testing                                                                                                                                                                                           |
| ---- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `slugify-ts` (T0)       | The cost floor. This classifies `trivial`, so INTAKE goes straight to EXECUTING and decompose/plan/plan-review/wave scheduler are all skipped. If this does not work, nothing above it will.                 |
| 2    | `changelog-ts` (T1)     | The first run that classifies `work`: one item with a real `fileScope`, so decompose → plan → plan-review → one TDD cycle → review fan-out → publish all execute. Non-behavioral and deliberately ambiguous. |
| 3    | `euler-cli-py` (T1)     | The same path on work with real internal structure and known-correct answers.                                                                                                                                |
| 4    | `euler-solvers-py` (T2) | Multiple items with disjoint scopes — the wave scheduler dispatches in parallel and `scopesIntersect` is exercised for real.                                                                                 |
| 5    | `snake-game-ts` (T3)    | A dependency chain forcing ≥3 waves. Ordering, held jobs, freeze admission. Judge the artifact by playing it.                                                                                                |
| 6    | `config-widen-ts` (T4)  | Work that legitimately needs a file no plan would have put in scope — `conductor_queue_amend`, the scope gate, the surfaced-question path.                                                                   |

**Verify the classification rather than assuming it.** Step 1 must classify `trivial` and
step 2 must classify `work`; step 5 must actually produce ≥3 waves. If a T3 task produces
one wave, that is a finding about the decomposer, and it is more interesting than whether
the task passed.

---

## Running one step

```bash
# Terminal 1 — the server. --router is the default when the binary is present.
/usr/bin/python3 scripts/serve.py qwen3.6-27b          # with llama-router
/usr/bin/python3 scripts/serve.py qwen3.6-27b --no-router   # direct to llama-server
#   ... drops you into a shell with opencode already wired. `cd` to the scratch
#   workspace and run `opencode`.
#
# RUN AT LEAST ONE STEP BOTH WAYS. "The router is transparent to the workflow" is
# a claim, and it is one of the few this campaign can actually falsify cheaply. If
# the two runs differ in outcome, in wave composition, or in strain signals, the
# router is part of the process under test and every other measurement inherits
# that. Compare the bundles, not your impression of them.

# Terminal 2 — the observer. Read-only by construction: a separate process that
# opens files, imports no handler, holds no store, takes no lock, registers no
# hook. Polling a live run is the intended use.
node conductor/tools/observe.ts <workspace>/.conductor/runs/<runId>
```

### Before the model does anything, confirm the harness is actually there

- **The beacon.** `.conductor/state/alive.json` exists and its `pid` is the live plugin
  process. *No beacon, no conductor.* A plugin whose factory throws is logged once on the
  serve log and the session comes up looking entirely normal with every gate absent — so
  "looks normal" is exactly what the failure looks like.
- **The banner.** It rides the session's **first tool result** and reads
  `[conductor 0.1.0 · pid <pid> · <runId> · <model>]`. It is conditional on a tool running;
  a session that calls no tool shows none, and that is measured behaviour, not a fault.
  If the banner is absent *after* a tool ran, that is a real defect — stop.
- **The sub-agent view.** This is the one acceptance criterion no test can reach. Open
  opencode's own session browser and confirm every dispatched sub-session appears **under
  the orchestrator**, labelled by its role agent (`conductor-reviewer`,
  `conductor-implementer`, …) and titled `role[lens]:item`. The automated tests prove the
  API accepts and echoes `parentID` and `agent` and that conductor sends both; only a human
  or a client can confirm it renders. **Report what you actually see, including "I could
  not check this from here."**

---

## The stop-fix-restart loop — the core of this exercise

When you spot something wrong, do **not** finish the run to see how it turns out. A run
that continues past a known defect produces evidence about a system you already know is
broken, and you will be tempted to keep it.

### 1. STOP

Halt the model and the server. Leave the run directory intact — it is the evidence.
Copy it out before doing anything else:

```bash
node conductor/tools/observe.ts <run-dir> --bundle <scratch>/finding-NN/
```

### 2. RECORD, before you fix

Write down, in this order:

- **What you observed**, quoted from the journal, the transcript or the terminal. Not
  paraphrased.
- **Why it is wrong** — which claim it falsifies. Name the file and line, or the doc and
  section, that says otherwise.
- **Which category** it falls in (see below).
- **What you predict the fix will change**, stated so it could be wrong. "The deny rate
  will drop" is not enough. "`gates: deny` for gate `edit` on item I2 will not appear, and
  the item will reach GREEN in one implementer dispatch instead of three" is.

**The prediction is the point.** Without it, a restart that looks better tells you nothing,
because you have no way to distinguish a real correction from run-to-run variance.

### 3. FIX, test-first

This repository's standing rules apply to your fix exactly as they applied to the code you
are fixing:

- **Write the failing test first and see the red.** Quote it.
- **No backwards compatibility.** Delete the old code, update every call site, no shims.
- **Comment hygiene.** No change narration — no "updated", "now", "previously", "fixed",
  "changed". Present tense, describing what the code does and why.
  `conductor/tests/comment-hygiene.test.ts` mechanizes this and will catch you.
- **Core purity.** `conductor/core` imports only relative `.ts` modules resolving inside
  `core`. `conductor/tests/purity.test.ts` mechanizes it — and it is literal, so a
  forbidden token inside a comment trips it too.
- **The gate is the definition of done.** `bash scripts/test-conductor.sh` prints
  `GATE PASS` and `bash scripts/conductor-gate.sh` is clean before you restart.

### 4. RESTART FROM CLEAN

Delete the scratch workspace and re-seed it. Do not restart on top of a `.conductor/`
directory a broken run wrote — you will be measuring the wreckage.

### 5. VERIFY THE PREDICTION

Re-run the **same** step and check the prediction you wrote in (2).

- **Prediction held** → record it, with both bundles, and continue.
- **Prediction did not hold** → this is the important case. The fix did not do what you
  thought, which means your model of the defect was wrong. **Do not adjust the prediction
  to fit.** Say so, keep both records, and re-diagnose. A fix that changes the symptom
  without matching the prediction is a fix you do not understand.
- **The symptom moved somewhere else** → say that too. It is the most common outcome of a
  fix aimed at a symptom rather than a cause.

Repeat until the step runs clean or you conclude the defect is not fixable within this
session — in which case record it as a standing defect with everything you learned.

---

## What counts as a defect

Not just crashes. This repository's own history is a catalogue of things that were green
and wrong. Look for these specifically:

**Built but never wired.** A module that is real, tested, and adjudicates nothing. The
canonical case here was the doctrine injection layer: composed, unit-tested, and registered
nowhere, while 1,382 tests passed. Ask of every mechanism you see working in a test:
*is it on a path a live run takes?*

**A test that passes vacuously.** A pin over an empty set, an assertion that cannot fail, a
guard whose input never arrives. If you doubt one, break the thing it pins and confirm it
goes red. That is cheap and it is the only way to know.

**A doc that describes a system that does not exist** — or code that does something no doc
admits. Both directions. The banner claim was dishonest for months in exactly this way.

**A measurement that cannot distinguish two states.** A signal that reads the same whether
the thing happened or was never recorded. The `logging.level` trap above is a live example:
at `info`, "reached nothing" and "we did not record it" are the same bytes.

**A refusal that can be spelled around.** If a gate denies `curl` but not `env sh -c
"curl …"`, it is not a gate. Try the wrappers. Try `xargs`. Try an interpreter one-liner.
The extractors claim to handle these — check.

**Evidence that is the model's claim wearing a harness's hat.** The system's central
premise is that findings come from handler-owned execution, not from model text. Anywhere a
model's output becomes a record without a handler observing the underlying fact, that
premise has a hole.

**Cost with no benefit at this tier.** Conductor's cost is fixed per run and its benefit is
not. A tier where the process spends six reviewers and two skeptics on work that a single
pass would have got right is not a bug, but it *is* the finding this campaign exists to
produce. Record it as one.

---

## Reading a run

Use the six questions in `docs/developer/observing-a-run.md`, in order. Then the strain
signals, which are the difference between "the model is weak" and "the process is failing":

The thresholds in `conductor/tools/observation.ts` `BREAKDOWN_THRESHOLDS` were committed
**before** this campaign, deliberately, so the analysis cannot be fitted to the result:

| Signal                                                                   | Threshold |
| ------------------------------------------------------------------------ | --------- |
| deny rate                                                                | 0.33      |
| overrides minted / spent                                                 | 2 / 1     |
| review dispatches per item                                               | 3         |
| blocked items                                                            | 2         |
| receipt retries                                                          | 3         |
| sub-session aborts                                                       | 1         |
| disengages / idle continuations                                          | 2 / 5     |
| gate crashes                                                             | 1         |
| largest brief as a fraction of the effective 8,192-token per-slot window | 0.5       |

**A crossed threshold is a finding to investigate, never a stop.** But investigate it — a
crossing you noted and moved past is worse than one you never measured, because it looks
like diligence.

**If you think a threshold is wrong, say so and argue it — do not silently change it.**
A threshold edited mid-campaign to accommodate a result is the exact failure the
commit-before-the-campaign discipline exists to prevent.

---

## Evidence rules — non-negotiable

`conductor/SMOKE.md` is the artifact this produces, and
`scripts/verify-acceptance.sh:143-147` treats a fabricated one as the worst available
outcome, in its own words: *"A live artifact an LLM can fabricate more cheaply than it can
measure is the single worst outcome available to this build."* It requires a command
transcript, not prose.

So:

- **Every command echoed with its exit code.** `; echo "exit code: $?"`.
- **Tool versions captured verbatim**, not recalled.
- **Journal lines quoted**, not paraphrased.
- **Fixtures created outside this repository**, in a scratch directory.
- **Long absolute paths left as they are** rather than prettified.
- The house style is `conductor/docs/RUNNER-DISCOVERY.md`. Match it.

If a step did not run, say it did not run. If you could not check something, say you could
not check it and why. **A gap you name is worth more than a claim you cannot support.**

---

## Deliverables

1. **`conductor/SMOKE.md`** — the 13.2 artifact, written from the real transcript, in the
   house style. Commit message exactly: `conductor: 13.2 live smoke` (row 12 of
   `verify-acceptance.sh` looks for that string, once).
2. **A findings register** — one entry per defect: observation, falsified claim, category,
   prediction, fix, restart result, whether the prediction held. Include the ones you did
   not fix.
3. **A tier verdict** — for each tier you reached: did the process earn its cost, and what
   is the evidence. If you reached a tier where it clearly does not, that is the most
   valuable single output of this exercise.
4. **An assessment of the approach itself.** This is what the exercise is for, and it is
   the deliverable most likely to come back as diplomatic mush. The rules for it are below
   and they are not optional.
5. **A 14.2 go/no-go recommendation.** 14.2 follows this, gated on it. You are the input to
   that decision and you must actually make a call — see below.

---

## Deliverable 4 in full: the assessment, and the rules it is written under

Having watched this harness carry a real model at increasing scope, answer: **what is this
design getting right, what is it getting wrong, and what would you change about how it is
built, tested, validated and documented.**

### Write it under these constraints

**Lead with the strongest criticism you have, not with what works.** If your assessment
opens with praise and buries the problem in paragraph six, you have written a document
designed to be comfortable to receive. Rewrite it.

**No hedged verdicts.** "Could potentially benefit from" and "may be worth considering" are
refusals to judge wearing the costume of judgement. Say the thing: *this is wrong, here is
why, here is what it should be.* If you genuinely do not know, say **"I don't know"** —
that is a real answer and it is worth more than a soft one.

**Name the cost of every recommendation.** A change you propose without saying what it
costs, what it breaks, and who has to do the work is a wish, not advice.

**Argue against yourself once, explicitly.** For your single most important conclusion,
write the strongest counter-argument you can construct — not a strawman, the version an
intelligent person who disagrees would actually make — and then say why you still hold your
position, or that you no longer do. A conclusion that has not survived that has not been
tested.

**Distinguish these four, and never blur them:**
- what you **measured** (a number, a log line, a diff),
- what you **inferred** (a conclusion from measurements, with the inference stated),
- what you **suspect** (a hypothesis you could not test, labelled as one),
- what you are **repeating** from the repository's own documentation without independent
  verification. That last category is the dangerous one, because this repository is
  articulate and its docs are persuasive. Being persuaded by a document is not evidence.

**Judge the process, including the parts that made you look good.** If the gates never fired
during your runs, that is not proof the gates work — it may mean the model never tried
anything they would have caught, which makes them untested rather than validated. Say which.

### Calibration: be honest about what you are not competent to judge

You are a language model scoring the output of a language model, and there are things in
this exercise you are **not reliably able to assess**. Pretending otherwise is the single
most likely way this whole campaign produces a confident, wrong report.

**For every judgement in your assessment, attach a confidence and the reason for it.** Use
three levels and use them strictly:

- **Measured** — I ran a command, read a log, or diffed a tree, and I am reporting what it
  said. State the command.
- **Judged** — I formed an opinion from evidence I can point at, and a competent reviewer
  looking at the same evidence could reasonably disagree.
- **Low confidence / possibly outside my competence** — I am reporting an impression I
  cannot ground, or the question requires a kind of judgement I do not trust myself to make
  here.

**Flag the third category loudly rather than quietly downgrading your language.** In
particular, be sceptical of your own ability to judge:

- **Whether produced code is *good*** as opposed to passing. Pass rates you can measure.
  "Would a person keep this" is a rubric judgement, and you are grading work produced by a
  system very like you, with the biases that implies.
- **Whether a game "feels" right, or a CLI is pleasant to use.** The T3 family exists
  precisely because a human can judge the artifact by using it in thirty seconds. If you
  cannot run it interactively, say the scripted-play assertions are what you have and that
  they are a proxy.
- **Idiomatic quality in a language you are inferring conventions for** — the C++ tasks
  especially, where "correct" and "what this repository would accept" are different bars.
- **Whether a strain-signal crossing is the process failing or the task being hard.** This
  is the central question of the campaign and it is also genuinely hard. Where you cannot
  separate them, say the measurement does not separate them.
- **Whether a threshold is well-chosen.** They were set before the campaign, by a model, on
  reasoning rather than data. You are the first evidence they have ever met. Say whether
  each one looks right, and say plainly when you lack the data to tell.
- **Your own thoroughness.** If you skipped a step, ran fewer repetitions than the design
  asks for, or accepted a result without probing it, put that in the report as a limitation
  of the evaluation rather than leaving it implicit.

**If, at the end, you do not believe this exercise produced a trustworthy assessment — say
that as the headline.** A report that opens "I do not think I was able to evaluate this
properly, and here is why" is a genuinely useful result. A confident report that papers over
the same gap is worse than no report at all, because it will be believed.

---

## Budget, persistence and stopping conditions

**This is a thorough pass, not a quick one.** The owner has explicitly accepted the added
time and work on the grounds that every aspect of this project should be verified as
working as intended. Do not optimise for finishing. Do not skip a step because the previous
one went well. Do not declare a defect unfixable on the second try.

**Up to 10 fix attempts on any single defect** before you record it as standing. Each
attempt owes the full loop — a fresh prediction, a test-first fix, a clean restart, and an
honest verdict on whether the prediction held. Attempt 7 is not permission to guess faster;
if you find yourself trying variations rather than diagnosing, stop and re-read the
evidence bundle instead.

**Up to 10 standing (unfixed) defects** before you stop climbing. Past that the later runs
are measuring a system you already know is broken, and the findings stop being about the
tier you are on.

Stop and report when any of these is true:

- You have completed step 6, or reached a tier where the harness demonstrably breaks down.
- You have 10 standing defects.
- A single defect has survived 10 fix attempts. Write up everything you learned about it,
  including which of your hypotheses each attempt falsified — that record is worth more
  than the fix would have been.
- The gate cannot be brought back to `GATE PASS`. Do not leave it red and continue.

---

## 14.2 is the follow-up, and this exercise is its gate

**14.2 is the three-arm benchmark campaign** — `baseline` (vanilla opencode), `doctrine`
(the doctrine packs, no gates) and `conductor` (the full harness) — same weights, same
server, same machine, same seeded repositories, hidden acceptance materialized only after
each process exits. It produces `docs/build/artifacts/conductor-report.md`, and it is the
measurement everything else exists to enable: 13.2 proves the harness *runs*, 14.2 measures
whether it *helps*.

It has never been run. At three reps across all five tiers it is 207 cells for one model,
roughly 60 hours, and the runbook recommends a **69-cell reps=1 pilot first** to calibrate
the per-tier timeouts from observed medians.

**Do not start it in this session.** Your job is to determine whether it can start.

### What "clean" has to mean, or the gate is worthless

A 60-hour campaign launched onto a harness with a live defect produces 207 cells of
evidence about a broken system, and the defect will be indistinguishable from a finding.
So the bar is explicit, and **every row must hold** for you to recommend GO:

1. `bash scripts/test-conductor.sh` prints `GATE PASS` and `bash scripts/conductor-gate.sh`
   is clean **at the end of your session**, not just at the start.
2. `bash scripts/verify-acceptance.sh` fails **only** rows 6, 8, 12 and detector E. Rows 6
   and 12 should now be closer to passing than when you started, because 13.2's artifact
   exists; rows 8 and detector E remain open until 14.2 runs.
3. **Every tier you reached completed at least one run end to end** — INTAKE through report,
   with the hidden acceptance actually executed after the process exited. A tier you could
   not complete is a tier the campaign has no basis to include.
4. **The classification and wave assertions held**: a T0 task classified `trivial`, a T1+
   task classified `work`, and the T3 task produced ≥3 waves. If decomposition does not
   behave as designed, the tier ladder is not measuring what it claims to.
5. **The read-allow records exist at `debug`.** If they do not, the campaign cannot answer
   its own central question and must not run until that is fixed.
6. **No standing defect that changes what a cell measures.** A cosmetic defect can ship. A
   defect in a gate, in the evidence path, in scoring, or in the seeding is disqualifying,
   because it silently biases every cell.
7. **The router comparison is either clean or declared.** If routed and direct runs differ,
   the campaign must fix the arm definition or state the difference in the report header
   before it runs — not discover it afterwards.

### Say GO, NO-GO, or GO-WITH-CONDITIONS, and mean it

Give one of three verdicts and defend it:

- **GO** — every row above holds. State which model and which sweep shape, and say whether
  you endorse the reps=1 pilot first or think it can go straight to reps=3.
- **GO WITH CONDITIONS** — name each condition, what it costs, and how the owner verifies it
  is met. Conditions must be checkable, not aspirational.
- **NO-GO** — name the specific rows that fail and what it would take to clear them. Give a
  rough size for that work.

**Do not hedge this one.** "It could probably go ahead once a few things are tidied" is not
a verdict, and it hands the decision back to the person who asked you for it. If your honest
answer is that you cannot tell, then the answer is NO-GO with "I could not establish
readiness" as the reason — and say what you would have needed.

Also record, either way: **anything you learned that should change the campaign's design**
— a timeout that is clearly wrong, a tier whose tasks do not test what they claim, an arm
that is not comparable to the others, a strain signal that turned out to be noise. Better to
change the design now than to discover it at cell 140.
