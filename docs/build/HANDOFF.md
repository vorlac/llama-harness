# HANDOFF — read this first on every start

Updated: 2026-08-13 (Phases 0-8 + Branch B 11.1 done+gated; Phase 9 milestone underway — 9.1 done)

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

1. **Branch B 11.1 DONE (Step 1)** — CMake surgery on MAIN (myprogram removed; llama-router +
   router-tests targets vs 4 vcpkg ports; validator = `nlohmann_json_schema_validator::validator`;
   ctest 1/1 green; llama-router runs). export-schemas.ts (17 schemas) + test wired into
   test-conductor.sh; src/tests/schemas/ gitignored. Build dir `.out/build/clang-relwdebinfo`.
   Build ONLY `--target llama-router/router-tests` (never bare --build → pre-broken llama).
   **11.2 DONE** (header-only src/router/config.hpp, ns conductor::router; parse order defaults-
   BEFORE-schema-validate; ports 1..65535 in parser; ConfigError.field() dotted; doctest 7 cases
   119/119; M4 both directions; nit ledgered in STATE: empty-field() on input-JSON parse error).
   **Next Branch B: 11.3 proxy** (staged test being drafted by the lookahead workflow — vet from
   scratchpad staging/task-11.3/ + wire CMake MYSELF). Then 11.4 admission, 11.5 affinity, 11.6
   schema-observer (shrunk per 0.2: request-side schemaMissing counter + note; responses stream
   so response-validation is inert), 11.7 metrics, 11.8 (live).
2. **Phase 9 (tools MILESTONE, 9.1-9.6 SERIAL, NO-PARALLEL — all land in adapter/tools.ts).**
   **9.1 DONE** (C-029: 4 MAJOR + 2 minor found by a 3-lens review; 864/864).
   **9.2 DONE** (conductor_decompose + conductor_plan; NEW pure core/planning.ts; NEW SCHEMAS.Plan —
   forced, fanout's schemaName is mandatory; 887/887). C-030: a 3-lens skeptic-verified panel found
   **19** surviving defects incl. 2 MAJOR the 873-test suite missed — the size row was wired to
   trivialMaxFiles (default 2, spec says ~5) so every 3-file item was rejected under the DEFAULT
   config, and acceptance clustering broke on any criterion starting with "the". All fixed test-first
   (14 R-tests). M4 pending. **NEXT: 9.3** (a staged test exists at scratchpad staging/task-9.3/ from
   the lookahead burst — its writer died on a session limit, so VERIFY COMPLETENESS before trusting
   it). Then 9.4a-9.6. The Phase 9 MILESTONE gate runs after 9.6. Then 10.1, 12, 13, 14, 15.
   - **Assertion drafts exist in scratchpad staging/assertions-drafts/ for 9.4a, 9.4b, 9.4c, 9.5a,
     9.5b, 9.6, 10.1, 11.3, 11.4, 11.5, 11.6, 11.7, 12.1, 12.2** (14 files, each with a specGaps
     section + verified reusesExisting). They are DRAFTS: review each before promoting it to
     docs/build/specs/.
   - **SUBAGENT BUDGET LESSON (see the burst that produced those drafts):** ~79 agents / ~5.7M tokens
     in ~22 min exhausted a 5-hour account window. Fan-out multiplies cost — each agent re-read the
     3399-line plan independently. Throttle: skeptics for MAJOR findings only, pass plan EXCERPTS
     instead of letting each agent read the plan, batch findings per verifier, and prefer a
     lookahead of 1-2 tasks over 8.
   - FIRST-IMPLEMENTER TRAP (seen at 9.1): a subagent can return an anomalous/injected 0-edit
     "done" result — ALWAYS verify the actual tree (git status + run the test) before trusting green.
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
- **10.1 from 9.1 review (C-029):** (a) conductor_classify's question path sets ANSWERED but does
  NOT archiveRun — wire archival where the run lifecycle/retention is managed, not in classify;
  (b) conductor_decide does NOT consult isHumanTerritory — the 10.1 ask-gate must reject/surface a
  kind:derived decision on a human-territory question (decide.ts documents isHumanTerritory for it).
- **receive-review.md delivery** (Phase 8 gate, C-028): the review-receipt / fix-round routing
  that sends surviving findings to the implementer MUST thread a "receiving-review" signal to
  `buildSystemAppend` so it appends `receive-review.md` (parallel to the debug.md/DEBUG-posture
  path already wired). The pack is loaded/cached now; only its delivery signal is deferred.
- **11.1 Step 2 live upstream contract** → Task 12.1: measure llama-server's /v1 contract + the
  effective concurrent slot count via serve.py --no-shell (qwen3.6-27b), complete
  src/router/UPSTREAM_CONTRACT.md with a real WIRE_CONTRACT_VERIFIED stamp. Assets confirmed
  present (.out/llamacpp/bin/llama-server, .data/models/qwen3.6-27b). M8: observed output only.
- **G7 residuals** (honest-limits-pending.md → fold into 15.1): backtick substitution + alias
  injection now DENY (C-022); residual obscure in-place writers; M5 marker scan is
  production-scoped (C-026, stray marker comment in a test caught by diff read only).

## C++ / src layout (USER-DIRECTED, 2026-08-13 — supersedes the plan's §1.1 tree)

- `src/tools/` (was root `tools/`) and `src/tests/` (was `src/router-tests/`). The CMake TARGET
  is still named `router-tests` (it is the ctest name every gate row cites) — only the directory
  moved. Generated schemas now land in `src/tests/schemas/` (gitignored).
- **INCLUDE RULE: every in-workspace header is included by its FULL path relative to `src/`** —
  `#include "router/version.hpp"`, never `#include "version.hpp"`. `src/` is the only user-code
  include root on both targets, so an include names where the header actually lives regardless of
  which file includes it. Applies to ALL files under src/, headers included.
- Plan §1.1's tree (`src/router-tests/`, root `tools/`) is now STALE on this point; the plan stays
  IMMUTABLE, this deviation is recorded here and in STATE. `AUTOFORMAT_SRC_ON_CONFIGURE` runs
  clang-format over src/ at configure time — C++ reformatting in a diff is that, not a hand edit.

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
