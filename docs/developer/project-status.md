# Project status

Where the conductor build actually is, what is being built next, and what is known to be
imperfect. Every other page in this set describes the system as designed; this page is the
one that tells you how much of it exists. Read it before you trust anything else.

Status shown here is grounded in [`docs/build/STATE.json`](../build/STATE.json),
[`docs/build/GATES.json`](../build/GATES.json) and
[`scripts/verify-acceptance.sh`](../../scripts/verify-acceptance.sh). Where this page and
those three disagree, they win — they are machine-checked and this page is prose.

## How to read this page

Four artifacts carry build truth, and they do not carry it equally.

| Artifact                                                                                           | What it is                                                                                                              | How much to trust it                              |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [`docs/build/STATE.json`](../build/STATE.json)                                                     | Machine truth. One row per task: status, commit, TAP counts, red evidence, files touched, revert assertion, deviations. | Authoritative for task status.                    |
| [`docs/build/HANDOFF.md`](../build/HANDOFF.md)                                                     | The boot document. What was just done, what is next, live traps, deferred obligations.                                  | Authoritative for the queue and for warnings.     |
| [`docs/plans/2026-08-07-conductor-harness-plan.md`](../plans/2026-08-07-conductor-harness-plan.md) | The specification. 3399 lines, revision 5, **immutable** — never edited, never ticked.                                  | Authoritative for design intent, not for reality. |
| [`scripts/verify-acceptance.sh`](../../scripts/verify-acceptance.sh)                               | The §11 acceptance checklist as an executable script. Twelve rows plus six hollowness detectors.                        | Authoritative for "is the project done".          |
| `git log --grep 'conductor: '`                                                                     | The task list that actually happened. One commit per manifest task.                                                     | Authoritative for "did this land".                |

Two conventions matter when reading `STATE.json`:

- **`commitSha` is backfilled.** A task row is written in the same commit as the task, so
  the row cannot know its own sha. The next `STATE.json` touch fills it in. Until then,
  `git log --grep` on the row's `commitMessage` is the authoritative lookup. The
  convention is recorded in `meta.convention.commitSha`.
- **Three commit prefixes.** `conductor:` marks a manifest task. `conductor-build:` marks
  orchestrator infrastructure — gate fixes, sha backfills, in-progress markers — and is not
  a task. `conductor-fix:` marks work from the correction campaign that follows the
  manifest, driven by [`docs/build/fix-campaign-plan.md`](../build/fix-campaign-plan.md)
  with a per-item record in [`fix-campaign-log.md`](../build/fix-campaign-log.md).

Where the plan and the code disagree, the code wins and the difference is recorded, never
edited into the plan. See [Recorded deviations from the plan](#recorded-deviations-from-the-plan).

## Phase status

The manifest holds 52 tasks. `STATE.json` carries 57 rows: the manifest tasks plus five
non-manifest ones added along the way — `5.4`, `5.4a`, `12.1-G5`, `13.1-composition-root`
and `13.1-composition-root-CR2`.

**55 of the 57 rows are `COMMITTED`. Two are `NOT_STARTED`: `13.2` and `14.2`.** Both need a
live model, and the repo owner is holding both back to be scheduled deliberately. Nothing
else in the build is outstanding.

| Task   | What it needs                                                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `13.2` | An attended live smoke: real opencode against the smoke model, recorded to `conductor/SMOKE.md`, with retry counts and the non-behavioral path exercised. |
| `14.2` | The POC campaign: three arms, three repetitions, committed as `docs/build/artifacts/conductor-report.md`.                                                 |

Neither can be written without running it. `verify-acceptance.sh` refuses a live artifact
under 20 lines or without a verbatim command transcript, for exactly that reason: an
artifact a model can fabricate more cheaply than it can measure is the worst outcome
available to this build.

The work ran on two branches. The **spine** — the TypeScript plugin, Phases 0-10 and 12-15 —
was strictly serial. **Branch B** — the C++ router, Phase 11 — ran in parallel, because it
depends only on task 1.1's schemas and task 0.2's streaming finding. Branch B ran on `main`
rather than in a worktree, because the submodules are already populated there and C++ files
never overlap `conductor/*.ts`; the rationale and the CMake surgery are in
[`docs/build/branch-b-plan.md`](../build/branch-b-plan.md).

For per-task detail — the commit, the TAP counts at commit, the red evidence, the files
touched, the revert assertion and any deviations — read that task's `STATE.json` row. This
page does not duplicate it, because a duplicate is a copy that drifts.

## Where the gate stands

The gate at `HEAD`, from [`docs/build/HANDOFF.md`](../build/HANDOFF.md):

| Leg               | Result        |
| ----------------- | --------------- |
| node `--test`     | 1811 / 1811     |
| `tsc --noEmit`    | OK              |
| bun smoke         | 8 pass          |
| Python `unittest` | 86 tests        |
| Schema export     | OK              |
| `ctest` doctest   | 94 / 94 cases   |

Those numbers move with every commit; re-run `bash scripts/test-conductor.sh` rather than
quoting them. Note that CMake registers exactly one ctest test — the whole doctest binary —
so "94" counts doctest cases, not ctest tests. The counts that hold still are structural: 86
test files under `conductor/tests/`, nine doctrine packs, 19 exported JSON Schemas, 92
entries in the corrections ledger.

`scripts/verify-acceptance.sh` produces 21 verdicts — 15 checklist verdicts (several §11
rows split into an `a` and a `b` half) and six hollowness detectors. Four fail, and all four
are the same two tasks: **row 6** wants `conductor/SMOKE.md` (13.2), **row 8** wants
`docs/build/artifacts/conductor-report.md` (14.2), **row 12** finds their two commit
messages missing from `git log`, and **detector E** is the union of the two absent
artifacts. Run in a fresh worktree, row 3 also fails environmentally — `.out/` is
gitignored, so there is no build tree there, and configuring one needs `extern/vcpkg`,
which a worktree does not carry; in the main tree that row is green.

**Acceptance does not pass, and must not be described as passing.**

## What works today

Things you can run right now, on this machine, and get a real result:

- **The whole model harness.** `./setup.sh`, `scripts/fetch_models.py` (list, info,
  install, verify, remove, status, config, build, serve), `scripts/serve.py`, and
  `scripts/benchmark.py` are built and in daily use. See
  [`scripts/README.md`](../../scripts/README.md).
- **Conductor itself.** `scripts/serve.py` launches `llama-server`, the router and its
  supervisor, then execs a shell whose `OPENCODE_CONFIG` loads the plugin. `--no-router`
  runs the identical workflow without layer 2.
- **The conductor test suite.** `bash scripts/test-conductor.sh` runs the node TAP suite
  over 86 test files, then `tsc --noEmit`, then the Bun dual-runtime smoke, then regenerates
  the JSON Schemas into `router/tests/schemas/`, then the Python `unittest` leg.
- **The mechanical stub scan.** `bash scripts/conductor-gate.sh` scans committed TypeScript,
  C++ and Python source for stub markers, skipped or todo tests, trivially-true assertions,
  and empty catch blocks — each language half under a file-count floor so a glob that stops
  matching is a failure rather than a clean-looking pass.
- **The standing mutation suite.** `node conductor/tools/audit-mutation-suite.ts` applies a
  corpus of known mutations to the audit layer and asserts each is caught, with one negative
  control proving the runner can tell caught from survived.
- **Schema export.** `conductor/tools/export-schemas.ts` writes 19 JSON Schemas into the
  gitignored `router/tests/schemas/`.
- **Replay.** `node conductor/tools/replay.ts <runDir>` renders a run's journal into a
  deterministic plain-text timeline, with `--component`, `--level` and `--item` filters.
- **The router build and suite.** `cmake --build .out/build/clang-relwdebinfo --target
  llama-router` produces a binary that runs; `--target router-tests` plus `ctest` runs the
  doctest leg. Build only named targets — see [build system](build-system.md).
- **Acceptance.** `bash scripts/verify-acceptance.sh` in a clean worktree of `HEAD` reports
  the §11 checklist and the hollowness detectors, and exits non-zero until the two live
  tasks land.

What has not happened: **no attended live run.** Everything above is exercised against unit
tests, a fake SDK, stub servers and fixture repos. Three live measurements exist and none of
them is a conductor run: the runner-discovery probe in
[`conductor/docs/RUNNER-DISCOVERY.md`](../../conductor/docs/RUNNER-DISCOVERY.md), the
upstream contract in [`router/UPSTREAM_CONTRACT.md`](../../router/UPSTREAM_CONTRACT.md),
and the router live smoke in `docs/build/artifacts/11.8-live-smoke.md`.

## What is next

1. **Task 13.2 — the attended live smoke.** Instrumented, with a preflight go/no-go check in
   [`conductor/core/preflight.ts`](../../conductor/core/preflight.ts) to run first. It is
   attended by design: someone watches it happen and the transcript is what gets recorded.
2. **Task 14.2 — the POC campaign**, whose posture decisions are gated on what 13.2
   measures. `scripts/conductor_bench.py` (task 14.1) is the driver and is committed.
3. **Two decisions the owner holds.** Whether to split `conductor/adapter/tools.ts`, and
   what to do about the collision described under [Honest limits](#honest-limits) between
   two plan-verbatim limits and the behavior at `HEAD`.

Three traps are recorded in the handoff, each because it already produced a wrong result
once: an empty review result can mean the lenses **crashed**, not that the diff is clean;
a subagent can return an "it's done" result having made zero edits; and fan-out multiplies
cost — one 79-agent burst consumed roughly 5.7M tokens in 22 minutes because each agent
re-read the 3399-line plan independently.

## Recorded deviations from the plan

The plan is immutable. Its checkboxes are never ticked, because checkbox state dies under
`git restore`, conflicts across workers, and makes the specification mutable (C-001).
Deviations are *recorded* instead — in [`CORRECTIONS.md`](../build/CORRECTIONS.md), in the
`deviations[]` array of the task's `STATE.json` row, and in `HANDOFF.md` when they change
how future work is done. Three user-directed layout deviations supersede plan §1.1:

| Plan §1.1 says           | Reality                 | Note                                                                                                                       |
| ------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/router/`            | `router/`               | The C++ tree sits at the repo root. `src/main.cpp` is `router/main.cpp`.                                                    |
| `src/router-tests/`      | `router/tests/`         | The CMake **target** is still named `router-tests` — it is the ctest name every gate row cites. Only the directory moved.  |
| `src/tools/`             | `tools/`                | Beside `router/`, not inside it: `membench` is a measurement probe that links neither the router nor its libraries. See [`tools/README.md`](../../tools/README.md). |
| schemas beside the tests | `router/tests/schemas/` | Generated by `export-schemas.ts`, gitignored, regenerated by every run of the test wrapper.                                 |

And one rule that the plan does not state at all:

> **Include rule.** Every in-workspace header is included by its full path from the **repo
> root** — `#include "router/version.hpp"`, never `#include "version.hpp"`. The root is the
> only user-code include root on every C++ target, so an include names where the header
> actually lives regardless of which file includes it.

## Deferred bindings and standing obligations

A binding is an obligation discovered by one task's review that a *later* task must satisfy.
Bindings are written into the owning task's assertions file (as a `phaseGateNBindings` block)
and mirrored in `HANDOFF.md`, so the task cannot be built without meeting them. Every owner
task in the manifest is committed, so the manifest's bindings are discharged; the obligations
still standing are these, and each is tracked by a mechanism rather than by memory.

| Obligation                                                                                                              | Where it is tracked                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Twelve committed tasks carry no `GATES.json` M1-M9 record: ten of them are Phases 12-15, which committed after the ledger stopped emitting task rows, plus `0.1` and `5.4a`. | `KNOWN_MISSING_GATE_RECORD` in [`gate-record-completeness.test.ts`](../../conductor/tests/gate-record-completeness.test.ts). The register is self-cleaning: a task that gains a record must leave it, so it cannot rot into a standing excuse. |
| Roughly 795 assertion-spec row dispositions are unfilled.                                                               | The `UNCOVERED` register in [`row-title-bijection.test.ts`](../../conductor/tests/row-title-bijection.test.ts), whose `[not-stale]` half fails the day a listed row gains a test. They are **not** backfilled from memory: a disposition nobody observed is a fabrication. |
| Build-discovered honest limits — residual git-command detection gaps, the text-only failure classifier, the production-scoped stub scan. | [`docs/build/honest-limits-pending.md`](../build/honest-limits-pending.md), an accumulator the shipped [`HONEST-LIMITS.md`](../../conductor/docs/HONEST-LIMITS.md) draws from. |
| Two live-launch items in `serve.py`: a signal trap and a main-launch test.                                              | `HANDOFF.md`.                                                                                                                         |

The pattern to notice is that none of these is "someone will remember". Each is a register a
test reads, and each register fails the day its entry stops being true.

## The corrections ledger

[`docs/build/CORRECTIONS.md`](../build/CORRECTIONS.md) is append-only. It holds 92 entries,
`C-001` through `C-092`, each in a fixed shape: the plan quote with line numbers, the
observed reality as an exact command and its output, the decision taken, the alternatives
considered, and the blast radius.

Alongside it sit the three review registers under
[`docs/reviews/conductor-review/`](../reviews/conductor-review/) — `ISSUE-`, `MACRO-` and
`GAP-` numbered — which are the evidence authority for the correction campaign that follows
the manifest. `GATES.json` records 44 task gates, 17 phase gates, three self-tests and 11
rejections.

A correction id is a citation, not a filing category. It appears in commit messages
(`conductor-build: M5 marker scan scoped to production source (C-026)`), in the
`deviations[]` of a `STATE.json` row, and in `HANDOFF.md`. When you find a surprising rule
in this codebase, the id attached to it is where its justification lives.

What the ledger records, in aggregate, is that the adversarial gates keep finding real
defects that a large green suite did not:

- The Phase 5 security milestone ran against a 710-test green suite and closed **eight**
  real holes across two fix rounds: four bypasses from the security lens, one spec
  under-block, and three residuals the orchestrator's own 33-input attack battery found
  after the first fix round.
- The Phase 8 gate found two doctrine packs loaded and cached but injected into **zero**
  sessions — dead weight that every unit test was happy with.
- Task 9.2's pre-commit review found 19 surviving defects, two major, that 873 passing
  tests missed: the item size budget was wired to `trivialMaxFiles` (default 2) instead of
  the spec's larger bound, so every three-file item was rejected under the default config;
  and acceptance clustering broke on any criterion beginning with "the".
- Task 9.3's review, throttled to two lenses and majors-only skeptics, found five majors,
  including a plan review that could pass having dispatched zero reviewers.

The gate regime is itself audited. Every gate record names what it *rejected*, and a phase
gate that has rejected nothing across three phases is reported as suspected gate weakness.
The mechanical checks are self-tested by deliberately breaking each one and confirming it
catches the break.

## Honest limits

These are the fifteen limits from plan §9, copied verbatim into
[`conductor/docs/HONEST-LIMITS.md`](../../conductor/docs/HONEST-LIMITS.md). They are
normative, and no page in this set may contradict them.

**Two of them do not describe the code, and that collision is unresolved.** The plan is
immutable and the limits are pinned to it verbatim, so neither the plan nor the pinned text
can be edited to match; the discrepancy is recorded here instead and is one of the decisions
the owner holds.

| Limit | What it says                                                           | What the code does                                                                                                                                        |
| ----- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8     | A second conductor session in one workspace "gets a read-only conductor" | `openWorkspace` **refuses**: a live young lock holder ends the open and the second session gets no store at all, rather than a demoted one whose write guards covered a fraction of the mutating surface. |
| 11    | "The liveness beacon and the banner make that visible"                   | The beacon is written and read. The **visible session banner is not wired**, so the beacon file and the opencode log are the whole of the check.            |

Read the two limits below with those corrections in hand.

1. **Gates fire inside opencode.** A human at a terminal, or any process outside the
   plugin's sight, is ungated. Operational security is out of scope.
2. **There is no pre-emptive turn-end gate in opencode.** Continuation is idle-driven
   re-entry; between the turn ending and the re-prompt, the model has "stopped", and the
   disengage backstop bounds the failure mode.
3. **Ledgers are records, not proofs.** Every FSM-advancing record is written by a handler
   that re-derived the evidence itself, so the only fabrication path is
   `conductor_override` — which is loud, tainted, and reported.
4. **The router's schema guard validates non-streaming JSON only.** Streamed structured
   outputs pass with a warning; the fan-out engine's receipt validation covers them.
5. **Model quality is a floor, not a gate.** A 27B reviewer upholding garbage findings
   costs fix-loop rounds; the skeptic layer and round caps bound the damage, and the
   Phase 14 bench measures it rather than assuming it away.
6. **`scopesIntersect` is conservative.** False positives serialize work that could have
   parallelized; they never corrupt. A scope declared too wide serializes honestly, and an
   implementer editing outside its scope is denied.
7. **Verify trusts the target repo's own test command.** Vacuous tests get vacuous
   protection; TEST_VETTED exists to raise that floor for the tests the pipeline writes.
8. **Two conductor sessions sharing one workspace**: the second gets a read-only conductor
   via the run-directory lock, and a dead holder's lock is broken automatically. The lock
   is advisory, and a human deleting it lies to both sessions.
9. **The router observes; it never enforces.** Its schema check is a recorded observation,
   not a rejection — a request the direct path would have served is never failed by the
   router. Response observation covers non-streaming bodies only.
10. **macOS on Apple Silicon only for the POC.** Nothing gratuitously breaks Linux;
    nothing verifies it either.
11. **Conductor cannot detect its own absence.** If opencode fails to load the plugin,
    every gate is silently absent and the session looks normal. The liveness beacon and
    the banner make that *visible*; nothing makes it *impossible*. No banner, no conductor.
12. **A second, plain opencode session in the same repo is ungated.** The harness travels
    via `OPENCODE_CONFIG` in the shell `serve.py` spawns; any other terminal running
    `opencode` there has no plugin, takes no lock, and is invisible — while the conductor
    session's freshness stamps, quarantine moves, and freeze windows race it.
13. **In-session interpreters bypass the write-shape extractor.** `node -e`, `python -c`
    and friends write files without matching any redirect, tee, or sed pattern. The edit
    gate catches shapes, not intent; the journal records the command either way.
14. **`behavioral: false` is only as honest as `behavioralPaths`.** The path arithmetic is
    mechanical, but the path list is human-confirmed at setup. A repo that lists `src/**`
    while keeping its logic in `lib/**` has handed the model a legal TDD bypass — which is
    why setup asks rather than defaults.
15. **Single-model routing is a POC constraint, not a finding.** Running every role on one
    model makes the quality delta attributable to process, and costs whatever a larger
    reviewer would have added.

Limits discovered during the build — residual git-command detection gaps, the text-only
failure classifier, and the production-scoped stub scan — accumulate in
[`docs/build/honest-limits-pending.md`](../build/honest-limits-pending.md), which the shipped
document draws from alongside the fifteen.

## Explicitly out of scope

Plan §10. These are not unbuilt work items; they are deliberately outside the base build.

| Stretch item                                                | Why it is deferred                                                                                                                                                                                                                |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-role model routing plus swap batching                   | Needs a Phase 14 number to compare against, so the added quality is measured rather than assumed. The pair is deferred together because neither pays off alone, and under `--models-max 1` a role switch is a full weight reload. |
| Mutation-smoke on TEST_VETTED                               | Additive to the vetting stage; the plan records no rationale beyond scope.                                                                                                                                                        |
| Seal and tamper-evidence over conductor's own files         | Lower value for a single user — this repository's git history is the audit trail.                                                                                                                                                 |
| Cross-run memory (decision-ledger reuse across runs)        | Additive; the plan records no rationale beyond scope.                                                                                                                                                                             |
| Linux support and CI                                        | The POC targets macOS on Apple Silicon (limit 10).                                                                                                                                                                                |
| Streaming schema observation in the router                  | The router's schema guard covers non-streaming bodies only (limit 4); task 0.2 found that opencode streams, which is what shrank task 11.6.                                                                                       |
| Multi-machine fan-out (a second Mac serving a second model) | Additive; the plan records no rationale beyond scope.                                                                                                                                                                             |

## The acceptance checklist

Plan §11, as [`scripts/verify-acceptance.sh`](../../scripts/verify-acceptance.sh) executes
it. Run the script rather than reading this table for a verdict — the table says what each
row checks, the script says whether it holds today.

| Row | What it checks                                                                                                                                | Standing |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | The node suite green through the canonical wrapper, over at least 24 test files (there are 86)                                                | PASS     |
| 2   | `bun test conductor/tests/bun-smoke.test.ts` green — the production runtime exercised, not assumed                                             | PASS     |
| 3   | `ctest` on `router-tests` green                                                                                                               | PASS in the main tree; fails in a worktree, which has no submodules |
| 4   | Purity, dual-runtime and doctrine guards green                                                                                                | PASS     |
| 5   | Scripted e2e green, all five scenarios named in the actual TAP output: greenfield red, trivial, worktree wave, non-behavioral item, and the blocked/stop-report/next-run-unpoisoned ending | PASS |
| 6   | Live smoke recorded in `conductor/SMOKE.md`, mentioning retries and the non-behavioral path                                                    | **FAIL — 13.2 not run** |
| 7   | Runner-discovery probe recorded, justifying the quarantine's out-of-repo location by measurement                                               | PASS     |
| 8   | POC report committed as `docs/build/artifacts/conductor-report.md`: three arms, three repetitions, per-task spread                             | **FAIL — 14.2 not run** |
| 9   | `serve.py` offers `--router`/`--no-router`, and the G5 equivalence artifact records both arms reaching the same terminal state                 | PASS     |
| 10  | `--parallel`, `admission.maxInflightPerModel` and the per-slot `--ctx-size` all derive from one number, checked over several reader counts     | PASS     |
| 11  | `OPERATIONS.md` and `HONEST-LIMITS.md` exist, and the limits document carries as many numbered limits as plan §9 does                          | PASS     |
| 12  | Every manifest commit message appears in `git log` exactly once                                                                               | **FAIL — 13.2 and 14.2 have no commit** |

Row 1 is written in the plan against raw `node --test`; the script runs it through
`bash scripts/test-conductor.sh` instead, for the reasons in C-005 and in
[testing and verification](testing-and-verification.md).

Six hollowness detectors sit alongside the rows, for what a green suite cannot see: every
§1.1 module exists, is non-empty and is imported by a test (A); all nine doctrine packs are
present and non-trivial (B); every router module exists and is non-empty (C); the M5 stub
scan is clean (D); all five live artifacts are present (E — **FAIL**, the two above are
missing); and the upstream contract's verification stamp is real rather than `<pending>`
(F).

## The build process itself

This repository is built by an orchestrator agent following
[`docs/conductor-build-orchestrator-prompt.md`](../conductor-build-orchestrator-prompt.md).
The process is deliberately the discipline conductor itself enforces, applied by hand one
level up. Four mechanisms do the work.

**Per-task assertion specs.** Before a task starts, its enumerated behaviors are extracted
from the plan into `docs/build/specs/task-<id>.assertions.json`, one row per behavior with
its plan line. That file is what makes "did we build what was asked" mechanically checkable
at gate M7, and it is where deferred bindings and resolved spec gaps are recorded.

**A strict red-green-gate-commit loop.** Assertions spec, in-progress marker, test-writer
subagent, orchestrator observes the red, implementer subagent, orchestrator observes the
green, task gate, diff read, revert assertion, commit. The orchestrator classifies the red
with the plan's own three-way rule — `assertion` and `missing-subject` are legal reds,
`error` is not — and a subagent's report that something is red or green is never accepted
as evidence. Only the orchestrator commits, which is what guarantees the gate runs.

**A nine-check task gate (M1-M9)**, run before every commit: green TAP counts, pass-count
monotonicity, typecheck, **red re-derivation from the commit** (remove the implementation
files in a scratch worktree and prove the tests go red again), the stub scan, diff scope,
assertion coverage, live-artifact integrity for manual tasks, and the language legs
(`ctest`, `python3 -m unittest`). M4 is the heart of it: it proves the tests are
load-bearing rather than decorative.

**Adversarial phase gates** at every phase boundary. Stage 1 is mechanical and includes a
fresh-worktree run of the full green gate — the highest-value single check against work
that only passes because of uncommitted files or a wrong-cwd glob. Stage 2 fans out review
lenses in fresh contexts, none of them shown the others' findings, the implementer's
reasoning, or the orchestrator's summary; anchoring is the failure being designed against.
Findings are adjudicated cheapest-first — triage, then a probe that turns the finding into
a failing test or a mutation, then skeptics only for the unprobeable. Fix rounds are capped
at three; at the cap the phase is parked and its findings are written to the handoff.

Two authoring-time adversarial reviews of the plan itself are kept in
[`docs/reviews/`](../reviews/), alongside the full-system review under
[`docs/reviews/conductor-review/`](../reviews/conductor-review/) whose three registers drive
the correction campaign. The orchestrator prompt and `HANDOFF.md` are the current
statements of build process.

**The trust premise underneath all of it**, which is what the correction campaign is
arranged around: trust lives in the harness, not in the orchestrator. Any prompter should
get a self-defending result, from local models only. That is why the audit layer above is
adversarial toward conductor's own code rather than only toward the code conductor reviews.

## See also

- [Testing and verification](testing-and-verification.md) — the canonical test gate and why
  raw `node --test` is never a gate input.
- [Architecture](architecture.md) — the three layers and the dependency direction.
- [Build system](build-system.md) — CMake targets, presets, and the include rule.
- [llama-router](llama-router.md) — what Branch B is building.
- [`docs/build/HANDOFF.md`](../build/HANDOFF.md) — the live boot document.
