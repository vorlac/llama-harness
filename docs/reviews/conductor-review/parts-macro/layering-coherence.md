# MACRO Part — Layering, Responsibility, and Design Coherence

**Reviewer scope:** Part B (layering and responsibility) + Part C (design coherence) of
`3-macro.md`. Specifically: the G3 pure-core / thin-adapter split; dependency directions; where
responsibility for single concerns lives (the gate regime across `core/gates-*.ts`,
`adapter/tools.ts`, `plugin/index.ts`); the composition root; competing philosophies
(detection vs prevention); design-level concept duplication (two mechanisms, one job); the
7-role / 9-pack decomposition; the run/item FSM pair and "settled but not finished" states.

**Date:** 2026-08-16
**Evidence base:** `findings-enforcement.md` (read in full, 2,303 lines), `docs/build/CORRECTIONS.md`
(headings enumerated; C-037, C-050, C-053, C-059, C-082, C-083, C-084, C-085, C-086 read in full),
`conductor/plugin/index.ts` (read in full, 1,427 lines), targeted reads of `adapter/tools.ts`
(gate hook + report-close regions), `adapter/continuation.ts` (header + stop writers),
`adapter/inject.ts` (role maps), `core/types.ts` (schema region), plus repo-wide import-graph and
call-site measurements reproduced inline. Every finding cites a measurement, a ≥3-correction
pattern, or a step-2 defect with a structural cause — or is labelled OPINION.

---

## Headline verdict for this scope

**The G3 boundary itself is sound and measurably held. What the design lacks is a *contract for
composition*.** The import graph is perfectly layered (measured below: core imports only core;
adapter imports core + node builtins; plugin imports adapter/core; zero inversions), core is pure
(zero I/O, zero clock, zero `process.*` across all 17 files), and the one-derivation-in-core
principle (C-037 ruling 1) demonstrably stuck where it was applied. Yet the single largest defect
family in the whole record — **14 corrections plus at least 8 live step-2 issues, including both
CRITICALs** — is the same shape: *a module built correctly on one side of a seam, and the
obligation to connect it or to feed it real facts living in no task, no type, and no test*. The
boundary is not at fault, and "discipline" is the wrong diagnosis for a failure that recurred 20+
times under the most correction-hungry build process I have ever read: a seam whose only
enforcement is convention plus after-the-fact source-text scanners will keep producing exactly
these defects. Findings LC-001 and LC-009 carry the count and the proposed contract.

---

## Findings register (LAYERING-COHERENCE-NNN)

### LAYERING-COHERENCE-001 — The composition seam is the system's dominant defect factory, and it has no contract

**THE OBSERVATION.** The pure-core / thin-adapter / composition-root design means every
enforcement decision is split three ways: core owns the *rule*, the adapter owns the *assembly and
sequencing*, and the plugin owns the *facts* (derived per call from live state). Each crossing of
that seam is an obligation that exists only as convention. Counting the record:

Corrections in the class "built on one side, never connected / fed literals on the other":

| # | Correction | The seam failure |
|---|---|---|
| 1 | C-032 F5 (parked) | §4.2 readiness rule written twice, gate and handler |
| 2 | C-037 r.1 | report precondition: handler drafted stricter than gate — divergence-in-waiting |
| 3 | C-037 r.4 | `store.addStaleRed` had ZERO production callers; both report tasks assumed registration existed |
| 4 | C-037 r.5 | tree slug vs path: "No committed code maps between them" — freeze silently dead in worktree mode |
| 5 | C-037 r.6 | worktree cleanup: draft assumed `archiveRun` did what only worktrees.ts can |
| 6 | C-050 | wave driver had no executor for 3 of 7 stages that existed and were directly callable |
| 7 | C-053 | item review hardcoded `tree: STAGE_TREE` while every sibling stage derived it — right by coincidence until C-050 activated it |
| 8 | C-059 | `handleChatMessage` — Task 5.4's *entire deliverable* — unreachable: plugin never registered the hook. 40 tasks green |
| 9 | C-047 | two tools' declared arg shapes made their handlers unable to succeed at all |
| 10 | C-044 | tool surface and handler surface disagreed "in more places than C-035" |
| 11 | C-035 | `handleQueueAmend` signature contradicted its own tool |
| 12 | C-082 | gate snapshot passed `[]`/`null` literals; core's implementer/testWriter/freeze arms had NO production caller for the whole build |
| 13 | C-084/C-085 | three individually-correct rules (2 in core, 1 in adapter) composed into the undetectable wedge |
| 14 | C-086(b) | `UNIVERSAL_META_TOOLS`: adapter restated four names gates-phase owns |

Step-2 issues live at HEAD, same class: **ISSUE-001** (the entire §6.4 injection layer — built,
tested, never wired; CRITICAL), **ISSUE-002** (fan-out hands the edit gate the slug `"main"` where
it needs a path; default config denies every write; CRITICAL), **ISSUE-022** (`runActive: true`
hardcoded at the plugin seam), **ISSUE-030** (abandonment fence proxies StateStore only; evidence/
questions/fanout bypass), **ISSUE-038/-039** (metrics never composed into report deps;
`metricsPartial` written and read by nothing), **ISSUE-065** (`blocked`/`surfaced` computed by
core, written by nothing — "a delegation ring with no writer"), **ISSUE-043** (the C++ schema
regeneration never wired into CMake; the cross-language contract guarded by nothing automatic).

That is ~22 instances of one family, spanning the entire build's lifetime (C-035 is Phase 9,
ISSUE-001 is HEAD), and it includes **both** step-2 CRITICALs. No other root-cause family comes
close (P1's ten recorded appearances are the nearest, and several of *those* — C-059's "the gate
asks whether the module behaves; it never asks whether anything calls it" — are this family seen
from the test side).

**THE CONSEQUENCE.** The two CRITICALs mean the shipped default configuration cannot deliver
doctrine to any session and cannot accept any sub-session write — the harness's thesis mechanism
and its ability to do work at all, both lost at the composition seam while 1,382 tests stay green.
Historically the same family cost: a freeze that could never fire (C-037 r.5), a gate whose three
arms were unreachable for the whole build (C-082), a run-creation path that did not exist in
production for 40 tasks (C-059).

**WHY IT IS STRUCTURAL, NOT LOCAL.** Each instance was individually fixed (C-037's ruling even
minted the right principle: "a rule the gate enforces and a handler re-checks must have exactly one
derivation, exported from core" — and where applied, it held; see Cleared areas). The family
recurred anyway, because the fixes address instances while the seam itself still has no
verification surface: (a) core's fact-parameters are ordinary primitives, so a literal
type-checks identically to a derivation — the build had to invent a *source-text regex scanner*
(`legaltools-callsites.test.ts`, C-048) to police one argument of one function, and step 2 showed
that scanner class is itself blind (ISSUE-088); (b) hook registration completeness is checked
nowhere — C-059's proposed detector ("every adapter module is reachable from plugin/index.ts") was
recorded as "now worth having" and never built, after which ISSUE-001 happened, which is the same
defect one size larger; (c) building a module and wiring a module are separate obligations, but
the §8 manifest only ever scheduled the building (the briefing confirms: "no task wired it").

**WHAT A BETTER SHAPE LOOKS LIKE.**
1. **A wiring manifest with a completeness test.** Core owns a small declaration of what the
   composed system must contain: the hook names the plugin must register (from §5/§6.4), the
   adapter modules that must be reachable from `plugin/index.ts`, the stop kinds that must have a
   writer. One test constructs the plugin factory with a synthetic PluginInput and compares the
   returned hook keys and the import-reachability set against the declaration. ~1 day; would have
   caught C-059 and ISSUE-001 outright, and ISSUE-065 in its stop-kind form.
2. **Facts as a typed bundle with one derivation site.** Move `gateScopesFor`/`freezeTreeFor`/
   `runActive`/`inlineClaimScope` assembly out of the plugin into one exported adapter function
   `deriveGateFacts(store, registry, sessionID): GateFacts`, unit-testable without opencode, and
   have the plugin pass only `GateFacts`. A literal then has exactly one place to hide instead of
   eight parameters at one call site. Cost: refactor of one call site plus tests, ~1 day; kills the
   C-082/ISSUE-022 shape by construction.
3. Where a fact crosses a language (ISSUE-043): the regeneration step in the consumer's build, as
   the 11.1 deviation already promised.

**PLAN IMPACT.** None to the immutable plan's text — this is entirely about how §5.3/§6.4
composition obligations are *verified*. The §8 manifest's lesson (wiring tasks must exist as
first-class tasks) belongs in whatever plans the remaining work.

**WHAT WOULD CHANGE MY MIND.** Evidence that the family count is inflated — i.e. that the ~22
instances trace to several unrelated causes such that no single mechanism would have prevented a
majority of them. I attempted this refutation: the closest split is "never-wired module" (C-059,
ISSUE-001, ISSUE-038, ISSUE-043, C-037 r.4, C-050) vs "literal where a derivation belongs" (C-082,
C-053, ISSUE-022, ISSUE-002, handleReport's `"EXECUTING"`) — but the two proposed guards (wiring
manifest; typed fact bundle) cover the two halves respectively, and both halves are seam failures
invisible to unit tests by construction. The refutation fails.

---

### LAYERING-COHERENCE-002 — "May this tool run now?" has three mechanisms, no owner, and an FSM API that trusts callers to say where the run is

**THE OBSERVATION.** Measured at HEAD: `legalTools` (core/gates-phase.ts:272) has exactly four
production call sites — `tools.ts:2621` (`requireStageTool`), `tools.ts:5154` (`waveVerdict`),
`continuation.ts:662` (the UNIVERSAL_META_TOOLS probe over a synthetic empty position), and
`inject.ts:117` (**dead code** — ISSUE-001). So the question "is this tool legal in this run
state?" is answered by: (1) `requireStageTool`, per-handler, for the 6 stage tools; (2)
`waveVerdict`, for dispatch; (3) the advisory state block — designed as the compensating control
for everything else and never delivered; (4) *nothing*, for the 11 meta tools and
`conductor_classify` (ISSUE-005, reproduced three ways: state-clobbering re-classify; defer-all →
`done` from DECOMPOSED; inline_claim on a terminal run). Separately, core's FSM API is
`legalRunTransition(from, to, ctx)` — the caller supplies `from`. Six call sites pass `run.state`;
the seventh, `handleReport` at tools.ts:7640, passes the literal `"EXECUTING"` — and the adjacent
journal line (tools.ts:7664) hardcodes `from: "EXECUTING"` too, so on the defer-all path the FSM
is bypassed *and the journal lies about the edge that was taken*.

**THE CONSEQUENCE.** Reproduced by step 2: a run closed `done`/REPORTED from DECOMPOSED, skipping
PLANNED/PLAN_REVIEWED/EXECUTING (ISSUE-005 R1); classification-shopping resetting a GREEN item
(A-001); G8 edit permission re-opened on a REPORTED run (R2). These are not three bugs; they are
one absence — the absence of the choke point — observed from three tools.

**WHY IT IS STRUCTURAL, NOT LOCAL.** The §3.4 design is "each handler does legality first" — a
per-handler discipline pattern. That discipline was applied 6 times out of 18 tool bindings, and
one of the 6 applications feeds the check a literal. A discipline with a 33% application rate
across one file is not a discipline problem; it is a missing structural home. The design *had* a
second home for this concern — the §6.4 state block naming the recommended/legal tools — which
makes ISSUE-005 also a P7: the mechanical layer's designer could reasonably believe the advisory
layer bounded the damage, and the advisory layer does not exist. Note also that the phase-legality
concern is currently smeared across `core/gates-phase.ts` (rule), `adapter/tools.ts:2566`
(`requireStageTool`, stage tools only), `adapter/tools.ts:5135` (`waveVerdict`), and
`plugin/index.ts` `runTool` (which dispatches every tool and checks only args) — four files, none
of which is the owner.

**WHAT A BETTER SHAPE LOOKS LIKE.** One `requireToolLegal(tool, store, runId)` consulted in
`runTool`/the adapter dispatch for *every* `conductor_*` name (step 2's fix direction, endorsed
here as the structural simplification, not just a patch): the 6 per-handler checks become
redundant defense-in-depth rather than the only line. And change core's FSM surface from
`legalRunTransition(from, to, ctx)` to `advanceRun(run, to, ctx)` (or keep the pure form but have
core read `run.state` from a passed run object), making a from-state literal *inexpressible* at
call sites. Cost: the choke point is ~30 lines plus tests; the FSM signature change touches 7 call
sites mechanically.

**PLAN IMPACT.** §3.4's "legality → derive → persist → journal" loop stays; this centralizes the
legality step. The §3.5 table's restriction of only *unregistered* sessions (ISSUE-006's design
half) should gain a row when the plan is next revised.

**WHAT WOULD CHANGE MY MIND.** A demonstration that meta-tool position-freedom is intended by the
plan (i.e. §3.2 deliberately lets classify/defer/report run anywhere and the FSM edges alone are
meant to bound them). I checked: `handleReport` hardcoding the from-state means the FSM edges do
NOT bound report, so under that reading the defect merely moves from "no gate" to "the one bound
that was intended is defeated by a literal" — the structural conclusion (make the literal
inexpressible) survives either reading.

---

### LAYERING-COHERENCE-003 — "Tree" is one string type carrying two meanings, and the design chose a translation function over a type; the class struck three times

**THE OBSERVATION.** C-037 ruling 5 named it first, and named it "architectural": evidence.ts's
`tree` is an item-id SLUG (`assertSafeId` rejects `/`); gates-edit.ts's `tree` is a filesystem
PATH (`normalizeUnderTree` strips it as a prefix); "No committed code maps between them". The fix
was a translation function (`verifyInFlightTreeFor`) at the gate-wiring layer. The class then
recurred: C-053 (all four item-review job builders hardcoded `tree: STAGE_TREE` — a slug-flavored
constant that happened to be path-correct in the default mode); and at HEAD, ISSUE-002
(`sessionTreeOf = item.worktree ?? "main"` — the fan-out registers the evidence-layer slug as the
session's tree, the gate compares it as a path, `normalizeUnderTree(path,"main")` is null, every
sub-session write in the shipped default mode denies; CRITICAL). The composition root's own
comments narrate the duality twice (plugin/index.ts:692-698, 838-849) — the seam is understood,
documented, and still misfed.

**THE CONSEQUENCE.** ISSUE-002 is the consequence: the default configuration cannot do work with
a real model. Before that, C-037 r.5's version was "the freeze would silently never fire in
worktree mode", and C-053's was reviewers judging a tree without the change under review.

**WHY IT IS STRUCTURAL, NOT LOCAL.** Three recurrences after the concept was explicitly
identified and a committed translator existed. Every new dispatch/registration site must
*remember* to translate; both sides are `string`, so the compiler is indifferent, and the failure
is invisible in every test that uses worktree-mode fixtures or literal-path scopes (which is why
the one shape production defaults to — no worktree — is composed by no test). Fixing ISSUE-002
fixes the fourth instance; nothing prevents the fifth.

**WHAT A BETTER SHAPE LOOKS LIKE.** Make the two meanings two types. Cheapest: carry both fields
where the concept crosses the seam — `FanoutJob`/`RegistryEntry` gain `{ treeSlug, treePath }`
with the translation applied at ONE construction site; the gate consumes `treePath`, the evidence
layer `treeSlug`. Stronger: nominal branding (`type TreeSlug = string & {__slug: true}`) so
mixing them is a compile error. Cost: mechanical rename across fan-out/registry/gate-snapshot
(~15 sites), no behavior change; the ISSUE-002 fix becomes the natural first step.

**PLAN IMPACT.** None; §2/§3.5 do not prescribe the string representation.

**WHAT WOULD CHANGE MY MIND.** If the three instances were shown to be one instance propagated by
copy-paste (a single origin site), the "recurring class" claim weakens to an ISSUE. They are not:
C-037 r.5 is the evidence↔gate seam, C-053 is item-review's job builders, ISSUE-002 is the wave
dispatch path — three independent authorship events across three files.

---

### LAYERING-COHERENCE-004 — The run/item FSM pair under-models *disposition*: every recorded wedge lives in a disagreement between derived predicates the FSM forces everyone to compute

**THE OBSERVATION.** The item FSM is a linear pipeline (PENDING→RED→TEST_VETTED→GREEN→VALIDATED→
REVIEWED→PUBLISHED) plus DEFERRED, with `blocked`/`deferred`/`debugging`/taint carried as
orthogonal flags. "Is this item finished / waiting / hopeless?" is therefore not a state — it is
recomputed by at least four core predicates with subtly different closures: `isSettled`
(gates-phase:172), `cannotEverPublish` ("stuck", :192), `settledForReport` (= settled ∪ stuck ∪
no-git-REVIEWED, :231), and the continuation engine's actionability condition (C-085's landed
form: "an unfinished item AND a legal tool outside the always-legal baseline"). The recorded
"settled but not finished" strain points, gathered per the charter:

1. **C-084/C-085 (the wedge):** blocked item + dependent — neither settled nor stuck nor
   actionable; run sits in EXECUTING forever. The spec's own SG-4 row prescribed a queue shape the
   product could not reach (P8) until C-085.
2. **ISSUE-066 (live):** blocked item + dependent now ends `noop` with the run archived and the
   documented `conductor_answer` resume path dead — work lost on the *honest* path.
3. **ISSUE-067 (live, latent):** blocked without a question + dependent = permanently silent
   wedge, with a committed test (`[10.1-idle-null-recommendation]`) enshrining the silence.
4. **ISSUE-068 (live):** under no-git, REVIEWED is terminal for the item (C-037 r.2's ruling) but
   `nextWave` still treats it as a candidate; the recommendation path wedges on it.
5. **ISSUE-055 (live):** a red re-validate inside item_review throws into VALIDATED-with-broken-
   tree — a position no offered tool can service; three futile passes end `noop`.
6. **ISSUE-050 (live):** worktree publish conflict demotes to GREEN "re-validate and try again",
   but the changes are already committed on the branch — the FSM position says redo work whose
   artifact exists; second publish finds "nothing to commit" and wedges.
7. **ISSUE-065 (live):** at run level, the §2.9 stop vocabulary distinguishes `done`/`blocked`/
   `surfaced`, but disposition is computed nowhere that writes — see LC-005.

**THE CONSEQUENCE.** C-085 called the wedge "precisely the wedge §3.7 exists to end, and the one
shape it could not see". ISSUE-066's incentive inversion (honest waiting → `noop` + lost work;
lazy defer-all → clean `done`) is the composed behavior of these predicates today.

**WHY IT IS STRUCTURAL, NOT LOCAL.** Items 1–7 were found by four different lenses across two
review generations, and each fix so far (C-085's re-prompt condition; the proposed fixes on
ISSUE-055/-050/-066) adjusts *one consumer's* predicate. The predicates disagree because
disposition is a derived, per-consumer computation over state+flags rather than a modeled fact.
Notably the FSM itself never strained on its *edges* — mutation testing showed the edge
enforcement binds (step-2 mutation table: exit-0-as-red, bogus RUN_STATE, settledForReport
mutations all caught). The strain is entirely in the derived layer the linear FSM forces into
existence. Fixing instances 2–6 individually leaves the next blocked/demoted/publish-suppressed
combination to be discovered by the next wedge.

**WHAT A BETTER SHAPE LOOKS LIKE.** One core function
`dispositionOf(item, ctx): "actionable" | "waiting-human" | "stuck" | "settled"` — the single
derivation C-037 r.1's principle already demands for gate/handler pairs, extended to the
scheduler (`nextWave` skips non-actionable, closing ISSUE-068's class), the continuation engine
(re-prompt iff any item actionable; detectable-wait iff any waiting-human — closing 1/3's class),
and the report closer (LC-005). The item FSM keeps its edges untouched; the flags stay; only the
interpretations consolidate. Cost: the predicates already exist in gates-phase — this is a
consolidation plus 3 consumer migrations, ~2–3 days, no schema change.

**PLAN IMPACT.** §3.2's isSettled prose and §3.7.1's actionability prose would be *implemented by*
one function instead of paraphrased at each consumer; no plan text change required. The §2.5
schema needs nothing (disposition stays derived — modeling it as a stored state would create a
new two-spellings problem against the flags).

**WHAT WOULD CHANGE MY MIND.** If the seven strain points reduced to two unrelated causes (say,
"no-git is half-implemented" + "blocked-deps"), a targeted pair of fixes would beat consolidation.
I tried that split: items 4 is no-git, 6 is worktrees, 1/2/3 are blocked-deps, 5 is review — four
categories, which is the argument *for* the consolidation, not against it: each new orthogonal
mode (no-git, worktrees, debug) has independently minted a new disposition hole.

---

### LAYERING-COHERENCE-005 — The stop vocabulary is right; what is missing is the single closer that computes the kind (answering step 2's design question)

**THE OBSERVATION.** Step 2's pointer asks whether `blocked`/`surfaced` should be separate kinds
or the closer should learn to write them. Measured at HEAD: §2.9 defines 6 stop kinds; there are
exactly 3 writer sites (`handleReport` tools.ts:7647 — hardcodes `kind:"done"` as a *type-level
literal*; the continuation engine continuation.ts:585 — writes `noop`/`env`/`interrupt` from
`shouldTerminate`; the override-exhaustion path tools.ts:7913 — `env`). `shouldTerminate`
computes `blocked` and `surfaced` and its one consumer defers both to `conductor_report`, which
cannot write them. So the vocabulary is 6, the writable set is 4, and no single site is
*responsible* for the mapping from run disposition to stop kind.

**THE CONSEQUENCE.** ISSUE-065 reproduced: a run whose every item waits on a human closes
`done` — "the run completed" — the worst possible operator signal for an unattended harness. The
capability pointer already notes this is the most load-bearing operator distinction the system
collapses.

**WHY IT IS STRUCTURAL, NOT LOCAL.** Wiring `handleReport` to select a kind (step 2's fix) is
right but insufficient as long as three sites each own a slice of the mapping: the next stop kind
(or the next terminal path — see ISSUE-061's stop-before-report ordering) re-opens the gap. The
closed vocabulary lives in core/types; the mapping from dispositions to kinds exists nowhere; the
writers are scattered across two adapter files. A closed vocabulary with no owning closer is
"over-specified for the recorders that exist" — the answer to the pointer's question is: **keep
all six kinds** (they are the operator-facing truth), and give the system ONE closer.

**WHAT A BETTER SHAPE LOOKS LIKE.** IDEA-STRUCT-5, endorsed and sharpened: one core function
`stopKindOf(dispositions, cause)` (a total function over LC-004's disposition enum plus the
env/interrupt causes), and one adapter closer through which every terminal path runs — report,
futility, override exhaustion, halt. Exhaustive-by-construction: a `satisfies` over STOP_KINDS
proves every kind has a producing branch. Cost: ~1 day; subsumes the ISSUE-065 fix.

**PLAN IMPACT.** §2.9's vocabulary is unchanged. §3.2's `done` row vs §3.3's blocked-items clause
(ISSUE-053's contradiction) must be reconciled when the plan is next revised — the closer forces
that decision explicitly, which is a benefit.

**WHAT WOULD CHANGE MY MIND.** Evidence that `blocked` and `surfaced` are operationally
indistinguishable for the operator (both mean "a human must act"), which would argue for merging
them to one kind and simplifying the closer. Plausible — but the §2.9 renderer already
distinguishes them and the distinction costs nothing once a closer exists, so the merge would be
taste, not structure.

---

### LAYERING-COHERENCE-006 — Three escape hatches with three price tags, and the cheapest one has the weakest audit trail: the incentive gradient is a design property, not a bug

**THE OBSERVATION.** The design offers a model three ways around the standard pipeline, priced
wildly differently:

| Hatch | Legality gate | Budget | Taint | Audit record | Provenance |
|---|---|---|---|---|---|
| `conductor_override` | budget re-derived from BOTH meters; exhaustion = env stop | yes (per-item + per-run) | yes (§2.8) | anomaly + journal at warn | honest ("override") |
| `conductor_inline_claim` | none on terminal runs (ISSUE-005); expiry unimplemented (ISSUE-057) | no | no | decision record (scored) | honest |
| `conductor_defer` | none — legal in every non-terminal state | no | no | decision record | **forged `kind:"human"`** (ISSUE-052), contradicting the C-044 ruling one file over |

The adversary log's measured result: the cheapest full-run escape is classify → decompose →
defer-all → report, closing `done` with a green closing verify and forged human-decision records;
meanwhile honest use of the *expensive* hatch is punished (ISSUE-007: the plan's own worked
example `{"gate":"phase-order"}` burns budget on an unspendable gate and the third attempt kills
the run), and honest *waiting* gets `noop` with work lost (ISSUE-066).

**THE CONSEQUENCE.** "The incentive gradient runs backwards" (step 2's through-line). For a
system whose entire thesis is extracting quality from a lazy model by making the lazy path
expensive, a free hatch with human-authority provenance is a thesis-level incoherence, already
demonstrated end-to-end against the real handlers.

**WHY IT IS STRUCTURAL, NOT LOCAL.** Fixing ISSUE-052 (record `kind:"derived"`) removes the
forgery but not the gradient: defer would still be free, unbudgeted, untainted, and legal
anywhere, while override stays budgeted and tainted. The three hatches were designed in three
plan sections (§3.6 ×2, §2.4-adjacent defer) with no shared cost model; nothing *composes* their
prices. The coherent design question — "what should each shortcut cost, relative to the others,
so the cheapest path is the honest one?" — has never been asked anywhere in the record.

**WHAT A BETTER SHAPE LOOKS LIKE.** One shortcut schema: every process-shortcut (override, claim,
defer) writes the same triple — a budget consumption (sized by impact: defer-an-item ≥ override-
a-gate), a taint/anomaly mark, and an honest provenance kind. A defer-dominated settled set is
then *visible in the report by construction* (count of tainted dispositions), instead of needing
ISSUE-052's suggested special-case flag. Cost: schema addition (§2.8-shaped), 3 handler edits,
report rendering; ~2 days plus a plan deviation record for the defer budget.

**PLAN IMPACT.** Real: §3.6 defines budgets for override only; pricing defer requires a recorded
deviation or a plan revision. That is the point — the plan itself carries the pricing
incoherence, and this is a finding about the design, not a change to make silently.

**WHAT WOULD CHANGE MY MIND.** Evidence that deferral is *supposed* to be free because a deferred
item is visible in the report and a human reviews every report (i.e. detection is the intended
control). The report does render deferrals — but ISSUE-051 shows answered questions vanish and
ISSUE-052 shows the provenance reads "human", so the rendered record actively *launders* the lazy
path today. Under a fixed report the free-defer design would be defensible for attended runs;
for the unattended use case (the plan's stated target), a free hatch remains incoherent.

---

### LAYERING-COHERENCE-007 — Doctrine exists twice at the design level: a dead cross-cutting channel and a live set of hand-inlined paraphrases — the general lesson is that a cross-cutting concern with no composition task gets reimplemented at every consumer

**THE OBSERVATION.** The §6.4 design is one delivery mechanism: packs on disk → `loadPacks`
(fail-closed) → `buildSystemAppend` → every session's system prompt. Measured reality (ISSUE-001/
-003): the channel is fully built, fully tested, operator-repointable (`ENV_DOCTRINE_DIR`),
anchor-tested — and has zero production callers. The doctrine that sub-sessions actually receive
is a SECOND mechanism: hand-written paraphrases inside `tools.ts` dispatch prompts (decompose
~1267, plan ~1471, review ~1755, skeptic ~1787, tdd 2868), with no drift guard in either
direction. Only `debug.md`'s content is ever read from the pack map. Meanwhile the fail-closed
machinery guards the dead mechanism: `ensurePacks` (plugin/index.ts:664) refuses every tool call
if a pack is missing — the system will halt to protect the integrity of doctrine it will then not
deliver. And `receive-review.md`'s delivery trigger (`registryEntry.receivingReview`,
inject.ts:69-72) is a signal only the dead channel reads — C-028's own recorded rule ("a pack
that is loaded but never delivered governs nothing") is violated at HEAD by the mechanism built
in response to it.

**THE CONSEQUENCE.** Beyond ISSUE-001's direct consequences: every doctrine improvement made to
the packs (the anchor-tested, reviewed surface) changes nothing a session sees; every prompt
paraphrase drift is invisible; the operator override is ~95% theater (ISSUE-003). Two
authoritative sources for one concern, where the maintained one is inert and the live one is
unowned.

**WHY IT IS STRUCTURAL, NOT LOCAL.** The generalizable mechanism: injection was designed as a
cross-cutting channel but implemented as a *module* (inject.ts, Task 8.2) whose wiring appeared
in no §8 task — and every dispatch site needed doctrine *now*, so each inlined its own. This is
what always happens to a cross-cutting concern that has no composition-root task: it gets
reimplemented locally, N times, unguarded. Wiring ISSUE-001 does not by itself resolve the
duplication — the paraphrases will then *conflict* with the arriving packs unless deliberately
removed or derived (ISSUE-003's fix direction).

**WHAT A BETTER SHAPE LOOKS LIKE.** After ISSUE-001's wiring: dispatch prompts *compose from the
loaded pack map* (the existing debugFixPrompt pattern) so doctrine has one source and the prompt
site holds only the task-specific framing; any residual paraphrase gets a drift guard against its
pack. Cost: 5 prompt-site refactors, each mechanical, after the injection wiring lands.

**PLAN IMPACT.** None; §6.4 already specifies the single-channel design — this restores it.

**WHAT WOULD CHANGE MY MIND.** Evidence the paraphrases are deliberate *per-stage* doctrine
(narrower than the packs by intent, to save sub-session context). Plausible for a 32k model —
but then the design decision "stage prompts carry stage-scoped doctrine; packs are for the
system-prompt channel" exists in no recorded decision, no deviation, and no comment, and the two
surfaces still need a derivation or a guard. The finding survives as "one concern, two unguarded
spellings" either way.

---

### LAYERING-COHERENCE-008 — Two security postures coexist in the gate layer, and every reproduced bypass sits on the enumeration side: the split is accidental, not principled

**THE OBSERVATION.** The gate layer applies deny-by-default in some positions and
allow-unless-enumerated in others, in the same files:

Deny-by-default positions (step-2 verdict: **held under attack, zero bypasses**): git verb
classification (default-deny; the DESTRUCTIVE list is decorative *because* default-deny catches
it — step-2 mutation table); the session registry (unregistered write/conductor denied; spawn
denied unconditionally); the gate-snapshot derivations (every missing precondition → NO_GATE_SCOPE
→ deny; composition-injection M1/M2 bind); quote/expansion evasion (`hasUnresolvedExpansion`
fail-safe deny).

Enumeration positions (step-2 verdict: **six reproduced bypasses**): `GIT_WRAPPERS` (5 names;
`nice`/`nohup`/`if`/`while` hide a git write — ISSUE-014, which also strips the fail-closed
crash guard since `hasGitSegment` shares the blindness); `-c` config-key handling (pager/
diff.external arbitrary execution — ISSUE-015); basename `=== "git"` (misses `git-apply` —
ISSUE-019); `BRANCH_MUTATING` token list (`--set-upstream-to=` glued form — ISSUE-020);
`WRITE_TOOLS`/write-shape command enumeration (`cp -t`, `sed --expression=`, patch bodies —
ISSUE-017/-018, where an unrecognized write shape classifies the tool as "read" and even the
*registry* gate passes it); checkout discard-flag list (missing `-p` — ISSUE-021).

Score: 0 bypasses on one posture, 6+ on the other, in the same layer, sometimes in the same
function.

**THE CONSEQUENCE.** ISSUE-014/-015 are real arbitrary-write/arbitrary-execution routes, and two
of HONEST-LIMITS.md's closure claims are falsified by them — the disclosure document inherits the
posture confusion.

**WHY IT IS STRUCTURAL, NOT LOCAL.** Each enumeration hole is individually patchable (add
`nice`, add `-p`, add `git-*`), and the record shows that treadmill already running: C-022 (4 gate
bypasses), C-023 (wrapper-with-flags), C-065 (fix brief wrong about the git gate) — the wrapper
list has been patched at least twice and ISSUE-014's list of missed prefixes is open-ended ("No
hand-written prefix list can be complete", step 2). The structural fact: the codebase *knows* the
right posture — it applies fail-safe deny wherever attribution succeeds — but falls back to
enumeration exactly where attribution is hard (prefix words, config keys, write-shape flags),
which is exactly where an adversary goes. The philosophy split is not recorded as a decision
anywhere; it is the residue of patch history. That makes it accidental, per Part C's question.

**WHAT A BETTER SHAPE LOOKS LIKE.** IDEA-STRUCT-3, endorsed with this measurement as its
justification: invert the default at the attribution boundary — a bash command containing a
token that basename-resolves to `git` (or any registered write tool) in a position the parser
cannot fully attribute is DENIED, and compound/keyword-prefixed commands the parser cannot
attribute are denied for write-capable sessions. The enumerations then become allow-lists for
*known-benign* shapes (the direction enumeration is safe in). Cost: gates-git/shell-parse rework
~2-3 days + a false-positive pass over the e2e corpus; the trade is a few spurious denies (each
overridable via the existing hatch) against an open-ended bypass class.

**PLAN IMPACT.** §3.5/G7's DENY-plus-documented-residuals stance is unchanged; the residual list
shrinks from open-ended to enumerable. HONEST-LIMITS.md's two false claims must be corrected
either way (step-2 ISSUE-014/-015).

**WHAT WOULD CHANGE MY MIND.** Measurement that the fail-safe posture's false-positive rate on
real agent traffic is high enough to stall runs (each deny costs a model round-trip, and
ISSUE-007 shows an unspendable override can kill a run). That is checkable at 13.2/14.2 time —
record deny rates; if benign-deny frequency exceeds ~1/run, the allow-list needs pre-seeding
from observed traffic before the posture flips.

---

### LAYERING-COHERENCE-009 — The composition root is the right *kind* of module but carries the system's largest unverified obligation surface; its completeness is checked nowhere, and hook-registration omission has now happened twice

**THE OBSERVATION.** `plugin/index.ts` is 1,427 lines. Read in full, its contents are: the 22
tool specs (~145 lines, a restatement of §3.4 descriptions), the handler-binding table (~115
lines, faithfully thin — every body spreads ONE deps bundle into a committed handler), argument
legality (~70 lines, refuses rather than fabricates — C-047's lesson, correctly held), the gate
snapshot derivations (`gateScopesFor`, `freezeTreeFor`, `sameTree`; ~100 lines), an embedded
polling engine (`createTreeState`, ~80 lines with timers and listener sets), the two-phase
journal, and four hooks. Three observations against "does it do only composition":
(a) **It under-composes:** the returned hook set is `tool` + `chat.message` +
`tool.execute.before` + `event`; the plan's §6.4 requires `chat.system.transform`, `chat.params`,
`chat.headers` in addition — and NOTHING anywhere compares the returned hook keys to a required
set. This exact omission class has now occurred twice: C-059 (`chat.message` missing for 40
tasks; the plugin factory returned `{tool, "tool.execute.before"}` and a comment asserted the
rest was done) and ISSUE-001 (the three §6.4 hooks missing at HEAD; CRITICAL). C-059 even named
the missing detector ("every adapter module is reachable from plugin/index.ts... now worth
having") — it was never built.
(b) **It re-derives a core semantic:** `sameTree` (line 829) reimplements gates-edit.ts:196-198's
trailing-slash comparison, coupled by comment only ("tolerates exactly what that comparison
does") — a P3 across the layer boundary in the most safety-critical seam the root owns.
(c) **It contains one known un-derived fact at HEAD:** `runActive: true` (line 1384, ISSUE-022) —
sitting in the same argument list C-082 fixed for the scope literals, i.e. the same defect one
field over from the last fix.

**THE CONSEQUENCE.** (a) is ISSUE-001 — the CRITICAL. (b)/(c) are latent versions of the C-082
class. The root's *thin* parts are genuinely thin and well-argued; its failures are all in what
it silently does not do.

**WHY IT IS STRUCTURAL, NOT LOCAL.** A composition root is the one module whose defects are
invisible to unit tests by definition (every composed part is green alone — C-059's own
diagnosis). This design gives that module the largest obligation surface in the system (22 tool
bindings + 7 hook kinds + ~8 per-call fact derivations + 4 process-lifetime singletons) and the
smallest verification surface (gate-wiring/composition-root tests drive the parts it *did*
compose; nothing enumerates what it *must* compose). Two occurrences of the omission class, one
of them the system-defining CRITICAL, is the pattern.

**WHAT A BETTER SHAPE LOOKS LIKE.** (1) The wiring manifest of LC-001: a core-owned
`REQUIRED_HOOKS` list compared in a test against `Object.keys(await ConductorPlugin(synthetic))`
— ~20 lines, would have turned both C-059 and ISSUE-001 red on the day they were introduced.
(2) Move `gateScopesFor`/`freezeTreeFor`/`createTreeState` into the adapter as one exported,
directly-testable assembly (LC-001's typed fact bundle) — the root keeps only the call. (3) Have
gates-edit export its tree comparison and delete `sameTree`. Costs: (1) hours; (2)/(3) ~1 day.

**PLAN IMPACT.** None; §5.3 already describes the root as "hook bodies and nothing else" — this
makes the description enforceable.

**WHAT WOULD CHANGE MY MIND.** For (a): a wire-level constraint making extra hooks harmless to
register (then a maximal hook set could be registered unconditionally and completeness stops
being interesting) — wire-notes confirms all three hooks work at 1.18.15, so no such constraint
exists. For (b)/(c): nothing — they are measured facts; only their weight is arguable.

---

### LAYERING-COHERENCE-010 — Five append-only ledgers, five hand-built implementations, at least three crash postures: the "ledger" concept exists once in the design and five times in the code

**THE OBSERVATION.** The run directory carries five JSONL ledgers — journal.jsonl,
evidence.jsonl, questions.jsonl, decisions.jsonl, anomalies (via appendAnomaly) — each with its
own reader/writer implementation and its own torn-line policy. Measured: journal.ts heals torn
lines (C-017's fix); `readDecisions` (tools.ts:498) is torn-line tolerant and `mintDecisionId`
deliberately never JSON.parses a line; `readQuestions` is a bare per-line `JSON.parse` that
THROWS on a torn line, with 2 of 4 callers wrapped (ISSUE-101 — `conductor_status` and the
stop-report writer die on a torn file); evidence.ts has its own appender with a cross-process
seq hole (ISSUE-026). The same crash-safety lesson (C-017, journal) was re-learned for questions
(C-032 E12) and is still unevenly applied at HEAD.

**THE CONSEQUENCE.** ISSUE-101: a torn questions.jsonl makes the run unclosable through the very
diagnostic (`conductor_status`) and terminal path (stop-report) an operator would reach for
after a crash — the exact moment torn lines exist.

**WHY IT IS STRUCTURAL, NOT LOCAL.** Four corrections/issues (C-017, C-032 E12, ISSUE-101,
ISSUE-026) are one lesson learned per-ledger instead of once, because there is no shared
substrate to learn it into. Patching `readQuestions` (step 2's fix) closes the instance; the
sixth ledger — or the next reader — starts from zero again.

**WHAT A BETTER SHAPE LOOKS LIKE.** IDEA-JSONL-1, endorsed as a design consolidation rather than
a convenience: one `appendJsonl`/`readJsonlTolerant` pair in the adapter owning BOM handling,
torn-tail isolation, and (where needed) the seq discipline; five call-site migrations. Cost:
~1 day; makes the C-017 class unrepresentable rather than five-times-fixed.

**PLAN IMPACT.** None; §7/§2.6 specify record shapes, not reader implementations.

**WHAT WOULD CHANGE MY MIND.** A shown need for genuinely different postures per ledger (e.g.
evidence MUST refuse on a torn tail because healing could hide a forged truncation, while the
journal must heal). If that argument exists it is recorded nowhere; making the posture a
per-ledger *parameter* of one substrate answers it anyway.

---

### LAYERING-COHERENCE-011 — G3 verdict: the split holds where it is mechanical (imports, purity) and leaks where it is judgmental (which layer owns a rule); the leak is one-directional — policy pools in the adapter

**THE OBSERVATION.** Measured, per the charter's direct questions:
- **Dependency directions: clean.** `grep` over all 17 core files: zero imports outside
  `./`-relative core, zero `node:*`, zero `Date.now`/`new Date`, zero `process.*`, zero fetch/
  timer usage. Adapter imports core (46 import statements) + node builtins only; plugin imports
  adapter (17 import statements) + core (2) + `@opencode-ai/plugin`. No core→adapter, no
  adapter→plugin edges exist. The
  G3 mechanical invariant has NOT eroded across 92 corrections — worth stating because nothing
  else in this review gets that clean a bill.
- **Core has grown no I/O or clock awareness.** Confirmed as above; freshness.ts takes
  timestamps as arguments; stops.ts takes counters.
- **Adapter HAS accumulated decision logic that belongs in core.** Representative, verified:
  `stricterKind` (tools.ts:465) and `trivialViolatesRecheck` (:475) — pure §3.2/§2.4 policy;
  `routeOf` (:6261) — the §3.3 review-fix routing rule, pure string/scope policy, defined inline
  inside a handler closure in a 9,253-line file, and defective (ISSUE-054) in exactly the way a
  core-owned, directly-tested rule would not have survived (its tests only ever saw literal-path
  fixtures); `handleReport`'s from-state literal (LC-002). The one-derivation principle exists
  (C-037 r.1) and is honored for settledForReport (verified: core exports it; both gate and
  handler consume it) — but there is no criterion anywhere for *which* rules get promoted to
  core, so promotion happens after a defect rather than at authorship.
- **Adapter→adapter web:** tools.ts is not only big; it is a HUB — continuation.ts imports five
  of its exports (handleReport, waveVerdict, appendAnomaly, handlerRunDir, inlineClaimScopeFor),
  and plugin/index.ts imports 28 of its names. The gate hook composition (`gateBeforeToolCall`)
  also lives there, beside 15 handlers and setup — so "the file that owns tool handling" and
  "the file that owns gate sequencing" and "the file continuation reaches through" are one file.
  (Its internal seam cost is measured by step 2: no single lens could read it whole, and
  ISSUE-005/-008/-088 were "invisible to single-region reads".)

**THE CONSEQUENCE.** ISSUE-054 (routeOf routes test findings to the guaranteed-deny path) is the
concrete cost of policy living un-promoted in the adapter: a §3.3 rule that would have been a
20-line pure function with refusal tests in core was instead an inline closure whose only
exercise came from happy-path fixtures.

**WHY IT IS STRUCTURAL, NOT LOCAL.** The layering rule as practiced is "core = what someone
decided to put in core"; each promotion (verdict.ts, queue-amend.ts, settledForReport) happened
in a correction round after a seam defect. Without a stated criterion ("any rule that adjudicates
model-influenced input", say), new policy keeps landing in handler closures by default — the
path of least resistance is the adapter, and the record shows no counter-pressure.

**WHAT A BETTER SHAPE LOOKS LIKE.** State the promotion criterion once (a one-paragraph
addition to the repo's conventions): a rule that (a) adjudicates or routes model-supplied
content, or (b) is consumed by two call sites, or (c) is re-checked by a gate, MUST be an
exported core function with refusal tests. Then a slow migration of the standing violations
(routeOf first — it has a live defect). Cost: the criterion is free; routeOf's promotion ~half
a day bundled with ISSUE-054's fix.

**PLAN IMPACT.** None; G3's text already implies this — the gap is an operational criterion.

**WHAT WOULD CHANGE MY MIND.** If promotion-after-defect were shown to be cheap enough in
practice (defects caught promptly by the review machinery), the criterion would be bureaucracy.
The record refutes this: routeOf's defect survived to HEAD, and the review machinery's own false
negative (P10) is the reason instance-by-instance discovery cannot be the strategy.

---

### OPINION-LC-A — The 7-role / 9-pack decomposition is probably right-sized, but the build has produced zero evidence either way, because doctrine has never reached a session

**Labelled OPINION per the charter: no measurement can currently support any position on role
count.** What IS measurable: (a) the role vocabulary has no owner (ISSUE-121: three private maps
in inject.ts with typo-absorbing `?? ` fallbacks; gates-edit restates four; ~15 tools.ts
literals; every role-typed field is `string`) — and the one recorded role defect (C-082's
testWriter/test-writer dead arm, which survived a unanimous skeptic refutation) is precisely a
no-owner defect, not a decomposition defect; (b) the classifier runs under role `"mechanical"`
(tools.ts:658) — two names for one concept at the design level, recorded as per-plan (§3.2:1077)
but a standing confusion cost; (c) 2 of the 9 packs (`debug.md`, `receive-review.md`) are
delivery-conditional on signals only the dead injection channel reads, so under ISSUE-001 the
effective pack count is what the tools.ts paraphrases carry (~5 concerns); (d) per §4.1 the
7 roles collapse to 4 distinct sampling temperatures and 3 priorities, so the wire-level
distinctions are coarser than the role list suggests.

**What would settle it (and should be captured at 13.2/14.2):** per-role failure rates and
doctrine-citation rates from live runs — if reviewer/skeptic behavior is indistinguishable with
merged packs, merge them; if the classifier's "mechanical" framing measurably reduces
classification-shopping (ISSUE-005a), keep it. Until a live campaign exists, changing the role
set would be redesign on taste, which this review declines.

**One structural piece is not opinion:** `export const ROLES = [...] as const` with typed maps
(`Record<Role, …>`) and a typed `RegistryEntry.role` (ISSUE-121's fix) should land regardless of
any future re-decomposition — it makes the C-082 class a compile error for every current and
future role.

---

## IDEA entries

### IDEA-LC-1 — REQUIRED_HOOKS completeness test for the plugin factory
Origin:     LC-009 — hook omission happened twice (C-059, ISSUE-001), once CRITICAL.
Kind:       test-maintainability / tooling
Value:      turns the composition root's silent-omission class red on the day it is introduced;
            ~20 lines against a synthetic PluginInput.
Cost:       hours
Relates to: LAYERING-COHERENCE-001, -009; ISSUE-001

### IDEA-LC-2 — Brand the two tree types (TreeSlug vs TreePath), or carry {treeSlug, treePath} pairs
Origin:     LC-003 — third recurrence of the slug/path confusion (ISSUE-002) despite a committed
            translator.
Kind:       tooling / naming
Value:      makes the confusion a compile error at every current and future dispatch site.
Cost:       ~15 mechanical sites
Relates to: LAYERING-COHERENCE-003; ISSUE-002; C-037 r.5; C-053

### IDEA-LC-3 — One exported `deriveGateFacts(store, registry, sessionID)` in the adapter
Origin:     LC-001/LC-009 — three literal-instead-of-derivation defects at one call site
            (C-082, ISSUE-022, ISSUE-002-adjacent).
Kind:       tooling
Value:      one derivation site, unit-testable without opencode; the plugin passes a bundle, not
            eight loose primitives.
Cost:       ~1 day
Relates to: LAYERING-COHERENCE-001, -009; ISSUE-022

### IDEA-LC-4 — FSM API takes the run, not a caller-supplied from-state
Origin:     LC-002 — `legalRunTransition("EXECUTING", …)` at tools.ts:7640 bypasses the FSM and
            makes the adjacent journal line lie.
Kind:       tooling
Value:      from-state literals become inexpressible; 7 call sites, mechanical.
Cost:       hours
Relates to: LAYERING-COHERENCE-002; ISSUE-005

### IDEA-LC-5 — One core `dispositionOf(item, ctx)` consumed by scheduler, continuation, and report
Origin:     LC-004 — seven "settled but not finished" strain points across four predicate
            spellings.
Kind:       tooling
Value:      wedge classes become one function's test surface instead of N consumers' seams.
Cost:       2–3 days (consolidation of existing predicates)
Relates to: LAYERING-COHERENCE-004, -005; ISSUE-050, -055, -065, -066, -067, -068; IDEA-STRUCT-5

### IDEA-LC-6 — One shortcut schema pricing all three escape hatches
Origin:     LC-006 — defer is free and forges human provenance while override is budgeted and
            tainted; the lazy path is the cheap one.
Kind:       other (incentive design)
Value:      the report shows tainted dispositions by construction; the honest path becomes the
            cheap one.
Cost:       ~2 days + a recorded plan deviation
Relates to: LAYERING-COHERENCE-006; ISSUE-007, -051, -052

### IDEA-LC-7 — Promotion criterion for core (one paragraph in the repo conventions)
Origin:     LC-011 — policy pools in the adapter by default; promotion happens only after a
            defect (routeOf/ISSUE-054 is the live cost).
Kind:       docs / process
Value:      new rules land in core with refusal tests at authorship time, not after a correction
            round.
Cost:       free (the paragraph); migrations incremental
Relates to: LAYERING-COHERENCE-011; ISSUE-054

### IDEA-LC-8 — Delete `sameTree` from the plugin; gates-edit exports its comparison
Origin:     LC-009(b) — a core comparison semantic re-derived at the composition root, coupled
            by comment.
Kind:       polish
Value:      one fewer cross-layer two-spelling.
Cost:       minutes
Relates to: LAYERING-COHERENCE-009

### IDEA-LC-9 — Record the deny rate at first live contact before deciding LC-008's posture flip
Origin:     LC-008 — the fail-safe attribution posture trades an open-ended bypass class for
            some benign denies; the right trade depends on a number nobody has.
Kind:       process / measurement
Value:      converts a philosophy argument into a measurement; 13.2/14.2 can capture it for free
            from the gates/deny journal events.
Cost:       free (read the journal)
Relates to: LAYERING-COHERENCE-008; IDEA-STRUCT-3

---

## CROSS-LENS POINTERS (for the capability review)

- **The wiring manifest (LC-001/LC-009) is a missing *mechanism*, not just a missing test** — a
  core-owned declaration of composition obligations (hooks, reachable modules, stop-kind
  writers) with a gate leg that walks it. Grounded in C-059 + ISSUE-001 (the class produced a
  CRITICAL twice). The capability review should weigh it beside IDEA-STRUCT-1/2 — it is cheaper
  than both and addresses the family that produced both step-2 CRITICALs.
- **The disposition function + stop closer (LC-004/LC-005, IDEA-LC-5) is the floor-raiser for
  unattended runs** — the "done vs waiting-on-you vs wedged" distinction the capability pointers
  already flag is unbuildable until one function owns disposition.
- **Escape-hatch pricing (LC-006) belongs in any doctrine-efficacy analysis** — doctrine telling
  a model not to defer is advisory; a defer that costs budget is structural. The step-2 finding
  that the incentive gradient runs backwards is a *pricing* problem before it is a doctrine
  problem.
- **The fail-safe attribution posture (LC-008, endorsing IDEA-STRUCT-3)** now has the
  measurement that justifies it: 0 bypasses on deny-by-default surfaces vs 6+ on enumeration
  surfaces. Pair any adoption with IDEA-LC-9's deny-rate measurement.
- **For the enforcement review, if re-run:** `sameTree` in plugin/index.ts (LC-009b) is an
  unguarded cross-layer restatement of gates-edit.ts:196-198 semantics that step 2's vocabulary
  sweep did not list (its V-table records the slug/path translation, not this comparison);
  worth one drift-guard row.

---

## Disposition of step-2 pointers addressed to the macro review

Every pointer from findings-enforcement.md §4 ("To the MACRO review"), with what this part
concluded. Pointers outside this part's scope are marked for the sibling macro parts.

1. **"Stop-vocabulary over-specified for the recorders that exist"** — DISPOSITIONED, LC-005.
   Answer: keep all six kinds; build the one closer (IDEA-LC-5 + IDEA-STRUCT-5). The vocabulary
   is not the defect; writer-scatter is.
2. **"The enforcement locus is diffuse — a requireMetaTool choke point is a structural
   simplification"** — DISPOSITIONED, LC-002. Endorsed, and extended: the FSM API's
   caller-supplied from-state must go too, or the choke point can still be bypassed by the
   literal that bypasses it today.
3. **"Detection by enumeration is a recurring shape"** — DISPOSITIONED, LC-008. Measured as
   one-sided (all reproduced bypasses on the enumeration side); posture flip endorsed with a
   deny-rate measurement gate (IDEA-LC-9).
4. **"tools.ts is 9,253 lines… navigability for a 32k model"** — PARTIALLY MINE. The layering
   half is dispositioned in LC-011 (tools.ts is a hub: handlers + gate sequencing + the exports
   continuation reaches through; policy pools there un-promoted). The token-count/navigability
   measurement belongs to the Part A reviewer.
5. **"continuation.ts carries three separable engines; inject.ts is a fully-built module with
   zero production callers"** — DISPOSITIONED. inject.ts: LC-007 (the dead channel and the live
   paraphrases are two mechanisms for one concern; wiring it is necessary but not sufficient —
   the paraphrases must then derive from packs or die). continuation.ts: examined its header and
   import discipline; its rules are read from owners, not restated (post-C-086) — the
   three-engines split is an organization question for Part A, not a layering defect; no
   dependency-direction violation found.
6. **"The build maintains five status surfaces with no freshness contract"** — NOT MINE (Part D,
   build-process design). Noted that it is the record-layer instance of LC-010's shape (N
   hand-built instances of one concept, no shared substrate).
7. **"scripts/ mixes two products; conductor/tools/ outside every hygiene guard; M5 covers no
   *.sh"** — NOT MINE (Part A organization / Part D gate regime). One layering note: the
   boundary violation is real but *outward* (tooling), not in the core/adapter/plugin triangle;
   nothing in scripts/ imports conductor source across the product line except the intended
   config-parity reads.
8. **"types.ts interface + hand-written JSON-schema duality"** — DISPOSITIONED (design-level
   two-spellings, my scope). Verified: the JSON schemas do consume the exported enum arrays
   (RUN_STATES, STOP_KINDS…), so enum drift is guarded; the *shape* halves (properties/required
   lists vs interface fields) are hand-doubled across ~1,414 lines of types.ts, plan-mandated.
   Verdict: a known, contained cost — the single-source tests bind the enums, schema-export
   binds the C++ side, and generating one side from the other would be the first change to make
   if a §2 schema churns; not urgent while §2 is frozen. Filed as context, no new finding.
9. **"UPSTREAM_CONTRACT doubles as a findings ledger; CMake project still named myprogram"** —
   NOT MINE (Part A/E organization + docs).
10. **"The gate's own availability failure mode (no timeout, nondeterministic red)"** — NOT MINE
    (Part D gate-regime design). Cross-referenced in LC-004's evidence caveats only.

---

## Cleared areas (structural concerns investigated and found sound)

- **G3 dependency directions and core purity** — measured directly (import grep over all 32
  production TS files in core/adapter/plugin; node-builtin/clock/process grep over core).
  Zero violations. The mechanical half of G3 is genuinely held after 92 corrections.
- **The C-037 ruling-1 principle where applied** — verified `settledForReport` is exported from
  core (gates-phase:231) and consumed by BOTH the gate (:416) and `handleReport`
  (tools.ts:7515). The one-derivation pattern demonstrably works when used; LC-011's finding is
  that nothing says when it MUST be used.
- **The registry single-map design** (plugin/index.ts:329-352) — one map, a copy-at-boundary
  view for chat-message, direct writes for fan-out; the aliasing hazard is understood and
  designed against. Sound.
- **The override-consumption seam** — one grant map, minted by handleOverride, spent at exactly
  one choke point (`consumeOverrideGrant`) at the point of denial, one-shot, journaled at warn.
  As a *mechanism* this is the coherence model the other hatches should copy (LC-006); the
  free-string gate name (ISSUE-007) is its one hole and is a vocabulary gap, not a design gap.
- **continuation.ts's dependency discipline** — header audited against its imports: every rule
  it applies is imported from its owner (isTerminal, shouldTerminate, legalTools-via-waveVerdict,
  decideEdit, isHumanTerritory, handleReport), and the one restatement it ever carried
  (UNIVERSAL_META_TOOLS) was converted to a derivation-by-probe in C-086. The wedge (C-085)
  happened *despite* clean layering — which is exactly why LC-004 blames predicate semantics,
  not the layer boundary.
- **The two-phase journal cycle-break** (plugin/index.ts:29-36) — a real construction cycle
  (journal needs run dir, run dir needs store, store needs journal) resolved with a rebindable
  sink and an explicit no-replay rule. Coherent; no smear.
- **The gate hook's fail-closed guardedness derivation** (tools.ts:340-440) — the
  guarded/unguarded split is computed once from the real parse and every guarded crash denies.
  The design is right; ISSUE-014's blindness is in `hasGitSegment`'s shared attribution problem
  (LC-008), not in the fail-closed structure.

---

## Coverage ledger

| Surface | Depth | What was concluded |
|---|---|---|
| findings-enforcement.md (2,303 ln) | read in full | evidence base; 30+ issues cited into findings |
| 1-briefing.md, 3-macro.md | read in full | charter compliance |
| conductor/plugin/index.ts (1,427 ln) | read in full | LC-009 (composition root), LC-003 (tree duality comments), ISSUE-022 confirmed at :1384 |
| conductor/core/*.ts (17 files) | import/purity scan (all); gates-phase predicates region read | G3 purity measured clean; predicate inventory for LC-004 |
| conductor/adapter/tools.ts (9,253 ln) | targeted: :200-529 (gate hook + policy helpers), :7600-7670 (report close), grep-located sites (:465, :475, :2566, :5135, :6261, :7640, :7647, :7913) | LC-002 (from-state literal + journal lie), LC-011 (stranded policy), stop-writer census |
| conductor/adapter/continuation.ts | header (1-70) + stop-writer sites + import list | cleared-area verdict; LC-004 evidence |
| conductor/adapter/inject.ts | role/pack map region (:30-80) + grep | LC-007, OPINION-LC-A |
| conductor/core/types.ts | schema region (:700-800) + grep | pointer 8 disposition |
| docs/build/CORRECTIONS.md (4,610 ln) | all 92 headings enumerated; C-037, C-050, C-053, C-059, C-082, C-083, C-084, C-085, C-086 read in full | the 14-correction seam table (LC-001); FSM strain points (LC-004); role evidence (OPINION-LC-A) |
| Import graph (core/adapter/plugin) | full mechanical scan | LC-011 measurements |
| Call-site censuses | legalTools, decideEdit, gateBeforeToolCall, requireStageTool, waveVerdict, legalRunTransition, run.stop writers, settledForReport, ROLE_PACKS | LC-002, LC-005, LC-007 |

**Not examined (disclosed):** router/ and scripts/ internals (layering within them was not in
this part's scope; the cross-language seams that ARE in scope — ISSUE-043, ISSUE-117/-118 — were
taken from step 2's verified findings); the plan's full 3,399 lines (consulted via step 2's
citations and the corrections' quoted clauses rather than re-read end to end — flagged so the
Part A/D reviewers, who must read it whole, know this part did not duplicate that pass);
e2e/test files except where corrections quoted them.

**Method note per briefing §5.1:** no mutation testing was run in this part — the charter's
evidence burden for macro findings is measurement/pattern/step-2-cause, and every finding above
is grounded in one of those three. Where a step-2 reproduction is load-bearing (ISSUE-002,
ISSUE-005, ISSUE-065), this part relied on step 2's recorded reproductions rather than re-running
them; each is independently consistent with the source read directly (e.g. the `"EXECUTING"`
literal and the `kind:"done"` literal were verified by eye at tools.ts:7640/:7647 in this
session).
