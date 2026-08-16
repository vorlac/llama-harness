# Step 2 Part — tools.ts handlers, first half (INTAKE → GREEN)

**Scope:** `conductor/adapter/tools.ts` — classify, decompose, plan, plan_review, dispatch_wave,
submit_test, vet_test, mark_green handlers, plus the shared helpers they use.
**Reviewer:** tools-handlers-a
**Date:** 2026-08-15
**Status:** COMPLETE — 7 ISSUEs (2 MAJOR-worst, filed A-001..A-007), 5 IDEAs, 5 cross-lens
pointers, 19 mutations applied and restored (`cmp`-verified pristine), coverage ledger closes
every region in scope. Baseline gate re-confirmed 1382/0 after restore.

Central question per handler: **does it re-derive what the model claims, or accept it?**

---

## 1. ISSUE register

(entries TOOLS-HANDLERS-A-001, -002, … appended as found)

### TOOLS-HANDLERS-A-001 — conductor_classify has no legality step: re-invoking it on an advanced run clobbers queue.json, resets item state, and moves the run FSM along edges §3.1 does not have

**Severity:** MAJOR
**Pattern:** new — "a pipeline entry tool with no re-entry guard" (closest kin: P7 composition, and the §3.4 invariant loop violated by omission)
**Where:** `conductor/adapter/tools.ts:649` (`handleClassify`), `conductor/plugin/index.ts:1072` (the binding adds no guard either)
**Status:** REPRODUCED (scratch repro, see mutation table row M1)

Every other pipeline handler opens with a legality check: `handleDecompose` (tools.ts:1335)
and `handlePlan` (tools.ts:1576) call `legalRunTransition`; `handlePlanReview` probes the edge
(tools.ts:2112); the item-stage tools all call `requireStageTool` → `legalTools`. `handleClassify`
alone has **none** — its first act is to dispatch the classifier. The plugin's `runTool` body
(plugin/index.ts:1226-1245) enforces only argument shape; `gateBeforeToolCall` enforces only
session registry / git / edit-scope. `legalTools`' verdict that classify is legal only at
INTAKE-unclassified (gates-phase.ts:~345) is delivered solely through the injected state block
(inject.ts:117) — **advisory prose, not enforcement**.

**Reproduction** (run against real `openWorkspace` + real `createFanout` over the fake SDK):
a run at PLANNED, with a 2-item decomposed queue (`I1` GREEN, `I2` PENDING, I2 dependsOn I1),
receives a second `conductor_classify` call whose classifier replies "trivial". Observed:

- **no throw** — the handler accepted the call;
- `queue.json` **overwritten** with the single synthesized trivial item (the decomposed queue is gone; `I2`'s runtime item file remains as an orphan the queue no longer names);
- item `I1` **reset from GREEN to PENDING** via `store.saveItem(runId, newPendingItem(itemId))` (tools.ts:762) — its evidence map, attempts and taint wiped;
- `run.state` moved **PLANNED → EXECUTING**, an edge `legalRunTransition` does not admit (§3.1: PLANNED's successor is PLAN_REVIEWED).

Variants that follow from the same hole, not separately reproduced but visible in the code path:
- classifier replies "question" ⇒ `run.state = "ANSWERED"` (tools.ts:772) — **a terminal state**
  (`core/stops.ts:65`), reachable from any live state; a run mid-EXECUTING with unfinished items
  jumps to terminal with no report and no stop record.
- **Classification shopping:** at INTAKE-classified-work (before decompose), repeated
  `conductor_classify` calls each re-roll a stochastic classifier and overwrite
  `run.classification`. A lazy orchestrator can re-roll until the classifier emits "question",
  converting a work request into ANSWERED with zero work performed. Nothing counts or caps
  classify invocations; each call spends two sub-sessions.

**What a lying/lazy model gets away with:** ending any run, in any state, by calling
conductor_classify until the mechanical classifier (temp 0.1, but still stochastic over an
ambiguous prompt) says "question"; or resetting a failing item's state by re-classifying
"trivial". The journal records `fsm transition` lines but no guard ever refuses.

**Failed refutation attempts:** (a) "the orchestrator's doctrine forbids it" — doctrine is
advisory by the project's own thesis; (b) "legalTools omits classify from the legal set after
classification" — true, but that verdict is only rendered into the prompt, never checked in
`runTool` or the handler; (c) "chat-message creates a fresh run per prompt so re-classify hits a
fresh run" — the repro calls the same runId, exactly what the bound tool does for the live run.

**Fix direction:** give handleClassify the same legality-first step the other three planning
handlers have: refuse when `run.state !== "INTAKE"` or when `run.classification` is already a
real (non-placeholder) classification; or centrally enforce `legalTools` in `runTool` for every
conductor tool. Note the placeholder classification chat-message synthesizes (kind "work",
rationale "intake placeholder") complicates the "already classified" test — the run field cannot
distinguish placeholder from real classification, which is itself a P3-adjacent smell (two
meanings in one field, distinguished only by convention).

### TOOLS-HANDLERS-A-002 — The vetted-test "freeze" is void whenever fileScope covers a testScope path: the implementer may rewrite the test it must pass, and nothing validates the scopes disjoint

**Severity:** MAJOR
**Pattern:** P7 (individually-correct rules composing into a hole)
**Where:** `core/gates-edit.ts:226-233` (implementer arm allows any fileScope match, testScope never subtracted) · `core/planning.ts:284` (`validateQueue` — no fileScope∩testScope disjointness rule) · `conductor/adapter/tools.ts:4111-4119` (`implementerPrompt` — "the test files are frozen" stated as prose only) · `tools.ts:475` (`trivialViolatesRecheck` — no disjointness check on the trivial path either)
**Status:** REPRODUCED (decideEdit driven directly — see mutation table rows M2a/M2b)

Three rules, each right alone, per the immutable plan itself:
1. §3.5 (plan ~1392): "Implementer … allow only paths matching the assigned item's fileScope" — `gates-edit.ts` implements exactly this; the implementer arm never consults testScope.
2. §3.5 (plan 1523): "testWriter: edit testScope only" — implemented.
3. §3.2's validateQueue table constrains ids, DAG, sizes, behavioral/testScope IFF, behavioralPaths disjointness, acceptance phrasing, ponytail — and **never** fileScope∩testScope.

Composition: the queue is **model-authored**. A planner that declares `fileScope: ["src/**"]`
with colocated tests (`testScope: ["src/foo.test.ts"]`), or simply lists the test file in both
scopes, produces an item whose implementer is **gate-ALLOWED to edit the vetted test**:

```
decideEdit({sessionRole:"implementer", fileScope:["src/**"], testScope:["src/foo.test.ts"],
            path:"/repo/src/foo.test.ts", sessionTree:"/repo", ...})
  => {"action":"allow"}     // reproduced against the real core
```

Colocated tests are not exotic — `src/**` fileScope is the natural spelling for many repos,
and the decompose doctrine nowhere tells the planner the scopes must be disjoint (the
decomposePrompt at tools.ts:1270 lists every REJECT rule; disjointness is not among them,
because validateQueue does not enforce it).

**The kill chain:** testWriter writes a genuine red (vetted) → implementer, allowed into the
test file, rewrites it to a tautology → `handleMarkGreen` re-runs "the test" (tools.ts:4318),
it exits 0 → GREEN, with a §2.6 green record whose evidence looks pristine. The plan's central
claim — "skipping RED-before-GREEN is structurally impossible" — holds only for items whose
scopes happen to be disjoint, a property no gate re-derives. handleValidate's full verify also
passes (the tautology passes everywhere). Only the item-review lenses might notice the diff —
advisory, model eyes.

**The verify-marker freeze is a different rule** and does not cover this: it denies edits only
while a verify marker is live for the tree (gates-edit.ts:196-203). Between TEST_VETTED and
the mark_green test run there is no marker.

**This is a finding about the design** (briefing §2): the implementation conforms to the
plan's §3.5 role table; the plan's own rules compose into the hole. Fix direction: (a) subtract
testScope matches from the implementer's writable set in `decideEdit` (test files are owed to
the testWriter role alone), and/or (b) add a fileScope∩testScope glob-intersection rejection to
`validateQueue` and `trivialViolatesRecheck` (the `scopesIntersect` helper already exists and
is already imported by tools.ts). (a) is the structural fix; (b) alone still leaves the
orchestrator inline-claim path (see cross-lens pointer to inline_claim).

**Failed refutation:** "the implementer's diff is reviewed at item_review" — review lenses are
model judgment, exactly what the harness exists not to trust; "the plan says fileScope only,
so this is conformant" — conformance to a spec whose rules compose into a hole is the P7
definition; the enforcement question is whether RED-before-GREEN survives, and it does not.

### TOOLS-HANDLERS-A-003 — handleMarkGreen discards the zero-test/fallback facts it is handed: a green from a run that executed zero tests, or from an untargeted full-suite run, is admitted as the item's GREEN

**Severity:** MAJOR (reachability gated on collection-affecting config in fileScope; the asymmetry itself is unconditional)
**Pattern:** P1 (a check that passes while inspecting less than it appears to)
**Where:** `conductor/adapter/tools.ts:4318-4350` (`handleMarkGreen` reads only `record.kind`/`record.exitCode`; `outcome.ranZeroTests`, `outcome.fellBack`, `outcome.targeted` are never consulted on the green path) · `adapter/evidence.ts:517-526` (the zero-test guard silently converts a zero-test targeted run into a full-scope fallback) · `adapter/evidence.ts:555` (a green §2.6 record carries NO `targeted` field at all — only red records do, `evidence.ts:207`)

The red side is scrupulous: `redAdmission` (tools.ts:2767) refuses a red that fell back, ran
zero tests, or fails to name a testScope file — "a suite failure elsewhere impersonating a
red." The green side has **no counterpart**. In `runTest`, a targeted run that matches the
runner's zero-test patterns sets `ranZeroTests = true` and re-runs the FULL scope command
(evidence.ts:517-526). If that full run exits 0, the record is `{kind:"green", exitCode:0}` and
`handleMarkGreen` admits TEST_VETTED→GREEN via `legalItemTransition(..., {testExit: 0})` —
the item's own vetted test **provably executed zero times** in the run that handed it GREEN
(that is what ranZeroTests means), and the handler had the flag in hand and dropped it.

Reachability: at submit time the test executed and failed (or the item would never have
reached TEST_VETTED), so collection must change between vet and green. The implementer can
only edit fileScope — but a fileScope containing any collection-affecting file (conftest.py,
vitest/jest config, package.json, pytest.ini) suffices, and -002 shows fileScope contents are
unconstrained. Deselect the item's test → targeted run reports "no tests" → fallback full
suite (same deselection) passes → GREEN. The same trick then survives handleValidate's full
verify — same commands, same config. This is the adversary brief's "get a test to pass
without the behaviour it names," achieved without touching the test file.

Secondary schema observation: because a green evidence record has no `targeted`/`fellBack`
fields, even a forensic reader of evidence.jsonl **cannot distinguish** a targeted item-test
green from a full-suite fallback green. The record that proves the load-bearing property does
not carry the property.

**Fix direction:** on the green path, refuse (or at minimum record and journal at warn) when
`outcome.ranZeroTests || !outcome.targeted` for a behavioral item — mirror redAdmission; add
`targeted` to the green record shape (§2 schema change — flag to the design owner).

**Failed refutation:** "the fallback full suite is a strictly stronger check" — only when the
item's test is IN it; ranZeroTests=true is direct evidence it is not; "validate re-verifies" —
with the same commands under the same config, so it inherits the deselection.

### TOOLS-HANDLERS-A-004 — The §2.10 criteria verdicts gate nothing: a critic that fails a criterion but returns empty mustFix advances the test, and the self-contradiction is not even journaled

**Severity:** MEDIUM
**Pattern:** P13-adjacent (a recorded verdict that proves nothing) / F5-asymmetry
**Where:** `conductor/adapter/tools.ts:3692-3725` (the round is clean IFF the mustFix union is empty; `verdictsByCriterion` feeds only the informational tally) · compare `tools.ts:695-704` (handleClassify NORMALIZES the analogous contradiction)

`handleVetTest` advances RED→TEST_VETTED when every critic's `mustFix` is empty
(tools.ts:3725). The five §2.10 criteria verdicts — including `wouldCatchWrongImpl`, the
tautology check that is the stage's whole point — are tallied (3712-3717) into the compact
return and the journal, and **never consulted for the advance**. A schema-valid receipt of
`{verdictsByCriterion: {wouldCatchWrongImpl: {pass:false, note:"tautological"}}, mustFix: []}`
is self-contradictory: the critic has judged the test unable to catch a wrong implementation
and simultaneously approved it. The handler advances the item and persists a tally that says
the opposite of the disposition.

Contrast handleClassify, which met the same shape (`{agreed:false, correctedKind:null}`) and
normalized it explicitly (tools.ts:695-704, the F5 fix). The vet loop has no analogous
normalization, and the ambiguity resolves in the LESS strict direction — the one a lazy critic
under a small model will drift toward, since the prompt's last word is "An EMPTY mustFix is
the approval."

The plan (line 1210) specifies the loop only as "mustFix items → back to the test-writer,
re-vet," so the code is arguably conformant — but the §2.10 schema's criteria then exist only
as decoration on the wire, which is a P13-shape: a recorded verdict that proves nothing.

**Fix direction:** treat any `pass:false` as an implicit mustFix entry ("criterion X failed:
<note>"), or refuse the self-contradictory receipt and re-dispatch that critic (the fan-out
already has the retry shape). Either way the record and the disposition stop disagreeing.

**Failed refutation:** "critics that fail a criterion will in practice fill mustFix" — the
schema does not require it, the prompt does not demand it, and this codebase's own record
(C-092) shows exactly this class of gap converting visible gaps into invisible ones.

### TOOLS-HANDLERS-A-005 — The abandonment fence covers only the StateStore: an abandoned stage can still append evidence records, mint questions, and dispatch sub-sessions

**Severity:** MEDIUM
**Pattern:** P4 (a mechanism whose name asserts a property it does not implement)
**Where:** `conductor/adapter/tools.ts:4980-5007` (`fenceStore` proxies StateStore methods only) · `tools.ts:5397-5407` (the abandonment message claims "this abandoned stage may no longer read or write the run's state") · escape routes: `evidence.ts runTest/appendEvidence` (writes `<runDir>/evidence.jsonl` by path, not through the store), `questions.ts appendQuestion` (same), `appendDecision` (tools.ts:595, plain `appendFileSync`), and the un-fenced `fanout` (an abandoned stage can keep dispatching sub-sessions and spending model budget)

When a held stage's budget expires, `handleDispatchWave` "abandons" it: `fence.abandon()`
makes every future **StateStore** call throw, and the driver reports the member stopped. The
comment (5394-5396) and the refusal text both claim the stage "may no longer read or write the
run's state." But the run's state is wider than the store:

- **evidence.jsonl** — an abandoned `handleMarkGreen` that was mid-`runTest` still appends its
  red/green record when the child exits. `capturedRedOf` (tools.ts:3448) later reads that
  ledger and treats "latest run for this item" as authoritative for staleness; a late record
  from an abandoned stage can silently change the vet path's staleness verdict for a
  subsequent, legitimate call.
- **questions.jsonl** — `blockAndAsk` (tools.ts:3109) appends the §2.11 question FIRST
  (reuseOrAppendBlockingQuestion) and calls `store.setBlocked` SECOND. In an abandoned stage
  the append succeeds and the setBlocked throws on the fence — leaving an ORPHAN OPEN question
  whose `blocksItems` names an item that is not in fact blocked. An open question keeps
  `hasOpenQuestion` true in `legalTools` and appears in every status/report until a human
  answers a question the driver had already env-failed.
- **decisions.jsonl** — submit_test's immediate-pass fork appends the same way.
- **fanout** — nothing revokes the abandoned stage's ability to dispatch further write-capable
  sub-sessions (a vet repair loop mid-flight keeps going: testWriter dispatch → test re-run →
  more evidence appends), spending sub-session budget invisible to the wave's disposition.

Not reproduced end-to-end (requires a real held-job expiry race); the escape routes are
verified by reading each writer's implementation — none goes through StateStore.

**Fix direction:** thread an abort signal into the executor context (checked by the evidence
and questions writers and by `Fanout.dispatch`), or fence at the run-dir layer rather than the
store object; at minimum, correct the abandonment message and the C-054 comment to name what
the fence actually covers.

### TOOLS-HANDLERS-A-006 — dispatch_wave's freeze-hold bound applies only when the freeze was observed BEFORE dispatch: a marker that goes live in the check-to-admit window makes the wave await unbounded

**Severity:** LOW (narrow race; the common release path — a sibling's notifyClear — usually fires)
**Pattern:** P7/TOCTOU
**Where:** `conductor/adapter/tools.ts:5356` (`frozen` computed once, before dispatch) · `tools.ts:5388` (`frozen ? await awaitHeld(settle) : await settle` — the unbounded arm)

The held-job budget (`awaitHeld`) wraps the settlement **only when `treeState.isFrozen` was
true at the driver's check**. A verify marker created after that check (a concurrently-running
validate member in the same group — validate is a read stage and runs concurrently with the
serial write chain) but before the engine admits the write-capable job produces a held job the
driver awaits with **no budget**. The escape hatch is that the sibling validate's own
`runStage` calls `treeState.notifyClear` when it finishes — so the hang requires the
marker-holder to never reach its notifyClear (a crash of the driver process makes the question
moot; a validate stage that throws still reaches notifyClear at 5430 because settle settles).
The truly-stuck construction is therefore narrow, but the asymmetry — bounded when observed,
unbounded when raced — is real and costs one line to remove (always race against the budget
when `SERIAL_STAGES.includes(tool)`).

### TOOLS-HANDLERS-A-007 — `assertDecisionValid` is a decorative check: no test proves the DecisionRecord schema validator can refuse

**Severity:** LOW
**Pattern:** P5 (a happy-path suite cannot prove a validator is in the path) / decorative check (Part B item 1)
**Where:** `conductor/adapter/tools.ts:553-558` (`assertDecisionValid` → `validate("DecisionRecord", …)`, called by `appendDecision` at tools.ts:596)
**Status:** REPRODUCED via mutation M24 — `return;` before the validate call; gate stays green across 10 suites including e2e.

Mutating `assertDecisionValid` into a no-op left the full gate's decision suites (tools-9.1,
9.2, 9.4a, 9.4c, e2e, continuation, composition, single-source, purity, source-hygiene) all
green. The reason is structural, not an oversight of one test: **every caller of appendDecision
constructs the DecisionRecord internally from typed fields** (handleDecide tools.ts:878,
handleDefer tools.ts:1167, handlePlan tools.ts:1637, the submit-test fork tools.ts:3227,
plan-review revisions tools.ts:2182). No production path ever feeds appendDecision a
model-shaped or malformed record, so the schema validation can never fire in production and no
test exercises its refusal. `requireTwoOptions` (a separate, well-tested gate) does the
load-bearing work for kind:"derived". `assertDecisionValid` could be deleted and nothing —
test or production — would notice.

This is LOW because the records are handler-built and correct; the finding is that the check is
inert, so if a future edit makes a caller pass through model data, the "guardrail" that looks
like it would catch a bad record has never been shown to. Fix direction: either add a refusal
test (feed appendDecision a record missing `choice`, assert it throws) or drop the check and
rely on the store's own `saveRun`/`saveItem` schema gates plus requireTwoOptions.

Note on the full-gate observation: two full-gate runs under M24 reported 1 and 2 failures, but
those were the worktree-stage-trees suite (which passes 5/5 in isolation and 1382/0 on a clean
full gate); the M24-attributable catch is zero. The worktree suite's flakiness under
full-gate parallel load is a separate observation — see CROSS-LENS POINTERS.

---

## 2. IDEA register

### IDEA-A-01 — The provisional classification `{kind:"work", rationale:"provisional..."}` cannot be distinguished from a real classification

Origin: while reproducing A-001, the "already classified?" guard I proposed cannot be written
cleanly because chat-message.ts:86 seeds a schema-valid placeholder classification with
`check.agreed:false`. A run genuinely classified work by handleClassify also has a
classification. The only discriminator is `check.note === "classification check pending
conductor_classify"` — a string convention, exactly the P3 smell (two meanings in one field).
Kind: naming / robustness. Value: makes A-001's fix expressible and removes a latent
two-meanings field. Cost: small — add an explicit `classified: boolean` or a nullable
classification. Relates to: TOOLS-HANDLERS-A-001.

### IDEA-A-02 — A green evidence record should carry `targeted`/`ranZeroTests`, as red records carry `targeted`

Origin: A-003. A red record has `targeted` (evidence.ts:207 RED_REQUIRED); a green record
(evidence.ts:555) has only `{seq,ts,kind,itemId,command,exitCode}`. A forensic reader cannot
tell a targeted item-test green from a full-suite fallback green. Kind: schema / debuggability.
Value: makes the load-bearing "the test that named the item actually ran and passed" property
auditable after the fact. Cost: small schema change (flag to §2 owner). Relates to: A-003.

### IDEA-A-03 — decomposePrompt should tell the planner the scopes must be disjoint

Origin: A-002. `decomposePrompt` (tools.ts:1270) enumerates every rejection rule so the planner
knows the law before guessing — but omits fileScope∩testScope disjointness because
validateQueue does not enforce it. Even absent the structural fix, stating the rule reduces the
rate of colocated-scope items. Kind: doctrine/ergonomics. Value: fewer hole-shaped queues.
Cost: one sentence. Relates to: A-002.

### IDEA-A-04 — `Math.floor` on config knobs is done at 5 call sites; centralize it

Origin: reading itemVerifyScope/handleVetTest/handleSubmitTest. `Math.floor` is applied to
`testRepairAttempts`, `vetCritics`, `vetMaxRounds`, `subSessionTimeoutMs`, etc. each at point
of use, with a comment re-explaining "knobs round down" each time (tools.ts:3094, 3528, 3540,
5219). A single `intKnob(config, path)` accessor (or flooring at config load) would remove the
repetition and the risk of a new call site forgetting it. Kind: test-maintainability / P3-lite.
Cost: small. Relates to: standalone.

### IDEA-A-05 — The abandonment refusal message overstates what the fence covers

Origin: A-005. tools.ts:5397-5407 tells the reader the abandoned stage "may no longer read or
write the run's state," which is false for evidence.jsonl / questions.jsonl / decisions.jsonl /
fanout. Even before the fuller fix, the message and the C-054 comment should say "the run's
StateStore" not "the run's state." Kind: docs/accuracy. Cost: trivial. Relates to: A-005.

---

## 3. CROSS-LENS POINTERS

- **[capability / R3]** The orchestrator inline-claim path (`conductor_inline_claim` +
  `inlineClaimScopeFor`, tools.ts:7808) is a second route by which a write-capable session can
  edit a test file; A-002's structural fix (subtract testScope from the writable set) must be
  applied there too or the hole persists via inline claims. Owned by the capability review as a
  "make the wrong thing impossible" upgrade; noted here because it shares A-002's root.
- **[macro / R2]** `conductor/adapter/tools.ts` is 9,253 lines in one file spanning 22 tools;
  navigability for a 32k-context model is questionable. The `Math.floor` repetition (IDEA-A-04)
  and the five near-identical stage-handler skeletons suggest the file wants to be split by
  stage. Macro owns the sizing/organization judgment.
- **[concurrency / R1-other-subsystem]** `worktree-stage-trees.test.ts` passes 5/5 in isolation
  and 1382/0 on a clean full gate, but flaked (1–2 failures) under full-gate parallel load
  during the M24 run. Possible git-worktree resource race under load. Owned by the fanout /
  concurrency reviewer (`fanout-concurrency.md`); I did not chase it.
- **[composition / tools-handlers-b + composition reviewer]** The doctrine-injection dead-code
  finding (buildSystemAppend never wired) is already filed by `composition-injection.md`. It
  bears on A-004: the vet critics never receive test-vet.md content, only its name, which makes
  the "critic follows §2.10 criteria" premise even weaker.
- **[macro / R2]** The `runTool` body (plugin/index.ts:1226) enforces argument shape and session
  gating but NOT stage legality centrally — each handler re-implements its own legality (or, in
  classify's case, omits it, A-001). A single `legalTools`-in-runTool enforcement point would be
  a structural upgrade. Owned by macro/capability.

---

## 4. Mutation table

Every mutation was applied to a `cp`-snapshot-restored tree and verified via `bash
scripts/test-conductor.sh` (or `node --test --test-reporter=tap <file>` only to READ the
catching test's name). Baseline clean gate = **1382 pass / 0 fail**. All source restored and
`cmp`-verified pristine at the end.

| # | Mutation | File:region | Expectation | Result (gate) | Which assertion caught it | Verdict |
|---|---|---|---|---|---|---|
| M1 | re-classify an advanced (PLANNED) run | handleClassify (no legality) | should refuse | scratch repro: **accepted**, queue clobbered, I1 GREEN→PENDING, run→EXECUTING | nothing | **BINDS NOTHING — see A-001** |
| M2a | implementer edits vetted test inside `src/**` fileScope | decideEdit direct call | should deny | **allow** | n/a (core, direct) | **HOLE — see A-002** |
| M2b | implementer edits test file listed in both scopes | decideEdit direct call | should deny | **allow** | n/a | **HOLE — see A-002** |
| M3 | mark_green admits with `testExit: 0` regardless of real exit | handleMarkGreen:4349 | red should catch | fail=1 | `[9.4b-green-requires-passing-test]` | BINDS |
| M4 | redAdmission forces `failureClass:"assertion"` | handleSubmitTest:2778 | error-class red should be refused | fail=6 | 9.4a class-split tests | BINDS |
| M5 | trivialViolatesRecheck always false | tools.ts:475 | trivial-escalate tests should catch | fail=4 | 9.1-trivial-escalate ×3 | BINDS |
| M6 | planDefects always returns [] | tools.ts:1541 | placeholder/2-option gate should catch | fail=5 | 9.2/9.3 defect tests | BINDS |
| M7 | plan-review survivors always empty | planReviewRound:2037 | cap/blocking tests should catch | fail=6 | 9.3 survival tests | BINDS |
| M8 | requireStageTool never refuses | tools.ts:2623 | stage-legality tests should catch | fail=6 | 9.4a/b legality tests | BINDS |
| M9 | vet round clean even with mustFix (`>= 0`) | handleVetTest:3725 | vet-loop tests should catch | fail=8 | 9.4a vet round-cap tests | BINDS |
| M10 | mark_green quarantines nothing (excluded=[]) | handleMarkGreen:4316 | livelock test should catch | fail=1 | `[9.4b-no-template-wave-no-livelock]` | BINDS |
| M11 | assertContainedPaths no-op | tools.ts:2633 | path-escape test should catch | fail=1 | `[C032-D3-testscope-escape]` | BINDS |
| M13 | SERIAL_STAGES emptied (no write serialization) | tools.ts:4864 | concurrency tests should catch | fail=4 (+3 cancelled, 128s) | 9.4c/9.6 serialization tests | BINDS (also perf) |
| M14 | stricterKind returns LESS strict | tools.ts:465 | disagreement-escalation tests should catch | fail=4 | 9.1-classify escalation | BINDS |
| M16 | legalRed targeting check disabled | redAdmission:2788 | fallback-red-refused test should catch | fail=1 | `[C032-D1-fallback-red-refused]` | BINDS |
| M17 | vet staleness always false | capturedRedOf:3496 | stale-red test should catch | fail=1 | `[C032-D2-stale-red]` | BINDS |
| M19 | plan-review lens coverage floor removed | planReviewRound:1941 | lens-coverage test should catch | fail=1 | `[9.3-fix-lens-coverage]` | BINDS |
| M22 | decompose ignores validateQueue verdict | handleDecompose:1360 | queue-reject tests should catch | fail=6 | 9.2 rejection tests | BINDS |
| M23 | classify fabricates skeptic agreement (no dispatch) | handleClassify:685 | 2-sub-session assertion should catch | fail=2 | 9.1-classify (creates.length===2) | BINDS |
| M24 | assertDecisionValid no-op | tools.ts:553 | a refusal test should catch | fail=0 (worktree flake only) | **nothing** | **DECORATIVE — see A-007** |

Load-bearing mutations re-run and verified by me directly (not delegated): M1 (scratch repro,
console-confirmed), M2a/M2b (direct core call, JSON output confirmed), M24 (10-suite isolation).
The M3–M23 catches were each confirmed by naming the specific catching test via the tap reader.

---

## 5. Coverage ledger

My scope is the first half of `conductor/adapter/tools.ts` — the INTAKE→GREEN handlers and their
shared helpers. Read in full lines 1–5515 (gate wiring through dispatch_wave); skimmed 5517–9253
(the other reviewer's half) for context on shared helpers.

| Region (tools.ts) | Lines | What I did | Coverage | Conclusion |
|---|---|---|---|---|
| Header / imports / doc | 1–89 | read | full | context only |
| CONDUCTOR_TOOL_NAMES + classifyTool | 97–146 | read; cross-checked against plugin toolMap | full | 22 names correct; classifyTool spawn/write/conductor/read derivation sound |
| gateBeforeToolCall + fail-closed helpers | 148–440 | read closely (shared helper; gates reviewer owns deep attack) | full read, no mutation (deferred to gates-security.md) | fail-closed `guarded` flag looks correct; override-grant consume path read; **pointer left to gates reviewer** |
| handlerRunDir / stricterKind / trivialViolatesRecheck | 458–482 | read + **M5, M14** | full | escalation logic binds |
| decisions.jsonl ledger (readDecisions/mint/append/assertDecisionValid) | 484–599 | read + **M24** | full | torn-line tolerance sound; **assertDecisionValid decorative (A-007)** |
| reuseOrAppendBlockingQuestion | 560–592 | read | full | C-032 E7 dedup correct |
| handleClassify | 605–789 | read + **M23** + scratch repro **M1** | full | **A-001 (no legality), A-007-adjacent**; skeptic dispatch binds |
| handleStatus | 795–844 | read | full | read-only, no findings |
| handleDecide | 846–944 | read | full | requireTwoOptions + human-territory surfacing correct; legality-before-persist holds |
| handleSurface / handleAnswer / handleDefer | 946–1196 | read | full | first-block-wins + successor re-block correct (C-056); no findings |
| decompose helpers + handleDecompose | 1198–1419 | read + **M22** | full | validateQueue binds; re-prompt bounded at 1 |
| plan helpers + handlePlan | 1421–1666 | read + **M6** | full | planDefects binds; legality-before-persist holds |
| plan_review (lenses, skeptic, round, revise, handlePlanReview) | 1668–2315 | read + **M7, M19** | full | survival adjudication + lens coverage floor bind; cap→question→block path correct |
| STAGE_TREE / itemTreeOf / verifyInFlightTreeFor / testVetCriteria | 2353–2436 | read | full | slug↔path translation (C-037) correct |
| gateItemsOf / unpublishedDeps / stageDenyReason / requireStageTool | 2443–2627 | read + **M8, M11** | full | legality binds; path-containment binds |
| assertContainedPaths | 2629–2661 | read + **M11** | full | traversal/absolute refusal binds |
| requiredScopeNames / itemScopePaths / runScopePaths / itemVerifyScope | 2663–2735 | read | full | scope resolution sound |
| runItemTest / redAdmission | 2737–2807 | read + **M4, M16** | full | class-split + targeting bind |
| submit_test prompts + dispatchTestWriter | 2809–3023 | read | full | prompts carry no implementation |
| handleSubmitTest | 3029–3409 | read (M4/M16 exercise it) | full | immediate-pass fork + repair budget correct |
| capturedRedOf / handleVetTest | 3411–3881 | read + **M9, M17** | full | staleness re-establish + mustFix gate bind; **A-004 (criteria verdicts advisory)** |
| implementer helpers + demote/registerStaleRed/foreignRedSet | 3888–4164 | read | full | normalizeRepoRel own-test guard correct |
| handleMarkGreen | 4166–4410 | read + **M3, M10** | full | **A-003 (zero-test/fallback facts discarded)**; exit-code + quarantine bind |
| handleValidate / handleQueueAmend | 4412–4815 | read (other reviewer co-owns validate; I read for mark_green→validate seam) | partial-deep | validate's full-verify inherits A-003's deselection; queue_amend not mutated (skimmed) |
| dispatch_wave (all helpers + handleDispatchWave) | 4816–5515 | read + **M13** | full | **A-005 (fence covers store only), A-006 (freeze bound race)**; serialization binds |
| item_review → end | 5517–9253 | skimmed for shared-helper context | out of scope (tools-handlers-b) | not examined in depth |
| gates-edit.ts (decideEdit) | whole | read + **M2a, M2b** direct | full (as it bears on A-002) | implementer arm allows test files in fileScope |
| planning.ts validateQueue | 284–420 | read | full (as it bears on A-002) | no fileScope∩testScope rule |
| evidence.ts runTest | 416–589 | read | full (as it bears on A-003) | zero-test guard silently falls back; green record lacks `targeted` |

---

## 6. Cleared areas

Things I attacked and could **not** break (the specific attack named):

- **RED-before-GREEN via exit code** — M3 (mark_green admits `testExit:0`) caught by
  `[9.4b-green-requires-passing-test]`. The handler genuinely re-runs the test and reads its
  real exit. (But see A-003 for the *orthogonal* zero-test route, and A-002 for the test-rewrite
  route — those are not exit-code attacks.)
- **Illegal-red admission** — M4 (any class as assertion) and M16 (targeting check off) both
  caught; class-split + targeting are real gates.
- **Stage legality for the item stage tools** — M8 (requireStageTool never refuses) caught; the
  gate derivation is load-bearing. (classify is the exception — A-001.)
- **Decompose queue validation** — M22 caught; validateQueue verdict is honored.
- **Plan defect/placeholder scan** — M6 caught.
- **Plan-review survival + lens coverage** — M7 and M19 caught; the ⌈k/2⌉ adjudication and the
  four-lens floor both bind.
- **Vet mustFix gate** — M9 caught; a non-empty union cannot advance. (But the per-criterion
  verdicts are advisory — A-004.)
- **Vet staleness** — M17 caught by `[C032-D2-stale-red]`; a repaired-then-passing test cannot
  ride a pre-repair red to TEST_VETTED.
- **Foreign-red quarantine at mark_green** — M10 caught by the no-livelock test.
- **Path containment (testScope/fileScope escape)** — M11 caught by `[C032-D3-testscope-escape]`.
- **Write serialization in the wave** — M13 (SERIAL_STAGES emptied) caught.
- **Classifier skeptic dispatch** — M23 (skip skeptic) caught by the 2-sub-session assertion.
- **Disagreement escalation** — M14 (invert stricterKind) caught by 9.1-classify.
- **Trivial re-check escalation** — M5 caught by the three 9.1-trivial-escalate tests.
- **handleSurface / handleAnswer first-block-wins + successor re-block** — read closely, could
  not construct a state where answering releases an item a second open question still gates; the
  successor search and the `alreadyBlocked` set are correct.
- **Legality-before-persist** across decide/defer/decompose/plan/plan_review — read each throw
  site; every one precedes the first persist, so a rejected call leaves nothing behind.

