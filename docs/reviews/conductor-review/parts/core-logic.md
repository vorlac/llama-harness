# Core Logic Review — conductor/core/ (pure core)

**Reviewer scope:** `conductor/core/` — all 17 files per `git ls-files conductor/core/`:
commit-message.ts, decide.ts, freshness.ts, fsm-item.ts, fsm-run.ts, gates-edit.ts,
gates-git.ts, gates-phase.ts, journal-events.ts, planning.ts, queue-amend.ts, schedule.ts,
shell-parse.ts, stops.ts, tool-bindings.ts, types.ts, verdict.ts.

**Charter:** verify G3 (pure: no I/O, no clock, no network), the FSM transition tables, the
closed vocabularies against plan §2, legalTools derivation, the decision precedence ladder,
and attack RED-before-GREEN (construct a path to GREEN without a genuine harness-observed RED).

**Date:** 2026-08-15
**Status:** COMPLETE — all 17 core files read in full; 6 ISSUEs, 5 IDEAs, 4 cross-lens
pointers; 8 binding mutations + 3 live-bug reproductions; enumerations and coverage ledger
closed for every file in scope.

---

## 1. ISSUE register

(entries numbered CORE-LOGIC-NNN; appended as found)

### CORE-LOGIC-001 — `requireTwoOptions` exempts `kind:"human"` from the ≥2-option rule, not just the scoring rule (P4 / spec conformance)

- **File:** `conductor/core/decide.ts:129-158`
- **Spec:** plan §2.7 (lines ~869-874): "Every non-trivial judgment call gets a record with
  ≥2 real options and scores on the §6.2 criteria … Options may omit numeric scores **only**
  for `kind:"human"` questions (taste has no objective score)." The exemption the plan grants
  human records is the *scoring*, not the option count.
- **What the code does:** `requireTwoOptions` returns `{ok:true}` immediately for
  `kind:"human"` without checking `record.options.length` at all. A human decision with zero
  options — no alternatives recorded — passes the gate whose name promises "two options".
- **Consequence:** the decision ledger can carry `kind:"human"` records with 0 or 1 options,
  so the ledger the human reviews asynchronously loses exactly the "what were my
  alternatives" content §2.7 exists to preserve. A model that wants to skip the alternatives
  work simply marks the decision `human`.
- **P-class:** P4 (name asserts a property the body implements only for one branch), plus a
  small adversary hatch (Part F shape: satisfy the letter by choosing the exempt kind).
- **Confidence:** high on the code behavior (read + reasoned); the spec reading is the
  natural one but the plan sentence could be argued to scope "≥2 real options" to derived
  records only. Refutation attempt: §2.7's example and the sentence structure tie "≥2 real
  options AND scores" together, with only scores exempted afterwards; I could not construct a
  reading in which the option count is also exempt. Severity: minor-to-medium.
- **Fix direction:** check `options.length >= 2` for both kinds; keep only the score
  exemption for `kind:"human"`.

### CORE-LOGIC-002 — `isHumanTerritory` bare-word patterns misclassify common software vocabulary as human territory

- **File:** `conductor/core/decide.ts:67-111`
- **Claim in code:** "each pattern pins a shape only a human-territory question has."
- **Counterexamples (all derivable technical questions, §6.2 never-ask list):**
  - `/\bsubscription\b/i` — "Should the event bus use a subscription-based observer?"
    (pub/sub is everyday software vocabulary) → classified human territory.
  - `/\bpublish/i` (no right boundary) — "Should the queue publisher batch messages?" →
    "publisher" matches → human territory.
  - `/(?:^|[^\w/.-])(?:delete|destroy|erase|wipe)\s+[A-Za-z]/i` — "Should we delete the
    stale cache entry after TTL expiry?" → human territory.
  - `/\bsecrets?\b/i` — "Where should the secrets *schema* type live?" → human territory.
- **Consequence:** conservative direction (asks a human more often than needed), so not a
  gate bypass — but it directly contradicts the stated design intent that derivable technical
  questions stay machine territory, and every false positive is a run stalled on a
  `surfaced`/`blocked` question a human must answer. On an unattended overnight run that is
  a liveness cost.
- **P-class:** the inverse of an enforcement gap — an over-broad guard; nearest is P8
  (a rule that cannot be satisfied as written: "only human-territory shapes fire" is false).
- **Confidence:** high; verified the regexes by inspection against the quoted strings.
- **Severity:** minor.

### CORE-LOGIC-006 — a dependent stalled behind a *blocked* dependency counts as `open`, so the run can only reach `noop`, never the honest `blocked`/`surfaced` stop (P7 seam)

- **Files:** `conductor/core/stops.ts:102-134` (`shouldTerminate`),
  `conductor/core/gates-phase.ts:192-246` (`cannotEverPublish`/`settledForReport` deliberately
  exclude blocked deps).
- **Reproduced** (scratchpad `test-blockeddep.mjs`, real core code): run EXECUTING; `I1` at
  RED with `blocked:{reason}` (a human question `Q1` open); `I2` PENDING with
  `dependsOn:["I1"]`. Results:
  - `legalTools.recommended` = **null**; legal = {status, decide, surface, defer, **answer**}
    (no stage tool; `why` = "no item is schedulable this wave and no report is due").
  - `settledForReport` = `{allSettled:false, unsettled:["I2"]}` → report NOT legal.
  - `shouldTerminate` with `open:1` → `{stop:false}`; with `futileRePrompts:3` →
    `{stop:true, kind:"noop"}`.
- **Why `blocked` never fires:** `shouldTerminate` short-circuits on `itemsSummary.open > 0`
  (stops.ts:127, "an open item is actionable work"). But per §2.5 `open` means
  `state!==PUBLISHED && blocked===null && deferred===null` — and `I2` (a dependent whose
  dependency is blocked) satisfies all three, so it counts as `open` even though it is NOT
  actionable (its dependency will never be published until a human answers `Q1`). With
  `open>0`, the `blocked` and `surfaced` branches (stops.ts:129-131) are unreachable.
  Meanwhile `cannotEverPublish` deliberately excludes blocked deps (gates-phase.ts:183-187:
  "a question can be answered and the item resumes"), so `I2` is not "stuck" and the report
  stays illegal.
- **Confirmed no cascade:** grep of `conductor/adapter/*.ts` shows `blocked` is set only on
  items named in a question's `blocksItems` (via `findingBlocksItems`, which scans finding
  prose for ids/paths — not the `dependsOn` graph). Nothing propagates `blocked` to
  transitive dependents. So `I2` stays `open`, unnamed and unblocked.
- **Consequence:** the run cannot record the semantically-correct `blocked`/`surfaced` stop
  (§2.9: "every remaining item blocked; surfaced questions pending"). The only reachable
  computed stop is `noop` — §3.7's *wedge* detector — which misclassifies a run legitimately
  waiting on a human answer as a wedged futile loop. And because §3.7.4 never re-prompts a
  terminal run, once `noop` is recorded a later `conductor_answer` unblocks `I1` but nothing
  re-drives `I2`; the documented resume path ("conductor_answer is how a human resumes a
  blocked/surfaced run") does not apply to a `noop`-terminated run. This is the C-085 family
  (P7): three individually-defensible rules (blocked deps aren't "stuck"; an open item is
  actionable; noop fires on 3 futile re-prompts) composing so the run stops under the wrong
  kind, and the human's answer arrives too late to matter.
- **Refutation attempts:** (1) *Maybe the continuation engine parks on an open question
  rather than counting futile re-prompts, so `noop` is never reached.* That is adapter
  behavior (cross-lens pointer filed); if true it converts the finding to "the run parks with
  recommended=null and no honest stop kind" — still a gap, because the run is neither
  progressing nor recording why it is waiting in its stop field. (2) *Maybe `conductor_answer`
  clears `run.stop` to un-terminalize.* Also adapter behavior; even so, the `noop` kind and
  its stop-report headline would misdescribe the pause. I could not construct a pure-core
  reading in which `noop` is the correct classification for "waiting on a human answer."
- **P-class:** P7 (composition seam) + closed-vocabulary misuse (`noop` doing `blocked`'s job).
- **Confidence:** high on the pure-core facts (reproduced); medium on the end-state
  (noop-vs-park) which depends on continuation.ts.
- **Severity:** medium.
- **Fix direction:** compute `open` as *actionable* (dependency-ready, unblocked, undeferred)
  rather than merely not-settled; then a run whose only open items are dependency-stalled
  behind blocked items reaches the `blocked`/`surfaced` branch and records the honest stop.
  Alternatively, cascade a derived "waiting" disposition to transitive dependents of a
  blocked item so the summary classifies them correctly.

### CORE-LOGIC-005 — `classifyFailure` "missing-subject" guard is vacuous under a wildcard-headed fileScope, which decompose accepts for a behavioral item — the legal-RED constraint is defeatable (P1 / RED-before-GREEN)

- **Files:** `conductor/core/freshness.ts:173-209` (`classifyFailure`), enabled by
  `conductor/core/planning.ts:284-403` (`validateQueue` accepts the scope).
- **Spec:** §2.6.1 (plan lines 819-836) makes `missing-subject` "not a loophole" by
  *requiring the unresolved specifier to resolve inside this item's declared `fileScope`* —
  "a test that fails to import `lodash`, or a module belonging to another item, is still
  `error`." That is the entire safety argument for accepting a non-assertion red.
- **Reproduced** (scratchpad `test-classify.mjs`, real core code):
  - fileScope `["src/parser/**"]`, `Cannot find module 'lodash'` → `error` (correct).
  - fileScope `["**"]`, `Cannot find module 'lodash'` → **`missing-subject`**.
  - fileScope `["**"]`, `Cannot find module './totally/made/up'` → **`missing-subject`**.
  - fileScope `["**"]`, `Cannot find module 'node:fs'` → **`missing-subject`**.
- **And decompose permits the scope** (scratchpad `test-validatequeue.mjs`): a behavioral
  item with `fileScope: ["**"]` (and `["**/*.ts"]`), non-empty testScope, an observable
  acceptance criterion — `validateQueue` returns `{ok:true, violations:[]}`. There is no
  breadth cap and no wildcard-headed-scope rejection for behavioral items (the disjoint-path
  check fires only for `behavioral:false`).
- **Mechanism:** `globMatch("**", anySpecifier)` is true because `**` has an empty literal
  head and spans any number of segments. So `classifyFailure`'s `allInScope` test — the
  clause that is supposed to bound `missing-subject` to "the subject this item builds" —
  passes for *every* unresolved import when the scope is `**` (or any `**/…` glob whose head
  is empty).
- **Consequence / RED-before-GREEN:** the pure item FSM enforces the *sequence* (a behavioral
  item can only reach GREEN via RED→TEST_VETTED, CORE-LOGIC cleared area below), and
  `redEvidenceGate` accepts `missing-subject` as a legal red. So with a `**` fileScope a
  test that merely `import`s a non-existent module — asserting nothing about the acceptance
  criteria — produces a harness-blessed "legal RED." The red proves the module is absent,
  not that any behavior is wrong. This is exactly the "a stub satisfying one assertion / a
  red observed against a different subject" attack the charter names, achieved without an
  override, purely by choosing a broad scope. It is the SAME root shape as C-055 (a `**`
  fileScope with an empty literal head matching everything) but in a DIFFERENT, unpatched
  consumer: C-055 hardened the edit-scope gate against `**`; `classifyFailure` was not.
- **Backstops and why they are weaker:** the RED→TEST_VETTED vet critics (`test-vet.md`) are
  meant to reject a tautological/vacuous test — but that is a model fan-out (believe, not
  know), the surface this review exists to distrust. In pure core the mechanical check is
  `classifyFailure`, and it is defeated by scope breadth. (The adapter `evidence.ts`
  targeted-vs-full-scope excerpt rule may add a compensating check on the *fallback* path;
  that is a cross-lens question for the capability/adapter review — filed as a pointer — but
  it does not repair the class decision itself.)
- **P-class:** P1 (a guard inspecting less than it appears to — its reach equals the scope's
  reach) + recurrence of a known class (Part G enumeration #6: C-055's `**`-empty-head
  defect exists elsewhere, unfixed).
- **Confidence:** high on the core behavior (reproduced twice against real code); medium on
  end-to-end exploitability (depends on whether an adapter layer or the vet catches it —
  pointer filed). Severity: major if unbackstopped, medium given the vet exists.
- **Fix direction:** in `validateQueue`, reject a behavioral item whose `fileScope` contains
  a wildcard-headed glob (empty `literalHead`) — the same degeneracy `schedule.isDegenerateScope`
  already names — OR, in `classifyFailure`, treat an unresolved specifier as `missing-subject`
  only when it matches a fileScope glob with a *non-empty literal head* (so `**` cannot
  vacuously satisfy it). The scheduler already has `isDegenerateScope`; reuse that vocabulary.

### CORE-LOGIC-004 — legalTools recommends `null` (and its `why` lies) for a schedulable, legal item in no-git mode when a REVIEWED item sorts first — a liveness wedge (P7 composition)

- **File:** `conductor/core/gates-phase.ts:382-459` (the EXECUTING recommendation
  derivation, esp. lines 424-457).
- **Reproduced** (pure call to `legalTools`, scratchpad
  `test-legaltools-nogit.mjs`): run EXECUTING, work classification, `publishEnabled=false`
  (§3.9 no-git), two independent items — `I1` at REVIEWED, `I2` at GREEN. Output:
  - `legal` = {status, decide, surface, defer, **conductor_validate** (for I2),
    **conductor_dispatch_wave**}
  - `recommended` = **null**
  - `why` = "EXECUTING: no item is schedulable this wave and no report is due; the meta
    tools remain" — **which directly contradicts the legal set it just built** (validate
    and dispatch_wave ARE legal).
- **Mechanism:** `nextWave` has no notion of `publishEnabled`. Under no-git a REVIEWED item
  is terminal (§3.9: "items terminate at REVIEWED"), yet `nextWave` still treats it as an
  open candidate (it is not PUBLISHED/blocked/deferred) and, ordered by (DAG depth, id),
  `I1` sorts to `wave.parallel[0]`. The recommendation path (line 440-449) inspects ONLY
  `parallel[0]`: `firstStage = PUBLISH`, and the §3.9 suppression sets `firstTool = null`
  (line 446). It never falls through to `parallel[1]` (the schedulable `I2`). Because `I2`
  is unsettled, `reportLegal` is false, so `recommended` stays `null`.
- **Worse under scope conflict:** if `I1` and `I2` share a fileScope, `nextWave` selects
  only `parallel[0] = I1` (serialized). `I1` is REVIEWED and can **never** publish under
  no-git, so it forever occupies wave slot 0. `I2` can never become `parallel[0]`, so it can
  never be recommended — a permanent wedge with no external event able to clear it. Verified:
  the CONFLICTING-scopes arm of the reproduction returns the same `recommended: null`.
- **Consequence:** `legalTools` is the SINGLE SOURCE for the phase gate, the injection, and
  the continuation engine (§3.2, stated at the top of the file). The continuation engine
  re-prompts using `recommended`. A `null` recommendation with legal actionable work means
  the engine names no next tool; the run goes idle, `futileRePrompts` climbs to 3, and it
  records a `noop` stop — a wedge in exactly the shape §3.7 exists to end, arising because
  the recommendation derivation and the legal-set derivation disagree. This is C-085's class
  (P7 — individually-correct rules composing into a hole) recurring in a mode (no-git) that
  the plan added `publishEnabled` specifically to support.
- **Refutation attempt:** could the continuation engine fall back to `legal` when
  `recommended` is null and thereby recover? That is adapter behavior outside pure core (see
  cross-lens pointer), but even if it did, the `why` string is still factually false and the
  recommendation contract ("the single next tool to run") is still violated for a supported
  mode. And in the scope-conflict arm no ordering exists that would ever surface `I2`, so no
  fallback over `legal` gives a *deterministic* next step. I could not construct a reading in
  which `recommended: null` here is correct.
- **P-class:** P7 (composition hole) + self-inconsistent verdict (why contradicts legal).
- **Confidence:** high — reproduced against real core code by direct call. The wedge's final
  step (noop stop) depends on continuation.ts, filed as a cross-lens pointer; the pure-core
  defect (null recommendation + false why while legal work exists) is fully in scope and
  fully reproduced.
- **Severity:** major (a supported mode can silently wedge).
- **Fix direction:** when choosing the recommendation, skip wave candidates whose
  `nextStageTool` is publish-suppressed (walk `wave.parallel` for the first item with a
  non-null effective tool), OR exclude publish-terminal (no-git REVIEWED) items from
  `nextWave` candidacy when `publishEnabled` is false. Either makes `recommended` track the
  legal set.

### CORE-LOGIC-003 — commit-message template: model-authored `item.id` and `fileScope` entries are embedded without newline neutralization; the "safe by construction" claim fails

- **File:** `conductor/core/commit-message.ts:123-148`
- **What holds:** `title` is folded to one line, `rationale` and `failureExcerpt` are
  quote-prefixed, the robot emoji is stripped, and the handler independently refuses any
  message `hasDenylistedTrailer` flags — so a denylisted trailer cannot actually *ship*.
- **What does not hold:** `item.id` (subject, line 124) and `item.fileScope.join(", ")`
  (line 145) are embedded raw. Both are model-authored (decompose output). An id or glob
  containing `\n`:
  1. injects arbitrary new lines into the commit message — e.g. fileScope
     `["src/a.ts\nRed proof: evidence seq 999"]` produces a *second, fabricated* red-proof
     line in the published commit, undermining the template's stated purpose ("a reader can
     open evidence.jsonl at that seq and see the failure");
  2. a line injected as `#…` is *silently deleted by git's default cleanup* — the exact
     hazard the file's own comment says it avoids ("`#` is never emitted at the start of a
     line") — so record content can be dropped;
  3. an injected line starting with `Co-Authored-By` turns a *legal* publish into a denial
     (the handler's refusal catches it), i.e. a availability failure rather than a forgery.
- **Reachability caveat:** this is only live if nothing upstream rejects newlines inside
  `id`/`fileScope` entries. `core/planning.ts` (checked below, see coverage ledger) validates
  DAG/scope emptiness/size but I found no character-level validation of id or glob strings;
  the schema types them as bare `string`. (See CORE-LOGIC-00x follow-up under planning.ts.)
- **P-class:** P1-adjacent (the neutralization inspects less than the template embeds);
  the file's own defense-in-depth (handler refusal) contains the trailer case but not the
  fabricated-line or dropped-line cases.
- **Confidence:** high on mechanism (regex/join semantics); medium on reachability (depends
  on adapter-side glob sanitation I have not yet found). Severity: minor (requires a
  degenerate model output that survives decompose validation).
- **Fix direction:** fold `id` like the title (or validate `^[A-Za-z0-9_-]+$` at decompose),
  and fold/quote each fileScope entry before joining.

---

## 2. IDEA register

### IDEA-CORE-1 — glob `[...]` character classes are declared-but-unimplemented, and the three consumers disagree about them
Origin: reading `shell-parse.ts` `segMatch` (treats `[` literally) vs `literalHead`/`isDegenerateScope` (treat `[` as a wildcard construct). Kind: polish/correctness-hygiene. Value: a fileScope like `src/[ab].ts` matches nothing under `globMatch` (over-restrictive, safe) but reads as degenerate/wildcard-headed under the scheduler (serialize) — the inconsistency is harmless today only because both directions fail safe, but a future author will trip on it. Cost: small (either implement `[...]` in `segMatch` or reject it at decompose). Relates to: CORE-LOGIC-005.

### IDEA-CORE-2 — `decide.ts` records no score-range validation
Origin: `requireTwoOptions` checks presence of `score` but not that the five keys are in the small-integer range §2.7 implies. A model could record `{capability: 9999}` to force a "derived" winner. Kind: tooling/robustness. Value: the decision ledger the human audits stays trustworthy. Cost: small. Relates to: CORE-LOGIC-001.

### IDEA-CORE-3 — `STATE.json` revertAssertions cite stale test counts
Origin: honesty sampling — task 5.1 claims "all 120 git-policy tests", but `gates-git.test.ts` now runs 146; task 3.1 claims "149 transition tests". The substance (the named test only passes against the real code) is verifiable and holds; only the counts drift as corrections add tests. Kind: docs/record-hygiene. Value: a reader who cross-checks the count is briefly misled. Cost: trivial (recompute on each gate re-run, or drop the count). Relates to: standalone.

### IDEA-CORE-4 — `why` strings are part of the contract but untested for consistency with `legal`
Origin: CORE-LOGIC-004 — `legalTools` returned a `why` that flatly contradicted its own `legal` map ("no item is schedulable" while `conductor_validate`/`conductor_dispatch_wave` were legal). A cheap invariant test — "if `legal` contains any stage tool, `why` does not claim nothing is schedulable" — would have caught it. Kind: test-maintainability. Value: catches self-inconsistent verdicts. Cost: small. Relates to: CORE-LOGIC-004.

### IDEA-CORE-5 — no dedicated `planning.test.ts`; core planning coverage lives inside `tools-9.2.test.ts`
Origin: locating tests for `validateQueue`/`vagueAcceptance`/`acceptanceClusters`/`scanPlaceholders`/`findingBlocksItems`/`findDependsOnCycles`. They ARE unit-tested (directly, both accept and reject) — but inside the 1300-line handler test file, which couples pure-core coverage to handler-test maintenance. Kind: test-maintainability/navigability. Value: a future editor of planning.ts finds its tests where the module lives. Cost: small (extract). Relates to: standalone.

---

## 3. CROSS-LENS POINTERS

- **continuation.ts (adapter / capability review):** CORE-LOGIC-004 and -006 both hinge on
  how `continuation.ts` behaves when `legalTools.recommended === null` but `legal` is
  non-empty (esp. with an open question). Does it park, or re-prompt-to-futile→noop? This
  seam decides whether the two pure-core defects become live wedges. Owner: R1 (adapter
  enforcement) / R3.
- **adapter/evidence.ts (capability review):** CORE-LOGIC-005 — whether the targeted-vs-full
  scope excerpt rule in `evidence.ts` adds a compensating check that blunts the `**`-scope
  `missing-subject` vacuousness on the fallback path. Does not repair the class decision.
- **scripts/test-conductor.sh python leg (macro / capability review):** the python leg
  (`scripts.test_conductor_wiring`) spawns router-supervisor child processes
  (`time.sleep(600)` + `fake-llama-router`) that OUTLIVE the test run — I found three
  orphaned after a scoped gate invocation and had to kill them manually. A test harness that
  leaks long-sleeping children is a resource-leak / operator-experience finding. Owner: R1
  (resource leaks) / R2 (build process).
- **adapter blocked-cascade (macro review):** the design sets `blocked` only on items a
  finding's prose names (`findingBlocksItems`), never on their `dependsOn` dependents — a
  structural gap that surfaces as CORE-LOGIC-006. Whether dependents SHOULD inherit a
  derived disposition is an architecture question. Owner: R2.

---

## 4. Mutation table

All mutations applied by me to real core source, snapshot-restored and `cmp`-verified. Verdict
via `bash scripts/test-conductor.sh <file>` (the gated runner; TAP + typecheck + bun + python).

| # | File | Mutation | Expectation | Result | Verdict |
|---|------|----------|-------------|--------|---------|
| M1 | fsm-item.ts | `redEvidenceGate`: accept `exit === 0` as a red | fsm-item test red | TAP 68/69, 1 fail | BINDS — RED-before-GREEN exit-0 rejection is enforced |
| M2 | verdict.ts | `findingSurvives`: `>= ceil(k/2)` → `> ceil(k/2)` (tie no longer upholds) | verdict test red | TAP 7/12, 5 fail | BINDS — tie-upholds threshold is enforced |
| M3 | freshness.ts | `verifyFreshFor`: disable condition-2 HEAD check | freshness test red | TAP 24/25, 1 fail | BINDS — branch-switch staleness is enforced |
| M4 | gates-git.ts | `decideGitSegment`: final default-deny → ALLOW | gates-git test red | TAP 141/146, 5 fail | BINDS — default-deny posture is enforced |
| M6 | gates-edit.ts | `normalizeUnderTree`: out-of-tree path → return `absPath` (re-introduce C-055) | gates-edit test red | TAP 63/64, 1 fail | BINDS — out-of-tree deny is enforced |
| M7 | gates-edit.ts | `decideEdit`: disable the per-tree verify FREEZE | gates-edit test red | TAP 63/64, 1 fail | BINDS — freeze is enforced |
| M8 | gates-phase.ts | `settledForReport`: always `allSettled` when items exist | gates-phase test red | TAP 15/16, 1 fail | BINDS — report precondition is enforced |
| M9 | fsm-run.ts | `RUN_STATES`: add a bogus `"BOGUS_STATE"` member | single-source drift guard red | TAP 1/2, 1 fail | BINDS — the FSM-vocab ↔ schema-enum drift guard binds |

**Live-bug reproductions (no mutation — the real code already misbehaves):**

| Ref | Scratch file | Demonstrated |
|---|---|---|
| CORE-LOGIC-004 | test-legaltools-nogit.mjs | no-git EXECUTING: `recommended:null` + false `why` while `conductor_validate` is legal |
| CORE-LOGIC-005 | test-classify.mjs + test-validatequeue.mjs | `**` fileScope → every unresolved import is `missing-subject`; decompose accepts `**` for a behavioral item |
| CORE-LOGIC-006 | test-blockeddep.mjs | dependent behind a blocked dep counts `open`; only `noop` reachable, never `blocked`/`surfaced` |

**Checks confirmed NOT decorative by reading their tests (no mutation needed):** the
`planning.ts` semantic checks — `vagueAcceptance` (accepts "make it return 404", rejects
"make it better"), `acceptanceClusters` (both one-cluster and two-cluster cases),
`scanPlaceholders` (accepts prose mentioning "placeholder", rejects `TODO:`/`TBD`/bare `...`),
`validateQueue` size/cycle/behavioral rows — are all directly unit-tested for BOTH acceptance
and refusal in `tools-9.2.test.ts` (P5 satisfied).

---

## 5. Coverage ledger

All 17 files in `conductor/core/` (per `git ls-files conductor/core/`) read in full.

| File | What was done | Coverage | Conclusion / ids |
|------|---------------|----------|------------------|
| types.ts (1414 L) | Read whole; traced §2 schemas, closed vocabularies, subset validator (scanKeywords/checkValue/validate), Classification cross-field rule, PlanDecision Omit-derivation | High (read) | No defect. Vocabularies drift-guarded against fsm-run/fsm-item (M9). Cross-field trivialItem rule matches §2.10. Cleared. |
| fsm-run.ts (175 L) | Read whole; verified §3.1 forward-only table, INTAKE routing, EXECUTING split; M9 drift mutation | High (read + M9) | Table matches §3.1; vocab drift-guarded. Cleared. |
| fsm-item.ts (183 L) | Read whole; §3.3 chains, blocked-precedence, redEvidenceGate, TEST_VETTED→GREEN gate; M1 | High (read + M1) | Sequence enforcement binds (M1). Legal-red *content* defeatable upstream → CORE-LOGIC-005. |
| stops.ts (134 L) | Read whole; isTerminal, shouldTerminate ladder; blocked-dep repro | High (read + repro) | CORE-LOGIC-006 (open-count conflation). Ordering otherwise correct. |
| decide.ts (158 L) | Read whole; scoreOptions, isHumanTerritory regexes, requireTwoOptions | High (read) | CORE-LOGIC-001, -002; IDEA-CORE-2. scoreOptions tie logic correct. |
| verdict.ts (19 L) | Read whole; M2 | High (read + M2) | Tie-upholds threshold correct + enforced. Cleared. |
| freshness.ts (209 L) | Read whole; verifyFreshFor (NaN fail-safe, 2 conditions), classifyFailure + normalizeSpecifier; M3 + CORE-LOGIC-005 repro | High (read + M3 + repro) | verifyFreshFor cleared (M3). CORE-LOGIC-005 (`**` vacuous). `..`-escape handling correct. |
| commit-message.ts (148 L) | Read whole; denylist, quoteForBody, foldToSubject, buildCommitMessage | High (read) | CORE-LOGIC-003 (raw id/fileScope newline injection). Trailer defense-in-depth sound. |
| journal-events.ts (122 L) | Read whole; COMPONENTS/EVENTS, isKnownEvent | High (read) | No defect; isKnownEvent rejects unknown component and unlisted event. Cleared (emit-coverage is adapter/journal review). |
| planning.ts (629 L) | Read whole; validateQueue, findDependsOnCycles, firstIntersectingGlob, vague/cluster/placeholder, findingBlocksItems; CORE-LOGIC-005 enabling repro | High (read + repro) | Semantic checks well-tested both directions (tools-9.2). CORE-LOGIC-005 (no wildcard-headed-scope rejection). Cycle detector sound. |
| queue-amend.ts (256 L) | Read whole; parseAmendOps, applyAmendOps net-effect + scope-change guard | High (read) | No defect; re-scope-forces-rebirth guard closes C-081 class; RED-bypass attempt blocked (Cleared areas). |
| schedule.ts (267 L) | Read whole; nextWave, isDegenerateScope, computeDepth, readFanout | High (read) | No defect. Its publishEnabled-blindness surfaces in the consumer → CORE-LOGIC-004. |
| gates-phase.ts (467 L) | Read whole; legalTools, nextStageTool, depsReady, cannotEverPublish, settledForReport; M8 + CORE-LOGIC-004/006 repros | High (read + M8 + repro) | CORE-LOGIC-004, contributes to -006. Report precondition binds (M8). |
| gates-edit.ts (433 L) | Read whole; decideSession, decideEdit, writeShapedPaths; M6, M7 | High (read + M6 + M7) | No new defect. Out-of-tree deny (M6) + freeze (M7) bind. Cleared. |
| gates-git.ts (486 L) | Read whole; decideGit, all subcommands, default-deny, hasUnresolvedExpansion, movement; M4 + manual attack walk | High (read + M4) | No new defect. Default-deny binds (M4). Alias-injection + expansion command words fail safe. Cleared. |
| shell-parse.ts (485 L) | Read whole; shellTokens, splitOnOperators, commandWordLocation, gitSubcommand, globMatch, literalHead, scopesIntersect | High (read) | No defect in security path. `[...]` unimplemented → IDEA-CORE-1 (fails safe). Double-star collapse bounds DoS. Cleared. |
| tool-bindings.ts (260 L) | Read whole; TOOL_BINDINGS vs §3.4; forget_stale null | High (read) | No defect; matches §3.4; decide `kind:"derived"` correct. Cleared (enum #1). |

---

## 6. Cleared areas (attacked, could not break)

- **RED-before-GREEN sequence (structural).** The item FSM makes a behavioral item's only
  exit from PENDING a proven RED (M1: exit-0 and non-assertion classes rejected); GREEN is
  reachable only from TEST_VETTED with `testExit===0`. No PENDING→GREEN edge exists for a
  behavioral item. I could not construct a pure-FSM path to GREEN skipping RED. (The weakness
  found — CORE-LOGIC-005 — is in what counts as a legal red, not in the sequence.)
- **RED-bypass via `conductor_queue_amend` (attempted, blocked).** Tried: non-behavioral item
  (PENDING→GREEN, no red) amended to `behavioral:true` at GREEN. Blocked — flipping to
  behavioral needs a non-empty testScope (else `validateQueue` rejects), and a testScope
  change at a non-PENDING state is refused by the scope-change guard (queue-amend.ts:221-232);
  remove+add reborns PENDING with no evidence, forcing a fresh RED. Could not break.
- **Git deny matrix (M4 + manual walk).** Attacked from the charter list: `git -c alias.x=… x`
  (→ default-deny), `git -c k=v push` (→ push deny), `git branch -D x` (operand scan → deny),
  `git stash push -m drop` (→ stash push deny), `env sh -c "git apply …"` (unwrap + apply →
  deny), `$'\x67it' push` (backslash residual → hasUnresolvedExpansion → deny),
  `sudo -u bob git push` (value-flag skip → push deny), `sudo env git push` (two wrappers →
  unresolvable → deny). All deny. No undocumented bypass in the pure gate.
- **Edit-scope gate (M6 + M7).** Out-of-tree deny and freeze both bind; `..` denied
  pre-scope-match; `.conductor/**` deny on normalized path; reader/unknown roles fail-safe
  deny; spawn deny unconditional; write-shape extraction covers redirects/tee/sed/mv/cp/rm/
  perl/dd/gawk/ex/ed and recurses `sh -c` (depth 8). Could not break.
- **Freshness rule (M3).** HEAD term binds; NaN → stale fail-safe; equality-at-start counts
  fresh. Could not make a stale record read fresh.
- **Skeptic aggregation (M2).** Tie-upholds at k=2, strict majority at k=3. Could not break.
- **Closed-vocabulary drift (M9).** RUN_STATES/ITEM_STATES ↔ schema-enum guard binds; STOP_KINDS
  type-tied; no unguarded restatement within core.
- **DAG cycle detection.** Iterative 3-colour DFS with duplicate-id edge union, empty-id
  exclusion, dangling-dep skip, node-set dedup — both documented historical defects handled.
  Could not break.

---

## 7. Mandatory enumerations (core-scope slices)

**Enum #1 — tool-bindings vs §3.4 inventory (22 tools).** `TOOL_BINDINGS` names all 22 §3.4
tools; 21 map to a committed handler, `conductor_forget_stale` is `null` (guard-tested).
`conductor_decide` fixes `kind:"derived"` (correct — a tool-call decision was not "asked").
Verdict: no mismatch in the table; arg-shape↔handler-required-field equality is enforced by
`tool-binding.test.ts` (not re-mutated — adapter-adjacent).

**Enum #2 — closed vocabularies owned by core (P3).**

| Vocabulary | Owner | Restated in | Drift guard |
|---|---|---|---|
| RUN_STATES | fsm-run.ts / types.ts schema enum | types.ts | single-source.test.ts deepEqual (M9) |
| ITEM_STATES | fsm-item.ts / types.ts | types.ts, queue-amend imports | single-source.test.ts deepEqual |
| STOP_KINDS | types.ts `StopKind` | stops.ts (`satisfies`) | type-tie |
| LADDER/CLASSIFICATION/EVIDENCE/FAILURE/DECISION/ANOMALY/QUESTION_ORIGIN/SEVERITY/IMPLEMENTER/GIT_MODE kinds | types.ts (single owner) | — | schema enum |
| AMEND_OP_KINDS | queue-amend.ts | — | single owner, exhaustive switch |
| COMPONENTS / EVENTS | journal-events.ts | — | isKnownEvent |
| TRAILER_DENYLIST | commit-message.ts | handler refusal derives via `hasDenylistedTrailer` | shared function |

Verdict: no unguarded restatement found within `conductor/core/`.

**Enum #3 — core branches needing an unusual precondition (P12).**

| Branch | Precondition | Test reaches it? |
|---|---|---|
| redEvidenceGate reject exit-0/class error | passing/error test | yes (M1) |
| verifyFreshFor NaN fail-safe | non-finite timestamp | yes |
| verifyFreshFor HEAD-moved | branch switch | yes (M3) |
| classifyFailure error for out-of-scope import | specifier outside fileScope | yes — but `**`-scope hole (CORE-LOGIC-005) NOT reached |
| cannotEverPublish deferred-dep fixpoint | deferred dependency | partial; blocked-dep path (CORE-LOGIC-006) NOT reached |
| legalTools no-git publish suppression | publishEnabled:false at REVIEWED | multi-item recommendation NOT reached (CORE-LOGIC-004) |
| applyAmendOps scope-change-at-non-PENDING refusal | update rewriting scope at RED/GREEN | yes |
| decideGit unresolvable-command-word deny | sudo env git / `$'…'` / backtick | yes (gates-git test table + manual) |
| shouldTerminate env-stop | overridesUsed ≥ cap ≥ 1 | yes |

Verdict: the three unreached branches map exactly to CORE-LOGIC-004/-005/-006 — the live
defects sit precisely where test coverage stops (P12).
