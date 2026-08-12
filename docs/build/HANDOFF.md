# HANDOFF — read this first on every start

Updated: 2026-08-12 (Phase 1 complete + milestone gate PASS)

## Where we are

- **Phase 0 DONE + gated** (0.1, 0.3, 0.2; 6.2 banked early). Wire contract pinned vs
  opencode **1.18.15** — read conductor/adapter/wire-notes.md before any adapter/router
  work. Key DRIFTs: NO prompt `format:{json_schema}` (structured output = prompt-shaped
  + independent validation); permission reply = `POST /session/{id}/permissions/{permissionID}`
  `{response}`; plugin exports factory ONLY; realpath every dir handed to opencode;
  plugin-init failure = silent ungate (§3.8 beacon must be loud); requests STREAM (SSE) —
  scopes 11.6.
- **Phase 1 DONE + milestone gate PASS** (1.1–1.5). Gate found 8 confirmed defects (5
  majors) across 6 lens contexts; fixed in 2 rounds; orchestrator re-verified 26/26
  malicious inputs. 279/279 green. See GATES.json phaseGates.1 and CORRECTIONS C-016.
- HEAD is clean. `git log --grep='^conductor: '`: 0.1, 0.3, 6.2, 0.2, 1.1, 1.2, 1.4, 1.3,
  1.5 (+ 2 `conductor-build:` gate-fix commits, non-manifest).

## What is in flight

- **Task 2.1** (journal: core/journal-events.ts + adapter/journal.ts) — test-writer
  dispatched. First ADAPTER module → G14 dual-runtime rules apply (node:fs/child_process
  only, no Bun; the purity guard scans it).

## What is parked / unblocked

- **Branch B (C++ router, 11.1–11.7) is UNBLOCKED** (needs 1.1 schemas ✓ + 0.2 streaming
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
- **3.3**: nextWave treats empty/degenerate scope conservatively (serialize).
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

1. Finish 2.1 (observe red, implement, gate, commit `conductor: 2.1 journal`).
2. Phase 3 (3.1 FSMs, 3.2 phase legality, 3.3 wave scheduler — safe pair {3.1, 3.3}).
3. Phase 4 in override order: 4.2 gitio FIRST, then 4.1 state store, then 2.2 bun smoke.
4. In parallel, spin up the Branch B worktree for the C++ router.
