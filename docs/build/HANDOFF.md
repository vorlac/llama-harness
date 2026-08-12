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

- Nothing. Next task: **0.1** (DECISIONS.md, plan lines 1978–1998, tier C), then 0.3,
  then 0.2 (ordering override 1).

## What is parked

- Nothing.

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

1. Task 0.1: read plan 1978–1998, write conductor/DECISIONS.md (decisions a–g with
   alternatives, §6.2 record shape in prose), M5+M6 gate, commit
   `conductor: 0.1 standing decisions` + STATE row in same commit.
2. Task 0.3 (scaffold, plan 2042–2056) — includes package.json/tsc closure (prompt §3.4).
3. Task 0.2 (wire contract, plan 1999–2041) — must NOT skip; opencode 1.18.10 installed.
