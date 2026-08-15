# Conductor — Enforcement-Gap Review (run from a fresh, empty-context session)

You are a senior reviewer dropped into an unfamiliar repository with **no prior context**. This is
not a conformance audit. A conformance audit already happened, and the defects that mattered walked
straight past it.

**Your question is narrower and harder:**

> This system exists to make a small, lazy, fallible local model produce high-quality work by
> **never trusting it** — every claim re-derived, every advance re-observed. Where does that
> enforcement fail to be mechanical? And where does the *checking of the enforcement* fail the same
> way?

Everything below serves that. A predecessor prompt,
`docs/reviews/fable-full-and-adversarial-review.md`, ran a full-depth + adversarial review at an
earlier stage; it is still worth skimming for its area checklist, and §B2's closing question is the
best single sentence in it. **Do not re-run it.** Its organizing principle — spec conformance — is
precisely what the surviving defects were invisible to.

---

## 0. Orientation

**"conductor"** is a TDD-enforcing, adversarially-reviewed orchestration harness wrapping
**opencode** (a headless AI coding agent) and a local **llama.cpp** server. Its thesis: extract high
process quality from a *small* model by mechanical enforcement plus multi-agent adversarial review,
rather than by using a bigger model. Two layers:

- **Layer 1 — the TypeScript opencode plugin** (`conductor/`): gates every tool call, drives a run
  FSM and a per-item FSM, dispatches role sub-sessions (classifier, planner, testWriter,
  implementer, reviewer, skeptic, mechanical), injects always-on "doctrine" into each session's
  system prompt, records machine-checkable evidence, and enforces **"your claim is not the record"**
  — every advance re-derived by the harness, never trusted from the model.
- **Layer 2 — the C++ `llama-router`** (`router/`, **not** `src/router/`; the plan's §1.1 layout is
  stale): a fail-soft proxy in front of `llama-server` — admission control, priority/affinity
  scheduling, schema *observation* not enforcement, a metrics ledger. `--no-router` must run the
  identical process (G5).

### The authoritative specification
`docs/plans/2026-08-07-conductor-harness-plan.md` — **Revision 5, 3,399 lines, IMMUTABLE.** Single
source of truth. Never edit it, never tick its checkboxes. Key sections: §1 (architecture, the
invariants **G1–G14**), §2 (schemas, closed vocabularies), §3 (FSMs, gate regime, liveness, no-git
mode), §4 (roles under one model, router semantics), §5 (the opencode wire contract), §6 (doctrine
port map, decision protocol, injection), §7 (logging/debuggability), §8 (the 52-task manifest), §9
(honest limits), §11 (acceptance).

**Read the plan in the ranges you need. Do NOT read it end-to-end** — it will eat your context and
the build ledgers cite the ranges that matter.

### Current state (verified 2026-08-15, do not take on faith — re-check)
- **50 of 52 manifest tasks COMMITTED.** The two open are `13.2` (live smoke → `conductor/SMOKE.md`)
  and `14.2` (a 90-run POC campaign → `docs/build/artifacts/conductor-report.md`). Both need a live
  model and are deliberately unscheduled. **Authoring either by hand is fabrication** — the build's
  stated worst-case failure.
- **Acceptance: 17 PASS / 4 FAIL** (`bash scripts/verify-acceptance.sh`). All four failures are owed
  by those two tasks.
- **Gate: 1,382 node tests, 80 python, typecheck + bun + schema-export legs, GATE PASS.**
- **Phase gates 0–11 PASS. 12, 13, 14, 15 FAIL.** 12's and 13's confirmed MAJORs have since been
  fixed but stage 2 has not re-run; 14 cannot pass until 14.2 exists; 15's ten MAJORs are fixed,
  stage 2 not re-run.
- **`docs/build/CORRECTIONS.md` runs C-001 … C-092** and is the most valuable document in the repo
  after the plan. C-076 onward were written during an intensive defect-hunting campaign and read as
  a field guide to how this system fools itself.

### The build record (`docs/build/`)
`HANDOFF.md` (cold-start summary — read second) · `STATE.json` (per-task machine truth) ·
`GATES.json` (task gates M1–M9 + phase-gate adjudications) · `CORRECTIONS.md` (C-001…C-092) ·
`specs/*.assertions.json` (per-task assertion ledgers) ·
`artifacts/phase-gates-12-13-15-findings.md` (the last full adversarial run, 1,061 lines).

---

## 1. Environment & the traps that have burned people

- **Node 26.7.0** runs TypeScript directly via type-stripping (no build step).
  **TRAP:** never invoke `node --test` for a *verdict* — a directory positional resolves as a bogus
  failing module, and **a zero-match glob exits 0 (a vacuous pass)**. Always gate through:
  ```
  bash scripts/test-conductor.sh              # full: TAP parse + tsc + bun + schema export + python
  bash scripts/test-conductor.sh <one-file>   # scoped, much faster
  ```
  It rejects failing/cancelled/skipped/todo tests and SKIP/TODO TAP directives **at any subtest
  depth** (C-015). You MAY use `node --test --test-reporter=tap <file>` to *read failure messages* —
  never as the verdict.
- **The full gate costs ~90s; the python leg alone is ~40s** (`/usr/bin/python3 -m unittest discover
  -s scripts -p 'test_*.py'`), and a single test file is seconds. Iterate narrow, verify wide.
- **bun 1.3.14** runs the G14 dual-runtime smoke; the gate runs it.
- **C++ router**: `cmake --preset clang-relwdebinfo` then
  `cmake --build .out/build/clang-relwdebinfo --target router-tests llama-router` — **only those
  targets**. A bare `cmake --build` hits the pre-broken `extern/llama-cpp` submodule. `ctest
  --test-dir .out/build/clang-relwdebinfo`. The binary is already built and runs with
  `--config <path> --schema <path>`; it needs no model to start.
- **M5 stub scan:** `bash scripts/conductor-gate.sh`.
- **There is no `timeout` binary on this machine.** `pytest` is `/usr/bin/python3 -m pytest`.

### Rules of engagement — this is a REVIEW
- **Read-only on artifacts.** Do not modify the plan, source, tests, ledgers or config. Scratch
  files go in `$TMPDIR` or the session scratchpad only.
- **NEVER touch `.data/` or `.out/`** — ~20 GB of gitignored, unrecoverable model data and build
  output. Never `git commit`/`push`/`reset --hard`/`clean -x`; never move submodule pointers.
- **You MAY and SHOULD mutate source to test a check** — that is the core method (§3). Snapshot with
  `cp`, restore from the snapshot, prove with `cmp`. **Never `git checkout <file>`** — the tree may
  carry uncommitted work.
- **Kill what you spawn.** Several suites start stub servers and child processes. Before finishing:
  `ps -ax -o pid,etime,command | grep -E "llama-router|fake-llama|time\.sleep" | grep -v grep`.
- If subagents are available, fan out for breadth — but **verify every finding yourself** before
  reporting it. See §7 on why.

---

## 2. The learned defect taxonomy — THIS IS THE SPINE OF THE REVIEW

Thirteen patterns, every one drawn from a defect that **survived** the task gates (M1–M9), the phase
gates, and in one case a unanimous two-skeptic refutation. They are listed with real citations. Hunt
these specifically; a generic review will not find them.

For each pattern below: **find new instances.** The cited ones are fixed. The question is how many
more there are.

### P1 — A check that PASSES while inspecting less than it appears to
**Ten recorded appearances** (C-044…C-047, C-063, C-072, C-075, C-078, C-081 ×2). The signature
defect of this codebase.
- A scanner whose glob matched a subset it was never meant to (M5 missed every `scripts/*.py`).
- A verify command whose glob matched **zero** files, so `node --test` exited 0 and an item reached
  VALIDATED on a process that executed nothing.
- A test-count used as a proxy for a file's contents (the orchestrator's own error, C-084).
**Hunt:** every glob, every scanner, every `grep -c`, every count. Ask each one: *what is the
largest thing this could fail to look at while still reporting success?* Make every scanner report
how much it saw, then check that number against what you meant it to see.

### P2 — The self-referential oracle
C-077. A test asserted a rendered report contained a string it built **by calling the formatter under
test**. Mutate the formatter and both sides of the assertion move together; the suite stays green
while the report lies.
**Hunt:** any assertion of the form `assert(output.includes(f(x)))` where `f` is in the subject.
Every expected value must come from somewhere the subject cannot reach.

### P3 — Two spellings of one fact
The most *frequent* pattern. Confirmed instances: `core/gates-edit.ts` dispatching on `"test-writer"`
while the fan-out registers `"testWriter"` (a gate arm **never once reachable in production**,
C-082) · a doctrine map keyed with `.md` stripped while the loader keys by full filename, making
every pack-gated dispatch refuse (C-083) · `UNIVERSAL_META_TOOLS` restating four names
`gates-phase.ts` owns (C-086) · a `queueEntry` zod shape restating core's `QueueItem` (C-081) · the
`verify-running-<tree>.json` filename (C-081).
**Hunt:** every literal that appears in two files. Every enum, role name, filename, path, glob,
schema key, env var. For each: which file OWNS it, and does the other DERIVE it or RESTATE it? A
restatement with no drift guard is a defect even while the two copies agree.

### P4 — A function whose name asserts a property it does not implement
C-081: `liveVerifyTrees` returned every marker **file present**, while the verify path honours a
marker only when `pidAlive(pid) && !overAge`. Two definitions of "live", one seam apart — a crashed
run would have wedged a tree forever, the exact thing the verify path's own comment promises cannot
happen.
**Hunt:** read function names as claims. `isValid`, `isLive`, `ensureX`, `verifyY`, `assertZ`.
Does the body implement the claim, or a cheaper approximation?

### P5 — A happy-path test cannot prove a validator is in the path
C-081. A test drove real ops through the real bound tool against a real store and asserted a real
amendment was applied — and stayed **20 pass / 0 fail** with core's validator bypassed entirely,
because it only ever fed well-formed input. What a validator uniquely provides is **refusal**.
**Hunt:** for every validator/parser/guard, find the test that feeds it something it must REJECT. If
there isn't one, the validator can be deleted and nothing notices.

### P6 — A guard firing is not the guarded thing arriving
C-091. Breaking a doctrine lookup key turned a scenario red — but only because the product's own
guard refused to dispatch without doctrine. That proves *the guard fires*, not *the doctrine reaches
the sub-session*. The sharper mutation satisfies the guard with wrong content and lets the dispatch
happen.
**Hunt:** when a mutation goes red, ask **which** assertion caught it. If a precondition guard caught
it, the downstream property is still unproven.

### P7 — Individually-correct rules composing into a hole
C-085, the sharpest defect found. Three rules, each right in isolation: a blocked dependency is
deliberately not "stuck" (so report correctly refuses) · the dependent isn't schedulable (so nothing
is recommended) · the continuation engine returns without prompting when nothing is recommended
(reasoning soundly that counting a non-prompt as a futile re-prompt would be a lie). Net: a run that
**can never exit and can never be detected**, sitting in EXECUTING forever — precisely the wedge §3.7
exists to end, and the one shape it could not see.
**Hunt:** the seams *between* correct components. For each terminal/exit/escalation path, construct
the state where every guard says "not mine" and ask who is left holding it.

### P8 — An acceptance row that is unreachable or self-contradictory
C-083: a row demands both "round 2 is clean" and "planReviewRounds persists as 2", but that counter
counts *revisions*, so a clean round after one revision persists 1 — the product cannot satisfy both
phrasings. C-084: spec SG-4 prescribes a queue shape (blocked item + dependent) that the product
**cannot reach**, so the row it was written for is unsatisfiable as written.
**Hunt:** read assertion rows as specifications and ask whether the product can satisfy every clause
*simultaneously*. A row nobody can satisfy is worse than a missing row — it will be "satisfied" by a
weakened test.

### P9 — Evidence that is a tautology
C-089. The G5 router-equivalence artifact recorded two "arms" that were **the same command run
twice**, differing only by an env var (`CONDUCTOR_OPENAI_BASE_URL`) that `grep` finds in no source
file. And the e2e it invoked had no router touchpoint at all, so even a wired variable would have
changed nothing. A recorded proof of a property, proving nothing.
**Hunt:** every artifact under `docs/build/artifacts/`. For each recorded comparison: were the two
things actually different? Does anything read the variable that distinguishes them? Could the
recorded run have produced that output without the property holding?

### P10 — The review machinery producing a false negative and then sealing it
**The most serious pattern, because it is meta.** C-082: the `testWriter`/`test-writer` defect was
found once, escalated to skeptics, **refuted unanimously**, and recorded as *"is recorded in C-032 so
it is not re-litigated."* It was true the whole time. The refutation failed because the plan uses
`test-writer` 17 times **in English prose** and `testWriter` 5 times **as an identifier**; the
skeptics matched on frequency and concluded the contract named it.
**Generalised lesson, now in C-082:** *when checking code against a spec's identifier, count only
identifier positions.* A hyphenated English form of the same concept usually outnumbers it.
**Hunt:** re-open every refuted finding in `GATES.json` and `CORRECTIONS.md`. Ask what evidence the
skeptics used and whether it distinguishes prose from contract. Any "do not re-litigate" note is a
place to look hardest.

### P11 — Untested-but-correct behaviour
C-090. Three behaviours worked and nothing would have noticed them breaking: a health probe reached
by no test (a `return True` stub survived), a terminate grace with a floor and no ceiling (3600s
passed), a type guard nothing exercised (`derive_slots(True)` would silently return 1 slot).
**Hunt:** for each constant, guard and helper — mutate it and see if anything goes red. This is
cheap and it is the only way to find these.

### P12 — A path nothing has ever walked
C-091: the DEBUG loop had never executed end-to-end because no scenario ever took a red validate, so
`debugFixCap` could be set to 0 with the entire build green. C-083: three of four correction loops
were likewise unwalked.
**Hunt:** enumerate every branch that requires an *unusual* precondition (a failure, a cap, a
timeout, a second attempt, a degraded mode). For each, find the test that reaches it. Most will not
have one.

### P13 — A named test that does not prove its row
C-092. Splitting one scenario into per-row named tests exposed **three rows with nothing behind
them at all** — including one where *nothing would change colour if `mark_green` stopped re-running
the item test*, which is the load-bearing "the handler measured it, not the model" property.
**Hunt:** `docs/build/specs/*.assertions.json` rows vs test titles. For every row that IS named, read
the row's full text and the test's assertions side by side and ask which clauses are actually
asserted. Naming without proving is worse than not naming — it converts a visible gap into an
invisible one.

---

## 3. Method — what actually worked

**Mutation testing performed by the reviewer, not delegated.** Nearly every defect above was found
by breaking the code on purpose and watching what stayed green. A subagent's report of "it's green"
or its mutation table is **never** evidence — re-run the load-bearing mutation yourself.

The loop:
1. Pick a property the system claims to enforce.
2. Break the code that enforces it (`cp` snapshot first).
3. Run the gate.
4. **If it stays green, you have found something.** If it goes red, note *which* assertion caught it
   (see P6) — then restore from the snapshot and `cmp`.

**Prefer reproductions over assertions.** A finding survives only if you triggered the wrong
behaviour against real code, or can point at the exact spec clause violated. When you *cannot* break
something you suspected, record the failed attempt — that is evidence it holds, and it is a valid
result.

**Report, do not fix.** You are reviewing. If you find yourself needing to change the plan, a §2
schema, a closed vocabulary or a G-invariant to make something work — that is a finding about the
design, not a change to make.

---

## 4. Part A — The enforcement audit (the central question)

For **every point** where the model reports something, determine whether the harness **knows** or
merely **believes**:

- test went red · test went green · review passed · classification · decision · plan revised ·
  finding refuted · item published · run complete.

For each: does the harness independently re-derive it — run the child process, parse the TAP,
re-read the diff, validate against the registered schema, re-run the skeptic — or does it accept the
model's word? Cite `file:line`. Where enforcement is merely **advisory** (the model could route
around it), say so plainly. That is the failure mode that matters most.

Then the question the predecessor prompt asked, which is still the right one:

> **If a competent-but-lazy local model were run inside this harness today, at which specific points
> could it produce plausible-looking but unverified work that the harness would accept as real?**
> Enumerate them with `file:line`.

Specific things to attack:
- **RED-before-GREEN.** The plan claims skipping is *structurally* impossible. Construct a path to
  GREEN without a genuine harness-observed RED: a test that errors instead of failing, a stub
  satisfying one assertion, a test weakened to make a finding disappear, a red observed against a
  different subject than the one that goes green.
- **Doctrine delivery (§6.4/G9).** Each of the 7 roles must receive its §4.1 pack *every request*.
  Note P6: verify the doctrine ARRIVES, not merely that a guard refuses without it. Nine packs live
  in `conductor/doctrine/`.
- **The override hatch (§3.6).** Can a model spend its way around a gate? Is the budget bounded, and
  does exhaustion truly stop the run rather than converting into another override?
- **The gate snapshot.** `plugin/index.ts`'s `tool.execute.before` derives `fileScope`, `testScope`
  and `verifyInFlightTree` per call (recently fixed — C-082). Verify the derivation is correct for
  every role and both tree modes, and that failure derives NO scope (which denies) rather than a
  permissive default.

---

## 5. Part B — The verification audit

Turn the review on the checks themselves. For every gate, scanner, guard and acceptance meter:

1. **Can it fail?** Mutate what it checks. If nothing goes red, it is decorative.
2. **Does it inspect what it claims?** (P1) Make it report its own coverage and compare.
3. **Is its expected value independent of its subject?** (P2)
4. **Does it test refusal, not just acceptance?** (P5)
5. **Which assertion catches the mutation?** (P6)

Named targets: `scripts/test-conductor.sh` · `scripts/conductor-gate.sh` (M5) ·
`scripts/verify-acceptance.sh` (the 21 acceptance rows) · the M1–M9 task gate as recorded in
`GATES.json` · `conductor/tests/legaltools-callsites.test.ts` · `journal-vocab.test.ts` ·
`tool-binding.test.ts` · `g5-artifact-check.ts`.

**Specifically re-derive a sample of the build's own gate claims.** Pick a task from `STATE.json`,
apply its `revertAssertion`, and confirm the suite goes red exactly as recorded. Pick a security
test and confirm it fails when you weaken the gate.

---

## 6. Part C — Vocabulary, reachability, composition

- **Vocabulary (P3).** Build the inventory: every closed enum, role name, tool name, journal event,
  stop kind, filename, env var, glob. For each, name the OWNER and list every other site. Flag every
  restatement without a drift guard.
- **Reachability (P12).** Enumerate every branch requiring an unusual precondition and find its
  test. Report the ones with none.
- **Composition (P7).** For every terminal/exit/escalation path, construct the state where each
  guard says "not mine." Who is left holding it? Does the run end with an artifact, or go quiet?
- **Acceptance rows (P8, P13).** Read `docs/build/specs/*.assertions.json` against the tests. Which
  rows are unreachable? Which are self-contradictory? Which are named by a title that does not prove
  them? Phase 13's `task-13.1.assertions.json` is known to be 22/42 named with four rows proven by
  nothing — treat that as a floor, not a total.

---

## 7. Part D — The meta-audit (can this review machinery be fooled?)

The build's quality rests on task gates, phase gates, blind lens fan-out, and skeptic panels with a
tie-upholds ladder. **It has produced at least one confirmed false negative and sealed it** (P10).

- Re-open the refuted findings in `GATES.json` and `artifacts/phase-gates-12-13-15-findings.md`. For
  each: what evidence settled it, and does that evidence actually discriminate?
- Can "empty findings = approval" be gamed? What does a lens that finds nothing look like versus one
  that *ran* and found nothing?
- The adjudication ladder upholds on a tie. What happens when both skeptics share the same blind
  spot — as they did in C-032, where both matched prose for contract?
- Do the phase gates verify that a fix round's author is not the same agent that closes the gate?

---

## 8. Part E — Simulate the adversary

Be the lazy model. With the doctrine packs in front of you as your only instructions, try to:
- reach PUBLISHED with the least real work,
- make a review finding disappear rather than fixing it,
- satisfy an acceptance row's letter while violating its intent,
- produce a plausible artifact for a step you did not perform.

Then judge: **would a 32k-context local model plausibly parse and follow these packs?** Are they too
long, too abstract, mutually contradictory? Which instruction would it drop first under context
pressure? This is a real question about the thesis, not a rhetorical one.

---

## 9. Known-open — do not spend time re-deriving these

So you go deeper rather than re-finding what is already recorded:
- **13.2 and 14.2** are unbuilt and need a live model. The four failing acceptance rows are theirs.
- **Phase gates 12, 13, 15** are recorded FAIL; their confirmed MAJORs are fixed but stage 2 has not
  re-run. Gate 14 cannot pass until 14.2 exists.
- **Phase 13 M7:** 22/42 rows named; four rows (`mark-green-handler-runs-the-test`,
  `validate-quarantined-stamped`, `report-real-closing-verify`, `freeze-denies-test-file-edit`) are
  proven by nothing. Twelve more are partial and carry inline `// NOT proven here:` comments.
- **Multi-ecosystem `requiredScopes`** covers the repo's paths *at setup time*; a file with a new
  extension added later is uncovered until `reconfigure:true` (C-088, with the reasoning for why a
  true catch-all was unavailable).
- **The §3.3 reverted-behavior probe** is exercised by nothing — it skips because the fileScope file
  is untracked at review time (C-091).

**If you find any of the above is *worse* than recorded, that is a finding.** The records are the
build's own claims and inherit its blind spots.

---

## 10. Output — a planning-grade issue register

**The primary deliverable is a COMPLETE, DEEPLY DETAILED LIST OF EVERY ISSUE FOUND**, written so
that the next phase of work can be planned and scheduled directly from it without anyone re-deriving
your reasoning. Narrative sections support that list; they do not replace it.

Write to `docs/reviews/2026-08-15-enforcement-gap-findings.md` — **the one file you may create
outside scratch.** Publish as a shareable artifact too if you can.

### 10.1 The issue register (the core of the document)

**Every** issue gets its own numbered entry with all of the fields below. Do not summarise, do not
merge distinct issues to save space, and do not drop small ones — a nit that takes ten minutes is
still a scheduling input. Assume the reader is planning work and has *not* read the rest of your
report.

```
### ISSUE-NNN — <one-line title stating the defect, not the area>

Pattern:        P1–P13 (or NEW — name and define it)
Severity:       MAJOR | MINOR | NIT | DOCUMENTED-LIMIT
Confidence:     REPRODUCED | STRONG (read-verified) | SUSPECTED (say what would settle it)
Location:       file:line  (every relevant site, not just the first)
Subsystem:      e.g. gate regime / fan-out / state store / router / doctrine / build ledger

WHAT THE SYSTEM CLAIMS
  The plan clause, invariant (G1–G14), assertion row, comment or test title that asserts this
  property — quoted, with its citation.

WHAT IT ACTUALLY DOES
  The mechanism, precisely, at file:line. Explain it so a reader who has never opened the file can
  follow the failure without re-reading the source.

REPRODUCTION
  Exact commands and/or the exact mutation, copy-pasteable, with the observed output. If you could
  not reproduce it, say so and mark Confidence accordingly.

BLAST RADIUS
  What actually goes wrong in a real run, and how a human would experience it. Include what is
  NOT affected — bounding the damage is as useful as stating it.

WHY NOTHING CAUGHT IT
  Which gate, test or review should have caught this and why it did not. This field is often the
  most valuable one in the entry: it is where the systemic fix lives.

FIX DIRECTION
  The shape of the fix, not the fix. Name the options and the tradeoffs you can see. Explicitly flag
  any fix that would require changing the plan, a §2 schema, a closed vocabulary or a G-invariant —
  those are design decisions, not fixes.

VERIFYING MUTATION
  The specific mutation that MUST turn red once this is fixed, and that is green today. This build
  has learned that a fix without one of these is not finished. Be precise enough to run.

EFFORT / DEPENDENCIES
  Rough size (single edit / one round / multi-round restructure), what must land first, and what
  this unblocks. Flag anything that needs a live model — those cannot be scheduled freely.
```

### 10.2 Planning views over the register

After the register, give these — each one just references ISSUE-NNN ids, no re-explanation:

1. **By severity**, then within severity **by what a lazy model would exploit first.**
2. **By subsystem**, so work can be batched by the file it touches.
3. **By dependency order** — what must land before what, and which clusters are independent enough
   to run in parallel.
4. **Systemic clusters:** groups of issues that share ONE root cause, where a single structural
   change closes several. These are the highest-value items and the register's field
   `WHY NOTHING CAUGHT IT` is where you will find them.
5. **Requires-a-live-model**, separated out — it cannot be scheduled with the rest.
6. **Cleared areas:** what you attacked and could NOT break, with what you did. A genuinely cleared
   area is a real result and it stops the next person re-spending the effort.

### 10.3 Supporting sections

1. **Executive verdict** (≤1 page). Does the enforcement hold? Where does the harness believe rather
   than know? Would the "process quality from a small model" thesis survive contact with a real lazy
   model today? Your confidence and what most affects it.
2. **The enforcement enumeration** (§4) — every point the harness trusts the model, with citations.
   Cross-reference to ISSUE ids where a gap became an issue.
3. **The verification audit** (§5) — every check you mutated and whether it could fail, as a table.
4. **The meta-audit** (§7) — refuted findings you re-opened and what you concluded.
5. **The adversary simulation** (§8) — what you got away with, step by step.
6. **Honesty audit** — any fabricated evidence, or an explicit statement that you found none, naming
   what you checked (commit shas, live-task records, gate claims, recorded artifacts).

### 10.4 Standards for the register

**Write it explanatory.** The per-issue structure is for organisation and planning, not a licence to
be terse. Each field is PROSE — full sentences that teach the mechanism to someone who has never
opened the file. A reader should finish an entry understanding *why* the defect exists and *why it
was invisible*, not merely that it is there. Terse field notes are a failure of this deliverable even
if every field is filled in.

Two things follow from that, and they are in tension only apparently:

- **Completeness is not a reason to compress.** Record every issue, and write each one fully. If the
  document gets long, that is the correct outcome — it is a planning input for weeks of work, not a
  summary.
- **Length is not a substitute for evidence.** A paragraph of speculation is worth less than two
  sentences plus a reproduction. Explain mechanisms at length; state findings exactly.

Also:

- **Every entry must be actionable by someone else, alone.** If a reader cannot start work from the
  entry without asking you a question, it is not finished.
- **Write for iteration.** These will be worked one at a time, out of order, possibly weeks apart, by
  someone without your context. Say what state the tree must be in, what to read first, and what
  "done" looks like.
- **A SUSPECTED entry is welcome** — but it must say exactly what evidence would settle it, so it can
  be scheduled as an investigation rather than an argument.
- **Record failed refutations.** "I tried to break X these four ways and could not" belongs in
  *Cleared areas*, with the four ways named.
- **No issue is too small.** Ten-minute fixes still get a full entry; they are the cheapest wins and
  they are the ones that get lost.

### 10.5 A worked entry — the standard, using an already-fixed defect

This is C-082, already fixed, reproduced here ONLY to show the depth and voice expected. Your entries
will describe new findings; match this level of explanation.

```
### ISSUE-007 — The edit gate's test-writer arm has never been reachable in production

Pattern:        P3 (two spellings of one fact), compounded by P10 (a sealed false negative)
Severity:       MAJOR
Confidence:     REPRODUCED
Location:       conductor/core/gates-edit.ts:235 (the arm) · conductor/adapter/tools.ts:2991,
                :3143, :3600 (the registered role) · docs/build/STATE.json (the sealing note)
Subsystem:      gate regime / §3.5 edit scope

WHAT THE SYSTEM CLAIMS
  Plan §3.5:1392-1393 requires that implementer and test-writer sessions may edit only inside their
  assigned scope — "test-writer: the item's `testScope` only" — and gates-edit.ts:235 implements
  that as a dedicated dispatch arm. Assertion row 13.1-s1-freeze-denies-test-file-edit depends on
  the arm being reachable.

WHAT IT ACTUALLY DOES
  The arm tests `sessionRole === "test-writer"`. The fan-out engine has always registered that
  session as `"testWriter"` and persists that spelling into askedBy.role. A role matching NO arm
  falls through to gates-edit.ts:249's unknown-role fail-safe, which denies everything. So the arm
  enforcing "an implementer may not edit test files, and a test-writer may not edit source" has
  never executed against a real session. `"implementer"` matches on both sides, which is exactly why
  only this one role stayed silently dead — the neighbouring arm worked, so nothing looked broken.

REPRODUCTION
  $ grep -n '"test-writer"' conductor/core/gates-edit.ts     # :235, the only source occurrence
  $ grep -n 'role: "testWriter"' conductor/adapter/tools.ts  # :2991 and others
  Then drive a registered testWriter session through the gate and observe the deny reason is the
  unknown-role fail-safe, not the testScope arm.

BLAST RADIUS
  The implementer/test-writer separation is unenforced for the test-writer direction: the specific
  protection that a test-writer cannot edit source is absent. NOT affected: the implementer arm,
  which matches correctly, and normalizeUnderTree, which independently denies paths outside the
  session tree — so this is a scope-separation hole, not a filesystem-wide one.

WHY NOTHING CAUGHT IT
  Three reasons, and the third is the important one. (a) No production path populated the registry
  with a sub-session entry until the tools were bound, so the arm had no caller to be wrong for.
  (b) The unit tests fed the gate the hyphenated spelling directly, so they exercised the arm with a
  role production never produces. (c) The defect WAS found once, escalated to skeptics, and refuted
  unanimously — "the string the diff uses is the one §3.3 and the pinned contract name" — then
  recorded as "so it is not re-litigated". The refutation failed because the plan uses `test-writer`
  17 times in ENGLISH PROSE and `testWriter` 5 times as an IDENTIFIER; the skeptics matched on
  frequency rather than on position.

FIX DIRECTION
  Rename, do not translate. `"testWriter"` is the production vocabulary and the plan's identifier
  spelling (plan:1185, the §3.3 routing table at 1259-1260, the role table at 1523), so core is the
  outlier. A translation table at the composition root was considered and rejected: it would be a
  THIRD site for one fact. Test-side occurrences of the old spelling are mechanical respellings of
  the role VALUE only — no assertion or title should change.

VERIFYING MUTATION
  Rename the role in either file alone. A guard must go red that derives BOTH sets at run time — the
  roles gates-edit dispatches on, and the roles the fan-out actually registers — and requires every
  gate role to be one the fan-out produces. Green today: no such guard exists.

EFFORT / DEPENDENCIES
  One-line production change plus ~10 test-side respellings; one round. Depends on the tool binding
  landing first, since without it no session carries a role into the gate at all. Unblocks
  13.1-s1-freeze-denies-test-file-edit. No live model needed.
```

**One closing instruction.** Every defect in §2 was invisible to a review that asked "does the code
match the spec?" and visible to one that asked "what would still be green if this were broken?" Ask
the second question.
