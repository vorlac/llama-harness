# HANDOFF — read this first on every start

Updated: 2026-08-12 (Phases 0-3 complete + gated; Phase 4 underway)

## Where we are

- **Phase 0 DONE + gated** (0.1, 0.3, 0.2; 6.2 banked early). Wire contract pinned vs
  opencode **1.18.15** — read conductor/adapter/wire-notes.md before any adapter/router
  work. Key DRIFTs: NO prompt `format:{json_schema}` (structured output = prompt-shaped
  + independent validation); permission reply = `POST /session/{id}/permissions/{permissionID}`
  `{response}`; plugin exports factory ONLY; realpath every dir handed to opencode;
  plugin-init failure = silent ungate (§3.8 beacon must be loud); requests STREAM (SSE) —
  scopes 11.6.
- **Phase 1 DONE + milestone gate PASS** (1.1–1.5). 8 defects (5 majors) across 6 lens
  contexts; fixed in 2 rounds; orchestrator re-verified 26/26. See CORRECTIONS C-016.
- **Phase 2 DONE + gated** (2.1 journal, first adapter). Crash-recovery gate caught a
  torn-trailing-line durability gap; healed test-first (C-017).
- **Phase 3 DONE + gated** (3.1 FSMs, 3.3 scheduler, 3.2 phase-legality). Counterexample
  lens caught a trivial-report work-loss MAJOR (run closes with an item unsettled;
  handler re-verify defeated by the foreign-red-set exclusion); fixed reportLegal=allSettled
  + added the G6 single-source guard test (C-018). 482/482 green.
- HEAD clean. `git log --grep='^conductor: '` = 14 tasks: 0.1 0.3 6.2 0.2 1.1 1.2 1.4 1.3
  1.5 2.1 3.1 3.3 3.2 (+ `conductor-build:` gate-fix/marker commits, non-manifest).

## What is in flight

- **Task 4.2** (adapter/gitio.ts — read-only git queries, execFile shell:false, explicit
  cwd). Ordering override: 4.2 BEFORE 4.1 (4.1's createRun needs 4.2's reads; stubbing git
  would violate G4). Then 4.1 state store, then 2.2 bun smoke (the deferred G14 dual-runtime
  proof of state + journal — bun 1.3.14 installed, leg is ACTIVE).

## What is parked / unblocked

- **Branch B (C++ router, 11.1–11.7) is UNBLOCKED** — ready-to-execute scaffold
  plan (CMake surgery + submodule-in-worktree gotcha) in docs/build/branch-b-plan.md. (needs 1.1 schemas ✓ + 0.2 streaming
  ✓) and should run in its own $TMPDIR git worktree parallel to the spine (prompt §6.2 —
  treating it as "eleventh" wastes days). 11.1 Step 1 = scaffold (CMakeLists router
  targets + vcpkg.json ports cpp-httplib/nlohmann-json/json-schema-validator/doctest +
  export-schemas.ts + src/router skeleton); Step 2 = LIVE upstream contract (manual,
  needs llama-server). CMakeLists.txt/vcpkg.json are ORCHESTRATOR-ONLY. cmake configure
  with 4 new ports ~45min → background + poll. Build ONLY `--target llama-router` /
  `--target router-tests`. 11.6 scope shrank per 0.2 (request-side counter + note;
  responses stream SSE).

## Deferred obligations — future-task bindings (docs/build/specs/*.json phaseGate1Bindings)

- **5.1** git gate: deny matrix over FULL tokens, NOT single gitSubcommand. `git branch
  -D x` MUST deny (primary "branch" is allow-listed — the false-ALLOW trap). Red-team-by-
  data includes value-flag globals + env/wrapper prefixes. (shell-parse now: gitSubcommand
  fail-safe on unknown globals; isGitCommand unwraps env-assign/env/command/sudo/exec +
  basename.)
- **5.2**: writeShapedPaths wrapper-aware; no reliance on maybe-undefined evidence fields.
- **6.1**: evidence.ts validates per-kind required fields; RELATIVIZE absolute cwd-prefix
  in stderr before classifyFailure (repo is ESM → absolute module-not-found paths); ship
  tight anchored runnerRules tested vs conductor/docs/RUNNER-DISCOVERY.md.
- **9.1**: enforce derived-decision scored options (decide.requireTwoOptions);
  ClassificationCheck correctedKind==null iff agreed.
- **9.5a**: under-delivered skeptic panel must re-run or count missing verdicts as UPHOLDS.
- **3.3**: nextWave treats empty/degenerate scope conservatively (serialize) — DONE (built
  with the binding).
- **9.4c** (Phase-3 gate): dispatch_wave supplies PLAN_REVIEWED→EXECUTING context
  (survivingMajors:0 if planReviewRounds<max, else round>=max) — satisfiable-by-construction
  since you only reach PLAN_REVIEWED by satisfying the exit condition. Else clean-path livelock.
- **9.5b** (Phase-3 gate): report handler enforces all-settled as a NON-VERIFY precondition
  (the closing re-verify is defeated by the foreign-red-set exclusion). Defense-in-depth.
- **9.4a/5.3** (Phase-3 gate): decide + make gate/handler consistent on dependency-readiness
  for direct per-item stage-tool calls (legalTools offers a stage tool for a dep-unready item).
- **G7 residuals** (docs/build/honest-limits-pending.md → fold into 15.1): backtick
  substitution, alias injection, sh -c/bash -c wrappers, $'...' quoting.

## Standing facts (don't re-derive wrong)

- Boot: orchestrator prompt §4.3. Plan IMMUTABLE. docs/prompt-lifecycle.md STALE.
- Gate every decision through `bash scripts/test-conductor.sh` (never raw node --test); it
  rejects SKIP/TODO directives at any depth (C-015). M5 = scripts/conductor-gate.sh.
- Commits verbatim from STATE.json; NO trailers. pytest = `/usr/bin/python3 -m pytest`.
  bun 1.3.14 installed. Never touch .data/ .out/; never git clean -x*; never reset --hard
  without a named stash. src/ off-limits until 11.1.
- Per-task loop §5: assertions file → IN_PROGRESS → test-writer → OBSERVE RED YOURSELF →
  implementer → OBSERVE GREEN → task gate (M1-M9; M4 red re-derivation from the commit) →
  read diff → revertAssertion → commit (STATE+HANDOFF same commit) → delete IN_PROGRESS.
- Staging: parallel test-writers write to scratchpad/staging/task-<id>/; move in one at a
  time so the tree holds one red at a time.

## Next actions

1. Finish Phase 4: 4.2 gitio (in flight) → 4.1 state store (big: adapter/state.ts +
   adapter/questions.ts per prompt §3.3; lockfile, atomic tmp+rename, retention, beacon,
   .git/info/exclude) → 2.2 bun smoke (`conductor: 2.2 bun runtime smoke`, lands right
   after 4.1) → Phase 4 gate (crash-recovery + filesystem-safety lenses; stray-write scan).
2. Phase 5 (5.1–5.4, milestone gate — carries the 5.1/5.2 phaseGate1Bindings + adds Task
   5.4 chat.message hook per prompt §3.3). Then 6.1 (evidence; carries 6.1 bindings +
   adapter/quarantine.ts per §3.3), 7, 8, 9 (serial; 9.x bindings), 10, then 11 (Branch B),
   12, 13, 14, 15.
3. In parallel, spin up the Branch B worktree for the C++ router (unblocked; see above).
