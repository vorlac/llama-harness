# Sweep: Gate Mutation — Can Every Check Fail? (Part B)

**Scope:** The verification audit. For every gate, scanner, guard, source-audit test and acceptance
meter: mutate what it checks and confirm it goes red. Targets: `scripts/test-conductor.sh`,
`scripts/conductor-gate.sh` (M5), all 21 rows of `scripts/verify-acceptance.sh`,
`legaltools-callsites.test.ts`, `journal-vocab.test.ts`, `tool-binding.test.ts`,
`composition.test.ts`, `g5-artifact-check.ts`, every `*-vocab` / `*-callsites` / `*-binding`
source audit, plus re-derivation of `STATE.json` `revertAssertion` claims.

**Date:** 2026-08-16
**Reviewer:** sweep-gate-mutation (one agent of the step-2 enforcement review)
**Status:** COMPLETE. 44 mutations/probes applied and restored (`cmp`-verified); tree left clean
(final full gate GATE PASS 1382/1382; no stray processes; `git status` unchanged from session
start). 11 ISSUE entries (1 critical, 3 major), 6 IDEA entries, 7 cross-lens pointers. Every one
of the 21 acceptance rows carries a per-row verdict (§4b); 8 of 57 recorded revertAssertions
re-derived, 7 reproduce exactly, 1 does not (ISSUE-009).

**Baseline (2026-08-16, HEAD ce05498, uncommitted: only the addendum plan doc + this review dir):**
`bash scripts/test-conductor.sh` → `TAP: tests=1382 pass=1382 fail=0 cancelled=0 skipped=0 todo=0
skipdirectives=0 (node exit=0)`, typecheck OK, bun leg OK (8 pass), schema export OK, python leg OK
(Ran 80 tests), **GATE PASS**. All mutations below were applied against this baseline, one at a
time, snapshot-with-`cp` / restore / `cmp`-verified unless noted.

**Method note on attribution (P6):** `scripts/test-conductor.sh` runs its legs in order
(node TAP → tsc → bun → schema export → python), and exits at the first failing leg. So when a
mutation's verdict says "caught by TAP leg, test X assertion Y" that is read off the gate's own
failure excerpt; when only tsc catches a mutation the TAP leg passed first, which is itself
recorded, because a property proven only by the typechecker is proven by a different (weaker,
erasable) instrument than the test that claims it.

---

## 1. ISSUE register

Index (entries appear below in insertion order, not numeric order):

| id | one line | severity |
|---|---|---|
| -001 | deleting tsconfig.json silently disables the typecheck leg, GATE PASS | MAJOR |
| -002 | deleting bun-smoke.test.ts silently drops the G14 leg from the per-task gate | MINOR (acceptance catches) |
| -003 | M5 empty-catch scan cannot match the multi-line form — near-decorative | MAJOR |
| -004 | acceptance row 10 passes with derive_slots collapsed to constant 1 (self-referential) | MEDIUM |
| -005 | detector F accepts a prose mention of WIRE_CONTRACT_VERIFIED as a real stamp | MEDIUM |
| -006 | acceptance row 6 flips FAIL→PASS on a 26-line fabricated SMOKE.md (~15s of work); full exit-0 fabrication is two files + two commits away | MEDIUM (evidence-strength; partially known) |
| -007 | stripComments in both source audits eats string-glob "comments": ~240 lines of tools.ts + ~227 of gates-edit.ts invisible; real call site tools.ts:9233 unaudited; exploit proven both directions | **CRITICAL for the audit layer** |
| -008 | purity guard's subprocess rule is import-only; shell-string exec() in an adapter passes 4/4 | MEDIUM |
| -009 | task 11.5's recorded revertAssertion is mutation-equivalent (green), and was at record time — recorded evidence does not reproduce | MAJOR (evidence integrity) |
| -010 | test_12_1_live_stamp_and_m8 failed 3× then resisted 9+ repro attempts — unexplained intermittent | LOW confidence |
| -011 | detector C's per-header test-coverage loop ends in `\|\| true` — dead code that reads as coverage | MINOR |

### SWEEP-GATE-MUTATION-001 — Deleting `conductor/tsconfig.json` silently disables the M3 typecheck leg; the gate prints GATE PASS

- **Where:** `scripts/test-conductor.sh:64` (`if [ -f conductor/tsconfig.json ]; then`)
- **Class:** P1 (a check that passes while inspecting less than it appears to) — the leg-activation
  conditional doubles as a leg-disabling switch.
- **Reproduced:** `mv conductor/tsconfig.json` aside → `bash scripts/test-conductor.sh
  conductor/tests/smoke.test.ts` → **GATE PASS**, exit 0, and the output simply omits the
  `typecheck: OK` line. Restored and re-verified.
- **Why it matters:** the conditional was written for the bootstrap window ("active from Task 0.3
  onward") but that window closed 50 tasks ago. Today the only reading of a missing tsconfig.json is
  a regression, yet the gate treats it as the pre-0.3 world and passes silently. A grep confirms
  NOTHING else in the repo asserts this file exists: not `verify-acceptance.sh` (detector A's
  MODULES list carries 28 modules but not tsconfig.json), not any test. So M3 — one of the nine
  named task-gate legs — can be permanently disabled by a one-file deletion that every gate,
  scanner and acceptance row survives. Contrast with the bun leg, whose *binary* absence at least
  prints a loud `GATE WARN`; a missing tsconfig prints nothing at all.
- **A lying/lazy model gets away with:** deleting tsconfig.json in the same change as code that no
  longer typechecks; the canonical gate stays green forever after.
- **Fix direction:** invert the conditional's meaning now the bootstrap is over — `[ -f
  conductor/tsconfig.json ] || { echo "GATE FAIL: conductor/tsconfig.json missing"; exit 1; }` —
  and add the file to detector A's list.

### SWEEP-GATE-MUTATION-003 — The M5 empty-catch scan cannot see a multi-line empty catch — the only formatting anyone actually writes

- **Where:** `scripts/conductor-gate.sh:75` — `PAT_CATCH='catch[[:space:]]*(\([^)]*\))?[[:space:]]*\{[[:space:]]*\}'`, applied with line-based `grep -E`.
- **Class:** P1. The scan enforces the *shape it can match*, not the shape the defect takes.
- **Reproduced both directions:**
  - Appended to `conductor/adapter/state.ts`:
    ```
    try {
      JSON.parse("x");
    } catch (err) {
    }
    ```
    → `bash scripts/conductor-gate.sh conductor/adapter/state.ts` → **M5 PASS**, exit 0.
  - Control: the same catch written on one line (`} catch (err) {}`) → **M5 FAIL: empty catch
    block**, exit 1. Both restored, `cmp`-clean.
- **Why it matters:** `grep -E` is line-based, so `[[:space:]]` in the pattern can never span the
  newline between `{` and `}`. Every real-world empty catch — the form a formatter emits, the form
  this repo's own multi-line style would produce — is invisible to the scan. The single shape it
  does catch (`catch (e) {}` on one line) is the one shape a style-conscious writer is least likely
  to produce. The scan's own header comment claims "Covers: … empty catch blocks" without this
  qualification. In its current form the CATCH leg of M5 is close to decorative.
- **A lazy model gets away with:** swallowing any error it likes, so long as it puts the closing
  brace on the next line — which is the default.
- **Fix direction:** scan with a newline-tolerant tool for this one pattern (e.g. `grep -Pzo` where
  available, or a tiny `awk`/node script that strips comments and matches across lines), or fold
  the check into a real parser-based lint leg. Note the sibling exemption
  (`tools-9.4b.test.ts|CATCH|catch (_) {}`) shows the single-line form does occur in tests — the
  fix must keep the per-line exemption machinery working.

### SWEEP-GATE-MUTATION-002 — Deleting `conductor/tests/bun-smoke.test.ts` silently drops the G14 dual-runtime leg from the per-task gate

- **Where:** `scripts/test-conductor.sh:80-92` (`BUN_SMOKE=…; if [ -f "$BUN_SMOKE" ]; then`)
- **Class:** P1, same shape as -001, one notch less severe.
- **Reproduced:** `mv conductor/tests/bun-smoke.test.ts` aside → scoped gate → **GATE PASS**, exit
  0, no `bun leg:` line and no warning. Restored, `cmp`-clean.
- **Mitigation that exists:** `verify-acceptance.sh` row 2 runs `bun test` on the named file (fails
  if missing) and row 4 checks the file exists by name. So the property is recoverable — but only
  at acceptance time, which runs rarely; every per-task `GATE PASS` in between is silent about the
  missing leg. The gate's own comment says "a loud SKIP only if bun ever disappears" — the
  *file* disappearing was not given the same treatment as the *binary* disappearing.
- **Fix direction:** same inversion as -001: after Task 2.2 the file's absence is a FAIL, not a
  quiet skip.

---

### SWEEP-GATE-MUTATION-004 — Acceptance row 10 passes with `derive_slots` collapsed to a constant 1: the row's expected values are derived from the subject it checks

- **Where:** `scripts/verify-acceptance.sh:186-233` (the row-10 inline python probe) vs
  `scripts/conductor_wiring.py:derive_slots`.
- **Class:** P2 (self-referential oracle), with a P13 flavour (a named row that does not prove its
  title for a whole class of breaks).
- **Reproduced:** replaced `derive_slots`' body with `return 1` →
  `bash scripts/verify-acceptance.sh --quick` → **`PASS row 10: --parallel, maxInflightPerModel
  and per-slot context all derive from one number`**. The mutation serializes the entire fan-out
  (1 slot, admission cap 1) regardless of `maxReaders`. Restored, `cmp`-clean.
- **Why the row cannot see it:** the probe computes `slots = w.derive_slots(readers)` and then
  asserts (a) `cfg.admission.maxInflightPerModel == slots` and (b) the argv carries
  `--parallel <slots>` — both sides of every comparison flow through the mutated function, so a
  mutation that keeps the *internal* consistency (any constant does) passes. The `slots > 1` guard
  on the argv assertions means the constant-1 collapse skips them entirely. The row checks "one
  number feeds all three consumers" but never that the number *is a function of `maxReaders`* —
  which is the §11 row's actual claim ("--parallel is set FROM parallel.maxReaders").
- **Contrast:** my first mutation (`return max_readers + 1` inside the >1 arm) DID fail the row —
  but only because `parallel_server_args` re-calls `derive_slots` internally, creating an
  incidental second derivation that drifts. The row binds by accident for that shape, not by
  design.
- **Defense in depth that exists:** `scripts/test_conductor_wiring.py` catches the collapse
  (4 failures in the python leg — verified), so a FULL acceptance run fails at row 1b. But row 10
  is the *named* acceptance check for the §11 property and it is satisfiable by a subject that
  serializes the harness.
- **Fix direction:** assert against an independently-written expectation:
  `for readers in (1,4,6,9): assert w.derive_slots(readers) == max(1, readers)` — the literal
  `max(1, readers)` restated in the row, not read off the module.

### SWEEP-GATE-MUTATION-006 — Quantified: acceptance row 6 (the live smoke) converts from FAIL to PASS on a 26-line fabricated file

- **Where:** `scripts/verify-acceptance.sh:138-153` (`check_artifact`, applied to
  `conductor/SMOKE.md` in row 6; same shape guards rows 7, 8, 9b).
- **Class:** evidence-strength (the charter's second question), P9-adjacent. Deliberately filed
  even though the limitation is *partially* known — `check_artifact`'s own comment says a
  fabricated artifact is "the single worst outcome available to this build" — because the
  *cheapness* has not been quantified anywhere in the record.
- **Reproduced:** wrote a `conductor/SMOKE.md` containing a title, one `$ scripts/serve.py` line,
  one code fence, the words "retry" and "behavioral", and 20 filler lines (26 lines total; ~15
  seconds of work) → row 6 flips to
  **`PASS row 6: conductor/SMOKE.md present, 26 lines, with a command transcript`**. Deleted the
  probe file afterwards.
- **What full fabricated acceptance would additionally take:** row 8 needs the same for
  `conductor-report.md` with 4 keywords; detector E then passes; row 12 still fails until commits
  with the two manifest `commitMessage`s exist — which the same fabricator can create. So the
  distance from "4 FAIL" to "0 FAIL, exit 0" is two short fake files and two commits, with no
  check in the meter able to tell. Acceptance exit 0 is the completion criterion the build's
  runbook names.
- **Why still file it:** a careful reader is told "Completion may be claimed only on exit 0" (the
  script's own header). Exit 0 is nearly costless to fabricate, so the meter's exit code must
  never be treated as evidence the live work happened — only the transcripts' *content* can be,
  and nothing mechanical distinguishes measured content from authored content. The record should
  say this out loud where the meter is defined, and the runbook's completion claim should name
  which rows are fabrication-vulnerable (6, 7, 8, 9b, E, F).
- **Fix direction (partial):** fold the strongest obtainable signals in: require row 8's numbers
  to cross-check against `.data/benchmark/` when present, require SMOKE.md to embed the runId and
  verify seq of a run whose `journal.jsonl`/`evidence.jsonl` exist and re-validate, and have the
  meter print a standing warning that rows 6/7/8/9b attest shape, not truth.

### SWEEP-GATE-MUTATION-005 — Detector F accepts a prose *mention* of WIRE_CONTRACT_VERIFIED as a "real stamp"

- **Where:** `scripts/verify-acceptance.sh:377-386` (detector F).
- **Class:** P1, in the detector whose entire purpose is P9-adjacent ("an unmet obligation wearing
  the shape of a met one").
- **Reproduced:** replaced the stamp line of `router/UPSTREAM_CONTRACT.md` with the sentence
  `The WIRE_CONTRACT_VERIFIED stamp will be added after the next live run.` → `--quick` acceptance →
  **`PASS detector F: UPSTREAM_CONTRACT.md carries a real WIRE_CONTRACT_VERIFIED stamp`**.
  Control: the literal `<pending>` form fails as designed. Restored, `cmp`-clean.
- **Why:** the check is `grep -q 'WIRE_CONTRACT_VERIFIED' && ! grep -qi
  'WIRE_CONTRACT_VERIFIED:[[:space:]]*<*pending'` — any occurrence of the bare token anywhere in
  the file counts as a stamp; only the exact `NAME: <pending` spelling is rejected. A document that
  *discusses* the stamp (which contract docs naturally do) passes; so does
  `WIRE_CONTRACT_VERIFIED: TBD`, `…: no`, or `…: never ran`.
- **Fix direction:** anchor on the stamped shape, not the token: require a line matching
  `^\`?WIRE_CONTRACT_VERIFIED: [0-9]{4}-[0-9]{2}-[0-9]{2}` (the real stamp's format), and reject
  everything else.

### SWEEP-GATE-MUTATION-007 — `stripComments` in both source audits treats `/*` inside STRING LITERALS as a comment opener: ~240 lines of tools.ts and ~227 lines of gates-edit.ts are invisible to the audits, including one real journal call site

- **Where:** the duplicated `stripComments` helper in `conductor/tests/journal-vocab.test.ts:123-146`
  and `conductor/tests/legaltools-callsites.test.ts:78-101` (the duplication is itself P3 — the
  legaltools header calls it "the legaltools-callsites idiom", i.e. the copy is acknowledged and
  unguarded).
- **Class:** P1 in its purest form — the audit is *the* guard for paths no test drives, and it
  inspects materially less than it claims — inside the very tests written to close C-045-class
  holes. The audits' own anti-vacuity floors (≥80 sites, ≥60 in tools.ts) cannot see it: 75 sites
  survive in tools.ts, comfortably above the floor.
- **Mechanism:** `stripComments` is quote-blind. When it reaches the `/*` inside a glob string
  such as `"src/**"` (i.e. `…/` + `**"`, whose text contains `/*`), it enters "block comment" mode
  and blanks everything until the next `*/` — which for `"**/*.py"`-style strings can be hundreds
  of lines later, or never (blanks to EOF).
- **Measured on the CURRENT, unmutated tree** (replicated the exact helper standalone):
  - `conductor/adapter/tools.ts`: **8 phantom glob-opened spans**, the two largest being lines
    **8405–8488** (3,292 chars — the middle of the runner-profile/setup code) and lines
    **9104–9254** (6,115 chars — **everything from 9104 to the end of the file**).
  - `conductor/core/gates-edit.ts`: **one phantom span covering lines 208–434** (8,688 chars,
    ~227 lines of the edit gate), opened by `globMatch(".conductor/**", normalized)` at line 208.
  - No other production file affected today (swept all of core/adapter/plugin with the replica).
- **A REAL call site is already invisible:** `conductor/adapter/tools.ts:9233` —
  `input.journal.log("info", "state", "config.updated", …)` (the §3.4 reconfigure-diff record) —
  sits inside the tail span. The [vocab-callsites] audit has never audited it.
- **Exploit reproduced:** renamed that call site's event to the unlisted `"config.mutated-probe"`
  → `node --test` on journal-vocab.test.ts → **7/7 pass**. (Control JV1: the same rename on a
  VISIBLE call site, state.ts:730 `lock.released` → `lock.dropped`, fails the audit immediately.)
  So a handler in the blanked region can ship an event name the real journal will throw on — the
  exact four-defects-shipped scenario the audit's header narrates — and the audit stays green.
  Restored, `cmp`-clean.
- **Second-order effect:** any NEW code appended to tools.ts after line 9104 — the natural place
  new handlers land — is born unaudited by both audits. My smuggled dynamic
  `.log(component, event=variable)` call site appended at the tail also passed 7/7 (the
  EXPECTED_DYNAMIC_SITES pinned-set assertion never saw it), which is the precise smuggling route
  that assertion documents itself as closing.
- **Why the audits' self-checks miss it:** the "unreadable site is a hole" assertion
  (`args.length < 3`) and the literal+dynamic==total classification both run over the already
  mutilated text; sites inside blanked spans are not "unreadable", they are *absent*.
- **Fix direction:** make `stripComments` string-aware (track `"`/`'`/backtick state — ~15 lines),
  hoist ONE copy into a shared test helper, and add a canary to the audit: assert the stripped
  text still contains a sentinel that lives beyond the last glob string (e.g. the file's final
  export), so a future stripping bug that eats a tail is loud. Then re-run the audit — if
  `config.updated` at 9233 or anything in gates-edit 208–434 is out-of-vocabulary it will surface
  then.

### SWEEP-GATE-MUTATION-008 — The purity guard's subprocess rule enforces only the IMPORT, so a shell-string `exec()` in an adapter passes every scan (the "shell:false" claim is unenforced)

- **Where:** `conductor/tests/purity.test.ts:242-263` (`1.4-subprocess`).
- **Class:** P4 (the assertion text claims "every subprocess goes through execFile from
  node:child_process with shell:false (G14)"; the body checks only that a file containing a
  subprocess-shaped call *imports the sanctioned module*).
- **Reproduced:** appended to `conductor/adapter/gitio.ts`:
  `import { exec as zzExec } from "node:child_process"; export function zzShellProbe(): void {
  zzExec("echo owned > /tmp/zz"); }` → purity suite **4/4 pass**. This is a live shell-string
  subprocess in an adapter — the exact shape the guard's own failure message forbids. tsc accepts
  it; M5 has no pattern for it; no other test flags it. Restored, `cmp`-clean.
- **Why it matters:** the argv-only / shell:false discipline is a G7-relevant security property —
  the git gate's whole tokenizer exists because shell strings are dangerous. Production code
  currently complies (all call sites are `execFileSync`/`spawnSync` argv-style — checked by
  grep), so this is a latent gap, not an active defect; but the one guard that names the property
  cannot fail for its violation.
- **Fix direction:** in the same scan, forbid the tokens `exec(`/`execSync(` outright in
  adapter/plugin files (assembled, per the file's own convention), and flag any
  `spawn`/`spawnSync`/`execFile` call whose options argument contains `shell` — or at minimum
  assert the imported *names* from node:child_process are within {execFile, execFileSync, spawn,
  spawnSync}.

### SWEEP-GATE-MUTATION-009 — Task 11.5's recorded revertAssertion does not reproduce: the mutation it names ("dropping the burst_->priority == eligible guard") is mutation-EQUIVALENT, and was at record time too

- **Where:** `docs/build/STATE.json` tasks["11.5"].revertAssertion, second clause: *"letting a
  burst outrank strict priority (dropping the burst_->priority == eligible guard) re-reds
  [11.5-priority-precedence] alone (all four VERIFIED by running the mutation, not reasoned)"* —
  vs `router/affinity.hpp:107` and `:175-183`.
- **Class:** the charter's named "serious" class — a `revertAssertion` that does not produce its
  claimed red, i.e. the recorded evidence is wrong. P9-adjacent.
- **Reproduced:** applied the mutation exactly as recorded — `if (burst_ && burst_->priority ==
  eligible)` → `if (burst_)` — rebuilt router-tests, ran ctest: **100% tests passed**. No red.
  Restored, `cmp`-clean, rebuilt.
- **Why it is green, and was green at record time too:** `oldestBurstMember(entries, eligible)`
  itself skips every entry with `entry.priority != priority` (affinity.hpp:179-180), so with the
  outer guard dropped a lower-class burst still yields no member of the higher eligible class and
  the selection falls through identically. `git show 53c5bf7:src/router/affinity.hpp` (the 11.5
  commit) shows the **inner filter already existed then** — the named mutation was equivalent on
  the day the "VERIFIED by running the mutation" sentence was written. Either the run did not
  happen as described, or the description names a different mutation than the one run.
- **The property itself IS covered** (verified): dropping the INNER filter
  (`entry.priority != priority → continue`) goes red — `[11.5-priority-precedence]` **and**
  `[11.5-jitter-stable]` both fail (also contradicting the record's "alone"). So this is an
  evidence-integrity defect, not a coverage hole: the ledger's proof text for 11.5 cannot be
  replayed, which is exactly what a careful reader would try to do with it.
- **Implication for the record:** the build's revertAssertions are its machine-checkable proof of
  non-vacuous tests. I re-derived eight others (0.3-shape spot checks via CG2/RA1/RA2/RA3/RA4/
  RA5/RA7) and all reproduced exactly; 11.5 is the one that does not. Each revertAssertion is
  prose, never re-run by any gate — nothing would ever have caught this drift. (Cross-lens: a
  mechanism for replayable revertAssertions belongs to the capability review.)
- **Fix direction:** correct 11.5's entry to name the inner-filter mutation (and the true failing
  set), and note the outer guard at :107 as a redundant-but-documented fast path or remove it.

### SWEEP-GATE-MUTATION-010 — (lower confidence) `test_12_1_live_stamp_and_m8` failed intermittently three times during gate runs, then resisted 9+ reproduction attempts

- **Where:** `scripts/test_conductor_wiring.py:1470` (GateAndLiveRecord.test_12_1_live_stamp_and_m8),
  as run by the python leg of `scripts/test-conductor.sh`.
- **Class:** flaky gate leg (if real). Confidence: LOW — root cause not established.
- **Observed:** during this sweep the python leg failed three times — twice inside scoped gate runs
  (reported only as `GATE FAIL: python leg`), once in a standalone full discovery run where the
  failing test was identified by name — while the *only* tree difference was an unrelated one-line
  tools.ts event-name mutation (JV3), which the same discovery subsequently passed with, twice.
  Six further clean full-discovery runs (~40s each) and single-file runs all passed. The test body
  reads only static committed files (`router/UPSTREAM_CONTRACT.md`, artifact paths) and has no
  visible nondeterminism; the failing assertion was never captured (my greps recorded only the
  test name).
- **What would settle it:** a 20× flake sweep of
  `/usr/bin/python3 -m unittest discover -s scripts -p 'test_*.py'` capturing full tracebacks
  (the enforcement review's Part C flake sweep is the natural place). If it recurs, the failing
  assertion will say whether something transiently unlinks/rewrites an artifact path (the
  schema-export leg is the only writer near that window) or whether an earlier test in
  test_conductor_bench leaves shared state.
- **Also worth noting regardless:** when the python leg fails, the gate prints only the unittest
  tail — inside a long gate run the FAILING TEST NAME is present but nothing marks which leg's
  scratch file to inspect after the run, since `$LEG_TMP` is deleted on exit. An operator
  debugging an intermittent leg failure has no artifact to look at. (IDEA-scale fix: on failure,
  copy the leg output somewhere durable before the trap fires.)

### SWEEP-GATE-MUTATION-011 — Detector C's "is each router header exercised by a test" loop is dead code: its check ends in `|| true` and its result is discarded

- **Where:** `scripts/verify-acceptance.sh:340-343`:
  ```
  for m in $(git ls-files 'router/*.hpp'); do
    base="$(basename "$m" .hpp)"
    ls router/tests/ 2>/dev/null | grep -q "$base" || true
  done
  ```
- **Class:** P1 — decorative by construction, no mutation needed: the loop computes a boolean and
  throws it away (`|| true`), sets no variable, and `CPP_MISSING` is unaffected. A router header
  with no test file of matching name can never fail detector C. This is the acceptance-meter
  sibling of the "new-source-not-imported-by-any-test" hollowness check the M5 header says lives
  in verify-acceptance.sh — for the C++ half it genuinely does not.
- **Reality check:** today every named header does have a matching `router/tests/*_test.cpp`
  (existence arm verified by DC mutation), so nothing is currently slipping through — the check
  is dead, not the property.
- **Fix direction:** collect misses into a variable and fail on it, mirroring detector A's
  `UNIMPORTED_MOD` arm — or delete the loop rather than let it read as coverage (a reader
  skimming the meter counts it as a check; that is exactly the "citation was the only thing that
  existed" shape C-048 recorded).

## 2. IDEA register

### IDEA-001 — M5's trivially-true-assertion scan pins three literal spellings only

Origin: M12b — `assertZZ.ok(true)` (any alias, or `assert.equal(2, 2)`, or `assert.ok(1)`) passes
`PAT_TRIV`. Kind: tooling. Value: the TRIV leg currently catches only the canonical accident
spelling; widening to `\.ok\((true|1)\)` and `\.equal\((\w+), ?\1\)` catches the family without
false positives. Cost: minutes. Relates to: SWEEP-GATE-MUTATION-003 (same scan family).

### IDEA-002 — `git ls-files`-based floors count the INDEX, not the worktree

Origin: reading conductor-gate.sh:16 and verify-acceptance.sh:42. A file deleted from the worktree
but not staged still appears in `git ls-files`, still counts toward the M5 floors and acceptance
row 1a, and is then silently skipped by M5's `[ -f "$f" ] || continue`. So in a
worktree-deleted/tracked state the scan "covers" files it never opens. Kind: tooling. Value:
`[ -f ]` miss should be counted and reported ("N tracked files missing from worktree"), not
skipped. Cost: small. Relates to: P1 family.

### IDEA-003 — Acceptance detector A's "imported by a test" arm is a basename *mention* grep

Origin: detector A reads `grep -rqF "$base" conductor/tests/` — a module named only in a comment
counts as "imported". All 28 modules are mentioned in ≥2 test files today, so the arm is
satisfied, but it cannot distinguish an import from prose; `index.ts` in particular matches many
unrelated mentions. Kind: test-maintainability. Value: switch to matching `from "…/<base>"` /
`import("…/<base>")`. Cost: small. Relates to: SWEEP-GATE-MUTATION-007's lesson (text-level
scanners drift from what they claim).

### IDEA-004 — CLAIMED_BRIDGES in tool-binding.test.ts is dead configuration, and its liveness probe greps raw text

Origin: TB4 — `conductor_queue_amend.ops` is now declared with the full object structure, so the
mismatch that would consult the bridge is never computed; `bridgeIsReal` is unreachable, and if it
ever runs again it greps `parseAmendOps\s*\(` over raw source where a future *comment* containing
a call-shaped mention would satisfy it. Kind: test-maintainability. Value: either delete the entry
(the shapes agree now) or assert the bridge entry is only present while a mismatch exists — a
stale excuse list is the "excuse list is not a comparison" defect the file's own comment warns
about, one seam over. Cost: small.

### IDEA-005 — The gate discards its leg scratch dir on failure

Origin: SWEEP-GATE-MUTATION-010's debugging experience; `trap 'rm -rf "$LEG_TMP"' EXIT` deletes
the bun/python leg output even when the gate fails, so an intermittent leg failure leaves nothing
to inspect. Kind: ergonomics. Value: `[ "$BAD" -ne 0 ] && cp` the leg outputs to
`.conductor/gate-failures/<ts>/` (or print full output, not tail) before exit. Cost: minutes.

### IDEA-006 — The node-suite test count is not stable run to run (1382 vs 1386)

Origin: baseline full gate reported `tests=1382`; acceptance row 1b's full gate the same hour
reported `tests=1386`, same tree. See mutation table CD1 for the follow-up run. Any check or
record that uses the aggregate count as a proxy (STATE.json `tap` counts, "1,382 node tests" in
the briefing/handoff) inherits a ±few drift, which is worth knowing before anyone treats an exact
count as evidence (P1-adjacent). Likely mechanism: a handful of dynamically-registered subtests
(retry/timing-dependent). Kind: docs/tooling. Value: pin down which files register variable
subtest counts, or stop quoting exact totals. Cost: small investigation.

---

## 3. CROSS-LENS POINTERS

- **Enforcement (Part A/C owner):** `legalTools`' FOURTH parameter `repoConfigured` is hardcoded
  `true` at three production call sites (`adapter/continuation.ts:662`, `adapter/tools.ts:2621`,
  `:5154`) while `inject.ts:117` derives it — the callsites audit guards only the fifth argument.
  If a handler can run in an unconfigured repo, those `true`s claim configuration that may not
  exist. Someone should trace whether those paths are reachable pre-setup.
- **Enforcement (Part C):** production plugin/index.ts:1052-1058 JSON-stringifies declared
  queue-amend ops and re-parses through `parseAmendOps` — my TB4 mutation (bypassing the parse
  with a cast) was caught by NO audit; whether a behavioral test catches it was not checked here.
  P5 question: what test feeds queue_amend an op `parseAmendOps` must REJECT, through the real
  binding?
- **Macro:** `stripComments` exists twice (journal-vocab, legaltools-callsites) with the C-089
  header explicitly calling the copy "the … idiom" — P3 restatement without a drift guard; the
  fix for ISSUE-007 should hoist one helper.
- **Macro:** the outer burst guard at router/affinity.hpp:107 is redundant with
  oldestBurstMember's class filter (see ISSUE-009) — simplification candidate with a comment that
  currently over-claims its necessity.
- **Capability:** revertAssertions are prose that no gate ever replays (ISSUE-009 proves one has
  rotted). A `revert-probe` runner — each task carrying a machine-applicable patch + expected
  failing test ids, re-run on demand — would make the ledger's proof claims durable.
- **Capability:** rows 6/7/8/9b of acceptance attest artifact *shape* only (ISSUE-006 quantifies
  the fabrication cost at ~15 seconds). A mechanism binding live artifacts to run ledgers
  (runId + evidence seq that re-validate) would raise the floor.
- **Macro/docs:** the briefing and HANDOFF quote "1,382 node tests" as an exact figure; the count
  drifts (IDEA-006). Exact-count claims in the record should be ranges or per-file counts.

---

## 4. Mutation table

| # | Mutation | File | Expected | Result | Verdict | Caught by |
|---|---|---|---|---|---|---|
| M1 | new test asserting `1 == 2` | conductor/tests/ (scratch file) | gate red | GATE FAIL exit 1 | BINDS | TAP fail-count check (test-conductor.sh:47) |
| M2 | `test.skip` in a test file | scratch test file | gate red | GATE FAIL ×2 | BINDS | skipped-count AND directive scan (both fired) |
| M3 | `describe.skip` wrapping a test | scratch test file | gate red (C-015 class) | GATE FAIL, trailer skipped=0 but skipdirectives=1 | BINDS | directive scan ONLY — trailer counts blind, exactly as C-015 recorded |
| M4 | zero-match glob argument | test-conductor.sh invocation | gate red | GATE FAIL "zero tests ran" | BINDS | TESTS==0 check |
| M9 | test file throws at import | scratch test file | gate red | fail=1, GATE FAIL | BINDS | TAP fail count (node counts a load error as a failing test) |
| M5 | `mv conductor/tsconfig.json` aside | scripts/test-conductor.sh subject | expected red or warn | **GATE PASS, silent** | **DOES NOT BIND → ISSUE-001** | nothing |
| M6 | `mv conductor/tests/bun-smoke.test.ts` aside | test-conductor.sh subject | red or warn | **GATE PASS, silent** | **DOES NOT BIND at gate level → ISSUE-002** | only verify-acceptance rows 2/4 (acceptance-time) |
| M6b | `mv conductor/tools/export-schemas.ts` aside | test-conductor.sh subject | red | GATE FAIL (tsc TS2307) | BINDS | typecheck leg (P6: in a scoped run the export-leg conditional itself stayed silent; full-suite TAP would also red via export-schemas.test.ts import) |
| M7 | mv both `scripts/test_*.py` aside | python leg | red | GATE FAIL "discovered ZERO tests" | BINDS | PY_RAN floor |
| M8 | `@unittest.skip` test added | scripts/ (scratch file) | red | GATE FAIL "skipped/expected-failure" | BINDS | unittest-trailer skip grep |
| M10 | `// TODO:` appended to production file | conductor/adapter/state.ts | M5 red | M5 FAIL "stub marker" | BINDS | PAT_STUB |
| M11 | **multi-line** empty catch in production | conductor/adapter/state.ts | M5 red | **M5 PASS** | **DOES NOT BIND → ISSUE-003** | nothing (grep is line-based) |
| M11b | single-line empty catch (control) | conductor/adapter/state.ts | M5 red | M5 FAIL "empty catch" | BINDS | PAT_CATCH |
| M12 | `assert.ok(true)` in comment | conductor/tests/smoke.test.ts | (probe) | M5 FAIL | binds-textually (fail-closed false positive) | PAT_TRIV |
| M12b | aliased trivial assertion `assertZZ.ok(true)` | conductor/tests/smoke.test.ts | M5 red ideally | M5 PASS | evadable — see IDEA-001 | nothing (pattern pins 3 literal spellings) |
| M13 | `"test.skip("` as a string literal | conductor/tests/smoke.test.ts | (probe) | M5 FAIL | binds-textually (fail-closed) | PAT_SKIP |
| M14 | `// this module is a stub …` in production | conductor/adapter/state.ts | M5 red | M5 FAIL "'stub' in production" | BINDS | PAT_STUBWORD |
| M16 | exempted anchor line rewritten | conductor/adapter/tools.ts:4854 | whole-tree M5 red (stale exemption) | M5 FAIL "exemption 0 … stale" | BINDS | exemption-liveness sweep |
| R7 | all "quarantine" mentions removed | conductor/docs/RUNNER-DISCOVERY.md | row 7 red | FAIL row 7 | BINDS | check_artifact substring |
| R9a | `--no-router` renamed everywhere | scripts/serve.py | row 9a red | FAIL row 9a | BINDS | grep (note: a comment mention would also satisfy it — none exists today, serve.py has exactly 1 occurrence and it is the real flag) |
| R9b | "terminal state" removed | docs/build/artifacts/12.1-g5-equivalence.md | row 9b red | FAIL row 9b | BINDS | check_artifact substring |
| R10a | `derive_slots` returns readers+1 | scripts/conductor_wiring.py | row 10 red | FAIL row 10 | binds (by accidental double-derivation) | argv `--parallel` comparison |
| R10b | `derive_slots` returns constant 1 | scripts/conductor_wiring.py | row 10 red | **PASS row 10** | **DOES NOT BIND → ISSUE-004** | only scripts/test_conductor_wiring.py (python leg, 4 failures) — not the named row |
| R11a | `mv OPERATIONS.md` aside | conductor/docs/OPERATIONS.md | row 11a red | FAIL row 11a | BINDS | existence check |
| R11b | limit 15 renumbered away | conductor/docs/HONEST-LIMITS.md | row 11b red | FAIL row 11b (14 vs plan 15) | BINDS | independent two-source count |
| R12 | task 1.1 commitMessage forged | docs/build/STATE.json | row 12 red | FAIL row 12 (missing: 1.1,…) | BINDS | git-log exact-once cross-check |
| DA | `mv adapter/questions.ts` aside | detector A subject | red | FAIL detector A (missing) | BINDS | existence arm |
| DB | doctrine/core.md truncated to 4 lines | conductor/doctrine/core.md | detector B red | FAIL detector B | BINDS | wc -l floor |
| DC | `mv router/metrics.hpp` aside | detector C subject | red | FAIL detector C | BINDS | existence arm |
| DF-a | stamp line → prose mention of the stamp | router/UPSTREAM_CONTRACT.md | detector F red | **PASS detector F** | **DOES NOT BIND → ISSUE-005** | nothing |
| DF-b | stamp line → `<pending>` (control) | router/UPSTREAM_CONTRACT.md | red | FAIL detector F | BINDS | the pending-grep |
| R2 | failing assertion appended | conductor/tests/bun-smoke.test.ts | row 2 red | FAIL row 2 | BINDS | bun test exit code |
| R6 | fabricated 26-line SMOKE.md | conductor/SMOKE.md (probe file) | (fabrication probe) | **PASS row 6** | fabricable by design → ISSUE-006 | n/a |
| R5 | `[13.1-bad-ending]` scenario retitled | conductor/tests/e2e.test.ts | row 5 red | row-5 logic reports missing "bad-ending" → FAIL | BINDS | five-name TAP grep (word-grep mechanism is fragile but sound today: each keyword appears in TAP only via its own scenario's titles) |
| LA1 | inject.ts legalTools call drops 5th arg | conductor/adapter/inject.ts:117 | audit red | fail=1 | BINDS | [C-048-callsites] arity assertion (test 1) |
| LA2 | tools.ts:2621 5th arg → literal `true` | conductor/adapter/tools.ts | audit red | fail=1 | BINDS | [C-048-callsites] derived-never-literal assertion (test 2) |
| JV1 | visible call site `lock.released` → `lock.dropped` | conductor/adapter/state.ts:730 | audit red | fail=1, message names lock.dropped | BINDS | [vocab-callsites] breaches assertion |
| JV2 | NEW dynamic `.log(…, event=variable)` appended at tools.ts tail | conductor/adapter/tools.ts | audit red (pinned dynamic set) | **7/7 pass** | **DOES NOT BIND → ISSUE-007** | nothing — the site is inside a stripComments-blanked span |
| JV3 | INVISIBLE call site `config.updated` → unlisted `config.mutated-probe` | conductor/adapter/tools.ts:9233 | audit red | **7/7 pass** | **DOES NOT BIND → ISSUE-007** | nothing (exploit prove-out) |
| TB1 | conductor_override loses declared `reason` arg | conductor/plugin/index.ts | binding audit red | fail=1, names OverrideInput.reason | BINDS | [C-044-binding] equation test |
| TB2 | TOOL_BINDINGS decide `fixed: {kind:"human"}` | conductor/core/tool-bindings.ts | audit red | fail=1 | BINDS | [C-044-binding] conductor_decide ruling test |
| TB3 | decide `options` re-declared `S.array(S.string())` | conductor/plugin/index.ts:566 | shape audit red | fail=1, names array<string> vs array<object> | BINDS | [C-047-shape] coarse comparison |
| TB4 | real `parseAmendOps(…)` call replaced by inline cast | conductor/plugin/index.ts:1058 | bridge check red | 6/6 pass | does not bind — but the bridge branch is UNREACHABLE today (ops is declared as the full structure, so no mismatch is ever computed; CLAIMED_BRIDGES is dead config). See IDEA-004 | n/a |
| CG1 | DEFAULT_CONFIG git.mode → "commit" | conductor/adapter/config-io.ts | composition red | fail=2, both named rows | BINDS | [5.4a-default-config-is-safe-not-permissive] + [5.4a-config-absent-defaults] |
| CG2 | `mv config-io.ts` aside (recorded 5.4a red) | conductor/adapter/config-io.ts | missing-subject red | ERR_MODULE_NOT_FOUND, tests=1 pass=0 | BINDS — **matches recorded revertAssertion** | module load |
| G5A | shipped G5 artifact arms flattened byte-identical | docs/build/artifacts/12.1-g5-equivalence.md | guard red | fail=1 | BINDS | anti-tautology check via g5-artifact.test.ts test 1 |
| G5B | REPORT-METRICS-WITH totalRequests 6→9 | same artifact | guard red | fail=1 | BINDS | served-vs-report deep-equal (provenance) |
| PU1 | `import node:fs` into core/verdict.ts | conductor/core/verdict.ts | purity red | fail=2 (both guards) | BINDS — **matches recorded 1.4 probe A** | 1.4-core-imports + 1.4-core-forbidden |
| PU2 | shell-string `exec()` via sanctioned import in adapter | conductor/adapter/gitio.ts | purity red expected | **4/4 pass** | **DOES NOT BIND → ISSUE-008** | nothing |
| SS1 | RUN_STATES gains "DAYDREAMING" | conductor/core/fsm-run.ts | single-source red | fail=1 | BINDS | [G6-single-source] Run set-equality |
| SH1 | NUL byte in a new conductor/*.ts file | conductor/zz-nul-probe.ts (probe) | hygiene red | fail=1, names the file + 0x00 | BINDS | [hygiene-no-control-bytes] |
| RA1 | `mv doctrine/tdd.md` aside (task 8.1 claim) | conductor/doctrine/tdd.md | doctrine red per record | 4 tests red: 8.1-files, 8.1-mechanism, 8.1-anchors-tdd (+8.1-no-todo) | BINDS — **record matches** (record named the first three) | named anchor tests |
| RA2 | continuation halt branch → `if (false && …)` (task 10.1 claim) | conductor/adapter/continuation.ts:794 | exactly [10.1-halt-interrupt] red | 46/47 pass, exactly that row red | BINDS — **record matches** (suite grew 33→47 since) | [10.1-halt-interrupt] |
| RA3 | detectRunner python-pytest arm dropped (task 12.2 claim) | conductor/adapter/evidence.ts:138 | 2 named rows red | fail=2: [12.2-detect-itemtest-templates], [12.2-c003-pytest-measured] | BINDS — **record matches exactly** (suite grew 28→37) | the two named rows |
| RA4 | score_cell → unconditional pass (task 14.1 claim) | scripts/conductor_bench.py:885-891 | ≥2 failures per record | 3 failures incl. test_score_is_exit_status_passthrough | BINDS — **record matches** (2→3 as suite grew) | exit-status passthrough tests |
| RA5 | replay.ts survivingMajors guard line deleted (task 15.0 claim) | conductor/tools/replay.ts:439 | 2 of 28 red incl. named row | fail=2 incl. [15.0-guard-reject-needs-surviving-majors] | BINDS — **record matches exactly** | the named row + round-table row |
| RA7 | handlePublish head-mismatch guard → `if (false)` (task 13.1 claim) | conductor/adapter/tools.ts:6873 | [13.1-full-pipeline] red | [13.1-full-pipeline] red (19 subtest failures) | BINDS — **record matches** | the full-pipeline scenario's publish assertions |
| RA6 | `burst_->priority == eligible` guard dropped, exactly as task 11.5's record names | router/affinity.hpp:107 | ctest red per record | **ctest 100% passed** (rebuilt both directions) | **DOES NOT BIND — recorded evidence does not reproduce → ISSUE-009** | nothing; the inner filter subsumes the guard, and did at the 11.5 commit too (verified via `git show 53c5bf7`) |
| RA6b | inner `entry.priority != priority` filter dropped (charitable reading) | router/affinity.hpp:179-180 | red | ctest FAILED: [11.5-priority-precedence] AND [11.5-jitter-stable] | BINDS (property covered; record's "alone" also wrong) | affinity_test.cpp:1097 CHECK(taken.entry.priority == lowest) |
| R4 | `mv conductor/tests/purity.test.ts` aside | verify-acceptance row 4 | red | FAIL row 4: guard file missing | BINDS | named-guard existence arm (runs even under --quick) |
| CD1 | (observation, not a mutation) full-gate test count across runs | scripts/test-conductor.sh | stable count | 1382 (baseline) / 1386 (inside acceptance row 1b) / 1382 (final clean run) | count is NOT a stable proxy → IDEA-006 | n/a |
| — | fabricated conductor/SMOKE.md (row 6, see R6) then deleted; no other unrestored change. Final full gate after all mutations: **GATE PASS, tests=1382 pass=1382**, typecheck OK, bun OK, python 80 OK — the tree ends the sweep clean. | | | | | |

---

## 4b. The 21 acceptance rows, each with a verdict

| Row | Subject | Mutation ref | Verdict |
|---|---|---|---|
| 1a | ≥24 test files (git ls-files count) | analysis only | binds for tracked deletions committed to the index; counts index not worktree (IDEA-002); not mutated |
| 1b | full suite via canonical gate | M1-M9 | binds (inherits gate holes ISSUE-001/-002) |
| 2 | bun leg on the named file | R2 | binds |
| 3 | ctest on router-tests | RA6b (red) + baseline (green) | binds — the leg can fail and the build/rebuild path works |
| 4 | three named guard files exist + scoped run | R4 | binds (existence arm fires even under --quick) |
| 5 | e2e green + five scenario names in TAP | R5 | binds; word-grep mechanism fragile but currently sound |
| 6 | SMOKE.md shape | R6 probe | can fail (currently failing); fabricable in ~15s (ISSUE-006) |
| 7 | RUNNER-DISCOVERY.md shape+keyword | R7 | binds |
| 8 | POC report shape | currently failing | can fail (missing); same fabricability as row 6 |
| 9a | serve.py --no-router grep | R9a | binds; comment-mention would also satisfy (none exists) |
| 9b | G5 equivalence artifact shape | R9b (+G5A/G5B for the standing test) | binds |
| 10 | one-number derivation probe | R10a (red) / R10b (green) | **partially decorative — ISSUE-004** |
| 11a | OPERATIONS.md exists | R11a | binds |
| 11b | §9 limit count vs plan | R11b | binds (independent sources) |
| 12 | manifest commit messages exactly once | R12 | binds |
| A | §1.1 modules exist/non-empty/named-by-test | DA | existence+empty arms bind; named-by-test arm is a mention-grep (IDEA-003) |
| B | nine doctrine packs non-trivial | DB | binds |
| C | router modules exist; per-header tests | DC | existence binds; test-coverage loop DEAD (ISSUE-011) |
| D | whole-tree M5 | M10-M16 | binds (inherits ISSUE-003) |
| E | five live artifacts exist | currently failing | can fail (two missing today) |
| F | WIRE_CONTRACT_VERIFIED stamp | DF-a (green) / DF-b (red) | **binds only against the literal `<pending>` spelling — ISSUE-005**; python stamp test is the real guard |

## 5. Coverage ledger

| File | What was done | Coverage | Conclusion |
|---|---|---|---|
| scripts/test-conductor.sh | read whole (137 lines); 9 mutations (M1-M9) | full | binds on fail/skip/describe-skip/zero-glob/load-error/python-zero/python-skip; two silent-skip holes (ISSUE-001, -002); forged-TAP-trailer attack cleared (see §6) |
| scripts/conductor-gate.sh | read whole (173 lines); 8 mutations (M10-M16) | full | binds on markers/stub-word/skip/triv/single-line catch/stale exemption; multi-line empty catch invisible (ISSUE-003); TRIV literalism (IDEA-001); index-vs-worktree floors (IDEA-002) |
| scripts/verify-acceptance.sh | read whole (401 lines); 20 row/detector mutations + baseline full run | full — every one of the 21 rows has a verdict (see §6 enumeration) | 16 arms bind; row 10 self-referential (ISSUE-004); detector F prose-mention hole (ISSUE-005); detector C test-coverage loop dead (ISSUE-011); rows 6/7/8/9b fabricable-by-design (ISSUE-006) |
| conductor/tests/legaltools-callsites.test.ts | read whole; LA1/LA2 mutations; shares stripComments | full | both assertions bind at the intended check; inherits ISSUE-007 (blanked spans could hide a call site; none does today — the 4 known sites are all in visible regions, verified) |
| conductor/tests/journal-vocab.test.ts | read whole; JV1/JV2/JV3 mutations + standalone scanner replication | full | breaches assertion binds for visible sites; **ISSUE-007**: ~240 lines of tools.ts + ~227 of gates-edit.ts invisible; one real call site (tools.ts:9233) unaudited; smuggled dynamic site accepted |
| conductor/tests/tool-binding.test.ts | read whole (703 lines); TB1-TB4 mutations | full | inventory/equation/ruling/shape checks all bind by their named assertions; CLAIMED_BRIDGES dead config (IDEA-004) |
| conductor/tests/composition.test.ts | read first 1150 of 1583 lines + header contract; CG1/CG2 mutations | partial (mutation-verified on the config-io half; the chat-message/journal-rebind rows exercised only via suite runs) | DEFAULT_CONFIG safety pins bind; missing-subject red reproduces the recorded 5.4a evidence |
| conductor/tools/g5-artifact-check.ts | read whole (239 lines); G5A/G5B artifact mutations via g5-artifact.test.ts | full | anti-tautology + provenance checks bind; refusal cases exist in the test (P5 satisfied); note: `envNamesReadBySource` counts a name in a COMMENT as "read", and rule 3 is skipped whenever argv differs — both unexploited today |
| conductor/tests/g5-artifact.test.ts | read whole (175 lines) | full | negative cases feed the checker the recorded defect shapes verbatim; DEAD_VAR assembly note verified |
| conductor/tests/purity.test.ts | read whole (263 lines); PU1/PU2 mutations | full | core purity binds (matches 1.4 record); subprocess rule import-only (ISSUE-008); core-forbidden list lacks Math.random/setTimeout (core clean today — grep-verified, noted only) |
| conductor/tests/single-source.test.ts | read whole (80 lines); SS1 mutation | full | binds; expected values come from SCHEMAS at runtime — independent of the FSM arrays (P2 clean) |
| conductor/tests/source-hygiene.test.ts | read whole (119 lines); SH1 mutation | full | binds, names file and byte |
| conductor/tests/doctrine.test.ts | titles enumerated; RA1 mutation | partial (one pack mutation; 15 anchor tests not individually mutated) | 8.1 record reproduces; anchor tests fail on pack removal as claimed |
| conductor/tests/e2e.test.ts | scenario structure read; R5 + RA7 mutations (two full e2e runs) | partial (as a checking instrument; its internals belong to the main enforcement agent) | row-5 name-grep binds; head-mismatch guard is load-bearing for [13.1-full-pipeline] |
| conductor/tests/bun-smoke.test.ts | R2 mutation | mutation-level | bun leg binds on a failing assertion |
| conductor/tests/continuation.test.ts | RA2 mutation | mutation-level | [10.1-halt-interrupt] binds exactly as recorded |
| conductor/tests/setup.test.ts | RA3 mutation | mutation-level | the two recorded rows bind exactly |
| conductor/tests/replay.test.ts | RA5 mutation | mutation-level | the recorded SG-3 guard row binds exactly |
| scripts/conductor_wiring.py + test_conductor_wiring.py | R10a/R10b mutations; flake sweep ×6; stamp test read | partial | unit tests bind on derive_slots collapse; acceptance row 10 does not (ISSUE-004); one unexplained intermittent (ISSUE-010) |
| scripts/conductor_bench.py + test_conductor_bench.py | RA4 mutation | mutation-level | score_cell passthrough binds (3 failures) |
| scripts/serve.py | R9a mutation | mutation-level | row 9a binds; single real occurrence of --no-router |
| router/affinity.hpp (+ router-tests via ctest) | read selection paths; RA6/RA6b mutations, rebuilt both directions | partial (affinity only; other router headers untouched by me — DC existence mutation aside) | property covered by inner filter; **recorded 11.5 evidence irreproducible (ISSUE-009)** |
| router/UPSTREAM_CONTRACT.md | DF-a/DF-b mutations | mutation-level | detector F hole (ISSUE-005); python stamp test is the stronger guard (requires colon + date + task id) |
| docs/build/STATE.json | structure read; all 57 revertAssertions listed; 8 re-derived (0.3-shape via CG2, 8.1, 10.1, 12.2, 13.1, 14.1, 15.0, 11.5); R12 mutation | partial (49 revertAssertions not re-run — most are missing-subject `mv` shapes of the same class as the five that reproduced) | 7 of 8 reproduce exactly; 11.5 does not (ISSUE-009) |
| docs/build/artifacts/12.1-g5-equivalence.md | read first 80 lines + marker lines; G5A/G5B | substantial | the shipped record passes; both tamper shapes go red |
| conductor/adapter/config-io.ts, inject.ts, state.ts, evidence.ts, continuation.ts, gitio.ts, tools.ts (mutation sites), plugin/index.ts (decl. sites), core/fsm-run.ts, core/tool-bindings.ts, core/verdict.ts, tools/replay.ts | used as mutation subjects at named lines; not reviewed line-by-line | subject-level only | out of this sweep's lens except as check-subjects |
| NOT EXAMINED (this sweep) | conductor/tests/* not named above (~35 files), router/*.hpp other than affinity, GATES.json adjudications, doctrine pack contents, fanout/watchdog internals | — | other sweeps of the enforcement review own these |

---

## 6. Cleared areas — attacked and could NOT break

- **Forged TAP trailer:** a test that prints fake `# tests/# pass` lines to stdout cannot spoof
  the gate — the wrapper's awk takes the LAST occurrence of each counter and node writes the real
  trailer after all test output; a forged `not ok … # SKIP` line only makes the gate MORE likely
  to fail (fail-closed). Not exploitable.
- **Trailer-invisible skips:** `describe.skip` (the C-015 shape) is caught by the directive scan
  even though the trailer shows `skipped=0` — re-verified live (M3).
- **Erroring-instead-of-failing tests:** a module that throws at load is counted `fail=1` by node
  and fails the gate (M9).
- **Python-leg vacuous pass:** zero-discovery and unittest-level skips both fail loudly (M7, M8).
- **M5 exemption rot:** rewriting the anchored line makes the whole-tree scan fail with the stale
  exemption named (M16) — the liveness sweep genuinely binds.
- **STATE.json row-12 forgery:** an invented commitMessage is caught by the exact-once git-log
  cross-check (R12); the check's two sides (ledger vs `git log`) are independent (P2-clean).
- **HONEST-LIMITS drift:** the limit count is compared against the immutable plan's §9 section
  re-counted at run time — deleting a limit from the doc alone fails (R11b); deleting it from
  both sides is impossible (the plan is immutable and the count is re-derived).
- **G5 artifact tampering:** flattening the arms or forging the WITH-arm metrics both fail the
  standing guard (G5A/G5B); the checker's refusal behaviour is itself tested with the recorded
  defect shapes (P5 satisfied at both levels).
- **Tool/handler surface drift:** all four C-044/C-047 checks bind at their named assertions
  (TB1-TB3); the extraction floors make a broken parse loud (verified indirectly — every
  extraction assertion carries a floor and the parse produced >16 handlers).
- **FSM vocabulary drift:** RUN_STATES vs schema enum binds; the schema side is read from
  runtime SCHEMAS, not restated (SS1).
- **Doctrine pack removal:** binds with the anchors named in the record (RA1).
- **Recorded revertAssertions:** 7 of 8 sampled reproduce their claimed red exactly, including
  three e2e/live-shaped ones (RA2, RA3, RA7) — the ledger's evidence is largely honest; the one
  exception is ISSUE-009.
- **Acceptance existence arms:** rows 2, 4, 7, 9a, 9b, 11a, 11b, 12, detectors A, B, C
  (existence half), D, F (pending half) all go red under their subject's mutation.

### Process hygiene

Stray-process check before finishing:
`ps -ax -o pid,etime,command | grep -E "llama-router|fake-llama|time\.sleep" | grep -v grep`
returned nothing (run at sweep end — see final tool call). All snapshots restored and
`cmp`-verified; the fabricated SMOKE.md probe and both scratch test files deleted; final
full gate: **GATE PASS tests=1382**, and `git status --porcelain` shows only the pre-existing
untracked addendum plan and this review directory.

