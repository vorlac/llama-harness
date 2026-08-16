# Composition Review — Defects in the Seams Between Subsystems (P7)

**Date:** 2026-08-16
**Reviewer scope:** composition defects across subsystem boundaries — defects that exist only in
the interaction of individually-correct components. This part consumes all sixteen prior parts in
`docs/reviews/conductor-review/parts/` and follows their CROSS-LENS POINTERS that name other
subsystems.

**Method:** (1) read all sixteen prior parts and harvest every seam lead; (2) for every terminal,
exit and escalation path, construct the state where each guard says "not mine" and ask who holds
it; (3) for every handoff between two subsystems, identify what each side assumes of the other and
whether that assumption is checked; (4) reproduce every candidate defect against real code before
filing.

**Status: COMPLETE.** 6 composition findings (COMPOSITION-001…006; 3 MAJOR, 3 MEDIUM), 2 reproduced
end-to-end through the real continuation engine, the rest closed by enumeration/reading across the
seam. Terminal-path, handoff, reproductions, cleared-seams and cross-lens sections filled. All work
done against the real committed tree; the one scratch test file was deleted and the tree verified
clean; no stray processes.

## Executive verdict

The harness's mechanical enforcement is strong *inside* each subsystem — the sixteen prior audits
established that. The composition defects live where the sixteen could not look: in the seams where
each side is individually correct and the net is a hole.

The dominant seam is **the run's terminal-disposition machinery**, and it is broken in a way no
single lens saw whole. Core (`stops.ts`) computes six stop kinds; the composed system can write only
four — **`blocked` and `surfaced` have no writer at all** (COMPOSITION-006). The continuation engine
defers them to `conductor_report`; `conductor_report` hardcodes `done`. So a run *waiting on a human*
is disposed of as either success (`done`, if it can reach report) or a futile wedge (`noop`, if a
blocked item has a dependent — reproduced end-to-end, COMPOSITION-001), and after the `noop` archives
the run, the plan's documented `conductor_answer` resume path is dead (reproduced: the human's answer
clears the block but never revives the dependent). The incentive gradient runs backwards: the honest
model that waits loses its run to `noop`; the lazy model that defers gets a clean `done`. For the
system's stated primary mode — unattended overnight operation — this means every run that surfaces a
genuine human question on a dependency chain abandons its downstream work with a mislabeled stop.

The second seam is **the enforcement locus** (COMPOSITION-004): meta tools and `conductor_classify`
are guarded by *neither* the mechanical phase gate (which covers only stage tools) *nor* the advisory
state block (which is unwired dead code) — the compensating control each layer assumed the other
provided is absent. This unifies the independently-filed A-001 and B-001 into one hole with one fix.

Confidence is high on COMPOSITION-001/-002/-006 (reproduced or enumerated exhaustively) and on -004
(two prior reviewers + my call-site census). -003 and -005 are argued from the shared mechanisms and
the filed halves, not separately reproduced, and are marked as such.

---

## Seam-lead harvest (from the sixteen prior parts)

Every prior CROSS-LENS POINTER that names *another subsystem* is a seam lead. The ones that
matter for P7 (a hole that exists only in the interaction of two correct components):

**The wedge cluster — the C-085 archetype, filed by four reviewers, closed by none.** Each of
these ends "the run wedges / goes noop / parks silently" and each defers the final step to
`continuation.ts`, which no reviewer traced back to the originating defect:
- CORE-LOGIC-006: a dependent behind a *blocked* dependency counts `open`, so only `noop` is
  reachable, never `blocked`/`surfaced`. Pure-core reviewer: "medium on the end-state
  (noop-vs-park) which depends on continuation.ts." → **seam: core/stops+gates-phase → continuation**
- CORE-LOGIC-004: no-git EXECUTING with a REVIEWED item sorting first → `recommended:null` while
  legal work exists → engine names no tool → futile → noop. "final step depends on continuation.ts."
  → **seam: core/gates-phase+schedule → continuation**
- TOOLS-HANDLERS-B-009: worktree-mode publish after a merge-back conflict finds "nothing to
  commit" forever; "the run ends noop — the wedge shape C-085 was about, one layer up." →
  **seam: publish(tools) → worktrees → continuation**
- TOOLS-HANDLERS-B-012: a red re-validate inside item_review throws into VALIDATED+broken-tree; the
  named remedy (conductor_validate) is illegal for a VALIDATED item; run ends noop instead of DEBUG.
  → **seam: item_review(tools) → gates-phase legality → continuation**
- FANOUT-CONCURRENCY-005/010/011: journal.log throw skips finish (wave never resolves);
  never-settling re-prompt latch; deterministic throw in handleSessionIdle — all "the silent-wedge
  shape, the counters freeze, the wedge detector can never fire." → **seam: fanout/continuation →
  journal → state**

**The enforcement-locus seam — who owns "is this tool legal now?"** Filed by three reviewers as a
missing choke point, never resolved as a composition:
- TOOLS-HANDLERS-A-001: `conductor_classify` has NO legality step; re-invoking clobbers state,
  moves the run FSM along edges §3.1 lacks. "legalTools' verdict is delivered solely through the
  injected state block — advisory prose, not enforcement."
- TOOLS-HANDLERS-B-001: every META handler skips the phase-order gate; `conductor_report` feeds
  `legalRunTransition` a hardcoded from-state. Reproduced: defer-all at DECOMPOSED → REPORTED/done.
- COMPOSITION-INJECTION-001: the injected state block (the ONLY channel that would tell the model
  which tool is legal) **is never wired** — no session ever receives it.
  → **seam: the "advisory" defense of A-001/B-001 rests on a channel injection proves is DEAD.**

**The tree-identity + gate composition:**
- COMPOSITION-INJECTION-005: default main-tree mode denies EVERY sub-session write (slug "main" vs
  path). Reproduced end-to-end. → seam: fanout registry → resolveSessionTree → gates-edit.
- GATES-SECURITY-007 / COMPOSITION-INJECTION-011: `apply_patch` bypasses the edit gate — plugin
  derives `editPath = args.filePath ?? args.path`, patch bodies carry neither. → seam: classifyTool
  (names it a write) → editPath derivation (serves only edit/write) → gates-edit.

**The caller-identity seam:**
- COMPOSITION-INJECTION-009: registered sub-sessions may call every `conductor_*` tool — answer own
  blocking question, defer own item, amend own scope. → seam: registry gate (allows any registered
  session) → handlers (check phase, not caller role).

**The evidence-attribution seam:**
- STATE-CRASH-005/006 + TOOLS-HANDLERS-A-005/B-014: an abandoned stage still appends evidence
  (fence covers only StateStore); `nextSeq` is read-max+1 with no cross-process guard; `readEvidenceAt`
  and publish resolve by seq alone, never checking `itemId`/`tree`. → seam: fence(tools) →
  evidence.jsonl(adapter) → capturedRedOf/publish(tools).

**The router-metrics deps seam:**
- FANOUT-CONCURRENCY-001/002/012: `fetchMetricsSummary` never composed into the report deps bundle;
  failover protects only setup probes; `metricsPartial`/`routerHealthy` read by nothing. → seam:
  plugin deps bundle → tools(report) → router-client.

These are the leads. Below I close the ones a single-subsystem review could not — by reproducing
the *composed* behavior, not by re-asserting the halves.

---

## Findings register

### COMPOSITION-001 — A blocked item WITH a dependent ends the run `noop`, never `blocked`/`surfaced`; after the noop archives, the plan's documented `conductor_answer` resume path cannot revive the dependent (REPRODUCED end-to-end)

- **Severity:** MAJOR (the run's primary use case — unattended operation — loses committed work with a stop kind that misdescribes what happened).
- **Pattern:** P7 (the C-085 family) — three individually-correct rules compose so that a run legitimately *waiting on a human* is classified and disposed of as a *futile wedge*.
- **Subsystems in the seam:** `core/gates-phase.ts` (`cannotEverPublish` deliberately excludes blocked deps) · `core/stops.ts` (`shouldTerminate` short-circuits on `open>0`, so only `noop` can fire) · `adapter/continuation.ts` (`handleSessionIdle` re-prompts to answer, counts futility, records `noop`, then `cleanupAndArchive` clears the run pointer) · `adapter/state.ts` (`archiveRun`).
- **Who filed the halves:** CORE-LOGIC-006 reproduced the pure-core facts and filed the exact cross-lens pointer — *"medium on the end-state (noop-vs-park) which depends on continuation.ts."* The fanout-concurrency reviewer read continuation.ts in full but never connected it back to the blocked-dependency scenario. **I closed the seam by driving the real `handleSessionIdle` against a real store (probe PROBE-A, reproductions log below).**

**The composed behavior, reproduced.** Fixture: run EXECUTING; `I1` at RED, blocked with an open
human-territory question `Q1` (origin `implementer-blocked`, `blocksItems:["I1"]` — the exact shape
`blockAndAsk` mints in production); `I2` at PENDING with `dependsOn:["I1"]`. Driving 6 idle passes
(clock advanced past the 2 s debounce each pass, state never changing):

```
PROBE-A prompts: 3  stops: [null,null,null,"noop",null,null]
PROBE-A currentRun after passes: NULL(archived)
PROBE-A post-answer clearedItems: {... "clearedItemIds":["I1"]}  I2.state: PENDING
        runFinal: {"kind":"noop","reasonDisplay":"the run made no observable progress across 3
        consecutive re-prompts (§3.7 futile re-prompt limit reached): disengaging..."}
```

Step by step: `legalTools` returns `recommended:null` (I1 blocked, I2 dependency-unready → no
schedulable first item) but legalizes `conductor_answer` because `Q1` is open. In the continuation
engine, `Q1` open makes `conductor_answer` a *position-specific* offered tool, so
`actionable = true` and the engine re-prompts the orchestrator: *"answer the open question that is
holding the run."* Each pass with an unchanged signature increments `futileRePrompts` (1, 2, 3); on
the fourth pass `shouldTerminate` returns `{stop:true, kind:"noop"}` and the engine records the stop
and calls `cleanupAndArchive`, which archives the run and **clears the current-run pointer**.

**Why this is a composition hole and not a single-subsystem bug.** Every rule is right alone:
- `cannotEverPublish` deliberately excludes a *blocked* dependency (gates-phase.ts:183-187) because
  "a question can be answered and the item resumes" — so `settledForReport` correctly refuses to let
  `conductor_report` close over I2, which is still live.
- `shouldTerminate` short-circuits on `open>0` (I2 is `open` per §2.5), so `blocked`/`surfaced` are
  structurally unreachable — the *only* computed stop for this shape is `noop`.
- The continuation engine re-prompts-then-noops rather than parking silently, *by design* — its (h)
  comment (continuation.ts:878-892) says returning silently here "froze the counters, which disabled
  §3.7's ONLY wedge detector, and the run sat in EXECUTING forever." So the designers chose noop over
  the silent wedge, correctly.

The net effect none of them can see: **the ONLY reachable disposition for "a blocked item with a
dependent, on an unattended run" is `noop` — the wedge/futile-loop kind — and the run is then
archived.** §2.9 reserves `surfaced` ("surfaced questions pending") and `blocked` ("every remaining
item blocked") for exactly this situation; the composed system can emit neither.

**The sharp, reachable damage — lost resumability.** The plan documents `conductor_answer` as the
human's resume path for a blocked/surfaced run (§3.7.4, cited by CORE-LOGIC-006). The reproduction
shows this path is *dead* for the noop-terminated run: answering `Q1` after the noop DOES clear
I1's block (`clearedItemIds:["I1"]`), but I2 stays PENDING forever — the run is terminal, its pointer
cleared, so no idle pass ever re-drives I2, and its `stop` stays `noop`. A human who answers the
blocking question one debounce-window too late (≈ three idle cycles) silently loses the entire run
and every dependent item's work. For the system's stated primary mode — unattended overnight
operation (user memory: "autonomy over asking") — the human is *never* present within those windows,
so **every** run that surfaces a genuine human-territory question on a blocked item with a dependent
disengages `noop` and abandons the downstream work.

**The incentive gradient runs backwards (composition with SWEEP-ADVERSARY-003).** Contrast the two
model behaviors at this position:
- The *honest* model waits for the human → `noop`, work abandoned, resume impossible.
- The *lazy* model calls `conductor_defer` on I1 (legal here; SWEEP-ADVERSARY-003) → I1 deferred →
  `cannotEverPublish` now includes I1 *and* I2 (dependent of a deferred item) → `settledForReport`
  reports all-settled → `conductor_report` is legal → the run closes `done` with a green closing
  verify and a `kind:"human"` decision record (forged provenance). Verified by reading
  `cannotEverPublish` (line 196 seeds deferred, line 202 propagates to dependents) and
  `settledForReport`.

So the composition *rewards* the defer-escape (clean `done`) and *punishes* honest waiting (`noop`,
work lost). That is exactly inverted from what the harness's thesis wants.

**Refutation attempted.** (1) *"noop is correct — a run that can't progress for three prompts should
disengage."* True for a genuinely dead loop; false for a run whose next step is a single human
answer that §2.9 has a dedicated stop kind (`surfaced`) to represent honestly, and whose resume the
plan explicitly promises. The defect is not that it stops, but that it stops under the wrong kind
*and destroys the resume path the plan documents.* (2) *"A lone blocked item closes fine."* Confirmed
— a blocked item with NO dependent makes `conductor_report` legal (blocked = settled) and closes as
`blocked`/`surfaced` correctly. The hole is specific to a blocked item **with a dependent**, which is
the normal shape of any dependency chain. I could not construct a reading in which the dependent's
abandonment-plus-unresumability is acceptable.

- **Fix direction:** either (a) make `shouldTerminate` classify "open items exist but every open item
  is dependency-stalled behind a blocked item with a pending question" as `surfaced`, not gate it
  behind the futile counter — so the honest stop kind is reachable and the run stays resumable; or
  (b) on `conductor_answer`, if the answer unblocks an item whose run terminated `noop`, revive the
  run (clear the stop, restore the pointer) so §3.7.4's documented resume path actually works; or
  (c) at minimum, do not `archiveRun` a `noop` run that still carries an open question — keep it
  resumable.

---

### COMPOSITION-002 — A blocked item WITHOUT a live question (plus a dependent) is a permanently SILENT, undetectable wedge, and the committed test `[10.1-idle-null-recommendation]` enshrines it as correct (REPRODUCED)

- **Severity:** MEDIUM (latent today — production blocks always mint a question — but it is the exact C-085 undetectable-wedge shape, blessed by a green test, so any future block-without-question path reintroduces it silently).
- **Pattern:** P7 + P13 (a named test that blesses the dangerous half of a composition).
- **Subsystems in the seam:** `adapter/continuation.ts` (`actionable` guard) · `core/gates-phase.ts` (`legalTools` reads the open-questions ledger, not the block) · `conductor/tests/continuation.test.ts:1216` (the test).

**The composed behavior, reproduced.** Same fixture as PROBE-A but the block is set with **no
accompanying question** (`store.setBlocked(runId,"I1",{reason,stage})` — `Item.blocked.questionId`
is optional, types.ts:244):

```
PROBE-B prompts: 0  stops: [null,null,null,null,null,null]
PROBE-B currentRun after passes: r-...  runState: EXECUTING   (NOT archived; pointer never cleared)
```

With no open question, `legalTools` offers no `conductor_answer`; `nextWave` is empty (I1 blocked,
I2 unready) so no `conductor_dispatch_wave`; the only offered tools are the UNIVERSAL meta set
(status/decide/surface/defer). So `positionSpecificTools(offered)` is empty → `actionable = false` →
the engine returns at the `if (!actionable)` guard (continuation.ts:897), emitting one `idle`
journal line and **prompting nothing**. The futile counter never moves, so `shouldTerminate`'s noop
path never fires, `blocked`/`surfaced` are structurally unreachable (open>0), and the run pointer is
never cleared. **The run sits in EXECUTING forever: can never exit, can never be detected, no
artifact ever reaches a human.** This is the exact C-085 shape §3.7 exists to end — the one shape it
still cannot see.

**The test enshrines it.** `[10.1-idle-null-recommendation]` (continuation.test.ts:1216) constructs
*precisely this fixture* (`setBlocked` with no question, I2 dependsOn I1) and asserts "prompts
NOTHING, leaves BOTH counters untouched." So the suite certifies the silent-wedge as correct
behavior — and it is strictly *worse* than the with-question path (PROBE-A's noop is at least
detectable and archived; this is invisible forever).

**Reachability.** I enumerated every `setBlocked` call site (tools.ts:1017, 2266, 3159, 3608, 3806,
4243, 4583; continuation.ts:449) — every production block mints a question first, and
`answerQuestion` clears the block *before* marking the question answered (clear-first, C-018/C-020),
so a crash cannot leave "block persists, question gone." So the state is **not reachable today**.
But two things make it a live landmine rather than a curiosity: (1) any *future* block site that
forgets to mint a question, or any reconciler-origin gap (SWEEP-CORRECTIONS-001 already shows the
`reconcileOrphanQuestions` origin filter leaves 5 of 7 block origins un-reconciled), reintroduces the
undetectable wedge — and this test will stay green over it; (2) the test documents the silent wedge
as the *intended* handling of "I1 BLOCKED, I2 dependsOn I1," when the production version of that exact
scenario (with a question) takes the different noop path — so the test gives false confidence that
the blocked-dependency shape is handled gracefully.

- **Fix direction:** the `actionable` guard should treat "unfinished items exist but the engine can
  offer no position-specific lever" as a *detectable* condition, not silence — e.g. count such passes
  toward a floor that eventually records a `blocked`/`env` stop with a report, so a wedge is never
  invisible regardless of how the blocked state arose. Re-point `[10.1-idle-null-recommendation]` to
  assert a detectable outcome, or add the accompanying question so the fixture matches production.

---

### COMPOSITION-003 — The `noop`-wedge is a recurring composition: item_review's red re-validate re-throws under the recommended remedy, burning the run to `noop` without ever arming DEBUG

- **Severity:** MEDIUM. **Pattern:** P7, same mechanism as COMPOSITION-001.
- **Subsystems in the seam:** `adapter/tools.ts` (`handleItemReview`/`revalidate` throws on a red
  re-validate; `conductor_validate` is offered only to GREEN items) · `core/gates-phase.ts`
  (`legalTools` recommends `item_review` for a VALIDATED item) · `adapter/continuation.ts` (noop).
- **Who filed the half:** TOOLS-HANDLERS-B-012 traced the throw and asserted "the run ends `noop`
  instead of entering DEBUG." I close the seam: the composed end-state is the *same* `noop` machinery
  COMPOSITION-001 reproduces. When a review fix regresses the full verify, `revalidate()` throws and
  the item stays VALIDATED; `legalTools` recommends `conductor_item_review` for a VALIDATED item
  (the only offered stage tool — `conductor_validate` is illegal for VALIDATED); so `recommended !==
  null` → `actionable=true` → the engine re-prompts "call item_review," which re-throws over the
  still-broken tree, the signature never changes, and after three futile passes the run records
  `noop` — having burned up to three full review fan-outs and never armed the DEBUG protocol that
  exists for exactly this failure. The escape hatch that *does* exist (publish's stale-freshness
  auto-reverify → demote to GREEN + debugging) is only reachable if the reviewers come back clean
  over a broken tree — i.e. the recovery path requires the reviewers to *fail at their job*.
- **Why it belongs to composition, not tools:** the throw (tools) is only a wedge because the gate's
  recommendation (core) points at the very tool that throws, and the continuation engine (adapter)
  converts a re-thrown recommendation into a `noop` rather than a DEBUG entry. No single lens owns all
  three. Not separately reproduced (the throw is inside item_review's fan-out); the noop machinery is
  reproduced in COMPOSITION-001 and the recommendation is confirmed by reading gates-phase.ts:133-134
  (`VALIDATED → ITEM_REVIEW`).
- **Fix direction (from B-012, endorsed):** on a red re-validate, demote to GREEN with `debugging`
  set (the publish precedent `demoteReviewedToGreen` is right there) instead of throwing, so the run
  enters DEBUG rather than wedging to noop.

---

### COMPOSITION-004 — The enforcement locus falls between two layers: meta tools and `conductor_classify` are guarded by NEITHER a mechanical phase gate NOR the advisory state block (which is dead code)

- **Severity:** MAJOR. **Pattern:** P7 — "two layers each believed the other owned this."
- **Subsystems in the seam:** `plugin/index.ts` (`runTool` enforces only arg shape + the session/
  edit/git gate) · `core/gates-phase.ts` (`legalTools` — the phase-order verdict — has exactly TWO
  production call sites, `requireStageTool` and `waveVerdict`, so it guards only the 6 stage tools +
  `dispatch_wave`) · `adapter/inject.ts` + `plugin/index.ts` (the §6.4 state-block injection that
  *would* carry the legal-tool verdict to the model is **never wired** — no hook registered).
- **Who filed the halves:** TOOLS-HANDLERS-A-001 (classify has no legality step; "legalTools' verdict
  is delivered solely through the injected state block — advisory prose, not enforcement").
  TOOLS-HANDLERS-B-001 (every meta handler skips the phase-order gate; reproduced defer-all →
  REPORTED/done). COMPOSITION-INJECTION-001 (the injection layer that would deliver the state block is
  entirely unwired — no session ever receives it). **No reviewer put the three together.**

**The composed hole.** The harness's design has two lines of defense against a model calling the
wrong tool: (1) a *mechanical* phase-order gate that denies illegal tools, and (2) an *advisory*
state block, injected every request, that tells the model which tool is legal/recommended. For the
six stage tools + dispatch_wave, line (1) is real (`requireStageTool`/`waveVerdict` call `legalTools`
and throw). For **every meta tool** (`classify`, `decide`, `surface`, `answer`, `defer`,
`queue_amend`, `inline_claim`, `override`, `report`, `status`) line (1) *does not exist* — none
routes through `legalTools` (confirmed: `legalTools` has exactly two call sites). The design's
compensating control for meta tools is line (2), the advisory block — and COMPOSITION-INJECTION-001
proves line (2) is dead code: no `experimental.chat.system.transform` hook is registered, so the
state block reaches no session, ever.

So a model driving a run has **neither** a mechanical gate on meta tools **nor** any injected signal
telling it which are legal. The only surviving channel that carries "which tool is legal" to the
model is the *continuation re-prompt*, which fires **only when the session goes idle** and names only
the tools the gate offered — it says nothing while the model is actively taking turns, and it never
covers `conductor_classify` (classify isn't in `legalTools`' meta set at all once past INTAKE). The
concrete consequences are the already-filed reproductions, now understood as one composition:
`conductor_classify` on an advanced run clobbers state and jumps FSM edges §3.1 lacks (A-001, R1
reproduced); defer-all at DECOMPOSED closes a run `done` skipping PLANNED/PLAN_REVIEWED/EXECUTING
(B-001, reproduced); `inline_claim`/`queue_amend`/`override` operate on terminal runs (B-001-R2,
reproduced). Each is "a meta tool the model can call at a position the phase gate would forbid — if
the phase gate covered meta tools, and if anything told the model it was forbidden."

- **Fix direction (unifies A-001 + B-001):** one `requireMetaTool(tool, store, runId)` choke point in
  `runTool` that consults `legalTools` exactly as `requireStageTool` does, so the *mechanical* line of
  defense covers meta tools regardless of whether the advisory channel is ever wired. This is the
  single structural fix the three findings point at from three directions.

---

### COMPOSITION-005 — The double-writer → evidence-seq-collision → wrong-record-publish chain: three subsystems each assume single-writer, and nothing checks it

- **Severity:** MEDIUM (the entry condition is itself a set of filed defects; the chain is the new part).
- **Pattern:** P7 — a cross-subsystem chain where each link is individually filed and the *composition* is the reachable corruption path.
- **Subsystems in the seam:** `adapter/state.ts` (the `readOnly` flag has zero consumers; stale-lock
  break is a TOCTOU) → `adapter/evidence.ts` (`nextSeq` is read-max+1, no cross-process guard, and
  `evidence.jsonl` is per-RUN, shared by every item) → `adapter/tools.ts` (`readEvidenceAt` and
  publish resolve a verify record by seq alone, never checking `itemId`/`tree`).
- **Who filed the links:** STATE-CRASH-001 (readOnly guards 2 of ~12 mutating methods; nothing
  consults the flag), -002/-003 (double-writer states reachable via stale-lock TOCTOU and
  release-deletes-foreign), -005 (nextSeq collides across processes), -006 (publish resolves by seq,
  never checks itemId/tree). The state-crash reviewer filed -005/-006 as "conditional on 001/002" and
  pointed the publish half to the enforcement lens. **The composition — that the double-writer the
  lock fails to prevent flows through the un-guarded seq into a publish that ignores record identity —
  crosses state → evidence → tools and is owned by no single lens.**
- **The chain:** two conductor processes sharing one workspace (reachable: 001 lets a "read-only"
  second session's handlers still write; 002/003 let two writers both hold the lock) both call
  `runVerify`/`runTest` → `appendEvidence` → `nextSeq`, both read the same max, both mint the same
  seq. Now two records share a seq. `readEvidenceAt` returns the *first* match and publish's step-1
  checks only `record.head`, never `record.itemId` or `record.tree` — so `item.evidence.validated.seq`
  can resolve to the *other* item's/session's verify record, and publish ships one item's green on
  another's verify. The codebase already applies the itemId filter for *red* evidence
  (`capturedRedOf`) and omits it for validated/green — an inconsistency that is invisible until the
  double-writer state (which the lock is supposed to make impossible, and doesn't) is reached.
- **Not reproduced** (would require staging the two-process harness end-to-end; the state-crash
  reviewer reproduced the double-writer reachability and the seq computation separately). Filed as a
  composition because the *reachability* (STATE-CRASH-001/002/003) and the *consequence*
  (STATE-CRASH-005/006) live in different subsystems and neither reviewer connected them into the
  single corruption path.
- **Fix direction:** the primary defense is single-writer (fix 001/002/003 — an OS `flock` held for
  the process lifetime, per the state-crash cross-lens pointer). The cheap defense-in-depth that
  closes the *composition* regardless: `readEvidenceAt`'s security-relevant callers (publish step 1,
  the validated/green resolution) assert `record.itemId === itemId` and, in worktree mode,
  `record.tree === expectedTree` — the exact check `capturedRedOf` already applies to red evidence.

---

### COMPOSITION-006 — Two members of the closed §2.9 stop vocabulary — `blocked` and `surfaced` — are computed by core but written by NOTHING: the honest "waiting on a human" dispositions are structurally unreachable (this is the ROOT of COMPOSITION-001)

- **Severity:** MAJOR (a closed vocabulary with two dead members means every run that *should* end
  `blocked`/`surfaced` is silently mislabeled `done` or `noop` — the report a human relies on cannot
  tell "the run succeeded" from "the run is stuck waiting on me").
- **Pattern:** P7 in its purest form — three individually-correct components compose so that two
  closed-vocabulary values can be *computed* but never *recorded*.
- **Subsystems in the seam:** `core/stops.ts` (`shouldTerminate` computes `blocked`/`surfaced`) ·
  `adapter/continuation.ts` (records only `noop`/`interrupt`/`env`; explicitly declines the rest) ·
  `adapter/tools.ts` (`handleReport` hardcodes `kind:"done"`; the override hatch records `env`).

**The enumeration (charter method — every terminal path, who writes it).** I traced every write to
`run.stop` in non-test source. The complete set of stop-kind literals ever recorded:

| Stop kind (§2.9 STOP_KINDS) | Written by | Where |
|---|---|---|
| `done` | `handleReport` — **hardcoded**, never conditional | tools.ts:7647-7648 |
| `noop` | continuation engine (futile re-prompt limit) | continuation.ts:857 |
| `env` | continuation (send-failure floor) · override exhaustion | continuation.ts:1008 · tools.ts:7907 |
| `interrupt` | continuation (halt file present) | continuation.ts:796 |
| **`blocked`** | **NOTHING** | — |
| **`surfaced`** | **NOTHING** | — |

`shouldTerminate` (stops.ts:129-131) *computes* `{stop:true, kind:"blocked"}` and `{...kind:"surfaced"}`
— but its ONLY consumer is the continuation engine (verified: `shouldTerminate` has one call site,
continuation.ts:843), which records only `noop` and carries on for every other kind (its own comment,
870-872: "Every OTHER kind shouldTerminate can return belongs to another recorder: blocked/surfaced/
done to conductor_report … This engine writes nothing for them and carries on"). And the recorder it
delegates to — `handleReport` — never consults `shouldTerminate` and hardcodes `done`. So the delegation
chain is a ring with no writer: continuation says "report owns blocked/surfaced," report writes only
`done`. **Neither `blocked` nor `surfaced` is ever written to any run's `stop` field.**

**Confirmed by the test topology, not just by grep.** The only tests that mention these kinds are
`stops.test.ts` (which asserts the *pure* `shouldTerminate` RETURNS them — the computation, in
isolation) and `tools-9.5c.test.ts:925/944` (which *hand-fabricates* a run whose `stop` is already
`{kind:"blocked"|"surfaced"}` to exercise the stop-report *renderer*). No test drives a real handler
or the real engine to *produce* a `blocked`/`surfaced` stop, because no code path can. The renderer is
ready for them; nothing feeds it.

**Why each component is individually right (the composition, not any one part, is the defect).**
- `stops.ts` correctly computes `blocked`/`surfaced` — they are real §2.9 dispositions and the pure
  rule owns the closed vocabulary.
- The continuation engine correctly records only `noop`/`interrupt` — §2.9:900-905 assigns
  blocked/surfaced/done to the report tool, so the engine deferring them is faithful to the spec.
- `handleReport` recording `done` is defensible for the all-published case.

The hole is the seam: the engine defers `blocked`/`surfaced` to a report tool that never records them,
and the report tool is only reachable when `settledForReport` is true (all items PUBLISHED/blocked/
deferred-or-stuck) — at which point it stamps `done` regardless of whether the settled items are
*published* (success) or *blocked* (waiting on a human). So:
- A run where every remaining item is **blocked** reaches report (blocked = settled) → stamped
  **`done`**, "the run completed," even though nothing was published and every item is waiting on a
  human answer. (This generalizes TOOLS-HANDLERS-B-010's "done on a blocked-laden run.")
- A run with a **blocked item that has a dependent** cannot even reach report (the dependent is
  unsettled, not stuck) → ends **`noop`** (COMPOSITION-001).

Either way the two honest kinds are unreachable, and the report a human reads misdescribes a
waiting-on-me run as either finished or futile-wedged.

**This is the root of COMPOSITION-001.** CORE-LOGIC-006 observed "the only reachable computed stop is
`noop`, never blocked/surfaced" for the dependent case but framed it as an open-count conflation. The
composition-wide truth is stronger and simpler: **`blocked` and `surfaced` have no writer at all**, in
any run shape. Fixing COMPOSITION-001 (make the dependent case reach a `surfaced` stop) is impossible
without first giving `blocked`/`surfaced` a writer — which is this finding.

- **Fix direction:** give `handleReport` (or a dedicated closer) a stop-kind selection that consults
  the settled dispositions: if every settled item is published → `done`; if any remaining item is
  blocked and none is open → `blocked`; if human-territory questions are pending → `surfaced` — i.e.
  record the kind `shouldTerminate` already knows how to compute, instead of hardcoding `done`. The
  renderer (tools-9.5c) is already built for both kinds; only the writer is missing.

---

## Terminal/exit-path walkthrough table

For every terminal/exit/escalation path, the state where each guard says "not mine" and who is left
holding it. This is the charter's core method; the table is the completeness forcing function.

| Exit path | Reachable? | Who records it | The "not mine" composition | Verdict |
|---|---|---|---|---|
| `done` (all published) | yes | handleReport (hardcoded) | — | sound |
| `done` (all blocked/deferred, none published) | yes | handleReport (hardcoded `done`) | report stamps `done` over a run that published nothing and is waiting on humans; §2.9 wanted `blocked` | **COMPOSITION-006** / B-010 |
| `blocked` (§2.9) | **NO** | nothing | stops.ts computes it; continuation defers to report; report writes `done` | **COMPOSITION-006** |
| `surfaced` (§2.9) | **NO** | nothing | same ring; renderer ready, no writer | **COMPOSITION-006** |
| `noop` (futile wedge) | yes | continuation | fires for legitimately-waiting runs (blocked item + dependent), not just true wedges; then archives → unresumable | **COMPOSITION-001** |
| `noop` (item_review red re-validate) | yes | continuation | recommended remedy re-throws; DEBUG never armed | **COMPOSITION-003** |
| `noop` (worktree publish "nothing to commit") | yes | continuation | merge-conflict recovery re-denies forever | TOOLS-HANDLERS-B-009 (confirmed noop) |
| `env` (override exhausted) | yes | tools/override | honest use of the hatch with a misspelled gate burns budget → env-stop | TOOLS-HANDLERS-B-002 |
| `env` (send-failure floor) | yes | continuation | sound (bounds a dead transport) | sound |
| `interrupt` (halt file) | yes | continuation | sound | sound |
| SILENT (no stop, EXECUTING forever) | reachable only via block-without-question | nobody | `actionable=false` guard; test blesses it | **COMPOSITION-002** |
| meta tool at illegal position (classify/defer/report/inline_claim on wrong state) | yes | no gate | no phase gate on meta tools + dead advisory channel | **COMPOSITION-004** / A-001 / B-001 |

---

## Handoff assumption table

For each cross-subsystem handoff: what the caller assumes the callee does, what the callee actually
guarantees, and whether anything checks the assumption. A gap here is a P7 seam.

| Handoff A → B | A assumes | B guarantees | Checked? | Finding |
|---|---|---|---|---|
| continuation → conductor_report (for blocked/surfaced) | report records the honest stop kind | report hardcodes `done` | no | COMPOSITION-006 |
| stops.ts shouldTerminate → its consumer | some recorder writes blocked/surfaced it computes | only continuation consumes; it records neither | no | COMPOSITION-006 |
| plugin runTool → handlers (meta tools) | phase-order gate already refused illegal calls | no meta tool routes through legalTools | no | COMPOSITION-004 |
| the enforcement design → injection layer | the state block tells the model what's legal | injection layer is never wired (no hook) | no | COMPOSITION-004 / COMP-INJ-001 |
| fanout registry → gates-edit (main mode) | the registered `tree` is a path the gate can normalize | fanout registers the slug "main" | no | COMP-INJ-005 (reproduced elsewhere) |
| classifyTool → editPath derivation | a "write" tool's path is derivable as filePath/path | apply_patch carries paths in the body | no | GATES-SEC-007 / COMP-INJ-011 |
| registry gate → handlers | a registered caller's *role* is checked before a `conductor_*` call | handlers check phase, not caller role | no | COMP-INJ-009 |
| plugin deps bundle → handleReport | `metrics` is composed so the report can carry router metrics | deps omits `metrics` | no | FANOUT-CONC-001 |
| abandonment fence → stage writers | fencing StateStore stops all state writes | evidence/questions/decisions/fanout bypass the store | no | TOOLS-A-005 / TOOLS-B-014 |
| publish step-1 → evidence resolution | `validated.seq` names THIS item's/tree's verify | readEvidenceAt matches seq only | no | STATE-CRASH-006 / COMPOSITION-005 |
| answerQuestion (human resume) → the run | answering revives a blocked/surfaced run | a noop-archived run is never re-driven | no | COMPOSITION-001 |
| chat.headers → llama-router | conductor tags carry priority/group/schema | no chat.headers hook; router sees nothing | no | COMP-INJ-001 → CPP-ROUTER (G5 trivialized) |

---

## Reproductions log

All reproductions drove the **real** modules (no mutation of committed source; the one scratch test
file was written under `conductor/tests/` for relative-import resolution, run with
`node --test --test-reporter=tap` to READ behavior — never for a verdict — then deleted). Tree
verified clean afterward (`git status --porcelain` shows only the two review deliverables); no stray
processes.

| Ref | Scenario (real `handleSessionIdle` + real store + core) | Observed | Closes |
|---|---|---|---|
| PROBE-A | EXECUTING; I1 RED blocked WITH open human question Q1; I2 PENDING dependsOn I1; 6 idle passes past debounce, state unchanged | `prompts: 3, stops: [null,null,null,"noop",...]`; `currentRun → NULL (archived)`; post-answer `clearedItemIds:["I1"]` but `I2.state: PENDING`, `runFinal.stop.kind: noop` | COMPOSITION-001 (noop + lost resume) |
| PROBE-B | same fixture but block set with NO question (the `[10.1-idle-null-recommendation]` shape) | `prompts: 0, stops: [null×6]`; `currentRun → r-... (NOT archived), runState: EXECUTING` — silent forever | COMPOSITION-002 (silent undetectable wedge) |
| STOP-WRITERS | repo-wide enumeration of every `run.stop =` / `recordStop` writer in non-test source | writers emit only `done` (report), `noop`/`env`/`interrupt` (continuation), `env` (override) — **`blocked`/`surfaced` written nowhere** | COMPOSITION-006 |
| LEGAL-SITES | enumeration of `legalTools` production call sites | exactly 2 (`requireStageTool`, `waveVerdict`) — no meta tool phase-gated | COMPOSITION-004 |
| DEFER-ESCAPE | read `cannotEverPublish` (seeds deferred, propagates to dependents) + `settledForReport` | deferring the blocking item makes report legal → clean `done`; the honest wait → `noop` | COMPOSITION-001 (incentive gradient) |

---

## Cleared seams

Seams I attacked at the composition level and found sound, with the attack named:

- **The deferred-dependency exit.** I suspected a dependent of a *deferred* item would wedge like the
  blocked-dependency case. It does not: `cannotEverPublish` seeds deferred items (gates-phase.ts:196)
  and propagates "stuck" to their dependents (line 202), so `settledForReport` returns all-settled →
  `conductor_report` becomes legal → `recommended = REPORT` → the engine re-prompts to close and the
  run ends cleanly. The design's own comment (176-187) explains exactly this. Cleared — the deferred
  case is the *correctly* handled sibling of the blocked case, which sharpens (not weakens)
  COMPOSITION-006: the machinery to reach a report exit for a "can-never-publish" chain exists; it is
  only the blocked-dependency and the stop-*kind* selection that fall through.
- **The lone-blocked-item exit.** A blocked item with NO dependent makes report legal (blocked =
  settled) → the run reaches report and closes. (It closes `done` rather than `blocked` — that is
  COMPOSITION-006 — but it does not silently wedge.) Cleared as a wedge; retained as a mislabel.
- **The silent-wedge production reachability.** I enumerated all 8 `setBlocked` sites and confirmed
  every production block mints a question first, and `answerQuestion` clears the block *before*
  marking the question answered (clear-first, so a crash cannot strand a block past its question). So
  COMPOSITION-002's exact state is not reachable via normal blocking today — I filed it as a
  test-enshrined *latent* landmine rather than a live wedge, and said so.
- **The universal-meta-tools derivation (C-086).** I verified `UNIVERSAL_META_TOOLS` is derived by
  probing `legalTools` under both publish modes and intersecting — the continuation engine's
  `positionSpecificTools` reads the real gate, not a hand copy. So the actionability decision I
  reproduced is faithful to production. Cleared.
- **The futile-counter accounting under the composition.** PROBE-A confirmed the counter climbs
  1→2→3 only while the signature is unchanged, and a state change would reset it — so the noop is not
  a false wedge; the run genuinely made no progress across three prompts. The `noop` firing is
  correct *mechanics*; the defect is that this shape has no *better* disposition available
  (COMPOSITION-006). Cleared as a mechanics question.

---

## CROSS-LENS POINTERS

- **MACRO (R2) — the stop-vocabulary is over-specified for the recorders that exist.** §2.9 defines 6
  stop kinds; the composed system can write 4. Whether `blocked`/`surfaced` should exist as separate
  kinds, or the report closer should learn to write them (COMPOSITION-006), is a design-coherence
  question: the vocabulary and its writers drifted apart.
- **MACRO (R2) — the enforcement locus is diffuse.** COMPOSITION-004: there is no single choke point
  where "is this tool legal now?" is asked; stage tools go through `requireStageTool`, meta tools go
  through nothing, and the advisory backstop is unwired. A `requireMetaTool` in `runTool` is a
  structural simplification (one gate, all tools) the macro review should weigh.
- **CAPABILITY (R3) — the honest "waiting on a human" disposition is a missing mechanism.** For an
  unattended run, the difference between "done," "waiting on you," and "wedged" is the single most
  load-bearing signal a returning operator needs; the composed system collapses all three onto
  `done`/`noop`. A `surfaced`/`blocked` closer + a resumable-after-stop path (COMPOSITION-001/006)
  would raise the floor on operator experience more than any single gate.
- **CAPABILITY (R3) — the incentive gradient.** COMPOSITION-001's defer-escape (clean `done`) vs
  honest-wait (`noop`, work lost) means the doctrine's "ask a human" guidance is *penalized* by the
  mechanics. Any doctrine-efficacy analysis must account for the harness structurally rewarding the
  lazy exit.
- **R1 (enforcement) — COMPOSITION-004 is the unification of A-001 + B-001.** Both filed "no legality
  step" for classify/meta tools independently; they are one hole (no meta-tool phase gate) with one
  fix. The enforcement register should treat them as a cluster, not three findings.
- **R1 (state/crash) — COMPOSITION-005 is the composed corruption path** the state-crash reviewer's
  001/002/005/006 imply but did not chain. The cheap defense-in-depth (itemId/tree check in
  readEvidenceAt's callers) closes the composition even before the single-writer fix lands.
- **R1 (fanout) — the noop-wedge is the common terminal for four separate defects** (COMPOSITION-001,
  -003; B-009; the idle-engine liveness holes FANOUT-CONC-005/010/011). The fanout register's
  liveness findings and these gate-composition findings share one sink: a run that cannot progress
  ends `noop` (or silent), never `blocked`/`surfaced`. Worth noting the shared root when planning.

---

## IDEA register

### IDEA-COMP-1 — A single `run.stop` writer/closer
Origin: COMPOSITION-006 — four writers across two files each stamp a stop kind, and two kinds have no
writer. Kind: architecture / correctness-hygiene. Value: one closer that computes the kind from the
settled dispositions makes the closed vocabulary exhaustive-by-construction and removes the
"blocked/surfaced belong to someone else" ring. Cost: medium. Relates to: COMPOSITION-001/-006.

### IDEA-COMP-2 — A composition test that asserts every non-terminal wedge shape reaches a *recorded* stop
Origin: COMPOSITION-002 — `[10.1-idle-null-recommendation]` blesses a silent-forever state. Kind:
test-maintainability. Value: a property test — "for every reachable EXECUTING position with unfinished
items, N idle passes produce either progress or a recorded stop" — would have caught the silent wedge
and would guard against any future block path that reintroduces it. Cost: medium. Relates to:
COMPOSITION-002.

### IDEA-COMP-3 — Name the stop kind in `conductor_status` and the re-prompt
Origin: reproducing COMPOSITION-001. An operator (or the model) never learns "this run is waiting on
a human" vs "wedged" — both read as idle. Surfacing the *intended* disposition would make the
mislabel visible before archival. Kind: observability. Cost: small. Relates to: COMPOSITION-001/-006.

---

## Coverage ledger

| Area | What I did | Coverage | Conclusion / ids |
|---|---|---|---|
| All 16 prior part files | Read in full; harvested every cross-lens pointer naming another subsystem | 100% | seam-lead map (top of file) |
| `adapter/continuation.ts` (1,382 ln) | Read the idle engine (763-1054), helpers (588-760), reconciler (399-466), cleanup (472-526) in full; drove real `handleSessionIdle` (PROBE-A/B) | high (the §3.7 engine end to end) | COMPOSITION-001/-002/-006; confirmed actionability + noop + archive |
| `core/gates-phase.ts` (467 ln) | Read `legalTools` EXECUTING branch, `cannotEverPublish`, `settledForReport`, `isSettled`, `depsReady` in full; call-site census | high | COMPOSITION-006 root; cleared deferred-dependency exit; COMPOSITION-004 (2 call sites) |
| `core/stops.ts` | Read `shouldTerminate` + STOP_KINDS in full | full | COMPOSITION-006 (blocked/surfaced computed, unrecorded) |
| `adapter/tools.ts` (report + stop writers) | Read `handleReport` close (7615-7680), override stop (7907), enumerated every `run.stop=`/`recordStop`; `legalTools`/`requireStageTool` census | targeted (the stop-writer + legality seams) | COMPOSITION-006 (`done` hardcoded); COMPOSITION-004; COMPOSITION-003 (via B-012 + gates-phase read) |
| `adapter/questions.ts` | Read `appendQuestion`/`answerQuestion` (clear-first order) | targeted | COMPOSITION-002 reachability bound |
| `conductor/tests/continuation.test.ts` | Read harness helpers (462-660), `[10.1-idle-null-recommendation]`, `[10.1-noop-after-three-futile]`; built the reproduction on this pattern | targeted | COMPOSITION-002 (test enshrines silent wedge) |
| State→evidence→publish chain | Read STATE-CRASH-001/002/005/006 + `readEvidenceAt`/`capturedRedOf` seams via prior parts + grep | reasoning | COMPOSITION-005 (chained from filed halves, not separately reproduced) |
| Injection/meta seam | Read COMP-INJ-001, A-001, B-001 + confirmed 2 `legalTools` call sites | high | COMPOSITION-004 |
| NOT re-examined (owned by prior lenses, consumed as contracts) | router C++, shell/git gates, fanout internals, scripts, the 22-tool inventory, the acceptance rows | — | I consumed the sixteen parts' verdicts rather than re-deriving; my scope is only the seams between them |

**Note on the mandate (briefing §5.1):** the composition lens is not box-ticking here — the
terminal-path enumeration produced COMPOSITION-006 (the unrecorded stop kinds) directly, which no
single-subsystem audit surfaced, and the reproduction closed the CORE-LOGIC-006 seam the pure-core
reviewer explicitly could not. The lowest-yield stretch was re-confirming already-filed halves
(COMPOSITION-003/-005); I filed those as compositions with citations rather than re-reproducing what
the owning lenses already demonstrated.
