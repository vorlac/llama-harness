# Step 4 — Capability Review: Missing Mechanisms

**Scope:** What mechanism does not exist that would raise the floor on a lazy model.
Worked from step 2 (findings-enforcement.md) and step 3 (findings-macro.md) evidence,
including all CROSS-LENS POINTERS addressed to step 4.

**Date:** 2026-08-16
**Reviewer:** step-4 capability agent
**Output:** GAP records `MISSING-MECHANISMS-NNN`, IDEA entries, coverage ledger.

---

## 0. Method and record format

Every entry below traces to a specific ISSUE, MACRO, correction, or reproduced behaviour from the
step-2/step-3 registers (the grounding rule). Verification performed this session (not inherited):
grep-confirmed that no `experimental.chat.system.transform`/`chat.params`/`chat.headers` hook is
registered in `conductor/plugin/index.ts`; that no `requireMetaTool` or `REQUIRED_HOOKS` identifier
exists anywhere in `conductor/`; that `run.stop =` writers are exactly tools.ts:7657, tools.ts:7913
plus continuation.ts (matching MACRO-006's census); that `handleAnswer` (tools.ts:1057) contains no
author/provenance check; and that `state.ts` uses `flag:"wx"` twice and has no `flock`/`O_EXCL`
lifetime lock.

Record fields: **Grounding** (the ids), **Cannot re-derive today** (the fact the harness must
currently believe), **Impossible or unbuilt** (the section-1 discriminator), **Mechanism** (what to
build), **STRUCTURAL OR ADVISORY** (the field that matters most — "structural" = the wrong thing
becomes impossible or machine-refused; "detected" = the wrong thing becomes visible; "advisory" =
the model is asked), **Floor raised** (what the lazy model loses), **Cost** (rough).

---

## 1. Accepted-on-trust rows — impossible vs. nobody-built-it

Every ACCEPTED-ON-TRUST / MISATTRIBUTED / relevant PARTIALLY row of step 2's enforcement table
(§5, E1–E24) gets a verdict here. Rows where the harness already re-derives (E3, E6, E11, E13,
E18, E24) are not repeated. Rows whose residue is a plain filed bug with a one-line fix (E5's
0-option human decision → ISSUE-069; E7's id collision → ISSUE-049; E10's deletion freshness →
ISSUE-046; E16's free-string gate → ISSUE-007) are dispositioned as **"fix filed, no separate
mechanism needed"** — with one exception each noted inline where a mechanism-level generalization
exists.

| E-row | Trusted claim | Verdict | GAP |
|---|---|---|---|
| E1 | red *content* is meaningful | partially IMPOSSIBLE (meaning is judgment); scope-size floor UNBUILT | 013 |
| E2 | green is the vetted test passing | UNBUILT (identity witness; green-side symmetry) | 011, 012 |
| E8 | reviewer looked and found nothing | content IMPOSSIBLE; diligence witness UNBUILT | 001 |
| E9 | the fix was implemented | content IMPOSSIBLE; mechanical floor UNBUILT | 002 |
| E12 | run is finishable as reported | UNBUILT (stop closer; legality) | 008, 019 |
| E14 | a human answered | in-band IMPOSSIBLE; out-of-band channel UNBUILT | 003 |
| E15 | deferral is a human disposition | fix filed (ISSUE-052); pricing UNBUILT | 004 |
| E17 | setup answers are the human's | relay IMPOSSIBLE; degenerate-config refusal UNBUILT | 005 |
| E19 | doctrine reached the session | UNBUILT twice (wiring is a fix; the *witness* is a gap) | 006, 007 |
| E20 | meta tool is legal now | UNBUILT | 008 |
| E21 | this caller may call this tool | UNBUILT | 008 |
| E22 | sub-session write is in scope (main mode) | UNBUILT (type distinction) | 009 |
| E23 | router metrics describe this run | UNBUILT (wiring + contact witness) | 010 |

#### MISSING-MECHANISMS-001 — A reviewer diligence witness: no lens can prove it read the diff, so `[]` is free
- **Grounding:** ISSUE-072 (E8 — "empty findings is indistinguishable from never-looked"; the
  blind-spot guard fires only on a missing `Findings` object), adversary log (b) (lazy `[]`
  reproduced as sanctioned), IDEA-STRUCT-4.
- **Cannot re-derive today:** that the reviewer *looked*. The harness accepts a schema-valid
  `{"findings":[]}` as an approval with zero evidence of contact with the diff.
- **Impossible or unbuilt:** re-deriving "the diff has no defects" is genuinely IMPOSSIBLE
  (that judgment is why the reviewer exists). Re-deriving "the reviewer read the diff" is
  UNBUILT and cheap: the harness owns the diff before dispatch and owns the reply after.
- **Mechanism:** the dispatcher embeds a per-session nonce and per-hunk markers into the diff it
  hands the lens; the `Findings` schema gains required fields (`readWitness`: the nonce; per-lens
  `citedRanges`: file:line spans that must exist in the diff). The handler — not a skeptic —
  mechanically refuses a reply whose nonce is absent or whose cited ranges name lines the diff
  does not contain. An empty-findings reply must still carry the witness and at least one cited
  range per changed file (or an explicit per-file "no finding" row).
- **STRUCTURAL OR ADVISORY:** today ADVISORY (doctrine says review carefully — and per ISSUE-001
  even that never arrives). The mechanism is STRUCTURAL for diligence (a no-contact reply becomes
  schema-refused) while the judgment itself remains trusted — the honest boundary.
- **Floor raised:** the single cheapest review-evasion (return `[]` without reading) stops being
  free; a lazy lens must at minimum echo diff-derived tokens, which forces contact.
- **Cost:** ~1–2 days (schema field + dispatcher marker + handler check + tests). No plan change:
  §2.10's shape is additive-extensible.

#### MISSING-MECHANISMS-002 — A fixer-receipt floor: "DONE" is accepted with no mechanical tie to the finding
- **Grounding:** E9 (PARTIALLY — "a DONE that did nothing survives if the next round misses it"),
  ISSUE-072 (the next round is itself accept-on-trust), ISSUE-054 (routing already extracts paths
  from findings, so the material exists).
- **Cannot re-derive today:** that the fix round *changed anything relevant*. The receipt is
  believed; the only backstops are the re-validate (which proves tests pass, not that the finding
  was addressed) and next round's lenses (trust again — E8).
- **Impossible or unbuilt:** whether the change *addresses* the finding is IMPOSSIBLE
  mechanically. That the fix round's diff is non-empty and intersects the finding's cited
  files/ranges is UNBUILT and trivially derivable — the harness runs the git diff itself.
- **Mechanism:** after a fix dispatch returns DONE, the handler diffs the tree (it already owns
  git plumbing for publish) and refuses the receipt when the diff is empty or touches no file
  named by the finding (falling back to fileScope on findings with no concrete path). Refusal
  re-dispatches with the discrepancy named, and a second failure surfaces instead of advancing.
- **STRUCTURAL OR ADVISORY:** ADVISORY today → DETECTED-with-refusal (structural for the
  null-fix case: a DONE-that-did-nothing becomes machine-refused; a wrong-fix still needs the
  next lens round).
- **Floor raised:** the lazy fixer's cheapest move (acknowledge, change nothing) is closed.
- **Cost:** ~half a day + the ISSUE-054 path-extraction fix it shares machinery with.

#### MISSING-MECHANISMS-003 — A human-provenance answer channel: the state area the model cannot write is an unused human-only inbox
- **Grounding:** ISSUE-051 (E14 — any string clears the block; answered questions vanish from
  every report mode; "the human-in-the-loop can be fully simulated"), ISSUE-052/E15 (the forged
  `kind:"human"`), cleared area "edit-gate traversal — `.conductor/**` exact-case deny holds".
- **Cannot re-derive today:** that a human authored the answer. `conductor_answer` is a model
  tool; the model necessarily relays, and relay is indistinguishable from fabrication.
- **Impossible or unbuilt:** verifying in-band chat provenance is effectively IMPOSSIBLE at the
  plugin's vantage. An out-of-band channel is UNBUILT — and the harness has already built its
  precondition: the edit gate denies every session write under `.conductor/**` (step-2 cleared
  area), so **a file appearing there was not written by a gated session, by construction.**
- **Mechanism:** for `humanTerritory` questions only: `conductor_answer` records the model's
  relayed text as *proposed*, and the block clears when
  `.conductor/runs/<id>/answers/<qid>.md` exists — a file the operator drops (one `echo >>`
  command, printable by the question's own surfacing message and by `conductor_status`). Its
  presence is human provenance by the gate's own guarantee. Non-human-territory questions keep
  the current cheap path. Complemented by the detection half already filed (IDEA-OBS-3: render
  answered questions in the report).
- **STRUCTURAL OR ADVISORY:** STRUCTURAL — human-territory fabrication becomes impossible while
  the gate holds (note the dependency: ISSUE-016's case-fold bypass must be fixed or the
  guarantee has a hole; that fix is filed).
- **Floor raised:** the full human-simulation loop (surface → self-answer → proceed, reproduced
  in the adversary log) is closed for exactly the class of questions where it matters most.
- **Cost:** ~1–2 days. Plan-adjacent: §2.11 gains an `answeredVia` field — additive; flag for
  the owner (the step-4 merge's open-decisions list).

#### MISSING-MECHANISMS-004 — One price schema for the three escape hatches: defer is free, untainted, and unbudgeted
- **Grounding:** MACRO-007 (the backwards incentive gradient as a design property), ISSUE-052
  (E15), ISSUE-057 (inline-claim expiry unimplemented), ISSUE-007 (honest override use punished),
  adversary log (a) (defer-all → clean `done` reproduced), step-2 capability pointer "the
  incentive gradient runs backwards".
- **Cannot re-derive today:** nothing distinguishes a defer-dominated run from a completed one in
  cost terms; the cheapest full-run escape leaves the *least* audit trail.
- **Impossible or unbuilt:** UNBUILT. The override hatch proves the whole pattern in-repo
  (budget re-derived from both meters, taint, anomaly, honest provenance — step-2 cleared area);
  the other two hatches simply never got it.
- **Mechanism:** every process shortcut writes the same triple — budget consumption sized by
  impact, item taint/anomaly, honest provenance (`kind:"derived"` unless MM-003's channel
  supplies a human artifact). A defer-dominated settled set becomes report-visible by
  construction. This is the override-consumption seam (macro cleared area: "the coherence model
  the other hatches should copy") applied twice more.
- **STRUCTURAL OR ADVISORY:** doctrine telling the model not to defer is ADVISORY (and
  undelivered, ISSUE-001); a defer that costs budget is STRUCTURAL.
- **Floor raised:** the lazy model's best-paying strategy (defer the hard items, close clean
  `done` with forged provenance) becomes bounded, tainted, and visible; combined with MM-019 the
  honest-waiting path stops being the punished one.
- **Cost:** ~2 days + a recorded plan deviation (§3.6 budgets override only — this is genuinely
  the owner's call; MACRO-007 already flags it).

#### MISSING-MECHANISMS-005 — A degenerate-config refusal floor at setup: one tool call may not turn TDD off
- **Grounding:** ISSUE-048 (E17 — `behavioralPaths:[]` accepted; TDD off repo-wide in one call,
  reproduced), adversary log (a).
- **Cannot re-derive today:** what the human actually answered — the model relays setup answers
  and relay is unverifiable (IMPOSSIBLE half).
- **Impossible or unbuilt:** the *refusal floor* is UNBUILT: the harness can mechanically refuse
  answer shapes that disable the system's own law regardless of who authored them, and can
  re-derive "this behavioralPaths list intersects no detected source glob" from the repo scan it
  already performs at setup.
- **Mechanism:** refuse `behavioralPaths: []` (and any list disjoint from every detected source
  glob) unless the call carries an explicit `acknowledgeNoTdd: true` that is journaled and
  rendered in every report header; echo the accepted answers into the journal and the report so a
  fabricated relay is at least visible after the fact. Route the acknowledgement through MM-003's
  human channel where configured — then the floor is fully structural.
- **STRUCTURAL OR ADVISORY:** refusal is STRUCTURAL for the degenerate shapes; the honest-relay
  residue stays trusted (and is disclosed as such — HONEST-LIMITS limit 3 currently claims the
  only fabrication path is override, falsified by this row; MACRO-021).
- **Floor raised:** the one-call kill switch on RED-before-GREEN is closed.
- **Cost:** hours.

#### MISSING-MECHANISMS-006 — A doctrine delivery witness: "loaded ≠ delivered" has no mechanical form, so the system's thesis channel died silently
- **Grounding:** ISSUE-001 (CRITICAL — no session ever received doctrine, the state block,
  sampling, or router tags; survived all 52 tasks), ISSUE-004 (beacon written before packs load),
  ISSUE-138 (the banner nothing emits), ISSUE-114 (a pack absent from REQUIRED_PACKS silently
  never delivered), C-028 ("loaded ≠ delivered" — the rule existed and had no mechanism),
  IDEA-OBS-1, IDEA-PD-1, macro pointer 11 (the state block is also the 32k model's only runtime
  navigation).
- **Cannot re-derive today:** that any given sub-session's request actually carried its doctrine
  pack, state block, sampling params, and headers. Nothing observes the wire; the only "test" of
  delivery computes the expected text by calling the delivery function itself (P2, per ISSUE-001's
  status note).
- **Impossible or unbuilt:** UNBUILT at three cheap layers. (Wiring the hooks is ISSUE-001's fix
  and is not re-filed here; this GAP is the *witness* that makes the wiring's death loud next
  time.)
- **Mechanism, three layers:** (1) **wire-level, in the gate** — MM-018's stub-provider leg
  asserts a captured request contains the role's pack digest and headers (the only layer that
  catches "hook registered but opencode ignored it"); (2) **runtime receipt** — the plugin
  journals `doctrine.delivered {sessionID, role, packDigest}` from inside the transform hook, and
  `conductor_status` renders delivered-doctrine-per-role (IDEA-PD-1 — "would have exposed
  ISSUE-001 day one"); (3) **beacon stamp** — `doctrineLoaded` + pack digest written only after
  `ensurePacks` succeeds (fixes ISSUE-004's ordering as a side effect).
- **STRUCTURAL OR ADVISORY:** the injection content is inherently advisory to the model — but
  its *delivery* becomes DETECTED at the gate (red on the day the channel dies) and
  operator-visible at runtime. Note for the merge: the state block's second role (runtime
  navigation for a 32k model — recommended-next-tool) makes this the highest-leverage single
  wiring in the register; every downstream advisory defense presumes it.
- **Floor raised:** none directly on the model — on the *build*: the class "thesis mechanism
  silently absent for 52 tasks" cannot recur undetected.
- **Cost:** layer 2+3 ~1 day; layer 1 rides MM-018.

#### MISSING-MECHANISMS-007 — A wiring manifest with a completeness test: hook registration and module reachability are checked by nothing
- **Grounding:** MACRO-001 (~22-instance family including both CRITICALs; C-059's proposed
  detector recorded "now worth having" and never built), MACRO-002 (composition deferred by the
  manifest), ISSUE-001/-002/-038/-065 as live members; macro pointer 1 (weigh it first);
  grep-confirmed this session: no `REQUIRED_HOOKS`-like declaration exists.
- **Cannot re-derive today:** that the composed plugin registers every hook the design requires,
  that every built adapter module is reachable from the composition root, and that every closed
  vocabulary member has a producing site. A dead subsystem type-checks identically to a live one.
- **Impossible or unbuilt:** UNBUILT — and cheap *now* precisely because the composition root
  exists as one file with one factory (the charter's "prevention is now cheap" case).
- **Mechanism:** core exports the manifest (required hook keys; adapter modules that must be
  import-reachable from plugin/index.ts; stop kinds that must have a `run.stop` writer; tools
  that must have a non-fallback ToolSpec — MACRO-025(b)); one test constructs the real plugin and
  compares. Companion: the ~50-line unreachable-exports audit (MM-025) covers the "built, never
  imported" half.
- **STRUCTURAL OR ADVISORY:** converts an unstated convention into a DETECTED contract with
  refusal at the gate; the declaration side should share a substrate with MM-027 (see §7,
  mechanism composition — the macro merge's M.6 explicitly asked step 4 to reconcile these two).
- **Floor raised:** the single largest defect family in the record (both CRITICALs) becomes a
  red test on the day of introduction.
- **Cost:** ~1 day (MACRO-001's own estimate, endorsed).

#### MISSING-MECHANISMS-008 — One legality choke point for every conductor tool, caller identity threaded, and an FSM API that cannot be lied to
- **Grounding:** ISSUE-005 (E20 — meta tools guarded by nothing; reproduced three ways),
  ISSUE-006 (E21 — an implementer answers its own question / defers its own item), MACRO-004
  (four mechanisms, no owner; `handleReport` feeds the FSM the literal `"EXECUTING"` and the
  journal repeats the lie), MACRO-025 (every new tool re-rolls the class; the addendum's
  `conductor_clarify` is next); grep-confirmed: no `requireMetaTool` exists.
- **Cannot re-derive today:** whether *this* tool is legal *now* for *this caller*. The
  compensating layer the design assumed (the advisory state block) is dead (ISSUE-001).
- **Impossible or unbuilt:** UNBUILT. `legalTools` already computes the answer; it has two
  production consumers covering 7 of 22 tools.
- **Mechanism:** (a) `requireToolLegal(tool, store, runId)` consulted in `runTool` for every
  `conductor_*` name — new tools declare legality in a table (the growth mechanism, MACRO-025);
  (b) thread caller identity (`sessionID`/role from the registry) into `answer`/`defer`/
  `queue_amend` as it already is for `surface`/`override`, and refuse dispatched-role calls on
  self-serving paths; (c) `advanceRun(run, to, ctx)` replaces caller-supplied from-state
  (IDEA-LC-4) so the `"EXECUTING"` literal becomes inexpressible.
- **STRUCTURAL OR ADVISORY:** fully STRUCTURAL — position-shopping, terminal-run mutation, and
  self-answering become machine-refused rather than doctrine-forbidden.
- **Floor raised:** classify-shopping, defer-all-from-DECOMPOSED, reopening G8 on terminal runs,
  and the implementer self-service loop — all reproduced exploits — close at one seam.
- **Cost:** ~1–2 days (~7 mechanical FSM call sites; one table; identity threading exists for
  two tools already).

#### MISSING-MECHANISMS-009 — Two tree types: the slug/path duality stays a `string` and has now struck four times
- **Grounding:** MACRO-003 (named "architectural" at C-037 r.5, recurred at C-053 and as
  ISSUE-002 CRITICAL), ISSUE-002 (E22 — default mode denies every write).
- **Cannot re-derive today:** whether a `tree` value is an evidence-layer slug or a filesystem
  path; the compiler is indifferent and every dispatch site must remember.
- **Impossible or unbuilt:** UNBUILT — nominal branding (`TreeSlug`/`TreePath`) or carrying
  `{treeSlug, treePath}` pairs is ~15 mechanical sites (MACRO-003's measurement).
- **Mechanism:** as MACRO-003 specifies; the ISSUE-002 fix is the natural first commit of the
  migration. Include the composition test the shipped default currently lacks (an item with **no**
  worktree driving a real gate ALLOW).
- **STRUCTURAL OR ADVISORY:** STRUCTURAL — the fifth misfeed becomes a compile error.
- **Floor raised:** none on the model; on the build — the class that produced a CRITICAL under
  the heaviest correction regime on record becomes unrepresentable.
- **Cost:** ~1 day.

#### MISSING-MECHANISMS-010 — A router-contact witness: the report cannot say whether the router was ever in the loop
- **Grounding:** ISSUE-038 (metrics never composed into report deps — "unavailable" in every
  report, healthy or not), ISSUE-039 (`metricsPartial` written and read by nothing), ISSUE-086
  (the ledger-counter-moved claim asserted by nothing; drift observed live), ISSUE-116 (dead
  priority field), E23; dropped finding FANOUT-004 (the unvalidated `MetricsSummary` cast —
  becomes load-bearing the moment ISSUE-038 is fixed; the macro pointer asks that it ride along).
- **Cannot re-derive today:** that the run's model traffic transited the router at all, and
  whether the reported metrics describe the whole run or a partial window.
- **Impossible or unbuilt:** UNBUILT. The router's ledger is the repo's *best* evidence surface
  (E24: everything it reports it derived from traffic it relayed) — and nothing consumes it in
  production.
- **Mechanism:** compose `metrics` into the report deps (ISSUE-038's fix) **plus** the dumb
  cross-check that makes it a witness: snapshot `totalRequests` at run start (setup already
  probes the router), snapshot again at report, and render the delta beside the session count —
  a run whose delta is ~0 while N sub-sessions ran is *loudly* not routed. Render
  `metricsPartial` (ISSUE-039). Validate the summary shape at the seam (FANOUT-004).
- **STRUCTURAL OR ADVISORY:** DETECTED (the right tier — the router is deliberately optional
  under G5; the witness distinguishes "chose no-router" from "silently unrouted").
- **Floor raised:** the G5-equivalence class of tautology (C-089, ISSUE-074) loses its main
  remaining habitat: a live run's report carries router provenance the narrative cannot fake.
- **Cost:** ~1 day including the FANOUT-004 validation.

#### MISSING-MECHANISMS-011 — A vetted-test identity witness: the GREEN re-run proves a test passed, not that it is the test the vet approved
- **Grounding:** ISSUE-008 (E2 — implementer rewrites the vetted test inside fileScope,
  reproduced at gate and queue level; `mark_green` re-runs whatever is on disk with no re-vet),
  adversary log (b)/(e).
- **Cannot re-derive today:** that the file at `testScope` at mark_green time is the file the
  vet read. The FSM's RED→vet→GREEN sequence is structurally sound (cleared area) but the
  *artifact identity* across it is unwitnessed.
- **Impossible or unbuilt:** UNBUILT, twice, both cheap given what exists: (a) **prevention** —
  `decideEdit` already receives both scopes; subtract `testScope` from the implementer's
  writable set (the charter's detection-could-be-prevention case: the live gate snapshot makes
  this a set difference at an existing seam); plus the `fileScope ∩ testScope = ∅` refusal in
  `validateQueue`; (b) **witness** — hash the test content at vet time into the §2.6 record;
  `mark_green` refuses on hash mismatch without a re-vet (covers the bash-redirect and
  out-of-band write shapes the gate cannot attribute, ISSUE-014/-018).
- **STRUCTURAL OR ADVISORY:** (a) is STRUCTURAL; (b) is a structural refusal on a re-derived
  fact. Together they close the strongest reproduced TDD defeat.
- **Floor raised:** "weaken the vetted test, earn a green the vet never approved" — the lazy
  model's highest-value in-pipeline exploit — is closed from two independent directions.
- **Cost:** hours for (a); ~half a day for (b) (one field on the vet record + one comparison).

#### MISSING-MECHANISMS-012 — Green-admission symmetry: the red side refuses fallback/zero-test evidence, the green side admits it
- **Grounding:** ISSUE-010 (E2 — a zero-test or full-suite-fallback green admitted as the item's
  GREEN; the green record carries no `targeted`/`fellBack` field, so a forensic reader cannot
  tell), ISSUE-011 sibling context.
- **Cannot re-derive today:** the green record does not carry the facts the handler *had in
  hand* when it ran the test (deselection count, fallback flag) — discarded at the seam.
- **Impossible or unbuilt:** UNBUILT; the exact counterpart (`redAdmission`) exists one path over.
- **Mechanism:** mirror `redAdmission` on the green path — refuse `ranZeroTests || !targeted`
  (or journal + taint if the owner prefers detection); persist `targeted`/`fellBack` in the
  green §2.6 record so the evidence is auditable either way.
- **STRUCTURAL OR ADVISORY:** STRUCTURAL refusal on an already-re-derived fact — the purest
  nobody-built-it in the register.
- **Floor raised:** the "ride a fallback green past a test that executed zero times" path closes.
- **Cost:** hours.

#### MISSING-MECHANISMS-013 — A scope-size and scope-shape measure: globs make the item budget, the missing-subject rule, and the edit gate all vacuous at once
- **Grounding:** ISSUE-012 (E1/§3.2 — the size budget counts fileScope *entries*; `["src/**"]`
  counts 1; C-030 E12's refutation shown non-discriminating — P10), ISSUE-011 (`**`-headed
  fileScope makes `missing-subject` a free legal RED, reproduced twice), step-2 capability
  pointer "no size measure exists for glob-scoped items anywhere in the pipeline".
- **Cannot re-derive today:** how much of the repo an item's fileScope actually grants. The
  budget that §3.2 intends is measured in files; the code measures list length.
- **Impossible or unbuilt:** UNBUILT. The adapter already owns `expandScopeEntry` (publish uses
  it — the fix direction names this); expansion at queue-accept is the same call earlier.
- **Mechanism:** at queue acceptance in the adapter: expand each glob against the tree, count
  files, enforce `ITEM_MAX_FILES` on the expansion; reject wildcard-headed globs for behavioral
  items (reusing `isDegenerateScope`), closing ISSUE-011's vacuity at the same seam.
- **STRUCTURAL OR ADVISORY:** STRUCTURAL — scope declaration is one of the two points where
  control passes to model judgment (step-2 through-line); this bounds it mechanically.
- **Floor raised:** the decompose-time exploit family (declare `**`, get a repo-wide grant plus
  free legal REDs) closes; the item budget starts measuring what §3.2 says it measures.
- **Cost:** ~half a day.

## 2. Detection that could become prevention

G7 is "detection over prevention", honestly disclosed. For each disclosed detection-only gap, the
charter asks whether prevention is now *cheap* given what has since been built — the composition
root, the live gate snapshot, and the marker enumeration make several things trivial that were
expensive in the original design. Several such upgrades already appear above as the structural half
of a GAP (MM-011(a) subtracts testScope at the existing gate seam; MM-008 makes legality a choke
point). The ones below are prevention upgrades not yet captured.

#### MISSING-MECHANISMS-014 — The git gate is detection-by-enumeration where it should be prevention-by-attribution; every reproduced bypass sits on the enumeration side
- **Grounding:** MACRO-009 (measured: **0 reproduced bypasses on deny-by-default surfaces, 6+ on
  enumeration surfaces**, same layer, sometimes the same function), ISSUE-014 (wrappers/keywords
  hide the git verb; the guard fails OPEN on these; HONEST-LIMITS falsely claims a wrapper "cannot
  hide one"), ISSUE-015 (`git -c core.pager=<cmd>` — real arbitrary execution), ISSUE-017
  (`apply_patch` bypasses the edit gate), ISSUE-018/-019/-020, IDEA-STRUCT-3.
- **Cannot re-derive today, prevented instead:** the gate enumerates known-bad prefixes/tools/flags
  and allows the rest — so a token it cannot attribute (a novel wrapper, a keyword-prefixed
  compound, a hyphenated `git-apply`) passes. The enumerations are demonstrably not closed under
  the space of shells.
- **Detection→prevention:** invert the default at the attribution boundary. A token that
  basename-resolves to `git` (or a write tool) in an unattributable position is DENIED; a
  compound/keyword-prefixed command the parser cannot fully attribute is denied for
  write-capable sessions; the enumerations become allow-lists for known-benign shapes. The parser
  and the fail-closed guardedness derivation already exist (macro cleared area: "every guarded
  crash denies") — the change is which side of the boundary the *unknown* falls on.
- **STRUCTURAL OR ADVISORY:** STRUCTURAL — moves the residual from open-ended to enumerable and
  makes the two falsified HONEST-LIMITS claims true.
- **Floor raised:** arbitrary-write and arbitrary-execution routes through the gate close; the
  security posture stops depending on the completeness of a hand-list an adversary can walk off.
- **Cost:** ~2–3 days + a false-positive pass; pair with IDEA-LC-9 (record the benign-deny rate at
  first live contact — 13.2/14.2 — before flipping). The stronger form is IDEA-STRUCT-2 (a
  filesystem sandbox confining sub-session writes to the tree, making out-of-scope writes
  impossible rather than attributed) — higher migration cost, named here so the owner can weigh it.

#### MISSING-MECHANISMS-015 — The case-fold `.conductor` bypass turns the state-area deny from prevention back into a hole; it also undermines MM-003
- **Grounding:** ISSUE-016 (E-cleared-with-exception — `globMatch` is byte-exact while
  `headsOverlap` deliberately folds case "because darwin is case-insensitive", so
  `.Conductor/state/x` writes the real state area on the target FS; direct forgery of run state /
  evidence / journal), macro cleared-area caveat.
- **Cannot re-derive today, prevented instead:** the deny is *meant* to be structural (a session
  cannot write the state area). The byte-exact comparison on a case-insensitive filesystem lets the
  same file through under a different spelling — the prevention has a documented hole.
- **Detection→prevention:** the fix restores the *existing* structural intent, not a new
  mechanism — fold case in the `.conductor` deny on case-insensitive platforms (the codebase
  already knows the target FS: `headsOverlap` folds for exactly this reason). Listed here because
  **MM-003's human-answer channel depends on this deny being airtight** — the answer file's
  provenance guarantee is "a gated session could not have written it," which the case-fold bypass
  falsifies.
- **STRUCTURAL OR ADVISORY:** STRUCTURAL (restores it).
- **Floor raised:** run-state/evidence forgery via a case variant closes; MM-003 becomes sound.
- **Cost:** hours.

#### MISSING-MECHANISMS-016 — Inverted subject selection for every scanner: prevention that the audit layer itself lacks
- **Grounding:** MACRO-016 (23% of corrections are "a check inspects less than it appears to"; six
  are M5's file-set alone; live at HEAD in the audit layer built to catch it), ISSUE-088
  (stripComments blanks ~240 lines of tools.ts including a real call site — reproduced both
  directions), ISSUE-089 (deleting tsconfig silently disables the M3 leg), ISSUE-092 (M5 holes),
  MACRO-026 (growth lands, by construction, in the blanked span — the addendum appends ≥2 handlers
  plus new journal events there), IDEA-GATE-3.
- **Cannot re-derive today, prevented instead:** each scanner selects its subject by open-ended
  enumeration (a glob, a prefix list, a file list) and reports success over whatever it happened to
  match — so a file it *should* have seen but didn't is indistinguishable from a clean pass. This
  is the signature defect, and it is live inside the very layer built to prevent it.
- **Detection→prevention:** three cheap inversions. (1) Every scanner scans *all tracked source
  minus an explicit exemption list* and fails on an unexplained `git ls-files` delta (closes the
  M5 sub-family for good). (2) Leg-activation conditionals become leg-*missing* failures after
  bootstrap (ISSUE-089). (3) A string-aware `stripComments`, hoisted to one shared helper, plus a
  sentinel EOF-marker the audits must still see (ISSUE-088) — a pre-addendum prerequisite, since
  Phase 17's first appended handler lands in the blanked span.
- **STRUCTURAL OR ADVISORY:** STRUCTURAL — "the check covered its intended set" becomes a machine
  fact rather than an assumption; the enumerated sets stop needing to be closed under repo growth.
- **Floor raised:** the build's most productive self-deception (a green check that looked at less
  than it claimed) stops being available to new growth — including the addendum's.
- **Cost:** one script rewrite + one conditional inversion + ~15-line canaries; days, not weeks.

#### MISSING-MECHANISMS-017 — A standing mutation suite over the audit layer: the build's best instrument was never institutionalized where the decorative checks concentrate
- **Grounding:** MACRO-019 (mutation testing found/confirmed defects in ≥15 corrections, never
  became a gate leg; the enforcement spine BINDS while the audit/gate layer carries the
  survivors — enforcement §7.4 names ~15 decorative or blind checks), ISSUE-090 (a recorded
  `revertAssertion` proof rotted — mutation-equivalent), IDEA-STRUCT-7.
- **Cannot re-derive today, prevented instead:** the checkers that gate the build are provably
  weaker than the code they gate (the inversion a mechanical-enforcement thesis cannot afford),
  and nothing keeps them honest — the product got mutated because task loops touched it; the audit
  layer got mutated only when a reviewer chose to.
- **Detection→prevention:** a small standing mutation suite over the audit layer, seeded from the
  ~15 named survivors, run at phase gates, with C-049/C-051's compile-and-applied assertions built
  into the runner (IDEA-STRUCT-7's durable form: each task carries a machine-applicable patch +
  expected failing test ids, so `revertAssertion` claims stop rotting — ISSUE-090).
- **STRUCTURAL OR ADVISORY:** DETECTED-standing (the highest tier available for a checker-checker —
  it cannot make a checker structurally correct, but it makes decorativeness fail a gate).
- **Floor raised:** a decorative audit check (the class that let the whole cluster M sail green)
  stops being able to ship as enforcement; a rotted proof claim is caught on re-run.
- **Cost:** ~2–3 days; the mutation corpus is already written down in enforcement §6/§7.4.

## 3. Failures a human never sees

The charter: any failure whose only trace is an error-level journal line is a failure nobody
notices. Every terminal state should hand a human an artifact. C-085 fixed one such wedge; step-2's
composition pass should have found more, and did — this section turns them into mechanisms.

#### MISSING-MECHANISMS-018 — A live-ish gate leg (real opencode + stub provider): the two CRITICALs, and every future wiring death, are invisible to the whole test suite
- **Grounding:** MACRO-002 (the build shape defers integration and live truth to the end; the one
  place wire-level verification happened early — Task 0.2's wire-notes — is why the hook API was
  known; the counterexample that proves the mechanism), ISSUE-001 (dead injection, 52 tasks green),
  ISSUE-002 (default-mode write lockout, composed by no test), ISSUE-091 (the whole e2e passes
  35/35 with a gate that denies everything — the fake SDK writes files directly, so no legitimate
  write ever needs the hook's permission), macro pointer 2.
- **Failure a human never sees:** an entire product configuration (the shipped default) can be
  inert while 1,382 tests stay green, because every test drives a fake SDK. The two most severe
  defects in the whole review are exactly the ones the test architecture cannot see.
- **Mechanism:** a standing gate leg that starts a real opencode process against a ~50-line stub
  OpenAI-compatible provider, driven once per gate run through: plugin load → hook registration →
  one gated ALLOW write through the real hook → one doctrine-bearing request captured at the stub
  (the wire half of MM-006). Needs no model. Would have gone red on ISSUE-001, ISSUE-002, and
  ISSUE-091's gap on the day each was introduced (+~10s gate wall-clock).
- **STRUCTURAL OR ADVISORY:** DETECTED-standing — the single mechanism that makes the fake-SDK
  blind spot loud. It is the enabling leg for MM-006 (delivery witness) and MM-007 (wiring
  manifest completeness at the wire level).
- **Floor raised:** on the build, not the model — "a whole configuration is inert but green"
  becomes a red gate; the class that produced both CRITICALs is caught at introduction.
- **Cost:** ~2–3 days (the stub + the leg + the captures); the highest-leverage single build
  investment in the register.

#### MISSING-MECHANISMS-019 — A total stop-kind closer: two of six terminal dispositions have no writer, so an all-blocked run reports `done`
- **Grounding:** ISSUE-065 (MAJOR, P7 in its purest form — `blocked`/`surfaced` computed by core,
  written by nothing; the closer hardcodes `done`), ISSUE-066 (a blocked item with a dependent ends
  `noop`, resume dead, committed work lost — reproduced end-to-end), ISSUE-067 (silent wedge
  enshrined by a committed test), MACRO-006 (BLOCKING — the closer is a named prerequisite of 13.2,
  14.2, and Phase 17.4, whose acceptance is *unsatisfiable at HEAD*), IDEA-STRUCT-5, step-2
  capability pointer "the honest 'waiting on a human' disposition is a missing mechanism".
- **Failure a human never sees:** the worst possible operator signal for an unattended harness — a
  run where every remaining item waits on a human, or where committed work was lost, stamps
  "the run completed." The done/waiting/wedged distinction — the most load-bearing signal an
  unattended run produces — collapses onto `done`/`noop`.
- **Mechanism:** one core `stopKindOf(dispositions, cause)` total over STOP_KINDS, consuming
  MM-020's disposition enum, with every terminal path (report, futility, override exhaustion,
  halt) routed through one adapter closer; a `satisfies` over STOP_KINDS proves every kind has a
  producing branch (making the vocabulary exhaustive-by-construction — closes the ISSUE-065 class,
  not just the instance). The renderer already handles both missing kinds (step 2 verified only the
  writer is absent). Pair with a resumable-after-stop path so a `noop`/`blocked` run revives on
  `conductor_answer` instead of archiving lost work (ISSUE-066).
- **STRUCTURAL OR ADVISORY:** STRUCTURAL — a terminal state that cannot name its own disposition
  becomes impossible; the `satisfies` makes an unwritten kind a compile error.
- **Floor raised:** on the operator — a lost-work or waiting run can no longer masquerade as done;
  and (with MM-004) the honest-waiting path stops being the punished one relative to defer.
- **Cost:** ~1 day for the closer; the resume path ~1 more. **Land before 13.2** (its `13.2-report`
  row reads `done`/`noop` for a blocked smoke run) and before Phase 17.4 (unsatisfiable without it).
  Plan-adjacent: the §3.2-done vs §3.3-blocked contradiction (ISSUE-053) must be reconciled — the
  closer forces that decision (owner's call; §9 open decisions).

#### MISSING-MECHANISMS-020 — One disposition function: "is this item finished / waiting / hopeless?" is recomputed by ≥4 predicates that disagree, and every recorded wedge lives in the disagreement
- **Grounding:** MACRO-005 (seven strain points found by four lenses across two review generations;
  the FSM *edges* never strained — enforcement binds — the strain is entirely in the derived
  layer), ISSUE-055/-066/-067/-068/-050, C-084/C-085 (the wedge).
- **Failure a human never sees:** a run sitting in EXECUTING forever because every consumer
  predicate says "not mine" (C-085 — "a run that can never exit and can never be detected"; the
  exact shape §3.7 exists to end and the one it could not see). Each orthogonal mode (no-git,
  worktrees, debug, blocked-deps) has independently minted a new hole.
- **Mechanism:** one core `dispositionOf(item, ctx): "actionable" | "waiting-human" | "stuck" |
  "settled"`, consumed by the scheduler (skip non-actionable — closes ISSUE-068's class), the
  continuation engine (re-prompt iff actionable; detectable-wait iff waiting-human — converts
  ISSUE-067's silent wedge into a recorded stop), and the report closer (MM-019). Disposition stays
  *derived* — storing it would mint a new two-spellings problem (MACRO-005's own caveat).
- **STRUCTURAL OR ADVISORY:** STRUCTURAL — the seam *between* correct predicates (P7) is closed by
  giving the concept one owner; a new mode extends one function instead of minting a new hole.
- **Floor raised:** on the operator — the undetectable-wedge class becomes a detectable-and-recorded
  disposition; on the build — a new execution mode cannot silently reopen the wedge.
- **Cost:** consolidation + 3 consumer migrations, ~2–3 days, no schema change. It is the substrate
  MM-019 consumes — land together.

#### MISSING-MECHANISMS-021 — An operator health surface: sustained abnormality produces no artifact, only an unread journal line
- **Grounding:** MACRO-022 (failure visibility is designed as "an error-level journal line nobody
  reads"; the deny snapshot needed to diagnose the default-mode lockout is journaled at `debug`,
  below the default `info` — so the record needed to diagnose the first thing a real run hits was
  never written; time-to-cause hours→unbounded), ISSUE-033 (never-settling re-prompt → idle engine
  permanently silent, no floor fires), ISSUE-034 (deterministic throw in handleSessionIdle → silent
  forever through the G5 catch), ISSUE-031 (journal throw in the watchdog wedges the wave), IDEA-
  OBS-1/-2, IDEA-PD-1/-2, macro pointer 6.
- **Failure a human never sees:** "the idle engine threw on every pass for an hour" and "the
  transport hangs" leave no counter, no anomaly, no stop — the journal is the only trace and
  nothing watches it. Router-metrics reads "unavailable" in *every* report (ISSUE-038), so the one
  standing signal carries no information.
- **Mechanism:** one operator health surface. (a) Extend the §3.8 beacon with
  last-error/last-progress/doctrine-digest (IDEA-OBS-1) so `conductor_status` and an external
  watcher can read liveness without the journal. (b) A floor that converts N consecutive
  `hook.failed`/latch-skipped passes into a recorded `env` stop with a report — extending C-085's
  transport floor (which already exists in continuation.ts) to the store seam, catching
  ISSUE-033/-034. (c) Journal gate-deny snapshots at their own record's level, not `debug`
  (IDEA-PD-2) — so the default-mode lockout is diagnosable at default verbosity.
- **STRUCTURAL OR ADVISORY:** DETECTED — but it is the mechanism that gives *every* silent-failure
  finding a terminal artifact; without it, MM-019's honest stop kinds are still only reached from a
  *recorded* stop, and the detector-miss shapes reach none.
- **Floor raised:** on the operator — time-to-cause drops from hours/unbounded to the next status
  poll; the failures step 2 reproduced (lost work reading as complete; the doctrine channel's
  deadness) surface somewhere a human looks.
- **Cost:** each piece small; the floor pattern already exists in continuation.ts. ~1–2 days.

#### MISSING-MECHANISMS-022 — A terminal-run report is not guaranteed: a torn ledger after the stop is persisted leaves a stopped run with no artifact
- **Grounding:** ISSUE-061 (over-budget override writes the stop before the stop-report; a throwing
  report writer leaves a stopped run with no report.md — violating §2.9), ISSUE-101 (`handleStatus`
  and `reportQuestionLines` die on a torn `questions.jsonl` with a raw SyntaxError — exactly the
  post-crash moment torn lines exist, so the terminal/diagnostic path is unclosable), ISSUE-062
  (torn question-ledger → "release everything"), MACRO-023 (five hand-built ledgers, ≥3 crash
  postures; the crash-safety lesson re-learned per ledger and still unevenly applied), IDEA-JSONL-1.
- **Failure a human never sees:** the one artifact every terminal state is supposed to hand a human
  — the report — is the thing that fails to be written, precisely when a crash has just occurred.
  The run is terminal, the stop is persisted, and there is no report and no way to produce one.
- **Mechanism:** (a) one shared `readJsonlTolerant`/`appendJsonl` pair owning BOM handling and
  torn-tail isolation (the journal already heals — C-017; generalize it to all five ledgers), so a
  torn line can never crash a reader — makes the ISSUE-101 class *unrepresentable*; (b) the
  stop-report writer fails soft per section (ISSUE-061) so a torn file degrades one section rather
  than losing the whole artifact.
- **STRUCTURAL OR ADVISORY:** STRUCTURAL for (a) (a torn line stops being able to throw);
  defensive for (b).
- **Floor raised:** on the operator — every terminal state actually produces the artifact §2.9
  promises, including after the crash that motivates the guarantee.
- **Cost:** ~1 day (five call-site migrations to the shared reader).

## 4. Dumb mechanical cross-checks available and absent

The charter's observation: the highest-value additions in this build's history were boring — a
control suite proving the fixture discriminates, an execution witness proving a test really ran, a
two-way field-set comparison proving two spellings agree, a counter on the router's ledger proving
it was contacted. Several such checks are already the mechanism-half of GAPs above (MM-006 layer 1
is a wire capture; MM-010 is the router counter; MM-012 is red/green symmetry). This section
collects the remaining boring cross-checks that are *available* (both sides of the comparison
already exist) and *absent*.

#### MISSING-MECHANISMS-023 — Two-way vocabulary parity: every closed vocabulary is spelled 2–6 times and the compiler checks the extras, never the omissions
- **Grounding:** enforcement §7.3 (of ~26 closed vocabularies the unguarded/one-directional
  restatements outnumber the guarded), MACRO-012 (a stop-kind change touches 6 files in 3 languages,
  none derivable; a role is ~9 sites with two silent seams), ISSUE-114 (a pack in ROLE_PACKS but
  not REQUIRED_PACKS silently never delivered — reproduced), ISSUE-120 (`satisfies`/derived-key
  loops catch extras never omissions — STOP_KINDS, SCORE_KEYS, AMENDABLE_ITEM_STATES), ISSUE-113
  (a seventh TS stop kind crashes the 14.2 campaign python-side), ISSUE-121/-122/-123/-115/-117/
  -118, IDEA-STRUCT-6; the *exemplary* guard that already exists: composition.test:823 reads python
  source and asserts equality (cleared area).
- **Available-and-absent:** the repo's two strongest guards (single-source.test.ts's schema-enum
  equality; composition.test:823's cross-language source grep) prove the technique is cheap and
  in-hand — they were just applied to 2 vocabularies out of ~26. Every other copy pair is a
  `grep`-able equality assertion nobody wrote.
- **Mechanism:** a vocabulary registry + parity harness (IDEA-STRUCT-6): each closed vocabulary
  declares its owner and its restatement sites (including cross-language and the JSON-schema
  export); one generated test asserts set-equality *both directions* for every pair; python copies
  derive from the exported schema (the worked example: `Run.schema.json` → python STOP_KINDS,
  removing ISSUE-113's mid-campaign crash). Phase 17's three new vocabularies become its first
  natives.
- **STRUCTURAL OR ADVISORY:** STRUCTURAL (an omission becomes a failing equality test) and doubles
  as navigation (the registry is the index that makes copies enumerable — macro pointer 7).
- **Floor raised:** on the build — the single most *frequent* defect pattern (P3, two spellings)
  stops being able to drift silently; C-082's exact class (a value-spelled copy a concept-grep
  missed) becomes a red test.
- **Cost:** per-vocabulary incremental migration; the harness itself ~1–2 days, the exemplars exist.

#### MISSING-MECHANISMS-024 — A control/discrimination witness for the audit-and-acceptance layer: many checks pass without proving they *can* fail
- **Grounding:** ISSUE-064/-128/-130 (decorative validators — deleting them leaves the full gate
  green), ISSUE-047 (the format test passes for the wrong reason — the fixture reads
  `process.argv[2]`, always undefined, so it throws for every input, indistinguishable from a clean
  file), ISSUE-094 (acceptance row 10 passes with `derive_slots` collapsed to a constant — both
  sides of the comparison flow through the subject, P2), ISSUE-103 (NOISE_NOTE reworded to its
  opposite survives 33/33 — self-referential), ISSUE-135 (doctrine anchors pin keywords not
  polarity — a pack asserting the OPPOSITE stays green), P5 across the register (validators fed only
  input they must accept).
- **Available-and-absent:** the discriminator is the cheapest test there is — feed the check the
  input it must *reject* and assert it does. The build has the pattern (redAdmission's refusal
  tests; the fixture-discrimination control suites added by correction) but applied it unevenly;
  every decorative check above is a missing refusal case.
- **Mechanism:** a standing rule enforced by MM-017's mutation suite plus authoring discipline —
  every validator/parser/guard ships with at least one refusal test; every acceptance row that
  compares two computed values must restate one side as a literal the subject cannot reach
  (ISSUE-094's fix: `derive_slots(readers) == max(1, readers)`; ISSUE-103's: `assertEqual` the full
  literal; ISSUE-135's: anchor the full normative sentence including polarity). This is the general
  form of "a control suite proving the fixture discriminates."
- **STRUCTURAL OR ADVISORY:** DETECTED (MM-017 makes a check that cannot fail itself fail a gate);
  the authoring rule is advisory but MM-017 is its enforcer.
- **Floor raised:** on the build — a check that passes without being able to fail (the P2/P5 class,
  ~8 reproduced instances) stops shipping as enforcement.
- **Cost:** the refusal tests are hours each; the discipline is free; the enforcement is MM-017.

#### MISSING-MECHANISMS-025 — An unreachable-exports audit: "built but never wired / written but never read" is the build's second-highest-severity cluster and nothing checks for it
- **Grounding:** correction cluster C (~9, highest severity-per-entry, terminal instance = ISSUE-001
  CRITICAL), ISSUE-038 (`fetchMetricsSummary` never composed), ISSUE-039 (`metricsPartial` written
  and read by nothing), ISSUE-040 (`routerHealthy` no production caller), ISSUE-116 (dead
  `FanoutJob.priority`), ISSUE-104 (a bench metric reads a run-dir file nothing writes), the whole
  `inject.ts` module (fully built, fully tested, zero production callers), MACRO-001's completeness
  test, macro §3 cluster-C remedy ("a standing 'unreachable exports' audit (~1 day)").
- **Available-and-absent:** an import-graph walk is a ~50-line script (the layering lens already ran
  the full import scan by hand this review); "this export has no production caller" and "this
  written field has no reader" are both mechanically decidable and neither is checked.
- **Mechanism:** a gate leg that walks the import graph from `plugin/index.ts` (the production
  entrypoint) and fails on any exported adapter/core symbol reachable from no production path unless
  it is on an explicit "names its wiring task" exemption list (MACRO-002's per-task reachability
  row); a companion grep-pair for write-without-read on the state/evidence field names. Complements
  MM-007 (the manifest declares what *must* exist; this catches what exists but connects to
  nothing).
- **STRUCTURAL OR ADVISORY:** DETECTED-standing — turns the "faithfully built the dead thing across
  52 tasks" failure into a red gate at introduction.
- **Floor raised:** on the build — the class behind the CRITICAL (ISSUE-001) and four MAJORs
  becomes uncommittable without either a caller or a named-and-tracked wiring obligation.
- **Cost:** ~1 day; the seed (the by-hand import scan) exists in the macro coverage ledger.

#### MISSING-MECHANISMS-026 — A row-id ↔ test-title bijection check: 118 assertion rows are named nowhere and `coveredByTest` is dead on 69% of rows, yet a phase adjudicator read it as evidence
- **Grounding:** ISSUE-081 (`coveredByTest` null on 548/795 rows yet read as evidence — the
  phase-13 adjudicator inferred "nothing tests them" from nullness, right for 15.1, wrong for 14.1's
  33/33), ISSUE-132/-133 (row-id linkage unreliable; 5.3-direct-drive's coverage claim false; tests
  carry orphan ids with no row), ISSUE-075/-076 (promoted rows ticked while unmet; two live rows
  discharged by nothing), MACRO-020 (the assertion-row mechanism shipped without its lifecycle),
  IDEA-ROW-1/-2.
- **Available-and-absent:** both sets — the row ids in `specs/*.assertions.json` and the test titles
  in `conductor/tests/` — are enumerable by grep; the bijection between them is a ~40-line script
  nobody wrote, and the field meant to carry it (`coveredByTest`) was abandoned at task 9.1.
- **Mechanism:** a gate leg asserting every assertion-row id appears in exactly one test title and
  every id-shaped test title maps to a row (IDEA-ROW-1); a `disposition` field
  (met/superseded-by/waived/covered-elsewhere) that a scope-narrowing fix task *must* write
  (IDEA-ROW-2) so promoted-then-superseded rows (ISSUE-075) cannot read as discharged. Backfill once
  from the existing title convention.
- **STRUCTURAL OR ADVISORY:** DETECTED — makes "a named row proven by nothing" (P13) a red gate and
  makes the record's own index trustworthy again.
- **Floor raised:** on the build — the ledger stops being able to claim coverage it does not have;
  the frequency-over-position trap (P10) at the record layer closes.
- **Cost:** ~1 day including the one-time backfill.

#### MISSING-MECHANISMS-027 — A gate-record completeness check and a currency stamp: the build record silently stopped being maintained at task 11.8
- **Grounding:** ISSUE-083 (the M1–M9 gate ledger silently ends at 11.8; eleven COMMITTED tasks
  have no row; `15.0` appears zero times in GATES.json), ISSUE-082 (four record surfaces describe
  four different presents; the prescribed cold boot delivers instructions to redo finished work and
  evidence already retracted), ISSUE-073 (STATE.json still narrates the retracted G5 tautology),
  MACRO-013/-018/-030 (the record layer is exempt from the system's own re-derive thesis; decayed
  measurably at ~task 40 of 52; the addendum adds ~12 tasks onto it), IDEA-PROC-1, IDEA-PD-5/-6.
- **Available-and-absent:** "every COMMITTED task in STATE.json has a gate record in GATES.json" is
  a set-difference over two JSON files — the same shape as the vocabulary parity check the repo
  already ships for schemas. "The record is current" is a one-line stamp compared against a git
  timestamp. Neither exists.
- **Mechanism:** (a) a gate leg failing when a COMMITTED task lacks a gate record (and script-emit
  the terse rows going forward — IDEA-PD-5); (b) a single "record currency" stamp across
  HANDOFF/STATE/NOW/JOURNAL, with a check that flags a surface whose stamp predates changes to what
  it describes (ISSUE-082); (c) a generated CORRECTIONS index (id · title · files · class ·
  obligation-status) that fails when an entry carries an obligation-verb with no status — the
  measured 2:1 loss rate (MACRO-017) is the justification.
- **STRUCTURAL OR ADVISORY:** DETECTED — gives the record the treatment the code got; the record
  can no longer rot without failing something (MACRO-030's core recommendation). Phase 16 (repo
  hygiene) is the natural home — extend its charter from files to records *before* Phases 17–19 add
  ~12 tasks under the old regime.
- **Floor raised:** on the build and the cold-boot reader — recorded-debt-never-scheduled
  (the dominant meta-pattern, ISSUE-078/-100) and retracted-claim-still-narrated become gate
  failures, not archaeology.
- **Cost:** small scripts + a one-time backfill; ~1–2 days.

#### MISSING-MECHANISMS-028 — A spec-currency check for live-task assertions: `verifiedAgainstHead` is a one-shot claim that silently rots, and both live specs are stale in load-bearing ways
- **Grounding:** MACRO-028 (BLOCKING — `task-13.2.assertions.json` records `verifiedAgainstHead` at
  a sha 142 commits behind HEAD; its SG-A lands the banner and calls packs "injected verbatim" —
  all against ISSUE-001's dead channel; `task-14.2`'s three-arm design is *inverted at HEAD*: the
  conductor arm delivers *less* doctrine than the doctrine arm it must superset), ISSUE-078 (C-075's
  14.2 spec revision never landed — a three-way path conflict), ISSUE-104 (a 14.2 report column
  reads a file nothing writes — structurally 0), MACRO-029 (14.2 fails on launch mechanics and
  acceptance even if flawless), IDEA-FWD-2.
- **Available-and-absent:** `verifiedAgainstHead` records a sha; the files a spec cites are in the
  spec; "has any cited file changed since that sha" is a `git diff --name-only` intersection — a
  ~30-line check nobody wrote, so a spec's verification silently expires.
- **Mechanism:** (a) a spec-currency gate leg flagging any spec whose `verifiedAgainstHead`
  predates changes to files it cites; (b) a pre-live-contact preflight (IDEA-FWD-1) that, before any
  compute, spawns one 14.2 cell end-to-end against a trivial task (catches the PATH-less-cell
  blocker ISSUE-107 in seconds instead of over 90 wasted cells), runs verify-acceptance against a
  planted dummy at the path 14.2 will use (catches the ISSUE-078 conflict), and lands the standing
  report-checker (MM-029) — a ~2-minute go/no-go assembled from the step-2 register; (c) a one-page
  "14.2 validity preconditions" note naming ISSUE-001/-104/-065/-107 with the row each corrupts.
- **STRUCTURAL OR ADVISORY:** DETECTED — converts "the spec rotted, discovered at live-run time" into
  a pre-flight red. Grounds the sequencing finding (§Provisional plan): 13.2/14.2 must not start from
  their committed specs.
- **Floor raised:** on the build — the two scheduled live tasks stop being able to burn their
  (scarce, model-gated) budget rediscovering the step-2 register or failing on a path typo.
- **Cost:** the currency check ~half a day; the preflight assembles existing pieces, ~1 day.

#### MISSING-MECHANISMS-029 — A standing checker that ships *before* the live artifact it guards, bound to the run that produced it
- **Grounding:** ISSUE-093 (verify-acceptance's live-artifact rows accept any fenced/prose file as a
  transcript — a fabricated SMOKE.md flips row 6 in ~15s; the two artifacts it matters for — 13.2's
  SMOKE.md and 14.2's conductor-report.md — are the two not yet written and have no standing node
  guard), ISSUE-104 (a report column reads a file nothing writes), ISSUE-074 (the G5 checker proves
  consistency not provenance — but it *exists*, and its existence is why row 9b's fabrication was
  contained where rows 6/8 were not), IDEA-STRUCT-8, MACRO-029, the build's own declaration that
  authoring these two by hand is its worst-case failure.
- **Available-and-absent:** G5 got exactly this mechanism — but only *after* C-089 burned the build.
  The two remaining live artifacts have no such checker, and the difference is measured: row 9b's
  node guard rejected a fabrication the operator meter accepted; rows 6/8 have nothing. The pattern
  is proven in-repo; it was simply not made a *rule*.
- **Mechanism:** ship the SMOKE.md / conductor-report.md checkers *before* the artifacts exist
  (checker-ships-before-artifact as a standing rule, not a post-mortem), each requiring the artifact
  to embed a `runId` + evidence `seq` that *re-validates* against the run's own ledger — binding the
  artifact to a real run so a hand-written transcript cannot satisfy it (the "counter on the
  router's ledger" pattern, applied to the two artifacts most vulnerable to fabrication). Require at
  least one real `^\s*\$ ` command line + a content floor (ISSUE-093's fix direction).
- **STRUCTURAL OR ADVISORY:** DETECTED, approaching structural (an artifact bound to a runId+seq the
  checker re-validates cannot be fabricated without a real run).
- **Floor raised:** on the model/operator — the cheapest fabrication in the whole review (a ~15s
  fenced file that flips a FAIL to PASS) closes for exactly the two artifacts the build calls its
  worst-case failure.
- **Cost:** ~1 day per checker; must precede 13.2/14.2 execution (a scheduling constraint, not just
  a work item).

## 5. Self-diagnosis — time-to-why for a broken run

The charter: when a run goes wrong, how long does a human take to find out why? What is not recorded
that must be reconstructed by hand? Much of this overlaps section 3 (MM-021 is the operator health
surface; MM-019 gives terminal states honest names). The entries here are specifically about
*reconstruction cost after the fact* — the record a human needs to answer "why" that the harness
does not write.

The measured baseline (MACRO-022 Section G, MACRO-013): time-to-cause today ranges **hours to
unbounded**, and the build's own review agents hit it — step-2's P10 re-litigation "required
re-running mutations from scratch" because refutations are one prose line in an 82k-token file
(ISSUE-079); the phase-13 adjudicator drew a wrong conclusion from a dead index field (ISSUE-081).
The people best-equipped to diagnose this system — its own reviewers — could not do it from the
record. A 32k operator has no chance.

#### MISSING-MECHANISMS-030 — A run's own decision trail is not reconstructable: replay reads nine restated literals and renders silently-empty sections when any drift
- **Grounding:** ISSUE-131 (replay.ts restates nine journal event/component literals and every
  producer data-key with no drift guard, while its guard-test *claims* it "reuses the core
  vocabulary rather than restating"; a renamed data key makes `deriveReviewRounds` return `[]` and
  the REVIEW ROUNDS section render `(none)` — a silently-lying timeline for the §7.3 audience),
  ISSUE-104 (a bench metric reads a run-dir file nothing writes — structurally 0, rendered as a
  measured zero), MACRO-022 (the §7.3 debuggability audience).
- **Reconstruction cost:** the one tool built to answer "what happened in this run" (replay,
  the §7.3 mechanism) renders empty or zero sections when its hand-copied vocabulary drifts from the
  producers', and nothing catches the drift — so a human reading a replay cannot tell "nothing
  happened" from "the reader lost the thread." The self-diagnosis tool can itself lie silently.
- **Mechanism:** export the event/component names from `journal-events.ts` and have replay import
  them (kills the restatement); produce replay's test fixtures by *running the committed producer*
  rather than hand-writing the same strings (kills the P2 self-reference in its own guard); a
  section that renders empty must distinguish "no such events" from "no parseable events" (a
  torn/renamed-key signal). This is MM-023's vocabulary parity applied to the observability layer's
  data keys — the same registry covers it.
- **STRUCTURAL OR ADVISORY:** STRUCTURAL for the vocabulary (import, don't restate); DETECTED for
  the empty-vs-broken distinction.
- **Floor raised:** on the human — the diagnostic tool stops silently under-reporting; a drifted key
  fails a test instead of blanking a timeline.
- **Cost:** ~half a day (import the names; regenerate the fixture from the producer).

#### MISSING-MECHANISMS-031 — A durable failure-scratch capture: when the gate itself wedges or goes nondeterministically red, the evidence is discarded by the trap that fires on exit
- **Grounding:** ISSUE-032 (the test gate has no `--test-timeout`; a hang-shaped regression wedges
  the gate forever instead of failing it — one mutation deadlocked the suite, another stalled it
  ~15 min), ISSUE-134 (the full parallel gate is nondeterministically red on unmutated HEAD, and the
  failing assertions are enforcement-load-bearing — proposed class P14; every "GATE PASS" and every
  mutation verdict in the whole review is a distribution sample), MACRO-018 (the gate binary is a
  noisy sensor), IDEA-GATE-1 ("on gate failure copy the leg scratch dir somewhere durable before the
  trap fires").
- **Reconstruction cost:** the two failure modes hardest to diagnose — an infinite hang and a
  nondeterministic red — are exactly the two where the gate leaves the least behind: a wedged gate
  never reports; a flaky red's scratch dir is deleted by the `mktemp -d`+trap cleanup before a human
  can inspect which comparison flipped. Diagnosing ISSUE-134 required a reviewer to loop the failing
  tests by hand under artificial load.
- **Mechanism:** (a) pass `--test-timeout` (e.g. 120000) and a small `subSessionTimeoutMs` in test
  config so a hang *fails* instead of wedging (turns an unbounded-diagnosis into a red with a stack);
  (b) on any gate-leg failure, copy the leg's scratch dir to a durable location before the trap
  fires (IDEA-GATE-1) so the flaky-red evidence survives; (c) an injectable monotonic clock at the
  freshness/stale-red comparison seams (ISSUE-134's likely root: same-millisecond `Date.now()`/mtime
  collisions) so the enforcement suites are deterministic under load.
- **STRUCTURAL OR ADVISORY:** DETECTED/hygiene — but load-bearing for *every other finding in this
  review*, since a noisy gate means every mutation verdict is a sample. The monotonic-clock half is
  structural (removes the race).
- **Floor raised:** on the reviewer/operator — a hang becomes a diagnosable red; a flaky red leaves
  evidence instead of a deleted directory; the enforcement suite stops enforcing "differently under
  load" (P14).
- **Cost:** the timeout + scratch-capture are hours; the clock refactor ~1 day (focused seam work).

#### MISSING-MECHANISMS-032 — Symmetric refutation evidence: a refuted finding is one unauditable line, so the review machinery cannot diagnose its own false negatives
- **Grounding:** ISSUE-079 (refuted findings recorded without refutation evidence — makes P10
  auditing impossible from the record; re-litigation required re-running mutations from scratch),
  P10 itself (C-032 F1: the testWriter/test-writer defect found, escalated, refuted unanimously,
  sealed with a "do not re-litigate" note — true the whole time), ISSUE-012 (C-030 E12 refuted on
  procedural grounds that don't discriminate), MACRO-015 (upholds carry pages, refutations one line;
  of the refutations step 2 re-litigated, *two were wrong*; the asymmetry is in the record schema and
  the doctrine), IDEA-PROC-1, IDEA-PD-8.
- **Reconstruction cost:** the review machinery's own worst failure (a sealed false negative) is
  undiagnosable from the record because a refutation stores no evidence — no discriminating input, no
  run, no reading under which the finding fails. To check whether a refutation was sound, a later
  reviewer must redo the entire investigation. This is the meta-diagnosis gap: the system cannot tell
  a human *why* it dismissed a real finding.
- **Mechanism:** give a refutation the same evidence obligations as an uphold — a schema field for
  the discriminating input, the run, and the reading under which the finding fails; a one-line
  refutation is downgraded to an *abstention*, and an abstention *upholds* (MACRO-015). Kill the
  "do not re-litigate" note as a category (a refutation closes a finding for *this gate*, never for
  the record). Add the P10 identifier-position rule to skeptic doctrine (IDEA-PD-8): when checking
  code against a spec identifier, count only identifier positions, not prose frequency.
- **STRUCTURAL OR ADVISORY:** DETECTED/process (a refutation without evidence is schema-refused) plus
  an advisory doctrine addition (the identifier-position rule) — which per MM-006's analysis only
  matters once doctrine is actually delivered (ISSUE-001).
- **Floor raised:** on the review machinery — a false negative becomes re-auditable from the record
  instead of requiring a from-scratch redo; the P10 class (the most serious pattern, because it is
  meta) gains a diagnosis path.
- **Cost:** one schema field + doctrine paragraphs; ~half a day (retroactive auditing of past
  refutations remains impossible — ISSUE-079 stands as a sunk cost).

## 6. Advisory that could be structural

The plan's best ideas make the wrong thing *impossible* rather than forbidden — the item FSM
ordering, handler-run evidence, the single-writer rule. The charter: where does the system still
rely on a rule the model (or a code path) is *asked* to follow, when the property could be made
structural? Many of the entries above already do this conversion (MM-008 makes legality structural,
MM-011 makes test-identity structural, MM-013 makes scope-size structural). This section collects the
remaining places where an *asked* rule has a cheap structural form, and the STRUCTURAL-OR-ADVISORY
verdict is the whole point.

#### MISSING-MECHANISMS-033 — Single-writer is a pid-file convention with read-reason-rewrite races; an OS lock makes the double-writer unrepresentable
- **Grounding:** MACRO-027 ("read-only conductor" guards 2 of ~12 mutating store methods;
  `grep -rn ".readOnly"` finds zero consumers outside state.ts — re-verified this session; the
  demoted session overwrites the live writer's `alive.json`), ISSUE-023 (the read-only flag consulted
  by nothing), ISSUE-024 (stale-lock break is a naked read-then-overwrite TOCTOU — two post-crash
  restarts both become writers), ISSUE-025 (`release()` deletes whoever's lock is present),
  ISSUE-026/027/028 (the composed chain: duplicate evidence seqs → publish ships one item's green on
  another's verify), IDEA-STRUCT-1; verified: `state.ts` uses `flag:"wx"` twice, no `flock`/`O_EXCL`
  lifetime lock.
- **The asked rule:** "the second session is read-only" and "break a stale lock, then claim it" are
  enforced by a read-reason-rewrite pid-file protocol with a race at every edge — the system *asks*
  each path to behave and nothing makes it.
- **Structural form:** an OS advisory lock (`flock`/`O_EXCL`) acquired at open and held for the
  process lifetime makes two writers *unrepresentable* — the second `open` fails, full stop, and the
  read-only-demotion contract collapses to one check (refuse handler registration when the lock is
  not held) instead of twelve guarded methods. Write the `alive.json` beacon *after* winning the
  lock (ISSUE-023) so liveness names the real writer. Cheap defense-in-depth that closes the
  *corruption consequence* independently and immediately: the itemId/tree assertion in
  `readEvidenceAt`'s security-relevant callers (~10 lines, ISSUE-028) — so even before the lock
  lands, a mis-pointed seq cannot publish another item's green.
- **STRUCTURAL OR ADVISORY:** ADVISORY today (a convention consulted by nothing) → STRUCTURAL (the
  OS refuses the second writer). This is the cleanest advisory→structural conversion in the register.
- **Floor raised:** on correctness — the double-writer→seq-collision→wrong-publish chain (ISSUE-028)
  becomes impossible; the build's own concurrent-agent operation (this review suite; the reviewers who
  killed each other's test children, IDEA-PROC-2; the nondeterministic gate under load, ISSUE-134)
  stops corrupting state. 13.2's SG-K names accidental second sessions as a *when*, so this is on the
  path of scheduled work.
- **Cost:** the itemId/tree check ~hours (land now); the flock ~1 day. Owner note: if conductor is
  declared single-operator-single-session, the task-4.1 "read-only conductor" claim is withdrawn and
  this becomes a documentation-honesty finding instead (MACRO-027's alternative — §9 open decisions).

#### MISSING-MECHANISMS-034 — One transactional block-and-ask primitive: the crash-ordering rule is applied at 2 of 7 sites by hand
- **Grounding:** ISSUE-100 (the C-032 E7 crash-window class covers 7 blocking sites; the prevention
  half — `reuseOrAppendBlockingQuestion` — covers 2, bare `appendQuestion`+`setBlocked` remains at 5;
  the repair half's origin filter excludes 4 of them; C-067(a) recorded two as owed and the wiring
  never happened across ≥3 subsequent tools.ts rounds), correction cluster D (~12 crash-safety
  corrections, "convention-where-a-primitive-was-needed"), MACRO-023 (the same crash-safety lesson
  re-learned per ledger), IDEA-JSONL-1.
- **The asked rule:** "when you block an item, mint its question first and reconcile a crash in the
  window" is a discipline each of 7 call sites is *asked* to follow correctly; 5 do not, and the
  reconciler that would repair a crash excludes 4 of the 7 origins — so a crash between
  `appendQuestion` and `setBlocked` at a cap/scope-conflict/plan-review origin leaves an orphan open
  question naming items with no disposition.
- **Structural form:** one transactional `blockItemWithQuestion(item, question, ctx)` primitive that
  writes the question and the block as one crash-safe unit (or reconciles either half on the next
  read), routed through at all 7 sites; widen the reconciler's origin filter to all origins. Makes
  the ISSUE-100 class *unrepresentable* rather than fixed-per-site.
- **STRUCTURAL OR ADVISORY:** ADVISORY-per-site → STRUCTURAL (one primitive, no site can get the
  ordering wrong).
- **Floor raised:** on crash-safety — the orphan-question-after-crash class (which composes into the
  unclosable-run and lost-work shapes, ISSUE-066) closes at all seven sites at once.
- **Cost:** ~1 day (the primitive + 7 call-site migrations + the filter widening).

#### MISSING-MECHANISMS-035 — Inter-item scope disjointness is asked of the planner, enforced by nothing; make it a validateQueue refusal
- **Grounding:** ISSUE-008 (no `fileScope ∩ testScope = ∅` rule in `validateQueue` — an item can
  claim its own test file), IDEA-A-03 (the enforcement register's own note: "decompose.md should
  tell the planner scopes must be disjoint" — i.e. today it is *asked*), ISSUE-012/-011 (glob scopes
  evade the size and vacuity checks), ISSUE-063 (scope-conflict is handled as a runtime block, i.e.
  discovered late), MACRO-024 (`routeOf` is pure scope policy defined inline in a handler and
  defective — a core-owned refusal-tested rule would not have survived).
- **The asked rule:** the planner is *asked* to produce items whose scopes are disjoint and whose
  test scope does not overlap its file scope; `validateQueue` accepts overlapping and degenerate
  scopes, and the conflict surfaces at runtime (a wave scope-conflict block) or never (the vetted-test
  rewrite, ISSUE-008).
- **Structural form:** `validateQueue` (core, refusal-tested) rejects at queue-accept time: any
  `fileScope ∩ testScope ≠ ∅` (MM-011's queue half), any pair of behavioral items with intersecting
  fileScope (turns a runtime block into an authoring refusal), and wildcard-headed/oversized scopes
  (MM-013). Promote `routeOf` into core alongside it (MACRO-024's promotion criterion: a rule that
  adjudicates/routes model-supplied content MUST be an exported core function with refusal tests).
- **STRUCTURAL OR ADVISORY:** ADVISORY (decompose.md asks) → STRUCTURAL (validateQueue refuses at
  authoring, with the refusal tests P5 says every validator needs).
- **Floor raised:** on the model — the scope-declaration point (one of the two places control passes
  to model judgment, step-2 through-line) stops accepting the shapes that make downstream checks
  vacuous; scope conflicts become authoring-time refusals instead of late runtime blocks or silent
  holes.
- **Cost:** ~half a day for the rules; ~half a day to promote+refusal-test `routeOf` (shares
  machinery with MM-002's path extraction).

## 7. IDEA entries and SPECULATIVE gaps (ranked below all grounded entries)

Every MM-001…MM-035 above is grounded in a specific ISSUE/MACRO/correction/reproduced behaviour.
The entries here are either (a) capability IDEAs that raise the floor but are thinner than a full
GAP, or (b) SPECULATIVE — not traced to a reproduced defect, and by the grounding rule they rank
below every grounded entry. Prior IDEA registers (enforcement §3, macro §5) are the authoritative
IDEA lists; these are the capability-lens additions and the explicit speculation.

**Grounded capability IDEAs (thin GAPs / endorsements):**

- **IDEA-CAP-1** — A generated runtime navigation surface for the 32k model. MM-006's state block is
  the *runtime* half of MACRO-010/IDEA-NAV-1's static code map; when weighing ISSUE-001's fix, count
  the recommended-next-tool block's second role — it is the only affordable navigation a 32k model
  gets while running (macro pointer 11). Adjacent missing mechanisms: sub-file scope claims
  (line-range/symbol, so tools.ts work does not serialize on the whole file — MACRO-010) and a
  repo-size budget gate row that fails a task whose safe read-set exceeds the budget. Grounded in
  MACRO-010's measurement (Task A "add a tool" ≈ 37–40k tokens, does not fit 32k).

- **IDEA-CAP-2** — The `additionalProperties:false` discipline as the model for closed-input
  handlers. The one *legitimate* trap paragraph in extending.md (MACRO-011) is "add a schema →
  set additionalProperties" — a structural refusal of unknown fields. Every handler that parses
  model-supplied input should reject unknown keys the same way (several ISSUE-128/-130 decorative
  validators would gain teeth). Grounded in the P5 cluster; thin because no single reproduced
  exploit rides an extra field today.

- **IDEA-CAP-3** — A promotion criterion for core, mechanically checked. MACRO-024: "a rule that
  adjudicates/routes model-supplied content, OR is consumed by two call sites, OR is re-checked by a
  gate MUST be an exported core function with refusal tests." State it once; a lint-style check
  could flag adapter-closure policy (the `routeOf` shape). Grounded in ISSUE-054; folded into MM-035.

- **IDEA-CAP-4** — The addendum's own file lists are wrong and should be corrected *before* execution
  (MACRO-025: Task 17.3/18.1 omit tool-bindings.ts and plugin/index.ts — the two files with silent
  failure modes). This is not a mechanism but a pre-condition for MM-007/MM-008 to land cleanly; the
  merge should surface it as a decision (amend the addendum) rather than a work item.

**SPECULATIVE gaps (no reproduced defect — ranked last, kept few):**

- **IDEA-SPEC-1** — A per-role doctrine-efficacy probe once delivery is live. All nine packs are
  well-sized (verified: 2.7k–5.2k bytes each, no truncation risk for a 32k model) but **doctrine has
  never reached a session** (ISSUE-001), so their efficacy is counterfactual and the only tested
  consumers are keyword anchors that a negated sentence satisfies (ISSUE-135). SPECULATIVE because
  no live evidence exists either way; the mechanism (measure per-role failure and doctrine-citation
  rates at 13.2/14.2) is real and cheap once MM-006 lands. Not grounded in a *reproduced* efficacy
  defect — only in the delivery defect — so it sits here, not in the register.

- **IDEA-SPEC-2** — A "blocked / waiting-human" doctrine pack. The model will certainly hit the
  unattended-block situation, and no pack tells it how to behave (surface honestly vs defer vs
  proceed) — but the *mechanism* fixes (MM-003 human channel, MM-004 defer pricing, MM-019 honest
  stop kinds) make the behavior structural, which is strictly better than a pack asking for it.
  SPECULATIVE as a *pack* need; grounded as a *mechanism* need (already filed). Recorded so the
  option is visible, not endorsed over the structural fixes.

- **IDEA-SPEC-3** — A dashboard/ coverage pass. `dashboard/ledger_view.hpp` (659 ln) and
  `dashboard/main.cpp` (418 ln) were examined by nobody in step 2 (the single real coverage gap,
  §12.4) — 1,077 lines of unreviewed production C++. Not a missing *mechanism* and not grounded in a
  defect (nobody looked), but a missing-mechanism review should name it: whatever the dashboard reads,
  it reads the same ledgers whose cross-process seq hole (ISSUE-026) and torn-line throws (ISSUE-101)
  are live — so a reader there may inherit them. SPECULATIVE pending an actual read.

## 8. Coverage ledger

### 8.1 The GAP register at a glance (35 grounded GAPs + 7 IDEA/SPECULATIVE)

Ordered by the charter's objective criterion — **what would a lazy model exploit first** — with the
build-critical enablers noted. STRUCTURAL beats DETECTED beats ADVISORY; where a GAP has both, the
strongest achievable tier is named.

| MM | One-line | Tier | Primary grounding | Floor / who |
|---|---|---|---|---|
| 006 | Doctrine delivery witness (the thesis channel died silently) | DETECTED (content advisory) | ISSUE-001 CRIT | build + model runtime nav |
| 007 | Wiring-manifest completeness test | DETECTED | MACRO-001 (both CRITICALs) | build |
| 018 | Live-ish gate leg (real opencode + stub) | DETECTED-standing | ISSUE-001/-002/-091 | build |
| 008 | One legality choke point + threaded identity + safe FSM API | STRUCTURAL | ISSUE-005/-006, MACRO-004 | model |
| 009 | Two tree types (slug vs path) | STRUCTURAL | ISSUE-002 CRIT, MACRO-003 | build |
| 011 | Vetted-test identity witness | STRUCTURAL | ISSUE-008 | model |
| 012 | Green-admission symmetry | STRUCTURAL | ISSUE-010 | model |
| 013 | Scope-size / scope-shape measure | STRUCTURAL | ISSUE-011/-012 | model |
| 035 | Inter-item scope disjointness at validateQueue | STRUCTURAL | ISSUE-008, IDEA-A-03 | model |
| 001 | Reviewer diligence witness | STRUCTURAL (diligence) | ISSUE-072 | model |
| 002 | Fixer-receipt floor | DETECTED-refusal | E9, ISSUE-072 | model |
| 003 | Human-provenance answer channel | STRUCTURAL | ISSUE-051/-052 | model |
| 004 | One price schema for the three hatches | STRUCTURAL | MACRO-007, ISSUE-052 | model |
| 005 | Degenerate-config refusal at setup | STRUCTURAL | ISSUE-048 | model |
| 019 | Total stop-kind closer | STRUCTURAL | ISSUE-065/-066, MACRO-006 | operator |
| 020 | One disposition function | STRUCTURAL | MACRO-005, C-085 | operator+build |
| 021 | Operator health surface | DETECTED | MACRO-022, ISSUE-033/-034 | operator |
| 022 | Guaranteed terminal report (tolerant ledgers) | STRUCTURAL | ISSUE-061/-101 | operator |
| 010 | Router-contact witness | DETECTED | ISSUE-038/-039/-086 | build |
| 014 | Git gate: attribution not enumeration | STRUCTURAL | MACRO-009, ISSUE-014/-015/-017 | security |
| 015 | Case-fold `.conductor` deny (restore) | STRUCTURAL | ISSUE-016 | security |
| 033 | OS single-writer lock | STRUCTURAL | MACRO-027, ISSUE-023–028 | correctness |
| 034 | Transactional block-and-ask primitive | STRUCTURAL | ISSUE-100 | crash-safety |
| 016 | Inverted subject selection for scanners | STRUCTURAL | MACRO-016, ISSUE-088/-089 | build |
| 017 | Standing audit-layer mutation suite | DETECTED-standing | MACRO-019, ISSUE-090 | build |
| 023 | Two-way vocabulary parity registry | STRUCTURAL | MACRO-012, ISSUE-114/-120 | build |
| 024 | Control/discrimination witness (refusal tests) | DETECTED | ISSUE-047/-094/-103/-135 | build |
| 025 | Unreachable-exports audit | DETECTED-standing | cluster C, ISSUE-038/-040 | build |
| 026 | Row-id ↔ test-title bijection | DETECTED | ISSUE-081/-132/-133 | build |
| 027 | Gate-record completeness + currency stamp | DETECTED | ISSUE-082/-083, MACRO-030 | build |
| 028 | Spec-currency check + pre-live preflight | DETECTED | MACRO-028/-029, ISSUE-107/-078 | build (blocks 13.2/14.2) |
| 029 | Checker-ships-before-artifact, bound to runId+seq | DETECTED→struct | ISSUE-093/-104, MACRO-029 | model (blocks 13.2/14.2) |
| 030 | Reconstructable decision trail (replay parity) | STRUCTURAL/DETECTED | ISSUE-131/-104 | operator |
| 031 | Durable failure-scratch + timeout + monotonic clock | DETECTED/struct | ISSUE-032/-134 | reviewer (affects all verdicts) |
| 032 | Symmetric refutation evidence | DETECTED + doctrine | ISSUE-079, MACRO-015, P10 | review machinery |

**The three that most limit the system, if the merge needs a headline:** MM-006/-007/-018 (the
system's thesis channel is dead and the test architecture cannot see it — nothing else matters until
delivery is witnessed); MM-008 + MM-011/-012/-013/-035 (the two points where control passes to model
judgment — meta-tool legality and scope declaration — are structurally open); MM-019/-020/-021 (an
unattended run cannot honestly say done/waiting/wedged, so every silent failure reads as success).

### 8.2 Enforcement-table row coverage (every ACCEPTED-ON-TRUST / PARTIALLY / MISATTRIBUTED row)

The §1 table dispositions E1, E2, E8, E9, E12, E14, E15, E17, E19, E20, E21, E22, E23 — every row
that is not already RE-DERIVED. E5/E7/E10/E16's residues are plain filed bugs (ISSUE-069/-049/-046/
-007) needing a fix, not a new mechanism, and are marked so. E3, E6, E11, E13, E18, E24 are
RE-DERIVED and need nothing. **No ACCEPTED-ON-TRUST row is left without a verdict.**

For each: is re-derivation absent because IMPOSSIBLE or UNBUILT? IMPOSSIBLE (a judgment the model
exists to make): the *content* of a review verdict (E8), of a fix's correctness (E9), of in-band chat
provenance (E14/E17). Everything else was UNBUILT — nobody built it — and those are the register's
highest-value entries (MM-001/-002/-003/-005/-006/-008/-009/-010/-011/-012/-013/-019).

### 8.3 Cross-lens pointers worked

The pointers addressed to the capability review were leads to work, not optional reading. Disposition:

| Source pointer | Worked into |
|---|---|
| enf: every IDEA-STRUCT-* is capability input | STRUCT-1→MM-033; -2→MM-014; -3→MM-014; -4→MM-001; -5→MM-019/-020; -6→MM-023; -7→MM-017; -8→MM-029 |
| enf: the live state block reaches nobody (ISSUE-001) | MM-006 (+ IDEA-CAP-1 runtime-nav role) |
| enf: honest "waiting on a human" disposition is missing | MM-019 (+ MM-020, MM-003) |
| enf: the incentive gradient runs backwards | MM-004 (pricing) + MM-019 (honest exit) |
| enf: no mechanism converts idle-throw/hang into an artifact (ISSUE-033/-034) | MM-021 |
| enf: no size measure for glob-scoped items (ISSUE-012); refutation-evidence field (ISSUE-079) | MM-013; MM-032 |
| enf CROSS §M.4: three DROPPED findings need triage | FANOUT-004→MM-010 (rides ISSUE-038's fix); SWEEP-CORR-009 (/tmp)→noted under MM-016/§9; SCRIPTS-014→MM-024; SWEEP-GM-010→MM-031 (ISSUE-134 facet) |
| macro 1: wiring manifest / REQUIRED_HOOKS — weigh first | MM-007 |
| macro 2: live-ish gate leg | MM-018 |
| macro 3: requireMetaTool is a growth mechanism | MM-008 |
| macro 4: disposition function + stop closer | MM-020 + MM-019 |
| macro 5: escape-hatch pricing before doctrine | MM-004 |
| macro 6: operator health surface | MM-021 |
| macro 7: vocabulary registry (quantified) | MM-023 |
| macro 8: standing audit-layer mutation suite | MM-017 |
| macro 9: record needs gates like the code | MM-026/-027 |
| macro 10: doctrine efficacy is counterfactual | IDEA-SPEC-1 (+ MM-006 as precondition) |
| macro 11: dead state block is runtime navigation | MM-006 + IDEA-CAP-1 |
| macro M.6: do the proposed mechanisms compose? | §8.4 below |

### 8.4 Mechanism composition (the macro M.6 question, answered)

The macro merge explicitly asked step 4 to check the proposed mechanisms do not conflict. They
compose cleanly, with two shared substrates the merge should treat as *one* mechanism each rather
than two:

- **"The declaration of what must exist."** MM-007 (wiring manifest) and MM-023 (vocabulary registry)
  both want to own a declaration of required things. They should be **one declarative substrate** —
  a manifest that covers hooks, reachable modules, stop-kind writers, ToolSpec completeness, *and*
  closed-vocabulary owners/restatements — with one completeness test. Building them separately would
  itself be a two-spellings defect (the irony the merge should avoid).
- **"Disposition."** MM-020 (`dispositionOf`) and MM-019 (`stopKindOf`) share a disposition enum by
  design — MM-019 consumes MM-020's output. Land as one change.
- **Sequencing dependency:** MM-016 (string-aware stripper) and MM-006's beacon stamp should precede
  the addendum's first appended handler; MM-010's router validation rides ISSUE-038's fix; MM-003
  depends on MM-015 (the case-fold deny must be airtight for the answer-file provenance to hold);
  MM-011(a) and MM-013 and MM-035 all land at the `validateQueue`/`decideEdit` seam and should be one
  scope pass. No two GAPs prescribe *conflicting* fixes.
- **MACRO-010's tools.ts split** (a macro finding, not re-filed here) should precede MM-006/-008's
  wiring so the new handler code lands in a readable, audit-visible file — a sequencing note for the
  provisional plan, per the macro M.6 request.

### 8.5 What this lens did and did NOT do

**Did:** read `1-briefing.md`, `4-capability.md`, `findings-enforcement.md` (all 2,304 lines),
`findings-macro.md` (all 1,255 lines) in full; worked every cross-lens pointer addressed to step 4
(§8.3); verified the load-bearing facts this register rests on by direct grep/read this session (no
injection hooks registered; no `requireMetaTool`/`REQUIRED_HOOKS`; the three `run.stop` writers;
`handleAnswer` has no author check; `state.ts` has `flag:"wx"` twice and no lifetime lock; nine
doctrine packs all under 5.2k bytes). Produced 35 grounded GAP records + 4 grounded capability IDEAs
+ 3 explicitly-SPECULATIVE entries.

**Did NOT (deferred to the parent merge, per the split):** the executive verdict, the full unified
register merging all three ID spaces, the systemic-cluster section, the dependency graph, the
PROVISIONAL ordered plan, the open-decisions framing, and the full doctrine assessment (§3 of the
consolidated doc — all nine packs individually judged for a 32k model). My scope was *what mechanism
is missing*; the consolidation (JOB 2 of `4-capability.md`) is the interactive parent session's.
Doctrine efficacy is counterfactual until MM-006 lands (ISSUE-001), so a pack-by-pack efficacy
judgment would be speculation — flagged as IDEA-SPEC-1, not asserted.

**Genuinely not examined:** `dashboard/*` (1,077 lines, step-2's single real coverage gap — carried
forward as IDEA-SPEC-3, not read this session); the live behaviour of any mechanism (no run has ever
occurred); whether the proposed structural fixes introduce *new* enforcement holes (each should get
the refusal-test treatment MM-024 mandates when built — a check the implementer owes, not this
review).

### 8.6 Ceremony report (per briefing §5.1)

The accepted-on-trust enumeration (§1) was the highest-yield exercise — it converted step 2's
enforcement table directly into the register and produced the impossible-vs-unbuilt discriminator
the charter most wanted. The detection→prevention and advisory→structural passes largely *re-tiered*
GAPs already surfaced by the accepted-on-trust pass (MM-011, MM-013, MM-035 appear under multiple
lenses) rather than finding new ones — which is itself the finding that the charter's six lenses are
different questions about the same ~35 mechanisms, not six disjoint territories. The one lens that
added net-new material was self-diagnosis (§5): MM-030/-031/-032 are reconstruction-cost gaps the
other lenses did not reach, and MM-031 (the noisy-gate diagnosis gap) is load-bearing because it
taints every mutation verdict in the entire review (ISSUE-134). No mandated pass was pure busywork;
the composition-check (§8.4) changed a recommendation (merge MM-007 and MM-023 into one substrate).
