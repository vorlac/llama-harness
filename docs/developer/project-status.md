# Project status

Where the conductor build actually is, what is being built next, and what is known to be
imperfect. Every other page in this set describes the system as designed; this page is the
one that tells you how much of it exists. Read it before you trust anything else.

Status shown here is taken from [`docs/build/STATE.json`](../build/STATE.json) as of task
9.3 (`conductor: 9.3 plan review`, commit `1ad82b7`).

## How to read this page

Four artifacts carry build truth, and they do not carry it equally.

| Artifact                                                                                           | What it is                                                                                                              | How much to trust it                              |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| [`docs/build/STATE.json`](../build/STATE.json)                                                     | Machine truth. One row per task: status, commit, TAP counts, red evidence, files touched, revert assertion, deviations. | Authoritative for task status.                    |
| [`docs/build/HANDOFF.md`](../build/HANDOFF.md)                                                     | The boot document. What was just done, what is next, live traps, deferred obligations.                                  | Authoritative for the queue and for warnings.     |
| [`docs/plans/2026-08-07-conductor-harness-plan.md`](../plans/2026-08-07-conductor-harness-plan.md) | The specification. 3399 lines, revision 5, **immutable** — never edited, never ticked.                                  | Authoritative for design intent, not for reality. |
| `git log --grep 'conductor: '`                                                                     | The task list that actually happened. One commit per manifest task.                                                     | Authoritative for "did this land".                |

Two conventions matter when reading `STATE.json`:

- **`commitSha` is backfilled.** A task row is written in the same commit as the task, so
  the row cannot know its own sha. The next `STATE.json` touch fills it in. Until then,
  `git log --grep` on the row's `commitMessage` is the authoritative lookup. The
  convention is recorded in `meta.convention.commitSha`.
- **`conductor:` versus `conductor-build:`.** Commits prefixed `conductor:` are manifest
  tasks. Commits prefixed `conductor-build:` are orchestrator infrastructure — gate fixes,
  sha backfills, in-progress markers — and are not tasks.

Where the plan and the code disagree, the code wins and the difference is recorded, never
edited into the plan. See [Recorded deviations from the plan](#recorded-deviations-from-the-plan).

## Phase status

52 manifest tasks, of which **29 are committed**. Two extra rows exist outside the
manifest: task 5.4 (committed) and task 12.1-G5 (an equivalence step with no commit of its
own). 30 `conductor:` commits are on `main`.

Work runs on two branches. The **spine** is the TypeScript plugin, Phases 0-10 and 12-15,
strictly serial. **Branch B** is the C++ router, Phase 11, run in parallel because it
depends only on task 1.1's schemas and task 0.2's streaming finding.

### The spine

| Task    | Title                                 | Status      | Delivered                                                                                                                     |
| ------- | ------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 0.1     | standing decisions                    | COMMITTED   | [`conductor/DECISIONS.md`](../../conductor/DECISIONS.md)                                                                      |
| 0.2     | wire contract pinned                  | COMMITTED   | [`conductor/adapter/wire-notes.md`](../../conductor/adapter/wire-notes.md), `opencode-fragment.json`, the wire-contract suite |
| 0.3     | scaffold                              | COMMITTED   | `tsconfig.json`, `package.json`, `core/types.ts` seed, fragment tests                                                         |
| 1.1     | schemas                               | COMMITTED   | `core/types.ts` — every §2 schema plus `validate()`                                                                           |
| 1.2     | shell/glob parse                      | COMMITTED   | `core/shell-parse.ts` — quote-aware tokenizer, glob intersection                                                              |
| 1.3     | freshness/failure-class/stops/verdict | COMMITTED   | `core/freshness.ts`, `core/stops.ts`, `core/verdict.ts`                                                                       |
| 1.4     | purity + dual-runtime guards          | COMMITTED   | `tests/purity.test.ts` — G3 and G14 enforced mechanically                                                                     |
| 1.5     | decision helpers                      | COMMITTED   | `core/decide.ts` — ladder, scoring, human territory                                                                           |
| 2.1     | journal                               | COMMITTED   | `core/journal-events.ts`, `adapter/journal.ts`                                                                                |
| 2.2     | bun runtime smoke                     | COMMITTED   | `tests/bun-smoke.test.ts` plus the bun leg in the test wrapper                                                                |
| 3.1     | FSMs                                  | COMMITTED   | `core/fsm-run.ts`, `core/fsm-item.ts`                                                                                         |
| 3.2     | phase legality                        | COMMITTED   | `core/gates-phase.ts` — the single `legalTools` source                                                                        |
| 3.3     | wave scheduler                        | COMMITTED   | `core/schedule.ts` — `nextWave`, degenerate-scope guard                                                                       |
| 4.1     | state store                           | COMMITTED   | `adapter/state.ts`, `adapter/questions.ts` — atomic writes, run lock, beacon                                                  |
| 4.2     | gitio                                 | COMMITTED   | `adapter/gitio.ts`                                                                                                            |
| 5.1     | git policy                            | COMMITTED   | `core/gates-git.ts` — default-deny over parsed tokens                                                                         |
| 5.2     | edit + session gates                  | COMMITTED   | `core/gates-edit.ts` — session registry, role scope, freeze                                                                   |
| 5.3     | gate wiring                           | COMMITTED   | `adapter/tools.ts`, `plugin/index.ts` — fail-closed `tool.execute.before`                                                     |
| 5.4     | chat.message hook                     | COMMITTED   | `adapter/chat-message.ts` (non-manifest; added per orchestrator prompt §3.3)                                                  |
| 6.1     | evidence engine                       | COMMITTED   | `adapter/evidence.ts`, `adapter/quarantine.ts`                                                                                |
| 6.2     | runner discovery probe                | COMMITTED   | [`conductor/docs/RUNNER-DISCOVERY.md`](../../conductor/docs/RUNNER-DISCOVERY.md)                                              |
| 7.1     | fanout engine                         | COMMITTED   | `adapter/fanout.ts` plus the fake-SDK fixture                                                                                 |
| 7.2     | router client + failover              | COMMITTED   | `adapter/router-client.ts` — fail-soft, zero-network short circuit                                                            |
| 8.1     | doctrine packs                        | COMMITTED   | the nine packs under `conductor/doctrine/`                                                                                    |
| 8.2     | injection                             | COMMITTED   | `adapter/inject.ts` — `buildSystemAppend`, `paramsForRole`, `loadPacks`, `initPlugin`                                         |
| 9.1     | intake + question tools               | COMMITTED   | `conductor_classify`, `_status`, `_decide`, `_surface`, `_answer`, `_defer`                                                   |
| 9.2     | planning tools                        | COMMITTED   | `conductor_decompose`, `conductor_plan`, `core/planning.ts`, `SCHEMAS.Plan`                                                   |
| 9.3     | plan review                           | COMMITTED   | `conductor_plan_review`, `findingBlocksItems`                                                                                 |
| 9.4a    | test submission + vetting             | NOT_STARTED | `conductor_submit_test`, `conductor_vet_test`                                                                                 |
| 9.4b    | green/validate/amend                  | NOT_STARTED | `conductor_mark_green`, `conductor_validate`, `conductor_queue_amend`                                                         |
| 9.4c    | wave driver                           | NOT_STARTED | `conductor_dispatch_wave`                                                                                                     |
| 9.5a    | item review                           | NOT_STARTED | `conductor_item_review` — lenses, skeptics, path-routed fixes                                                                 |
| 9.5b    | publish + report                      | NOT_STARTED | `conductor_publish`, `conductor_report`                                                                                       |
| 9.5c    | stop reports + hatches                | NOT_STARTED | stop-reports, `conductor_inline_claim`, `conductor_override`                                                                  |
| 9.6     | worktree mode                         | NOT_STARTED | `adapter/worktrees.ts` plus parallel-writes integration                                                                       |
| 10.1    | continuation + ask gate               | NOT_STARTED | `adapter/continuation.ts`, ask-gate wiring                                                                                    |
| 12.1    | serve wiring                          | NOT_STARTED | router launch and config generation in `scripts/serve.py`                                                                     |
| 12.1-G5 | router equivalence                    | NOT_STARTED | runs 13.1 with and without the router (non-manifest, no own commit)                                                           |
| 12.2    | first-run setup                       | NOT_STARTED | `conductor_setup` repo flow                                                                                                   |
| 13.1    | e2e scripted                          | NOT_STARTED | five scripted scenarios on a fixture repo, no model                                                                           |
| 13.2    | live smoke                            | NOT_STARTED | real opencode against the smoke model, recorded                                                                               |
| 14.1    | bench driver                          | NOT_STARTED | `scripts/conductor_bench.py`                                                                                                  |
| 14.2    | POC run                               | NOT_STARTED | three arms, three repetitions, committed report                                                                               |
| 15.0    | replay tool                           | NOT_STARTED | `conductor/tools/replay.ts`                                                                                                   |
| 15.1    | ops docs                              | NOT_STARTED | `OPERATIONS.md` and `HONEST-LIMITS.md`                                                                                        |
| 15.2    | dashboard                             | NOT_STARTED | the optional ftxui target                                                                                                     |

Phases 0 through 8 have passed their adversarial phase gate. Phase 9 is a milestone phase;
its gate runs after 9.6.

### Branch B — the C++ router

| Task | Title                               | Status      | Delivered                                                                                                                                                                          |
| ---- | ----------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11.1 | router scaffold + upstream contract | COMMITTED   | CMake targets `llama-router` and `router-tests`, four vcpkg ports, `conductor/tools/export-schemas.ts`, [`src/router/UPSTREAM_CONTRACT.md`](../../src/router/UPSTREAM_CONTRACT.md) |
| 11.2 | router config                       | COMMITTED   | `src/router/config.hpp` (header-only, `conductor::router`), schema-validated parse                                                                                                 |
| 11.3 | proxy                               | NOT_STARTED | pass-through request handling                                                                                                                                                      |
| 11.4 | admission                           | NOT_STARTED | in-flight caps and priority queueing                                                                                                                                               |
| 11.5 | group affinity                      | NOT_STARTED | prefix-group ordering                                                                                                                                                              |
| 11.6 | schema observer                     | NOT_STARTED | request-side `schemaMissing` counter (shrunk by task 0.2's streaming finding)                                                                                                      |
| 11.7 | metrics                             | NOT_STARTED | one JSONL line per request plus the `/conductor/metrics` aggregate                                                                                                                 |
| 11.8 | router live smoke                   | NOT_STARTED | manual run against a live `llama-server`                                                                                                                                           |

Branch B runs on `main` rather than in a worktree, because the submodules are already
populated there and C++ files never overlap `conductor/*.ts`. The rationale and the
CMake surgery are recorded in [`docs/build/branch-b-plan.md`](../build/branch-b-plan.md).

## What works today

Things you can run right now, on this machine, and get a real result:

- **The whole model harness.** `./setup.sh`, `scripts/fetch_models.py` (list, info,
  install, verify, remove, status, config, build, serve), `scripts/serve.py`, and
  `scripts/benchmark.py` are built and in daily use. See
  [`scripts/README.md`](../../scripts/README.md).
- **The conductor test suite.** `bash scripts/test-conductor.sh` runs 901 tests across 34
  test files under `conductor/tests/`, then `tsc --noEmit`, then the bun dual-runtime
  smoke, then regenerates the JSON Schemas into `src/tests/schemas/`.
- **The mechanical stub scan.** `bash scripts/conductor-gate.sh` scans committed
  production source for stub markers, skipped or todo tests, trivially-true assertions,
  and empty catch blocks.
- **Schema export.** `conductor/tools/export-schemas.ts` writes 18 JSON Schemas into
  `src/tests/schemas/` (gitignored). It was 17 until task 9.2 added `SCHEMAS.Plan`.
- **The router build.** `cmake --build .out/build/clang-relwdebinfo --target llama-router`
  produces a binary that runs; `--target router-tests` plus `ctest` runs the doctest leg
  (7 cases, 119 assertions at 11.2). Build only those targets — see
  [build system](build-system.md).

What you cannot do yet: run conductor. The plugin is not loaded into an opencode session
until task 12.1 wires it into `scripts/serve.py`, and the pipeline tools it needs
(9.4a-9.6, 10.1) are not built. Everything committed so far is exercised by unit tests
against a fake SDK and fixture repos.

## What is next

Taken from [`docs/build/HANDOFF.md`](../build/HANDOFF.md):

1. **Task 9.4a — test submission and vetting.** Its assertions file is promoted and signed
   off at `docs/build/specs/task-9.4a.assertions.json`: 11 rows, 7 spec gaps resolved. The
   ruling on question origins is to reuse the existing `implementer-blocked` (submit
   exhaustion) and `review-round-cap` (vet cap) values and never widen the closed §2.11
   vocabulary.
2. **Then 9.4b, 9.4c, 9.5a, 9.5b, 9.5c, 9.6**, serially. Phase 9 is a no-parallel zone:
   every handler lands in the single file `conductor/adapter/tools.ts`.
3. **The Phase 9 milestone gate**, after 9.6. Then 10.1, then Phases 12, 13, 14, 15.
4. **Branch B task 11.3 — the proxy**, in parallel, followed by 11.4 through 11.8.

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

| Plan §1.1 says           | Reality              | Note                                                                                                                      |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/router-tests/`      | `src/tests/`         | The CMake **target** is still named `router-tests` — it is the ctest name every gate row cites. Only the directory moved. |
| root `tools/`            | `src/tools/`         | Contains `membench` and its CMake wiring; see [`src/tools/README.md`](../../src/tools/README.md).                         |
| schemas beside the tests | `src/tests/schemas/` | Generated by `export-schemas.ts`, gitignored, regenerated by every run of the test wrapper.                               |

And one rule that the plan does not state at all:

> **Include rule.** Every in-workspace header is included by its full path relative to
> `src/` — `#include "router/version.hpp"`, never `#include "version.hpp"`. `src/` is the
> only user-code include root on both C++ targets, so an include names where the header
> actually lives regardless of which file includes it. It applies to every file under
> `src/`, headers included.

## Deferred bindings

A binding is an obligation discovered by one task's review that a *later* task must
satisfy. Bindings are written into the owning task's assertions file (as a
`phaseGateNBindings` block) and mirrored in `HANDOFF.md`, so the task cannot be built
without meeting them. These are live:

| Owner              | Obligation                                                                                                                                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9.1                | Derived decisions must carry two scored options (`decide.requireTwoOptions`); `ClassificationCheck.correctedKind` is null if and only if the check agreed.                                                                                                                 |
| 9.4a / 5.3         | The gate and the handler must agree on dependency readiness for direct per-item stage-tool calls — `legalTools` must not offer a stage tool for a dependency-unready item.                                                                                                 |
| 9.4c               | `conductor_dispatch_wave` must supply the PLAN_REVIEWED → EXECUTING context: `survivingMajors: 0` if `planReviewRounds` is below the cap, otherwise the round and max. Without it a clean plan review livelocks entry to EXECUTING.                                        |
| 9.4c               | A stale or over-age evidence-marker break must fire `treeState.onClear`, so a leaked freeze marker becomes an env failure rather than a silent wave hang.                                                                                                                  |
| 9.5a               | An under-delivered skeptic panel must be re-run, or its missing verdicts counted as upholds.                                                                                                                                                                               |
| 9.5b               | The report handler must enforce all-settled as a non-verify precondition, because a closing re-verify is defeated by the foreign-red-set exclusion. Defense in depth.                                                                                                      |
| 10.1               | `conductor_classify`'s question path sets ANSWERED but does not archive the run; archival wires where run lifecycle and retention are managed, not in classify.                                                                                                            |
| 10.1               | `conductor_decide` does not consult `isHumanTerritory`; the ask-gate must reject or surface a `kind: derived` decision on a human-territory question.                                                                                                                      |
| Phase 9 fix rounds | The review-receipt routing must thread a "receiving-review" signal to `buildSystemAppend` so `receive-review.md` is appended, parallel to the already-wired `debug.md` path. The pack is loaded and cached now; only its delivery is deferred.                             |
| 12.1               | Task 11.1's Step 2 — measure `llama-server`'s `/v1` contract and the effective concurrent slot count through `serve.py --no-shell`, and complete `src/router/UPSTREAM_CONTRACT.md` with a real verification stamp. Observed output only; fabrication is the worst outcome. |
| 15.1               | Fold the G7 residuals in [`honest-limits-pending.md`](../build/honest-limits-pending.md) into the shipped honest-limits document.                                                                                                                                          |

## The corrections ledger

[`docs/build/CORRECTIONS.md`](../build/CORRECTIONS.md) is append-only. Each entry has an
id (`C-001` upward, 31 entries so far) and a fixed shape: the plan quote with line numbers,
the observed reality as an exact command and its output, the decision taken, the
alternatives considered, and the blast radius.

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

These are the fifteen limits from plan §9. They are normative: task 15.1 copies them
verbatim into the shipped honest-limits document, and no page in this set may contradict
them.

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

Limits discovered during the build — residual git-command detection gaps, the
text-only failure classifier, and the production-scoped stub scan — accumulate in
[`docs/build/honest-limits-pending.md`](../build/honest-limits-pending.md) and are folded
in at task 15.1.

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

Plan §11, verbatim in substance and unchecked, so "done" is legible:

- [ ] `node --test conductor/tests/` — all green, at least 24 test files.
- [ ] `bun test conductor/tests/bun-smoke.test.ts` green (G14) — the production runtime is
      exercised, not assumed.
- [ ] `ctest` on router-tests — all green.
- [ ] Purity guard, dual-runtime guard, and doctrine tests green — G3, G14, and the
      doctrine system enforced mechanically.
- [ ] Scripted e2e (13.1) green, all five scenarios: full pipeline with a greenfield red,
      trivial, worktree wave, non-behavioral item, and the
      blocked/stop-report/next-run-unpoisoned ending.
- [ ] Live smoke (13.2) recorded in `SMOKE.md` — schema validation survived real
      local-model outputs, retry counts noted, the non-behavioral path exercised.
- [ ] Runner discovery probe (6.2) recorded — the quarantine's out-of-repo location is
      justified by measurement.
- [ ] POC report (14.2) committed: three arms, three repetitions, per-task spread.
- [ ] `serve.py`: `--router` and `--no-router` both produce working sessions, and the e2e
      equivalence step (12.1) passes.
- [ ] `--parallel` is set from `parallel.maxReaders` and setup's slot probe passes — the
      fan-out is actually parallel upstream.
- [ ] `OPERATIONS.md` and `HONEST-LIMITS.md` exist and match all fifteen limits.
- [ ] `git log --oneline` shows one commit per task, each on a green suite.

The first row is written against raw `node --test`; in practice every gate decision runs
through `bash scripts/test-conductor.sh` instead, for the reasons in C-005 and in
[testing and verification](testing-and-verification.md).

## The build process itself

This repository is being built by an orchestrator agent following
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
[`docs/reviews/`](../reviews/). Note that
[`docs/prompt-lifecycle.md`](../prompt-lifecycle.md) is **stale** — retained for history;
the orchestrator prompt and `HANDOFF.md` are current.

## See also

- [Testing and verification](testing-and-verification.md) — the canonical test gate and why
  raw `node --test` is never a gate input.
- [Architecture](architecture.md) — the three layers and the dependency direction.
- [Build system](build-system.md) — CMake targets, presets, and the include rule.
- [llama-router](llama-router.md) — what Branch B is building.
- [`docs/build/HANDOFF.md`](../build/HANDOFF.md) — the live boot document.
