# HANDOFF — read this first on every start

Updated: 2026-08-12T08:46Z (scaffold commit)

## Where we are

- Preflight COMPLETE. All §2.1 probes match ground truth (one triviality: login shell
  is zsh, not fish — C-004). bun 1.3.14 and pytest 8.4.2 INSTALLED (C-002, C-003):
  no SKIPPED_UNMET paths anywhere.
- Gate tooling built and self-tested 11/11 (GATES.json): `scripts/test-conductor.sh`
  (M1+M3) and `scripts/conductor-gate.sh` (M5). NEVER run raw `node --test` for a gate
  decision (C-005).
- STATE.json has all 54 rows (52 manifest + 5.4 + 12.1-G5), every one NOT_STARTED.

## What is in flight

- Nothing. DONE: 0.1, 0.3, 0.2 (wire contract pinned vs 1.18.15 — READ
  conductor/adapter/wire-notes.md before briefing 5.3/7.1/8.2/10.1/11.6/12.1; key
  DRIFTs: no format:{json_schema} anywhere; permission reply is POST
  /session/{id}/permissions/{permissionID}; plugin exports factory ONLY; realpath
  all dirs; init-failure = silent ungate), and 6.2 early (runner probe: node+pytest
  collect in-repo worktrees). Phase 0 phase-gate pending, then Phase 1.

## What is parked

- Nothing. Deferred obligations for Task 9.1's handlers (from 1.1's lens, GATES
  taskGates['1.1'].review): (a) derived decisions need scored options (use 1.5's
  requireTwoOptions); (b) ClassificationCheck correctedKind must be null iff agreed
  — enforce in the classify handler and cover both with tests there.

## Standing facts a fresh instance must not re-derive wrong

- Boot: follow orchestrator prompt §4.3 verbatim (docs/conductor-build-orchestrator-prompt.md).
- Plan = docs/plans/2026-08-07-conductor-harness-plan.md, IMMUTABLE, 3399 lines.
  docs/prompt-lifecycle.md is STALE — never implement from it.
- Commit messages: verbatim from STATE.json rows. NO trailers of any kind.
- pytest: invoke as `/usr/bin/python3 -m pytest` (CLI dir not on PATH).
- cmake: configure `cmake --preset clang-relwdebinfo`; build ONLY
  `cmake --build .out/build/clang-relwdebinfo --target <llama-router|router-tests>`.
  Full build is pre-broken (llama target, C++23 forced on submodule) — NOT ours.
- src/ is off-limits until Task 11.1 (GLOB_RECURSE sweeps any src/*.cpp into myprogram).
- Never `git clean -x*`; never touch .data/ or .out/ (20 GB unrecoverable-by-git).
- Model id spelled `qwen3.6-27b`; smoke model `ornith-9b`.
- Port 8080 must be verified free before/after any live-server work
  (`lsof -nP -iTCP:8080 -sTCP:LISTEN`).

## Next actions

1. Phase 0 phase-gate: Stage 1 fresh-worktree (needs npm install in conductor/),
   Stage 2 discovery-integrity + spec-conformance lenses.
2. Phase 1 (1.1 first; safe pairs {1.1,1.2,1.4} and {1.3,1.5} per prompt §6.2).
3. Branch B (C++ router worktree) unblocks after 1.1 (schemas): 11.6 scope is now
   pinned by 0.2 (streaming + no schema field -> request-side counter + note).
