# Sweep — Assertion Rows, Test Quality, Reachability (P8, P12, P13)

**Date:** 2026-08-16
**Reviewer scope:** Every row in `docs/build/specs/*.assertions.json` against the tests that claim
to prove it — named vs proven vs unreachable vs self-contradictory. Plus P12: every branch in the
codebase requiring an unusual precondition (failure, cap, timeout, retry, degraded mode, second
attempt, crash) checked for a test that reaches it. Phase 13's known 22/42-named / four-unproven
floor re-verified and extended to every other spec file.
**Status:** COMPLETE (2026-08-16). All mutations restored and cmp-verified; tree clean at
finish; no spawned processes outlived the sweep.

**Summary of findings:** 2 MAJOR (SWEEP-002: 14 of 21 G5 ledger rows unmet with no
supersession record and the acceptance meter ticking anyway; SWEEP-003: two 11.8 live rows
discharged by nothing and undisclosed), 2 borderline MAJOR/MINOR (SWEEP-005: e2e passes 35/35
under a blanket-deny gate; SWEEP-006: 20 of 42 phase-13 rows untraceable by id, four still
e2e-blind though now unit-covered), 3 MINOR (SWEEP-001 false coverage claim; SWEEP-004
anti-tautology check hole, reproduced; SWEEP-007 comment-only row links), 2 sweep-result
records (SWEEP-008 P8 clear; SWEEP-009 P12 residue = exactly the live/system paths the unmet
rows owe). 6 IDEA entries, 7 cross-lens pointers, 5 mutations run (4 bind, 1 does not).
One known-open item found BETTER than recorded (C-091's probe now unit-covered both branches).

---

## 0. INVENTORY BASELINE (mechanical, script-derived; scripts in session scratchpad)

- 60 spec files under `docs/build/specs/`, **795 assertion rows total**. Every row has
  `id`, `text`, `coveredByTest`; 220 also have `planLine`; 3 have `addedBy`.
- `coveredByTest` is **null on 548 of 795 rows** (all of phases 9.2+ onward use test-title naming
  instead of the field; the field is only populated for early tasks 0.x–9.1 and a few artifact
  tasks). The linkage convention for later tasks is: the row id appears verbatim in a test title.
- Row-id presence scan across `conductor/tests/`, `conductor/tests/fixtures/`, `scripts/`,
  `router/tests/`, `conductor/tools/`:
  - **658 rows: id appears in a test/case TITLE** (it/test/describe/TEST_CASE/name:/msg-style).
  - **19 rows: id appears in a COMMENT ONLY** (mapping comments; see ISSUE-004 area).
  - **118 rows: id appears NOWHERE in any test file.**
- Per-file named/total for files below 100%: task-0.1 5/8 · task-0.2 17/19 · task-0.3 3/7 (3 of
  the 4 "named" are comment-only) · task-1.5 0/4 · task-5.3 6/7 · task-6.2 0/7 · task-11.1 1/4 ·
  task-11.8 1/12 · task-12.1-G5 0/21 · task-13.1 22/42 · task-13.2 0/19 (NOT_STARTED, disclosed) ·
  task-14.2 0/18 (NOT_STARTED, disclosed) · fix-phase12-g5 1/6.
- Phase 13's known "22/42 named" floor is **confirmed exactly** by independent re-derivation.
- **Caveat on the mechanical counts:** id matching is substring-based, so SHORT early-task ids
  can collide (e.g. `0.1-b` matches inside `10.1-binding-…`), mildly inflating "named" counts
  for tasks 0.x–2.x only. Every per-task verdict in this file is from reading the actual test
  text, not from the mechanical count, so the findings are unaffected.

---

## 1. ISSUE REGISTER

(entries numbered SWEEP-ROWS-AND-TESTS-NNN)

### SWEEP-ROWS-AND-TESTS-001 — Row `5.3-direct-drive`'s coverage claim is false: no test name carries the id

**Pattern:** P13 (named-without-proving, inverted: the LEDGER names a test that does not name the row) / P1 (a record inspecting less than it appears to).
**Where:** `docs/build/specs/task-5.3.assertions.json` row `5.3-direct-drive`;
`conductor/tests/gate-wiring.test.ts`.
**What:** The row's `coveredByTest` reads `"gate-wiring.test.ts (names carry 5.3-direct-drive);
orchestrator-reverified fail-closed"`. `grep -o "5\.3-[a-z-]*" conductor/tests/gate-wiring.test.ts`
returns ids `5.3-api, 5.3-edit-deny, 5.3-fail-closed, 5.3-fail-open, 5.3-git-deny,
5.3-journal-law, 5.3-registry-first, 5.3-spawn, 5.3-tool-inventory` — **`5.3-direct-drive` appears
zero times anywhere in the repo outside the ledger row itself.** The claim "names carry
5.3-direct-drive" is literally false.
**Mitigation observed (my attempted refutation):** the row text is "tests drive exported hook
functions directly with synthetic inputs + fixture session registry (no opencode)" — a property of
the test file's own construction, which the file does plausibly satisfy as a whole. So the
underlying property likely holds. What is defective is the ledger's specific, checkable claim of
naming, which a reader (or a future M7-style counter) would take at face value.
**Also observed:** gate-wiring.test.ts carries two ids (`5.3-edit-deny`, `5.3-fail-open`) that
exist in NO ledger row — orphan ids that make id-grep an unreliable way to find rows.
**Severity:** MINOR (ledger accuracy; the property itself is plausibly held).
**Fix direction:** either rename tests to carry the id or change the row's coveredByTest to say
"file-construction property, verified by reading" — and add ledger rows (or drop ids) for the two
orphan ids.

### SWEEP-ROWS-AND-TESTS-002 — task-12.1-G5: 14 of 21 promoted ledger rows are unmet, with no supersession record; STATE.json says COMMITTED and acceptance row 9b passes anyway

**Pattern:** P13 (rows proven by nothing) + P8 (a row's own tick-condition violated by the meter
that ticked it) + build-record honesty (the ledger's silence about a scope reduction).
**Where:** `docs/build/specs/task-12.1-G5.assertions.json` (21 rows, promoted 2026-08-13, commit
013ebc9) vs the shipped fix (commit a48c346, 2026-08-15: `conductor/tools/g5-equivalence.ts`,
`conductor/tools/g5-artifact-check.ts`, `conductor/tests/g5-artifact.test.ts`, e2e's
`CONDUCTOR_E2E_ROUTER_PORT` seam, `docs/build/artifacts/12.1-g5-equivalence.md`);
`docs/build/specs/fix-phase12-g5.assertions.json` (the fix's own, narrower 6-row spec);
`scripts/verify-acceptance.sh:178`; `docs/build/STATE.json` task `12.1-G5`.

**What happened, reconstructed from git:** The 21-row spec was promoted on 08-13 as the governing
ledger for the G5 equivalence step. C-089 then found the shipped equivalence was a tautology
(two identical commands; no router touchpoint in the e2e). The fix (08-15) is real and good — a
driver that spawns the actual llama-router, seeds it a random 3–7 requests, fingerprints its
metrics, runs the e2e twice differing in an env var the source really reads, proves the WITH
arm's reports carry the router-served fingerprint, kills the router, proves the port dead, runs
the WITHOUT arm, compares terminal state / dispositions / commit set per scenario, and machine-
checks its own artifact against the two-identical-arms shape. **But the fix was built against its
own new 6-row spec (`fix-phase12-g5.assertions.json`), not against the promoted 21-row spec** —
and the 21-row spec was left in place, all 21 `coveredByTest: null`, zero ids named by any test,
with no waiver, no supersession note, and no per-row disposition anywhere I could find (checked:
specs file itself, CORRECTIONS.md C-089, GATES.json 12.1 entries, the artifact, HONEST-LIMITS.md).

**Per-row verdicts (21 rows, side-by-side with the shipped code):**

| Row | Verdict | Evidence |
|---|---|---|
| 12.1-G5-arm-construction | PARTIAL | shared e2e program & scenario list yes; ephemeral port 8391 yes; health-200-before-arms yes (g5-equivalence.ts:283-296); but config is hand-written inline (:210-228), not the generated one the row names |
| 12.1-G5-generated-config-and-parallel-derivation | UNMET | driver never imports/calls `generate_router_config`; config JSON literal at g5-equivalence.ts:210-228 |
| 12.1-G5-baseurl-only-difference | PARTIAL (config-generator level only) | the shipped equivalence run uses no opencode session configs (arms differ in `CONDUCTOR_E2E_ROUTER_PORT` + `CONDUCTOR_E2E_FACTS`); but `scripts/test_conductor_wiring.py:1519 test_12_1_g5_equivalence` proves the GENERATED session configs differ only in `provider.*.options.baseURL` — the row's property at the config level, not at the run level |
| 12.1-G5-terminal-state-identical | PARTIAL | terminal state compared per scenario incl. bad-ending-run1/run2; but `stop.reasonDisplay` verbatim and `excludedStaleRed` set comparison are absent from ScenarioFacts (e2e records terminalState/dispositions/commitSet only) |
| 12.1-G5-item-dispositions-identical | PARTIAL | driver compares {id, state, blocked:boolean, deferred:boolean} (g5-equivalence.ts:47-52); row demands blocked{reason,stage,questionId-present}, deferred detail, ordered taint kinds, all `attempts` counters, per-item evidence-kind sets — none compared |
| 12.1-G5-commit-set-identical | PARTIAL | per C-089's own description the compared set is `sorted unique git log --name-only` + count — file paths, unordered; the row demands an ORDERED list of {subject, name-status sorted by path} plus per-arm trailer-free re-assertion |
| 12.1-G5-report-identical-except-metrics | UNMET | no report.md section comparison anywhere in the driver |
| 12.1-G5-permitted-difference-allowlist-closed | UNMET | no normalizer, no allowlist constant, no full-artifact-set comparison |
| 12.1-G5-comparator-discriminates | UNMET | the driver's comparator has no mutate-one-field-and-expect-fail self-check; the anti-vacuity that DOES exist (g5-artifact-check + its test) covers the ARTIFACT shape, not the comparator — the exact C-033/C-034 lesson the row encodes is unenforced |
| 12.1-G5-traffic-leg-router-actually-in-path | UNMET | no leg B; no opencode serve, no stub-LLM traffic through the router |
| 12.1-G5-status-equivalence-per-request | UNMET | no leg B |
| 12.1-G5-schema-tagged-never-rejected | UNMET | no leg B end-to-end proof (router unit tests observe schema, but the row demands the wire path) |
| 12.1-G5-stream-relay-equivalent | UNMET | no leg B; SSE relay only proven in router/tests/proxy_test.cpp unit scope |
| 12.1-G5-no-admission-refusal-by-construction | UNMET | driver never reads max-in-flight/queue-depth from the ledger nor asserts cap arithmetic |
| 12.1-G5-router-killed-midrun-still-identical | UNMET | the kill happens BETWEEN arms (g5-equivalence.ts:364-372), never mid-run; no third pass exists |
| 12.1-G5-hostile-router-still-identical | UNMET | no hostile-router pass (500 health / non-JSON metrics listener) exists; router-client's non-200 and parse-failure paths are exercised only in router-client.test.ts unit stubs |
| 12.1-G5-supervisor-restart-observed | UNMET | no supervisor involvement in the driver at all |
| 12.1-G5-failover-limit-recorded | UNMET | grep of the artifact and HONEST-LIMITS.md finds no `resolveBaseUrl`/`noteRouterFailure`/failover-not-proven statement anywhere |
| 12.1-G5-non-v1-404-recorded | UNMET | the router.hpp:85-89 `/v1/.*`-only 404 exception is recorded neither in the artifact nor in HONEST-LIMITS.md (HONEST-LIMITS limit 9 covers only the schema observer) |
| 12.1-G5-skip-coupling-guard | PARTIAL/DIFFERENT SHAPE | no "G5 suite" with a skip-tag exists; WITHOUT arm is unconditional in the node suite, WITH arm is a driver that hard-fails when the binary is absent — the row's unconditional coupling-guard test does not exist |
| 12.1-G5-acceptance-record | PARTIAL, AND ITS TICK CONDITION IS VIOLATED | artifact + STATE.json row exist; but the row says §11 row 9 is ticked ONLY when "legs A, B and C all passed" — legs B and C were never built, and `scripts/verify-acceptance.sh:178` passes row 9b on artifact presence + substrings "no-router" and "terminal state" alone. The meter satisfies the row's letter with none of its condition. |

**Why this matters beyond bookkeeping:** the 21-row spec is this build's own definition of what
"G5 holds" means. What shipped proves a real but much narrower claim: *the metrics seam is the
plugin's only router touchpoint and its presence/absence does not change the three compared
facts of a model-free scripted run*. What the spec defines G5 to mean additionally includes:
real provider traffic through the router arriving byte-identical with no router-minted statuses
(leg B), mid-run router death and hostile-router degradation not changing outcomes (leg C), and
an anti-vacuity self-check keeping the comparator honest. None of that exists, and the record
(STATE.json COMMITTED + acceptance 17 PASS including 9b) reads as if the step is discharged.
A careful reader who trusts the ledger would believe G5 is proven at the promoted spec's
strength; it is proven at the fix-spec's strength.
**My attempted refutation (recorded per method):** one could argue the fix spec legitimately
supersedes the promoted spec, C-089 being the authority. But CORRECTIONS.md C-089 never says
"task-12.1-G5.assertions.json rows X..Y are withdrawn"; the file remains in `specs/` with equal
standing to every other ledger; and the acceptance-record row's tick condition is violated by
the very meter that reports PASS. The refutation fails: at minimum the record is silently
inconsistent; at most 14 rows of enforcement are believed rather than known.
**Severity:** MAJOR.
**Fix direction:** either (a) author a per-row disposition into task-12.1-G5.assertions.json
(met-by / superseded-by-fix-phase12-g5 / deferred-with-owner), or (b) implement the missing
legs; and make verify-acceptance row 9b check something leg-B/C-shaped or state in the artifact
that legs B/C are out of scope. Also register the failover-not-proven and non-v1-404 honesty
notes in HONEST-LIMITS.md as their rows demand.

### SWEEP-ROWS-AND-TESTS-003 — task-11.8: two LIVE rows (`11.8-streaming-live`, `11.8-failsoft-equivalence`) are discharged by nothing and NOT disclosed as undischarged; the artifact's own "does NOT discharge" section omits them; task-gate M7/M8 recorded PASS

**Pattern:** P13 (rows proven by nothing) + P9 (a record that reads as complete while omitting
its load-bearing probe) + P10-adjacent (the gate sealed it).
**Where:** `docs/build/specs/task-11.8.assertions.json` (12 rows) vs
`docs/build/artifacts/11.8-live-smoke.md` (211 lines) and `router/UPSTREAM_CONTRACT.md`;
`docs/build/GATES.json` task 11.8 entry (M7 "PASS", M8 "PASS", backfilled 2026-08-14).

**Row-by-row against the artifact:**

| Row | Verdict | Evidence |
|---|---|---|
| 11.8-cli-contract | NAMED+PROVEN | `router/tests/cli_test.cpp` carries the id |
| 11.8-main-lifecycle | MET | artifact §2: verbatim launch, listening line, /conductor/health 200 |
| 11.8-upstream-recorded | MET (variant) | direct llama-server argv pasted rather than serve.py (serve.py's generator was 12.1, disclosed in §2) |
| 11.8-schema-constrained | MET | artifact §3: both attempts verbatim, constrained keys verified; `X-Conductor-Priority` header not shown in the request but priority appears in the ledger line |
| 11.8-metrics-line | MET | artifact §4: ledger read while router up, line 3 verbatim |
| 11.8-metrics-endpoint | MET | artifact §4: curl output + totalRequests=3 reconciled to the 3 smoke requests |
| **11.8-failsoft-equivalence** | **UNMET, UNDISCLOSED** | the row calls itself "LIVE G5, the load-bearing one (plan:87-94, §4.4:1666-1673): TWO probes proving the router never fails a request the direct path would have served", including replaying the schema-constrained request byte-identically DIRECT to the upstream. **No such probe appears anywhere in the artifact**, and the "What this run does NOT discharge" section (lines 177-190) does not name it either. |
| **11.8-streaming-live** | **UNMET, UNDISCLOSED** | the row demands a `"stream": true` request through the router with visible arrival times ("the stub-free check of the one thing doctests could only simulate"). Absent from the artifact; absent from the not-discharged section. The artifact's line 181 even notes "a non-stream response" without flagging that the streaming row was owed. |
| 11.8-models-and-404 | PARTIAL | §2 *claims* `/v1/models` "returned the upstream's model list verbatim" but does NOT paste it (the row demands `curl -sS -i` pasted verbatim — a claim of verbatimness is not a paste); the non-v1 404 half is entirely absent |
| 11.8-dashboard-not-built | MET | "The dashboard condition (SG-D) resolves FALSE" with the CMake evidence |
| 11.8-binding-not-discharged | PARTIAL | the stamp-stays-pending half is met (§ does NOT discharge); but the row's location clause — results APPENDED as a `## Task 11.8 — live smoke` section of router/UPSTREAM_CONTRACT.md — is unmet: UPSTREAM_CONTRACT.md has no 11.8 section (its sections are all Task 12.1's) |
| 11.8-m8-artifact | PARTIAL | commands mostly verbatim; `$ kill -TERM <router pid>` (line 139) is a placeholder, not a copy-pasteable line as the row requires |

**Why this matters:** 11.8 is a LIVE task whose whole evidentiary basis is this one artifact
(M8). The two unmet rows are precisely the two that would be *expensive to fake and expensive to
run* — the live G5 fail-soft equivalence and live SSE streaming. Their absence is invisible: the
artifact reads PASS, the gate records M8 PASS with a re-run diff of the *cheap* half (health
body, listening line), and M7 records a bare PASS although 11 of 12 rows are named by no test
and two are discharged by nothing at all. A reader auditing "is the live smoke complete?" from
the ledger + gate + artifact would conclude yes.
**Attempted refutation:** could the streaming and failsoft rows be discharged elsewhere? The
later 12.1-G5 driver does neither against a live upstream (no model, no streaming); the router
unit tests simulate SSE but the row exists *because* doctests "could only simulate". UPSTREAM_
CONTRACT.md's 12.1 section measures slots/autoload, not streaming-through-router or direct-vs-
router equivalence. Refutation fails.
**Severity:** MAJOR.
**Fix direction:** either run the two probes and append them to the artifact, or add both to the
artifact's not-discharged section AND to STATE.json 11.8's note, and correct the M7 record.

### SWEEP-ROWS-AND-TESTS-004 — g5-artifact-check rule 3 is per-SET, so an artifact whose router-distinguishing variable is read by NOTHING still passes (fix row's letter violated)

**Pattern:** P5 (the check does not refuse what its row says it must) / P1.
**Where:** `conductor/tools/g5-artifact-check.ts:186-204` (the `argvDiffers || read.length > 0`
rule); row `g5-artifact-cannot-be-two-identical-commands` in
`docs/build/specs/fix-phase12-g5.assertions.json`.
**Reproduced (MUT-5):** edit the artifact so the WITH arm's `CONDUCTOR_E2E_ROUTER_PORT=8391`
becomes `CONDUCTOR_E2E_UNREAD_VAR=8391` — a name no source file contains. The arms now differ
in (a) an unread variable and (b) `CONDUCTOR_E2E_FACTS` (two temp paths; the facts-file output
location, which IS read by source but has nothing to do with the router being in the loop).
`conductor/tests/g5-artifact.test.ts` passes **6/6**. The row's text demands rejection of an
artifact "whose difference is a variable no source file reads"; the implementation checks
whether AT LEAST ONE differing variable is read, and the always-differing bookkeeping variable
(`CONDUCTOR_E2E_FACTS`, whose value is a fresh temp path in every arm of every run) satisfies
it forever. The exact regression the check exists to prevent — the router-arm distinguisher
becoming an unread name — passes the check.
**Also observed while reading:** rules 4/5 compare artifact-internal lines to each other
(`REPORT-METRICS-WITH` deep-equals `ROUTER-SERVED-SUMMARY`), so a hand-author fabricating both
lines with one invented JSON object passes; the check is protection against accidental
flattening, not against fabrication — acceptable, but worth stating in the file header, which
currently claims it makes the artifact "impossible to satisfy with two identical commands".
**Severity:** MINOR (defense-in-depth check; the driver is the primary producer and MUT-4 shows
the byte-identical case binds).
**Fix direction:** rule 3 should require that the set of differing variables MINUS known
bookkeeping names (`CONDUCTOR_E2E_FACTS`) contains at least one source-read name; or the
check should special-case the seam variable by name.

### SWEEP-ROWS-AND-TESTS-005 — the whole 13.1 e2e passes 35/35 with a gate that denies EVERYTHING: no e2e row asserts an ALLOW through the real hook

**Pattern:** P5 (happy-path-only in mirror image: deny-path-only) — measured, not inferred.
**Where:** `conductor/tests/e2e.test.ts` (all five scenarios + row tests);
`conductor/adapter/tools.ts:340` `gateBeforeToolCall`.
**Reproduced:** with `gateBeforeToolCall` beginning `throw new Error("denied: ...")`
unconditionally (a foreign probe mutation present in the tree at measurement time — see
mutation-table note), `node --test --test-reporter=tap conductor/tests/e2e.test.ts` reports
**tests 35 / pass 35 / fail 0**. Every gate-shaped e2e row ([13.1-s1-orchestrator-edit-denied],
[13.1-s1-spawn-denied-everywhere], [13.1-s1-unregistered-write-denied],
[13.1-s1-out-of-order-tool-denied]) asserts a DENY; no e2e assertion ever requires an ALLOW
through the real `tool.execute.before` hook; the fake-SDK responders write their files directly
to disk, so no legitimate write ever needs the hook's permission. A harness whose gate bricked
every session — the most operator-visible failure imaginable — is invisible to the entire
end-to-end acceptance suite.
**Containment (my refutation attempt, partially successful):** the unit/wiring layers DO catch
it — under the same mutation `composition-root.test.ts` fails 5/27 and `gate-wiring.test.ts`
fails 9/12. So the property is covered, one seam below. The e2e's own NOT-proven comments
(e.g. at :2024-2030, "that the same unregistered session's READ is ALLOWED, without which this
proves only that something was denied, not that the right thing was") already admit the gap
row-by-row; what this measurement adds is that the admitted gaps COMPOSE into total blindness
at the e2e level. Filed rather than dropped because 13.1's ledger kind-line calls this file
"END-TO-END ACCEPTANCE, the first task whose subject is the WHOLE system".
**Severity:** MINOR-to-MAJOR depending on how much weight the record puts on "the e2e proves
the whole system" (the ledger's own words put a lot).
**Fix direction:** one e2e row asserting a REGISTERED implementer's in-scope write is ALLOWED
through the real hook (and lands on disk), and one asserting an unregistered session's READ is
allowed, would make blanket-deny impossible to miss.

### SWEEP-ROWS-AND-TESTS-006 — task-13.1 full 42-row audit: the known 22/42 floor confirmed; current true state is 22 named (12 honestly partial), 16 proven-but-unnamed, and 4 rows whose e2e-level claim is proven by nothing (one now unit-covered elsewhere)

**Pattern:** P13, with the known-open record re-derived and extended.
**Where:** `docs/build/specs/task-13.1.assertions.json` (42 rows) vs `conductor/tests/e2e.test.ts`
(4,317 lines, read in full), `conductor/tests/composition-root.test.ts`,
`conductor/tests/tools-9.4b.test.ts`, `conductor/tests/tools-9.5b.test.ts`,
`conductor/tests/report-closing-verify-runs.test.ts`.

**The 22 TITLE-named rows:** all 22 exist as `it()`/`test()` titles carrying the row id. Twelve
of them carry explicit `// NOT proven here:` comments enumerating unasserted clauses (read all
twelve; the comments are accurate — in two cases the comment understates what IS proven, never
overstates). This is honest partial naming, exactly as the known-open record describes.

**The 16 unnamed-but-covered rows** (each read side-by-side with the scenario test's
assertions):

| Row | Verdict | Where the proof lives |
|---|---|---|
| 13.1-s2-trivial-enters-executing-skipping-stages | PARTIAL-UNNAMED | [13.1-trivial] asserts kind, minted itemId, PUBLISHED; never asserts run state EXECUTING nor that decompose/plan were structurally skipped (it merely doesn't call them) |
| 13.1-s2-trivial-full-item-fsm-merged-lenses | PARTIAL-UNNAMED | PUBLISHED asserted; per-edge journaling and the merged lens set unasserted |
| 13.1-s2-report-lite-trivial-done | PROVEN-UNNAMED | TRIVIAL_DONE (never REPORTED), report.md naming item, stop done, G5 seam crossing all asserted |
| 13.1-s3-worktrees-concurrent-out-of-repo | PROVEN-UNNAMED | peak-overlap watcher, distinct trees, out-of-repo path predicate — strong |
| 13.1-s3-serial-mergeback-postmerge-revalidate | PROVEN-UNNAMED | ledger-based: per-item worktree + main verifies, seq/startedMs ordering, git ancestry, cat-file presence/absence — exemplary |
| 13.1-s4-nonbehavioral-no-test-ever | PROVEN-UNNAMED | no red, no testWriter dispatch, no invented test file, docs shipped |
| 13.1-s4-decompose-rejects-behavioral-false-over-src | PROVEN-UNNAMED | re-prompt names D2 + src/** + rule; survivor queue asserted |
| 13.1-s5-item-blocks-repair-exhausted | PARTIAL-UNNAMED | blocked + question asserted; the row's "exactly 1 + testRepairAttempts test-writer dispatches" count is NOT asserted in e2e (it is in tools-9.2/9.4a unit tests) |
| 13.1-s5-report-refuses-dependent-unsettled | PROVEN-UNNAMED | refusal names B1, not A1; "no verify was run" asserted |
| 13.1-s5-three-futile-reprompts-noop | PROVEN-UNNAMED | **verified by mutation MUT-3**: limit 3→4 reddens the scenario |
| 13.1-s5-stop-report-written | PROVEN-UNNAMED | headline, fields, dispositions, stale-red naming, byte-identical evidence ledger |
| 13.1-s5-second-run-validate-passes-and-discloses | PROVEN-UNNAMED | second run publishes; green verify JSON discloses exclusion |
| 13.1-real-plugin-factory-bound-handlers | PROVEN-ELSEWHERE-UNNAMED | composition-root rows cr-no-tool-throws-not-bound / cr-reaches-the-committed-handler; the e2e itself calls handlers DIRECTLY for stages (only chat.message + the gate hook go through the factory), so at e2e level the claim "every conductor_* call goes through the real factory" is not what the file does |
| 13.1-gate-snapshot-derived-live | PROVEN-ELSEWHERE-UNNAMED | cr2-gate-scope-derived-from-registry / cr2-widening-the-scope-goes-red / cr2-freeze-denies-only-its-own-tree / cr2-no-literals-left-at-the-seam |
| 13.1-fake-sdk-is-the-only-fake | UNPROVEN-BY-ASSERTION | construction property; header comment + imports support it; nothing asserts it and nothing could go red if a second fake crept in |
| 13.1-canned-outputs-pass-real-schemas | **UNPROVEN AS WRITTEN** | the row's own mechanism — "the first CLASSIFICATION reply is deliberately malformed, the real validator REJECTS it and the handler retries" — exists nowhere in e2e.test.ts (grep "malformed": zero scenario hits; every canned reply is well-formed). Unit-level analogue exists ([7.1-retry] in fanout.test.ts). The e2e therefore never proves that a bad canned output would be caught IN the pipeline |

**The 4 rows proven by nothing at their own level** (the known four, re-verified 2026-08-16):

| Row | Current state |
|---|---|
| 13.1-s1-mark-green-handler-runs-the-test | **e2e blind — proven by mutation MUT-1** (handler ignores exit code; e2e 35/35 green). Unit cover now exists: [9.4b-green-requires-passing-test] catches the same mutation |
| 13.1-s1-validate-quarantined-stamped | e2e: no assertion on the validate record's startedMs/HEAD/tree/excluded contents. Unit cover: [9.4b-validate-composes-runverify] + quarantine tests. Not re-mutated (adjacent to MUT-1's evidence) |
| 13.1-s1-report-real-closing-verify | e2e: no assertion that report appended a fresh verify record. Unit cover: [9.5b-report-fresh-closing-verify] + [c056-closing-verify-executes]/[c056-closing-verify-red-is-red] (the latter two verified by mutation MUT-2) |
| 13.1-s1-freeze-denies-test-file-edit | e2e: not exercised. Unit cover: [9.4b-validate-freeze-denies-edits] + [13.1-cr2-freeze-denies-only-its-own-tree] |

**Net assessment:** better than the recorded floor — none of the four is "proven by nothing"
in the absolute sense any more; all four have real unit-level guards, two of which I broke and
watched go red. What remains true: at the e2e level the four load-bearing "the handler measured
it" properties are still invisible (MUT-1's 35/35 is the proof), and 16 rows' proofs cannot be
found from the ledger because no test title carries their ids — the exact visibility failure
M7 exists to prevent, half-applied: scenario 1 was split into per-row tests (C-092), scenarios
2–5 were not.
**Severity:** MINOR as a defect (coverage is materially better than recorded); MAJOR as a
ledger-navigability gap (20 of 42 rows cannot be traced by id).
**Fix direction:** split scenarios 2–5 into per-row `it()`s over captured facts exactly as
scenario 1 was (the pattern and its rationale are already written down at e2e.test.ts:1330-1356);
add the malformed-first-reply leg the canned-outputs row describes; add cross-references
("proven by 9.4b-…") into the four rows' coveredByTest fields.

### SWEEP-ROWS-AND-TESTS-007 — 19 rows are linked to their tests only by prose comments, several under a DIFFERENT id than the test title carries; plus orphan ids in tests with no ledger row

**Pattern:** P3-lite (two spellings of one link) / M7 navigability.
**Where:** rows listed in §0 (task-0.3 ×3, task-1.1 ×9, task-6.1 ×7 — verified against
`smoke.test.ts`, `fragment.test.ts`, `types.test.ts`, `evidence.test.ts`, `quarantine.test.ts`).
**What:** these rows' ids appear ONLY in header mapping comments; the proving tests carry either
descriptive titles or a *different* id (`6.1-witness` → `[6.1-build-witness]`,
`6.1-runverify-order` → `[6.1-runverify]`, `6.1-ledger` → "(covered by [6.1-runtest] +
[6.1-runverify])"). I verified every mapping comment resolves to a real test title and, for the
6.1 family, that the mapped tests assert the row's content (read in full) — **the mappings are
honest**; nothing is vacuous. The defect is purely that the row-id → proof link lives in a
comment that no tool checks: rename the test and the comment silently lies (the exact drift
shape C-082/C-083 exemplify, one level up). The reverse hazard also exists: test titles carry
ids with no ledger row (`5.3-edit-deny`, `5.3-fail-open` in gate-wiring.test.ts;
`[12.1-g5-equivalence]` as a *python docstring* on `test_12_1_g5_equivalence`, which proves only
config-parity — the corner of the row, not the run-level equivalence).
**Severity:** MINOR.
**Fix direction:** either rename tests to carry the row ids, or add the mapped title into the
row's `coveredByTest` so a mechanical checker can verify the link (and could have produced my §0
inventory for free).

### SWEEP-ROWS-AND-TESTS-008 — P8 sweep result: no NEW self-contradictory rows found; two prior instances confirmed fixed in the row/test pair

**Pattern:** P8 (checked, largely cleared).
**What I did:** read every row text in task-13.1 (42), task-12.1-G5 (21), fix-* (26),
task-10.1 (33), task-14.1 (33), task-9.5b (30), task-11.8 (12), task-15.0 (28) for clause pairs
the product cannot satisfy simultaneously, with the two recorded instances (C-083
planReviewRounds revisions-vs-rounds; C-084 SG-4 lone-blocked-item queue shape) as templates.
**Findings:** none new. The two known instances are genuinely resolved in the shipped pair:
`[13.1-s1-plan-review-refute-revise-clean]` asserts `rounds === 2` as *revision* rounds with the
cap-exit discriminators (questionIds empty, blockedItemIds empty), matching the counter's actual
semantics; scenario 5's fixture adds the unstarted dependent B1 exactly so the report-refusal
clause is constructible (e2e.test.ts:3247-3258 explains why, correctly citing
core/gates-phase.ts isSettled).
**One borderline case, filed as observation not defect:** `12.1-G5-acceptance-record`'s tick
condition ("row 9 ticked ONLY when legs A, B and C all passed") is unsatisfiable by the shipped
acceptance meter, which cannot see legs — but that is the row being *ignored*, not
self-contradictory; covered in SWEEP-ROWS-AND-TESTS-002.

### SWEEP-ROWS-AND-TESTS-009 — P12 sweep result: the unwalked paths that remain are the system-level ones the ledger already owes, not unit-level ones

**Pattern:** P12 (checked; residue identified).
**What I did:** enumerated unusual-precondition branches per module and searched for the test
that reaches each: EXDEV fallback and crash-manifest replay (quarantine.ts — covered,
quarantine.test.ts incl. injectable rename), merge-conflict abort + GREEN demotion
(worktrees.ts — covered, tools-9.6), watchdog/retry/freeze-hold/failover latch (fanout.ts,
router-client.ts — covered, 7.1/7.2 rows), schema-invalid re-prompt (covered, [7.1-retry]),
journal rotation/truncation/unknown-event (covered, 2.1 rows), torn-line reads (covered:
questions/journal/replay/state tests all feed corrupt lines), supervisor restart/backoff/
SIGKILL-escalation/readiness-fallback (covered, test_conductor_wiring p12 + 12.1 rows),
admission queue-timeout 503 / overflow 503 / health-at-full-queue (covered, [11.4-*]),
mid-stream upstream death buffered and streamed (covered, [11.3-upstream-truncated-*]),
dead-upstream 502 (covered), bench cell timeout kill ([14.1-cell-timeout-kills-group]),
transport-failure floor in continuation (covered, fw-transport-failure-* — the C-085 family).
**What remains unwalked** (all already filed): live streaming through the router
(SWEEP-003), live direct-vs-router fail-soft equivalence (SWEEP-003), router killed MID-RUN
(SWEEP-002 leg C), hostile-router non-200/non-JSON end-to-end (SWEEP-002 leg C — unit stubs
only), supervisor restart observed by an equivalence arm (SWEEP-002 leg C), and real provider
traffic through the router at all (SWEEP-002 leg B).
**One known-open item found BETTER than recorded:** the §3.3 reverted-behavior probe (C-091,
"exercised by nothing") now has `[9.5a-reverted-behavior-probe]` (tools-9.5a.test.ts:1745+)
driving BOTH branches — the fire branch via a tracked-subject bench, and the stash-fails/skip
branch with the mandatory re-run + re-vet still asserted. The briefing's known-open list is
stale on this point; inside the e2e scenarios the probe still never fires (every e2e subject is
untracked at review time), but the unit-level hole C-091 recorded is closed.
**Verdict:** at unit level this codebase's unusual branches are exceptionally well chased — the
92-correction campaign visibly worked. Every remaining hole is a LIVE/system-level path, and
every one of them is already owed by a ledger row that finding 002/003 shows to be unmet.

---

## 2. IDEA REGISTER

### IDEA-001 — a mechanical row-to-test checker in the gate

Origin: building the §0 inventory by hand-rolled script; every P13 finding in this file would
have been visible continuously if the gate ran the same 40-line scan.
Kind: tooling
Value: M7 stops being a per-phase manual adjudication; a row whose id (or declared mapped
title) appears in no test title fails loudly at commit time. Would have prevented SWEEP-001,
kept SWEEP-002's 21 silent rows impossible, and exposed SWEEP-003's two undischarged rows.
Cost: small — the specs are uniform JSON; the scan is the one I wrote in scratch.
Relates to: SWEEP-ROWS-AND-TESTS-001/-002/-003/-006/-007.

### IDEA-002 — a `disposition` field on assertion rows

Origin: task-12.1-G5's 21 rows sitting with `coveredByTest: null` and no way to tell "not yet",
"superseded", "waived", and "covered elsewhere" apart.
Kind: test-maintainability
Value: the ledger becomes able to say what happened to a row; a fix task that narrows scope
must then write `superseded-by: fix-phase12-g5` per row instead of leaving silence.
Cost: schema addition + backfill pass.
Relates to: SWEEP-ROWS-AND-TESTS-002.

### IDEA-003 — split e2e scenarios 2–5 into per-row `it()`s like scenario 1

Origin: reading the scenario-1 refactor's own rationale comment (e2e.test.ts:1330-1356), which
argues the case perfectly and then stops at scenario 1.
Kind: test-maintainability
Value: 16 currently-unnamed-but-proven rows become named; a deleted assertion names the row
that lost its proof.
Cost: the capture-struct pattern already exists; mostly mechanical.
Relates to: SWEEP-ROWS-AND-TESTS-006.

### IDEA-004 — one e2e ALLOW row through the real hook

Origin: measuring 35/35 green under a blanket-deny gate.
Kind: test-maintainability
Value: the single most operator-visible failure mode becomes visible to the acceptance suite.
Cost: one test.
Relates to: SWEEP-ROWS-AND-TESTS-005.

### IDEA-005 — rename `test_12_1_g5_equivalence` to what it proves

Origin: C-089 named this exact python test as the vacuous half of the old G5 record; it still
carries the row-claiming docstring `[12.1-g5-equivalence]` while proving config parity only.
Kind: naming
Value: nobody re-cites it as the equivalence proof.
Cost: one docstring.
Relates to: SWEEP-ROWS-AND-TESTS-002/-007.

### IDEA-006 — record the M8 artifact's owed-row checklist inside the artifact

Origin: 11.8's artifact omitting two owed rows invisibly; an artifact that opened with its
ledger's row ids as a checklist could not omit one silently.
Kind: docs
Value: M8 artifacts become auditable against their own spec without opening the specs dir.
Cost: a template convention.
Relates to: SWEEP-ROWS-AND-TESTS-003.

---

## 3. CROSS-LENS POINTERS

- **ENFORCEMENT (R1):** `handleReport` closes a run REPORTED/stop-`done` even when the closing
  verify is RED (adapter/tools.ts:7648-7656 — the verdict is disclosed in reasonDisplay but does
  not gate the close). The plan (§3.2:1143-1151) demands the verify run and be recorded, not
  that it be green — so this is conformant, but "a run can end `done` on a red closing verify"
  deserves an enforcement/design look.
- **ENFORCEMENT (R1):** acceptance meter `check_artifact` (scripts/verify-acceptance.sh:138-152)
  accepts any >20-line file containing a `$`/fence line plus case-insensitive substrings — row
  9b's substrings are "no-router" and "terminal state"; the superseded tautological artifact
  would also have passed it. The meter cannot distinguish a real artifact from prose that quotes
  a command once.
- **ENFORCEMENT (R1):** the gate's typecheck leg and test legs are independent: a scoped run
  reports "GATE FAIL: N test(s) failing" without reaching the typecheck leg (scripts/
  test-conductor.sh order); operators reading only the last line can miss a second failure
  class. Minor, but it confused attribution twice during this sweep.
- **MACRO (R2):** the top-level CMake project is still named `myprogram` (CMakeLists.txt:17)
  while DECISIONS.md (a)-(g) documents the myprogram target's removal — stale identity at the
  project level.
- **MACRO (R2):** the assertion-ledger convention changed silently over the build's life
  (populated `coveredByTest` strings for tasks 0.x–9.1; null + title-naming from 9.2 onward;
  prose mapping comments for 0.3/1.1/1.3/6.1) — three generations of one mechanism coexist and
  none is documented as the current one.
- **MACRO (R2):** the 11.8 row `11.8-binding-not-discharged` prescribed results land in
  router/UPSTREAM_CONTRACT.md; they landed in docs/build/artifacts/ instead — the "where do live
  results live" convention is drifting between router/ docs and build artifacts.
- **CAPABILITY (R3):** nothing in the harness can currently express "this ledger row is owed by
  a live task that has not run" (13.2/14.2/11.8-live rows all read identically to silently
  missed rows — same null coveredByTest). See IDEA-002.

---

## 4. MUTATION TABLE

**Contamination note (must be read first):** midway through this sweep, a CONCURRENT review
agent's own probe mutations appeared uncommitted in the shared working tree —
`conductor/adapter/tools.ts` gained an unconditional `throw new Error("denied: ... (blanket-deny
mutation)")` at the top of `gateBeforeToolCall`, and `conductor/adapter/inject.ts` gained a
phantom `extra-governance.md` planner pack. I did not write these and did not revert them (they
are the other agent's snapshot-restore cycle). Every row below states whether the tree was
clean of foreign mutations at the time; where a foreign mutation coincided, the failure
attribution was re-established with a baseline run. Side effect worth keeping: with the blanket
throw in place, `bash scripts/test-conductor.sh conductor/tests/tools-9.4b.test.ts` fails ONLY
`[9.4b-validate-freeze-denies-edits]` — every other 9.4b test passes under a gate that denies
everything — and the scoped e2e run earlier in the session (before the foreign mutation landed)
is separately established below.

| # | Mutation | File | Expectation | Result | Verdict |
|---|---|---|---|---|---|
| MUT-1 | `handleMarkGreen` §3b: `testExit: record.exitCode` → `testExit: 0` (line 4350 only; the submit-test site at 2778 untouched) | conductor/adapter/tools.ts | 9.4b unit test red; e2e red iff row 13.1-s1-mark-green is e2e-proven | scoped 9.4b: `[9.4b-green-requires-passing-test]` FAILED (plus one foreign-mutation failure, see note; baseline run confirms attribution). Scoped e2e: **35/35 PASS, GATE PASS** | UNIT CHECK BINDS; **e2e row 13.1-s1-mark-green-handler-runs-the-test remains proven by NOTHING at e2e level** — known-open confirmed exactly, with unit-level cover now existing in 9.4b |
| MUT-2 | `handleReport` closing verify: `runScopePaths(queue)` → `["**"]` (the C-056 regression re-introduced) | conductor/adapter/tools.ts | c056 tests red | `report-closing-verify-runs.test.ts`: 2/4 FAILED, GATE FAIL | BINDS — the C-056 guard test is real and discriminates |
| MUT-3 | `FUTILE_RE_PROMPT_LIMIT` 3 → 4 | conductor/core/stops.ts | continuation, stops, e2e bad-ending red | continuation 6 FAIL; stops 1 FAIL; e2e 2 FAIL (GATE FAIL each) | BINDS — row `13.1-s5-three-futile-reprompts-noop` is PROVEN by the scenario test despite being unnamed; 10.1 rows bind too |
| MUT-4 | artifact arms made byte-identical (`ARM-WITH-ROUTER-CMD` := the WITHOUT command) | docs/build/artifacts/12.1-g5-equivalence.md | g5-artifact.test.ts red | 1/6 FAILED, GATE FAIL | BINDS — fix row `g5-artifact-cannot-be-two-identical-commands` holds for the identical-arms half |
| MUT-5 | WITH-arm's differing env var renamed to `CONDUCTOR_E2E_UNREAD_VAR` (a name no source file reads); `CONDUCTOR_E2E_FACTS` left differing | docs/build/artifacts/12.1-g5-equivalence.md | check red per the row's second clause ("difference is a variable no source file reads") | **6/6 PASS** (tap leg; the GATE FAIL printed was the typecheck leg broken by the foreign mutation, not this) | **DOES NOT BIND** — see SWEEP-ROWS-AND-TESTS-004 |

---

## 5. COVERAGE LEDGER

### 5.1 Spec files (all 60, per-file verdict)

| Spec file (rows) | What was done | Verdict |
|---|---|---|
| fix-cluster-and-drift (5) | ids traced to continuation.test.ts titles; UNIVERSAL_META_TOOLS read — now DERIVED from legalTools, nothing left to drift | named+proven; fc-meta-tools row structurally satisfied |
| fix-phase12-g5 (6) | every row read vs driver/tests/artifact; MUT-4/MUT-5 run | 5 proven (1 by mutation), 1 partially violated (SWEEP-004) |
| fix-phase12-serve (8) | ids traced to test_conductor_wiring.py p12_* tests | named; test names read, honest |
| fix-phase12-setup (7) | ids traced to setup.test.ts | named; not deep-read |
| fix-wedge-detector (8) | ids traced to e2e wedge walk; MUT-3 reddens the family | named+mutation-verified (via adjacent limit) |
| task-0.1 (8) | doc anchors grepped in DECISIONS.md — all 8 present incl. the 3 unnamed | met; note 0.1-e's anchor text says `src/main.cpp`, document now says `router/main.cpp` (harmless snapshot drift) |
| task-0.2 (19) | 2 unnamed rows checked: stub rejects port 8080 (stub-llm-server.ts:240), wire-notes has 23 WIRE_CONTRACT_VERIFIED lines; skip-coupling guard 0.2-noskip read | met |
| task-0.3 (7) | tsconfig flags, package.json devDeps-only, dirs verified; 3 comment-only rows resolved to smoke/fragment tests | met (SWEEP-007 applies) |
| task-1.1 (9) | 9 comment-mapped rows resolved via types.test.ts header map; map spot-verified | met (SWEEP-007) |
| task-1.2 (8) | ids in export surface; not deep-read | named; not examined deeply |
| task-1.3 (9) | 5 comment-only rows resolved to table-driven `name:` titles in freshness.test.ts (14 [1.3-*] names) | met (SWEEP-007) |
| task-1.4 (4) | purity probes named in coveredByTest with probe letters; not re-run | named; not examined deeply |
| task-1.5 (4) | decide.test.ts read: scoreOptions describes, truth table (≥13 cases incl. mandated pair), requireTwoOptions | proven, unnamed by id (early convention) |
| task-2.1 (9) | ids traced to journal.test.ts titles | named; not deep-read |
| task-3.1–3.3, 4.1–4.2, 5.1–5.2 (68) | ids traced via "names carry" convention; gates-git/gates-edit are the enforcement lens's mutation territory | named; delegated to R1 |
| task-5.3 (7) | all 7 checked by grep; 6 named, 1 false coverage claim | SWEEP-001 |
| task-5.4/5.4a (21) | ids traced to chat-message.test.ts | named; not deep-read |
| task-6.1 (11) | 7 comment-mapped rows resolved and the 6.1 family's mapped tests read in full | met (SWEEP-007) |
| task-6.2 (7) | RUNNER-DISCOVERY.md read (probe sections, versions, quarantine justification) | met via artifact as coveredByTest describes |
| task-7.1/7.2 (12) | ids traced to fanout/router-client titles; [7.1-retry] read | named; retry branch verified |
| task-8.1/8.2 (25) | ids traced to doctrine/inject titles | named; not deep-read |
| task-9.1–9.3 (32) | ids traced to tools-9.x titles | named; not deep-read |
| task-9.4a/b/c (36) | 9.4b read around mark-green/validate/freeze; MUT-1 run | named; green-requires-passing-test mutation-verified |
| task-9.5a (14) | reverted-behavior probe test read (both branches) | named; C-091 closure verified |
| task-9.5b (30) | report-fresh-closing-verify read clause-by-clause; MUT-2 adjacent | named+proven (sampled) |
| task-9.5c (12) | ids traced | named; not deep-read |
| task-9.6 (21) | conflict/demotion coverage confirmed in tools-9.6 header + titles | named; conflict branch reached |
| task-10.1 (33) | title list read; reprompt-names-gate-recommendation title/test read; MUT-3 reddens family | named+sampled+mutation-verified |
| task-11.1 (4) | CMakeLists read (no myprogram target; llama-router+router-tests real); scaffold via ctest record | met; 11.1-upstream-contract deferred-disclosed |
| task-11.2–11.7 (60) | router test titles enumerated (admission/proxy/cli); unusual-branch rows spot-matched | named; unit coverage strong |
| task-11.8 (12) | every row vs the M8 artifact, read in full | SWEEP-003 (2 unmet+undisclosed, 3 partial) |
| task-12.1 (31) | python test names traced; g5 row read; supervisor/backoff/live rows confirmed named | named; 12.1-g5-equivalence's generated-config clause unmet (folded into SWEEP-002) |
| task-12.1-G5 (21) | EVERY row read vs shipped driver+artifact+meter | SWEEP-002 (14 unmet, 5 partial, 2 met-in-spirit) |
| task-12.2 (28) | ids traced to setup.test.ts | named; not deep-read |
| task-13.1 (42) | every row vs e2e.test.ts (4,317 lines read in full) + composition-root + unit suites; MUT-1/MUT-3 | SWEEP-005/-006 |
| task-13.1-composition-root (27) | row ids listed; cr2 freeze/scope tests grepped; blanket-deny baseline shows 5/27 fail (binds) | named+bind-verified by foreign mutation |
| task-13.2 (19) | STATE.json NOT_STARTED confirmed | N/A — unbuilt, disclosed |
| task-14.1 (33) | hidden-never-visible read in full; cell-timeout title confirmed | named+sampled, high quality |
| task-14.2 (18) | STATE.json NOT_STARTED confirmed | N/A — unbuilt, disclosed |
| task-15.0 (28) | title trace to replay.test.ts (torn-line, non-conforming rows present) | named; not deep-read |
| task-15.1 (25) | HONEST-LIMITS.md read for the G5 honesty rows (absent — filed in SWEEP-002) | named; content gap filed |
| task-15.2 (17) | dashboard target verified (option-gated, added 1d7074b post-11.8) | named; not deep-read |

### 5.2 Test/source files examined

| File | Extent |
|---|---|
| conductor/tests/e2e.test.ts | READ IN FULL (4,317 lines) |
| conductor/tools/g5-equivalence.ts | READ IN FULL (697 lines) |
| conductor/tools/g5-artifact-check.ts | READ IN FULL (238 lines) |
| docs/build/artifacts/12.1-g5-equivalence.md | READ IN FULL (213 lines) |
| docs/build/artifacts/11.8-live-smoke.md | READ IN FULL (211 lines) |
| conductor/tests/report-closing-verify-runs.test.ts | header + both rows read; mutated against |
| conductor/tests/tools-9.4b.test.ts | mark-green/validate/freeze regions read; mutated against |
| conductor/tests/tools-9.5b.test.ts | fresh-closing-verify test read in full |
| conductor/tests/tools-9.5a.test.ts | reverted-behavior probe region read |
| conductor/tests/continuation.test.ts | title inventory + one test read; mutated against (via stops.ts) |
| conductor/tests/decide.test.ts | truth table + describes read |
| conductor/tests/freshness/types/evidence/quarantine tests | mapping-comment regions read |
| conductor/tests/wire-contract.test.ts | skip-coupling mechanism read |
| conductor/tests/g5-artifact.test.ts | driven under two artifact mutations |
| conductor/adapter/tools.ts | handleMarkGreen + handleReport regions read; twice mutated+restored (cmp-verified) |
| conductor/adapter/continuation.ts | UNIVERSAL_META_TOOLS + engine regions read |
| conductor/adapter/worktrees.ts, quarantine.ts, state.ts, gitio.ts, config-io.ts | branch-scanned for P12 (not read in full) |
| conductor/core/stops.ts | wedge detector read; mutated+restored |
| router/tests/admission_test.cpp, proxy_test.cpp, cli_test.cpp | TEST_CASE titles enumerated; bodies not read |
| scripts/test_conductor_bench.py | hidden-never-visible read; titles enumerated |
| scripts/test_conductor_wiring.py | test names enumerated; g5 test read in full |
| scripts/verify-acceptance.sh | check_artifact + row 9 region read |
| docs/build/STATE.json, GATES.json, CORRECTIONS.md (C-089 region) | targeted reads |

**Not examined:** bodies of most passing unit suites for tasks 1.2, 2.1, 3.x, 4.x, 5.4, 8.x,
9.1–9.3, 9.5c, 12.2, 15.0, 15.2 — their rows are title-named and those suites belong to the
enforcement lens's mutation sweep; sampling elsewhere found the naming convention honest, so I
prioritized the files with unnamed or artifact-covered rows. The plan (3,399 lines) was read in
the sections cited by rows I judged (§2.6, §3.2-3.3, §3.7, §4.2, §4.4, §11), not in full.

---

## 6. CLEARED AREAS

Attacked and could NOT break:

- **The C-056 closing-verify guard** (MUT-2): re-introducing the literal-`"**"` scope selection
  reddened `[c056-closing-verify-executes]` and `[c056-closing-verify-red-is-red]` immediately.
  The witness-file anti-vacuity design in that file is exemplary.
- **The mark-green exit-code check at unit level** (MUT-1): `[9.4b-green-requires-passing-test]`
  catches the handler ignoring the measured exit code.
- **The futile-re-prompt limit** (MUT-3): three suites redden (continuation ×6, stops ×1,
  e2e ×2) when the limit moves 3→4 — the wedge family binds from unit to scenario level.
- **The G5 artifact identical-arms check** (MUT-4): byte-identical arms redden
  g5-artifact.test.ts. (Its per-set env rule did break — SWEEP-004.)
- **The scenario-3 worktree assertions**: attempted to construct a reading under which the
  serial-merge-back proof is satisfiable by a concurrent merge — the HEAD-content assertions
  (`cat-file -e` for the sibling's module absent at W1's integrated head) close it. Could not
  weaken on paper; did not mutate (peer contention on tools.ts).
- **The bad-ending scenario's no-closing-verify property**: the byte-identical evidence-ledger
  fingerprint before/after the wedge walk leaves no room for a hidden verify. Could not
  construct a bypass.
- **The wire-contract skip coupling**: `describe({skip})` + the unconditional `0.2-noskip`
  guard + the gate's skip-directive rejection compose so a missing opencode binary is loud on
  a build machine. Checked all three legs; coherent.
- **UNIVERSAL_META_TOOLS drift** (C-086 class): the constant is now a derivation over
  `legalTools` under both publish modes — there is no restatement left to drift. Attack
  abandoned as structurally impossible.
- **task-14.1's hidden-test hygiene rows**: read looking for a self-oracle (P2) — expected
  values come from the manifest and the filesystem, not from the driver under test. Clear.
- **P8 self-contradiction sweep** over ~230 row texts: nothing new (SWEEP-008).

Processes: nothing spawned by this sweep outlived it —
`ps -ax -o pid,etime,command | grep -E "llama-router|fake-llama|time\.sleep|node --test"`
returned empty at finish. `git status` under conductor/ and docs/build/ is clean: my three
source mutations and two artifact mutations were all restored from `cp` snapshots and
`cmp`-verified, and the concurrent agent's foreign mutations were likewise gone by finish.

---
