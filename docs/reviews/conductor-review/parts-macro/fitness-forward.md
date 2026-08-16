# Macro Review — Part F: Fitness for What Comes Next

**Reviewer scope:** Part F of the step-3 macro charter (`3-macro.md` §Part F) — fitness for live
model contact (13.2, 14.2), growth to 2× tasks / 2× tools / a second router backend, what a second
contributor or second orchestrating agent needs, and whether the system's own growth is sustainable.

**Date:** 2026-08-16
**Evidence base:** `docs/reviews/conductor-review/findings-enforcement.md` (step-2 output, cited as
ISSUE-NNN), `docs/build/specs/task-13.2.assertions.json` and `task-14.2.assertions.json` (read in
full), `docs/plans/2026-08-14-conductor-addendum-phases-16-19.md` (read in full — it is the literal
"what comes next"), and direct measurements run this session (greps, line counts, git history).
Every finding cites a measurement, a ≥3-correction pattern, or a step-2 defect with a structural
cause — or is labelled OPINION.

---

## Verdict for this lens (short)

**The system is not fit for its next two tasks in its shipped state, and the build's own records
prove it in advance.** Both step-2 CRITICALs (ISSUE-001: the injection layer is dead; ISSUE-002:
the default config denies every sub-session write) are *live-contact-only* defects: 1,382 tests,
17 acceptance rows and eleven phase gates could not see them, and 13.2 is the first thing that
will. Unless the first-contact blockers are fixed **before** the smoke, 13.2 will spend its entire
live budget rediscovering step 2's register, and 14.2's campaign will burn an overnight window on
90 cells that cannot spawn a process (ISSUE-107) and produce a report whose central comparison is
already invalid (FITNESS-FORWARD-004: the conductor arm currently delivers *less* doctrine than
the doctrine arm it is supposed to superset).

On growth: the addition surfaces are measurable and they are bad in a specific way — adding a tool
touches five files and the author of the Phases 16-19 addendum, with full context, missed two of
them (FITNESS-FORWARD-006); every appended `tools.ts` handler lands in the span the repo's own
source audits are blind to (ISSUE-088 → FITNESS-FORWARD-007); and the record regime that is
supposed to absorb the next ~12 addendum tasks demonstrably stopped keeping up at task ~40 of 52
(FITNESS-FORWARD-010). A second orchestrating agent is unsupported in fact, not just in caveat
(FITNESS-FORWARD-009).

None of this says the *design* cannot go live — the enforcement spine step 2 cleared is real. It
says the scheduled order of what comes next is wrong: roughly six specific fixes are on the
critical path of everything scheduled, and the two live tasks are currently sequenced to discover
them expensively instead of inheriting them cheaply.

---

## Section 1 — First contact with a live model: where 13.2/14.2 will break, in order

This is a prediction grounded entirely in reproduced step-2 defects and the two live-task specs.
The predicted failure chain for 13.2, in the order the operator will hit it:

1. **Launch (serve.py).** The router launch leg of `serve.main()` has never been executed by any
   test — two mutations that break every real router session (`router_port`/`port` swap → the
   router proxies itself; deleted supervisor-stop fallback → a failed router restarts forever)
   survive the full 80-test python leg (ISSUE-106). `wait_until_ready` is reached by no test
   (ISSUE-108). 13.2 is the first execution of this code. It may work; nothing has ever checked.
2. **The operator's first Ctrl-C.** Reproduced twice under a pty: Ctrl-C at the session prompt —
   the ordinary way to abandon a half-typed command — runs the cleanup trap, kills the 20+ GB
   model, and leaves the shell alive pointing at a dead upstream (ISSUE-105). The smoke's operator
   will do this within the first hour.
3. **The first sub-session write.** Shipped default is `parallel.writes: "off"`
   (`config-io.ts:116`, verified this session). Under it the registry hands the edit gate the
   slug `"main"`, `normalizeUnderTree` returns null, and **every** testWriter/implementer write is
   denied — reproduced end-to-end through the real plugin (ISSUE-002). The slugify item can never
   capture a RED (no test file can be written; `redAdmission` refuses a zero-test red), the run
   stalls, the futile counter fires, and the smoke's first work run ends `noop` having done
   nothing. This is a hard stop for both 13.2 prompts and for every `conductor`-arm cell in 14.2.
4. **Doctrine, the state block, sampling, and router tags never arrive.** No
   `chat.system.transform` / `chat.params` / `chat.headers` hook is registered (ISSUE-001). The
   orchestrator model runs with `core.md` only via the agent-prompt binding, no live state block,
   no recommended-next-tool; sub-sessions get the `tools.ts` paraphrases only; per-role
   temperatures are never applied; no `X-Conductor-*` header is ever sent. Consequences for the
   smoke's own assertion rows are itemized in FITNESS-FORWARD-002/003 below — several rows are
   structurally UNMET before the model answers a single prompt.
5. **A flailing model meets ungated meta tools.** With no state block, a 27B model that loses the
   thread must guess. The stage tools will refuse it (the phase gate binds), but `classify`,
   `defer`, `answer`, `report` are guarded by nothing (ISSUE-005): the reproduced consequences —
   re-classify clobbers `queue.json` and resets a GREEN item; defer-all→report closes `done` from
   DECOMPOSED; self-answering a blocking question — are exactly the moves a lazy or confused model
   makes when it is not told what is next. The dead advisory channel and the missing mechanical
   gate are two halves of one hole (P7), and live contact is where they compose.
6. **Any run that waits on a human ends wrongly.** `blocked`/`surfaced` are computed and written
   by nothing (ISSUE-065); a blocked item with a dependent ends `noop`, the run archives, and the
   documented `conductor_answer` resume path is dead (ISSUE-066, reproduced). The 13.2 TUI flow is
   *built around* interactive asks (SG-B chooses the TUI precisely because setup asks two
   no-default questions), so the smoke will produce blocked states routinely and record wrong
   endings for them.
7. **Under parallel load, enforcement itself flickers.** The full gate is nondeterministically red
   on unmutated HEAD, and two of the three observed failure shapes are the *product* enforcing
   differently under load — a stale-red advance, a schema refusal not thrown (ISSUE-134,
   same-millisecond clock collisions). A live smoke on a laptop simultaneously running a 27B model
   is the high-load regime. Expect enforcement anomalies that no scoped test will reproduce
   afterwards.
8. **The pinned model itself.** The build's one recorded observation of the G13 model under
   constraint (F1-CONFIRMED, via ISSUE-085) is 1024 tokens of thinking and empty content. If
   qwen3.6-27b does that against `CLASSIFICATION`-schema requests, `extractReplyText` returns "",
   the fan-out burns its `MAX_ATTEMPTS = 3` with zero backoff, and items env-fail. The
   `13.2-schema-retries` row is the headline §11 measurement; the retry budget it measures has
   never met the model it is budgeted for.

For 14.2 the chain is shorter and harder: **(a)** every cell spawn fails with `[Errno 2]` because
`build_cell_env` omits PATH and the preflight checks the driver's PATH, not the cell's
(ISSUE-107, reproduced with the production functions) — 90/90 cells record `harness-error`,
and the driver writes a complete report over zero real cells; **(b)** even a flawless campaign
fails acceptance, because `verify-acceptance.sh:163` hardcodes
`docs/build/artifacts/conductor-report.md` while the assertions fix `bench/conductor-report.md`
and the driver emits to `.data/benchmark/` — the three-way conflict C-075 ordered fixed and no
task ever landed (ISSUE-078); **(c)** the fabrication cost for the exact two artifacts that remain
is ~15 seconds against the operator meter (ISSUE-093), and unlike G5 there is **no standing node
checker** for SMOKE.md or conductor-report.md — the one class of task left is the one class the
meters cannot defend.

The findings below turn this chain into structural records.

---

## Section 2 — Scaling: 2× tasks, 2× tools, a second router backend

Measured positions, argued in the register entries cited:

- **2× tools:** `tools.ts` is 9,253 lines holding ~15 handlers plus setup and HTTP plumbing; both
  scheduled additions (addendum 17.3 `conductor_clarify`, 18.1 `conductor_artifact`) append
  handlers there. Every line appended after 9104 is invisible to the repo's two source audits —
  the `stripComments` quote-blindness blanks 9104→EOF (ISSUE-088, reproduced both directions).
  Growth lands, by construction, in the audit's blind spot. → FITNESS-FORWARD-007.
- **2× tasks:** the per-task record regime measurably decayed under the *current* load: the M1–M9
  gate ledger silently ends at task 11.8 (11 COMMITTED rows recordless, ISSUE-083);
  `coveredByTest` is dead on 548/795 rows — populated for tasks 0.1–9.1, null from 9.2 on
  (ISSUE-081); the four status surfaces describe four different presents (ISSUE-082); the
  assertion-ledger convention changed three times over the build (step-2 cross-lens pointer). The
  addendum adds ~12 more tasks onto this. → FITNESS-FORWARD-010.
- **A second router backend:** `RouterConfig.upstream` is a single `Endpoint` (config.hpp:84,
  verified) — a second backend is a schema + C++ change, and the TS→C++ schema contract is
  guarded by no automated step (the CMake export deferred at 11.1 never landed; a `RouterConfig`
  change sails through the full gate green while the router refuses to start — ISSUE-043). A
  second *model* makes ISSUE-042 live: admission caps per client-controlled model string while the
  pool is sized for one, reproduced as a health-endpoint starvation. The sender's four header
  names are constants while the router's are config (ISSUE-117). → FITNESS-FORWARD-012.
- **2× roles / vocabularies:** measured addition costs in FITNESS-FORWARD-008 — a role is ~9
  restatement sites across ~7 files, two of which fail silently (typo-absorbing `??` fallbacks,
  and ROLE_PACKS entries no test can see — ISSUE-114 reproduced); a stop kind is 5 sites, and the
  step-2 mutation showed missing the python one hard-crashes the live campaign mid-run
  (ISSUE-113).

---

## The FITNESS-FORWARD register

### FITNESS-FORWARD-001 — Live contact was structurally deferred to the end of the build, so every integration-truth defect ships as a surprise for the two remaining tasks

**THE OBSERVATION.** 50 of 52 manifest tasks are COMMITTED, the gate is 1,382 node tests green,
phase gates 0–11 PASS — and step 2 found **two CRITICALs (ISSUE-001, ISSUE-002) plus at least
four HIGHs (ISSUE-105, -106, -107, -108) that only live contact can surface**. The e2e suite's
fake SDK writes fixture files directly, so no legitimate write ever needs the hook's permission
(ISSUE-091: not one e2e row asserts an ALLOW through the real gate); `composition-root.test.ts`
gives every item a worktree, so the shipped default (`writes:"off"`, no worktree) is composed by
no test; and no task in the §8 manifest ever registered the §6.4 hooks, so their absence was
faithful to the manifest across all 52 tasks. The manifest's only live tasks are the last two.

**THE CONSEQUENCE.** Already happened, twice over: (a) a system whose thesis is "doctrine injected
into every request" shipped with the injection layer dead and no gate noticed — for the entire
build; (b) a system whose default config cannot execute a single sub-session write passed 17 of 21
acceptance rows. Prospectively: 13.2's Step-2 mechanism (every defect found becomes its own
red→green task-let) will be forced to absorb the step-2 register item by item at live-smoke
prices — with an operator waiting on a 27B model — instead of at review prices.

**WHY IT IS STRUCTURAL NOT LOCAL.** Fixing ISSUE-001 and ISSUE-002 does not fix it: any future
subsystem (the addendum adds four) will again be built green against fakes for ~12 tasks before
anything live touches it. The cause is the build *shape*: live contact is a phase (13/14), not a
leg. Contrast the one place the build did wire-level verification early — Task 0.2's wire-notes —
which is precisely why the hook API's *availability* was known even while nothing used it.

**WHAT A BETTER SHAPE LOOKS LIKE.** A standing live-ish leg in the gate: a real opencode process
with a stub OpenAI-compatible provider (a 50-line HTTP fixture), driven once per gate run through
plugin load → hook registration → one gated ALLOW write → one doctrine-bearing request captured at
the stub. That single leg would have gone red on ISSUE-001 (no system transform arrives at the
stub), ISSUE-002 (the write is denied), and ISSUE-091's gap (no ALLOW row) the day each was
introduced. Migration cost: moderate — the wire fixtures exist in `wire-notes.md` form; the cost
is one fixture provider plus ~5 assertions, and gate wall-clock (+~10s). It does not need a model:
the stub can return canned schema-valid JSON.

**PLAN IMPACT.** Re-sequence what comes next: land the fixes for ISSUE-001/002 (plus -105/-107)
as ordinary reviewed tasks **before** 13.2, so the smoke measures the model rather than
rediscovering the wiring. 13.2's spec already permits this shape (Step-2 task-lets), but the
spec's own SG-A resolution needs revision first (see FITNESS-FORWARD-002).

**WHAT WOULD CHANGE YOUR MIND.** A demonstration that the existing gate *could* have caught
ISSUE-001/002 with in-process tests alone — e.g. a committed test that drives the real plugin's
returned-hooks object and asserts a system transform reaches a captured request. If such a test
is cheap and sufficient, the "live leg" claim weakens to "one more in-process test", and this
finding downgrades to the ISSUE-091 fix direction.

---

### FITNESS-FORWARD-002 — The 13.2 spec is now specified against a channel that does not exist; authored at HEAD 75a2531, it is 142 commits stale with no re-verification mechanism

**THE OBSERVATION.** `task-13.2.assertions.json` records `verifiedAgainstHead` at 75a2531; HEAD is
ce05498, **142 commits later** (measured). The spec's SG-A resolution lands the §3.8 banner as
"the FIRST line of the live state block" (`renderStateBlock`), with an inject.test.ts case and a
core.md instruction — but the state block **reaches no session** (ISSUE-001: `buildSystemAppend`
has zero production callers). Its `reusesExisting` row calls the doctrine packs "injected
verbatim" and calls the smoke "the first live proof that the per-role X-Conductor-* headers
(headersFor, :220) actually reach the router" — headersFor is dead code in production. Row
`13.2-banner-landed` as written can go green at unit level (the inject test passes, the doctrine
anchor passes) while the banner never appears in any live session — the P6 shape, in a spec.

**THE CONSEQUENCE.** Tied to what has already happened: this same staleness class is recorded as
ISSUE-078 (C-075's mandated 14.2 spec revision never landed) and ISSUE-085 (row names a
model/vehicle that is not what ran). Prospectively, an implementer executing 13.2's SG-A as
specced will spend a task-let landing a banner into a dead channel, watch it not appear, and
burn live-smoke time debugging a defect step 2 has already reproduced and named. Rows
`13.2-router-ledger` (b: role headers vary) and the banner half of `13.2-banner-landed` are
structurally UNMET at HEAD; `13.2-idle-continuation` depends on the continuation engine whose
silent-failure doors (ISSUE-033/034) have no floor.

**WHY IT IS STRUCTURAL NOT LOCAL.** Correcting this one spec does not fix it: the spec system has
no currency contract. `verifiedAgainstHead` is a one-shot claim that silently rots (the exact
shape as ISSUE-082's four-presents record surfaces); nothing flags that the files a spec cites
have changed under it. Two live-task specs existed; both are stale in load-bearing ways
(this finding and ISSUE-078). 2/2 is a pattern for the only spec class whose execution is
expensive.

**WHAT A BETTER SHAPE LOOKS LIKE.** (a) A spec-currency check: each assertions.json already names
the sha it was verified against; a ~30-line gate leg lists cited `file:line` anchors whose files
changed since that sha and flags the spec for re-verification. (b) For 13.2 specifically: a
pre-smoke revision pass that re-verifies every `verifiedAgainstHead` row against the post-fix
HEAD, re-grounds SG-A in whatever channel the ISSUE-001 fix makes real, and adds the step-2
first-contact list as explicit go/no-go preconditions. Migration cost: small — one script plus one
authoring pass over two files.

**PLAN IMPACT.** 13.2 must not start from the spec as committed. The revision is a prerequisite
task, cheap, and it converts the step-2 register into the smoke's checklist instead of its
obituary.

**WHAT WOULD CHANGE YOUR MIND.** If the intended 13.2 workflow is that the orchestrator re-derives
the spec against HEAD before running (and the spec's own `authoredBy` discipline suggests the
capability exists), then the staleness is procedural, not structural — show me the standing
instruction that says a live spec is re-verified before execution, and this downgrades to an
IDEA about writing that instruction down.

---

### FITNESS-FORWARD-003 — 14.2's campaign will fail on launch mechanics, and even a flawless run fails acceptance: four reproduced defects sit between the driver and a meaningful report

**THE OBSERVATION.** Four step-2 findings compose against the 90-cell campaign: (1) `build_cell_env`
returns seven vars and no PATH; `run_command` uses it as the child's entire env; bare `opencode`
resolves against `os.defpath` and fails `[Errno 2]` — reproduced with the production functions,
and the preflight (`check_commands_spawnable`) approves against the *driver's* PATH, so the go/no-go
passes while every cell dies (ISSUE-107). (2) `verify-acceptance.sh:163` hardcodes
`POC=docs/build/artifacts/conductor-report.md`; the assertions fix `bench/conductor-report.md`;
`conductor_bench.py:45` emits under `.data/benchmark/` — a three-way path conflict, the fix C-075
mandated and nobody scheduled (ISSUE-078). (3) The bench cell config is a third hand-spelling of
`maxReaders`/workflow defaults — the step-2 mutation set `maxReaders→60` *and* `git.mode→read-only`
and all 33 tests stayed green (ISSUE-112); a drift here either serializes upstream or scores every
run as a failure. (4) The acceptance meter accepts a fabricated report shape in ~15 seconds and,
unlike G5, **no standing node checker exists for conductor-report.md or SMOKE.md** (ISSUE-093) —
the two artifacts left to produce are the two the meters cannot defend, under the build's own
declaration that fabricating them is its worst-case failure.

**THE CONSEQUENCE.** Already happened in miniature: the 11.8 live smoke left two LIVE rows
discharged by nothing with M7/M8 recorded PASS (ISSUE-076) — the meters did not hold the last
live artifact to its rows either. Prospectively: an overnight window burned on 90 `harness-error`
cells (SG-H's stop rule at least prevents a false report if followed), then a re-run, then an
acceptance FAIL on path grounds after a successful campaign.

**WHY IT IS STRUCTURAL NOT LOCAL.** The individual fixes are one-liners, but three of the four are
*recorded-debt-never-scheduled* (the dominant meta-pattern of step 2's correction sweep:
ISSUE-078, -100, and C-067's unwired sites) — the structure that loses them is the absence of an
owed-items ledger with owners (IDEA-PROC-1). And (4) is the checker-ships-before-artifact
principle (IDEA-STRUCT-8) not being a rule: G5 got a standing checker only after C-089 burned it.

**WHAT A BETTER SHAPE LOOKS LIKE.** A 14.2 pre-launch gate, mechanical, run before any compute:
spawn one cell end-to-end against a trivial task (proves PATH, config, resume); run
`verify-acceptance.sh` against a planted dummy report at the path 14.2 will actually use (proves
the path contract before the campaign, not after); land the standing node checker for the report
(pin the required sections, the 90-cell arithmetic, the denominators) **before** the campaign.
Migration cost: small — the resume-proof row (`14.2-resume-proof`) already mandates a one-cell
rehearsal; extend it to a full spawn.

**PLAN IMPACT.** Insert `14.2-pre` fixes: ISSUE-107 (PATH), ISSUE-078 (the second-path clause
C-075 specified), ISSUE-112 (derive cell config from `conductor_wiring`), plus the report checker.
All are sub-hour changes; all are on the campaign's critical path.

**WHAT WOULD CHANGE YOUR MIND.** Run `python3 -c` against the committed
`build_cell_env`/`run_command` and show a cell spawn succeeding — if the composition differs from
step 2's reproduction (e.g. the driver passes `env=None` on some path), (1) collapses and this
finding reduces to the path conflict and the checker gap.

---

### FITNESS-FORWARD-004 — The POC's arm design is already broken at HEAD: the `conductor` arm delivers LESS doctrine than the `doctrine` arm it must superset, so the experiment's headline comparison cannot mean what it claims

**THE OBSERVATION.** The three-arm design (plan:2992-2994, quoted in the 14.2 spec) is nested by
construction: `baseline` = model alone; `doctrine` = model + packs as a system prompt (driver
injects them, no plugin); `conductor` = the full pipeline, which per §6.4 *includes* doctrine
injection plus enforcement. The point of `doctrine vs conductor` is to isolate what enforcement
adds **over the same doctrine**. But at HEAD the conductor arm's injection layer is dead
(ISSUE-001): its orchestrator gets core.md only via the agent binding, its sub-sessions get
hand-paraphrases of 3 of 9 packs (ISSUE-003), `receive-review.md`/`test-vet.md` reach nobody, and
no live state block or per-role sampling exists. The doctrine arm, whose packs are injected by the
*driver*, delivers all nine packs verbatim. The nesting is inverted: doctrine ⊃ conductor on the
doctrine axis.

**THE CONSEQUENCE.** The campaign's central claim — "did the enforcement machinery earn its cost?"
(the spec's own words for the doctrine-vs-conductor comparison) — is unanswerable from the data as
the arms would actually run: any conductor-arm deficit is confounded between "enforcement cost"
and "missing doctrine". Additionally, two report columns are corrupted before launch: "review
findings caught" reads a `reviews/<id>-r<N>.json` that nothing writes — structurally 0 for every
live cell, rendered as a measured zero (ISSUE-104), which is precisely the "it ran and found
nothing" false claim row `14.2-arm-inapplicable-nulls` forbids; and the terminal stop-kind
distribution — SG-K's *only* discriminator between a wiring failure and a quality failure — cannot
say `blocked`/`surfaced` because nothing writes them (ISSUE-065), so blocked runs read as
`done`/`noop` and wiring failures masquerade as process outcomes.

**WHY IT IS STRUCTURAL NOT LOCAL.** Fixing ISSUE-001 fixes the arm nesting — but the finding is
about the *measurement design's* dependence chain: 14.2 is the build's terminal deliverable and
its validity rests on ISSUE-001 + ISSUE-104 + ISSUE-065 + ISSUE-107 being fixed first, a
dependency recorded nowhere. The plan treats 14.2 as "just run 14.1's driver"; in fact it has
four unbuilt prerequisites, and no mechanism exists that computes such prerequisite chains from
the defect register (the same absence that let C-075's owed revision rot — ISSUE-078).

**WHAT A BETTER SHAPE LOOKS LIKE.** A one-page "14.2 validity preconditions" note in the addendum
or STATE.json: the four issues above as named blockers, each with the row it corrupts
(`14.2-arm-integrity` (b) even hands the test: the doctrine arm's anchor-line check against the
conductor arm's actual system prompts would expose the inversion). Migration cost: trivial to
write; the fixes themselves are already specced by step 2.

**PLAN IMPACT.** 14.2 must be scheduled after ISSUE-001's fix lands and after ISSUE-104's metric
is re-pointed at a source that exists, or the report must carry an explicit "the conductor arm ran
without §6.4 injection" disclosure — which would honestly gut the headline.

**WHAT WOULD CHANGE YOUR MIND.** Evidence that the 14.1 driver injects the packs into the
conductor arm's sessions *itself* (making the arms nested regardless of the plugin's dead layer).
I checked the arm definitions in the spec (SG-F: conductor arm = "loads the plugin", no
driver-side injection) and found none, but the driver's cell-config assembly is 14.1's code and a
deliberate compensation there would collapse the nesting half of this finding (the ISSUE-104 and
ISSUE-065 column corruptions stand regardless).

---

### FITNESS-FORWARD-005 — One unshipped mechanism (the stop-kind writer) sits on the critical path of all three scheduled next steps

**THE OBSERVATION.** §2.9 defines six stop kinds; the composed system can write four —
`blocked`/`surfaced` are computed by `shouldTerminate` and written by nothing (ISSUE-065, the
delegation ring enumerated exhaustively in step 2). Three scheduled consumers depend on the
missing two: (1) 13.2's row `13.2-report` must record the stop kind for a run that blocks on the
smoke's interactive asks — it will read `done` or `noop` for a waiting run; (2) 14.2's SG-K uses
the conductor arm's stop-kind distribution as its wiring-vs-quality discriminator (see
FITNESS-FORWARD-004); (3) the addendum's Task 17.4 acceptance is explicit — *"a blocked run emits
no re-prompt and stops `surfaced`"* — an acceptance row that is **unsatisfiable at HEAD** (the P8
shape: a row the product cannot reach), because `handleReport` hardcodes `done` and the
continuation engine defers exactly the kinds it never writes.

**THE CONSEQUENCE.** Already reproduced: PROBE-A (ISSUE-066) — the honest waiting run ends `noop`,
archives, and the documented resume path is dead; the incentive gradient rewards the defer-escape
(ISSUE-052) with a clean `done`. Prospectively: Phase 17 as written will either fail its own
acceptance or force the fix mid-phase, unplanned.

**WHY IT IS STRUCTURAL NOT LOCAL.** The ring exists because stop-kind authorship has no owner:
core computes, continuation defers, report hardcodes — the "two layers each believed the other
owned this" cluster (P7) that step-2's composition lens found four separate instances of
(ISSUE-055, -065, -066, -067). Fixing the one writer without assigning ownership leaves the next
stop kind (the addendum effectively adds a `surfaced`-on-intake variant) to re-create the ring.

**WHAT A BETTER SHAPE LOOKS LIKE.** IDEA-STRUCT-5, endorsed from this lens with a scheduling
claim: a single `run.stop` closer that computes the kind from settled dispositions, landed
**before 13.2** — it is the smallest fix that de-risks all three consumers at once. Migration
cost: one function plus re-pointing `handleReport` and the continuation engine's terminal path;
the stop-report renderer already handles both kinds (step 2 verified the renderer exists and only
the writer is missing).

**PLAN IMPACT.** Promote ISSUE-065's fix from "a MAJOR among forty" to a named prerequisite of
13.2, 14.2, and Phase 17. The addendum should cite it.

**WHAT WOULD CHANGE YOUR MIND.** If Task 17.4's implementation is intended to *be* the stop-kind
writer fix (its acceptance text implies someone must build it), then the dependency is scheduled —
but the addendum nowhere acknowledges that the current system cannot write `surfaced`, so at
minimum the addendum's risk register is wrong. Show a line in the addendum or STATE.json naming
ISSUE-065's gap as 17.4's work, and this downgrades to an IDEA about making the dependency
explicit.

---

### FITNESS-FORWARD-006 — Adding a tool touches five files and two silent seams, and the addendum — the actual next additions — omits two of the five from its own file lists

**THE OBSERVATION.** Traced against HEAD, a new `conductor_*` tool must touch: (1)
`adapter/tools.ts` — handler + input interface (and `CONDUCTOR_TOOL_NAMES`, which tools.ts:97
owns); (2) `core/types.ts` — the §2 schema, twice (interface + hand-written JSON schema, the
plan-mandated duality); (3) `core/tool-bindings.ts` — the binding entry (well-guarded: the guard
test goes red the moment a handler is exported unbound — the one genuinely safe seam); (4)
`plugin/index.ts` — the per-tool `ToolSpec` (description + zod args), where **a missing entry
falls back silently to an argument-free definition** (plugin/index.ts:245-247, verified: "a name
missing here falls back to an argument-free definition rather than dropping the tool"); (5)
`core/gates-phase.ts` — legality, where a *stage* tool joins `legalTools` but a *meta* tool joins
**nothing** (ISSUE-005: no `requireMetaTool` choke point exists), so every new meta tool must
hand-roll its own when-callable check inside its handler. Plus `core/journal-events.ts` for any
new events, plus doctrine, plus tests. The addendum's Task 17.3 file list names `tools.ts`,
`types.ts`, `journal-events.ts` — and **omits `tool-bindings.ts` and `plugin/index.ts` entirely**
(grep over the addendum: zero mentions of either, verified this session). Task 18.1 likewise.

**THE CONSEQUENCE.** Has already happened in this exact shape: C-082's `test-writer`/`testWriter`
gate arm — a dispatch literal in one of the five files drifting from another — survived the task
gates, the phase gates, and a unanimous skeptic refutation (P10). And the two files the addendum
missed are precisely the ones with silent failure modes: an unlisted plugin ToolSpec degrades
silently; an unbound handler is caught, but a mis-specced legality check is caught by nothing
(ISSUE-005's meta tools are the standing proof). The next implementer, working from the addendum
as the spec, starts with an incomplete map written by the author with the most context.

**WHY IT IS STRUCTURAL NOT LOCAL.** The addition surface is not *discoverable*: no document or
mechanism enumerates it, so each addition re-derives it (and the best-informed author just
demonstrated the re-derivation loses 40% of the files). Fixing the addendum's lists fixes one
addition; the next tool re-rolls the dice. The legality half is worse than undiscoverable — it is
*per-addition bespoke* (each new meta tool re-implements when-callable), which multiplies the
exact defect class ISSUE-005 documents with every growth step.

**WHAT A BETTER SHAPE LOOKS LIKE.** (a) The `requireMetaTool` choke point (ISSUE-005's fix) is a
*growth* mechanism, not just a bug fix: with it, a new tool declares its legality in one table
instead of hand-rolling a check. (b) A "tool addition" checklist derived from `TOOL_BINDINGS` —
or better, a guard test asserting every `CONDUCTOR_TOOL_NAMES` member has a non-fallback ToolSpec
in the plugin (closing the silent seam; ~10 lines). (c) Correct the addendum's file lists now.
Migration cost: (a) is one function + a table (already specced by step 2); (b) and (c) are
sub-hour.

**PLAN IMPACT.** Phase 17/18 implementers must be handed the five-file map; the addendum text
should be amended before any task starts. `requireMetaTool` should land before `conductor_clarify`
does, so the new tool's legality rides the choke point instead of adding a sixth bespoke check.

**WHAT WOULD CHANGE YOUR MIND.** If the tool-binding guard test in fact transitively forces all
five touches (e.g. it fails on a missing plugin ToolSpec too), the discoverability claim weakens
to documentation polish. I read the guard's description (tool-bindings.ts:27-31: it asserts
null-ness/binding against the adapter source) — it covers the handler↔binding seam only — but a
run of the actual test proving broader coverage would downgrade this to the legality half alone.

---

### FITNESS-FORWARD-007 — Growth lands, by construction, in the span the repo's own audits cannot see: every handler appended to tools.ts is born unaudited

**THE OBSERVATION.** The two source audits' `stripComments` is quote-blind: a `/*` inside a glob
string literal opens a "comment", blanking tools.ts lines 8405–8488 and **9104–9254 (to EOF)** —
including a real `journal.log("config.updated")` call site whose vocabulary entry can be deleted
with the audit staying 7/7 green (ISSUE-088, reproduced both directions). tools.ts is 9,253 lines;
new handlers are appended; therefore **100% of appended handler code lands in the blanked span**,
invisible to the journal-vocabulary audit and the legalTools-callsites audit — the repo's two best
drift guards. The addendum appends at least two handlers (17.3, 18.1) plus new journal events
(`clarify.*`, `artifact.written`, the whole `audit` component) whose call sites those audits exist
to police.

**THE CONSEQUENCE.** Already demonstrated by mutation: a new dynamic `.log` planted at the tools.ts
tail passed 7/7 (step-2 mutation table). Prospectively: Phase 17/19's new event names — added
under the very widening rule journal-events.ts:101-109 prescribes, "each with a grepping test in
the same commit" — will be guarded by tests whose enforcement partner (the audit) cannot see the
call sites, recreating P1 at the audit layer for every event the addendum adds.

**WHY IT IS STRUCTURAL NOT LOCAL.** The one-line stripper fix (make it string-aware) closes today's
blind span — but the structural fact is that the audit layer's coverage is *inversely correlated
with growth*: the bigger the monolith gets, the more string literals precede any given appended
line, and nothing asserts the audit can see the file's tail (no sentinel). A fixed stripper with
no canary rots the same way the next time someone writes a novel string shape. And the monolith
itself is why the span is so large — in a 500-line handler module the same bug would blank a
fraction of one file, not the tail of the system's largest.

**WHAT A BETTER SHAPE LOOKS LIKE.** IDEA-GATE-3 (string-aware stripper, hoisted, plus a sentinel
assertion that the audit sees a known marker at EOF) — endorsed from this lens as a *pre-addendum*
prerequisite, since Phases 17–19 are journal-event-heavy. The deeper fix is the tools.ts split
(Part A/B territory — see pointer disposition below); from this lens the split's growth argument
is that per-handler modules make "born unaudited" structurally impossible for new work. Migration
cost of the stripper+sentinel: ~15 lines + a canary; of the split: large, Part A owns the seam
proposal.

**PLAN IMPACT.** The stripper fix and sentinel land before Task 17.3 (the first appended handler).

**WHAT WOULD CHANGE YOUR MIND.** Nothing about the current facts — the blanked spans are measured.
The finding downgrades only if the audits are decommissioned in favor of a stronger mechanism
(e.g. production journal vocabulary enforcement, ISSUE-124's weighing), in which case the blind
span stops mattering.

---

### FITNESS-FORWARD-008 — Measured vocabulary-addition costs: a role is ~9 sites across ~7 files with two silent seams; a stop kind is 5 sites, one of which crashes the live campaign when missed

**THE OBSERVATION.** Traced against HEAD and step-2's enumerations:

| Addition | Sites to touch | Files | Silent-failure seams |
|---|---|---|---|
| A role | ROLE_PACKS + params + priority maps (inject.ts, 3 private maps with `?? ` typo-absorbing fallbacks) · READER_ROLES (gates-edit.ts) · ~15 dispatch literals (tools.ts, 10 counted for "implementer" alone across 3 files this session) · agent entry (opencode-fragment.json) · pack file + REQUIRED_PACKS + doctrine.test + inject.test PACK_FILES + verify-acceptance detector B | ~7 | 2 proven: a ROLE_PACKS-only addition is caught by nothing (ISSUE-114, reproduced MUT-1b); the three inject maps absorb a key typo silently (ISSUE-121) |
| A stop kind | types.ts STOP_KINDS · stops.ts computation · a writer (see FITNESS-FORWARD-005: currently nothing) · conductor_bench.py STOP_KINDS · test_conductor_bench pin | 5 | TS-side widening is unguarded (ISSUE-113 mutation); the miss surfaces as a hard `validate_result` error **mid-campaign**, during 14.2 |
| A doctrine pack | the file · ROLE_PACKS · REQUIRED_PACKS · doctrine.test anchors · inject.test PACK_FILES · detector B | 6 | both maps module-private, no test can compare them (ISSUE-114) |
| An override-able gate | closed vocabulary does not exist — the `gate` argument is a free string with three spendable literals (ISSUE-007) | n/a | a new gate name that misses `consumeOverrideGrant` burns budget and can kill the run — the plan's own §2.8 example already does |

**THE CONSEQUENCE.** Every row is anchored to a reproduced defect (cited) and to the correction
record: the two-spellings class (P3) is the *most frequent* pattern across C-001…C-092
(C-081/082/083/086 among others), and the role vocabulary is "C-082's home ground, highest
restatement count in the repo" (ISSUE-121). The addendum adds three new closed vocabularies
(CLARIFY_UNANSWERED_MODES, ARTIFACT_LIFETIMES + JANITOR_MODES, AUDIT_LEVELS) and one new question
origin — each will be restated in at least the schema, the python bench layer (if surfaced in
results), and tests, under the same regime.

**WHY IT IS STRUCTURAL NOT LOCAL.** The repo's strongest guards (single-source.test's schema-enum
equality; composition.test:823's cross-language source grep) are hand-built one-offs — the safe
pattern exists but each new vocabulary must remember to apply it (P3 doctrine: a restatement with
no drift guard is a defect even while the copies agree). Growth under artisanal guarding
multiplies unguarded pairs; that is arithmetic, not opinion.

**WHAT A BETTER SHAPE LOOKS LIKE.** IDEA-STRUCT-6's vocabulary registry + parity harness, endorsed
from this lens with the measured addition costs above as the business case: make the
composition.test:823 technique the *default* (a table of {owner, restatements, guard} that a gate
leg walks) so the next vocabulary is safe by construction. Migration cost: the harness is
moderate (~a day); migrating the four worst existing vocabularies (roles, stop kinds, packs,
terminality) rides the ISSUE-113/114/115/121 fixes step 2 already specced.

**PLAN IMPACT.** Phase 17's three new vocabularies should be the registry's first natives rather
than four more artisanal sets.

**WHAT WOULD CHANGE YOUR MIND.** A demonstration that the compiler catches these in practice —
e.g. typed `Record<Role, …>` maps and `readonly ItemState[]` lists landing with ISSUE-121/122's
fixes — would collapse most of the role row's silent seams and reduce this to the cross-language
residue (python, fragment JSON, doctrine), which is smaller but still real.

---

### FITNESS-FORWARD-009 — A second orchestrating agent (or an accidental second session) is unsupported in fact: the multi-writer story is ~17% implemented and composes into record corruption

**THE OBSERVATION.** Step-2 measured: "read-only conductor" guards 2 of ~12 mutating store methods,
and `grep -rn "\.readOnly"` finds **zero consumers** outside state.ts (re-verified this session:
zero hits in conductor source) — no handler or composition root refuses work when demoted
(ISSUE-023). The demoted session overwrites the live writer's `alive.json` beacon (written
unconditionally *before* the lock attempt). The stale-lock break is a naked read-then-overwrite —
two post-crash restarts both become writers (ISSUE-024, mechanically confirmed); `release()`
deletes whoever's lock is present (ISSUE-025, deterministic); and the composed chain ends at two
processes minting duplicate evidence seqs and publish shipping one item's green on another's
verify record (ISSUE-026/027/028).

**THE CONSEQUENCE.** The build's own process has already hit the adjacent failure: two step-2
reviewers following the briefing's `ps | grep` guidance killed each other's test children
(IDEA-PROC-2), and the gate is nondeterministically red under concurrent-agent load (ISSUE-134,
observed independently by three sweeps). The user's working style — multiple concurrent agents,
per the review suite itself — makes the accidental-second-session shape (13.2's SG-K names it:
"easy to do by accident while inspecting things") a *when*, not an *if*, on first live contact.

**WHY IT IS STRUCTURAL NOT LOCAL.** The single-writer property is enforced by a pid-file protocol
with read-reason-rewrite races at every edge, and the read-only demotion contract has no
enforcement locus at all (the flag exists; nothing consults it). Guarding all ~12 methods fixes
the instances; the class fix is structural: an OS advisory lock held for the process lifetime
(IDEA-STRUCT-1) makes the double-writer unrepresentable, and a demotion that refuses *handler
registration* (not per-method writes) makes the read-only contract one check instead of twelve.

**WHAT A BETTER SHAPE LOOKS LIKE.** IDEA-STRUCT-1 (flock-for-lifetime) + refuse-registration
demotion + beacon-after-lock. Migration cost: small-moderate — state.ts owns all the seams;
the itemId/tree assertion in `readEvidenceAt`'s callers (ISSUE-028's cheap defense) closes the
corruption consequence independently and is ~10 lines.

**PLAN IMPACT.** Before 13.2 (whose SG-K currently handles this by *operator discipline* — the
weakest guard in the building), land at least the beacon-after-lock and the release-pid check;
before any two-agent operation, the flock.

**WHAT WOULD CHANGE YOUR MIND.** Evidence that the second-session scenario is genuinely out of
scope by design (a recorded decision that conductor is single-operator-single-session and the
task-4.1 "read-only conductor" claim is withdrawn) — then this becomes a documentation-honesty
finding instead (the claim exists; the implementation is 2/12).

---

### FITNESS-FORWARD-010 — The build-record regime measurably stopped scaling at ~task 40 of 52; Phases 16-19 add ~12 tasks onto a decaying regime

**THE OBSERVATION.** Four independent decay measurements, all step-2-verified: the M1–M9 per-task
gate ledger **silently ends at task 11.8** — eleven COMMITTED tasks have no gate record and `15.0`
appears zero times in GATES.json (ISSUE-083); `coveredByTest` is populated for tasks 0.1–9.1 and
null for 548 of 795 rows thereafter, yet was read as evidence by a phase adjudicator — right for
15.1, wrong for 14.1 (ISSUE-081); the four record surfaces describe four different presents, with
the prescribed cold-boot order delivering retracted evidence (ISSUE-082); and the assertion-ledger
convention changed three times over the build (step-2 pointer). CORRECTIONS.md is 4,610 lines in
one file; STATE.json is 2,289. The addendum adds Phases 16-19 (~12 tasks) under the same regime,
plus four new record surfaces of its own (ARTIFACT-POLICY.md, artifacts.jsonl, audit.jsonl, the
janitor's trash ledger).

**THE CONSEQUENCE.** Already happened: the phase-13 adjudicator drew a wrong conclusion from the
dead `coveredByTest` field (ISSUE-081); the cold-boot reader inherits the retracted G5 narrative
(ISSUE-073); C-075's owed spec fix rotted un-scheduled (ISSUE-078). These are not hypothetical
scaling failures — they are the record layer failing at *current* scale, found because step 2
looked.

**WHY IT IS STRUCTURAL NOT LOCAL.** Backfilling the eleven gate rows fixes instances. The
structure is asymmetric enforcement: the *code* cannot advance without passing gates, but the
*record* can rot without failing anything — no currency stamp, no mechanical row-id→test linkage
(IDEA-ROW-1), no owed-items ledger with owners (IDEA-PROC-1). A regime that depends on manual
upkeep decays exactly when throughput rises — which is what the measured 9.1/11.8 cutoffs show
(the conventions died when the build sped up).

**WHAT A BETTER SHAPE LOOKS LIKE.** Give the record the same treatment the code got: a gate leg
that (a) asserts every COMMITTED task has a gate record, (b) walks row-ids against test titles
(IDEA-ROW-1 — would have caught ISSUE-075/076/132/133), (c) checks a single currency stamp
across the status surfaces (ISSUE-082's fix). Migration cost: each is a small script; the backfill
is a one-time pass.

**PLAN IMPACT.** Phase 16 (repo hygiene) is the natural home — it already adds a janitor gate leg;
extend its charter from *files* to *records*. Do this before Phases 17-19 generate ~12 more tasks
of ledger under the old regime.

**WHAT WOULD CHANGE YOUR MIND.** If the late-build record thinning was a deliberate, recorded
convention change ("from 9.2 on, test titles are the linkage; coveredByTest is retired") the decay
reading weakens for that field — but no such record exists (step 2 looked: the changes were
silent), and the GATES.json cutoff has no such defense.

---

### FITNESS-FORWARD-011 — The second-contributor surface does not exist: navigation knowledge lives in per-agent briefings and dies with them

**THE OBSERVATION.** What exists for a newcomer: `conductor/docs/` holds OPERATIONS.md,
HONEST-LIMITS.md, RUNNER-DISCOVERY.md (operator docs, not contributor docs); the authoritative
spec is a 3,399-line IMMUTABLE plan whose §1.1 layout is already stale (`router/` vs
`src/router/`, per the briefing itself); UPSTREAM_CONTRACT.md doubles as a findings ledger
(F1/F3/F4 wiring decisions live in a router contract file — step-2 pointer); the top-level CMake
project is still named `myprogram` while DECISIONS.md documents its removal. There is no
architecture map, no module-ownership index, no "how to add X" anywhere. The build compensated
with per-agent briefings: every agent brief carried "NEVER read this file whole" and agents
"routinely had to be handed exact line ranges before they could begin work at all" (charter Part
A, recorded across C-076…C-092) — i.e., navigation knowledge was *oral tradition* supplied by
the orchestrator per task, and it is recorded nowhere durable.

**THE CONSEQUENCE.** Measured twice this review: the addendum author — the best-informed
contributor this project has — omitted 2 of 5 files from a tool-addition list
(FITNESS-FORWARD-006); and the step-2 campaign, staffed by seventeen fresh agents, had to split
tools.ts by line ranges between two lenses and still notes that seam defects were "invisible
partly because the three files involved are far apart" (§10.8). A human second contributor gets
less hand-holding than either.

**WHY IT IS STRUCTURAL NOT LOCAL.** The knowledge exists (the briefings prove it) but the system
has no place for it: the plan is immutable, the operator docs are for operators, and the record
layer is task-history, not geography. Writing one map fixes today; the structural fix is making
the map *derivable* — TOOL_BINDINGS already encodes tool→handler→input; the vocabulary registry
(FITNESS-FORWARD-008) would encode owner→restatements; a 200-line generated OWNERSHIP.md from
those tables cannot rot the way prose does.

**WHAT A BETTER SHAPE LOOKS LIKE.** One `conductor/docs/ARCHITECTURE.md` (or CONTRIBUTING.md):
the layer diagram, the five-file tool-addition map, the vocabulary owners, the "which file owns X"
table the briefings kept re-deriving — seeded from the step-2 coverage ledger, which is the most
complete geography this codebase has ever had (59 files, each with owner and depth). Migration
cost: a day, mostly transcription from existing review output.

**PLAN IMPACT.** Do it while the step-2/step-3 registers are fresh; they are the raw material.

**WHAT WOULD CHANGE YOUR MIND.** This entry is partly OPINION in its remedy (whether a map doc is
the right vehicle) — but the observation (no contributor surface; line-range oral tradition;
the best-informed author missing touch points) is measured. If the intended model is
"agents-only, always orchestrator-briefed, no human contributors ever", the finding narrows to:
the briefing knowledge itself is unversioned and dies per-session, which the addendum's omissions
already demonstrate is lossy.

---

### FITNESS-FORWARD-012 — A second router backend or second model is a guarded-by-nothing change: the TS↔C++ contract has no automated check and the admission design assumes one model

**THE OBSERVATION.** `RouterConfig.upstream` is a single `Endpoint` (config.hpp:84, verified this
session) — a second backend is a schema change + C++ change + wiring change. The schema contract
between the layers is guarded by no automated step: the node gate regenerates
`router/tests/schemas/*.json` but runs no C++; ctest runs against whatever was last exported; the
CMake export step promised at 11.1 never landed; a fresh clone's schemas dir is empty and
config_test fails (ISSUE-043). A second *model* activates ISSUE-042 at once: admission grants
`maxInflightPerModel` per distinct model string while the pool is sized for one — reproduced live
as `/conductor/health` starvation (10 distinct names exhausted the 9-thread pool; the supervisor
would read a healthy router as down). The four `X-Conductor-*` header names are config on the
router side and constants in inject.ts (ISSUE-117), so the "hand-editable" config's affinity keys
silently desync the sender.

**THE CONSEQUENCE.** Not yet bitten — this is the most forward-looking entry — but each component
defect is reproduced (cited), and the composition is exactly what "add a second backend" would
walk through: change RouterConfig (unguarded), rebuild (fresh-clone schema gap), run (pool
sizing + header desync, both silent).

**WHY IT IS STRUCTURAL NOT LOCAL.** The missing piece is not any one fix but the absent
*cross-language contract mechanism*: schema export as a build step (promised, never landed) and
config-vs-constant ownership (ISSUE-117). Without them every router-shape change re-runs this
gauntlet.

**WHAT A BETTER SHAPE LOOKS LIKE.** Land the `add_custom_command` export step + exporter pruning
(ISSUE-043's fix); size the pool from a declared model list or bound distinct in-flight keys
(ISSUE-042's fix); make the sender read RouterConfig or document the keys as machine-owned
(ISSUE-117's fix). All three are specced by step 2; this entry's addition is only that together
they are the *precondition* for any second-backend/second-model ambition, and none is scheduled.

**PLAN IMPACT.** If the roadmap ever includes a second model (the models catalog in scripts/
suggests the user runs several), these three land first; otherwise record "single upstream, single
model" as a stated limit in HONEST-LIMITS.md so the boundary is honest.

**WHAT WOULD CHANGE YOUR MIND.** A recorded decision that llama-router is permanently
single-upstream-single-model POC infrastructure — then this collapses to ISSUE-043's build-step
fix (which matters regardless, since RouterConfig changes happen within one backend too).

---

### FITNESS-FORWARD-013 — The gate's determinism and wall-clock are already at their limit; every future task inherits verdicts-as-distribution-samples

**THE OBSERVATION.** The full parallel gate is nondeterministically red on byte-identical HEAD —
three distinct failure shapes across sequential runs, two of them the *product* enforcing
differently under load (ISSUE-134); the gate has no `--test-timeout`, so a hang-shaped regression
wedges it forever rather than failing (ISSUE-032, measured: one mutation deadlocked the suite,
another stalled it ~15 minutes); the node test count itself drifted 1382 vs 1386 across observers.
Full gate ≈90s today; the addendum's acceptance adds ≥5 new test files plus a janitor leg plus
audit tests.

**THE CONSEQUENCE.** Already polluting decisions: step 2 had to caveat *every* full-gate mutation
verdict as "a sample from a distribution" and fall back to scoped runs; the build's own recorded
"GATE PASS" claims inherit the same caveat retroactively. Prospectively: every Phase 16-19 task
gates through this; at higher test counts the same-millisecond clock-collision rate (the likely
cause) rises with parallelism, not falls.

**WHY IT IS STRUCTURAL NOT LOCAL.** The flaky tests are symptoms; the cause identified by step 2
is product code comparing `Date.now()`/mtimes at millisecond granularity in freshness/stale-red
logic — a *design* choice that holds only on an idle machine (proposed P14). Fixing the three
observed tests leaves the class; the class fix is a monotonic/injectable clock at the comparison
seams plus `--test-timeout` and `--concurrency` control in the gate.

**WHAT A BETTER SHAPE LOOKS LIKE.** IDEA-GATE-1 (+ ISSUE-134's fix direction): inject a monotonic
clock where freshness compares times; `--test-timeout=120000`; pin `--concurrency` for the
enforcement suites. Migration cost: the timeout flag is one line; the clock injection is a
focused refactor of freshness.ts/evidence.ts seams (already dependency-injected in places).

**PLAN IMPACT.** Before the addendum's five new test files ride the same gate — and before 13.2,
whose Step-2 task-lets each require a full-gate green: a nondeterministic gate turns every
task-let into a possible re-run loop during the most expensive phase.

**WHAT WOULD CHANGE YOUR MIND.** Root-causing the three shapes to test-harness timing rather than
product comparisons (step 2's loop-under-load experiment, not yet run) — that would downgrade
this from product-design to test-hygiene, though the gate-availability half (no timeout) stands
on its own measurements.

---

## Section 3 — The change-cost table (summary of traced additions)

| Change | Places touched | Files | Silent seams | Caught-by-nothing risk | Evidence |
|---|---|---|---|---|---|
| Add a stage tool | ~7 (names, handler, schema ×2, binding, ToolSpec, legalTools) + tests | 5 src | plugin ToolSpec fallback | low (binding guard + phase gate) | traced, FF-006 |
| Add a meta tool | same minus legalTools, **plus a bespoke hand-rolled legality check** | 5 src | ToolSpec fallback; legality check itself | **high** (ISSUE-005 class re-rolled per addition) | traced, FF-006 |
| Add a role | ~9 sites | ~7 | inject `??` fallbacks; ROLE_PACKS (reproduced) | high | FF-008, ISSUE-114/121 |
| Add a stop kind | 5 sites | 5 | TS-side widening unguarded | **crashes 14.2 mid-campaign** | FF-008, ISSUE-113 |
| Add a doctrine pack | 6 sites | 6 | both maps module-private | high (reproduced MUT-1b) | FF-008, ISSUE-114 |
| Add an overridable gate | no vocabulary exists | n/a | free string burns budget | run-killing (reproduced R3) | ISSUE-007 |
| Add a router backend | schema + C++ + wiring | ≥4 | no automated TS↔C++ check | high | FF-012, ISSUE-043 |
| Add a journal event | journal-events.ts + call site + grep test | 2-3 | call site lands in audit blind span if in tools.ts tail | medium | FF-007, ISSUE-088 |

Verdict for the charter's question "one place or five?": **five is the floor, nine is typical, and
at least one seam per addition fails silently.** The two safe additions (a bound handler; a
journal event *name*) are safe precisely because they have single-owner tables with born-under-
guard tests — the pattern exists in the codebase and is applied to roughly a fifth of the
addition surfaces.

---

## Section 4 — The second contributor / second orchestrating agent (summary)

Covered in FITNESS-FORWARD-009 (second writer: unsupported in fact, ~17% implemented demotion
contract, corruption chain reproduced) and FITNESS-FORWARD-011 (second contributor: no
architecture surface; navigation was per-session oral tradition; the best-informed author
demonstrably cannot enumerate an addition surface from memory). One addition: the *review/dev
process itself* is not multi-agent safe — the briefing's own kill-stray-processes guidance caused
two reviewers to kill each other's children (IDEA-PROC-2), and the gate is flaky under
concurrent-agent load (ISSUE-134) — so "a second orchestrating agent" today degrades both the
product layer (locks) and the process layer (gates). What the second agent needs that does not
exist: an ownership-scoped process signal (pgrep by session), a flock-backed single-writer, and a
gate whose verdict is load-independent.

---

## IDEA register

### IDEA-FWD-1 — A mechanical pre-live-contact preflight script
Origin: assembling the Section 1 failure chain — every entry is machine-checkable today.
Kind: tooling
Value: converts the step-2 register into a ~2-minute go/no-go for 13.2/14.2 (probe: injection
hooks registered? default-mode write allowed through the real gate? cell env spawns opencode?
acceptance path matches the artifact path?). Prevents burning live-model hours on known defects.
Cost: half a day; every probe already exists as a step-2 reproduction.
Relates to: FITNESS-FORWARD-001/002/003, ISSUE-001/002/078/107.

### IDEA-FWD-2 — Spec-currency checking for assertions.json
Origin: FITNESS-FORWARD-002 (13.2's spec is 142 commits stale in load-bearing rows).
Kind: tooling
Value: a ~30-line leg that flags any spec whose `verifiedAgainstHead` predates changes to files it
cites; live-task specs get re-verified instead of trusted.
Cost: small.
Relates to: FITNESS-FORWARD-002, ISSUE-078.

### IDEA-FWD-3 — Amend the addendum before executing it
Origin: FITNESS-FORWARD-005/006.
Kind: docs
Value: three concrete corrections: add `core/tool-bindings.ts` and `plugin/index.ts` to Task
17.3/18.1's file lists; state that 17.4's `surfaced` acceptance requires building the stop-kind
writer (ISSUE-065) and own it; note that 17.5's "ahead of the doctrine pack" delivery assumes the
§6.4 wiring (ISSUE-001) is fixed.
Cost: an hour.
Relates to: FITNESS-FORWARD-005/006, ISSUE-001/065.

### IDEA-FWD-4 — A generated OWNERSHIP/ARCHITECTURE page
Origin: FITNESS-FORWARD-011.
Kind: docs/tooling
Value: derive the geography (tool→handler→files, vocabulary→owner→restatements) from
TOOL_BINDINGS + the (proposed) vocabulary registry so the contributor map cannot rot as prose.
Seed the first version from step 2's §10 coverage ledger.
Cost: a day.
Relates to: FITNESS-FORWARD-006/008/011.

### IDEA-FWD-5 — Ship the SMOKE.md / conductor-report.md checkers before the artifacts
Origin: FITNESS-FORWARD-003; the G5 precedent (a standing node checker exists only because C-089
burned the build once).
Kind: tooling
Value: the two remaining artifacts are the two the operator meter cannot defend (ISSUE-093,
15-second fabrication); a standing checker (required sections, runId + verify seq that
re-validates, 90-cell arithmetic) raises fabrication cost before temptation exists.
Cost: small; endorses IDEA-STRUCT-8 with a scheduling constraint (before, not after).
Relates to: FITNESS-FORWARD-003, ISSUE-093.

### IDEA-FWD-6 — A one-page sequencing note for what comes next
Origin: the whole lens — six fixes (ISSUE-001, -002, -065, -078, -088, -107) are on the critical
path of everything scheduled, and no document orders them.
Kind: docs
Value: 13.2/14.2/Phase-16-19 each list their preconditions from the register; the orchestrator
stops discovering ordering the expensive way.
Cost: an hour once step 3/4 close.
Relates to: every FITNESS-FORWARD entry.

---

## CROSS-LENS POINTERS (for the capability review)

- **`requireMetaTool` is a growth mechanism, not just ISSUE-005's fix.** Each new meta tool
  currently hand-rolls its own legality (the addendum's `conductor_clarify` will be the next);
  the single choke point converts a per-addition defect class into a table row. Weigh it as a
  floor-raiser under "structural-vs-advisory upgrades". [FITNESS-FORWARD-006]
- **A standing wire-level live leg (real opencode + stub provider) is the missing mechanism that
  would have caught both CRITICALs at introduction time.** It needs no model and belongs in the
  gate. [FITNESS-FORWARD-001]
- **The stop-kind closer (IDEA-STRUCT-5) is a scheduled-work prerequisite**, not an improvement:
  Phase 17's acceptance is unsatisfiable without it. [FITNESS-FORWARD-005]
- **The vocabulary registry (IDEA-STRUCT-6) now has a quantified business case**: 5-9 touch
  points per addition, ≥1 silent seam each, three new vocabularies scheduled in Phase 17 alone.
  [FITNESS-FORWARD-008]
- **The record layer needs gates the way the code has gates** — currency stamp, row-id linkage,
  gate-record completeness — before ~12 addendum tasks land on it. [FITNESS-FORWARD-010]
- **Doctrine-efficacy analysis must account for the 14.2 arm inversion**: until ISSUE-001 is
  fixed, any live measurement of "doctrine's effect" made through the conductor arm measures the
  tools.ts paraphrases, not the packs. [FITNESS-FORWARD-004]

---

## Disposition of step-2 pointers addressed to the macro review

Step 2 left ten pointers to step 3. This part dispositions each from the fitness-forward angle;
where the pointer's core belongs to another macro part (A-E), that is stated rather than duplicated.

1. **Stop-vocabulary over-specified for the recorders that exist.** TAKEN UP →
   FITNESS-FORWARD-005: resolved here as "the writer must be built, and before 13.2" because three
   scheduled consumers depend on the missing kinds; whether six kinds is the right closure remains
   Part C's question.
2. **Enforcement locus diffuse / no single choke point.** TAKEN UP (growth half) →
   FITNESS-FORWARD-006: per-addition bespoke legality multiplies the class. The layering half
   (where the locus *belongs*) is Part B's.
3. **Detection-by-enumeration recurring shape.** PARTIALLY TAKEN → the addition-cost table shows
   each enumerated list is also an addition site (GIT_WRAPPERS etc. grow with tools). The
   posture question (fail-safe vs N lists) is Part C's; from this lens the growth arithmetic
   favors fail-safe.
4. **tools.ts 9,253 lines; seam defects invisible across distance.** TAKEN UP (growth angle) →
   FITNESS-FORWARD-007: growth lands in the audit blind span; both scheduled additions append
   there. The split proposal and its seams are Part A's deliverable; this part supplies the
   forward-looking argument for it.
5. **continuation.ts three engines; inject.ts fully-built with zero callers.** TAKEN UP
   (inject half) → FITNESS-FORWARD-001/002/004: the dead subsystem is the single largest
   first-contact liability and corrupts the POC arms. The decomposition half is Part A/B's.
6. **Five status surfaces, no freshness contract.** TAKEN UP → FITNESS-FORWARD-010, extended
   with the addendum's four new surfaces and the record-gates proposal.
7. **scripts/ mixes two products under one gate.** TAKEN UP (the half that bites next) →
   FITNESS-FORWARD-003 notes the concrete collision: 14.2 must write into `.data/benchmark/`,
   which `benchmark.py` owns with live user data (the 14.2 spec's SG-E already defends it;
   the structural mixing is Part B's).
8. **types.ts interface + hand-written JSON schema duality.** TAKEN UP (cost measurement) →
   counted as 2 of the 5-7 touch points per tool addition (FITNESS-FORWARD-006, Section 3
   table). Whether one side should be generated is Part C's.
9. **UPSTREAM_CONTRACT doubles as findings ledger; CMake `myprogram`.** TAKEN UP →
   FITNESS-FORWARD-011 as second-contributor evidence.
10. **The gate's own availability failure (no timeout; nondeterministic red) as a design point.**
    TAKEN UP → FITNESS-FORWARD-013, framed as: every future task's verdict is a distribution
    sample, and the addendum grows the exposure. The gate-regime redesign question is Part D's.

---

## Coverage ledger (this part)

| Examined | Depth | Yield |
|---|---|---|
| `1-briefing.md`, `3-macro.md` | full | scope, method, evidence bar |
| `findings-enforcement.md` (2,303 lines) | full | the evidence base; all ISSUE/IDEA citations |
| `docs/build/specs/task-13.2.assertions.json` | full | FF-002 (dead-channel banner, staleness), FF-001, FF-005 |
| `docs/build/specs/task-14.2.assertions.json` | full | FF-003/004 (arm nesting, SG-K, SG-E, SG-B) |
| `docs/plans/2026-08-14-conductor-addendum-phases-16-19.md` | full | FF-005/006/008/010; IDEA-FWD-3 |
| `conductor/core/tool-bindings.ts` (260 ln) | full | FF-006 (the guarded seam; the binding table) |
| `conductor/plugin/index.ts` 240-300 + hook-region facts from step 2 | targeted | FF-006 (ToolSpec silent fallback, verified at 245-247) |
| `conductor/adapter/config-io.ts` 110-125 | targeted | `parallel.writes:"off"` shipped default, verified |
| `router/config.hpp` (upstream shape) | targeted | FF-012 (single Endpoint, verified :84) |
| Measurements run this session | — | file line counts (tools.ts 9,253; plugin 1,427; continuation 1,382; CORRECTIONS 4,610; STATE 2,289); role-literal counts (10 "implementer" sites, 3 files); `.readOnly` consumers outside state.ts = 0; addendum mentions of tool-bindings/plugin = 0; HEAD drift since 13.2 spec = 142 commits; doctrine pack count = 9 |
| NOT done | — | no mutations run (this lens argues from step-2 reproductions, per charter); no live processes started; `tools.ts`/`gates-*.ts` bodies not re-read in full (step 2's seventeen-part coverage ledger is the source of file-level facts, trusted as the charter directs); the 3,399-line plan consulted via the spec's cited ranges rather than re-read end-to-end this session |

**Honesty note on evidence depth:** every reproduced-defect claim here is step 2's reproduction,
cited by ISSUE id, not re-run by this reviewer — the charter directs the macro review to argue
from that evidence base. Claims verified *directly* this session are marked "verified" inline
(the shipped default, the single upstream, the ToolSpec fallback, the addendum omissions, the
HEAD drift, the counts). The two entries carrying an OPINION component are flagged in their own
text (FITNESS-FORWARD-011's remedy; FITNESS-FORWARD-012's forward-looking composition).

**Format note (briefing §5.1):** no enumeration in this part was performed ceremonially; the
Section 3 table exists because the charter demands the addition-cost measurement, and it earned
its place (it surfaced the addendum omissions).
