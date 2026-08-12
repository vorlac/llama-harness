# HANDOFF — read this first on every start

Updated: 2026-08-13 (Phases 0-8 complete + gated; next = Branch B + Phase 9)

## Where we are

- **Phases 0-7 DONE + phase-gate PASS.** 24 manifest tasks committed. `git log
  --grep='^conductor: '` is authoritative for the list; `conductor-build:` commits are
  orchestrator infra (gate fixes), non-manifest.
  - **P0** wire contract pinned vs opencode **1.18.15** — read conductor/adapter/wire-notes.md
    before ANY adapter/router work. DRIFTs: NO prompt `format:{json_schema}` (structured
    output = prompt-shaped + independent validation + retry); permission reply = `POST
    /session/{id}/permissions/{permissionID}` `{response}`; plugin exports factory ONLY;
    realpath every dir handed to opencode; plugin-init failure = silent ungate (§3.8 beacon
    loud); requests STREAM SSE (scoped 11.6 to request-side counter + note).
  - **P1** git/shell gates (5 majors fixed, C-016). **P2** journal (torn-line heal, C-017).
    **P3** FSMs+scheduler (trivial-report work-loss MAJOR, C-018). **P4** state store+gitio
    (answerQuestion WEDGE C-020 + path-traversal C-021; bun leg ACTIVE+green). **P5**
    security MILESTONE (8 bypasses, C-022/C-023). **P6** evidence+quarantine MILESTONE (9
    crash-safety holes, C-024). **P7** fan-out concurrency (watchdog-armed-too-late MAJOR,
    C-025; F2 binding → 9.4c).
- **Phase 8 (doctrine) DONE + gate PASS.** 8.1: 9 packs + doctrine.test.ts, M4 PASS (00cdcd7).
  8.2: `adapter/inject.ts` (buildSystemAppend / paramsForRole / headersFor / loadPacks /
  initPlugin), M4 PASS (29a5011). Per-task review caught a MAJOR false-terminality bug +
  empty-pack hardening pre-commit (C-027). **Phase 8 gate** (3 blind lenses) found 7 confirmed:
  2 MAJOR dead packs (debug.md + receive-review.md loaded but injected to 0 sessions), review.md
  missing spec-before-quality ordering, core.md missing forbidden-phrases + ponytail reminder,
  7/9-pack anchor coverage. Fixed in 1 round / 2 commits (102802d packs, efd0f84 injection),
  843/843; receive-review.md DEFERRED to Phase 9 (binding below). C-028.

## What is next (immediate)

1. **Branch B (C++ router, 11.1-11.8)** — groundwork DONE (see branch-b-plan.md: run ON MAIN,
   submodules+ports+preset confirmed). Execute 11.1 as ONE focused sequence: CMakeLists surgery
   (remove myprogram block lines 42-68; add find_package httplib/nlohmann_json/validator/doctest
   + llama-router + router-tests targets) + vcpkg.json (+4 ports) + src/router skeleton +
   export-schemas.ts + ctest-green, then commit. CMakeLists/vcpkg/CMakePresets ORCHESTRATOR-ONLY.
   Build ONLY --target llama-router/router-tests (never bare --build → pre-broken llama).
2. **Phase 9 (tools MILESTONE, 9.1-9.6 SERIAL, NO-PARALLEL — all land in adapter/tools.ts).**
   Carries 9.1/9.4a/9.4c/9.5a/9.5b/9.6 bindings below. Then 10.1, 12, 13, 14, 15.
- Injection signature note: buildSystemAppend takes a trailing ctx {repoConfigured, taintCount,
  overridesRemaining}; an implementer's active item with `debugging:true` (optional GateItem
  field) gets debug.md; init-failure logs via the injected logError seam (§7.1 stderr), never a
  journal event (closed vocab has no init event — widening it is STOP-AND-PARK).

## Branch B (C++ router 11.1-11.8) — UNBLOCKED, parallel

Ready-to-execute scaffold plan in docs/build/branch-b-plan.md. Own $TMPDIR git worktree,
parallel to the spine (§6.2). 11.1 Step1 = scaffold (CMakeLists router targets + vcpkg.json
ports cpp-httplib/nlohmann-json/json-schema-validator/doctest + export-schemas.ts +
src/router skeleton); Step2 = LIVE upstream contract (manual, needs llama-server).
CMakeLists.txt/vcpkg.json/CMakePresets.json are ORCHESTRATOR-ONLY. cmake configure w/ 4 new
ports ~45min → background + poll. Build ONLY `--target llama-router` / `--target
router-tests`. src/ off-limits to GLOB sweeps until 11.1.

## Deferred bindings — still live (docs/build/specs/*.json phaseGateNBindings)

- **9.1**: enforce derived-decision scored options (decide.requireTwoOptions);
  ClassificationCheck correctedKind==null iff agreed.
- **9.4a/5.3**: decide + gate/handler consistent on dependency-readiness for direct per-item
  stage-tool calls (legalTools must not offer a stage tool for a dep-unready item).
- **9.4c** (P3+P7): dispatch_wave supplies PLAN_REVIEWED→EXECUTING context (survivingMajors:0
  iff planReviewRounds<max, else round>=max); AND a stale/over-age evidence-marker break MUST
  fire treeState.onClear so a leaked freeze marker becomes an env-fail, not a silent wave hang.
- **9.5a**: under-delivered skeptic panel must re-run or count missing verdicts as UPHOLDS.
- **9.5b**: report handler enforces all-settled as a NON-VERIFY precondition (closing
  re-verify is defeated by the foreign-red-set exclusion). Defense-in-depth.
- **receive-review.md delivery** (Phase 8 gate, C-028): the review-receipt / fix-round routing
  that sends surviving findings to the implementer MUST thread a "receiving-review" signal to
  `buildSystemAppend` so it appends `receive-review.md` (parallel to the debug.md/DEBUG-posture
  path already wired). The pack is loaded/cached now; only its delivery signal is deferred.
- **G7 residuals** (honest-limits-pending.md → fold into 15.1): backtick substitution + alias
  injection now DENY (C-022); residual obscure in-place writers; M5 marker scan is
  production-scoped (C-026, stray marker comment in a test caught by diff read only).

## Standing facts (don't re-derive wrong)

- Boot: orchestrator prompt §4.3. Plan IMMUTABLE (never tick its checkboxes). STATE.json is
  machine truth. docs/prompt-lifecycle.md STALE.
- Gate EVERY decision through `bash scripts/test-conductor.sh` (never raw `node --test` — node
  26.7.0 dir-positional = bogus red, zero-glob = vacuous green). It rejects SKIP/TODO
  directives at any depth (C-015) + tsc + bun legs. M5 = `scripts/conductor-gate.sh`.
- Commits verbatim from STATE.json commitMessage; NO trailers (no Co-Authored-By/Generated).
  Only the orchestrator commits. pytest = `/usr/bin/python3 -m pytest`. bun 1.3.14 installed.
- NEVER touch .data/ .out/ (~20GB gitignored, unrecoverable); never `git clean -x*`; never
  `git reset --hard` without a named stash; never touch submodule pointers / CMakePresets.json.
- Per-task loop §5: assertions file → IN_PROGRESS → test-writer → OBSERVE RED YOURSELF →
  implementer → OBSERVE GREEN YOURSELF → task gate (M1-M9; M4 = red re-derivation FROM the
  commit) → read the diff YOURSELF → revertAssertion → commit (STATE+HANDOFF same commit) →
  delete IN_PROGRESS. A subagent's "it's red/green" is NEVER accepted as evidence.
- Staging: parallel test-writers write to scratchpad/staging/task-<id>/; move in one at a
  time so the tree holds one red at a time. commitSha backfilled next STATE touch (a row's
  own commit can't know its sha; git log --grep on commitMessage authoritative meanwhile).
