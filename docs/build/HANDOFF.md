# HANDOFF — read this first on every start

Updated: 2026-08-14 (boot reconciliation. Phases 0–9 and 11 COMPLETE; Phase 9 gate PASS recorded.)

## Position

**47 of 55 ledger rows COMMITTED.** Suite **1201/1201 GATE PASS** (tsc + bun + schema-export
green, orchestrator-observed at this boot). C++ 73 cases / 26,392 assertions.

`docs/build/STATE.json` is the machine truth (`status` + `commitSha`).
`git log --grep='^conductor: '` is authoritative for "committed".
`docs/build/IN_PROGRESS.json` is the live position, rewritten every task.
`docs/build/NOW.md` is the human-readable view of what is running this minute.

Phase gates 0–9 all PASS (`GATES.json.phaseGates`). **Phase 11's gate has never run** — its
eight tasks are committed and each passed its own task gate, but the phase-boundary
adversarial pass was skipped when Branch B ran parallel to the spine. It is owed.

## Remaining work

| Task | State | Notes |
|---|---|---|
| 10.1 continuation + ask gate | NOT_STARTED | 32 assertion rows promoted. NEW `adapter/continuation.ts`. |
| ~~12.1 serve wiring~~ | COMMITTED | 29 rows. Python leg now in the gate, with a zero-tests floor. F3+F4 measured. |
| 12.2 first-run setup | NOT_STARTED | `conductor_setup` tool + detection matrix. |
| 13.1 e2e scripted | NOT_STARTED | Largest task in the plan. Five scenarios, all five must appear in TAP. |
| 12.1-G5 | NOT_STARTED | Runs 13.1's e2e with and without the router. After 13.1. |
| 13.2 live smoke | NOT_STARTED | LIVE. `conductor/SMOKE.md`. |
| 14.1 bench driver | NOT_STARTED | Must write one result file per cell and resume. |
| 14.2 POC run | NOT_STARTED | LIVE, 90 headless runs, **launch detached**. |
| ~~15.0 replay tool~~ | COMMITTED | 28 rows. SG-3 ruling recorded in STATE; row 28 closed a disclosed survivor. |
| 15.1 ops docs | NOT_STARTED | HONEST-LIMITS.md verbatim from §9 + the G7 residuals below. |
| ~~15.2 dashboard~~ | COMMITTED | 17 rows. Optional target verified ON and OFF. C++ now 90 cases / 27,673 assertions. |

Then: phase gates for 10, 11, 12, 13, 14, 15; `scripts/verify-acceptance.sh` exiting 0 in a
clean worktree of HEAD; `docs/build/COMPLETION-REPORT.md`.

## Deferred bindings — still live

Sources: `docs/build/specs/*.json` `phaseGateNBindings`, and the corrections named.

- **9.1** — enforce derived-decision scored options (`decide.requireTwoOptions`);
  `ClassificationCheck.correctedKind == null` iff agreed.
- **10.1 (from C-029)** — (a) `conductor_classify`'s question path sets ANSWERED but never
  archives the run; wire archival where the run lifecycle lives, not in classify.
  (b) `conductor_decide` does not consult `isHumanTerritory`; the ask-gate must reject or
  surface a `kind:derived` decision on a human-territory question.
- **10.1 (from C-032 E7)** — `blockAndAsk`/`blockVetAndAsk` append the question FIRST and
  `setBlocked` SECOND, and nothing reuses an open question for the same item+stage. Two
  in-flight calls, or a crash between the writes, strand an OPEN question no item references.
- **10.1 (from C-056)** — under first-block-wins, answering the FIRST question releases the
  item while a SECOND open question still names it. The answer path is 10.1's.
- **receive-review.md delivery (C-028)** — the fix-round routing that sends surviving findings
  to an implementer must thread a `receiving-review` signal to `buildSystemAppend`, parallel to
  the debug.md path already wired. The pack is loaded and cached; only the signal is missing.
- **12.1** — Task 11.1 Step 2's live upstream contract is still owed: measure llama-server's
  `/v1` contract and the effective concurrent slot count via `serve.py --no-shell`
  (qwen3.6-27b), then stamp a real `WIRE_CONTRACT_VERIFIED` into `router/UPSTREAM_CONTRACT.md`.
  Assets confirmed present. **M8: observed output only.**
- **12.1 (from the 11.8 artifact, F1)** — a reasoning model spends its whole `max_tokens` in
  `reasoning_content` and returns EMPTY `content` with status 200. Any per-role token budget
  that does not leave room for the thinking phase produces empty replies, not bad ones. Check
  qwen3.6-27b for this before fixing budgets.
- **15.1** — G7 residuals in `honest-limits-pending.md`: backtick substitution and alias
  injection now DENY (C-022); residual obscure in-place writers; the M5 marker scan is
  production-scoped (C-026).
- **Phase 11 gate** — owed, see above. Lenses per §7.2: correctness, protocol-conformance,
  concurrency, plus the standing spec-conformance and the ≥10-malformed-request red-team probe.

## Standing rules — do not re-derive these wrong

- Plan is **IMMUTABLE**; never tick its checkboxes. `docs/prompt-lifecycle.md` is STALE.
- Gate EVERY decision through `bash scripts/test-conductor.sh`. **Never** raw `node --test`
  (node 26.7.0: a directory positional is a bogus red; a zero-match glob is a vacuous green).
  It also rejects SKIP/TODO directives at any depth (C-015). M5 is `scripts/conductor-gate.sh`.
- Commit messages **verbatim** from STATE.json `commitMessage`. No body, no trailers. Only the
  orchestrator commits. A deviating subject is a slip — the 9.4a commit was amended for it.
- `pytest` = `/usr/bin/python3 -m pytest`. bun 1.3.14 installed. `timeout` does NOT exist.
- **NEVER** touch `.data/` or `.out/` (~20 GB gitignored, unrecoverable). Never `git clean -x*`.
  Never `git reset --hard` without a named stash. Never touch submodule pointers or
  `CMakePresets.json`.
- The user commits their own work on main concurrently. **Always `git add` explicit paths**,
  never `-A`, and never revert their files.
- Per-task loop (§5): assertions file → IN_PROGRESS → test-writer → **observe the red yourself**
  → implementer → **observe the green yourself** → task gate M1–M9 → **read the diff yourself**
  → `revertAssertion` → commit (STATE + HANDOFF in the same commit).
  A subagent's "it's red/green" is never evidence.
- Parallel test-writers stage into `scratchpad/staging/task-<id>/`; move one in at a time so the
  tree holds one red at a time.
- **Agents that edit the SAME FILE run sequentially.** No exception for "these three are small"
  — a clobbered fix does not fail the gate, it is simply absent (C-056).
- After ANY agent returns, run `git status`. A changed test count is the tell that a file
  arrived or vanished. Agents have died mid-edit leaving non-compiling trees; `git status` plus a
  build is the first action after any agent failure, never the assumption that it wrote nothing.

## Lessons that keep paying

- **A green suite that mutation-tests clean can still hide a MAJOR.** C-033 was invisible to
  both and was found by reading a comment that claimed something the code below it did not do.
  Without a review panel, the substitute is: mutate every load-bearing claim, then read the
  whole diff.
- **Mutate every branch of a guard, not just the guard** (C-034). A mutation that fails nothing
  can mean two paths reach one assertion and only one is under test.
- **`revertAssertion` rows must be RUN, not reasoned** (C-032/9.4a).
- **Read the exported signature, never infer it from one call site.** Cost a round already.
- **The recurring defect class** (C-044…C-047): a check that PASSES while inspecting less than
  it appears to. A construction that enforces an invariant must also assert that it RAN — a
  floor on how much it inspected, an explicit allowlist instead of a silent skip.
- **An EMPTY review finding set can mean the lenses CRASHED.** Check the run's failures and
  journal before treating empty as clean.
- **Subagent fan-out is the dominant cost.** ~79 agents / ~5.7M tokens in ~22 min exhausted a
  5-hour window, mostly on each agent independently re-reading the 3,399-line plan. Throttle:
  pass plan EXCERPTS, skeptics for MAJORs only, batch findings per verifier.
- **A mutation harness that reverts with `git checkout <file>` DISCARDS UNCOMMITTED WORK.**
  Snapshot with `cp`, restore from the snapshot, verify with `cmp`.
- `AUTOFORMAT_SRC_ON_CONFIGURE` runs clang-format over `router/` and `tools/` at cmake CONFIGURE
  time — a C++ file differing from its parked copy on whitespace is that, not an agent edit. An
  incremental ninja build does not reconfigure, so a file can sit committed format-dirty.
- `conductor/tests/wire-contract.test.ts` spawns a real `opencode serve`; under heavy concurrent
  load its readiness probe times out and all 15 subtests CANCEL. Re-run on a quiet machine before
  calling a cancellation a regression.

## Layout facts

- **C++ tree (user-directed, 2026-08-13):** `src/` → `router/`, `src/tests/` → `router/tests/`,
  `src/tools/` → `tools/`. The include ROOT moved to the repo root, so every header is still
  spelled `#include "router/config.hpp"` exactly as before. CMake target names are unchanged
  (`llama-router`, `router-tests`, `membench`). Generated schemas land in `router/tests/schemas/`
  (gitignored). The plan's §1.1 tree is stale on all of this and stays unedited.
- Build dir `.out/build/clang-relwdebinfo`. Build **only** `--target llama-router` /
  `--target router-tests` — a bare `--build` hits the pre-broken `llama` target.
- Orchestrator-only files no subagent may edit: `CMakeLists.txt`, `CMakePresets.json`,
  `vcpkg.json`, `conductor/tsconfig.json`, `conductor/package.json`, `scripts/test-conductor.sh`,
  `scripts/serve.py`, everything under `docs/`.
