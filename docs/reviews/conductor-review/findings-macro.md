# Conductor Review — Step 3: MACRO Findings (merged)

**Date:** 2026-08-16
**Reviewer:** step-3 macro composition/merge agent, reconciling four part files in
`docs/reviews/conductor-review/parts-macro/` (navigability.md, layering-coherence.md,
process-and-docs.md, fitness-forward.md — 3,215 lines total, each read in full) against the step-2
evidence base (`findings-enforcement.md`, 2,303 lines, read in full). Full prose evidence lives in
the part files; entries here carry the merged verdict, one reconciled severity/confidence standard,
and the origin part-id(s). Contested facts between parts were re-measured this session (see MERGE
NOTES §M.3). Provenance note: the review harness blocks subagent file writes, so this document was
returned as the merge agent's output for the orchestrator to place at
`docs/reviews/conductor-review/findings-macro.md`.

**Severity standard (reconciled):** **BLOCKING** = on the critical path of the scheduled next work
(13.2, 14.2, Phases 16–19); leaving it unchanged breaks or invalidates a scheduled task. **MAJOR** =
will keep producing defect classes if unchanged (recurred ≥3 times, or produced a step-2 CRITICAL).
**MEDIUM** = real structural cost, contained blast radius. **OPINION** = no measurement, no
≥3-correction pattern, no step-2 defect as cause — ranked last, per the charter.
**Confidence:** HIGH = measured/verified this review or reproduced by step 2; MEDIUM = argued across
a seam with verified components.

---

## 1. Executive verdict

**The mechanical core is sound; the shape around it is what keeps manufacturing the defects step 2
found.** Measured directly: the G3 layering is *perfectly* held — core imports only core, zero I/O
or clock in any of 17 core files, no dependency inversions after 92 corrections — and the
enforcement spine (FSM edges, RED/GREEN re-derivation, publish integrity, the override budget)
binds under mutation. That is real and worth protecting.

Five structural factories account for the great majority of the 92 corrections and the 138 step-2
issues, and every one is still running at HEAD:

1. **The composition seam has no contract** (MACRO-001/-002/-003/-004). ~22 instances of
   "built-on-one-side, never-connected-or-fed-literals-on-the-other" — including **both step-2
   CRITICALs** (the dead §6.4 injection layer; the default-mode write lockout). Nothing verifies
   hook completeness, fact derivation, or wiring; the §8 manifest never scheduled wiring as work.
2. **Subject-selection by open-ended enumeration** (MACRO-009/-016). 23% of all corrections are
   "a check that inspects less than it appears to"; six are one scanner's file-set alone; the class
   is live in the audit layer built to catch it (ISSUE-088). In the gate layer the same split is
   measurable as security posture: 0 reproduced bypasses on deny-by-default surfaces, 6+ on
   enumeration surfaces.
3. **The organisation violates the system's own small-model thesis** (MACRO-010/-012/-013/-026).
   `tools.ts` is ~93k tokens (3.9× a 32k reader's budget); the build's own machinery could not read
   it; growth lands by construction in the audits' blind span; a one-word vocabulary change touches
   6 files in 3 languages with no derivation; the build record needs ~41k tokens before one source
   file is opened. Safety knowledge is positional, not indexed.
4. **Disposition and incentive are under-modeled** (MACRO-005/-006/-007). Every recorded wedge
   lives in a disagreement between per-consumer "is this item finished?" predicates; two of six
   stop kinds have no writer; the cheapest full-run escape (defer-all) is free, untainted, and
   forges human provenance while honest waiting loses work. The lazy path is the cheap one — a
   thesis-level incoherence.
5. **The record and process layers are exempt from the system's own re-derive thesis**
   (MACRO-017/-018/-019/-021/-023). Gate ledgers stop at task 11.8, refutations are one unaudited
   line (two audited refutations were wrong, one sealed — P10), obligations recorded in prose
   measurably fail to land (2 lost : 1 landed), and the operator docs' behavioral layer is false in
   ten verified places while its drift guard is green — one anchor row *pins* a falsehood.

**Fitness for what comes next: the sequencing is wrong.** Both CRITICALs are live-contact-only
defects; 13.2 as scheduled will spend its live budget rediscovering the step-2 register; 14.2 will
fail on launch mechanics (PATH-less cells), fail acceptance on a path conflict even if flawless,
and its headline comparison is inverted at HEAD (the conductor arm delivers *less* doctrine than
the doctrine arm it must superset). Roughly six fixes — ISSUE-001, -002, -065, -078, -088, -107 —
are on the critical path of everything scheduled, and no document orders them
(MACRO-028/-029/-030, IDEA-FWD-6).

**Confidence: HIGH** on the register (every entry carries a measurement, a ≥3-correction pattern,
or a step-2 reproduced defect as cause; zero entries had to be downgraded to OPINION beyond the
three the parts self-labelled). The two things that most affect confidence: **no live run has ever
occurred** (all doctrine-efficacy and several navigability claims are counterfactual until 13.2),
and the full gate is nondeterministically red on unmutated HEAD (ISSUE-134), so inherited
full-gate verdicts are distribution samples.

---

## 2. The MACRO register

### Theme A — The composition seam (the dominant defect factory)

#### MACRO-001 — The composition seam is the system's dominant defect factory, and it has no contract
**MAJOR · HIGH · origin LAYERING-COHERENCE-001 + LAYERING-COHERENCE-009 (merged)**
**OBSERVATION.** The pure-core/thin-adapter/composition-root design splits every enforcement
decision three ways (core: rule; adapter: assembly; plugin: facts), and each crossing is an
obligation existing only as convention. Counted across the record: **14 corrections** (C-032 F5,
C-035, C-037 r.1/r.4/r.5/r.6, C-044, C-047, C-050, C-053, C-059, C-082, C-084/085, C-086b) **plus
≥8 live step-2 issues** (ISSUE-001, -002, -022, -030, -038/-039, -043, -065) are one family:
*built correctly on one side of a seam; the obligation to connect it or feed it real facts lived in
no task, no type, no test*. The family includes **both CRITICALs**. The composition root itself
(plugin/index.ts, 1,427 ln, read in full by the layering part) carries the largest obligation
surface in the system (22 tool bindings + 7 hook kinds + ~8 per-call fact derivations) and the
smallest verification surface: nothing compares the returned hook keys to a required set — the
omission class has struck twice (C-059: `chat.message` missing for 40 tasks; ISSUE-001: all three
§6.4 hooks missing at HEAD), and C-059's own proposed detector was recorded "now worth having" and
never built. Two literal-instead-of-derivation defects sit at the same call site one field apart
(C-082's fixed scope literals; ISSUE-022's live `runActive: true`), and `sameTree` (plugin:829)
re-derives gates-edit.ts:196-198's comparison coupled by comment only.
**CONSEQUENCE.** The shipped default configuration can neither deliver doctrine to any session nor
accept any sub-session write, while 1,382 tests stay green. Historically: a freeze that could never
fire, a gate with three unreachable arms for the whole build, a run-creation path absent from
production for 40 tasks.
**WHY STRUCTURAL.** Every instance was individually fixed, and the family recurred ~22 times under
the most correction-hungry process on record, because the seam has no verification surface: a
literal type-checks identically to a derivation; hook-registration completeness is checked nowhere;
building and wiring are separate obligations and the manifest only scheduled building. The
attempted refutation (that the instances trace to unrelated causes) fails: the family splits
cleanly into "never-wired module" and "literal where a derivation belongs", and one mechanism
covers each half.
**BETTER SHAPE.** (1) A **wiring manifest with a completeness test**: core declares the hooks the
plugin must register, the adapter modules that must be reachable from plugin/index.ts, and the stop
kinds that must have a writer; one test compares the constructed plugin against it (~1 day; catches
C-059, ISSUE-001, ISSUE-065's class outright). (2) **Facts as a typed bundle**: one exported
`deriveGateFacts(store, registry, sessionID): GateFacts` in the adapter, unit-testable without
opencode; the plugin passes the bundle, not eight loose primitives (~1 day; kills the
C-082/ISSUE-022 shape by construction). (3) Cross-language facts get the regeneration step in the
consumer's build (ISSUE-043's promised CMake step).
**PLAN IMPACT.** None to the plan's text; the §8 lesson (wiring tasks are first-class tasks)
belongs in whatever plans remaining work.
**WOULD CHANGE MY MIND.** Evidence the family count is inflated — the refutation was attempted and
failed (see origin part for the full argument).

#### MACRO-002 — The build shape deferred integration and live truth to the end; every integration-truth defect ships as a surprise
**MAJOR (BLOCKING for future subsystems) · HIGH · origin PROCESS-AND-DOCS-002 + FITNESS-FORWARD-001 (merged)**
**OBSERVATION.** The §8 manifest builds modules bottom-up and defers all composition to task 13.1
and all live contact to 13.2/14.2. Cluster C of the correction clustering (§3 below): 9
corrections with the highest severity-per-entry, culminating in the terminal instance step 2 found —
the entire §6.4 injection layer dead because no task registered the hooks. C-044 diagnosed the cost
*mid-build*, precisely, and the build paid it anyway because the manifest is immutable and no task
owned wiring. On the live side: the e2e fake SDK writes fixture files directly (no e2e row asserts
an ALLOW through the real gate, ISSUE-091); composition-root tests give every item a worktree, so
the shipped default is composed by no test; two CRITICALs plus four HIGHs (ISSUE-105–108) are
live-contact-only.
**CONSEQUENCE.** Already paid twice (inert product for ~40 tasks, C-044/C-059; dead injection at
HEAD). Prospectively: any addendum subsystem (four are scheduled) will again be built green against
fakes for ~12 tasks before anything live touches it.
**WHY STRUCTURAL.** Fixing ISSUE-001/-002 does not fix the shape. The one place wire-level
verification happened early (Task 0.2's wire-notes) is precisely why the hook API's availability
was known even while nothing used it — the counterexample that proves the mechanism.
**BETTER SHAPE.** Two complementary mechanisms: (a) **walking-skeleton ordering** for future work —
composition root first, every task extends a live path, plus a standing per-task audit row "every
new export has a production caller or names its wiring task" (~50-line import-graph script);
(b) a **standing live-ish gate leg** — a real opencode process against a 50-line stub
OpenAI-compatible provider, driven once per gate run through plugin load → hook registration → one
gated ALLOW write → one doctrine-bearing request captured at the stub. Needs no model; would have
gone red on ISSUE-001, ISSUE-002, and ISSUE-091's gap on the day each was introduced (+~10s gate
wall-clock).
**PLAN IMPACT.** Re-sequence: land ISSUE-001/-002 (+ -105/-107) fixes as ordinary reviewed tasks
*before* 13.2. The Phases 16–19 addendum should adopt the ordering rule explicitly.
**WOULD CHANGE MY MIND.** A committed in-process test that drives the real plugin's returned hooks
and asserts a system transform reaches a captured request, shown cheap and sufficient — that would
downgrade the live-leg half to ISSUE-091's fix direction.

#### MACRO-003 — "Tree" is one string type carrying two meanings; the class struck three times after being named
**MAJOR · HIGH · origin LAYERING-COHERENCE-003**
**OBSERVATION.** evidence.ts's `tree` is an item-id SLUG; gates-edit.ts's `tree` is a filesystem
PATH. C-037 ruling 5 named the duality "architectural" ("No committed code maps between them") and
minted a translator. It recurred anyway: C-053 (four job builders hardcoded `tree: STAGE_TREE`),
then ISSUE-002 (CRITICAL: fan-out registers the slug `"main"`, the gate compares it as a path,
every default-mode sub-session write denies). Three independent authorship events across three
files; the composition root's own comments narrate the duality twice and the seam was still misfed.
**CONSEQUENCE.** The default configuration cannot do work with a real model.
**WHY STRUCTURAL.** Both sides are `string`; the compiler is indifferent; every new dispatch site
must *remember* to translate; worktree-mode fixtures hide the failure. Fixing ISSUE-002 fixes the
fourth instance and nothing prevents the fifth.
**BETTER SHAPE.** Two types: carry `{treeSlug, treePath}` pairs on FanoutJob/RegistryEntry with
translation at one construction site, or nominal branding (`TreeSlug`/`TreePath`). ~15 mechanical
sites, no behavior change; the ISSUE-002 fix is the natural first step.
**PLAN IMPACT.** None. **WOULD CHANGE MY MIND.** Nothing about the facts; only if the three
instances were shown to be one copy-paste origin — they are not.

#### MACRO-004 — "May this tool run now?" has three mechanisms and no owner, and the FSM API trusts callers to say where the run is; every new meta tool re-rolls the defect
**MAJOR · HIGH · origin LAYERING-COHERENCE-002 + FITNESS-FORWARD-006 (legality facet, merged)**
**OBSERVATION.** Measured (re-verified this session): `legalTools` has exactly **4** production
call sites — `requireStageTool` (tools.ts:2621), `waveVerdict` (:5154), a synthetic-position probe
(continuation.ts:662), and dead code (inject.ts:117, ISSUE-001). So legality is answered by:
per-handler discipline (6 of 18 tool bindings), the dispatch verdict, an advisory state block that
was never delivered, and *nothing* for the 11 meta tools + classify (ISSUE-005, reproduced three
ways). Separately, core's `legalRunTransition(from, to, ctx)` lets the caller supply `from`: five
call sites pass `run.state`; `handleReport` (tools.ts:7640, verified) passes the literal
`"EXECUTING"`, and the adjacent journal line hardcodes the same — the FSM is bypassed *and the
journal lies about the edge taken*. Growth multiplies it: each new meta tool (the addendum's
`conductor_clarify` is next) must hand-roll its own when-callable check.
**CONSEQUENCE.** Reproduced: `done`/REPORTED from DECOMPOSED; classification-shopping resets a
GREEN item; G8 edit permission reopened on a terminal run.
**WHY STRUCTURAL.** A discipline applied 6/18 times, one application fed a literal, and the
designed compensating layer (the state block) does not exist — P7 at the design level. The concern
is smeared across four files, none the owner.
**BETTER SHAPE.** One `requireToolLegal(tool, store, runId)` consulted in `runTool` for every
`conductor_*` name (step 2's fix, endorsed as the structural simplification and as a *growth*
mechanism: new tools declare legality in a table). Plus change the FSM surface to take the run
(`advanceRun(run, to, ctx)`), making a from-state literal inexpressible (~7 mechanical call sites).
**PLAN IMPACT.** §3.4's loop stays; §3.5 should gain a registered-session row at next plan
revision (ISSUE-006's design half). **WOULD CHANGE MY MIND.** A reading where meta-tool
position-freedom is intended — checked; the report literal defeats the only bound that reading
relies on, so the conclusion survives either way.

### Theme B — Disposition, termination, incentive

#### MACRO-005 — The run/item FSM pair under-models *disposition*: every recorded wedge lives in a disagreement between derived predicates
**MAJOR · HIGH · origin LAYERING-COHERENCE-004**
**OBSERVATION.** "Is this item finished / waiting / hopeless?" is not a state — it is recomputed by
≥4 core predicates with subtly different closures (`isSettled`, `cannotEverPublish`,
`settledForReport`, the continuation actionability condition). The complete strain-point inventory,
per the charter's request to find every "settled but not finished" case: C-084/C-085 (the wedge),
ISSUE-066 (blocked+dependent → `noop`, resume dead), ISSUE-067 (silent wedge, enshrined by a
committed test), ISSUE-068 (no-git REVIEWED wedges the recommender), ISSUE-055 (red re-validate →
a state no tool services), ISSUE-050 (worktree publish demotion orders redoing work whose artifact
exists), ISSUE-065 (run-level: kinds with no writer). Seven strain points, found by four lenses
across two review generations; each fix so far adjusts one consumer's predicate. Notably the FSM
*edges* never strained — mutation testing shows edge enforcement binds; the strain is entirely in
the derived layer.
**CONSEQUENCE.** C-085's undetectable wedge; ISSUE-066's incentive inversion (honest waiting →
`noop` + lost work).
**WHY STRUCTURAL.** Each orthogonal mode (no-git, worktrees, debug, blocked-deps) has independently
minted a new disposition hole — four categories, which is the argument *for* consolidation.
**BETTER SHAPE.** One core `dispositionOf(item, ctx): "actionable" | "waiting-human" | "stuck" |
"settled"`, consumed by the scheduler (skip non-actionable — closes ISSUE-068's class), the
continuation engine (re-prompt iff actionable; detectable-wait iff waiting-human), and the report
closer (MACRO-006). Predicates already exist in gates-phase; consolidation + 3 consumer
migrations, ~2–3 days, no schema change (disposition stays derived — storing it would mint a new
two-spellings problem).
**PLAN IMPACT.** §3.2/§3.7.1 prose becomes *implemented by* one function; no text change required.
**WOULD CHANGE MY MIND.** The seven points reducing to two unrelated causes — tried; they reduce
to four, which strengthens the finding.

#### MACRO-006 — Stop-kind authorship has no owner; the single closer is a named prerequisite of 13.2, 14.2, and Phase 17
**BLOCKING · HIGH · origin LAYERING-COHERENCE-005 + FITNESS-FORWARD-005 + PD-OPINION-001 (merged)**
**OBSERVATION.** §2.9 defines 6 stop kinds. Writer census (re-verified this session): exactly 3
sites — `handleReport` tools.ts:7647 (a *type-level* literal `kind: "done"`), continuation.ts:585
(`noop`/`env`/`interrupt`), the override-exhaustion path tools.ts:7913 (`env`). `shouldTerminate`
computes `blocked`/`surfaced`; its one consumer defers both to `conductor_report`, which cannot
write them — a delegation ring with no writer (ISSUE-065). Three *scheduled* consumers depend on
the missing kinds: 13.2's `13.2-report` row (a blocked interactive-smoke run will read `done`/
`noop`); 14.2's SG-K stop-kind distribution (its only wiring-vs-quality discriminator); and the
addendum's Task 17.4 acceptance — "a blocked run … stops `surfaced`" — which is **unsatisfiable at
HEAD** (the P8 shape, in the plan for the next phase).
**CONSEQUENCE.** Reproduced: an all-blocked run closes `done` ("the run completed") — the worst
operator signal for an unattended harness; PROBE-A's lost work.
**WHY STRUCTURAL.** Wiring `handleReport` alone leaves three sites each owning a slice of the
mapping; the next stop kind reopens the gap. A closed vocabulary with no owning closer is
over-specified for its recorders.
**BETTER SHAPE.** Answering step 2's design question directly: **keep all six kinds** (they encode
the operator's three most load-bearing distinctions — done / waiting-on-you / broken; this half is
opinion, labelled as such, from PD-OPINION-001) and build **one closer**: a total core
`stopKindOf(dispositions, cause)` over MACRO-005's disposition enum, with every terminal path
(report, futility, override exhaustion, halt) running through one adapter site; a `satisfies` over
STOP_KINDS proves every kind has a producing branch. ~1 day; the renderer already handles both
missing kinds (step 2 verified only the writer is absent). **Land before 13.2.**
**PLAN IMPACT.** §2.9 unchanged; the §3.2-done vs §3.3-blocked contradiction (ISSUE-053) must be
reconciled at next plan revision — the closer forces that decision explicitly. The addendum's risk
register should name ISSUE-065 as 17.4's work.
**WOULD CHANGE MY MIND.** Evidence `blocked`/`surfaced` are operationally indistinguishable —
plausible but the distinction costs nothing once a closer exists.

#### MACRO-007 — Three escape hatches with three price tags; the cheapest has the weakest audit trail — the backwards incentive gradient is a design property
**MAJOR · HIGH · origin LAYERING-COHERENCE-006**
**OBSERVATION.** Override: budgeted (both meters), tainted, journaled, honest provenance.
Inline-claim: no budget, no taint, expiry unimplemented (ISSUE-057), mintable on terminal runs.
Defer: free, untainted, legal in every non-terminal state, and **forges `kind:"human"`**
(ISSUE-052) — contradicting the C-044 ruling one file over. Measured result (step-2 adversary
log): the cheapest full-run escape is classify→decompose→defer-all→report closing clean `done`
with forged human provenance, while honest use of the *expensive* hatch is punished (ISSUE-007:
the plan's own §2.8 worked example burns budget and can kill the run) and honest waiting loses
work (ISSUE-066).
**CONSEQUENCE.** "The incentive gradient runs backwards" — step 2's through-line, demonstrated
end-to-end against real handlers. For a system whose thesis is making the lazy path expensive,
this is thesis-level incoherence.
**WHY STRUCTURAL.** Fixing ISSUE-052 removes the forgery, not the gradient. The three hatches were
designed in three plan sections with no shared cost model; "what should each shortcut cost so the
cheapest path is the honest one?" has never been asked anywhere in the record.
**BETTER SHAPE.** One shortcut schema: every process-shortcut writes the same triple — budget
consumption sized by impact, taint/anomaly, honest provenance. A defer-dominated settled set
becomes visible in the report by construction. ~2 days + a recorded plan deviation (the defer
budget is genuinely a plan-level change — that is the point).
**PLAN IMPACT.** Real: §3.6 budgets override only; pricing defer needs a recorded deviation or
revision. **WOULD CHANGE MY MIND.** Evidence deferral is intended free because a human reviews
every report — refuted today by ISSUE-051/-052 (the report launders the lazy path); defensible
only for attended runs, and the plan's stated target is unattended.

### Theme C — Doctrine and security posture

#### MACRO-008 — Doctrine exists twice at the design level: a dead cross-cutting channel and live hand-inlined paraphrases
**MAJOR · HIGH · origin LAYERING-COHERENCE-007**
**OBSERVATION.** §6.4 designed one delivery mechanism (packs → `loadPacks` → `buildSystemAppend` →
every system prompt). Reality: that channel is fully built, fully tested, operator-repointable —
and has zero production callers (ISSUE-001). What sessions actually receive is a *second*
mechanism: hand-written paraphrases at five tools.ts dispatch sites, no drift guard either
direction; only `debug.md`'s content is ever read from the pack map (ISSUE-003, the operator
override ~95% theater). The fail-closed machinery guards the dead mechanism: `ensurePacks` will
halt every tool call to protect doctrine it will then not deliver; `receive-review.md`'s delivery
trigger is a signal only the dead channel reads — C-028's own rule ("loaded ≠ delivered") violated
at HEAD by the mechanism built in response to it.
**CONSEQUENCE.** Every doctrine improvement to the reviewed, anchor-tested surface changes nothing
a session sees; every paraphrase drift is invisible.
**WHY STRUCTURAL.** A cross-cutting concern with no composition-root task gets reimplemented at
every consumer, N times, unguarded — the generalizable mechanism behind ISSUE-001/-003. Wiring
alone does not resolve it: the paraphrases will then *conflict* with the arriving packs.
**BETTER SHAPE.** After ISSUE-001's wiring: dispatch prompts compose from the loaded pack map (the
existing debugFixPrompt pattern); any residual paraphrase gets a drift guard against its pack.
Five mechanical prompt-site refactors.
**PLAN IMPACT.** None — §6.4 already specifies the single channel; this restores it.
**WOULD CHANGE MY MIND.** Evidence the paraphrases are deliberate stage-scoped doctrine — recorded
nowhere; the finding survives as "one concern, two unguarded spellings" either way.

#### MACRO-009 — Two security postures coexist in the gate layer; every reproduced bypass sits on the enumeration side — the split is accidental
**MAJOR · HIGH · origin LAYERING-COHERENCE-008**
**OBSERVATION.** Deny-by-default positions (git verb default-deny, session registry, gate-snapshot
derivations, expansion sigils): **0 bypasses under step-2 attack**. Enumeration positions
(`GIT_WRAPPERS` 5 names, `-c` config keys, basename `=== "git"`, `BRANCH_MUTAT­ING` token list,
`WRITE_TOOLS`/write-shape command set, checkout discard-flag list): **6+ reproduced bypasses**
(ISSUE-014/-015/-017/-018/-019/-020/-021), including real arbitrary-write and arbitrary-execution
routes, two of them falsifying HONEST-LIMITS.md closure claims. Score: 0 vs 6+, same layer,
sometimes the same function.
**CONSEQUENCE.** ISSUE-014/-015 are live security holes; the disclosure document inherits the
posture confusion.
**WHY STRUCTURAL.** The codebase *knows* the right posture (fail-safe deny wherever attribution
succeeds) and falls back to enumeration exactly where attribution is hard — which is where an
adversary goes. The split is recorded as a decision nowhere; it is the residue of patch history
(the wrapper list patched ≥twice; ISSUE-014's missed-prefix list is open-ended). Accidental, per
Part C's question.
**BETTER SHAPE.** IDEA-STRUCT-3, endorsed with this measurement: invert the default at the
attribution boundary — a token that basename-resolves to `git`/a write tool in an unattributable
position is DENIED; compound/keyword-prefixed commands the parser cannot attribute are denied for
write-capable sessions; enumerations become allow-lists for known-benign shapes. ~2–3 days +
false-positive pass. Pair with IDEA-LC-9 (record deny rate at first live contact before flipping).
**PLAN IMPACT.** §3.5/G7's DENY-plus-residuals stance unchanged; the residual list shrinks from
open-ended to enumerable; HONEST-LIMITS' two false claims corrected either way.
**WOULD CHANGE MY MIND.** Measured benign-deny frequency >~1/run on real traffic — checkable at
13.2/14.2 (IDEA-LC-9).

### Theme D — Navigability and the small-model thesis

#### MACRO-010 — `tools.ts` at ~93k tokens is above every reader's budget, including the build's own machinery; the split seams are measured
**MAJOR · HIGH · origin NAVIGABILITY-001 (+ LAYERING-COHERENCE-011 hub facet)**
**OBSERVATION.** Measured/verified this session: `tools.ts` = 9,253 lines / 371,683 bytes /
**~93k tokens** — 3.9× a 32k model's ~24k readable budget — with **22** exported `handle*`
functions (verified by two independent greps; corrects the step-2 "~15" estimate). Handler
boundaries are clean and enumerated (region table in the origin part; every region fits a 32k
model with its core deps). It is also a *hub*: continuation.ts imports 5 of its exports,
plugin/index.ts imports 28 names, and the gate hook composition lives there beside 15 handlers and
setup.
**CONSEQUENCE — four, all paid.** (1) The build's own review machinery could not read it — no
single step-2 lens read all 9,253 lines; it was split at line 5515/5517 and "seam defects between
distant regions are why ISSUE-005/-008/-088 were invisible to single-region reads." (2) The system
serializes work on itself — extending.md:77-80 admits it: two items that each add a tool share a
fileScope, so tool work lands serially; conductor's own wave scheduler cannot parallelize
conductor's commonest change. (3) The audit layer breaks at the file's growth edge (ISSUE-088:
stripComments blanks 9104→EOF, where new handlers land). (4) Adding a tool safely measures
~37–40k tokens (Task A), the one task class the repo most needs small models to do.
**WHY STRUCTURAL.** The file *is* the instance; every local fix leaves the next defect's two halves
8,000 lines apart. The three-files-far-apart shape that hid ISSUE-002 is the same shape *within*
this file between regions.
**BETTER SHAPE.** `conductor/adapter/handlers/` with 8–9 modules on the measured boundaries +
`shared.ts` for the preamble. Migration cost, measured: 26 files import from tools.ts (2 production,
24 tests), 45 statements; the no-re-export rule forbids a barrel so all 45 repoint (mechanical,
tsc-verified); the source audits' one file-name-coupled floor (`MIN_SITES_IN_TOOLS`) becomes
per-directory. ~1 focused task with the full gate as the net; do it before wiring ISSUE-001/-002 if
both are scheduled, so the fix lands in a readable file.
**PLAN IMPACT.** None on plan semantics (§1.1 layout already stale; no file sizes named); the §8
"handler(s) in adapter/tools.ts" becomes a recorded deviation.
**WOULD CHANGE MY MIND.** Dense region-crossing shared state (spot-checked and not found; not
exhaustively cross-referenced) or a gate property depending on single-file scanning.

#### MACRO-011 — The map documents traps instead of the structure removing them: extending.md's "trap" paragraphs are step-2 defects restated as advice
**MEDIUM · HIGH · origin NAVIGABILITY-002**
**OBSERVATION.** `docs/developer/extending.md` (529 ln, read in full — a genuine concern→file map
the step-2 record never mentions exists) carries ≥4 "trap" paragraphs that are live step-2 findings
in prose: "add a role" = ISSUE-121 (role vocabulary typo-absorbing fallbacks); "add a doctrine
pack" = ISSUE-114 (REQUIRED_PACKS/ROLE_PACKS split, reproduced MUT-1b); "add a tool" = the
single-file serialization (MACRO-010); "add/change a gate rule" = the `guarded`-flag fail-open
(ISSUE-014/-018 attribution blindness).
**CONSEQUENCE.** Each trap is a permanent per-task tax (the "add a role" safe read-set includes
memorizing a three-spellings table). The build paid it: C-082 is the "add a role" trap happening to
the build itself.
**WHY STRUCTURAL.** A trap paragraph is the documentation layer compensating for a missing owner in
the structure layer; the pattern recurs at every unowned vocabulary and accretes new paragraphs as
the system grows.
**BETTER SHAPE.** A standing rule: a trap paragraph is a defect record — each names the issue that
deletes it or justifies why the structure cannot own it (the "add a schema" `additionalProperties`
paragraph is the legitimate kind). Near-zero cost; the paragraph-deleting fixes are already filed
(ISSUE-114/-121).
**PLAN IMPACT.** None. **WOULD CHANGE MY MIND.** A trap that cannot be structurally removed without
violating a G-invariant — none could be constructed.

#### MACRO-012 — Cross-language vocabulary changes are grep-complete or silently wrong: small in tokens, unbounded in risk
**MAJOR · HIGH · origin NAVIGABILITY-006 + FITNESS-FORWARD-008 (merged)**
**OBSERVATION.** Measured additions: a stop-kind change touches 6 files in 3 languages
(types.ts, stops.ts, continuation writers, tools.ts rendering, conductor_bench.py — a copy whose
comment says "verbatim", test_conductor_bench.py — a fourth copy), none derivable from another. A
role is ~9 sites across ~7 files with two *silent* seams (inject.ts's three `??` fallbacks;
ROLE_PACKS entries no test can see, ISSUE-114 reproduced). The generalized inventory (step-2 enum
7.3): of ~26 closed vocabularies the unguarded/one-directional restatements outnumber the guarded;
the two exemplary guards (single-source.test.ts; composition.test:823) are hand-built one-offs.
**CONSEQUENCE.** Copies are findable only by grepping the *value*, not the concept: `grep
STOP_KINDS` finds 4 of 6; C-082 (the build's costliest defect) was a value-spelled copy a
concept-grep missed and a frequency count mis-adjudicated. Missing the python stop-kind copy
surfaces as a hard `validate_result` error **mid-14.2-campaign** (ISSUE-113 mutation). The safe
read-set is *unknowable in advance* — a category difference from MACRO-010's "knowable but too big."
**WHY STRUCTURAL.** The safe pattern exists but each new vocabulary must remember to apply it; the
class regenerates with every new vocabulary (conductor-gate.sh:63's own confession: "already
drifted six times"). The addendum adds three new closed vocabularies under the same regime.
**BETTER SHAPE.** IDEA-STRUCT-6 (vocabulary registry + parity harness), endorsed as *both* the
navigability fix (a registry is an index) and the drift fix; make composition.test:823's technique
the default. Per-vocabulary incremental migration; the exported-schema derivation for python
STOP_KINDS is the worked example.
**PLAN IMPACT.** §2's vocabularies unchanged; the plan mandates them, not their hand-restatement.
Phase 17's three new vocabularies should be the registry's first natives.
**WOULD CHANGE MY MIND.** Severity drops if 14.2 consumes exported `Run.schema.json` (removes the
highest-consequence consumer) or typed `Record<Role,…>` maps land (collapses the role row's silent
seams to the cross-language residue).

#### MACRO-013 — The build record is structurally unreadable at 32k: the prescribed cold boot exceeds the context, and the record's own index fields are dead
**MAJOR · HIGH · origin NAVIGABILITY-004 + PROCESS-AND-DOCS-011 + FITNESS-FORWARD-010 (merged)**
**OBSERVATION.** The prescribed cold-boot order (HANDOFF ~3.2k + STATE.json ~37k + NOW.md ~1.1k)
costs **~41k tokens — 1.7× a 32k budget — before one source file is opened.** CORRECTIONS.md
("after the plan, the most valuable document") is 4,610 lines / ~82k tokens (re-verified: 4,610 ln,
328,987 B) with **no index** — 92 entries findable only by scroll/grep; headers carry no file list.
The one machine-readable index (`coveredByTest`) is null on 548/795 rows (69%); the convention that
replaced it (row id in test title) is undocumented and unenforced (118 rows named nowhere). The
M1–M9 gate ledger ends silently at task 11.8 (11 COMMITTED tasks recordless; `15.0` appears zero
times in GATES.json). Four record surfaces describe four different presents (ISSUE-082). Every
surface is append-scaled, so every number worsens monotonically with the build's own progress, and
no mechanism keeps any read path under any size.
**CONSEQUENCE — realized twice.** (1) Step-2's P10 re-litigation "required re-running mutations from
scratch" because refutations are one prose line in the 82k-token file (ISSUE-079). (2) The phase-13
adjudicator inferred "nothing tests them" from `coveredByTest` nullness — right for 15.1, wrong for
14.1 (33/33 covered): a large-context reader was *already* misled by the dead index.
**WHY STRUCTURAL.** The record has no read-path budget and no index contract; the conventions died
exactly when the build sped up (9.1/11.8 cutoffs). A record produced by a small-model project that
can only be read by a large model is a thesis-level inconsistency, the same genus as ISSUE-001.
**BETTER SHAPE.** An index layer (not a rewrite): a generated `CORRECTIONS-INDEX` (id · title ·
files · class · obligation status, ~2k tokens); STATE.json rows pointing at the corrections that
touched them; HANDOFF stays the sole ≤4k boot doc and names the index; adopt IDEA-ROW-1 to turn the
practiced convention into an enforced index; a "record currency" stamp across surfaces (ISSUE-082);
a gate leg asserting every COMMITTED task has a gate record. All small scripts + a one-time
backfill; the ledger stays append-only (the index is derived).
**PLAN IMPACT.** None; the plan does not specify the record's shape, and the "docs describe the
design" doctrine is untouched (an index is not status prose).
**WOULD CHANGE MY MIND.** An explicit decision that build-record archaeology is a large-model/human
task — defensible, would downgrade to IDEA; contradicted by the project's stated posture (the
record as the agents' field guide).

#### MACRO-014 — Test files are named by construction order, not subject: the suite's map is a memory of the build campaign
**MEDIUM · HIGH · origin NAVIGABILITY-005**
**OBSERVATION.** The ten `tools-9.*.test.ts` files (~120k tokens combined) are keyed by build-task
number; the subject is recoverable only from a header comment. The maintainer's map (publish is
pinned in 9.5b + two others; mark_green/validate in 9.4b; item_review in 9.5a; wave driver in 9.4c)
exists in no file. Newer tests use subject names, so the suite carries two naming regimes split at
the same historical line as the assertion-ledger convention change (~9.2).
**CONSEQUENCE.** "Which tests pin the behavior I am changing" — the single most load-bearing safety
question — is answerable only by grep-and-hope across ~707k tokens of tests. ISSUE-132 measured the
realized cost: producing the 13.1 mapping once required reading the 51k-token e2e file in full, and
the mapping went into a review artifact rather than the repo, so the next reader pays again.
**WHY STRUCTURAL.** The suite mirrors the *producer's* frame (the 52-task manifest), not the
*maintainer's* frame; the two-regime split makes the scheme non-inferable.
**BETTER SHAPE.** A generated `conductor/tests/MAP.md` (file → SUBJECT → modules asserted, from the
uniform header comments), regenerated by a gate leg like schemas (~40-line script); opportunistic
subject renames as files are touched.
**PLAN IMPACT.** None. **WOULD CHANGE MY MIND.** M7 requiring filename = task id — checked; M7 maps
rows to test *titles*; the filename carries no mechanical role.

### Theme E — Process, gate regime, record honesty

#### MACRO-015 — The skeptic ladder is evidence-asymmetric and its default biases toward killing findings; P10 was not bad luck
**MAJOR · HIGH · origin PROCESS-AND-DOCS-004 (+ B.3)**
**OBSERVATION.** Upholds carry pages; refutations one line (ISSUE-079). Of the refutations step 2
re-litigated, **two were wrong**: C-032 F1 (testWriter/test-writer, refuted 2/2, sealed with a
do-not-re-litigate note, true the whole time) and C-030 E12 (file budget counts glob entries,
refuted 2/2 on procedural grounds — ISSUE-012). Kill rate swings 12% (C-079: 3/25) to 71% (C-063:
10/14) across panels; `skeptic.md` instructs "uncertain ⇒ refuted." Panels were repeatedly
under-delivered by transport deaths (C-030: 9 skeptics; C-031: both lenses, nearly a false clean
bill; C-038: 7 skeptics), and the fail-closed rule was invented reactively.
**CONSEQUENCE.** A dead gate arm shipped for the build's whole duration under a refutation that
"protected" it (C-082); an enforcement-advisory hole survived as officially-refuted (ISSUE-012).
**WHY STRUCTURAL.** The asymmetry is in the RECORD SCHEMA and the DOCTRINE — a refutation costs a
sentence, an uphold costs a fix round — so the gradient exists on every panel regardless of staffing.
**BETTER SHAPE.** (1) Symmetric evidence obligations (a refutation carries the discriminating
input, the run, the reading under which the finding fails; a one-line refutation is an abstention,
and an abstention upholds). (2) Kill the "do not re-litigate" note as a category — a refutation
closes a finding for *this gate*, never for the record. (3) Identifier-position matching as skeptic
doctrine (the P10 generalized lesson, currently in no pack). Doctrine paragraphs + one schema
field; retroactively impossible (ISSUE-079 stands).
**PLAN IMPACT.** §7.2's skeptic prose wants an addendum note; no schema/G change.
**WOULD CHANGE MY MIND.** An audit showing the two known-wrong refutations are the only ones —
impossible today precisely because refutation evidence was never recorded (which is the finding).

#### MACRO-016 — Every scanner and gate selects its subject by open-ended enumeration; nothing asserts the selection covered the intended set
**MAJOR · HIGH · origin PROCESS-AND-DOCS-001 (+ NAVIGABILITY-007 scripts facet)**
**OBSERVATION.** ~21 of 92 corrections (23%) are the "check inspects less than it appears to"
class; SIX are one scanner's file-set (M5: C-057, C-072, C-073, C-074, C-075, C-078 — the ledger's
own "eighth appearance"); live at HEAD in the audit layer built to catch it (ISSUE-088:
stripComments blanks ~240 lines of tools.ts; ISSUE-089: deleting tsconfig.json silently disables
the M3 leg). Four enforcement shell scripts sit outside every scanner (M5 scans no `*.sh`), and
`scripts/` interleaves two products (the conductor harness vs the pre-existing benchmark tooling)
under one gate covering only the former (ISSUE-109).
**CONSEQUENCE.** Eleven commits of unscanned C++; two phases' products never scanned; the repo's
best drift guard partly blind today; an M7 PASS over a test file that did not exist (C-079).
**WHY STRUCTURAL.** Each fix was a hand-added floor; the next instance appeared on a different axis
(globs → untracked files → scripts/ → string-stripping). The enumerated sets are demonstrably not
closed under repo growth (three layout/growth events each blinded one).
**BETTER SHAPE.** Inverted selection everywhere a subject set exists — scan all tracked source
MINUS an explicit exemption list; leg-activation conditionals become leg-missing failures
(ISSUE-089's fix); every scanner reports scanned-set ∆ against `git ls-files` and fails on
unexplained difference; a sentinel canary that the stripComments-based audits still see the file's
tail. One script rewrite + one conditional inversion + ~15-line canaries.
**PLAN IMPACT.** None. **WOULD CHANGE MY MIND.** A demonstration the enumerated sets are closed
under growth — they demonstrably are not.

#### MACRO-017 — The correction mechanism records classes and obligations in prose, and prose does not enforce; recorded debt measurably fails to land
**MAJOR · HIGH · origin PROCESS-AND-DOCS-003**
**OBSERVATION.** The two-spellings class was NAMED "the Phase 9 theme" at C-042 with an explicit
hunt instruction; ≥8 more instances landed after (C-044/-047/-050/-063/-064/-075/-082/-085/-086),
two in the neighborhoods of both CRITICALs. C-054 shows the inverse: a record CLAIMED a guard
existed and none did. Obligation non-delivery is measured: C-067(a) never wired across ≥3 rounds
(ISSUE-100); C-075's spec revision never landed (ISSUE-078); against one measured delivery
(C-084→C-086). The instances that STOPPED recurring are exactly the ones that got a *construction*
(single-source.test.ts, the C-044/-047 binding guard, composition.test:823); the ones that got a
*paragraph* recurred. The discriminator is construction-vs-prose, not diligence.
**CONSEQUENCE.** ISSUE-002 (CRITICAL) is the unmapped half of a duality RECORDED at C-037 r.5; the
P10 false negative was SEALED by a recorded note. The record layer actively carried both failures.
**BETTER SHAPE.** (a) the C-054 rule mechanized (a correction claiming a guard names the test file;
a script asserts it exists); (b) an obligations ledger with owner + status, and a generated index
over CORRECTIONS.md that fails when an entry carries an obligation-verb with no status (IDEA-PROC-1,
with the measured 2:1 loss rate as justification); (c) each named class gets a construction-or-waiver
decision at the next gate.
**PLAN IMPACT.** None. **WOULD CHANGE MY MIND.** Evidence prose reliably lands obligations — the
measured record (2 lost : 1 landed) says otherwise.

#### MACRO-018 — The gate regime's own records are unschema'd hand-written prose that stops when scrutiny is most needed, and the gate binary is a noisy sensor
**MAJOR · HIGH · origin PROCESS-AND-DOCS-005 (+ FITNESS-FORWARD-013)**
**OBSERVATION.** `taskGates` has 44 rows and ends at 11.8 — eleven later COMMITTED tasks have no
row (ISSUE-083); `phaseGates` uses ≥5 record shapes across phases 0–15; nothing validates any of
them; M7 was a count until it mattered (C-079: PASS for a test file that did not exist); two gates
were dispatched over absent subjects (C-072/C-074). The gate binary itself: no `--test-timeout`
(a hang wedges it forever, ISSUE-032, measured — one mutation deadlocked the suite, another stalled
it ~15 min); nondeterministically red on byte-identical HEAD with two of three failure shapes being
the *product* enforcing differently under load (ISSUE-134, proposed P14); node count drifted
1382 vs 1386 across observers.
**CONSEQUENCE.** The late build's evidence lives in free-form STATE.json prose; every recorded
"GATE PASS" — including every one this review suite rests on — is a distribution sample; a cold-boot
reader inherits retracted claims.
**WHY STRUCTURAL.** A codebase whose thesis is closed vocabularies and re-derived records applies
neither to its own build record — an explicit "records are for humans" decision — and every step-2
Cluster L honesty finding lives in it. The flaky tests are symptoms of `Date.now()`/mtime
comparisons at millisecond granularity that hold only on an idle machine.
**BETTER SHAPE.** Script-emitted taskGates rows; mechanical M7 (row-id↔test-title, IDEA-ROW-1);
scripted stage-0 preflight; `--test-timeout=120000` + `--concurrency` pinning for enforcement
suites + an injectable monotonic clock at freshness/stale-red seams; one currency stamp across
surfaces. Mostly small scripts + a focused clock refactor.
**PLAN IMPACT.** None. **WOULD CHANGE MY MIND.** Root-causing the three flake shapes to
test-harness timing rather than product comparisons (the loop-under-load experiment, not yet run) —
downgrades the flake half to test-hygiene; the no-timeout half stands alone.

#### MACRO-019 — Mutation testing is the build's most productive instrument and was never institutionalized; the layer it never reached is where the decorative checks concentrate
**MAJOR · HIGH · origin PROCESS-AND-DOCS-006**
**OBSERVATION.** Adopted ad hoc at C-034, the habit found/confirmed defects in ≥15 corrections; it
was never made a gate leg. Step-2's merged mutation table shows the enforcement spine BINDS while
the audit/gate layer carries the survivors (M5 multi-line catch, acceptance rows 3/10/F, purity
scan, G5 consistency-only, stripComments — enforcement §7.4). The mutation harness itself produced
false survivors twice until compile/apply checks were added by convention (C-049/C-051).
**CONSEQUENCE.** The checks that gate the BUILD are provably weaker than the code they gate — the
exact inversion a mechanical-enforcement thesis cannot afford.
**WHY STRUCTURAL.** The product got mutated because task loops touched it; the audit layer got
mutated only when a reviewer chose to — no process step owns "mutate the checkers."
**BETTER SHAPE.** A small standing mutation suite over the AUDIT layer (the ~15 named survivors in
enforcement §7.4 are the seed corpus), run at phase gates, with C-049/C-051's compile-and-applied
assertions built into the runner (IDEA-STRUCT-7 is the durable form). ~2–3 days; mutations already
written down.
**PLAN IMPACT.** None. **WOULD CHANGE MY MIND.** Re-running the surviving mutations after a fix wave
and finding the audit layer binds — that is the success criterion, not a refutation.

#### MACRO-020 — The assertion-row mechanism is a sound concept shipped without its lifecycle (binding, disposition, satisfiability)
**MEDIUM · HIGH · origin PROCESS-AND-DOCS-010 + NAVIGABILITY (Task C)**
**OBSERVATION.** Rows repeatedly FORCED real discoveries (C-042's ambiguity, C-062's wrong-measurement
catch, C-092's four-rows-proven-by-nothing) and coverage is verifiably strong where the 1:1
discipline held (12.1: 35/35; 14.1: 33/33; C++ 11.2–11.7). The failures are all *lifecycle*: no
mechanical binding (69% coveredByTest null, 118 orphan rows, M7 a count); no disposition/supersession
semantics (12.1-G5's 21 promoted rows unmet-yet-ticked, ISSUE-075; 11.8's two live rows discharged
by nothing, ISSUE-076; C-075's revision unlanded, ISSUE-078); no satisfiability check at authoring
(C-083/C-084's unsatisfiable rows, C-042's undiscriminating row). The convention changed silently
≥3 times — the exact frequency-over-position trap (P10) at the record layer.
**CONSEQUENCE.** A field authoritative for the first half of the build and noise for the second
misled a phase adjudicator (ISSUE-081).
**WHY STRUCTURAL.** Every failure is a missing lifecycle STEP, not a bad row; more diligence
produces more rows with the same three gaps.
**BETTER SHAPE.** Mechanical M7 (row-id↔test-title bijection, IDEA-ROW-1); a `disposition` field
(met/superseded-by/waived, IDEA-ROW-2); a required "discriminating input" field per row at
authoring; one documented, back-applied convention.
**PLAN IMPACT.** None (specs/ is build infrastructure). **WOULD CHANGE MY MIND.** If the
strong-discipline tasks were the easy ones — but 14.1 and the C++ suite are not simpler than 13.1;
the difference was convention enforcement, not difficulty.

#### MACRO-021 — The operator documentation's behavioral layer is false at HEAD, and the anchor-test mechanism structurally cannot see it (one row pins a falsehood)
**MAJOR · HIGH · origin PROCESS-AND-DOCS-007 (+ PD Section E, F)**
**OBSERVATION.** Ten verified falsehoods. OPERATIONS.md: the "no banner, no conductor" first rule
(nothing emits a banner — the §6.4 channel that would is unwired; every healthy session is
diagnosed broken); failover ("marks metrics partial", "routerHealthy short-circuits" — both read by
nothing); doctrine editing ("inject.ts composes per role at dispatch" — dead in production);
stop-kind recorders (`blocked`/`surfaced` "recorded by conductor_report" — the literal is `"done"`);
read-only second session ("writes nothing" — guards 2 of ~12 methods). HONEST-LIMITS.md: "a wrapper
cannot hide" a git write (falsified by ISSUE-014); "the same rule covers the alias route" (falsified
by ISSUE-015); limit 9 streaming framed conditional though measured true (ISSUE-080); limit 3
"only fabrication path is override" (three more exist: ISSUE-048/-051/-052); limit 8 repeats the
read-only overstatement. `ops-docs.test.ts` binds nouns to code and behaviors to the PLAN; every
falsehood is a behavioral claim; `[15.1-banner-entry-is-first]` REQUIRES the doc to keep teaching a
signal nothing emits. Comment honesty (Section F): 9 of 9 audited load-bearing *cross-module*
comments were or are false; single-module comments are unusually honest (the `// NOT proven here:`
convention).
**CONSEQUENCE.** An operator following the first rule concludes every healthy session is broken;
editing doctrine per §6 changes nothing; trusting limit 3 misses three fabrication paths. Phase
15's raison d'être (docs drifted once) has recurred under a green guard.
**WHY STRUCTURAL.** C-080's fix was excellent at the noun layer and the nouns held; the falsehoods
are all cross-module behaviors — the category no static shape can express and no test currently
binds. Fixing the sentences leaves the mechanism that regrew them.
**BETTER SHAPE.** Behavioral doc rows bound by journal-driven fixtures (drive a stop, assert the
recorded kind against the table); a rule that a doc behavioral claim names its binding test or
carries an explicit `(plan §x — not yet built)` marker (the marker alone would make all ten
falsehoods honest today at near-zero cost). The code rule applied to prose: a comment naming a
consumer/guard is replaced by the test that proves it, or rewritten as intent.
**PLAN IMPACT.** None; §9's numbered limits stay normative. **WOULD CHANGE MY MIND.** Wiring
ISSUE-001 makes several rows true — but a doc true only after two CRITICALs are fixed is still
false today and says so nowhere.

#### MACRO-022 — Failure visibility is designed as "an error-level journal line nobody reads"; nothing converts sustained abnormality into an operator artifact
**MAJOR · HIGH · origin PROCESS-AND-DOCS-009**
**OBSERVATION.** By design the failure surface is one swallowed journal line (OPERATIONS.md §8,
accurate). The deny snapshot needed to diagnose the default-mode lockout (ISSUE-002) is journaled at
`debug`, below the default `info` — so at default verbosity the record needed to diagnose the first
thing a real run hits was never written. The silent-wedge shapes (ISSUE-033/-034) leave no counter,
no anomaly, no stop; the unattended-run distinction done/waiting/wedged collapses onto `done`/`noop`
(ISSUE-065/-066); router-metrics reads "unavailable" in *every* report, healthy or not (ISSUE-038),
so the signal carries no information. Time-to-cause ranges hours→unbounded (Section G table).
**CONSEQUENCE.** For the failures step 2 reproduced, a run that lost its work reads as completed;
the doctrine channel's deadness surfaces nowhere.
**WHY STRUCTURAL.** Each artifact (report, anomaly, stop) is written at a RECORDED stop; every
detector-miss produces nothing by construction. Adding troubleshooting entries cannot fix it — the
honest text would be "read the code."
**BETTER SHAPE.** One operator health surface: the beacon extended with
last-error/last-progress/doctrine-digest (IDEA-OBS-1/2); a floor converting N consecutive
`hook.failed`/latch-skipped passes into a recorded `env` stop (extends C-085's transport floor to
the store seam); deny snapshots at their own level; `blocked`/`surfaced` actually written
(MACRO-006). Each small; the floor pattern already exists in continuation.ts.
**PLAN IMPACT.** §3.8's beacon contract widens (additive); §2.9 unchanged (writers are the gap).
**WOULD CHANGE MY MIND.** An operator drill measuring detection time under current surfaces; the
step-2 reproductions strongly suggest hours-to-unbounded.

#### MACRO-023 — Five append-only ledgers, five hand-built implementations, at least three crash postures: the "ledger" concept exists once in design and five times in code
**MEDIUM · HIGH · origin LAYERING-COHERENCE-010**
**OBSERVATION.** The run dir carries five JSONL ledgers, each with its own reader/writer and
torn-line policy: journal.ts heals (C-017); readDecisions tolerates; `readQuestions` is a bare
per-line `JSON.parse` that THROWS, with 2 of 4 callers wrapped (ISSUE-101 — `conductor_status` and
the stop-report writer die on a torn file, exactly the post-crash moment torn lines exist);
evidence.ts has its own appender with a cross-process seq hole (ISSUE-026). The same crash-safety
lesson was re-learned per-ledger (C-017, C-032 E12) and is still unevenly applied.
**CONSEQUENCE.** A torn questions.jsonl makes the run unclosable through the very diagnostic and
terminal path an operator reaches for after a crash.
**WHY STRUCTURAL.** Four corrections/issues are one lesson learned per-ledger because there is no
shared substrate to learn it into.
**BETTER SHAPE.** IDEA-JSONL-1: one `appendJsonl`/`readJsonlTolerant` pair owning BOM handling,
torn-tail isolation, and (parameterized) seq discipline; five call-site migrations. ~1 day; makes
the C-017 class unrepresentable.
**PLAN IMPACT.** None (§7/§2.6 specify shapes, not readers). **WOULD CHANGE MY MIND.** A shown need
for genuinely different postures per ledger — recorded nowhere; a per-ledger *parameter* answers it.

#### MACRO-024 — Policy pools in the adapter by default; there is no criterion for which rules get promoted to core, so promotion happens after a defect
**MEDIUM · HIGH · origin LAYERING-COHERENCE-011**
**OBSERVATION.** G3's mechanical half is clean (measured: zero dependency inversions, zero clock/IO
in core after 92 corrections). But the adapter has accumulated pure policy that belongs in core:
`stricterKind`/`trivialViolatesRecheck` (§3.2/§2.4 policy), and `routeOf` (tools.ts:6261 — the §3.3
review-fix routing rule, pure string/scope policy defined inline in a handler closure, and
**defective** — ISSUE-054 — in exactly the way a core-owned, refusal-tested rule would not have
survived, because its tests only ever saw literal-path fixtures). The one-derivation principle
(C-037 r.1) exists and is honored for `settledForReport` — but there is no criterion for *which*
rules get promoted, so promotion follows a defect rather than authorship.
**CONSEQUENCE.** ISSUE-054 (routeOf routes test findings to the guaranteed-deny path) is the
concrete cost.
**WHY STRUCTURAL.** "Core = what someone decided to put in core"; each promotion happened in a
correction round; the path of least resistance is the adapter and the record shows no
counter-pressure.
**BETTER SHAPE.** State the promotion criterion once (a rule that adjudicates/routes model-supplied
content, OR is consumed by two call sites, OR is re-checked by a gate MUST be an exported core
function with refusal tests), then migrate standing violations (routeOf first). Criterion free;
routeOf ~half a day with ISSUE-054's fix.
**PLAN IMPACT.** None; G3 implies this — the gap is an operational criterion.
**WOULD CHANGE MY MIND.** If promotion-after-defect were cheap in practice — refuted: routeOf's
defect survived to HEAD and the review machinery's own false negative (P10) means instance-by-instance
discovery cannot be the strategy.

### Theme F — Fitness for what comes next (scheduling and growth)

#### MACRO-025 — Adding a tool touches five files and two silent seams; the addendum — the actual next additions — omits two of the five from its own file lists
**BLOCKING · HIGH · origin FITNESS-FORWARD-006**
**OBSERVATION.** Traced against HEAD, a new `conductor_*` tool must touch: tools.ts (handler +
input + `CONDUCTOR_TOOL_NAMES`); types.ts (schema, *twice* — interface + hand-written JSON schema);
tool-bindings.ts (binding — the one genuinely safe seam, guard goes red on an unbound export);
plugin/index.ts (ToolSpec — **a missing entry falls back silently to an argument-free definition**,
verified :245-247); gates-phase.ts (legality — a stage tool joins legalTools, a *meta* tool joins
**nothing**, ISSUE-005). The Phases 16–19 addendum's Task 17.3 file list names tools.ts, types.ts,
journal-events.ts and **omits tool-bindings.ts and plugin/index.ts entirely** (grep: zero mentions,
verified); Task 18.1 likewise. The two omitted files are precisely the ones with silent failure
modes.
**CONSEQUENCE.** Already happened in this exact shape (C-082, P10). The next implementer, working
from the addendum as spec, starts with an incomplete map written by the author with the most context.
**WHY STRUCTURAL.** The addition surface is not *discoverable*: no document or mechanism enumerates
it, so each addition re-derives it — and the best-informed author just lost 40% of the files. The
legality half is *per-addition bespoke*, multiplying the ISSUE-005 class with every growth step.
**BETTER SHAPE.** (a) `requireMetaTool` (ISSUE-005's fix) is a *growth* mechanism — a new tool
declares legality in one table; (b) a guard test that every `CONDUCTOR_TOOL_NAMES` member has a
non-fallback ToolSpec (~10 lines, closes the silent seam); (c) correct the addendum's lists now.
**PLAN IMPACT.** Hand Phase 17/18 implementers the five-file map; land `requireMetaTool` before
`conductor_clarify`. **WOULD CHANGE MY MIND.** If the binding guard transitively forces all five
touches — it covers only the handler↔binding seam (verified by reading its description).

#### MACRO-026 — Growth lands, by construction, in the span the repo's own audits cannot see
**MAJOR · HIGH · origin FITNESS-FORWARD-007 (+ ISSUE-088)**
**OBSERVATION.** The source audits' `stripComments` is quote-blind, blanking tools.ts 8405–8488 and
9104–EOF, including a real `journal.log("config.updated")` site whose vocabulary entry deletes with
the audit staying 7/7 green (ISSUE-088, reproduced both directions). tools.ts grows by appending;
therefore ~100% of appended handler code lands in the blanked span. The addendum appends ≥2
handlers plus new journal events (`clarify.*`, `artifact.written`, the whole `audit` component)
whose call sites those audits exist to police.
**CONSEQUENCE.** A new dynamic `.log` planted at the tail passed 7/7 (step-2 mutation table).
Prospectively, Phase 17/19's new event names get grep-tests whose enforcement partner cannot see
the call sites — P1 recreated at the audit layer for every event the addendum adds.
**WHY STRUCTURAL.** The audit layer's coverage is *inversely correlated with growth* (more preceding
string literals per appended line), and nothing asserts the audit sees the file's tail. The monolith
is why the span is so large.
**BETTER SHAPE.** IDEA-GATE-3 (string-aware stripper, hoisted, + a sentinel assertion the audit sees
an EOF marker) as a *pre-addendum* prerequisite; the deeper fix is MACRO-010's split. ~15 lines +
a canary.
**PLAN IMPACT.** Land before Task 17.3 (the first appended handler). **WOULD CHANGE MY MIND.** Only
if the audits are decommissioned for a stronger mechanism (ISSUE-124's production-vocabulary weighing).

#### MACRO-027 — A second orchestrating agent (or accidental second session) is unsupported in fact: the multi-writer story is ~17% implemented and composes into record corruption
**MAJOR · HIGH · origin FITNESS-FORWARD-009**
**OBSERVATION.** "Read-only conductor" guards 2 of ~12 mutating store methods; `grep -rn ".readOnly"`
finds zero consumers outside state.ts (re-verified: zero). The demoted session overwrites the live
writer's `alive.json` (written before the lock attempt); the stale-lock break is a naked
read-then-overwrite (two post-crash restarts both become writers, ISSUE-024); `release()` deletes
whoever's lock is present (ISSUE-025); the composed chain ends at duplicate evidence seqs and publish
shipping one item's green on another's verify (ISSUE-026/027/028).
**CONSEQUENCE.** The build's own process hit the adjacent failure: two reviewers following the
briefing's `ps | grep` killed each other's test children (IDEA-PROC-2); the gate is
nondeterministically red under concurrent-agent load (ISSUE-134). The user runs multiple concurrent
agents (this review suite itself), and 13.2's SG-K names accidental second sessions as a *when*.
**WHY STRUCTURAL.** Single-writer is enforced by a pid-file protocol with read-reason-rewrite races
at every edge; the read-only demotion contract has no enforcement locus at all.
**BETTER SHAPE.** IDEA-STRUCT-1 (OS advisory lock held for process lifetime — makes the double-writer
unrepresentable) + refuse-registration demotion (one check, not twelve) + beacon-after-lock. The
itemId/tree assertion in `readEvidenceAt`'s callers (~10 lines) closes the corruption consequence
independently.
**PLAN IMPACT.** Before 13.2, land beacon-after-lock and the release-pid check; before any two-agent
operation, the flock. **WOULD CHANGE MY MIND.** A recorded decision that conductor is
single-operator-single-session and the task-4.1 "read-only conductor" claim is withdrawn — then this
becomes a documentation-honesty finding.

#### MACRO-028 — The two live-task specs are stale against channels/paths that no longer hold; there is no spec-currency contract
**BLOCKING · HIGH · origin FITNESS-FORWARD-002 + FITNESS-FORWARD-004 (merged)**
**OBSERVATION.** `task-13.2.assertions.json` records `verifiedAgainstHead` at 75a2531; HEAD is 142
commits later (measured). Its SG-A lands the §3.8 banner as "the FIRST line of the live state
block" and calls the doctrine packs "injected verbatim" and the smoke "the first live proof that
per-role X-Conductor-* headers reach the router" — **all against ISSUE-001's dead channel**; row
`13.2-banner-landed` can go green at unit level while the banner never appears (P6 in a spec).
`task-14.2`'s three-arm design is *inverted at HEAD*: the `conductor` arm's injection is dead, so it
delivers *less* doctrine than the `doctrine` arm it must superset — the campaign's central
"did enforcement earn its cost?" comparison is confounded before launch. Two report columns are
pre-corrupted: "review findings caught" reads a file nothing writes (structurally 0, ISSUE-104), and
the stop-kind distribution (SG-K's only wiring-vs-quality discriminator) cannot say `blocked`/
`surfaced` (ISSUE-065). 2 of 2 live-task specs are stale in load-bearing ways (the other via
ISSUE-078).
**CONSEQUENCE.** 13.2 executed as specced lands a banner into a dead channel and burns live-smoke
time debugging a defect step 2 already named; 14.2's headline is unanswerable from the data as the
arms would run.
**WHY STRUCTURAL.** The spec system has no currency contract; `verifiedAgainstHead` is a one-shot
claim that silently rots (ISSUE-082's shape). 14.2's validity rests on ISSUE-001 + -104 + -065 + -107
being fixed first — a dependency chain recorded nowhere, computed by no mechanism (the same absence
that let C-075's revision rot).
**BETTER SHAPE.** (a) A spec-currency gate leg (~30 lines): flag any spec whose `verifiedAgainstHead`
predates changes to files it cites. (b) A pre-smoke revision pass re-grounding 13.2's SG-A in
whatever channel the ISSUE-001 fix makes real, adding the step-2 first-contact list as go/no-go
preconditions. (c) A one-page "14.2 validity preconditions" note naming the four blockers with the
row each corrupts.
**PLAN IMPACT.** 13.2 must not start from the committed spec; 14.2 must be scheduled after ISSUE-001
lands and -104 is re-pointed, or carry an explicit "conductor arm ran without §6.4 injection"
disclosure (which honestly guts the headline). **WOULD CHANGE MY MIND.** A standing instruction that
a live spec is re-verified before execution — none found; or evidence the 14.1 driver injects packs
into the conductor arm itself — checked (SG-F: "loads the plugin", no driver-side injection), none
found.

#### MACRO-029 — 14.2's campaign fails on launch mechanics and fails acceptance even if flawless; the two remaining artifacts are the two the meters cannot defend
**BLOCKING · HIGH · origin FITNESS-FORWARD-003**
**OBSERVATION.** Four reproduced defects compose against the 90-cell campaign: (1) `build_cell_env`
omits PATH, `run_command` uses it as the child's entire env → bare `opencode` fails `[Errno 2]`,
and the preflight checks the *driver's* PATH (ISSUE-107) — 90/90 cells `harness-error`, a complete
report over zero real cells; (2) a three-way path conflict between verify-acceptance.sh:163
(`docs/build/artifacts/`), the assertions (`bench/`), and conductor_bench.py:45 (`.data/benchmark/`)
— the fix C-075 mandated and nobody scheduled (ISSUE-078); (3) the bench cell config is a third
hand-spelling of maxReaders/workflow (mutation set both to wrong values, 33/33 green, ISSUE-112);
(4) the acceptance meter accepts a fabricated report shape in ~15s and, unlike G5, **no standing
node checker exists for conductor-report.md or SMOKE.md** (ISSUE-093) — the two artifacts left are
the two the meters cannot defend, under the build's own declaration that fabricating them is its
worst-case failure.
**CONSEQUENCE.** Already in miniature: 11.8's live smoke left two LIVE rows discharged by nothing
with M7/M8 PASS (ISSUE-076). Prospectively: an overnight window burned on harness-errors, a re-run,
then an acceptance FAIL on path grounds after a successful campaign.
**WHY STRUCTURAL.** Three of four are *recorded-debt-never-scheduled* (MACRO-017's meta-pattern); (4)
is the checker-ships-before-artifact principle (IDEA-STRUCT-8) not being a rule (G5 got its checker
only after C-089 burned the build).
**BETTER SHAPE.** A 14.2 pre-launch gate run before any compute: spawn one cell end-to-end against a
trivial task; run verify-acceptance.sh against a planted dummy at the path 14.2 will use; land the
standing node report-checker (required sections, 90-cell arithmetic, runId + verify seq that
re-validates) *before* the campaign. Extend `14.2-resume-proof`'s one-cell rehearsal to a full
spawn.
**PLAN IMPACT.** Insert `14.2-pre` fixes (ISSUE-107, -078, -112 + the report checker) — all sub-hour,
all on the critical path. **WOULD CHANGE MY MIND.** A cell spawn succeeding against the committed
`build_cell_env`/`run_command` (the composition differing from step-2's reproduction).

#### MACRO-030 — The build-record and process regime measurably stopped scaling at ~task 40 of 52; the addendum adds ~12 tasks onto it
**MAJOR · HIGH · origin FITNESS-FORWARD-010 (+ FITNESS-FORWARD-011 contributor facet)**
**OBSERVATION.** Four decay measurements (all step-2-verified): taskGates ends at 11.8;
`coveredByTest` populated 0.1–9.1, null thereafter (548/795); four surfaces describe four presents;
the assertion-ledger convention changed 3×. Plus: no second-contributor surface exists — no
architecture map, no module-ownership index, no "how to add X" (extending.md is a partial recipe
map but its destinations are unreadable, MACRO-010/-011); the build compensated with per-agent oral
tradition ("NEVER read this file whole"; exact line ranges per task), recorded nowhere durable, and
the best-informed author (the addendum's) already demonstrated it is lossy (MACRO-025). The addendum
adds ~12 tasks plus four new record surfaces of its own under the same regime.
**CONSEQUENCE.** Already realized: the phase-13 adjudicator's wrong conclusion from dead
`coveredByTest`; the cold-boot reader inheriting the retracted G5 narrative; C-075's rot. These are
the record layer failing at *current* scale.
**WHY STRUCTURAL.** Asymmetric enforcement: the *code* cannot advance without passing gates; the
*record* can rot without failing anything. A regime dependent on manual upkeep decays exactly when
throughput rises.
**BETTER SHAPE.** Give the record the treatment the code got: a gate leg asserting every COMMITTED
task has a gate record; row-id↔test-title linkage (IDEA-ROW-1); a currency stamp (ISSUE-082); and a
generated `ARCHITECTURE.md`/OWNERSHIP page derived from TOOL_BINDINGS + the vocabulary registry,
seeded from step-2's §10 coverage ledger (the most complete geography this codebase has). Phase 16
(repo hygiene) is the natural home — extend its charter from *files* to *records*.
**PLAN IMPACT.** Do this in Phase 16, before Phases 17–19 generate ~12 more tasks under the old
regime. **WOULD CHANGE MY MIND.** A recorded deliberate convention change ("from 9.2, test titles
are the linkage") — none exists (step 2 looked; the changes were silent); the GATES.json cutoff has
no such defense.

#### MACRO-031 — A second router backend or second model is a guarded-by-nothing change
**MEDIUM · MEDIUM · origin FITNESS-FORWARD-012**
**OBSERVATION.** `RouterConfig.upstream` is a single `Endpoint` (config.hpp:84, verified). The TS↔C++
schema contract is guarded by no automated step (the CMake export deferred at 11.1 never landed; a
RouterConfig change sails through the full gate green while the router refuses to start; a fresh
clone's schemas dir is empty and config_test fails — ISSUE-043). A second *model* activates ISSUE-042
(admission caps per client-controlled model string while the pool is sized for one — reproduced as
`/conductor/health` starvation). The four `X-Conductor-*` header names are config on the router side
and constants in inject.ts (ISSUE-117), so editing the "hand-editable" affinity keys silently
desyncs the sender.
**CONSEQUENCE.** Not yet bitten (the most forward-looking entry) but each component is reproduced and
the composition is exactly what "add a second backend" walks through: change RouterConfig
(unguarded), rebuild (fresh-clone schema gap), run (pool sizing + header desync, both silent).
**WHY STRUCTURAL.** The missing piece is the absent cross-language contract mechanism (schema export
as a build step + config-vs-constant ownership).
**BETTER SHAPE.** Land the `add_custom_command` export + exporter pruning (ISSUE-043); size the pool
from a declared model list or bound distinct in-flight keys (ISSUE-042); make the sender read
RouterConfig or document the keys machine-owned (ISSUE-117). All specced by step 2; together they
are the precondition for any second-backend ambition.
**PLAN IMPACT.** If the roadmap includes a second model, these land first; otherwise record
"single upstream, single model" in HONEST-LIMITS.md. **WOULD CHANGE MY MIND.** A recorded decision
that llama-router is permanently single-upstream POC infrastructure — then this collapses to
ISSUE-043 (which matters regardless, since RouterConfig changes happen within one backend too).

### OPINIONS (ranked last, per the charter)

#### MACRO-032 — OPINION: the 7-role / 9-pack decomposition is probably right-sized, but the build has produced zero evidence either way
**OPINION · origin OPINION-LC-A + PD-OPINION-001 (role facet)**
No measurement can support any position on role count, because doctrine has never reached a session
(ISSUE-001). What IS measurable and *not* opinion: the role vocabulary has no owner (ISSUE-121; the
one recorded role defect, C-082, is a no-owner defect, not a decomposition defect); the classifier
runs as role `"mechanical"` (two names, one concept); 2 of 9 packs are delivery-conditional on
signals only the dead channel reads; the 7 roles collapse to 4 temperatures and 3 priorities at the
wire. Settle it at 13.2/14.2 with per-role failure and doctrine-citation rates. The non-opinion
piece: `export const ROLES = [...] as const` with `Record<Role,…>` maps should land regardless — it
makes the C-082 class a compile error.

#### MACRO-033 — OPINION: the six-kind stop vocabulary is right; resist collapsing it
**OPINION · origin PD-OPINION-001 + LAYERING-COHERENCE-005**
No measurement separates it from alternatives. The vocabulary encodes the operator's three most
load-bearing distinctions (done / waiting-on-you / broken); the failure is entirely writer-side
(MACRO-006). Removing the kinds would enshrine the current collapse. Folded into MACRO-006's
"keep six kinds" recommendation; recorded here as the explicitly-opinion half of that finding.

#### MACRO-034 — OPINION: `scripts/` interleaves two products under one name, boundary written nowhere a model looks first
**OPINION · origin NAVIGABILITY-007**
Boundary enumerated (15 files: conductor harness vs pre-existing benchmark tooling; serve.py in
both), no defect whose *cause* is the interleaving; one mitigation exists (scripts/README.md).
Navigational addition only: neither README's layout line nor scripts/README.md states which files
the conductor gate protects, so a model editing fetch_models.py gets no signal it has left the
tested region (ISSUE-109 is the caused defect, owned by enforcement). Cheap fix: a two-list
paragraph + a gate-scope note at each untested file's head. Anything stronger (moving files) needs
evidence not held. The gate-coverage half (M5 covers no `*.sh`) is folded into MACRO-016.

---

## 3. The correction clustering (all 92, by root cause) — required deliverable

Method: all 4,610 lines of CORRECTIONS.md read in full by the process-and-docs lens; each
correction assigned a primary (and where multi-causal, secondary) ROOT cause — *why the defect
existed*, distinct from P1–P13's *how it hid*. Cross-checked against sweep-corrections' CL-* classes;
no correction unassigned.

| Cluster | Primary members | Count | What it says about the DESIGN |
|---|---|---|---|
| **A. A check that inspects less than it appears to** | C-005,013,015,026,045,051,054,057,069,072,074,075,077,078,079,084,092 (+sec 039,047,052,062) | **~21 (23%)** | The signature failure. Every scanner selects its subject by open-ended enumeration; M5's file-set alone is 6 entries. Live at HEAD in the audit layer built to catch it (ISSUE-088). → MACRO-016 |
| **B. One fact/rule spelled or derived twice** | C-018,035,037,040,042,044,047,050,063,064,082,085,087 (+sec 030,057,075,083,086) | **~18** | Named "the Phase 9 theme" at C-042; ≥8 more landed after. Instances that got a *construction* stopped; those that got a *paragraph* recurred. → MACRO-001,-012,-017 |
| **C. Built but never wired / written but never read / composition deferred** | C-028,032,050,059,081 (+sec 037,044,063,087) | **~9** | Highest severity-per-entry. §8 defers all composition to task 13.1. Terminal instance = ISSUE-001 (CRITICAL). → MACRO-001,-002 |
| **D. Crash-safety / write-ordering / partial-write** | C-017,019,020,024,029,067,070,071 (+sec 031,032-E7,034,039) | **~12** | Convention-where-a-primitive-was-needed; 5 of 7 block-and-ask sites still bare at HEAD (ISSUE-100). One `blockItemWithQuestion` primitive would make it unrepresentable. → MACRO-023 |
| **E. Fixture cannot reach or discriminate the failing path** | C-033,034,046,052,053,091 (+sec 030,055,063,070,083) | **~11** | Why the build adopted mutation testing — and the adoption was ad hoc, never a gate leg; the audit layer it never reached is where step-2's survivors live. → MACRO-019 |
| **F. Trust-boundary input validation** | C-016,022,023,038,055 (+sec 020,024,029,032-E5) | **~9** | Discovery work; not preventable by structure alone. |
| **G. Environment / upstream semantics surprises** | C-002,003,004,006,009,012,021,058 (+sec 052,062) | **~10** | Every live measurement overturned an assumption. Bounds what 13.2/14.2 will find (prior: 2–4 more; step 2 pre-located three: ISSUE-105/106/107). |
| **H. Review-machinery defects** | C-031,049,082 (+sec 030,038,051,079,084) | **~8** | P10's home. Reducible via MACRO-015 (symmetric evidence, no sealing, identifier-position doctrine). |
| **I. Process / orchestration + obligation storage** | C-007,011,056,060,061,076 (+sec 057,072,074) | **~9** | Recorded-debt-never-scheduled is the dominant meta-pattern. → MACRO-017 |
| **J. Plan gaps / contradictions / unsatisfiable rows** | C-008,010,014,041 (+sec 018,042,083-row,084-row,088-frozen) | **~9** | The assertion-row lifecycle gap (satisfiability at authoring). → MACRO-020 |
| **K. Composition wedges (correct rules → a hole)** | C-084,085 (+sec 032-E11) | **3** | The sharpest defects; disposition under-modeled. → MACRO-005 |
| **L. Untested-but-correct / path never walked** | C-087,090,091 (+sec 083-debug-loop) | **~4** | P11/P12. Contained at unit level; the live launch/readiness half (ISSUE-106/108) is unwalked. |
| (Bootstrap / one-off, no class) | C-001,025,027,036,043,048,065,066,068,073,080,086,089 | 13 | Rulings, fix-completions, singletons. |

**Which clusters a different structure would have prevented entirely:**
- **A's M5 sub-family (6):** inverted selection (scan all tracked minus exemptions). Trivial then, trivial now.
- **C (9, incl. ISSUE-001):** composition-root-first manifest + per-task reachability row. A standing "unreachable exports" audit (~1 day) for the remaining work.
- **B (most of 18):** vocabulary registry + typed Role/RunState/ItemState + cross-language derivation. Incremental per ISSUE-113–125.
- **D (most of 12):** one transactional block-and-ask primitive (~1 day, ISSUE-100).
- **E (containment):** mutation testing as a first-class gate leg over the audit layer (MACRO-019).

F, G, H, J are discovery work not preventable by structure alone (H is reducible via MACRO-015).
The three biggest clusters (A, B, C) are all structural and all still live; A and C between them
produced both CRITICALs.

---

## 4. The navigability measurement (representative tasks) — required deliverable

Token estimates bytes/4 (mild BPE under-estimate); a 32k model has ~24k readable budget after
prompt/output/tool overhead. `tools.ts` = ~93k, plan = ~58k, CORRECTIONS.md = ~82k, e2e.test.ts =
~51k; total source+tests+plan+corrections ≈ 1.09M tokens ≈ 45 context windows.

| Task | Recipe exists? | Safe read cost | Fits 32k? | Failure mode if under-read |
|---|---|---|---|---|
| **A: add a tool** | yes (extending.md, 5 files named) | ~37–40k + overhead | **NO** | handler misses one of 4 obligations; audit-blind tail (ISSUE-088) |
| **B: change a gate arm** | yes | ~19k | **yes** (best case in repo) | — |
| **C: add an assertion row** | doc is stale (teaches dead `coveredByTest`) | ~15k | yes, but **nondeterministic** | row proven by nothing (118 precedents); two models pick different conventions |
| **D: fix a handler bug** | **no** (dominant task shape in the record) | ~17–21k, grep-first | yes | pinning test not found (publish has 3 pinning files); test-side navigation is the weak half |
| **E: change a vocabulary** | no | ~8k | yes | **silent** — miss the python copy, live crash months later (ISSUE-113) |

The pattern: **token cost is survivable everywhere except tools.ts-centric work; the real 32k killer
is that safety knowledge (which tests pin X, which copies of X exist, which convention is live) is
positional, not indexed.** Task B is the counter-proof that right-sizing exists in this repo (the
pure-core gate modules: single-concern 400–500-line files, same-named tests, a recipe, table-row
discipline) — the contrast with Task A measures the same codebase at its two extremes. Tasks A and E
are the two whose verdicts *cannot be fixed by reading more*: A because the destination exceeds the
budget, E because the safe read-set is unknowable in advance.

---

## 5. The IDEA register (merged, deduped; low bar by charter)

**Structural / capability upgrades (highest leverage) — all also carried to §6:**
- **IDEA-STRUCT-1** (state-crash) — OS advisory lock (flock/O_EXCL for process lifetime) → double-writer unrepresentable (ISSUE-023/024/025/028; MACRO-027).
- **IDEA-STRUCT-2** (gates-security) — filesystem sandbox confining sub-session writes to the tree → out-of-scope writes impossible not detected (ISSUE-014/016/017/018).
- **IDEA-STRUCT-3** (gates-security) — fail-safe attribution posture replacing prefix/tool enumeration (MACRO-009).
- **IDEA-STRUCT-4** (sweep-adversary) — each review lens emits proof it read the diff; flip the skeptic default to uphold (MACRO-015; ISSUE-072).
- **IDEA-STRUCT-5** (composition) — one `run.stop` closer computing kind from dispositions + a resumable-after-stop path (MACRO-005/-006).
- **IDEA-STRUCT-6** (sweep-vocabulary) — vocabulary registry + parity harness (MACRO-012).
- **IDEA-STRUCT-7** (sweep-gate-mutation) — a `revert-probe` runner: machine-applicable patch + expected failing test ids per task (MACRO-019; ISSUE-090 proved one rotted).
- **IDEA-STRUCT-8** (sweep-honesty) — "live-artifact checker ships before the artifact", + binding artifacts to run ledgers (runId + verify seq) (MACRO-029).

**New this review (macro):**
- **IDEA-LC-1 / IDEA-FWD (merged)** — REQUIRED_HOOKS completeness test for the plugin factory (MACRO-001; ~20 lines; catches C-059 + ISSUE-001).
- **IDEA-LC-2** — brand the two tree types (TreeSlug/TreePath) or carry pairs (MACRO-003).
- **IDEA-LC-3** — one exported `deriveGateFacts(store, registry, sessionID)` (MACRO-001).
- **IDEA-LC-4** — FSM API takes the run, not a caller-supplied from-state (MACRO-004).
- **IDEA-LC-5** — one core `dispositionOf(item, ctx)` for scheduler + continuation + report (MACRO-005).
- **IDEA-LC-6** — one shortcut schema pricing all three escape hatches (MACRO-007).
- **IDEA-LC-7** — a promotion criterion for core, one paragraph in conventions (MACRO-024).
- **IDEA-LC-8** — delete `sameTree` from the plugin; gates-edit exports its comparison (MACRO-001).
- **IDEA-LC-9** — record the deny rate at first live contact before flipping LC-008's posture (MACRO-009).
- **IDEA-NAV-1** — a generated code map (file → owns → size → tested-by), kept green by the gate (MACRO-010/-014/-030).
- **IDEA-NAV-2** — CORRECTIONS index + per-entry file lists (MACRO-013).
- **IDEA-NAV-3** — extending.md recipes for the two missing task shapes (fix a handler bug; change liveness) (MACRO-014).
- **IDEA-NAV-4** — bind the layout maps with existsSync rows (NAVIGABILITY-003; the README/dev-README `src/` tree does not exist).
- **IDEA-NAV-5** — update testing-and-verification.md:418 to the practiced row convention (MACRO-020).
- **IDEA-NAV-6** — a "read budget" line in future agent briefs instead of line ranges (post-split).
- **IDEA-PD-1** — `conductor_status` reports delivered doctrine per role (MACRO-022; would have exposed ISSUE-001 day one).
- **IDEA-PD-2** — journal gate-deny snapshots at the deny record's own level, not `debug` (MACRO-022).
- **IDEA-PD-3** — behavioral doc-rows via journal-driven fixtures (MACRO-021).
- **IDEA-PD-4** — `(plan §x — not yet built)` markers as a doc convention (MACRO-021; makes all ten falsehoods honest at ~zero cost).
- **IDEA-PD-5** — script-emitted taskGates rows (MACRO-018/-030).
- **IDEA-PD-6** — generated CORRECTIONS index with class tags + obligation status (MACRO-013/-017).
- **IDEA-PD-7** — troubleshooting entries for the detector-dead shapes (after the fixes land) (MACRO-022).
- **IDEA-PD-8** — skeptic doctrine gains the identifier-position rule (MACRO-015).
- **IDEA-PD-9** — a "review delivery receipt" at every layer (MACRO-015; extends the 9.5a rule).
- **IDEA-FWD-1** — a mechanical pre-live-contact preflight script (MACRO-028/-029; ~2-min go/no-go from the step-2 register).
- **IDEA-FWD-2** — spec-currency checking for assertions.json (MACRO-028).
- **IDEA-FWD-3** — amend the addendum before executing it (add tool-bindings.ts + plugin/index.ts to 17.3/18.1; state 17.4 needs ISSUE-065; note 17.5 assumes ISSUE-001 fixed) (MACRO-025/-006).
- **IDEA-FWD-4** — a generated OWNERSHIP/ARCHITECTURE page seeded from step-2's §10 ledger (MACRO-030).
- **IDEA-FWD-5** — ship the SMOKE.md / conductor-report.md checkers before the artifacts (MACRO-029).
- **IDEA-FWD-6** — a one-page sequencing note ordering the six critical-path fixes (all of Theme F).

**Carried from step 2 (endorsed, unchanged):** IDEA-ROW-1 (row-id→test-title checker), IDEA-ROW-2
(disposition field), IDEA-GATE-1/2/3, IDEA-JSONL-1 (MACRO-023), IDEA-DEDUP-1, IDEA-MANIFEST-1,
IDEA-PROC-1/2/3, IDEA-OBS-1/2/3, IDEA-ERG-1, IDEA-DOC-1, IDEA-MISC.

---

## 6. CROSS-LENS POINTERS (for the capability review, step 4)

Every IDEA-STRUCT-* above is capability input grounded in a reproduced failure. The highest-leverage,
in priority order:

1. **The wiring manifest / REQUIRED_HOOKS completeness test (MACRO-001)** is a missing *mechanism*,
   cheaper than IDEA-STRUCT-1/2, and it addresses the family that produced *both* CRITICALs (the class
   fired twice: C-059, ISSUE-001). Weigh it first.
2. **The live-ish gate leg (MACRO-002, real opencode + stub provider)** would have caught both
   CRITICALs and ISSUE-091's gap at introduction time; needs no model; belongs in the gate.
3. **`requireMetaTool` is a growth mechanism, not just ISSUE-005's fix (MACRO-004/-025)** — each new
   meta tool currently hand-rolls legality; the choke point converts a per-addition defect class into
   a table row. Score under "structural-vs-advisory upgrades".
4. **The disposition function + stop closer (MACRO-005/-006, IDEA-STRUCT-5)** is the floor-raiser for
   unattended runs — the done/waiting/wedged distinction is unbuildable until one function owns
   disposition, and Phase 17's acceptance is *unsatisfiable* without it (a scheduled-work prerequisite).
5. **Escape-hatch pricing (MACRO-007, IDEA-LC-6)** belongs in any doctrine-efficacy analysis:
   doctrine telling a model not to defer is advisory; a defer that costs budget is structural. The
   backwards incentive gradient is a *pricing* problem before it is a doctrine problem.
6. **The operator health surface (MACRO-022):** beacon + last-error/last-progress/doctrine-digest +
   a floor converting sustained hook-failure/latch-silence into a recorded stop. Grounds:
   ISSUE-033/034/065/066 reproduced; the time-to-cause table.
7. **The vocabulary registry (IDEA-STRUCT-6)** now has a quantified business case: 5–9 touch points
   per addition, ≥1 silent seam each, three new vocabularies scheduled in Phase 17. Score its
   navigation value (copies become enumerable) alongside its drift value.
8. **A standing audit-layer mutation suite (MACRO-019)** — the ~15 surviving mutations in enforcement
   §7.4 are a ready-made seed corpus; the capability that keeps every other checker honest.
9. **The record layer needs gates the way the code has gates (MACRO-013/-018/-030)** — currency stamp,
   row-id linkage, gate-record completeness — before ~12 addendum tasks land on it.
10. **Doctrine efficacy is currently counterfactual (MACRO-021/-032, FITNESS-FORWARD-004):** doctrine
    has NEVER reached a sub-session; the packs' only tested consumers are keyword anchors (ISSUE-135:
    a pack asserting the OPPOSITE of its doctrine stays green); the 14.2 arm inversion means any live
    "doctrine effect" measured through the conductor arm measures the tools.ts paraphrases.
11. **The dead state block is also the runtime navigation mechanism (NAVIGABILITY cross-pointer):**
    when weighing ISSUE-001's fix, count the recommended-next-tool block's second role — it is the
    only affordable navigation a 32k model gets at runtime, the runtime analog of IDEA-NAV-1's static
    map. Sub-file scope (line-range/symbol claims) and a repo-size budget gate row are adjacent
    missing mechanisms.

**To the enforcement review, if re-run (under-covered areas):**
- `sameTree` in plugin/index.ts is an unguarded cross-layer restatement of gates-edit.ts:196-198 that
  the step-2 vocabulary sweep did not list — worth one drift-guard row (MACRO-001).
- `ops-docs.test.ts` was bound at 25 rows by C-080 but was NOT in step-2's mutation targets; mutate
  its section-parsing helpers (`sectionsOf`/`entriesOf`) — a parser returning one giant section may
  satisfy many `assertSectionMatches` rows vacuously (~30 min; MACRO-021).
- Nothing in step 2 measured whether the e2e fake-SDK harness itself is learnable — e2e.test.ts is
  51k tokens and several step-2 fixes require new e2e rows, so a proposal's real cost includes
  learning that harness (MACRO-014).
- The four step-2 DROPPED findings (enforcement §12.2) need triage into the enforcement register: FANOUT-004
  (unvalidated `fetchMetricsSummary` cast — becomes MAJOR the moment ISSUE-038 wires it),
  SWEEP-CORRECTIONS-009 (verify-acceptance.sh fixed `/tmp` paths — a C-078 recurrence),
  SCRIPTS-PYTHON-014 (two weak acceptance detectors), SWEEP-GATE-MUTATION-010 (intermittent stamp
  test — possibly an ISSUE-134 facet).

---

## 7. Disposition of every step-2 pointer to the macro review

Step 2 left ten pointers "to the MACRO review". Each is dispositioned by the owning finding; the four
parts converged (any divergence is resolved here).

| # | Step-2 pointer | Disposition | Owning MACRO |
|---|---|---|---|
| 1 | Stop-vocabulary over-specified for the recorders that exist | **Answered:** keep all six kinds (the operator's load-bearing distinctions); build the one closer. The vocabulary is not the defect; writer-scatter is. | MACRO-006 (+ OPINION MACRO-033) |
| 2 | Enforcement locus diffuse — a `requireMetaTool` choke point | **Endorsed and extended:** the FSM API's caller-supplied from-state must go too, or the literal that bypasses the choke point today survives. Also a growth mechanism. | MACRO-004, MACRO-025 |
| 3 | "Detection by enumeration" recurring shape | **Measured one-sided:** 0 bypasses on deny-by-default vs 6+ on enumeration (security); 23% of corrections on the scanner face. Fail-safe posture endorsed with a deny-rate gate; inverted selection for scanners. | MACRO-009, MACRO-016 |
| 4 | tools.ts 9,253 lines; seam defects invisible across distance | **Taken up both halves:** navigability (~93k tokens, 22 handlers measured, split seams + migration cost) and layering (tools.ts is a hub carrying handlers + gate sequencing + the exports continuation reaches through, policy un-promoted). | MACRO-010, MACRO-024 |
| 5 | continuation.ts three engines; inject.ts dead subsystem | **Dispositioned:** inject.ts = the dead channel + live paraphrases, two mechanisms one concern (wiring necessary not sufficient); it is also the largest first-contact liability and corrupts the POC arms. continuation.ts's dependency discipline is clean (cleared area); its three-engine split is an organization question, no layering defect. | MACRO-008, MACRO-028, cleared §9 |
| 6 | Five status surfaces, no freshness contract; ledger convention changed 3× | **Confirmed and extended:** taskGates truncation at 11.8 verified; ≥5 phase-record shapes verified; the record layer exempts itself from the system's thesis. | MACRO-013, MACRO-018, MACRO-030 |
| 7 | scripts/ mixes two products; conductor/tools outside hygiene; M5 covers no *.sh | **Split:** the M5-shell-gap and scanner face → MACRO-016; the product-mixing → OPINION MACRO-034 (boundary enumerated, no caused defect beyond ISSUE-109). Layering note: the boundary violation is outward (tooling), not in the core/adapter/plugin triangle. | MACRO-016, MACRO-034 |
| 8 | types.ts interface + hand-written JSON-schema duality | **Dispositioned as contained:** verified the JSON schemas *consume* the exported enum arrays (enum drift guarded); only the shape halves are hand-doubled, plan-mandated across a frozen §2. Navigationally benign (adjacent, one file, a recipe). Counts as 2 of the 5–7 touch points per tool addition. Not urgent while §2 is frozen; generate one side first if a §2 schema churns. | context in MACRO-025; no new finding |
| 9 | UPSTREAM_CONTRACT doubles as findings ledger; CMake project still `myprogram` | **Taken up:** `myprogram` verified at CMakeLists.txt:17, folded into the layout-drift finding; UPSTREAM_CONTRACT's dual role is second-contributor evidence. Also: README/dev-README map a `src/` tree that does not exist (verified). | NAVIGABILITY-003 (→ IDEA-NAV-4), MACRO-030 |
| 10 | The gate's own availability failure (no timeout; nondeterministic red) as a design point | **Taken up:** the gate is a noisy sensor; every historical PASS is a distribution sample; the addendum grows the exposure. | MACRO-018 (+ FITNESS-FORWARD-013) |

All ten dispositioned; none dropped.

---

## 8. Coverage ledger

| Surface | Depth | By which part(s) | Conclusion / findings |
|---|---|---|---|
| `findings-enforcement.md` (2,303 ln) | read in full | all four | evidence base; every ISSUE/IDEA cited traced |
| `1-briefing.md`, `3-macro.md` | read in full | all four + merge | charter compliance |
| CORRECTIONS.md (4,610 ln, C-001…C-092) | **read in full**, every entry clustered | process-and-docs (all); layering (9 entries in full); nav/fitness (headings) | §3 clustering; MACRO-001/-015/-017 |
| plugin/index.ts (1,427 ln) | read in full | layering-coherence | MACRO-001/-003/-004; ISSUE-022 confirmed :1384 |
| core/*.ts (17 files) | import/purity scan (all); gates-phase predicates read | layering | G3 purity clean (cleared); MACRO-005 predicate inventory |
| tools.ts (9,253 ln) | structure mapped (22 handler boundaries, re-verified); regions spot-read; :200-529, :7600-7670 read | navigability (regions), layering (gate hook + policy + stop writers), merge (handler count, stop literal, EXECUTING literal re-verified) | MACRO-004/-006/-010/-024/-026 |
| continuation.ts (1,382 ln) | header + stop writers + imports | layering | cleared (dependency discipline); MACRO-005/-006 evidence |
| inject.ts | role/pack maps + grep | layering | MACRO-008, MACRO-032 |
| core/types.ts | schema region + grep | layering | pointer 8 disposition |
| OPERATIONS.md (576 ln), HONEST-LIMITS.md (174 ln) | read in full; 10 claims cross-checked | process-and-docs | MACRO-021 |
| ops-docs.test.ts (1,495 ln) | 25 titles read; binding assessed | process-and-docs | MACRO-021 (E.2) |
| GATES.json | structure enumerated (taskGates keys, phaseGates shapes) | process-and-docs | MACRO-018 |
| extending.md (529 ln) | **read in full** | navigability | MACRO-011; the concern→file map step 2 never mentions |
| README.md / dev-README / testing-and-verification.md / CMakeLists.txt | targeted | navigability | NAVIGABILITY-003 (layout drift), MACRO-020 |
| task-13.2 / task-14.2 assertions.json | read in full | fitness-forward | MACRO-028/-029 |
| addendum phases-16-19 plan | read in full | fitness-forward | MACRO-025 (omissions), MACRO-006/-030 |
| config-io.ts, tool-bindings.ts, router/config.hpp | targeted | fitness-forward | MACRO-025 (ToolSpec fallback), MACRO-031 (single Endpoint), shipped default verified |
| File census (36 conductor source + 40 test + docs/build + plan) | `wc -l -c` measured | navigability | §4 token tables |
| Import graph (core/adapter/plugin) | full mechanical scan | layering | G3 measured clean; MACRO-010 migration cost |
| **This merge session** | re-measured contested facts | merge | 22 handlers (2 greps); tools.ts 9,253 ln/371,683 B; CORRECTIONS 4,610 ln/328,987 B; 4 legalTools call sites; 3 run.stop writer sites; handleReport `"EXECUTING"` literal :7640; `kind:"done"` literal :7647 |

**Method note:** no mutations were run by the macro parts or this merge — the charter's evidence
burden is measurement / ≥3-correction pattern / step-2-cause, and every register entry is grounded in
one of the three. Where a step-2 reproduction is load-bearing (ISSUE-002, -005, -065), the parts
relied on step-2's recorded reproductions; the most load-bearing source facts (the two literals, the
call-site count, the handler count, the shipped default) were re-verified by direct read/grep this
session and matched.

**What the four macro lenses did NOT cover between them** (in addition to step-2's gaps carried
forward — `dashboard/*` outside scope, fetch_models/benchmark unexecuted, the live G5 legs): the plan
was not re-read end-to-end by any macro part (all consulted cited ranges — the subsystem lenses own
clause-level conformance); router/ and scripts/ *internal* layering was not judged (only the
cross-language seams already in step-2's register); no macro part exercised the e2e/test harness
directly; the router/dashboard C++ got no macro-lens architectural read.

---

## 9. Cleared areas (structural concerns investigated and found sound)

- **G3 dependency directions and core purity** — measured directly (import grep over all 32
  production TS files; node-builtin/clock/process grep over all 17 core files). **Zero violations
  after 92 corrections.** The mechanical half of G3 is genuinely held — the one part of this review
  that gets a clean bill.
- **The C-037 ruling-1 one-derivation principle *where applied*** — `settledForReport` verified
  exported from core (gates-phase:231) and consumed by both the gate (:416) and handleReport
  (tools.ts:7515). The pattern works when used; MACRO-024's finding is that nothing says when it MUST
  be used.
- **The registry single-map design** (plugin/index.ts:329-352) — one map, copy-at-boundary view for
  chat-message, direct writes for fan-out; the aliasing hazard is understood and designed against.
- **The override-consumption seam** — one grant map, minted by handleOverride, spent at exactly one
  choke point at the point of denial, one-shot, foreign-proof, journaled. As a *mechanism* this is
  the coherence model the other hatches should copy (MACRO-007); the free-string gate name (ISSUE-007)
  is its one hole and is a vocabulary gap, not a design gap.
- **continuation.ts's dependency discipline** — header audited against imports: every rule imported
  from its owner; the one restatement it carried (UNIVERSAL_META_TOOLS) became a derivation in C-086.
  The wedge (C-085) happened *despite* clean layering — which is why MACRO-005 blames predicate
  semantics, not the boundary.
- **The two-phase journal cycle-break** (plugin/index.ts:29-36) — a real construction cycle resolved
  with a rebindable sink and an explicit no-replay rule.
- **The gate hook's fail-closed guardedness derivation** (tools.ts:340-440) — computed once from the
  real parse; every guarded crash denies. ISSUE-014's blindness is in `hasGitSegment`'s shared
  attribution problem (MACRO-009), not in the fail-closed structure.
- **The enforcement spine** (inherited from step-2's cleared areas, not re-derived here): RED-before-
  GREEN sequence, evidence forgery resistance, the full-verify validate, publish HEAD/freshness/commit,
  the override budget arithmetic, skeptic aggregation arithmetic, the C++ router's byte-verbatim relay.
  These are the assets the shape-fixes above must not disturb.

---

## MERGE NOTES

**M.1 — What this merge did.** Reconciled four macro part files (3,215 lines) into 34 MACRO entries
under one severity/confidence standard, with a part-id→MACRO mapping (§M.2), the required 92-correction
clustering (§3, taken from the process-and-docs lens which read CORRECTIONS.md in full and cross-checked
sweep-corrections), the navigability measurement (§4), a merged IDEA register (§5), consolidated
cross-lens pointers (§6), disposition of all ten step-2 pointers (§7), and coverage/cleared ledgers.
The four parts were unusually non-overlapping (the charter's Parts A–F were cleanly divided: navigability
= A, layering-coherence = B+C, process-and-docs = D+E, fitness-forward = F), so this was more
reconciliation-of-severity than dedup-of-claims.

**M.2 — Part-id → MACRO mapping.**
- navigability: NAV-001→MACRO-010 · NAV-002→011 · NAV-003→IDEA-NAV-4 (layout-drift; folded, not a
  standalone MACRO — it is 4 text edits + a missing guard, treated as an IDEA with the guard) · NAV-004→013 ·
  NAV-005→014 · NAV-006→012 · NAV-007→OPINION MACRO-034.
- layering-coherence: LC-001→MACRO-001 · LC-002→004 · LC-003→003 · LC-004→005 · LC-005→006 · LC-006→007 ·
  LC-007→008 · LC-008→009 · LC-009→001 (merged, composition-root facet) · LC-010→023 · LC-011→024 ·
  OPINION-LC-A→MACRO-032.
- process-and-docs: PD-001→MACRO-016 · PD-002→002 · PD-003→017 · PD-004→015 · PD-005→018 · PD-006→019 ·
  PD-007→021 · PD-008→021 (comment-honesty facet, merged) · PD-009→022 · PD-010→020 · PD-011→013 (merged) ·
  OPINION-001→MACRO-033.
- fitness-forward: FF-001→MACRO-002 · FF-002→028 · FF-003→029 · FF-004→028 (arm-inversion facet, merged) ·
  FF-005→006 · FF-006→025 · FF-007→026 · FF-008→012 (merged) · FF-009→027 · FF-010→030 · FF-011→030
  (contributor facet, merged) · FF-012→031 · FF-013→018 (gate-sensor facet, merged).

**M.3 — Deduplications and severity reconciliations.**
Six cross-part merges: MACRO-001 (LC-001 the seam family + LC-009 the composition root are one family
seen from two angles); MACRO-006 (LC-005 + FF-005 + PD-OPINION-001 — the stop closer, its scheduling
weight, and the keep-six-kinds opinion); MACRO-012 (NAV-006 + FF-008 — the same vocabulary-addition
class as navigability cost and as growth cost); MACRO-013 (NAV-004 + PD-011 + FF-010 — the build record
as unreadable, as unindexed, and as decayed-at-scale); MACRO-018 (PD-005 + FF-013 — the gate records
as unschema'd and the gate binary as a noisy sensor); MACRO-021 (PD-007 doc-drift + PD-008
comment-honesty — both are the "cross-module claim with no binding" class, one in docs one in comments);
MACRO-028 (FF-002 spec-staleness + FF-004 arm-inversion — both are 13.2/14.2 specced against a dead
channel). Severity reconciliation: the four parts used four different scales (navigability had no
severity labels; layering used none; process-and-docs used none; fitness-forward used BLOCKING
implicitly). I imposed one standard (§ top). Five entries rated **BLOCKING** because they sit on the
critical path of scheduled work: MACRO-006 (Phase 17 acceptance unsatisfiable without it), MACRO-025
(the addendum's own file lists are wrong), MACRO-028 and MACRO-029 (13.2/14.2 as specced will fail or
mislead), and MACRO-002 (for future subsystems). Where a part and step-2 disagreed on an issue's
severity, I kept step-2's reconciled rating (the parts cite step-2's severities faithfully).

**M.4 — How many entries were downgraded to OPINION, and why (the charter's rigour signal).**
**Three, and only three — all self-labelled by the parts, none forced down by me.** MACRO-032 (role
count — no measurement possible because doctrine never reached a session; the *non*-opinion piece,
typed ROLES, is extracted and stated as fact), MACRO-033 (six-kind vocabulary — no measurement
separates it from alternatives; folded into MACRO-006's recommendation), MACRO-034 (scripts/ product
mixing — boundary enumerated, no *caused* defect beyond ISSUE-109). Every other candidate cleared the
bar: I checked each of the 31 non-opinion entries for a measurement, a ≥3-correction pattern, or a
step-2 reproduced defect as cause, and each has at least one (most have all three). This is a high
evidence-density review — notably higher than a macro review is prone to be — because the parts
disciplined themselves to the charter's burden and grounded structural claims in the correction
clustering and the step-2 register rather than in taste. **Two entries carry a partial-OPINION component
flagged inline in their origin text** (MACRO-030's contributor-map *remedy*; MACRO-031's forward-looking
*composition*) but their *observations* are measured, so they stay in the main register per the
"findings are the product" doctrine.

**M.5 — Factual contradictions found and resolved.**
- **Handler count.** Step-2's pointer said tools.ts carries "~15 handlers"; navigability said 22.
  Re-measured this session two ways (`grep -c "function handle"` and a count of `^export … function
  handle`): **22.** The navigability figure is correct; the step-2 estimate was low. Corrected
  throughout (MACRO-010, MACRO-025, §4). This does not change any step-2 finding's substance.
- **legalTools production call sites.** Layering said "four" (including inject.ts dead code);
  re-verified: exactly 4 (gates-phase definition + continuation probe + tools.ts:2621/:5154 + the dead
  inject.ts:117). Correct.
- **CORRECTIONS.md token size.** Navigability said ~82k; process-and-docs said ~65–70k. Both are
  bytes/N estimates of the same 4,610-line / 328,987-byte file (re-verified). bytes/4 = ~82k;
  bytes/4.7 = ~70k. The discrepancy is estimator choice, not a fact conflict; both agree it is >2× a
  32k budget, which is the load-bearing claim. Recorded as ~82k (bytes/4, consistent with §4).
- **No substantive contradictions between parts on any finding.** The four lenses were disjoint in
  scope and their overlaps (inject.ts deadness, the stop-kind closer, tools.ts size, the record layer)
  agreed on facts and differed only in framing angle, which the merges above reconcile.

**M.6 — What the four macro lenses did NOT cover between them** (beyond the coverage ledger's list):
no macro lens judged the *internal* architecture of the C++ router or the dashboard (step-2's
`dashboard/*` gap persists and is now also a macro gap); no lens measured whether the proposed
mechanisms (wiring manifest, disposition function, vocabulary registry) *compose* with each other —
they are proposed independently and a consolidation pass in step 4 should check they do not conflict
(e.g. `dispositionOf` and the stop closer share a disposition enum by design, but the wiring manifest
and the vocabulary registry both want to own "the declaration of what must exist" and should be one
mechanism, not two); and no lens costed the *aggregate* migration if all the BLOCKING + MAJOR
structural fixes were done together (each part costed its own fixes in isolation — the capability
review's consolidated plan should sequence them, since MACRO-010's tools.ts split should precede the
ISSUE-001/-002 wiring, which should precede 13.2, which the vocabulary/record-gate work should also
precede).

**M.7 — Ceremony report (per briefing §5.1).** No mandated analysis was busywork on this codebase.
The correction clustering (§3) changed the conclusion — the parts and I both expected the two-spellings
class (B) to dominate and found the check-inspects-less class (A) larger and still live. The
navigability measurement (§4) produced the sharpest single result (Task A does not fit 32k in the
system's own target-model budget). The one place the format fought a finding: the layout-drift item
(README maps a non-existent `src/` tree) is four text edits plus a missing guard — too small for a
full MACRO record, too structural (the *navigational* docs have no drift guard at all, unlike operator
docs) to drop — so it is filed as IDEA-NAV-4 with its structural half noted under MACRO-030, rather
than forced into the register template. That is the only departure from the register shape.
