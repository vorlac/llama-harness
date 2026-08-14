# HANDOFF — read this first on every start

## Position — updated 2026-08-14, after Phase 10 stage 2's first fix round

**48 of 55 ledger rows COMMITTED.** MAIN tree: **1242/1242 GATE PASS**, five legs green; C++ 92
cases / 27,726 assertions; M5 clean. `STATE.json` is the machine truth (`status` + `commitSha`);
`git log --grep='^conductor: '` is authoritative for "committed"; `IN_PROGRESS.json` absent means
no task is in flight; `NOW.md` is the human view. Phase gates 0–9 and 11 PASS. **Phase 10 is
stage 2 FAIL** — read the next section before touching 10.1.

## Phase 10 gate — stage 2 FAIL, round 2 is the next work

Stage 1 PASS (C-069); stage 2's reviewer then confirmed **7 majors** in 10.1. Fix round 1 came
back green with 7 new rows and a 9-mutation table, and all nine are genuinely caught — but **two
things stay open** (`GATES.json.phaseGates["10"].stage2FixRound1.open`, C-070), both in
`conductor/adapter/continuation.ts`, both proven by running the consequence:

1. **`10.1-binding-orphan-question-reconcile` is closed only for its fixture.** The release test
   compares the item's mtime against the mtime of the *whole* `questions.jsonl`, so **one later
   question append of any origin** re-blocks the amended item on the question the amend released
   it from. Use a content-level discriminator (`Question.askedIso` + the item's block history);
   the replacement must carry the committed row **and** a row where a further question lands
   after the amend.
2. **A regression the round introduced.** A send that throws releases the latch (right) but still
   charges `idleRePrompts`/`futileRePrompts` and still writes the info `reprompt` record, so a
   permanently failing transport stops the run `noop` with **0 prompts delivered**, blaming the
   orchestrator. Charge the counters from the success path only.

Upheld against the reviewer: `resolveSessionTree` at `plugin/index.ts:556` is **not** inert —
`tools.ts:340` reads `entry?.tree ?? ""`. Stage 2's fresh-worktree leg is **not re-run** since
the round; do that after round 2.

## Remaining work

| Task | State | Notes |
|---|---|---|
| 12.2 first-run setup | NOT_STARTED | `conductor_setup` tool + detection matrix. Test-writer was running. |
| 13.1 e2e scripted | NOT_STARTED | Largest task in the plan. Five scenarios, all five must appear in TAP. Then **12.1-G5**: re-runs 13.1's e2e with and without the router. |
| 13.2 live smoke | NOT_STARTED | LIVE. `conductor/SMOKE.md`. Where the `permission.asked` payload finally gets pinned into `wire-notes.md` (10.1's SG-10 guard holds until then). |
| 14.1 bench driver | NOT_STARTED | **PRE-VERIFIED AND READY** at `scratchpad/staging/task-14.1/test_conductor_bench.py`: py_compile clean, red is a missing-subject ModuleNotFoundError, 33/33 rows covered. Held OUT of `scripts/` deliberately so the full gate stays green; move it in when you start the task. Critical path for 14.2. |
| 14.2 POC run | NOT_STARTED | LIVE, 90 headless runs measured in HOURS. **Launch detached.** |
| 15.1 ops docs | NOT_STARTED | HONEST-LIMITS.md verbatim from §9 plus the residuals below. |

Then: phase gates 10, 12, 13, 14, 15; `scripts/verify-acceptance.sh` exiting 0 in a clean worktree of HEAD; `docs/build/COMPLETION-REPORT.md`.

## Deferred bindings — still live

Sources: `docs/build/specs/*.json` `phaseGateNBindings` + the corrections named. All four 10.1 bindings (C-029 a/b, C-032 E7, C-037 ruling 6) and the C-056 residual are CLOSED (C-067) — but see the Phase 10 section: C-032 E7's repair half is not yet correct.

- **9.1** — enforce derived-decision scored options (`decide.requireTwoOptions`); `ClassificationCheck.correctedKind == null` iff agreed.
- **receive-review.md delivery (C-028)** — fix-round routing must thread a `receiving-review` signal to `buildSystemAppend`, parallel to the wired debug.md path. Pack loaded; signal missing.
- **12.2 / 13.2 (11.8 F1, on qwen3.6-27b)** — a reasoning model can spend its whole `max_tokens` in
  `reasoning_content` and return EMPTY `content` with status 200. Send `chat_template_kwargs.enable_thinking=false` or `reasoning_effort:"none"` on schema-constrained calls.
- **C-067(a)** — STILL OPEN: the C-032 E7 *prevention* half is wired at two of the four `implementer-blocked` question sites in `tools.ts`; the *repair* half covers all four.
- **15.1** — `honest-limits-pending.md` (G7 residuals, C-022, C-026), plus 10.1's SG-8 mid-FSM claim expiry and SG-12's five parked crash/partial-write classes (C-030 E10, C-031 a–e).

## Standing rules — do not re-derive these wrong

- Plan is **IMMUTABLE**; never tick its checkboxes. `docs/prompt-lifecycle.md` is STALE.
- Gate EVERY decision through `bash scripts/test-conductor.sh` — **never** raw `node --test`
  (node 26.7.0: a directory positional is a bogus red, a zero-match glob a vacuous green). It
  rejects SKIP/TODO at any depth (C-015). M5 is `scripts/conductor-gate.sh`.
- Commit messages **verbatim** from STATE.json `commitMessage` (phase-gate rounds use their own
  `conductor-build:` message). No body, no trailers. `pytest` = `/usr/bin/python3 -m pytest`;
  `timeout` does NOT exist.
- **NEVER** touch `.data/` or `.out/` (~20 GB gitignored, unrecoverable); never `git clean -x*`,
  never move submodule pointers. The user commits on main concurrently: **`git add` explicit
  paths only**, never `-A`, never revert their files.
- Per-task loop (§5): assertions → IN_PROGRESS → test-writer → **observe the red yourself** →
  implementer → **observe the green yourself** → M1–M9 → **read the diff yourself** →
  `revertAssertion` → commit (STATE + HANDOFF + IN_PROGRESS together). A subagent's "it's green" is never evidence.
- Editing JSON under `docs/build/` with python: dump `indent=2, ensure_ascii=True` + trailing
  newline, or the whole file reformats and the diff is unreviewable.
- Staged test files live in `scratchpad/staging/task-<id>/`; move one in at a time, and a staged
  file is ready when its AGENT RETURNS, not when it appears (C-061). **Agents editing the SAME
  FILE run sequentially** (C-056); `git status` after any agent returns — a changed test count
  means a file arrived or vanished.

## Lessons that keep paying

- **A green main tree proves nothing about a fresh checkout** (C-069): an absolute path baked into
  an assertion. Gate in a detached worktree with its own `npm install`; read EVERY leg.
- **A green suite that mutation-tests clean can still hide a MAJOR** (C-033, C-067(b), C-070).
  Read the prose too, then **RUN the consequence, don't reason it** (C-068).
- **A caught mutation is not a closed defect** (C-070): ask what the FIXTURE supplies that
  production does not, and distrust discriminators drawn from outside the durable record (mtime, cwd, hostname — C-069 is the same shape).
- **The recurring defect class** (C-044…C-047, C-063): a check that PASSES while inspecting less
  than it appears to. Make every scanner report how much it inspected.
- **Piped exit codes lie** — a pipeline's status is the LAST command's; **measure the right
  QUANTITY** (C-062). Keep asking implementers for the mutation table; pass plan EXCERPTS, never
  the 3,399-line plan. `wire-contract.test.ts` spawns a real `opencode serve` — under load all 15
  subtests CANCEL, so re-run quiet before calling it a regression.

## Layout facts

- **C++ tree:** `router/`, `router/tests/`, `tools/`; include ROOT is the repo root (`#include
  "router/config.hpp"`); the plan's §1.1 tree is stale. Targets `llama-router`, `router-tests`,
  `membench`; schemas -> `router/tests/schemas/` (gitignored). Build in `.out/build/clang-relwdebinfo`, **only** a named target — a bare `--build` hits `llama`.
- Orchestrator-only files no subagent may edit: `CMakeLists.txt`, `CMakePresets.json`, `vcpkg.json`, `conductor/tsconfig.json`, `conductor/package.json`, `scripts/test-conductor.sh`, `scripts/serve.py`, everything under `docs/`.
