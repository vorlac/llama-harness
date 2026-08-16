# Conductor Review — Step 4: Capability Register and Consolidated Plan

**Date:** 2026-08-16
**Reviewer:** step-4 capability composition/merge agent, reconciling two part files in
`docs/reviews/conductor-review/parts-capability/` (`missing-mechanisms.md`, 1,120 ln;
`doctrine-efficacy.md`, 782 ln — both read in full) against the step-2 evidence base
(`findings-enforcement.md`, 2,303 ln, read in full) and the step-3 register
(`findings-macro.md`, 1,255 ln, read in full). Full prose evidence for every GAP lives in the
part files, which remain in place as the audit trail; entries here carry the merged verdict, the
single renumbered `GAP-NNN` sequence, and the origin id(s). Provenance note: the review harness
blocks subagent report writes, so this file was produced via shell append by the merge agent —
the same accommodation step 3 recorded.

This document is the step-4 deliverable per `4-capability.md` §Output: executive verdict, GAP
register, doctrine assessment (all nine packs), IDEA register, the unified register across all
three ID spaces, systemic clusters, the dependency graph, the PROVISIONAL ordered plan, the open
decisions, pointer disposition, coverage ledger, cleared areas, and merge notes.

---

## 1. Executive verdict

**What is missing is not more enforcement of the kind the system already has — it is three
absent categories of mechanism, each grounded in reproduced failure.**

**First: nothing witnesses composition.** The system's thesis channel — doctrine, the live state
block, per-role sampling, router tags — is dead (ISSUE-001, CRITICAL), the shipped default
cannot accept a single sub-session write (ISSUE-002, CRITICAL), and both facts were invisible to
1,382 green tests because every test drives a fake SDK and nothing anywhere asserts "the built
thing is wired, and delivery happened." The missing mechanisms are boring and cheap: a wiring
manifest with a completeness test (GAP-002), a delivery witness (GAP-001), one live-ish gate leg
with a real opencode against a stub provider (GAP-003), an unreachable-exports audit (GAP-020).
The ~22-instance family this closes produced both CRITICALs and nine corrections; it is the
highest-severity-per-entry cluster in the whole record.

**Second: the two points where control passes to model judgment are structurally open, and the
compensating review layer is accept-on-trust with a finding-killing default.** Meta-tool
legality and caller identity are checked by nothing (E20/E21 — defer-all-from-DECOMPOSED closes
a run `done`; an implementer can answer its own blocking question); scope declaration at
decompose time is unbounded (`["**"]` buys a repo-wide edit grant, free legal REDs, and a size
budget that counts list entries); the vetted test's identity across RED→vet→GREEN is
unwitnessed; a `{"findings":[]}` review and an "uncertain ⇒ refuted" skeptic make real findings
disappear at zero cost. Every one of these is UNBUILT, not IMPOSSIBLE — the honest boundary
(review *content*, fix *correctness*, human *relay*) is genuinely trust, and the register keeps
it trusted while making contact, identity, legality, and scope machine-checked
(GAP-006…GAP-012, GAP-015, GAP-036).

**Third: an unattended run cannot say done / waiting-on-you / wedged, and the price system runs
backwards.** Two of six stop kinds have no writer, honest waiting loses committed work, and the
cheapest full-run escape (defer-all) is free, untainted, and forges human provenance. The
missing mechanisms are one disposition function, one total stop closer, one price schema for the
three escape hatches, and an out-of-band human-answer channel that the state-area deny already
makes possible (GAP-013, GAP-014, GAP-021, GAP-022).

**Would the "process quality from a small model" thesis hold as built?** No — as shipped the
system cannot do work at all in its default configuration, delivers no doctrine when it does,
and a competent-but-lazy model beats it at six reproduced points. **But the verdict on the
thesis itself is favorable:** the expensive half (evidence re-derivation, FSM ordering, publish
integrity, the router's honest ledger) already binds under mutation; what is missing is almost
entirely cheap, mechanical, and additive — most GAPs are ≤1–2 days, few need plan-text changes,
and the doctrine packs are well-sized (≤8.3% of a 32k window) with defects of *content
alignment*, not length. The distance between "cannot run" and "raises the floor as designed" is
short and is fully enumerated below.

**Confidence: HIGH** on the register — 44 of 48 GAPs trace to a specific reproduced ISSUE,
measured MACRO, or verified behaviour; only **4 entries are SPECULATIVE** (8%), a discipline
signal inherited from parts that policed themselves. Two standing caveats bound every claim: no
live model run has ever occurred (all doctrine-efficacy retention judgements are structural, to
be falsified at 14.2 — GAP-046), and the full gate is nondeterministically red on unmutated HEAD
(ISSUE-134), so inherited full-gate verdicts are distribution samples until GAP-035 lands.

---

## 2. The GAP register

**Merge basis:** 35 `MISSING-MECHANISMS-NNN` (MM) + 14 `DOCTRINE-EFFICACY-NNN` (DE) part
entries → **48 GAPs** (44 grounded + 4 SPECULATIVE). Four DE entries merged fully into MM-based
GAPs (DE-004→GAP-036, DE-005→GAP-011/-012, DE-012→GAP-014, DE-013 split across
GAP-001/-016/-019); nine DE entries survive standalone; three MM-part `IDEA-SPEC` entries are
promoted to explicitly-SPECULATIVE GAPs so the ranking is visible in one sequence. Severity
tier: **STRUCTURAL** (wrong thing impossible/machine-refused) > **DETECTED** (wrong thing
visible/red) > **ADVISORY** (model is asked). Effort: XS <2h · S ≤1d · M 2–3d · L >3d ·
LIVE needs a model · DEC blocked on an owner decision.

### 2.1 Mapping table (part-local id → GAP-NNN)

| Part id | GAP | Part id | GAP | Part id | GAP |
|---|---|---|---|---|---|
| MM-001 (+DE-005 reviewer half) | GAP-011 | MM-013 | GAP-009 | MM-025 | GAP-020 |
| MM-002 (+DE-005 fixer half) | GAP-012 | MM-014 | GAP-025 | MM-026 | GAP-030 |
| MM-003 | GAP-013 | MM-015 | GAP-026 | MM-027 | GAP-031 |
| MM-004 (+DE-012) | GAP-014 | MM-016 | GAP-017 | MM-028 | GAP-032 |
| MM-005 | GAP-015 | MM-017 | GAP-018 | MM-029 | GAP-033 |
| MM-006 (+DE-013c, DE-001 digest) | GAP-001 | MM-018 | GAP-003 | MM-030 | GAP-034 |
| MM-007 | GAP-002 | MM-019 | GAP-021 | MM-031 | GAP-035 |
| MM-008 (+DE-002 structural half) | GAP-006 | MM-020 | GAP-022 | MM-032 (+DE-004) | GAP-036 |
| MM-009 | GAP-004 | MM-021 | GAP-023 | MM-033 | GAP-027 |
| MM-010 | GAP-029 | MM-022 | GAP-024 | MM-034 | GAP-028 |
| MM-011 | GAP-007 | MM-023 (+DE-013b) | GAP-016 | MM-035 | GAP-010 |
| MM-012 | GAP-008 | MM-024 (+DE-013a) | GAP-019 | DE-001 | GAP-005 |
| DE-002 (doctrine facet) | GAP-037 | DE-007 | GAP-040 | DE-010 | GAP-043 |
| DE-003 | GAP-038 | DE-008 | GAP-041 | DE-011 | GAP-044 |
| DE-006 | GAP-039 | DE-009 | GAP-042 | DE-014 (SPEC) | GAP-045 |
| IDEA-SPEC-1 | GAP-046 (SPEC) | IDEA-SPEC-2 | GAP-047 (SPEC) | IDEA-SPEC-3 | GAP-048 (SPEC) |

### 2.2 Theme I — Composition witnessed (the thesis channel)

#### GAP-001 — A doctrine-delivery witness: "loaded ≠ delivered" gets a mechanical form
- **DETECTED (content stays advisory) · S–M · origin MM-006 + DE-013(c) + DE-001 (digest facet)**
- **Grounding:** ISSUE-001 (CRITICAL — no session ever received doctrine/state block/sampling/
  headers; survived all 52 tasks), ISSUE-004 (beacon written before packs load), ISSUE-138 (the
  banner nothing emits), C-028 ("loaded ≠ delivered" — a rule with no mechanism), macro
  pointer 11 (the state block is also the 32k model's only runtime navigation).
- **Mechanism (three layers):** (1) wire-level: GAP-003's stub-provider leg asserts a captured
  request carries the role's pack digest + headers; (2) runtime receipt: the transform hook
  journals `doctrine.delivered {sessionID, role, packDigest}`; `conductor_status` renders
  delivered-doctrine-per-role (would have exposed ISSUE-001 on day one); (3) beacon stamp:
  `doctrineLoaded` + digest written only after `ensurePacks` succeeds (fixes ISSUE-004 ordering).
- **Floor raised:** "thesis mechanism silently absent for 52 tasks" cannot recur undetected.
  Prerequisite for any 14.2 doctrine-arm claim meaning anything.

#### GAP-002 — A wiring manifest with a completeness test
- **DETECTED · S · origin MM-007** (one declarative substrate with GAP-016 — see §7)
- **Grounding:** MACRO-001 (~22-instance built-but-never-wired family incl. both CRITICALs;
  C-059's proposed detector recorded "now worth having" and never built); ISSUE-001/-002/-038/
  -065 live members; ISSUE-043 (the TS↔C++ schema export step deferred and never landed);
  ISSUE-022/ISSUE-142 (literal-where-a-derivation-belongs at the composition root).
- **Mechanism:** core exports required hook keys, adapter modules that must be import-reachable
  from `plugin/index.ts`, stop kinds that must have a writer, tools that must have a
  non-fallback ToolSpec (MACRO-025(b)); one test constructs the real plugin and compares. Add
  the CMake `add_custom_command` schema-export step (ISSUE-043). `deriveGateFacts()` as the
  typed fact bundle (IDEA-LC-3) kills the loose-literal shape (ISSUE-022, ISSUE-142).
- **Floor raised:** the single largest defect family in the record goes red on introduction day.

#### GAP-003 — A live-ish gate leg: real opencode + ~50-line stub provider, every gate run
- **DETECTED-standing · M · origin MM-018**
- **Grounding:** MACRO-002 (composition and live truth deferred to the end — the shape that
  shipped both CRITICALs); ISSUE-091 (the whole e2e passes 35/35 with a gate that denies
  everything — the fake SDK writes files directly); ISSUE-001/-002 (invisible to all 1,382 tests).
- **Mechanism:** one standing leg driving plugin load → hook registration → one gated ALLOW
  write through the real hook → one doctrine-bearing request captured at the stub. No model
  needed; ~10s of gate wall-clock. The enabling leg for GAP-001 layer 1 and GAP-002's wire half.
- **Floor raised:** "a whole configuration is inert but green" becomes a red gate. The
  highest-leverage single build investment in this register.

#### GAP-004 — Two tree types: the slug/path duality becomes a compile error
- **STRUCTURAL · S · origin MM-009**
- **Grounding:** ISSUE-002 (CRITICAL — the fourth strike of the duality C-037 r.5 named
  "architectural"; the default mode denies every write); MACRO-003 (three authorship events
  post-naming); the shipped default is composed by no test.
- **Mechanism:** nominal branding (`TreeSlug`/`TreePath`) or `{treeSlug, treePath}` pairs on
  FanoutJob/RegistryEntry, translation at one construction site (~15 mechanical sites). The
  ISSUE-002 fix is the migration's first commit. Include the missing no-worktree composition
  test (an item with NO worktree driving a real gate ALLOW).
- **Floor raised:** the fifth misfeed becomes unrepresentable.

#### GAP-005 — Single-source doctrine composition: dispatch prompts derive from the pack map, and packs gain a generated MECHANICS section
- **STRUCTURAL · S–M · origin DE-001**
- **Grounding:** ISSUE-003 (five hand-inlined paraphrases, no drift guard either direction; the
  ENV doctrine override ~95% theater), MACRO-008 (two mechanisms, one concern — after
  ISSUE-001's wiring the two channels will CONFLICT in one context window), plus the attention
  argument: packs sit in system position, paraphrases + payload at the prompt tail, and a
  weak-instruction model weights the tail — so the unguarded channel wins.
- **Mechanism:** dispatch prompts compose their doctrine slice FROM the loaded pack map (the
  existing debugFixPrompt pattern); each pack gains a short MECHANICS section (tool names, reply
  statuses, gate names, criteria) GENERATED from the closed vocabularies so it cannot drift.
- **Floor raised:** "which doctrine governed this session" stops being two unguarded spellings;
  every doctrine improvement actually changes what sessions see.

### 2.3 Theme II — The model-judgment boundary (legality, scope, TDD, review)

#### GAP-006 — One legality choke point, threaded caller identity, and an FSM API that cannot be lied to
- **STRUCTURAL · S–M · origin MM-008 + DE-002 (structural half)**
- **Grounding:** ISSUE-005 (E20 — meta tools guarded by nothing; classify-shopping, defer-all→
  `done` from DECOMPOSED, terminal-run mutation all reproduced), ISSUE-006 (E21 — an
  implementer answers its own question / defers its own item / widens its own scope), MACRO-004
  (`handleReport` feeds the FSM the literal `"EXECUTING"`; the journal repeats the lie),
  MACRO-025 (every new tool re-rolls the class; the addendum's `conductor_clarify` is next).
- **Mechanism:** (a) `requireToolLegal(tool, store, runId)` in `runTool` for every
  `conductor_*` name — new tools declare legality in a table; (b) thread caller identity into
  `answer`/`defer`/`queue_amend` (exists for `surface`/`override`), refuse dispatched-role
  self-service; (c) `advanceRun(run, to, ctx)` replaces caller-supplied from-state (~7 sites).
- **Floor raised:** the cheapest reproduced full-run escapes close at one seam, and the seam is
  also the growth mechanism for every future tool.

#### GAP-007 — A vetted-test identity witness across RED→vet→GREEN
- **STRUCTURAL · S · origin MM-011**
- **Grounding:** ISSUE-008 (reproduced at gate and queue level — implementer rewrites the vetted
  test inside fileScope; `mark_green` re-runs whatever is on disk, no re-vet).
- **Mechanism:** (a) prevention — subtract `testScope` from the implementer's writable set in
  `decideEdit` (a set difference at an existing seam) + the `fileScope ∩ testScope = ∅`
  refusal in `validateQueue`; (b) witness — hash the test content at vet time into the §2.6
  record; `mark_green` refuses on mismatch (covers the bash-redirect/out-of-band shapes the
  gate cannot attribute).
- **Floor raised:** the lazy model's highest-value in-pipeline exploit closes from two
  independent directions.

#### GAP-008 — Green-admission symmetry: the green path refuses what the red path refuses
- **STRUCTURAL · XS · origin MM-012**
- **Grounding:** ISSUE-010 (a zero-test or full-suite-fallback green admitted as the item's
  GREEN; the green record carries no `targeted`/`fellBack` field).
- **Mechanism:** mirror `redAdmission` — refuse `ranZeroTests || !targeted` (or journal+taint
  per owner preference, §9); persist `targeted`/`fellBack` in the green §2.6 record.
- **Floor raised:** the purest nobody-built-it in the register; "ride a fallback green past a
  test that executed zero times" closes.

#### GAP-009 — A scope-size and scope-shape measure at queue acceptance
- **STRUCTURAL · S · origin MM-013**
- **Grounding:** ISSUE-012 (the §3.2 budget counts fileScope ENTRIES — `["src/**"]` counts 1;
  the C-030 E12 refutation shown non-discriminating, P10), ISSUE-011 (`**`-headed fileScope
  makes `missing-subject` a free legal RED, reproduced twice), step-2 pointer "no size measure
  exists for glob-scoped items anywhere in the pipeline".
- **Mechanism:** at queue accept in the adapter (which owns `expandScopeEntry`): expand globs,
  count files, enforce `ITEM_MAX_FILES` on the expansion; reject wildcard-headed globs for
  behavioral items (reuse `isDegenerateScope`).
- **Floor raised:** scope declaration — one of the two points where control passes to model
  judgment — is bounded mechanically; the item budget measures what §3.2 says it measures.

#### GAP-010 — Inter-item scope disjointness as a validateQueue refusal; routeOf promoted to core
- **STRUCTURAL · S · origin MM-035**
- **Grounding:** ISSUE-008 (queue half), IDEA-A-03 (the rule is currently *asked* of the
  planner), ISSUE-054 (`routeOf` — pure scope policy inline in a handler closure, defective
  exactly as a core-owned refusal-tested rule would not be), ISSUE-063 (scope conflict is a
  late runtime block), MACRO-024 (no promotion criterion for core).
- **Mechanism:** `validateQueue` rejects `fileScope ∩ testScope ≠ ∅` and intersecting
  behavioral-item fileScopes at authoring time; promote `routeOf` to core with refusal tests
  (glob-aware path matching, ISSUE-054's fix); adopt IDEA-CAP-3's promotion criterion.
- **Floor raised:** scope conflicts become authoring-time refusals instead of silent holes or
  wasted review rounds.

#### GAP-011 — A reviewer diligence witness: `[]` stops being free
- **STRUCTURAL for diligence (content stays trusted) · M · origin MM-001 + DE-005 (reviewer half)**
- **Grounding:** ISSUE-072 (E8 — empty findings indistinguishable from never-looked; reproduced
  as sanctioned), review.md's own text ("an empty findings list … IS the approval") which for a
  lazy model is a sanctioned zero-effort exit.
- **Mechanism:** the dispatcher embeds a per-session nonce + per-hunk markers in the diff; the
  `Findings` schema gains required `readWitness` + per-lens `citedRanges` that must exist in
  the diff; the handler mechanically refuses a reply whose nonce is absent or whose ranges
  don't exist. An empty-findings reply still carries the witness + at least one cited range per
  changed file. review.md's calibration line becomes a priced statement.
- **Floor raised:** the cheapest review evasion (approve without reading) is machine-refused;
  judgment itself stays trusted — the honest boundary.

#### GAP-012 — A fixer-receipt floor: DONE must intersect the finding
- **DETECTED-with-refusal · S · origin MM-002 + DE-005 (fixer half)**
- **Grounding:** E9 (a DONE that did nothing survives if the next round misses it — and the
  next round is E8, trust again), ISSUE-054 (the path-extraction machinery already exists).
- **Mechanism:** after a DONE, the handler diffs the tree and refuses when the diff is empty or
  touches no file the finding names (fallback: fileScope); refusal re-dispatches with the
  discrepancy named; second failure surfaces.
- **Floor raised:** acknowledge-and-change-nothing closes.

#### GAP-013 — A human-provenance answer channel via the state area the model cannot write
- **STRUCTURAL · M · DEC (§2.11 additive field) · depends on GAP-026 · origin MM-003**
- **Grounding:** ISSUE-051 (any string clears the block; answered questions vanish from every
  report — "the human-in-the-loop can be fully simulated"), ISSUE-052 (forged `kind:"human"`),
  step-2 cleared area (the `.conductor/**` deny holds → a file appearing there was NOT written
  by a gated session, by construction).
- **Mechanism:** for `humanTerritory` questions: the model's relay records as *proposed*; the
  block clears when `.conductor/runs/<id>/answers/<qid>.md` exists — one `echo >>` by the
  operator, printable by the surfacing message and `conductor_status`. Render answered
  questions in the report (IDEA-OBS-3). Depends on the case-fold deny fix (GAP-026) being
  airtight.
- **Floor raised:** surface → self-answer → proceed closes for exactly the question class where
  it matters most.

#### GAP-014 — One price schema for the three escape hatches
- **STRUCTURAL · M · DEC (plan deviation — §3.6 budgets override only) · origin MM-004 + DE-012**
- **Grounding:** MACRO-007 (the backwards incentive gradient as a design property), ISSUE-052
  (defer forges human provenance), ISSUE-057 (inline-claim expiry unimplemented), ISSUE-007
  (honest override use punished), adversary log (a) (defer-all → clean `done`, reproduced).
- **Mechanism:** every process shortcut writes the same triple — budget sized by impact, item
  taint/anomaly, honest provenance (`kind:"derived"` unless GAP-013 supplies a human artifact).
  A defer-dominated settled set becomes report-visible by construction. Then ~6 lines of
  legit-defer doctrine in core.md (the advisory half, placed coherently once GAP-006 restricts
  the callers).
- **Floor raised:** the lazy model's best-paying strategy becomes bounded, tainted, visible;
  with GAP-021 the honest-waiting path stops being the punished one.

#### GAP-015 — A degenerate-config refusal floor at setup
- **STRUCTURAL · XS · origin MM-005**
- **Grounding:** ISSUE-048 (`behavioralPaths:[]` accepted — TDD off repo-wide in one call,
  reproduced; HONEST-LIMITS limit 3's "only fabrication path is override" falsified).
- **Mechanism:** refuse `[]` (and any list disjoint from every detected source glob) unless an
  explicit journaled `acknowledgeNoTdd:true` rendered in every report header; echo accepted
  answers into the journal; route the acknowledgement through GAP-013 where configured.
- **Floor raised:** the one-call kill switch on RED-before-GREEN closes.

#### GAP-036 — Symmetric refutation evidence and a skeptic default that cannot convert incapacity into a verdict
- **DETECTED + doctrine · S · origin MM-032 + DE-004**
- **Grounding:** the best-evidenced doctrine defect in the system: C-082/P10 (unanimous wrong
  refutation, sealed), MACRO-015 (two of the audited refutations wrong; kill rates 12%→71%;
  refutation costs one unaudited line), ISSUE-079 (no refutation-evidence field), ISSUE-012
  (refuted on non-discriminating procedural grounds), C-030/-031/-038 (panels under-delivered
  by transport — "could not evaluate" occurs in practice and the pack maps it to refuted).
- **Mechanism:** (1) schema — a required refutation-evidence field (discriminating input, run,
  the reading under which the finding fails); a bare refutation downgrades to an *abstention*,
  and an abstention upholds; (2) pack — split "could not refute after a real attempt" from
  "could not evaluate"; (3) add the P10 identifier-position rule to skeptic.md; (4) kill the
  "do not re-litigate" note as a category.
- **Floor raised:** the review machinery's most serious failure mode (a sealed false negative)
  gains a diagnosis path; the finding-killing gradient is re-priced symmetrically.

### 2.4 Theme III — Disposition, termination, operator visibility

#### GAP-021 — A total stop-kind closer: every terminal path names its disposition
- **STRUCTURAL · S–M · DEC (§3.2-done vs §3.3-blocked reconciliation, ISSUE-053) · origin MM-019**
- **Grounding:** ISSUE-065 (`blocked`/`surfaced` computed by core, written by NOTHING — an
  all-blocked run stamps `done`), ISSUE-066 (blocked+dependent → `noop`, resume dead, committed
  work lost — reproduced end-to-end), ISSUE-067 (silent wedge enshrined by a committed test),
  MACRO-006 (BLOCKING — a named prerequisite of 13.2, 14.2, and Phase 17.4, whose acceptance is
  unsatisfiable at HEAD).
- **Mechanism:** one core `stopKindOf(dispositions, cause)` total over STOP_KINDS, consuming
  GAP-022's enum; every terminal path (report, futility, override exhaustion, halt) routed
  through one adapter closer; a `satisfies` proves every kind has a producing branch. Pair with
  a resume path: a `noop`/`blocked` run revives on `conductor_answer` instead of archiving lost
  work. **Land before 13.2.**
- **Floor raised:** a lost-work or waiting run can no longer masquerade as done; with GAP-014,
  honest waiting stops being punished relative to defer.

#### GAP-022 — One disposition function: "actionable | waiting-human | stuck | settled"
- **STRUCTURAL · M · origin MM-020** (land together with GAP-021 — shared enum)
- **Grounding:** MACRO-005 (seven strain points across ≥4 predicates with different closures;
  the FSM edges never strained — the strain is entirely the derived layer), ISSUE-055/-066/
  -067/-068/-050, C-084/C-085 (the undetectable wedge).
- **Mechanism:** one core `dispositionOf(item, ctx)`, consumed by the scheduler (skip
  non-actionable — closes ISSUE-068's class), the continuation engine (re-prompt iff
  actionable; detectable-wait iff waiting-human — converts ISSUE-067's silent wedge into a
  recorded stop), and the report closer. Disposition stays derived (storing it would mint a new
  two-spellings problem).
- **Floor raised:** a new execution mode extends one function instead of minting a new wedge.

#### GAP-023 — An operator health surface: sustained abnormality becomes an artifact
- **DETECTED · S–M · origin MM-021**
- **Grounding:** MACRO-022 (failure visibility = one swallowed journal line; the deny snapshot
  needed to diagnose the default-mode lockout journals at `debug`, below default verbosity;
  time-to-cause hours→unbounded), ISSUE-033 (never-settling re-prompt silences the idle engine
  forever), ISSUE-034 (a deterministic throw makes it permanently silent through the G5 catch),
  ISSUE-031 (a journal throw in the watchdog wedges the wave).
- **Mechanism:** (a) extend the §3.8 beacon with last-error/last-progress/doctrine-digest;
  (b) a floor converting N consecutive `hook.failed`/latch-skipped passes into a recorded `env`
  stop with a report (extends C-085's transport floor to the store seam); (c) journal gate-deny
  snapshots at their own level, not `debug`.
- **Floor raised:** time-to-cause drops from hours/unbounded to the next status poll.

#### GAP-024 — Tolerant ledgers and a guaranteed terminal report
- **STRUCTURAL · S · origin MM-022**
- **Grounding:** ISSUE-101 (`handleStatus` and the stop-report writer die on a torn
  `questions.jsonl` — the run is unclosable exactly post-crash), ISSUE-061 (a throwing report
  writer leaves a stopped run with no artifact, violating §2.9), ISSUE-062, MACRO-023 (five
  hand-built ledgers, ≥3 crash postures — the same lesson re-learned per ledger).
- **Mechanism:** one shared `readJsonlTolerant`/`appendJsonl` pair (generalize journal.ts's
  C-017 healing to all five ledgers); the stop-report writer fails soft per section.
- **Floor raised:** the ISSUE-101 class becomes unrepresentable; every terminal state actually
  hands the human the §2.9 artifact.

### 2.5 Theme IV — Security and concurrency, made structural

#### GAP-025 — The git/write gate moves from enumeration to attribution
- **STRUCTURAL · M + false-positive pass · DEC (flip timing vs live deny-rate) · origin MM-014**
- **Grounding:** MACRO-009 (measured: 0 reproduced bypasses on deny-by-default surfaces, 6+ on
  enumeration surfaces — same layer, sometimes the same function), ISSUE-014 (wrapper/keyword
  prefixes hide the git verb AND strip the fail-closed guard), ISSUE-015 (`git -c
  core.pager=<cmd>` — arbitrary execution; the disclosure claims the class closed), ISSUE-017
  (`apply_patch` bypasses the edit gate), ISSUE-018/-019/-020/-021.
- **Mechanism:** a token that basename-resolves to `git`/a write tool in an unattributable
  position is DENIED; compound/keyword-prefixed commands the parser cannot attribute are denied
  for write-capable sessions; enumerations become allow-lists. Small closures land now
  (`-c` exec-keys deny, `git-<sub>` basenames, `--flag=value` normalization, `checkout -p`);
  the posture flip pairs with IDEA-LC-9 (record the benign-deny rate at first live contact).
  The stronger form (IDEA-STRUCT-2 filesystem sandbox) is named for the owner (§9).
- **Floor raised:** the security posture stops depending on the completeness of a hand-list an
  adversary can walk off; two falsified HONEST-LIMITS claims become true.

#### GAP-026 — Restore the case-fold `.conductor` state-area deny
- **STRUCTURAL (restores designed prevention) · XS · origin MM-015**
- **Grounding:** ISSUE-016 (`.Conductor/state/x` writes the real state area on the target FS —
  direct forgery of run state/evidence/journal; `headsOverlap` already folds case for exactly
  this reason). **GAP-013's provenance guarantee depends on this.**
- **Mechanism:** fold case in the `.conductor` deny on case-insensitive platforms.

#### GAP-027 — An OS single-writer lock; evidence attribution as immediate defense-in-depth
- **STRUCTURAL · S (check) + S (flock) · DEC (or declare single-operator) · origin MM-033**
- **Grounding:** MACRO-027 ("read-only conductor" guards 2 of ~12 mutating methods; zero
  `.readOnly` consumers outside state.ts — re-verified), ISSUE-023/-024/-025 (TOCTOU stale-lock
  break; release() deletes whoever's lock is present; beacon overwritten pre-lock),
  ISSUE-026/-027/-028 (the composed chain: duplicate seqs → publish ships one item's green on
  another's verify). 13.2's SG-K names accidental second sessions as a *when*.
- **Mechanism:** `flock`/`O_EXCL` held for process lifetime (second open fails, full stop);
  demotion collapses to one refuse-registration check; beacon written after winning the lock.
  Land the ~10-line itemId/tree assertion in `readEvidenceAt`'s security-relevant callers NOW —
  it closes the corruption consequence independently of the lock.
- **Floor raised:** the double-writer→seq-collision→wrong-publish chain becomes impossible.

#### GAP-028 — One transactional block-and-ask primitive
- **STRUCTURAL · S · origin MM-034**
- **Grounding:** ISSUE-100 (the C-032 E7 crash-window class at 7 sites; prevention covers 2;
  the reconciler's origin filter excludes 4; C-067(a)'s owed wiring never landed across ≥3
  rounds), correction cluster D (~12 crash-safety corrections — convention where a primitive
  was needed).
- **Mechanism:** `blockItemWithQuestion(item, question, ctx)` writing both halves as one
  crash-safe unit, routed through all 7 sites; widen the reconciler to all origins.
- **Floor raised:** the orphan-question-after-crash class closes at all seven sites at once.

### 2.6 Theme V — The build floor (audit layer, vocabulary, record, live-task readiness)

#### GAP-016 — A vocabulary registry with two-way parity, cross-language derivation included
- **STRUCTURAL · M harness + incremental migration · origin MM-023 + DE-013(b)**
- **Grounding:** enforcement §7.3 (~26 closed vocabularies; unguarded restatements outnumber
  guarded), MACRO-012 (a stop-kind change touches 6 files in 3 languages, none derivable),
  ISSUE-114 (a ROLE_PACKS pack silently never delivered — reproduced), ISSUE-113 (a seventh TS
  stop kind hard-crashes the 14.2 campaign python-side), ISSUE-120/-121/-122/-123/-115/-117/
  -118/-125/-126/-131; the exemplary guards exist (single-source.test.ts; composition.test:823).
- **Mechanism:** each vocabulary declares owner + restatement sites (incl. cross-language +
  schema export); one generated test asserts set-equality both directions; python copies derive
  from exported schemas. **One substrate with GAP-002** (both declare "what must exist" —
  building them separately would itself be a two-spellings defect). Phase 17's three new
  vocabularies are its first natives. Typed `ROLES`/`Record<Role,…>` land regardless.
- **Floor raised:** P3 — the most frequent defect pattern — stops drifting silently; C-082's
  class becomes a red test.

#### GAP-017 — Inverted subject selection for every scanner and gate leg
- **STRUCTURAL · M · origin MM-016** (stripComments canary is a pre-addendum prerequisite)
- **Grounding:** MACRO-016 (23% of corrections are inspects-less-than-it-appears; six are M5's
  file-set alone; live at HEAD in the audit layer built to catch it), ISSUE-088 (stripComments
  blanks ~240 lines of tools.ts including a real call site — growth lands in the blanked span,
  MACRO-026), ISSUE-089 (deleting tsconfig silently disables the M3 leg), ISSUE-092 (M5 holes),
  ISSUE-097/-098 (zero-test vacuous greens), ISSUE-140 (fixed /tmp scratch — a C-078 recurrence).
- **Mechanism:** scan all tracked source MINUS an explicit exemption list, fail on unexplained
  `git ls-files` delta; leg-activation conditionals become leg-missing failures; string-aware
  `stripComments` hoisted + a sentinel EOF canary; `ctest --no-tests=error`; a bun-leg count
  floor; mktemp scratch in verify-acceptance.
- **Floor raised:** "the check covered its intended set" becomes a machine fact; the signature
  P1 class stops being available to new growth, including the addendum's.

#### GAP-018 — A standing mutation suite over the audit layer
- **DETECTED-standing · M · origin MM-017**
- **Grounding:** MACRO-019 (mutation testing — the build's most productive instrument — never
  institutionalized; the audit layer it never reached is where the ~15 surviving mutations
  concentrate, enforcement §7.4), ISSUE-090 (a recorded revertAssertion proof rotted).
- **Mechanism:** a standing suite seeded from the ~15 named survivors, run at phase gates, with
  C-049/C-051's compile-and-applied assertions in the runner; IDEA-STRUCT-7's durable form
  (machine-applicable patch + expected failing ids per task) so proof claims stop rotting.
  Seed corpus addition: the ops-docs.test section-parser mutation step 3 proposed and nobody
  has run (§10).
- **Floor raised:** a decorative audit check stops being able to ship as enforcement.

#### GAP-019 — A control/discrimination witness: every checker proves it can fail
- **DETECTED · S per check · origin MM-024 + DE-013(a)**
- **Grounding:** ISSUE-064/-128/-130 (validators deletable, full gate green), ISSUE-047 (a
  fixture that throws for every input, indistinguishable from a clean file), ISSUE-094 (both
  sides of acceptance row 10 flow through the subject), ISSUE-103 (NOISE_NOTE inverted survives),
  ISSUE-135 (doctrine anchors pin keywords, not polarity), ISSUE-141 (two weak acceptance
  detectors), ISSUE-095/-096/-099 — the P2/P5 class, ~8 reproduced instances.
- **Mechanism:** every validator/guard ships a refusal test; every acceptance comparison
  restates one side as a literal the subject cannot reach; anchors quote full normative
  sentences including polarity. GAP-018 is the enforcer.
- **Floor raised:** a check that passes without being able to fail stops shipping as enforcement.

#### GAP-020 — An unreachable-exports audit
- **DETECTED-standing · S · origin MM-025**
- **Grounding:** correction cluster C (~9, highest severity-per-entry; terminal instance
  ISSUE-001), ISSUE-038/-039/-040/-116/-104 (written-and-read-by-nothing), inject.ts (fully
  built, fully tested, zero production callers).
- **Mechanism:** a gate leg walking the import graph from `plugin/index.ts`, failing on any
  exported adapter/core symbol reachable from no production path unless on a "names its wiring
  task" exemption list; a companion write-without-read grep for state/evidence fields.
- **Floor raised:** built-but-never-wired becomes uncommittable without a tracked obligation.

#### GAP-029 — A router-contact witness in every report
- **DETECTED (the right tier — the router is optional under G5) · S · origin MM-010**
- **Grounding:** ISSUE-038 (metrics never composed into report deps — "unavailable" in every
  report, healthy or not), ISSUE-039 (`metricsPartial` written and read by nothing), ISSUE-086
  (the counter-moved claim asserted by nothing; drift observed live), ISSUE-139 (the
  unvalidated `MetricsSummary` cast — becomes load-bearing the moment ISSUE-038 is fixed).
- **Mechanism:** compose `metrics` into report deps; snapshot `totalRequests` at run start and
  report, render the delta beside the session count (a run whose delta is ~0 while N
  sub-sessions ran is loudly unrouted); render `metricsPartial`; validate the summary shape at
  the seam (ISSUE-139).
- **Floor raised:** the C-089/ISSUE-074 tautology class loses its main remaining habitat.

#### GAP-030 — A row-id ↔ test-title bijection and a row lifecycle
- **DETECTED · S · origin MM-026**
- **Grounding:** ISSUE-081 (`coveredByTest` dead on 548/795 rows yet read as evidence — misled
  a phase adjudicator), ISSUE-132/-133 (118 orphan rows; a false coverage claim; uncheckable
  prose links), ISSUE-075/-076 (promoted rows ticked while unmet; two live rows discharged by
  nothing), MACRO-020 (the mechanism shipped without its lifecycle).
- **Mechanism:** a gate leg asserting every row id appears in exactly one test title and every
  id-shaped title maps to a row (IDEA-ROW-1); a `disposition` field
  (met/superseded-by/waived/covered-elsewhere) a scope-narrowing fix task MUST write
  (IDEA-ROW-2); one-time backfill.
- **Floor raised:** the ledger stops claiming coverage it does not have (P13 goes red).

#### GAP-031 — Gate-record completeness, a currency stamp, and an obligations index
- **DETECTED · S–M · origin MM-027**
- **Grounding:** ISSUE-083 (the M1–M9 ledger silently ends at 11.8 — eleven COMMITTED tasks
  recordless), ISSUE-082 (four surfaces, four presents — the cold boot delivers retracted
  claims), ISSUE-073 (STATE.json still narrates the retracted G5 tautology), MACRO-013/-017/
  -030 (recorded debt measurably fails to land, 2 lost : 1 landed; the record decayed at ~task
  40 of 52; the addendum adds ~12 tasks onto it).
- **Mechanism:** (a) a gate leg failing when a COMMITTED task lacks a gate record (script-emit
  rows forward); (b) one currency stamp across HANDOFF/STATE/NOW/JOURNAL with a staleness
  check; (c) a generated CORRECTIONS index that fails when an entry carries an obligation-verb
  with no status. Phase 16 is the natural home — extend its charter from files to records.
- **Floor raised:** the record can no longer rot without failing something.

#### GAP-032 — A spec-currency check and a pre-live-contact preflight
- **DETECTED · S–M · **blocks 13.2/14.2** · origin MM-028**
- **Grounding:** MACRO-028 (BLOCKING — 13.2's spec verified 142 commits behind HEAD, specced
  against the dead channel; 14.2's three-arm design inverted at HEAD), ISSUE-078 (C-075's
  mandated spec revision never landed — a three-way path conflict), ISSUE-107 (PATH-less cells:
  90/90 harness-error), ISSUE-104 (a report column reads a file nothing writes), MACRO-029.
- **Mechanism:** (a) a spec-currency gate leg (`verifiedAgainstHead` vs changes to cited
  files); (b) a pre-live preflight: spawn ONE 14.2 cell end-to-end against a trivial task, run
  verify-acceptance against a planted dummy at the real path, land GAP-033's checkers first —
  a ~2-minute go/no-go; (c) a one-page "14.2 validity preconditions" note naming
  ISSUE-001/-104/-065/-107 with the row each corrupts.
- **Floor raised:** the two scheduled live tasks stop burning their model-gated budget
  rediscovering the step-2 register.

#### GAP-033 — Checkers ship before the live artifacts, bound to runId + evidence seq
- **DETECTED→structural · M · **blocks 13.2/14.2** · origin MM-029**
- **Grounding:** ISSUE-093 (a fabricated SMOKE.md flips acceptance row 6 in ~15s; rows 6/8 have
  no standing node guard — the two artifacts left are the two the meters cannot defend, under
  the build's own worst-case-failure declaration), ISSUE-074 (the G5 checker proves consistency
  not provenance — but its existence is why row 9b's fabrication was contained), ISSUE-104.
- **Mechanism:** ship SMOKE.md / conductor-report.md checkers BEFORE the artifacts; each
  artifact embeds a runId + evidence seq the checker re-validates against the run's own ledger;
  require a real `^\s*\$ ` command line + a content floor. Checker-before-artifact becomes a
  standing rule, not a post-mortem.
- **Floor raised:** the cheapest fabrication in the whole review closes for exactly the two
  artifacts that matter.

#### GAP-034 — A reconstructable decision trail: replay imports its vocabulary
- **STRUCTURAL (vocab) / DETECTED (empty-vs-broken) · S · origin MM-030**
- **Grounding:** ISSUE-131 (replay restates nine event/component literals + every producer data
  key; a renamed key blanks a timeline silently while its guard-test claims it "reuses the core
  vocabulary"), ISSUE-104, MACRO-022 (the §7.3 debuggability audience).
- **Mechanism:** export event names from journal-events.ts and import them; produce replay's
  fixtures by running the committed producer; empty sections distinguish "no events" from "no
  parseable events". GAP-016's registry covers the data keys.
- **Floor raised:** the diagnostic tool stops silently under-reporting.

#### GAP-035 — Gate determinism and durable failure evidence
- **DETECTED/structural (clock) · S–M · **taints every other verdict until landed** · origin MM-031**
- **Grounding:** ISSUE-032 (no `--test-timeout` — a hang-shaped regression wedges the gate
  forever; measured twice), ISSUE-134 (the full parallel gate nondeterministically red on
  unmutated HEAD; two of three failure shapes are the PRODUCT enforcing differently under load
  — proposed P14; every recorded GATE PASS is a distribution sample; SWEEP-GM-010's
  intermittent stamp test folded here as a facet), MACRO-018.
- **Mechanism:** `--test-timeout=120000` + a small test-config `subSessionTimeoutMs`; copy the
  leg scratch dir to a durable location before the trap fires on failure; an injectable
  monotonic clock at the freshness/stale-red seams (the likely P14 root).
- **Floor raised:** a hang becomes a diagnosable red; the enforcement suite stops enforcing
  differently under load; every future mutation verdict becomes trustworthy.

### 2.7 Theme VI — Doctrine content (the advisory layer, aligned with the machine)

#### GAP-037 — An orchestrator playbook: a generated "run shape" section in core.md
- **ADVISORY (rides GAP-001/-006 structural floors) · XS · origin DE-002 (doctrine facet)**
- **Grounding:** core.md says "work the legal next action" and never says what that is; the
  designed answer (the state block) is dead (ISSUE-001) and the structural floor absent
  (ISSUE-005). The only ordering signal arriving today is the one-line tool descriptions.
- **Mechanism:** ~15 lines naming the stage tools in order and meta-tool legality conditions,
  GENERATED from `legalTools`' table (hand-writing it would mint a new P3 spelling).

#### GAP-038 — Deny-recovery doctrine, a closed OVERRIDE_GATES vocabulary, and a deny-loop floor
- **Mixed (vocab structural; text advisory; floor detected) · S · origin DE-003**
- **Grounding:** ISSUE-002 (the first thing a live model meets is a deny loop), ISSUE-007 (a
  misspelled override gate burns budget and can kill the run; NOTHING names the three spendable
  gates), MACRO-022 (the deny snapshot journals below default verbosity), adversary log (f)
  (honest use of the documented hatch is punished).
- **Mechanism:** (1) a ~12-line "when the harness refuses you" section in every pack (never
  retry the same write; the ladder is narrow-your-edit → NEEDS_CONTEXT → override last; the
  only spendable gates are `session`/`git`/`edit`); (2) closed OVERRIDE_GATES validated at mint
  time (ISSUE-007's fix); (3) N-consecutive-denies converts to a surfaced question/anomaly
  (extends the continuation floor; IDEA-DE-4's state-block deny hint as the delivery vehicle).

#### GAP-039 — tdd.md's headline cycle ends in an action the git gate always denies
- **ADVISORY · XS · origin DE-006**
- **Grounding:** verified — tdd.md teaches "red → green → commit"; `gates-git.ts:383` denies
  `git commit` for every model session. A doctrine-following implementer walks into a
  guaranteed deny at the end of every green, with unguided recovery (GAP-038) and
  doctrine-credibility damage.
- **Mechanism:** rewrite the cycle as red → green → hand back ("`conductor_publish` commits;
  you never run git commit — a self-publish is denied by design"). Anchor the full sentence
  (ISSUE-135's fix form).

#### GAP-040 — The reply protocols get names in doctrine; the pushback matcher gets exact tokens
- **Mixed (matcher structural; naming advisory) · S · origin DE-007**
- **Grounding:** verified — NEEDS_CONTEXT (tools.ts:3201/3852/4272) and DONE_WITH_CONCERNS
  (tools.ts:5806/5837) exist only in dispatch prompts; no pack names either; receive-review.md
  says "ask" / "refute with evidence" with no channel; ISSUE-049 (substring matching — F10
  matches F1 — mis-adjudicates a doctrine-following fixer's loosely-worded concern), ISSUE-036
  (the conversion path leaks).
- **Mechanism:** GAP-005's generated MECHANICS section carries the reply statuses + exact
  concern format; exact-token pushback matching (ISSUE-049's fix); ISSUE-036's queue fix.

#### GAP-041 — test-vet.md and the §2.10 criteria become one list, and the criteria bite
- **Mixed · S · origin DE-008**
- **Grounding:** verified — the vet critic scores five §2.10 criteria; test-vet.md teaches five
  *different* mock anti-patterns (≈ one criterion); three of five scored criteria have no
  doctrine; ISSUE-013 (the criteria verdicts gate nothing — a pass:false with empty mustFix
  advances).
- **Mechanism:** derive the criteria list from one source into pack + prompt (spelled today at
  tools.ts:2942 and 5884); two sentences of doctrine per criterion; land ISSUE-013's fix
  (pass:false implies a mustFix entry).

#### GAP-042 — decompose.md teaches the units the gates actually measure
- **ADVISORY (after the GAP-009/-010/-015 enforcement pass) · XS · origin DE-009**
- **Grounding:** ISSUE-012 (pack says "~5 files … rejected outright"; the gate counts entries),
  ISSUE-011 (pack never says "no wildcard heads"), ISSUE-008 (silent on
  fileScope∩testScope), ISSUE-009/-048 (the pack's "the law bends by path arithmetic" is
  falsified two ways).
- **Mechanism:** enforcement first (owned by GAP-009/-010/-015 + ISSUE-009's one-line fix);
  then align the pack's vocabulary to what the gate measures and delete claims that remain
  false (the MACRO-021 rule applied to doctrine).

#### GAP-043 — A uniform stuck-state protocol in every pack, priced on the harness side
- **ADVISORY (text) + structural (pricing/visibility) · S · origin DE-010**
- **Grounding:** debug.md's 3-fix rule is the only stuck protocol in nine packs and arrives
  only in DEBUG posture; the certain-hit stuck states occur earlier (the testWriter whose test
  passes immediately — redAdmission's routine stale-item refusal; the fixer whose finding is
  wrong; the deny loop; the skeptic who cannot evaluate); ISSUE-036 (the NEEDS_CONTEXT path
  leaks); ISSUE-065/-066 (flailing exits read as done/noop and the gradient rewards them).
- **Mechanism:** ~8 lines per pack (bounded attempts → NEEDS_CONTEXT with a
  named-what-you-need payload — never silence, never an out-of-scope workaround); harness side:
  fix the conversion leaks, make stuck-exits report-visible (rides GAP-014/-021).

#### GAP-044 — core.md's ask policy stops contradicting the mid-run surface design
- **ADVISORY · XS · origin DE-011**
- **Grounding:** verified — core.md: "Questions are batched at run boundaries, not fired
  mid-run"; plan line 1873 has the "or as surfaced" arm the pack's compression dropped;
  conductor_surface's own description is explicitly mid-run. A literal-following orchestrator
  sits on blockers, feeding ISSUE-065's mislabeled terminals and ISSUE-051's self-answer path.
- **Mechanism:** one sentence ("surface the moment it blocks an item — the human sees questions
  batched; you do not sit on them") + anchor update.

### 2.8 SPECULATIVE entries (ranked below every grounded GAP, per the charter)

#### GAP-045 — SPECULATIVE: partial-context work has no doctrine or mechanism
- **origin DE-014.** No reproduced defect (no live model has run). The arithmetic is real:
  review payloads embed full diffs; e2e.test.ts alone is 51k tokens vs a ~24k usable 32k
  budget. Mechanism if wanted: a dispatcher token bound that splits oversized review payloads
  (structural), plus "say what you did not read" paired with GAP-011's coverage receipt.

#### GAP-046 — SPECULATIVE: a per-role doctrine-efficacy probe at 13.2/14.2
- **origin IDEA-SPEC-1 + IDEA-DE-6 · LIVE.** Grounded only in the delivery defect (ISSUE-001),
  not a reproduced efficacy defect. Measure per role: doctrine-citation rate, deny-recovery
  behavior, NEEDS_CONTEXT usage vs silence, skeptic abstention rate. These four numbers falsify
  or confirm every structural retention judgement in §3. Folds into the 14.2 campaign design.

#### GAP-047 — SPECULATIVE: a "blocked / waiting-human" doctrine pack
- **origin IDEA-SPEC-2.** The structural fixes (GAP-013/-014/-021) make the behavior
  structural, which is strictly better than a pack asking for it; recorded so the option is
  visible, not endorsed over them.

#### GAP-048 — SPECULATIVE: a dashboard/ coverage pass
- **origin IDEA-SPEC-3.** `dashboard/ledger_view.hpp` + `main.cpp` (1,077 ln) were examined by
  nobody across all three reviews — the suite's single real coverage gap. Not grounded in a
  defect (nobody looked); it reads the same ledgers whose seq hole (ISSUE-026) and torn-line
  throws (ISSUE-101) are live, so a reader there may inherit them.

---

## 3. The doctrine assessment — all nine packs, judged for a 32k weak-instruction model

Full per-pack records: `parts-capability/doctrine-efficacy.md` §2 (all nine read in full; the
delivery mapping verified against inject.ts; gate collisions verified against source). The two
framing facts: **doctrine has never reached a session** (ISSUE-001 — every judgement below is
about the post-wiring world), and **length is NOT the problem** — measured, every role's
doctrine load is ≤8.3% of a 32k window; the risk is attention position (packs in system
position, unguarded paraphrases + payload at the prompt tail, and the tail wins), which is what
makes GAP-005 load-bearing for efficacy, not just hygiene.

| Pack | ~Tokens | Verdict (one line) | Owning GAPs |
|---|---|---|---|
| core.md | ~1,120 | Strongest epistemology, weakest procedure: "work the legal next action" is unfollowable (state block dead); ask-policy contradicts the surface design; override vocabulary never named; reaches only 2 of 7 roles while governing tools any session can call | GAP-037, -038, -044 (+001, -006) |
| debug.md | ~803 | The best pack — numbered phases, one-sentence self-tests, the set's only stuck protocol (the 3-fix rule); also the ONLY pack whose content governs anything as shipped; missing: where to record the hypothesis, and no `debugFixCap` warning | (minor edits only) |
| decompose.md | ~1,299 | Well-structured but overstates its gates: teaches "files" where the gate counts entries (ISSUE-012), silent on wildcard heads (ISSUE-011) and fileScope∩testScope (ISSUE-008); its "the law bends by path arithmetic" is falsified twice (ISSUE-009/-048) | GAP-042 (after -009/-010/-015) |
| plan.md | ~1,094 | Followable; the casualty is Rule 3 (complete code for non-obvious steps) — effort-shedding the plan-review fan-out catches at the cost of rounds; queue_amend has no doctrine anywhere | (minor; queue_amend note) |
| receive-review.md | ~693 | Right philosophy, unfollowable protocol: "ask" and "refute with evidence" name no mechanism (NEEDS_CONTEXT / DONE_WITH_CONCERNS live only in prompts); its strongest "never" (don't weaken the test) is its least enforced (ISSUE-008); tone rules will be retained, verification work shed | GAP-040 (+007) |
| review.md | ~899 | Good severity rubric; but "an empty findings list IS the approval" is a sanctioned zero-effort exit for a lazy model with E8 accepted-on-trust; the adjudication-order paragraph is aimed at the machinery, not the reviewer; no partial-coverage protocol | GAP-011 (+045) |
| skeptic.md | ~819 | The most consequential defect in the set, with a conviction record: "uncertain ⇒ refuted" converts weak-model incapacity into finding-killing verdicts (C-082/P10 sealed a true finding; 2 of the audited refutations were wrong); no abstention exists in pack or schema; the P10 identifier-position rule is in no pack | GAP-036 |
| tdd.md | ~901 | Strong voice, right law, the best weak-model artifact (the rationalization table) — and its headline cycle ends in `git commit`, an action the gate always denies (verified gates-git.ts:383); zero harness nouns; no doctrine for the routine test-passes-immediately stale-item case | GAP-039, -043 (+005) |
| test-vet.md | ~805 | A good pack ported for a different job: five mock anti-patterns vs five *different* §2.10 scored criteria; three of five criteria have no doctrine at all — and the criteria verdicts gate nothing anyway (ISSUE-013) | GAP-041 |

**Cross-pack findings:** the review-layer packs *compound* in the lazy direction (reviewer
silence sanctioned + skeptic default kills survivors = both bias toward "nothing is wrong",
ISSUE-072 restated at the doctrine layer); receive-review's "ask" vs core's "derive, never ask"
is a system-level incoherence resolved only in machinery no doctrine names; no pack names any
reply protocol; stuck-state guidance is absent everywhere except debug.md, which arrives only
after GREEN. **Cleared:** pack length (all fine at 32k); debug.md and plan.md contradiction-free
against every other pack and gate; decompose.md's reuse-note enforcement claim is honest
(verified planning.ts:390–397); a classifier pack was considered and cleared (classification is
skeptic-checked and disagreement-normalized mechanically, E4). **Honest limit:** no live
weak-instruction model was run; every "first dropped" is a structural judgement plus
build-record analogs from stronger models, falsifiable by GAP-046's four measurements.

---

## 4. The IDEA register (capability lens; prior registers endorsed)

The step-2 (§3) and step-3 (§5) IDEA registers remain authoritative for their entries; all
IDEA-STRUCT-1..8 have been consumed into GAPs (mapping in §10). Capability-lens additions:

- **IDEA-DE-1** — fix the dangling `[[decompose]]` wiki-link in core.md (renders literally in a
  delivered system prompt). Polish; minutes.
- **IDEA-DE-2** — stamp a pack name + content-hash header into each delivered pack, so a
  transcript shows which doctrine version governed a session (feeds GAP-046's measurement). ~1h.
- **IDEA-DE-3** — front-load every pack with a ≤10-line imperative summary; in every pack the
  headline survives and the balancing qualifier dies — put the load-bearing clause where a weak
  model retains it. ~half a day, no semantic change.
- **IDEA-DE-4** — the state block carries a deny-recovery hint when the session's last action
  was denied ("your last write was denied by the <gate> gate: <reason>; do not retry — narrow
  scope or reply NEEDS_CONTEXT") — the cheapest possible deny doctrine, delivered exactly when
  relevant. ~2h once GAP-001 wiring lands. (Delivery vehicle for GAP-038.)
- **IDEA-DE-5** — anchor tests quote the sentence, not the keyword; every doctrine GAP fix
  above lands with its polarity-carrying anchor (rides ISSUE-135's fix / GAP-019).
- **IDEA-DE-6** — endorse MACRO-032's measurement plan as the acceptance test for the whole
  doctrine lens (= GAP-046).
- **IDEA-CAP-1** — a generated runtime navigation surface: the state block's
  recommended-next-tool line is the runtime analog of IDEA-NAV-1's static map — count that
  second role when weighing GAP-001; adjacent: sub-file scope claims (line-range/symbol) and a
  repo-size budget gate row (grounded in MACRO-010's Task-A-does-not-fit-32k measurement).
- **IDEA-CAP-2** — the `additionalProperties:false` discipline generalized: every handler
  parsing model-supplied input rejects unknown keys (gives the ISSUE-128/-130 validators
  teeth). Thin — no reproduced exploit rides an extra field today.
- **IDEA-CAP-3** — a stated, mechanically-checkable promotion criterion for core ("a rule that
  adjudicates/routes model-supplied content, OR has two call sites, OR is re-checked by a gate,
  MUST be an exported core function with refusal tests") — folded into GAP-010; grounded in
  ISSUE-054.
- **IDEA-CAP-4** — correct the addendum's file lists BEFORE executing it (Task 17.3/18.1 omit
  tool-bindings.ts and plugin/index.ts — the two files with silent failure modes, MACRO-025);
  surfaced as a decision (§9), not a work item.

**Reclassifications made by this merge:** four step-2 DROPPED part-findings re-registered as
ISSUEs (ISSUE-139 unvalidated MetricsSummary cast; ISSUE-140 verify-acceptance fixed-/tmp
scratch, a C-078 class recurrence; ISSUE-141 two weak acceptance detectors; SWEEP-GM-010
recorded as a facet of ISSUE-134, not separately numbered). One step-3 enforcement-pointer
promoted: **ISSUE-142** — `sameTree` in plugin/index.ts:829 is an unguarded cross-layer
restatement of gates-edit.ts:196-198, coupled by comment only (P3, MINOR; closed by GAP-002's
`deriveGateFacts`/IDEA-LC-8). No IDEA needed demotion; no MACRO reduced to a single local bug
(each was checked — the closest candidate, MACRO-003, has three independent authorship events
and stays structural).

---

## 5. The unified register (every id from all three reviews, one table)

**224 entries: ISSUE-001…-142 (138 from step 2 + 4 minted by this merge), MACRO-001…-034,
GAP-001…-048.** Columns: severity (C=CRITICAL, BL=BLOCKING, H=HIGH, MJ=MAJOR, MD=MEDIUM,
MN=MINOR, L=LOW, OP=OPINION, SP=SPECULATIVE) · subsystem · effort (XS<2h, S≤1d, M 2–3d, L>3d,
LIVE, DEC) · systemic cluster (§6) · closed-by / relation (`→GAP-x` = the GAP whose mechanism
closes or absorbs it; `≡` = same underlying defect at another lens depth; `fix` = a filed
one-off fix, no new mechanism needed) · one-line summary. Dedupe note: MACRO/GAP rows that are
the same defect as an ISSUE at a different depth are marked `≡`; ids are never deleted.

### 5.1 ISSUEs (step 2 + this merge)

| Id | Sev | Subsys | Eff | Cl | Closed by | One-line |
|---|---|---|---|---|---|---|
| ISSUE-001 | C | inj | M | SC-1 | wire + GAP-001/-003 | §6.4 injection never wired: no doctrine, state block, sampling, or router tags reach any session |
| ISSUE-002 | C | gate | S | SC-1 | fix + GAP-004 | default main-tree mode denies EVERY sub-session write (slug fed to a path gate) |
| ISSUE-003 | MJ | inj | S | SC-12 | GAP-005 | doctrine in two unguarded spellings; ENV_DOCTRINE_DIR override ~95% theater |
| ISSUE-004 | MJ | inj | XS | SC-1 | GAP-001(3) | fail-closed-at-init is actually first-tool-call; beacon can't say doctrine loaded |
| ISSUE-005 | MJ | tools | S | SC-2 | GAP-006 | meta tools + classify guarded by neither phase gate nor (dead) state block — reproduced 3 ways |
| ISSUE-006 | MJ | tools | S | SC-2 | GAP-006(b) | any registered sub-session calls any conductor_* tool: self-answer/self-defer/self-amend |
| ISSUE-007 | MJ | tools | XS | SC-2 | GAP-038(2) | override gate is a free string; misspelling burns budget and can kill the run |
| ISSUE-008 | MJ | gate | S | SC-3 | GAP-007/-010 | item may claim its own test file; implementer rewrites the vetted test, mark_green re-runs it |
| ISSUE-009 | MJ | core | XS | SC-3 | fix | rootLevelOnly glob hole: root-level production files skip TDD entirely under safe defaults |
| ISSUE-010 | MJ | tools | XS | SC-3 | GAP-008 | mark_green discards zero-test/fallback facts; a vacuous green is admitted |
| ISSUE-011 | MJ | core | S | SC-3 | GAP-009 | missing-subject legal RED is vacuous under wildcard-headed fileScope |
| ISSUE-012 | MD | core | S | SC-3 | GAP-009 | §3.2 size budget counts fileScope ENTRIES; one glob evades it (C-030 E12 wrongly refuted) |
| ISSUE-013 | MD | tools | XS | SC-4 | GAP-041(3) | vet criteria verdicts gate nothing; pass:false with empty mustFix advances |
| ISSUE-014 | MJ | gate | M | SC-6 | GAP-025 | wrappers/keywords hide git writes; gate crash on them fails OPEN; disclosure claims otherwise |
| ISSUE-015 | MJ | gate | XS | SC-6 | GAP-025 | `git -c core.pager=<cmd>` = arbitrary execution with a clean read-only verb |
| ISSUE-016 | MJ | gate | XS | SC-6 | GAP-026 | case-fold bypass of the .conductor state-area deny on the target FS |
| ISSUE-017 | MJ/lat | gate | S+DEC | SC-6 | GAP-025/§9 | apply_patch/patch bypass the edit-scope gate (no path extractor for patch bodies) |
| ISSUE-018 | MN | gate | S | SC-6 | GAP-025 | write-shape extractor mis-parses cp -t/--target-directory/sed; blind behind prefixes |
| ISSUE-019 | MN–MJ | gate | XS | SC-6 | GAP-025 | hyphenated git plumbing (git-apply) not detected as git |
| ISSUE-020 | MN | gate | XS | SC-6 | GAP-025 | bare `git branch <new>` allowed; `--set-upstream-to=` glued form slips the deny |
| ISSUE-021 | MN | gate | XS | SC-6 | fix | `git checkout -p` worktree-discard allowed under check-only policy |
| ISSUE-022 | MN | plug | XS | SC-1 | GAP-002 | runActive hardcoded true at the gate seam; deny reason is an unkeepable promise |
| ISSUE-023 | MJ | state | S | SC-8 | GAP-027 | readOnly guards 2 of ~12 mutating methods; nothing consults the flag; beacon overwritten pre-lock |
| ISSUE-024 | MJ | state | S | SC-8 | GAP-027 | stale-lock break is read-then-overwrite: two racers both become writers |
| ISSUE-025 | MD | state | XS | SC-8 | GAP-027 | release() deletes whoever's lock is present |
| ISSUE-026 | MD | state | S | SC-8 | GAP-027 | evidence nextSeq unguarded cross-process; readEvidenceAt returns wrong record |
| ISSUE-027 | L | state | XS | SC-8 | GAP-027 | publish resolves verify record by seq alone, never checks itemId/tree |
| ISSUE-028 | MD | state | XS | SC-8 | GAP-027 | the composed double-writer→seq-collision→wrong-publish chain |
| ISSUE-029 | L | state | XS | SC-8 | fix | quarantine partial-move crash leaks its dir forever |
| ISSUE-030 | MD | tools | S | SC-2 | fix | abandonment fence covers only StateStore; ledgers/questions/fanout bypass it |
| ISSUE-031 | MJ | fan | XS | SC-11 | fix | journal throw in watchdog callback skips finish(): wave barrier never resolves |
| ISSUE-032 | MJ | tst | XS | SC-11 | GAP-035 | test gate has no --test-timeout: a hang wedges the gate forever |
| ISSUE-033 | MN | fan | S | SC-11 | GAP-023 | never-settling re-prompt raises the latch forever; idle engine goes silent |
| ISSUE-034 | MN | fan | S | SC-11 | GAP-023 | deterministic early throw makes the idle engine permanently silent |
| ISSUE-035 | MN | fan | S | SC-11 | fix(tests) | watchdog-fired-then-completes paths proven by nothing; leaked session per race |
| ISSUE-036 | MN | fan | XS | SC-11 | fix | undelivered NEEDS_CONTEXT conversion double-reported "lost"; retention leak |
| ISSUE-037 | MN–MJ | fan | XS | SC-6 | fix | ask-gate wildcard screen misses metadata.filePath: `**` adjudicated as one file |
| ISSUE-038 | MJ | fan | XS | SC-1 | GAP-029 | fetchMetricsSummary never wired into report deps: metrics "unavailable" always |
| ISSUE-039 | MJ | fan | XS | SC-1 | GAP-029 | metricsPartial written and read by nothing |
| ISSUE-040 | MJ | fan | DEC | SC-1 | §9 | §4.4 failover protects only setup probes; model traffic cannot fail over; no deviation recorded |
| ISSUE-041 | MJ | rtr | DEC | SC-1 | §9 | the 503 envelope has no fan-out consumer; backoff/retry unimplemented, no deviation |
| ISSUE-042 | MJ/MN | rtr | S+DEC | — | §9 | per-model admission vs single-addend pool: distinct model names starve /conductor/health |
| ISSUE-043 | MJ | rtr | S | SC-1 | GAP-002 | no automated check runs the C++ parser against the CURRENT schema; export step never landed |
| ISSUE-044 | MN | rtr | XS | — | fix | MetricsLedger wait vector unbounded; O(N log N) under mutex per poll |
| ISSUE-045 | MN | rtr | XS | — | fix | schema-path fallback walks to a directory that no longer exists |
| ISSUE-046 | MJ | tools | XS | SC-3 | fix | publish hardcodes hasStagedDeletion:false — deletion-only edits ship unverified |
| ISSUE-047 | MJ/lat | tools | XS | — | fix | §2.1 {file} substitution unimplemented; check-mode format rules deny every publish |
| ISSUE-048 | MJ | tools | XS | SC-3 | GAP-015 | setup accepts behavioralPaths:[] — TDD off repo-wide in one call |
| ISSUE-049 | MJ | tools | XS | SC-4 | GAP-040 | item-review adjudication keys on model-authored ids; collisions drop upheld findings |
| ISSUE-050 | MJ(wt) | tools | S | SC-5 | fix | worktree publish recovery wedges: second publish finds "nothing to commit" |
| ISSUE-051 | MJ | tools | M | SC-5 | GAP-013 | conductor_answer is the model's own tool; answered questions vanish from the report |
| ISSUE-052 | MJ | tools | XS | SC-5 | GAP-014 | conductor_defer forges kind:"human" provenance |
| ISSUE-053 | MD | tools | DEC | SC-5 | GAP-021+§9 | report closes done on a RED closing verify; §2.9 vs §3.2 disagree |
| ISSUE-054 | MD | tools | S | SC-4 | GAP-010 | routeOf substring-matches raw glob scopes; test findings routed to guaranteed-deny |
| ISSUE-055 | MD | tools | XS | SC-5 | GAP-022 | red re-validate inside item_review throws into a state no tool services |
| ISSUE-056 | MD-L | tools | XS | — | fix | probeReverted swallows a failed stash pop; implementation left in the stash |
| ISSUE-057 | MD | tools | DEC | SC-5 | GAP-014+§9 | inline-claim expiry (§3.6) unimplemented and §2.5 cannot represent it |
| ISSUE-058 | L | tools | XS | — | fix | item_review re-validates never update evidence.validated; publish re-verifies |
| ISSUE-059 | L | tools | XS | SC-7 | fix | setupLiveRunId fails open on unreadable pointer; restates store layout |
| ISSUE-060 | L-MD | tools | XS+DEC | — | §9 | publish advances with zero staged files, silently |
| ISSUE-061 | L | tools | XS | SC-11 | GAP-024 | stop persisted before stop-report; a throwing writer leaves no artifact |
| ISSUE-062 | L | tools | XS | SC-11 | GAP-024 | handleAnswer swallows a torn ledger and releases everything |
| ISSUE-063 | L | tools | XS | — | fix | freeze-hold budget only if freeze observed before dispatch (TOCTOU) |
| ISSUE-064 | L | tools | XS | SC-4 | GAP-019 | assertDecisionValid is decorative — no refusal test |
| ISSUE-065 | MJ | core | S | SC-5 | GAP-021 | blocked/surfaced stop kinds computed by core, written by NOTHING — all-blocked runs stamp done |
| ISSUE-066 | MJ | core | S | SC-5 | GAP-021 | blocked item with dependent ends noop; answer-after-noop resume is dead; work lost |
| ISSUE-067 | MD | core | S | SC-5 | GAP-022 | blocked-without-question is a silent undetectable wedge, enshrined by a committed test |
| ISSUE-068 | MJ | core | XS | SC-5 | GAP-022 | legalTools recommends null under no-git when a REVIEWED item sorts first — wedge |
| ISSUE-069 | MN-MD | core | XS | — | fix | requireTwoOptions exempts kind:"human" from the ≥2-option rule entirely |
| ISSUE-070 | MN | core | XS | — | fix | isHumanTerritory bare words misclassify ordinary technical vocabulary |
| ISSUE-071 | MN | core | XS | — | fix | commit-message embeds model-authored id/globs without newline folding |
| ISSUE-072 | MN-MJ | tools | M | SC-4 | GAP-011/-036 | review layer accept-on-trust; "uncertain ⇒ refuted" extinguishes findings |
| ISSUE-073 | MJ | rec | XS | SC-9 | GAP-031 | STATE.json still narrates the retracted C-089 G5 tautology as real evidence |
| ISSUE-074 | MD | rec | XS | SC-10 | GAP-033 | G5 guard proves consistency not provenance; residual disclosed nowhere |
| ISSUE-075 | MJ | rec | S | SC-9 | GAP-030 | 14 of 21 promoted G5 rows unmet; no supersession; acceptance row 9b ticks anyway |
| ISSUE-076 | MJ | rec | S/LIVE | SC-9 | GAP-030 | two 11.8 LIVE rows discharged by nothing and undisclosed; M7/M8 recorded PASS |
| ISSUE-077 | MJ/MN | rec | XS/LIVE | SC-9 | fix | WIRE_CONTRACT_VERIFIED cites an SSE observation that never happened |
| ISSUE-078 | MJ | rec | XS | SC-10 | GAP-032 | C-075's mandated 14.2 spec revision never landed; three-way path conflict |
| ISSUE-079 | MD | rec | S | SC-4 | GAP-036 | refutations recorded without evidence; P10 auditing impossible from the record |
| ISSUE-080 | MD | doc | XS | SC-9 | fix | HONEST-LIMITS never received the 11.6 pending item; limit 9 outdated |
| ISSUE-081 | MD | rec | S | SC-9 | GAP-030 | coveredByTest dead on 548/795 rows yet read as evidence by an adjudicator |
| ISSUE-082 | MD | rec | S | SC-9 | GAP-031 | four record surfaces describe four different presents |
| ISSUE-083 | MD | rec | S | SC-9 | GAP-031 | the M1–M9 gate ledger silently ends at task 11.8 |
| ISSUE-084 | MN | rec | S | SC-9 | fix | filesTouched/commitSha imprecision on 9 of 55 STATE.json rows |
| ISSUE-085 | MN | rec | XS | SC-9 | fix | 11.8 row names a model/vehicle that is not what ran |
| ISSUE-086 | L-MD | tools | XS | SC-1 | GAP-029 | G5 driver's "counter moved" claim asserted by nothing; drift observed live |
| ISSUE-087 | L | tst | XS | — | fix | stale prunable worktree left registered again (C-074 F3 recurrence ×2) |
| ISSUE-088 | C(audit) | tst | XS | SC-6 | GAP-017 | stripComments blanks ~240 lines of tools.ts: the source audits are partly blind |
| ISSUE-089 | MJ/MN | tst | XS | SC-6 | GAP-017 | deleting tsconfig/bun-smoke silently disables gate legs |
| ISSUE-090 | MJ | rec | XS | SC-9 | GAP-018 | task 11.5's recorded revertAssertion is mutation-equivalent — does not reproduce |
| ISSUE-091 | MJ | tst | S | SC-1 | GAP-003 | the whole e2e passes with a gate that denies EVERYTHING; no ALLOW asserted anywhere |
| ISSUE-092 | MJ | tst | XS | SC-6 | GAP-017 | M5 cannot match multi-line empty catch; PASSes over nonexistent files |
| ISSUE-093 | MD | tst | S | SC-10 | GAP-033 | acceptance live-artifact rows accept any fenced file; fabricated SMOKE.md flips row 6 |
| ISSUE-094 | MD | tst | XS | SC-6 | GAP-019 | acceptance row 10 derives expected values from the subject it checks |
| ISSUE-095 | MD | tst | XS | SC-6 | GAP-019 | detector F accepts a prose mention as a real stamp |
| ISSUE-096 | MD | tst | XS | SC-6 | GAP-019 | purity guard checks the import, not the exec — shell-string exec() passes |
| ISSUE-097 | MD | tst | XS | SC-6 | GAP-017 | acceptance row 3 vacuous: ctest exits 0 on zero tests |
| ISSUE-098 | MN | tst | XS | SC-6 | GAP-017 | bun leg has no test-count floor |
| ISSUE-099 | MN | tst | XS | SC-6 | GAP-019 | detector C's header loop ends in `\|\| true` — result discarded |
| ISSUE-100 | MN-MJ | tools | S | SC-8 | GAP-028 | crash-window class at 7 sites; prevention at 2; reconciler excludes 4 origins |
| ISSUE-101 | MD | tools | S | SC-8 | GAP-024 | torn questions.jsonl kills conductor_status and the stop-report writer |
| ISSUE-102 | MN | tools | XS | — | fix | three knobs still un-floored (fractional k → transport-shaped error) |
| ISSUE-103 | MD-MJ | scr | XS | SC-6 | GAP-019 | POC noise-honesty sentence invertible to a lie with every test green |
| ISSUE-104 | MD-H | scr | S | SC-10 | GAP-033/-029 | "review findings upheld" bench metric reads a file nothing writes — structurally 0 |
| ISSUE-105 | H | scr | XS | — | fix | Ctrl-C at the session prompt kills the 20+GB model while the shell survives |
| ISSUE-106 | H | scr | S | — | fix(tests) | serve.main router launch leg executed by no test; two survived mutations |
| ISSUE-107 | H | scr | XS | SC-10 | GAP-032 | hermetic cell env omits PATH: every live 14.2 cell spawn-fails |
| ISSUE-108 | MD | scr | S | — | fix(tests) | serve.wait_until_ready reached by no test (C-090 class recurring) |
| ISSUE-109 | MD | scr | M | — | fix(tests) | fetch_models download/validate half + benchmark.py have zero coverage |
| ISSUE-110 | L-MD | scr | DEC | — | §9 | README documents an eviction workflow whose download half does not exist |
| ISSUE-111 | L-MD | scr | XS | — | fix | mid-file unittest.main(): direct invocation runs 35 of 47 tests, prints OK |
| ISSUE-112 | MD | scr | XS | SC-7 | GAP-016 | bench cell config restates fan-out/workflow defaults; wrong values stay green |
| ISSUE-113 | MD | scr | S | SC-7 | GAP-016 | python STOP_KINDS hand-copied; a new TS stop kind crashes the 14.2 campaign |
| ISSUE-114 | MJ | inj | XS | SC-7 | GAP-016 | a ROLE_PACKS pack absent from REQUIRED_PACKS is silently never delivered |
| ISSUE-115 | MD | core | XS | SC-7 | GAP-016 | §2.3 terminality has three hand copies; the "ONLY definition" is not |
| ISSUE-116 | MD | fan | XS | SC-7 | GAP-016 | FanoutJob.priority written everywhere, read nowhere, contradicts the wire |
| ISSUE-117 | MD | rtr | S | SC-7 | GAP-016 | affinity/schema header names: config on one side, constants on the other |
| ISSUE-118 | MD | scr | XS | SC-7 | GAP-016 | python→TS env-var contract hand-spelled both sides; drift absorbed silently |
| ISSUE-119 | MD | tst | S | SC-7 | GAP-016 | M5/planning placeholder patterns: confessed one-rule-in-two-places, already drifted |
| ISSUE-120 | L | core | XS | SC-7 | GAP-016 | one-directional compile guards mistaken for two-directional (3 vocabularies) |
| ISSUE-121 | L | inj | XS | SC-7 | GAP-016 | the seven-role vocabulary has no owner; typo-absorbing fallbacks |
| ISSUE-122 | L | core | XS | SC-7 | GAP-016 | gate subsets stringly-typed; typo'd case arms silently unreachable |
| ISSUE-123 | L | core | XS | SC-7 | GAP-016 | nothing binds gates-phase's 18 tool literals to the 22-name inventory |
| ISSUE-124 | L | tools | DEC | SC-7 | §9 | closed journal vocabulary not enforced in production (NODE_ENV-gated) |
| ISSUE-125 | L | core | XS | SC-7 | GAP-016 | "legal red" rule spelled three times |
| ISSUE-126 | L | scr | XS | SC-7 | GAP-016 | serve.py restates the router-config filename conductor_wiring owns |
| ISSUE-127 | L | scr | XS | SC-7 | fix | ledgerPath machine-clobbered while comments call it hand-editable |
| ISSUE-128 | MD | tools | XS | SC-4 | GAP-019 | both questions.ts validators decorative — deletable, full gate green |
| ISSUE-129 | MD-L | tools | XS | — | fix | removeWorktree silently no-ops on a locked worktree |
| ISSUE-130 | L-MD | tools | XS | SC-4 | GAP-019 | createWorktree foreign-branch refusal decorative |
| ISSUE-131 | L-MD | tools | S | SC-7 | GAP-034 | replay restates nine journal literals; drift renders silently-lying timelines |
| ISSUE-132 | MN/MJ | tst | S | SC-9 | GAP-030 | 13.1: 20 of 42 rows untraceable by id; 4 properties e2e-invisible |
| ISSUE-133 | MN | tst | S | SC-9 | GAP-030 | coverage-ledger linkage unreliable; one claim false; orphan ids |
| ISSUE-134 | MJ | tst | M | SC-11 | GAP-035 | full parallel gate nondeterministically red on unmutated HEAD (P14); taints all verdicts |
| ISSUE-135 | MN | tst | XS | SC-12 | GAP-019 | doctrine anchors pin keywords; a pack asserting the OPPOSITE stays green |
| ISSUE-136 | MN | plug | XS | — | fix(test) | chat.message part-type filter unpinned |
| ISSUE-137 | MN | plug | XS | — | fix(test) | nothing pins tool.execute.before firing for plugin-registered tools |
| ISSUE-138 | MN | doc | XS | SC-1 | GAP-001 | the §3.8 banner exists only in OPERATIONS.md; nothing emits it |
| ISSUE-139 | MN→MJ | fan | XS | SC-1 | GAP-029 | (minted; ex FANOUT-004) fetchMetricsSummary returns an unvalidated cast — load-bearing once ISSUE-038 is fixed |
| ISSUE-140 | MN | tst | XS | SC-6 | GAP-017 | (minted; ex SWEEP-CORR-009) verify-acceptance still uses fixed /tmp scratch — C-078 class recurrence |
| ISSUE-141 | L | tst | XS | SC-6 | GAP-019 | (minted; ex SCRIPTS-014) row-2 skip fallback matches any task; row-5 substring scenario check |
| ISSUE-142 | MN | plug | XS | SC-1 | GAP-002 | (minted; ex macro pointer) sameTree restates gates-edit's comparison, coupled by comment only |

### 5.2 MACROs (step 3)

| Id | Sev | Subsys | Eff | Cl | Closed by | One-line |
|---|---|---|---|---|---|---|
| MACRO-001 | MJ | arch | S | SC-1 | ≡GAP-002 | the composition seam has no contract (~22-instance family incl. both CRITICALs) |
| MACRO-002 | MJ/BL | proc | M | SC-1 | ≡GAP-003 | integration and live truth deferred to the end; every wiring death ships as a surprise |
| MACRO-003 | MJ | arch | S | SC-1 | ≡GAP-004 | "tree" is one string carrying two meanings; struck 4× after being named |
| MACRO-004 | MJ | arch | S | SC-2 | ≡GAP-006 | tool legality has three mechanisms and no owner; the FSM API trusts callers |
| MACRO-005 | MJ | arch | M | SC-5 | ≡GAP-022 | disposition under-modeled: every recorded wedge is a predicate disagreement |
| MACRO-006 | BL | arch | S | SC-5 | ≡GAP-021 | stop-kind authorship has no owner; prerequisite of 13.2/14.2/17.4 |
| MACRO-007 | MJ | design | M+DEC | SC-5 | ≡GAP-014 | three escape hatches, three price tags; cheapest = weakest audit trail |
| MACRO-008 | MJ | inj | S | SC-12 | ≡GAP-005 | doctrine exists twice: a dead channel and live paraphrases |
| MACRO-009 | MJ | gate | M | SC-6 | ≡GAP-025 | two security postures; every reproduced bypass on the enumeration side |
| MACRO-010 | MJ | nav | L+DEC | — | §9 (split) | tools.ts ~93k tokens: above every reader's budget including the build's own machinery |
| MACRO-011 | MD | doc | XS | — | rule+GAPs | extending.md's trap paragraphs are step-2 defects restated as advice |
| MACRO-012 | MJ | nav | M | SC-7 | ≡GAP-016 | cross-language vocabulary changes are grep-complete or silently wrong |
| MACRO-013 | MJ | rec | S | SC-9 | ≡GAP-031 | the build record is structurally unreadable at 32k; index fields dead |
| MACRO-014 | MD | nav | S | — | IDEA-NAV | test files named by construction order; the suite's map is a build memory |
| MACRO-015 | MJ | proc | S | SC-4 | ≡GAP-036 | skeptic ladder evidence-asymmetric; default biases toward killing findings |
| MACRO-016 | MJ | tst | M | SC-6 | ≡GAP-017 | every scanner selects its subject by open-ended enumeration |
| MACRO-017 | MJ | proc | S | SC-9 | ≡GAP-031(c) | obligations recorded in prose measurably fail to land (2 lost : 1 landed) |
| MACRO-018 | MJ | tst | M | SC-11 | ≡GAP-035/-031 | gate records unschema'd and truncated; the gate binary is a noisy sensor |
| MACRO-019 | MJ | proc | M | SC-6 | ≡GAP-018 | mutation testing never institutionalized where the decorative checks concentrate |
| MACRO-020 | MD | proc | S | SC-9 | ≡GAP-030 | assertion rows shipped without lifecycle (binding, disposition, satisfiability) |
| MACRO-021 | MJ | doc | S | SC-9 | fix+IDEA-PD-3/4 | operator docs' behavioral layer false in ten verified places under a green guard |
| MACRO-022 | MJ | ops | S | SC-11 | ≡GAP-023 | failure visibility is one unread journal line; no operator artifact |
| MACRO-023 | MD | arch | S | SC-8 | ≡GAP-024 | five append-only ledgers, five implementations, ≥3 crash postures |
| MACRO-024 | MD | arch | S | SC-4 | ≡GAP-010 | policy pools in the adapter; no core-promotion criterion (routeOf defective) |
| MACRO-025 | BL | proc | XS+DEC | SC-2 | ≡GAP-006 + IDEA-CAP-4 | adding a tool touches 5 files/2 silent seams; the addendum omits 2 of 5 |
| MACRO-026 | MJ | tst | XS | SC-6 | ≡GAP-017 | growth lands by construction in the audits' blind span |
| MACRO-027 | MJ | state | S+DEC | SC-8 | ≡GAP-027 | multi-writer story ~17% implemented; composes into record corruption |
| MACRO-028 | BL | plan | S | SC-10 | ≡GAP-032 | both live-task specs stale in load-bearing ways; 14.2's arms inverted at HEAD |
| MACRO-029 | BL | plan | S | SC-10 | ≡GAP-032/-033 | 14.2 fails on launch mechanics and acceptance even if flawless |
| MACRO-030 | MJ | rec | M | SC-9 | ≡GAP-031 | the record/process regime stopped scaling at ~task 40; the addendum adds ~12 tasks |
| MACRO-031 | MD | rtr | S | — | fixes (042/043/117) | a second backend/model is a guarded-by-nothing change |
| MACRO-032 | OP | inj | LIVE | — | GAP-046 | role/pack decomposition unmeasurable until doctrine delivers; typed ROLES regardless |
| MACRO-033 | OP | design | DEC | SC-5 | GAP-021+§9 | keep the six-kind stop vocabulary; the failure is writer-side |
| MACRO-034 | OP | nav | XS | — | doc para | scripts/ interleaves two products; boundary written nowhere a model looks |

### 5.3 GAPs (this review — full records in §2)

| Id | Tier | Eff | Cl | Depends on | Blocks | One-line |
|---|---|---|---|---|---|---|
| GAP-001 | DETECTED | S–M | SC-1 | ISSUE-001 wiring; GAP-003(L1) | 14.2 arms; GAP-046 | doctrine delivery witness (wire capture + runtime receipt + beacon stamp) |
| GAP-002 | DETECTED | S | SC-1 | — (substrate w/ GAP-016) | addendum tasks | wiring manifest + completeness test (+ deriveGateFacts, CMake schema export) |
| GAP-003 | DETECTED | M | SC-1 | — | GAP-001(L1) | live-ish gate leg: real opencode + stub provider |
| GAP-004 | STRUCT | S | SC-1 | — | 13.2 | two tree types; ISSUE-002 fix is the first commit |
| GAP-005 | STRUCT | S–M | SC-12 | ISSUE-001 wiring | doctrine GAPs 037-044 | dispatch prompts compose from the pack map; generated MECHANICS sections |
| GAP-006 | STRUCT | S–M | SC-2 | — | conductor_clarify (17.3) | one legality choke point + caller identity + advanceRun(run,…) |
| GAP-007 | STRUCT | S | SC-3 | — | — | vetted-test identity: testScope subtraction + content hash |
| GAP-008 | STRUCT | XS | SC-3 | — | — | green-admission symmetry (refuse zero-test/fallback greens) |
| GAP-009 | STRUCT | S | SC-3 | — | — | scope-size (expand globs, count files) + wildcard-head rejection |
| GAP-010 | STRUCT | S | SC-3/4 | — | — | scope disjointness at validateQueue; routeOf promoted to core |
| GAP-011 | STRUCT | M | SC-4 | — | — | reviewer diligence witness (nonce + citedRanges) |
| GAP-012 | DETECT-refusal | S | SC-4 | shares ISSUE-054 fix | — | fixer receipt must intersect the finding |
| GAP-013 | STRUCT | M | SC-5 | GAP-026; DEC §2.11 | — | human-provenance answer channel via the state area |
| GAP-014 | STRUCT | M | SC-5 | DEC (plan deviation) | — | one price schema for override/inline-claim/defer |
| GAP-015 | STRUCT | XS | SC-3 | — | — | degenerate-config refusal at setup |
| GAP-016 | STRUCT | M | SC-7 | — (substrate w/ GAP-002) | Phase 17 vocabularies | vocabulary registry, two-way parity, cross-language derivation |
| GAP-017 | STRUCT | M | SC-6 | canary pre-addendum | addendum handlers | inverted subject selection for every scanner/leg |
| GAP-018 | DETECT-standing | M | SC-6 | seed corpus exists | — | standing mutation suite over the audit layer |
| GAP-019 | DETECTED | S each | SC-6 | GAP-018 enforces | — | refusal tests + literal restatement for every checker |
| GAP-020 | DETECT-standing | S | SC-1 | — | — | unreachable-exports audit |
| GAP-021 | STRUCT | S–M | SC-5 | GAP-022 (enum); DEC ISSUE-053 | 13.2; 17.4 | total stop-kind closer + resume-after-stop |
| GAP-022 | STRUCT | M | SC-5 | — | GAP-021 | one dispositionOf() for scheduler/continuation/report |
| GAP-023 | DETECTED | S–M | SC-11 | — | — | operator health surface (beacon + floors + deny-level) |
| GAP-024 | STRUCT | S | SC-8 | — | — | tolerant ledgers; guaranteed terminal report |
| GAP-025 | STRUCT | M+DEC | SC-6 | small closures now; flip after deny-rate (LIVE) | — | git/write gate attribution posture |
| GAP-026 | STRUCT | XS | SC-6 | — | GAP-013 | case-fold .conductor deny restore |
| GAP-027 | STRUCT | S | SC-8 | DEC single-operator? | 13.2 SG-K | OS single-writer lock; evidence attribution now |
| GAP-028 | STRUCT | S | SC-8 | — | — | transactional blockItemWithQuestion at all 7 sites |
| GAP-029 | DETECTED | S | SC-1 | rides ISSUE-038 fix | — | router-contact witness (request delta + partial flag + validated cast) |
| GAP-030 | DETECTED | S | SC-9 | — | — | row-id↔test-title bijection + disposition field |
| GAP-031 | DETECTED | S–M | SC-9 | — | Phase 16 charter | gate-record completeness + currency stamp + obligations index |
| GAP-032 | DETECTED | S–M | SC-10 | — | **13.2, 14.2** | spec-currency check + pre-live preflight |
| GAP-033 | DETECT→struct | M | SC-10 | — | **13.2, 14.2** | checkers before artifacts, bound to runId+seq |
| GAP-034 | STRUCT | S | SC-7 | GAP-016 covers keys | — | replay imports its vocabulary; fixtures from the real producer |
| GAP-035 | DETECT/struct | S–M | SC-11 | — | **every later verdict** | gate timeout + durable scratch + monotonic clock |
| GAP-036 | DETECT+doctrine | S | SC-4 | — | — | symmetric refutation evidence; abstention upholds; P10 rule in pack |
| GAP-037 | ADVISORY | XS | SC-2 | GAP-006 (generated from its table) | — | generated "run shape" section in core.md |
| GAP-038 | mixed | S | SC-2/6 | GAP-001 (IDEA-DE-4 vehicle) | — | deny-recovery doctrine + closed OVERRIDE_GATES + deny-loop floor |
| GAP-039 | ADVISORY | XS | SC-12 | — | — | tdd.md cycle ends in hand-back, not a denied commit |
| GAP-040 | mixed | S | SC-4/12 | GAP-005 | — | reply protocols named in doctrine; exact-token pushback matching |
| GAP-041 | mixed | S | SC-4 | — | — | test-vet.md ≡ §2.10 criteria, single-sourced; criteria bite |
| GAP-042 | ADVISORY | XS | SC-3 | GAP-009/-010/-015 first | — | decompose.md teaches the units the gates measure |
| GAP-043 | mixed | S | SC-5/12 | GAP-014/-021 for pricing | — | uniform stuck-state protocol, priced |
| GAP-044 | ADVISORY | XS | SC-12 | — | — | ask-policy sentence fixed; surface-on-block explicit |
| GAP-045 | SP | M | — | — | — | SPECULATIVE: partial-context work (payload token bound + partiality receipt) |
| GAP-046 | SP | LIVE | — | GAP-001 | — | SPECULATIVE: per-role doctrine-efficacy probe at 13.2/14.2 |
| GAP-047 | SP | S | — | — | — | SPECULATIVE: blocked/waiting-human pack (structural fixes preferred) |
| GAP-048 | SP | S | — | — | — | SPECULATIVE: dashboard/ coverage pass (1,077 unreviewed lines) |

---

## 6. Systemic clusters — one root cause, one structural change, several findings closed

The highest-value section of this document. Each cluster names its root cause (from step 2's
"why nothing caught it" fields and step 3's correction clustering), its members across all three
registers, and the single structural change that closes it. The cluster ids are the ones used in
the unified table's `Cl` column.

**SC-1 — The unwitnessed composition seam.** *Root cause:* building and wiring are separate
obligations and only building was ever scheduled; a literal type-checks identically to a
derivation; nothing asserts hook completeness, module reachability, or delivery. *Members:*
ISSUE-001, -002, -004, -022, -038, -039, -040, -041, -043, -086, -091, -138, -139, -142;
MACRO-001, -002, -003; correction cluster C (~9, highest severity-per-entry). *Structural
change:* **GAP-002 (wiring manifest, one substrate with GAP-016) + GAP-003 (live-ish gate leg)
+ GAP-020 (unreachable-exports audit) + GAP-004 (tree types) + GAP-001 (delivery witness).**
Closes the family that produced BOTH CRITICALs; ~5–7 days total.

**SC-2 — Legality has no owner.** *Root cause:* per-handler discipline applied 6/18 times, the
designed compensating layer (the state block) never delivered, the FSM API trusts callers.
*Members:* ISSUE-005, -006, -007, -030; MACRO-004, -025. *Structural change:* **GAP-006** (one
choke point + identity + `advanceRun`), with GAP-037/-038 as the advisory face. ~1–2 days;
also the growth mechanism for every addendum tool.

**SC-3 — Scope declaration is unbounded (the TDD floor).** *Root cause:* the one point where
model judgment enters the pipeline unchecked; every downstream gate (size budget, legal-red,
edit scope, behavioral skip) is parameterized by scopes nothing validates. *Members:*
ISSUE-008, -009, -010, -011, -012, -046, -048. *Structural change:* **one scope pass at the
`validateQueue`/`decideEdit` seam — GAP-007 + GAP-008 + GAP-009 + GAP-010 + GAP-015** (+ the
ISSUE-009/-046 one-line fixes). ~2–3 days; closes the entire adversary-log family (a)/(e).

**SC-4 — The review layer is accept-on-trust and its machinery kills findings.** *Root cause:*
no diligence evidence exists at any layer; refutation is free while uphold costs a fix round;
adjudication trusts model-authored ids and self-declared lenses. *Members:* ISSUE-013, -049,
-054, -064, -072, -079, -128, -130; MACRO-015, -024. *Structural change:* **GAP-011 + GAP-012
(contact witnesses) + GAP-036 (symmetric refutation, abstention upholds) + GAP-041 + GAP-040
(exact-token adjudication)**. ~3–4 days. The honest boundary is kept: judgment stays trusted,
contact and adjudication become mechanical.

**SC-5 — Disposition and incentive are under-modeled.** *Root cause:* "is this item finished /
waiting / hopeless?" is recomputed by ≥4 predicates with different closures; two stop kinds
have no writer; the three escape hatches were priced in three plan sections with no shared cost
model. *Members:* ISSUE-050, -051, -052, -053, -055, -057, -065, -066, -067, -068; MACRO-005,
-006, -007, -033. *Structural change:* **GAP-022 (dispositionOf) + GAP-021 (stopKindOf +
resume) + GAP-014 (price schema) + GAP-013 (human channel)**. ~5–6 days + two owner decisions
(§9). Closes every recorded wedge shape and inverts the incentive gradient right-side-up.

**SC-6 — Enumeration-as-detection.** *Root cause:* checks select their subject (commands,
prefixes, files, tokens) by open-ended enumeration and pass over whatever they happened to
match; measured 0 bypasses on deny-by-default surfaces vs 6+ on enumeration surfaces; 23% of
all corrections. *Members:* ISSUE-014…-021, -037, -088, -089, -092, -094…-099, -103, -140,
-141; MACRO-009, -016, -026. *Structural change:* **GAP-025 (gate attribution posture) +
GAP-017 (inverted scanner selection) + GAP-019 (refusal-test discipline) + GAP-018 (its
enforcer)**. The gate half carries a false-positive risk priced by IDEA-LC-9 (measure the
benign-deny rate at first live contact).

**SC-7 — Vocabulary without owners (two spellings).** *Root cause:* ~26 closed vocabularies,
the safe pattern exists but each new vocabulary must remember to apply it; compile guards catch
extras, never omissions. *Members:* ISSUE-003, -059, -112…-127, -131; MACRO-012. *Structural
change:* **GAP-016 (registry + two-way parity + cross-language derivation) + GAP-034 + GAP-005**.
Incremental; Phase 17's three new vocabularies land as natives.

**SC-8 — Concurrency and crash-safety by convention.** *Root cause:* single-writer is a
pid-file protocol with a race at every edge; the crash-ordering rule is applied per-site by
hand; five ledgers own five crash postures. *Members:* ISSUE-023…-029, -061, -062, -100, -101;
MACRO-023, -027. *Structural change:* **GAP-027 (flock + evidence attribution) + GAP-028
(block-and-ask primitive) + GAP-024 (one tolerant JSONL substrate)**. ~3 days; makes three
whole classes unrepresentable.

**SC-9 — The record layer is exempt from the system's own thesis.** *Root cause:* the code
cannot advance without gates; the record can rot without failing anything. *Members:*
ISSUE-073…-085, -090, -132, -133; MACRO-013, -017, -018 (record half), -020, -030. *Structural
change:* **GAP-030 (row bijection + lifecycle) + GAP-031 (completeness + currency + obligations
index) + GAP-018 (revert-probe durability)**. ~3 days + one-time backfill; Phase 16 is the home.

**SC-10 — Live-task rot and undefended artifacts.** *Root cause:* spec verification is a
one-shot claim that silently expires; the checker-before-artifact principle was learned (G5)
and never made a rule; the two remaining artifacts are the two the meters cannot defend.
*Members:* ISSUE-074, -078, -093, -104, -107, (-112); MACRO-028, -029. *Structural change:*
**GAP-032 (currency + preflight) + GAP-033 (checkers bound to runId+seq)**. ~3 days; must land
before any 13.2/14.2 compute is spent.

**SC-11 — Silent failure: no operator artifact.** *Root cause:* every artifact is written at a
*recorded* stop, so every detector-miss produces nothing by construction; the gate itself can
hang or flake and leaves no evidence. *Members:* ISSUE-031…-036, -061, -062, -134; MACRO-018
(sensor half), -022. *Structural change:* **GAP-023 (health surface + floors) + GAP-035 (gate
determinism + durable scratch) + GAP-024**. ~3 days.

**SC-12 — Doctrine content misaligned with the machine.** *Root cause:* packs were written to a
design (state block, publish flow, criteria) whose delivered reality differs; no anchor pins
polarity; no pack names a mechanism. *Members:* ISSUE-003, -135, -138; MACRO-008; the DE
per-pack findings. *Structural change:* **GAP-005 (single-source composition + generated
MECHANICS) + the content pass GAP-037…-044** (~2 days once the structural floors exist).

---

## 7. The dependency graph

**Serial chains (order is load-bearing):**
1. **GAP-035 → everything.** Until the gate is deterministic and hang-proof, every later
   verdict (including each fix's own regression run) is a distribution sample. Cheapest first
   move in the whole plan.
2. **MACRO-010 split decision → ISSUE-001 wiring → GAP-001/GAP-003 witnesses → 13.2.**
   Step 3's sequencing note: split tools.ts BEFORE wiring so the fix lands in a readable,
   audit-visible file (the wiring's new handler code otherwise lands in ISSUE-088's blanked
   span). If the owner declines the split, GAP-017's stripComments canary becomes mandatory
   before the wiring instead. **ISSUE-002's fix is exempt from this chain:** its edit sits
   around tools.ts:2362, outside the audit-blind spans (8405–8488, 9104–EOF) that motivate
   split-before-wiring — which is why the §8 plan lands it at position 2, before the
   position-3 split decision. That ordering is deliberate, not a contradiction.
3. **GAP-022 → GAP-021** (shared disposition enum; land as one change) **→ 13.2's `13.2-report`
   row and Phase 17.4's acceptance.**
4. **GAP-026 → GAP-013** (the human channel's provenance guarantee needs the case-fold deny
   airtight).
5. **ISSUE-038 fix → ISSUE-139 validation → GAP-029** (the metrics seam becomes load-bearing
   the moment it is wired).
6. **GAP-002 + GAP-016 are ONE substrate** (both declare "what must exist"); design once,
   populate incrementally.
7. **GAP-017's stripComments canary + GAP-006's legality table → before the addendum's first
   appended handler (Task 17.3).**
8. **GAP-032 + GAP-033 → before any 13.2/14.2 compute.**
9. **GAP-005 → the doctrine content pass (GAP-037…-044)** — align content only once there is a
   single channel to align.

**Independent parallel groups (no shared state, schedulable concurrently):**
- The scope pass (GAP-007/-008/-009/-010/-015 + ISSUE-009/-046) — core/planning + tools seam.
- The review-layer pass (GAP-011/-012/-036/-040/-041) — schemas + prompts + verdict.ts.
- The concurrency pass (GAP-027/-028/-024) — state.ts + questions.ts + ledgers.
- The record pass (GAP-030/-031) — scripts + docs/build.
- The scanner pass (GAP-017/-019 + GAP-018) — scripts + audits.
- The small-fix basket (ISSUE-009, -015, -016, -021, -029, -031, -036, -037, -044…-047, -056,
  -058, -059, -063, -069, -070, -071, -080, -084, -085, -087, -102, -105, -111, -127, -129,
  -136, -137 and peers marked `fix`) — each XS/S, no interdependencies, ideal filler work.

**REQUIRES-A-LIVE-MODEL (cannot be scheduled freely):** 13.2 (SMOKE.md), 14.2 (the 90-cell
campaign), IDEA-LC-9 (benign-deny rate before the GAP-025 posture flip), GAP-046 (doctrine
efficacy measurement), ISSUE-076/-077's two live probes (streaming + fail-soft equivalence),
the G5 leg-B/leg-C rows (ISSUE-075). Everything else in this register is schedulable now.

**BLOCKED-ON-A-DECISION (owner's calls, not work items):** enumerated in §9 — chiefly the
defer-pricing plan deviation (GAP-014), the §2.11 answeredVia field (GAP-013), the ISSUE-053
§3.2/§3.3 reconciliation (forced by GAP-021), the §2.5 stateAtClaim widening (ISSUE-057), the
§3.5 registered-session row (ISSUE-006), single-operator-vs-flock (GAP-027), the tools.ts
split (MACRO-010), the gate posture flip timing (GAP-025), the addendum amendment
(IDEA-CAP-4), and the ISSUE-040/-041 failover deviations.

---

## 8. The PROVISIONAL ordered plan

**PROVISIONAL — a draft to be argued with in step 5, which will re-order it after the §9
decisions are made.** Ordered by the one objective criterion — *what would a lazy model exploit
first* — then by dependency, then by cost. A wrinkle the criterion forces into the open: a lazy
model exploits nothing until the system can run and the verdicts about it can be trusted, so
positions 1–3 are the preconditions the exploit-ordering itself depends on.

| # | Work | Why this position |
|---|---|---|
| 1 | **GAP-035** — gate timeout + durable scratch + monotonic clock | Cheapest item that de-noises every later verdict (ISSUE-134 taints all regression evidence, including for the fixes below). Hours to a day. |
| 2 | **ISSUE-002 fix + GAP-004** (tree types + the missing no-worktree composition test) | The system cannot do any work in its shipped default; nothing downstream is testable against reality until this lands. S. |
| 3 | **ISSUE-001 wiring + GAP-001 + GAP-003** (hooks registered; delivery witnessed at wire, runtime, and beacon; the live-ish leg standing) — with the **MACRO-010 split decision taken first** (§9; if declined, GAP-017's stripComments canary becomes a hard prerequisite) | The thesis channel. Every advisory defense, the state block's runtime navigation, per-role sampling, and the router dataset all hang off it — and the witness is what makes its next death loud. M. |
| 4 | **GAP-006** — legality choke point + caller identity + advanceRun | The cheapest reproduced full-run escapes (defer-all→done from DECOMPOSED, classify-shopping, terminal-run mutation, self-answer routing) all close at one seam; also the growth mechanism the addendum needs before 17.3. S–M. |
| 5 | **GAP-022 + GAP-021** — disposition function + total stop closer + resume | The lazy exit stops paying (a defer-dominated or all-blocked run can no longer stamp `done`), honest waiting stops losing work, and 13.2/17.4 are unsatisfiable without it. Forces the ISSUE-053 decision. M. |
| 6 | **The scope/TDD pass** — GAP-015, ISSUE-009 (one line), GAP-007, GAP-008, GAP-009, GAP-010 (+ ISSUE-046) | Closes every reproduced way to earn a green without the work: the one-call TDD kill switch, root-file skip, vetted-test rewrite, fallback green, wildcard scope, colocated test scope. One seam, ~2–3 days. |
| 7 | **The review-layer pass** — GAP-011, GAP-012, GAP-036, GAP-040, GAP-041 | With TDD closed, the lazy model's remaining move is making findings disappear; contact witnesses + symmetric refutation + exact-token adjudication close it while keeping judgment trusted. ~3–4 days. |
| 8 | **GAP-026 (hours), then GAP-013; GAP-014 once its deviation is granted** | The human-simulation loop and the free defer are the last reproduced escapes; both need owner decisions first (§9), so they slot here rather than earlier. M. |
| 9 | **Security small closures** — ISSUE-015 (-c exec keys), ISSUE-016 (=GAP-026), -019, -020, -021, -037 + the ISSUE-017 decision | Real arbitrary-execution routes with XS fixes; the full GAP-025 posture flip waits for live deny-rate data (position 15). ~1 day total. |
| 10 | **The concurrency/crash pass** — GAP-027 (evidence attribution now, flock after the §9 call), GAP-028, GAP-024 | Not model-exploitable but corrupts the record that everything above trusts; 13.2's SG-K names accidental second sessions. ~3 days. |
| 11 | **The build-floor pass** — GAP-002+GAP-016 (one substrate), GAP-020, GAP-017 (full inversion), GAP-019, GAP-018, GAP-029, GAP-034 | Prevents the next generation of every closed class from re-entering with the addendum's ~12 tasks; the mutation-suite seed corpus already exists. ~1–2 weeks, parallelizable. |
| 12 | **The record pass** — GAP-030, GAP-031 (+ the honesty one-offs: ISSUE-073, -080, -084, -085; MACRO-021's doc fixes with IDEA-PD-4 markers) | Makes the record trustworthy before Phase 16–19 lands on it; low urgency for a lazy model, high for the cold-boot reader. ~3 days. |
| 13 | **The doctrine content pass** — GAP-005, then GAP-037…-044 (+ IDEA-DE-1/-3/-5) | Content alignment only pays once delivery (3) and the structural floors (4–8) exist; before that it is advisory ink. ~2 days. |
| 14 | **Pre-live readiness** — GAP-032 (currency + preflight), GAP-033 (both checkers), ISSUE-107, ISSUE-078, ISSUE-112, ISSUE-104 re-point, ISSUE-105/-106/-108 | The complete named blocker set for 13.2/14.2; all sub-day; the preflight is the ~2-minute go/no-go. |
| 15 | **13.2 live smoke** (LIVE) — from a re-verified spec, with GAP-046's probes and IDEA-LC-9's deny-rate recording riding along | First live contact, now spent on discovery instead of rediscovering the register. |
| 16 | **GAP-025 posture flip (informed by 15), then 14.2** (LIVE) | The campaign runs with valid arms (post-3), honest stop kinds (post-5), a defended report (post-14), and a measured gate posture. |

**Deliberately low:** the small-fix basket (§7) fills slack anywhere from position 6 onward;
GAP-045/-047/-048 (SPECULATIVE) are unscheduled pending step-5 interest; MACRO-014/MACRO-034
and the IDEA-NAV items ride Phase 16.

---

## 9. The open decisions — deliberately NOT made (step 5 works these with the owner)

**D1 — How much of this to do at all.** Three coherent postures: (a) *minimum-to-live* —
positions 1–3 + 14 only (~1.5–2 weeks) and accept every open exploit as a known limit for an
attended smoke; (b) *close-the-lazy-floor* — positions 1–8 (~4–5 weeks) before any unattended
run; (c) *full structural* — everything through 13. Evidence bearing: the adversary log shows
(a) leaves six reproduced escapes open; MACRO-030 shows deferring 11 (build floor) means the
addendum's ~12 tasks land on the old regime. **Not answered.**

**D2 — The tools.ts split (MACRO-010): before the wiring, after it, or not at all.** For:
step 3's measured case (93k tokens; the audits' blind span is the growth edge; the wiring's new
code otherwise lands unauditable; 26 importing files are mechanical to repoint). Against: it
delays the two CRITICAL fixes and churns 45 import statements before 13.2. Middle option:
GAP-017's canary first, split in Phase 16. **Not answered — but position 3 is gated on
answering it.**

**D3 — Defer pricing is a plan deviation (GAP-014 / MACRO-007).** §3.6 budgets override only;
pricing defer/inline-claim changes model-visible economics and needs a recorded deviation or
revision. Alternative framing: keep defer free but make it loud (report-visible, derived
provenance only — the ISSUE-052 fix alone). Evidence: the reproduced defer-all escape; the
punished honest override (ISSUE-007). **Not answered.**

**D4 — The §2.11 `answeredVia` field and the answer-file protocol (GAP-013).** Additive schema
change + an operator-facing workflow (dropping a file vs typing in chat). Cost of not doing it:
E14 stays fully simulatable and limit 3's disclosure must be widened instead. **Not answered.**

**D5 — ISSUE-053: what does a RED closing verify mean?** §2.9's `done` row vs §3.2's
verification-before-completion disagree; GAP-021's closer forces the choice: red verify ⇒
`blocked`/`env`, or an explicit recorded deviation that `done` tolerates a red close. **Not
answered; GAP-021 cannot land total without it.**

**D6 — Single-operator declaration vs the flock (GAP-027 / MACRO-027).** Either conductor
supports a second session (land the flock + demotion check) or it is declared
single-operator-single-session and task-4.1's "read-only conductor" claim is withdrawn as a
documentation-honesty fix. The evidence (this review suite's own concurrent agents; 13.2 SG-K)
leans toward supporting it, but it is a scope call. **Not answered.**

**D7 — The GAP-025 posture flip timing.** Flip now (closes ISSUE-014/-015/-017 classes
immediately, risks benign-deny friction with zero live data) vs measure first (IDEA-LC-9 at
13.2, flip at 14.2 — leaves real arbitrary-execution routes open meanwhile; the XS closures in
position 9 land either way). A genuine security-vs-operability tradeoff with no data yet.
**Not answered.**

**D8 — ISSUE-017 (apply_patch): parse patch bodies, or remove it from WRITE_TOOLS and pin the
wire contract?** Latent today (not in the offered set at 1.18.15); one config flip from
reachable. **Not answered.**

**D9 — ISSUE-040/-041: implement the failover/backoff halves or record the deviations?** The
plan's §4.4 promises mid-run failover and 503-aware backoff nobody built; implementing is real
work with a live-model test burden; recording the deviation is honest and cheap but shrinks the
router's value story. Related: ISSUE-042's three sizing options; MACRO-031's second-backend
question ("single upstream, single model" disclosure vs the guard work). **Not answered.**

**D10 — Green-path zero-test policy (GAP-008): refuse, or journal+taint?** Refusal is symmetric
with red and strict; journal+taint tolerates flaky targeted runs at the cost of admitting the
vacuous green with a scar. **Not answered (mechanism identical either way; one flag).**

**D11 — Skeptic default semantics (GAP-036): abstention-upholds (as specced here) vs
IDEA-STRUCT-4's blanket "uncertain ⇒ uphold".** Abstention preserves a real refutation channel
with evidence; the blanket flip is simpler but converts every lazy skeptic into an uphold,
inflating fix rounds. Both beat the status quo; pick one. **Not answered.**

**D12 — ISSUE-124: should production enforce the journal vocabulary (throw) or is the static
audit the authority?** Enforcement-in-prod risks a crash on a novel event mid-run; audit-only
depends on GAP-017 fixing ISSUE-088 first. **Not answered.**

**D13 — Which findings are acceptable to leave unfixed, and at what cost.** Candidates this
review would *not* schedule absent owner interest: ISSUE-044/-045 (POC-scale router envelope),
ISSUE-070/-071 (conservative-direction nuisances), ISSUE-110 (delete the dead workflow vs
implement the fetch — a product call), ISSUE-127, MACRO-034 (a paragraph), GAP-048 (the
dashboard read — 1,077 lines nobody has read is a *risk acceptance*, and should be recorded as
one if declined), GAP-045/-047. Cost of each is stated in its entry. **Not answered.**

**D14 — Amend the addendum before executing it (IDEA-CAP-4 / MACRO-025 / IDEA-FWD-3).** Its
file lists omit the two silent-failure files; 17.4's acceptance is unsatisfiable before
GAP-021; 17.5 assumes ISSUE-001 fixed. Amending a committed plan document is the owner's call.
**Not answered.**

**D15 — Conflicting-fix registry (places where two findings pull different directions):**
(a) GAP-025's deny-by-default vs the liveness cost core.md's ask-starvation already creates —
denying more makes GAP-038's deny-recovery doctrine load-bearing; land them together.
(b) ISSUE-072's diligence demands vs review.md's honest "do not invent findings" calibration —
GAP-011 resolves by pricing the empty review rather than forbidding it; noted so step 5 keeps
the calibration line.
(c) GAP-016's derive-everything vs the plan-mandated §2 duality (interface + hand-written JSON
schema) — step 3 dispositioned the duality as contained; the registry should *pin*, not
*replace*, plan-frozen spellings.
(d) The MACRO-033 opinion (keep six stop kinds) vs any simplification impulse in D5 — the
closer makes six kinds cheap; collapsing them is a separate decision that would enshrine the
current collapse.

---

## 10. Pointer disposition — every cross-lens pointer from steps 2 and 3

**Step 2 → macro (10 pointers):** all dispositioned by step 3 §7 (verified against its table —
none dropped). Carried conclusions inherited here: keep six stop kinds (→GAP-021/D5);
requireMetaTool endorsed and extended (→GAP-006); enumeration measured one-sided (→GAP-025/
GAP-017); tools.ts split framed (→D2); inject.ts/continuation dispositioned (→GAP-005/cleared);
record freshness (→GAP-031); scripts/M5 split (→GAP-017/MACRO-034); types.ts duality contained
(→D15c); myprogram/layout drift (→IDEA-NAV-4); gate-as-noisy-sensor (→GAP-035).

**Step 2 → capability (6 pointers):**

| Pointer | Disposition |
|---|---|
| Every IDEA-STRUCT-1..8 is capability input | ALL became GAPs: 1→GAP-027, 2→named inside GAP-025 (owner option), 3→GAP-025, 4→GAP-011 (+D11), 5→GAP-021/-022, 6→GAP-016, 7→GAP-018, 8→GAP-033 |
| The live state block reaches nobody — highest-leverage for a lazy 32k model | became GAP-001 (+ IDEA-CAP-1's runtime-navigation accounting) |
| The honest "waiting on a human" disposition is a missing mechanism | became GAP-021 (+GAP-022, GAP-013) |
| The incentive gradient runs backwards | became GAP-014 (pricing) + GAP-021 (honest exit); doctrine account in §3 (review-layer packs align WITH the lazy gradient) |
| Nothing converts idle-throw/hang into an operator artifact | became GAP-023 |
| No size measure for glob-scoped items; no refutation-evidence field | became GAP-009; GAP-036 |

**Step 2 §12.2 DROPPED findings (flagged to us via step 3):** FANOUT-004 → **ISSUE-139**
(rides GAP-029); SWEEP-CORRECTIONS-009/SCRIPTS-PYTHON-013 → **ISSUE-140** (rides GAP-017);
SCRIPTS-PYTHON-014 → **ISSUE-141** (rides GAP-019); SWEEP-GATE-MUTATION-010 → investigated and
folded as a **facet of ISSUE-134** (its intermittency profile matches P14; no separate number).

**Step 3 → capability (11 pointers):** 1 wiring manifest → GAP-002 · 2 live-ish leg → GAP-003 ·
3 requireMetaTool-as-growth → GAP-006 · 4 disposition+closer → GAP-022/GAP-021 · 5
pricing-before-doctrine → GAP-014 (ordering adopted explicitly) · 6 health surface → GAP-023 ·
7 vocabulary registry → GAP-016 · 8 audit mutation suite → GAP-018 · 9 record gates →
GAP-030/-031 · 10 doctrine counterfactual → §3 framing + GAP-046 · 11 state block as runtime
navigation → GAP-001 + IDEA-CAP-1. **All worked.**

**Step 3 → enforcement-if-re-run (4 pointers), dispositioned by this merge:**
- `sameTree` unguarded restatement → **became ISSUE-142** (closed by GAP-002's deriveGateFacts).
- ops-docs.test section-parser mutation (~30 min, never run) → **still open**; added to
  GAP-018's seed corpus; no mutation was run by step 4 (this review ran none by charter).
- e2e fake-SDK harness learnability (51k tokens; several fixes need new e2e rows) → **still
  open as a costing note**; attached to D2/position 11 (the live-ish leg reduces new-e2e-row
  pressure); no defect.
- The four DROPPED findings triage → **done** (ISSUE-139/-140/-141 + the 134 facet, above).

**Step 3 M.6 composition question (do the proposed mechanisms compose?):** answered in the
missing-mechanisms part §8.4 and adopted here — GAP-002+GAP-016 are one declarative substrate;
GAP-021+GAP-022 land as one change; the sequencing constraints are §7's serial chains; **no two
GAPs prescribe conflicting fixes** (the near-conflicts are D15's four, all resolvable).

**Doctrine-efficacy part pointers:** the enforcement incentive-gradient pointer and macro
pointers 5/10 were additionally worked into the doctrine lens (§3; GAP-043/-014 ordering;
GAP-046) — dispositioned in that part's coverage ledger and re-verified here.

---

## 11. Coverage ledger

| Surface | Depth | Result |
|---|---|---|
| `parts-capability/missing-mechanisms.md` (1,120 ln) | read in full | 35 MM entries merged; §8.4 composition answer adopted; its session-verified greps (no injection hooks; no requireMetaTool/REQUIRED_HOOKS; 3 run.stop writers; handleAnswer no author check; state.ts wx-only) inherited as verified |
| `parts-capability/doctrine-efficacy.md` (782 ln) | read in full | 14 DE entries merged (4 absorbed, 9 standalone, 1 speculative); nine-pack assessment condensed to §3; its source spot-verifications (gates-git:383, tools.ts prompt sites, planning.ts:390-397, plan:1873) inherited |
| `findings-enforcement.md` (2,303 ln) | read in full | evidence base; all 138 ISSUEs + enforcement table + mutation table + adversary log + §12 merge notes consumed; 4 dropped findings re-registered |
| `findings-macro.md` (1,255 ln) | read in full | all 34 MACROs + correction clustering + navigability measurement + M.1–M.7 consumed; all pointers worked |
| `1-briefing.md`, `4-capability.md` | read in full | charter compliance |
| Source files | none read directly this session | this merge ran no greps and no mutations; every code-level claim herein carries its origin part/step attribution, and the parts' own verification notes state what was re-derived vs inherited |

**Honest limits of this merge:** (1) no independent re-verification of code facts was performed
at this layer — the two capability parts each re-verified their load-bearing facts by grep this
same day, and this document does not extend those claims beyond what they verified; (2) effort
estimates are the parts' own, sanity-checked but not re-derived; (3) the aggregate migration
cost of doing ALL structural work (macro M.6's open question) is addressed only as the plan's
tranche structure, not as a measured total.

---

## 12. Cleared areas

Inherited cleared areas from steps 2 and 3 stand unchanged (the enforcement spine; the security
DENY set that held; crash-safety atomicity; fan-out double-resolve; the C++ router data path;
the guarded vocabularies; G3 purity; the record's no-fabrication verdict). Capability-lens
additions — investigated and found NOT to need a mechanism:

- **Pack length at 32k** — measured; every role ≤8.3% of window; the charter's
  too-long-to-survive-truncation concern does not materialize (the risk is attention position).
- **debug.md / plan.md** — contradiction-free against every pack and gate; debug.md needs no
  structural help.
- **decompose.md's reuse-note enforcement claim** — honest (planning.ts:390–397).
- **A classifier doctrine pack** — considered and cleared (classification is skeptic-checked
  and disagreement-normalized mechanically, E4).
- **E-rows E3/E6/E11/E13/E18/E24** — RE-DERIVED; no mechanism owed. E5/E7/E10/E16 residues are
  plain filed bugs, not mechanism gaps.
- **Mechanism composition** — checked pairwise; no two proposed GAPs conflict (§10).
- **The impossible half of the trust boundary** — review content, fix correctness, and in-band
  human relay are correctly trusted; no GAP proposes to re-derive judgment itself.

---

## 13. MERGE NOTES

**SPECULATIVE count: 4 of 48 (8%)** — GAP-045 (partial-context), GAP-046 (efficacy probe),
GAP-047 (blocked pack), GAP-048 (dashboard read). All four were self-labelled by the parts;
none was forced down by this merge, and no part entry claiming grounding failed the check (each
of the 44 grounded GAPs was verified to cite at least one reproduced ISSUE, measured MACRO,
correction, or this-session-verified behaviour). That is a strong discipline signal: the
grounding rule held without enforcement pressure at this layer.

**Merge arithmetic:** 49 part-local capability entries (35 MM + 14 DE) → 48 GAPs. Four DE
entries fully absorbed (DE-004→GAP-036, DE-005→GAP-011/-012, DE-012→GAP-014, DE-013 split
across GAP-001/-016/-019 by facet); three MM-part IDEA-SPEC entries promoted into the GAP
sequence as SPECULATIVE so ranking is visible. Zero part entries dropped; the mapping table
(§2.1) is total. Four new ISSUEs minted (139–142) from step-2's dropped findings and one
step-3 pointer; one dropped finding folded into ISSUE-134 as a facet. Unified register: 224
entries (142 ISSUE + 34 MACRO + 48 GAP).

**Severity/confidence reconciliation:** the two parts used compatible tiers
(STRUCTURAL/DETECTED/ADVISORY + cost); no conflicts arose. Where a DE entry and an MM entry
covered one mechanism at different tiers (DE-004 advisory+schema vs MM-032 detected+doctrine),
the merged entry carries the strongest achievable tier with the layers named. The only
substantive framing difference found: the MM part declined the pack-by-pack efficacy judgment
as speculative while the DE part performed it as *structural judgment with named falsifiers* —
both are honored: §3 carries the judgments explicitly labelled structural-not-measured, and
GAP-046 carries the falsification plan.

**What the three reviews did NOT cover between them** (the union of all coverage-gap
disclosures, so step 5 sees the full residue): `dashboard/ledger_view.hpp` + `dashboard/main.cpp`
(1,077 ln, examined by nobody — GAP-048); fetch_models.py/benchmark.py execution (read, never
run — ISSUE-109's latent list is lower-confidence); the live G5 legs B/C and the two 11.8 live
probes (model-gated); opencode's real provider error path on an admission 503 (argued
structurally, never observed); clause-by-clause plan conformance for §5 (wire contract) and §7
(logging) (sampled, not swept); router/scripts *internal* architecture at macro depth; the
e2e/test harness never exercised by a macro or capability lens; ops-docs.test's section parsers
never mutated; no live model has ever run — every doctrine-efficacy and first-contact claim is
pre-registered for falsification at 13.2/14.2 rather than settled; and no lens measured the
aggregate migration cost of the full structural program (the plan's tranches are the closest
substitute).

**Ceremony report (briefing §5.1):** the accepted-on-trust→impossible-vs-unbuilt enumeration
was the highest-yield mandated exercise (it produced the register's spine); the charter's six
"where to look" lenses turned out to be six questions about the same ~35 mechanisms rather than
six territories — reported by the MM part and confirmed by this merge (the dedupe rate between
lenses was near-total, while the dedupe rate between the two PARTS was low: doctrine-efficacy
and missing-mechanisms genuinely covered different ground, meeting only at 7 entries). The one
place the format fought the content: the unified table's 224 rows compress each finding to one
line — the register sections and part files carry the real records, and the table should be
read as an index, not a summary.
