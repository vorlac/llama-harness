# HANDOFF — read this first on every start
## Position — 2026-08-14, after the non-live closeout pass. Full history: **`docs/build/COMPLETION-REPORT.md`**
**The build is NOT complete, and everything still missing needs a live model.** In a fresh detached
worktree of HEAD (plus `npm install` in `conductor/`), `bash scripts/verify-acceptance.sh` exits 1 —
**16 PASS / 5 FAIL**. One of those five, **row 3, is environmental**: a worktree has no submodules so
the cmake preset is disabled. In the main tree row 3 is green (`ctest`: 100% tests passed, 92 cases /
27,726 assertions), so the real standing is **17 of 21**. The main-tree gate is **1280/1280 node,
typecheck OK, bun 8 pass, schema export OK, python `Ran 68 tests`, GATE PASS**.

**53 of 55 rows are COMMITTED.** Only **`13.2`** (live smoke) and **`14.2`** (the 90-run POC campaign)
are NOT_STARTED, and the four real acceptance failures are exactly those two tasks: row 6 wants
`conductor/SMOKE.md` (13.2), row 8 wants `docs/build/artifacts/conductor-report.md` (14.2), row 12
lists both missing commit messages, and detector E is their union. **Both are live measurements;
authoring either is fabrication** (`verify-acceptance.sh:143-147`). The repo owner is holding both
back to be scheduled deliberately — do not start either without saying so first.

**The tree matches HEAD.** The only untracked files are `docs/plans/` and `docs/reviews/` work the
repo owner owns. `STATE.json` is machine truth; `NOW.md` is the human view.

## Do these in this order
1. **Bind the 22 conductor tools.** `conductor/plugin/index.ts:471-478` maps every name in
   `CONDUCTOR_TOOL_NAMES` to `handlerNotBound()`. This is the one blocker in front of both remaining
   rows: **unbound, a live session cannot advance a single stage, so 13.2 cannot run and 14.2's
   `conductor` arm cannot be measured.** It is 13.1 Step-2 glue that 13.1 landed without (a recorded
   deviation — `tools.ts` had concurrent edits at the time). Note the fence:
   `composition.test.ts:1537` `[5.4a-tools-still-throw-scope-fence]` **asserts the binding is absent**
   and names 13.1 as its owner, so binding the tools means rewriting that row, not deleting it.
   **This is non-live work and it is the highest-value thing left.**
2. **Phase gates 12 (stage 2), 13 and 15 have never run**; phase 14's is recorded FAIL and cannot
   pass until 14.2 exists. Stage 1 for 12 passed. These are review, not construction.
3. **Then 13.2 live smoke** → `conductor/SMOKE.md` (row 6, half of detector E). Also where the
   `permission.asked` payload gets pinned into `wire-notes.md` (10.1's SG-10 holds until then).
4. **Then 14.2** → row 8. 90 headless runs, HOURS: **launch detached.** **FIRST fix its spec**, and
   the conflict is now THREE-way: `conductor_bench.py:45` writes `.data/benchmark/conductor-report.md`
   (gitignored, and `.data/` is the never-touch tree), spec row `14.2-committed-copy` names
   `bench/conductor-report.md`, and the meter (`verify-acceptance.sh:163`) checks
   `docs/build/artifacts/conductor-report.md`. Land committed copies at both committed paths from the
   one generated file, byte-identical. The meter is uneditable; `14.2-no-tuning` already allows
   `docs/build/*`. Fix it BEFORE the campaign — afterwards it is a post-hoc shuffle of the measurement.

## Standing rules — do not re-derive these wrong
- Plan is **IMMUTABLE**; never tick its checkboxes. `docs/prompt-lifecycle.md` is STALE. Gate EVERY
  decision through `bash scripts/test-conductor.sh` — **never** raw `node --test` (node 26.7.0: a dir
  positional is a bogus red, a zero-match glob a vacuous green). It rejects SKIP/TODO at any depth
  (C-015); M5 is `scripts/conductor-gate.sh`. `pytest` = `/usr/bin/python3 -m pytest`; no `timeout`.
- Commit messages **verbatim** from STATE.json `commitMessage`; gate/repair rounds use their own
  `conductor-build:` message. No body, no trailers. **A row's deliverable must land under that row's
  own message** — acceptance row 12 counts each manifest message in `git log` exactly once. When 12.2
  landed under a gate message the fix was to **rename the commit, not the claim** (C-076): editing
  STATE.json's expected string to match the log turns the meter into a tautology. Roles: only the
  gatekeeper writes git, and it writes neither tests nor code.
- **NEVER** touch `.data/` or `.out/` (~20 GB gitignored); never `git clean -x*`; never move submodule
  pointers. The user commits on main concurrently: **`git add` explicit paths only**, never `-A`.
  Orchestrator-only, no subagent may edit: `CMakeLists.txt`, `CMakePresets.json`, `vcpkg.json`,
  `conductor/{tsconfig,package}.json`, `docs/**`, `scripts/{test-conductor.sh,serve.py,conductor-gate.sh}`.
- Per-task loop (§5): assertions → IN_PROGRESS → test-writer → **observe the red yourself** →
  implementer → **observe the green yourself** → M1–M9 → **read the diff yourself** → `revertAssertion`
  → commit. A subagent's "it's green" is never evidence, nor is its mutation table; **re-run the
  load-bearing mutation yourself.** **Parking a task must also park its files** — 12.2 was left STUCK
  with its half-finished work in the tree, which blocked every later task's clean-tree precondition
  and got the phase-12 gate dispatched over unfinished work (C-076).
- JSON under `docs/build/`: `GATES.json`/`STATE.json` round-trip byte-stably under
  `json.dump(indent=2, ensure_ascii=True)` + newline (**no-op dump first**); `specs/*.assertions.json`
  does NOT — edit as TEXT (C-073). Staged tests live in `scratchpad/staging/task-<id>/`; one is ready
  when its AGENT RETURNS, not when it appears (C-061); **same-file agents run sequentially** (C-056).

## Deferred bindings — live (`docs/build/specs/*.json` `phaseGateNBindings` + the corrections named)
- **9.1** — enforce derived-decision scored options (`decide.requireTwoOptions`);
  `ClassificationCheck.correctedKind == null` iff agreed. **C-028** — fix-round routing must thread a
  `receiving-review` signal to `buildSystemAppend`, parallel to the wired debug.md path.
- **12.1 survivors (C-062), three of five still open.** The supervisor closed at the phase-12 stage-1
  re-run; `serve.py`'s port collision and the `--ctx` derivation closed with the orphaned fix-round
  work. Still open: `wait_for_router_health` is called by **no** test (a `return True` stub survives —
  the `curl -s 503` trap); `ROUTER_TERM_GRACE_S` is asserted only `>= 5.0`, no upper bound;
  `derive_slots`' bool guard is unpinned. **C-067(a)** — C-032 E7's *prevention* half is wired at two
  of the four `implementer-blocked` question sites in `tools.ts`; the *repair* half covers all four.
- **13.1 measured two behaviours the plan sketched differently** (test header + STATE): (a) `blocked`
  is FINAL, so `conductor_report` closes a run holding a blocked item — the plan's refusal fires on
  UNSETTLED (PENDING) work; (b) the wave driver does not recover an item stranded by a sibling's
  commit — publish refuses it by name, REVIEWED→GREEN is the caller's.
- **13.2 (11.8 F1, qwen3.6-27b)** — a reasoning model can spend its whole `max_tokens` in
  `reasoning_content` and return EMPTY `content` with status 200. Send `enable_thinking=false`
  (`chat_template_kwargs`) or `reasoning_effort:"none"` on schema-constrained calls.

## Lessons that keep paying
- **A green main tree proves nothing about a fresh checkout** (C-069); **a fresh checkout proves
  nothing about the phase** (C-072); **green legs prove nothing when the phase is empty** (C-075).
  Cut the worktree, `npm install`, run it FIRST.
- **A scanner that PASSES while inspecting less than it appears to** is THE recurring defect class,
  now eight appearances (C-044…C-047, C-063, C-072, C-075, C-078). Make every scanner report how much
  it saw — **and check that against what you meant it to see.** M5's default set now includes
  `scripts/*.py` with its own floor (128 files, was 117); `test-conductor.sh` uses a per-run `mktemp`
  scratch dir, so gates no longer have to be run serially to avoid reading each other's leg output.
- **An oracle computed by the code under test proves nothing about that code** (C-077). 14.1's report
  could be made to claim "30 of 30 recorded" for 22 recorded cells with the suite still green, because
  the assertion searched the report for a string built by calling the formatter under test. Whenever a
  test asserts an output contains `f(x)`, `f` needs its own literal pin.
- **A green suite that mutation-tests clean can still hide a MAJOR** (C-033, C-067(b), C-070). Read the
  prose, then **RUN the consequence, don't reason it** (C-068). And **a caught mutation is not a closed
  defect**: ask what the FIXTURE supplies that production does not (C-069, C-071).
- **A failing acceptance row is not an invitation to write the artifact** — nor to edit what the row
  expects (C-075, C-076). Both flip the meter and leave the truth where it was.
- Pass plan EXCERPTS, never the 3,399-line plan. `wire-contract.test.ts` spawns real `opencode serve`
  — under load all 15 subtests CANCEL; re-run quiet before calling a regression.
- **Layout.** C++ tree is `router/`, `router/tests/`, `tools/`; include ROOT is the repo root (plan
  §1.1 is stale). Targets `llama-router`, `router-tests`, `membench`; schemas → `router/tests/schemas/`
  (gitignored). Build in `.out/build/clang-relwdebinfo`, **only** a named target (bare `--build` hits `llama`).
