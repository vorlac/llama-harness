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

| Step | Task | What it is testing |
|---|---|---|
| 1 | `slugify-ts` (T0) | The cost floor. This classifies `trivial`, so INTAKE goes straight to EXECUTING and decompose/plan/plan-review/wave scheduler are all skipped. If this does not work, nothing above it will. |
| 2 | `changelog-ts` (T1) | The first run that classifies `work`: one item with a real `fileScope`, so decompose → plan → plan-review → one TDD cycle → review fan-out → publish all execute. Non-behavioral and deliberately ambiguous. |
| 3 | `euler-cli-py` (T1) | The same path on work with real internal structure and known-correct answers. |
| 4 | `euler-solvers-py` (T2) | Multiple items with disjoint scopes — the wave scheduler dispatches in parallel and `scopesIntersect` is exercised for real. |
| 5 | `snake-game-ts` (T3) | A dependency chain forcing ≥3 waves. Ordering, held jobs, freeze admission. Judge the artifact by playing it. |
| 6 | `config-widen-ts` (T4) | Work that legitimately needs a file no plan would have put in scope — `conductor_queue_amend`, the scope gate, the surfaced-question path. |

**Verify the classification rather than assuming it.** Step 1 must classify `trivial` and
step 2 must classify `work`; step 5 must actually produce ≥3 waves. If a T3 task produces
one wave, that is a finding about the decomposer, and it is more interesting than whether
the task passed.

---

## Running one step

```bash
# Terminal 1 — the server. --router is the default when the binary is present;
# run at least one step BOTH ways and compare, because "the router is transparent"
# is a claim this campaign can check.
/usr/bin/python3 scripts/serve.py qwen3.6-27b
#   ... drops you into a shell with opencode already wired. `cd` to the scratch
#   workspace and run `opencode`.

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

| Signal | Threshold |
|---|---|
| deny rate | 0.33 |
| overrides minted / spent | 2 / 1 |
| review dispatches per item | 3 |
| blocked items | 2 |
| receipt retries | 3 |
| sub-session aborts | 1 |
| disengages / idle continuations | 2 / 5 |
| gate crashes | 1 |
| largest brief as a fraction of the effective 8,192-token per-slot window | 0.5 |

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
4. **An assessment of the approach itself** — the thing this prompt is really for. Having
   watched this harness work: what is the design getting right, what is it getting wrong,
   and what would you change about how it is built, tested, validated and documented. Be
   specific and be willing to say the uncomfortable thing.

---

## Stopping conditions

Stop and report when any of these is true:

- You have completed step 6, or reached a tier where the harness demonstrably breaks down.
- You have three unfixed standing defects — more than that and the later runs are measuring
  a system you already know is broken.
- A fix has failed its prediction twice in a row. Your model of the system is wrong and
  more runs will not correct it; write up what you know.
- The gate cannot be brought back to `GATE PASS`. Do not leave it red and continue.

**Do not start the 14.2 campaign.** That is a separate, owner-authorized decision, and the
runbook recommends a reps=1 pilot first to calibrate the per-tier timeouts. Your findings
are an input to that decision, not a substitute for it.
