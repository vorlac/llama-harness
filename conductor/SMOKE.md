# Live smoke — 13.2: the harness under a real model

Measured 2026-08-21 on `darwin/arm64` (macOS, Darwin 25.6.0), against a local
`qwen3.6-27b` served by `llama-server` behind `llama-router`. Every block below is a
verbatim capture. Nothing here was written from expectation.

**Question under test:** not *can the model do the task* — that is 14.2's question —
but *does the harness do what it says it does*. A smoke that passes because nothing
was looked at closely is worse than no smoke, so the run was driven adversarially:
every stage was watched, every claim in the docs was checked against the record, and
every disagreement between the two was treated as a defect until proven otherwise.

**Result:** the harness did not work end to end at the start of this campaign, and
the reasons were not close to the surface. Twenty-two defects were found and fixed,
including one that made every fan-out sub-session run on the wrong doctrine, one that
made a whole FSM stage unreachable, and one that would have wedged every cell of the
14.2 campaign at the same instruction.

---

## Tool versions

```
$ .data/tools/llama-server --version; .out/build/clang-relwdebinfo/llama-router --version; node --version; bun --version; git --version; opencode --version
version: 0.1.2-dev (build 10542, commit 521a64cd0)
built with AppleClang 21.0.0.21000101 for Darwin arm64
llama-router 0.0.1
v26.7.0
1.3.14
git version 2.50.1 (Apple Git-155)
1.18.15
```

## How it was driven

- Task seeds materialized **outside** this repository, one hermetic cell per step
  (`HOME`, `XDG_*` isolated), through the same `scripts/conductor_bench.py` functions
  the 14.2 campaign uses — so a defect found here is a defect in the campaign path.
- `logging.level` set to `debug` in every cell and **verified in the record**, because
  an allowed read is journaled at `debug` and a run gathered at `info` looks complete
  and is not.
- Hidden tests materialized only after the run exits.
- The ladder starts at `slugify-ts` (T0): three lines of string handling, chosen so
  that anything that goes wrong is the harness's doing and not the task's.

## Preflight

```
$ bash scripts/test-conductor.sh
TAP: tests=1916 pass=1916 fail=0 cancelled=0 skipped=0 todo=0 skipdirectives=0 (node exit=0)
typecheck: OK
bun leg: OK (8 pass)
schema export: OK (router/tests/schemas/)
python leg: OK (Ran 106 tests)
GATE PASS

$ bash scripts/conductor-gate.sh
M5 PASS (192 file(s) scanned, 6 line exemption(s) all live)

$ ctest --test-dir .out/build/clang-relwdebinfo; echo "exit code: $?"
Total Test time (real) =   3.36 sec
exit code: 0
```

A green gate over 1,916 tests, a clean mechanical scan, and a green C++ suite. The
sections below are what happened next.

---

## The findings

Twenty-two, in discovery order. Every one was reproduced from the record, fixed
test-first (a red proved first, then the fix), re-gated, and re-run from a clean seed
with a written-down prediction checked honestly afterwards.

| # | What was wrong | How it showed up |
|---|---|---|
| F01 | The served per-slot window was 8,192 tokens; the orchestrator's first request is 11,441 | `send_error: ... request (11439 tokens) exceeds the available context size (8192 tokens)`, then a 400→compaction→400 loop |
| F02 | `core.md` delivered twice per request — once by the agent prompt, once by the system-append | 44,497-char first request; ~1.7k tokens duplicated every turn |
| F03 | opencode's model `limit` was decoupled from the window llama-server actually serves | catalog limit 65,536 against a served slot of 8,192; no proactive compaction |
| F04 | Preflight did not cover llama.cpp submodule drift | `serve.py` rebuilt nine binaries at launch; the contract was measured on a different build |
| F05 | Auxiliary opencode turns (titles, compaction) run on the same 27B | one title generation: 136,181 ms |
| F06 | **No sub-session of any role ever reached the model** | `schema rejection kind=Payload reason="Expected object \| null, got \"\""` — the prompt body carried `model: ""` |
| F07 | An API error was reported as a schema-invalid receipt | three attempts spent in 3 ms with `Unexpected EOF`, blaming the model for a call that never happened |
| F08a | The decompose brief named no `ladderRung` values | the planner: *"Let me figure out what the valid enum values are... likely: essential, required, optional"* |
| F08b | A ```-fenced receipt cost one attempt of three | `JSON Parse error: Unrecognized token '` + "`" + `'` on 4 of 5 retries in one run |
| **F09** | **`chat.message` re-registered every session as `orchestrator`, destroying the fan-out's registry entry** | planners served `core.md`; the idle engine nagged a planner; a run died `noop` mid-retry |
| F10 | A doc said conductor registers no `tool.execute.after` handler | it registers one — the session banner rides it |
| F11 | Two docs said the fan-out names no agent | it names one on every dispatch; opencode's own storage shows `conductor-planner`, `conductor-reviewer` |
| **F12** | **`conductor_classify` was never offered, so no run was ever classified** | every run reached decompose carrying `"rationale": "provisional at intake; conductor_classify has not run yet"` |
| F13 | The observer read two fields nothing wrote | `unnamed: 3` for denies; `largest brief 0 chars` after two real dispatches |
| F14 | A red gate's excerpt could not show which test failed | 60 lines of TAP trailer, twice, while the failing test sat thousands of lines above |
| F15 | A run-level dispatch is titled with a trailing colon | `planner:` twice in the sub-agent list, nothing to tell them apart |
| F16 | `X-Conductor-Schema` was never sent | after 114 live requests: `{"schemaConformanceRate":null,"schemaConformed":0,"schemaMissing":0}` |
| **F17** | **A brief names its receipt's fields and never their types or enum members** | predicted in writing before the run that confirmed it, then seen to block three stages: classify, plan and TDD |
| F18 | A declared threshold measured a config value | `reviewDispatchesPerItem` crossed at plan review, before any item had been reviewed once |
| **F19** | **Every bench cell was configured so no behavioral item could leave RED** | `no verify.requiredScopes entry covers item "slugify-impl" ... so this item has no test command (§2.1)` |
| F20 | `cmd 2>/dev/null` was adjudicated as an out-of-tree write | two sessions in one run were refused a plain `ls` |
| F21 | A receipt failed as `Unterminated string` — a raw line break inside a JSON string | three identical plan-stage attempts, then a whole-stage retry |
| **F22** | **`conductor_decompose` is legal on a run the classifier never spoke for** | a refused classify left nothing recorded, and the very next call — out of order, and refused by nothing — decomposed the run |

The three in bold are the ones that would have decided the 14.2 campaign's outcome on
their own.

---

## The runs, in order

Each restart is from a clean seed, after a green gate.

| Run | Reached | Ended because |
|---|---|---|
| `r-20260821-7666` | first request | F01: the served window was 8,192 and the request was 11,441 |
| `r-20260821-d156` | INTAKE, four dispatch waves | F06: every sub-session prompt was rejected by opencode before it reached the model |
| `r-20260821-b8de` | INTAKE | F09: the planner got the wrong doctrine, guessed the ladder, and the idle engine stopped the run `noop` while it was mid-retry |
| `r-20260821-c82b` | **EXECUTING** | F19: `conductor_submit_test` refused the item because the cell covers no scope |
| `r-20260821-113c` | **EXECUTING, test-writer dispatched, test written** | F17: the test-writer could not name `ImplementerResult.status`'s enum in three attempts, so `conductor_submit_test` refused. The shape block that answers it landed after this run started |
| `r-20260821-47df` | **DECOMPOSED** | stopped by hand. It verified F17, produced the campaign's first `trivial` classification — refused by the one acceptance authority on a size violation that does not stand — and then exposed F22 by decomposing anyway |

The fourth run is the one that matters for the shape of this report: it decomposed,
planned, passed a four-lens plan review clean (`survivingMajors: 0`), reached
`EXECUTING` — and then met a refusal that no amount of model quality could have
satisfied, because the cell it was running in declared no verify scope for it to use.

The fifth is the first to run the classification stage at all:

```
seq 14 gates allow {"toolName": "conductor_classify", "toolClass": "conductor", "sideEffect": null}
seq 15 fanout wave {"jobs": 1, "roles": ["mechanical"], "items": [""], "reviewItems": []}
seq 24 fanout subsession.retry {"attempt": 1, "errors": [
         "Classification.confidence: expected type string, got number",
         "Classification.trivialItem.ponytail.ladderRung: value is not one of the enum members"]}
seq 44 fanout subsession.complete {"ok": true, "attempts": 2}
seq 50 fanout subsession.complete {"ok": true, "attempts": 1}       <- the skeptic
seq 51 fsm transition {"to": "INTAKE", "classification": "work", "agreed": true}
seq 65 fanout subsession.complete {"ok": true, "attempts": 1}       <- decompose, first attempt
seq 67 fsm transition {"to": "DECOMPOSED", "items": 1}
```

Two things in that trace are worth naming. The classifier's first receipt failed on a
field it had never been shown (F17, predicted in writing beforehand). And the
classification it eventually produced was **`work`, not `trivial`** — for a three-line
change, with the skeptic agreeing. The §2.10 trivial route therefore still has not
run — the run after this one is the first to reach it.

## F09 — the registry had two writers and no protocol between them

The fan-out engine writes a sub-session's `{role, itemId, tree}` entry *before* its
first prompt, so the gates can never see an unregistered session. opencode then fires
`chat.message` for that very prompt, and the hook body registered whatever session it
saw as the orchestrator:

```
conductor/adapter/chat-message.ts:124   registry.register(sessionID, ORCHESTRATOR);
conductor/plugin/index.ts:359           registry.set(sessionID, { ...entry });   // a COPY of what it was handed
```

The copy carried `{role: "orchestrator"}` and nothing else, so the itemId and the tree
went with the role. Four things read that entry, and all four were wrong for every
sub-session this harness has ever dispatched:

```
seq 20 inject system-append {"role": "orchestrator", "packs": ["core.md"], ...}   <- a PLANNER's session
```

- **Doctrine.** `ROLE_PACKS.planner` is `["decompose.md", "plan.md"]`. The planner got
  `core.md`. `decompose.md:54-70` is the section that lists the seven ponytail ladder
  rungs — which is why the planner was guessing them (F08a), twice, in two independent
  sub-sessions, until the run died.
- **The §4.4 priority tag.** Every sub-session sent `interactive`. The ledger's whole
  history before the fix: 56 rows `("orchestrator","interactive")`, 2
  `("unregistered","interactive")`, and not one `planner` row — though two planner
  sub-sessions had each made several model calls. The router's admission ordering, the
  thing 14.2 exists to measure, had never received a correctly-tagged request.
- **Sampling temperature.** 0.4, the orchestrator's row, for a planner meant to run 0.7.
- **The idle engine.** `continuation.ts:786` guards ORCHESTRATOR-ONLY and the clobbered
  entry walked straight through it. So conductor re-prompted its own planner:

```
seq 28 continuation reprompt {"tool": "conductor_decompose", "idleRePrompts": 3, "futileRePrompts": 3}   <- planner's session
seq 29 state user.midrun-prompt {"prompt": "conductor: this session has gone idle ... The phase gate's next action is: conductor_decompose. Call that action now"}
seq 43 gates deny conductor_decompose   <- the planner did as it was told, and was refused
seq 62 continuation disengage {"stop": "noop", "futileRePrompts": 3, "reasonDisplay": "the run made no observable progress across 3 consecutive re-prompts"}
seq 64 fanout subsession.retry {"attempt": 2, ...}   <- lands AFTER the stop-report
```

The run was declared to have made no progress while its planner was mid-retry, by a
counter the harness had incremented by nagging that planner.

**Why 1,922 tests missed it.** `handleChatMessage` is tested with its own registry and
the fan-out engine with another. No test ever drove a chat message through a session
the fan-out had registered. Each half was correct; the composition was the defect.

**The fix.** A session already carrying a non-orchestrator role is the fan-out's, and
`chat.message` leaves it alone. **Verified live** — same dispatch, next run:

```
seq 18 inject system-append {"role": "planner", "packs": ["decompose.md", "plan.md"], "packDigest": "db701e2151a0fe19", "entries": 3}
seq 25 fanout subsession.complete {"ok": true, "attempts": 2}
seq 27 fsm transition {"to": "DECOMPOSED", "items": 1}
```

and in the ledger, for the first time:

```
{'status': 200, 'role': 'reviewer', 'priority': 'review', 'promptTokens': 16354, 'completionTokens': 137, 'upstreamMs': 46836}
```

---

## F12 — a whole FSM stage that nothing could reach

`chat.message` writes a schema-valid classification the instant a run is created, so
`run.json` is a valid §2.3 record from its first millisecond:

```json
"classification": { "kind": "work",
                    "rationale": "provisional at intake; conductor_classify has not run yet",
                    "check": { "agreed": false, "note": "classification check pending conductor_classify" } }
```

The phase gate asked a different question:

```ts
// core/gates-phase.ts:316
if (run.classification === null) { legal.set(CLASSIFY); recommended = CLASSIFY; }
else if (run.classification.kind === "work") { legal.set(DECOMPOSE); recommended = DECOMPOSE; }
```

`classification` is never null in a live system, so the classify branch was dead code
and every run went straight to decompose. The classifier and its skeptic check never
ran; the `trivial` route (§2.10) and the `question` route were unreachable; every
request in the world was `work`. Every run of this campaign ended carrying a
`run.json` that says the check is still pending, and the continuation engine's own
offer list confirms it:

```
"offered": ["conductor_decide", "conductor_decompose", "conductor_defer", "conductor_status", "conductor_surface"]
```

The receipt the gate needed already existed. `core/types.ts:350-357` declares
`classified?: boolean`, and its comment says exactly why: the provisional field
"makes its presence useless as the answer to 'has the run been classified?'". The
per-call legality choke point reads it correctly (`tools.ts:3376`). One gate read the
receipt; the other read the placeholder.

**Two tests had certified the defect.** Both named the placeholder in their own failure
messages, as the reason the wrong answer was the right one:

```
conductor/tests/inject-wiring.test.ts   "an INTAKE run carrying adapter/chat-message.ts's provisional work
                                         classification recommends conductor_decompose"
conductor/tests/live-inject.test.ts     "a fresh INTAKE run carrying adapter/chat-message.ts's provisional
                                         work classification recommends conductor_decompose"
```

That is what a test written by observing behaviour rather than deriving it from the
spec does: it locks the behaviour in and reports green forever.

**The fix.** `GateRun.classified` is REQUIRED — an optional flag reads as
"unclassified" at any assembly site that forgets it — the INTAKE branch keys on it,
and all six production assemblies pass `run.classified === true`.

---

## F19 — the campaign rig was configured so the thing being measured could not pass

Watching the run that finally reached `EXECUTING`:

```
seq 90 fsm transition {"from": "PLAN_REVIEWED", "to": "EXECUTING", "why": "plan review clean (survivingMajors === 0) (§3.1)"}
seq 91 fsm guard-reject {"stage": "conductor_submit_test", "itemId": "slugify-impl",
  "reason": "no verify.requiredScopes entry covers item \"slugify-impl\" (testScope [\"tests/slugify.test.ts\"],
             fileScope [\"src/slugify.ts\"]), so this item has no test command (§2.1)"}
```

`scripts/conductor_bench.py:1305` wrote `"requiredScopes": []` into every conductor-arm
cell. Conductor refuses an item that no entry covers **on purpose**, and says why:

> an item no requiredScopes entry covers selects NO scope, and `every` over an empty
> scope map is vacuously true — the verify would report green having executed nothing
> and take the item to VALIDATED on no evidence at all
> — `adapter/tools.ts:5426-5429`

The refusal is right. The cell config made it fire on every behavioral item, in every
task, for every model and every rep. A 14.2 campaign run against this config would
have produced a conductor arm that reaches EXECUTING and wedges in 100% of cells, and
a baseline-vs-conductor comparison drawn entirely from that.

Neither preflight floor catches it: `--verify-tasks` proves the hidden test fails on
the seed and `--seed-green` proves the visible suite passes on it. Neither drives the
conductor path, so neither meets the gate that refuses. And nothing in conductor's own
1,900-test suite could have caught it, because **it is not a defect in conductor** —
it is a defect in the rig that measures conductor.

**The fix.** The cell declares `requiredScopes: [{"pattern": "**", "scopes": ["repo"]}]`
— the cell's runner is the task's whole visible suite, so one scope covers every path
— pinned by a new assertion in `test_conductor_cell_preconfigured`.

---

## The instrument: two of ten breakdown thresholds were broken, in opposite directions

`BREAKDOWN_THRESHOLDS` was committed before the campaign on purpose, so the analysis
could not be fitted to the result afterwards. That only works if the signals behind
the thresholds are real.

- **`largestBriefWindowFraction` could never cross.** The observer reads `promptChars`
  off `subsession.dispatched`; the fan-out wrote `{role, itemId, tree, model}`. After
  two real dispatches: `largest brief 0 chars (0% of the effective per-slot window)`.
  A threshold whose input is always zero reads exactly like a passing check.
- **`reviewDispatchesPerItem` crossed in every run.** It counted reviewer *dispatches*
  bucketed by itemId, with a run-level plan review's empty id folded into a bucket
  called `unnamed`. The bench sets `planReviewers: 4` against a threshold of 3, so
  every run crossed it at its first plan review — before any item had been reviewed
  once. Its own comment states the rule it did not implement ("Reviewers re-dispatched
  on ONE item at the configured cap"), and so does the name of the test that covered
  it: `[22B.2-fix-rounds-against-the-cap] review rounds per item are reported against
  reviewMaxRounds`, asserting three reviewers in one wave are three rounds.

The same pattern sits behind the deny grouping: the observer read `data.gate`, nothing
wrote it, and every deny in every run bucketed under `unnamed: N` — so the row the
observing guide tells you to read first ("`edit` means the scopes are wrong, `git`
means the model is reaching for commits it may not make") could not be read at all.

A third contaminates the same block from the other side. `denyRate` is a declared
threshold (0.33) whose documented reading is "the session is spending turns arguing
with the gates rather than working" — and the write-shape extractor takes the token
after any `>` as a written path, so `/dev/null` reads as an out-of-tree write:

```
seq 48 gates deny {"gate": "edit", "toolName": "bash",
  "command": "ls .../repo/src/ 2>/dev/null && ls .../repo/tests/ 2>/dev/null",
  "reason": "the path is outside this session's tree; an edit is confined to the tree the
             session was dispatched into (§3.5), and no item scope can widen that"}
```

Two sessions in one run were refused a plain `ls` this way. Suppressing stderr is not
a write, and the sessions most likely to do it are the careful ones — so the noise
lands hardest on exactly the behaviour a deny rate is meant to reward.

### The same block, before and after

Run `r-20260821-c82b`, at plan review, before the fixes:

```
strain
  denies 3 / allowed 24 (rate 0.11)
    unnamed: 3
  waves 3 (2 carried one job)
  receipt retries 7, aborts 0, holds 0
  largest brief 0 chars (0% of the effective per-slot window)

THRESHOLDS CROSSED — each is a finding to investigate, never a stop:
  reviewDispatchesPerItem (threshold 3)
  receiptRetries (threshold 3)
```

Run `r-20260821-113c`, deeper into the pipeline, after them:

```
strain
  denies 3 / allowed 52 (rate 0.05)
    edit: 3
  waves 8 (7 carried one job)
  receipt retries 7, aborts 0, holds 0
  verify 0, red 0, green 0
  largest brief 5360 chars (4% of the effective per-slot window)

THRESHOLDS CROSSED — each is a finding to investigate, never a stop:
  receiptRetries (threshold 3)
```

Four differences, and every one of them is a fix: the denies name the gate that
refused them, the largest brief is a number rather than a structural zero, the
threshold that used to cross at every plan review does not, and the one that still
crosses is the one that should — seven receipt retries is the F17 story, and it is
pointing at a real defect rather than at a config value.

Three of these are one shape: **a reader and a writer that were tested separately and
never against each other.** It is worth stating plainly because it is the same shape as
F09 and F19, and it is where the remaining risk in this harness lives.

---

## What the harness got right

An adversarial report that lists only failures is its own kind of dishonesty. These
were watched just as closely and behaved exactly as documented:

- **The edit gate.** Every run, the orchestrator tried to write the source directly and
  was refused with a reason naming the rule and the way out: *"the orchestrator may not
  edit source without an active inline claim scoping this path (G8); use
  conductor_inline_claim if dispatch is genuinely more expensive than doing"*.
- **The state area is handler-written only.** A planner's `cat .conductor/state/*.json`
  and its attempt to write `plan.md` through a bash heredoc were both denied.
- **The registry gate.** A sub-session that called `conductor_decompose` was refused for
  being unregistered — even though conductor's own idle engine had just told it to.
- **The refusal that found F19.** Conductor would not run a verify over an empty scope
  map to reach a green it had not earned. That refusal is what exposed the rig's defect;
  a more accommodating harness would have scored a vacuous pass in every cell.
- **Sub-agent parenting (Task 21.1).** Read out of opencode's own storage: every
  sub-session is a child of the orchestrator and carries its role agent.

```
{"id": "ses_fdd723764ffeV26O6uhnL1gEY0", "parent_id": null, "agent": "conductor-orchestrator"}
{"id": "ses_fdd70ac05ffedmwDnDF0fQpor3", "parent_id": "ses_fdd723764ffeV26O6uhnL1gEY0", "title": "planner:", "agent": "conductor-planner"}
{"id": "ses_fdd62784fffe6CiLpepzyPdeR0", "parent_id": "ses_fdd723764ffeV26O6uhnL1gEY0", "title": "reviewer[correctness]:", "agent": "conductor-reviewer"}
{"id": "ses_fdd62784dffeuSY99kEKAACrAt", "parent_id": "ses_fdd723764ffeV26O6uhnL1gEY0", "title": "reviewer[completeness]:", "agent": "conductor-reviewer"}
{"id": "ses_fdd62784cffeYapEcCqnhE14vv", "parent_id": "ses_fdd723764ffeV26O6uhnL1gEY0", "title": "reviewer[decomposition]:", "agent": "conductor-reviewer"}
{"id": "ses_fdd62784bffe7XN8Bo7ofGoMLN", "parent_id": "ses_fdd723764ffeV26O6uhnL1gEY0", "title": "reviewer[minimality]:", "agent": "conductor-reviewer"}
```

- **The FSM and its journal.** Every transition carried its reason, in the record, at
  the moment it happened — `"PLAN_REVIEWED->EXECUTING: plan review clean
  (survivingMajors === 0) (§3.1)"`. Reading this campaign back was possible *because*
  the journal is as complete as it is; the defects were found in it, not in spite of it.
- **The observer is genuinely read-only**, and its `--bundle` survived the runs that
  produced it. Three of the exhibits in this document are bundles taken from live runs.
- **The wedge detector worked.** It disengaged a run that was making no progress, on
  the third futile re-prompt, exactly as §3.7 says. It was fed a lie by F09 — but given
  what it was told, it did the right thing.

---

## What this campaign could not settle

Stated plainly, because a smoke that overclaims is worse than one that stops early.

- **The ladder was not climbed.** The campaign spent its wall clock on the stop-fix-restart
  loop: twenty-two defects, each with a red proved first, a gate re-run, and a live
  restart from a clean seed. The T0 rung (`slugify-ts`) is the only one reached. T1–T4 —
  `changelog-ts`, `euler-cli-py`, `euler-solvers-py`, `snake-game-ts`, `config-widen-ts` —
  were not run, so `scopesIntersect` over-approximation, multi-wave scheduling and
  `queue_amend` under real pressure are **unmeasured**, not measured-and-fine.
- **The routed/direct comparison was not run.** Every cell here went through the router.
  Now that the §4.4 tags finally carry real roles and priorities, that comparison would
  measure something for the first time — and it has not been done.
- **No cell has been scored against a hidden test.** The last run got a failing test
  written to disk by a test-writer sub-session — the edit gate adjudicated that write
  against the item's scope and allowed it — and then stopped at the receipt, one step
  short of RED.
- **Rubric questions** — structure, decomposition quality, over-building — are outside
  what any record can answer and were not attempted.

## Cost, measured rather than estimated

From this campaign's own ledger, on one 27B model with six slots:

| Observation | Measured |
|---|---|
| Orchestrator turn | 10,000–11,400 prompt tokens, 8–60 s |
| Planner turn (plan stage, by the third attempt) | 21,000 prompt tokens, 113 s |
| One reviewer, four contending for six slots | `upstreamMs 467429` — 7.8 minutes |
| A T0 cell to plan review | over an hour of wall clock |
| A title-generation turn (auxiliary, same 27B) | 136,181 ms |
| An auxiliary turn that ran to the output ceiling | `promptTokens 2154, completionTokens 8192, upstreamMs 1306099` — 21.8 minutes |

That last row is worth its own sentence. `completionTokens` is exactly `limit.output`
(the served window / 4), so the generation ran to the ceiling; the shape — a small
prompt on the orchestrator's own session — is opencode's compaction turn, though that
identification is inferred from the shape rather than read from a log line. A
compaction fires whenever a session crosses its usable window, and on this hardware
each one is ~20 minutes during which the run does nothing. The runbook's ~60 h estimate
carries no allowance for it, and the pilot should count them.

The runbook's 14.2 estimate is ~60 h for 207 cells on the primary model. Nothing here
contradicts that arithmetic, but nothing here supports it either: no cell has yet run to
completion, and the two stages measured (plan review at 4 reviewers, item review at 6)
are the expensive ones.

---

## Calibration

Marked, so a reader can tell what was seen from what is believed.

**Measured** — in the record, reproducible from the bundles:

- The harness could not complete a run before this campaign. Not "was slow": every run
  died at INTAKE, and the reasons were F06, F09 and F12.
- No sub-session of any role had ever reached the model until F06 was fixed.
- No sub-session had ever received its own doctrine, temperature or router tag until
  F09 was fixed.
- `conductor_classify` had never run. The first completed classification in this
  harness's history is `r-20260821-113c` seq 51.
- The router had never received a correctly-tagged sub-session request, and its §4.4
  schema-conformance dataset was empty after 114 live requests.
- Two of ten declared breakdown thresholds were broken: one could never cross, one
  crossed in every run.
- Every bench cell was configured so no behavioral item could leave RED.

**Judged** — reasoned from the evidence, not directly observed:

- The 14.2 campaign, run before this smoke, would have produced a conductor arm that
  wedges in 100% of cells (F19), against a baseline arm that does not — and the report
  would have read as a decisive result about process overhead. That is a judgement about
  a counterfactual, but it is a short one: the wedge is deterministic and arm-specific.
- The defects cluster at **emitter↔reader seams** — a writer and a reader tested
  separately and never against each other. F09, F13 (twice), F16, F18 and F19 are all
  that shape. Where a seam has not yet been exercised live, the prior should be that it
  is broken, not that it is fine.
- The three tests that *certified* wrong behaviour (F12 twice, F18 once) were each
  written by observing what the code did. Their names state the correct rule; their
  assertions pinned the wrong one. That is a systematic risk in a suite this size, and
  1,900 green tests are worth less than they look against a system that had never run.

**Low confidence** — stated because leaving it out would be the dishonest choice:

- Whether the stages beyond the test-writer's receipt work at all. RED, GREEN, item
  review, the vet loop, publish and report have **never executed against a real model**.
  Every defect in this campaign was found by running one stage further than anyone had
  run before, and those stages are further still. The last run reached the test-writer,
  found F17 waiting there, and stopped — which is the pattern, not an exception.
- Whether a §2.10 `trivialItem` survives the stage end to end. The model produces one:
  run `r-20260821-47df` returned a schema-valid `trivialItem` that reached the
  acceptance table, where a miscounted size row refused it. No trivial run has reached
  EXECUTING, so the route past the refusal is unmeasured.
- Whether `scopesIntersect` over-approximates in practice. It has never scheduled a
  multi-item wave.
- Cost at tiers above T0. The only tier measured is the cheapest one.

---

## The 14.2 decision

The cleanliness bar the campaign was to be judged against, row by row, against what
this smoke actually produced:

| Row | Bar | Verdict |
|---|---|---|
| 1 | `bash scripts/test-conductor.sh` prints `GATE PASS` at the end | **PASS** — `TAP: tests=1940 pass=1940 fail=0 … GATE PASS` |
| 2 | Acceptance fails only rows 6/8/12/E | **PASS, and better** — 18 PASS / 3 FAIL, with row 6 flipped by this document; the three failures are row 8 (the 14.2 report), row 12 (the 14.2 commit) and detector E (which depends on row 8) |
| 3 | Every reached tier completed end to end | **FAIL** — T0 is the only tier reached, and no cell has yet run INTAKE→report |
| 4 | Classification and wave assertions held | **PARTIAL** — classification runs and its skeptic agrees; a wave dispatched a test-writer bound to its item and tree, and its write was adjudicated and allowed; nothing past that receipt has been tested |
| 5 | Debug read-allows exist in the record | **PASS** — `{"level":"debug","component":"gates","event":"allow","data":{"toolName":"read","toolClass":"read","sideEffect":"R0"}}` |
| 6 | No standing defect that changes what a cell measures | **PASS as of this commit** — F13, F18 and F19 each changed what a cell measures and all three are fixed; none is standing |
| 7 | Router comparison clean or declared | **DECLARED, not clean** — no direct (`--no-router`) run was made. The comparison is unmeasured |

**Verdict: NO-GO for the 207-cell campaign. GO for a bounded pilot, gated on the two
things this smoke did not reach.**

The reasoning is one sentence long: **every defect in this campaign was found by
running one stage further than anyone had run before**, and the stages past
`EXECUTING` — RED, GREEN, item review, the vet loop, publish, report — have still never
run against a real model. Committing 60 hours of model time to a pipeline whose second
half has never executed is buying a very expensive way to find F21.

What the pilot must produce before the full sweep is authorized:

1. **One T0 cell, INTAKE → report, scored against its hidden test.** This is the row-3
   failure above and it is the whole gate. It exercises RED, GREEN, item review, publish
   and report — six stages, none of which has ever run.
2. **One cell at T2 or above**, so that `scopesIntersect`, multi-item waves and
   `queue_amend` are exercised under real pressure rather than reasoned about.
3. **One routed / direct pair on the same task**, now that the §4.4 tags carry real
   roles and priorities for the first time. Before F09 that comparison could not have
   measured anything.

If those three come back clean, the sweep decision in the runbook (models across
T0/T1, T2–T4 on the primary model, reps=1 pilot first) stands as written. If any of
them turns up a defect of the same shape as F09 or F19, the right response is another
stop-fix-restart cycle, not a bigger sample: **a campaign cannot average away a
harness that does not work.**

---

## Acceptance, after this campaign

```
$ bash scripts/verify-acceptance.sh
PASS  row 1a: 90 test files present (>= 24)
PASS  row 1b: full suite green — TAP: tests=1937 pass=1937 fail=0 cancelled=0 skipped=0 todo=0 skipdirectives=0 (node exit=0)
PASS  row 2: bun leg green (8 pass)
PASS  row 3: ctest green — 100% tests passed
PASS  row 4: purity + dual-runtime + doctrine guards green
PASS  row 5: e2e green with all five scenarios named in TAP output
PASS  row 6: conductor/SMOKE.md present, 454 lines, with a command transcript
PASS  row 7: conductor/docs/RUNNER-DISCOVERY.md present, 601 lines, with a command transcript
FAIL  row 8: docs/build/artifacts/conductor-report.md missing
PASS  row 9a: serve.py offers --router/--no-router
PASS  row 9b: docs/build/artifacts/12.1-g5-equivalence.md present, 213 lines, with a command transcript
PASS  row 10: --parallel, maxInflightPerModel and per-slot context all derive from one number
PASS  row 11a: conductor/docs/OPERATIONS.md present (707 lines)
PASS  row 11b: conductor/docs/HONEST-LIMITS.md carries all 15 §9 limits
FAIL  row 12: manifest commits — missing: 13.2,14.2; duplicated: none
PASS  detector A: every §1.1 module exists, is non-empty, and is named by a test
PASS  detector B: all 9 doctrine packs present and non-trivial
PASS  detector C: every §1.1 router module exists and is non-empty
PASS  detector D: M5 clean — M5 PASS (192 file(s) scanned, 6 line exemption(s) all live)
FAIL  detector E: live artifact(s) missing: docs/build/artifacts/conductor-report.md
PASS  detector F: UPSTREAM_CONTRACT.md carries a real WIRE_CONTRACT_VERIFIED stamp

 18 PASS   3 FAIL
```

Row 12 named 13.2 as missing because it counts the commit this document ships in.
With that commit made, its detector reports `total 52 | missing ['14.2'] | dup []` —
every manifest commit present exactly once, save the campaign that has not run. The
other two failures are 14.2's report, which does not exist and — per the verdict above
— should not yet.

## F17 — a brief that names fields and never their shapes

This one was written down as a prediction **before** the run that tested it, so the
check below is a falsification rather than a story told afterwards. The classifier's
entire brief:

> Classify the following work request as exactly one of: question, trivial, work. Reply
> with a single JSON object matching the Classification schema (kind, rationale,
> confidence, trivialItem). trivialItem is a complete queue item (minus id/dependsOn)
> and is non-null ONLY for kind "trivial".
> — `adapter/tools.ts:830-835`

It names no field of that item, no type, and none of the seven ladder rungs. The
prediction named `Classification.trivialItem.ponytail.ladderRung`. What arrived:

```
seq 24 fanout subsession.retry {"attempt": 1, "errors": [
         "Classification.confidence: expected type string, got number",
         "Classification.trivialItem.ponytail.ladderRung: value is not one of the enum members"]}
```

The prediction held and under-called it: `confidence` failed too, because a model asked
for a confidence and not told it is a string writes `0.9`.

Then it happened twice more, at two other stages with two other roles. The plan stage
lost a whole stage retry to it. And the TDD stage could not pass at all:

```
seq 139 gates allow {"toolName": "write", "toolClass": "write", "sideEffect": "W"}   <- the test-writer's write, allowed against its item scope
seq 143 fanout subsession.retry {"attempt": 1, "errors": ["ImplementerResult.status: value is not one of the enum members",
                                                          "ImplementerResult.neededContext: expected type string|null, got array"]}
seq 147 fanout subsession.complete {"ok": false, "reason": "schema-invalid", "errors": ["ImplementerResult.status: ..."]}
seq 148 fsm guard-reject {"stage": "conductor_submit_test", "itemId": "slugify-impl", ...}
```

The test-writer wrote its failing test and then could not say so in a shape the handler
accepts, because nothing had ever shown it that shape. Three stages, three roles, one
cause.

**The fix** is `describeSchema(name)` in core, which renders the shape from `SCHEMAS`
itself — every field, its type, every enum member in full, nesting by indent; 474
characters for `Classification`, 419 for `Queue` — and the fan-out puts it in front of
every brief and every re-prompt, beside the validator that will refuse the reply. A
prose description of a schema is a second copy of it and drifts; this one cannot
disagree with the judge, because it reads the judge's own table.

```
Classification: object
  kind: one of "question" | "trivial" | "work"
  rationale: string
  confidence: string
  trivialItem: object | null
    title: string
    ...
    ponytail: object
      necessary: string
      reuse: string
      ladderRung: one of "skip" | "reuse" | "stdlib" | "platform" | "dependency" | "one-liner" | "minimal-code"
```

**Verified live.** The next run carried it, and the same classifier dispatch that had
cost five model calls across two stage attempts returned a valid Classification on the
first one:

```
seq 19 fanout subsession.dispatched {"role": "mechanical", "itemId": "", "model": "", "promptChars": 1377}
seq 27 fanout subsession.complete {"ok": true, "attempts": 1}
```

| | brief | attempts to a valid Classification |
|---|---|---|
| without the shape block | `promptChars: 614` | 3 failed on `ladderRung`, the stage refused, the whole stage retried, 2 more — **5** |
| with it | `promptChars: 1377` | **1** |

763 characters of rendered schema is the difference. The receipt-retry threshold that
crossed in every run of this campaign was measuring a brief that never said what it
wanted.

## F22 — the same placeholder, one layer down

The last finding of the campaign, and it arrived because the run before it finally
reached a stage nobody had watched. The classifier proposed `trivial`, and §2.10's
synthesis put its item through the SAME acceptance a decomposed queue passes —
deliberately, so a trivial item cannot walk past the size and scope rules. It was
refused:

```
seq 32 fsm guard-reject {"stage": "classify", "violations": ["item \"I1\" is too large: its acceptance spans 3 clusters
                          (slugify, leading, export), over the one-cluster item budget — split it into one item per cluster (§3.2)"]}
seq 34 gates allow {"toolName": "conductor_decompose", "toolClass": "conductor", "sideEffect": null}
```

That refusal does not stand. The three criteria — `slugify("Hello There World") ===
"hello-there-world"`, `leading and trailing hyphens are removed`, `export name and
signature are unchanged` — all assert about the one function, and the cluster scan read
each criterion's first non-determiner word as its subject, so two sentence-leading words
counted as two more subjects. The size row is the only violation in that verdict and
`validateQueue` returns every violation it finds, so the rest of the §3.2 table admits
this item. The one acceptance authority is sound; what refused here is a defect in how
it counted subjects, and the register carries the repair.

Nothing was recorded by the refused classify, so `run.classified` stayed false — and
the very next call decomposed the run. It went on to plan and execute carrying
`"provisional at intake; conductor_classify has not run yet"` for the rest of its life.

The mechanism is F12's, one layer down. `conductor_decompose` carries
`phase: "stage"`, which the legality choke point returns early for, delegating the
whole phase check to the handler — on this stated promise:

> the run-FSM edge already refuses a decompose from anywhere but a **classified** INTAKE
> — `core/tool-legality.ts:130-133`

The edge branches on `context.classification`, and `handleDecompose` passes
`run.classification.kind` — the placeholder, which always says `work`, which routes to
DECOMPOSED. Nothing on that path had ever read `run.classified`. The delegation's
premise was never implemented.

What it falsifies is the instruction every orchestrator carries in `core.md`:

> **You do not choose the next tool from memory** — you take the recommended one; a
> call out of order is refused, not negotiated.

The state block recommended `conductor_classify`. The model called
`conductor_decompose`. It was not refused.

**The fix** puts `classified` in the transition context, refuses every INTAKE exit
without it — one rule, all three routes — and has `handleDecompose` pass the receipt.
The tool-legality row's justification is now true rather than aspirational.

## The three ways a receipt fails

All three were seen live, and all three are now handled:

| Mode | What arrived | Handling |
|---|---|---|
| FENCED | ```` ```json\n{...}\n``` ```` — `Unrecognized token '`'` | the engine reads the first fenced block |
| WRONG-SHAPE | `ladderRung: value is not one of the enum members` | the brief carries the shape, rendered from the schema that will judge it |
| MALFORMED-STRING | `JSON Parse error: Unterminated string` | in-string control characters are escaped and the document re-read |

The third was the last thing this campaign found, and it is worth the detail because
it nearly got recorded and left. A local model writing a plan body into a JSON string
writes it the way it writes prose, with real line breaks in it, and JSON forbids a raw
control character inside a string. The first instinct was to leave it — the fix looked
like a design decision about lenient parsing. Then it blocked the run that found it:

```
seq 89 fanout subsession.retry {"attempt": 1, "errors": ["response was not parseable JSON: JSON Parse error: Unterminated string"]}
seq 91 fanout subsession.retry {"attempt": 2, "errors": [... the same ...]}
seq 93 gates allow {"toolName": "conductor_plan"}                <- the whole stage, again
seq 95 fanout subsession.complete {"ok": true, "attempts": 3}    <- recovered on the second stage attempt
```

Three identical failures and a stage retry is not an edge case, it is the plan stage's
normal behaviour on this model. The repair walks the reply tracking in-string and
escape state and rewrites only the characters JSON does not permit where they stand: a
line break between tokens is outside a string and is left alone, and a document broken
for any other reason stays broken and is reported with its own error. The shape block
also states the rule at the source, so the model has a chance to get it right unaided.

## The register behind this report

Every finding's raw record — the observation verbatim, what it falsified, and the
prediction written down before the fix with its verification after — is
[`docs/build/artifacts/13.2-findings-register.md`](../docs/build/artifacts/13.2-findings-register.md).
This document is the report; that one is the notebook.

## Reproducing any of this

Every exhibit is a bundle taken with the read-only observer, which is the intended way
to hand a run to someone else:

```bash
node conductor/tools/observe.ts .conductor/runs/<runId>            # the human read
node conductor/tools/observe.ts .conductor/runs/<runId> --json     # the same derivation
node conductor/tools/observe.ts .conductor/runs/<runId> --bundle DIR
```

`docs/developer/observing-a-run.md` carries the six questions to read one by. The one
addition this campaign makes to that guide is a habit rather than a step: **when a
signal reads clean, check that something writes the field it reads.** Two of them did
not.
