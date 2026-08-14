# HANDOFF — read this first on every start

## Position — updated 2026-08-14, after the **Phase 14 gate stage 1 FAILED: phase 14 does not exist**

**49 of 55 ledger rows COMMITTED.** HEAD (`eb39500`) is green on its own: a fresh detached worktree
with its own `npm install` runs **1272/1272, five legs, GATE PASS**; C++ 92 cases / 27,726 assertions;
M5 clean (116 files). `STATE.json` is the machine truth (`status` + `commitSha`); `NOW.md` is the human
view. **Gates 0–11 PASS; phase 12 stage 1 PASS with stage 2 NOT RUN; phase 13 unbuilt; phase 14
stage 1 FAIL** (`GATES.json … phaseGates["14"]`) — dispatched over two NOT_STARTED rows, 51 spec
assertion ids, not one named by any tracked file. Do not convene its reviewer. (12.2's product landed
under the gate's message, so `git log --grep='^conductor: 12.2'` finds nothing — C-073.)

**The working tree NO LONGER matches HEAD.** `git diff --shortstat` → 5 files, +669/−74 across
`conductor/adapter/tools.ts`, `conductor/tests/setup.test.ts`, `scripts/{conductor_wiring,
test_conductor_wiring,serve}.py`, carrying ≥9 new **phase-12** assertion ids and lifting the main tree
to 1275 node / 35 python. No `IN_PROGRESS.json`, no STATE row: green but **unattributed**. Gate it or
revert it — an unowned diff is how a phase gets declared done over work nobody gated.

## Do these in this order — nothing downstream is safe until they are done

1. **Attribute or revert the 669 uncommitted lines** (above). Nothing else can be trusted while a
   green diff sits in the tree with no owner.
2. **Dispatch phase 12's stage-2 reviewer.** Stage 1 authorized it at 12:40Z; it has never run. C-072
   is CLOSED by an EXECUTED test (`class RouterSupervisorExecution` runs the real
   `ROUTER_SUPERVISOR_SOURCE` against a fake router and a real stand-in shell). Gate is now ~105s.
3. **Build and gate phase 13** (13.1, then 12.1-G5, then 13.2). **Then** start 14.1.
4. **STILL OWED (orchestrator edits), two scanner defects.** `conductor-gate.sh`'s default set globs
   `conductor/**/*.ts`, `router/**`, `tools/**` via `git ls-files` — **`scripts/` is never reached**,
   so all of 12.1's product sits outside the "116 files scanned" (fourth gate to say so). And
   `test-conductor.sh` parses the python count out of a FIXED `/tmp/python-leg.out`, so **concurrent
   gate runs corrupt each other** — that faked a red here. Until `mktemp`, **run gates SERIALLY.**

## Remaining work

| Task | State | Notes |
|---|---|---|
| 13.1 e2e scripted | NOT_STARTED | Largest task in the plan. Five scenarios, all five must appear in TAP. Then **12.1-G5**: re-runs 13.1's e2e with and without the router. |
| 13.2 live smoke | NOT_STARTED | LIVE. `conductor/SMOKE.md`. Where the `permission.asked` payload finally gets pinned into `wire-notes.md` (10.1's SG-10 guard holds until then). |
| 14.1 bench driver | NOT_STARTED | **PRE-VERIFIED AND READY** at `scratchpad/staging/task-14.1/test_conductor_bench.py`: py_compile clean, red is a missing-subject ModuleNotFoundError, 33/33 rows covered. Held OUT of `scripts/` deliberately so the full gate stays green; move it in when you start. Critical path for 14.2. |
| 14.2 POC run | NOT_STARTED | LIVE, 90 headless runs measured in HOURS. **Launch detached.** |
| 15.1 ops docs | NOT_STARTED | HONEST-LIMITS.md verbatim from §9 plus the residuals below. |
| gates | | Phase 12 **stage 2**, then 13, then **14 (stage 1 FAILED 15:20Z — re-run it, and name that verdict)**, then 15 (10 and 11 CLOSED); `scripts/verify-acceptance.sh` exiting 0 in a clean worktree of HEAD; `docs/build/COMPLETION-REPORT.md`. |

## Deferred bindings — live (`docs/build/specs/*.json` `phaseGateNBindings` + the corrections named)

- **9.1** — enforce derived-decision scored options (`decide.requireTwoOptions`);
  `ClassificationCheck.correctedKind == null` iff agreed. **C-028** — fix-round routing must thread a
  `receiving-review` signal to `buildSystemAppend`, parallel to the wired debug.md path (pack loaded).
- **12.1 survivors (C-062), four of five STILL OPEN** (only the supervisor closed):
  `wait_for_router_health` is called by no test (a `return True` stub survives — the `curl -s 503`
  trap); `ROUTER_TERM_GRACE_S` has no upper bound; `derive_slots`' bool guard is unpinned.
- **13.2 (11.8 F1, qwen3.6-27b)** — a reasoning model can spend its whole `max_tokens` in
  `reasoning_content` and return EMPTY `content` with status 200. Send `enable_thinking=false` (via
  `chat_template_kwargs`) or `reasoning_effort:"none"` on schema-constrained calls.
- **C-067(a)** — C-032 E7's *prevention* half is wired at two of the four `implementer-blocked`
  question sites in `tools.ts`; the *repair* half covers all four. **15.1** — `honest-limits-pending.md`
  (G7 residuals, C-022, C-026), 10.1's SG-8 claim expiry, SG-12's five crash classes (C-030 E10, C-031).

## Standing rules — do not re-derive these wrong

- Plan is **IMMUTABLE**; never tick its checkboxes. `docs/prompt-lifecycle.md` is STALE. Gate EVERY
  decision through `bash scripts/test-conductor.sh` — **never** raw `node --test` (node 26.7.0: a dir
  positional is a bogus red, a zero-match glob a vacuous green). It rejects SKIP/TODO at any depth
  (C-015); M5 is `scripts/conductor-gate.sh`. `pytest` = `/usr/bin/python3 -m pytest`; no `timeout`.
- Commit messages **verbatim** from STATE.json `commitMessage` (phase-gate rounds use their own
  `conductor-build:` message), no body, no trailers. **NEVER** touch `.data/` or `.out/` (~20 GB
  gitignored); never `git clean -x*`, never move submodule pointers. The user commits on main
  concurrently: **`git add` explicit paths only**, never `-A` (`docs/plans/`, `docs/reviews/`).
- Per-task loop (§5): assertions → IN_PROGRESS → test-writer → **observe the red yourself** →
  implementer → **observe the green yourself** → M1–M9 → **read the diff yourself** → `revertAssertion`
  → commit (STATE + HANDOFF + IN_PROGRESS together). A subagent's "it's green" is never evidence, nor
  is its mutation table; **re-run the load-bearing mutation yourself.**
- JSON under `docs/build/`: `GATES.json` and `STATE.json` round-trip byte-stably under
  `json.dump(indent=2, ensure_ascii=True)` + newline — **check with a no-op dump first**;
  `specs/*.assertions.json` does NOT, so edit those as TEXT (C-073). Staged test files live in
  `scratchpad/staging/task-<id>/`; one is ready when its AGENT RETURNS, not when it appears (C-061),
  and **agents editing the SAME FILE run sequentially** (C-056).

## Lessons that keep paying

- **A green main tree proves nothing about a fresh checkout** (C-069); **a green fresh checkout proves
  nothing about the phase** (C-072); **green legs prove nothing at all when the phase is empty** — a
  phase gate's FIRST act is reading STATE.json for its rows' status. Cut the worktree, load the file
  set you will commit, `cmp`, `npm install`, run it **before** committing.
- **A green suite that mutation-tests clean can still hide a MAJOR** (C-033, C-067(b), C-070). Read
  the prose, then **RUN the consequence, don't reason it** (C-068). And **a caught mutation is not a
  closed defect**: ask what the FIXTURE supplies that production does not (C-069, C-071).
- **The recurring defect class** (C-044…C-047, C-063, C-072): a check that PASSES while inspecting
  less than it appears to. Make every scanner report how much it inspected — **and check the number
  against what you meant to inspect.** Piped exit codes lie; measure the right QUANTITY (C-062).
- Pass plan EXCERPTS, never the 3,399-line plan. `wire-contract.test.ts` spawns a real `opencode
  serve` — under load all 15 subtests CANCEL, so re-run quiet before calling a regression; tests that
  spawn processes need a `ps` check after every run, red ones included.
- **Layout.** C++ tree is `router/`, `router/tests/`, `tools/`; include ROOT is the repo root; the
  plan's §1.1 tree is stale. Targets `llama-router`, `router-tests`, `membench`; schemas →
  `router/tests/schemas/` (gitignored). Build in `.out/build/clang-relwdebinfo`, **only** a named
  target — a bare `--build` hits `llama`. Orchestrator-only files no subagent may edit: `CMakeLists.txt`,
  `CMakePresets.json`, `vcpkg.json`, `conductor/{tsconfig,package}.json`, everything under `docs/`, and
  `scripts/{test-conductor.sh,serve.py,conductor-gate.sh}`.
