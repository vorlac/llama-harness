# HANDOFF — read this first on every start

## Position — updated 2026-08-14, after the Phase 10 gate's stage 1 re-run

**48 of 55 ledger rows COMMITTED.** MAIN tree and a **fresh detached worktree** both:
**1235/1235 GATE PASS**, all five legs green (node, tsc, bun, schema-export, python); C++ 92 cases
/ 27,726 assertions. `STATE.json` is the machine truth (`status` + `commitSha`);
`git log --grep='^conductor: '` is authoritative for "committed"; `IN_PROGRESS.json` absent means
no task is in flight; `NOW.md` is the human view. Phase gates 0–9 and 11 PASS; Phase 10's per-task
review ran and its MAJOR is fixed (C-068).

## Phase 10 gate — stage 1 PASS, stage 2 NOT RUN

`GATES.json.phaseGates["10"]` is **stage 1 PASS after 1 fix round of 3**. The fresh-worktree FAIL
is closed: `scripts/test_conductor_wiring.py:1130` pinned the recorded cwd to the *running*
checkout's path (latent from 589d22e/12.1, not Phase 10); it now requires the section to record
some **absolute** cwd. Three mutations in the worktree all caught (C-069). **No reviewer lens has
been dispatched for Phase 10** — the next gatekeeper runs stage 2 over the same scope. Also still
true: `phaseGates["11"]`'s fresh-worktree record names four legs, never the python leg (already
failing then) — not evidence of a clean checkout.

## Remaining work

| Task | State | Notes |
|---|---|---|
| 12.2 first-run setup | NOT_STARTED | `conductor_setup` tool + detection matrix. Test-writer was running. |
| 13.1 e2e scripted | NOT_STARTED | Largest task in the plan. Five scenarios, all five must appear in TAP. |
| 12.1-G5 | NOT_STARTED | Runs 13.1's e2e with and without the router. After 13.1. |
| 13.2 live smoke | NOT_STARTED | LIVE. `conductor/SMOKE.md`. Where the `permission.asked` payload finally gets pinned into `wire-notes.md` (10.1's SG-10 guard holds until then). |
| 14.1 bench driver | NOT_STARTED | **PRE-VERIFIED AND READY** at `scratchpad/staging/task-14.1/test_conductor_bench.py`: py_compile clean, red is a missing-subject ModuleNotFoundError, 33/33 rows covered. Held OUT of `scripts/` deliberately so the full gate stays green; move it in when you start the task. Critical path for 14.2. |
| 14.2 POC run | NOT_STARTED | LIVE, 90 headless runs measured in HOURS. **Launch detached.** |
| 15.1 ops docs | NOT_STARTED | HONEST-LIMITS.md verbatim from §9 plus the residuals below. |

Then: phase gates 10, 12, 13, 14, 15; `scripts/verify-acceptance.sh` exiting 0 in a clean worktree of HEAD; `docs/build/COMPLETION-REPORT.md`.

## Deferred bindings — still live

Sources: `docs/build/specs/*.json` `phaseGateNBindings` + the corrections named. All four 10.1 bindings (C-029 a/b, C-032 E7, C-037 ruling 6) and the C-056 residual are CLOSED (C-067).

- **9.1** — enforce derived-decision scored options (`decide.requireTwoOptions`);
  `ClassificationCheck.correctedKind == null` iff agreed.
- **receive-review.md delivery (C-028)** — fix-round routing must thread a `receiving-review`
  signal to `buildSystemAppend`, parallel to the wired debug.md path. Pack loaded; signal missing.
- **12.2 / 13.2 (11.8 F1, confirmed on qwen3.6-27b)** — a reasoning model can spend its whole
  `max_tokens` in `reasoning_content` and return EMPTY `content` with status 200; 1024 tokens did
  not reach the first output character. Send `chat_template_kwargs.enable_thinking=false` or
  `reasoning_effort:"none"` on every schema-constrained call.
- **C-067(a)** — STILL OPEN: the C-032 E7 *prevention* half is wired at two of the four
  `implementer-blocked` question sites in `tools.ts`; the *repair* half covers all four. Two
  lines, for whoever next opens `tools.ts`.
- **15.1** — `honest-limits-pending.md` (G7 residuals, C-022, C-026), plus 10.1's SG-8 mid-FSM
  claim expiry and SG-12's five parked crash/partial-write classes (C-030 E10, C-031 a–e).

## Standing rules — do not re-derive these wrong

- Plan is **IMMUTABLE**; never tick its checkboxes. `docs/prompt-lifecycle.md` is STALE.
- Gate EVERY decision through `bash scripts/test-conductor.sh`. **Never** raw `node --test`
  (node 26.7.0: a directory positional is a bogus red; a zero-match glob is a vacuous green).
  It also rejects SKIP/TODO directives at any depth (C-015). M5 is `scripts/conductor-gate.sh`.
- Commit messages **verbatim** from STATE.json `commitMessage`. No body, no trailers.
- `pytest` = `/usr/bin/python3 -m pytest`. bun 1.3.14 installed. `timeout` does NOT exist.
- **NEVER** touch `.data/` or `.out/` (~20 GB gitignored, unrecoverable); never `git clean -x*`,
  never move submodule pointers. The user commits on main concurrently: **`git add` explicit
  paths only**, never `-A`, never revert their files.
- Per-task loop (§5): assertions → IN_PROGRESS → test-writer → **observe the red yourself** →
  implementer → **observe the green yourself** → M1–M9 → **read the diff yourself** →
  `revertAssertion` → commit (STATE + HANDOFF + IN_PROGRESS deletion together). A subagent's
  "it's red/green" is never evidence.
- Editing JSON under `docs/build/` with python: dump `indent=2, ensure_ascii=True` + trailing
  newline, or the whole file reformats and the diff is unreviewable.
- Staged test files live in `scratchpad/staging/task-<id>/`; move one in at a time so the tree
  holds one red at a time, and a staged file is ready when its AGENT RETURNS, not when it appears
  (C-061). **Agents editing the SAME FILE run sequentially** (C-056); run `git status` after any
  agent returns — a changed test count means a file arrived or vanished.

## Lessons that keep paying

- **A green main tree proves nothing about a fresh checkout** — the Phase 10 gate caught exactly
  that, an absolute path baked into an assertion (C-069). Gate in a detached worktree with its own
  `npm install`, and read EVERY leg of the output.
- **A green suite that mutation-tests clean can still hide a MAJOR** (C-033, C-067(b)): both were
  found by reading a comment that claimed what the code below it did not do. Read the prose too.
  Then **RUN the consequence, don't reason it** — C-067(b) talked itself down to "documentation
  defect" and was a live-run killer (C-068). Same for `revertAssertion` rows (C-032/9.4a).
- **The recurring defect class** (C-044…C-047, C-063): a check that PASSES while inspecting less
  than it appears to. Make every scanner report how much it inspected.
- **Piped exit codes lie** — a pipeline's status is the LAST command's. Re-measure standalone. **Measure the right QUANTITY** (C-062): same units, different thing.
- **Disclosed survivors keep paying off.** Keep asking implementers for the mutation table.
  **Subagent fan-out is the dominant cost** — pass plan EXCERPTS, never the 3,399-line plan.
- `conductor/tests/wire-contract.test.ts` spawns a real `opencode serve`; under load all 15
  subtests CANCEL — re-run quiet before calling it a regression.

## Layout facts

- **C++ tree:** `router/`, `router/tests/`, `tools/`; include ROOT is the repo root, so headers are
  spelled `#include "router/config.hpp"`. Targets `llama-router`, `router-tests`, `membench`;
  schemas generate into `router/tests/schemas/` (gitignored); the plan's §1.1 tree is stale here.
  Build in `.out/build/clang-relwdebinfo`, **only** a named target — a bare `--build` hits `llama`.
- Orchestrator-only files no subagent may edit: `CMakeLists.txt`, `CMakePresets.json`, `vcpkg.json`, `conductor/tsconfig.json`, `conductor/package.json`, `scripts/test-conductor.sh`, `scripts/serve.py`, everything under `docs/`.
