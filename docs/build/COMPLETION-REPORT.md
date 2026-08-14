# Conductor build — completion report

**THE BUILD IS NOT COMPLETE.** `bash scripts/verify-acceptance.sh`, run by me in a clean worktree of
HEAD `dc42d88`, **exits 1** with **16 PASS / 5 FAIL**. Full output is reproduced verbatim in §1.

Three of the 52 manifest rows were never built — **13.2 (live smoke), 14.1 (bench driver), 14.2 (POC
run)**. Four of the five failing acceptance rows are the direct shadow of those three; the fifth
(row 3) is environmental, not a code defect. Nothing in this report should be read as "done".

| | |
|---|---|
| Ledger rows | 55 (52 manifest + 3 task-lets) |
| COMMITTED | 52 |
| NOT_STARTED | 3 — `13.2`, `14.1`, `14.2` |
| Acceptance | **16 PASS / 5 FAIL, exit 1** |
| Node suite at HEAD | tests=1277 pass=1277 fail=0 cancelled=0 skipped=0 todo=0 |
| bun leg | 8 pass |
| C++ (`router-tests`) | 92 doctest cases / 27,726 assertions, SUCCESS — **inherited, not re-run by me** (see §8) |
| Corrections filed | 76 (`C-001`…`C-075` + one "Known flake") |
| Phase gates | 0–11 PASS · 12 stage 1 PASS / stage 2 NEVER RUN · 13 no entry · 14 FAIL (phase does not exist) · 15 no entry |

---

## 1. Acceptance — verbatim

Procedure: `git worktree add --detach <scratch>/acc-final HEAD` (HEAD = `dc42d88`), then
`npm install` in `conductor/` (its `node_modules` is gitignored, so a bare worktree cannot run the
node or tsc legs at all), then `bash scripts/verify-acceptance.sh` from the worktree root. Exit code
**1**. The worktree was removed with `git worktree remove --force` afterwards; the pre-existing
`wt12` worktree belongs to another session and was left alone.

```text
==============================================================
 Conductor acceptance — plan §11 (12 rows) + §9 hollowness detectors
 repo: /private/tmp/claude-501/-Users-sal-development-vorlac-llama-harness/cb32b662-658b-46b9-a269-4ec4cc829f86/scratchpad/acc-final
 head: dc42d88
==============================================================

PASS  row 1a: 55 test files present (>= 24)
PASS  row 1b: full suite green — TAP: tests=1277 pass=1277 fail=0 cancelled=0 skipped=0 todo=0 skipdirectives=0 (node exit=0)
PASS  row 2: bun leg green (8 pass)
FAIL  row 3: no build dir at .out/build/clang-relwdebinfo
        configure with: cmake --preset clang-relwdebinfo
PASS  row 4: purity + dual-runtime + doctrine guards green
PASS  row 5: e2e green with all five scenarios named in TAP output
FAIL  row 6: conductor/SMOKE.md missing
PASS  row 7: conductor/docs/RUNNER-DISCOVERY.md present, 595 lines, with a command transcript
FAIL  row 8: docs/build/artifacts/conductor-report.md missing
        the POC report must be COMMITTED; .data/benchmark/ is gitignored
PASS  row 9a: serve.py offers --router/--no-router
PASS  row 9b: docs/build/artifacts/12.1-g5-equivalence.md present, 194 lines, with a command transcript
PASS  row 10: --parallel, maxInflightPerModel and per-slot context all derive from one number
PASS  row 11a: conductor/docs/OPERATIONS.md present (293 lines)
PASS  row 11b: conductor/docs/HONEST-LIMITS.md carries all 15 §9 limits
FAIL  row 12: manifest commits — missing: 13.2,14.1,14.2; duplicated: none
PASS  detector A: every §1.1 module exists, is non-empty, and is named by a test
PASS  detector B: all 9 doctrine packs present and non-trivial
PASS  detector C: every §1.1 router module exists and is non-empty
PASS  detector D: M5 clean — M5 PASS (117 file(s) scanned, 6 line exemption(s) all live)
FAIL  detector E: live artifact(s) missing: conductor/SMOKE.md docs/build/artifacts/conductor-report.md
PASS  detector F: UPSTREAM_CONTRACT.md carries a real WIRE_CONTRACT_VERIFIED stamp

==============================================================
 16 PASS   5 FAIL
 failing rows:
   - row 3: no build dir at .out/build/clang-relwdebinfo
   - row 6: conductor/SMOKE.md missing
   - row 8: docs/build/artifacts/conductor-report.md missing
   - row 12: manifest commits — missing: 13.2,14.1,14.2; duplicated: none
   - detector E: live artifact(s) missing: conductor/SMOKE.md docs/build/artifacts/conductor-report.md
==============================================================

$ echo $?
1
```

### What each failure means

- **row 3 — `no build dir at .out/build/clang-relwdebinfo`. ENVIRONMENTAL, not a defect.**
  `git worktree` does not check out submodules, so `extern/vcpkg` and `extern/llama-cpp` are empty
  in the worktree and `cmake --preset clang-relwdebinfo` reports the preset disabled. The C++ leg is
  green in the main repo (92 cases / 27,726 assertions) — but see §8, I inherited that number.
- **row 6 — `conductor/SMOKE.md` missing.** Task 13.2 never ran. The file must be committed and must
  contain a real command transcript including the substrings `retry` and `behavioral`; the script
  explicitly fails prose-only artifacts (`verify-acceptance.sh:143-147`).
- **row 8 — `docs/build/artifacts/conductor-report.md` missing.** Tasks 14.1 and 14.2 never ran. The
  report must be committed at that exact path (`.data/benchmark/` is gitignored) and must contain
  `baseline`, `doctrine`, `conductor`, `spread`, plus a transcript.
- **row 12 — manifest commits missing `13.2,14.1,14.2`** (duplicated: none). Each needs a commit
  whose message is the verbatim `commitMessage` from STATE.json for that row.
- **detector E — live artifacts missing**: the union of rows 6 and 8. Closing those closes this.

**Both missing artifacts are live measurements. Authoring either by hand is fabrication** — it flips
the meter green and the truth false (C-075). Row 3 is fixed by populating submodules and configuring
the preset, not by editing anything.

---

## 2. Per-task status — all 55 ledger rows

Source: `docs/build/STATE.json` (machine truth). `M` = manifest row. Rows with `M=no` are the three
task-lets adopted mid-build (`5.4`, `5.4a`, `12.1-G5`). Evidence is the row's own recorded `tap`
field, abbreviated.

| Task | M | Tier | Status | Commit | Message | Evidence | Att | Dev |
|---|---|---|---|---|---|---|---|---|
| `0.1` | yes | C | **COMMITTED** | `cf90018` | `conductor: 0.1 standing decisions` | — | 1 | 0 |
| `0.2` | yes | phase-gate:discovery-integrity | **COMMITTED** | `0cf8b82` | `conductor: 0.2 wire contract pinned` | tests=24 pass=24 fail=0 | 1 | 4 |
| `0.3` | yes | C | **COMMITTED** | `da2dab2` | `conductor: 0.3 scaffold` | tests=7 pass=7 fail=0 | 1 | 2 |
| `1.1` | yes | B | **COMMITTED** | `99751fc` | `conductor: 1.1 schemas` | tests=109 pass=109 fail=0 | 1 | 1 |
| `1.2` | yes | C | **COMMITTED** | `88c07f8` | `conductor: 1.2 shell/glob parse` | tests=172 pass=172 fail=0 | 1 | 0 |
| `1.3` | yes | B | **COMMITTED** | `29c7e03` | `conductor: 1.3 freshness/failure-class/stops/verdict` | tests=228 pass=228 fail=0 | 1 | 3 |
| `1.4` | yes | C | **COMMITTED** | `d078a21` | `conductor: 1.4 purity + dual-runtime guards` | tests=176 pass=176 fail=0 | 1 | 1 |
| `1.5` | yes | B | **COMMITTED** | `bbc0f85` | `conductor: 1.5 decision helpers` | tests=252 pass=252 fail=0 | 1 | 1 |
| `2.1` | yes | B | **COMMITTED** | `85e0f6a` | `conductor: 2.1 journal` | tests=302 pass=302 fail=0 | 1 | 1 |
| `2.2` | yes | C | **COMMITTED** | `06818b3` | `conductor: 2.2 bun runtime smoke` | tests=522 pass=522 fail=0 | 1 | 3 |
| `3.1` | yes | B | **COMMITTED** | `c61c99d` | `conductor: 3.1 FSMs` | tests=482 pass=482 fail=0 | 1 | 1 |
| `3.2` | yes | B | **COMMITTED** | `bd35785` | `conductor: 3.2 phase legality` | tests=482 pass=482 fail=0 | 1 | 1 |
| `3.3` | yes | B | **COMMITTED** | `680c6d9` | `conductor: 3.3 wave scheduler` | tests=482 pass=482 fail=0 | 1 | 1 |
| `4.1` | yes | B | **COMMITTED** | `db408ba` | `conductor: 4.1 state store` | tests=522 pass=522 fail=0 | 1 | 4 |
| `4.2` | yes | B | **COMMITTED** | `37ddab7` | `conductor: 4.2 gitio` | tests=522 pass=522 fail=0 | 1 | 1 |
| `5.1` | yes | A | **COMMITTED** | `0f2a282` | `conductor: 5.1 git policy` | tests=642 pass=642 fail=0 | 2 | 2 |
| `5.2` | yes | A | **COMMITTED** | `cc0ed55` | `conductor: 5.2 edit + session gates` | tests=691 pass=691 fail=0 | 1 | 3 |
| `5.3` | yes | A | **COMMITTED** | `3f794d6` | `conductor: 5.3 gate wiring` | tests=703 pass=703 fail=0 | 1 | 2 |
| `5.4` | no | A | **COMMITTED** | `1176178` | `conductor: 5.4 chat.message hook` | tests=703 pass=703 fail=0 | 1 | 2 |
| `5.4a` | no | A | **COMMITTED** | `4fa91c4` | `conductor: 5.4a chat.message plugin wiring` | suite: tests=1201 pass=1201 fail=0 skipped=0 todo=0; all five legs green (orchestrator-obs | 1 | 6 |
| `6.1` | yes | A | **COMMITTED** | `6727e37` | `conductor: 6.1 evidence engine` | tests=791 pass=791 fail=0 | 1 | 4 |
| `6.2` | yes | B | **COMMITTED** | `d02b642` | `conductor: 6.2 runner discovery probe` | — | 1 | 1 |
| `7.1` | yes | A | **COMMITTED** | `c3e1983` | `conductor: 7.1 fanout engine` | tests=816 pass=816 fail=0 | 1 | 1 |
| `7.2` | yes | C | **COMMITTED** | `0d39f34` | `conductor: 7.2 router client + failover` | tests=816 pass=816 fail=0 | 1 | 1 |
| `8.1` | yes | C | **COMMITTED** | `00cdcd7` | `conductor: 8.1 doctrine packs` | tests=826 pass=826 fail=0 | 1 | 1 |
| `8.2` | yes | B | **COMMITTED** | `29a5011` | `conductor: 8.2 injection` | tests=837 pass=837 fail=0 | 1 | 3 |
| `9.1` | yes | B | **COMMITTED** | `ed3d407` | `conductor: 9.1 intake + question tools` | tests=864 pass=864 fail=0 | 2 | 4 |
| `9.2` | yes | B | **COMMITTED** | `75a2531` | `conductor: 9.2 planning tools` | tests=887 pass=887 fail=0 | 1 | 6 |
| `9.3` | yes | B | **COMMITTED** | `1ad82b7` | `conductor: 9.3 plan review` | tests=901 pass=901 fail=0 | 1 | 6 |
| `9.6` | yes | A | **COMMITTED** | `d2bf346` | `conductor: 9.6 worktree mode` | tests=1124 pass=1124 fail=0 (suite); 9.6 file 21/21 | 0 | 2 |
| `9.4a` | yes | B | **COMMITTED** | `49ecf6d` | `conductor: 9.4a test submission + vetting` | tests=921 pass=921 fail=0 | 1 | 7 |
| `9.4b` | yes | B | **COMMITTED** | `40c6afe` | `conductor: 9.4b green/validate/amend` | tests=943 pass=943 fail=0 | 1 | 5 |
| `9.4c` | yes | B | **COMMITTED** | `9541271` | `conductor: 9.4c wave driver` | tests=979 pass=979 fail=0 | 1 | 5 |
| `9.5a` | yes | A | **COMMITTED** | `ef06717` | `conductor: 9.5a item review` | tests=1022 pass=1022 fail=0 (suite); 9.5a file 28/28 | 0 | 1 |
| `9.5b` | yes | A | **COMMITTED** | `5f1e592` | `conductor: 9.5b publish + report` | tests=1079 pass=1079 fail=0 (suite); 9.5b file 50/50 | 0 | 2 |
| `9.5c` | yes | B | **COMMITTED** | `e6625f8` | `conductor: 9.5c stop reports + hatches` | tests=1103 pass=1103 fail=0 (suite); 9.5c file 24/24 | 0 | 2 |
| `10.1` | yes | B | **COMMITTED** | `0978540` | `conductor: 10.1 continuation + ask gate` | tests=1244 pass=1244 fail=0; file 43/43 | 1 | 6 |
| `11.1` | yes | C | **COMMITTED** | `d6745de` | `conductor: 11.1 router scaffold + upstream contract` | tests=847 pass=847 fail=0 | 1 | 6 |
| `11.2` | yes | C | **COMMITTED** | `efdffc5` | `conductor: 11.2 router config` | ctest: 1/1 PASS; doctest 7 cases (scaffold+6 config), 119/119 assertions | 1 | 5 |
| `11.3` | yes | C | **COMMITTED** | `a3bf1e7` | `conductor: 11.3 router proxy` | ctest: 1/1 PASS; doctest 17 cases / 243 assertions (10 cases / 124 assertions are 11.3) | 1 | 7 |
| `11.4` | yes | B | **COMMITTED** | `e04fe14` | `conductor: 11.4 admission` | cases: 26 | 1 | 5 |
| `11.5` | yes | B | **COMMITTED** | `53c5bf7` | `conductor: 11.5 group affinity` | cases: 33 | 1 | 4 |
| `11.6` | yes | B | **COMMITTED** | `f142745` | `conductor: 11.6 schema observer` | ctest/doctest: 49 cases, 21883 assertions, 0 failed, 0 skipped | 0 | 1 |
| `11.7` | yes | B | **COMMITTED** | `41946bb` | `conductor: 11.7 metrics` | ctest/doctest: 66 cases, 26273 assertions, 0 failed, 0 skipped | 0 | 1 |
| `11.8` | yes | B | **COMMITTED** | `2e3dd96` | `conductor: 11.8 router live smoke` | ctest: router-tests 73 cases / 26392 assertions (CLI half, 6b732a3) | 1 | 2 |
| `12.1` | yes | B | **COMMITTED** | `589d22e` | `conductor: 12.1 serve wiring` | suite: tests=1186 pass=1186; all five legs green (node, tsc, bun, schema-export, python) | 1 | 8 |
| `12.1-G5` | no | C | **COMMITTED** | `3506dda` | `conductor-build: close acceptance rows round 1` | acceptance: scripts/verify-acceptance.sh row 9b PASS: docs/build/artifacts/12.1-g5-equival | 1 | 2 |
| `12.2` | yes | B | **COMMITTED** | `eb39500` | `conductor-build: phase 12 gate stage 1 repair` | suite: tests=1272 pass=1272 fail=0 cancelled=0 skipped=0 todo=0; all five legs green (node | 1 | 3 |
| `13.1` | yes | A | **COMMITTED** | `71c45a9` | `conductor: 13.1 e2e scripted` | suite: tests=1280 pass=1280 fail=0 cancelled=0 skipped=0 todo=0; all five legs green (node | 1 | 3 |
| `13.2` | yes | C | **NOT_STARTED** | `—` | `conductor: 13.2 live smoke` | — | 0 | 0 |
| `14.1` | yes | B | **NOT_STARTED** | `—` | `conductor: 14.1 bench driver` | — | 0 | 0 |
| `14.2` | yes | C | **NOT_STARTED** | `—` | `conductor: 14.2 POC run` | — | 0 | 0 |
| `15.0` | yes | B | **COMMITTED** | `2774e2d` | `conductor: 15.0 replay tool` | suite: tests=1186 pass=1186 fail=0 skipped=0 todo=0 (orchestrator-observed) | 1 | 3 |
| `15.1` | yes | C | **COMMITTED** | `c64c805` | `conductor: 15.1 ops docs` | suite: tests=1280 pass=1280 fail=0 cancelled=0 skipped=0 todo=0; all five legs green (node | 1 | 2 |
| `15.2` | yes | C | **COMMITTED** | `1d7074b` | `conductor: 15.2 dashboard` | ctest: 1/1 PASS; doctest 90 cases / 27673 assertions (was 73 / 26392 before 15.2) | 1 | 7 |

Four `commitSha` fields were `null` in STATE.json under the backfill convention (a row's commit
cannot know its own sha); I resolved them from `git log --grep -F` on the row's `commitMessage` and
wrote them back: `5.4a`→`4fa91c4`, `12.1-G5`→`3506dda`, `15.0`→`2774e2d`, `15.2`→`1d7074b`.

---

## 3. Unbuilt rows — diagnosis

All three are `attempts: 0`, `redEvidence: null`, `filesTouched: []`. None was attempted and
abandoned; each was dispatched into and bounced off a precondition.

**13.2 live smoke** (tier C, plan 2961-2976, message `conductor: 13.2 live smoke`) — blocked behind
13.1 for most of the build, and behind an unfinished composition root after it. `conductor/plugin/index.ts`
still maps every one of the 22 conductor tools to `handlerNotBound()`; `composition.test.ts:1537`
asserts that absence and names it 13.1 Step-2 glue (13.1 landed without it as a recorded deviation
because `tools.ts` had concurrent edits). Unbound, a live session cannot advance a single stage, so
there is nothing for a smoke run to observe. Binding the 22 tools is the prerequisite.

**14.1 bench driver** (tier B, plan 2979-3015, message `conductor: 14.1 bench driver`) — **code-complete
but uncommitted.** `scripts/conductor_bench.py`, `scripts/test_conductor_bench.py` and
`bench/conductor-tasks.json` exist in the working tree, untracked, and the python leg already passes
them. That is exactly why the main-tree gate reads green while the ledger reads NOT_STARTED. Two
traps for whoever lands it: M5 (`scripts/conductor-gate.sh`) never reaches `scripts/` and never sees
untracked files, so those three paths must be passed to it **explicitly**; and the files must land
under 14.1's own message, because acceptance row 12 counts each manifest message exactly once and
landing a row's files under another message makes its message permanently unachievable (C-073).

**14.2 POC run** (tier C, plan 3016-3025, message `conductor: 14.2 POC run`) — depends on 14.1 and on
a live, tool-bound session (13.2). 90 headless runs, hours; must be launched detached. **Its spec is
wrong and must be fixed first (C-075):** row `14.2-committed-copy` (spec:118) names
`bench/conductor-report.md` while the meter (`verify-acceptance.sh:163`) checks
`docs/build/artifacts/conductor-report.md`. Land both, byte-identical, and fix the spec **before**
the campaign — afterwards it is a post-hoc shuffle of the measurement.

---

## 4. PARKED / NEEDS_HUMAN / SKIPPED_UNMET

**No row in STATE.json carries any of those three statuses.** The ledger only ever used
`NOT_STARTED` and `COMMITTED`. The nearest recorded instances, each with its written diagnosis:

- **`SKIPPED_UNMET` — considered, never used.** The plan (§2.5) allows the bun/G14 acceptance row to
  be skipped if bun is unavailable. C-002 records bun 1.3.14 installed at preflight, so the leg is a
  real green and `no SKIPPED_UNMET path needed` (GATES.json `selfTests`).
- **Parked tests in staging** — 9.4c's red was parked in `staging/` while two review-fix rounds held
  the tree, so their green-gate definition of done was not broken by an unrelated red
  (STATE.json 9.4c `redEvidence`). C-061 records the rule this produced: a staged test is ready when
  its writer **returns**, not when the file appears.
- **Parked findings, both since closed** — C-032's E14 (roster sizing) closed by C-036; C-032's F5
  (§4.2 readiness) discharged by the same correction.
- **Workflow-run outcomes handed to me, all superseded by STATE.json.** The dispatch layer reported
  `12.2 BLOCKED (contradictory test rows)`, `13.1 BLOCKED (dirty tree owned by 12.2)`,
  `14.1 BLOCKED (same)`, `15.1 BLOCKED (agent died)`, and `12.1-G5 / 13.2 / 14.2 SKIPPED_DEP_BLOCKED`.
  Of those, 12.2, 13.1, 12.1-G5 and 15.1 subsequently landed and are COMMITTED. **13.2 and 14.2 never
  recovered from their dep-block, and 14.1 never recovered from its.** Those three blocks are the
  same three holes acceptance is reporting.

---

## 5. Corrections ledger — every entry

76 entries, read from the `##` headings of `docs/build/CORRECTIONS.md` (I did not read the bodies —
see §8).

- C-001 (2026-08-12) — Progress tracking moved out of the plan's checkboxes
- C-002 (2026-08-12) — bun installed at preflight; G14 leg is ACTIVE
- C-003 (2026-08-12) — pytest installed at preflight for /usr/bin/python3
- C-004 (2026-08-12) — login shell is zsh, not fish
- C-005 (2026-08-12) — canonical test command wrapped in scripts/test-conductor.sh
- C-006 (2026-08-12) — M3 typecheck invokes the local tsc binary, not bare `npx tsc`
- C-007 (2026-08-12) — one scaffold commit outside the 52-task manifest
- C-008 (2026-08-12) — Task 5.4 added; ordering overrides adopted
- C-009 (2026-08-12) — .gitignore negation for docs/build/
- C-010 (2026-08-12) — Task 0.3 smoke test asserts a real value, not `1 === 1`
- C-011 (2026-08-12) — gate sequencing + one out-of-order commit
- C-012 (2026-08-12) — opencode self-updated to 1.18.15 mid-build; wire contract pinned against it
- C-013 (2026-08-12) — M5 scope refinements (two)
- C-014 (2026-08-12) — fragment gained tools.task=false (cross-task edit, justified)
- C-015 (2026-08-12) — Phase 0 gate findings: skip-directive hole + wire-notes honesty
- C-016 (2026-08-12) — Phase 1 adversarial gate: 2 fix rounds, 6 future-task bindings
- C-017 (2026-08-12) — Phase 2 crash-recovery gate: journal torn-line heal
- C-018 (2026-08-12) — Phase 3 gate: trivial-report hole + G6 single-source guard
- C-019 (2026-08-12) — Task 4.1: stale-lock break routed to the journal, not an AnomalyRecord
- C-020 (2026-08-12) — Phase 4 gate: state/questions crash-safety + sandbox hardening
- C-021 (2026-08-12) — binding: registerConductorExclude vs a linked worktree (Task 9.6)
- C-022 (2026-08-12) — Phase 5 security MILESTONE gate: 4 gate bypasses + 1 spec gap
- C-023 (2026-08-12) — Phase 5 gate fix round 2: wrapper-with-flags git bypass
- C-024 (2026-08-12) — Phase 6 milestone gate: evidence/quarantine crash-safety + sandbox (expected-broken mechanism)
- C-025 (2026-08-12) — Phase 7 gate (concurrency): fan-out watchdog coverage
- C-026 (2026-08-12) — M5 marker scan scoped to production source (false-positive class)
- C-027 (2026-08-12) — Task 8.2 pre-commit adversarial review: 2 defects in inject.ts
- C-028 (2026-08-13) — Phase 8 (doctrine) gate: 7 confirmed findings, 1 fix round
- C-029 (2026-08-13) — Task 9.1 (tools MILESTONE): pre-commit adversarial review, 6 defects + 1 widening
- C-030 — Task 9.2 pre-commit adversarial review (3 lenses, skeptic-verified)
- C-031 — Task 9.3 pre-commit adversarial review (THROTTLED: 2 lenses, skeptics for MAJORS only)
- C-032 — Task 9.4a (conductor_submit_test + conductor_vet_test): adversarial review found 5 surviving MAJORs, 3 distinct defects
- C-033 — Task 11.4 (admission): the admitted slot was released mid-stream, so the cap bounded nothing that mattered
- C-034 — Task 9.4b (mark_green / validate / queue_amend): a guard no test could see
- C-035 — Task 9.4b: handleQueueAmend's signature contradicts the tool it implements (CLOSED)
- C-036 — the roster-sizing rule, decided once (closes C-032's parked finding E14)
- C-037 — rulings from the 9.5b/9.6 fact-check (one of them fixes a gate/handler split I created)
- C-038 — retroactive adversarial review, C++ half (Task 11.4): the thread budget could wrap negative
- C-039 — retroactive adversarial review, TypeScript half (Task 9.4b): a verify that ran NOTHING reported green
- C-040 — six rulings the 9.5b/9.6 promotion surfaced, plus an empirical correction to a Phase-4 binding
- C-041 — Branch B: no task in the plan makes llama-router runnable (RESOLVED at 11.8)
- C-042 — Task 9.5a: item review adjudicates EVERY finding; plan review adjudicates majors only
- C-043 — two rulings the 9.5b/9.5c reds need before either is implemented
- C-044 — the tool surface and the handler surface disagree in more places than C-035 (MAJOR)
- C-045 — a committed test file was BINARY, so grep silently skipped 26 tests (MAJOR, detection integrity)
- C-046 — Task 11.6: a pinned rule that passed for a masked reason (closed at delivery)
- C-047 — two tools could never have completed a single call (MAJOR); the guard gains a SHAPE half
- C-048 — C-043 ruling 1 is AMENDED: publishEnabled stays optional, and a construction replaces the requirement
- C-049 — Task 11.7: an unasserted exit path, closed; and a mutation-harness trap worth naming
- C-050 — the wave driver cannot drive the last three stages (OPEN; fix queued before the Phase 9 gate)
- C-051 — Task 11.8 CLI: a case whose own NAME claimed more than it tested; plus two harness notes
- C-052 — Task 9.6: a shape assertion that could not see the rule it was pinning; plus a latent publish bug
- C-053 — item review dispatched every session into the shared tree (MAJOR, activated by C-050)
- Known flake — the wire-contract suite under machine load
- C-054 — I documented a guard into existence and then trusted my own documentation (MAJOR)
- C-055 — a wildcard fileScope granted edit permission to the whole filesystem (MAJOR, security)
- C-056 — the Phase 9 gate's fix round: nine defects closed, three rulings ratified
- C-057 — M5 stopped scanning the C++ half at the layout move, and nobody noticed for eleven commits
- C-058 — Task 11.1 Step 2 executed, and the number it produced contradicts the plan's own recipe
- C-059 — Task 5.4's entire deliverable is unreachable in production (MAJOR)
- C-060 — serve.py is orchestrator-only and is also Task 12.1's deliverable
- C-061 — I copied a test file out of staging while its writer was still writing
- C-062 — Task 12.1, and the test catching the ORCHESTRATOR's live artifact in a wrong measurement
- C-063 — the Phase 11 gate, run late and worth the wait: one real MAJOR, found six times
- C-064 — two test-writers named the same function differently, caught before either committed
- C-065 — task-let 5.4a lands, and my own fix brief was wrong about the git gate
- C-066 — the Phase 11 major, fixed test-first, and a THIRD half the lenses did not find
- C-067 — two residuals in Task 10.1, found by reading the diff, recorded rather than fixed
- C-068 — C-067(b) was not a documentation defect, and the fix round proves it
- C-069 — a test asserted its own checkout's path, and only a fresh worktree could see it
- C-070 — a fix round that closed seven seams and left the eighth closed only for the fixture
- C-071 — the state machine writes down what it knows, and a failed send stops accusing anyone
- C-072 — the Phase 12 gate, stopped at stage 1: the phase was not finished
- C-073 — the Phase 12 gate, re-run: stage 1 PASS, and the string test kept passing
- C-074 — the Phase 14 gate, stopped before it started: the phase does not exist
- C-075 — acceptance repair round 2: nothing was repairable, and the meter says so twice

---

## 6. Phase gates

| Phase | Verdict |
|---|---|
| 0 | PASS after fix round 1 of 3 |
| 1 | PASS after 2 fix rounds (of 3 allowed) |
| 2 | PASS after 1 fix round |
| 3 | PASS after 1 fix round |
| 4 | PASS after 1 fix round |
| 5 | PASS after 2 fix rounds (of 3 allowed) |
| 6 | PASS after 1 fix round |
| 7 | PASS after 1 fix round |
| 8 | PASS after 1 fix round |
| 9 | PASS after fix round 1 of 3 |
| 10 | stage 1 FAIL (fresh-worktree python leg) → fixed → **stage 2 PASS after fix round 2 of 3**; all seven confirmed majors closed. Its stale `verdict` field still reads "STAGE 1 PASS"; the `status` field is the current one |
| 11 | PASS after fix round 1 of 3 |
| 12 | stage 1 FAIL → fix round → **stage 1 PASS**; **stage 2 NEVER RUN** (the phase gate as a whole is NOT PASS) |
| 13 | no entry in GATES.json — the phase-13 gate was never run |
| 14 | **FAIL** — phase 14 does not exist: both rows NOT_STARTED, zero committed work, nothing to review |
| 15 | no entry in GATES.json — the phase-15 gate was never run |

`rejections` in GATES.json: 11 recorded gate/finding rejections.

---

## 7. Open bindings carried forward

Curated from `HANDOFF.md` §"Deferred bindings", which is the current list; each traces to the
correction named.

- **9.1** — enforce derived-decision scored options (`decide.requireTwoOptions`);
  `ClassificationCheck.correctedKind == null` iff agreed. **C-028** — fix-round routing must thread a
  `receiving-review` signal to `buildSystemAppend`, parallel to the wired `debug.md` path.
- **12.1 survivors (C-062) — four of five STILL OPEN** (only the supervisor one closed):
  `wait_for_router_health` is called by no test (a `return True` stub survives the `curl -s 503`
  trap); `ROUTER_TERM_GRACE_S` has no upper bound; `derive_slots`' bool guard is unpinned.
- **C-067(a)** — C-032 E7's *prevention* half is wired at two of the four `implementer-blocked`
  question sites in `tools.ts`; the *repair* half covers all four.
- **13.1 measured two behaviours the plan sketched differently**: `blocked` is FINAL, so
  `conductor_report` closes a run holding a blocked item (the plan's refusal fires on PENDING work);
  and the wave driver does not recover an item stranded by a sibling's commit.
- **13.2 hazard (11.8 F1, qwen3.6-27b)** — a reasoning model can spend its whole `max_tokens` in
  `reasoning_content` and return EMPTY `content` with status 200. Send `enable_thinking=false` or
  `reasoning_effort:"none"` on schema-constrained calls.
- **Owed to the orchestrator, two scanner defects.** `conductor-gate.sh`'s default set is
  `git ls-files 'conductor/**/*.ts' 'router/**' 'tools/**'` — it never reaches `scripts/` (all of
  12.1's product) and never sees untracked files. And `test-conductor.sh` parses the python count
  from a fixed `/tmp/python-leg.out`: until that is `mktemp`, gates must run **serially**.

---

## 8. What I am least confident about

Written honestly, worst first.

1. **I did not re-run the C++ leg.** The "92 cases / 27,726 assertions, SUCCESS" figure in the
   summary table is inherited from the previous gatekeeper, who ran the *pre-built* binary at
   `.out/build/clang-relwdebinfo/router-tests` read-only in the main tree. I neither rebuilt nor
   re-ran it. In my worktree row 3 simply failed. So the strongest honest claim is: **the C++ half is
   unverified at HEAD by me**, and its last independent verification was of a binary, not of a build
   from HEAD's sources.
2. **"Clean worktree" is qualified.** The acceptance script cannot pass in a literally-from-scratch
   worktree: it needs `conductor/node_modules` (gitignored), populated submodules, and a configured
   cmake build dir (`.out/`, gitignored). I ran `npm install`; I did **not** populate submodules. If
   acceptance is meant to be reproducible from a bare checkout, `scripts/verify-acceptance.sh`
   (orchestrator-only) needs to provision or explicitly skip those legs. That decision is above my
   role and I did not touch the script.
3. **The scanners are the recurring defect class, and one of them is knowingly narrow.** Detector D
   reports "M5 clean, 117 files scanned" — but M5's default set never reaches `scripts/` and never
   sees untracked files. So detector D says nothing about 12.1's `scripts/` product or 14.1's three
   untracked files. C-044…C-047, C-057, C-063, C-072 and C-075 are all instances of "a scanner that
   passes while inspecting less than it appears to". I have no independent evidence that detectors
   A–F do not share that flaw; I ran them, I did not audit them.
4. **STATE.json is largely self-reported.** I verified the three NOT_STARTED rows directly, resolved
   four missing commit shas against `git log`, and took the remaining 48 COMMITTED rows' evidence
   fields as written by the roles that wrote them. Acceptance rows 1a/1b/12 and detectors A–D
   corroborate the shape of that ledger, not each row's individual claim.
5. **Corrections summaries are heading-level only.** I read the 76 `##` headings, not the 2,816-line
   body, under an explicit cost constraint. A heading that misdescribes its own body propagates into
   §5 of this report unchanged.
6. **The 1277 figure is HEAD-only; the 1280 figure quoted elsewhere is not.** My run measured a
   worktree of `dc42d88` and saw 1277/1277. The main tree currently reports 1280 because it contains
   uncommitted peer work — including 14.1's ~1,850 lines, which is precisely why a green main-tree
   gate did not notice that phase 14 does not exist (C-075). Trust 1277.
7. **I cannot rule out that closing rows 6, 8 and 12 exposes further failures.** Acceptance measures
   the plan's §11 rows; it does not measure whether the live smoke or the POC campaign will *succeed*
   when finally run. The composition root is still unbound, and 13.2 is the first thing that would
   exercise it end to end for real. My honest expectation is that binding 22 tools and running a live
   session finds new defects, not that it silently produces two files.
