# Sweep — Vocabulary Inventory (P3)

**Scope:** Full inventory of every closed enum, role name, tool name, journal event, stop kind,
anomaly kind, failure class, filename, path, glob, schema key and env var in the repo. For each:
which file OWNS it, every other site, and whether each other site DERIVES or RESTATES it. Every
restatement without a drift guard is flagged even where the copies currently agree.

**Date:** 2026-08-16
**Reviewer:** vocabulary-sweep subagent (step-2 enforcement, Part D / Part G item 3)

**Environmental caveat, stated up front because it affects several verdicts:** during this sweep a
CONCURRENT review agent held an uncommitted mutation in the shared working tree
(`gateBeforeToolCall` in `conductor/adapter/tools.ts` opened with an unconditional
`throw new Error("… (blanket-deny mutation)")`; restored by that agent mid-sweep). Full-gate runs
taken during that window are contaminated (32–33 failures not attributable to my mutations), so
every verdict below rests on SCOPED suite runs against per-suite baselines, with control runs
proving which failures belonged to the sibling. I did not edit `tools.ts` at any point, and my
snapshot of it (taken before I understood the situation) contains the sibling's mutation — so it
was never used for a restore. Two planned mutations against `tools.ts` were abandoned for this
reason and are marked NOT MUTATED below. Tree verified clean of my changes at sweep end
(`git status`: only the pre-existing untracked docs).

---

## 1. ISSUE register

### SWEEP-VOCABULARY-001 — The journal-vocabulary source audit blanks real code: a glob string opens a bogus block comment and swallows a literal call site, so deleting an event from the closed vocabulary stays green

- **Severity:** MAJOR (a P1 hole in the repo's best drift guard, reproduced by mutation)
- **Pattern:** P1 (check inspects less than it appears) + P4 (the audit's own comment claims a
  property it does not implement)
- **Where:** `conductor/tests/journal-vocab.test.ts` `stripComments()` (lines 123–146), used by the
  `[vocab-callsites]` source audit; the same idiom lives in
  `conductor/tests/legaltools-callsites.test.ts` (the file the journal audit says it borrowed it
  from).
- **What happens:** `stripComments` is string-blind. A `/*` INSIDE a string literal is treated as a
  block-comment open, and everything until the next `*/` anywhere (including inside another
  string) is blanked. `conductor/adapter/tools.ts` line ~9104 contains the prompt-text literal
  `"…ve glob **/*.go; §2.1 asks for **/*.go minus **/*_test.go…"` — the `/*` inside `**/*.go`
  opens a bogus comment that blanks **lines 9104–9254**, swallowing the literal journal call
  `input.journal.log("info", "state", "config.updated", …)` at `tools.ts:9236`. Measured: raw
  `.log(` sites in tools.ts = 76; after stripComments = 75; the stripped text no longer contains
  `"config.updated"` at all.
- **Reproduction (mutation):** removed `"config.updated"` from `EVENTS.state` in
  `core/journal-events.ts` → `journal-vocab.test.ts` stays **7/7 green** (verified twice on a
  clean tree; `isKnownEvent("state","config.updated")` probed false under the mutation). The only
  thing that went red anywhere was ONE assertion in `setup.test.ts` (line 2279's explicit
  `isKnownEvent` pin) — a pin that exists because of a P9 note, not because the audit works.
  Without that single pin, the drift would be caught by nothing static, and the production
  reconfigure path would THROW in dev-shaped use (adapter/journal.ts refuses unlisted events
  outside NODE_ENV=production) the first time an operator reconfigured.
- **Why this is worse than one missed site:** the audit asserts anti-vacuity FLOORS
  (`MIN_SITES_IN_TOOLS = 60 <= 75`), so losing sites one at a time is invisible; and its comment
  claims the dynamic pass-through sites are safe because "whose caller IS audited below" — for the
  swallowed region that claim is false. The audit's own defense (C-045: a scan that inspects less
  than it claims) is the defect class it has.
- **Blast radius measured across both audits** (raw vs stripped occurrences, every production
  file): `tools.ts` `.log(` 76→75 (the real config.updated site lost); `stops.ts`
  `legalTools(` 1→0 and `inject.ts` 2→1 (both losses are comment mentions — intended behavior;
  the legaltools audit currently loses no REAL call site). The hole is latent in
  legaltools-callsites.test.ts: any future glob-in-string placed before a production `legalTools(`
  call site silently removes that call site from the C-048 guard.
- **Failed refutation:** "the blanked text is a prompt string, not code, so blanking is right" —
  no: the blanked REGION extends 150 lines past the string into real code, including the journal
  call; the measurement (`stripped.includes('"config.updated"') === false`) settles it.
- **Fix direction:** make the stripper string-aware (track quote state), or add the invariant the
  mutation would have tripped: per file, the count of `.log(`/`legalTools(` matches in
  NON-COMMENT text must equal a raw-text count minus explicitly-listed comment mentions; or
  simplest, assert the audit finds the known sentinel site `tools.ts "config.updated"`.

### SWEEP-VOCABULARY-002 — A doctrine pack listed in ROLE_PACKS but absent from REQUIRED_PACKS is silently never delivered, and no test can see it

- **Severity:** MAJOR (C-083/C-028 class, alive today; confirmed uncatchable by mutation)
- **Pattern:** P3 (two spellings of "which packs exist") composed with a silent-skip (the C-085
  composition shape: each piece defensible alone)
- **Where:** `conductor/adapter/inject.ts` — `ROLE_PACKS` (line 35, what is DELIVERED) vs
  `REQUIRED_PACKS` (line 73, what is LOADED). Both are **module-private**, so no test can compare
  them. `buildSystemAppend` (lines 197–199) silently skips any pack absent from the cache
  (`if (content !== undefined) append.push(content)`), and even pushes `""` as append[0] if all
  packs are missing.
- **Reproduction (mutation MUT-1b):** added `"extra-governance.md"` to `ROLE_PACKS.planner`.
  Result: `inject.test.ts` 0 fail, `doctrine.test.ts` 0 fail, `wire-contract` 0, `fanout` 0,
  `tools-9.1/9.2` 0, `e2e` 0 (run twice; an initial 2-fail e2e run did not reproduce and is
  recorded as flake below). `composition`/`composition-root` failures observed during the window
  were proven to belong to the concurrent agent's gate mutation (identical failures persisted
  after my change was reverted). **Verdict: caught by nothing.** In production: the planner would
  run with silently-partial doctrine on every dispatch, forever, with a green gate.
- **Reverse direction (MUT-1, for completeness):** removing `"plan.md"` from REQUIRED_PACKS IS
  caught — by `inject.test.ts [8.2-missing-pack]` (a guard-fires assertion: loadPacks stopped
  throwing for a fixture that deletes plan.md) plus init-dependent suites. So the pair is guarded
  in one direction only, and the guarded direction is the less dangerous one (fail-closed at
  startup vs silent-partial-doctrine at runtime).
- **Fourfold restatement of the nine-pack list, none derivable:** inject.ts REQUIRED_PACKS ·
  `tests/doctrine.test.ts:40` (own literal list) · `tests/inject.test.ts:99` PACK_FILES (own
  literal list — its buildSystemAppend cases construct the packs map from this list, NOT from
  loadPacks, so REQUIRED_PACKS drift cannot reach them) · `scripts/verify-acceptance.sh` detector
  B (fifth copy, kebab loop `for p in core decompose plan …`).
- **Fix direction:** derive `REQUIRED_PACKS` as `union(ROLE_PACKS values) ∪ {debug.md,
  receive-review.md}` (one source); export both; make buildSystemAppend fail closed (or journal
  `hook.failed`) on a pack absent from the cache instead of silently skipping.

### SWEEP-VOCABULARY-003 — §2.3 terminality has three hand copies, and the file claiming to be "the ONLY definition" is not

- **Severity:** MEDIUM
- **Pattern:** P3 + P4 (stops.ts's doc-comment asserts single-source that is false)
- **Sites:** `core/stops.ts:65` `TERMINAL_STATES` + `isTerminal` (comment: "This is the ONLY
  definition — the continuation engine (§3.7), legalTools (§3.4), and run creation (§3.2) all call
  it") · `core/gates-phase.ts:113` `TERMINAL_RUN_STATES` + `isTerminalRun` (deliberately inlined —
  so legalTools does NOT call stops' isTerminal, contradicting stops' comment) ·
  `scripts/conductor_bench.py:83` `TERMINAL_RUN_STATES` (python, cross-language).
- **Mutations:** MUT-2 (drop "ANSWERED" from stops.ts) → stops.test +1, continuation.test +2 —
  pinned. MUT-3 (drop "ANSWERED" from gates-phase.ts) → gates-phase.test +1 — pinned. So each
  copy is individually pinned, but nothing binds the copies to EACH OTHER: a §2.3 change applied
  to one copy and its pin leaves the other two silently divergent — the gate and the continuation
  engine would then disagree about whether a run is finished, which is the C-085 wedge's
  neighborhood.
- **Fix direction:** gates-phase's inlining rationale ("core coupling stays on the single mandated
  sibling") is a layering preference purchased with a G6 violation; either import isTerminal, or
  add an equality test over the two arrays (stops.ts's is not exported either — export both),
  plus derive the python copy per SWEEP-VOCABULARY-007.

### SWEEP-VOCABULARY-004 — FanoutJob.priority is written at every dispatch site, read by nothing, and uniformly contradicts the wire truth

- **Severity:** MEDIUM
- **Pattern:** P3 (two sources for one fact) + the C-089 shape (a field grep finds no reader for)
- **Evidence:** `adapter/fanout.ts:66` declares `priority: string`; repo-wide grep finds **no
  reader** (`job.priority`/`.priority` appears nowhere in fanout.ts's logic, plugin, or
  router-client). Every dispatch site in `tools.ts` dutifully fills it — and every single one says
  `"interactive"` (12+ sites enumerated: classifier(mechanical), skeptic, planner, reviewer ×4,
  testWriter, implementer, skeptic ×2 …), while the ACTUAL §4.4 wire priority comes from
  `inject.ts ROLE_PRIORITY` via the chat.headers hook: testWriter/implementer/reviewer/skeptic →
  `"review"`, mechanical → `"batch"`. So the recorded intent and the wire behavior disagree for
  most dispatches, and neither the field nor the disagreement is tested.
- **NOT mutated:** the crisp proof (set one site to `"garbage-priority"`, watch everything stay
  green) requires editing `tools.ts`, which a concurrent reviewer was actively mutating; the
  no-reader grep plus the uniform-"interactive" enumeration carries the finding without it.
- **Fix direction:** delete the field, or make headersFor consume it (one source). If §4.1 means
  priority to be per-ROLE, the field is a lie; if per-JOB, ROLE_PRIORITY is.

### SWEEP-VOCABULARY-005 — The affinity/schema header names are config on the router side and constants on the sender side

- **Severity:** MEDIUM
- **Pattern:** P3 across a language boundary, with fail-soft absorption
- **Sites:** RouterConfig OWNS the names as data (`affinity.header`, `schema.observeHeader` —
  §2.2); the C++ router reads them from config (DERIVES; defaults restated at
  `router/router.hpp:99-102` kRole/kPriority/kGroup/kSchema constants). But the TS SENDER
  hardcodes all four: `adapter/inject.ts:239-245`. The default strings are restated again in
  `scripts/conductor_wiring.py:76-77` (ROUTER_AFFINITY_HEADER/ROUTER_SCHEMA_HEADER, the generator
  of the config the router reads), `conductor/tools/g5-equivalence.ts:218-219`, and fixtures on
  all three sides (`router/tests/config_test.cpp`, `admission_test.cpp`, `affinity_test.cpp`,
  `scripts/test_conductor_bench.py:57-59`).
- **Consequence:** §2.2 calls conductor-router.json "hand-editable". An operator who edits
  `affinity.header` desynchronizes sender and router: inject keeps sending `X-Conductor-Group`,
  the router groups on a header nobody sends, and affinity silently degrades to ungrouped — the
  fail-soft design absorbs the drift with no error anywhere. Same for `schema.observeHeader`
  (observation silently never fires). `X-Conductor-Role`/`X-Conductor-Priority` are constants on
  BOTH sides (inject.ts and router.hpp) with no guard spanning the compiler boundary.
- **Fix direction:** either the sender reads the same RouterConfig the router does (the plugin
  already probes the router at setup), or the operator-facing docs must state these two config
  keys are NOT actually hand-editable; a parity test in the python leg (which already reads
  RouterConfig.schema.json) could pin the TS constants against the generated config's values by
  grepping inject.ts — the composition.test.ts:823 technique.

### SWEEP-VOCABULARY-006 — The python→TS env-var contract is hand-spelled on both sides and drift is absorbed silently

- **Severity:** MEDIUM
- **Pattern:** P3 cross-language
- **Sites:** WRITER `scripts/conductor_wiring.py:612-618` sets `LLAMA_HARNESS_MODEL`,
  `LLAMA_HARNESS_URL`, `LLAMA_HARNESS_ROUTER_URL`; READER `conductor/plugin/index.ts:138-140`
  spells the same three names as ENV_* constants. No shared source, no test spans the boundary
  (test_conductor_wiring pins the python side only; nothing runs the plugin against a
  python-generated env).
- **Consequence:** a rename on either side does not error — `originOf` falls back to the §2.2
  defaults (`127.0.0.1:8088/8080`), so setup would silently probe the default ports instead of
  the session's actual ones. On a machine where the ports match anyway (the common case) the
  drift is invisible indefinitely; on any other it manifests as "setup can't find the router"
  with no hint that an env var name moved. C-089's env-var lesson (a var nothing reads) has a
  sibling here: a var whose reader silently stops reading it.
- **Fix direction:** same composition.test.ts:823 technique — a TS test greps conductor_wiring.py
  for the three `env["…"] =` assignments and asserts name equality with the plugin's constants.

### SWEEP-VOCABULARY-007 — conductor_bench.py restates STOP_KINDS and the terminal states with a same-language pin while the derivable exported schema sits unused

- **Severity:** MEDIUM
- **Pattern:** P3 cross-language; the guard that exists is a third hand copy, not a derivation
- **Sites:** `scripts/conductor_bench.py:79` `STOP_KINDS` ("verbatim" per its own comment — a
  comment is not a guard) and `:83` `TERMINAL_RUN_STATES`. The pin:
  `scripts/test_conductor_bench.py:1169` compares the python tuple to a FOURTH hand copy
  `{"done","noop","blocked","surfaced","env","interrupt"}`.
- **Mutation MUT-4:** dropped `"env"` from the python STOP_KINDS → python leg FAILED (1 failure,
  the 1169 pin). So python-side edits are caught. The UNGUARDED direction is TS-side widening: a
  seventh stop kind added in core/types.ts changes neither python file, and the bench then
  hard-errors at line 1033-1037 ("outside the closed stop vocabulary") the first time a live run
  ends with the new kind — during the 90-run POC campaign (14.2), the worst possible moment.
- **Fix direction:** the gate already exports `router/tests/schemas/Run.schema.json` fresh on
  every run, and `test_conductor_wiring.py` already derives RouterConfig parity from exactly that
  directory. Derive python STOP_KINDS from `Run.schema.json`'s `stop.kind` enum the same way.
  (Terminal states are not exported anywhere — one more cost of SWEEP-VOCABULARY-003.)

### SWEEP-VOCABULARY-008 — The M5 stub-scan patterns and core/planning.ts's placeholder patterns are a confessed one-rule-in-two-places, and the mirror is already partial

- **Severity:** MEDIUM
- **Pattern:** P3, self-documented
- **Evidence:** `scripts/conductor-gate.sh:63-65`: "The shapes below deliberately mirror the ones
  the PRODUCT pins for the same job at conductor/core/planning.ts:562-577. **If you change one,
  change both: this is the one-rule-in-two-places pattern that has already drifted six times in
  this build.**" No guard exists — the file simply asks the next editor to remember. And the
  mirror is already inexact: planning's TODO-marker arm makes the comment lead OPTIONAL
  (`(?:\/\/|#|\*)?`) where M5's REQUIRES one; planning carries TBD / to-be-determined /
  add-error-handling / similar-to-task-N / and-so-on arms M5 lacks; M5 carries `not implemented`
  which planning lacks. Some divergence is intentional (different corpora: plans vs source) but
  nothing records WHICH differences are intended, so the next drift is indistinguishable from the
  existing ones.
- **Fix direction:** extract the shared marker/placeholder shapes to one place both can read, or
  at minimum a test that extracts both pattern sets and diffs them against a committed
  intended-divergence list.

### SWEEP-VOCABULARY-009 — test-conductor.sh's file-conditional legs vanish silently when their restated filenames drift

- **Severity:** MEDIUM
- **Pattern:** P3 (restated filenames) enabling P1 (a gate that inspects less while passing)
- **Evidence:** `scripts/test-conductor.sh` gates three legs on file existence:
  `[ -f conductor/tests/bun-smoke.test.ts ]` (line 81 — the G14 dual-runtime leg),
  `[ -f conductor/tools/export-schemas.ts ]` (line 99 — §11.1 schema regeneration, which
  SWEEP-VOCABULARY-007's proposed derivations would also depend on), and
  `[ -f conductor/tsconfig.json ]` (line 64 — the M3 typecheck; this one at least FAILS if
  tsconfig exists but tsc is missing). Rename or move bun-smoke.test.ts or export-schemas.ts and
  the corresponding leg disappears from the gate with NO output change except an absent line —
  `GATE PASS` still prints. The bun-ABSENT case gets a loud WARN; the file-absent case gets
  silence. Contrast `verify-acceptance.sh` row 4, which hard-FAILS on a missing named guard file
  ("a renamed-away guard fails here instead of vanishing quietly") — the acceptance script knows
  this failure mode and the per-commit gate does not. Partial mitigation: acceptance row 2 and
  detector A would catch bun-smoke's absence, but acceptance is not run per commit; a renamed
  export-schemas.ts leaves router schemas stale on every gate run until the next acceptance run.
- **Fix direction:** in the gate, a missing expected file is a FAIL (the row-4 posture); the
  conditionals date from bootstrap phases that are long over.

### SWEEP-VOCABULARY-010 — One-directional compile guards mistaken for two-directional ones (satisfies / derived-key loops)

- **Severity:** LOW (each individually), systemic
- **Pattern:** P3 with a guard that checks only extras, never omissions
- **Instances:**
  - `core/stops.ts:12-19` STOP_KINDS `as const satisfies readonly StopKind[]` — an extra member
    is a compile error; a MISSING member compiles clean (consumers iterating "the same list the
    StopKind type is drawn from — nothing missing, nothing extra" per its comment would silently
    iterate a subset). No equality test against SCHEMAS.Run's stop.kind enum exists (the
    single-source.test.ts treatment covers run/item STATES only).
  - `core/decide.ts:19-25` SCORE_KEYS restates the five §2.7 score keys; `totalOf` sums over it.
    A sixth key added to DecisionRecord's score type would compile (SCORE_KEYS ⊂ keys is legal)
    and totalOf would silently under-sum every decision. The schema (types.ts:961-986) restates
    the five keys a third time.
  - `core/queue-amend.ts:31` AMENDABLE_ITEM_STATES is plain strings (`as const`, then cast to
    `readonly string[]` for `.includes`) — an ITEM_STATES rename (e.g. TEST_VETTED) leaves the
    stale name here, and isAmendable starts refusing a legal state with no compile error and no
    membership test.
- **Fix direction:** the pattern that already exists in the repo: an equality test reading the
  schema enum at runtime (single-source.test.ts) for STOP_KINDS; `satisfies` plus a
  length-equality static assert for SCORE_KEYS; type the amendable list `readonly ItemState[]`.

### SWEEP-VOCABULARY-011 — The seven-role vocabulary has no owner anywhere

- **Severity:** LOW as of today (every current copy agrees; behavioral pins exist), but this is
  C-082's home ground and the restatement count is the highest in the repo
- **Pattern:** P3, ownerless
- **Sites (all restating, none deriving):** `adapter/inject.ts` — THREE private maps whose keys
  are hand-repeated (ROLE_PACKS / ROLE_TEMPERATURE / ROLE_PRIORITY), each with a silent fallback
  (`?? ["core.md"]`, `?? 0.4`, `?? "interactive"`) that ABSORBS a key typo rather than surfacing
  it — a role misspelled in ROLE_TEMPERATURE quietly samples at 0.4 forever;
  `core/gates-edit.ts:105` READER_ROLES restates four + literal arms for
  orchestrator/implementer/testWriter (the exact site of C-082's `test-writer` drift);
  `adapter/tools.ts` ~15 dispatch-site literals; `adapter/chat-message.ts:77`;
  `plugin/index.ts:487,1097`; `adapter/continuation.ts` ×4; the kebab-case parallel vocabulary
  `conductor-<role>` in `opencode-fragment.json` (guarded by fragment.test.ts +
  test_conductor_wiring.py, both of which READ the real fragment); plan §4.1. Every role-typed
  field in the codebase is `string`. Note also: the classifier is dispatched as role
  `"mechanical"` — verified against plan identifier positions (§3.2 line 1077), NOT a drift;
  recorded here so the next reviewer does not re-derive it.
- **Fix direction:** `export const ROLES = […] as const` in core; type the three inject maps
  `Record<Role, …>` (omission becomes a compile error and the fallbacks become reachable only by
  genuinely-unregistered sessions); type FanoutJob.role and RegistryEntry.role as `Role`.

### SWEEP-VOCABULARY-012 — The gate subsets are stringly-typed, so the compiler checks none of the restated state literals in the two files that dispatch on them

- **Severity:** LOW
- **Pattern:** P3 enabling the C-082 failure shape
- **Evidence:** `GateRun.state`, `GateItem.state` (gates-phase.ts:57,67) and `RunLike.state`
  (stops.ts:33) are `string`, deliberately, so test fixtures assign structurally. The cost:
  `nextStageTool`'s switch, `isSettled`, `cannotEverPublish`, `legalTools`' state switch and
  stops' TERMINAL_STATES comparisons all compare `string` to hand-typed literals — a typo'd case
  arm is silently unreachable (exactly the C-082 mechanism), caught only if a behavioral test
  drives that exact arm. single-source.test.ts guards the ARRAYS, not these switches. MUT-3/MUT-5
  show the driven arms are pinned; the assurance is only as wide as gates-phase.test.ts's state
  coverage and must be re-earned per new arm.
- **Fix direction:** `state: RunState`/`ItemState` with fixtures using the exported arrays, or
  (cheaper) an exhaustiveness probe: iterate ITEM_STATES through nextStageTool and assert every
  non-terminal state yields a tool ∈ CONDUCTOR_TOOL_NAMES (also closes SWEEP-VOCABULARY-013
  mechanically).

### SWEEP-VOCABULARY-013 — Nothing structurally binds the 18 tool-name literals gates-phase emits to the 22-name inventory tools.ts owns

- **Severity:** LOW (pins exist; the structural guard is absent)
- **Pattern:** P3 with pin-only guarding
- **Evidence:** `core/gates-phase.ts:27-44` restates 18 of CONDUCTOR_TOOL_NAMES as local consts.
  MUT-5 (misspell CLASSIFY → "conductor_classifyy") went red in gates-phase.test.ts (+1) — the
  test pins each name via its own `T` map (a third copy, gates-phase.test.ts:71). So a lone drift
  is caught; a drift applied to gates-phase AND its test (the plausible shape: someone "renames a
  tool" in the gate and its test but misses tools.ts) is caught only downstream by whichever
  behavioral suite happens to drive that tool through the plugin's registered map. No test
  asserts `emitted names ⊆ CONDUCTOR_TOOL_NAMES`, which would be ~5 lines. TOOL_BINDINGS' 22 keys
  ARE structurally bound (tool-binding.test.ts:282-289 vs the registered map, which the plugin
  derives by iterating the inventory) — the technique exists one file over.

### SWEEP-VOCABULARY-014 — The closed journal vocabulary is not enforced in production at all

- **Severity:** LOW here (vocab lens); pointed to enforcement for weighing
- **Evidence:** `adapter/journal.ts:168` — `isProd = env.NODE_ENV === "production"`; the
  unlisted-event THROW is dev/test-only. In production an unlisted name is accepted rather than
  refused, so §7.4's "caught at its source" holds only where NODE_ENV is unset. The static audit
  is then the sole guard — see SWEEP-VOCABULARY-001 for the hole in it. Also note nothing in the
  repo sets NODE_ENV=production for the live harness, so today prod-mode is likely never active;
  the risk activates the day someone "hardens" the deployment env.

### SWEEP-VOCABULARY-015 — "Which failure classes are a legal red" is spelled three times

- **Severity:** LOW
- **Pattern:** P3 on a RULE (the settledForReport/C-037 class: "one rule living in two places has
  drifted four separate times in this build" — this one lives in three)
- **Sites:** `core/fsm-item.ts:85` (`failureClass !== "assertion" && !== "missing-subject"` →
  guard-reject), `adapter/evidence.ts:421` (`fc === "assertion" || fc === "missing-subject"`),
  `adapter/tools.ts:3474` (same disjunction inside submit_test's repair loop). Plus
  `core/fsm-item.ts:28` restates the FailureClass union itself as a hand-written type
  (one-directional: widening FAILURE_CLASSES in types.ts errors at the call seam; narrowing
  leaves dead vocabulary silently).
- **Fix direction:** `export function isLegalRedClass(fc: FailureClass): boolean` in core, three
  call sites — exactly the settledForReport consolidation already celebrated in gates-phase.ts.

### SWEEP-VOCABULARY-016 — setupLiveRunId restates the state-store layout by hand

- **Severity:** LOW
- **Pattern:** P3
- **Evidence:** `adapter/tools.ts:8977` composes `.conductor/state/current-run.json` and `:8987`
  `.conductor/runs/<id>/run.json` independently of `adapter/state.ts:255-269` (the owner), with a
  stated reason (reading through openWorkspace would take the very lock the guard tests). A
  layout rename in state.ts leaves the reconfigure guard reading nothing → `setupLiveRunId`
  returns null → **reconfigure proceeds under a live run**, the exact hazard the guard exists to
  prevent. Guarded today by setup.test.ts:2229-2230, which writes/removes the pointer under the
  canonical name (a third copy of the literal) and asserts the refusal. NOT MUTATED (tools.ts
  concurrency hazard, see caveat); the setup.test coverage reading is static.
- **Fix direction:** state.ts exports `currentRunPointerPath(root)` / `runJsonPath(root, runId)`
  helpers; tools.ts and setup.test both import them.

---

## 2. IDEA register

### IDEA-001 — Derive python STOP_KINDS/terminal states from the exported Run.schema.json
Origin: SWEEP-VOCABULARY-007. Kind: tooling. Value: converts the repo's weakest cross-language
copy into its strongest pattern (test_conductor_wiring already does this for RouterConfig; the
gate keeps the schema fresh). Cost: ~10 lines of python. Relates to: SWEEP-VOCABULARY-007, -003.

### IDEA-002 — export const ROLES in core; type the role maps Record<Role, …>
Origin: SWEEP-VOCABULARY-011. Kind: tooling. Value: a missing role key becomes a compile error;
the three inject fallbacks stop being drift absorbers. Cost: small, mechanical. Relates to: -011.

### IDEA-003 — Subset assertion: every name legalTools can emit ∈ CONDUCTOR_TOOL_NAMES
Origin: SWEEP-VOCABULARY-013. Kind: test-maintainability. Value: closes the both-copies-drift
hole with one loop over synthetic states (or just export the consts and compare). Cost: ~15
lines. Relates to: -013, -012.

### IDEA-004 — One string-aware stripComments shared by both source audits + a sentinel assertion
Origin: SWEEP-VOCABULARY-001. Kind: test-maintainability. Value: un-blinds the two highest-value
guards in the suite; the sentinel ("the audit sees tools.ts's config.updated site") makes the
next parser regression self-announcing. Cost: moderate (quote-state tracking). Relates to: -001.

### IDEA-005 — Gate legs fail loud on missing files (verify-acceptance row-4 posture)
Origin: SWEEP-VOCABULARY-009. Kind: tooling. Value: a renamed bun-smoke/export-schemas/tsconfig
becomes a red gate instead of a silently thinner one. Cost: trivial. Relates to: -009.

### IDEA-006 — Remove the dead 'tools/*' 'tools/**' globs in conductor-gate.sh
Origin: M5 read-through. Kind: polish. There is no top-level tools/ dir; the globs match nothing
and their zero blends into the CPP_N floor (router/* alone clears 10, so the floor cannot notice
tools/ appearing or vanishing). Either delete them or floor them separately. Cost: one line.
Relates to: standalone.

### IDEA-007 — Delete FanoutJob.priority (or wire it into headersFor)
Origin: SWEEP-VOCABULARY-004. Kind: naming/tooling. Value: removes a uniformly-false record of
dispatch intent. Cost: mechanical deletion across dispatch sites. Relates to: -004.

### IDEA-008 — Note the kebab↔camel role-name correspondence in opencode-fragment.json
Origin: inventory V15. Kind: docs. `conductor-test-writer` (fragment) vs `testWriter` (runtime)
is exactly the C-082 pair of spellings; nothing maps them in code today (inert), but a comment
naming the correspondence — or a fragment test deriving agent names from a ROLES list (IDEA-002)
— keeps the next reader from "fixing" one to match the other. Cost: trivial. Relates to: -011.

### IDEA-009 — Equality test: stops.ts STOP_KINDS vs SCHEMAS.Run stop.kind enum
Origin: SWEEP-VOCABULARY-010. Kind: test-maintainability. The single-source.test.ts treatment,
extended to the third vocabulary it skipped. Cost: ~10 lines. Relates to: -010.

### IDEA-010 — Shared constant for the journal rotation naming
Origin: inventory V13. Kind: polish. journal.ts (`journal.${n}.jsonl.gz`) and replay.ts
(ARCHIVE_PATTERN) each carry the spelling, each pinned by its own test (journal.test
[2.1-rotation] drives REAL rotation; replay.test [15.0] pins the reader) — adequate, but one
exported constant would make the pins redundant. Cost: trivial. Relates to: standalone.

### IDEA-011 — Update the stale "nothing to catch it" comment in conductor_wiring.py
Origin: inventory V28 verification. Kind: docs. conductor_wiring.py:65-68 claims the
DEFAULT_MAX_READERS duplication has "nothing to catch it", but composition.test.ts:823-835 now
reads the python source and asserts equality (an exemplary guard). The stale claim invites
someone to "fix" an already-fixed problem. Cost: one comment line. Relates to: standalone.

---

## 3. CROSS-LENS POINTERS

- **Enforcement (R1):** journal's unlisted-event refusal is disabled under NODE_ENV=production
  (journal.ts:168) — in prod the closed vocabulary is advisory (SWEEP-VOCABULARY-014 has detail;
  "what refuses in prod" is an enforcement question).
- **Enforcement (R1):** e2e.test.ts produced 2 spurious failures in exactly one of four runs
  during this sweep (identical tree each time modulo an inject.ts change the suite provably does
  not read). The flake-sweep instruction names fanout tests; e2e should be swept too.
- **Enforcement (R1):** verify-acceptance row 5 greps scenario names case-insensitively over the
  ENTIRE TAP output — "trivial" and "worktree" are common words; a renamed scenario could stay
  green off an incidental mention (P1 shape).
- **Enforcement (R1):** verify-acceptance detector A's "imported by at least one test" is
  implemented as "basename appears anywhere under conductor/tests/" (grep -rqF on the basename) —
  a comment naming the file satisfies it.
- **Enforcement (R1) / review runbook:** two review agents mutating one working tree concurrently
  produced contaminated full-gate verdicts and one agent's snapshot capturing another's live
  mutation (see caveat at top). The runbook should serialize mutation windows or give mutating
  reviewers separate worktrees — a review-machinery design issue, not etiquette.
- **Macro (R2):** types.ts's interface + hand-written-JSON-schema duality is a systemic,
  plan-mandated two-spellings pattern (every §2 schema exists twice in one file), guarded only by
  fixture round-trips in types.test.ts; whether one side should be generated from the other is a
  shape question for the macro review.
- **Macro (R2):** gates-phase.ts inlines terminality to avoid importing stops.ts on layering
  grounds (SWEEP-VOCABULARY-003) — the "core imports only its mandated sibling" rule is
  purchasing G6 violations; the tradeoff itself deserves a macro look.
- **Capability (R3):** the repo's strongest guards are all HAND-BUILT parity tests
  (single-source, tool-binding, composition.test:823's cross-language source-grep). A generic
  "vocabulary registry + parity harness" mechanism would make the next vocabulary safe by
  default instead of by artisanal test-writing.

---

## 4. Mutation table

| # | Mutation | File | Expectation | Result | Verdict |
|---|---|---|---|---|---|
| MUT-1 | Remove "plan.md" from REQUIRED_PACKS | adapter/inject.ts | loadPacks fail-closed guard fires | RED — inject.test [8.2-missing-pack] +1; init-dependent suites red (full-gate count contaminated by sibling mutation; scoped attribution clean) | Guarded (guard-fires only — the DELIVERY property is proven nowhere; P6 note) |
| MUT-1b | Add "extra-governance.md" to ROLE_PACKS.planner (not in REQUIRED_PACKS) | adapter/inject.ts | if guarded, something asserts delivered-set == declared-set | GREEN everywhere that could see it: inject 0, doctrine 0, wire-contract 0, fanout 0, tools-9.1 0, tools-9.2 0, e2e 0 (×2); composition/composition-root failures proven sibling's by control run after revert | **NOT caught — SWEEP-VOCABULARY-002** |
| MUT-2 | Drop "ANSWERED" from TERMINAL_STATES | core/stops.ts | pinned? | RED — stops.test +1, continuation.test +2 over baseline | Pinned per copy |
| MUT-3 | Drop "ANSWERED" from TERMINAL_RUN_STATES | core/gates-phase.ts | pinned? | RED — gates-phase.test +1 | Pinned per copy (no cross-copy guard — SWEEP-VOCABULARY-003) |
| MUT-4 | Drop "env" from python STOP_KINDS | scripts/conductor_bench.py | python pin fires | RED — test_conductor_bench 1 failure (line 1169 pin) | Pinned by a 4th hand copy; TS-side widening unguarded (SWEEP-VOCABULARY-007) |
| MUT-5 | CLASSIFY → "conductor_classifyy" | core/gates-phase.ts | pinned? | RED — gates-phase.test +1 (its own T-map literal) | Pinned; no structural subset guard (SWEEP-VOCABULARY-013) |
| MUT-7 | Remove "config.updated" from EVENTS.state | core/journal-events.ts | journal-vocab source audit red | **journal-vocab GREEN 7/7 (×2, clean tree; isKnownEvent probed false under mutation)**; only setup.test:2279's explicit pin red (+1) | **Audit hole — SWEEP-VOCABULARY-001** (root cause measured: stripComments blanks tools.ts lines 9104–9254 via `**/*.go` in a string) |
| MUT-8 | "queue.json" → "queue2.json" | adapter/continuation.ts:307 | behavioral red | RED — continuation.test +28 | Strongly pinned |
| (planned, NOT RUN) | "current-run.json" variant in setupLiveRunId | adapter/tools.ts | — | not mutated: tools.ts under concurrent mutation by another agent; static reading shows setup.test would catch (its own 3rd literal copy) | SWEEP-VOCABULARY-016, evidence static |
| (planned, NOT RUN) | dispatch priority → "garbage" | adapter/tools.ts | stays green (no reader) | not mutated: same tools.ts hazard; no-reader grep + uniform-value enumeration stands in | SWEEP-VOCABULARY-004 |

All mutated files snapshotted with `cp` to the session scratchpad before editing, restored from
those snapshots, and verified byte-identical with `cmp` (RESTORED logged per mutation). `git
status` at sweep end: only the pre-existing untracked docs paths. Nothing spawned beyond
`node --test` / `python3 -m unittest` (self-terminating); final `ps` check clean.

---

## 5. Coverage ledger

| File | What was done | Coverage | Conclusion / ids |
|---|---|---|---|
| conductor/core/types.ts | read whole (1,415 lines) | full | vocabulary root; interface/schema duality → macro pointer; -010 |
| conductor/core/journal-events.ts | read whole; mutated | full | V4; -001 (via its consumer), -014 |
| conductor/core/stops.ts | read whole; mutated | full | -003, -010 |
| conductor/core/gates-phase.ts | read whole; mutated ×2 | full | -003, -012, -013 |
| conductor/core/tool-bindings.ts | read whole | full | V8 — keys structurally guarded (tool-binding.test:282-289) |
| conductor/core/fsm-run.ts / fsm-item.ts | vocab exports + failure-class region | partial (vocab-relevant) | V1, V2 guarded by single-source.test; -015 (fsm-item:28,85) |
| conductor/core/decide.ts | SCORE_KEYS region | partial | -010 |
| conductor/core/queue-amend.ts | vocab region | partial | -010 (AMENDABLE_ITEM_STATES); AMEND_OP_KINDS switches exhaustive — clear |
| conductor/core/commit-message.ts | TRAILER_DENYLIST region | partial | owner-only, single site — clear |
| conductor/core/planning.ts | placeholder-pattern region | partial | -008 (pair with conductor-gate.sh) |
| conductor/core/gates-edit.ts | role-dispatch region | partial | -011 (READER_ROLES + role arms; C-082's site, currently correct) |
| conductor/core/gates-git.ts | vocab lists located | partial | git-verb classes owner-only; fragment's "git commit *" deny is a separate layer by design — clear at vocab level |
| conductor/core/schedule.ts, shell-parse.ts, freshness.ts, verdict.ts | scanned for vocab arrays | partial | GIT_WRAPPERS owner-only; freshness OWNS failure-class derivation, restates nothing; verdict.ts holds no vocab — clear |
| conductor/adapter/inject.ts | read whole; mutated ×2 | full | -002, -005, -011; V9, V10 |
| conductor/adapter/journal.ts | enforcement + rotation regions | partial | V4, V13; -014 |
| conductor/adapter/state.ts | path-vocabulary region | partial | V13 owner; -016 counterpart |
| conductor/adapter/evidence.ts | marker + failure-class regions | partial | V14 (C-081 fix HELD — single composition point); -015 |
| conductor/adapter/continuation.ts | UNIVERSAL_META_TOOLS + queue regions; mutated | partial | C-086 fix HELD (derived by probing legalTools under both publish modes); MUT-8 pinned |
| conductor/adapter/tools.ts | vocabulary-relevant regions only (dispatch sites, setup paths, config.updated, blanket-deny discovery); 9,253 lines NOT read end-to-end | partial — vocab lens | -004, -015, -016; the enforcement reviewer owns the full read |
| conductor/adapter/fanout.ts | priority + events regions | partial | -004; subsession.* events emitted via audited literal sites |
| conductor/adapter/chat-message.ts | registry region | partial | -011 |
| conductor/adapter/questions.ts | validation region | partial | V5 runtime-guarded (assertValidQuestion → validate) |
| conductor/adapter/quarantine.ts, worktrees.ts | layout-composition sites | partial | `<stateHome>/conductor/<key>/…` prefix repeated ×3 across 2 files — low risk, noted |
| conductor/adapter/config-io.ts | defaults + path region | partial | V28 pair GUARDED (composition.test:823 reads the python source) — exemplary; IDEA-011 |
| conductor/adapter/gitio.ts, router-client.ts | scanned for vocab | skimmed | no owned vocabulary found beyond git plumbing / HTTP paths — not examined deeply |
| conductor/plugin/index.ts | env-var, defaults, tool-map regions | partial | -006; V12; derives tool map from inventory (good) |
| conductor/tools/export-schemas.ts (+test) | test read; gate integration traced | partial | schema-name vocabulary DERIVED; gate regenerates per run — guarded |
| conductor/tools/replay.ts | naming/pattern regions | partial | rotation pair pinned both sides — cleared; IDEA-010 |
| conductor/tools/g5-equivalence.ts, g5-artifact-check.ts | header/port literals located | skimmed | restatement sites recorded under -005 / V27 |
| conductor/doctrine/*.md (9 files) | grepped for tool names | targeted | ZERO `conductor_*` mentions — doctrine cannot drift against tool names (cleared) |
| conductor/tests/ drift-guard files (single-source, journal-vocab, tool-binding, legaltools-callsites, export-schemas, fragment, doctrine, inject, setup, gates-phase, composition:823 region) | read the guard mechanisms | targeted | guards mapped; -001 found here |
| scripts/test-conductor.sh | read whole | full | -009 |
| scripts/conductor-gate.sh | read whole | full | -008; IDEA-006 |
| scripts/verify-acceptance.sh | read whole | full | restatement map (V29-V31); two R1 pointers |
| scripts/conductor_wiring.py | constants + env sections | partial | -005, -006, -007 context; V26-V28 |
| scripts/conductor_bench.py | vocab + run.json-reading sections; mutated | partial | -007 |
| scripts/test_conductor_wiring.py / test_conductor_bench.py | guard sites read | targeted | python pins mapped |
| scripts/serve.py, fetch_models.py, models_catalog.py, hostinfo.py, ui.py, benchmark.py, bench_presets.py | NOT examined (beyond serve.py env grep) | not examined | outside the conductor vocab surface except serve env plumbing (covered via wiring) |
| router/*.hpp, main.cpp | header/priority/health/config-key sites | partial | -005; priority wire values restated at admission.hpp:272, router.hpp:792-795; RouterConfig keys guarded via exported schema |
| router/tests/*.cpp | fixture literals located | targeted | fixtures restate defaults (normal pin usage) |
| router/tests/schemas/*.json | provenance verified | full | GENERATED by the gate from SCHEMAS — derived, not hand copies |
| conductor/opencode-fragment.json | read whole | full | V15 guarded both sides |
| docs/plans/…-conductor-harness-plan.md | targeted identifier-position greps (roles §4.1, classifier dispatch line 1077, agent names line 1776) | targeted | P10 discipline applied; classify-as-mechanical is per spec, not a drift |

Not covered anywhere in this sweep (owned by other step-2 agents): full tools.ts read, gates-git
attack surface, state-store crash behavior, router build/ctest, assertions.json rows.

---

## 6. Cleared areas (attacked and held)

- **Journal event vocabulary, dev-time design:** two-sided guard (runtime throw + source audit
  with pinned dynamic-site set + evidence-kind closure in both directions vs SCHEMAS). The DESIGN
  held everywhere except the one parser bug (-001); the live drives and the dynamic-site pinning
  survived scrutiny.
- **Run/Item state vocabularies:** single-source.test.ts binds fsm arrays to schema enums, both
  directions, reading the schema at runtime with anti-vacuity checks. Attack declined as
  already-proven by construction (set equality over non-empty sets).
- **Tool inventory (22):** plugin derives its map by iterating CONDUCTOR_TOOL_NAMES (and
  composition-root pins the iteration idiom in source); TOOL_BINDINGS keys structurally equal the
  registered map; gate-wiring pins the 22 names. MUT-5 confirmed the gates-phase pins fire.
- **verify-running-<tree>.json (C-081):** single composition point in evidence.ts (MARKER_PREFIX,
  markerPathOf, liveVerifyTrees); tools.ts imports rather than restates. The C-081 fix held.
- **UNIVERSAL_META_TOOLS (C-086):** now DERIVED by probing legalTools over a synthetic empty
  position under BOTH publish modes and intersecting. The C-086 fix held; continuation.test:5012
  additionally guards the export's existence.
- **PlanDecision / trivialItem shapes (C-081's zod-restatement class):** derived by construction
  in types.ts (Omit + schema-filter at 1018-1028; itemCoreProperties spread shared §2.4↔§2.10).
  Held on source reading.
- **Journal rotation naming:** writer pinned by journal.test [2.1-rotation] driving REAL
  rotation; reader pinned by replay.test [15.0]. Held without mutation.
- **DEFAULT_MAX_READERS / SUB_SESSION_TIMEOUT_MS cross-language pair:** GUARDED by
  composition.test.ts:823-835 reading conductor_wiring.py's source and asserting equality — the
  repo's exemplary cross-language drift guard; the pattern -005/-006/-007 should copy.
- **RouterConfig keys across TS/C++/python:** all three sides converge on the gate-regenerated
  RouterConfig.schema.json (config_test.cpp:129 loads it; test_conductor_wiring validates
  generated configs against it). Derived, guarded.
- **Kebab agent names:** fragment.test.ts and test_conductor_wiring.py both READ the real
  fragment and assert the seven names — drift red on either side.
- **Doctrine packs vs tool names:** zero `conductor_*` strings in any pack — the state block
  (derived from legalTools) is the only tool-name channel to the model. Nothing to drift.
- **Closed enum VALUES at write time:** every persisted record passes `validate(<Schema>)` whose
  enums derive from the single arrays (state.ts:398/549/577, evidence.ts:219, questions.ts:80,
  tools.ts:554/753/1462/7698/9212) — a typo'd origin/kind/state literal throws on the path that
  runs it (runtime guard, P12-bounded).

---

## 7. The vocabulary inventory (the enumeration)

Legend: OWNER = the site the fact should be read from; D = derives, R = restates; G = guarded,
G± = one-directional/pin-only/partial, G✗ = none.

| # | Vocabulary | Owner | Other sites (D/R) | Guard verdict |
|---|---|---|---|---|
| V1 | Run states (8) | core/fsm-run.ts:12 | types.ts:26 R (feeds schema enum) | G (single-source.test set equality) |
| V1b | Terminal-state subset (3) | **none** | stops.ts:65 R · gates-phase.ts:113 R · conductor_bench.py:83 R · plan | G± per-copy pins only → **-003** |
| V2 | Item states (7) | core/fsm-item.ts:15 | types.ts:59 R (schema) · switch/comparison literals in gates-phase, schedule, tools, continuation R | G (single-source) for arrays; G± for switches (string-typed) → **-012** |
| V3 | Stop kinds (6) | types.ts:39 | stops.ts:12 R (`satisfies` = G±) · write-site literals (runtime-validated) · conductor_bench.py:79 R (python pin) | **-010, -007** |
| V4 | Journal components (8) + per-component events | journal-events.ts | ~76 literal `.log` sites (audited) · 4 dynamic forwarders (pinned set) · evidence kinds computed (closed both ways vs schema) | G (best in repo) minus **-001**; prod off → **-014** |
| V5 | Question origins (6) | types.ts:87 | ~20 call-site literals R | G (runtime validate at write) |
| V6 | Failure classes (3) + the legal-red rule | types.ts:75 | fsm-item.ts:28 R (hand union) · rule ×3 (fsm-item:85, evidence:421, tools:3474) | G± on type, G✗ on rule → **-015** |
| V7 | Roles (7) | **none** | inject ×3 map keysets R · gates-edit R · tools ~15 R · chat-message R · plugin R · continuation R · fragment kebab forms R | G± behavioral pins; typo-absorbing fallbacks → **-011** |
| V8 | Tool names (22) | adapter/tools.ts:97 | plugin D (iterates) · tool-bindings keys R (G structural) · gates-phase 18 consts R (G± pins) · test pins | G mostly; gap → **-013** |
| V9 | Doctrine pack filenames (9) | inject.ts REQUIRED_PACKS (de facto) | ROLE_PACKS values R · doctrine.test R · inject.test PACK_FILES R · verify-acceptance detector B R (5 copies total) | G one direction only → **-002** |
| V10 | X-Conductor-* header names (4) | RouterConfig (Group/Schema); none (Role/Priority) | inject.ts R (sender constants) · router.hpp R · wiring.py R · g5-equivalence R · fixtures ×3 languages R | G✗ cross-language → **-005** |
| V11 | Priority wire values (interactive/review/batch) | none | RouterConfig priorities keys · inject ROLE_PRIORITY values R · admission.hpp:272 + router.hpp:792 parse R · dead FanoutJob.priority R | G✗ → **-004, -005** |
| V12 | Env vars (LLAMA_HARNESS_MODEL/URL/ROUTER_URL, LLAMA_HARNESS_DOCTRINE_DIR, CONDUCTOR_LOG, NODE_ENV, XDG_STATE_HOME, LLAMA_ROUTER) | writer/reader split | wiring.py writes ↔ plugin reads (R both sides); CONDUCTOR_LOG+NODE_ENV owner=reader (journal.ts) — fine | G✗ cross-language with silent fallback → **-006** |
| V13 | Run-dir & state filenames (run.lock, current-run.json, stale-red.json, alive.json, halt, run.json, queue.json, evidence/decisions/anomalies/questions.jsonl, journal.jsonl + rotation, plan.md, report.md) | state.ts / journal.ts / evidence.ts / tools.ts (writers) | tools.ts setupLiveRunId R (**-016**) · continuation queue.json R (MUT-8 pinned) · replay R (pinned) · python bench readers R (schema keys too) · verify-acceptance R | mixed — itemized in -016 / -007 / V29-V31 |
| V14 | verify-running-<tree>.json | evidence.ts:643 | tools.ts D (imports) | G (single composition point) — C-081 held |
| V15 | Agent names (7 kebab) | opencode-fragment.json | fragment.test reads+asserts · py test reads+asserts | G (both sides read the fragment) |
| V16 | Decision score keys (5) | types.ts DecisionRecord | decide.ts SCORE_KEYS R · schema R | G± → **-010** |
| V17 | Severities (major/minor/nit) | types.ts:98 | findings-handling literals R | G (runtime validate at fan-out parse) |
| V18 | Amend ops (3) / amendable states (4) | queue-amend.ts | ITEM_STATES subset R | ops exhaustive; states G✗ → **-010** |
| V19 | Git verb classes (READ_ONLY_SIMPLE/STAGING/DESTRUCTIVE/BRANCH_MUTATING) | gates-git.ts | fragment permission globs (separate layer, by design) | owner-only — clear |
| V20 | Commit trailer denylist | commit-message.ts:19 | test pins | G |
| V21 | Shared-tree slug "main" | none | evidence.ts:804 default R · tools.ts:2356 STAGE_TREE R | G± behavioral — low risk, noted |
| V22 | stateHome layout (conductor/<key>/{quarantine,worktrees}) | none | quarantine.ts ×2 · worktrees.ts ×1 | G✗ but independent subtrees — noted |
| V23 | Stub/placeholder patterns | planning.ts ↔ conductor-gate.sh (confessed pair) | — | G✗, self-documented → **-008** |
| V24 | Schema names (18 SCHEMAS keys) | types.ts SCHEMAS | export-schemas D · router/tests/schemas D (regenerated per gate run) | G (regeneration) |
| V25 | RouterConfig keys | types.ts (via exported schema) | config.hpp parse (validated against schema) · wiring.py generator (validated) | G (schema parity, both consumers) |
| V26 | /conductor/health path | none | admission.hpp kHealthPath · wiring.py R · g5-equivalence R | G✗ compile-level; live integration self-checks at serve time — LOW |
| V27 | Default ports 8088/8080 | wiring.py (de facto) | plugin DEFAULT_ROUTER_PORT/UPSTREAM R (comment acknowledges) · fixtures R | G✗; failure mode = probe misses and setup reports — LOW |
| V28 | maxReaders=6 / subSessionTimeoutMs=900000 | wiring.py | config-io.ts R | **G (composition.test:823 reads python source)** — exemplary |
| V29 | e2e scenario names (5) | e2e.test.ts | verify-acceptance row 5 R | G± (loose grep — R1 pointer) |
| V30 | §1.1 module list | plan | verify-acceptance detector A R (closed list) | G± (weak "named by a test" — R1 pointer) |
| V31 | Gate-leg filenames | the files themselves | test-conductor.sh R with `[ -f ]` vanish · verify-acceptance R with fail-loud | → **-009** |
| V32 | Test-glob conventions (`conductor/tests/**/*.test.ts`, `test_*.py`) | test-conductor.sh | zero-match floors present (TESTS>0, PY_RAN≥1) | G (floors) — clear |
| V33 | Shell GIT_WRAPPERS (env/command/sudo/builtin/exec) | shell-parse.ts:145 | — | owner-only — clear |
| V34 | Log levels (5) | types.ts:22 | journal thresholds D (typed) · config schema D | G (typed + schema) — clear |
| V35 | Config enums (git modes, branch policies, dirty modes, format modes, parallel modes, ponytail levels, ladder rungs) | types.ts | call-site literals R (runtime-validated via validate("Config")/setup §9212) | G (runtime) — clear |

---

*(end of sweep — the caveat at the top governs how to read every full-gate number in §4)*
