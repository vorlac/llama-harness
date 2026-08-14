# HANDOFF — read this first on every start

## Position — updated 2026-08-14, after the Phase 12 gate **stage 1 re-run PASSED**

**49 of 55 ledger rows COMMITTED.** HEAD is green and the working tree matches it:
`bash scripts/test-conductor.sh` → **1272/1272, five legs, GATE PASS**, run twice identically and again
in a fresh detached worktree with its own `npm install`. C++ 92 cases / 27,726 assertions. M5 clean.
`STATE.json` is the machine truth (`status` + `commitSha`); `IN_PROGRESS.json` absent means no task is
in flight; `NOW.md` is the human view. **Gates 0–11 PASS; phase 12 stage 1 PASS, stage 2 NOT RUN.**
Note for `git log --grep`: 12.2's product was committed by the gate under its own message, so
`--grep='^conductor: 12.2'` finds nothing — STATE.json's row is the receipt (C-073).

## Phase 12 gate — stage 1 **PASS** after one fix round (`GATES.json … phaseGates["12"].stage1Rerun`)

1. **CLOSED — the C-072 supervisor major.** `scripts/test_conductor_wiring.py` gained
   `class RouterSupervisorExecution`: two cases that EXECUTE the real `ROUTER_SUPERVISOR_SOURCE`
   against a fake router binary and a real stand-in shell process. The gate re-ran C-072's mutation
   itself (`stop()` neutered, every grepped token kept in comments): the two new tests go red and
   `test_12_1_supervisor_lifecycle` — the string test — stays **green**. Cost: the gate is now ~105s.
2. **CLOSED — the red row.** The TEST was wrong: it mapped ecosystem→profile by identity, but
   `RUNNER_PROFILES` is keyed by RUNNER, so python compared `pytest` against `python`.
3. **STILL OWED (orchestrator edit).** `scripts/conductor-gate.sh`'s default set globs
   `conductor/**/*.ts`, `router/**`, `tools/**` via `git ls-files` — **`scripts/` is never reached**,
   so all of task 12.1's product sits outside the "115 files scanned". Third gate to say so. Widen
   it to `scripts/*.py`, and find something better than `git ls-files` (untracked files are invisible).

**Stage 1 passing is permission to convene the reviewer, not a phase verdict — dispatch stage 2.**

## Remaining work

| Task | State | Notes |
|---|---|---|
| 13.1 e2e scripted | NOT_STARTED | Largest task in the plan. Five scenarios, all five must appear in TAP. Then **12.1-G5**: re-runs 13.1's e2e with and without the router. |
| 13.2 live smoke | NOT_STARTED | LIVE. `conductor/SMOKE.md`. Where the `permission.asked` payload finally gets pinned into `wire-notes.md` (10.1's SG-10 guard holds until then). |
| 14.1 bench driver | NOT_STARTED | **PRE-VERIFIED AND READY** at `scratchpad/staging/task-14.1/test_conductor_bench.py`: py_compile clean, red is a missing-subject ModuleNotFoundError, 33/33 rows covered. Held OUT of `scripts/` deliberately so the full gate stays green; move it in when you start. Critical path for 14.2. |
| 14.2 POC run | NOT_STARTED | LIVE, 90 headless runs measured in HOURS. **Launch detached.** |
| 15.1 ops docs | NOT_STARTED | HONEST-LIMITS.md verbatim from §9 plus the residuals below. |
| gates | | Phase 12 **stage 2**, then 13/14/15 (10 and 11 CLOSED); `scripts/verify-acceptance.sh` exiting 0 in a clean worktree of HEAD; `docs/build/COMPLETION-REPORT.md`. |

## Deferred bindings — live (`docs/build/specs/*.json` `phaseGateNBindings` + the corrections named)

- **9.1** — enforce derived-decision scored options (`decide.requireTwoOptions`);
  `ClassificationCheck.correctedKind == null` iff agreed. **C-028** — fix-round routing must thread a
  `receiving-review` signal to `buildSystemAppend`, parallel to the wired debug.md path. Pack loaded;
  signal missing.
- **12.1 survivors (C-062), four of five STILL OPEN** — only the supervisor one closed.
  `wait_for_router_health` is called by no test (a `return True` stub survives — the `curl -s 503`
  trap); `ROUTER_TERM_GRACE_S` has no upper bound; `derive_slots`' bool guard is unpinned.
- **13.2 (11.8 F1, qwen3.6-27b)** — a reasoning model can spend its whole `max_tokens` in
  `reasoning_content` and return EMPTY `content` with status 200. Send
  `chat_template_kwargs.enable_thinking=false` or `reasoning_effort:"none"` on schema-constrained calls.
- **C-067(a)** — C-032 E7's *prevention* half is wired at two of the four `implementer-blocked`
  question sites in `tools.ts`; the *repair* half covers all four. **15.1** —
  `honest-limits-pending.md` (G7 residuals, C-022, C-026), 10.1's SG-8 mid-FSM claim expiry, SG-12's
  five parked crash/partial-write classes (C-030 E10, C-031 a–e).

## Standing rules — do not re-derive these wrong

- Plan is **IMMUTABLE**; never tick its checkboxes. `docs/prompt-lifecycle.md` is STALE.
- Gate EVERY decision through `bash scripts/test-conductor.sh` — **never** raw `node --test` (node
  26.7.0: a directory positional is a bogus red, a zero-match glob a vacuous green). It rejects
  SKIP/TODO at any depth (C-015) and takes a glob argument; M5 is `scripts/conductor-gate.sh`, which
  also takes an explicit file list. `pytest` = `/usr/bin/python3 -m pytest`; `timeout` does NOT exist.
- Commit messages **verbatim** from STATE.json `commitMessage` (phase-gate rounds use their own
  `conductor-build:` message), no body, no trailers. **NEVER** touch `.data/` or `.out/` (~20 GB
  gitignored); never `git clean -x*`, never move submodule pointers. The user commits on main
  concurrently: **`git add` explicit paths only**, never `-A` — `docs/plans/` and `docs/reviews/`
  hold untracked files of theirs.
- Per-task loop (§5): assertions → IN_PROGRESS → test-writer → **observe the red yourself** →
  implementer → **observe the green yourself** → M1–M9 → **read the diff yourself** →
  `revertAssertion` → commit (STATE + HANDOFF + IN_PROGRESS together). A subagent's "it's green" is
  never evidence — and neither is its mutation table; **re-run the load-bearing mutation yourself.**
- JSON under `docs/build/`: `GATES.json` and `STATE.json` round-trip byte-stably under
  `json.dump(indent=2, ensure_ascii=True)` + newline — **check with a no-op dump first**;
  `docs/build/specs/*.assertions.json` does NOT, so edit those as TEXT (C-073). Staged test files live
  in `scratchpad/staging/task-<id>/`; one is ready when its AGENT RETURNS, not when it appears (C-061),
  and **agents editing the SAME FILE run sequentially** (C-056).

## Lessons that keep paying

- **A green main tree proves nothing about a fresh checkout** (C-069) — and **a green fresh checkout
  proves nothing about the phase**, since uncommitted work cannot fail there (C-072). Cut the worktree,
  load the exact file set you are about to commit, `cmp` it, `npm install`, run it **before** committing.
- **A green suite that mutation-tests clean can still hide a MAJOR** (C-033, C-067(b), C-070). Read
  the prose, then **RUN the consequence, don't reason it** (C-068). And **a caught mutation is not a
  closed defect**: ask what the FIXTURE supplies that production does not (C-069, C-071).
- **The recurring defect class** (C-044…C-047, C-063, C-072): a check that PASSES while inspecting
  less than it appears to. Make every scanner report how much it inspected — **and check the number
  against what you meant to inspect.** Piped exit codes lie; measure the right QUANTITY (C-062).
- Pass plan EXCERPTS, never the 3,399-line plan. `wire-contract.test.ts` spawns a real `opencode
  serve` — under load all 15 subtests CANCEL, so re-run quiet before calling it a regression; tests
  that spawn processes need a `ps` check after every run, red ones included.
- **Layout.** C++ tree is `router/`, `router/tests/`, `tools/`; include ROOT is the repo root; the
  plan's §1.1 tree is stale. Targets `llama-router`, `router-tests`, `membench`; schemas →
  `router/tests/schemas/` (gitignored). Build in `.out/build/clang-relwdebinfo`, **only** a named
  target — a bare `--build` hits `llama`. Orchestrator-only files no subagent may edit:
  `CMakeLists.txt`, `CMakePresets.json`, `vcpkg.json`, `conductor/{tsconfig,package}.json`,
  `scripts/{test-conductor.sh,serve.py,conductor-gate.sh}`, everything under `docs/`.
