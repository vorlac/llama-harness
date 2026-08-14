# HANDOFF — read this first on every start
## Position — updated 2026-08-14, after **acceptance repair round 2 (no rows closed; record only)**
**52 of 55 ledger rows COMMITTED**; only `13.2`, `14.1`, `14.2` are NOT_STARTED. `STATE.json` is
machine truth (`status` + `commitSha`); `NOW.md` is the human view. `bash scripts/verify-acceptance.sh`
→ **17 PASS / 4 FAIL**, unchanged by round 2 and unchangeable by any text edit: every failure needs
one of those three unbuilt rows and none is a defect in shipped code — rows 6 and 8 (and detector E,
their union) want `conductor/SMOKE.md` (13.2) and `docs/build/artifacts/conductor-report.md` (14.2);
row 12 lists manifest commits missing `13.2,14.1,14.2`. **Both artifacts are live measurements;
authoring either is fabrication (`verify-acceptance.sh:143-147`).** Gate **1280/1280, five legs, GATE
PASS**; C++ 92 cases / 27,726 assertions; M5 clean (117 files) — but that ran on the DIRTY tree, so it
does not measure HEAD; HEAD's greenness is round 1's, proven in a worktree at **1277/1277** (C-075).

**The tree does NOT match HEAD; expected — two peer sessions are live.** Modified
`conductor/adapter/tools.ts` (setup region ~8051-9033), `conductor/tests/setup.test.ts`,
`scripts/{conductor_wiring,test_conductor_wiring,serve}.py`; untracked: 14.1's three files (below)
and `docs/{plans,reviews}/` the repo owner owns. **`git add` explicit paths only.**

## Do these in this order
1. **Bind the 22 conductor tools.** `conductor/plugin/index.ts` maps every tool to `handlerNotBound()`;
   `composition.test.ts:1537` asserts the binding is absent and names it 13.1 Step-2 glue (13.1 landed
   without it — a recorded deviation — because `tools.ts` had concurrent edits). **Unbound, a live
   session cannot advance one stage: 13.2 cannot run, 14.2's `conductor` arm cannot be measured.**
2. **Then 13.2 live smoke** → `conductor/SMOKE.md` (row 6 + half of detector E). Where the
   `permission.asked` payload gets pinned into `wire-notes.md` (10.1's SG-10 holds till then).
3. **Then 14.1** — code-complete but UNCOMMITTED: `scripts/conductor_bench.py` (1847),
   `scripts/test_conductor_bench.py` (1947), `bench/conductor-tasks.json` (10 tasks); the python leg
   already passes them (`Ran 68 tests OK`), which is why the gate reads green while the ledger reads
   NOT_STARTED. Reconcile the peers' edits, commit under its OWN message `conductor: 14.1 bench
   driver`, and pass those three files to `conductor-gate.sh` EXPLICITLY (M5 never saw them).
4. **Then 14.2** → row 8. 90 headless runs, HOURS: **launch detached.** **FIRST fix its spec (C-075):**
   row `14.2-committed-copy` (spec:118) names `bench/conductor-report.md`; the meter
   (`verify-acceptance.sh:163`) checks `docs/build/artifacts/conductor-report.md`. Land BOTH,
   byte-identical — the meter is uneditable, `14.2-no-tuning` already allows `docs/build/*`. Fix it
   BEFORE the campaign; afterwards it is a post-hoc shuffle of the measurement.
5. **Phase 12 stage-2 reviewer** has still never run (authorized 12:40Z). Phase 13/15 gates unrun.
6. **STILL OWED (orchestrator), two scanner defects.** `conductor-gate.sh`'s default set is
   `git ls-files 'conductor/**/*.ts' 'router/**' 'tools/**'` — never reaches `scripts/` (all of 12.1's
   product), never sees untracked files; pass new files explicitly. And `test-conductor.sh` parses the
   python count from a FIXED `/tmp/python-leg.out`: until `mktemp`, **run gates SERIALLY.**

## Standing rules — do not re-derive these wrong
- Plan is **IMMUTABLE**; never tick its checkboxes. `docs/prompt-lifecycle.md` is STALE. Gate EVERY
  decision through `bash scripts/test-conductor.sh` — **never** raw `node --test` (node 26.7.0: a dir
  positional is a bogus red, a zero-match glob a vacuous green). It rejects SKIP/TODO at any depth
  (C-015); M5 is `scripts/conductor-gate.sh`. `pytest` = `/usr/bin/python3 -m pytest`; no `timeout`.
- Commit messages **verbatim** from STATE.json `commitMessage`; gate/repair rounds use their own
  `conductor-build:` message. No body, no trailers. **A row's deliverable must land under that row's
  own message** — acceptance row 12 counts each manifest message in `git log` exactly once, so
  landing a row's files under another message makes its message permanently unachievable (12.2 is the
  scar, C-073). Roles: only the gatekeeper writes git, and it writes neither tests nor code.
- **NEVER** touch `.data/` or `.out/` (~20 GB gitignored); never `git clean -x*`; never move submodule
  pointers. The user commits on main concurrently: **`git add` explicit paths only**, never `-A`.
  Orchestrator-only, no subagent may edit: `CMakeLists.txt`, `CMakePresets.json`, `vcpkg.json`,
  `conductor/{tsconfig,package}.json`, `docs/**`, `scripts/{test-conductor.sh,serve.py,conductor-gate.sh}`.
- Per-task loop (§5): assertions → IN_PROGRESS → test-writer → **observe the red yourself** →
  implementer → **observe the green yourself** → M1–M9 → **read the diff yourself** → `revertAssertion`
  → commit (STATE + HANDOFF + IN_PROGRESS together). A subagent's "it's green" is never evidence, nor
  is its mutation table; **re-run the load-bearing mutation yourself.**
- JSON under `docs/build/`: `GATES.json`/`STATE.json` round-trip byte-stably under
  `json.dump(indent=2, ensure_ascii=True)` + newline (**no-op dump first**); `specs/*.assertions.json`
  does NOT — edit as TEXT (C-073). Staged tests live in `scratchpad/staging/task-<id>/`; one is ready
  when its AGENT RETURNS, not when it appears (C-061); **same-file agents run sequentially** (C-056).

## Deferred bindings — live (`docs/build/specs/*.json` `phaseGateNBindings` + the corrections named)
- **9.1** — enforce derived-decision scored options (`decide.requireTwoOptions`);
  `ClassificationCheck.correctedKind == null` iff agreed. **C-028** — fix-round routing must thread a
  `receiving-review` signal to `buildSystemAppend`, parallel to the wired debug.md path.
- **12.1 survivors (C-062), four of five STILL OPEN** (only the supervisor closed):
  `wait_for_router_health` is called by no test (a `return True` stub survives — the `curl -s 503`
  trap); `ROUTER_TERM_GRACE_S` has no upper bound; `derive_slots`' bool guard is unpinned. **C-067(a)**
  — C-032 E7's *prevention* half is wired at two of the four `implementer-blocked` question sites in
  `tools.ts`; the *repair* half covers all four.
- **13.1 measured two behaviours the plan sketched differently** (test header + STATE): (a) `blocked`
  is FINAL, so `conductor_report` closes a run holding a blocked item — the plan's refusal fires on
  UNSETTLED (PENDING) work; (b) the wave driver does not recover an item stranded by a sibling's
  commit — publish refuses it by name, REVIEWED→GREEN is the caller's.
- **13.2 (11.8 F1, qwen3.6-27b)** — a reasoning model can spend its whole `max_tokens` in
  `reasoning_content` and return EMPTY `content` with status 200. Send `enable_thinking=false`
  (`chat_template_kwargs`) or `reasoning_effort:"none"` on schema-constrained calls.

## Lessons that keep paying
- **A green main tree proves nothing about a fresh checkout** (C-069); **a fresh checkout proves
  nothing about the phase** (C-072); **green legs prove nothing when the phase is empty** — 14.1's
  1,847 uncommitted lines are inside the 1280 (C-075). Cut the worktree, load the file set you will
  commit, `cmp`, `npm install`, run it **before** committing.
- **A scanner that PASSES while inspecting less than it appears to** is THE recurring defect class
  (C-044…C-047, C-063, C-072, C-075: M5 skips untracked files and never reaches `scripts/`). Make
  every scanner report how much it saw — **and check that against what you meant it to see.**
- **A green suite that mutation-tests clean can still hide a MAJOR** (C-033, C-067(b), C-070). Read the
  prose, then **RUN the consequence, don't reason it** (C-068). And **a caught mutation is not a closed
  defect**: ask what the FIXTURE supplies that production does not (C-069, C-071).
- **A failing acceptance row is not an invitation to write the artifact.** Rows 6/8/detector E want
  live measurements; a hand-written `SMOKE.md` flips the meter green and the truth false (C-075).
- Pass plan EXCERPTS, never the 3,399-line plan. `wire-contract.test.ts` spawns a real `opencode
  serve` — under load all 15 subtests CANCEL, so re-run quiet before calling a regression.
- **Layout.** C++ tree is `router/`, `router/tests/`, `tools/`; include ROOT is the repo root (plan
  §1.1 is stale). Targets `llama-router`, `router-tests`, `membench`; schemas → `router/tests/schemas/`
  (gitignored). Build in `.out/build/clang-relwdebinfo`, **only** a named target — bare `--build` hits
  `llama`.
