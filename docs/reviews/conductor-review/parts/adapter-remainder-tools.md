# Enforcement Review — Part: Adapter Remainder + conductor/tools/

**Scope:** the adapter modules unclaimed by the state / fan-out / handler / composition scopes.
Cross-checked against the other part files' scope headers, that is exactly:
`conductor/adapter/config-io.ts`, `conductor/adapter/questions.ts`,
`conductor/adapter/worktrees.ts`, and `conductor/adapter/wire-notes.md` (a doc — accuracy check
only) — plus all of `conductor/tools/`: `export-schemas.ts`, `g5-equivalence.ts`,
`g5-artifact-check.ts`, `replay.ts`.
(Claimed elsewhere: state.ts/journal.ts/evidence.ts/quarantine.ts/gitio.ts → state-crash;
fanout.ts/continuation.ts/router-client.ts → fanout-concurrency; tools.ts → tools-handlers-a/b;
inject.ts/chat-message.ts/plugin/index.ts/doctrine → composition-injection.)

**Date:** 2026-08-15
**Reviewer:** enforcement sub-reviewer (adapter-remainder-tools)
**Method:** per briefing §4 — read whole files, mutate every check, snapshot/restore with cp+cmp,
gate through `bash scripts/test-conductor.sh`.
**Status:** COMPLETE. 8 ISSUEs (001 MEDIUM, 002/004/005 MEDIUM-LOW-to-MEDIUM, 003/006/007/008
LOW-MEDIUM), 10 IDEAs, 6 cross-lens pointers, 12 mutation-table rows (7 code mutations — 4 bound,
3 survivors; 4 live repros; 1 live driver re-derivation). All seven source files restored and
`cmp`-verified; final full gate on the restored tree **GATE PASS 1382/1382**; no stray processes.
One genuine positive worth carrying to the merge: config-io.ts + composition.test.ts is the model
implementation of P3 mitigation and refusal testing in this repo — cite it as the pattern to copy.

---

## 1. ISSUE register

### ADAPTER-REMAINDER-TOOLS-001 — Both refusal arms in questions.ts are decorative: the QuestionRecord validator AND the Item validator can be deleted and the full 1,382-test gate stays green (P5)

**Pattern:** P5 (a happy-path test cannot prove a validator is in the path).
**Severity:** MEDIUM.
**Where:** `conductor/adapter/questions.ts:79-84` (`assertValidQuestion`, called at 111 and 143) and
`conductor/adapter/questions.ts:161-164` (the `validate("Item", …)` refusal inside `answerQuestion`).
**Reproduced:** mutation Q-1 replaced `assertValidQuestion`'s body with a no-op → **full gate
GATE PASS (1382/1382)**. Mutation Q-2 deleted the Item `validate` + throw → **full gate GATE PASS
(1382/1382)**. Both restored and `cmp`-verified.

The module's header sells these checks as part of its contract ("refusing to write an invalid
QuestionRecord", "refusing to write an invalid item.json"), and `conductor/tests/questions.test.ts`
exercises appendQuestion/answerQuestion through 4 tests including a crash-ordering test and a
symlink attack — but **never once feeds either validator something it must refuse**. What a
validator uniquely provides is refusal (briefing P5); as of this run both refusals are provably
outside every test's path. Note the callers: `conductor/adapter/tools.ts` reaches `appendQuestion`
from at least six handler sites (591, 906, 992, 2246, 3794, 4231, 4571, 6099) with model-influenced
input (`question`, `askedBy.role`, `origin`, `blocksItems`); if a handler ever composes an
out-of-vocabulary `origin` or a malformed `blocksItems`, this validator is the ONLY line refusing a
corrupt ledger line — and nothing proves it still fires.

**Refutation attempted:** "the schema validator is core's, tested in types.test.ts, so refusal is
proven there." Refuted: types.test.ts proves `validate` can refuse; it cannot prove questions.ts
still *calls* it — Q-1/Q-2 demonstrate exactly that seam going dead with the suite green.
**Fix direction:** two tests: appendQuestion with an out-of-vocabulary `origin` must throw and leave
questions.jsonl unwritten; answerQuestion over a hand-corrupted item.json must throw and leave the
item file untouched.

### ADAPTER-REMAINDER-TOOLS-002 — removeWorktree silently no-ops when `git worktree remove --force` fails with the directory still present (locked worktree): admin entry AND branch survive, no error, no signal to the caller (REPRODUCED)

**Pattern:** P4 (the doc asserts "the administrative entry is what must never survive"; the body
guarantees that only for the directory-already-gone shape) plus a plain silent-failure bug.
**Severity:** MEDIUM-LOW.
**Where:** `conductor/adapter/worktrees.ts:306-317` (`removeWorktree`).
**Reproduced live** (scratch script `repro-remove-locked.ts`): init repo → `createWorktree` →
`git worktree lock <path>` → `removeWorktree` → output:

```
threw: false
still registered: true
branch survives: true "+ conductor/r-1/I1"
```

Mechanism: `remove --force` fails on a locked worktree (git wants `--force --force`); the fallback
`worktree prune` exits 0 but prunes nothing (the directory exists, so the entry is not prunable);
`branch -D` fails because the branch is checked out in the surviving worktree and `tryGit` swallows
the non-zero exit. Every failure is absorbed; the function returns void as if cleanup happened.

Why a lock is not exotic: `git worktree add` marks the new worktree LOCKED while it populates it
and unlocks at the end — a crash inside `createWorktree`'s add can leave exactly this state behind
without any operator action; an operator `git worktree lock … --reason keep` produces it directly.
The caller (the Task 10.1 run-lifecycle janitor) then believes the tree was removed, worktrees
accumulate, and no journal record or error ever says so.

**Refutation attempted:** "the next createWorktree's prune heals it." Refuted: prune only removes
entries whose directories are GONE; a locked or intact directory is never healed, and the healing
idiom the module leans on (stale-marker-break) does not cover this shape.
**Fix direction:** after the fallback prune, re-derive `isRegisteredWorktree`; if still registered,
throw naming the lock (or retry with `remove --force --force`); make `branch -D`'s failure loud
when the branch demonstrably still exists and the worktree was expected gone.

### ADAPTER-REMAINDER-TOOLS-003 — createWorktree's foreign-branch refusal is decorative: deleting it leaves the full 1,382-test gate green (P5/P12)

**Pattern:** P5 (refusal never tested) / P12 (a branch nothing has walked).
**Severity:** LOW-MEDIUM (mergeBack's own identity check — which IS tested,
tools-9.6.test.ts:1794 — backstops the worst outcome at merge time, but only after the item's
edits, tests and verify have all run in a wrong tree).
**Where:** `conductor/adapter/worktrees.ts:211-227` (the registered-arm branch-identity check).
**Reproduced:** mutation W-1 replaced the whole guarded arm with `return worktree;` (adopt any
checked-out branch silently) → scoped tools-9.6 gate **PASS 22/22**, then **full gate PASS
1382/1382**. Restored, `cmp`-verified.

The comment on the arm says "a foreign branch at that path is REFUSED rather than silently
adopted" — the reuse HAPPY side is pinned by [9.6-recreate-after-crash-reuses-branch], but the
refusal side is proven by nothing. A crashed-and-rewired worktree (or any manual `git checkout`
inside the state-home tree) would be adopted silently, and every stage up to merge-back would run
against the wrong branch's content.
**Fix direction:** one test: register the worktree, `git checkout -b other` inside it, assert
createWorktree for the same runId/itemId throws naming both branches.

### ADAPTER-REMAINDER-TOOLS-004 — The C++ tests' schema directory is regenerated only by the node gate: the ctest-only workflow validates against stale bytes, and exportSchemas never prunes a removed/renamed schema (P1-adjacent staleness seam)

**Pattern:** P1-adjacent — "the C++ router tests validate against the exact same objects the
fan-out engine feeds" (export-schemas.ts header, plan lines 470-476) is true only conditionally,
and nothing checks the condition.
**Severity:** MEDIUM-LOW.
**Where:** `conductor/tools/export-schemas.ts:21-31` (no pruning); `scripts/test-conductor.sh:94-104`
(the only regeneration point); `router/CMakeLists.txt` (no schema step — verified by grep);
`router/tests/config_test.cpp:129`, `admission_test.cpp:502`, `schema_observer_test.cpp:393-400`
(byte-read consumers).

Two demonstrations:
1. **No pruning:** planted `router/tests/schemas/Zombie.schema.json`, ran
   `node conductor/tools/export-schemas.ts router/tests/schemas` → **ZOMBIE SURVIVES EXPORT**
   (then removed). A renamed §2 schema leaves its old file in place forever on any machine that
   once exported; a C++ test still naming the old file stays green against a contract that no
   longer exists in `SCHEMAS`. export-schemas.test.ts's "directory contains exactly the schema
   files" case runs against a FRESH temp dir, so it can never see this.
2. **ctest freshness:** the directory is gitignored, and grep shows no CMake/ctest step invokes
   the exporter. The briefing's own sanctioned C++ loop (`cmake --build … --target router-tests
   && ctest`) after an edit to `core/types.ts` SCHEMAS validates llama-router against the
   pre-edit bytes — silently green against an outdated schema until the next full node gate.
   The exporter's comment concedes the CMake pre-build step is "later"; nothing records that gap
   as a known limitation anywhere an operator would read.

**Refutation attempted:** "the full gate always runs before anyone trusts ctest." Refuted by this
repository's own docs: the briefing instructs building and ctesting the router directly, and the
phase-11/12 records treat ctest output as evidence in its own right.
**Fix direction:** (a) make exportSchemas delete `*.schema.json` files not in `names` (one loop);
(b) add a CMake custom target or ctest fixture that runs the exporter (node is available), or at
minimum have a C++ test assert a freshness marker the exporter writes (e.g. a hash of SCHEMAS
embedded at export time and re-derived by the node gate).

### ADAPTER-REMAINDER-TOOLS-005 — The standing G5 gate authenticates the artifact's SHAPE, not its provenance: a wholly hand-typed artifact passes checkG5Artifact with zero violations (REPRODUCED), and the acceptance meter's row 9b is substring-grep on top

**Pattern:** P9 residual (evidence a reader cannot distinguish from fabrication), on the exact
artifact class the build names as its worst-case failure.
**Severity:** MEDIUM (calibrated: no self-contained textual check CAN prove provenance; the finding
is that the protection's real strength is narrower than the surrounding record implies, and the
strongest available cross-checks were left unused).
**Where:** `conductor/tools/g5-artifact-check.ts:156-238` (the checker);
`conductor/tests/g5-artifact.test.ts:58-76` (the standing gate leg over the shipped file);
`scripts/verify-acceptance.sh:138-152` + row 9b (a >20-line + transcript-marker + substring grep).
**Reproduced** (scratch `repro-forge-g5.ts`): a six-line fabricated artifact — plausible arm
commands differing in the two real env vars, one invented MetricsSummary pasted onto BOTH
`ROUTER-SERVED-SUMMARY:` and `REPORT-METRICS-WITH:`, `null` on the WITHOUT line — returns
`ok: true, violations: []`. No router was started; no e2e ran. Substituted for the committed
artifact, it would pass the node gate's G5 leg and acceptance row 9b as-is.

What the checker DOES prove (verified by mutations G5C-1/G5C-3, both bound): the recorded arms are
not byte-identical; an env-only difference must name a variable some shipped file mentions; the two
summary lines must deep-equal each other. Those rules kill the C-089 shape — an honest-but-lazy
regeneration. They do not touch a dishonest one: rule 4's "the summary THE ROUTER SERVED" is, at
check time, just two lines of the same file agreeing with each other.

Aggravating details, each individually small:
- `envNamesReadBySource` counts a COMMENT mention as "read" (`text.includes(name)` over whole
  files) and matches substrings (a differing var named `PORT` would be "read" because
  `CONDUCTOR_E2E_ROUTER_PORT` contains it).
- Any argv difference at all (`e2e.test.ts` vs `./conductor/tests/e2e.test.ts`) disables rule 3
  entirely (`!argvDiffers` guard, g5-artifact-check.ts:199-200).
- The checker's own header claims only "a later hand-edit that flattens the two arms back into one
  fails the gate" — accurate — but g5-artifact.test.ts:6-9 frames the leg as making the
  two-identical-commands *class* fail "permanently", and nothing anywhere states the forgeability
  residual an operator should know when reading a future regenerated artifact.
**Refutation attempted:** "forgery is out of scope for any textual check." Partially accepted —
which is why the fix direction is disclosure plus cheap cross-checks, not a stronger grep: the
driver could write the facts files' sha256 into the artifact AND into the router ledger path it
already controls, or at minimum the residual should be stated in the checker header and the
artifact's "machine-checked" paragraph (currently reads as if the gate re-derives more than shape).

### ADAPTER-REMAINDER-TOOLS-006 — STATE.json's 12.1-G5 entry still records the DISCREDITED tautological evidence as machine truth, with no supersede pointer to C-089 or the regenerated artifact

**Pattern:** build-record honesty (P9's paper trail half; briefing calls STATE.json "per-task
machine truth").
**Severity:** MEDIUM-LOW.
**Where:** `docs/build/STATE.json` task `12.1-G5`: `tap.armA`/`tap.armB` record the two
`CONDUCTOR_OPENAI_BASE_URL=…` invocations that C-089 (CORRECTIONS.md:4376) later proved to be the
same command run twice ("identical verdict lines" — the tautology itself, presented as the
evidence); `revertAssertion` still argues the superseded record's case ("the router was proven
ABSENT before arm B", "rests on 13.1 revertAssertion"); `deviations` describe the old record's
"second half". The `note` field mentions only commit-backfilling.

A cold reader following the build's own reading order (STATE.json as truth) receives evidence known
to be worthless, with nothing in the entry saying so — CORRECTIONS.md discloses, but the entry does
not point there, and nothing marks the entry superseded. The repository's own standard for records
(evidence that survives scrutiny without re-derivation) is not met by its record OF the fix.
**Fix direction:** amend the 12.1-G5 entry: replace `tap` with the driver-generated record's facts
(or a pointer to the artifact + C-089), and add a supersededBy/correction field; the meta convention
already tolerates backfilled fields, so amendment is in-pattern.

### ADAPTER-REMAINDER-TOOLS-007 — replay.ts restates nine journal event/component literals and every producer data-key spelling with no drift guard, while its own guard-test's title claims it "reuses the core vocabulary … rather than restating" (P3 + P13)

**Pattern:** P3 (restatement without a drift guard), plus a P13 splinter (a test title asserting a
property its assertions do not check).
**Severity:** LOW-MEDIUM (an observability tool, not enforcement — but its failure mode is
*silently empty sections*, which read as "nothing happened" to the human §7.3 exists to serve).
**Where:** `conductor/tools/replay.ts:121-135` (`"fanout"`, `"gates"`, `"fsm"`,
`"subsession.dispatched"`, `"subsession.retry"`, `"subsession.hold"`, `"subsession.complete"`,
`"subsession.abort"`, `"deny"`, `"gate-crash"`, `"transition"`, `"guard-reject"` — all owned by
`core/journal-events.ts:34-45`); `replay.ts:437-457` + `469-487` (the producer data-key spellings:
`survivingMajors`, `stage`, `round`/`rounds`, `findings`/`findingsRaised`, `lenses`, `why`, and the
role strings `"reviewer"`/`"skeptic"` — owned by the `tools.ts` producers the test comments cite by
line number).

Guard analysis, so this is calibrated rather than alarmist:
- **Unilateral producer drift is refused**: adapter/journal.ts throws on an unlisted event name
  outside production, and journal-vocab.test.ts audits `.log(` call sites — so fanout.ts cannot
  ship a renamed event alone.
- **A coordinated rename (EVENTS + producers + their tests) passes everything**: no test pins the
  EVENTS members to the plan's §7.4 text (journal.test.ts asserts only non-empty per-component
  lists), and replay.test.ts's fixtures hand-write the same strings replay expects — so replay's
  copy diverging from the vocabulary makes NOTHING red. Verified analytically; replay's own
  constants ARE bound to its own fixtures (mutations R-1/R-2 red), which is precisely why the
  seam is invisible: both sides of the restatement move only together with their own tests.
- **The data keys have no vocabulary at all.** If tools.ts renames `survivingMajors` (or stops
  emitting it on the closing transition), deriveReviewRounds returns `[]`, the REVIEW ROUNDS
  section renders `(none)`, and every test stays green. An operator replaying a run would
  conclude no review ever happened — a silently-lying timeline for exactly the §7.3 audience.
- **The P13 splinter:** `[15.0-builtins-only]` (replay.test.ts:2069) is titled "…reuses the core
  vocabulary and schema rather than restating them…" but asserts only that the two core IMPORT
  SPECIFIERS exist (2090-2097). The restatements above sit in the same file the test reads and
  are not looked for. The title names a property the body does not prove — and which is false in
  spirit today.
One more restatement in the same file, same shape: `ARCHIVE_PATTERN =
/^journal\.(\d+)\.jsonl\.gz$/` and `ACTIVE_JOURNAL = "journal.jsonl"` (replay.ts:137-138) restate
`adapter/journal.ts:167/195/218`'s rotation naming. If journal.ts's rotation names ever changed,
readRunJournal would silently stop seeing archives — the SOURCES section lists only matched files,
so an entire rotated history would vanish from the timeline with no marker — and
[15.0-read-rotated-archives] would stay green because it hand-writes files in replay's expected
naming, not the writer's. ([15.0-against-a-real-written-journal] runs the real writer but never
rotates.)

**Fix direction:** (a) export the five subsession event names (and the fsm/gates pair) as
constants from journal-events.ts and import them in fanout.ts/tools.ts/replay.ts; or minimally add
to replay.test.ts: `assert(isKnownEvent("fanout", EV) )` for each restated literal (requires
exporting them or re-deriving via a source regex). (b) For the data keys: one fixture produced by
RUNNING the committed producer (the [15.0-against-a-real-written-journal] test already runs the
committed WRITER — extend the idea one layer up), or a shared `JOURNAL_KEYS` constant. (c) Retitle
or extend [15.0-builtins-only].

### ADAPTER-REMAINDER-TOOLS-008 — The G5 driver's "the counter is live, and it moved" artifact claim is asserted by nothing, and the live run I performed shows the number drifting (4 where 5 requests were sent) with the driver silently content

**Pattern:** P11/P9-lite — an artifact sentence whose truth the driver never checks.
**Severity:** LOW-MEDIUM.
**Where:** `conductor/tools/g5-equivalence.ts:346-359` (two post-arm POSTs whose results are
discarded; `afterArmSummary` read and printed, never compared to `fingerprint`);
artifact text at `renderArtifact` ("The counter is live, and it moved: … so the value the arm's
reports carry could only have been read from this process during the arm's own window").
**Reproduced:** ran the driver end-to-end (`--artifact` into scratch; overall PASS — the G5 claim
itself re-derives cleanly, see Cleared areas). But the fresh artifact's section 4 shows
`totalRequests: 4` after the arm, where the ledger holds 3 seeded + 2 post-arm = 5 answered
requests. One request's count never became visible to the metrics GET that follows its response —
and the driver has no assertion that would ever notice: had the counter not moved at ALL, the
artifact would print the unmoved number directly beneath the sentence claiming movement.

Two consequences:
1. The "moved" sentence is decoration a mutation cannot kill (Part-B rule 1 fails for it).
2. The deficit hints at a count-visible-after-response ordering in the router (or a silently
   dropped driver probe). If a SEED request's count can likewise land after the driver's
   fingerprint GET, the WITH arm's provenance compare (`canonical(s.metricsSummary) !==
   canonical(fingerprint)` → failure) can spuriously FAIL a legitimate run — a flake in the
   deliverable's own acceptance path. (Router-side ordering is the cpp-router lane's question —
   pointer filed.)
**Fix direction:** assert `after.totalRequests === fingerprint.totalRequests + 2` (retry briefly to
tolerate benign latency), fail loudly otherwise, and drop or prove the artifact sentence.

---

## 2. IDEA register

### IDEA-ART-01 — questions.ts read-side hardening
Origin: reading readRecords while hunting ISSUE-001. Kind: polish.
`readRecords` does `JSON.parse(trimmed) as QuestionRecord` with no validation and no error
context: one corrupt byte in questions.jsonl makes every later `conductor_surface`/`conductor_answer`
crash with a raw `SyntaxError: Unexpected token…` that names neither the file nor the line —
contrast journal.ts, which heals torn lines, and loadConfig, which names the file. Wrap the parse
per line: throw `questions: <file>:<line> is not valid JSON…` (the module's atomic writer means
torn lines "cannot happen", so loud-with-context beats healing here). Cost: small.

### IDEA-ART-02 — g5-equivalence early-FAIL paths leak the temp workDir
Origin: tracing the driver's exits. Kind: polish.
`rmSync(workDir…)` (g5-equivalence.ts:481) runs only on the path that reaches the comparison; the
early `return 1`s (no health at :298, no metrics at :324) leak `g5-equivalence-*` under tmpdir.
Move cleanup into a `finally` alongside `stopRouter()`. Cost: trivial.

### IDEA-ART-03 — canonical() in g5-artifact-check is top-level-only
Origin: ISSUE-005 analysis. Kind: test-maintainability / robustness.
`canonical` sorts only the top-level keys; nested objects (`statusCounts`) keep insertion order, so
a benign nested-key-order difference between the router body and the facts-file round-trip would
spuriously FAIL the provenance compare. Recursive canonicalization is five lines. Cost: trivial.

### IDEA-ART-04 — splitCommand has no quoting model
Origin: same. Kind: robustness. A future arm command with `FOO="a b"` mis-splits (the `b"` becomes
argv[0]), flipping the checker into its argv-differs mode and silently disabling rule 3. Either
reject commands containing quotes loudly or document the whitespace-only contract at the marker.

### IDEA-ART-05 — tools.ts:7172 hand-composes the worktree branch name in an error message
Origin: P3 sweep. Kind: naming/single-source. `"the merge-back of branch conductor/" + runId + "/" +
itemId + …` restates worktrees.branchOf in message form; export/branch through `branchOf` so a
future branch-name change cannot make the operator-facing message lie. Cost: trivial.

### IDEA-ART-06 — export-schemas' default outDir is cwd-relative
Origin: reading the CLI leg. Kind: ergonomics. `path.resolve("router/tests/schemas")` depends on
cwd; invoked from anywhere but the repo root it silently creates a schemas tree elsewhere. Resolve
from `import.meta.url` (the module knows where the repo is) or refuse when the target's parent is
absent. Cost: small.

### IDEA-ART-07 — conductor/tools/ has no hygiene guard except replay's own
Origin: [15.0-builtins-only]'s comment ("conductor/tools/ is covered by no committed guard").
Kind: tooling. That test guards replay.ts alone; export-schemas.ts, g5-artifact-check.ts and
g5-equivalence.ts have no builtins/erasability/single-runtime audit at all (tsc typechecks them;
nothing constrains their imports). Generalize the guard over `conductor/tools/*.ts`. Cost: small.
Relates to: MACRO pointer below.

### IDEA-ART-08 — replay `--item ""` silently renders an empty timeline
Origin: parseArgs reading. Kind: ergonomics. `addValues` admits the empty string
(`--item ""` or a trailing comma), and itemOf() treats "" as run-level, so the filter excludes
everything — exactly the "typo renders a silently empty timeline" failure parseArgs's own comment
promises to prevent for the other two flags. Refuse empty values. Cost: trivial.

### IDEA-ART-09 — wire-notes.md [observed] items are honest but unmined
Origin: wire-notes accuracy check. Kind: docs/test-maintainability. The [observed] tags correctly
mark live-probed-but-unpinned behavior (stderr attribution, `--port 0` landing on 4096, the
non-canonical-directory permission shift). Each is a one-assertion upgrade in wire-contract.test.ts
when touched next; the doc already says so — recording it here so the capability review sees it as
planning input rather than losing it in a doc footnote.

### IDEA-ART-10 — continuation.ts:30's comment contradicts its own file
Origin: grepping removeWorktree callers. Kind: docs. The header note says removeWorktree is "the
§4.2 cleanup 9.6 ships with no caller" while continuation.ts:496 now calls it — a stale sentence a
future reader will trust. One-line fix (belongs to the fanout/composition lane's file; noted here
because the grep that found it was mine).

---

## 3. CROSS-LENS POINTERS

- **state-crash lane:** questions.jsonl append/answer is read-modify-write with no lock of its own
  — confirm the workspace single-writer advisory lock provably covers every
  appendQuestion/answerQuestion call path (two opencode instances on one repo would lose questions
  or mint duplicate Q-ids; within one process the sync fs calls make it atomic).
- **tools-handlers-b (publish):** mergeBack merges into whatever branch the WORKSPACE has checked
  out (worktrees.ts:275-294 never names a target); confirm the §3.3 publish sequence re-checks the
  §2.1 pinned branch on the workspace side before merge-back, else a human's mid-run `git switch`
  redirects an item's integration silently.
- **cpp-router lane:** the G5 driver live run showed a metrics count becoming visible AFTER the
  request's response (after-arm read totalRequests=4 where 5 requests were answered — ISSUE-008).
  Check the router's increment-vs-respond ordering; it can flake the G5 provenance compare.
- **enforcement merge / step-2b sweep:** ISSUE-006 generalizes — after each correction C-076…C-092,
  were the affected STATE.json task entries amended, or do others besides 12.1-G5 still present
  superseded evidence as machine truth? A mechanical diff of correction subjects vs STATE entries
  would settle it.
- **macro (R2):** conductor/tools/ sits outside every hygiene guard (purity, source-hygiene,
  journal-vocab audits all scope to core/adapter/plugin) — a structural scoping decision worth a
  deliberate answer rather than an accident (IDEA-ART-07).
- **macro (R2):** the G5 evidence chain's strength is asymmetric by design (driver strong, standing
  gate shape-only, acceptance row substring-grep) — whether live-manual artifacts should carry a
  provenance convention (hashes of inputs the driver controls) is a design question beyond this
  lane's fix direction in ISSUE-005.

---

## 4. Mutation table

| # | File | Mutation | Expectation | Result | Verdict |
|---|------|----------|-------------|--------|---------|
| Q-1 | adapter/questions.ts | `assertValidQuestion` body → no-op | red somewhere if refusal is tested | **FULL GATE PASS 1382/1382** | **DECORATIVE — ISSUE-001** |
| Q-2 | adapter/questions.ts | delete the `validate("Item")` refusal in answerQuestion | red if item-refusal tested | **FULL GATE PASS 1382/1382** | **DECORATIVE — ISSUE-001** |
| Q-3 | adapter/questions.ts | mark question answered BEFORE clearing items (invert two-phase) | F1 crash-ordering test red | scoped gate FAIL: `not ok 3 [4.1-questions] F1 …` — the assertion that failed is the downstream property itself (answeredIso must stay null after the simulated crash), not a precondition guard | BOUND (P6-clean) |
| CFG-1 | adapter/config-io.ts | DEFAULT_CONFIG `git.mode` "read-only" → "commit" | composition field pin red | scoped composition gate FAIL, 2 tests red (field-by-field pin + safe-default assertions) | BOUND |
| CFG-2 | adapter/config-io.ts | `DEFAULT_MAX_READERS` 6 → 7 | wiring-drift guard red | scoped composition gate FAIL, 2 tests red (deepEqual pin + the conductor_wiring.py source-equality guard at composition.test.ts:823-836) | BOUND — the cross-language single-source claim is real |
| W-1 | adapter/worktrees.ts | delete createWorktree's foreign-branch refusal (adopt any registered worktree) | red if refusal tested | scoped tools-9.6 PASS 22/22; **FULL GATE PASS 1382/1382** | **DECORATIVE — ISSUE-003** |
| W-2 | adapter/worktrees.ts | (live repro, not a mutation) `git worktree lock` then removeWorktree | loud failure per module doc | silent void return; entry + branch survive | **LIVE BUG — ISSUE-002** |
| W-3 | adapter/worktrees.ts | stop scrubbing GIT_DIR in gitEnv() | poisoned-GIT_DIR probe red | tools-9.6 FAIL 21/22: `not ok 15 [9.6-mergeback-handler-argv]` — error shows git actually redirected ("not a git repository: …/not-a-repo-anywhere"), i.e. the property itself, not a precondition | BOUND (P6-clean) |
| G5C-1 | tools/g5-artifact-check.ts | tolerate byte-identical arms | negative case red | g5-artifact gate FAIL 5/6 | BOUND |
| G5C-3 | tools/g5-artifact-check.ts | disable served-vs-reportWith provenance compare | provenance case red | g5-artifact gate FAIL 5/6 | BOUND |
| G5C-F | tools/g5-artifact-check.ts | (live repro, not a mutation) hand-typed artifact, matching fake summaries | checker should ideally object | `ok: true, violations: []` | **SHAPE-ONLY — ISSUE-005** |
| ES-1 | tools/export-schemas.ts | (live repro) plant Zombie.schema.json, run exporter | stale file removed | **ZOMBIE SURVIVES EXPORT** | **NO PRUNING — ISSUE-004** |
| R-1 | tools/replay.ts | flip --level threshold comparison (`>` → `<`) | level-threshold test red | replay gate FAIL 26/28 (2 red) | BOUND |
| R-2 | tools/replay.ts | fan-out pairing ignores sessionID (pair with ANY terminal) | pairing tests red | replay gate FAIL 26/28 (2 red) | BOUND |
| G5D-1 | tools/g5-equivalence.ts | (live run, not a mutation) full driver run, scratch artifact | PASS, matching committed record's shape | PASS; self-check PASS; router killed on exit; no strays. After-arm counter read 4 where 5 requests were answered — silently tolerated | RE-DERIVED (G5 holds) + **ISSUE-008** |

---

## 4b. Scope enumerations (Part A/D/G slices owned by this lane)

### Enforcement rows (Part A) — what each module claims vs re-derives

| Claim | Claimant | What the code does | Where | Verdict |
|---|---|---|---|---|
| "this item is blocked on question Q" is cleared when Q is answered | disk state (model-written via handlers) | answerQuestion re-reads every item file and clears only `blocked.questionId === Q`, two-phase, clear-first | questions.ts:152-179 | RE-DERIVED (Q-3 proved the ordering binds) |
| a question/item written to the ledger is schema-valid | questions.ts | validate() before write — **but no test proves the refusal fires** | questions.ts:79-84,161-164 | CLAIMED, UNPROVEN — ISSUE-001 |
| a reused worktree is THIS item's | worktrees.ts | createWorktree re-derives via `currentBranch` — **check deletable with gate green** | worktrees.ts:211-227 | DECORATIVE — ISSUE-003 |
| the branch being merged is THIS item's | worktrees.ts | mergeBack re-derives via `currentBranch` before any merge | worktrees.ts:261-274 | RE-DERIVED (pinned by tools-9.6:1794) |
| the worktree and branch are GONE after removal | worktrees.ts doc | not re-derived; failures swallowed | worktrees.ts:306-317 | ACCEPTED ON HOPE — ISSUE-002 (reproduced) |
| the config in force is the repo's §2.1 file, or the safe default | config-io.ts | committed validator, loud on every failure arm, defaults pinned by an independent oracle + cross-language drift guard | config-io.ts:139-181 | RE-DERIVED — exemplary (CFG-1/2 bind) |
| the C++ tests validate against "the exact same objects" as core | export-schemas.ts header | true only when the node gate ran after the last SCHEMAS edit; no pruning of removed names | export-schemas.ts:21-31 | CONDITIONAL — ISSUE-004 |
| the committed G5 artifact records a real two-arm run | g5-artifact.test.ts gate leg | shape rules only; provenance unverifiable from text | g5-artifact-check.ts:156-238 | SHAPE-ONLY — ISSUE-005 (forgery repro) |
| "the router was CONTACTED, not merely alive" | g5-equivalence.ts | fingerprint deep-equal, driver-side — real at run time | g5-equivalence.ts:417-441 | RE-DERIVED at run time; unverifiable at gate time |
| "the counter is live, and it moved" | the artifact's prose | printed, never asserted | g5-equivalence.ts:346-359 | ACCEPTED ON TRUST — ISSUE-008 |
| the timeline shows what the journal recorded, nothing more | replay.ts | derives from records only; no clock; invents no verdicts (pinned by [15.0-review-no-fabricated-verdicts], [15.0-render-deterministic-utc]) | replay.ts throughout | RE-DERIVED — but see ISSUE-007's silent-degradation seams |

### P12 branches in scope with NO test reaching them

- worktrees.ts:284-292 — mergeBack's "failed without starting a merge" environment-fault throw.
- worktrees.ts:70/93/111 — the spawn-failure (`typeof status !== "number"`) rethrow arms, all three helpers.
- worktrees.ts:211-227 — the foreign-branch refusal (proven decorative, W-1 → ISSUE-003).
- questions.ts:134-136 — the unknown-questionId throw.
- questions.ts:79-84, 161-164 — both validator refusals (Q-1/Q-2 → ISSUE-001).
- config-io.ts:151-153 — the unreadable-file (EACCES/EISDIR) arm; and the BOM strip at 155. Minor.
- export-schemas.ts:39-41 — the CLI default-outDir arm (gate always passes an explicit dir).
- g5-equivalence.ts — every FAIL path (port occupied, binary missing, router dead, facts missing,
  scenario mismatch): a driver by design (G5-SG-1), exercised only manually; its self-check
  refusals ARE tested via g5-artifact.test.ts negative cases.
- replay.ts:828 — the duplicate-archive-index name tie-break. Trivial.

### Vocabulary/restatement sweep (Part D) for literals owned by or crossing this scope

| Literal | Owner | Restated in | Drift guard? | Verdict |
|---|---|---|---|---|
| §7.4 event/component names | core/journal-events.ts | replay.ts:121-135 (consumer); fanout.ts/tools.ts (producers) | producers: writer-throw + vocab audit. replay: **none** | ISSUE-007 |
| producer data keys (survivingMajors, round/rounds, findings/findingsRaised, stage, lenses, why, reviewer/skeptic) | tools.ts producers | replay.ts:437-487 | **none** (fixtures hand-write both sides) | ISSUE-007 |
| journal.jsonl / journal.N.jsonl.gz | adapter/journal.ts | replay.ts:137-138 | **none** (rotation never driven by the real writer in replay tests) | ISSUE-007 |
| G5 markers (ARM-WITH-ROUTER-CMD …) | g5-artifact-check.ts G5_MARKERS | driver imports the constant | single-sourced | CLEAR |
| CONDUCTOR_E2E_ROUTER_PORT / CONDUCTOR_E2E_FACTS | e2e.test.ts | g5-equivalence.ts | g5-artifact.test.ts:163-167 asserts the name IS read by source — a rename goes red | CLEAR |
| `.conductor/config.json` | config-io.configPath | comments/messages + test oracles only | composition.test.ts:611 pins configPath | CLEAR |
| DEFAULT_MAX_READERS / SUB_SESSION_TIMEOUT_MS | scripts/conductor_wiring.py | config-io.ts:55-56 | composition.test.ts:823-836 reads the python source and asserts equality — **CFG-2 proved it binds** | CLEAR — the model P3 mitigation in this repo |
| branch `conductor/<runId>/<itemId>` | worktrees.branchOf | tools.ts:7172 (error message only) | none needed beyond message accuracy | IDEA-ART-05 |
| `worktrees` path segment | worktrees.worktreePathOf:161 | none in code (config VALUE "worktrees" is a different fact, owned by types.ts) | n/a | CLEAR |
| `<name>.schema.json` | export-schemas.ts | C++ tests by filename; g5-equivalence default | missing-file is loud on fresh clone; staleness is not | folded into ISSUE-004 |
| questions.jsonl | questions.ts (spelled 2× within the file) | tests (oracle) | same-file duplication only | CLEAR (trivial) |

---

## 5. Coverage ledger

| File | What was done | Coverage | Conclusion |
|------|---------------|----------|------------|
| conductor/adapter/config-io.ts (181) | read whole; 2 mutations (CFG-1/2); P3 grep on its literals; refusal-arm test audit (composition.test.ts:605-762 read whole) | 100% | CLEAR — the strongest-defended file in this scope; all three refusal arms tested, defaults pinned independently, cross-language drift guard proven to bind |
| conductor/adapter/questions.ts (182) | read whole; 3 mutations (Q-1/2/3, two full gates); questions.test.ts (250) read whole; caller grep | 100% | ISSUE-001 (both validators decorative); crash-ordering and symlink defenses real and bound; concurrency question pointed to state-crash lane |
| conductor/adapter/worktrees.ts (317) | read whole; mutations W-1/W-3 + live repro W-2; tools-9.6.test.ts read via all 22 titles + targeted regions; worktree-stage-trees.test.ts titles | 100% of source; tests ~30% by line, 100% by title | ISSUE-002 (reproduced silent no-op), ISSUE-003 (decorative refusal); env scrub and merge discipline live-proven |
| conductor/adapter/wire-notes.md (117) | read whole; spot-checked 5 claims against wire-contract.test.ts greps | 100% read; sampled verification | Consistent; [observed] tags are an honest unpinned-behavior record (IDEA-ART-09). The §6.4-hooks-unwired finding it feeds belongs to composition-injection's register |
| conductor/tools/export-schemas.ts (41) | read whole; live no-prune repro; CMake/ctest consumption grep; export-schemas.test.ts (130) read whole | 100% | ISSUE-004 (staleness seam + no pruning); the exported-function behavior itself is fully pinned |
| conductor/tools/g5-artifact-check.ts (238) | read whole; mutations G5C-1/G5C-3; forgery repro; g5-artifact.test.ts (174) read whole | 100% | Rules bind and refusals are tested (P5-clean on itself); ISSUE-005 records what the rules cannot and where that residual is under-disclosed |
| conductor/tools/g5-equivalence.ts (697) | read whole; full live end-to-end run (scratch artifact); teardown verified; STATE.json/acceptance cross-check | 100% read; success path executed live; FAIL paths desk-checked | G5 re-derives cleanly (see Cleared); ISSUE-008 (unasserted liveness claim, observed count deficit), ISSUE-006 (stale STATE record), IDEA-ART-02 (temp leak) |
| conductor/tools/replay.ts (885) | read whole; mutations R-1/R-2; P3 sweep vs journal-events.ts/journal.ts/tools.ts producers; replay.test.ts read via all 28 titles + 3 key tests whole (1152-1263, 1973-2063, 2069-2134) | 100% of source; tests ~25% by line, 100% by title | Derivations correct and well-bound to their own fixtures; ISSUE-007 (restatement seams + [15.0-builtins-only] title overclaim) |

Not examined (explicitly): the interiors of the other 25 replay tests and of tools-9.6's non-worktree
regions (registry/edit-gate scopes — other lanes own those); worktree-stage-trees.test.ts interiors
(state/evidence lane); the callers' handling of my modules' return values inside tools.ts beyond the
call-site greps recorded above.

---

## 6. Cleared areas — attacked and held

- **config-io.ts refusal discipline.** Attacks: permissive-default mutation (CFG-1), cross-language
  drift (CFG-2), path-restatement grep, malformed/schema-invalid/unknown-key arms (all three
  independently tested with the validator's own error text). Nothing survived green that should not.
- **questions.ts two-phase answer commit.** Attack: invert the order (Q-3) — caught by the exact
  downstream property (answeredIso stays null after a simulated crash), P6-clean. The symlink/exclusive-create
  temp defense is pinned by a 256-symlink pre-plant test.
- **worktrees.ts environment scrub and merge discipline.** Attacks: GIT_DIR scrub removal (W-3 —
  caught by a live poisoned-GIT_DIR probe that showed git actually redirecting); ff-first,
  conflict-abort, branch-identity-at-merge, crash-prune, branch-reuse — all pinned by tests whose
  titles I verified against the code paths.
- **g5-artifact-check's rules against the C-089 shape.** Attacks: tolerate byte-identical arms
  (G5C-1), drop the provenance compare (G5C-3) — both caught by dedicated negative cases; the
  DEAD_VAR negative case self-verifies its own premise (`envNamesReadBySource == []`).
- **The G5 equivalence claim itself.** Attack: re-derive rather than trust — full driver run on
  this tree: router started without a model, seeded 502s, both arms ran the committed e2e, three
  compared facts IDENTICAL across all e2e scenarios, WITH-arm reports carried the router's exact
  fingerprint, WITHOUT-arm carried null, self-check PASS. The committed artifact's shape matches
  what the driver reproduces (different random seeds, same structure). **G5 holds on this tree.**
- **replay.ts derivations against their own contracts.** Attacks: threshold flip (R-1),
  cross-session pairing (R-2) — both caught by two tests each. The no-ANSI, determinism,
  read-only, and no-fabricated-verdicts properties are pinned by named tests whose assertions I
  read.
- **Honesty audit for this scope:** the committed 12.1-g5-equivalence.md is consistent with a real
  driver run and with what I reproduced live; no fabricated evidence found in this scope's
  artifacts. The one dishonest-record item found is retrospective, not fabricated: STATE.json's
  12.1-G5 entry still presenting superseded evidence (ISSUE-006). Checked: artifact marker lines
  vs driver output format, STATE.json 12.1/12.1-G5 entries, acceptance row 9b mechanics.

Final state: all seven source files restored and `cmp`-verified against snapshots; full gate re-run
on the restored tree GREEN (see below); no stray processes.
