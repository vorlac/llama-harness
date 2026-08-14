# HANDOFF — read this first on every start

## Position — updated 2026-08-14, after **acceptance repair round 1 (PASS, committed)**

**52 of 55 ledger rows COMMITTED**; only `13.2`, `14.1`, `14.2` are NOT_STARTED. `STATE.json` is the
machine truth (`status` + `commitSha`); `NOW.md` is the human view.
`bash scripts/verify-acceptance.sh` → **17 PASS / 4 FAIL**, and all four failures need those three
unbuilt rows — none is a defect in shipped code: row 6 + detector E want `conductor/SMOKE.md` (13.2),
row 8 + detector E want `docs/build/artifacts/conductor-report.md` (14.2), row 12 lists manifest
commits missing `13.2,14.1,14.2`. Main-tree gate: **1280/1280, five legs, GATE PASS**; C++ 92 cases /
27,726 assertions; M5 clean (117 files). HEAD is green **on its own**: a detached worktree at the
pre-commit HEAD carrying only this round's four files ran `npm install` + full gate → **1277/1277**.

**The working tree still does NOT match HEAD, and this is expected.** A concurrent task holds
uncommitted edits in `conductor/adapter/tools.ts` (all inside the setup region, lines ~8051-9033),
`conductor/tests/setup.test.ts`, `scripts/{conductor_wiring,test_conductor_wiring,serve}.py`, plus
untracked `bench/`, `scripts/conductor_bench.py`, `scripts/test_conductor_bench.py` (14.1 in flight)
and `docs/plans/`, `docs/reviews/` files the repo owner owns. **`git add` explicit paths only.**

## Do these in this order

1. **Bind the 22 conductor tools.** `conductor/plugin/index.ts` still maps every tool to
   `handlerNotBound()`, which throws `"no run handler is bound to this session"`;
   `composition.test.ts:1537` asserts that binding is still absent and names it 13.1 Step-2 glue.
   13.1 landed WITHOUT it (recorded as a 13.1 deviation, not claimed) because `tools.ts` had
   concurrent edits. **Until this is bound a live opencode session cannot advance one stage, so 13.2
   cannot run at all and 14.2's `conductor` arm cannot be measured.** This is the critical path.
2. **Then 13.2 live smoke** → `conductor/SMOKE.md` (closes row 6 + half of detector E). Where the
   `permission.asked` payload finally gets pinned into `wire-notes.md` (10.1's SG-10 holds until then).
3. **Then 14.1** (driver is in flight and uncommitted — attribute or revert it first), **then 14.2**
   → `docs/build/artifacts/conductor-report.md` (row 8). 14.2 is 90 headless runs, measured in HOURS:
   **launch detached.**
4. **Phase 12 stage-2 reviewer** has still never run (authorized 12:40Z). Phase 13/15 gates unrun.
5. **STILL OWED (orchestrator edits), two scanner defects.** `conductor-gate.sh`'s default set is
   `git ls-files 'conductor/**/*.ts' 'router/**' 'tools/**'`: **`scripts/` is never reached** (all of
   12.1's product) and **untracked files are never scanned** — pass new files explicitly until fixed.
   And `test-conductor.sh` parses the python count from a FIXED `/tmp/python-leg.out`, so concurrent
   gate runs corrupt each other. Until `mktemp`, **run gates SERIALLY.**

## Standing rules — do not re-derive these wrong

- Plan is **IMMUTABLE**; never tick its checkboxes. `docs/prompt-lifecycle.md` is STALE. Gate EVERY
  decision through `bash scripts/test-conductor.sh` — **never** raw `node --test` (node 26.7.0: a dir
  positional is a bogus red, a zero-match glob a vacuous green). It rejects SKIP/TODO at any depth
  (C-015); M5 is `scripts/conductor-gate.sh`. `pytest` = `/usr/bin/python3 -m pytest`; no `timeout`.
- Commit messages **verbatim** from STATE.json `commitMessage`; gate/repair rounds use their own
  `conductor-build:` message. No body, no trailers. **A task row's deliverable must land under that
  row's own message** — acceptance row 12 counts each manifest message in `git log` exactly once, so
  landing a row's files under another message makes its message permanently unachievable. (12.2 is the
  scar — C-073: its `commitMessage` had to be rewritten to match what actually shipped.)
- **NEVER** touch `.data/` or `.out/` (~20 GB gitignored); never `git clean -x*`; never move submodule
  pointers. The user commits on main concurrently: **`git add` explicit paths only**, never `-A`.
  Orchestrator-only, no subagent may edit: `CMakeLists.txt`, `CMakePresets.json`, `vcpkg.json`,
  `conductor/{tsconfig,package}.json`, `docs/**`, `scripts/{test-conductor.sh,serve.py,conductor-gate.sh}`.
- Per-task loop (§5): assertions → IN_PROGRESS → test-writer → **observe the red yourself** →
  implementer → **observe the green yourself** → M1–M9 → **read the diff yourself** → `revertAssertion`
  → commit (STATE + HANDOFF + IN_PROGRESS together). A subagent's "it's green" is never evidence, nor
  is its mutation table; **re-run the load-bearing mutation yourself.**
- JSON under `docs/build/`: `GATES.json` and `STATE.json` round-trip byte-stably under
  `json.dump(indent=2, ensure_ascii=True)` + newline — **check with a no-op dump first**;
  `specs/*.assertions.json` does NOT, so edit those as TEXT (C-073). Staged test files live in
  `scratchpad/staging/task-<id>/`; one is ready when its AGENT RETURNS, not when it appears (C-061),
  and **agents editing the SAME FILE run sequentially** (C-056).

## Deferred bindings — live (`docs/build/specs/*.json` `phaseGateNBindings` + the corrections named)

- **9.1** — enforce derived-decision scored options (`decide.requireTwoOptions`);
  `ClassificationCheck.correctedKind == null` iff agreed. **C-028** — fix-round routing must thread a
  `receiving-review` signal to `buildSystemAppend`, parallel to the wired debug.md path (pack loaded).
- **12.1 survivors (C-062), four of five STILL OPEN** (only the supervisor closed):
  `wait_for_router_health` is called by no test (a `return True` stub survives — the `curl -s 503`
  trap); `ROUTER_TERM_GRACE_S` has no upper bound; `derive_slots`' bool guard is unpinned.
  **C-067(a)** — C-032 E7's *prevention* half is wired at two of the four `implementer-blocked`
  question sites in `tools.ts`; the *repair* half covers all four.
- **13.1 measured two behaviours the plan sketched differently** (test header + STATE): (a) `blocked`
  is a FINAL disposition, so `conductor_report` closes a run holding a blocked item — the refusal the
  plan describes fires on UNSETTLED (still PENDING) work; (b) the wave driver does not itself recover
  an item stranded by a sibling's commit — publish refuses it by name, REVIEWED→GREEN is the caller's.
- **13.2 (11.8 F1, qwen3.6-27b)** — a reasoning model can spend its whole `max_tokens` in
  `reasoning_content` and return EMPTY `content` with status 200. Send `enable_thinking=false` (via
  `chat_template_kwargs`) or `reasoning_effort:"none"` on schema-constrained calls.

## Lessons that keep paying

- **A green main tree proves nothing about a fresh checkout** (C-069); **a green fresh checkout proves
  nothing about the phase** (C-072); **green legs prove nothing at all when the phase is empty.** Cut
  the worktree, load the file set you will commit, `cmp`, `npm install`, run it **before** committing.
- **A scanner that PASSES while inspecting less than it appears to** is the recurring defect class
  (C-044…C-047, C-063, C-072, and again this round: M5 silently excludes untracked files). Make every
  scanner report how much it inspected — **and check that number against what you meant to inspect.**
- **A green suite that mutation-tests clean can still hide a MAJOR** (C-033, C-067(b), C-070). Read the
  prose, then **RUN the consequence, don't reason it** (C-068). And **a caught mutation is not a closed
  defect**: ask what the FIXTURE supplies that production does not (C-069, C-071).
- Pass plan EXCERPTS, never the 3,399-line plan. `wire-contract.test.ts` spawns a real `opencode
  serve` — under load all 15 subtests CANCEL, so re-run quiet before calling a regression.
- **Layout.** C++ tree is `router/`, `router/tests/`, `tools/`; include ROOT is the repo root; the
  plan's §1.1 tree is stale. Targets `llama-router`, `router-tests`, `membench`; schemas →
  `router/tests/schemas/` (gitignored). Build in `.out/build/clang-relwdebinfo`, **only** a named
  target — a bare `--build` hits `llama`.
