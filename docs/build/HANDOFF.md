# HANDOFF — read this first on every start

## Position — 2026-08-19: the fix campaign's NON-LIVE work is COMPLETE; the next action is LIVE (owner-run)
Every code/doc phase of the plan (`docs/build/fix-campaign-plan.md`) that does not need a live model
is landed and committed — 17 commits from step-5 (`6a55d33`) through MACRO-021 (`464c840`); a
per-item record with evidence and residuals is **`docs/build/fix-campaign-log.md`**. HEAD gate:
**node 1811/1811, typecheck OK, bun 8, python 86, schema export OK, GATE PASS; router-tests 94/94**.
Design premise (governs everything): trust lives in the harness, not the orchestrator — any prompter
gets a self-defending result from local models only (`docs/reviews/conductor-review/step5-decisions.md`).
Both CRITICALs are closed (ISSUE-001 injection wired with a 3-layer delivery witness + a manifest that
catches its recurrence; ISSUE-002 default-mode writes via branded tree types). Phases done: 0 (D14
addendum amendment), I (GAP-035 clock, ISSUE-002/GAP-004/CR-2, ISSUE-088 canary, ISSUE-001 wiring),
II (trust floor — legality choke point + scope/TDD seams + vet criteria; every reproduced escape
gauntlet-verified closed), III (review witnesses + D5-strict disposition + human-file provenance),
IV (security XS + N-party single-writer lock + honesty), V.1/V.2 (doctrine content + pre-live
checkers + ISSUE-042 router key-bound), VII-A/VII-B (build floor: wiring manifest, cross-language
vocab registry, unreachable-exports/inversion/discrimination audits, standing mutation suite,
record-completeness checks, dashboard read = sound), MACRO-021 doc honesty.

**NEXT ACTION IS YOURS (live / attended / decisions):** (1) **Phase V.3 — 13.2 attended live smoke**,
now instrumented (GAP-046 probes, deny-rate, competence-outcome and briefing-bottleneck recording);
run the GAP-032 preflight (`core/preflight.ts`) as the go/no-go first. (2) **Phase VI (13.2-data-gated):**
the GAP-025 gate-posture flip + GAP-038 deny-recovery doctrine (D7 = measure first), then the **14.2**
campaign. (3) **Decisions:** the D2 tools.ts-split (Phase-16 planning), and the plan-immutability
collision on HONEST-LIMITS limits 8 & 11 (verbatim-pinned to the IMMUTABLE plan §9, now superseded by
D6/MACRO-021 — see fix-campaign-log.md). (4) **Serve.py live-launch items** (ISSUE-105 signal trap,
ISSUE-106 main-launch test) and the **deliberately-not-fabricated record backfill** (12 GATES.json
records, ~795 spec-row dispositions — tracked in KNOWN_MISSING allowlists, NOT faked). **The "Do these
in this order" list below is SUPERSEDED** (mapped into the plan's "Absorbed queue"; CR-2 landed in I.2).
Review steps 2–4 remain the evidence authority: three merged registers under
`docs/reviews/conductor-review/` — ISSUE-001…-142, MACRO-001…-034, GAP-001…-048 — with
`step5-preflight-review.md`'s corrections applied in place. Everything below this block is kept
unchanged as the 2026-08-14 build-state record, which is still accurate about the build itself.

## Position — 2026-08-14, after the non-live closeout pass
**The build is NOT complete, and everything still missing needs a live model.** In a fresh detached
worktree of HEAD (plus `npm install` in `conductor/`), `bash scripts/verify-acceptance.sh` exits 1 —
**16 PASS / 5 FAIL**. One of those five, **row 3, is environmental**: a worktree has no submodules so
the cmake preset is disabled. In the main tree row 3 is green (`ctest`: 100% tests passed, 92 cases /
27,726 assertions), so the real standing is **17 of 21**. The main-tree gate is **1326/1326 node,
typecheck OK, bun 8 pass, schema export OK, python `Ran 68 tests`, GATE PASS**.

**53 of 55 rows are COMMITTED.** Only **`13.2`** (live smoke) and **`14.2`** (the 90-run POC campaign)
are NOT_STARTED, and the four real acceptance failures are exactly those two tasks: row 6 wants
`conductor/SMOKE.md` (13.2), row 8 wants `docs/build/artifacts/conductor-report.md` (14.2), row 12
lists both missing commit messages, and detector E is their union. **Both are live measurements;
authoring either is fabrication** (`verify-acceptance.sh:143-147`). The repo owner is holding both
back to be scheduled deliberately — do not start either without saying so first.

**The tree matches HEAD.** (The `docs/plans/` and `docs/reviews/` work this line once named as
untracked is committed as of 2026-08-18.) `STATE.json` is machine truth.

## Do these in this order
1. **The 22 tools are BOUND — this step is DONE** (C-081, spec
   `docs/build/specs/task-13.1-composition-root.assertions.json`, 21 rows, `composition-root.test.ts`
   21/21). Every name reaches its committed `handleX` through one dependency bundle; `handlerNotBound`
   is deleted; the `[5.4a-tools-still-throw-scope-fence]` negative row was rewritten to assert the
   positive. **What remains of that task is CR-2** — the four `13.1-cr2-*` rows, i.e. the phase-13
   gate's MAJOR 6: `plugin/index.ts` still passes `fileScope: []`, `testScope: []`,
   `verifyInFlightTree: null` as literals to `gateBeforeToolCall`. That was NOT fixable before the
   binding (nothing constructed a fan-out, so no registry entry carried an `itemId` to derive a scope
   from) and IS fixable now. **Do CR-2 next; it is small and it closes a confirmed MAJOR.**
   Binding the tools also unblocks 13.2 and 14.2, which could not advance a stage before it.
2. **Phase gates 12, 13 and 15 have now run stage 2 and ALL THREE FAIL** — 22 confirmed MAJORs, 20 of
   them upheld with neither skeptic able to refute. Full record:
   **`docs/build/artifacts/phase-gates-12-13-15-findings.md`**, summarised in C-079. Phase 14's gate
   is FAIL and cannot pass until 14.2 exists. **Read the cross-cutting finding first
   (`GATES.json` → `phaseGates.m7CrossCutting`): M7 was recorded PASS for 13.1 and 15.1 and is
   satisfied by neither** — 13.1's 42 assertion rows are named by 5 test titles, 15.1's 25 rows by
   nothing at all, because the `conductor/tests/ops-docs.test.ts` its spec names does not exist.
   **Phase 15's half of that is DONE** (C-080, commit `a6ad3cd`): `conductor/tests/ops-docs.test.ts`
   now exists — 1,495 lines, 25 tests, one per assertion row — written first, observed red at 2/25,
   and the documents corrected until green. All ten of phase 15's MAJORs are closed and each is bound
   by a test that fails without its fix; the tests derive their expectations from the code (proved by
   mutating `router/main.cpp` and `conductor/adapter/state.ts` and watching the expectations move),
   so the docs stay checkable as the code changes. **The phase-15 gate is still NOT PASS**: stage 2
   has not re-run against the rewritten docs and the five MINORs are unadjudicated — a fix round's
   author does not close the gate it answered. **13.1 still needs the same treatment**: give its 37
   uncovered rows real tests rather than patching the five scenarios by hand. Phase 13's headline — every
   full-verify green in `e2e.test.ts` rests on a zero-match glob, so scenario 4's "real full verify"
   executes nothing — is the vacuous-green trap `scripts/test-conductor.sh` exists to close, sitting
   inside the build's own end-to-end. Phase 12's six are genuine product defects (an orphaned
   llama-server, a `--print-env` that reports a dead URL, a setup failover with an unrelated remedy,
   `setupRequiredScopes` writing empty or source-only coverage) and its suite is the one that does
   name its rows.
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
- Plan is **IMMUTABLE**; never tick its checkboxes. Gate EVERY
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
  now TEN appearances (C-044…C-047, C-063, C-072, C-075, C-078, C-081 ×2). The tenth is the one to
  remember: a test that drove real ops through the real bound tool against a real store, and asserted
  a real amendment was applied, stayed **20 pass / 0 fail** with core's validator bypassed entirely —
  because it only ever handed the tool WELL-FORMED input, which the handler accepts either way. **A
  test that only exercises the happy path cannot prove a validator is in the path; only its REFUSALS
  can.** Nothing but running the mutation by hand found it. Make every scanner report how much
  it saw — **and check that against what you meant it to see.** M5's default set now includes
  `scripts/*.py` with its own floor (128 files, was 117); `test-conductor.sh` uses a per-run `mktemp`
  scratch dir, so gates no longer have to be run serially to avoid reading each other's leg output.
- **A function whose name asserts a property must implement it** (C-081). `liveVerifyTrees` reported
  every marker FILE while `runVerify` honours one only when `pidAlive(pid) && !overAge` — a SECOND,
  broader definition of "live" one seam over, which would have let a crashed run wedge a tree forever,
  the exact thing runVerify's own comment promises can never happen. Found by reading the diff, not by
  a test. When a change adds a second reader of one fact, check it reads the fact the same way.
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
