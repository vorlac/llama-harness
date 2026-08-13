# HANDOFF — read this first on every start

Updated: 2026-08-13 (Phase 9 implementation COMPLETE; Branch B through 11.8's CLI; gate running)

## Current position — read docs/build/IN_PROGRESS.json FIRST

This file is the accumulated LESSONS and the per-phase history. The live position — which task
each lane is on, what is parked where, and which traps are currently in play — lives in
`docs/build/IN_PROGRESS.json`, rewritten every task. `docs/build/STATE.json` is the authoritative
task ledger (`status` + `commitSha`); `git log --grep='^conductor: '` is the authoritative commit
list.

At this writing: **43 of 54 manifest tasks committed.** Conductor suite 1126/1126 GATE PASS;
C++ 73 cases / 26,392 assertions. Phase 9 (9.1-9.6) is COMPLETE and its MILESTONE GATE is the
next step. Branch B has 11.8's live smoke left. Then 10.1, 12, 13, 14, 15.

**LAYOUT CHANGED (user-directed, after 9.6):** the C++ tree was hoisted — `src/` is now `router/`,
`src/tests/` is `router/tests/`, `src/tools/` is `tools/`. The include ROOT moved with it to the
repo root, so every header is still spelled `#include "router/config.hpp"` exactly as before.
CMake target names are unchanged. Anything below this line written before that move still says
`src/`; that is history, not instruction.

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
   **11.3 DONE** (a3bf1e7, header-only src/router/router.hpp: /v1/* proxy, RequestTags tag
   normalization with header-over-body precedence, SSE relayed unbuffered).
   **11.4 DONE** (e04fe14, src/router/admission.hpp + the router seam + the SG-2 maxQueued clamp
   inside 11.2's validation path; ctest 26/26). C-033, found by the ORCHESTRATOR'S OWN DIFF READ
   rather than a review panel: the chunked content provider did not capture the admitted slot, so
   on the STREAMING path (all generation traffic) the slot was released the instant the handler
   returned and `maxInflightPerModel` bounded nothing. The 8 authored rows were green and two
   mutations proved they discriminate — the stub simply always sets a Content-Length, so the
   buffered path was the only one ever exercised. Fixed test-first.
   **Next Branch B: 11.5 affinity**, then 11.6 schema-observer (shrunk per 0.2: request-side
   schemaMissing counter + note; responses stream so response-validation is inert), 11.7 metrics,
   11.8 (live).
   - **C++ M4 METHOD:** the configured build dir is bound to the MAIN worktree's source path, so a
     detached-worktree M4 would need its own ~45min vcpkg configure. Do the revert in the main tree
     with the tree verified clean against the commit — same guarantee, minutes not an hour.
2. **Phase 9 (tools MILESTONE, 9.1-9.6 SERIAL, NO-PARALLEL — all land in adapter/tools.ts).**
   **9.1 DONE** (C-029: 4 MAJOR + 2 minor found by a 3-lens review; 864/864).
   **9.2 DONE** (conductor_decompose + conductor_plan; NEW pure core/planning.ts; NEW SCHEMAS.Plan —
   forced, fanout's schemaName is mandatory; 887/887). C-030: a 3-lens skeptic-verified panel found
   **19** surviving defects incl. 2 MAJOR the 873-test suite missed — the size row was wired to
   trivialMaxFiles (default 2, spec says ~5) so every 3-file item was rejected under the DEFAULT
   config, and acceptance clustering broke on any criterion starting with "the". All fixed test-first
   (14 R-tests). M4 PASS. **9.3 DONE** (conductor_plan_review; findingBlocksItems in core/planning.ts;
   901/901). C-031 THROTTLED review (2 lenses, majors-only skeptics, spec quoted inline = 16 agents vs
   C-030's 79) found **5 MAJOR**: plan review could pass having dispatched ZERO reviewers (roster sized
   by the reader clamp); a bare `src/` token blocked the WHOLE queue; the ordinary citation forms
   (`./x`, bare filename, markdown link, possessive) blocked NOTHING; and two survivors naming one item
   made the ledger lie + released the item early. All fixed test-first (6 R-tests).
   **9.4a DONE** (conductor_submit_test + conductor_vet_test; NEW core/gates-phase depsReady — the
   9.4a/5.3 binding, ENFORCE; 921/921; 49ecf6d). C-032 THROTTLED review (2 lenses, majors-only
   skeptics = 18 agents) found **5 surviving MAJORs collapsing to 3 defects**, each found twice by
   independent lenses: the handlers DROPPED `evidence.legalRed`, so a full-scope fallback that failed
   elsewhere in the suite was admitted as this item's RED (`grep` showed legalRed was written by
   evidence.ts and read by NOBODY); a repaired test that stopped being red left `item.evidence.red`
   pointing at the PRE-repair failure, so a re-entered vet could advance a **PASSING** test to
   TEST_VETTED and thence GREEN with no red ever proven; and `testScope` paths were dereferenced
   un-normalised, so a `..` entry made the child runner EXECUTE an out-of-repo file and streamed it
   into a prompt. Plus 6 minors/nits. One MAJOR (F1, testWriter vs test-writer) was REFUTED by both
   skeptics — the diff's string is the one §3.3 names; recorded so it is not re-litigated.
   **The depsReady binding itself REGRESSED the run's exit** (a deferred dependency left dependents
   with no stage tool and no report — no legal exit at all); fixed by `cannotEverPublish`. My first
   version of that fix ALSO retracted recoverable BLOCKED deps and was caught by the committed
   8.2-null-recommendation test — the test's premise was right and the fix was too broad.
   **NEXT: 9.4b** (assertions ORCHESTRATOR-AUTHORED at docs/build/specs/task-9.4b.assertions.json —
   13 rows, 5 spec gaps; there was no lookahead draft for 9.4b, contrary to an earlier note here).
   Then 9.4c-9.6. The Phase 9 MILESTONE gate runs after 9.6. Then 10.1, 12, 13, 14, 15.
   - **9.4b's foreign-red quarantine needs NO evidence.ts change** (an earlier note here claimed it
     did — that was an orchestrator misread, corrected). `RunTestOptions` ALREADY carries
     `excludeTestFiles?: string[]` + stateHome/workspaceKey, landed with 6.1 and hardened by the
     Phase-6 gate fixes (968b5f8); 9.4a's `runItemTest` simply never passes it. 9.4b computes the
     foreign red set and PASSES it, on both the mark_green item-test path and the validate path.
     **LESSON: read the INTERFACE, not the call site, before declaring a surface missing.**
     The C-032 D1 interaction stands and is why this matters: the handler refuses an untargeted red
     whose excerpt names no testScope file, and the quarantine is exactly what makes a no-template
     fallback name the item's OWN file — without it a no-template item could never legally go red.
   - **REVIEW-RESULT TRAP (seen at 9.3):** a workflow returning an EMPTY finding set can mean the
     lenses CRASHED, not that the diff is clean. Always check the run's failures + journal.jsonl
     before treating an empty review as a pass.
   - **Assertion drafts exist in scratchpad staging/assertions-drafts/ for 9.4c, 9.5a, 9.5b, 9.6,
     10.1, 11.4, 11.5, 11.6, 11.7, 12.1, 12.2.** They are DRAFTS: review each before promoting it
     to docs/build/specs/. **The burst did NOT cover 9.4b or 9.5c** — both were authored directly
     by the orchestrator and are already in docs/build/specs/. Do not assume a draft exists because
     an earlier note said so; `ls docs/build/specs/` is the truth.
   - **SUBAGENT BUDGET LESSON (see the burst that produced those drafts):** ~79 agents / ~5.7M tokens
     in ~22 min exhausted a 5-hour account window. Fan-out multiplies cost — each agent re-read the
     3399-line plan independently. Throttle: skeptics for MAJOR findings only, pass plan EXCERPTS
     instead of letting each agent read the plan, batch findings per verifier, and prefer a
     lookahead of 1-2 tasks over 8.
   - FIRST-IMPLEMENTER TRAP (seen at 9.1): a subagent can return an anomalous/injected 0-edit
     "done" result — ALWAYS verify the actual tree (git status + run the test) before trusting green.
   - **SUBAGENTS CAN DIE MID-EDIT (2026-08-13): both implementers of the 9.4b/11.4 round were killed
     by a WEEKLY account limit (reset Aug 15 19:00 ET), leaving a NON-COMPILING tree** — 11.4's had
     written a complete admission.hpp but stopped between USING `admission_` and DECLARING it, and
     never wrote `sendAdmissionError`. FIRST ACTION after any agent failure is `git status` + a
     build; finish or revert deliberately, never assume "failed" means "wrote nothing". Recovering
     the work by hand was correct here and cost minutes.
   - **A GREEN SUITE THAT MUTATION-TESTS CLEAN CAN STILL MISS A MAJOR.** Before trusting any green,
     mutate the implementation and confirm the right row fails; then READ THE DIFF ANYWAY. C-033 was
     invisible to both, and was found only by reading a comment that claimed something the code
     three lines below did not do.
   - **MUTATE EVERY BRANCH OF A GUARD, NOT JUST THE GUARD (C-034).** A mutation that fails nothing
     does not mean the code is unreachable — it can mean two paths reach the same assertion and only
     one is under test. Deleting 9.4b's "never quarantine the item's own tests" guard left all 13
     rows green, because the queue half of the §4.2 union already skips the subject item; the guard
     is load-bearing only for the stale-red REGISTRY half, which no row exercised. That half is the
     dangerous one — the registry outlives runs, so an earlier run's entry can silence THIS item's
     own red.
   - **WITHOUT SUBAGENTS, the review substitute is: mutation-test every load-bearing claim, then
     read the whole diff.** That combination found C-033 and C-034 with no panel at all.
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
- ~~**9.4a/5.3**: gate/handler consistent on dependency-readiness~~ **DISCHARGED at 9.4a**
  (core/gates-phase depsReady, ENFORCE; see the regression it caused and its fix, above).
- **10.1 from 9.4a review (C-032 E7):** blockAndAsk/blockVetAndAsk append the question FIRST and
  setBlocked SECOND, and nothing reuses an already-open question for the same item+stage — so two
  in-flight calls, or a crash between the two writes, leave an OPEN question no item references
  (unanswerable through the normal path, since answerQuestion only clears items whose
  blocked.questionId matches). Same crash/partial-write class as the C-030/C-031 parks.
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

- **C++ LAYOUT, user-directed, two rounds.** First `tools/` -> `src/tools/` and
  `src/router-tests/` -> `src/tests/`; then the whole tree was hoisted: `src/` -> `router/`,
  `src/tests/` -> `router/tests/`, `src/tools/` -> `tools/`. The CMake TARGET is still named
  `router-tests` (the ctest name every gate row cites) and the INCLUDE SPELLING is unchanged —
  the include root moved from `src/` to the REPO ROOT, so `#include "router/config.hpp"` reads
  identically before and after. Generated schemas now land in `router/tests/schemas/`
  (gitignored). Plan §1.1's tree is stale on all of this and stays unedited.
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
- **revertAssertion rows must be VERIFIED, not reasoned.** At 9.4a, removing the `!edge.repairable`
  branch did NOT re-red [C032-D1] — that test configures `testRepairAttempts:0`, where the repair
  path blocks immediately anyway. Actually run each revert you claim; cite the one that fires.
- A commit whose subject deviates from STATE.json's commitMessage, or that carries a body or a
  trailer, is a slip: the 9.4a commit was written that way and amended before anything built on it.
  Narrative belongs in CORRECTIONS.md, not in the commit.
