# HANDOFF — read this first on every start

Updated: 2026-08-14, after Task 10.1's fix round. Phases 0–11 COMPLETE.

## Position

**48 of 55 ledger rows COMMITTED.** Suite **1235/1235 GATE PASS**, all five legs green
(node, tsc, bun, schema-export, python). C++ 90 cases / 27,673 assertions.
`docs/build/STATE.json` is the machine truth (`status` + `commitSha`);
`git log --grep='^conductor: '` is authoritative for "committed";
`docs/build/IN_PROGRESS.json` is the live position — **absent means no task is in flight**;
`docs/build/NOW.md` is the human view of what is running this minute.

Phase gates 0–9 and 11 PASS (`GATES.json.phaseGates`). **Phase 10's adversarial pass has RUN**;
its one MAJOR is fixed and committed (C-068). The phase gate itself is still owed — stage 1
(fresh-worktree re-verify) has not been done for Phase 10.

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

Sources: `docs/build/specs/*.json` `phaseGateNBindings`, and the corrections named. **All four 10.1 bindings (C-029 a and b, C-032 E7, C-037 ruling 6) plus the C-056 residual are now CLOSED** — see `specs/task-10.1.assertions.json` and C-067.

- **9.1** — enforce derived-decision scored options (`decide.requireTwoOptions`);
  `ClassificationCheck.correctedKind == null` iff agreed.
- **receive-review.md delivery (C-028)** — the fix-round routing that sends surviving findings
  to an implementer must thread a `receiving-review` signal to `buildSystemAppend`, parallel to
  the wired debug.md path. The pack is loaded and cached; only the signal is missing.
- **12.1** — Task 11.1 Step 2's live upstream contract is owed: measure llama-server's `/v1`
  contract and the effective slot count via `serve.py --no-shell` (qwen3.6-27b), then stamp a
  real `WIRE_CONTRACT_VERIFIED` into `router/UPSTREAM_CONTRACT.md`. **M8: observed output only.**
  Also (11.8 artifact F1) a reasoning model can spend its whole `max_tokens` in
  `reasoning_content` and return EMPTY `content` with status 200 — an under-budgeted role gives
  empty replies, not bad ones.
- **Phase 10 gate (from C-067)** — (a) STILL OPEN: the C-032 E7 *prevention* half is wired at two
  of the four `implementer-blocked` question sites in `tools.ts`; the *repair* half covers all
  four. Two lines, for whoever next opens `tools.ts`. (b) CLOSED by C-068 — it was a MAJOR, not a
  comment defect: the futile counter is persisted and its baseline was not, so ONE restart could
  archive a moving run. Residual left open there: SG-3's durable baseline needs a §2.3 `run.json`
  field, so the header now states what the code guarantees instead.
- **15.1** — `honest-limits-pending.md` (G7 residuals, C-022, C-026), plus 10.1's SG-8 mid-FSM
  claim expiry and SG-12's five parked crash/partial-write classes (C-030 E10, C-031 a–e).

## Standing rules — do not re-derive these wrong

- Plan is **IMMUTABLE**; never tick its checkboxes. `docs/prompt-lifecycle.md` is STALE.
- Gate EVERY decision through `bash scripts/test-conductor.sh`. **Never** raw `node --test`
  (node 26.7.0: a directory positional is a bogus red; a zero-match glob is a vacuous green).
  It also rejects SKIP/TODO directives at any depth (C-015). M5 is `scripts/conductor-gate.sh`.
- Commit messages **verbatim** from STATE.json `commitMessage`. No body, no trailers.
- `pytest` = `/usr/bin/python3 -m pytest`. bun 1.3.14 installed. `timeout` does NOT exist.
- **NEVER** touch `.data/` or `.out/` (~20 GB gitignored, unrecoverable). Never `git clean -x*`,
  never touch submodule pointers or `CMakePresets.json`. The user commits their own work on
  main concurrently: **always `git add` explicit paths**, never `-A`, never revert their files.
- Per-task loop (§5): assertions file → IN_PROGRESS → test-writer → **observe the red yourself**
  → implementer → **observe the green yourself** → task gate M1–M9 → **read the diff yourself**
  → `revertAssertion` → commit (STATE + HANDOFF + IN_PROGRESS deletion in one commit). A
  subagent's "it's red/green" is never evidence.
- Editing JSON under `docs/build/` with python: dump `indent=2, ensure_ascii=True` + trailing
  newline, or the whole file reformats and the diff is unreviewable.
- Staged test files live in `scratchpad/staging/task-<id>/`; move one in at a time so the tree
  holds one red at a time. A staged file is ready when its AGENT RETURNS, not when it appears
  (C-061). **Agents that edit the SAME FILE run sequentially** (C-056), and after ANY agent
  returns run `git status` — a changed test count is the tell that a file arrived or vanished.

## Lessons that keep paying

- **A green suite that mutation-tests clean can still hide a MAJOR.** C-033 was found by reading a comment that claimed something the code below it did not do — C-067(b) is the same shape found the same way. Read the whole diff, prose included.
- **Having found such a comment, RUN the consequence — do not reason it.** C-067(b) reasoned its own severity down to "documentation defect" and was wrong: a persisted counter beside an in-memory baseline killed live runs on the first restart (C-068). Where a durable field sits next to a volatile one, ask what the first pass after a restart does with both.
- **`revertAssertion` rows must be RUN, not reasoned** (C-032/9.4a). 10.1's gate ran three reverts in a detached worktree, each biting a different named row — that is what proves the tests are not merely co-present with the implementation.
- **The recurring defect class** (C-044…C-047, C-063): a check that PASSES while inspecting
  less than it appears to. Make every scanner report how much it inspected.
- **Piped exit codes lie** — a pipeline's status is the LAST command's. Re-measure standalone. **Measure the right QUANTITY** (C-062): same units, different thing.
- **Disclosed survivors keep paying off.** Keep asking implementers for the mutation table.
  **Subagent fan-out is the dominant cost** — pass plan EXCERPTS, never the 3,399-line plan.
- `conductor/tests/wire-contract.test.ts` spawns a real `opencode serve`; under load all 15
  subtests CANCEL — re-run quiet before calling it a regression.

## Layout facts

- **C++ tree:** `router/`, `router/tests/`, `tools/`. Include ROOT is the repo root, so headers
  are still spelled `#include "router/config.hpp"`. Targets `llama-router`, `router-tests`,
  `membench`; generated schemas land in `router/tests/schemas/` (gitignored); the plan's §1.1
  tree is stale on all of this and stays unedited. Build dir `.out/build/clang-relwdebinfo`, and
  build **only** a named target — a bare `--build` hits the pre-broken `llama` target.
- Orchestrator-only files no subagent may edit: `CMakeLists.txt`, `CMakePresets.json`, `vcpkg.json`, `conductor/tsconfig.json`, `conductor/package.json`, `scripts/test-conductor.sh`, `scripts/serve.py`, everything under `docs/`.
