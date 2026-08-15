# Conductor Review — Shared Briefing

**Read this in full before starting any of the three reviews.** It is the common ground: what the
system is, how to run it, the rules, the defect taxonomy learned from 92 recorded corrections, the
method that actually finds things, and what is already known.

The three reviews reference this file rather than restating it. That is deliberate — restating one
fact in three places is defect pattern **P3** below, and these documents are not exempt from their
own lessons.

---

## 0. What this repository is

**"conductor"** is a TDD-enforcing, adversarially-reviewed orchestration harness wrapping
**opencode** (a headless AI coding agent) and a local **llama.cpp** server. Its thesis: extract high
process quality from a *small, fallible* model by mechanical enforcement plus multi-agent adversarial
review, rather than by using a bigger model.

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
`docs/plans/2026-08-07-conductor-harness-plan.md` — **Revision 5, 3,399 lines, IMMUTABLE.** Never
edit it; never tick its checkboxes. Key sections: §1 (architecture, invariants **G1–G14**), §2
(schemas, closed vocabularies), §3 (FSMs, gate regime, liveness, no-git mode), §4 (roles under one
model, router semantics), §5 (the opencode wire contract), §6 (doctrine port map, decision protocol,
injection), §7 (logging/debuggability), §8 (the 52-task manifest), §9 (honest limits), §11
(acceptance).

**Read all of it.** Earlier agents were told to read only cited ranges because they were implementing
under cost pressure. You are not. A reviewer who has not read the specification cannot judge
conformance to it, and several defects in the record exist precisely because someone matched a
string in prose against a contract that used a different identifier (see **P10**).

### Current state — verified 2026-08-15, re-verify rather than trusting
- **50 of 52 manifest tasks COMMITTED.** Open: `13.2` (live smoke → `conductor/SMOKE.md`) and `14.2`
  (a 90-run POC campaign → `docs/build/artifacts/conductor-report.md`). Both need a live model and
  are deliberately unscheduled. **Authoring either by hand is fabrication** — the build's stated
  worst-case failure.
- **Acceptance: 17 PASS / 4 FAIL** (`bash scripts/verify-acceptance.sh`). All four are owed by those
  two tasks.
- **Gate: 1,382 node tests, 80 python, plus typecheck, bun and schema-export legs. GATE PASS.**
- **Phase gates 0–11 PASS; 12, 13, 14, 15 FAIL.** 12's and 13's confirmed MAJORs have since been
  fixed but stage 2 has not re-run; 14 cannot pass until 14.2 exists; 15's ten MAJORs are fixed,
  stage 2 not re-run.
- **`docs/build/CORRECTIONS.md` runs C-001 … C-092.** After the plan, it is the most valuable
  document here. C-076 onward were written during an intensive defect-hunting campaign and read as a
  field guide to how this system fools itself.

### The build record (`docs/build/`)
`HANDOFF.md` (cold-start summary) · `STATE.json` (per-task machine truth: status, commitSha, tap
counts, redEvidence, deviations) · `GATES.json` (task gates M1–M9 and phase-gate adjudications) ·
`CORRECTIONS.md` (C-001…C-092) · `specs/*.assertions.json` (per-task assertion ledgers) ·
`artifacts/phase-gates-12-13-15-findings.md` (the last full adversarial run, 1,061 lines).

---

## 1. Environment — how to actually run things

- **Node 26.7.0** runs TypeScript directly via type-stripping; no build step.
  **TRAP:** never invoke `node --test` for a *verdict* — a directory positional resolves as a bogus
  failing module, and **a zero-match glob exits 0 (a vacuous pass)**. Always gate through:
  ```
  bash scripts/test-conductor.sh              # full: TAP parse + tsc + bun + schema export + python
  bash scripts/test-conductor.sh <one-file>   # scoped
  ```
  It rejects failing/cancelled/skipped/todo tests and SKIP/TODO TAP directives **at any subtest
  depth** (C-015). You MAY use `node --test --test-reporter=tap <file>` to *read failure messages* —
  never as the verdict.
- Full gate ~90s. Python leg alone ~40s:
  `/usr/bin/python3 -m unittest discover -s scripts -p 'test_*.py'`. A single file is seconds.
- **bun 1.3.14** runs the G14 dual-runtime smoke; the gate runs it.
- **C++ router**: `cmake --preset clang-relwdebinfo`, then
  `cmake --build .out/build/clang-relwdebinfo --target router-tests llama-router` — **only those
  targets**. A bare `cmake --build` hits the pre-broken `extern/llama-cpp` submodule. Test with
  `ctest --test-dir .out/build/clang-relwdebinfo --output-on-failure`. The binary is already built,
  takes `--config <path> --schema <path>`, and needs no model to start.
- **M5 stub scan:** `bash scripts/conductor-gate.sh`.
- **Acceptance meter:** `bash scripts/verify-acceptance.sh`.
- **There is no `timeout` binary on this machine.** `pytest` is `/usr/bin/python3 -m pytest`.

---

## 2. Rules of engagement

- **Read-only on artifacts.** Do not modify the plan, source, tests, ledgers or config as a
  *deliverable*. Scratch files go in `$TMPDIR` or your session scratchpad.
- **NEVER touch `.data/` or `.out/`** — ~20 GB of gitignored, unrecoverable model data and build
  output. Never `git commit`/`push`/`reset --hard`/`clean -x`; never move submodule pointers.
- **You MAY and MUST mutate source to test a check** — that is the core method. Snapshot with `cp`,
  restore from the snapshot, prove with `cmp`. **Never `git checkout <file>`** — the tree may carry
  uncommitted work.
- **Kill what you spawn.** Several suites start stub servers and child processes. Before finishing:
  `ps -ax -o pid,etime,command | grep -E "llama-router|fake-llama|time\.sleep" | grep -v grep`
- **Report, do not fix.** You are reviewing. If a fix seems obvious, record it as a fix *direction*.
  If you find yourself needing to change the plan, a §2 schema, a closed vocabulary or a
  G-invariant to make something work, that is a finding about the design, not a change to make.

---

## 3. The learned defect taxonomy — P1 through P13

Thirteen patterns, every one from a defect that **survived** the task gates (M1–M9), the phase
gates, and in one case a unanimous two-skeptic refutation. The cited instances are fixed. **Your job
is to find the ones that are not.**

### P1 — A check that PASSES while inspecting less than it appears to
**Ten recorded appearances** (C-044…C-047, C-063, C-072, C-075, C-078, C-081 ×2). The signature
defect of this codebase. A scanner whose glob matched a subset it was never meant to (M5 missed every
`scripts/*.py`). A verify command whose glob matched **zero** files, so `node --test` exited 0 and an
item reached VALIDATED on a process that executed nothing. A test-count used as a proxy for a file's
contents.
**Hunt:** every glob, scanner, `grep -c`, count. Ask each: *what is the largest thing this could fail
to look at while still reporting success?*

### P2 — The self-referential oracle
C-077. A test asserted a rendered report contained a string it built **by calling the formatter under
test**. Mutate the formatter and both sides move together; the suite stays green while the report
lies.
**Hunt:** any `assert(output.includes(f(x)))` where `f` is in the subject. Every expected value must
come from somewhere the subject cannot reach.

### P3 — Two spellings of one fact
The most *frequent* pattern. `gates-edit.ts` dispatching on `"test-writer"` while the fan-out
registers `"testWriter"` — a gate arm **never once reachable in production** (C-082). A doctrine map
keyed with `.md` stripped while the loader keys by full filename, making every pack-gated dispatch
refuse (C-083). `UNIVERSAL_META_TOOLS` restating four names `gates-phase.ts` owns (C-086). A
`queueEntry` zod shape restating core's `QueueItem` (C-081). The `verify-running-<tree>.json`
filename (C-081).
**Hunt:** every literal appearing in two files — enums, role names, filenames, paths, globs, schema
keys, env vars. For each: which file OWNS it, and does the other DERIVE or RESTATE it? A restatement
with no drift guard is a defect *even while the copies agree*.

### P4 — A function whose name asserts a property it does not implement
C-081: `liveVerifyTrees` returned every marker **file present**, while the verify path honours a
marker only when `pidAlive(pid) && !overAge`. Two definitions of "live" one seam apart; a crashed run
would have wedged a tree forever.
**Hunt:** read function names as claims — `isValid`, `isLive`, `ensureX`, `verifyY`. Does the body
implement the claim or a cheaper approximation?

### P5 — A happy-path test cannot prove a validator is in the path
C-081. A test drove real ops through the real bound tool against a real store and asserted a real
amendment was applied — and stayed **20 pass / 0 fail** with core's validator bypassed, because it
only ever fed well-formed input. What a validator uniquely provides is **refusal**.
**Hunt:** for every validator/parser/guard, find the test that feeds it something it must REJECT. If
none exists, the validator can be deleted and nothing notices.

### P6 — A guard firing is not the guarded thing arriving
C-091. Breaking a doctrine lookup key turned a scenario red — but only because a precondition guard
refused to dispatch without doctrine. That proves *the guard fires*, not *the doctrine reaches the
sub-session*. The sharper mutation satisfies the guard with wrong content.
**Hunt:** when a mutation goes red, ask **which** assertion caught it. If a precondition guard did,
the downstream property is still unproven.

### P7 — Individually-correct rules composing into a hole
C-085, the sharpest defect found. Three rules, each right alone: a blocked dependency is deliberately
not "stuck" (so report correctly refuses) · the dependent isn't schedulable (so nothing is
recommended) · the continuation engine returns without prompting when nothing is recommended
(reasoning soundly that counting a non-prompt as a futile re-prompt would be a lie). Net: a run that
**can never exit and can never be detected**, sitting in EXECUTING forever — precisely the wedge §3.7
exists to end, and the one shape it could not see.
**Hunt:** the seams *between* correct components. For every terminal/exit/escalation path, construct
the state where every guard says "not mine" and ask who is left holding it.

### P8 — An acceptance row that is unreachable or self-contradictory
C-083: a row demands both "round 2 is clean" and "planReviewRounds persists as 2", but that counter
counts *revisions*, so the product cannot satisfy both. C-084: spec SG-4 prescribes a queue shape the
product **cannot reach**.
**Hunt:** read rows as specifications; ask whether the product can satisfy every clause
simultaneously. A row nobody can satisfy is worse than a missing row — it gets "satisfied" by a
weakened test.

### P9 — Evidence that is a tautology
C-089. The G5 equivalence artifact recorded two "arms" that were **the same command run twice**,
differing only by an env var that `grep` finds in no source file. And the e2e it invoked had no
router touchpoint at all.
**Hunt:** every artifact under `docs/build/artifacts/`. Were the two compared things actually
different? Does anything read the variable that distinguishes them? Could the recorded output have
been produced without the property holding?

### P10 — The review machinery producing a false negative and then sealing it
**The most serious pattern, because it is meta.** C-082: the `testWriter`/`test-writer` defect was
found, escalated to skeptics, **refuted unanimously**, and recorded as *"is recorded in C-032 so it
is not re-litigated."* It was true the whole time. The refutation failed because the plan uses
`test-writer` 17 times **in English prose** and `testWriter` 5 times **as an identifier**; the
skeptics matched on frequency, not position.
**Generalised lesson:** *when checking code against a spec's identifier, count only identifier
positions.* The English form of a concept usually outnumbers it.
**Hunt:** re-open every refuted finding in `GATES.json` and `CORRECTIONS.md`. Any "do not
re-litigate" note is a place to look hardest.

### P11 — Untested-but-correct behaviour
C-090. Three behaviours worked and nothing would have noticed them breaking: a health probe reached
by no test (a `return True` stub survived), a terminate grace with a floor and no ceiling (3600s
passed), a type guard nothing exercised (`derive_slots(True)` would silently return 1 slot).
**Hunt:** for each constant, guard and helper — mutate it and see if anything goes red.

### P12 — A path nothing has ever walked
C-091: the DEBUG loop had never executed end-to-end because no scenario ever took a red validate, so
`debugFixCap` could be 0 with the entire build green. C-083: three of four correction loops likewise.
**Hunt:** enumerate every branch requiring an *unusual* precondition — a failure, a cap, a timeout, a
retry, a degraded mode, a second attempt — and find the test that reaches it.

### P13 — A named test that does not prove its row
C-092. Splitting one scenario into per-row named tests exposed **three rows with nothing behind them
at all** — including one where *nothing would change colour if `mark_green` stopped re-running the
item test*, the load-bearing "the handler measured it, not the model" property.
**Hunt:** rows vs test titles. For every named row, read the row's full text and the test's
assertions side by side. Naming without proving converts a visible gap into an invisible one.

---

## 4. Method — what actually finds things

**Mutation testing performed by you, not delegated.** Nearly every defect above was found by breaking
the code on purpose and watching what stayed green. A subagent's report of "it's green", or its
mutation table, is **never** evidence — re-run the load-bearing mutation yourself.

The loop:
1. Pick a property the system claims to enforce.
2. Break the code that enforces it (`cp` snapshot first).
3. Run the gate.
4. **If it stays green, you have found something.** If it goes red, note *which* assertion caught it
   (P6), then restore from the snapshot and `cmp`.

**Prefer reproductions over assertions.** A finding survives only if you triggered the wrong
behaviour against real code, or can cite the exact clause violated. When you *cannot* break something
you suspected, record the failed attempt — that is evidence it holds and a valid result.

**Adversarially verify your own findings before filing.** For each candidate, try to refute it —
construct the reading under which the code is right. File it only if you cannot, and record the
failed refutation in the entry. Note P10: this project's own skeptic panel produced a confirmed false
negative by accepting a plausible refutation. Yours can too.

**Use subagents for breadth, never for verdicts.** Fan out to cover territory; verify every finding
yourself before it enters a register.

---

## 5. Exhaustiveness — the standing instruction for all three reviews

**There is no token budget, no time limit, and no page limit.** These reviews are intended to be run
**once**, and to find everything, so that the work they drive can be planned in full rather than
discovered piecemeal across repeated passes. Optimise for completeness, not for economy.

Concretely, this inverts guidance that appears elsewhere in this repository:

- **Read whole files.** Earlier agent briefs said "never read `tools.ts` whole" — that was cost
  discipline for implementers, and it does not apply to you. `conductor/adapter/tools.ts` is 9,253
  lines; read all of it, in sections, tracking coverage. Same for the 3,399-line plan and every test
  file.
- **Repo-wide greps are encouraged.** Earlier briefs forbade them. Here they are a primary tool.
- **Do not summarise to save space.** If an entry needs 800 words to be actionable, write 800 words.
- **Do not stop early because you have "enough" findings.** There is no target count and no ceiling.
- **Nothing is a permitted casualty.** Do not trade one section's depth for another's.

**Completion criterion — the review is done when, and only when:**
1. Every item in every mandatory enumeration has an explicit verdict (including "not examined").
2. Every source file in scope has been covered, and the coverage ledger says so file by file.
3. Every claim you make is either reproduced, cited to a clause, or explicitly marked as
   lower-confidence with the evidence that would settle it named.

If you run low on context, **do not compress** — write your findings out to the register file
incrementally as you go, so the work survives, and keep going.

---

## 6. The three reviews and how they fit together

Run **sequentially**. Each consumes the previous outputs.

| # | Prompt | Lens | Method | Produces |
|---|---|---|---|---|
| 1 | `2-enforcement.md` | micro — does enforcement hold? | mutation testing, enumeration | `ISSUE-NNN` |
| 2 | `3-macro.md` | macro — is the shape right? | measurement, clustering, breadth | `MACRO-NNN` |
| 3 | `4-capability.md` | absent — what would raise the floor? | synthesis over 1 and 2 | `GAP-NNN` + the consolidated plan |

**Why this order.** Enforcement produces the factual substrate (the enumerations, the mutation table,
the reproduced defects). Macro argues from that evidence rather than from taste. Capability grounds
every proposal in a specific observed failure from 1 or 2 — which is what keeps it from becoming a
wish list.

**Seam findings — the one real risk of splitting.** The wedge (C-085) was found *because* enforcement
work surfaced a composition problem. Findings that fall between lenses must not be lost. So: **when
you notice something outside your lens, do not chase it and do not drop it — file a one-line pointer
in your register's `CROSS-LENS POINTERS` section**, naming which review owns it. The macro review and 3 each
begin by reading the previous registers' pointers and treating them as leads.

**One ID space.** `ISSUE-`, `MACRO-`, `GAP-` and `IDEA-` prefixes never collide, so all registers
merge into one plan. Always cross-reference by id.

### 6.1 The complete spectrum — every category has an owner

The three lenses must together cover **everything**, with nothing falling between them. This table
assigns every category of finding. If you encounter something that fits nowhere below, that is
itself a finding: record it as an `IDEA` (§6.2) and say explicitly that the taxonomy did not
anticipate it.

| Category | Owner | Notes |
|---|---|---|
| Enforcement gaps (harness believes rather than knows) | **R1** | the spine |
| Ordinary correctness bugs — wrong logic, off-by-one, bad glob, wrong branch | **R1** | not every defect is about model trust; R1 owns plain bugs too |
| Test quality — vacuous, self-referential, happy-path-only, unreachable | **R1** | P1, P2, P5, P6, P12, P13 |
| Security — shell parsing, path traversal, git command gating, scope escape | **R1** | attack it directly; the build claims DENY + documented residuals |
| Concurrency, races, deadlock, leaks — fan-out, watchdog, locks, fds, processes | **R1** | includes resource leaks; one fd leak is already recorded in C-087 |
| Crash-safety and recovery — torn writes, stale locks, quarantine replay | **R1** | simulate crashes, don't reason about them |
| The C++ router (`router/`) — admission, SSE pass-through, metrics, fail-soft | **R1** | build it, run ctest, read it against §4.4; explicitly in scope |
| Build-record honesty — claims vs reality, fabricated evidence | **R1** | P9; check shas, artifacts, gate claims |
| Spec conformance — code vs the immutable plan, clause by clause | **R1** | with P10's warning: identifier positions, not prose |
| The review machinery itself — gates, skeptic ladder, false negatives | **R1** | P10, the meta-audit |
| Architecture, layering, responsibility boundaries | **R2** | |
| Navigability for a small model — file sizes, discoverability, context cost | **R2** | measured, not asserted |
| Design coherence — competing philosophies, duplicated concepts, wrong abstractions | **R2** | |
| The build process as a designed thing — gate regime, correction clustering | **R2** | |
| Documentation accuracy and sufficiency — operator docs, honest limits, comments | **R2** | phase 15 exists because these drift |
| Operator experience — what a human sees when things go wrong | **R2** | |
| Fitness for what comes next — live model contact, growth, second contributor | **R2** | |
| Missing mechanisms that would raise the floor on a lazy model | **R3** | grounded in R1/R2 findings |
| Doctrine efficacy — will a 32k model actually follow these packs | **R3** | |
| Structural-vs-advisory upgrades — making the wrong thing impossible | **R3** | |
| Anything else that would improve this system | **all three** | file an `IDEA` immediately |

### 6.2 IDEA entries — so no improvement is lost

**Every review may file `IDEA-NNN` at any time**, and should. Not every good thought is a defect, a
structural problem or a missing mechanism. A clearer error message, a test that would be easier to
maintain, a naming change, a small ergonomic win, a "this would have saved me an hour" observation —
all of it is planning input and all of it gets lost if there is nowhere to put it.

The bar is deliberately low: **if you thought it was worth thinking, it is worth recording.** Keep
the entry short unless it deserves length.

```
### IDEA-NNN — <the improvement, in one line>

Origin:     what you were doing when you thought of it (this context is often the value)
Kind:       polish | ergonomics | naming | docs | test-maintainability | tooling | other
Value:      what gets better, and for whom (a human operator? a future agent? a reviewer?)
Cost:       rough
Relates to: ISSUE/MACRO/GAP ids if any, else "standalone"
```

Do not agonise over whether something is an `IDEA` or an `ISSUE`. **File it somewhere rather than
nowhere**; the consolidation pass in the capability review reclassifies. The failure mode to avoid is a good
observation discarded because it did not fit a category.

**Output files** (each review writes exactly one; these are the only files you may create outside
scratch):
- `docs/reviews/conductor-review/findings-enforcement.md`
- `docs/reviews/conductor-review/findings-macro.md`
- `docs/reviews/conductor-review/findings-capability.md`

---

## 7. Known-open — recorded, so you go deeper rather than re-finding

- **13.2 and 14.2** are unbuilt and need a live model. The four failing acceptance rows are theirs.
- **Phase gates 12, 13, 15** are recorded FAIL; their confirmed MAJORs are fixed but stage 2 has not
  re-run. Gate 14 cannot pass until 14.2 exists.
- **Phase 13 M7:** 22/42 rows named; four (`mark-green-handler-runs-the-test`,
  `validate-quarantined-stamped`, `report-real-closing-verify`, `freeze-denies-test-file-edit`) are
  proven by nothing. Twelve more are partial and carry inline `// NOT proven here:` comments.
- **Multi-ecosystem `requiredScopes`** covers the repo's paths *at setup time*; a file with a new
  extension added later is uncovered until `reconfigure:true` (C-088, including why a true catch-all
  was unavailable).
- **The §3.3 reverted-behavior probe** is exercised by nothing — it skips because the fileScope file
  is untracked at review time (C-091).

**If any of the above is *worse* than recorded, that is a finding.** These records are the build's own
claims and inherit its blind spots.

---

## 8. A closing note on posture

Every defect in §3 was invisible to a review that asked *"does the code match the spec?"* and visible
to one that asked *"what would still be green if this were broken?"*

Ask the second question, everywhere, and do not stop asking it because a section is finished.
